# Review request — cleanup: last redundant mock resets, attempts comment

- Branch: `chore/drive-test-cleanup` (from `feat/google-drive-album-sync-v3.1.0` @ `f57d2e8ac`)
- Range: `f57d2e8ac..fef32890b` (one commit)
- Source: deferred nits — wave11j review N1, wave11f review N1

## What changed

| File | Change |
|---|---|
| `server/src/services/google-drive.service.spec.ts` | "trashed assets" test: its own `driveFilesCreate.mockClear()` and comment removed. `getStorage` describe: its `beforeEach` that re-reset `driveAboutGet` removed (comment kept, now pointing at the file-level reset) |
| `server/src/schema/tables/google-drive-upload-error.table.ts` | comment only: the cap's consumer is the pending stream (nightly, admin queue-all, resume/retry); manual sync and add-to-album bypass it |

No production code, no schema change (decorators untouched).

## Please attack

- The `getStorage` describe's `beforeEach` is gone entirely. Did it do anything besides
  `driveAboutGet.mockReset()` (it did not, per the diff) — and does any `getStorage` test now see
  a `driveAboutGet` implementation left by a *sibling* test in the same describe?
- The comment's claim about which paths use `streamPendingUploads` vs `queueGoogleDriveUploads`.

## Test evidence

`./dev-test/google-drive/run.sh` → `dev-test/google-drive/results/20261002-1922.txt`: commit
`fef32890b`, clean tree; server unit 330/330, web 87/87, PASS. `verify-task server` exit 0. Drive
spec in order and on shuffle seeds 1, 7, 42: 128/128 each.

Negative run: with the file-level `driveFilesCreate.mockReset()` removed, 4 tests fail including
"trashed assets > should skip an asset that is in the trash" — so that test now depends on the
file-level reset, as intended.
