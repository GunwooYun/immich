# Code Review — Wave 6 N1 fix + fork CI + CLAUDE.md restore

Review of `7ab1baebb` (N1 test), `51d32bd52` (plan feedback), `e2c0a1cff` (CLAUDE.md restore) and
`6bf716ca2` (fork CI workflow).

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commits reviewed | `7ab1baebb`, `51d32bd52`, `e2c0a1cff`, `6bf716ca2` |
| HEAD at review | `3a002b276` (the report commit; contains all four) |
| Report | `../report/google-drive-wave6-n1-ci-20260902-0845-report.md` |
| Prior review | `google-drive-wave6-fixes-20260902-0750-review.md` |
| Reviewed | 2026-09-02, from a detached worktree (`immich-review`), report-only |

## Verdict

**The code change (N1) is correct, honest, and placed where it has to be. The CLAUDE.md restore is
lossless. The plan feedback matches the code.** Nothing in those three commits needs to change;
one optional hardening (N2) below.

**The CI workflow will not go green as committed.** Two of its three jobs fail on first run for
reasons that have nothing to do with the feature, and both were reachable by reading the repo:

- **C1 (feature job)** — the server specs cannot load: `server/src/enum.ts` has a *runtime* import
  from `@immich/plugin-sdk`, whose entry point is an untracked build artifact
  (`packages/plugin-sdk/dist/index.js`). The job builds `@immich/sdk` but never `@immich/plugin-sdk`.
  Locally it passes only because the desktop checkout has a `dist/` from an earlier `//:plugins`.
- **C2 (medium job)** — `mise run //server:ci-medium` runs all 56 medium specs, seven of which read
  `e2e/test-assets`, a git submodule. The job's checkout has no `submodules: 'recursive'`;
  upstream's medium job has it for exactly this reason (`test.yml:381`).

The report is candid that CI was never executed, so this is not a process violation — it is the
"검증 못 함" list coming due. But the workflow was committed with a comment that says the install
sequence is what `run.sh` needs, and that claim is wrong; fix C1 and C2 before this workflow is
cited as a gate anywhere. Both fixes are one or two lines.

### Evidence I ran myself

- `config.spec.ts` at `7ab1baebb`: **4/4 pass** (0.4 s for the new test). Run in the main
  checkout (`c224ffd3a`, a descendant of `6bf716ca2`; the file is byte-identical to the reviewed
  commit) because this review worktree has no `node_modules`. Read-only run, nothing written.
- The non-vacuity claim (drop `''` from `isEmpty` → only this test fails) I verified **by reading**
  `utils/config.ts:46-59`, not by re-running the mutation — I would have had to edit a tracked
  file in a checkout that isn't mine to touch. The trace is unambiguous: `''` vs `'env-client-id'`
  is neither empty nor equal → `partialConfig.googleDrive.clientId = ''` → `set` is called with a
  non-empty object → the assertion fails; none of the other three tests reach `updateConfig`.
- Evidence file `dev-test/google-drive/results/20260902-0843.txt` exists, is stamped
  `6bf716ca2`, and reads 239 / 29 / 10 PASS. Consistent with the report.
- `@immich/plugin-sdk` resolution (C1): in the main checkout,
  `server/node_modules/@immich/plugin-sdk -> ../../../packages/plugin-sdk` (symlink), and
  `import('@immich/plugin-sdk')` yields `typeof WorkflowTrigger === 'object'` — a runtime value,
  served from `dist/`. `git ls-files packages/plugin-sdk/dist` is empty.
- All 8 upstream workflows with a `push:` trigger are `branches: [main]` — parsed the YAML rather
  than grepping, so nested keys can't fool it. Your claim in 3-③ holds.
- CLAUDE.md: `git show 659b4540d:CLAUDE.md` vs the current file from `## Current Project` down,
  with headings normalised: the only differences are the title line and "이 파일은" → "이 절은".
  No content lost.

## Answers to the four things you asked me to attack

### 1. The N1 test's mixed module graph — benign now, and here is exactly why

Three things are mixed, and each is safe for a specific reason worth writing down:

1. **`newTestService` (old graph) constructing a service class from the new graph.** `getMocks()`
   builds every mock with `automock(<RepositoryClass>)` from the statically imported classes; the
   result is a bag of `vi.fn()`s keyed by prototype method name. The service calls methods by name
   and nothing does `instanceof`. Both graphs are built from the same source, so the method sets are
   identical. This breaks only if `BaseService` or `newTestService` starts type-checking its
   arguments at runtime, which nothing in this codebase does.
2. **`SystemMetadataKey` from the old graph vs the service's.** It is a string enum
   (`enum.ts:336`), so `toHaveBeenCalledWith` compares `'system-config'` to `'system-config'`.
   Your premise is right. It would only matter for a numeric enum compared by identity, which this
   isn't.
3. **The one that actually matters: are the test's `defaults` and the service's `defaults` the
   same object?** The test imports `./config.js`; `src/utils/config.ts` imports `src/config`.
   `vite-tsconfig-paths` rewrites the alias to the same absolute file id, so within one registry
   generation (the `vi.resetModules()` immediately before both dynamic imports) they are one module
   instance. Confirmed by the mutation result you reported — it can only fail if the service's
   `defaults` really carries `'env-client-id'`.

**Where it could silently break (N2, LOW — optional).** The precondition pins the *test's*
`defaults`, not the *service's*. If the two ever diverged — someone "simplifies" the dynamic import
of `system-config.service.js` back to a top-level import, or a future alias/config change gives the
two specifiers different ids — the service would compare `''` against a default of `''`,
`isEmpty` would still skip the write, `set({})` still fires, and the test passes vacuously while the
precondition stays green. The mutation experiment would catch it; the suite would not.

One extra assertion closes the hole, and it pins the user-visible consequence the comment already
describes:

```ts
const result = await sut.updateSystemConfig({ ... });
expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.SystemConfig, {});
expect(result.googleDrive.clientId).toBe('env-client-id');
```

This works because `updateConfig` ends in `getConfig` → `buildConfig` → `cloneDeep(defaults)` of
the **service's** `defaults`, and `mapConfig` is the identity (`system-config.dto.ts:463-465`). If
the service saw `''` defaults, `result.googleDrive.clientId` would be `''`. Not required for this
round; it is the cheapest way to make the graph-identity assumption an assertion instead of a
comment.

### 2. Placing it in `config.spec.ts` — right, and the reason is stronger than "convenience"

The stated reason is exact: `system-config.service.spec.ts` evaluates `defaults` at import with no
environment, and the only way to give a googleDrive credential a non-empty default is to stub
*before* the module is built, which means `vi.resetModules()` + dynamic import — the machinery this
file already owns and documents (including the "don't simplify the afterEach reset" warning that
keeps it honest). Moving the pattern into the service spec would duplicate that machinery and the
warning. The header comment now names the exception and why. File responsibility is not blurred; it
is "everything that needs `defaults` built against a stubbed environment", and this test is that.

### 3. The CI workflow — the trigger claim holds; the install and checkout claims do not

**3-③ push scope — correct.** Every upstream `push:` is `branches: [main]`; `pull_request:` was
rightly not added. One cosmetic consequence if this ever reaches `main`: `org-zizmor.yml` will flag
`jdx/mise-action@v3` as an unpinned use while the two other actions are SHA-pinned. Irrelevant on
`feat/**`.

**3-① feature job install — insufficient (C1, HIGH).**

```
server/src/enum.ts:1      import { WorkflowTrigger } from '@immich/plugin-sdk';   // value import
server/src/enum.ts:1268   z.enum(WorkflowTrigger)                                  // used at module eval
packages/plugin-sdk/package.json   exports "." -> ./dist/index.js                  // untracked
packages/plugin-sdk/package.json   build: node esbuild.js && tsc --emitDeclarationOnly && tsc-alias
```

`enum.ts` is in the import graph of every one of the eight server specs `run.sh` runs. Vite will
fail at import analysis ("Failed to resolve entry for package @immich/plugin-sdk") and all eight
files error before a single test runs. The web half and svelte-check would still run, and the job
would fail with `RESULT: FAIL`.

Fix — two lines in "Install workspaces", before the server install (the job's own comment about
skipping the wasm toolchain stays true; `@immich/plugin-sdk` is plain esbuild + tsc):

```yaml
pnpm --filter @immich/plugin-sdk install --frozen-lockfile
pnpm --filter @immich/plugin-sdk build
```

Do **not** reach for `mise run //:plugins` here: it also builds `@immich/plugin-core`, whose
`build:wasm` needs `extism-js`, which `install_args: node pnpm` deliberately leaves out.

Also confirmed for this job, no action needed: the svelte-check baseline stores repo-relative
paths (`src/lib/...`), so it is portable to the runner; `web`'s `prepare` script already runs
`svelte-kit sync`, so the explicit step is belt-and-braces, harmless; `@immich/sdk` (`build/`) is
built. `timeout-minutes: 20` is tight — `run.sh` gives svelte-check alone a 600 s budget, plus
three installs and two builds — expect to raise it if the first run lands near the limit.

**medium job — checkout is incomplete (C2, HIGH).**

`//server:ci-medium` runs `vitest --config test/vitest.config.medium.mjs` over all 56 medium specs,
not the one `run.sh --medium` runs. Seven of them (`metadata.service`, `integrity.service`,
`asset.service`, the four `exif/*` specs) resolve fixtures through
`testAssetsDir = resolve(__dirname, '../../e2e/test-assets')` (`server/test/medium.factory.ts:89`),
and `e2e/test-assets` is a submodule (`.gitmodules`). Upstream's medium job checks out with
`submodules: 'recursive'` (`test.yml:381`); the fork's does not, so that directory is empty on the
runner and those specs fail. The job is blocking, so the workflow goes red.

Fix: add `submodules: 'recursive'` to the medium job's checkout. The submodule is a public repo, so
the default token suffices; `persist-credentials: false` still applies after checkout.

Two related observations while here:

- The report's "10 passed" medium evidence is the google-drive spec only. The CI job runs the full
  suite, which this fork has never run — the same "never run here" argument that made `regression`
  non-blocking applies to `medium`, and it was made blocking. Either is defensible; the plan should
  say which and why. (Note the desktop's `e2e/test-assets` is empty too, so a local
  `mise run //server:ci-medium` would hit C2 before CI does — a cheap way to check the rest of the
  suite is green before trusting the job.)
- `ci-medium` also builds `plugin-core`, which needs `extism-js` from the `github:` mise backend.
  `jdx/mise-action` installs every tool in the root `mise.toml` by default and passes
  `github.token`, so this should work; it is one of the things only a first run will confirm.

**regression job — `continue-on-error: true` makes it decorative (C3, MEDIUM).** Job-level
`continue-on-error` reports the job as *successful* in the checks list; the failure is visible only
as an annotation inside the run. Combined with `cancel-in-progress`, a failing sweep is easy to
never notice. Starting it non-blocking is reasonable given `prettier --check .` over `web` has never
run here, but make the outcome visible: a final step with `if: failure()` that writes to
`$GITHUB_STEP_SUMMARY`, or a dated note in the plan to flip it once it has been green once.
Otherwise this job answers the question "what does an upstream merge break?" with silence.

Minor, no action required: `upload-artifact` on `dev-test/google-drive/results/` uploads every
tracked historical result file as well as the new one; uploading `$latest` only would be tidier.

### 4. CLAUDE.md — lossless; three real tensions, none blocking

Content: verified identical (see Evidence). What the merge did not resolve:

1. **The template softens the fork's absolute rule.** Template "Workflow" step 5 reads
   "(권장) 구현 완료 후 별도 세션에서 리뷰", and the Operational Notes say "세션 안에서의 가벼운
   리뷰는 deep-reasoning 서브에이전트로 충분하다". §1 says every code change goes through the
   report → review-file cycle, no exceptions, and §2 says which directory. A reader who stops at
   the template has been told review is recommended and that an in-session subagent is enough.
   One sentence in the template pointing at §1/§2 as binding fixes it.
2. **Every "→ 참고" link in the template dangles in a fresh checkout.** `.claude/` is gitignored
   (`.gitignore:16`) and `.agents/` is untracked, so `.claude/rules/*.md`, `.claude/docs/DESIGN.md`,
   `.claude/logs/`, `.agents/rules/AGENTS.md` and the hook scripts exist only on the desktop. This
   review worktree has none of them. Related: `wave6-plan.md` §7 states the three
   `pending-reviews.sh` hook registrations are "그대로 있다" — that is a statement about an
   untracked file and cannot be verified from git. Either track the rules/hooks that the workflow
   depends on, or say in CLAUDE.md that they are local.
3. **Small stale-prone items.** The tech-stack block hard-codes "현재 작업 브랜치
   `feat/google-drive-album-sync-v3.1.0`"; the Operational Note refers to a "Session History 섹션"
   that the file does not currently contain — worth confirming what `/checkpointing` does when
   the section is absent before running it on this file.

The tension you named (template's "10줄 이상은 서브에이전트" vs §2's "review file이 생기면 자세히
검토") is not a contradiction: §2 asks the main session to *act on* the review, and a subagent can
read and summarise it first. No change needed there.

### The plan feedback (`51d32bd52`) — matches the code

- "`enabled` 토글은 자격증명과 독립" — correct as written: `partialConfig` is a fresh `{}` on every
  save and `set` writes it wholesale (`utils/config.ts:46-59`), so a previously stored
  `enabled: true` disappears when the form is saved with `false`.
- The N1 section describes the committed test accurately, including the precondition and the
  mutation result.
- The process section's hook claim is the untracked-file issue above (4.2).

## What I did not verify

- **Any CI run.** I did not execute the workflow; C1 and C2 are read from the repo and from a
  local resolution of `@immich/plugin-sdk`, not from a runner log. Whether Actions is enabled on
  the fork, whether `jdx/mise-action@v3` installs the `github:` backend tools cleanly, and whether
  the full 56-spec medium suite and `//web:ci-unit` are green on this branch remain open.
- The `isEmpty` mutation — read, not re-run (see Evidence).
- Browser, Tailscale and the live Google flow — out of scope, as in the prior review.

## Feeding back into the plan

Suggested for `wave6-plan.md` §7 (or a CI subsection): C1 and C2 as the two things the first
workflow run must have fixed, the decision on whether `medium` is blocking while the full suite is
unproven, and a line that the review hooks and `.claude/rules` are local, untracked files.
