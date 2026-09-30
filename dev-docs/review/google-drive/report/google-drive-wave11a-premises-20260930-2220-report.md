# Review request — wave11a (R0): corrected premises + uncited commits

- Branch: `feat/google-drive-album-sync-v3.1.0`
- Range: `053b2810d..be509702a` (everything after the wave10d report)
- Plan: `dev-docs/google-drive/stabilization-plan.md` (wave11 — this is round R0)

## Commits in scope

| Commit | What | Why it is here |
|---|---|---|
| `df8628ba0` | test evidence at `58039033a` | never cited by a report |
| `0172d69d1` | drop a blank line left inside `getErrorSummary`'s SQL | never cited by a report; SQL generated file touched |
| `5fcd8d383` | CLAUDE.md template upgrade (user commit, docs only) | never cited; no code |
| `1e2fd8ac7` | wave11 plan + CLAUDE.md Current Project block | docs only |
| `be509702a` | **R0**: comment corrections + removal of the no-op `uploadType: 'resumable'` | the only code change |

## What R0 changes

1. `google-drive.service.ts` `uploadAsset`: removes `uploadType: 'resumable'` from `files.create`
   and replaces its comment. Claim: **behaviour is identical**, because
   `googleapis-common@7.2.0 build/src/apirequest.js:205-208` sets `params.uploadType = 'multipart'`
   whenever `resource` (our `requestBody`) is present with `media.body`.
2. `job.repository.ts` `GoogleDriveUpload` case: comment now says `removeOnFail` is defensive.
   Claim: `JobService.onJobRun` (`job.service.ts:86-98`) catches all handler errors without
   rethrowing, so BullMQ only ever completes these jobs.
3. `utils/google-drive.ts` `classifyDriveError` doc + two test titles: the bare-404 rule is kept,
   the "expired resumable session" rationale is rewritten.

## Please attack

- **The multipart claim.** Is there any code path where our call does *not* carry `requestBody`
  (so `uploadType` would have mattered)? Is `apirequest.js` the version actually resolved by the
  server workspace (`pnpm why googleapis-common`)?
- **The onJobRun claim.** Is there any other runner for the `GoogleDriveUpload` queue that could
  let an error reach BullMQ (worker `processor`, `JobRun` emission path in `job.repository.ts`)?
  If yes, `removeOnFail` *is* load-bearing and the new comment is wrong.
- `0172d69d1`: does the regenerated `src/queries/google.drive.repository.sql` match the source
  (i.e. was `mise //:sql` rerun, or was the generated file hand-edited)?

Don't read generated files beyond that one check (`open-api/`, `packages/sdk/`, `mobile/openapi/`).

## Test evidence

`./dev-test/google-drive/run.sh` → `dev-test/google-drive/results/20260930-2216.txt`

| | |
|---|---|
| date | 2026-09-30T22:16:54+09:00 |
| commit | `be509702a` + uncommitted changes (only `mise.lock`, pre-existing and unrelated — not mine) |
| server unit | 316 passed (316) |
| web unit | 87 passed (87) |
| svelte-check | no regressions vs baseline (3 pre-existing files) |
| result | **PASS** |

`.claude/scripts/verify-task server` (prettier check, eslint, tsc, full server vitest unit): exit 0.

## Verified / not verified

- Verified: the two premises by reading the library and `job.service.ts` (main session), and by
  the design review independently.
- **Not verified by a test:** that removing `uploadType` is a no-op. No test can observe it through
  the mocked Drive client; the evidence is the library source. A negative test is not meaningful
  here — this is a comment-and-dead-option change.
- Medium suite not run for R0 (no query change in R0; `0172d69d1`'s medium run is `df8628ba0`).
