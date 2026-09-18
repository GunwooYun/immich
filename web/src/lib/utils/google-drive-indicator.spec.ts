import { getGoogleDriveIndicator } from '$lib/utils/google-drive-indicator';

describe('getGoogleDriveIndicator', () => {
  const base = {
    backedUp: true,
    connected: true,
    uploaded: 10,
    total: 10,
    failed: 0,
    blockedReason: null as string | null,
  };

  it('shows nothing for an album that is not backed up, even when the account is blocked', () => {
    // A blocked account is a fact about the user, not this album. Painting it on albums the user
    // never chose to back up would put a warning dot on every album in the library.
    expect(getGoogleDriveIndicator({ ...base, backedUp: false })).toBeNull();
    expect(getGoogleDriveIndicator({ ...base, backedUp: false, blockedReason: 'quota_exceeded' })).toBeNull();
  });

  it('reports synced when every asset in the album is uploaded', () => {
    expect(getGoogleDriveIndicator(base)).toBe('synced');
  });

  it('reports syncing while the album still has a backlog', () => {
    expect(getGoogleDriveIndicator({ ...base, uploaded: 3 })).toBe('syncing');
  });

  it('never reports a negative backlog as syncing', () => {
    // uploaded can exceed total when assets were removed from the album after upload — the ledger
    // keeps them. That is "done", not "syncing".
    expect(getGoogleDriveIndicator({ ...base, uploaded: 12 })).toBe('synced');
  });

  it('reports disconnected for a backed-up album with no Drive connection, over every other state', () => {
    // wave9a review C1: a revocation deletes the connection but keeps the album selected, and is
    // not a blocking class, so without this the dot read "backing up" while nothing could upload.
    expect(getGoogleDriveIndicator({ ...base, connected: false, uploaded: 3 })).toBe('disconnected');
    expect(getGoogleDriveIndicator({ ...base, connected: false })).toBe('disconnected');
    expect(getGoogleDriveIndicator({ ...base, connected: false, blockedReason: 'quota_exceeded' })).toBe(
      'disconnected',
    );
  });

  it('still shows nothing for an album that is not backed up when disconnected', () => {
    expect(getGoogleDriveIndicator({ ...base, backedUp: false, connected: false })).toBeNull();
  });

  it('reports failing when the whole remaining backlog has already failed', () => {
    // The case that prompted this (wave9c review N4): an asset whose original is gone from disk
    // can never upload, and the album read "backing up" for ever.
    expect(getGoogleDriveIndicator({ ...base, uploaded: 9, failed: 1 })).toBe('failing');
    expect(getGoogleDriveIndicator({ ...base, uploaded: 7, failed: 5 })).toBe('failing');
  });

  it('still reports syncing while some of the backlog can still succeed', () => {
    // One stuck asset among many in flight: "backing up" is the more useful summary, and the
    // failure is visible in the progress card.
    expect(getGoogleDriveIndicator({ ...base, uploaded: 3, failed: 1 })).toBe('syncing');
  });

  it('does not report failing once everything is uploaded', () => {
    // Stale error rows can outlive a successful retry; a finished album is finished.
    expect(getGoogleDriveIndicator({ ...base, uploaded: 10, total: 10, failed: 2 })).toBe('synced');
  });

  it('lets a blocked account win over both synced and syncing', () => {
    expect(getGoogleDriveIndicator({ ...base, blockedReason: 'folder_missing' })).toBe('blocked');
    expect(getGoogleDriveIndicator({ ...base, uploaded: 3, blockedReason: 'quota_exceeded' })).toBe('blocked');
  });
});
