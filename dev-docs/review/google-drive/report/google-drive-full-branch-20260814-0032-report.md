# Code Review Request — Google Drive Album Sync

A feature branch on a **personal fork** of Immich that mirrors album photos into the album
owner's Google Drive. This document is the briefing for a reviewer: what was built, the
decisions that need scrutiny, what has already been verified, and what was deliberately left
undone.

| | |
|---|---|
| Repository | `github.com/GunwooYun/immich` (fork of `immich-app/immich`) |
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Base | `v3.1.0` (merged in; the branch was originally cut from `f2b0b696f`) |
| Diff vs base | 71 files, +4,550 / −60 — of which **39 source files, +2,465 / −4** once generated artifacts, tests and docs are excluded |
| Tests added | 91 tests across `google-drive.service.spec.ts` and `album.service.spec.ts` (count from `vitest run` on those two files, not an `expect(` grep) |
| Deployment target | Self-hosted instance with ~5,700 photos, 3 albums, 2 users |

```bash
git remote add gy https://github.com/GunwooYun/immich.git && git fetch gy
git diff v3.1.0...gy/feat/google-drive-album-sync-v3.1.0
```

Generated files (`open-api/`, `mobile/openapi/`, `packages/sdk/src/fetch-client.ts`,
`server/src/queries/`, `pnpm-lock.yaml`) are checked in because upstream checks them in. They
are reproducible with `mise //:open-api` and `mise //:sql` — skip them when reading.

---

## 1. What it does

1. A user links their own Google account from Settings (OAuth, `drive.file` scope only).
2. Adding assets to an album queues a background job per asset that isn't already uploaded.
3. The job streams the original file to the **album owner's** Drive, into a folder the user
   picked via Google's Picker widget.
4. An upload ledger (`google_drive_upload`) records every `(userId, assetId)` that succeeded, so
   nothing is ever uploaded twice.
5. An admin "queue all" job backfills anything the per-album triggers missed.

Sync is **one-way and additive**. Nothing in Drive is ever deleted or modified by Immich, not
even on disconnect.

## 2. Shape of the change

**New** — `services/google-drive.service.ts` (the whole feature), `controllers/google-drive.controller.ts`
(7 thin routes), `repositories/google-drive.repository.ts`, `utils/google-drive.ts` (shared
dedup-then-queue), `dtos/google-drive.dto.ts`, two schema tables, five migrations,
`web/src/lib/utils/google-picker.ts`, two Svelte settings panels.

**Touched in upstream files** — the interesting one is `album.service.ts`. Everything else is
registration boilerplate (`enum.ts`, the three `index.ts` barrels, `config.ts`,
`system-config.dto.ts`, `server.dto.ts`, `job.repository.ts`, `base.service.ts`).

`album.service.ts` is where this feature reaches into existing behaviour, so it deserves the
closest reading. Two call sites (`addAssets`, `addAssetsToAlbums`) gained a queueing step, placed
**after** the album write and the `AlbumUpdate` event emits — see §3.4.

---

## 3. Decisions that want a second opinion

### 3.1 OAuth callback binding (security)

The first implementation had a public callback route that trusted a signed `state` alone. That is
an account-linking hijack: an attacker starts the flow, gets a valid `state` bound to *their*
Immich user, and induces a victim's browser to complete it — attaching the attacker's Drive to
whatever account the victim is logged into, or vice versa depending on how `state` carries
identity.

Current implementation requires **three** things to agree:

1. the `state` signature verifies (HMAC, 10-minute expiry, secret in `system_metadata`),
2. it matches an `HttpOnly` cookie set when the auth URL was issued,
3. the `userId` inside it equals the authenticated session's user.

The route is now `@Authenticated()`. That is safe because Google's redirect is a top-level GET
navigation, which `SameSite=Lax` cookies are sent on. (An earlier draft of this document claimed
this matches Immich's own OIDC link endpoint — it does not; upstream's IdP callback is
unauthenticated. The choice here is deliberate and different.) The cookie is cleared
unconditionally, so a replayed callback URL finds nothing.

One consequence worth naming: if the Immich session expires while the user is on Google's consent
screen, the callback returns a raw 401 rather than the friendly `?google-drive=error` redirect.
Fixing that would mean dropping the auth requirement, so it stands as a known UX rough edge.

**Please check:** is requiring auth on the callback correct in all deployment topologies, and is
the three-way check actually closing the hole rather than just narrowing it?

### 3.2 The picker access token (security)

`GET /google-drive/picker-config` mints a short-lived `drive.file` access token and hands it to
the browser. Google's Picker runs in a Google-hosted iframe and authenticates by being *given* a
token; it cannot call back into Immich.

The alternative was a second browser-side OAuth flow — a second consent screen for the account
the user just linked. The refresh token stays in the database and never leaves the server.

**Trade-off accepted:** if that access token leaked (XSS), an attacker could create files in the
user's Drive and read/modify files this app created, until it expires. It cannot read the rest of
their Drive. **Is that the right call, or should the picker have its own consent flow?**

### 3.3 Refresh tokens stored in plaintext

They live in `user_google_drive`, a table separate from `user` specifically so that
`columns.userAdmin` — which selects every `user` column and is used on essentially every user
lookup — stops dragging an OAuth secret into memory on unrelated requests.

They are **not** encrypted. Immich hashes every other secret it stores (passwords, API keys,
session tokens, PINs) because those only need verifying. A refresh token must be readable to be
usable, so it needs reversible encryption, which needs a key held outside the database. That
means a new operator-managed key, and losing it re-links every user. The reasoning is written up
on `UserGoogleDriveTable`.

**Is "separate table, plaintext, documented" defensible, or is this a blocker?**

### 3.4 Ordering around the album write

Queueing happens *after* `albumRepository.update` and after the `AlbumUpdate` events are emitted.

`queueAll` writes to Redis. Adding assets to an album never used to depend on Redis. Queueing
earlier meant an unreachable Redis threw *after* the `album_asset` rows were already committed —
leaving the album's thumbnail and `updatedAt` unset and the event unsent, so shared-album members
never learned about the new photos. With queueing last, a Redis outage costs only the Drive
upload, which the admin backfill job recovers.

**Is there a case where losing the queue write silently is worse than the transactional
inconsistency it avoids?**

### 3.5 Ownership on shared albums

Uploads always go to the **album owner's** Drive, never the acting user's, and only the owner may
trigger a manual sync. Ownership is read from `album_user` where `role = 'owner'` (Immich has no
`album.ownerId` column).

Without this, a contributor to a shared album could push files into the owner's personal Drive.
The current rule means a contributor's upload also lands in the owner's Drive — which is the
intended reading of "this album is backed up by its owner", but it is a judgement call.

### 3.6 No `force` mode on the backfill

`handleGoogleDriveUploadQueueAll` ignores `force`, unlike most QueueAll handlers. Dropping the
ledger anti-join would only queue jobs the worker re-checks and skips anyway; making it genuinely
re-upload would mean ignoring the ledger, which is the only thing preventing a duplicate of every
file. Recovering from a manually emptied Drive folder therefore requires deleting ledger rows —
an explicit act, not a checkbox.

### 3.7 Five migrations, not squashed

They have already been applied to real databases. A database with a migration recorded in
`kysely_migrations` never re-runs it, so rewriting history would leave those databases
permanently short of the later changes. Note `1785423600000` adds columns to `user` and
`1785475800000` drops them again — that churn is the visible scar of moving credentials off the
`user` table mid-development. Verified on real data that no `googleDrive*` column survives on
`user`.

---

## 4. Correctness details worth verifying

- **Duplicate prevention** is two-layered: filtered against the ledger before queueing (keeps the
  queue lean) and re-checked inside the worker (the queue-to-execution window is real). On top,
  `job.repository.ts` sets `jobId = ${userId}/${assetId}` so BullMQ collapses duplicate jobs.
- **Parameter limits** — `getUploadedAssetIds` carries `@ChunkedSet({ paramIndex: 1 })`. Adding
  100k assets to an album would otherwise blow Postgres's parameter cap.
- **Backfill streams** rather than collecting: `streamPendingUploads` uses `.stream()` with a
  `DISTINCT` (the same asset can sit in several albums owned by one person).
- **File-descriptor safety** — the upload wraps `try/catch/finally` with `streamInfo.stream.destroy()`
  in `finally`.
- **Deleted-asset race** — jobs can outlive their asset. Both "trashed" and "hard deleted" are
  skips, not failures.
- **Revoked grants** — `invalid_grant` is detected and turned into a skip plus a warning, not an
  endlessly retrying job.
- **Uploads are resumable** (`uploadType: 'resumable'`) with retries on 403/429/5xx.
- **Feature gate** — `isGoogleDriveEnabled` requires the admin toggle *and* a complete OAuth
  client. There is deliberately no `process.env` fallback: those keys were never in `EnvSchema`,
  and while they were honoured, clearing the client ID in the admin UI didn't actually disable
  anything if the container still had them set.

## 5. Verification already done

- `tsc --noEmit` clean; `eslint --max-warnings 0` clean.
- **2,272 server unit tests** and **518 web tests** pass. `svelte-check` reports 7 errors, all
  pre-existing in unrelated spec files.
- `sql-tools migrations generate` reports **no drift** — the migrations match the schema
  decorators exactly.
- **Rehearsal against a copy of real production data** (~5,700 photos, 3 albums, 2 users): all
  five migrations applied cleanly, the server booted reporting `[v3.1.0]`, and asset/album/user
  counts were unchanged afterwards.
- **End-to-end against a live Google account**: link, folder pick via the Picker, automatic
  upload on add-to-album, duplicate suppression, manual sync, disconnect.

### A note on two tests that were passing for the wrong reason

The default test config has the feature **disabled**, so `uploadAsset` returned `'skipped'` at the
very first gate and every assertion about later steps held vacuously — including the test named
"should skip an asset that is already in the upload ledger", which never reached the ledger check
at all. Both now stub an enabled config, and the ledger test asserts the lookup actually
happened. Worth knowing that this class of mistake was present, in case more of it survives.

## 6. Known gaps

- **No e2e/medium tests.** Coverage is unit-level only.
- **Mobile is untouched.** The Dart SDK is regenerated but no Flutter UI exists.
- **Folder names go stale.** `folderName` is cached at pick time; renaming the folder in Drive
  leaves the old name in settings until the user picks again. Cosmetic — uploads address by id.
- **No upload progress or per-asset error surface in the UI.** Failed Drive jobs are dropped from
  the queue so the backfill can retry them (see `job.repository.ts`), which means the admin Jobs
  panel shows no failure count for this queue — server logs are the only record of an individual
  failure.
- **The Picker needs a Google API key**, configured per deployment. Without one the manual
  paste-a-folder-id field is the fallback.
- **Storage quota is not checked** before upload; a full Drive surfaces as a failed job.

## 7. Where review effort is best spent

1. **§3.1 and §3.2** — the two security decisions. Everything else is recoverable; these are not.
2. **`album.service.ts`** — the only place this feature perturbs existing behaviour.
3. **The ledger's duplicate-prevention argument** (§4) — is there an interleaving that defeats it?
4. **§3.3** — whether plaintext refresh tokens are acceptable for a self-hosted personal fork.

Commit messages are deliberately long and explain the *why* of each change; `git log v3.1.0..HEAD`
is a reasonable way to read the branch in narrative order.
