# Design Review Request #4 — Wave 1.5: Album-Selection Backup Model

A **design** review, before any code. This wave changes the rule that decides *whose* Drive a
photo goes to — the one assumption every part of the feature has been built on since the first
commit. Getting it wrong means either silently stopping uploads on a live instance or uploading
photos the user explicitly said must never leave.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Plan document | `dev-docs/google-drive/wave1.5-plan.md` (this request adds evidence, edge analysis, and the questions) |
| Prior rounds | requests/reports 1–3; `dev-docs/review/google-drive/review/google-drive-wave1-20260815-2255-review.md` (Wave 1, fixes applied in `881969414`) |
| Code under discussion | none yet — `album.service.ts:209-214, 250-305`, `google-drive.service.ts:840-856`, `google-drive.repository.ts#streamPendingUploads` |
| Live instance | 6,578 photos, 4 albums, 2 users, 1 connected Drive account |

---

## 1. Why this wave exists — evidence from the live instance

Wave 1 shipped and works (verified live: classification → error rows → block → banner →
notification → backfill exclusion → auto-clear on folder re-pick). Running it in production
immediately exposed that the *targeting* model, untouched since the beginning, cannot express
what this deployment actually needs.

The rule today is hardcoded in three places: uploads go to the **album owner's** Drive
(`album.service.ts` `getAlbumOwnerId`; `google-drive.service.ts:850` owner-only `syncAlbum`;
`streamPendingUploads`'s `album_user.role = 'owner'` join).

Actual state and desired state:

| Album | Owner | Photos | Not yet uploaded | Today | Wanted |
|---|---|---:|---:|---|---|
| 건우카메라 | gunwoo | 4,662 | 5 | → gunwoo's Drive | unchanged |
| 서희카메라 | seohui | 1,843 | 1,826 | **nothing happens** | **→ gunwoo's Drive** |
| 인화사진 | seohui | 63 | 46 | nothing happens | **never upload (explicitly)** |
| test | gunwoo | 7 | 2 | → gunwoo's Drive | stop |

**1,826 photos had been sitting as "pending" for weeks.** Not quota, not failure — the owning
account (seohui) has simply never connected a Drive, and uploads can only target the owner. The
user assumed they were queued behind something; nothing was ever going to happen.

There is also no way to say "never back this one up" — 인화사진 is family scans the user does not
want in the transit folder, and today the only thing preventing that is seohui staying
disconnected. If seohui ever connects, 46 photos leave without anyone deciding that.

Structural reason this isn't a one-off: the pipeline funnels Drive → **one** Pixel → Google
Photos (roadmap §0). One device, therefore one account, therefore the account that collects must
be able to collect albums it does not own.

## 2. The proposed rule

> **Uploads go to the Drive of whoever selected the album.**

- You may select any album **you can see** (own or shared with you).
- Uploads always land in **your own** configured folder.
- Two people selecting the same album → it goes to both Drives, independently. The ledger is
  `(userId, assetId)`, so per-user dedup already works without change.

### Why not the alternative

The rejected design was "the album owner designates a target account" (owner of 서희카메라 says
"send this to gunwoo"). It creates a path that **writes into another person's Drive without that
person's involvement** — their storage consumed, their quota, their trash. The selection model
never does: everything you can cause is scoped to your own account and your own visibility.

Notably this also *strengthens* the security property Wave 0 established. `syncAlbum` is owner-only
today specifically so a shared-album editor cannot push files into the owner's personal Drive
(`google-drive.service.ts:852`). Under the new model that attack cannot be expressed at all —
uploads only ever reach the caller's own Drive — so the restriction can relax without losing the
property it was protecting.

## 3. Schema and the migration

```
google_drive_album
  userId    uuid  FK user  ON DELETE CASCADE  ┐ PK (userId, albumId)
  albumId   uuid  FK album ON DELETE CASCADE  ┘
  createdAt timestamptz NOT NULL default now()
```

Row present = "back this album up to my Drive". No boolean column — deselect is a delete. Both FKs
cascade, so deleting a user or an album disposes of the selections.

### Seeding (decision already taken: preserve current behaviour)

```sql
insert into google_drive_album ("userId", "albumId")
select au."userId", au."albumId"
from album_user au
join user_google_drive ugd on ugd."userId" = au."userId"
where au.role = 'owner';
```

**Verified against the live database (read-only) — this produces exactly two rows:**

| user | album | photos |
|---|---|---:|
| gunwoo87 | 건우카메라 | 4,662 |
| gunwoo87 | test | 7 |

Which is precisely today's behaviour: gunwoo's two owned albums upload, seohui's two do nothing.
**Upload behaviour after migration is bit-for-bit identical to before it.** The user then adds
서희카메라 and removes test through the UI.

The rejected alternative (seed nothing, everyone opts in) would silently stop 건우카메라's
automatic uploads at deploy time, with no error and no notification — the failure mode this whole
project has been fighting.

## 4. Code changes

### 4.1 Queueing: one owner → N selectors

`album.service.ts:209-214` (`addAssets`) resolves a single owner. `addAssetsToAlbums:250-305`
accumulates a `Map<ownerId, Set<assetId>>` across albums, then queues once per owner.

Both change axis: for each touched album, find every user who **selected it and is connected**,
and accumulate per that user. `addAssetsToAlbums`'s map becomes `Map<selectorId, Set<assetId>>` —
same shape, different key source. The "connected" half of the filter mirrors the principle
already settled in Wave 1's autoSync discussion: don't enqueue jobs the worker will only skip.

`getAlbumOwnerId` stays — `syncAlbum` still needs to know the owner for other reasons, and it is
the ownership *of the album*, not of the backup, that it reports.

### 4.2 Backfill: swap the join

`streamPendingUploads` replaces `album_user.role = 'owner'` with a join through
`google_drive_album`. Everything else is untouched: soft-delete filters, the ledger anti-join, and
Wave 1's blocked-user anti-join all keep working unchanged.

### 4.3 `syncAlbum`: owner-only → selector

- Permission: `Permission.AlbumRead` (already checked at line 840) **plus** having selected it.
- Target: `auth.user.id` instead of the owner.
- Not selected → 400 with "add this album to your backups first" rather than a silent no-op.

### 4.4 API

```
GET    /google-drive/albums       list visible albums + selected flag + counts
PUT    /google-drive/albums/:id   select    (AlbumRead checked)
DELETE /google-drive/albums/:id   deselect
```

`PUT` also queues that album's pending set immediately — same reasoning as Wave 1's resume
endpoint (gap C from the roadmap review): turning something on and having nothing happen until an
unrelated future trigger is not what the button appears to promise.

### 4.5 UI

Settings gains a selection list; shared albums show the owner's name so "I am backing up someone
else's album into my Drive" is visible rather than implied:

```
백업할 앨범
  ☑ 건우카메라           4,662 · 4,655 uploaded
  ☑ 서희카메라 (서희)     1,843 · pending
  ☐ 인화사진 (서희)          63
  ☐ test                    7 · 5 uploaded
```

## 5. Edge cases already considered

| Case | Behaviour | Note |
|---|---|---|
| Album shared with me, then unshared | Selection row remains; backfill's `AlbumRead` no longer holds | **Needs a decision — see Q6** |
| Both users select the same album | Uploads to both Drives, independent ledgers | Intended |
| Selector not connected | Not queued (filter), no error row | Matches Wave 1 principle |
| Selector blocked (quota/folder) | Wave 1 anti-join + entry gate still apply, unchanged | Orthogonal |
| Deselect while jobs are queued | Queued jobs still run (worker checks ledger + connection, not selection) | **Q2** |
| Album deleted | Selection cascades away | FK |
| Asset removed from album then re-added | Ledger prevents re-upload | Unchanged |
| Same asset in two selected albums | One job (ledger + `jobId` dedup) | Unchanged |

## 6. What is *not* in this wave

Deliberately deferred so the axis change lands alone: the album dropdown and storage gauge
(Wave 2), progress UI (Wave 3), selection-based ad-hoc upload of individual photos (Wave 4).
Wave 4's account-level `autoSync` toggle probably dissolves into this — noted for re-evaluation
rather than removed.

## 7. Questions

1. **Seeding strategy.** Preserving current behaviour by marking connected users' owned albums as
   selected — verified above to produce exactly the current behaviour on live data. Is there a
   safer formulation, or a case where this seeds something surprising on an instance unlike this
   one (e.g. a connected user owning hundreds of albums they never wanted backed up — though that
   is already what happens today)?
2. **Deselect does not cancel queued jobs.** Pressing "off" can still let a handful of photos
   land, since the worker validates ledger and connection but not selection. Acceptable, or should
   the worker re-check selection at entry (one indexed lookup per job, on top of Wave 1's blocking
   lookup)? The UX reading of "off" arguably demands the check.
3. **Cost of N-selector resolution.** One indexed query per touched album per add-to-album,
   replacing one owner lookup. Same order, but confirm nothing pathological when an album is
   selected by many users.
4. **`syncAlbum` permission bar.** `AlbumRead` + selected. The Wave 4 review asked that
   selection-based *asset* upload gate on the real download permission, since copying someone's
   photo into your own Google account is data egress. Does the same bar apply here — should
   selecting an album require download rights on it, not just read?
5. **Wave 2's status axis.** Roadmap §3.1 defined album `uploaded` counts as owner-based, and the
   roadmap review explicitly endorsed that (Q5) with the recommendation to label it "backed up to
   [owner]'s Drive". After this wave the honest axis is the *viewer's* — same album shows
   different counts to different people, correctly. Any consequence I am missing in flipping a
   definition a previous review signed off on?
6. **Unshared-but-still-selected.** If seohui stops sharing 서희카메라, gunwoo's selection row
   survives but they can no longer read the album. Should the backfill silently skip it (join
   through current permissions), should the selection be cleaned up eagerly on unshare, or should
   it surface as a failure the user can see? Leaning toward "join through permissions so it stops,
   and show it as unselectable in the UI" — but it means backups can stop with no notification,
   which is the pattern this project keeps trying to eliminate.

## 8. Verification done for this request

The seeding query was executed read-only against the production database and its output is
reproduced in §3. Album ownership, membership roles, per-album pending counts, and the connected
account were all read from live data rather than assumed. No writes were performed. The 인화사진
and 서희카메라 upload constraints stated by the user are recorded here so the reviewer can check
the design actually satisfies them.
