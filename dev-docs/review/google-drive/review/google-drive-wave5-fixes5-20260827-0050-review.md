# Code Review — Wave 5 fixes round 5 (H1/H2/H3 gate hardening)

Review of `b890bcc61`, the fixes for `google-drive-wave5-fixes4-20260827-0030-review.md`.
Test-infrastructure only — I confirmed the diff touches `dev-test/google-drive/run.sh` and nothing
else. Per CLAUDE.md §2.4 it is still a review target, so this attacks the new comparison rather
than reading it.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit reviewed | `b890bcc61` |
| HEAD at review | `b90f435bc` |
| Report | `../report/google-drive-wave5-fixes5-20260827-0050-report.md` |
| Prior review | `google-drive-wave5-fixes4-20260827-0030-review.md` |
| Reviewed | 2026-08-27 |

## Verdict

**H1, H2, H3 and the timeout are all correctly fixed** — each verified by construction, not by
reading. H1 in particular I tested the *right* way: a spaced path that is **in** the baseline now
matches it, where the old `awk` mangled `src/lib/my dir/Foo.svelte` into `src/lib/my`.

**One finding, and it is the same class of bug this gate has now been rebuilt twice to eliminate:
the gate fails OPEN when the baseline file is missing or empty (I1).** Both reproduced. The
reachable path is not deletion — it is the **documented regeneration command**, which truncates the
baseline in place before running. A regen from the wrong directory, or one where svelte-check
fails, leaves an empty baseline, and from that moment the gate silently passes everything —
including the exact `+page.svelte` regression it exists to catch.

That is worth fixing before this round is called done, because the whole value of the gate is that
it fails closed. It is two lines. Nothing else needs to change.

### Evidence I ran myself

| Check | Result |
|---|---|
| `./dev-test/google-drive/run.sh --medium` at HEAD `b90f435bc` | **199 / 29 / 10**, gate clean, no STALE, **PASS** — matches the report |
| STALE end-to-end (inflated baseline 2→5) | prints per-file `path cur base`, **RESULT: PASS** — warns without failing ✓ |
| H1: spaced path present in the baseline | preserved intact, **matches** → no false REGRESSION ✓ |
| H1: same input through the *old* `awk '{print $2"\t"$1}'` | mangled to `src/lib/my` — the bug was real |
| H2: `WARNING` line whose message contains `" ERROR "` | ignored → **PASS** ✓ |
| Comparison matrix, 8 synthetic cases | 6 correct + **2 fail-open** (I1) |
| `timeout` + `$( )` with a surviving grandchild | returns in **2s**, not 25s — signals the process group, no stall |
| svelte-check wall time on this box | **14 s** (so `timeout 600` is ~43× headroom) |
| `git show b890bcc61 --name-only` | `dev-test/google-drive/run.sh` only — **no shipped code** |

---

## I1 — the gate fails open on a missing or empty baseline

Two distinct mechanisms, both confirmed with an input containing a brand-new error file that
**must** fail:

**Missing baseline.** `awk` aborts with `fatal: cannot open file … for reading`, `SC_CMP` comes back
empty, `SC_REG` is empty, and the gate prints *"no svelte-check regressions vs baseline"* and
passes. The stderr line is the only trace, and it scrolls past inside a suite that ends `RESULT:
PASS`.

```
awk: fatal: cannot open file `dev-test/google-drive/svelte-check-baseline.txt' for reading
GATE: PASS  <-- new error file, baseline missing
```

**Empty baseline.** This one is subtler and does not even print a warning. `NR==FNR` is the
standard "am I still reading the first file?" idiom, and it has a standard trap: **when the first
file is empty, `NR==FNR` stays true while reading the second file**. So every *current* row is
loaded into `base[]`, `cur[]` is never populated, the REGRESSION loop iterates over nothing, and
the gate passes. Reproduced:

```
EMPTY baseline file   -> PASS   (input contained a new error file)
```

**Why this is reachable, and why it matters more than it looks.** The regen command documented in
`run.sh` is

```bash
(cd web && npx svelte-check --output machine 2>&1 | grep ' ERROR ' | … ) > dev-test/google-drive/svelte-check-baseline.txt
```

The shell truncates the target **before** the pipeline runs. If svelte-check fails, is interrupted,
or the command is run from a directory where the relative path resolves elsewhere, you are left
with a zero-byte baseline — and the gate is now permanently green. That is precisely the fail-open
shape round 3 found (G1b) and round 4 fixed for the *run* path; it survives on the *maintenance*
path. And H3 exists to make people regenerate the baseline, so this round actively increases how
often that command is run.

**Fix — guard before comparing, and make the regen atomic:**

```bash
if [[ ! -s "$SC_BASELINE" ]]; then
  echo "svelte-check baseline missing or empty — treating as failure" | tee -a "$OUT"
  FAILED=1
elif ! grep -q 'COMPLETED' <<<"$SC_OUT"; then
  …
```

and change the documented regen so it can never leave a truncated file behind:

```bash
… | sort > /tmp/sc-baseline.$$ && mv /tmp/sc-baseline.$$ dev-test/google-drive/svelte-check-baseline.txt
```

The `-s` test closes both mechanisms at once (an empty file fails the guard before awk ever sees
it), so the `NR==FNR` trap does not need its own fix — but it is worth a comment saying *why* the
guard is load-bearing, otherwise someone will "simplify" it away as a redundant existence check.

---

## Answers to the four things you asked me to attack

### 1. The two-direction awk — no misclassification, and `$1!=""` does its job

The empty-current case is handled exactly as you intended. `<(echo "$SC_CUR")` on an empty
`SC_CUR` yields one empty line; `$1!=""` skips it, so `cur[]` stays empty and no phantom entry is
created. The all-errors-fixed case then falls through to the second loop and reports the three
baseline files as STALE — correct, and no spurious REGRESSION:

| scenario | result |
|---|---|
| baseline exactly | PASS, no stale ✓ |
| new file with an error | **FAIL** ✓ |
| extra error in a baseline file | **FAIL** ✓ |
| all pre-existing fixed | PASS + **STALE** ✓ |
| all fixed **and** a new error | **FAIL** + STALE ✓ (the mixed case classifies both correctly) |
| WARNING containing `" ERROR "` | PASS ✓ |
| empty baseline | **PASS** ✗ — I1 |
| missing baseline | **PASS** ✗ — I1 |

The mixed case is the one I most expected to misclassify and it does not: STALE and REGRESSION are
computed per path and the failure decision keys only off `SC_REG`, so a STALE entry can never mask
a REGRESSION. The `base[f]+0 > 0` guard on the second loop is also right — it stops a hypothetical
zero-count baseline row from producing a permanent STALE notice.

The trap is not in the classification, it is in the `NR==FNR` idiom itself when file one is empty.
See I1.

### 2. H1/H2 substitutions — both correct, and H1 verified the right way

**H1.** The report's own check ("spaced-path preserved") is necessary but not sufficient: a spaced
path with an error is a *new* file, so it fails either way and the test cannot distinguish
"preserved" from "mangled". The discriminating test is a spaced path that is **in the baseline** —
mangled, it would not match and would report as a new-file REGRESSION. I ran that:

```
SC_CUR = src/lib/my dir/Foo.svelte^I1$     ← whole path kept
   vs baseline entry "src/lib/my dir/Foo.svelte\t1"  → no REGRESSION, no STALE ✓

old pipeline on the same input:
src/lib/my^I1$                              ← truncated at the space
```

`sed -E 's/^ *([0-9]+) (.*)/\2\t\1/'` handles every real `uniq -c` line I could construct, including
the adversarial "path begins with digits" case (`  2 2foo.svelte`) — `([0-9]+)` is anchored after
`^ *` and must be followed by a literal space, so it takes the count and nothing else.

**H2.** `awk '$2=="ERROR"'` is a positional field match on the machine format
`<ts> ERROR "path" line:col "message"`, so a message containing `" ERROR "` cannot reach the path
extractor. Verified: a `WARNING` line with `"see ERROR log"` as its message is ignored and the gate
stays PASS.

Does it ever **drop** a genuine error line? No. Machine format emits exactly one line per
diagnostic — multi-line messages are escaped (`\n` appears literally, as I confirmed in the raw
output) — and every error line has `ERROR` in field 2. The one shape where `ERROR` appears
elsewhere is the crash banner (`  ERROR` / `    Unknown option …`), where `$1` is `ERROR` and `$2`
is empty; that is correctly not matched, and that path is caught by the `COMPLETED` check anyway.

Worth recording alongside this: **svelte-check exits 1 whenever any error exists**, so gating on
its exit status would have been wrong from the start (it would fail on the 7 pre-existing errors
forever). Gating on content is the right design and it should stay that way.

### 3. STALE as a warning, not a failure — right call

Agreed, and for the reason you give. Failing on under-count would mean an upstream merge that fixes
an unrelated pre-existing error breaks *this feature's* suite, and the person who has to fix it has
no connection to the change that caused it. That is how a gate gets disabled.

The trade is that a stale baseline still widens what that file tolerates until someone regenerates.
The loud per-file notice is the right mitigation, and I confirmed it is genuinely loud — it prints
`path cur base` per file, above the PASS line, and lands in the archived `results/` file too:

```
svelte-check baseline is stale (fewer errors than recorded) — regenerate it:
  src/lib/components/asset-viewer/AssetViewerNavBar.spec.ts	2	5
  src/lib/components/assets/thumbnail/__test__/Thumbnail.spec.ts	2	5
…
RESULT: PASS
```

One consequence to be aware of rather than fix: this round makes the regen command run more often,
which is exactly what makes I1 worth closing in the same commit.

### 4. `timeout 600` — reasonable, and its exit path lands correctly

Measured svelte-check at **14 s** on this box, so 600 s is roughly 43× headroom — ample for a cold
cache or a loaded 8 GB machine, and short enough that a genuine wedge does not eat an afternoon.

The exit path is right: `timeout` kills the command, `SC_OUT` holds whatever was printed before the
kill, and that cannot contain `COMPLETED` (if it did, svelte-check had finished and was not hung),
so it lands on the FAIL branch. Exit code 124 is never consulted, which is correct — the gate must
not read exit status here for the reason above.

I checked the failure mode I expected to find and it is **not** present: with `$( )`, a killed
parent whose child still holds the write end of the pipe can block the substitution indefinitely,
which would have defeated the whole point of adding `timeout`. GNU `timeout` runs the command in
its own process group and signals the group, so the grandchild dies too. Verified rather than
assumed:

```
timeout 2 bash -c 'bash -c "sleep 25" & echo parent-output; wait'
elapsed=2s   output=[parent-output]
```

2 s, not 25 s. No stall.

---

## Affirmations

- **The comment block carries the whole history** — why `grep ' ERROR '` and the old `awk` were
  replaced, what each substitution protects against, and why STALE warns instead of failing. That is
  what stops the next person reverting it to something shorter, and it is the CLAUDE.md §6 standard.
- **The report's caveats are honest and match what I found**: H1/H2 are verified-unreachable rather
  than verified-as-live-failures, and a genuinely hung svelte-check is untested. Both stated
  plainly, neither overclaimed.
- **"No shipped-code change ⇒ no SQL/SDK regen, no drift check"** — confirmed; the commit touches
  one file.
- **The report's evidence reproduces**: clean tree at HEAD gives 199 / 29 / 10, gate clean, no
  STALE, PASS.

## What I did not verify

- **The browser pass on the four visual states** (colour transitions, disabled "sync now",
  unconnected-member row, connect row). Unchanged, and still the last untested class of Wave 5
  claim — per CLAUDE.md §1 it is its own review round, not a sign-off.
- **The gate end-to-end through a live BullMQ queue** — unchanged standing.
- **A genuinely hung svelte-check.** I verified the process-group semantics that make `timeout`
  work here, but did not wedge svelte-check itself.
- **I1's fix** — I sketched it and verified the two failure mechanisms it closes, but did not write
  or run the patched gate.

## Feeding back into the plan

`album-menu-ux-plan.md` §10 should record:

1. **H1/H2/H3 and the timeout are closed**, with the discriminating H1 test written down: a spaced
   path *in the baseline* must match. The obvious test (spaced path with an error) fails either way
   and proves nothing — that distinction is the reusable lesson.
2. **I1 is open and is a fail-open**, the third time this gate has had one (G1b on the run path,
   now the baseline path). Record the pattern: *every input this gate depends on must be validated,
   not assumed present* — the `COMPLETED` line was one, the baseline file is the other.
3. **Make the regen atomic** (`> tmp && mv`). H3 increases how often that command runs, so the
   window for leaving a truncated baseline behind is now wider than when it was written.
4. **Wave 5's shipped code has been unchanged for two rounds.** Rounds 4 and 5 are both
   test-infrastructure. Once I1 lands, the only thing between this branch and a deploy is the
   browser pass.
