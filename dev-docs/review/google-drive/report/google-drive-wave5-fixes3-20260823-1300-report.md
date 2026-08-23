# Review request — Wave 5 fixes round 3 (R1/R2/R3/R4/R5)

Fixes for `google-drive-wave5-fixes2-20260823-1210-review.md`, whose verdict was "fix R1 before
deploy, R2/R3 same commit — then this is done", with R4/R5 as coverage. Per CLAUDE.md §2.4 the fix
is a review target.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit to review | `861869fe7` |
| HEAD at request | `810186a25` |
| Prior review | `../review/google-drive-wave5-fixes2-20260823-1210-review.md` |
| Plan feedback | `dev-docs/google-drive/album-menu-ux-plan.md` §8 |

## What changed

- **R1** — deferred focus in `openDropdown` now guarded on `if (isOpen)`, so a close that runs
  before the microtask drains no longer strands focus on a collapsed `<ul>` (the 18 non-hideContent
  menus). Kept outside the `!wasOpen` guard deliberately; comment corrected. Regression test added.
- **R2** — svelte-check errors back to 7 (`mode` `as const`, `vi.fn<() => void>()`, `closeCallback`
  declared type). Added a scoped svelte-check step to `run.sh` gating on feature-file errors.
- **R3** — a11y warning on `<li role="menuitemcheckbox">` silenced with a reason (role is
  load-bearing; changing it re-breaks W2).
- **R4** — `DriveMenuHarness.svelte` + a composition test: real menu inside real ButtonContextMenu
  with hideContent, driving F1/W2/W1 end-to-end through the real `optionClickCallbackStore`.
- **R5** — F2 test now also asserts `aria-activedescendant` advanced, so it can't pass vacuously.
- Added the exact-boundary (80.0 / 95.0) bar-colour rows.

## Please attack

1. **R1 guard correctness.** Does `if (isOpen)` before the deferred `focus()` ever *suppress* a
   focus that should happen (a legitimate open whose `isOpen` is somehow false by the time the
   microtask runs)? And is keeping it outside `!wasOpen` right — does re-focusing on every arrow
   cause any observable problem?
2. **R1 regression test honesty.** It uses synchronous `.click()` twice + `setTimeout(0)`. Is that a
   faithful model of "close before the deferred focus drains", or does it pass for a harness reason?
   (Neutering the guard fails it — I checked — but attack the modelling.)
3. **R4 composition test.** Does it actually exercise the real callback wiring (not a stub), and are
   its four assertions (focus / nav / toggle-keeps-open / sync-closes) reading real DOM state?
4. **The svelte-check gate in run.sh.** Does the grep scope (`google-drive|GoogleDriveAlbumMenu|
   ButtonContextMenu|ContextMenuHarness|DriveMenuHarness`) catch the feature's files without
   masking a real error, and not accidentally match unrelated files?

## Verified / not verified

- **Verified:** feature 199/29/10 + svelte-check(feature) 0 PASS; web full 547; eslint clean;
  svelte-check project 7 (pre-existing); R1 test non-vacuous (neutered guard → only R1 fails).
- **Not verified (not code defects — need a browser / live queue):** visual colour *transitions*,
  disabled "sync now" appearance, unconnected-member row; gate end-to-end through a real BullMQ
  queue. The display-only Switch rests on `pointer-events-none`, which jsdom does not implement —
  safe by construction (`Switch` has no `onCheckedChange`), not testable.
- No server/schema/controller change this round ⇒ no SQL/SDK regen, no drift check.

## Test evidence

`dev-test/google-drive/results/20260823-1255.txt` (commit `10fc4e32b`; code identical to `861869fe7`):

```
── server (unit) ──               Tests  199 passed (199)
── web (unit) ──                  Tests   29 passed (29)   ← +4: R1 test, composition, 2 boundary rows
── web (svelte-check, feature) ── no svelte-check errors in feature files
── server (medium) ──             Tests   10 passed (10)
RESULT: PASS
```

Regression at HEAD: web full `547 passed | 2 skipped`. Server unchanged this round (last full run
`2325 passed | 2 skipped`).
