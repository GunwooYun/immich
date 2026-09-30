# Code Review — wave11a (R0): 두 전제의 정정 + 인용되지 않은 커밋들

| | |
|---|---|
| Branch / HEAD | `feat/google-drive-album-sync-v3.1.0` @ `791c48ea4` (메인 작업 트리 — 아래 N4 참고: 리뷰 중 작업 트리가 R1 작업으로 움직이고 있었다) |
| Commits reviewed | `053b2810d..791c48ea4` = `0172d69d1`, `5fcd8d383`, `1e2fd8ac7`, `be509702a`(유일한 코드 변경), `791c48ea4`(리포트). `df8628ba0`는 범위 밖 (N2) |
| Report | `../report/google-drive-wave11a-premises-20260930-2220-report.md` |
| Reviewed | 2026-09-30 22:30 +0900 |

## Verdict

**판정: NOT BLOCKED.** 코드 변경은 `uploadType: 'resumable'` 한 줄 삭제뿐이고, 그것이 no-op이라는 주장은
설치된 `googleapis-common@7.2.0`(단일 해석, `googleapis@144.0.0` 경유)의 `apirequest.js:205-208`과 우리 호출
지점(`requestBody`·`media.body`가 항상 채워지는 단 하나의 `files.create`)으로 확인했다. 316 / 87 / PASS는 HEAD를
따로 체크아웃해 재현했다. 문제는 **R0가 틀린 전제 하나를 걷어내면서 부분적으로 틀린 전제 둘을 새 주석에 적어
넣었다**는 것이다: (M1) "Drive 잡은 failed 상태에 절대 도달하지 않는다"는 BullMQ의 stall 판정과 `onJobRun`의
`catch` 블록 안에서 던져지는 `JobError` 핸들러 두 경로에서 거짓이라 `removeOnFail: true`는 그 경로에서 여전히
load-bearing 이고, (M2) "5 MB 상한은 `uploadType=media`에만 적용된다"는 구글 문서와 어긋난다(문서는 multipart에도
같은 "5 MB or less"를 적는다 — 실제 근거는 문서가 아니라 운영 실증이다). 둘 다 주석 문구의 문제라 런타임 위험은
없지만, wave11 계획서(`stabilization-plan.md:32-33`)가 "`removeOnFail: true`와 그 주석은 inert"를 전제로 적고
있으므로 다음 라운드가 그 줄을 근거로 옵션을 지우기 전에 고쳐야 한다.

### Evidence I ran myself

| Check | Result |
|---|---|
| `git log --oneline 053b2810d..791c48ea4` | 5 커밋. `df8628ba0`는 `git merge-base --is-ancestor df8628ba0 053b2810d` → 참, 즉 범위 밖 |
| `pnpm why googleapis-common` (server/) | `googleapis-common@7.2.0 └─ googleapis@144.0.0 └─ immich@3.1.0`, "Found 1 version" |
| `node_modules/.pnpm/googleapis-common@7.2.0/.../build/src/apirequest.js:205-208` | `if (parameters.mediaUrl && media.body) { … if (resource) { params.uploadType = 'multipart';` — 리포트 인용 줄 번호와 정확히 일치 |
| `googleapis/build/src/apis/drive/v3.js:736` | `files.create`가 `mediaUrl: rootUrl + '/upload/drive/v3/files'`를 넘긴다 → 위 조건의 첫 항이 참 |
| `grep -rn "uploadType\|files\.create(" server/src` (spec 제외) | 호출 지점은 `google-drive.service.ts:1301` 하나뿐 |
| `git show HEAD:server/src/repositories/storage.repository.ts:122-129` | `createReadStream`은 항상 `{ stream: createReadStream(filepath), length, type }`를 돌려준다 → `media.body`는 항상 truthy |
| `git show HEAD:.../google-drive.service.ts:1284-1304` | `requestBody: fileMetadata`(객체 리터럴, 항상 존재), `media` 항상 존재 |
| `job.service.ts:84-98` | `onJobRun`: `try { emit JobStart; run; emit JobSuccess } catch { emit JobError } finally { emit JobComplete }` — 리포트의 86-98은 try 본문 기준, 실질 일치 |
| `job.repository.ts:94-98` | `new Worker(queueName, (job) => this.eventRepository.emit('JobRun', …), { ...bull.config, concurrency: 1, name })` — stall 옵션은 기본값 |
| `config.repository.ts:283-291` | `defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: false }` — 리포트·주석 인용 일치 |
| `event.repository.ts:240-248` | `for … await handler(...)` — 핸들러 예외를 잡지 않는다 |
| `bullmq@5.80.5 worker.js:34, :616` / `moveStalledJobsToWait-9.lua:97-99` | `maxStalledCount: 1` 기본, 초과 시 `"job stalled more than allowable limit"` → `deferredFailure` → failed |
| `sync-sql.ts:174, :189` | 한 메서드의 문장들은 `join('\n')`, 메서드 사이는 `join('\n\n')` → `0172d69d1`의 빈 줄 삭제가 생성기 출력 형식과 같다. `asset.repository.sql:2264`, `duplicate.repository.sql:2570`도 `)` 다음 줄에 바로 `select` |
| `npx prettier --check` / `npx eslint --max-warnings 0` (R0가 만진 5 파일) / `npx tsc --noEmit` | 전부 통과 (exit 0) |
| 스크래치패드에 `git worktree add --detach … HEAD` 후 run.sh의 SERVER_SPECS 8개 실행 (node_modules 심링크) | 26+37+16+18+32+5+70+**112** = **316** — 리포트의 `20260930-2216.txt`와 파일별로 동일. 워크트리는 즉시 제거 (`git worktree list`에 남지 않음) |
| 작업 트리(HEAD + 미커밋 R1 변경)에서 같은 8개 | **320** (service spec 116) — HEAD 수치가 아니다 (N4) |
| 작업 트리 전체 `npx vitest run --config test/vitest.config.mjs` | 94 files / 2446 passed / 2 skipped — 역시 미커밋 변경 포함 |
| Google Drive API 문서 `manage-uploads` (WebFetch) | "Multipart upload: … a small file (5 MB or less)", "Resumable upload: … large files (greater than 5 MB)" |
| `git status --porcelain` (리뷰 파일 쓰기 직전) | ` M mise.lock`, ` M server/src/services/google-drive.service.spec.ts`, ` M server/src/services/google-drive.service.ts` — 뒤 둘은 내가 아니라 R1 작업 (mtime 22:19:23 / 22:23:48, 리포트 22:16 이후) |

## Findings

### M1 — "Drive 잡은 failed 상태에 도달하지 않는다"는 절대 명제가 아니다. `removeOnFail`은 두 경로에서 여전히 load-bearing (Medium, 주석·계획서 문구)

`job.repository.ts:276-282`의 새 주석: "a Drive job never reaches the failed state: `JobService.onJobRun` catches every
handler error, emits `JobError`, and returns, so BullMQ sees a completed job". 리포트 §2도 "BullMQ only ever completes
these jobs". **핸들러(`run`)의 예외**에 대해서는 맞다(`job.service.ts:86-95`). 하지만 failed 상태로 가는 길이 두 개 더
있고, 둘 다 `onJobRun`의 `catch`가 감싸지 않는다.

1. **BullMQ stall 판정.** `job.repository.ts:97`은 `{ ...bull.config, concurrency: 1, name }`만 넘기고
   `bull.config`(`config.repository.ts:283-291`)에는 `lockDuration`/`maxStalledCount`가 없으므로 bullmq 5.80.5 기본값
   `lockDuration: 30000, maxStalledCount: 1`(`worker.js:34`)이 적용된다. 업로드 중 프로세스가 죽거나(OOM, 컨테이너 재시작
   — 8 GB 랩탑에서 동영상 스트리밍 중) lock이 갱신되지 못하면 `moveStalledJobsToWait-9.lua`가 잡을 wait로 되돌리고,
   두 번째 stall에서 `stalledCount > maxStalledJobCount` → `"job stalled more than allowable limit"`(`:97-99`) →
   `deferredFailure`(`worker.js:616`) → `moveToFailed`. 이 경로는 `removeOnFail`을 그대로 따른다. 기본값
   `removeOnFail: false`였다면 그 `(userId, assetId)` id는 옛 주석이 묘사한 대로 failed 상태로 남아 다음 sync·backfill의
   `add`를 조용히 거부한다(`addStandardJob-9.lua:90`).
2. **`catch` 블록 안의 `emit('JobError')` 자체가 던지는 경우.** `event.repository.ts:240-248`은 핸들러를 순서대로
   `await`하고 예외를 잡지 않는다. `notification.service.ts:81-83`의 `onJobError`는 첫 줄에서
   `userRepository.getAdmin()`(DB 조회)을 한다. Drive 업로드가 실패한 순간에 DB가 잠깐 안 되면 이 rejection은
   `onJobRun`의 `catch` **밖으로** 빠져나가고(`job.service.ts:94-96`에는 두 번째 `catch`가 없다), Worker의 processor
   (`job.repository.ts:96`)가 reject → BullMQ failed. `finally`의 `emit('JobComplete')`도 같은 구조지만 리스너가
   `telemetry.service.ts:52` 동기 카운터뿐이라 실제 위험은 낮다.

따라서 "defensive, not load-bearing"이라는 판정은 **일반 실패 경로에 한해** 맞고, 옵션을 지워도 되는 근거는 되지
못한다. 새 주석의 "would matter the day onJobRun starts rethrowing"은 조건이 틀렸다 — 지금도 저 두 경로에서 matter 한다.
`stabilization-plan.md:32-33`의 "`removeOnFail: true` … and its comment are inert"도 같은 정정이 필요하다.
"BullMQ `attempts`/`backoff`가 이 잡의 재시도 수단이 될 수 없다"는 결론(주석 후반부, 계획서 :33)은 그대로 성립한다 —
그것은 핸들러 예외가 BullMQ에 닿지 않는다는 사실에서 나오고, 그 사실은 맞다.

**고치는 법 (주석만):** `job.repository.ts:276-282`를 대략 이렇게. "`removeOnFail` is defensive for the *ordinary*
failure: `JobService.onJobRun` catches handler errors, so a Drive upload that throws still completes in BullMQ and
`removeOnComplete` frees the id. It is load-bearing for the two ways a job can still reach `failed` without the handler
throwing — BullMQ's stall detection (`maxStalledCount: 1`, lock lost twice, e.g. the process dying mid-upload) and a
`JobError` listener that itself rejects inside onJobRun's catch (`notification.service` queries the DB there). Either
would poison this (user, asset) id under the global `removeOnFail: false`." 계획서 :32-33도 같은 취지로.

### M2 — "5 MB 상한은 `uploadType=media`에만 적용된다"는 구글 문서와 어긋난다 (Medium, 주석 문구)

`google-drive.service.ts:1313-1314`: "The 5 MB cap that motivated it applies to `uploadType=media`, not multipart — 8,000+
production uploads including videos went through this path." 구글 Drive API `manage-uploads` 문서는 **multipart에도**
같은 문장을 적는다: "Multipart upload: Use this upload type to transfer a small file (5 MB or less) along with metadata",
"Resumable upload: Use this upload type for large files (greater than 5 MB)". 즉 문서 기준으로는 multipart도 5 MB
권고 대상이고, 우리가 기대도 되는 것은 "문서의 5 MB는 권고이지 강제 상한이 아니며 운영에서 그보다 큰 파일이 실제로
올라갔다"는 **실증**이다. 주석은 지금 근거를 뒤바꿔 적고 있다 — 다음 사람이 문서를 열어 보면 주석을 불신하게 되고,
그 불신은 같은 문단의 맞는 주장("no session to expire, a retry cannot resume")까지 번진다.

**고치는 법:** "Google's docs describe both simple and multipart as 'for files of 5 MB or less' and reserve resumable
for larger ones, but the figure is guidance, not an enforced cap: 8,000+ production uploads including videos well over
5 MB went through this path." — 단, 뒤 절반은 내가 검증하지 못했다(아래 "검증하지 않은 것"). 검증하려면 랩탑 DB에서
읽기 전용으로 `select max(e."fileSizeInByte") from google_drive_upload g join asset_exif e on e."assetId" = g."assetId"`
한 번이면 된다 — 원장은 크기를 저장하지 않으므로 exif 조인이 필요하다.

### N1 — `utils/google-drive.ts:102`가 125자 (nit)

R0 diff에서 한 줄이 재래핑 없이 이어 붙었다: `*     Those fall through to Unknown: non-blocking, picked up by the next
sync. With no folder configured, uploads target the`. `.prettierrc`의 `printWidth: 120`을 넘지만 Prettier는 주석을
재배치하지 않아 `--check`가 통과하고 ESLint에 `max-len`이 없어 게이트를 다 지나왔다. 문서 블록 안에서 유일하게 튀는
줄이라 눈으로 바로 보인다. 다음 주석 수정(M1/M2)에 묻어 재래핑하면 된다.

### N2 — `df8628ba0`는 리포트 범위 밖이고, "never cited"도 정확하지 않다 (nit, 리포트·계획서 문구)

리포트 §Commits in scope는 `df8628ba0`를 범위 `053b2810d..be509702a`에 넣지만 그 커밋은 `053b2810d`의 조상이다
(wave10d 리포트 커밋이 evidence 커밋 *뒤*에 있다). 그리고 wave10d 리포트 `:13`은 "`results/` newest at `58039033a`:
server 316, web 87, medium 65, PASS"로 그 결과 파일을 인용했고, wave10d 리뷰 `:49`는 파일명 `20260924-1112.txt`로 대조까지
했다. 즉 인용되지 않은 것은 *커밋 해시*뿐이다. 계획서 `:66`, `:105`의 "the two unreviewed commits" 문구를 "the two
commits no report named by hash"로 바꾸면 정확하다. 코드와 무관.

### N3 — 인용 줄 번호 (nit)

`apirequest.js:205-208`, `config.repository.ts:289`는 정확. `job.service.ts:86-98`은 `onJobRun`의 try 본문(메서드는
`:84-98`) — 실질 일치. 계획서 `:33`의 `job.repository.ts:290`은 R0가 주석을 2줄 줄여 지금은 `:288`이다 — 계획서가 R0
이전에 쓰였으니 자연스럽지만, 계획서를 고칠 때(M1) 같이 맞추면 된다.

### N4 — 리뷰 중 작업 트리가 움직였고, 결과 파일은 무엇이 미커밋이었는지 말하지 않는다 (nit, 프로세스)

`git status --porcelain`이 리뷰 시작 시 ` M mise.lock`만, 리뷰 도중 `google-drive.service.ts`(mtime 22:19:23)와
`google-drive.service.spec.ts`(22:23:48)가 추가로 잡혔다 — R1(move row fallback) 작업이 같은 트리에서 진행 중이다.
그래서 작업 트리에서 돌린 첫 실행은 320(service spec 116)으로 리포트의 316과 달랐고, HEAD를 스크래치패드에 따로
체크아웃해서야 316을 재현했다. 리포트가 "uncommitted changes: only `mise.lock`"이라고 적은 22:16:54 시점은 두 파일의
mtime보다 앞이라 **[추론] 맞을 것**이지만, `20260930-2216.txt:3`은 `+ UNCOMMITTED CHANGES`라고만 찍고 파일 목록이
없어 **결과 파일만으로는 확인할 수 없다**. `run.sh`의 헤더에 `git status --porcelain` 출력을 한 블록 넣으면 다음
라운드부터 이 질문이 사라진다 (헤더는 `run.sh:120-132` 부근의 `tee "$OUT"` 블록). 별도 세션 리뷰가 아니면 리포트를
쓴 뒤 리뷰가 돌아올 때까지 코드 파일을 건드리지 않는 것이 원칙(`CLAUDE.md` §2 "review/를 감시한다")이기도 하다.

## Answers to what the report asked me to attack

### 1. multipart 주장 — `requestBody` 없이 호출되는 경로가 있는가? 라이브러리 버전은 맞는가?

**없다, 맞다.** `files.create(` 호출은 저장소 전체에서 `google-drive.service.ts:1301` 한 곳이고(`grep`), 그 호출의
`requestBody`는 `:1284-1292`의 객체 리터럴 `fileMetadata`(항상 존재), `media.body`는 `:1256`의
`streamInfo = await this.openOriginal(asset)` → `storage.repository.ts:122-129`의 `createReadStream`이 항상
`{ stream: createReadStream(filepath), … }`를 돌려주므로 truthy. `openOriginal`(`:1488-1500`)은 반환하거나 던지지
반쪽 객체를 주지 않는다. Drive `files.create`는 `mediaUrl`(`drive/v3.js:736`)을 넘기므로 `apirequest.js:205`의
`parameters.mediaUrl && media.body`가 참, `:207`의 `if (resource)`(= `params.requestBody`, `:86`)가 참 →
`:208 params.uploadType = 'multipart'`. `:151-188`의 `multipartUpload`는 스트림을 `PassThrough`로 파이프해 한 요청으로
보낸다 — "streams the body in one request"도 맞다. 버전: `pnpm why` → `googleapis-common@7.2.0` 단일 해석,
`googleapis@144.0.0` 경유. **결론: `uploadType: 'resumable'` 삭제는 no-op이 맞다.** 단 5 MB 문장은 M2.

### 2. onJobRun 주장 — 에러가 BullMQ에 닿는 다른 runner가 있는가?

runner는 하나다(`job.repository.ts:94-98`의 `new Worker(…, (job) => emit('JobRun', …))`; `JobRun` 리스너는
`job.service.ts:84`뿐). 하지만 **같은 runner 안에서** 에러가 BullMQ에 닿는 경로가 둘 있다 — M1의 (1) stall 판정은 잡이
아예 `onJobRun`을 두 번째로 돌기 전에 failed가 되고, (2) `catch` 안의 `emit('JobError')`가 reject 하면 `onJobRun`의
Promise 자체가 reject 한다. 리포트 §Please attack의 조건문 그대로 — "If yes, `removeOnFail` *is* load-bearing and the new
comment is wrong" — **yes, 그 두 경로에 한해.** 옵션은 그대로 두었으니 코드는 안전하고 고칠 것은 주석과 계획서다.

### 3. `0172d69d1` — 생성물이 소스와 맞는가, 손으로 고쳤는가?

**손으로 고쳤고(커밋 메시지가 그렇게 말한다), 결과는 생성기 형식과 일치한다.** `sync-sql.ts:174`는 한 메서드의
문장들을 `[`-- ${queryLabel}`, ...queries].join('\n')`으로, `:189`는 메서드 블록들을 `join('\n\n')`으로 잇는다 — 한
메서드 안 두 문장 사이에 빈 줄은 생성되지 않는다. 다른 생성 파일에서도 `)` 바로 다음 줄이 `select`인 곳이 있다
(`asset.repository.sql:2264`, `duplicate.repository.sql:2570`). 커밋은 `.sql` 한 줄 삭제 + 리뷰 파일뿐이고 소스는 건드리지
않았다. `mise //:sql`을 직접 돌려 byte 단위로 대조하지는 않았다 — 그 명령은 `src/queries/*.sql` 전부를 다시 쓰므로 이
리뷰의 "다른 파일 수정 금지"와 충돌한다. 다음 `mise //:sql` 실행 때 diff가 비면 닫힌다.

## What I did not verify

- **운영에서 5 MB 초과 파일이 multipart로 올라갔다는 사실.** 주석의 "8,000+ production uploads including videos"는
  랩탑 DB를 읽어야 확인되고, 이 리뷰는 코드만 봤다. M2에 읽기 전용 쿼리를 적어 두었다.
- **`mise //:sql` 재실행과의 byte 대조** (위 §3).
- **22:16:54 시점의 미커밋 파일이 `mise.lock`뿐이었는지** — 결과 파일이 목록을 찍지 않는다 (N4). mtime으로는
  [추론] 맞다.
- **stall 경로의 실제 재현.** bullmq 소스와 lua를 읽었을 뿐, 업로드 중 프로세스를 죽여 두 번 stall 시켜 보지는
  않았다. 코드 경로는 명확하지만 "실제로 8 GB 랩탑에서 얼마나 자주 일어나는가"는 모른다.
- **`svelte-check` 베이스라인·web 87** — R0는 web을 건드리지 않았고 결과 파일의 숫자만 읽었다.
- `verify-task server`의 exit 0은 재현하지 않았고 구성 요소(prettier·eslint·tsc·전체 vitest)를 따로 돌렸다 —
  전체 vitest는 작업 트리(R1 포함) 기준이라 HEAD 증거로는 SERVER_SPECS 8개의 316만 쓴다.

`git status --porcelain` (이 파일을 쓴 뒤): ` M mise.lock`, ` M server/src/services/google-drive.service.spec.ts`,
` M server/src/services/google-drive.service.ts`, `?? dev-docs/review/google-drive/review/google-drive-wave11a-premises-20260930-2230-review.md`.
뒤 셋 중 앞 둘은 리뷰 시작 후 메인 세션이 만든 R1 변경이고(N4), 내가 만든 것은 이 리뷰 파일 하나다. 스크래치패드
워크트리는 `git worktree remove --force` + `prune`으로 지웠고 `git worktree list`에 남아 있지 않다.

## Feeding back into the plan

`dev-docs/google-drive/stabilization-plan.md`에 반영할 것:

1. **전제 2를 좁혀 적는다** (`:30-34`): "핸들러 예외는 BullMQ에 닿지 않는다(→ `attempts`/`backoff` 불가, 재큐 불가)"는
   유지. "`removeOnFail: true`와 주석은 inert"는 삭제하고 "stall 판정과 reject 하는 `JobError` 리스너 두 경로에서
   load-bearing — 지우지 않는다"로. 이후 라운드에서 이 옵션을 정리 대상에 올리지 않도록.
2. **전제 1에 5 MB 문서 사실을 정확히** (`:26-29`): 구글 문서는 multipart도 5 MB 권고. 우리 근거는 운영 실증이고, 그
   실증 수치(최대 업로드 크기)는 아직 측정하지 않았다 — 측정 쿼리는 M2.
3. **R1 태스크에 이 라운드의 주석 정정(M1·M2·N1) 포함**, 각각 `verify:task`(prettier·eslint·tsc)로 충분하다 — 코드
   변경이 아니다.
4. **`run.sh` 헤더에 `git status --porcelain`** (N4). 작은 변경이지만 "미커밋 변경 = mise.lock뿐"류 주장을 결과 파일이
   스스로 증명하게 된다.
5. `:66`, `:105`의 "unreviewed commits `0172d69d1`, `df8628ba0`" → "리포트가 해시로 인용하지 않은 커밋" (N2).
   `df8628ba0`는 wave10d 리뷰가 파일명으로 대조까지 했다.
