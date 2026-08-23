# Review request — Wave 5 review fixes (S1/S2 server, W1–W5 web)

The fixes applied in response to `google-drive-wave5-impl-20260823-1045-review.md`.
Per CLAUDE.md §2.4, a fix is itself a review target — Wave 1.5's R1–R3 fixes made new defects,
so this asks you to attack the fixes, not re-confirm the original findings.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commits to review | `a454674ec` (server), `61e2048ed` (web) |
| HEAD at request | `54249e519` |
| Prior review | `../review/google-drive-wave5-impl-20260823-1045-review.md` |
| Plan feedback | `dev-docs/google-drive/album-menu-ux-plan.md` §6 |

## What changed, mapped to the findings

**S1 (server, `a454674ec`)** — `isAssetInSubscribedAlbum` now joins `album` and filters
`album.deletedAt is null`, matching `countPendingUploads`/`streamPendingUploads`. `asset.deletedAt`
deliberately left out (gate 5 covers it), stated in the comment. Regenerated
`google.drive.repository.sql`. Fifth medium test added: soft-delete the album, assert the gate
flips to false while the selection row survives — guarded by a true-before assertion.

**S2 (server, `a454674ec`)** — rewrote `unsubscribeAlbum`'s doc (worker now checks subscription /
pays the join / leak was album-sized); added `isAssetInSubscribedAlbum` to the table doc's read-path
list; renumbered `uploadAsset` gates (was `0,1,2,3,4,3` → asset-load is now `5`); gate 4 comment
notes it is no longer literally first.

**W1 (web, shared `ButtonContextMenu`)** — `handleDocumentClick` now also returns without closing
when the click is inside `menuContainer`. MenuOption closes itself via `optionClickCallbackStore`,
so this leaves every existing menu's close path untouched and only stops non-MenuOption bodies from
self-dismissing.

**W2/W3 (web, `GoogleDriveAlbumMenu` + one prop at the call site)** — every row is now
`<li id={generateId()} role="menuitem">` (toggle: `role="menuitemcheckbox" aria-checked`), syncs
`$selectedIdStore` on hover, highlights from it; action rows (sync/open/connect) close via
`optionClickCallbackStore`. `hideContent` passed on the Drive `ButtonContextMenu`.

**W4/W5 (web)** — threshold comment rewritten (presentational, no server counterpart); four orphan
i18n keys deleted; en.json still case-insensitively sorted.

**Optimistic toggle** — Switch is display-only (`pointer-events-none`, `checked={backedUp}`, no
change handler); the row `<li>` takes the click and fires `onToggle` once. `backedUp` only updates
after the server round-trip, so a failed toggle leaves the switch put with no revert path.

## Please attack

1. **The shared-component change (W1) is the highest-risk edit** — it touches every menu in the
   app, not just Drive's. Is there any existing menu whose body is *not* made of MenuOptions and
   that *relied* on the old "click inside menu closes it" behaviour? I argued there isn't, because
   MenuOption self-closes via the callback and that's the dominant pattern — verify that reasoning,
   or find the menu that breaks.
2. **S1 join correctness on Postgres.** Does the added `album` inner join drop any row it
   shouldn't (e.g. an asset genuinely owed an upload whose album is *not* soft-deleted)? The fifth
   medium test covers the deletion case; is there a shape it misses? Is the `assetId`-only predicate
   still indexed after the extra join?
3. **W2 keyboard contract.** With `<li>` ids in place: does ArrowUp/Down/Enter/Space now activate
   every row correctly, including the `menuitemcheckbox` toggle (Enter → row click → single
   `onToggle`, no double-fire with the Switch) and the inert storage row (Enter → no-op, does not
   close the menu via the empty-selectedId path)? The `#''`/`#undefined` querySelector throw the
   prior review noted — is it fully avoided now that every row has an id?
4. **hideContent (W3) side effects.** `onOpen={loadGoogleDriveMenu}` still fires on open, and the
   menu still renders its content when opened — confirm nothing that depended on the always-mounted
   body regressed.
5. **The non-optimistic toggle.** Is "switch reflects backedUp, updated only on success" actually
   correct on the failure path, and does it feel acceptable (server round-trip latency before the
   switch moves)? `togglePending` disables the row during the round-trip.

## Verified / not verified

- **Verified:** repository join on real Postgres (medium test 9/9); gate ordering + skip semantics
  (server unit); i18n sort; types; lint; SQL regeneration; migration drift ("No changes").
- **Not verified (jsdom/mocks only, or not at all):** actual browser rendering — bar colour
  transitions, disabled "sync now", unconnected-member row; the gate end-to-end through a live
  BullMQ queue (proven at repository + service-with-mocks layers only).
- Generated artefacts (`src/queries/*.sql`, SDK) — no need to read; the emitted SQL for the changed
  method is shown in the S1 commit.

## Test evidence

`dev-test/google-drive/results/20260823-1115.txt` (commit `394395bc1`, before the doc/commit
re-stamp; code identical to `a454674ec`/`61e2048ed`):

```
── server (unit) ──   Tests  199 passed (199)
── web (unit) ──      Tests    8 passed (8)
── server (medium) ── Tests    9 passed (9)   ← was 8; +1 soft-delete gate test
RESULT: PASS
```

Regression at HEAD: server full `2325 passed | 2 skipped`; web full `526 passed | 2 skipped`.
`tsc --noEmit` clean; `eslint --max-warnings 0` clean (server + web changed files);
`sql-tools migrations generate` → "No changes detected".
