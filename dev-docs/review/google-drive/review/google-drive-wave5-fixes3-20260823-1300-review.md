# Code Review — Wave 5 fixes round 3 (R1–R5)

Review of `861869fe7`, the fixes for `google-drive-wave5-fixes2-20260823-1210-review.md`. Per
CLAUDE.md §2.4 the fixes are the target, so this attacks the R1 guard, the modelling of its
regression test, the composition test's wiring, and the new `run.sh` gate.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit reviewed | `861869fe7` |
| HEAD at review | `fd8e6ce0d` |
| Report | `../report/google-drive-wave5-fixes3-20260823-1300-report.md` |
| Prior review | `google-drive-wave5-fixes2-20260823-1210-review.md` |
| Reviewed | 2026-08-27 |

## Verdict

**R1, R3, R4 and R5 are correctly and completely fixed. R2 is fixed in the code but the gate that
was supposed to keep it fixed does not work.**

The R1 guard is right, and I could not make it misfire: it never suppresses a focus that should
happen, and keeping it outside the `!wasOpen` guard is the correct call for the reason given.
svelte-check is back to exactly **7** errors, all in the three pre-existing unrelated files. The
composition test is genuinely end-to-end — I proved it by breaking the real callback wiring and
watching it fail.

**One finding, in the new `run.sh` svelte-check gate (G1).** It has two independent holes, both
reproduced:

- it **misses errors in the album page** (`+page.svelte`) — the file this feature has edited in
  every single round, and the one that mounts the Drive menu. I injected a type error there and
  `run.sh` printed *"no svelte-check errors in feature files"* and reported **PASS**;
- it **fails open**: if `svelte-check` cannot run at all, the gate reports clean and passes.

That is worse than the problem it was added for — R2 existed *because* svelte-check wasn't run, and
a gate that says "clean" when it didn't check is how that recurs with a green light on top of it.
The code fix for R2 is fine; the gate needs replacing.

Plus two small test-honesty notes (G2, G3). **Fix G1 before deploy; G2/G3 in the same commit.**
Nothing here touches the server, which remains deploy-ready.

### Evidence I ran myself

| Check | Result |
|---|---|
| `./dev-test/google-drive/run.sh --medium` at HEAD `fd8e6ce0d` | **199 / 29 / 10 PASS**, feature svelte-check clean — matches the report (`results/20260827-0018.txt`) |
| `npx svelte-check --output machine`, project-wide | **7 errors** — `AssetViewerNavBar.spec.ts` ×2, `Thumbnail.spec.ts` ×2, `NumberRangeInput.spec.ts` ×3. R2 fully closed |
| Inject a type error into the album `+page.svelte`, run `run.sh` | **"no svelte-check errors in feature files" → PASS** (G1a) |
| Run the gate's pipeline with svelte-check unable to start | **gate reports clean → PASS** (G1b) |
| Neuter the R1 `isOpen` guard → run both specs | 1 failed / 20 passed — **only** the R1 test |
| Neuter the toggle's keep-open → run | 2 failed — the unit test **and** the composition test |
| Neuter the sync row's `closeMenu()` → run | 2 failed — the unit test **and** the composition test |
| jsdom: plain open, `hideContent` true and false | focus lands on the `<ul>` — guard suppresses nothing |
| jsdom: open → close → open | menu open, focus on the `<ul>` — the guard does not eat the reopen |
| jsdom: open → close (the R1 case) | focus is on the **trigger `BUTTON`** — the positive the shipped test omits (G2) |

---

## Answers to the four things you asked me to attack

### 1. R1 guard correctness — no suppression, and outside `!wasOpen` is right

**Does `if (isOpen)` ever suppress a focus that should happen?** No, and it can't by construction:
`isOpen` is `$state` read *inside* the deferred closure, so it reports the value at microtask time.
The only way it reads `false` there is that something genuinely closed the menu in between — which
is precisely the case the guard exists to suppress. There is no "open but `isOpen` is stale" path,
because nothing sets `isOpen` outside `openDropdown`/`closeDropdown`.

Measured anyway, on both `hideContent` settings:

| sequence | menu | `document.activeElement` |
|---|---|---|
| open | open | **`UL`** — focus still happens |
| open → close → open | open | **`UL`** — the guard does not eat the reopen's focus |
| open → close | closed | **`BUTTON`** (the trigger) — the R1 fix working |

**Is keeping it outside `!wasOpen` right?** Yes, and the stated reason holds. `moveSelection` calls
`openDropdown` on every arrow, so the deferred `focus()` re-runs per keystroke — but focus is
already on the `<ul>` at that point, and `HTMLElement.focus()` on the already-focused element is a
no-op that does not even dispatch a `focus` event. I checked the two things that could have made
it observable and neither does: arrow navigation still advances `aria-activedescendant`, and the
menu does not reposition (`left/top` stayed `8px/8px` across five presses, because
`getContextMenuPositionFromEvent` falls back to the wrapper's box and the menu itself is
`position: fixed`, out of flow).

The recovery argument is real, too: if focus ever drifts out of the `<ul>`, the per-arrow refocus
is what brings it back. Moving it inside `!wasOpen` would trade a free no-op for a lost recovery.
Correct call, and the comment now says so.

### 2. R1 regression test modelling — faithful; assert the positive too (G2)

The modelling is sound. Two synchronous `.click()` calls run in the same task, so the
`tick()`-deferred focus from the open is genuinely still pending when the close runs; `setTimeout(0)`
then yields to a macrotask, and microtasks always drain before that. So the window the test claims
to model is the window it actually models — not a harness artefact.

I confirmed non-vacuity independently rather than taking your word: neutering the `isOpen` guard
fails **only** this test (1 failed / 20 passed).

**G2 — it asserts only the negative.** `expect(menu).not.toHaveFocus()` passes whether focus went
to the trigger (correct) or to `<body>` (a broken `focusButton()`). CLAUDE.md §4's rule is that a
"does not do X" assertion must also pin *why* it passes, and the sibling F1 test in the same file
does assert the positive. I measured the positive and it holds today — focus lands on the trigger
`BUTTON` — so pin it:

```ts
expect(menu).not.toHaveFocus();
expect(trigger).toHaveFocus();   // and it went back where it belongs
```

The test also never asserts the menu actually *closed*. That one is self-correcting — if a
regression left it open, the deferred focus would legitimately fire and the test would fail — so it
is fine as-is; worth a comment saying so, since it reads like an omission.

### 3. R4 composition test — genuinely end-to-end, proven by breaking it

Yes, it exercises the real wiring, and I verified that rather than reading it. The outer
`beforeEach` does stub `optionClickCallbackStore`, but `ButtonContextMenu`'s `$effect` overwrites
it with its own `handleOptionClick` the moment the menu opens — so by the time any row is clicked,
the real callback is what's registered. The proof is that breaking the real behaviour fails it:

```
make the toggle row close the menu   → unit test fails  AND  composition test fails
remove closeMenu() from the sync row → unit test fails  AND  composition test fails
```

A stub-only test could not have caught either, because a stub does not close anything.

The four assertions read real DOM state, not harness state:
- **F1** — `expect(menu).toHaveFocus()` on the element found by `findByRole('menu')`;
- **W2** — `aria-activedescendant` read off that same live element after a real `keyDown`;
- **W1** — `queryByRole('menu')).toBeInTheDocument()` after the toggle click. Under `hideContent`
  a closed menu is *removed from the DOM*, so this is a strong assertion, not a soft one;
- **sync** — `not.toBeInTheDocument()`, same mechanism inverted.

`getByText('Sync to Google Drive')` returns the inner `<div>`, not the `<li>`, but the click
bubbles to the row's handler — which is exactly how a real user click lands, so that is fidelity,
not a shortcut. `getByLabelText('drive').closest('[data-testid="ctx"]')` resolves to the wrapper
because `restProps` spreads onto it. Both fine.

This is the gap I flagged as R4 and it is properly closed.

### 4. The svelte-check gate — this is where the round breaks (**G1**)

Two independent holes, both reproduced against the real `run.sh`.

**G1a — the scope pattern misses the album page.** The grep is

```
grep -iE 'google-drive|GoogleDriveAlbumMenu|ButtonContextMenu|ContextMenuHarness|DriveMenuHarness'
```

`(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte` matches none of those —
yet it is the file this feature has edited in **every round** of Wave 5 (it mounts
`GoogleDriveAlbumMenu`, owns `loadGoogleDriveMenu`, `handleToggleGoogleDriveBackup`,
`driveTogglePending`, and received the `hideContent` prop last round). Same blind spot for
`MenuOption.svelte`, `ContextMenu.svelte`, and `context-menu.store.ts` — all adjacent to changes
this feature has already made.

Demonstrated by changing one line in that page to `let driveTogglePending: number = $state(false);`:

```
── web (svelte-check, feature files) ──
no svelte-check errors in feature files
RESULT: PASS
```

A hand-maintained filename allowlist will keep drifting behind the feature; that is the shape of
the bug, not this particular pattern.

**G1b — it fails open.** The pipeline is

```bash
GD_SC="$(cd "${REPO_ROOT}/web" && npx svelte-check --output machine 2>&1 | grep -i error | grep -iE '…' || true)"
if [[ -n "$GD_SC" ]]; then … FAILED=1; else echo "no svelte-check errors in feature files"; fi
```

`|| true` discards the exit status, and if svelte-check dies its error text almost certainly
contains none of the feature names, so the second grep empties `GD_SC` and the gate declares the
feature clean. Reproduced by running it with an unknown flag — svelte-check printed
`ERROR / Unknown option …`, exited non-zero, and the gate still said **PASS**. An OOM (this machine
has 8 GB and svelte-check is the heaviest step in the suite), a missing binary after a `pnpm`
prune, or a config error all take this path.

**Recommended replacement** — drop the scoping entirely and gate on the *set of files with errors*
against a recorded baseline. It cannot be fooled by a filename the pattern forgot, and it fails
closed:

```bash
SC_OUT="$(cd "${REPO_ROOT}/web" && npx svelte-check --output machine 2>&1)"
# svelte-check always emits a COMPLETED summary line; its absence means it never really ran.
if ! grep -q 'COMPLETED' <<<"$SC_OUT"; then
  echo "svelte-check did not complete — treating as failure" | tee -a "$OUT"
  echo "$SC_OUT" | tail -5 | tee -a "$OUT"
  FAILED=1
else
  # dev-test/google-drive/svelte-check-baseline.txt: the 3 files carrying the 7 pre-existing errors
  CUR="$(grep ' ERROR ' <<<"$SC_OUT" | sed 's/^[0-9]* ERROR "//' | cut -d'"' -f1 | sort -u)"
  NEW="$(comm -13 "$(dirname "${BASH_SOURCE[0]}")/svelte-check-baseline.txt" <(echo "$CUR"))"
  ...
fi
```

Baseline today is exactly three files:

```
src/lib/components/asset-viewer/AssetViewerNavBar.spec.ts      (2 errors)
src/lib/components/assets/thumbnail/__test__/Thumbnail.spec.ts (2 errors)
src/lib/components/shared-components/__test__/NumberRangeInput.spec.ts (3 errors)
```

Check the count as well as the file set, so that fixing one pre-existing error while adding a new
one in the same file cannot net out to zero.

**G3 (minor, same gate):** the greps run over whole machine-format lines, which include the *error
message*, not just the path. An unrelated file whose message happens to contain "google-drive"
would trip the gate. That direction fails closed, so it is a nuisance rather than a risk — and the
replacement above (matching the extracted path only) removes it too.

---

## Affirmations

- **R2's code fix is complete and verified independently**: project-wide svelte-check is back to
  exactly 7 errors, in exactly the three pre-existing unrelated spec files. `mode: '…' as const`,
  `vi.fn<() => void>()` and the `closeCallback` declared type were the right minimal fixes — the
  specs' behaviour is unchanged.
- **R3** is silenced the right way: `svelte-ignore` with a reason, on a role that genuinely is
  load-bearing. Changing the element or the role would re-break W2, and the comment says so.
- **R5** is done properly — the F2 test now pins `aria-activedescendant`, so "onOpen still 1"
  can no longer pass because the arrows stopped arriving. That is the same standard as the
  "true-before" guard on the soft-delete medium test, applied to a negative assertion.
- **The boundary rows** (80.0 → yellow, 95.0 → red) close the `>=` question from last round.
- **The R1 comment is now correct** where it was backwards, including the explicit note that
  deferring inverted an ordering the old synchronous focus relied on. That sentence is the one a
  future reader needs; good that it survived into the code rather than staying in the review.

## What I did not verify

- **Visual rendering** — colour *transitions*, the disabled "sync now" appearance, the
  unconnected-member row. The colour *classes* are now covered including both boundaries, so what
  remains genuinely needs a browser. This is the last untested class of Wave 5 claim.
- **The gate end-to-end through a live BullMQ queue** — unchanged standing: repository layer (10
  medium tests) plus service layer with mocks.
- **`pointer-events-none` on the display-only Switch** — jsdom does not implement pointer-events.
  Your framing is the right one: safe *by construction* (`Switch` has no `onCheckedChange`), not
  tested. Keep saying it that way.
- **G1's replacement gate** — I sketched it and verified the inputs it depends on (the `COMPLETED`
  line, the machine-format path extraction, the 3-file baseline), but did not write or run it.
- No server change this round; I confirmed the diff touches no repository, service, DTO or schema
  file, so no SQL/SDK regeneration or drift check is owed.

## Feeding back into the plan

`album-menu-ux-plan.md` §8 should record:

1. **R1/R3/R4/R5 closed**, each re-derived by neutering (guard → only the R1 test; toggle-closes →
   unit *and* composition; sync-no-close → unit *and* composition). Record that the composition
   test catches what the stubbed unit test cannot — that is the reason it exists and the reason to
   keep it.
2. **R2's code is fixed but its guard is not** (G1). Until the gate is replaced, "svelte-check
   feature-clean" in a report means "the five named patterns are clean", not "this feature's
   changes are clean" — and it means nothing at all if svelte-check failed to start. Do not quote
   it as evidence until it fails closed.
3. **Record the svelte-check baseline as a file**, not as a number in prose. "7" has now been
   quoted across three rounds; a checked-in baseline of the three offending files is what makes it
   verifiable, and it is what the replacement gate reads.
4. **Wave 5 is otherwise finished.** The only thing standing between this branch and a deploy is
   G1 plus the browser pass on the four visual states — and per CLAUDE.md §1 the browser pass is
   not a review substitute, so it needs its own round.
