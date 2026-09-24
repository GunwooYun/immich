# Code Review — wave10c: 실패 행에 소유자 이름 표시 (`1e37a52c2`) — 공유가 끝난 뒤의 잔존, soft-delete 조인, SQL 재현

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `1934bf56b` (`feat/google-drive-album-sync-v3.1.0`) |
| Commits reviewed | `1e37a52c2` (feature), `9cef432a5` (evidence), `1934bf56b` (리포트) — `git diff 3cabbb496 HEAD -- server/src web/src i18n` (8 files, +84/−2; 생성물·`dev-docs`·`dev-test/results` 제외) |
| Report | `../report/google-drive-wave10c-failure-owner-20260924-1130-report.md` |
| Reviewed | 2026-09-24 10:55 +0900 (모든 수치는 이 워크트리 HEAD에서 직접 돌린 것) |

## Verdict

**판정: NOT BLOCKED — 다음 운영 이미지에 넣어도 된다.** 변경은 리포트가 말한 그대로다: `google-drive.repository.ts:946`이 `asset.ownerId`로
`user`를 inner join해 `owner.name as ownerName`(`:964`)을 싣고, `google-drive.service.ts:951`이 소유자가 읽는 사람이면 `null`로 지우며,
`GoogleDriveSettings.svelte:449-455`가 `{#if failure.ownerName}` 안에서 `"{name}'s photo"`를 붙인다. 세 스위트(서버 112 · 웹 15 · medium 63)를
재현했고, 리포트가 든 두 변이(blanking 제거 → 유닛 1개 실패, 별칭 파괴 → medium 1개 실패)는 **의도한 이유로** 죽었다(아래 표의 diff 인용).
DummyDriver로 컴파일한 `getFailures`는 커밋된 SQL 블록과 **바이트 단위로 동일**하다.

리포트가 제일 걱정한 두 항목의 답은 이렇다. **(1) 공유가 끝나도 에러 행은 남고, 이름도 같이 남는다** — 실 DB에서 재현했다(프로브 C). 다만
이것은 wave10c가 *만든* 누출이 아니라 wave10a 때부터 있던 잔존(`assetId`·`originalFileName`이 이미 행에 있었다)이 한 칸 넓어진 것이고, 기본
설정(`server.publicUsers = true`, `config.ts:453`)에서는 모든 사용자의 이름이 어차피 `GET /users`로 전체에 보인다(`user.service.ts:32-33`).
그래서 이 배포의 차단 사유는 아니지만, **잔존 자체는 고칠 가치가 있다** — `streamPendingUploads`(`:591-602`)가 쓰는 앨범 멤버십 술어를
`getFailures`/`getErrorSummary` 쌍에 넣으면 목록·카운트·재시도가 같은 것을 말하게 되고 공유 해제와 동시에 행이 사라진다(M1, 다음 라운드
권고). **(2) inner join은 안전하다** — immich의 사용자 삭제는 `deletedAt`만 세우는 soft-delete(`user.repository.ts:228`)라 `user` 행이 남아
조인이 붙고, hard-delete(`user.service.ts:293` → `deleteFrom('user')`)는 `asset.ownerId` CASCADE(`asset.table.ts:68`) → `google_drive_upload_error.assetId`
CASCADE(`google-drive-upload-error.table.ts:37`)로 에러 행 자체를 지운다. 두 상태 모두 실 DB에서 확인했고(프로브 A·B), `leftJoin`으로 바꿔도
63/63이 그대로다 — 조인 종류가 관측 불가능하다는 뜻이다. **그대로 두는 것이 맞다.**

### Evidence I ran myself

`server/node_modules`·`web/node_modules`는 이전 라운드 것을 그대로 썼다. medium 스위트는 testcontainers가 자체 Postgres를 띄운다
(`test/medium/globalSetup.ts:11`) — 호스트의 `immich_postgres`는 건드리지 않았다. 변이·프로브는 전부 `git checkout` 후 `cmp`로 원본과 바이트
동일함을 확인했고, 임시 스펙 파일은 삭제했다.

| Check | Result |
|---|---|
| `git status --porcelain` (리뷰 파일 쓰기 전) | 빈 출력 |
| `git diff 3cabbb496 HEAD --stat` | 14 files — 소스 8 + 생성물 3(`open-api`, `packages/sdk`, `mobile/openapi`) + 리포트·results·medium spec |
| `cd server && npx vitest run --config test/vitest.config.mjs src/services/google-drive.service.spec.ts` | **112 passed** (results 파일의 스위트별 수와 일치) |
| `cd web && npx vitest run "src/routes/(user)/user-settings/GoogleDriveSettings.spec.ts"` | **15 passed** |
| `cd server && npx vitest run --config test/vitest.config.medium.mjs test/medium/specs/repositories/google-drive.repository.spec.ts` | **63 passed** (리포트의 63과 일치) |
| `cd server && npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `dev-test/google-drive/results/20260924-1046.txt` | `commit: 1e37a52c2`, server 316 / web 87 / medium 63, `RESULT: PASS` — 리포트 인용과 일치 |
| **M1** `service.ts:951`의 `row.ownerId === userId ? null : row.ownerName` → `row.ownerName` | 유닛 **1 failed / 111 passed** — `should return the failures with the total behind them`, diff `- "ownerName": null` / `+ "ownerName": "Me"` |
| **M2** `repository.ts:964`의 `as ownerName` → `as ownerLabel` | medium **1 failed / 62 passed** — `should report another user's name on a failure from a shared album`, diff `- "ownerName": "Seohui"` (sed가 `:407`의 같은 별칭도 함께 바꿨지만 그쪽 테스트는 별칭을 단언하지 않는다) |
| **M3** `repository.ts:946`의 `innerJoin('user as owner'…)` → `leftJoin` | medium **63 passed** — 조인 종류를 고정하는 테스트는 없다(아래 Q2: 고정할 필요도 없다) |
| **SQL 재현** — DummyDriver + `PostgresQueryCompiler` + `log` 콜백 + `format(sql, { language: 'postgresql' })` (= `bin/sync-sql.ts:37`) | `diff` → **IDENTICAL** (`src/queries/google.drive.repository.sql:510-546` 블록 전체) |
| **프로브 A** 소유자 `deletedAt` 세팅 후 `getFailures` | 1 row, `ownerName = 'Seohui'` |
| **프로브 B** 소유자 `deleteFrom('user')` 후 | `asset` 0 · `google_drive_upload_error` 0 · `getFailures` 0 — CASCADE가 먼저 지운다 |
| **프로브 C** 공유 앨범(소유자 other, reader는 `album_user`, `google_drive_album` 선택) → reader의 `album_user` 삭제 후 | `getFailures` **1 row, `ownerName = 'Seohui'`, `failedCount = 1`** — 에러 행 삭제 후 `streamPendingUploads(reader)`는 **0** |
| **프로브 D** 소유자 `name = ''` | `ownerName = ""` → 서비스는 그대로 통과, 웹 `{#if}`가 거짓이라 라벨 없음 |
| `i18n/en.json` 정렬 (python, case-insensitive) | out-of-order 없음; 새 키는 `_folder`와 `_quota` 사이 |
| `git status --porcelain` (리뷰 파일 쓴 뒤) | `?? dev-docs/review/google-drive/review/google-drive-wave10c-failure-owner-20260924-1130-review.md` 한 줄 |

## Findings

### M1 — 에러 행이 공유·선택·앨범보다 오래 산다: 목록·카운트가 "재시도할 수 없는 것"을 보여 준다 (medium, 배포 차단 아님, 다음 라운드)

- **증거**: `getFailures`(`repository.ts:943-967`)와 `getErrorSummary`(`:905-923`)의 술어는 셋뿐이다 — `userId`, `asset.deletedAt is null`, 원장
  anti-join. 앨범 멤버십을 보는 조인이 없다. 프로브 C: reader를 `album_user`에서 지운 뒤에도 행이 1개, 이름이 'Seohui', `failedCount`가 1이고,
  같은 상태에서 `streamPendingUploads(reader)`는 0이다 — 즉 **재시도 버튼은 이 행을 지우기만 하고 아무것도 다시 올리지 않는다**
  (`service.ts:995` `clearErrorsForAssets` → `:998` `queuePendingUploads`). 사용자가 보는 것은 "1 failed" 배지와 다른 사람 이름이 붙은 행이고,
  할 수 있는 일은 없다.
- **왜 지금은 차단이 아닌가**: (a) 이름은 기본 설정에서 이미 공개다 — `user.service.ts:32`는 `auth.user.isAdmin || config.server.publicUsers`이면
  전체 사용자 목록을 주고, `publicUsers`의 기본값은 `true`(`config.ts:453`)다. 이 인스턴스의 Drive 사용자는 관리자 한 명이므로 어떤 설정이든
  이미 모든 이름을 본다. (b) `assetId`·`originalFileName`은 wave10a부터 같은 행에 있었다 — wave10c는 그 잔존에 열 하나를 더했지, 잔존을 만든 것이
  아니다. (c) 새로 생긴 정보는 "이 파일이 이 사람 것"인데, 그 사실은 공유 중에 이미 봤던 것이다.
- **언제 진짜 문제인가**: `publicUsers = false`인 인스턴스에서 공유가 끊긴 뒤 — 그때는 `GET /users`가 자기 자신만 주므로(`:35-36`) 이 행이
  이름을 볼 수 있는 유일한 경로가 된다. 이 포크의 운영에는 해당하지 않지만, 업스트림 관례("접근권이 끝나면 아무것도 안 보인다")와 어긋난다.
- **권고**: 두 쿼리에 **같은** 멤버십 술어를 `exists` 서브쿼리로 넣는다 — `album_asset` → `album`(`deletedAt is null`) → `google_drive_album`(reader의
  선택) → `album_user`(reader의 접근권). `streamPendingUploads`(`:591-602`)와 `countPendingUploads`(`:530-537`)가 이미 쓰는 조인 그대로이고,
  `exists`로 두면 여러 앨범에 든 자산이 행을 불리지 않는다. 그러면 목록 = 카운트 = 재시도가 다시 큐잉할 것이 되고, 공유 해제·앨범 삭제·선택
  해제 어느 경우든 행이 **즉시** 사라진다(정보도 같이). medium 테스트 `should list exactly the failures it counts`(`spec:1047`)가 두 쿼리를 묶고
  있으니 한쪽만 고치면 그 테스트가 잡는다 — 프로브 C를 그 describe에 옮겨 넣으면 회귀 방지가 된다.
  버린 대안: 공유 해제 이벤트에서 에러 행을 지우는 것 — 앨범 삭제·복원, 선택 해제, `album_user` 직접 삭제 등 경로마다 훅이 필요하고 하나만
  빠져도 잔존이 돌아온다. 읽기 쪽 술어 하나가 더 작다.
- **주의**: 술어를 넣으면 `revoked`·`quota_exceeded` 같은 **계정 단위 행**도 같은 술어를 타게 된다. 그 행들은 자산이 아직 앨범에 있는 동안만
  보이면 되므로 문제없지만, `getBlockingError`(`:919`)는 별도 쿼리라 배너는 영향받지 않는다 — 그 점을 커밋 메시지에 적어 두면 다음 사람이
  "왜 카운트는 0인데 배너는 뜨지"를 다시 묻지 않는다.

### N1 — DTO 설명 문구 문법 (nit, 생성물 3개에 그대로 전파됨)

- `google-drive.dto.ts:191`: `'Who owns the asset, when that is not the caller — shared albums upload other people photos'` → `other people's photos`.
  같은 문구가 `open-api/immich-openapi-specs.json`, `packages/sdk/src/fetch-client.ts`, `mobile/openapi/.../google_drive_failure_dto.dart`에 들어갔다.
  고치면 `mise //:open-api`로 재생성해야 한다(`git add` 전에).

### N2 — 이름이 빈 소유자는 "내 사진"과 구분되지 않는다 (nit)

- `user.name`은 `default: ''`이고 nullable이 아니다(`user.table.ts:68-69`). 프로브 D: `name = ''`이면 `ownerName = ''`가 서비스를 통과하고
  (`service.ts:951`은 `ownerId` 비교만 한다), `svelte:449`의 `{#if failure.ownerName}`가 거짓이라 라벨이 사라진다 — 즉 wave10c 이전과 같은 화면이다.
- 실제로 도달하는 경로는 좁다: OAuth는 `auth.service.ts:392-396`의 폴백 사슬(`profile.name` → given+family → `preferred_username` → **전체 이메일**)이
  있어 비지 않고, 관리자 생성은 `user.dto.ts:81` `name: z.string()`이라 서버는 `''`를 받지만 웹 폼이 필수로 막는다. 이 인스턴스에서는 나오지
  않을 것이다. 그래도 한 줄이면 막힌다: `ownerName: row.ownerId === userId ? null : row.ownerName || <fallback>` — 폴백은 이메일이 아니라
  중립 문구(예: i18n `google_drive_failure_owner_unknown: "someone else's photo"`)여야 한다. 이메일은 이름보다 민감하다.

### N3 — inner join을 택한 이유가 코드에 없다 (nit)

- `repository.ts:929-941`의 주석은 "왜 소유자를 싣는가"만 말한다. 리포트의 Q2를 다음 사람도 물을 것이므로, `:946` 위에 한 줄 — soft-delete는
  `user` 행을 남기고 hard-delete는 `asset` CASCADE로 에러 행을 먼저 지우니 left join이 살릴 행이 없다 — 을 두면 M3 같은 변이를 누가 다시
  시도하지 않는다. 같은 파일 `:395`의 `getAlbums`도 같은 모양으로 inner join하므로 관례와도 맞는다.

## Answers to what the report asked me to attack

### Q1. 에러 행이 공유보다 오래 살아 더 이상 봐서는 안 되는 이름을 누출하는 경로가 있는가?

**있다 — 그리고 셋 다 같은 원인이다.** `getFailures`는 에러 행의 `userId`만 보고 현재 멤버십은 보지 않는다(`repository.ts:952`). 에러 행을 지우는
경로는 다섯 곳뿐이고(`:765` 업로드 성공, `:880` `clearErrors`, `:979` `clearErrorsForAssets`, 그리고 두 FK CASCADE) 어느 것도 공유 해제·앨범 삭제·
선택 해제에 반응하지 않는다(`service.ts`의 이벤트 핸들러는 `:424` `GoogleDriveLoginGrant` 하나다).

| 경로 | 행의 운명 | 이름 | 근거 |
|---|---|---|---|
| reader를 앨범에서 제거 (`album_user` 삭제) | 남는다 | 보인다 | 프로브 C — 1 row, `'Seohui'`, `failedCount 1` |
| 앨범 삭제 (`album.deletedAt`) | 남는다 | 보인다 | 술어에 `album` 조인 없음 (`:943-956`) — C와 동일 구조 |
| reader가 선택 해제 (`google_drive_album` 삭제) | 남는다 | 보인다 | 동일 |
| 소유자가 자산을 휴지통에 | **숨는다** | — | `:953` `asset.deletedAt is null` |
| 소유자 계정 soft-delete | 남는다 | 보인다 | 프로브 A |
| 소유자 계정 hard-delete | **사라진다** | — | 프로브 B — CASCADE |
| reader가 "재시도" | 사라진다(재큐잉 0) | — | 프로브 C 후반, `service.ts:995-998` |

**이것이 배포를 막는가 — 아니다**, M1에 적은 세 이유(기본 `publicUsers = true`로 이름은 이미 공개, 파일명·자산 id는 wave10a부터 잔존, 이 인스턴스의
Drive 사용자는 관리자 한 명)에서다. **다음 라운드에 무엇을 하는가** — 이름을 숨기는 것이 아니라 **잔존을 없앤다**(M1의 술어). 이름만 지우면
"IMG_0926.HEIC · 1 failed"가 아무 조치도 못 하는 상태로 남는 wave10c 이전 화면으로 돌아갈 뿐이다.

### Q2. `innerJoin('user as owner')`는 삭제된(soft-deleted) 사용자에 안전한가? left join이어야 하는가?

**안전하고, inner join이 맞다.** immich의 사용자 삭제는 두 단계다.

1. **soft-delete**: `user-admin.service.ts:108`이 `status`와 `deletedAt`만 갱신한다(`user.repository.ts:228` `updateTable('user').set({ deletedAt })`).
   `user` 행이 그대로 있으므로 `owner.id = asset.ownerId`는 계속 붙는다 — 프로브 A: 1 row, 이름 그대로. 이 단계의 자산은 아직 존재하고
   `deleteDelay`(기본 7일) 안에 복원될 수 있으니 실패 행이 보이는 것이 옳다.
2. **hard-delete**: `user.service.ts:292-293`이 `albumRepository.deleteAll` 후 `userRepository.delete(user, true)` → `deleteFrom('user')`(`user.repository.ts:227`).
   `asset.ownerId`가 `onDelete: 'CASCADE'`(`asset.table.ts:68`)라 자산이 먼저 사라지고, `google_drive_upload_error.assetId`도 CASCADE
   (`google-drive-upload-error.table.ts:37`)라 에러 행이 따라 사라진다 — 프로브 B: 자산 0, 에러 행 0, `getFailures` 0. **left join이 살릴 행이
   없다** — `asset` inner join(`:945`)이 이미 그 행을 걸렀을 것이기 때문이다.

M3(`leftJoin`으로 변이)가 63/63을 통과한 것이 그 증거다: 두 조인은 이 스키마에서 같은 집합을 낸다. 굳이 고르자면 inner join이 낫다 — `ownerName`의
타입이 `string`으로 남아 서비스의 `?:`가 단순하고, 같은 파일 `:395`·업스트림 `album.repository.ts:39`와 관례가 같다. `activity.repository.ts:83`처럼
`.on('user.deletedAt', 'is', null)`을 붙여 soft-deleted 소유자를 **떨어뜨리는** 것은 하지 말 것 — 자산은 아직 있고 실패도 실재하므로, 그건
프로브 A의 행을 이유 없이 숨긴다.

### Q3. `getFailures`의 생성 SQL은 실제 생성기가 낼 것과 같은가?

**같다 — 바이트 단위로.** `bin/sync-sql.ts:37`은 kysely `log` 콜백이 준 `query.sql`을 `format(query, { language: 'postgresql' })`로 정리한다. 나는
같은 `sql-formatter`를 같은 옵션으로, DummyDriver + `PostgresQueryCompiler` 위에서 `new GoogleDriveRepository(db).getFailures(DummyValue.UUID, 100)`을
호출해 얻은 문자열에 적용했고, `src/queries/google.drive.repository.sql:510`부터의 블록과 `diff`가 비었다. 파라미터 번호(`$1` 서브쿼리, `$2` where,
limit `$3`), 조인 순서(`asset` → `user as owner` → `google_drive_upload`), 별칭 인용 모두 일치한다. 실제 `mise //:sql`은 Nest 앱과 실 DB 위에서
돌지만 SQL 텍스트를 만드는 것은 같은 컴파일러이므로 결과가 달라질 지점이 없다.

### Q4. `"{name}'s photo"`는 이름이 이메일 local-part이거나 비어 있을 때 제대로 읽히는가?

- **local-part는 나오지 않는다.** `user.name`이 채워지는 경로는 둘이고 둘 다 local-part를 만들지 않는다: OAuth는 `auth.service.ts:392-396`에서
  `profile.name` → `given_name family_name` → `preferred_username` → **`normalizedEmail`(전체 이메일)** 순으로 폴백하고, 로컬 생성은 `user.dto.ts:81`
  `name: z.string()`을 그대로 저장한다(`:215`). 최악은 `"gunwoo87@gmail.com's photo"` — 어색하지만 뜻은 통하고, 그 사용자는 이미 자기 이름이
  이메일로 보이는 상태다.
- **빈 이름은 라벨이 사라진다** — 프로브 D. `svelte:449` `{#if failure.ownerName}`가 `''`를 거짓으로 보므로 wave10c 이전 화면이 된다.
  N2에 적은 대로 중립 폴백 한 줄이면 막히고, 이 인스턴스에서는 도달하지 않는 경로다.
- 아포스트로피가 든 이름(`O'Brien's photo`), 한글 이름(`서희's photo`)은 그대로 렌더된다. 후자는 다른 로케일에 이 키가 없어 영어로 폴백하는
  것인데, 이 포크의 다른 `google_drive_*` 키와 같은 상태다.

### 보너스 — 테스트의 비공허성

- 서버 "own photo" 케이스: M1이 정확히 그 테스트를, 정확히 `ownerName` 줄에서 죽였다.
- 웹 "should not label the owner on your own photos"(`spec:167-175`)의 `queryByText(/'s photo/)`: 같은 파일 `:53-55`가 `$i18n/en.json`을 `en-US`로
  등록하므로 문자열은 실제로 로드되고, `{#if}`를 지우면 `$t(..., { name: null })`이 `"'s photo"` 또는 `"null's photo"`를 내어 정규식에 걸린다.
  바로 위 양성 케이스(`:156-165`)가 같은 렌더 경로로 `Seohui's photo`를 찾으므로 i18n이 죽었으면 그쪽이 먼저 실패한다. 공허하지 않다.
- medium "should list exactly the failures it counts"(`spec:1047-1082`)에 `ownerId: user.id` 단언이 추가됐고, 새 케이스(`:1084-1098`)는 M2가
  죽였다.

## What I did not verify

- **브라우저 렌더**(truncate 안에서 `· Seohui's photo` span이 어떻게 잘리는지) — 리포트도 미검증이라 했고, 이 워크트리에서는 dev 서버를 띄우지
  않았다.
- **운영 인스턴스** — 실패 행이 지금 0이라 볼 것이 없다.
- `mise //server:ci-unit` 전체(2442)와 `mise //web:ci-unit` 전체(603) — 리포트 수치를 재현하지 않고 해당 스펙 파일과 `tsc`만 돌렸다. ESLint는
  돌리지 않았다.
- `mise //:open-api` 재실행 — 생성물 diff(`ownerName: nullable string`, required 목록 추가, SDK `string | null`)를 눈으로 확인했을 뿐 재생성해
  비교하지는 않았다. nullable **string**이지 enum이 아니므로 §4의 Dart 함정에는 걸리지 않는다.
- `publicUsers = false`인 인스턴스에서의 실제 노출 경로 — 코드(`user.service.ts:32-36`)로만 추론했다.

## Feeding back into the plan

`dev-docs/google-drive/failure-handling-plan.md`(또는 wave10 계획)에 다음을 남길 것:

1. **에러 행의 수명은 자산의 수명이지 공유·선택의 수명이 아니다.** `getFailures`/`getErrorSummary`는 멤버십을 보지 않으므로 공유 해제·앨범
   삭제·선택 해제 뒤에도 행(파일명·자산 id·이제는 소유자 이름)이 남고, 재시도는 그 행을 지우기만 한다(프로브 C). 다음 라운드(wave10d)의
   후보: `streamPendingUploads`의 멤버십 조인을 `exists`로 두 쿼리에 넣어 목록 = 카운트 = 재시도가 되게 한다. medium `should list exactly the
   failures it counts`가 두 쿼리를 묶고 있으니 함께 고친다.
2. **소유자 조인은 inner join이 맞고 그 이유는 CASCADE 체인이다** — soft-delete는 `user` 행을 남기고, hard-delete는 `asset` → 에러 행 순으로
   먼저 지운다. left join 논의를 다시 열지 말 것(M3: 관측 불가).
3. **이름 노출은 `publicUsers`에 달렸다** — 기본 `true`(`config.ts:453`)에서는 이름이 인스턴스 전체 공개라 이 기능이 새 정보를 만들지 않는다.
   `false`로 운영하는 인스턴스에 이 포크를 쓰려면 1번이 선행 조건이다.
4. DTO 문구 `other people photos` → `other people's photos`(N1)는 다음 OpenAPI 재생성 때 함께.
