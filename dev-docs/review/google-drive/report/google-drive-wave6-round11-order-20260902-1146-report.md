# 리뷰 요청 — round-11 지적(C1-again) 반영: sdk → plugin-sdk 빌드 순서

| | |
|---|---|
| 브랜치 | `feat/google-drive-album-sync-v3.1.0` |
| HEAD | `4e10792d3` |
| 리뷰 대상 커밋 | `4e10792d3` (단일) |
| 직전 리뷰 | `../review/google-drive-wave6-round10-fixes-20260902-0952-review.md` |
| 증거 | `dev-test/google-drive/results/20260902-1145.txt` |
| 작성 | 2026-09-02 11:46 |

## 테스트 결과 (첨부)

```
date:   2026-09-02T11:45:54+09:00
commit: 4e10792d3 (feat/google-drive-album-sync-v3.1.0)

server (unit)                Test Files  8 passed (8)    Tests  239 passed (239)
web (unit)                   Test Files  3 passed (3)    Tests   29 passed (29)
web (svelte-check, gated)    no svelte-check regressions vs baseline (3 pre-existing files)
server (medium, real DB)     10 passed

RESULT: PASS
```

이번 변경은 **워크플로 YAML 한 곳의 순서**뿐이라 테스트에 영향을 주지 않는다. 그럼에도 증거를
재생성한 이유는 §2가 커밋 기준 증거를 요구하기 때문이다.

## 무엇을 바꿨나

round-10에서 넣은 C1 수정(`plugin-sdk` 빌드 추가)이 **진단은 맞고 순서가 틀렸다.**

```
packages/plugin-sdk/src/host-functions.ts:7   @immich/sdk 에서 값을 import
packages/plugin-sdk/esbuild.js:6              bundle: true → 빌드 시 디스크에서 해결
```

따라서 `plugin-sdk`를 먼저 빌드하면 클린 러너에서 테스트에 닿기 전에 죽는다. 순서를
`sdk → plugin-sdk`로 바꾸고, 주석에 이 순서가 load bearing임을 명시했다.

**로컬에서 통과했던 이유가 앞선 커밋이 고치려던 함정과 동일하다** — 예전 빌드가 남긴
`packages/sdk/build`가 있었다. 같은 덫에 두 커밋 연속으로 걸렸다는 사실 자체를 주석에 남겼다.

## 직접 재현한 것 (양방향)

| 실험 | 결과 |
|---|---|
| `packages/sdk/build`·`packages/plugin-sdk/dist` 삭제 → `pnpm --filter @immich/plugin-sdk build` | `✘ [ERROR] Could not resolve "@immich/sdk"` at `src/host-functions.ts:7:7`, **exit 1** |
| 같은 상태에서 `sdk` 빌드 → `plugin-sdk` 빌드 | 둘 다 생성(`packages/sdk/build/index.js`, `packages/plugin-sdk/dist/index.js`) ✅ |

즉 이 수정은 **실제로 존재하는 실패를 없앤다**(고쳐도 그만인 정리가 아니다).

## 리뷰의 나머지 판정 — 수정 없음으로 확정

직접 대조해 리뷰어와 같은 결론에 도달했다:

- **C2**: `feature` 잡이 돌리는 스펙 중 `e2e/test-assets`를 읽는 것이 없다 → 서브모듈 체크아웃은
  `medium` 잡에만 필요.
- **C3**: `steps.<id>.outcome` 문법이 유효하고, summary 스텝은 `if: always()`로 실패 후에도 실행된다.
- **N2**: `mapConfig`는 `system-config.dto.ts:463-465`에서 identity가 맞다.

## 공격해 주셨으면 하는 것

1. **이 순서로 정말 충분한가.** `sdk → plugin-sdk → server → web` 사슬에서 또 다른
   gitignore된 산출물에 런타임으로 의존하는 워크스페이스가 남아 있는지. 특히 `immich-web`의
   `svelte-kit sync`가 `@immich/sdk` 빌드 산출물을 요구하는 시점이 맞는지.
2. **로컬 재현 실험의 타당성.** 저는 `install`을 건너뛰고 `build`만 돌려 순서를 검증했다
   (node_modules가 이미 있었기 때문). 클린 러너에서는 `install`이 함께 도는데, pnpm의
   워크스페이스 링크가 이 결론을 바꿀 여지가 있는지.
3. **주석이 다음 사람을 실제로 막아주는가.** "ORDER MATTERS" 주석이 이 함정을 설명하는 데
   충분한지, 아니면 순서를 강제하는 다른 장치(예: `//:plugins` 같은 단일 태스크)가 나은지.

## 검증한 것 / 못 한 것

**검증함**: 위 양방향 재현, 239/29/10 PASS(`4e10792d3`), YAML 파싱 + `prettier --check`.

**검증 못 함**: **여전히 CI를 한 번도 실행하지 않았다.** Actions 활성 여부, `jdx/mise-action@v3`의
동작, 클린 러너에서의 전체 소요 시간은 열려 있다. 이 수정도 저장소를 읽고 로컬에서 재현해 고친
것이지 러너 로그로 확인한 것이 아니다.

## 리뷰어에게

- 코드 변경 없음. **워크플로 YAML 한 파일**과 그 주석뿐이다.
- 생성물은 이번에도 포함되지 않았다.
