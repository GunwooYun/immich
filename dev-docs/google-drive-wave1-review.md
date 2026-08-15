# Code Review — Wave 1: Failure Recording & Quota Defense

Review of commit `a8959bd3e` (roadmap Wave 1). Verified the `firstOfClass` SQL against Postgres
CTE-snapshot semantics, traced every classification path, and checked the disconnected-user story
end to end (service → DTO → banner).

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit | `a8959bd3e` |
| Reviewed | 2026-08-15 |
| Request | `google-drive-review-request-3.md` |

## Verdict

High-quality work — the SQL is correct and the reasoning is honest. **One real correctness risk**
(404 → account block), **one intent-vs-implementation gap** (disconnected banner never explains a
revoked disconnect), and smaller notes. Fix #1 and #2 below before the 1,809-photo sync.

---

## 1. `firstOfClass` upsert — ✅ correct, ship it

**CTE-snapshot reasoning is sound.** Postgres evaluates all sub-statements of one statement against
a single snapshot taken at statement start, and a data-modifying CTE's effects are not visible to
sibling CTEs. So `others` and `old_row` genuinely read the pre-`ins` state
([google-drive.repository.ts:259-284](../server/src/repositories/google-drive.repository.ts#L259)).

**Logic is right.** `firstOfClass = (others.c = 0) AND (coalesce(old_row.error,'') <> class)` =
"no *other* asset has this class **and** this asset didn't already have it" = genuine
first-appearance-for-user. Transition edges all check out:

- `rate_limited` asset → first `quota_exceeded`: `others=0`, `old_row='rate_limited'≠'quota'` → **true** (notifies). ✓
- same asset fails quota again: `old_row='quota'` → **false**. ✓
- asset B fails quota after A did: `others=1` → **false**. ✓
- post-resume re-block (rows cleared, fails again): `others=0`, `old_row` empty → **true** (re-notifies). ✓ correct

**The accepted race is safe in the right direction.** The concurrent-distinct-asset window can only
ever *over*-notify, never *under*-notify: for `firstOfClass` to be wrongly false, a row of that
class must already exist — i.e. it isn't actually first. Same-asset concurrency can't occur (jobId
dedup = one in-flight job per pair). Bounded by concurrency (5), once per transition, over-notify
only. Taking this over a per-failure advisory lock is the right call. **No change.**

Non-issue verified: `insert … on conflict do update … returning 1` always returns one row, so the
`?? false` fallback is never actually reached.

---

## 2. `shouldRetry` replacing `noResponseRetries` — accept, name the cost precisely

Correct read: supplying `shouldRetry` makes gaxios use it *instead of* its default, so
`status === undefined → false` drops the no-response retries (ECONNRESET fails immediately). Accept,
and it's slightly better than argued, with one caveat:

- **For mid-stream resets it's actively correct** — the body is a non-rewindable `fs.ReadStream`;
  retrying a partially-consumed body truncates. Failing fast avoids that.
- **The real cost is pre-body transport blips** (DNS, connect-refused, TLS) — safe to retry, no
  bytes sent — now also fail immediately. Indistinguishable from mid-stream resets at the error
  level, so failing all is defensible. **But** they land as `unknown` and there is **no automatic
  scheduled backfill** — recovery is a *manual* re-run. Document it as "transport errors defer to
  the next manual trigger," not "stay retryable" in the abstract.
- **Load-bearing detail:** the predicate now fully owns the attempt cap (`attempt >= maxRetries →
  false`) — gaxios no longer enforces the count. Correct as written, but safety-critical and prone
  to silent breakage on a gaxios bump. Pin it with a test asserting the 6th call returns false.

**Verdict: accept the downgrade** — net-safer for a non-rewindable body.

---

## 3. Classification breadth — 🔴 fix the 404 → account block before deploy

### Any 404 → `FolderMissing` → whole-account block — real false-positive

The worst failure mode the system can produce, and reachable by more than folder-gone
([utils/google-drive.ts](../server/src/utils/google-drive.ts) `classifyDriveError`: `status === 404
→ FolderMissing`):

- **Resumable-session 404.** `uploadType: 'resumable'` uploads to a session URI; Google returns
  **404 for an expired/invalid upload session** — transient, recover by restarting the upload, not
  by concluding the folder is gone. `shouldRetry` now fails 404 immediately (no retry to absorb a
  transient one), so a single spurious session-404 → `FolderMissing` → blocks the whole account.
- Blast radius: all the user's uploads stop until they re-pick a folder (cleared via `setFolderId`).
  Cure is mild, but a transient hiccup silently blocking an account is exactly what this wave exists
  to prevent.

**Fix (either is enough, option 1 is smaller):**
1. Require `status === 404 && getDriveErrorReason(error) === 'notFound'` (and ideally only when a
   `folderId` was set); classify all other 404s as `Unknown` (retryable, **non-blocking**).
2. On 404, `files.get(folderId)` to confirm the folder is really gone before blocking.

### Non-quota 403 → `RateLimited` — mostly right, terminal edges

With `drive.file` scope a permission 403 on own files is near-impossible, so default-to-retryable is
reasonable. But two terminal 403s become **infinite-retry long-tails** (re-attempted every backfill,
never blocking, never ledgered): a Picker-selected folder created by another app / shared
(permission 403), and folder child-count limits (`numChildrenInNonRootLimitExceeded`). Consistent
with the accepted "uncapped long-tail, surface `attempts`" policy, so not a blocker — but the
picker-folder case is plausible; consider naming those reasons terminal alongside the 404 fix.

---

## 4. Entry-gate position & cost — ✅ fine

One indexed `getBlockingError` after credentials, before `hasUpload`
([google-drive.service.ts:537-551](../server/src/services/google-drive.service.ts#L537)). Necessary
exactly there: the backfill anti-join keeps blocked users out of *future* runs, but a mid-backfill
quota hit leaves ~1,800 jobs already queued — the gate makes those skip (gap A). Folding into the
credentials query is a valid future optimization; at this scale the separate lookup is noise. Don't
cache per-worker — the row appears *during* a run, so a cache defeats the gate. Leave it.

---

## 5. `getStatus` for disconnected users — 🟠 cost real, benefit not delivered

You asked for a cost/benefit check. The cost is real (two extra queries per settings render) and the
stated benefit does not reach the UI:

- The justification is "after a revoked-grant disconnect, `blockedReason` explains why." But
  `blockedReason` comes from `getBlockingError`, filtered to
  `GOOGLE_DRIVE_BLOCKING_ERROR_CLASSES = [QuotaExceeded, FolderMissing]` — **`Revoked` is not in the
  set**, so `blockedReason` can never be `revoked`. The DTO documents only
  `'quota_exceeded' | 'folder_missing'`, and the Svelte banner branches on only those two.
- A revoked/disconnected user gets `blockedReason: null` → the generic
  `{#if failedCount > 0 && !blockedReason}` → "N uploads failed" — **no "access revoked, reconnect"
  explanation**, which is the exact thing this path was added to provide. The one-time notification
  says "reconnect," but a user who misses it sees a bare count on the settings page.

**Pick one:**
- **Deliver it:** report `revoked` as the reason on the disconnected path (widen `getBlockingError`
  for that call, or add a separate `disconnectReason`) and add a reconnect banner branch.
- **Drop the cost:** skip `getErrorSummary` when there are no credentials and rely on the
  notification (`failedCount` is barely actionable while disconnected anyway).

As written it's the worst of both — queries paid, user unexplained.

---

## 6. Nullable-enum convention — acceptable escape

The `null`-member-in-enum → initializer-less `Null` → self-wedging pipeline is a real toolchain
wart; nullable-string-with-documented-values is a fair dodge. No clearly cleaner convention this
toolchain won't fight. Only cost: lost type-narrowing — the SDK types `blockedReason` as
`string | null`, so the Svelte string-compares against literals with no compiler check. Fine for two
values and one consumer; revisit if the vocabulary grows. Stands.

---

## Smaller notes

- **`folder_missing` blocks the whole account but never notifies** (only quota + revoked do). A
  deleted destination folder halts everything as hard as quota; the user discovers it only on their
  next Settings visit. Consider giving it the same one-time notification.
- **`getBlockingError` doesn't apply the ledger-wins anti-join** (unlike `getErrorSummary`'s count).
  Immaterial in practice (a blocking-class row can't coexist with a ledger row for the same asset,
  and the `recordUpload` transaction closes the window) — minor asymmetry only.
- **Verification gap:** the table, its migration, and the whole quota path are exercised only through
  mocked `files.create` rejections — never on the real DB or a live full Drive. Since this ships to
  protect the 1,809-photo sync, rehearse the quota-block → gate-skip → resume loop live, with the
  404 fix in first.

---

## Priority

1. **Fix 404 → account-block** (#3) — gate `FolderMissing` on `notFound` + folder-set; bare/session
   404 → `Unknown`. The one real correctness risk, and it ships right before the big sync.
2. **Resolve the disconnected-banner gap** (#5) — surface `revoked` as a reason, or stop paying for
   the summary.
3. Nice-to-have: pin the gaxios attempt-cap with a test (#2); notify `folder_missing`; name the
   terminal 403s.

Everything else — the `firstOfClass` SQL, the entry gate, the resume convergence, the
recording-point coverage — is correct and well-argued. Strong wave.
