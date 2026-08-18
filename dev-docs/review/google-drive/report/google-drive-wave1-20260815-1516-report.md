# Code Review Request #3 — Wave 1: Failure Recording & Quota Defense

The roadmap's Wave 1, implemented in a single commit. This is the layer everything later leans
on (Wave 2's failure counts, Wave 3's progress card, the resume UX), and it is being deployed
**before** the remaining 1,809-photo bulk sync specifically so quota exhaustion mid-run is cheap
instead of catastrophic — so correctness here matters more than usual.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit under review | `a8959bd3e` (everything before it already reviewed in rounds 1–3) |
| Diff | `git show a8959bd3e` — 21 files, +1,304/−60; excluding generated artifacts: 15 files, +1,040/−60 |
| Design basis | `dev-docs/google-drive/feature-roadmap.md` §2 (gaps A/C/D already folded in), `dev-docs/review/google-drive/review/google-drive-roadmap-20260815-1511-review.md` |
| Tests | 2,298 server + 518 web pass; 34 new/updated; migration drift check clean |

## What shipped (short form — the roadmap §2 is the long form)

- `google_drive_upload_error`: mirror polarity to the ledger; success deletes the row in the
  same transaction as `recordUpload`; readers treat ledger rows as authoritative.
- Recording at every terminal point per the roadmap table — including the skip paths that never
  reach a catch (`source_unreadable`, `revoked`), and deliberate non-recording for
  trashed/not-connected/feature-off/already-uploaded.
- Quota defense in three layers: `shouldRetry` fails quota-403/404 instantly; a per-user entry
  gate in `uploadAsset` skips already-blocked users without touching Drive (gap A); the backfill
  anti-joins blocked users out (and `streamPendingUploads` gained an optional `userId` for the
  resume path).
- `POST /google-drive/resume`: clears blocking rows *and* immediately re-queues the user's
  pending set (gap C).
- Self-healing clears: `setFolderId` clears `folder_missing`; re-linking clears `revoked`.
- One notification per class transition (quota, revoked), via a single-statement
  `firstOfClass` upsert; `NotificationType.Custom` so no enum/SDK churn.
- `getStatus` gains `failedCount` + `blockedReason` (also for disconnected users — the revoked
  rows are what explain an automatic disconnect); settings banner with resume button.

## Where to attack

### 1. The `firstOfClass` upsert (`google-drive.repository.ts#upsertError`) — highest value

A single SQL statement: two CTEs read the pre-statement snapshot (`others` = rows of this class
for this user excluding this asset; `old_row` = this asset's previous class), then the upsert
runs, and `firstOfClass = others.c = 0 AND old_row.error ≠ class`. Questions:

- Is the CTE-snapshot reasoning sound in Postgres (all parts of one statement see the same
  snapshot, so the reads genuinely precede the write)?
- Class-transition edges: an asset that previously failed as `rate_limited` becoming the user's
  first `quota_exceeded` → should notify (old_row check handles it) — do you see an interleaving
  where a transition is missed or double-fired beyond the documented concurrent-insert window?
- The accepted race (two workers, different assets, same instant, both "first") is bounded by
  queue concurrency (5) and happens at most once per transition. We took this over an advisory
  lock per failure. Reasonable?

### 2. `shouldRetry` replaces gaxios's default — one behavior change is deliberate but debatable

Supplying `shouldRetry` bypasses not only `statusCodesToRetry` but also gaxios's
`noResponseRetries` handling. Consequence: a **network-level error with no HTTP response**
(ECONNRESET mid-upload) now fails immediately instead of getting the default no-response
retries. Rationale for accepting this: such a failure lands in the error table as `unknown`,
stays retryable, and the next sync/backfill picks it up — and a mid-stream retry on a
non-rewindable body is exactly the truncation hazard the size check guards against, so *not*
retrying transport errors in-request is arguably safer. **But it is a silent downgrade of
in-request resilience — verdict wanted.**

### 3. Classification breadth

- Any 404 → `folder_missing`, which *blocks the whole account*. For `files.create` with a
  `parents` id, a 404 should only mean the parent folder is gone — is there a plausible 404 that
  isn't the folder (bad upload session URL?), which would wrongly block the user? The cure is
  mild (pick folder / resume clears it), but a false account-block is still the worst failure
  mode this system can produce.
- Non-quota 403 → `rate_limited` (retryable) rather than terminal. With `drive.file` scope a
  genuine permission 403 on our own upload should be near-impossible — agree?

### 4. The entry gate's position and cost

Gate sits after the credentials fetch, before the ledger check — one extra indexed lookup per
job for every healthy user. At this instance's scale it's nothing; flag if you'd order it
differently (e.g. fold into the credentials query) or cache it per worker.

### 5. `getStatus` now runs the error summary for disconnected users too

Two extra queries on every settings render. Justified as "explains the automatic disconnect" —
sanity-check the cost/benefit.

### 6. The regeneration chicken-and-egg (process, not code)

A nullable zod enum produced a spec enum containing `null`, which oazapfts emitted as an
initializer-less `Null` member — and because the pipeline builds the (broken) SDK *before*
regenerating it, the broken file wedged its own fix until `git checkout` restored it.
`blockedReason` is now a nullable string with documented values. If you know a cleaner
convention for nullable enums in this OpenAPI toolchain, name it — otherwise this stands.

## Verification done

`tsc`/`eslint` clean on server and web · full suites green (2,298 / 518) · sql-tools drift
check: no changes · dev-DB migration applied via the runtime's `allowUnorderedMigrations`
(dev-only history quirk from the pre-merge era; production history is ordered) · the recording
table's every row has a corresponding assertion, including the three deliberate non-recordings.

Not yet done: deployment to the laptop (waiting on this review), and therefore no live quota
rehearsal — the quota path is exercised only through mocked `drive.files.create` rejections.
