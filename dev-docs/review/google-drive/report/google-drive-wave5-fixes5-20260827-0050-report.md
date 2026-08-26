# Review request — Wave 5 fixes round 5 (H1/H2/H3 gate hardening)

Fixes for `google-drive-wave5-fixes4-20260827-0030-review.md`, whose verdict was "G1/G2/G3 fixed,
nothing blocking" with three latent gate issues (H1/H2/H3) flagged as a cleanup. **Test-infra only
— the diff touches `dev-test/google-drive/run.sh` and nothing else.** Per CLAUDE.md §2.4 it is still
a review target.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit to review | `b890bcc61` |
| HEAD at request | `efe523ea1` |
| Prior review | `../review/google-drive-wave5-fixes4-20260827-0030-review.md` |
| Plan feedback | `dev-docs/google-drive/album-menu-ux-plan.md` §10 |

## What changed (all in the svelte-check gate)

- **H1** — path extraction switched from `awk '{print $2"\t"$1}'` to
  `sed -E 's/^ *([0-9]+) (.*)/\2\t\1/'`, so a path containing a space is no longer truncated into a
  non-matching string (was a false FAIL).
- **H2** — error-line filter switched from `grep ' ERROR '` to `awk '$2=="ERROR"'` (field match),
  so a WARNING whose *message* contains `" ERROR "` can't be parsed as an error line (was a false
  FAIL).
- **H3** — the baseline is now compared in **both** directions. REGRESSION (more errors than
  baseline) fails; STALE (fewer) does not fail but prints a loud "regenerate" notice, so an upstream
  merge fixing a pre-existing error no longer silently widens what that file tolerates.
- **timeout** — `timeout 600 npx svelte-check`, so a *hang* (not just a crash) becomes a
  no-`COMPLETED` FAIL instead of stalling the suite.

## Please attack

1. **The two-direction awk (H3).** Does it ever misclassify — REGRESSION reported as STALE or vice
   versa, or a spurious STALE for the empty-current case? I guard `$1!=""` on the current side;
   confirm that handles "all errors fixed ⇒ SC_CUR empty" without a phantom entry.
2. **H1/H2 substitutions.** Does `sed -E 's/^ *([0-9]+) (.*)/\2\t\1/'` mishandle any real
   `uniq -c` line, and does `awk '$2=="ERROR"'` ever drop a genuine error line (e.g. a differently
   shaped machine-format line)?
3. **The STALE path is a *warning*, not a failure** — is that the right call, or should a stale
   baseline fail the gate? I argued under-count is safe and failing on it would make routine
   upstream merges break this feature's suite.
4. **timeout 600** — reasonable ceiling on an 8GB box, and does `timeout`'s exit path reliably land
   on the no-`COMPLETED` branch?

## Verified / not verified

- **Verified (all reproduced):** clean tree PASS with no STALE; the same `+page.svelte` injection
  that the round-3 gate PASSed now FAILs end-to-end; all-fixed ⇒ STALE only (no fail); spaced path
  preserved; over-count in a baseline file ⇒ REGRESSION — 6/6 synthetic cases plus the end-to-end
  injection.
- **Not verified:** a genuinely hung (not crashed) svelte-check; H1/H2 as *live* failures (verified
  unreachable in-repo today: 0 spaced paths, 0 warning messages containing `" ERROR "`).
- **No shipped-code / server / schema change** ⇒ no SQL/SDK regen, no drift check.

## Test evidence

`dev-test/google-drive/results/20260827-0044.txt` (clean tree at gate-hardening code):

```
── web (svelte-check, baseline-gated) ── no svelte-check regressions vs baseline (3 pre-existing files)
RESULT: PASS
```

Isolated comparison-logic runs (S2 new-file→REGRESSION, S3 count-bump→REGRESSION, S4 all-fixed→STALE
only, S5 spaced-path preserved) and the end-to-end `+page.svelte` injection→FAIL are in plan §10.
