# Code Review — wave11d (R3): 야간 backfill · 시도 상한 · 스트림 오류 리스너

| | |
|---|---|
| Branch / HEAD | `feat/google-drive-album-sync-v3.1.0` / 리뷰 대상 `68765f1ae` (작업 트리는 리뷰 중 이동 — 코드는 전부 `git show 68765f1ae:<path>` 와 스크래치 워크트리에서 읽고 돌렸다) |
| Commits reviewed | `1b312a220..68765f1ae` (3 commits: 코드 `19948b1f5`, wave11c 리뷰 파일 `06bd8d7a4`, 요청서 `68765f1ae`) |
| Report | ../report/google-drive-wave11d-nightly-cap-20261001-0830-report.md |
| Reviewed | 2026-10-01 |

## Verdict

**NOT BLOCKED.** 요청서가 가장 크게 물은 두 가지 — 상한 술어와 생성 SQL 결정 — 는 둘 다 코드와 실행으로 확인했다.
상한 술어는 `(google_drive_album.userId, album_asset.assetId)` 에만 상관되어 앨범 축이 없으므로, 같은 자산이 여러 앨범에
있어도 다른 앨범을 통해 빠져나갈 수 없다(아래 §1). 생성 SQL 은 **완전히 마이그레이션된 일회용 Postgres 에 실제 생성기
(`dist/bin/sync-sql.js`)를 돌려** 커밋된 `google.drive.repository.sql` 과 바이트 단위로 같음을 확인했다 — 요청서가 버린 두
삭제 hunk 는 실제로 환경 artifact 였고, 적용한 hunk 는 마이그레이션된 DB 가 만드는 것과 동일하다. 리포트의 변이 중 세 개를
재현했고(리스너 제거, 게이트 `|| true`, 그리고 리포트에 없던 **`assetId` 상관 제거**) 모두 빨간불이었다. 실제
`googleapis` 라이브러리에 fs 스트림을 물려 EIO 파기·지연 open ENOENT 를 흘려 보냈을 때 프로세스가 죽지 않고 1 ms 안에
AbortError 로 거부되는 것도 확인했다(리포트의 "not verified" 첫 항목). 가장 중요한 문제는 N1 이다: `upsertError` 가 클래스
변경과 무관하게 `attempts` 를 올리므로 RateLimited 로 보낸 밤들이 상한에 계산된다 — R2 가 요청 내 재시도를 껐으니 큰
backlog 에서 429 가 같은 자산에 여러 밤 반복되는 것은 그럴듯하고, 그 뒤 단 한 번의 5xx 가 자산을 즉시 상한에 걸리게 한다.
데이터 손실은 아니고 "retry failed" 로 돌아올 수 있으므로 Low 로 둔다.

### Evidence I ran myself

리뷰 시작 시 작업 트리가 다음 라운드로 이동할 수 있어 `68765f1ae` 를 스크래치패드에 `git worktree add --detach` 로 따로
체크아웃하고 `node_modules` 를 심링크해 거기서 돌렸다. 변이는 모두 워크트리 사본에 적용 → 실행 → `cmp` 로 원복 확인.

| Check | Result |
|---|---|
| `git show 19948b1f5 --stat` | 11 files, +462/−33 — 리포트 표의 파일 목록과 일치 |
| 워크트리 `vitest` 4 스펙 (`google-drive.service` / `queue.service` / `utils/google-drive` / `utils/misc`) | **205 passed** (126 / 20 / 33 / 26) |
| 워크트리 `tsc --noEmit -p tsconfig.json` | exit 0 |
| 워크트리 `eslint` 변경 10파일 `--max-warnings 0` | exit 0 |
| 워크트리 medium `google-drive.repository.spec.ts` (testcontainers Postgres, `IMMICH_TEST_POSTGRES_URL` 은 run.sh 와 같은 파생) | **72 passed** — 리포트와 일치 |
| `dev-test/google-drive/results/20261001-0825.txt` | server 328/328, web 87/87, medium 72/72, `RESULT: PASS`, 헤더 dirty 목록 = 리포트 표와 일치 |
| 변이 A — `google-drive.service.ts:1354-1357` 리스너 블록 삭제 | red 1: "turn a read error on the file stream into a recorded failure, not a crash" (`expected [Function] to not throw … 'Error: EIO' was thrown`) |
| 변이 B — `queue.service.ts:305` 게이트에 `\|\| true` | red 2: "should run the scheduled jobs", "should not queue … when the feature is not usable" (리포트와 동일) |
| 변이 D — `google-drive.repository.ts:641` `assetId` 상관(`whereRef … album_asset.assetId`) 삭제 (**리포트에 없던 변이**) | red 2: "keep an asset below the cap and drop one at the cap", "cap every capped class, and never RateLimited" — 상한이 사용자 단위로 번져 below-cap 자산이 사라진다 |
| **실제 생성기**: 일회용 `ghcr.io/immich-app/postgres:14-vectorchord0.4.3` 컨테이너에 `DatabaseRepository.runMigrations()` (마지막 `1787200000000-AddGoogleDriveConnectionId` 성공) → 워크트리 `nest build` → `node dist/bin/sync-sql.js` | `Wrote 52 files / Generated 428 queries`; **`git status` 에 `server/src/queries/` 변경 0** — `google.drive.repository.sql` 뿐 아니라 디렉토리 전체가 커밋본과 동일 |
| 요청서 작성자의 생성기 로그 (스크래치패드 `sql.log`, 07:21) | `streamPendingUploads error: column google_drive_upload.driveAccountId does not exist` 등 GoogleDrive 메서드 14개가 실패 — 생성기는 오류 시에도 SQL 을 기록하므로(`sync-sql.ts:87-90`) hunk 텍스트는 유효했고, `setDriveAccountId`·`getErrorSummary` 의 둘째 쿼리만 사라진 것이 로그와 맞는다 |
| **프로브** (`probe3.js`, 실제 `googleapis` → 로컬 HTTP 서버, 20 MB 파일, 서비스와 같은 리스너) A: 256 KB 진행 후 `fs.ReadStream.destroy(EIO)` | `uncaughtException` 없음, 리스너 1회, `files.create` 는 소스 오류 **1 ms** 뒤 `The user aborted a request.` 로 거부 |
| 프로브 B: `createReadStream('/does-not-exist')` 지연 open ENOENT, 리스너를 `files.create` 전에 부착 | crash 없음, 0 ms 뒤 abort 거부, 서버 수신 0 바이트 |
| 프로브 C: 서버가 본문 수신 전에 403 (`storageQuotaExceeded`) 응답 | 소스 스트림 `'error'` **0회** — Drive 오류 뒤에 라이브러리가 소스 오류를 유발하지는 않는다 (§4 참조) |
| `git status --porcelain` (리뷰 파일 작성·정리 후) | 아래 "What I did not verify" 끝에 기록 |

## Findings

### N1 — `attempts` 는 클래스를 넘어 누적되므로 RateLimited 밤들이 상한에 계산된다 (Low, 요청서 item 3)

`google-drive.repository.ts:849-860` 의 upsert 는 `"attempts" = "google_drive_upload_error"."attempts" + 1` 을 클래스 변경과
무관하게 실행한다. 상한 술어(`:636-646`)는 **현재** 클래스가 capped 이고 `attempts >= 5` 인지만 본다. 따라서:

- 4밤 RateLimited → 1회 Unknown(5xx) ⇒ `attempts = 5`, `error = unknown` ⇒ 즉시 상한. "낫지 않는 자산"이라는 증거는 단
  한 번뿐이다. R2 가 요청 내 재시도를 껐으므로 큰 backlog 의 야간 실행에서 같은 자산이 여러 밤 429 를 받는 것은 그럴듯하다.
- 반대 방향도 한 밤 샌다: 상한에 걸린 Unknown(5) 자산을 수동 동기화가 보내 RateLimited 로 실패 ⇒ `attempts = 6`,
  `error = rate_limited` ⇒ 상한 밖 ⇒ 다음 밤 다시 큐 ⇒ Unknown 으로 실패 ⇒ 7, 다시 상한.

`enum.ts:1230-1232` 의 주석("Counted across every attempt (nightly, manual sync, add-to-album)")은 경로 간 누적만 말하고
클래스 간 누적은 말하지 않는다. 결과는 조기 포기이지 손실이 아니고, 설정 화면의 failed 목록 + "retry failed" 로 돌아올 수
있으므로 Low. 제안(둘 중 하나, 작성자 결정):

1. **capped 클래스로 기록될 때만 증가**: `"attempts" = case when excluded."error" in (<capped>) then
   "google_drive_upload_error"."attempts" + 1 else "google_drive_upload_error"."attempts" end`. Unknown↔SourceUnreadable 처럼
   capped 끼리 오가는 자산은 여전히 상한에 걸리고, RateLimited 밤은 세지 않는다. F7 로그(`priorAttempts`)의 의미도
   "낫지 않는 실패 N회 뒤 성공"으로 더 정확해진다. medium `recordUpload` 테스트에 RateLimited 2회 → Unknown 1회 → `priorAttempts: 1`
   을 추가하면 고정된다.
2. 그대로 두고 `enum.ts` 주석과 `stabilization-plan.md` 에 "클래스 간 누적이며, RateLimited 밤도 센다 — 의도적"을 적는다.

### N2 — V6 의 "수동 동기화 후 재포함" 은 구현과 어긋난 문장이다 (Nit, 문서)

커밋 메시지와 `enum.ts:1231-1233`, `stabilization-plan.md:157`("Cap escape hatch corrected: the design review said manual
sync clears error rows. It does not") 은 수동 동기화가 행을 지우지 **않는다**고 바로잡았다. 그런데 같은 플랜의 V6 행
(`stabilization-plan.md:91` "after manual sync clears the row the asset is re-included") 과 F3 행(`:48` "manual album sync
clears rows"), 그리고 `CLAUDE.md:716` V6("수동 동기화 후 재포함")는 옛 문장 그대로다. 실제 테스트는 `clearErrorsForAssets`
(retry-failed 경로)로 재포함을 확인한다(medium spec `:264-285`). 수동 동기화 뒤 실제로 일어나는 일은 "성공하면 행 삭제로
pending 에서 빠짐, 실패하면 `attempts` 가 올라 계속 상한"이지 재포함이 아니다. V6 와 F3 의 문장을 "retry failed 가 행을
지운 뒤 재포함"으로 고친다.

### N3 — `sourceError` 우선 분류는 Drive 오류와 디스크 오류가 겹칠 때만 틀린다 (Nit, 요청서 item 4)

`google-drive.service.ts:1497-1499` 는 `sourceError` 가 있으면 `classifyDriveError` 를 건너뛴다. 프로브 C 가 보여주듯
gaxios/node-fetch 는 Drive 응답 뒤에 소스 스트림 `'error'` 를 유발하지 않고, `finally` 의 `destroy()` 는 인자가 없어
`'error'` 를 내지 않는다. 그러므로 가려지려면 같은 요청 안에서 **독립적인** 디스크 오류와 Drive 오류가 동시에 나야 한다.
그 경우 quota 같은 계정 차단 클래스가 한 자산에서 `source_unreadable` 로 기록되지만, 다음 자산이 바로 차단을 기록한다.
원하면 `sourceError && getStatus(error) === undefined` 로 좁힐 수 있다 — 필수는 아니다.

### N4 — errno 접미사는 한 경로 형태에서만 고정된다 (Nit, 테스트)

`describePaths` (`utils/google-drive.ts:47-59`) 는 단일 경로와 "moved from" 두 형태 모두에 `[code]` 를 붙이지만, 스펙이
정확한 문자열로 고정하는 것은 단일 경로 `Could not read … [EMFILE]` (`google-drive.service.spec.ts:578`) 과 mid-upload
`[EIO]` (`:1008`) 뿐이다. V1c(두 경로) 테스트의 기대값에 `[ENOENT]` 를 넣으면 두 분기가 다 고정된다. `utils/google-drive.spec.ts`
는 이 커밋에서 바뀌지 않았다.

### N5 — 상한에 걸린 자산은 `pending` 에 계속 남는다 — 배포 체크리스트에 적어둘 것 (Nit, 운영 문서)

`countPendingUploads` 는 의도적으로 바꾸지 않았다(커밋 메시지, `:526-534` 의 "same predicate" 주석은 상한 이전 기준).
그래서 상한에 걸린 자산이 있는 사용자의 진행 카드 대기 수는 0 으로 내려가지 않는다. `CLAUDE.md` §7 배포 직후 8번("진행
카드의 대기 수를 한 번 본다 — `''` 매칭이 회귀했다면 6,996 근처")은 여전히 유효하지만, 이제 "작은 숫자가 영구히 남는다"가
정상 상태 하나를 더 가진다: `pending = 진짜 대기 + capped`. 설정 화면의 failed 목록이 그 차이를 보여주므로 UI 변경은
필요 없고, §7 과 플랜의 관찰 단계에 한 줄이면 된다.

## Answers to what the report asked me to attack

### 1. 상한 술어 — 상관과 DISTINCT

`google-drive.repository.ts:636-646`: 서브쿼리는 `google_drive_upload_error.userId = google_drive_album.userId`(선택자)와
`google_drive_upload_error.assetId = album_asset.assetId` 에 상관된다. 바깥 쿼리의 한 행은 (album_asset × google_drive_album
× album_user × user_google_drive) 이지만, `NOT EXISTS` 의 값은 **(선택자, 자산) 두 값만의 함수**라 앨범이 바뀌어도 같은
값을 낸다. `google_drive_upload_error` 의 PK 가 `(userId, assetId)` 이므로 행은 하나이고, `IN (capped)` 는 그 행의 현재
클래스만 본다. 따라서 상한에 걸린 (선택자, 자산)은 그 사용자가 선택한 모든 앨범 행에서 똑같이 제외되고, `DISTINCT` 는
남은 행만 접는다 — 다른 앨범을 통한 우회는 구조상 불가능하다. 상관이 `album_asset` 소유자가 아니라 선택자인 것은 medium
"one user's capped failure … another user" 가 고정하고(소유자의 상한이 게스트를 가리지 않음), `assetId` 상관은 내 변이 D 가
고정한다(제거하면 사용자 단위 상한이 되어 두 테스트가 빨간불). 생성 SQL (`google.drive.repository.sql:317-327`) 도 같은
두 상관을 담는다.

### 2. `streamPendingUploads` 의 다른 독자

- `retryFailures(auth, assetIds)` (`service.ts:999-1028`): 비어 있지 않으면 `clearErrorsForAssets` 로 **그 자산만** 지우고
  `queuePendingUploads(userId)` 로 사용자의 전체 pending 을 큐잉한다. 지우지 않은 다른 capped 자산은 여전히 제외된다 —
  맞다: 특정 실패를 고른 사용자가 나머지 포기된 자산까지 되살리길 기대하지 않는다.
- `retryFailures(auth, [])` ("retry all failed"): `clearErrors(userId, 모든 클래스 − Revoked)` (`:1017-1020`) 이 capped 행을
  포함해 전부 지우므로 상한 자산이 복귀한다. medium "stream a capped asset again once its failure is cleared" 가 행 삭제 →
  재포함을 고정한다(단, `clearErrorsForAssets` 경로로 — 전체 삭제 경로는 같은 테이블 삭제라 별도 테스트 없이 읽어서 확인).
- `resumeUploads` (`:1903-1911`): 차단 클래스만 지우므로 capped 자산은 그대로 제외 — "resume = 계정 차단 해제"이지
  "포기한 자산 재시도"가 아니다. 일관된다.

### 3. `attempts` 의미

위 N1. 클래스 간 누적은 받아들일 수 있는 수준이지만 상한의 목적("낫지 않는 실패를 멈춘다")과 어긋나므로, capped 클래스로
기록될 때만 세는 한 줄 변경을 권한다. 결정은 작성자 몫이고 어느 쪽이든 문서화는 필요하다.

### 4. 스트림 `'error'` 리스너

- **부착 시점**: `openOriginal` 의 `await` (`service.ts:1283`) 가 돌아온 뒤 리스너(`:1354`)까지 `await` 가 하나도 없다
  (`folderId`·`fileMetadata`·`media`·`AbortController`·`armStallTimer` 전부 동기). `fs.ReadStream` 의 지연 open 은
  `process.nextTick` 에서 `fs.open` 을 **시작**하고 그 결과(ENOENT/EMFILE)는 libuv 콜백, 즉 매크로태스크로 오므로
  마이크로태스크 체인인 `await` 연속 뒤의 동기 코드가 먼저 실행된다. 프로브 B 가 이를 실증한다(지연 open ENOENT 가
  리스너에 잡혀 0 ms 뒤 abort 거부).
- **`.pipe()` 전에 오는 오류**: 리스너가 먼저 `stall.abort()` 를 부르면 `files.create` 가 시작 시점에 abort 된 signal 을
  보고 거부한다 — 프로브 B 의 서버 수신 0 바이트가 그 경로다.
- **mid-pipe**: 프로브 A — 실제 `googleapis-common` 멀티파트 파이프 안에서 `destroy(EIO)` → 리스너 1회 → 1 ms 뒤 거부,
  `uncaughtException` 없음. 리포트가 "EventEmitter stand-in 으로만 증명"이라 적은 항목이 실제 라이브러리에서도 성립한다.
- **Drive 오류를 가리는가**: 프로브 C — Drive 응답 뒤 라이브러리는 소스 `'error'` 를 내지 않는다. 겹치려면 독립적인 디스크
  오류가 같은 요청 안에 있어야 한다(N3).

### 5. 야간 게이트 vs 핸들러

`queue.service.ts:268` 은 `getConfig({ withCache: false })`, `handleGoogleDriveUploadQueueAll` 은 `isEnabled()` →
`getConfig({ withCache: true })` (`service.ts:182-185`). 둘 다 같은 `isGoogleDriveEnabled(googleDrive, server)`
(`utils/misc.ts:151-152`) 를 같은 DB row + env 에서 평가하므로 어긋나는 경우는 설정 변경 직후 캐시 창뿐이다. 게이트 참 →
핸들러 거짓이면 `JobStatus.Skipped` 한 번(무해), 게이트 거짓이면 핸들러가 불리지 않는다. 해로운 조합은 없다.

### 6. Dedup id

`queue.service.ts:249` 의 수동 start 는 `jobRepository.queue({ name: GoogleDriveUploadQueueAll, data: { force } })` →
`job.repository.ts:230-232` `queue()` 는 `queueAll([item])` → `:210` `getJobOptions(item)` → `:306-308` 의 새 case →
`:213-215` `deduplication` 이 있으면 `addBulk` 대신 `add()`. 야간 경로(`queueAll(jobs)`)도 같은 함수를 지난다. 따라서
두 경로 모두 id 를 받는다 — 읽기로 확인, 테스트 없음(리포트 인정). BullMQ `5.80.5` 의 `DeduplicationOptions` 는 `ttl`
없는 단순 모드이고, 같은 패턴을 `FacialRecognitionQueueAll`·`VersionCheck`·`DatabaseBackup` 이 이미 쓴다. 단순 모드에서
키가 정확히 어느 상태 전이에서 제거되는지는 lua 까지 추적하지 않았다(아래 미검증).

### 생성 SQL 결정

맞는 결정이고, 적용한 hunk 는 바이트 단위로 같다. 근거는 위 Evidence 표 — 마이그레이션된 일회용 DB 에 실제 생성기를
돌린 결과 `server/src/queries/` 전체에 diff 가 없다. 요청서 작성자의 생성기 로그는 `getErrorSummary` 와 `setDriveAccountId`
의 **첫** 쿼리가 `driveAccountId`/`connectionId` 컬럼 부재로 실패했음을 보여주고(`sql.log:19,29`), 생성기는 메서드가
throw 하면 그 뒤 쿼리를 실행하지 못하므로 둘째 쿼리(`setDriveAccountId` 의 trailing select, `getErrorSummary` 가 순차
호출하는 `getBlockingError` 의 select)가 빠진 것이다. 둘 다 적용했다면 회귀였다.

## What I did not verify

- BullMQ 단순 모드 dedup 키가 제거되는 정확한 전이(완료/실패 시점)는 lua 를 추적하지 않았다. 업스트림이 같은 옵션을 네
  QueueAll 잡에 쓰고 있으므로 동작은 업스트림과 동일하다는 선에서 멈췄다.
- 야간 cron 이 실제 운영 컨테이너에서 어느 워커(api/microservices)에 등록되는지, 그리고 `nightlyTasks.startTime` 에 실제로
  `GoogleDriveUploadQueueAll` 이 큐잉되는지는 운영에서만 볼 수 있다 — 플랜의 "배포 후 며칠 관찰" 그대로.
- "retry all failed" 가 capped 자산을 복귀시키는 것은 `clearErrors(모든 클래스 − Revoked)` 를 읽어 확인했을 뿐, 그 경로의
  medium 테스트는 없다(`clearErrorsForAssets` 경로만 있다).
- 프로브는 로컬 HTTP 서버 상대이고 토큰 갱신(N1 known gap)은 끼어들지 않았다.
- 웹·모바일은 이 범위에 변경이 없어 보지 않았다. `mise.lock` 의 dirty 는 리뷰 이전부터 있던 것이다.
- 정리: 스크래치 워크트리는 `git worktree remove` 로, 일회용 Postgres 컨테이너 `review-pg-wave11d` 는 `docker rm -f` 로
  지웠다. 작성 후 `git status --porcelain` 은 ` M mise.lock`(기존), ` M CLAUDE.md`, ` M dev-docs/google-drive/stabilization-plan.md`,
  그리고 이 리뷰 파일(`??`) 네 줄이었다. **앞의 두 수정은 내 것이 아니다** — mtime 이 둘 다 `2026-10-01 08:30` 으로 리뷰 시작 전이고
  내용은 작성자 세션의 V11 문구 수정과 플랜 R3 반영(`+8/−2`)이다(요청서 Test evidence 의 dirty 목록과 같은 파일). 이 세션이 만든
  변경은 이 리뷰 파일 하나뿐이다.

## Feeding back into the plan

- V6 / F3 문장 수정(N2): 상한의 복귀 경로는 "retry failed"(행 삭제)와 "성공"(행 삭제)뿐이고 수동 동기화는 행을 건드리지
  않는다. `CLAUDE.md:716` 도 같이.
- `attempts` 의 클래스 간 누적(N1)을 결정으로 적는다 — 바꾸든 두든. 바꾸면 medium `recordUpload` 테스트에 RateLimited →
  Unknown 시나리오를 더한다.
- 관찰 단계에 "`pending` 은 capped 를 포함하므로 0 이 목표가 아니다"(N5)를 적고, F7 로그(`after N failed attempt(s)`) 와
  failed 목록으로 상한에 걸린 자산 수를 세는 명령을 둔다.
- 생성 SQL 재생성은 **마이그레이션된 DB** 가 필요하다는 것을 §3 생성물 절에 적는다. 이번처럼 dev DB 가 낡아 있으면
  hunk 를 골라 적용해야 하는데, 그보다 testcontainers 로 일회용 DB 를 띄워 돌리는 편이 안전하다(이 리뷰의 절차:
  `ghcr.io/immich-app/postgres:14-vectorchord0.4.3` 컨테이너 → `runMigrations()` → `node dist/bin/sync-sql.js`).
- 실제 라이브러리 프로브 결과(A/B/C)를 플랜의 "검증하지 않는 것" 목록에서 지우고 수치를 남긴다: 소스 오류 → 1 ms 거부,
  지연 open → 0 ms, Drive 오류 뒤 소스 `'error'` 0회.
