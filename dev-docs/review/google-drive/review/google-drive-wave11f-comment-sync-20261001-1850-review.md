# Code Review — wave11f: wave11e 반영분 (주석·문서만)

| | |
|---|---|
| Branch / HEAD | `feat/google-drive-album-sync-v3.1.0` / `58b05d279` (요청서 커밋; 리뷰 대상 코드는 `be9eb7110`. dirty 는 ` M mise.lock` 뿐) |
| Commits reviewed | `3458caadf..be9eb7110` (1 commit) |
| Report | ../report/google-drive-wave11f-comment-sync-20261001-1845-report.md |
| Reviewed | 2026-10-01 |

## Verdict

**NOT BLOCKED.** 요청서의 두 공격 지점을 모두 코드로 확인했다. (1) `.ts` 변경은 주석뿐이다 — 두 리비전의 파일에서 `//`
주석과 빈 줄을 벗겨 내고 `diff` 하면 **동일**하고, 데코레이터·타입·컬럼 옵션(`@Column({ type: 'integer', default: 1 })`)은
그대로이므로 마이그레이션이 암시되지 않는다. (2) 새로 쓰인 문장은 전부 `be9eb7110` 의 코드와 맞는다 — 상수 이름
(`GOOGLE_DRIVE_MAX_UNATTENDED_ATTEMPTS = 5`, `enum.ts:1244`), capped 클래스 셋(`enum.ts:1224-1228` = `unknown` ·
`source_unreadable` · `size_mismatch`), 클래스 무관 누적(`repository.ts:855-858` 의 `attempts + 1`), 설정 화면 표시
(`GoogleDriveSettings.svelte:450`), 그리고 "차단된 사용자는 상한보다 먼저 사용자째 걸러진다"(`repository.ts:614-626` 의
blocking 술어가 `:636-648` 의 cap 술어 앞에 있고, 둘 다 `where` 라 어느 쪽이든 한 사용자가 blocking 행을 가지면 그 사용자의
자산은 출력에 없다). 발견은 셋 다 nit 이고, 가장 큰 것은 스키마 주석이 cap 의 소비자를 "the nightly backfill" 하나로만
적었다는 것이다 — 같은 스트림이 관리자 "queue all" 과 차단 해제 후 resume 경로도 먹이므로 문장은 참이지만 좁다. 배포를 막는
것은 없다.

### Evidence I ran myself

메인 트리에서 읽기 전용 명령만 돌렸다. 워크트리·변이는 만들지 않았다 — 이 범위에 실행 가능한 변경이 없어 변이로 확인할
행동이 없다.

| Check | Result |
|---|---|
| `git log --oneline 3458caadf..be9eb7110` | 1 commit (`be9eb7110`) — 요청서와 일치 |
| `git show --stat be9eb7110` | 5 files: `CLAUDE.md` +5/-2, `failure-handling-plan.md` +4, `stabilization-plan.md` +4/-4, **wave11e 리뷰 파일 +185 (신규)**, `google-drive-upload-error.table.ts` +9/-6. 요청서 표는 넷만 적었다 (아래 N3) |
| `diff <(git show 3458caadf:…table.ts \| sed 's#//.*##' \| sed '/^\s*$/d') <(git show be9eb7110:…table.ts \| …)` | **IDENTICAL** — 주석을 벗기면 두 리비전이 바이트 단위로 같다 |
| `git show be9eb7110 -- …table.ts` | hunk 는 `:50-55` 한 곳, 전부 `//` 줄. `@Column({ type: 'integer', default: 1 })` 와 `attempts!: number` 는 context 줄로 남아 있다 |
| `npx tsc --noEmit -p tsconfig.json` (server) | exit 0 |
| `npx eslint src/schema/tables/google-drive-upload-error.table.ts --max-warnings 0` | exit 0 |
| `npx vitest run --config test/vitest.config.mjs src/services/google-drive.service.spec.ts src/utils/google-drive.spec.ts` | **159 passed** (126 + 33) — 결과 파일의 같은 두 스위트 수치와 일치 |
| `dev-test/google-drive/results/20261001-1841.txt` | 헤더 `commit: be9eb7110 … M mise.lock`, server 328/328 (8 files), web 87/87, svelte-check 회귀 없음, `RESULT: PASS` — 리포트 그대로 |
| `git diff --stat mise.lock` | 45 deletions, 리뷰 전부터 있던 dirty. 이 범위와 무관 |
| `git status --porcelain` (리뷰 파일 작성 후) | ` M mise.lock` + 이 리뷰 파일 `??` — 아래 "What I did not verify" 끝 |

medium 은 다시 돌리지 않았다 — 리포지토리·SQL·스키마 변경이 없고(위 IDENTICAL), 결과 파일이 `c0e99a0d7` 에서 72/72 를
기록한다. `.claude/scripts/verify-task server` 도 재실행하지 않았다 — 그것이 감싸는 tsc·eslint·vitest 를 개별로 돌렸다.

## Findings

### N1 — 스키마 주석이 cap 의 소비자를 "the nightly backfill" 하나로 적는다 (Nit, 주석 정확성)

`server/src/schema/tables/google-drive-upload-error.table.ts:51-53` (`be9eb7110`):

```
  // settings page, and — since wave11 R3 — also the input to the unattended retry cap: the nightly
  // backfill stops queueing an asset once this reaches GOOGLE_DRIVE_MAX_UNATTENDED_ATTEMPTS in a
  // capped class
```

cap 술어는 `streamPendingUploads` (`google-drive.repository.ts:636-648`) 안에 있고, 그 스트림의 소비자는
`service.ts:1871` `queuePendingUploads(userId?)` 하나다. 그 함수를 부르는 곳은 (a) 야간 → `queue.service.ts:306`
`GoogleDriveUploadQueueAll` → `service.ts:1862` `queuePendingUploads()`, (b) 관리자 Jobs 화면의 queue-all
(`queue.service.ts:249`, 같은 job), (c) 차단 해제 후 resume (`queuePendingUploads(userId)`, `repository.ts:650-652` 주석).
즉 cap 은 세 경로 모두에 걸린다. 주석의 문장은 거짓이 아니지만("only" 라고 하지 않았다), `attempts` 의 의미를 스키마에서
읽는 사람은 "야간만 멈추고 관리자 버튼은 보낸다" 로 오독할 수 있다 — `enum.ts:1234-1235` 가 "manual sync / add-to-album
queue on the ledger alone" 이라고 우회 경로를 명시해 두었기 때문에 더 그렇다(그 둘은 다른 쿼리라 실제로 우회하지만,
queue-all 은 아니다).

**Fix:** "the nightly backfill" → "the backlog stream (`streamPendingUploads` — nightly backfill, admin queue-all, resume)".
한 줄 교체. 다음 라운드 없이 docs 커밋으로 닫아도 된다.

### N2 — `CLAUDE.md` §7 step 8 의 "5 attempts 행" 은 "5 이상" 이다 (Nit, 운영 문서)

`CLAUDE.md:504-506` (`be9eb7110`): "실패 목록에서 5 attempts 행을 먼저 본다". `attempts` 는 클래스 무관으로 매 실패마다
증가하고(`repository.ts:858`), 상한에 걸린 뒤에도 수동 동기화·앨범 추가는 ledger 만 보고 큐잉하므로(`enum.ts:1232-1235`)
그 시도가 실패하면 6, 7 로 계속 오른다. cap 술어도 `>=` 다(`repository.ts:643`). 플랜 `:198` ("rows at 5 attempts") 도 같은
표현이라 일관되긴 하지만, 운영 당일 "5" 를 그대로 필터하면 6 짜리를 놓친다.

**Fix:** "5 attempts 행" → "attempts 5 이상 행". 해는 없다.

### N3 — 요청서의 변경 표가 커밋의 다섯 번째 파일을 적지 않았다 (Nit, 요청서 정확성)

요청서 "What changed" 표는 네 파일인데 `git show --stat be9eb7110` 은 다섯이다 — `dev-docs/review/google-drive/review/
google-drive-wave11e-closing-20261001-1822-review.md` +185 (신규). 커밋 메시지 끝줄("Also commits the wave11e review file as
written")은 적었고, 리뷰 파일을 커밋하는 것은 §2 의 정상 절차라 문제는 아니다. 다만 "이 커밋이 무엇을 바꿨는가" 를 요청서로만
읽는 사람에게는 빠진 파일이다. 판정과 무관.

## Answers to what the report asked me to attack

### 1. `.ts` 파일의 diff 가 주석뿐인가

**그렇다.** 세 겹으로 확인했다.

- `git show be9eb7110 -- server/src/schema/tables/google-drive-upload-error.table.ts`: hunk 하나(`@@ -47,9 +47,12 @@`),
  `-` 3줄과 `+` 6줄이 전부 `//` 로 시작한다. `@Column({ type: 'integer', default: 1 })` / `attempts!: number;` 는 context.
- 주석(`//…`)과 빈 줄을 제거한 두 리비전을 `diff` → 출력 없음(IDENTICAL).
- `tsc --noEmit` exit 0, eslint exit 0 — 주석 경계가 깨져 코드로 새어 들어간 것이 없다.

따라서 스키마 데코레이터가 바뀌지 않았고 마이그레이션은 암시되지 않는다. 드리프트 검사(`sql-tools … migrations generate`)는
돌리지 않았다 — 입력이 바이트 단위로 같으므로 결과도 같을 수밖에 없다.

### 2. 새 문장이 `be9eb7110` 의 코드와 맞는가

문장 단위로 대조했다. `[확인함]` 은 코드를 열어 본 것.

**스키마 주석 (`table.ts:50-55`)**

| 문장 | 근거 | 판정 |
|---|---|---|
| "across every class it has held" | `repository.ts:855-858` `on conflict … do update set "error" = excluded."error", … "attempts" = … + 1` — 클래스가 바뀌어도 리셋 없음 | [확인함] 맞다 |
| "Shown on the settings page" | `GoogleDriveSettings.svelte:450` `google_drive_failure_attempts … count: failure.attempts`, DTO `google-drive.dto.ts:194` | [확인함] 맞다 |
| "since wave11 R3 — also the input to the unattended retry cap" | `repository.ts:636-648` cap 술어가 `attempts >= GOOGLE_DRIVE_MAX_UNATTENDED_ATTEMPTS` 를 읽는다 | [확인함] 맞다 |
| "the nightly backfill stops queueing an asset once this reaches GOOGLE_DRIVE_MAX_UNATTENDED_ATTEMPTS in a capped class" | `queue.service.ts:306` → `GoogleDriveUploadQueueAll` → `service.ts:1862,1875` → `streamPendingUploads` → `:642-643` `error in (capped) and attempts >= 5`. "in a capped class" 는 `error in` 조건 그대로 | [확인함] 맞다 — 다만 N1 (소비자가 야간만이 아님) |
| "(see that constant in enum.ts for why the count is not reset on a class change)" | `enum.ts:1237-1242` 가 정확히 그 이유("resetting it would make that number lie")를 적는다 | [확인함] 맞다 |
| "Earlier this comment said there was no cap; that was the failure-handling plan §4's accepted long-tail" | 이전 주석 `3458caadf:…:50-52` "there is no retry cap … see the failure-handling plan §4"; 플랜 `:148` `## 4. 미리 정해 둘 판단들` 아래 `:154-156` "2인 서버에선 감수, 규모가 커지면 상한 도입" | [확인함] 맞다 |
| "which the nightly retry made too costly to keep" | `repository.ts:631-633` "without a cap a file that is really gone … would be re-sent every night forever"; `stabilization-plan.md:48` F3 | [확인함] 맞다 |

**`CLAUDE.md:504-506` step 8**

- "대기 수에는 재시도 상한(5회)에 걸린 사진도 남는다(차단된 사용자의 대기가 남는 것과 같은 이유)" — `countPendingUploads`
  (`repository.ts:535-559`) 에는 blocking 술어도 cap 술어도 없다. `:531-532` 주석이 blocking 쪽 이유를 적고, cap 도 같은
  함수에 없으므로 "같은 이유" 가 성립한다. 진행 카드가 이 값을 쓰는 것은 `service.ts:1033-1039` `pending` →
  `google-drive.dto.ts:139`. [확인함] 맞다.
- "실패 목록에서 5 attempts 행을 먼저 본다" — 실패 목록이 `attempts` 를 보여주는 것은 위 표. [확인함] 맞다 — 다만 N2.

**`stabilization-plan.md:91` V6 / `CLAUDE.md:719` V6**

- "RateLimited ignores the cap" — medium `google-drive.repository.spec.ts:221-237` "should cap every capped class, and never
  RateLimited" 가 `RateLimited, 50` 을 넣고 계속 스트림되는지 본다. [확인함] 테스트가 고정한다.
- "blocking classes are excluded per user before the cap applies, so 'ignores the cap' is not observable for them through
  this query" — `repository.ts:614-626` blocking 술어(사용자 단위 `not exists`)와 `:636-648` cap 술어(자산 단위). SQL `where`
  는 순서가 없지만 둘 다 conjunct 라 blocking 행을 가진 사용자의 자산은 어느 순서로 평가해도 출력에 없다 — 그래서 "cap
  때문이 아니다" 를 이 쿼리의 출력으로는 구분할 수 없다는 말이 맞다. 게다가 `GOOGLE_DRIVE_CAPPED_ERROR_CLASSES`
  (`enum.ts:1224-1228`) 는 allowlist 라 `quota_exceeded`/`folder_missing` 이 애초에 없다. [확인함] 맞다.
- 한 가지 짚어 둔다: 오류 행은 (user, asset) 당 하나(`table.ts:34-38` 두 PK)라 "차단 클래스가 상한 이상 attempts 를 가진다"
  는 상황 자체는 가능하다(quota 로 5번 실패한 자산). 그 자산은 blocking 술어로 빠지고, cap 술어로도 빠지지 않는다(allowlist
  밖). 문장의 "not observable" 은 정확히 이것을 말한다.

**`stabilization-plan.md:96` V11**

- "clears the grant" — `service.ts:906`, `:1093` → `clearRevokedGrant` (`:468-474`) → `deleteCredentials` + throw. [확인함]
- "no `Revoked` row: these paths have no asset, and the error table is keyed on one" — `clearRevokedGrant` 본문에 `upsertError`
  없음; `upsertError(…, Revoked, …)` 호출은 `service.ts:1473` 업로드 워커뿐; 테이블 PK 는 `userId`+`assetId` 둘 다 FK
  (`table.ts:34-38`). [확인함]
- "service spec (pre-existing tests)" — `spec.ts:1599-1617` (getStorage, `deleteCredentials` 단언 + `driveAboutGet` 증인),
  `:1964-1980` (getPickerConfig, `deleteCredentials` 단언). 이 커밋은 spec 을 건드리지 않았으므로 "pre-existing" 이 맞다.
  "Skip clearRevokedGrant → fails" 는 wave11e 리뷰 변이 2 가 이미 재현했고 이번에는 다시 돌리지 않았다. [확인함/이전 라운드]

**`failure-handling-plan.md:157-160`**

- "`GOOGLE_DRIVE_MAX_UNATTENDED_ATTEMPTS = 5`" — `enum.ts:1244`. [확인함]
- "대상 클래스는 `GOOGLE_DRIVE_CAPPED_ERROR_CLASSES`(unknown·source_unreadable·size_mismatch)" — `enum.ts:1224-1228` 의 세
  멤버, 문자열 값 `enum.ts:1198,1200,1206`. [확인함]
- "근거와 탈출 경로는 `stabilization-plan.md`" — `:48` F3 (escape hatches), `:163-165` (cap escape hatch corrected), `:185`
  (N1 kept as intended). [확인함]

어긋나는 문장은 없다.

## What I did not verify

- medium 스위트와 마이그레이션 드리프트 검사는 돌리지 않았다 — 리포지토리·SQL·스키마가 바이트 단위로 같아(위 IDENTICAL) 결과가
  바뀔 입력이 없다. 결과 파일(`c0e99a0d7` 72/72)에 기댔다.
- `.claude/scripts/verify-task server` 는 재실행하지 않았다. 구성 요소(tsc·eslint·해당 스펙)를 개별로 돌렸고 전부 녹색이다.
- web vitest(87/87)·svelte-check 는 돌리지 않았다 — 이 범위에 web 변경이 없고 결과 파일이 기록한다.
- 변이 테스트는 하지 않았다 — 실행 가능한 변경이 없다. V11 의 "Skip clearRevokedGrant → fails" 는 wave11e 리뷰의 변이 2 로
  이미 재현된 것을 인용했다.
- 운영(랩탑)은 보지 않았다.
- 작성 후 `git status --porcelain` 은 ` M mise.lock`(리뷰 전부터 있던 것, 45 deletions) 과 이 리뷰 파일(`??`) 두 줄이다.
  이 세션이 만든 변경은 이 리뷰 파일 하나다.

## Feeding back into the plan

- **N1**: `table.ts:51-52` 의 "the nightly backfill" 을 "the backlog stream (nightly, admin queue-all, resume)" 로. cap 의
  소비자가 `streamPendingUploads` 하나이고 우회 경로(manual sync / add-to-album)는 *다른 쿼리* 라는 구분을 `enum.ts:1234-1235`
  가 이미 적고 있으니, 스키마 주석은 그 구분을 흐리지 않는 표현이어야 한다.
- **N2**: `CLAUDE.md:506` 과 `stabilization-plan.md:198` 의 "5 attempts" 를 "≥ 5" 로. cap 술어가 `>=` 이고 수동 경로가
  카운트를 계속 올린다는 사실을 운영 체크리스트가 반영해야 한다.
- 이 라운드로 wave11e N1~N4 는 전부 닫혔다. 남은 것은 wave11e 리뷰의 "Feeding back" 마지막 두 항목 —
  `dev-test/google-drive/README.md:36` medium 행 갱신, `CLAUDE.md` V12 "검증하지 않는 것" 줄을 프로브 수치로 교체 — 이고
  이번 커밋에도 들어가지 않았다. 요청서가 반영을 주장하지 않았으므로 발견이 아니라 남은 항목으로 다시 적어 둔다.
