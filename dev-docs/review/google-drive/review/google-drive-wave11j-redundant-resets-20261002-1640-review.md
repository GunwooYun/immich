# Code Review — wave11j: 중복 mock 리셋 제거(테스트 전용), N2 분쟁 재현

| | |
|---|---|
| Branch / HEAD | `wave11g-isolated-review-fixes` / `040d3a071` (작업 트리 clean) |
| Commits reviewed | `0e9cdb4e0..HEAD` (2 commits: 코드 `e0744f697`, 요청서 `040d3a071`) |
| Report | ../report/google-drive-wave11j-redundant-resets-20261002-1640-report.md |
| Reviewed | 2026-10-02 (작성 16:46) |

## Verdict

**NOT BLOCKED.** 변경은 요청서가 말한 그대로다 — `google-drive.service.spec.ts` 에서 lazy-open 테스트 두 곳의
`driveFilesCreate.mockClear()` (+ 첫 번째 옆 주석 3줄)와 `upload verification` describe 의 `driveFilesCreate.mockReset()`
을 지우고, 후자 자리에 "file-level beforeEach 가 리셋한다"는 한 줄 주석을 두었다(`git show e0744f697` 로 대조, −5/+1).
제품 코드 변경 없음. 지운 리셋들이 **실제로 중복이었다**는 것과, 지운 뒤에도 그 단언들이 **공허하지 않다**는 것을 둘 다 직접
확인했다: `:237` 의 최상위 리셋 한 줄을 뺀 사본에서는 lazy-open 두 테스트가 순서와 무관하게 빨간불이 된다(아래 Evidence).
N2 분쟁은 writer 가 맞다 — `e53a6f528` 체크아웃에 가짜 env 네 개를 걸고 전체 스위트를 돌리면 **정확히 15 failed, 네 스펙,
queue 0** 이고, HEAD 에서 설정 핀을 빼면 **16 failed, 다섯 스펙, queue 1** 이다. 가장 중요한 "문제"는 작은 누락 하나다:
같은 파일 `:2717-2719` 에 **네 번째** `driveFilesCreate.mockClear()` 가 wave11i N1 이 지우자고 한 바로 그 문구("hoisted at
module scope, so it carries calls from earlier tests")와 함께 남아 있다. wave11i 리뷰어의 열거(세 곳)가 불완전했고 이번 커밋도
그 셋만 지웠다. 무해하지만 N1 의 취지(틀린 이유를 말하는 주석을 없앤다)가 반쪽만 달성됐다.

### Evidence I ran myself

메인 트리는 손대지 않았다. 과거 커밋 재현은 `git worktree add --detach` 로 스크래치 디렉토리(`/tmp/claude-1000/.../scratchpad/`)에
만들어 `node_modules` 를 심링크한 뒤 돌리고 `git worktree remove --force` 로 지웠다(`git worktree list` 가 원래 4개로 복귀).
"`:237` 제거" 변이는 스펙을 `src/services/zz-review-wave11j.spec.ts` 로 복사해 그 사본만 돌리고 `trap` 으로 삭제했다.
각 단계 뒤 `git status --porcelain` 빈 출력을 확인했다.

| Check | Result |
|---|---|
| `git log --oneline 0e9cdb4e0..HEAD` | 2 commits (`e0744f697`, `040d3a071`). 요청서 "one commit; test file + the wave11i review file" 와 일치(`e0744f697` stat: spec 6 lines, review 152 lines) |
| `git show e0744f697 -- server/src/services/google-drive.service.spec.ts` | 정확히 세 곳: `:575-577` 주석 2줄 + `mockClear()`, `:601` `mockClear()`, `:799` `mockReset()` → 주석 1줄. `driveFilesDelete` 두 줄 유지 |
| describe 체인 `:304 uploadAsset` → `:473` → `:527 mid-move…` 의 `beforeEach` | **없음** — `grep -n "^\s*\(describe\|beforeEach\|…\)("` 결과 `:224` 최상위 다음 `beforeEach` 는 `:252`(getAuthUrl), `:794`(upload verification). `:527` describe 본문은 `const movedPath` 뿐 |
| `arrangeReadyToUpload` (`:150-170`) | `driveFilesCreate` 를 건드리지 않음(systemMetadata / getCredentials / hasUpload / asset.getById / createReadStream 만) |
| Drive spec HEAD, 순서대로 + `--sequence.shuffle --sequence.seed=` 1, 7, 11, 42 | **5/5 모두 128 passed** |
| **`:237` 제거 사본, 순서대로** | **3 failed / 125**: lazy-open 두 테스트("treat an ENOENT at the lazy open…", "wait for a pending stream…") + `request layer > should send a 5xx failure once…`(`:1103` `toHaveBeenCalledTimes(1)`, 전에는 `:799` describe 리셋에 기댔음) |
| **`:237` 제거 사본, seed 42** | **5 failed / 123**: 위 셋 + wave11i 가 찾은 두 부정 단언(`:374`, `:401`) |
| `e53a6f528` 워크트리 + `IMMICH_GOOGLE_DRIVE_{CLIENT_ID,CLIENT_SECRET,REDIRECT_URL,API_KEY}` 가짜값, 전체 unit 스위트 | **15 failed / 2442 passed / 2 skipped (2459)** — `album` 1, `system-config` 5, `google-drive` 8, `server` 1. **`queue.service.spec` 0 failed** (자기 핀 `:39` 가 살아 있음) |
| HEAD 워크트리에서 `vitest.config.mjs` 의 핀 4줄 제거 + 같은 가짜 env, 전체 unit 스위트 | **16 failed / 2441 passed** — 위 15 + `queue > handleNightlyJobs > should run the scheduled jobs` (`queue.service.spec.ts:41`) |
| HEAD 메인 트리, 셸 env 에 `IMMICH_GOOGLE_DRIVE_*` 없음(확인), 전체 unit 스위트 | **94 files / 2457 passed / 2 skipped** |
| `npx tsc --noEmit -p tsconfig.json` (server) | exit 0 |
| `npx eslint src/services/google-drive.service.spec.ts --max-warnings 0` / `npx prettier --check` 같은 파일 | 둘 다 통과 |
| `dev-test/google-drive/results/20261002-1639.txt` | 커밋 `040d3a071` 에 포함됨. 헤더 `commit: e0744f697`, `UNCOMMITTED` 마커 없음. server 8 files 330/330 (Drive 128), web 87/87, svelte-check 회귀 없음, `RESULT: PASS`. medium 섹션 없음(요청서가 재실행 안 했다고 밝힘) |
| `git status --porcelain` (리뷰 작성 후) | 이 리뷰 파일 하나만 `??` |

## Findings

### N1 (nitpick, 정리) — `:2717-2719` 에 네 번째 중복 `driveFilesCreate.mockClear()` 가 N1 이 지우자던 주석과 함께 남아 있다

**증거.** `google-drive.service.spec.ts:2710` `describe('trashed assets')` 의 유일한 테스트:

```ts
// :2717-2719
// driveFilesCreate is hoisted at module scope, so it carries calls from earlier tests in
// this file; the assertion below is about this test only.
driveFilesCreate.mockClear();
…
expect(driveFilesCreate).not.toHaveBeenCalled();   // :2723
```

`:237` 최상위 `mockReset()` 뒤에 오므로 no-op 이고, 주석은 wave11i N1 이 "이제 틀린 이유"라고 짚은 `:575-576` 문장의
복사본이다. wave11i 리뷰어가 `grep` 으로 세 곳만 열거했고(`:575-577`, `:601`, `:799`), writer 는 그 목록을 그대로 처리했다 —
"All three removed" 는 사실이지만 목록 자체가 하나 모자랐다. 이 리뷰에서 `grep -n "mockClear()\|mockReset()"` 로 전수를 다시
봤고, `driveFilesCreate` 에 남은 지역 리셋은 이것 하나다.

같은 급으로 **`:1590` `getStorage` describe 의 `driveAboutGet.mockReset()`** 도 최상위 `:232` 와 중복이다. 주석은 없어서
오해를 부르지는 않는다 — 함께 지우면 깔끔하고, 두면 무해하다.

**고치는 법.** `:2717-2719` 세 줄 삭제(`:2723` 의 부정 단언은 `:237` 에 기댄다 — 위 Evidence 의 seed 42 결과가 보여주듯
그 리셋이 없으면 이 류의 단언이 떨어지므로 공허하지 않다). 원하면 `:1590` 도. 지운 뒤 128 + 셔플 시드 하나.

### N2 (nitpick, 문서 — 판정만) — 분쟁은 writer 가 맞다; 다만 그 숫자가 **env 값에 따라 달라진다**는 것을 기록해 둔다

**증거.** 위 Evidence 표 두 행. `e53a6f528`(queue 자기 핀 있음, 설정 핀 없음) + 가짜 env 네 개 = **15 / 네 스펙 / queue 0**.
HEAD 설정 핀 제거 = **16 / 다섯 스펙 / queue 1**. 따라서

- `vitest.config.mjs:34-35` "16 tests across five specs … (15 before queue.service.spec's own pin was moved here)" — **숫자·스펙 수
  모두 정확하다.** wave11i N2 의 "[미확인]" 표기는 오늘로 확인됐다.
- `374b3e4f2` 커밋 메시지 "15 tests across five specs (… queue)" — **이쪽이 틀렸다.** queue 는 그때 떨어지지 않았다. `e0744f697`
  메시지가 그렇게 적은 대로이고, 커밋을 고쳐 쓰지 않고 뒤 커밋에 기록한 것이 맞다.

하나 더 적어 둘 것: **같은 커밋에서도 export 하는 변수에 따라 숫자가 다르다.** wave11g 리뷰 M1 표
(`google-drive-wave11g-isolated-fixes-20261002-1343-review.md:56-63`)는 같은 병으로 **12**(google-drive 5)를 세었는데, 내
15 와의 차이 3은 전부 `getStatus` 테스트(`:1393`, `:2205`, `:2231` at `e53a6f528`)이고 그 셋은 `service.ts:679`
`pickerAvailable = !!googleDrive.apiKey` 때문에 **`IMMICH_GOOGLE_DRIVE_API_KEY` 를 export 했을 때만** 떨어진다. 즉 12 / 15 / 16
세 숫자가 전부 "맞는" 측정이고, 다른 것은 env 의 모양이다. 이것이 wave11h N2·wave11i N2 가 "숫자를 빼라"고 한 실질적 근거다 —
숫자가 틀려서가 아니라, 숫자를 재현하려면 **어떤 변수를 어떤 값으로 걸었는지**까지 적어야 하기 때문이다.

**고치는 법 (선택).** 지금 주석은 정확하므로 그대로 둬도 된다. 바꾼다면 "(all four IMMICH_GOOGLE_DRIVE_* set; 15 before …)" 처럼
조건을 붙이거나, 숫자를 빼고 "every spec that assumes the default off" 만 남긴다. 어느 쪽이든 이 라운드의 차단 사유는 아니다.

### 확인했고 문제 없는 것

- **지운 리셋 셋은 전부 중복이었다.** HEAD 에서 순서·셔플 4시드 모두 128/128. 요청서의 "In order and on shuffle seeds 1 and 42:
  128/128" 보다 두 시드(7, 11) 더 돌렸다.
- **지운 뒤 단언이 공허해지지 않았다.** `:237` 제거 사본에서 lazy-open 두 테스트가 **순서대로 돌려도** 떨어진다(앞선 `:482`,
  `:543` 테스트가 각각 `files.create` 를 한 번씩 부르므로 `:582` 의 `toHaveBeenCalledTimes(1)` 가 3 을 본다). 즉 이 테스트들은
  이제 `:237` 하나에 기대고, 그 한 줄이 빠지면 바로 드러난다 — "한 곳에서 리셋한다"는 설계가 실제로 작동한다는 뜻이다.
- **`upload verification > request layer` 의 `:1103` 도 같은 처지가 됐다.** 전에는 `:799` describe 리셋에 기댔고 지금은
  `:237` 에 기댄다. 사본에서 떨어진 셋째 테스트가 그것이다. 요청서가 언급하지 않았지만 의도된 결과다.
- **`driveFilesDelete` 두 줄(`:796-797`)은 중복이 아니다.** 최상위는 delete 를 리셋하지 않는다. 남긴 것이 맞다.
- **결과 파일은 요청서가 말한 그대로다.** 커밋 해시·clean 마커·스위트별 수 일치. medium 을 건너뛴 이유("no query or repository
  change")도 사실이다 — 이 커밋은 spec 파일만 만졌다.

## Answers to what the report asked me to attack

### Q1. lazy-open 테스트의 `toHaveBeenCalledTimes(1)` 이 이제 file-level 리셋에만 기대는가, 그 사이 `beforeEach` 가 `files.create` 를 부르지 않는가

**그렇다, 그리고 그것을 변이로 증명했다.** 체인은 `:220 describe(GoogleDriveService)` → `:304 uploadAsset` → `:473 an original
that moves…` → `:527 mid-move…` 이고, `beforeEach` 는 `:224` 최상위 하나뿐이다(`:252`, `:794` 는 형제 describe). `:527` 본문은
`const movedPath` 한 줄, 테스트들이 공유하는 `arrangeReadyToUpload` (`:150`) 는 `driveFilesCreate` 를 만지지 않는다. `:237` 을
뺀 사본에서 그 두 테스트가 순서와 무관하게 떨어지므로(3 failed in order, 5 failed seed 42) 다른 리셋 경로는 없다.

### Q2. N2 — "15 before queue's pin moved" 가 `e53a6f528` 의 코드와 정합한가

**정합하고, 측정으로 확인했다.** `git show e53a6f528:server/src/services/queue.service.spec.ts:36-39` 는 `should run the scheduled
jobs` 안에 `mocks.systemMetadata.get.mockResolvedValue({ googleDrive: { clientId: '', … } })` 핀을 갖고, 같은 커밋의
`vitest.config.mjs` `env` 는 `TZ` 뿐이다. 그 상태에 가짜 env 네 개를 걸면 queue 는 0 실패, 나머지 네 스펙이 15 다. queue 핀을
빼고 설정 핀도 뺀 HEAD 에서는 queue 1 이 더해져 16. 분쟁의 결론은 N2 에 적었다 — writer 의 숫자가 맞고 `374b3e4f2` 메시지가
틀렸다. 추가로, 숫자는 export 한 변수 집합에 민감하다(API_KEY 유무 = ±3).

## What I did not verify

- **`verify-task server` exit 0.** 그 스크립트를 통째로 돌리지 않았다. 구성 요소인 prettier(해당 파일) / eslint(해당 파일) /
  tsc / vitest unit 전체는 각각 직접 돌렸고 전부 통과했지만, eslint 는 전체 `src/**` 가 아니라 바뀐 스펙 파일에만 돌렸다.
- **web 87 / medium 72.** results 파일을 읽었고 재실행하지 않았다. 이 커밋은 server spec 한 파일만 바꿨다.
- **wave11g 리뷰어가 12 를 셀 때 실제로 어떤 env 를 걸었는지.** 그 리뷰 파일에 변수 목록이 없다. "API_KEY 를 안 걸었다"는
  `service.ts:679` 와 실패 테스트 집합에서 나온 **[추론]**이고, 세 숫자가 모두 측정값이라는 결론은 그 추론에 기댄다.
- **`:2717-2719` 를 실제로 지운 상태의 실행.** 지우면 `:2723` 이 `:237` 에 기대게 되는데, 그 방향이 안전하다는 것은 같은 구조의
  `:374`·`:401` 이 HEAD 셔플 4시드에서 통과하는 것으로 간접 확인했을 뿐이다.

## Feeding back into the plan

- **"중복 리셋 정리"는 grep 전수로 닫는다.** wave11i N1 의 세 곳 열거는 `driveFilesCreate` 를 눈으로 따라간 결과였고 하나를
  놓쳤다. 다음부터 이 류의 정리는 `grep -n "mockClear()\|mockReset()" <spec>` 한 줄의 출력을 요청서에 붙이고, 남긴 것마다
  "왜 남겼는지"(예: `driveFilesDelete` — 최상위가 리셋하지 않음) 를 적는다.
- **"리셋이 중복이다"는 지운 뒤 리셋 원본을 빼 보는 변이로 닫는다.** 이번에 `:237` 한 줄을 뺀 사본이 세 테스트를 떨어뜨렸다 —
  중복 제거가 공허하지 않았다는 증거이자, 앞으로 `:237` 을 누가 건드리면 어디가 깨지는지의 지도다. 요청서가 셔플 128/128 만
  적었는데, 그것은 "지워도 통과한다"일 뿐 "지운 것이 할 일을 최상위가 대신한다"는 아니다. 둘 다 적는다.
- **`vitest.config.mjs` 주석의 실패 수는 env 집합에 묶여 있다.** 12 / 15 / 16 이 전부 측정값이다. 숫자를 남길 거면 "all four
  `IMMICH_GOOGLE_DRIVE_*` set" 같은 조건을 같이 적고, 아니면 숫자를 뺀다. 재현 명령은 이 리뷰 Evidence 표의 워크트리 절차다
  (`git worktree add --detach <scratch> <commit>` + `node_modules` 심링크 + 네 변수 export + `npx vitest run --config
  test/vitest.config.mjs --reporter=json`).
- **역사 숫자의 오류는 뒤 커밋 메시지에 기록하고 앞 커밋을 고쳐 쓰지 않는다** — `e0744f697` 이 한 방식이 맞고, 이 리뷰가 그
  기록을 확인했다. 다음 사람은 `374b3e4f2` 의 "five specs (… queue)" 를 믿지 말고 `e0744f697` 과 이 리뷰를 본다.
