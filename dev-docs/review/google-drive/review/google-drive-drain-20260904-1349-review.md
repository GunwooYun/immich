# Code Review — 미상 버킷 드레인(R1), 영구 매칭(R3), 판단 이관(R4), 그리고 round-18 C1 회귀 수정

|                  |                                                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch / HEAD    | `feat/google-drive-album-sync-v3.1.0` / `6f4668f0a`                                                                                                                                                      |
| Commits reviewed | `a6729a3ec`(round-18 C1 회귀 수정), `a6c9c213b`(R1/R3/R4). `6f4668f0a`는 리포트 + 증거 파일                                                                                                              |
| Report           | `../report/google-drive-drain-20260904-1333-report.md`                                                                                                                                                   |
| Prior review     | `google-drive-probe-guards-20260904-1146-review.md`                                                                                                                                                      |
| Reviewed         | 2026-09-04                                                                                                                                                                                               |
| 작업 환경        | 격리 워크트리 `/tmp/gd-review-26064`(detached `6f4668f0a`) + 컨테이너 `gd-rev-pg`(`ghcr.io/immich-app/postgres:14-vectorchord0.4.3`, 전 마이그레이션). 빌드·변이·SQL 생성기·psql 실험은 전부 그 안에서만 |

## Verdict

**`a6729a3ec`(C1 회귀 수정)는 옳다 — 실 DB로 재현해 확인했다.** 그러나 `a6c9c213b`의 R1은
**막으려던 되돌릴 수 없는 실패를 새로 하나 만든다.** `drainUnstampedUploads`는
`credentials.driveAccountId ?? probe`로 계정을 정하는데, 스탬프가 이미 찍혀 있으면 **토큰을 아예
보지 않는다**(프로브가 호출되지 않는 것을 단위 테스트로 확인했다). 그래서 연결 #1(계정 A, 미식별)이
남긴 `''` 행이 아직 있는 상태에서 연결 #2(계정 B, 식별됨)를 해제하면, 그 행들이 **B로 영구히
오귀속**된다. 그 순간 A가 다시 연결하면 `hasUpload`가 `t → f`로 뒤집혀(실 Postgres에서 확인)
**A의 드라이브에 중복 업로드**가 발생한다. R3만 있었다면 그 행들은 `''`로 남아 A와 계속 매칭됐다 —
즉 **R1이 "건너뛴다(회복 가능)"를 "중복 업로드(회복 불가)"로 바꿀 수 있다.** 게다가 이 동작은
바로 위 열 줄 아래의 주석(`google-drive.service.ts:368-371`, _"Deliberately does NOT adopt unstamped
rows … adopting on this path would recreate the original bug one last time"_)과 정면으로 모순되고,
드레인 자신의 JSDoc(`:404`, _"always with the outgoing token"_)도 사실이 아니다.

두 번째로 중요한 것: **직전 라운드 C2(생성 SQL 미재생성)는 재현된다. 두 배로 재현된다.** 그리고
**리포트가 왜 재현하지 못했는지도 특정했다** — 생성기를 _마이그레이션이 적용되지 않은_ DB에 돌리면
첫 문장이 예외를 던져 두 번째 문장이 실행되지 않고, 결과가 커밋본과 **바이트 단위로 일치**하며
`Generated 426 queries`도 똑같이 찍힌다. 전 마이그레이션 DB에서 돌리면 **+21줄**이 나온다
(`setDriveAccountId`의 select 7줄 + `getErrorSummary`의 blocking select 14줄). 즉 "426 쿼리, diff 0"은
**드리프트를 탐지할 수 없는 측정**이었다. 업스트림 `test.yml:758`/`:841`이 이 상태에서 실패한다.

나머지(테스트 253/39/23, R3 양방향, 순서 단언의 비공허성, 프로브 실패해도 연결 해제 진행)는 전부
리포트대로다. 두 커밋 모두 **원격에 푸시되지 않았다** — `git branch -r --contains a6c9c213b`가 비어
있고 `origin/feat/…`는 아직 `fe9fe4fed`다. CI는 한 번도 돌지 않았다.

### Evidence I ran myself

| Check                                                                    | Result                                                                                                      |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 서버 유닛 8스펙(`run.sh`의 `SERVER_SPECS`), `6f4668f0a`                  | `Test Files 8 passed / Tests 253 passed` — 리포트와 일치                                                    |
| 웹 유닛 4스펙                                                            | `Tests 39 passed` — 일치                                                                                    |
| medium `google-drive.repository.spec.ts`(testcontainer, 전 마이그레이션) | `Tests 23 passed` — 일치                                                                                    |
| `npx tsc --noEmit`(server)                                               | rc=0                                                                                                        |
| `prettier --check` (변경된 TS 4파일) / `eslint --max-warnings 0`         | 둘 다 클린                                                                                                  |
| **SQL 생성기, 전 마이그레이션 DB**(`node dist/bin/sync-sql.js`)          | `google.drive.repository.sql` **+21줄** 1파일 변경, `Generated 426 queries`                                 |
| **같은 생성기, 마이그레이션 없는 빈 DB**                                 | **diff 0**, `Generated 426 queries` — 리포트의 관측을 그대로 재현                                           |
| **실 DB**: 같은 update를 두 번(경합 시뮬레이션)                          | `UPDATE 1` → `UPDATE 0`, 그 뒤 select는 `account-x` — 옛 boolean이 왜 `''`을 만들었는지 확정                |
| **실 DB**: 재링크 후 옛 토큰으로 select                                  | `rows_for_old_token = 0` → `null` — 토큰 가드는 살아 있다                                                   |
| `server/src/config.ts:296`                                               | `[QueueName.GoogleDriveUpload]: { concurrency: 5 }` — 동시성 5 확인                                         |
| **변이**: 드레인을 `upsertCredentials`/`deleteCredentials` **뒤로** 이동 | 순서 단언 2건이 정확히 실패 — 비공허                                                                        |
| **변이**: `ledgerMatches`에서 `or … = ''` 제거                           | medium 1건만 실패(`hasUpload` 케이스). 나머지 6개 확장 지점은 무커버                                        |
| **변이**: `setDriveAccountId`의 **update** 쪽 `refreshToken` 조건 제거   | medium 1건 실패 — 리포트대로                                                                                |
| **변이**: `setDriveAccountId`의 **select** 쪽 `refreshToken` 조건 제거   | **23/23 통과** — 이 절반은 테스트가 없다 (N1)                                                               |
| **변이**: `getDriveAccountId`의 try/catch 제거                           | 14건 실패, 그중 `should disconnect even when the outgoing account cannot be identified` 포함 — 비공허       |
| **단위 실증**: 식별된 연결(`account-b`)에서 `disconnect`                 | `adoptUnstampedUploads(userId, 'account-b')` 호출, `driveAboutGet` **호출 0** — 드레인이 토큰을 보지 않는다 |
| **실 DB 실증**: `''` 행 → B가 드레인 → A 재연결                          | `has_upload` **t → f** — 재업로드(중복) 경로                                                                |
| `grep -c timeout src/services/google-drive.service.ts`                   | **0** — 직전 라운드 H2(b) 그대로, 이제 `disconnect`까지 물린다                                              |
| `git branch -r --contains a6c9c213b` / `origin/…` HEAD                   | 비어 있음 / `fe9fe4fed` — **CI 미실행**                                                                     |
| 워크트리 `git status --porcelain`(변이 복원 후)                          | 클린(심볼릭 링크한 `node_modules` 외)                                                                       |

---

## Findings

### C1 — 생성 SQL이 두 곳에서 낡았고, 리포트의 "재현 불가"는 **마이그레이션되지 않은 DB에서 돌린 결과**다 (Critical, 증거·CI)

커밋된 `server/src/queries/google.drive.repository.sql`은 두 블록이 **각각 첫 문장만** 담고 있다.

```
:26-33   -- GoogleDriveRepository.setDriveAccountId   → update 만. a6729a3ec가 추가한 select 없음
:421-446 -- GoogleDriveRepository.getErrorSummary     → count 만. getBlockingError의 select 없음
```

전 마이그레이션 DB(`gd-rev-pg`, `npx sql-tools migrations run` 완료)에서 `node dist/bin/sync-sql.js`를
돌리면 정확히 그 두 문장, **+21줄**이 추가된다:

```
 server/src/queries/google.drive.repository.sql | 21 +++++++++++++++++++++
```

**리포트와 나의 불일치는 이렇게 갈렸다.** 같은 바이너리를 마이그레이션 **없는** 빈 DB에 돌리면
`git diff`가 **비어 있고** `Generated 426 queries`도 똑같이 찍힌다. 이유는 `sync-sql.ts:157-165`가
메서드를 `await`으로 호출하고 실패를 `handleError`로 흡수하기 때문이다 — 첫 문장이 예외를 던지면
**두 번째 문장은 실행 자체가 되지 않아** 로그에 남지 않는다. 그래서 다중 문장 메서드만 잘린다.
그리고 통계의 "426"은 `Object.values(this.results).flat().length`, 즉 **블록 수**이지 문장 수가
아니므로(`sync-sql.ts:186-189`) 두 경우 모두 426이다 — **"426 쿼리, diff 0"은 이 드리프트를 원리적으로
탐지할 수 없는 측정이다.** 리포트가 두 라운드 연속 재현에 실패한 것은 부주의가 아니라 **생성기를
돌린 DB의 상태** 때문이다.

업스트림 CI에는 이 잡이 있다 — `.github/workflows/test.yml:758` `sql-schema-up-to-date`,
`:841` "Verify SQL files have not changed". 포크 워크플로 `fork-google-drive.yml`에는 SQL 스텝이
아예 없다(잡 이름 3개: Feature suite / Full sweep / Medium).

**Fix.**

1. 전 마이그레이션 DB에 대해 `mise //:sql`을 돌리고 `google.drive.repository.sql`을 같이 커밋한다.
2. 절차에 **"생성기를 돌리기 전에 `migrations run`을 확인한다"** 를 한 줄 넣는다. 이것이 두 라운드를
   태운 실제 원인이다.
3. `fork-google-drive.yml`에 `mise //:sql && git diff --exit-code server/src/queries` 한 스텝을
   추가한다. 지금 이 드리프트를 볼 수 있는 곳은 어디에도 없다.

---

### H1 — 드레인이 **그 행들을 쓸 수 없었던 계정**으로 미상 버킷을 찍는다. "건너뛴다(회복 가능)"가 "중복 업로드(회복 불가)"가 된다 (High, 이 커밋이 만든 결함)

`server/src/services/google-drive.service.ts:421-422`:

```ts
const driveAccountId = credentials.driveAccountId ?? (await this.getDriveAccountId(userId, credentials.refreshToken));
```

`driveAccountId`가 이미 찍혀 있으면 **토큰을 보지 않는다.** 워크트리에 임시 테스트를 넣어 확인했다 —
credentials가 `{token-b, account-b}`인 상태에서 `disconnect(userId)`를 부르면
`adoptUnstampedUploads(userId, 'account-b')`가 호출되고 `driveAboutGet`은 **한 번도 호출되지 않는다.**
그리고 `adoptUnstampedUploads`(`google-drive.repository.ts:133-157`)는 그 사용자의 `''` 행을
**조건 없이 전부** 그 계정으로 갱신한다.

**재현 시나리오(프로브 실패 한 번만 필요하다).**

| 단계                                                                             | 상태                                                                   |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1. 계정 A 연결, 프로브 실패 → `driveAccountId = NULL`                            | 업로드 N건이 `''`로 기록. 파일은 **A의 드라이브**에 있다               |
| 2. 연결 해제. 드레인이 A의 토큰으로 프로브 → 또 실패                             | 행은 `''` 유지 (여기까진 R3의 안전망대로다)                            |
| 3. 계정 B 연결, 프로브 성공 → `driveAccountId = 'B'`                             | R3 덕에 B는 그 N건을 "업로드됨"으로 건너뛴다 (**회복 가능**)           |
| 4. **B를 연결 해제** → 드레인이 `credentials.driveAccountId = 'B'`를 그대로 사용 | N건이 **`'B'`로 영구 오귀속**                                          |
| 5. A 재연결                                                                      | `''`도 `'A'`도 아니므로 매칭 실패 → **A의 드라이브에 N건 중복 업로드** |

실 Postgres에서 그대로 확인했다(예측 없이 실제 predicate로 실행):

```
 A reconnects, no drain ran   | has_upload = t
 A reconnects after B drained | has_upload = f
```

4단계가 없었다면 5단계는 `t`였다. **즉 R1이 R3의 안전망을 걷어낸다.** 3단계까지가 리포트가 말하는
"회복 가능한 실패"인데, 4단계가 그것을 이 포크가 가장 피하고 싶어 하는 방향(`files.create`에 멱등
검사 없음 → 되돌릴 수 없는 중복)으로 밀어 넣는다. 연결 해제 없이 **재링크를 두 번** 해도 같다.

**왜 주석이 이것을 못 막았나.** `:404-405`는 _"always with the **outgoing** token, which is the only
moment we can say with certainty whose uploads those rows are"_ 라고 적는데, 위 분기에서는 토큰을
쓰지 않는다. 그리고 `:368-371`의 기존 불변식 — _"Deliberately does NOT adopt unstamped rows … adopting
on this path would recreate the original bug one last time"_ — 은 `:375`의 드레인 호출로 **깨졌는데
지워지지도 수정되지도 않았다.**

**Fix (권고 순).**

1. 드레인을 `credentials.driveAccountId === null`일 때만 돌게 한다. 그러면 계정은 **반드시 떠나는
   토큰으로 프로브해서** 얻은 값이 되고, 주석이 주장하는 속성이 실제로 참이 된다. 랩탑의 6,996행
   시나리오(연결이 미식별)는 100% 그대로 커버된다 — **잃는 것이 없다.**
2. 그것으로도 남는 잔여물(A 미식별 → B 미식별 → B가 나중에 식별되며 드레인)까지 닫으려면 직전
   라운드 4절의 시각 기준(`uploadedAt >= connectedAt`)이 그대로 답이다. 드레인도 같은 술어를 써야
   한다. 코드가 못 하는 판정을 R4로 넘긴 것과 같은 논리로, **드레인도 판정할 수 없는 것을 판정하고
   있다**는 점이 이 항목의 핵심이다.
3. 어느 쪽을 택하든 `:368-371`의 죽은 불변식 주석은 지우고 `:404-405`의 "always with the outgoing
   token"을 실제 동작에 맞춘다.

---

### H2 — `disconnect`가 이제 **상한 없는 구글 왕복**에 의존한다. `grep -c timeout` = 0 (High)

`google-drive.service.ts:821`이 `deleteCredentials` 앞에 드레인을 넣었고, 미식별 연결에서는 그것이
`getDriveAccountId` → `about.get`(`:506-508`)이다. **이 파일에 `timeout` 문자열은 0건**이고
`about.get`에 요청 옵션도 없다. 즉 구글이 **거절**하는 것이 아니라 **응답하지 않으면** 연결 해제
버튼이 같이 멈춘다 — 그리고 그 버튼이 있는 화면은 사용자가 "뭔가 잘못됐다"고 느껴서 오는 화면이다.

추가된 테스트(`google-drive.service.spec.ts:1379-1392`)는 `driveAboutGet.mockRejectedValue`로 **거절만**
덮는다. hang은 덮지 않는다. 코멘트 `:819-820`의 _"Never allowed to block the disconnect itself"_ 는
현재 코드가 보장하지 않는다 — 구글 hang뿐 아니라 `getCredentials`/`adoptUnstampedUploads`의 DB 예외도
그대로 `disconnect`를 실패시킨다.

같은 이유로 `linkAccount`의 OAuth 콜백은 이제 구글 왕복이 **둘**(드레인 프로브 + `getDriveAccountId`)
이다. 브라우저 리다이렉트가 그만큼 더 오래 매달리고, 사용자가 재시도하면 링크 콜백이 겹친다.

**Fix.** `about.get`에 `{ timeout: 10_000 }`(googleapis가 요청 옵션으로 받는다). 그리고 드레인 전체를
`try { … } catch { logger.warn }`으로 감싸 코멘트가 약속한 "절대 막지 않는다"를 코드로 만든다.
H1의 fix 1(미식별일 때만 드레인)을 함께 적용하면 식별된 연결의 해제는 **네트워크 호출 0**이 된다.

---

### M1 — R3는 계정 스코핑을 **`''` 버킷에 대해 영구 무력화**한다. 이것을 "버그"라고 부르는 주석 두 곳이 그대로 남아 있다 (Medium — 요청 2번의 답)

확장된 술어는 7개 지점 전부에 일관되게 적용됐다(`google-drive.repository.ts:335, 389, 425, 485, 536,
609, 797`). 그중 `:425`/`:485`는 `countPendingUploads`와 `streamPendingUploads`, 즉 **백필이 무엇을
큐에 넣는지**를 정한다. 따라서 `''` 행은 **새 계정에서도 영원히 "이미 업로드됨"** 이다.

그런데 그 동작을 정확히 버그로 규정한 문장이 두 곳에 살아 있다:

- `google-drive.service.ts:362-364`: _"connect a different account and none of the old rows match, so
  the backlog recomputes by itself."_ — `''` 버킷에 대해 **이제 거짓**이다.
- `server/src/schema/tables/google-drive-upload.table.ts:21-23`: _"Keying on (userId, assetId) alone was
  the bug — connecting a different Google account left every asset reading 'already uploaded', so the
  new Drive stayed empty forever while the UI reported the library synced."_ — R3가 `''` 행에 대해
  **그 상태를 그대로 되살린다.**

**어떻게 보이는가(요청 2번).** 사용자에게는 **아무것도 보이지 않는다.** `GoogleDriveAlbumStatusDto`의
`uploadedCount`는 그 자산들을 업로드된 것으로 세므로 앨범 메뉴는 "N/N 백업됨"을 보여주고,
`GoogleDriveMyStatusDto.pending`은 0이며, **어떤 DTO도 연결된 구글 계정을 노출하지 않는다**
(`src/dtos/google-drive.dto.ts`에 `driveAccountId` 0건). 새 드라이브는 비어 있는데 UI는 완료라고 말한다.

**어떻게 회복하는가.** 코드에는 경로가 **없다.** `deleteFrom('google_drive_upload')`는 저장소 전체에서
`adoptUnstampedUploads` 안의 중복 제거용 한 곳뿐이다(`:136`). 유일한 회복은 운영자의 수동 SQL
(`delete from google_drive_upload where "userId"=… and "driveAccountId"=''`)이고, 이것은 **런북에 없다.**

**가장 큰 리스크는 여기다.** 네 라운드째 미검증인 _"`drive.file` 스코프에서 `about.get`이
`permissionId`를 채우는가"_ 가 만약 **아니오**라면, 모든 사용자·모든 행이 영구히 `''`이 되고 R3는
`driveAccountId` 기능 전체를 무해한 no-op으로 만든다 — 그리고 그 실패는 **시끄러운 실패(라이브러리
재업로드)에서 조용한 실패(계정 전환이 아무 일도 안 함)로 바뀐다.** 조용한 쪽이 더 안전하다는 판단
자체는 동의하지만, 그 대가는 문서에 적혀야 한다.

**Fix.** (a) 위 두 주석을 R3 이후의 진실로 고친다. (b) 런북에 회복 절차(`delete … where
"driveAccountId" = ''` 한 줄, 그리고 그 뒤 백필이 어떻게 도는지)를 적는다. (c) `''` 버킷의 잔량을
로그나 관리자 화면 어딘가에서 볼 수 있게 하는 것을 다음 웨이브 후보로 올린다.

---

### M2 — R4가 요구하는 확인은 **지금 형태로는 사람이 수행할 수 없다** (Medium — 요청 4번의 답)

`CLAUDE.md:410-411`: _"위 쿼리의 `driveAccountId`가 실제로 쓰던 구글 계정인지 눈으로 확인한다."_

두 가지가 막는다.

1. **그 쿼리는 `driveAccountId`를 출력하지 않는다.** `CLAUDE.md:388-391`의 select 목록은
   `u."userId"`, `u."driveAccountId" is null as unidentified`, `count(...) as unstamped` 뿐이다.
   값 자체는 화면에 뜨지 않는다.
2. **뜨더라도 알아볼 수 없다.** 저장되는 값은 `about.get({ fields: 'user(permissionId)' })`
   (`google-drive.service.ts:506-508`)의 Drive **permissionId** — `061841899…` 같은 불투명한 숫자
   문자열이다. 이메일도 아니고, 구글 계정 화면 어디에도 표시되지 않는다. 성공 경로는 그 값을
   **로그로도 남기지 않는다**(`:510-518`은 실패했을 때만 warn한다). API/UI에도 없다(M1).

즉 R4는 "코드가 판정할 수 없으니 사람이 보라"고 넘겼는데, **사람이 볼 수 있는 표현이 존재하지
않는다.** 판단이 이관된 게 아니라 사라졌다.

**Fix (셋 다 작다).**

1. 런북 쿼리에 `u."driveAccountId"`를 실제로 select한다.
2. 프로브 성공 시 `emailAddress`를 **로그로만** 남긴다:
   `about.get({ fields: 'user(permissionId,emailAddress)' })` 후
   `logger.log('Identified … as <email> (<permissionId>)')`. 저장하지 않으므로 스키마 영향 0이고,
   운영자는 로그 한 줄에서 자기 계정을 즉시 알아본다. (단 `drive.file` 스코프에서 `emailAddress`가
   채워지는지는 **미검증** — 실 OAuth가 필요하다. `permissionId` 자체의 미검증 항목과 같은 실험에서
   한꺼번에 확인할 수 있다.)
3. 그것마저 어려우면 런북의 관문을 "값을 알아보라"가 아니라 **"연결을 끊지 말고, `unstamped`가 0으로
   떨어지는지 본다"** 처럼 _관측 가능한_ 것으로 바꾼다.

---

### M3 — 런북이 스스로와 세 곳에서 모순된다 (Medium, 문서)

`a6c9c213b`가 새 문단을 **추가만** 하고 옛 문장을 손대지 않아, 위에서 아래로 읽으면 반대되는 지시를
차례로 만난다.

| 줄                  | 문장                                                                                            | 현재 진실                                  |
| ------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `CLAUDE.md:375-376` | "입양이 돌기 전에 연결을 해제하고 다시 연결하면 … **라이브러리 전체가 중복으로 다시 올라간다**" | R3 때문에 **거짓**. 여전히 매칭된다        |
| `CLAUDE.md:406-409` | "0이 되지 않아도 재업로드는 나지 않는다"                                                        | 참 (위와 정면 모순)                        |
| `CLAUDE.md:415-416` | "입양은 기존 토큰이 살아 있는 동안에만 일어난다(**연결 경로에서는 절대 하지 않는다**)"          | R1 때문에 **거짓**. 링크 경로가 드레인한다 |

`:413-414`(새로 추가된 "연결 해제·재연결을 먼저 해도 안전하다")와 `:415-416`은 **붙어 있는 두 줄**이
서로를 부정한다. 운영자가 첫 경고에서 멈추면 R1/R3가 준 자유를 못 쓰고, 마지막 줄을 믿으면 드레인이
도는 것을 모른다.

**Fix.** 세 문장을 한 문단으로 통합해 다시 쓴다. 그리고 직전 라운드 피드백 5번(닫은 것 / 부분만 닫은
것 / 의도적으로 둔 것을 세 칸 표로)을 이번엔 **문서 자체에도** 적용한다 — 문서를 고칠 때 "무엇이
이제 거짓이 되었는가"를 같이 훑는 절차가 없다.

---

### M4 — 드레인의 `adoptUnstampedUploads`에는 **`setDriveAccountId`가 가진 토큰 가드가 없다** (Medium)

직전 라운드 H1이 `setDriveAccountId`에 `.where('refreshToken', '=', refreshToken)`를 넣은 이유는
"프로브가 떠 있는 동안 연결이 바뀌면 쓰지 않는다"였다. 그런데 드레인은 프로브(네트워크, 상한 없음)를
끝낸 뒤 `adoptUnstampedUploads(userId, driveAccountId)`를 **아무 조건 없이** 부른다
(`service.ts:430`, `repository.ts:133-157`). 즉 프로브가 도는 동안 연결이 바뀌어도 옛 계정으로 전부
찍는다. `linkAccount`의 드레인 → `upsertCredentials` 구간에 트랜잭션도 잠금도 없으므로, 링크 콜백이
겹치거나 해제와 링크가 경합하면 창이 열린다.

발생 확률은 H1보다 훨씬 낮다(사용자 조작이 겹쳐야 한다). 다만 **직전 라운드가 정확히 이 클래스의
버그로 한 라운드를 태웠고**, 그때 세운 가드를 새 호출 지점에 옮기지 않은 것이 패턴이다.

**Fix.** `adoptUnstampedUploads`에 `refreshToken`(또는 `connectedAt`) 조건을 옵션으로 받아
드레인 경로에서 CAS로 쓴다. H1의 fix 1을 적용하면 창이 크게 줄지만 사라지지는 않는다.

---

### N1 — `setDriveAccountId`의 **select 쪽** `refreshToken` 조건은 테스트가 없고, 논리적으로도 결과를 바꾸지 못한다 (Low)

`google-drive.repository.ts:104`의 `.where('refreshToken', '=', refreshToken)`를 지우고 medium을
돌리면 **23/23 통과**한다. (update 쪽 `:93`을 지우면 리포트대로 토큰 테스트 1건만 실패한다.)

논리로 따져도 이 가드가 결과를 바꾸는 경우를 찾지 못했다. select가 이 조건 없이 다른 값을 돌려주면
`settled !== driveAccountId`가 되어 어차피 `''`이고, 같은 값을 돌려준다는 것은 **새 연결도 같은
계정**이라는 뜻이라 입양이 옳다. 커밋 메시지의 _"a changed token still is [failure], because the read
is scoped to the token too"_ 는 **의도**이지 테스트나 필요성이 뒷받침하지 않는다.

**Fix.** 둘 중 하나. (a) medium 케이스를 하나 더 넣어 의도를 고정한다(같은 계정·다른 토큰 → `null`),
또는 (b) 주장을 낮춘다. 지금은 "가드가 있다"고 말하지만 아무도 그것을 지키지 않는다.

---

### N2 — 두 커밋 모두 **증거 파일이 부모 커밋에서 뽑혔고**, 커밋 메시지의 유닛 테스트 수가 틀렸다 (Low, 3·4번째 반복)

| 커밋        | 담긴 증거 파일      | 파일 헤더의 `commit:` | 파일이 보고한 수 | 커밋 메시지의 `Test:` |
| ----------- | ------------------- | --------------------- | ---------------- | --------------------- |
| `a6729a3ec` | `20260904-1156.txt` | `17c0f3a82`(부모)     | 250/39/22        | **249**/39/22         |
| `a6c9c213b` | `20260904-1324.txt` | `a6729a3ec`(부모)     | 253/39/23        | **249**/39/23         |

리포트가 인용한 `20260904-1333.txt`는 헤더가 `a6c9c213b`로 **옳고** 253/39/23이며, 내 재현과 일치한다.
즉 HEAD에서는 자체 수정되지만, `7128a36fc`가 고치고 직전 리뷰 L2가 다시 지적한 실수가 **두 번 더**
반복됐다. 커밋 메시지의 `249`는 두 번 다 낡은 숫자다(직전 리뷰 L3와 같은 항목).

**Fix.** 커밋 훅 한 줄: 결과 파일의 `commit:`이 `git rev-parse --short HEAD`와 다르면 거부. 지금은
사람이 기억해야 하는데 네 번 중 세 번 실패했다.

---

### N3 — 직전 라운드 L1(겹친 JSDoc)이 남았고, 이제 **엉뚱한 함수에 붙었다** (nitpick)

`google-drive.service.ts:389-398`의 고아 JSDoc(내용은 `adoptIfNewlyIdentified`의 것: _"Safe here and
nowhere else … Doing the same inside linkAccount would be unsafe"_)이 `:399-414`의 드레인 JSDoc **바로
위**에 붙어, 선언(`:415 private async drainUnstampedUploads`)을 두 블록이 나눠 갖는다. 읽는 사람이
먼저 만나는 문단이 **"linkAccount에서 이걸 하면 위험하다"** 이고, 그 아래 함수는 linkAccount에서
호출된다. H1과 같은 오해를 문서 차원에서 한 번 더 만든다.

**Fix.** `:389-398`을 지운다. 한 줄짜리 삭제다.

---

### N4 — 리포트 헤더의 HEAD가 `a6c9c213b`인데 실제 리뷰 대상 HEAD는 `6f4668f0a` (nitpick)

리포트 자신이 `6f4668f0a`로 커밋됐으니 불가피한 면이 있다. 리포트가 인용한
`linkAccount:372-373`은 부모 `a6729a3ec` 기준으로 **정확**하다(확인함).

---

## Answers to what the report asked me to attack

### 1. 드레인의 커버리지 — **연결이 끝나는 경로는 셋이고, revoked 자동 해제를 제외한 판단은 결론은 맞지만 근거가 틀렸다.**

`user_google_drive` 행을 지우거나 바꾸는 지점은 정확히 셋이다(`grep -rn 'deleteCredentials\|upsertCredentials' src/ | grep -v spec`):

| 지점                                                                  | 드레인 | 비고   |
| --------------------------------------------------------------------- | ------ | ------ |
| `google-drive.service.ts:378` `upsertCredentials`(linkAccount)        | O      | `:375` |
| `google-drive.service.ts:823` `deleteCredentials`(disconnect)         | O      | `:821` |
| `google-drive.service.ts:1126` `deleteCredentials`(revoked 자동 해제) | **X**  | 아래   |

그 외에는 없다. 사용자 삭제는 FK CASCADE로 원장까지 같이 사라지므로 드레인할 대상 자체가 없고
(`google-drive-upload.table.ts:33-35`), 관리자 경로·마이그레이션·설정 경로에는 자격 증명을 지우는
코드가 없다.

**리포트의 제외 근거는 절반이 틀렸다.** _"권한이 이미 없어 프로브가 실패한다"_ 는 `driveAccountId`가
`NULL`일 때만 성립한다. 이미 식별된 연결이면 드레인은 **네트워크 호출을 아예 하지 않는다** — 위에서
단위 테스트로 확인했다(`driveAboutGet` 호출 0). 즉 제외된 그 경로는 **드레인이 가장 싸고 가장 확실한
경우**를 포함한다.

**그럼에도 나는 거기에 드레인을 넣지 말라고 권한다 — 다만 다른 이유로.** H1이 보였듯 "찍혀 있는
스탬프를 그대로 쓰는" 분기가 바로 오귀속의 원천이다. revoked 경로에 그것을 추가하면 위험만 늘어난다.
H1의 fix 1(미식별일 때만 드레인)을 적용하면 revoked 경로에서 할 수 있는 안전한 일이 **정말로 없어져서**
제외가 옳은 이유로 옳아진다. 지금은 결론만 맞고 근거가 틀린 상태이므로, 코드 주석/리포트의 근거
문장을 고쳐야 한다.

### 2. R3가 계정 스코핑을 얼마나 약화시키는가 — **`''` 버킷에 대해 완전히 무력화하고, 사용자에게는 전혀 보이지 않으며, 회복은 수동 DELETE뿐이다.**

M1 전문. 요약: 확장 술어는 백필 선택 쿼리(`countPendingUploads:425`, `streamPendingUploads:485`)에도
걸리므로 새 계정은 그 자산들을 **영원히** 큐에 넣지 않는다. UI에는 `uploadedCount`가 "완료"로 보이고
(`GoogleDriveAlbumStatusDto`), `pending`은 0이며, 연결된 계정을 보여주는 DTO 자체가 없다. 원장을
지우는 코드 경로는 존재하지 않으므로 회복은 운영자의 수동 `delete … where "driveAccountId" = ''`
뿐이고 런북에 없다. 그리고 프로브가 **구조적으로** 실패한다면 이 상태가 전 사용자·전 행에 적용되어
`driveAccountId` 기능 전체가 조용히 no-op이 된다.

판단 자체("건너뛰는 쪽이 중복보다 낫다")에는 동의한다. 반대하지 않는 것은 **대가의 크기**가 아니라
**대가가 어디에도 적혀 있지 않다**는 점이다.

### 3. 순서 단언의 강도 — **`invocationCallOrder`는 여기서 옳은 도구다. 단일 스레드 호출 순서만 보는 것이 맞지만, 이 불변식은 애초에 경쟁이 아니라 순차 불변식이다.**

변이로 확인했다. `drainUnstampedUploads` 호출을 `upsertCredentials`/`deleteCredentials` **뒤로** 옮기면
두 테스트가 정확히 실패한다(다른 70건은 통과). 특히 disconnect 케이스는 `getCredentials` 목이 정적이라
**삭제 후에도 같은 행을 돌려주므로**, `adoptUnstampedUploads`가 호출되었다는 사실만으로는 아무것도
못 잡는다 — 순서 단언이 **유일한** 감지 수단이다. 그 의미에서 비공허하다.

다만 두 가지는 대변하지 못한다.

- **드레인과 upsert 사이의 인터리빙.** 둘을 감싸는 트랜잭션도 잠금도 없다. 링크 콜백 둘이 겹치거나
  해제가 링크와 경합하는 축은 이 테스트가 아무 말도 하지 않는다(M4).
- **`invocationCallOrder[0]`은 전역 카운터의 첫 호출**이다. 지금은 두 목이 각각 정확히 한 번만
  호출되므로 문제없지만, 나중에 어느 한쪽이 두 번 호출되면 단언이 조용히 엉뚱한 호출을 비교한다.
  주석 한 줄("둘 다 이 테스트에서 정확히 한 번 호출된다") 값어치는 있다.

"경쟁 조건을 대변하는가"에 대한 직답: **대변하지 않는다. 그러나 이 항목에서 필요한 것은 경쟁이
아니라 한 함수 안의 프로그램 순서이고, 그것은 정확히 고정되어 있다.**

### 4. R4의 판단이 사람에게 실행 가능한가 — **아니다. 쿼리가 값을 출력하지 않고, 출력해도 알아볼 수 없다.**

M2 전문. `CLAUDE.md:388-391`의 select 목록에 `driveAccountId` 값이 없고, 값은 Drive `permissionId`
(불투명 숫자)이며, 성공 프로브는 그 값을 로그에도 남기지 않고, API/UI에도 없다. 세 줄짜리 수정으로
실행 가능해진다(쿼리에 컬럼 추가 + `emailAddress`를 로그로만 남기기 + 그 스코프 검증).

---

## 추가로 요청받은 세 가지

### (a) `a6729a3ec`의 회귀 주장 — **참이다. 코드와 설정으로 독립 확인했다.**

세 가지가 맞물린다.

1. `uploadAsset`은 **시작하자마자** `getCredentials`를 읽고(`google-drive.service.ts:875`) 그 다음
   `getDriveAccountId`를 부른다(`:890-894`). 읽기와 조건부 쓰기 사이에 네트워크 왕복이 있다.
2. 큐 동시성은 **5**다 — `server/src/config.ts:296`
   `[QueueName.GoogleDriveUpload]: { concurrency: 5 }`. 그래서 첫 물결의 다섯 잡이 **모두**
   `driveAccountId: null`을 읽고 모두 프로브한다.
3. 실 Postgres에서 같은 update를 두 번 실행하면 `UPDATE 1` → `UPDATE 0`이다. 옛 코드는
   `result.some(row => row.numUpdatedRows > 0n)`이었으므로 진 넷은 `false`를 받고,
   `adoptIfNewlyIdentified`가 `''`을 돌려 `recordUpload(…, '')`로 흘렀다.

새 코드는 같은 상황에서 select가 `account-x`를 돌려주고(확인함), 토큰이 바뀐 뒤에는 그 select가
**0행**을 돌려준다(확인함: `rows_for_old_token = 0`). 즉 수정의 방향과 가드 유지가 둘 다 성립한다.
단, select 쪽 토큰 조건은 테스트도 없고 결과도 바꾸지 못한다(N1).

### (b) 직전 라운드 C2 — **내가 맞고, 리포트도 자기가 본 것에 대해서는 맞다. 갈린 지점은 생성기를 돌린 DB다.**

C1 전문. 요지만: 전 마이그레이션 DB → **+21줄**, 마이그레이션 없는 DB → **diff 0**. 둘 다
`Generated 426 queries`. 다중 문장 메서드는 첫 문장이 던지면 두 번째가 실행되지 않으므로 잘리고,
"426"은 블록 수라서 이 차이를 못 본다. 이건 논쟁이 아니라 **재현 조건의 문제**였고, 절차에
"생성기 전에 마이그레이션" 한 줄이 두 라운드를 아꼈을 것이다.

### (c) R1/R3가 이전 라운드가 세운 것을 깨는가

**두 가지를 깬다.**

1. **R1이 "링크 경로에서는 절대 입양하지 않는다"를 깬다** — 이것이 H1이고, 원래 C3의 실패 모드를
   다시 연다. 다만 이번엔 방향이 반대다: 예전엔 "새 계정이 남의 행을 상속"이었고 지금은
   "떠나는 계정이 남의 행을 가져간다"이다. 결과(되돌릴 수 없는 중복)는 같다.
2. **R3가 계정 전환 동작을 `''` 버킷에 대해 무효화한다** — M1. medium이 고정하는 계정 전환
   케이스는 _이름 붙은_ 계정 두 개(`account-x` vs `account-y`)만 다루므로(추가된 테스트가 정확히
   그 양방향을 본다) **깨지지 않는다.** 무효화되는 것은 오직 `''` 축이고, 그 축에는 `hasUpload`
   테스트 한 건 말고는 커버리지가 없다(변이로 확인: 술어를 되돌리면 medium 1건만 실패).

**"떠나는 토큰이 아닌 토큰으로 드레인이 돌 수 있는가"** — 돌 수 있다. 정확히는 **토큰을 아예 쓰지
않는 분기**가 있다(H1). 그리고 프로브를 쓰는 분기에서도 프로브 도중 연결이 바뀌면 CAS가 없어 옛
계정으로 찍는다(M4).

---

## What I did not verify

- **운영(랩탑) DB.** 6,996행, 실제 `connectedAt`/`driveAccountId` 값에는 접근하지 않았다. 대신 같은
  술어와 같은 갱신을 내 컨테이너의 Postgres에 넣어 의미를 확인했다.
- **`about.get`이 `drive.file` 스코프에서 `permissionId`(그리고 `emailAddress`)를 채우는지.**
  다섯 라운드째 최대 미검증 항목이고, M1/M2의 실제 심각도가 여기에 달려 있다. 실 OAuth가 필요하다.
- **브라우저 확인.** 이번 두 커밋에 web 변경은 없다(변경 파일 목록으로 확인). svelte-check 게이트도
  돌리지 않았다 — 리포트의 증거 파일(`20260904-1333.txt:49`)이 "3 pre-existing files, no regressions"
  라고 적었고 web diff가 0이라 재실행 가치가 낮다고 판단했다.
- **`run.sh` 전체 실행.** 서버 유닛·웹 유닛·medium을 각각 직접 돌렸고(수치는 일치), 스크립트 자체는
  돌리지 않았다.
- **medium 전체 스위트.** 이 기능의 스펙 하나만 돌렸다. 리포트가 말한 exif 3건 실패
  (`e2e/test-assets` 미초기화)는 재현하지 않았다.
- **CI.** 두 커밋 다 원격에 없어(`git branch -r --contains a6c9c213b` 공집합, `origin/…` = `fe9fe4fed`)
  돌릴 대상이 없다. 업스트림 `sql-schema-up-to-date`가 이 상태에서 **실패할 것**이라는 점만
  로컬 생성기 실행으로 확정적이다.
- **H1 시나리오의 실제 발생 확률.** 경로가 존재하고 각 단계가 코드로 성립한다는 것만 보였다. 4단계
  (B 연결 해제)가 실제로 얼마나 자주 일어나는지는 데이터가 없다.
- **`emailAddress` 제안의 스코프 적합성.** M2의 fix 2는 `drive.file`에서 그 필드가 오는지에 달려
  있는데 확인하지 못했다.

---

## Feeding back into the plan

1. **생성기는 마이그레이션된 DB에서 돌린다.** 두 라운드가 이것 하나로 어긋났다. 절차 문장:
   _"`mise //:sql` 전에 대상 DB에 `migrations run`이 끝나 있어야 한다. 다중 문장 메서드는 첫 문장이
   실패하면 조용히 잘린다."_ 그리고 `fork-google-drive.yml`에 `git diff --exit-code
server/src/queries` 스텝을 넣는다 — 지금 이 드리프트를 볼 수 있는 곳은 어디에도 없다.
2. **"이 코드가 X를 지운다면, X를 전제하는 주석은 어디에 있나"를 체크리스트에 넣는다.** 이번 라운드의
   H1은 코드가 주석과 열 줄 거리에서 모순됐고, M3는 런북이 인접한 두 줄에서 모순됐다. 직전 라운드
   피드백 5번(닫은 것/부분만 닫은 것/의도적으로 둔 것)의 **문서판**이 필요하다.
3. **"판정할 수 없는 것"을 코드에서 빼면, 그것을 받은 쪽이 실제로 판정할 수 있는지 확인한다.** R4는
   사람에게 넘겼는데 사람이 볼 표현이 없다(M2). 이관은 *표현*까지 만들어야 완료다.
4. **`?? fallback`은 두 개의 다른 출처를 하나의 변수로 뭉갠다.** 직전 라운드 피드백 2번("불린 반환값은
   원인을 잃는다")과 같은 종류다. `credentials.driveAccountId ?? probe()`에서 앞은 _"언젠가 누가 찍은
   값"_, 뒤는 _"지금 이 토큰이 증명한 값"_ 인데, 드레인의 안전성은 **뒤에만** 의존한다. 안전성이
   출처에 의존하면 출처를 잃지 않는 형태로 쓴다.
5. **안전망을 넣으면, 안전망이 켜졌을 때 그것을 볼 방법도 같이 넣는다.** R3는 조용히 켜지고 조용히
   무한히 유지되며 UI·API·로그 어디에도 흔적이 없다. 최소한 잔여 `''` 행 수를 주기적으로 로그에
   남기는 것이 다음 웨이브 후보다.
6. **증거 파일의 `commit:` 검사를 훅으로.** 사람이 기억하는 방식으로 네 번 중 세 번 실패했다(N2).

---

**변경 파일 확인**: 리뷰 작성 직전 메인 저장소에서 `git status --porcelain`을 실행했고 출력은
**비어 있었다**(작성 후에는 이 리뷰 파일 하나). 테스트·변이 실험·`nest build`·SQL 생성기·psql
실험은 전부 격리 워크트리 `/tmp/gd-review-26064`(detached `6f4668f0a`)에서만 수행했고, 모든 변이는
백업본으로 되돌려 워크트리 `git status`가 깨끗함을 확인한 뒤 `git worktree remove --force`로
제거했다. 실험용 컨테이너 `gd-rev-pg`도 `docker rm -f`로 정리했다.
