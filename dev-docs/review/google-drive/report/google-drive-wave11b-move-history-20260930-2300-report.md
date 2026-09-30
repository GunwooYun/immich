# Review request — wave11b (R1): mid-move original via move_history

- Branch: `feat/google-drive-album-sync-v3.1.0`
- Range: `791c48ea4..3cbdc45a9` (one commit)
- Plan: `dev-docs/google-drive/stabilization-plan.md` — round R1 (F1, F1p); scenarios V1a–V1f
- Previous round: wave11a review (NOT BLOCKED); its M1, M2, N1 are folded into this commit

## What changed

| File | Change |
|---|---|
| `server/src/services/google-drive.service.ts` | `openOriginal` now calls new `findMovedOriginal`: (1) re-read asset row → moved? use it; (2) else `moveRepository.getByEntity(id, Original)` → use `newPath` **only if `oldPath` equals the path that failed**; (3) else re-read the row once more. Log line names which signal found the file. Doc comment rewritten |
| same file | wave11a M2: `files.create` comment now cites production evidence (983 uploads > 5 MB, max 7.2 GB) instead of a misreading of Google's docs |
| `server/src/repositories/job.repository.ts` | wave11a M1: `removeOnFail` comment — load-bearing after all (stall detection; a rejecting `JobError` listener) |
| `server/src/utils/google-drive.ts` | wave11a N1: rewrap |
| `server/src/services/google-drive.service.spec.ts` | 4 new tests (mid-move describe), 1 test renamed + witness changed |
| `server/src/services/storage-template.service.spec.ts` | fork-owned order pin for `StorageCore.moveFile` |

Production motivation: the only open error row (2026-09-23) — created 00:48:19, failed 00:48:24,
detail naming only `/data/upload/...`, file now in `/data/library`. `StorageCore.moveFile`
(`storage.core.ts:229-269`): create move row → rename → `savePath` → delete move row.

## Please attack

1. **The window claim.** Is there any mover path where the file has left `oldPath` but the move
   row does not (yet/any longer) name it *and* the asset row is still stale? Consider the
   incomplete-move recovery branch (`storage.core.ts:203-227`, which rewrites `oldPath` to the
   actual location), `EncodedVideo` vs `Original` path types, and the sidecar/motion-photo moves.
2. **Reading `newPath` mid-move.** I claim it is safe on both mover paths (rename is atomic;
   the EXDEV copy path only unlinks the source after verification, so ENOENT on the source means
   the copy is complete). Is there a moment where `newPath` exists but is partial and our
   `createReadStream` could open it? (copy in progress → source still exists → we would not have
   hit ENOENT… unless the first read failed for another reason — see 4.)
3. **The `oldPath` guard.** Could it reject a legitimate in-flight move (e.g. the recovery branch
   setting `oldPath` to a path different from the asset row)? The design review's version had no
   guard; I added it against stale rows from older aborted moves.
4. **Error kind.** The fallback runs for *any* first-read error, not only ENOENT (unchanged from
   before). With an EACCES on the old path and a move row present, we would read `newPath` —
   is that ever wrong? (F6 in R3 will split read errors; say if R1 should already.)
5. **Tests.** Does each new test fail for the reason it claims? The mutations I ran (below) are
   the evidence; look for a test that would also pass with the fallback deleted.
6. The renamed test's witness went from 2 to 3 row reads. That is a contract change, not a test
   bent to pass — check that the reasoning holds.

Don't read generated files (`open-api/`, `packages/sdk/`, `mobile/openapi/`, `src/queries/`); no
query or DTO changed in this round.

## Test evidence

`./dev-test/google-drive/run.sh --medium` → `dev-test/google-drive/results/20260930-2255.txt`

| | |
|---|---|
| commit | `3cbdc45a9` + uncommitted changes (docs only: `CLAUDE.md`, the plan, `mise.lock` pre-existing, the untracked wave11a review file — no server/web code) |
| server unit | 320 / 320 |
| web unit | 87 / 87 |
| svelte-check | no regressions vs baseline (3 pre-existing files) |
| medium | 65 / 65 |
| result | **PASS** |

Rest of §3 at `3cbdc45a9`: `tsc --noEmit` exit 0; `eslint src test --max-warnings 0` exit 0;
server `vitest --config test/vitest.config.mjs` 94 files, 2447 passed / 2 skipped; web `vitest`
603 passed / 2 skipped. `verify-task server` exit 0.

### Negative runs (each mutation applied, run, reverted; file compared byte-identical after)

| Mutation | Red tests |
|---|---|
| move-row branch disabled | "read the move row destination…", "name both paths when the move row destination is unreadable too" |
| `oldPath` guard removed | "ignore a move row whose oldPath is not the path that failed" |
| second row re-read disabled | "find the new path on a second row read…" |
| `savePath` moved before rename in `storage.core.ts` | "create the move row, rename, update the asset row, then delete the move row — in that order" |

## Verified / not verified

- Verified by unit tests with mocks: the branch logic, the order pin.
- **Not verified:** a real concurrent move against a real filesystem. The race is reproduced only
  by mock sequencing. Production observation after deploy is the only real check: the log line
  `(found via move_history)` should appear, and `source_unreadable` rows from `/data/upload`
  paths should stop.
- Not verified: the order pin runs only the default template and the rename path, not EXDEV.
