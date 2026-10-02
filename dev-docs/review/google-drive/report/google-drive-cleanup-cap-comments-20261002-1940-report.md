# Review request — cleanup round 2: attempt-cap comments (comment-only)

- Branch: `chore/drive-test-cleanup`
- Range: `8243e265b..f616056e7` (one commit; three comments + the previous review file)
- Previous: cleanup review NOT BLOCKED; its N1 and N2 fixed here

## What changed (comments only — no executable line)

| File | Change |
|---|---|
| `server/src/enum.ts` | `GOOGLE_DRIVE_MAX_UNATTENDED_ATTEMPTS` doc: names the pending stream's four consumers, and the three ledger-only paths that bypass the cap (manual sync, selecting an album, add-to-album) |
| `server/src/repositories/google-drive.repository.ts` | cap predicate comment in `streamPendingUploads`: not "the nightly backfill" alone |
| `server/src/schema/tables/google-drive-upload-error.table.ts` | `attempts` comment: adds "selecting an album for backup" to the bypass list |

## Please attack

- That the `.ts` diffs are comment-only (no decorator, query or SQL change; no `mise //:sql` needed).
- That each list is complete: `queueGoogleDriveUploads` callers are `syncAlbum`, `subscribeAlbum`
  (google-drive.service.ts) and `AlbumService` add-assets; `streamPendingUploads` consumers are the
  nightly/admin `handleGoogleDriveUploadQueueAll`, `resumeUploads`, `retryFailures`.

## Test evidence

`.claude/scripts/verify-task server` (prettier, eslint, tsc, full server unit) exit 0 at the
working tree that became `f616056e7`. No behaviour changed, so run.sh was not re-run; last
run.sh at `fef32890b` (this branch, clean tree): server 330/330, web 87/87, PASS.
