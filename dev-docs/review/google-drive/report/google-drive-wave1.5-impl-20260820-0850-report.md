# Code Review Request — Wave 1.5 implementation

The design for this wave was reviewed before code
(`../review/google-drive-wave1.5-design-20260819-0058-review.md`); this is the implementation of
that design, with all six verdicts applied. It changes the rule deciding *whose* Drive a photo
goes to — an assumption every part of the feature has rested on since the first commit — so the
blast radius is wider than the diff suggests.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit | `cbea3384e` |
| Diff | 21 files, +1,050/−79; excluding generated artifacts: 13 files, +803/−79 |
| Design + verdicts | `dev-docs/google-drive/wave1.5-plan.md` §7 |
| Tests | 2,311 server + web suite pass; drift check clean |

## What changed

New rule: **uploads go to the Drive of whoever selected the album**, replacing "the album owner's
Drive". `google_drive_album` (userId, albumId) carries the selection; there is no `enabled`
boolean, deselect deletes the row.

- `streamPendingUploads` and the new `getSubscribers` both join **selection ⋈ connection ⋈ current
  album membership**. The membership join is the design review's mandatory item: a selection row
  deliberately outlives an unshare (so re-sharing resumes), which makes it useless on its own as
  evidence of access.
- `syncAlbum` relaxes from owner-only to *subscriber*, gated on `Permission.AlbumDownload` rather
  than `AlbumRead`.
- `addAssetsToAlbums` resolves subscribers for **all** touched albums in one query, then
  accumulates per subscriber so a user who backs up several of them gets one batched queue write.
- Migration seeds every album owned by a *connected* user, reproducing current behaviour exactly.
- New: `GET /google-drive/albums`, `PUT|DELETE /google-drive/albums/:id`, and a checkbox list in
  Settings showing per-viewer counts and the owner's name for shared albums.

## Where to attack

### 1. The membership join — did I actually close the hole everywhere?

Three paths turn a selection into an upload: `getSubscribers` (auto path), `streamPendingUploads`
(backfill, both global and the resume-scoped variant), and `subscribeAlbum` (queues immediately).
The first two join `album_user`. The third relies on `requireAccess(AlbumDownload)` at the moment
of the call.

**Question:** is there a fourth path I've missed, and is the `subscribeAlbum` snapshot acceptable
(access checked at enqueue, not at execution)? The worker itself does *not* re-check membership.

### 2. Deselect does not cancel queued jobs — still the accepted trade?

The design review accepted this, noting the re-check would be a join rather than a PK lookup. But
Wave 1.5 makes selection *the* meaning of "back this up", so "off" arguably promises more now than
it did when that was decided. Worth re-judging with the implementation in front of you.

### 3. `queueGoogleDriveUploadsForAlbums` passes `enabled: true` hardcoded

It checks `isGoogleDriveEnabled()` once at the top and then passes `true` per subscriber, to avoid
re-reading cached config in a loop. Same pattern as `syncAlbum`. Correct, but it is the kind of
literal that rots if someone reorders the guard — same concern a previous review raised about
`syncAlbum` and accepted there.

### 4. Counts flipped from owner-axis to viewer-axis

`getSubscribableAlbums` counts `uploadedCount` against the *authenticated user's* ledger. The
roadmap review had endorsed owner-based counts (with a label); the Wave 1.5 design review revised
that to viewer-based. Confirm the subquery shape is right — particularly that trashed assets are
excluded from both `assetCount` and `uploadedCount`, which is the asymmetry that produced a
negative `pending` in an earlier round.

### 5. Seeding correctness on instances unlike this one

Verified on production data (two rows, exactly today's uploading set). The migration reads
`user_google_drive` so unconnected owners seed nothing. **Question:** any instance shape where
this seeds something surprising — e.g. an album owned by a connected user who never wanted it
backed up? (That is already today's behaviour, so it preserves rather than introduces the
surprise, but worth a second opinion.)

### 6. SQL boolean normalisation

`isOwner`/`subscribed` come back as Kysely `SqlBool` (`number | boolean`) and are coerced with
`!!` in the service. Test covers `1`/`0`. Is there a cleaner idiom in this codebase I've missed?

## Verified

`tsc --noEmit` and `eslint --max-warnings 0` clean on server and web · 2,311 server tests pass
(9 new/rewritten for the axis change) · web suite passes · `svelte-check` reports the same 7
pre-existing errors in unrelated spec files · OpenAPI/SDK/SQL regenerated · `sql-tools migrations
generate` reports no drift · migration applied to the dev database and seeded 2 rows as predicted.

**Not verified:** no deployment yet, so the axis change has never run against production data.
The unshare-stops-uploads path is covered only by the SQL shape, not by an integration test —
there is no medium test for `streamPendingUploads`.
