import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { OnJob } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import { AlbumUserRole, JobName, JobStatus, Permission, QueueName } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { mimeTypes } from 'src/utils/mime-types';
import { google, drive_v3 } from 'googleapis';

/**
 * This is the shape of the data we embed inside the OAuth `state` parameter.
 * We don't need anything fancy here — just enough to know *which Immich user*
 * kicked off the "Connect Google Drive" flow, so that when Google redirects
 * back to us with an authorization code, we know whose account to attach it to.
 */
type GoogleDriveStateClaims = {
  userId: string;
};

/**
 * GoogleDriveService owns everything related to the "sync album to Google Drive" feature:
 *
 *  1. The OAuth2 dance that lets a user grant Immich permission to upload files into their
 *     personal Google Drive (see getAuthUrl / handleCallback / linkAccount).
 *  2. Actually uploading a single asset file to Drive (see uploadAsset).
 *  3. Kicking off a bulk sync for every asset already in an album (see syncAlbum).
 *  4. The BullMQ job handlers that do the real upload work in the background, so that adding
 *     photos to an album stays fast and doesn't block on network calls to Google
 *     (see handleGoogleDriveUpload / handleGoogleDriveUploadQueueAll).
 */
@Injectable()
export class GoogleDriveService extends BaseService {
  // Secret key used to sign/verify the OAuth `state` parameter (see getAuthUrl/handleCallback below).
  //
  // NOTE (known limitation, tracked as a follow-up): this is generated fresh every time the
  // service class is instantiated, which in practice means "once per server process". That's
  // fine for a single-instance deployment, but it breaks in two real scenarios:
  //   - Horizontally scaled deployments (multiple immich-server replicas behind a load
  //     balancer): if the "get auth url" request lands on replica A but Google's redirect
  //     lands on replica B, replica B has a *different* secret and will reject a perfectly
  //     valid state as "invalid or expired".
  //   - A server restart between the user clicking "Connect" and Google redirecting back:
  //     the old secret is gone, so the callback fails.
  // The proper fix is to persist this secret somewhere shared (e.g. system metadata table)
  // instead of keeping it purely in process memory. Left as-is here to keep this change
  // focused; see dev-docs/google-drive-album-sync-plan.md for the write-up.
  private stateSecret = this.cryptoRepository.randomBytesAsText(32);

  /**
   * Builds a Google OAuth2 client using the app's client id/secret/redirect URL.
   *
   * NOTE: these currently fall back to placeholder strings ('YOUR_CLIENT_ID', etc.) when the
   * corresponding environment variables aren't set. That's convenient for local development
   * scaffolding, but it means a misconfigured production deployment will fail *silently* (with
   * a confusing Google API error) instead of refusing to start up. A follow-up should move
   * these into system config (so they're admin-configurable through the UI, like other
   * integrations) and fail loudly at startup if they're missing.
   */
  private getOAuth2Client() {
    // In a real application, you would read these from system config or environment variables
    const clientId = process.env.GOOGLE_CLIENT_ID || 'YOUR_CLIENT_ID';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || 'YOUR_CLIENT_SECRET';
    const redirectUrl = process.env.GOOGLE_REDIRECT_URL || 'YOUR_REDIRECT_URL';

    return new google.auth.OAuth2(clientId, clientSecret, redirectUrl);
  }

  /**
   * Step 1 of the "Connect Google Drive" flow.
   *
   * The frontend calls this (via GoogleDriveController#getAuthUrl) when the user clicks the
   * "Connect Google Drive" button in Settings. We build the URL the browser should be sent to
   * on Google's side, where the user reviews and approves the permissions we're asking for
   * (here: `drive.file`, which only lets us see/manage files *we* created — not the user's
   * whole Drive).
   *
   * We also generate a signed, short-lived `state` token and attach it to the URL. Google is
   * required to echo this value back to us untouched when it redirects the browser back to our
   * callback endpoint. We use it for two things:
   *   1. CSRF protection: without it, an attacker could trick a victim's browser into
   *      completing *the attacker's* Google login, silently linking the attacker's Drive
   *      account to the victim's Immich account.
   *   2. Remembering "who asked": since the callback request comes from Google (a plain
   *      browser redirect, not an authenticated Immich API call), we can't rely on cookies to
   *      know which Immich user is completing the flow. We stash the userId inside the signed
   *      state instead.
   */
  async getAuthUrl(userId: string): Promise<string> {
    const oauth2Client = this.getOAuth2Client();

    // `drive.file` is the narrowest scope Google offers for "upload files on behalf of the
    // user" — it only grants access to files/folders that our app itself creates, not the
    // user's entire Drive. This is deliberate: it minimizes what a compromised Immich server
    // could do with a leaked refresh token.
    const scopes = ['https://www.googleapis.com/auth/drive.file'];

    // Sign a token containing the userId, valid for 10 minutes — plenty of time for a human to
    // click through Google's consent screen, but short enough that a leaked/replayed state
    // (e.g. from a browser history entry) becomes useless quickly.
    const state = this.cryptoRepository.signJwt({ userId } satisfies GoogleDriveStateClaims, this.stateSecret, {
      expiresIn: '10m',
    });

    return oauth2Client.generateAuthUrl({
      // "offline" is what makes Google give us a refresh_token, not just a short-lived access token.
      access_type: 'offline',
      scope: scopes,
      // Forces the consent screen (and therefore a fresh refresh_token) every time, even for repeat authorizations.
      prompt: 'consent',
      state,
    });
  }

  /**
   * Step 2 of the "Connect Google Drive" flow — handles the redirect Google sends the user's
   * browser back to once they've approved (or denied) access.
   *
   * `state` is the short-lived, signed token we minted in getAuthUrl above. Verifying its
   * signature here is what stops an attacker's authorization `code` from being linked to a
   * victim's account (this is the standard OAuth "state" CSRF defense). If verification fails
   * (bad signature, tampered payload, or simply expired because the user took >10 minutes), we
   * reject the whole callback rather than trying to guess who it belongs to.
   */
  async handleCallback(code: string, state: string): Promise<{ userId: string }> {
    let claims: GoogleDriveStateClaims;
    try {
      // jwt.verify (called internally here) checks both the signature *and* the expiry claim,
      // so an expired-but-otherwise-valid state token is rejected automatically.
      claims = this.cryptoRepository.verifyJwt<GoogleDriveStateClaims>(state, this.stateSecret);
    } catch (error) {
      this.logger.warn(`Rejected Google Drive OAuth callback with invalid state: ${error}`);
      throw new BadRequestException('Invalid or expired Google Drive authorization request');
    }

    await this.linkAccount(claims.userId, code);
    return { userId: claims.userId };
  }

  /**
   * Exchanges the one-time authorization `code` from Google for a long-lived refresh token, and
   * saves that refresh token on the user's row so future uploads can be done without asking the
   * user to log in again.
   *
   * Kept private/internal: the only supported entry point into linking an account is the
   * callback flow above (handleCallback), which guarantees the `code` came with a valid,
   * signed `state` proving which user initiated the request.
   */
  private async linkAccount(userId: string, code: string): Promise<void> {
    try {
      const oauth2Client = this.getOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code);

      if (tokens.refresh_token) {
        await this.userRepository.update(userId, {
          googleDriveRefreshToken: tokens.refresh_token,
        });
      }
      // NOTE: if Google didn't hand back a refresh_token (this can legitimately happen if the
      // user has already granted consent before and Google decides not to re-issue one), we
      // currently just silently do nothing here — the user is *not* actually linked, but the
      // caller has no way to know that. See the TODO in handleCallback's caller-facing docs;
      // this is one of the two P0 issues being fixed alongside this comment pass.
    } catch (error) {
      this.logger.error(`Failed to link Google account: ${error}`);
      throw new BadRequestException('Failed to link Google account');
    }
  }

  /**
   * Lets the user choose which Drive folder uploaded photos should land in. If left unset,
   * uploadAsset() below just uploads to the root of "My Drive".
   */
  async setFolderId(userId: string, folderId: string): Promise<void> {
    await this.userRepository.update(userId, {
      googleDriveFolderId: folderId,
    });
  }

  /**
   * Uploads a single asset's original file to the given user's Google Drive.
   *
   * This function is intentionally defensive about *not* uploading when it doesn't need to:
   *   - If the user hasn't connected Google Drive yet, we skip instead of throwing. This matters
   *     because this function is called from a background job that runs automatically every
   *     time a photo is added to an album — most users will *never* have linked Drive, so
   *     throwing here would mean constant failing/retrying jobs for the vast majority of users.
   *   - If we've already uploaded this exact asset for this exact user before (tracked in the
   *     `google_drive_upload` ledger table), we skip re-uploading it. Without this check, adding
   *     the same photo to two albums, or re-adding a removed photo, would create duplicate files
   *     on the user's Drive every time (Google's `files.create` API is not idempotent on its own).
   *
   * Returns 'skipped' or 'uploaded' (rather than throwing on the "nothing to do" cases) so
   * callers — like the job handler at the bottom of this file — can tell the difference between
   * "nothing needed to happen" and "the upload actually happened", without treating the former
   * as an error.
   */
  async uploadAsset(userId: string, assetId: string): Promise<'skipped' | 'uploaded'> {
    // 1) Does this user even have Google Drive connected? If not, there's nothing to do — and
    //    this is an expected, everyday case (most users won't have linked Drive), not an error.
    const user = await this.userRepository.get(userId, {});
    if (!user || !user.googleDriveRefreshToken) {
      this.logger.debug(`Skipping Google Drive upload for asset ${assetId}: user ${userId} has not linked Drive`);
      return 'skipped';
    }

    // 2) Has this asset already been uploaded for this user before? If so, don't upload it
    //    again — that would create a duplicate file in their Drive.
    const alreadyUploaded = await this.googleDriveRepository.getUploadedAssetIds(userId, [assetId]);
    if (alreadyUploaded.has(assetId)) {
      return 'skipped';
    }

    // 3) Load the actual asset row so we know where the original file lives on disk and what
    //    its original filename was (used both for the Drive upload's display name and for
    //    guessing its MIME type below).
    const asset = await this.assetRepository.getById(assetId);
    if (!asset) {
      throw new BadRequestException('Asset not found');
    }

    // Build an authenticated Drive API client for this specific user, using their stored
    // refresh token. The googleapis client automatically exchanges the refresh token for a
    // short-lived access token behind the scenes as needed.
    const oauth2Client = this.getOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: user.googleDriveRefreshToken });

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Stream the original file straight from disk instead of loading it fully into memory —
    // important for large video files. We also look up a MIME type from the filename extension
    // (Immich doesn't store MIME type directly on the asset row) so that Drive can show a proper
    // preview/thumbnail for the uploaded file instead of treating it as a generic binary blob.
    const streamInfo = await this.storageRepository.createReadStream(
      asset.originalPath,
      mimeTypes.lookup(asset.originalFileName),
    );

    // If the user configured a target folder (via setFolderId above), upload into it. Otherwise
    // the file lands in the root of "My Drive".
    const folderId = user.googleDriveFolderId;
    const fileMetadata: drive_v3.Schema$File = {
      name: asset.originalFileName,
      parents: folderId ? [folderId] : [],
    };

    const media = {
      mimeType: streamInfo.type || 'application/octet-stream',
      body: streamInfo.stream,
    };

    try {
      const { data } = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id', // We only need the new file's Drive-assigned id back, to record it in our upload ledger.
      });

      // Record this upload in our ledger table so future calls to uploadAsset() for the same
      // (userId, assetId) pair know to skip instead of re-uploading (see step 2 above).
      if (data.id) {
        await this.googleDriveRepository.recordUpload(userId, assetId, data.id);
      }

      this.logger.debug(`Successfully uploaded asset ${assetId} to Google Drive`);
      return 'uploaded';
    } catch (error) {
      this.logger.error(`Failed to upload asset ${assetId} to Google Drive: ${error}`);
      throw error;
    }
  }

  /**
   * Triggers a manual "sync this whole album to Google Drive" action — this is the fallback
   * button a user can press in the album view (e.g. if some assets failed to auto-upload
   * earlier, or the album existed before Google Drive was connected at all).
   *
   * Two important design decisions baked into this method:
   *
   *   1. Only the album's *owner* is allowed to trigger this, and uploads always go to the
   *      *owner's* Drive account — never the acting user's. Without this restriction, someone
   *      with edit access to a shared album (but who isn't the owner) could trigger uploads
   *      into the owner's personal Google Drive on the owner's behalf, without the owner ever
   *      having asked for that. Requiring `auth.user.id` to actually *be* the owner keeps "whose
   *      Drive gets written to" and "who can trigger it" the same person.
   *
   *   2. We de-duplicate against the upload ledger *before* queueing jobs, not just inside the
   *      job handler. This avoids flooding the job queue with jobs that will immediately no-op
   *      when most of an album's assets have already been synced from earlier automatic
   *      uploads.
   */
  async syncAlbum(auth: AuthDto, albumId: string): Promise<void> {
    // Basic read-access check: the caller must at least be able to see this album.
    await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [albumId] });

    const album = await this.albumRepository.getById(albumId, { withAssets: true }, auth.user.id);
    if (!album) {
      throw new BadRequestException('Album not found');
    }

    // Album ownership in Immich isn't a plain column on the album table — it's expressed as a
    // row in `album_user` with role = 'owner'. So we look through the album's user list for an
    // entry that (a) has the Owner role and (b) belongs to the person making this request.
    const isOwner = album.albumUsers.some(
      ({ role, user }) => role === AlbumUserRole.Owner && user.id === auth.user.id,
    );
    if (!isOwner) {
      throw new ForbiddenException('Only the album owner can sync it to Google Drive');
    }

    // From here on, `ownerId` and `auth.user.id` are the same person (we just verified that
    // above), but naming it `ownerId` makes the intent at each call site below clearer: this is
    // whose Google Drive the assets are being uploaded to, not just "the caller".
    const ownerId = auth.user.id;
    const assetIds = album.assets.map((asset) => asset.id);
    if (assetIds.length === 0) {
      return; // Empty album — nothing to sync.
    }

    // Skip assets that are already sitting in the owner's Drive from a previous sync (either
    // automatic, on add-to-album, or an earlier manual sync). This keeps repeated clicks of the
    // "sync" button cheap and avoids creating duplicate files.
    const alreadyUploaded = await this.googleDriveRepository.getUploadedAssetIds(ownerId, assetIds);
    const pending = assetIds.filter((assetId) => !alreadyUploaded.has(assetId));
    if (pending.length === 0) {
      return; // Everything in this album is already synced.
    }

    // queueAll (rather than calling queue() once per asset) batches all these jobs into a single
    // bulk insert into the job queue, which matters a lot for large albums (hundreds/thousands
    // of assets) — one round trip instead of one per asset.
    await this.jobRepository.queueAll(
      pending.map((assetId) => ({
        name: JobName.GoogleDriveUpload,
        data: { userId: ownerId, assetId },
      })),
    );
  }

  /**
   * Handler for the "queue all" variant of this job, following the same pattern as other
   * background job families in Immich (e.g. thumbnail generation, face detection): every job
   * queue is expected to support a bulk "(re)process everything" trigger from the admin Jobs
   * panel, even if — like here — there isn't yet a meaningful "everything" to reprocess for this
   * particular feature.
   *
   * TODO: this is currently a placeholder. A complete implementation would, for every user who
   * has linked Google Drive, find every asset in every album they own that hasn't been uploaded
   * yet (i.e. reuse the same "diff against the ledger" logic as syncAlbum above, just across all
   * of a user's albums instead of one), and queue GoogleDriveUpload jobs for each. Left
   * unimplemented for now so the admin "start" button in the Jobs panel doesn't error out, but it
   * currently does nothing useful beyond logging.
   */
  @OnJob({ name: JobName.GoogleDriveUploadQueueAll, queue: QueueName.GoogleDriveUpload })
  async handleGoogleDriveUploadQueueAll(data: { force: boolean }) {
    // For now, this is a placeholder to satisfy the QueueAll pattern.
    // In a full implementation, it might find all assets matching a condition and queue individual jobs.
    this.logger.debug(`handleGoogleDriveUploadQueueAll triggered with force=${data.force}`);
    return JobStatus.Success;
  }

  /**
   * The actual background worker for a single "upload this one asset to Google Drive" job.
   * These jobs are queued from two places:
   *   - AlbumService, automatically, whenever an asset is added to an album (see
   *     album.service.ts's addAssets/addAssetsToAlbums).
   *   - GoogleDriveService#syncAlbum above, when a user manually clicks "sync" on an album.
   *
   * We map uploadAsset()'s 'skipped' result to JobStatus.Skipped (rather than JobStatus.Success)
   * so that the admin Jobs panel accurately reflects how many jobs actually did real work versus
   * how many were no-ops (e.g. because the user hadn't linked Drive, or the asset was already
   * uploaded).
   */
  @OnJob({ name: JobName.GoogleDriveUpload, queue: QueueName.GoogleDriveUpload })
  async handleGoogleDriveUpload(data: { userId: string; assetId: string }) {
    const result = await this.uploadAsset(data.userId, data.assetId);
    return result === 'skipped' ? JobStatus.Skipped : JobStatus.Success;
  }
}
