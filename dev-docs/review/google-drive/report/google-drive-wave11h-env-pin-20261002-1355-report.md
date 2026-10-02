# Review request — wave11h: wave11g review fixes (env pin, waiting test)

- Branch: `wave11g-isolated-review-fixes`
- Range: `612320b17..374b3e4f2` (one commit)
- Previous: wave11g review NOT BLOCKED; this round reviews its fixes (§2.4)

## What changed

| File | Change |
|---|---|
| `server/test/vitest.config.mjs` | `test.env` pins `IMMICH_GOOGLE_DRIVE_{CLIENT_ID,CLIENT_SECRET,REDIRECT_URL,API_KEY}` to `''` for every unit spec (M1) |
| `server/src/services/queue.service.spec.ts` | per-test pin removed in favour of the config pin; comment points there |
| `server/src/services/google-drive.service.spec.ts` | "wait for a pending stream to open" now records `pending` at hand-over to `files.create` and asserts `false` (N1) |
| `server/src/services/server.service.spec.ts` | comment only: no longer cites the abolished `enabled` opt-in (N4) |
| `CLAUDE.md` | §7: stale pointer to the removed §1 phrase (N3) |

## Please attack

1. **Does `test.env` actually override a value already exported in the parent shell?** My
   evidence says yes (polluted env → 2457 passed; pin removed → 16 failed), but check vitest's
   semantics: is `test.env` applied before `config.ts` is imported in each worker, or could a spec
   that imports config at collection time see the shell value?
2. Does pinning these to `''` hide anything a spec *should* see — e.g. a test that meant to read
   the real env? (grep found none.)
3. The medium config is deliberately not pinned (repository specs don't read the Drive config).
   Is that true for every medium spec in `test/medium/`?
4. The N1 test's `mockImplementationOnce` on the file-wide `driveFilesCreate` mock — any leak if
   the test fails before the call is consumed?

## Test evidence

`./dev-test/google-drive/run.sh --medium` → `dev-test/google-drive/results/20261002-1353.txt`:
commit `374b3e4f2`, **clean tree**; server unit 330/330, web unit 87/87, medium 72/72, **PASS**.
`.claude/scripts/verify-task server` exit 0.

Negative runs (applied, run, reverted, byte-compared):

| Run | Result |
|---|---|
| full server suite with fake `IMMICH_GOOGLE_DRIVE_*` exported, pin in place | 2457 passed / 2 skipped |
| same, `test.env` pin removed | 16 failed |
| `openAndWait` never waits | both lazy-open tests red, incl. the rewritten N1 test |

Fake env values were placeholders (`fake`, `https://example.test/cb`).
