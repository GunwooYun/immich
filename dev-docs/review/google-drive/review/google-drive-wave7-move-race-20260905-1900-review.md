# Code Review — 원본 이동 경합 재시도 · 폴더 이름 백필 · 폴더 ID 노출 제거

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `6aba7b292` |
| Commits reviewed | `7d7ee2471`, `cf467df51`, `6aba7b292` (`git log --oneline 7b0f61955..6aba7b292` = 3, 그중 `6aba7b292`는 리포트 자신) |
| Report | `../report/google-drive-wave7-move-race-20260905-1900-report.md` |
| Prior review | `./google-drive-wave6-round28-closing-20260905-1310-review.md` (Wave 6 사이클 종료) |
| Reviewed | 2026-09-05 |

## Verdict

**경합 수정은 옳은 방향이고, 리포트가 공격을 요청한 두 질문의 답은 "예, 창은 남아 있다"와
"예, 실패했을 때만 부른다"이다.** 두 번째는 실측으로 증명했다(성공 경로에서 `getById` 호출
1회 — 임시 단언을 넣어 92 passed로 확인). 첫 번째는 **리포트와 커밋 메시지의 전제가 틀렸다**:
"mover가 rename과 **같은 트랜잭션에서** `originalPath`를 갱신한다"는 사실이 아니다.
`storage.core.ts`는 `:240`에서 rename하고 `:268`에서 **별개의 UPDATE**로 경로를 저장한다.
트랜잭션은 어디에도 없다(`withLock`은 advisory lock이지 트랜잭션이 아니다 —
`database.repository.ts:431-442`). 창은 UPDATE 왕복 시간만큼 좁아졌을 뿐 닫히지 않았고,
**move가 중간에 죽은 경우에는 무기한으로 열려 있다**(§M1). 결론에는 영향이 없다 —
남은 창에 걸린 사진은 여전히 스킵되고 pending으로 남는다 — 하지만 코드 주석이 "같은
트랜잭션"이라고 단언하는 한, 다음 사람은 창이 **없다**고 읽는다.

**이 라운드에서 가장 중요한 문제는 경합이 아니라 폴더 이름 백필의 무방비 쓰기다(H1).**
백필은 최대 10초+(토큰 갱신은 무제한) 걸리는 Drive 호출을 마친 뒤
`googleDriveRepository.setFolderId(userId, credentials.folderId, folderName)`을 **아무 조건 없이**
쓴다(`google-drive.service.ts:668-672`). 같은 저장소의 `setDriveAccountId`
(`google-drive.repository.ts:110-121`)는 **정확히 이 상황**을 위해 `refreshToken` 일치 +
`driveAccountId is null` CAS를 달고 있고, 그 가드는 round-22가 "프로브가 in-flight인 동안
재링크가 착지하면 A 계정의 id가 B 계정의 토큰 옆에 영구히 박힌다"는 이유로 넣은 것이다.
백필은 한 라운드 만에 같은 형태의 쓰기를 가드 없이 되살렸다. 되돌려지는 값이 **업로드가
어디로 가는지를 결정하는 값**이라 결과는 조용하지 않다.

**리포트의 변이표 5줄은 이 HEAD에서 전부 그대로 재현된다.** 다만 다섯 테스트 중 **하나는
주장하는 이유로 통과하지 않는다**: `should skip quietly when the asset disappeared during the
window`는 `!fresh` 가드를 없애도 92개가 전부 통과한다(M7). 그리고 `should not retry when the
path has not changed`는 재시도를 **통째로 제거해도** 통과한다(M1에서 죽은 것은 다른 두 개다).

### Evidence I ran myself

전부 이 워크트리 HEAD(`6aba7b292`)에서 돌렸다. 변이는 파일을 `/tmp`에 복사해 두고 문자열
치환으로 넣은 뒤 **매 실행마다 원본을 복원**했고, 마지막에 `git status --porcelain`이 비어
있음을 확인했다.

| Check | Result |
|---|---|
| server unit — `run.sh`의 8스펙 | `Test Files 8 passed / Tests 273 passed (273)` — **리포트의 273과 일치** |
| server unit — 전체 스위트 (`--config test/vitest.config.mjs`) | `Test Files 94 passed / Tests 2383 passed \| 2 skipped (2385)` — 회귀 없음 |
| `google-drive.service.spec.ts` + `utils/google-drive.spec.ts` | `Tests 108 passed (108)` (서비스 92 / 유틸 16) |
| server medium (실 DB, `immich_postgres` 사용) | `Test Files 1 passed / Tests 54 passed (54)` — **리포트의 54와 일치** |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx eslint src/services/google-drive.service.ts src/utils/google-drive.ts src/services/google-drive.service.spec.ts --max-warnings 0` | exit 0 |
| i18n 정렬 — `json.load` 후 1,718개 플랫 키를 `key.lower()`로 정렬 비교 | `sorted: True`, inversions `[]`. 삽입 위치 `…folder_none / folder_unnamed / not_connected` — **정렬 정확** |
| `grep google_drive_folder_current` (web 전체) | `GoogleDriveSettings.svelte:310` **한 곳뿐**. ID를 표시하던 다른 호출자 없음 |
| 첨부 증거 `results/20260905-1859.txt` | `commit: 7d7ee2471`, **dirty 마커 없음**, 273 / 39 / 54, `RESULT: PASS` — 주장대로 |
| `git status --porcelain` (종료 시) | **이 리뷰 파일 하나뿐** |

**변이 전수.** M1~M5는 리포트가 주장한 것, M6~M8은 내가 추가한 것이다. 숫자는 전부
`google-drive.service.spec.ts` 단독 실행(무변이 = 92 passed) 기준이다.

| # | 변이 (파일:줄) | 방향 | 결과 | 리포트 주장 |
|---|---|---|---|---|
| M1 | `service.ts:1293` `if (!fresh \|\| …)` → `if (true \|\| …)` | 재시도 제거 | **`2 failed \| 90 passed`** — `should retry once against the re-read path and upload`, `should report the path it actually failed on, not the stale one` | 2 failed ✔ |
| M2 | `service.ts:1078-1079` → `const attemptedPath = asset.originalPath;` | 낡은 경로 기록 | **`1 failed \| 91 passed`** — `should report the path it actually failed on…` | 1 failed ✔ |
| M3 | `service.ts:670` `if (folderName)` → `if (false && folderName)` | 이름 미저장 | **`1 failed \| 91 passed`** — `should look the name up and keep it when the row has none` | 1 failed ✔ |
| M4 | `service.ts:668`에서 `!folderName &&` 삭제 | 알아도 조회 | **`2 failed \| 90 passed`** — `should not ask Drive when the name is already known`, `should report a connected user without leaking the refresh token` | 2 failed ✔ |
| M5 | `service.ts:668` 키를 `` `account:${userId}` `` 로 | 쿨다운 공유 | **`1 failed \| 91 passed`** — `should keep the account probe and the folder lookup on separate cooldowns` | 1 failed ✔ |
| M6 | `service.ts:1293` → `if (!fresh) {` | **항상** 재시도 | `1 failed \| 91 passed` — `should not retry when the path has not changed` | (없음) 방향은 잡힌다 |
| M7 | `service.ts:1293` → `if (fresh && fresh.originalPath === asset.originalPath) {` | `!fresh` 가드 제거 | **`92 passed`** — 아무도 안 죽는다 (§N1) | (없음) |
| M8 | 무변이 코드 + `spec.ts:1661`에 `expect(mocks.asset.getById).toHaveBeenCalledTimes(1)` 삽입 | 성공 경로 `getById` 횟수 | **`92 passed`** — **성공 경로에서 정확히 1회** (§리포트 질문 2의 답) | — |

---

## Findings

배포를 **막는** 것은 없다. H1은 배포 전에 고치는 편이 싸다(5줄). M1~M4는 다음 라운드,
N1~N4는 여유가 있을 때.

### H1 (High) — 폴더 이름 백필이 CAS 없이 쓴다. round-22가 같은 결함 클래스를 이미 막아 뒀다

**증거.** `server/src/services/google-drive.service.ts:664-672`:

```ts
let folderName = credentials.folderName;
if (credentials.folderId && !folderName && this.probeAllowed(`folder:${userId}`)) {
  folderName = await this.resolveFolderName(userId, credentials.refreshToken, credentials.folderId);
  if (folderName) {
    await this.googleDriveRepository.setFolderId(userId, credentials.folderId, folderName);
  }
}
```

`googleDriveRepository.setFolderId`는 `google-drive.repository.ts:234-242`에서 **조건 없는
UPDATE**다 — `where('userId','=',userId)` 하나뿐이고, `folderId`와 `folderName`을 **둘 다**
덮어쓴다.

`credentials`를 읽은 시점(`:628`)과 쓰는 시점(`:671`) 사이에는 `resolveFolderName`이 있고,
그것은 `ACCOUNT_PROBE_TIMEOUT_MS = 10_000`으로 묶인 Drive 호출 **더하기** 무제한 OAuth 토큰
갱신이다(그 무제한성은 `:545-556`이 스스로 문서화하고 있다). 그 창 안에서:

- 사용자가 피커로 **다른 폴더**를 고르거나 텍스트 필드로 새 ID를 저장하면
  (`GoogleDriveSettings.svelte:181-186`의 피커 경로, `:198-201`의 수동 경로), 백필이 뒤늦게 **옛 folderId를 되돌려 쓴다.**
  새 선택은 에러 없이 사라지고, 그 뒤 업로드는 사용자가 고르지 않은 폴더로 간다.
- 텍스트 필드 경로는 `folderName`을 `null`로 저장하므로(`:200-201`, DTO에 `folderName`을 아예 싣지 않는다), "이름이 이미 있으면
  덮어쓰지 않는다" 같은 약한 가드로는 잡히지 않는다.
- 재링크가 그 창에 착지하면(`upsertCredentials`는 `onConflict`에서 `folderId`/`folderName`을
  건드리지 않는다 — `google-drive.repository.ts:90-97`) 백필이 **떠난 연결의 folderId**를 새
  연결 위에 다시 못 박는다. 그 폴더가 새 계정에 없으면 `notFound` + `hasFolder` →
  `FolderMissing` → **계정 전체 차단**이다(`utils/google-drive.ts:96-98`).

이것이 정확히 `setDriveAccountId`가 막고 있는 결함이다(`google-drive.repository.ts:110-121`,
주석 그대로: *"Matching on the token, not just on the user, is what makes this safe against a
re-link that lands while the probe is in flight."*). 백필은 그 가드를 상속하지 않았다.

**확률은 낮다.** 이 인스턴스는 Drive 사용자가 한 명이고, 백필이 한 번 성공하면 그 사용자에
대해 창은 영구히 닫힌다. 그래도 High로 두는 이유는 (a) 되돌려지는 값이 업로드 목적지이고,
(b) 저장소가 **같은 클래스를 이미 막을 가치가 있다고 결정**했으며, (c) 수정이 5줄이기 때문이다.

**구체적 수정.** 기존 `setFolderId`를 넓히지 말 것 — 피커 경로는 **덮어쓰는 것이 맞다**.
전용 메서드를 새로 만든다:

```ts
// google-drive.repository.ts
/**
 * Fills in a folder name that was never recorded, and only that.
 *
 * Guarded on the connection (refreshToken) and on the folder still being the one we looked up,
 * for the same reason setDriveAccountId is: the lookup runs for up to ten seconds on a page load,
 * and a folder chosen — or a re-link landing — in that window must not be reverted by an answer
 * about the old one.
 */
@GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING, DummyValue.STRING, DummyValue.STRING] })
async fillFolderName(userId: string, refreshToken: string, folderId: string, folderName: string) {
  await this.db
    .updateTable('user_google_drive')
    .set({ folderName })                      // folderId는 건드리지 않는다
    .where('userId', '=', userId)
    .where('refreshToken', '=', refreshToken)
    .where('folderId', '=', folderId)
    .where('folderName', 'is', null)
    .execute();
}
```

테스트는 기존 `should look the name up and keep it when the row has none`을 이 메서드로
바꾸고, "조회 중에 folderId가 바뀌면 아무것도 쓰지 않는다"를 한 줄 추가한다.
`mise //:sql` 재생성이 필요하다.

---

### M1 (Medium) — "같은 트랜잭션" 전제가 사실이 아니다. 창은 남아 있고, 죽은 move에서는 무기한이다

**리포트가 공격을 요청한 첫 번째 질문의 답이다.**

**증거.** `server/src/cores/storage.core.ts`:

```
:239-240   this.logger.debug(`Attempting to rename file: …`);
           await this.storageRepository.rename(move.oldPath, newPath);
   …
:268       await this.savePath(pathType, entityId, newPath);
```

`savePath`는 `:321-325`에서 `this.assetRepository.update({ id, originalPath: newPath })` —
**별개의 자동커밋 UPDATE**다. 두 호출을 감싸는 트랜잭션은 없다. 상위의
`storage-template.service.ts:228`은 `withLock(DatabaseLock.StorageTemplateMigration, …)`인데,
`database.repository.ts:431-442`가 보여주듯 그것은 **전용 커넥션 위의 advisory lock**이고
트랜잭션이 아니다. 게다가 `savePath`의 UPDATE는 그 커넥션이 아니라 **풀**에서 나간다.

따라서 `google-drive.service.ts:1276-1277`의

> *"the mover updates `originalPath` in the same transaction as the rename, so a row read after
> the failure names the new location"*

는 틀렸다. 정확한 문장은 "rename 직후 **다음 UPDATE 왕복 안에서** 갱신한다"이다.

**창의 폭.** 두 가지가 있다.

1. **평시 창** — `rename` 반환(`:240`)과 `savePath` 반환(`:268`) 사이. 사이에 있는 것은
   `if` 블록 탈출과 UPDATE 한 번뿐이므로 보통 1ms 미만이고, 풀이 포화되면 커넥션 획득
   대기만큼 늘어난다. 관측된 경합(자산 행 생성 **4초** 뒤)에 비하면 3~4자리수 좁다.
   **실질적으로는 문제가 아니다.**
2. **죽은 move 창 — 이쪽이 진짜다.** `moveFile`은 rename 후 `savePath` 전에 프로세스가
   죽으면 `move` 행을 남긴 채 끝난다. 그 상태에서 파일은 새 위치에, DB는 옛 경로를 가리키고,
   **다음 storage-template 잡이 돌아 `:203-227`의 resume 분기를 탈 때까지 그대로다.**
   그 잡은 자동으로 돌지 않으므로 이 창은 **분·시간·무기한**이다. 이 상태에서 Drive 잡이
   실패하면 재읽기가 **같은 경로**를 돌려주므로 재시도는 건너뛰어진다. EXDEV 폴백에서
   `unlink`(`:260`) 직후 죽는 경우도 같다.

**중요한 것은 결과가 유계라는 점이다.** 어느 창에 걸리든 `SourceUnreadable` 에러 행 +
`'skipped'`이고, 원장 행이 없으므로 자산은 pending으로 남는다. `streamPendingUploads`는
**차단 클래스만** 제외하므로(`google-drive.repository.ts:557-566`,
`GOOGLE_DRIVE_BLOCKING_ERROR_CLASSES`) `SourceUnreadable`은 다음 큐잉에서 다시 잡힌다.

**다만 리포트의 "self-healing"·"다음 동기화가 가져간다"는 절반만 맞다.**
`GoogleDriveUploadQueueAll`의 유일한 생산자는 `queue.service.ts:249`, 즉 **관리자 Jobs 화면**
이다(전수 grep 확인). 자동 재큐잉은 없다. 그때까지 그 사진은 설정 화면의 `failedCount`에
남는다.

**구체적 수정 — 코드가 아니라 문장이다.** `:1276-1277` 주석과 커밋 메시지의 "same
transaction"을 사실로 고친다. 예:

> Re-reading the row is what makes this work in the common case: the mover renames the file and
> then, in the very next statement, updates `originalPath` (`storage.core.ts:240` → `:268`) —
> **not in one transaction**, so a row read in between still names the old path and the retry is
> skipped. That gap is a single UPDATE round trip against an observed race of four seconds, so
> it closes the case that was actually hit. What it does *not* close is a move that died between
> the two: the row then names the old path indefinitely, and such an asset stays a skip until an
> operator runs Queue All.

코드 변경은 권하지 않는다. 무조건 재시도(M6)해도 낡은 경로는 여전히 비어 있으므로 아무것도
사지 못하고, 잠들었다 폴링하는 것은 작성자가 의도적으로 버린 선택이며 그 근거는 타당하다.

---

### M2 (Medium) — 재시도가 프로덕션에 아무 흔적도 남기지 않는다. 배포 후 "고쳐졌나"를 확인할 수 없다

**증거.** 경합을 살아남았다는 사실을 말하는 유일한 줄은
`google-drive.service.ts:1302-1304`의 `this.logger.debug(...)`다. 기본 로그 레벨은
`config.ts:300`의 `level: LogLevel.Log` — **`debug`는 출력되지 않는다.**

성공 경로는 로그도 없고 에러 행도 없고 원장 행은 성공한 업로드와 구별되지 않는다. 즉
**이 수정이 한 번이라도 발동했는지 운영에서 관측할 방법이 없다.** 이 기능의 다른 드문
사건들은 전부 `warn` 이상이다(`:570`, `:750`, `:1080`).

**구체적 수정.** `logger.debug` → `logger.log`. 이 사건은 본질적으로 드물고(경합에 걸린
사진에 한 번씩) 자기 제한적이라 로그 폭주 위험이 없다. 문구에 옛 경로와 새 경로를 둘 다
넣는다 — M3와 같은 이유다.

```ts
this.logger.log(
  `Original for asset ${asset.id} moved from ${asset.originalPath} to ${fresh.originalPath} while the ` +
    'upload was queued; retrying at the new path',
);
```

---

### M3 (Medium) — 기록되는 detail이 이 경합을 **다음 번에** 알아볼 단서를 지운다

**증거.** DB에 남는 문자열은 `google-drive.service.ts:1088`의
`` `Could not read ${attemptedPath}` `` 이고, `attemptedPath`는 이동이 있었으면 **새 경로**다.

리포트 §1의 논거는 *"그 문자열이 진단의 전부"*인데, 이 경합이 식별된 방식은 정확히
**detail이 `/data/upload/...`를 가리키는데 현재 `originalPath`는 `/data/library/...`였다**는
불일치였다. 새 코드에서 이동 후 재시도까지 실패하면 detail은 `/data/library/...`가 되어
그 불일치가 사라진다. 즉 **낡은 경로를 적는 문제를 고치면서, 낡은 경로가 알려주던 것도 함께
버렸다.** (평시에는 이동 뒤 재시도가 성공하므로 에러 행 자체가 없다. 문제가 되는 것은
"이동했는데도 새 위치에서 실패" — 즉 진짜 진단이 필요한 경우다.)

**구체적 수정.** `GoogleDriveSourceUnreadableError`가 이미 클래스이므로 필드 하나를 더 얹는다:

```ts
export class GoogleDriveSourceUnreadableError extends Error {
  constructor(
    message: string,
    readonly attemptedPath: string,
    /** Set only when the row moved under us: the path the job was originally handed. */
    readonly movedFrom?: string,
  ) { super(message); }
}
```

`:1312-1315`에서 `fresh.originalPath, asset.originalPath`로 던지고, `:1085-1089`에서

```ts
error instanceof GoogleDriveSourceUnreadableError && error.movedFrom
  ? `Could not read ${error.attemptedPath} (moved from ${error.movedFrom} while queued)`
  : `Could not read ${attemptedPath}`
```

테스트는 `should report the path it actually failed on, not the stale one`에
`expect.stringContaining('moved from')` 한 줄을 더하면 되고, 그 한 줄이 M2 변이도 그대로
잡는다.

---

### M4 (Medium) — 백필의 진짜 비용은 요청 수가 아니라 **응답 지연**이다. 실패는 잊지 말고 **더 길게 쉬어야** 한다

**리포트가 공격을 요청한 두 번째 질문(손으로 붙여넣은 폴더)의 답이다.**

**요청 수는 문제가 아니다.** `probeAllowed`는 진짜로 키별이고(`:716-723`), 키는
`` `account:${userId}` `` / `` `folder:${userId}` `` 로 분리되어 있으며(`:635`, `:668`),
`accountProbeAt` 맵을 공유하는 다른 사용처는 없다(전수 grep: `:635`, `:668`, `:712`, `:717`,
`:721` — 끝). `storageCache`는 완전히 별개 맵이다(`:705`). userId가 UUID이므로 접두사 충돌도
불가능하다. **M5가 이것을 실제로 지킨다.** 사용자당 분당 1회 `files.get`은 수용 가능하다.

**문제는 그 1회가 어디에 서 있느냐다.** `getStatus`는 설정 화면 로드뿐 아니라 **앨범 Drive
메뉴를 열 때마다** 불린다 —
`web/src/routes/(user)/albums/[albumId=id]/…/+page.svelte:377`이 `getGoogleDriveStatus()`를
`Promise.allSettled`의 한 갈래로 부른다. 그리고 이름을 못 얻는 상태에서 `getStatus`는

- 계정 미식별이면 `about.get` (10초 + 무제한 토큰 갱신), **그다음 직렬로**
- `files.get` (또 10초 + 또 다른 `getOAuth2Client()`로 **또 한 번의 토큰 갱신** — `:143`은
  호출마다 새 클라이언트를 만든다)

를 한다. 즉 최악의 경우 **한 번의 페이지·메뉴 오픈이 20초+ 대기**가 되고, 손으로 붙여넣어
`drive.file`로 도달 불가능한 폴더에서는 이 상태가 **영구적**이다(1분마다 재발). 계정 프로브는
성공하면 끝나므로 이 성질이 없었다.

**"영구히 포기해야 하는가"에 대한 답: 아니오, 하지만 백오프는 필요하다.** 영구 포기는
무효화 지점이 필요해진다 — 사용자가 피커로 **같은 폴더를 다시 고르면** 그 폴더는 앱에
부여되어 도달 가능해지므로, 포기 플래그를 `setFolderId`에서 지워야 하고 그것은 새 결합이다.
실패에 **더 긴 쿨다운**을 주면 무효화 없이 99%를 얻는다.

**구체적 수정.**

```ts
// 맵 값을 확장한다. 성공/미시도는 지금과 같고, 실패만 길게 쉰다.
private probeAt = new Map<string, { at: number; cooldownMs: number }>();
private static readonly PROBE_COOLDOWN_MS = 60_000;
private static readonly PROBE_FAILED_COOLDOWN_MS = 60 * 60_000;

private probeAllowed(key: string): boolean { … entry.cooldownMs 사용 … }
private probeFailed(key: string): void {
  this.probeAt.set(key, { at: Date.now(), cooldownMs: GoogleDriveService.PROBE_FAILED_COOLDOWN_MS });
}
```

`resolveFolderName`이 null을 돌려주면 `this.probeFailed(\`folder:${userId}\`)`. 테스트는
기존 `should ask at most once a minute for a folder it cannot name`을 그대로 두고
"실패 뒤에는 1분이 지나도 다시 묻지 않는다"를 `vi.setSystemTime`으로 한 줄 더한다.

같이 하면 좋은 것(별건): 두 프로브를 `Promise.allSettled`로 병렬화하면 최악 지연이 20초에서
10초로 준다. 지금은 `:635`의 `await`가 `:669`를 직렬로 막는다.

---

### N1 (Nit — 그러나 §4 규칙 위반) — `should skip quietly when the asset disappeared`는 공허하다. 게다가 "quietly"가 아니다

**증거 (M7).** `google-drive.service.ts:1293`을
`if (fresh && fresh.originalPath === asset.originalPath) {`로 바꾸면 — 즉 `!fresh` 가드를
없애면 — 코드는 `:1303`에서 `fresh.originalPath`로 **TypeError**를 던진다. 그런데
`uploadAsset`의 catch가 그것도 잡아 `attemptedPath = asset.originalPath`로 떨어뜨리고
`'skipped'`를 돌려주므로, 이 테스트의 두 단언(`createReadStream` 1회, `recordUpload` 미호출)이
**그대로 성립한다**. 결과: **`92 passed`, 아무도 안 죽는다.**

이 저장소의 `.claude/rules/testing.md`가 *"'무엇을 하지 않는다'를 단언할 때는 의도한 이유로
통과하는지 함께 못박는다"*고 못박은 바로 그 형태다.

**게다가 이름이 사실과 다르다.** `!fresh` 분기는 조용하지 않다 — throw → catch →
`upsertError(SourceUnreadable)`를 **쓴다**(`:1084-1089`). 자산이 하드 삭제된 뒤라면 그 INSERT는
`google_drive_upload_error_assetId_fkey`(migration `1786800000000…:30`, `REFERENCES "asset"("id")`)에
걸려 **FK 위반으로 잡을 실패시킨다.** mock이 그것을 가린다. (이 위험 자체는 이번 변경이
만든 것이 아니라 이전 코드에도 있었다 — 다만 새 코드는 "자산이 사라졌다"를 **명시적으로
알아낸 다음에도** 에러 행을 쓴다.)

**구체적 수정 — 둘 중 하나.**

(a) 테스트만 고친다:
```ts
expect(mocks.asset.getById).toHaveBeenCalledTimes(2);   // 재읽기가 실제로 일어났다
expect(mocks.googleDrive.upsertError).toHaveBeenCalledWith(
  userId, asset.id, GoogleDriveUploadErrorClass.SourceUnreadable, expect.stringContaining(asset.originalPath),
);
```
이러면 M7이 죽는다(TypeError 경로는 `getById` 2회지만 detail이 다르지 않으므로… 실제로는
`upsertError` 인자가 같다 — 그래서 **(b)를 권한다**).

(b) 이름대로 만든다. `!fresh`일 때는 gate 5와 같은 취급(에러 행 없는 스킵)을 한다. 자산 행이
사라진 뒤에 에러 행을 쓰는 것은 FK가 거부할 수도 있는 쓰기이고, 지운 사진의 실패를
사용자에게 보여줄 이유도 없다. 예: `openOriginal`이 `null`을 돌려주면 `uploadAsset`이
`upsertError` 없이 `'skipped'`. 그러면 테스트가 `expect(mocks.googleDrive.upsertError).not.toHaveBeenCalled()`
+ `expect(mocks.asset.getById).toHaveBeenCalledTimes(2)`가 되어 M7을 확실히 잡는다.

### N2 (Nit) — `should not retry when the path has not changed`도 재시도 전체 제거를 못 잡는다

M1(재시도 통째 제거)에서 죽은 것은 다른 두 개였다. 이 테스트의 주석은
*"This also pins that the retry is keyed on the path moving rather than on the read simply having
failed"*라고 쓰여 있지만, 실제로 구별하는 것은 **"항상 재시도"뿐**(M6에서 죽는다)이고
**"재시도 없음"과는 구별하지 못한다.** 재읽기가 일어났다는 증인을 한 줄 넣으면 된다:

```ts
expect(mocks.asset.getById).toHaveBeenCalledTimes(2);   // gate 5 + 재읽기
```

### N3 (Nit) — 이름·주석 드리프트

- `accountProbeAt`(`:712`)와 `ACCOUNT_PROBE_COOLDOWN_MS`·`ACCOUNT_PROBE_TIMEOUT_MS`(`:713-714`)는
  이제 **두 종류의 프로브**가 공유한다. `:701-711`의 docstring은 여전히 신원 프로브만
  설명하고, *"the id is stored then and this map stops being consulted"*는 폴더 키에는
  거짓이다(폴더 조회는 영원히 실패할 수 있다 — M4). `probeAt` / `PROBE_*`로 개명하고
  docstring에 두 사용처를 적는다.
- `spec.ts:205-210`에 같은 취지의 주석 두 문단이 겹쳐 있다("Hoisted module mocks live for the
  whole file…" + "Hoisted mocks live for the whole file…"). 첫 문단은 `oauth2GetAccessToken`용,
  둘째는 새 `mockReset`용인데 붙여 놓으니 중복으로 읽힌다. 하나로 합친다.
- `spec.ts:1066`의 `driveAboutGet.mockReset()`은 이제 전역 `beforeEach`(`:211`)와 중복이다.
  지워도 92개가 전부 통과한다(전역 리셋이 먼저 돈다).

### N4 (Nit) — 웹 변경에는 테스트가 없다 (그리고 그건 이 라운드가 만든 문제가 아니다)

`GoogleDriveSettings.svelte:309-314`의 새 분기는 `run.sh`의 `WEB_SPECS` 4개 중 어느 것도
건드리지 않는다(그 목록에 이 파일이 없다). i18n 키 정렬과 유일 사용처는 위 표에서 확인했고,
ID를 **표시**하던 다른 호출자는 없다 — `GoogleDriveAlbumMenu.svelte:104`는 folderId를 Drive
URL을 만드는 데만 쓴다. 그러므로 이 변경은 안전하지만, "이름이 없을 때 무엇을 보여주는가"는
지금 **아무 테스트도 지키지 않는다.** 세 갈래(이름 있음 / ID만 있음 / 둘 다 없음)를 도는
작은 컴포넌트 테스트를 `WEB_SPECS`에 넣을 가치가 있다.

---

## Answers to what the report asked me to attack

### Q1. "경로가 바뀌었을 때만" 재시도하는 것이 맞는가 — 창이 남아 있는가?

**남아 있다. 두 개다.** 그리고 리포트·커밋 메시지의 근거("mover가 rename과 같은 트랜잭션에서
갱신한다")는 **사실이 아니다** — `storage.core.ts:240`(rename)과 `:268`(savePath)은 별개의
문장이고 트랜잭션은 없으며, `withLock`은 advisory lock이다(`database.repository.ts:431-442`).

1. **평시 창 = UPDATE 한 번의 왕복.** 관측된 4초 경합 대비 3~4자리수 좁다. 실질적으로 무시
   가능하고, 여기서 "재시도 조건을 경로 변화로 둔 것"은 옳다.
2. **죽은 move 창 = 무기한.** rename 후 `savePath` 전에 프로세스가 죽으면 행은 옛 경로를
   가리킨 채 남고, 다음 storage-template 실행의 resume 분기(`:203-227`)가 돌기 전까지
   재읽기는 **같은 경로**를 돌려준다. 이 경우 재시도는 건너뛰어진다.

**중요한가 — 결론: 크게는 아니다.** 어느 창이든 결과는 스킵 + `SourceUnreadable` 에러 행이고,
원장 행이 없으므로 자산은 pending으로 남으며 `streamPendingUploads`가 이 클래스를 제외하지
않으므로 다음 큐잉에서 다시 잡힌다. **다만 "다음 동기화"는 자동이 아니다** —
`GoogleDriveUploadQueueAll`의 유일한 생산자는 관리자 Jobs 화면이다(`queue.service.ts:249`).
그때까지 `failedCount`에 남는다.

조건을 "실패하면 무조건 한 번 더"로 바꾸는 것은 **도움이 되지 않는다**(M6). 낡은 경로는
여전히 비어 있으므로 두 번째 `stat`도 같은 ENOENT다. 잠들었다 폴링하지 않기로 한 판단도
지지한다. **고칠 것은 코드가 아니라 주석의 단언이다**(M1).

### Q2. `getById`를 한 번 더 부르는 비용이 대량 백필(7,199건)에서 문제가 되는가 — 실패했을 때만 부르는 게 맞나?

**맞다. 실측했다.** `openOriginal`(`:1285-1318`)에서 `assetRepository.getById`는 **`catch` 블록
안에만** 있다(`:1292`). 성공 경로에 넣을 수 있는 경로가 렉시컬하게 없다.

증명(M8): 성공 경로 테스트에 `expect(mocks.asset.getById).toHaveBeenCalledTimes(1)`을 임시로
넣고 돌렸더니 **92 passed**. 즉 gate 5의 1회가 전부이고 추가 조회는 0이다.

**실패했을 때의 비용도 무해하다.** 7,199건이 전부 읽기 실패하는 상황(마운트 소실)이라면
추가 비용은 자산당 **PK 단일 행 조회 1회**이고, 그 시점에 이미 실패한 `fs.stat`보다 싸다.
그리고 경로가 같으므로 **두 번째 `createReadStream`은 일어나지 않는다** — `:1293`이 먼저
throw한다. 정상 백필에서는 추가 비용이 문자 그대로 0이다.

### Q3 (리포트가 묻지 않은 것). 두 번째 시도가 파일 핸들을 샐 수 있는가?

**샐 수 없다.** `storage.repository.ts:122-130`:

```ts
async createReadStream(filepath: string, mimeType?: string | null): Promise<ImmichReadStream> {
  const { size } = await fs.stat(filepath);
  await fs.access(filepath, constants.R_OK);
  return { stream: createReadStream(filepath), length: size, type: mimeType || undefined };
}
```

throw는 `fs.stat` 또는 `fs.access`에서 나오고, **`createReadStream`(node fs)은 그 뒤에**
호출된다. 첫 시도가 던졌다면 스트림 객체는 아예 만들어지지 않았다. 두 번째 시도가 성공하면
그 `streamInfo`가 `uploadAsset`의 `finally`(`:1252-1261`, `destroy()`는 `:1260`)로 그대로 넘어가 `destroy()`된다.
`openOriginal` 반환과 그 `try {` 사이에는 동기 객체 생성뿐이라 새는 창도 없다.

### Q4 (리포트가 묻지 않은 것). 에러 클래스 변경이 `classifyDriveError`의 동작을 바꾸는가?

**바꾸지 않는다. 도달조차 하지 않는다.** `classifyDriveError`가 불리는 곳은
`:1233`(Drive API 호출을 감싼 `try`의 `catch`) 한 곳뿐이고, `openOriginal`의 실패는 그보다
**앞선** `try/catch`(`:1072-1093`)에서 `'skipped'`로 종결된다. 새 예외는 그 경계를 넘지 않는다.

만에 하나 넘어가더라도 안전한 쪽으로 떨어진다: `GoogleDriveSourceUnreadableError`는
`GoogleDriveSizeMismatchError`가 아니고, `getDriveErrorReason`/`getStatus`가 `undefined`를
돌려주므로 `Unknown`으로 분류된다 — **차단 클래스가 아니다**(`utils/google-drive.ts:86-110`).

**한 가지 잃은 것은 있다.** 원래 던져지던 Node 에러의 `code`(`ENOENT`)·`errno`·`path` 속성이
래핑으로 사라진다. 문자열 보간(`: ${error}`)으로 메시지에는 남지만 프로퍼티로는 못 읽는다.
현재 이 경로에서 `error.code`를 보는 코드는 없으므로(전수 grep) 지금은 무해하지만, 나중에
"ENOENT만 재시도" 같은 판단을 하고 싶어지면 `{ cause: error }`를 붙여 두는 편이 싸다.

### Q5 (리포트가 묻지 않은 것). 다른 곳이 같은 staleness 전제로 `originalPath`를 읽는가?

**이 포크의 코드 안에서는 없다.** `originalPath` 문자열은 google-drive 3개 파일 전체에서
`google-drive.service.ts`에만, 그것도 전부 `openOriginal`과 그 호출부에만 나온다
(`:1079`, `:1285-1314` — 나머지는 주석). `storageRepository.createReadStream` 호출도 서비스
전체에서 이 두 곳뿐이다. 잡 페이로드는 `{ userId, assetId }`뿐이므로(`types.ts:479`) 경로가
큐를 타고 흐르지도 않는다.

업스트림 잡 핸들러(metadata·media·storage-template)는 같은 "잡 시점에 경로를 읽는다" 전제를
공유하지만, 이 포크가 건드리는 범위가 아니고 그쪽은 이동을 스스로 조율한다.

### Q6. 폴더 이름 백필 — 쿨다운이 정말 키별인가, 맵을 다른 것이 공유하는가?

**키별이 맞고, 공유하는 것은 없다.** §M4 첫 문단 참조. `probeAllowed`는 순수하게 키로 동작
하고(`:716-723`), `accountProbeAt` 접근은 `:717`/`:721` 두 줄뿐이며, 호출자는 `:635`와 `:668`
둘뿐이다. `storageCache`(`:705`)는 별개 맵이다. M5가 이 성질을 실제로 지킨다.

(맵이 영원히 자라는 것은 사실이지만 — 사용자당 이제 2개 — `storageCache`와 같은 성질이고
가정용 인스턴스에서는 무의미하다. 나이트로도 올리지 않는다.)

### Q7. 리포트의 변이표가 이 HEAD에서 맞는가, 다섯 테스트 중 주장과 다른 이유로 통과하는 것이 있는가?

**변이표 5줄은 전부 정확하다** (위 표 M1~M5, 실패한 테스트 이름까지 일치).

**하지만 "이 다섯 테스트가 각각 그 이유로 통과한다"는 더 강한 명제는 성립하지 않는다.**

- `should skip quietly when the asset disappeared during the window` — **주장하는 이유로
  통과하지 않는다.** `!fresh` 가드를 없애도 죽지 않는다(M7, `92 passed`). §N1.
- `should not retry when the path has not changed` — **부분적으로만.** "항상 재시도"는 잡지만
  (M6) "재시도 없음"은 못 잡는다(M1에서 생존). §N2.
- 나머지 셋(`retry once…`, `report the path it actually failed on…`, 백필 4개)은 각각 자기
  이름이 말하는 변이에서 죽는다 — 의도한 이유로 통과한다.

---

## What I did not verify

- **web 유닛 39개와 svelte-check 베이스라인 게이트.** 이 워크트리에 `web/node_modules`가 없고
  (`ls: cannot access 'web/node_modules'`), 설치는 워크트리를 건드리므로 하지 않았다. 리포트의
  `web (unit) Tests 39 passed`와 `no svelte-check regressions vs baseline`은 **재현하지 못했다.**
  대신 i18n 키 정렬·유일 사용처·다른 호출자 여부는 정적으로 확인했다(위 표).
- **CI 실행 결과.** 이 환경에 `gh`가 없다(`gh: command not found`). 이전 라운드들처럼
  Actions 실행을 대조하지 못했다.
- **실제 경합의 재현.** 리포트가 스스로 적은 그대로다 — **mock을 통해서만** 확인했다. 실
  파일시스템에서 storage-template 잡과 Drive 잡을 경주시키지 않았고, 내가 §M1에서 주장한
  "죽은 move 창"도 `storage.core.ts` 코드 읽기에서 나온 구조적 결론이지 재현한 것이 아니다.
- **`drive.file` 스코프로 폴더 이름을 읽을 수 있는지.** 실제 Drive 응답은 전혀 보지 않았다.
  피커로 고른 폴더가 앱에 부여된다는 전제도, 손으로 붙여넣은 폴더가 도달 불가능하다는
  전제도 검증하지 않았다 — §M4는 **후자가 참일 때** 무엇이 문제인지를 다룬 것이다.
- **평시 창의 실제 폭.** "UPDATE 한 번의 왕복"은 구조에서 나온 것이고, 밀리초를 재지 않았다.
  풀 포화 시 늘어난다는 것도 측정하지 않았다.
- **`mise //server:ci-unit` / `//web:ci-unit` 전체.** 대신 서버 전체 vitest(2,383) + 변경
  파일에 대한 `tsc --noEmit`과 `eslint --max-warnings 0`을 돌렸다. format 단계는 돌리지 않았다.
- **마이그레이션 드리프트.** 이번 변경에 스키마 변경이 없어 생략했다.
- **H1의 재현.** 동시성 창은 코드를 읽어 논증했고, 실제로 두 요청을 경주시키지는 않았다.

`git status --porcelain`은 종료 시점에 **이 리뷰 파일 하나만** 보고한다. 모든 변이는 실행
직후 원본 복사본으로 되돌렸고, 다른 파일은 하나도 수정하지 않았다.

---

## Feeding back into the plan

`dev-docs/google-drive/`에 다음을 남길 것을 권한다.

1. **"mover는 트랜잭션을 쓰지 않는다"를 기능 문서에 못박는다.** 이번 라운드의 주석·커밋
   메시지가 둘 다 "same transaction"이라고 단언했고, 그건 다음 사람이 "창은 없다"고 읽게
   만든다. 사실은 `storage.core.ts:240` → `:268`의 두 문장이고, **rename 후 savePath 전에
   죽으면 창은 무기한**이다. `feature-roadmap.md`나 `failure-handling-plan.md`에 이 한 문단.
2. **"pending으로 남으면 자동으로 낫는다"는 표현을 쓰지 않는다.** 이 저장소에서 재큐잉의
   유일한 생산자는 관리자 Jobs 화면(`queue.service.ts:249`)이다. `CLAUDE.md`의 Current
   Project에도 이미 적혀 있는 사실인데, 이번 리포트 §1이 다시 "다음 동기화가 가져간다"로
   썼다. 실패 처리 문서에 **"자동 재큐잉은 없다"**를 한 줄로 고정한다.
3. **CAS 규칙을 기능 규칙으로 승격한다.** round-22가 `setDriveAccountId`에 넣은 가드
   (`refreshToken` 일치 + 대상 컬럼 null)를 "읽기 시점의 credentials로 되돌아가 쓰는 모든
   경로"의 **기본형**으로 문서화한다. H1은 그 규칙이 문서에 없어서 한 라운드 만에 재발한
   것이다. 백필·드레인·입양처럼 "느린 외부 호출 뒤에 쓰는" 코드가 앞으로도 늘어난다.
4. **`getStatus`의 지연 예산을 정한다.** 이 엔드포인트는 이제 설정 화면과 **앨범 메뉴** 양쪽의
   임계 경로에 있고, 최악의 경우 직렬 Drive 호출 2회(각 10초 + 무제한 토큰 갱신)를 문다.
   "페이지 로드 경로에서 외부 호출은 병렬로, 실패는 긴 백오프로"를 `wave6-plan.md`(설정 구조
   문서)에 적어 둔다.
5. **테스트 규칙에 한 줄 추가.** `.claude/rules/testing.md`의 "부정 단언" 항목에
   **"가드 자체를 변이시켜 죽는지 확인한다"**를 명시한다. N1은 부정 단언이 아니라
   **가드 분기**가 공허했던 사례다 — 예외가 종류만 바뀌고 같은 catch로 흡수되면 단언이
   구별하지 못한다. 변이 목록에 "분기 조건 반전"을 상시 포함한다.
6. **배포 후 관측 항목에 "이동 재시도가 발동했는가"를 넣는다.** M2를 반영해 로그 레벨을
   올린 뒤, 런북의 배포 직후 절차에
   `docker logs immich_server | grep 'moved .* while the upload was queued'`를 추가한다.
   지금 상태로는 이 수정이 발동했는지 알 방법이 아예 없다.
