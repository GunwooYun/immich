import { Kysely, sql } from 'kysely';

/**
 * Creates `google_drive_album` — the per-user set of albums backed up to that user's Drive —
 * and seeds it so the switchover changes nothing.
 *
 * Before this, uploads followed album *ownership*. That rule couldn't express either of the two
 * things this deployment actually needs: backing up an album shared with you (its owner may have
 * no Drive connected), or declining to back up one you own. See
 * dev-docs/google-drive/wave1.5-plan.md for the full argument.
 *
 * The seed is the delicate part. Every album owned by a *connected* user becomes selected, which
 * is exactly the set that uploads today — so the moment this migration lands, behaviour is
 * bit-for-bit what it was, and the user then edits the list at their leisure. Seeding nothing
 * instead would have silently stopped working backups at deploy time with no error anywhere,
 * which is the failure mode this feature has spent several rounds eliminating.
 *
 * Note the seed deliberately reads `user_google_drive` (connected) rather than seeding every
 * owner: an unconnected owner's albums produce no uploads today, so selecting them would be a
 * behaviour change, not a preservation of one.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "google_drive_album" (
      "userId" uuid NOT NULL,
      "albumId" uuid NOT NULL,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "google_drive_album_pkey" PRIMARY KEY ("userId", "albumId"),
      CONSTRAINT "google_drive_album_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "google_drive_album_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "album" ("id") ON UPDATE CASCADE ON DELETE CASCADE
    );
  `.execute(db);
  await sql`CREATE INDEX "google_drive_album_userId_idx" ON "google_drive_album" ("userId");`.execute(db);
  await sql`CREATE INDEX "google_drive_album_albumId_idx" ON "google_drive_album" ("albumId");`.execute(db);

  await sql`
    INSERT INTO "google_drive_album" ("userId", "albumId")
    SELECT au."userId", au."albumId"
    FROM "album_user" au
    JOIN "user_google_drive" ugd ON ugd."userId" = au."userId"
    WHERE au."role" = 'owner';
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "google_drive_album";`.execute(db);
}
