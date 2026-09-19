# Review request — wave9e: wave9c + wave9d fold-ins

**Branch:** `feat/google-drive-album-sync-v3.1.0`
**Commits:** `4582d6e1b` (wave9c fold-in) + `40aa155fb` evidence; `25d2c284f` (wave9d fold-in) + `497a168de` evidence
**Previous:** `review/...wave9c-disconnected-dot-and-cas-...-review.md` (NOT BLOCKED, N1–N6) and `review/...wave9d-login-grant-...-review.md` (NOT BLOCKED, N1–N6)
**Diff:** `git diff dbf12fe3f 25d2c284f -- server/src web/src i18n` (skip generated: open-api, packages/sdk, mobile/openapi)

## Part 1 — wave9c fold-in (`4582d6e1b`)
| Finding | Change |
|---|---|
| N1 stale dot across album navigation | the `$effect` clears all six `drive*` states before loading, and loads for the album id it captured |
| N2 menu loader zeroed dot state on a rejected call | assigns only fulfilled results now (each call independently) |
| N4 album stuck on "backing up" when the remaining backlog can never upload | `getAlbumBackupStatus` gains `failedCount` (error row, same user, same album, **no ledger row beside it**); helper gains `'failing'` (amber) when `failed >= pending`; one stuck asset among many still reads `'syncing'` |
| N6 | stale "token" wording in the CAS comment |
| N3, N5 | not changed — reasons in the commit message (N5 needs a new @GenerateSql query and the SQL generator cannot run cleanly against this dev DB) |

Mutations: `failedCount` ignoring the ledger → medium test fails; ignoring the user → same test fails.

## Part 2 — wave9d fold-in (`25d2c284f`)
| Finding | Change |
|---|---|
| N2 gate compared client ids but not secrets | added. Refresh uses `googleDrive.clientSecret` alone and the post-link probe swallows failures, so a mismatch stored a row that looks connected and fails every refresh with `invalid_client` — never cleared, since only `invalid_grant` clears |
| N1 `prompt=consent` mints a refresh token per login | gate returns false when `prompt` contains `consent` (token churn would eventually invalidate the stored one at Google's 100-per-account cap) |
| N3 `include_granted_scopes` | dropped (no-op under the gate; its comment described `prompt` behaviour) |
| N5 shared-link badge guard | test added via `vi.spyOn(authManager, 'isSharedLink', 'get')` — my earlier "untestable" claim was wrong |
| N4, N6 | left; see commit message |

Mutations: dropping the secret clause → 2 tests fail; dropping the prompt clause → 2 fail; removing the shared-link guard → 1 fails.

## Evidence
`dev-test/google-drive/results/` newest — commit `25d2c284f`, clean tree: server 309, web 74, **medium 61**, svelte-check no regressions, RESULT: PASS. `mise //server:ci-unit` 2435 passed / 2 skipped; `mise //web:ci-unit` 590 passed / 2 skipped.

## Please attack
1. **`failedCount` semantics.** Is `failed >= pending` the right trigger for the amber dot? Consider: an asset counted in `failedCount` that is *not* in the pending set (can an error row exist for an asset already uploaded under a different account scope?), duplicates, and assets in the album that the viewer cannot see.
2. **The `$effect` reset (wave9c N1 fix).** It now writes six pieces of state at the top of the effect and reads `album.id`/`album.assetCount` — can this re-trigger itself? Does clearing first cause a visible flicker for a same-album reload (e.g. after toggling backup, which calls `loadGoogleDriveMenu`)?
3. **Menu loader (N2 fix).** With per-call assignment, a first menu open where `getGoogleDriveStatus` rejects now leaves `driveConnected` at its previous value instead of false — is any menu branch wrong in that state?
4. **The two new gate clauses.** Is `prompt.trim().toLowerCase().split(/\s+/).includes('consent')` the right test (could a provider send `prompt=CONSENT%20select_account` or comma-separated)? Is requiring secret equality too strict for any legitimate setup (e.g. a deployment that rotates the OAuth secret but not the Drive one — should it fail closed like this)?
5. Anything in the album-status SQL that scales badly: the query now runs three correlated subqueries over `album_asset` for one album.

## Not verified
- Browser: none of the dot states or the badge have been seen rendered.
- The login grant still has no end-to-end run (gate not satisfiable on this deployment).
