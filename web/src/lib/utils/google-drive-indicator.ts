/**
 * What the album toolbar's Google Drive icon should say about this album without being opened.
 *
 * Before this, the icon looked identical on every album: whether an album was backed up, still
 * uploading, or silently paused on a full Drive was only discoverable by opening each album's menu
 * one by one. The indicator is a small dot on the icon, so it has to collapse the state into one
 * answer — and the order of the checks below is that priority.
 *
 * - `disconnected` beats everything else: a backed-up album whose owner has no Drive connection
 *   (disconnected, or the grant was revoked — which deletes only the connection, not the album
 *   selection) uploads nothing at all. Reading "backing up" there was wave9a review C1.
 * - `failing` means the album's whole remaining backlog has already failed — most often an asset
 *   whose original is gone from disk, which will never upload no matter how long you wait. Before
 *   this the dot sat on "backing up" forever in exactly that case (wave9c review N4).
 * - `blocked` comes next: an account-level pause (quota, missing folder) means *nothing* is
 *   uploading, and an album that looks "syncing" or "done" while that is true is the exact
 *   silent-failure this exists to surface.
 * - Albums that are not backed up get no dot at all. That is the common case, and a dot on every
 *   album saying "not backed up" would be noise that trains people to ignore the dot.
 * - `syncing` vs `synced` is only the album's own backlog (`total - uploaded`), not the user-wide
 *   pending count — same scoping rule as the menu's sync row.
 */
export type GoogleDriveIndicator = 'disconnected' | 'blocked' | 'failing' | 'syncing' | 'synced' | null;

export const getGoogleDriveIndicator = ({
  backedUp,
  connected,
  uploaded,
  total,
  failed,
  blockedReason,
}: {
  backedUp: boolean;
  connected: boolean;
  uploaded: number;
  total: number;
  failed: number;
  blockedReason: string | null;
}): GoogleDriveIndicator => {
  if (!backedUp) {
    return null;
  }
  if (!connected) {
    return 'disconnected';
  }
  if (blockedReason) {
    return 'blocked';
  }
  const pending = total - uploaded;
  if (pending <= 0) {
    return 'synced';
  }
  // Only when *everything* left has failed. With one stuck asset among a hundred still uploading,
  // "backing up" is the more useful thing to say; the failure surfaces in the progress card.
  return failed >= pending ? 'failing' : 'syncing';
};

/**
 * The menu's storage threshold for warning *before* starting a sync, shared with the bar colour so
 * "red bar" and "sync row warns" can never disagree. Presentational only: the server has no such
 * threshold and still learns Drive is full from Google's own 403 (see GoogleDriveAlbumMenu).
 */
export const GOOGLE_DRIVE_STORAGE_CRITICAL_RATIO = 0.95;
export const GOOGLE_DRIVE_STORAGE_WARNING_RATIO = 0.8;
