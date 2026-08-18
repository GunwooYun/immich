# Google Drive Sync Feature: Implementation Progress

This document tracks the ongoing progress of the "Sync Album to Google Drive" feature implementation. See [google-drive-album-sync-plan.md](./google-drive-album-sync-plan.md) for the target design.

**Status: P2 complete, and verified end-to-end against the real Google Drive API (see §1).**
Everything below was re-verified directly against the committed code (`git show <commit>:<path>`), not just against commit
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

### ✅ P2: tests, i18n, codegen, SDK migration — all complete
- Unit tests: `google-drive.service.spec.ts` (skip paths, ledger dedup, owner-only sync, token
  never leaked by `/status`), plus `album.service.spec.ts` extensions (owner-id targeting, dedup).
  All validated by an actual local run: 2,250 passed / 0 failed, plus lint/tsc/format clean via the
  same steps CI uses (`//server:ci-unit`).
- i18n: all UI strings go through `$t()`; 17 keys added to `i18n/en.json` in lexical-sort order.
- OpenAPI/SDK regenerated (`mise //:open-api`): spec, TypeScript SDK, and Dart SDK all include the
  six google-drive endpoints. Response/request DTO classes (`google-drive.dto.ts`) were added when
  the first regen exposed that inline TS return types produce an empty response schema — and worse,
  that `@Body('folderId')` (property-level extraction) produced an SDK `setFolderId()` with **no
  body parameter at all**. Now `setFolderId({ googleDriveSetFolderDto })` is fully typed.
- SQL snapshots regenerated (`sync-sql` against the isolated Postgres): new
  `server/src/queries/google.drive.repository.sql` with all six repository queries; no other
  snapshot changed.
- Migration drift check (`migrations generate TestMigration`) was run for real and **found real
  drift**: the hand-written `google_drive_upload` create-table migration was missing the two
  per-FK-column indexes the decorators imply. Fixed as a forward migration
  (`1785769790549-AddGoogleDriveUploadIndexes`) — the `assetId` index matters for ON DELETE CASCADE
  performance. Re-check now reports "No changes detected".
- Frontend migrated off raw `fetch` onto `@immich/sdk` (`getStatus`/`getAuthUrl`/`setFolderId`/
  `disconnect`/`syncAlbum`, aliased at import for readability).
- `QueueName.GoogleDriveUpload` added to *three* exhaustive/refreshed web maps: the
  `Record<QueueName, QueueItem>` in `queue.service.ts`, the `Record<QueueName, string>` queue-title
  map in `admin/system-settings/JobSettings.svelte` (found by svelte-check, not by reading), and the
  admin concurrency-input list in the same file (the server honors this queue's concurrency setting,
  and it's the natural knob for Drive API rate limits). The admin *Queues* panel (`QueuePanel.svelte`)
  was deliberately left without an entry: its "start" button would invoke the still-placeholder
  QueueAll handler (P3) as a no-op.
- Lesson recorded for future work: `nest build` does not delete stale outputs. A compiled copy of the
  long-renamed `1800000000000-*` migration was still sitting in `server/dist` from an old docker-era
  build and silently re-applied the dropped user columns during the first migration run. Fixed by
  wiping `server/dist` and rebuilding; if migrations ever behave impossibly, check dist for ghosts.

### ✅ End-to-end manual verification against the real Google Drive API (2026-08-07)
Everything above this point was verified by types, unit tests, and generated artifacts only — no one
had ever run the feature against Google. That gap is now closed. Run in the official Dev Container
(`.devcontainer`, Docker Desktop + WSL2), with a real OAuth client and a real Google account:

| Scenario | Result |
| --- | --- |
| OAuth link flow (consent → callback → persist) | refresh token stored in `user_google_drive` |
| Add photos to an album | both auto-uploaded; `google_drive_upload` gained 2 rows with real `driveFileId`s; files visible in My Drive |
| Add the *same* photos to a *second* album | `album_asset` grew to 4, ledger stayed at 2, `uploadedAt` unchanged — no duplicate Drive files |
| Manual "sync album" button | nothing queued at all (Redis `bull:googleDriveUpload:*` empty) — the pre-queue ledger check works |
| Disconnect | credentials row deleted, ledger **and** Drive files preserved, as designed |
| Re-link the same account, then manual sync | still no re-upload — `uploadedAt` unchanged. This is the payoff for deliberately keeping the ledger on disconnect; wiping it would have duplicated every previously synced photo |

Dev Container specifics worth knowing next time:
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URL` are passed through
  `devcontainer.json`'s `remoteEnv` from the host shell, so **no secret is ever stored in a tracked
  file**. Export them from a `chmod 600` file sourced by `~/.bashrc`. Because `remoteEnv` snapshots
  the shell environment at VS Code launch, the variables must exist *before* `code .` — reopening an
  already-running window is not enough.
- The Google Cloud OAuth client needs redirect URI `http://localhost:2283/api/google-drive/callback`
  and the tester's account added under Test users; the app can stay in Testing (no verification).
- `drive.file` is now classified by Google as a **non-sensitive** scope, so no review is required.
  It also means a hand-created Drive folder's ID will *not* work in the "Target folder ID" field —
  the app can only touch folders it created itself. Leave it blank (uploads to My Drive root) until
  the auto-create-folder idea in the plan doc is implemented.
- On Windows, Hyper-V dynamically reserves TCP port ranges and had swallowed **9231** (the API
  debug port), which made the container fail to start with a `/forwards/expose returned unexpected
  status: 500` error. Fix: `netsh int ipv4 add excludedportrange protocol=tcp startport=9231
  numberofports=1` from an admin shell, which only succeeds while the port isn't currently held —
  a reboot first may be needed. Check with `netsh interface ipv4 show excludedportrange protocol=tcp`.
- The `runOn: folderOpen` tasks that start Nest and Vite don't fire unless VS Code's automatic-task
  prompt has been accepted; otherwise start them by hand via "Tasks: Run Task". Also note the
  container image has neither `ss` nor `netstat`, so "is it listening?" must be checked with `curl`
  from inside the container rather than by reading a socket table.

## 2. P3 — completed

Every item that was listed here as "not started" has since been implemented. Recorded with what
changed, so a future reader can tell these apart from the ones that were merely planned.

- **`handleGoogleDriveUploadQueueAll` is real.** It streams every (owner, asset) pair that belongs
  to an album whose owner has linked Drive and has no ledger row yet, batching them into the queue.
  There is deliberately no `force` variant — see `streamPendingUploads` for why one would be unable
  to re-upload anything without also disabling the sole duplicate-safeguard.
- **`invalid_grant` is handled.** A revoked or expired refresh token is detected (`isInvalidGrant`)
  and turned into a skip plus a warning rather than an endlessly retrying job; the picker endpoint
  turns it into a "reconnect your account" message.
- **Resumable uploads and rate-limit backoff.** Uploads use `uploadType: 'resumable'` with a retry
  policy covering 403/429/5xx, and the read stream is destroyed in a `finally` so a failed upload
  cannot leak a file descriptor.
- **BullMQ-level dedup.** `job.repository.ts` gives `GoogleDriveUpload` a `jobId` of
  `${userId}/${assetId}`, so two jobs for the same pair collapse into one before either runs.
- **Credentials moved to system config.** `googleDrive.{enabled,clientId,clientSecret,redirectUrl}`
  are admin-editable, validated, and a missing value produces a message naming what to fix. The
  `process.env.GOOGLE_*` fallback that briefly existed has been removed: those keys were never in
  `EnvSchema`, and while they were honoured, clearing the client ID in the admin UI didn't actually
  disable anything as long as the container still had them set.
- **Folder selection via the Google Picker.** `GET /google-drive/picker-config` mints a short-lived
  `drive.file` access token for the browser-side picker; `web/src/lib/utils/google-picker.ts` loads
  Google's api.js lazily and opens the folder chooser. Requires a Google API key
  (`googleDrive.apiKey`, optional); without one the picker button is inert and the manual
  paste-a-folder-id field remains as the fallback. The chosen folder's name is cached in
  `user_google_drive.folderName` so the settings page can show "Photos" rather than a raw id.

## 2b. Deliberately not done

- **Squashing the five migrations into one.** They have already been applied to real local
  databases; a database that has a migration recorded in `kysely_migrations` never re-runs it, so
  rewriting history here would leave those databases permanently short of the later changes.
- **Auto-creating a dedicated "Immich" folder on link.** Considered and rejected in favour of the
  picker, which lets the user put photos where they actually want them.
- **Encrypting the refresh token at rest.** Requires an operator-managed key Immich doesn't have;
  see the comment on `UserGoogleDriveTable` for the full trade-off.

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
