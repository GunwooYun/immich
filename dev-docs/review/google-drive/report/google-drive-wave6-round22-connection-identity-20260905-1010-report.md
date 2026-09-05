# 리뷰 요청 — 연결 신원으로 바꾼 입양(H1) · round-21 지적 반영 · P1 코너케이스

| | |
|---|---|
| 브랜치 | `feat/google-drive-album-sync-v3.1.0` |
| HEAD | `af1639dbf` |
| 리뷰 대상 커밋 | `c9c6df02c`, `b5c5cfa23`, `68ff15a62`, `0c47d192e`, `af1639dbf` (5개) |
| 직전 리뷰 | `../review/google-drive-wave6-round21-sql-tests-20260905-0900-review.md` |
| 증거 | `dev-test/google-drive/results/20260905-0942.txt` (**리포트 커밋에 동봉** — round-21 N4) |
| CI | `https://github.com/GunwooYun/immich/actions/runs/33934074083` (`0c47d192e`) — **4잡 전부 success, 실패 애노테이션 0**. 경고는 `jdx/mise-action@v3`의 Node 20 종료 안내 하나뿐(업스트림 액션) |
| 작성 | 2026-09-05 10:10 |

## 테스트 결과 (첨부)

```
commit: 0c47d192e
server (unit)              Tests 262 passed
web (unit)                 Tests  39 passed
web (svelte-check, gated)  no regressions vs baseline (3 pre-existing files)
server (medium, real DB)   Tests  39 passed

RESULT: PASS
```

추가: `mise //server:ci-unit` exit 0, `mise //web:ci-unit` exit 0,
`sql-tools migrations generate` → **No changes detected**.

---

## 1. H1 — 시간 경계를 연결 신원으로 교체 (`0c47d192e`)

리뷰가 재현한 시나리오를 그대로 받았다. `uploadedAt >= connectedAt`은 두 방향을 주장하는데
**"connectedAt보다 새 행은 이 연결이 썼다"가 거짓**이고, 그 반례가 gate 1(목적지 결정)과
`recordUpload`(전송 완료) 사이의 간격이다.

`user_google_drive.connectionId`(링크·재링크마다 발급)를 원장 행에 남기고 입양을 **같은 값 비교**로
바꿨다. 마이그레이션 `1787200000000-AddGoogleDriveConnectionId` 1개.

- `uploadAsset`은 **gate 1에서 읽은** `credentials.connectionId`를 넘긴다. 일부러 낡은 값이다 —
  이 업로드를 승인한 연결이 그것이므로.
- 컬럼 도입 전 행은 null → `null = uuid`는 참이 아니므로 **영원히 입양되지 않는다**. 운영 6,996행이
  여기 해당하고, `''` 매칭 안전망은 그대로라 재업로드는 나지 않는다.

**리뷰어의 제안 중 채택하지 않은 것**: "연결이 바뀌었으면 원장을 안 쓴다"(옵션 A). 그건 덜한 손해
(새 계정에 파일이 없다 — 이미 설계가 받아들인 거래)를 고치고 **더 큰 손해**(옛 계정의 사본이 고아가
되어 재연결 시 중복)를 남긴다고 판단했다.

**공격 요청**:
- `connectionId`가 **재링크에서 재발급되지 않는 경로**가 남아 있는지. `upsertCredentials`의
  `onConflict` 말고 연결을 바꾸는 다른 문법이 있는가(`setDriveAccountId`, 드레인, 마이그레이션).
- 입양이 **claim해야 하는데 못 하는** 경우 — 특히 `recordUpload`가 넘기는 값과 잠금 안에서 읽는
  값이 어긋나는 조합.
- `connectionId`를 FK로 걸지 않은 것(연결 해제 시 행이 사라져도 원장은 남아야 한다) — 이 선택이
  만드는 문제가 있는지.

## 2. round-21 지적 반영 (`b5c5cfa23`, `68ff15a62`)

| 지적 | 반영 | 확인 방법 |
|---|---|---|
| M1 picker 취소 처리 무테스트 | 테스트 2개(취소는 지운다 / `socket hang up`은 안 지운다) | 리뷰어의 `if (true)` 변이가 두 번째를 실패시킴 |
| M2 `firstOfClass` 변이 표가 과장 | **리포트 오류 인정.** 연언 **제거** 변이는 통과했다. 단일 사용자·단일 자산 재시도 테스트 추가 | 제거 변이 → 그 테스트만 실패 |
| M3 `getErrorSummary` 술어 3개 공허 | 다른 계정 원장 행 / 다른 사용자 원장 행 / 휴지통 자산 3개 추가 | 834·837행을 **줄 번호로** 지워 각각 실패 확인 |
| M4 `recordUpload` 삭제 범위 | 두 번째 사용자 에러 행이 살아남는지 단언 | 필터 제거 → 실패 |
| M5 재링크 `connectedAt` 이동 | H1로 의미가 바뀌어 **"재링크가 새 신원을 발급한다"**로 대체 | 재발급 제거 → 실패 |
| M6 준비 대기가 임시 서버를 읽음 | `pg_isready -h 127.0.0.1` (다음 스텝과 같은 전송로) | — |
| M7 `git diff`가 untracked를 못 봄 | `git status --porcelain` + 마이그레이션 적용 확인 스텝 | — |
| M8 취소 처리가 폴더 선택도 지움 | 코드 수정 없음. 런북에 재연결 의식으로 명시 | — |
| N1 프로브 잔여 구간 | OAuth 갱신 다리가 **재시도까지 된다**는 사실로 주석 정정 | — |
| N2 `others` 필터가 잔여 행에 의존 | 두 번째 사용자를 픽스처에 명시 | 그 테스트만 단독 실행해도 실패 |
| N3 CLAUDE.md 드레인 범위 | 경계와 같은 범위로 한정 | — |
| N4 증거가 대상 커밋에 없음 | 이 표에 "리포트 커밋에 동봉" 명시 | — |

**공격 요청**: 이 표의 "확인 방법"은 전부 제가 돌린 변이입니다. **통과하면서도 틀릴 수 있는
조합이 아직 남았는지** 봐 주세요. 특히 M3의 세 술어는 각각 하나의 픽스처로만 고정돼 있습니다.

## 3. P1 코너케이스 (`c9c6df02c`)

사장님이 예로 드신 두 가지.

- **백업 중 연결 끊김**: 바닥 `Error` → `Unknown` 오류 행, **원장 미기록**, 알림 미발송,
  그리고 **스트림 destroy**(무테스트였던 부분 — fd 누수 방어).
- **수동 백업 중 자동 토글 ON**: `subscribe()`가 큐잉보다 **먼저** 끝나는 순서를
  `invocationCallOrder`로 단언. 뒤집히면 gate 3와 경쟁해 앨범이 조용히 아무것도 안 올린다.

## 4. 계획 문서 되먹임 (`af1639dbf`)

`feature-roadmap.md` §9에 **왜 두 번 틀렸는가**를 반례 5줄과 함께 남겼다. 리뷰어가 권고한
프로세스 3건(변이 방향 기록, 픽스처 기본형에 두 번째 사용자, CI 계약 두 줄)도 같이 넣었다.

## 5. 미해결로 남긴 것 — 판단을 구한다

- **UI `stalled` 상태**: 구현 없음. round-21은 "관측 품질 문제이지 데이터 안전 문제가 아니다"로
  판정했다. 동의하는지.
- **M8의 근본 해법**(`refreshToken` nullable 마이그레이션): 백로그. 지금 해야 하는지.
- **메뉴 요청 2·4번**(사진별 Drive 배지, 메뉴 개선): 사장님 결정 대기.
- **배포**: round-21은 가능하다고 판정했다. H1이 코드로 닫힌 지금 그 판정이 유지되는지,
  아니면 신원 컬럼이 새로 만든 위험이 있는지.
