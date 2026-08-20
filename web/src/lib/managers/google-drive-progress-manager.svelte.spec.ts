import { getMyGoogleDriveStatus } from '@immich/sdk';
import { googleDriveProgressManager } from '$lib/managers/google-drive-progress-manager.svelte';

vi.mock('@immich/sdk', () => ({ getMyGoogleDriveStatus: vi.fn() }));

const status = (pending: number, over: Record<string, unknown> = {}) => ({
  pending,
  failed: 0,
  blockedReason: null,
  ...over,
});

const mocked = vi.mocked(getMyGoogleDriveStatus);

// Watchers are released in afterEach rather than at the end of each test: a failing assertion
// would otherwise skip the cleanup and leave a live timer polling into the *next* test, which
// silently overwrites its state. That contamination is exactly what a module singleton invites.
let watchers: (() => void)[] = [];
const startWatching = () => {
  const unwatch = googleDriveProgressManager.watch();
  watchers.push(unwatch);
  return unwatch;
};

// The manager is a module singleton (one poller shared by the corner card and the album menu), so
// each test has to put it back to a known state rather than construct a fresh one.
const reset = () => {
  mocked.mockReset();
  mocked.mockResolvedValue(status(0) as never);
  googleDriveProgressManager.pending = 0;
  googleDriveProgressManager.failed = 0;
  googleDriveProgressManager.blockedReason = null;
  googleDriveProgressManager.loaded = false;
  googleDriveProgressManager.userInitiated = false;
};

describe('googleDriveProgressManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reset();
  });

  afterEach(() => {
    for (const unwatch of watchers) {
      unwatch();
    }
    watchers = [];
    vi.useRealTimers();
  });

  it('should poll once immediately when the first watcher arrives', async () => {
    mocked.mockResolvedValue(status(5) as never);

    const unwatch = startWatching();
    await vi.waitFor(() => expect(googleDriveProgressManager.loaded).toBe(true));

    expect(mocked).toHaveBeenCalledTimes(1);
    expect(googleDriveProgressManager.pending).toBe(5);
    unwatch();
  });

  it('should keep a single timer no matter how many things are watching', async () => {
    // The corner card and the album menu both watch. Independent pollers would double the request
    // rate and could disagree on screen.
    mocked.mockResolvedValue(status(3) as never);

    const a = startWatching();
    const b = startWatching();
    await vi.waitFor(() => expect(mocked).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(3000);
    expect(mocked).toHaveBeenCalledTimes(2);

    a();
    b();
  });

  it('should stop polling once the last watcher leaves', async () => {
    mocked.mockResolvedValue(status(3) as never);

    const a = startWatching();
    const b = startWatching();
    await vi.waitFor(() => expect(mocked).toHaveBeenCalledTimes(1));

    a();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocked).toHaveBeenCalledTimes(2); // b is still watching

    b();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocked).toHaveBeenCalledTimes(2); // nobody left, so no further polls
  });

  it('should ease off when nothing is changing rather than polling hard forever', async () => {
    // The property worth protecting is that an idle tab stops asking every few seconds — not the
    // exact constants, which would make this a test of the numbers rather than the behaviour.
    mocked.mockResolvedValue(status(4) as never);
    startWatching();
    await vi.waitFor(() => expect(mocked).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(60_000);

    // At the fast cadence a minute would be ~20 polls. Backing off should keep it well under half
    // that, without pinning the assertion to a specific interval.
    expect(mocked.mock.calls.length).toBeLessThan(10);
  });

  it('should clear userInitiated when the work finishes', async () => {
    // The corner card keys off this flag; leaving it set would keep an empty card on screen.
    mocked.mockResolvedValue(status(0) as never);

    googleDriveProgressManager.markUserInitiated();
    await vi.waitFor(() => expect(googleDriveProgressManager.loaded).toBe(true));

    expect(googleDriveProgressManager.userInitiated).toBe(false);
  });

  it('should report a blocked account as paused, not syncing', async () => {
    // pending counts a paused account's work on purpose (Wave 2), which makes "pending > 0" a trap
    // for consumers. `status` is the single value they should branch on instead.
    mocked.mockResolvedValue(status(1800, { blockedReason: 'quota_exceeded' }) as never);

    startWatching();
    await vi.waitFor(() => expect(googleDriveProgressManager.loaded).toBe(true));

    expect(googleDriveProgressManager.pending).toBe(1800);
    expect(googleDriveProgressManager.status).toBe('paused');
    expect(googleDriveProgressManager.active).toBe(false);
  });

  it('should distinguish idle from syncing', async () => {
    mocked.mockResolvedValue(status(0) as never);
    startWatching();
    await vi.waitFor(() => expect(googleDriveProgressManager.loaded).toBe(true));
    expect(googleDriveProgressManager.status).toBe('idle');

    mocked.mockResolvedValue(status(12) as never);
    await googleDriveProgressManager.refresh();
    expect(googleDriveProgressManager.status).toBe('syncing');
  });

  it('should keep the last known numbers when a poll fails', async () => {
    // This runs on a timer in the background; a transient failure must not blank the display or
    // throw a toast at someone who isn't looking.
    mocked.mockResolvedValue(status(7) as never);
    const unwatch = startWatching();
    await vi.waitFor(() => expect(googleDriveProgressManager.pending).toBe(7));

    mocked.mockRejectedValue(new Error('network'));
    await vi.advanceTimersByTimeAsync(3000);

    expect(googleDriveProgressManager.pending).toBe(7);
    unwatch();
  });
});
