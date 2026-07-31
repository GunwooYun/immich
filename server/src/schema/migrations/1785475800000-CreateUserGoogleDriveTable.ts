import { Kysely, sql } from 'kysely';

/**
 * Moves the Google Drive connection fields off the `user` table and into their own
 * `user_google_drive` table. See UserGoogleDriveTable
 * (server/src/schema/tables/user-google-drive.table.ts) for why.
 *
 * Note this is written as an additive migration on top of 1785423600000-AddGoogleDriveFieldsToUser,
 * rather than editing that earlier migration in place. Both migrations were authored on the same
 * unmerged feature branch, so in principle the earlier one could just be rewritten — but anyone who
 * has already run the branch locally (e.g. via docker/docker-compose.isolated.yml) would then have
 * a `kysely_migrations` row pointing at a migration file that no longer exists, which the migrator
 * treats as a corrupted migration history and refuses to run. Migrating forward costs one extra
 * file and works for everyone.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "user_google_drive" (
  "userId" uuid NOT NULL,
  "refreshToken" character varying NOT NULL,
  "folderId" character varying,
  "connectedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_google_drive_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "user_google_drive_pkey" PRIMARY KEY ("userId")
);`.execute(db);

  // Carry over anyone who already linked Google Drive while the columns lived on `user`. Rows
  // without a refresh token were never actually linked (the token is what makes a connection
  // usable), so there's nothing worth preserving for them — a stray folderId with no token would
  // just be dead data in the new table, which requires a token to be non-null.
  await sql`
    INSERT INTO "user_google_drive" ("userId", "refreshToken", "folderId")
    SELECT "id", "googleDriveRefreshToken", "googleDriveFolderId"
    FROM "user"
    WHERE "googleDriveRefreshToken" IS NOT NULL;
  `.execute(db);

  await sql`ALTER TABLE "user" DROP COLUMN "googleDriveRefreshToken";`.execute(db);
  await sql`ALTER TABLE "user" DROP COLUMN "googleDriveFolderId";`.execute(db);
}

/**
 * Reverses the move: re-adds the columns on `user`, copies the data back, and drops the table.
 * Rolling back is lossless for the fields themselves; only `connectedAt` (which has no equivalent
 * on the `user` table) is discarded.
 */
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "user" ADD "googleDriveRefreshToken" character varying;`.execute(db);
  await sql`ALTER TABLE "user" ADD "googleDriveFolderId" character varying;`.execute(db);

  await sql`
    UPDATE "user"
    SET "googleDriveRefreshToken" = "user_google_drive"."refreshToken",
        "googleDriveFolderId" = "user_google_drive"."folderId"
    FROM "user_google_drive"
    WHERE "user"."id" = "user_google_drive"."userId";
  `.execute(db);

  await sql`DROP TABLE "user_google_drive";`.execute(db);
}
