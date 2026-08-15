import { GoogleDriveUploadErrorClass } from 'src/enum';
import {
  classifyDriveError,
  getDriveErrorReason,
  GoogleDriveSizeMismatchError,
  shouldRetryDriveRequest,
} from 'src/utils/google-drive';

// Builders for the two error shapes googleapis actually produces. The nested one is the Drive
// API's own envelope; the flat one is gaxios lifting `errors` to the top level. Both exist in the
// wild, which is exactly why getDriveErrorReason checks both.
const nestedError = (status: number, reason?: string) => ({
  response: { status, data: { error: reason ? { errors: [{ reason }] } : {} } },
});
const flatError = (status: number, reason: string) => ({ status, errors: [{ reason }] });

// Wraps an error the way gaxios presents it to shouldRetry: with the retry bookkeeping attached.
const withRetryConfig = (error: object, attempt: number, retry = 5) =>
  Object.assign(error, { config: { retryConfig: { currentRetryAttempt: attempt, retry } } });

describe('getDriveErrorReason', () => {
  it('should read the nested Drive API shape', () => {
    expect(getDriveErrorReason(nestedError(403, 'storageQuotaExceeded'))).toBe('storageQuotaExceeded');
  });

  it('should read the flat gaxios shape', () => {
    expect(getDriveErrorReason(flatError(403, 'rateLimitExceeded'))).toBe('rateLimitExceeded');
  });

  it('should not be fooled by the invalid_grant shape, where error is a bare string', () => {
    // This is the shape isInvalidGrant handles — a *string* at response.data.error. Reading
    // `.errors` off a string must yield undefined, not a crash or a bogus reason.
    expect(getDriveErrorReason({ response: { status: 400, data: { error: 'invalid_grant' } } })).toBeUndefined();
  });

  it('should handle non-object and empty errors', () => {
    expect(getDriveErrorReason(undefined)).toBeUndefined();
    expect(getDriveErrorReason('boom')).toBeUndefined();
    expect(getDriveErrorReason(new Error('plain'))).toBeUndefined();
  });
});

describe('classifyDriveError', () => {
  const withFolder = { hasFolder: true };
  const noFolder = { hasFolder: false };

  it('should classify quota-exceeded 403 as quota, not rate limit', () => {
    // The distinction the whole blocking mechanism rests on: both arrive as 403.
    expect(classifyDriveError(nestedError(403, 'storageQuotaExceeded'), withFolder)).toBe(
      GoogleDriveUploadErrorClass.QuotaExceeded,
    );
  });

  it('should classify other 403s and 429s as rate-limited', () => {
    expect(classifyDriveError(nestedError(403, 'userRateLimitExceeded'), withFolder)).toBe(
      GoogleDriveUploadErrorClass.RateLimited,
    );
    expect(classifyDriveError(nestedError(403), withFolder)).toBe(GoogleDriveUploadErrorClass.RateLimited);
    expect(classifyDriveError(nestedError(429), withFolder)).toBe(GoogleDriveUploadErrorClass.RateLimited);
  });

  it('should classify a notFound 404 as the folder being gone — only when a folder is configured', () => {
    expect(classifyDriveError(nestedError(404, 'notFound'), withFolder)).toBe(
      GoogleDriveUploadErrorClass.FolderMissing,
    );
    // Uploads without a configured folder go to the Drive root; no 404 can mean "folder gone".
    expect(classifyDriveError(nestedError(404, 'notFound'), noFolder)).toBe(GoogleDriveUploadErrorClass.Unknown);
  });

  it('should NOT block the account for a bare 404 (expired resumable session)', () => {
    // The Wave 1 review's one real correctness risk: resumable uploads answer 404 for an
    // expired/invalid session URI — transient, nothing to do with the folder. Blocking the whole
    // account off that would be a false positive with the worst blast radius this system has.
    expect(classifyDriveError(nestedError(404), withFolder)).toBe(GoogleDriveUploadErrorClass.Unknown);
  });

  it('should classify folder-permission and folder-capacity 403s as folder problems', () => {
    // Same cure as folder-gone (pick a different folder), so same class. Without the reason
    // gating these were infinite-retry long-tails: re-attempted every backfill, never resolved.
    expect(classifyDriveError(nestedError(403, 'insufficientFilePermissions'), withFolder)).toBe(
      GoogleDriveUploadErrorClass.FolderMissing,
    );
    expect(classifyDriveError(nestedError(403, 'numChildrenInNonRootLimitExceeded'), withFolder)).toBe(
      GoogleDriveUploadErrorClass.FolderMissing,
    );
    // With no folder configured they fall back to retryable rather than blocking.
    expect(classifyDriveError(nestedError(403, 'insufficientFilePermissions'), noFolder)).toBe(
      GoogleDriveUploadErrorClass.RateLimited,
    );
  });

  it('should classify the dedicated size-mismatch error', () => {
    expect(classifyDriveError(new GoogleDriveSizeMismatchError('short'), withFolder)).toBe(
      GoogleDriveUploadErrorClass.SizeMismatch,
    );
  });

  it('should fall back to unknown', () => {
    expect(classifyDriveError(new Error('ECONNRESET'), withFolder)).toBe(GoogleDriveUploadErrorClass.Unknown);
    expect(classifyDriveError(nestedError(500), withFolder)).toBe(GoogleDriveUploadErrorClass.Unknown);
  });
});

describe('shouldRetryDriveRequest', () => {
  it('should retry transient statuses within the attempt budget', () => {
    expect(shouldRetryDriveRequest(withRetryConfig(nestedError(429), 0))).toBe(true);
    expect(shouldRetryDriveRequest(withRetryConfig(nestedError(503), 2))).toBe(true);
    expect(shouldRetryDriveRequest(withRetryConfig(nestedError(403, 'rateLimitExceeded'), 4))).toBe(true);
  });

  it('should stop once attempts are exhausted', () => {
    expect(shouldRetryDriveRequest(withRetryConfig(nestedError(429), 5))).toBe(false);
  });

  it('should fail a quota 403 immediately — retrying a full Drive is futile', () => {
    // Without this, every job in a large backfill burns five retries (~14s of backoff) to
    // rediscover the account is full.
    expect(shouldRetryDriveRequest(withRetryConfig(nestedError(403, 'storageQuotaExceeded'), 0))).toBe(false);
  });

  it('should fail a 404 immediately — the destination folder is gone', () => {
    expect(shouldRetryDriveRequest(withRetryConfig(nestedError(404), 0))).toBe(false);
  });

  it('should not retry non-retryable statuses or shapeless errors', () => {
    expect(shouldRetryDriveRequest(withRetryConfig(nestedError(400), 0))).toBe(false);
    expect(shouldRetryDriveRequest(withRetryConfig({}, 0))).toBe(false);
  });
});
