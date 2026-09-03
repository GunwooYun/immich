# Code Review — B1(계정 변경 시 원장 리셋) + 메뉴 앵커 (`ba73b1b14`, `6bfd4708a`)

|                  |                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------- |
| Branch / HEAD    | `feat/google-drive-album-sync-v3.1.0` / 리뷰 시작 시 `1db9f94b6`, 종료 시 `0d4eb64ed`         |
| Commits reviewed | `ba73b1b14`(B1), `6bfd4708a`(메뉴 앵커)                                                       |
| Report           | `../report/google-drive-b1-account-reset-20260904-0900-report.md`                             |
| Prior review     | `google-drive-menu-position-20260903-1351-review.md` (C1/N1 반영, C2 인정)                    |
| Reviewed         | 2026-09-04                                                                                    |

## Verdict

**테스트는 리포트가 주장한 것보다 오히려 더 견고하고 마이그레이션도 흠잡을 데가 없다. 그런데 이
수정은 사용자가 계정을 바꿀 수 있는 **유일한 경로**에서 절대 발동하지 않는다.** 설정 화면은 연결된
상태에서 `Disconnect`만, 끊긴 상태에서 `Connect`만 보여준다
(`GoogleDriveSettings.svelte:285`, `:374`, `:378-382`). 즉 A계정 → B계정 전환은 **반드시**
`disconnect()`를 거치고, `disconnect()`는 `deleteCredentials`로 `user_google_drive` **행 전체를
삭제**한다(`google-drive.service.ts:657-658` → `google-drive.repository.ts:106-108`). 그 행에
`driveAccountId`가 들어 있으므로, 다음 링크에서 `previous`는 `undefined`이고
`accountChanged`(`google-drive.service.ts:369`)는 항상 `false`다. 원장은 disconnect를 **의도적으로**
살아남는데(`:652-655`) 그 원장을 지키는 신원값은 살아남지 못한다 — **가드가 자기가 지키는 대상보다
수명이 짧으면 언제나 fail-open**이다. 같은 이유로 revoked 경로(`:940`)도 신원을 지운다. 리포트가
1·2번으로 물은 `permissionId`의 적절성·리셋 범위는 그 다음 문제이고, 그 둘에도 각각 실질적인 구멍이
있다(C3, C4, N5). 메뉴 앵커는 방향이 옳고 겹침의 27px 중 23px을 없애지만 산술상 **4px이 남는다**(N7).

부수적으로, 이 수정이 켜졌을 때의 파괴력이 검토되지 않았다. `files.create`는 매번 새 파일을 만들고
(`:836-847`) 이름·해시 기반 중복 제거가 없으므로, 원장을 지우는 것은 곧 **전량 재업로드 = Drive에
전량 중복**이다. 동의 화면에서 구글 프로필을 잘못 골랐다가 되돌리는 흔한 오조작이, 수정 전에는
무해했는데 수정 후에는 라이브러리 전체의 중복 사본을 만든다(C4).

### Evidence I ran myself

| Check                                                                                     | Result                                                                                               |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| server 유닛 8스펙 (`npx vitest run --config test/vitest.config.mjs`)                      | `Test Files 8 passed / Tests 243 passed` — 리포트와 일치                                             |
| web 유닛 4스펙, **격리 워크트리(`1db9f94b6`)** 에서                                       | `Tests 36 passed` — 일치. (메인 워크트리에서는 39가 나온다. 아래 X1 참조)                            |
| 비공허 E1: `linkAccount`의 B1 블록을 `ba73b1b14^` 형태로 되돌림                           | `Tests 4 failed \| 58 passed (62)` — 리포트의 "정확히 4개" 재현                                      |
| 변이 E2 `accountChanged=false`                                                            | 1 failed = `should forget what was uploaded…`                                                        |
| 변이 E3 `null previous`를 "다름"으로 취급                                                 | 1 failed = `should record the account without resetting…`                                            |
| 변이 E4 `null new`를 "다름"으로 취급                                                      | 1 failed = `should link successfully when Drive will not say…`                                       |
| 변이 E5 리셋 시 `Revoked`만 정리 / E6 `deleteUploads` 생략                                | 각각 1 failed = `should forget what was uploaded…`                                                   |
| 변이 E7 비교 반전 / E8 계정 id 기록 생략                                                  | 2 failed / 3 failed — 테스트 4개가 각각 다른 분기를 잡는다                                            |
| `npx tsc --noEmit` (server, 격리 워크트리)                                                | rc=0                                                                                                  |
| `npx prettier --check` (변경된 서버 TS 5개)                                               | `All matched files use Prettier code style!`                                                          |
| **오프라인 드리프트 검사**: `schemaFromCode` + `schemaDiff`/`schemaDiffToSql`             | `ALTER TABLE "user_google_drive" ADD "driveAccountId" character varying;` — 마이그레이션과 **바이트 동일** |
| dev DB(`immich`) 읽기 전용 introspection                                                  | `user_google_drive`에 `driveAccountId` **없음**(마이그레이션 미적용). 쓰기는 하지 않음               |
| GitHub API run `33758496224`                                                              | `head_sha = 6bfd4708a…`, conclusion **success** — 리포트 주장 정확                                    |
| `git ls-remote origin`                                                                    | 원격 tip = `6bfd4708a` → `ba73b1b14`는 미푸시. 리포트가 스스로 밝힌 그대로                            |
| `@immich/ui` 기하: `default.css:10`(`--spacing-control-bar: --spacing(16)`), `internal/Button.svelte:58-64` | 툴바 64px, medium IconButton 40px — N7의 산술 근거                                                    |

## X1 — 먼저: 내가 이 워크트리에 만든 사고 (즉시 조치 필요, 코드 결함 아님)

**이 리뷰 세션이 리뷰 대상 코드를 다른 세션의 커밋 안으로 밀어 넣었다.** 사실만 적는다.

- 비공허성 확인을 위해 `server/src/services/google-drive.service.ts`를 **메인 워크트리에서** 변이시켰다
  (매 실행 후 원복). 같은 시각 다른 세션이 같은 워크트리에서 작업 중이었고, `06:36:06`에
  `git add`/commit을 했다.
- 그 결과 **`64b67f35a` (B7, getSubscribers 필터)** 커밋에 내 변이 E5가 섞여 들어갔다:

  ```
  git show 64b67f35a -- server/src/services/google-drive.service.ts
  -      await this.googleDriveRepository.clearErrors(userId, [...Object.values(GoogleDriveUploadErrorClass)]);
  +      await this.googleDriveRepository.clearErrors(userId, [GoogleDriveUploadErrorClass.Revoked]);
  ```

  B7 커밋 메시지에는 이 줄에 대한 언급이 없다.
- **그 커밋을 체크아웃해 테스트하면 실패한다.** `64b67f35a`의 격리 워크트리에서
  `google-drive.service.spec.ts` → `Tests 1 failed | 61 passed`,
  실패 항목 `handleCallback > should forget what was uploaded when a different Google account is linked`.
  (그 커밋에 첨부된 증거 파일 `20260904-0635.txt`는 커밋 **이전** 트리에서 돌았기 때문에 243 PASS로 남아 있다.)
- 내가 원복해 둔 내용은 그 다음 커밋 **`0d4eb64ed`** 가 설명 없이 함께 삼켰다. 그래서 **현재 tip의
  코드는 정상**이고 `git status`도 깨끗하다. 문제는 히스토리다: `64b67f35a`는 자기 테스트를 통과하지
  못하는 커밋이고, `0d4eb64ed`에는 정체불명의 1줄 원복이 들어 있다.
- **권고**: `64b67f35a`와 `0d4eb64ed`를 amend/rebase로 정리하거나(아직 미푸시라면 그쪽이 깔끔하다),
  최소한 `0d4eb64ed`의 그 한 줄이 무엇을 되돌린 것인지 기록을 남긴다. 그리고 앞으로 **리뷰 세션은
  `git worktree add --detach`로 격리한 뒤에만 변이 실험을 한다** — 이번 리뷰의 후반 실험은 전부
  `/tmp/.../wt-review`에서 돌렸고, 그 워크트리는 제거했다(`git worktree list`로 확인).

## Findings

### C1 — UI가 제공하는 유일한 계정 전환 경로에서 이 수정은 절대 발동하지 않는다 (Critical)

경로를 그대로 따라가면 이렇다.

1. `GoogleDriveSettings.svelte:285`의 `{#if connected}` 블록에는 `Disconnect` 버튼만 있고(`:373-375`),
   `Connect` 버튼은 `{:else}` 가지(`:378-384`)에만 있다. 연결된 상태에서 다른 계정으로 다시 링크하는
   버튼은 **존재하지 않는다**.
2. `handleDisconnect`(`:225-236`) → `disconnectGoogleDrive()` → `GoogleDriveService#disconnect`
   (`google-drive.service.ts:657-658`) → `GoogleDriveRepository#deleteCredentials`
   (`google-drive.repository.ts:106-108`) = `delete from "user_google_drive" where "userId" = $1`.
   **행 전체가 사라진다 → `driveAccountId`도 사라진다.**
3. 다시 `Connect` → `linkAccount` → `const previous = await …getCredentials(userId)`
   (`google-drive.service.ts:367`)는 `undefined`,
   `accountChanged = !!previous?.driveAccountId && …`(`:369`)는 `false`.
   `deleteUploads`는 호출되지 않는다.

즉 **리포트가 고쳤다고 말한 바로 그 시나리오("개인 계정 → 백업 전용 계정")에서 원장은 그대로 남고,
새 Drive는 여전히 영원히 비어 있다.** revoked 경로도 같은 `deleteCredentials`를 호출하므로
(`:940`), 접근이 취소된 뒤 다른 계정을 연결하는 경우에도 마찬가지다.

이 구멍은 설계 문장 하나로 요약된다: 원장은 disconnect를 **의도적으로** 살아남는데
(`:652-655`, "재연결해도 이미 올라간 것을 다시 올리지 않으려고"), 그 원장이 어느 계정 것인지를 말해
주는 값은 disconnect와 함께 죽는다. **수명이 더 짧은 값으로 더 오래 사는 것을 가드할 수는 없다.**

새 테스트 4개가 이것을 놓친 이유도 명확하다. `arrangeLink`(`google-drive.service.spec.ts:1121-1152`)는
`previousAccountId === null && newAccountId === null`일 때만 `getCredentials`가 `undefined`를
돌려주게 되어 있고, 실제 UI 시퀀스인 "행이 아예 없는 상태에서 새 계정 링크"는 한 번도 실행되지 않는다.

**Fix** — 셋 중 하나. 아래로 갈수록 싸고 위로 갈수록 옳다.

1. **원장 행에 계정 id를 단다**(`google_drive_upload.driveAccountId`, PK `(userId, assetId,
   driveAccountId)` 또는 조회 시 현재 계정으로 필터). 그러면 "이미 업로드됨"이 자연히 계정 축을 갖게
   되어 **파괴적 삭제 자체가 필요 없어지고**, N3(원자성)·N4(경쟁 조건)·C4(비가역성)가 **한꺼번에**
   사라진다. 계정 A로 되돌아가면 A의 원장이 그대로 되살아난다는 보너스도 있다.
2. **신원값을 credentials 행보다 오래 살린다.** `disconnect`가 행을 지우는 대신 `refreshToken`만
   무효화하거나(현재 NOT NULL이라 스키마 변경 필요), `driveAccountId`만 남기는 별도 행을 둔다.
3. 최소한 **`previous`가 없거나 `driveAccountId`가 null일 때 그 사실을 로그로 남긴다**. 지금은
   "리셋하지 않았다"가 아무 흔적도 남기지 않아, C1 상태에 있는 배포와 정상 배포를 구분할 방법이 없다.

### C2 — 기존 배포의 "첫 전환"도 못 잡는다. 그런데 잡을 재료가 손에 있다 (High)

C1을 우회해 API를 직접 호출한다 해도, 마이그레이션이 만든 기존 행은 `driveAccountId = NULL`이므로
`accountChanged`는 여전히 `false`다. "null은 모름이지 다름이 아니다"라는 판단 자체는 옳지만, 그
결과는 **이 기능이 실제로 필요한 첫 순간에 정확히 아무 일도 하지 않는다**는 것이다. 사용자가 이를
피하려면 "같은 계정으로 한 번 재링크해서 id를 기록시킨 뒤 계정을 바꾼다"는, 아무도 알 수 없는 순서를
밟아야 한다.

그런데 그 시점에 **옛 계정의 refresh token이 손에 있다**: `previous.refreshToken`
(`getCredentials`가 이미 select한다, `google-drive.repository.ts:41`). `getDriveAccountId`는
refresh token 하나만 받는 함수다(`google-drive.service.ts:400`).

**Fix**: `previous?.driveAccountId`가 null이고 `previous?.refreshToken`이 있으면
`getDriveAccountId(previous.refreshToken)`로 **옛 계정의 id를 알아내서** 비교한다. 실패하면 지금처럼
"모름"으로 떨어지면 된다. 링크 시에만 도는 추가 API 호출 1회이고, 스키마 변경이 필요 없다.
보조 수단으로 `getStorage`(`:528`)가 이미 1분마다 `about.get`을 호출하므로 `fields`에
`user(permissionId)`를 얹어 null인 행을 기회주의적으로 backfill할 수도 있다 — 추가 호출 0회다.
(단 C1이 남아 있는 한 이 둘만으로는 부족하다.)

### C3 — 계정이 바뀌면 `folderId`는 즉시 유해해진다. 남겨두면 새 계정이 첫 업로드에서 차단된다 (High)

리포트의 2번 질문에 대한 답이다. 코드 경로로 끝까지 따라갔다.

- 업로드는 `parents: folderId ? [folderId] : []`(`google-drive.service.ts:828`)로 나간다. 그 id는
  옛 계정에서 picker로 고른 폴더이고, `drive.file` 스코프에서는 새 계정에 **그 파일에 대한 권한이
  아예 없다**(스코프의 정의상 앱이 만들었거나 picker로 준 파일만 보인다).
- Drive는 `notFound` 또는 `insufficientParentPermissions`로 답한다. 둘 다
  `FOLDER_UNUSABLE_REASONS`(`utils/google-drive.ts:48-53`)에 있고 `hasFolder`가 true이므로
  `classifyDriveError`는 **`FolderMissing`**을 돌려준다(`utils/google-drive.ts:82-84`,
  호출부 `google-drive.service.ts:947`).
- `FolderMissing`은 차단 클래스라 계정 전체가 멈추고(`getBlockingError` 게이트 `:751`), 알림이 한 번
  뜬다: *"The destination folder no longer exists or cannot be used. Choose a new folder in
  Settings"*(`:1251-1256`).

그러니 **"혼란스러운 무언가"는 아니다 — 메시지는 정확히 맞는 조치를 가리킨다.** 문제는 그 앞뒤다.

1. 리셋이 방금 원장과 **모든** 오류 행을 지웠으므로 라이브러리 전량이 pending이 되고 대량 큐잉이
   일어난다. 그 중 첫 잡이 실패하며 다시 차단될 때까지 in-flight 잡들은 전부 헛돈다.
2. 설정 화면은 **옛 계정의 `folderName`("Photos")을 그대로 표시한다.** 사용자는 "폴더는 멀쩡히
   보이는데 폴더가 없다고 한다"를 겪는다. `folderName`은 표시 전용 캐시이므로(테이블 주석) 계정이
   바뀌면 거짓말이 된다.
3. 결국 사용자는 폴더를 다시 골라야 하는데, 그건 **어차피 해야 하는 일**이다. 그렇다면 서버가
   미리 아는 사실(그 id는 이 계정에서 절대 못 쓴다)을 숨길 이유가 없다.

**Fix**: 리셋 분기 안에서 `folderId`/`folderName`을 null로 만든다. "null = My Drive 루트"라는 모델이
이미 있고(`:826-828`, `setFolderId('')` 경로 `:430-434`), 그러면 업로드는 최소한 **성공**하며 사용자는
원할 때 폴더를 다시 고르면 된다. 루트로 쏟아붓는 게 싫다면 최소한 `folderName`만이라도 지워 UI가
거짓말하지 않게 하고, 계정 변경 알림 하나를 띄운다(C4의 알림과 합칠 수 있다).

**앨범 선택(`google_drive_album`)을 남기는 판단은 옳다.** 그 테이블은 `(userId, albumId)`로 Immich
album을 가리키고 Drive 쪽 식별자를 전혀 담지 않는다(`schema/tables/google-drive-album.table.ts:32-41`).
계정이 바뀌어도 "이 앨범을 내 Drive에 백업한다"는 의도는 그대로 유효하다. 여기에 대해서는 리포트가 맞다.

### C4 — 오조작 한 번이 원장을 영구히 파괴하고, 사용자에게는 아무 고지도 없다 (High)

리포트가 묻지 않았지만 물었어야 할 것 — "이 수정이 고치려는 버그보다 나쁜 경로가 있는가"에 대한 답이다.

- `files.create`는 매 호출마다 새 파일을 만든다(`:836-847`). 이름·해시 기반 중복 제거는 어디에도
  없고, 원장이 **유일한** 중복 방지 장치다(`google-drive-upload.table.ts:8-17`이 그렇게 명시한다).
- 따라서 `deleteUploads`는 곧 "라이브러리 전량 재업로드"이고, 그 결과는 Drive의 **전량 중복**이다.
- 구글 계정 여러 개에 로그인해 있는 사용자가 동의 화면에서 프로필을 잘못 고르는 것은 흔한 오조작이다.
  (C1을 고치고 나면) 그 순간 즉시 원장이 지워진다. 되돌리려고 원래 계정을 다시 연결하면 이번에도
  "다른 계정"이므로 또 리셋이고, 이미 비어 있는 원장은 복구되지 않는다 →
  **원래 Drive에 라이브러리 전체가 한 벌 더 쌓인다.** 수정 전에는 같은 오조작이 무해했다.
- 지금 리셋은 `this.logger.log`(`:376`) 한 줄이 전부다. 알림도, 확인 절차도, "되돌릴 수 없다"는
  경고도 없다. 반면 이 코드베이스는 훨씬 가벼운 사건(할당량 초과, 폴더 소실)에도 알림을 띄운다
  (`notifyUploadFailure`, `:1245`).

**Fix**: 우선순위대로 — (a) C1-Fix 1(원장에 계정 id)을 택하면 이 위험 자체가 사라진다. 파괴가 아니라
필터가 되므로 오조작은 되돌릴 수 있다. (b) 그게 무겁다면 리셋 시 알림을 하나 만들고
("연결된 Google 계정이 바뀌어 백업 기록을 초기화했습니다. 전체 라이브러리를 다시 업로드합니다"),
(c) 설정 화면에 "다른 계정으로 연결" 버튼을 명시적으로 만들고 그 버튼에 확인 모달을 단다 — 이건
C1의 UI 측 해법이기도 하다.

### N1 — `@GenerateSql` 파라미터가 2개라 생성된 SQL이 실제 쿼리와 다르다 (Medium)

리포트는 "생성물은 읽지 않아도 된다"고 했는데, 읽으면 틀려 있다.

```
-- server/src/queries/google.drive.repository.sql:16-23
insert into "user_google_drive" ("userId", "refreshToken")
values ($1, $2)
on conflict ("userId") do update set "refreshToken" = $3
```

`driveAccountId`가 없다. 원인은 `google-drive.repository.ts:54`의
`@GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })`가 여전히 2개여서, 생성기가 세 번째
인자를 `undefined`로 호출하고 kysely가 `undefined` 컬럼을 통째로 빼기 때문이다. 런타임 쿼리는 3컬럼
insert + 2컬럼 update이므로 **체크인된 참조 SQL이 코드보다 오래된 사실을 말한다** — 이 파일의 존재
이유가 바로 그 대조인데.

**Fix**: `params: [DummyValue.UUID, DummyValue.STRING, DummyValue.STRING]`로 고치고 `//:sql` 재생성.
1줄.

### N2 — 신원 조회가 실패하면 저장돼 있던 계정 id를 null로 덮어쓴다 (Medium)

`upsertCredentials`의 `doUpdateSet({ refreshToken, driveAccountId })`(`google-drive.repository.ts:59`)는
`driveAccountId`가 null이어도 그대로 쓴다. 같은 계정을 재링크하는데 `about.get`이 일시적으로
실패하면(`getDriveAccountId`의 catch, `:410-413`) 멀쩡히 알고 있던 id가 **영구히 지워지고**, 그 뒤의
진짜 계정 변경은 "모름"이라 잡지 못한다. 일시적 장애가 영구적 능력 상실로 바뀌는 형태다.

**Fix**: null일 때는 기존 값을 보존한다 — `doUpdateSet`에서
`coalesce(excluded."driveAccountId", "user_google_drive"."driveAccountId")` 형태로. 또는 서비스 쪽에서
`driveAccountId ?? previous?.driveAccountId ?? null`을 넘긴다(더 쉽고, 테스트도 이미 있는 축이다).

### N3 — 순서: id를 먼저 쓰고 원장을 나중에 지운다. 그 사이 크래시가 최악의 상태를 만든다 (Medium)

`upsertCredentials`(`:371`) → `deleteUploads`(`:377`) → `clearErrors`(`:383`) 순이고 트랜잭션이 없다.
사이에서 프로세스가 죽으면 **"새 계정 id는 기록됐는데 원장은 옛 계정 것"** 이 되고, 다음 링크는 id가
같으므로 영원히 리셋하지 않는다 — 즉 크래시 한 번이 C1과 같은 영구 fail-open을 만든다.

**Fix**: 순서를 뒤집는다. `deleteUploads`/`clearErrors`를 먼저 하고 `upsertCredentials`를 마지막에
하면, 중간에 죽어도 "원장은 비었고 id는 아직 옛 것" → 다음 링크가 다시 리셋(멱등) → **수렴한다**.
트랜잭션 없이 순서만으로 해결된다. 진짜 원자성이 필요하면 리포지토리에 트랜잭션 메서드를 하나 두면
되지만, 위 순서 교체만으로 이 실패 모드는 사라진다.

### N4 — 경쟁 조건은 실재하고, 결과는 축소판 B1이다 (Medium)

리포트 3번 질문. 최악의 순서를 구체적으로 적으면:

1. 업로드 잡이 `getCredentials`로 **옛** refresh token을 읽는다(`:710`).
2. 같은 잡이 `hasUpload` 게이트를 통과한다(`:721`).
3. 그 사이 링크가 완료되어 `deleteUploads`가 원장을 비운다(`:377`).
4. 잡이 **옛 Drive**에 업로드를 마치고 `recordUpload`로 행을 쓴다(`:909`).

→ 그 자산은 "업로드됨"으로 굳고 **새 Drive에는 영원히 가지 않는다**. 정확히 B1이 고치려는 버그의
축소판이다. 규모는 (동시성 5) × (in-flight 잡)이고, 대용량 비디오면 창이 수 분까지 열린다.
반대 순서(기록 후 삭제)는 무해하다 — 그 자산은 새 계정으로 다시 올라간다.

오류 행 쪽도 같다: `clearErrors` 직후 옛 계정으로 실패한 잡이 `upsertError`를 쓰면(`:948`) 새 계정이
**옛 계정의 이유로** 차단된다. 이쪽은 `resumeUploads`(`:1226-1233`)가 차단 클래스를 지우고 재큐잉하므로
사용자가 복구할 수 있다.

**Fix**: 근본 해법은 C1-Fix 1(원장에 계정 id)이다. 그러면 3·4번 순서가 어떻든 옛 계정 행은 현재 계정
조회에 걸리지 않는다. 임시방편으로는 `recordUpload` 직전에 `driveAccountId`를 재확인하거나, 링크
직후 짧은 지연 뒤 `deleteUploads`를 한 번 더 돌리는 방법이 있는데 둘 다 지저분하다.

### N5 — `permissionId` 선택 자체는 타당하다. 다만 "이 필드가 채워진다"는 **검증되지 않은 외삽**이고, 비면 아무 흔적도 남지 않는다 (Medium)

리포트 1번 질문.

- **스코프**: `about.get`이 받는 스코프 목록에 `drive.file`이 있다는 것은 공식 문서로 확인했다
  (`https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get`). 그러나 메서드가
  호출 가능하다는 것과 **`user` 필드가 채워진다**는 것은 다른 명제다. 코드의
  "empirically verified"(`google-drive.service.ts:518-521`)는 명시적으로 **`storageQuota`**에 대한
  기록이고, 이번 호출은 `fields: 'user(permissionId)'`(`:407`)로 **다른 필드**를 요구한다. 리포트의
  "스토리지 게이지가 이미 하는 같은 호출"은 엄밀히 사실이 아니다 — 같은 엔드포인트, 다른 필드다.
- **문서가 보장하는 것**: `User.permissionId` = *"The user's ID as visible in Permission resources."*
  그게 전부다(`.../rest/v3/User`). 안정성 보장 문구도, Workspace 계정에 대한 단서도 문서에 없다.
  실무 지식으로는 계정당 고정된 난독화 id로 취급해도 무방하고 나도 그렇게 본다. 그러나
  **문서에 근거가 없다는 사실 자체**를 코드 주석이 "the account's stable id"라고 단정하는 것은
  과하다. (계정 삭제 후 같은 이메일로 재생성하면 새 id가 나올 텐데, 그 경우 Drive도 실제로 새것이므로
  리셋이 오히려 맞다.)
- **가장 나쁜 점**: 비어 오는 경우가 **완전히 조용하다.** `data.user?.permissionId ?? null`(`:409`)은
  예외가 아니므로 catch에 걸리지 않고, 성공 경로에는 로그가 없다. 즉 "권한 문제로 `user`가 안 오는
  배포"와 "정상 배포"가 로그상 구별되지 않고, 리포트가 우려한 대로 수정이 장식이 되어도 **아무도
  모른다**.

**Fix**: (a) `permissionId`가 null이면 `logger.warn`을 남긴다 — 3줄, 관측 가능성이 생긴다.
(b) 실기기에서 한 번 확인하고 그 결과를 `:518-521`처럼 주석에 적는다. 이 포크는 이미 그 관행을 갖고
있다. (c) 굳이 대안을 찾자면 토큰 교환 응답의 `id_token`(`sub` 클레임)이 정석이지만 `openid` 스코프
추가 = 전원 재동의라 값이 없다. `permissionId` 유지가 맞다.

### N6 — 직전 리뷰 C1(c)가 이행되지 않았다: 뒤집힌 인과 설명이 코드에 그대로 남아 있다 (Medium)

`6bfd4708a`는 커밋 메시지에서 인과를 바로잡았지만, **정작 코드의 주석은 손대지 않았다**
(`git show --stat 6bfd4708a`에 `context-menu-position.*`가 없다).

- `context-menu-position.spec.ts:46-48`: *"the menu overlapped the toolbar above it. That happens
  when the clamp runs against a height smaller than the menu ends up being, so the lift is too
  small."* — 바로 아래 두 줄(`shortBox.top === 700`, `grown.top === 400`)이 정반대를 단언한다.
- `context-menu-position.ts:8`: *"…overflowing the right edge and riding up over the toolbar."*
  오른쪽 넘침만 이 함수의 이야기다.

다음 사람은 커밋 메시지가 아니라 이 두 주석을 읽는다. 직전 리뷰가 "이 한 줄이 없으면 다음 사람이 같은
인과를 또 뒤집는다"고 쓴 자리가 정확히 여기다. **Fix**: 두 주석을 앵커 이야기로 고친다(2줄).

### N7 — 앵커 수정은 겹침을 27px → 4px로 줄인다. 0px은 아니다 (Medium)

리포트 5번 질문. 브라우저 없이 기하만으로 답할 수 있다.

- `ControlAppBar.svelte:20`: `absolute top-0 w-full … p-2` → 안쪽 `nav`는 y=8에서 시작.
- `@immich/ui` `ControlBar.svelte`의 base 클래스는 `h-control-bar … items-center`,
  `dist/theme/default.css:10`의 `--spacing-control-bar: --spacing(16)` = **64px**.
  → 툴바 띠는 **y ∈ [8, 72]**, 바깥 패딩 박스는 [0, 80].
- 트리거는 `ButtonContextMenu.svelte:210-223`의 `IconButton`, `size` 미지정 → 기본 `medium` →
  `internal/Button.svelte:61`의 `h-10 w-10` = **40px**. 세로 중앙 정렬이므로 버튼은 **y ∈ [20, 60]**.
- 옛 값: `align` 기본 `top-left`(`ButtonContextMenu.svelte:52`) → 앵커 y = `rect.y` = 20,
  `y={contextMenuPosition.y + 25}`(`:249`) → 메뉴 상단 **45** = 툴바 안쪽 **27px**.
- 새 값: `bottom-left` → 앵커 y = `rect.y + rect.height` = 60(`utils/context-menu.ts:31-33`),
  offset 8 → 메뉴 상단 **68**. 툴바 띠의 바닥이 72이므로 **4px이 여전히 겹친다.**

메뉴가 `fixed z-70`(`ContextMenu.svelte:86`)이라 툴바 위에 그려지고 버튼도 가리지 않으므로 증상은
사실상 해소되지만, "완전히 걷어냈다"고 말하려면 `offset.y = 12`(툴바 바닥에 딱 닿음) 또는 `16`
(바깥 패딩까지 벗어나 4px 여유)이 정확한 값이다. `(64 - 40) / 2 = 12`가 그 상수의 정체다.

clamp가 이 값을 다시 위로 끌어올릴 걱정은 없다: `maxHeight = H - top - margin`이고 `needScrollBar`가
높이를 그 값으로 묶으므로(`context-menu-position.ts:47-50`), 관측 높이는 `H - y - 8` 이하로 수렴하고
`top`은 `y`에 머문다. 직전 리뷰가 걱정한 "짧은 뷰포트에서 더 위로" 상황은 이 피드백 루프 덕에
실제로는 발생하지 않는다.

### N8 — "medium 테스트가 `driveAccountId`를 select한다"는 리포트 주장은 사실이 아니다 (Low)

`test/medium/specs/repositories/google-drive.repository.spec.ts`는 `user_google_drive`에 대해
`insertInto(...).values({ userId, refreshToken })`만 한다(`:41`, `:59`, `:244`, `:254`, `:271`, `:291`).
`getCredentials`도 `deleteUploads`도 호출하지 않는다. 그 인서트는 컬럼이 있든 없든 성공한다.

증명된 것은 **"마이그레이션이 신선한 DB에 오류 없이 적용된다"** 뿐이고(그건 사실이다 —
`20260903-2206.txt`의 `Migration "1787000000000-AddGoogleDriveAccountId" succeeded`), 새 컬럼이
읽기/쓰기에 실제로 쓰인다는 증거는 medium 스위트에 없다. **Fix**: 리포트 문장을 정정하거나,
`deleteUploads`와 `getCredentials`의 medium 테스트를 하나씩 추가한다(전자는 원장 삭제가 다른 사용자
행을 건드리지 않는지도 함께 볼 수 있다 — 지금은 유닛 모킹만 있다).

### N9 — 마이그레이션 자체는 깨끗하다 (정보)

리포트 4번 질문. `sql-tools`가 이 컬럼에 대해 생성했을 DDL을 **DB 없이** 뽑아 대조했다
(`schemaFromCode` → 컬럼 제거한 사본과 `schemaDiff` → `schemaDiffToSql`):

```
ALTER TABLE "user_google_drive" ADD "driveAccountId" character varying;
```

마이그레이션 `1787000000000-AddGoogleDriveAccountId.ts:16`과 **문자 단위로 동일**하고,
`down()`의 `DROP COLUMN`도 형제 마이그레이션(`1786100000000-AddGoogleDriveFolderName.ts`)과 같은
형태다. 데코레이터 쪽도 `@Column({ nullable: true })` + `string | null`로 일관된다
(`user-google-drive.table.ts:47-48`). **드리프트 없음.**

down 후 재적용 시 모든 계정 정보가 null이 되는 것은 **허용 가능**하다. 데이터 손실은 없고, 실패
방향이 "리셋하지 않음"이라 안전한 쪽이다. 다만 그 fail-open이 **이미 기본 상태**라는 것이 C1/C2의
요지이므로, "롤백해도 안전하다"는 위안은 생각보다 작다.

타임스탬프가 `1787000000000`(≈2026-08-17)이라 upstream이 그 이후에 만드는 마이그레이션보다 먼저
정렬된다. 이 포크의 기존 관행과 같고 포크 소유 테이블에 대한 ADD COLUMN이라 무해하다. nitpick.

### N10 — 같은 페이지의 다른 메뉴는 여전히 `top-left` + 25px다 (nitpick)

`+page.svelte:588`, `:711`의 두 `ButtonContextMenu`는 옛 조합 그대로다. 커밋 메시지대로 "짧아서
넘어간다"는 판단이지만, 같은 툴바에서 한 메뉴만 다른 규칙을 쓰는 상태가 남는다. upstream 코드라
건드리지 않는 결정은 존중하되, 플랜에 한 줄 남겨 두면 다음 사람이 "왜 이것만 다르지"를 다시 묻지 않는다.

## Answers to what the report asked me to attack

### 1. `permissionId`는 계정 식별자로 적절한가

**선택 자체는 적절하다. 근거의 강도가 주장보다 약하고, 비었을 때 조용하다는 게 문제다.** 상세는 N5.
요약하면 (a) `drive.file`이 `about.get`의 허용 스코프인 것은 공식 문서로 확인, (b) 그러나
**`user` 필드가 채워진다는 것은 이 저장소에서 검증된 적이 없다** — `:518-521`의 경험적 검증은
`storageQuota`에 대한 것이다, (c) 문서는 `permissionId`의 안정성을 보장하지 않는다(설명이 한 문장뿐),
(d) 조직 계정이라고 다르게 동작할 이유는 문서·구조상 없어 보이지만 확인하지 못했다,
(e) **null 처리는 안전한 방향이 맞다**(링크를 실패시키지 않는다). 다만 그 null이 로그를 전혀 남기지
않으므로, 리포트가 걱정한 "리셋이 영영 안 일어나는" 상태에 빠져도 관측할 수 없다 — 거기에 `warn`
한 줄을 넣는 것이 이 항목의 실질적 조치다.

한 가지 덧붙이면, 이 값이 식별하는 것은 **"어느 구글 사용자"이지 "어느 Drive"가 아니다.** 같은
계정으로 목적지 폴더를 다른 공유 드라이브로 바꾸면 원장 문제는 똑같이 생기지만 이 가드는 침묵한다.
현재 범위로는 정상이지만 플랜에 그렇게 적어 두는 편이 좋다.

### 2. 리셋 범위 — `folderId`는 틀렸고 앨범 선택은 맞다

C3 참조. `folderId`는 옛 계정의 것이라 새 계정에서 **반드시** 404/403을 부르고, 그 결과는
`FolderMissing` 차단이다. 메시지는 다행히 정확한 조치를 가리키지만, 리셋 직후 전량 큐잉된 잡들이
헛돌고 설정 화면은 존재하지 않는 폴더 이름을 계속 보여준다. 계정 변경 시 `folderId`/`folderName`도
같이 null로 만드는 것이 맞다. 앨범 선택(`google_drive_album`)은 Immich album id 축이라 계정과
무관하므로 남기는 것이 옳다.

### 3. 경쟁 조건 — 실재하고, 결과는 축소판 B1이다

N4 참조. 최악은 "옛 토큰으로 업로드 중이던 잡이 `deleteUploads` **이후에** `recordUpload`" 이고, 그
자산은 새 Drive에 영원히 가지 않는다. 규모는 동시성 5 × in-flight. 오류 행 쪽 경합은 `resumeUploads`로
복구 가능하다. 여기에 N3(크래시 시 순서 문제)를 더하면, 트랜잭션이 없다는 사실보다 **순서가 잘못돼
있다는 사실**이 더 시급하다 — 순서만 뒤집으면 크래시 경로는 수렴한다.

### 4. 마이그레이션 — 규약에도 맞고 드리프트도 없다

N9 참조. `sql-tools`가 생성했을 DDL과 문자 단위로 같다는 것을 **dev DB를 건드리지 않고** 오프라인으로
확인했다(`schemaFromCode` + `schemaDiff`). down 후 재적용의 "모름" 상태는 허용 가능하다.
참고로 dev DB(`immich`)를 읽기 전용으로 들여다본 결과 아직 이 컬럼이 없다 — 배포 시 적용되어야 한다.

### 5. 메뉴 앵커 — 방향은 맞고, 4px이 남는다

N7 참조. 27px → 4px. `offset.y`를 12(또는 16)로 하면 산술적으로 0이 된다. 리포트가 인정한 대로
회귀 테스트도 브라우저 확인도 없고, 나 역시 브라우저를 띄우지 않았다 — 위 숫자는 전부 CSS 토큰과
컴포넌트 소스에서 나온 계산이다.

### 추가 (a) 새 테스트 4개는 비공허한가 — **그렇다. 리포트가 주장한 것보다 강하다**

리포트의 "되돌리면 정확히 4개만 실패"를 직접 재현했다(`4 failed | 58 passed`). 그런데 그 실험만으로는
"4개가 각각 무엇을 지키는지"를 알 수 없어(전부 `upsertCredentials` 단언 하나로 같이 죽는다) 변이를
7가지로 나눠 돌렸다. 결과(위 증거 표):

| 변이                                   | 죽는 테스트                                    |
| -------------------------------------- | ---------------------------------------------- |
| 리셋 분기 제거 / `deleteUploads` 생략 / 리셋 시 `Revoked`만 정리 | `should forget what was uploaded…`             |
| 비교 반전                              | 위 + `should keep the ledger when the same account…` |
| null previous를 "다름"으로             | `should record the account without resetting…`  |
| null new를 "다름"으로                  | `should link successfully when Drive will not say…` |
| 계정 id 기록 생략                      | 위 중 3개                                       |

즉 **네 테스트가 각각 다른 분기를 지킨다.** 정말로 중요한 분기(`accountChanged === true` → 원장 삭제
+ 전 클래스 오류 정리)는 세 가지 변이가 전부 첫 번째 테스트에서 잡힌다. 이번에는 "고장난 적 없는
것을 무력화하고 비공허라 부른" 직전 라운드의 실수가 반복되지 않았다.

**다만 커버하지 못하는 분기가 하나 있고 그게 하필 유일하게 도달 가능한 분기다**: `getCredentials`가
`undefined`를 돌려주는 경우(= disconnect 후 링크). C1이다. 새 테스트를 하나 더 넣는다면
`arrangeLink({ previousAccountId: undefined-row })` 케이스여야 한다.

### 추가 (b) 이 수정이 더 나쁘게 만들 수 있는 경로 — **있다. 두 개다**

C4(오조작 한 번 → 원장 영구 파괴 → 전량 중복 업로드)와 N2(일시적 `about.get` 실패 → 저장된 계정 id가
null로 덮여 다음 전환을 영영 못 잡음). 둘 다 "리셋이 잘못 발동한다"와 "리셋 능력을 잃는다"의 양쪽
끝이고, C1-Fix 1(원장에 계정 id를 달아 비파괴적으로 만들기)이 둘을 한 번에 없앤다.

## What I did not verify

- **`about.get`이 `drive.file` 스코프에서 `user.permissionId`를 실제로 채우는지.** 구글 계정과 실제
  OAuth 자격 증명이 필요하고 이 세션에는 없다. 공식 문서에서 확인한 것은 "스코프 목록에 `drive.file`이
  있다"까지다. 이 리뷰에서 가장 큰 미검증 항목이며, C1과 별개로 **실기기 1회 확인이 필요하다.**
- **브라우저에서의 실제 렌더 위치.** N7의 4px은 `--spacing-control-bar: --spacing(16)`,
  Tailwind v4 기본 `--spacing: 0.25rem`, `h-10` IconButton을 전제로 한 계산이다. 실제 픽셀을 재지 않았다.
- **medium 테스트(15개)와 svelte-check 게이트.** 다른 세션이 같은 워크트리에서 계속 커밋 중이라
  testcontainer를 띄우는 긴 작업을 돌리지 않았다. `20260903-2206.txt`의 기록(10 passed, 마이그레이션
  적용 로그)만 읽었다.
- **web 유닛의 메인 워크트리 재현.** 메인 트리에서는 39개가 나오는데, 이는 다른 세션의 미커밋 작업이
  섞인 결과다. 36개는 `1db9f94b6`의 격리 워크트리에서 확인했다.
- **`ba73b1b14`의 CI.** 미푸시라 존재하지 않는다(리포트도 그렇게 적었다). `6bfd4708a`의 성공은
  `head_sha`까지 확인했다.
- **eslint.** 직전 리뷰가 기록한 web eslint 크래시 상태를 다시 확인하지 않았다.

## Feeding back into the plan

1. **"계정 변경 감지"를 완료로 닫지 말 것.** 현재 상태는 *"UI가 제공하는 유일한 경로에서 발동하지
   않는 감지기"*다(C1). 플랜에 `disconnect()`가 신원값을 지운다는 사실과, 원장이 disconnect를
   살아남는다는 기존 결정이 **서로 충돌한다**는 문장을 남긴다.
2. **다음 라운드의 첫 후보는 "원장에 계정 id를 단다"이다.** C1·C4·N3·N4가 한 번에 해결되고,
   파괴적 삭제가 필터로 바뀌어 되돌릴 수 있게 된다. 비용은 마이그레이션 하나와 `hasUpload`/
   `streamPendingUploads`/카운트 쿼리의 조건 한 줄이다. 이 트레이드오프를 플랜에 명시적으로 적고
   결정한다.
3. **"신원 확인이 조용히 실패할 수 있다"를 관측 가능하게.** `permissionId`가 null일 때 `warn` 한 줄.
   장식적 수정과 정상 동작을 구분할 수 있는 유일한 수단이다(N5).
4. **파괴적 동작에는 알림을 붙인다는 규칙.** 이 코드베이스는 할당량·폴더에는 알림을 띄우면서 라이브러리
   전체 재업로드에는 로그 한 줄만 남긴다(C4). 규칙으로 남겨 다음 파괴적 동작에서 같은 판단을 반복하지 않는다.
5. **생성물(`src/queries/*.sql`)은 "읽지 않아도 된다"가 아니다.** 이번에 `@GenerateSql` 파라미터
   개수 불일치로 실제와 다른 SQL이 체크인됐다(N1). 시그니처를 바꾸면 데코레이터 params도 함께 본다는
   체크리스트 항목을 만든다.
6. **주석 정정도 수정의 일부다.** 직전 리뷰 C1(c)가 커밋 메시지에서만 이행되고 코드 주석에는
   반영되지 않았다(N6). 리뷰 지적을 닫을 때 "어디에 반영했는가"를 파일:줄로 적는다.
7. **리뷰 세션은 반드시 별도 워크트리에서 실험한다**(X1). 이번에 리뷰 실험이 다른 세션의 커밋에
   섞여 들어가 `64b67f35a`가 자기 테스트를 통과하지 못하는 커밋이 됐다. `CLAUDE.md`의 "리뷰는 별도
   세션에서" 항목에 **"별도 워크트리에서"**를 추가한다.

---

**변경 파일 확인**: 리뷰 작성 전 `git status --porcelain`은 비어 있었다(X1의 원복은 다른 세션의
`0d4eb64ed` 커밋이 이미 흡수했다). 변이 실험은 후반부 전부 `/tmp/.../wt-review`, `/tmp/.../wt-b7`
격리 워크트리에서 돌렸고 두 워크트리 모두 `git worktree remove`로 제거해 `git worktree list`로
확인했다. 이 저장소에서 내가 **의도적으로** 만든 변경은 이 리뷰 파일 하나다 — 다만 X1에 적은
비의도적 사고가 있었고, 그 처리는 리포트 작성 세션에 맡긴다.
