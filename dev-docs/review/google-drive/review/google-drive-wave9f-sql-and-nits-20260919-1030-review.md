# Code Review — wave9f: wave9e fold-in (`a651712e4`) — deploy gate

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `9665ace92` (`feat/google-drive-album-sync-v3.1.0`) |
| Commits reviewed | `a651712e4` (fix), `f4e484237` (증거), `9665ace92` (리포트) — `git diff dd5c0eb6b a651712e4 -- server/src web/src i18n` (10 files, +383/−17). 배포 판정을 위해 운영 배포본 `39d4b5900`..HEAD의 `server/src` 전체(12 files, +927/−48)도 읽었다 |
| Report | `../report/google-drive-wave9f-sql-and-nits-20260919-1030-report.md` |
| Reviewed | 2026-09-19 10:35 +0900 (모든 수치는 이 워크트리 HEAD에서 직접 돌린 것) |

## Verdict

**배포 판정: NOT BLOCKED — 이 브랜치는 운영 랩탑에 배포해도 된다.** 운영 배포본 `39d4b5900` 이후의 서버 변경은 일곱 커밋뿐이고,
그 안에 **마이그레이션은 없다**(열 개 모두 `0c47d192e`, 09-05 이전 — 이미 운영 DB에 적용됨), 워커(`uploadAsset`)·큐잉·`hasUpload`·
`recordUpload`·`streamPendingUploads`를 건드린 헝크도 없다. 바뀐 것은 ① CAS 술어가 `refreshToken`에서 `connectionId`로 옮겨간 것
(운영 연결은 이미 식별돼 있어 `adoptIfNewlyIdentified`가 `service.ts:534`에서 즉시 반환한다), ② 로그인 grant(운영은 OAuth 로그인이
꺼져 있어 `utils/google-drive.ts:284-286` 첫 절에서 죽는다), ③ 읽기 전용 추가 두 개(`POST /google-drive/me/uploaded`, `getMyStatus.connected`,
`getAlbumBackupStatus.failedCount`)다. 8,100행의 원장은 어떤 경로에서도 쓰이지 않는다. 배포 전 하드 게이트(redirect 파생)는 이 라운드와
무관하게 그대로 적용된다.

리포트의 핵심 주장인 **재생성 SQL은 검증됐다** — 내가 `DummyDriver`로 독립 컴파일한 블록과 커밋된 `:177-261`이 **바이트 단위로 같고**,
파라미터 `$3..$8` 번호와 이웃 블록·파일 끝 개행도 맞다. 수치(서버 309 / 웹 77 / medium 61 / 전체 2,435+2 / 593+2)와 변이 3건도 전부
재현됐다.

**가장 중요한 문제는 리포트와 커밋 메시지가 존재하지 않는 변경을 보고한다는 것이다(C1).** N1 항목 — "new `driveIndicatorAlbumId` state;
the effect clears counters only when the album id actually changes" — 는 코드에 없다. `git grep driveIndicatorAlbumId HEAD -- web/src`는
0건이고, 이 라운드의 `+page.svelte` diff는 `failed={driveFailed}` 한 줄(`:786`)뿐이며, `$effect`(`:394-411`)는 wave9e 때와 글자 하나
다르지 않다. 런타임 위험은 없다(wave9e N1이 이미 "깜빡임은 틀린 점보다 싸다"고 받아들인 상태 그대로다). 그러나 리포트가 자기 변경을
잘못 기술한 것은 이 저장소의 §1 규칙("붙여넣은 리뷰·분석은 액면가로 받지 않는다")이 리포트에도 똑같이 적용되는 이유이고, 이 판정에서
가장 무거운 발견이다. 배포는 막지 않되, **다음 라운드에서 구현하든 철회하든 리포트를 코드와 맞춰야 한다.**

### Evidence I ran myself

워크트리의 `server/node_modules`·`web/node_modules`는 이전 라운드가 남긴 것을 그대로 썼다. 변이는 `sed`로 넣고 매번 `git checkout --`으로
되돌린 뒤 `cmp`로 변이 전 사본과 바이트 동일함을 확인했다(4건 모두 `restored byte-identical`). SQL 추출용 임시 스펙
`server/src/zz-review-wave9f-sql.spec.ts`는 실행 직후 삭제했고 `ls`로 부재를 확인했다. 메인 저장소에서는 읽기(`grep`, `git status`)
외에 아무것도 하지 않았다.

| Check | Result |
|---|---|
| **SQL 독립 컴파일** — `GoogleDriveRepository.getAlbumBackupStatus(DummyValue.UUID, DummyValue.UUID)`를 Kysely `DummyDriver` + `PostgresAdapter/Introspector/QueryCompiler`로 컴파일, `sync-sql.ts:37`과 같은 `format(sql, { language: 'postgresql' })` 통과 | `diff` 결과 커밋된 `src/queries/google.drive.repository.sql:177-261`과 **바이트 동일**(차이는 내가 잘라낸 `:262`의 블록 구분 빈 줄 하나뿐). 파라미터 `$1 $2`(select 절), `$3 $4 $5`(failedCount), `$6 $7 $8`(from/where) — 리포트대로 |
| SQL 파일 구조 | 블록 헤더 22개 순서가 리포스토리의 `@GenerateSql` 메서드 정의 순서(`repository.ts:61…897`)와 같음. 파일 끝은 `$5\n`(개행 하나) = `sync-sql.ts:181` `data.join('\n\n') + '\n'`. 이 라운드 diff는 `:216-256` 한 헝크뿐 — 이웃 블록 무손상 |
| server unit — `utils/google-drive.spec.ts` + `auth.service.spec.ts` + `google-drive.service.spec.ts` | `3 passed / 245 passed` (37 + 103 + 105) |
| server unit — 전체 (`--config test/vitest.config.mjs`) | `94 passed / 2435 passed \| 2 skipped (2437)` — **리포트와 일치** |
| server medium — `google-drive.repository.spec.ts` (testcontainers Postgres) | `61 passed` — **리포트와 일치** |
| web unit — `GoogleDriveAlbumMenu.spec.ts` + `google-drive-indicator.spec.ts` | `2 passed / 37 passed` (27 + 10) |
| web unit — 전체 (`npx vitest run`) | `60 passed \| 1 skipped / 593 passed \| 2 skipped (595)` — **리포트와 일치** |
| server `npx tsc --noEmit -p tsconfig.json` | exit 0 (4.9s) |
| server `npx eslint` (바뀐 4파일, `--max-warnings 0`) | exit 0 |
| web `npx eslint` (바뀐 3파일) | **환경 크래시** — `tscompat/tscompat` 규칙 `Cannot read properties of undefined (reading 'Class')`. wave9d·9e 리뷰와 같은 상태, 코드 문제 아님 |
| 첨부 증거 `results/20260919-0927.txt` | `commit: a651712e4`, 서버 309 / 웹 77 / medium 61, svelte-check 회귀 없음, `RESULT: PASS` — 주장대로 |
| `i18n/en.json` 정렬 | 위반 0건 (이 라운드는 값만 바꿨고 키는 그대로) |
| **`driveIndicatorAlbumId`** | `git grep … HEAD -- web/src` → **0건**. 메인 저장소 작업 트리(`/home/gwyun/workspace/immich/web/src`)에서도 0건 — 커밋되지 않은 채 남은 것도 아니다 |
| 운영 배포본 확인 | `CLAUDE.md:585` "배포본 `immich-server:3.1.0-gdrive-w8` = 커밋 `39d4b5900`", `git merge-base --is-ancestor 39d4b5900 HEAD` → yes; `v3.1.0` → yes |
| `39d4b5900..HEAD` 마이그레이션 | `git diff --stat -- server/src/schema/migrations` → **비어 있음** |
| `git status --porcelain` (종료 시) | 이 리뷰 파일 하나 — 아래 §"What I did not verify" 끝에 다시 적음 |

**변이.** 줄 번호는 HEAD 기준.

| # | 변이 | 결과 | 판단 |
|---|---|---|---|
| R1 (리포트) | `GoogleDriveAlbumMenu.svelte:249` `{#if failed > 0 && pending > 0}` → `{#if failed > 0}` | `1 failed \| 26` — `should say nothing once the album is fully uploaded, however stale the error rows` | 잡힌다. 리포트가 말한 그 테스트다 |
| R2 (리포트) | `utils/google-drive.ts:317` `split(/[\s,]+/)` → `split(/,/)` | `1 failed \| 36` — `should be false when every login is forced through a fresh consent` | 잡힌다 (`'select_account consent'` 케이스) |
| R3 (리포트) | 같은 줄 → `split(/\s+/)` (wave9e 상태로 되돌림) | `1 failed \| 36` — 같은 테스트 (`'consent,select_account'` 케이스, `spec.ts:261`) | 잡힌다 |
| M-A (추가) | `:249` `failed > 0` → `failed > 1` | **`27 passed`** — 잡히지 않는다 | N1. 스펙의 `failed` 값이 7 / 0 / 4뿐이라 하한 경계가 비어 있다 |

## Findings

### C1 — 리포트·커밋 메시지의 N1(`driveIndicatorAlbumId`)은 구현되지 않았다: 존재하지 않는 변경을 보고했다 (must-fix, 문서·다음 라운드; 배포 게이트는 아님)

- 리포트 표 N1: "new `driveIndicatorAlbumId` state; the effect clears counters only when the album id actually changes".
  커밋 `a651712e4` 본문: "It now tracks which album the counters describe and clears only when that changes."
- 코드: `git grep -n driveIndicatorAlbumId HEAD -- web/src` → 0건. `git diff dd5c0eb6b a651712e4 --stat -- '…/+page.svelte'` →
  `1 insertion(+)`, 그 한 줄은 `:786` `failed={driveFailed}`(N3용). `+page.svelte:394-411`의 `$effect`는 wave9e 리뷰가 인용한
  본문("`const albumId = album.id; driveBackedUp = false; … driveFailed = 0; driveBlockedReason = null;`")과 동일하다 — 즉 `album` 객체가
  바뀔 때마다 여섯 상태를 비우는 동작이 그대로다. `refreshAlbum`(`:152`, 호출처 `:178, :183, :292, :309, :315, :536, :541`)과
  `onAlbumUpdate`(`:330`) 뒤 한 왕복 동안 점이 꺼졌다 켜지는 wave9e N1 증상도 그대로다.
- 메인 저장소 작업 트리에도 없으므로 "커밋에서 빠뜨렸다"가 아니라 **작성 자체가 안 된 채 리포트에 적혔다.** 리포트의 "Please attack 2"는
  존재하지 않는 상태 변수를 공격해 달라고 요청한 셈이다.
- 런타임 영향: 없음. wave9e N1은 nice-to-have였고, 그 리뷰와 wave9c 리뷰 모두 이 깜빡임을 "틀린 점보다 싸다"고 받아들였다. 서버·원장과
  무관하므로 배포를 막을 이유는 아니다.
- **Fix.** 둘 중 하나를 다음 커밋에서. (a) 구현 — `let driveIndicatorAlbumId = $state<string | null>(null)`을 두고 `:394` 효과 첫머리에서
  `if (driveIndicatorAlbumId !== album.id) { …reset…; driveIndicatorAlbumId = album.id; }`; 같은 앨범의 재로드는 `:377`의 stale 가드가 이미
  처리한다. (b) 철회 — 리포트를 정정하고 계획 문서에 "wave9e N1은 미구현, 의도적으로 남김"을 적는다. 어느 쪽이든 **커밋 메시지는 이미
  틀린 채 남는다** — 다음 커밋 본문에서 `a651712e4`의 N1 문단이 사실이 아니었음을 명시해 두는 편이 `git log`를 읽는 다음 사람에게 낫다.
  그리고 이 라운드에서 실제로 무엇이 바뀌었는지 리포트를 쓰기 전에 `git diff --stat`으로 한 번 대조하는 절차를 §2에 넣기를 권한다.

### N1 — 메뉴 실패 줄의 하한 경계(`failed === 1`)를 보는 테스트가 없다 (nitpick, 테스트)

- `GoogleDriveAlbumMenu.spec.ts:265-284` 세 케이스의 `failed`는 7 / 0 / 4. 변이 M-A(`failed > 0` → `failed > 1`)가 27건 전부 통과한다.
  `failed: 1`이면 "1 failed — press to retry"가 보여야 하는데, 지금은 그 조건이 `> 0`인지 `> 1`인지 어떤 테스트도 말하지 않는다.
- **Fix.** 첫 케이스를 `failed: 1`로 바꾸거나(`/1 failed/`) 케이스 하나를 더한다. 두 줄짜리.

### N2 — `uploadedCount`는 한 자산에 `''` 행과 현재 계정 행이 **둘 다** 있으면 두 번 센다; 그래서 `failed > pending`이 이론상 가능하다 (nitpick, 기존 코드, 이 라운드 범위 밖)

- 리포트 항목 3의 답을 찾다가 본 것. `repository.ts:476-488` `uploadedCount`는 `google_drive_upload`를 **inner join**하고 `countAll`한다.
  조인 술어 `ledgerMatches`(`= <account> or = ''`)는 같은 `(userId, assetId)`의 `''` 행과 계정 행을 **둘 다** 통과시키고,
  `1787100000000-AddGoogleDriveUploadAccountId.ts:29`가 PK를 `("userId", "assetId", "driveAccountId")`로 바꿨으므로 두 행이 공존할 수 있다.
  wave1.5 리뷰(`…-wave1.5-impl-…-review.md:118`)가 "no double-count"의 근거로 든 "ledger PK `(userId, assetId)`"는 그 뒤로 사실이 아니다.
- 그 상태에서 `pending = max(total − uploaded, 0)`(`GoogleDriveAlbumMenu.svelte:88`)은 실제보다 작고, `failedCount`(`:494-512`, `assetId is
  null` 필터라 다중성에 영향받지 않음)는 정확하므로 `failed > pending`이 된다. 화면에는 "M waiting" 아래 "N failed"(N > M)가 뜬다 — 틀렸지만
  "터무니없는" 것은 아니고, `pending`이 0으로 잘리면 실패 줄은 `:249`에서 함께 숨는다.
- **도달 가능성은 낮다.** 두 행이 생기려면 같은 사용자가 같은 자산을 두 번 올려야 하는데 세 겹 게이트(`hasUpload`가 `''` 행도 "올림"으로
  봄, `service.ts:1099`)가 막고, 연결이 직접 쓴 `''` 행은 입양의 충돌 삭제(`repository.ts:198-213`, medium `:906-932`)가 정리한다. 운영의
  6,996행은 `connectionId`가 비어 입양되지 않지만 그 자산들은 `hasUpload`에 걸려 다시 올라가지 않는다. 운영 환경에서 이 상태가 발생할
  경로는 사실상 없다.
- **Fix(원하면).** `uploadedCount`를 `count(distinct album_asset.assetId)` 또는 `exists(...)` 형태로 바꾼다. `@GenerateSql` 블록도 함께.
  이 라운드 범위 밖이고 배포와 무관하다 — 계획 문서에만 남겨 두면 된다.

### N3 — 잡동사니 (nitpick)

- `auth.service.ts:290-304` 주석 블록은 이제 일관된다: "the Google-specific parameter goes out"(단수), `include_granted_scopes`는
  "was here too and has been dropped" 문단만 남았다. wave9e N2 해소 확인.
- `utils/google-drive.ts:259-282` docblock에 secret 절·prompt 절이 들어갔고 인라인 주석(`:293-300`, `:303-311`)과 같은 말을 한다.
  다만 docblock은 "fail every refresh"라고만 하고 인라인은 `invalid_client`를 든다 — 모순은 아니다.
- `GoogleDriveAlbumMenu.svelte:38-45` `failed` prop docblock이 wave9e N3의 근거를 그대로 적어 두었다. 좋다.
- 웹 ESLint 크래시(`tscompat`)는 세 라운드째 같은 환경 문제다. `run.sh`가 svelte-check 기준선으로 대신 막고 있지만, 언젠가 워크트리의
  `node_modules`를 다시 설치해 재현되는지 보는 편이 좋다.

## Answers to what the report asked me to attack

### 1. 재생성 SQL 블록 — 바이트 동일한가, 파라미터 번호는 맞는가, 이웃 블록·파일 끝은 무사한가

**셋 다 예.** 리포지토리 코드 자체(`repository.ts:452-515`)를 `DummyDriver`로 컴파일하고 `sync-sql.ts:37`과 같은 포매터를 통과시킨 결과가
커밋된 `:177-261`과 `diff`에서 **한 글자도 다르지 않다.** 파라미터는 `uploadedCount` 서브쿼리의 `$1`(원장 조인)·`$2`(`coalesce` 서브쿼리),
`failedCount`의 `$3`(에러 조인)·`$4`(원장 조인)·`$5`(`coalesce` 서브쿼리), from/where의 `$6 $7 $8` — Kysely가 등장 순서대로
번호를 매기므로 이 순서가 유일한 정답이고 리포트의 "shift to $3..$8"과 일치한다. 이 라운드의 `.sql` diff는 `:216-256` 한 헝크뿐이라
`getSubscribableAlbums`(`:112`)와 `countPendingUploads`(`:263`) 블록은 건드려지지 않았고, 파일 끝은 `$5\n`으로 생성기의
`data.join('\n\n') + '\n'`과 같다. 블록 헤더 22개의 순서도 클래스의 메서드 정의 순서와 같다. **실제 생성기로는 돌리지 않았다** — dev DB가
여전히 이 브랜치의 마이그레이션 이전이라는 wave9e의 진단은 그대로이고, 그 경로는 이 리뷰의 범위를 넘는다(§"What I did not verify").

### 2. `driveIndicatorAlbumId` — id가 같은데 리셋해야 하는 경로, 세팅됐는데 로드가 안 도는 경로

**전제가 틀렸다 — 그 상태 변수는 존재하지 않는다(C1).** 그래서 질문을 현재 코드(`+page.svelte:394-411`, 매번 리셋)와 리포트가 *의도한*
설계 둘에 대해 답한다.

- 현재 코드: "id가 같은데 리셋이 필요한 경로"는 자동으로 다 커버된다 — 어차피 `album`이 바뀔 때마다 리셋한다. "세팅됐는데 로드가 안
  도는 경로"는 `featureFlagsManager.value.googleDrive && album.assetCount > 0`이 거짓일 때인데, 그때는 리셋만 하고 끝나므로 stale 값이
  남지 않는다(비운 뒤 안 채움 = 점 없음, 옳다).
- 의도한 설계(id가 바뀔 때만 리셋): (a) 다른 탭에서 Drive 연결 해제 — 이 탭은 아무 이벤트도 받지 않으므로 어느 설계든 다음 로드까지
  stale이다. 그런데 `loadGoogleDriveMenu`(`:434-476`)가 메뉴를 열 때 `driveConnected`를 다시 읽고(`:456`), `loadGoogleDriveIndicator`는
  `getMyGoogleDriveStatus().connected`(`:391`)를 읽으므로 "다음 로드"는 메뉴 열기 또는 앨범 이동이다. 리셋 정책과 무관. (b) 백업 끄기 —
  `handleToggleGoogleDriveBackup`(`:480-497`)은 `loadGoogleDriveMenu`를 다시 불러 `driveBackedUp`을 `false`로 덮는다(`:459`). 리셋 불필요.
  (c) 세팅됐는데 로드가 안 도는 경우 — 의도한 설계에서 `driveIndicatorAlbumId = album.id`를 **리셋 블록 안에서** 하면 `assetCount === 0`
  앨범으로 이동 시 리셋은 되고 로드는 안 돌지만 값은 비어 있으니 옳다. 다만 `driveIndicatorAlbumId`를 **로드 성공 시**에만 세팅하는 변형은
  위험하다: 실패한 로드 뒤 같은 앨범에서 `album` 객체가 다시 바뀌면 리셋이 또 돌아 결국 지금과 같아진다. 구현할 때 리셋 블록 안에서
  세팅하는 형태로.

### 3. 메뉴 `failed` 줄 — `failed > pending`이 가능한가, 그때 숨겨야 하는가

**구조적으로는 `failed ⊆ pending`이 맞지만, N2의 다중성 때문에 `pending`이 과소 계산되는 경우에 한해 `failed > pending`이 가능하다.**
정상 데이터에서는 두 서브쿼리가 같은 세 술어(앨범·`deletedAt is null`·`ledgerMatches`)를 쓰므로 실패 자산은 반드시 미업로드 자산이고,
헬퍼의 `failed >= pending`(`google-drive-indicator.ts:54`)은 사실상 등호다. `failed > pending`이 됐을 때 렌더링은 "M waiting / N failed"로
숫자가 뒤집힐 뿐 붕괴하지 않고, `pending === 0`이면 `:249`가 줄을 숨긴다. **숨기지 말 것을 권한다** — `failed > pending`은 데이터 이상의
신호이고, 실패 줄이 곧 재시도 안내이므로 그 자산이 실제로 실패한 것이라면 사용자가 할 다음 행동은 여전히 같은 행(Sync)이다. 고칠 곳은
표시 조건이 아니라 `uploadedCount`의 `distinct`(N2)다.

### 4. 배포 적합성 — 큐잉·워커·입양이 바뀌었는가, 운영 인스턴스를 깨뜨릴 것이 있는가

**적합하다. 큐잉·워커는 바뀌지 않았고, 입양은 술어만 바뀌었으며 운영 연결에서는 그 경로가 실행되지 않는다.** 근거는 운영 배포본
`39d4b5900`(`CLAUDE.md:585`)과 HEAD 사이의 `server/src` diff 전체다.

| 영역 | `39d4b5900..HEAD` | 운영 영향 |
|---|---|---|
| 마이그레이션 | **없음** (`git diff --stat -- server/src/schema/migrations` 비어 있음; 10개 모두 `0c47d192e` 09-05 이전) | 부팅 시 스키마 변경 0. 8,098행 원장 무손상 |
| 워커 `uploadAsset`(`service.ts:1061`), `hasUpload`(`:1099`), `recordUpload`, `streamPendingUploads`, `countPendingUploads`, `getSubscribers`, 이벤트 큐잉 | diff에 헝크 없음 | 변화 없음 |
| CAS: `setDriveAccountId`·`adoptUnstampedUploads`·`fillFolderName`이 `refreshToken` 대신 `connectionId`로 매칭 (`repository.ts:109-124, 155-222, 263-275`) | `c9523c5de` | 운영 연결은 식별됨(`driveAccountId` 있음, `CLAUDE.md:586`) → `adoptIfNewlyIdentified`가 `service.ts:534`에서 반환, `stampDriveAccountId` 경로도 `:501`에서 반환. `fillFolderName`은 `folderName is null`일 때만 갱신하고 `connectionId`는 스키마상 non-null이라 같은 행을 가리킨다 |
| 로그인 grant (`auth.service.ts:496-506`, `service.ts:425-435`, `utils/google-drive.ts:283-330`) | `cfc8cdb93`, `25d2c284f` | 운영은 OAuth 로그인 비활성 → 게이트 첫 절 `!oauth.enabled`(`:284`)에서 거짓, `authorize`는 `extraParams` 없이 호출(`auth.service.ts:305`), 이벤트는 발행되지 않음. 만에 하나 발행돼도 리스너는 `isEnabled` 재확인 뒤 **기존 연결이 있으면 건드리지 않는다**(`:430-434`) — 운영에는 연결이 있다 |
| 새 읽기 API `POST /google-drive/me/uploaded`(`controller.ts:269-283`), `getMyStatus.connected`(`service.ts:949`), `getAlbumBackupStatus.failedCount`(`repository.ts:494-512`) | `2f83943cb`, `97c745e83`, `4582d6e1b` | DB 읽기 전용, 구글 호출 없음. `failedCount`는 앨범을 열 때 한 번 도는 상관 서브쿼리 하나 추가 — 8,100행 규모에서 무시할 수준 |
| 저장된 설정 row | 새 키를 읽는 코드 없음. `isEnabled`·`isGoogleDriveEnabled` 불변 | row가 자격증명을 계속 공급한다. **배포 전 하드 게이트(redirect 파생)는 이 라운드와 무관하게 그대로** — `CLAUDE.md` §7 1번 |
| 웹 | 타임라인 배지, 툴바 점, 메뉴 실패 줄 | 같은 이미지에 실림. 서버 계약은 추가만(`failedCount`, `connected`, 새 엔드포인트) — 구 모바일 앱은 모르는 필드를 무시한다 |

**롤백 경로**: 마이그레이션이 없으므로 `39d4b5900` 이미지로 되돌리는 것은 `image:` 한 줄 교체로 끝난다. 이 시리즈가 쓰는 유일한 새
데이터는 없다.

## What I did not verify

- **실제 생성기(`mise //:sql`)** 는 돌리지 않았다. dev DB가 브랜치 마이그레이션 이전이라는 wave9e 진단을 그대로 받았고, 스크래치 DB에
  마이그레이션을 적용하는 것은 이 워크트리 밖의 일이다. `DummyDriver` 컴파일이 생성기와 같은 SQL을 낸다는 것은 두 경로가 같은
  `PostgresQueryCompiler`와 같은 포매터 호출을 쓴다는 코드 근거(`sync-sql.ts:37, 84-89`)에 기댄 추론이다.
- 브라우저 렌더링, `run.sh`(결과 파일을 새로 만들므로 이 워크트리에서는 돌리지 않았다), svelte-check(증거 파일의 기준선 판정만 읽었다).
- 웹 ESLint — 환경 크래시로 실행 불가.
- 운영 인스턴스는 어떤 것도 조회하지 않았다. "연결 식별됨", "8,098행", "OAuth 로그인 비활성"은 `CLAUDE.md:585-587`과 리뷰 요청서의
  진술을 받아들인 것이다. 만약 운영의 `user_google_drive.driveAccountId`가 실제로는 null이라면 §답변 4의 CAS 행은 "입양 경로가 돈다"로
  바뀐다 — 그 경우에도 `connectionId` 매칭은 같은 행을 가리키므로 결과는 wave8d 배포본과 동일할 것이나, 그것은 확인이 아니라 추론이다.
- `git status --porcelain` (이 파일을 쓴 뒤): `?? dev-docs/review/google-drive/review/google-drive-wave9f-sql-and-nits-20260919-1035-review.md`
  하나. 변이한 네 파일은 `cmp`로 원본과 바이트 동일함을 확인했고, 임시 스펙은 삭제됐다.

## Feeding back into the plan

- **wave9e N1(`driveIndicatorAlbumId`)은 미구현이다.** 계획 문서에 "wave9f 리포트가 구현됐다고 적었으나 코드에 없음"을 명시하고, 구현할지
  철회할지 결정한다. 구현한다면 리셋 블록 안에서 id를 세팅하는 형태로(§답변 2-c).
- **리포트 작성 절차**: 리포트의 변경 표를 쓰기 전에 `git diff <base> <head> --stat`을 표 옆에 붙인다. 이번처럼 표의 행과 diff의 파일이
  어긋나면 그 자리에서 보인다.
- `uploadedCount`의 다중성(N2)은 PK가 세 열이 된 뒤로 남은 잠재 오류다. 다음에 `getAlbumBackupStatus`를 건드릴 때 `distinct`로 고치고
  medium 스펙에 "`''` 행과 계정 행이 둘 다 있는 자산은 한 번만 센다"를 넣는다.
- 배포 후 체크리스트(§7)에 이 라운드가 새로 요구하는 항목은 없다. 마이그레이션 0건, 워커 불변 — `39d4b5900` 이미지가 롤백 대상으로 남는다.

**VERDICT: NOT BLOCKED** — 배포 가능. C1(리포트가 존재하지 않는 N1 변경을 보고함)은 다음 라운드에서 구현 또는 철회로 정리한다.
