# Code Review — wave11i: 공유 `files.create` mock 리셋, pinned-test 수 정정

| | |
|---|---|
| Branch / HEAD | `wave11g-isolated-review-fixes` / `0e9cdb4e0` (작업 트리 clean) |
| Commits reviewed | `71ba55c79..HEAD` (2 commits: 코드 `4426cdfc7`, 요청서 `0e9cdb4e0`) |
| Report | ../report/google-drive-wave11i-mock-reset-20261002-1630-report.md |
| Reviewed | 2026-10-02 |

## Verdict

**NOT BLOCKED.** 변경은 두 줄짜리다 — 최상위 `beforeEach` 에 `driveFilesCreate.mockReset()` 한 줄
(`google-drive.service.spec.ts:237`)과 `vitest.config.mjs:33-34` 의 주석 숫자. 요청서의 핵심 주장 두 가지를
내가 직접 재현했다: ① 리셋을 뺀 사본으로 시드 1–5·42 를 돌리면 정확히 그 두 테스트가 떨어지고(시드 11 은
통과 — 순서 의존이라는 진단과 정합), ② 리셋이 기본 구현을 복원하지 않아도 **`files.create` 에 답 없이 도달하는
테스트는 0개**다(센티널 구현을 끼운 사본으로 128개를 돌려 로그가 비었고, 답 한 줄을 지운 양성 대조군에서는
로그가 찍히며 그 테스트가 `TypeError: Cannot destructure property 'data'` 로 빨간불). 가장 중요한 "문제"는
문제라기보다 정리 거리다 — 같은 파일의 하위 describe 세 곳에 남은 `mockReset()`/`mockClear()` 가 이제
중복이고, 그중 두 곳은 "공유 mock 이라 지운다"는 주석까지 달고 있어 다음 사람이 최상위 리셋을 모른 채 같은
패턴을 또 복제할 수 있다 (N1). 막을 이유는 없다.

### Evidence I ran myself

메인 트리는 손대지 않았다. "리셋 제거"·"센티널" 변이는 스펙을 `src/services/zz-review-*.spec.ts` 로 복사해
그 사본만 돌리고 바로 지웠다(`trap` 으로 삭제, 각 실행 뒤 `git status --porcelain` 빈 출력 확인). 사본은
같은 디렉토리에 두어 `src/...`·`test/...` 임포트가 그대로 풀린다.

| Check | Result |
|---|---|
| `git log --oneline 71ba55c79..HEAD` | 2 commits. `4426cdfc7` 는 spec +5, config +3/−2 — 요청서 표와 일치 |
| `git show 4426cdfc7` | spec 은 `:233-237` 주석 4줄 + `driveFilesCreate.mockReset()` 1줄만 추가. 기본 구현 복원 없음(요청서대로) |
| `dev-test/google-drive/results/20261002-1627.txt` | 헤더 `commit: 4426cdfc7 (wave11g-isolated-review-fixes)`, `UNCOMMITTED` 마커 없음. server 330/330 (8 files, Drive spec 128), web 87/87, medium 72/72, `RESULT: PASS` |
| Drive spec HEAD, `--sequence.shuffle --sequence.seed=` 1, 2, 3, 4, 5, 11, 42, 2026 | **8/8 시드 모두 128 passed** |
| 리셋 제거 사본(`:237` 삭제), 같은 셔플 시드 1, 2, 3, 4, 5, 42 | **각 2 failed / 126 passed** — "should skip a blocked user without touching the asset or calling Drive", "should skip an asset no longer in any selected album, before calling Drive". 요청서 표 2행과 일치 |
| 리셋 제거 사본, 시드 11 | **128 passed** — 그 순서에서는 두 테스트가 어떤 `files.create` 호출보다 앞에 놓인 것. 순서 의존 진단의 반대쪽 증거 |
| 센티널 사본: `:237` 과 `:799` 의 `mockReset()` 직후 `mockImplementation(() => { appendFileSync(<scratch>, currentTestName); return undefined; })` | 128 passed, **센티널 로그 비어 있음** → 답을 세우지 않고 `files.create` 에 닿는 테스트 없음 (Q1) |
| 센티널 양성 대조군: 위 사본에서 `:807` 의 `driveFilesCreate.mockResolvedValue(...)` 한 줄 삭제 | 로그에 `upload verification > should record the upload when the stored size matches` 1건, 그 테스트 `promise rejected "TypeError: Cannot destructure property 'data' of '(intermediate value)' as it is undefined"` 로 1 failed / 127 passed → 센티널은 비공허하다 |
| `npx eslint src/services/google-drive.service.spec.ts --max-warnings 0` | exit 0 |
| `npx prettier --check` spec + `test/vitest.config.mjs` | 통과 |
| `test/vitest.config.mjs` 에 `clearMocks`/`mockReset`/`restoreMocks` | 없음 — 호이스트 mock 은 파일이 직접 지워야 한다는 전제 확인 |
| `git status --porcelain` (리뷰 작성 후) | 이 리뷰 파일 하나만 `??` |

## Findings

### N1 (nitpick, 정리) — 하위 describe 의 `mockReset()`/`mockClear()` 세 곳이 중복이 됐고, 주석이 옛 사정을 말한다

**증거.** 최상위 `beforeEach` (`google-drive.service.spec.ts:224-240`) 가 매 테스트 전에
`driveFilesCreate.mockReset()` 을 하므로 아래는 전부 no-op 이다:

- `:799` `upload verification` describe 의 `driveFilesCreate.mockReset();` (요청서 Q3)
- `:575-577` lazy-open describe: `// driveFilesCreate is a hoisted module mock shared across the file; clear its call log so the count below is about this test only.` + `driveFilesCreate.mockClear();`
- `:601` 같은 describe 두 번째 테스트의 `driveFilesCreate.mockClear();`

세 곳 모두 무해하다 — 리셋 뒤 각 테스트가 자기 답을 세우므로 결과가 바뀌지 않는다(센티널 실험이 그것을
보장한다). 문제는 `:575-576` 주석이다: "파일 공유 mock 이라 여기서 지운다"는 문장은 **이제 틀린 이유**이고,
다음에 `toHaveBeenCalledTimes` 를 쓰는 사람이 이 패턴을 복제해 "지역 clear 가 필요하다"는 믿음을 이어간다.
그 믿음이 바로 이번 라운드가 고친 것(최상위에서 한 번 리셋)과 반대 방향이다.

**고치는 법.** `:575-577` 과 `:601` 의 `mockClear()` 와 주석을 지우고, `:799` 의 `driveFilesCreate.mockReset()`
도 지운다(`driveFilesDelete` 두 줄은 남긴다 — 최상위는 delete 를 리셋하지 않는다). 지운 뒤 128개와 셔플
시드 두어 개를 다시 돌린다. 머지 전에 꼭 할 일은 아니고, 한다면 이 리뷰 반영 커밋에 같이 넣으면 된다.

### N2 (nitpick, 문서) — `vitest.config.mjs:34` 괄호 "15 before queue.service.spec's own pin was moved here" 는 재실행으로 확인되지 않은 추론이다

**증거.** 16 은 wave11h 리뷰 N2 가 스크래치 설정으로 직접 센 숫자(google-drive 8 / system-config 5 /
album 1 / server 1 / queue 1)이고 나는 오늘 다시 세지 않았다. 괄호의 "15" 는 그 내역에서 queue 1 을 뺀
산술(8+5+1+1)로는 맞지만, `374b3e4f2` 커밋 메시지는 "15 tests across five specs (system-config,
google-drive, album, server, **queue**)" 라고 queue 를 포함해 15 라고 썼다 — 둘 중 하나는 틀렸고, 어느
쪽인지는 `e53a6f528` 시점으로 돌아가 가짜 env 로 돌려야 알 수 있다. [미확인]

**고치는 법.** wave11h N2 가 이미 권한 대로 **숫자를 빼고** "다섯 스펙" 만 남긴다. 숫자는 스펙이 늘 때마다
또 틀어지고, 역사 주석(괄호)은 그 자체로 검증 비용만 만든다. 남기고 싶으면 "wave11h review N2 counted 16"
처럼 **누가 어떻게 센 숫자인지**를 적는다.

### 확인했고 문제 없는 것

- **커밋 메시지의 "every one of five shuffle seeds fails two tests"** 는 시드 1–5 에 대해 사실이다. 내가
  추가로 돌린 시드 11 은 리셋 없이도 통과하는데, 이것은 주장을 약화시키지 않는다 — "순서에 따라 통과한다"는
  진단을 확인하는 사례다. 시드 42 는 다시 2 failed.
- **리셋이 고친 것이 맞다.** 리셋 제거 사본에서 떨어지는 두 테스트는 `:374`·`:401` 의
  `expect(driveFilesCreate).not.toHaveBeenCalled()` 이고, 실패 원인은 파일 다른 곳(`upload verification`
  등)이 쌓아 둔 호출 기록이다. HEAD 에서는 8개 시드 전부 녹색. 다른 변수는 없다 — 그 커밋이 spec 에 한 변경은
  `:237` 한 줄뿐이고 `vitest.config.mjs` 변경은 주석뿐이다.
- **`undefined` 답은 조용히 통과하지 않는다.** 양성 대조군이 보여주듯 `service.ts:1361` 의
  `const { data } = await drive.files.create(...)` 가 `TypeError` 로 터지고 `uploadAsset` 이 **reject** 한다.
  `resolves.toBe('uploaded')` 류 단언은 전부 빨간불이 된다. `rejects.toThrow()` 를 기대하는 테스트
  (`:1326-1331` "missing size as unverifiable")는 이론상 `undefined` 로도 통과할 수 있지만, 그 테스트는 자기
  답(`{ data: { id } }`)을 세우고 센티널 로그에도 없다.

## Answers to what the report asked me to attack

### Q1. 답을 세우지 않고 `files.create` 에 닿아 `undefined` 덕에 통과하는 테스트가 있는가

**없다.** 리셋 직후(최상위 `:237`, `upload verification` `:799` 두 곳)에 테스트 이름을 파일에 적는 센티널
구현을 끼운 사본으로 128개를 전부 돌렸고 로그가 비었다. 테스트가 `mockResolvedValue`/`mockRejectedValue`/
`mockImplementation` 으로 자기 답을 세우면 센티널이 교체되므로, 로그가 비었다는 것은 "`files.create` 에 닿은
모든 테스트가 자기 답을 먼저 세웠다"는 뜻이다. 센티널이 실제로 동작하는지는 `:807` 의 답 한 줄을 지운
대조군으로 확인했다 — 그 테스트 하나가 로그에 찍히고 `TypeError` 로 떨어진다. 요청서가 "I did not audit each
uploading test" 라고 남긴 빈칸은 이것으로 메워진다.

### Q2. 두 테스트의 `not.toHaveBeenCalled()` 가 순서 의존이었고, 리셋이 고친 것이 맞는가. 다른 호이스트 mock 에도 같은 문제가 있는가

**맞다.** 위 Evidence 표 — 리셋 제거 사본은 시드 1–5·42 에서 정확히 그 두 테스트만 떨어지고 시드 11 에서는
통과한다(순서가 운 좋으면 통과한다는 바로 그 성질). HEAD 는 8개 시드 전부 통과.

**다른 호이스트 mock** (`spec:39-66` 의 `vi.hoisted` 블록) 을 하나씩 봤다:

| mock | 리셋/클리어 위치 | 부정·횟수 단언 | 판정 |
|---|---|---|---|
| `driveFilesGet`, `driveAboutGet` | 최상위 `:231-232` | `:2121`, `:2146`, `:2161`, `:2177`, `:2211-2212`, `:2772` | 안전 |
| `oauth2GetAccessToken` | 최상위 `:238-239` + 기본값 | 없음 | 안전 |
| `driveFilesDelete` | `upload verification` `:800-801` 만 | `:821` `not.toHaveBeenCalled()` — 같은 describe 안 | 안전. `files.delete` 는 `service.ts:1421` 크기 불일치 경로에서만 불리고, 그 경로를 타는 테스트는 전부 이 describe 안(`:1177-1194`) |
| `oauth2Constructed` | `getAuthUrl` describe `:253` `mockClear` | `:300` `not.toHaveBeenCalled()` — 같은 describe 안 | 안전 |
| `oauth2SetCredentials` | `:2600` `mockClear` | `:2607` `toHaveBeenCalledWith` (양성) | 안전 — 양성 단언은 누적에 둔감 |
| `oauth2GetToken` | **어디서도 리셋 안 함** | 없음 | 안전. 유일한 standing impl 은 `arrangeLink` (`:188`) 가 세우고, `handleCallback` 테스트(`:2421-`)는 전부 그 헬퍼를 거친다 |

즉 **같은 급의 문제는 남아 있지 않다.** `driveFilesDelete` 와 `oauth2Constructed` 는 "describe 지역 리셋 +
describe 안 부정 단언" 구조라 셔플에도 안전하다(vitest 셔플은 describe 경계를 유지한다 — 8개 시드 결과가
그 증거). 일관성을 위해 `driveFilesDelete` 리셋도 최상위로 올릴 수는 있지만 필요는 없다.

### Q3. `upload verification` describe 의 자체 `driveFilesCreate.mockReset()` — 무해한가, 지울까

무해하다. 지우는 쪽을 권한다 — 단 **이것만 지우면 반쪽**이다. 같은 이유로 중복이 된 lazy-open describe 의
`mockClear()` 두 곳(`:577`, `:601`)과 그 주석(`:575-576`)이 더 오해를 부른다(N1). 셋을 같이 정리하거나,
셋 다 두거나. `:800-801` 의 `driveFilesDelete` 두 줄은 중복이 아니므로 남긴다.

## What I did not verify

- **16 / 15 숫자(F1).** 오늘 가짜 env 로 unpinned 전체 스위트를 다시 돌리지 않았다. 16 은 wave11h 리뷰가
  센 것을 믿었고, "15 before" 괄호는 N2 에 쓴 대로 [미확인].
- **전체 server unit 330 / web 87 / medium 72.** `results/20261002-1627.txt` 의 헤더(커밋·clean 마커 없음)와
  합계를 읽었고 재실행하지 않았다. Drive spec 128 은 셔플 8회로 직접 돌렸다.
- **`verify-task server` exit 0.** 재실행하지 않았다.
- **vitest 셔플이 describe 경계를 유지한다**는 것은 공식 문서를 다시 열지 않고, 8개 시드에서 describe 지역
  리셋에 기대는 단언(`:300`, `:821`)이 한 번도 떨어지지 않은 것으로 간접 확인했다.
- 센티널 사본은 **파일 순서(비셔플)로만** 돌렸다. 셔플에서 결과가 달라질 이유는 없다(답을 세우는 코드는
  각 테스트 본문·beforeEach 안에 있다)지만 돌리지는 않았다.

## Feeding back into the plan

- **호이스트 mock 은 최상위 `beforeEach` 에서 `mockReset()` 한다 — `mockClear()` 가 아니라.** 이유 둘:
  `mockClear` 는 `mockImplementationOnce` 큐를 남기고(wave11h N3), 호출 기록 누적은 부정 단언을 순서
  의존으로 만든다(이번 라운드). 이 파일의 다섯 Drive/OAuth mock 중 `driveFilesCreate` 가 마지막까지 빠져
  있던 이유는 "매 테스트가 답을 세우니 괜찮다"는 추론이었는데, 그 추론은 standing impl 에만 맞고 호출
  기록에는 맞지 않았다.
- **"하지 않는다" 단언이 들어간 스펙은 셔플로 한 번 돌린다** (`--sequence.shuffle --sequence.seed=N`, 시드
  서너 개). 이번에 리셋 없이 시드 11 이 통과한 것이 보여주듯 시드 하나는 증거가 아니다. `dev-test/google-drive/
  run.sh` 에 셔플 1회를 넣을지는 writer 가 판단한다 — 넣는다면 시드를 고정하지 말고 출력에 시드를 남긴다.
- **"답 없이 외부 호출에 닿는 테스트가 있는가"는 센티널 한 줄로 전수 확인할 수 있다.** 리셋 직후
  `mockImplementation(() => { log(currentTestName); return undefined; })` 를 끼우고 로그가 비는지 보는 것.
  양성 대조군(답 한 줄 삭제) 없이는 공허할 수 있으니 짝으로 돌린다.
- `vitest.config.mjs` 주석의 실패 수는 숫자 없이 두는 편이 유지가 싸다 (N2, wave11h N2 재확인).
