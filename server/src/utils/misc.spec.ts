import { SystemConfig } from 'src/config';
import {
  getGoogleDriveRedirectUrl,
  getKeysDeep,
  globToSqlPattern,
  isGoogleDriveEnabled,
  unsetDeep,
} from 'src/utils/misc';
import { describe, expect, it } from 'vitest';

describe('getKeysDeep', () => {
  it('should handle an empty object', () => {
    expect(getKeysDeep({})).toEqual([]);
  });

  it('should list properties', () => {
    expect(
      getKeysDeep({
        foo: 'bar',
        flag: true,
        count: 42,
        date: new Date(),
      }),
    ).toEqual(['foo', 'flag', 'count', 'date']);
  });

  it('should skip undefined properties', () => {
    expect(getKeysDeep({ foo: 'bar', hello: undefined })).toEqual(['foo']);
  });

  it('should skip array indices', () => {
    expect(getKeysDeep({ foo: 'bar', hello: ['foo', 'bar'] })).toEqual(['foo', 'hello']);
    expect(getKeysDeep({ foo: 'bar', nested: { hello: ['foo', 'bar'] } })).toEqual(['foo', 'nested.hello']);
  });

  it('should list nested properties', () => {
    expect(getKeysDeep({ foo: 'bar', hello: { world: true } })).toEqual(['foo', 'hello.world']);
  });
});

describe('unsetDeep', () => {
  it('should remove a property', () => {
    expect(unsetDeep({ hello: 'world', foo: 'bar' }, 'foo')).toEqual({ hello: 'world' });
  });

  it('should remove the last property', () => {
    expect(unsetDeep({ foo: 'bar' }, 'foo')).toBeUndefined();
  });

  it('should remove a nested property', () => {
    expect(unsetDeep({ foo: 'bar', nested: { enabled: true, count: 42 } }, 'nested.enabled')).toEqual({
      foo: 'bar',
      nested: { count: 42 },
    });
  });

  it('should clean up an empty property', () => {
    expect(unsetDeep({ foo: 'bar', nested: { enabled: true } }, 'nested.enabled')).toEqual({ foo: 'bar' });
  });
});

// Only the fields these two helpers actually read, so each test says what it depends on.
const googleDriveConfig = (overrides: Partial<SystemConfig['googleDrive']> = {}) =>
  ({
    enabled: true,
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUrl: '',
    apiKey: '',
    ...overrides,
  }) as SystemConfig['googleDrive'];
const serverConfig = (externalDomain: string) => ({ externalDomain }) as SystemConfig['server'];

/**
 * The redirect URL is the one value in this feature that Google validates byte-for-byte, and it is
 * now usually *derived* rather than typed. These tests pin both directions of that: what gets
 * derived, and — just as important — that "nothing to derive from" leaves the feature switched off
 * rather than producing a plausible-but-wrong URL.
 */
describe('getGoogleDriveRedirectUrl', () => {
  const server = serverConfig;

  it('should use the explicit redirect URL when set', () => {
    // The override exists for deployments where the API is reached at a different address than the
    // external domain (a dev container serves the API on :2283, the web dev server on :3000).
    expect(
      getGoogleDriveRedirectUrl(
        googleDriveConfig({ redirectUrl: 'http://localhost:2283/api/google-drive/callback' }),
        server('https://immich.example.com'),
      ),
    ).toBe('http://localhost:2283/api/google-drive/callback');
  });

  it('should derive from the external domain when no redirect URL is set', () => {
    expect(getGoogleDriveRedirectUrl(googleDriveConfig(), server('https://immich.example.com'))).toBe(
      'https://immich.example.com/api/google-drive/callback',
    );
  });

  it('should not produce a double slash from a trailing slash', () => {
    // buildConfig normalizes externalDomain to an origin, but a hand-edited config row could still
    // carry one — and Google matches redirect URIs as strings, so '//api' would simply never match.
    expect(getGoogleDriveRedirectUrl(googleDriveConfig(), server('https://immich.example.com/'))).toBe(
      'https://immich.example.com/api/google-drive/callback',
    );
  });

  it('should return nothing when there is neither an override nor an external domain', () => {
    expect(getGoogleDriveRedirectUrl(googleDriveConfig(), server(''))).toBe('');
  });
});

describe('isGoogleDriveEnabled', () => {
  const googleDrive = googleDriveConfig;
  const server = serverConfig;

  it('should be enabled with credentials and a derivable redirect URL', () => {
    // The zero-typing case: credentials from the environment, redirect derived from the external
    // domain, nobody has touched the form.
    expect(isGoogleDriveEnabled(googleDrive(), server('https://immich.example.com'))).toBe(true);
  });

  it('should be enabled with credentials and an explicit redirect URL', () => {
    expect(
      isGoogleDriveEnabled(googleDrive({ redirectUrl: 'http://localhost:2283/api/google-drive/callback' }), server('')),
    ).toBe(true);
  });

  it('should be disabled — not throwing — when there is no redirect URL and nothing to derive one from', () => {
    // Asserted for the *right* reason (CLAUDE.md §4): the credentials are present and the switch is
    // on, so a false here can only come from the redirect URL being underivable.
    const config = googleDrive();
    expect(config.enabled && !!config.clientId && !!config.clientSecret).toBe(true);
    expect(getGoogleDriveRedirectUrl(config, server(''))).toBe('');
    expect(isGoogleDriveEnabled(config, server(''))).toBe(false);
  });

  it.each([
    { field: 'enabled', overrides: { enabled: false } },
    { field: 'clientId', overrides: { clientId: '' } },
    { field: 'clientSecret', overrides: { clientSecret: '' } },
  ])('should be disabled when $field is missing, even with a derivable redirect URL', ({ overrides }) => {
    const config = googleDrive(overrides);
    // Again: prove the redirect URL is *not* what failed, so the case can't pass vacuously.
    expect(getGoogleDriveRedirectUrl(config, server('https://immich.example.com'))).not.toBe('');
    expect(isGoogleDriveEnabled(config, server('https://immich.example.com'))).toBe(false);
  });
});

describe('globToSqlPattern', () => {
  const testCases = [
    ['**/Raw/**', '%/Raw/%'],
    ['**/abc/*.tif', '%/abc/%.tif'],
    ['**/*.tif', '%/%.tif'],
    ['**/*.jp?', '%/%.jp_'],
    ['**/@eaDir/**', '%/@eaDir/%'],
    ['**/._*', `%/._%`],
    ['/absolute/path/**', `/absolute/path/%`],
  ];

  it.each(testCases)('should convert %s to %s', (input, expected) => {
    expect(globToSqlPattern(input)).toEqual(expected);
  });
});
