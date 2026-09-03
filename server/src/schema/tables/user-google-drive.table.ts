import { Column, CreateDateColumn, ForeignKeyColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { UserTable } from 'src/schema/tables/user.table';

/**
 * Per-user Google Drive connection state: the OAuth refresh token we exchange for access tokens
 * when uploading, plus the user's chosen destination folder.
 *
 * These two fields originally lived directly on the `user` table. They were moved here because
 * `columns.userAdmin` (the column set used by most user reads across the whole codebase — see
 * server/src/database.ts) selects every user column, which meant a long-lived OAuth secret was
 * being loaded into memory on essentially every user lookup, whether or not Google Drive had
 * anything to do with the request. Anything that later spreads a user object (`{ ...user }`) into a
 * response or a log line would have leaked it. Keeping the token in its own table means it's only
 * ever read where it's explicitly needed: the link/unlink flow and the upload worker.
 *
 * Note the token is stored in plaintext. This is a deliberate, documented decision rather than an
 * oversight: Immich has no encryption-at-rest infrastructure and no master key (every other secret
 * it stores — passwords, API keys, session tokens, PIN codes — is *hashed*, because those only ever
 * need verifying, never reading back). A Google refresh token has to be readable to be usable, so
 * it would need reversible encryption, which needs a key held outside the database to be worth
 * anything. Introducing that would mean a new mandatory operator-managed key, and losing it would
 * force every user to re-link. See dev-docs/google-drive/album-sync-plan.md §2.5 for the trade-off
 * discussion. The row is therefore protected by the same boundary as the rest of the database.
 */
@Table('user_google_drive')
export class UserGoogleDriveTable {
  // One row per user, so the user id is both the primary key and the foreign key. Cascades on
  // delete so that deleting an Immich user disposes of their Google credentials automatically.
  @ForeignKeyColumn(() => UserTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE', nullable: false, primary: true })
  userId!: string;

  // The OAuth refresh token from Google. The presence of a row in this table *is* the "user has
  // connected Google Drive" signal — there's no separate boolean flag to keep in sync.
  @Column()
  refreshToken!: string;

  // Which Google account this row's token belongs to — Drive's own `permissionId` for the user,
  // read once at link time. It exists because the upload ledger is keyed (userId, assetId) with no
  // notion of *which* Drive an asset went to: without this, connecting a different Google account
  // leaves every asset reading "already uploaded", so the new Drive stays empty forever while the
  // UI reports completion. Comparing this on each link is what lets us notice and reset.
  //
  // Nullable because rows created before this column existed cannot know their account. A null is
  // "unknown", not "no account": the first link after this ships records the id without resetting
  // anything, since we have nothing to compare against and wiping a ledger on a guess would mean
  // re-uploading someone's whole library.
  @Column({ nullable: true })
  driveAccountId!: string | null;

  // The Drive folder id uploads should go into. Null = upload to the root of the user's "My Drive".
  @Column({ nullable: true })
  folderId!: string | null;

  // Human-readable name of that folder, captured at the moment it was chosen, purely so the
  // settings page can say "Photos" instead of "1a2B3c4D5e6F7g8H9i0J".
  //
  // Denormalised on purpose. The alternative is asking the Drive API for the name on every settings
  // render, which costs a network round trip and would break the moment the token needs refreshing.
  // The cost of caching it is that a folder renamed in Drive shows its old name here until the user
  // picks it again — a cosmetic staleness, since uploads are addressed by id and keep working.
  // Null whenever folderId is null, and also for folders configured by pasting an id by hand (no
  // picker involved, so no name to record).
  @Column({ nullable: true })
  folderName!: string | null;

  // When the user linked their account. Surfaced through the connection-status endpoint so the
  // settings UI can show something more useful than a bare "connected".
  @CreateDateColumn()
  connectedAt!: Generated<Timestamp>;
}
