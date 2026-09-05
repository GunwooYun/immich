import { Kysely, sql } from 'kysely';

/**
 * Gives each Google Drive connection an identity, and records it on every ledger row it writes.
 *
 * Adoption — the step that claims the unstamped (`driveAccountId = ''`) rows for a newly
 * identified account — was bounded by `uploadedAt >= connectedAt`. That reads as "this connection
 * wrote everything newer than itself", and the converse it depends on is false: `uploadAsset`
 * decides the destination account at the start of a job but writes the ledger row when the upload
 * finishes, which for a large video is minutes later. A re-link inside that window meant the new
 * connection claimed a file that had gone to the previous account's Drive — and since the
 * unstamped row is then narrowed to the wrong account, reconnecting the original one found the
 * asset missing and uploaded it a second time. `files.create` has no idempotency marker, so that
 * duplicate is permanent.
 *
 * Matching on an identity instead of a time range removes the window, and with it the only
 * remaining way for a backwards clock step to widen what adoption claims.
 *
 * `connectionId` is NOT NULL on the connection (every connection has one; the default fills the
 * rows that exist today) and nullable on the ledger, where null means "written before this
 * column". Those rows are simply never adopted, which costs nothing — a row carrying '' already
 * matches every connection, so leaving it unstamped is a missed tidy-up rather than a re-upload.
 * Nothing here resets the ledger. Adoption does delete one narrow class of row — an unstamped row
 * for an asset that already has a row under the target account, because the two cannot share the
 * primary key — and that deletion removes a duplicate record, never the knowledge that the asset
 * reached a Drive.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "user_google_drive" ADD "connectionId" uuid NOT NULL DEFAULT uuid_generate_v4();`.execute(db);
  await sql`ALTER TABLE "google_drive_upload" ADD "connectionId" uuid;`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "google_drive_upload" DROP COLUMN "connectionId";`.execute(db);
  await sql`ALTER TABLE "user_google_drive" DROP COLUMN "connectionId";`.execute(db);
}
