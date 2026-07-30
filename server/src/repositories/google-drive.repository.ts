import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { DB } from 'src/schema';

/**
 * Thin data-access layer over the `google_drive_upload` table.
 *
 * This table is our "upload ledger": one row per (userId, assetId) pair that has successfully
 * been uploaded to that user's Google Drive, plus the Drive-assigned file id. It exists purely
 * to answer one question cheaply: "has this asset already been uploaded for this user?" — so
 * that GoogleDriveService never uploads (and therefore duplicates) the same photo twice, whether
 * that's because it was added to two albums, removed and re-added to the same album, or a
 * background job retried after a transient failure.
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
   * Given a user and a list of candidate asset ids, returns the subset that has already been
   * uploaded to that user's Drive (as a Set, for fast `.has()` membership checks by callers).
   *
   * Callers are expected to compute `assetIds.filter(id => !result.has(id))` afterwards to get
   * the assets that still need uploading — this method deliberately doesn't do that filtering
   * itself, so it stays a simple, reusable "what's already there" lookup.
   */
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
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
