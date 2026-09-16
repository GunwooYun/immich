# Code Review — wave9a: 앨범 툴바 상태 점 + 차단 행 클릭 + 95% 경고 (`1a26d5a6f`)

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `9fa7d564e` |
| Commits reviewed | `1a26d5a6f` (기능), `9acd3ccce` (증거), `9fa7d564e` (리포트) — `git diff 39d4b5900 1a26d5a6f -- web i18n` |
| Report | `../report/google-drive-wave9a-album-menu-state-20260916-2315-report.md` |
| Prior review | `./google-drive-wave8d-permission-tests-20260916-2210-review.md` |
| Reviewed | 2026-09-16 (모든 수치는 이 워크트리 HEAD에서 직접 돌린 것) |

## Verdict

**배포 판정: 막는다 (BLOCKED).** 두 가지가 반드시 고쳐져야 한다. 첫째(C1), 새 툴바 점은 **연결 상태를 보지 않는다.**
연결 해제·만료 경로는 `user_google_drive` 행만 지우고(`google-drive.service.ts:421`, `:942`, `:1261`), 앨범 선택
(`google_drive_album`)은 의도적으로 살아남으며(`google-drive.repository.ts:292`), `revoked`는 차단 클래스가 아니라
(`enum.ts:1212-1215`) `getMyStatus`는 `blockedReason: null`을 돌려준다. 그래서 이 배포본이 7일마다 겪는 "권한 만료" 상태에서
점은 초록(`backed up`) 또는 파랑(`backing up`)으로 켜진다 — 이 점이 존재하는 이유인 바로 그 조용한 실패에서 거짓을 말한다.
둘째(C2), 새 헬퍼 `google-drive-indicator.ts:36`에 **실제 ESLint 오류**(`unicorn/no-subtraction-comparison`)가 있다.
리포트는 "ESLint가 tscompat에서 크래시, 기존 문제"라고 뭉뚱그렸는데, 크래시는 `.svelte`·`.spec.ts` 파일에서만 나고 `.ts`
헬퍼는 정상적으로 린트되어 에러를 낸다 — `mise //web:lint`(`--max-warnings 0`) 관문이 깨진다. 고치는 데 한 줄이다.

그 외 코드는 단단하다. 리포트의 수치(서버 280 / 웹 51 / 전체 574+2 skip)는 전부 재현됐고, 리포트 변이 4건은 그대로 재현됐으며
내가 추가한 헬퍼 변이 2건도 잡혔다. `$effect`는 루프하지 않고, 두 호출은 DB 전용이며, 앵커 계산은 wrapper의 영향을 받지 않고,
`ring-light`는 살아 있는 토큰이다.

### Evidence I ran myself

`run.sh`는 `results/`에 파일을 남기므로 쓰지 않고, 그 안의 스펙 목록(`run.sh:94-108`)을 같은 명령으로 재현했다. 변이는 `sed`로
넣고 매번 `git checkout --`으로 복원했다.

| Check | Result |
|---|---|
| web — `run.sh`의 5스펙 + 새 헬퍼 스펙 (6파일) | `6 passed / 56 passed` = **리포트 51 + 헬퍼 5** (§N1) |
| web — 메뉴 스펙 + 헬퍼 스펙 (변이 기준선) | `2 passed / 28 passed` — 리포트 28과 일치 |
| web — 전체 `npx vitest run` | `59 passed \| 1 skipped / 574 passed \| 2 skipped` — **리포트 574/2와 일치** |
| web — `npx svelte-check --output machine` | `COMPLETED 2696 FILES 7 ERRORS` — 오류 파일 3개 = `svelte-check-baseline.txt`와 **동일**, 바뀐 파일에 오류 0 |
| web — `npx eslint <각 파일> --max-warnings 0` | `google-drive-indicator.ts` → **`36:10 error unicorn/no-subtraction-comparison`, exit 1** (C2). `google-drive-indicator.spec.ts` → exit 0. 메뉴 `.svelte`·`.spec.ts`·페이지 `.svelte` → `TypeError: Cannot read properties of undefined (reading 'Class')` exit 2 (리포트대로 크래시, 손대지 않은 `byte-units.ts`에서도 재현) |
| 첨부 증거 `results/20260916-2308.txt` | `commit: 7ef041c1e`, UNCOMMITTED 마커 없음, 280 / 51 / svelte-check 회귀 없음, `RESULT: PASS` — 주장대로. `7ef041c1e`는 브랜치에서 닿지 않지만 존재하고, `git diff --stat 7ef041c1e 1a26d5a6f`는 결과 파일 1개뿐 → "동일 코드 위의 증거 커밋" 맞음 |
| `i18n/en.json` 정렬 (대소문자 무시) | 1,728키 정렬됨, 새 6키 모두 존재 |
| `git diff 39d4b5900 1a26d5a6f --stat` | 서버 변경 0 — 리포트 주장대로 web + i18n + 결과 파일 1개(§N3) |
| `git merge-base --is-ancestor v3.1.0 HEAD` | ancestor 맞음 |
| server medium (실 DB) | 돌리지 않았다 — 웹 전용 변경, 리포트와 같은 입장 |
| `git status --porcelain` (종료 시) | **이 리뷰 파일 하나뿐** (변이 후 두 파일의 md5가 HEAD와 동일함을 확인) |

**변이 전수.** 기준선 28 (메뉴 스펙 23 + 헬퍼 스펙 5).

| # | 변이 | 결과 | 판단 |
|---|---|---|---|
| M1 | 메뉴 `:125` quota 분기를 죽여 settings로 보냄 | `1 failed` — *quota block to Google's storage page* | 리포트 그대로 |
| M2 | 메뉴 `:240` `pending > 0 &&` 제거 | `1 failed` — *should not warn when there is nothing to sync* | 리포트 그대로 |
| M3 | 메뉴 `:256` `onclick={resolveBlocked}` 제거 | `2 failed` — 두 라우팅 테스트 | 리포트 그대로 |
| M4 (추가) | 메뉴 `:119` `>=` → `>` (경계 0.95) | **`28 passed`** | 경계값 미검증 — §N2 |
| M5 | 메뉴 `:240` 경고를 `{#if false}` | `2 failed` — warn, still-clickable | 리포트 "never rendered" 그대로 |
| M6 (추가) | 헬퍼 `:33` blocked가 syncing에 지도록 | `1 failed` — *lets a blocked account win* | 우선순위가 테스트에 박혀 있다 |
| M7 (추가) | 헬퍼 `:30` `!backedUp` 가드 제거 | `1 failed` — *shows nothing for an album that is not backed up* | 가드가 실제로 잡힌다 |

## Findings

### C1 — 툴바 점이 연결 상태를 모른다: 권한 만료 뒤에도 "backed up / backing up"으로 켜진다 (must-fix)

`getGoogleDriveIndicator`(`web/src/lib/utils/google-drive-indicator.ts:19-37`)의 입력은 `backedUp`·`uploaded`·`total`·
`blockedReason` 넷뿐이고, 페이지의 로더(`+page.svelte:371-388`)는 `getGoogleDriveAlbumStatus`와 `getMyGoogleDriveStatus`만
부른다. 리포트 3번 항목은 "점은 `subscribed`를 요구하므로 미연결 사용자는 null"이라고 전제하는데, 그 전제는 **한 번도 연결한 적
없는** 사용자에게만 참이다. 연결했다가 끊긴 사용자는 다르다:

- 수동 해제(`google-drive.service.ts:942`)와 취소·만료 자동 해제(`:421`, `:1261`) 모두 `deleteCredentials`만 부르고, 그것은
  `user_google_drive` 한 행만 지운다(`google-drive.repository.ts:279-281`). 앨범 선택 행은 **의도적으로** 남는다
  (`:292` "A selection row deliberately outlives an unshare").
- 따라서 `getAlbumBackupStatus`는 계속 `subscribed: true`다 (`repository.ts:460` — `google_drive_album.albumId is not null`).
- `getMyStatus`의 `blockedReason`은 `getBlockingError`(`:813-823`)가 `GOOGLE_DRIVE_BLOCKING_ERROR_CLASSES`만 보는데, 그 목록은
  `QuotaExceeded`·`FolderMissing` 둘뿐이다(`server/src/enum.ts:1212-1215`). `revoked`는 없다. `getStatus`(`service.ts:644-657`)는
  이 경우를 알고 `revoked`를 따로 만들어 주지만, 점은 `getStatus`를 (프로브 때문에, 옳게) 부르지 않는다.
- `uploadedCount`는 `ledgerMatches(userId)`(`repository.ts:44-45`)를 쓰고, `currentAccountOf`는 연결 행이 없으면 `''`가 된다
  (`:41-42`). 즉 계정이 식별된 뒤 올라간(스탬프된) 원장 행은 **매칭에서 빠져** `total - uploaded > 0`이 된다.

결과: 이 배포본의 OAuth 앱이 Testing인 동안 7일마다 오는 만료 직후, 구독 중인 모든 앨범에 **파랑(backing up)** 점이 켜진다
(오래된 미상 행만 있는 앨범은 **초록**). 실제로는 워커가 자격증명이 없어 아무것도 올리지 않는다. 메뉴를 열면 "Connect" 행 하나만
보이는데(`GoogleDriveAlbumMenu.svelte:170-187`), 점은 반대를 말한다. 덤으로, 해제 전에 `quota_exceeded` 행이 남아 있었다면
(재연결 때만 지운다 — `service.ts:387`) 점은 호박색 "uploads paused"이고 메뉴는 "Connect"다.

이것은 점의 존재 이유(열어보지 않고도 조용한 실패를 알기)와 정면으로 어긋난다. 데이터 안전 문제는 아니지만, 배포하면 사장님이
매주 보는 첫 화면이 거짓이다.

**고치는 법 (제안).** 프로브를 건드리지 않고 DB 한 번으로 끝난다.
1. `GoogleDriveMyStatusDto`(`server/src/dtos/google-drive.dto.ts:136-147`)에 `connected: z.boolean()`을 추가하고,
   `getMyStatus`(`service.ts:858-872`)에서 `user_google_drive` 행 **존재 여부**만 읽어 채운다. `getCredentials`는 refresh token을
   끌어오므로(`repository.ts:274-276`의 "the only way the refresh token is read") `select 1 ... limit 1`짜리 `hasCredentials`를
   따로 두는 편이 그 주석의 취지에 맞다. `mise //:open-api` 재생성 필요.
2. 헬퍼 입력에 `connected: boolean`을 넣고 `if (!backedUp || !connected) return null;` — 또는 `'disconnected'` 상태를 하나 더
   만들어 호박색으로 그린다. 후자가 "조용한 실패를 드러낸다"는 목적에 더 맞지만, 어느 쪽이든 지금의 초록·파랑보다는 낫다.
3. 헬퍼 스펙에 "구독은 살아 있는데 연결이 끊긴" 케이스, 서비스 스펙에 `connected` 필드 케이스를 추가한다.
4. `loadGoogleDriveMenu`(`+page.svelte:429`)의 `driveConnected`는 계속 `getStatus`에서 오므로 그대로 둔다 — 그건 열었을 때의
   진실이고, 프로브가 거기 있어야 하는 이유는 `service.ts:725-739`가 설명한다.

### C2 — `google-drive-indicator.ts:36`의 ESLint 오류가 리포트의 "크래시, 기존 문제"에 가려졌다 (must-fix, 한 줄)

```
$ npx eslint src/lib/utils/google-drive-indicator.ts --max-warnings 0
  36:10  error  Prefer comparing the values directly over comparing the difference with `0`  unicorn/no-subtraction-comparison
✖ 1 problem (1 error, 0 warnings)
```
`:36` `return total - uploaded > 0 ? 'syncing' : 'synced';`. 리포트는 "ESLint on changed files crashes in tscompat — pre-existing"
이라고 썼고, 그 크래시는 `.svelte` 세 파일과 메뉴 `.spec.ts`에서 실제로 재현된다(위 표). 하지만 두 `.ts` 파일은 크래시 없이
린트되며, 그중 헬퍼는 **에러**를 낸다. 파일을 한꺼번에 넘기면 크래시 스택이 이 한 줄을 삼킨다 — 그래서 놓친 것으로 보인다.
`mise //web:lint`는 `--max-warnings 0`이라 CI가 붉어진다(CLAUDE.md §3).

**고치는 법.** `return total > uploaded ? 'syncing' : 'synced';` — 의미 동일, 헬퍼 스펙 5개(`uploaded: 12`의 음수 케이스 포함)
그대로 통과. 다음 라운드 리포트에는 ESLint를 **파일별로** 돌린 결과를 붙이길 권한다. 크래시 나는 파일과 통과한 파일을 구분해서.

### N1 — 새 헬퍼 스펙이 `run.sh`에 없다 (nice-to-have)

`dev-test/google-drive/run.sh:94-108`의 `WEB_SPECS`는 5개이고 `src/lib/utils/google-drive-indicator.spec.ts`가 없다. 그래서
첨부 증거의 "web 51"은 헬퍼 5개를 **포함하지 않는다**(6파일로 돌리면 56). `mise //web:ci-unit`(574)에는 잡히니 CI 관문은 지키지만,
이 기능의 증거 파일이 이 기능의 핵심 순수 함수를 안 보는 셈이다. `README.md`에도 언급이 없다(`grep indicator` 0건).
**고치는 법**: `WEB_SPECS`에 추가하고 README의 표에 한 줄.

### N2 — 임계값 경계(정확히 0.95)가 테스트에 없다 (nice-to-have)

M4(`:119` `>=` → `>`)가 28/28로 통과했다. 스펙의 사용량은 96·99·94뿐이다(`GoogleDriveAlbumMenu.spec.ts:264-287`). 상수를
`GOOGLE_DRIVE_STORAGE_CRITICAL_RATIO`로 뽑아 "막대 색과 경고가 어긋날 수 없다"고 주석했으니(`google-drive-indicator.ts:39-42`),
경계 하나(`usageBytes: 95` → 경고 있음)를 넣으면 그 약속이 테스트로 박힌다. 덧붙여 `baseProps.storage`가 이미 96/100이라
기존 테스트 전부가 "임계 상태"에서 렌더된다 — 문제는 아니지만(M5가 경고 테스트를 죽이므로 공허하지 않다), 기본값을 비임계로
두고 경고 테스트만 올리는 편이 읽기 쉽다.

### N3 — 기능 커밋 안에 `UNCOMMITTED` 마커가 찍힌 증거 파일이 들어 있다 (nitpick, 문서)

`1a26d5a6f`는 `dev-test/google-drive/results/20260916-2302.txt`를 포함하는데, 그 헤더는
`commit: 39d4b5900 (…) + UNCOMMITTED CHANGES`, 웹은 **45**(변경 전 개수), medium 60이다. 리포트는 이 파일을 인용하지 않고
`2308`을 인용하니 판정에는 무관하지만, "기능 커밋에 결과 파일을 섞지 않고 증거 커밋을 따로 둔다"는 이 시리즈의 관례
(`9acd3ccce`, `e44ab8e84`)와 어긋난다. **고치는 법**: 다음 증거 커밋에서 지우거나, 리포트에 "medium 60은 이 파일"이라고 명시.

### N4 — `$effect`가 빈 앨범에서도, 그리고 `album` 재대입마다 두 요청을 보낸다 (nitpick)

버튼은 `album.assetCount > 0`일 때만 렌더되는데(`+page.svelte:704`) 효과는 그 조건을 보지 않는다(`:390-394`). 또 `album`은
`refreshAlbum`(`:153`), `onAlbumUserUpdate`(`:327`), `onAlbumUpdate`(`:331`, 이어서 `invalidate`로 한 번 더) 때마다 재대입되어
효과가 다시 돈다. `countPendingUploads`(`repository.ts:501-527`)는 사용자 전체 anti-join이다. 자산 추가 뒤 재실행은 오히려 점을
갱신해 주니 이롭고, 사용자 역할 변경 뒤 재실행은 낭비다. **고치는 법**: `if (featureFlagsManager.value.googleDrive && album.assetCount > 0)`
정도면 빈 앨범 건은 사라진다. 나머지는 그대로 둬도 된다.

### N5 — 점의 상태 구분이 색뿐이다 (nitpick, a11y)

호박/하늘/초록 세 색(`+page.svelte:404-406`)이 유일한 시각 단서다. 스크린리더는 `aria-label`로 받고
(`ButtonContextMenu.svelte:217`), 호버 툴팁도 있다(`IconButton`이 `title={title ?? ariaLabel}`을 그린다). 색약 사용자에게는
호박과 초록이 비슷할 수 있다. 차단 상태만이라도 모양(예: 작은 느낌표 아이콘)을 달리하면 WCAG 1.4.1을 만족한다. 지금 막을 일은 아니다.

## Answers to what the report asked me to attack

### 1. `$effect` — 루프? stale 가드? `loadGoogleDriveMenu`와의 경합?

**루프하지 않는다.** 효과 본문(`+page.svelte:390-394`)이 동기적으로 읽는 것은 `featureFlagsManager.value.googleDrive`
(`feature-flags-manager.svelte.ts:5`의 `$state` + `:17-22` getter)와 `album.id`(`:228`의 `$derived`) 둘뿐이다.
`loadGoogleDriveIndicator`는 첫 `await Promise.allSettled`(`:372`) 이전에 상태를 읽지도 쓰지도 않고, 쓰기(`:381-386`)는 전부
await 뒤라 효과의 추적 범위 밖이다. `driveBackedUp` 등은 효과가 읽지 않는다. `$derived`인 `driveIndicator`(`:396-403`)는 효과의
의존이 아니라 소비자다.

**stale 가드는 맞다.** 인자로 캡처한 `albumId`와 await 뒤의 `album.id`(`:376`)를 비교한다. 같은 컴포넌트 인스턴스에서 A→B로
이동하면 `data.album`이 바뀌어 `album`이 바뀌고 효과가 B로 다시 돈다. A의 응답이 B의 응답보다 먼저 오든 나중에 오든 A는
`'A' !== 'B'`로 버려진다. 유일한 틈은 A→B→A 왕복 중 첫 A의 응답이 늦게 도착하는 경우인데, 그때 쓰는 값도 A의 DB 진실이라 무해하다.

**경합은 있지만 무해하다.** 두 로더는 같은 두 엔드포인트의 같은 DB 진실을 쓴다. 차이는 거부됐을 때뿐이다: 메뉴 로더는
`false`/`0`/`null`로 덮고(`:431-437`), 점 로더는 이전 값을 남긴다(`:380-387`). 마지막에 쓴 쪽이 이기며 어느 쪽이 이겨도 사용자가
구분할 수 없다. 재실행 빈도에 대해서는 §N4.

### 2. 두 호출은 정말 DB 전용인가? 5,000장 앨범 비용은?

**DB 전용 맞다.** `getMyGoogleDriveStatus`(`google-drive.controller.ts:259-261`) → `getMyStatus`(`service.ts:858-872`) →
`countPendingUploads`(`repository.ts:501-527`, 1문) + `getErrorSummary`(`:870-897`, 2문 순차). `getGoogleDriveAlbumStatus`
(`controller.ts:320-325`) → `getAlbumBackupStatus`(`service.ts:1420-1430`) → `requireAccess` + `repository.ts:448-493` 1문.
어디에도 `googleapis`·`getOAuth2Client`가 없다. 신원 프로브는 `getStatus`에만 있고(`service.ts:725-739`, `:819`) 점은 그것을
부르지 않는다 — CLAUDE.md §7의 경고는 `getStatus`에 대한 것이고 여기 해당하지 않는다.

**비용.** `getAlbumBackupStatus`는 `album_asset`을 두 번 훑는 상관 서브쿼리다(`:465-472` assetCount, `:473-486` uploadedCount —
후자는 `google_drive_upload`와 `(userId, assetId)`로 조인). 5,000장이면 5,000행짜리 조인 두 번 — 이미 메뉴를 열 때마다 돌던
같은 쿼리이고, 이제 앨범을 **볼 때마다** 돈다. `countPendingUploads`는 진행 카드 폴러가 몇 초마다 돌리는 같은 쿼리다. 실 DB가
없어 시간을 재지는 못했다. 앨범 하나 열 때 3~4문이 더 도는 것은 이 규모(6,996행)에서 걱정할 수준이 아니라고 본다.

### 3. 비소유자·미연결 사용자

- **400/403 여부.** `getAlbumBackupStatus`는 `AlbumRead`로 게이트한다(`service.ts:1421`) — 앨범 페이지에 있는 사람은 전부 통과.
  `getMyStatus`는 연결 여부를 검사하지 않는다(`:858-872`) — 절대 400을 내지 않는다. 그래서 `allSettled`(`:372`)는 방어용일 뿐
  실제로 거부되는 경우는 네트워크 오류뿐이고, 그때 조용히 넘기는 것은 옳다("점 하나 빠진 것에 토스트는 과하다").
- **한 번도 연결하지 않은 멤버.** `google_drive_album` 행이 없으니 `subscribed: false` → 헬퍼가 `null` → 점 없음. 전제대로.
- **연결했다가 끊긴 사용자.** 전제가 깨진다 — **C1.** `subscribed`는 살아 있고 `blockedReason`은 `null`(revoked는 차단 클래스가
  아님)이며 `uploadedCount`는 스탬프된 행을 놓친다. 점은 초록/파랑이고 메뉴는 "Connect"다. 이 배포본에서는 주 1회 겪는 상태다.

### 4. 점 배치 / a11y — 앵커 계산, `ring-light`

**앵커는 영향받지 않는다.** `ButtonContextMenu`는 위치를 `buttonContainer.getBoundingClientRect()`로 잡는데(`:136`), 그
`buttonContainer`는 컴포넌트 **안쪽**의 `<div bind:this>`다(`:210`). 새 `div.relative`(`+page.svelte:735`)는 그 바깥이라
rect에 개입하지 않는다. 열 때의 계산(`:83`)도 클릭 이벤트의 `currentTarget`(`context-menu.ts:12`) 기준이라 마찬가지다.
`{...restProps}`가 붙는 루트(`ButtonContextMenu.svelte:196-204`)도 wrapper 안쪽이다. 점은 `pointer-events-none`이라 클릭을
가로채지 않는다.

**`ring-light` / `ring-dark`는 실제 토큰이다.** `app.css:2`가 `@immich/ui/theme/default.css`를 임포트하고, 그 파일의 `@theme`
블록에 `--color-light: var(--immich-ui-light)`·`--color-dark: var(--immich-ui-dark)`가 있다(`default.css:103-104`). Tailwind 4는
`@theme`의 `--color-*`에서 `ring-*`를 포함한 색 유틸리티를 만든다. 같은 토큰이 `bg-light` 23회, `text-light` 28회, `border-light`
10회로 이미 쓰이고 있다(web/src `.svelte` 집계). `ring-light`·`ring-dark`는 이 변경이 첫 사용이지만 새 토큰은 아니다.

**a11y.** 점은 `aria-hidden`(`:762`)이고 상태는 `driveButtonTitle`(`:407-409`) → `ButtonContextMenu`의 `aria-label={title}`
(`:217`) → `IconButton`이 `title={title ?? ariaLabel}`로 툴팁까지 그린다. 리포트의 "title에 넣었다"는 두 의미 모두 맞다.
남는 것은 색만으로 구분한다는 점 — §N5.

### 5. "경고하되 막지 않는다"가 맞나?

**맞다.** 이유는 코드 주석(`GoogleDriveAlbumMenu.svelte:115-118`)이 이미 정확히 적었다: 저장 용량은 별도 호출의 스냅샷이고,
이 배포본은 Drive를 폰으로 계속 비우므로 "거의 참"은 1분 뒤 "여유"일 수 있다. 진짜 관문은 서버의 quota 403 처리이고
(`GOOGLE_DRIVE_BLOCKING_ERROR_CLASSES` + 워커 입구 스킵), 그것은 클라이언트 임계값과 무관하게 작동한다. 막아 버리면 "실패 재시도"
어포던스(`:219-221`의 설계 의도)도 함께 사라진다. 한 가지 덧붙이면, 이 경고와 C1의 관계 — 연결이 끊긴 상태에서는 `storage`가
`null`(`+page.svelte:436`)이라 경고도 안 뜬다. 옳은 동작이다.

## What I did not verify

- **브라우저 렌더링.** 점의 실제 위치(`end-1.5 top-1.5`), 다크 모드의 ring 대비, 메뉴가 열렸을 때 점이 메뉴 아래로 가는지 —
  리포트와 같은 입장이다. 앨범 페이지는 유닛 렌더되지 않는다.
- **쿼리 시간.** 실 DB가 없어 5,000장 앨범의 `getAlbumBackupStatus` 소요 시간을 재지 못했다. SQL 구조만 읽었다.
- **C1의 실제 재현.** 연결 해제 → 앨범 페이지 열기 → 점 색을 눈으로 본 것이 아니라, 해제 경로가 지우는 테이블·`getBlockingError`의
  클래스 목록·`ledgerMatches`의 `coalesce`를 코드로 추적한 결론이다. 세 근거는 각각 `file:line`으로 위에 인용했다.
- **medium 스위트.** 돌리지 않았다(웹 전용 변경).
- **ESLint 크래시의 원인.** 리포트가 말한 `tscompat`이 스택 어디에 있는지는 확인하지 않았다 — 크래시가 `.svelte`·메뉴 `.spec.ts`·
  손대지 않은 `.ts`에서 재현된다는 것만 확인했다. `google-drive-indicator.ts`가 크래시 없이 린트된다는 것은 확인했다.

## Feeding back into the plan

- **`dev-docs/google-drive/feature-roadmap.md`(또는 wave9 계획)에 적을 것:** "앨범 선택은 연결보다 오래 산다"는 `repository.ts:292`의
  설계가 클라이언트 상태 표시에 미치는 영향. 연결 없이 `subscribed: true`인 상태는 정상이고 주기적이며, 앨범 단위 UI가
  `subscribed`만 보고 "백업 중"이라고 말하면 안 된다. `getMyStatus`에 `connected`가 들어가면 그 사실을 DB 한 번으로 알 수 있다.
- **`revoked`는 차단 클래스가 아니다**(`enum.ts:1212-1215`). `getStatus`만 그것을 `blockedReason`으로 승격한다(`service.ts:644-657`).
  `getMyStatus`를 쓰는 소비자(진행 카드, 이제 점)는 이 차이를 알아야 한다 — 진행 카드는 `pending`이 0이라 조용히 넘어갔지만 점은 아니다.
- **ESLint는 파일별로, 결과를 표로.** 이 저장소의 web ESLint는 `.svelte`에서 크래시하므로 "바뀐 파일 전부"를 한 명령에 넘기면
  `.ts` 파일의 진짜 에러가 스택에 묻힌다. 리포트 템플릿에 파일별 exit code 표를 넣을 것.
- **`run.sh` `WEB_SPECS`는 새 스펙마다 갱신.** 헬퍼 스펙처럼 순수 함수 스펙은 "기능 폴더 밖"에 놓이기 쉬워 빠진다.
- **경계값은 상수를 뽑을 때 함께 테스트한다.** `>=` vs `>`는 한 글자 변이이고 이번 스펙은 그것을 놓친다.

---

`git status --porcelain` (종료 시): 이 리뷰 파일 하나뿐. 변이는 전부 `git checkout --`으로 복원했고 두 대상 파일의 md5가 HEAD와
같음을 확인했다. 리뷰 중 만든 임시 출력은 세션 scratchpad에만 있다.

**판정: BLOCKED** — C1(연결 상태 미반영), C2(`google-drive-indicator.ts:36` ESLint 오류). 둘 다 고치면 N1~N5는 배포를 막지 않는다.
