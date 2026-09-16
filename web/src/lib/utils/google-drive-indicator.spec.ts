import { getGoogleDriveIndicator } from '$lib/utils/google-drive-indicator';

describe('getGoogleDriveIndicator', () => {
  const base = { backedUp: true, uploaded: 10, total: 10, blockedReason: null as string | null };

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

  it('lets a blocked account win over both synced and syncing', () => {
    expect(getGoogleDriveIndicator({ ...base, blockedReason: 'folder_missing' })).toBe('blocked');
    expect(getGoogleDriveIndicator({ ...base, uploaded: 3, blockedReason: 'quota_exceeded' })).toBe('blocked');
  });
});
