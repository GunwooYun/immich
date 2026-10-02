# Code Review — wave11g: isolated review (F1~F3) 반영분

| | |
|---|---|
| Branch / HEAD | `wave11g-isolated-review-fixes` / `612320b17` (작업 트리 clean) |
| Commits reviewed | `3f36c0d0b..612320b17` (3 commits: 문서 `bde60a1d5`, 코드 `e53a6f528`, 요청서+증거 `612320b17`) |
| Report | ../report/google-drive-wave11g-isolated-fixes-20261002-1340-report.md |
| Reviewed | 2026-10-02 |

## Verdict

**NOT BLOCKED.** 코드 변경(`e53a6f528`)은 세 가지 모두 주장대로 동작한다. F2 의 `openAndWait`
(`google-drive.service.ts:1635-1653`)는 Node 24.15.0 의 실제 `fs.ReadStream` 에 대해 스크래치 프로브로
확인했다 — `pending` 은 생성 시 `true`, `'ready'` 직전에 `fd` 가 먼저 세팅되어 `false` 가 되고, 20 번의
마이크로태스크 뒤에도 `'ready'` 는 아직 오지 않으며(리스너가 늦을 수 없다), 매크로태스크가 끼어 `'ready'` 를
놓쳤더라도 `pending === false` 라 건너뛴다. ENOENT 는 `'error'` 로만 오고 `'ready'` 는 오지 않으며, 열기 전
`destroy()` 조차 Node 24 에서는 `'ready'` 를 낸다 — 즉 **실 fs 스트림으로는 매달릴 경로가 없다.** R3 리스너와의
창(Q2)도 없다: `'ready'` 와 `service.ts:1355` 사이는 마이크로태스크뿐이고, 소비 전에는 읽기가 시작되지 않는다
(프로브: `'ready'` 50ms 후 버퍼 0 / `readableFlowing === null`). F3 주석은 세 쿼리 본문과 대조해 맞다.

가장 중요한 문제는 **F1 의 모양(요청서 Q4)** 이다. 큐 테스트에 핀을 박은 것은 맞지만, 같은 원인
(`config.ts:359-367` 이 모듈 로드 시 `process.env` 를 defaults 로 읽음)에 걸린 테스트가 **4 개 파일 12 개**
더 있다 — 가짜 `IMMICH_GOOGLE_DRIVE_*` 를 export 하고 전체 스위트를 돌리면 `system-config` 5, `google-drive` 5,
`album` 1, `server` 1 이 빨간불이다. 요청서의 "F1 pin kept, same fake env → all 20 queue tests pass" 는 참이지만
큐 스펙 하나만 본 결과다. 바른 모양은 `server/test/vitest.config.mjs` 의 `test.env` (이미 `TZ: 'UTC'` 를 같은
방식으로 박고 있다)에 네 변수를 `''` 로 두는 것이고, 스크래치 설정으로 실제로 확인했다 — 같은 가짜 env 아래
5 개 파일 266/266 녹색. 배포를 막지는 않는다(이 저장소의 어떤 환경도 그 변수를 export 하지 않는다는 요청서의
말을 반박할 근거가 없다).

### Evidence I ran myself

메인 트리에서는 읽기 전용 명령만 돌렸다. 변이(mutation)는 재실행하지 않았다 — 소스를 건드려야 해서 이 세션의
계약 밖이다. 대신 각 변이에서 어느 단언이 왜 빨간불이 되는지 코드로 추적했다(아래 Q3).

| Check | Result |
|---|---|
| `git log --oneline 3f36c0d0b..HEAD` | 3 commits; `612320b17` 은 요청서 + `results/20261002-1334.txt` 만 (+240) |
| `git show e53a6f528 --stat` | `repository.ts` +16/−4(주석), `service.spec.ts` +60, `service.ts` +43/−6, `queue.service.spec.ts` +5 — 요청서 표와 일치 |
| `dev-test/google-drive/results/20261002-1334.txt` | 헤더 `commit: e53a6f528`, server 330/330 (8 files, `google-drive.service.spec.ts` 128), web 87/87, medium 72/72, `RESULT: PASS` — 리포트 표와 일치 |
| `npx vitest run --config test/vitest.config.mjs src/services/google-drive.service.spec.ts src/services/queue.service.spec.ts` | **148 passed** (128 + 20) |
| 전체 server unit (env 없음) | **94 files, 2457 passed / 2 skipped**, exit 0 |
| 전체 server unit, `IMMICH_GOOGLE_DRIVE_CLIENT_ID=fake …_CLIENT_SECRET=fake …_REDIRECT_URL=https://example.test/cb` export | **12 failed** in 4 files (아래 M1). 큐 스펙 20/20 은 녹색 — F1 핀은 자기 테스트에는 효과가 있다 |
| 스크래치 `vitest.pin.config.mjs` (`mergeConfig(base, { test: { env: { IMMICH_GOOGLE_DRIVE_*: '' } } })`), 같은 가짜 env export, 영향받은 5 개 파일 | **266 passed** — `test.env` 가 셸 env 를 덮는다 |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx eslint <바뀐 4 파일> --max-warnings 0` | exit 0 |
| Node `fs.ReadStream` 프로브 (`node v24.15.0`, 스크래치 디렉토리, 8 케이스) | 아래 Q1/Q2 에 결과 인용 |
| `git status --porcelain` (리뷰 작성 후) | 이 리뷰 파일 하나만 `??` |

## Findings

### M1 (medium) — F1 핀은 같은 병의 13 개 중 1 개만 고친다; 바른 자리는 `test/vitest.config.mjs`

**증거.** 가짜 env 를 export 한 전체 스위트:

```
system-config.service.spec.ts  5 failed  (should merge the overrides / …googleDrive.enabled left over… /
                                          load from json / load from yaml / update the config and emit an event)
google-drive.service.spec.ts   5 failed  (uploadAsset > should skip when the feature is disabled /
                                          retryFailures·resumeUploads > should reject when the feature is disabled /
                                          handleGoogleDriveUploadQueueAll > should not touch the stream when the feature is off /
                                          onGoogleDriveLoginGrant > should do nothing at all when the feature is not configured)
album.service.spec.ts          1 failed  (addAssets > should not touch the ledger at all when Google Drive is disabled)
server.service.spec.ts         1 failed  (getFeatures > should respond the server features — :147 `googleDrive: false`)
```

전부 "기능이 꺼져 있다"를 전제로 하는 테스트다. `newSystemMetadataRepositoryMock` (`test/repositories/
system-metadata.repository.mock.ts:9`) 의 `get` 은 `vitest.fn()` 이라 `undefined` 를 돌려주고, `buildConfig`
(`utils/config.ts:86-89`) 는 그 위에 아무것도 덮지 않으므로 config 는 곧 `defaults` = 셸 env 다. 큐 테스트에
박은 핀(`queue.service.spec.ts:39`)은 그 테스트의 `systemMetadata.get` 만 바꾼다.

이 포크의 §4 지뢰 "기능이 꺼져 있어 공허하게 통과"의 거울상이기도 하다 — 여기서는 **env 때문에 기능이 켜져서**
"안 한다" 단언이 깨진다. 방향은 반대지만 원인은 같다: 기본 설정이 테스트 바깥에서 온다.

**고치는 법 (확인함).** `server/test/vitest.config.mjs:29-31` 의 `env` 블록에 네 변수를 `''` 로 추가한다.
스크래치 설정으로 같은 가짜 env 아래 5 개 파일 266/266 을 확인했다 — vitest 의 `test.env` 는 워커의
`process.env` 에 대입하므로 셸 export 를 이긴다. `config.ts` 는 워커 안에서 로드되므로 순서 문제가 없다.

```js
env: {
  TZ: 'UTC',
  // Fork: Google Drive defaults are read from process.env at module load (config.ts). Pin them off so
  // every "feature disabled" assertion means what it says regardless of who runs the suite.
  IMMICH_GOOGLE_DRIVE_CLIENT_ID: '',
  IMMICH_GOOGLE_DRIVE_CLIENT_SECRET: '',
  IMMICH_GOOGLE_DRIVE_API_KEY: '',
  IMMICH_GOOGLE_DRIVE_REDIRECT_URL: '',
},
```

큐 스펙의 핀은 그대로 둬도 해롭지 않지만, 주석의 "without this the exact list below would gain the Drive
backfill" 은 config 핀이 들어가면 거짓이 된다 — 둘 중 하나를 고른다(핀을 빼고 config 로 일원화하는 쪽이
다음 사람에게 덜 헷갈린다). `newTestService` 의 mock 기본값에 넣는 대안은 `system-config` 의 5 개
(defaults 자체를 비교한다)를 못 고치므로 **config 가 유일하게 13 개를 다 덮는 자리**다.

**medium 인 이유.** 배포에는 영향이 없고 CI 도 env 를 export 하지 않는다. 그러나 요청서가 "F1 fix against a
deliberately polluted env" 를 *검증했다* 고 적었고, 그 검증은 스위트의 1/13 만 본 것이다 — 검증 범위를 넘는
주장이 리뷰어에게 넘어왔다는 점이 severity 를 올린다.

### N1 (low) — "should wait for a pending stream to open" 은 기다림을 검증하지 않는다

`service.spec.ts:584-605`. 단언은 (a) `createReadStream` 1 회, (b) `media.body === opening`, (c) 남은 리스너
수 뿐이다. 요청서의 변이 1(`pending === true && false`, 즉 **기다리지 않음**) 아래서 이 테스트는 그대로 녹색이다
— 스트림을 그대로 넘기면 (a)(b) 는 당연히 참이고, 리스너를 아예 안 붙이니 (c) 도 참. 요청서의 변이 표도 그렇게
말한다(변이 1 → 빨간불은 ENOENT 테스트 *하나*). 테스트 이름이 약속하는 "기다린다" 는 첫 테스트가 간접적으로만
덮는다.

**고치는 법.** `driveFilesCreate` 를 `mockImplementation` 으로 바꿔 호출 시점의 `opening.pending` 을 기록하고
`false` 였음을 단언한다 — 변이 1 에서는 `setImmediate` 가 돌기 전에 create 가 불리므로 `true` 로 잡힌다.

```ts
let pendingAtCreate: boolean | undefined;
driveFilesCreate.mockImplementation(async () => {
  pendingAtCreate = opening.pending;
  return { data: { id: 'drive-file-id', size: '1024' } };
});
…
expect(pendingAtCreate).toBe(false);
```

### N2 (nit) — `pending === true` 인데 어느 이벤트도 안 오면 영원히 기다린다 (실 fs 로는 도달 불가)

`service.ts:1637-1651` 은 `'ready'`/`'error'` 만 듣는다. Node 24 프로브에서는 열기 전 `destroy()` 도 `'ready'`
를 내고(아래 Q1 6번), ENOENT 는 `'error'` 를 내므로 **실 `fs.ReadStream` 으로 매달리는 경로를 찾지 못했다.**
도달 가능한 건 테스트 스탠드인뿐이다 — `Object.assign(fakeStream(), { pending: true })` 를 만들고 이벤트를 안
내면 그 테스트는 timeout 으로 죽는다(명확한 실패이지 조용한 통과는 아니다). 요청서 Q1 이 걱정한 "스톨 워치독이
덮지 않는다" 는 맞다(타이머는 `:1341` 에서 `openOriginal` 뒤에 arm). 고치려면 `'close'` 도 듣고 reject 하면
되지만, 도달 불가한 경로에 코드를 보태는 것이라 **권하지 않는다** — 주석에 "실 스트림은 둘 중 하나를 반드시
낸다(Node 24 확인)" 한 줄이면 충분하다.

### N3 (nit) — 문서 커밋 `bde60a1d5` 의 남은 교차 참조

- `CLAUDE.md:580` `그때가 §1의 "운영 데이터에 손대기 전에 확인" 순간이다` — §1 의 그 문장은 이 커밋에서 사라졌다.
  새 규칙대로면 "그때가 §1 대로 사용자에게 명령을 넘기는 순간이다" 가 맞다.
- 범위 밖이지만 같은 규칙: `.claude/rules/security.md` 「운영 데이터」와 체크리스트 마지막 줄은 여전히
  "쓰기 전에는 백업 + 사용자 확인" 이다. `.claude/` 는 추적되지 않으므로 이 브랜치의 일은 아니지만, 세션마다
  로드되는 파일이 §1 과 어긋난 채로 남는다.
- 그 외 §7 배포 절차·게이트 쿼리·"설정 화면을 한 번 연다" 는 이미 사용자 행동이거나 읽기 조회라 새 규칙과
  충돌하지 않는다. `docker build` 를 Claude 몫으로 남긴 예외는 §1 본문에는 없고 §7 에만 있다 — §1 이 "운영
  서버(랩탑)에서" 로 한정하고 있으니 모순은 아니다.

### N4 (nit, 범위 밖) — `server.service.spec.ts:145-146`

`// Off by default: the feature needs both an explicit opt-in and a complete OAuth client` — `enabled`
플래그는 wave8 에서 폐지됐다. M1 을 고치러 그 파일을 열 때 같이 지우면 된다.

## Answers to what the report asked me to attack

### 1. `openAndWait` correctness — `pending` 신뢰성, `'ready'` 선행 가능성, 매달림

Node v24.15.0, 스크래치 디렉토리에서 실 파일로 돌린 8 케이스:

| # | 케이스 | 결과 |
|---|---|---|
| 1 | 생성 직후 / `'ready'` 후 | `pending true, fd null` → `pending false`, `fd !== null` (fd 가 `'ready'` emit **전에** 세팅됨) |
| 1' | `'ready'` 50ms 뒤 소비 없이 | 버퍼 0 바이트, `readableFlowing === null`, destroyed false — **소비 전 읽기 없음** |
| 2 | 생성 후 `await Promise.resolve()` ×20, 그 다음 리스너 부착 | 여전히 `pending true`, 이후 `'ready'` 수신 — 마이크로태스크로는 놓칠 수 없다 |
| 3 | 생성 후 `setImmediate` + 20ms, 그 다음 검사 | `'ready'` 이미 발생, `pending false` — 놓쳐도 건너뛰기 경로로 간다 |
| 4 | 없는 경로 | `'error' ENOENT`, `pending true` 유지, `'ready'` 없음, destroyed true |
| 5 | 생성 직후 동기 `renameSync` (요청서의 microsecond window 재현) | `'error' ENOENT` — F2 가 겨냥한 사건이 실제로 `'error'` 이벤트로 온다 |
| 6 | 열기 전 `destroy()` | **`'ready'` 가 그래도 발생**하고 `'close'` — 매달리지 않는다 |
| 7 | `once` + `off` 패턴 (코드와 동일) | `'ready'` 후 리스너 ready 0 / error 0 |
| 8 | `'ready'` 후 `unlinkSync`, 그 다음 소비 | 4096 바이트 정상 읽힘 — 열린 뒤의 이동은 업로드에 무해 |

`storage.repository.ts:122-130` 은 `await fs.stat` → `await fs.access` → **동기** `createReadStream` → return 이다.
반환 후 `openAndWait` 의 `await` 재개까지는 마이크로태스크뿐이고(2 번), 열기 콜백은 libuv poll 단계라
리스너가 항상 먼저다. 혹시 매크로태스크가 끼더라도 3 번 경로로 안전하다. `'error'` 가 리스너보다 먼저 오는 경우는
리스너 없는 `'error'` 라 **매달림이 아니라 프로세스 크래시**인데, 같은 이유로 도달 불가다.

`pending` getter 는 Node 11.2 부터 있고(`fd === null`), 이 저장소는 `.nvmrc`/`mise.toml` 로 24.15.0 을
고정한다. 요청서가 "not verified" 로 적은 두 항목(실 스트림의 이동 창, `pending` 존재) 모두 위로 닫힌다.

### 2. R3 리스너와의 창

없다. `'ready'` 핸들러 안에서 `resolve()` → `openAndWait` 재개 → `openOriginal` 의 `return await` 재개 →
`uploadAsset :1284` 재개 → `:1309-1354` 동기 → `:1355 stream.on('error')`. 전부 마이크로태스크다.
그 사이에 `'error'` 가 나오려면 읽기가 시작돼야 하는데 1' 번 프로브대로 소비 전에는 `_read` 가 불리지 않고,
fs 오류는 어차피 스레드풀 → 이벤트루프(매크로태스크)로 온다. 요청서의 추론("reading does not start until
googleapis pipes")은 맞고, 이제 측정값이 있다.

첫 시도가 ENOENT 로 reject 된 뒤 `findMovedOriginal` (DB await, 매크로태스크) 동안 첫 스트림에 리스너가
없는 것도 안전하다 — 4 번 프로브대로 그 스트림은 destroyed 이고 두 번째 `'error'` 는 없다.

### 3. 테스트의 비공허성과 `mockClear` 누수

**ENOENT 테스트 (`:548-582`)** 는 이유까지 증명한다. 변이 1(기다리지 않음)에서는 `notYetOpen` 이 그대로 create 로
가고 mock 이 즉시 resolve 하므로 결과는 `'uploaded'` 인 채 `toHaveBeenLastCalledWith(movedPath)` 와
`.not.toBe(notYetOpen)` 이 깨진다. ENOENT 가 아닌 코드로 reject 되면 `isFileMissing` (`utils/google-drive.ts:18-19`)
이 false → `sourceMissing: false` → 이동 행을 따르지 않고 `'skipped'` + `upsertError` 가 되어 세 단언이
한꺼번에 깨진다(이웃 테스트 `:605` 가 그 경로를 따로 못박고 있다). 그러니 "fallback 에 **ENOENT 때문에**
도달했다" 가 증명된다.

**'ready' 테스트 (`:584-605`)** 는 N1 — 리스너 정리만 증명하고 기다림은 증명하지 않는다.

**`mockClear` 누수.** 파일 최상위 `beforeEach` (`:224-233`) 는 `driveFilesGet`·`driveAboutGet`·
`oauth2GetAccessToken` 만 reset 하고 `driveFilesCreate` 는 건드리지 않는다 — 즉 **원래부터 호출 기록이 파일
전체에 누적**되고 있었고, `:580` 의 `toHaveBeenCalledTimes(1)` 에 `mockClear` 가 *필요*했던 것이다. 새 테스트
뒤에서 `driveFilesCreate` 의 기록을 읽는 다음 지점은 `:785` `upload verification` 의 `beforeEach` 가 `mockReset`
하는 곳이라 새 `mockClear` 가 뭔가를 빼앗지는 않는다. 구현(`mockResolvedValue`)은 `mockClear` 가 지우지
않으며 `:477`/`:538` 이 이미 같은 식으로 덮어쓰고 있었다. **누수 없음.** 다만 `:369`/`:396` 의
`not.toHaveBeenCalled()` 는 "앞선 테스트가 create 를 안 불렀다" 에 기대는 순서 의존이다 — 이 변경이 만든 게
아니고 지금은 참이지만, 최상위 `beforeEach` 에 `driveFilesCreate.mockReset()` 을 넣으면 두 `mockClear` 와 함께
사라진다.

### 4. F1 — 업스트림 테스트에 핀, 또는 공유 기본값?

**둘 다 아니다 — `test/vitest.config.mjs` 의 `test.env` 다.** 근거는 M1: 같은 원인에 걸린 테스트가 12 개 더
있고, `newTestService` 기본값으로는 `system-config.service.spec.ts` 의 5 개(defaults 자체를 비교)를 못 덮으며,
config 의 env 핀은 13 개 전부를 덮는 것을 스크래치 설정으로 확인했다. 핀을 테스트에 박는 모양은 "이 테스트가
env 를 안다" 를 테스트마다 반복하게 만든다.

## What I did not verify

- **변이 재실행.** 소스를 바꿔야 해서 하지 않았다. 요청서의 네 변이는 코드 추적으로만 확인했다(Q3).
- **실 파일에서 `openAndWait` 자체를 호출**하지는 않았다 — 프로브는 같은 `once`/`off` 패턴을 스크래치에서
  재현한 것이고(7 번), 서비스 메서드를 import 하지는 않았다.
- **web·medium 은 재실행하지 않았다.** `results/20261002-1334.txt` 의 87/87, 72/72 를 읽었을 뿐이다. 이 범위에
  web·SQL 변경이 없으므로 서버 유닛 전체(2457)로 충분하다고 판단했다.
- **Node 24 이외 버전**의 `fs.ReadStream` 동작(특히 6 번 "destroy 전 `'ready'`")은 보지 않았다. 저장소가 24.15.0
  을 고정하므로 범위 밖이다.
- `.claude/docs/reviews/` 와 `.claude/logs/` 는 지시대로 읽지 않았다. isolated review 원문의 F1~F3 는 요청서의
  재서술만 봤다.

## Feeding back into the plan

- **유닛 테스트의 기본 config 는 셸 env 다.** `config.ts:359-367` 이 `process.env` 를 defaults 로 읽는 한
  "기능이 꺼져 있다" 를 전제하는 모든 테스트(현재 13 개)가 실행자에 따라 달라진다. 고정 위치는
  `server/test/vitest.config.mjs` `test.env` 한 곳이다(M1). `dev-test/google-drive/README.md` 와 §2 테스트
  규칙에 "env 핀은 vitest config 에 있다 — 스펙마다 박지 않는다" 를 적어둔다.
- **§4 지뢰 표에 거울상 한 줄.** "env 가 기능을 켜서 '안 한다' 단언이 깨진다" — 기존 행("꺼져 있어 공허하게
  통과")과 원인이 같다.
- **`fs.ReadStream` 의 측정된 사실**(Q1 표)은 `failure-handling-plan.md` 의 R3/F2 절에 옮겨 둔다 — 다음에 누가
  "`'ready'` 를 놓치면?" 을 물을 때 다시 재지 않도록. 핵심 세 줄: `fd` 는 `'ready'` 전에 세팅된다 / 소비 전엔
  읽지 않는다 / 열기 전 destroy 도 `'ready'` 를 낸다(Node 24).
- **`CLAUDE.md:580` 과 `.claude/rules/security.md`** 가 새 §1 과 어긋난다(N3). 다음 문서 라운드에 포함.
