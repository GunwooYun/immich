# Review request — Wave 5 fixes round 4 (G1/G2/G3)

Fixes for `google-drive-wave5-fixes3-20260823-1300-review.md`, whose verdict was "R1/R3/R4/R5
fixed; fix G1 before deploy, G2/G3 same commit". **Test-infrastructure only — no shipped-code
change this round.** Per CLAUDE.md §2.4 the fix is still a review target.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit to review | `a87422a7c` |
| HEAD at request | `13f2bbbd8` |
| Prior review | `../review/google-drive-wave5-fixes3-20260823-1300-review.md` |
| Plan feedback | `dev-docs/google-drive/album-menu-ux-plan.md` §9 |

## What changed

- **G1** — replaced the filename-grep svelte-check gate in `run.sh` with a baseline-gated one.
  New: `dev-test/google-drive/svelte-check-baseline.txt` (`path<TAB>error-count` for the 3
  pre-existing files). The gate now (a) FAILs if svelte-check emits no `COMPLETED` line
  (fail-closed), (b) compares the set + per-file count of error files to the baseline (catches any
  new/worse file regardless of name), (c) matches extracted paths only, not whole lines (G3).
- **G2** — the R1 regression test now also asserts `expect(trigger).toHaveFocus()`, pinning why
  the negative passes; comment notes the menu-closed state is self-correcting.

## Please attack

1. **Does the new gate ever fail *closed* wrongly** — i.e. FAIL a legitimately-clean tree? Consider
   svelte-check output-format changes, the `COMPLETED` line assumption, and the awk per-file
   comparison (tab-delimited path/count).
2. **Can it still be fooled into passing** with a real new error? I verified injecting an error
   into `+page.svelte` FAILs and a bad-flag invocation FAILs; find a path I missed (e.g. a new
   error in one of the 3 baseline files that a fix elsewhere in the same file masks — I compare
   per-file counts, not per-error).
3. **Baseline staleness** — is `svelte-check-baseline.txt` a maintenance trap? The regen command is
   documented in `run.sh`; is that enough, and is checking it in the right call vs. computing it?
4. **G2** — is `expect(trigger).toHaveFocus()` the right positive, and does `trigger` resolve to the
   element `focusButton()` actually focuses?

## Verified / not verified

- **Verified:** feature 199/29/10 + baseline gate 0 regressions PASS; gate G1a (injected error in
  +page.svelte → FAIL) and G1b (bad flag → no COMPLETED → FAIL) reproduced; R1 test still
  non-vacuous with G2 addition; eslint clean.
- **Not verified (unchanged, non-code):** browser pass on the four visual states; live-queue e2e.
- **No shipped-code / server / schema change** ⇒ no SQL/SDK regen, no drift check.

## Test evidence

`dev-test/google-drive/results/20260827-0026.txt` (code identical to `a87422a7c`):

```
── server (unit) ──               Tests  199 passed (199)
── web (unit) ──                  Tests   29 passed (29)
── web (svelte-check, baseline) ── no svelte-check regressions vs baseline (3 pre-existing files)
── server (medium) ──             Tests   10 passed (10)
RESULT: PASS
```
