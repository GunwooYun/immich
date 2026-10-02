# Review request — wave11g: fixes for the isolated review's findings

- Branch: `wave11g-isolated-review-fixes` (from `feat/google-drive-album-sync-v3.1.0` @ `3f36c0d0b`)
- Range: `3f36c0d0b..e53a6f528` — `bde60a1d5` (CLAUDE.md rule, docs), `e53a6f528` (code)
- Source of the findings: isolated review of wave11 segment 2 (`.claude/docs/reviews/`, not
  readable by in-session reviewers by design — the three findings are restated below)

## The findings being fixed

| ID | Isolated review said | Fix |
|---|---|---|
| F1 (low) | upstream test "should run the scheduled jobs" asserts an exact job list; Drive config defaults come from `IMMICH_GOOGLE_DRIVE_*` env, so the test fails in a shell exporting them | test pins Drive off via `systemMetadata` mock |
| F2 (low) | an ENOENT at the fs.ReadStream's lazy open (move between stat/access and open) goes through R3's stream listener, not the move fallback: recorded as "mid-upload", costs a capped attempt | `openOriginal` opens through new `openAndWait`, which resolves after `'ready'` when `stream.pending === true`; an open error becomes a throw inside openOriginal's try |
| F3 (low) | `countPendingUploads` comment claims "same predicate as streamPendingUploads" (only blocked users differ); `isAssetInSubscribedAlbum` comment says keep all three identical — invites copying the cap into the count | both comments say which part must match (album-level join) and which must not (block, cap) |

Also in range, docs only: `bde60a1d5` — CLAUDE.md §1/§7: production state changes are run by
the user; Claude prepares commands and verifies by reading. Please check it is internally
consistent with the rest of §7 (the deploy checklist still lists commands; they are now handed
to the user).

## Please attack

1. **`openAndWait` correctness.** Is `pending` reliable on Node's fs.ReadStream (set true at
   construction, false after open)? Can `'ready'` fire before our listener attaches (the repo
   method is async — the open is on the threadpool, so it should not, but confirm)? Any path
   where neither `'ready'` nor `'error'` fires and the job hangs (e.g. a stream destroyed before
   open)? If so, the stall watchdog does **not** cover it — the timer is armed after
   openOriginal.
2. **Interaction with R3's listener.** After `'ready'` the wait's listeners are removed and
   uploadAsset attaches its own `'error'` listener. Is there a window between the two where an
   error event has no listener (crash)? Reading does not start until googleapis pipes, so I
   believe not — confirm.
3. **Tests.** The two new tests drive `pending`/`ready`/`error` on an EventEmitter stand-in. Do
   they prove the fallback is reached for the *reason* claimed (the mutation table says yes)?
   `driveFilesCreate` is a hoisted, file-wide mock; the new tests call `mockClear()` — does that
   leak into following tests?
4. F1: is pinning `googleDrive` in an upstream test the right shape, or should the shared
   `newTestService` default config pin it for every spec?

Don't read generated files; no query, DTO or SQL changed.

## Test evidence

`./dev-test/google-drive/run.sh --medium` → `dev-test/google-drive/results/20261002-1334.txt`

| | |
|---|---|
| commit | `e53a6f528` (wave11g-isolated-review-fixes), **clean tree** |
| server unit | 330 / 330 |
| web unit | 87 / 87 |
| medium | 72 / 72 |
| result | **PASS** |

`.claude/scripts/verify-task server` (prettier, eslint, tsc, full server unit) exit 0 before the
commit. Web untouched; web unit is in the run.sh numbers above.

### Negative runs (applied, run, reverted; files byte-compared after)

| Mutation | Red |
|---|---|
| `openAndWait` never waits (`pending === true && false`) | "treat an ENOENT at the lazy open like any other move…" |
| `'error'` listener not removed after `'ready'` | "wait for a pending stream to open before uploading it" (listenerCount) |
| F1 pin removed, run with fake `IMMICH_GOOGLE_DRIVE_*` exported | "should run the scheduled jobs" |
| F1 pin kept, same fake env | all 20 queue tests pass |

The fake env values were literal placeholders (`fake`, `https://example.test/cb`), not credentials.

## Verified / not verified

- Verified: the three behaviours with mocks; the F1 fix against a deliberately polluted env.
- Not verified: a real fs.ReadStream opening against a file moved in the microsecond window
  (only an EventEmitter stand-in); whether `pending` exists on every Node version this runs
  (Node 24 here).
