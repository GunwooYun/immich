import { Kysely, sql } from 'kysely';

/**
 * Creates `google_drive_upload_error` — the failure ledger that mirrors `google_drive_upload`
 * with opposite polarity (row = last attempt failed; deleted on success).
 *
 * Why now: Drive jobs are removed from the queue on failure (`removeOnFail: true`, required so
 * the dedup jobId doesn't block retries), so the queue keeps no memory of failures and the only
 * failure record is server logs. This table is what lets the settings page say "uploads stopped:
 * Drive is full", and — via the account-level classes (`quota_exceeded`, `folder_missing`) —
 * what lets the worker skip a blocked user's remaining queued jobs instead of burning one doomed
 * Drive API call per job. See GoogleDriveUploadErrorTable in the schema for the full design notes.
 *
 * Index shape mirrors `google_drive_upload` (see 1785769790549): composite PK on
 * (userId, assetId) plus one standalone index per FK column, which is what sql-tools expects for
 * a two-FK composite key — the assetId index also serves the ON DELETE CASCADE lookups when
 * assets are hard-deleted.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "google_drive_upload_error" (
      "userId" uuid NOT NULL,
      "assetId" uuid NOT NULL,
      "error" character varying NOT NULL,
      "detail" character varying,
      "attempts" integer NOT NULL DEFAULT 1,
      "lastFailedAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "google_drive_upload_error_pkey" PRIMARY KEY ("userId", "assetId"),
      CONSTRAINT "google_drive_upload_error_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "google_drive_upload_error_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE
    );
  `.execute(db);
  await sql`CREATE INDEX "google_drive_upload_error_userId_idx" ON "google_drive_upload_error" ("userId");`.execute(db);
  await sql`CREATE INDEX "google_drive_upload_error_assetId_idx" ON "google_drive_upload_error" ("assetId");`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "google_drive_upload_error";`.execute(db);
}
