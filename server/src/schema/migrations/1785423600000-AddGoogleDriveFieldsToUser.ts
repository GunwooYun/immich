import { Kysely, sql } from 'kysely';

/**
 * Adds the two columns the Google Drive sync feature needs on the `user` table:
 *   - googleDriveRefreshToken: the long-lived OAuth refresh token Google gives us after the user
 *     completes the "Connect Google Drive" consent flow (see GoogleDriveService#linkAccount).
 *     NULL means "this user hasn't connected Google Drive" — that's how the rest of the code
 *     (e.g. GoogleDriveService#uploadAsset) checks whether to skip a user entirely.
 *   - googleDriveFolderId: the Drive folder the user has chosen as the upload destination (see
 *     GoogleDriveService#setFolderId). NULL means "no folder chosen yet", in which case uploads
 *     fall back to the root of the user's "My Drive".
 *
 * NOTE (known follow-up, not fixed in this migration): storing the refresh token directly on the
 * `user` table means it gets pulled into memory by every query that selects the full "admin"
 * column set for a user, even when nothing about Google Drive is relevant to that query. A
 * cleaner design would move these two columns into their own `user_google_drive` table that's
 * only ever queried when Google Drive functionality is actually needed, and encrypt the token at
 * rest rather than storing it as plain text. See dev-docs/google-drive-album-sync-plan.md §2.5
 * for the full write-up — left as a follow-up to keep this change focused on wiring the feature
 * up end-to-end first.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "user" ADD "googleDriveRefreshToken" character varying;`.execute(db);
  await sql`ALTER TABLE "user" ADD "googleDriveFolderId" character varying;`.execute(db);
}

/**
 * Drops both columns again. Safe to roll back at any time — this only removes Google Drive
 * linkage state, it doesn't touch any of the user's photos or Immich account data.
 */
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "user" DROP COLUMN "googleDriveRefreshToken";`.execute(db);
  await sql`ALTER TABLE "user" DROP COLUMN "googleDriveFolderId";`.execute(db);
}
