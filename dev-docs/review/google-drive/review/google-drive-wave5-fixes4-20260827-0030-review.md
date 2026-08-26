# Code Review — Wave 5 fixes round 4 (G1/G2/G3)

Review of `a87422a7c`, the fixes for `google-drive-wave5-fixes3-20260823-1300-review.md`.
Test-infrastructure only — I confirmed the diff touches no shipped code. Per CLAUDE.md §2.4 it is
still a review target, so this attacks the new gate rather than reading it.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit reviewed | `a87422a7c` |
| HEAD at review | `c3a410df2` |
| Report | `../report/google-drive-wave5-fixes4-20260827-0030-report.md` |
| Prior review | `google-drive-wave5-fixes3-20260823-1300-review.md` |
| Reviewed | 2026-08-27 |

## Verdict

**G1, G2 and G3 are all correctly fixed, and I found nothing blocking.** This is the first round of
Wave 5 with no finding that needs to be fixed before deploy.

Both G1 holes are genuinely closed, verified against the real `run.sh` and not just by reading it:
the exact injection that made the old gate print *"no svelte-check errors in feature files"* and
**PASS** now prints *"svelte-check regressions vs baseline"* and **FAIL**; and a svelte-check that
cannot start now fails closed on the missing `COMPLETED` line. The comparison logic is correct on
all six cases I could construct.

Three latent issues, none reachable in this repo today, all one-line fixes:

- **H1 / H2** — two parsing fragilities in the extraction pipeline that would produce a *false
  FAIL*. Both are currently unreachable (zero source paths contain a space; zero warning messages
  contain `" ERROR "`) — I checked rather than assumed.
- **H3** — the baseline drifts **permissively**. This is the more reachable cousin of the masking
  hole you already identified, and the one I'd actually fix: upstream merges fix pre-existing
  errors more often than anyone breaks-and-repairs the same file.

Worth doing in a cleanup commit; none of them justifies holding the branch.

### Evidence I ran myself

| Check | Result |
|---|---|
| `./dev-test/google-drive/run.sh --medium` at HEAD `c3a410df2` | **199 / 29 / 10**, baseline gate clean, **PASS** — matches the report |
| Real `run.sh` with a type error injected into the album `+page.svelte` | **`svelte-check regressions vs baseline` → RESULT: FAIL** (the old gate PASSed this) |
| `svelte-check --output machine` path format | **relative** — matches the baseline's format |
| Documented regen command vs the checked-in baseline | **byte-for-byte identical** |
| `COMPLETED` line present, once, with counts | `… COMPLETED 2692 FILES 7 ERRORS 56 WARNINGS 41 FILES_WITH_PROBLEMS` |
| Gate comparison logic, 6 synthetic cases | 6/6 correct (table below) |
| `find web/src -name '* *'` | **0** paths with spaces (H1 unreachable today) |
| WARNING lines whose message contains `" ERROR "` | **0** (H2 unreachable today) |
| `git show a87422a7c --name-only` | 3 files: `run.sh`, the baseline, one spec — **no shipped code** |

---

## Answers to the four things you asked me to attack

### 1. Can it fail closed *wrongly*? — Not today; two latent fragilities

I checked the assumption most likely to break the whole gate first, because if it were wrong the
gate would fail **every** clean tree: **does `--output machine` emit paths in the same form as the
baseline?** It does — machine format is relative (`src/lib/components/...`). Worth stating
explicitly because `--output human`, which is what you get by default, prints **absolute** paths;
if the regen command and the gate had disagreed on that, all three baseline files would have read
as regressions forever. They agree, and I confirmed the regen command reproduces the checked-in
baseline byte-for-byte.

The `COMPLETED` assumption is sound: exactly one such line, and it carries the totals.

The `awk -F'\t'` comparison is correct — both sides are tab-delimited, `base[$1]` is the count, and
absent ⇒ `0` via `+0`. Two fragilities upstream of it, both in the *extraction*:

**H1 — a path containing a space would be truncated.** `uniq -c | awk '{print $2"\t"$1}'` splits on
whitespace, so `$2` is the first token of the path. A path with a space becomes a different string,
never matches the baseline, and reads as a new file → false FAIL. `find web/src -name '* *'`
returns **0** today, so this is unreachable; it is one line to make it not matter:

```bash
| sed -E 's/^ *([0-9]+) (.*)$/\2\t\1/'      # instead of awk '{print $2"\t"$1}'
```

**H2 — `grep ' ERROR '` matches on substring, not field.** A `WARNING` line whose *message* text
contains `" ERROR "` passes the grep; the following `sed` only strips at line start, so it does not
match, and `cut -d'"' -f1` yields `<ts> WARNING ` as the "path" → a phantom file → false FAIL. Zero
such lines today. Fix:

```bash
| awk '$2=="ERROR"'                          # instead of grep ' ERROR '
```

One more, smaller: the `npx svelte-check` call has no timeout. If it hangs (rather than crashing),
`run.sh` hangs with it instead of failing — the one failure mode the `COMPLETED` check does not
convert into a FAIL. `timeout 600 npx svelte-check …` would close it.

### 2. Can it still be fooled into passing? — Only the case you named, plus its likelier cousin

I exercised the comparison against synthetic svelte-check output covering every shape I could think
of:

| scenario | gate |
|---|---|
| baseline exactly | **PASS** ✓ |
| new error in `+page.svelte` (the old gate's blind spot) | **FAIL** ✓ |
| extra error in a baseline file (2 → 3) | **FAIL** ✓ |
| all pre-existing errors fixed (0 total) | **PASS** ✓ (fewer is fine) |
| svelte-check crashed, no `COMPLETED` | **FAIL** ✓ |
| baseline file: one fixed + one new, count unchanged | **PASS** ← the hole you named |

Then confirmed the important one end-to-end against the real script, since a synthetic harness
proves the awk and not the plumbing:

```
── web (svelte-check, baseline-gated) ──
svelte-check regressions vs baseline:
RESULT: FAIL
```

That is the same one-line change to `+page.svelte` that the round-3 gate answered with *"no
svelte-check errors in feature files … RESULT: PASS"*. G1a is closed.

**H3 — the reachable version of the masking hole.** You framed it as "a new error masked by a fix
elsewhere in the same file", which needs someone to break and repair one file in one commit — rare.
The likelier path is drift in the permissive direction: an **upstream merge fixes** one of the three
pre-existing errors, the baseline still says `Thumbnail.spec.ts 2`, and from then on that file
silently tolerates up to two brand-new errors. Merges fix things routinely; nothing in the gate
notices, because under-count is (correctly) a PASS.

Cheap fix that converts silent over-permission into a visible chore — report the *other* direction
too, without failing on it:

```awk
{ if (($2)+0 > (base[$1])+0) print "REGRESSION " $1 " (" $2 ", baseline " base[$1]+0 ")";
  else if (($2)+0 < (base[$1])+0) print "STALE " $1 " (" $2 ", baseline " base[$1]+0 ") — regenerate" }
```
…plus the same for baseline entries with no current errors at all. Fail on `REGRESSION`, print
`STALE` loudly. That also makes the baseline self-maintaining in practice, which is attack #3.

Closing the true masking case would need the baseline to carry `line:col` or a hash of each error
rather than a count. I would **not** do that: `line:col` churns on every unrelated edit to those
files and would turn the baseline into a per-merge chore. The three baseline files
(`AssetViewerNavBar.spec.ts`, `Thumbnail.spec.ts`, `NumberRangeInput.spec.ts`) are unrelated test
files this feature never touches, so the residual risk is small and the maintenance cost is not.

### 3. Baseline staleness — checking it in is the right call

Computing it instead would mean running svelte-check a second time against a different tree
(`main`, or a stash), which roughly doubles the slowest step in the suite and introduces a "which
base?" question that has no stable answer on a long-lived feature branch. A checked-in baseline is
three lines, reviewable in a diff, and it is *why* the gate can be name-agnostic. Right call.

The regen command in the comment is correct — I ran it and diffed: **identical**. That is the part
that most often rots in a comment, so it being exact matters.

The trap is not the file, it is that drift is only detected in one direction (H3). Fix that and
this stops being a maintenance question.

### 4. G2 — the right positive, and `trigger` is the right element

Yes on both. `focusButton()` resolves `buttonContainer?.querySelector('#' + buttonId)`, i.e. the
`IconButton`'s `<button id={buttonId} aria-label={title}>`; `getByLabelText('menu')` finds that same
element by its `aria-label`. I measured this in the previous round rather than inferring it — after
open→close the R1 scenario ends with `document.activeElement === getByLabelText('menu')`, tag
`BUTTON`. So the new assertion pins exactly the state `focusButton()` is responsible for, and a
broken `focusButton()` dropping focus to `<body>` now fails instead of passing.

The added comment about the closed state being self-correcting is accurate: if a regression left the
menu open, the deferred focus would fire and `expect(menu).not.toHaveFocus()` would fail first. Good
that this is written down — it reads like an omission otherwise, which is how it got raised.

---

## Affirmations

- **G3 is fixed as a side effect of the redesign**, which is the better outcome: matching the
  extracted path instead of the whole machine line removes the "an error *message* containing a
  feature name trips the gate" nuisance entirely, rather than patching it.
- **The `run.sh` comment carries the history** — why the grep gate existed, the two holes it had,
  and what this version does instead. That is the comment style CLAUDE.md §6 asks for, and it is
  the thing that stops someone "simplifying" it back into a grep.
- **The report's own evidence file reproduces.** `results/20260827-0026.txt` (`fd8e6ce0d`) matches
  what I got at `c3a410df2`: 199 / 29 / 10, baseline gate clean, PASS.
- **"No shipped-code change ⇒ no SQL/SDK regen, no drift check"** is correct — verified the commit
  touches only `run.sh`, the baseline, and `ButtonContextMenu.spec.ts`.

## What I did not verify

- **The browser pass on the four visual states** — colour *transitions*, the disabled "sync now"
  appearance, the unconnected-member row, and the connect row. Unchanged and still the last
  untested class of Wave 5 claim. Per CLAUDE.md §1 that pass is not a review substitute; it needs
  its own round.
- **The gate end-to-end through a live BullMQ queue** — unchanged standing.
- **A hanging (as opposed to crashing) svelte-check.** I reproduced the crash path; a hang would
  stall `run.sh` rather than failing it, and I did not simulate that.
- **H1/H2 as live failures** — I verified they are unreachable in this repo today (0 spaced paths,
  0 warning messages containing `" ERROR "`) rather than constructing them.

## Feeding back into the plan

`album-menu-ux-plan.md` §9 should record:

1. **G1/G2/G3 closed**, with the end-to-end proof: the same `+page.svelte` injection that the
   round-3 gate passed now fails the suite. Record *that* rather than "gate improved" — it is the
   before/after a future reader can re-run.
2. **The gate is name-agnostic on purpose.** The lesson from round 3 was that a filename allowlist
   drifts behind the feature; the baseline approach is what removes the need to maintain one. Do
   not reintroduce scoping.
3. **H3 is open**: the baseline is only checked in the failing direction, so a fix upstream
   silently widens what that file tolerates. One awk clause turns it into a visible "regenerate"
   notice. H1/H2 are latent parsing fragilities worth the same cleanup commit.
4. **Wave 5's code is done.** After four rounds the only thing left between this branch and a
   deploy is the browser pass on the four visual states — and per CLAUDE.md §1 that is its own
   review round, not a sign-off.
