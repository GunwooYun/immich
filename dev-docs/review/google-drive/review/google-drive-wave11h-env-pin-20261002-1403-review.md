# Code Review — wave11h: wave11g 리뷰 반영분 (env pin, 대기 테스트)

| | |
|---|---|
| Branch / HEAD | `wave11g-isolated-review-fixes` / `c192fb5a3` (작업 트리 clean) |
| Commits reviewed | `612320b17..HEAD` (2 commits: 코드+문서 `374b3e4f2`, 요청서 `c192fb5a3`) |
| Report | ../report/google-drive-wave11h-env-pin-20261002-1355-report.md |
| Reviewed | 2026-10-02 |

## Verdict

**NOT BLOCKED.** 네 가지 반영(M1 env pin, N1 대기 단언, N3 §7 포인터, N4 주석)이 모두 요청서와 커밋
메시지가 말하는 대로 되어 있고, 핵심 주장인 "`test.env` 가 셸 export 를 덮는다"는 vitest 3.2.7 의 실제
워커 코드(`setup-common.Dd054P77.js:39` 의 단순 대입 `process.env[key] = env[key]`)와 공식 문서, 그리고
내가 직접 돌린 양방향 실험(가짜 env + pin → 2457 통과, pin 을 가짜 값으로 덮은 스크래치 설정 → 정확히
16 실패)으로 확인된다. 가장 중요한 문제는 **요청서 Q3 의 전제가 틀렸다**는 것이다 — medium 스위트에
Drive 설정을 읽는 스펙이 하나 있다(`test/medium/specs/workflow/workflow-core-plugin.spec.ts:42-50`,
`isGoogleDriveEnabled -> getConfig` 경로를 자기 주석으로 명시). 다만 그 스펙은 기본값이 꺼져 있는 데
기대지 않도록 이미 설계되어 있고(`GoogleDriveRepository` 를 real 로 둔 이유), 가짜 env 를 export 한
채 돌려 19/19 녹색을 확인했으므로 **결론(medium 에 pin 불필요)은 유지된다**. 전제를 바로잡은 문장으로
남겨야 다음 사람이 같은 grep 을 다시 하지 않는다.

### Evidence I ran myself

메인 트리는 읽기 전용으로 두었다. "pin 제거" 변이는 소스를 건드리지 않고 스크래치 디렉토리의 설정
파일(`test.env` 를 가짜 값으로 덮는 `vitest.unpinned.config.mjs`)로 재현했다 — 셸 export 가 워커에
그대로 도달하는 상황과 등가다. `openAndWait` "never waits" 변이는 재실행하지 않고 코드로 추적했다(Q4 뒤
N1 절).

| Check | Result |
|---|---|
| `git log --oneline 612320b17..HEAD` | 2 commits. `374b3e4f2` 는 `CLAUDE.md` +2/−1, 세 spec, `vitest.config.mjs` +9, wave11g 리뷰 파일; `c192fb5a3` 는 요청서 + `results/20261002-1353.txt` 만 |
| `git show 374b3e4f2` vs 요청서 표 | 5 개 파일 변경 내용 일치 |
| `dev-test/google-drive/results/20261002-1353.txt` | 헤더 `commit: 374b3e4f2 (wave11g-isolated-review-fixes)` 에 `+ UNCOMMITTED CHANGES` 마커 없음(`run.sh:127-129` 가 더러우면 찍는다) → "clean tree" 주장 성립. server 330/330 (8 files), web 87/87, medium 72/72, `RESULT: PASS` |
| 전체 server unit, `IMMICH_GOOGLE_DRIVE_{CLIENT_ID,CLIENT_SECRET,API_KEY}=fake`, `_REDIRECT_URL=https://example.test/cb` export, pin 그대로 | **94 files, 2457 passed / 2 skipped**, exit 0 — 요청서 표 1행과 일치 |
| 같은 전체 스위트, 스크래치 설정으로 pin 을 가짜 값으로 덮음 | **16 failed / 2441 passed** in 5 files: `google-drive` 8, `system-config` 5, `album` 1, `server` 1, `queue` 1 — 요청서 표 2행 "16 failed" 와 일치 |
| medium `workflow-core-plugin.spec.ts` + `google-drive.repository.spec.ts`, 같은 가짜 env export (medium 설정은 pin 없음) | **91 passed** (19 + 72) |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx eslint` 바뀐 spec 3 개 `--max-warnings 0` | exit 0 |
| `npx prettier --check test/vitest.config.mjs` | 통과 |
| `.claude/scripts/verify-task server` | exit 0 |
| vitest `test.env` 적용 지점 | `node_modules/vitest/dist/chunks/setup-common.Dd054P77.js:22-40`, `runBaseTests.9Ij9_de-.js:35-40` (아래 Q1) |
| vitest 공식 문서 `/config/env` | "available on `process.env` and `import.meta.env` during tests. These variables will not be available in the main process (in `globalSetup`, for example)." |
| `git status --porcelain` (리뷰 작성 후) | 이 리뷰 파일 하나만 `??` |

## Findings

### N1 (nitpick, 문서 정확성) — "medium 스펙은 Drive 설정을 읽지 않는다"는 전제가 틀렸다; 결론은 맞다

**증거.** 요청서 Q3 와 커밋 메시지는 "its specs exercise repositories against Postgres and do not read the
Drive config" 라고 쓴다. medium `include` 는 `test/medium/**/*.spec.ts` (`vitest.config.medium.mjs:14`)
이고 거기에는 `services/` 19 개와 `workflow/` 1 개가 들어 있다. 그중
`test/medium/specs/workflow/workflow-core-plugin.spec.ts:42-50` 은 자기 주석으로 이렇게 말한다:

```
// Fork-only: adding an asset to an album now asks whether Google Drive backup is enabled
// (AlbumService#queueGoogleDriveUploadsForAlbums -> isGoogleDriveEnabled -> getConfig), and
// that read needs the system metadata table. ...
// Same reason one step further: with the feature switched on, the same path reaches
// GoogleDriveRepository. Present so these tests do not depend on the default config
// staying off to survive.
```

즉 **읽는다**. 그리고 medium 설정에는 pin 이 없으므로 셸의 `IMMICH_GOOGLE_DRIVE_*` 가 `config.ts:359-367`
defaults 로 그대로 들어가 이 경로가 켜진다. 다행히 이 스펙은 바로 그 경우를 위해 `GoogleDriveRepository`
를 real 로 두었고, 가짜 env 를 export 한 채 돌려 19/19 녹색을 확인했다. `user.service.spec.ts:138,174` 도
`getConfig`/`updateConfig` 를 부르지만 `user.deleteDelay` 만 단언한다.

**고치는 법.** pin 을 medium 에 추가할 필요는 없다(실험으로 확인). 다만 `vitest.config.mjs:30-34` 주석이나
다음 요청서에 전제를 바로잡아 둔다 — "medium 에는 Drive 설정을 읽는 스펙이 하나 있지만(workflow-core-
plugin) 기본값에 기대지 않도록 짜여 있어 pin 이 없어도 된다". 지금 문장대로면 다음 사람이 medium 에
Drive 경로를 타는 서비스 스펙을 추가할 때 "읽지 않는다"는 말을 믿고 기본값 off 를 전제로 쓸 수 있다.

### N2 (nitpick) — `vitest.config.mjs:33` 주석의 "15 tests across five specs" 는 16 이다

**증거.** 스크래치 설정으로 pin 을 무력화한 전체 스위트는 **16 failed** 이고, 요청서 표 2행과 커밋
메시지 끝("with the config pin removed: 16 failed")도 16 이다. 주석(`vitest.config.mjs:33`)과 커밋
메시지 앞부분만 15 다. 파일별 내역: `google-drive.service.spec.ts` 8 (uploadAsset disabled / retryFailures ·
resumeUploads disabled / getStatus 3 — `failedCount` 가 달라짐 / handleGoogleDriveUploadQueueAll off /
onGoogleDriveLoginGrant not configured), `system-config` 5, `album` 1, `server` 1, `queue` 1.

**고치는 법.** 주석을 16 으로 맞추거나, 숫자를 빼고 "다섯 스펙" 만 남긴다. 숫자는 스펙이 늘면 또
틀어지므로 후자가 낫다.

### N3 (nitpick, 요청서 Q4) — N1 테스트가 `files.create` 전에 실패하면 once-impl 이 큐에 남는다; 영향은 사실상 없다

**증거.** `@vitest/spy@3.2.7/dist/index.js:104-114`: `mockClear()` 는 호출 기록만 지우고,
`onceImplementations = []` 는 `mockReset()` (111-114) 에서만 일어난다. 파일 최상위 `beforeEach`
(`google-drive.service.spec.ts:224-235`) 는 `driveFilesGet`·`driveAboutGet`·`oauth2GetAccessToken` 만
`mockReset()` 하고 **`driveFilesCreate` 는 하지 않는다** (`:794` 의 다른 describe 에서만 리셋). 따라서
N1 테스트(`:587-616`)가 `files.create` 에 닿기 전에 죽으면 — 예컨대 `openAndWait` 가 reject 해서
`uploadAsset` 이 `'uploaded'` 가 아닌 값을 돌려주는 바로 그 회귀 — `:602` 의 once-impl 이 소비되지
않은 채 남고, 같은 파일의 다음 `files.create` 호출(`:614` 테스트)이 그것을 먼저 먹는다.

왜 사실상 무해한가: 그 once-impl 이 돌려주는 값은 `{ data: { id: 'drive-file-id', size: '1024' } }` 로,
파일 전체가 `mockResolvedValue` 로 세우는 정상 응답과 **동일**하다. 부작용은 죽은 클로저의
`pendingWhenHandedOver` 대입뿐이다. 유일한 가시적 결과는 "N1 이 이미 빨간 상태"에서 바로 다음 create
호출 하나가 거부(`mockRejectedValue`)를 기대할 때 성공을 받는 것인데, `:614` 테스트는 거부를 기대하지
않는다.

**고치는 법 (선택).** 최상위 `beforeEach` 에 `driveFilesCreate.mockReset()` 을 추가하면 `:794` 와
일관되고 이 누수가 구조적으로 사라진다. 단 **이전 테스트가 세운 standing impl 에 우연히 기대는 테스트가
드러날 수 있으니** 추가 후 128 개를 다시 돌려 확인해야 한다(파일 전체에 `mockClear()` 만 하고
`mockResolvedValue` 를 세우지 않는 테스트가 있으면 그것이 그 커플링이다). 지금 단계에서 반드시 할 일은
아니다.

### 확인했고 문제 없는 것

- **N1 대기 단언은 비공허하다.** `openAndWait` (`google-drive.service.ts:1635-1653`) 는 `stream.pending
  === true` 일 때만 `'ready'` 를 기다린다. 테스트의 `fakeStream()` (`spec:31`, `EventEmitter` +
  `destroy`) 에 `pending: true` 를 얹고 `setImmediate` 로 `pending = false; emit('ready')` 를 예약한다.
  대기를 제거하면 `createReadStream` mock 의 `Promise.resolve` → 마이크로태스크 → `uploadAsset` 본문
  (`service.ts:1284` 의 `await openOriginal` 뒤 `files.create` 까지 매크로태스크 경계가 없다 — 사이의
  `await` 는 catch 경로의 `upsertError` 뿐이고 `armStallTimer` 의 `setTimeout` 은 막지 않는다) 에서
  `setImmediate` 가 돌기 전에 `files.create` 가 불리므로 `pendingWhenHandedOver === true` → `:608`
  `toBe(false)` 가 빨간불. 요청서 표 3행("both lazy-open tests red")과 부합한다.
- **N3 (`CLAUDE.md:580-581`)** 가 가리키는 §1 세 번째 불릿은 실제로 "운영 서버에서 상태를 바꾸는 명령은
  Claude 가 실행하지 않는다 — 사용자가 실행한다" 이다. 포인터가 맞는 곳을 가리킨다.
- **N4 (`server.service.spec.ts:145-148`)** "complete OAuth client and a redirect URL" 은
  `misc.ts:151-152` 의 `isGoogleDriveEnabled` (`clientId && clientSecret && getGoogleDriveRedirectUrl`)
  와 정확히 대응한다. `apiKey` 는 조건이 아니므로 주석이 언급하지 않는 것도 맞다.
- **`queue.service.spec.ts:36-38`** 주석은 `test/vitest.config.mjs` 를 가리키고, 그 테스트는 가짜 env +
  pin 에서 통과하고 pin 무력화에서 실패한다(`:41`). per-test pin 제거가 안전하다는 것을 양방향으로
  확인했다.

## Answers to what the report asked me to attack

### Q1. `test.env` 가 부모 셸이 이미 export 한 값을 덮는가? collection 시점 import 가 셸 값을 볼 수 있는가?

**덮는다. 못 본다.** 세 층으로 확인했다.

1. **워커 코드.** `vitest/dist/chunks/setup-common.Dd054P77.js:33-40` `setupEnv`:
   `for (const key in restEnvs) process.env[key] = env[key];` — `??=` 가 아닌 **단순 대입**이라 상속받은
   셸 값을 덮는다. 이것은 `setupCommonEnv` (`:22-29`) 의 **첫 줄 다음**에, `globalSetup` 가드 **앞**에
   있어 `run()` 호출마다 다시 적용된다. `runBaseTests.9Ij9_de-.js:35-40` 의 `run(method, files, config,
   environment, executor)` 는 `await setupGlobalEnv(config, …)` 를 먼저 하고 그 다음에 파일을 돌린다 —
   spec 파일과 그것이 끌어오는 `config.ts` 의 import(= collection) 는 모두 그 뒤다. 그러므로 "collection
   시점에 셸 값을 본다"는 경로가 없다.
   참고로 `cli-api.DVe0nWUx.js:10159` 에는 `process.env[name] ??= envs[name]` (덮지 않음) 이 있지만 이것은
   **메인 프로세스**에서 Vite 의 `import.meta.env` (`VITE_*`) 를 올리는 코드이고 `test.env` 와 무관하다.
   문서가 "main process (globalSetup) 에서는 쓸 수 없다"고 하는 것과 같은 얘기다 — 바꿔 말하면 **medium 의
   `globalSetup.ts` 에는 pin 이 닿지 않는다**(지금은 Drive 설정을 읽지 않으므로 상관없다).
2. **문서.** vitest `/config/env`: `Partial<NodeJS.ProcessEnv>`, "available on `process.env` and
   `import.meta.env` during tests. These variables will not be available in the main process (in
   `globalSetup`, for example)."
3. **실험.** 가짜 env 4 개를 export 한 채 전체 스위트 2457 통과(위 표). 같은 export 아래 pin 만 가짜
   값으로 바꾼 스크래치 설정에서 16 실패. 두 결과의 차이가 pin 하나뿐이므로 pin 이 셸 값을 이긴다.

부수 확인: `config.spec.ts:54-56,79` 의 `vi.stubEnv(name, undefined)` 는 `delete process.env[name]`
(`vi.bdSIJ99Y.js:3959`) 이고 `unstubAllEnvs` 는 첫 stub 때 저장한 원값 `''` 로 되돌린다(`:3957,3973-3974`).
`config.ts` 의 `|| ''` 가 `undefined` 와 `''` 를 같게 보므로 pin 과 stubEnv 가 서로 간섭하지 않는다 —
`config.spec.ts` 5/5 가 가짜 env 실행에서도 통과한 것이 그 증거다.

### Q2. `''` 로 박아서 어떤 스펙이 봐야 할 것을 가리는가?

**없다.** `grep IMMICH_GOOGLE_DRIVE server/src server/test` 에서 env 를 읽는 테스트 코드는
`config.spec.ts` 뿐이고, 그 파일은 전부 `vi.stubEnv` 로 자기 값을 세운 뒤 `vi.resetModules()` 로
`config.ts` 를 다시 평가한다(`:20-27`) — 셸 값이 아니라 stub 값을 본다. `google-drive.service.spec.ts:
292-293` 의 `IMMICH_GOOGLE_DRIVE_REDIRECT_URL` 은 에러 메시지 문자열 매칭이지 env 읽기가 아니다.
반대 방향(기능이 켜져 있어야 하는 스펙)은 전부 `systemMetadata.get` mock 으로 켠다 — pin 이 '꺼짐' 을
강제하는 것이 아니라 '기본값' 을 고정하는 것이므로 가리는 것이 없다.

### Q3. medium 설정에 pin 을 안 둔 것 — medium 의 모든 스펙에 대해 참인가?

**"읽지 않는다"는 거짓, "pin 이 필요 없다"는 참.** N1 참조. medium 56 개 스펙 중 Drive 설정에 닿는 것은
`workflow/workflow-core-plugin.spec.ts` 하나이고(`services/user.service.spec.ts` 는 `getConfig` 를
부르지만 Drive 필드를 보지 않는다), 그 스펙은 켜진 경우까지 real 리포지토리로 받도록 짜여 있어 가짜 env
아래 19/19 녹색이다. `google-drive.repository.spec.ts` 72/72 도 같은 env 에서 녹색. 나머지 54 개는 돌리지
않았다(아래 "확인하지 않은 것").

### Q4. `mockImplementationOnce` — 테스트가 소비 전에 실패하면 누수가 있는가?

**있다, 그러나 값이 같아 관측되지 않는다.** N3 참조. `mockClear()` 는 once 큐를 비우지 않고
(`@vitest/spy:104-110`), 최상위 `beforeEach` 는 `driveFilesCreate` 를 리셋하지 않는다(`spec:231-233`).
남은 once-impl 은 다음 create 호출에서 파일 공통의 정상 응답과 동일한 값을 돌려주고 끝난다. 구조적으로
막고 싶으면 최상위 `beforeEach` 에 `driveFilesCreate.mockReset()` — 단 숨은 커플링이 드러날 수 있으니
재실행 필수.

## What I did not verify

- **`openAndWait` "never waits" 변이를 재실행하지 않았다.** 소스를 건드려야 해서 이 세션의 계약
  밖이다. 대신 `service.ts:1284`→`files.create` 사이의 태스크 경계를 추적해 어느 단언이 왜 빨간불이
  되는지 코드로 확인했다(위 "확인했고 문제 없는 것" 첫 항목). 요청서의 "byte-compared" 되돌림도 작성자
  측 절차라 확인 수단이 없다.
- **medium 56 개 중 2 개만 가짜 env 로 돌렸다** (Drive 경로가 있는 workflow 스펙과 Drive 리포지토리
  스펙). 나머지 54 개는 grep 으로 Drive 설정에 닿지 않음을 확인했을 뿐 실행하지 않았다. `grep
  "googleDrive|isGoogleDriveEnabled|systemMetadata|getConfig"` 가 그 두 파일 외에 `user.service.spec.ts`
  만 잡았고, 그 파일의 두 호출은 `user.deleteDelay` 만 다룬다.
- **web 스위트는 돌리지 않았다.** 이 라운드에 web 변경이 없고, 결과 파일의 87/87 을 재실행으로
  확인하지는 않았다.
- **`verify-task server` 가 내부적으로 무엇을 어디까지 돌렸는지** 출력 전체를 읽지 않고 exit 0 만
  확인했다. 스크립트 헤더(`.claude/scripts/verify-task:1-15`) 는 prettier · eslint · tsc · vitest unit
  이라고 말한다.
- 요청서가 가짜 env 로 **네 변수 모두** export 했는지는 요청서 본문("Fake env values were placeholders")
  으로만 안다. 나는 네 개 모두 export 했고, 이전 라운드(wave11g 리뷰)는 세 개만 export 해서 12 실패를
  봤다 — `google-drive.service.spec.ts` 의 `getStatus` 3 개가 차이의 일부일 수 있으나 원인을 추적하지
  않았다. 이 라운드의 판정에는 영향이 없다(pin 이 네 개 다 덮는다).

## Feeding back into the plan

- **medium 스위트의 Drive 설정 노출 지점은 `workflow-core-plugin.spec.ts` 하나이고, 기본값에 기대지 않게
  설계되어 있다.** medium 에 pin 을 두지 않는 근거는 "읽지 않아서"가 아니라 "읽어도 켜진 경우를
  real 리포지토리로 받아서"다. medium 에 `AlbumService` 류 서비스 스펙을 추가할 때 이 조건을 지키거나
  그때 medium 설정에도 같은 pin 을 넣는다. 또한 `test.env` 는 `globalSetup` 에 닿지 않으므로
  `globalSetup.ts` 가 Drive 설정을 읽게 되면 pin 으로는 못 막는다.
- **vitest `test.env` 는 워커에서 단순 대입이라 셸 export 를 이긴다** (`setup-common.*.js:39`, 3.2.7
  기준). 이 사실을 `dev-test/google-drive/README.md` 또는 계획 문서에 한 줄 남기면 다음 "env 가 테스트를
  켠다" 류 F1 이 재발해도 바로 같은 자리로 간다.
- `google-drive.service.spec.ts` 최상위 `beforeEach` 는 `driveFilesCreate` 를 리셋하지 않는다. once-impl
  누수(N3)와 call-count 누적 모두 여기서 온다. 다음에 이 파일을 크게 손댈 때 `mockReset()` 을 올리고
  숨은 커플링을 한 번 털어낸다.
