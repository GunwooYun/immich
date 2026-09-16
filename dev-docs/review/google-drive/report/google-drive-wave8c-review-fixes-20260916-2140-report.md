# Review request — wave8c: fold-in of the wave8b review

**Branch:** `feat/google-drive-album-sync-v3.1.0` · **Commits under review:** `7048d8be2` (fix), `evidence` commit after it
**Previous round:** `review/google-drive-wave8b-config-truth-20260916-2120-review.md` (NOT BLOCKED; C1–C3, N1–N3)
**Diff to read:** `git diff 22fd909e6 7048d8be2 -- server/src CLAUDE.md`

## What changed, per finding

| Finding | Change | Where |
|---|---|---|
| C1 | Cleanup recipe rewritten: all four keys must match env; a save must actually change a value (web `isEqual` gate skips no-op saves); a mismatching key stays in the row | `CLAUDE.md` §8 |
| C2 | New test for `subscribeAlbum`'s enabled gate (message + `checkOwnerAccess` not called + `subscribe` not called). "Not connected" test now asserts its message. Access test gains witness `getCredentials` not called | `google-drive.service.spec.ts` `album subscriptions` |
| C3 | Redirect-URL error test additionally asserts `IMMICH_GOOGLE_DRIVE_REDIRECT_URL` and `IMMICH_GOOGLE_DRIVE_* variables` | spec `getAuthUrl (redirect URL)` |
| N1 | `getPickerConfig` not-connected asserts message `Google Drive is not connected` | spec `getPickerConfig` |
| N2 | `enabledConfig` loses `enabled: true`; stale comments rewritten | `config.spec.ts` (2), `system-config.service.spec.ts`, `album.service.ts:302` |
| N3 | `GET /api/system-config/defaults` added as the verification step | `CLAUDE.md` §8 |
| (new) | Removed false claim that laptop credentials come from `.env`. Names-only check on 2026-09-16: laptop `.env`, container env and compose file contain **no** `IMMICH_GOOGLE_DRIVE_*` var; the row supplies everything | `CLAUDE.md` §7 |

No production code changed except one JSDoc comment in `album.service.ts`.

## Mutation verification (service file mutated, then restored via `git checkout`)

| Mutation | Result |
|---|---|
| M1 delete `subscribeAlbum` enabled gate | 1 failed / 95 — "should refuse to subscribe when the feature is not configured" |
| M2 revert error wording to "set the server External Domain" / "Configure it in the admin settings." | 1 failed / 95 — getAuthUrl redirect test |
| M3 delete `getPickerConfig` not-connected guard (non-null assert instead) | 1 failed / 95 — "should reject when the user has not connected Google Drive" |
| M4 read credentials *before* `requireAccess` in `subscribeAlbum` | 1 failed / 95 — "should gate subscribing on download access, not merely read access" |

## Test evidence

`dev-test/google-drive/results/20260916-2139.txt` — commit `7048d8be2`, clean tree:
server 8 files / 279 passed; web 5 files / 45 passed; **RESULT: PASS**.
Also run before commit: `mise //server:ci-unit` (format, lint, tsc, 2389 passed / 2 skipped), `mise //web:ci-unit` (pass).

## Please attack

1. **C1 recipe correctness.** Is "all four keys equal → partial vanishes" actually true through `updateConfig` → `getKeysDeep(defaults)`? What about `enabled` (removed from schema) — I claim it drops because `buildConfig`'s `safeParse` strips it and `updateConfig` only walks defaults' keys. Also: is there any other key under `googleDrive` in defaults that would keep a partial alive?
2. **N3.** Does `GET /api/system-config/defaults` actually return env-derived values (i.e. `defaults` built from `process.env` at startup), or a static object?
3. **M4 witness.** Is `getCredentials` not being called a sound proxy for "access control ran first", or could the access test pass for another reason?
4. Any remaining type-only / `toBeDefined` rejection assertions in the Google Drive spec where two guards share an exception type.

## Not verified
- Medium (real DB) suite: Docker Desktop is down.
- The C1 recipe has not been executed against production (it requires the user to put secrets in `.env`; deploying does not require it).

Do not read generated files (open-api, SDK, `src/queries`).
