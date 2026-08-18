# Google Drive Album Sync Implementation Plan

## 0. Scope & Non-goals

**In scope:**
- One-way sync: Immich → Google Drive. Immich is always the source of truth.
- Only original asset files (photo/video originals, including live photo still + motion parts as separate files).
- Per-user Google account link (OAuth2, `drive.file` scope).
- Automatic upload when an asset is added to an album; manual "sync album" trigger as a fallback.

**Explicit non-goals (do not implement unless revisited):**
- No deletion propagation. Removing an asset from an album, or deleting the asset in Immich, does **not** delete the file from Drive.
- No Drive → Immich sync (read-only relationship from Drive's perspective).
- No transcoded/thumbnail variants — only `asset.originalPath`.
- No XMP sidecar upload.
- No support for shared/team drives in the first version — personal "My Drive" only.

---

## 1. Goal Overview
The objective is to automatically upload photos to a Google Drive folder when they are added to an album in Immich, and provide the user with manual sync and configuration controls via the UI.

## 2. Current Architecture Context
- Immich's backend handles album operations via `AlbumService` (`server/src/services/album.service.ts`).
- When a user adds photos to an album, it calls `addAssets()` or `addAssetsToAlbums()`.
- `GoogleDriveService` (`server/src/services/google-drive.service.ts`) and job queue `GoogleDriveUpload` (`server/src/enum.ts`) already exist as scaffolding and need hardening (see §6).
- `AlbumService` extends `BaseService`, which provides access to `this.jobRepository`.
- Existing precedent to follow for OAuth: `server/src/services/oauth.service.ts` already implements state/PKCE handling for the OIDC login flow — reuse the same pattern rather than inventing a new one.

## 2.5 Data Model

**Do not store Google credentials/state on the `user` table.** The current implementation added `googleDriveRefreshToken` and `googleDriveFolderId` directly to `user`, which means every query that selects `columns.userAdmin` (i.e. most user reads) now drags a secret token through memory. Move this to a dedicated table instead:

```sql
CREATE TABLE user_google_drive (
  "userId" uuid PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  "refreshTokenEncrypted" text NOT NULL,
  "folderId" varchar,
  "connectedAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
```

- Encrypt the refresh token at rest (reuse whatever secret-encryption helper Immich already uses for OAuth-related secrets, or `crypto` with a key from system config) — do not store it in plaintext.
- Only ever `SELECT` this table explicitly where needed (link flow, upload worker); never join it into general user queries.

**Upload ledger — required for idempotency**, not present in the current implementation:

```sql
CREATE TABLE google_drive_upload (
  "userId" uuid NOT NULL,
  "assetId" uuid NOT NULL,
  "driveFileId" varchar NOT NULL,
  "uploadedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("userId", "assetId")
);
```

- Before enqueueing a job, and again inside the worker (race-safe check), look up this table. If a row already exists, skip the upload — the asset is already on Drive for this user.
- This also gives us a place to record failures/last-attempt metadata later if needed, and a natural target for a future "unlink and remove uploaded files" feature.

## 3. OAuth Flow

1. User clicks **Connect Google Drive** in settings → frontend calls `GET /google-drive/auth-url`.
2. Server generates a random `state` token, persists it against the session/user (short TTL), and returns `oauth2Client.generateAuthUrl({ state, access_type: 'offline', scope: ['drive.file'], prompt: 'consent' })`.
3. User approves on Google's consent screen → Google redirects to `GOOGLE_REDIRECT_URL` (a **server-side** callback route, e.g. `GET /google-drive/callback?code=...&state=...`), not directly back into the SPA.
4. Callback handler:
   - Validates `state` matches what was issued for this user/session; rejects otherwise (CSRF protection).
   - Exchanges `code` for tokens, stores the encrypted refresh token in `user_google_drive`.
   - Redirects the browser to the web app's settings page (e.g. `/user-settings#google-drive-sync`) with a success/error query flag.
5. Frontend settings page reads that flag on load and shows a toast; it does **not** handle the OAuth `code` itself.

**Folder selection:** because the scope is `drive.file` (the app can only see files/folders it created), we cannot list the user's existing Drive folders. Plan is:
- On first successful link, auto-create an `Immich` folder in the user's Drive and store its ID as the default `folderId`.
- Optionally support per-album subfolders (`Immich/{albumName}`) — **decision needed**, see open question below.
- Do not attempt to expose a generic "pick any existing folder" UI unless we later add the Google Picker API (which can grant `drive.file` access to a user-selected folder without broadening the scope) or upgrade to `drive`/`drive.readonly` (heavier Google verification review — avoid unless required).

**Open question to resolve before implementation:** single global folder per user vs. per-album subfolder. The feature is named "Album Sync," which implies the latter; the current code implements the former. Pick one and update this doc before writing the folder-creation logic.

## 4. Implementation Steps (Backend)

### Step 1: Ownership & idempotency check before enqueueing
Album sync targets **the album owner's** Drive, not the acting user's — a viewer with edit rights who adds photos to someone else's shared album should not write into their own Drive account (nor, worse, silently into the album owner's without consent being obvious). Use `album.ownerId`, not `auth.user.id`, when queuing jobs.

Before queuing, skip assets already present in `google_drive_upload` for that owner.

### Step 2: Modify `addAssets` in `AlbumService`
```typescript
const results = await addAssets(
  auth,
  { access: this.accessRepository, bulk: this.albumRepository },
  { parentId: id, assetIds: dto.ids },
);

const newlyAddedIds = results.filter((r) => r.success).map((r) => r.id);
if (newlyAddedIds.length > 0) {
  await this.jobRepository.queueAll(
    newlyAddedIds.map((assetId) => ({
      name: JobName.GoogleDriveUpload,
      data: { userId: album.ownerId, assetId },
    })),
  );
}
```
Use `queueAll` (batch) instead of `await`-ing `queue()` in a loop — avoids N round-trips to Redis for large albums. Queue only after the DB write has succeeded, not interleaved with it.

### Step 3: Modify `addAssetsToAlbums` in `AlbumService`
Same pattern — collect `notPresentAssetIds` per album, batch-queue with `album.ownerId` after the album asset rows are persisted, not inside the insert loop.

### Step 4: Job Worker Execution (`GoogleDriveService`)
The worker fetches the physical asset file stream and uploads it via `googleapis`. See §6 for required failure-handling behavior — a user without a linked account must **skip**, not throw/retry.

## 5. Implementation Steps (Frontend UI/UX)

### Step 1: Settings Menu Integration
- **File Location:** `web/src/routes/(user)/user-settings/GoogleDriveSettings.svelte`.
- Use the generated `@immich/sdk` client for all requests (adds auth headers, respects deployed base path, gives typed errors) — do not call `fetch('/api/...')` directly.
- Add a `GET /google-drive/status` endpoint (`{ connected: boolean, folderId: string | null }`) so the settings page reflects actual link state on load instead of always showing an empty form.
- `[Connect Google Drive]` button navigates to the auth URL; on return, read the success/error flag from the URL (see §3 step 5) and toast accordingly.
- Add a **Disconnect** action that clears the `user_google_drive` row.
- All request handlers must check the response/promise rejection and surface errors — do not assume success.

### Step 2: Album Action Bar Sync Button
- **File Location:** album page component.
- Only render for the album **owner** (`isOwned`), matching the ownership decision in §4 Step 1 — currently it's shown to any viewer once `assetCount > 0`.
- Calls `POST /albums/:id/sync-google-drive` (scoped to the album, permission-checked server-side — see §7 item 1) rather than the current global, unauthenticated `export-album` command.

## 6. Failure Handling & Idempotency

- **No linked account:** the worker must check for a `user_google_drive` row and return `JobStatus.Skipped` (not throw). Throwing causes BullMQ retries to pile up for every user who simply hasn't connected Drive.
- **Duplicate uploads:** guarded by the `google_drive_upload` ledger (§2.5). Re-adding an asset to an album, or adding the same asset to two albums, must not create two Drive files.
- **`invalid_grant` errors** (user revoked access from Google's side): catch specifically, clear the stored token, and surface a "reconnect required" state rather than retrying indefinitely.
- **MIME type:** pass `asset.originalMimeType` (or equivalent) into `storageRepository.createReadStream(path, mimeType)` — currently omitted, so every upload lands on Drive as `application/octet-stream` and loses preview/thumbnailing there.
- **Large files / rate limits:** photos are fine with simple upload; videos should use resumable upload. Expect and handle `403 rateLimitExceeded` / `userRateLimitExceeded` with backoff. Revisit the default `concurrency: 5` for this queue once real upload sizes are known.
- **Secrets:** `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URL` must come from system config (admin-configurable), not `process.env` with placeholder string fallbacks — a misconfigured deployment should fail loudly at startup/first-use, not silently attempt OAuth with the literal string `'YOUR_CLIENT_SECRET'`.

## 7. Repo Integration Checklist

Adding a `QueueName`/`JobName` and DB columns touches more than the enum. Before considering this feature done:

- [ ] Regenerate `open-api/immich-openapi-specs.json` and SDK (new controller/DTOs currently absent from the spec).
- [ ] Add `QueueName.GoogleDriveUpload` to the `Record<QueueName, QueueItem>` in `web/src/lib/services/queue.service.ts` — this is an exhaustive map; leaving it out breaks the web build's type check.
- [ ] Run `sync:sql` to regenerate `server/src/queries/user.repository.sql` (or the new `user_google_drive`/`google_drive_upload` repository SQL) so schema-drift checks pass.
- [ ] Add i18n keys instead of hardcoded English strings in the new Svelte components.
- [ ] Add tests: `google-drive.service.spec.ts` (link, upload skip/skip-if-unlinked, dedup), and extend `album.service.spec.ts` to assert job payloads use `album.ownerId` and are deduped/batched.
- [ ] Fix the migration filename timestamp — `1800000000000-*` (2027) sorts after any future upstream migration gets merged, since upstream's latest is `1782...` (2026). Use a current timestamp so migration ordering stays correct when rebasing on upstream.

## 8. Docker Development Environment Strategy
To avoid colliding with the currently running production instance (which occupies ports 2283, 3000, 5432, 6379 and uses standard container names like `immich_server`):
- Isolated docker-compose file: `docker/docker-compose.isolated.yml` (done).
- Port shifts: Server `2284`, Web `3001`, DB `5433`, Redis shifted too, plus a separate `test.env` (done).
- Alternative `UPLOAD_LOCATION` so we don't overwrite the main instance's data (done).
- No fixed `container_name`, so the isolated stack can run alongside the main one under a different compose project name.
