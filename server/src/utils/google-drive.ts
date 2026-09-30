import { SystemConfig } from 'src/config';
import { GoogleDriveUploadErrorClass, JobName } from 'src/enum';
import { GoogleDriveRepository } from 'src/repositories/google-drive.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { isGoogleDriveEnabled } from 'src/utils/misc';

/**
 * Thrown by the upload path when Drive's stored byte count doesn't match what we sent — kept as a
 * dedicated class so the failure classifier below can name it without parsing message strings.
 */
export class GoogleDriveSizeMismatchError extends Error {}

/**
 * Thrown when the original file could not be opened, carrying the path that was actually tried.
 *
 * The path matters because the upload path retries once against a re-read asset row: the first
 * attempt may name a location the file has already been moved away from, and the message the user
 * eventually sees should name the location that genuinely failed, not the stale one. The first
 * production occurrence was diagnosed purely from that string.
 */
export class GoogleDriveSourceUnreadableError extends Error {
  constructor(
    message: string,
    readonly attemptedPath: string,
    // The wrap would otherwise drop `code`/`errno`, which is what tells ENOENT apart from EACCES —
    // a permissions problem and a moved file look identical in the message alone.
    options?: ErrorOptions,
  ) {
    super(message, options);
  }

  /**
   * The path that failed, and — when it differs — where the job was originally pointed.
   *
   * Used for the recorded `detail`, which is the only durable trace a person reads later. The
   * first instance of the move race was identified entirely from a `/data/upload` path sitting
   * beside a `/data/library` one, so a detail naming only one of them would have hidden it.
   */
  describePaths(startedFrom: string): string {
    return this.attemptedPath === startedFrom
      ? `Could not read ${this.attemptedPath}`
      : `Could not read ${this.attemptedPath} (moved from ${startedFrom})`;
  }
}

/**
 * Digs the Drive API "reason" code out of a googleapis error.
 *
 * Two different shapes exist and neither matches the `invalid_grant` one (a bare string at
 * `response.data.error` — see GoogleDriveService#isInvalidGrant, deliberately left separate):
 * Drive API errors carry `response.data.error.errors[].reason`, and gaxios sometimes lifts the
 * same array to `error.errors`. Both are checked; anything else yields undefined.
 */
export const getDriveErrorReason = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const { response, errors } = error as {
    response?: { data?: { error?: { errors?: { reason?: string }[] } } };
    errors?: { reason?: string }[];
  };

  const nested = response?.data?.error;
  const list = (typeof nested === 'object' && nested?.errors) || errors;
  return Array.isArray(list) ? list[0]?.reason : undefined;
};

const getStatus = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const { response, status } = error as { response?: { status?: number }; status?: number };
  return response?.status ?? status;
};

/**
 * Drive reason codes that mean "the configured destination folder is unusable" — gone, not
 * writable by us, or full of children. All share one property: every upload will fail identically
 * until the user picks a different folder, which is exactly what the FolderMissing block (and its
 * cure, setFolderId) models.
 */
const FOLDER_UNUSABLE_REASONS = new Set([
  'notFound',
  'insufficientFilePermissions',
  'insufficientParentPermissions',
  'numChildrenInNonRootLimitExceeded',
]);

/**
 * Maps a failed upload's error to the classification vocabulary of `google_drive_upload_error`.
 *
 * The distinctions that matter:
 *   - quota vs rate limit: both arrive as 403, distinguishable only by the reason code. Getting
 *     this wrong either retries a full Drive forever or gives up on a transient throttle.
 *   - folder problems are gated on BOTH a precise reason code AND a folder actually being
 *     configured (`hasFolder`). FolderMissing blocks the whole account, so a false positive here
 *     is the worst call this function can make — so a *bare* 404 (no folder reason code) never
 *     blocks. The Wave 1 review's original example of a folder-unrelated 404, an expired
 *     resumable session, turned out not to apply (uploads are multipart, see uploadAsset), but
 *     the rule stands: without the precise reason code a 404 does not prove the folder is gone.
 *     Those fall through to Unknown: non-blocking, picked up by the next sync. With no folder
 *     configured, uploads target the
 *     Drive root and no 404 can mean "folder gone" — also Unknown.
 */
export const classifyDriveError = (
  error: unknown,
  { hasFolder }: { hasFolder: boolean },
): GoogleDriveUploadErrorClass => {
  if (error instanceof GoogleDriveSizeMismatchError) {
    return GoogleDriveUploadErrorClass.SizeMismatch;
  }

  const reason = getDriveErrorReason(error);
  if (reason === 'storageQuotaExceeded') {
    return GoogleDriveUploadErrorClass.QuotaExceeded;
  }

  if (hasFolder && reason !== undefined && FOLDER_UNUSABLE_REASONS.has(reason)) {
    return GoogleDriveUploadErrorClass.FolderMissing;
  }

  const status = getStatus(error);
  if (status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || status === 403) {
    // A 403 that wasn't quota or a folder-permission problem is, at this point, one of Drive's
    // rate-limit variants (a genuine permission failure on our own root uploads would be
    // surprising with drive.file scope, and classifying it as retryable errs on the side of
    // trying again rather than blocking).
    return GoogleDriveUploadErrorClass.RateLimited;
  }

  return GoogleDriveUploadErrorClass.Unknown;
};

/**
 * Custom retry predicate for the Drive upload request.
 *
 * Supplying `shouldRetry` REPLACES gaxios's default logic entirely (gaxios uses it instead of,
 * not in addition to, the statusCodesToRetry check *and* the noResponseRetries handling) — so
 * this reimplements the attempt cap and the status ranges, minus the cases where an in-request
 * retry is futile or unsafe:
 *   - quota-exceeded 403: the account is full; five retries over ~14s cannot change that, and
 *     during a large backfill every queued job would burn that time before failing.
 *   - 404: either the destination folder is gone (futile) or the resumable session expired —
 *     and re-sending a partially-consumed, non-rewindable stream is the truncation hazard the
 *     size check exists to catch. Fail, record, retry fresh on the next trigger.
 *   - no HTTP status at all (ECONNRESET, DNS, TLS): same non-rewindable-body reasoning. Note
 *     this is a deliberate downgrade from gaxios's default no-response retries; such failures
 *     are recorded as `unknown` and *defer to the next manual sync or backfill* — there is no
 *     scheduled retry.
 * The attempt cap lives here now — gaxios no longer enforces it when a custom predicate is
 * supplied (pinned by a test). Backoff between attempts is gaxios's own (exponential,
 * multiplier 2 — verified in 6.7.1).
 */
export const shouldRetryDriveRequest = (error: {
  config?: { retryConfig?: { currentRetryAttempt?: number; retry?: number } };
}): boolean => {
  const retryConfig = error?.config?.retryConfig;
  const attempt = retryConfig?.currentRetryAttempt ?? 0;
  const maxRetries = retryConfig?.retry ?? 0;
  if (attempt >= maxRetries) {
    return false;
  }

  if (getDriveErrorReason(error) === 'storageQuotaExceeded') {
    return false;
  }

  const status = getStatus(error);
  if (status === undefined || status === 404) {
    return false;
  }

  return status === 403 || status === 429 || (status >= 500 && status <= 599);
};

/**
 * Queue a Google Drive upload for each of `assetIds` that the owner hasn't already uploaded.
 *
 * Three different code paths want to do exactly this — adding assets to one album, adding assets
 * to several albums at once (both in AlbumService), and the manual "sync this album now" button
 * (GoogleDriveService#syncAlbum) — and they had drifted into three near-identical copies. Since
 * services in Immich don't generally inject one another (BaseService wires up repositories, not
 * services), the shared logic lives here as a plain function that takes the repositories it needs,
 * the same way `addAssets`/`removeAssets` in utils/asset.util.ts do.
 *
 * Two deliberate choices inside:
 *
 * - The ledger is consulted *before* anything is queued. The job handler
 *   (GoogleDriveService#uploadAsset) checks the ledger again anyway — it has to, because assets can
 *   be uploaded by another path between queueing and execution — but filtering up front keeps the
 *   queue from filling with jobs we already know are no-ops. Adding 2,000 previously-synced photos
 *   to a new album should enqueue nothing, not 2,000 jobs that each wake up only to return early.
 *
 * - `queueAll` (one bulk insert) rather than `queue` in a loop. For a large album that's the
 *   difference between one round trip to the queue's backing store and one per asset.
 *
 * @param repositories the two repositories this needs, passed in rather than injected
 * @param ownerId whose Google Drive the assets go to — the *album owner*, which is not necessarily
 *   the person who performed the action; on a shared album a contributor's upload still belongs in
 *   the owner's Drive, because it's the owner who linked an account.
 * @param assetIds candidate assets; may contain ids that were already uploaded, or be empty.
 */
export const queueGoogleDriveUploads = async (
  repositories: { googleDrive: GoogleDriveRepository; job: JobRepository },
  ownerId: string,
  assetIds: string[],
  enabled: boolean,
): Promise<void> => {
  // `enabled` is passed in rather than read here because this is a plain function with no access
  // to system config. Checking it *first* is the point: without it, every add-to-album on an
  // instance that has never touched Google Drive still pays for a ledger lookup whose answer
  // cannot change the outcome, since the worker would discard the jobs anyway.
  if (!enabled || assetIds.length === 0) {
    return;
  }

  const { googleDrive, job } = repositories;

  const alreadyUploaded = await googleDrive.getUploadedAssetIds(ownerId, assetIds);
  const pending = assetIds.filter((assetId) => !alreadyUploaded.has(assetId));
  if (pending.length === 0) {
    return;
  }

  await job.queueAll(
    pending.map((assetId) => ({ name: JobName.GoogleDriveUpload, data: { userId: ownerId, assetId } })),
  );
};

/**
 * The only Drive scope this feature ever asks for. Exported because it now has two consumers: the
 * dedicated "Connect Google Drive" flow, and the login grant gate below, which treats the presence
 * of this scope in the *login* scope list as the operator's opt-in.
 */
export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** OAuth scope strings are space-delimited (RFC 6749 §3.3); tolerate any run of whitespace. */
export const hasGoogleDriveFileScope = (scope: string | undefined): boolean =>
  !!scope && scope.split(/\s+/).includes(GOOGLE_DRIVE_FILE_SCOPE);

const GOOGLE_ISSUER = 'https://accounts.google.com';
const DISCOVERY_SUFFIX = '/.well-known/openid-configuration';

/**
 * Reduces the spellings an operator plausibly types for Google's issuer to one form.
 *
 * The admin form accepts either the bare issuer or its discovery document URL (openid-client
 * resolves both), and a trailing slash is the most common copy-paste artefact. Anything that still
 * differs after this is treated as "not Google" — a false negative only means the login does not
 * also connect Drive, which is the safe direction.
 */
const normalizeIssuerUrl = (issuerUrl: string): string => {
  let url = issuerUrl.trim().toLowerCase().replace(/\/+$/, '');
  if (url.endsWith(DISCOVERY_SUFFIX)) {
    url = url.slice(0, -DISCOVERY_SUFFIX.length).replace(/\/+$/, '');
  }
  return url;
};

/**
 * Whether an OAuth login may also connect the user's Google Drive, using the refresh token Google
 * hands back from the login itself.
 *
 * Every clause guards a way this could store a token the Drive worker cannot use, or ask for
 * something the operator never agreed to:
 *
 *   - OAuth login must be on and the issuer must be Google — any other provider's refresh token is
 *     meaningless to the Drive API.
 *   - The login client must BE the Drive client, secret included. A Google refresh token is
 *     bound to the client that minted it, and the upload worker refreshes with the googleDrive
 *     credentials; a token from another client — or the same client with a different secret —
 *     would be stored as "connected" and then fail every refresh, which is worse than not
 *     connecting at all.
 *   - `prompt=consent` is refused: it mints a refresh token on every login while only the first
 *     is ever used, and Google drops the oldest once an account holds 100 for one client.
 *   - The login scope must include drive.file. This is the opt-in, deliberately with no separate
 *     flag: if the operator did not add the scope, users never saw a Drive consent screen, and
 *     silently asking for offline access would be a change they did not make.
 *   - The Drive feature itself must be usable (credentials and a derivable redirect URL), otherwise
 *     there is nowhere for the token to go.
 */
export const isGoogleDriveLoginGrantEnabled = (config: SystemConfig): boolean => {
  const { oauth, googleDrive, server } = config;

  if (!oauth.enabled) {
    return false;
  }

  if (normalizeIssuerUrl(oauth.issuerUrl) !== GOOGLE_ISSUER) {
    return false;
  }

  if (!googleDrive.clientId || oauth.clientId !== googleDrive.clientId) {
    return false;
  }

  // The secret has to match too, and its failure mode is nastier than the client id's. Refreshing
  // an upload token uses the googleDrive secret alone, and the account probe that follows a link
  // swallows its error and stores the connection anyway — so a login token minted under a
  // different secret is written as "connected" and then fails every refresh with invalid_client,
  // which is not invalid_grant and therefore never clears the row. The manual Connect flow cannot
  // reach that state: it exchanges the code with the Drive credentials and fails loudly.
  if (!googleDrive.clientSecret || oauth.clientSecret !== googleDrive.clientSecret) {
    return false;
  }

  // `prompt=consent` forces Google to mint a fresh refresh token on *every* login. This feature
  // only ever uses the first one, and Google invalidates the oldest token once an account has 100
  // outstanding for a client — so the churn would eventually invalidate the very token the upload
  // worker is using. An operator who wants that setting keeps it; they just do not get the
  // login grant with it.
  // OIDC says prompt is space-delimited, but commas are a common mis-spelling and Google would
  // reject that login anyway — splitting on both keeps this clause from opening on a typo.
  if (
    oauth.prompt
      .trim()
      .toLowerCase()
      .split(/[\s,]+/)
      .includes('consent')
  ) {
    return false;
  }

  if (!hasGoogleDriveFileScope(oauth.scope)) {
    return false;
  }

  return isGoogleDriveEnabled(googleDrive, server);
};
