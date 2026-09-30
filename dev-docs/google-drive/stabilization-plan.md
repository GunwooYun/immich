# Google Drive sync stabilization — plan

Status: **2026-09-29, design-reviewed (deep-reasoning), awaiting user approval.**
Research: `.claude/docs/research/google-drive-sync-stabilization.md` (agy, partly spot-checked).

## Why this wave

User-reported symptom: **"some photos occasionally fail to upload"**, plus the general worry
about connection loss and large-volume / restart durability. Scope chosen by the user: broad.
Done = unit + medium tests pass, review cycle passes.

Production facts (read-only, 2026-09-29, image `-w10`):

| Fact | Value |
|---|---|
| Connection | 1 user, identified, `connectedAt = 2026-09-14 12:49 UTC` (15 days) — Testing-era 7-day expiry is gone |
| Ledger | 8,273 rows, last upload 2026-09-28 14:52 UTC |
| Error table | 1 row: `source_unreadable`, attempts 1, 2026-09-23 00:48:24 |
| That asset | created 00:48:19 (5 s before the failure); detail names **only** `/data/upload/...`; row now under `/data/library`, and trashed |
| Server log | since the last restart (4 days) no Drive warn/error line |

Error rows are deleted on success, so past transient failures leave no trace in the DB.

## Two premises corrected by the design review (verified against code by the main session)

1. **The upload is multipart, not resumable.** `googleapis-common@7.2.0 apirequest.js:205-208`
   sets `uploadType = 'multipart'` whenever `requestBody` is present, overriding our
   `uploadType: 'resumable'` (`google-drive.service.ts:1310`). There is no session URI; the
   "resumable session expired 404" case in `utils/google-drive.ts` cannot occur.
2. **BullMQ never sees a failed Drive job.** `job.service.ts:86-98` `onJobRun` catches every
   error, emits `JobError`, and does not rethrow, so every job completes and
   `removeOnComplete: true` (`config.repository.ts:289`) frees the jobId. ~~`removeOnFail: true`
   and its comment are inert.~~ **Corrected by the wave11a review (M1):** jobs *can* still fail
   via BullMQ stall detection (worker dies mid-upload) or a rejecting `JobError` listener, so
   `removeOnFail` stays load-bearing for those rare paths. Consequences: BullMQ `attempts`/`backoff`
   can't be used; a re-queue from inside the handler with the same jobId is silently refused.

## Changes (revised)

| ID | Change | Evidence |
|---|---|---|
| D0 | Docs-only: fix the resumable/multipart and removeOnFail comments | premises above |
| F1 | In `openOriginal`, when the re-read row path is unchanged, look up `move_history` (`moveRepository.getByEntity(asset.id, Original)`) and try `move.newPath`; if no row, re-read the asset once more; else terminal skip as today. No timer, no new job. Also heals "mover died between rename and row write" | `storage.core.ts`: move row created before rename, deleted last. Mover queued on `AssetMetadataExtracted` = seconds after creation, matching the prod 5 s gap |
| F1p | Pin rename-before-row-update order in `storage.core.spec.ts`, so an upstream reorder breaks F1's premise loudly | — |
| F4 | `retry: false` on `files.create`; delete `shouldRetryDriveRequest` + its tests (dead). Retry is the nightly backfill (F3) | gaxios re-sends the same consumed stream on retry (`gaxios.js:150-157`); a stream factory is impossible through this API |
| F2 | Inactivity abort, not a whole-request timeout: `AbortController` passed as `signal`, timer reset by `onUploadProgress`, `UPLOAD_IDLE_TIMEOUT_MS = 120 s`. Abort → `unknown`, recorded, stream destroyed | node-fetch `timeout` covers the whole body send (useless for 4 GB videos); a source error mid-pipe can hang the request forever with `finally` never running |
| F5 | Only rate-limit reasons (+ `dailyLimitExceeded`, `sharingRateLimitExceeded`) → `RateLimited`; other 403s → `unknown` | `utils/google-drive.ts:122` |
| F3 | Nightly: `handleNightlyJobs` queues `GoogleDriveUploadQueueAll` iff `isGoogleDriveEnabled`; add a `deduplication` id like `FacialRecognitionQueueAll`. Attempt cap in `streamPendingUploads`: exclude assets with an error row `attempts >= CAP` for all **non-blocking, non-RateLimited** classes. Escape hatches: success deletes the row; manual album sync clears rows. `mise //:sql` | no existing cron; `queue.service.ts:267-300` |
| F6 | EACCES/EIO → recorded retryable `source_unreadable` (ENOENT keeps F1 logic) | deferred item in `failure-handling-plan.md` |
| F7 | `recordUpload` returns prior `attempts` on delete; log `uploaded after N failed attempt(s)` | observability gap above |
| T1 | Medium: `streamPendingUploads` excludes other users' assets and deleted albums | wave10c debt |
| T2 | Unit: stream destroyed when `files.create` throws; revoked token on `getStorage`/`getPickerConfig` | — |

Accepted latency: **a transient failure heals within ≤ 24 h** (nightly), or immediately via a
manual album sync.

## Explicitly out of scope

- Splitting `google-drive.service.ts` (1843 lines) / repository (1038) — separate refactor wave,
  so the behavioural diff stays reviewable.
- Soft-disconnect / nullable refreshToken (rejected, CLAUDE.md §7 item 10).
- Login-grant (Current Project Tasks 7) — separate unit of work.

## Order (each a review round)

| Round | Content | risk |
|---|---|---|
| R0 | D0 + the two unreviewed commits `0172d69d1`, `df8628ba0` | low |
| R1 | F1 + F1p | **high** |
| R2 | F4 + F2 + F5 (one request-layer change; F2 depends on F4) | **high** |
| R3 | F3 + F7 + F6 (+ sql regen, medium specs) | **high** |
| R4 | T1 + T2 | low |

## Verification plan

Configured tiers: `verify-save`, `verify-task`. **No `verify-unit` script exists**, so the
slowest configured tier is `task`. The final gate after each high-risk round and at the end is
the CLAUDE.md §3 procedure (`./dev-test/google-drive/run.sh --medium`, server vitest with
`--config test/vitest.config.mjs`, web vitest, tsc, eslint 0 warnings) — referred to as **§3**.

| ID | Behaviour | Command | Tier | Fails when it should? |
|----|-----------|---------|------|-----------------------|
| V1a | Row unchanged + `move_history` row → reads `newPath`, uploads, no error row | service spec `-t openOriginal` | task | Remove move lookup → terminal skip, test fails |
| V1b | Row unchanged, no move row, second re-read unchanged → terminal skip, `source_unreadable` recorded | same | task | Make it always retry newPath → fails |
| V1c | Move row but `newPath` also ENOENT → skip, detail names both paths | same | task | Drop old path from detail → fails |
| V1d | storage.core renames before updating the asset row | `storage.core.spec.ts` call order | task | Swap order in core → fails |
| V2 | `files.create` called with `retry: false`; a 5xx is not retried and is recorded | service spec | task | Restore retryConfig → call-arg assertion fails |
| V3 | `files.create` gets `signal` + `onUploadProgress`; idle 120 s → abort → `unknown` row + stream destroyed; progress resets the timer | service spec, fake timers | task | Remove timer reset → progressing upload aborts, test fails |
| V4 | 403 `insufficientPermissions` → `unknown`; `rateLimitExceeded`/`userRateLimitExceeded`/`dailyLimitExceeded` → `RateLimited`; `storageQuotaExceeded` → quota | `utils/google-drive.spec.ts` | task | Restore "any 403 = RateLimited" → first case fails |
| V5 | `handleNightlyJobs` queues `GoogleDriveUploadQueueAll` iff enabled; carries dedup id | `queue.service.spec.ts` | task | Disabled config still pushes → fails |
| V6 | Cap: asset below cap **is** returned; at/over cap excluded; blocking classes and RateLimited ignore the cap; after manual sync clears the row the asset is re-included | medium spec on `streamPendingUploads` | §3 | Drop cap predicate → capped asset returned; wrong predicate → below-cap asset missing (guards the silent "queues nothing" failure) |
| V7 | EACCES/EIO → retryable `source_unreadable` row | service spec | task | Map EACCES to terminal skip path → fails |
| V8 | Success after prior failure logs attempt count and deletes the error row | service spec | task | Remove log → fails |
| V9 | `streamPendingUploads` excludes other users' assets and deleted albums | medium spec | §3 | Remove `userId` / `deletedAt` predicate once → fails |
| V10 | Upload stream destroyed when `files.create` throws | service spec | task | Remove `finally` destroy → spy not called |
| V11 | Revoked token on `getStorage`/`getPickerConfig` clears grant, records `Revoked` | service spec | task | Skip clearRevokedGrant → fails |
| VF | Whole feature + regressions | §3 | §3 | — |

Every new test is broken once on purpose (the "fails when it should" column) and the red run is
noted in the review report.

## Task list (implementation ↔ verify pairs)

No todo tool is available in the session that wrote this plan, so the list is tracked here.
Tick boxes as rounds land.

- [x] 1. R0: D0 comment fixes → [x] verify:task → report R0 `be509702a` / review wave11a: NOT BLOCKED (M1, M2 folded into R1)
- [x] 2. R1: F1 `move_history` fallback in `openOriginal` → [x] verify:task V1a–V1f (3 mutations each went red)
- [x] 3. R1: F1p mover order pin → [x] verify:task V1d (swap went red) → [x] §3 `3cbdc45a9` PASS (medium 65/65) → report wave11b / review: NOT BLOCKED

R1 deviations from the plan, recorded rather than silent:
- V1d lives in `storage-template.service.spec.ts`, not `storage.core.spec.ts` — the core spec
  has no mock harness; the template service drives `moveFile` through `newTestService`.
- Added a guard the design review did not propose: the move row is used only if its `oldPath`
  equals the path that failed (the plan's "stale move row" risk is now tested, not just noted).
- The existing test "should not retry when the path has not changed" was renamed and its witness
  changed from 2 to 3 row reads + a move lookup — the contract changed, not the test to fit.

wave11b review verdicts, fed back (all folded into the R2 commit, so R2's review covers them):
- **M1 accepted, fixed:** the move-row branch now runs only when the first read failed with
  ENOENT. On the cross-device copy fallback a non-ENOENT failure (EMFILE/EIO) can happen while the
  copy is still being written; a partial `newPath` would have uploaded with a size check that
  agrees with the truncated length. New scenario **V1g**. Reachability in prod (upload and library
  on different filesystems) is unverified — fixed anyway, it is one condition.
- **N1 accepted:** during immich's incomplete-move recovery the `oldPath` guard declines a
  legitimate move (recovery rewrites `oldPath`). Cost: a retryable skip. Guard kept; comment no
  longer overclaims "covers exactly that window".
- N2 (docs drift), N4 (evidence header lacks file list): fixed below and in `run.sh`.
- N3: the mutation table under-reported reds — accepted, no change needed.

- [x] 4. R2: F4 `retry: false`, delete `shouldRetryDriveRequest` → [x] verify:task V2 (retry: true went red)
- [x] 5. R2: F2 idle abort → [x] verify:task V3 (4 mutations red). V10 already existed ("close the file when the connection drops mid-upload") — T2's fd half is therefore not new work
- [ ] 6. R2: F5 403 classification → [x] verify:task V4 (2 mutations red) → **§3 (risk:high)** → report R2

R2 deviation: F2 got a second budget the plan did not have — `UPLOAD_RESPONSE_TIMEOUT_MS`
(10 min) once the whole body is sent, because no progress events fire while Drive finalises the
file and a 120 s idle limit would cut large uploads off right at the end.
- [ ] 7. R3: F3 nightly queue + dedup id → [ ] verify:task V5
- [ ] 8. R3: F3 cap predicate + `mise //:sql` → [ ] V6 (medium)
- [ ] 9. R3: F6 EACCES/EIO + F7 attempt log → [ ] verify:task V7, V8 → **§3 (risk:high)** → report R3
- [ ] 10. R4: T1 medium + T2 unit tests → [ ] V9–V11 → **§3 final** → report R4

### Not verified in this wave
- Real Google API behaviour under 429/5xx/idle — mocked only.
- The F2 abort under a real slow upload.
- ~~A stale `move_history` row pointing at a different file: the size check is the only guard.~~
  Superseded in R1: the `oldPath` guard rejects such a row, tested as V1e.
- A real cross-device (EXDEV) move racing an upload — V1g reproduces it only by mock sequencing.

### Cannot be verified here
- Whether the nightly backfill heals transient failures in production — needs a few days of
  observation after deploy (error table + F7 log lines). Human step after deploy.
