import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { ChunkedSet, DummyValue, GenerateSql } from 'src/decorators';
import { AlbumUserRole, GOOGLE_DRIVE_BLOCKING_ERROR_CLASSES, GoogleDriveUploadErrorClass } from 'src/enum';
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
      .select(['userId', 'refreshToken', 'folderId', 'folderName', 'connectedAt'])
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
   *
   * `folderName` is written alongside the id in the same statement rather than as a follow-up
   * update, so the two can never disagree — a row showing one folder's name and another's id would
   * be worse than showing no name at all. Callers that only have an id (the manual paste-an-id
   * path) pass null for the name.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING, DummyValue.STRING] })
  async setFolderId(userId: string, folderId: string | null, folderName: string | null): Promise<number> {
    const result = await this.db
      .updateTable('user_google_drive')
      .set({ folderId, folderName })
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
  streamPendingUploads(userId?: string) {
    return (
      this.db
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
        // Skip users whose uploads are guaranteed to fail (Drive full, destination folder gone).
        // Account-level state, so the exclusion is per *user*, not per asset: queueing their
        // pending set would only produce jobs the worker's entry gate skips one by one anyway —
        // this keeps them out of the queue entirely until the block is cleared.
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom('google_drive_upload_error')
                .select(sql`1`.as('one'))
                .whereRef('google_drive_upload_error.userId', '=', 'album_user.userId')
                .where('google_drive_upload_error.error', 'in', [...GOOGLE_DRIVE_BLOCKING_ERROR_CLASSES]),
            ),
          ),
        )
        // The resume path re-queues one user's pending set right after their block is cleared —
        // same query, scoped. Undefined (the backfill) means everyone.
        .$if(userId !== undefined, (qb) => qb.where('album_user.userId', '=', userId!))
        .select(['album_user.userId as userId', 'album_asset.assetId as assetId'])
        .distinct()
        .stream()
    );
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
   * The single-asset version of getUploadedAssetIds: "has this one asset already gone to this
   * user's Drive?"
   *
   * The upload job handler asks exactly this question once per asset, and used to do it by calling
   * getUploadedAssetIds(userId, [assetId]) and then .has()-ing the one-element Set back out. That
   * worked, but it dragged the whole batch machinery along for a single row — the @ChunkedSet
   * wrapper, building a Set, an `assetId in (...)` clause with one value — and read as if a batch
   * were being processed. A dedicated `select ... limit 1` returning a boolean says what it means
   * and lets Postgres stop at the first matching row.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async hasUpload(userId: string, assetId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('google_drive_upload')
      .select('assetId')
      .where('userId', '=', userId)
      .where('assetId', '=', assetId)
      .limit(1)
      .executeTakeFirst();

    return !!row;
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
  recordUpload(userId: string, assetId: string, driveFileId: string) {
    // One transaction for the ledger write *and* the error-row delete. These are the two halves
    // of "this asset is now safely in Drive", and doing them separately leaves a crash window
    // where an asset has both a success row and a failure row — the UI would show an uploaded
    // photo as failed. Readers still treat the ledger as authoritative if both somehow exist
    // (belt), but the transaction stops the state from arising in the first place (suspenders).
    // (No @GenerateSql here: the extractor doesn't follow transactions, and the two statements
    // are individually trivial.)
    return this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('google_drive_upload')
        .values({ userId, assetId, driveFileId })
        .onConflict((oc) =>
          oc.columns(['userId', 'assetId']).doUpdateSet({ driveFileId: (eb) => eb.ref('excluded.driveFileId') }),
        )
        .execute();
      await trx
        .deleteFrom('google_drive_upload_error')
        .where('userId', '=', userId)
        .where('assetId', '=', assetId)
        .execute();
    });
  }

  /**
   * Records (or bumps) a failure for one (user, asset) pair, and reports whether this failure is
   * the *first appearance of this classification for this user* — the signal the caller uses to
   * fire a one-time notification ("your Drive is full") without repeating it for every subsequent
   * asset that fails the same way.
   *
   * Everything happens in a single statement so the answer is consistent with the write:
   *   - `others` counts rows of this class for the user *excluding* this asset, evaluated on the
   *     pre-statement snapshot;
   *   - `old_row` remembers what class this asset's row had before, if any;
   *   - the upsert then inserts or updates (bumping `attempts`, refreshing `lastFailedAt`);
   *   - firstOfClass = no other row had the class AND this row didn't already have it.
   *
   * Two workers failing different assets at the same instant can still both see firstOfClass —
   * their statements run on snapshots that don't include each other's uncommitted insert. That
   * residual window (≤ queue concurrency, a few ms wide, once per class transition) can at worst
   * duplicate a notification; accepted per the roadmap review rather than paying for an advisory
   * lock on every failure.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, DummyValue.STRING, DummyValue.STRING] })
  async upsertError(
    userId: string,
    assetId: string,
    error: GoogleDriveUploadErrorClass,
    detail: string | null,
  ): Promise<{ firstOfClass: boolean }> {
    // Detail is display-only; truncate so a huge upstream message can't bloat the row.
    const truncatedDetail = detail ? detail.slice(0, 512) : null;

    const { rows } = await sql<{ firstOfClass: boolean }>`
      with
        "others" as (
          select count(*)::int as "c"
          from "google_drive_upload_error"
          where "userId" = ${userId} and "error" = ${error} and "assetId" <> ${assetId}
        ),
        "old_row" as (
          select "error" from "google_drive_upload_error"
          where "userId" = ${userId} and "assetId" = ${assetId}
        ),
        "ins" as (
          insert into "google_drive_upload_error" ("userId", "assetId", "error", "detail")
          values (${userId}, ${assetId}, ${error}, ${truncatedDetail})
          on conflict ("userId", "assetId") do update set
            "error" = excluded."error",
            "detail" = excluded."detail",
            "attempts" = "google_drive_upload_error"."attempts" + 1,
            "lastFailedAt" = now()
          returning 1
        )
      select
        (select "c" from "others") = 0
        and coalesce((select "error" from "old_row"), '') <> ${error} as "firstOfClass"
      from "ins"
    `.execute(this.db);

    return { firstOfClass: rows[0]?.firstOfClass ?? false };
  }

  /**
   * The account-level block, if any — the class that makes every further upload for this user
   * pointless (Drive full, destination folder deleted). The worker checks this at entry so a
   * blocked user's queued jobs skip instead of each calling Drive; the settings page shows it as
   * a banner.
   *
   * If both blocking classes are somehow present, quota wins the report: it's the one with a
   * self-service fix (free space, press resume), so it's the more useful thing to show first.
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  async getBlockingError(userId: string): Promise<(typeof GOOGLE_DRIVE_BLOCKING_ERROR_CLASSES)[number] | null> {
    const row = await this.db
      .selectFrom('google_drive_upload_error')
      .select('error')
      .where('userId', '=', userId)
      .where('error', 'in', [...GOOGLE_DRIVE_BLOCKING_ERROR_CLASSES])
      .orderBy(sql`case "error" when ${GoogleDriveUploadErrorClass.QuotaExceeded} then 0 else 1 end`)
      .limit(1)
      .executeTakeFirst();

    return (row?.error as (typeof GOOGLE_DRIVE_BLOCKING_ERROR_CLASSES)[number]) ?? null;
  }

  /**
   * Clears failure rows of the given classes for a user. Three callers, each representing "the
   * condition this class describes has been resolved":
   *   - resume button → blocking classes (user freed Drive space);
   *   - setFolderId → FolderMissing (a new destination folder exists now);
   *   - re-linking the account → Revoked (there is a fresh grant).
   */
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.STRING]] })
  clearErrors(userId: string, classes: GoogleDriveUploadErrorClass[]) {
    return this.db
      .deleteFrom('google_drive_upload_error')
      .where('userId', '=', userId)
      .where('error', 'in', classes)
      .execute();
  }

  /**
   * What the settings page needs in one query: how many uploads are currently failed, and whether
   * the account is blocked (and by what).
   *
   * The count honours the two reader rules: a ledger row wins over a stale error row (anti-join),
   * and soft-deleted assets don't count — a failure for a photo the user has since trashed is not
   * something they need to act on. `attempts` and per-asset detail stay in the table for the
   * failure-list UI planned in a later wave.
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  async getErrorSummary(
    userId: string,
  ): Promise<{ failedCount: number; blockedReason: (typeof GOOGLE_DRIVE_BLOCKING_ERROR_CLASSES)[number] | null }> {
    const [countRow, blockedReason] = await Promise.all([
      this.db
        .selectFrom('google_drive_upload_error')
        .innerJoin('asset', 'asset.id', 'google_drive_upload_error.assetId')
        .leftJoin('google_drive_upload', (join) =>
          join
            .onRef('google_drive_upload.assetId', '=', 'google_drive_upload_error.assetId')
            .onRef('google_drive_upload.userId', '=', 'google_drive_upload_error.userId'),
        )
        .where('google_drive_upload_error.userId', '=', userId)
        .where('asset.deletedAt', 'is', null)
        .where('google_drive_upload.assetId', 'is', null)
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .executeTakeFirst(),
      this.getBlockingError(userId),
    ]);

    return { failedCount: Number(countRow?.count ?? 0), blockedReason };
  }
}
