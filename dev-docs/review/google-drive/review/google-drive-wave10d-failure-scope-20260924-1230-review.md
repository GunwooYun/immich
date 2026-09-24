# Code Review — wave10d: 실패 목록·카운트를 "아직 손댈 수 있는 앨범"으로 한정 (`58039033a`) — 배포 게이트

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `053b2810d` (`feat/google-drive-album-sync-v3.1.0`) |
| Commits reviewed | `58039033a` (fix), `df8628ba0` (evidence), `053b2810d` (리포트) — `git diff 1934bf56b HEAD -- server` (4 files, +232/−28). 배포 판정은 운영 이미지 `3cabbb496..HEAD` 전체(소스 8 files, +184/−25) |
| Report | `../report/google-drive-wave10d-failure-scope-20260924-1230-report.md` |
| Reviewed | 2026-09-24 11:30 +0900 (모든 수치는 이 워크트리 HEAD에서 직접 돌린 것) |

## Verdict

**판정: NOT BLOCKED — 운영 랩탑에 배포해도 된다.** 변경은 리포트가 말한 그대로다: `getErrorSummary`(`google-drive.repository.ts:925-940`)와
`getFailures`(`:987-1002`)에 **같은** `exists` 술어가 들어갔고, 술어는 `album_asset.assetId = error.assetId`(`:936`/`:998`)와
`google_drive_album.userId = error.userId`(`:937`/`:999`)로 상관되며 `album_user.userId = google_drive_album.userId`(`:933`/`:995`)로 읽는 사람
본인의 멤버십을 요구한다 — **다른 사용자의 선택으로는 매칭되지 않는다**(프로브 P1, 실 DB에서 0행). 리포트의 두 변이(각 쿼리에서 술어 제거)는
내가 다시 돌렸을 때 **정확히 새 medium 테스트 2개만** 죽였고(65 → 2 failed / 63 passed), DummyDriver로 컴파일한 두 SQL 블록은 커밋된
`src/queries/google.drive.repository.sql`과 **공백 한 줄을 빼고** 바이트 동일하다(`getErrorSummary` 블록의 두 문장도 순서대로 있다).

배포 관점에서 중요한 사실 세 가지: (1) 운영 이미지 `3cabbb496` 이후의 소스 변경은 **읽기 경로**(설정 화면의 실패 목록·카운트, 소유자 이름)뿐이다 —
워커(`handleUpload`), 큐 생산자, 입양(adoption), 원장 쓰기, 스키마·마이그레이션 어디에도 손대지 않았다. (2) 운영 인스턴스는 지금 실패 행이 0이라
새 술어는 배포 직후 관측 가능한 효과가 없다 — 8,180 원장 행은 이 변경이 읽지도 쓰지도 않는다. (3) 자격증명은 저장된 설정 row에서 오고 이 변경은
설정 코드를 건드리지 않는다. `git merge-base --is-ancestor v3.1.0 HEAD`도 참이다.

가장 중요한 문제는 **코드가 아니라 테스트 커버리지**다: 술어의 사용자 상관(`:937`/`:999`)을 지워도 65/65가 통과한다(변이 C). 코드는 맞지만 그 사실을
고정하는 테스트가 없다 — 리포트의 공격 항목 1이 묻는 바로 그 지점이다. 임시 프로브로 그 변이가 실제로 **다른 사용자의 선택을 통해 행을 누출**하는
것을 확인했다(N2). 배포 차단 사유는 아니다.

### Evidence I ran myself

`server/node_modules`·`web/node_modules`는 이전 라운드 것을 그대로 썼다(sql-formatter 15.8.2, 메인 워크트리와 동일). medium 스위트는
testcontainers가 자체 Postgres를 띄운다 — 호스트의 `immich_postgres`(dev DB)는 읽기 조회(카운트, `\d`)만 했고, 그 DB는 이 브랜치의
마이그레이션이 적용돼 있지 않아(`google_drive_upload.driveAccountId` 없음) EXPLAIN은 testcontainer 안에서 돌렸다. 변이·프로브는 전부
`git checkout` 후 `cmp`로 원본과 바이트 동일함을 확인했고, 임시 스펙 파일 2개(`src/repositories/zz-review-sql.spec.ts`,
`test/medium/specs/repositories/zz-review-probe.spec.ts`)는 삭제했다.

| Check | Result |
|---|---|
| `git status --porcelain` (리뷰 파일 쓰기 전) | 빈 출력 |
| `git diff 1934bf56b HEAD --stat -- server` | 4 files: `dto.ts`(+1/−1), `queries/*.sql`(+29), `repository.ts`(+79/−23), medium spec(+129/−1) |
| `git diff 3cabbb496 HEAD --stat -- server/src web/src i18n` | 8 files — `server/src/schema/**` 없음, `job.repository.ts`·`queue.service.ts`·`utils/google-drive.ts` 없음 |
| `git merge-base --is-ancestor v3.1.0 HEAD` | 참 |
| `cd server && npx vitest run --config test/vitest.config.mjs src/services/google-drive.service.spec.ts` | **112 passed** |
| `cd server && npx vitest run --config test/vitest.config.medium.mjs test/medium/specs/repositories/google-drive.repository.spec.ts` | **65 passed** (리포트의 65와 일치) |
| `cd web && npx vitest run "src/routes/(user)/user-settings/GoogleDriveSettings.spec.ts"` | **15 passed** |
| `cd server && npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx eslint` — `repository.ts`, `dto.ts`, medium spec, `--max-warnings 0` | clean |
| `cd server && npx vitest run --config test/vitest.config.mjs` (전체) | **2442 passed / 2 skipped** (94 files) — 리포트의 `mise //server:ci-unit` 2442 / 2 skipped와 일치 |
| `cd web && npx vitest run` (전체) | **603 passed / 2 skipped** (60 files + 1 skipped) — 리포트의 603 / 2 skipped와 일치 |
| `dev-test/google-drive/results/20260924-1112.txt` | `commit: 58039033a`, server 316 / web 87 / medium 65, `RESULT: PASS` — 리포트 인용과 일치 |
| **변이 A** `getErrorSummary` 술어(`:925-940`) 삭제 → medium | **2 failed / 63 passed** — `…once its album is unselected`, `…no longer shared with the reader` |
| **변이 B** `getFailures` 술어(`:987-1002`) 삭제 → medium | **2 failed / 63 passed** — 같은 두 테스트 |
| **변이 C** `whereRef('google_drive_album.userId', '=', 'google_drive_upload_error.userId')`(`:937`, `:999`) 삭제 → medium | **65 passed** — 고정하는 테스트 없음 |
| **변이 D** `album_user` 조인(`:930-934`, `:992-996`) 삭제 → medium | **1 failed / 64 passed** — `…no longer shared with the reader` |
| **변이 E** `.where('album.deletedAt', 'is', null)`(`:938`, `:1000`) 삭제 → medium | **65 passed** — 고정하는 테스트 없음 |
| **프로브 P1** 다른 사용자가 소유·선택한 앨범에 든 내 자산의 실패 행, 나는 비멤버·미선택 | 원본: `getFailures` 0행, `failedCount` 0 · 목격자(내가 멤버+선택 추가) 1/1 · **변이 C: 1행 / 1** (누출 재현) |
| **프로브 P2** 선택한 내 앨범을 `album.deletedAt` 세팅 | 원본: 0행 / 0 (세팅 전 1행) · **변이 E: 1행 / 1** |
| **프로브 P3** testcontainer Postgres에서 count 쿼리 `EXPLAIN (costs off)` | `exists`가 **semi-join으로 풀림** — `HashAggregate(google_drive_album ⋈ album_user by userId → album_asset by albumId_idx → album pkey)` → `google_drive_upload_error_pkey` Index Only Scan → `asset` → `google_drive_upload_pkey` Anti Join |
| **SQL 재현** DummyDriver + `PostgresQueryCompiler` + `log` 콜백 + `format(sql, { language: 'postgresql' })` (= `bin/sync-sql.ts:37`), `getErrorSummary(UUID)` → `getFailures(UUID, 100)` | `diff` 결과 **단 한 줄**: 커밋본 `google.drive.repository.sql:509`의 빈 줄이 컴파일본에는 없음 (N1). 나머지 107줄 동일 |
| `git status --porcelain` (리뷰 파일 쓴 뒤) | `?? dev-docs/review/google-drive/review/google-drive-wave10d-failure-scope-20260924-1230-review.md` 한 줄 |

## Findings

### N1 — 생성 SQL 파일에 생성기가 만들지 않는 빈 줄이 하나 있다 (nit, 런타임 영향 없음)

- **증거**: `src/queries/google.drive.repository.sql:509`는 `getErrorSummary` 블록 안, `exists(...)`의 `)`와 두 번째 문장 `select "error"` 사이의
  빈 줄이다. `git show 58039033a -- server/src/queries/google.drive.repository.sql`에서 이 줄은 맨몸 `+`로 추가됐고(변경 전에는 `is null` 다음
  줄이 바로 `select`였다), 저장소의 **모든** `src/queries/*.sql`을 훑어도 `-- ` 헤더 앞이 아닌 빈 줄은 이 한 곳뿐이다. 같은 `sql-formatter`
  15.8.2로 `bin/sync-sql.ts:37`과 같은 호출을 재현한 컴파일본에는 이 줄이 없다(`runTargets`는 문장들을 `'\n'`으로 잇는다, `:167`).
  즉 이 파일은 `mise //:sql` 출력이 아니라 손으로 다듬어진 상태다.
- **영향**: 없음 — 이 파일은 참조용이고 런타임이 읽지 않는다. 다만 리포트가 "src/queries가 바뀌었으니 확인하라"고 한 만큼, "생성물"이라는 전제가
  한 줄 어긋난다는 것은 적어 둔다.
- **수정**: 다음 `mise //:sql` 실행이 지운다. 그 전에 손으로 지워도 된다(`:509` 한 줄).

### N2 — 술어의 사용자 상관을 고정하는 테스트가 없다 (medium-low, 배포 차단 아님)

- **증거**: 변이 C(`:937`·`:999`의 `whereRef('google_drive_album.userId', '=', 'google_drive_upload_error.userId')` 삭제)가 65/65를 통과한다.
  프로브 P1이 그 변이가 이론이 아님을 보인다 — 다른 사용자 B가 소유·선택한 앨범에 A의 자산이 들어 있고 A는 비멤버·미선택일 때, 변이본은 A의
  실패 행을 **1행 / count 1**로 돌려준다(원본은 0/0). 새 medium 테스트 두 개(`spec:1328`, `:1369`)는 둘 다 "같은 사용자의 두 앨범" 모양이라
  다른 사용자의 선택이 존재하지 않고, `should list exactly the failures it counts`(`:1077`)의 `other`는 **자기 자산**에 자기 선택을 갖고 있어
  외부 `userId` 필터(`:917`/`:983`)가 먼저 걸러 버린다.
- **왜 지금은 차단이 아닌가**: 코드는 맞다(P1 원본 0/0). 운영에는 Drive 사용자가 한 명뿐이라 "다른 사용자의 선택"이 존재하지 않는다.
- **수정**: medium 테스트 하나 — P1 그대로. `ctx.newAlbum({ ownerId: other.id }, [readerAsset.id])` + `other`의 `google_drive_album` 행 +
  `upsertError(reader.id, readerAsset.id, …)` → `getFailures(reader.id)`·`getErrorSummary(reader.id)` 둘 다 0을 단언하고, 목격자로 reader를
  `newAlbumUser` + 선택 추가한 뒤 1을 단언한다. 이름은 `should not surface a failure through another user's selection` 정도.

### N3 — `album.deletedAt is null`을 고정하는 테스트가 없다 (low)

- **증거**: 변이 E(`:938`·`:1000`을 `,`로 치환)가 65/65를 통과한다. 프로브 P2: 선택한 앨범에 `deletedAt`을 세우면 원본은 0/0, 변이본은 1/1.
- **언제 실재하는가**: 앨범 삭제 자체는 hard delete라(`album.service.ts:170` → `albumRepository.delete`) `album_asset` CASCADE로 `exists`가
  저절로 비고 이 필터가 없어도 된다. 이 필터가 실제로 일하는 경로는 **호스트 계정 삭제**다 — `user-admin.service.ts:105`의 `softDeleteAll`은
  `album.deletedAt`만 세우고 `album_asset`·`album_user`·`google_drive_album`을 남긴다(같은 파일 `:676-683`의 워커 게이트 주석이 정확히 이 경우를
  설명한다). 즉 게스트가 호스트의 앨범을 선택해 두었고 호스트가 삭제된 상태.
- **수정**: N2와 같은 파일에 한 테스트 — `selectedSharedAlbum(ctx, owner.id, guest.id, [asset.id])` 후 `updateTable('album').set({ deletedAt })`,
  guest의 목록·카운트 0 단언(목격자는 세팅 전 1).

### N4 — `failedCount = 0`인데 `blockedReason`은 남는 상태가 생긴다 (nit, 문서화만)

- **증거**: `getBlockingError`(`:841-853`)와 `hasErrorOfClass`(`:861-870`)에는 새 술어가 없다. 그래서 `quota_exceeded`/`folder_missing` 행의
  자산이 선택 해제·공유 해제로 범위 밖이 되면 설정 화면은 배너(`GoogleDriveSettings.svelte:365-392`)는 띄우고 "N failed"(`:393`)는 숨긴다.
  `streamPendingUploads`의 `not exists` 차단(`:611-618`)도 술어가 없어 그 사용자는 여전히 큐에서 제외된다.
- **판단**: 이게 맞다 — 계정 단위 차단은 자산이 아니라 계정의 상태이고, wave10c 리뷰 M1 주의 문단도 그렇게 적었다. "Resume"(`clearErrors`,
  `:880`)가 class 단위로 지우므로 해소 경로도 살아 있다. 다만 `clearErrors`가 **숨은 행까지** 지운다는 점은 커밋 메시지의 "hiding, not
  deleting"과 반 걸음 어긋난다 — "retry all"이 "실패 기록을 잊는다"는 뜻이면 괜찮고, 그렇게 적어 두면 된다.
- **수정**: 코드 변경 없음. `failure-handling-plan.md`에 "배너와 카운트는 다른 술어를 쓴다 — 배너는 계정, 카운트는 손댈 수 있는 자산"을 한 줄
  남긴다(아래 Feeding back 1).

## Answers to what the report asked me to attack

### 1. 술어가 맞는 컬럼으로 상관되는가? 다른 사용자의 선택을 통해 매칭될 수 있는가?

**맞는 컬럼이고, 다른 사용자로는 매칭되지 않는다.** 술어를 컬럼 단위로 읽으면(`:926-938`, `getFailures`는 `:988-1000` 동일):

| 조인/조건 | 줄 | 의미 |
|---|---|---|
| `album_asset.assetId = google_drive_upload_error.assetId` | `:936` / `:998` | 실패한 **그 자산**이 든 앨범만 |
| `google_drive_album.userId = google_drive_upload_error.userId` | `:937` / `:999` | 선택의 주인이 **실패 행의 주인**(= 외부 `userId` 필터의 읽는 사람) |
| `album_user.userId = google_drive_album.userId` | `:933` / `:995` | 그 선택자가 **지금도 멤버** |
| `album_user.albumId = album.id`, `google_drive_album.albumId = album.id` | `:932`, `:929` | 셋이 같은 앨범 |
| `album.deletedAt is null` | `:938` / `:1000` | 앨범이 살아 있음 |

다른 사용자 B의 선택 행은 `google_drive_album.userId = B`인데 `:937`이 `= error.userId = A`를 요구하므로 조인에서 떨어진다. B가 멤버인 것도
`:933`이 `album_user.userId = google_drive_album.userId`로 **선택자 본인**의 멤버십을 요구하므로 A를 대신하지 못한다. 실 DB 프로브 P1이 이를
확인했다(원본 0/0, 목격자 1/1). 한 가지 **의도된** 넓힘은 적어 둔다: 실패가 앨범 Y에서 났더라도 같은 자산이 A가 선택·멤버인 다른 앨범 X에도 들어
있으면 행은 보인다. 이것은 `streamPendingUploads`(`:582-620`)가 자산 단위로 재큐잉하는 것과 같은 기준이라 목록 = 카운트 = 재시도가 유지된다.

**단, 이 상관을 고정하는 테스트가 없다**(변이 C 65/65, N2). 코드는 맞지만 다음 사람이 `whereRef`를 `where(..., '=', userId)`로 "정리"하다 하나를
빠뜨려도 스위트가 모른다.

### 2. 비용 — 에러 행마다 상관 서브쿼리 두 개. 수백 건 실패 × 큰 앨범이면 조인으로 바꿔야 하나?

**그대로 둔다.** 세 가지 근거.

- **Postgres는 이 `exists`를 상관 루프로 돌리지 않는다.** 프로브 P3의 계획은 `exists`를 semi-join으로 풀어 **선택 쪽에서 출발**한다: 사용자의
  `google_drive_album`(`userId_idx`) ⋈ `album_user`(`userId_idx`) → `album_asset`(`albumId_idx`) → `album`(pkey, `deletedAt` 필터) 을
  `HashAggregate`로 모은 뒤 `google_drive_upload_error_pkey`를 **Index Only Scan**으로 찌른다. 통계가 빈 testcontainer의 계획이라 운영에서
  방향은 바뀔 수 있지만, 반대 방향(에러 행 → `album_asset_assetId_idx` → pkey 셋)도 행당 인덱스 프로브 몇 개다. 필요한 인덱스는 전부 있다
  (dev DB `\d`: `album_asset_assetId_idx`, `album_asset_albumId_idx`, `google_drive_album_pkey(userId, albumId)`, `album_user_pkey(albumId, userId)`).
- **규모**: 운영은 사용자 1, 선택 앨범 소수, 자산 ~8,180, 실패 0. 수백 건 실패라도 수백 × 로그 시간 프로브이고, 이미 있는 원장 anti-join
  (`ledgerMatches`의 `coalesce((select …))` InitPlan + `google_drive_upload_pkey` Anti Join)이 더 무거운 부분이다. 설정 화면 한 번에 두 쿼리
  (`service.ts:940-943`의 `Promise.all`)라 1초에 한 번 폴링해도 문제될 크기가 아니다.
- **조인으로 바꾸면 의미가 바뀐다.** 자산이 여러 선택 앨범에 들면 조인은 행을 불리고 `count(*)`가 틀어지므로 `DISTINCT`가 필요해지고
  (`countPendingUploads:548`이 그래서 `count(distinct …)`다), `getFailures`의 `limit`도 중복을 세게 된다. `exists`가 정확히 "하나라도 있으면"이라
  더 작다.

### 3. 선택 해제로 카운트가 떨어지는 것이 맞는 이야기인가? "더 이상 백업하지 않는 앨범의 실패 N건"을 따로 세어야 하나?

**권고: 지금 동작을 유지하고 별도 카운터는 만들지 않는다.**

- 그 숫자 옆에 있는 것은 **재시도 버튼**이다(`svelte:393-400`). 즉 `failedCount`는 "고장 난 것의 수"가 아니라 "누를 수 있는 것의 수"이고, 선택
  해제한 앨범의 실패는 눌러도 아무 일도 안 일어난다(`retryFailures` → `queuePendingUploads` → 선택 앨범만, `service.ts:995-998`). 세지 않는
  쪽이 정직하다.
- **선택 해제는 사용자 본인의 행동**이다. "그 앨범은 이제 안 올린다"고 한 사람에게 "그 앨범에서 3건 실패했었다"를 계속 보여 주는 것은 정보가 아니라
  잔소리다. 반대로 **공유 해제는 남이 한 일**이라 설명이 필요한데, 그건 이미 앨범 목록의 `accessLost`(`svelte:595`, `repository.ts:411-413`)가
  맡고 있다 — 실패 행이 사라지는 이유가 화면 어딘가에는 적혀 있다.
- **기록은 남는다**(`spec:1360-1367`이 이걸 단언한다). 다시 선택하면 시도 횟수와 함께 돌아온다. "잃어버린 것"이 아니라 "지금 관심 밖인 것"이다.
- 두 번째 카운터를 만들면 그 숫자에는 버튼이 없다. 할 수 있는 일이 "다시 선택"뿐인데 그 조작은 앨범 메뉴에 있다. 숫자 하나에 두 화면을 오가게
  하는 UI는 만들지 않는 편이 낫다.

한 가지 조건부 예외: 나중에 실패 목록에 앨범 이름을 싣게 되면(지금은 파일명·소유자만), 그때는 "이 앨범은 백업에서 빠졌음" 라벨을 **행에** 붙이는
쪽이 카운터보다 낫다. 지금 라운드의 일은 아니다.

### 4. 생성 SQL 두 블록 — 컴파일해서 비교. `getErrorSummary` 블록에 두 문장이 순서대로 있는가?

**있다 — 그리고 컴파일본과 커밋본의 차이는 빈 줄 하나뿐이다(N1).** `bin/sync-sql.ts:37`과 같은 `format(query, { language: 'postgresql' })`을,
DummyDriver + `PostgresQueryCompiler` 위의 `new GoogleDriveRepository(db)`에 걸어 `getErrorSummary(DummyValue.UUID)` → `getFailures(DummyValue.UUID, 100)`
순으로 호출했다. `getErrorSummary`는 `count(*)` 문장(`$1` = `ledgerMatches` 서브쿼리의 userId, `$2` = where의 userId)과 `getBlockingError`의
`select "error" … order by case "error" when $4 … limit $5` 문장이 **이 순서로** 한 블록에 찍혔다(코드가 `await`를 순차로 두는 이유는
`:906-913` 주석대로 이 생성기 때문이다). `getFailures`는 `$1`(서브쿼리), `$2`(where), `$3`(limit)까지 커밋본 `:525-579`와 동일하다.
새 `exists` 절의 텍스트(`inner join "album_user" on … and "album_user"."userId" = "google_drive_album"."userId"`, `where … and "album"."deletedAt" is null`)도
양쪽 블록에서 동일하다. 유일한 차이는 `:509`의 빈 줄 — 커밋본에만 있고, 생성기는 만들지 않는다.

### 5. `v3.1.0..HEAD` vs 운영 이미지 `3cabbb496` — 큐잉·워커·입양에 변화가 있는가?

**없다.** `git diff 3cabbb496 HEAD --stat -- server/src web/src i18n`은 8 files:

| 파일 | 변경 | 경로 |
|---|---|---|
| `server/src/repositories/google-drive.repository.ts` | +79/−23 | `getFailures`(owner 조인 + 술어), `getErrorSummary`(술어) — 둘 다 **읽기** |
| `server/src/services/google-drive.service.ts` | +3 | `getFailures` 매핑에 `ownerName` 한 줄(`:949-951`) |
| `server/src/dtos/google-drive.dto.ts` | +4 | `ownerName: nullable string` |
| `server/src/queries/google.drive.repository.sql` | +34 | 참조 파일 |
| `web/.../GoogleDriveSettings.svelte` | +11/−1 | `{#if failure.ownerName}` 라벨 |
| `i18n/en.json` | +1 | `google_drive_failure_owner` |
| 두 spec | 테스트 | — |

`server/src/schema/**`(마이그레이션·테이블) 변경 0, `job.repository.ts`·`queue.service.ts`·`utils/google-drive.ts` 변경 0. 리포지토리 diff의
비주석 변경 줄에 `streamPendingUploads`·`countPendingUploads`·`recordUpload`·`hasUpload`·`upsertError`·adopt 계열 이름이 하나도 없다.
`git merge-base --is-ancestor v3.1.0 HEAD` 참. 즉 이 이미지는 운영 이미지에 **설정 화면 읽기 경로 두 가지**(소유자 이름, 범위 술어)를 더한 것이고,
원장 8,180행·연결 1건·저장된 설정 row는 읽는 방식도 쓰는 방식도 바뀌지 않았다. §7 배포 순서의 하드 게이트(redirect 파생 확인, 백업, `features.googleDrive`
확인)는 그대로 밟는다 — 이 변경이 그 게이트를 건드리지는 않는다.

### 보너스 — 새 테스트의 비공허성

- `spec:1328` (unselected): 목격자 `before` 2행 + count 2(`:1346-1348`) → `unsubscribe`(`:1350`, `google_drive_album` 행 삭제 `:365-371`) → `after`
  `[kept.id]` + count 1(`:1354-1356`) → 에러 행 잔존 단언(`:1360-1367`). 변이 A·B가 정확히 이 테스트를 죽였다.
- `spec:1369` (unshared): 같은 모양, `album_user` 삭제(`:1391-1395`) + `isSubscribed` 참 단언(`:1402`). 변이 A·B·D가 죽였다 — D(`album_user` 조인
  삭제)는 이 테스트**만** 죽였고 그것이 맞다(선택 해제 테스트는 조인 없이도 `google_drive_album` 행이 사라져 통과한다).
- 손본 일곱 fixture는 전부 `selectedAlbum`/`selectedSharedAlbum`(`:96-113`)을 통과하며, `newAlbum`이 owner의 `album_user` 행을 쓴다는 주석은
  `medium.factory.ts:225-233`(`[{ userId: ownerId, role: AlbumUserRole.Owner }]`)로 확인했다.

## What I did not verify

- **브라우저** — 리포트도 미검증. dev 서버를 띄우지 않았다.
- **운영 인스턴스** — 실패 행 0이라 볼 것이 없다. EXPLAIN도 운영 통계가 아니라 testcontainer(빈 통계)에서 본 것이다.
- **`mise //server:ci-unit`·`mise //web:ci-unit` 전체 파이프라인**(format → lint → check → test) — vitest 전체와 `tsc`, 바뀐 파일의 ESLint만
  돌렸다. 전체 ESLint·Prettier 검사는 하지 않았다.
- **`mise //:sql` 실제 실행** — 빌드된 `dist`와 마이그레이션이 적용된 DB가 필요하고 `src/queries/`를 통째로 다시 쓰므로 하지 않았다. N1은
  같은 라이브러리·같은 호출의 재현과 파일 전체 패턴 검사로 판단했다.
- `mise //:open-api` 재실행 — N1(DTO 문구) 수정이 세 생성물(`open-api/…json:20112`, `packages/sdk/src/fetch-client.ts:1260`,
  `mobile/openapi/…/google_drive_failure_dto.dart:46`)에 반영된 것은 grep으로만 확인했다.

## Feeding back into the plan

`dev-docs/google-drive/failure-handling-plan.md`(또는 wave10 계획)에:

1. **실패 행의 가시성 = 자산이 지금 "선택 ⋈ 멤버십 ⋈ 살아 있는 앨범"에 있는가.** `getFailures`/`getErrorSummary`/`streamPendingUploads`가
   같은 술어를 쓴다. **배너(`getBlockingError`)와 `hasErrorOfClass`는 일부러 예외** — 계정 상태라 자산 범위와 무관하다. 그래서 `failedCount = 0` +
   `blockedReason ≠ null`은 정상 조합이다(N4).
2. **테스트 부채 두 건**(N2, N3): 사용자 상관(`:937`/`:999`)과 `album.deletedAt`(`:938`/`:1000`)을 고정하는 medium 테스트가 없다. 프로브 P1·P2
   모양 그대로 넣으면 된다. 다음 라운드에 이 둘을 넣으면 술어의 다섯 조건 전부가 변이로 관측된다.
3. **`src/queries/google.drive.repository.sql:509`의 빈 줄**은 손으로 들어간 것(N1) — 다음 `mise //:sql`이 지우며, 그때 diff에 이 줄이 빠지는 것은
   회귀가 아니다.
4. **선택 해제 뒤의 실패는 세지 않는다**(공격 항목 3의 결정) — 카운트는 "누를 수 있는 것의 수"이고, 공유 해제의 설명은 앨범 목록의 `accessLost`가
   맡는다. 실패 행에 앨범 이름을 싣게 되는 날 행 라벨로 다시 검토.

---

**BLOCKED / NOT BLOCKED: NOT BLOCKED.** `git status --porcelain`은 이 리뷰 파일 한 줄만 보고한다(위 표 마지막 행).
