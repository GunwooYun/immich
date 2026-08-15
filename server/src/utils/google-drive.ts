import { GoogleDriveUploadErrorClass, JobName } from 'src/enum';
import { GoogleDriveRepository } from 'src/repositories/google-drive.repository';
import { JobRepository } from 'src/repositories/job.repository';

/**
 * Thrown by the upload path when Drive's stored byte count doesn't match what we sent — kept as a
 * dedicated class so the failure classifier below can name it without parsing message strings.
 */
export class GoogleDriveSizeMismatchError extends Error {}

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
 * Maps a failed upload's error to the classification vocabulary of `google_drive_upload_error`.
 *
 * The distinctions that matter:
 *   - quota vs rate limit: both arrive as 403, distinguishable only by the reason code. Getting
 *     this wrong either retries a full Drive forever or gives up on a transient throttle.
 *   - 404 = the destination folder is gone (`files.create` with a `parents` id that no longer
 *     exists). Like quota it's account-level: every upload will fail identically until the user
 *     picks a new folder.
 */
export const classifyDriveError = (error: unknown): GoogleDriveUploadErrorClass => {
  if (error instanceof GoogleDriveSizeMismatchError) {
    return GoogleDriveUploadErrorClass.SizeMismatch;
  }

  const reason = getDriveErrorReason(error);
  if (reason === 'storageQuotaExceeded') {
    return GoogleDriveUploadErrorClass.QuotaExceeded;
  }

  const status = getStatus(error);
  if (status === 404) {
    return GoogleDriveUploadErrorClass.FolderMissing;
  }
  if (status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || status === 403) {
    // A 403 that wasn't quota is, at this point, one of Drive's rate-limit variants (a genuine
    // permission failure on our own uploads would be surprising with drive.file scope, and
    // classifying it as retryable errs on the side of trying again rather than blocking).
    return GoogleDriveUploadErrorClass.RateLimited;
  }

  return GoogleDriveUploadErrorClass.Unknown;
};

/**
 * Custom retry predicate for the Drive upload request.
 *
 * Supplying `shouldRetry` REPLACES gaxios's default logic entirely (gaxios uses it instead of,
 * not in addition to, the statusCodesToRetry check) — so this reimplements the attempt cap and
 * the status ranges, minus the two cases where retrying is guaranteed futile:
 *   - quota-exceeded 403: the account is full; five retries over ~14s cannot change that, and
 *     during a large backfill every queued job would burn that time before failing.
 *   - 404: the destination folder is gone; same reasoning.
 * Backoff between attempts is gaxios's own (exponential, multiplier 2 — verified in 6.7.1).
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
