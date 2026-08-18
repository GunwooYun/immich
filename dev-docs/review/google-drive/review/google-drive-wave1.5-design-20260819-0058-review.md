# Design Review — Wave 1.5: Album-Selection Backup Model

Design review of `dev-docs/review/google-drive/report/google-drive-wave1.5-design-20260819-0028-report.md` + `dev-docs/google-drive/wave1.5-plan.md`, before code.
Verified against the actual targeting sites (`album.service.ts` queueing paths, `syncAlbum`,
`streamPendingUploads`) and immich's permission enum.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Reviewed | 2026-08-19 |
| Prior | `dev-docs/review/google-drive/review/google-drive-wave1-20260815-2255-review.md` (Wave 1, fixes in `881969414`) |

## Verdict

**The model is the right call — adopt it.** Selection-based, own-Drive-only, positive allow-list:
it solves both live requirements (서희카메라 → gunwoo, 인화사진 never), and the "only ever writes
to the caller's own Drive" property genuinely subsumes Wave 0's owner-only restriction. The seeding
is behavior-preserving and was verified read-only against production.

Three things must be settled before it's safe, and one of them (the permission join, your Q6) is
**not the optional judgment call the plan frames it as** — it's a correctness requirement, because
of a detail in your own schema. Details below, then all six questions answered.

---

## The one that isn't optional: enforce access at read time (Q6)

`google_drive_album` FKs to `album` and `user` **independently** — deliberately, and correctly (so
a selection survives an unshare→reshare without the user re-picking). The consequence is that a
selection row can outlive the sharing relationship that justified it. So **every path that turns a
selection into an upload must re-check live access at that moment** — not just the backfill.

The plan (§4.1/§4.2) describes `getSubscribers` and the new `streamPendingUploads` as joining
`google_drive_album` ⋈ `user_google_drive`. If that's the whole join, you have reintroduced —
relocated in time — the exact hazard the selection model was designed to kill:

- seohui unshares 서희카메라. gunwoo's selection row survives. The backfill still streams those
  assets and uploads them to gunwoo's Drive. gunwoo is now egressing an album he can no longer open.
- Same in the auto path: seohui adds a photo to her album; `getSubscribers` still returns gunwoo;
  it lands in gunwoo's Drive.

This means §2's "this *strengthens* the security property" is true **only if** the access join is
present. Without it, you've traded "editor pushes into owner's Drive" for "user retains a live copy
feed of an album after losing access" — arguably worse, because it's silent and ongoing.

**So Q6's "should the backfill skip it" is already answered by correctness: yes, join through
current membership** (`album_user` on `(albumId, userId)`) in both `getSubscribers` and
`streamPendingUploads`. That's the SQL-level proxy for "can still see it," and it makes unshare stop
uploads automatically. The row stays (so re-share resumes), but it produces no jobs while access is
gone.

The *real* open question underneath Q6 is only the UX: a backup stopping silently is the pattern
this project keeps fighting. Recommendation:

- **Keep the row, join through access** (mandatory, above).
- **Surface it in the selection list** as "access lost — [owner] stopped sharing this album," not a
  silent disappearance.
- **Notify once** on the transition to inaccessible, reusing Wave 1's one-per-transition discipline.

Prefer this over eager cleanup-on-unshare: deleting the row means a later re-share silently fails to
resume, and you'd need an unshare event hook you don't otherwise need.

---

## The conceptual gap the questions miss: selection is album-scoped, upload is asset-scoped

This is the most important thing in the review and it isn't among your six questions.

Dedup and upload are purely `(userId, assetId)` — no album dimension (ledger PK, `jobId`,
`streamPendingUploads` `distinct` all drop the album). So an asset uploads for a user if it sits in
**any** album that user has selected. "Never back up 인화사진" is therefore not "never upload these
photos" — it's "don't upload them *on account of this album*." **If any 인화사진 asset is also in a
selected album (건우카메라, 서희카메라), it will upload anyway**, and nothing in the model expresses
a deny.

For the stated data this is probably fine (scans are likely only in 인화사진), but the user's
requirement was phrased as a hard "never leave," so:

1. **Verify there's no overlap on the live instance** before trusting non-selection as the guard —
   one read query:
   ```sql
   select a.assetId
   from album_asset a
   join album_asset b on a.assetId = b.assetId
   where a.albumId = '<인화사진>' and b.albumId in ('<건우카메라>','<서희카메라>','<test>');
   ```
   Empty = the album-scoped guarantee holds today.
2. **Document the semantic** explicitly in the plan and the UI ("an unselected album's photos can
   still be backed up if they're also in a selected album"). If a true per-asset "never" is ever
   needed, that's a deny-list feature, out of scope here — but the user should decide that knowing
   the current guarantee is allow-only.

---

## Q4 — `syncAlbum`/select permission bar: require **download**, not read

Grounded, not stylistic: immich has `Permission.AlbumDownload` (`enum.ts:144`) and
`Permission.AssetDownload` (`:129`) as first-class permissions distinct from `AlbumRead`. The Wave 4
review already established that copying someone's photo into *your own* Google account is data
egress and must gate on download rights. The same bar applies here, and it's exactly what makes
"back up any album you can *see*" safe:

- A viewer with read-but-not-download rights on a shared album could, under "AlbumRead + selected,"
  egress the whole album into their personal Google. That's the boundary `AlbumDownload` exists to
  hold.
- So: `PUT /google-drive/albums/:id` and `syncAlbum` should check `Permission.AlbumDownload` (and
  the stream/subscriber access-join should be the download-capable relationship, not bare
  membership, wherever those differ).

This costs nothing extra — it's the same `requireAccess` call with a stronger permission — and it
future-proofs against restricted-share modes. Change "AlbumRead" to "AlbumDownload" everywhere the
plan currently says read.

---

## Q1 — Seeding: safe, keep it

"Connected users' owned albums → selected" is behavior-preserving and I can't find a formulation
that's safer for the stated goal. Cross-instance check: it seeds **only** `role='owner'` albums of
**connected** users, so it can never newly-enable a shared album or a disconnected user — the only
albums it marks are the ones already auto-uploading today. The "connected user owns hundreds of
albums" case seeds all of them, but as you note that's *already* today's behavior, so it's not a new
surprise; it's the faithful preservation of an existing one. The rejected "opt-in from empty" would
silently stop 건우카메라 — correctly ruled out. No change.

One nit: the seed is fine as written, but assert it in a test as "post-migration, the subscriber set
equals the old owner-connected set" (§6 already lists this) so a future schema tweak can't drift the
seed away from behavior-preservation silently.

---

## Q2 — Deselect doesn't cancel queued jobs: acceptable, with a caveat on the cost claim

The leak window is small and bounded (only assets already queued for an album you *just* chose to
back up and then immediately unchose), and it can't touch the hard case — 인화사진 is never selected,
so nothing is ever queued for it. So I'd accept not cancelling.

Two corrections to the framing, though:

- The proposed worker re-check is **not "one indexed lookup"** like Wave 1's blocking gate. Jobs are
  keyed `(userId, assetId)`; selection is per-album. So "is this still selected" = "does this user
  have a selected, still-accessible album containing this asset" — a join across
  `album_asset → google_drive_album → album_user`, the same predicate as the pending stream, not a
  PK get. Cheap at this scale, but don't cost it as a PK lookup.
- If you *do* add it (for "off means off" honesty), it composes correctly with the multi-album
  semantic above: an asset in a selected *and* a deselected album still uploads, because the re-check
  asks "any selected album," which is the right answer.

My lean: **skip the re-check**; rely on never-selected for the hard guarantee and accept the tiny
window for the soft case. Revisit only if the re-check predicate is already being written for the
status endpoint anyway (then reuse is free).

---

## Q3 — N-selector cost: fine, but it's 0→1 query, not 1→1

Same order, no pathology at any realistic selector count (bounded by *connected* selectors). One
precise correction: today's `getAlbumOwnerId(album)` reads from `album.albumUsers` **already loaded
in memory** — zero extra queries. `getSubscribers(albumId)` is a **new DB round trip** per touched
album. So it's "0 → 1 query per add-to-album," not "1 → 1." Immaterial here; just don't let the "same
as today" framing hide that add-to-album gains a query it didn't have. Batch it if
`addAssetsToAlbums` touches many albums (one `IN (albumIds)` subscriber query, grouped in memory)
rather than one query per album in the loop.

---

## Q5 — Status axis owner→viewer: correct, and it *improves* consistency

Flipping album `uploaded` counts to the viewer's axis is right under this model, and there's an
upside the plan doesn't claim: Wave 1's `getStatus` already reports `failedCount`/`blockedReason` on
a **per-user (account) axis**. Owner-based album counts were the odd one out; viewer-based makes the
whole surface consistently "about *me* and *my* Drive." My prior roadmap-review Q5 endorsed
owner-based *with a label* — I'm revising that: under Wave 1.5 the viewer axis is the honest one, and
the label need only clarify shared albums ("backed up to *your* Drive"). Update roadmap §3.1 and that
Q5 note (the plan already says it will).

Two implications to handle in Wave 2, not now:

- **Selected-but-not-yet / visible-but-unselected**: the per-viewer status must express "you can see
  this, you haven't selected it" (count = total, uploaded-by-you = 0, state = not-selected), distinct
  from "selected, pending." The selection list UI in §4.5 already implies this; just make the status
  endpoint return it rather than 0/0.
- The count query is now per-authed-user (their ledger, their selection, their access) — same
  access-join as everything else here.

---

## Smaller notes

- **PUT-immediate-queue and `syncAlbum` snapshot access at enqueue time**; if access is lost between
  enqueue and execution, the worker (Q2) won't recheck. Bounded and minor — the access-join on the
  *backfill/auto* path is what matters — but worth one line acknowledging the interactive paths queue
  a snapshot.
- **Wave 4 `autoSync` almost certainly dissolves into this** (§6) — agreed; per-album selection *is*
  the granular version of an account toggle. When you re-evaluate, "disconnect" already stops
  everything (no credentials), so the only thing a global toggle would add is "connected but pause
  all," which a "select none" or a single pause flag covers. Likely deletable.
- **Migration ordering**: same dev-history `allowUnorderedMigrations` caveat as Wave 1's table will
  apply; production runs in file order. Not a design issue, just don't forget the new migration
  inherits it.

---

## Priority

1. **Access-join at read time (Q6) — mandatory, not optional.** Without it the model silently
   egresses albums you've lost access to, negating its own security premise. Plus the UX layer
   (surface "access lost" + notify once) so it isn't a silent stop.
2. **Gate on `AlbumDownload`, not `AlbumRead` (Q4).** Same call, stronger permission; it's what makes
   "back up any album you can see" safe against download-restricted shares.
3. **Resolve the album-scoped-vs-asset-scoped semantic.** Verify no 인화사진 overlap on live data, and
   document that "never" is album-scoped selection with asset-scoped effect.
4. Seeding (Q1) safe as-is; N-selector (Q3) fine (note 0→1 query, batch the multi-album case);
   deselect leak (Q2) acceptable (note the re-check is a join, not a lookup); status axis (Q5) correct
   and consistency-improving.

The model is sound and solves the real problem the live instance exposed. The gap between "select an
album" and "who can still see it" is the whole review — close it in SQL at every read path and the
rest is refinement.
