# Code Review — round-10 지적 반영 (C1/C2/C3/N2)

Review of `fa00a7abf` (N2), `6fd2667fa` (C1/C2/C3), `1c63c4edc` (docs), the fixes for
`google-drive-wave6-n1-ci-20260902-0845-review.md`.

|                  |                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch           | `feat/google-drive-album-sync-v3.1.0`                                                                                                                                                               |
| Commits reviewed | `fa00a7abf`, `6fd2667fa`, `1c63c4edc`                                                                                                                                                               |
| HEAD at review   | `11262de86` (report was written at `1c63c4edc`; everything after it is docs/tooling only — confirmed with `git log --oneline 1c63c4edc..HEAD`, all five commits touch only `CLAUDE.md`/`dev-docs/`) |
| Report           | `../report/google-drive-wave6-round10-fixes-20260902-0952-report.md`                                                                                                                                |
| Prior review     | `google-drive-wave6-n1-ci-20260902-0845-review.md`                                                                                                                                                  |
| Reviewed         | 2026-09-02                                                                                                                                                                                          |

## Verdict

**N2 and C2 are correct, C3 is correct, and the test evidence reproduces exactly — but the C1 fix
does not work.** It builds the right package (`@immich/plugin-sdk`, and it is genuinely the only
gitignored workspace `dist` the server specs need at runtime) but in the wrong order relative to
its own build-time dependency: `packages/plugin-sdk/src/host-functions.ts` does a _value_ import
(`getAllAlbums`, not `import type`) from `@immich/sdk`, `esbuild.js` bundles it (`bundle: true`),
and on a clean checkout `@immich/sdk`'s entry point (`build/index.js`) does not exist until
`@immich/sdk` is itself built. The committed order is plugin-sdk first, sdk second
(`.github/workflows/fork-google-drive.yml:65-70`) — backwards. I reproduced the failure with the
exact command the job runs, on this repo, by moving `packages/sdk/build` out of the way first:
`pnpm --filter @immich/plugin-sdk build` exits 1 with `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`, esbuild
reporting `Could not resolve "@immich/sdk"` at `src/host-functions.ts:7:7`. The `feature` job — the
one job this whole round-10 exchange was about — will still fail on a clean runner, at a different
line than before. `regression` and `medium` are unaffected: both call the existing `//:plugins`
mise task, which builds sdk/plugin-sdk/plugin-core as one multi-filter `pnpm` invocation and lets
pnpm's own topological sort order them (I confirmed this too, same technique: sdk built before
plugin-sdk before plugin-core, in that log order, with `packages/sdk/build` removed first).

### Evidence I ran myself

| Check                                                                                                                                                                                            | Result                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/config.spec.ts` at HEAD (`npx vitest run --config test/vitest.config.mjs src/config.spec.ts`)                                                                                        | 4/4 pass, 461 ms                                                                                                                                                                                                                                                                                                                                                        |
| Full feature suite (`bash dev-test/google-drive/run.sh`) at `11262de86`                                                                                                                          | server unit 239/239, web unit 29/29, svelte-check baseline-gated: no regressions — `RESULT: PASS`                                                                                                                                                                                                                                                                       |
| Full feature suite incl. medium (`bash dev-test/google-drive/run.sh --medium`, Docker available)                                                                                                 | same as above, plus medium 10/10 — `RESULT: PASS`                                                                                                                                                                                                                                                                                                                       |
| `git check-ignore -v` on `packages/plugin-sdk/dist/index.js`, `packages/sdk/build/index.js`, `packages/plugin-core/dist/index.js`                                                                | all three gitignored (`packages/plugin-sdk/.gitignore:1`, root `.gitignore:27`, `packages/plugin-core/.gitignore:1`)                                                                                                                                                                                                                                                    |
| `grep -A3 '"@immich/'` `server/package.json`                                                                                                                                                     | only `@immich/plugin-sdk` and `@immich/sql-tools` (the latter a published npm package, not a workspace `dist`) — no `@immich/plugin-core`, `@immich/cli`, `@immich/scripts` dependency                                                                                                                                                                                  |
| `grep -rln "@immich/plugin-sdk" web/src`                                                                                                                                                         | empty — `web` has no dependency on `@immich/plugin-sdk`                                                                                                                                                                                                                                                                                                                 |
| `grep -rln` the 8 `SERVER_SPECS` files for `test-assets`/`testAssetsDir`                                                                                                                         | empty — none of the feature job's specs touch `e2e/test-assets`                                                                                                                                                                                                                                                                                                         |
| **C1 order, isolated**: `mv packages/sdk/build /tmp/…; pnpm --filter @immich/plugin-sdk build`                                                                                                   | fails: `esbuild.js` → `Could not resolve "@immich/sdk"` at `src/host-functions.ts:7:7`, pnpm exits 1 with `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`                                                                                                                                                                                                                           |
| **C1 order, `//:plugins`' actual command**: same removal, then `pnpm --filter @immich/sdk --filter @immich/plugin-sdk --filter @immich/plugin-core install/build`                                | succeeds; log shows `packages/sdk build: Done` before `packages/plugin-sdk build: Done` before `packages/plugin-core build: Done` — pnpm orders the co-selected set by the dependency graph regardless of `--filter` listing order                                                                                                                                      |
| `server/src/dtos/system-config.dto.ts:463-465`                                                                                                                                                   | `export function mapConfig(config: SystemConfig): SystemConfigDto { return config; }` — identity, as claimed                                                                                                                                                                                                                                                            |
| Traced `updateSystemConfig` → `updateConfig` → `getConfig({withCache:false})` → `buildConfig` (`server/src/services/system-config.service.ts:56-78`, `server/src/utils/config.ts:43-63,102-132`) | with the mock's `metadataRepo.set(...)` called on `{}` (nothing persisted), `buildConfig` re-reads `metadataRepo.get` (mocked to `{}`) and returns `cloneDeep(defaults)` unchanged — so `result.googleDrive.clientId` really does trace back to the _service's_ `defaults`, not the test's, confirming the N2 assertion is non-vacuous for the reason the comment gives |
| `steps.<id>.outcome` in `.github/workflows/fork-google-drive.yml:140-141,182`                                                                                                                    | step ids (`server`, `web`, `medium`) match the reference; standard GitHub Actions syntax, valid                                                                                                                                                                                                                                                                         |

## Findings

**C1-again (HIGH, blocking).** `.github/workflows/fork-google-drive.yml:65-70` installs and builds
`@immich/plugin-sdk` _before_ `@immich/sdk`:

```yaml
pnpm --filter @immich/plugin-sdk install --frozen-lockfile
pnpm --filter @immich/plugin-sdk build
pnpm --filter @immich/sdk install --frozen-lockfile
pnpm --filter @immich/sdk build
```

`packages/plugin-sdk/src/index.ts` re-exports `src/host-functions.ts`, which imports
`getAllAlbums` (a real value, not `type`) from `@immich/sdk`. `esbuild.js` builds with
`bundle: true`, so it must resolve and bundle the actual `@immich/sdk` module — which on a clean
checkout is `packages/sdk/build/index.js`, produced only by `@immich/sdk`'s own build (`tsc`).
Installing `@immich/plugin-sdk` does not build its dependencies; `pnpm --filter X install` only
sets up `X`'s own `node_modules`. Reproduced directly above: with `packages/sdk/build` absent,
`pnpm --filter @immich/plugin-sdk build` — the literal second line of the block — fails with
`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`. The fix is to swap the two blocks (sdk install+build, then
plugin-sdk install+build); the existing comment about avoiding `mise //:plugins` (to skip the
wasm/extism/binaryen/java toolchain) is still correct and doesn't need to change, only the order
of the two `pnpm --filter` pairs already present.

This is not a nitpick — it is the exact failure mode the report's evidence table (239/29/10 PASS)
cannot exercise, because that evidence was produced on the desktop's existing checkout where
`packages/sdk/build` already exists from prior local work (same blind spot the original C1 finding
described for `plugin-sdk/dist`). The report itself asked the reviewer to check the install order
(§"공격해 주셨으면 하는 것", item 1) — it does not hold up.

No other findings. C2, C3, and N2 all check out as claimed; see below.

## Answers to what the report asked me to attack

### 1. Is `plugin-sdk` the only workspace dist the server specs need, and is the order right?

**Which package: yes.** `server/package.json` lists exactly one `@immich/*` workspace dependency
besides the already-built `@immich/sdk`: `@immich/plugin-sdk`. `web` doesn't reference it at all
(the feature job's `WEB_SPECS` don't need it). I did not find any other gitignored workspace `dist`
in the eight `SERVER_SPECS`' transitive graph — the only value-level entry point is `enum.ts`'s
`WorkflowTrigger` import, as the report says.

**Order: no, and it is broken exactly the way described above.** The report's own commit message
says "Building plugin-sdk directly rather than through `//:plugins`, because that task also builds
plugin-core" — true, but the fix threw out the one thing `//:plugins` gets right: sdk before
plugin-sdk. Swapping the two blocks is the whole fix; nothing else in the job needs to change.

### 2. Does C3 make failures actually visible, and is the syntax right?

Yes on both counts. `continue-on-error: true` on the `server`/`web`/`medium` steps (not the job)
means the job still reports success while the steps are settling in, but each step gets an `id`
and `steps.<id>.outcome` is correctly referenced in the summary step — valid syntax, and the
summary step is `if: always()` so it runs whether or not a prior step failed (it would run anyway
here since `continue-on-error: true` makes the job's default `success()` condition hold regardless,
but `always()` is the right belt-and-braces choice for a report step). The `::warning::` annotation
and the `$GITHUB_STEP_SUMMARY` write both fire on `outcome == 'failure'`. I did not execute the
workflow, so I can't confirm exactly how the summary table renders in the GitHub UI, but the
mechanism is sound and the syntax is unambiguously correct — see the row in the evidence table.

### 3. Is the N2 assertion's dependency on `mapConfig` being identity real and disclosed?

Yes to both. `mapConfig` is `return config;` verbatim (`system-config.dto.ts:463-465`), and I
traced the full path from `updateSystemConfig`'s return value back to `buildConfig`'s
`cloneDeep(defaults)` to confirm the assertion is pinned to the _service's_ `defaults`, which is
the thing the surrounding comment claims and the thing that would actually drift if the dynamic
re-import stopped reaching the service. The comment in `config.spec.ts:122-126` states the
`mapConfig`-is-identity dependency explicitly, so nothing is hidden. If `mapConfig` ever stopped
being the identity (e.g., started redacting `clientId` in the DTO), this specific assertion would
need to change with it, but that's a visible, expected coupling, not a silent one — a change to
`mapConfig` that broke this would fail the test loudly rather than pass vacuously, which is what
N2 was for.

### 4. Does the CLAUDE.md fix in `1c63c4edc` actually strengthen §1?

Out of my attack scope for this round (the report's own "공격해 주셨으면 하는 것" list is about
C1/C2/C3/N2; CLAUDE.md's three tensions were the prior review's finding 4, already closed in a
different review). I spot-checked one line only: `CLAUDE.md:98` now reads `5. **필수** (§1 —
권장이 아니다)`, matching the diff in `1c63c4edc`. I did not re-review the CLAUDE.md content in
depth; the commits after `1c63c4edc` (`b2580684b`, `85cbeb91a`, `414fceb13`, `5c859c4a9`,
`11262de86`) keep editing `CLAUDE.md` further, which is out of scope for these three commits and
should get its own report if it needs review.

## What I did not verify

- **No CI run.** Same gap as the prior round: Actions has never executed on this fork. My C1
  finding is a local reproduction of the exact `pnpm` commands the job runs, with the same file
  removed a clean checkout would lack — as close as this can get without a runner, but not a runner
  log.
- **The full `//server:ci-medium` (56 specs) and `//web:ci-unit`.** I confirmed the _build step_
  these two jobs share (`//:plugins`) orders correctly, and I ran `run.sh --medium`'s one
  database-backed spec (10/10 pass), but I did not run the full medium suite or `prettier --check`
  over the whole `web` workspace — both are still genuinely untested on this fork, as the report
  says.
- **What the GitHub UI actually renders** for the `$GITHUB_STEP_SUMMARY` output and the
  `::warning::` annotation — read the YAML, not observed live.
- **`jdx/mise-action@v3`'s behavior** on a real runner (tool installation, `github:` backend
  auth) — unchanged from the prior round's open item.
- I restored the working tree after each experiment (`packages/sdk/build`,
  `packages/plugin-sdk/dist`, `packages/plugin-core/dist` were moved aside and rebuilt via
  `pnpm --filter … build`, matching the file lists observed before I started); these are all
  gitignored build artifacts and never touch `git status --porcelain`, confirmed clean after each
  step and at the end (see below).

## Feeding back into the plan

The next round-11 fix needs exactly one change: swap the order of the two `pnpm --filter` blocks
at `.github/workflows/fork-google-drive.yml:65-70` (sdk first, plugin-sdk second). Worth adding to
`wave6-plan.md` as a standing rule rather than a one-off: whenever a workflow step builds a
workspace package directly (bypassing a mise task that already encodes the graph), the reviewer
has to check that package's _own_ build-time imports, not just what depends on it — this is the
second time in two rounds that the direction of a workspace dependency, not its existence, was the
actual bug (`enum.ts` importing `plugin-sdk` at runtime in round 9/10; `plugin-sdk` importing `sdk`
at build time now). A cheap general check for this class: try building the newly-added package
alone, with its dependency's build output moved aside first — exactly the reproduction used here.

`git status --porcelain` confirms no file was modified except this review file.
