# Review request — wave11j: redundant mock resets removed (test-only)

- Branch: `wave11g-isolated-review-fixes`
- Range: `0e9cdb4e0..e0744f697` (one commit; test file + the wave11i review file)
- Previous: wave11i review NOT BLOCKED; N1 fixed here, N2 disputed (see commit message)

## What changed

`server/src/services/google-drive.service.spec.ts` only:
- removed `driveFilesCreate.mockClear()` in the two lazy-open tests, and the comment beside the first;
- removed `driveFilesCreate.mockReset()` in the `upload verification` describe's `beforeEach`
  (replaced by a one-line comment pointing at the file-level reset). `driveFilesDelete` lines kept.

No production code changed.

## Please attack

- The lazy-open test asserts `driveFilesCreate` was called exactly once. Confirm it now relies only
  on the file-level `beforeEach` reset, and that no `beforeEach` between the file level and that
  test calls `files.create`.
- The N2 dispute: the config comment says 15 failures before queue's pin moved. My evidence is the
  first reproduction's output (15 failed: album 1, google-drive 8, server 1, system-config 5 — four
  specs). Check it is consistent with the code at `e53a6f528` (queue.service.spec still had its own
  pin then).

## Test evidence

`./dev-test/google-drive/run.sh` → `dev-test/google-drive/results/20261002-1639.txt`: commit
`e0744f697`, clean tree; server unit 330/330, web 87/87, PASS (medium not re-run — no query or
repository change since the 72/72 at `4426cdfc7`). `verify-task server` exit 0. Drive spec in
order and on shuffle seeds 1 and 42: 128/128 each.
