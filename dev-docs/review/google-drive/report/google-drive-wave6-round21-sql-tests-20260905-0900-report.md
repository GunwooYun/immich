# 리뷰 요청 — 입양 경계(C1/M4/N1) · 프로브 상한 · 읽기 경로 취소 처리 · 손으로 쓴 SQL의 실 DB 테스트 · SQL 드리프트 잡

| | |
|---|---|
| 브랜치 | `feat/google-drive-album-sync-v3.1.0` |
| HEAD | `b1110eafe` |
| 리뷰 대상 커밋 | `d37cdb70c`, `afd3af62d`, `933e05df5`, `834be27ba`, `b1110eafe` (5개) |
| 직전 리뷰 | `../review/google-drive-drain-20260904-1349-review.md` |
| 증거 | `dev-test/google-drive/results/20260905-0853.txt` |
| CI | 실행 중 — 결과와 애노테이션은 리뷰 시작 전 이 표에 채워 넣는다 |
| 작성 | 2026-09-05 09:00 |

## 테스트 결과 (첨부)

```
commit: b1110eafe
server (unit)              Tests 258 passed
web (unit)                 Tests  39 passed
web (svelte-check, gated)  no regressions vs baseline (3 pre-existing files)
server (medium, real DB)   Tests  30 passed

RESULT: PASS
```

추가로 `mise //server:ci-unit` 전체 스윕 2368 passed / 2 skipped (exit 0).

---

## 1. C1 — 입양을 "그 연결이 쓸 수 있었던 것"으로 제한 (`d37cdb70c`)

지난 라운드 가드는 문 하나만 닫았다. 미식별 상태로 업로드한 계정이 떠나고, 다음 연결이 — 역시
처음엔 미식별 — 프로브에 성공하는 순간 빈 버킷 전체를 자기 것으로 도장 찍는 경로가 남아 있었다.

이제 입양은 `uploadedAt >= connectedAt`으로 경계 지어지고, 재링크 시 `upsertCredentials`가
`connectedAt`을 옮긴다. 두 라운드 전에 내가 이 기준을 거절한 이유(운영 6,996행이 제외된다)는
그대로지만, 미상 행은 어떤 연결과도 매칭되므로 이제는 **재업로드가 아니라 정리 누락**이다.

**공격 요청**: 경계가 시간에 기대고 있다. 트랜잭션 시작 시각과 `now()`의 관계, `connectedAt`이
갱신되는 시점과 업로드가 커밋되는 시점 사이의 역전, 서버 시계 조정 — 이 중에 실제로 잘못된
귀속을 만드는 조합이 있는지 봐 달라.

## 2. M4 — 토큰 검사를 입양 트랜잭션 **안**에 (`d37cdb70c`)

리뷰의 답을 그대로 받았다. 입양 전에 자격증명을 다시 읽는 방식은 창을 좁힐 뿐이고, 앞선 두 번의
시도가 정확히 그 창에서 죽었다. 이제 트랜잭션이 자격증명 행을 `FOR UPDATE`로 잡고 토큰을 비교한다.

**공격 요청**: 이 잠금이 실제로 재링크를 배제하는가. `upsertCredentials`가 같은 행을 어떤 잠금으로
건드리는지, 데드락 가능성은 없는지.

## 3. N1 — `setDriveAccountId`의 select에서 토큰 조건 제거 (`d37cdb70c`)

안전은 위쪽 update가 지킨다. 필터가 있으면 이미 올바르게 정착된 동일 계정 재링크에 null을 답한다.

## 4. H1 — 프로브 상한이 상한이 아니었다 (`afd3af62d`)

googleapis가 무응답을 기본 2회 재시도하므로 실제 천장은 30초였다. 호출자 중 하나가 `disconnect`다.
`retry: false`를 함께 준다. 여전히 무한정인 것(요청 전에 도는 OAuth 토큰 갱신)은 주석에 적었다.

## 5. B3 — 취소된 권한을 읽기 경로에서도 지운다 (`933e05df5`)

업로드 경로만 자격증명을 지웠다. Testing 모드의 7일 시계로 권한이 만료된 사용자는, 업로드를 큐에
넣은 일이 없으면 계기판이 전부 에러를 뿜는 채로 "연결됨"을 무기한 보게 된다. 읽기 경로에서는
알림을 보내지 않는다(사용자는 곧 그 사실을 말해줄 페이지를 보고 있다), 드레인도 하지 않는다
(드레인에는 동작하는 토큰이 필요한데 이 분기는 그게 없다는 걸 아는 분기다).

**공격 요청**: 지우기가 너무 공격적인 경우 — 일시적 4xx/네트워크 오류를 취소로 오인해 멀쩡한
연결을 끊는 분류가 섞여 있지 않은지.

## 6. P0 #2 — 손으로 쓴 SQL 3종의 실 DB 테스트 (`834be27ba`)

설정 페이지의 실패 표시를 결정하는 문장 셋이 목으로만 닿아 있었다.

| 대상 | 테스트가 못박는 것 | 변이 확인 |
|---|---|---|
| `upsertError` CTE의 `firstOfClass` | 같은 클래스 다른 자산 → false, 다른 클래스 → 다시 true, 재시도 → `attempts` 증가 | `(select "c" from "others") = 0` → `true`, `old_row` 비교 → `false` 각각 해당 테스트만 실패 |
| `recordUpload`의 오류 행 삭제 | 테이블을 **직접** 조회해 행이 사라졌음 (요약은 원장 행만 있어도 0을 답하므로 아무것도 증명 못 함) | `deleteFrom` 제거 → 실패 |
| `getErrorSummary` 반정규 조인 | 원장 행이 있는 자산은 세지 않음 + 원장 행 없는 같은 픽스처는 1을 셈 | `.where('google_drive_upload.assetId','is',null)` 제거 → 실패 |

**공격 요청**: 이 표의 "변이 확인"은 내가 만든 변이에 한한 진술이다. 테스트가 통과하면서도 SQL이
틀릴 수 있는 조합(예: 다른 사용자의 행, 소프트 삭제된 자산, 계정이 다른 원장 행)이 남아 있는지.

## 7. SQL 드리프트 잡이 생성기까지 도달하지 못하고 있었다 (`b1110eafe`)

두 가지가 겹쳐 "Apply migrations"에서 죽었고, 정작 하려던 검사는 한 번도 실행되지 않았다.

- `services:` 컨테이너에는 커맨드를 줄 수 없다 → `shared_preload_libraries=vchord.so`가 빠져
  확장을 만들 수 없었다. medium 스위트의 `globalSetup.ts`와 같은 이미지·같은 플래그로
  `docker run` 한다.
- `mise //server:migrations`는 업스트림이 더 이상 빌드하지 않는 `dist/bin/migrations.js`를 가리킨다.
  실제 진입점은 `sql-tools`이므로 `pnpm --filter immich run migrations:run`을 부른다.

로컬에서 같은 이미지로 끝까지 확인: 마이그레이션 적용 → `mise //:sql` 426 queries →
`git diff -- server/src/queries` 비어 있음. **드리프트는 없다.**

**공격 요청**: 러너에서 5432 포트 충돌, 컨테이너 준비 대기 로직(60×2초)의 실패 모드,
그리고 이 잡이 여전히 "조용히 통과"할 수 있는 경로가 있는지.

## 8. 미해결로 남긴 것

- **UI `stalled` 상태**(B4의 정직한 부분) — 계획에만 있고 구현 없음.
- **P1 테스트** — 백업 중 연결 끊김의 결과(스트림 destroy 포함), `subscribe()`와 큐잉의 순서.
- **메뉴 요청 2·4번**(사진별 배지, 메뉴 개선) — 사장님 결정 대기.
- 리뷰어에게: 이 셋을 지금 하라는 게 아니라, **지금 병합해도 되는지**에 대한 판단을 구한다.
