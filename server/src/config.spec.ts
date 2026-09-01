import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The Google Drive credentials identify *this deployment's* Google Cloud app, so an operator can
 * supply them once in the environment and no admin ever has to paste them into a form. That works
 * by reading them into the config `defaults` object — the same shape `machineLearning` uses — which
 * has a consequence worth pinning down: `defaults` is built when the module is first evaluated, so
 * these tests must stub the environment and then re-import, not rely on the static import at the
 * top of a spec file (which would already have been evaluated with the real environment).
 *
 * What the *rest* of the arrangement guarantees — that a value saved in the admin UI still wins,
 * and that saving an untouched form doesn't freeze the environment's values into the database —
 * lives in system-config.service.spec.ts, because it is a property of updateConfig, not of these
 * defaults.
 */
// Re-imports the module so its `defaults` object is rebuilt against whatever the environment
// currently says. Relative rather than the usual 'src/...' alias: this file sits next to the module
// it re-imports, and a dynamic specifier is resolved without the path mapping.
const loadDefaults = async () => {
  vi.resetModules();
  const { defaults } = await import('./config.js');
  return defaults;
};

describe('defaults.googleDrive', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('should take the credentials from the environment', async () => {
    vi.stubEnv('IMMICH_GOOGLE_DRIVE_CLIENT_ID', 'env-client-id');
    vi.stubEnv('IMMICH_GOOGLE_DRIVE_CLIENT_SECRET', 'env-client-secret');
    vi.stubEnv('IMMICH_GOOGLE_DRIVE_API_KEY', 'env-api-key');

    const defaults = await loadDefaults();

    expect(defaults.googleDrive.clientId).toBe('env-client-id');
    expect(defaults.googleDrive.clientSecret).toBe('env-client-secret');
    expect(defaults.googleDrive.apiKey).toBe('env-api-key');
  });

  // This unassuming negative is the test that keeps the whole file honest, which is worth saying
  // because it reads like the throwaway one. It runs *after* a test that stubbed real values, so it
  // only passes if the module was genuinely re-evaluated in between — i.e. it is the assertion that
  // proves vi.resetModules() is working. The test above it is not: running first, its own dynamic
  // import evaluates the module fresh under its own stubs whether or not the reset happens. So do
  // not "simplify" the resetModules() call in afterEach away; this is what it is holding up.
  it('should leave the credentials empty when the environment does not set them', async () => {
    vi.stubEnv('IMMICH_GOOGLE_DRIVE_CLIENT_ID', undefined);
    vi.stubEnv('IMMICH_GOOGLE_DRIVE_CLIENT_SECRET', undefined);
    vi.stubEnv('IMMICH_GOOGLE_DRIVE_API_KEY', undefined);

    const defaults = await loadDefaults();

    expect(defaults.googleDrive.clientId).toBe('');
    expect(defaults.googleDrive.clientSecret).toBe('');
    expect(defaults.googleDrive.apiKey).toBe('');
  });

  it('should keep the feature off and the redirect URL underivable by default', async () => {
    // Credentials in the environment must not switch the feature on by themselves: enabling it is
    // an explicit admin decision, and the redirect URL comes from the External Domain setting
    // rather than from any environment variable of its own.
    vi.stubEnv('IMMICH_GOOGLE_DRIVE_CLIENT_ID', 'env-client-id');
    vi.stubEnv('IMMICH_GOOGLE_DRIVE_CLIENT_SECRET', 'env-client-secret');

    const defaults = await loadDefaults();

    expect(defaults.googleDrive.enabled).toBe(false);
    expect(defaults.googleDrive.redirectUrl).toBe('');
  });
});
