# Code Review — 충돌 검사의 범위(M1) · 빈 계정 가드(M2) · 마이그레이션 검사 3판

| | |
|---|---|
| Branch / HEAD | `feat/google-drive-album-sync-v3.1.0` / `80fe69008` (detached) |
| Commits reviewed | `bec13f903`, `e438d0462` (`14b54fb87..80fe69008`) |
| Report | `../report/google-drive-wave6-round24-collision-scope-20260905-1110-report.md` |
| Prior review | `google-drive-wave6-round23-adoption-delete-20260905-1035-review.md` (같은 리뷰어) |
| Reviewed | 2026-09-05 |
| 작업 환경 | 격리 워크트리 `/home/gwyun/workspace/immich-review`(detached `80fe69008`). 변이·프로브 테스트·일회용 DB(`immich_postgres` 안의 `gdrive_probe24`, 검증 후 `drop database`)는 전부 그 안에서만. 작성자 트리 `/home/gwyun/workspace/immich`는 읽지도 쓰지도 않았다 |

## Verdict

**두 커밋은 주장하는 이유로 성립한다. 프로덕션 코드 변경은 정확히 세 줄이고**
(`git diff 14b54fb87..80fe69008 -- server/src ':!*.spec.ts'`에서 주석이 아닌 줄은 `if (!driveAccountId) {`
/ `return false;` / `}` 뿐), **M1·M2 두 지적은 각각 지목한 변이를 실제로 죽인다.** `repository.ts:205`를
`'!=', ''`로 넓히면 이 HEAD에서 **1 failed / 43 passed**이고 깨지는 것은 새 테스트
`should keep an unstamped row whose asset is only stamped under some other account` 하나뿐이다 —
리포트의 "43/1"과 정확히 같다. 빈 계정 가드는 **양방향**으로 고정돼 있다: `:157-159`를 지우면
`should refuse to adopt into an empty account id` 하나만 깨지고, `if (true)`로 뒤집으면 다른 4개가 깨진다.
증거 파일 `results/20260905-1100.txt`는 `commit: bec13f903`, dirty 마커 없음이고 그 안의 264/44는 내가
이 워크트리에서 직접 돌린 값과 일치한다. CI 런 `33937864777`도 실재한다 —
`head_sha=e438d046…`, 4잡 전부 `success`, `Check the migrations actually landed` 스텝도 `success`
(공개 API로 확인).

**가장 중요한 문제는, 이번 라운드가 두 쌍둥이 중 도달 불가능한 쪽을 고정하고 도달 가능한 쪽을
남겼다는 것이다(M1).** 새 N1 테스트가 지키는 DELETE의 `userId` 필터(`:196`)는 리포트 자신이 말하듯
"애플리케이션이 만들지 않는 상태"를 막는다. 그런데 **바로 그 안쪽, EXISTS의 `stamped.userId` 상관조건
(`:203`)은 아무도 지키지 않고**(지우면 **44/44 통과**), 이쪽이 막는 상태는 **앨범 공유로 실제로 만들어진다.**
프로브 테스트로 재현했다 — 다른 immich 사용자가 같은 공유 자산을 **같은 구글 계정**으로 올려 둔 경우,
변이된 코드는 *이 사용자 자신의* 미상 행을 **통째로 지운다**(단언 결과가 `[]`). 원장이 사라지므로 그 자산은
"올린 적 없음"으로 읽히고, `files.create`에 멱등성이 없으니 이미 그 Drive에 있는 파일이 되돌릴 수 없이
중복된다. **지금 코드는 옳다.** 틀린 것은 세 라운드째 같은 자리에서 반복되는 **증명 범위**다.

두 번째는 새 N1 테스트 자신이다(N1). `should not delete another user's colliding row`는 **입양이 통째로
꺼져도 통과한다** — `:157`을 `if (true)`로 바꿔 입양을 완전히 무력화해도 그 테스트만은 초록이다. 다른
사용자의 행에 대한 **부정 단언만** 있고 "이 사용자 쪽에서는 입양이 실제로 일어났다"는 짝이 없기 때문이다.
이 저장소가 두 번 밟은 지뢰(`CLAUDE.md` §4 마지막 줄)와 정확히 같은 모양이다.

세 번째는 마이그레이션 검사의 **근거**다(N2). 검사 자체는 개수판보다 낫고 이번에 실 DB 양방향으로
확인했지만, 커밋 메시지와 워크플로 주석이 적은 이유 — "오래 산 DB는 파일보다 많은 행을 들고도 **사실은
최신일 수 있다**" — 는 **거짓이다.** 적용된 이름이 디스크에 없는 DB는 최신이기는커녕 **마이그레이션 자체가
돌지 않는다**(`corrupted migrations`). 일회용 DB로 재현했다.

**배포 판정은 바뀌지 않는다.** 근거는 §5에 적었다.

### Evidence I ran myself

전부 이 워크트리의 HEAD(`80fe69008`)에서 돌렸다. 변이는 전부 줄 번호로 찍고 원본을 되돌렸다.

| Check | Result |
|---|---|
| server unit — run.sh의 8개 스펙, `--config test/vitest.config.mjs` | **264 passed (8 files)** — 증거 파일과 일치 |
| medium — `test/medium/specs/repositories/google-drive.repository.spec.ts` | **44 passed** — 증거 파일과 일치 |
| 변이 `:205` → `'!=', ''` (EXISTS를 **넓힘**) | **1 failed / 43 passed** — 새 M1 테스트 하나만 ✅ 리포트와 일치 |
| 변이 `:205` → `'!=', driveAccountId` (뒤집음) | **3 failed / 41 passed** ✅ |
| 변이 `:203` 삭제 (EXISTS의 `stamped.userId` 상관조건) | **44/44 통과 — 구멍** ❌ (M1) |
| 변이 `:204` 삭제 (EXISTS의 `stamped.assetId` 상관조건) | **1 failed** ✅ |
| 변이 `:196` 삭제 (DELETE의 `userId`) | **1 failed**: 새 N1 테스트 ✅ (round-23의 구멍이 닫혔다) |
| 변이 `:197` / `:198` 삭제 (DELETE의 `''` / `connectionId`) | 각각 **1 failed** ✅ |
| 변이 `:213` 삭제 (UPDATE의 `userId`) | **5 failed** ✅ |
| 변이 `:214` 삭제 (UPDATE의 `''`) | **44/44 통과** — 다만 **동치 변이**로 판단, N3에 적었다 |
| 변이 `:215` 삭제 (UPDATE의 `connectionId`) | **5 failed** ✅ |
| 변이 `:157-159` 삭제 (빈 계정 가드) | **1 failed**: `should refuse to adopt into an empty account id` ✅ |
| 변이 `:157` → `if (true)` (입양 전면 무력화) | **4 failed** — 그런데 새 N1 테스트는 **통과** ❌ (N1) |
| 프로브 테스트(임시 삽입 후 되돌림) — 공유 자산을 다른 사용자가 같은 계정으로 도장 | HEAD 코드: **45/45 통과**. `:203` 변이: **`expected [] to deeply equal [{driveAccountId:'account-b'}]`** — 자기 원장 행이 삭제됨 ❌ (M1) |
| CI 이름 검사 재현 — 갓 마이그레이션한 일회용 DB `gdrive_probe24` | 디스크 98 / 적용 98, `diff` 무출력 → **통과** ✅ |
| 같은 검사 — 개발 DB `immich` | 95행, `1787000000000-AddGoogleDriveAccountId` 외 2개를 이름으로 지목하며 실패 ✅ |
| `dist`의 마이그레이션 하나를 **이름만 바꾸고** `migrations run` 재실행 | `Migrations failed: Error: corrupted migrations: previously executed migration 1787200000000-AddGoogleDriveConnectionId is missing` ❌ (N2의 근거) |
| `kysely`/`@immich/sql-tools`가 쓰는 이름 규칙 | `FileMigrationProvider`의 `fileName.substring(0, fileName.lastIndexOf('.'))` — 디스크 basename 그대로. `migrationTableName: 'kysely_migrations'`는 `sql-tools/dist/index.js:641`과 `database.repository.ts:508` 두 곳뿐이고 규칙이 같다 |
| `migration_overrides` | `1751924596408-AddOverrides.ts:4`가 만드는 **별도 테이블**(함수·트리거 정의 jsonb). `kysely_migrations`에 개입하지 않는다 |
| `npx tsc --noEmit -p tsconfig.json` (server) | exit 0 |
| `npx eslint <3 files> --max-warnings 0` | exit 0 |
| GitHub API `actions/runs/33937864777` | `head_sha=e438d046…`, `conclusion=success`, 4잡 전부 success, 마이그레이션 스텝 success |
| `git diff 14b54fb87..80fe69008 -- server/src ':!*.spec.ts'` 중 비주석 줄 | **3줄** (가드 본문) |

---

## Findings

### M1 (Medium) — EXISTS의 `stamped.userId` 상관조건(`repository.ts:203`)이 도달 가능한 쌍둥이인데 아무도 지키지 않는다

리포트가 물은 "통과하면서도 잘못 지우는 조합"이 남아 있다. 계정을 넷으로 늘리는 방향이 아니라
**사용자를 둘로 늘리는 방향**이다.

```ts
// server/src/repositories/google-drive.repository.ts:199-207
.where(({ exists, selectFrom }) =>
  exists(
    selectFrom('google_drive_upload as stamped')
      .select(sql`1`.as('one'))
      .whereRef('stamped.userId', '=', 'google_drive_upload.userId'),   // ← 203: 아무도 안 지킨다
      .whereRef('stamped.assetId', '=', 'google_drive_upload.assetId')  // ← 204: 지켜진다
      .where('stamped.driveAccountId', '=', driveAccountId),            // ← 205: 이번에 닫혔다
  ),
)
```

`:203`을 지우면 **44/44가 통과한다.** 지운 코드의 의미는 "이 자산을 **누군가**가 목표 계정으로 도장했으면
내 미상 행을 지운다"이고, 손해는 다음과 같다:

| 상태 | 지금 코드 | `:203` 없는 코드 |
|---|---|---|
| U1: `(assetX, '', C_cur)` — 자기 계정 도장 없음 | `''` → `account-b`로 도장 | **행 삭제** |
| U2: `(assetX, 'account-b', C_A)` — 남이 같은 Drive로 올림 | 그대로 | 그대로 |

결과는 U1의 원장에서 assetX가 **사라진다.** `ledgerMatches`(`repository.ts:44-45`)는 현재 계정과 `''`만
매칭하므로 `hasUpload(U1, assetX)`가 false가 되고, 그 파일은 **이미 `account-b`의 Drive에 있는데도** 다시
올라간다. `files.create`에 멱등성이 없으니 되돌릴 수 없다 — round-22 M1, round-23 M1과 **정확히 같은
등급의 손해**다.

**도달 가능성이 N1과 다르다.** N1 테스트가 지키는 `:196`은 두 사용자가 같은 `connectionId`를 들어야
하고, 그건 uuid 충돌이라 애플리케이션이 만들지 않는다(리포트가 스스로 그렇게 적었다). 반면 `:203`이
막는 상태는 **평범한 운영 상태**다:

- `streamPendingUploads`(`repository.ts:284`)는 사용자가 **선택했고 아직 볼 수 있는** 앨범의 자산을
  흘린다 — 공유 앨범 포함. 즉 U2가 U1 소유 자산을 자기 Drive로 올릴 수 있다.
- 남는 조건은 "U1과 U2의 `driveAccountId`가 같은 문자열"뿐이다. 한 사람이 immich 계정 둘을 쓰거나,
  가족이 Drive 계정 하나를 공유하면 그대로 성립한다. 스키마도 서비스도 이를 금지하지 않는다.

**재현.** 스펙에 임시 테스트를 넣고 두 번 돌린 뒤 되돌렸다.

```ts
const { user } = await ctx.newUser();
const { user: other } = await ctx.newUser();
const { asset } = await ctx.newAsset({ ownerId: other.id });   // 공유 자산
await connect(ctx, user.id, null, CONNECTION_B);
await ledger(ctx, user.id, asset.id, '', CONNECTION_B);          // 내 미상 행
await ledger(ctx, other.id, asset.id, 'account-b', CONNECTION_A);// 남이 같은 계정으로 도장

await sut.adoptUnstampedUploads(user.id, 'token', 'account-b');
// 기대: 내 행이 'account-b'로 도장된다
```

- HEAD 코드: **45/45 통과** (내 행은 `account-b`가 된다 — 지금 코드는 옳다)
- `:203` 삭제: **실패**, `AssertionError: expected [] to deeply equal [ { driveAccountId: 'account-b' } ]`
  — 빈 배열, 즉 **행이 삭제됐다**

**고칠 것** — medium 테스트 하나. 위 픽스처를 그대로 `should keep an unstamped row whose asset is only
stamped under some other account` 옆에 넣으면 된다. 이름은
`should not treat another user's stamped row as this user's collision` 정도가 맞다. 이걸 넣으면 `:203`
변이가 실패한다.

### N1 (Nit) — 새 `userId` 테스트는 입양이 **통째로 꺼져도** 통과한다

리포트가 판단을 구한 그 테스트다. 답부터: **테스트는 남기되, 지금 형태로는 공허하다. 단언 하나를
더해야 한다.**

`:157`을 `if (true)`로 바꿔 `adoptUnstampedUploads`를 완전히 무력화하면 4개가 깨지는데, 그 4개에
`should not delete another user's colliding row`는 **들어 있지 않다.** 이유는 명확하다 —
그 테스트는 `other.id`의 행 2개가 그대로인지만 본다(`spec.ts`의 `.where('userId', '=', other.id)`).
입양이 아무것도 하지 않으면 그 단언은 당연히 참이다.

이건 `CLAUDE.md` §4의 마지막 줄("기능이 꺼져 있어 첫 관문에서 빠져나간 것 — '안 했다'를 단언하는
테스트는 의도한 이유로 통과하는지 반드시 확인")에 정확히 걸린다. 이 저장소가 두 번 밟은 지뢰다.

**리포트의 질문에 대한 판단은 §"공격 요청에 대한 답" 3번**에 적었다(요약: 테스트를 빼면 안 된다 —
`:196` 변이를 죽이는 유일한 테스트다). 여기 적을 것은 **고치는 방법**이다:

```ts
      // 남의 행이 안 지워졌다만으로는 입양이 꺼져도 통과한다. 내 쪽에서 실제로 일어났는지도 못박는다.
      const mine = await ctx.database
        .selectFrom('google_drive_upload')
        .select('driveAccountId')
        .where('userId', '=', user.id)
        .where('assetId', '=', asset.id)
        .execute();
      expect(mine).toEqual([{ driveAccountId: 'account-b' }]);   // '' 행이 충돌로 삭제되고 한 행만 남는다
```

이 단언이 있으면 `if (true)` 변이가 이 테스트도 깨뜨린다.

### N2 (Nit) — 마이그레이션 검사는 좋아졌지만, 적힌 근거가 사실이 아니다

검사 자체는 확인했다. 갓 마이그레이션한 일회용 DB에서 98/98로 조용하고, 3개 뒤처진 개발 DB에서는
빠진 이름 셋을 정확히 찍는다. `migration_overrides`는 무관하고(`1751924596408-AddOverrides.ts:4`가
만드는 별도 테이블), `kysely_migrations`에 쓰는 주체는 둘뿐이며(`@immich/sql-tools`의 Migrator,
`database.repository.ts:503-515`의 런타임 Migrator) **둘 다 같은 `FileMigrationProvider`를 쓰고 이름은
파일 basename에서 확장자만 뗀 값이다.** 그러므로 **이 저장소에는 디스크와 다른 이름으로
`kysely_migrations`에 쓰는 경로가 없다.** 질문에 대한 답은 "없다"다.

**그런데 근거가 틀렸다.** 워크플로 주석(`fork-google-drive.yml:289-291`)과 커밋 메시지가 이렇게 적는다:

> counting rows fails on a long-lived database for reasons that are not drift — upstream has deleted a
> migration and renamed several, so applied and on-disk counts can differ **while the database is in
> fact current**.

`applied > expected`가 되려면 **이미 적용된 이름이 디스크에서 사라져야** 하고, 그 DB는 최신이기는커녕
**마이그레이션이 아예 돌지 않는다.** kysely의 `#ensureNoMissingMigrations`(`migrator.js:491-496`)가
`allowUnorderedMigrations`와 **무관하게** 항상 던지기 때문이다(`:447`에서 무조건 호출, `:449`의 순서
검사만 플래그에 걸린다). 일회용 DB로 재현했다 — `dist`의 마이그레이션 하나를 이름만 바꾸고 다시 돌리면:

```
Migrations failed: Error: corrupted migrations: previously executed migration
1787200000000-AddGoogleDriveConnectionId is missing
```

즉 그런 DB는 **앞 스텝 `Apply migrations`에서 먼저 빨개진다.** 개수판이 "맞는 DB에서 실패"한 적은
없었다는 뜻이다. (round-23의 내 N2(c)가 이 부분을 틀렸다. 인용된 업스트림 커밋들 자체는 실재한다 —
`0975b1599`는 `1773175313374-Test.ts` 삭제, `84c75d95c`·`b9e0e65bd`·`34f0f6c81`은 타임스탬프 접두사만
바꾸는 R100 rename이다. 다만 그것들은 **아직 릴리스되지 않은** 마이그레이션이라 실제 DB를 깨지 않는다.)

**그래서 이름판이 나쁜가?** 아니다. 이름판은 여전히 **엄격하게 낫다** — 실패했을 때 어느 마이그레이션인지
말하고, 개수가 우연히 같은 경우("하나 지워지고 하나 추가된 `dist`")를 잡는다. 바꿀 것은 코드가 아니라
**주석이다.** 지금 주석은 다음 사람에게 "corrupted 상태의 DB도 사실은 최신"이라고 가르친다.

**고칠 것** — `fork-google-drive.yml:287-293`의 주석을 사실로 되돌린다:

```yaml
          # Names, not counts. Asking for `google_drive_upload` answered yes for a database stuck
          # several migrations back, and counting says only *how many* are missing. A name diff says
          # which. It also catches the one shape a count can miss: a stale dist/ where one migration
          # was removed and another added, so the counts agree and the SQL is still generated against
          # the wrong schema.
          #
          # What this step can and cannot see: `Apply migrations` above throws on a database holding
          # a migration that no longer exists on disk ("corrupted migrations"), so that shape never
          # reaches here. What reaches here is src/ disagreeing with dist/ — the migrations run from
          # dist/schema/migrations, this compares against src/schema/migrations.
```

그리고 round-23 N2(b)가 남긴 지적은 **아직 열려 있다**: CI에서 이 스텝이 단독으로 빨개지는 시나리오는
`src` ≠ `dist` 하나뿐이고, 러너는 매번 새로 체크아웃해 `mise run //server:build`로 `dist`를 만든다
(워크플로에 `dist` 캐시가 없다 — `grep -n cache`로 확인). 스텝을 지우라는 뜻은 아니다. **그 시나리오를
주석에 한 줄 적어 두면** 다음 사람이 "이 스텝은 CI에서 무엇을 잡는가"를 다시 세우지 않는다.

### N3 (Nit, 기록용) — UPDATE의 `driveAccountId = ''`(`:214`)는 지워도 44/44지만, **동치 변이**다

다음 라운드가 이걸 M1의 형제로 착각하고 테스트를 쓰는 것을 막으려고 적는다. 변이 결과는 같지만
성질이 다르다.

한 `connectionId`가 들 수 있는 `driveAccountId`는 `''`와 그 연결의 계정 A **둘뿐이다**:

- `recordUpload`(`repository.ts:691`)가 쓰는 계정은 `uploadAccountId`이고, 그것은
  `credentials.driveAccountId ?? adoptIfNewlyIdentified(...)`(`service.ts:934-940`)에서 온다 —
  둘 다 **그 연결의** 계정이거나 `''`이다.
- 재연결은 `upsertCredentials`의 `onConflict`에서 `connectionId`를 **다시 발급**하므로
  (`repository.ts:90`), 다른 계정은 다른 `connectionId`를 갖는다.
- `recordUpload`의 `onConflict`는 `driveFileId`만 갱신하고 `connectionId`는 건드리지 않으므로, 옛
  연결의 행이 새 연결 id로 넘어오지도 않는다.

따라서 `:214`를 빼면 "A인 행을 A로 다시 쓴다"가 추가될 뿐이고 PK도 안전하다. **테스트로 막을 것이
아니라 의도를 적어 둘 것**이다. 굳이 손댈 이유는 없다.

### N4 (Nit) — `return false`가 두 가지를 뜻하게 됐다

`adoptUnstampedUploads`의 `false`는 원래 "연결이 그 사이 바뀌었다"였고(`:175-177`), 이제 "빈 계정이라
거절했다"도 된다. 호출자 두 곳(`service.ts:462`, `:513`)이 반환값을 **모두 무시**하므로 오늘 문제는
없다(`grep -rn adoptUnstampedUploads server/src`로 확인). 반환값을 보는 호출자가 생기면 그때 구분하면
된다. 기록만.

---

## Answers to what the report asked me to attack

### 1. M1 — 픽스처가 안 덮는 모양이 남았는가

**남았다. 리포트가 상상한 축(계정 4개, 연결 분산)이 아니라 사용자 축이다.**

리포트가 제시한 세 모양은 전부 **이미 안전하거나 이미 덮여 있다.** 하나씩:

- **계정이 넷 이상 얽히는 경우.** 코드 경로가 늘지 않는다. EXISTS는 목표 계정 A 하나만 찾고,
  A가 아닌 계정 행(B, C, D…)은 PK가 달라 UPDATE와 충돌하지 않는다. 새 테스트가 고정한 "계정 하나"와
  "계정 셋"의 차이는 같은 술어를 한 번 더 부정하는 것뿐이다 — **새 테스트를 쓸 값이 없다.**
- **같은 자산이 두 계정에 도장돼 있고 그중 하나가 입양 대상.** 이건 이미 덮여 있다.
  `should adopt pre-column rows without colliding with rows already stamped`가 목표 계정 쪽을 고정하고,
  새 M1 테스트가 목표 아닌 계정 쪽을 고정한다. 둘을 한 자산에 합쳐도 EXISTS는 참(A 행이 있으므로)
  → 삭제, 그게 옳다. `:205`를 `'!=', driveAccountId`로 뒤집는 변이가 **3개**를 깨뜨리는 것이 이 축이
  촘촘하다는 증거다.
- **연결에 걸쳐 행이 흩어진 경우.** `should not delete another connection's unstamped row while
  resolving a collision`이 `:197`·`:198`을 지키고, `should not claim an unstamped row another
  connection wrote`와 `should stop claiming its own rows once it has been re-linked`가 `:215`를 지킨다.
  round-23에서 실 SQL로 8행 3연결 픽스처를 돌려 같은 결론을 얻었다.
- **DELETE가 남겨서 UPDATE를 깨뜨리는 경우는 한 트랜잭션 안에서는 없다.** DELETE가 지우는 집합이
  정확히 "UPDATE가 PK 충돌할 행"이고, 이제 `driveAccountId ≠ ''`가 보장되므로 EXISTS가 삭제 대상
  자신을 매칭하는 경로도 닫혔다. 남은 구멍은 동시성뿐이고 round-23 N5에 적어 두었다.

**남은 것은 하나, `:203`이다(M1).** 그리고 그것이 리포트가 이번에 고정한 `:196`보다 **더 도달하기 쉽다.**

### 2. M2 — early return이 막아서는 안 되는 것을 막는가

**막지 않는다. `''`가 정당한 인자인 경로는 없다 — 코드로 확인했다.**

호출자는 두 곳뿐이고(`grep -rn adoptUnstampedUploads server/src` → `service.ts:462`, `:513`) 둘 다
그 앞에서 `''`을 걸러낸다:

| 경로 | 가드 | `''`이 도달하는가 |
|---|---|---|
| 드레인 (`drainUnstampedUploads`, `service.ts:439`) | `:455` `if (!driveAccountId) { warn; return; }` | ❌ |
| 재연결 직전 (`linkAccount` → `service.ts:375`) | 같은 드레인을 탄다 | ❌ |
| 연결 해제 직전 (`service.ts:866`) | 같은 드레인을 탄다 | ❌ |
| 입양 (`adoptIfNewlyIdentified`, `service.ts:478`) — 호출자 3곳(`:635`, `:763`, `:936`) | `:486` `if (!driveAccountId) { warn; return ''; }` | ❌ |

`''`을 만들 수 있는 유일한 원천은 `getDriveAccountId`다 — `data.user?.permissionId ?? null`이
`''`을 그대로 통과시키고(`service.ts:556`), `:557`의 `if (!permissionId)`는 **경고만 하고 그 값을 그대로
돌려준다**(`return permissionId`, `:566`). 그러니까 `''`은 실제로 만들어질 수 있다. 그리고 위 두 가드가
그것을 받는다. 새 가드는 **세 번째 그물**이지 첫 그물이 아니다.

의미 손실도 없다. 반환값을 보는 호출자가 없고(N4), `adoptUnstampedUploads`에는 `@GenerateSql`이
붙어 있지 않아 생성물도 움직이지 않는다(CI의 `Generated SQL is current` 잡이 success인 것과 일치).

**즉 이 early return은 "정당한 호출을 거절하는 새 버그"가 아니다.** 다만 리포트가 스스로 적었듯
방어책이므로, **N1의 공허성(위)이 이 가드에는 없다는 점**을 확인해 둔다 — 지우면 정확히 하나가 깨지고,
`if (true)`로 뒤집으면 **다른** 4개가 깨진다. 양방향이 다른 테스트에 걸린다는 것이 제대로 고정됐다는 뜻이다.

### 3. N1 — 합성 상태를 고정하는 테스트가 다음 사람을 오도하는가

**판단: 테스트는 남긴다. 주석만으로는 부족하다. 단, 지금 형태는 고쳐야 한다(위 N1).**

헤지 없이 이유를 셋 적는다.

1. **그 테스트가 `:196` 변이를 죽이는 유일한 테스트다.** 지우면 `:196`은 다시 무방비가 되고, 이
   리뷰 체인이 세 라운드 연속으로 증명한 것이 정확히 "아무도 지키지 않는 술어는 리팩터가 한 번
   지나가면 사라진다"는 것이다. 주석은 그걸 막지 못한다 — round-22가 UPDATE에서, round-23이
   DELETE에서, 이번에 EXISTS에서 같은 일을 겪었고, 세 번 다 주석은 그 자리에 있었다.
2. **"애플리케이션이 만들 수 없다"는 오늘의 작성자에 대한 진술이지 술어에 대한 진술이 아니다.**
   그리고 이번 라운드가 그 논증의 취약함을 스스로 보여준다 — 같은 논리를 EXISTS의 `stamped.userId`에
   적용하면 "그것도 필요 없다"가 되는데, 그쪽은 **실제로 도달 가능**하다(M1). 도달 가능성 판정을
   테스트를 쓸지 말지의 기준으로 삼으면, 판정이 틀린 날 잃는 것이 원장이다.
3. **비용이 거의 없다.** 픽스처 15줄, 실행 11ms, 이미 0.5초짜리 스위트. 오도 위험은 테스트 안의
   주석이 이미 처리하고 있다("connection ids are per-connection uuids, so two users sharing one is
   not a state the application produces") — 그 문장이 정확히 다음 사람이 알아야 할 것이다.

**대신 지금 형태로는 값의 절반만 낸다.** 입양이 꺼져도 통과하기 때문이다. N1의 단언 한 줄을 더하면
"남의 행을 지키면서 **내 행은 실제로 입양했다**"가 되어, 합성 픽스처가 공허한 통과를 사는 일이 없어진다.
그 상태라면 **테스트를 두는 쪽이 명백히 옳다.**

### 4. 마이그레이션 이름 비교가 틀리는 경우

**이 저장소 안에는 없다.** `kysely_migrations`에 쓰는 주체는 두 Migrator뿐이고 둘 다 이름을 파일
basename에서 가져온다(위 N2). `migration_overrides`는 함수·트리거 정의를 담는 별도 테이블이라 무관하다.
업스트림의 rename은 실재하지만(`84c75d95c` 등), **적용된 뒤에 이름이 바뀌면 마이그레이션 자체가 죽으므로**
이 검사가 "맞는 트리에서 실패"하는 상황을 만들지 못한다 — 그 DB는 앞 스텝에서 이미 죽는다.
따라서 리포트의 결론("이름 비교가 옳다")은 맞고, **그 근거는 틀렸다.** 고칠 것은 주석이다(N2).

부수적으로 확인한 것 둘:
- 양쪽 `sort`가 같은 로케일을 쓴다(같은 `sort` 명령). `psql -tAc`는 여백을 붙이지 않는다. 문제없다.
- 두 파일이 **동시에** 비면(예: 잘못된 CWD로 glob 실패 + 컨테이너 죽음) `diff`가 통과하고
  `all 0 migrations applied`를 찍는다. 두 가지가 동시에 깨져야 하고 출력이 그 사실을 말하므로
  고칠 값은 없다고 본다 — 기록만.

### 5. 배포 판정 / `refreshToken` nullable 뒤의 CAS

**배포 판정은 바뀌지 않는다. round-22·23의 "배포 가능"이 그대로 유지된다.**

이번 두 커밋의 런타임 변경은 **세 줄**이고 전부 방어적 early return이다. 도달 가능한 호출자가 없으므로
운영 동작은 문자 그대로 동일하다. 늘어난 것은 테스트 3개와 CI 검사 하나. **M1도 배포를 막지 않는다 —
코드는 옳고, 구멍은 증명 범위에 있다.** 다만 round-23에서 적은 경고를 반복한다: 지켜지지 않는 술어는
다음 리팩터가 지운다. `:203`은 **다음 라운드에서** 닫는다.

**`refreshToken` nullable(M8)은 여전히 배포 뒤가 맞다.** round-23의 근거가 하나도 약해지지 않았고,
이번 라운드가 그 위에 테스트를 더 얹어서 지금 건드리면 잃을 것이 더 커졌다.

리포트가 물은 것 — **배포 후 CAS를 무엇으로 바꾸는가.** 답은 `connectionId`다. 시작점으로 쓸 수 있게
구체적으로 적는다.

1. **왜 `connectionId`인가.** 토큰 비교가 답하려던 질문은 "내가 읽은 그 연결이 아직 거기 있는가"이고,
   `connectionId`는 정확히 그 개념이다. 재연결마다 새로 발급되고(`repository.ts:90`의 onConflict),
   `NOT NULL DEFAULT uuid_generate_v4()`라 **null이 될 수 없다** — nullable 토큰이 `= ?` 비교를 깨뜨리는
   문제 자체가 생기지 않는다. 게다가 DELETE/UPDATE가 이미 같은 값으로 행을 고르므로(`:198`, `:215`)
   CAS와 본문이 **같은 신원 개념** 하나로 통일된다.

2. **바뀌는 서명.**
   ```ts
   // 지금:  where refreshToken = ?  → 토큰이 null이 되면 `null = null`이 참이 아니라 항상 0행
   adoptUnstampedUploads(userId: string, refreshToken: string, driveAccountId: string)
   // 뒤:    where connectionId = ?  → 호출자가 이미 들고 있는 값(uploadAsset이 게이트 1에서 읽는 그것)
   adoptUnstampedUploads(userId: string, connectionId: string, driveAccountId: string)
   ```
   `forUpdate()` 락과 트랜잭션 구조는 그대로 두고, `select`가 돌려주던 `connection.connectionId`는
   인자를 그대로 쓴다. 호출자는 이미 `credentials.connectionId`를 갖고 있다
   (`service.ts:1150`이 `recordUpload`에 넘기는 그 값). **덤으로 이 경로에서 refresh token 읽기가
   사라진다** — `getCredentials`가 "토큰을 읽는 유일한 통로"라는 `repository.ts:56-60`의 설계 의도에
   더 가까워진다.

3. **같은 수술이 필요한 곳이 하나 더 있다.** `setDriveAccountId`(`repository.ts:110-121`)가 똑같이
   `where refreshToken = ?`로 CAS를 건다. 여기도 `where connectionId = ?` + `driveAccountId is null`로
   바꾼다. 두 곳을 함께 바꾸지 않으면 "입양은 신원으로, 도장은 토큰으로" 판정하는 어긋난 상태가 된다.

4. **놓치면 안 되는 전제 하나.** 토큰을 null로 만드는 "소프트 연결 해제"는 **`connectionId`를 반드시
   함께 재발급해야 한다.** 그러지 않으면 재연결이 *다른* 구글 계정으로 이뤄져도 이전 연결의 원장 행을
   상속한다 — `upsertCredentials`가 재발급으로 막고 있는 바로 그 버그다. 지금 코드는 재연결이 항상
   `upsertCredentials`를 타서 안전하지만, `deleteCredentials`(`repository.ts:253`)를 "토큰만 null로"
   바꾸는 순간 그 보장이 사라진다.

5. **가장 큰 작업량은 CAS가 아니라 3상태다.** 지금은 "행이 있다 = 연결됨"이고, 세 곳이 그 전제로
   `innerJoin`한다 — `repository.ts:284`(`streamPendingUploads`), `:482`, `:542`. 토큰이 null일 수 있게
   되면 이 조인들은 **연결이 끊긴 사용자에게도 매칭**되어 업로드 대기 목록을 만들어 낸다. 세 곳 전부
   `where user_google_drive.refreshToken is not null`이 필요하고, 이건 medium 테스트가 붙어야 하는
   종류의 변경이다(SQL 자체가 정확성을 결정한다).

**권하는 순서**: 이번 배포 → 운영에서 `drive_account`가 하나뿐이고 배포 전후로 바뀌지 않는지 눈으로 확인
→ 다음 라운드에서 M1·N1을 닫고(테스트 2개, 코드 0줄) → 그다음 라운드에서 (2)(3)(4)를 한 커밋으로,
(5)를 별도 커밋으로.

### 6. UI `stalled` / 메뉴 요청 2·4번

이번 diff에 관련 변경이 없어 새 근거가 없다. **네 라운드 연속 "관측 품질 문제"** 판정을 뒤집을 이유를
찾지 못했다 — 유지를 권한다. 메뉴 요청은 사장님 결정 사항이라 리뷰어가 답할 것이 없다.

---

## What I did not verify

- **web 유닛 39개와 svelte-check 게이트.** 이 워크트리에 `web/node_modules`가 없어 돌리지 못했다.
  증거 파일의 `39 passed` / `no svelte-check regressions vs baseline (3 pre-existing files)`와 CI 잡
  `Full server + web unit sweep`이 success인 것을 근거로 삼았다 — **내가 재현한 것은 아니다.**
- **CI 스텝의 실제 출력.** 로그 다운로드는 인증이 필요하다. `conclusion=success`만 공개 API로 확인했고,
  `Check the migrations actually landed`가 무엇을 찍었는지는 못 봤다. 대신 그 스텝과 **같은 명령**을
  이 워크트리에서 손으로 돌려 양방향을 확인했다.
- **`mise //server:ci-unit` 전체.** 리포트가 exit 0이라고 적었고 CI 잡도 success지만, 나는 그 태스크가
  묶는 format/lint 전체 대신 **바뀐 파일 3개에 대한 `eslint --max-warnings 0`과 `tsc --noEmit`만**
  돌렸다(둘 다 exit 0).
- **동시성(round-23 N5).** 이번에도 두 세션으로 재현하지 않았다. 코드 독해뿐이다.
- **M1이 운영에서 이미 일어났는지.** 랩탑 DB를 이 세션에서 조회하지 않았다. M1은 **변이가 만드는**
  손해이지 지금 코드의 버그가 아니므로 운영 확인이 필요하지 않다고 판단했다. 다만 "두 immich 사용자가
  한 구글 계정을 쓰는가"는 사장님만 아는 사실이다 — M1의 도달 가능성 논증은 그 가정에 기댄다.
- **`getStatus`/설정 화면이 실제로 입양을 트리거하는지**는 여전히 코드 독해로만 확인했다.

---

## Feeding back into the plan

`dev-docs/google-drive/feature-roadmap.md`(입양 절)에 남길 것:

1. **입양의 술어는 여섯 개이고, 지금 지켜지는 것은 다섯이다.** DELETE `userId`(`:196`) ·
   `''`(`:197`) · `connectionId`(`:198`) · EXISTS `assetId`(`:204`) · EXISTS 계정(`:205`)은 각각
   변이가 테스트를 깨뜨린다. **남은 하나는 EXISTS의 `userId`(`:203`)** — 지우면 44/44다.
   UPDATE의 `''`(`:214`)도 지워도 통과하지만 **동치 변이**이니 테스트를 쓰지 말 것(N3에 근거).
2. **"도달 불가능"과 "테스트 불필요"는 다르다.** round-24는 도달 불가능한 쌍둥이(`:196`)를 고정하고
   도달 가능한 쌍둥이(`:203`)를 남겼다. 다음 사람이 이 문장을 건드릴 때는 **도달 가능성 순으로**
   변이를 돌린다: 사용자 축 → 계정 축 → 연결 축.
3. **부정 단언에는 긍정 짝을 붙인다.** `should not delete another user's colliding row`는 입양이
   통째로 꺼져도 통과한다(`:157` → `if (true)`로 확인). 이 저장소가 세 번째 밟는 지뢰다 —
   "X를 안 했다"를 단언하는 테스트마다 **"Y는 했다"를 같은 테스트에** 넣는 것을 규칙으로 적어 둔다.
4. **`refreshToken` nullable의 시작점은 `connectionId` CAS다.** 위 §5의 다섯 항목(서명 변경,
   `setDriveAccountId` 동반 수술, 소프트 해제 시 재발급, 세 `innerJoin`의 3상태)을 그대로 옮겨 둔다.
   이것이 M8을 "언젠가 할 일"에서 "다음 라운드가 집어들 수 있는 일"로 바꾼다.
5. **CI 검사에는 "이 스텝만 실패하는 시나리오"를 주석으로 적는다.** round-23에서 관례로 제안했고,
   이번 3판도 그 한 줄이 없어서 근거가 틀린 채로 커밋됐다(N2). 이번에는 그 시나리오가 실재한다 —
   `src` ≠ `dist`.
6. **틀린 리뷰도 되먹인다.** round-23의 N2(c)("업스트림 rename 때문에 개수 비교가 맞는 DB에서
   실패한다")는 **내가 틀렸고**, 그 판정이 그대로 코드 주석이 됐다. `CLAUDE.md` §1의 "붙여넣은
   리뷰·분석은 액면가로 받지 않는다"는 **리뷰어의 판정에도 적용된다**는 사례로 적어 둔다.

---

## 변경 범위 확인

`git status --porcelain`을 실행해 **이 리뷰 파일 하나만** 새로 생겼음을 확인했다. 변이 실험에 쓴
`server/src/repositories/google-drive.repository.ts`와, M1 프로브를 임시로 넣었던
`server/test/medium/specs/repositories/google-drive.repository.spec.ts`는 전부 원본으로 되돌렸다.
`server/dist/schema/migrations/`에서 이름을 바꿔 본 파일도 되돌렸다(`.js` 98개 확인). 일회용 DB
`gdrive_probe24`는 `drop database`로 지웠다. 소스는 한 줄도 남기지 않았다.
