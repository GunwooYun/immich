# Review request — Wave 5 fixes round 7 (J1: safe baseline regen subcommand)

Fix for `google-drive-wave5-fixes6-20260827-0730-review.md`, whose only finding was J1 — the
documented regen command's `&& mv` cannot abort on a failed svelte-check in an interactive shell
(no `pipefail`), so it can still install a zero-byte baseline. **Test-infra only** — the commit
touches `dev-test/google-drive/run.sh` and nothing else; it is NOT in the deploy image
(`server/Dockerfile` copies `./server ./web ./i18n ./packages`, not `./dev-test`). Reviewed at the
user's explicit request before deploy, per CLAUDE.md §1/§2.4.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit to review | `d4d5d493c` |
| HEAD at request | `0eb16b776` |
| Prior review | `../review/google-drive-wave5-fixes6-20260827-0730-review.md` |
| Plan feedback | `dev-docs/google-drive/album-menu-ux-plan.md` §12 |

## What changed

- Added a `--regen-baseline` subcommand near the top of `run.sh`. It runs the extraction under the
  script's own `set -o pipefail`, requires a `COMPLETED` line, refuses to write an empty baseline
  (which the gate's `-s` guard would then fail on), and installs atomically via `mktemp` + `mv`.
- Collapsed the extraction pipeline into one shared `sc_extract` function used by both the gate and
  the regen — they were two copies and had drifted once (the comment kept an older `grep`/`awk`).
- Replaced the paste-a-command-from-a-comment regen instructions with a pointer to the subcommand.
- Diagnostic nit: hoisted the `-s` baseline check ABOVE the svelte-check run, so a missing/empty
  baseline fails instantly instead of paying ~14s for an already-decided result. (This added one
  nesting level; please check the `if/else/fi` balance — `bash -n` passes.)

## Please attack

1. **The restructured control flow.** `-s` → (else) svelte-check → `COMPLETED` → (else) compare. Is
   the `if/else/fi` nesting correct, and does every branch set `FAILED=1` where it should? `bash -n`
   is clean but that only proves syntax, not that a real failure still reaches `RESULT: FAIL`.
2. **`--regen-baseline` refuses the wrong things?** It exits non-zero on no-`COMPLETED` and on an
   empty result. Is there a case where it should refuse but installs anyway, or refuses a legitimate
   regen (e.g. a tree that genuinely has zero errors — is exit-1 the right call there)?
3. **`sc_extract` as shared code** — does routing both the gate and the regen through it change the
   gate's behaviour in any case the previous inline pipeline handled differently?
4. **`mktemp` + `mv`** — atomic and correct under `set -e`-less `set -uo pipefail`? Does a failed
   `printf > "$SC_TMP"` still `&& mv`?

## Verified / not verified

- **Verified:** `bash -n` clean; `--regen-baseline` reproduces the checked-in baseline
  byte-for-byte; empty baseline → FAIL without running svelte-check; full suite `--medium`
  199/29/10 PASS, gate clean.
- **Not verified:** a real failed/hung svelte-check inside `--regen-baseline` (I verified the
  `pipefail` behaviour that makes the guard necessary, and the `COMPLETED` guard that catches it,
  but did not wedge svelte-check itself).
- **No shipped-code / server / schema change** ⇒ no SQL/SDK regen, no drift check. Not in the deploy
  image.

## Test evidence

`dev-test/google-drive/results/20260827-0736.txt` and the clean `--medium` run at HEAD:

```
── web (svelte-check, baseline-gated) ── no svelte-check regressions vs baseline (3 pre-existing files)
── server (medium) ──                    Tests  10 passed (10)
RESULT: PASS
```
`--regen-baseline` output diffs byte-identical against the checked-in baseline (plan §12).
