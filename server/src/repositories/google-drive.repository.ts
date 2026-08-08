import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { ChunkedSet, DummyValue, GenerateSql } from 'src/decorators';
import { AlbumUserRole } from 'src/enum';
import { DB } from 'src/schema';

/**
 * Thin data-access layer over the two tables this feature owns.
 *
 * `user_google_drive` holds per-user connection state (OAuth refresh token + chosen destination
 * folder). One row per connected user; no row means "this user hasn't linked Google Drive".
 *
 * `google_drive_upload` is our "upload ledger": one row per (userId, assetId) pair that has
 * successfully been uploaded to that user's Google Drive, plus the Drive-assigned file id. It
 * exists purely to answer one question cheaply: "has this asset already been uploaded for this
 * user?" — so that GoogleDriveService never uploads (and therefore duplicates) the same photo
 * twice, whether that's because it was added to two albums, removed and re-added to the same
 * album, or a background job retried after a transient failure.
 *
 * Following the same convention as the rest of Immich's repositories: this class only knows how
 * to read/write rows via Kysely (the query builder), it doesn't contain any business rules about
 * *when* an upload should happen — that decision-making lives in GoogleDriveService and
 * AlbumService.
 */
@Injectable()
export class GoogleDriveRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  /**
   * Returns a user's Google Drive connection, or undefined if they haven't linked one.
   *
   * This is deliberately the *only* way the refresh token is read. It used to live on the `user`
   * table, which meant every ordinary user lookup dragged the token along with it; keeping it
   * behind an explicit call like this one keeps the blast radius small.
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  getCredentials(userId: string) {
    return this.db
      .selectFrom('user_google_drive')
      .select(['userId', 'refreshToken', 'folderId', 'connectedAt'])
      .where('userId', '=', userId)
      .executeTakeFirst();
  }

  /**
   * Stores (or replaces) a user's refresh token when they complete the OAuth link flow.
   *
   * Upserts rather than inserts so that re-linking an already-connected account just swaps in the
   * new token instead of failing on the primary key. Note it deliberately does *not* touch
   * `folderId`: re-authorizing shouldn't silently reset a destination folder the user already
   * picked.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  upsertCredentials(userId: string, refreshToken: string) {
    return this.db
      .insertInto('user_google_drive')
      .values({ userId, refreshToken })
      .onConflict((oc) => oc.column('userId').doUpdateSet({ refreshToken }))
      .execute();
  }

  /**
   * Sets the destination folder for an already-connected user. Returns the number of rows matched
   * so the caller can tell "saved" apart from "this user isn't connected, there was nothing to
   * update" — an unconnected user silently having their folder preference dropped would be a
   * confusing failure mode.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  async setFolderId(userId: string, folderId: string | null): Promise<number> {
    const result = await this.db
      .updateTable('user_google_drive')
      .set({ folderId })
      .where('userId', '=', userId)
      .executeTakeFirst();

    return Number(result.numUpdatedRows);
  }

  /**
   * Disconnects a user's Google Drive by deleting their credentials row.
   *
   * Note this intentionally leaves the `google_drive_upload` ledger rows in place. If the user
   * reconnects the same Google account later, that history is what stops us from re-uploading
   * every asset they've already got in Drive and creating a duplicate of each one.
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  deleteCredentials(userId: string) {
    return this.db.deleteFrom('user_google_drive').where('userId', '=', userId).execute();
  }

  /**
   * Streams every (owner, asset) pair that *should* be in Google Drive but isn't yet — i.e. the
   * backlog the "queue all" admin job works through.
   *
   * An asset qualifies when all of these hold:
   *   - it sits in an album whose owner has linked Google Drive (uploads always target the album
   *     owner's account, never a contributor's — see AlbumService#getAlbumOwnerId);
   *   - the owner has no ledger row for it yet;
   *   - neither the asset nor its album has been soft-deleted.
   *
   * There is deliberately no "force" variant that drops the ledger anti-join. Dropping it would
   * only queue jobs the upload worker re-checks and skips anyway, so it could never re-upload
   * anything — and making it genuinely re-upload would mean ignoring the ledger, which is the sole
   * safeguard against duplicating every file in the user's Drive. Recovering from a Drive folder
   * that was emptied by hand therefore needs the ledger rows deleted first, which is an explicit
   * operation rather than a checkbox.
   *
   * DISTINCT matters here: the same asset can live in several albums owned by the same person, and
   * without it we'd stream (and queue) one job per album membership. The upload worker would
   * de-duplicate anyway via its own ledger check, but only after paying for the extra jobs.
   *
   * Streamed rather than collected because this is inherently unbounded — a large instance could
   * have hundreds of thousands of pending pairs, and the caller batches them into queue writes.
   */
  @GenerateSql({ params: [], stream: true })
  streamPendingUploads() {
    return this.db
      .selectFrom('album_asset')
      .innerJoin('album', 'album.id', 'album_asset.albumId')
      .innerJoin('album_user', 'album_user.albumId', 'album.id')
      .innerJoin('user_google_drive', 'user_google_drive.userId', 'album_user.userId')
      .innerJoin('asset', 'asset.id', 'album_asset.assetId')
      .leftJoin('google_drive_upload', (join) =>
        join
          .onRef('google_drive_upload.assetId', '=', 'album_asset.assetId')
          .onRef('google_drive_upload.userId', '=', 'album_user.userId'),
      )
      .where('album_user.role', '=', AlbumUserRole.Owner)
      .where('album.deletedAt', 'is', null)
      .where('asset.deletedAt', 'is', null)
      .where('google_drive_upload.assetId', 'is', null)
      .select(['album_user.userId as userId', 'album_asset.assetId as assetId'])
      .distinct()
      .stream();
  }

  /**
   * Given a user and a list of candidate asset ids, returns the subset that has already been
   * uploaded to that user's Drive (as a Set, for fast `.has()` membership checks by callers).
   *
   * Callers are expected to compute `assetIds.filter(id => !result.has(id))` afterwards to get
   * the assets that still need uploading — this method deliberately doesn't do that filtering
   * itself, so it stays a simple, reusable "what's already there" lookup.
   */
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  @ChunkedSet({ paramIndex: 1 })
  async getUploadedAssetIds(userId: string, assetIds: string[]): Promise<Set<string>> {
    // Guard against an empty IN (...) clause, which some SQL dialects/drivers handle
    // inconsistently — and it's also just a pointless round trip to the database when there's
    // nothing to look up.
    if (assetIds.length === 0) {
      return new Set();
    }

    const rows = await this.db
      .selectFrom('google_drive_upload')
      .select('assetId')
      .where('userId', '=', userId)
      .where('assetId', 'in', assetIds)
      .execute();

    return new Set(rows.map((row) => row.assetId));
  }

  /**
   * Records that `assetId` has been uploaded to `userId`'s Drive as the file identified by
   * `driveFileId`. Called by GoogleDriveService#uploadAsset right after a successful upload to
   * Google's API, so that future calls to getUploadedAssetIds() above will recognize this asset
   * as already synced and skip it.
   *
   * Uses an upsert (`onConflict ... doUpdateSet`) rather than a plain insert: in the rare case
   * this ever gets called twice for the same (userId, assetId) — e.g. a retried job racing with
   * itself — we simply overwrite the recorded driveFileId with the latest one instead of
   * throwing a duplicate-key error. The (userId, assetId) pair is the table's primary key (see
   * the GoogleDriveUploadTable schema definition), which is what makes this upsert possible.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, DummyValue.STRING] })
  recordUpload(userId: string, assetId: string, driveFileId: string) {
    return this.db
      .insertInto('google_drive_upload')
      .values({ userId, assetId, driveFileId })
      .onConflict((oc) =>
        oc.columns(['userId', 'assetId']).doUpdateSet({ driveFileId: (eb) => eb.ref('excluded.driveFileId') }),
      )
      .execute();
  }
}
