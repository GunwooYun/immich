# Code Review — Wave 2: album Drive menu, storage gauge, per-user status

Review of commit `8b3287b7a`. Verified the count-vs-stream predicate against the actual SQL, the
cache/credentials ordering, and the menu's load path against the live instance's two-user reality
(gunwoo connected, seohui not).

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit | `8b3287b7a` |
| Reviewed | 2026-08-20 |
| Report | `../report/google-drive-wave2-20260820-1030-report.md` |

## Verdict

Server side is clean and the two divergence questions resolve well (the count matches the stream
except the one intentional case). The **web menu has a real, live-relevant bug**: it renders for
every member now (correct for Wave 1.5) but its load path `Promise.all`-rejects for any *unconnected*
user — which is seohui on the production instance today. That, plus giving `me/status` a blocked
signal, are the two things to fix before deploy. Everything else is accept/minor.

The `about.get` premise is settled — the author's live probe returned real `storageQuota` under
`drive.file`, matching the roadmap-review conclusion. No need to re-derive.

---

## 🔴 The menu breaks for an unconnected user — and that's seohui, live

The old trigger was gated `{#if isOwned && featureFlagsManager.value.googleDrive}`. The new one is
just `{#if featureFlagsManager.value.googleDrive}` ([+page.svelte](../../../../web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte)). Dropping `isOwned` is **correct** for Wave 1.5 (a shared
member can back an album up to their own Drive, so they must see the menu). But `featureFlagsManager`
is the *server* flag — admin-configured — not "this user connected Drive." So the menu now renders
for members who have never linked their own account.

Opening it runs:
```js
await Promise.all([getGoogleDriveAlbums(), getGoogleDriveStorage(), getGoogleDriveStatus()]);
```
`getStorage` throws `BadRequestException('Google Drive is not connected')` when the caller has no
credentials ([google-drive.service.ts:281](../../../../server/src/services/google-drive.service.ts#L281)). Because it's `Promise.all`, that one rejection discards the
successful albums+status results too → the `catch` fires `unable_to_load_google_drive_status` → the
user gets an **error toast every time they open the menu**, and the menu falls back to "backup off /
open Drive" with no way to connect.

This isn't hypothetical: per Wave 1.5, only gunwoo has linked Drive; **seohui is an unconnected
member on the live 2-user instance**, so she hits this the first time she opens an album's Drive
menu. The roadmap (§3.2) explicitly specified the unconnected state — "show a single *Connect Google
Drive* entry → Settings instead of the menu" — and it wasn't built.

**Fix:** gate the storage call (and the gauge row) on `status.connected`, or use `Promise.allSettled`
so an unconnected/failed storage read doesn't sink the rest. And render the roadmap's "Connect Google
Drive → Settings" entry when `status.connected === false`, instead of a toast.

## 🟠 `Promise.all` couples the gauge to the backup toggle

Even for a *connected* user, this coupling is wrong in the smaller way: the backup on/off control is
driven entirely by `getGoogleDriveAlbums`, which has nothing to do with Google storage. But a
transient `getStorage` failure (Google 5xx, a just-revoked grant → 400) rejects the whole `Promise.all`
and disables the menu's primary function. The gauge is the *optional* part; it should fail
independently. `Promise.allSettled` with per-section fallbacks (toggle from albums, gauge from
storage, folder from status) makes each degrade on its own. This is the same fix as the finding above.

---

## Q1 — count includes blocked users: right raw number, but `me/status` can't say "paused"

The choice to count blocked users (unlike the stream) is the honest *raw* number — an account paused
on quota does still have that work outstanding, and reporting zero would read as "done." I agree with
that. The problem is composition: `getMyStatus` returns only `{pending, failed}` with **no blocked
signal**, and gap E's whole premise is that it's "the one honest thing the progress UI polls." A
Wave 3 progress bar polling `me/status` for a quota-blocked user would render, say, "1,800 pending"
ticking toward nothing, because the `blockedReason` that would explain it lives in a *different*
endpoint (`getStatus`).

Recall the Wave 1 shape makes this concrete: a quota-blocked user has ~a handful of `failed` (the
error rows written before the entry gate engaged) and the rest as `pending` (gated, no error row). So
`me/status` would report `pending: 1800, failed: 5` — indistinguishable from active progress.

**Fix:** fold the blocked signal into `me/status` (`blocked: boolean` or reuse `blockedReason`) so the
one-thing-to-poll is self-contained. Then Wave 3 can render "1,800 paused — Drive full" instead of a
spinner. Keep the count-includes-blocked; just make the endpoint able to say why it's not moving.
(Also note for Wave 3: `failed` here is `getErrorSummary().failedCount`, which lumps *every* class —
`revoked`, `source_unreadable`, `rate_limited`, etc. — so "failed" is "not-yet-succeeded," not
"permanently failed." The progress UI should treat it accordingly.)

## Q2 — count vs stream distinct: verified, they cannot disagree (except the intended case)

I traced the join cardinality. `countPendingUploads` is scoped to one user
(`where google_drive_album.userId = userId`), and every join is 1:1 for a given `(album, asset)`:
`google_drive_album` PK `(userId, albumId)`, `album_user` one row per `(albumId, userId)`,
`user_google_drive` per user, ledger left-join at most one row on the PK. So an asset in *N* of that
user's selected albums produces *N* rows, and `count(distinct album_asset.assetId)` collapses them to
1 — identical to the stream's `.distinct()` on `(userId, assetId)` (equivalent to distinct `assetId`
under the single-user scope). **They agree exactly**, and the only divergence is the deliberate one:
the count omits the blocking anti-join. No inflation from multi-album membership. Pass.

## Q3 — static cache: make it an instance field, and mind two edges

- **Static → instance.** Nest services are singletons, so an instance field gives the same
  process-wide sharing without the `GoogleDriveService.storageCache` global that leaks across tests
  (the explicit test-clearing the report flags as a smell is exactly that leak). No behavior change,
  cleaner, and the test smell disappears. Recommend the switch.
- **Unbounded growth** is low-severity here (one small entry per user, forever) but real at scale —
  no TTL sweep, entries persist past expiry until overwrite. Fine for a family fork; if this ever goes
  multi-tenant, cap it (LRU or size bound). Note it, don't block on it.
- **Cache is checked before credentials** ([service.ts:276-283](../../../../server/src/services/google-drive.service.ts#L276)), so a user who disconnects keeps getting a cached gauge for up
  to 60s. Self-heals, low severity — but if you want disconnect to reflect immediately, clear the
  user's cache entry in `disconnect()`/`linkAccount()`.

## Q4 — three calls, and all-albums-to-find-one: build the per-album endpoint before Wave 3

Reusing `getGoogleDriveAlbums` to display one album's state is acceptable at 4 albums, but it's
`getSubscribableAlbums`, which runs **two correlated count subqueries per album** — so it's O(albums)
work to render one album's row, and Wave 3 will make it *polled*. The roadmap (§3.1) originally
specified a per-album status endpoint; building `GET /google-drive/albums/:id/status` now (the natural
sibling of `me/status`) makes the menu O(1) and gives Wave 3 something cheap to poll instead of
re-running every album's subqueries every few seconds. Not urgent for this diff; do it before Wave 3
wires polling.

## Q5 — `onOpen` on `ButtonContextMenu`: accept

Three additive, optional lines, and lazy-loading a costly menu is the right call over loading on mount
(which would tax every album render — the thing being avoided). Merge-surface cost is minimal.
Consider upstreaming it (it's genuinely general), which would remove the fork carry entirely. Accept.

## Q6 — trash fetched but unused: keep the field, and consider *surfacing* it

Keeping `usageInDriveTrashBytes` in the DTO is fine (cheap, real, already proven available). But I'd
push back on "premature": on this deployment trash is **107 GB of 119 GB used** — it's the *most*
actionable number, the one that tells the user to go empty the Pixel-transferred files. The current
menu shows only `usage / total` as text. When you build the fuller view, lead with reclaimable trash,
not raw usage — for a transit-buffer instance that's the number that drives the cleanup the whole
model depends on. Not this wave, but don't file it as "not needed."

---

## Also worth flagging

- **The gauge is text, not a gauge.** The roadmap (§3.2) specified a bar with color thresholds
  (≥80 % yellow, ≥95 % red) whose *purpose* was to prompt Pixel cleanup before Drive fills. The
  implementation renders `usage / total` as a plain `MenuOption` subtitle — no bar, no threshold
  color. Deliberate scope cut or missed? Flagging because the visual warning was the gauge's stated
  reason to exist. (Mitigating context: the live account's limit is 5.5 TB, not 15 GB, so "nearly
  full" isn't imminent for it — which may be why. Worth confirming the intent.)
- **`getStorage` on `invalid_grant` throws 400 but doesn't disconnect/notify**, unlike `uploadAsset`
  (which deletes credentials + records `revoked` + notifies). That's defensible — a read path
  shouldn't mutate account state because someone opened a menu; the next upload handles the
  revocation properly. Just noting the asymmetry so it's a choice, not an oversight.
- **Clicking the storage row opens Drive root** (`onClick={() => openGoogleDriveFolder(null)}`) — a
  slightly odd affordance for a number; harmless, but the dedicated "Open in Google Drive" row already
  covers navigation. Consider making the storage row non-interactive.

---

## Priority

1. **Fix the unconnected-member menu** (`Promise.allSettled` + a "Connect → Settings" entry gated on
   `status.connected`). It's broken for seohui on the live instance today, and it's the roadmap state
   that was specified and skipped.
2. **Give `me/status` a blocked signal** (Q1) so gap E's poll target can honestly say "paused" instead
   of showing frozen work as progress — before Wave 3 consumes it.
3. **Instance-field the cache** (Q3); **add the per-album status endpoint** before Wave 3 polling (Q4).
4. Accept: Q2 (verified identical), Q5 (`onOpen`), Q6 field (keep, and surface trash later). Confirm the
   text-vs-gauge and storage-row-click intents.

Server logic is solid and the count/stream question — the one most likely to hide a subtle bug —
checks out exactly. The work left is on the web side: the menu is drawn for everyone the model now
lets back an album up, but it only actually works for someone who has already connected.
