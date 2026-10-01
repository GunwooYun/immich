# Review request — wave11f: wave11e fixes (comments and docs only)

- Branch: `feat/google-drive-album-sync-v3.1.0`
- Range: `3458caadf..be9eb7110` (one commit)
- Previous: wave11e review NOT BLOCKED; this round exists only because §2.4 makes fixes review
  targets and one of the files is server source (a comment).

## What changed

| File | Change |
|---|---|
| `server/src/schema/tables/google-drive-upload-error.table.ts` | `attempts` column **comment only**: no longer says "there is no retry cap" (wave11e N1) |
| `dev-docs/google-drive/failure-handling-plan.md` | §4 "no cap" proposal marked superseded by wave11 R3 |
| `dev-docs/google-drive/stabilization-plan.md` | V11 row re-worded (N2); V6 no longer claims an unobservable property (N4) |
| `CLAUDE.md` | §7 step 8: capped assets stay in the pending count (N3); V6 row (N4) |

No executable line changed — the schema file's decorators and types are untouched, so no migration
is implied (please confirm from the diff).

## Please attack

- That the diff is comment-only in the `.ts` file.
- That each new sentence matches the code at `be9eb7110` (cap constant names, capped classes, the
  claim that blocked users are excluded before the cap applies in `streamPendingUploads`).

## Test evidence

`./dev-test/google-drive/run.sh` → `dev-test/google-drive/results/20261001-1841.txt`: commit
`be9eb7110` + `M mise.lock` only; server unit 328/328, web unit 87/87, **PASS**.
`.claude/scripts/verify-task server` exit 0. Medium not re-run (no query or schema change; last
medium run 72/72 at `c0e99a0d7`).
