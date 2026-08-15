import { Column, ForeignKeyColumn, Table } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table';
import { UserTable } from 'src/schema/tables/user.table';

/**
 * Failure record for Google Drive uploads — the mirror image of `google_drive_upload`.
 *
 * The two tables have deliberately opposite polarity: a row *here* means "this asset's last
 * upload attempt failed and nothing has succeeded since"; a row in the ledger means "this asset
 * is safely in Drive". Success deletes the error row in the same flow that writes the ledger row,
 * and every reader treats the ledger as authoritative when both somehow exist (a crash between
 * the two writes can leave a stale error row — the ledger row is the one that reflects reality).
 *
 * Why this table exists at all: failed Drive jobs are removed from the queue on failure
 * (`removeOnFail: true`, see job.repository.ts — required so the dedup jobId doesn't block
 * retries), which means the queue keeps no memory of failures and the admin Jobs panel shows no
 * failure count. Without this table, "which photos failed, and why" is answerable only by
 * grepping server logs. With it, the settings page can show a banner ("uploads stopped: Drive is
 * full"), the album view can count failures, and the backfill can *stop wasting work* on users
 * whose uploads cannot currently succeed.
 *
 * `error` is a small classification vocabulary (see GoogleDriveUploadErrorClass in enum.ts), not
 * free text — the interesting distinction is between per-asset problems (unreadable source file,
 * size mismatch) and account-level ones (quota exhausted, destination folder deleted), because
 * account-level failures gate the whole user: one such row stops the worker from calling Drive
 * for that user's remaining queued jobs, converting N doomed API calls into N cheap skips.
 * Free-text detail lives in `detail`, truncated, purely for humans reading the settings page.
 */
@Table('google_drive_upload_error')
export class GoogleDriveUploadErrorTable {
  // Same key shape as the ledger: one row per (user, asset). Cascades so that deleting a user or
  // hard-deleting an asset disposes of its failure record automatically — soft-deleted (trashed)
  // assets keep their row, which is why readers must filter on asset.deletedAt themselves.
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false, primary: true })
  userId!: string;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false, primary: true })
  assetId!: string;

  // Classification code — one of GoogleDriveUploadErrorClass. Varchar rather than a DB enum so
  // adding a class is a code change, not a migration.
  @Column()
  error!: string;

  // Truncated human-readable message from the underlying failure, for the settings page only.
  // Never parsed; the classification above is what code branches on.
  @Column({ nullable: true })
  detail!: string | null;

  // How many times this (user, asset) pair has failed. Purely informational: there is no retry
  // cap (a known, accepted long-tail — see the failure-handling plan §4), but surfacing the count
  // lets a human spot the asset that has failed 40 times and deal with it.
  @Column({ type: 'integer', default: 1 })
  attempts!: number;

  // Set explicitly by the upsert (`now()` on insert and on every conflict-update) rather than via
  // UpdateDateColumn: that decorator pairs with the UpdatedAtTrigger machinery, which is overkill
  // for a column only ever written through one repository method.
  @Column({ type: 'timestamp with time zone', default: () => 'now()' })
  lastFailedAt!: Date;
}
