# Code Review — Wave 5 fixes round 7 (J1: safe baseline regen subcommand)

Review of `d4d5d493c`, the fix for the single finding in
`google-drive-wave5-fixes6-20260827-0730-review.md`. Test-infrastructure only — I confirmed the
commit touches `dev-test/google-drive/run.sh` and nothing else, and independently confirmed the
"not in the deploy image" claim (`server/Dockerfile` has no `COPY` of `dev-test`; it takes
`./server`, `./web`, `./i18n`, `./packages`, `./mise.toml`).

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit reviewed | `d4d5d493c` |
| HEAD at review | `0eb16b776` |
| Report | `../report/google-drive-wave5-fixes7-20260827-1000-report.md` |
| Prior review | `google-drive-wave5-fixes6-20260827-0730-review.md` |
| Reviewed | 2026-08-27 |

## Verdict

**J1 is fixed and the subcommand is the right design.** Collapsing the two copies of the parser
into `sc_extract` addresses the drift I flagged directly rather than patching around it, the
restructured control flow is correct on every path I could drive, and `--regen-baseline` reproduces
the checked-in baseline byte-for-byte.

**Two findings, both inside the new `--regen-baseline` path** — and both are the *same theme this
gate has now hit three rounds running*: the code that installs the baseline can end up not
installing it, without saying so.

- **K1** — the install failure is not propagated. `printf > tmp && mv tmp baseline` has its exit
  status discarded, so a failed `mv` still prints *"baseline regenerated (N files)"*, `cat`s the
  **old** file, and exits 0. Reproduced.
- **K2** — "zero pre-existing errors" is an **unrepresentable state**. If all 7 pre-existing errors
  were fixed — which is exactly what H3's STALE notice nags you toward — regen refuses to write the
  baseline, the gate's `-s` guard fails on an empty one, and STALE then nags every run with advice
  ("regenerate") that refuses. A dead end with no way out inside the tool. Reproduced.

Neither is a fail-open and neither touches shipped code, so this does not hold the branch. Both are
small; K2 needs one line in regen and no change to the comparison at all — I verified the awk
already treats a `#` sentinel as inert.

### Evidence I ran myself

| Check | Result |
|---|---|
| Real `run.sh`, **empty** baseline | FAIL + `regenerate with: … --regen-baseline` ✓ |
| Real `run.sh`, **missing** baseline | FAIL ✓ |
| Real `run.sh`, injected error in the album `+page.svelte` | **FAIL** at the gate, detail line `…/+page.svelte 4 0` ✓ |
| Real `run.sh --medium`, clean tree | 199 / 29 / 10, gate clean, **PASS** ✓ |
| `--regen-baseline` vs the checked-in baseline | **byte-identical**, exit 0 ✓ |
| `-s` hoist actually skips svelte-check | full run with an empty baseline **17.5 s** vs svelte-check alone ~14 s ✓ |
| `sc_extract` vs the previous inline pipeline | **identical** expression, no behavioural change ✓ |
| `printf > tmp && mv tmp <unwritable>` | chain exits 1, script still prints "baseline regenerated", old content intact, temp leaked — **K1** |
| Zero-error regen / empty baseline / STALE loop | all three confirmed — **K2** |
| `grep -c dev-test server/Dockerfile` | **0** — not in the deploy image, as claimed |

---

## Answers to the four things you asked me to attack

### 1. The restructured control flow — balanced, and every failure still reaches `RESULT: FAIL`

`bash -n` proves syntax; I drove all four paths through the real script instead:

```
empty baseline    -> "svelte-check baseline missing or empty …" + regen hint   -> RESULT: FAIL
missing baseline  -> same                                                       -> RESULT: FAIL
real regression   -> "svelte-check regressions vs baseline:"
                     src/routes/(user)/albums/…/+page.svelte   4   0            -> RESULT: FAIL
clean tree        -> "no svelte-check regressions vs baseline (3 …)"            -> RESULT: PASS
```

The regression case is the one worth checking rather than assuming, because a `RESULT: FAIL` could
have come from somewhere else in the suite — it didn't; the gate produced it, with the right count
and the right baseline.

`FAILED=1` is set in all three failing branches (lines 153, 163, 190), all after `FAILED=0` at line
91, so nothing is set before initialisation. The `--regen-baseline` branch sits above that and
`exit`s, so it never interacts.

**The hoist works as advertised**: a full run with an empty baseline completes in **17.5 s** — the
two vitest suites — where a run that reaches svelte-check pays ~14 s more. So the guard really does
decide before the slowest step.

One cosmetic note, offered because it is a legibility hazard rather than a bug: the inner
comparison block was not re-indented for the level the hoist added — `SC_CUR=`, `SC_CMP=`, and the
STALE/REGRESSION `if`s all sit at two spaces while nested two deep, and the two closing `fi`s carry
trailing comments (`# close: svelte-check COMPLETED?`) to make up for it. Those comments are a
symptom: the block is hard enough to read that it needed labels. Re-indenting would let them go.

### 2. `--regen-baseline`'s refusals — right on one, wrong on the other (**K2**)

**No `COMPLETED` → exit 1 without writing: correct.** That is the same fail-closed rule as the gate,
applied at the point where a bad baseline would be created rather than after.

**Zero errors → exit 1: this one is wrong, and it creates a state with no way out.** Suppose the
three pre-existing errors get fixed — by an upstream merge, or by someone acting on the STALE
notice, which exists precisely to prompt this. Then:

```
--regen-baseline   -> "svelte-check reports zero errors — refusing to write an empty baseline"  (exit 1)
gate, empty file   -> "svelte-check baseline missing or empty — treating as failure"            (RESULT: FAIL)
gate, old file     -> STALE  AssetViewerNavBar.spec.ts      (0 vs 2)
                      STALE  NumberRangeInput.spec.ts       (0 vs 3)
                      STALE  Thumbnail.spec.ts              (0 vs 2)      ... on every run, forever
```

The STALE advice is "regenerate it", and regen refuses. The comment's suggested escape — *"a
deliberate situation to handle by hand (delete the gate, or record a sentinel)"* — is not
actionable, because the format has no sentinel: any file that expresses "no tolerated errors" is
empty, and empty is what `-s` rejects.

**Fix, and it needs no change to the comparison.** Have regen always emit a comment header, so the
file is never empty:

```bash
{ echo "# svelte-check baseline — regenerate with: run.sh --regen-baseline"; printf '%s\n' "$NEW"; } > "$SC_TMP"
```

I verified the comparison awk already treats such a line as inert — `base["# …"]=""`, and `""+0`
is 0, so it produces neither a REGRESSION nor a STALE:

```
sentinel-only baseline + a new error  -> REGRESSION src/NEW.svelte   (fails closed ✓)
sentinel-only baseline + clean tree   -> (nothing)                   (no STALE nag ✓)
-s passes on it                       -> yes
```

So zero-errors becomes representable, the gate becomes *stricter* in that state (any error
anywhere fails), and the dead end disappears. Drop the zero-error refusal at the same time.

### 3. `sc_extract` as shared code — no behavioural change

Byte-identical: the function body is the same expression the gate ran inline, moved to read stdin,
and the gate now calls it as `sc_extract <<<"$SC_OUT"`. I diffed the two forms against the same
real svelte-check output — identical. Exit status is unchanged too (the last stage, `sort`, either
way), so `pipefail` behaves the same.

This is the part of the round I'd most want kept. The duplication was not hypothetical — the gate
and the regen comment had already drifted, with the comment still carrying `grep ' ERROR '` and
`awk '{print $2"\t"$1}'` a full round after the gate moved to the field-match and space-safe forms.
One definition removes the whole class.

### 4. `mktemp` + `mv` — atomic, but the failure is swallowed (**K1**)

`mktemp` is the right call (it fixes the predictable-`/tmp`-name nit from last round), and `mv`
within the same filesystem is atomic. The problem is what happens when it isn't fine:

```bash
printf '%s\n' "$NEW" > "$SC_TMP" && mv "$SC_TMP" "$SC_BASELINE"
echo "baseline regenerated ($(wc -l < "$SC_BASELINE") files):"
cat "$SC_BASELINE"
exit 0
```

Nothing reads the chain's status. Reproduced with an unwritable destination:

```
mv: cannot move '/tmp/tmp.7xTlxYHg0k' to '…/baseline.txt': Permission denied
  after the chain: exit=1
  script would now print: baseline regenerated (1 files)
  actual contents: OLD	CONTENT
  temp file leaked? yes
```

So the command reports success, prints the **old** baseline as though it were the new one, exits 0,
and leaves the temp file behind. Answering your question directly: **a failed `printf` does
correctly skip the `mv`** (that half of the `&&` works) — but the skip is silent, which is the same
outcome.

On this box `/tmp` and the repo are on different filesystems, so `mv` degrades to copy-then-unlink;
that is still correct, just not atomic in the rename sense. Reachable failures are a read-only
checkout, a full disk, or a permissions change. Rare — but "reports success while doing nothing" is
precisely the wrong failure mode for the tool whose entire job is installing this file safely, and
it is the third variation on that theme (I1: a bad baseline installed silently; J1: `&& mv` could
not abort; K1: the install fails and says it worked).

```bash
if ! { printf '%s\n' "$NEW" > "$SC_TMP" && mv "$SC_TMP" "$SC_BASELINE"; }; then
  rm -f "$SC_TMP"
  echo "failed to install the baseline (see above) — nothing was changed"
  exit 1
fi
```

An explicit `if` rather than `… || { …; }` appended to the `&&` chain, so the precedence is
unambiguous.

---

## Affirmations

- **`--regen-baseline` reproduces the checked-in baseline byte-for-byte**, verified, so the
  migration from the pasted pipeline lost nothing.
- **The `-s` guard's comment now says it is "the last line of defence"** and explains the
  `NR==FNR` mechanism. Keeping that after the regen path was hardened is right: it is exactly the
  belt-and-braces pairing that contained J1, and K1 shows the braces are still earning their keep.
- **The report's scope claims check out** — one file, no shipped code, and the Dockerfile genuinely
  does not copy `dev-test`, so this cannot affect the deploy image.
- **The report names what it did not verify** (a real failed/hung svelte-check inside the regen)
  rather than glossing it, which is what let me aim at the install path instead.

## What I did not verify

- **The browser pass on the four visual states** — colour transitions, disabled "sync now",
  unconnected-member row, connect row. Unchanged, and still the only untested class of Wave 5
  claim; per CLAUDE.md §1 it needs its own report and review.
- **The gate end-to-end through a live BullMQ queue** — unchanged standing.
- **A genuinely hung svelte-check inside `--regen-baseline`** — I verified the `COMPLETED` guard
  that catches it and the `timeout` process-group semantics from round 5, but did not wedge it.
- **K1/K2's fixes** — I reproduced both failures and verified the sentinel is inert in the
  comparison, but did not write or run a patched regen.

## Feeding back into the plan

`album-menu-ux-plan.md` §12 should record:

1. **J1 closed**, with the part worth keeping: `sc_extract` is one definition, and the duplication
   it replaced *had already drifted a full round*. That is the argument against ever documenting a
   pipeline in a comment again.
2. **K1 and K2 are open**, both in `--regen-baseline`. Note the pattern rather than the two bugs:
   every round, the thing that installs or validates the baseline has had a path where it does
   nothing and reports fine. Each fix has been correct; the next one should ask "what does this do
   when it fails?" before "does it work?".
3. **Zero-pre-existing-errors is currently unrepresentable** (K2). Record the sentinel fix and the
   evidence that the comparison already tolerates a `#` line, so it is not re-litigated.
4. **Four consecutive rounds have been test-infrastructure only.** Wave 5's shipped code is
   unchanged since round 3 (`861869fe7`). Once K1/K2 land, the branch's remaining work is the
   browser pass.
