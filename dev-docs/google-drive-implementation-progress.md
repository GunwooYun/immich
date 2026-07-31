# Google Drive Sync Feature: Implementation Progress

This document tracks the ongoing progress of the "Sync Album to Google Drive" feature implementation. See [google-drive-album-sync-plan.md](./google-drive-album-sync-plan.md) for the target design.

**Status: P1 complete (branch `feature/google-drive-album-sync`).** Everything below was
re-verified directly against the committed code (`git show <commit>:<path>`), not just against commit
messages or earlier drafts of this document — a previous version of this file had drifted out of sync
with what was actually shipped (it still described pre-fix behavior for things that were fixed in the
same commit that introduced them), which led to at least one external review citing already-fixed
issues as outstanding. If you're updating this doc after a future commit, please re-check claims
against the actual diff rather than editing from memory.

## 1. Done

### ✅ OAuth link flow (commits `93b977eff`, `e7ca9d879`)
- `GET /google-drive/auth-url` issues a signed, short-lived (`10m`) `state` JWT and returns Google's
  consent URL (`drive.file` scope, `access_type=offline`, `prompt=consent`).
- `GET /google-drive/callback` is a public route (no `@Authenticated()` — trust comes from the signed
  `state`, not a session cookie, since Google's redirect is a plain browser navigation). It verifies
  `state`, exchanges the `code` for a refresh token, and redirects to
  `/user-settings?google-drive=connected|error`.
- The `state`-signing secret is persisted in the `system_metadata` table
  (`SystemMetadataKey.GoogleDriveState`) rather than kept in server-process memory, so verification
  survives server restarts and works correctly across horizontally-scaled replicas (fixed in
  `e7ca9d879`, was broken in `93b977eff`).
- `linkAccount` throws (surfacing as `?google-drive=error`) if Google doesn't return a `refresh_token`,
  instead of silently reporting success with nothing saved (fixed in `e7ca9d879`, was broken in
  `93b977eff`).

### ✅ Upload worker (`server/src/services/google-drive.service.ts#uploadAsset`, since `93b977eff`)
- Skips (returns `'skipped'`, mapped to `JobStatus.Skipped` by the job handler) rather than throwing
  when the target user hasn't linked Google Drive — does **not** cause BullMQ retry pile-up.
- Skips assets already present in the `google_drive_upload` ledger for that user.
- Passes a MIME type to `storageRepository.createReadStream`, derived via
  `mimeTypes.lookup(asset.originalFileName)` (there is no `originalMimeType` field on the asset
  schema — Immich derives MIME type from the filename extension everywhere, this included) — files no
  longer land in Drive as generic `application/octet-stream`.
- Records a ledger row (`googleDriveRepository.recordUpload`) after a successful upload.

### ✅ Manual album sync (`GoogleDriveService#syncAlbum`, `POST /google-drive/albums/:id/sync`, since `93b977eff`)
- Requires `Permission.AlbumRead` **and** an explicit check that the caller is the album's owner
  (owner is derived from `album.albumUsers` role, not a plain `ownerId` column — Immich models
  ownership as an `album_user` row with `role = 'owner'`). Replaces the original prototype's
  `POST /google-drive/export-album`, which had no permission check at all and ignored the `albumId` it
  received.
- De-duplicates against the ledger before queueing, and batches with `jobRepository.queueAll(...)`.

### ✅ Album service hooks (`server/src/services/album.service.ts`, since `93b977eff`)
- `addAssets` / `addAssetsToAlbums` queue `JobName.GoogleDriveUpload` jobs for the **album owner**
  (not the acting user — matters for shared albums), after the album_asset rows are committed (not
  interleaved with the insert loop), batched via `queueAll`, and only for assets not already in the
  ledger.

### ✅ Data model: upload ledger (`google_drive_upload` table, since `93b977eff`)
- `(userId, assetId)` composite primary key, `driveFileId`, `uploadedAt`. Prevents duplicate uploads
  when the same asset is added to two albums, removed and re-added, or a job is retried.
- `GoogleDriveRepository` (`getUploadedAssetIds`, `recordUpload`) wired into `BaseService`'s DI graph.

### ✅ Frontend (since `93b977eff`)
- `GoogleDriveSettings.svelte`: registered as an accordion section in `UserSettingsList.svelte`.
  Later extended in P1 — see "connection status, disconnect, and callback feedback" below for its
  current behavior.
- Album page: "Sync to Google Drive" icon button in the action bar, gated to `isOwned` (matches the
  backend's owner-only enforcement — a non-owner never sees a button that would just 403).

### ✅ Isolated dev/test Docker environment (since `93b977eff`)
- `docker/docker-compose.isolated.yml`, `docker-compose.test.yml`, `test.env`: port shifts (Server
  2284, Web 3001, DB 5433), isolated upload path, no fixed container names — verified against the
  actual compose file (`2284:2283`, `3001:3000`, `5433:5432`).

### ✅ P1: credentials moved off the `user` table
- New `user_google_drive` table (`userId` PK/FK, `refreshToken`, `folderId`, `connectedAt`) replaces
  the `googleDriveRefreshToken` / `googleDriveFolderId` columns on `user`. Those columns were part of
  `columns.userAdmin`, so a long-lived OAuth secret was being loaded on essentially every user read;
  it's now only read where explicitly needed (the link/unlink flow and the upload worker).
- `GoogleDriveRepository` gained `getCredentials` / `upsertCredentials` / `setFolderId` /
  `deleteCredentials`; `GoogleDriveService` no longer touches `userRepository` at all.
- Migration `1785475800000-CreateUserGoogleDriveTable` creates the table, copies existing rows over,
  then drops the two `user` columns. Written additively (rather than by rewriting the earlier
  `1785423600000` migration) so anyone who already ran this branch locally doesn't end up with a
  `kysely_migrations` row pointing at a deleted file.
- **The token is stored in plaintext — a deliberate decision, not an oversight.** Immich has no
  encryption-at-rest infrastructure and no master key: every other secret it stores (passwords, API
  keys, session tokens, PIN codes) is *hashed*, because those only ever need verifying. A Google
  refresh token must be readable to be usable, so it would need reversible encryption with a key held
  outside the database — meaning a new mandatory operator-managed key whose loss forces every user to
  re-link. Judged not worth it for this threat model; see plan §2.5.

### ✅ P1: connection status, disconnect, and callback feedback
- `GET /google-drive/status` returns `{ connected, folderId, connectedAt }` (never the token).
- `DELETE /google-drive/link` disconnects. Deliberately leaves both the already-uploaded Drive files
  and the `google_drive_upload` ledger alone — deleting a user's own cloud files because they
  unlinked an integration would be destructive, and keeping the ledger means reconnecting later
  doesn't re-upload everything as duplicates.
- `GoogleDriveSettings.svelte` now hydrates from `/status` on mount (so it shows real connection
  state instead of always rendering an empty "not connected" form), surfaces the
  `?google-drive=connected|error` callback flag as a toast, clears that one-shot flag from the URL,
  and offers a Disconnect button. All requests go through a wrapper that checks `response.ok`, since
  `fetch` resolves normally on 4xx/5xx and would otherwise show a success toast for a failed request.
- The OAuth callback redirect includes `isOpen=google-drive-sync`. This is load-bearing, not
  cosmetic: settings sections are accordions that only render their contents while expanded, so
  without it the panel never mounts and never reads the flag — the callback feedback would be dead
  code. (Caught in review; the first cut of this used the wrong parameter name and silently did
  nothing.)

## 2. Not started

P1 is now complete (see §1). What remains is listed in the same P2/P3 priority order already agreed
on:

### P2 — CI / integration correctness
- OpenAPI spec/SDK not regenerated (new controller/DTOs aren't in `open-api/immich-openapi-specs.json`
  yet).
- `web/src/lib/services/queue.service.ts`'s `Record<QueueName, QueueItem>` map not updated — this is
  an exhaustive map, so regenerating the SDK without this update will break the web build's type
  check.
- `sync:sql` not run — `server/src/queries/user.repository.sql` (and a new
  `google-drive.repository.sql`) are out of date relative to the schema.
- No i18n keys — UI strings in `GoogleDriveSettings.svelte` and the album page button are hardcoded
  English.
- No tests: `google-drive.service.spec.ts` doesn't exist; `album.service.spec.ts` doesn't assert the
  new job-queueing behavior (owner-id targeting, ledger dedup, batching).
- Frontend calls raw `fetch('/api/google-drive/...')` instead of the generated `@immich/sdk` client.

### P3 — robustness
- `handleGoogleDriveUploadQueueAll` (the admin "start"/"force" button for this job queue) is still a
  logging-only placeholder.
- No `invalid_grant` handling (user revokes Immich's access from Google's side) — no path to detect
  this and prompt the user to reconnect.
- No resumable upload support or Drive API rate-limit backoff — relevant once real (especially video)
  file sizes are involved.
- The ledger check happens *before* queueing (in `album.service.ts` / `syncAlbum`) and again inside
  `uploadAsset`, but there's no `jobId`-based dedup at the BullMQ level — two jobs racing for the same
  `(userId, assetId)` could both pass the ledger check before either records its upload, producing a
  duplicate file. Low probability, not addressed yet.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URL` still fall back to placeholder
  strings (`'YOUR_CLIENT_ID'`, etc.) read from `process.env`, rather than being admin-configurable via
  system config with a loud failure on misconfiguration.

## 3. How to Run the Current Progress
To build and test the backend changes using the isolated environment:
```bash
cd docker
# Build the modified source code
docker compose -f docker-compose.isolated.yml -p immich-dev-isolated build
# Start the containers
docker compose -f docker-compose.isolated.yml -p immich-dev-isolated up -d
```
Access the dev server at `http://localhost:3001`.

The earlier caveat about unlinked users generating failing/retrying jobs no longer applies — that was
fixed in `93b977eff` (see §1, upload worker). It's still safe to test end-to-end, but note the P1 gaps
above: there's no feedback in the UI after connecting/failing to connect, and no way to see current
connection status from the settings page yet.
