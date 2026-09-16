# Review request — wave9c: wave9a fold-in + CAS on connectionId

**Branch:** `feat/google-drive-album-sync-v3.1.0`
**Commits:** `97c745e83` (wave9a review fixes), `c9523c5de` (CAS move), `18…` evidence commit right after (see `git log`)
**Previous:** `review/google-drive-wave9a-album-menu-state-20260916-2315-review.md` — BLOCKED (C1, C2; N1–N5)
**Separate, still under review:** wave9b (per-photo badge). Its commits sit between wave9a and these; ignore them here.

## Part 1 — wave9a fold-in (`97c745e83`)
| Finding | Change |
|---|---|
| C1 dot ignores disconnection | `GoogleDriveMyStatusDto.connected` (service `getMyStatus` adds `getCredentials` to its Promise.all; token never leaves the server). Helper gains `'disconnected'` outranking blocked/syncing/synced for backed-up albums; not-backed-up still null. Page applies album status + my status **both or neither** (otherwise `connected` default false would light "not connected" on a failed call). OpenAPI/SDKs regenerated. i18n key added |
| C2 lint | `total > uploaded`; eslint on helper + spec exits 0 |
| N1 | already fixed in `07c7b937d` |
| N2 | exact-95% test added |
| N4 | indicator load requires `album.assetCount > 0` |
| N3, N5 | not changed (reasons in commit message) |

Mutations: helper `!connected` branch disabled → 1 failed; `>=`→`>` → 1 failed (the new boundary test); service `connected: false` → 1 failed.

## Part 2 — M8 CAS half (`c9523c5de`)
Backlog M8 (round-21) = refreshToken nullable + CAS to connectionId. Re-planned: **CAS only**; nullable dropped because the OAuth app is now In production (no weekly expiry), and soft disconnect would break "row exists = connected" at ~9 queries / 7 service readers. Decision recorded in CLAUDE.md §7 item 10.

| Where | Change |
|---|---|
| repo `setDriveAccountId(userId, connectionId, id)` | update `where connectionId = ?` |
| repo `adoptUnstampedUploads(userId, connectionId, id)` | lock select `where userId and connectionId = ? for update`; body uses the argument |
| repo `fillFolderName(userId, connectionId, folderId, name)` | `where connectionId = ?` |
| service | callers pass `credentials.connectionId`; `adoptIfNewlyIdentified` param type `{ connectionId; driveAccountId }` |
| generated SQL | **only the two predicate lines** — a full `mise //:sql` here also dropped second statements of two multi-statement methods incl. untouched `getErrorSummary`; judged an environment artefact and not committed. Please check whether CI's "Generated SQL is current" will agree |
| medium spec | refusals = row CONNECTION_B / call CONNECTION_A with in-test positive witness; re-link test reads re-minted id and asserts adoption `true` |

Mutations (medium): drop connectionId where in each of the 3 methods → 1 failed each; drop re-mint in `upsertCredentials` → 2 failed.

## Evidence
`dev-test/google-drive/results/20260916-2331.txt` — commit c9523c5de, clean tree: server 285, web 69, svelte-check no regressions, **medium 60**, RESULT: PASS. `mise //server:ci-unit` 2395 passed / 2 skipped.

## Please attack
1. **C1 fix completeness.** Any other state where a backed-up album shows green/blue while nothing uploads (e.g. feature misconfigured server-side — does the page even render the button then?). Does the menu (opened) agree with the dot in the disconnected case?
2. **Both-or-neither** in `loadGoogleDriveIndicator`: after a successful first load, a later failed reload leaves previous values — acceptable?
3. **CAS semantics.** Is there any path where the refresh token changes *without* connectionId changing (token rotation on refresh writing back via upsert? any `update user_google_drive set refreshToken`)? If so, the old token-CAS refused and the new one accepts — is accepting correct there?
4. Any remaining reader that still compares tokens as identity (grep `refreshToken` in repository/service)?
5. The generated-SQL partial update — safe, or will CI fail?
6. `getMyStatus` now reads credentials on every poll of the progress manager — cost acceptable?

## Not verified
Browser; a live disconnect in production (not done on purpose).
