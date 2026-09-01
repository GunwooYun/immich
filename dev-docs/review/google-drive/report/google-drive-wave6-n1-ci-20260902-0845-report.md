# 리뷰 요청 — Wave 6 리뷰 N1 반영 + 포크 전용 CI + CLAUDE.md 복원

| | |
|---|---|
| 브랜치 | `feat/google-drive-album-sync-v3.1.0` |
| HEAD | `6bf716ca2` |
| 리뷰 대상 커밋 | `7ab1baebb`, `51d32bd52`, `e2c0a1cff`, `6bf716ca2` |
| 직전 리뷰 | `../review/google-drive-wave6-fixes-20260902-0750-review.md` (N1 제기) |
| 증거 | `dev-test/google-drive/results/20260902-0843.txt` |
| 작성 | 2026-09-02 08:45 |

## 테스트 결과 (첨부)

```
Google Drive — unit test run
date:   2026-09-02T08:43:20+09:00
commit: 6bf716ca2 (feat/google-drive-album-sync-v3.1.0)

server (unit)                Test Files  8 passed (8)    Tests  239 passed (239)
web (unit)                   Test Files  3 passed (3)    Tests   29 passed (29)
web (svelte-check, gated)    no svelte-check regressions vs baseline (3 pre-existing files)
server (medium, real DB)     Test Files  1 passed (1)    Tests   10 passed (10)

RESULT: PASS
```

- 서버 유닛 **238 → 239** (증가분이 이번에 추가한 N1 테스트 1개).
- 증거는 **코드가 포함된 커밋 `6bf716ca2`에서 재생성**했다 (M2가 지적한 순서 위반을 반복하지 않기 위해).
- `tsc --noEmit`, `eslint src/config.spec.ts --max-warnings 0` 각각 exit 0.

## 무엇을 바꿨나

### 1. `7ab1baebb` — N1: googleDrive 필드로 직접 단언하는 테스트 추가

`server/src/config.spec.ts`에 `updateConfig with credentials from the environment` describe 추가.
env를 stub → `config.js`와 `system-config.service.js`를 재import → `clientId`를 비우고 저장 →
`set(SystemMetadataKey.SystemConfig, {})` 단언. 기존 `oauth.buttonText` 테스트는 **유지**했다
(일반 규칙 vs googleDrive 인스턴스를 각각 고정).

**비공허 확인 방법과 결과**: `server/src/utils/config.ts:50`의
`const isEmpty = [undefined, null, ''].includes(newValue);`에서 `''`를 제거하고 이 파일을 돌리면
**이 테스트만** 실패한다 —
`AssertionError: expected "spy" to be called with arguments: [ 'system-config', {} ]` —
나머지 3개는 통과. 확인 후 원본으로 복구했고 `git diff`에 남지 않았다.

### 2. `51d32bd52` — 리뷰 판정을 `wave6-plan.md` §7에 되먹임

M1 확정(+ `enabled: false`가 이미 탈출구라는 더 강한 근거, 리뷰어가 왕복 검증), N1 반영 내용,
드리프트 위험, 그리고 프로세스 지적(아래 3)의 해소를 기록.

### 3. `e2c0a1cff` — `CLAUDE.md` 복원

직전 리뷰가 지적한 대로 워킹트리의 `CLAUDE.md`가 범용 오케스트레이터 템플릿으로 통째 교체돼
§1(절대 규칙)·§2(리뷰 사이클)·§3(검증 절차)·§4(지뢰)가 사라져 있었다. 템플릿 섹션은 유지하고
HEAD의 §1~§9를 **`## Current Project` 아래로 그대로** 되살렸다(헤딩만 한 단계 강등, 내용 무손실).
`기술 스택` 절만 Python/uv 서술을 이 저장소의 실제 스택(pnpm 모노레포 + mise)으로 교체했다.

### 4. `6bf716ca2` — 포크 전용 CI 워크플로 추가

`.github/workflows/fork-google-drive.yml`. `feature`(run.sh) / `regression`(`//server:ci-unit`,
`//web:ci-unit`) / `medium`(`//server:ci-medium`) 3잡, push 트리거는 `feat/**`·`feature/**`만.

## 공격해 주셨으면 하는 것

1. **N1 테스트의 재import 구조.** `vi.resetModules()` 후 `system-config.service.js`를 동적 import
   하고, `test/utils`의 `newTestService`(정적 import)로 인스턴스를 만든다. 즉 **서비스는 새 모듈
   그래프, mock은 옛 모듈 그래프**에서 온다. 지금은 통과하지만 이 혼합이 나중에 조용히 깨질 수
   있는 형태인지, 특히 `SystemMetadataKey` 같은 enum이 두 그래프에 각각 존재해도 문자열 값 비교라
   문제없다는 내 전제가 맞는지 봐 주십시오.
2. **테스트를 `config.spec.ts`에 둔 판단.** 이 파일의 헤더 주석은 원래 "updateConfig의 성질은
   system-config.service.spec.ts에 있다"였고, 이번에 예외를 명시했다. 파일 책임을 흐린 것인지,
   아니면 "env가 비어있지 않은 defaults를 만들 수 있는 유일한 파일"이라는 이유가 충분한지.
3. **CI 워크플로의 전제들** — 특히 ① `feature` 잡의 설치 단계(sdk install/build → server install →
   web install → `svelte-kit sync`)가 `run.sh`를 돌리기에 충분한지, ② `regression`을
   `continue-on-error: true`로 시작한 판단, ③ push 트리거를 `feat/**`로 한정하면 업스트림
   워크플로가 깨어나지 않는다는 주장(업스트림 워크플로의 `push:`가 전부 `branches: [main]`이라는
   근거로 폈습니다).
4. **`CLAUDE.md` 병합 결과.** 템플릿 섹션과 포크 규칙이 서로 모순되는 지점이 있는지
   (예: 템플릿의 "출력 큰 작업은 서브에이전트" 규칙 vs §2의 리뷰 절차).

## 검증한 것 / 못 한 것

**검증함**
- 기능 스위트 239/29/10 PASS, 커밋 `6bf716ca2`에서 생성한 증거 파일 첨부.
- N1 테스트의 비공허성 (isEmpty 무력화 → 이 테스트만 실패).
- `tsc --noEmit` 전체 통과, 변경 파일 eslint 경고 0.
- 워크플로 YAML 파싱 + `prettier --check` 통과.
- 업스트림 워크플로가 포크에서 못 도는 이유를 파일에서 직접 확인
  (`create-workflow-token` + `PUSH_O_MATIC_*`, 모든 테스트 잡이 `needs: pre-job`, `web-lint`는
  self-hosted 러너 `mich`).
- medium 테스트가 `services: postgres` 없이 도는 이유 확인
  (`server/test/medium/globalSetup.ts`가 testcontainers로 직접 기동).

**검증 못 함**
- **CI가 실제로 도는지.** 포크(`GunwooYun/immich`)에서 GitHub Actions가 켜져 있는지 확인하지
  못했고, 워크플로를 한 번도 실행해 보지 않았다. `jdx/mise-action@v3`이 업스트림 org 액션의
  대체로 동작하는지도 미확인 (SHA 핀 대신 태그를 쓴 이유는 확인 없이 SHA를 지어내지 않기 위해).
- `mise //web:ci-unit`이 이 포크에서 현재 초록인지 (그래서 `continue-on-error`로 시작).
- 브라우저 실동작·Tailscale 경로·실제 구글 연결 플로우 — 배포 이후로 미룸(직전 리뷰와 동일).

## 리뷰어에게

- 생성물(`packages/sdk/`, `mobile/openapi/`, `open-api/`, `server/src/queries/`)은 이번 변경에
  포함되지 않았습니다 — 읽지 마십시오.
- 코드 변경은 **테스트 파일 1개뿐**입니다. 나머지는 문서와 CI 설정입니다.
