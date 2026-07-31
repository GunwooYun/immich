# Google Drive Sync Feature: Implementation Progress

This document tracks the ongoing progress of the "Sync Album to Google Drive" feature implementation. See [google-drive-album-sync-plan.md](./google-drive-album-sync-plan.md) for the target design.

**Status as of commit `e7ca9d879` (branch `feature/google-drive-album-sync`).** Everything below was
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
- `GoogleDriveSettings.svelte`: "Connect to Google Drive" button + target folder ID field, registered
  as an accordion section in `UserSettingsList.svelte`.
- Album page: "Sync to Google Drive" icon button in the action bar, gated to `isOwned` (matches the
  backend's owner-only enforcement — a non-owner never sees a button that would just 403).

### ✅ Isolated dev/test Docker environment (since `93b977eff`)
- `docker/docker-compose.isolated.yml`, `docker-compose.test.yml`, `test.env`: port shifts (Server
  2284, Web 3001, DB 5433), isolated upload path, no fixed container names — verified against the
  actual compose file (`2284:2283`, `3001:3000`, `5433:5432`).

## 2. Not started

These are unchanged from the original plan and still genuinely outstanding — listed here in the same
P1/P2/P3 priority order already agreed on:

### P1 — needed before this is actually usable end-to-end
- Frontend doesn't read the `?google-drive=connected|error` query param the callback redirects to —
  the user gets no toast/feedback after completing (or failing) the Google consent flow.
- No `GET /google-drive/status` endpoint — the settings page can't show current connection state or
  pre-fill the configured folder ID on load.
- Credentials still live on the `user` table (`googleDriveRefreshToken`, `googleDriveFolderId`) as
  plaintext columns, riding along on every `columns.userAdmin` select. Plan §2.5 calls for moving
  these into a dedicated `user_google_drive` table and encrypting the refresh token at rest. Not done.

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
