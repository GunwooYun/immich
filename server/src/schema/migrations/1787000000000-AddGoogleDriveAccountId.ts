import { Kysely, sql } from 'kysely';

/**
 * Adds `driveAccountId` to `user_google_drive`.
 *
 * The upload ledger is keyed `(userId, assetId)` and says nothing about which Google Drive an
 * asset was sent to. Nothing recorded which account a stored refresh token belonged to either, so
 * connecting a *different* Google account — switching a personal account for one dedicated to
 * backups, say — left every asset reading "already uploaded". The new Drive would stay empty
 * forever while the settings page reported the whole library synced.
 *
 * Nullable on purpose: existing rows cannot know their account retroactively, and null means
 * "unknown" rather than "none". GoogleDriveService#linkAccount records the id on the next link and
 * only resets the ledger when it has a previous id to compare against and the two differ.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "user_google_drive" ADD "driveAccountId" character varying;`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "user_google_drive" DROP COLUMN "driveAccountId";`.execute(db);
}
