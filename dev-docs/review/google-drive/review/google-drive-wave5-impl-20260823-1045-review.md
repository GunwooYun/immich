# Code Review — Wave 5 implementation (album menu UX + worker selection gate)

Implementation review of `320646871` (server gate) and `9c1e52bd3` (web menu), against the design
review that preceded them.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commits reviewed | `320646871`, `9c1e52bd3` (HEAD at review: `ab40942b7`) |
| Report | `../report/google-drive-wave5-impl-20260823-1045-report.md` |
| Prior design review | `google-drive-album-menu-ux-20260820-1130-review.md` |
| Reviewed | 2026-08-23 |

## Verdict

**The server gate is correct and the four design-review priorities were all carried out.** I could
not find a false *negative* in `isAssetInSubscribedAlbum` — no shape where a genuinely-owed upload
is refused. I did find one false *positive* (S1), reproduced on real Postgres.

**The web commit is where the problems are.** `GoogleDriveAlbumMenu` was written as free-standing
markup dropped into a `<ul role="menu">` that expects `MenuOption`'s contract, and it silently
inherits none of it. Three consequences, all reproduced by rendering the real
`ButtonContextMenu` + the real component in jsdom:

- the menu **collapses the instant you touch the toggle**, so the switch's new state — the entire
  point of the change — is never visible in place (W1);
- **keyboard operation of the menu is dead**: ArrowDown highlights nothing, Enter closes the menu
  instead of activating a row (W2);
- the menu's controls stay **in the tab order while the menu is closed** (W3).

None of these are visible to the existing test suite, and the report correctly says the UI has
never been seen in a browser. They are the reason it should not be deployed as-is.

Priority: **S1, W1, W2, W3 before deploy. S2, W4, W5 are corrections of statements that are
untrue in the tree right now** — this repo has been burned twice by exactly that (CLAUDE.md §1
last bullet, §2 "문서가 코드와 어긋나면 문서를 고친다"), so they are not cosmetic.

### Evidence I ran myself

| Check | Result |
|---|---|
| `dev-test/.../results/20260823-1042.txt` vs. report | matches: commit `9c1e52bd3`, 199 / 8 / 8, `RESULT: PASS` |
| `npx tsc --noEmit -p tsconfig.json` (server) | clean |
| `npx vitest run … google-drive.service.spec.ts` | 53 passed |
| `npx eslint` on both changed web files, `--max-warnings 0` | clean |
| `npx vitest run` (full web suite) | 54 files / **526 passed**, 2 skipped — as claimed |
| medium scratch spec on real Postgres (S1) | **reproduced**, see below |
| jsdom render of `ButtonContextMenu` + `GoogleDriveAlbumMenu` (W1–W3) | **reproduced**, see below |

Generated artefacts (`src/queries/*.sql`, SDK) not read, per the report's request — except to
confirm the emitted SQL for the new method matches the builder, which it does.

---

## S1 — the gate lets a soft-deleted album keep uploading (confirmed on Postgres)

This is the answer to the report's Q1: *"is there a shape where it returns true for an asset that
should no longer upload?"* Yes — and it is the one shape the queueing side already guards against.

`countPendingUploads` and `streamPendingUploads` both join `album` and filter
`.where('album.deletedAt', 'is', null)`. `isAssetInSubscribedAlbum` does not join `album` at all:

```
album_asset ⋈ google_drive_album ⋈ album_user      -- no `album`, no deletedAt filter
```

The doc-comment says *"Same shape as countPendingUploads/streamPendingUploads"* — it isn't. It
drops a predicate those two carry deliberately (their own comment: *"minus soft-deleted albums and
assets"*).

`album.deletedAt` is not dead schema. `UserAdminService#delete` calls
`albumRepository.softDeleteAll(id)`, which sets `deletedAt` on every album that user owns
(`album.repository.ts:239`). Nothing cascades: `album_asset`, `album_user`, and
`google_drive_album` rows all survive, and the *guest's* user row is untouched, so their
credentials and selection are intact.

I ran this as a medium spec against real Postgres (temporary file, since deleted):

```
owner + guest, asset in owner's album, guest is an album_user, guest has Drive
connected and google_drive_album selected.
BEFORE:  gate=true   pending=1
UPDATE album SET "deletedAt" = now()      -- what softDeleteAll does
AFTER:   gate=true   pending=0   getSubscribableAlbums(guest)=0 rows
```

So after an admin deletes the owner:

| | |
|---|---|
| `countPendingUploads` (corner card, album menu) | **0** — "nothing to do" |
| `getSubscribableAlbums` (settings list) | **album absent** — the selection is not shown, so it can't be turned off in the UI |
| `isAssetInSubscribedAlbum` (this gate) | **true** — queued jobs proceed and write real files into the guest's Drive |

That is the *exact* failure this gate was built to eliminate, restated: invisible Drive egress
from an album the UI insists isn't backing anything up, with no way to stop it from the UI.
`unsubscribeAlbum` has no access check, so the row is removable via the API — but only by someone
who already knows the album id, which is not a user-facing remedy.

It is narrower than the deselect case (needs a user-deletion, and only drains the backlog already
queued — `streamPendingUploads` won't queue more), but it is the same class of bug and the fix is
one line plus one join:

```ts
.innerJoin('album', 'album.id', 'album_asset.albumId')
…
.where('album.deletedAt', 'is', null)
```

and a fifth medium test. Then the doc-comment's "same shape as" claim becomes true, which is
worth something on its own: the next person will read that sentence and trust it.

**Recommendation:** add the `album` join + `deletedAt` filter, add the medium test, and keep the
"same predicate as the stream" invariant stated explicitly so a future divergence is a review
question rather than a silent one. (`asset.deletedAt` genuinely does *not* belong here — gate 5
in `uploadAsset` covers it, and doing it twice would be the worse kind of duplication. Say so in
the comment, so the omission reads as deliberate rather than as the same slip.)

## S2 — `unsubscribeAlbum`'s doc-comment now documents the bug this commit fixed

`google-drive.service.ts:995-1001`, unchanged by either commit:

> *Jobs already queued for this album still run: the worker validates the ledger and the
> connection, not the subscription, so a few photos may still land. **Accepted rather than paying
> for a per-job membership join**; the window is only ever "selected then immediately unselected".*

Every clause of that is now false. The worker *does* validate the subscription; the per-job
membership join *was* paid for; and the commit message explicitly overturns "a few photos" as
wrong ("whole-album-sized"). This is the single most likely place for the next reader — or the
next review — to form a wrong model of the system, and CLAUDE.md records that this has already
happened here once. Rewrite it to point at `uploadAsset` gate 3 and say what deselect now
guarantees.

Two smaller instances of the same drift:

- `google-drive-album.table.ts` doc: *"every read path that turns a selection into an upload —
  `getSubscribers`, `streamPendingUploads` — must join through current membership as well."*
  There is now a third. It should be named, precisely because that comment is the canonical
  statement of the rule.
- `uploadAsset`'s inline numbering runs `0, 1, 2, 3, 4, 3, …` — the old "3) Load the actual asset
  row" was left at 3 when the new gate took that number. Renumber; the comments are load-bearing
  here and the sequence is the thing being documented.

---

## W1 — the toggle closes the menu, so its state change is never seen

This is the finding that undercuts the web commit's stated goal ("a real toggle switch, so on/off
is legible at a glance").

`ButtonContextMenu` closes on **any** document click that isn't inside `buttonContainer` — and
`buttonContainer` wraps only the trigger `IconButton`, not the menu body:

```ts
const handleDocumentClick = (event: MouseEvent) => {
  if (!isOpen) return;
  if (buttonContainer?.contains(event.target as Node)) return;
  closeDropdown();                      // ← fires for clicks *inside* the menu
};
```

Rendered the real pair in jsdom and clicked the Switch:

```
openMaxHeight  = "752px"
afterMaxHeight = "0px"        ← menu collapsed
onToggle calls = 1            ← the request did fire
```

So the interaction is: flip the switch, the menu vanishes, and you must reopen it to learn whether
anything happened. Under `MenuOption` that was coherent — menu items close menus. A **switch** is
not a menu item; it promises in-place state. This also makes `togglePending` unobservable: the
`disabled={togglePending}` prop can never be seen, so the guard is real but its feedback is dead
code. (Separately: `@immich/ui`'s `Switch` derives its *disabled styling* from field context, not
from the `disabled` prop — the prop reaches `Switch.Root` through `restProps` and does block
interaction, but `opacity-38` / `cursor-not-allowed` never apply. Moot while W1 stands.)

**Recommendation:** keep the menu open for the toggle. Either give `ContextMenu` a "don't close on
clicks inside the menu body" path (`menuScrollView.contains(target)` alongside the
`buttonContainer` check) and let `MenuOption` keep closing via `optionClickCallbackStore` as it
already does, or move the toggle out of the dropdown. Do not ship a switch inside a container that
destroys the feedback the switch exists to give.

## W2 — keyboard operation of the Drive menu is dead

`contextMenuNavigation` navigates by element **id**: `moveSelection` reads `container.children`,
calls `selectionChanged(selectedNode?.id)`, and `getCurrentElement()` resolves the selection with
`container.querySelector('#' + activeId)`. `MenuOption` exists to satisfy that contract — it
generates an `id`, renders `<li role="menuitem">`, and highlights itself from `$selectedIdStore`.

`GoogleDriveAlbumMenu` renders bare `<div>` / `<button>` with no ids. Reproduced:

```
menu children      = [ "DIV#(no id)", "BUTTON#(no id)" ]
after ArrowDown:  aria-activedescendant = ""     (nothing highlighted, max-height still 752px)
after Enter:      max-height = "0px"             (menu closed)
                  onToggle calls = 0             (nothing activated)
```

`handleClick` in the action reads `if (isOpen && !selectedId) { closeDropdown(); return; }` — and
`selectedNode?.id` on an id-less element is `''`, which is falsy. So Enter/Space closes the menu
forever, on every row.

There is a second-order hazard on the same path: with `$selectedIdStore === ''`, the next
`getCurrentElement()` evaluates `container.querySelector('#')`, and `'#'` is not a valid selector —
verified it throws `DOMException: Failed to execute 'querySelector' … '#' is not a valid selector`.
jsdom swallowed it inside the async `moveSelection` in my harness, so I am not claiming a visible
crash, but it is a latent throw on an arrow-key path and it will not stay swallowed forever.

Also worth stating plainly: `<ul>` may contain only `<li>` (plus script/template), and children of
`role="menu"` must be `menuitem`/`menuitemradio`/`menuitemcheckbox`. The current markup violates
both. `svelte-check`'s 7 pre-existing errors are elsewhere and eslint is clean, so nothing in the
toolchain catches this.

**Recommendation:** wrap each row in `<li id={generateId()} role="menuitem">` (or
`role="menuitemcheckbox"` for the toggle row) and drive the hover/selected style from
`$selectedIdStore`, exactly as `MenuOption` does. That is ~10 lines and it restores keyboard
navigation, `aria-activedescendant`, and valid DOM without touching `MenuOption` — which was the
whole point of the fork, and stays intact.

## W3 — the menu's controls are tabbable while the menu is closed

`ButtonContextMenu` is used without `hideContent`, which defaults to `false`, so the children stay
mounted permanently; "closed" is `max-height: 0` + `overflow: hidden`. Clipping does not remove
elements from the tab order. `MenuOption`'s `<li>`s were never focusable, so this is new:

```
closedMaxHeight = "0px"
focusable inside the closed menu = 2  →  [ "google_drive_backup" (Switch), "google_drive_open" ]
```

(3 once `backedUp` is true, with "Sync now".) A keyboard user tabbing across the album header now
lands on two — soon three — invisible controls, one of which starts a Drive backup.

**Recommendation:** pass `hideContent` on this `ButtonContextMenu` (it is currently used nowhere,
and `onOpen={loadGoogleDriveMenu}` still fires, so nothing else changes), or gate the rows on
visibility. `hideContent` is the smaller change and also stops the component paying render cost on
every album page view.

## W4 — the 80%/95% thresholds do not mirror anything server-side

Both the component comment and the report's Q5 say the thresholds match "the server's
quota-block behaviour" / "the server's own logic". I grepped: **there is no percentage threshold
anywhere on the server.** The quota block is purely reactive — `GoogleDriveUploadErrorClass.
QuotaExceeded` is written when Google itself returns a quota-exceeded 403, and
`getGoogleDriveStorage` only forwards Drive's raw `limit`/`usage`/`usageInDrive`/
`usageInDriveTrash`.

So the answer to Q5 is that the premise is wrong, and the honest one is better: 80/95 are
presentational thresholds chosen for this UI, and they are the *only* place they exist. **Nothing
to share** — a "shared constant" would imply a server behaviour that does not exist and would
mislead the next reader into thinking the server acts at 95%. Fix the comment to say what the
colours actually mean ("warn before Google starts refusing, since the server only learns about the
quota by being refused"), and Q5 dissolves.

This is small in code and large in kind: it is a comment asserting a fact about another layer
that is not true, which is precisely CLAUDE.md §1's last bullet.

## W5 — four orphaned i18n keys

`google_drive_backup_on`, `google_drive_backup_off`, `google_drive_backup_off_description`, and
`google_drive_backup_progress` now have zero references anywhere in `web/` or `mobile/`. They ship
to translators as live strings. Delete them in the same commit that orphaned them.

The three new keys are correctly placed — `i18n/en.json` still verifies as case-insensitively
sorted, so CI's i18n check (CLAUDE.md §4) will pass.

---

## Answers to the report's questions

**Q1 — the selection gate join.** Covered above. One false positive (S1, soft-deleted album). **No
false negatives found.** I specifically checked: album owners are represented in `album_user`
(`role = 'owner'`, enforced by the `album_user_unique_owner` partial unique index), so
`onRef('album_user.userId','=','google_drive_album.userId')` matches for self-owned albums — the
obvious way this join could have been wrong, and it isn't; the first medium test proves it on
Postgres. The `assetId`-only predicate is indexed (`album_asset_assetId_idx`, present in the dev database —
`album_asset`'s PK leads with `albumId`, so without that index this would have been a seq scan on
the largest join table in the query). `user_google_drive` and `asset.deletedAt` are correctly *absent* — gates 1 and 5 in
`uploadAsset` cover them, and duplicating them would be the join getting wider for no gain.

`EXPLAIN` on the dev database confirms it — three index scans, no seq scan anywhere:

```
Limit → Nested Loop
  → Hash Join
      → Bitmap Index Scan on "album_asset_assetId_idx"   (assetId = $1)
      → Bitmap Index Scan on "album_user_userId_idx"     (userId  = $2)
  → Index Only Scan using google_drive_album_pkey        (userId, albumId)
```

**Q2 — is "any selected album" right?** Yes, and it is already the documented contract:
`google_drive_albums_description` reads *"Photos in more than one album are backed up if any of
those albums is selected."* Anything else would contradict both that string and the ledger's
`(userId, assetId)` idempotency — under a per-album rule, an asset in A and B would need a second
copy or a rule for which album "wins". Semantics confirmed; the surprise the report worries about
is already answered in the UI copy, which is the right place for it.

**Q3 — gate ordering cost.** The ordering is right and the reasoning holds; both new queries are
indexed single-row lookups. One consequence worth recording rather than changing: a
**quota-blocked** account now pays `hasUpload` + the selection join before reaching the blocking
check, where it used to pay one query. Gate 4's own comment still frames itself as the cheap
early-out for "quota hit mid-backfill". It still saves the expensive thing (the Drive API call),
which is what that sentence is really about — but it is no longer *first*, and
`streamPendingUploads` already excludes blocked users from being queued at all, so the population
hitting this path is only the pre-block backlog. Not a change; add half a sentence to gate 4's
comment so the next reader doesn't think it is the first gate.

**Q4 — hand-rolled component vs. a `MenuOption` variant prop.** The instinct to leave `MenuOption`
alone is right (the design review said so, and upstream-merge surface is a real cost here). But
the fork copied the *styling* and dropped the *contract* — ids, `<li role="menuitem">`,
`$selectedIdStore`, `optionClickCallbackStore` — and that contract is what W1/W2/W3 are made of.
Answer: not a variant prop, and not this either. Keep the Drive-local component, and make it
satisfy `MenuOption`'s structural contract (W2's fix). Styling drift is the cost you chose to
accept; behavioural drift is not something you chose, and it is the part that broke.

**Q5 — thresholds in two places.** They are in one place. See W4.

---

## What I did not verify

- **Anything visual.** Bar colours, the amber/red transitions, the disabled "sync now", and the
  unconnected-member row are still unproven — my jsdom harness measured structure and behaviour
  (focus order, `max-height`, `aria-activedescendant`), not appearance. W1–W3 are behavioural and
  reproduced; the rendering asks in "Not verified" remain open.
- **The gate end-to-end through a live BullMQ queue.** Same standing as the report states: proven
  at the repository layer and at the service layer with mocks, not through a real queued job.
- **Migration drift and SQL regeneration** — I read the emitted SQL for the new method and it
  matches the builder, but I did not re-run `sql-tools migrations generate` (no schema change in
  this diff, so there is nothing for it to catch).
- **`svelte-check`.** Not re-run; note that it would not have caught W2's invalid `<ul>` children
  in any case.

## Feeding back into the plan

`album-menu-ux-plan.md` should record:

1. The gate is built and its join is proven on Postgres — but **the predicate is not yet identical
   to `streamPendingUploads`** (S1). Note it as an open invariant, not a done one.
2. The design review's "non-optimistic switch — safe, but it will feel laggy" prediction did not
   survive contact with the container. What shipped is neither: `@immich/ui`'s `Switch` takes
   `checked` as `$bindable` and the call site passes it **unbound**, so bits-ui flips the visual
   immediately (verified: `aria-checked` goes `false → true` with no parent update at all). The
   `catch` branch of `handleToggleGoogleDriveBackup` never calls `loadGoogleDriveMenu`, so
   `driveBackedUp` does not change on failure and nothing *deliberately* pushes the old value
   back — recovery depends on whether Svelte happens to re-push an unchanged `checked` when
   `driveTogglePending` flips. I verified that an explicit re-push of the same value does restore
   it, so this is "may or may not self-correct", not a guaranteed stuck switch — which is worse
   than either, because it will behave differently in test and in the browser. It should bind, or
   reset explicitly in the `catch`. Record it as "optimistic-without-revert, unintended", so
   nobody re-derives the design review's lag analysis for a design that isn't running.
3. W1–W3 as the standing reason the album menu is not deploy-ready, so a later session doesn't
   read "199/8/8 PASS" and conclude otherwise.
