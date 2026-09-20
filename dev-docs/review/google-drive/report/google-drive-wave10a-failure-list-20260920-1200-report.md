# Review request — wave10a: failure list + retry

**Commits:** `1b15f7314` (feature) + evidence commit after it. Also folds in `5d84f252e` (wave9h fix, already reviewed NOT BLOCKED).
**Diff:** `git diff 5a8bc8a8f HEAD -- server/src web/src i18n` (skip generated: open-api, packages/sdk, mobile/openapi)

## What and why
A failure was only ever a number on the settings page. Now:
- `GET /google-drive/me/failures` → `{ failures: [{assetId, fileName, error, detail, attempts, lastFailedAt}], total }`, newest first, capped at 200. Same predicates as `getErrorSummary` (ledger row wins over stale error row; trashed assets excluded) so list and count agree.
- `POST /google-drive/me/failures/retry` `{assetIds}` → clears those error rows (or every class when the list is empty) then calls `queuePendingUploads(userId)`.
- Settings page: "Show failures" toggle (lazy load), per-row retry, "Retry all", "Showing N of M", shown for blocked accounts too.

**The load-bearing decision:** retry clears rows and re-runs the *pending query* rather than queueing the ids it was handed. An error row outlives the album selection that created it; queueing from the error table would upload a photo out of an album the user has since unselected. `streamPendingUploads` is the only place that checks selection.

## Mutations
| Mutation | Result |
|---|---|
| retry queues the given ids directly | 2 service tests fail |
| retry-all clears only blocking classes | 1 service test fails |
| failures fetched on mount instead of on open | 2 settings tests fail |

## Evidence
`dev-test/google-drive/results/` newest — `1b15f7314`, clean: server 314, web 84, svelte-check no regressions, PASS. `mise //server:ci-unit` 2440 passed / 2 skipped; `mise //web:ci-unit` 600 passed / 2 skipped.

## Please attack
1. **Retry semantics.** Is clearing *every* class on retry-all right, or should `revoked` be excluded (the user cannot fix it by retrying, and clearing it may hide why uploads stopped)? What happens if retry-all runs while the account is revoked?
2. **`getFailures` cap.** 200 rows with `originalFileName` joined — cost on an account with thousands of failures? Is `lastFailedAt desc` indexed, or is this a sort over the whole error table?
3. **Consistency.** Can the list and the count disagree (they are two queries, one round trip apart)? Is that visible to the user in a confusing way?
4. **Authorization.** `getFailures` returns file names for assets the caller owns rows for — any path where an error row exists for an asset the caller can no longer see?
5. **Generated SQL.** `getFailures` is `@GenerateSql`; I did not regenerate (the dev DB predates this branch's migrations, as in wave9e/9f). Please check whether `src/queries/google.drive.repository.sql` now drifts and, if so, produce the block.
6. Web: is the failure list reachable by keyboard, and does it need a `role`/aria treatment I skipped?

## Not verified
Browser; medium suite not re-run (the new query is not covered by a medium test — should it be?).
