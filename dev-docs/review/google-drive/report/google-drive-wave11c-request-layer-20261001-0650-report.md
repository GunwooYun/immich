# Review request — wave11c (R2): request layer + wave11b fixes

- Branch: `feat/google-drive-album-sync-v3.1.0`
- Range: `65cd3cf13..d34c7a5da` — code in `9be13b05a`, docs/run.sh in `d34c7a5da`
- Plan: `dev-docs/google-drive/stabilization-plan.md` — round R2 (F4, F2, F5); scenarios V2, V3, V4, V1g
- Previous: wave11b review NOT BLOCKED; its M1 and N1 are fixed in `9be13b05a` (so they are review targets here, §2.4)

## What changed

| File | Change |
|---|---|
| `server/src/services/google-drive.service.ts` `uploadAsset` | `files.create` options: `retryConfig` removed → `retry: false`, `signal`, `onUploadProgress`. Stall watchdog: `AbortController` + timer, 120 s idle (`UPLOAD_IDLE_TIMEOUT_MS`), switches to 600 s (`UPLOAD_RESPONSE_TIMEOUT_MS`) when `bytesRead >= streamInfo.length`; cleared in `finally`. Aborted uploads record detail `Upload stalled: …` |
| same, `openOriginal` / `findMovedOriginal` | wave11b M1: move-row branch only when `isFileMissing(error)` (ENOENT) |
| `server/src/utils/google-drive.ts` | `shouldRetryDriveRequest` deleted; `RATE_LIMIT_REASONS` set (+ `dailyLimitExceeded`, `sharingRateLimitExceeded`); non-rate-limit 403 → `Unknown`; new `isFileMissing` |
| specs | request-layer describe (5 tests, fake timers), 2 classification tests rewritten, `shouldRetryDriveRequest` tests deleted, V1g test |

## Please attack

1. **The watchdog wiring against the real library.** Tests mock `files.create`, so they prove we
   *pass* `signal`/`onUploadProgress`, not that googleapis-common 7.2.0 / gaxios 6.7.1 / node-fetch
   honour them for a multipart stream body. Please read the library path:
   `apirequest.js` (does it forward `signal` into the gaxios options? does `onUploadProgress` fire
   per chunk from `ProgressStream`, and with *cumulative* `bytesRead`?), gaxios `_request` →
   node-fetch (does abort destroy the piped body and reject?). If `bytesRead` is per-chunk rather
   than cumulative, the switch to the response budget never happens — say so.
2. **`bytesRead` vs `streamInfo.length`.** The multipart body also carries the JSON metadata part
   and boundaries. Is `bytesRead` counted on the media part only (pStream sits on `part.body`)? If
   it included the preamble, the switch would fire early — harmless (longer budget) — but confirm.
3. **Token refresh inside the watchdog.** The timer is armed before `files.create`, so an access-
   token refresh happens under the 120 s idle budget. Any path where refresh legitimately takes
   longer, or where an abort during refresh is misclassified (e.g. looks like `invalid_grant` and
   deletes credentials)?
4. **`retry: false` really disables retry.** gaxios `getRetryConfig` (`retry.js:18`) — with no
   `retryConfig` and `retry: false`, confirm no retry path remains (including `noResponseRetries`).
5. **F5 blast radius.** Anything else that branches on `RateLimited` (UI copy, `getErrorSummary`,
   retry/resume endpoints, notification) whose behaviour changes when bare 403s become `Unknown`?
6. **wave11b M1 fix.** Is `isFileMissing` correct for the errors `storageRepository.createReadStream`
   actually throws (does it `stat` first and throw a raw `ErrnoException`, or wrap it)?
7. The forward reference in the classify comment ("retries without an attempt cap (wave11 R3)")
   describes R3, which is not implemented yet. Flag it if you think it should not land before R3.

Don't read generated files; no DTO/query changed in R2.

## Test evidence

`./dev-test/google-drive/run.sh --medium` → `dev-test/google-drive/results/20261001-0643.txt`

| | |
|---|---|
| commit | `d34c7a5da` + uncommitted `M mise.lock` only (pre-existing, unrelated — now listed in the header) |
| server unit | 322 / 322 |
| web unit | 87 / 87 |
| svelte-check | no regressions vs baseline (3 pre-existing) |
| medium | 65 / 65 |
| result | **PASS** |

Rest of §3 at `d34c7a5da`: `tsc` exit 0; `eslint src test --max-warnings 0` exit 0; server vitest 94
files, 2449 passed / 2 skipped; web vitest 603 passed / 2 skipped.

### Negative runs (each applied, run, reverted; files byte-compared after)

| Mutation | Red |
|---|---|
| `retry: false` → `true` | "disable in-request retries and pass the stall watchdog" |
| progress callback never re-arms | "keep a slow upload alive…", "longer response budget…" |
| response budget = idle budget | "longer response budget…" |
| `clearTimeout` removed from `finally` only | "not leave the watchdog armed…" |
| any 403 → RateLimited | "403 that is not a rate limit…", "folder-permission … 403s" |
| `dailyLimitExceeded` removed | "rate-limit reason codes and any 429…" |
| ENOENT gate removed (`sourceMissing \|\| true`) | "not follow the move row when … other than ENOENT" |

Honesty notes: a first `clearTimeout` mutation via sed also hit the one inside `armStallTimer`
(same indentation); it was redone precisely and only the intended test went red. The V1g test
first asserted the errno appears in the recorded detail — wrong about the existing contract (the
skip records the path only); the assertion was corrected, not the code.

## Verified / not verified

- Verified with mocks: option wiring, timer behaviour, classification, ENOENT gate.
- **Not verified:** that the real library honours `signal` and emits cumulative progress (item 1
  above is the main ask); a real slow or stalled upload; real 403 reason payloads from Google.
- Latency change accepted by plan: with in-request retry gone, a transient 429/5xx waits for the
  next manual sync until R3's nightly backfill lands.
