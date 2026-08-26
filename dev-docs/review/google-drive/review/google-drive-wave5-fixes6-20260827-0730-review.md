# Code Review — Wave 5 fixes round 6 (I1: baseline fail-open)

Review of `ea2eec5a2`, the fix for the single finding in
`google-drive-wave5-fixes5-20260827-0050-review.md`. Test-infrastructure only — I confirmed the
commit touches `dev-test/google-drive/run.sh` and nothing else. Per CLAUDE.md §2.4 the fix is a
review target.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit reviewed | `ea2eec5a2` |
| HEAD at review | `383efb00f` |
| Report | `../report/google-drive-wave5-fixes6-20260827-0730-report.md` |
| Prior review | `google-drive-wave5-fixes5-20260827-0050-review.md` |
| Reviewed | 2026-08-27 |

## Verdict

**I1 is fully closed.** Both mechanisms fail closed end-to-end against the real `run.sh`, and I
probed every malformed-baseline shape I could construct: all of the *accidental* ones fail closed
too. The guard is in the right place and the comment explains why it is load-bearing rather than a
redundant existence check — which is what stops the next person deleting it.

**One finding, J1, and it is the same class of bug on the same path I flagged last round —** the
*maintenance* path, not the run path. The documented regen command's `&& mv` does **not** abort
when svelte-check fails, because that command lives in a comment and runs in the user's shell,
where `pipefail` is not set. `sort` exits 0 on empty input, so `&&` proceeds and truncates the
baseline to zero bytes.

**Its impact is contained precisely by this round's fix**, which is defense-in-depth working as
designed: a truncated baseline now produces a loud `RESULT: FAIL` instead of a silently green gate.
So J1 costs a wasted run and a confusing moment, not a hole. Worth fixing in a cleanup commit;
**not** a reason to hold the branch.

With that, Wave 5's shipped code has been unchanged for three rounds and the only thing left before
deploy is the browser pass on the four visual states.

### Evidence I ran myself

| Check | Result |
|---|---|
| Real `run.sh`, **empty** baseline | `svelte-check baseline missing or empty … — treating as failure` → **RESULT: FAIL** ✓ |
| Real `run.sh`, **missing** baseline | same message → **RESULT: FAIL** ✓ |
| Real `run.sh --medium`, clean tree at HEAD `383efb00f` | **199 / 29 / 10**, gate clean, no STALE, **PASS** — matches the report |
| Malformed-baseline matrix, 5 shapes | 3 fail closed, 1 inert, 1 fail-open **only** via a deliberate upward hand-edit (announced by STALE) |
| Branch ordering, both crash combinations | both **FAIL** ✓ |
| `( false \| sort ) > f && mv` **without** `pipefail` | exit 0, destination truncated to **0 bytes** — J1 |
| same **with** `pipefail` | exit 1, destination **intact** (14 bytes) |
| `grep -n sc-baseline run.sh` | lines 102–103, **inside a comment** — never executed by the script |
| `git show ea2eec5a2 --name-only` | `dev-test/google-drive/run.sh` only — no shipped code |

---

## Answers to the three things you asked me to attack

### 1. Does `-s` fully close I1? — Yes for every accidental shape

I built the malformed baselines you did not test, and fed each an input containing a brand-new
error file that **must** be caught:

| baseline shape | gate | direction |
|---|---|---|
| line with no tab (`garbage-no-tab`) | **FAIL** | closed ✓ |
| non-numeric count (`path⇥abc`) | **FAIL** | closed ✓ — `"abc"+0` is 0, so tolerance drops to zero |
| whitespace-only (a single `\n`) | **FAIL** | closed ✓ — passes `-s` at 1 byte, but seeds no real entry, so every current error is a regression |
| CRLF line endings (`path⇥2\r`) | parsed correctly | inert — `\r` lands at the end of the last field, the path key is clean |
| inflated count (`path⇥999`) | **PASS** + STALE | **open**, but see below |

So the only surviving fail-open needs someone to hand-edit a number *upward* — not something a
truncation, an interrupted write, or a wrong-directory run can produce. And it announces itself:
the current count is below the recorded one, so H3's STALE notice fires on every run telling you to
regenerate.

**I agree with not adding format validation.** Every accidental malformation already fails closed,
so a validator would only guard against deliberate mis-editing, at the cost of another thing to
keep in sync with the file format. If you want one cheap line anyway, warn (don't fail) when a
baseline line contains no tab — that is the one shape that is silently *inert* rather than
protective, and it would surface a botched hand-edit.

### 2. Branch ordering — correct; two diagnostic nits

`-s` → `COMPLETED` → compare is the right order, and I confirmed both crash combinations land on a
FAIL:

```
baseline OK + crashed svelte-check   -> FAIL (no COMPLETED)
baseline missing + crashed           -> FAIL (baseline missing/empty)
```

There is no case where a present-but-stale baseline plus a crashed svelte-check should fail and
doesn't — a stale baseline never suppresses the `COMPLETED` branch, because that branch runs before
any comparison.

Two things worth a line each, neither a correctness problem:

- **When both are broken you only hear about the baseline.** The `-s` branch fires first and
  `SC_OUT` — which holds svelte-check's actual error output — is discarded. You fix the baseline,
  re-run, and only then discover svelte-check was also broken. Echoing `tail -5` of `SC_OUT` in the
  `-s` branch too would cost nothing.
- **`SC_OUT` is computed before the `-s` check**, so a missing baseline still pays a full
  svelte-check run for a result that is already decided — 14 s on this box warm, longer cold, and
  it is the slowest step in the suite. Hoisting the `-s` test above the `SC_OUT=` assignment makes
  the failure instant and costs nothing.

### 3. The atomic regen — `/tmp` is fine here, but the `&&` does not do what it claims (**J1**)

**`/tmp/sc-baseline.$$` is acceptable** on a single-user dev box. `mktemp` would be strictly more
correct (predictable names in a world-writable directory are a symlink-attack vector on a shared
host), but that is not this machine's threat model. One line if you want it; not a finding.

**The `&& mv` guard is the problem.** Your note says *"pipefail is set at the top of run.sh"* — and
it is, but that is irrelevant here. The regen command is at `run.sh:102–103` **inside a comment**;
`grep` confirms it is never executed by the script. It is documentation for a human to paste into
their own interactive shell, and that shell does not have `pipefail`. Without it, a pipeline's exit
status is its **last** stage — `sort` — which exits 0 on empty input. So:

```
( false | sort ) > /tmp/sc-t.$$ && mv /tmp/sc-t.$$ /tmp/dest.txt
  no pipefail   -> exit=0   dest is now 0 bytes      ← bad baseline installed
  with pipefail -> exit=1   dest is still 14 bytes   ← aborted correctly
```

That is exactly the scenario the temp-file-and-`mv` was added to prevent: svelte-check fails or is
interrupted, and the baseline ends up zero bytes anyway. The `mv` is atomic, but it atomically
installs the wrong thing.

**Why this is contained, and why that is the interesting part.** Before this round, a zero-byte
baseline made the gate pass everything silently — that was I1. After this round it produces:

```
svelte-check baseline missing or empty (…) — treating as failure
RESULT: FAIL
```

So the `-s` guard catches the very failure the regen command can still cause. Two independent
mistakes now have to line up before anything is silently wrong, which is the point of a fail-closed
guard. J1 is a robustness and usability defect, **not** a fail-open.

**Fix — either of:**

```bash
#   … | sort) > /tmp/sc-baseline.$$ && [ -s /tmp/sc-baseline.$$ ] \
#     && mv /tmp/sc-baseline.$$ dev-test/google-drive/svelte-check-baseline.txt
```

or, better and durable: make it `./dev-test/google-drive/run.sh --regen-baseline`. That runs under
the script's own `set -o pipefail`, can validate the result before installing it, keeps the
extraction pipeline in exactly one place instead of two (the gate and the comment currently
duplicate it, and they have already drifted once — the comment kept `grep ' ERROR '` and
`awk '{print $2"\t"$1}'` for a round after the gate moved on), and removes the
copy-a-multi-line-command-out-of-a-comment failure mode entirely.

That duplication is the deeper reason to prefer the subcommand: the comment is a second
implementation of the parser, and nothing keeps the two in step.

---

## Affirmations

- **The guard's comment is exactly right.** It states *why* `-s` is load-bearing — that an empty
  first file keeps `NR==FNR` true through the second file, so every current row is misfiled into
  `base[]` — rather than just what it does. That is the sentence that stops someone deleting it as
  a redundant `[ -f ]`, and it is the CLAUDE.md §6 standard.
- **Placing it before `COMPLETED`** is the right order: the baseline is an input to the comparison,
  so validating it first keeps the failure messages unambiguous about which input was bad.
- **The report's caveats are honest** — the malformed-baseline case is named as unverified rather
  than glossed, which is what let me go straight at it.
- **"No shipped-code change ⇒ no SQL/SDK regen, no drift check"** — confirmed; one file.
- **The report's evidence reproduces**: clean tree at HEAD gives 199 / 29 / 10, gate clean, no
  STALE, PASS.

## What I did not verify

- **The browser pass on the four visual states** (colour transitions, disabled "sync now",
  unconnected-member row, connect row). Unchanged, and now the *only* untested class of Wave 5
  claim. Per CLAUDE.md §1 it is its own review round, not a sign-off.
- **The gate end-to-end through a live BullMQ queue** — unchanged standing.
- **A genuinely hung svelte-check** — unchanged from last round; I verified the process-group
  semantics that make `timeout` work, not a real wedge.
- **J1's fix** — I reproduced both directions of the `pipefail` behaviour and confirmed the command
  is comment-only, but did not write or run a patched regen.

## Feeding back into the plan

`album-menu-ux-plan.md` §11 should record:

1. **I1 is closed, verified end-to-end** — empty and missing baselines both FAIL against the real
   `run.sh`. Record the malformed-baseline matrix too: it is the evidence for *not* adding format
   validation, so the question does not get reopened.
2. **J1 is open** — the regen command's `&& mv` cannot abort on a failed pipeline in an interactive
   shell. Note that this round's `-s` guard is what contains it; that pairing is the lesson, not
   the individual bug.
3. **The extraction pipeline exists twice** (the gate, and the regen comment) and has already
   drifted once. A `--regen-baseline` subcommand collapses them and fixes J1 in the same move.
4. **Three consecutive rounds have been test-infrastructure only**; Wave 5's shipped code is
   unchanged since round 3. Once J1 lands, the branch's remaining work is the browser pass — which
   per CLAUDE.md §1 needs its own report and review, not a sign-off on this one.
