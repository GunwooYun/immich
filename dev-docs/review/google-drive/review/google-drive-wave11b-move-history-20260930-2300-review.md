# Code Review — wave11b (R1): `move_history`로 이동 중인 원본 찾기

| | |
|---|---|
| Branch / HEAD | `feat/google-drive-album-sync-v3.1.0` / 리뷰 대상 `3cbdc45a9` (작업 트리는 리뷰 중 R2로 이동 — N4) |
| Commits reviewed | `791c48ea4..3cbdc45a9` (1 commit) |
| Report | ../report/google-drive-wave11b-move-history-20260930-2300-report.md |
| Reviewed | 2026-09-30 |

## Verdict

**NOT BLOCKED.** 설계의 핵심 전제 — `StorageCore.moveFile`이 move 행 생성 → rename → asset 행 갱신 → move 행 삭제
순서로 동작하고, 그래서 asset 행이 stale한 창 전체에 move 행이 살아 있다 — 는 `storage.core.ts:229-269`에서 그대로
확인했고, 새 테스트 여섯 개(V1a–V1f)는 각각 주장한 이유로 빨간불이 난다(내가 스크래치 워크트리에서 다섯 가지 변이를
직접 돌렸다; 폴백 전체를 지우면 새 테스트 전부가 죽는다). 가장 중요한 문제는 M1이다: move 행 분기가 **첫 read의
오류 종류를 가리지 않아서**, 크로스 디바이스 복사(EXDEV) 경로에서 첫 read가 ENOENT가 아닌 일시 오류(EMFILE·EIO)로
실패한 순간에는 `newPath`가 아직 채워지는 중인 파일일 수 있고, 업로드 크기 검사는 열 때 stat한 길이와 비교하므로
그 부분 파일을 "성공"으로 원장에 기록한다. 두 가지 드문 조건이 겹쳐야 하고 운영이 EXDEV인지도 확인하지 못했지만,
결과가 되돌릴 수 없는 종류이고 고치는 데 한 줄이면 되므로 Medium으로 둔다. R3의 F6까지 미룰 이유가 없다.

### Evidence I ran myself

리뷰 중 작업 트리가 R2 작업으로 움직이고 있어서(N4), `3cbdc45a9`를 스크래치패드에 `git worktree add --detach`로
따로 체크아웃하고 `node_modules`를 심링크해 거기서 돌렸다. 워크트리는 리뷰 끝에 `git worktree remove`로 지웠다.

| Check | Result |
|---|---|
| `git show 3cbdc45a9 --stat` | 6 files, +240/−47 — 리포트 표와 일치 (plan 문서 포함) |
| `storage.core.ts` 인용 줄 (`3cbdc45a9`) | `194 moveFile`, `202 getByEntity`, `203 if (move)`, `227 update`, `229 create`, `268 savePath`, `269 delete` — 리포트의 `229-269` / `203-227` 정확 |
| 워크트리 `vitest` 두 스펙 | `google-drive.service.spec.ts` 116 / `storage-template.service.spec.ts` 33 — 149 passed |
| 워크트리 `vitest` 전체 (`--config test/vitest.config.mjs`) | 94 files, **2447 passed / 2 skipped** — 리포트와 일치 |
| 워크트리 `tsc --noEmit -p tsconfig.json` | exit 0 |
| 워크트리 `eslint` 변경 5파일 `--max-warnings 0` | exit 0 |
| 변이 M-a: move 행 분기 `if (false && move)` | red 2: "read the move row destination…", "name both paths…" (리포트와 동일) |
| 변이 M-b: `oldPath` 가드 제거 | red 1: "ignore a move row whose oldPath…" (리포트와 동일) |
| 변이 M-c: 두 번째 행 재조회 삭제 | red 2: "find the new path on a second row read…" **+ "should not retry when neither…"** (리포트는 1개만 적음 — N3) |
| 변이 M-d: `findMovedOriginal`이 즉시 `undefined` (폴백 전체 삭제) | red 7: 새 테스트 4 + 이름 바꾼 테스트 + 기존 "retry once…" + "report the path it actually failed on" — **폴백을 지워도 통과하는 새 테스트는 없다** |
| 변이 M-e: `storage.core.ts`에서 `savePath`를 rename 앞으로 | red 6: 순서 핀 + 업스트림 5개 (리포트는 핀만 적음 — N3) |
| `dev-test/google-drive/results/20260930-2255.txt` | server 320/320, web 87/87, medium 65/65, `RESULT: PASS` — 리포트 표와 일치. 헤더는 `+ UNCOMMITTED CHANGES`만 있고 목록 없음 |
| M1 주석 근거 | `config.repository.ts:290 removeOnFail: false` ✓, `event.repository.ts:247 await handler(...event.args)` try/catch 없음 ✓, `job.service.ts:85-99 onJobRun` catch가 `JobError` emit 후 rethrow 안 함 ✓ |
| `move_history` UNIQUE (`entityId`, `pathType`) | `1744910873969-InitialMigration.ts:412` — `getByEntity`는 최대 1행 |
| `git status --porcelain` (리뷰 파일 작성 후) | 아래 "What I did not verify" 끝에 기록 |

## Findings

### M1 — move 행 분기가 첫 read 오류의 종류를 가리지 않아 EXDEV 복사 경로에서 부분 파일을 읽을 수 있다 (Medium)

`google-drive.service.ts:1503`의 `catch (error)`는 어떤 오류든 `findMovedOriginal`로 간다(리포트도 "unchanged from
before"라고 인정). 세 분기 중 asset 행 분기 둘은 오류 종류와 무관하게 안전하다 — `savePath`(`storage.core.ts:268`)는
rename 또는 copy·verify·unlink가 **모두 끝난 뒤**에만 실행되므로, 행이 새 경로를 말하면 그 경로의 파일은 완성돼 있다.
문제는 `1558-1561`의 move 행 분기다. 리포트의 안전 논증("EXDEV 경로는 검증 후에만 source를 unlink하므로 source의
ENOENT는 복사 완료를 뜻한다")은 **첫 오류가 ENOENT일 때만** 성립한다. `storage.core.ts:248 copyFile` → `250 verify`
→ `258 unlink` 사이, 즉 복사가 진행 중인 동안 source는 멀쩡히 존재하고 move 행도 존재한다. 그 순간 우리의
`createReadStream(source)`가 EMFILE(디스크립터 고갈 — 큐 워커 여러 개가 동시에 스트림을 열 때 가능)이나 EIO로
실패하면, `fresh.originalPath === asset.originalPath`(행은 아직 stale) → move 행 있음, `oldPath` 일치 → `newPath`를
연다. `fs.copyFile`은 원자성을 보장하지 않으므로(대상 파일이 직접 채워진다) 그 파일은 부분본일 수 있다.

크기 검사가 이를 잡지 못한다: `storage.repository.ts:122-129 createReadStream`은 열 때 `fs.stat`한 `size`를
`length`로 돌려주고, `google-drive.service.ts:1360`은 `uploadedSize !== streamInfo.length`로 비교한다. 부분본을
열면 `length`도 부분 크기이고 Drive도 그만큼 받으므로 **일치**한다. 이후 `recordUpload`가 원장에 적고, 다음 sync는
스킵한다 — §8이 말하는 "되돌릴 수 없는" 종류다. (스트림이 초기 EOF를 지나 더 읽어 Drive 크기가 커지면 mismatch로
잡히지만, 그것은 복사 속도에 달린 우연이지 방어가 아니다.)

전제 두 가지: ① 업로드 폴더와 라이브러리가 다른 파일시스템(EXDEV) — 운영 랩탑에서 `/data/upload`와 `/data/library`가
같은 볼륨인지 **[미확인]**, 같은 볼륨이면 rename 경로라 이 창이 없다; ② 그 순간의 non-ENOENT 오류. 둘 다 드물지만
한 줄로 닫힌다:

```ts
// openOriginal catch 안
const code = (error as NodeJS.ErrnoException)?.code;
const movedTo = await this.findMovedOriginal(asset, code === 'ENOENT');
// findMovedOriginal(asset, trustMoveRow): move 행 분기를 trustMoveRow일 때만 탄다.
// asset 행 분기 둘은 오류 종류와 무관하게 안전하므로 그대로 둔다.
```

이렇게 하면 R3의 F6(EACCES/EIO를 재시도 가능 `source_unreadable`로)과도 자연스럽게 이어진다 — F6은 분류를 바꾸는
일이고, 이것은 "복사 중인 파일을 읽지 않는다"는 별개의 안전 조건이다. 테스트는 V1a의 변형 하나면 된다: 첫 read를
`EMFILE`로 거부하고 move 행을 준비했을 때 `createReadStream`이 `movedPath`로 **호출되지 않고** skip하는지(호출 횟수 1,
detail에 옛 경로). 가드 제거 변이가 red가 되는지 확인할 것.

리포트의 질문 4("R1이 이미 나눠야 하는가")에 대한 답: **move 행 분기에 한해서는 그렇다.**

### N1 — 복구 분기의 창에서는 가드가 정당한 이동을 거부한다. 결과는 스킵이라 수용 가능하지만 주석의 "exactly that window"·"heals a mover that died"는 과하다 (Minor, 주석 문구)

리포트 질문 1·3이 정확히 이 지점이다. 이전 mover가 rename(A→B) 뒤 `savePath` 전에 죽었다고 하자: asset 행 = A,
move 행 = A→B, 파일은 B. 이 상태에서는 폴백이 잘 동작한다(가드 통과, B를 읽는다 — 커밋 메시지의 "heals" 주장은
**여기까지만** 참이다). 그런데 누군가 Storage Migration을 다시 돌리면 `storage.core.ts:203-227`이 파일을 B에서
찾아 `moveRepository.update(move.id, { oldPath: B, newPath: C })`(227)로 **`oldPath`를 B로 재작성**한다. 그 순간부터
`savePath(C)`(268)까지의 창에서는: 첫 read A 실패 → `fresh` = A(stale) → move 행 `oldPath` = B ≠ A → **가드가 거부**
→ `again` = A → `source_unreadable` 스킵. 파일은 B(또는 rename 뒤 C)에 멀쩡히 있는데 찾지 못한다. 리포트 질문 1의
"file has left oldPath, move row does not name it, asset row still stale"이 성립하는 경로가 **있다** — 단 fresh
move가 아니라 recovery 경로에서, 그리고 그 안에서도 update 이후의 짧은 창에서만.

수용 가능한 이유: 결과는 스킵 + `source_unreadable` 행이고, `streamPendingUploads`(`google-drive.repository.ts:582-618`)는
원장 행과 `GOOGLE_DRIVE_BLOCKING_ERROR_CLASSES`만 제외하므로 다음 queue-all·수동 sync(R3 뒤엔 야간 backfill)가
재큐한다. 잘못된 파일을 읽는 방향의 실수는 아니다. 가드를 빼는 것보다 이쪽이 낫다는 판단(잘못된 파일 = 되돌릴 수
없음, 스킵 = 자가 치유)에 동의한다. 다만 `1471-1484` 주석과 커밋 메시지의 두 문장은 고쳐야 한다: "covers exactly
that window"는 "fresh move의 창을 덮는다; 복구 실행의 `update`~`savePath` 사이는 가드가 일부러 거부하며 그 비용은
재시도 가능한 스킵이다"로, "heals a mover that died"는 "…until a migration re-run picks it up"으로.

대안으로 검토했지만 권하지 않는 것: `databaseRepository.withLock(DatabaseLock.StorageTemplateMigration, …)` 안에서
행을 재조회하면 mover가 끝난 뒤의 행을 읽는 것이 **보장**되어 move 행 조회·두 번째 재조회·이 창·M1이 전부 사라진다.
`moveAsset`(`storage-template.service.ts:222`)이 asset 하나마다 이 락을 잡았다 놓으므로 대기는 한 파일의 이동
시간이다 — 보통 ms이지만 EXDEV에서 7 GB 비디오면 분 단위이고, 그 동안 큐 워커 하나를 잡는다. 주석이 거부한
"sleep and poll"과 같은 비용이라 현재 설계가 맞다. 계획서에 "검토 후 기각"으로 남겨 두면 다음 라운드가 다시
발견하지 않는다.

### N2 — 계획서와 `CLAUDE.md`가 이제 존재하는 가드를 "검증하지 않는다"로 여전히 적고 있다 (Minor, 문서)

`stabilization-plan.md:128-130` "A stale `move_history` row … F1 would read it; the Drive size check is the only
guard. Accepted, noted."와 `CLAUDE.md:721-722` "오래된 move 행이 다른 파일을 가리키는 경우(Drive 크기 검사만이
방어)"는 이 커밋으로 틀렸다 — `1559`의 `oldPath` 가드가 있고 V1e가 그것을 테스트한다. 같은 계획서의 "R1 deviations"
(`:111-116`)는 올바르게 "now tested, not just noted"라고 쓰면서 "Not verified" 절은 안 고쳤다. 또 계획서 task 2
(`:108`)는 "V1a–V1c (+ stale-row guard, second re-read)"인데 `CLAUDE.md` 표는 V1a–V1f로 ID를 부여했다 — 한쪽으로
맞출 것. §2 "문서가 코드와 어긋나면 문서를 고친다".

### N3 — 변이 표가 빨간불을 적게 적었다 (nit, 리포트 정확성)

M-c(두 번째 재조회 삭제)는 V1f뿐 아니라 이름 바꾼 테스트("should not retry when neither…")도 죽인다 — 그 테스트의
`getById` 3회 witness가 잡는다. M-e(`savePath` 이동)는 핀 외에 업스트림 테스트 5개도 죽인다("should not update the
database if the move fails" 등 — savePath가 먼저 실행되면 실패한 이동에도 행이 갱신되므로 당연하다). 둘 다 리포트
주장을 **강화**하는 방향이라 판정에는 영향이 없지만, 변이 표는 "red가 된 것 전부"를 적어야 다음 리뷰어가 같은
실행을 재현했을 때 차이에 놀라지 않는다.

### N4 — 리뷰 중 작업 트리가 다시 움직였다 (nit, 프로세스 — wave11a N4 재발)

리뷰 시작 시 `git status --porcelain`은 ` M mise.lock`과 ` M server/src/services/google-drive.service.ts`였고, 리뷰
중 `google-drive.service.spec.ts`(23:05:49), `google-drive.service.ts`(23:06:40), `utils/google-drive.ts`,
`utils/google-drive.spec.ts`가 추가로 잡혔다 — 내용은 R2(`UPLOAD_IDLE_TIMEOUT_MS`, `retry: false`, `abortError`)다.
그래서 이 리뷰의 모든 실행은 스크래치 워크트리에서 했다(위 표). 리포트가 "uncommitted: docs only"라고 쓴 22:55
시점은 **[추론] 맞았을 것**이지만 `results/20260930-2255.txt:3`은 여전히 `+ UNCOMMITTED CHANGES`만 찍고 목록이
없다 — wave11a N4가 제안한 `run.sh` 헤더의 `git status --porcelain` 블록은 아직 들어가지 않았다. 리뷰가 돌아올
때까지 코드 파일을 건드리지 않는 원칙(§2)도 그대로다.

## Answers to what the report asked me to attack

### 1. The window claim — 파일이 `oldPath`를 떠났는데 move 행이 그 경로를 말하지 않고 asset 행도 stale한 mover 경로가 있는가?

**있다, 복구 분기에서.** N1에 자세히 적었다: `storage.core.ts:227 update`가 `oldPath`를 실제 위치로 재작성한 뒤
`268 savePath`까지. fresh move 경로(`229 create` → `242 rename` → `268 savePath` → `269 delete`)에서는 없다 —
`create`가 `oldPath = asset.originalPath`로 행을 만들고 그 값은 `savePath`까지 변하지 않는다. `EncodedVideo`·sidecar·
motion photo: 폴백은 `AssetPathType.Original`만 묻고(`1558`) 읽는 것도 `originalPath`뿐이라 다른 pathType은 무관하다.
motion photo의 비디오는 별개 asset으로 `moveAsset`(`storage-template.service.ts:193-201`)을 따로 타므로 자기 행·자기
move 행을 가진다. 문제 없다. 그 외 조기 return들(`231 Missing asset info`, `246 rename 비-EXDEV 오류`, `253 verify
실패`)은 모두 파일을 `oldPath`에 남기므로 창이 아니다.

### 2. Reading `newPath` mid-move — 부분 파일을 열 수 있는 순간이 있는가?

**첫 오류가 ENOENT면 없고, 아니면 있다** — M1. rename 경로는 원자적이라 어느 경우든 안전하다. EXDEV 경로는 리포트가
스스로 지적한 조건("unless the first read failed for another reason")이 정확히 구멍이다. 크기 검사가 잡지 못하는
이유는 `length`가 열 때의 stat이기 때문(`storage.repository.ts:123`).

### 3. The `oldPath` guard — 정당한 in-flight 이동을 거부하는가?

**복구 분기의 창에서는 거부한다** (N1). 비용은 재시도 가능한 스킵이고, 가드가 막는 반대편(다른 파일을 원장에 잘못
기록)은 되돌릴 수 없으므로 **가드를 유지하는 것이 맞다.** 가드가 지키는 시나리오가 실제로 성립하는지도 짚어 둔다:
`UQ_newPath`(`InitialMigration.ts:411`) 때문에 다른 move 행이 같은 `newPath`를 가질 수는 없지만, 죽은 이동의 행
X→Y가 남고 Y에 파일이 없으면 다른 asset이 템플릿 충돌 해소로 Y에 놓일 수 있다. 그 뒤 첫 asset의 read가 실패하면
가드 없는 폴백은 Y(다른 사진)를 올린다. 억지스럽지만 가능하고, 가드는 공짜다.

### 4. Error kind — 첫 read가 EACCES인데 move 행이 있으면 `newPath`를 읽는 것이 틀릴 수 있는가?

**EXDEV 복사 중이면 틀리다** (M1). EACCES 자체는 mover와 같은 uid라 mover의 `copyFile`도 실패했을 것이므로 덜
현실적이고, 진짜 위험은 EMFILE·EIO다. **R1에서 move 행 분기만 ENOENT로 게이트하라.** asset 행 분기는 그대로.

### 5. Tests — 각 테스트가 주장한 이유로 실패하는가? 폴백을 지워도 통과하는 테스트가 있는가?

전부 그렇고, **없다.** 위 표의 M-a~M-e를 직접 돌렸다. V1a–V1f 대응:

| ID | 테스트 | 내가 확인한 red 조건 |
|---|---|---|
| V1a | "should read the move row destination and upload without recording a failure" | M-a, M-d |
| V1b | "should not retry when neither the row nor a move row says the file moved" | M-c, M-d (`getById` 3회 witness) |
| V1c | "should name both paths when the move row destination is unreadable too" | M-a, M-d; 옛 경로 누락은 `toContain(asset.originalPath)`로 잡힘 (검사로 확인, 변이는 안 함) |
| V1d | storage-template "…in that order" | M-e |
| V1e | "should ignore a move row whose oldPath is not the path that failed" | M-b, M-d |
| V1f | "should find the new path on a second row read when the mover finished in between" | M-c, M-d |

V1e가 공허하지 않은 이유도 확인했다: `AssetFactory` 는 `originalPath: /data/library/<name>`(`asset.factory.ts:68`)를
실제 문자열로 주고 `getForAsset`(`test/mappers.ts:95`)은 스프레드라 보존한다 — 가드 비교가 `undefined === undefined`로
우연히 참이 되는 경우는 없다. 가드를 빼면 `createReadStream`이 2회 호출되어 `toHaveBeenCalledTimes(1)`과
`not.toHaveBeenCalledWith(movedPath)`가 죽는다 — 의도한 이유다.

V1d는 `mocks.move.getByEntity`가 automock 기본값 `undefined`라 `create` 분기만 탄다 — 리포트가 "복구 분기와 EXDEV는
안 덮었다"고 적은 그대로다. `invocationCallOrder[0]`에 `undefined` 방어가 있어 단계 누락도 잡는다.

### 6. 이름 바꾼 테스트의 witness 2→3

**계약 변경이 맞다.** 세 번은 gate의 `getById`(`1224`), `findMovedOriginal`의 `fresh`(`1550`), `again`(`1563`)이고,
그 사이에 `getByEntity`(`1558`)가 한 번 — 테스트가 넷 다 단언한다. M-c에서 이 테스트가 죽는 것이 witness가 살아
있다는 증거다. 다만 M1의 수정을 넣으면 이 테스트의 첫 오류가 ENOENT여야 move 행 조회가 일어나므로(지금도 ENOENT라
그대로 통과) 그 전제를 주석에 한 줄 적어 두면 좋다.

## What I did not verify

- **운영 랩탑의 `/data/upload`와 `/data/library`가 같은 파일시스템인지** — M1의 도달 가능성을 결정하지만 운영에
  접속하지 않았다. `ssh 랩탑 'df /path/to/upload /path/to/library'` 한 번이면 답이 나온다.
- 실제 파일시스템에서의 동시 이동 — 리포트와 같이 mock 순서로만 재현. 배포 후 `(found via move_history)` 로그 관찰이
  유일한 실 검증이라는 리포트의 말에 동의한다.
- M2 주석의 운영 수치(983건 > 5 MB, 최대 7.2 GB) — 운영 원장을 읽어야 하고 이 리뷰는 코드만 봤다.
- V1c의 "옛 경로 누락" 변이 — 메시지 문자열을 바꾸는 변이는 돌리지 않았고 단언을 눈으로 확인했다.
- medium 65/65 — 결과 파일만 읽었고 DB가 필요한 스위트라 다시 돌리지 않았다.
- `fs.copyFile`의 비원자성은 Node 문서의 명시("no guarantees … about the atomicity of the copy operation")에
  기댔고 이 환경에서 실측하지는 않았다 **[추론]**.
- 이 리뷰 파일 작성 후 `git status --porcelain`: ` M mise.lock`, ` M server/src/services/google-drive.service.ts`,
  ` M server/src/services/google-drive.service.spec.ts`, ` M server/src/utils/google-drive.ts`,
  ` M server/src/utils/google-drive.spec.ts`(넷 다 리뷰 시작 전 또는 리뷰 중 작성자 세션의 R2 작업 — N4), 그리고
  `?? dev-docs/review/google-drive/review/google-drive-wave11b-move-history-20260930-2300-review.md`(이 파일). 내가
  만든 변경은 이 파일뿐이다. 스크래치 워크트리는 `git worktree remove --force` + `prune`으로 지웠고
  `git worktree list`에 메인 트리만 남았다.

## Feeding back into the plan

1. **F1에 조건 하나 추가**: move 행 분기는 첫 read 오류가 ENOENT일 때만 (M1). F6(R3)의 "ENOENT keeps F1 logic"
   문구를 "F1's move-row branch is ENOENT-only since R1"로 바꿔 두 라운드가 같은 말을 하게 한다. 검증: V1a 변형
   (EMFILE + move 행 → skip, `createReadStream` 1회) — 가드 제거 시 red.
2. **"Not verified" 절 갱신** (N2): stale move 행은 이제 `oldPath` 가드 + V1e가 덮는다. 남는 미검증은 "복구 분기의
   `update`~`savePath` 창에서 가드가 거부하여 스킵" (N1) — 수용 근거를 함께 적는다.
3. **기각한 대안 기록**: `withLock(StorageTemplateMigration)` 안에서 재조회 — 모든 창을 닫지만 EXDEV 대용량에서 워커를
   분 단위로 잡는다. 다음 사람이 같은 것을 다시 제안하지 않도록.
4. **`CLAUDE.md` 표와 계획서 task list의 V-ID 통일** (N2).
5. **`run.sh` 헤더에 `git status --porcelain` 블록** (wave11a N4, 아직 미반영 — 이번에도 같은 질문이 생겼다).
6. 배포 후 관찰 항목에 하나 추가: `(found via move_history)`가 찍힌 asset의 Drive 크기와 `exif.fileSizeInByte`를 한 번
   대조한다 — M1이 실제로 발화했는지 보는 유일한 사후 검사다.
