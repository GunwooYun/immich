# Code Review — wave9c: wave9a 반영(연결 해제 점) + CAS를 `connectionId`로 (`97c745e83`, `c9523c5de`)

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `f47d59906` (`feat/google-drive-album-sync-v3.1.0`) |
| Commits reviewed | `97c745e83` (wave9a 반영), `c9523c5de` (CAS 이동), `f8841b9d2` (증거), `1523d1c91`·`f47d59906` (리포트) — wave9b 커밋(`d934ede84`, `00e87c6cd`, `f5b1128bc`)은 요청대로 제외 |
| Report | `../report/google-drive-wave9c-disconnected-dot-and-cas-20260916-2335-report.md` |
| Prior review | `./google-drive-wave9a-album-menu-state-20260916-2315-review.md` (BLOCKED: C1, C2) |
| Reviewed | 2026-09-19 (모든 수치는 이 워크트리 HEAD에서 직접 돌린 것) |

## Verdict

**배포 판정: 막지 않는다 (NOT BLOCKED).** wave9a의 C1·C2는 코드에서 확인되는 방식으로 닫혔다. `GoogleDriveMyStatusDto.connected`는
서비스가 `getCredentials`를 `Promise.all`에 넣어 `!!credentials`로 만들고(`google-drive.service.ts:886-899`), 토큰은 응답에 실리지
않으며, 헬퍼는 `disconnected`를 `blocked`보다 먼저 판정하고(`google-drive-indicator.ts:38-43`), 페이지는 두 응답을 둘 다 받았을 때만
반영한다(`+page.svelte:380-389`). 린트 오류는 `total > uploaded`로 사라졌고 eslint가 헬퍼·스펙에서 exit 0이다. CAS 이동은
세 메서드 모두 `connectionId`로 바뀌었고 토큰을 동일성으로 비교하는 코드는 서버에 하나도 남지 않았다. 리포트의 수치(285 / 69 / 60 /
2395+2)와 변이 8건(웹 3, medium 4 — 그중 하나는 "2 failed")은 **전부 그대로 재현**됐고, 내가 추가한 변이 3건도 잡혔다.

가장 중요한 문제는 리포트가 2번으로 스스로 물은 것이다. `loadGoogleDriveIndicator`는 로드 전에 상태를 비우지 않아서, 앨범 A에서
앨범 B로 이동하면 **B의 응답이 오기 전까지 A의 점이 B 위에 뜨고, B의 호출이 실패하면 영구히 A의 점이 남는다**(N1). 두 DB 전용 호출이
동시에 실패해야 하는 드문 경우라 배포를 막을 이유는 아니지만, 한 줄로 고칠 수 있고 리포트가 물은 "acceptable?"의 답은 "아니오"다.
생성 SQL의 부분 갱신(5번)은 내가 같은 환경에서 `sync-sql`을 실제로 돌려 원인을 확정했다 — 이 데스크탑의 dev Postgres에
`driveAccountId`·`connectionId` 컬럼이 없어 첫 문장이 에러로 끝나고 두 번째 문장이 기록되지 않는 것이며, CI는 갓 마이그레이션한
DB를 쓰므로 통과한다.

### Evidence I ran myself

`run.sh`는 `results/`에 파일을 남기므로 쓰지 않고, 그 안의 스펙 목록(`run.sh:81-116`)을 같은 명령으로 재현했다. 변이는 `sed`로
넣고 매번 `git checkout --`으로 복원한 뒤 md5를 HEAD와 대조했다.

| Check | Result |
|---|---|
| server — `run.sh`의 8스펙 | `8 passed / 285 passed` — **리포트 285와 일치** |
| web — `run.sh`의 8스펙 | `8 passed / 69 passed` — **리포트 69와 일치** |
| server — medium (testcontainers, 실 Postgres) `google-drive.repository.spec.ts` | `60 passed` — **리포트 60과 일치** |
| server — 전체 `npx vitest run --config test/vitest.config.mjs` | `94 files / 2395 passed \| 2 skipped` — **리포트 2395/2와 일치** |
| web — 전체 `npx vitest run` | `60 passed \| 1 skipped / 585 passed \| 2 skipped` (wave9a 때 574 → wave9b 뱃지 스펙이 더해진 수) |
| server — `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| web — `npx eslint google-drive-indicator.ts google-drive-indicator.spec.ts --max-warnings 0` | **exit 0** (wave9a C2 닫힘) |
| server — `npx eslint` repository·service·service.spec·dto·test/utils·medium spec `--max-warnings 0` | exit 0 |
| `mise //:sql` 상당 (`nest build` 후 `DB_URL=…localhost:5432/immich node dist/bin/sync-sql.js`) | 52파일 재생성, **`google.drive.repository.sql`만 20줄 삭제** — 리포트가 말한 두 메서드의 두 번째 문장. stderr에 `setDriveAccountId error: column "connectionId" does not exist`, `fillFolderName error: column "connectionId" does not exist`, `getErrorSummary error: column google_drive_upload.driveAccountId does not exist`, `getCredentials error: column "driveAccountId" does not exist`. 실행 후 `git checkout -- src/queries`, md5 HEAD와 동일 확인 |
| `i18n/en.json` 정렬 (대소문자 무시) | 1,729키 정렬됨, `google_drive_status_disconnected` 존재 |
| 첨부 증거 `results/20260916-2331.txt` | `commit: c9523c5de`, UNCOMMITTED 마커 없음, 285 / 69 / svelte-check 회귀 없음 / medium 60, `RESULT: PASS` — 주장대로. `git diff --stat f8841b9d2 HEAD`는 리포트 파일 1개뿐 |
| `07c7b937d` (리포트 "N1 already fixed") | `run.sh` +6, `README.md` +3 — 헬퍼 스펙이 러너에 들어간 커밋 맞음 |
| `git log -S driveConnected -- +page.svelte` | `5c6435e82`(Wave 2)에서 선언, `97c745e83`은 대입만 추가 — 선언 누락 아님 |
| `git merge-base --is-ancestor v3.1.0 HEAD` | ancestor 맞음 |
| `git status --porcelain` (종료 시) | **이 리뷰 파일 하나뿐.** 단, `server/dist/`(gitignored)는 `sync-sql`을 위해 다시 빌드했으므로 워크트리에 있던 옛 빌드 산출물과 바이트 동일하지 않다 — 추적 파일은 아니다 |

**변이 전수.** 웹 기준선 31(헬퍼 스펙 7 + 메뉴 스펙 24), 서버 서비스 스펙 102, medium 60.

| # | 변이 | 결과 | 판단 |
|---|---|---|---|
| W1 | 헬퍼 `:38` `!connected` 분기 무력화 | `1 failed` — *reports disconnected … over every other state* | 리포트 그대로 |
| W2 | 메뉴 `:119` `>=` → `>` | `1 failed` — *should warn at exactly the critical line* | 리포트 그대로 (wave9a N2 닫힘) |
| W3 (추가) | 헬퍼: `disconnected` 판정을 `blocked` 아래로 | `1 failed` — 같은 테스트의 `quota_exceeded` 케이스 | 우선순위가 테스트에 박혀 있다 |
| S1 | 서비스 `:899` `connected: false` | `1 failed` — *should report the connection alongside the counts* | 리포트 그대로 |
| S2 (추가) | 서비스 `:504` `setDriveAccountId`에 `credentials.refreshToken` 전달 | `1 failed` — *should identify the account and adopt its rows when the settings page loads* | 커밋 메시지의 "tsc는 못 잡고 이 단언이 잡는다"가 사실 |
| M1 | repo `:122` `setDriveAccountId`의 `connectionId` where 삭제 | `1 failed` — *refuse to stamp … replaced* | 리포트 그대로 |
| M2 | repo `:174` adopt 락의 `connectionId` where 삭제 | `1 failed` — *refuse to adopt when the connection moved* | 리포트 그대로 |
| M3 | repo `:268` `fillFolderName`의 `connectionId` where 삭제 | `1 failed` — *do nothing when only the connection changed* | 리포트 그대로 |
| M4 | repo `:94` `upsertCredentials` 재발급 삭제 | `2 failed` — *stop claiming its own rows once re-linked*, *mint a new connection identity* | 리포트 "2 failed" 그대로 |

## Findings

### N1 — 툴바 점 상태가 앨범 이동 시 비워지지 않는다: 이전 앨범의 점이 새 앨범 위에 뜬다 (nice-to-have, 다음 라운드에서 고칠 것)

`loadGoogleDriveIndicator`(`+page.svelte:371-390`)는 응답이 둘 다 성공했을 때만 다섯 상태를 **덮어쓰고**, 그 전에 아무것도 비우지
않는다. 이 페이지는 앨범 간 이동에서 컴포넌트가 재사용된다 — `album = $derived(data.album)`(`:228`)이고, `:376-379`의 stale 가드
("Navigated to another album while this was in flight")가 바로 그 사실을 전제로 쓰였다. 따라서:

- A(구독, 완료 → 초록)에서 B(미구독)로 이동하면 B의 두 응답이 돌아올 때까지 **B 위에 A의 초록 점**이 뜬다. 한 왕복 길이의 깜빡임.
- B의 호출 중 하나라도 실패하면 both-or-neither가 `return`(`:383`)해 **A의 점이 B에 영구히 남는다.** wave9a 리뷰 §1이 "stale 가드"를
  확인했지만 그것은 늦게 온 응답을 버리는 쪽이고, 남아 있는 옛 값을 지우는 쪽은 없었다.

리포트 2번의 답은 그래서 "같은 앨범의 재로드 실패는 허용 가능(이전 값이 그 앨범의 값이다), **다른 앨범으로의 이동 뒤 실패는 아니다**"이다.

**고치는 법 (한 곳).** `$effect`(`:393-398`) 안에서 로드를 부르기 전에 다섯 값을 기본값으로 되돌린다 — `driveBackedUp = false`만으로도
헬퍼가 `null`을 돌려주니 점은 사라진다(`google-drive-indicator.ts:35-37`). 같은 앨범 재실행(자산 추가 뒤)에는 한 왕복 동안 점이 꺼졌다
켜지는 대가가 있는데, 잘못된 점보다 싸다. 대안으로 `albumId`를 상태에 함께 저장해 `driveIndicator` 파생에서 `album.id`와 다르면 `null`을
주는 방법도 있다(깜빡임 없음, 코드 두 줄 더).

### N2 — 메뉴 로더가 both-or-neither를 되돌린다: 메뉴를 여는 순간 실패한 호출이 점을 "not connected"로 만든다 (nice-to-have)

`loadGoogleDriveMenu`(`+page.svelte:438-446`)는 wave9a 이전부터 실패 시 기본값을 쓰는 로더였다 — `driveConnected = status.status ===
'fulfilled' && status.value.connected`(`:438`), `driveBackedUp = albumStatus.status === 'fulfilled' && …`(`:440`). 그때는 이 값이
메뉴만 그렸으니 "Connect" 행이 잠깐 잘못 뜨는 정도였다. 이제 같은 다섯 변수가 점도 그리므로(`:400-408`), 메뉴를 열었을 때
`getGoogleDriveStatus`만 실패하면(앨범 상태는 성공) 점이 **호박색 "not connected"** 로 바뀐다 — 인디케이터 로더가 `:380-383`에서
막으려던 바로 그 상태를 메뉴 로더가 만든다. 두 로더가 `connected`의 출처도 다르다(`getStatus` vs `getMyStatus`). 정상 상태에서는
둘 다 `!!credentials`라 같지만(`service.ts:645`·`:698` vs `:899`), 실패 처리가 다르다.

**고치는 법.** 메뉴 로더에서 점을 그리는 다섯 변수는 해당 호출이 `fulfilled`일 때만 대입한다(그 외에는 이전 값 유지). 메뉴 전용
변수(`driveStorage`, `driveFolderId`)는 지금처럼 `null`로 떨어뜨려도 된다 — 없는 게이지는 없는 게이지다.

### N3 — 메뉴 열기에서 취소 감지 경합: 같은 `allSettled` 안의 `storage`가 행을 지우는 동안 `status`는 `connected: true`를 읽는다 (nitpick)

`loadGoogleDriveMenu`는 `getGoogleDriveStorage`와 `getGoogleDriveStatus`를 동시에 보낸다(`:429-437`). storage는 `invalid_grant`에서
`clearRevokedGrant`(`service.ts:417-423`)로 행을 지우고 400을 던지는데, status는 그보다 먼저 `getCredentials`를 읽었을 수 있다. 그
경우 이번 열기에서는 메뉴가 연결된 것처럼 그려지고 점도 초록/파랑이며, **다음 열기(또는 다음 인디케이터 로드)에서야** 호박색이 된다.
기능 이전부터 메뉴에 있던 경합이고 점이 물려받은 것이다. 자가 치유되므로 nitpick.

### N4 — 영구 실패 자산이 있는 앨범은 영원히 파랑 "backing up"이다 (nice-to-have, 설계 결정 필요)

리포트 1번이 물은 "backed-up인데 파랑/초록이면서 아무것도 안 올라가는 상태"가 하나 더 있다. 헬퍼는 `syncing`/`synced`를
`total > uploaded`로만 가른다(`google-drive-indicator.ts:44`). `source_unreadable` 같은 영구 실패는 원장에 들어가지 않고
`google_drive_upload_error`에만 남으므로 `uploadedCount`가 `assetCount`에 영원히 못 미친다 — 이 배포본이 실제로 겪은 상태다
(`CLAUDE.md` Current Project Task 2, 2건). 그 앨범의 나머지가 다 올라간 뒤에도 점은 **파랑 "backing up"** 이고, 워커는 더 이상
아무것도 하지 않는다.

`GoogleDriveMyStatusDto.failed`가 이미 응답에 있으니(`google-drive.dto.ts:140`) 헬퍼에 넘겨 `total > uploaded && failed > 0`을
별도 상태(예: `attention`, 호박색)로 둘 수 있다. 단 `failed`는 사용자 전체 수라 다른 앨범의 실패가 이 앨범을 물들인다 — 앨범 단위
실패 수는 `GoogleDriveAlbumStatusDto`에 없다(`:177-183`). 정확히 하려면 앨범 상태에 `failedCount`를 더해야 하고, 그것은 이 라운드
범위 밖이다. 어느 쪽이든 결정을 계획 문서에 남길 것.

### N5 — `getMyStatus`가 존재 여부 하나를 위해 refresh token을 메모리에 올린다 (nitpick)

`getCredentials`(`repository.ts:62-69`)는 `refreshToken`을 포함한 일곱 컬럼을 읽고, 리포지토리 주석(`:57-59`)은 "이것이 토큰을 읽는
유일한 경로"라고 못박아 사용처를 좁히려 했다. `getMyStatus`(`service.ts:886`)는 그 결과를 `!!credentials`(`:899`)로만 쓴다 — 3초/15초
폴링(`google-drive-progress-manager.svelte.ts:54-56`) 경로에 토큰 읽기가 하나 더 생긴 셈이다. 비용은 PK 단건 조회라 무시할 수준이고
응답에 실리지도 않으니 nitpick이지만, `select userId … executeTakeFirst`만 하는 `hasCredentials`가 있으면 주석의 약속이 더 오래 간다.

### N6 — `setDriveAccountId` 주석이 여전히 "account B's token"이라고 말한다 (nitpick, 문서)

`repository.ts:115-116`의 새 주석은 "Without it the row could end up holding account A's id beside account B's **token**"으로
끝나는데, 이 라운드가 바꾼 것이 바로 "토큰이 아니라 연결"이다. medium 스펙 이름("onto a connection that has been replaced")과
서비스 스펙 주석("account A's id on account B's connection", `service.spec.ts:1858-1860`)은 이미 새 말을 쓴다. `token` → `connection`
한 단어. 같은 줄(`:115`, 117자)이 파일에서 가장 긴 주석 줄이기도 하니 그때 접으면 된다.

## Answers to what the report asked me to attack

### 1. C1 fix completeness — 다른 거짓 초록/파랑 상태? 서버 측 비활성? 메뉴와 점이 같은 말을 하나?

- **서버 측 비활성.** 버튼과 로더 모두 `featureFlagsManager.value.googleDrive`에 걸려 있다(`+page.svelte:730`, `:395`). 그 값은
  `/server/features`의 `isGoogleDriveEnabled`라서, 자격증명이 비거나 redirect를 파생할 수 없으면 버튼 자체가 없고 호출도 없다.
  남는 틈은 **세션 도중** 서버가 꺼진 경우뿐이다 — 플래그는 로드 시점 값이고 `getMyStatus`·`getAlbumBackupStatus`는 enabled를 보지
  않으므로(`isEnabled()` 호출처는 `service.ts:868, 1015, 1468, 1537, 1606, 1652` — 큐잉·워커·구독 경로) 점은 그대로 켜져 있다.
  워커는 `:1015`에서 `skipped`한다. 새로고침이면 사라지므로 지적하지 않는다.
- **접근 상실(`accessLost`).** `getAlbumBackupStatus`는 `google_drive_album`은 있는데 `album_user`가 없을 때 `accessLost`를 준다
  (`repository.ts:465-467`). 점은 이 값을 보지 않지만, 그 상태의 앨범은 `requireAccess(AlbumRead)`(`service.ts:1449`)에서 막혀
  페이지 자체를 열 수 없다. 도달 불가.
- **영구 실패.** N4 — 이것이 남은 진짜 거짓 파랑이다.
- **`revoked` 에러 행만 남은 사용자.** 행이 없으니 `connected: false` → `disconnected`. 옳다.
- **한 번도 연결 안 한 구독자.** 구독은 자격증명을 요구한다(`service.ts:1473-1475`). `backedUp && !connected`는 해제·취소 뒤에만 생긴다.
- **메뉴와 점의 일치.** `connected=false`면 메뉴는 "Connect" 행 하나(`GoogleDriveAlbumMenu.svelte:170-186`), 점은 호박색
  "not connected". 같은 말이다. 정상 상태에서는 두 출처(`getStatus`의 `:645`/`:698`, `getMyStatus`의 `:899`)가 모두 `!!credentials`다.
  어긋나는 것은 실패 처리(N2)와 취소 경합(N3)뿐이다.

### 2. Both-or-neither — 성공 뒤 실패한 재로드가 이전 값을 남기는 것은 괜찮은가?

**같은 앨범이면 괜찮고, 앨범이 바뀌었으면 아니다.** 자세한 것은 N1. 같은 앨범의 재로드 실패는 마지막으로 알던 사실을 유지하는
것이라 오히려 옳다(자산 추가 직후 실패 → 조금 낡은 점). 앨범 이동 뒤 실패는 다른 앨범의 사실을 이 앨범에 붙이는 것이다.
`albumId !== album.id` 가드(`:376`)는 늦은 응답을 버릴 뿐 남은 값을 비우지 않는다.

### 3. CAS 의미 — `connectionId`는 그대로인데 토큰만 바뀌는 경로가 있나?

**없다.** `refreshToken`을 쓰는 곳은 `upsertCredentials` 하나뿐이고(`repository.ts:79-99`; `grep -rn refreshToken server/src`에서
쓰기는 `:83`·`:92`), 그 문장이 `connectionId: uuid_generate_v4()`를 **같은 statement**에서 재발급한다(`:94`). `user_google_drive`를
갱신하는 나머지 셋은 `setDriveAccountId`(`:119`)·`setFolderId`(`:239`)·`fillFolderName`(`:265`)이고 토큰을 건드리지 않는다. 서비스에는
`oauth2Client.on('tokens')` 리스너가 없고, 토큰은 항상 `setCredentials({ refresh_token })`의 입력으로만 쓰인다(`service.ts:537, 771,
812, 934, 1113`) — Google은 access token 갱신에서 refresh token을 회전시키지 않으므로 써 돌려줄 것도 없다.

반대 방향이 오히려 흥미롭다. Google이 재동의에서 **같은** refresh token을 돌려주면(`linkAccount` 주석 `:338-345`가 그 가능성을 적어
뒀다) 옛 토큰 CAS는 재연결을 **통과**시켰다 — 새 연결이 옛 연결의 미상 행을 입양할 수 있었다. 새 CAS는 재발급된 id로 거부한다. 즉
새 것이 옛 것보다 엄격하지 느슨하지 않다. 받아들이는 쪽이 옳은 경우는 "같은 연결, 같은 행"뿐이고 그것은 두 CAS가 같다.

### 4. 토큰을 동일성으로 비교하는 독자가 남았나?

**없다.** 서버 소스(스펙 제외)에서 `refreshToken` 등장 21곳은 전부 (a) 스키마·마이그레이션, (b) `getCredentials`의 select와
`upsertCredentials`의 쓰기, (c) `setCredentials({ refresh_token })`의 입력이다. `where('refreshToken'` 은 0건. medium 스펙은 모든
fixture에 `refreshToken: 'token'` 상수를 써서(`spec.ts:61`, `:91`) 토큰이 우연히 판별자가 될 수 없게 했고, `connectWithFolder`
주석(`:85-89`)이 그 의도를 적었다.

### 5. 생성 SQL 부분 갱신 — 안전한가, CI가 깨지나?

**안전하고, CI는 통과한다.** 근거는 재현이다. 이 워크트리에서 `nest build` 후 `sync-sql`을 데스크탑 dev Postgres(`localhost:5432/immich`)에
돌리자 52파일 중 **`google.drive.repository.sql`만** 바뀌었고, 바뀐 것은 리포트가 말한 두 메서드의 두 번째 문장 삭제(20줄)뿐이었다.
stderr가 원인을 말한다: `setDriveAccountId error: column "connectionId" does not exist`, `getErrorSummary error: column
google_drive_upload.driveAccountId does not exist` (그 외 `getCredentials`·`fillFolderName`·`countPendingUploads` 등 같은 이유로 에러).
`sync-sql.ts:165-166`은 에러가 나도 첫 문장은 기록하지만 메서드가 throw하므로 두 번째 문장에 도달하지 못한다. **즉 이 dev DB는 이
브랜치의 마이그레이션(`1787200000000-AddGoogleDriveConnectionId`, 그 앞의 driveAccountId)이 적용되지 않은 스키마다.** CI
(`.github/workflows/test.yml:758-850`)는 컨테이너 Postgres에 `migrations:run`을 돌린 뒤 생성하므로 두 문장이 모두 잡힌다. 커밋된
두 줄(`"connectionId" = $3`)은 에러가 난 실행에서도 그대로 기록된 첫 문장과 일치한다.

### 6. `getMyStatus`가 폴링마다 자격증명을 읽는 비용

**무시할 수준.** `where "userId" = $1` PK 단건(`google.drive.repository.sql` `getCredentials`), 폴링은 지켜보는 동안만 3초→15초
(`google-drive-progress-manager.svelte.ts:54-56, 117-119`), `getStatus`는 이미 설정 화면 로드마다 같은 읽기를 한다. 남는 것은 N5의
"토큰이 한 경로 더 올라온다"뿐이다.

## What I did not verify

- **브라우저.** 점의 색·툴팁·메뉴 동작을 실제 화면에서 보지 않았다. 페이지 스펙이 없어 N1·N2는 코드로만 추론했다.
- **운영 환경의 실제 해제·재연결.** 리포트와 같은 입장(일부러 하지 않음).
- **CI 자체.** `sql-schema-up-to-date` 잡을 이 포크에서 실행해 보지는 않았다. 위 5번은 "같은 환경에서 원인을 재현하고 CI 조건과
  대조"한 것이지 CI 로그가 아니다. 완전히 확정하려면 갓 마이그레이션한 DB(예: medium testcontainer)에 `DB_URL`을 주고 `mise //:sql`을
  한 번 돌려 `git diff`가 비는지 보면 된다.
- **`mobile/openapi` Dart 생성물.** `connected`가 8번 등장하는 것만 확인했고 내용은 읽지 않았다(생성물).
- **svelte-check.** 첨부 증거의 "회귀 없음"을 그대로 받았다. 웹 전체 vitest와 eslint(헬퍼)는 돌렸다.
- **`mise //server:ci-unit`의 format 단계.** 전체 vitest·tsc·변경 파일 eslint는 돌렸지만 Prettier 검사는 돌리지 않았다.

## Feeding back into the plan

- **`mise //:sql`은 이 브랜치 마이그레이션이 적용된 DB에서만 믿을 수 있다.** 데스크탑 dev Postgres(`localhost:5432/immich`)에는
  `driveAccountId`·`connectionId`가 없다(2026-09-19 `sync-sql` stderr로 확인). CLAUDE.md §3 "생성물 재생성"에 "`DB_URL`을 마이그레이션
  된 DB로 — 두 번째 문장이 사라지면 스키마가 낡은 것이지 코드가 아니다"를 한 줄 넣을 것. 이 dev DB가 왜 뒤처져 있는지(다른 DB 이름을
  쓰는지, 마이그레이션이 건너뛰어졌는지)는 별도 확인 대상이다.
- **툴바 점 상태는 앨범 이동 시 리셋해야 한다**(N1). wave9a 리뷰 §1의 "stale 가드 있음"은 반쪽이었다 — 늦은 응답은 버리지만 남은
  값은 안 비운다. 다음 라운드에 N1·N2를 함께 넣고, 가능하면 페이지 로더를 순수 함수로 뽑아 스펙을 붙일 것(지금은 `.svelte` 안이라
  변이로 확인할 수 없다).
- **영구 실패 자산과 점의 관계**(N4)는 설계 결정이다. "파랑으로 두고 메뉴의 실패 수로 설명한다" 또는 "앨범 상태에 `failedCount`를
  더해 호박색으로 만든다" 중 하나를 `feature-roadmap.md`에 적을 것.
- **M8은 CAS 반쪽만 끝났고 nullable은 버렸다**(`c9523c5de`, CLAUDE.md §7 item 10). 이 리뷰에서 그 결정에 반대할 근거를 찾지
  못했다: 토큰 쓰기 경로가 하나뿐이고 그 경로가 `connectionId`를 재발급하므로 CAS 대상으로 `connectionId`가 정확히 맞다.
- 변이 목록(웹 3 + 서버 2 + medium 4)은 다음 라운드에서 회귀 검사용으로 재사용할 수 있다 — 전부 `sed` 한 줄이다.
