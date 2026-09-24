# Review request — wave10b: retry guards (deploy gate)

**Commits:** `89f5e729f` (fix) + `7cf3585eb` (evidence) · **Previous:** wave10a review — NOT BLOCKED, M1 + N1–N7
**Diff:** `git diff 78ec3d287 89f5e729f -- server/src web/src i18n` (skip generated)
**Deploy gate:** the next production image is built from this; say whether it is fit.

M1 (retry while disconnected queued nothing, cleared the `revoked` marker, and told the user it was retrying) is fixed three ways, each independent: the service refuses without credentials; retry-all clears every class except `revoked`; the page hides both retry buttons while disconnected. N1 generated SQL for `getFailures` appended (DummyDriver + sql-formatter, as in wave9f). N2 mock defaults. N3 endpoint returns `{queued}` and the toast names it. N4 reload only when open + loading states. N5 `aria-expanded`, per-row `aria-label`. N6 medium test pinning `getFailures` to `getErrorSummary`. N7 shared string no longer says "press to retry".

**Mutations:** removing the connected gate (web) → 1 test fails; dropping the ledger anti-join or the trashed rule from `getFailures` → the new medium test fails each time.

**Evidence:** `results/` newest — `89f5e729f`, clean: server 315, web 85, medium 62, PASS. `mise //server:ci-unit` 2441 passed / 2 skipped; `mise //web:ci-unit` 601 passed / 2 skipped, svelte-check 0 errors.

**Attack:** (1) Is refusing retry while disconnected right, or should it clear non-revoked rows anyway so the count is honest after reconnecting? (2) `Object.values(...).filter(!== Revoked)` — does any other class deserve the same treatment (e.g. a future `rate_limited`)? (3) Does the appended SQL block match what the real generator would emit, including position in the file? (4) Deploy fitness of `v3.1.0..HEAD` against the running instance: any queueing, worker or adoption change since the deployed `9665ace92`?

**Not verified:** browser; the retry path against the live instance.
