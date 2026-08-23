# Review request — Wave 5 fixes round 2 (F1/F2/F3)

Fixes for `google-drive-wave5-fixes-20260823-1130-review.md`. Per CLAUDE.md §2.4 the fix is itself
a review target. The prior review found the seven original findings closed and the server
deploy-ready; this round addresses the two new shared-component issues it raised plus the test gap.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit to review | `ceb9f95ec` |
| HEAD at request | `78c48b66b` |
| Prior review | `../review/google-drive-wave5-fixes-20260823-1130-review.md` |
| Plan feedback | `dev-docs/google-drive/album-menu-ux-plan.md` §7 |

## What changed

**F1** — `ButtonContextMenu.openDropdown` now defers `menuContainer?.focus()` with
`void tick().then(...)` so the `<ul role="menu">` (mounted only after `isOpen` flips, under
`hideContent`) is focusable when focus lands. `tick` imported.

**F2** — `openDropdown` fires `onOpen` only on a genuine closed→open transition (`wasOpen` guard).
`contextMenuNavigation` calls `openDropdown` on every arrow key, so this stops re-running
`loadGoogleDriveMenu` (three requests, one to Google) per keystroke.

**F3** — two specs + a harness:
- `web/.../album-page/GoogleDriveAlbumMenu.spec.ts` (direct render)
- `web/.../context-menu/ButtonContextMenu.spec.ts` + `__tests__/ContextMenuHarness.svelte`

Plus: sixth medium test (one live + one soft-deleted selected album ⇒ true, S1 no-over-drop);
the `handleDocumentClick` obligation comment; the storage-row load-bearing-id comment; both new
web specs added to `dev-test/google-drive/run.sh`.

## Please attack

1. **Are the new tests non-vacuous?** I verified by neutering the W1 guard, the F1 tick, and the
   F2 `wasOpen` guard in turn — each failed exactly its own test, nothing else. Re-derive or find a
   test that passes for the wrong reason. jsdom cannot model native `<button>` Enter/Space
   activation; F1 (focus on the `<ul>`, not the trigger) is what makes that moot — confirm that
   argument.
2. **F2 wasOpen guard** — does firing `onOpen` only on closed→open break any *other*
   `ButtonContextMenu` consumer that relied on `onOpen` per-open-call? (The prop's contract says
   "when the menu opens".)
3. **F1 tick defer** — any path where `menuContainer` is still undefined after one `tick`, or where
   deferring focus regresses the non-`hideContent` menus?
4. **The harness** faithfully drives the *real* `ButtonContextMenu` + real `MenuOption`; confirm the
   assertions reflect real behaviour and not harness artefacts.

## Verified / not verified

- **Verified:** feature 199/25/10 PASS; web full 543; server full 2325; tsc/eslint clean;
  non-vacuous check (neutered-fix → targeted failure); S1 mutation coverage extended.
- **Not verified (not code defects — need a browser / a live queue):** visual rendering — bar
  colour transitions, disabled "sync now", unconnected-member row; the gate end-to-end through a
  real BullMQ queue.
- No schema/controller change ⇒ no SQL/SDK regen, no migration drift check.

## Test evidence

`dev-test/google-drive/results/20260823-1200.txt` (commit `975638600`; code identical to
`ceb9f95ec`):

```
── server (unit) ──   Tests  199 passed (199)
── web (unit) ──      Tests   25 passed (25)   ← +17: two new specs
── server (medium) ── Tests   10 passed (10)   ← +1: S1 no-over-drop
RESULT: PASS
```

Regression at HEAD: web full `543 passed | 2 skipped`; server full `2325 passed | 2 skipped`.
