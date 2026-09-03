# 자동/수동 백업 — 코너케이스 분석과 테스트 계획

작성 2026-09-03. 분석은 deep-reasoning 서브에이전트가 하고, **아래 "확인함" 표시된 항목은
내가 코드로 직접 대조했다**(§1: 붙여넣은 분석은 액면가로 받지 않는다).

두 흐름을 대상으로 한다.

```
A. 자동 백업   앨범별 토글 → 앨범에 자산 추가 시 자산별 잡 큐잉
                (album.service → getSubscribers → queueGoogleDriveUploads)
B. 수동 백업   관리자 Jobs 화면 → GoogleDriveUploadQueueAll → 백로그 전체 스트리밍
                (queue.service.ts:249 이 유일한 생산자)
```

---

## 1. 테스트가 아니라 **코드 수정**이 필요한 것

| # | 문제 | 근거 | 확인 |
|---|---|---|---|
| **B1** | **다른 구글 계정으로 재연결하면 아무것도 백업되지 않는다.** `user_google_drive`에 구글 계정 식별자가 없고(컬럼: `userId, refreshToken, folderId, connectedAt, folderName`), `upsertCredentials`는 **`refreshToken`만** 갱신한다. 원장은 `(userId, assetId)` 축이라, 계정 B로 갈아타면 모든 자산이 "이미 업로드됨"으로 읽혀 새 Drive는 영원히 비어 있는데 UI는 "N/N 완료"라고 말한다 | `google-drive.repository.ts:55-61`, `\d user_google_drive` | **확인함** |
| **B2** | **차단 상태가 재연결을 살아남는다.** `linkAccount`는 `clearErrors(userId, [Revoked])`만 호출한다. `quota_exceeded`·`folder_missing` 행은 남아 워커 입구에서 새 계정의 모든 잡을 스킵시킨다. Resume 버튼만 이를 지우는데, 재연결 흐름 어디에도 그 안내가 없다 | `google-drive.service.ts:366` | **확인함** |
| **B7** | **`getSubscribers`만 필터가 빠져 있다.** 형제 쿼리 두 개(`streamPendingUploads`, `isAssetInSubscribedAlbum`)에 있는 `album.deletedAt is null`과 차단 오류 제외가 없다. 삭제된 앨범·차단된 사용자에게도 잡을 큐잉한다 | `google-drive.repository.ts:114-126` | **확인함** |
| **B3** | **revoked 감지가 진입점마다 다르다.** `uploadAsset`은 오류 행 기록 + 알림 + 자격증명 삭제까지 하는데, `getStorage`/`getPickerConfig`는 같은 `invalid_grant`를 던지기만 한다. 업로드가 큐잉된 적 없는 사용자는 7일 만료 후에도 설정 화면에서 "연결됨"을 계속 본다 | `google-drive.service.ts:878-896` vs `:503-511`, `:585-591` | 미확인(주장) |

### B4는 버그가 아니다 — 프레이밍을 고쳤다

분석은 "실패한 잡을 아무도 재시도하지 않는다"를 버그로 올렸으나, `removeOnFail: true`는
**의도적이고 이유가 문서화돼 있다**(`job.repository.ts:268-290`): jobId가
`userId/assetId`라서 실패 잡을 남기면 BullMQ가 그 쌍을 **영원히** 재큐잉 불가로 만든다.
그래서 실패를 버리고 "다음 백필에서 다시 잡힌다"에 기대는 설계다.

진짜 빈틈은 다른 데 있다 — **그 백필을 자동으로 도는 것이 없다.** `GoogleDriveUploadQueueAll`의
생산자는 관리자 버튼 하나뿐이라(`queue.service.ts:249`), "다음 백필"은 사람이 누를 때까지 오지
않는다. 그 사이 UI는 `pending > 0`이므로 **아무것도 돌지 않는데 "동기화 중"을 계속 표시**한다
(`google-drive-progress-manager.svelte.ts:41-43`).

→ 선택지: (a) QueueAll에 cron을 붙인다, (b) UI에 `stalled` 상태를 추가한다(진행이 멈췄고
실패가 있으면 그렇게 말한다), (c) 둘 다. **(b)가 싸고 정직하다.**

---

## 2. 테스트 계획 — 우선순위

### P0. 가장 싸고 값이 큰 6개 (먼저)

| # | 테스트 | 종류 | 비공허성 장치 |
|---|---|---|---|
| 1 | `getSubscribers` 접근 조인 — 공유 해제/미연결/미선택/삭제된 앨범 각각 제외되는지 | medium | 기대되는 `(albumId,userId)` 쌍이 **정확히 하나** 나오는 것까지 단언 |
| 2 | `upsertError`의 `firstOfClass` CTE + `recordUpload`가 오류 행을 지우는지 + `getErrorSummary` 반정규 조인 | medium | 같은 클래스 2회 → `false` + `attempts === 2` |
| 3 | `handleGoogleDriveUploadQueueAll` 자체 + 1000건 배치 경계 | unit | 1001건 → `queueAll` 2회(1000/1). 비활성 시 스트림에 손대지 않고 `Skipped` |
| 4 | 휴지통 자산이 gate 5에서 걸리는지 | unit | `createReadStream`이 **호출되지 않음**까지 단언(더 앞에서 멈춘 게 아님을 증명) |
| 5 | `getStorage`/`getPickerConfig`의 revoked 처리 일치(B3) | unit | `driveAboutGet`이 실제로 호출됐음을 함께 단언 |
| 6 | **다른 계정으로 재연결(B1)** — 재연결 후 `streamPendingUploads`가 다시 N건을 내는가 | medium | 재연결 **전에** N건이 나오는 것을 먼저 단언 |

6번은 테스트가 아니라 **사양 선언**이다. 지금은 0을 내고, 그게 B1이다. 고치는 방향은 두 가지 —
`user_google_drive`에 Drive 계정 id를 저장하고 바뀌면 원장을 리셋하거나, 원장 축에 계정을 넣는다.

### P1. 사장님이 예로 드신 두 케이스

- **업로드 중 연결 끊김** — 분류 자체는 이미 커버됨(`utils/google-drive.spec.ts:125`). 빠진 것은
  **결과**다: 바닥 `Error`(응답 없음)로 거절 → `Unknown` 오류 행, `recordUpload` 미호출,
  알림 미발송, 그리고 **스트림이 destroy 되는지**(fd 누수 방어, `:928`, 현재 무테스트).
- **수동 백업 중 자동 토글 ON** — 합집합은 jobId dedup이 흡수하므로 동작은 옳다. 테스트할 것은
  **순서**다: `subscribe()`가 `queueGoogleDriveUploads`보다 **먼저** 완료되는지
  (뒤집히면 gate 3와 경쟁한다). `invocationCallOrder`로 단언.
- **토글 OFF 중간** — 이미 unit + medium 양쪽 커버됨. **추가 불필요.**

### P2. 이미 커버돼 추가하지 않을 것 (중복 방지)

폴더 삭제 → `FolderMissing` 차단(`service.spec:398`), 맨 404 = 세션 만료(`service.spec:431`),
실행 중 연결 해제(`service.spec:191`), 앨범 추적 해제·소프트 삭제·공유 해제(`repository.spec:126,160,183,208`),
원본 파일 없음(`service.spec:295`), 할당량 차단 개별 잡(`service.spec` 해당 케이스).

### P3. 기록만 (테스트 가치 낮음)

배치당 1000건 `queue.add()` 병렬 호출, 백로그 전체에 걸친 장수명 커서(`idle_in_transaction_session_timeout`),
OAuth state 10분 만료의 시계 오차, 60초 스토리지 캐시 지연.

---

## 3. 모든 유닛 테스트에 적용할 비공허성 규칙

이 저장소는 "기능이 꺼져 있어서 통과한 테스트"에 **두 번** 당했다. 그래서:

- `mocks.systemMetadata.get`을 **기능이 켜진 설정**으로 스텁한다.
- **부정 단언에는 반드시 양성 증인을 짝지운다** — gate 5 이후를 보는 테스트면
  `expect(mocks.storage.createReadStream).toHaveBeenCalled()`, gate 4 이후면
  `expect(driveFilesCreate).toHaveBeenCalledTimes(1)`, 큐잉 측 dedup이면
  `expect(mocks.googleDrive.getUploadedAssetIds).toHaveBeenCalled()`.
- 맨 `expect(job.queueAll).not.toHaveBeenCalled()`는 **과거에 공허하게 통과했던 바로 그 모양**이다.

---

## 4. 실행 순서 제안

1. **B1/B2/B7을 먼저 고친다**(코드). 셋 다 조용히 틀리는 종류라 테스트보다 앞선다.
2. P0의 6개를 그 수정과 함께 넣는다 — 6번은 B1 수정의 사양이 된다.
3. P1 두 개를 넣는다.
4. UI `stalled` 상태(B4의 정직한 부분)를 넣는다.

각 단계는 §2대로 테스트 통과 → 증거 재생성 → 리뷰 요청 → 반영을 거친다.
