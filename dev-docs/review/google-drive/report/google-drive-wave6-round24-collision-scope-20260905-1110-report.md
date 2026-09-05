# 리뷰 요청 — 충돌 검사의 범위(M1) · 빈 계정 가드(M2) · 마이그레이션 검사 3판

| | |
|---|---|
| 브랜치 | `feat/google-drive-album-sync-v3.1.0` |
| HEAD | `e438d0462` |
| 리뷰 대상 커밋 | `bec13f903`, `e438d0462` (2개) |
| 직전 리뷰 | `../review/google-drive-wave6-round23-adoption-delete-20260905-1035-review.md` |
| 증거 | `dev-test/google-drive/results/20260905-1100.txt` — **커밋 `bec13f903`, dirty 표시 없음** (리포트 커밋에 동봉) |
| CI | `https://github.com/GunwooYun/immich/actions/runs/33937864777` (`e438d0462`) — **4잡 전부 success, 실패 애노테이션 0** |
| 작성 | 2026-09-05 11:10 |

## 테스트 결과 (첨부)

```
commit: bec13f903  (dirty marker 없음)
server (unit)              Tests 264 passed
web (unit)                 Tests  39 passed
web (svelte-check, gated)  no regressions vs baseline (3 pre-existing files)
server (medium, real DB)   Tests  44 passed

RESULT: PASS
```

`mise //server:ci-unit` exit 0.

**변이 결과를 인용할 때의 규칙 하나 (round-23 N3)**: 아래 표의 통과/실패 수는 **전부 이 리포트의
HEAD(`e438d0462`)에서** 돌린 것이다. 지난 리포트는 부모 커밋에서 돌린 수를 HEAD의 수인 것처럼
적었다 — 테스트가 늘어나는 브랜치에서 그 차이는 조용히 사람을 속인다.

---

## 1. M1 — 충돌 검사가 "어느 계정 아래에서 충돌하는가"를 잃으면 (`bec13f903`)

`repository.ts:205`의 `.where('stamped.driveAccountId', '=', driveAccountId)`를 `'!=', ''`로
**넓히면** 41/41(당시)이 통과했다. 넓힌 상태에서는 **제3의 계정으로 갔던 자산의 `''` 행이 삭제**되고,
그 자산은 원장 매칭을 잃어 다시 올라간다.

픽스처에 "account-c로만 도장된 자산"을 넣었다. 지금 그 변이는 그 테스트 하나만 실패시킨다(43/1).

**공격 요청**: 이 픽스처도 결국 **한 모양**이다. 계정이 넷 이상 얽히거나, 같은 자산이 두 계정에
도장돼 있고 그중 하나가 입양 대상인 경우처럼, 통과하면서도 잘못 지우는 조합이 남았는지.

## 2. M2 — 빈 계정 id는 무해하지 않고 자기파괴적이다 (`bec13f903`)

`adoptUnstampedUploads(userId, token, '')`이면 충돌 검사의 `stamped.driveAccountId = ''`가
**입양 대상 행 자신과 매칭**해 그 연결의 미상 행을 전부 삭제한다. 리뷰어가 psql로 재현했다.

호출자 4곳이 전부 앞에서 막고 있어 현재 도달 불가다. 그래도 입구에 `if (!driveAccountId) return false;`를
넣었다 — "모든 호출자가 확인한다"는 조용히 거짓이 되는 종류의 보장이기 때문이다.

**공격 요청**: 이 early return이 **막아서는 안 되는 것을 막는지**. 특히 `''`가 정당한 입력인
경로가 어딘가 있는지(드레인, 재연결 직전 경로).

## 3. N1 — DELETE의 `userId` 필터 (`bec13f903`)

지워도 통과했다. connectionId가 연결마다 uuid이므로 두 사용자가 같은 값을 갖는 상태는 애플리케이션이
만들지 않는다 — 테스트 주석에 **그 사실을 명시**하고, 그럼에도 두는 이유(막는 실패가 남의 원장 행
삭제라는 되돌릴 수 없는 종류)를 적었다.

**공격 요청**: 합성 상태를 고정하는 테스트가 오히려 다음 사람을 오도하는지. 주석으로 충분한지,
아니면 테스트를 빼고 코드 주석만 남기는 편이 나은지 판단을 구한다.

## 4. 마이그레이션 검사 3판 — 이름 집합 비교 (`bec13f903`)

앞의 두 판이 모두 약했다.

| 판 | 방식 | 왜 약했나 |
|---|---|---|
| 1 | `select 1 from google_drive_upload` | 그 테이블은 이 기능의 첫 마이그레이션부터 존재 → 여러 개 뒤처진 DB도 통과 |
| 2 | 파일 수 = `count(*)` | 업스트림이 마이그레이션을 삭제(`0975b1599`)·이름 변경한 이력이 있어 **오래 산 DB는 맞는데도 실패** |
| 3 | 이름 집합 `diff` | 어느 마이그레이션이 빠졌는지까지 말한다 |

실 DB로 양방향 확인: 갓 마이그레이션한 DB에서 **98/98 일치**, `kysely_migrations`에서 한 행을 지우면
그 이름을 출력하며 실패.

**공격 요청**: 이름 비교가 틀리는 경우. `migration_overrides`가 개입하거나, 업스트림이 파일명을
바꾸면서 DB의 옛 이름을 남겨두는 마이그레이션을 쓰는 경우가 실제로 있는지.

## 5. 미해결 — 판단을 구한다

- **M8**(`refreshToken` nullable로 폴더 선택 보존): round-23이 **배포 뒤**로 판정했다 — 입양의 CAS가
  `where refreshToken = ?` + `FOR UPDATE`에 걸려 있어 지금 바꾸면 방금 산 보증을 잃는다. 동의하는지,
  그리고 배포 후 Wave로 잡을 때 CAS를 무엇으로 대체할지.
- **UI `stalled` 상태**: 세 라운드 연속 "관측 품질 문제" 판정. 유지하는가.
- **메뉴 요청 2·4번**: 사장님 결정 대기.
- **배포**: 이번 두 커밋이 판정을 바꾸는가.
