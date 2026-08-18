# Roadmap Review — Google Drive Feature Roadmap

Design review of `dev-docs/google-drive/feature-roadmap.md` (Waves 1–4). No code exists yet, so this
verifies the **design judgments** and the two load-bearing API premises, then surfaces the seams
that will bite when the pending 1,809-photo sync actually runs.

| | |
|---|---|
| Reviews | `dev-docs/google-drive/feature-roadmap.md` |
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Reviewed | 2026-08-15 |
| Prior context | `dev-docs/review/google-drive/review/google-drive-r1r3-fixes-20260814-1744-review.md`, `dev-docs/google-drive/failure-handling-plan.md` |

---

## Overall

Strong plan. The §0 framing — Drive is a **transit buffer to the Pixel, not a destination** —
is the right organizing principle and correctly propagates into the big calls (quota is *when*
not *if*; file deletion is normal; ledger is truth). Sequencing is correct: defenses before the
big sync. The "deliberately not doing" list (§6) shows good restraint.

Most notes below are not "this is wrong" but "this seam will bite when the 1,809-photo sync runs."
**Eight substantive gaps**; gap **A** is a Wave 1 must-fix, gap **E** is cheap now and awkward to
retrofit later.

---

## The two empirical premises — both hold

### Q6 · `about.get(storageQuota)` with `drive.file` scope — CORRECT

Drive v3 `about.get` lists `drive.file` among its authorized scopes, and `storageQuota` is an
**account-level** field returned independent of which valid scope minted the token (scope
restricts *file* visibility, not account metadata). The gauge does **not** force a scope
expansion.

> **But confirm empirically before building Wave 2.** Being wrong means re-consent for every
> user. Mint an access token from a real stored refresh token and call
> `about.get({ fields: 'storageQuota' })` once. If it returns `{ limit, usage, usageInDrive }`,
> the gauge is unblocked. 30 seconds of insurance against an expensive assumption.

### §2.2 · quota classifier path — CORRECT

A googleapis Drive error surfaces as a GaxiosError where `error.response.data.error` is the
classic `{ code, message, errors: [{ domain, reason, message }] }` object, so
`…error.errors[].reason === 'storageQuotaExceeded'` is the right accessor — genuinely a
different shape than `invalid_grant` (a bare string at `…data.error`). Building a separate
classifier rather than overloading `isInvalidGrant` is right. `shouldRetry` is a supported gaxios
`retryConfig` callback, so immediate-fail-on-quota is feasible as described.

---

## Wave 1 — failure handling

The error-table design is sound (mirror polarity to the ledger, explicit recording on skip paths,
the two consistency rules). The recording-points table closes the skip-vs-record seam from the
last review. Four gaps:

### A. Nothing short-circuits the *current* backfill once a user hits quota  ·  **must-fix**

The anti-join excludes a quota-blocked user from the **next** backfill. But the run that
*discovers* quota has already streamed and enqueued potentially all 1,809 jobs for that user
before the first failure is recorded. With `shouldRetry` fast-failing quota those become fast
failures — good — but you still churn ~1,809 Drive calls, ~1,809 error rows, ~1,809 jobs to
discover what you knew after the first.

**Fix:** gate `uploadAsset` at entry on a cheap per-user "is this user already quota-blocked?"
lookup against the error table. The first job writes the quota row; the other ~1,808 already-queued
jobs skip immediately instead of each calling Drive. Converts *N slow failures* into
*1 failure + (N−1) cheap skips* within the same run — the "stop the silent waste" goal of §2.2,
applied to the in-flight run, not just the next one. At 2 users the lookup is free; the payoff is
the difference between 1 and 1,809 quota calls on the exact sync this is being built for.

### B. `deletedAt` must filter all three counts, or `pending` goes negative

§3.1 excludes deleted assets "from total." They must be excluded from `uploaded` and `failed`
too. An asset uploaded (ledger row) then soft-deleted, with `deletedAt` filtered only on `total`,
leaves `uploaded` counting it and `pending = total − uploaded − failed` going negative. Apply the
filter uniformly. (Also confirm whether the ledger row cascades on asset delete — if not, this
filter is the only thing keeping counts honest.)

### C. Resume should re-kick the user's backfill, not wait for the "next trigger"

§2.2 resume deletes the quota rows "→ 다음 트리거에서 재개." The next trigger may be days away.
A user who just freed space and clicked **Resume** expects uploading to start now. Make resume
*also* enqueue that user's pending set (a scoped backfill).

### D. Notification transition-detection is racy under 5 workers

"Notify when the quota classification first appears" needs insert-vs-update discrimination. With
concurrency 5, five workers can each read "no row yet" and each fire → up to 5 duplicate banners.
Harmless but sloppy. Derive "first" from an atomic `INSERT … ON CONFLICT DO NOTHING` on a per-user
marker, or accept rare double-fire and dedup in the UI. One sentence in the plan.

**Backoff note for the 1,809 run:** at concurrency 5 you'll hit per-user rate limits (429 /
`rateLimitExceeded` 403), which `shouldRetry` keeps. Confirm the retry uses exponential backoff
with jitter, not a flat `retryDelay: 1000` — a fixed 1 s retry across 5 workers can sustain the
rate-limit rather than clear it.

---

## Wave 2 — dropdown + storage gauge

Definitions are careful; owner-based / ledger-wins / `deletedAt` semantics are right. Two things:

- **Gauge and quota-block share thresholds — good and consistent**, because the menu is
  owner-only so the viewer *is* the upload target. Confirm the gauge's source (`about.get` on the
  authenticated user) and the block's subject (owner's Drive) are the same person in every path —
  they are, as long as the menu never renders for a non-owner.
- **`GET /google-drive/storage` must handle a revoked token gracefully.** `about.get` on a user
  whose grant was revoked throws `invalid_grant`; return a "disconnected" shape, not a 500 — the
  same handling `uploadAsset` already has. Add it to the endpoint contract.

---

## Wave 3 — progress polling

Polling-over-websocket is right at this scale; Page-Visibility pause + backoff-on-no-change is
good hygiene. One architectural mismatch:

### E. The progress card can't measure Wave 4's selective upload  ·  **design now**

Wave 3's card polls the **album** status endpoint (owner-based, album-scoped). Wave 4's selective
upload goes to the **user's own** Drive and isn't album-bound (selection can span albums or the
timeline). So "Wave 3's card reacts to this trigger too" (§5.1) has nothing album-scoped to poll.
You need a **per-user pending count** source (e.g. `GET /google-drive/me/status →
{ pending, failed }`) distinct from the per-album endpoint. Decide this in Wave 2 when designing
endpoints, not in Wave 4 — otherwise the card's data model gets retrofitted awkwardly.

**Q4 (card appears only for user-initiated sync in this tab):** defensible, but lost on
refresh/navigation — a sync you started then reloaded becomes invisible until you open the menu.
Fine for a family server; document the edge. Robust alternative: show when `pending > 0` **and**
connected **and** (session-initiated *or* last poll showed movement).

---

## Wave 4 — selective upload + autoSync

### §5.1 selective upload — download-equivalence is the right boundary, with one guard

**Q1:** If a user can view and download an asset, they can already exfiltrate it; uploading it to
*their own* Google account is the same trust boundary, not a new one. Download-equivalent is
correct. **Guard:** gate on the exact download permission (the `checkDownloadAccess`-equivalent),
not merely read/thumbnail access, and route partner-shared / shared-link contexts through that
same check. The subtle case is a shared album whose owner wouldn't expect a viewer to bulk-copy it
into the viewer's personal Google — still within download-equivalence, so allowed, but if a
"downloads disabled" flag ever exists, selective upload must inherit it by sharing the permission.

### §5.2 autoSync — endorse the in-util credentials lookup

**Q2:** Do the lookup inside `queueGoogleDriveUploads`. The cost (one PK lookup per album-add) is
trivial and is really a *fix*: today you enqueue no-op jobs for unconnected owners and skip them in
the worker, so folding connected-check + autoSync into one `getCredentials(ownerId)` at queue time
*removes* wasted jobs. The alternative (resolve in the caller, pass a param) spreads the lookup
across call sites and invites drift — the exact thing the `isGoogleDriveEnabled` wrapper exists to
prevent.

Notes: `autoSync default true` correctly preserves current behavior on migration; autoSync is the
*owner's* toggle and auto-upload targets the *owner's* Drive, so a contributor's add-to-shared-album
respects the owner's toggle. Consistent.

---

## Answers to §8

| # | Question | Answer |
|---|---|---|
| 1 | Selective-upload permission | **Download-equivalent.** Gate on the real download permission; inherit any "downloads disabled" flag. |
| 2 | autoSync check location | **In the util** via `getCredentials(ownerId)` — net reduction in work, one definition of "eligible." |
| 3 | Quota resume race | **Natural convergence is sufficient** (re-block is idempotent) — but add gap C: resume must re-enqueue, else it doesn't resume. |
| 4 | Progress-card appearance | **Acceptable**, document the refresh-loses-card edge; robust form triggers on `pending>0 + connected + movement`. |
| 5 | Owner-fixed status counts | **Correct**, but label it ("Backed up to [owner]'s Drive — N/M") so a viewer doesn't read the owner's number as their own. |
| 6 | `about.get` scope | **Premise holds**; confirm empirically once before building — blast radius justifies 30 seconds. |

---

## Prioritized additions

1. **(A) Per-user quota short-circuit at `uploadAsset` entry** — Wave 1 must-fix; the difference
   between 1 and 1,809 quota calls on the sync this is built for.
2. **(E) A per-user (non-album) progress/status source** — decide in Wave 2 so Wave 3's card and
   Wave 4's selective upload share one honest data model.
3. **(B) `deletedAt` on all three counts · (C) resume re-enqueues · storage endpoint handles
   `invalid_grant`** — small, correctness-preserving.
4. **(D) transition-safe notification · exponential backoff for the bulk run** — polish, but the
   backoff matters specifically during the 1,809 sync.
5. **Synergy:** once `about.get` lands in Wave 2, a *pre-flight* quota estimate ("2.7 GB free;
   ~1,809 photos ≈ 8 GB, will stop partway") preempts the churn instead of reacting to it. Nearly
   free once the storage endpoint exists — consider pulling that slice of Wave 2 before the big sync.

---

## Bottom line

The design is sound and merge-shaped Wave by Wave. Gap **A** is the one I would not run the
1,809-photo sync without; gap **E** is the one that's cheap to design now and awkward to retrofit
later. Everything else is refinement.
