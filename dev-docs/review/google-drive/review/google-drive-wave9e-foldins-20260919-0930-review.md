# Code Review — wave9e: wave9c fold-in (`4582d6e1b`) + wave9d fold-in (`25d2c284f`)

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `dd5c0eb6b` (`feat/google-drive-album-sync-v3.1.0`) |
| Commits reviewed | `4582d6e1b` (wave9c fold-in), `40aa155fb` (증거), `25d2c284f` (wave9d fold-in), `497a168de` (증거), `dd5c0eb6b` (리포트) — `git diff dbf12fe3f 25d2c284f -- server/src server/test web/src i18n` (20 files, +859/−27; 생성물 3파일은 존재만 확인) |
| Report | `../report/google-drive-wave9e-foldins-20260919-0930-report.md` |
| Reviewed | 2026-09-19 09:15 +0900 (모든 수치는 이 워크트리 HEAD에서 직접 돌린 것) |

## Verdict

**배포 판정: 막지 않는다 (NOT BLOCKED).** 두 파트 모두 리포트가 말한 대로 코드에 있고, 리포트의 수치(서버 309 / 웹 74 / medium 61 /
전체 2,435+2 / 590+2)와 변이 5건(`failedCount`가 원장을 무시·사용자를 무시, secret 절 삭제, prompt 절 삭제, 공유 링크 가드 삭제)이
전부 재현됐다. 내가 추가한 변이 2건(헬퍼의 `>=`→`>`, `failing` 분기 제거)도 정확한 테스트 하나에 잡혔다. 새 `failedCount` 서브쿼리는
`uploadedCount`와 **같은 세 술어**(사용자·앨범·`ledgerMatches`)를 쓰므로 `failed ⊆ pending`이 구조적으로 보장되고, 헬퍼의
`failed >= pending`은 사실상 `failed === pending`이다 — 리포트가 물은 "다른 계정 스코프의 원장·중복·보이지 않는 자산"은 어느 것도
수를 부풀리지 못한다(§답변 1).

가장 중요한 문제는 **생성 SQL이 갱신되지 않았다**는 것이다(C1). `getAlbumBackupStatus`는 `@GenerateSql` 메서드인데
(`google-drive.repository.ts:451`) 커밋된 `src/queries/google.drive.repository.sql:177-232`에는 `failedCount` 서브쿼리가 없다.
업스트림 CI의 `sql-schema-up-to-date` 잡(`.github/workflows/test.yml:758-850`)은 재생성 후 diff가 있으면 `exit 1`이므로 이 상태로는
CI가 깨진다. 커밋 메시지는 "생성기를 이 dev DB에 깨끗이 돌릴 수 없다"고 했지만, 이 문장 하나는 DB 없이도 얻을 수 있다 — 아래에
Kysely `DummyDriver`로 뽑아 `sql-formatter`로 정리한 **정확한 갱신 블록**을 붙였다. 런타임에는 영향이 없으므로 배포 판정과는 무관하고,
푸시·병합 전에 고칠 일이다. 나머지는 `$effect` 리셋이 리포트가 생각한 것보다 자주 깜빡인다는 것(N1), 서로 모순되는 주석 두 곳(N2),
그 외 nitpick이다.

### Evidence I ran myself

워크트리의 `server/node_modules`·`web/node_modules`는 이전 라운드가 남긴 것을 그대로 썼다. 변이는 `sed`/`python`으로 넣고 매번
`git checkout --`으로 되돌렸으며, 네 파일의 md5가 변이 전과 같음을 `md5sum -c`로 확인했다(`OK` 4건). SQL 추출용 임시 스펙
`server/src/zz-review-tmp-sql.spec.ts`는 실행 직후 삭제했고 `ls`로 부재를 확인했다. 메인 저장소에서는 아무것도 돌리지 않았다.

| Check | Result |
|---|---|
| server unit — `utils/google-drive.spec.ts` + `auth.service.spec.ts` + `google-drive.service.spec.ts` | `3 passed / 245 passed` (37 + 103 + 105) |
| server unit — 전체 (`--config test/vitest.config.mjs`) | `94 passed / 2435 passed \| 2 skipped (2437)` — **리포트와 일치** |
| server medium — `test/medium/specs/repositories/google-drive.repository.spec.ts` (testcontainers Postgres) | `61 passed` — **리포트와 일치** |
| web unit — `google-drive-indicator.spec.ts` + `Thumbnail.spec.ts` | `2 passed / 16 passed` (10 + 6) |
| web unit — 전체 (`npx vitest run`) | `60 passed \| 1 skipped / 590 passed \| 2 skipped (592)` — **리포트와 일치** |
| server `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| server `npx eslint` (바뀐 9파일, `--max-warnings 0`) | exit 0 |
| web `npx eslint` (바뀐 4파일) | **환경 크래시** — `tscompat/tscompat` 규칙에서 `Cannot read properties of undefined (reading 'Class')`, 스펙을 빼도 같음. wave9d 리뷰와 같은 상태이며 코드 문제로 보지 않는다 |
| 첨부 증거 `results/20260919-0901.txt` | `commit: 25d2c284f`, 서버 309 / 웹 74 / medium 61, svelte-check 회귀 없음, `RESULT: PASS` — 주장대로 |
| `i18n/en.json` 정렬 | 대소문자 무시 사전순 위반 0건, 새 키는 `…_disconnected` / `…_failing` / `…_synced` 사이 |
| 생성물 존재 | `packages/sdk/src/fetch-client.ts:1231,1281` `failedCount: number`, `open-api/immich-openapi-specs.json` 4곳, Dart DTO 바이너리 변경 — 있음 |
| **생성 SQL** `src/queries/google.drive.repository.sql` | `getAlbumBackupStatus` 블록(`:177-232`)에 `failedCount` **없음** — C1 |
| dev DB(`immich_postgres`, localhost:5432) 스키마 (읽기 전용 조회) | `user_google_drive` = `userId,connectedAt,refreshToken,folderId,folderName`, `google_drive_upload` = `userId,assetId,uploadedAt,driveFileId` — 이 브랜치의 `driveAccountId`/`connectionId` 마이그레이션이 **아직 적용되지 않은** 스키마. 커밋 메시지의 "생성기를 돌릴 수 없다"의 원인은 맞다 |
| `git status --porcelain` (종료 시) | 이 리뷰 파일 하나 |

**변이.** 줄 번호는 HEAD 기준.

| # | 변이 | 결과 | 판단 |
|---|---|---|---|
| R1 (리포트) | `failedCount`의 `.where('google_drive_upload.assetId', 'is', null)` 삭제 (`repository.ts:510`) | medium `should count an album's stuck assets…` **실패** — 마지막 단계 `failedCount` expected 0, got 1 | 잡힌다. 원장 행이 생긴 뒤에도 에러 행이 남는 경우를 정확히 본다 |
| R2 (리포트) | 에러 조인의 `.on('google_drive_upload_error.userId', '=', userId)` 삭제 (`:500`) | 같은 테스트 **실패** — 첫 단계(소유자의 에러가 손님에게 보임) expected 0, got 1 | 잡힌다 |
| R3 (리포트) | `utils/google-drive.ts:299-301` secret 절 삭제 | `2 failed \| 138` — utils 스펙 1 + auth 스펙 1 | 잡힌다 |
| R4 (리포트) | `:308-310` prompt 절 삭제 | `2 failed \| 138` | 잡힌다 |
| R5 (리포트) | `Thumbnail.svelte:352` `!authManager.isSharedLink &&` 삭제 (sed가 `:344`·`:372`의 같은 가드도 함께 지움) | `1 failed \| 5` — `never shows the badge to a shared-link visitor` | 잡힌다. 다른 두 가드는 이 스펙이 보지 않지만 이 라운드 범위 밖 |
| M-A (추가) | 헬퍼 `failed >= pending` → `failed > pending` (`google-drive-indicator.ts:54`) | `1 failed \| 9` — `reports failing when the whole remaining backlog has already failed` | 잡힌다. `uploaded: 9, failed: 1` 케이스가 경계를 본다 |
| M-B (추가) | 헬퍼가 항상 `'syncing'` 반환 | 같은 테스트 1건 실패 | 잡힌다 |
| M-C (추가, 실행 안 함) | `+page.svelte:399-404` 리셋 블록 삭제 | — | **잡을 테스트가 없다.** `+page.svelte`를 렌더하는 스펙이 없고(`grep -rl 'google-drive-indicator\|albums/\[albumId' web/src --include='*.spec.ts'` → 헬퍼 스펙뿐), wave9a부터 그랬다. N1의 대안 설계가 들어가면 그때 헬퍼 쪽에 단언을 둘 수 있다 |

## Findings

### C1 — `getAlbumBackupStatus`의 생성 SQL이 갱신되지 않았다: CI `sql-schema-up-to-date`가 깨진다 (must-fix, 배포 게이트는 아님)

- `server/src/repositories/google-drive.repository.ts:451` `@GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })` 아래의
  메서드에 `failedCount` 서브쿼리(`:494-512`)가 추가됐지만, `server/src/queries/google.drive.repository.sql:177-232`의
  `-- GoogleDriveRepository.getAlbumBackupStatus` 블록은 `uploadedCount`에서 끝난다(`grep -n failedCount` → 0건). 이 라운드 diff에
  `server/src/queries`는 없다(`git diff dbf12fe3f 25d2c284f --stat -- server/src/queries` → 비어 있음).
- `.github/workflows/test.yml:829-850`: `mise //:sql` 실행 → `server/src/queries` 변경 검출 → `"ERROR: Generated SQL files not up
  to date!"` + `exit 1`. `CLAUDE.md` §3 "생성물 재생성 (해당 변경이 있으면 필수)"도 같은 말이다.
- 커밋 메시지(`4582d6e1b`)는 N5를 미룬 이유로 "the SQL generator cannot be run cleanly against this dev database"를 들었고, 그 진단은
  맞다(위 표: dev DB에 `driveAccountId`·`connectionId` 컬럼이 없다). 그러나 **이미 존재하는 `@GenerateSql` 메서드를 바꾸면서 같은 이유로
  재생성을 건너뛴 것**은 리포트에 적혀 있지 않다. 그리고 이 문장 하나는 DB 없이 얻을 수 있다: Kysely `DummyDriver` +
  `PostgresQueryCompiler`로 컴파일한 뒤 `sync-sql.ts:37`과 같은 `format(query, { language: 'postgresql' })`을 통과시키면 된다
  (내가 그렇게 뽑았다). 아래가 그 결과이며, 이것을 `:177-232` 블록에 그대로 넣으면 CI가 만들 것과 같다.
- **Fix.** `src/queries/google.drive.repository.sql:218-232`를 다음으로 교체한다 (`) as "uploadedCount"` 뒤에 쉼표가 붙고, 이어지는
  `from` 절의 파라미터가 `$3/$4/$5` → `$6/$7/$8`로 밀린다):

  ```sql
  ) as "uploadedCount",
  (
    select
      count(*) as "c"
    from
      "album_asset"
      inner join "asset" on "asset"."id" = "album_asset"."assetId"
      inner join "google_drive_upload_error" on "google_drive_upload_error"."assetId" = "album_asset"."assetId"
      and "google_drive_upload_error"."userId" = $3
      left join "google_drive_upload" on "google_drive_upload"."assetId" = "album_asset"."assetId"
      and "google_drive_upload"."userId" = $4
      and (
        "google_drive_upload"."driveAccountId" = coalesce(
          (
            select
              "driveAccountId"
            from
              "user_google_drive"
            where
              "userId" = $5
          ),
          ''
        )
        or "google_drive_upload"."driveAccountId" = ''
      )
    where
      "album_asset"."albumId" = "album"."id"
      and "asset"."deletedAt" is null
      and "google_drive_upload"."assetId" is null
  ) as "failedCount"
  from
    "album"
    left join "album_user" on "album_user"."albumId" = "album"."id"
    and "album_user"."userId" = $6
    left join "google_drive_album" on "google_drive_album"."albumId" = "album"."id"
    and "google_drive_album"."userId" = $7
  where
    "album"."id" = $8
    and "album"."deletedAt" is null
    and (
      "album_user"."userId" is not null
      or "google_drive_album"."userId" is not null
    )
  ```

  더 나은 길은 dev DB에 이 브랜치의 마이그레이션을 적용하고(`immich_server` 컨테이너가 이 브랜치 소스로 기동되면 자동으로 된다 —
  지금 그 컨테이너가 무엇을 마운트하고 있는지는 확인하지 않았다) `mise //:sql`을 정상적으로 돌리는 것이다. 그러면 N5의 `hasCredentials`도
  같은 길로 풀린다.

### N1 — `$effect` 리셋은 `album` 객체가 바뀔 때마다 실행되어, 리포트가 상정한 "assetCount 변경"보다 훨씬 자주 점이 꺼졌다 켜진다 (nice-to-have)

- `+page.svelte:394-411` 효과는 `album.id`·`album.assetCount`·`featureFlagsManager.value.googleDrive`를 읽고 여섯 상태를 쓴다.
  **자기 재실행은 없다** — 쓰는 상태 중 어느 것도 이 효과 안에서 읽지 않고, `loadGoogleDriveIndicator`(`:372-390`)가 `album.id`를 읽는
  곳은 `await` 뒤(`:377`)라 추적되지 않는다. 리포트 항목 2의 첫 질문은 "아니오"다.
- 그러나 `album`은 `let album = $derived(data.album)`(`:228`)이고, 효과의 의존성은 `album` 시그널이지 `album.id` 값이 아니다. 따라서
  `album`이 **새 객체**가 될 때마다 — id와 assetCount가 그대로여도 — 효과가 다시 돌고 여섯 상태가 비워진다. 그 순간은 리포트가 생각한
  "assetCount 변경"보다 많다: `refreshAlbum`(`:152-154`, 호출처 `:178, :183, :292, :309, :315, :536, :541` — 자산 제거·되돌리기·공유
  링크 생성·앨범 추가·공유·사용자 제거), `onAlbumUpdate`(`:330-334`, `album = newAlbum` + `invalidate('album:data')` → load 재실행 →
  `data.album` 새 객체). 각각 한 왕복 동안 점이 사라졌다가 돌아온다. 백업 토글은 `loadGoogleDriveMenu`만 부르므로(`:492`) 해당 없음 —
  리포트 항목 2의 둘째 질문 중 이 부분은 "깜빡이지 않는다"가 답이다.
- 자산 뷰어 열고 닫기는 **해당 없다**: `+page.ts`의 `load`는 `params.albumId`만 읽고, `authenticate(url)`(`utils/auth.ts:13-23`)은
  미인증일 때만 `url.pathname`을 읽으므로 인증된 사용자의 URL 변경은 load를 다시 돌리지 않는다.
- wave9c 리뷰 N1은 이 대가를 "잘못된 점보다 싸다"고 미리 받아들였고 나도 동의한다. 다만 같은 리뷰가 적은 대안 — **상태에 앨범 id를 함께
  두고, `album.id`와 다르면 `driveIndicator`가 `null`을 주는 것** — 은 깜빡임 없이 같은 정확성을 준다. 지금처럼 리셋하려면 최소한
  "id가 실제로 바뀌었을 때만" 리셋하면 된다: `let driveAlbumId = $state<string | null>(null)` 하나를 두고 효과 첫머리에서
  `if (driveAlbumId !== album.id) { …reset…; driveAlbumId = album.id; }`. 같은 앨범의 재로드는 stale 가드(`:377`)가 이미 처리한다.
- **Fix.** 위 둘 중 하나. 헬퍼 스펙만으로 잡히는 형태(파생에서 id 비교)를 권한다 — M-C가 보여 주듯 지금 리셋 블록은 어떤 테스트도
  보지 않는다.

### N2 — 서로 모순되는 주석 두 곳: `include_granted_scopes`가 "있다"와 "뺐다"가 한 블록에, 게이트 docblock은 새 두 절을 모른다 (nitpick, 문서)

- `server/src/services/auth.service.ts:290-309` 한 주석 블록 안에서: `:294` "So the **two** Google-specific parameters go out",
  `:296-299` "`include_granted_scopes` keeps Google's incremental-authorization contract: a user who has already granted drive.file
  is not asked again …" (wave9d N3가 틀렸다고 지적한 바로 그 문장), `:301` "this is Google's spelling" (단수), `:305-308`
  "`include_granted_scopes` was here too and has been dropped … the comment explaining it described re-consent behaviour that
  belongs to `prompt`". 뺀다는 문단을 **추가**하면서 뺐다는 문단을 **지우지 않았다**. 다음 읽는 사람은 `:296-299`를 현재 동작으로 읽는다.
- `server/src/utils/google-drive.ts:259-276` `isGoogleDriveLoginGrantEnabled` docblock은 "Every clause guards …" 라며 네 절을 나열하는데,
  이 라운드가 넣은 secret 절(`:293-301`)과 prompt 절(`:303-310`)은 인라인 주석에만 있다. 또 `:270-272`는 클라이언트 불일치의 결과를
  `unauthorized_client`로, `:298`은 secret 불일치를 `invalid_client`로 적는다 — 둘 다 구글이 실제로 쓰는 코드이지만 한 docblock 안에서
  일관되게 정리해 두는 편이 낫다.
- **Fix.** `auth.service.ts:294`를 "the Google-specific parameter goes out", `:296-299` 문단 삭제, `:305-308`은 남긴다.
  `utils/google-drive.ts` docblock에 두 항목 추가(각 인라인 주석의 첫 문장이면 충분).

### N3 — 메뉴는 `failing`을 모른다: 점은 "backup stopped on failed photos", 바로 아래 메뉴는 "N pending" (nitpick, UX)

- `GoogleDriveAlbumMenu.svelte`의 props(`:32-47`)에 `failed`가 없고, Sync 행(`:220-246`)은 `pending === 0 ? all_synced :
  pending_count`만 말한다. 점이 호박색 `failing`인 앨범을 열면 메뉴는 "3 pending"이라고 한다 — 틀린 말은 아니지만(대기 중인 것은
  맞다) 점이 방금 한 말("멈췄다")과 다르다. wave9c 리뷰 §1이 "메뉴와 점이 같은 말을 하나"를 물었고 wave9a에서는 같았다; 이 라운드가
  점에 상태 하나를 더하면서 다시 벌어졌다.
- 다행히 **복구 경로는 이미 맞다.** Sync 행은 `pending > 0`이면 활성이고(`:226`), 큐잉은 원장만 보고 에러 표는 보지 않으므로 실패
  자산이 다시 큐에 들어간다. 즉 `failing`의 올바른 다음 행동이 바로 그 행이다.
- **Fix.** `failed` prop을 넘겨 Sync 행 부제를 `failed >= pending ? google_drive_failed_count : google_drive_pending_count`로 가르거나,
  최소한 `google_drive_status_failing` 문구에 "— use Sync album to retry"를 붙인다.

### N4 — `prompt` 파싱은 공백 구분만 본다; 쉼표 구분은 게이트를 통과하지만 로그인 자체가 구글에서 거부된다 (nitpick)

- `utils/google-drive.ts:308` `oauth.prompt.trim().toLowerCase().split(/\s+/).includes('consent')`. OIDC Core §3.1.2.1은 `prompt`를
  "space delimited, case sensitive"로 정의하고 immich는 `oauth.repository.ts:74-76`에서 `config.prompt`를 **그대로** 보낸다. 따라서
  `consent select_account`·`select_account consent`는 잡히고(스펙 `google-drive.spec.ts:256-257`), `CONSENT`는 소문자화로 잡힌다
  (구글은 대소문자를 구분하므로 이 값은 어차피 거부되지만, 잡는 방향이 닫히는 쪽이라 무해). `consent,select_account`는 토큰 하나로
  남아 `includes`가 거짓 → 게이트가 **열린다**. 그러나 같은 문자열이 그대로 구글에 가므로 로그인이 `invalid_request`로 끝나 refresh
  token은 애초에 발급되지 않는다 — 실해는 없다.
- **Fix.** 원한다면 `split(/[\s,]+/)`. 두 글자짜리 변경이고 실패 방향이 닫히는 쪽이다. 안 해도 된다.

### N5 — 잡동사니 (nitpick)

- **리포트 파일명 스탬프 `0930`이 커밋(09:03)과 이 리뷰(09:15)보다 앞선다.** wave9d N6가 같은 것을 지적했다(그때는 반대 방향). 짝 이름은
  그대로 두되, 스탬프는 실제 작성 시각을 쓴다.
- `Thumbnail.spec.ts:76-85`의 `spy.mockRestore()`는 `try/finally` 안에 있다. §2 규칙은 `afterEach`를 말하지만 `finally`도 단언 실패 시
  실행되므로 목적(다음 테스트 오염 방지)은 같다. 그대로 둬도 된다.
- `google-drive.dto.ts:183` `failedCount` 설명 "Of the remainder, how many have a recorded upload failure" — 정확하다(§답변 1의
  `failed ⊆ pending`). `google-drive.service.spec.ts:1338-1340` 주석도 맞다.

## Answers to what the report asked me to attack

### 1. `failedCount` 의미 — `failed >= pending`이 맞는 트리거인가

**맞고, 부풀려질 수 없다.** 근거는 두 서브쿼리가 같은 술어를 쓴다는 것이다:

- `uploadedCount`(`repository.ts:477-487`)와 `failedCount`(`:494-512`) 모두 `album_asset.albumId = album.id`, `asset.deletedAt is null`,
  그리고 원장 조인이 `google_drive_upload.userId = userId AND ledgerMatches(userId)`(`:44-45`: `driveAccountId = 현재 계정 OR ''`)다.
  `pending = assetCount − uploadedCount`는 "원장 매칭이 없는 비휴지통 앨범 자산"이고, `failedCount`는 그 집합 중 "같은 사용자의 에러 행이
  있는 것"이다. 즉 **`failed ⊆ pending`** 이고 한 문장 안의 세 서브쿼리는 같은 스냅샷을 본다. 헬퍼(`google-drive-indicator.ts:50-55`)의
  `>=`는 사실상 `===`이며, `>`로 바꾸면 테스트가 잡는다(M-A).
- **다른 계정 스코프의 원장 행**(A 계정으로 올린 자산, 지금은 B로 연결): `ledgerMatches`가 거짓이라 `uploadedCount`에서도 빠지고
  `failedCount`의 left join도 null → 에러 행이 있으면 **pending이면서 failed**. 일관된다. 그런 에러 행이 실제로 생기는 경로는 B로
  재업로드가 실패한 경우뿐이고 그것은 정확히 "실패"다.
- **중복**: `album_asset` PK (albumId, assetId), `google_drive_upload_error` PK (userId, assetId)(`google-drive-upload-error.table.ts:34-38`),
  원장 PK는 (userId, assetId, driveAccountId)(`google-drive-upload.table.ts:40-57`)라 `''` 행과 계정 행이 같은 자산에 공존할 수는 있지만
  — 입양이 그 중복을 지운다(`:31-33` 주석) — 공존하더라도 `failedCount`는 left join + `is null`이라 **0행**이 되고, 부풀리는 쪽은
  `uploadedCount`(inner join, 이 라운드 범위 밖이고 입양이 막는다)다.
- **뷰어가 볼 수 없는 자산**: `album_asset`은 소유자 구분 없이 앨범의 전 자산이고 세 카운트가 모두 같은 집합을 센다. 멤버는 앨범의 모든
  자산을 볼 수 있고, `accessLost`(멤버 아님 + 선택 있음)에서도 세 수의 관계는 유지된다.
- **에러 클래스**: 모든 클래스를 센다. `revoked`는 자격증명 삭제 → `disconnected`가 이긴다; `quota_exceeded`/`folder_missing`은
  `blockedReason`이 이긴다(헬퍼 순서 `:40-48`); `source_unreadable`은 자산을 휴지통에 넣으면 두 수에서 함께 빠진다(`asset.deletedAt`).
  일시 오류(`unknown`)도 세지만, Drive 잡은 `removeOnFail: true`(`job.repository.ts:290`)에 자동 재시도가 없어 **다음 Sync/큐잉 전까지
  아무 일도 일어나지 않으므로** "멈췄다"가 정확하다. 문구 "backup stopped on failed photos"도 그 뜻이다.
- 남는 것은 N3 — 메뉴가 같은 말을 하지 않는다는 것뿐.

### 2. `$effect` 리셋 — 자기 재실행? 같은 앨범 재로드 깜빡임?

**자기 재실행은 없다. 깜빡임은 있고, 리포트가 상정한 것보다 잦다.** N1에 근거를 적었다. 요약: 효과가 읽는 것은 `album`·
`featureFlagsManager.value.googleDrive`뿐이고 쓰는 여섯 상태는 읽지 않는다(`+page.svelte:394-411`); `loadGoogleDriveIndicator`의
`album.id` 읽기는 `await` 뒤다(`:377`). 깜빡임의 트리거는 "assetCount 변경"이 아니라 **`album` 객체 교체** 전부다(`refreshAlbum` 7곳,
`onAlbumUpdate`). 백업 토글은 효과를 건드리지 않아 깜빡이지 않는다. 자산 뷰어 열고 닫기도 load를 다시 돌리지 않아 해당 없다.

### 3. 메뉴 로더 — `getGoogleDriveStatus`만 거부됐을 때 `driveConnected`가 이전 값으로 남는다

**틀린 분기는 없다.** "이전 값"의 출처가 둘뿐이고 둘 다 같은 사실이다: 효과의 리셋 `false`(`:400`) 또는 인디케이터 로더의
`myStatus.value.connected`(`:391`) — 서버에서 `getMyStatus`(`google-drive.service.ts:949`)와 `getStatus`(`:702` `connected: false` / `:748` `connected: true`) 모두 자격증명 행의 유무다.
즉 stale은 기껏해야 **페이지 로드 시점 스냅샷**이다. 그 값이 `true`인데 `getStatus`가 거부되면(네트워크/500) 메뉴는 연결 UI를 그리고
`driveStorage = null`(게이지 없음, `:467`), `driveFolderId`는 이전 값(첫 열기면 `null` → 링크가 my-drive로, `GoogleDriveAlbumMenu.svelte:108`)
— 전부 "모른다"를 표현하는 상태이고 사용자가 할 수 있는 잘못된 행동이 없다(토글은 서버가 다시 검증한다). 값이 `false`로 남는 반대
경우는 "Connect" 행을 보여 주는데, 그것은 이 변경 전에도 같았다. `getStatus`는 revoked에서 던지지 않고 행이 없으면 `connected: false`로
**fulfilled**되므로(`:664-700`, `clearRevokedGrant` 호출 없음) wave9c N3의 경합은 여전히 storage 쪽의 문제이고 이 로더 변경과 무관하다.

### 4. 새 게이트 두 절

- **prompt 검사**: N4. 공백 구분·대소문자 무시는 맞고(OIDC 정의 + `oauth.repository.ts:74-76`가 원문 전달), 쉼표 구분은 게이트를 열지만
  그 로그인은 구글이 거부한다. `split(/[\s,]+/)`는 선택.
- **secret 동일성**: **이대로 fail-closed가 맞다.** 구글은 클라이언트 하나에 secret 여러 개(회전용)를 허용하므로 "로그인은 S1, Drive는
  S2, 둘 다 유효"인 배포에서 refresh는 성공할 것이다(refresh token은 client id에 묶인다) — 그때 이 절은 false negative를 내고 로그인이
  Drive를 잇지 않을 뿐이며, 수동 Connect(`prompt: 'consent'`, Drive 자격증명으로 교환)는 그대로 된다. 반대 방향(secret이 실제로 다른
  클라이언트/틀린 값)의 결과는 `:293-298` 주석대로 "연결된 척 + 매 refresh `invalid_client` + 절대 정리 안 됨"이고, 그 비대칭이
  이 절을 정당화한다. 회전 중인 배포는 회전이 끝나면 다시 열린다. 더 정확한 대안(로그인 경로에서 프로브 **예외**면 저장하지 않기)은
  wave9d N2가 이미 미룬 리팩터다.
- 픽스처 정합성 확인: `auth.service.spec.ts:1446-1458`·`google-drive.spec.ts:167-181`의 `allTrue`에 `clientSecret: 'shared-client-secret'`
  양쪽과 `prompt: ''`가 들어갔고, `it.each`(`auth.service.spec.ts:1512-1519`)의 두 새 케이스는 각각 R3·R4 변이에 잡혔다.

### 5. 앨범 상태 SQL의 확장성

**실용상 문제 없고, 한 번에 세는 형태로 줄일 수는 있다.** 세 서브쿼리 모두 `album_asset` PK (albumId, assetId)의 앞부분으로 앨범 하나를
범위 스캔하고, 자산은 PK, 원장은 PK 접두 (userId, assetId), 에러 표는 PK (userId, assetId)로 점 조회한다 — 앨범 크기 n에 대해 3n번의
인덱스 조회. 이 배포본의 최대 앨범(~7k)에서도 수십 ms 안이고, 호출 빈도는 효과 실행·메뉴 열기뿐이며 폴링은 `/me/status`가 한다
(`google-drive-progress-manager.svelte.ts`). 줄이려면 `album_asset` 한 번 스캔에 원장·에러 표를 left join하고
`count(*) filter (where google_drive_upload.assetId is not null)` / `filter (where … is null and google_drive_upload_error.assetId is not
null)` 세 개로 접으면 된다 — 생성 SQL을 어차피 다시 만들어야 하니(C1) 그때 같이 해도 되고, 지금 급하지 않다.

## What I did not verify

- **브라우저.** 리포트와 같다 — 점의 다섯 상태, `failing` 툴팁, 깜빡임(N1)의 실제 체감은 렌더된 것을 본 적이 없다. N1의 "한 왕복"이
  눈에 띄는 길이인지는 서버 응답 시간에 달렸다.
- **로그인 그랜트의 실제 실행.** 이 배포본은 OAuth 로그인이 꺼져 있고 게이트가 열리지 않는다. 쉼표 구분 `prompt`에 대한 구글의 실제
  응답(N4의 "거부된다")은 OIDC 정의로부터의 추론이다.
- web ESLint(환경 크래시), svelte-check(증거 파일의 "회귀 없음"을 읽어 대조만 했다), `mise //server:ci-unit`·`//web:ci-unit`의 포맷 단계.
- `immich_server` dev 컨테이너가 어느 소스를 마운트하고 있는지 — C1의 "마이그레이션이 적용되면 정상 경로로 생성된다"는 추론이다.
- 원장 PK의 `''`/계정 행 공존이 입양 밖(연결 id가 빈 6,996행)에서 실제로 생길 수 있는지 — `hasUpload`가 `''` 행을 매칭해 재업로드를
  막으므로 계정 행이 새로 생기지 않는다고 판단했고, medium으로 확인하지는 않았다.

## Feeding back into the plan

`dev-docs/google-drive/`의 계획 문서에 다음을 남긴다:

1. **`@GenerateSql` 메서드를 바꾸면 dev DB 상태와 무관하게 생성 SQL을 갱신할 수 있다** — Kysely `DummyDriver` + `PostgresQueryCompiler` +
   `sql-formatter`(`language: 'postgresql'`)로 한 문장을 컴파일하면 `sync-sql`과 같은 텍스트가 나온다. 더 정석은 dev DB에 이 브랜치
   마이그레이션을 적용해 `mise //:sql`을 정상적으로 돌리는 것이고, 그러면 N5(`hasCredentials`)도 같은 길로 풀린다.
2. **`failedCount ⊆ pending`은 두 서브쿼리가 같은 세 술어를 공유하기 때문**이다. 어느 한쪽 술어를 바꾸면 헬퍼의 `>=`가 더 이상
   `===`가 아니게 된다 — 술어를 공통 헬퍼로 빼는 것이 다음 리팩터 후보(§답변 5의 단일 스캔과 함께).
3. **`failing`의 복구 경로는 Sync album이다** — 큐잉이 에러 표를 보지 않으므로 실패 자산이 다시 들어간다. 메뉴가 그것을 말하지 않는다(N3).
4. **`$effect`의 리셋은 `album` 객체 교체마다 실행된다** — `refreshAlbum`·`onAlbumUpdate` 경로 전부. 깜빡임 없는 대안은 상태에 앨범 id를
   실어 파생에서 비교하는 것이고, 그 형태는 헬퍼 스펙으로 잡힌다(지금 리셋 블록은 어떤 테스트도 보지 않는다).
5. **게이트의 secret 절은 의도적으로 fail-closed**다. secret 회전 중인 배포는 로그인 그랜트가 잠시 닫히고 수동 Connect는 그대로다.
6. `include_granted_scopes`를 뺀 이유 문단이 들어가면서 옛 설명 문단이 남았다(N2) — 문서 갱신 시 `auth.service.ts:296-299`를 지운다.

---

**VERDICT: NOT BLOCKED.** must-fix는 C1(생성 SQL 갱신) 하나이고 런타임에 영향이 없다 — 이 브랜치는 운영 랩탑에 배포해도 된다. 단
C1은 CI가 깨지는 상태이므로 푸시·병합 전에 위 블록으로 `google.drive.repository.sql`을 갱신하고, 그 갱신도 다음 라운드 리뷰에 넣는다.
`git status --porcelain`은 이 리뷰 파일 하나만 보고한다.
