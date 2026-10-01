# Review request — wave11e: wave11d fixes (closing round)

- Branch: `feat/google-drive-album-sync-v3.1.0`
- Range: `68765f1ae..c0e99a0d7` — code-adjacent change in `2409a8597`, docs in `c0e99a0d7`
- Plan: `dev-docs/google-drive/stabilization-plan.md` (wave11 — this closes it)
- Previous: wave11d review NOT BLOCKED. This round exists because §2.4 makes fixes review targets.

## What changed

| Commit | File | Change |
|---|---|---|
| `2409a8597` | `server/src/enum.ts` | Comment only: why `GOOGLE_DRIVE_MAX_UNATTENDED_ATTEMPTS` counts across class changes (wave11d N1 — kept as intended) |
| `2409a8597` | `server/src/services/google-drive.service.spec.ts` | One assertion: the "moved from" detail ends in `[ENOENT]` (wave11d N4) |
| `c0e99a0d7` | `CLAUDE.md`, plan | V6/V11 wording; wave11d verdicts; post-deploy note on reading the pending count (N5); R4 needed no code (V11 already covered) |

No runtime code changed in this range.

## Please attack

1. **N1 decision.** I kept cross-class counting rather than resetting `attempts` on a class change,
   because the settings page shows `attempts` as "how many times this asset has been tried". Is
   there a reader of `attempts` I missed for which cross-class counting is wrong? (grep found the
   DTO `google-drive.dto.ts:194`, the settings page, `getFailures`, the cap.) Is "five tries, the
   last not a rate limit" a defensible stopping rule, or should the cap be redesigned?
2. **R4 claim:** V11 is covered by existing tests `getStorage` → "report a revoked grant as
   disconnected…" and `getPickerConfig` → "clear a revoked grant instead of only refusing" (+ the
   non-invalid_grant negative). I replaced each `clearRevokedGrant(...)` call with `void 0` and each
   test went red. Confirm, and confirm the claim that no `Revoked` row can be written on these
   paths (error table PK `(userId, assetId)` with an asset FK).
3. Doc accuracy: the plan's "wave11d review verdicts" section and the CLAUDE.md verification table
   rows V6, V7, V11, V12 against the code at `c0e99a0d7`.

## Test evidence

`./dev-test/google-drive/run.sh --medium` → `dev-test/google-drive/results/20261001-1814.txt`

| | |
|---|---|
| commit | `c0e99a0d7` + uncommitted `M mise.lock` only (pre-existing, unrelated) |
| server unit | 328 / 328 |
| web unit | 87 / 87 |
| svelte-check | no regressions vs baseline (3 pre-existing) |
| medium | 72 / 72 |
| result | **PASS** |

Rest of §3 at `c0e99a0d7`: `tsc` exit 0; `eslint src test --max-warnings 0` exit 0; server vitest
94 files, 2455 passed / 2 skipped; web vitest 603 passed / 2 skipped.

Negative run: removing the errno suffix in `describePaths` turns "report the path it actually
failed on, not the stale one" red (the new N4 assertion).

## Verified / not verified

- Verified: the N4 assertion fails when it should; V11 tests fail when it should (mutation).
- Not verified: anything in production — this branch is not deployed. The post-deploy
  observation steps are in the plan's "Cannot be verified here".
