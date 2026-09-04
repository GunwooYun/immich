# Code Review — 프로브 가드(C1/H1/H2/M1/M4/M5/L2~L4), H3 미결

|                  |                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch / HEAD    | `feat/google-drive-album-sync-v3.1.0` / `17c0f3a82`                                                                                                                                   |
| Commits reviewed | `98918dd85` (단일). `17c0f3a82`는 리포트 + 직전 리뷰 파일이라 코드 없음                                                                                                               |
| Report           | `../report/google-drive-probe-guards-20260904-1126-report.md`                                                                                                                         |
| Prior review     | `google-drive-adoption-fixes-20260904-0945-review.md`                                                                                                                                 |
| Reviewed         | 2026-09-04                                                                                                                                                                            |
| 작업 환경        | 격리 워크트리 2개 — `/tmp/gd-review-$$`(detached `17c0f3a82`)와 `/tmp/gd-review-parent`(detached `202ce87d1`). 실험·빌드·DB는 전부 그 안에서만, 종료 시 `git worktree remove --force` |

## Verdict

**H1의 방향은 옳지만 구현이 틀렸고, 그 틀림이 직전 라운드가 닫은 C1을 동시성 아래에서 되살린다.**
`setDriveAccountId`가 돌려주는 boolean은 "토큰이 바뀌었다"와 "이미 같은 계정으로 찍혀 있다"를
구분하지 못한다. 실 DB에서 확인했다 — 같은 토큰·같은 계정으로 두 번 부르면 두 번째는 `false`다.
그리고 `adoptIfNewlyIdentified`는 `false`를 보면 `''`을 돌려주므로, **경합에서 진 업로드는
계정이 멀쩡히 식별된 뒤에도 `''` 버킷에 자기를 기록한다.** 세 개의 동시 `uploadAsset`을 실제로
돌려 보면 이 커밋에서는 `['account-x', '', '']`이고 부모 커밋(`202ce87d1`)에서는
`['account-x','account-x','account-x']`다 — **회귀다.** 큐 동시성이 5(`server/src/config.ts:296`)
이므로 6,996건 백필의 첫 물결에서 최대 4건이 여기에 걸리고, 그 행들은 다시는 입양되지 않으며
(입양은 `driveAccountId is null`일 때만 돈다) 다음 큐잉 때 **드라이브에 중복 파일**을 만든다.
배포 게이트가 0에 닿지 못한다는 뜻이기도 하다.

두 번째로 중요한 것은 M1이다. **생성 SQL은 재생성되지 않았다.** 마이그레이션을 마친 DB에서
`node dist/bin/sync-sql.js`를 돌리면 이 커밋 기준으로 정확히 한 파일이 바뀐다 —
`server/src/queries/google.drive.repository.sql`에 `getErrorSummary`의 두 번째 쿼리 14줄이
**추가**된다. 즉 `integrity.repository.sql`에서 14줄을 손으로 지웠고, 그 14줄이 가야 할 곳에는
넣지 않았다. 리포트의 "M1을 재생성으로 확인(14줄 제거)"은 산출물이 뒷받침하지 않는다. 더 나아가
**부모 커밋에서(= `Promise.all`을 그대로 둔 채) 생성기를 4번 돌려 봤는데 4번 다 같은 깨끗한
결과**가 나왔다 — 오염은 `Promise.all`의 성질이 아니라 **낡은 산출물**이었고, 필요한 조치는
코드 변경이 아니라 `mise //:sql` 한 번이었다.

CI 정정(0절)은 사실이다. 애노테이션 API로 직접 확인했고 리포트대로다.

### Evidence I ran myself

| Check                                                                                                  | Result                                                                                                               |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 서버 유닛 8스펙 (`run.sh`의 `SERVER_SPECS`), `17c0f3a82`                                               | `Test Files 8 passed / Tests 249 passed` — 리포트의 249와 일치 (커밋 메시지의 248은 오타)                            |
| 웹 유닛 4스펙                                                                                          | `Tests 39 passed` — 일치                                                                                             |
| medium `google-drive.repository.spec.ts` (testcontainer, 전 마이그레이션)                              | `Tests 20 passed` — 일치                                                                                             |
| `npx tsc --noEmit` (server)                                                                            | rc=0                                                                                                                 |
| **동시성 실험**: 미식별 연결로 `uploadAsset` 3건 동시 실행, `setDriveAccountId`를 실 where 의미로 모킹 | `recordUpload`의 계정 인자 = `["account-x","",""]` — **2건이 `''`로 기록**                                           |
| 같은 실험을 부모 `202ce87d1`에서                                                                       | `["account-x","account-x","account-x"]` — **이 커밋이 만든 회귀**                                                    |
| **실 DB**: `setDriveAccountId` 3회 (틀린 토큰 / 맞는 토큰 / 이미 찍힌 뒤 같은 계정)                    | `false` / `true` / **`false`** — boolean이 "바뀌었다"와 "이미 같다"를 구분하지 못한다                                |
| **변이**: `google-drive.repository.ts:93`의 `.where('refreshToken', …)` 삭제                           | 유닛 68 pass, medium 20 pass — **H1 수정의 실체에 테스트가 0건**                                                     |
| **변이**: `adoptIfNewlyIdentified`의 `if (!stamped) return ''` 삭제                                    | `1 failed                                                                                                            | 67 passed` — 새 테스트는 비공허하다 (자기가 박은 동작만 지킨다) |
| **생성기 실전 실행**(container PG 14-vectorchord + 전 마이그레이션, `node dist/bin/sync-sql.js`)       | `17c0f3a82`: `google.drive.repository.sql` **+14줄** 1파일 변경 — 커밋된 산출물이 낡았다                             |
| 같은 생성기를 부모 `202ce87d1`에서 (fresh DB 1회 + dirty DB 3회)                                       | 4회 모두 `integrity.sql −14 / google.drive.sql +14` — **`Promise.all`로도 오염이 재현되지 않는다**                   |
| **실 DB**: `getErrorSummary(DummyValue.UUID)`                                                          | `{failedCount:0, blockedReason:null}` — count 쿼리는 실패하지 않는다 (커밋 코멘트의 메커니즘 가설과 상충)            |
| **kysely 로그 콜백으로 생성기 재현**, `getErrorSummary` 1회                                            | 캡처 2건(count + blocking) — 순차 전환 후에도 블록에는 2개가 들어가야 맞다                                           |
| **실 DB**: 입양 후 같은 계정 재링크 + 프로브 실패                                                      | `hasUpload` **true → false**, 행은 `{token-A2, null}` — 라이브러리 전량 중복 경로 (기존 결함, 아래 H3)               |
| `CLAUDE.md`의 새 게이트 쿼리를 실제 Postgres에 투입                                                    | 정상 동작. 식별된 사용자의 잔여 `''` 1행을 정확히 보고 — **C1은 진짜로 고쳐졌다**                                    |
| CI run `33715025550` 애노테이션 (check-runs API)                                                       | Medium: `conclusion: success`인데 `warning: the medium suite failed…` + `failure: exit code 1` + `AssertionError` ×3 |
| CI run `33758496224` 애노테이션                                                                        | Medium: 같은 warning + `failure: exit code 1` (AssertionError 3건은 이 run에는 없음)                                 |
| CI run `33818957172`(`fe9fe4fed`) 애노테이션                                                           | 3잡 모두 Node 20 deprecation warning **뿐**, 실패 애노테이션 0 — **진짜 초록**                                       |
| 워크트리 2개 / 컨테이너 / 메인 `git status --porcelain`                                                | 워크트리 clean 후 제거, 컨테이너 `docker stop`, 메인은 **이 리뷰 파일 하나뿐**                                       |

---

## Findings

### C1 — `setDriveAccountId`의 boolean이 "토큰이 바뀌었다"와 "이미 같은 계정으로 찍혀 있다"를 뭉갠다. 동시 업로드가 **식별된 계정 밑에서도 `''`로 기록된다** (Critical, 이 커밋의 회귀)

`server/src/repositories/google-drive.repository.ts:85-98`은 `driveAccountId is null`을 조건으로
두므로, **행이 이미 우리가 방금 프로브한 그 계정으로 찍혀 있으면 0행**이고 `false`를 돌려준다.
실 DB에서 그대로 나왔다:

```
wrong token           -> false
right token           -> true
already set, same account -> false      ← 아무것도 바뀌지 않았는데 false
```

`server/src/services/google-drive.service.ts:427-437`은 그 `false`를 **오직 하나의 뜻**으로 읽는다:

```ts
if (!stamped) {
  this.logger.warn(`Google Drive connection for user ${userId} changed while identifying it; not adopting existing uploads`);
  return "";
}
```

그리고 `uploadAsset`(`:841-849`)은 그 반환값을 그대로 `uploadAccountId`로 쓰고
`recordUpload(userId, assetId, data.id, '')`(`:1048`)로 흘린다.

**재현.** 미식별 연결 상태에서 `uploadAsset` 3건을 동시에 돌리고, `setDriveAccountId`만 실제
where 의미(`userId` ∧ `refreshToken` ∧ `driveAccountId is null`)를 갖는 인메모리 행으로 대체했다.
`about.get`은 20ms 지연을 준다 — 실제 왕복이 그렇다.

| commit                | `recordUpload`에 들어간 계정              |
| --------------------- | ----------------------------------------- |
| `17c0f3a82` (이 커밋) | `["account-x", "", ""]`                   |
| `202ce87d1` (부모)    | `["account-x", "account-x", "account-x"]` |

부모는 `setDriveAccountId`의 결과를 무시하고 프로브한 id를 돌려주었기 때문에 옳았다. **이 커밋이
그것을 깼다.**

**왜 흔한가.** `uploadAsset`은 시작하자마자 `getCredentials`를 읽고(`:828`) 그 다음에 프로브한다.
큐 동시성은 5(`server/src/config.ts:296`)이므로 백필의 첫 5개 잡은 **전부** `driveAccountId: null`
을 읽고 전부 프로브한다. 하나가 이기고 넷이 진다. API 레플리카와 워커 사이에도 같은 창이 있고,
앨범 Drive 메뉴는 `getGoogleDriveStorage()`와 `getGoogleDriveStatus()`를 **같은
`Promise.allSettled`에서 동시에** 부르므로(`web/src/routes/(user)/albums/[albumId=id]/…/+page.svelte:374-381`)
한 프로세스 안에서도 두 입양이 경합한다 — 후자는 `getStorage`가 반환값을 무시해 무해하지만,
**운영자에게 grep하라고 지시한 그 경고 문구를 거짓으로 찍는다.**

**결과.** (a) 그 `''` 행들은 두 번 다시 입양되지 않는다(입양 조건이 `driveAccountId is null`이다),
(b) `hasUpload`는 `coalesce(current, '')`로 비교하므로(`google-drive.repository.ts:581-592`) 그
자산은 다음 큐잉에서 **다시 업로드되어 드라이브에 중복 파일**이 되고, (c) `CLAUDE.md`의 배포
게이트가 영원히 0에 닿지 않는다. 내가 그 게이트 쿼리를 실제 Postgres에 돌려서 확인했다 —
`u-identified / unidentified=f / unstamped=1`을 정확히 보고한다. 즉 **게이트는 이 결함을 잡지만,
그때는 이미 중복이 예약된 뒤다.**

**Fix.** boolean을 버리고 *실효 계정*을 돌려준다.

```ts
// repository
async setDriveAccountId(userId, refreshToken, driveAccountId): Promise<string | null> {
  const updated = await this.db.updateTable('user_google_drive')
    .set({ driveAccountId })
    .where('userId', '=', userId)
    .where('refreshToken', '=', refreshToken)
    .where('driveAccountId', 'is', null)
    .returning('driveAccountId')
    .executeTakeFirst();
  if (updated) { return updated.driveAccountId; }          // 우리가 찍었다 → 입양한다
  const row = await this.db.selectFrom('user_google_drive')
    .select(['refreshToken', 'driveAccountId'])
    .where('userId', '=', userId).executeTakeFirst();
  // 같은 토큰에 이미 같은 계정이 찍혀 있으면 경합에서 졌을 뿐이다: 입양은 건너뛰되 id는 돌려준다.
  return row?.refreshToken === refreshToken ? row.driveAccountId : null;
}
```

서비스는 `null`일 때만 `''`을 돌려주고 warn을 남긴다. 이러면 (i) 경합에서 진 업로드가 옳은 계정
으로 기록되고, (ii) `adoptUnstampedUploads`는 여전히 한 번만 돌고, (iii) 경고가 **진짜로 연결이
바뀐 경우에만** 나온다. 지금의 유닛 테스트(`google-drive.service.spec.ts:1276-1294`)는 두 케이스로
쪼개야 한다 — "토큰이 바뀌었다 → `''`", "이미 같은 계정 → `account-x`, 단 `adoptUnstampedUploads`는
호출되지 않는다".

---

### C2 — 생성 SQL이 **재생성되지 않았다.** 리포트의 "재생성으로 확인"은 산출물이 반증한다 (Critical, 증거)

컨테이너에 `ghcr.io/immich-app/postgres:14-vectorchord0.4.3`을 띄우고 전 마이그레이션을 적용한
뒤 `node ./dist/bin/sync-sql.js`를 돌렸다. `17c0f3a82`에서 바뀌는 파일은 **정확히 하나**다:

```
 server/src/queries/google.drive.repository.sql | 14 ++++++++++++++
```

추가되는 14줄은 `-- GoogleDriveRepository.getErrorSummary` 블록에 들어가야 할 **두 번째 쿼리**
(`select "error" from "google_drive_upload_error" … limit $5`)다. 즉 `integrity.repository.sql`에서
14줄을 지운 것은 맞지만 **그 14줄이 있어야 할 곳에는 넣지 않았다.** M1의 지적이 _"참조 파일이
어떤 쿼리가 어느 메서드의 것인지 거짓말한다"_ 였는데, `getErrorSummary` 블록은 **여전히 자기
쿼리의 절반만 담고 있다.**

업스트림 CI에는 이것을 막는 잡이 있다 — `.github/workflows/test.yml:758` `sql-schema-up-to-date`,
`:842` "Verify SQL files have not changed". 포크 워크플로(`fork-google-drive.yml`)는 그 잡을 돌리지
않으므로 이 드리프트는 **업스트림에 PR을 열거나 머지할 때 터진다.**

덤으로, 이 라운드의 코드 변경(순차 전환)이 필요했는지 자체가 의심스럽다 — 아래 M1.

**Fix.** `mise //:sql`(또는 `node dist/bin/sync-sql.js`)을 돌리고 `google.drive.repository.sql`을
같이 커밋한다. 절차에 "SQL 참조 파일을 손으로 고치지 않는다"를 한 줄 넣는다.

---

### H1 — 새 `refreshToken` 조건에 **테스트가 하나도 없다.** 직전 리뷰 M2가 그대로 남았고 이제 새 절까지 덮지 못한다 (High)

`server/src/repositories/google-drive.repository.ts:93`의 `.where('refreshToken', '=', refreshToken)`
를 통째로 지우고 돌려 봤다:

```
unit   (google-drive.service.spec.ts)                Tests 68 passed
medium (google-drive.repository.spec.ts)             Tests 20 passed
```

**H1 수정의 실체 전체가 아무 테스트도 건드리지 않는다.** 유닛 스펙이 보는 것은
`expect(mocks.googleDrive.setDriveAccountId).toHaveBeenCalledWith(userId, 'refresh-token', 'account-x')`
(`google-drive.service.spec.ts:1257`) — 서비스가 토큰을 **인자로 넘기는지**만 확인하고, 데이터베이스가
그 토큰을 **지키는지**는 아무도 묻지 않는다. 직전 리뷰 M2가 정확히 이 medium 케이스 3개를
요구했고, 리포트는 M2를 닫았다고도 못 닫았다고도 말하지 않는다.

**Fix.** medium 3케이스. 내가 실제로 돌려 봤고 전부 100ms 안에 끝난다:

| 케이스                               | 기대                                    |
| ------------------------------------ | --------------------------------------- |
| 다른 토큰                            | `false`, 행 불변                        |
| 맞는 토큰 + `driveAccountId is null` | `true`, 행이 갱신                       |
| 이미 찍힌 뒤 같은 토큰·같은 계정     | (C1 수정 후) **id를 돌려준다**, 행 불변 |

세 번째가 C1의 회귀 테스트이기도 하다.

---

### H2 — 직전 리뷰 H2는 세 갈래였는데 **쿨다운 하나만 반영됐고, 리포트는 H2를 닫힌 것으로 적는다** (High)

직전 리뷰 H2의 요구는 (a) 사용자별 쿨다운, (b) `about.get` 타임아웃, (c) `getStatus`가 도는 무제한
쓰기였다. 반영된 것은 (a)뿐이다.

- **(b) 타임아웃은 없다.** `grep -n timeout server/src/services/google-drive.service.ts` → **0건**.
  `GET /google-drive/status`는 여전히 구글이 응답하지 않으면 같이 멈추고, 그 화면이 Disconnect
  버튼이 있는 화면이다. hang은 사용자 수와 무관하므로 랩탑에서도 그대로 성립한다.
- **(c)** 첫 로드의 `adoptUnstampedUploads`(6,996행 delete+update 트랜잭션)는 여전히 HTTP 요청
  안에서 돌고 상한이 없다.
- **쿨다운이 `getStorage`를 덮지 않는다.** `google-drive.service.ts:675`의 입양 훅은
  `probeAllowed`를 거치지 않는다. `storageCache`(60초)가 간접적으로 묶어 주긴 하지만, 앨범 메뉴
  한 번 열기가 `getStatus`와 `getStorage` 프로브를 **동시에** 쏘는 구조는 그대로다 — 그리고 그
  동시성이 C1의 거짓 경고를 만든다.

리포트 3절이 "쿨다운을 붙였다"로 H2를 요약하면서 (b)(c)를 언급하지 않은 것은 직전 라운드가 지적한
_"주석만 고치고 동작은 남긴 항목에 표시를 남겨라"_ 와 같은 종류의 누락이다.

**Fix.** `about.get`에 `{ timeout: 10_000 }`을 준다(googleapis는 요청 옵션으로 받는다). `getStorage`
의 입양 훅도 `probeAllowed`를 공유하게 하거나, 최소한 "여기는 `storageCache`가 대신 묶는다"를
주석으로 명시한다.

---

### H3 — (기존 결함, 이번 라운드에서 처음 관측) **입양이 끝난 뒤** 같은 계정을 재링크했는데 프로브가 실패하면 **라이브러리 전량이 중복 업로드된다** (High)

이 포크가 sentinel을 거부한 근거는 _"같은 계정 재연결 + 프로브 실패에서 라이브러리 전량 중복이
되고, 드라이브의 중복은 되돌릴 수 없다"_ 였다. **현재 설계에도 같은 경로가 있다.** 실 DB에서
확인했다:

```
after adoption, hasUpload = true
row after re-link         = {"t":"token-A2","a":null}
after re-link with a failed probe, hasUpload = false
```

`upsertCredentials`의 `doUpdateSet({ refreshToken, driveAccountId })`
(`server/src/repositories/google-drive.repository.ts:69-74`)는 프로브가 실패했을 때
`driveAccountId`에 **null을 덮어쓴다.** 그러면 `hasUpload`의 비교값이
`coalesce(null,'') = ''`가 되고(`:587`, `:34-35`), 이미 `acct-A`로 찍힌 원장 행은 **전부 매칭에서
사라진다.** 6,996개 자산이 다시 큐에 들어가 드라이브에 두 번째 복사본을 만든다.

`CLAUDE.md:375-378`의 경고는 _"입양이 돌기 전에 연결을 해제하고 다시 연결하면"_ 이라고 적어
**입양 전**만 다룬다. 실제 위험 창은 입양 **후에도** 열려 있다. 그리고 스키마 주석
(`server/src/schema/tables/google-drive-upload.table.ts:26-29`)의 _"switching back to a previous
account is free"_ 는 프로브가 성공할 때만 참이다.

**Fix (둘 중 하나를 명시적으로 고른다).**

1. **알려진 id를 null로 덮지 않는다** — `doUpdateSet`에서 `driveAccountId`를
   `coalesce(<new>, "user_google_drive"."driveAccountId")`로 둔다. 다른 계정으로 갈아탔는데
   프로브가 실패한 경우에는 새 연결이 옛 id를 달게 되어 **새 드라이브가 비어 보이는** 상태가
   되지만, 그것은 재연결 한 번으로 회복된다 — 이 포크가 C3에서 이미 채택한 "되돌릴 수 없는
   쪽을 되돌릴 수 있는 쪽으로" 논리와 같다.
2. 1을 받아들이지 않는다면, 최소한 `CLAUDE.md`의 경고를 "입양 전"이 아니라 "프로브가 실패하는
   동안 재링크하면 언제든"으로 고치고, 스키마 주석의 "free"에 단서를 단다.

이 항목은 이번 커밋이 만든 것이 아니지만, **직전 라운드들이 C3/H3를 논하면서 놓친 것**이고
(질문받은 "이전 라운드가 잡았어야 했는데 못 잡은 것"의 답), H3 설계 결정과 같은 자리에서 같이
정해야 한다.

---

### M1 — 순차 전환은 **필요하지 않았을 가능성이 크다.** 부모 커밋에서 생성기를 4번 돌렸는데 4번 다 깨끗했다 (Medium)

부모 `202ce87d1`(= `Promise.all` 그대로)을 빌드해서 생성기를 fresh DB 1회 + 같은 DB 3회, 총 4회
돌렸다. **4회 모두** 결과가 같다:

```
 server/src/queries/google.drive.repository.sql | 14 ++++++++++++++
 server/src/queries/integrity.repository.sql    | 14 --------------
```

즉 `Promise.all`을 그대로 둔 채 재생성만 해도 `integrity.repository.sql`의 오염은 사라지고 14줄이
제 자리로 간다. 커밋된 오염은 **코드의 성질이 아니라 낡은 산출물**이었다. 커밋 코멘트
(`google-drive.repository.ts:761-767`)가 적은 메커니즘 — _"두 쿼리가 동시에 떠 있으면 먼저 로그하는
쪽에 귀속된다"_ — 도 재현되지 않았다. 생성기는 메서드를 `await`하므로(`src/bin/sync-sql.ts:158-165`)
정상 경로에서는 두 쿼리가 반환 전에 모두 로그된다. 실제로 kysely 로그 콜백을 그대로 붙여
`getErrorSummary` 한 번을 캡처해 보면 **2건이 같은 버킷에 순서대로** 들어온다. 남는 가설은
"첫 쿼리가 reject하면 `Promise.all`이 먼저 반환하고 두 번째가 다음 메서드의 버킷으로 샌다"인데,
`getErrorSummary(DummyValue.UUID)`를 실 DB에 돌려 보면 **에러가 나지 않는다**
(`{failedCount:0, blockedReason:null}`).

**결론.** 순차 전환을 되돌리라는 뜻은 아니다(재현되지 않았다고 일어나지 않는다는 뜻은 아니고,
비용도 작다). 다만 **주석이 확인되지 않은 메커니즘을 사실로 적고 있고**, 진짜 필요한 조치였던
재생성은 하지 않았다. 주석을 "가설"로 낮추고 C2의 재생성을 하는 것이 이 항목의 실제 마무리다.

---

### M2 — `getErrorSummary`의 가장 뜨거운 호출자는 설정 화면이 아니라 **3초 폴러**다 (Medium — 요청 3번의 답)

호출 지점은 셋이다: `google-drive.service.ts:560`, `:573`(둘 다 `getStatus`), `:703`(`getMyStatus`).
`getMyStatus`는 컨트롤러 `google-drive.controller.ts:260`을 거쳐 웹의
`google-drive-progress-manager.svelte.ts:85`가 부르고, 그 매니저는 **활동 중 3초 / 조용해지면
15초**로 폴링한다(`:53-55`). 앨범 Drive 메뉴도 열 때마다 한 번 더 부른다(`+page.svelte:381`).

즉 커밋 코멘트의 _"a settings-page read"_ 는 이 변경의 비용이 실제로 어디에 떨어지는지를 잘못
말한다. 그렇다고 문제라는 뜻은 아니다 — 쿼리 수는 같고(2개), Postgres 부하는 동일하며, 늘어난
것은 **직렬화된 왕복 1회의 지연**뿐이다. 로컬 실 DB에서 두 쿼리 합계가 100ms 미만이었다.
3초 폴링에서 수 ms를 더 쓰는 것은 받아들일 만하다. **주석만 고치면 된다.**

**순서 말고 달라진 것이 있는지**(요청받은 확인): 코드로 따져 보면 없다. 두 값은 서로를 참조하지
않고, 트랜잭션이 없으므로 원자성은 전에도 없었으며, 반환문
(`{ failedCount: Number(countRow?.count ?? 0), blockedReason }`)은 동일하다. 유일한 의미 차이는
**count 쿼리가 실패하면 이제 blocking 쿼리가 아예 실행되지 않는다**는 것 — 호출자에게는 어느
쪽이든 예외이므로 관측 가능한 차이가 아니다. 두 읽기 사이의 시간 창이 0에서 1왕복으로 넓어져
`clearErrors`가 그 사이에 끼면 `failedCount>0 ∧ blockedReason=null` 같은 조합이 나올 수 있으나,
그 비원자성은 전에도 있었고 새 클래스의 불일치는 아니다.

---

### M3 — 런북의 진단 문구가 C1 때문에 틀리게 되고, 쿨다운을 모른다 (Medium, 문서)

`CLAUDE.md:399-401`: _"`unidentified = false`인데 행이 남아 있으면 입양이 돌다 말았다는 뜻이다."_
C1이 있는 한 그 상태는 **백필이 정상적으로 돌기만 해도 나온다.** 운영자는 "입양이 돌다 말았다"를
찾다가 원인을 못 찾는다.

또 하나: 이제 프로브에 60초 쿨다운이 있으므로(`google-drive.service.ts:610-621`), 1단계 "설정
화면을 한 번 연다"에서 프로브가 실패했을 때 **곧바로 새로고침해도 아무 일도 일어나지 않는다.**
런북에 "재시도는 1분 뒤"를 적어야 한다.

(게이트 쿼리 자체는 옳다. 실제 Postgres에서 미식별/식별 두 사용자 + 잔여 `''` 행을 만들어 돌려
확인했다 — `unstamped` 값이 의도대로 나오고, 원장이 없는 사용자는 0을 준다.)

---

### L1 — 직전 리뷰 L1(겹친 JSDoc 두 개)이 그대로 남았고, 리포트는 L2~L4만 닫았다고 적으면서 L1은 언급하지 않는다 (Low)

`server/src/services/google-drive.service.ts:384-394`(옛 블록)와 `:395-407`(새 블록)이 연달아
붙어 있고 선언은 `:408`이다. 첫 블록은 죽은 주석이다.

---

### L2 — `98918dd85`가 커밋한 자기 증거 파일이 **부모 커밋에서 뽑은 것**이다 (Low)

`dev-test/google-drive/results/20260904-1121.txt`의 헤더는 `commit: 202ce87d1`이다. 즉 이 커밋이
담은 증거는 이 커밋의 코드를 돌린 결과가 아니다. `17c0f3a82`가 올바른
`20260904-1126.txt`(`commit: 98918dd85`)를 추가해 HEAD에서는 자체 수정되었지만, 이것은 한 라운드
전에 `7128a36fc`("regenerate the Wave 6 test evidence at a commit that contains the code")가 고친
바로 그 실수의 반복이다.

---

### L3 — 커밋 메시지의 `Test: 248/39/20`은 249다 (nitpick)

리포트와 증거 파일은 249로 맞다. 내가 재현한 것도 249다.

---

### L4 — 리포트 0절의 애노테이션 인용이 두 run을 뭉뚱그린다 (nitpick)

`AssertionError: expected 'failed' to be undefined` ×3은 run `33715025550`에만 붙어 있다.
`33758496224`에는 `the medium suite failed; it is non-blocking for now` + `Process completed with
exit code 1.` 두 건뿐이다. **결론(두 run 다 medium이 빨간불이었다)은 그대로 참이다.**

---

## Answers to what the report asked me to attack

### 1. H2 쿨다운의 부작용 — 인메모리인 것은 문제가 아니다. **업로드 경로 제외는 지금은 옳지만, 이유가 리포트가 든 것과 다르다.**

**인메모리·프로세스 로컬.** 쿨다운에 정합성 역할이 없다는 주석의 주장은 맞다. 최악의 비용은
`(레플리카 수 × 1분당 1회) + getStorage의 1분당 1회`로 묶이고, 이 배포는 컨테이너 하나다.
재시작으로 초기화되는 것도 무해하다 — 재시작 루프라면 프로브가 문제가 아니다.

**다만 하나, 리포트가 말하지 않은 부작용이 있다: 쿨다운은 입양을 지연시킨다.** 런북의 1단계가
"설정 화면을 한 번 연다"인데, 그 프로브가 일시적으로 실패하면 운영자의 반사적인 새로고침이
60초 동안 아무 일도 하지 않는다. 로그도 조용하다. 절차 문구에 "1분 뒤 재시도"가 필요하다(M3).

**업로드 경로 제외.** 리포트의 근거 — _"목적지를 못 대는 업로드는 `''`로 기록되므로 왕복 한 번이
싸다"_ — 는 **C1이 있는 지금 정확히 뒤집혀 있다.** 프로브를 매번 하기 때문에 경합이 생기고,
경합에서 진 잡이 바로 그 `''` 기록을 만든다. 즉 지금은 프로브가 `''`을 막는 게 아니라 **만든다.**

C1을 고친 뒤라면 어떤가. 그래도 근거는 절반만 성립한다. 첫 잡이 성공하면 이후 잡들은
`credentials.driveAccountId`를 읽어 프로브를 건너뛰므로, 프로브를 매번 하는 것의 한계 가치는
**첫 잡 이후 0**이다. 반대로 프로브가 **구조적으로 실패**하면(= `drive.file` 스코프에서
`about.get`이 `user`를 채우지 않는, 네 라운드째 미검증인 그것) 6,996개 잡이 6,996번 `about.get`을
쏜다 — 직전 리뷰 N4/M3가 지적한 그대로이고 여전히 열려 있다. **권고: C1을 고친 뒤 업로드 경로
에도 같은 쿨다운을 공유시킨다.** 잃는 것은 "첫 잡의 프로브가 실패했을 때 두 번째 잡이 1분 안에
다시 시도하는 것"뿐이고, 그건 어차피 설정 화면·앨범 메뉴가 대신 해 준다.

### 2. H1 가드의 완전성 — **자기가 주장하는 속성에는 충분하다. 같은 토큰 재발급도 안전하다. 그러나 그 속성은 사람들이 기대하는 것보다 좁다.**

**같은 refresh token이 재발급되는 경우.** refresh token은 (client_id, 사용자 계정, 스코프)에
묶여 발급되므로, **같은 토큰이 두 개의 다른 구글 계정에 걸칠 수 없다.** 따라서 토큰이 같다면
in-flight 프로브가 돌려준 계정 A는 지금 행에 들어 있는 토큰의 계정과 **같다.** 가드는 통과하고,
찍히는 값은 옳다. 낡은 프로브가 이기는 것처럼 보이지만 **답이 같으므로 해가 없다.**
(연결 해제는 행을 삭제하므로 — `deleteCredentials`, `google-drive.repository.ts:167` — 재링크는
새 행을 만들고, 같은 토큰이면 같은 계정이라는 논리는 그대로다.)

다른 계정으로 재링크하면 토큰이 반드시 다르므로 가드가 걸리고 입양이 중단된다 — 의도대로다.
같은 계정인데 토큰만 새로 발급된 경우(`prompt=consent`의 일반적 결과)에도 가드가 걸리는데,
이때는 입양이 한 라운드 미뤄질 뿐 다음 프로브가 처리한다. 정상이다.

**가드가 덮지 못하는 것 두 가지.**

- **C1**: "이미 같은 계정으로 찍혀 있다"를 "바뀌었다"로 읽는다. 이게 이번 라운드 최대 결함이다.
- **H3(입양의 본질)**: 가드는 *credentials 행*의 정합성만 지킨다. `adoptUnstampedUploads`가
  찍는 `''` 행들이 **정말 이 계정의 것인가**는 여전히 아무것도 보장하지 않는다. 토큰이 일치해도
  그 `''` 행은 이전 연결(다른 계정)이 남긴 것일 수 있다.

### 3. M1 수정의 대가 — **폴링되는 경로가 맞다. 다만 대가는 작고, 진짜 문제는 대가가 아니라 재생성을 안 한 것이다.**

M2 전문. 요약: `getErrorSummary`의 세 호출자 중 `getMyStatus`가 **3초/15초로 폴링**되고 앨범 메뉴도
부른다. 늘어난 것은 왕복 1회의 직렬 지연뿐이고(쿼리 수·DB 부하 동일) 실측 두 쿼리 합계가 100ms
미만이라 받아들일 만하다. 코멘트의 "설정 화면 읽기"만 고치면 된다. 그리고 **순서 외에 달라진
동작은 없다** — 코드로 확인했다(반환문 동일, 두 값 독립, 트랜잭션 없음, 차이는 첫 쿼리가 실패할
때 두 번째가 실행되지 않는 것뿐이며 호출자에게는 어느 쪽도 예외다).

다만 M1에서 적었듯 **부모 커밋에서 생성기를 4번 돌려도 오염이 재현되지 않았다.** 이 대가를 지불한
이유 자체가 흔들린다.

### 4. H3의 판정 기준 — **새 컬럼은 필요 없다. `google_drive_upload.uploadedAt`과 `user_google_drive.connectedAt`으로 더 정확하게 된다.**

직전 리뷰가 제안한 boolean(`adoptable`)보다 나은 답이 이미 스키마에 있다.

**두 컬럼.**

- `google_drive_upload.uploadedAt` — `@CreateDateColumn`, 이미 존재
  (`server/src/schema/tables/google-drive-upload.table.ts:70-71`).
- `user_google_drive.connectedAt` — `@CreateDateColumn`, 이미 존재
  (`server/src/schema/tables/user-google-drive.table.ts:66-68`).

**리포트가 `connectedAt`을 배제한 이유는 맞지만, 고치는 데 한 줄이면 된다.**
`upsertCredentials`의 `doUpdateSet`(`google-drive.repository.ts:72`)이 `connectedAt`을 갱신하지
않는 것이 문제인데, 거기에 `connectedAt: sql\`now()\``를 더하면 `connectedAt`은 **"지금 이 연결이
맺어진 시각"** 이라는, 이름과 UI가 이미 주장하고 있는 뜻이 된다. (연결 해제는 행을 삭제하므로
그 경로는 `@CreateDateColumn`이 이미 알아서 처리한다 — 손댈 곳은 "해제 없이 다시 링크" 한 경로뿐이다.)

**판정 기준: "컬럼 도입 이후인가"가 아니라 "이 연결이 시작된 뒤에 올라간 행인가".**

```
adoptUnstampedUploads(userId, driveAccountId, since)  where … and "uploadedAt" >= since
                                                       // since = credentials.connectedAt
```

이게 왜 boolean보다 나은가:

| 시나리오                                               | boolean(`adoptable`)                           | `uploadedAt >= connectedAt`                      |
| ------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------ |
| 랩탑(컬럼 이전부터 있던 연결, 6,996행)                 | 입양 O — 이번 배포의 이득 유지                 | 입양 O — `connectedAt`이 모든 업로드보다 앞선다  |
| 다른 계정 B가 프로브 실패 상태로 링크된 뒤 나중에 식별 | 입양 X (원하는 대로)                           | 입양 X — A의 행은 B의 `connectedAt`보다 오래됐다 |
| **같은 연결이 미식별인 동안 자기가 올린 행**           | **입양 X → 그 행들이 고아가 되어 중복 업로드** | **입양 O — 시각으로 자기 것임이 증명된다**       |
| 새 컬럼                                                | 필요                                           | **불필요**                                       |

세 번째 줄이 결정적이다. boolean은 "이 연결은 입양 자격 없음"이라는 굵은 도장이라, 그 연결이
미식별 상태에서 스스로 쓴 `''` 행까지 버린다. 그 행들은 나중에 계정이 식별되는 순간 매칭에서
사라지고 **중복 업로드**가 된다 — 이 포크가 가장 피하고 싶어 하는 방향이다. 시각 기준은 그 행들을
정확히 골라 입양한다.

**남는 잔여물(정직하게).** 연결 #1이 미식별인 채로 쓴 `''` 행은, 연결 #2가 생긴 뒤에 식별되면
입양되지 않는다. 그 자산들은 재업로드되어 중복이 된다. 다만 그 범위는 "직전 연결의 미식별 구간에
올린 것"으로 한정되고, 대안(현재 동작)은 **A의 전체 원장을 B에 영구히 오귀속**시키는 것이다.
되돌릴 수 없는 쪽이 되돌릴 수 있는 쪽으로 바뀐다.

**구현 체크리스트(4곳).**

1. `upsertCredentials`의 `doUpdateSet`에 `connectedAt` 갱신 추가. (H3의 id-null-덮어쓰기 수정과
   같은 자리다 — 같이 하는 것이 좋다.)
2. `adoptUnstampedUploads(userId, driveAccountId, since: Date)` — delete의 대상과 update **양쪽에**
   `"uploadedAt" >= since`를 건다. 걸지 않은 행은 `''`로 남아야 한다.
3. `adoptIfNewlyIdentified`가 `credentials.connectedAt`을 넘긴다(`getCredentials`가 이미 select한다,
   `google-drive.repository.ts:55`).
4. medium 2케이스: `connectedAt` 이전 행은 `''`로 남고 이후 행만 찍힌다 / 재링크 후 `connectedAt`이
   실제로 갱신된다.

**배포 전 확인 한 줄(중요).** 랩탑의 현재 행이 이 기준에서 안전한지는 데이터로 확인 가능하다.
`connectedAt`이 지금까지 한 번도 갱신되지 않았으므로 "최초 링크 시각"인데, 만약 과거에 연결
해제 후 재연결한 적이 있다면 행이 새로 만들어져 `connectedAt`이 뒤로 밀렸을 수 있고, 그러면
그보다 오래된 `''` 행이 입양되지 않는다. 배포 전에:

```sql
select u."userId", u."connectedAt", min(g."uploadedAt") as oldest_upload
from user_google_drive u
left join google_drive_upload g on g."userId" = u."userId" and g."driveAccountId" = ''
group by 1, 2;
```

`connectedAt <= oldest_upload`면 그대로 진행해도 랩탑의 6,996행이 전부 입양된다. 아니면 그
사용자에 한해 마이그레이션에서 `connectedAt`을 뒤로 당기거나 예외를 문서화한다.

**UI 의미 변화 한 가지.** `connectedAt`은 `getStatus`를 통해 설정 화면에 노출된다. 갱신하게 되면
"재인증한 시각"을 보여주게 되는데, 이는 이름이 이미 약속한 바에 더 가깝다. 그 변화조차 원치 않는다면
`linkedAt` 새 컬럼을 두는 것이 대안이지만, 나는 그럴 필요가 없다고 본다.

---

## 추가로 요청받은 세 가지

### (a) CI 정정을 애노테이션으로 독립 검증 — **리포트가 맞다.**

`check-suites/{id}/check-runs` → `check-runs/{id}/annotations`로 확인했다(인증 없는 REST).

| run           | head        | Medium 잡 `conclusion` | 애노테이션                                                                                                                                                                          |
| ------------- | ----------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `33715025550` | `a6a3e56c8` | **success**            | `warning: the medium suite failed; it is non-blocking for now`, `failure: Process completed with exit code 1.`, `failure: AssertionError: expected 'failed' to be undefined` **×3** |
| `33758496224` | `6bfd4708a` | **success**            | 같은 warning + `failure: exit code 1.` (AssertionError 없음)                                                                                                                        |
| `33818957172` | `fe9fe4fed` | success                | 3잡 모두 **Node 20 deprecation warning 뿐**, 실패 애노테이션 0 — **진짜 초록**                                                                                                      |

즉 (i) `continue-on-error`가 `conclusion`을 지운다는 진단은 사실이고, (ii) "두 번 초록"이라는 승격
근거는 사실이 아니었으며, (iii) `fe9fe4fed`는 진짜로 초록이다. 세 문장 다 리포트대로다.
유일한 부정확은 L4(두 run의 애노테이션을 뭉뚱그린 것)뿐이다.

### (b) M1이 순서 외의 동작을 바꿨는지 — **바꾸지 않았다(코드로 확인).**

M2에 적었다. 반환 구성 동일, 두 값 독립, 트랜잭션 없음, 차이는 첫 쿼리 실패 시 두 번째가 실행되지
않는 것뿐(호출자에게는 어느 쪽도 예외). 대신 바뀐 것은 **생성 산출물이고, 그것이 지금 낡아 있다**(C2).

### (c) 이전 라운드가 잡았어야 했는데 못 잡은 것

두 가지다.

1. **H3 (입양 후 재링크 + 프로브 실패 = 전량 중복).** 라운드 16·17이 C3를 "다른 계정이 남의 행을
   상속한다"로만 프레이밍하는 동안, **같은 계정이 자기 행을 잃는** 대칭 경로는 아무도 보지
   않았다. sentinel을 거부한 근거가 정확히 그 실패 모드였는데, 현재 설계에도 그 경로가 있다.
   실 DB에서 `hasUpload` true → false로 확인했다.
2. **동시성.** 직전 리뷰가 `recordUpload` 호출 지점을 "1곳"으로 세고 "모든 기록 경로를 덮는다"고
   결론지었는데, 그 분석은 **한 요청 안의 stale read 축만** 봤다. 큐 동시성 5에서 같은
   `uploadAsset`이 다섯 개 동시에 도는 축은 어느 라운드에서도 검토된 적이 없다. C1이 바로 그
   구멍으로 들어왔다. 앞으로 이 기능의 리뷰 체크리스트에 **"이 코드가 concurrency 5에서 동시에
   다섯 번 돌면?"** 을 한 줄 넣는 것을 권한다.

---

## What I did not verify

- **운영(랩탑) DB.** C1(게이트 명령을 운영 DB에 실행)의 실행 결과는 리포트를 사실로 받아들였고,
  나는 랩탑에 접속하지 않았다. 대신 **같은 쿼리를 내 컨테이너의 Postgres에 넣어 의미를 확인**했다
  — 미식별/식별 사용자와 잔여 `''` 행을 만들어 넣으니 의도대로 나온다. 인용은 heredoc으로 바뀌어
  중첩 문제가 사라졌고 `docker exec -i`도 들어갔다.
- **`about.get`이 `drive.file` 스코프에서 `user.permissionId`를 채우는지.** 네 라운드째 최대
  미검증 항목이다. 실 OAuth 자격 증명이 필요하다. C1·H2·H3의 실제 심각도가 여기에 달려 있다.
- **`google_drive_upload_error` 테이블에 데이터가 있는 상태에서의 `getErrorSummary` 지연.** 빈
  테이블에서 100ms 미만인 것만 봤다. 6,996행 규모에서의 실측은 하지 않았다.
- **lint / prettier / svelte-check.** vitest, `tsc --noEmit`, 그리고 SQL 생성기만 돌렸다.
  `run.sh`의 svelte-check 게이트는 실행하지 않았다(리포트가 클린이라고 적었고, 이 커밋의 web
  변경은 스펙 주석 3줄뿐이다).
- **이 커밋의 CI.** 리포트대로 아직 돌지 않았고 나도 트리거하지 않았다. 다만 **업스트림의
  `sql-schema-up-to-date`가 이 상태에서 실패할 것**이라는 점은 로컬 생성기 실행으로 확정적이다
  (포크 워크플로는 그 잡을 돌리지 않으므로 포크 CI는 초록일 것이다).
- **C1 경합의 실제 운영 발생.** 실 DB의 동시 트랜잭션이 아니라 서비스 레벨(실 where 의미를 가진
  인메모리 행 + 실제 20ms 프로브 지연)에서 재현했다. 실 Postgres에서는 잠금이 더 개입하지만
  결론은 같다 — `driveAccountId is null` 조건이 두 번째 갱신을 0행으로 만드는 것은 medium에서
  직접 확인했다(`already set, same account -> false`).
- **`Promise.all` 오염의 원래 원인.** 4회 재현 실패로 "낡은 산출물"이라고 판단했지만, 특정
  상태에서만 나타나는 경합일 가능성을 배제하지는 못한다.
- **브라우저 렌더.** 이번에도 하지 못했다. 이 커밋의 web 변경은 주석뿐이다.

---

## Feeding back into the plan

1. **"concurrency 5에서 동시에 다섯 번 돌면?"을 이 기능의 리뷰 체크리스트에 넣는다.** 세 라운드
   동안 stale-read 축만 검사했고, C1은 동시성 축으로 들어왔다. 특히 "먼저 읽고 → 네트워크 →
   조건부 쓰기" 모양이 나오면 반드시 묻는다.
2. **불린 반환값은 원인을 잃는다.** `setDriveAccountId`의 `false`가 세 가지 다른 사실("토큰이
   바뀜", "행이 사라짐", "이미 같은 값")을 하나로 뭉갠 것이 C1의 직접 원인이다. 이런 자리에서는
   **실효 값**이나 판별 가능한 결과 타입을 돌려준다.
3. **생성 산출물은 손으로 고치지 않는다.** `server/src/queries/*.sql`은 `mise //:sql`의 출력이며,
   손으로 지운 14줄과 넣지 않은 14줄이 이번 라운드의 C2다. 절차에 "SQL 참조 파일을 편집했다면
   그건 버그"라고 적는다. 업스트림 `sql-schema-up-to-date`가 유일한 감시자인데 포크 CI는 그 잡을
   돌리지 않으므로, 포크 워크플로에 **`mise //:sql` 후 `git diff --exit-code server/src/queries`**
   한 스텝을 추가하는 것이 가장 값싼 보강이다.
4. **입양의 안전 속성을 시각으로 표현한다.** 세 라운드째 열려 있던 H3의 답은
   `uploadedAt >= connectedAt`이고 **새 컬럼이 필요 없다.** 전제는 `upsertCredentials`가
   `connectedAt`을 갱신하는 것 한 줄이다. 배포 전에 `connectedAt <= min(uploadedAt)`을 한 번
   확인한다.
5. **리뷰 지적을 닫을 때 "몇 갈래였는지"를 같이 적는다.** 직전 H2는 (쿨다운/타임아웃/무제한 쓰기)
   세 갈래였고 하나만 반영됐는데 리포트에는 "H2 — 붙였다"로 한 줄이 적혔다. 직전 M2(테스트
   부재)와 L1(겹친 JSDoc)은 아예 언급되지 않았다. **닫은 것 / 부분만 닫은 것 / 의도적으로 두는
   것**을 세 칸으로 적는 표가 필요하다.
6. **증거 파일은 그 코드를 담은 커밋에서 뽑는다.** 한 라운드 전에 `7128a36fc`가 고친 실수가
   `98918dd85`에서 그대로 반복됐다(L2). `run.sh`가 헤더에 커밋을 찍어 주므로, 커밋 훅이나 절차에
   "결과 파일의 `commit:` 줄이 HEAD와 같은지 확인" 한 줄이면 끝난다.

---

**변경 파일 확인**: 리뷰 작성 직전 메인 저장소에서 `git status --porcelain`을 실행했고 출력은
**비어 있었다**(작성 후에는 이 리뷰 파일 하나). 모든 테스트·변이 실험·SQL 생성기 실행·Postgres
컨테이너는 격리 워크트리 `/tmp/gd-review-$$`(detached `17c0f3a82`)와 `/tmp/gd-review-parent`
(detached `202ce87d1`)에서만 수행했고, 종료 시 두 워크트리를 `git worktree remove --force`로
제거해 `git worktree list`에 남아 있지 않다. 실험용 컨테이너 `gd-review-pg`도 `docker stop`으로
정리했다.
