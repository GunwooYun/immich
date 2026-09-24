# Code Review — wave10b: 재시도 가드 (`89f5e729f`) — 배포 게이트

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `35ad9fec5` (`feat/google-drive-album-sync-v3.1.0`) |
| Commits reviewed | `89f5e729f` (fix), `7cf3585eb` (evidence), `35ad9fec5` (리포트) — `git diff 78ec3d287 89f5e729f -- server/src web/src i18n` (10 files, 생성물 `open-api`·`packages/sdk`·`mobile/openapi` 제외) + 배포 기준 `git diff 9665ace92 HEAD` |
| Report | `../report/google-drive-wave10b-retry-guards-20260924-1000-report.md` |
| Reviewed | 2026-09-24 10:10 +0900 (모든 수치는 이 워크트리 HEAD에서 직접 돌린 것) |

## Verdict

**판정: NOT BLOCKED — 이 커밋(`89f5e729f`)으로 다음 운영 이미지를 만들어도 된다.**
wave10a M1의 세 겹 수정은 모두 코드에 있고(`service.ts:978-981` 자격증명 거부, `:986-989` `Revoked` 제외, `svelte:409`/`:444` `connected`
게이트), 각각을 하나씩 뽑아 보면 정확히 한 테스트가 떨어진다(아래 변이 A·D·E). N1의 생성 SQL 블록은 내가 DummyDriver로 다시 만든 것과
**35줄 바이트 단위로 동일**하고 파일 안의 위치(마지막 블록, 빈 줄 하나, 끝 개행 하나)도 생성기가 쓸 자리 그대로다. 배포 관점에서 가장
중요한 사실은 **운영 커밋 `9665ace92` 이후 `server/src`의 변경이 6개 파일 +377/−0으로 순수 추가**라는 것이다 — 워커(`handleUpload`
`:1835`), 일괄 큐잉(`:1727`), 입양(`:529`), 링크(`:376`), 드레인(`:490`), pending 쿼리(`repository.ts:582`), 원장 술어(`:44-48`)는 한 줄도
바뀌지 않았고 마이그레이션도 없다. 새로 생긴 큐잉 생산자는 `retryFailures → queuePendingUploads(userId)`(`:995`) 하나이며, `resumeUploads`
(`:1780`)와 같은 경로·같은 3겹 중복 방지를 탄다.

발견한 것 중 가장 무게 있는 것은 **N1** — 이 워크트리에서 `web` ESLint가 `tscompat` 플러그인 크래시로 아예 돌지 않는다. 다만 크래시 지점이
업스트림 파일(`hooks.client.ts:8`)이고 운영 커밋의 `GoogleDriveSettings.svelte`에서도 같은 크래시가 나므로 이 wave의 회귀가 아니고, 리포트의
`web:ci-unit`(format → check → test, **lint 미포함**)은 거짓이 아니다. 나머지는 전부 nit이다.

### Evidence I ran myself

워크트리는 이전 라운드의 `node_modules`를 그대로 썼다. 변이는 다섯 번 넣었고 매번 `cp` + `cmp`로 바이트 동일 복원을 확인했다.
medium 스위트는 `testcontainers`가 자기 Postgres를 띄우므로(`test/medium/globalSetup.ts:11`) 로컬 `immich_postgres`와 무관하게 돌았다.

| Check | Result |
|---|---|
| `git status --porcelain` (리뷰 파일 쓰기 전·후) | 빈 출력 → 이 파일 한 줄만 |
| `dev-test/google-drive/results/20260920-1725.txt` | commit `89f5e729f`, server **315** / web **85** / medium **62**, svelte-check no regressions, **PASS** — 리포트와 일치 |
| `cd server && npx vitest run --config test/vitest.config.mjs src/services/google-drive.service.spec.ts` | **111 passed** |
| `cd web && npx vitest run "src/routes/(user)/user-settings/GoogleDriveSettings.spec.ts"` | **13 passed** (wave10a 12 + 새 disconnected 테스트) |
| `cd server && npx vitest run --config test/vitest.config.medium.mjs test/medium/specs/repositories/google-drive.repository.spec.ts` | **62 passed** |
| `cd server && npx vitest run --config test/vitest.config.mjs` (전체) | **94 files, 2441 passed / 2 skipped** — 리포트의 `ci-unit` 2441/2와 일치 |
| `cd web && npx vitest run` (전체) | **60 files + 1 skipped, 601 passed / 2 skipped** — 리포트와 일치 |
| `cd server && npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `cd server && npx eslint <변경 6파일> --max-warnings 0` | exit 0 |
| `cd web && npx eslint . --max-warnings 0` / 단일 파일 | **플러그인 크래시** (`tscompat/tscompat`, `TypeError: Cannot read properties of undefined (reading 'Class')`) — N1 |
| Kysely `DummyDriver` + `PostgresQueryCompiler` + `sql-formatter({ language: 'postgresql' })`로 `getFailures` 컴파일 → `diff` | **IDENTICAL** (35줄 = 35줄). 블록 위치·구분·끝 개행도 일치 — item 3 |
| `python3`로 `i18n/en.json` 키 순서 (대소문자 무시) | sorted |
| `git merge-base --is-ancestor v3.1.0 HEAD` | 참 (`git describe --tags --abbrev=0` = `v3.1.0`) |
| `git diff --stat 9665ace92 HEAD -- server/src` | 6 files, **377 insertions, 0 deletions** (`grep '^-[^-]'` 결과 없음) |
| `git diff --stat 9665ace92 HEAD -- server/src/schema server/src/migrations` | 빈 출력 — 마이그레이션 없음 |
| 변이 A — `svelte:409` `{#if connected}` → `{#if true}` | `should not offer retry to a disconnected user` **1 failed / 12 passed** (리포트: 1) |
| 변이 B — `repository.ts:949` `.where('google_drive_upload.assetId', 'is', null)` 삭제 (getFailures) | medium `should list exactly the failures it counts` **1 failed / 61 passed**, `expected [ …(2) ] to deeply equal [ Array(1) ]` (리포트: 1) |
| 변이 C — `repository.ts:948` `.where('asset.deletedAt', 'is', null)` 삭제 (getFailures) | 같은 테스트 **1 failed / 61 passed** (리포트: 1) |
| 변이 D — `service.ts:989` `.filter(... !== Revoked)` 제거 | `should clear every class when retrying all…` **1 failed / 110 passed** |
| 변이 E — `service.ts:980` `throw new BadRequestException('Connect Google Drive…')` 제거 | `should refuse to retry for a user who is not connected` **1 failed / 110 passed** |

## Findings

### N1 — 이 워크트리에서 `web` ESLint가 돌지 않는다 (pre-existing, 이 wave와 무관 — 배포 차단 아님)

`cd web && npx eslint . --max-warnings 0 --concurrency 6`이 `hooks.client.ts:8`에서 `tscompat/tscompat` 규칙의
`TypeError: Cannot read properties of undefined (reading 'Class')`로 죽고(exit 2), `GoogleDriveSettings.svelte` 단독으로 돌리면 `:118`
`new URLSearchParams(location.search)`에서 같은 크래시다. **운영 커밋 `9665ace92` 버전의 같은 파일(`:107`)에서도 동일하게 죽는 것을
확인했다**(파일을 바꿔 끼워 돌리고 `cmp`로 복원). 즉 이 wave가 만든 것이 아니라 `@koddsson/eslint-plugin-tscompat@0.2.0` + `eslint@10.7.0`
조합의 환경 문제이고, 메인 워크스페이스의 `node_modules/.pnpm`도 같은 버전이다. 리포트가 인용한 `mise //web:ci-unit`은 `mise.toml:48-52`대로
format → check → test이고 **lint는 `checklist`(`:54-58`)에만 있다** — 리포트는 web lint 통과를 주장하지 않았으므로 거짓 주장은 아니다.

**Fix.** 이 리뷰의 범위 밖. 별건으로 `mise //web:lint`가 메인 워크스페이스에서 도는지 확인하고, 안 돌면 플러그인 버전을 업스트림 lock과
대조한다. 배포 이미지는 `server/Dockerfile`이 만들고 web 빌드는 lint를 거치지 않으므로 이미지 생성에는 영향이 없다.

### N2 — 웹 테스트가 "토스트가 개수를 말한다"를 단언하지 않는다 (nit)

리포트는 N3를 "endpoint returns `{queued}` and the toast names it"이라고 닫았다. 서버 쪽은 맞다(`controller.ts:316-320`
`Promise<GoogleDriveRetryResultDto>`, `dto.ts:220-224`, 생성물 `fetch-client.ts:1271`·`:5093`). 웹 쪽은 `svelte:313-317`이 `queued`를
`google_drive_retry_started`에 넣지만, `GoogleDriveSettings.spec.ts`에서 `queued`가 등장하는 곳은 `:65`의 `retry.mockResolvedValue({ queued: 1 })`
뿐이고 토스트 문구를 보는 단언은 없다(`grep -n "queued\|toast\|Retrying"` → 1건). 지금 이 mock은 구조분해가 `undefined`에서 터지지 않게
하는 역할만 한다. `toastManager`를 mock해 `'Retrying: 1 upload(s) queued'`가 불렸는지 한 줄 넣으면 된다.

같은 자리 문구: `en.json:1216` `"Retrying: {count} upload(s) queued"`는 `count`가 0이면 "Retrying: 0 upload(s) queued"가 된다. 0은 정확히
"아무것도 재시도되지 않았다"는 뜻이므로 wave10a N3이 제안한 별도 문장("Nothing to retry — check the album is still selected")이 더 정직하다.
i18n ICU plural(`{count, plural, =0 {…} one {…} other {…}}`)로 한 키 안에서 해결된다.

### N3 — 행 단위 `Retry` 게이트(`svelte:444`)는 테스트가 없다 (nit)

새 웹 테스트(`spec.ts:181-191`)는 `Retry all`이 없음만 본다. `:444`의 `{#if connected}`는 같은 변수라 검사로 충분하지만, 변이 A를
`:444`에 넣으면 아무 테스트도 떨어지지 않는다. 같은 테스트에서 `Show failures`를 클릭한 뒤 `screen.queryByText('Retry')`가 없음을 하나 더
단언하면 닫힌다(그 테스트는 `failures` mock을 `[failure()]`로 바꿔야 한다).

### N4 — `clearErrorsForAssets`(`repository.ts:971-981`)는 `Revoked`를 제외하지 않는다 (nit, 문서화 요망)

wave10a M1은 두 번째 방어선으로 `.where('error', '!=', Revoked)`를 제안했고, wave10b는 그 대신 서비스 입구의 자격증명 게이트(`service.ts:978`)
로 막았다. 결과적으로 **연결된 사용자**가 `revoked` 행을 개별 재시도하면 지워진다. 그런 행이 연결 상태에서 존재하는 창은 좁다 — 워커가
`upsertError(Revoked)`(`:1401-1406`)를 쓴 뒤 `deleteCredentials`(`:1411`)까지의 사이, 또는 `deleteCredentials`가 던진 경우 — 그리고 두 링크
경로(`storeGrant :376`의 `clearErrors(all) :401`, 로그인 grant `:424`도 `storeGrant`를 부른다 `:437`)가 재연결 시 전부 지우므로 실질적 해는
없다. 다만 `getMyStatus`(`:1005-1020`)와 설정 화면 상태(`:692-707`)는 **연결된** 사용자에 대해 `hasErrorOfClass(Revoked)`를 보지 않으므로,
그 창 안에서는 목록에 "Google Drive access was revoked" 행이 배너 없이 뜨고 Retry 버튼이 붙는다. 설계상 허용 범위라고 보되, 서비스 주석
(`:975-977`)에 "행 단위 경로는 게이트에만 의존한다"를 한 줄 적어 두면 다음 사람이 두 번째 방어선을 다시 제안하지 않는다.

### N5 — `resumeUploads`(`service.ts:1775-1782`)에는 같은 자격증명 게이트가 없다 (nit, pre-existing)

`retryFailures`와 같은 모양 — 미연결이면 `queuePendingUploads`가 0을 돌려주고 토스트는 "Uploads resumed"다. 지우는 것이 blocking 두 클래스뿐이라
(`GOOGLE_DRIVE_BLOCKING_ERROR_CLASSES`) 증거 삭제 문제는 없고, 도달 조건도 좁다(수동 Disconnect 뒤 `quota_exceeded` 행이 남아 있고 `revoked`
행이 없을 때만 `svelte:365` 배너가 미연결 상태에서 그려진다 — `:386`의 `revoked` 분기가 우선하기 때문). 일관성을 위해 같은 세 줄을 넣고
같은 테스트를 하나 붙이는 것을 권한다. 이 wave의 범위는 아니다.

### N6 — "재시도가 절대 지우지 않는 클래스"를 상수로 (nit, item 2의 결론)

`service.ts:989`의 `.filter((error) => error !== GoogleDriveUploadErrorClass.Revoked)`는 지금은 맞지만, 새 클래스를 `enum.ts:1192-1206`에
추가하는 사람이 "이건 재시도 대상인가"를 정하는 자리가 없다. `constants.ts`의 `GOOGLE_DRIVE_BLOCKING_ERROR_CLASSES` 옆에
`GOOGLE_DRIVE_STATE_MARKER_ERROR_CLASSES = [Revoked] as const`를 두고 `retryFailures`가 그것을 빼면, 분류가 enum 옆에서 결정된다.

## Answers to what the report asked me to attack

### 1. 미연결 상태에서 거부하는 것이 맞는가, 아니면 비-revoked 행을 지워 재연결 후 숫자를 정직하게 해야 하는가?

**거부가 맞고, 지워서 얻는 것이 없다.** 재연결은 두 경로 모두 `storeGrant`(`service.ts:376`)를 지나고 그 끝(`:401`)이
`clearErrors(userId, Object.values(GoogleDriveUploadErrorClass))` — **모든 클래스**를 지운다. 즉 재연결 직후의 `failedCount`는 미연결 중에
무엇을 했든 0에서 시작한다. 미연결 중에 비-revoked 행을 미리 지우면 (i) 재연결 뒤 숫자는 어차피 같고, (ii) 미연결 상태에서 사용자가
"어떤 사진이 왜 실패했나"를 볼 유일한 근거(`getFailures`)가 사라지며, (iii) `revoked`만 남은 목록은 "3 failed"의 3이 전부 revoked라
"실패한 업로드"가 아니라 "끊긴 사실"만 세게 된다. 지금 상태 — 미연결이면 목록은 보이고(`svelte:393` 블록은 `connected` 바깥) 버튼만
없다(`:409`, `:444`) — 가 정보량이 가장 많다.

한 가지 짚을 것: 미연결 중 `failedCount`(`getErrorSummary`)는 `revoked` 행도 센다. 재연결이 지우므로 정착하지만, 미연결 화면의 "N failed"는
"N개 사진이 revoked로 막혔다"는 뜻이고, 이는 `:386` 배너가 설명한다. 문제 없다.

### 2. `Object.values(...).filter(!== Revoked)` — 같은 취급을 받아야 할 다른 클래스가 있는가?

**지금 enum에는 없다.** 기준은 "그 행이 *반복 가능한 업로드 시도*를 기록하는가, 아니면 *다른 행동만이 바꿀 수 있는 계정 상태*를 기록하는가"다.
`enum.ts:1192-1206`의 일곱 클래스를 그 기준으로 나누면:

| 클래스 | 성격 | retry-all이 지우는 것이 맞는가 |
|---|---|---|
| `quota_exceeded`, `folder_missing` | 계정 단위 block | 맞다 — resume과 같은 제스처(`:1779`), 조건이 그대로면 첫 업로드가 다시 막는다(API 호출 1회) |
| `size_mismatch`, `source_unreadable`, `unknown` | 자산 단위 실패 | 맞다 — 재시도가 존재하는 이유 |
| `rate_limited` | 일시적, "재시도 소진" | 맞다 — 시간이 지나면 성공하는 클래스이고, 워커의 backoff가 다시 감싼다 |
| `revoked` | 상태 표식, 업로드 실패가 아님 | **아니다** — 해결 경로는 재링크뿐(`:401`) |

리포트가 예로 든 `rate_limited`는 이미 있고(`:1204`) 재시도 대상이 맞다. 미래에 `revoked`와 같은 부류가 생긴다면(예: "폴더 권한 상실"을
계정 상태로 기록하는 클래스) 같은 제외가 필요하므로 N6의 상수를 권한다. 행 단위 경로(`clearErrorsForAssets`)는 클래스를 보지 않는데,
그 결과는 N4.

### 3. 붙인 SQL 블록이 실제 생성기 출력과 같은가, 파일 안의 위치까지?

**같다.** `repository.ts:936-966`의 `getFailures`를 같은 `ledgerMatches`/`currentAccountOf`(`:41-45`) 정의와 함께 Kysely `DummyDriver` +
`PostgresQueryCompiler`로 컴파일하고 생성기와 같은 `format(sql, { language: 'postgresql' })`(`sync-sql.ts:37`)로 포맷한 결과를
`-- GoogleDriveRepository.getFailures` 헤더부터 파일 끝까지와 `diff`했다 — **차이 없음, 35줄 = 35줄**. 파라미터 번호도 `$1`(서브쿼리 userId),
`$2`(where userId), `$3`(limit)로 생성기 순서와 같다.

위치: 생성기는 프로토타입 속성 순서(`sync-sql.ts:205`)로 걷고 블록을 `'\n\n'`으로 이어 끝에 `'\n'` 하나를 붙인다(`:189`).
`@GenerateSql`이 붙은 마지막 메서드가 `getFailures`(`:936`)이고 그 뒤의 `clearErrorsForAssets`(`:971`)는 데코레이터가 없다. 파일에서는
헤더가 `:510`, 그 앞 `:509`가 빈 줄, 직전 블록이 `getErrorSummary`(`:469`), 파일 끝은 `$3\n` 한 개의 개행(`tail -c | od -c`로 확인).
**재생성해도 diff가 비어야 한다** — 단, 실제 `mise //:sql`은 migration이 적용된 DB가 필요해 여기서 돌리지 못했다(아래 "검증하지 못한 것").

### 4. `v3.1.0..HEAD`의 배포 적합성 — 운영 커밋 `9665ace92` 이후 큐잉·워커·입양 변경이 있는가?

**없다. 운영 코드 경로는 한 줄도 바뀌지 않았다.** 근거:

- `git diff --stat 9665ace92 HEAD -- server/src` = 6 files, **+377 / −0**. `grep '^-[^-]'`가 서비스·리포지토리·컨트롤러·DTO 어디에서도
  삭제 줄을 찾지 못했다. 서비스 hunk는 `@@ -926,6 +926,78 @@` 하나(`getFailures` + `retryFailures`), 리포지토리 hunk는 `@@ -923,4 +923,60 @@`
  하나(`getFailures` + `clearErrorsForAssets`). 따라서 `handleUpload`(`:1835`), `handleQueueAll`(`:1727`), `adoptIfNewlyIdentified`(`:529`),
  `storeGrant`(`:376`), `drainUnstampedUploads`(`:490`), `clearRevokedGrant`(`:467`), `streamPendingUploads`(`repository.ts:582`),
  `ledgerMatches`/`LEDGER_MATCHES_CURRENT_ACCOUNT`(`:44-48`)는 운영 이미지와 동일하다.
- 마이그레이션·스키마 변경 없음(`git diff --stat 9665ace92 HEAD -- server/src/schema server/src/migrations` 빈 출력). 운영 DB에 적용될 것이
  없으므로 롤백은 이미지 교체만으로 된다.
- **새 큐잉 생산자 하나**: `retryFailures`(`:995`) → `queuePendingUploads(auth.user.id)`. 이것은 `resumeUploads`(`:1780`)가 이미 쓰는 것과
  같은 사용자 범위 경로다 — `streamPendingUploads`가 원장·앨범 선택·연결을 모두 걸러 주고, 큐는 `jobId` dedup, 워커는 `hasUpload`를 다시
  본다. 트리거는 본인 세션(`@Authenticated()`, `userId = auth.user.id`)뿐이고, DTO는 `assetIds.max(GOOGLE_DRIVE_FAILURE_PAGE_MAX)`
  (`dto.ts:205-209`)로 제한된다. 8,100행 원장에 대해 이 경로가 재업로드를 일으킬 방법은 없다 — 원장 술어가 바뀌지 않았기 때문이다.
- `v3.1.0`은 HEAD의 조상이고 `git describe`도 `v3.1.0`이다 — 업스트림 다운그레이드 아님.
- web 변경은 설정 페이지(실패 목록·재시도)와 앨범 페이지 표시기(`+page.svelte:364-423`, wave9f/9g의 album-id 가드)뿐. i18n 키 4개
  추가/변경, 정렬 확인.
- 생성물(OpenAPI·TS SDK·Dart)에 `GoogleDriveRetryResultDto`가 추가됐다(`open-api/...:20214`, `fetch-client.ts:1271`). 모바일 앱은 이
  엔드포인트를 쓰지 않으므로 앱 업데이트 없이 서버만 교체해도 된다(엔드포인트 응답이 `void`→객체로 바뀐 것은 추가만 있는 변화다).

배포 자체의 절차적 게이트(CLAUDE.md §7 — redirect 파생 확인, 백업, `features.googleDrive`, 설정 화면 한 번 열기, 게이트 쿼리)는 이 wave와
무관하게 그대로 적용된다. 이 wave가 그 목록에 더할 것은 없다.

## What I did not verify

- **브라우저.** 클릭·토글·토스트·`aria-expanded`·`aria-label`은 happy-dom 테스트와 코드 읽기로만 봤다. 특히 토스트 문구는 어떤 테스트도
  보지 않는다(N2).
- **`mise //:sql` 실제 재생성.** DummyDriver 컴파일 + 같은 포맷터로 대신했다(item 3). 이 방법은 wave9f/10a에서 실제 생성물과 일치한 전례가
  있지만, 실측은 아니다.
- **`mise //:open-api` 재생성 diff.** 새 심볼의 존재만 `grep`으로 확인했다.
- **web ESLint.** 플러그인 크래시로 돌지 못했다(N1). 서버 ESLint는 변경 6파일에 대해 exit 0.
- **운영 인스턴스에 대한 재시도 경로.** 리포트도 "not verified"라 적었고, 나도 실행하지 않았다 — 운영 데이터 쓰기이므로 사용자 확인 사안이다.
- **`9665ace92`가 실제로 운영 이미지의 커밋인지.** 오케스트레이터의 진술을 전제로 했다. 확인하려면 랩탑에서 이미지 라벨/`git rev-parse`
  기록을 본다.
- **N4의 경합 창**(워커가 `revoked`를 쓴 뒤 `deleteCredentials`까지)은 코드 순서로만 판단했고, 동시 업로드 잡 여러 개가 같은 사용자에 대해
  이 경로를 겹쳐 밟는 상황은 재현하지 않았다. 이 wave 이전부터 있던 순서이며 바뀌지 않았다.

## Feeding back into the plan

`dev-docs/google-drive/failure-handling-plan.md`에 넣을 것:

- **재시도의 두 게이트는 서비스 입구(자격증명)와 클래스 필터(`Revoked` 제외)이고, 행 단위 삭제는 입구 게이트에만 의존한다**(N4). 두 번째
  방어선을 다시 제안하지 않도록 이 결정을 적는다.
- **"재시도가 지우지 않는 클래스"의 기준**: 반복 가능한 업로드 시도인가, 다른 행동만이 바꾸는 계정 상태인가. 지금은 `revoked`뿐이며 새 클래스를
  추가할 때 이 표(item 2)에 한 줄을 더한다 — 상수로 만들면 코드가 표가 된다(N6).
- **`resumeUploads`에도 같은 게이트를**(N5) — 별건.
- **web lint 환경**: `tscompat` 플러그인 크래시가 이 워크트리에서 재현된다(N1). 메인에서 `mise //web:lint`가 도는지 한 번 확인하고 결과를
  적어 둔다. 리뷰 요청서의 "ci-unit 통과"는 lint를 포함하지 않는다는 점도 함께.
- **배포 기준선 기록**: 이 배포 후 운영 커밋을 `89f5e729f`로 갱신한다. 다음 배포 게이트의 "운영 이후 변경" 대조는 그 해시에서 시작한다.

---

`git status --porcelain` — 이 리뷰 파일 한 줄(`?? dev-docs/review/google-drive/review/google-drive-wave10b-retry-guards-20260924-1000-review.md`)만.
변이 다섯 건(A~E)과 N1 조사용 파일 교체 두 건은 모두 `cmp`로 원본과 바이트 동일 복원을 확인했다.

**VERDICT: NOT BLOCKED — 배포 적합.** `89f5e729f`로 다음 운영 이미지를 만들어도 된다. 운영 커밋 이후 서버 변경은 순수 추가(+377/−0)이고
워커·큐잉·입양·원장 술어·마이그레이션에 손대지 않았으며, 새 생산자(`retryFailures`)는 기존 `resume`과 같은 사용자 범위 경로를 탄다. N1~N6은
전부 nit이며 배포 뒤 wave10c에서 처리하면 된다.
