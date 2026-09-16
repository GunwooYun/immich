# Review request — wave9b: per-photo "in Drive" badge

**Branch:** `feat/google-drive-album-sync-v3.1.0`
**Commits:** `2f83943cb` (feature), `07c7b937d` (runner list), `f05f8d7ba` (evidence — **RESULT: FAIL**, kept), `00e87c6cd` (fixture fix), `f5b1128bc` (evidence, PASS)
**Diff:** `git diff 9fa7d564e 00e87c6cd -- server/src web/src dev-test` (skip `open-api/`, `packages/sdk/`, `mobile/openapi/` — generated)
**Not in scope:** wave9a (album menu state) is under separate review.

## Design (research doc item 2, restated because `.claude/` is not in your worktree)
Do not join the ledger into the timeline bucket query (hot path shared by photos/albums/memories/search/shared links). Instead a side lookup for rendered assets only.

| Layer | Change |
|---|---|
| DTO | `GoogleDriveUploadedLookupDto { assetIds: uuid[] max 1000 }`, response `{ assetIds: string[] }` |
| Controller | `POST /google-drive/me/uploaded`, `@HttpCode(200)`, `getMyGoogleDriveUploadedAssets` |
| Service | `getUploadedAssets(userId, ids)`: `[]` if empty, feature disabled, or **no credentials** (checked before the ledger: with no connection `currentAccountOf` reads `''`, matching all legacy unstamped rows); else `getUploadedAssetIds` (existing, chunked, `ledgerMatches`) |
| Web manager | `googleDriveUploadedManager`: `request(ids)` debounce 250ms, skip known, batch 1000; uploaded kept for session; not-uploaded re-askable after 60s; failure forgets ids; no toast |
| Timeline | `$effect`: if flag on and not shared link, collect ids of months `isInOrNearViewport && isLoaded`, `request()` them; passes `driveUploaded={manager.has(asset.id)}` |
| Thumbnail | `driveUploaded` prop → Drive icon bottom-right (`bottom-7` when owner name shown), not on shared links |

## Mutations
| Mutation | Result |
|---|---|
| service: remove credentials gate | 1 failed — "not connected … without consulting the ledger" |
| manager: re-ask window always blocks | 1 failed — re-ask test |
| manager: failed lookup not forgotten | 1 failed — retry test |
| thumbnail: ignore `driveUploaded` (always show) | 1 failed — "shows no badge otherwise" |
| thumbnail: never show | 1 failed — "shows the badge" |

## Evidence
- `dev-test/google-drive/results/20260916-2319.txt` — **FAIL**: svelte-check gate caught new type errors (new cases copied `assetFactory` → `AssetResponseDto` vs `TimelineAsset`). Fixed in `00e87c6cd`.
- `dev-test/google-drive/results/20260916-2322.txt` — commit 00e87c6cd, clean: server 284, web 66, svelte-check no regressions, **PASS**.
- `mise //server:ci-unit` 2394 passed / 2 skipped; `mise //web:ci-unit` 582 passed / 2 skipped (before the fixture fix; fix is test-only).

## Please attack
1. **Authorization.** The endpoint takes arbitrary asset ids. It filters by `userId = auth.user.id` in the ledger, so it can only reveal the caller's own ledger rows — confirm there is no way to learn anything about another user's assets (timing aside). Should it also run `requireAccess(AssetRead)`? (It doesn't; cost vs value.)
2. **`$effect` reactivity in Timeline.** It reads `timelineManager.months`, each month's `isInOrNearViewport`, `isLoaded`, and `getAssets()` (reduce over days). How often does this re-run while scrolling a large library, and is the cost (iterating rendered assets + a Set lookup each) acceptable? Could it loop (does `request()` write anything the effect reads)? `request()` touches only non-reactive Map/Set; `#uploaded` (SvelteSet) is written only in `flush()` after await.
3. **`has()` in the thumbnail snippet** reads a SvelteSet per thumbnail — does a single `add` re-render all thumbnails or only those whose `has(id)` changed?
4. **Stale / logout.** Session-lifetime cache, `reset()` is never called on logout — can user B in the same tab see user A's badges? (Is a full reload on logout guaranteed in immich web?)
5. **Semantics after re-link to a different Drive account.** Uploaded ids are cached for the session; server-side scoping handles new lookups. Acceptable?
6. Upstream `Thumbnail.svelte` is shared — any regression risk to existing overlays (owner name, archive, stack)?

## Not verified
- No component test for the Timeline `$effect` wiring; not seen in a browser yet.
- Medium suite not run for this change (no SQL change; `getUploadedAssetIds` already has medium coverage? — please check).
