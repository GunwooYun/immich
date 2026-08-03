import { Kysely, sql } from 'kysely';

/**
 * Adds the two per-column foreign-key indexes on `google_drive_upload` that the schema decorators
 * imply but the hand-written create-table migration (1785423600001) forgot.
 *
 * How this was found: this is verbatim what `sql-tools migrations generate` produced when run
 * against a database migrated with the existing files — i.e. it's the diff between "what the
 * decorators on GoogleDriveUploadTable declare" and "what the migrations actually create". For a
 * table whose primary key is a composite of two foreign keys, sql-tools expects an index per FK
 * column (compare `album_asset`, upstream's closest analogue, which has the same shape and keeps
 * both indexes). The `assetId` index in particular matters in practice: the FK has ON DELETE
 * CASCADE, so every asset deletion has to find this table's rows by `assetId` — without an index
 * that's a sequential scan per deleted asset. (`userId` is the leading column of the primary key,
 * so its standalone index is more about matching the declared schema exactly than about query
 * plans — CI's drift check compares literally.)
 *
 * Shipped as a new forward migration rather than by editing 1785423600001 in place, per the same
 * reasoning as 1785475800000: this branch has been run against real local databases already, and
 * a database that has an old migration recorded in `kysely_migrations` never re-runs it — editing
 * the old file's contents would leave such databases silently missing the indexes forever.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE INDEX "google_drive_upload_userId_idx" ON "google_drive_upload" ("userId");`.execute(db);
  await sql`CREATE INDEX "google_drive_upload_assetId_idx" ON "google_drive_upload" ("assetId");`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX "google_drive_upload_userId_idx";`.execute(db);
  await sql`DROP INDEX "google_drive_upload_assetId_idx";`.execute(db);
}
