# Code Review — wave10a: 실패 목록 + 재시도 (`1b15f7314`) — 다음 운영 이미지 포함 여부 판정

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `78ec3d287` (`feat/google-drive-album-sync-v3.1.0`) |
| Commits reviewed | `1b15f7314` (feature), `f914d11e9` (evidence), `78ec3d287` (리포트) — `git diff 5a8bc8a8f HEAD -- server/src web/src i18n` (8 files, +528/−2; 생성물 `open-api`·`packages/sdk`·`mobile/openapi` 제외) |
| Report | `../report/google-drive-wave10a-failure-list-20260920-1200-report.md` |
| Reviewed | 2026-09-20 17:20 +0900 (모든 수치는 이 워크트리 HEAD에서 직접 돌린 것) |

## Verdict

**판정: NOT BLOCKED — 원장·중복 관점에서 다음 운영 이미지에 넣어도 안전하다. 단, M1을 wave10b에서 고친 뒤 이미지를 만드는 것을 권한다.**
리포트가 "load-bearing"이라고 부른 결정 — 재시도가 받은 id를 큐잉하지 않고 error row를 지운 뒤 `queuePendingUploads`를 다시 돌린다
(`google-drive.service.ts:974-980`) — 은 코드가 그대로이고, 세 가지 변이 모두 리포트가 말한 개수·이름 그대로 테스트가 떨어진다. 정합성(목록과
숫자가 같은 술어를 쓴다), 인가(error row는 접근 게이트 뒤에서만 생긴다), 비용(사용자 한 명의 행만 정렬한다)도 확인했다.

가장 중요한 문제는 리포트가 스스로 의심한 **item 1**이다. `revoked` 상태 — 이 배포에서는 Testing 모드 7일 만료로 **매주** 오는 상태 — 에서
"Retry all"이 노출되고(`GoogleDriveSettings.svelte:383`의 `{#if failedCount > 0}`는 `{#if connected}` 바깥이다), 누르면 `revoked` 행을
지워(`:975`) 배너의 유일한 근거(`:700-707` `hasErrorOfClass(Revoked)`)를 없애면서 **아무것도 큐잉하지 않는다**(`streamPendingUploads`가
`user_google_drive`를 inner join — `repository.ts:594`). 토스트는 "Retrying failed uploads"라고 말한다. 데이터 손실은 없고 재연결로
복구되지만, wave 1 리뷰가 고친 "왜 끊겼는지 모르는 상태"로 되돌리는 경로다. 고치는 데 서비스 세 줄 + 스벨트 조건 하나면 된다.

두 번째는 **item 5**: `src/queries/google.drive.repository.sql`이 실제로 드리프트한다. `getFailures` 블록이 없다. 아래에 DummyDriver로 만든
블록을 그대로 붙일 수 있게 실었다.

### Evidence I ran myself

워크트리는 이전 라운드의 `node_modules`를 그대로 썼다. 변이는 세 번 넣었고 매번 `cp` + `cmp`로 바이트 동일 복원을 확인했다.

| Check | Result |
|---|---|
| `git status --porcelain` (리뷰 파일 쓰기 전·후) | 빈 출력 → 이 파일 한 줄만 |
| `git diff 5a8bc8a8f HEAD --stat -- server/src web/src i18n dev-test` | 9 files, +580/−2 (리포트가 지목한 범위 그대로) |
| `dev-test/google-drive/results/20260920-1705.txt` | commit `1b15f7314`, server 314 / web 84, svelte-check no regressions, **PASS** (리포트와 일치) |
| `cd server && npx vitest run --config test/vitest.config.mjs src/services/google-drive.service.spec.ts` | **110 passed** |
| `cd web && npx vitest run "src/routes/(user)/user-settings/GoogleDriveSettings.spec.ts"` | **12 passed** |
| `cd server && npx vitest run --config test/vitest.config.mjs` (전체) | **94 files, 2440 passed / 2 skipped** (리포트의 `ci-unit` 2440/2와 일치) |
| `cd web && npx vitest run` (전체) | **60 files + 1 skipped, 600 passed / 2 skipped** (리포트와 일치) |
| `cd server && npx tsc --noEmit -p tsconfig.json` | exit 0 |
| 변이 A — `retryFailures`가 받은 id를 `jobRepository.queueAll`로 직접 큐잉 | `retryFailures > should clear the named failures…`, `…should clear every class…` **2 failed / 108 passed** (리포트: 2) |
| 변이 C — retry-all이 `GOOGLE_DRIVE_BLOCKING_ERROR_CLASSES`만 지움 | `…should clear every class when retrying all…` **1 failed / 109 passed** (리포트: 1) |
| 변이 B — 마운트 로더(`:90` 뒤)에 `await loadFailures()` 삽입 | `should not fetch the failures until…`, `should retry one asset by id…` **2 failed / 10 passed** (리포트: 2) |
| `grep -n "^-- GoogleDriveRepository\." src/queries/google.drive.repository.sql` | 22 헤더, 마지막이 `:469 getErrorSummary`. **`getFailures` 없음 → 드리프트 확정** |
| Kysely `DummyDriver` + `PostgresQueryCompiler` + `sql-formatter({ language: 'postgresql' })`로 `getFailures` 컴파일 | 아래 N1 블록. 파라미터 순서 `$1`=서브쿼리 userId, `$2`=where userId, `$3`=limit (같은 술어를 쓰는 `getErrorSummary` 블록의 `$1/$2` 배치와 동일) |
| dev DB(`immich_postgres`)에서 `EXPLAIN (costs off)` — `driveAccountId` 술어는 뺐다(그 컬럼이 dev DB에 없다 = 리포트의 "dev DB predates this branch's migrations" 사실) | `Limit → Sort(lastFailedAt desc) → Nested Loop Anti Join → [Bitmap Index Scan google_drive_upload_error_userId_idx → asset PK lookup(Memoize)] → Index Only Scan google_drive_upload_pkey`. 사용자 한 명의 행만 정렬한다 (item 2) |

## Findings

### M1 — `revoked`/미연결 상태에서 재시도가 "원인 배너"를 지우고 아무것도 큐잉하지 않는다 (Major — 데이터 무해, UX 회귀, 이 배포에서는 매주 발생)

**경로.** 만료·취소 → 워커가 `revoked` 행을 쓰고 자격증명을 지운다(`service.ts:1387-1398`). 설정 화면은 `connected=false`,
`blockedReason='revoked'`(`:692-707`; `revoked`는 blocking class가 아니라 `hasErrorOfClass`로만 판정한다), `failedCount ≥ 1`.
`GoogleDriveSettings.svelte:383` `{#if failedCount > 0}`는 `{#if connected}`(`:446`) **바깥**이라 "Retry all"·"Show failures"가 미연결
사용자에게 그대로 보인다. 누르면:

1. `service.ts:975` `clearErrors(userId, Object.values(GoogleDriveUploadErrorClass))` — `Revoked` 포함 전부 삭제.
2. `:980` `queuePendingUploads(userId)` → `repository.ts:594` `innerJoin('user_google_drive', …)` — 자격증명 행이 없으니 **0행**.
3. 웹 `:310-313` 상태 재조회 → `hasErrorOfClass(Revoked)`가 false → `blockedReason=null` → **"Google Drive: not connected" 배너만 남고
   이유가 사라진다.** 토스트는 `google_drive_retry_started`("Retrying failed uploads").

행 단위 "Retry"도 같다 — `clearErrorsForAssets`(`repository.ts:971`)는 class를 보지 않으므로 `revoked` 행을 하나씩 지운다. 게다가
`failureLabel`(`svelte:257-276`)에 `revoked`·`rate_limited` 분기가 없어 목록에서 이 행은 "Upload failed"로만 보인다 — 사용자가 고칠 수
있는(재연결) 유일한 클래스가 정작 이름을 잃는다.

`revoked` 행의 정당한 삭제 경로는 이미 하나뿐이다: 재링크(`service.ts:401`, "Every failure class is stale after a fresh grant").
재시도가 그 자리를 대신할 이유가 없다.

**Fix (권장안, 순서대로).**
- 서버 `retryFailures`: 시작에서 `getCredentials(auth.user.id)`가 없으면 `BadRequestException('Google Drive is not connected')`. pending
  쿼리가 연결을 요구하므로(`:594`) 미연결 재시도는 정의상 no-op이고, no-op이 evidence를 지우면 안 된다. 방어를 한 겹 더: 두 분기 모두에서
  `Revoked`를 제외한다 — `Object.values(GoogleDriveUploadErrorClass).filter((c) => c !== GoogleDriveUploadErrorClass.Revoked)`,
  `clearErrorsForAssets`에는 `.where('error', '!=', GoogleDriveUploadErrorClass.Revoked)`.
- 웹: `Retry`/`Retry all` 버튼을 `connected`일 때만 렌더한다(목록 토글은 그대로 — 어떤 사진이 걸렸는지는 미연결이어도 유용하다).
  `failureLabel`에 `revoked`(→ "Google Drive access was revoked — reconnect") 와 `rate_limited` 분기 + `i18n/en.json` 키 2개.
- 테스트: `retryFailures` — 자격증명 없음 → throw & `clearErrors`/`clearErrorsForAssets`/`streamPendingUploads` 미호출;
  retry-all → `expect(mocks.googleDrive.clearErrors).toHaveBeenCalledWith(user.id, expect.not.arrayContaining([GoogleDriveUploadErrorClass.Revoked]))`.
  기존 "should clear every class" 테스트는 이름과 단언을 "every class **but revoked**"로 바꾼다. 웹: `connected({ connected: false, blockedReason: 'revoked', failedCount: 1 })`에서 `Retry all` 없음.

### N1 — `src/queries/google.drive.repository.sql` 드리프트: `getFailures` 블록 누락 (item 5)

`repository.ts:936` `@GenerateSql({ params: [DummyValue.UUID, 100] })`는 있는데 파일에 블록이 없다. `sync-sql.ts:55,70`대로 메서드 정의 순서
= 파일 순서이고 블록 사이는 빈 줄 하나, 파일 끝은 개행 하나다. 따라서 **현재 파일 마지막 줄(`getErrorSummary` 블록 끝, `limit\n  $5\n`)
뒤에 빈 줄 하나를 두고 아래를 그대로 붙이면** 재생성 결과와 같다(끝 개행 하나 유지). 검증 방법: DummyDriver 컴파일 + 같은 포맷터.
migration이 적용된 DB에서 `mise //:sql`을 돌릴 수 있게 되면 그때 diff가 비어야 한다.

```sql
-- GoogleDriveRepository.getFailures
select
  "google_drive_upload_error"."assetId",
  "google_drive_upload_error"."error",
  "google_drive_upload_error"."detail",
  "google_drive_upload_error"."attempts",
  "google_drive_upload_error"."lastFailedAt",
  "asset"."originalFileName"
from
  "google_drive_upload_error"
  inner join "asset" on "asset"."id" = "google_drive_upload_error"."assetId"
  left join "google_drive_upload" on "google_drive_upload"."assetId" = "google_drive_upload_error"."assetId"
  and "google_drive_upload"."userId" = "google_drive_upload_error"."userId"
  and (
    "google_drive_upload"."driveAccountId" = coalesce(
      (
        select
          "driveAccountId"
        from
          "user_google_drive"
        where
          "userId" = $1
      ),
      ''
    )
    or "google_drive_upload"."driveAccountId" = ''
  )
where
  "google_drive_upload_error"."userId" = $2
  and "asset"."deletedAt" is null
  and "google_drive_upload"."assetId" is null
order by
  "google_drive_upload_error"."lastFailedAt" desc
limit
  $3
```

### N2 — `server/test/utils.ts`에 `getFailures`·`clearErrorsForAssets` 기본 mock이 없다 (§2 규칙)

`test/utils.ts:313-316`에는 `getBlockingError`·`upsertError`·`getErrorSummary`·`hasErrorOfClass`까지만 있다. 지금은 spec이 매 테스트에서
`mockResolvedValue`를 주므로 통과하지만, `retryFailures` 테스트의 `clearErrorsForAssets`는 automock의 `undefined`를 await하고 있다.
`googleDriveMock.getFailures.mockResolvedValue([]); googleDriveMock.clearErrorsForAssets.mockResolvedValue([]);` 두 줄.

### N3 — `retryFailures`가 `{ queued }`를 돌려주는데 컨트롤러가 버린다 (`controller.ts:315-317` `Promise<void>`)

"선택 해제된 앨범의 사진은 조용히 돌아오지 않는다"는 이 wave의 핵심 설계인데, 클라이언트는 그 사실을 알 길이 없다 — 토스트는 항상
"Retrying failed uploads"다(M1의 0-큐잉 케이스도 같은 토스트). `GoogleDriveRetryFailuresResponseDto { queued: z.int() }`로 노출하고
토스트에 개수를 넣으면(`"{count} queued"`, 0이면 "Nothing to retry — check the album is still selected") 설계가 눈에 보인다.
OpenAPI·SDK 재생성 필요.

### N4 — 웹 `retryFailures`(`svelte:305-321`)가 목록이 닫혀 있어도 `loadFailures()`를 부른다 (nit)

`:61-63` 주석("Fetching a list nobody opened would cost a query on every settings visit")과 어긋난다. "Retry all"을 목록을 열지 않고
누르면(spec `should retry everything … without opening it first`가 그 경로다) 조회가 한 번 나간다. `if (failuresOpen) { await loadFailures(); }`.
같은 자리: `Retry` 버튼들이 `disabled={retrying}`만 있고 `loading={retrying}`이 없다 — 바로 위 Resume 버튼(`:364-366`)은 둘 다 준다.

### N5 — 키보드·스크린리더 (item 6, nit)

포커스·Enter/Space는 된다(`<Button type="button">`이 네이티브 button이라고 가정 — 아래 "검증하지 못한 것"). 부족한 것: 토글 버튼에
`aria-expanded={failuresOpen}`; 행마다 "Retry"가 N번 반복되므로 `aria-label={`${$t('google_drive_retry')} ${failure.fileName}`}`;
`<ul>`에 `aria-label={$t('google_drive_failures_show')}` 정도. `LoadingSpinner`가 `role="status"`를 주는지는 보지 않았다.

### N6 — medium 테스트 (리포트 "Not verified"의 질문)

`test/medium/specs/repositories/google-drive.repository.spec.ts:1141-1225`가 `getErrorSummary`의 술어(원장 우선, 다른 계정 원장, 다른
사용자 원장, 휴지통)를 하나씩 못박는다. `getFailures`는 같은 술어를 **복사**했으므로 지금은 같지만, 둘이 갈라지는 것을 막는 것은 아무것도
없다. 두 가지 중 하나: (a) 같은 fixture에서 `getFailures(userId, 1000).map(r => r.assetId).length === getErrorSummary(userId).failedCount`를
단언하는 medium 테스트 하나, (b) 리포지토리에 private `failureRows(userId)` 베이스 쿼리를 두고 count와 list가 그 위에서 `.select(count)` /
`.select([...]).orderBy().limit()`만 얹게 리팩터 — 그러면 갈라질 수 없다. (b)를 권한다; `@GenerateSql` 블록은 둘 다 그대로다.

### N7 — `google_drive_failed_count` = "{count} failed — press to retry" (pre-existing, nit)

이 wave가 손대지 않은 문자열인데, 이제 옆에 실제 버튼("Retry all")이 생겨 "press to retry"가 무엇을 누르라는 건지 모호하다. "{count} failed"로
줄이면 된다.

## Answers to what the report asked me to attack

### 1. Retry semantics — `revoked`를 제외해야 하는가? revoked 중 retry-all은?

**제외해야 한다. 그리고 미연결 상태에서는 재시도 자체를 거부해야 한다.** 근거와 경로는 M1. 요약하면: (i) `revoked`는 재시도로 해결되는
클래스가 아니다 — 해결 경로는 재링크뿐이고 그 경로가 이미 모든 클래스를 지운다(`service.ts:401`); (ii) 미연결 상태의 retry-all은
`streamPendingUploads`의 `user_google_drive` inner join(`repository.ts:594`) 때문에 **항상 0건**이라, 하는 일이 "증거 삭제"뿐이다;
(iii) 그 증거는 `getMyStatus`(`:700-707`)가 미연결 사용자에게 "왜"를 말해 주는 유일한 근거다. `quota_exceeded`·`folder_missing`을
retry-all이 지우는 것은 옳다(리포트의 "resume과 같은 제스처" 논리, 실패해도 첫 업로드가 다시 막는다 — `resumeUploads` 주석 `:1755-1757`과
같은 수렴). `folder_missing`은 폴더를 안 바꿨으면 한 번 시도 후 재차단 — 비용 API 호출 1회, 허용 범위.

### 2. `getFailures` 비용 — 인덱스, 전체 테이블 정렬인가?

**전체 테이블 정렬이 아니다.** 인덱스는 PK `(userId, assetId)` + `userId` + `assetId` 세 개(`migrations/1786800000000-…:28-34`);
`lastFailedAt` 인덱스는 없다. dev DB의 plan(위 표)은 `userId_idx`로 그 사용자의 행만 긁어 asset PK·ledger PK로 anti-join한 뒤 그 결과만
정렬(top-N, limit 200)한다. 수천 행이면 밀리초 단위다. `(userId, lastFailedAt desc)` 인덱스를 추가하면 정렬은 사라지지만 `deletedAt`·anti-join
필터 때문에 200행이 찰 때까지 인덱스 순서로 읽어야 하므로 이 규모에서는 이득이 없다. **지금 인덱스를 추가하지 말 것**을 권한다. 한 명이 수십만
실패 행을 갖는 상황은 계정 단위 원인이고, 그때는 배너가 먼저 말한다는 리포트의 논리에 동의한다. 참고: `getErrorSummary`가 `getBlockingError`까지
같이 돌려 `getFailures` 서비스 호출당 쿼리가 3개다 — 무시할 수준.

### 3. 목록과 숫자가 어긋날 수 있는가?

**있지만 무해하다.** `service.ts:940-943` `Promise.all`은 트랜잭션이 아니므로 워커가 사이에 행을 쓰면 `total`이 목록보다 1 크거나 작을 수
있다. UI는 `failureTotal > failures.length`일 때만 "Showing N of M"을 그리므로(`svelte:434`), 목록이 더 큰 쪽은 아무것도 안 보이고, total이
더 큰 쪽은 "Showing 200 of 201" 같은 정직한 문장이다. 헤더의 `failedCount`(status)와 `failureTotal`(failures)도 서로 다른 조회이지만 재시도
후 둘 다 다시 읽으므로(`:310-313`) 정착한다. 사용자가 혼란스러울 조합은 못 찾았다. 서비스 `Promise.all`은 SQL 생성기 문제(`repository.ts:901-907`
주석)와 무관하다 — 생성기는 리포지토리 메서드만 걷는다.

### 4. 인가 — 볼 수 없는 자산의 error row가 있을 수 있는가?

**"한 번도 볼 수 없었던" 자산은 없다. "지금은 볼 수 없는" 자산은 있다.** `upsertError` 호출 세 곳(`service.ts:1254, 1387, 1404`)은 모두
`isAssetInSubscribedAlbum`(`:1167`; SQL `queries:341-357`이 `album_user`를 inner join) 게이트 **뒤**에 있다. 즉 행이 생기는 순간에는
사용자가 그 앨범의 멤버였다. 그 뒤 공유 해제·앨범에서 제거·앨범 삭제가 일어나면 행은 남고(`clearErrors`/성공 시 삭제만 있다) `getFailures`가
`originalFileName`을 보여 준다 — 이미 봤던 이름이고, `getErrorSummary`도 같은 행을 세고 있었으므로 이 wave가 노출 범위를 넓힌 것은
"파일명·시도 횟수·detail"뿐이다. 재시도해도 pending 쿼리가 걸러서 업로드되지 않는다. **허용 범위**라고 본다. 좁히고 싶으면 두 쿼리 모두에
`exists(album_asset ⋈ google_drive_album ⋈ album_user)` 술어를 넣되, 그러면 사용자가 스스로 선택 해제한 앨범의 실패도 카운트에서 사라진다
— 그건 오히려 원하는 동작일 수 있다(N6의 베이스 쿼리 리팩터와 함께 결정할 것). 다른 사용자의 행을 읽는 경로는 없다(`userId = auth.user.id`
고정, `:300, 316`).

### 5. 생성 SQL 드리프트

**드리프트한다.** 22개 헤더 중 `getFailures`가 없다. 블록은 N1. `clearErrorsForAssets`는 `@GenerateSql`이 없어 대상이 아니다(길이 0 조기
반환이 있어 생성기가 걷기에도 부적합 — 그대로 두는 것이 맞다).

### 6. 키보드·aria

N5. 도달은 되고, 라벨링이 부족하다. 차단 사유는 아니다.

## What I did not verify

- **브라우저.** 클릭·토글·토스트는 happy-dom 테스트로만 봤다.
- **medium 스위트.** 돌리지 않았다 — 새 쿼리를 덮는 medium 테스트가 없고(N6), 기존 스위트는 이 wave가 건드리지 않았다.
- **`@immich/ui` `Button`이 네이티브 `<button>`을 렌더하는지.** 파일을 찾지 못해 가정으로 남긴다(N5의 전제).
- **`EXPLAIN`은 `driveAccountId` 술어 없이** 돌렸다(dev DB에 그 컬럼이 없다). 그 술어는 ledger PK 인덱스 조건에 얹히는 필터라 plan 모양을
  바꾸지 않는다고 판단했지만, 실측은 아니다.
- **OpenAPI·SDK 생성물**은 `grep`으로 새 심볼(`GoogleDriveFailureDto`, `getMyGoogleDriveFailures`, `retryGoogleDriveFailures`,
  `assetIds.default: []`, `lastFailedAt: date-time`)의 존재만 확인했다. `mise //:open-api`를 다시 돌려 diff가 비는지는 보지 않았다.
- `lastFailedAt: isoDatetimeToDate`를 응답 스키마에 쓰는 것은 같은 파일의 `connectedAt`(`dto.ts:45`, 이미 운영 중)과 같은 패턴이라 넘어갔다.

## Feeding back into the plan

`dev-docs/google-drive/failure-handling-plan.md`에 넣을 것:

- **`revoked` 행의 삭제 주체는 재링크뿐이다.** 재시도·resume·retry-all은 이 클래스를 건드리지 않는다. 미연결 상태의 재시도는 pending
  쿼리가 연결을 요구하므로 정의상 no-op이고, no-op은 거부한다(M1).
- **재시도 응답에 `queued`를 실어야 "선택 해제된 사진은 돌아오지 않는다"가 관측 가능하다**(N3). 설계가 옳은 것과 사용자가 그 설계를 알 수
  있는 것은 다른 문제다.
- **count와 list는 같은 베이스 쿼리를 공유한다**(N6 b). 복사한 술어는 언젠가 갈라진다.
- `src/queries/*.sql`은 dev DB가 migration을 따라갈 때까지 리뷰어가 DummyDriver로 블록을 만들어 준다(wave9e/9f/10a 세 번째). dev DB를
  한 번 따라잡게 하는 것이 반복 비용보다 싸다 — 별건으로 잡을 것.
- 대기 지표: `(userId, lastFailedAt)` 인덱스는 **의도적으로 없다**. 한 사용자의 실패 행이 수만을 넘어 설정 화면이 느려지면 그때 다시 본다.

---

`git status --porcelain` — 이 리뷰 파일 한 줄(`?? dev-docs/review/google-drive/review/google-drive-wave10a-failure-list-20260920-1200-review.md`)만.
변이 세 건은 모두 `cmp`로 원본과 바이트 동일 복원을 확인했다.

**VERDICT: NOT BLOCKED** — 원장·중복 안전성은 확보됐고 다음 운영 이미지에 넣어도 된다. 단 M1(revoked 상태의 retry-all이 배너 근거를 지우고
0건 큐잉 + "Retrying" 토스트)은 이 배포에서 **매주** 밟는 경로이므로, wave10b에서 고친 커밋으로 이미지를 만드는 것을 권한다. N1의 SQL 블록은
같은 커밋에 넣는다.
