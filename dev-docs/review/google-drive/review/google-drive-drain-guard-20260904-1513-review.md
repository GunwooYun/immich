# Code Review — 드레인 가드(H1) + 낡은 생성 SQL(C1) + 프로브 상한(H2), 그리고 남은 절반

|                  |                                                                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch / HEAD    | `feat/google-drive-album-sync-v3.1.0` / `e56776855`                                                                                                                                                                    |
| Commits reviewed | `cf04b0910`(H1/C1/H2/M2/M3). `e56776855`는 리포트 + 증거 파일                                                                                                                                                          |
| Report           | `../report/google-drive-drain-guard-20260904-1457-report.md`                                                                                                                                                           |
| Prior review     | `google-drive-drain-20260904-1349-review.md`                                                                                                                                                                           |
| Reviewed         | 2026-09-04                                                                                                                                                                                                             |
| 작업 환경        | 격리 워크트리 `/tmp/gd-review-57609`(detached `e56776855`) + 컨테이너 `gd-rev19-pg`(`ghcr.io/immich-app/postgres:14-vectorchord0.4.3`, `immich` DB 전 마이그레이션). 빌드·변이·SQL 생성기·psql 실험은 전부 그 안에서만 |

## Verdict

**C1(생성 SQL)과 H2(상한)의 방향은 옳고, C1은 완전히 닫혔다 — 전 마이그레이션 DB에서 생성기를
돌려 diff 0을 직접 확인했다.** H1의 가드도 그 자체로는 정확하고, 되돌리는 변이를 넣으면 새 테스트가
정확히 하나 실패한다(비공허). 그러나 **가드는 드레인이라는 한쪽 문만 닫았고, 똑같은 오귀속이
`adoptIfNewlyIdentified`에 그대로 살아 있다.** 미식별 연결 A가 `''` 행을 남긴 채 사라지고, 그다음
연결 B도 미식별로 시작했다가 **나중에 프로브에 성공하면** `getStatus:599`가
`adoptUnstampedUploads(userId, 'B')`를 불러 **A의 행 전부를 B로 찍는다**(`repository.ts:150-155`,
조건 없음). 실 Postgres에서 그 상태를 만들고 A를 재연결시키니 `has_upload = f` — 6,996행이
A의 드라이브로 **중복 재업로드**된다. 이것은 이번 커밋이 고친 H1과 **같은 실패 클래스이고 같은
비가역성**이다. 코드 자신도 `:464-466`에서 그 상태를 인정하지만, 드레인의 JSDoc과 커밋 메시지는
가드가 이 클래스를 닫은 것처럼 서술한다. 요청 1번의 직답은 **"충분하지 않다"** 이다.

두 번째로 중요한 것: **10초 상한이 잘못된 구간에 걸려 있고, 값도 실효 30초다.** `about.get`에
`{ timeout: 10_000 }`을 붙였지만 googleapis-common이 `options.retry = true`를 기본값으로 넣고
(`apirequest.js:263`) gaxios의 `noResponseRetries` 기본값이 2라서(`retry.js:32-35`) 타임아웃 에러는
**두 번 더 재시도된다** — 최악 3 × 10초. 그리고 이 프로브가 반드시 먼저 하는 일은 **OAuth 토큰
갱신 POST**인데(`setCredentials`에 access_token이 없으므로 `oauth2client.js:303-315`가 항상 갱신한다),
그 요청은 `oauth2client.js:212-218`에서 **timeout 없이** 나간다. "구글이 연결 해제를 무기한 붙잡을
수 없다"는 약속은 아직 코드가 지키지 않는다.

세 번째: **새 링크-경로 드레인 테스트는 "떠나는 토큰으로 프로브했다"를 검증하지 못한다.**
`arrangeLink`가 `driveAboutGet`을 **단일 정적 목**으로 두어(`spec.ts:138`) 옛 토큰과 새 토큰의
프로브 결과가 같은 값이다. 드레인 안의 `credentials.refreshToken`을 리터럴 `'MUTANT-WRONG-TOKEN'`으로
바꿔도 **73/73 통과**했다. 드레인의 유일한 안전성 근거에 테스트가 없다.

리포트가 검증했다고 한 수치는 전부 재현됐다(254/39/23, CI 3잡 success + 실패 애노테이션 0,
`tsc --noEmit` rc=0, prettier 클린). 런북은 M2가 요구한 것을 반쯤만 반영했고, 이번 커밋이 **새 모순을
하나 더 만들었다**(쿼리 컬럼명을 `drive_account`로 바꾸고 그것을 읽는 문장 두 개를
`unidentified = true/false`로 남겨 뒀다).

### Evidence I ran myself

| Check                                                                              | Result                                                                                                   |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 서버 유닛 8스펙(`run.sh`의 `SERVER_SPECS`), `e56776855`                            | `Test Files 8 passed / Tests 254 passed` — 리포트와 일치                                                 |
| 웹 유닛 4스펙                                                                      | `Tests 39 passed` — 일치                                                                                 |
| medium `google-drive.repository.spec.ts`(전 마이그레이션 DB)                       | `Tests 23 passed` — 일치                                                                                 |
| `npx tsc --noEmit`(server)                                                         | rc=0                                                                                                     |
| `prettier --check`(변경된 TS 4파일)                                                | 클린                                                                                                     |
| **SQL 생성기, 전 마이그레이션 DB**(`node dist/bin/sync-sql.js`, `DB_URL=…/immich`) | **`git diff` 비어 있음** — 커밋된 SQL이 옳다. `Generated 426 queries`                                    |
| **같은 생성기, 마이그레이션 없는 DB**                                              | `google.drive.repository.sql` **−21줄** + 다른 8개 파일도 변형. `Generated 426 queries` (**동일**)       |
| 생성기 에러 로그 비교(migrated vs unmigrated)                                      | `does not exist` **3건 vs 366건**, 총 에러 **41건 vs 373건** — 쿼리 수는 무용, 에러 로그는 완벽한 판별자 |
| CI 런 `33838772617` (GitHub API)                                                   | `head_sha = cf04b0910`, 3잡 전부 `success`, 실패 애노테이션 0 (warning 1건: Node 20 deprecation)         |
| `git ls-remote origin`                                                             | `cf04b0910` — 코드 커밋은 푸시됨(리포트 커밋 `e56776855`는 아직 아님)                                    |
| **변이**: 드레인의 `credentials.refreshToken` → 리터럴 오답 토큰                   | **73/73 통과** — "떠나는 토큰" 단언 없음 (H2)                                                            |
| **변이**: `if (credentials.driveAccountId) return;`을 `?? probe`로 되돌림          | 1건 실패(`should leave the bucket alone …`) — 가드 테스트는 **비공허**                                   |
| **변이**: `about.get`의 `{ timeout }` 제거                                         | **73/73 통과** — 상한에 테스트 없음 (N1)                                                                 |
| **변이**: `setDriveAccountId`의 **select** 쪽 `refreshToken` 제거                  | **23/23 통과** — 직전 라운드 N1 재현                                                                     |
| **실 DB**: `''` 행 → B가 입양 → A 재연결                                           | `has_upload = f` — **중복 재업로드 경로** (C1)                                                           |
| **실 DB**: 고아 `''` 행 → 새 계정 C 연결                                           | `has_upload = t` — 드레인 JSDoc `:406-409`의 "재업로드된다"는 **거짓** (M1)                              |
| **실 DB**: 같은 계정 재링크 중 select 토큰 필터 유무                               | 필터 있음 → `null`(입양 건너뜀) / 없음 → `'A'`(입양 진행) — N1의 유일한 차이                             |
| 런북 게이트 쿼리를 실 DB에 실행                                                    | 문법 정상(0행)                                                                                           |
| `.github/workflows/fork-google-drive.yml`                                          | 잡 3개(Feature suite / Full sweep / Medium), **SQL 스텝 없음** — 여전히 드리프트를 볼 곳이 없다          |
| 워크트리 `git status --porcelain`(변이 복원 후)                                    | 클린(심볼릭 링크한 `node_modules` 외)                                                                    |

---

## Findings

### C1 — H1 가드는 드레인만 닫았다. **같은 오귀속이 `adoptIfNewlyIdentified`에 그대로 있다** (Critical)

`drainUnstampedUploads`는 이제 미식별 연결에서만 돈다(`google-drive.service.ts:426-428`). 옳다.
그러나 **`''` 버킷을 조건 없이 통째로 찍는 다른 호출자가 셋** 있고, 거기에는 아무 가드가 없다.

```
google-drive.service.ts:489   adoptIfNewlyIdentified → adoptUnstampedUploads(userId, driveAccountId)
   호출자 :599  getStatus     (설정 화면 로드 — 런북 1단계가 시키는 바로 그 호출)
   호출자 :728  getStorage
   호출자 :902  uploadAsset
google-drive.repository.ts:150-155   update … where "userId"=$ and "driveAccountId"=''   ← 조건 끝
```

**재현 경로(사용자 조작만으로 도달한다).**

| 단계                                                                   | 상태                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1. 계정 A 연결, 프로브 실패 → `driveAccountId = NULL`                  | 업로드 N건이 `''`. 파일은 **A의 드라이브**                          |
| 2. 연결 해제 → 드레인이 A 토큰으로 프로브, **또 실패**                 | 행은 `''` 유지. `deleteCredentials`                                 |
| 3. 계정 B 연결 → 드레인은 `:417-419`에서 **자격증명이 없어 즉시 반환** | B의 프로브도 실패 → `{T_B, null}`                                   |
| 4. B가 업로드 몇 건 → 역시 `''`                                        | 버킷 = **A의 N건 + B의 몇 건**                                      |
| 5. 나중에 B의 프로브 성공(설정 화면) → `adoptIfNewlyIdentified`        | `adoptUnstampedUploads(userId,'B')` → **A의 N건이 'B'로 영구 귀속** |
| 6. A 재연결                                                            | 매칭 실패 → **A의 드라이브에 N건 중복 업로드**                      |

5·6단계를 실 Postgres에서 그대로 실행했다(예측이 아니라 실제 술어로):

```
 after B adopted A's row    | driveAccountId = B
 A reconnects -> has_upload | f
```

`has_upload = f`는 백필이 그 자산들을 다시 큐에 넣는다는 뜻이고, `files.create`에 멱등 검사가 없으므로
**되돌릴 수 없다.** 이것은 H1이 막으려던 것과 **같은 실패, 같은 비가역성**이다. 드레인 쪽 문만 닫혔다.

코드는 이 상태를 이미 알고 있다 — `:464-466`:

> _"The rows stay in the '' bucket … but the bucket is shared, so this is also the state in which a
> different account would inherit them."_

문제는 **아는 것을 막지 않았다는 것**이 아니라, 드레인의 JSDoc(`:401-414`)과 커밋 메시지가
_"the only case where the unstamped rows are provably its own"_ 이라고 **클래스 전체가 닫힌 것처럼**
말한다는 점이다. `adoptIfNewlyIdentified`의 JSDoc `:444-447`도 _"whatever those unstamped rows were
uploaded to is, by definition, this account"_ 라고 단언하는데, 위 5단계에서 그것은 **거짓**이다.

**Fix.** 입양 대상을 "이 연결이 쓸 수 있었던 행"으로 좁힌다. 유일하게 서버가 판정할 수 있는 술어는
시각이다 — `google_drive_upload.uploadedAt >= user_google_drive.connectedAt`. 두 컬럼 다 이미 있다
(`google-drive-upload.table.ts:68`, `user-google-drive.table.ts:68`).

⚠ **다만 직전 라운드가 이 제안을 하면서 놓친 것이 있다(내 잘못이다):** `connectedAt`은
`@CreateDateColumn`이고 `upsertCredentials`는 `doUpdateSet({ refreshToken, driveAccountId })`
(`repository.ts:83`)로 **`connectedAt`을 갱신하지 않는다.** 연결 해제 없이 재링크하면 `connectedAt`은
**최초 연결 시각**으로 남아 술어가 무의미해진다. 그러므로 이 fix는 `doUpdateSet`에
`connectedAt: new Date()`를 **함께** 넣어야 성립한다. 그 한 줄 없이 시각 술어만 넣으면 조용히
아무것도 안 하는 가드가 된다.

차선(더 작은 변경): `adoptIfNewlyIdentified`가 **직전 연결이 미식별로 끝났을 가능성**을 알 수 없으므로,
최소한 입양 직전에 `''` 행 수를 로그로 남기고("adopting N unstamped rows into <id>"), 런북에
"입양 전에 `unstamped` 수가 이 연결이 올린 양과 맞는지 본다"를 넣는다. 판정을 사람에게 넘기더라도
**표현은 만들어야 한다**(직전 라운드 M2와 같은 논리).

---

### H1 — 10초 상한이 **잘못된 구간**에 걸려 있고, 실효값은 30초다 (High)

`google-drive.service.ts:518`:

```ts
.about.get({ fields: 'user(permissionId)' }, { timeout: GoogleDriveService.ACCOUNT_PROBE_TIMEOUT_MS });
```

옵션 자체는 실재한다(확인함: `googleapis-common/build/src/api.d.ts:28` `MethodOptions extends
GaxiosOptions`, gaxios가 opts를 node-fetch로 그대로 넘기고 `node-fetch/lib/index.js:1491-1496`이
하드 타이머를 건다). 그런데 두 가지가 약속을 깬다.

**(a) 재시도가 상한을 3배로 만든다.** `googleapis-common/build/src/apirequest.js:263`이
`options.retry = options.retry === undefined ? true : options.retry`로 **기본 재시도를 켠다.**
gaxios `retry.js:32-35`의 `noResponseRetries` 기본값은 **2**이고, node-fetch의 `request-timeout`
에러는 `response`가 없고 `AbortError`도 아니며 메서드가 GET이라 `shouldRetryRequest`의 모든 관문을
통과한다. 최악 **3 × 10초 + 백오프 ≈ 30.3초.** 주석은 10초를 약속한다.

**(b) 상한이 없는 다리가 먼저 지나간다.** `oauth2Client.setCredentials({ refresh_token })`만 하므로
access_token이 없고, `google-auth-library/build/src/auth/oauth2client.js:303-315`의
`getRequestMetadataAsync`가 **매번 토큰 갱신을 먼저** 한다. 그 POST는 `:212-218`에서
`OAuth2Client.RETRY_CONFIG`만 얹고 **timeout 없이** 나간다. 즉 프로브가 하는 **첫 네트워크 왕복이
무제한**이다. `disconnect`를 구글이 붙잡을 수 없다는 주석 `:514-515`는 아직 코드가 보장하지 않는다.

**Fix.**

1. `about.get` 호출에 `retryConfig: { retry: 0, noResponseRetries: 0 }`을 같이 준다. 신원 프로브는
   실패해도 무해하므로(`getDriveAccountId`가 null을 돌려주고 `''`이 받는다) 재시도할 이유가 없다.
2. 전체를 감싸는 상한을 서비스 레벨에 둔다 — `getDriveAccountId` 본문을
   `AbortSignal.timeout(10_000)`/`Promise.race`로 감싸면 **토큰 갱신까지** 포함된다. 지금 형태는
   구조적으로 갱신 다리를 덮을 수 없다.
3. 상수 이름이 `ACCOUNT_PROBE_TIMEOUT_MS`인데 실제로는 `about.get` 요청 하나의 상한이다. 1·2를
   적용하면 이름이 참이 된다.

---

### H2 — 새 링크-경로 드레인 테스트는 **"떠나는 토큰"을 검증하지 못한다**. 오답 토큰으로 바꿔도 73/73 통과 (High, 테스트)

`google-drive.service.spec.ts:1335-1352`의 주석은 _"Probed with the **outgoing** token, and adopted
into what that probe found"_ 라고 적는다. 그러나 `arrangeLink`(`spec.ts:138`)는

```ts
driveAboutGet.mockResolvedValue({ data: { user: { permissionId: newAccountId } } });
```

**단일 정적 목**이라 옛 토큰의 프로브와 새 토큰의 프로브가 **같은 값**을 돌려준다. 그래서 단언
`adoptUnstampedUploads(userId, 'account-b')`는 두 경우를 구별할 수 없다. 변이로 확인했다 —
`drainUnstampedUploads:430`의 `credentials.refreshToken`을 리터럴 `'MUTANT-WRONG-TOKEN'`으로
바꿔도 **73/73 통과**한다.

옛 테스트는 `'account-a'`를 단언해서 최소한 "저장된 id를 쓴다"는 사실은 고정했다. 지금은 **아무것도
고정하지 않는다.** 드레인이 옳은 이유는 단 하나 — 떠나는 토큰으로 프로브한다 — 인데, 그 하나에
테스트가 없다. (참고: `should drain on disconnect`(`:1375-1388`)는 새 토큰이라는 개념이 없어
`'account-a'`가 프로브에서만 올 수 있으므로 그쪽은 비공허하다.)

**Fix.** 링크 경로 테스트에서 프로브 결과를 두 갈래로 만든다:

```ts
driveAboutGet.mockResolvedValueOnce({ data: { user: { permissionId: "account-a" } } }); // 드레인(옛 토큰)
// 이후 arrangeLink의 기본값 'account-b'가 링크 프로브에 쓰인다
expect(mocks.googleDrive.adoptUnstampedUploads).toHaveBeenCalledWith(userId, "account-a");
expect(mocks.googleDrive.upsertCredentials).toHaveBeenCalledWith(userId, "new-refresh-token", "account-b");
```

두 줄이면 "옛 토큰으로 프로브했고, 새 계정은 따로 기록됐다"가 동시에 고정된다.

---

### M1 — 드레인의 JSDoc이 **자기 존재 이유를 반대로 적고 있고**, 같은 커밋이 고친 테이블 주석과 정면 충돌한다 (Medium, 문서 — 그러나 H1을 낳은 사고방식)

`google-drive.service.ts:406-409`:

> _"once a new connection is stamped, `adoptIfNewlyIdentified` returns early and the rows are
> orphaned for good, **so the next backfill re-uploads them into whichever Drive is connected then.**
> With ~7,000 rows and no idempotency on files.create, that is thousands of duplicate files."_

**거짓이다.** 원장 술어(`google-drive.repository.ts:45,48`)는 `or "driveAccountId" = ''`를 포함하므로
고아 `''` 행은 **어떤 연결과도 매칭된다.** 실 DB로 확인했다:

```
 orphaned '' row, new account C connected -> has_upload | t
```

그리고 **같은 커밋이** `google-drive-upload.table.ts:26-28`에 정확히 반대되는 문장을 추가했다 —
_"Rows carrying '' match **any** connection on purpose … because the cost of not matching them is
re-uploading a library."_ 한 커밋 안에서 두 주석이 서로를 부정한다.

드레인의 **진짜** 가치는 중복 방지가 아니라 **조용한 no-op 방지**다(직전 라운드 M1): `''` 행이 남으면
새 계정이 그것을 "업로드됨"으로 읽어 **새 드라이브가 영원히 비어 있게** 된다. 이 차이는 사소하지
않다 — "중복을 막아야 한다"는 잘못된 전제가 바로 **첫 드레인이 저장된 id를 붙잡게 만든 이유**이고,
그것이 H1이었다.

**Fix.** `:406-409`를 실제 위험(계정 전환이 조용히 아무 일도 안 함)으로 다시 쓴다. 그리고
`:362-364`의 _"connect a different account and none of the old rows match, so the backlog recomputes
by itself"_ 도 `''` 버킷에 대해 여전히 거짓이다 — 직전 라운드 M1이 지적했고 **이번 커밋이 손대지
않았다.**

---

### M2 — 런북이 여전히 세 곳에서 코드와 어긋나고, 이번 커밋이 **네 번째를 새로 만들었다** (Medium, 문서)

| 줄                  | 문장                                                                                      | 현재 진실                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md:390`     | 쿼리가 `coalesce(…) as drive_account`를 출력                                              | **새 모순**: `:399`·`:402`가 여전히 `unidentified = true` / `unidentified = false`를 읽으라고 한다. 그 컬럼은 이제 **존재하지 않는다** |
| `CLAUDE.md:412`     | "위 쿼리의 **`driveAccountId`**가 실제로 쓰던 구글 계정인지 눈으로 확인한다"              | 컬럼명이 `drive_account`이고, "알아보라"는 지시는 `:417-420`이 대체했는데 남아 있다                                                    |
| `CLAUDE.md:414-415` | "연결 해제·재연결을 먼저 해도 안전하다 … 떠나는 토큰으로 미상 행을 그 계정에 넘긴다"      | **이번 커밋이 거짓으로 만들었다.** 식별된 연결은 드레인하지 않는다. 그리고 런북 1단계가 랩탑을 바로 그 상태로 만든다                   |
| `CLAUDE.md:376`     | "입양이 돌기 전에 연결을 해제하고 다시 연결하면 라이브러리 전체가 중복으로 다시 올라간다" | 직전 라운드 M3-1. 여전히 거짓(`''`은 계속 매칭). **미수정**                                                                            |
| `CLAUDE.md:422`     | "입양은 … 연결 경로에서는 **절대** 하지 않는다"                                           | 직전 라운드 M3-3. `linkAccount:375`가 드레인한다. **미수정**                                                                           |

즉 M3는 5개 중 1개만 닫혔고, 닫는 과정에서 하나가 새로 열렸다. `:414-415`가 특히 위험하다 — 운영자가
그 문장을 믿고 "먼저 끊었다 다시 연결"을 하면, 식별된 연결에서는 **드레인이 돌지 않는다.**

또한 직전 라운드 M1(b)이 요구한 **회복 절차**(`delete from google_drive_upload where "userId"=… and
"driveAccountId"=''`)는 런북·dev-docs 어디에도 없다(`grep` 0건). `''` 버킷을 비우는 코드 경로는
`adoptUnstampedUploads` 안의 중복 제거용 하나뿐이므로, 운영자가 잘못된 입양을 되돌릴 방법이 문서에 없다.

**Fix.** `:399`·`:402`를 `drive_account = '(unidentified)'` / `≠ '(unidentified)'`로 고치고, `:412`를
삭제(`:417-420`이 대체), `:414-415`에 "단, **식별된 연결은 드레인하지 않는다** — 이미 입양이 끝나
버킷이 비어 있어야 정상"을 붙이고, `:376`·`:422`를 지운다. 그리고 회복용 `delete` 한 줄을 §회복에 넣는다.

---

### M3 — 포크 CI에는 **여전히 SQL 검사가 없다.** C1 클래스를 볼 수 있는 곳이 아직 없다 (Medium, CI — 요청 2번의 답)

`.github/workflows/fork-google-drive.yml`의 잡은 셋이고(Feature suite / Full sweep / Medium)
`mise //:sql`도 `git diff server/src/queries`도 없다. 업스트림 `test.yml:758,827-845`에는 있지만 이
브랜치 푸시는 그 워크플로를 돌리지 않는다. 즉 이번 커밋이 SQL을 고쳤어도 **다음 드리프트는 또
사람이 기억해야만 잡힌다.**

**측정 가능한 판별자를 찾았다.** 생성기를 두 DB에 돌려 비교하면:

| 신호                  | 전 마이그레이션 | 마이그레이션 없음 |
| --------------------- | --------------- | ----------------- |
| `Generated … queries` | **426**         | **426**           |
| `git diff` 파일 수    | 0               | **9**             |
| `does not exist` 에러 | **3**           | **366**           |
| 전체 `… error:` 줄    | 41              | 373               |

`426`은 블록 수라 원리적으로 무용하다(`sync-sql.ts:193`). 반면 **`does not exist` 에러 수는 3 대
366으로 두 자릿수 이상 갈린다** — 이것이 "DB가 틀렸다"의 신호다. 그리고 마이그레이션 없는 DB에서는
`google.drive.repository.sql` 말고도 **8개 파일이 함께 변형된다**(asset/duplicate/library/memory/
ocr/search/session/tag). 내가 만지지 않은 파일이 diff에 나타나면 그것이 곧 환경 오류다.

**Fix (권고 순).**

1. **포크 워크플로에 잡 하나.** 업스트림 `sql-schema-up-to-date`의 축약판이면 충분하다:
   postgres 서비스 → `pnpm --filter immich migrations:run` → `mise //:sql` →
   `git diff --exit-code server/src/queries`. **기억에 의존하지 않는 유일한 해법이다.**
2. **생성기 자체를 시끄럽게.** `sync-sql.ts:22-24`의 `handleError`는 전부 삼킨다. 여기서
   `relation … does not exist` / `column … does not exist` 계열을 세고, 임계치를 넘으면
   `process.exitCode = 1`과 함께 _"the target database looks unmigrated — run migrations first"_ 를
   출력한다. 조용한 절단이 **큰 소리로 거부**가 된다. (첫 문장이 던지면 두 번째 문장이 실행조차
   되지 않는 것이 절단의 메커니즘이다 — `sync-sql.ts:165`.)
3. 런북 한 줄: _"`mise //:sql` 전에 대상 DB에 `migrations:run`이 끝나 있어야 한다. 내가 만지지 않은
   repository의 `.sql`이 diff에 나타나면 DB가 틀린 것이다."_

---

### M4 — 입양의 토큰 가드는 **입양 트랜잭션 안**에 `for update`로 넣어야 한다. 재읽기는 답이 아니다 (Medium — 요청 4번의 답)

리포트가 물은 두 선택지 중 **"입양 SQL에 조건"** 쪽이 맞고, 형태는 `exists` 서브쿼리보다
**행 잠금**이어야 한다.

**왜 재읽기가 아닌가.** 드레인 직전에 자격증명을 다시 읽는 것은 read-then-act를 하나 더 만드는
것이다. 재읽기와 `adoptUnstampedUploads` 사이에 재링크가 들어올 창이 그대로 남는다. **직전 두
라운드가 정확히 이 모양(읽고 → 네트워크 → 쓰기)으로 각각 한 라운드씩 탔다.** 창을 좁히는 수정은
같은 버그를 다시 만드는 방법이다.

**왜 `for update`인가.** `upsertCredentials`(`repository.ts:80-84`)는 `insert … on conflict do update`
라서 `user_google_drive` 행에 **쓰기 잠금**을 잡는다. `adoptUnstampedUploads`의 기존 트랜잭션
(`repository.ts:134`) 첫 문장으로

```sql
select 1 from "user_google_drive"
where "userId" = $1 and "refreshToken" = $2
for update
```

를 넣고 0행이면 중단·경고하면, "프로브 이후 연결이 움직이지 않았다"가 **가정이 아니라 검사된
선행조건**이 되고 두 트랜잭션이 직렬화된다. 계정 id가 아니라 **토큰**으로 거는 것이 중요하다 —
드레인 경로에서 계정은 프로브로만 알고, 확인하고 싶은 것은 "그 토큰이 아직 현재 연결인가"다.

읽기 경로(`getStatus`/`uploadAsset`)에서는 `setDriveAccountId`가 이미 CAS를 하므로 중복처럼
보이지만, 그 CAS와 입양 사이에도 창이 있다. 하나의 트랜잭션에 넣으면 두 경로가 같은 가드를 공유한다.

**단, 이것으로 C1은 닫히지 않는다.** M4는 "프로브 중 연결이 바뀌는" 경쟁만 닫고, C1은 경쟁 없이도
성립한다(이전 연결이 남긴 행). 둘은 독립적으로 고쳐야 한다.

---

### N1 — `setDriveAccountId`의 select 쪽 `refreshToken`: **빼도 안전하고, 오히려 한 경우에 더 낫다** (Low — 요청 4번의 답)

23/23이 통과한다는 지적을 변이로 재현했다(`repository.ts:113`의 `.where('refreshToken', …)` 제거 →
medium 23/23). 그리고 이 조건이 **결과를 바꾸는 경우를 실 DB에서 하나 찾았다** — 프로브 중에 **같은
계정으로** 재링크(토큰만 교체)가 들어온 경우:

```
 with token filter    | settled = (null)   → settled !== 'A' → 입양 건너뜀
 without token filter | settled = A        → settled === 'A' → 입양 진행 (옳다)
```

즉 이 조건은 **더 보수적일 뿐이고, 잘못된 쓰기를 막지는 않는다.** 잘못된 쓰기를 막는 것은 update
쪽 조건(`:104`)이고 그쪽은 테스트가 잡는다. 커밋 메시지의 _"a changed token still is failure,
because the read is scoped to the token too"_ 는 **의도의 서술**이지 안전성 논거가 아니다.

**권고: 남기되, 이유를 바꿔 적고 테스트를 하나 붙인다.** 남길 이유는 안전이 아니라 **"update가 겨눈
행과 select가 읽는 행이 같다"는 일관성**이다(그래야 `settled`가 "이 토큰의 행이 지금 담고 있는 값"을
뜻한다). 그 의미를 고정하는 medium 케이스는 여섯 줄이다 — 같은 계정·다른 토큰으로 행을 만들어
놓고 옛 토큰으로 호출 → `null`을 기대. 테스트 없이 남기면 다음 리팩터가 조용히 지운다.
테스트를 붙일 생각이 없다면 **지우는 쪽이 맞다** — 위 표대로 지우는 편이 한 경우에 더 정확하다.

---

### N2 — 프로브 상한에 테스트가 없다 (Low)

`{ timeout: … }`을 지워도 73/73 통과한다(변이 확인). H1의 fix와 함께
`expect(driveAboutGet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ timeout: 10_000 }))`
한 줄이면 고정된다.

---

### N3 — 직전 라운드 N3(고아 JSDoc)가 **그대로 남았다** (Low, 2회차)

`google-drive.service.ts:389-399`의 JSDoc은 내용상 `adoptIfNewlyIdentified`의 것인데
(_"Doing the same inside linkAccount would be unsafe"_), 선언은 `:415 drainUnstampedUploads`이고 그
함수는 **linkAccount에서 호출된다**(`:375`). 읽는 사람이 먼저 만나는 문단이 아래 코드가 하는 일을
부정한다. 한 줄 삭제다. 직전 라운드가 지적했고 이번 커밋이 손대지 않았다.

---

### N4 — `:371`의 "just above"가 방향이 틀렸다 (nitpick)

`google-drive.service.ts:371` _"handed to their owner by drainUnstampedUploads **just above**"_ —
호출은 `:375`, 즉 그 주석 **아래**다.

---

### N5 — 증거 파일의 `commit:`이 또 부모다 (nitpick, 5회차)

`cf04b0910`이 담은 `dev-test/google-drive/results/20260904-1357.txt:3`은 `commit: 6f4668f0a`(부모)다.
HEAD의 `20260904-1457.txt:3`은 `cf04b0910`으로 옳고 254/39/23이며 내 재현과 일치한다. 직전 라운드
N2가 제안한 **커밋 훅**(결과 파일의 `commit:` ≠ `git rev-parse --short HEAD`면 거부)이 여전히 없다.
다섯 번 중 네 번 틀렸으니 사람이 기억하는 방식은 이미 반증됐다.

---

### N6 — `adoptUnstampedUploads`의 JSDoc이 이제 문자 그대로 거짓 (nitpick)

`google-drive.repository.ts:126-127` _"Only ever called while the pre-existing token is in place,
**never during a link**"_ — `linkAccount:375`의 드레인이 부른다. 앞 절(기존 토큰이 살아 있는 동안)은
여전히 참이므로 뒷절만 고치면 된다.

---

### N7 — 주석 줄바꿈 (nitpick)

`google-drive-upload.table.ts:28`이 120자로, 같은 블록의 다른 줄(92~98자)과 어긋난다. prettier는
주석을 재배치하지 않아 검사에 걸리지 않는다. 문장을 끼워 넣고 다시 감싸지 않은 흔적이다.

---

## Answers to what the report asked me to attack

### 1. H1 가드가 충분한가 — **충분하지 않다. 같은 실패가 `adoptIfNewlyIdentified`에 남아 있다.**

C1 전문. `drainUnstampedUploads`에 도달하는 경로는 둘뿐이고(`linkAccount:375`, `disconnect:832`)
둘 다 가드를 지난다 — 그 부분은 옳다. 하지만 **`''` 버킷을 통째로 찍는 지점은 넷**이고, 나머지 셋
(`getStatus:599`, `getStorage:728`, `uploadAsset:902` → `adoptIfNewlyIdentified:489`)에는 가드가 없다.
직전 연결이 미식별로 끝났으면 그 행들은 지금 연결의 것이 아니며, 실 DB로 `has_upload = f`(중복
재업로드)까지 확인했다.

**자격증명 행의 상태별 점검**(요청대로 전수):

| credentials 상태                       | 드레인 동작          | 판단                                                                               |
| -------------------------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| 없음(`!credentials`)                   | `:417-419` 즉시 반환 | 옳다. 넘겨줄 소유자가 없다                                                         |
| `driveAccountId` 있음                  | `:426-428` 즉시 반환 | 옳다. 이번 커밋의 핵심                                                             |
| `driveAccountId === null`, 프로브 성공 | 입양                 | 옳다 — **단, 버킷에 이전 연결의 행이 섞여 있으면 그것도 가져간다**(C1과 같은 뿌리) |
| `driveAccountId === null`, 프로브 실패 | 경고 후 `''` 유지    | 옳다                                                                               |

**"드레인 실패 후 나중에 식별되면 행이 영영 미상으로 남는 것이 맞는가"** — 경로를 갈라 답한다.

- **disconnect 경로**: 드레인이 실패하면 `deleteCredentials`로 토큰이 사라진다. 그 뒤로 그 행들의
  소유권을 증명할 수단은 **존재하지 않는다.** `''`로 남는 것이 옳고, "두 번째 기회"는 원리적으로
  불가능하다. 그리고 `''`은 계속 매칭되므로 재업로드도 없다(실 DB `has_upload = t`로 확인).
- **linkAccount 경로**: 드레인이 실패하고 새 연결이 **식별되면** 행은 `''`로 남는다 — 이것도 옳다.
  새 토큰은 그 행들의 소유권을 증명하지 못한다.
- **linkAccount 경로, 새 연결도 미식별이면**: 지금은 "두 번째 기회"가 **이미 있다** —
  `adoptIfNewlyIdentified`가 나중에 그 행들을 **새 계정**으로 가져간다. 그리고 그것이 C1이다.

**즉 필요한 것은 두 번째 기회를 더하는 것이 아니라, 지금 있는 잘못된 두 번째 기회를 없애는 것이다.**
드레인이 실패한 뒤 미상으로 남는 것은 옳은 결말이고, 코드가 그것을 옳게 처리하지 못하는 유일한
지점이 입양 경로다.

### 2. C1 이후 생성물 검증 절차 — **러너에서 확인하는 방법이 있고, 그보다 CI 잡 하나가 낫다.**

M3 전문. 요지 셋:

1. **`Generated 426 queries`는 원리적으로 무용하다** — 블록 수이고 두 상태에서 동일하다(직접 확인).
2. **판별자는 에러 로그다** — `does not exist`가 마이그레이션된 DB에서 **3건**, 없는 DB에서
   **366건**. `sync-sql.ts`가 이 계열을 세어 임계치 초과 시 non-zero로 죽으면 "조용한 절단"이
   "시끄러운 거부"가 된다. 이것이 **생성기 안의 가드**다.
3. **가장 확실한 것은 CI 잡** — 포크 워크플로에 migrations → `mise //:sql` →
   `git diff --exit-code server/src/queries` 스텝. 사람의 기억을 절차에서 제거하는 유일한 방법이다.

보조 신호 하나 더: 마이그레이션 없는 DB에서는 **내가 만지지 않은 8개 repository의 `.sql`도 함께
변한다.** "diff에 남의 파일이 있으면 내 DB가 틀린 것"은 눈으로 즉시 쓸 수 있는 규칙이다.

### 3. 10초가 적절한가, `getStatus`·`uploadAsset`에도 필요한가

**값 자체는 적절하다.** `about.get`은 계정 메타데이터 한 건이고 정상 응답은 수백 ms다. 10초는
느린 네트워크를 살려 주면서 사람이 버튼 앞에서 기다릴 수 있는 상한이다. 문제는 값이 아니라
**적용 범위와 실효값**이다(H1): 재시도로 실효 30초, 그리고 그 앞의 **토큰 갱신 왕복은 무제한**이다.

**`getStatus`와 `uploadAsset`은 이미 같은 상한을 갖고 있다** — 둘 다 `getDriveAccountId`를 통과하기
때문이다(`:602`, `:905`). 상한을 호출 지점이 아니라 **공용 헬퍼**에 건 것은 옳은 선택이었다.

**상한이 없는 곳은 따로 있다.**

| 지점                                                        | 상한 | 판단                                                                                                         |
| ----------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| `getStorage`의 `about.get` (`:711-713`)                     | 없음 | **붙일 것.** 설정 화면이 폴링하는 호출이고, 여기서도 `adoptIfNewlyIdentified:728`을 부른다. 같은 10초가 맞다 |
| `getAccessToken`의 `oauth2Client.getAccessToken()` (`:801`) | 없음 | 붙이기 어렵다(라이브러리가 옵션을 받지 않는다). H1의 fix 2(서비스 레벨 race)와 같은 형태가 필요하다          |
| `files.create` (`:1034`)                                    | 없음 | **붙이면 안 된다.** 대용량 영상 업로드가 10초를 넘는 것이 정상이다. 여기의 상한은 `retryConfig`가 맡는다     |

### 4. M4 / N1의 방향

M4·N1 항목 전문. 한 줄 요약:
**M4** — 입양 트랜잭션의 첫 문장에 `select … where "userId"=$ and "refreshToken"=$ for update`.
재읽기는 창을 좁힐 뿐이고, 창을 좁히는 수정이 직전 두 라운드를 태운 바로 그 형태다.
**N1** — 빼도 안전하고 한 경우엔 더 정확하다. 남기려면 여섯 줄짜리 medium 케이스를 같이 넣고,
"안전 가드"라는 서술을 "update와 select가 같은 행을 본다"로 낮춘다.

---

## 추가로 요청받은 세 가지

### (a) +21줄 SQL — **직접 검증했다. 지금 커밋된 것이 옳다.**

전 마이그레이션 `immich` DB(`npm run migrations:run` 완료, `AddGoogleDriveUploadAccountId`까지)에
`node dist/bin/sync-sql.js`를 돌리자 **`git diff`가 비었다.** 즉 커밋본 = 생성물이다. 반대 방향도
확인했다 — 같은 바이너리를 마이그레이션 없는 DB에 돌리면 `google.drive.repository.sql`이 정확히
**−21줄**(= 커밋이 더한 그 21줄)로 되돌아가고, 다른 8개 파일도 함께 변형된다. 커밋의
`21 insertions(+), 0 deletions(-)`와 완전히 일치한다.

추가된 두 블록도 리뷰가 지목한 그대로다:

```
:34-40   setDriveAccountId 의 select (a6729a3ec가 추가한 두 번째 문장)
:454-467 getErrorSummary 의 getBlockingError select
```

### (b) H1 수정이 랩탑 시나리오를 깨는가 — **깨지 않는다. 한 걸음씩 따라간 결과는 아래와 같다.**

전제: `google_drive_upload` 6,996행이 `driveAccountId = ''`, `user_google_drive` 1행이
`driveAccountId = NULL`(미식별), 사용자 1명.

| #   | 행동                               | 현재 코드가 하는 일                                                                                                                                                                        |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 이미지 배포                        | 아무 일도 없다. `''`은 미식별 연결과 매칭되므로 큐는 비어 있다(실 DB `has_upload = t`)                                                                                                     |
| 2   | 설정 화면을 연다 → `getStatus:592` | `credentials.driveAccountId === null` && `probeAllowed` → 참 → `getDriveAccountId`. **여기서 H1은 관여하지 않는다**                                                                        |
| 3   | 프로브 성공(`permissionId = A`)    | `adoptIfNewlyIdentified:454` → `setDriveAccountId(u, T1, 'A')`: update 1행, select `'A'` → `settled === 'A'` → `adoptUnstampedUploads(u,'A')` → 삭제 0행 + **update 6,996행**. 한 트랜잭션 |
| 4   | 게이트 쿼리                        | `drive_account = A`(불투명 숫자), `unstamped = 0`                                                                                                                                          |
| 5   | 이후 연결 해제                     | 드레인이 `:426`에서 **즉시 반환**(이제 식별됨). 하지만 **버킷이 이미 비었으므로 잃는 것이 없다**. 네트워크 호출 0                                                                          |
| 6   | 같은 계정 A 재연결                 | 원장 6,996행이 `'A'`, 새 연결도 `'A'` → 전부 매칭 → 재업로드 0                                                                                                                             |

**H1 수정이 무언가를 뺏는 경우가 있는가.** 3번이 실패하는 갈래에서만 성립한다:

- **3′ 프로브 실패** → `unstamped`는 6,996 유지, 연결은 미식별. 이 상태에서 연결 해제하면
  드레인이 **돈다**(미식별이므로). 프로브가 그때 성공하면 6,996행이 `'A'`가 되고 credentials가
  지워진다 → 이후 A 재연결 시 전부 매칭. 프로브가 또 실패하면 `''` 유지 → 여전히 매칭. **어느
  쪽이든 재업로드 0.**
- **3″ 식별 후에 새 `''` 행이 생기는 경우** — `uploadAsset:900-906`의 `settled !== driveAccountId`
  갈래에서만 나온다(재링크와 경합). 그 행들은 이제 **영원히 드레인되지 않는다.** 다만 `''`이라
  매칭은 계속되므로 재업로드는 없고, 손실은 "계정 전환 시 그 몇 건이 새 드라이브로 안 간다"뿐이다.

**결론: 랩탑의 6,996행 시나리오에서 H1 수정이 뺏는 것은 없다.** 직전 라운드의 판단("잃는 것이
없다")이 코드로 확인된다. 다만 **런북 `:414-415`가 5번 단계에서 거짓이 된다**(M2) — 운영자에게
"연결 해제 직전에 드레인이 넘겨준다"고 말하지만, 그 시점의 연결은 이미 식별되어 드레인이 돌지 않는다.
버킷이 비어 있으므로 결과는 같지만, **문장이 참인 이유가 문장이 말하는 이유와 다르다.**

`revoked` 자동 해제(`:1137`)에 드레인이 없는 것은 이제 **옳은 이유로 옳다**: 식별된 연결이면 드레인이
아무것도 안 하고, 미식별이면 권한이 이미 없어 프로브가 실패한다. 직전 라운드가 예측한 대로다.

### (c) 이전 라운드가 잡았어야 했던 것

**셋 있고, 하나는 내 잘못이다.**

1. **드레인 JSDoc `:406-409`의 "재업로드된다"** (M1). 직전 리뷰는 `:404-405`("always with the
   outgoing token")만 문제 삼고 바로 다음 문장은 읽지 않았다. 그 문장이 드레인의 **존재 이유**이고,
   그것이 틀렸기 때문에 첫 드레인이 저장된 id를 붙잡았다 — H1의 뿌리는 코드가 아니라 이 문장이었다.
2. **`connectedAt`이 재링크 때 갱신되지 않는다**(`repository.ts:83`의 `doUpdateSet`에 없다).
   직전 리뷰는 `uploadedAt >= connectedAt`을 fix로 권고하면서 이 사실을 확인하지 않았다.
   그대로 구현했다면 **재링크 사용자에게 조용히 무의미한 가드**가 됐을 것이다. 내 권고의 결함이다.
3. **`adoptIfNewlyIdentified`에 같은 결함이 있다는 것을 H1과 같은 무게로 적지 않았다.** 직전 리뷰는
   "H1 fix 2"의 잔여물로 언급했지만, 실제로는 **fix 1을 적용해도 남는 독립적인 Critical**이었다.
   fix를 순번으로 적으면 "1번만 하면 대충 된다"로 읽힌다 — 이번 커밋이 정확히 그렇게 읽었다.

---

## What I did not verify

- **운영(랩탑) DB.** 실제 6,996행·`connectedAt`·`driveAccountId` 값에 접근하지 않았다. 위 (b)의
  단계별 추적은 코드 독해 + 내 컨테이너의 동일 술어 실행이지, 랩탑에서 돌린 것이 아니다.
- **`about.get`이 `drive.file` 스코프에서 `permissionId`를 채우는지.** 여섯 라운드째 최대 미검증
  항목. C1의 실제 발생 빈도와 M1의 심각도가 여기에 달려 있다. 실 OAuth가 필요하다.
- **H1 findings의 실측.** 재시도 3회·토큰 갱신 무제한은 **라이브러리 소스를 읽어** 확정했고
  (`apirequest.js:263`, `retry.js:32-35`, `oauth2client.js:212-218,303-315`,
  `node-fetch/lib/index.js:1491-1496`), 실제로 구글을 30초 매달리게 해서 재보지는 않았다.
- **브라우저 확인.** 이 커밋에 web 변경이 없어(변경 파일 목록으로 확인) svelte-check 게이트도
  돌리지 않았다. 리포트의 증거 파일이 "3 pre-existing files, no regressions"라고 적은 것을 받았다.
- **`run.sh` 전체 실행.** 서버 유닛·웹 유닛·medium을 각각 직접 돌렸고 수치는 일치하지만, 스크립트
  자체는 돌리지 않았다. medium 전체 스위트도 이 기능 스펙 하나만 돌렸다(리포트가 말한 exif 3건
  실패는 재현하지 않았다 — `e2e/test-assets` 미초기화, 환경).
- **CI 로그 본문.** GitHub API로 run/jobs/annotations만 조회했다(3잡 success, 실패 애노테이션 0).
  `gh` CLI가 이 머신에 없어 잡 로그는 읽지 않았다.
- **C1의 5단계가 실제로 얼마나 자주 일어나는지.** 각 단계가 코드로 성립한다는 것과, 도달했을 때
  결과가 `has_upload = f`라는 것만 보였다. 랩탑처럼 계정이 하나뿐인 배포에서는 3단계(다른 계정
  연결)가 드물다.

---

## Feeding back into the plan

1. **"가드를 넣었다"와 "클래스를 닫았다"를 구분해서 적는다.** 이번 커밋은 전자를 후자처럼 적었고,
   그래서 `adoptIfNewlyIdentified`의 같은 결함이 두 라운드째 살아 있다. 리뷰의 fix를 번호로 적으면
   "1번만 해도 된다"로 읽힌다 — **닫히는 것 / 남는 것을 fix마다 명시**한다.
2. **어떤 함수의 안전성이 "누가 이 값을 만들었는가"에 의존하면, 그 출처를 타입이나 인자로 남긴다.**
   H1은 `credentials.driveAccountId ?? probe()`가 두 출처를 한 변수로 뭉갠 것이었고, C1은
   `''` 버킷이 **여러 연결의 행을 한 값으로 뭉갠 것**이다. 같은 병이 한 단계 아래에서 반복된다.
3. **시각 술어를 쓰기로 했다면 `connectedAt`을 재링크에서 갱신하는 한 줄이 선행 조건이다.**
   (`upsertCredentials`의 `doUpdateSet`) 이것 없이 술어만 넣으면 조용히 무력한 가드가 된다.
4. **테스트의 목이 두 갈래를 같은 값으로 만들면, 그 단언은 갈래를 구별하지 못한다.** `arrangeLink`의
   단일 `driveAboutGet` 목이 정확히 그 경우다. "이 테스트는 무엇을 바꾸면 실패하는가"를
   **주석이 아니라 변이로** 한 번 확인하는 습관이 이 라운드에서 두 번(H2, N2) 값을 했을 것이다.
5. **생성물 검증은 절차가 아니라 잡이어야 한다.** 세 라운드를 태운 뒤에도 포크 CI에는 SQL 스텝이
   없다. 러너에서 확인할 신호(`does not exist` 3 vs 366)는 찾았지만, 그것도 사람이 봐야 한다.
6. **문서 수정은 "무엇이 이제 거짓이 되었는가"를 한 번 훑는 것으로 끝낸다.** 직전 라운드 M3의
   5개 중 1개만 닫혔고 새로 1개가 열렸다(`unidentified` 컬럼). 코드 변경마다 `CLAUDE.md`의 해당
   문단을 통째로 다시 읽는 편이, 문장을 하나씩 고치는 것보다 빠르고 정확하다.
7. **증거 파일의 `commit:` 검사를 훅으로.** 다섯 번 중 네 번 틀렸다(N5). 사람이 기억하는 방식은
   이미 반증됐다.

---

**변경 파일 확인**: 리뷰 작성 직전 메인 저장소(`/home/gwyun/workspace/immich`, HEAD `e56776855`)에서
`git status --porcelain`을 실행했고 출력은 **비어 있었다**(작성 후에는 이 리뷰 파일 하나).
테스트·변이 실험·`nest build`·SQL 생성기·psql 실험은 전부 격리 워크트리
`/tmp/gd-review-57609`(detached `e56776855`)에서만 수행했고, 모든 변이는 백업본으로 되돌려
워크트리 `git status`가 깨끗함(심볼릭 링크한 `node_modules` 외)을 확인했다. 실험용 컨테이너
`gd-rev19-pg`도 정리한다.
