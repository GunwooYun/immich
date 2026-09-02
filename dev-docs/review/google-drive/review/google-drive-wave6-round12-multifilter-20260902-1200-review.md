# Code Review — round-12 multi-filter 전환 (`install`/`build` 각 한 줄)

| | |
|---|---|
| Branch / HEAD | `feat/google-drive-album-sync-v3.1.0` / `b41bd97c1` (리포트 + 직전 리뷰 파일만 추가) |
| Commits reviewed | `2defdb13e` (단일) |
| Report | `../report/google-drive-wave6-round12-multifilter-20260902-1200-report.md` |
| Prior review | `google-drive-wave6-round11-order-20260902-1146-review.md` (N1/N2) |
| Reviewed | 2026-09-02 |

## Verdict

**커밋 자체는 옳다. 세 가지 공격 지점 모두 방어된다 — 그리고 그것이 이 라운드의 문제가 아니다.**
`install`의 multi-filter 형태는 `build`만큼 안전하다는 것을 추론이 아니라 실측으로 닫았다:
두 패키지의 `node_modules`를 **실제로 치운 뒤** 커밋된 install 줄을 돌리면 lockfile 검사가
진짜로 수행되고(`Lockfile is up to date, resolution step is skipped`), 두 트리가 복원되며,
`@immich/sdk`는 **injection 사본이 아니라 symlink**로 연결된다(나열 순서를 뒤집어도 결과 동일).
주석의 세 문단도 사실과 맞고, 특히 "server 스펙은 sdk 빌드 없이도 통과한다"를 `run.sh`가 돌리는
**정확히 그 8개 스펙**으로 재현했다(`packages/sdk/build` 제거 상태에서 239/239 통과, web 3개 중
2개는 `Failed to resolve import "@immich/sdk"`로 사망). 남은 순서 의존도 없다 — 오히려
`pnpm --filter immich-web install`이 `web/package.json:24`의 `prepare`로 `svelte-kit sync`를
**이미 실행**하므로 `:83`은 중복이다(실측).

**가장 중요한 문제는 커밋 밖에 있고, 리포트가 "리뷰로 닫을 수 없다"고 분류한 영역이 아니다.**
`mise run //web:ci-unit`과 `mise run //server:ci-unit`은 지금 이 커밋에서 **첫 하위 태스크인
`prettier --check`에서 죽는다.** 걸리는 파일 세 개는 전부 이 포크가 작성한 파일이다 —
`web/src/lib/components/album-page/GoogleDriveAlbumMenu.spec.ts`,
`web/src/lib/components/shared-components/context-menu/ButtonContextMenu.spec.ts`,
`server/test/medium/specs/repositories/google-drive.repository.spec.ts`. 직접 돌려서 확인했고
(`mise run //web:ci-unit` → exit 1, `:check`/`:test`는 **아예 실행되지 않음**), 러너가 필요 없다.
즉 `regression` job의 첫 실행은 **테스트를 한 개도 돌리지 않은 채** 빨간불이 되고,
`.github/workflows/fork-google-drive.yml:130-134`가 적어 둔 "한 번 초록이면 blocking으로 전환"은
이 세 파일을 포맷하기 전까지 영원히 도달할 수 없다. 이것이 리포트의 "CI 건을 여기서 닫자"는
제안에 반대하는 이유다(N1).

### Evidence I ran myself

| Check | Result |
|---|---|
| `git show 2defdb13e --stat` | 워크플로 YAML(+18/-15)과 직전 리뷰 `.md` 하나뿐 — 코드 변경 없음 |
| `git status --porcelain` (시작·중간·종료) | 리뷰 파일 외 변경 없음 |
| **install 실측**: `packages/sdk/node_modules`·`packages/plugin-sdk/node_modules`를 **치운 뒤** 커밋된 `pnpm --filter @immich/sdk --filter @immich/plugin-sdk install --frozen-lockfile` | exit 0, `Lockfile is up to date, resolution step is skipped`(검사가 실제로 수행됨), 두 트리 복원, `packages/plugin-sdk/node_modules/@immich/sdk -> ../../../sdk` **symlink** |
| 같은 실험을 **필터 역순**(`--filter @immich/plugin-sdk --filter @immich/sdk`)으로 | 결과가 `find` 목록 단위로 정순과 **완전 동일** |
| **build 실측**: 두 산출물 삭제 후 커밋된 build 줄 | `packages/sdk build: Done` → `packages/plugin-sdk build: Done`, exit 0, 산출물 md5가 실험 전과 **완전 동일**(`packages/sdk/tsconfig.json`에 `incremental` 없음 → 캐시로 인한 위양성 아님) |
| **주석 검증(8 server spec)**: `packages/sdk/build` 제거 후 `run.sh`의 8개 spec | `Test Files 8 passed (8)`, `Tests 239 passed (239)` — "server 스펙은 sdk 빌드가 없어도 된다"가 8개 전부에 대해 참 |
| **주석 검증(3 web spec)**: 같은 상태 | `2 failed | 1 passed`, 메시지가 주석의 인용과 문자 단위 일치: `Failed to resolve import "@immich/sdk" from "src/lib/managers/google-drive-progress-manager.svelte.spec.ts"` / `from "src/lib/route.ts"` |
| **injection 재현**: pnpm 11.13.1 + `injectWorkspacePackages: true`인 최소 workspace(스크래치)에서 filtered frozen install | `injectedDeps: {}`, `packages/b/node_modules/@t/a -> ../../../a` **symlink** — 이 pnpm 버전은 injection을 걸지 않는다 |
| **`--frozen-lockfile`의 검사 범위**(스크래치): 선택되지 **않은** importer의 specifier를 바꾼 뒤 다른 두 패키지만 filtered install | exit 1, `specifiers in the lockfile don't match specifiers in package.json` — 필터가 걸려 있어도 검사는 **workspace 전체**다 |
| ↑의 따름정리: 실제 저장소의 filtered install이 통과했다는 사실 | `pnpm-lock.yaml`이 12개 workspace `package.json` **전부**와 정합함이 확인됨(직전 라운드의 미해결 항목 하나가 닫힘) |
| **filtered install이 앞선 프로젝트를 prune 하는가**(스크래치) | 하지 않음 — a+b 설치 후 c만 설치해도 b의 링크 유지. 워크플로의 4연속 install 형태는 안전 |
| **`prepare` 실행 여부**(스크래치 + 실제 저장소) | 실제 저장소 로그: `[//web:install] . prepare$ svelte-kit sync` / `prepare: Done` — filtered install이 `web/package.json:24`의 `prepare`를 **매번**(warm 포함) 실행한다 |
| `pnpm-workspace.yaml:67`의 `verifyDepsBeforeRun: install`이 누락 install을 자동 복구하는가(스크래치) | **아니다** — `node_modules` 없는 상태의 `pnpm --filter b build`는 그냥 실패하고 사후 경고만 남긴다. 순서는 여전히 명시적으로 지켜야 한다 |
| **`mise run //web:ci-unit`** (실제 실행) | **exit 1**, `//web:format`에서 `[warn]` 2파일 → `:check`·`:test`는 실행되지 않음 |
| **`mise run //server:format`** (실제 실행) | **exit 1**, `test/medium/specs/repositories/google-drive.repository.spec.ts` |
| 그 세 파일의 prettier 차이 | import 정렬 + 120칸 줄바꿈 — 플러그인 의존적이지 않은 결정적 차이(예: `await ctx.database.updateTable('album')…execute();` 한 줄로 접힘) |
| 세 파일의 작성자 | `git log -1`: 전부 `GunwooYun` (861869fe7 / a87422a7c / ceb9f95ec) — 업스트림 드리프트가 아님 |
| `//web:format`의 실제 스코프 | 실패 출력 경로가 `src/lib/...` (web 상대) — `web/package.json:19` `prettier --cache --check .`가 **web/ 안에서만** 돈다 |
| `//server:ci-unit` / `//web:ci-unit` / `//server:ci-medium` 정의 | `server/mise.toml:58-66`(`//:plugins` 포함), `web/mise.toml:45-52`(`//:sdk:install`+`//:sdk:build` depends), `server/mise.toml:68-74`(`//:plugins` + `//packages/plugin-core:build`) — 세 job의 툴체인 선택과 정합 |
| `extism-js` 바이너리의 binaryen 의존 | `strings extism-js` → `wasm-merge`, `wasm-opt`, `binaryen` — 주석 `:75-76`의 주장 성립 |
| java의 용도 | `mise.toml:22`의 `npm:@openapitools/openapi-generator-cli`가 `versions/7.24.0.jar`를 실행하는 JVM 래퍼 — `mise.toml:27`의 java는 여기 붙는다 |
| `server/src/enum.ts` | `:1` import, `:1267-1270` `z.enum(WorkflowTrigger)` — **값** 사용 맞음 |
| 산출물 gitignore 근거 | `git check-ignore -v` → `.gitignore:27:packages/**/build`, `packages/plugin-sdk/.gitignore:1:/dist` — 주석 `:60-61`의 "둘 다 gitignore" 맞음 |
| 트리거 주장(`:12-14`) 재검증 | 전 워크플로 YAML을 파싱: `push` 트리거를 가진 다른 9개는 전부 `branches: [main]`, `feat/**`를 깨우는 것은 이 파일뿐 |
| 액션 SHA 핀 | `actions/checkout@9c091bb…` = v7.0.0, `actions/upload-artifact@043fb46…` = v7.0.1 — GitHub API로 태그 SHA 대조, 둘 다 일치 |
| `npx prettier --check .github/workflows/fork-google-drive.yml` / `yaml.safe_load` | 통과, `jobs: ['feature','regression','medium']`, 3번째 스텝 `run` 5줄이 커밋 그대로 |
| 첨부 증거 `dev-test/google-drive/results/20260902-1159.txt` | `commit: 2defdb13e`, 8/239 · 3/29 · baseline · 1/10 · `RESULT: PASS` — 리포트 인용과 일치, 코드 커밋에서 생성됨 |
| 증거 숫자 **전부 독립 재현**(HEAD 상태) | server 8 spec `239 passed`, web 3 spec `29 passed`, `svelte-check` `COMPLETED 2692 FILES 7 ERRORS` → `sc_extract` 결과가 `svelte-check-baseline.txt`와 **완전 일치**, medium spec `10 passed` |

실험으로 옮긴 것은 gitignore된 `packages/sdk/build`, `packages/plugin-sdk/dist`,
그리고 두 패키지의 `node_modules`뿐이고 전부 원위치했다(md5 매니페스트와 `find` 목록 대조로 확인).
**최종 `git status --porcelain`은 이 리뷰 파일 외에 아무것도 보고하지 않는다.**

## Findings

이 커밋에 차단 이슈는 없다. 아래는 중요도 순이며, N1만 "다음 커밋에서 처리할 것"이고 나머지는 정리다.

### N1 (MEDIUM, 커밋 밖 · 러너 없이 확인 가능) — `regression` job은 테스트를 한 개도 돌리지 못하고 죽는다

`.github/workflows/fork-google-drive.yml:135-143`의 두 스텝은 `mise run //server:ci-unit`과
`mise run //web:ci-unit`이다. 두 태스크 리스트의 **첫 검사 단계가 `:format`**이고
(`server/mise.toml:58-66`, `web/mise.toml:45-52`), 지금 세 파일이 `prettier --check`에 걸린다.

```
$ mise run //web:ci-unit          # 직접 실행, exit 1
[//web:install] . prepare$ svelte-kit sync
[//web:format] [warn] src/lib/components/album-page/GoogleDriveAlbumMenu.spec.ts
[//web:format] [warn] src/lib/components/shared-components/context-menu/ButtonContextMenu.spec.ts
[//web:format] [ELIFECYCLE] Command failed with exit code 1
                                  # :check, :test 는 실행되지 않음
$ mise run //server:format        # 직접 실행, exit 1
[warn] test/medium/specs/repositories/google-drive.repository.spec.ts
```

세 파일 모두 이 포크가 작성했다(`861869fe7`, `a87422a7c`, `ceb9f95ec` — 전부 `GunwooYun`).
차이는 플러그인 취향 문제가 아니라 결정적이다: `@trivago/prettier-plugin-sort-imports`의 import
순서와 `printWidth: 120` 줄바꿈이고, server 쪽은 120칸에 들어가는 kysely 체인이 한 줄로 접히는 건이다.

왜 중요한가. `:112-114`는 이 job을 "업스트림 머지가 깨뜨린 것을 실제로 잡는 job"이라고 적었고
`:130-134`는 "둘 다 초록인 실행이 한 번 나오면 `continue-on-error`를 지운다"고 적었다. 지금 상태로
첫 실행을 하면 두 스텝 다 **포맷 단계에서** 실패하므로, 그 job이 존재하는 이유(스윕)는 한 번도
수행되지 않고 blocking 전환 조건도 영원히 성립하지 않는다. 그리고 `run.sh`에는 포맷 검사가 없어서
(`dev-test/google-drive/run.sh:132-133`, `:153-210`) 로컬 루프가 이걸 못 잡는다.

**고치는 법**(러너 불필요, 1분):

```bash
cd web    && npx prettier --write src/lib/components/album-page/GoogleDriveAlbumMenu.spec.ts \
                                  src/lib/components/shared-components/context-menu/ButtonContextMenu.spec.ts
cd server && npx prettier --write test/medium/specs/repositories/google-drive.repository.spec.ts
bash dev-test/google-drive/run.sh --medium     # 포맷만 바뀌므로 239/29/10은 그대로여야 한다
```

**주의**: 저는 `:format`까지만 확인했다. 그 뒤의 `:lint`(server, `--max-warnings 0`),
`:check`(`tsc --noEmit` + `svelte-check --no-tsconfig --fail-on-warnings`), 그리고 전체 유닛
스윕은 **아직 한 번도 실행되지 않았다** — 포맷을 고치면 그 다음 실패가 드러날 수 있다. 이건
"러너가 없어서 못 닫는 것"이 아니라 **로컬에서 3~15분이면 닫을 수 있는 것**이다.

### N2 (MEDIUM) — `:113-114`의 "over the whole workspace"는 사실이 아니다

```
      # ... Starts non-blocking: the fork has never run
      # these in CI, and `//web:ci-unit` includes `prettier --check .` over the whole workspace.
```

`//web:ci-unit`의 `:format`은 `web/mise.toml:24-25` → `web/package.json:19`
(`prettier --cache --check .`)이고, mise는 config root(`web/`)에서 태스크를 돌린다. 실측으로도
실패 출력의 경로가 `src/lib/...`로 **web 상대**였다. 즉 검사 범위는 `web/`뿐이고, `dev-docs/`나
`server/`는 포함되지 않는다(server는 `//server:ci-unit`의 별도 `:format`이 `server/`를 본다).
"non-blocking으로 시작하는" 진짜 이유는 N1이 보여주듯 **포크 파일 세 개**이지 workspace 전체
prettier가 아니다. 문장을 사실에 맞게 줄이면 된다.

### N3 (MEDIUM) — 고쳤다고 한 java 오류가 같은 파일 `:51-52`에 그대로 남아 있다

커밋 메시지는 "the comment blamed an 'extism/binaryen/java' toolchain … java is there for the
OpenAPI generator"라고 적었고 `:75-76`에서는 실제로 java를 뺐다. 그런데 **같은 파일 위쪽**은
그대로다.

```
51	      # Only node and pnpm: this job never builds plugin-core, so the wasm toolchain
52	      # (extism, binaryen, java) in the root mise.toml would be dead weight.
```

java는 wasm 툴체인이 아니다(직접 확인: `extism-js` 바이너리는 `wasm-merge`/`wasm-opt`/`binaryen`을
참조하고 JVM은 쓰지 않는다. `mise.toml:27`의 java는 `mise.toml:22`의 openapi-generator-cli가
`versions/7.24.0.jar`를 돌리기 위한 것이다). 직전 라운드의 N2가 지적한 **바로 그 문장**이 두 군데에
있었고 한 군데만 고쳐졌다. `:52`를 `(extism, binaryen)`으로 바꾸면 끝난다. 참고로 `:51`의
"이 job은 plugin-core를 빌드하지 않는다"는 주장 자체는 옳다.

### N4 (LOW) — `:83`의 `svelte-kit sync`는 `:82`가 이미 실행한다

`web/package.json:24`에 `"prepare": "svelte-kit sync"`가 있고, pnpm은 filtered install에서 선택된
workspace 프로젝트의 `prepare`를 (warm 상태에서도) 실행한다. 실제 저장소 로그로 확인했다.

```
[//web:install] $ pnpm install --filter immich-web --frozen-lockfile
[//web:install] . prepare$ svelte-kit sync
[//web:install] . prepare: Done
```

따라서 클린 러너에서 `:82`가 이미 `.svelte-kit`을 만들고, `:83`은 두 번째 sync다. **해롭지는
않다** — 명시적인 편이 낫다는 판단이면 그대로 두되, "`:82`의 `prepare`가 이미 돌리지만 의존을
문서화하려고 남긴다" 한 줄을 붙이는 게 정확하다. 지우기로 한다면 web의 `prepare`가 사라지는 날
조용히 깨지므로, 저는 **남기고 주석을 붙이는 쪽**을 권한다.

### N5 (LOW) — 실패한 실행이 2주 전의 `RESULT: PASS`를 요약에 찍는다

`:91-102`의 요약 스텝은 `if: always()`이고 `ls -t dev-test/google-drive/results/*.txt | head -1`로
파일을 고른다. `run.sh`는 시작하자마자 결과 파일을 쓰므로(`run.sh:106-111`) run.sh가 **돌기만 하면**
문제가 없다. 문제는 그 앞에서 죽는 경우다 — 즉 mise 설치 실패나 `Install workspaces` 실패, 이
스레드가 지난 세 라운드 동안 싸운 바로 그 시나리오다. 그때는 저장소에 커밋된 18개 결과 파일 중
하나가 뽑힌다. `git checkout-index`로 체크아웃을 모사하면 18개 mtime이 나노초까지 동일해지고
`ls -t | head -1`은 `dev-test/google-drive/results/20260820-0915.txt`를 고르며, 그 `tail -40`의
마지막 줄은 `RESULT: PASS`(commit `e642de962`, 2026-08-20)다. 실패한 job의 요약에 2주 전 PASS가
그대로 렌더된다.

고치는 법은 한 줄이다 — run 스텝 앞에 `touch "$RUNNER_TEMP/started"`를 두고
`find dev-test/google-drive/results -name '*.txt' -newer "$RUNNER_TEMP/started"`로 고르거나,
`run.sh`가 `$GITHUB_OUTPUT`에 `OUT` 경로를 흘리게 한다. 같은 이유로 `:104-110`의 아티팩트도
"이번 실행의 증거"가 아니라 커밋된 18개 + 새 1개다. 같은 필터를 쓰면 둘 다 정리된다.

### N6 (LOW, 잠복) — injection이 켜지는 날에는 새 형태가 옛 형태보다 **약하다**

`pnpm-workspace.yaml:65`의 `injectWorkspacePackages: true`는 지금 아무 일도 하지 않는다
(pnpm 11.13.1에서 최소 재현 workspace를 만들어 확인: `injectedDeps: {}` + symlink, 실제 저장소도
동일). 그런데 **만약** 어느 pnpm 버전이 이걸 실제로 이행하면, injection은 **install 시점에 소스
패키지를 복사**하므로 순서가 다시 문제가 된다:

- 옛 4줄(`sdk install` → `sdk build` → `plugin-sdk install` → `plugin-sdk build`)은
  plugin-sdk의 사본이 만들어질 때 `packages/sdk/build`가 이미 있으므로 안전하다.
- 새 2줄은 **두 install이 두 build보다 먼저** 오므로 사본에 `build/`가 없고,
  `plugin-sdk build`가 `Could not resolve "@immich/sdk"`로 죽는다.

즉 이 커밋은 "사람이 순서를 틀릴 수 없게" 만드는 대신 "링크 모드가 바뀌면 틀리는" 형태를
받아들였다. 오늘 기준으로는 **문제가 아니고**(symlink 실측), 되돌릴 이유도 없다. 다만
`packages/sdk/.npmignore`가 `src/`만 제외하고 `build/`는 포함한다는 점까지 확인해 두었으니,
pnpm 업그레이드로 `injectedDeps`가 비지 않게 되는 날 이 줄을 먼저 의심하라는 메모를 계획 문서에
남기는 편이 좋다.

### N7 (NITPICK) — 문구 두 개

- `:60-61` "each is needed at *runtime* by something this job runs" — `@immich/sdk`의 두 이유 중
  하나(plugin-sdk의 esbuild 번들링)는 **빌드 타임**이다. 바로 아래 `:64-67`이 정확히 설명하고
  있으므로 머리말 한 단어의 문제다.
- `:35` "the 12 spec files this feature owns" — `run.sh`가 소유한 spec은 12개가 맞지만
  (`run.sh:80-102`: server 8 + web 3 + medium 1), 이 job은 `--medium` 없이 돌리므로 **11개**를
  실행한다. 12번째(medium)는 `medium` job이 더 넓은 56-spec 스윕으로 덮는다. `:112-113`도 같은 표현.

## Answers to what the report asked me to attack

### 1. multi-filter가 `install --frozen-lockfile`에도 안전한가

**안전하다. 그리고 리포트가 못 한 부분(빈 `node_modules`)까지 실측으로 닫았다.**

두 패키지의 `node_modules`를 **실제로 치우고** 커밋된 install 줄을 돌렸다. 결과는 exit 0이고,
이번에는 `Already up to date`가 아니라 `Lockfile is up to date, resolution step is skipped`가 나왔다
— **frozen 검사가 실제로 수행됐다.** 복원된 트리는 실험 전 `find` 목록과 동일했고,
`packages/plugin-sdk/node_modules/@immich/sdk`는 `../../../sdk` symlink였다. 필터를 뒤집어
같은 실험을 반복해도 결과가 동일하다. 순서·링크 어느 쪽도 달라지지 않는다.

왜 안전한지의 **구조적 이유**도 세 가지로 닫힌다.

1. **install이 산출물을 만들 경로가 없다.** `packages/sdk/package.json:19-21`의 스크립트는
   `"build": "tsc"` 하나뿐이고 `prepare`/`postinstall`이 없다. 따라서 install을 먼저 몰아서
   해도 잃는 것이 없다.
2. **링크가 symlink다.** 위 실측 + pnpm 11.13.1 최소 재현(스크래치 workspace, 같은
   `injectWorkspacePackages: true`)에서 둘 다 `injectedDeps: {}` + symlink였다. symlink이므로
   install 이후에 `packages/sdk/build`가 생겨도 소비자에게 즉시 보인다. (사본이었다면 얘기가
   달라진다 — N6.)
3. **filtered install은 앞서 설치한 프로젝트를 prune 하지 않는다.** 스크래치에서 a+b 설치 후 c만
   설치해도 b의 링크가 살아 있음을 확인했다. 워크플로의 4연속 install 형태 자체가 안전하다.

덤으로 하나가 닫혔다. `--frozen-lockfile`은 **필터가 걸려 있어도 workspace 전체 importer**를
검사한다(스크래치에서 선택되지 않은 importer의 specifier만 바꿔도 exit 1). 그러므로 실제
저장소의 filtered install이 통과했다는 것은 **`pnpm-lock.yaml`이 12개 workspace `package.json`
전부와 정합하다**는 뜻이다 — 직전 리뷰가 "검증 못 함"으로 남긴 항목이다. 스토어 다운로드가 필요한
완전 콜드 install은 여전히 안 돌렸지만, 러너에서 실패한다면 그건 lockfile 정합성이 아니라
네트워크/스토어 쪽 이유일 것이다.

한 가지 반쯤 놀란 점: `pnpm-workspace.yaml:67`의 `verifyDepsBeforeRun: install`은 **구조기가
아니다.** `node_modules`가 없는 상태에서 `pnpm --filter b build`를 돌려보면 자동 install 없이 그냥
실패하고 사후에 경고만 남긴다. "pnpm이 알아서 채워줄 것"에 기대면 안 된다.

### 2. 다시 쓴 주석이 정확한가

**세 문단 다 사실과 맞다.** 한 단어(N7)만 느슨하다.

- **"둘 다 gitignore"** — `git check-ignore -v`로 확인: `.gitignore:27:packages/**/build`,
  `packages/plugin-sdk/.gitignore:1:/dist`. 클린 체크아웃에 둘 다 없다는 것도 맞다.
- **"`@immich/plugin-sdk` — `server/src/enum.ts`가 값으로 import"** — `enum.ts:1` import,
  `enum.ts:1267-1270` `z.enum(WorkflowTrigger)`. 타입 전용이 아니라 값 사용이 맞고,
  진입점은 `packages/plugin-sdk/package.json:11-15`의 `dist/index.js`가 맞다.
- **"web 스펙이 `@immich/sdk`를 import 한다"** — `packages/sdk/build`를 치우고 `run.sh`의 web
  3개를 돌리면 2개가 죽고, 메시지가 주석의 인용과 동일하다
  (`Failed to resolve import "@immich/sdk" from "src/lib/managers/google-drive-progress-manager.svelte.spec.ts"`,
  그리고 `from "src/lib/route.ts"`). 세 번째(`ButtonContextMenu.spec.ts`)는 통과 — "web 스펙"이
  세 개 전부는 아니라는 뜻이지만 주석이 "the web specs"라고만 했으므로 틀린 표현은 아니다.
- **"server 스펙은 필요 없다"** — 요청대로 **정확히 그 8개**로 확인했다:
  `src/utils/google-drive.spec.ts`, `src/services/google-drive.service.spec.ts`,
  `src/services/album.service.spec.ts`, `src/services/queue.service.spec.ts`,
  `src/services/server.service.spec.ts`, `src/services/system-config.service.spec.ts`,
  `src/config.spec.ts`, `src/utils/misc.spec.ts` → `packages/sdk/build` 없이
  **8 passed / 239 passed**. 이유(주석의 "bundling inlines it")도
  `packages/plugin-sdk/esbuild.js:6`의 `bundle: true`와 일치한다.
- **"`build:wasm`은 extism-js와 binaryen을 요구하고 java는 OpenAPI 생성기용"** —
  `packages/plugin-core/package.json:9`가 `extism-js … -o dist/plugin.wasm`이고, 설치된
  `extism-js` 바이너리의 문자열에 `wasm-merge`/`wasm-opt`/`binaryen`이 들어 있다. java는
  `mise.toml:22`의 openapi-generator-cli(`versions/7.24.0.jar`를 실행하는 JVM 래퍼) 쪽이다.
  **다만 같은 파일 `:51-52`에 옛 문장이 살아 있다(N3).**
- **"mise.toml의 `//:plugins`가 같은 관용구"** — `mise.toml:50-54`. 맞다.

### 3. 아래 세 줄에 암묵적 순서가 남아 있는가

**남아 있는 순서는 하나뿐이고, 그것도 이미 이중으로 보장된다.**

- `:81` `pnpm --filter immich install` — server의 `node_modules`(vitest 포함)를 만든다. 이 줄은
  다른 줄과 순서 의존이 없다. `@immich/plugin-sdk`는 symlink로 붙을 뿐이고, `dist`는 spec 실행
  시점에만 필요하며 그때는 `:80`이 이미 끝나 있다. 없으면 server 스펙 전부가 vitest 부재로 죽는다.
- `:82` `pnpm --filter immich-web install` — 마찬가지. 순서 의존 없음, 없으면 web 스펙과
  svelte-check가 죽는다.
- `:83` `pnpm --filter immich-web exec svelte-kit sync` — **유일한 진짜 순서 의존**이다
  (`svelte-kit` 바이너리가 `:82`의 산물이므로). 그런데 `:82`의 install이 `web/package.json:24`의
  `prepare`로 **이미 같은 명령을 실행**한다(실제 저장소 로그로 확인, N4). 즉 순서를 틀리게 쓸
  방법이 사실상 없다 — `:83`을 `:82`보다 앞에 두면 그 줄만 실패하고, 뒤에 두면 중복 실행이다.

셋 중 하나라도 빠지면 클린 러너에서 깨지느냐: `:81`/`:82`는 **깨진다**(각각 server/web 러너의
`node_modules` 자체가 없다). `:83`은 **깨지지 않는다** — `:82`의 `prepare`가 덮는다. 그리고
`:79-80`을 `:81-82`와 합치는 것도 가능하지만(같은 관용구를 끝까지 밀면
`pnpm --filter immich --filter immich-web install --frozen-lockfile` 한 줄), **권하지 않는다**:
지금 `sdk build`가 `immich-web install`보다 앞선다는 성질이 N6의 잠복 위험에 대한 방어선이므로,
빌드와 install의 경계를 더 흐리지 않는 편이 낫다.

## 요청받은 두 가지 판단

### (a) 이번 라운드로 CI 스레드를 닫는 것에 동의하는가 — **동의하지 않는다**

리포트의 논거는 "남은 미검증은 전부 '러너가 한 번도 안 돌았다'이고 리뷰로는 못 닫는다"인데,
**그 분류가 틀렸다.** 러너 없이 지금 닫을 수 있고 실제로 CI 결과를 바꾸는 항목이 최소 두 개 있다.

1. **N1** — `//server:ci-unit`·`//web:ci-unit`이 포크 파일 3개의 포맷 때문에 첫 검사에서 죽는다.
   러너에서 확인할 필요가 없다. 로컬에서 `mise run`으로 재현했고, 고치는 데 1분이다. 이걸 두고
   스레드를 닫으면 첫 CI 실행의 결과는 "빨간 스윕 + 아무 테스트도 안 돌아감"이고, 그때 다시 이
   대화를 열게 된다.
2. **N3** — 이번 커밋이 고쳤다고 선언한 오류가 같은 파일에 그대로 남아 있다. "고쳤다"는 기록과
   파일이 어긋난 상태로 닫는 것은 다음 사람에게 최악이다.

여기에 N2(주석이 사실과 다름)와 N5(실패 실행이 옛 PASS를 표시)를 더하면, "한 라운드 더"의
비용은 작고 이득은 명확하다. **제안**: N1(포맷 3파일) + N2/N3(주석) + N5(요약 스텝)를 한 커밋으로
묶고, 그 뒤에 "Actions를 켜고 한 번 돌린다"를 별도 작업으로 넘기는 것에는 동의한다. 그 시점의
미검증 목록은 진짜로 러너가 필요한 것만 남는다(`jdx/mise-action@v3` 동작, 콜드 install 시간,
`$GITHUB_STEP_SUMMARY` 렌더링, 20/40/25분 타임아웃의 현실성).

### (b) 파일 전체가 하나로 맞물리는가 — **대체로 맞물린다. 어긋난 곳은 위의 N들뿐이다.**

세 라운드 동안 각각 다른 부분을 건드렸지만 구조적 모순은 생기지 않았다.

- **트리거**: `:17-26`. 다른 워크플로 9개는 전부 `push: branches: [main]`이라 `feat/**`를 깨우지
  않는다(전수 파싱으로 확인). `paths-ignore`의 세 항목은 이 저장소의 문서/증거 경로와 맞고,
  `**/*.md`가 있어서 리뷰 문서 커밋만으로는 CI가 돌지 않는다 — 실제로 `b41bd97c1`이 그런 커밋이다.
- **권한**: 워크플로 레벨 `permissions: {}` + job마다 `contents: read`, 체크아웃은
  `persist-credentials: false`. 최소 권한이고 체크아웃/아티팩트에 부족함이 없다(아티팩트 업로드는
  `GITHUB_TOKEN`이 아니라 런타임 토큰을 쓴다 — 문서 기준이고 실행으로 확인하지는 않았다).
  first-party 액션 둘은 SHA 핀이고 태그와 일치함을 API로 대조했다. `jdx/mise-action@v3`만 태그
  핀이지만 업스트림도 `actions/cache@v3`·`setup-java@v3` 등을 태그로 쓰고 있어 저장소 관행에서
  벗어나지 않는다 — 지적하지 않는다.
- **세 job의 툴체인 선택**: 이제 근거가 코드와 일치한다. `feature`는 `install_args: node pnpm`이고
  plugin-core를 빌드하지 않는다(직접 두 패키지만 빌드). `regression`은 `//server:ci-unit` 안에
  `//:plugins`가 있어 자급자족한다(`server/mise.toml:61`). `medium`은 `//server:ci-medium`이
  `//:plugins` + `//packages/plugin-core:build`를 부르므로(`server/mise.toml:71-72`) wasm
  툴체인이 **실제로 필요**하고, 그래서 `install_args` 없이 mise 전체를 까는 것이 맞다.
  submodule을 `medium`만 recursive로 받는 것도 맞다 — `testAssetsDir`는
  `server/test/medium.factory.ts:89`에만 있고 유닛 스펙에는 `test-assets` 참조가 0건이다.
- **아티팩트/요약**: 여기만 설계가 절반이다(N5). 성공 경로는 정확하지만 실패 경로에서 옛 증거를
  집는다. 나머지 주석(`:88-90`)의 "커밋하지 않고 업로드한다"는 근거는 타당하다.

즉 "누더기"는 아니다. 남은 것은 (i) 실패 경로 하나, (ii) 사실과 어긋난 주석 두 곳, (iii) 파일
밖에 있지만 이 파일이 만든 작업(포맷 3개)이다.

## What I did not verify

- **CI를 여전히 한 번도 돌리지 않았다.** `jdx/mise-action@v3`의 실제 동작, Actions 활성 여부,
  콜드 러너의 소요 시간과 `timeout-minutes: 20/40/25`의 현실성, `$GITHUB_STEP_SUMMARY`와
  `::warning::` 렌더링, 아티팩트 업로드가 `permissions: contents: read`로 충분한지 — 전부 문서와
  로컬 재현에 근거한 판단이다.
- **완전한 콜드 install**(빈 스토어 + 네트워크). 제가 지운 것은 두 패키지의 `node_modules`까지이고
  `node_modules/.pnpm` 가상 스토어와 글로벌 스토어는 살아 있었다. 다만 lockfile specifier 검사는
  이번에 실제로 수행됐다(위 §1).
- **`//server:ci-unit`/`//web:ci-unit`의 `:format` 이후 단계.** `:lint`, `:check`, 전체 유닛 스윕은
  포맷 실패로 실행되지 않았고, 저도 따로 돌리지 않았다. N1을 고친 뒤 무엇이 더 나올지는 열려 있다.
- **`//server:ci-medium`의 56-spec 전체.** 저는 feature의 medium 1개(10/10)만 돌렸다.
- **injection이 실제로 걸리는 pnpm 버전에서의 동작**(N6). "그때는 새 형태가 깨진다"는 것은
  injection의 복사 시맥을 근거로 한 **추론**이며 관찰이 아니다. 관찰한 것은 "지금은 symlink"까지다.
- **mise가 config root 디렉터리에서 태스크를 돈다**는 것은 실패 출력의 상대 경로로 **간접**
  확인했다(`mise tasks info`는 dir을 출력하지 않는다). 결론(prettier 범위가 web)은 그 출력만으로도
  성립한다.
- **`ls -t`가 실제 러너 체크아웃에서 무엇을 고르는지.** `git checkout-index`로 모사했을 때는 18개
  mtime이 동일해 가장 오래된 파일이 뽑혔다. `actions/checkout`이 파일마다 다른 mtime을 남기면
  뽑히는 파일이 달라지지만, **커밋된 옛 증거라는 점은 어느 쪽이든 같다.**
- 실험 중 이동한 것은 gitignore된 산출물과 두 패키지의 `node_modules`뿐이고 전부 복원했다.
  `mise run //web:ci-unit`이 `svelte-kit sync`와 `sdk build`를 다시 돌렸지만 산출물 md5는 실험 전과
  동일하다. **최종 `git status --porcelain`은 이 리뷰 파일 외 변경을 보고하지 않는다.**

## Feeding back into the plan

`wave6-plan.md`에 남길 것은 네 줄이다.

1. **"`run.sh`는 CI가 돌리는 것의 부분집합이다 — 포맷/린트가 빠져 있다."** 이번 라운드가 찾은 가장
   비싼 사실이다. `run.sh`에 `prettier --check`를 (최소한 이 기능이 소유한 파일 목록에 대해)
   더하거나, "커밋 전 `mise run //web:format`·`//server:format`" 한 줄을 체크리스트에 넣는다.
   그러지 않으면 로컬 초록과 CI 빨강이 계속 어긋난다.
2. **"pnpm의 `--frozen-lockfile`은 필터와 무관하게 workspace 전체를 검사한다."** 따라서 filtered
   install 한 번의 성공이 lockfile 전체 정합성의 증거다. 반대로 관계없는 패키지의
   `package.json`만 건드려도 이 job의 네 install 줄이 전부 죽는다 — 업스트림 머지 후 첫 확인
   포인트로 적어 둘 값어치가 있다.
3. **"`injectWorkspacePackages: true`는 현재 무효(symlink)다. 유효해지는 순간 install/build를
   합친 이번 형태가 먼저 깨진다."** pnpm 업그레이드 때 `node_modules/.modules.yaml`의
   `injectedDeps`가 비어 있는지 확인하고, 비어 있지 않으면 `.github/workflows/fork-google-drive.yml:79-80`을
   패키지별 install→build 순서로 되돌린다.
4. **"`if: always()` 요약 스텝은 '이번 실행이 만든 산출물'만 봐야 한다."** 저장소에 같은 이름
   패턴의 과거 증거가 커밋되어 있는 한 `ls -t`는 언제든 옛 PASS를 집는다. 시작 시각 sentinel
   또는 `$GITHUB_OUTPUT` 경로 전달로 고정한다.
