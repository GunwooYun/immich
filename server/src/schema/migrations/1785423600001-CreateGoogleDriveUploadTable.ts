import { Kysely, sql } from 'kysely';

/**
 * Creates the `google_drive_upload` table — see GoogleDriveUploadTable
 * (server/src/schema/tables/google-drive-upload.table.ts) for the full explanation of why this
 * table exists (short version: it's a dedup ledger so we never upload the same asset twice to
 * the same user's Google Drive).
 *
 * This is a hand-written migration rather than one generated from the @Table/@Column decorators
 * on GoogleDriveUploadTable, but the SQL below is written to match that schema definition
 * exactly: composite primary key on (userId, assetId), both columns are foreign keys with
 * CASCADE delete/update back to their parent tables, driveFileId is a required text column, and
 * uploadedAt defaults to the insert time.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "google_drive_upload" (
      "userId" uuid NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "assetId" uuid NOT NULL REFERENCES "asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "driveFileId" character varying NOT NULL,
      "uploadedAt" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("userId", "assetId")
    );
  `.execute(db);
}

/**
 * Reverts the migration above by dropping the whole table. Since this table only ever stores
 * derived bookkeeping data (which assets have been mirrored to Drive), and not anything users
 * directly created, it's always safe to drop wholesale here — nothing else in Immich depends on
 * this table's contents surviving a rollback.
 */
export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "google_drive_upload";`.execute(db);
}
