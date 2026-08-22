# Design Review — Album Drive menu UX + the worker selection gate

Design review of `album-menu-ux-plan.md` + the request, before code. Verified the current
`uploadAsset` entry sequence and the `countPendingUploads` predicate the argument rests on.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Reviewed | 2026-08-20 |
| Revisits | `google-drive-wave1.5-impl-20260820-0850-review.md` Q2 |
| Report | `../report/google-drive-album-menu-ux-20260820-1130-report.md` |

## Verdict

**Build the gate (2-C) — the conclusion is right.** But the *reason* the plan gives for it is
factually wrong, and correcting that also answers Q1: the fix isn't justified by an on-screen
symptom (there isn't one) but by real files landing in the user's Drive after "off." Two more
substantive notes — the cost-placement question optimizes the rare case (Q2), and the gate earns a
medium test (Q4) precisely because its join is the thing this feature keeps getting subtly wrong. The
UI calls are all fine.

---

## Q1 — the gate is justified, but not for the reason stated

The plan's argument is: the toggle moved from a settings checkbox into the album menu, so "off doesn't
mean off" went from invisible to on-screen — the user "끄자마자 우하단 진행 카드에서 숫자가 계속
도는 걸 직접 본다." **That premise is incorrect.** `countPendingUploads` (the source for the corner
card's `pending`) *inner-joins* `google_drive_album`:

```
album_asset ⋈ album ⋈ google_drive_album(userId) ⋈ album_user ⋈ user_google_drive ⋈ asset
  where …ledger null, distinct assetId
```

So the moment `unsubscribeAlbum` deletes the selection row, the deselected album's assets **stop
matching** — and on the next poll (≤3 s) the card's number *drops* to exclude them. The card does not
keep ticking for the album you turned off; it falls. The most the user sees is a ≤3 s stale value,
then a drop. The "on-screen ticking" the plan builds its case on doesn't happen.

**What actually happens is worse and less visible:** the queued jobs keep running and keep writing
files into the user's real Google Drive — invisible in immich (the card already stopped counting
them), visible only in Drive. And via case #6, `subscribeAlbum` queues the *entire* album, so
"on, then immediately off" can leak the **whole album** into Drive, not "a few photos." That is the
honest justification, and it's a stronger one:

- It's real egress of unwanted files to the user's Drive (they'll have to find and delete them).
- It's potentially album-sized, not a handful.

So: reverse the Wave 1.5 ruling, yes — but rewrite the rationale. The ruling was right *then*
(settings checkbox, no whole-album immediate queue framing). What changed isn't visibility; it's that
the in-menu toggle makes "on then off" a natural two-second gesture, and `subscribeAlbum`'s
immediate whole-album queue turns that gesture into a whole-album leak. A toast alone (2-A) can't fix
that — it would narrate the leak, not stop it. **2-C is the right fix; keep the 2-A toast alongside it
for the ≤5 jobs already mid-flight (past the gate, unstoppable), which is honest completeness.**

## Q3 — membership join: safe, and it closes a window I previously accepted

Confirmed the gate can't reintroduce a lost-access upload: it only *adds* a skip condition, so it's
strictly more restrictive. Better than neutral — it's a **second live-access enforcement point**. In
the Wave 1.5 review I accepted the "in-flight past unshare" window as "authorized at enqueue" (a
backfill queued just before an unshare would still drain to the user's Drive). 2-C's membership join
closes that too: those jobs now hit the gate at execution and skip. So the gate is worth building for
this reason independent of the deselect UX — it makes the worker enforce current access, not just
access-at-enqueue. Note this as a security improvement in the plan; it's a stronger argument than the
UX one.

## Q2 — cost placement: the plan optimizes the rare case

The plan agonizes over "selection before blocked" (so a deselected asset skips the block lookup). But
deselected-asset jobs are *rare* (only in the deselect window), so that ordering saves almost nothing;
meanwhile the new join runs on **every** upload. The bigger lever is one the plan doesn't consider.

The plan itself stresses that queueing is idempotent and re-queues everything — every `syncAlbum` /
`subscribeAlbum` re-queues the whole album and the **ledger absorbs** the already-uploaded ones. So on
any re-sync or backfill of a mostly-done album, the *highest-hit-rate reject is `hasUpload`* — yet it
sits **last**, after enabled → connected → blocked, and now → selection. Adding the selection join in
front of it makes every already-uploaded, re-queued asset pay four queries to be rejected by the
fifth.

`hasUpload` is a pure per-asset fact, independent of selection and blocking, so it is **semantically
safe to move earlier**. Consider:

```
enabled → connected → hasUpload → selection → blocked
```

Now an already-uploaded re-queue rejects after two lookups (connected + ledger), the new selection
join runs only for genuinely-pending assets, and correctness is unchanged (an uploaded asset should
skip regardless of selection/block). At two users none of this is measurable — but the plan asked
"would you order it differently," and yes: put the cheap high-reject-rate ledger check first, not the
new join. The selection-vs-blocked ordering the plan debates is second-order.

## Q4 — yes, give it a medium test

The unit branches (subscribed → proceed, deselected → skip, one-of-two → proceed) prove the *logic*,
but they mock the repository, so they can't prove the **join filters correctly on real Postgres** —
and the membership join is *exactly* the thing this feature has gotten subtly wrong before (the entire
Wave 1.5 finding was a missing membership join). "Nearly identical to `streamPendingUploads`" is the
argument *for* a test, not against: a one-column slip in a near-copy is invisible to unit tests and to
review. Same standard that justified the stream's medium test — seed a selection, revoke membership,
assert the gate skips. It's cheap and it guards a security property. Add it.

---

## UI decisions

**Sync-now disabled-at-zero, labelled "all synced" (decision 2) — endorse.** And it's better than the
plan claims: a *failed* asset has no ledger row, so it still counts toward the album's pending
(`assetCount − uploadedCount`), which means sync-now stays *enabled* whenever there's anything to
retry. The disabled "all synced" state therefore appears only when everything is genuinely in the
ledger — so you keep the retry-failed / retry-after-unblock affordances *and* make case #2
unpressable. Disabled-with-status beats hidden here. (Confirm the label logic keys off pending, so
"all synced" never shows while failed > 0.)

**Dividers on Drive items only, not shared `MenuOption` — right instinct.** A variant prop on the
shared component is the same upstream-merge-surface widening the `onOpen` change already cost; a
Drive-local **wrapper** (composition) is cleaner than either touching `MenuOption` or duplicating it.
One mechanical note: draw dividers as separators *between* items (or suppress the last item's bottom
border) so you don't get a trailing rule under the final row.

**Non-optimistic switch — safe, but it will feel laggy.** Reverting-on-failure via re-fetch is
correct and consistent. The cost: the switch won't move until `subscribeAlbum` *and* a full
`loadGoogleDriveMenu` round trip complete — and that re-runs `getGoogleDriveAlbums`, which is the
two-correlated-subqueries-per-album endpoint. For a control users expect to be instant, that's a
visible stall. Two options if it feels sluggish: optimistic-with-revert (low risk here — the only
failure states are 400s you can roll back), or refetch just this album's counts instead of every
album. The latter is the per-album status endpoint I've recommended twice now (Wave 2 Q4, Wave 3) —
this is a third place it would pay off. Not a blocker; note the responsiveness cost.

---

## Corner-case table

The one row to re-mark is the premise behind case #3/#6 itself: it's filed as "표시와 사실이
어긋남 (card shows off, keeps uploading on-screen)," but as shown above the *card* reflects the
deselect within a poll — the mismatch is between the UI and the user's **Drive**, not within the UI.
Re-describe it that way; it makes #6 (whole-album leak) the clear centre of gravity rather than #3
(a few photos). The other ten are correctly reasoned — I checked #4 (sync-now stays hidden while off,
so decision 2's un-hiding doesn't resurrect it — verify the condition stays `driveBackedUp && …`), #9
(idempotent + eventual-consistency, fine with non-optimistic), and #11 (worker's trashed-asset skip
still catches queued jobs) and they hold.

---

## Priority

1. **Rewrite 2-C's justification** around real Drive egress + the whole-album `subscribe` queue (case
   #6) + closing the in-flight-past-unshare access window — not the on-screen card, which actually
   drops on deselect. The decision to build 2-C stands; the reasoning in the plan doesn't.
2. **Reorder the entry gates** so `hasUpload` precedes the two account/selection joins — it's the
   highest-reject-rate check under the idempotent-requeue workload the plan itself describes. The
   selection-vs-blocked placement is second-order.
3. **Add the medium test** for the gate's membership join — same standard as the stream's, and the
   join is the historically-fragile part.
4. UI: decision 2 endorsed (note it preserves retry via failed-counts-as-pending); dividers via a
   Drive-local wrapper; non-optimistic switch is fine but note the round-trip lag and that a per-album
   status endpoint would fix both it and the earlier waves' waste.

The gate is the right call and the corner-case analysis is thorough. The work is in resting the
decision on what the code actually does — the card doesn't tick after "off," the files do.
