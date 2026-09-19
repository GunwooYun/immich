# Review request — wave9g: the album-id guard, for real this time

**Branch:** `feat/google-drive-album-sync-v3.1.0` · **Commits:** `6fec788a3` (fix), `b527fd534` (evidence)
**Previous:** `review/google-drive-wave9f-sql-and-nits-20260919-1030-review.md` — NOT BLOCKED; C1 (a false claim in a commit message), N1, N2
**Diff:** `git diff 9665ace92 6fec788a3 -- web/src`  (web only)
**Deployed meanwhile:** `9665ace92` is live on the laptop as `immich-server:3.1.0-gdrive-w9` (reviewed in wave9f). This commit is *not* deployed; it is meant for the next image.

## What happened
wave9f's C1: commit `a651712e4` claimed it added a `driveIndicatorAlbumId` guard. It did not — the edit was lost when a script aborted before saving, and the message described intent rather than the diff. Nothing shipped wrong (the effect kept clearing on every `album` replacement, a one-round-trip flicker), but the message lied.

| Change | Where |
|---|---|
| `driveIndicatorAlbumId` state; the indicator `$effect` clears the six counters only when the album id differs from the one they describe | album `+page.svelte` |
| Test for a single failure on the menu's failure line (previous cases used 7/0/4 only, so `failed > 0` could be weakened to `failed > 1` unnoticed) | `GoogleDriveAlbumMenu.spec.ts` |

Mutation: `failed > 0` → `failed > 1` now fails the new test. The `$effect` change has **no test** — nothing in this repo renders that page.

## Evidence
`dev-test/google-drive/results/` newest — commit `6fec788a3`, clean tree: server 309, web 78, svelte-check no regressions, RESULT: PASS. `mise //web:ci-unit` 594 passed / 2 skipped.

## Please attack
1. **The guard itself.** `driveIndicatorAlbumId` is written inside the same `$effect` that reads `album.id` — can that self-retrigger in Svelte 5 (it is `$state` read and written in one effect)? Is there a path where the id matches but the counters must still be cleared (backup toggled off, Drive disconnected in another tab, album emptied so `assetCount` hits 0 and the load is skipped while stale counters remain)?
2. **`assetCount > 0` interaction.** Navigating A (10 assets) → B (0 assets): the id changes, counters clear, no load runs. Correct? And B → A again?
3. Anything else in wave9f's C1 worth recording so the next reader does not trust `a651712e4`'s body.

## Not verified
No page-level test; not seen in a browser.
