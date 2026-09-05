# Code Review — 입양 DELETE 절반의 가드(M1) · 두 번째 취소 경로(M2) · 증거 신뢰성

| | |
|---|---|
| Branch / HEAD | `feat/google-drive-album-sync-v3.1.0` / `14b54fb87` (detached) |
| Commits reviewed | `e6776d147`, `0ef8eee01`, `7004bf8b0` (`f64586ef2..14b54fb87`) |
| Report | `../report/google-drive-wave6-round23-adoption-delete-20260905-1035-report.md` |
| Prior review | `google-drive-wave6-round22-connection-identity-20260905-1010-review.md` (같은 리뷰어) |
| Reviewed | 2026-09-05 |
| 작업 환경 | 격리 워크트리 `/home/gwyun/workspace/immich-review`(detached `14b54fb87`). 변이·SQL 프로브(컨테이너 `immich_postgres` 안의 일회용 DB `gdrive_probe`, 검증 후 `drop database`)는 전부 그 안에서만. 작성자 트리 `/home/gwyun/workspace/immich`는 읽지도 쓰지도 않았다 |

## Verdict

**round-22가 낸 세 지적(M1·M2·N3)은 전부 의도한 이유로 닫혔다. 줄 번호로 변이해 하나씩
확인했다.** `repository.ts:189`를 지우면 이제 정확히 새 테스트 하나가 깨지고(40 passed / 1 failed),
`service.ts:754`는 `if (true)`·`if (false)` **양방향** 모두 서로 다른 테스트를 깨뜨리며,
`repository.ts:94`의 재발급을 지우면 값 비교 테스트에 더해 새 행동 테스트까지 2개가 깨진다.
증거 스탬프의 pathspec은 여기 git 2.43.0에서 의도대로 동작한다 — results 안의 미추적 파일에는
조용하고, 소스 한 줄만 건드리면 `+ UNCOMMITTED CHANGES`가 붙는다(둘 다 실행해서 확인).
리포트가 인용한 CI 런은 실재한다: `head_sha = 7004bf8b0`, 4잡 전부 `success`,
`Check the migrations actually landed` 스텝도 `success`(GitHub API로 확인). 이 세 커밋에
**프로덕션 코드 변경은 한 줄도 없다** — `git diff f64586ef2..14b54fb87 -- server/src ':!*.spec.ts'`에서
주석이 아닌 줄은 0개다.

**가장 중요한 문제는, 이번에 막은 것과 정확히 같은 모양의 구멍이 같은 문장 안에 하나 더
남아 있다는 것이다(M1).** DELETE의 신원 조건(`:189`)은 이제 지켜지지만, **바로 아래
EXISTS의 계정 일치(`:196`)는 아무도 지키지 않는다.** `.where('stamped.driveAccountId', '=',
driveAccountId)`를 `.where('stamped.driveAccountId', '!=', '')`로 **넓히면 medium 41개가 전부
통과한다.** 그 변이가 만드는 손해는 round-22가 M1으로 잡았던 것과 같은 종류다 — 이미 *다른*
계정 아래 행이 있는 자산의 `''` 행이 삭제되고, `ledgerMatches`(`repository.ts:44-45`)는 `''`와
현재 계정만 매칭하므로 `hasUpload`가 false가 되어 되돌릴 수 없는 중복이 난다. 픽스처가 한 가지
모양만 고정한다는 리포트의 자기 진단은 맞았고, 남은 모양은 "세 연결"이 아니라 **"다른 계정 아래
이미 도장된 행"**이었다.

두 번째는 잠재된 것이다(M2). `adoptUnstampedUploads`에 `driveAccountId = ''`가 들어오면 EXISTS가
**자기 자신을 매칭**해서 그 연결의 미상 행 **전부**를 지운다. 실 SQL로 재현했다(3행 중 2행 삭제).
지금은 호출자 4곳이 전부 `if (!driveAccountId)`로 막고 있어 도달하지 않지만, 리포지토리 자체에는
가드가 없고 `''`는 이 도메인에서 "미상 버킷"이라는 **정상값**이라 다음 호출자가 넘기기 쉽다.

세 번째는 CI 확인이다(N2). 새 비교는 전제 자체는 오늘 이 저장소에서 참이지만(디스크 98 `.ts`,
`dist` 98 `.js`, 개발 DB 95 — 3개 뒤처짐을 이름까지 정확히 집어냄), **CI에서는 거의 공허하다.**
러너는 매번 새로 체크아웃해 `dist`를 새로 만들고 DB도 새것이므로, 앞 스텝(`migrations:run`)이
성공했다면 두 숫자는 구조적으로 같다. 정작 이 확인이 겨냥한 상황(로컬 stale `dist`, 오래 산 DB)에서는
**개수 비교가 가장 약한 형태**다 — 업스트림이 마이그레이션을 지우고(`0975b1599`) 이름을 바꾼(`84c75d95c`,
`b9e0e65bd`, `adb6b39ee`, `f194a7ea3`, `34f0f6c81`) 이력이 실제로 있고, 그 DB에서는 `applied > expected`가 된다.

배포 판정은 **바뀌지 않는다.** 아래 §7에서 근거를 적었다.

### Evidence I ran myself

| Check | Result |
|---|---|
| `npx vitest run --config test/vitest.config.mjs` × run.sh의 서버 8개 스펙 | **264 passed (8 files)** — 증거 파일과 일치 |
| 같은 명령, `google-drive.service.spec.ts` 단독 | **83 passed** (리포트의 "82 → 83" 일치) |
| medium `google-drive.repository.spec.ts` (실 Postgres) | **41 passed** — 증거 파일과 일치 |
| 변이 `repository.ts:189` 삭제(DELETE 신원 조건) | **1 failed / 40 passed** — 깨지는 것은 새 충돌 테스트 하나뿐 ✅ |
| 변이 `repository.ts:206` 삭제(UPDATE 신원 조건, HEAD 기준) | **5 failed / 36 passed** (리포트의 "3개"는 부모 트리 기준) |
| 변이 `repository.ts:196` → `'=', 'no-such-account'`(EXISTS를 좁힘) | **1 failed** — DELETE가 실제로 PK 충돌을 막고 있음이 고정돼 있다 ✅ |
| 변이 `repository.ts:196` → `'!=', ''`(EXISTS를 **넓힘**) | **41/41 통과 — 구멍** ❌ (M1) |
| 변이 `repository.ts:187` 삭제(DELETE의 `userId`) | **41/41 통과 — 구멍** ❌ (N1) |
| 변이 `repository.ts:204` 삭제(UPDATE의 `userId`) | **1 failed** — 이쪽은 지켜진다 |
| 변이 `service.ts:754` → `if (true)` | **1 failed**: `getStorage > should leave the connection alone when Drive fails for another reason` ✅ (M2) |
| 변이 `service.ts:754` → `if (false)` | **1 failed**: `getStorage > should report a revoked grant as disconnected…` ✅ (양방향) |
| 변이 `repository.ts:94` 삭제(`connectionId` 재발급) | **2 failed**: `should stop claiming its own rows once it has been re-linked` + `should mint a new connection identity on a re-link` ✅ (N3) |
| SQL 프로브 — 같은 자산에 `''` 행 2개(다른 `connectionId`) 삽입 | `duplicate key value violates unique constraint "google_drive_upload_pkey"` — **구조적으로 불가능** |
| SQL 프로브 — 3연결 + 다른 계정 + 다른 사용자 8행 픽스처에 DELETE→UPDATE | 남은 7행이 전부 기대대로. 지운 것은 현재 연결의 중복 `''` 1행뿐 |
| SQL 프로브 — `driveAccountId = ''`로 같은 DELETE | **`DELETE 2` (3행 중 2행 소실)**, `UPDATE 0` ❌ (M2) |
| `git status --porcelain -- ':!dev-test/google-drive/results'` (git 2.43.0) | results 안 미추적/수정 → **조용**, 바깥 미추적/소스 수정 → **`+ UNCOMMITTED CHANGES`** ✅ |
| GitHub API `actions/runs/33936330431` | `head_sha=7004bf8b05…`, `conclusion=success`, 4잡 전부 success, `Check the migrations actually landed` success |
| 마이그레이션 개수 | 디스크 `.ts` **98**, `server/dist/schema/migrations/*.js` **98**, 개발 DB `kysely_migrations` **95** (`comm`으로 뒤처진 3개 이름 확인) |
| `alter table … add "connectionId" uuid not null default uuid_generate_v4()` | 3행 → **distinct 3** (행마다 다른 uuid — 런북의 전제 성립) |
| `npx tsc --noEmit -p tsconfig.json` (server) | exit 0 (단, `dist/tsconfig.tsbuildinfo` 증분 캐시가 있는 상태) |
| `git diff f64586ef2..14b54fb87 -- server/src ':!*.spec.ts'` 중 비주석 줄 | **0줄** — 프로덕션 코드 변경 없음 |

---

## Findings

### M1 (Medium) — EXISTS의 계정 일치(`repository.ts:196`)를 아무도 지키지 않는다

리포트가 "이 픽스처는 충돌 한 가지 모양만 고정한다"고 물었다. 남은 모양은 **세 연결이 아니라
계정이 두 개일 때**다.

```ts
// server/src/repositories/google-drive.repository.ts:190-198
.where(({ exists, selectFrom }) =>
  exists(
    selectFrom('google_drive_upload as stamped')
      .select(sql`1`.as('one'))
      .whereRef('stamped.userId', '=', 'google_drive_upload.userId')
      .whereRef('stamped.assetId', '=', 'google_drive_upload.assetId')
      .where('stamped.driveAccountId', '=', driveAccountId),   // ← 196: 아무도 안 지킨다
  ),
)
```

`:196`을 **넓히는** 방향으로 변이했다(`'=' driveAccountId` → `'!=' ''`, 즉 "도장된 행이 하나라도
있으면"). 이건 조건을 지우는 것과 다르다 — 지우면 EXISTS가 항상 참이 되어 눈에 띄지만, 이 변이는
"이미 어딘가에 올라간 자산"이라는 그럴듯한 오독이고 **medium 41개가 전부 통과한다.**

손해는 round-22 M1과 같은 등급이다. 자산 Z에 `('acct-c', C_old)`와 현재 연결의 `('', C_cur)`가
함께 있을 때, 변이된 코드는 Z의 `''` 행을 **삭제**한다(원래는 `acct-b`로 도장해야 한다).
`ledgerMatches`는 현재 계정과 `''`만 매칭하므로(`repository.ts:44-45`) `hasUpload(user, Z)`는
false가 되고, `files.create`에 멱등성이 없으니 `acct-b`에 되돌릴 수 없는 중복이 생긴다 —
그 파일은 이미 `acct-b`에 있었는데도.

지금 코드는 **옳다.** 실 SQL로 8행 픽스처(U1/U2 × 3연결 × acct-b/acct-c)를 만들어 DELETE→UPDATE를
그대로 돌렸고, 자산 a3(`('', C_cur)` + `('acct-c', C_3)`)은 삭제되지 않고 `acct-b`로 도장돼
두 행이 공존했다. 틀린 것은 **그 성질을 증명한다고 말하는 범위**다.

**고칠 것** — medium 테스트 하나. 기존 `should adopt pre-column rows without colliding with rows
already stamped`(`spec.ts:711`) 픽스처에 자산 하나를 더하면 끝난다:

```ts
const { asset: otherAccount } = await ctx.newAsset({ ownerId: user.id });
await ledger(ctx, user.id, otherAccount.id, '', CONNECTION_A);
await ledger(ctx, user.id, otherAccount.id, 'account-other');   // 목표 계정이 아닌 계정
// 기대: ('', C_A) → 'account-x' 로 도장되고, 'account-other' 행은 그대로 (2행)
```

이 테스트가 있으면 위 변이는 실패한다. `connect(ctx, …)`의 기본 `connectionId`가 `CONNECTION_A`
이므로 픽스처를 그대로 확장할 수 있다.

### M2 (Medium, 잠재) — `driveAccountId = ''`로 부르면 그 연결의 미상 행이 전부 사라진다

`adoptUnstampedUploads(userId, refreshToken, driveAccountId)`(`repository.ts:151`)에는 인자
검증이 없다. `driveAccountId`가 `''`이면 EXISTS의 `stamped.driveAccountId = ''`가 **삭제 대상 행
자신**을 매칭하므로 EXISTS는 항상 참이고, DELETE는 그 연결의 `''` 행을 **전부** 지운다.
이어지는 UPDATE는 `''` → `''`이라 아무것도 되돌리지 못한다.

일회용 DB에서 그대로 재현했다 — `('', C_cur)` 2행 + `('', C_other)` 1행에 대해:

```
DELETE 2
UPDATE 0
 asset | driveAccountId | conn
-------+----------------+------
 a3    |                | a      ← C_other의 행만 남음
```

이 기능이 가장 두려워하는 결과(원장 소실 → 라이브러리 재업로드)를 한 번에 만든다.

**지금은 도달하지 않는다.** 호출자는 네 곳이고 전부 앞에서 막는다:
`drainUnstampedUploads`(`service.ts:455`, `if (!driveAccountId) return`),
`adoptIfNewlyIdentified`(`service.ts:486`, 같은 가드)를 거치는 세 곳(`:635`, `:763`, `:936`).
`getDriveAccountId`도 `''`을 그대로 돌려줄 수 있지만(`data.user?.permissionId ?? null`은 `''`을
통과시킨다, `service.ts:556`) 그 가드가 받는다.

그래서 **버그가 아니라 함정**이다. 그리고 이 도메인에서 `''`은 "미상 버킷"이라는 정상값이라
(테이블 주석이 그렇게 설명한다) 다음 호출자가 무심코 넘기기 딱 좋다.

**고칠 것** — 리포지토리 입구 한 줄, 그리고 그 줄을 지키는 medium 테스트 하나:

```ts
async adoptUnstampedUploads(userId: string, refreshToken: string, driveAccountId: string): Promise<boolean> {
  // '' is the unidentified bucket itself. Adopting *into* it would make the EXISTS below match the
  // very row it is deleting, wiping the connection's whole ledger — the one loss this design exists
  // to prevent. Callers already refuse to probe-fail into here; this is the belt.
  if (!driveAccountId) {
    return false;
  }
  ...
```

### N1 (Nit) — DELETE의 `userId` 조건(`:187`)은 테스트가 없다

`:187`을 지우면 41/41이 통과한다. 같은 조건이 UPDATE 쪽(`:204`)에서는 지켜진다 — 지우면
`should adopt pre-column rows without colliding with rows already stamped`가 실패한다. 이번 라운드가
고친 것과 **문자 그대로 같은 비대칭이 한 칸 옆에 하나 더 있다.**

실제 악용 경로는 사실상 없다. 다른 사용자의 행이 삭제되려면 `connectionId`가 같아야 하는데
그건 행마다 다른 uuid이고(`alter table … default uuid_generate_v4()`가 행마다 평가되는 것을
확인했다: 3행 → distinct 3), 컬럼 이전 행은 null이라 `null = uuid`로 걸리지 않는다. 그래서
Nit이다. 다만 M1 픽스처를 만들 때 다른 사용자 행 하나를 **같은 `connectionId`로** 끼워 넣으면
공짜로 함께 닫힌다(내 SQL 프로브의 `(U2, a4, '', C_cur)` 행이 그 모양이고, 현재 코드는 그것을
건드리지 않는다).

### N2 (Nit) — CI 마이그레이션 확인은 CI에서 거의 공허하고, 겨냥한 상황에서는 개수 비교가 가장 약하다

리포트가 물은 대로 전제를 시험했다. 결과를 나눠 적는다.

**(a) 전제는 오늘 참이다.** `migrations:run`은 `sql-tools`의 기본 폴더 `dist/schema/migrations`를
읽는다(`server/node_modules/@immich/sql-tools/dist/cli.js:22`). 디스크의 `.ts` 98개, `dist`의
`.js` 98개(같은 디렉토리에 `.d.ts`·`.js.map`도 98개씩 있지만 kysely의 `FileMigrationProvider`가
거르므로 개수에 들어오지 않는다), 개발 DB의 `kysely_migrations` 95행. `comm`으로 이름을 맞춰 보면
뒤처진 3개는 정확히 `1787000000000-AddGoogleDriveAccountId`,
`1787100000000-AddGoogleDriveUploadAccountId`, `1787200000000-AddGoogleDriveConnectionId`다.
`migration_overrides`는 함수·트리거 정의를 담는 **별도 테이블**이라(`1751924596408-AddOverrides.ts`)
`kysely_migrations` 행 수에 개입하지 않는다.

**(b) 그런데 CI에서는 이 비교가 거의 아무것도 말하지 않는다.** 러너는 매번 새로 체크아웃하므로
`dist`가 `src`에서 방금 만들어지고(`nest build`), Postgres도 `docker run`으로 방금 뜬 빈 DB다.
`migrateToLatest`는 실패를 **던지므로** 앞 스텝 `Apply migrations`가 먼저 빨개진다. 즉 앞 스텝이
초록인 한 두 숫자는 구조적으로 같다. 주석이 근거로 든 상황("리뷰어가 stale `dist`로 겪었다")은
**로컬**에서만 생긴다 — `nest build`가 낡은 산출물을 지우지 않기 때문이고, 그건 `CLAUDE.md` §4에
이미 적혀 있는 지뢰다.

**(c) 그리고 그 로컬 상황에서는 개수 비교가 가장 약한 형태다.** 업스트림은 마이그레이션을
지운 적이 있고(`0975b1599 fix: remove stray migration`, `1773175313374-Test.ts` 삭제),
순서를 고치려고 **이름을 바꾼 적은 여러 번**이다(`84c75d95c`, `b9e0e65bd`, `adb6b39ee`,
`f194a7ea3`, `34f0f6c81` — 전부 `R100`). 오래 산 DB에는 옛 이름 행이 남고 새 이름이 다시 적용되므로
`applied > expected`가 되어 **최신인 DB에서 실패한다.** 반대로 "하나 지워지고 하나 추가된" 트리에서는
개수가 같아 **틀린 DB에서 통과한다.** 덤으로 메시지는 그때 `the database is -1 migration(s) behind`를
찍는다.

**고칠 것** — 개수 대신 이름 집합을 비교한다. 길이도 비슷하고, 실패했을 때 *어느* 마이그레이션인지
말해 준다:

```bash
diff <(ls server/src/schema/migrations/*.ts | xargs -n1 basename | sed 's/\.ts$//' | sort) \
     <(docker exec immich-postgres psql -U postgres -d immich -tAc \
         'select name from kysely_migrations order by 1') \
  || { echo "::error::applied migrations do not match the tree (see the diff above)"; exit 1; }
```

이건 CI에서도 공허하지 않다(이름이 다르면 잡는다) 그리고 로컬에서 그대로 붙여 쓸 수 있다.

### N3 (Nit) — 리포트 §1의 숫자가 어느 트리 기준인지 밝히지 않았다

리포트는 "`repository.ts:189`를 지우면 **41/41 통과**"라고 적었다. 41은 **테스트를 넣은 뒤의**
개수이고, 그 트리에서 `:189`를 지우면 내가 측정한 대로 **40 passed / 1 failed**다. 재현이 이뤄진
트리(부모 `f64586ef2`)의 테스트 수는 39개이고(`git show f64586ef2:…spec.ts | grep -c 'it('` → 39),
커밋 메시지는 정확히 "removing line 189 left 39/39 green"이라고 적혀 있다. 같은 문단의
"UPDATE 쪽(`:206`)에서 지우면 3개가 실패한다"도 부모 기준이고, HEAD에서는 **5개**가 실패한다.

내용은 맞고 결론도 맞다. 다만 리뷰어가 그대로 재현하려면 숫자가 어느 커밋 기준인지가 있어야 한다.
**고칠 것**: 리포트에 "(부모 `f64586ef2` 기준)"을 붙인다. 코드 수정 없음.

### N4 (Nit) — dirty marker는 헤더를 쓰는 **순간**만 본다

`run.sh:118-121`은 결과 파일 헤더를 만들 때 한 번 `git status`를 본다. 스위트가 도는 동안(서버 +
web + svelte-check + medium, 몇 분) 소스를 고치면 헤더는 여전히 깨끗하다고 말한다. 그리고
제외 pathspec이 `dev-test/google-drive/results` **전체**라, 과거 증거 파일을 손으로 고쳐도 조용하다.

둘 다 이번 라운드가 잡으려던 실패(미커밋 상태로 돌린 실행)보다 훨씬 좁고, 고치는 값이 고치는
비용보다 크다고 보기 어렵다. **권고는 "그대로 두되 알고 있기"** — 굳이 좁힌다면 스탬프를 마지막에
한 번 더 찍어 두 값이 다르면 표시하는 정도다.

### N5 (Nit) — DELETE와 UPDATE 사이에 새 `''` 행이 커밋되면 트랜잭션이 굴러떨어진다

입양 트랜잭션은 `user_google_drive` 행에 `forUpdate()`를 걸지만(`repository.ts:161-167`),
`recordUpload`는 그 락을 잡지 않는다. 그래서 "DELETE가 끝난 뒤 ~ UPDATE가 시작하기 전"에
`('', C_cur)` 행이 커밋되고 그 자산에 이미 `(acct-b)` 행이 있으면, UPDATE가 PK 위반으로 죽고
`adoptUnstampedUploads`가 던진다. 호출자 중 누구도 잡지 않으므로 `getStatus`는 500, 업로드 잡은
실패 후 재시도가 된다.

자가 치유된다 — 다음 호출에서 그 행은 DELETE의 대상이 되고 입양이 정상 종료한다. 창도 아주 좁다
(입양은 `setDriveAccountId` **뒤**에 돌므로, 그 뒤에 `''`을 쓰는 잡은 이미 시작해 있던 것뿐이다).
기록만 남기면 충분하다고 본다.

---

## Answers to what the report asked me to attack

### 1. 입양 DELETE — 통과하면서도 잘못 지우는 조합이 남았는가

**남았다. 다만 리포트가 상상한 곳이 아니다.**

- **"같은 자산에 `''` 행이 두 개(서로 다른 connectionId)"는 구조적으로 불가능하다.** PK가
  `(userId, assetId, driveAccountId)`이므로(`google-drive-upload.table.ts:39-58`) 한 (사용자, 자산)에
  `''` 행은 최대 하나다. 실제로 삽입을 시도해 `duplicate key value violates unique constraint
  "google_drive_upload_pkey"`를 받았다. 이 모양은 테스트할 것이 아니라 **없는 것**이다.
- **세 연결이 얽혀도 코드는 옳다.** U1의 자산 a1(`('', C_A)` + `('acct-b', C_cur)`), a2(`('', C_cur)` +
  `('acct-b', C_3)`), a3(`('', C_cur)` + `('acct-c', C_3)`), 그리고 U2의 두 행(같은 자산 a1의
  `acct-b` 행 하나, **현재 연결과 같은 `connectionId`를 든** `''` 행 하나)까지 8행을 만들어
  DELETE→UPDATE를 그대로 돌렸다. 지워진 것은 a2의 중복 `''` 1행뿐이고 나머지 7행은 기대대로였다.
  다른 사용자 행은 `userId` 조건이 아니라 **`connectionId`가 우연히 같아도** 지켜졌다(그 행은
  `driveAccountId=''`이고 U2에는 `acct-b` 행이 없어 EXISTS가 거짓).
- **"목표가 아닌 계정 아래 도장된 자산"은 코드는 옳지만 테스트가 없다 → M1.** 위에 적었다.
  이게 이번 라운드의 답이다.
- **"DELETE가 남겨서 뒤따르는 UPDATE를 깨뜨리는" 경우는 단일 트랜잭션 안에서는 없다.** DELETE가
  지우는 집합은 정확히 "UPDATE가 충돌할 행"이므로 남는 `''` 행에는 목표 계정 형제가 없다. 유일한
  구멍은 동시성이고 N5에 적었다.

### 2. CI 마이그레이션 확인 — 파일 수 = 적용 수라는 전제가 항상 참인가

**CI에서는 항상 참이라서 아무것도 말하지 않고, CI 밖에서는 참이 아니다.** 업스트림은 마이그레이션을
지운 적(`0975b1599`)도, 이름을 바꾼 적(다섯 번, 전부 `R100`)도 있다. 스쿼시는 이력에서 못 찾았다.
`migration_overrides`는 무관하다(별도 테이블). 상세와 대안은 N2에.

### 3. 증거 스탬프 — dirty 표시가 필요할 때 켜지고 아닐 때 꺼지는가

**넷 다 실행해서 확인했다. git 2.43.0에서 pathspec `':!dev-test/google-drive/results'`는 의도대로
동작한다.**

| 상황 | `--porcelain -- ':!…results'` | 마커 |
|---|---|---|
| 깨끗한 트리 | (빈 출력) | 조용 |
| results 안 **미추적** 파일 (= 이번 실행 자신의 출력) | (빈 출력) — 단 pathspec 없는 status는 `?? …/zz-probe.txt` | 조용 ✅ 첫 구현이 틀렸던 그 경우 |
| results 안 **추적 파일 수정** | (빈 출력) | 조용 |
| results **바깥** 미추적 파일 | `?? dev-test/google-drive/zz-outside.txt` | 발화 ✅ |
| 소스 파일 수정 | ` M server/src/repositories/google-drive.repository.ts` | `commit: 14b54fb87 + UNCOMMITTED CHANGES` ✅ |

첨부된 증거(`results/20260905-1028.txt`)의 헤더는 `commit: 0ef8eee01`이고 마커가 없다. 그 파일의
`date:`가 `2026-09-05T10:28:55+09:00`으로 `0ef8eee01`의 커밋 시각과 초 단위까지 같으니, 커밋
직후에 돌린 실행이 맞다. 테스트 수(server 264 / medium 41)도 내가 같은 커밋 트리에서 직접 돌린
값과 일치한다. **이 증거는 믿을 수 있다.** 남은 좁은 구멍은 N4.

### 4. M2와 N3 — 주장하는 이유로 통과하는가

**둘 다 그렇다. 리포트가 지목한 변이를 그대로 다시 돌렸다.**

- **M2**: `service.ts:754`(`if (this.isInvalidGrant(error)) {`)를 `if (true)`로 → 새 테스트
  `should leave the connection alone when Drive fails for another reason` **하나만** 실패.
  반대로 `if (false)`로 → 기존 `should report a revoked grant as disconnected, not as a server
  error` **하나만** 실패. **양방향이 각각 다른 테스트에 걸린다** — 분기가 제대로 고정됐다는 뜻이다.
  (테스트 자체도 공허하지 않다: `driveAboutGet`이 503으로 거절되고 `getStorage`가 그 에러를
  그대로 던지는 것을 단언한 뒤 `deleteCredentials`가 안 불렸음을 본다. 즉 catch 블록에 **실제로
  들어간** 상태에서 부정 단언을 한다.)
- **N3**: `repository.ts:94`의 `connectionId` 재발급 줄(`sql` 태그의 `uuid_generate_v4()`)을 지우면 **2개** 실패 —
  값 비교 테스트(`should mint a new connection identity on a re-link`)와 새 행동 테스트
  (`should stop claiming its own rows once it has been re-linked`). 리포트가 말한 "값 비교
  테스트만 있었다"는 상태가 실제로 해소됐다.

### 5. 거짓이 된 주석·문서

확인했다. `google-drive-upload.table.ts`와 `1787200000000-AddGoogleDriveConnectionId.ts`의
"어떤 경로도 원장 행을 지우지 않는다"가 "리셋하지 않는다 + 입양이 지우는 좁은 한 부류가 있다"로
정확히 바뀌었다. `CLAUDE.md`의 드레인 설명도 맞다 — 마이그레이션은 원장 `connectionId`를
**백필하지 않고**(`ALTER TABLE "google_drive_upload" ADD "connectionId" uuid;`), 연결 쪽만
`NOT NULL DEFAULT uuid_generate_v4()`로 채운다. 볼러타일 기본값이라 **행마다** 다른 uuid가 들어가는
것까지 확인했다(3행 → distinct 3). 그래서 배포 전 6,996행은 `null`이라 드레인 대상이 아니라는
서술이 성립한다.

### 6. 이 세 커밋이 배포 판정을 바꾸는가 / `refreshToken` nullable은 배포 전인가 후인가

**바꾸지 않는다. round-22의 판정(배포 가능)이 그대로 유지된다.**

근거는 단순하다 — `git diff f64586ef2..14b54fb87 -- server/src ':!*.spec.ts'`에서 주석이 아닌
줄이 **0개**다. 바뀐 것은 테스트 2개, 주석 2곳, 문서(CLAUDE.md·리뷰 파일·리포트), CI 스텝, `run.sh`,
그리고 증거 파일뿐이다. 런타임 동작이 그대로이므로 배포 위험이 늘지도 줄지도 않았다. 늘어난 것은
**믿을 수 있는 증거**다: round-22가 "코드는 옳은데 아무도 안 지킨다"고 했던 세 곳이 이제 지켜진다.

**`refreshToken` nullable 마이그레이션(M8의 근본 해법)은 여전히 배포 *뒤*를 권한다.** round-22가
든 이유가 하나도 약해지지 않았다:

1. 입양의 CAS가 `where refreshToken = ?` + `forUpdate()`에 걸려 있다(`repository.ts:161-167`).
   토큰이 null이 될 수 있으면 `null = null`이 참이 아니라서 그 비교의 의미가 통째로 바뀐다 —
   **이번 라운드가 겨우 테스트로 고정한 바로 그 문장**이다. 지금 건드리면 방금 산 보증을 잃는다.
2. `setDriveAccountId`도 같은 토큰 비교에 기대고 있고(`repository.ts:110-121`), 원장 조인
   경로들은 토큰을 보지 않는다 — 즉 nullable로 바꾸면 "연결은 있는데 토큰이 없는" 3상태가
   생기고 그 상태를 읽는 쿼리마다 판단이 필요해진다. medium 테스트가 붙어야 할 종류의 변경이다.
3. 이번 배포의 관문이 아니다. M8은 UX 비용(재연결 시 폴더 재선택)이지 데이터 안전 문제가 아니고,
   되돌릴 수 없는 쪽(중복 업로드)과는 무관하다.

**권하는 순서**: 이번 배포 → 운영에서 `drive_account`가 하나뿐이고 배포 전후로 바뀌지 않는지
눈으로 확인 → 다음 라운드에서 M1·M2를 닫고(둘 다 medium 테스트 + 한 줄) → 그다음 라운드에서
`refreshToken` nullable을 (1)(2)와 함께 설계.

**M1·M2도 배포를 막지 않는다.** M1은 테스트 구멍이고 코드는 옳다. M2는 현재 도달하지 않는다.
다만 **다음 라운드로 미루지는 말라** — 이번 라운드가 증명했듯이, 지켜지지 않는 조건은 리팩터가
한 번 지나가면 그대로 사라진다.

### 7. UI `stalled` 상태 / 메뉴 요청 2·4번

이 세 커밋에 관련 변경이 없어 판단할 새 근거가 없다. 두 라운드 연속 "관측 품질 문제"였던 판정을
뒤집을 이유를 이번 diff에서 찾지 못했다 — **유지**를 권한다. 메뉴 요청은 사장님 결정 사항이라
리뷰어가 답할 것이 없다.

---

## What I did not verify

- **web 유닛 39개와 svelte-check 게이트.** 이 워크트리에 `web/node_modules`가 없어 돌리지 못했다
  (`ls web/node_modules` → 없음). 설치하면 워크트리를 오염시키므로 하지 않았다. 대신 CI 잡
  `Full server + web unit sweep`이 `success`인 것과 증거 파일의 `39 passed`를 근거로 삼았다 —
  **내가 직접 재현한 것은 아니다.**
- **CI 스텝의 실제 출력.** 로그 다운로드는 인증이 필요해 403이었다. 스텝의 `conclusion=success`만
  API로 확인했고, `migrations on disk: N, applied: N`이 무엇을 찍었는지는 못 봤다.
- **운영(랩탑) DB 상태.** 이 세션에서 손대지 않았다. 6,996행·`connectionId is null`이라는 서술은
  round-22의 측정을 그대로 인용한 것이고 이번에 재측정하지 않았다.
- **브라우저 경로.** `getStatus`/설정 화면이 실제로 입양을 트리거하는지는 코드 독해로만 확인했다.
- **`npx eslint`.** 코드 변경이 없어 돌리지 않았다. `tsc --noEmit`은 exit 0이지만 증분 캐시가
  있는 상태라 완전한 클린 빌드는 아니다.
- **동시성(N5)을 실제 두 세션으로 재현하지 않았다.** 락 범위를 코드로 읽고 추론했을 뿐이다.

## Feeding back into the plan

`dev-docs/google-drive/feature-roadmap.md`(입양 절)에 남길 것:

1. **"입양은 DELETE와 UPDATE 두 문장이고, 조건이 **세 개씩** 있다."** 지금까지 세 라운드 연속으로
   "두 대칭 지점 중 한쪽만 지켜졌다"가 반복됐다 — round-21은 `getPickerConfig`만, round-22는
   UPDATE만, round-23은 DELETE의 신원 조건만. 다음 사람이 이 문장을 건드리면 **여섯 개 조건마다
   변이를 돌려 보라**고 적어 둔다. 오늘 기준 지켜지지 않는 것은 `:187`(DELETE의 `userId`)과
   `:196`(EXISTS의 계정 일치)이다.
2. **`''`는 값이지 "없음"이 아니다.** 도메인에서 `''`이 "미상 버킷"이라는 정상값이기 때문에,
   `''`을 계정 인자로 받는 함수는 전부 자기 자신을 매칭할 위험이 있다. 리포지토리 입구에서
   막는다는 규칙으로 적어 둔다(M2).
3. **PK `(userId, assetId, driveAccountId)`가 무엇을 불가능하게 만드는지**를 표로 남긴다. 이번에
   "같은 자산의 `''` 행 두 개"라는 검토 항목이 나왔는데 답은 "스키마가 이미 금지한다"였다.
   다음 라운드가 같은 것을 다시 세우지 않도록.
4. **CI 확인은 "무엇이 틀렸을 때 빨개지는가"로 설계한다.** 이번 마이그레이션 확인은 CI에서는
   앞 스텝의 exit code를 되풀이할 뿐이다(N2). 새 CI 스텝을 넣을 때는 **그 스텝만 실패하게 만드는
   시나리오를 하나 적어 두는 것**을 관례로 한다.
5. **리포트의 숫자에는 기준 커밋을 붙인다**(N3). 이번 `run.sh` 수정이 증거의 커밋을 믿게 만들었으니,
   본문에 인용하는 테스트 수도 같은 규율을 따른다.

---

## 변경 범위 확인

`git status --porcelain`을 실행해 이 리뷰 파일 하나만 새로 생겼음을 확인했다. 변이 실험에 쓴
`server/src/repositories/google-drive.repository.ts`와 `server/src/services/google-drive.service.ts`는
전부 원본으로 되돌렸고, SQL 프로브용 DB `gdrive_probe`는 `drop database`로 지웠다. 소스는 한 줄도
남기지 않았다.
