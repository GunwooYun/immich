# Code Review — wave9g: `driveIndicatorAlbumId` 가드 (`6fec788a3`) — 다음 이미지 포함 여부 판정

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `f41fc2720` (`feat/google-drive-album-sync-v3.1.0`) |
| Commits reviewed | `6fec788a3` (fix), `b527fd534` (증거), `f41fc2720` (리포트) — `git diff 9665ace92 6fec788a3 -- web/src` (2 files, +26/−8; `dev-docs` 제외) |
| Report | `../report/google-drive-wave9g-album-id-guard-20260920-1000-report.md` |
| Reviewed | 2026-09-20 09:05 +0900 (모든 수치는 이 워크트리 HEAD에서 직접 돌린 것) |

## Verdict

**판정: NOT BLOCKED — 다음 운영 이미지에 넣어도 된다.** 이 라운드는 `web/src` 두 파일만 바꾸고 서버·원장·마이그레이션을 전혀 건드리지
않는다(`git show --stat 6fec788a3`: `GoogleDriveAlbumMenu.spec.ts` +7, `+page.svelte` +18/−8, 나머지는 리뷰 문서). 리포트의 주장은 전부
코드와 맞았다: 가드는 이번에는 **실제로 있고**(`+page.svelte:368`, `:406-414`), `git grep -c driveIndicatorAlbumId a651712e4 -- web/src`는
여전히 0건이라 wave9f C1의 사실관계도 그대로다. 수치(서버 309 / 웹 78 / 전체 594+2)와 변이 1건(`failed > 0` → `failed > 1`이 새 테스트
하나만 떨어뜨림)도 재현됐다.

**가장 중요한 발견은 리포트가 "공격해 달라"고 한 바로 그 지점이다(N1).** `driveIndicatorAlbumId`는 `$state`이고, 같은 `$effect` 안에서
읽힌 뒤(`:406`) 쓰인다(`:407`). Svelte 5.56.5의 runes 모드는 이 경우 **그 effect를 한 번 더 실행한다** — 런타임 소스
(`sources.js:243-254`의 `untracked_writes`, `runtime.js:201-223`의 `schedule_possible_effect_self_invalidation`)가 그렇게 돼 있고, 같은
런타임으로 돌린 실증 스크립트도 마운트와 앨범 id 변경마다 **effect 2회 · `load` 2회**를 찍었다. 무한 루프는 아니다(두 번째 실행에서는 id가
같아 다시 쓰지 않으므로 수렴한다). 카운터도 틀리지 않는다(같은 응답이 두 번 덮어쓸 뿐이다). 하지만 앨범을 바꿀 때마다 DB 읽기 두 개
(`getGoogleDriveAlbumStatus`, `getMyGoogleDriveStatus`)가 **네 개**로 늘어난다 — "아무것도 보여줄 게 없는 왕복"을 없애려고 쓴 커밋이
다른 종류의 불필요한 왕복을 하나 더 만든 셈이다. 고치는 데 한 줄이면 되고(`$state`를 떼거나 `untrack`), 사용자가 보는 것은 아무것도
바뀌지 않으므로 배포 게이트는 아니다. 다만 이미지에 넣기 전에 함께 접는 편이 싸다.

### Evidence I ran myself

워크트리의 `web/node_modules`(svelte 5.56.5)는 이전 라운드가 남긴 것을 그대로 썼다. 변이는 `sed`로 넣고 `git checkout --`으로 되돌린 뒤
변이 전 사본과 `cmp`로 바이트 동일함을 확인했다. 실증 스크립트와 컴파일 확인은 스크래치패드(`/tmp/claude-1000/.../scratchpad/`)에서만
돌렸고 저장소에는 아무 파일도 만들지 않았다. `./dev-test/google-drive/run.sh`는 `results/`에 파일을 남기므로 일부러 돌리지 않고, 같은
스펙을 `vitest`로 직접 실행했다.

| Check | Result |
|---|---|
| `git diff 9665ace92 6fec788a3 -- web/src` | 리포트 표와 일치: `+page.svelte`에 `driveIndicatorAlbumId` 상태(`:368`)와 `if (driveIndicatorAlbumId !== albumId)` 블록(`:406-414`), 스펙에 `should name a single failure too`(`:272-277`) |
| `git grep -c driveIndicatorAlbumId a651712e4 -- web/src` | **0건 (exit 1)** — wave9f C1 그대로. `git show --stat a651712e4`의 `+page.svelte`는 `1 +` |
| `npx vitest run GoogleDriveAlbumMenu.spec.ts google-drive-indicator.spec.ts` | 2 files, **38 passed** |
| 변이: `GoogleDriveAlbumMenu.svelte:249` `failed > 0` → `failed > 1` | **1 failed / 27 passed** — 떨어진 것은 `should name a single failure too` **하나뿐**. 즉 기존 7/0/4 케이스는 이 변이를 못 잡는다는 리포트의 진단도 맞다. `git checkout --` 후 `cmp` → `restored byte-identical` |
| `npx vitest run` (web 전체) | **60 files passed / 1 skipped, 594 passed / 2 skipped**, 23.9s — 리포트의 `mise //web:ci-unit` 수치와 일치 |
| `dev-test/google-drive/results/20260919-1038.txt` | commit `6fec788a3`, 서버 8 files 309 passed, 웹 8 files 78 passed, svelte-check 회귀 없음, RESULT: PASS — 리포트 인용과 일치 |
| Svelte 런타임 소스 (`web/node_modules/svelte/src/internal/client/`) | `reactivity/sources.js:337-349` `mark_reactions`: **legacy 모드에서만** `reaction === active_effect`를 건너뜀. `sources.js:243-254`: runes 모드에서 CLEAN 상태의 active effect 안에서 `set`이 일어나면 `untracked_writes`에 적재. `runtime.js:296-308` → `schedule_possible_effect_self_invalidation(:201-223)`: 그 source의 reactions에 자기 자신이 있으면 `DIRTY` + `schedule_effect` |
| 실증 스크립트 (같은 런타임의 `state/get/set/user_effect/flush`로 `:396-420`을 재현) | tracked: `mount runs=2 loads=2 → refresh-same-id 3/3 → A→B 5/5 → B→C(empty) 7/5`. `untrack`으로 읽으면: `1/1 → 2/2 → 3/3 → 4/3`. 즉 **id가 바뀌는 실행마다 effect·load가 정확히 두 배**, 같은 id 재로드는 한 번 |
| `svelte/compiler`로 같은 패턴을 컴파일 | `if ($.get(id) !== albumId) { $.set(id, albumId, true); …}` — 페이지 코드도 tracked `get` + `set`으로 내려간다는 것을 확인 (untrack 없음) |
| `getMyStatus` 서버 구현 (`google-drive.service.ts:929-939`) | `getCredentials` / `countPendingUploads` / `getErrorSummary` — DB만. 두 배가 되는 호출이 구글까지 가지는 않는다 |
| `git status --porcelain` (리뷰 파일 작성 전) | 빈 출력 |

## Findings

### N1 — 가드가 자기 자신을 한 번 더 실행시켜 앨범 변경마다 인디케이터 조회가 두 번 나간다 (should-fix, 한 줄; 배포 게이트 아님)

- 코드 (`+page.svelte`):
  ```
  368:  let driveIndicatorAlbumId = $state<string | undefined>(undefined);
  405:    const albumId = album.id;
  406:    if (driveIndicatorAlbumId !== albumId) {
  407:      driveIndicatorAlbumId = albumId;
  ...
  418:    if (featureFlagsManager.value.googleDrive && album.assetCount > 0) {
  419:      void loadGoogleDriveIndicator(albumId);
  ```
- 왜 두 번 도는가: `:406`의 읽기가 이 effect를 `driveIndicatorAlbumId`의 reaction으로 등록하고, `:407`의 쓰기가 같은 실행 중에 일어난다.
  Svelte 5는 legacy 모드에서만 이 자기-무효화를 막는다(`sources.js:348-349` 주석 그대로 "In legacy mode, skip the current effect").
  runes 모드에서는 `sources.js:243-254`가 `untracked_writes`에 적어 두고, `runtime.js:296-308`이 effect 실행이 끝난 뒤
  `schedule_possible_effect_self_invalidation`으로 **같은 effect를 DIRTY로 만들어 다시 스케줄**한다. 두 번째 실행에서는 `:406`이 거짓이라
  쓰지 않으므로 거기서 멈춘다 — 그래서 무한 루프(`effect_update_depth_exceeded`)가 아니라 **정확히 한 번의 추가 실행**이다.
- 그런데 `:418-419`는 `if` 블록 **밖**이라 두 번째 실행에서도 `loadGoogleDriveIndicator`가 다시 호출된다. 위 실증 결과의 `loads`가 마운트에서
  2, A→B에서 +2인 것이 그것이다. 두 호출은 같은 flush 안에서 연달아 나가고, `:379`의 in-flight 가드(`albumId !== album.id`)는 id가 같으니
  둘 다 통과시켜 같은 값을 두 번 대입한다. 카운터·점은 틀리지 않는다.
- 영향: 앨범 페이지 진입·앨범 간 이동마다 `GET /google-drive/albums/:id/status` + `GET /google-drive/me/status`가 각 2회. DB 읽기뿐이라
  (`getMyStatus`, `service.ts:935-938`) 구글 호출·프로브 쿨다운과 무관하고 사용자에게 보이는 차이는 없다. 다만 wave9e N1이 없애려던
  "쓸모없는 왕복"과 같은 종류이고, 이 커밋의 목적과 정반대 방향이라 기록한다.
- **Fix (둘 중 하나, 한 줄).** (a) 이 변수는 템플릿 어디에서도 읽히지 않고 effect 안에서만 쓰이므로 `$state`일 이유가 없다 —
  `:368`을 `let driveIndicatorAlbumId: string | undefined;`(일반 변수)로 바꾼다. 컴파일러가 `get/set`을 만들지 않으니 reaction 등록 자체가
  없어진다. 이쪽을 권한다. (b) 반응성을 남기고 싶다면 `:406`을 `if (untrack(() => driveIndicatorAlbumId) !== albumId)`로. 이 저장소는
  같은 상황에서 `untrack`을 쓰고 있다(`routes/(user)/search/.../+page.svelte:72-75` "we want this to *only* be reactive on `terms`",
  `components/shared-components/map/Map.svelte:316`). 실증 스크립트의 `untracked` 줄이 (b)의 결과이고, (a)도 같은 결과가 된다.
- 검증 방법(테스트가 없으므로): 브라우저 DevTools Network에서 앨범 페이지 진입 시 위 두 요청이 **한 번씩만** 나가는지 본다. 지금 코드는
  두 번씩 나간다.

### N2 — 같은 앨범의 `album` 교체는 점을 비우지 않지만 여전히 재조회는 한다 (기록용, 결함 아님)

- `:418-419`가 가드 밖에 있으므로 `refreshAlbum()`(`:152-154`)·`album = { ...album, albumName }`(`:582`)·`invalidate('album:data')`(`:333`)
  때마다 인디케이터 조회는 여전히 나간다. 리포트/커밋 메시지의 "no longer blank the dot"은 정확하고, 조회가 남는 것은 의도된 동작이다
  (앨범이 바뀌었으니 카운터를 다시 읽는 것이 맞다). 다만 커밋 메시지만 읽으면 "재로드 자체가 안 일어난다"로 오독할 수 있어 적어 둔다.
  N1을 (a)로 고치면 이 경로는 실행 1회·조회 1회로 이미 최소다.

### N3 — nit: 스펙 주석의 "7/0/4"는 파일 밖 독자에게는 풀리지 않는다

- `GoogleDriveAlbumMenu.spec.ts:273-274`의 "every case used 7/0/4"는 같은 `describe`의 `failed: 7`, `failed: 0`, `failed: 4`
  (`:268`, `:280`, `:287`)를 가리킨다. 맞는 말이지만 wave9f 리뷰를 읽지 않은 사람에게는 암호다. 원한다면 "(`failed` of 7, 0 and 4)"로.
  안 고쳐도 된다.

## Answers to what the report asked me to attack

### 1. 가드 자체 — 같은 effect에서 `$state`를 읽고 쓰면 재실행되는가? id는 같은데 비워야 하는 경로가 있는가?

**재실행된다. 한 번.** 근거와 실증은 N1에 있다: `mark_reactions`가 active effect를 건너뛰는 것은 legacy 모드뿐이고(`sources.js:348-349`),
runes 모드는 `untracked_writes` → `schedule_possible_effect_self_invalidation`(`runtime.js:201-223`)으로 자기 자신을 다시 스케줄한다.
두 번째 실행에서 `:406`이 거짓이므로 수렴하고, 대신 `:419`의 조회가 한 번 더 나간다. 이 저장소가 같은 문제를 어떻게 다루는지는
`search/+page.svelte:72-75`(`terms;`만 읽고 나머지는 `untrack`)와 `Map.svelte:316`이 보여 준다 — 그리고 이 변수는 렌더에 안 쓰이므로
아예 `$state`를 떼는 것이 그 두 곳보다 더 단순한 답이다.

**id가 같은데 비워야 하는 경로 — 세 가지를 따라갔고, 비워야 하는 경우는 없었다.**

- **백업 토글 off.** `handleToggleGoogleDriveBackup`(`:490-508`)이 `unsubscribeGoogleDriveAlbum` 뒤 `loadGoogleDriveMenu()`(`:502`)를
  부르고, 거기서 `driveBackedUp = albumStatus.value.subscribed`(`:470`)가 새 값을 쓴다. effect와 무관하게 갱신되므로 가드가 끼어들 자리가 없다.
- **다른 탭에서 Drive 연결 해제.** 이 페이지로 오는 이벤트가 없다. 카운터는 다음 effect 실행(= `album` 교체)이나 메뉴 열기까지 이전 값을
  유지한다. **가드 전에도 똑같았다** — 비우기는 한 왕복짜리 깜빡임일 뿐이고 실제 갱신은 `:419`의 조회가 하는데, 그 조회는 가드 밖이라
  지금도 매 실행마다 나간다(N2). 즉 이 라운드가 새로 stale하게 만든 것은 없다. `googleDriveProgressManager`는 점에 연결돼 있지 않다
  (`:500`의 `markUserInitiated`만).
- **앨범이 비어 `assetCount`가 0이 되는 경우.** `album`이 교체되면 effect가 돌고(`album.assetCount`를 `:418`에서 읽으므로), id가 같아 비우지
  않고, `assetCount > 0`이 거짓이라 조회도 없다. 여섯 카운터는 메모리에 남지만 **Drive 버튼 자체가 `:747`의 `{#if album.assetCount > 0}`
  안에 있어 언마운트된다** — 보일 점이 없다. 사진이 다시 들어와 `assetCount > 0`이 되면 effect가 돌아 `:419`가 새 값을 덮어쓴다. 그 사이
  한 왕복 동안 보이는 것은 같은 앨범의 직전 카운터인데, 그것이 바로 이 가드가 의도한 동작이다(다른 앨범의 점이 아니다).
- 덤: `featureFlagsManager.value.googleDrive`도 `:418`에서 읽히므로 플래그가 꺼지면 effect가 돈다. id 같음 → 안 비움, 플래그 거짓 → 조회
  없음, 버튼은 `:764` `{#if featureFlagsManager.value.googleDrive}`로 사라진다. 문제없다.

### 2. `assetCount > 0` 상호작용 — A(10) → B(0), 그리고 B → A

- **A → B(0):** `:405` `albumId = B`, `:406` `A !== B` 참 → `driveIndicatorAlbumId = B`, 여섯 카운터 리셋. `:418` `assetCount > 0` 거짓 → 조회
  없음. 버튼은 `:747`에서 렌더되지 않는다. **맞다** — 비운 값이 남지만 볼 수 있는 곳이 없다. (N1의 재실행이 여기서도 한 번 더 돌지만,
  두 번째 실행도 조회를 안 하므로 실증 결과의 `B→C(empty) runs=7 loads=5`처럼 비용이 없다.)
- **B → A:** `driveIndicatorAlbumId`는 B이므로 `:406` `B !== A` 참 → 다시 리셋 + `driveIndicatorAlbumId = A`. `assetCount = 10` → `:419` 조회.
  A의 점은 한 왕복 뒤에 켜진다. **맞다** — B를 거쳐 왔으므로 A의 옛 카운터는 이미 B 진입 때 지워졌고, 그렇지 않았더라도 A의 값이라
  틀린 점이 아니다. 조회는 N1 때문에 두 번 나간다.
- **A → A(assetCount 0으로 갱신):** `refreshAlbum` 뒤 같은 id → 안 비움, 조회 없음, 버튼 숨김. 1번 답의 세 번째 항목과 같다.
- **A(조회 중) → B(0) → A(빠르게):** A의 첫 응답이 B에서 도착하면 `:379` `albumId !== album.id`로 버려진다. A로 돌아온 뒤 도착하면 통과해
  A의 값을 쓰고, 곧 새 조회가 덮어쓴다. 어느 쪽도 다른 앨범의 값이 아니다.
- 참고로 `+page.ts:10`은 `params.albumId`만 읽으므로 SvelteKit은 `assetId`(뷰어 열기)가 바뀌어도 load를 다시 돌리지 않는다 — 사진을 넘길
  때마다 `album`이 교체되어 조회가 나가는 경로는 **없다**. 나가는 경로는 `refreshAlbum`·`invalidate('album:data')`·`album = {...}` 대입뿐이다.

### 3. `a651712e4`에 대해 기록해 둘 것

- **사실:** `git grep -c driveIndicatorAlbumId a651712e4 -- web/src` → 0건(exit 1). `git show --stat a651712e4`에서 `+page.svelte`는 `1 +`
  (`failed={driveFailed}`). 그 커밋 본문의 "tracks which album the counters describe and clears only when that changes"는 **거짓**이며,
  git 역사는 다시 쓰지 않으므로 그 본문은 영원히 그렇게 남는다. 정정은 세 곳에 있다: `6fec788a3`의 메시지(첫 문단이 명시적으로 정정),
  wave9f 리뷰 C1(`:68-82`), 그리고 이 리뷰.
- **다음 독자를 위한 규칙 두 줄** (plan 문서에 넣을 것): ① `a651712e4`의 본문 중 `+page.svelte` 부분은 믿지 말고 `6fec788a3`를 볼 것.
  ② 커밋 메시지는 `git diff --cached`를 **보고 나서** 쓴다 — 스크립트가 중간에 죽으면 의도와 diff가 갈라진다는 것을 이 사례가 보여 줬다.
  리뷰어 쪽 대응은 이미 있다: 리포트가 "새 상태 변수"를 말하면 `git grep`으로 이름을 한 번 찍어 본다(wave9f가 그렇게 잡았다).
- 이 라운드의 메시지(`6fec788a3`)는 diff와 맞다 — 표에 적힌 두 변경 외에 아무것도 없고, "no page-level test"도 사실이다
  (`web/src`에서 `+page.svelte`를 렌더하는 스펙은 없다; `grep -rl "albums/\[albumId" web/src --include=*.spec.ts` 0건).

## What I did not verify

- **브라우저에서 보지 않았다.** N1의 "요청 두 번"은 런타임 소스와 같은 런타임을 쓰는 스크립트, 그리고 컴파일러 출력으로 확인한 것이지
  실제 페이지의 Network 탭으로 본 것은 아니다. SvelteKit의 hydration·`$derived` 기반 `album`(`:228`)이 여기에 다른 변수를 더할 가능성은
  낮다고 보지만 확인하지는 않았다. 반대로 "재실행이 없다"는 쪽으로 뒤집힐 증거는 어디에도 없었다.
- `svelte-check`를 다시 돌리지 않았다. `results/20260919-1038.txt`의 "no svelte-check regressions"를 그대로 믿었다. 이 라운드의 타입 변경은
  `string | undefined` 상태 하나뿐이다.
- `./dev-test/google-drive/run.sh`를 돌리지 않았다(`results/`에 파일을 남기므로). 대신 같은 스펙 두 개와 web 전체를 `vitest`로 직접 돌렸다.
  서버 309는 이 라운드에 서버 변경이 없으므로 결과 파일의 수치로 갈음했다.
- `driveIndicatorAlbumId`를 일반 `let`으로 바꾼 뒤(N1 fix a) svelte-check·eslint가 조용한지 실제로 돌려 보지는 않았다. 렌더에서 읽히지 않는
  변수이므로 `svelte/prefer-writable-derived` 류의 경고가 붙을 이유는 없다고 판단했지만, 적용하는 쪽에서 한 번 확인할 것.
- 주 저장소(`/home/gwyun/workspace/immich`)에는 손대지 않았다. 이 워크트리에서 `git status --porcelain`은 리뷰 파일 작성 전 빈 출력이었고,
  작성 후에는 `?? dev-docs/review/google-drive/review/google-drive-wave9g-album-id-guard-20260920-1000-review.md` 한 줄만 나온다(아래 요약에
  실제 출력을 적는다).

## Feeding back into the plan

- **Svelte 5 규칙 한 줄을 `dev-docs/google-drive/`의 웹 절에 추가:** "`$effect` 안에서 읽고 같은 실행에서 쓰는 `$state`는 그 effect를 한 번 더
  돌린다(runes 모드, `sources.js`의 `untracked_writes`). 렌더에 안 쓰이는 '마지막으로 본 값' 류는 `$state`로 만들지 말고 일반 변수로 두거나,
  읽기를 `untrack`으로 감싼다(`search/+page.svelte:72-75` 관례)." 이번 가드가 정확히 이 함정을 밟았다.
- **`a651712e4` 본문 불신 메모**를 plan 문서의 커밋 목록 옆에 남긴다 (3번 답 참고). 정정 위치: `6fec788a3` 메시지, wave9f 리뷰 C1, 이 리뷰 N1 이전 절.
- **페이지 수준 테스트 부재**는 wave9c부터 네 라운드째 반복되는 "Not verified"다. 인디케이터 effect가 이제 분기(`:406`)를 가졌으므로 테스트할
  가치가 생겼다: `loadGoogleDriveIndicator`와 리셋 블록을 `lib/utils/google-drive-indicator.ts` 옆의 순수 함수(예: `nextIndicatorState(prevId,
  albumId, counters)`)로 빼면 페이지를 렌더하지 않고도 "같은 id면 유지, 다른 id면 리셋"을 스펙으로 못박을 수 있다. 다음 웹 라운드 후보.
- **배포 체크리스트에는 추가할 것이 없다.** 서버 변경 0, 마이그레이션 0. wave9f의 하드 게이트(redirect 파생)가 그대로 적용된다.

---

**판정: NOT BLOCKED.** `6fec788a3`는 다음 운영 이미지에 포함해도 된다. N1(한 줄, `$state` 제거 또는 `untrack`)은 이미지에 함께 접는 것을
권하지만, 넣지 않아도 사용자가 보는 동작·원장·서버에는 차이가 없다. 그 수정은 §2대로 다음 라운드 리뷰 대상이다.
