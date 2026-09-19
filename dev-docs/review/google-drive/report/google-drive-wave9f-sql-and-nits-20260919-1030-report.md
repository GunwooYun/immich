# Review request — wave9f: wave9e fold-in (deploy gate)

**Branch:** `feat/google-drive-album-sync-v3.1.0` · **Commits:** `a651712e4` (fix), `f4e484237` (evidence)
**Previous:** `review/google-drive-wave9e-foldins-20260919-0930-review.md` — NOT BLOCKED, C1 + N1–N5
**Diff:** `git diff dd5c0eb6b a651712e4 -- server/src web/src i18n`
**Why this round matters:** this is the last commit before deploying the branch to the production laptop, so please judge deploy-fitness explicitly.

| Finding | Change |
|---|---|
| **C1** stale generated SQL (`getAlbumBackupStatus` block lacked `failedCount`; upstream CI `sql-schema-up-to-date` exits 1 on drift) | Block regenerated **by me, independently of the reviewer's pasted SQL**: the repository's own query builder against a Kysely `DummyDriver` (PostgresAdapter/Introspector/QueryCompiler) with the same `format(query, { language: 'postgresql' })` call `sync-sql.ts` uses, spliced into the file. Parameters shift to $3..$8. The real generator cannot run here — this dev DB predates the branch's migrations, so it errors on the first statement and truncates |
| N1 dot flickers on every `album` object replacement | new `driveIndicatorAlbumId` state; the effect clears counters only when the album id actually changes |
| N2 stale docblocks | `auth.service.ts` no longer claims `include_granted_scopes` is sent; the gate docblock lists the secret and prompt clauses |
| N3 menu contradicted the dot | menu takes `failed` and shows "N failed — press to retry" on the sync row (only while `pending > 0`) |
| N4 `prompt` parsing | splits on commas as well as whitespace |
| N5 | nits, no change |

## Mutations
| Mutation | Result |
|---|---|
| menu failure line shown regardless of `pending` | 1 failed — "nothing once the album is fully uploaded, however stale the error rows" |
| prompt split on `/,/` only | 1 failed — consent clause test |
| prompt split on `/\s+/` only | 1 failed — same test (the comma case) |

## Evidence
`dev-test/google-drive/results/` newest — commit `a651712e4`, clean tree: server 309, web 77, **medium 61**, svelte-check no regressions, RESULT: PASS. `mise //server:ci-unit` 2435 passed / 2 skipped; `mise //web:ci-unit` 593 passed / 2 skipped.

## Please attack
1. **The regenerated SQL block.** Compile `getAlbumBackupStatus` yourself (DummyDriver, or the real generator if you can migrate a scratch DB) and diff against `src/queries/google.drive.repository.sql`. Byte-identical? Parameter numbering right? Did splicing disturb the neighbouring blocks or the file's trailing content?
2. **`driveIndicatorAlbumId`.** Any path where the album id stays the same but the counters must be reset anyway (e.g. the user disconnects Drive from settings in another tab, or `handleToggleGoogleDriveBackup` turns backup off)? Any path where it is set but the load never runs, leaving stale counters visible?
3. **Menu `failed` line.** `pending` is `max(total - uploaded, 0)` and `failed` comes from a different query on a different axis — can `failed > pending` render something absurd? Should the line be suppressed when `failed > pending`?
4. **Deploy fitness of the whole branch** (`v3.1.0`..HEAD): anything that would break the running production instance, given the laptop's stored config row supplies all Drive credentials, OAuth login is not configured there, and the ledger holds ~8,100 rows. Specifically: does any commit in this series change queueing, the worker, or adoption behaviour?

## Not verified
Browser rendering; login grant end-to-end; upstream CI itself.
