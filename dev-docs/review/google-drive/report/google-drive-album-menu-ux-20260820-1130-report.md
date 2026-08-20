# Design Review Request — Album Drive menu UX + the worker selection gate

A **design** review before code. The UI part is small (a toggle switch, a progress bar, a
divider). The part that needs eyes is one server decision: adding a *selection re-check* at the
worker's entry, which reverses a call an earlier review made on purpose.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Plan | `dev-docs/google-drive/album-menu-ux-plan.md` (full corner-case table + decisions) |
| Prior ruling being revisited | `../review/google-drive-wave1.5-impl-20260820-0850-review.md` Q2 |
| Tests | none yet — design only |

## What the user asked for

Three UI points on the album Drive dropdown: the "Backed up to Drive" text should be a **toggle
switch** (state isn't legible, and that it's clickable-to-off isn't shown); the storage figure
should be a **progress bar**; and the menu wants **dividers** with **tighter spacing** (currently
`p-4` = 16px, no separators). Direction confirmed as **"A"**: turning the toggle on enables
auto-backup *and immediately queues the album's pending assets*.

## The decision that needs review — a worker selection gate (plan §2, decision 1)

### The problem it solves

Turning the toggle **off** deletes the selection row but does **not** cancel jobs already queued,
because the worker validates enabled / connected / blocked / ledger — **not selection**. So the
switch reads "off" while a few more photos keep uploading.

The Wave 1.5 review saw this and ruled it acceptable (Q2), on two grounds: the re-check is a join
not a PK lookup, and the leak window was small. **Both premises change when the toggle moves from a
settings-page checkbox to a switch inside the album menu:** the user now watches the corner
progress card keep ticking right after flipping the switch, so "off doesn't mean off" goes from
invisible to on-screen.

### The proposed gate

Add to `uploadAsset`'s entry, between the connection check and the ledger check:

```
enabled → connected → [NEW: is this asset in ANY of this user's selected albums?] → blocked → ledger
```

New repo method `isAssetInSubscribedAlbum(userId, assetId)` — an indexed join
`album_asset ⋈ google_drive_album ⋈ album_user(live membership)`. If the answer is no, skip.

**The rule is "any selected album", not "this album".** An asset in albums A and B, with only A
deselected, must keep uploading for B. This is the same shape as the pending-count query and keeps
the whole thing consistent with the existing idempotency (ledger + jobId dedup + hasUpload).

### Where to attack

1. **Is reversing the Wave 1.5 ruling justified?** My argument is that the ruling wasn't wrong —
   it was "unnecessary *then*" — and the toggle's move into the menu is what makes it necessary.
   Push on whether the on-screen visibility actually changes the calculus, or whether a toast
   ("pending items were cancelled") would close the gap more cheaply than a per-job query.

2. **Cost placement.** The gate runs per job. `getBlockingError` already runs per job, so this is
   the same order — but it adds a second per-job query to the hot path (every add-to-album on a
   subscribed album). Is placing it *after* connected but *before* blocked right? (Rationale:
   connected is the cheapest reject; a deselected asset shouldn't even consult the block table.)

3. **The membership join, again.** `isAssetInSubscribedAlbum` joins live `album_user` for the same
   reason `streamPendingUploads` does — a selection row outlives an unshare. Confirm this doesn't
   reintroduce a path where a lost-access album still uploads.

4. **Interaction with the medium test.** `streamPendingUploads`' unshare-stop is covered by a
   medium test. This gate is a *second* enforcement point of the same property at the worker. Does
   it deserve its own medium test, or is the unit test (subscribed → proceeds, deselected → skips,
   one-of-two-albums → proceeds) enough given the query is nearly identical to one already
   integration-tested?

## The UI decisions (plan §4.1, §5)

Lower-stakes, but flag anything off:

- **"Sync now" stays visible even at zero pending, disabled, labelled "all synced"** — rather than
  hidden. Hiding it removes only harmless cases (idempotency already absorbs a redundant sync) and
  costs the retry-failed / retry-after-unblock / "check now" affordances. Disabling instead makes
  the "pressed it, nothing happened" case (#2) *unpressable*. Is disabled-with-status clearer than
  hidden, or just more clutter?

- **Dividers + 10px spacing apply to Drive menu items only.** `MenuOption` is shared across every
  menu in the app, so it is not touched; the Drive rows get their own styling. Reasonable, or
  should this be a variant prop on the shared component?

- **Switch is not optimistic** — state updates after the server confirms, reverting on failure.
  Consistent with the existing `loadGoogleDriveMenu` re-fetch.

## Corner-case coverage (plan §1)

The plan enumerates 12 cases across [toggle] × [this album syncing] × [other album syncing]. Ten
are already safe by existing mechanisms (idempotency, the Wave 2/3 fixes, soft-delete filters);
the table says *why* each is safe rather than just asserting it. The one real issue is the
off-doesn't-stop case above; the "sync now gives no feedback" case is dissolved by the
disabled-at-zero decision. **Please check the table for a case I've marked "safe" that isn't.**

## Not yet done

No code. No tests. This is a request to sanity-check the selection-gate decision (and the smaller
UI calls) before building, specifically because it overturns a prior review's explicit ruling and
sits on the upload hot path.
