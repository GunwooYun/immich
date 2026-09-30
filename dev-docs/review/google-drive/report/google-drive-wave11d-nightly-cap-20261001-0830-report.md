# Review request — wave11d (R3): nightly backfill, attempt cap, stream errors

- Branch: `feat/google-drive-album-sync-v3.1.0`
- Range: `1b312a220..06bd8d7a4` — code in `19948b1f5`, the wave11c review file in `06bd8d7a4`
- Plan: `dev-docs/google-drive/stabilization-plan.md` — round R3 (F3, F6, F7) + T1; scenarios V5–V9, V12
- Previous: wave11c review NOT BLOCKED; its M1 (stream `'error'` crash) and N1–N4 are fixed in
  `19948b1f5`, so they are review targets here (§2.4)

## What changed

| File | Change |
|---|---|
| `server/src/enum.ts` | `GOOGLE_DRIVE_CAPPED_ERROR_CLASSES` (unknown, source_unreadable, size_mismatch), `GOOGLE_DRIVE_MAX_UNATTENDED_ATTEMPTS = 5` |
| `server/src/repositories/google-drive.repository.ts` | `streamPendingUploads`: `NOT EXISTS` error row for (selector, asset) in a capped class with `attempts >= 5`. `recordUpload` returns `{ priorAttempts }` from the deleted error row |
| `server/src/services/queue.service.ts` | `handleNightlyJobs` queues `GoogleDriveUploadQueueAll` iff `isGoogleDriveEnabled` |
| `server/src/repositories/job.repository.ts` | `GoogleDriveUploadQueueAll` → `deduplication: { id }` |
| `server/src/services/google-drive.service.ts` | stream `'error'` listener → abort + `source_unreadable` "Reading the original failed mid-upload [code]"; recovery log `after N failed attempt(s)`; comment fixes (wave11c N1/N2) |
| `server/src/utils/google-drive.ts` | `describePaths` appends `[errno]`; comment wording (N4) |
| `server/src/queries/google.drive.repository.sql` | **only** the `streamPendingUploads` hunk — see "generated SQL" below |
| `server/test/utils.ts` | `recordUpload` default mock `{ priorAttempts: 0 }` |
| specs | queue.service (2), service (M1 stream error, 5xx once, recovery log ×2, errno detail), medium (cap ×4, T1 ×2, recordUpload ×1) |

## Please attack

1. **The cap predicate is the riskiest line.** Its failure mode is silent: a wrong predicate makes
   the nightly run queue *nothing* while every "excluded" assertion still passes. Tests assert
   what must still be streamed, and the inverted/off-by-one mutations go red — but check the
   correlation on `google_drive_album.userId` (not `album_asset`'s owner) and that `DISTINCT` +
   several albums holding the same asset cannot let a capped asset slip through via another album.
2. **Who else reads `streamPendingUploads`.** `resumeUploads` and `retryFailures` use it too.
   `retryFailures(assetIds)` clears only those rows then queues the user's whole pending set —
   confirm capped *other* assets staying excluded there is right, and that "retry all failed"
   (the path that clears every non-Revoked class) really does restore capped assets.
3. **`attempts` semantics.** `upsertError` bumps `attempts` across class changes (it is per
   (user, asset), not per class). An asset that failed 4× as RateLimited then once as Unknown hits
   the cap immediately. Is that acceptable, or should the cap count only same-class attempts?
4. **Stream error listener (wave11c M1 fix).** Is `streamInfo.stream.on('error', …)` attached
   early enough (before googleapis-common's `.pipe()`), and can the lazy-open error fire before
   the listener? It is attached right after `openOriginal` returns and before `files.create`.
   Does classifying by `sourceError` first ever hide a genuine Drive error that arrived after?
5. **Nightly gate vs handler.** Handler re-checks `isEnabled()` (config from DB). The nightly
   gate uses `getConfig({ withCache: false })`. Any case where they disagree in a way that matters?
6. **Dedup id** has no test (private `getJobOptions`, no upstream harness). Confirm by reading that
   the manual "start" path (`queue.service.ts` `GoogleDriveUploadQueueAll` command) goes through
   `queue()` → `getJobOptions` and gets the id too.

## Generated SQL (please verify this decision, don't read the rest of the file)

`mise //:sql` runs `dist/bin/sync-sql.js`. `dist/` was 9 days stale (rebuilt with `rm -rf dist &&
nest build`), and the generator's database lacks recent migrations (`column "connectionId" does
not exist` in its log), so methods whose first query failed lost their *second* query from the
output (`setDriveAccountId`'s trailing select, and a second select near `getErrorSummary`). Those
two deletion hunks are environment artifacts; only the `streamPendingUploads` hunk (the cap's
`NOT EXISTS`) was applied from the generator output. Is that the right call, and is the applied
hunk byte-identical to what a migrated DB would produce?

## Test evidence

`./dev-test/google-drive/run.sh --medium` → `dev-test/google-drive/results/20261001-0825.txt`

| | |
|---|---|
| commit | `06bd8d7a4` + dirty: `M dev-docs/google-drive/stabilization-plan.md` (docs), `M mise.lock` (pre-existing) |
| server unit | 328 / 328 |
| web unit | 87 / 87 |
| svelte-check | no regressions vs baseline (3 pre-existing) |
| medium | 72 / 72 |
| result | **PASS** |

Rest of §3 at `06bd8d7a4`: `tsc` exit 0; `eslint src test --max-warnings 0` exit 0; server vitest
94 files, 2455 passed / 2 skipped; web vitest 603 passed / 2 skipped.

### Negative runs (each applied, run, reverted; files byte-compared after)

| Mutation | Red |
|---|---|
| cap threshold → 999999 (cap effectively removed) | all 4 cap tests |
| `>=` → `>` (off by one) | all 4 cap tests |
| `>=` → `<` (inverted: "queues nothing that failed") | all 4 cap tests |
| cap ignores class (`error is not null`) | "cap every capped class, and never RateLimited" |
| cap not correlated on selector | "one user's capped failure … another user" |
| `album.deletedAt` predicate dropped (stream only) | "soft-deleted album" |
| ledger `userId` correlation dropped (stream only) | "another user's ledger row" (**after** rewrite — see below) |
| nightly gate `\|\| true` | "not usable" + the upstream "scheduled jobs" test |
| nightly push removed | "queue … when usable" |
| errno dropped from detail | V1g test (exact detail) |
| recovery log removed / always logged | "log a recovery…" / "not log … first-time success" |
| stream `'error'` listener removed | "turn a read error … not a crash" |
| classification ignores `sourceError` | same |

Honesty notes:
- Two mutations (off-by-one, inverted) first failed to apply — the match string did not exist
  after prettier — and their "all passed" output was *not* evidence. Re-run with the exact
  string; both red.
- The T1 ledger-correlation test first passed with the predicate removed: with two different
  Google accounts the account-match predicate also separated the users. Rewritten with both
  immich users on one Google account; now red when the predicate goes.
- The "5xx once" test mocks `files.create`, so `calledTimes(1)` proves the *service* does not
  retry, not gaxios; the gaxios half is the wave11c reviewer's library probe.

## Verified / not verified

- Verified: cap and T1 predicates against real Postgres; nightly gating, recovery log, errno
  detail, stream-error handling with mocks.
- **Not verified:** the dedup id (no test, read-only argument); a real fs stream emitting EIO
  mid-pipe inside googleapis-common (the listener is proven with an EventEmitter stand-in); how
  many assets production will cap after deploy (observation step in the plan).
