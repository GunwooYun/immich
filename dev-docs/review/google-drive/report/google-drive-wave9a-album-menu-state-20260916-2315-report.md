# Review request — wave9a: album toolbar state + actionable blocked row + near-full warning

**Branch:** `feat/google-drive-album-sync-v3.1.0` · **Commit:** `1a26d5a6f` (feature), `9acd3ccce` (evidence)
**Also covers (evidence only, uncited):** `e44ab8e84` — first medium (real DB) run of the deployed wave8 commit `39d4b5900`: unit 280 / web 45 / medium 60, PASS.
**Diff:** `git diff 39d4b5900 1a26d5a6f -- web i18n` — web only, no server change.

## Why
Item 4 of `.claude/docs/research/google-drive-menu-ux.md` is not readable from your worktree (`.claude/` is gitignored), so the three findings are restated:
1. The album toolbar Drive icon never reflected state; you had to open each album's menu.
2. The blocked row (`quota_exceeded` / `folder_missing`) described the block with no way to act.
3. "Sync now" ignored the storage ratio, starting syncs into a Drive at >= 95%.

## What changed
| # | Change | Files |
|---|---|---|
| 1 | Pure helper `getGoogleDriveIndicator` → `'blocked' \| 'syncing' \| 'synced' \| null` (not backed up → null; blocked wins; syncing = album backlog > 0). Album page loads `getGoogleDriveAlbumStatus` + `getMyGoogleDriveStatus` (both DB-only) on album open when `featureFlagsManager.value.googleDrive`, via `$effect`; renders an aria-hidden dot and puts the state in the button title | `web/src/lib/utils/google-drive-indicator.ts` (+spec), album `+page.svelte` |
| 2 | Blocked row clickable: folder_missing → `goto(user settings, GOOGLE_DRIVE_SYNC)`; quota → `open('https://drive.google.com/settings/storage')`; both close the menu | `GoogleDriveAlbumMenu.svelte` (+spec) |
| 3 | Sync row shows a red warning when `pending > 0 && storageRatio >= 0.95`; still clickable. Thresholds moved to shared constants | same |
| i18n | 6 keys added | `i18n/en.json` |

## Mutations (menu file mutated, restored; baseline 28 passed across menu spec + helper spec)
| Mutation | Result |
|---|---|
| quota block routed to settings | 1 failed — quota test |
| warning never rendered | 2 failed — warn test, still-clickable test |
| warning ignores `pending` | 1 failed — "nothing to sync" |
| blocked row `onclick` removed | 2 failed — both routing tests |

## Evidence
`dev-test/google-drive/results/20260916-2308.txt` — commit 7ef041c1e (evidence commit atop identical code), no UNCOMMITTED marker: server 280, web 51, svelte-check no regressions, RESULT: PASS. `mise //web:ci-unit`: 574 passed / 2 skipped.
ESLint on changed files crashes in `tscompat/tscompat` (`Cannot read properties of undefined (reading 'Class')`) — pre-existing, reproduces on untouched files; not caused by this change.

## Please attack
1. **`$effect` in the album page.** It reads `featureFlagsManager.value.googleDrive` and `album.id`; the loader writes `driveBackedUp/driveUploaded/driveTotal/driveBlockedReason`. Can this loop (does the effect track anything it writes)? Is the stale-album guard (`albumId !== album.id`) correct when navigating between albums in the same component instance? Race with `loadGoogleDriveMenu` writing the same state.
2. **Cost claim.** Are `getAlbumBackupStatus` and `getMyStatus` truly DB-only (no Google API, no identity probe — CLAUDE.md §7 warns `getGoogleDriveStatus` triggers a probe)? Query cost on a 5,000-asset album?
3. **Non-owners / non-connected users.** A member who never connected Drive: does either call 400/403 and, if so, is swallowing it right? Does `getMyStatus` for an unconnected user return a blockedReason that would light a dot? (Dot requires `subscribed`, so should be null.)
4. **Dot placement / a11y.** `absolute end-1.5 top-1.5` inside `relative` wrapper around `ButtonContextMenu` — does wrapping change the menu anchor computation (`getBoundingClientRect` of the button)? Is `ring-light`/`ring-dark` a real token in this Tailwind setup?
5. Is "warned, not disabled" the right call for #3?

## Not verified
- No component test of the album page wiring (the page is not unit-rendered anywhere in the repo). Not seen in a browser yet.
- Medium suite not re-run for this commit (web-only change).

Do not read generated files.
