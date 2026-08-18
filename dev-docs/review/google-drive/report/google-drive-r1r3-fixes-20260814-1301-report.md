# Code Review Request #2 — Fixes from the First Review

Scoped follow-up. The first review (`dev-docs/review/google-drive/review/google-drive-full-branch-20260814-0032-review.md`) confirmed the branch and
found three residual issues, R1–R3. This request covers **only the two commits written in
response** — the code that fixed R1–R3 has itself not been reviewed yet, and R2's size
verification in particular is new logic, not a tweak.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commits under review | `b7d21efce` (the fixes), `ee983be17` (docs only) |
| Diff | `git diff b6ef3b39c..ee983be17` — 8 files, +640/−12 excluding regenerated artifacts; the interesting part is +299/−12 across 6 files in `server/src` |
| Everything before `b6ef3b39c` | already reviewed; please don't re-tread it |

---

## What changed, and what to poke at

### 1. R1 fix — `removeOnFail: true` on the Drive upload queue

`job.repository.ts`: the `GoogleDriveUpload` case now returns
`{ jobId, removeOnFail: true }`, overriding the global `removeOnFail: false`. Rationale: BullMQ
refuses to enqueue a job whose id exists in any state, so a retained failed job poisoned its
`(userId, assetId)` pair against every retry path.

**Questions:**
- Is my reading of BullMQ correct that removing the failed job actually frees the custom `jobId`
  for re-enqueue? (I verified behaviourally in the rehearsal env, not in BullMQ's source.)
- The cost is that Drive failures no longer appear in the admin Jobs panel failure count. I judged
  logs + backfill-retry to be enough for a self-hosted instance. Reasonable, or should a failure
  be recorded somewhere queryable before the job is dropped?

### 2. R2 fix — size verification before the ledger write

`google-drive.service.ts#uploadAsset`: the create call now requests `fields: 'id,size'`, and the
response size is compared to the byte count from `createReadStream` (an `fs.stat` at open time).
On mismatch: delete the partial Drive file (best-effort, inner catch so a delete failure can't
mask the real error), then throw. A **missing** size is treated as unverifiable → throw, on the
grounds that Drive omits `size` only for Google-native docs, which we never create.

This *mitigates* the non-rewindable-stream replay hazard rather than eliminating it — a retry
that truncates mid-stream now fails loudly instead of being ledger-recorded as done.

**Questions:**
- Is the premise right that `drive.files.create` with `uploadType: 'resumable'` returns the final
  stored `size` in the create response? If it can be absent or stale for ordinary binary files,
  this check would produce false failures.
- `Number(data.size)` on Drive's string size, strict-compared to `streamInfo.length` — any edge
  I've missed (0-byte files return `'0'`, which is handled; anything else)?
- Would you instead eliminate the hazard at the source — e.g. buffering small files / a stream
  factory per attempt — and keep the size check only as a backstop?

### 3. R3 fix — unreadable original file → skip

The `createReadStream` call is wrapped; any throw becomes a `'skipped'` with a warning naming
the path. **Deliberately broader than ENOENT**: EACCES and friends are also not coming back on a
blind retry, and pre-R1 any failure here poisoned the pair. But it does mean a *transient* I/O
error (NFS blip, disk hiccup) is silently skipped until the next backfill.

**Question:** right call, or should only ENOENT skip and other codes still fail (now that R1
makes failure recoverable)?

### 4. The `enabled` flag threaded into `queueGoogleDriveUploads`

`utils/google-drive.ts` takes `enabled: boolean` as a parameter (it's a plain function with no
config access); `AlbumService` resolves it once per request via a small private wrapper;
`GoogleDriveService.syncAlbum` passes literal `true` because it already threw at the top if the
feature was off. Also new: `syncAlbum` now rejects with a message when disabled, instead of
enqueuing jobs the worker discards behind a success toast.

**Question:** the literal `true` is justified by a comment but is the kind of thing that rots if
someone reorders the guard — acceptable, or would you re-derive it?

### 5. Tests — including a module-level `googleapis` mock

Three upload-verification tests needed `vi.mock('googleapis')` with hoisted `files.create` /
`files.delete` fns — first module mock in this spec file. Also: fixing R3 exposed that an album
spec test ("no queue when everything's in the ledger") was passing only because the feature was
disabled in default config; it now stubs an enabled config **and asserts the ledger was
consulted**. Same vacuous-pass pattern the first review caught once already — worth a skeptical
eye on the remaining assertions.

### 6. Merge-artifact repair (found while verifying, not by the review)

The v3.1.0 merge commit had staged v3.1.0's `pnpm-lock.yaml` and four Dart SDK files *before*
regeneration ran, so the committed lockfile lacked `googleapis` (breaking any
`--frozen-lockfile` install) and the Dart SDK lacked the Drive job names. Regenerated and
committed; `pnpm install --frozen-lockfile` now passes.

---

## Verification already done

`tsc --noEmit` and `eslint --max-warnings 0` clean · 2,278 server unit tests pass (6 new) ·
SQL artifacts regenerated, no drift · rehearsal against a fresh copy of the production DB
(5,708 assets): 5 migrations clean, boots `[v3.1.0]`, counts unchanged · deployed to the real
instance afterwards without error.

## Priority

1. **§2** — new logic guarding data integrity; wrong premise = false failures at scale.
2. **§1** — whether dropping failure visibility is an acceptable trade.
3. **§3** — skip breadth.
