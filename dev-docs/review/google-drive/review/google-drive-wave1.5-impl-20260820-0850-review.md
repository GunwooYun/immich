# Code Review — Wave 1.5 implementation (album-selection backup)

Review of commit `cbea3384e`, the implementation of the Wave 1.5 design
(`../review/google-drive-wave1.5-design-20260819-0058-review.md`). Verified against the actual SQL
joins, the four upload-triggering paths, the count subqueries, and the migration seed.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit | `cbea3384e` |
| Reviewed | 2026-08-20 |
| Report | `../report/google-drive-wave1.5-impl-20260820-0850-report.md` |

## Verdict

**The core is correct and the mandatory design-review item — the access join — is genuinely done
at every upload path.** The seed reproduces current behaviour, the count axis flip is right and
free of the negative-pending trap, and `AlbumDownload` is applied where it matters. One real bug
(`unsubscribe` requires access it shouldn't), and one **half-built design-review item**: the
unshare case stops uploads correctly but does so *silently* — the exact failure mode this wave
exists to kill. Fix those two before deploy; everything else is accept/minor.

---

## Q1 — Membership join: yes, closed everywhere (verified)

I enumerated every path that turns a selection into an upload and confirmed each re-establishes
access:

| Path | Access re-check | OK |
|---|---|---|
| `getSubscribers` (auto add-to-album) | inner-joins `album_user` on `(albumId, userId)` ([repo.ts:114](../../../../server/src/repositories/google-drive.repository.ts#L114)) | ✅ |
| `streamPendingUploads` (backfill **and** resume-scoped) | inner-joins `album_user`; blocked-user + ledger anti-joins rekeyed to `google_drive_album.userId` ([repo.ts:242](../../../../server/src/repositories/google-drive.repository.ts#L242)) | ✅ |
| `subscribeAlbum` (immediate queue) | `requireAccess(AlbumDownload)` at call | ✅ snapshot |
| `syncAlbum` | `requireAccess(AlbumDownload)` **+** `isSubscribed` | ✅ |

I grepped all callers of `queueGoogleDriveUploads`/`streamPendingUploads` — there is **no fifth
path**, and the worker (`uploadAsset`) is the only consumer that doesn't re-check, which is fine:

**The snapshot is acceptable under "authorized at enqueue."** A job queued while access existed may
finish draining after access is revoked, but the caller was entitled to those bytes at the moment
the work was authorized — the same boundary as "you downloaded it while you could." The membership
join stops all *new* authorization. So `subscribeAlbum`/`syncAlbum` snapshotting access is correct.
Good.

One thing to write down as a **coupling assumption**: the ongoing paths gate on `album_user`
*membership*, while the entry points gate on `AlbumDownload`. Today those coincide (an album member
can always download; per-member download restriction is a shared-*link* feature, not an
`album_user` one). If immich ever adds a member-level "view but not download" share, the membership
join would no longer imply download rights and these paths would need to re-check `AlbumDownload`,
not just membership. Note it next to the join so the assumption is visible if that day comes.

---

## 🔴 The unshare case is correct but silent — the design review's Q6 is only half-implemented

The design review's Q6 verdict was three parts: **(a) join through access [mandatory], (b) surface
"access lost" in the list, (c) notify once.** Only (a) shipped. When seohui unshares an album gunwoo
backs up:

- Uploads stop — membership join ✅ (the correctness half, done well).
- `getSubscribableAlbums` inner-joins `album_user.userId = viewer` ([repo.ts:168](../../../../server/src/repositories/google-drive.repository.ts#L168)), so a now-non-member album **vanishes from the list** — no "access lost" row.
- No notification.
- gunwoo's stale `google_drive_album` row lingers, invisible, until FK cascade.

That is *precisely* the "1,826 photos silently pending, nothing in any log" pattern that motivated
this whole wave — recreated at the unshare boundary. A backup that gunwoo deliberately turned on
stops with no trace. It isn't a security hole (uploads correctly stop), but it violates the
project's stated north star.

**Fix:** surface it. `getSubscribableAlbums` should also return rows where a selection exists but
membership is gone — e.g. `LEFT JOIN` from `google_drive_album` for the user and flag
`accessLost: true` — so the UI can show "access lost — remove?" And fire the one-per-transition
notification the Wave 1 machinery already provides. Even just (b) closes the silence.

## 🔴 `unsubscribeAlbum` requires `AlbumRead` it shouldn't — you can't remove your own stale selection

[google-drive.service.ts:506](../../../../server/src/services/google-drive.service.ts#L506):
`unsubscribeAlbum` calls `requireAccess({ permission: AlbumRead, ids: [albumId] })` before deleting
the caller's own `(userId, albumId)` row. The delete is already self-scoped to `auth.user.id`, so
the access check adds no safety — but it adds a **failure**: once gunwoo loses access to a
shared album (the exact case above), `requireAccess(AlbumRead)` throws, so he can no longer delete
his own dangling selection through the API. Combined with the silent-disappearance bug, the row is
both invisible and unremovable.

Stopping your own backup preference should never depend on still being able to see the album.
**Drop the `requireAccess` entirely** (the delete only ever touches the caller's own row — it is
inherently safe), or replace it with a trivial existence check. This also makes the "access lost →
remove" UI actionable.

---

## Q2 — Deselect doesn't cancel queued jobs: accept, but the window isn't "a handful"

The trade is fine (authorized-at-enqueue again), but one correction to the framing. The comment
calls the window "only ever 'selected then immediately unselected'" and small — yet `subscribeAlbum`
**immediately queues the entire album** ([service.ts:852](../../../../server/src/services/google-drive.service.ts#L852)). So subscribe-then-quick-unsubscribe can still upload the *whole* album (minus
ledger-filtered), not a handful. Still defensible — the user did subscribe — but don't lean on "tiny
window" as the justification; the honest justification is "you authorized it when you turned it on."
The hard "never upload 인화사진" guarantee is unaffected: never subscribed ⇒ never queued.

Worker re-check still not worth it (it's the join, not a PK lookup, as the design review noted).

## Q3 — `enabled: true` hardcode: accept

`queueGoogleDriveUploadsForAlbums` checks `isGoogleDriveEnabled()` once and passes `true` per
subscriber ([album.service.ts:387](../../../../server/src/services/album.service.ts#L387)); same
guarded-literal pattern accepted for `syncAlbum` in a prior round. Consistent and commented. Fine.

## Q4 — Viewer-axis counts: correct, negative-pending trap avoided (verified)

Both subqueries apply `asset.deletedAt is null` — `assetCount` over `album_asset ⋈ asset`,
`uploadedCount` over the same plus `google_drive_upload` on `(assetId, userId=viewer)`
([repo.ts:181-205](../../../../server/src/repositories/google-drive.repository.ts#L181)).
`uploadedCount` is a strict subset of `assetCount` (same album, same soft-delete filter, plus a
ledger row), so `pending = assetCount − uploadedCount ≥ 0` always. The asymmetry that produced a
negative pending in an earlier round is genuinely gone. Join cardinality is 1:1 on both
(`album_asset` unique per `(album, asset)`, ledger PK `(userId, assetId)`), so no double-count.

Semantics note (correct, worth stating): an asset in two of the viewer's albums, uploaded via
either, counts as uploaded in *both* — because the ledger is per-asset. "How many of this album's
photos are in your Drive" is the right reading, so this is intended.

Minor: the endpoint runs two correlated subqueries per album row. Fine for a settings list bounded
by albums-you're-a-member-of; not a hot path.

## Q5 — Seeding: correct against the actual migration SQL (verified)

The seed is `INSERT … SELECT au.userId, au.albumId FROM album_user au JOIN user_google_drive ugd ON
ugd.userId = au.userId WHERE au.role = 'owner'`
([migration:34-40](../../../../server/src/schema/migrations/1786900000000-CreateGoogleDriveAlbumTable.ts#L34)).
It seeds **only** connected users' owned albums, so it can never newly-enable a shared album or a
disconnected owner — it preserves today's set exactly (2 rows live). No dedup needed (fresh table,
one owner row per album). The "connected user owns albums they never wanted backed up" case is
today's behaviour preserved, not a new surprise. Safe as written. (§ test list already asserts
post-migration behaviour equivalence — keep that assertion.)

## Q6 — `!!` on `SqlBool`: fine

`!!row.isOwner` / `!!row.subscribed` is idiomatic in this codebase for the `number | boolean` Kysely
returns, it's normalised at the one mapping boundary, and the test covers `1`/`0`. No cleaner idiom
worth the churn. Accept.

---

## Smaller notes

- **Deployment precondition:** for gunwoo to back up 서희카메라 he must be an `album_user` member of
  it (the seed won't add it — he's not the owner — and `subscribeAlbum` `requireAccess(AlbumDownload)`
  will 403 if it isn't shared with him). Confirm 서희카메라 is actually shared with gunwoo before
  expecting the UI subscribe to work; otherwise the button returns 400/403, which would look like a
  regression.
- **`getSubscribableAlbums` owner join** inner-joins `album_user as owner_user (role='owner')`; an
  album with no owner row would drop out of the list. Can't happen in normal immich data, just
  flagging the inner-join assumption.
- **Verification gap the report names is the right one:** `streamPendingUploads`' unshare-stop is
  covered only by SQL shape, no medium/integration test. Given it's now a correctness boundary
  (feeding copies of a lost-access album), a medium test that seeds a selection, revokes membership,
  and asserts the stream yields nothing would be worth more than any of the unit tests here.

---

## Priority

1. **Surface the unshare case** (design-review Q6 parts b/c) — return access-lost selections in the
   list and/or notify once. It's the project's own anti-pattern otherwise.
2. **Fix `unsubscribeAlbum`'s `requireAccess(AlbumRead)`** — drop it (self-scoped delete); otherwise
   a user can't remove a selection for an album they've lost access to, compounding #1.
3. Add the medium test for unshare-stops-uploads before trusting it live.
4. Accept as-is: Q1 join (closed everywhere), Q3 hardcode, Q4 counts, Q5 seed, Q6 coercion. Note the
   membership-implies-download coupling assumption next to the joins, and correct the Q2 "small
   window" framing (subscribe front-loads the whole album).

The axis change is well-executed and the mandatory access join is correct at every path — the
outstanding work is making the one case where uploads *stop* as visible as this feature has spent
five rounds making the cases where they fail.
