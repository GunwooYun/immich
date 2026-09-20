# Code Review — wave9h: `driveIndicatorAlbumId`를 `$state`에서 일반 `let`으로 (`5d84f252e`) — 다음 이미지 포함 여부 판정

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `5a8bc8a8f` (`feat/google-drive-album-sync-v3.1.0`) |
| Commits reviewed | `5d84f252e` (fix), `5a8bc8a8f` (리포트) — `git diff 6fec788a3 HEAD -- web/src` (1 file, +8/−2; `dev-docs`·`dev-test/results` 제외) |
| Report | `../report/google-drive-wave9h-tracker-not-state-20260920-1100-report.md` |
| Reviewed | 2026-09-20 16:55 +0900 (모든 수치는 이 워크트리 HEAD에서 직접 돌린 것) |

## Verdict

**판정: NOT BLOCKED — 다음 운영 이미지에 넣어도 된다.** 변경은 wave9g 리뷰 N1이 권한 (a)안 그대로다: `+page.svelte:374`의
`driveIndicatorAlbumId`가 `$state`를 잃고 일반 변수가 됐고, 이 변수를 읽는 곳은 `:412`(effect 안), 쓰는 곳은 `:413`(같은 effect 안)뿐이다
— 템플릿·`$derived`·다른 effect 어디에도 없다(`grep -n driveIndicatorAlbumId`가 세 줄만 낸다). 같은 svelte 5.56.5 런타임으로 돌린 실증
스크립트가 마운트·같은 앨범 리로드·앨범 변경 각 단계에서 effect 1회 · `load` 1회로 떨어졌음을 보였고(`$state`판은 2회 · 2회), 가드의
두 성질(같은 앨범이면 카운터 유지, 다른 앨범이면 초기화)도 그대로다. 파일의 나머지 `$effect` 두 개(`:234`, `:253`)는 업스트림 `main`과
동일하고 같은 문제도 없다. 결함 없음. 남은 것은 리포트 형식에 관한 nit 하나뿐이다.

### Evidence I ran myself

워크트리는 이전 라운드의 `web/node_modules`(svelte 5.56.5)를 그대로 썼다. 소스는 변이하지 않았고(변이가 필요 없는 크기였다), 실증
스크립트와 컴파일 확인은 스크래치패드에서만 돌렸다.

| Check | Result |
|---|---|
| `git status --porcelain` (리뷰 파일 쓰기 전·후) | 빈 출력 → 이 파일 한 줄만 |
| `git diff 6fec788a3 HEAD -- web/src` | `+page.svelte` 한 파일, `:367-374` 주석 + 선언 한 줄 (리포트의 "one line + comment" 일치) |
| `cd web && npx vitest run` | **Test Files 60 passed / 1 skipped, Tests 594 passed / 2 skipped** (리포트의 594/2와 일치) |
| svelte 컴파일러(5.56.5, `runes: true`)로 `+page.svelte` 컴파일 — HEAD와 `6fec788a3` 양쪽 | warnings 0 / 0 — `non_reactive_update` 경고 없음 (아래 Q1) |
| 런타임 실증 (`svelte/src/internal/client`, `$.state/$.derived/$.effect/$.flush`) — `:402-424`를 그대로 옮긴 스크립트, `mode='state'`(변경 전) vs `'plain'`(HEAD) | 아래 표 |
| `git diff main HEAD -- +page.svelte \| grep '\$effect\|closeActivityPanel\|activityManager.init'` | `:234`, `:253` effect는 diff에 없음 → 업스트림 그대로 |

실증 스크립트 결과(각 행은 누적 카운트):

```
state mount                  effectRuns=2 loads=2 backedUp=false
state same-album reload      effectRuns=3 loads=3 backedUp=true     ← +1
state album change A->B      effectRuns=5 loads=5 backedUp=false    ← +2
plain mount                  effectRuns=1 loads=1 backedUp=false
plain same-album reload      effectRuns=2 loads=2 backedUp=true     ← +1, 점 유지
plain album change A->B      effectRuns=3 loads=3 backedUp=false    ← +1, 초기화
```

`state`판은 마운트와 앨범 변경에서 2회씩(wave9g N1의 재현), 같은 앨범 리로드에서는 1회 — 그때는 `:412`가 거짓이라 `:413`의 쓰기가 없어
self-invalidation이 안 일어난다. `plain`판은 전부 1회다.

## Findings

### N1 — 리포트에 `run.sh` 결과 파일이 없다 (nit, 배포 무관)

- `dev-test/google-drive/results/`의 최신 파일은 `20260919-1038.txt`(wave9g 라운드)이고, 이 커밋(`5d84f252e`)에 대한 `run.sh` 증거는 없다.
  리포트는 `mise //web:ci-unit` 594/2만 적었고 내가 같은 숫자를 재현했으므로 판정에는 영향이 없다. 다만 CLAUDE.md §2("`run.sh`가 남긴
  `results/` 파일의 요약을 붙인다")와는 어긋난다. "Short by design"이 리포트 본문을 줄이는 결정이지 증거 파일을 생략하는 결정인지는
  리포트가 말하지 않는다 — 다음 라운드부터는 `run.sh` 한 번이 그 질문을 없앤다.

그 밖의 finding 없음. 주석(`:367-373`)은 "왜 `$state`가 아닌가"를 wave9g N1 참조와 함께 적어 두어 다음 사람이 `$state`로 되돌리는 것을
막는다 — §6 기준에 맞다.

## Answers to what the report asked me to attack

### Q1. 일반 `let`이 맞는가, 아니면 컴포넌트 재초기화에서 값이 사라져 effect가 깨지는가?

**맞다. 잃어도 되는 값이고, 잃어야 하는 순간에만 잃는다.** 세 경우로 나눈다.

- **effect 재실행(같은 인스턴스)**: 변수는 `<script>` 최상위 스코프(`:374`)라 컴포넌트 인스턴스와 수명이 같다. effect가 다시 돌아도
  클로저가 같은 바인딩을 보므로 값은 남는다. 실증의 `plain same-album reload` 행이 이것이다(`backedUp=true` 유지).
- **앨범 간 이동(같은 인스턴스, `data` 교체)**: SvelteKit은 같은 라우트에서 컴포넌트를 재사용하고 `data`만 바꾼다(`:103`
  `$bindable()` prop → `:228` `let album = $derived(data.album)`). 이때도 인스턴스가 살아 있으니 `driveIndicatorAlbumId`는 이전 앨범 id를
  기억하고 `:412`가 참이 되어 초기화한다. 실증의 `album change A->B` 행.
- **컴포넌트 재초기화(새 인스턴스)**: 값이 `undefined`로 돌아가지만, 그때는 `:353-366`의 카운터 `$state`들도 전부 초기값이다. 첫 실행에서
  `:412`가 참 → 이미 초기값인 카운터를 초기값으로 덮고 → `load`. `$state`였어도 같은 인스턴스 생성 시 `undefined`로 시작하므로 이 경우
  둘의 차이는 없다.

반응성이 필요했을 유일한 이유는 "이 값이 바뀌면 뭔가를 다시 계산한다"인데, 이 값을 읽는 코드는 `:412` 하나뿐이고 그 effect의 트리거는
`album`(`:411`)이지 이 변수가 아니다. 즉 이 변수가 반응적이면 **얻는 것은 없고** self-invalidation만 생긴다. 컴파일러 관점에서도 문제없다:
`non_reactive_update`("updated, but is not declared with `$state`") 경고는 템플릿에서 읽히는 변수를 대상으로 하고, HEAD 컴파일에서 경고 0을
확인했다.

### Q2. 가드는 여전히 제 몫을 하는가 — 같은 앨범 리로드는 점을 유지하고, 다른 앨범은 지우는가?

**한다.** 로직(`:411-420`)은 바뀌지 않았고 바뀐 것은 `driveIndicatorAlbumId`의 읽기/쓰기가 signal `get/set`이 아니라 일반 변수 접근이 된
것뿐이다. 실증 표에서 `plain same-album reload`는 `backedUp=true`(시뮬레이션에서 로드가 켠 값)를 유지하고, `plain album change A->B`는
`false`로 떨어진다. wave9g N2(같은 앨범 리로드에서도 재조회는 한다, `:422-424`가 가드 밖)는 이번 변경과 무관하게 그대로다 — 기록용이었고
결함이 아니다.

### Q3. 같은 파일의 다른 `$state`가 한 effect 안에서 읽히고 쓰이는 곳이 있는가?

**없다.** 이 파일의 `$effect`는 세 개다(`:234`, `:253`, `:402`).

- `:234-238`: 읽기 `album.isActivityEnabled`, `activityManager.commentCount`; 쓰기는 `assetViewerManager.closeActivityPanel()` →
  `asset-viewer-manager.svelte.ts:175-177`의 `isShowActivityPanel = false`. 이 effect가 읽지 않는 상태다.
- `:253-259`: 읽기 `assetViewerManager.isViewing`, `isShared`(derived), `album.id`; 쓰기는 `activityManager.init(album.id)` →
  `activity-manager.svelte.ts:61-70`, `#albumId/#assetId`(비반응) 설정 후 `await`. `#commentCount` 쓰기는 await 뒤라 추적 컨텍스트
  밖이고, 이 effect가 그 값을 읽지도 않는다.
- `:402-425`: 읽기 `album.id`, `album.assetCount`, `featureFlagsManager.value.googleDrive`, (이제 비반응인) `driveIndicatorAlbumId`; 쓰기
  `driveBackedUp` 등 여섯 카운터 — 이 effect가 **읽지 않는** `$state`들이다. Svelte의 self-invalidation은 effect가 의존하는 source에
  쓸 때만 일어나므로(`runtime.js`의 `schedule_possible_effect_self_invalidation`이 `effect.deps`를 검사한다) 이 쓰기들은 재실행을 만들지
  않는다. 실증의 `plain` 행이 effect 1회로 끝난 것이 그 증거다(스크립트에서도 `backedUp`을 effect 안에서 쓴다).

앞의 두 effect는 `main`과 동일한 업스트림 코드이기도 하다.

파일 최상위의 다른 `$state`(`:105` `oldAt`, `:106` `viewMode`, `:107` `timelineManager`, `:349` `googleDriveSyncing`, `:353-366` 인디케이터
카운터들)는 이벤트 핸들러·템플릿·`$derived`에서만 읽고 쓴다 — effect 안 읽기+쓰기 조합은 없다.

## What I did not verify

- **브라우저 실측은 하지 않았다.** DevTools Network에서 `getGoogleDriveAlbumStatus`/`getMyGoogleDriveStatus`가 앨범 진입당 한 번씩만 나가는
  것은 wave9g 리뷰가 제안한 확인 방법이고, 이 워크트리에는 실행 스택이 없다. 대신 같은 런타임에서 effect 회수를 셌다 — 두 요청은
  `loadGoogleDriveIndicator` 안에서 `Promise.allSettled`로 묶여 한 번의 `load`당 정확히 한 번씩 나가므로(`:380-383`) effect 회수가 곧 요청 회수다.
- `mise //web:check-svelte`(전체 프로젝트 svelte-check)는 돌리지 않았다. 이 파일을 svelte 컴파일러로 직접 컴파일해 경고 0을 본 것으로
  대신했다 — 타입 오류는 이 방법으로 안 잡히지만, 바뀐 것은 `$state<string | undefined>(undefined)` → `: string | undefined = undefined`로
  타입이 동일하다.
- `dev-test/google-drive/run.sh`는 돌리지 않았다(서버 스위트는 이 변경과 무관하고, 웹 스위트는 전체 `vitest run`으로 대신했다).

## Feeding back into the plan

- `dev-docs/google-drive/`의 인디케이터 절에 한 줄: **effect 안에서만 읽고 쓰는 "이전 값" 추적자는 `$state`로 두지 않는다.** 반응적이면
  self-invalidation으로 effect가 한 번 더 돈다(wave9g N1 → wave9h). 템플릿이 읽지 않는 값은 일반 변수, 반응성이 꼭 필요하면 `untrack`
  (`routes/(user)/search/.../+page.svelte:72-75`의 선례).
- 리포트를 짧게 쓰더라도 `run.sh` 결과 파일은 남긴다(N1).

---

`git status --porcelain` — 리뷰 파일 쓰기 전에는 빈 출력, 쓴 뒤에는 `?? dev-docs/review/google-drive/review/google-drive-wave9h-tracker-not-state-20260920-1100-review.md`
한 줄. 다른 파일은 만들지도 고치지도 않았다(실증 스크립트는 스크래치패드에만 있다).

**판정: NOT BLOCKED. 다음 운영 이미지에 포함해도 된다.**
