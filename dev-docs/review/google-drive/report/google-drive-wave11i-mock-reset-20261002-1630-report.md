# Review request — wave11i: shared mock reset, pinned-test count

- Branch: `wave11g-isolated-review-fixes`
- Range: `71ba55c79..4426cdfc7` (one commit; the commit before it is the wave11h review file)
- Source: isolated review of this branch (F1, F2) = in-session wave11h review N2, N3

## What changed

| File | Change |
|---|---|
| `server/src/services/google-drive.service.spec.ts` | top-level `beforeEach` adds `driveFilesCreate.mockReset()` (no default restored) |
| `server/test/vitest.config.mjs` | comment count 15 → 16 |

## Please attack

1. The reset restores no default implementation. Is there a test that reaches `files.create`
   without setting an answer and passes only because `undefined` happens to lead to the asserted
   outcome (e.g. a destructuring TypeError caught as a "failure" the test expected)? All 128 pass;
   I did not audit each uploading test for that.
2. The shuffle finding (below): confirm the two tests' `not.toHaveBeenCalled()` on `driveFilesCreate`
   was order-dependent, and that the reset — not something else — is what fixes it. Are there other
   file-wide hoisted mocks (`driveFilesDelete`, `oauth2*`) with the same accumulate-across-tests
   problem behind a negative assertion?
3. The `upload verification` describe still has its own `driveFilesCreate.mockReset()`; now
   redundant — harmless, or worth removing?

## Test evidence

`./dev-test/google-drive/run.sh --medium` → `dev-test/google-drive/results/20261002-1627.txt`:
commit `4426cdfc7`, clean tree; server unit 330/330, web 87/87, medium 72/72, **PASS**.
`verify-task server` exit 0.

| Run | Result |
|---|---|
| Drive spec, shuffled, seeds 1–5, **with** the reset | 128/128 each |
| same, top-level reset removed | 2 failed each — "skip a blocked user … without calling Drive", "skip an asset no longer in any selected album, before calling Drive" |

Honesty note: the first no-reset shuffle batch did not apply its mutation (the match string occurs
twice; the script refused) and its 128/128 lines were not evidence. Re-run with the top-level line
removed by line number; that is the batch reported above.
