import { Kysely, sql } from 'kysely';

/**
 * Scopes the upload ledger to the Google account that received each file.
 *
 * The ledger was keyed (userId, assetId) and recorded that an asset reached *a* Drive, not which
 * one. Connecting a different Google account therefore left every asset reading "already
 * uploaded": the new Drive stayed empty forever while the UI reported the whole library synced.
 *
 * The account joins the primary key rather than sitting beside it. That is what lets a user switch
 * back to a previous account and resume for free — the old rows are still there and still match —
 * and it is why no code path has to delete ledger rows to correct the situation. That last part
 * matters more than it looks: `files.create` carries no idempotency marker, so a reset would mean
 * thousands of duplicate files in the user's Drive with no way back.
 *
 * Existing rows get '' — "written before this column existed, account unknown". They are adopted
 * into the real id the first time it is identified while the *pre-existing* token is still in
 * place. Until then '' matches the `coalesce(..., '')` the queries use for a connected account
 * whose id has not been read yet, so nothing re-uploads in the meantime.
 *
 * NOT NULL DEFAULT '' rather than nullable, because a nullable column cannot participate in a
 * primary key and the alternative — a unique index over coalesce(...) — buys nothing here.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "google_drive_upload" ADD "driveAccountId" character varying NOT NULL DEFAULT '';`.execute(
    db,
  );
  await sql`ALTER TABLE "google_drive_upload" DROP CONSTRAINT "google_drive_upload_pkey";`.execute(db);
  await sql`ALTER TABLE "google_drive_upload" ADD CONSTRAINT "google_drive_upload_pkey" PRIMARY KEY ("userId", "assetId", "driveAccountId");`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  // Collapsing back to two columns can collide if the same asset was uploaded to two accounts.
  // Keep the most recent row for each pair rather than failing the migration.
  await sql`
    DELETE FROM "google_drive_upload" a
    USING "google_drive_upload" b
    WHERE a."userId" = b."userId"
      AND a."assetId" = b."assetId"
      AND a."uploadedAt" < b."uploadedAt";
  `.execute(db);
  await sql`ALTER TABLE "google_drive_upload" DROP CONSTRAINT "google_drive_upload_pkey";`.execute(db);
  await sql`ALTER TABLE "google_drive_upload" ADD CONSTRAINT "google_drive_upload_pkey" PRIMARY KEY ("userId", "assetId");`.execute(
    db,
  );
  await sql`ALTER TABLE "google_drive_upload" DROP COLUMN "driveAccountId";`.execute(db);
}
