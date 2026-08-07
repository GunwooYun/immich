import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { drive_v3, google } from 'googleapis';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { OnJob } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import { AlbumUserRole, JobName, JobStatus, Permission, QueueName, SystemMetadataKey } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { JobItem } from 'src/types';
import { mimeTypes } from 'src/utils/mime-types';
import { isGoogleDriveEnabled } from 'src/utils/misc';

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
  /**
   * Reads the shared secret used to sign/verify the OAuth `state` parameter, or returns null if
   * this Immich instance has never issued a Google Drive auth URL yet (i.e. no secret has ever
   * been persisted).
   *
   * Background on why this lives in the database rather than in a class field: it used to be a
   * plain in-memory field (`private stateSecret = randomBytesAsText(32)`), generated fresh every
   * time the service class was instantiated — which in practice meant "once per server process".
   * That was fine for a single-instance deployment, but broke in two very real scenarios:
   *   - Horizontally scaled deployments (multiple immich-server replicas behind a load
   *     balancer, e.g. `docker compose ... --scale immich-server=3`, which this project's own
   *     mise.toml dev/prod tasks support): if the "get auth url" request lands on replica A but
   *     Google's redirect lands on replica B, replica B has a *different* secret in memory and
   *     will reject a perfectly valid state as "invalid or expired".
   *   - A server restart between the user clicking "Connect" and Google redirecting back: the
   *     old in-memory secret is gone, so the callback fails.
   *
   * Storing it in the `system_metadata` table (the same mechanism Immich already uses for other
   * server-wide, rarely-changing settings — see SystemMetadataKey) instead of process memory
   * fixes both cases: every server process reads the same value from the database, and it
   * survives restarts.
   *
   * This read-only variant is what the *verification* path (handleCallback) uses — see
   * getOrCreateStateSecret below for the issuing path, and for why only that one is allowed to
   * create a secret.
   */
  private async findStateSecret(): Promise<string | null> {
    const existing = await this.systemMetadataRepository.get(SystemMetadataKey.GoogleDriveState);
    return existing?.secret ?? null;
  }

  /**
   * Same as findStateSecret above, but mints and persists a new secret if none exists yet.
   *
   * Only the *issuing* side of the OAuth flow (getAuthUrl) may use this. The verification side
   * (handleCallback) deliberately uses the read-only findStateSecret instead, for two reasons:
   *   - handleCallback is a public, unauthenticated route (Google redirects the browser to it, so
   *     it can't require a session). A verification path has no business creating signing
   *     material — otherwise anyone hitting the callback URL on a fresh instance could cause a
   *     secret to be generated and written to system_metadata.
   *   - If a secret doesn't exist, then no auth URL was ever issued, so no valid `state` can
   *     possibly exist either — the only correct answer is to reject, not to mint a fresh secret
   *     and then fail verification against it anyway.
   *
   * Known, accepted minor race: if this feature is used for the very first time by two concurrent
   * requests before any secret has been persisted yet, both could generate their own random
   * secret and race to write it via `set()` (which unconditionally overwrites). Worst case, one
   * of those two initial requests gets a spurious "invalid or expired" error and has to retry —
   * there's no security impact (an attacker can't influence which secret wins), and this can only
   * happen once, ever, per Immich instance, right after the feature is first used.
   */
  private async getOrCreateStateSecret(): Promise<string> {
    const existing = await this.findStateSecret();
    if (existing) {
      return existing;
    }

    const secret = this.cryptoRepository.randomBytesAsText(32);
    await this.systemMetadataRepository.set(SystemMetadataKey.GoogleDriveState, { secret });
    return secret;
  }

  /**
   * Builds a Google OAuth2 client from the admin-managed system config.
   *
   * These used to come from `process.env` with placeholder fallbacks ('YOUR_CLIENT_ID', …), which
   * meant a misconfigured deployment failed *silently*: every OAuth attempt bounced off Google with
   * an opaque error and nothing pointed at the actual cause. They now live in system config
   * alongside the OIDC login credentials, editable from the admin UI, and a missing value is
   * rejected here with a message that names what to fix.
   *
   * Environment variables are still honoured as a fallback so that anyone who set up this feature
   * before it moved into system config keeps working after an upgrade. Config wins when both are
   * present.
   */
  private async getOAuth2Client() {
    const { googleDrive } = await this.getConfig({ withCache: true });

    const clientId = googleDrive.clientId || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = googleDrive.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
    const redirectUrl = googleDrive.redirectUrl || process.env.GOOGLE_REDIRECT_URL;

    if (!googleDrive.enabled) {
      throw new BadRequestException('Google Drive sync is disabled for this server');
    }

    const missing = [
      ['client ID', clientId],
      ['client secret', clientSecret],
      ['redirect URL', redirectUrl],
    ]
      .filter(([, value]) => !value)
      .map(([label]) => label);

    if (missing.length > 0) {
      throw new BadRequestException(
        `Google Drive is not configured: missing ${missing.join(', ')}. Set these under Administration → Settings → Google Drive.`,
      );
    }

    return new google.auth.OAuth2(clientId, clientSecret, redirectUrl);
  }

  /**
   * Whether the server operator has turned this feature on *and* finished configuring it.
   *
   * Used by the paths that must stay silent rather than throw when the feature is off: the upload
   * worker (a queued job for a now-disabled feature should skip, not fail and retry) and the
   * queue-all backfill. The interactive paths reuse getOAuth2Client's exceptions instead, since
   * there a clear error message is more useful than silence.
   */
  private async isEnabled(): Promise<boolean> {
    const { googleDrive } = await this.getConfig({ withCache: true });
    return isGoogleDriveEnabled({
      ...googleDrive,
      clientId: googleDrive.clientId || process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: googleDrive.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '',
      redirectUrl: googleDrive.redirectUrl || process.env.GOOGLE_REDIRECT_URL || '',
    });
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
    const oauth2Client = await this.getOAuth2Client();

    // `drive.file` is the narrowest scope Google offers for "upload files on behalf of the
    // user" — it only grants access to files/folders that our app itself creates, not the
    // user's entire Drive. This is deliberate: it minimizes what a compromised Immich server
    // could do with a leaked refresh token.
    const scopes = ['https://www.googleapis.com/auth/drive.file'];

    // Sign a token containing the userId, valid for 10 minutes — plenty of time for a human to
    // click through Google's consent screen, but short enough that a leaked/replayed state
    // (e.g. from a browser history entry) becomes useless quickly.
    const stateSecret = await this.getOrCreateStateSecret();
    const state = this.cryptoRepository.signJwt({ userId } satisfies GoogleDriveStateClaims, stateSecret, {
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
    // Read the signing secret *outside* the verification try/catch below. Failing to read it is an
    // infrastructure problem (couldn't reach/read system_metadata), not "the user's state token is
    // bad" — folding it into that catch would misreport a database outage as a rejected
    // authorization request, both to the user and in the logs.
    let stateSecret: string | null;
    try {
      stateSecret = await this.findStateSecret();
    } catch (error) {
      // The callback controller catches everything and redirects to "?google-drive=error", so this
      // log line is the only place the real cause gets recorded — make it say what actually broke.
      this.logger.error(`Failed to read the Google Drive OAuth state secret: ${error}`);
      throw error;
    }

    // No secret persisted means this instance has never issued an auth URL, so no valid `state`
    // can exist. Reject outright rather than creating one here (see getOrCreateStateSecret's
    // comment: this route is public, and the verification path must not mint signing material).
    if (!stateSecret) {
      this.logger.warn('Rejected Google Drive OAuth callback: no state secret has been issued yet');
      throw new BadRequestException('Invalid or expired Google Drive authorization request');
    }

    let claims: GoogleDriveStateClaims;
    try {
      // jwt.verify (called internally here) checks both the signature *and* the expiry claim,
      // so an expired-but-otherwise-valid state token is rejected automatically.
      claims = this.cryptoRepository.verifyJwt<GoogleDriveStateClaims>(state, stateSecret);
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
    let refreshToken: string;
    try {
      const oauth2Client = await this.getOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code);

      // Google is only guaranteed to hand back a refresh_token on the *first* time a user grants
      // consent to an app; on subsequent authorizations it may omit it if it decides the app
      // already has one on file. We always pass `prompt: 'consent'` in getAuthUrl() specifically
      // to make Google re-show the consent screen (and, in practice, re-issue a fresh
      // refresh_token) every single time — but Google's behavior here isn't something we
      // control, so we still have to handle the "no refresh_token came back" case explicitly
      // rather than assuming it always will.
      //
      // This used to be silently ignored (the method would return successfully with nothing
      // saved), which meant the OAuth callback controller would redirect the user to
      // "?google-drive=connected" even though nothing was actually linked — every upload
      // attempt afterwards would then silently skip that user forever, with no error anywhere
      // pointing back to the real cause. Throwing here instead makes the callback controller
      // redirect to "?google-drive=error" so the user actually finds out the connection didn't
      // take, and can retry.
      if (!tokens.refresh_token) {
        throw new Error('Google did not return a refresh token for this authorization');
      }
      refreshToken = tokens.refresh_token;
    } catch (error) {
      this.logger.error(`Failed to link Google account: ${error}`);
      throw new BadRequestException('Failed to link Google account');
    }

    await this.googleDriveRepository.upsertCredentials(userId, refreshToken);
  }

  /**
   * Lets the user choose which Drive folder uploaded photos should land in. If left unset,
   * uploadAsset() below just uploads to the root of "My Drive".
   *
   * Rejects if the user hasn't connected Google Drive: there'd be no credentials row to attach the
   * folder to, so the setting would silently evaporate and the user would have no idea why their
   * photos kept landing somewhere else.
   */
  async setFolderId(userId: string, folderId: string): Promise<void> {
    const updated = await this.googleDriveRepository.setFolderId(userId, folderId || null);
    if (updated === 0) {
      throw new BadRequestException('Google Drive is not connected for this user');
    }
  }

  /**
   * Powers the settings page: tells the frontend whether this user has Google Drive connected and,
   * if so, which folder they picked and when they linked it.
   *
   * Deliberately never returns the refresh token itself — the frontend has no use for it, and the
   * whole point of moving credentials into their own table was to stop the token travelling further
   * than it needs to.
   */
  async getStatus(userId: string): Promise<{ connected: boolean; folderId: string | null; connectedAt: Date | null }> {
    const credentials = await this.googleDriveRepository.getCredentials(userId);
    if (!credentials) {
      return { connected: false, folderId: null, connectedAt: null };
    }

    return {
      connected: true,
      folderId: credentials.folderId,
      connectedAt: credentials.connectedAt,
    };
  }

  /**
   * Disconnects the user's Google Drive account by discarding the stored credentials.
   *
   * Idempotent: disconnecting an already-disconnected account is a no-op rather than an error, so a
   * double-clicked button doesn't produce a spurious failure.
   *
   * Files already uploaded to the user's Drive are left alone — this feature is one-way sync, and
   * deleting a user's photos out of their own cloud storage because they unlinked an integration
   * would be a genuinely destructive surprise. The upload ledger is kept for the same reason (see
   * GoogleDriveRepository#deleteCredentials).
   */
  async disconnect(userId: string): Promise<void> {
    await this.googleDriveRepository.deleteCredentials(userId);
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
    // 0) Has an admin turned the feature off (or never finished configuring it)? Jobs queued
    //    before that can still be sitting in the queue, and failing them would just produce
    //    retries against a server that has no intention of talking to Google.
    if (!(await this.isEnabled())) {
      return 'skipped';
    }

    // 1) Does this user even have Google Drive connected? If not, there's nothing to do — and
    //    this is an expected, everyday case (most users won't have linked Drive), not an error.
    //    The absence of a `user_google_drive` row *is* the "not connected" signal.
    const credentials = await this.googleDriveRepository.getCredentials(userId);
    if (!credentials) {
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
    const oauth2Client = await this.getOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });

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
    const folderId = credentials.folderId;
    const fileMetadata: drive_v3.Schema$File = {
      name: asset.originalFileName,
      parents: folderId ? [folderId] : [],
    };

    const media = {
      mimeType: streamInfo.type || 'application/octet-stream',
      body: streamInfo.stream,
    };

    try {
      const { data } = await drive.files.create(
        {
          requestBody: fileMetadata,
          media,
          fields: 'id', // We only need the new file's Drive-assigned id back, to record it in our upload ledger.
          // Resumable rather than the default simple/multipart upload. Google caps simple uploads
          // at 5 MB, which plenty of photos and essentially every video exceed; resumable also lets
          // the transfer survive a mid-flight network blip instead of restarting from zero.
          uploadType: 'resumable',
        },
        {
          // Drive enforces per-user and per-project rate limits and answers with 403
          // (rateLimitExceeded / userRateLimitExceeded) or 429 once you cross them — very reachable
          // when a "queue all" run pushes a large backlog through several concurrent workers.
          // gaxios retries with exponential backoff starting from retryDelay.
          //
          // 403 is not in gaxios's default retry set (it's usually a genuine permission failure),
          // so it has to be listed explicitly. A 403 that is *actually* a permission problem will
          // simply fail all attempts and surface as before, just a few seconds later.
          retryConfig: {
            retry: 5,
            retryDelay: 1000,
            statusCodesToRetry: [
              [403, 403],
              [429, 429],
              [500, 599],
            ],
            onRetryAttempt: (error) =>
              this.logger.warn(
                `Retrying Google Drive upload for asset ${assetId} after ${error?.status ?? 'unknown'} response`,
              ),
          },
        },
      );

      // Record this upload in our ledger table so future calls to uploadAsset() for the same
      // (userId, assetId) pair know to skip instead of re-uploading (see step 2 above).
      if (data.id) {
        await this.googleDriveRepository.recordUpload(userId, assetId, data.id);
      }

      this.logger.debug(`Successfully uploaded asset ${assetId} to Google Drive`);
      return 'uploaded';
    } catch (error) {
      // A revoked grant is terminal, not transient: the user removed Immich's access from their
      // Google account settings, or the token expired after long disuse. Retrying can never
      // succeed, and because uploads are queued on every add-to-album, leaving the credentials in
      // place would turn every future album edit into another guaranteed failure.
      //
      // Dropping the row converts that permanent-failure loop into the ordinary "not connected"
      // state: uploads skip silently and the settings page invites the user to reconnect. The
      // ledger is deliberately left alone, so reconnecting won't re-upload what's already in Drive
      // (the same reasoning as the explicit Disconnect action).
      if (this.isInvalidGrant(error)) {
        this.logger.warn(
          `Google Drive access for user ${userId} was revoked or expired; clearing the stored credentials so they can reconnect`,
        );
        await this.googleDriveRepository.deleteCredentials(userId);
        return 'skipped';
      }

      this.logger.error(`Failed to upload asset ${assetId} to Google Drive: ${error}`);
      throw error;
    }
  }

  /**
   * Detects Google's "this refresh token is no longer usable" signal.
   *
   * googleapis surfaces it as an OAuth error payload rather than a typed class, and the exact shape
   * differs between the token-refresh path and the Drive API path, so this checks the documented
   * `invalid_grant` code in the places it actually shows up instead of relying on `instanceof`.
   */
  private isInvalidGrant(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }

    const { response, message } = error as { response?: { data?: { error?: unknown } }; message?: unknown };
    return (
      response?.data?.error === 'invalid_grant' || (typeof message === 'string' && message.includes('invalid_grant'))
    );
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
    const isOwner = album.albumUsers.some(({ role, user }) => role === AlbumUserRole.Owner && user.id === auth.user.id);
    if (!isOwner) {
      throw new ForbiddenException('Only the album owner can sync it to Google Drive');
    }

    // From here on, `ownerId` and `auth.user.id` are the same person (we just verified that
    // above), but naming it `ownerId` makes the intent at each call site below clearer: this is
    // whose Google Drive the assets are being uploaded to, not just "the caller".
    const ownerId = auth.user.id;
    // album.assets is typed as possibly undefined because Kysely's `.$if(options.withAssets, ...)`
    // can't statically know `withAssets: true` was actually passed at this call site — at runtime
    // it always will be (we call getById with `{ withAssets: true }` above), but falling back to an
    // empty array keeps this honest for the type checker without changing behavior: an "empty"
    // album is handled identically to one that genuinely has no assets, by the check right below.
    const assetIds = (album.assets ?? []).map((asset) => asset.id);
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
   * The "queue all" variant, driven by the admin Jobs panel — the instance-wide counterpart to the
   * per-album `syncAlbum` button. It walks every album whose owner has linked Google Drive and
   * queues an upload for each asset that isn't in that owner's ledger yet.
   *
   * This is the repair path for backlogs the per-album triggers can't cover on their own: albums
   * that predate the Drive connection, uploads that failed while the queue was paused, or a run of
   * `invalid_grant` skips that stopped once the user re-linked.
   *
   * Unlike most QueueAll handlers there is no meaningful `force` mode, and the flag is ignored: a
   * forced run could only queue assets the upload worker then skips on its own ledger check, and
   * making it genuinely re-upload would require ignoring the ledger — the one thing stopping every
   * file from being duplicated in the user's Drive. The admin UI therefore offers only the plain
   * "start" action (see QueuePanel.svelte, which lists no `allText` for this queue).
   *
   * Streamed and batched in JOBS_ASSET_PAGINATION_SIZE chunks, matching the other QueueAll
   * handlers (see OcrService#handleQueueOcr): the backlog on a large instance can be far too big to
   * materialize in memory or hand to the queue in one write.
   */
  @OnJob({ name: JobName.GoogleDriveUploadQueueAll, queue: QueueName.GoogleDriveUpload })
  async handleGoogleDriveUploadQueueAll(): Promise<JobStatus> {
    if (!(await this.isEnabled())) {
      return JobStatus.Skipped;
    }

    let jobs: JobItem[] = [];
    let queued = 0;

    for await (const { userId, assetId } of this.googleDriveRepository.streamPendingUploads()) {
      jobs.push({ name: JobName.GoogleDriveUpload, data: { userId, assetId } });

      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        queued += jobs.length;
        jobs = [];
      }
    }

    await this.jobRepository.queueAll(jobs);
    queued += jobs.length;

    this.logger.log(`Queued ${queued} Google Drive upload(s)`);
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
