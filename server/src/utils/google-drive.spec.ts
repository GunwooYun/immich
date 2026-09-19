import { SystemConfig } from 'src/config';
import { GoogleDriveUploadErrorClass } from 'src/enum';
import {
  classifyDriveError,
  getDriveErrorReason,
  GoogleDriveSizeMismatchError,
  hasGoogleDriveFileScope,
  isGoogleDriveLoginGrantEnabled,
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

describe('hasGoogleDriveFileScope', () => {
  it('should find the scope in a normal space-delimited list', () => {
    expect(hasGoogleDriveFileScope('openid email https://www.googleapis.com/auth/drive.file')).toBe(true);
  });

  it('should tolerate the irregular whitespace a hand-typed scope list picks up', () => {
    expect(hasGoogleDriveFileScope('openid\n  email\thttps://www.googleapis.com/auth/drive.file  ')).toBe(true);
  });

  it('should not match a different drive scope that merely starts the same way', () => {
    // 'drive.file' is a prefix of nothing, but 'drive' is a prefix of it — a substring test here
    // would accept the broad 'auth/drive' grant, and more importantly reject nothing when the
    // operator asked for drive.appdata. Whole-token matching is the only honest check.
    expect(hasGoogleDriveFileScope('openid https://www.googleapis.com/auth/drive.appdata')).toBe(false);
    expect(hasGoogleDriveFileScope('openid https://www.googleapis.com/auth/drive.file.readonly')).toBe(false);
  });

  it('should be false when there is no scope at all', () => {
    expect(hasGoogleDriveFileScope(undefined)).toBe(false);
    expect(hasGoogleDriveFileScope('')).toBe(false);
  });
});

/** A config where every clause of the gate holds; `over` breaks exactly one of them. */
const allTrue = (
  over: {
    oauth?: Partial<SystemConfig['oauth']>;
    googleDrive?: Partial<SystemConfig['googleDrive']>;
    server?: Partial<SystemConfig['server']>;
  } = {},
): SystemConfig =>
  ({
    oauth: {
      enabled: true,
      issuerUrl: 'https://accounts.google.com',
      clientId: 'shared-client-id',
      clientSecret: 'shared-client-secret',
      scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
      prompt: '',
      ...over.oauth,
    },
    googleDrive: {
      clientId: 'shared-client-id',
      clientSecret: 'shared-client-secret',
      redirectUrl: 'https://immich.example.com/api/google-drive/callback',
      apiKey: '',
      ...over.googleDrive,
    },
    server: { externalDomain: '', ...over.server },
  }) as SystemConfig;

/**
 * Every test starts from a config where the gate holds, then breaks exactly one clause. Written
 * this way on purpose: a suite that built each case from scratch could pass while a clause was
 * silently unreachable, and the whole value of this predicate is that *each* clause can veto.
 */
describe('isGoogleDriveLoginGrantEnabled', () => {
  it('should hold when every clause is satisfied', () => {
    expect(isGoogleDriveLoginGrantEnabled(allTrue())).toBe(true);
  });

  it('should be false when OAuth login is disabled', () => {
    expect(isGoogleDriveLoginGrantEnabled(allTrue({ oauth: { enabled: false } }))).toBe(false);
  });

  it('should be false for an issuer that is not Google', () => {
    // A refresh token from Authentik or Keycloak is not something the Drive API will ever accept,
    // so storing it as a connection would produce a user who looks connected and never uploads.
    expect(isGoogleDriveLoginGrantEnabled(allTrue({ oauth: { issuerUrl: 'https://auth.example.com' } }))).toBe(false);
  });

  it.each([
    'https://accounts.google.com/',
    'https://accounts.google.com///',
    'HTTPS://Accounts.Google.COM',
    '  https://accounts.google.com  ',
    'https://accounts.google.com/.well-known/openid-configuration',
    'https://accounts.google.com/.well-known/openid-configuration/',
  ])('should recognise Google written as %s', (issuerUrl) => {
    // All of these are spellings openid-client itself accepts, so an admin who used one of them
    // has a working Google login — the gate must not disagree with the thing doing the discovery.
    expect(isGoogleDriveLoginGrantEnabled(allTrue({ oauth: { issuerUrl } }))).toBe(true);
  });

  it('should not be fooled by a host that merely ends in the Google issuer', () => {
    expect(
      isGoogleDriveLoginGrantEnabled(allTrue({ oauth: { issuerUrl: 'https://evil.com/https://accounts.google.com' } })),
    ).toBe(false);
  });

  it('should be false when the login client is not the Drive client', () => {
    // The refresh token is bound to the client that minted it. A token from a different client is
    // stored as "connected" and then fails every refresh with unauthorized_client.
    expect(isGoogleDriveLoginGrantEnabled(allTrue({ oauth: { clientId: 'some-other-client' } }))).toBe(false);
  });

  it('should be false when both client ids are empty rather than treating that as a match', () => {
    // '' === '' is true, which is exactly the trap: an unconfigured Drive feature would otherwise
    // satisfy the equality clause and lean entirely on the last clause to save it.
    expect(isGoogleDriveLoginGrantEnabled(allTrue({ oauth: { clientId: '' }, googleDrive: { clientId: '' } }))).toBe(
      false,
    );
  });

  it('should be false when the login scope does not ask for drive.file', () => {
    // This is the opt-in. No scope means users never saw a Drive consent screen, and asking for
    // offline access on their behalf would be a change the operator did not make.
    expect(isGoogleDriveLoginGrantEnabled(allTrue({ oauth: { scope: 'openid email profile' } }))).toBe(false);
  });

  it('should be false when the login secret is not the Drive secret', () => {
    // wave9d review N2, and the worst of the mismatches: refreshing an upload token uses the Drive
    // secret alone, and the probe that follows a link swallows its failure and stores the row
    // anyway — so a token minted under another secret looks connected and then fails every
    // refresh with invalid_client, which never clears the connection.
    expect(isGoogleDriveLoginGrantEnabled(allTrue({ oauth: { clientSecret: 'a-different-secret' } }))).toBe(false);
    expect(isGoogleDriveLoginGrantEnabled(allTrue({ googleDrive: { clientSecret: '' } }))).toBe(false);
  });

  it('should be false when every login is forced through a fresh consent', () => {
    // wave9d review N1: prompt=consent mints a refresh token on every login. Only the first is
    // ever used, and Google invalidates the oldest once 100 are outstanding for an account — so
    // the churn would eventually kill the token the upload worker is refreshing with.
    expect(isGoogleDriveLoginGrantEnabled(allTrue({ oauth: { prompt: 'consent' } }))).toBe(false);
    expect(isGoogleDriveLoginGrantEnabled(allTrue({ oauth: { prompt: 'select_account consent' } }))).toBe(false);
    // Commas are not OIDC's delimiter, but they are a common mis-spelling and we would rather the
    // clause hold than open on a typo (wave9e review N4).
    expect(isGoogleDriveLoginGrantEnabled(allTrue({ oauth: { prompt: 'consent,select_account' } }))).toBe(false);
    // Other prompt values are none of this feature's business.
    expect(isGoogleDriveLoginGrantEnabled(allTrue({ oauth: { prompt: 'select_account' } }))).toBe(true);
  });

  it('should be false when the Drive feature itself is unusable', () => {
    // No client secret and no derivable redirect URL: there is nowhere for the token to go, and
    // isGoogleDriveEnabled is the single place that decides this for the whole feature.
    expect(isGoogleDriveLoginGrantEnabled(allTrue({ googleDrive: { clientSecret: '', redirectUrl: '' } }))).toBe(false);
  });

  it('should be false when only the redirect URL cannot be derived', () => {
    expect(isGoogleDriveLoginGrantEnabled(allTrue({ googleDrive: { redirectUrl: '' } }))).toBe(false);
    // ...and true again as soon as the external domain supplies one, so the clause above failed
    // for the redirect URL and not for some other reason.
    expect(
      isGoogleDriveLoginGrantEnabled(
        allTrue({ googleDrive: { redirectUrl: '' }, server: { externalDomain: 'https://immich.example.com' } }),
      ),
    ).toBe(true);
  });
});
