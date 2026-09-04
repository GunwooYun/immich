import { Column, CreateDateColumn, ForeignKeyColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table';
import { UserTable } from 'src/schema/tables/user.table';

/**
 * "Upload ledger" for the Google Drive sync feature: one row per (user, asset) pair that has
 * successfully been uploaded to that user's Google Drive.
 *
 * Why this table exists: Google's Drive API `files.create` call is not idempotent — calling it
 * twice for the same photo creates two separate files in the user's Drive. Immich, on the other
 * hand, can easily end up trying to "upload this asset" more than once for the same asset+user:
 *   - The same photo gets added to two different albums owned by the same user.
 *   - A photo is removed from an album and then re-added later.
 *   - A background job fails partway through and BullMQ retries it.
 * Before uploading anything, GoogleDriveService checks this table; after a successful upload, it
 * records a row here. That turns "upload this asset" into an idempotent operation from Immich's
 * point of view, even though the underlying Google API call isn't.
 *
 * (userId, assetId, driveAccountId) together form the primary key. The account is part of the key
 * on purpose: a row records that an asset reached *a particular* Google Drive, and the same asset
 * can legitimately have been sent to two different accounts. Keying on (userId, assetId) alone was
 * the bug — connecting a different Google account left every asset reading "already uploaded",
 * so the new Drive stayed empty forever while the UI reported the library synced.
 *
 * Keeping the old rows rather than resetting them is what makes switching *back* to a previous
 * account free: those rows still match, so nothing re-uploads. Rows carrying '' match *any*
 * connection on purpose — see the ledger predicate in GoogleDriveRepository — because the cost of
 * not matching them is re-uploading a library, and duplicates cannot be taken back. It also means no code path ever has
 * to delete the ledger, which matters because `files.create` has no idempotency marker — a reset
 * would mean thousands of duplicate files in someone's Drive, irreversibly.
 */
@Table('google_drive_upload')
export class GoogleDriveUploadTable {
  // Which Immich user this upload belongs to (i.e. whose Google Drive account the file was
  // uploaded into). Cascades on delete/update so that removing a user automatically cleans up
  // their upload history rows too, rather than leaving orphaned references behind.
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false, primary: true })
  userId!: string;

  // Which Immich asset (photo/video) this row is tracking. Same cascade reasoning as userId: if
  // the underlying asset is permanently deleted from Immich, its upload-history row should go
  // with it (we're not trying to also delete the file from the user's Drive — see the "Non-goals"
  // section of dev-docs/google-drive/album-sync-plan.md for why deletion sync is out of scope).
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false, primary: true })
  assetId!: string;

  // Which Google account received the file — Drive's `permissionId` for the connected account.
  //
  // '' means "written before this column existed, provenance unknown". Those rows are adopted into
  // the real account id the first time we successfully identify it while the *pre-existing* token
  // is still in place (see GoogleDriveService#adoptIfNewlyIdentified). Empty rather than nullable
  // because a nullable column cannot sit in a primary key, and '' reads the same way through the
  // `coalesce(..., '')` the queries use for a connected-but-unidentified account.
  @Column({ primary: true, default: '' })
  driveAccountId!: Generated<string>;

  // The file id Google's Drive API assigned to the uploaded file (returned from `files.create`).
  // Not currently used for anything beyond bookkeeping, but keeping it around means a future
  // feature (e.g. "open in Google Drive" link, or "remove from Drive when unlinking") doesn't
  // need a schema migration to add it later.
  @Column()
  driveFileId!: string;

  // When this upload happened — mostly useful for debugging / support ("did this actually sync,
  // and when?") rather than being read by any application logic today.
  @CreateDateColumn()
  uploadedAt!: Generated<Timestamp>;
}
