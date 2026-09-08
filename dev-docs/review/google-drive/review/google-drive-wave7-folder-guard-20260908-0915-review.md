# Code Review — 폴더 이름 쓰기 가드(H1), 재시도 근거 정정, 1시간 backoff

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `2a3c2a9e5` |
| Commits reviewed | `fc1822662`, `8675105e4`, `2a3c2a9e5` (`git log --oneline 6aba7b292..2a3c2a9e5` = 3, 그중 `2a3c2a9e5`는 리포트 자신) |
| Report | `../report/google-drive-wave7-folder-guard-20260908-0915-report.md` |
| Prior review | `./google-drive-wave7-move-race-20260905-1900-review.md` (H1을 제기한 라운드) |
| Reviewed | 2026-09-08 |

## Verdict

**H1 수정은 옳고, 리포트가 답을 구한 "가드 네 개로 충분한가"의 답은 확정적으로 "충분하다"이다
— `connectionId`는 이 쓰기에 불필요하다.** `upsertCredentials`의 유일한 호출자는
`linkAccount`(`google-drive.service.ts:379`) 하나이고, 그 메서드는 Google이 refresh token을
돌려주지 않으면 **거기서 던진다**(`:354-356`). `getAuthUrl`은 매번 `prompt: 'consent'`를 보내고
(`:227`), 스키마의 `refreshToken`은 NOT NULL이다(`user-google-drive.table.ts:35`). 그러므로
"토큰을 그대로 두고 재링크하는 경로"는 존재하지 않는다. 설령 구글이 **같은 토큰 문자열**을 다시
발급하는 가상의 경우라도, 같은 refresh token은 같은 구글 계정을 뜻하므로 폴더 가드가 함께 걸려 있는
한 그때 쓰는 이름은 **여전히 맞는 이름**이다. 게다가 `fillFolderName`은 `folderId`를 아예 쓰지
않으므로, pick-folder / re-link / backfill을 어떤 순서로 섞어도 **잘못된 폴더가 행에 남는 배열은
만들 수 없다**. 남는 유일한 오염은 Drive 쪽 폴더 이름 변경뿐이고 그건 표시 전용이다(N4).

**이 라운드에서 가장 중요한 문제는 §5의 두 테스트 중 하나가 여전히 공허하다는 것이다(C1).**
리포트는 "둘 다 관측 지점을 추가했다"고 적었지만, `should not retry when the asset disappeared
during the window`는 **`!fresh` 가드를 지워도 93개가 전부 통과한다**. 새로 넣은 단언
`expect.stringContaining(asset.originalPath)`가 두 세계를 구분하지 못하기 때문이다 —
`google-drive.service.ts:1106-1107`이 `GoogleDriveSourceUnreadableError`가 **아닌** 에러에 대해
`asset.originalPath`로 폴백하므로, TypeError가 나도 기록되는 detail은 글자 하나까지 같다.
스펙 주석(`:526-527`)의 *"a TypeError would carry no path at all"* 이 사실과 다르다. 실제 인자를
찍어서 증명했다(아래 M-A). 나머지 하나(`should not retry when the path has not changed`)는
**진짜로 고쳐졌다** — 재시도를 통째로 지우면 이제 죽는다(M-B).

**리포트 §6의 변이표 4줄은 이 HEAD에서 전부, 그리고 각각 정확히 하나씩 재현된다.** 테스트 수치도
전부 일치한다(server unit 274, medium 60). 배포를 **막는 것은 없다.**

### Evidence I ran myself

전부 이 워크트리 HEAD(`2a3c2a9e5`)에서 돌렸다. 변이는 원본을 스크래치패드에 복사해 두고 **줄 번호로**
치환한 뒤 매 실행마다 복원했고, 마지막에 `git status --porcelain`이 비어 있음을 확인했다.

| Check | Result |
|---|---|
| server unit — `run.sh`의 8스펙 | `Test Files 8 passed / Tests 274 passed (274)` — **리포트의 274와 일치** |
| server unit — 전체 스위트 (`--config test/vitest.config.mjs`) | `Test Files 94 passed / Tests 2384 passed \| 2 skipped (2386)` — 직전 라운드 2383 대비 **+1**(새 backoff 테스트), 회귀 0 |
| `google-drive.service.spec.ts` + `utils/google-drive.spec.ts` | `Tests 109 passed (109)` (서비스 93 / 유틸 16) |
| server medium (실 DB, `immich_postgres`) | `Test Files 1 passed / Tests 60 passed (60)` — **리포트의 60과 일치** |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx eslint`(service·repository·utils·두 스펙) `--max-warnings 0` | exit 0 |
| 생성 SQL 대조 — `server/src/queries/google.drive.repository.sql` | `-- GoogleDriveRepository.fillFolderName` 블록이 `where "userId" = $2 and "refreshToken" = $3 and "folderId" = $4 and "folderName" is null` — 코드의 가드 네 개와 **정확히 일치** |
| `git merge-base --is-ancestor v3.1.0 HEAD` | **ancestor 맞음** — 업스트림 다운그레이드 아님 |
| `git diff --name-only 6aba7b292..2a3c2a9e5` | 9개 파일, **`server/src/schema/` 와 마이그레이션·web·i18n 변경 0** |
| 첨부 증거 `results/20260908-0911.txt` | `commit: fc1822662`, **dirty 마커 없음**, 274 / 39 / 60, `RESULT: PASS` — 주장대로 |
| `git status --porcelain` (종료 시) | **이 리뷰 파일 하나뿐** |

**변이 전수.** R1~R4는 리포트 §6이 주장한 것(medium 60 기준, 무변이 = 60 passed),
M-A~M-D는 내가 추가한 것(`google-drive.service.spec.ts` 단독, 무변이 = 93 passed)이다.

| # | 변이 (파일:줄) | 방향 | 결과 | 리포트 주장 |
|---|---|---|---|---|
| R1 | `google-drive.repository.ts:264` `.where('userId', …)` 삭제 | 사용자 가드 제거 | **`1 failed \| 59 passed`** — `should not name another user's folder` | 1 failed ✔ |
| R2 | 〃 `:265` `.where('refreshToken', …)` 삭제 | 토큰 가드 제거 | **`1 failed \| 59 passed`** — `should do nothing when only the token changed` | 1 failed ✔ |
| R3 | 〃 `:266` `.where('folderId', …)` 삭제 | 폴더 가드 제거 | **`1 failed \| 59 passed`** — `should do nothing when the user changed folders during the lookup` | 1 failed ✔ |
| R4 | 〃 `:267` `.where('folderName','is',null)` 삭제 | 이름-null 가드 제거 | **`1 failed \| 59 passed`** — `should not overwrite a name that arrived first` | 1 failed ✔ |
| M-A | `google-drive.service.ts:1327` → `if (fresh && fresh.originalPath === asset.originalPath) {` | `!fresh` 가드 제거 | **`93 passed`** — 아무도 안 죽는다 (**§C1**) | §5가 고쳤다고 주장 ✘ |
| M-B | 〃 `:1326-1359`(catch 본문) → 재읽기·재시도 없이 즉시 throw | 재시도 통째로 제거 | **`3 failed \| 90 passed`** — `should retry once…`, **`should not retry when the path has not changed`**, `should report the path it actually failed on…` | §5가 고쳤다고 주장 ✔ |
| M-C | 〃 `:670-678`(1시간 backoff 블록) 삭제 | backoff 제거 | **`1 failed \| 92 passed`** — `should back off an hour after a folder it cannot name` | (없음) 가드는 잡힌다 |
| M-D | 〃 `:741` `3_600_000` → `3_600_000_000` | 1시간 → **사실상 영구 포기** | **`93 passed`** — 아무도 안 죽는다 (**§N3**) | (없음) |

**C1의 결정적 증거.** M-A 상태에서 `upsertError`의 실제 인자를 강제로 출력시켰다:

```
[ "5ce5912a-…", "459c0410-…", "source_unreadable",
  "Could not read /data/library/IMG_459c0410-….jpg" ]
```

가드가 있을 때와 **문자열이 동일**하다. `!fresh`를 지우면 `:1341`의 `${fresh.originalPath}`가
TypeError를 던지지만, 그 TypeError는 `:1102`의 catch로 흘러가고 `:1106-1107`이
`error instanceof GoogleDriveSourceUnreadableError ? … : asset.originalPath` 로 **같은 경로를
복원**해 준다. 그래서 detail을 보는 단언으로는 영원히 구분할 수 없다.

---

## Findings

배포를 막는 것은 없다. C1은 테스트 신뢰도 문제라 배포 전에 고치는 것이 싸다(한 줄).
N1~N4는 다음 라운드, 나머지는 여유가 있을 때.

### C1 (High — 테스트 무결성) — `should not retry when the asset disappeared during the window`는 아직도 공허하다

**증거.** `google-drive.service.ts:1327`을 `if (fresh && fresh.originalPath === asset.originalPath)`로
바꿔 `!fresh` 가드를 제거해도 `Tests 93 passed (93)`. 해당 테스트만 단독 실행해도 통과한다.
원인은 위에 인용한 `:1106-1107`의 폴백이고, 스펙 `:526-527`의 근거

```ts
// The path reported is the one that was actually tried — a TypeError would carry no path
// at all, and its message would name a property rather than a file.
```

가 사실과 다르다. TypeError는 경로를 **가지고 있지 않지만**, 기록하는 쪽이 `asset.originalPath`로
채워 준다. 하루 전에 고쳤다고 적은 공허성이 같은 자리에 남아 있는 셈이다.

**구체적 수정 (한 줄, 실측으로 검증했다).** 두 세계가 실제로 갈리는 지점은 `:1108`의 로그 문구다
— 가드가 있으면 `${error}`가 `GoogleDriveSourceUnreadableError: Could not read …: Error: ENOENT`,
없으면 `TypeError: Cannot read properties of undefined`. 그래서 스펙 `:533` 뒤에 한 줄:

```ts
expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
```

- 무변이 HEAD: `Tests 1 passed | 92 skipped` ✔
- M-A(`!fresh` 제거): `AssertionError: expected "spy" to be called with arguments: [ StringContaining "ENOENT" ]` → `1 failed` ✔

즉 이 한 줄이 정확히 그 가드 하나를 붙든다. (`mocks.logger`는 `test/utils.ts:339`에
`automock(LoggingRepository)`로 이미 있다 — 새 mock 기본값을 넣을 필요가 없다.)

### N1 (Medium) — "복구는 수동 동기화"라는 새 근거도 틀렸다. 세 번째 잘못된 근거다

**증거.** `google-drive.service.ts:1310-1311`:

```
 * and no retry happens. That is deliberate: … Recovery there is a manual
 * sync, which is what the settings page already tells the user.
```

mover가 rename과 경로 쓰기 사이에서 죽으면 행은 **옛 경로를 그대로 들고 있다**. 그 상태에서 Drive
동기화를 다시 돌리면 `openOriginal`이 같은 옛 경로를 읽고 → 실패 → 재읽기가 같은 값을 돌려주고 →
재시도 없이 다시 `source_unreadable`. **수동 동기화는 이 상태를 복구하지 못한다.** 몇 번을 눌러도
같다.

실제 복구 경로는 immich 자신에게 있다. `storage.core.ts:229`가 rename **전에** `move_history` 행을
만들고 `:269`에서 `savePath` 뒤에 지우므로, 중간에 죽으면 그 행이 남는다. 다음번 `moveFile`이
`:203-227`에서 *"Attempting to finish incomplete move"*로 그 행을 집어 새 위치를 확인하고
`:268`에서 경로를 저장한다. 즉 **Storage Migration 잡이 다시 돌면** 자동으로 낫는다.

따라서 주석은 "recovery there is a manual sync"가 아니라 "recovery there is immich's own
incomplete-move recovery (`storage.core.ts:203-227`), which a Storage Migration run performs;
a Drive sync cannot fix it because the row still names the old path"여야 한다.

**리포트 §3의 공격 요청에 대한 판단은 §"Answers"에 적었다.** 요약하면 문구도, 자동 재큐잉도
이 창을 못 고치므로 **둘 다 만들지 말아야 한다.** 배포를 막지 않는다.

### N2 (Medium) — 1시간 backoff의 키가 폴더 단위가 아니라 사용자 단위다

**증거.** `google-drive.service.ts:668`과 `:672-677`이 쓰는 키는 `` `folder:${userId}` `` 하나이고,
`GoogleDriveService#setFolderId`(`:591-604`)는 이 맵을 **건드리지 않는다**. 그러므로:

1. 사용자가 `drive.file` 밖의 id를 손으로 붙여넣는다 → 이름 조회 실패 → **1시간** 잠금
2. 곧바로 올바른 폴더 id를 붙여넣는다 (`folderName`은 여전히 `null` — `:200-201` 경로)
3. 설정 화면은 **최대 1시간 동안 원시 id를 그대로 보여준다**. 조회가 성공할 수 있는데도 시도조차 않는다

1분 쿨다운이던 시절에는 이 구멍이 사실상 보이지 않았다. 1시간으로 늘리면서 눈에 띄는 크기가 됐다.

**구체적 수정 (둘 중 하나).**
- 키를 폴더까지 포함시킨다: `` `folder:${userId}:${credentials.folderId}` `` — 폴더가 바뀌면 자연히
  새 키가 되어 즉시 한 번 시도한다. 맵 증가는 사용자당 폴더 변경 횟수만큼으로 무해하다.
- 또는 `setFolderId` 안에서 `this.accountProbeAt.delete(`folder:${userId}`)` — 명시적이지만
  "폴더를 골랐다"와 "쿨다운을 지운다"가 떨어져 있어 다음 사람이 놓치기 쉽다.

첫 번째를 권한다.

### N3 (Low) — "1시간"은 하한만 못 박혀 있다. 영구 포기와 구별되지 않는다

**증거.** M-D: `FOLDER_NAME_FAILURE_COOLDOWN_MS`를 `3_600_000` → `3_600_000_000`(약 1,000시간)으로
바꿔도 `Tests 93 passed (93)`. 유일한 테스트 `should back off an hour after a folder it cannot name`
(`spec.ts:1410-1423`)은 `vi.advanceTimersByTime(120_000)` 뒤 호출이 1회임만 본다 — "1분보다 길다"는
말이지 "1시간이다"는 말이 아니다.

리포트 §4가 물은 "영구 포기가 나은가"에 대한 판단은 §"Answers"에 있다(**1시간이 맞다**). 다만
그 결정이 테스트에 **기록되어 있지 않다**는 것이 문제다. 다음 사람이 상수를 만지면 아무도 안 죽는다.

**구체적 수정.** 같은 테스트에 두 줄:

```ts
vi.advanceTimersByTime(3_600_001);
await sut.getStatus(userId);
expect(driveFilesGet).toHaveBeenCalledTimes(2);
```

### N4 (Low) — 커밋이 "detail이 두 경로를 다 적는다"고 하지만, DB에 남는 detail은 한 경로뿐이다

**증거.** 커밋 메시지: *"the recorded detail named only the path that failed … It names both now."*
실제로 두 경로가 들어간 곳은 **예외 메시지**(`:1355`)이고, 그것은 `:1108`의 `logger.warn`에
`(${error})`로 실린다. 반면 `google_drive_upload_error.detail`에 저장되는 값은
`:1112-1117`의 `` `Could not read ${attemptedPath}` `` — **경로 하나뿐**이다.

`detail`은 어떤 DTO/컨트롤러로도 노출되지 않으므로(grep으로 확인) 운영자가 SQL로 읽는 값이다.
그 자리에서 `/data/upload` ↔ `/data/library` 대비를 다시 보려면 로그를 봐야 한다 — 이번 원인을
찾게 해준 그 대비를 "detail에 복원했다"는 서술은 아직 참이 아니다.

**구체적 수정.** 둘 중 하나. (a) `:1116`을 `` `Could not read ${attemptedPath}` `` 대신
`error instanceof GoogleDriveSourceUnreadableError ? error.message.slice(0, 512) : …`처럼 메시지를
쓰게 바꾸거나 — 다만 메시지에는 원인 문자열이 붙어 있어 512자 절단이 경로를 자를 수 있다 —
(b) 커밋/리포트의 서술을 "로그가 두 경로를 다 적는다"로 정정한다. **(b)를 권한다**: `detail`은
`upsertError`가 512자로 자르는 컬럼이고, 진단은 이미 로그 쪽이 더 낫다.

### N5 (Nitpick) — Drive에서 폴더 이름을 바꾸면 표시가 영구히 낡는다

`:668`의 `!folderName` 게이트 때문에 이름이 한 번 채워지면 다시 조회하지 않는다. 사용자가 Drive
웹에서 폴더 이름을 바꾸면 설정 화면은 옛 이름을 계속 보여준다. 표시 전용이고 업로드 경로에는 영향이
없다 — 고칠 값어치보다 "이름을 다시 조회한다"가 만드는 왕복이 더 비싸다. **기록만 해 둔다.**

### N6 (Nitpick) — 가드가 쓰기를 거절해도 그 호출의 응답은 조회한 이름을 그대로 돌려준다

`:669`가 지역 변수 `folderName`에 담고, `:685`의 `fillFolderName`이 아무 행도 못 고쳐도 `:695-703`의
응답은 그 값을 싣는다. 응답 전체가 (folderId도 낡은 값이라) **일관된 낡은 스냅샷**이고 다음 로드에서
정정되므로 해롭지 않다. 굳이 고친다면 `fillFolderName`이 갱신 행 수를 돌려주게 하고 0이면
`credentials.folderName`을 쓰면 된다 — 그만한 값어치는 없어 보인다.

### N7 (Forward-looking) — `refreshToken`이 nullable이 되는 순간 이 가드는 조용히 무력화된다

`CLAUDE.md` §7 배포 절차 10번이 *"`refreshToken` nullable + CAS를 `connectionId`로 옮기는 작업은
배포 후 별도 건"*이라고 예고하고 있다. 그날 `.where('refreshToken', '=', refreshToken)`은
NULL 비교가 되어 **어떤 행도 매치하지 않고**, `fillFolderName`은 에러 없이 영구 no-op이 된다.
같은 함정이 `setDriveAccountId`(`repository.ts:116-121`)와 `adoptUnstampedUploads`
(`repository.ts:167-173`)에도 걸린다. 그 작업을 할 때 **세 곳을 한 번에** `connectionId` CAS로
옮겨야 한다 — 이것이 `connectionId`를 지금 넣을 이유는 아니지만(§Answers 1), **그때는 넣어야 할
이유**다. 계획 문서에 적어 둘 것.

### Nitpick — 검증 불가·경미

- **`disconnect`의 무조건 삭제.** `deleteCredentials`(`repository.ts:280`)는 `userId` 하나로 지운다.
  드레인 읽기와 삭제 사이에 재링크가 착지하면 **새 연결**이 지워진다. 사용자가 직접 누른 동작이고
  이번 라운드가 만든 것이 아니라 지적만 해 둔다.
- **"참조 SQL 427개".** `server/src/queries/`의 `^-- ` 헤더를 세면 **411개**다. 427을 재현하지
  못했다 — 도구가 세는 단위가 다른 것으로 보인다. 실질에는 영향 없지만 리포트에 적는 숫자는
  재현 가능한 방식으로 뽑는 편이 낫다.

---

## Answers to what the report asked me to attack

### 1. 가드 네 개로 충분한가 — `connectionId`도 걸어야 하는가

**충분하다. `connectionId`는 지금 필요 없다.** 추적 결과:

- `upsertCredentials`의 호출자는 **`linkAccount` 단 하나**(`google-drive.service.ts:379`).
  `grep -rn "upsertCredentials" server/src web/src`로 전수 확인했고, 컨트롤러·잡·이벤트 어디에도
  다른 진입점이 없다.
- `linkAccount`는 코드 교환 결과에 `refresh_token`이 없으면 `:354-356`에서 **던진다**. 즉
  `upsertCredentials`에 도달하는 모든 재링크는 정의상 **새로 받은 토큰**을 쓴다.
- `getAuthUrl`은 `prompt: 'consent'`(`:227`)를 보내므로 구글은 매 승인마다 refresh token을 재발급한다.
- 스키마상 `refreshToken`은 NOT NULL(`user-google-drive.table.ts:35`)이라 `=` 비교가 항상 유효하다.

**"같은 토큰 문자열이 재발급되는" 가상의 경우까지 따져도 안전하다.** refresh token은 (client,
Google 계정, grant)에 묶이므로 같은 문자열 = 같은 계정이다. 그러면 폴더 가드가 함께 걸린 상태에서
쓰는 이름은 그 계정·그 폴더의 이름이 맞다. `connectionId`를 추가해도 **막을 사건이 남지 않는다** —
막는 것은 "같은 계정이 재링크했을 뿐인데 쓰기를 거절하는" 경우뿐이고, 그건 이름이 `null`로 남았다가
다음 `getStatus`에서 다시 시도되는 fail-safe다.

**직접 공격한 순서 배열.** `fillFolderName`이 `folderName`만 쓰고 `folderId`는 **건드리지 않으므로**
"잘못된 폴더가 행에 남는" 배열은 원리적으로 만들 수 없다. 이름이 틀리는 배열도 없다:

| 창 안에서 일어난 일 | 결과 |
|---|---|
| 피커로 다른 폴더 G 선택 | 폴더 가드 불일치 → 쓰기 없음. G의 이름은 피커가 이미 저장했다 |
| 같은 폴더 F를 텍스트로 재입력(`folderName`=null) | 네 가드 모두 통과 → F의 이름을 쓴다. **맞는 값이다** |
| 다른 계정으로 재링크 | 토큰 가드 불일치 → 쓰기 없음 |
| 같은 계정으로 재링크 | 토큰 가드 불일치 → 쓰기 없음(fail-safe). 다음 로드에서 다시 조회 |
| 연결 해제 후 재연결 | 행이 지워졌다 새로 생기며 `folderId`가 NULL → 폴더 가드 불일치 |
| 조회~쓰기 사이에 **Drive에서 폴더 이름 변경** | **낡은 이름이 박힌다** — 유일하게 남는 오염. 표시 전용(N5) |

### 2. H1 수정이 완결적인가 — 같은 문제를 가진 다른 호출자는 없는가

**없다.** `user_google_drive`에 쓰는 곳은 다섯 군데뿐이고 전수 확인했다:

| 쓰기 | 스코프 | 낡은 값 위험 |
|---|---|---|
| `upsertCredentials` (`:82-97`) | userId upsert | 값이 방금 받은 토큰이라 낡을 수 없다 |
| `setDriveAccountId` (`:116-121`) | userId + **refreshToken** + `driveAccountId is null` | round-22의 CAS가 막는다 |
| `setFolderId` (`:236-239`) | userId | **값이 요청 본문에서 온다** — 조회 결과가 아니다. 스코프가 사용자 하나인 것이 맞다 |
| `fillFolderName` (`:262-268`) | userId + token + folderId + name null | 이번 수정 |
| `deleteCredentials` (`:280`) | userId | 사용자가 직접 누른 해제. 위 nitpick 참고 |

`setFolderId`의 유일한 호출자는 `google-drive.controller.ts:202`이고, 넘기는 값은 DTO의
`dto.folderId` / `dto.folderName`이다. 서비스가 **읽어 온 값을 되쓰는 경로가 아니다** — 백필이
가졌던 문제와 형태가 다르다. 원장 쪽 `adoptUnstampedUploads`도 이미 트랜잭션 + `forUpdate` +
토큰 재확인을 하고 있다(`:161-177`). **H1은 닫혔다.**

### 3. 무기한 창의 실제 위험도 — 문구를 고칠 것인가, 자동 재큐잉을 만들 것인가

**둘 다 하지 말 것. 대신 N1의 주석을 고칠 것.** 이유는 두 가지다.

**(a) "다음 동기화"는 관리자 전용이 아니다.** 직전 리뷰가 지적한 "유일한 생산자가 관리자 Jobs
화면"은 `GoogleDriveUploadQueueAll`에 대해서만 참이다(`queue.service.ts:249`, 전수 확인).
하지만 사용자가 직접 누를 수 있는 재큐잉 경로가 둘 더 있다:

- **앨범 메뉴의 "Sync album"** → `syncAlbum` → `queueGoogleDriveUploads`
  (`google-drive.service.ts:1537`). 막힌 자산은 정의상 추적 앨범에 있으므로 반드시 걸린다.
  UI는 `GoogleDriveAlbumMenu.svelte:212`의 `google_drive_sync_album`.
- **설정의 "Resume uploads"** → `resumeUploads` → `queuePendingUploads(userId)`
  (`:1611-1618`).

그러므로 `google_drive_failed_count`의 *"They will be retried on the next sync."*
(`i18n/en.json:1195`)는 **절반만 참이 아니라 대체로 참**이다. 문구를 고칠 근거가 약하다.

**(b) 그런데 이 특정 창에서는 재큐잉이 아무것도 고치지 못한다.** N1에서 보인 대로 행이 옛 경로를
들고 있는 한 몇 번을 다시 큐잉해도 같은 실패를 반복한다. 자동 재큐잉을 만들면 **고치지 못하는 일을
자동으로 반복하는 루프**가 생긴다 — 지금의 "한 번 시도하고 pending으로 남긴다"보다 나쁘다.
진짜 복구는 Storage Migration이고, 그건 이미 immich가 가진 잡이다.

**위험도 자체는 낮다.** 필요 조건이 (i) storage-template 잡이 rename과 `savePath` **사이**에서
죽고 (ii) 하필 그 자산이 Drive 큐에 있어야 한다. 실패 시 손실은 사진 한 장이 `pending` +
`source_unreadable`로 남는 것뿐 — 중복 업로드도, 원장 오염도, 계정 차단도 없다. 운영에서 이미 겪은
`source_unreadable` 2건은 이 창이 아니라 원본이 정말로 사라진 케이스였다(`CLAUDE.md` Tasks 2).
**배포를 막지 않는다.**

### 4. 1시간 backoff — 맞는 숫자인가, 영구 포기나 점증이 나은가

**1시간이 맞다. 영구 포기는 틀렸고, 점증은 과설계다.**

- **영구 포기가 틀린 이유**: 실패는 "이 폴더를 이 앱이 못 본다"인데, 그 조건은 사용자가 **재승인
  하거나 피커로 다시 고르면 사라진다**. 그런데 서버에는 그 사건을 알리는 신호가 없다 — 재승인은
  구글 쪽 이벤트이고, 피커 경로는 애초에 이름을 함께 저장하므로 이 코드에 오지 않는다. 포기해 버리면
  **프로세스가 재시작될 때까지** 영원히 원시 id다. 1시간은 "그 사이 상황이 바뀌었을 수 있다"를
  공짜에 가깝게 확인하는 값이다.
- **점증이 과설계인 이유**: 사용자별 실패 횟수라는 상태를 더 들여야 하는데, 얻는 것은 **표시용
  문자열 하나**다. 그리고 상한을 어차피 정해야 하므로(무한 점증은 영구 포기와 같다) 결국 "상한 =
  1시간"과 같은 결정을 더 복잡한 코드로 다시 하는 셈이다.
- **구현은 정확하다.** `Date.now() - 60_000 + 3_600_000`을 맵에 넣고 `probeAllowed`가
  `Date.now() - last < 60_000`로 판정하므로 해제 시점은 정확히 `now + 3_600_000`이다. 미래 시각을
  넣는 관용구가 낯설긴 해도 산술은 맞다(M-C가 그 블록을 지우면 죽는다).
- **다만 두 가지를 손봐야 한다**: 키가 폴더 단위가 아니라는 것(**N2**, 실제 UX 퇴행)과, 1시간이
  테스트에 하한으로만 박혀 있다는 것(**N3**).

또 하나 — 이 backoff는 **계정 프로브(`account:${userId}`)와 완전히 분리돼 있다**
(`spec.ts`의 `should keep the account probe and the folder lookup on separate cooldowns`가 이를
붙든다). 배포 런북의 "1분 뒤 다시 열어 본다"는 계정 식별에 대한 것이므로 **여전히 유효하다.**

### 5. 변이표와 두 공허 테스트

- **§6의 네 줄은 이 HEAD에서 전부 재현된다** (R1~R4). 게다가 각 가드가 죽이는 테스트가 그 가드를
  위해 쓴 테스트와 **정확히 일치**한다 — 리포트가 자랑한 "픽스처 분리"는 실제로 작동한다.
  재링크 테스트(토큰·폴더 동시 이동)는 R2·R3 어느 쪽으로도 죽지 않는데, 그것이 정상이다:
  그 케이스는 두 술어의 합집합이고, 각 술어는 전용 테스트가 따로 붙들고 있다.
- **`should not retry when the path has not changed`는 고쳐졌다** (M-B에서 죽는다). ✔
- **`should not retry when the asset disappeared during the window`는 고쳐지지 않았다** (M-A에서
  살아남는다). ✘ — **C1**.

---

## What I did not verify

- **web 유닛 39개**: 이 워크트리에 `web/node_modules`가 없어 실행하지 못했다. 세 커밋에 web 변경이
  0이므로(위 `git diff --name-only`) 회귀 가능성은 없다고 판단했지만, **돌리지는 않았다.**
- **svelte-check 게이트**: 같은 이유로 실행하지 못했다.
- **CI 런 `34172588226`**: 이 환경에 `gh`가 없고 네트워크 접근도 하지 않았다. "4잡 전부 success"는
  **확인하지 못했다.**
- **마이그레이션 드리프트**: `sql-tools migrations generate`를 돌리지 않았다(파일을 만들 수 있어
  "리뷰 파일 하나만 쓴다"를 어길 수 있다). 대신 세 커밋이 `server/src/schema/`를 **전혀 건드리지
  않았음**을 확인했으므로 직전 라운드의 "No changes detected"가 그대로 유효하다.
- **"참조 SQL 427개"**: 재현하지 못했다(내 카운트는 411). 다만 `fillFolderName`의 생성 SQL이 코드와
  일치하는 것은 직접 대조했다.
- **`mise //server:ci-unit` / `//web:ci-unit` 자체**: 구성 요소(tsc·eslint·server unit)는 따로
  돌렸지만 mise 태스크 그대로는 돌리지 않았다.
- **`fillFolderName`의 운영 동작**: 리포트와 같다 — 실제 Drive 계정으로 확인한 것이 아니다.
- **이동 경합의 실물 재현**: 리포트와 같다 — mock과 코드 독해로만 판정했다. 특히 N1의
  "incomplete move 복구가 실제로 돈다"는 `storage.core.ts:203-227`을 읽어서 내린 결론이고,
  죽인 mover로 재현하지는 않았다.
- **`git status --porcelain`**: 종료 시 **이 리뷰 파일 하나뿐**임을 확인했다. 변이는 전부
  스크래치패드의 원본으로 복원했다.

---

## Deploy verdict

**막히지 않는다 (not blocked).**

근거: 스키마·마이그레이션·web·i18n 변경이 0이고, `v3.1.0`이 HEAD의 조상이며, server unit 2,384개와
medium 60개가 이 HEAD에서 통과한다. C1은 **테스트가 눈이 먼 것**이지 제품 코드가 틀린 것이 아니다 —
`!fresh` 가드는 `:1327`에 정상적으로 존재한다. N1은 주석, N2~N4는 표시·테스트 문제다.

다만 이번 배포는 **폴더 쓰기 경로와 업로드 경로를 둘 다 바꾼다.** 배포 직후 볼 것:

1. **`CLAUDE.md` §7의 하드 게이트를 먼저 통과할 것** — `server.externalDomain`과
   `googleDrive.redirectUrl` 중 최소 하나가 채워진 상태여야 한다. 이번 변경과 무관하지만 순서상
   맨 앞이다. 확인은 `GET /api/server/features`의 `googleDrive` 필드로.
2. **설정 화면을 처음 열었을 때 폴더가 이름으로 보이는가.** 이번 배포에서 폴더 이름 백필이
   `setFolderId` → `fillFolderName`으로 갈아탔다. 정상이면 원시 id가 이름으로 바뀐다. **원시 id가
   그대로면 1분이 아니라 최대 1시간을 기다려야 다시 시도한다**(이전 동작과 다른 점이다). 로그에서
   `Could not read the Google Drive folder name for user …`를 확인하고, 급하면 컨테이너 재시작이
   in-process 맵을 비운다.
3. **`user_google_drive`의 `folderId`가 배포 전후로 바뀌지 않는지.** 이번 수정이 정확히 그것을
   막는 것이므로, 바뀌었다면 가드가 의도대로 안 걸린 것이다.
   ```sql
   select "userId", "folderId", coalesce("folderName", '(unnamed)') as folder_name,
          coalesce("driveAccountId", '(unidentified)') as drive_account
   from user_google_drive;
   ```
4. **계정 식별은 여전히 1분 쿨다운이다.** `drive_account`가 `(unidentified)`면 1분 뒤 다시 열어
   본다 — 폴더 이름의 1시간과 헷갈리지 말 것. 두 쿨다운은 분리되어 있다.
5. **`Original for asset … moved from … while the upload was queued; retrying at …`** 를 로그에서
   찾아본다. 이번에 `debug` → `log`로 올라갔으므로 **이제 기본 레벨에서 보인다.** 이 줄이 보이면
   이동 경합 수정이 실제로 발화한 것이고, 그 자산은 실패로 기록되지 않아야 한다.
6. **`source_unreadable` 개수가 늘지 않는지.** 늘었다면 그 detail의 경로가
   `/data/upload/…`인지 `/data/library/…`인지 본다 — 후자면 mover가 rename과 경로 쓰기 사이에서
   죽은 N1의 창이고, 복구는 **Drive 동기화가 아니라 Storage Migration 재실행**이다.
   ```sql
   select e."error", e."detail", e."attempts", e."assetId"
   from google_drive_upload_error e
   where e."error" = 'source_unreadable';
   ```
7. **연결 해제·재연결은 업로드가 도는 중에 하지 않는다** (`CLAUDE.md` §7 운영 습관 9). 이번 변경과
   무관하게 유효하다.

---

## Feeding back into the plan

`dev-docs/google-drive/`의 계획 문서에 남길 것:

1. **"조회 결과를 되쓰는 쓰기에는 CAS를 건다"를 규칙으로 승격한다.** 이번까지 같은 결함 클래스가
   세 번 나왔다(round-22 `setDriveAccountId`, round-23 `adoptUnstampedUploads`, wave7 폴더 백필).
   판별식은 간단하다 — **"이 값은 요청 본문에서 왔는가, 아니면 내가 읽어 온 행에서 왔는가."**
   후자면 읽을 때의 술어를 WHERE에 그대로 다시 건다. 지금 그 규칙을 만족하지 않는 것은
   `setFolderId`와 `deleteCredentials` 둘뿐이고, 둘 다 값이 요청에서 온다 — **의도된 예외로 명시해
   둔다.**
2. **`refreshToken`을 nullable로 바꾸는 작업의 선결 조건을 적는다** (N7). 토큰을 CAS 키로 쓰는 곳이
   **세 곳**(`setDriveAccountId`, `adoptUnstampedUploads`, `fillFolderName`)이고, nullable 전환은
   그 셋을 `connectionId` CAS로 **동시에** 옮기지 않으면 전부 조용한 no-op이 된다. 파일·줄까지
   적어 둘 것.
3. **"한 픽스처는 한 술어만"의 짝이 되는 규칙을 추가한다: "부정 단언은 관측 지점이 아니라 *변이*로
   검증한다".** 이번 라운드가 그 증거다 — §5의 두 테스트에 관측 지점을 **추가했는데도** 하나는
   여전히 공허했다. 관측 지점을 넣었다는 사실은 증거가 아니고, **그 가드를 지웠을 때 죽는지**만이
   증거다. 리포트의 변이표에 `fillFolderName` 네 줄은 있었지만 §5의 두 테스트는 없었고, 정확히
   그 빠진 두 줄에 결함이 있었다.
4. **`google-drive.service.ts:1106-1107`의 폴백을 "테스트가 눈이 머는 지점"으로 기록한다.**
   `error instanceof … ? error.attemptedPath : asset.originalPath`는 운영에서는 옳은 방어지만,
   **경로만 보는 어떤 단언도 이 catch 안의 버그를 못 본다.** 이 catch를 건드리는 테스트는 경로가
   아니라 로그 문구나 에러 종류를 봐야 한다.
5. **"다음 동기화"의 실제 의미를 문서에 확정한다.** `GoogleDriveUploadQueueAll`은 관리자 전용이지만,
   `syncAlbum`(앨범 메뉴)과 `resumeUploads`(설정)가 사용자 재큐잉 경로다. 직전 리뷰가 "관리자
   전용"이라고 단정한 것이 절반만 맞았고, 그 오해가 UI 문구를 고칠 뻔했다.
6. **mover가 죽은 창의 복구 주체는 immich의 incomplete-move 복구다** (`storage.core.ts:203-227`,
   `move_history`). Drive 쪽에서 할 수 있는 일은 없다 — 자동 재큐잉을 만들자는 제안이 다시 나오면
   이 항목을 가리킬 것.
