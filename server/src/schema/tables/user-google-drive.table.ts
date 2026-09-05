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

  // Which Google account this connection belongs to — Drive's own `permissionId`, read at link
  // time. The upload ledger is keyed by this same value, so it is what makes "already uploaded"
  // mean "already uploaded *to this Drive*": connect a different account and none of the old rows
  // match, so the backlog recomputes by itself. Nothing is ever reset.
  //
  // Nullable means "connected but not yet identified" — a connection made before this column
  // existed, or one whose identity probe has not succeeded yet. It reads as '' in the ledger
  // comparison, which is the same bucket pre-column rows sit in, so those rows keep counting as
  // uploaded until the account is named and they are adopted.
  @Column({ nullable: true })
  driveAccountId!: string | null;

  // A fresh identity for each connection, minted on link and re-minted on every re-link.
  //
  // The upload ledger stores the id of the connection that wrote each row, which is what lets
  // adoption claim exactly the rows this connection produced. The previous boundary compared
  // timestamps (`uploadedAt >= connectedAt`), and that was wrong in one direction: an upload
  // authorized by connection A can finish *after* connection B begins — a large video takes
  // minutes — so B would claim a file sitting in A's Drive, and A reconnecting would upload it
  // again. `files.create` has no idempotency, so that duplicate cannot be taken back.
  //
  // Not derived from connectedAt: two connections could in principle share a timestamp, and a
  // backwards clock step made the old comparison claim strictly more rows. An identity has
  // neither failure mode.
  @Column({ type: 'uuid', default: () => 'uuid_generate_v4()' })
  connectionId!: Generated<string>;

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
