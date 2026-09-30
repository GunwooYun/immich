# Code Review — wave11c (R2): 요청 계층 (`retry: false` · 스톨 워치독 · 403 분류) + wave11b 반영

| | |
|---|---|
| Branch / HEAD | `feat/google-drive-album-sync-v3.1.0` / 리뷰 대상 `1b312a220` (작업 트리는 리뷰 중 R3 작업으로 이동 — 아래 "Evidence" 첫 줄) |
| Commits reviewed | `65cd3cf13..1b312a220` (3 commits: 코드 `9be13b05a`, 문서/run.sh `d34c7a5da`, 요청서 `1b312a220`) |
| Report | ../report/google-drive-wave11c-request-layer-20261001-0650-report.md |
| Reviewed | 2026-10-01 |

## Verdict

**NOT BLOCKED.** 요청서가 가장 크게 물은 것 — 라이브러리가 멀티파트 스트림 본문에서 `signal`과 `onUploadProgress`를
정말 존중하는가 — 는 소스 대조와 **실제 라이브러리를 로컬 HTTP 서버에 붙인 프로브**로 둘 다 확인했다.
`googleapis-common@7.2.0`의 `ProgressStream`은 누적(`bytesRead += chunk.length`)이고 미디어 파트에만 끼어 있으며,
abort는 node-fetch가 1~4 ms 안에 `AbortError`로 거부하고 요청 본문 스트림을 파기한다. `retry: false`는 gaxios
`getRetryConfig` 첫 분기에서 끝나고, 프로브의 503 케이스에서 서버가 본 요청은 정확히 1개였다. 리포트의 변이 7개는
모두 같은 테스트가 빨간불이 났다. 가장 중요한 문제는 M1이다: 워치독의 근거로 적힌 "소스 스트림 오류 → 파이프가
끊겨 요청이 영원히 매달림"은 **실제로는 그 지점에 도달하지 못한다** — `fs.ReadStream`에 `'error'` 리스너가 체인 어디에도
없어서 mid-flight EIO나 지연 open의 EMFILE/ENOENT는 uncaught exception으로 프로세스를 죽인다. R2가 만든 결함은
아니지만(이전 코드도 같았다) R2의 주석과 커밋 메시지가 워치독이 그 경우를 덮는다고 문서화했으므로, 세 줄짜리
리스너를 R2 후속 또는 R3 F6에 넣어야 그 문장이 참이 된다.

### Evidence I ran myself

리뷰 시작 시점에 이미 작업 트리에 R3 작업으로 보이는 수정 10개 파일(`enum.ts`, `queue.service.ts`,
`google-drive.repository.ts` 등)이 있어서, `1b312a220`을 스크래치패드에 `git worktree add --detach`로 따로
체크아웃하고 `node_modules`를 심링크해 거기서 돌렸다. 프로브 스크립트도 스크래치패드에만 두었다.

| Check | Result |
|---|---|
| `git show 9be13b05a --stat` | 4 files, +341/−145 — 리포트 표와 일치 |
| 워크트리 `vitest` 두 스펙 | `google-drive.service.spec.ts` 122 / `utils/google-drive.spec.ts` 33 — **155 passed** |
| 워크트리 `vitest` 전체 (`--config test/vitest.config.mjs`) | 94 files, **2449 passed / 2 skipped** — 리포트와 일치 |
| 워크트리 `tsc --noEmit -p tsconfig.json` | exit 0 |
| 워크트리 `eslint` 변경 4파일 `--max-warnings 0` | exit 0 |
| `dev-test/google-drive/results/20261001-0643.txt` (`1b312a220`) | server 322/322, web 87/87, medium 65/65, `RESULT: PASS`, 헤더에 ` M mise.lock` 목록 — 리포트 표와 일치 |
| 변이 M-a `retry: false → true` | red 1: "disable in-request retries…" (리포트와 동일) |
| 변이 M-b 콜백이 재무장하지 않음 (`=> bytesRead < 0 &&`) | red 2: "keep a slow upload alive…", "longer response budget…" (리포트와 동일) |
| 변이 M-c `UPLOAD_RESPONSE_TIMEOUT_MS = 120_000` | red 1: "longer response budget…" |
| 변이 M-d `finally`의 `clearTimeout`만 제거 | red 1: "not leave the watchdog armed…" |
| 변이 M-e `\|\| getStatus(error) === 403` | red 2: "403 that is not a rate limit…", "folder-permission…" |
| 변이 M-g `dailyLimitExceeded` 삭제 | red 1: "rate-limit reason codes and any 429…" |
| 변이 M-f `{ sourceMissing: true }` | red 1: "not follow the move row when … other than ENOENT" |
| **프로브 1** (`probe.js`): 실제 `googleapis@144.0.0` → `googleapis-common@7.2.0` → `gaxios@6.7.1` → `node-fetch@2.7.0`, 20 MB 파일, 로컬 HTTP 서버 | 아래 "Answers" §1·§2·§4에 수치 |
| **프로브 2** (`probe2.js`): 본문 전송 중 403이 먼저 도착한 뒤 `catch`의 await → `finally`(clearTimeout + destroy) 순서 | `finally` 이후 progress 이벤트 0회, 타이머 잔존 없음 |
| Node 실험: 파이프 중 소스 `destroy(EIO)` / 지연 open ENOENT, 리스너 없음 | 둘 다 `uncaughtException` (M1) |
| `git grep uncaughtException\|unhandledRejection 1b312a220 -- server/src` | 없음 |
| `git status --porcelain` (리뷰 파일 작성 후) | 아래 "What I did not verify" 끝에 기록 |

## Findings

### M1 — 소스 스트림 오류는 "스톨"이 아니라 프로세스 크래시다. 워치독은 거기 도달하지 못한다 (Medium, R2 이전부터 있던 결함)

R2의 근거 문장 세 곳이 같은 주장을 한다 — `UPLOAD_IDLE_TIMEOUT_MS` 독블록(`google-drive.service.ts:803-806`
"a source-side error mid-flight unpipes without ending the request body and the request would otherwise wait
forever"), 인라인 주석(`:1322-1324` "Aborting makes node-fetch destroy the request body, which is also what
unsticks the pipe in the source-error case"), 그리고 커밋 메시지. 파이프가 본문을 끝내지 않는다는 절반은 맞다
(내 실험에서 소스 파기 후 `dst.writableEnded=false`). 그런데 그 전에 일어나는 일이 있다: `fs.ReadStream`이
`'error'`를 내는데 **아무도 듣지 않는다.**

- 서비스: `git grep "on('error'"` — `google-drive.service.ts`에 없음. `finally`의 `destroy()`(`:1494`)는 오류
  *뒤*에 실행되지 않는다(await가 매달려 있으므로).
- `apirequest.js:181` `part.body.pipe(pStream).pipe(rStream)` — `pipe()`는 dest 오류만 처리하고 src에는 리스너를
  달지 않는다.
- node-fetch는 `request.body`(= `rStream`)에만 `'error'` 리스너를 단다.

Node 24에서 리스너 없는 `'error'`는 uncaught exception이고, `server/src`에는 `uncaughtException` 핸들러가 없다.
실험 둘 다 `UNCAUGHT`로 끝났다: ① `src.pipe(pt).pipe(dst)` 중 `src.destroy(EIO)`, ② `createReadStream('/nonexistent')`
— 이 둘째가 중요하다. `storage.repository.ts:122-126`은 `fs.stat` → `fs.access` 뒤에 `createReadStream(filepath)`를
돌려주는데 이 open은 **지연**이므로, stat/access를 통과한 뒤 open 시점의 EMFILE(V1g가 걱정한 바로 그 디스크립터
고갈)·ENOENT(stat과 open 사이의 이동)는 reject가 아니라 `'error'` 이벤트로 온다 — `isFileMissing`도, `openOriginal`의
catch도, 워치독도 보지 못하고 마이크로서비스 프로세스가 죽는다.

세 줄로 닫힌다 (워치독을 무장하는 곳, `:1329` 직후):

```ts
// A source-side error never reaches the request: nothing in the pipe chain listens for it, so it
// would be an uncaught exception. Turn it into the abort the watchdog would have produced later.
let sourceError: unknown;
streamInfo.stream.once('error', (error) => {
  sourceError = error;
  stall.abort();
});
```

`catch`에서는 `sourceError`가 있으면 detail을 "Upload stalled"가 아니라 `Source stream failed: ${code}`로 적고
(분류는 R3 F6의 재시도 가능 `source_unreadable`이 자연스럽다), 위 세 주석과 커밋 서술을 "크래시를 abort로 바꾼다"로
고친다. 테스트는 `{ destroy }` 목이 아니라 `new PassThrough()` 같은 EventEmitter 목이 필요하다 — `files.create`가
매달린 상태에서 `stream.emit('error', Object.assign(new Error('EIO'), { code: 'EIO' }))` → signal aborted, 행 기록,
`recordUpload` 미호출. 리스너를 지우면 vitest가 unhandled error로 빨간불이 나므로 비공허하다.

R2 범위 밖이라고 미룰 수도 있지만, R2가 이 시나리오를 워치독의 존재 이유로 문서화했으므로 여기서 짚는다.

### N1 — 토큰 갱신은 워치독 *안에서* 돌지만 워치독에 *묶이지* 않는다 (Low, 리포트 항목 3의 답)

`google-drive.service.ts:1261` `setCredentials({ refresh_token })`만 하므로 **모든 업로드가 `files.create` 안에서
먼저 갱신**한다(`oauth2client.js:418 getRequestMetadataAsync` → `:212-218 refreshTokenNoCache`). 그 요청은 우리
`signal` 없이 `AuthClient.RETRY_CONFIG`(`authclient.js:107-114`: `retry: true`, POST 포함, 타임아웃 없음)로 나간다.
그래서 토큰 엔드포인트가 응답 없이 매달리면 120 s에 `stall.abort()`가 불려도 **아무것도 취소되지 않고** 잡은 TCP가
포기할 때까지 매달린다. 갱신이 결국 돌아오면 node-fetch가 `signal.aborted`를 보고(`index.js:1467-1469`) 즉시
`AbortError` → `Unknown` + "Upload stalled: no progress from Google Drive" — 분류는 무해하지만 detail 문구가 틀린
쪽(토큰 서버)을 가리킨다. `invalid_grant` 오분류는 없다: `isInvalidGrant`(`:1624`)는 `response.data.error` 또는
메시지의 `invalid_grant` 문자열만 보고, abort 메시지는 "The user aborted a request."다.

R2 이전에도 같았고 드문 사건이지만, 고치려면 워치독 무장 **전에** `await oauth2Client.getAccessToken()`을 별도 상한
(예: `Promise.race` 30 s)으로 한 번 부르면 된다 — `transporter.defaults.timeout`은 같은 transporter가 업로드 요청도
태우므로 쓰면 안 된다(R2가 피한 whole-body timeout이 되돌아온다). 지금 라운드에서는 계획에 사실만 남겨도 된다.

### N2 — "a few hundred KB" 는 측정치와 다르다 (Nit)

`:807-808` "a stream high-water mark plus the socket buffer, a few hundred KB". 프로브 1 `stall-early`에서 서버가
1 MB 뒤 읽기를 멈췄는데 progress 이벤트는 **11,010,048 바이트**까지 이어졌다(루프백 커널 버퍼 자동 조정). WAN에서는
`tcp_wmem` 상한(배포판 기본 4 MB 안팎)이 그 자리다. 결론("느리지만 움직이는 업로드는 절대 걸리지 않는다")은 그대로
성립하고 오히려 더 여유가 있다 — 숫자만 "수 MB(커널 송신 버퍼)"로 고치면 된다.

### N3 — V2의 "5xx는 재시도되지 않고 기록된다" 절반은 테스트가 없다 (Nit)

CLAUDE.md `### Verification plan` V2 = "`files.create` `retry: false`, 5xx 비재시도·기록". 스펙의 요청 계층 테스트는
옵션(`retry === false`, `retryConfig` undefined)만 단언하고, `files.create`가 5xx로 거부됐을 때 행이 기록되는 테스트는
없다(스펙의 503은 `:1482` `driveAboutGet`이다). 목으로는 "비재시도"를 증명할 수 없으니 옵션 단언이 맞는 선택이지만,
"기록" 절반은 한 테스트로 닫을 수 있다.

덧붙여 프로브가 보여준 사실 하나: `retry` 를 생략하거나 `true`로 줘도 gaxios는 **POST를 재시도하지 않는다**
(`retry.js:25-31` 기본 `httpMethodsToRetry`에 POST가 없다 — 프로브 `retry: 'omit'`·`true` 둘 다 요청 1개, 오류의
`retryConfig.httpMethodsToRetry = [GET,HEAD,PUT,OPTIONS,DELETE]`). 옛 코드가 실제로 재시도했던 이유는 `shouldRetry`
커스텀 술어가 그 검사를 통째로 대체했기 때문이다. 즉 F4의 근거("옛 코드는 소진된 스트림을 재전송했다")는 맞고,
"`retry: true` went red"는 단언 수준의 빨간불이지 동작 차이는 아니다. 계획에 이 사실을 적어 두면 R3에서 "`retry:
true`로 되돌리면 재시도가 살아난다"는 오해를 막는다.

### N4 — classify 주석의 R3 전방 참조는 시제가 문제다 (Nit, 리포트 항목 7)

`utils/google-drive.ts:147-151` "That theory held no weight once RateLimited **became** a class the nightly backfill
retries without an attempt cap (wave11 R3)". R3는 아직 없다. 막을 이유는 없다 — 분류 변경 자체는 지금도 옳다(권한
403을 "저절로 풀린다"고 약속하는 클래스에 두는 것은 R3와 무관하게 틀렸다). 다만 "will become … (wave11 R3, planned)"
로 고쳐 두면 R3가 미뤄져도 주석이 거짓말을 하지 않는다.

### N5 — 스펙의 `FakeAbortError` 모양은 실제와 다르다 (Nit, 동작 영향 없음)

`spec:26-29` `class FakeAbortError extends Error { name = 'AbortError' }`. 프로브에서 서비스가 실제로 받는 것은
`GaxiosError`(`name: 'Error'`, `error.name === 'AbortError'`, message "The user aborted a request.")다
(`gaxios.js:147-149`가 감싼다). 서비스는 이름이 아니라 `stall.signal.aborted`(`:1461`)로 판정하므로 아무것도 깨지지
않지만, 주석 "What node-fetch rejects with"는 "what gaxios hands back"이 아니다. 나중에 누군가 `error.name`으로 분기하면
스펙이 통과하면서 운영이 틀리는 모양이니 한 줄 고쳐 둘 가치가 있다.

## Answers to what the report asked me to attack

### 1. 워치독 배선이 실제 라이브러리에서 동작하는가 — 예, 소스와 프로브 둘 다로

**옵션 전달 경로 (읽음).** `drive/v3.js:730-734` `Object.assign({url, method, apiVersion}, options)` → `apirequest.js:61-65`
`extend(true, {}, google._options, context._options, parameters.options)` — `signal`(AbortSignal은 `extend`의
`isPlainObject` 검사 `extend/index.js:16-34`에서 `[object AbortSignal]`이라 **참조 그대로**), `retry`, `onUploadProgress`
전부 `options`에 남는다. `:263` `options.retry = options.retry === undefined ? true : options.retry` → `false` 유지.
`:304` `authClient.request(options)` → `oauth2client.js:429 transporter.request(opts)` → `transporters.js:60-64`
(`validate`는 `uri/json/qs`만 거부) → `gaxios.js:353` extend → `:113 fetchImpl(opts.url, opts)` → node-fetch
`index.js:1241 signal = init.signal`, `:1183-1186 isAbortSignal`은 생성자 이름 `AbortSignal`을 받는다.

**progress (읽음 + 측정).** `apirequest.js:314-326` `ProgressStream._transform`: `this.bytesRead += chunk.length;
emit('progress', this.bytesRead)` — **누적**. `:176-179`에서 `options.onUploadProgress({ bytesRead })`로 그대로 전달.
프로브 `stall-after-body`: 이벤트 320개, 단조 증가, 첫 값 65,536(fs highWaterMark), **마지막 값 20,971,520 = 파일 길이**.

**abort (읽음 + 측정).** `index.js:1457-1465` `abort()`: `reject(new AbortError('The user aborted a request.'))` +
`destroyStream(request.body, error)`; `:1472-1475 abortAndFinalize` → `finalize()` `req.abort()`. 프로브: abort 후 거부까지
1 ms(`stall-after-body`)·4 ms(`stall-early`), `err.config.data.destroyed === true`(= `rStream` 파기), 서버 소켓 close 관측.
단 **mid-stream abort는 `fs.ReadStream`을 파기하지 않는다**(`stall-early`: `destroyed=false`, 11 MB 읽은 채 정지) —
`finally`의 `streamInfo.stream.destroy()`(`:1494`, V10)가 그 몫이고 그래서 필요하다. 응답 예산 전환은 마지막 바이트가
`ProgressStream`을 *통과*할 때 일어나며 소켓 flush 이전이지만, 더 긴 예산으로 바뀌는 방향이라 무해하다.

### 2. `bytesRead`는 미디어 파트만 세는가 — 예

`apirequest.js:164-182`: JSON 파트는 `typeof part.body === 'string'` 분기에서 `rStream.push`로 직접 들어가고,
`pStream`은 스트림 파트에만 `part.body.pipe(pStream).pipe(rStream)`으로 낀다. 프로브: 마지막 progress 20,971,520,
서버 수신 20,971,736 — 차이 216 B가 preamble·JSON·boundary·finale이다. 조기 전환은 없다. (`streamInfo.length`가 열 때의
stat이므로 파일이 그 뒤 **커지면** 조기 전환 — 600 s idle로 늘어날 뿐 — 이고, **줄어들면** 전환이 없어 응답 대기가
120 s에 잘린다 — 크기 검사가 어차피 거부하는 업로드다.)

### 3. 워치독 안의 토큰 갱신 — N1

갱신은 매 업로드마다 일어나고(`:1261`), 워치독은 그것을 **중단시키지 못한다**. abort가 갱신 중에 나도 `invalid_grant`로
오분류되거나 자격증명이 지워지는 경로는 없다(`isInvalidGrant :1624`). 갱신이 "정당하게 120 s를 넘는" 경우는 없고,
넘는다면 매달린 것이며 그때는 워치독이 아니라 TCP가 끝낸다.

### 4. `retry: false`가 정말 재시도를 끈다 — 예, `noResponseRetries` 포함

`retry.js:16-20`: `config = err.config.retryConfig`(undefined) → `!config && !err.config.retry` → `{ shouldRetry: false }`.
`noResponseRetries`(`:32-35`)·`statusCodesToRetry`·`shouldRetryRequest`는 그 아래라 도달하지 않는다. 프로브 503 ×
`retry: false`: 서버 요청 1개, 오류에 `retryConfig` 없음. `AbortError`는 어차피 `shouldRetryRequest :98`이 거부하지만
그 함수도 호출되지 않는다.

한 겹 더 확인했다: **google-auth-library 자체의 401/403 재발급** (`oauth2client.js:465-472`) — `!isReadableStream` 가드가
`res.config.data instanceof stream.Readable`을 본다. `GaxiosError` 생성자(`common.js:66-68`)가 `extend(true, {}, config)`로
깊은 복사를 하지만 스트림은 `isPlainObject` 실패로 참조가 유지된다(프로브 `bodyIsStream: true`). 그래서 이 두 번째
재시도 계층도 멀티파트 업로드에는 절대 발동하지 않는다. (`errorRedactor`는 `data`가 문자열일 때만 손댄다,
`common.js:135-146`.)

### 5. F5 폭발 반경 — 사실상 0

`git grep RateLimited\|rate_limited 1b312a220 -- server/src web/src i18n/en.json` (spec 제외): `enum.ts:1204`와
`utils/google-drive.ts` 분류뿐이다. `google-drive.repository.ts:847`의 정렬은 `QuotaExceeded then 0 else 1` — 나머지
클래스는 동률. 웹 `GoogleDriveSettings.svelte:256-275` `failureLabel`은 quota/folder/source/size/revoked만 분기하고
`rate_limited`는 원래부터 default였다. 알림(`:1469-1470`)은 Quota·FolderMissing만. 즉 bare 403이 `Unknown`이 되어도
지금 코드에서 달라지는 동작은 **없고**, 유일한 소비자는 아직 없는 R3 backfill이다 — 그래서 F5는 R3보다 먼저 들어가는
것이 맞다.

### 6. `isFileMissing`은 `createReadStream`이 실제로 던지는 것에 맞는가 — reject 경로에는 맞고, 이벤트 경로는 못 본다

`storage.repository.ts:122-130`: `await fs.stat(filepath)` → `await fs.access(filepath, R_OK)` — 둘 다 Node의 raw
`ErrnoException`을 그대로 reject하고 감싸지 않으므로 `code === 'ENOENT'` 검사는 정확하다(EACCES는 access에서,
ENOENT는 stat에서). 그러나 `:126 createReadStream(filepath)`의 open은 지연이라 **그 시점의 오류는 reject가 아니라
`'error'` 이벤트**다 — M1. `isFileMissing`을 R3 F6에서 재사용할 때 이 두 경로(reject vs 이벤트)를 분리해야 한다.

### 7. R3 전방 참조 — N4. 막지 않는다.

### 시나리오 ↔ 테스트 대응 (CLAUDE.md `### Verification plan`, `1b312a220`)

| ID | 테스트 (`google-drive.service.spec.ts` / `utils/google-drive.spec.ts`) | 실패해야 할 때 실패하는가 (내가 돌린 변이) |
|---|---|---|
| V1g | "should not follow the move row when the first read failed for a reason other than ENOENT" | M-f red 1 ✓ — `getByEntity` 미호출 + `getById` 3회 단언이 "폴백이 돌긴 했다"를 못박아 비공허 |
| V2 | "should disable in-request retries and pass the stall watchdog" | M-a red 1 ✓ — "5xx 기록" 절반은 미커버 (N3) |
| V3 | "abort … no progress … Unknown … close the file", "keep a slow upload alive…", "longer response budget…", "not leave the watchdog armed…" | M-b red 2, M-c red 1, M-d red 1 ✓ — 계획의 "각각 실패"와 일치. 119,999 ms 경계 단언과 `getTimerCount() === 0`이 공허 통과를 막는다 |
| V4 | "rate-limit reason codes and any 429…", "403 that is not a rate limit…", "folder-permission … 403s" (noFolder → Unknown) | M-e red 2, M-g red 1 ✓ |

## What I did not verify

- **실제 Google 엔드포인트.** 프로브는 로컬 HTTP 서버이고 API 키 인증이라 OAuth 갱신 경로(N1)는 소스로만 봤다.
  Google이 멀티파트 본문을 다 읽기 전에 403/429를 보내는지, 실제 reason payload 문자열은 확인하지 못했다.
- **운영 환경의 스톨 재현.** 워치독이 실제 느린 업로드에서 오작동하지 않는다는 것은 로컬 측정(N2)에서 유추한 것이다.
- `uncaughtException` 핸들러는 `server/src`만 검색했다. Nest/BullMQ 의존성 안에 전역 핸들러가 있다면 M1의 결과는
  "크래시"가 아니라 "영원한 매달림"이 되고, 그때는 워치독이 실제로 받는다 — 어느 쪽이든 리스너는 필요하다.
- web vitest·medium 스위트는 재실행하지 않았다(리포트 첨부 결과 파일만 대조).
- `docs` 커밋 `d34c7a5da`의 계획 문서 변경은 `stabilization-plan.md:135` "R2 deviation: … `UPLOAD_RESPONSE_TIMEOUT_MS`"
  한 줄만 확인했다.
- `git status --porcelain` — 리뷰 시작 전에 이미 작업 트리에 작성자 세션의 수정 10개 파일 + `M mise.lock`이 있었다
  (`enum.ts`, `google-drive.repository.ts`, `job.repository.ts`, `google-drive.service.spec.ts`, `google-drive.service.ts`,
  `queue.service.spec.ts`, `queue.service.ts`, `utils/google-drive.ts`, `medium/.../google-drive.repository.spec.ts`,
  `test/utils.ts`). 내가 만든 변경은 이 리뷰 파일(`?? dev-docs/review/google-drive/review/google-drive-wave11c-request-layer-20261001-0701-review.md`)
  하나뿐이다 — 작성 후 실행한 상태는 아래 마지막 줄. 스크래치 워크트리·프로브 파일은 저장소 밖(`scratchpad/`)이다.

## Feeding back into the plan

- **R3 F6에 M1을 붙인다**: `streamInfo.stream.once('error', …)` → abort + `sourceError` 기록. F6의 "읽기 오류 분리"는
  reject 경로(`isFileMissing`)와 **이벤트 경로**(지연 open의 EMFILE/ENOENT, mid-flight EIO) 둘을 다뤄야 한다. 워치독
  주석 세 곳과 커밋 서술의 "source-error case" 문장을 함께 고친다.
- **사실 기록**: gaxios 기본 `httpMethodsToRetry`에 POST가 없다 — `retry: true`만으로는 `files.create`가 재시도되지
  않고, 재시도가 살아나는 조건은 `retryConfig.shouldRetry`(옛 코드) 또는 `httpMethodsToRetry` 지정이다 (N3).
- **사실 기록**: 토큰 갱신은 매 업로드마다 워치독 안에서 돌지만 signal에 묶이지 않는다(N1). 상한을 두려면 무장
  전 `getAccessToken()`; `transporter.defaults.timeout`은 업로드까지 물리므로 금지.
- **V2 보강**: `files.create` 5xx 거부 → `Unknown` 행 기록 테스트 한 개.
- **측정치**: 네트워크 정지 후 progress가 멈추기까지 로컬 버퍼가 삼키는 양은 루프백에서 ~10 MB — "a few hundred KB"
  를 계획·주석에서 고친다 (N2).
- **스펙 fidelity**: 실제 abort 오류는 `GaxiosError{name:'Error', error.name:'AbortError'}` (N5).

`git status --porcelain` (리뷰 파일 작성 직후): 위 "What I did not verify" 마지막 항목의 작성자 세션 수정 11개 +
`?? dev-docs/review/google-drive/review/google-drive-wave11c-request-layer-20261001-0701-review.md` — 내가 추가한
것은 이 파일 하나다.
