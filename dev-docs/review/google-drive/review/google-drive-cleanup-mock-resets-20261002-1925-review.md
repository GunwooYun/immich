# Code Review — cleanup: 마지막 중복 mock 리셋 제거, `attempts` 주석의 소비자 목록

| | |
|---|---|
| Branch / HEAD | `chore/drive-test-cleanup` / `8243e265b` (작업 트리 clean) |
| Commits reviewed | `f57d2e8ac..HEAD` (2 commits: 코드 `fef32890b`, 요청서+결과 `8243e265b`) |
| Report | ../report/google-drive-cleanup-mock-resets-20261002-1925-report.md |
| Reviewed | 2026-10-02 (작성 19:26) |

## Verdict

**NOT BLOCKED.** 변경은 요청서가 말한 그대로다 — `google-drive.service.spec.ts` 에서 `trashed assets` 테스트의
`driveFilesCreate.mockClear()` + 주석 2줄, `getStorage` describe 의 `beforeEach`(본문은 `driveAboutGet.mockReset()`
한 줄뿐, 주석은 describe 바로 아래로 옮기며 한 문장 추가)를 지웠고, `google-drive-upload-error.table.ts` 는 `attempts`
컬럼 주석 6줄만 바뀌었다(`@Column({ type: 'integer', default: 1 })` 그대로). 제품 코드·스키마 변경 없음. 지운 두 리셋이
**실제로 중복**이었다는 것과, 지운 뒤에도 해당 단언이 **공허하지 않다**는 것을 변이 두 개로 직접 확인했다: 최상위 `:237`
(`driveFilesCreate.mockReset()`)을 뺀 사본에서 `trashed assets` 테스트가 빨간불이 되고(요청서의 "4 tests fail" 과 정확히
일치), 최상위 `:232`(`driveAboutGet.mockReset()`)를 뺀 사본에서는 `getStorage > should serve a second call from cache`
가 빨간불이 된다 — 즉 `getStorage` 테스트들은 이제 최상위 리셋에 기대고, 그 리셋은 load-bearing 이다. 주석의 소비자 목록
("pending stream = nightly / admin queue-all / resume·retry")은 코드와 맞다. 가장 중요한 "문제"는 nit 하나다: 우회 경로
목록("Manual album sync and add-to-album")에 `subscribeAlbum` 이 빠져 있다 — 같은 `queueGoogleDriveUploads` 를 쓰는
세 번째 경로인데, `enum.ts:1232-1235` 도 똑같이 둘만 적고 있어 이번 커밋이 새로 틀린 것은 아니다.

### Evidence I ran myself

메인 트리는 손대지 않았다. 변이 실험은 스펙을 `server/src/services/zz-review-cleanup-mock-resets.spec.ts` 로 복사해 그
사본만 돌리고 `trap` 으로 삭제했다. 각 단계 뒤 `git status --porcelain` 빈 출력을 확인했다.

| Check | Result |
|---|---|
| `git log --oneline f57d2e8ac..HEAD` | 2 commits (`fef32890b`, `8243e265b`). `git diff --stat` 4 files: spec −8/+2, table.ts −3/+6, 요청서 31, results 52. 요청서 "one commit" 은 코드 커밋 기준이고 그 위에 요청서 커밋이 하나 더 있다 |
| `git show fef32890b -- …spec.ts` | 정확히 두 곳: `:1587-1590` `beforeEach(() => { … driveAboutGet.mockReset(); })` → 주석 2줄, `:2714-2716` 주석 2줄 + `mockClear()` 삭제 |
| `git show fef32890b -- …table.ts` | `:50-56` 주석만. 데코레이터·필드 타입 변경 없음 |
| 최상위 `beforeEach` `:224-240` | `driveFilesGet / driveAboutGet / driveFilesCreate / oauth2GetAccessToken` 네 개 `mockReset()` + access-token 복원. `driveAboutGet` `:232`, `driveFilesCreate` `:237` 둘 다 있음 |
| `getStorage` describe `:1586-1685` 의 7개 테스트 | **모두** 자기 `driveAboutGet` 값을 선언한다(`:1596, :1610, :1619, :1631, :1645, :1658, :1672`). describe 안에 다른 `beforeEach` 없음 |
| Drive spec HEAD, 순서대로 + `--sequence.shuffle --sequence.seed=` 1, 7, 42, 20261002 | **5/5 모두 128 passed** (요청서의 세 seed + 하나 추가) |
| **변이 A: `:237` `driveFilesCreate.mockReset()` 제거 사본, 순서대로** | **4 failed / 124**: `trashed assets > should skip an asset that is in the trash`, lazy-open 두 테스트, `request layer > should send a 5xx failure once…` — 요청서 "4 tests fail including trashed" 와 일치 |
| 변이 A, seed 42 | **5 failed / 123**: `trashed` 는 통과(순서상 앞선 테스트가 files.create 를 안 부름)하고 대신 `:374`, `:401` 두 부정 단언이 깨짐. 어느 테스트가 깨지느냐는 순서에 달렸지만 "최상위 리셋이 load-bearing" 이라는 결론은 같다 |
| **변이 B: `:232` `driveAboutGet.mockReset()` 제거 사본, 순서대로·seed 42** | 둘 다 **3 failed / 125**: `getStorage > should serve a second call from cache rather than calling Google again`(`:1624` `toHaveBeenCalledTimes(1)`), `getStatus > folder name backfill > …separate cooldowns`(`:2204`), `onGoogleDriveLoginGrant > should leave an existing connection completely alone`(`:2762`) |
| `grep -n "streamPendingUploads(" src --include=*.ts` (spec 제외) | 호출은 `google-drive.service.ts:1908` **한 곳**(`queuePendingUploads`). 그 호출자: `:1026` `retryFailures`, `:1895` `handleGoogleDriveUploadQueueAll`, `:1942` `resumeUploads`. 나이틀리는 `queue.service.ts:305-306` 이 같은 `GoogleDriveUploadQueueAll` 잡을 큐잉 |
| `grep -n "queueGoogleDriveUploads(" src` (spec 제외) | `google-drive.service.ts:1767` (`subscribeAlbum`), `:1862` (`syncAlbum`), `album.service.ts:354` (`queueGoogleDriveUploadsForAlbums` ← `:211` `addAssets`, `:294` `addAssetsToAlbums`) |
| `utils/google-drive.ts:191-216` | `getUploadedAssetIds` 로 ledger 만 거르고 큐잉. `attempts`·error 테이블을 보지 않음 → 우회 경로가 cap 을 안 탄다는 주석 주장과 일치 |
| `repository.ts:641-652` | cap 술어는 `streamPendingUploads` 안에만 있음(`attempts >= GOOGLE_DRIVE_MAX_UNATTENDED_ATTEMPTS`, capped class 한정) |
| `npx tsc --noEmit -p tsconfig.json` (server) | exit 0 |
| `npx eslint <두 파일> --max-warnings 0` / `npx prettier --check <두 파일>` | 둘 다 통과 |
| `dev-test/google-drive/results/20261002-1922.txt` | `8243e265b` 에 포함. 헤더 `commit: fef32890b (chore/drive-test-cleanup)`, server 8 files 330/330 (Drive 128), web 87/87, svelte-check 회귀 없음, `RESULT: PASS`. 요청서 수치와 일치 |
| wave11j 리뷰 `:67` | "`:1590` getStorage describe 의 `driveAboutGet.mockReset()` 도 최상위 `:232` 와 중복" — 요청서가 출처로 든 N1 에 실제로 들어 있음 |
| wave11f 리뷰 `:169-171` | N1 제안 문구 "the backlog stream (nightly, admin queue-all, resume)" — 이번 주석이 이를 따르고 retry 를 더했다 |
| `git status --porcelain` (리뷰 작성 후) | 이 리뷰 파일 하나만 `??` |

## Findings

### N1 (nitpick, 주석 완전성) — 우회 경로 목록에 `subscribeAlbum` 이 없다

**증거.** `google-drive-upload-error.table.ts:54-55`:

```
// … Manual album sync and add-to-album do
// not go through that stream, so they still queue it.
```

`queueGoogleDriveUploads` 의 호출자는 셋이다 — `google-drive.service.ts:1767` **`subscribeAlbum`**("Start backing an album
up … and immediately queue whatever is already in it"), `:1862` `syncAlbum`, `album.service.ts:354`(`addAssets` /
`addAssetsToAlbums`). 앨범을 새로 선택하는 순간에도 cap 에 걸린 자산이 그대로 큐잉된다. 주석은 두 경로를 예시로 든 것으로
읽을 수도 있지만, 바로 앞 문장이 stream 쪽 소비자를 "every" 로 열거했으니(커밋 제목도 "names every stream consumer")
읽는 사람은 우회 쪽도 전수라고 받아들인다. `enum.ts:1232-1235` 가 같은 둘만 적고 있어 이번 커밋이 새로 만든 누락은 아니다.

**수정.** 한 단어 수준: "Selecting an album, manual album sync and add-to-album do not go through that stream …". 고친다면
`enum.ts:1234` 도 같이 — 두 주석이 서로를 가리키므로("See the constant in enum.ts") 한쪽만 고치면 다시 어긋난다.
문서 전용 다음 라운드에 묶어도 된다.

### N2 (nitpick, 일관성) — `repository.ts:635` 는 아직 "This stream feeds the nightly backfill" 이다

wave11f N1 이 지적한 바로 그 표현("the nightly backfill" 하나)이 cap 술어 바로 위 주석 `google-drive.repository.ts:634-640`
에 그대로 남아 있다. 스키마 주석은 고쳤는데 cap 이 실제로 사는 자리의 주석은 아니다. 틀린 말은 아니고(나이틀리가 소비자
중 하나다) 그 아래 `:653-654` 가 resume 를 따로 적고 있으니 심각하지 않다 — 다만 `enum.ts:1231` "before the nightly
backfill stops queueing it" 과 함께, 같은 사실을 세 파일이 세 가지 폭으로 적고 있다. 발견이라기보다 다음 문서 라운드의
목록이다.

## Answers to what the report asked me to attack

### `getStorage` describe 의 `beforeEach` 가 통째로 사라졌다 — 그것 말고 뭔가 더 했나? 형제 테스트가 남긴 `driveAboutGet` 구현을 보는 테스트가 있나?

**더 한 것은 없다.** `git show fef32890b` 의 삭제 hunk 는 `beforeEach(() => { /* 주석 2줄 */ driveAboutGet.mockReset(); });`
가 전부다. 옮긴 주석은 원문 그대로이고 "driveAboutGet is reset by the file-level beforeEach" 한 문장이 붙었다(`:1587-1588`).

**형제 누수는 없다 — 두 가지로 확인했다.** (1) 정적으로: 7개 테스트 전부가 자기 `driveAboutGet` 값을 선언한다
(`mockResolvedValue` 5, `mockRejectedValue` 2, `mockResolvedValueOnce` 체인 1 — 체인은 `:1633-1634` 가 둘 다 소비한다).
`:1662-1663` 의 두 번째 호출은 credentials 가 `undefined` 라 `driveAboutGet` 에 닿기 전에 던진다. (2) 동적으로: 최상위
`:232` 를 뺀 변이 B 에서 깨지는 `getStorage` 테스트는 **호출 수**를 세는 `:1624` 하나뿐이고, 값을 보는 나머지 여섯은 리셋
없이도 통과한다 — 즉 describe 안에서 값이 형제로 새어 들어가는 테스트는 없고, 호출 수 누적만 최상위 리셋이 막는다.
그리고 HEAD 에서는 그 리셋이 살아 있으므로(`:232`) 순서·seed 네 개 모두 128/128 이다.

한 가지 짚어둘 점: `:1624` 가 변이 B 에서 깨진 것은 `getStorage` 안의 형제 때문이 아니라 **파일 전체**의 앞선 테스트
(순서대로 돌릴 때 `getStatus` 등)가 남긴 호출 때문이다. 그래서 지운 describe 수준 리셋은 정확히 최상위 리셋의 부분집합이었고,
둘 중 하나만 있으면 된다는 요청서의 전제가 맞다.

### 주석의 `streamPendingUploads` vs `queueGoogleDriveUploads` 경로 구분

**stream 소비자 셋은 전수다.** `streamPendingUploads` 를 부르는 곳은 `queuePendingUploads` (`:1908`) 하나이고, 그 호출자는
`handleGoogleDriveUploadQueueAll` (`:1895`, 관리자 "queue all" — 그리고 `queue.service.ts:305-306` 이 이 잡을 나이틀리에
큐잉한다), `resumeUploads` (`:1942`), `retryFailures` (`:1026`) 셋이다. 주석의 "nightly backfill, admin queue-all, resume/retry"
와 정확히 대응한다. cap 술어가 그 쿼리 안에만 있다는 것(`repository.ts:641-652`)과 `queueGoogleDriveUploads` 가 ledger 만
본다는 것(`utils/google-drive.ts:207-215`)도 확인했다.

**우회 경로 목록은 하나 모자란다** — N1. `subscribeAlbum` 도 `queueGoogleDriveUploads` 를 직접 부른다(`:1767`).

## What I did not verify

- `./dev-test/google-drive/run.sh` 전체(web 87, svelte-check)를 다시 돌리지 않았다. 첨부된 `results/20261002-1922.txt` 가
  커밋에 포함돼 있고 헤더 커밋이 `fef32890b` 로 맞는 것까지만 봤다. server 쪽은 Drive spec 한 파일만 재실행했다
  (이번 변경이 그 파일과 주석 하나뿐이라 전체 스위트 회귀 가능성은 tsc 통과로 갈음했다).
- medium(실 DB) 스위트 — 변경 범위 밖이고 요청서도 주장하지 않았다.
- `verify-task server` exit 0 주장 — 그 스크립트는 `.claude/scripts/` 에 있고 이 리뷰에서 돌리지 않았다. 구성 요소인
  tsc·eslint·prettier·spec 은 개별로 돌렸다.
- 변이 실험은 사본 파일(`zz-review-…spec.ts`)로 했으므로 vitest 가 두 파일을 함께 수집하는 상황은 만들지 않았다(사본만
  지정해 실행). 원본과 사본이 같은 모듈 mock 을 공유하는 일은 없었다.

## Feeding back into the plan

- wave11i → wave11j → 이번 라운드로 **스펙 안의 describe/테스트 수준 `driveFilesCreate`·`driveAboutGet` 리셋은 전부
  사라졌다**(`grep -n "driveFilesCreate.mockReset\|driveAboutGet.mockReset"` 결과 최상위 `:232`, `:237` 둘뿐). 다음에
  이 파일에 테스트를 추가할 때 "hoisted 라서 내가 직접 clear" 패턴을 다시 들여오지 않도록, 스펙 상단 `:226-236` 주석이
  그 이유를 이미 적고 있다 — 리뷰 체크 항목으로만 남기면 된다.
- cap 의 소비자/우회 경로를 적는 주석이 세 파일에 있다(`enum.ts:1230-1235`, `repository.ts:634-640`, `table.ts:50-56`).
  N1·N2 를 고칠 때 한 곳을 정본으로 두고 나머지 둘은 가리키기만 하게 하는 편이 다음 wave 에서 또 어긋나는 것을 막는다.
  `subscribeAlbum` 이 cap 을 우회한다는 사실은 운영 체크리스트(`CLAUDE.md` §8 "5 attempts" 줄, wave11f N2 가 "≥ 5" 로
  고치자던 곳)에도 해당된다 — 앨범을 새로 고르는 순간 capped 자산이 다시 큐잉되어 `attempts` 가 또 오른다.
