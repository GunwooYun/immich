# Code Review — round-13 포맷 수정 + 워크플로 정정 5건 (`2630f1783`)

| | |
|---|---|
| Branch / HEAD | `feat/google-drive-album-sync-v3.1.0` / `d38218230` (리포트 + 증거 파일만 추가) |
| Commits reviewed | `2630f1783` (단일) |
| Report | `../report/google-drive-wave6-round13-format-20260902-1230-report.md` |
| Prior review | `google-drive-wave6-round12-multifilter-20260902-1200-review.md` (N1~N7) |
| Reviewed | 2026-09-02 |

## Verdict

**포맷 변경은 정말로 포맷뿐이고, 스윕 숫자도 전부 재현된다. 그런데 이번 라운드가 "고쳤다"고
선언한 다섯 건 중 하나(N5)는 고쳐지지 않았다 — 형태만 바뀌었고, 이제는 *결정적으로 틀린 파일*을
집는다.** `//web:ci-unit` 547 / `//server:ci-unit` 2,349를 직접 돌려 리포트와 문자 단위로 일치하는
결과를 얻었고(둘 다 exit 0), 세 스펙 파일은 공백·후행쉼표·import 정렬을 제거한 토큰 스트림이
변경 전후 **완전히 동일**하다. 단언·모킹·제어흐름은 한 글자도 바뀌지 않았다.

문제는 `:104`의 `ls … | sort | tail -1`이다. `run.sh:19`의 스탬프는 **러너의 로컬 시각**
(`date +%Y%m%d-%H%M`)이고 GitHub 호스티드 러너는 UTC다. 반면 `results/`에 커밋되어 있는 18개
증거 파일은 전부 KST(+09:00)로 찍혔다 — 가장 최신인 `20260902-1224.txt`의 첫 줄이
`date:   2026-09-02T12:24:01+09:00`이다. 로컬에서 KST 오전/오후에 증거를 만들어 커밋하고 바로
푸시하면, 러너가 만드는 파일 이름은 **같은 UTC 날짜의 9시간 이른 시각**이 되어 방금 커밋한
파일보다 사전순으로 **뒤진다**. 즉 이번 수정은 "임의의 파일"을 "항상 커밋된 옛 파일"로 바꿨다.
체크아웃을 재현해서 확인했다: 러너가 `RESULT: FAIL`을 쓴 상황에서도 요약 스텝은
`20260902-1224.txt`를 골라 `RESULT: PASS`를 렌더한다(C1). N5가 막으려던 바로 그 시나리오다.

나머지 네 건(N2/N3/N4/N7)은 파일에서 직접 확인했고 전부 정확하게 반영됐다. N6를 되돌리지 않고
주석으로 남긴 판단에는 동의하며, 리포트가 제시하지 않은 더 강한 근거가 하나 있다(아래 §3).

### Evidence I ran myself

| Check | Result |
|---|---|
| `git status --porcelain` (시작·중간·종료) | 이 리뷰 파일 외 변경 없음 |
| `git show 2630f1783 --numstat` | `.github/workflows/fork-google-drive.yml`, 세 스펙, 직전 리뷰 `.md` — 그 외 없음 |
| **포맷 전후 토큰 비교**: 세 파일을 공백 전부 제거 → `,}`/`,)` 정규화 → import 문만 집합 비교 | 세 파일 모두 **import 집합 동일 + 본문 토큰 완전 동일**. 단언/목/제어흐름 변경 0 |
| `server/…/google-drive.repository.spec.ts` 공백만 제거한 비교 | **바이트 단위 동일** (import 변화조차 없음) |
| `npx prettier --check` (web 2파일 / server 1파일) | 둘 다 `All matched files use Prettier code style!`, exit 0 |
| **`mise run //web:ci-unit`** (직접 실행) | `format` clean → `tsc --noEmit` → `svelte-check … COMPLETED 417 FILES 0 ERRORS` → `Test Files 56 passed \| 1 skipped (57)`, `Tests 547 passed \| 2 skipped (549)`, **exit 0** |
| **`mise run //server:ci-unit`** (직접 실행) | `//:plugins`(plugin-core wasm 포함) → `format` clean → `lint` → `check` → `Test Files 94 passed (94)`, `Tests 2349 passed \| 2 skipped (2351)`, **exit 0** |
| 재포맷된 web 스펙 2개만 재실행 | `Test Files 2 passed (2)`, `Tests 21 passed (21)` — 리포트의 21과 일치 |
| `run.sh`의 server 8 spec 재실행 | `Test Files 8 passed (8)`, `Tests 239 passed (239)` |
| 첨부 증거 `results/20260902-1224.txt` | `commit: 2630f1783`(코드 커밋), 8/239 · 3/29 · svelte-check 회귀 없음 · 1/10 · `RESULT: PASS` — 리포트 인용과 일치 |
| **C1 재현**: 커밋된 18개 파일만 있는 디렉터리를 만들고, UTC 러너가 만들 법한 `20260902-0335.txt`(`RESULT: FAIL`)를 추가한 뒤 `:104`의 명령 그대로 실행 | 고른 파일 `…/20260902-1224.txt`, 마지막 줄 **`RESULT: PASS`**. 실제 실행 결과는 `RESULT: FAIL` |
| `results/` 파일명 규칙 위반 파일 | 없음(18개 전부 `YYYYMMDD-HHMM.txt`, 그 외는 `.gitkeep`뿐 → glob `*.txt`에 걸리지 않음) |
| `run.sh:18-20` | `STAMP="$(date +%Y%m%d-%H%M)"`, `OUT="${RESULTS_DIR}/${STAMP}.txt"` — **분 단위**, `tee "$OUT"`이므로 같은 분 재실행은 덮어쓰기(파일이 늘지 않음) |
| 워크플로에 `TZ` 설정 | 없음 (`grep -n 'TZ\|env:'` → 0건) |
| N3 확인: `:52-53` | `# (extism-js, binaryen) in the root mise.toml would be dead weight.` — java 사라짐. 파일 전체 `grep -i java` **0건** |
| N2 확인: `:124-126` | "over the whole workspace" 삭제, `web/package.json:19` = `prettier --cache --check .` (web 기준) 맞음 |
| N4 확인: `pnpm --filter immich-web install --frozen-lockfile` 로그 | `[//web:install] . prepare$ svelte-kit sync` / `prepare: Done` — 삭제한 `:83`은 실제로 중복이었다 |
| N7 확인: `run.sh:80-102` | server 8 + web 3 = **11**, `MEDIUM_SPECS` 1개는 별도 → `:35-36`, `:122`의 11 맞음 |
| `python3 yaml.safe_load` + `npx prettier --check` (워크플로) | 파싱 OK, `jobs: ['feature','regression','medium']`, prettier clean |
| `node_modules/.modules.yaml` | `"injectedDeps": {}`, `packages/plugin-sdk/node_modules/@immich/sdk -> ../../../sdk` (symlink) — N6 전제 유효 |
| `server/mise.toml` 작성자 | 포크 커밋 **0건**(전부 upstream). `ci-unit`은 `:install` → `//:plugins` 순서 |
| **Actions 상태**(리포트의 "검증 못 함"): `api.github.com/repos/GunwooYun/immich/actions/workflows` | `total_count: 0` (같은 엔드포인트가 `immich-app/immich`에는 **36**을 돌려줌) → 포크에서 Actions가 켜져 있지 않다 |
| `git ls-remote --heads origin` | `feat/google-drive-album-sync-v3.1.0` = `ab40942b7`, HEAD보다 **57 커밋 뒤**, 그 커밋에 워크플로 파일 **없음** |
| GHCR 익명 pull(`ghcr.io/immich-app/postgres:14-vectorchord0.4.3` manifest) | **HTTP 200** — `medium` 잡의 testcontainers 이미지는 인증 없이 받을 수 있다 |
| `jdx/mise-action@v3`의 `action.yml` inputs | `install_args` 존재(설명: "pass to `mise install` such as 'bun' to only install bun") → `:57`의 사용법 유효 |

스윕 두 개를 돌렸음에도 최종 `git status --porcelain`은 **아무것도 보고하지 않는다**
(빌드 산출물은 전부 gitignore 대상, `results/`에 새 파일을 만들지 않기 위해 `run.sh`는 돌리지 않고
그 안의 vitest 호출만 직접 실행했다).

## Findings

### C1 (MEDIUM→HIGH, 이번 커밋이 "고쳤다"고 적은 항목) — `:104`의 이름순 정렬은 러너에서 **항상 커밋된 옛 증거**를 고른다

```yaml
104	          latest="$(ls dev-test/google-drive/results/*.txt 2>/dev/null | sort | tail -1)"
```

`.github/workflows/fork-google-drive.yml:100-103`의 주석은 "이름이 `YYYYMMDD-HHMM`이니 사전순
정렬이 곧 시간순"이라고 적었다. 그 전제가 성립하려면 **모든 파일이 같은 시계로 찍혀야** 하는데,
그렇지 않다.

- `dev-test/google-drive/run.sh:19` → `STAMP="$(date +%Y%m%d-%H%M)"` = 실행 머신의 **로컬 시각**.
- 저장소에 커밋된 18개는 전부 개발 머신의 KST로 찍혔다. 최신 파일
  `dev-test/google-drive/results/20260902-1224.txt:2` → `date:   2026-09-02T12:24:01+09:00`.
- GitHub 호스티드 러너는 UTC이고 이 워크플로는 `TZ`를 설정하지 않는다(파일 전체 `grep` 0건).

따라서 KST `T`시에 증거를 만들어 커밋하고 곧바로 푸시하면 러너의 파일 이름은 `T-9h`가 되고,
같은 UTC 날짜에서 **방금 커밋한 파일이 항상 사전순으로 뒤에 온다.** (KST 09시 이전에 만들었다면
러너의 UTC 날짜는 하루 더 이르므로 더 확실히 진다.) 실제로 재현했다:

```
$ # 커밋된 18개 + 러너가 만들 법한 20260902-0335.txt(RESULT: FAIL)
$ ls dev-test/google-drive/results/*.txt | sort | tail -1
dev-test/google-drive/results/20260902-1224.txt
$ tail -1 dev-test/google-drive/results/20260902-1224.txt
RESULT: PASS            # ← 요약에 렌더되는 값
$ tail -1 dev-test/google-drive/results/20260902-0335.txt
RESULT: FAIL            # ← 이번 실행이 실제로 만든 값
```

즉 이번 수정은 직전 리뷰 N5가 지적한 실패 모드를 **제거하지 않고 결정론화**했다. `ls -t`는
"운이 나쁘면" 옛 PASS를 찍었지만, `sort | tail -1`은 **성공/실패와 무관하게 매번** 찍는다.
그리고 `run.sh`가 정상적으로 돌아 자기 파일을 남긴 경우에도 틀린 파일을 고른다는 점에서
범위가 오히려 넓어졌다.

같은 이유로 `:114-120`의 아티팩트도 여전히 "이번 실행의 증거"가 아니라 커밋된 18개 + 새 1개다.
직전 리뷰 N5의 마지막 문단이 이 둘을 같이 고치라고 적었는데 요약 스텝만 손댔다.

**고치는 법** (셋 중 하나, 전부 러너 불필요):

1. *가장 단순.* 체크아웃은 일회용이므로 `run.sh` 앞에서 지워 버린다 —
   `rm -f dev-test/google-drive/results/*.txt`. 이후 `ls | sort | tail -1`도, 아티팩트도
   자동으로 "이번 실행"만 담는다.
2. *sentinel.* run 스텝 앞에 `touch "$RUNNER_TEMP/started"`, 요약/아티팩트 모두
   `find dev-test/google-drive/results -name '*.txt' -newer "$RUNNER_TEMP/started"`로 고른다.
3. *경로 전달.* `run.sh`가 `$GITHUB_OUTPUT`(또는 `$GITHUB_ENV`)에 `OUT`을 흘리게 하고 그 값을 쓴다.
   요약과 아티팩트가 같은 값을 공유하므로 어긋날 여지가 없다.

`TZ: Asia/Seoul`을 워크플로 env에 넣는 것도 증상은 없앤다. **권하지 않는다** — 파일 선택의
정확성이 개발 머신의 타임존과 러너 타임존이 같다는 우연에 계속 매달리게 된다.

### N1 (LOW) — "전부 줄바꿈·들여쓰기"는 정확하지 않다 (import **평가 순서**가 바뀌었다)

리포트 `:51`은 "diff: 16 insertions / 11 deletions, 전부 줄바꿈·들여쓰기"라고 적었다. 16/11은
맞지만 내용은 세 종류다.

- `web/src/lib/components/album-page/GoogleDriveAlbumMenu.spec.ts:1-6`,
  `web/src/lib/components/shared-components/context-menu/ButtonContextMenu.spec.ts:1-6` —
  `$lib/stores/context-menu.store`와 `$tests/helpers`가 서드파티 import **뒤로** 이동했다
  (`web/.prettierrc`의 `importOrder`: `<THIRD_PARTY_MODULES>` → … → `^\$(.*)$`).
  ESM은 소스 순서대로 평가하므로 이것은 엄밀히 말해 공백 변경이 아니라 **모듈 평가 순서 변경**이다.
- `ButtonContextMenu.spec.ts:60`, `:73`, `:88` — 객체 리터럴이 여러 줄로 펼쳐지며
  `trailingComma: "all"`에 따라 후행 쉼표가 붙었다.
- `server/test/medium/specs/repositories/google-drive.repository.spec.ts:200` — kysely 체인이
  120칸 한 줄로 접혔다. 이 파일만 순수 공백 변경이다.

**행동은 바뀌지 않았음을 확인했다**: 공백/후행쉼표를 정규화하고 import 문을 집합으로 비교하면
세 파일 모두 `imports same set: True`, `body identical: True`이고, 두 web 스펙은 21/21 통과한다.
그러니 커밋은 문제없다. 다만 다음 사람이 "포맷 커밋은 무조건 안전"으로 읽지 않도록,
리포트/계획 문서에는 "공백 + **import 재정렬** + 후행쉼표"라고 적는 편이 정확하다.

### N2 (NITPICK) — `ButtonContextMenu.spec.ts`는 `+17/-4`가 아니라 `+13/-4`

리포트 `:72`(및 리뷰 의뢰문)의 "+17/-4"는 `git show --stat`의 `17`을 삽입 수로 읽은 것이다.
`--stat`의 그 숫자는 **변경 라인 총합**이다.

```
$ git show 2630f1783 --numstat -- '*.spec.ts'
1	5	server/test/medium/specs/repositories/google-drive.repository.spec.ts
2	2	web/src/lib/components/album-page/GoogleDriveAlbumMenu.spec.ts
13	4	web/src/lib/components/shared-components/context-menu/ButtonContextMenu.spec.ts
```

결론(다른 둘보다 크다)은 그대로다. 숫자만 정정하면 된다.

### N3 (LOW) — `:124`의 "both ci-unit tasks *start* with `prettier --check .`"는 사실이 아니다

```
124	  # these in CI, and both ci-unit tasks *start* with `prettier --check .` (rooted at web/ and
```

- `server/mise.toml:58-66`: `:install` → **`//:plugins`** → `:format` → `:lint` → `:check` → `:test`.
  `//:plugins`(`mise.toml:50-54`)는 sdk·plugin-sdk·**plugin-core**를 install+build 하며,
  plugin-core는 `extism-js`로 wasm을 굽는다. 실제 실행 로그에서도 `packages/plugin-core build: Done`
  이 `[//server:format]`보다 **먼저** 찍혔다.
- `web/mise.toml:45-52`: `depends = ["//:sdk:install", "//:sdk:build"]` 후 `:install` → `:format` → ….

문장이 말하려는 바(**포맷이 첫 *검사* 단계이고, 포맷이 깨지면 테스트가 한 개도 안 돈다**)는
참이다. 하지만 "start with"는 러너에서 실제로 먼저 벌어지는 일 — 설치와 wasm 빌드 — 을 가린다.
`regression` 잡이 빨간불일 때 어디를 먼저 볼지가 달라지므로 한 단어 고칠 값어치는 있다:
*"both ci-unit tasks run `prettier --check` as their first **verification** step (after install and,
for server, `//:plugins`)"*.

### N4 (LOW) — `svelte-kit sync` 삭제는 직전 리뷰의 **권고와 반대**인데 리포트가 그 사실을 적지 않았다

직전 리뷰 N4는 "해롭지 않다 … 저는 **남기고 주석을 붙이는 쪽**을 권한다"였다. 커밋은 줄을
삭제했다. 저는 삭제 자체에 반대하지 않는다 — `pnpm --filter immich-web install --frozen-lockfile`
이 `web/package.json:24`의 `prepare`로 `svelte-kit sync`를 실제로 돌리는 것을 이번에도 로그로
재확인했고(`[//web:install] . prepare$ svelte-kit sync`), 언젠가 `prepare`가 사라져도
`npx svelte-check`가 **조용히가 아니라 시끄럽게** 죽는다. 다만 리포트 `:59`의 표는
"해당 줄 삭제"라고만 적어서, 리뷰어의 권고를 검토 후 뒤집었다는 사실이 기록에 남지 않는다.
다음 라운드에서 같은 질문이 다시 나올 여지를 없애려면 한 줄 적어 두는 게 낫다.

### N5 (NITPICK) — `:52-53` 주석은 이제 정확하지만 **불완전**하다

```
52	      # Only node and pnpm: this job never builds plugin-core, so the wasm toolchain
53	      # (extism-js, binaryen) in the root mise.toml would be dead weight.
```

java를 뺀 것은 옳다(N3 해소 확인). 그런데 `install_args: node pnpm`이 건너뛰는 것은 wasm
툴체인만이 아니다 — `mise.toml:20-33`의 `terragrunt`, `opentofu`, `npm:@openapitools/…`,
`npm:oazapfts`, `java`, `github:jellyfin/jellyfin-ffmpeg`도 전부 설치되지 않는다. "wasm 툴체인이
dead weight"는 7개 중 2개만 설명한다. `…so the rest of the root toolchain (wasm via extism-js and
binaryen, plus java/terragrunt/opentofu/ffmpeg) would be dead weight` 정도면 충분하다.

### N6 (정보, 그러나 다음 행동을 결정한다) — 포크에서 Actions가 켜져 있지 않고, 워크플로는 아직 푸시된 적이 없다

리포트가 "검증 못 함"으로 분류한 "Actions 활성 여부"는 몇 초면 확인된다.

```
GET https://api.github.com/repos/GunwooYun/immich/actions/workflows   → {"total_count": 0, "workflows": []}
GET https://api.github.com/repos/immich-app/immich/actions/workflows  → total_count 36
```

포크의 기본 브랜치 `main`에는 upstream의 워크플로 36개가 그대로 있는데도 `total_count`가 0이다
— 저장소 수준에서 Actions가 비활성이라는 뜻이다(`"disabled": false`이므로 저장소 자체가 막힌
것은 아니다). 여기에

```
$ git ls-remote --heads origin
ab40942b7…  refs/heads/feat/google-drive-album-sync-v3.1.0     # HEAD보다 57 커밋 뒤
$ git cat-file -e ab40942b7:.github/workflows/fork-google-drive.yml → NO
```

를 더하면, **이 워크플로는 아직 원격에 존재조차 하지 않는다.** "Actions를 켜고 푸시한다"는 것이
지금 남은 유일한 차단 요인이며, C1을 고치기 전에 그걸 하면 첫 실행의 요약이 곧바로 거짓말을 한다.

### N7 (정보) — `medium` 잡의 postgres 이미지는 익명 pull 가능하다

`ghcr.io/immich-app/postgres:14-vectorchord0.4.3`의 manifest를 익명 토큰으로 요청하면
**HTTP 200**이다. `server/test/medium/globalSetup.ts`가 testcontainers로 이 이미지를 띄운다는
`:169-171`의 설명은 자격증명 없이 성립한다. 이것도 "러너 없이는 모른다"에 들어가 있던 항목이다.

## Answers to what the report asked me to attack

### 1. 포맷 변경이 정말 포맷뿐인가 — **그렇다. `ButtonContextMenu.spec.ts` 포함.**

세 파일을 각각 (a) 모든 공백 제거, (b) `,}`/`,)` → `}`/`)` 정규화, (c) 선두 import 블록을
문 단위로 분리해 **집합** 비교, (d) 나머지 본문을 문자열 비교했다. 결과:

| 파일 | import 집합 | 본문 토큰 |
|---|---|---|
| `ButtonContextMenu.spec.ts` | 동일 | **완전 동일** |
| `GoogleDriveAlbumMenu.spec.ts` | 동일 | **완전 동일** |
| `google-drive.repository.spec.ts` | (변화 없음) | 공백만 제거해도 **바이트 동일** |

`ButtonContextMenu.spec.ts`가 큰 이유는 단순하다. `renderWithTooltips(ContextMenuHarness, { … })`
세 곳이 120칸을 넘겨 객체 리터럴이 3줄로 펼쳐졌고, 각각 `-1/+4`가 되어 `+12/-3`, 여기에 import
이동 `+1/-1`이 더해 `+13/-4`다(N2). `mode: 'plain' as const` / `'menuoption' as const`,
`hideContent: true`는 값도 순서도 그대로고, `openMenu` 호출·`queryByRole`/`findByRole` 단언·
`await` 위치 전부 그대로다. 이 파일에는 모킹이 없다(`vi.mock` 0건). 두 스펙 21/21 통과로 실측도
붙는다.

유일하게 "공백이 아닌" 변화는 import **순서**이고(N1), 이것도 집합이 같으므로 누락/추가는 없다.

### 2. N5 수정이 실제로 결정적인가 — **결정적이다. 그리고 결정적으로 틀렸다.**

질문이 제시한 두 가지 위험은 둘 다 실제 위험이 **아니다**:

- *같은 분에 두 번 실행되면?* `run.sh:18-20`이 파일을 `tee "$OUT"`로 열므로 같은 분의 두 번째
  실행은 같은 파일을 **덮어쓴다.** 파일 개수가 늘지 않으니 `sort | tail -1`이 헷갈릴 일이 없다.
  (CI에서는 잡당 한 번만 돌기도 한다.)
- *다른 형식의 파일이 섞이면?* 현재 `results/`에는 `.gitkeep` 외에 `YYYYMMDD-HHMM.txt` 18개뿐이고
  `.gitkeep`은 `*.txt` glob에 걸리지 않는다. 규칙을 벗어난 이름이 들어오면 깨지지만, 그 이름은
  사람이 손으로 넣어야만 생긴다 — 현실적인 위험이 아니다.

진짜 위험은 **시계가 두 개**라는 것이다(C1). 커밋된 증거는 KST, 러너는 UTC. 그래서
"사전순 = 시간순"이라는 주석의 전제가 러너에서 성립하지 않고, `sort | tail -1`은 이 저장소가
증거를 계속 커밋하는 한 **매번** 커밋된 파일을 고른다. `ls -t`보다 나빠진 면도 있다: 예전에는
`run.sh`가 정상 실행되면 새 파일이 최신 mtime을 가져 옳게 뽑혔지만, 지금은 정상 실행에서도 틀린다.
수정안은 C1에 적었다(가장 단순한 것은 run 스텝 앞의 `rm -f …/results/*.txt` 한 줄).

### 3. N6를 기록으로 남긴 판단 — **동의한다. 리포트가 쓰지 않은 더 강한 근거가 있다.**

되돌리는 쪽의 비용은 명확하다. 라운드 11~12가 두 번에 걸쳐 잡은 버그가 "사람이 install/build
순서를 틀린다"였고, multi-filter 형태는 그 실수를 **표현 불가능**하게 만든다. 아직 어떤 pnpm에서도
관측된 적 없는 위험을 막자고 그 성질을 버리는 것은 교환이 맞지 않는다.

여기에 리포트가 언급하지 않은 사실을 더한다. **되돌려도 위험이 사라지지 않는다.**
`regression` 잡은 install 스텝이 없고 `mise run //server:ci-unit`에 전부 맡기는데,
`server/mise.toml:58-66`이 이미 같은 모양이다:

```
[tasks.ci-unit]
run = [ { task = ":install" },      # pnpm install --filter immich  ← 여기서 @immich/plugin-sdk가 붙는다
        { task = "//:plugins" },    # ← dist는 여기서 만들어진다
        … ]
```

`server/package.json:40`이 `"@immich/plugin-sdk": "workspace:*"`이므로, injection이 실제로
이행되는 pnpm에서는 **upstream이 작성한 이 태스크가 먼저 깨진다**(`server/mise.toml`에 포크
커밋은 0건이다). 워크플로 `:86-89`만 4줄로 되돌려도 `regression`·`medium` 잡은 그대로 노출된다.
그러니 이 위험의 올바른 대응은 "우리 워크플로만 옛 형태로 되돌리기"가 아니라 "pnpm 업그레이드
때 `injectedDeps`를 확인하기"이고, 그것이 지금 주석이 하고 있는 일이다.
(참고로 `web/mise.toml:45-52`는 `//:sdk:build`가 `web:install`보다 앞이라 injection이 켜져도 안전하다
— 세 태스크 중 server만 취약하다.)

다만 주석에는 **탐지 방법**이 빠져 있다. 한 줄 덧붙이길 권한다:
`# check with: jq -r '.injectedDeps' node_modules/.modules.yaml — non-empty means injection is live`.
그리고 실패는 조용하지 않다 — `packages/sdk/package.json:11-15`의 진입점이 `./build/index.js`라
사본이 비어 있으면 plugin-sdk의 esbuild가 `Could not resolve "@immich/sdk"`로 즉시 죽는다.
이 "시끄러움"이 기록으로 남겨도 되는 마지막 근거다.

### 4. 전체 스윕 결과의 해석

**확립되는 것**: `2630f1783`의 트리에서 `//web:ci-unit`과 `//server:ci-unit`의 *태스크 내용*
— prettier, eslint(`--max-warnings 0`), `tsc --noEmit`, `svelte-check --no-tsconfig
--fail-on-warnings`, vitest 2,896개 — 이 전부 통과한다. 직전 리뷰 N1의 "포맷에서 죽어 테스트가
한 개도 안 돈다"는 실패 경로는 **닫혔다.** 저도 같은 숫자를 독립적으로 얻었다(547 / 2,349, 둘 다
exit 0). 리포트가 "러너 없이는 모른다"에 넣었던 항목이 로컬에서 닫혔다는 주장은 옳다.

**확립되지 않는 것 — 로컬과 러너가 갈리는 지점**:

1. **툴체인 설치.** `regression`/`medium` 잡의 `jdx/mise-action@v3`에는 `install_args`가 없어
   `mise.toml:17-36` **전체**를 깐다: node, pnpm, terragrunt 1.1.1, opentofu 1.12.4,
   openapi-generator-cli, oazapfts, extism/cli 1.6.3, binaryen version_124, extism/js-pdk 1.6.0,
   java 21.0.2, jellyfin-ffmpeg 7.1.3-6. 제 머신에는 전부 이미 있었다. 러너에서는 GitHub
   릴리스 다운로드 + 레이트리밋 + 플랫폼 자산 매칭이 처음 일어난다. `timeout-minutes: 40`(sweep)
   과 `25`(medium)가 이 설치 시간을 포함한다는 점이 여기서 처음 검증된다.
2. **`node_modules`와 pnpm 스토어.** 저는 12개 워크스페이스가 전부 설치된 상태에서 돌렸다.
   러너의 `regression` 잡은 **명시적 install 스텝이 없고** 태스크의 `:install`/`//:plugins`/
   `//:sdk:*`에 의존한다. 콜드 스토어에서 immich 전체 의존성을 받는 시간이 로컬 `Done in 1.8s`와
   비교 불가다. 또한 로컬 로그의 `✓ Lockfile passes supply-chain policies (verified 21d ago)`는
   **캐시된 검증**이다 — 러너에서는 이 검증이 실제로 수행되며, 저는 그 경로를 관찰하지 못했다.
3. **prettier 캐시.** `web/package.json:19`, `server/package.json:15` 모두 `--cache`다. 로컬은
   워밍업된 캐시(내용 해시 기반이라 위양성은 아니다), 러너는 매번 콜드. 결과는 같아야 하지만
   시간은 다르다.
4. **`prettier-plugin-organize-imports`(server).** `server/.prettierrc`의 이 플러그인은 TypeScript
   언어 서비스를 쓴다. lockfile이 `typescript`를 고정하므로 러너에서도 같은 판정이어야 하지만,
   web의 `@trivago/prettier-plugin-sort-imports`와 달리 **TS 버전에 결과가 매달린다** — upstream
   머지로 typescript가 올라가는 날 포맷 판정이 바뀔 수 있는 지점이다.
5. **서브모듈.** `feature`/`regression` 잡은 서브모듈을 받지 않는다. 유닛 스펙에서
   `test-assets`/`testAssetsDir` 참조는 0건이고(`server/test/medium.factory.ts:89`에만 있다)
   저 역시 서브모듈이 채워진 상태로 돌았으므로, "없어도 된다"는 **로컬 실측으로는 확인되지 않았다.**
   `medium` 잡만 `submodules: 'recursive'`인 것은 맞는 선택이다.
6. **Docker / testcontainers.** `medium`은 로컬에서 한 번도 이 형태로 돌리지 않았다. 이미지가
   익명 pull 가능하다는 것만 확인했다(N7).
7. **시계와 로케일.** 러너는 UTC — C1의 원인이다. 그 외에 `date --iso-8601=seconds`가 찍는
   오프셋도 증거 파일에서 `+00:00`으로 바뀐다.
8. **CPU/병렬성.** `eslint … --concurrency 6`, vitest 워커 수, `svelte-check` 타임아웃
   (`run.sh:171`의 `timeout 600`)이 러너 코어 수(2~4)에서 달라진다. 로컬 web 스윕 54s /
   server 38s는 상한 근거가 되지 못한다.

요약하면 **"무엇을 실행하는가"는 닫혔고 "그 환경에서 실행되는가"는 열려 있다.** 남은 위험은
테스트 내용이 아니라 설치·시간·환경이며, 그건 실제로 러너가 필요하다 — 단, N6/N7이 보여주듯
"러너가 필요하다"고 적기 전에 API 한 번은 던져 볼 값어치가 있다.

## 요청받은 두 가지 판단

### (a) 아직 여기서 확인 가능한데 "미검증"에 남아 있는 것이 있는가 — **있다. 최소 세 개.**

1. **Actions 활성 여부** — `api.github.com/repos/GunwooYun/immich/actions/workflows`가
   `total_count: 0`(upstream은 36). 몇 초. 게다가 원격 브랜치는 57 커밋 뒤이고 워크플로 파일이
   없다(N6). 이건 "검증 못 함"이 아니라 **아직 하지 않은 작업**이다.
2. **`jdx/mise-action@v3`의 인터페이스** — `raw.githubusercontent.com/jdx/mise-action/v3/action.yml`
   을 읽으면 `install_args`가 실재하고 의미도 `:57`의 용법과 같다. "액션이 어떻게 동작하는가"
   전체는 러너가 필요하지만, "입력 이름이 맞는가"는 여기서 닫힌다.
3. **`medium` 잡의 postgres 이미지 접근성** — GHCR 익명 토큰으로 manifest HTTP 200(N7).

닫히지 않는 것도 분명히 해 두면 좋겠다: 콜드 install 시간, mise의 GitHub 릴리스 다운로드,
`$GITHUB_STEP_SUMMARY`/`::warning::` 렌더링, `continue-on-error` 스텝의 `outcome` 값, 40/25분
타임아웃의 현실성. 이건 진짜로 러너가 필요하다.

### (b) CI 스레드를 지금 두고 가도 되는가 — **아직 아니다. 한 커밋 더.**

직전 라운드의 "닫자"는 거절이 여전히 유효하다. 다만 이유는 하나로 줄었다.

- **C1이 남아 있는 한 첫 실행의 산출물이 거짓말을 한다.** `regression`/`medium`은 어차피
  `continue-on-error`라 요약이 유일한 신호인데, `feature` 잡의 요약은 잡이 실패하든 성공하든
  2주 전 다른 커밋의 `RESULT: PASS`를 렌더한다. 첫 실행은 "이 파이프라인이 무엇을 말해 주는가"를
  판단하는 자리인데, 그 자리에서 가장 눈에 띄는 출력이 신뢰할 수 없는 값이면 실행한 의미가 준다.
  고치는 데 한 줄이다.
- 나머지(N1~N5, N7)는 전부 주석·문구·기록이고 CI 결과를 바꾸지 않는다. C1과 함께 묶어도 되고
  안 묶어도 된다.

**제안하는 마무리 순서**: (i) C1 한 줄 + 아티팩트 같은 필터, 원하면 N3/N5 문구를 같은 커밋에,
(ii) 포크에서 Actions를 켜고 브랜치를 푸시, (iii) 첫 실행 결과로 남은 목록(설치 시간, 타임아웃,
요약 렌더링)을 닫는 라운드. (iii) 이후에는 이 스레드에 리뷰로 더 보탤 것이 없다고 본다.

## What I did not verify

- **CI를 여전히 한 번도 돌리지 않았다.** 콜드 러너의 mise 툴 설치(특히 `github:` 백엔드 4개와
  ffmpeg), 콜드 pnpm 스토어에서의 install 시간, `timeout-minutes: 20/40/25`의 현실성,
  `$GITHUB_STEP_SUMMARY`·`::warning::`의 실제 렌더링, `continue-on-error` 스텝의 `outcome`
  표현식이 기대대로 채워지는지 — 전부 문서와 로컬 재현에 기반한 판단이다.
- **`medium` 잡 자체.** `//server:ci-medium`(56 spec)을 돌리지 않았고 Docker/testcontainers 경로도
  실행하지 않았다. 확인한 것은 이미지 manifest가 익명으로 200이라는 것까지다.
- **서브모듈 없이 유닛 스윕이 도는지.** 참조가 0건이라는 정적 근거만 있고, 저는 서브모듈이 채워진
  트리에서 돌렸다.
- **완전한 콜드 install.** 제 스윕은 모든 워크스페이스의 `node_modules`가 있는 상태에서 시작했고,
  pnpm의 supply-chain 검증도 캐시(`verified 21d ago`)를 탔다.
- **C1의 "러너는 UTC"는 GitHub 문서 기준의 사실**이며 실행으로 관찰한 것이 아니다. 다만
  워크플로가 `TZ`를 설정하지 않는다는 것과 커밋된 증거가 `+09:00`이라는 것은 파일에서 직접
  확인했고, 러너가 UTC가 **아니더라도** "두 시계가 다르면 사전순은 시간순이 아니다"라는 결론은
  유지된다.
- **injection이 실제로 켜지는 pnpm 버전에서의 동작.** `injectedDeps: {}`와 symlink는 관측했지만,
  "켜지면 server의 `:install` → `//:plugins` 순서가 먼저 깨진다"는 injection의 복사 시점에
  근거한 **추론**이다.
- **Actions 비활성 판정**은 `total_count: 0`으로부터의 추론이다(포크 `main`에 upstream 워크플로가
  있음에도 0). 저장소 설정 화면은 인증이 없어 열지 못했다.
- `mise run` 두 번으로 `packages/sdk/build`, `packages/plugin-sdk/dist`,
  `packages/plugin-core/dist`, `web/.svelte-kit`이 재생성됐지만 전부 gitignore 대상이다.
  **최종 `git status --porcelain`은 이 리뷰 파일 외 아무것도 보고하지 않는다.**

## Feeding back into the plan

`wave6-plan.md`에 남길 것:

1. **"증거 파일 선택은 시계 두 개 문제다."** `run.sh`의 스탬프는 실행 머신 로컬 시각이고 커밋된
   증거는 KST, 러너는 UTC다. `ls -t`도 `sort | tail -1`도 옳지 않다. 정답은 "이번 실행이 만든
   것"을 명시적으로 식별하는 것 — 실행 전 `results/*.txt` 제거, sentinel + `-newer`, 또는
   `$GITHUB_OUTPUT` 경로 전달. 요약과 아티팩트가 **같은 식별자**를 쓰게 한다.
2. **"'러너가 없으면 모른다'고 쓰기 전에 API를 한 번 던져 본다."** 세 라운드 연속으로 그 목록에서
   항목이 빠져나왔고 이번에도 세 개가 나왔다(Actions 활성 여부, 액션의 입력 이름, GHCR 익명 pull).
   체크리스트 한 줄: *`gh api repos/:owner/:repo/actions/workflows`, `git ls-remote --heads origin`,
   `raw.githubusercontent.com/<action>/<ref>/action.yml`를 먼저 확인.*
3. **"injection 위험은 이 워크플로만의 것이 아니다."** `server/mise.toml:58-60`(upstream 소유)이
   같은 install-before-build 모양이다. pnpm 업그레이드 시 확인 지점은 워크플로가 아니라
   `node_modules/.modules.yaml`의 `injectedDeps`이고, 비지 않으면 워크플로와 server 태스크를
   **함께** 봐야 한다.
4. **"포맷 커밋 ≠ 공백 커밋."** 이 저장소의 web prettier는 `@trivago/prettier-plugin-sort-imports`로
   import를 **재정렬**하고 server는 `prettier-plugin-organize-imports`로 TS 언어 서비스를 탄다.
   포맷 커밋의 리뷰 기준은 "diff가 공백뿐인가"가 아니라 "import 집합과 본문 토큰이 같은가"여야 한다.
5. (직전 라운드에서 이미 적기로 한 것 유지) **`run.sh`는 CI가 돌리는 것의 부분집합이다** —
   포맷/린트가 없다. 커밋 전 `mise run //web:format`·`//server:format`을 체크리스트에 둔다.
