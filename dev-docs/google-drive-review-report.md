# Code Review Report — Google Drive Album Sync

Independent verification of the feature branch, cross-checked against the author's own
briefing (`google-drive-review-request.md`). Every claim in that document was **re-derived
from the actual code** rather than taken at face value.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Base | `v3.1.0` |
| Repository | fork of `immich-app/immich` |
| Reviewed | 2026-08-13 |
| Method | 3 finder passes → 3 adversarial verifiers, each traced to source |

---

## Verdict — Ship-worthy, with one fix

The briefing is honest and accurate; nearly every claim holds against the code, and every
High/Medium issue from the earlier branch review is genuinely resolved — including all three
security decisions. **Three residual issues remain**, one of which contradicts the document's
own recovery story and should be fixed before merge.

| Metric | Result |
|---|---|
| Major claims verified true | **11 / 11** |
| Security decisions confirmed sound | **3 / 3** |
| Residual issues found | **3** (2 medium · 1 low) |

---

## 1. Claims verified against the code

Each was traced to file and line by an independent pass instructed to *refute* it. All survived.

| Claim | Evidence | Status |
|---|---|---|
| **§3.1 OAuth callback three-way binding** — signature + HttpOnly cookie + `userId===session`; route is `@Authenticated()`; genuinely closes the account-linking hijack | `controller:134–160`, `service:260,279`; SameSite=Lax survives Google's top-level GET | ✅ Confirmed |
| **§3.2 Picker access token** — `drive.file` scope only, per-caller, refresh token never leaves the server | mints only for `auth.user.id`; no cross-user path | ✅ Confirmed |
| **§3.3 Plaintext token, isolated table** — excluded from `columns.userAdmin`; in no DTO, response, or log | `user-google-drive.table.ts`; documented trade-off | ✅ Confirmed |
| **§3.4 Queueing after album write + emit** — both `addAssets` and `addAssetsToAlbums` | `album.service.ts:208, 298` | ✅ Confirmed |
| **§3.5 Owner-only sync, owner's Drive** — `ForbiddenException` if not owner; payload uses ownerId | `service:689–716` | ✅ Confirmed |
| **§4 `jobId` collapses duplicate jobs** — the concurrent double-click race is closed | `job.repository.ts:213,275`; routed via `.add()` | ✅ Confirmed |
| **§4 `@ChunkedSet` on ledger lookup** — the >65k-asset 500 is fixed; correct Set-union merge | `google-drive.repository.ts:152` | ✅ Confirmed |
| **§4 `try/finally` stream destroy** — fd leak fixed; destroy is unconditional | `service:628–637` | ✅ Confirmed |
| **§4 Trashed & deleted assets skip; invalid_grant handled** — no more BadRequestException from the worker | `service:524–532, 618–624` | ✅ Confirmed |
| **§4 Feature gate, no `process.env` fallback** — requires toggle AND complete client | `misc.ts:114`; only a comment remains | ✅ Confirmed |
| **§3.6 / §3.7 / §5** — force ignored · migrations · vacuous tests fixed; QueuePanel card now renders; `tsc --noEmit` clean (re-run); ledger test asserts the lookup | `QueuePanel.svelte`, `*.spec.ts:79` | ✅ Confirmed |

---

## 2. Residual issues the briefing does not cover

### R1 — Failed uploads are permanently stuck; the backfill cannot recover them  ·  **Medium**

**Location:** `config.repository.ts:289–290`, `job.repository.ts:275`

Global job options are `removeOnComplete: true, removeOnFail: false`, and Drive jobs carry
`jobId = ${userId}/${assetId}`. BullMQ won't enqueue a new job while one with that id still
exists — and a *failed* job is retained. So once an upload fails for a real reason (Drive quota
full, the picked folder deleted so uploads 404 after the 5 retries, a disk read error), that
`(userId, assetId)` pair is poisoned: re-adding the asset, "Sync album", and the admin
"queue all" all route through the same `jobId` and are handed back the old failed job. Nothing
re-runs until an operator manually clears failed jobs.

> **Contradicts the briefing.** §3.4 and §3.6 both claim the admin backfill recovers failed
> uploads. It recovers the Redis-outage case (job never enqueued → id is free), but **not**
> actually-failed jobs — the exact path the document says is covered.

**Fix:** set a `removeOnFail` policy for this queue, or document that failed Drive jobs require a
manual clear.

### R2 — Resumable upload of a non-seekable stream may silently truncate on retry  ·  **Medium**

**Location:** `google-drive.service.ts:546, 573, 584–596`

The upload body is a live `fs.ReadStream` with `uploadType: 'resumable'` and `retry: 5` on
403/429/5xx. If gaxios retries a request whose stream body was already partially consumed, a
non-rewindable stream can't replay — the retry may send truncated or empty content. Because
`recordUpload` runs on the retry's HTTP-200, a short file would be **ledger-recorded as done**
and never re-attempted. §4 sells resumable+retry as pure robustness; the replay hazard is the
missing caveat.

**Fix:** verify googleapis recreates the stream per attempt, or pass a stream factory / buffer
small files.

### R3 — A missing on-disk original throws instead of skipping  ·  **Low**

**Location:** `google-drive.service.ts:546`

Trashed and hard-deleted assets are handled, but if the row exists and isn't trashed while its
`originalPath` file is gone from disk, `createReadStream` throws ENOENT → the job *fails* rather
than skips. Combined with R1, that's another way to permanently poison an id.

---

## 3. Minor accuracy nits (not code defects)

- **§3.1 "matches Immich's own OIDC link endpoint"** — slight overstatement; Immich's IdP
  callback is not `@Authenticated()`. Your topology is different but sound.
- **§4 "called at the start of syncAlbum"** — `syncAlbum` has no enabled/config gate; it relies
  on the worker to skip. Harmless, but clicking sync on a disabled instance still enqueues.
- **§5 "86 assertions"** — not reproducible from a raw grep (31 + 195 `expect(`); presumably
  net-new Drive-specific assertions.
- **Hot-path ledger query** — `getUploadedAssetIds` still runs on every add-to-album even when
  the feature is off. Cheap, but a one-line guard removes it.
- **Expired session at callback** — returns a raw 401 JSON instead of the friendly
  `?google-drive=error` redirect. Pure UX.

---

## Bottom line

The document is trustworthy and the branch is in far better shape than the version first
reviewed — the security story in particular is solid, and I verified that rather than taking it
on faith.

The one thing to fix before calling this done is **R1**: "the backfill recovers failures" is
load-bearing in the design rationale and isn't true for actually-failed jobs, because
`removeOnFail: false` plus the dedup `jobId` poison the pair. **R2** is worth a quick check,
since a silent truncated upload defeats the whole point of the ledger.
