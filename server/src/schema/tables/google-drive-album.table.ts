import { CreateDateColumn, ForeignKeyColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { AlbumTable } from 'src/schema/tables/album.table';
import { UserTable } from 'src/schema/tables/user.table';

/**
 * Which albums a user backs up to *their own* Google Drive.
 *
 * This table is what decouples "who owns the album" from "whose Drive it goes to". The original
 * rule was that uploads follow album ownership, which made two ordinary situations impossible to
 * express: backing up an album shared with you (the owner may have no Drive connected at all —
 * on this deployment 1,843 photos sat unsyncable for exactly that reason), and declining to back
 * up an album you do own. A row here says "back this album up to my Drive"; no row says nothing
 * happens on this album's account.
 *
 * Selection is per (user, album), so two people can back up the same shared album and each gets
 * their own copy — the upload ledger is already keyed `(userId, assetId)`, so per-user dedup
 * needs no changes.
 *
 * The foreign keys point at `user` and `album` independently and deliberately **do not** reference
 * the membership row (`album_user`) that made the selection possible. That means a selection
 * survives an unshare, which is what lets a later re-share resume backups without the user
 * re-picking. The cost is that a selection row alone is *not* evidence of access, so every read
 * path that turns a selection into an upload — `getSubscribers`, `streamPendingUploads` — must
 * join through current membership as well. Skipping that join would keep feeding a user's Drive
 * from an album they can no longer open, silently and indefinitely: precisely the leak this whole
 * model exists to prevent.
 *
 * There is no `enabled` boolean. Deselecting deletes the row; a boolean would only add a second
 * way to represent "off" and a chance for the two to disagree.
 */
@Table('google_drive_album')
export class GoogleDriveAlbumTable {
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false, primary: true })
  userId!: string;

  @ForeignKeyColumn(() => AlbumTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false, primary: true })
  albumId!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
