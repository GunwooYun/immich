import { Kysely, sql } from 'kysely';

/**
 * Adds `user_google_drive.folderName`, the cached display name of the destination folder.
 *
 * Introduced together with the Google Picker folder chooser. The picker hands back both an id and a
 * name, and the settings page previously had only the id to show — so after picking "Photos" from a
 * proper folder browser, the UI would go back to displaying `1a2B3c4D5e6F7g8H9i0J`. Storing the
 * name at pick time avoids calling the Drive API on every settings render just to resolve it.
 *
 * Nullable with no backfill, which is correct rather than lazy: existing rows were configured by
 * pasting a folder id by hand, so there is no name to recover for them. They keep working exactly
 * as before (uploads are addressed by id) and simply show the id until the user picks a folder
 * again. Backfilling would mean a Drive API call per connected user during a migration, which is
 * not something a schema migration should ever do.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "user_google_drive" ADD "folderName" character varying;`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "user_google_drive" DROP COLUMN "folderName";`.execute(db);
}
