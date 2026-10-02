# Code Review — cleanup round 2: attempt-cap 주석 세 곳 (comment-only)

| | |
|---|---|
| Branch / HEAD | `chore/drive-test-cleanup` / `31f297230` (작업 트리 clean) |
| Commits reviewed | `8243e265b..HEAD` (2 commits: 코드 `f616056e7`, 요청서 `31f297230`) |
| Report | ../report/google-drive-cleanup-cap-comments-20261002-1940-report.md |
| Reviewed | 2026-10-02 (작성 19:35) |

## Verdict

**NOT BLOCKED.** 세 `.ts` 파일의 diff 는 전부 주석 줄이다 — 데코레이터·쿼리 빌더 체인·`where` 술어·SQL 어느 것도 바뀌지
않았고 `src/queries/` 에 변경이 없다. 이전 라운드의 N1(`subscribeAlbum` 누락)과 N2(`repository.ts` 가 "nightly backfill"
만 적음)는 요청서가 말한 자리에서 고쳐졌고, 소비자·우회 목록을 코드와 대조한 결과 `enum.ts` 와 `table.ts` 의 목록은
전수다. 가장 중요한 문제는 **커밋 제목("every comment on the attempt cap names all its paths")이 아직 참이 아니라는 것**이다:
`google-drive.repository.ts:640-641` — 이번에 고친 바로 그 주석 블록의 마지막 문장 — 이 여전히 "manual sync / add-to-album
queue on the ledger alone" 이라 `subscribeAlbum` 이 빠져 있다. 이전 N1 을 `enum.ts`·`table.ts` 에는 적용하고 `repository.ts`
에는 stream 쪽(N2)만 적용한 것이다. 동작에는 아무 영향이 없으므로 nit 이고, 다음 문서 라운드에 한 줄로 끝난다.

### Evidence I ran myself

메인 트리는 손대지 않았다. 모든 단계 뒤 `git status --porcelain` 이 비어 있었고, 마지막에는 이 리뷰 파일 하나만 `??` 다.

| Check | Result |
|---|---|
| `git log --oneline 8243e265b..HEAD` | 2 commits: `f616056e7` (코드+이전 리뷰 결과), `31f297230` (요청서). 요청서 "one commit" 은 코드 커밋 기준 |
| `git diff --stat 8243e265b..HEAD` | 5 files: `enum.ts` +7/−5, `google-drive.repository.ts` +3/−2, `google-drive-upload-error.table.ts` +2/−2, 요청서 26, 이전 리뷰 128. **`server/src/queries/` 변경 없음** |
| `git diff 8243e265b..HEAD -- server/` 를 줄 단위로 읽음 | 바뀐 줄 전부가 ` * ` 또는 `// ` 로 시작한다. `enum.ts:1230-1237` JSDoc, `repository.ts:634-637` 체인 안 주석, `table.ts:54-55` 컬럼 주석. `GOOGLE_DRIVE_MAX_UNATTENDED_ATTEMPTS = 5` (`enum.ts:1246`), `@Column` 데코레이터, `.where(({ not, exists, selectFrom }) => …)` 술어(`repository.ts:642-652`) 모두 그대로 |
| `grep -rn "streamPendingUploads" server/src --include=*.ts` (spec 제외) | 실제 호출은 `google-drive.service.ts:1908` **한 곳**(`private queuePendingUploads`). 그 호출자 셋: `:1895` `handleGoogleDriveUploadQueueAll`, `:1026` `retryFailures`, `:1942` `resumeUploads`. 나이틀리는 `queue.service.ts:305-306` 이 같은 `GoogleDriveUploadQueueAll` 잡을 큐잉, 관리자 "queue all" 은 `queue.service.ts:249` |
| `grep -rn "queueGoogleDriveUploads" server/src --include=*.ts` (spec 제외) | 정의 `utils/google-drive.ts:191`. 호출: `google-drive.service.ts:1767` (`subscribeAlbum`, `:1752`), `:1862` (`syncAlbum`, `:1815`), `album.service.ts:354` (`queueGoogleDriveUploadsForAlbums` `:327` ← `:211` `addAssets`, `:294` `addAssetsToAlbums`). 다른 호출자 없음 |
| `utils/google-drive.ts:191-216` | `getUploadedAssetIds` 로 ledger 만 거르고 `queueAll`. `google_drive_upload_error`·`attempts` 를 보지 않음 → "filters on the ledger only, not this cap" 과 일치 |
| `repository.ts:642-652` | cap 술어(`error in GOOGLE_DRIVE_CAPPED_ERROR_CLASSES` ∧ `attempts >= GOOGLE_DRIVE_MAX_UNATTENDED_ATTEMPTS`)는 `streamPendingUploads` 안에만 있음 |
| `repository.ts:787-815` `recordUpload` | 트랜잭션 안에서 ledger upsert 후 `deleteFrom('google_drive_upload_error')` (`:812`) → "a success from any path deletes the row" 참 |
| `google-drive.service.ts:1017-1023` `retryFailures` | `clearErrors`(revoked 제외 전 클래스) 또는 `clearErrorsForAssets` → "'retry failed' clears the row" 참 |
| `npx prettier --check <세 파일>` / `npx eslint <세 파일> --max-warnings 0` | 둘 다 exit 0 |
| `npx tsc --noEmit -p tsconfig.json` (server) | exit 0 |
| `npx vitest run --config test/vitest.config.mjs` — `google-drive.service.spec.ts`, `album.service.spec.ts`, `utils/google-drive.spec.ts` | 3 files, **231/231 passed** (Drive 128, album 70, utils 33) |
| `awk 'length > 120'` 세 파일 | `table.ts:55` 127자 (이번 커밋이 만든 줄). `repository.ts:51`, `:54` 134·194자는 기존 줄 |
| `git status --porcelain` (리뷰 작성 후) | 이 리뷰 파일 하나만 `??` |

## Findings

### N1 (nitpick, 주석 완전성) — `repository.ts:640-641` 의 우회 목록에 아직 `subscribeAlbum` 이 없다

**증거.** `server/src/repositories/google-drive.repository.ts:640-641` (HEAD):

```
        // so capped assets never reach the queue at all. What gets one back is a human: "retry
        // failed" clears the row, and manual sync / add-to-album queue on the ledger alone.
```

이번 커밋이 같은 블록의 `:635-636` 에 stream 소비자 넷을 채워 넣었지만(`git diff` hunk 는 `:634-637` 만), 블록 끝의
우회 경로 문장은 손대지 않았다. `queueGoogleDriveUploads` 호출자는 셋이고(`google-drive.service.ts:1767` `subscribeAlbum`
포함) `enum.ts:1234-1236`·`table.ts:54-55` 는 이번에 셋으로 고쳤으므로, 세 파일 중 `repository.ts` 만 둘을 적는 상태가
됐다 — 커밋 제목 "every comment on the attempt cap names all its paths" 와 요청서 "each list is complete" 가 이 한 줄에서
어긋난다. 동작·테스트에는 무관하다.

**수정.** `:641` 을 "… and manual sync, selecting an album for backup, and add-to-album queue on the ledger alone." 로. 또는
이 문장을 "see GOOGLE_DRIVE_MAX_UNATTENDED_ATTEMPTS in enum.ts for the paths that bypass this" 로 줄여 목록을 한 곳에만
두는 쪽이 다음 wave 에서 또 어긋나는 것을 막는다(아래 Feeding back).

### N2 (nitpick, 포맷) — 줄바꿈이 반영되지 않은 두 자리

- `google-drive-upload-error.table.ts:55` 가 127자 — 두 단어("selecting an album / for backup")를 끼워 넣고 뒤 문장을
  당기지 않아 printWidth 120 을 넘는다. Prettier 는 주석을 접지 않고 ESLint 에 max-len 이 없어 **도구는 통과한다**
  (위 표), 그래서 nit 이다.
- `google-drive.repository.ts:636-637` — `(and the admin "queue all", resume and retry paths), and without a cap a file that is`
  다음 줄이 `really gone or really unacceptable to Drive would be` 로 짧게 끊기고 그 다음 줄 `re-sent every night forever.`
  로 이어진다. 세 줄을 한 번 다시 접으면 된다.

둘 다 `prettier --write` 로는 안 고쳐지므로 손으로 접어야 한다. 다음 문서 라운드에 N1 과 묶는다.

## Answers to what the report asked me to attack

### `.ts` diff 가 주석만인가 (데코레이터·쿼리·SQL 변경 없음, `mise //:sql` 불필요)

**맞다.** `git diff 8243e265b..HEAD -- server/` 의 추가·삭제 줄은 예외 없이 ` * ` / `// ` 로 시작한다. 세 파일에서 바뀐
위치는 `enum.ts:1230-1237` (JSDoc, 상수 값 `5` 와 `export const` 줄은 hunk 밖), `repository.ts:634-637` (체인 안 주석;
`.where(…)` 술어 `:642-652` 와 `.$if`·`.select`·`.distinct()`·`.stream()` 모두 hunk 밖), `table.ts:54-55` (컬럼 주석;
`@Column({ type: 'integer', default: 1 })` 그대로). `src/queries/*.sql` 에 변경이 없고, 주석은 생성 SQL 에 들어가지 않으므로
`mise //:sql` 이 필요 없다는 요청서 판단에 동의한다 — 단 `mise //:sql` 자체를 돌려 "No changes" 를 확인한 것은 아니다(아래).
tsc / eslint / prettier / 관련 spec 231 개 모두 통과.

### 목록이 전수인가

**stream 소비자 — 전수.** `streamPendingUploads` 를 부르는 곳은 `queuePendingUploads` (`:1908`) 하나뿐이고, 그 호출자는
`handleGoogleDriveUploadQueueAll` (`:1895`), `resumeUploads` (`:1942`), `retryFailures` (`:1026`) 셋이다. `enum.ts:1232`
가 넷("nightly backfill, admin "queue all", resume, retry")을 적는 것은 `handleGoogleDriveUploadQueueAll` 하나가 나이틀리
(`queue.service.ts:306`)와 관리자 버튼(`queue.service.ts:249`) 두 트리거를 받기 때문이다 — 코드 기준 셋, 트리거 기준 넷,
둘 다 맞고 요청서의 "three consumers" 와 주석의 네 이름은 같은 사실이다. `table.ts:52-53` 과 `repository.ts:635-636`
도 같은 넷.

**우회 경로 — `enum.ts`·`table.ts` 는 전수, `repository.ts` 는 하나 모자란다 (N1).** `queueGoogleDriveUploads` 호출자는
`subscribeAlbum` (`:1767`), `syncAlbum` (`:1862`), `AlbumService#queueGoogleDriveUploadsForAlbums` (`:354`; `addAssets`
`:211` 와 `addAssetsToAlbums` `:294` 가 부름) 셋이다. "selecting an album for backup" = `subscribeAlbum` (`:1762` 에서
`subscribe` 뒤 앨범 자산 전부를 `queueGoogleDriveUploads` 에 넘김), "add-to-album" 은 `addAssets`·`addAssetsToAlbums` 둘을
묶은 표현으로 충분하다. 요청서가 `AlbumService` 호출자를 "add-assets" 하나로 적은 것도 같은 이유로 맞다.

**"ledger only" 와 "success deletes the row" 도 참.** `utils/google-drive.ts:207-215`, `repository.ts:812`.

## What I did not verify

- `./dev-test/google-drive/run.sh` 전체(web 87, svelte-check)를 다시 돌리지 않았다. 요청서도 이번 범위에서 run.sh 를 다시
  돌리지 않았다고 적었고, 직전 라운드 `results/20261002-1922.txt`(`fef32890b`) 가 마지막 증거다. server 쪽은 Drive·album·
  utils spec 세 파일(231 개)과 tsc 로 갈음했다 — 변경이 주석뿐이라 다른 스위트가 영향받을 경로가 없다.
- `.claude/scripts/verify-task server` exit 0 주장 — 그 스크립트는 돌리지 않았고 구성 요소(prettier·eslint·tsc·spec)를
  개별로 돌렸다.
- `mise //:sql` 을 돌려 생성 SQL 이 바이트 단위로 같은지 확인하지 않았다(DB 필요). 주석이 생성물에 들어가지 않는다는
  사실과 `src/queries/` 에 diff 가 없다는 것으로 판단했다.
- medium(실 DB) 스위트 — 변경 범위 밖.
- 요청서 파일명 stamp `1940` 이 작성 시각(19:34 기준으로 아직 안 온 시각)보다 앞선다. 짝 찾기는 이름으로 하므로 리뷰
  파일은 같은 stamp 로 두었고, 실제 작성 시각은 표에 적었다. 찾아 들어가지는 않았다.

## Feeding back into the plan

- **cap 의 소비자·우회 목록이 이제 세 파일에 세 벌 전부 적혀 있다** (`enum.ts:1230-1237`, `repository.ts:634-641`,
  `table.ts:50-56`). 이전 리뷰가 "한 곳을 정본으로, 나머지는 가리키기만" 을 제안했는데 이번 커밋은 반대로 세 곳을 모두
  채우는 쪽을 택했고, 그 커밋 안에서 이미 한 벌(`repository.ts:641`)이 어긋났다(N1). 다음 문서 라운드에서 `enum.ts` 의
  JSDoc 을 정본으로 두고 `repository.ts`·`table.ts` 는 "see GOOGLE_DRIVE_MAX_UNATTENDED_ATTEMPTS" 로 줄이는 것을
  다시 권한다 — 리뷰 체크 항목으로는 "`queueGoogleDriveUploads` 호출자 수 = 주석의 우회 경로 수" 를 남기면 된다.
- 목록 검증 명령은 두 줄로 고정된다: `grep -rn "streamPendingUploads(" server/src --include=*.ts | grep -v spec` 과
  `grep -rn "queueGoogleDriveUploads(" server/src --include=*.ts | grep -v spec`. 호출자가 늘면 세 주석(또는 정본 하나)을
  같이 고친다.
