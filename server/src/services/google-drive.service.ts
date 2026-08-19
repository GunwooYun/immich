import { BadRequestException, Injectable } from '@nestjs/common';
import { drive_v3, google } from 'googleapis';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { OnJob } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  GOOGLE_DRIVE_BLOCKING_ERROR_CLASSES,
  GoogleDriveUploadErrorClass,
  JobName,
  JobStatus,
  NotificationLevel,
  NotificationType,
  Permission,
  QueueName,
  SystemMetadataKey,
} from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { GoogleDriveStorage, JobItem } from 'src/types';
import {
  classifyDriveError,
  GoogleDriveSizeMismatchError,
  queueGoogleDriveUploads,
  shouldRetryDriveRequest,
} from 'src/utils/google-drive';
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
 * Drive reports quota figures as strings, because they can exceed 2^53 on very large accounts.
 * Number() is safe for anything real — 5 TB is ~5e12, well inside Number.MAX_SAFE_INTEGER (~9e15).
 */
const toByteCount = (value: string | null | undefined) =>
  value === null || value === undefined ? null : Number(value);

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
   * These briefly came from `process.env` (with placeholder fallbacks like 'YOUR_CLIENT_ID', which
   * meant a misconfigured deployment failed *silently* — every OAuth attempt bounced off Google
   * with an opaque error and nothing pointed at the cause). System config is now the only source,
   * matching how the OIDC login credentials work, and a missing value is rejected here with a
   * message that names what to fix.
   *
   * There is deliberately no environment-variable fallback. `GOOGLE_CLIENT_ID` and friends were
   * never part of `EnvSchema`, so they were undocumented, untyped and unvalidated — and worse,
   * their presence meant clearing the client ID in the admin UI didn't actually disable anything
   * as long as the container still had them set.
   */
  private async getOAuth2Client() {
    const { googleDrive } = await this.getConfig({ withCache: true });

    const { clientId, clientSecret, redirectUrl } = googleDrive;

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
    return isGoogleDriveEnabled(googleDrive);
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
  async getAuthUrl(userId: string): Promise<{ url: string; state: string }> {
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

    const url = oauth2Client.generateAuthUrl({
      // "offline" is what makes Google give us a refresh_token, not just a short-lived access token.
      access_type: 'offline',
      scope: scopes,
      // Forces the consent screen (and therefore a fresh refresh_token) every time, even for repeat authorizations.
      prompt: 'consent',
      state,
    });

    // The caller stores `state` in an HttpOnly cookie; handleCallback below requires the value
    // Google echoes back to match it. Signing alone was not enough — see that method for why.
    return { url, state };
  }

  /**
   * Step 2 of the "Connect Google Drive" flow — handles the redirect Google sends the user's
   * browser back to once they've approved (or denied) access.
   *
   * Three independent things must line up before a Google account gets linked:
   *
   *   1. the `state` Google echoed back verifies against our signing secret (not forgeable);
   *   2. it equals the value in the caller's HttpOnly `cookieState` (proves this is the same
   *      browser that started the flow);
   *   3. the signed `userId` matches the authenticated caller (proves it's the same Immich user).
   *
   * The signature alone used to be the only check, and that was not enough. A signed state is a
   * *bearer* token: anyone holding a fresh one could replay it from any browser, with no Immich
   * session at all, approve with **their own** Google account, and have `upsertCredentials`
   * silently overwrite the victim's link. Every photo the victim added to an album afterwards
   * would upload into the attacker's Drive, while their settings page still read "connected".
   * Capture only needed brief access to the auth URL within its 10-minute window — shared machine
   * history, a screen share, browser history sync.
   *
   * Binding to the cookie closes that: the cookie is HttpOnly and only ever set in the browser
   * that requested the auth URL, so a replayed state arrives without it. Requiring an
   * authenticated session as well mirrors what Immich's own OIDC link flow does
   * (`oauth.controller.ts` link is `@Authenticated()` and reads state from a cookie).
   *
   * The cookie is cleared by the controller once we return, which also makes each state
   * single-use in practice.
   */
  async handleCallback(
    code: string,
    state: string,
    cookieState: string | undefined,
    authUserId: string,
  ): Promise<{ userId: string }> {
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

    // Binding check. Compared before signature verification because it costs nothing and rejects
    // the replay case outright: a state lifted from someone else's browser arrives without the
    // matching HttpOnly cookie.
    if (!cookieState || cookieState !== state) {
      this.logger.warn(
        `Rejected Google Drive OAuth callback for user ${authUserId}: state did not match the browser that started the flow`,
      );
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

    // Belt and braces: even with a matching cookie, refuse to link if the session completing the
    // flow belongs to someone other than the user the state was issued for.
    if (claims.userId !== authUserId) {
      this.logger.warn(
        `Rejected Google Drive OAuth callback: state was issued for user ${claims.userId} but completed by ${authUserId}`,
      );
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

    // A fresh grant makes any `revoked` failure rows stale — those assets are still pending (no
    // ledger row), so the next sync or backfill will retry them; the rows would only sit around
    // misreporting "failed" in the UI.
    await this.googleDriveRepository.clearErrors(userId, [GoogleDriveUploadErrorClass.Revoked]);
  }

  /**
   * Lets the user choose which Drive folder uploaded photos should land in. If left unset,
   * uploadAsset() below just uploads to the root of "My Drive".
   *
   * Rejects if the user hasn't connected Google Drive: there'd be no credentials row to attach the
   * folder to, so the setting would silently evaporate and the user would have no idea why their
   * photos kept landing somewhere else.
   *
   * `folderName` is optional because there are two ways to get here. The Google Picker knows the
   * folder's name and sends it along, so the settings page can show "Photos". Pasting a folder id
   * by hand doesn't — and we deliberately don't go and look it up, because that would turn saving a
   * preference into a Drive API call that can fail on its own. An empty `folderId` clears both,
   * which is what stops a stale name from outliving the folder it described.
   */
  async setFolderId(userId: string, folderId: string, folderName?: string): Promise<void> {
    const updated = await this.googleDriveRepository.setFolderId(
      userId,
      folderId || null,
      (folderId && folderName) || null,
    );
    if (updated === 0) {
      throw new BadRequestException('Google Drive is not connected for this user');
    }

    // Choosing a folder (or clearing back to Drive root) is precisely the fix for the
    // "destination folder was deleted" block, so resolve it here — no separate resume needed.
    await this.googleDriveRepository.clearErrors(userId, [GoogleDriveUploadErrorClass.FolderMissing]);
  }

  /**
   * Powers the settings page: tells the frontend whether this user has Google Drive connected and,
   * if so, which folder they picked and when they linked it.
   *
   * Deliberately never returns the refresh token itself — the frontend has no use for it, and the
   * whole point of moving credentials into their own table was to stop the token travelling further
   * than it needs to.
   */
  async getStatus(userId: string): Promise<{
    connected: boolean;
    folderId: string | null;
    folderName: string | null;
    connectedAt: Date | null;
    failedCount: number;
    blockedReason: GoogleDriveUploadErrorClass | null;
  }> {
    const credentials = await this.googleDriveRepository.getCredentials(userId);
    if (!credentials) {
      // Disconnected users still get their failure summary: after an automatic disconnect
      // (revoked grant) the credentials row is gone, but the `revoked` error rows are exactly
      // what explains to the user *why* they're suddenly disconnected. Revoked wins the report
      // here — the Wave 1 review caught that the summary alone can never say it (revoked is not
      // a *blocking* class), which left the cost of these queries paid but the benefit
      // undelivered: the banner had nothing to branch on.
      const { failedCount, blockedReason } = await this.googleDriveRepository.getErrorSummary(userId);
      const revoked = await this.googleDriveRepository.hasErrorOfClass(userId, GoogleDriveUploadErrorClass.Revoked);
      return {
        connected: false,
        folderId: null,
        folderName: null,
        connectedAt: null,
        failedCount,
        blockedReason: revoked ? GoogleDriveUploadErrorClass.Revoked : blockedReason,
      };
    }

    const { failedCount, blockedReason } = await this.googleDriveRepository.getErrorSummary(userId);
    return {
      connected: true,
      folderId: credentials.folderId,
      folderName: credentials.folderName,
      connectedAt: credentials.connectedAt,
      failedCount,
      blockedReason,
    };
  }

  /**
   * Per-user cache of the last storage reading, keyed by user id.
   *
   * The gauge is fetched whenever the album menu opens, which is often, and the underlying call
   * goes out to Google — an uncached implementation would hit their API every time someone
   * glanced at the menu. A minute is short enough that the number is never meaningfully stale
   * (Drive usage moves slowly) and long enough to collapse a burst of menu toggling into one call.
   *
   * Deliberately in-process rather than Redis: the value is cheap to recompute, has no
   * correctness role, and a per-replica cache being independently warm is fine.
   */
  private static storageCache = new Map<string, { at: number; value: GoogleDriveStorage }>();
  private static readonly STORAGE_CACHE_MS = 60_000;

  /**
   * How full the user's Drive is.
   *
   * Verified empirically before building this: `about.get` is reachable under the `drive.file`
   * scope this integration already has, because `storageQuota` is *account* metadata rather than
   * file data — the scope restricts which files we can see, not whether we can ask how much room
   * is left. Had that been wrong, the feature would have required re-consent from every user.
   *
   * `limit` is absent for unlimited (Workspace) accounts, hence nullable: the UI shows a plain
   * usage figure instead of a gauge. `usageInDriveTrash` is reported separately because on a
   * transit-folder deployment it is usually the actionable number — a Drive that looks full is
   * often mostly trash that emptying would reclaim.
   */
  async getStorage(userId: string): Promise<GoogleDriveStorage> {
    const cached = GoogleDriveService.storageCache.get(userId);
    if (cached && Date.now() - cached.at < GoogleDriveService.STORAGE_CACHE_MS) {
      return cached.value;
    }

    const credentials = await this.googleDriveRepository.getCredentials(userId);
    if (!credentials) {
      throw new BadRequestException('Google Drive is not connected');
    }

    const oauth2Client = await this.getOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });

    let quota;
    try {
      ({
        data: { storageQuota: quota },
      } = await google.drive({ version: 'v3', auth: oauth2Client }).about.get({ fields: 'storageQuota' }));
    } catch (error) {
      // A revoked grant must read as "disconnected", not as a server fault: the settings page
      // polls this, and a 500 there would look like the feature is broken rather than unlinked.
      if (this.isInvalidGrant(error)) {
        this.logger.warn(`Google Drive access for user ${userId} was revoked; storage is unavailable`);
        throw new BadRequestException('Google Drive access was revoked. Please reconnect your account.');
      }
      throw error;
    }

    const value: GoogleDriveStorage = {
      limitBytes: toByteCount(quota?.limit),
      usageBytes: toByteCount(quota?.usage) ?? 0,
      usageInDriveBytes: toByteCount(quota?.usageInDrive) ?? 0,
      usageInDriveTrashBytes: toByteCount(quota?.usageInDriveTrash) ?? 0,
    };

    GoogleDriveService.storageCache.set(userId, { at: Date.now(), value });
    return value;
  }

  /**
   * The per-user backup counts, independent of any album.
   *
   * Wave 2's album status is album-scoped, which cannot describe progress for work that isn't —
   * an upload triggered from a multi-album selection, or the eventual per-asset upload. Having a
   * user-scoped source from the start means the progress UI has one honest thing to poll rather
   * than a per-album endpoint that later needs retrofitting.
   */
  async getMyStatus(userId: string): Promise<{ pending: number; failed: number }> {
    const [pending, { failedCount }] = await Promise.all([
      this.googleDriveRepository.countPendingUploads(userId),
      this.googleDriveRepository.getErrorSummary(userId),
    ]);
    return { pending, failed: failedCount };
  }

  /**
   * Hands the browser the three things Google's folder picker needs: a short-lived access token,
   * the OAuth client id, and the Google API key.
   *
   * Why this endpoint has to exist at all: the Picker is a Google-hosted widget that runs in the
   * user's browser. It authenticates by being *given* an access token — there is no way to have it
   * call back into Immich for one. So the alternative to this endpoint would be running a second,
   * browser-side OAuth flow purely for the picker, which means a second consent screen for the same
   * account the user just linked. This keeps the refresh token where it belongs (the database,
   * never sent to a browser) and mints a token with a lifetime measured in the tens of minutes.
   *
   * `getAccessToken()` refreshes against Google using the stored refresh token. Note it can return
   * `{ token: null }` without throwing — that's not an error path googleapis models as an
   * exception — so the null case is checked explicitly rather than assumed away.
   *
   * The `invalid_grant` case gets its own message because it's the one users actually hit: it means
   * the refresh token is dead (revoked in the Google account's security settings, or expired after
   * a long idle period on an unverified OAuth client), and the only fix is to reconnect. Reporting
   * that as a generic failure would send people hunting for problems on the Immich side.
   */
  async getPickerConfig(userId: string): Promise<{ accessToken: string; clientId: string; apiKey: string }> {
    const { googleDrive } = await this.getConfig({ withCache: true });
    if (!googleDrive.apiKey) {
      throw new BadRequestException('The Google Drive folder picker requires an API key to be configured');
    }

    const credentials = await this.googleDriveRepository.getCredentials(userId);
    if (!credentials) {
      throw new BadRequestException('Google Drive is not connected');
    }

    const oauth2Client = await this.getOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });

    let accessToken: string | null | undefined;
    try {
      ({ token: accessToken } = await oauth2Client.getAccessToken());
    } catch (error) {
      if (this.isInvalidGrant(error)) {
        this.logger.warn(`Google Drive access for user ${userId} was revoked; they need to reconnect`);
        throw new BadRequestException('Google Drive access was revoked. Please reconnect your account.');
      }
      throw error;
    }

    if (!accessToken) {
      throw new BadRequestException('Could not obtain a Google Drive access token');
    }

    return { accessToken, clientId: googleDrive.clientId, apiKey: googleDrive.apiKey };
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
   * Where to send the browser once the OAuth callback finishes, one way or the other.
   *
   * Google redirects to the *API* origin (that's what the registered redirect URI points at), so a
   * relative path would leave the user sitting on the API server. In a normal deployment that's
   * harmless — one origin serves both the API and the web app — but they come apart wherever
   * they're hosted separately, most visibly in the dev container, where the API is on :2283 and
   * the web app on :3000. The user then lands on a URL that has no UI behind it.
   *
   * `server.externalDomain` is Immich's existing "the address users actually reach this instance
   * at" setting, so when it's configured we send them there explicitly. Falling back to a relative
   * path preserves today's behaviour for the same-origin case.
   */
  async getCallbackRedirectUrl(result: 'connected' | 'error'): Promise<string> {
    const { server } = await this.getConfig({ withCache: true });
    const path = `/user-settings?isOpen=google-drive-sync&google-drive=${result}`;

    return server.externalDomain ? `${server.externalDomain}${path}` : path;
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

    // 1.5) Is this user's account currently blocked (Drive full, destination folder deleted)?
    //    Account-level state: every upload is guaranteed to fail the same way, so calling Drive
    //    per job would only rediscover it — expensively. This gate is what turns "quota hit
    //    mid-backfill" from ~N doomed API calls into one failure plus N−1 cheap skips: the first
    //    failing job writes the blocking row, and every job behind it in the queue lands here.
    //    Deliberately *no* error row per skipped asset — these assets stay pending (no ledger
    //    row), which is exactly what lets the resume path re-queue them later.
    const blockingError = await this.googleDriveRepository.getBlockingError(userId);
    if (blockingError) {
      this.logger.debug(
        `Skipping Google Drive upload for asset ${assetId}: user ${userId} is blocked (${blockingError})`,
      );
      return 'skipped';
    }

    // 2) Has this asset already been uploaded for this user before? If so, don't upload it
    //    again — that would create a duplicate file in their Drive.
    if (await this.googleDriveRepository.hasUpload(userId, assetId)) {
      return 'skipped';
    }

    // 3) Load the actual asset row so we know where the original file lives on disk and what
    //    its original filename was (used both for the Drive upload's display name and for
    //    guessing its MIME type below).
    //
    //    Both "gone" cases are skips, not failures. Jobs are queued when an asset is added to an
    //    album and can sit in the queue for a while, so by the time one runs the asset may have
    //    been trashed or deleted outright — an ordinary race, not something worth failing and
    //    retrying over. `getById` applies no `deletedAt` filter of its own (unlike the backlog
    //    query in streamPendingUploads), so the trashed case has to be checked here; without it a
    //    photo the user just deleted would still get copied into their Drive permanently, since
    //    this sync is one-way and the ledger would then mark it as done forever.
    const asset = await this.assetRepository.getById(assetId);
    if (!asset) {
      this.logger.debug(`Skipping Google Drive upload: asset ${assetId} no longer exists`);
      return 'skipped';
    }

    if (asset.deletedAt) {
      this.logger.debug(`Skipping Google Drive upload: asset ${assetId} is trashed or deleted`);
      return 'skipped';
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
    //
    // Opening it can fail even though the asset row looked healthy a moment ago. The row is not
    // proof the bytes are still on disk: the file may have been removed out from under Immich by a
    // failed storage-template migration, a half-restored backup, or an operator tidying up by
    // hand. `createReadStream` stats the file first, so that surfaces as an ENOENT throw. Treated
    // as a skip rather than a failure, for the same reason the deleted-asset cases above are — the
    // file is not coming back on a retry, and a failed job would hold this asset's dedup id (see
    // job.repository.ts) and keep the pair from being retried if the file is later restored.
    let streamInfo;
    try {
      streamInfo = await this.storageRepository.createReadStream(
        asset.originalPath,
        mimeTypes.lookup(asset.originalFileName),
      );
    } catch (error) {
      this.logger.warn(
        `Skipping Google Drive upload for asset ${assetId}: could not read ${asset.originalPath} (${error})`,
      );
      // Recorded even though this is a skip, not a failure — skips never pass through the catch
      // below, so without an explicit write here the settings page would have no idea this photo
      // isn't making it to Drive. (The second roadmap review caught exactly this seam.)
      await this.googleDriveRepository.upsertError(
        userId,
        assetId,
        GoogleDriveUploadErrorClass.SourceUnreadable,
        `Could not read ${asset.originalPath}`,
      );
      return 'skipped';
    }

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
          // `id` goes in the ledger; `size` is what lets us prove the upload actually arrived
          // intact before we record it as done — see the check below.
          fields: 'id,size',
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
            // Replaces the old statusCodesToRetry ranges (supplying shouldRetry makes gaxios use
            // it *instead of* them): same 403/429/5xx retries, except quota-exceeded 403s and
            // folder-gone 404s fail immediately — retrying a full Drive five times per job only
            // delays the failure ~14s and, across a large backfill, multiplies it by every queued
            // job. See shouldRetryDriveRequest for the classification.
            shouldRetry: shouldRetryDriveRequest,
            onRetryAttempt: (error) =>
              this.logger.warn(
                `Retrying Google Drive upload for asset ${assetId} after ${error?.status ?? 'unknown'} response`,
              ),
          },
        },
      );

      // Before trusting the 200, check Drive stored as many bytes as we sent.
      //
      // The retry policy above is the reason this matters. `media.body` is a live fs.ReadStream,
      // opened once, and a stream that has already been partially consumed cannot rewind. If a
      // retry re-sends a body that is mid-flight, Drive can answer 200 for a file that is short or
      // empty. That failure is uniquely nasty here: the ledger would record the asset as uploaded,
      // every later run would skip it, and the user would be left with a truncated photo in Drive
      // and no indication anything went wrong — the ledger's entire purpose defeated by a silent
      // success. Comparing sizes converts it into an ordinary loud failure.
      //
      // Drive returns `size` as a string, and omits it for Google-native document types — which we
      // never create, since every upload here is a photo or video with real bytes. A missing size
      // is therefore treated as unverifiable rather than assumed fine.
      const uploadedSize = data.size === null || data.size === undefined ? undefined : Number(data.size);
      if (uploadedSize !== streamInfo.length) {
        // Clean up the partial file rather than leaving an orphan the user has to find. It's
        // unambiguously ours — we have its id from the response — but a failure to delete must not
        // mask the real error, hence the inner catch.
        if (data.id) {
          try {
            await drive.files.delete({ fileId: data.id });
          } catch (deleteError) {
            this.logger.warn(`Could not remove the incomplete Drive file for asset ${assetId}: ${deleteError}`);
          }
        }

        throw new GoogleDriveSizeMismatchError(
          `Google Drive stored ${uploadedSize ?? 'an unknown number of'} bytes for asset ${assetId}, expected ${streamInfo.length}`,
        );
      }

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
        // Record before returning: this path is a skip, so it never reaches the classification
        // below, and the settings page needs *something* to explain why backups stopped. The
        // rows are cleared automatically when the user re-links (see linkAccount).
        const { firstOfClass } = await this.googleDriveRepository.upsertError(
          userId,
          assetId,
          GoogleDriveUploadErrorClass.Revoked,
          'Google Drive access was revoked or expired',
        );
        if (firstOfClass) {
          await this.notifyUploadFailure(userId, GoogleDriveUploadErrorClass.Revoked);
        }
        await this.googleDriveRepository.deleteCredentials(userId);
        return 'skipped';
      }

      // Every genuine failure lands in the error table before the job dies. This has to happen
      // here, pre-throw: the queue drops failed Drive jobs (removeOnFail, so the dedup jobId
      // frees up for retries), which means this row is the only durable record of the failure.
      const classification = classifyDriveError(error, { hasFolder: !!folderId });
      const { firstOfClass } = await this.googleDriveRepository.upsertError(
        userId,
        assetId,
        classification,
        error instanceof Error ? error.message : String(error),
      );
      if (
        firstOfClass &&
        (classification === GoogleDriveUploadErrorClass.QuotaExceeded ||
          classification === GoogleDriveUploadErrorClass.FolderMissing)
      ) {
        // Both blocking classes halt the account as hard as each other; a deleted destination
        // folder deserves the same one-time heads-up a full Drive gets (Wave 1 review note).
        await this.notifyUploadFailure(userId, classification);
      }

      this.logger.error(`Failed to upload asset ${assetId} to Google Drive (${classification}): ${error}`);
      throw error;
    } finally {
      // createReadStream hands back a live fs.ReadStream holding an open file descriptor. On the
      // success path googleapis consumes the stream to completion, which closes it — but on any
      // failure the pipe is abandoned mid-flight and nothing closes the source. A persistent
      // failure mode (say the configured Drive folder was deleted, so every upload 404s) would
      // then leak one descriptor per job; a large backlog at concurrency 5 walks the microservices
      // process toward EMFILE and starts breaking unrelated I/O. destroy() is a no-op on an
      // already-closed stream, so it's safe to call unconditionally.
      streamInfo.stream.destroy();
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
   * The albums this user could back up, with selection state and per-user progress.
   *
   * Counts are on the *viewer's* axis, not the owner's: under the selection model the same shared
   * album genuinely has a different backup state for each person who selected it, so "3,878 of
   * 4,662 uploaded" means "to your Drive".
   */
  async getSubscribableAlbums(auth: AuthDto) {
    const rows = await this.googleDriveRepository.getSubscribableAlbums(auth.user.id);
    return rows.map((row) => ({
      albumId: row.albumId,
      albumName: row.albumName,
      ownerName: row.ownerName,
      // Kysely types SQL booleans as `SqlBool` (number | boolean) because drivers differ on how
      // they hand back `true`. Normalising here keeps the DTO honestly boolean.
      isOwner: !!row.isOwner,
      subscribed: !!row.subscribed,
      accessLost: !!row.accessLost,
      assetCount: Number(row.assetCount ?? 0),
      uploadedCount: Number(row.uploadedCount ?? 0),
    }));
  }

  /**
   * Start backing an album up to the caller's Drive, and immediately queue whatever is already in
   * it — turning something on and having nothing happen until an unrelated future trigger is not
   * what the switch appears to promise (the same reasoning as the resume button).
   *
   * Gated on download access rather than read access: see syncAlbum for why.
   */
  async subscribeAlbum(auth: AuthDto, albumId: string): Promise<void> {
    if (!(await this.isEnabled())) {
      throw new BadRequestException('Google Drive sync is not enabled on this server');
    }
    await this.requireAccess({ auth, permission: Permission.AlbumDownload, ids: [albumId] });

    const credentials = await this.googleDriveRepository.getCredentials(auth.user.id);
    if (!credentials) {
      throw new BadRequestException('Connect Google Drive before choosing albums to back up');
    }

    await this.googleDriveRepository.subscribe(auth.user.id, albumId);

    const album = await this.albumRepository.getById(albumId, { withAssets: true }, auth.user.id);
    const assetIds = (album?.assets ?? []).map((asset) => asset.id);
    await queueGoogleDriveUploads(
      { googleDrive: this.googleDriveRepository, job: this.jobRepository },
      auth.user.id,
      assetIds,
      true,
    );
  }

  /**
   * Stop backing an album up. Deliberately does *not* touch the ledger — what is already in the
   * user's Drive stays there, and stays recorded, so re-selecting later doesn't re-upload it.
   *
   * Jobs already queued for this album still run: the worker validates the ledger and the
   * connection, not the subscription, so a few photos may still land. Accepted rather than paying
   * for a per-job membership join; the window is only ever "selected then immediately unselected".
   */
  async unsubscribeAlbum(auth: AuthDto, albumId: string): Promise<void> {
    // Deliberately no access check. The delete is already scoped to the caller's own
    // (userId, albumId) row, so requiring access adds no safety — but it does add a failure: the
    // one moment you most need to remove a selection is after losing access to the album it points
    // at, and an AlbumRead check throws exactly then. Combined with the row being invisible in the
    // listing, it would be both unremovable and unseeable. Turning off your own backup preference
    // must never depend on still being able to see what it referred to.
    await this.googleDriveRepository.unsubscribe(auth.user.id, albumId);
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
    // Refuse up front when the feature is switched off or half-configured, rather than cheerfully
    // enqueuing work the worker will silently discard. This is an interactive, user-initiated
    // action: pressing "Sync to Google Drive" and getting a success toast for jobs that can never
    // run is worse than being told why it can't happen. The background paths deliberately do the
    // opposite and skip in silence — a queued job for a since-disabled feature is not the user's
    // problem to see.
    if (!(await this.isEnabled())) {
      throw new BadRequestException('Google Drive sync is not enabled on this server');
    }

    // Download-level access, not merely read. Copying someone else's shared album into your own
    // Google account is data egress: if a share is ever restricted to viewing without
    // downloading, backing it up must be refused for the same reason downloading is. Same
    // requireAccess call, stronger permission.
    await this.requireAccess({ auth, permission: Permission.AlbumDownload, ids: [albumId] });

    const album = await this.albumRepository.getById(albumId, { withAssets: true }, auth.user.id);
    if (!album) {
      throw new BadRequestException('Album not found');
    }

    // This used to be owner-only, to stop a shared-album editor from pushing files into the
    // *owner's* personal Drive. That attack no longer exists: uploads now go to the Drive of
    // whoever selected the album, so the only Drive a caller can ever write to is their own. What
    // replaces the check is a subscription check — you can sync what you back up.
    if (!(await this.googleDriveRepository.isSubscribed(auth.user.id, albumId))) {
      throw new BadRequestException('Add this album to your Google Drive backups before syncing it');
    }

    // Uploads target the caller, not the album's owner — the whole point of the selection model.
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

    // Shared with AlbumService's automatic add-to-album path: skip anything already in the caller's
    // ledger, then bulk-enqueue the rest. Repeated clicks of the "sync" button are therefore cheap
    // and never produce duplicate Drive files. See utils/google-drive.ts for the reasoning.
    // `true` rather than another config read: this method already refused at the top if the
    // feature was off, so re-deriving it here could only produce the same answer.
    await queueGoogleDriveUploads(
      { googleDrive: this.googleDriveRepository, job: this.jobRepository },
      ownerId,
      assetIds,
      true,
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

    const queued = await this.queuePendingUploads();
    this.logger.log(`Queued ${queued} Google Drive upload(s)`);
    return JobStatus.Success;
  }

  /**
   * Streams the pending set (optionally for one user) into the job queue in batches. Shared by
   * the admin backfill above and the resume path below — same query, different scope.
   */
  private async queuePendingUploads(userId?: string): Promise<number> {
    let jobs: JobItem[] = [];
    let queued = 0;

    for await (const row of this.googleDriveRepository.streamPendingUploads(userId)) {
      jobs.push({ name: JobName.GoogleDriveUpload, data: { userId: row.userId, assetId: row.assetId } });

      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        queued += jobs.length;
        jobs = [];
      }
    }

    await this.jobRepository.queueAll(jobs);
    queued += jobs.length;
    return queued;
  }

  /**
   * The "resume uploads" button: clears the user's account-level block and immediately re-queues
   * their pending set.
   *
   * The immediate re-queue is the point (roadmap review, gap C). Clearing the block alone would
   * leave uploading stopped until some future trigger — an album edit, a manual sync, an admin
   * backfill — which could be days away. Someone who just freed Drive space and pressed the
   * button expects uploading to start *now*.
   *
   * Racing an in-flight failure is fine: if space wasn't actually freed, the first re-queued
   * upload fails, re-writes the quota row, and everything behind it skips at the entry gate —
   * the system converges back to blocked at the cost of one API call.
   */
  async resumeUploads(auth: AuthDto): Promise<void> {
    if (!(await this.isEnabled())) {
      throw new BadRequestException('Google Drive sync is not enabled on this server');
    }

    await this.googleDriveRepository.clearErrors(auth.user.id, [...GOOGLE_DRIVE_BLOCKING_ERROR_CLASSES]);
    const queued = await this.queuePendingUploads(auth.user.id);
    this.logger.log(`Resumed Google Drive uploads for user ${auth.user.id}: ${queued} job(s) queued`);
  }

  /**
   * One in-app notification per account-level state transition — fired only when the error
   * table's classification *first appears* for the user (the upsert reports it atomically), so a
   * thousand-asset failure storm produces one banner, not a thousand.
   *
   * Only the two states the user must personally act on are notified: a full Drive (free space,
   * press resume) and a revoked grant (reconnect). Per-asset failures are visible in the settings
   * page instead — notifying each one would be noise.
   */
  private async notifyUploadFailure(userId: string, classification: GoogleDriveUploadErrorClass): Promise<void> {
    const messages: Partial<Record<GoogleDriveUploadErrorClass, { title: string; description: string }>> = {
      [GoogleDriveUploadErrorClass.QuotaExceeded]: {
        title: 'Google Drive uploads paused',
        description: 'Your Google Drive storage is full. Free up space, then resume uploads from Settings.',
      },
      [GoogleDriveUploadErrorClass.FolderMissing]: {
        title: 'Google Drive uploads paused',
        description:
          'The destination folder no longer exists or cannot be used. Choose a new folder in Settings to continue.',
      },
      [GoogleDriveUploadErrorClass.Revoked]: {
        title: 'Google Drive disconnected',
        description: 'Google Drive access was revoked or expired. Reconnect from Settings to continue backing up.',
      },
    };

    const message = messages[classification];
    if (!message) {
      return; // Non-actionable classes never notify.
    }

    await this.notificationRepository.create({
      userId,
      type: NotificationType.Custom,
      level: NotificationLevel.Warning,
      ...message,
    });
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
