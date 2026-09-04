# 리뷰 요청 — round-17 반영 (C1/H1/H2/M1/M4/M5/L2~L4), H3는 미결

| | |
|---|---|
| 브랜치 | `feat/google-drive-album-sync-v3.1.0` |
| HEAD | `98918dd85` |
| 리뷰 대상 커밋 | `98918dd85` (단일) |
| 직전 리뷰 | `../review/google-drive-adoption-fixes-20260904-0945-review.md` |
| 증거 | `dev-test/google-drive/results/20260904-1126.txt` |
| 작성 | 2026-09-04 11:26 |

## 테스트 결과 (첨부)

```
commit: 98918dd85
server (unit)              Tests 249 passed
web (unit)                 Tests  39 passed
web (svelte-check, gated)  no regressions vs baseline
server (medium, real DB)   Tests  20 passed

RESULT: PASS
```

## 0. 먼저 — 직전 리뷰의 C2는 사실이었고, 내 보고가 틀렸다

`continue-on-error`가 붙어 있는 동안 REST의 `conclusion`은 실패해도 `success`다. 나는 그 필드만
보고 "3잡 전부 성공"이라고 두 번 보고했고, **"초록 2회"를 근거로 차단 승격까지 했다.** 애노테이션을
확인하니 두 실행 모두 medium이 빨간불이었다:

```
run 33715025550 / 33758496224
  Medium → conclusion: success
  ANNOTATION(warning) the medium suite failed; it is non-blocking for now
  ANNOTATION(failure) Process completed with exit code 1
```

**내가 직접 워크플로에 써넣은 경고 문구가 거기 있었는데 엉뚱한 필드를 조회해서 못 봤다.** 승격
근거는 틀렸지만 승격 자체는 옳았고(차단으로 바뀌자 실패가 드러났다), 현재 `fe9fe4fed` 실행은
`continue-on-error` 제거 상태에서 **실패 애노테이션 0건**으로 진짜 초록이다. 앞으로 CI 판정은
애노테이션까지 확인한다.

## 1. C1 — 배포 게이트 명령이 실행되지 않았다

`psql -c '…'` 안에 SQL의 작은따옴표를 중첩하려다 셸에서 문자열이 끊겼다. heredoc으로 바꾸고
**운영 DB에 실제로 실행**해 확인했다(지금은 "그 컬럼이 없다"고 정확히 답한다 — 랩탑은 Wave 5).

## 2. H1 — 영구 오귀속 경로

`setDriveAccountId`가 사용자만 보고 갱신해 프로브 중 재링크가 끼면 **A의 id + B의 토큰**이 될 수
있었다. 토큰까지 조건에 넣고 갱신 여부를 반환해, 갱신되지 않으면 입양을 중단한다. 테스트 추가.

## 3. H2 — 프로브 무제한

`getStatus`는 앨범 Drive 메뉴를 열 때마다도 호출된다. 사용자별 1분 쿨다운을 붙였다. 업로드
경로는 **의도적으로 제외**했다 — 목적지를 못 대는 업로드는 `''`로 기록되므로 왕복 한 번이 싸다.

## 4. M1 — 내가 논점을 잘못 잡았다

지난 라운드에 "생성 SQL이 틀렸다"를 **비결정성 미재현**을 이유로 넘겼는데, 지적의 본질은 **내용이
틀렸다**였다. 실제로 Drive 쿼리가 `IntegrityRepository.getById` 헤더 아래 있었다. 원인도 리뷰어
말대로 `getErrorSummary`의 `Promise.all`이 생성기 로그 콜백과 경합하는 것이었고, **순차로 바꾸니
오염된 14줄이 사라졌다.**

## 5. 나머지

M5(하네스에 `GoogleDriveRepository` 추가 — 기능이 꺼져 있어야만 통과하는 상태 제거),
M4(스펙 주석의 뒤집힌 인과), L2(죽은 헬퍼 참조), L3(테이블 주석이 옛 리셋 설계), L4(경고에
`userId` — 런북이 grep하라고 지시하는 문자열이다).

## 6. H3 — **미결, 판단을 구한다**

직전 리뷰의 H3: `getStatus` 훅 때문에 C3의 위험 창이 "링크 직후 다음 렌더"로 앞당겨졌다.
리뷰어가 sentinel보다 나은 대안을 제시했다 — **"컬럼 도입 이후 만들어진 연결"인지로 입양을
게이팅**하면 전량 중복 위험 없이 되돌릴 수 없는 오도장만 제거된다.

이번 커밋에는 **넣지 않았다.** 또 한 번의 설계 변경이고, 판정 기준(무엇으로 "이후"를 판단할지)이
아직 명확하지 않다. `connectedAt`은 쓸 수 없다 — `upsertCredentials`의 `doUpdateSet`이 갱신하지
않으므로 재링크를 구별하지 못한다. **이 라운드에서 방향을 정해 주기 바란다.**

## 공격해 주셨으면 하는 것

1. **H2 쿨다운의 부작용.** 인메모리라 재시작·다중 레플리카에서 초기화된다. 그게 문제가 되는
   시나리오가 있는지, 그리고 업로드 경로를 제외한 판단이 맞는지.
2. **H1 가드의 완전성.** 토큰 일치 + id가 null인 조건으로 충분한지. 같은 토큰으로 재링크되는
   경우(구글이 같은 refresh token을 재발급)에 어떻게 되는지.
3. **M1 수정의 대가.** `getErrorSummary`가 이제 순차다. 설정 화면 읽기에서 왕복이 하나 늘었는데,
   이 경로가 폴링되는 곳이 있는지(진행률 매니저와 겹치는지) 봐 주기 바란다.
4. **H3의 판정 기준.** "컬럼 도입 이후 연결"을 무엇으로 판단해야 하는지. 새 컬럼 없이 가능한지.

## 검증한 것 / 못 한 것

**검증함**: 249/39/20 PASS, C1 명령을 운영 DB에 실행, M1을 재생성으로 확인(14줄 제거),
H1 가드 테스트(연결 변경 시 입양 중단), `tsc`·prettier·svelte-check 클린,
CI 애노테이션까지 확인(`fe9fe4fed` 실패 0건).

**검증 못 함**: 이 커밋은 아직 CI를 거치지 않았다. 운영 배포·브라우저 확인도 여전히 미완이다.

## 리뷰어에게

- **격리 워크트리에서 실험할 것.**
- 로컬 medium은 exif 3개가 실패한다 — `e2e/test-assets` 서브모듈 미초기화(환경).
