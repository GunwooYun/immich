# 리뷰 요청 — B1(계정 변경 시 원장 리셋) + 메뉴 앵커 수정

| | |
|---|---|
| 브랜치 | `feat/google-drive-album-sync-v3.1.0` |
| HEAD | `ba73b1b14` |
| 리뷰 대상 커밋 | `6bfd4708a`(메뉴 앵커), `ba73b1b14`(B1) |
| 직전 리뷰 | `../review/google-drive-menu-position-20260903-1351-review.md` |
| 증거 | `dev-test/google-drive/results/20260903-2206.txt` |
| 작성 | 2026-09-04 09:00 |

## 테스트 결과 (첨부)

```
date:   2026-09-03T22:06:39+09:00
commit: ba73b1b14

server (unit)              Tests 243 passed   ← 239 + B1 테스트 4
web (unit)                 Tests  36 passed
web (svelte-check, gated)  no regressions vs baseline
server (medium, real DB)   Tests  10 passed

RESULT: PASS
```

CI도 `6bfd4708a`에서 세 잡 모두 성공했다
(`https://github.com/GunwooYun/immich/actions/runs/33758496224`). `ba73b1b14`는 아직 push 전이다.

## 1. `6bfd4708a` — 메뉴 앵커 (직전 리뷰 C1/N1)

직전 리뷰가 두 가지를 지적했고 **둘 다 사실이었다**:

- **툴바 겹침은 내 수정으로 해결되지 않았고, 설명도 거꾸로였다.** `top = max(margin, min(H-height, y))`는
  height에 단조 비증가라, 높이를 더 정확히 알수록 메뉴는 **위로** 간다. 내 테스트가 이미 그걸
  보여주고 있었다(`shortBox.top===700`, `grown.top===400`). 진짜 원인은 앵커다 —
  `align='top-left'`이면 앵커가 버튼 **윗변**(`utils/context-menu.ts:25-27`)이고, 거기에 offset
  25px를 더해도 툴바 안쪽이다. → `align="bottom-left"` + offset 8px로 수정.
- **N1**: 손으로 만든 `ResizeObserver`를 Svelte의 `bind:offsetWidth`/`bind:clientHeight`로 교체.
  Svelte는 이를 앱 전역 단일 `ResizeObserverSingleton`으로 처리하므로 메뉴마다 옵저버 하나가
  아니라 앱 전체에 하나다.

**직전 리뷰 C2를 인정한다**: 순수 함수 테스트 7개는 이 버그의 회귀 가드가 **아니다**.
`ContextMenu.svelte`를 수정 이전으로 되돌려도 36개가 전부 통과하는 것을 직접 확인했다. 이 커밋도
회귀 테스트를 추가하지 못했다 — 제자리는 Playwright이고 아직 쓰지 않았다. **오른쪽 잘림과 겹침이
실제로 해결됐는지는 브라우저 확인이 유일한 검증이며, 아직 받지 못했다.**

## 2. `ba73b1b14` — B1: 계정이 바뀌면 원장을 리셋

**문제**: 원장은 `(userId, assetId)` 축이고 *어느* Drive로 갔는지 모른다. 저장된 토큰이 어느 계정
것인지도 기록하지 않았다(`upsertCredentials`가 토큰만 교체). 그래서 다른 구글 계정으로 갈아타면
모든 자산이 "이미 업로드됨"으로 읽혀 **새 Drive는 영원히 비어 있는데 UI는 완료라고 표시**한다.

**수정**: `user_google_drive.driveAccountId`(Drive `permissionId`)를 링크 시점에 기록하고 비교한다.
다르면 그 사용자의 원장을 지운다. **Drive의 파일은 건드리지 않는다** — 옛 계정에 올라간 것은 그대로
두고, 이 서버가 "보냈다고 믿는 기록"만 리셋한다.

**리셋하지 않는 두 경우**(의도적):
- 이전 id가 `null` = "모름"이지 "다름"이 아니다. 컬럼 이전 행은 계정을 알 수 없고, 추측으로 원장을
  비우면 라이브러리 전체가 재업로드된다.
- Drive가 계정을 알려주지 않으면 링크는 성공시킨다. 신원 확인 실패로 멀쩡한 연결을 에러로 만드는 건
  더 나쁜 거래다.

**B2도 함께 해결**: 리셋 시 `Revoked`만이 아니라 **모든 실패 클래스**를 지운다. 할당량·폴더 없음
행은 더 이상 연결돼 있지 않은 계정 것이고, 남겨두면 새 계정이 워커 입구에서 계속 차단된다.

**비공허 확인 — 이번엔 올바른 대상으로**: `linkAccount`를 수정 이전으로 되돌리면 **새 테스트 4개만**
실패하고 나머지 58개는 통과한다. (직전 커밋에서 고장난 적 없는 clamp를 무력화해놓고 "비공허"라고
쓴 실수를 반복하지 않기 위해, 이제는 *수정 자체*를 되돌린다.)

링크 플로우에는 **테스트가 하나도 없었다** — 모킹된 OAuth 클라이언트에 `getToken`을 추가해야 했다.

## 공격해 주셨으면 하는 것

1. **`permissionId`가 계정 식별자로 적절한가.** 같은 사용자가 다른 Drive를 쓰거나, 조직 계정에서
   값이 바뀌는 경우가 있는지. `about.get`의 `user(permissionId)`가 `drive.file` 스코프에서 항상
   채워지는지(비어 오면 null로 떨어지고 리셋이 영영 안 일어난다).
2. **리셋 범위.** 원장만 지우고 `google_drive_album`(앨범 선택)과 `folderId`는 남긴다. 계정이 바뀌면
   **폴더 id도 무의미**해지는데(옛 계정의 폴더), 지금은 그대로 둔다. 이게 맞는 판단인지.
3. **경쟁 조건.** 링크 도중 업로드 잡이 돌고 있으면 원장 삭제와 `recordUpload`가 겹칠 수 있다.
   현재는 트랜잭션으로 묶지 않았다.
4. **마이그레이션.** 새 컬럼은 nullable이고 기존 행은 null이다. 다운 마이그레이션이 컬럼을 지우는데,
   되돌린 뒤 다시 올리면 모든 계정 정보가 사라지고 "모름" 상태가 된다 — 허용 가능한지.
5. **메뉴 앵커가 정말 두 증상을 다 잡는지.** 나는 브라우저에서 확인하지 못했다.

## 검증한 것 / 못 한 것

**검증함**: 243/36/10 PASS(`ba73b1b14`), 비공허(수정 되돌리기 → 4개만 실패), `tsc` 클린,
prettier 클린, svelte-check 게이트 클린, `mise //:sql` 재생성(6줄, 새 쿼리 1개),
마이그레이션이 medium 테스트의 신선한 DB에서 적용됨(그 스펙이 `driveAccountId`를 select한다).

**검증 못 함**: 메뉴의 실제 렌더 위치(브라우저), `ba73b1b14`의 CI(아직 push 전),
운영 DB에서의 마이그레이션 적용(§4의 "corrupted migrations" 상태라 드리프트 검사는 배포 시에).

## 리뷰어에게

- 생성물(`server/src/queries/*.sql`)이 이번엔 **포함**돼 있다 — 새 `@GenerateSql` 메서드 하나 때문이며,
  손으로 쓴 것이 아니라 재생성된 것이다. 읽지 않아도 된다.
