import { JobName } from 'src/enum';
import { GoogleDriveRepository } from 'src/repositories/google-drive.repository';
import { JobRepository } from 'src/repositories/job.repository';

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
