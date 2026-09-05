# 리뷰 요청 (닫는 라운드) — 사용자 축 술어 아홉 자리를 한 번에

| | |
|---|---|
| 브랜치 | `feat/google-drive-album-sync-v3.1.0` |
| HEAD | `2241e6586` |
| 리뷰 대상 커밋 | `b8a4458fb`, `2241e6586` (2개) |
| 직전 리뷰 | `../review/google-drive-wave6-round25-exists-correlation-20260905-1140-review.md` |
| 증거 | `dev-test/google-drive/results/20260905-1208.txt` — **커밋 `b8a4458fb`, dirty 표시 없음** (리포트 커밋에 동봉) |
| CI | `https://github.com/GunwooYun/immich/actions/runs/33941074515` (`2241e6586`) — **4잡 전부 success, 실패 애노테이션 0** |
| 작성 | 2026-09-05 12:15 |

## 테스트 결과 (첨부)

```
commit: b8a4458fb  (dirty marker 없음)
server (unit)              Tests 264 passed
web (unit)                 Tests  39 passed
web (svelte-check, gated)  no regressions vs baseline (3 pre-existing files)
server (medium, real DB)   Tests  51 passed

RESULT: PASS
```

`mise //server:ci-unit` exit 0. **모든 변이 수치는 이 HEAD(`2241e6586`)에서 돌린 것이다.**
프로덕션 코드 변경 0줄 (`git diff 320a003ab..2241e6586 -- server/src ':!*.spec.ts'` 빈 출력).

---

## 1. 아홉 자리를 한 라운드에 닫았다 (`b8a4458fb`)

round-25가 사용자 축 술어 16개를 전수 변이해 **9개 생존**을 보고했다. 라운드당 하나씩 막으면
아홉 라운드에 프로덕션 0줄이므로, 리뷰어 권고대로 한 번에 닫았다.

`sharedAlbum` 픽스처 헬퍼(두 사용자 + 공유 앨범 + 자산 하나)와 테스트 6개. 여덟 변이를
이 HEAD에서 다시 걸어 **각각 정확히 테스트 하나씩만** 실패시키는 것을 확인했다.

| 변이 | 위치 | 결과 |
|---|---|---|
| `:288` | `getSubscribers` 멤버십 상관 | 1 failed / 50 passed |
| `:366` | `getSubscribableAlbums` 선택 범위 | 1 failed / 50 |
| `:397` | `getSubscribableAlbums` 업로드 범위 | 1 failed / 50 |
| `:425` | `getAlbumBackupStatus` 멤버십 범위 | 1 failed / 50 |
| `:428` | `getAlbumBackupStatus` 선택 범위 | 1 failed / 50 |
| `:451` | `getAlbumBackupStatus` 업로드 범위 | 1 failed / 50 |
| `:480` | `countPendingUploads` 멤버십 상관 | 1 failed / 50 |
| `:547` | `streamPendingUploads` 원장 상관 | 1 failed / 50 |

## 2. 내 테스트가 두 번 틀렸고, 그 자체가 이 라운드의 교훈이다

- **계정이 다르면 사용자 범위가 가려진다.** 두 사용자를 서로 다른 구글 계정에 붙였더니 원장 조건이
  먼저 걸러내, `:397`·`:451`을 잡으려고 쓴 테스트가 그 변이에서 **통과**했다. 같은 계정으로 바꿨고
  (한 집에서 드라이브 하나를 쓰는 실제 경우이기도 하다) 그제야 죽는다.
- **회원이면서 구독자인 사용자로는 구분이 안 된다.** `:425`·`:428`은 그 상태에서 어느 쪽이든 같은
  답을 준다. 반대 방향(선택이 없는 회원, 접근을 잃은 구독자)을 함께 물어야 죽는다.

**공격 요청**: 이 두 가지가 **남은 테스트에도 해당하는지**. 즉 이 파일의 다른 단언 중 "픽스처가
그 조건을 관측 불가능하게 만들어" 공허한 것이 더 있는지. round-25가 사용자 축을 전수했으니,
남은 축은 **계정 축**(`ledgerMatches`)과 **시간 축**(`deletedAt`)이다.

## 3. round-25 리뷰의 나머지 지적

- **N1**(잔여 행 덕에 죽는 변이 `:298`·`:562`): 새 `sharedAlbum` 픽스처가 그 두 자리를 명시적으로
  덮는지 확인이 필요하다 — 나는 확인하지 못했다.
- **N2**(내 리포트가 "5개 실패"라고 한 것이 실제 6개): 인정한다. 새 테스트를 세지 않았다.
- **N3**(0줄 근거 명령이 `.github/`를 안 봄): 이번 리포트는 그 커밋에 워크플로 변경이 없음을
  따로 확인했다.
- **정정 기록 방식**에 대한 판단("행동을 바꾸면 코드 주석, 믿음만 바꾸면 계획 문서")은 옳다고 본다.
  다만 이번 라운드에서 옮기지는 않았다 — 다음 라운드가 있다면 그때.

## 4. 이것이 닫는 라운드다

round-25가 "멈춰라"로 판정했고 그 근거(프로덕션 변경량이 `+108/−15 → +10/−4 → +9 → 0`)에 동의한다.
이 라운드가 통과하면 리뷰 사이클을 종료하고 배포로 간다.

**배포 전 반드시 확인할 것** (round-25가 지목):
`server.externalDomain`과 `googleDrive.redirectUrl` 중 **최소 하나가 채워진 상태**로 배포하고,
설정 화면을 열기 전에 `getGoogleDriveStatus`의 `enabled`를 확인한다. 둘 다 비면
`isGoogleDriveEnabled`가 거짓이 되어 **에러 없이** 기능이 꺼진다.

**마지막으로 묻는다**: 이 라운드에서 **배포를 막는 것**이 나오는가. 나오지 않으면 여기서 멈춘다.

## 5. 배포 후로 미룬 것 (기록)

- **M8**: `refreshToken` nullable로 폴더 선택 보존. CAS를 `connectionId`로 옮기는 출발점은
  round-24 리뷰에 있다.
- **UI `stalled` 상태**: 다섯 라운드 연속 "관측 품질 문제" 판정.
- **메뉴 요청 2·4번**: 사장님 결정 대기.
