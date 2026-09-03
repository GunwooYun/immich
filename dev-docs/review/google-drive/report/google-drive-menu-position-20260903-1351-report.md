# 리뷰 요청 — 메뉴 위치 버그 수정 + CI 증거 정리

| | |
|---|---|
| 브랜치 | `feat/google-drive-album-sync-v3.1.0` |
| HEAD | `5eddf36b3` |
| 리뷰 대상 커밋 | `a6a3e56c8`(CI), `5eddf36b3`(메뉴 수정) |
| 직전 리뷰 | `../review/google-drive-wave6-round13-format-20260902-1230-review.md` |
| 증거 | `dev-test/google-drive/results/20260903-1350.txt` |
| 작성 | 2026-09-03 13:51 |

## 테스트 결과 (첨부)

```
date:   2026-09-03T13:50:25+09:00
commit: 5eddf36b3

server (unit)              Test Files 8 passed    Tests 239 passed
web (unit)                 Test Files 4 passed    Tests  36 passed   ← 29 + 새 스펙 7
web (svelte-check, gated)  no regressions vs baseline (3 pre-existing files)
server (medium, real DB)   Test Files 1 passed    Tests  10 passed

RESULT: PASS
```

**그리고 이번엔 CI가 실제로 돌았다.** 워크플로 첫 실행에서 세 잡 모두 성공했다
(`https://github.com/GunwooYun/immich/actions/runs/33715025550`, `completed/success`, 약 5분).
아티팩트는 2,132 bytes 하나로, 로컬 증거 한 개가 20KB인 것을 감안하면 압축 후 한 개 분량이다 —
`rm -f`가 의도대로 이번 실행분만 올렸다는 뜻이다.

## 1. `a6a3e56c8` — CI 증거 선택 방식 (직전 리뷰 C1)

직전 라운드가 지적한 대로, 내 이전 수정(`sort | tail -1`)은 **결정적으로 틀렸다**. `run.sh`는
`date +%Y%m%d-%H%M`를 로컬 시각으로 찍고, 커밋된 증거 19개는 KST(`+09:00`)이며 러너는 UTC다.
러너가 03:24Z에 쓰면 `20260902-0324.txt`가 커밋된 KST 파일들보다 **사전순으로 앞서서**, 항상 옛
`RESULT: PASS`를 렌더한다. 고르는 방식을 버리고 실행 전에 디렉토리를 비우는 것으로 바꿨다.

## 2. `5eddf36b3` — 메뉴 위치 버그

**증상**: Drive 앨범 메뉴를 열면 오른쪽이 잘리고 위쪽 툴바와 겹친다.

**원인**: positioning 전략이 아니라 **반응성**이다. `ContextMenu.svelte`의 `position`은
`$derived`인데 그 안에서 `getBoundingClientRect()`/`clientHeight`를 읽는다. 요소 기하는
반응형이 아니므로, 이 블록은 x·y·창 크기·요소 ref가 바뀔 때만 다시 돈다 — **내용이 커지는 것은
그 어느 것도 아니다.** Drive 메뉴는 "Loading" 한 줄로 열렸다가 5행+푸터로 자라므로, 작은 상자
기준 좌표가 그대로 남는다.

**수정**: `ResizeObserver`로 두 요소의 크기를 상태에 넣고 clamp가 그것에 의존하게 했다.
`ButtonContextMenu`가 *창* 리사이즈에 하던 것을 *메뉴 자신의* 리사이즈로 대칭 적용한 것이다.
첫 프레임(관찰자 보고 전)에는 기존 직접 읽기를 폴백으로 남겼다.

**테스트 가능하게 만들기**: clamp를 `context-menu-position.ts`로 추출했다. happy-dom의
`ResizeObserver`는 `observe()`가 명시적으로 "Not implemented"라 반응 경로를 유닛 테스트로
건드릴 수 없다 — 테스트 못 하는 수정이 이 버그를 여기까지 살려둔 이유이기도 하다. 테스트 7개는
리포트의 두 증상(오른쪽 가장자리, 로딩 중 대 로딩 후 같은 앵커)과 마진·방향 스왑·스크롤바 임계를
덮는다.

**비공허 확인**: clamp의 `Math.max/min`을 제거하면 **7개 중 5개가 실패**한다. 통과하는 2개는
clamp가 필요 없는 케이스라 통과가 정상이다. 실험 후 원복했고 `git diff`에 남지 않았다.

**게이트가 내 첫 시도를 잡았다**: 함수 추출로 조기 반환 분기의 타입이 드러나면서 svelte-check
베이스라인 게이트가 새 에러 2건을 내고 `RESULT: FAIL`이 났다(`--no-tsconfig`는 보고하지 않는
것들). 타입 주석으로 해결했고, 런타임 동작(측정 전 프레임에서 `maxHeight`를 설정하지 않음)은
그대로 유지했다 — 0으로 강제하면 그 프레임에 메뉴가 접힌다.

## 공격해 주셨으면 하는 것

1. **`ResizeObserver` 수명주기.** `$effect`에서 만들고 정리 함수로 `disconnect()`한다. 메뉴가
   여러 번 열리고 닫히는 동안 누수나 중복 관찰이 없는지, `menuScrollView`/`menuElement`가
   재바인딩될 때 effect가 올바르게 재실행되는지.
2. **폴백 경로의 정당성.** 관찰 값이 0일 때 직접 읽기로 떨어지는데(`observedWidth || ...`),
   메뉴 폭이 실제로 0일 수 있는 상황에서 무한히 폴백에 머무르지 않는지.
3. **추출한 함수의 경계값.** 창보다 큰 메뉴, 음수 좌표, `direction: 'left'`와 RTL의 조합에서
   기존 동작과 달라진 곳이 없는지. 특히 `layoutDirection`(RTL 스왑)은 컴포넌트에 남겨두고
   함수에는 이미 스왑된 값을 넘긴다.
4. **테스트가 진짜 이 버그를 재현하는가.** "로딩 중 대 로딩 후" 테스트는 같은 앵커로 두 번
   계산해 좌표가 달라지는 것을 단언한다. 이것이 실제 버그(한 번 계산하고 재사용)와 같은 것을
   보고 있는지, 아니면 다른 것을 보고 있는지.

## 검증한 것 / 못 한 것

**검증함**: 239/36/10 PASS(`5eddf36b3`), 무력화 실험(5/7 실패), svelte-check 클린,
`tsc --noEmit` 클린, prettier 클린, CI 첫 실행 3잡 성공.

**검증 못 함**:
- **브라우저에서의 실제 동작.** happy-dom에 `ResizeObserver`가 없어 반응 경로는 유닛 테스트로
  확인할 수 없다. 회귀 테스트의 제자리는 Playwright(`mise //e2e:test-web`)이고, 아직 쓰지 않았다.
  사용자 확인도 아직 받지 않았다.
- **`eslint`가 현재 이 저장소에서 깨져 있다** — 내 변경과 무관하다. 어떤 파일에서든
  `tscompat/tscompat` 룰이 `TypeError: Cannot read properties of undefined (reading 'Class')`로
  크래시한다(건드리지 않은 `album-utils.ts`, `ButtonContextMenu.svelte`에서도 재현). CI의
  `regression` 잡이 초록인 이유는 `//web:ci-unit`에 lint가 포함되지 않기 때문이다(lint는
  `//web:checklist`에만 있다). 별건으로 다뤄야 한다.

## 리뷰어에게

- 코드 변경은 `ContextMenu.svelte`, 새 파일 `context-menu-position.ts`와 그 스펙, 그리고
  `run.sh`의 스펙 목록 한 줄이다.
- 생성물은 포함되지 않았다.
