# Review request — Wave 5 fixes round 6 (I1: baseline fail-open)

Fix for `google-drive-wave5-fixes5-20260827-0050-review.md`, whose only finding was I1 — the gate
fails open on a missing or empty baseline. **Test-infra only** (`dev-test/google-drive/run.sh`).
Per CLAUDE.md §2.4 the fix is a review target, and per §1 deploy can't proceed until it's reviewed,
so this is the last gate before the branch is deploy-ready.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit to review | `ea2eec5a2` |
| HEAD at request | `829bd50ce` |
| Prior review | `../review/google-drive-wave5-fixes5-20260827-0050-review.md` |
| Plan feedback | `dev-docs/google-drive/album-menu-ux-plan.md` §11 |

## What changed

- Added `[[ ! -s "$SC_BASELINE" ]]` as the **first** branch of the gate: a missing or empty
  baseline is a FAIL, before the COMPLETED check and before the comparison awk runs. This closes
  both I1 mechanisms — awk aborting on a missing file, and the `NR==FNR`-stays-true trap on an
  empty first file that misclassifies every current error into `base[]`.
- Made the documented regen command atomic (`> /tmp/sc-baseline.$$ && mv …`), so an interrupted
  or wrong-directory regen can't leave a zero-byte baseline behind.
- Comment states the guard is load-bearing (stops the empty file before awk's NR==FNR sees it), not
  a redundant existence check.

## Please attack

1. **Does `-s` fully close I1?** Any remaining shape — a baseline that exists, is non-empty, but is
   malformed (e.g. a line with no tab, or a count that isn't a number) — that slips a real
   regression through? I did not add format validation beyond `-s`.
2. **Branch ordering.** `-s` is now first, then `COMPLETED`, then compare. Is there a case where a
   present-but-stale baseline plus a crashed svelte-check should FAIL but doesn't?
3. **The atomic regen** — is `/tmp/sc-baseline.$$` safe here (single-user dev box), and does the
   `&& mv` correctly abort the write if the pipeline's last stage fails? (Note `pipefail` is set at
   the top of run.sh.)

## Verified / not verified

- **Verified end-to-end:** empty baseline → FAIL; missing baseline → FAIL; clean tree → PASS with
  no stale; full suite `--medium` → 199/29/10 PASS.
- **Not verified:** a malformed-but-non-empty baseline (see attack #1); a genuinely hung
  svelte-check (unchanged from last round).
- **No shipped-code / server / schema change** ⇒ no SQL/SDK regen, no drift check. Wave 5's shipped
  code is unchanged since round 3.

## Test evidence

`dev-test/google-drive/results/20260827-0726.txt` (code identical to `ea2eec5a2`):

```
── web (svelte-check, baseline-gated) ── no svelte-check regressions vs baseline (3 pre-existing files)
── server (medium) ──                    Tests  10 passed (10)
RESULT: PASS
```

Isolated + end-to-end I1 reproduction and its fix (empty/missing → FAIL) are in plan §11.
