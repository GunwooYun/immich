# Review request — wave8d: fold-in of the wave8c review

**Branch:** `feat/google-drive-album-sync-v3.1.0` · **Commits:** `cf6bf36eb` (fix), `a8e26b193` (evidence)
**Also covers:** `2e1cdceb0` (evidence for wave8c, uncited by any report) — test results file only.
**Previous round:** `review/google-drive-wave8c-review-fixes-20260916-2140-review.md` (NOT BLOCKED; C1, C2, N1–N3)
**Diff:** `git diff b4967e07e cf6bf36eb -- server/src CLAUDE.md` — no production code changed.

| Finding | Change |
|---|---|
| C1 | subscribeAlbum access test asserts `Not found or no album.download access` (was `rejects.toBeDefined()`) |
| C2 | New syncAlbum access test: same message; `album.getById` and `job.queueAll` not called |
| N1 | syncAlbum not-subscribed test asserts `Add this album to your Google Drive backups before syncing it` |
| N2 | system-config.service.spec admin-UI comment and `typed-in-the-admin-ui` fixture renamed |
| N3 | CLAUDE.md §8 step 2: defaults endpoint returns clientSecret in plain text → pipe to key lengths; admin key needed; restart needed |

## Mutations (baseline 97 passed; each restored via git checkout)
| Mutation | Result |
|---|---|
| subscribeAlbum `AlbumDownload` → `AlbumRead` | 1 failed — "should gate subscribing on download access…" |
| syncAlbum `AlbumDownload` → `AlbumRead` | 1 failed — "should gate syncing on download access…" |
| remove syncAlbum not-subscribed guard | 1 failed — "should reject an album the caller has not chosen to back up" |

## Evidence
`dev-test/google-drive/results/20260916-2153.txt` — commit cf6bf36eb, clean tree: server 280 passed, web 45 passed, RESULT: PASS.
`mise //server:ci-unit`: 2390 passed / 2 skipped.

## Please attack
1. The new syncAlbum access test relies on no access grant being stubbed by default — is `checkOwnerAccess`/shared-link/album-user access mocked empty for `album.download` in `newTestService`? Could it reject on an earlier guard with a coincidentally matching message? (It can't match the gate message, but confirm.)
2. Is the N3 python one-liner safe — does it ever print a value (e.g. non-string fields)?
3. Is this round clean enough to deploy the wave8 series (a0cdc42de..HEAD)? Say so explicitly if you see anything that should block.

## Not verified
Medium suite (Docker down). Runbook cleanup not executed against production.

Do not read generated files.
