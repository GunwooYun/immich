# Review request — Wave 5 fixes round 8 (K1/K2 + re-indent)

Fixes for `google-drive-wave5-fixes7-20260827-1000-review.md` (K1: swallowed install failure; K2:
zero-errors unrepresentable). **Test-infra only** (`dev-test/google-drive/run.sh` + the checked-in
baseline) — not in the deploy image. Reviewed before deploy per the user's standing condition.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit to review | `bde9baba5` |
| HEAD at request | `f7b35a71b` |
| Prior review | `../review/google-drive-wave5-fixes7-20260827-1000-review.md` |
| Plan feedback | `dev-docs/google-drive/album-menu-ux-plan.md` §13 |

## What changed

- **K1** — the baseline install is now one guarded step:
  `if ! { { echo "#header"; printf '%s\n' "$NEW"; } > "$SC_TMP" && mv "$SC_TMP" "$SC_BASELINE"; }; then rm -f "$SC_TMP"; echo "…nothing was changed"; exit 1; fi`.
  A failed `mv` no longer prints "regenerated" over the old file and exits 0.
- **K2** — regen always writes a `# …` comment header, so the zero-error state is a non-empty,
  valid baseline (and the gate is then *stricter*: any error is a regression). Dropped the
  zero-error refusal. The comparison awk skips `#`-led lines (`if ($0 ~ /^#/) next`) so the header
  is never a path key. Regenerated the checked-in baseline to carry the header (regen is idempotent);
  the "N pre-existing files" count uses `grep -vc '^#'`.
- **Re-indent** — the inner comparison block is re-indented for the level last round's `-s` hoist
  added, and the `# close:` label comments are gone.

## Please attack

1. **K1 guard** — is `if ! { … && … }; then …; fi` the right precedence, and does it catch BOTH a
   failed `printf` (disk full) and a failed `mv`? Does `rm -f "$SC_TMP"` leak the temp on any path?
2. **K2 header** — is the header truly inert in every comparison direction (REGRESSION, STALE,
   absent-from-current)? Does a header-only baseline (zero errors) fail closed on a new error and
   not nag STALE on a clean tree? Any way the header's own text (contains no tab) becomes a phantom
   key?
3. **The re-indent** — did moving lines change any behaviour (it should be whitespace-only besides
   the K1/K2 logic)? Is the `if/else/fi` still balanced (`bash -n` passes)?
4. **Idempotency** — `--regen-baseline` run twice yields identical bytes; confirm, and that the
   checked-in baseline matches what regen produces (so future regens don't spuriously diff).

## Verified / not verified

- **Verified:** `bash -n` clean; regen idempotent + header-carrying; K1 install-failure branch hits
  (unwritable dest → non-zero, old file intact); K2 header-only baseline representable + strict +
  non-nagging + `-s` passes; full suite `--medium` 199/29/10 PASS, gate clean; "3 pre-existing
  files" count correct.
- **Not verified:** a real full-disk `printf` failure (verified the `mv`-failure branch, not the
  `printf`-failure branch, though the same `if` covers both); a real failed/hung svelte-check inside
  regen.
- **No shipped-code / server / schema change** ⇒ no SQL/SDK regen, no drift check.

## Test evidence

```
── web (svelte-check, baseline-gated) ── no svelte-check regressions vs baseline (3 pre-existing files)
── server (medium) ──                    Tests  10 passed (10)
RESULT: PASS
```
K1: unwritable dest → install-failure branch hit (no false success). K2: header-only baseline +
new error → REGRESSION; + clean tree → no STALE; `-s` passes. Details in plan §13.
