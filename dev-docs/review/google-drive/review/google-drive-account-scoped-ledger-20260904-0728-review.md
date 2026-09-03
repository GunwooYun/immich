# Code Review — 계정 스코프 원장(B1 재설계) + B7 + 메뉴 차단 표시

|                  |                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Branch / HEAD    | `feat/google-drive-album-sync-v3.1.0` / `7b45523e8`                                       |
| Commits reviewed | `cd727214b`(B7), `06666f0c9`(메뉴 차단 표시), `f82f49e9c`(B1 재설계)                      |
| Report           | `../report/google-drive-account-scoped-ledger-20260904-0728-report.md`                    |
| Prior review     | `google-drive-b1-account-reset-20260904-0900-review.md` (C1 → 이 커밋으로 대체)           |
| Reviewed         | 2026-09-04                                                                                |
| 작업 환경        | 격리 워크트리 `git worktree add --detach … 7b45523e8` (실험 전부 그 안에서, 종료 시 제거) |

## Verdict

**설계 방향은 옳다 — 직전 리뷰의 C1을 패치가 아니라 문제의 형태로 해결했고, 마이그레이션·PK·인덱스·
비공허성·B7까지 내가 직접 돌린 것은 전부 리포트대로였다. 그런데 이 설계의 유일한 안전장치인
"입양(adoption)"이 두 군데에서 새고 있고, 그중 하나는 리포트가 5번으로 물은 배포 절차 자체를
무효화한다.** 순서대로: (1) **입양을 수행한 바로 그 업로드 잡이 자기가 올린 파일을 `''`로 기록한다**
(`google-drive.service.ts:949`가 입양 이전에 읽은 `credentials.driveAccountId`를 그대로 쓴다). 그 행은
다음부터 영원히 매칭되지 않으므로 그 자산은 **한 번 더 업로드된다 = Drive에 중복 파일**이고, 동시에
`count(*) where "driveAccountId" = ''`가 **영원히 0이 되지 않아** 배포 절차의 게이트가 닫히지 않는다
(C1, 프로브 테스트로 재현). (2) **`CLAUDE.md:379`가 지시한 "설정 화면을 한 번 연다"는 입양을
트리거하지 않는다** — `/google-drive/storage`를 호출하는 곳은 웹 전체에서 앨범 페이지의 Drive 메뉴
하나뿐이고(`web/src/routes/(user)/albums/…/+page.svelte:376`), 사용자 설정 화면은 그 엔드포인트를
import조차 하지 않는다. 즉 운영자는 **입양이 돌지 않는 화면을 열고, 하필 그 화면에 있는 Disconnect
버튼을 누를 수 있는 상태로** 위험 구간이 열린 채 안전하다고 믿게 된다(C2). (3) 안전 속성의 실제
전제는 "연결 경로에서 입양하지 않는다"가 아니라 **"`''` 행이 지금 연결된 계정의 것이다"**인데,
코드가 검사하는 것은 `credentials.driveAccountId`가 비었는지뿐이다. 링크 시 신원 프로브가 null을
돌려주면(예외 또는 `user` 필드 부재) 새 계정이 이전 계정의 `''` 버킷을 상속하고, **그 다음 성공한
프로브가 남의 업로드를 이 계정으로 영구히 도장 찍는다**(C3). 이 두 반쪽은 커밋된 테스트 스위트
안에 이미 둘 다 들어 있다.

부수적으로, 리포트가 4번으로 "설명하지 못하겠다"고 한 `integrity.repository.sql` 변화는 `deleteUploads`
제거와 무관하다. 원인은 `getErrorSummary`의 `Promise.all`이 kysely의 로그 콜백과 경합하는 것이고,
**생성기는 결정적이지 않다** — 내 환경에서 3회 재생성한 결과는 커밋된 것과 다르고, `cd727214b`의
(올바른) 배치로 되돌아온다. 커밋된 산출물은 **두 파일 모두 틀렸다**(N2). B7과 메뉴 차단 표시는 둘 다
코드로 봐도 견고하다.

### Evidence I ran myself

| Check                                                                                     | Result                                                                                                   |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `dev-test/google-drive/run.sh --medium` (격리 워크트리, HEAD `7b45523e8`)                 | `245 / 39 / 20 passed`, svelte-check 게이트 `no regressions (3 pre-existing files)`, `RESULT: PASS`      |
| server unit 8스펙 개별 실행                                                               | `Test Files 8 passed / Tests 245 passed` — 리포트의 245 일치 (커밋 메시지의 `243`이 오히려 옛 값)        |
| web unit 4스펙                                                                            | `Tests 39 passed` — 일치                                                                                 |
| medium 1스펙 (testcontainer, 전 마이그레이션 적용)                                        | `Tests 20 passed`, `Migration "1787100000000-AddGoogleDriveUploadAccountId" succeeded`                   |
| **비공허 E1**: `currentAccountOf`→컬럼 자기 자신, `LEDGER_MATCHES_CURRENT_ACCOUNT`→`true` | `3 failed \| 17 passed` — 실패한 3개가 리포트가 지목한 바로 그 3개, 나머지 2개 통과 **정확히 일치**      |
| **비공허 E2 (B7)**: `getSubscribers`의 두 필터 제거                                       | `2 failed \| 18 passed` — soft-deleted / blocked 두 개만 실패, 리포트대로                                |
| **프로브 P1**: `uploadAsset`에서 입양이 성공한 경우의 `recordUpload` 인자                 | `adoptUnstampedUploads(userId,'account-x')`는 호출됨, `recordUpload(..., '')` — **C1 재현**              |
| **프로브 P2**: `getStorage`에서 `user.permissionId`가 오는 경우                           | 입양 호출·`fields: 'storageQuota,user(permissionId)'` 모두 확인 (커밋된 테스트에는 없음)                 |
| 스키마 드리프트: `sql-tools migrations generate` (전 마이그레이션 적용 DB 대상)           | **`No changes detected`** — 데코레이터 ↔ DB 완전 일치                                                    |
| DB introspection `\d google_drive_upload`                                                 | PK `("userId","assetId","driveAccountId")`, 인덱스 2개 유지, FK 2개 유지, 다른 테이블의 참조 없음        |
| 3컬럼 `onConflict` 의미 검증 (임시 테이블, 트랜잭션 후 ROLLBACK)                          | 같은 계정 재업로드 → **in place update**, 다른 계정 → 두 번째 행. 의도대로                               |
| SQL 재생성 3회 (`node dist/bin/sync-sql.js`)                                              | 3회 모두 동일하지만 **커밋된 것과 다름**: `integrity.repository.sql` 원복, 문제의 블록은 google.drive 쪽 |
| `npx tsc --noEmit` (server)                                                               | rc=0. `deleteUploads` 잔존 참조 0                                                                        |
| GitHub API run `33715025550` / `33758496224`                                              | 둘 다 `conclusion: success`, **모든 job의 모든 step이 success** — CI 승격 근거 사실                      |
| `git ls-remote origin`                                                                    | 원격 tip = `6bfd4708a`. 리뷰 대상 3커밋은 **미푸시·미CI**. 리포트가 밝힌 그대로                          |

---

## Findings

### C1 — 입양을 수행한 잡이 자기 업로드를 `''`로 기록한다. 중복 업로드 + 게이트 영구 미달 (Critical)

`uploadAsset`은 한 함수(`google-drive.service.ts:726`~)이고 `credentials`는 그 앞머리에서 한 번만
읽는다(`:736`). 입양 블록은 그 객체를 **DB에만** 반영한다:

```ts
// google-drive.service.ts:747-749
if (!credentials.driveAccountId) {
  await this.adoptIfNewlyIdentified(userId, credentials, await this.getDriveAccountId(credentials.refreshToken));
}
...
// google-drive.service.ts:949
await this.googleDriveRepository.recordUpload(userId, assetId, data.id, credentials.driveAccountId ?? '');
```

`adoptIfNewlyIdentified`는 `credentials` 객체를 갱신하지 않으므로 `:949`의 `credentials.driveAccountId`는
**여전히 null**이고 `''`가 기록된다. 격리 워크트리에서 프로브 테스트로 재현했다(위 P1):
`adoptUnstampedUploads(userId, 'account-x')`는 호출되는데 `recordUpload`의 4번째 인자는 `''`다.

결과는 세 가지다.

1. 게이트 2(`hasUpload`)는 이제 실제 계정 id와 비교한다. 그 `''` 행은 **다시는 매칭되지 않는다.**
   그 자산이 재큐잉되는 순간(앨범 재추가, 백필, queue-all) **한 번 더 업로드된다 = Drive에 중복 파일.**
   `files.create`에 멱등 마커가 없다는 것이 이 설계의 출발점이었는데, 그 설계 자체가 중복을 하나
   만든다.
2. 그 `''` 행은 **영구히 고아**다. 입양은 `credentials.driveAccountId`가 비어 있을 때만 도는데
   (`:400`) 이제 채워져 있다.
3. `CLAUDE.md:380`의 게이트 `select count(*) … where "driveAccountId" = ''`가 **영원히 0이 되지
   않는다.** 입양이 설정 화면보다 업로드 잡에서 먼저 돌면(운영에는 백로그가 있으므로 흔한 순서)
   운영자는 0을 기다리며 무한정 Disconnect를 막거나, 절차를 포기한다.

동시성 5이므로 입양 시점에 in-flight인 잡 수만큼 고아 행이 생긴다.

**Fix (작다)**: `adoptIfNewlyIdentified`가 확정된 계정 id를 반환하게 하고 그 값을 쓰거나, 입양 후
`credentials`를 다시 읽는다.

```ts
const accountId = credentials.driveAccountId ?? (await this.adoptIfNewlyIdentified(...)) ?? '';
...
await this.googleDriveRepository.recordUpload(userId, assetId, data.id, accountId);
```

그리고 이 경로에 테스트를 하나 붙인다 — 지금 스위트에는 **입양이 실제로 도는 케이스가 하나도 없다**(M1).

---

### C2 — 배포 절차가 지목한 화면은 입양을 트리거하지 않는다 (Critical, 문서·코드 주석 양쪽)

`CLAUDE.md:379`는 이렇게 적는다: _"배포 후 설정 화면을 한 번 연다 (storage 호출이 입양을
트리거한다)"_. 코드 주석도 같은 주장을 한다(`google-drive.service.ts:565`: _"the settings page is the
first thing opened after a deploy, which makes it the natural place to identify a connection"_).

**둘 다 사실이 아니다.** `/google-drive/storage`(`google-drive.controller.ts:242`)를 호출하는 웹 코드는
저장소 전체에서 한 군데뿐이다:

```
web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte:60,376
    getGoogleDriveStorage,        ← import
    getGoogleDriveStorage(),      ← loadGoogleDriveMenu() 안, 즉 "앨범 페이지의 Drive 메뉴를 열 때"
```

사용자 설정 화면 `web/src/routes/(user)/user-settings/GoogleDriveSettings.svelte`는 `getGoogleDriveStorage`
를 **import하지 않는다**(`:21-32`의 SDK import 목록에 없고, 파일 전체에 `storage` 문자열이 0회 등장한다).
그 화면이 부르는 것은 `getGoogleDriveStatus` / `getGoogleDriveAlbums` / 폴더·구독 관련 호출뿐이다.

그래서 절차대로 하면:

- 운영자가 설정 화면을 연다 → **입양은 돌지 않는다** → `''` 카운트는 6,996 그대로.
- 그 화면에는 **Disconnect 버튼이 있다**(`GoogleDriveSettings.svelte`의 연결됨 분기). 절차가
  "그 뒤에야 연결 해제"라고 말한 바로 그 위험한 버튼 옆에, 안전 조건이 충족되지 않은 채 서 있게 된다.
- 카운트가 0이 아니므로 운영자는 (a) 입양이 고장났다고 판단하거나 (b) 절차를 무시하고 진행한다.
  (b)를 고르면 6,996개 재업로드다(아래 "현재 운영 상태" 절).

**Fix**: 입양 훅을 `getStatus`로 옮기거나 추가한다. `getStatus`는 **설정 화면이 로드 시 반드시
부르는** 엔드포인트이고, 코드 주석이 이미 그렇게 적고 있다(`google-drive.service.ts:478-480`:
_"the settings page already asks this endpoint on load"_). `credentials.driveAccountId`가 비어 있을
때만 프로브가 돌므로 비용은 계정당 1회다. 그 다음 `CLAUDE.md:379`의 문장과 `:565`의 주석을 고친다.
(앨범 메뉴를 여는 것으로도 트리거된다는 사실은 남겨두면 좋다 — 지금 유일하게 동작하는 경로다.)

---

### C3 — 안전 속성의 전제가 코드에 표현돼 있지 않다: 신원 프로브가 실패한 링크는 남의 `''` 버킷을 상속하고, 나중에 도장까지 찍는다 (Critical, 조건부)

리포트 1번 질문에 대한 답의 핵심이다. **"입양이 `linkAccount`에서 호출되지 않는다"는 사실 자체는
검증했다** — 호출 지점은 `google-drive.service.ts:584`(getStorage)와 `:748`(uploadAsset) 둘뿐이고,
둘 다 **이미 연결된 토큰**으로 돈다. 부정 테스트도 실재하고 비공허하다
(`google-drive.service.spec.ts:1186-1197`, witness 포함).

문제는 그 속성이 **필요조건이지 충분조건이 아니라는 것**이다. 입양이 안전하려면 _"지금 연결된
토큰이 그 `''` 행들이 쓰였을 때의 토큰과 같은 계정"_ 이어야 한다. 코드가 검사하는 것은:

```ts
// google-drive.service.ts:400
if (credentials.driveAccountId || !driveAccountId) {
  return;
}
```

즉 **"이 연결의 계정 id가 아직 비어 있는가"** 뿐이다. 그 두 명제는 다음 순서에서 갈라진다.

1. 계정 A로 연결 → 업로드들이 `''`로 기록(연결이 미식별 상태거나 마이그레이션 이전 행).
2. Disconnect → `deleteCredentials`로 행 삭제.
3. **계정 B로 연결. 이때 `getDriveAccountId`가 null을 돌려준다.** `upsertCredentials(userId, token, null)`
   (`:372-373`). 예외는 catch돼 warn 한 줄이고(`:426-428`), `data.user`가 비면 **로그조차 없다**(`:425`).
4. 이제 B의 연결이 `''` 버킷을 읽는다 → **A에 올라간 라이브러리가 B에서 "이미 업로드됨"으로 읽힌다.
   B의 Drive는 영원히 빈다 = 원래 B1 버그 그대로.**
5. 나중에 프로브가 성공하는 순간(설정/앨범 메뉴/업로드 잡) `adoptIfNewlyIdentified`가 발동해
   **A의 6,996개 행에 B의 id를 영구히 찍는다.** 이후로는 입양도 다시 돌지 않으므로 **되돌릴 방법이
   수동 SQL밖에 없다.**

3단계가 가공의 상황이 아니라는 근거는 커밋된 스위트 자신이다.
`google-drive.service.spec.ts:1216-1225` **"should link successfully when Drive will not say which
account it is"** 가 정확히 그 상태를 정상 동작으로 못박고, 주석은 _"The user keeps reading and
writing the `''` bucket, which is the same place their existing rows live, so nothing re-uploads"_
라고 적는다 — **"nothing re-uploads"가 여기서는 위험의 이름이다.** 나머지 반쪽(그 상태에서 입양이
돈다)은 위 P2 프로브로 확인했다.

발생 조건은 "링크 시 프로브 null"이고 경로는 둘이다: 일시적 예외(네트워크, 5xx, rate limit —
`getDriveAccountId`의 catch는 전부 삼킨다), 그리고 **`drive.file` 스코프에서 `about.get`이 `user`를
채우지 않는 배포**. 후자는 직전 리뷰가 최대 미검증 항목으로 지목했고 **여전히 실기기 확인이
없다**. 만약 후자가 참이면 이 커밋 전체가 장식이 되고(모든 연결이 미식별 → 모든 계정 전환이 옛
버그 그대로), 그 사실을 알려주는 로그가 한 줄도 없다.

**Fix (구조적, 작다)**: 링크 시 프로브가 실패하면 NULL 대신 **그 연결에만 고유한 sentinel**을 쓴다
(예: `pending:<uuid>` 또는 `pending:<connectedAt>`). 그러면

- 새 연결은 **절대** 이전 계정의 `''` 버킷과 매칭되지 않는다 → 4단계 소멸(백로그가 스스로 재계산),
- 입양은 "`''` → 실제 id"가 아니라 "**이 연결의 sentinel** → 실제 id"가 되어 **정의상 안전**해진다.
  `''`(마이그레이션 이전 행)는 오직 _마이그레이션 시점에 이미 연결돼 있던_ 연결만 입양할 수 있게
  따로 다룬다 — 그 연결에 대해서만 "그 행들은 이 계정 것"이 참이기 때문이다.

이것을 하지 않겠다면 최소한 (a) `permissionId`가 null일 때 `warn`을 남기고(직전 리뷰 N5(a),
아직 미이행), (b) 입양 시 "몇 행을 어느 id로 찍었는지"를 로그에 남긴다. 지금 입양 로그(`:406`)는
행 수도 id도 적지 않아서, 사후에 **잘못 찍힌 입양과 올바른 입양을 구별할 수 없다.**

---

### N1 — 입양이 `upsertCredentials`를 재사용해 refresh token까지 되돌려 쓴다: 동시 재링크의 lost update (High)

```ts
// google-drive.service.ts:404
await this.googleDriveRepository.upsertCredentials(userId, credentials.refreshToken, driveAccountId);
```

`upsertCredentials`의 `doUpdateSet`은 `{ refreshToken, driveAccountId }` 둘 다 쓴다
(`google-drive.repository.ts:69-73`). 그런데 여기서 넘기는 `refreshToken`은 **입양이 시작되기 전에
읽은 값**이다. `getCredentials` → `about.get`(네트워크 왕복) 사이에 사용자가 재링크를 마치면,
느린 입양이 **방금 저장된 새 토큰과 새 계정 id를 옛 것으로 덮는다.** 사용자는 B에 연결했다고
믿는데 서버는 A의 토큰으로 A에 업로드한다. 조용하고, 다시 링크하기 전까지 영구적이다.
직전 리뷰 N2(일시 실패가 id를 null로 덮음)와 같은 뿌리이고, 그 지적은 이번에도 반영되지 않았다.

**Fix**: 입양 전용 조건부 업데이트를 하나 둔다. 토큰은 건드리지 않고, 프로브에 쓴 토큰이 아직
그대로일 때만 쓴다.

```sql
update "user_google_drive" set "driveAccountId" = $2
 where "userId" = $1 and "driveAccountId" is null and "refreshToken" = $3
```

영향 행이 0이면 원장 도장도 찍지 않는다(입양 전체를 취소). 이러면 C3의 5단계 창도 좁아진다.

---

### N2 — `integrity.repository.sql`이 바뀐 진짜 이유: `deleteUploads` 제거가 아니라 `Promise.all` 경합. 그리고 커밋된 산출물은 틀렸다 (Medium)

리포트 4번 질문. 생성기(`server/src/bin/sync-sql.ts`)는 메서드마다
`this.sqlLogger.clear()` → `await target.apply(...)` → 그동안 kysely `log` 콜백이 모은 쿼리를
`data.push`한다(`:128-176`). 창(window)은 **await가 끝나는 순간 닫힌다.**

`getErrorSummary`는 `Promise.all`로 **두 쿼리를 동시에** 던지고, 그중 하나는 `getBlockingError`다
(`google-drive.repository.ts`의 `getErrorSummary` 본문 — `this.getBlockingError(userId)`가 배열의
두 번째 원소). 두 번째 쿼리의 로그 이벤트가 `Promise.all` 해소보다 늦게 도착하면 그 쿼리는
**다음에 열린 창**에 기록된다. 다음 창이 무엇인지는 `repositories` 순회 순서에 따라
`IntegrityRepository.getById`가 된다 — 커밋된 파일이 정확히 그 모습이다.

증거:

- `cd727214b`의 `google.drive.repository.sql` **끝**에 그 블록이 (라벨 없이, 즉 `getErrorSummary`
  블록의 두 번째 쿼리로) 붙어 있고 `integrity.repository.sql`은 깨끗하다.
- `f82f49e9c`에서는 그 블록이 `integrity.repository.sql`의 `-- IntegrityRepository.getById` 아래로
  이동했다.
- **내 환경에서 재생성하면 `cd727214b`의 배치로 되돌아온다.** 3회 연속 동일했다. 즉 _"두 번 돌려도
  같으니 결정적"_ 은 성립하지 않는다 — 기계·부하에 따라 갈리는 경합이고, 같은 기계에서 두 번
  같았을 뿐이다.

**커밋된 산출물은 두 파일 모두 잘못됐다**: `integrity.repository.sql`은 자기 것이 아닌 쿼리를
`IntegrityRepository.getById`라고 이름 붙여 갖고 있고, `google.drive.repository.sql`은
`getErrorSummary`의 두 번째 쿼리를 잃었다. 참조 SQL의 존재 이유가 "코드와 대조"인데 지금은 둘 다
거짓말을 한다.

**Fix**: (a) 재생성해서 `integrity.repository.sql`을 원복한다(재발하면 그 파일만 되돌린다).
(b) 근본적으로는 `getErrorSummary`에서 `@GenerateSql`을 떼거나 두 쿼리를 순차로 await한다 —
생성기의 창 모델이 동시 쿼리를 표현하지 못한다는 사실을 코멘트로 남긴다.

---

### N3 — 배포 게이트 쿼리가 사용자 스코프가 아니고, "0이 안 되는 이유"가 셋인데 구별할 수단이 없다 (Medium)

`CLAUDE.md:380-382`의 게이트는 인스턴스 전체를 센다.

- **연결이 끊긴 사용자의 `''` 행은 절대 입양되지 않는다** — 입양에는 credentials 행이 필요하다.
  그런 행이 하나라도 있으면 게이트는 영구히 0이 아니다.
- C1의 고아 행도 마찬가지다.
- 프로브가 계속 null인 배포에서도 0이 아니다. 그런데 세 원인은 로그로 구별되지 않는다(C3의 Fix (a),(b) 참조).

**Fix**: 게이트를 "지금 연결된 사용자"로 좁힌다.

```sql
select count(*) from google_drive_upload u
 where u."driveAccountId" = ''
   and exists (select 1 from user_google_drive c where c."userId" = u."userId");
```

그리고 절차에 "0이 아니면 서버 로그에서 `Identified the Google Drive account for user …` 를 찾아라"
한 줄을 붙인다.

---

### N4 — "프로브는 한 번뿐"이 아니다: 식별에 실패하는 동안 **잡마다** Drive 왕복이 하나씩 붙는다 (Medium)

`google-drive.service.ts:745-749`의 주석은 _"Costs one probe, once, and only while the id is
unknown"_ 이라고 적지만, 조건은 `!credentials.driveAccountId`이고 프로브가 계속 null이면 그 조건은
계속 참이다. 7,000건 백로그면 **7,000번의 추가 `about.get`** 이고, Drive의 per-user rate limit을
건드리면 그 자체가 업로드 실패의 원인이 된다. C3의 "프로브가 구조적으로 null인 배포"에서
정확히 이 상태가 된다.

**Fix**: 실패를 기억한다(연결당 마지막 프로브 시각을 두고 backoff), 또는 프로브를 업로드 경로에서
빼고 `getStatus`/`getStorage`(사람이 여는 경로)에만 둔다. 후자가 C2의 Fix와 같은 방향이다.

---

### N5 — 입양이 실제로 도는 경로에 테스트가 하나도 없다 (Medium)

`adoptUnstampedUploads`에 대한 유닛 단언은 저장소 전체에서 **부정 하나**뿐이다
(`google-drive.service.spec.ts:1194`, `not.toHaveBeenCalled()`). 긍정은 없다. 이유도 명확하다.

- `getStorage` 테스트가 쓰는 `quota()` 헬퍼(`:78-88`)에 `user` 필드가 없어 `driveUser`는 항상
  undefined → 입양 분기에 **도달 자체가 불가능**하다.
- `arrangeReadyToUpload`(`:100-119`)는 `driveAboutGet`을 모킹하지 않으므로 프로브가 예외로 죽고
  null이 된다 → 역시 입양에 도달하지 않는다.
- `fields: 'storageQuota,user(permissionId)'`(`:569`)도 아무 데서도 단언되지 않는다. 누군가
  `fields`를 옛날 값으로 되돌려도 245개가 전부 초록이다.

medium 5개는 **입양된 뒤의 상태**(`adoptUnstampedUploads`를 직접 호출)와 비교 로직을 잘 지키지만,
"언제 입양이 발동하는가"는 아무도 지키지 않는다. 그 공백에 C1이 그대로 들어앉아 있었다 — 내가
프로브 두 개를 붙이자마자 하나는 즉시 빨간불이었다.

**Fix**: 위 P1/P2와 같은 테스트 2개. `quota()`에 `user`를 넣은 변형 하나와,
`arrangeReadyToUpload` + `driveAboutGet` 성공 하나. 후자는 C1의 회귀 테스트가 된다.

---

### N6 — 직전 리뷰 N1이 그대로다: `upsertCredentials`의 `@GenerateSql` 인자가 아직 2개 (Medium)

```
server/src/repositories/google-drive.repository.ts:68   @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
server/src/repositories/google-drive.repository.ts:69   upsertCredentials(userId, refreshToken, driveAccountId)
server/src/queries/google.drive.repository.sql:16-23    insert into "user_google_drive" ("userId", "refreshToken") …
```

체크인된 참조 SQL은 여전히 **2컬럼 insert**이고 `driveAccountId`가 없다. 직전 라운드에서는 사소한
불일치였지만, 이번 설계에서 그 컬럼은 **모든 것의 축**이다. 1줄 수정 + 재생성(N2와 같이 처리).

참고로 새 메서드 `adoptUnstampedUploads`에는 `@GenerateSql`이 아예 없다 —
트랜잭션이라 `recordUpload`와 같은 판단으로 보이며 타당하지만, 그렇다면 `recordUpload`처럼
"왜 없는지" 주석 한 줄을 붙이는 것이 이 파일의 관례다.

---

### N7 — 3컬럼 PK가 됐는데 그렇게 말하지 않는 주석이 둘 남았다 (Low)

- `google-drive.repository.ts:14`: _"one row per (userId, assetId) pair"_ — 이제 아니다.
- `google-drive.repository.ts:576-580`: _"The (userId, assetId) pair is the table's primary key …
  which is what makes this upsert possible"_ — 바로 아래 코드가 3컬럼 `onConflict`다.
- `google-drive.service.ts:752-756`(게이트 2 주석): _"it's a plain (userId, assetId) primary-key
  lookup — cheaper than the join below"_. 이제 `hasUpload`는 `user_google_drive`에 대한 상관
  서브쿼리를 하나 달고 있다(`google-drive.repository.ts:563`). 여전히 조인보다 싸지만 "plain
  primary-key lookup"은 아니다.

테이블 데코레이터 쪽은 정확하게 갱신됐다(`google-drive-upload.table.ts:19-28`). 이 포크는 주석을
1차 산출물로 다루고, 직전 리뷰 N6이 같은 종류의 지적이었다.

---

### N8 — 직전 리뷰 N6(뒤집힌 인과 주석)은 아직 미이행. 반대로 N7(4px)은 조용히 고쳐졌다 (Low)

- `context-menu-position.spec.ts:46-48`과 `context-menu-position.ts:8`의 잘못된 인과 설명이 그대로다.
- 한편 `f82f49e9c`는 앨범 페이지의 `offset={{ x: 175, y: 8 }}` → `y: 12`로 바꿨다
  (`web/src/routes/(user)/albums/…/+page.svelte:693`). 이는 직전 리뷰 N7이 계산한 정확한 값
  `(64-40)/2 = 12`이고 겹침을 산술적으로 0으로 만든다. **좋은 수정인데 커밋 메시지에도 리포트에도
  한 마디가 없고, 원장 커밋 안에 섞여 있다.** 다음 사람이 `git log -S` 없이는 못 찾는다.
  (브라우저 확인은 이번에도 없다.)

---

### N9 — 메뉴 차단 표시의 `else` 분기는 "폴더 없음"으로 단정한다 (nitpick)

`GoogleDriveAlbumMenu.svelte:229-232`는 `blockedReason === 'quota_exceeded' ? quota : folder`다.
현재 차단 클래스가 정확히 둘이라 맞지만(`GOOGLE_DRIVE_BLOCKING_ERROR_CLASSES`), 세 번째가 생기면
조용히 오라벨링된다. 코너 카드(`GoogleDriveProgressPanel.svelte:70-71`)가 이미 같은 모양이므로
새 결함은 아니고, 문구·i18n 키 재사용 판단은 옳다(`i18n/en.json:1214-1215`, 신규 키 0).

---

### N10 — 리포트가 인용한 증거 파일의 commit 값이 다르다 (nitpick)

리포트 상단 블록은 `commit: f82f49e9c`라고 적지만, 첨부된
`dev-test/google-drive/results/20260904-0720.txt`의 헤더는 `commit: 06666f0c9`다(즉 코드가 아직
워킹트리에 있던 상태에서 돌렸다). 숫자 자체는 내가 HEAD에서 전부 재현했으므로 실질적 문제는
없지만, 직전 라운드에서 같은 종류의 지적(`7128a36fc`)을 받고 고친 항목이다.

---

## Answers to what the report asked me to attack

### 1. 입양의 안전성 — 진입점은 새지 않는다. 새는 것은 전제다

`adoptIfNewlyIdentified` 호출 지점은 `google-drive.service.ts:584`(getStorage)와 `:748`(uploadAsset)
둘뿐이고, `adoptUnstampedUploads`의 호출 지점은 `:405` 하나뿐이다(grep로 전수 확인). 둘 다
**이미 연결된 토큰**(`credentials.refreshToken`)으로 돈다. `linkAccount`에는 입양이 없고, 부정
테스트도 비공허하다. **"링크 경로에서 다른 계정의 토큰으로 입양한다"는 경로는 없다** — 여기까지는
리포트가 맞다.

그러나 안전 속성을 정확히 쓰면 _"입양 시점의 토큰이, `''` 행들이 쓰였을 때의 계정과 같은 계정"_
이어야 하고, **코드는 그것을 검사하지 않는다**(C3). 링크 시 프로브가 null이면 새 계정이 옛 계정의
`''` 버킷을 상속하고, 그 뒤의 첫 성공 프로브가 남의 행에 도장을 찍는다. revoked 경로도 같다 —
`:980`의 `deleteCredentials`는 credentials만 지우고 원장은 남기므로(의도된 설계), 재연결이
미식별로 이루어지면 동일한 상태가 된다. 동시성은 이 축에서는 문제가 아니다(같은 id를 두 잡이
동시에 써도 멱등). 대신 **재링크와의 경합**이 문제이고 그건 N1이다.

### 2. `''` 버킷의 수명 — 사용자 간 오염은 불가능, 한 사용자 안에서는 시간축으로 발생 가능

먼저 안심할 것: 버킷은 **사용자 단위로 격리**된다. 원장의 PK 첫 컬럼이 `userId`이고 FK가 걸려
있으며(`\d google_drive_upload`로 확인), 모든 조회가 `userId`로 좁혀지므로 **서로 다른 Immich
사용자의 미식별 계정이 섞이는 일은 없다.**

발생 가능한 것은 **한 Immich 사용자의 시간축 위에서**다: "미식별 상태의 계정 A" → disconnect →
"미식별 상태의 계정 B". 도달 조건은 오직 하나, `getDriveAccountId`가 null을 돌려주는 것이다
(예외이거나 `user` 필드 부재). 발생하면 겉으로 드러나는 증상은 **아무것도 없다** — 새 Drive가
계속 비어 있을 뿐이고 UI는 "전부 동기화됨"이라고 말한다(원래 B1 버그의 증상 그대로). 그 상태를
관측할 수 있는 로그는 현재 0줄이다. 그리고 조용히 끝나지 않는다: 첫 성공 프로브가 그 상태를
**영구히 굳힌다.** C3의 sentinel 방식이 이 시나리오를 통째로 없앤다.

### 3. PK 변경의 부작용 — 이상 없다. 실기기 수준까지 확인했다

- **마이그레이션 ↔ 데코레이터**: 전 마이그레이션을 적용한 DB에 `sql-tools migrations generate`를
  돌려 **`No changes detected`**. 직전 라운드의 오프라인 diff보다 강한 증거다.
- **PK**: `google_drive_upload_pkey PRIMARY KEY, btree ("userId","assetId","driveAccountId")`.
  제약 이름도 맞다 — 원래 테이블이 인라인 `PRIMARY KEY (...)`로 만들어져 PG 기본 이름
  `google_drive_upload_pkey`가 붙는다(`1785423600001-CreateGoogleDriveUploadTable.ts:22`).
  운영 DB도 같은 마이그레이션으로 만들어졌으므로 `DROP CONSTRAINT`가 실패할 이유가 없다.
- **인덱스·FK**: `_userId_idx` / `_assetId_idx` 둘 다 유지, FK 2개 유지, **이 테이블을 참조하는
  외래키는 없다**(그래서 PK 재생성이 다른 제약을 깨지 않는다).
- **`recordUpload`의 3컬럼 `onConflict`**: 실제 Postgres에서 임시 테이블로 검증했다(트랜잭션 후
  ROLLBACK). 같은 (user, asset, **같은 계정**) 재업로드 → `driveFileId`가 **제자리 갱신**,
  다른 계정 → 두 번째 행. 의도대로다. 추론 대상 유니크 인덱스가 곧 PK이므로 애매함도 없다.
- 운영 규모(6,996행)에서 `ADD COLUMN NOT NULL DEFAULT ''`는 PG 11+ 메타데이터 연산이고 PK 재생성도
  7천 행 인덱스 빌드라 순간이다.
- `down()`의 중복 정리는 `uploadedAt` 비교라 **동률(같은 타임스탬프)이면 둘 다 남아 PK 생성이
  실패**한다. 실무상 일어나기 어렵고 down은 비상용이므로 nitpick으로 남긴다.

한 가지 부작용은 있다(결함은 아니다): `currentAccountOf`는 credentials 행이 없으면 `''`로 평가되므로,
**연결이 끊긴 사용자에 대해 `getSubscribableAlbums`/`getAlbumBackupStatus`의 `uploadedCount`가 0으로
보인다.** 다만 앨범 메뉴는 `!connected`일 때 "연결하기" 행만 그리므로(`GoogleDriveAlbumMenu.svelte:148-165`)
화면에 드러나지 않는다. 재연결 시 값이 돌아오므로 무해하다.

### 4. `integrity.repository.sql` — `deleteUploads` 제거 때문이 아니다. `Promise.all` 경합이다

N2 참조. 요약하면 생성기의 수집 창은 `await target.apply(...)`가 끝나면 닫히는데,
`getErrorSummary`가 `Promise.all`로 두 쿼리를 동시에 던지므로 늦게 도착한 로그가 **다음 창**으로
넘어간다. 다음 창이 `IntegrityRepository.getById`였을 뿐이다. **생성기는 결정적이지 않고**, 내
환경에서 3회 재생성한 결과는 커밋된 것과 다르며 `cd727214b`의 올바른 배치로 돌아온다.
**커밋된 산출물은 두 파일 모두 틀렸으니 재생성해서 고쳐야 한다.**

### 5. 배포 절차 — 지금 상태로는 위험 구간을 닫지 못한다

세 가지 이유로 닫히지 않는다.

1. **1단계가 동작하지 않는다**(C2). 설정 화면은 storage 엔드포인트를 부르지 않는다. 실제로
   입양을 트리거하는 것은 **앨범 페이지의 Drive 메뉴를 여는 것** 또는 업로드 잡 하나가 도는 것이다.
2. **2단계가 0에 도달하지 못할 수 있다**(C1, N3). 잡이 먼저 입양을 수행하면 그 잡의 `''` 행이
   영구히 남고, 연결이 끊긴 사용자의 옛 행도 영구히 남는다.
3. **절차는 기계가 아니라 사람의 약속이다.** 사용자는 언제든 설정 화면에서 Disconnect를 누를 수
   있고, 그 화면이 바로 1단계에서 열라고 지시한 화면이다.

**절차만으로 고칠 수 있는 부분**: 1단계를 "앨범 하나를 열고 Drive 메뉴를 한 번 연다"로 바꾸고,
2단계 쿼리를 연결된 사용자로 좁힌다(N3). **코드로 고쳐야 닫히는 부분**: 입양 훅을 `getStatus`로
옮기고(C2 Fix), `recordUpload`가 입양 결과를 쓰게 하고(C1 Fix), 링크 시 sentinel을 쓴다(C3 Fix).
셋을 하면 절차의 중요도 자체가 "권장"으로 내려간다 — 지금은 **절차가 유일한 방어선인데 그 1단계가
사실이 아니다.**

---

## 두 개의 작은 커밋에 대한 판단 (요청 항목)

### `cd727214b` (B7) — 코드로 봐도 견고하다

`getSubscribers`가 형제 쿼리 두 개(`streamPendingUploads`, `isAssetInSubscribedAlbum`)와 같은
필터를 갖게 됐고, 조건의 모양도 같다(`album.deletedAt is null` + blocking 클래스 `not exists`).
차단된 사용자를 빼도 복구 경로는 막히지 않는다 — 블록이 풀리면 `resumeUploads`가
`streamPendingUploads(userId)`로 pending 전체를 다시 큐잉하므로 **누락된 자산이 영구히 사라지지
않는다.** 비공허성도 리포트 주장 그대로 재현했다(필터 제거 → 정확히 그 2개만 실패).
CI 승격 근거도 사실이다: 두 run 모두 `conclusion: success`이고, **step 단위로 확인해도 실패한
step이 하나도 없다**(continue-on-error로 초록이 됐던 것이 아니다).

### `06666f0c9` (메뉴 차단 표시) — 방향·구현 모두 맞다

- 값을 진행률 매니저가 아니라 상태 엔드포인트에서 새로 읽는 판단이 옳고, `Promise.allSettled`에
  네 번째 호출로 얹어 실패가 나머지를 죽이지 않게 한 것도 기존 관례와 일치한다.
- 행은 `storageRowId`와 동일한 패턴(고유 id + `role="menuitem"` + 선택 핸들러 없음)이라
  `contextMenuNavigation` 관례를 깨지 않는다. 문구는 코너 카드와 **같은 i18n 키**를 쓴다
  (`i18n/en.json:1214-1215`) — 신규 키 0.
- 테스트 3개의 비공허성 주장도 구조상 타당하다: 부정 케이스가 `getByText('Drive storage')`를
  witness로 들고 있어 빈 렌더로는 통과할 수 없다.
- 남는 것은 N9(else 분기)뿐이고 nitpick이다.

## 현재 운영 상태(6,996행 / 연결된 사용자 1명, `driveAccountId` NULL)를 더 나쁘게 만드는가 — **그렇다, 두 경로에서**

_(운영 DB는 직접 보지 못했다. 아래는 주어진 상태를 사실로 두고 코드로만 따져본 것이다.)_

1. **입양 전에 "같은 계정으로" 재연결하면 라이브러리 전체가 중복된다.** 수정 전에는
   disconnect → 같은 계정 reconnect가 **무해**했다(원장이 계정을 몰랐으므로 전부 매칭). 수정 후
   `linkAccount`는 항상 실제 id를 기록하므로(`:372-373`), 6,996개의 `''` 행은 **한꺼번에 매칭에서
   빠지고** 전 라이브러리가 pending이 된다 → 같은 Drive에 **6,996개 중복 파일**, 되돌릴 수단 없음
   (`appProperties`는 아직 아무도 읽지 않는다). 그 6,996행은 영구 고아가 된다.
   이 경로는 `CLAUDE.md`가 인지하고 절차로 막으려 한 바로 그것인데, **절차의 1단계가 동작하지
   않으므로(C2) 실제로는 막혀 있지 않다.** 이 포크의 개발 과정에서 연결/해제를 반복해 왔다는 점을
   생각하면 확률도 낮지 않다.
2. **C1의 고아 행**: 입양을 수행한 잡이 올린 자산은 재큐잉 시 한 번 더 올라간다(중복 1개/잡).
   수정 전에는 존재하지 않던 경로다.

반대로 **버그를 그냥 두는 것보다 나빠지지 않는** 축도 분명히 있다: 배포 자체는 아무것도
재업로드하지 않는다(`''` ↔ `''` 매칭). 이 부분은 medium의 deploy-safety 테스트로 실제 DB에서
검증돼 있고, 나도 재현했다. **위험은 전적으로 "입양 이전에 연결을 건드리는가"에 달려 있다.**

권고 순서: **C1 → C2를 먼저 고치고 배포한다.** 그 둘이 고쳐지면 절차는 "설정 화면을 여는 것만으로
입양 → 카운트 0 → 안전"이라는, 원래 의도한 모양이 된다. C3는 그 다음 라운드에 sentinel로 처리해도
늦지 않다(운영에서 지금 당장 밟으려면 링크 시 프로브가 실패해야 한다).

## 테스트 주장 검증 (요청 항목)

전부 **직접 돌려서** 확인했고, 리포트의 숫자는 정확하다.

- `245 / 39 / 20` — `dev-test/google-drive/run.sh --medium`을 격리 워크트리(HEAD `7b45523e8`)에서
  실행해 `RESULT: PASS`, svelte-check 게이트도 `no regressions`. 개별 실행 결과도 같다.
  (커밋 메시지들이 적은 `243`은 옛 값이고, 실제로는 245다.)
- **비공허(계정 비교 무력화 → 정확히 3개 실패)** — `currentAccountOf`를 원장 컬럼 자기 자신으로,
  `LEDGER_MATCHES_CURRENT_ACCOUNT`를 `true`로 바꿔 비교를 항진명제로 만든 뒤 medium 20개 실행:
  `3 failed | 17 passed`. 실패한 것은 정확히 `should hide a row written for another account`,
  `should show it again after switching back`,
  `should move the pending count with the connected account` 셋이고,
  `pre-column rows … while the account is unidentified`와 `should adopt … without colliding` 둘은
  통과했다. **리포트의 주장과 완전히 일치하고, 그 두 개가 통과하는 것이 옳다는 설명도 맞다.**
- **B7의 "되돌리면 2개만 실패"** — 필터 두 개를 제거하고 medium 실행: `2 failed | 18 passed`,
  실패한 것이 정확히 soft-deleted / blocked 두 개.

다만 통과 개수가 곧 커버리지는 아니라는 것이 N5의 요지다. 이 스위트는 **"입양이 발동한 뒤의
상태"** 를 잘 지키지만 **"언제 발동하는가"** 는 지키지 않고, 내가 그 자리에 테스트 두 개를 넣자
하나가 즉시 실패했다(C1).

## What I did not verify

- **운영 DB의 실제 상태와 마이그레이션.** 6,996행·`driveAccountId` NULL은 요청서에 적힌 값을
  사실로 받아들였고, 랩탑에 접속하지 않았다. 마이그레이션은 **testcontainer의 신선한 DB**에서만
  적용을 확인했다(운영에는 데이터가 있는 상태에서의 PK 재생성이 남아 있다 — 다만 7천 행 규모라
  실질적 위험은 없다고 본다).
- **`about.get`이 `drive.file` 스코프에서 `user.permissionId`를 실제로 채우는지.** 직전 리뷰가
  최대 미검증 항목으로 지목했고 **여전히 미검증이다.** C3의 심각도와 이 커밋 전체의 실효성이
  여기에 달려 있는데, 실기기 1회 확인이 아직 없다. 이번에도 나는 확인할 수 없었다(실 OAuth 자격
  증명 필요).
- **브라우저 렌더.** `offset y: 12`가 겹침을 실제로 0으로 만드는지는 직전 리뷰의 산술을 근거로
  했을 뿐 픽셀을 재지 않았다. 메뉴 차단 행의 시각적 확인도 하지 않았다.
- **`eslint` / `prettier`.** run.sh가 돌리는 범위(vitest + svelte-check 게이트)만 돌렸고, 포맷·린트는
  별도로 확인하지 않았다.
- **이 세 커밋의 CI.** 미푸시라 존재하지 않는다(원격 tip = `6bfd4708a`). 내가 검증한 두 run은
  B7이 승격 근거로 든 옛 run들이다.
- **SQL 생성기의 경합을 다른 기계에서 재현하는 것.** 내 환경에서 3회 동일했고 커밋된 것과 달랐다는
  사실까지만 확인했다. 어느 쪽이 "정상"인지는 기계에 따라 다를 수 있다 — 그것이 N2의 요지다.

## Feeding back into the plan

1. **"입양"은 두 가지 다른 명제를 하나로 묶고 있다.** ①"이 연결의 계정 id를 아직 모른다"와
   ②"이 `''` 행들은 이 계정 것이다"는 다르다. 플랜에 이 문장을 그대로 남기고, sentinel(연결마다
   고유한 미상 값)로 ②를 **구조적으로 참으로 만드는** 안을 다음 라운드 첫 후보로 적는다(C3).
2. **"어느 화면이 어느 엔드포인트를 부르는가"를 문서화한다.** 이번 라운드의 배포 절차가 틀린
   이유는 그 매핑이 어디에도 없어서다. 최소한 `getStatus`(설정 화면 로드), `getStorage`(앨범 Drive
   메뉴), `getMyStatus`(코너 카드·앨범 메뉴) 세 줄이면 된다.
3. **"부정 테스트만 있는 기능"은 미완성으로 센다.** 입양은 부정 단언 하나로만 보호돼 있었고,
   긍정 경로에 결함이 있었다(C1/N5). 리뷰 체크리스트에 "이 기능이 **발동하는** 테스트가 있는가"를
   넣는다.
4. **생성물(`src/queries/*.sql`)은 경합에 취약하다.** `Promise.all`을 쓰는 `@GenerateSql` 메서드는
   쿼리가 이웃 파일로 새어 나갈 수 있다(N2). "동시 쿼리를 던지는 메서드에는 `@GenerateSql`을 달지
   않는다"를 규칙으로 적고, 재생성 후 **diff가 이 기능과 무관한 파일을 건드리면 그것은 신호**라고
   남긴다.
5. **직전 리뷰의 N1·N2·N6이 이번에도 미이행이다.** 리뷰 지적을 닫을 때 "어디에 반영했는가"를
   파일:줄로 적는 관례(직전 플랜 6번)가 아직 정착하지 않았다. 반대로 N7(4px)은 반영됐는데 아무
   기록이 없다 — 양방향으로 같은 문제다.
6. **관측 가능성 없이 배포 절차를 쓰지 않는다.** 지금 `''` 카운트가 0이 아닐 때 원인이 셋인데
   구별할 로그가 없다(N3). 절차에 검사 항목을 넣을 때는 "실패했을 때 어디를 보는가"를 같이 적는다.

---

**변경 파일 확인**: 리뷰 작성 직전 메인 저장소에서 `git status --porcelain`을 실행해
`?? dev-docs/review/google-drive/review/google-drive-account-scoped-ledger-20260904-0728-review.md`
(이 파일)와 세션 시작 시점부터 있던 `?? claude-general.md`,
`?? dev-docs/review/google-drive/review/google-drive-wave6-fixes-20260902-0750-review.md` 외에
**내가 만든 변경은 없다**. 모든 변이 실험·SQL 재생성·빌드는 격리 워크트리
(`git worktree add --detach … 7b45523e8`)에서만 수행했고, 종료 시 `git worktree remove`로 제거했다.
