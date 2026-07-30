# Google Drive Sync Feature: Implementation Progress

This document tracks the ongoing progress of the "Sync Album to Google Drive" feature implementation. See [google-drive-album-sync-plan.md](./google-drive-album-sync-plan.md) for the target design (revised after review — several items below now need rework to match it).

## 1. Done, but needs rework to match the revised plan

### ⚠️ Backend Trigger Integration
- **File Modified:** `server/src/services/album.service.ts`
- **Status:** Jobs are queued on `addAssets`/`addAssetsToAlbums`, but:
  - Uses `auth.user.id` instead of `album.ownerId` (wrong target account for shared albums — see plan §4 Step 1).
  - Queues one-by-one with `await jobRepository.queue(...)` in a loop instead of a single `queueAll(...)` batch.
  - No dedup check against upload history before queueing (ledger table doesn't exist yet — see plan §2.5).
  - `addAssetsToAlbums` queues jobs *inside* the loop that builds `albumAssetValues`, before the DB write — should happen after commit.

### ⚠️ Background Worker Scaffolding
- **File:** `server/src/services/google-drive.service.ts`
- **Status:** Present, but does **not** fail gracefully as originally believed — `uploadAsset` throws `BadRequestException` when the user hasn't linked Drive, which causes BullMQ to retry indefinitely for every unlinked user whose asset gets added to an album. Needs to check for a linked account and return `JobStatus.Skipped` instead (plan §6).
- Also missing: MIME type is never passed to `createReadStream`, so every file uploads as `application/octet-stream`; no `invalid_grant` handling; no idempotency check against a ledger table (doesn't exist yet).
- `handleGoogleDriveUploadQueueAll` is still a logging-only placeholder — the "manual full sync" / admin queue-restart path is not implemented.
- `GET /google-drive/auth-url` has no CSRF `state` parameter, and `POST /google-drive/export-album` has no auth/permission check tied to the album (any logged-in user can trigger it, and it doesn't even use the `albumId` it receives). Both are security gaps — see plan §3 and §7.

### ⚠️ Isolated Development/Testing Environment
- **Files Created:** `docker/docker-compose.isolated.yml`, `docker/docker-compose.test.yml`, `docker/test.env`
- **Status:** Done as planned — port shifts (Server 2284, Web 3001, DB 5433), isolated upload path, no fixed container names.

## 2. Not started

### ⏳ Data model rework (plan §2.5)
- Move `googleDriveRefreshToken`/`googleDriveFolderId` off the `user` table into a dedicated `user_google_drive` table (currently these columns ride along on every `columns.userAdmin` select, including a plaintext refresh token).
- Add the `google_drive_upload` ledger table for idempotency.

### ⏳ OAuth callback route (plan §3)
- No server-side `GET /google-drive/callback` exists yet. `GOOGLE_REDIRECT_URL` currently has nothing to redirect to.

### ⏳ Web UI: Settings Menu Integration
- `GoogleDriveSettings.svelte` exists but: calls raw `fetch('/api/...')` instead of the `@immich/sdk` client, doesn't check response status, and has no `GET /google-drive/status` endpoint to hydrate current connection/folder state on load.

### ⏳ Web UI: Album Manual Sync Button
- Button exists in the album action bar but is visible to any viewer with `assetCount > 0`, not gated to the album owner, and calls the unauthenticated/unscoped `export-album` endpoint.

### ⏳ Repo integration checklist (plan §7)
- OpenAPI spec/SDK not regenerated.
- `web/src/lib/services/queue.service.ts`'s `Record<QueueName, QueueItem>` map not updated (breaks web type-check).
- `sync:sql` not run — `user.repository.sql` out of date.
- No i18n keys added; UI strings are hardcoded English.
- No tests (`google-drive.service.spec.ts` doesn't exist; `album.service.spec.ts` not updated).
- Migration filename timestamp (`1800000000000-...`) is set in the future relative to upstream's latest migration — needs to be corrected to avoid ordering issues on rebase.

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

**Caveat:** in this state, any user who hasn't connected Google Drive and gets a photo added to an album will generate a failing/retrying job (see §1, worker scaffolding). Don't run this against real album activity yet.
