import { getMyGoogleDriveUploadedAssets } from '@immich/sdk';
import { googleDriveUploadedManager as manager } from '$lib/managers/google-drive-uploaded-manager.svelte';

vi.mock('@immich/sdk', () => ({ getMyGoogleDriveUploadedAssets: vi.fn() }));

const lookup = vi.mocked(getMyGoogleDriveUploadedAssets);

describe('googleDriveUploadedManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lookup.mockReset();
  });

  afterEach(() => {
    // Module singleton: reset here, not at the end of a test body, so a failing assertion cannot
    // leak state into the next test.
    manager.reset();
    vi.useRealTimers();
  });

  it('batches requests from several render passes into one lookup', async () => {
    lookup.mockResolvedValue({ assetIds: ['a'] });

    manager.request(['a', 'b']);
    manager.request(['c']);
    await vi.runAllTimersAsync();

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0][0].googleDriveUploadedLookupDto.assetIds).toEqual(['a', 'b', 'c']);
    expect(manager.has('a')).toBe(true);
    expect(manager.has('b')).toBe(false);
  });

  it('does not ask again about an asset already known to be uploaded', async () => {
    lookup.mockResolvedValue({ assetIds: ['a'] });
    manager.request(['a']);
    await vi.runAllTimersAsync();

    manager.request(['a'], Date.now() + 10 * 60_000);
    await vi.runAllTimersAsync();

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('re-asks about a not-uploaded asset only after the re-ask window', async () => {
    // The background queue may upload it a minute later; asking again on every scroll would not
    // be worth the traffic, never asking again would leave the badge missing all session.
    lookup.mockResolvedValue({ assetIds: [] });
    const t0 = Date.now();
    manager.request(['b'], t0);
    await vi.runAllTimersAsync();

    manager.request(['b'], t0 + 1000);
    await vi.runAllTimersAsync();
    expect(lookup).toHaveBeenCalledTimes(1);

    manager.request(['b'], t0 + 61_000);
    await vi.runAllTimersAsync();
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('splits more than 1000 ids into server-sized batches', async () => {
    lookup.mockResolvedValue({ assetIds: [] });
    manager.request(Array.from({ length: 2500 }, (_, index) => `id-${index}`));
    await vi.runAllTimersAsync();

    expect(lookup.mock.calls.map((call) => call[0].googleDriveUploadedLookupDto.assetIds.length)).toEqual([
      1000, 1000, 500,
    ]);
  });

  it('forgets a failed lookup so the next pass retries it', async () => {
    lookup.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ assetIds: ['a'] });
    manager.request(['a']);
    await vi.runAllTimersAsync();
    expect(manager.has('a')).toBe(false);

    manager.request(['a']);
    await vi.runAllTimersAsync();

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(manager.has('a')).toBe(true);
  });
});
