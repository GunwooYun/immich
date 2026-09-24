# Review request — wave10d: failures scoped to albums you can still act on (deploy gate)

**Commits:** `58039033a` (fix) + evidence · **Previous:** wave10c review — NOT BLOCKED, M1 + N1–N3
**Diff:** `git diff 1934bf56b HEAD -- server` (skip generated except `src/queries`, which changed and should be checked)
**Deploy gate:** the next production image is built from this. State deploy fitness explicitly.

**M1 fix.** `getFailures` and `getErrorSummary` now require the asset to be in an album the reader has selected (`google_drive_album`), still has membership of (`album_user`), and that is not soft-deleted — the same shape `streamPendingUploads` uses. Rows are hidden, not deleted, so re-sharing or re-selecting brings the failure back.

**Fixtures.** Seven medium tests built an error row with no album at all, which production cannot produce. They now build a selected album. Two new medium tests pin the predicate (unselected / unshared), each asserting list *and* count with a witness in the same test. N1 (DTO grammar) and N3 (comment on the inner join) also done.

**Mutations:** removing the predicate from `getFailures` → both new tests fail; same for `getErrorSummary`. (Run by the fixture author and re-run by me via the suite.)

**Evidence:** `results/` newest at `58039033a`: server 316, web 87, **medium 65**, PASS. `mise //server:ci-unit` 2442 / 2 skipped; `mise //web:ci-unit` 603 / 2 skipped, svelte-check 0.

**Attack:**
1. **The predicate itself.** Does `exists(album_asset ⋈ album ⋈ google_drive_album ⋈ album_user)` correlate on the right columns (`album_asset.assetId` = error's assetId, `google_drive_album.userId` = error's userId)? Any way it matches through a *different* user's selection?
2. **Cost.** Two correlated `exists` subqueries now run per error row (one in each query). On an account with hundreds of failures across large albums, is this acceptable, or should it be a join?
3. **Behaviour change.** A user who unselects an album now sees their failure count drop without anything being fixed. Is that the right story, or should those be counted somewhere ("N failures in albums you no longer back up")?
4. **Generated SQL** for both blocks — compile and compare; check the `getErrorSummary` block still contains both of its statements in the right order.
5. Deploy fitness of `v3.1.0..HEAD` vs the running image (`3cabbb496`): any change to queueing, the worker, or adoption?

**Not verified:** browser; the live instance has zero failures now, so none of this is visible there.
