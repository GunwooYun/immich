# 리뷰 요청 — round-16 지적 반영(C1/C2/C3/N1~N8) + CI가 처음 잡아낸 결함

| | |
|---|---|
| 브랜치 | `feat/google-drive-album-sync-v3.1.0` |
| HEAD | `fe9fe4fed` |
| 리뷰 대상 커밋 | `8f22e65df`, `7a2b68f9b`, `1d1ce48ab`, `fe9fe4fed` |
| 직전 리뷰 | `../review/google-drive-account-scoped-ledger-20260904-0728-review.md` |
| 증거 | `dev-test/google-drive/results/20260904-0924.txt` |
| CI | `https://github.com/GunwooYun/immich/actions/runs/33818957172` — **3잡 전부 success** |
| 작성 | 2026-09-04 09:24 |

## 테스트 결과 (첨부)

```
commit: fe9fe4fed
server (unit)              Tests 248 passed
web (unit)                 Tests  39 passed
web (svelte-check, gated)  no regressions vs baseline
server (medium, real DB)   Tests  20 passed

RESULT: PASS
```

**CI가 이제 실제로 돈다.** 그리고 이번 라운드에서 처음으로 **차단(blocking) 모드로** 돌았다:

| run | head | 결과 |
|---|---|---|
| 33818014039 | `7a2b68f9b` | **failure** — sweep(lint) + medium |
| 33818957172 | `fe9fe4fed` | **success** — 3잡 전부 |

첫 실패가 이 요청서의 절반이다(아래 3번).

## 1. `8f22e65df` — 직전 리뷰의 C1·C2·N1

셋 다 사실이었고 전부 내가 만든 것이다.

- **C1**: 입양을 유발한 업로드가 자기 자신을 `''`로 기록했다. 입양은 DB를 갱신했지만 호출자는
  직전에 읽은 `credentials` 객체를 들고 있었고 `recordUpload`가 거기서 계정을 가져갔다. 결과:
  그 자산이 다음 패스에서 재업로드(Drive 중복) + **배포 게이트가 영원히 0이 되지 않음.**
  입양이 해결한 id를 반환하고 호출자가 그것으로 기록한다.
- **C2**: 내가 쓴 배포 절차가 동작하지 않았다. "설정 화면을 열어 입양을 트리거하라"고 적었는데
  그 화면은 `getStatus`를 부르고 `getStorage`는 **import조차 하지 않는다**. 훅을 `getStatus`로 옮겼다.
- **N1**: 입양이 `upsertCredentials`를 재사용해 stale 토큰을 되썼다(동시 재링크와 lost update).
  계정 id만 채우는 좁은 setter로 분리했다.

**입양을 발동시키는 테스트가 하나도 없었다는 지적(N5)도 맞다.** 3개 추가했고, C1을 재도입하고
C2 훅을 제거하면 **정확히 그 2개만** 실패한다.

## 2. `7a2b68f9b` — C3는 유지, 관측 가능하게

C3(프로브 실패 시 새 계정이 `''` 버킷을 상속)는 **의도된 트레이드오프**다. 대안(링크별 고유
sentinel)은 같은 계정 재연결 + 프로브 실패에서 **라이브러리 전량 중복 재업로드**를 낳는다.
중복은 되돌릴 수 없고 빈 Drive는 재연결 한 번이면 회복된다.

받아들일 수 없었던 것은 **그 분기가 조용했다는 것**이다. Drive가 응답은 했는데 필드만 없으면
예외가 없어 아무 로그도 남지 않았다. 이제 두 분기 모두 결과까지 말하는 경고를 남기고, 그 로그를
단언으로 고정했다.

## 3. `fe9fe4fed` — **CI가 처음 잡은 것, 그리고 그건 내 것이 아니었다**

승격 후 첫 실행이 medium에서 빨간불이 났다. 원인:

```
buildConfig (utils/config.ts:84)   ← metadataRepo가 undefined
  ← AlbumService.isGoogleDriveEnabled (album.service.ts:363)
  ← AlbumService.queueGoogleDriveUploadsForAlbums (album.service.ts:330)
```

Wave 6이 "앨범에 자산 추가 시 Drive 백업 여부를 묻는" 코드를 넣었는데, workflow 플러그인 medium
하네스가 `AlbumService`를 **`SystemMetadataRepository` 없이** 구성한다. `assetAddToAlbums` 케이스가
전부 죽었고, 에러는 몇 겹 떨어진 "plugin host exception"으로 보고돼 원인이 가려져 있었다.

**이번 세션 커밋은 `album.service.ts`를 0회 건드렸다**(`6bfd4708a..HEAD` 확인). 아무도 못 본 이유는
**이 포크가 `//server:ci-medium`을 한 번도 돌린 적이 없어서**다 — 기능 러너는 그 트리에서 스펙
하나만 실행한다.

같은 실행의 lint 실패 6건은 내 것이었다(describe 안 헬퍼 4개, 불필요한 spread, `??` 대신 삼항).

## 4. `1d1ce48ab` — 나머지 N건

N3(게이트 쿼리를 사용자별로 + `unidentified` 표시 → 0이 안 되는 세 원인 구별), N6(`@GenerateSql`
params 2→3), N4(“프로브 한 번뿐”은 사실이 아님 — 식별 실패 시 잡마다), N7(2컬럼 PK 주석 3곳),
N8(메뉴 헤더의 뒤집힌 인과 — 리뷰가 두 번 지적한 것).

## 공격해 주셨으면 하는 것

1. **C1 수정이 모든 기록 경로를 덮는가.** `uploadAccountId`를 쓰는 곳이 하나뿐인지, 입양 이후
   같은 요청 안에서 `credentials`를 다시 읽는 곳이 남아 있는지.
2. **`getStatus`에 훅을 단 대가.** 이 엔드포인트는 설정 화면이 로드마다 부른다. 미식별 상태에서
   매 로드마다 `about.get`이 나가는데, 실패가 반복되는 계정에서 이게 문제가 되는지.
3. **하네스 수정의 정당성.** `SystemMetadataRepository`를 `real:`에 넣은 것이 맞는지, 아니면
   서비스 쪽이 config 없이도 동작해야 하는지. 이 파일은 업스트림 소유라 머지 충돌 표면이 있다.
4. **C3 트레이드오프.** 로그만 추가하고 유지하기로 한 판단에 동의하는지. 동의하지 않는다면
   sentinel 쪽 실패(전량 중복)를 어떻게 감당할지.

## 검증한 것 / 못 한 것

**검증함**: 248/39/20 PASS(`fe9fe4fed`), 비공허(C1 재도입 + C2 훅 제거 → 정확히 2개 실패),
`mise //server:ci-unit` 로컬 통과(2,358), `mise //server:ci-medium` 로컬 418 통과,
**CI 3잡 전부 success**(서브모듈 포함 medium 424 포함), `tsc`·prettier·svelte-check 클린.

**검증 못 함**: 운영 DB에서의 마이그레이션·입양 실동작(배포 시에만). 메뉴 위치 수정의 브라우저
확인도 여전히 받지 못했다. 직전 리뷰의 N2(생성 SQL 비결정성)는 **5회 재현 시도 모두 동일**해
재현하지 못했다.

## 리뷰어에게

- **격리 워크트리에서 실험할 것.** 지난번 메인 워크트리 실험이 커밋에 섞여 히스토리를 오염시켰다.
- 로컬에서 medium을 돌리면 exif 스펙 3개가 실패한다 — `e2e/test-assets` 서브모듈 미초기화 때문이며
  CI는 recursive로 체크아웃해 통과한다.
