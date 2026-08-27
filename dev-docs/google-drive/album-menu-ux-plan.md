# 앨범 Drive 메뉴 UX 개선 + 코너케이스 분석 (Wave 5)

앨범 상단 Drive 드롭다운을 다듬는다. 표면은 작지만(토글 스위치·진행 막대·구분선), 그 밑에
"자동 백업 토글"과 "지금 동기화"와 "진행 중 업로드"가 서로 겹치는 상태 조합이 많다. 코드를
쓰기 전에 그 조합을 전부 나열하고 처리 방침을 정한다.

방향은 **A안 확정**: 토글을 켜면 자동 백업이 켜지고 *그 순간 대기분이 즉시 큐잉된다*.
토글은 "앞으로도 자동", 지금 동기화는 "대기분을 지금" — 역할은 문구로 구분한다.

---

## 0. 먼저 — 지금 코드가 실제로 하는 일 (사실 확인)

| 동작 | 서버가 하는 일 |
|---|---|
| 토글 켜기 (`subscribeAlbum`) | 선택 행 upsert(중복이면 no-op) → **그 앨범의 미업로드분 즉시 큐잉** |
| 토글 끄기 (`unsubscribeAlbum`) | 선택 행 삭제. **큐에 이미 든 작업은 취소하지 않음.** 원장은 그대로 |
| 지금 동기화 (`syncAlbum`) | 구독 확인 → 미업로드분 큐잉 (토글 켤 때와 같은 큐잉 경로) |
| 워커 입구 (`uploadAsset`) | enabled / 연결 / 차단 / **원장(hasUpload)** 만 검사. **선택 여부는 안 봄** |

**가장 중요한 사실 두 개:**
1. **큐잉은 멱등**이다 — 원장 필터 + BullMQ `jobId`(`userId/assetId`) dedup + 워커의
   `hasUpload` 재확인, 3겹. 같은 자산을 몇 번 큐잉해도 파일은 한 번만 올라간다.
2. **워커는 선택 여부를 재검사하지 않는다.** 큐에 든 뒤 토글을 꺼도 그 작업은 실행된다.
   이건 Wave 1.5 리뷰에서 "수용 가능한 누수"로 판정한 지점이다(당시 근거: 재검사는 PK
   조회가 아니라 조인이고, 창이 좁다).

이 두 사실이 아래 대부분의 케이스를 *이미* 안전하게 만든다. 분석의 목적은 "깨지는 곳"보다
**"UI가 사실과 다르게 보이는 곳"** 을 찾는 것이다.

---

## 1. 코너케이스 전수

상태 축 3개의 조합으로 나눈다:
**[토글 on/off]** × **[해당 앨범 업로드 진행 중/정지]** × **[사용자의 다른 앨범 진행 중/정지]**

### A. 사용자가 물은 3가지

| # | 상황 | 지금 실제 동작 | 문제 | 처리 |
|---|---|---|---|---|
| 1 | 백업 진행 중, 토글을 **켬** | subscribe는 멱등 → 이미 켜져 있으면 no-op. (진행 중이라는 건 이미 켜졌다는 뜻) | **토글이 이미 on이면 켜는 동작 자체가 불가** — UI 모순 없음 | 토글이 on이면 그 항목은 "켜기"가 아니라 현재 상태 표시. 정상 |
| 2 | 토글 on·진행 중에 **지금 동기화** | 미업로드분을 다시 큐잉 → **전부 dedup으로 흡수**, 새 업로드 0 | 없음(멱등). 단 사용자는 "눌렀는데 아무 변화 없음"으로 느낄 수 있음 | 토스트: "이미 최신 상태입니다" 또는 "n장 대기 중" — 큐잉 결과를 알려줌 |
| 3 | 토글 on·진행 중에 **토글을 끔** | 선택 행 삭제. **이미 큐에 든 작업은 계속 실행**됨 → 몇 장 더 올라감 | UI는 "꺼짐"인데 실제로 몇 장 더 올라감 — **표시와 사실이 어긋남** | §2에서 정면으로 다룸 (이 케이스가 핵심) |

### B. 그 밖의 조합

| # | 상황 | 지금 동작 | 처리 |
|---|---|---|---|
| 4 | 토글 off인데 **지금 동기화** 누름 | `syncAlbum`이 `isSubscribed` 확인 → **400 "먼저 백업 대상에 추가하세요"** | 애초에 토글 off면 "지금 동기화" 항목을 **숨긴다**(현재도 `driveBackedUp && pending>0` 조건). 문제 없음 |
| 5 | 미연결 상태에서 토글 켜기 | `subscribeAlbum`이 400 "먼저 연결하세요" | 미연결이면 메뉴 전체가 "연결하기" 하나로 대체됨(Wave 2). 토글 자체가 안 보임 |
| 6 | 토글 켬 → **즉시 끔** (마음 바뀜) | 켤 때 전체 앨범이 큐잉됨 → 끄면 선택만 삭제, **큐잉분은 실행됨** | Wave 1.5 리뷰가 "수용"한 누수. #3과 같은 뿌리 → §2 |
| 7 | quota/폴더로 **차단된** 상태에서 토글 켜기 | subscribe·큐잉은 되지만 워커 입구 게이트가 전부 skip | 토글은 켜지되, 메뉴에 이미 있는 차단 배너/카드가 "왜 안 올라가는지" 설명. 추가 처리 불필요 |
| 8 | 진행 중 앨범 A의 메뉴를 열었는데 **다른 앨범 B도 진행 중** | Wave 3 리뷰에서 고침 — 앨범 행은 자기 앨범만, 사용자 전체 숫자는 우하단 카드 | 이미 해결됨 |
| 9 | 토글 켜는 순간 다른 기기/탭에서 **같은 앨범을 이미 켬** | subscribe 멱등 → 두 번째는 no-op. 큐잉도 dedup | 문제 없음. 단 UI 상태가 낡을 수 있음 → §3 낙관적 갱신 주의 |
| 10 | 토글 끄고 **다시 켬** | 원장이 남아 있어 이미 올라간 건 재업로드 안 함. 대기분만 큐잉 | 정상(원장의 목적). "다시 켜도 중복 안 생김"을 사용자가 신뢰하게 문구로 |
| 11 | 업로드 진행 중 **앨범에서 사진 삭제**(휴지통) | 스트림·카운트가 `deletedAt` 필터 → 대상에서 빠짐. 이미 큐에 든 건 워커가 삭제 감지해 skip | 이미 처리됨(Wave 1) |
| 12 | 토글 on 상태에서 **앨범에 새 사진 추가** | AlbumService가 구독자에게 자동 큐잉 | 정상(자동 백업의 본래 동작). 이게 A안의 핵심 가치 |

---

## 2. 진짜 문제는 하나 — "끄기"가 즉시 멈추지 않는다 (#3, #6)

토글을 끄면 선택 행은 사라지지만 **이미 큐에 든 작업은 실행**된다. 그래서 토글이 "꺼짐"인데
그 뒤로도 몇 장이 더 올라간다. 표시와 사실이 어긋나는 유일한 지점이다.

Wave 1.5 리뷰는 이 누수를 "수용 가능"으로 판정했다(당시 근거: 안 보이고, 재검사는 조인).

**설계 리뷰가 내 근거의 사실 오류를 잡았다(교정 완료).** 나는 "끄면 진행 카드가 계속
틱틱거린다"고 썼는데, 그렇지 않다. `countPendingUploads`가 `google_drive_album`을 inner
join하므로 선택 행이 삭제되는 순간 그 앨범 자산은 카운트에서 빠지고, 다음 폴(≤3초)에
카드 숫자는 오히려 **떨어진다.** 온스크린 증상은 일어나지 않는다.

진짜 문제는 더 나쁘고 덜 보인다: **큐에 든 작업이 사용자의 실제 구글 드라이브에 파일을 계속
쓴다.** immich 화면엔 안 보이고 Drive에서만 보인다. 게다가 `subscribeAlbum`은 켤 때 앨범
전체를 큐잉하므로, **"켰다 즉시 끔"(#6)은 몇 장이 아니라 앨범 전체가 샐 수 있다.**

그래서 Wave 1.5 판정을 뒤집는 근거는 "온스크린 가시성"이 아니라 **실제 Drive 반출 + 전체
앨범 큐잉**이다. 토스트만으로는 못 막는다 — 이미 실행 *중인* ≤5장을 못 막을 뿐 아니라, 큐에
쌓인 나머지 전체가 계속 쓰인다. 2-C가 필요하고, 토스트는 그 위에 얹는 보조다.

**보안 관점의 덤(리뷰 Q3):** 이 게이트는 워커를 **접근 권한의 두 번째 강제점**으로 만든다.
Wave 1.5 리뷰가 "enqueue 시점에 인가됨"으로 수용했던 "공유 해제 후 진행 중" 창을 닫는다.
공유가 끊긴 앨범의 자산이 실행 직전에도 멈추므로, UX보다 이게 더 강한 채택 근거다.

세 가지 선택지:

| 안 | 방법 | 장 | 단 |
|---|---|---|---|
| **2-A** | 그대로 두고 **UI로 설명** — 끄면 "대기 중인 n장은 마저 올라갑니다" 토스트 | 서버 변경 0, 멱등성 유지 | 사용자가 "끈다=즉시 멈춤"을 기대하면 여전히 어긋남 |
| **2-B** | 끌 때 **그 앨범의 큐 작업을 제거**(BullMQ에서 `jobId` 패턴으로 remove) | "끄면 멈춤"이 정확해짐 | 자산이 다른 선택된 앨범에도 있으면 그 앨범 몫까지 지워짐 → 다시 큐잉돼야 함. 복잡 |
| **2-C** | 워커 입구에서 **선택 여부 재검사** 추가 | 끈 뒤 큐에 남은 작업이 실행 직전 skip됨 | 작업당 조인 1회 추가(리뷰가 "PK 아님" 지적). 단 이 프로젝트 규모엔 무의미한 비용 |

**추천: 2-C.** Wave 1.5 리뷰가 2-C를 부정한 게 아니라 "그때는 불필요"였다. 토글이 눈앞에
오면서 "끄면 멈춘다"의 정확성이 UX 가치가 됐다. 비용은 작업당 인덱스 조인 1회 —
차단 게이트(`getBlockingError`)가 이미 작업당 조회를 하는 것과 같은 급이다.

2-C의 정확한 규칙: 워커 입구에서 **"이 자산이 이 사용자의 *어떤* 선택된 앨범에라도 속하는가"**
를 본다(특정 앨범이 아니라). 자산이 A·B 두 앨범에 있고 A만 껐다면 B 때문에 계속 올라가야
하므로 — 이건 "선택된 앨범이 하나라도 있으면 통과". §0의 멱등성과도 일관된다.

그리고 2-C를 넣어도 **2-A의 토스트는 함께** 한다: "끄면 멈춤"이 이제 참이지만, 이미 실행
*중인* 한두 장은 못 막으므로 "대기 중이던 것은 취소됨"을 알려주는 게 정직하다.

---

## 3. UI 변경 자체의 코너케이스

| # | 상황 | 처리 |
|---|---|---|
| 13 | 토글 클릭 → 서버 왕복 동안 연타 | 스위치를 `disabled`(진행 중) 처리. 이미 `driveTogglePending` 있음 |
| 14 | 낙관적 갱신 vs 서버 실패 | 스위치를 **낙관적으로 켜지 말고**, 서버 성공 후 상태 갱신(현재 `loadGoogleDriveMenu` 재조회 방식 유지). 실패 시 토스트 + 원상 |
| 15 | 진행 막대: 무제한 계정(limit=null) | 막대 대신 사용량 숫자만(현재 로직 유지) |
| 16 | 진행 막대: 휴지통이 대부분 | 막대는 전체 사용량 기준, 부제에 "n GB 휴지통"(현재 유지) |
| 17 | 구분선·간격 축소가 **다른 메뉴에 영향** | `MenuOption`은 공용 → **건드리지 않는다.** Drive 메뉴 전용 항목 컴포넌트를 만들거나, Drive 메뉴에만 감싸는 래퍼로 처리 |

---

## 4. 최종 계획

### 4.1 UI (web)
- **자동 백업 토글**: 텍스트 항목 → `@immich/ui`의 `Switch`. 부제 "새 사진을 자동으로 백업".
  켜짐/꺼짐이 스위치로 즉시 보임(사용자 지적 #1).
- **지금 동기화**: 문구 "지금 동기화" 유지(즉시 맞음, 지적 #2). **대기 0이면 숨기지 않고
  비활성 + "모두 동기화됨"** (결정 2). 누른 뒤 결과 토스트.
- **Drive 저장용량**: 텍스트 → **진행 막대 + 텍스트**, 80%/95% 색상 임계 유지(지적 #3).
- **구분선·간격**: Drive 메뉴 항목에만 희미한 하단 보더 + 패딩 16px→10px. 공용
  `MenuOption`은 불변(#17).

### 4.2 서버
- **2-C**: `uploadAsset` 입구에 "이 자산이 이 사용자의 선택된 앨범 중 하나에라도 속하는가"
  검사 추가 → 아니면 skip. 끈 뒤 큐 잔여분이 실행 직전 멈춘다.
  - 새 리포지토리 메서드 `isAssetInSubscribedAlbum(userId, assetId)` — live `album_user`까지
    조인(선택 행이 공유 해제보다 오래 살아남으므로, 스트림과 같은 이유).
  - **게이트 순서(리뷰 Q2 반영): enabled → 연결 → 원장(hasUpload) → 선택 → 차단.**
    `hasUpload`를 새 조인 앞으로 올린다: 계획 자체가 강조한 멱등 재큐잉 때문에 **이미 올라간
    자산의 재큐잉이 최다 히트 reject**인데, 그건 `(userId, assetId)` PK 조회다. 이걸 먼저 치면
    재큐잉은 조회 2번 만에 빠지고, 새 조인은 **진짜 대기 중인 자산에만** 돈다. 원 계획의
    "선택을 차단 앞에" 최적화는 드문 케이스(해제된 자산)만 아꼈던 것이라 폐기.

### 4.3 테스트 (dev-test/google-drive/run.sh 로 검증)
- 서버 유닛: 2-C 게이트 — 선택 앨범에 속하면 통과 / 안 속하면 skip / 두 앨범 중 하나만 껐을
  때 통과. 게이트 순서 — 이미 업로드된 자산은 선택 조회 **전에** hasUpload로 빠지는지.
- **서버 medium(실DB, 리뷰 Q4 확정): `isAssetInSubscribedAlbum`의 조인 정확성.** 공유 해제
  후 선택 행이 남아도 false를 반환하는지 — mock 유닛으로는 조인 필터를 검증할 수 없고, 이
  기능이 반복해서 미묘하게 틀린 게 정확히 이 조인이다(Wave 1.5 전체 발견). "스트림과 거의
  같다"는 건 테스트를 *넣을* 이유지 뺄 이유가 아니다.
- 웹: 토글 낙관적 갱신 안 함(실패 시 원상), 진행 막대 임계 색상.
- 각 케이스 표(#1~#12)에서 "정상"으로 분류한 것도 **의도한 이유로 정상인지** 단언
  (CLAUDE.md §4 — 기능이 꺼져 공허하게 통과한 전례).

---

## 5. 결정 (2026-08-20 확정, 설계 리뷰 2026-08-22 반영)

1. **2-C 넣는다.** 워커 입구에 선택 재검사를 추가한다.
   - **채택 근거(리뷰 교정):** "끄면 카드가 계속 도는 게 보인다"는 내 원 근거는 틀렸다 —
     `countPendingUploads`가 inner join이라 카드 숫자는 오히려 떨어진다(§2). 진짜 근거는
     ① 큐 잔여분이 **사용자의 실제 Drive에 파일을 계속 쓴다**(immich에선 안 보이고 Drive에서만
     보임), ② `subscribeAlbum`이 전체 앨범을 큐잉하므로 "켰다 즉시 끔"은 앨범 전체가 샐 수 있다,
     ③ **보안**: 이 게이트가 공유 해제 후 실행 중 창(Wave 1.5가 "enqueue 시 인가"로 수용)을
     닫는 두 번째 접근권한 강제점이 된다(리뷰 Q3 — UX보다 강한 근거).
   - 비용은 작업당 인덱스 조인 1회. 게이트 순서는 `hasUpload`를 앞에 둬서 멱등 재큐잉이 조인
     전에 빠지게 한다(§4.2, 리뷰 Q2).
2. **"지금 동기화"는 유지하되, 대기 0이면 숨기지 않고 비활성 + "모두 동기화됨"으로 표시.**
   - 숨기기를 검토했으나 복잡성을 줄이지 못한다: "지금 동기화"가 만드는 예외는 #2·#4뿐이고
     둘 다 멱등성·조건부숨김이 이미 흡수한다. 숨기면 무해한 것만 없애고, 대신 실패분 재시도·
     차단 해제 후 강제 재시도·"지금 확인" 의도를 표현할 곳을 잃는다.
   - 비활성+상태표시로 바꾸면 **#2의 "눌렀는데 반응 없음"이 애초에 누를 수 없게 되어 해소**
     된다. 숨기기보다 이쪽이 오히려 예외를 줄인다.
3. **진행 막대는 항상 인라인.**

---

## 6. 구현 리뷰 되먹임 (2026-08-23, `google-drive-wave5-impl-...-review.md`)

구현(`320646871` 서버, `9c1e52bd3` 웹)에 대한 리뷰 판정과 그 반영. **모두 코드로 대조 후 확인됨.**

### S1 — 게이트가 소프트 삭제된 앨범에서 계속 업로드함 (실DB로 재현·수정)
- `isAssetInSubscribedAlbum`는 `album`을 조인하지 않아 `album.deletedAt is null`을 빠뜨렸다.
  `countPendingUploads`/`streamPendingUploads`는 그 술어를 **의도적으로** 갖는다. 문서 주석의
  "same shape as ..."는 거짓이었다.
- 실제 유발 경로: `UserAdminService#delete` → `albumRepository.softDeleteAll(owner)`가 소유
  앨범 전부를 소프트 삭제하되 `album_asset`/`album_user`/`google_drive_album`에 **캐스케이드
  안 함**. 게스트의 선택·멤버십이 살아남아, 카드는 0(pending)·설정 목록엔 앨범 없음인데 큐
  잔여분은 게스트 Drive에 계속 씀 — 이 게이트가 없애려던 바로 그 "보이지 않는 유출".
- **수정:** `album` 조인 + `deletedAt is null` 추가, medium 테스트 5번째(소프트 삭제 후 false,
  선택 행은 생존) 추가. `asset.deletedAt`는 여기 넣지 않음(게이트 5가 담당) — 주석에 명시.
- **되먹임:** 게이트의 앨범 술어는 **`streamPendingUploads`와 동일해야 하는 불변식**이다.
  세 곳이 갈라지면 "pending"의 정의가 어긋난다. 다음에 하나를 고치면 셋 다 확인할 것.

### S2 — 낡은 문서 3곳 (이 저장소가 두 번 데인 지점)
- `unsubscribeAlbum` 주석: "워커는 구독을 검사하지 않는다 / per-job 조인은 너무 비싸다 / 몇 장만
  샌다" — 셋 다 이제 거짓. 게이트 3이 구독을 검사하고, 그 조인을 지불하며, 유출은 앨범 전체
  규모였다. 다시 씀.
- `google-drive-album.table.ts` 주석: "membership 조인해야 하는 read path"에 세 번째
  (`isAssetInSubscribedAlbum`) 추가.
- `uploadAsset` 게이트 번호 `0,1,2,3,4,3` → 새 선택 게이트가 3을 가져가며 자산 로드 주석이 3에
  남아 있었음. 5로 재번호. 게이트 4 주석에 "더 이상 첫 게이트 아님" 반 문장 추가(리뷰 Q3).

### W1~W3 — 웹 메뉴가 MenuOption의 구조적 계약을 버렸던 문제
`GoogleDriveAlbumMenu`가 `<ul role="menu">` 안에 id 없는 bare `<div>`/`<button>`을 넣어서:
- **W1**: 토글 클릭 시 메뉴가 닫혀 새 상태가 안 보임 — `ButtonContextMenu.handleDocumentClick`가
  메뉴 본문 클릭에도 닫았기 때문. **수정:** `menuContainer.contains(target)` 가드 추가. MenuOption은
  자기 onclick에서 `optionClickCallbackStore`로 닫으므로 이 변경은 MenuOption 동작을 안 바꾼다
  (공유 컴포넌트지만 안전 — 코드로 확인).
- **W2**: 키보드 조작 사망(id 없어 nav가 하이라이트 못 함, Enter가 메뉴만 닫음) + 잘못된 `<ul>`
  자식. **수정:** 각 행을 `<li id role="menuitem">`(토글은 `menuitemcheckbox`)로, `$selectedIdStore`
  하이라이트·hover 동기화, 액션 행은 `optionClickCallbackStore`로 닫음.
- **W3**: 닫힌 메뉴의 컨트롤이 탭 순서에 남음 — `hideContent` 미지정. **수정:** `hideContent` 전달.

### 낙관적 토글(설계 리뷰 예측 뒤집힘) — 되먹임
설계 리뷰의 "비낙관적이라 느리게 느껴질 것" 예측도, 실제로 배포된 "낙관적인데 되돌림 없음"도
아니었다. `@immich/ui` `Switch`의 `checked`를 unbound로 넘겨 bits-ui가 시각만 즉시 뒤집고,
실패 시 `catch`가 되돌리지 않아 "자가 복구될 수도/안 될 수도" 상태였다. **수정:** Switch를
표시 전용(`pointer-events-none` + `checked={backedUp}`, onCheckedChange 미연결)으로, 클릭은 행
`<li>`가 받아 `onToggle` 1회 발화. `backedUp`은 성공 후 `loadGoogleDriveMenu`만 갱신 → 실패 시
스위치 원위치. 되돌림 로직 없이 정확. **비낙관적으로 확정** — 다음 세션이 낙관적 설계 분석을
다시 유도하지 않도록.

### W4/W5 — 다른 레이어에 대한 거짓 주장 / 죽은 문자열
- **W4**: 80/95% 임계가 "서버 quota 블록과 같다"는 주석은 거짓 — 서버엔 % 임계가 없다(블록은
  Google의 403에 반응할 뿐). 주석을 "여기에만 있는 표시용 임계, 실패 전에 경고"로 정정.
- **W5**: 고아 i18n 키 4개(`google_drive_backup_on/off/off_description/progress`) 삭제. en.json은
  대소문자 무시 정렬 유지 확인.

### 검증
- 기능: 서버 유닛 199 / 웹 유닛 8 / medium **9**(신규 소프트삭제 테스트 포함) PASS
  (`dev-test/google-drive/results/20260823-1115.txt`).
- 회귀: 서버 전체 2325 pass(2 skip), 웹 전체 526 pass(2 skip). tsc·eslint(서버/웹) clean.
- 생성물: `//:sql` 재생성(dist 재빌드 후 — 스테일 dist 주의), 마이그레이션 드리프트 "No changes".
- **미검증(다음 라운드 리뷰 대상):** 실제 브라우저 렌더링(막대 색 전환, 비활성 "지금 동기화",
  미연결 멤버 행), 실제 BullMQ 큐를 통한 게이트 end-to-end.

---

## 7. 수정 리뷰 라운드 2 (2026-08-23, `google-drive-wave5-fixes-...-review.md`)

리뷰 판정: **7개 원 지적 모두 실제로 해결됨, 수정 자체도 안 깨짐. 서버는 배포 준비 완료.**
`hideContent`(W3) 수정이 드러낸 새 이슈 2개 + 테스트 공백 1개 — 모두 코드로 대조 후 반영.

### F1 — `hideContent`가 열림 시 포커스를 조용히 없앰 (a11y 회귀)
`openDropdown`이 `isOpen=true` 직후 `menuContainer?.focus()`를 **동기**로 호출하는데,
`hideContent`면 그 시점에 `<ul>`(= `menuContainer`)이 아직 렌더 전이라 undefined → no-op. 포커스가
트리거 버튼에 남아, `aria-activedescendant`(=W2가 복원한 키보드 하이라이트)를 보조기술이 못 봄.
**수정:** `void tick().then(() => menuContainer?.focus())`로 렌더 후 포커스. `tick` import 추가.

### F2 — 화살표 키마다 `onOpen`(=`loadGoogleDriveMenu`) 재실행 → Google API 난사
`contextMenuNavigation.moveSelection`은 이동 전에 매번 `openDropdown`을 부르고, `openDropdown`은
`onOpen`을 무조건 호출했다. 클릭 1 + 화살표 5 = onOpen 6회 = HTTP 18회(그중 6회가 Google
`drive.about.get`). W2 이전엔 이 메뉴에서 화살표를 아무도 안 눌러 잠복해 있던 비용.
**수정:** `openDropdown`에 `wasOpen` 가드 — 닫힘→열림 전이에서만 `onOpen` 발화(프롭 계약과도 일치).

### F3 — 수정에 테스트가 없고, 스위트가 수정을 못 봄
`GoogleDriveAlbumMenu`/`ButtonContextMenu` 닫힘 경로를 아무 spec도 안 건드려, "526 pass"는
W1/W2/W3의 증거가 아니었다. **수정:** 두 spec + 테스트 하네스 추가.
- `GoogleDriveAlbumMenu.spec.ts`(직접 렌더): 행이 id+role 가진 `<li>`인지, 토글이 onToggle 1회만
  발화하고 닫기 콜백은 안 부르는지(W1·이중발화 없음), 액션 행은 콜백 부르는지, 대기 0/진행중
  가드, 막대 색 임계(W4), 미연결/로딩 상태.
- `ButtonContextMenu.spec.ts`(실 컴포넌트+하네스): MenuOption 클릭은 닫고 비-MenuOption 본문
  클릭은 안 닫음(W1 가드), 바깥 클릭은 닫음, `hideContent` 닫힘 시 본문·탭스톱 제거(W3),
  `hideContent` 열림 후 포커스가 `<ul>`에(F1), 화살표에도 onOpen 1회(F2).
- **공허통과 검증(§4):** W1 가드·F1 tick·F2 wasOpen을 각각 임시로 제거하니 해당 테스트만
  정확히 실패함을 확인 후 되돌림.

### 리뷰가 확인해준 것 (되먹임)
- **공유 컴포넌트 변경(W1)은 안전 — 19개 `ButtonContextMenu` 본문 전수 조사로 확인.** 전부
  `MenuOption` 기반(또는 콜백 직접 호출)이라, 문서 클릭 핸들러 가드가 어떤 메뉴도 안 깬다.
  단 **새 의무**가 생김: 앞으로 MenuOption이 아닌 메뉴 본문은 `optionClickCallbackStore`를 직접
  불러야 닫힌다 → `handleDocumentClick` 주석에 명시함. (dual-mode 액션 59곳 모두 `menuItem` 전달
  확인 — 하나라도 빠지면 안 닫히는 메뉴가 됐을 것.)
- **S1 조인 정확성**: FK가 NOT NULL이라 inner join은 `deletedAt`로만 거른다(과다 제거 없음).
  리뷰가 실DB 뮤테이션 매트릭스 7종으로 게이트=`countPendingUploads` 일치 확인, `EXPLAIN`으로
  인덱스 구동 확인. "라이브+소프트삭제 둘 다 선택" 6번째 medium 테스트로 과다제거 방지 고정.
- **낙관적 토글 스레드 종결**: 표시 전용 Switch, 상태는 `backedUp`의 순수 함수, 되돌림 로직 불필요.

### 검증 (라운드 2)
- 기능: 서버 유닛 199 / 웹 유닛 **25**(신규 2 spec) / medium **10**(신규 과다제거 테스트) PASS
  (`dev-test/google-drive/results/20260823-1200.txt`).
- 회귀: 웹 전체 **543** pass(2 skip), 서버 전체 2325 pass(2 skip). tsc·eslint(서버/웹) clean.
- 스키마/컨트롤러 변경 없음 → SQL·SDK 재생성, 마이그레이션 드리프트 검사 불필요.
- **미검증(코드 결함 아님, 배포 후 확인):** 실제 브라우저 렌더링(막대 색 전환·비활성 동기화·
  미연결 멤버 행) — jsdom은 구조·포커스·콜백만 봄; 실 BullMQ 큐 e2e.

---

## 8. 수정 리뷰 라운드 3 (2026-08-23, `google-drive-wave5-fixes2-...-review.md`)

리뷰 판정: **F1/F2/F3 모두 정확히 수정됐고 비공허성도 리뷰어가 독립 재현(가드 4개를 각각
무력화 → 해당 테스트만 실패).** 데이터 안전 이슈 아님. R1(공유 코드, 배포 전 수정) + R2/R3
(빌드 청결) + R4/R5(커버리지). 모두 코드 대조 후 반영.

### R1 — F1의 지연 포커스가 닫힘 뒤에 실행될 수 있음 (18개 비-hideContent 메뉴에만 영향)
`void tick().then(() => menuContainer?.focus())`가 무가드라, 닫힘이 microtask 배수 전에 일어나면
`closeDropdown`의 `focusButton()`을 덮어써 **접힌(max-height:0) `<ul>`에 포커스가 갇힘**. Drive
메뉴는 `hideContent`로 `<ul>`이 언마운트돼 안전 — 즉 새 주석의 "Harmless without hideContent"는
**정반대**. 브라우저 실경로 재현은 못 함(마이크로태스크 1개 창)이나 공유 코드라 수정.
**수정:** `if (isOpen) menuContainer?.focus()`. `!wasOpen` 가드 **밖**에 유지(화살표 시 재포커스로
포커스 이탈 복구). 주석도 정정. R1 회귀 테스트 추가(무가드 시 실패 확인).

### R2 — `svelte-check` 에러 7→14 (전부 신규 spec의 타입 에러)
`tsc`/`eslint`는 Svelte 호출부를 타입체크 안 함 — `svelte-check`만 함. **수정:** `mode`를
`as const`로, mock을 `vi.fn<() => void>()`로, `closeCallback` 선언 타입도 좁힘. 7로 복귀(전부
기존/무관 파일). **`run.sh`에 svelte-check 단계 추가** — 기능 소유 파일의 에러만 게이트(프로젝트
전역 기존 에러와 분리).

### R3 — 토글 행 `<li role="menuitemcheckbox">` a11y 경고 (매 실행/빌드마다 출력)
라운드 1에 유입, 두 리포트 모두 놓침. role은 정확·불가결(nav가 `<li>` 필요, 체크박스 의미 필요).
**수정:** `<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->` + 이유 주석
(element/role 바꾸면 W2 재파손). 경고 소거 확인.

### R4 — 두 절반을 함께 테스트하는 것이 없었음
W1/W2/W3는 **합성**(실 Drive 메뉴 ⊂ 실 ButtonContextMenu, hideContent)에서 발견됐는데 그 합성은
미검증(stub은 ButtonContextMenu의 콜백 등록 변화를 못 잡음). **수정:** `DriveMenuHarness.svelte` +
합성 테스트(열림→`<ul>` 포커스 F1, 화살표→aria-activedescendant 전진 W2, 토글→onToggle 1회+메뉴
유지 W1, 동기화→닫힘). 실 `optionClickCallbackStore` 사용.

### R5 — F2 테스트가 나중에 공허해질 수 있음
화살표가 `moveSelection`에 안 닿게 되면 "onOpen 여전히 1"이 잘못된 이유로 통과. **수정:** 네비게이션이
실제로 돌았음을 `aria-activedescendant` 전진으로 못박음(§4 — 소프트삭제 테스트의 "true-before"와
같은 원리).

### 리뷰 affirmation (되먹임)
- 6번째 medium(과다제거 방지)은 정확히 요청한 형태 — 두 테스트가 두 방향, 둘 다 필요.
- `handleDocumentClick` 의무 주석·storage id load-bearing 주석 위치/내용 정확.
- **비낙관적 토글**: `pointer-events-none` 표시전용은 jsdom이 pointer-events 미구현이라 **테스트
  불가** — 그러나 `onCheckedChange` 없음으로 **구성상 안전**(최악이 bits-ui 내부 상태의 표시상
  desync, 잘못된 동작 아님). "tested"가 아니라 "safe by construction"으로 기록.
- W4 색 임계: spec이 클래스는 커버(위험 대부분), 경계값 80.0/95.0(`>=`) it.each 행 추가함. 실제
  색 전환 렌더링만 브라우저 필요.

### 검증 (라운드 3)
- 기능: 서버 유닛 199 / 웹 유닛 **29** / medium 10 / **svelte-check(기능 파일) 0 에러** PASS
  (`dev-test/google-drive/results/20260823-1255.txt`).
- 회귀: 웹 전체 **547** pass(2 skip). 서버 미변경(2325 유지). eslint clean. svelte-check 7(기존).
- 비공허성: R1 가드 무력화 시 R1 테스트만 실패 확인 후 복원.
- **남은 미검증(코드 결함 아님):** 실제 브라우저 색 전환/비활성 동기화/미연결 멤버 행,
  실 BullMQ 큐 e2e. → **배포 후 확인 항목.**

**리뷰어 결론: "Fix R1 before deploy, R2/R3 same commit — then this is done."** 모두 반영 완료.
다음 라운드가 깨끗하면 배포 단계로.

---

## 9. 수정 리뷰 라운드 4 (2026-08-27, `google-drive-wave5-fixes3-...-review.md`)

리뷰 판정: **R1/R3/R4/R5 완전히 수정됨(각각 neutering으로 재확인 — 가드→R1만, 토글-닫힘→유닛+합성,
동기화-무닫힘→유닛+합성). R2는 코드는 고쳐졌으나 그것을 지키려던 게이트가 작동 안 함.**

### G1 — `run.sh`의 svelte-check 게이트에 구멍 2개 (배포 전 수정)
라운드 3에서 추가한 파일명 grep 게이트가:
- **G1a**: 앨범 `+page.svelte`(매 라운드 편집·메뉴 마운트·`loadGoogleDriveMenu`/`hideContent` 소유)를
  어떤 패턴에도 안 걸려 **놓침**. 리뷰어가 그 파일에 타입 에러 주입 → 게이트 "clean" + PASS 재현.
  `MenuOption`/`ContextMenu`/`context-menu.store`도 같은 사각.
- **G1b**: **fail-open** — svelte-check가 아예 못 돌면(`|| true`) 에러 텍스트에 기능명이 없어 두 번째
  grep이 비고 → "clean" 선언. R2가 애초에 "svelte-check를 안 돌려서" 생겼는데, 안 돌아도 초록불.
**수정:** 파일명 allowlist를 버리고 **체크인 베이스라인 대비 게이트**로 교체
(`dev-test/google-drive/svelte-check-baseline.txt` = 기존 7에러 3파일의 `path<TAB>count`).
새 게이트는 ① `COMPLETED` 라인 없으면 FAIL(fail-closed), ② 에러 파일의 **집합+파일별 카운트**를
베이스라인과 비교해 신규 파일/증가 시 FAIL, ③ 경로만 추출 비교(G3: 에러 메시지 텍스트 매칭 제거).
검증: `+page.svelte`에 에러 주입→게이트 FAIL(G1a 해소), 잘못된 플래그로 실행→`COMPLETED` 없어
FAIL(G1b 해소). 정상 트리에선 "no regressions vs baseline (3 files)".

### G2 — R1 회귀 테스트가 부정만 단언
`expect(menu).not.toHaveFocus()`는 포커스가 트리거로 갔든 `<body>`로 샜든 통과. §4대로 **왜 통과하는지**
못박음: `expect(trigger).toHaveFocus()` 추가(닫힘은 자가교정임을 주석). neutering 시 R1 테스트만 실패 유지.

### G3 — 게이트 grep이 경로 아닌 전체 라인 매칭
무관 파일의 에러 **메시지**에 경로 유사 문자열이 있으면 오탐. fail-closed 방향이라 위험보단 성가심.
새 게이트가 경로만 추출·비교하므로 함께 해소.

### 리뷰 affirmation
- R2 코드 수정 완결(프로젝트 전역 7에러, 정확히 그 3개 기존 파일). R3 소거 방식 정확. R5는
  "true-before" 가드를 부정 단언에 적용한 올바른 표준. 경계행(80.0→yellow, 95.0→red) `>=` 질문 종결.
- **합성 테스트는 stub 유닛이 못 잡는 것을 잡는다**(콜백 배선 변화) — 존재 이유이자 유지 이유.
- 비낙관적 토글의 `pointer-events-none`은 jsdom 미구현이라 **테스트 불가, 구성상 안전**으로 계속 기록.

### 검증 (라운드 4)
- 기능: 서버 199 / 웹 29 / medium 10 / **svelte-check(베이스라인 게이트) 회귀 0** PASS
  (`results/20260827-0026.txt`). eslint clean.
- 게이트 자체 검증: G1a(주입 에러 포착)·G1b(미완료 시 FAIL) 모두 재현 확인.
- **남은 미검증(코드 결함 아님):** 4개 시각 상태(색 전환·비활성 동기화·미연결 멤버 행) 브라우저
  확인, 실 BullMQ 큐 e2e.

**리뷰어 결론:** *"Wave 5는 그 외엔 끝. 배포까지 남은 건 G1 + 네 개 시각 상태 브라우저 패스뿐이며,
§1상 브라우저 패스는 리뷰 대체가 아니라 자체 라운드가 필요하다."* → G1/G2/G3 반영 완료. 코드 측은
이 라운드로 마무리. 남은 것은 (a) 이 G-수정에 대한 리뷰 1회, (b) 배포, (c) 배포 후 브라우저 검증.

---

## 10. 수정 리뷰 라운드 5 (2026-08-27, `google-drive-wave5-fixes4-...-review.md`)

리뷰 판정: **G1/G2/G3 모두 정확히 수정, 블로킹 없음 — Wave 5에서 처음으로 "배포 전 필수 수정"
지적이 0인 라운드.** 리뷰어 결론: *"Wave 5의 코드는 끝났다. 브랜치와 배포 사이에 남은 유일한 것은
네 개 시각 상태의 브라우저 패스이며, §1상 그것은 자체 리뷰 라운드이지 사인오프가 아니다."*

**Before/after 증거(재실행 가능):** 라운드 3 게이트가 PASS시켰던 바로 그 `+page.svelte` 한 줄 주입이,
새 게이트에선 `svelte-check regressions vs baseline … RESULT: FAIL`. G1a 닫힘을 이 대비로 기록.

### 게이트는 의도적으로 name-agnostic
라운드 3의 교훈은 "파일명 allowlist는 기능 뒤로 드리프트한다"였다. 베이스라인 방식이 그 유지보수를
없앤다. **scoping을 다시 넣지 말 것.**

### H1/H2/H3 정리 (라운드 5에서 반영 — 현재 저장소에선 도달 불가하나 견고화)
리뷰가 지적한 잠복 파싱 취약점 + 드리프트를 같은 정리 커밋에서 처리:
- **H1**: 공백 포함 경로가 `awk '{print $2}'`에 잘림 → `sed -E 's/^ *([0-9]+) (.*)/\2\t\1/'`로 경로 보존.
- **H2**: `grep ' ERROR '`가 WARNING의 **메시지**에 " ERROR "가 있으면 오탐 → `awk '$2=="ERROR"'`(필드 매칭).
- **H3**: 베이스라인이 **관대한 방향으로만** 검사됐음(업스트림 머지가 기존 에러를 고치면 그 파일이 새
  에러 최대 N개를 조용히 용인). 이제 **양방향** 비교 — REGRESSION(초과)은 FAIL, STALE(미만)은
  실패 없이 "regenerate" 경고 출력. 진짜 masking(같은 파일 fix+new 동수)은 line:col/해시가 필요하나
  그 3개 파일은 이 기능이 안 건드리는 무관 파일이라 잔여 위험 대비 유지비가 커서 도입 안 함.
- **timeout**: `timeout 600 npx svelte-check` — 크래시가 아닌 **행(hang)**도 COMPLETED 부재로 FAIL 전환.
- 검증: 클린 트리 PASS/무-STALE, `+page.svelte` 주입→REGRESSION→FAIL(end-to-end), 전부 fix→STALE만,
  공백 경로 보존, 베이스라인 파일 초과→REGRESSION — 6/6 시나리오 정확.

### 리뷰 affirmation
- `--output machine`는 **상대 경로**(기본 `human`은 절대) — 베이스라인/게이트가 같은 형식이라 3파일이
  영구 회귀로 안 읽힘. regen 명령이 체크인 베이스라인과 **byte-for-byte 동일**함을 리뷰어가 확인.
- G2의 `expect(trigger).toHaveFocus()`는 `focusButton()`이 책임지는 정확한 상태를 못박음(`getByLabelText('menu')`
  = `IconButton`의 `id=buttonId` 버튼). 닫힘 자가교정 주석도 정확.
- G3는 재설계의 부수효과로 해소(전체 라인 대신 경로만 매칭).

### 검증 (라운드 5)
- 기능: 서버 199 / 웹 29 / medium 10 / 베이스라인 게이트(견고화) 회귀 0 PASS. eslint clean.
- 게이트 견고화: H1/H2/H3 + timeout 반영, 6개 시나리오 격리 검증 + 주입 end-to-end.
- **남은 미검증(코드 결함 아님):** 4개 시각 상태 브라우저 패스, 실 BullMQ 큐 e2e.

**⇒ Wave 5 코드 측 완료.** 남은 것: (a) 이 H-정리에 대한 리뷰(선택 — test-infra only), (b) 배포
(§1/§7: DB 백업 + 사용자 확인 필수), (c) 배포 후 브라우저 검증(자체 라운드).

---

## 11. 수정 리뷰 라운드 6 (2026-08-27, `google-drive-wave5-fixes5-...-review.md`)

리뷰 판정: **H1/H2/H3 + timeout 모두 정확히 수정.** 단 하나 — **I1: 베이스라인 파일이 없거나 비면
게이트가 fail-open.** 이 게이트가 두 번 재작성으로 없앤 바로 그 부류(fail-open)의 세 번째.

### I1 — 없거나 빈 베이스라인에서 fail-open (배포 전 수정, 반영 완료)
두 메커니즘 모두 재현:
- **없음**: 비교 awk가 `fatal: cannot open file`로 중단 → `SC_REG` 비어 → PASS(stderr만 남고
  `RESULT: PASS` 아래로 스크롤).
- **빈 파일**: `NR==FNR` 관용구의 표준 함정 — **첫 파일이 비면 두 번째 파일 읽는 동안에도 NR==FNR가
  참**이라, 현재 에러 행이 전부 `base[]`로 들어가고 `cur[]`는 비어 REGRESSION 루프가 아무것도 안 봄
  → PASS. (실측: 신규 에러 파일이 STALE로 오분류되어 실패 안 함.)
- **도달 경로**: 문서화된 regen 명령이 파이프라인 실행 **전에** 대상 파일을 truncate한다. svelte-check가
  실패/중단되거나 잘못된 디렉토리에서 돌리면 0바이트 베이스라인이 남고, 그 순간부터 게이트는 영구
  초록불. G1b(run 경로)를 고쳤더니 **maintenance 경로**에 살아남은 것. H3가 regen 빈도를 늘려 창이 더 넓어짐.
- **수정:** 비교 전에 `[[ ! -s "$SC_BASELINE" ]]` 가드 → 없거나 비면 즉시 FAIL(빈 파일은 awk에
  닿기 전에 걸러 NR==FNR 함정도 무력화). regen 명령을 **원자적**으로(`> /tmp/…$$ && mv`) 바꿔 잘린
  파일이 남지 않게. 주석에 "이 가드는 중복 존재검사가 아니라 load-bearing"임을 명시.
- **검증(end-to-end):** 빈 베이스라인→FAIL, 없는 베이스라인→FAIL, 클린 트리→PASS(무-STALE),
  full suite --medium PASS.

### 리뷰가 확인해준 것
- 양방향 awk 오분류 없음: 혼합(전부 fix + 신규 에러) 케이스도 STALE·REGRESSION을 경로별로 계산해
  실패 판정은 `SC_REG`만 봄 → STALE가 REGRESSION을 못 가림. `base[f]+0>0` 가드로 0카운트 영구 STALE도 방지.
- **H1은 "베이스라인에 있는 공백 경로가 매치되는가"로 검증해야 함** — "에러 있는 공백 경로"는 어차피
  신규라 양쪽 다 실패해 구분 불가. 이 구분이 재사용 가능한 교훈.
- H2 `awk '$2=="ERROR"'`는 진짜 에러 라인을 안 놓침(machine format은 진단당 1줄, 멀티라인 메시지는
  `\n` 이스케이프). svelte-check는 에러가 있으면 exit 1이므로 **exit status 게이팅은 애초에 틀림**(기존
  7에러에 영구 실패) — content 게이팅이 옳고 그대로 둘 것.
- timeout: svelte-check 실측 14s, 600s는 ~43배 여유. `$( )` + 프로세스그룹 시그널로 손자 프로세스도
  죽어 stall 없음(리뷰어 실측 2s).

### 되먹임 (게이트 패턴)
**이 게이트가 의존하는 모든 입력은 존재를 가정하지 말고 검증하라** — `COMPLETED` 라인이 하나,
베이스라인 파일이 다른 하나. fail-open이 세 번(G1b run 경로, I1 없음·빈 파일 경로) 나온 이유가 이것.

### 검증 (라운드 6)
- 기능: 서버 199 / 웹 29 / medium 10 / 베이스라인 게이트 회귀 0 PASS
  (`results/20260827-0726.txt`).
- I1: 없음·빈 파일 둘 다 격리+end-to-end로 FAIL 확인, 클린 PASS 유지.
- **남은 미검증(코드 결함 아님):** 4개 시각 상태 브라우저 패스, 실 BullMQ 큐 e2e.

**⇒ Wave 5 shipped 코드는 라운드 4~6 내내 무변경(전부 test-infra). I1이 반영됐으니 브랜치와 배포
사이에 남은 것은 브라우저 패스뿐.**

---

## 12. 수정 리뷰 라운드 7 (2026-08-27, `google-drive-wave5-fixes6-...-review.md`)

리뷰 판정: **I1 완전히 닫힘(없음·빈 파일 둘 다 end-to-end FAIL, malformed 매트릭스 5종 중 4종 fail-closed
또는 무해, 1종은 "숫자를 위로 손편집"해야만 열리고 그마저 STALE로 자기고발).** 하나 — **J1.**

### J1 — regen 명령의 `&& mv`가 실패한 파이프라인을 못 막음 (fail-open 아님, 반영 완료)
문서화된 regen 명령이 **주석**(run.sh)이라 사용자의 인터랙티브 셸에서 실행되는데, 거기엔
`pipefail`이 없다. `sort`가 빈 입력에 exit 0 → `&&` 진행 → 0바이트 베이스라인 설치. (실측: no-pipefail
`( false | sort ) > t && mv` → exit 0, dest 0바이트 / pipefail → exit 1, dest 유지.)
**단, 이번 라운드의 `-s` 가드가 정확히 이걸 봉쇄** — 잘린 베이스라인은 이제 조용한 초록이 아니라
큰 `RESULT: FAIL`. 즉 J1은 견고성/사용성 결함이지 fail-open 아님(두 실수가 겹쳐야 문제). 리뷰어:
"브랜치 홀드 사유 아님."
**수정(리뷰어 권장 durable 안):** 파이프라인을 **`./dev-test/google-drive/run.sh --regen-baseline`
서브커맨드**로. 스크립트 자체의 `set -o pipefail` 아래 실행 + COMPLETED 검증 + 빈 결과 거부 + 원자적
temp→mv 설치. **추출 파이프라인을 한 곳(`sc_extract` 함수)으로 통합** — 게이트와 주석에 두 벌 있어
이미 한 번 드리프트했던 것(주석이 옛 `grep`/`awk` 유지) 제거. 추가로 리뷰어 nit 반영: `-s` 검사를
`SC_OUT=`(느린 svelte-check 실행) **위로 hoist** — 결정된 실패에 14s를 안 쓰게.
**검증:** `bash -n` OK, `--regen-baseline`이 체크인 베이스라인을 byte-identical 재현, 빈 베이스라인→FAIL
(이제 svelte-check 실행 없이), full suite --medium 199/29/10 PASS.

### 리뷰가 확인해준 것 (되먹임)
- **format validation 불필요**: 모든 *우발적* malformation(탭 없음/비숫자 카운트/공백만/CRLF)은 이미
  fail-closed 또는 무해. 검증기는 *고의적* 오편집만 막고 포맷 동기화 부담만 늘림 → 도입 안 함.
  (원하면 "탭 없는 줄"에 warn만 — 유일하게 조용히 무해-무보호인 형태.)
- `-s` → `COMPLETED` → compare 순서 정확. present-but-stale + crash 조합도 COMPLETED 분기로 FAIL.
- **패턴 교훈**: 이 게이트가 의존하는 모든 입력을 검증하라 — `COMPLETED` 라인, 베이스라인 파일,
  그리고 이제 regen 파이프라인의 성공. fail-open이 3라운드에 걸쳐 나온 이유가 "입력을 가정"한 것.
- 추출 파이프라인 중복이 J1의 더 깊은 원인 — 서브커맨드가 한 방에 통합+수정.

### 검증 (라운드 7)
- 기능: 서버 199 / 웹 29 / medium 10 / 베이스라인 게이트 회귀 0 PASS. `--regen-baseline` 재현성 확인.
- **남은 미검증(코드 결함 아님):** 4개 시각 상태 브라우저 패스, 실 BullMQ 큐 e2e.

**⇒ shipped 코드 라운드 3 이후 무변경(라운드 4~7 전부 test-infra). 리뷰어 재확인: 배포 전 남은 건
브라우저 패스뿐이며, §1상 그것은 자체 report+review 라운드이지 이 라운드의 사인오프가 아니다.**

---

## 13. 수정 리뷰 라운드 8 (2026-08-27, `google-drive-wave5-fixes7-...-review.md`)

리뷰 판정: **J1 수정 완료, 서브커맨드가 올바른 설계.** `sc_extract` 통합이 드리프트를 근본 제거,
재구조화된 제어흐름 정확(4개 경로 실행 확인), `--regen-baseline`이 베이스라인 byte-identical 재현.
`-s` hoist 실측(빈 베이스라인 17.5s = vitest 2개만, svelte-check 미실행 ✓). **d4d5d493c는 배포
이미지 미포함 재확인**(`grep -c dev-test server/Dockerfile` = 0).

**두 잠복 결함(K1/K2) — 둘 다 `--regen-baseline` 안, fail-open 아님, shipped 코드 무관, 브랜치 홀드
사유 아님.** 이 게이트가 3라운드 연속 맞은 같은 테마의 변주: "설치·검증하는 코드가 아무것도 안
하면서 됐다고 보고".
- **K1**: 설치 실패 미전파 — `printf > tmp && mv` 상태값 버려짐 → `mv` 실패해도 "baseline
  regenerated" 출력 + **옛 파일** cat + exit 0(권한없는 대상으로 재현). 수정안: 명시적
  `if ! { printf … && mv …; }; then rm tmp; echo fail; exit 1; fi`.
- **K2**: "기존 에러 0"이 표현 불가 — 7개 다 고쳐지면(H3 STALE가 유도하는 상태) regen이 빈 파일
  거부 → 게이트 `-s`가 빈 파일 FAIL → STALE가 매 실행 "regenerate" 권고하나 regen은 거부 →
  탈출구 없음. 수정안: regen이 항상 `#` 주석 헤더를 써서 빈 파일이 안 되게 + 0-에러 거부 제거.
  리뷰어가 비교 awk가 `#` 줄을 무해 처리함을 검증(`""+0`=0, REGRESSION·STALE 둘 다 아님).
- cosmetic: hoist가 더한 중첩만큼 내부 비교 블록 재들여쓰기(닫는 `fi` 주석 라벨 제거).

**패턴 되먹임(리뷰어):** 매 라운드 "베이스라인을 설치/검증하는 코드"에 '아무것도 안 하고 정상보고'
경로가 있었다(I1: 나쁜 베이스라인 조용히 설치 / J1: `&& mv` abort 불가 / K1: 설치 실패인데 성공
보고). 다음 수정은 "작동하나?"보다 "실패하면 뭘 하나?"를 먼저 물을 것.

### 배포 판단 (열림)
- **shipped 코드는 라운드 3(`861869fe7`) 이후 무변경**, 라운드 4~8 전부 test-infra. 배포될 코드는
  전부 리뷰 완료 — §1 실질 충족.
- K1/K2는 `run.sh`(dev-tooling), 배포 이미지 미포함, 리뷰어 "브랜치 홀드 사유 아님".
- 사용자 조건("코드 수정 필요 시 리뷰 먼저")상 K1/K2를 고치면 그 수정도 리뷰 대상 → test-infra
  리뷰 루프가 한 번 더 순환. → **배포 시점 결정은 사용자에게.**

### 라운드 8 K1/K2 반영 (2026-08-27)
- **K1**: 설치를 한 단계 가드로 — `if ! { { echo "#header"; printf …; } > tmp && mv tmp baseline; }; then
  rm tmp; echo fail; exit 1; fi`. `mv` 실패가 이제 조용한 성공보고 대신 non-zero + "nothing was
  changed"로 나옴. (권한없는 대상으로 install-failure 분기 진입 확인.)
- **K2**: regen이 항상 `# svelte-check baseline — regenerate with: …` 헤더를 써서 빈 파일이 안 됨 →
  0-에러 상태가 표현 가능한 유효 베이스라인(그 상태에선 게이트가 *더* 엄격: 어디든 에러=회귀).
  0-에러 거부 제거. 비교 awk에 `if ($0 ~ /^#/) next` 명시(헤더를 경로 키로 취급 안 함). 검증:
  헤더-only + 신규에러→REGRESSION(fail-closed), 헤더-only + 클린→무-STALE, `-s` 통과.
- cosmetic: hoist가 더한 중첩만큼 내부 비교 블록 재들여쓰기, `# close:` 라벨 주석 제거.
- 체크인 베이스라인을 헤더 포함으로 재생성(regen 멱등성 유지 — 두 번 돌려도 동일). 파일 수 카운트는
  `grep -vc '^#'`로 헤더 제외.
- 검증: `bash -n` OK, regen 멱등, 기능 199/29/10 + 게이트 회귀 0 PASS.
- **남은 것: K1/K2 리뷰(사용자 조건) → 통과 시 배포 → 배포 후 브라우저 패스.**

### 라운드 9 리뷰 (K1/K2, 2026-08-27, `google-drive-wave5-fixes8-...-review.md`)
판정: **K1/K2 모두 정확히 수정, 재들여쓰기 clean.** 리뷰어가 내가 미검증으로 남긴 `printf` 실패
분기까지 실검증(`/dev/full` 실 ENOSPC → 가드가 잡음). K1 두 실패모드(권한없는 mv / disk-full write)
모두 non-zero + 옛 파일 보존 + temp 누수 없음. K2 헤더는 모든 비교 방향에서 무해, 0-에러 상태는
표현 가능 + *더 엄격*. regen 멱등, 체크인 베이스라인 = regen 출력 byte-identical.

**L1 (사소, 열림):** 0-에러 베이스라인이 `printf '%s\n' ""`의 개행 때문에 빈 줄 1개를 가져
`grep -vc '^#'`가 0 대신 **1**로 셈. **현재 상태(3파일)에는 영향 없음** — 0-에러 상태에서만 나타나는
표시상 오차. 수정안(리뷰어): `[[ -z "$NEW" ]] || printf …`(순진한 `[[ -n ]] &&`는 NEW 빈 경우 그룹이
exit 1 → K1 가드가 **거짓 설치실패**로 오인하는 함정 — 리뷰어가 양쪽 실검증) + 카운트는
`grep -c $'\t'`(데이터 행만). **함정을 기록**: L1 수정을 잘못하면 K1 회귀로 오인됨.

**되먹임(리뷰어):** I1→J1→K1 시퀀스 종결 — "베이스라인을 설치/검증하는 코드가 아무것도 안 하고
정상보고"라는 3라운드 반복 테마를, **exit status를 제어흐름으로 만들어** 끝냄. 이게 교훈.

**상태:** shipped 코드 라운드 3 이후 무변경(라운드 4~9 전부 test-infra). **HEAD는 전부 리뷰 완료** —
사용자 조건상 배포 허용됨. L1은 배포·현재상태 무관 사소 잔여. 남은 것: 배포 + 배포 후 브라우저 패스.

---

## 14. 배포 (2026-08-27)

Wave 5(앨범 Drive 메뉴 UX + 워커 선택 게이트)를 랩탑 운영에 배포. **9라운드 리뷰 사이클을 통과한
shipped 코드**(라운드 3 `861869fe7` 이후 shipped 무변경; 이후는 전부 test-infra).

- **빌드**: `docker build -f server/Dockerfile -t immich-server:3.1.0-gdrive .` → ID `cd43709aff9b`
  (linux/amd64 단일 플랫폼, 3.25GB). 데스크탑 23Gi RAM(8GB는 랩탑) — dev 스택 정지 후 빌드.
- **다운그레이드 가드**: HEAD ⊃ v3.1.0 ✓. **마이그레이션 드리프트**: No changes ✓.
- **백업**(먼저): `docker exec immich_postgres pg_dumpall -U $POSTGRES_USER | gzip` →
  `~/immich-backups/immich-db.2026-08-27-2121.sql.gz` (~150MB, gzip -t OK, 검증됨).
- **전송/로드**: `docker save | gzip -1 | ssh | gunzip | docker load` (~2분, 무중단).
- **재기동**: 사용자가 랩탑에서 `docker compose up -d`. immich_server만 새 이미지로 재생성.
- **검증**: `health=healthy`, `/api/server/ping`→pong, `/api/server/version`→3.1.0, 부팅 로그
  "No schema drift detected" + `googleDrive: true` + 에러 없음. 옛 이미지 `dcce8abb686f` 랩탑에
  잔존(롤백 가능).

### 배포 후 남은 것
- **브라우저 4개 시각 상태 검증** (§1: 자체 report+review 라운드) — 막대 색 전환·비활성 "지금
  동기화"·미연결 멤버 행·connect 행. jsdom이 못 본 외형. 데스크탑 dev 스택은 이 검증을 위해 정지
  상태 유지(2283 해제 → `http://192.168.50.211:2283` 직접 접속, 터널 불필요).
- **L1 후속**: 0-에러 베이스라인 카운트 오차(현재 무영향). 별도 리뷰 사이클로 처리.
- 실 BullMQ 큐 e2e(운영에서 실동작으로 관찰 가능해짐).
