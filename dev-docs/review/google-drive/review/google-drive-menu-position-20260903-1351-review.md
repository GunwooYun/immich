# Code Review — 메뉴 위치 버그 수정 + CI 증거 정리 (`5eddf36b3`, `a6a3e56c8`)

|                  |                                                                                   |
| ---------------- | --------------------------------------------------------------------------------- |
| Branch / HEAD    | `feat/google-drive-album-sync-v3.1.0` / `9f9a7c8aa` (리포트 + 직전 리뷰만 추가)   |
| Commits reviewed | `a6a3e56c8` (CI), `5eddf36b3` (메뉴 위치)                                         |
| Report           | `../report/google-drive-menu-position-20260903-1351-report.md`                    |
| Prior review     | `google-drive-wave6-round13-format-20260902-1230-review.md` (C1 = 증거 선택 방식) |
| Reviewed         | 2026-09-03                                                                        |

## Verdict

**진단의 절반은 정확하고 그 절반은 실제로 고쳐졌다. 나머지 절반은 고쳐지지 않았을 뿐 아니라,
리포트와 커밋 메시지가 그 인과를 거꾸로 적었다.** 오른쪽 잘림은 진짜로 해결된다 — 메뉴가
`min-w-50`(200px)에서 `max-w-75`(300px)로 자라는데 좌표가 200px 기준으로 굳어 있었고, 이제
관찰된 폭으로 다시 clamp된다. 그러나 "위쪽 툴바와 겹친다"는 두 번째 증상은 이 변경이 손대는
곳에 있지 않다. `context-menu-position.ts:47`의 `top = Math.max(margin, Math.min(H - height, y))`는
**height에 대해 단조 비증가**다. 즉 높이를 더 정확히(더 크게) 알수록 메뉴는 **위로만** 올라간다 —
툴바 쪽으로. 작은 높이로 계산된 좌표가 메뉴를 툴바 위로 밀어 올렸다는 커밋 메시지의 설명
(`5eddf36b3`: "its top riding up over the toolbar")과 스펙 주석
(`context-menu-position.spec.ts:47-48`: "the lift is too small")은 수식이 하는 일의 정반대다.
그 증거는 리포트가 직접 쓴 테스트에 있다: `shortBox.top === 700`, `grown.top === 400`
(`context-menu-position.spec.ts:46-53`) — 자란 메뉴는 300px **위로** 간다. 일반적인 뷰포트에서는
이 clamp가 아예 발동하지 않아 `top`이 변하지 않고(= 겹침 그대로), 짧은 뷰포트에서는 발동해서
겹침이 **더 심해진다**. 실제 원인은 `+page.svelte:678`의 `offset={{ x: 175, y: 25 }}`와
`ButtonContextMenu.svelte:52`의 기본 `align = 'top-left'`이고, `top-left`는 버튼의 *아래*가 아니라
*위*를 돌려준다(`context-menu.ts:25-27`) — 거기에 +25px이면 메뉴 상단이 트리거 버튼의 세로 중앙,
즉 `ControlAppBar`(`ControlAppBar.svelte:20`, `absolute top-0 … p-2`) 안쪽에 놓인다(C1).

두 번째로 큰 문제는 테스트다. 리포트는 무력화 실험(5/7 실패)을 근거로 비공허성을 주장했고 그
실험은 내가 돌려서 재현했다. 하지만 그것은 *추출된 순수 함수*의 비공허성일 뿐이다. **버그 자체는
전혀 가드되지 않는다**: `ContextMenu.svelte`를 수정 이전(`5eddf36b3^`)으로 되돌려도 web 유닛
36개가 전부 통과한다(직접 실행해 확인, C2). 공격 요청 4번의 답은 "다른 것을 보고 있다"이다.

숫자와 게이트는 전부 재현된다: server 239, web 36, svelte-check 베이스라인 일치, `tsc --noEmit`
클린, prettier 클린. CI 실행도 실재하지만 **리뷰 대상 코드 커밋을 덮지 않는다** — 그 실행의
`head_sha`는 `a6a3e56c8`이고 원격 브랜치 tip도 아직 `a6a3e56c8`이다(N2).

### Evidence I ran myself

| Check                                                                                          | Result                                                                                                    |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `git status --porcelain` (시작·중간·종료)                                                      | 이 리뷰 파일 외 변경 없음. 실험은 전부 `git checkout --`로 원복 확인                                      |
| `npx vitest run` server 8 스펙 (`test/vitest.config.mjs`)                                      | `Test Files 8 passed / Tests 239 passed` — 리포트와 일치                                                  |
| `npx vitest run` web 4 스펙                                                                    | `Test Files 4 passed / Tests 36 passed` — 리포트와 일치                                                   |
| `npx svelte-check --output machine` + run.sh의 `sc_extract` 파이프라인                         | 3파일(2/2/3) — `svelte-check-baseline.txt`와 **완전 일치**, 회귀 0                                        |
| `npx tsc --noEmit` (web)                                                                       | exit 0, 출력 없음                                                                                         |
| `npx prettier --check` (신규 2파일 + `ContextMenu.svelte`)                                     | `All matched files use Prettier code style!`                                                              |
| **무력화 실험**: `context-menu-position.ts:46-47`의 `Math.max/min` 제거 후 스펙 실행           | `Tests 5 failed \| 2 passed (7)` — 리포트의 5/7 주장 재현. 원복 후 `git status` 클린                      |
| **가드 실험**: `git show 5eddf36b3^:…/ContextMenu.svelte`로 되돌린 뒤 web 4 스펙 실행          | `Tests 36 passed` — **수정을 전부 제거해도 테스트가 잡지 못한다**(C2). 원복 확인                          |
| `npx eslint` (web: 신규 파일, `album-utils.ts`, `ButtonContextMenu.svelte`, `context-menu.ts`) | 전부 `TypeError: … reading 'Class'`로 크래시(rc=2). `generate-id.ts`는 rc=0                               |
| `npx eslint src/utils/google-drive.ts` (server)                                                | rc=0 — 크래시는 web 전용                                                                                  |
| GitHub API: run `33715025550`                                                                  | `conclusion: success`, 3잡 모두 success, artifact 2,132 bytes — 리포트와 일치. 단 `head_sha = a6a3e56c8`  |
| GitHub API: 워크플로 `349009141`의 전체 실행 목록 / 브랜치 tip                                 | 실행은 **그 1건뿐**, 원격 tip도 `a6a3e56c8` — `5eddf36b3`는 CI를 통과한 적이 없다                         |
| `happy-dom@20.10.6/lib/resize-observer/ResizeObserver.js`                                      | `observe/unobserve/disconnect` 전부 빈 함수 — 리포트 주장 정확, 던지지 않으므로 기존 테스트도 깨지지 않음 |

## Findings

### C1 — 사용자 증상 2건 중 1건만 해결된다. 그리고 두 번째의 인과 설명이 뒤집혀 있다 (High)

`context-menu-position.ts:46-47`:

```ts
const left = Math.max(margin, Math.min(windowInnerWidth - width - margin, x - directionWidth));
const top = Math.max(margin, Math.min(windowInnerHeight - height, y));
```

`top`은 `height`가 커질수록 작아지거나 그대로다(단조 비증가). 따라서 **"작은 상자 기준으로 계산된
좌표"는 메뉴를 툴바 위로 올릴 수 없다** — 오히려 `top = y`로 두어 아래쪽에 두는 방향이다.
정확한(더 큰) 높이를 넣으면 메뉴는 위로 간다. 리포트가 쓴 테스트가 이것을 그대로 보여준다:

```ts
// context-menu-position.spec.ts:46-53
const shortBox = computeMenuPosition({ ...viewport, x: 100, y: 700, width: 200, height:  40, ... });
const grown    = computeMenuPosition({ ...viewport, x: 100, y: 700, width: 200, height: 400, ... });
expect(shortBox.top).toBe(700);
expect(grown.top).toBe(400);   // 300px 위로
```

그런데 그 바로 위 주석(`:47-48`)은 "메뉴가 툴바를 덮은 것은 lift가 너무 작았기 때문"이라고 적혀
있다. 이 테스트는 정확히 반대를 단언하고 있다.

**실제 겹침의 출처**를 코드 경로로 따라가면:

- `+page.svelte:674-681` — Drive 메뉴는 `offset={{ x: 175, y: 25 }}`, `align`은 미지정.
- `ButtonContextMenu.svelte:52` — `align = 'top-left'` 기본값.
- `ButtonContextMenu.svelte:83` → `getContextMenuPositionFromEvent(event, 'top-left')`
  → `context-menu.ts:25-27` — `top-left`는 `{ x: rect.x, y: rect.y }`, 즉 트리거 버튼의 **윗변**.
- `ButtonContextMenu.svelte:249` — `y={contextMenuPosition.y + 25}`.

원형 IconButton 높이가 40~48px이므로 메뉴 상단은 버튼의 세로 중앙 근처, 즉
`ControlAppBar`(`ControlAppBar.svelte:20`: `absolute top-0 w-full … p-2`) 안쪽에 놓인다. 이번
커밋들은 이 계산에 손대지 않는다.

두 증상의 결론:

- **오른쪽 잘림: 해결됨.** 메뉴는 `ContextMenu.svelte:99`의 `w-max max-w-75 min-w-50`이므로
  로딩 중 200px, 로딩 후 최대 300px이다(`GoogleDriveAlbumMenu.svelte:123-127` 한 줄 vs
  `:146-258` 3~4행). 폭이 100px 커지는 동안 `left`가 200px 기준으로 굳어 있었고, 관찰 폭이
  들어오면서 `left`가 `W - width - 8`로 다시 당겨진다. 이 부분은 진단도 수정도 옳다.
- **툴바 겹침: 해결되지 않음.** 일반 뷰포트(`H - height > y`)에서는 `top`이 그대로 `y`라 변화가
  없고, 짧은 뷰포트에서는 clamp가 발동해 **더 위로** 올라간다.

**Fix**: (a) `+page.svelte:674-681`의 `align="bottom-left"`로 바꾸고 `offset.y`를 0~4로 줄인다
(`bottom-left`는 `rect.y + rect.height`를 준다 — `context-menu.ts:31-33`). 또는 (b) 트리거의
bottom을 하한으로 `top`을 clamp한다. 어느 쪽이든 **이번 커밋의 반응성 수정과는 독립적인 변경**이며,
따로 사용자 확인을 받아야 한다. 그리고 (c) `5eddf36b3` 커밋 메시지와
`context-menu-position.spec.ts:47-48`의 인과 설명을 정정하고, 리포트의 "두 증상을 덮는다"는
주장을 "오른쪽 가장자리 하나"로 축소한다.

### C2 — 새 테스트 7개는 이 버그를 가드하지 않는다 (High)

`ContextMenu.svelte`를 수정 이전 버전으로 통째로 되돌린 뒤(`git show 5eddf36b3^:…`) web 유닛
4스펙을 돌리면 **36개가 전부 통과**한다. `ResizeObserver`도, `computeMenuPosition` 호출도 없는
상태에서다. 즉 이 스펙은 회귀를 잡지 못한다.

공격 요청 4번에 직접 답하면: `should widen its correction as the menu grows`
(`context-menu-position.spec.ts:33-44`)는 `width`가 다른 **두 번의 독립 호출**이 다른 답을 준다고
단언한다. 이는 "순수 함수가 인자에 의존한다"는 진술이고, 바로 앞 테스트
(`should pull the menu back inside the right edge`, `:24-31`)가 이미 덮는다. 실제 버그는 "한 번
계산하고 재사용"이라는 **컴포넌트의 재호출 실패**이므로, 순수 함수 호출을 두 번 하는 테스트로는
원리적으로 재현할 수 없다. 무력화 실험이 5/7을 실패시킨 것은 clamp의 산술이 살아 있음을 보인
것이지 반응성을 보인 것이 아니다.

**Fix**: 둘 중 하나.

1. 리포트 스스로 적은 대로 Playwright(`mise //e2e:test-web`)에서 "메뉴를 열고 → 내용을 늘리고 →
   `getBoundingClientRect().right <= innerWidth`"를 확인한다. 이것이 제자리다.
2. 더 싸게 지금 당장 가드하려면, vitest 셋업에서 `globalThis.ResizeObserver`를 제어 가능한 가짜로
   덮고(등록된 콜백을 테스트가 직접 호출) `ButtonContextMenu.spec.ts`류의 컴포넌트 테스트에서
   `menuScrollView.style.left`가 콜백 이후 바뀌는지를 단언한다. happy-dom의 no-op 구현은 전역
   할당으로 간단히 대체된다(`ResizeObserver.js`는 클래스 3메서드가 전부 비어 있다).

이 중 하나가 들어가기 전까지 "테스트 못 하는 수정이 이 버그를 여기까지 살려둔 이유"라는 리포트의
문장은 **여전히 참**이다.

### N1 — 이 저장소의 관용구로 훨씬 단순하게 쓸 수 있었다 (Medium)

`ContextMenu.svelte:73-88`의 수동 `$effect` + `ResizeObserver` + `disconnect()` + `:60-61`의
`observedWidth || getBoundingClientRect()` 폴백은 전부 Svelte 5의 크기 바인딩으로 대체된다:

```svelte
<div bind:this={menuScrollView} bind:offsetWidth={observedWidth} …>
  <ul  bind:this={menuElement}   bind:clientHeight={observedHeight} …>
```

- Svelte는 앱 전체에서 **단 하나의 공유 `ResizeObserver`**를 쓴다
  (`svelte/src/internal/client/dom/elements/bindings/size.js:8` `class ResizeObserverSingleton`,
  `:99-105` `bind_element_size`) — 크로미움 팀이 권고하는 형태이고 소스에 그 링크가 붙어 있다.
  지금 코드는 **ContextMenu 인스턴스마다** 옵저버를 하나씩 만든다. `ButtonContextMenu.svelte:226`이
  `{#if isOpen || !hideContent}`이므로 `hideContent`를 안 쓰는 18개 메뉴는 상시 마운트다 = 페이지당
  옵저버 18개, 관찰 대상 36개.
- `bind_element_size`는 `effect` 안에서 초기값을 한 번 세팅하므로(`size.js:101-105`) **폴백 자체가
  불필요**해진다 — 공격 요청 2번의 질문이 통째로 사라진다.
- 해제는 `teardown(unsub)`으로 자동. 공격 요청 1번의 감사 대상이 사라진다.
- 이미 이 저장소의 관용구다: `PhotoViewer.svelte:217`, `VideoNativeViewer.svelte:355-356`,
  `MemoryViewer.svelte:370-371`, `QrCodeModal.svelte:22` 등 11곳 이상.

주의할 점 하나: `clientWidth`는 패딩 박스라 스크롤바를 제외한다. 현재 코드가 읽는 값은
`getBoundingClientRect().width`(보더 박스)이고 `app.css:44-47`의 `immich-scrollbar`는
`scrollbar-width: thin` — 공간을 차지하는 스크롤바다. 그러므로 **`bind:clientWidth`가 아니라
`bind:offsetWidth`**를 써야 기존 값과 동일하다. `<ul>` 쪽은 원래 `menuElement.clientHeight`였으므로
`bind:clientHeight`가 정확히 같은 값이다.

이것은 "지금 코드가 틀렸다"가 아니라 "감사할 표면을 16줄만큼 줄일 수 있었다"는 지적이다.
`@immich/ui` 교체를 검토하고 기각한 흔적은 리포트에 있는데, 같은 파일 안에서 가능한 이 대안은
검토된 흔적이 없다.

### N2 — CI 증거가 리뷰 대상 코드 커밋을 덮지 않는다 (Medium)

리포트 §맨 앞은 "그리고 이번엔 CI가 실제로 돌았다"로 시작해 세 잡 성공을 든다. 실행 자체는
사실이다(직접 확인: `conclusion: success`, 3잡 success, artifact 2,132 bytes). 그러나

- 그 실행의 `head_sha`는 `a6a3e56c8c6db69c1dd46b45064c6d69973cffab` — **CI 커밋**이다.
- 워크플로 `349009141`의 실행 목록에는 그 1건밖에 없다(`run_number: 1`).
- 원격 브랜치 `feat/google-drive-album-sync-v3.1.0`의 tip도 아직 `a6a3e56c8`이다.

즉 `context-menu-position.ts`, 그 스펙, 수정된 `ContextMenu.svelte`, 그리고 run.sh에 추가된
스펙 한 줄은 **CI를 한 번도 통과하지 않았다**. 특히 `regression` 잡의 `//web:ci-unit`이
`:format`(prettier)과 `:check`(svelte-check+tsc)를 포함하는데, 이번에 추가된 파일들에 대해서는
아직 돌지 않았다. 나는 그 세 가지를 로컬에서 직접 돌려 통과를 확인했으므로 실질 위험은 낮지만,
리포트의 문장은 독자가 "이번 라운드가 CI로 검증됐다"로 읽게 만든다. **Fix**: 리포트에서 CI 문단을
`a6a3e56c8` 한정으로 명시하거나, 푸시 후 실행 링크를 갱신한다.

### N3 — `top` clamp에는 하단 margin이 없다 (nitpick, 기존 동작)

`context-menu-position.ts:46-47`에서 `left`는 `windowInnerWidth - width - margin`인데 `top`은
`windowInnerHeight - height`로 margin이 빠져 있다. 수정 전(`5eddf36b3^`의 `ContextMenu.svelte:49-50`)과
바이트 단위로 같은 비대칭이므로 **동작 보존은 정확하다**. 다만 함수로 뽑아 이름을 붙이는 순간이
이 비대칭을 문서화하거나 정정할 자리였다. `should never place the menu outside the top-left margin`
(`:56-69`)은 좌상단만 보므로 하단이 뷰포트에 딱 붙는 경우를 잡지 못한다. 고칠 거라면 별도 커밋으로,
고치지 않을 거라면 함수 doc에 한 줄로 남기면 된다.

### N4 — `observedWidth`/`observedHeight` 선언이 사용처보다 아래에 있다 (nitpick)

`ContextMenu.svelte:70-71`에서 선언되는데 이를 읽는 `$derived.by`는 `:44-66`이다. `$derived`가
지연 평가라 TDZ에 걸리지 않고, 실제로 `ButtonContextMenu.spec.ts`가 이 컴포넌트를 렌더해서 통과한다.
그래도 선언을 derived 위로 올리는 데 드는 비용은 0이고, 나중에 누군가 이 값을 즉시 읽는 코드로
바꿀 때의 함정이 사라진다.

### N5 — 폭 피드백 루프는 수렴하지만 브라우저에서 확인되지 않았다 (nitpick / 미검증)

`needScrollBar`가 켜지면 `ContextMenu.svelte:100`이 `overflow-auto`를 붙이고, `scrollbar-width: thin`은
공간을 차지하므로 관찰 폭이 바뀐다 → 옵저버 → `left` 재계산. `needScrollBar`는 폭이 아니라
높이에만 의존하므로 발산하지는 않는다. 다만 폭이 줄면 텍스트 줄바꿈으로 `<ul>`의 `clientHeight`가
늘 수 있어, 브라우저에서 `ResizeObserver loop completed with undelivered notifications` 경고가
뜨는지는 한 번 봐 둘 가치가 있다. 또한 `ContextMenu.svelte:104-105`의 `max-height` 250ms 트랜지션
동안 관찰 대상 div가 매 프레임 리사이즈되므로 콜백이 열 때마다 10~15회 돌고 그때마다
`getBoundingClientRect()`를 호출한다. 값이 같아 Svelte의 상태 동등성 비교가 리렌더를 막으므로
기능적 문제는 없다.

## Answers to what the report asked me to attack

### 1. `ResizeObserver` 수명주기 — 누수·중복 관찰 없음. 다만 인스턴스당 옵저버 1개다

`$effect`(`ContextMenu.svelte:73-88`)의 **추적 의존성은 정확히 `menuScrollView`와 `menuElement`
두 개**다. 본문에서 동기적으로 읽는 반응형 값이 그 둘뿐이기 때문이다(`:74-75`).
`typeof ResizeObserver`는 전역 읽기라 추적되지 않고, `observedWidth`/`observedHeight`는 본문이 아니라
**RO 콜백 안에서만** 대입된다(`:81-82`). RO 콜백은 추적 컨텍스트 밖에서 실행되므로 이 대입은
effect의 의존성이 되지 않는다 — 자기 자신이 쓴 값 때문에 재실행되는 루프는 없다.

- **재바인딩**: `menuScrollView`/`menuElement`는 `$bindable()` 프롭이고 `bind:this`로 대입된다
  (`:97`, `:115`). 값이 바뀌면 effect는 정리 함수(`:87` `observer.disconnect()`)를 먼저 돌리고
  재실행한다. 옵저버 하나가 두 요소를 관찰하는 형태라 중복 관찰도 구조적으로 불가능하다.
- **여러 번 열고 닫기**: Drive 메뉴는 `hideContent`를 쓰므로(`+page.svelte:679`)
  `ButtonContextMenu.svelte:226`의 `{#if isOpen || !hideContent}`가 닫을 때 컴포넌트를 언마운트한다
  → effect teardown → `disconnect()`. 열 때마다 새 인스턴스, 새 옵저버 1개. 누수 없음.
- **`hideContent`를 안 쓰는 18개 메뉴**는 상시 마운트라 옵저버도 상시 살아 있다. 누수는 아니지만
  공유 옵저버 하나면 될 일을 인스턴스 수만큼 만든다 — N1의 근거다.
- 마운트 순서도 문제없다: `bind:this`는 렌더 이펙트라 사용자 `$effect`보다 먼저 돌므로 첫 실행에서
  두 ref가 이미 채워져 있다.

결론: 이 항목에 대해서는 리포트가 맞다. 지적할 것은 정확성이 아니라 **필요 없는 코드라는 점**이다.

### 2. 폴백 경로 — 무한히 머무를 수 있지만 해가 없다

`observedWidth || menuScrollView.getBoundingClientRect().width`(`:60`)는 상태가 아니라 **derived가
돌 때마다 다시 평가되는 식**이므로 "폴백에 갇힌다"는 상태 자체가 존재하지 않는다. 그리고 메뉴 폭이
정말로 0인 상황(조상이 `display:none` 등)에서는 폴백 읽기도 0을 준다 — 즉 **수정 이전과 정확히 같은
동작**이다. `width: 0`이면 `left = max(8, min(W-8, x))`로, 이 역시 기존 동작이다. 실패 모드 없음.

untidy한 점은 `0`이 "아직 측정 안 됨"과 "진짜 0"을 구분하지 못한다는 것인데, 이 컴포넌트에서는
두 경우의 결과가 같아서 문제가 되지 않는다. N1의 `bind:offsetWidth`로 가면 Svelte가 `effect`에서
초기값을 세팅하므로(`size.js:101-105`) 질문 자체가 없어진다.

### 3. 추출 함수의 경계값 — 기존 동작과 다른 곳 없음. RTL 스왑 주장도 사실

`5eddf36b3^`의 `ContextMenu.svelte:39-56`와 `context-menu-position.ts:34-51`을 식 단위로 대조했다.
`margin = 8`, `directionWidth`, `left`, `top`, `maxHeight`, `needScrollBar` 모두 동일하다.

- **RTL 스왑**: 리포트 주장은 **사실이다**. `ContextMenu.svelte:39`에서
  `layoutDirection = rtl ? swap(direction) : direction`로 먼저 스왑하고, `:64`에서 그 값을
  `direction:`으로 넘긴다. 함수는 이미 스왑된 값을 받는다. `direction: 'left'` + RTL이면
  `layoutDirection === 'right'` → `directionWidth = 0` → 앵커의 왼쪽 정렬. 수정 전과 동일.
- **창보다 큰 메뉴**: `width > W - 16`이면 `min(...)`이 8보다 작아져 `left = 8`. 메뉴는 오른쪽으로
  넘쳐 잘린다 — 기존과 같다(수평 축소/플립은 원래 없다). 높이는 `top = 8`,
  `maxHeight = H - 16`, `needScrollBar = true`로 스크롤이 처리한다. 스펙 `:56-69`가 이 경계를 덮는다.
- **음수 좌표**: `x < 8`이든 `y < 0`이든 바깥 `Math.max(margin, …)`가 8로 끌어올린다.
- **`needScrollBar` 임계**: `height > maxHeight`. 스펙 `:77-86`가 양쪽을 다 본다(795 vs 92).

이 항목은 리포트가 맞다. 다만 N3의 상·하단 margin 비대칭은 "기존 동작 보존"으로 통과했을 뿐
의도된 설계로 확인된 것은 아니다.

### 4. 테스트가 진짜 이 버그를 재현하는가 — 아니다

C2 참조. 요약하면: 그 테스트는 순수 함수가 `width` 인자에 의존한다는 것을 단언하고, 그것은 바로 앞
테스트가 이미 덮는 사실이다. 버그는 컴포넌트가 함수를 **다시 부르지 않는 것**이었으므로 함수를 두 번
부르는 테스트로는 잡히지 않는다. 실험으로 확정했다 — 수정을 통째로 되돌려도 36/36 통과.

### 추가 질문 (a) 두 증상 모두 해결되는가 — 아니다, 하나뿐

C1 참조. 오른쪽 잘림 O, 툴바 겹침 X(짧은 뷰포트에서는 악화).

### 추가 질문 (b) `@immich/ui` ContextMenu 기각은 타당한가 — 타당하다

패키지를 직접 읽어서 확인했다(`@immich/ui@0.83.0`).

- `dist/types.d.ts:280-292`: `MenuProps = { items: MenuItems; bottomItems?; size? } & HTMLAttributes<…>`,
  `ContextMenuProps = MenuProps & { target: HTMLElement; position?; onClose }`.
- `dist/components/ContextMenu/ContextMenu.svelte`에는 **`{@render}`가 한 번도 나오지 않는다**
  (grep으로 확인). 즉 `children` 스니펫을 렌더할 방법이 없고, `items` 배열만 자기가 그린다.
- Drive 메뉴는 `Switch` 토글 행, 스토리지 게이지 바, 트래시 힌트, 푸터 링크를 담아야 한다
  (`GoogleDriveAlbumMenu.svelte:157-258`). `ActionItem`/`MenuItemType`으로 표현 불가.

따라서 드롭인 교체가 불가능하다는 판단은 옳다. 한 가지 덧붙일 사실: 이 컴포넌트의 내부는
`bits-ui`의 `DropdownMenu`이고(`ContextMenu.svelte:9`) bits-ui 자체는 임의의 자식을 받는다. 다만
`bits-ui`는 `web/package.json`의 직접 의존성이 아니라 `@immich/ui`를 통한 전이 의존성이므로,
그 길을 택하려면 의존성 추가가 필요하다 — 이 라운드의 범위를 넘는다. **기각은 유지가 맞다.**
다만 리포트가 검토하지 않은 대안이 하나 남아 있었다(N1).

### 추가 질문 (c) eslint 주장 — 사실이나 "저장소 전체"는 과장. 숨기는 것은 있다

- **사실 확인**: `context-menu-position.ts`, 손대지 않은 `album-utils.ts`,
  `ButtonContextMenu.svelte`, `context-menu.ts` 모두 동일한 크래시
  (`tscompat/tscompat` → `TypeError: Cannot read properties of undefined (reading 'Class')`,
  `@koddsson/eslint-plugin-tscompat@0.2.0`). 이번 변경과 무관하다는 결론은 **맞다**.
- **정정 1**: 파일 단위다. `generate-id.ts`는 rc=0으로 통과한다 — 룰이 해석하지 못하는
  member expression이 있는 파일에서만 터진다(신규 파일의 경우 `:46`, 즉 `Math.max` 줄).
- **정정 2**: **web 전용**이다. `tscompat`은 `web/eslint.config.js:2,24,27`에만 등록돼 있고,
  server는 `npx eslint src/utils/google-drive.ts`가 rc=0이다. 실제로 CI `regression` 잡의
  `server — format, lint, check, unit tests` 스텝이 success였다(`//server:ci-unit`은
  `server/mise.toml:58-66`에서 `:lint`를 포함한다). 리포트의 "저장소에서 깨져 있다"는 이 구분을 흐린다.
- **`//web:ci-unit`에 lint가 없다는 설명은 정확하다**: `web/mise.toml:45-52`는
  install/format/check/test, lint는 `:54-57`의 `checklist`에만 있다.
- **숨기는 것**: 이번 두 파일(`context-menu-position.ts`, `.spec.ts`)은 **린트를 한 번도 받지 못했다**.
  prettier·tsc·svelte-check가 통과했으므로 남는 위험은 스타일/`unicorn` 계열 룰뿐이라 낮지만,
  0은 아니다. 더 중요한 것은 **`//web:checklist`가 현재 실행 불가능**하다는 사실이고, 이는 이 포크가
  가진 유일한 web lint 게이트다. 리포트대로 별건이지만, 플랜에 티켓으로 남겨야 한다.

## What I did not verify

- **브라우저에서의 실제 동작.** 이 세션에서 Playwright도 실제 브라우저도 돌리지 않았다. C1의
  "툴바 겹침의 출처는 `align='top-left'` + `offset.y=25`"는 `ControlAppBar.svelte:20`,
  `context-menu.ts:25-27`, `ButtonContextMenu.svelte:52,83,249`를 읽고 세운 **코드 경로 추론**이며,
  버튼의 실제 `rect.y`와 앱바의 실제 높이를 픽셀로 재지 않았다. 다만 "높이가 커질수록 `top`은
  작아진다"는 C1의 핵심 논거는 `context-menu-position.ts:47`의 산술만으로 성립하고 스펙 `:46-53`이
  그것을 그대로 단언하므로, 브라우저 없이도 확정적이다.
- **`server (medium, real DB)` 10 tests.** 데이터베이스가 필요해 돌리지 않았다. 증거 파일
  `20260903-1350.txt:157-158`의 기록만 읽었다.
- **web/server 전체 스윕**(`//web:ci-unit`, `//server:ci-unit`). 기능 스펙 12개 + svelte-check +
  tsc + prettier만 돌렸다. `5eddf36b3`가 아직 푸시되지 않아 CI 결과도 없다(N2).
- **N5의 `ResizeObserver` 루프 경고**와 스크롤바 등장 시 폭 변화의 실제 픽셀 값.
- **eslint 크래시의 근본 원인**(`@koddsson/eslint-plugin-tscompat@0.2.0` + TS 6 조합으로 보이나
  추적하지 않았다).
- `a6a3e56c8`의 `rm -f` 동작은 아티팩트 크기(2,132 bytes, 파일 1개 분량)와 잡 success로만 확인했고,
  러너 로그를 직접 읽지는 않았다.

## Feeding back into the plan

1. **"툴바 겹침"은 아직 열린 버그다.** 플랜에서 이 라운드를 "메뉴 위치 버그 수정 완료"로 닫지 말고,
   증상을 둘로 분리해 기록한다 — (i) 오른쪽 잘림 = 반응성, `5eddf36b3`로 해결, (ii) 툴바 겹침 =
   앵커 정렬(`align`/`offset`), **미해결**. 다음 라운드의 첫 항목은 `align="bottom-left"` 검토와
   사용자 재확인이다.
2. **`top` clamp의 방향성을 플랜에 명시한다.** `top = max(m, min(H - height, y))`는 height에 대해
   단조 비증가 — "메뉴가 커지면 위로 간다". 이 한 줄이 없으면 다음 사람이 같은 인과를 또 뒤집는다.
3. **회귀 가드의 제자리는 Playwright다.** happy-dom의 `ResizeObserver`가 no-op인 이상 유닛 테스트로
   반응 경로를 덮을 수 없다는 사실을, "그래서 순수 함수 테스트로 갈음한다"가 아니라 "그래서 e2e
   항목을 만든다"로 기록한다(C2). 임시 대안으로 `globalThis.ResizeObserver` 페이크 주입안을 남긴다.
4. **크기 관측은 `bind:offsetWidth`/`bind:clientHeight`가 이 저장소의 표준이다**(N1). 앞으로 요소
   기하가 필요할 때 수동 `ResizeObserver`를 쓰지 않는다는 규칙을 남긴다.
5. **CI 증거는 "어떤 커밋에서 돌았는가"를 항상 함께 적는다**(N2). 이번 리포트는 CI 성공과 코드
   커밋을 같은 문단에 두어 실제보다 넓은 커버리지를 암시했다. 리포트 템플릿에 `head_sha` 칸을 넣는다.
6. **`web` eslint 크래시는 별도 티켓으로 승격한다.** `//web:checklist`가 실행 불가능하다는 것은
   포크의 web lint 게이트가 통째로 죽어 있다는 뜻이다. 최소한 `tscompat` 룰을 임시로 끄고 나머지
   룰이라도 살릴지 결정한다.

---

**변경 파일 확인**: 리뷰 작성 전후로 `git status --porcelain`을 돌렸고, 무력화 실험
(`context-menu-position.ts`)과 가드 실험(`ContextMenu.svelte`) 모두 `git checkout --`로 원복해
빈 출력을 확인했다. 이 저장소에서 내가 만든 변경은 **이 리뷰 파일 하나뿐**이다.
