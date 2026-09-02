# Code Review — round-11 빌드 순서 수정 (`sdk` → `plugin-sdk`)

| | |
|---|---|
| Branch / HEAD | `feat/google-drive-album-sync-v3.1.0` / `ed9c564db` (리포트 + 직전 리뷰 파일만 추가) |
| Commits reviewed | `4e10792d3` (단일) |
| Report | `../report/google-drive-wave6-round11-order-20260902-1146-report.md` |
| Prior review | `google-drive-wave6-round10-fixes-20260902-0952-review.md` (C1-again) |
| Reviewed | 2026-09-02 |

## Verdict

**수정은 맞다. 진단도 맞고, 순서도 맞고, 사슬도 완전하다.** 리포트가 주장한 양방향 재현을 그대로
재현했고(역순 `exit 1`, 정순 성공), 더 나아가 **저장소에 존재하는 gitignore된 빌드 산출물 5개를
전부 치운 뒤** 이 job이 실제로 실행하는 세 줄(`sdk build` → `plugin-sdk build` →
`svelte-kit sync`)만 돌리고 `run.sh`가 돌리는 전부(server 8 spec 239/239, web 3 spec 29/29,
svelte-check 베이스라인 대조)를 통과시켰다. 즉 §1의 "사슬이 완전한가"는 추론이 아니라 실측으로
닫힌다. 리포트가 닫았다고 한 C2/C3/N2도 전부 독립 확인했고 동의한다. 가장 중요한 문제는
**버그가 아니라 강제 수단**이다 — `.github/workflows/fork-google-drive.yml:66-77`의 네 줄은
주석 대신 **두 줄의 multi-filter 호출로 바꾸면 순서를 틀리게 쓰는 것 자체가 불가능**해진다.
`pnpm --filter @immich/plugin-sdk --filter @immich/sdk build`를 **일부러 역순으로 나열해서**
돌려봐도 pnpm이 `packages/sdk build: Done` → `packages/plugin-sdk build: Done` 순으로 스스로
정렬한다(실측). 이 경로는 `//:plugins`와 달리 `plugin-core`를 건드리지 않으므로, 앞선 라운드가
`//:plugins`를 기각한 이유(extism/binaryen 툴체인)에 걸리지 않는다. 두 라운드 연속으로 같은
함정에 빠진 항목을 사람의 주의력에 다시 맡기는 것이 이 커밋의 유일한 약점이다(N1, 비차단).

### Evidence I ran myself

| Check | Result |
|---|---|
| `git show 4e10792d3 --stat` | `.github/workflows/fork-google-drive.yml` (+11/-2)와 직전 리뷰 `.md` 하나뿐 — 코드 변경 없음, 생성물 없음 |
| **역순 재현**: `packages/sdk/build`·`packages/plugin-sdk/dist` 이동 후 `pnpm --filter @immich/plugin-sdk build` | `✘ [ERROR] Could not resolve "@immich/sdk"` at `src/host-functions.ts:7:7`, `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`, **exit 1** — 리포트 표와 문자 단위로 일치 |
| **정순 재현**: 같은 상태에서 `pnpm --filter @immich/sdk build` → `pnpm --filter @immich/plugin-sdk build` | 둘 다 성공, 산출 파일 목록이 실험 전 manifest와 **완전 동일** |
| **사슬 전체 실측**: `packages/sdk/build`, `packages/plugin-sdk/dist`, `packages/plugin-core/dist`, `server/dist`, `web/.svelte-kit`를 전부 치운 뒤 job의 세 줄만 실행 | 세 줄 모두 성공 |
| 그 상태에서 server 8 spec (`npx vitest run --config test/vitest.config.mjs …`) | `Test Files 8 passed (8)`, `Tests 239 passed (239)` |
| 그 상태에서 web 3 spec (`npx vitest run …`) | `Test Files 3 passed (3)`, `Tests 29 passed (29)` |
| 그 상태에서 `npx svelte-check --output machine` (web) | `COMPLETED 2692 FILES 7 ERRORS`; `run.sh`의 `sc_extract`로 뽑은 파일별 카운트가 `dev-test/google-drive/svelte-check-baseline.txt`와 **완전 일치**(3파일 2/2/3) |
| `git status --porcelain --ignored=matching` | node_modules/.pnpm-store/.claude/.agents를 빼면 gitignore된 산출물은 위 **5개가 전부** — 빠뜨린 후보가 없음을 확인 |
| `packages/sdk/build`만 치우고 `pnpm --filter immich-web exec svelte-kit sync` | **exit 0** — `svelte-kit sync`는 `@immich/sdk` 산출물을 요구하지 않는다 |
| `packages/sdk/build`만 치우고 web 3 spec | `2 failed, 1 passed` — web **유닛 테스트**는 `@immich/sdk` 빌드를 요구한다 |
| `packages/sdk/build`만 치우고 (`plugin-sdk/dist`는 둔 채) server spec 2개 | `20 passed` — server 런타임은 `sdk` 빌드를 요구하지 않는다(`plugin-sdk`가 bundle 했으므로) |
| `pnpm --filter @immich/plugin-sdk install --frozen-lockfile` (sdk build 부재 상태) | `Already up to date`, exit 0, `packages/plugin-sdk/node_modules/@immich/sdk`는 여전히 `../../../sdk` **symlink**, `packages/sdk/build` 생성 **안 됨** |
| `node_modules/.modules.yaml` | `"injectedDeps": {}`, `"nodeLinker": "isolated"` — `pnpm-workspace.yaml:63`의 `injectWorkspacePackages: true`에도 현재 설치는 injection이 아님 |
| **구조적 대안**: 양쪽 산출물 제거 후 `pnpm --filter @immich/plugin-sdk --filter @immich/sdk build` (나열 순서 역순) | `Scope: 2 of 12` → `packages/sdk build: Done` → `packages/plugin-sdk build: Done`, exit 0 — **나열 순서와 무관하게 위상 정렬** |
| `npx prettier --check .github/workflows/fork-google-drive.yml` | `All matched files use Prettier code style!` |
| `python3 yaml.safe_load` 파싱 | `jobs: ['feature','regression','medium']`, `feature` 3번째 스텝 `run`이 커밋된 7줄 그대로 |
| C3: `regression`/`medium` 스텝 메타데이터 | `id=server/web/medium`, `continue-on-error=True`, 요약 스텝 `if: always()` — 리포트 주장대로 |
| C2: 8개 feature server spec에 `test-assets`/`testAssetsDir` grep | 0건 |
| N2: `server/src/dtos/system-config.dto.ts:463-465` | `export function mapConfig(config: SystemConfig): SystemConfigDto { return config; }` — identity 맞음 |
| 첨부 증거 `dev-test/google-drive/results/20260902-1145.txt` | `commit: 4e10792d3`, 내부 수치가 리포트 인용 블록과 완전 일치(239/29/베이스라인/10, `RESULT: PASS`) |
| medium spec 직접 재실행 (`test/vitest.config.medium.mjs`, testcontainers) | `Tests 10 passed (10)` |

실험 중 옮긴 산출물은 전부 원위치했고, `packages/sdk/build`·`packages/plugin-sdk/dist`·
`packages/plugin-core/dist`·`server/dist`·`web/.svelte-kit`의 파일 목록이 실험 전과 동일함을
`diff`로 확인했다. **`git status --porcelain`은 이 리뷰 파일 외에 아무 변경도 보고하지 않는다.**

## Findings

차단 이슈 없음. 아래는 전부 비차단이고, 순서대로 중요도가 낮아진다.

### N1 (MEDIUM, 비차단) — 주석 대신 구조로 강제할 수 있고, 그 방법이 실재한다

`.github/workflows/fork-google-drive.yml:66-77`은 지금 이렇게 되어 있다.

```yaml
      # ORDER MATTERS: @immich/sdk must be built before @immich/plugin-sdk, not after.
      ...
          pnpm --filter @immich/sdk install --frozen-lockfile
          pnpm --filter @immich/sdk build
          pnpm --filter @immich/plugin-sdk install --frozen-lockfile
          pnpm --filter @immich/plugin-sdk build
```

이 네 줄은 두 줄로 줄이면서 동시에 **순서를 틀릴 수 없게** 만들 수 있다.

```yaml
          pnpm --filter @immich/sdk --filter @immich/plugin-sdk install --frozen-lockfile
          pnpm --filter @immich/sdk --filter @immich/plugin-sdk build
```

근거는 추론이 아니라 실측이다. 산출물을 둘 다 지운 상태에서 **나열 순서를 일부러 뒤집어**
`pnpm --filter @immich/plugin-sdk --filter @immich/sdk build`를 돌리면 pnpm이
`packages/sdk build: Done` → `packages/plugin-sdk build: Done` 순으로 스스로 정렬하고 exit 0이다.
같은 형태를 `mise.toml:50-54`의 `[tasks.plugins]`가 이미 쓰고 있고(거기에 `plugin-core`가 한 개
더 붙어 있을 뿐이다), 직전 리뷰도 3-filter 형태로 같은 성질을 확인한 바 있다.

이렇게 바꾸면 "ORDER MATTERS" 주석 6줄(`:65-71`)은 필요 없어진다 — 남길 이유가 있다면 "왜
`//:plugins`가 아닌가"(`:63-64`)뿐이다. 두 라운드 연속으로 걸린 함정을 사람의 주의력에 맡기는
대신 도구의 위상 정렬에 맡기는 쪽이 맞다. 다만 **지금 커밋이 틀렸다는 뜻은 아니다.** 커밋된 순서는
정확히 동작하며, 이 지적은 "다음 사람이 이걸 또 틀릴 수 있는가"에 대한 답이다. 리포트의 §3이 물은
것이 정확히 이것이고, 답은 "있다, 그리고 `//:plugins`를 쓰지 않고도 된다"이다.

### N2 (NITPICK) — `//:plugins` 기각 사유의 `java`는 부정확하다

`.github/workflows/fork-google-drive.yml:63-64`는 `mise //:plugins`가 "extism/binaryen/java
toolchain"을 요구한다고 적었다. `packages/plugin-core/package.json:6-8`의 빌드는
`plugin-sdk prepareBuild && tsc --noEmit && node esbuild.js`와 `extism-js … -o dist/plugin.wasm`이고,
`mise.toml:24-26`이 `github:extism/cli`·`github:webassembly/binaryen`·`github:extism/js-pdk`를
설치한다. `java = "21.0.2"`(`mise.toml:27`)는 `npm:@openapitools/openapi-generator-cli`
(`mise.toml:22`, Dart SDK 생성)를 위한 것으로 보이며 plugin-core 빌드 경로에는 등장하지 않는다.
**기각 결론 자체는 여전히 유효하다**(extism + binaryen만으로도 `install_args: node pnpm`으로는
못 돈다). 주석에서 `java`만 빼면 된다. 순수 나이트픽이다.

### N3 (NITPICK, 범위 밖) — `.claude/`가 gitignore 되어 있다

`git check-ignore -v .claude/rules/coding-principles.md` → `.gitignore:16:.claude`이고
`git ls-files .claude`는 비어 있다. 루트 `CLAUDE.md`는 `.claude/rules/`를 "checked into the
codebase"인 것처럼 참조하지만 실제로는 추적되지 않는다. 이번 커밋과 무관하고 CI에도 영향이 없어
findings에 넣기는 애매하지만, 확인 가능한 사실이라 남긴다.

## Answers to what the report asked me to attack

### 1. 이 순서로 정말 충분한가 — 사슬은 완전한가

**완전하다. 그리고 이건 추론이 아니라 실측이다.**

먼저 후보를 추론이 아니라 열거로 닫았다. `git status --porcelain --ignored=matching`을 돌리면
이 저장소에서 gitignore된 산출물 디렉터리는 `packages/sdk/build`, `packages/plugin-sdk/dist`,
`packages/plugin-core/dist`, `server/dist`, `web/.svelte-kit` **다섯 개가 전부**다
(`packages/cli/dist`는 애초에 존재하지 않는다). 다섯 개를 전부 치우고 job의 세 줄만 실행한 뒤
`run.sh`가 돌리는 것 전부를 돌렸고, 결과는 239/239 · 29/29 · svelte-check 베이스라인 완전 일치였다.
즉 `plugin-core/dist`도 `server/dist`도 이 job의 어떤 spec에도 필요 없다.

**`svelte-kit sync`에 대해서는 리포트의 우려가 빗나갔다 — 다만 결론은 같다.**
`packages/sdk/build`만 치운 상태에서 `pnpm --filter immich-web exec svelte-kit sync`는 **exit 0**로
성공한다. `sync`는 `.svelte-kit/tsconfig.json`과 타입 앰비언트만 생성하므로 `@immich/sdk` 산출물을
보지 않는다. 대신 **web 유닛 테스트가 본다**: 같은 상태에서 3개 web spec을 돌리면 2개 파일이
`import`에서 죽는다. 그리고 `svelte-check`는 `@immich/sdk`의 `.d.ts`(`packages/sdk/build/index.d.ts`,
`package.json`의 `types`)를 통해 본다. 요컨대 `pnpm --filter @immich/sdk build` 줄은 **두 가지
이유로** load bearing이다 — (a) `plugin-sdk` 번들이 빌드 타임에 resolve하고, (b) web 유닛/타입
검사가 런타임·타입 타임에 resolve한다. 커밋 주석은 (a)만 적었다. 지금은 어차피 같은 한 줄이므로
문제가 아니지만, 언젠가 "이 job은 server만 돌리니 sdk 빌드를 빼자"는 판단이 나올 때 주석이
막아주지 못한다(N1 수정과 함께 한 줄 보태두면 좋다).

반대 방향도 확인했다. `packages/sdk/build`가 없고 `plugin-sdk/dist`만 있으면 server spec은
그대로 통과한다(20/20). `plugin-sdk`가 `bundle: true`로 `@immich/sdk`를 **자기 dist 안에 인라인**
하기 때문이며(`packages/plugin-sdk/esbuild.js:6`), 이것이 `server/package.json:40`의
`@immich/plugin-sdk`가 유일한 workspace 산출물 의존인 이유와 맞물린다.

### 2. 로컬 재현 실험은 타당했는가 — `install`을 건너뛴 것이 결론을 바꾸는가

**바꾸지 않는다. 그리고 이유는 pnpm의 링크 방식이 아니라 `packages/sdk/package.json`에 있다.**

`packages/sdk/package.json`의 `scripts`에는 `"build": "tsc"` **하나뿐**이다. `prepare`도
`prepublish`도 `postinstall`도 없다. 어떤 install 전략을 쓰든 install이 `build/index.js`를 만들어낼
경로가 존재하지 않는다. 실제로 `packages/sdk/build`가 없는 상태에서
`pnpm --filter @immich/plugin-sdk install --frozen-lockfile`을 돌려보면 exit 0로 끝나고
`packages/sdk/build`는 생기지 않는다. 링크는 `packages/plugin-sdk/node_modules/@immich/sdk ->
../../../sdk` symlink 그대로다.

pnpm의 링크 방식을 근거로 반박할 여지도 따져봤다. `pnpm-workspace.yaml:63`에
`injectWorkspacePackages: true`가 있어 hard-link injection이 걸릴 수 있는데, 현재 설치의
`node_modules/.modules.yaml`은 `"injectedDeps": {}`이고 실제 링크도 symlink였다. **만약** 클린
러너에서 injection이 실제로 걸린다면 결론은 오히려 더 강해진다: injection은 install 시점에
소스 패키지를 **복사**하므로, 빌드가 소비자의 install보다 늦으면 복사본에 산출물이 없다.
커밋된 순서는 우연히 이것까지 만족한다 — `sdk build`(:75)가 `plugin-sdk install`(:76)보다 앞서고,
`plugin-sdk build`(:77)가 `immich install`(:78)보다 앞서고, `sdk build`가 `immich-web
install`(:79)보다 앞선다. 어느 링크 모드에서도 이 순서는 옳다.

한 가지는 남는다: 제 install 호출은 `Already up to date`로 즉시 반환했다. 즉 **`--frozen-lockfile`
검증이 진짜로 수행되지는 않았다.** 완전히 빈 `node_modules`에서 lockfile이 12개 workspace
`package.json`과 정합한지는 리포트도 저도 확인하지 못했다(아래 "검증 못 한 것" 참조).

### 3. 주석이 옳은 강제 수단인가 — `//:plugins` 기각은 여전히 유효한가

**주석은 최선이 아니고, 그러면서도 `//:plugins`로 갈 필요는 없다.** N1이 그 답이다:
multi-filter 한 줄이면 pnpm이 위상 정렬하므로 순서를 틀릴 수가 없고, `plugin-core`는 선택에서
빠지므로 툴체인 문제도 없다. 나열 순서를 뒤집어 돌려서 확인했다.

`//:plugins` 기각 자체는 유효하다. `mise.toml:50-54`의 `[tasks.plugins]`는
`--filter @immich/plugin-core`를 포함하고, `packages/plugin-core/package.json`의 build는
`build:wasm`에서 `extism-js`를 호출한다. `feature` job은
`.github/workflows/fork-google-drive.yml:53-56`에서 `install_args: node pnpm`으로 mise 툴을
두 개만 깐다 — `github:extism/cli`, `github:webassembly/binaryen`, `github:extism/js-pdk`
(`mise.toml:24-26`)는 설치되지 않는다. 따라서 `//:plugins`를 쓰면 3~5분짜리 툴체인 설치가
붙거나 wasm 빌드에서 죽는다. 다만 기각 사유 문구에서 `java`는 빼는 게 맞다(N2).

### 4. 리포트에 과장이 있는가

**주장 자체에는 없다.** 확인한 것만 적자면:

- "이 수정은 실제로 존재하는 실패를 없앤다" — **사실이다.** 역순 재현이 exit 1로 죽는 것을
  같은 명령·같은 에러 위치(`src/host-functions.ts:7:7`)로 재현했다.
- 첨부 증거는 실제 파일과 일치하고, `commit: 4e10792d3`(11:45:54)은 커밋 시각(11:45:52) 직후로
  **코드를 포함한 커밋에서 생성**된 것이 맞다. §2 요구를 충족한다.
- "YAML 파싱 + `prettier --check`" — 둘 다 재현했다.
- C2 / C3 / N2를 "수정 없음"으로 닫은 판단에 **전부 동의**한다. 세 가지 모두 제가 원 리뷰에서
  제기한 것이고, 이번에 독립적으로 다시 확인했다(위 표의 마지막 네 행).

굳이 흠을 잡자면 정밀도 문제 두 개뿐이고, 둘 다 나이트픽 미만이다. (i) "`host-functions.ts:7`
`@immich/sdk`에서 값을 import"에서 값 심볼 `getAllAlbums`는 2행이고 7행은 `} from '@immich/sdk';`
닫는 줄이다 — esbuild가 지목하는 위치와 같으므로 표기로서 틀린 건 아니다. (ii) "직접 재현한 것
(양방향)"이 클린 러너를 대표하는 것처럼 읽힐 수 있으나, 리포트 스스로 §2에서 `install`을 건너뛴
사실을 밝히고 있어 은폐가 아니다.

## What I did not verify

- **CI를 여전히 한 번도 돌리지 않았다.** 이 리뷰의 모든 결론은 로컬 재현이지 러너 로그가 아니다.
  `jdx/mise-action@v3`의 `install_args: node pnpm` 동작, Actions 활성 여부, 클린 러너 소요 시간은
  직전 라운드와 똑같이 열려 있다.
- **빈 `node_modules`에서의 `--frozen-lockfile`.** 제 install 호출은 `Already up to date`로
  단축 종료했으므로 lockfile 정합성 검사가 실제로 수행되지 않았다. 완전한 클린 install(스토어
  다운로드 포함)은 시간·네트워크 비용 때문에 돌리지 않았다.
- **클린 install에서 `injectWorkspacePackages: true`가 실제로 injection을 유발하는지.** 현재
  설치는 `injectedDeps: {}` + symlink였다. "injection이 걸려도 커밋된 순서는 옳다"는 위 논증은
  **관찰이 아니라 추론**이다.
- **GitHub Actions의 `run:` 기본 셸이 `bash -e`라서 `sdk build` 실패 시 스텝이 그 줄에서
  중단된다**는 점 — 문서상 기본값을 근거로 했을 뿐 실행으로 확인하지 않았다.
- **`//server:ci-unit`, `//web:ci-unit`, `//server:ci-medium`(56 spec) 전체.** 저는 feature
  job이 돌리는 8+3 spec과 feature의 medium spec 1개(10/10)만 돌렸다. `regression`·`medium` job은
  이번 커밋이 건드리지 않았고 `//:plugins`를 쓰므로 순서 문제에서도 자유롭다.
- **`$GITHUB_STEP_SUMMARY`와 `::warning::`의 실제 렌더링** — YAML을 읽었을 뿐 관찰하지 않았다.
- 실험은 gitignore된 산출물만 옮겼다 되돌렸고, `node_modules`는 손대지 않았다(위 install 호출
  하나는 no-op으로 끝났다). 최종 `git status --porcelain`은 **이 리뷰 파일 외 변경 없음**이다.

## Feeding back into the plan

`wave6-plan.md`에 남길 것은 세 줄이다.

1. **"워크플로에서 workspace 패키지를 직접 빌드할 때는 여러 `--filter`를 한 호출에 넣는다."**
   순서를 주석으로 지키지 말고 pnpm의 위상 정렬에 맡긴다. 실측 근거: 나열 순서를 뒤집어도
   `pnpm --filter @immich/plugin-sdk --filter @immich/sdk build`는 sdk를 먼저 빌드한다.
   `mise.toml:50-54`가 이미 이 패턴이며, `plugin-core`를 뺀 2-filter 버전이면 툴체인 문제도 없다.
2. **"gitignore된 산출물 후보는 추론하지 말고 `git status --porcelain --ignored=matching`으로
   열거한다."** 이 저장소에서는 5개가 전부이고, 그 5개를 전부 치운 뒤 job 스텝만 재생하는 것이
   '클린 러너 시뮬레이션'의 정확한 정의다. 라운드 9~11의 세 번의 실패는 전부 "로컬에 남아 있던
   산출물"이었고, 이 한 줄 명령이 그 계열 전체를 닫는다.
3. **"의존 방향은 존재 여부와 별개로 매번 두 방향 다 확인한다."** 라운드 10은 `server → plugin-sdk`
   런타임 방향을, 라운드 11은 `plugin-sdk → sdk` 빌드 타임 방향을 놓쳤다. 이번에는 세 번째 방향
   (`web → sdk`)이 주석에 빠져 있다 — 지금은 무해하지만 같은 계열이다.

`git status --porcelain`으로 이 리뷰 파일 외에 어떤 파일도 변경되지 않았음을 확인했다.
