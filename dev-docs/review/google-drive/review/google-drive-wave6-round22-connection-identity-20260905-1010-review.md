# Code Review — 연결 신원(H1) 재설계 · round-21 지적 반영 · P1 코너케이스

| | |
|---|---|
| Branch / HEAD | `feat/google-drive-album-sync-v3.1.0` / `f64586ef2` (detached) |
| Commits reviewed | `c9c6df02c`, `b5c5cfa23`, `68ff15a62`, `0c47d192e`, `af1639dbf` |
| Report | `../report/google-drive-wave6-round22-connection-identity-20260905-1010-report.md` |
| Prior review | `google-drive-wave6-round21-sql-tests-20260905-0900-review.md` (같은 리뷰어) |
| Reviewed | 2026-09-05 |
| 작업 환경 | 격리 워크트리 `/home/gwyun/workspace/immich-review`(detached `f64586ef2`). 변이·빌드·SQL 생성기·postgres 컨테이너(`gd-rev22-pg`, 호스트 포트 55433)는 전부 그 안에서만. 작성자 트리 `/home/gwyun/workspace/immich`는 읽지도 쓰지도 않았다 |

## Verdict

**H1 재설계는 버틴다. 시간 경계가 열어 두었던 오귀속은 구조적으로 닫혔다.** 지난 라운드에
실 DB로 재현했던 실패(연결 A가 승인한 업로드가 연결 B가 생긴 뒤에 착지 → B가 A의 파일을 자기
것으로 도장)는 이제 `connectionId` 등가 비교라 **성립할 방법 자체가 없다**. 연결을 바꾸는 경로는
`upsertCredentials` 하나뿐이고(`service.ts:378`이 유일한 호출자) 거기서 항상 재발급하며
(`repository.ts:94`), `setDriveAccountId`·`setFolderId`는 신원을 건드리지 않는 것이 옳다.
`recordUpload`가 gate 1의 낡은 값을 넘기는 것도 옳고, 그 성질은 witness가 붙은 유닛 테스트로
고정돼 있다(끝에서 다시 읽도록 변이하면 그 테스트가 실패한다 — 직접 확인). 마이그레이션은 운영과
같은 모양(연결 1개 + 원장 6,996행)의 실 DB에서 **0.9초**에 끝났고, 6,996행 전부 `connectionId`가
null이며 `''` 안전망은 그대로다. round-21이 지적한 공허한 술어 다섯 개(M2~M5, N2)는 **전부**
이번에 비공허해졌다 — 한 줄씩 줄 번호로 무력화해 각각 실패시키는 것까지 확인했다. CI도 리포트
그대로다(4잡·전 스텝 success, 실패 애노테이션 0, 경고는 업스트림 액션의 Node 20 안내 4건).

**가장 중요한 문제는 입양의 두 문장 중 `DELETE` 쪽 신원 조건만 아무도 지키지 않는다는 것이다(M1).**
`repository.ts:189`를 지워도 medium 39개가 전부 통과한다. 그런데 그 조건이 막고 있는 것은 정확히
이 기능이 가장 두려워하는 손해다 — 실 DB에서 재현했다: 이전 연결이 쓴 `('', C1)` 행과 이번 계정의
`('account-b', C2)` 행이 함께 있을 때, 조건을 빼면 **`file-in-A`를 기록한 행이 삭제된다.** A를
다시 연결하면 그 자산은 "안 올라감"이 되고, `files.create`에 멱등성이 없으므로 A의 드라이브에
되돌릴 수 없는 중복이 생긴다. `UPDATE` 쪽(`:206`)은 테스트 3개가 지키는데 `DELETE` 쪽은 0개다.
코드는 지금 옳다. **틀린 것은 "신원으로 claim한다"를 증명한다고 말하는 범위다.**

두 번째: **round-21 M1의 수정이 같은 결함의 절반만 덮었다.** `getPickerConfig`
(`service.ts:838`)에는 긍정·부정 테스트가 붙었지만, 똑같이 생긴 `getStorage`
(`service.ts:754`)는 `if (this.isInvalidGrant(error))`를 `if (true)`로 바꿔도 **82/82 통과**한다.
"5xx가 멀쩡한 연결을 지우면 안 된다"는 성질은 두 경로 모두의 성질이고, 설정 화면은 두 경로를
모두 탄다.

세 번째: **CLAUDE.md의 배포 런북이 폐기된 경계를 계속 설명한다(M3).** `68ff15a62`가 N3을 고치며
"그 연결이 붙은 뒤에 쌓인 미상 행을 넘긴다"로 적었는데(`CLAUDE.md:416`), 30분 뒤 `0c47d192e`가
경계를 신원으로 바꿨다. 운영 DB의 6,996행은 전부 null이므로 **배포 직후 드레인이 넘기는 행은 0개**다.
런북을 읽고 "연결 해제 전에 드레인이 받아준다"고 기대하면 사실과 다르다(결과는 여전히 안전하다 —
받아주는 것은 `''` 안전망이다).

### Evidence I ran myself

| Check | Result |
|---|---|
| medium `google-drive.repository.spec.ts` (`vitest.config.medium.mjs`) | `Tests 39 passed` — 리포트와 일치 |
| 서버 유닛 8스펙(`run.sh`의 `SERVER_SPECS`) | `Test Files 8 / Tests 263 passed` — **리포트 본문의 262와 불일치**, 첨부 증거 파일의 263과는 일치 |
| 서버 전체 유닛 스위트 | `Test Files 94 passed / Tests 2373 passed, 2 skipped` |
| `npx tsc --noEmit -p tsconfig.json` | rc=0 |
| `npx eslint`(바뀐 TS 7파일, `--max-warnings 0`) | rc=0 |
| 실 DB(운영 모양: user 1 + asset 6,996 + 원장 6,996 + 연결 1)에 `1787200000000` 적용 | **0.897 s**, `user_google_drive.connectionId` = not null / default `uuid_generate_v4()`, 원장 `count(connectionId)=0`, `unstamped=6996` |
| 같은 DB에 `sql-tools … migrations generate` | `No changes detected` — 리포트와 일치 |
| 같은 DB에 `mise run //:sql` | `Wrote 52 files / Generated 426 queries`, `git status --porcelain -- server/src/queries` **비어 있음** |
| `git status --porcelain -- server/src/queries` + untracked `.sql` | `?? …`로 잡음. 같은 상황에서 `git diff --exit-code`는 CLEAN — **M7 수정이 실효** |
| 컨테이너 안에서 socket/TCP `pg_isready` 경주 실측 | SOCKET READY → TCP READY까지 **0.332 s** 격차 재현 — **M6 수정(`-h 127.0.0.1`)이 실효** |
| CI 런 `33934074083` (GitHub API) | `head_sha=0c47d192e`, 4잡 전부 `success`, **전 스텝 success**(`Check the migrations actually landed` 포함). 애노테이션 4건 전부 `warning` = 업스트림 mise-action의 Node 20 안내 |
| `git diff 0c47d192e f64586ef2 -- server/ web/` | 비어 있음 — CI 커밋과 HEAD의 코드가 동일 |
| **변이** `:189` 삭제 (입양 DELETE의 `connectionId` 연언) | **39/39 통과** — 무방비 (M1) |
| **변이** `:206` 삭제 (입양 UPDATE의 `connectionId` 연언) | 3 failed — 비공허 |
| **변이** `:206` → `connectionId = ? or connectionId is null` | 1 failed (`should leave pre-column rows unstamped and still matching`) — null 제외가 실제로 고정돼 있다 |
| **변이** `:94` 삭제 (재링크 시 신원 재발급) | 1 failed (`should mint a new connection identity on a re-link`) |
| **변이** `service.ts:1150` → `recordUpload` 직전에 credentials 재조회 | 1 failed (`should record the connection that authorized the upload…`) — witness가 실효 |
| **변이** `:851` `.on(ledgerMatches(userId))` → `.on(true)` | 1 failed (M3-a 해소) |
| **변이** `:850` `userId` onRef → `.on(true)` | 1 failed (M3-b 해소) |
| **변이** `:854` `asset.deletedAt is null` → `.where(true)` | 1 failed (M3-c 해소) |
| **변이** `:702` `recordUpload` 에러삭제의 `userId` 필터 → `true` | 1 failed (M4 해소) |
| **변이** `:760` `old_row` 연언 → `and true` (**제거 방향**) | 1 failed (`should not report the same class as first again on a plain retry`) — M2 해소 |
| **변이** `:759` `others = 0` → `true` | 1 failed |
| **변이** `:742` `others`의 `userId` 필터 → `true`, **그 테스트 단독 실행** | 1 failed — 잔여 행이 아니라 픽스처가 지킨다 (N2 해소) |
| **변이** `service.ts:754` `if (this.isInvalidGrant(error))` → `if (true)` (`getStorage`) | **82/82 통과** — 무방비 (M2) |
| **변이** `service.ts:838` 같은 변이 (`getPickerConfig`) | 1 failed — round-21 M1 해소 |
| **변이** `service.ts:1216` `streamInfo.stream.destroy()` 삭제 | 1 failed — P1 첫 번째가 비공허 |
| **변이** `subscribeAlbum`의 `subscribe`를 큐잉 **뒤로** 이동 | 1 failed — P1 두 번째가 비공허 |
| **변이** `subscribeAlbum`에서 큐잉 자체를 제거 | 2 failed (`expected value must be number or bigint, received "undefined"`) — 순서 테스트가 "아무것도 안 큐잉"에도 시끄럽게 죽는다 |
| **실 DB probe**: 입양 DELETE에서 신원 연언 제거 시 무슨 일이 나는가 | 조건 있음 → 2행 유지(`file-in-A`, `file-in-B`) / 조건 없음 → **`file-in-A` 행 소멸** |
| `EXPLAIN ANALYZE` 입양 UPDATE (6,996행) | Seq Scan, `Execution Time: 0.739 ms` — 인덱스 부재는 비용이 아니다 |
| 워크트리 `git status --porcelain` (모든 변이 복원 후) | **이 리뷰 파일 하나뿐** |

---

## Findings

### M1 (Medium) — 입양의 `DELETE` 절반은 신원 조건을 아무도 지키지 않는다

**증거(변이).** `server/src/repositories/google-drive.repository.ts:189`
(`.where('connectionId', '=', connection.connectionId)`, `deleteFrom('google_drive_upload')` 쪽)을
**줄 번호로 삭제**하면 medium **39/39가 그대로 통과**한다. 바로 아래 `UPDATE` 쪽의 같은 줄(`:206`)은
삭제하면 3개가 실패한다. 즉 두 문장이 같은 불변식을 걸고 있는데 절반만 관문이 있다.

이유는 픽스처다. 유일하게 DELETE 분기를 타는 테스트
(`should adopt pre-column rows without colliding with rows already stamped`,
`spec.ts:657`)는 `''` 행을 전부 `CONNECTION_A`로 만들고 연결도 `CONNECTION_A`이므로,
조건이 있으나 없으나 같은 답이 나온다.

**무엇을 막고 있는 조건인가(실 DB로 확인).** 원장에
`('', connectionId=C1, file-in-A)`와 `('account-b', connectionId=C2, file-in-B)`가 함께 있고
현재 연결이 C2/`account-b`일 때:

```
-- 조건 있음 (현재 코드)            -- 조건 없음 (변이)
 driveAccountId | driveFileId        driveAccountId | driveFileId
----------------+------------        ----------------+------------
                | file-in-A          account-b      | file-in-B
 account-b      | file-in-B          (file-in-A 행이 사라졌다)
```

`file-in-A`는 **이전 계정의 드라이브에 실제로 있는 파일**의 유일한 기록이고, `''`이라 모든 연결과
매칭되는 안전망이기도 하다. 그것이 사라지면 A를 다시 연결했을 때 `hasUpload = false`가 되고,
`files.create`에 멱등 검사가 없으므로 **되돌릴 수 없는 중복**이 난다. 이 라운드가 닫은 실패
클래스와 같은 것이 회귀 경로로 열려 있는 셈이다.

**코드는 지금 옳다.** 틀린 것은 리포트 §1이 "입양을 같은 값 비교로 바꿨다"를 증명한다고 말하는
범위다 — 증명된 것은 UPDATE 절반뿐이다.

**Fix(구체).** `account-scoped ledger` describe에 한 개.

```ts
it('should not delete an unstamped row another connection wrote, even when this account already has one', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  await connect(ctx, user.id, null, CONNECTION_B);
  await ledger(ctx, user.id, asset.id, '', CONNECTION_A);   // 이전 연결이 A의 드라이브에 넣은 사본
  await ledger(ctx, user.id, asset.id, 'account-b');        // 이번 계정에 이미 올라간 사본

  await sut.adoptUnstampedUploads(user.id, 'token', 'account-b');

  const rows = await ctx.database
    .selectFrom('google_drive_upload')
    .select(['driveAccountId', 'driveFileId'])
    .where('userId', '=', user.id)
    .where('assetId', '=', asset.id)
    .execute();
  // 충돌 회피용 삭제는 *이 연결이 쓴* 행에만 허용된다. 남의 행을 지우면 그 계정의 사본이
  // 원장에서 사라지고, 재연결 시 되돌릴 수 없는 중복이 된다.
  expect(rows).toHaveLength(2);
});
```

`:189`를 지우면 이 테스트만 실패한다(위 SQL probe가 그 결과를 미리 보여준다).

### M2 (Medium) — round-21 M1의 수정이 `getStorage`에는 적용되지 않았다

**증거(변이).** `server/src/services/google-drive.service.ts:754`의
`if (this.isInvalidGrant(error))`를 `if (true)`로 바꾸면 `google-drive.service.spec.ts`가
**82/82 통과**한다. 같은 변이를 `getPickerConfig`(`:838`)에 걸면 1개가 실패한다
(`should leave the connection alone when the token mint fails for another reason`).

`getStorage`에는 긍정 테스트만 있다(`spec.ts:1025` `should report a revoked grant as disconnected…`).
그 테스트는 `if (true)`에서도 통과한다 — 분류가 아니라 "던진다 + 지운다"만 보기 때문이다.
round-21이 이 결함을 "분류를 넓히는 변이가 안 잡힌다"로 정의했는데, 수정은 두 자리 중 한 자리에만
갔다. 그리고 실질적으로 더 자주 도는 쪽은 `getStorage`다 — 설정 화면이 로드마다 부르고,
`clearRevokedGrant`는 `user_google_drive` **행 전체**를 지운다(M8과 같은 비용).

**Fix.** `getPickerConfig`에 붙은 두 번째 테스트와 대칭으로 하나.

```ts
it('should leave the connection alone when the quota read fails for another reason', async () => {
  const userId = newUuid();
  mocks.systemMetadata.get.mockResolvedValue({ googleDrive: enabledConfig });
  mocks.googleDrive.getCredentials.mockResolvedValue(connected(userId));
  driveAboutGet.mockRejectedValue(new Error('socket hang up'));

  await expect(sut.getStorage(userId)).rejects.toThrow('socket hang up');

  expect(mocks.googleDrive.deleteCredentials).not.toHaveBeenCalled();
  expect(driveAboutGet).toHaveBeenCalled();   // witness
});
```

### M3 (Medium) — 배포 런북(`CLAUDE.md`)이 폐기된 드레인 경계를 계속 설명한다

**증거.** `CLAUDE.md:416`은 `68ff15a62`가 N3을 고치며 이렇게 적었다.

> 떠나는 토큰으로 **그 연결이 붙은 뒤에 쌓인** 미상 행을 그 계정에 넘긴다(입양과 같은 경계다 —
> 그보다 오래된 행은 그 연결이 쓴 것이 아니므로 손대지 않는다).

그런데 30분 뒤 `0c47d192e`가 그 경계를 신원 등가로 바꿨고, CLAUDE.md는 그 커밋에서 손대지 않았다
(`git show 0c47d192e --stat`에 `CLAUDE.md` 없음). 두 문장의 차이는 **운영에서 정확히 문제가 되는
크기**다: 실 DB로 확인한 대로 마이그레이션 직후 원장 6,996행은 전부 `connectionId is null`이고,
`null = uuid`는 참이 아니므로 **드레인이 넘기는 행은 0개**다. "붙은 뒤에 쌓인 행"이라는 설명을
읽으면 그 6,996행 중 상당수가 넘어간다고 기대하게 된다.

결과 자체는 안전하다(받아주는 것은 `''` 안전망이다). 위험한 것은 **런북을 근거로 한 판단**이다 —
`af1639dbf`가 `feature-roadmap.md` §9.3에 이 트레이드를 정확히 적었는데, 배포할 때 실제로 읽는
문서에는 반영되지 않았다.

**Fix.** `CLAUDE.md:415-418`을 이렇게.

> 떠나는 토큰으로 **그 연결이 쓴** 미상 행을 그 계정에 넘긴다(입양과 같은 경계 —
> `connectionId` 등가 비교다). **컬럼 도입(마이그레이션 `1787200000000`) 이전에 쌓인 행은
> `connectionId`가 null이라 드레인도 입양도 영원히 가져가지 않는다** — 운영의 6,996행이 여기
> 해당하고, `''`가 모든 연결과 매칭되므로 재업로드는 나지 않는다. 배포 직후 `unstamped`가
> 줄지 않는 것이 **정상이자 기대값**이다.

같은 절의 "설정 화면을 한 번 연다 — 입양을 트리거하는 것은 getStatus" 항목도 한 마디 필요하다:
그 단계는 이제 **계정 식별(`setDriveAccountId`)에만** 의미가 있고, 입양 쪽은 기존 행에 대해
no-op이다.

### N1 (Nit) — 리포트의 테스트 요약이 자기가 첨부한 증거와 어긋난다

리포트 §"테스트 결과 (첨부)"는 `commit: 0c47d192e` / `server (unit) Tests 262 passed`라고 적었다.
그런데 같은 리포트가 가리키는 `dev-test/google-drive/results/20260905-0942.txt`의 헤더는
`commit: 68ff15a62`이고 본문은 `Tests 263 passed`다. 내가 HEAD에서 같은 8스펙을 돌린 결과도
**263**이고, `git diff 0c47d192e f64586ef2 -- server/ web/`이 비어 있으므로 두 커밋의 코드는 같다.
즉 리포트 본문의 커밋 라벨과 숫자 둘 다 틀렸다.

숫자는 결국 맞는 것을 잘못 옮긴 것뿐이라 실질 피해는 없다. 다만 **round-21 N4가 정확히 이
"증거와 커밋의 관계"에 대한 지적**이었고, 이번엔 파일을 커밋에 넣는 것으로 절반만 닫혔다.

근본 원인은 `dev-test/google-drive/run.sh:113`이 HEAD만 찍고 **작업 트리가 더러운지는 기록하지
않는** 것이다. 09:42 실행은 H1 변경이 아직 커밋되지 않은 트리에서 났고, 그래서 파일은 부모 커밋을
가리키면서 내용은 H1 코드의 것이다.

**Fix.**

```bash
echo "commit: $(git -C "$REPO_ROOT" rev-parse --short HEAD) ($(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD))$(
  [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ] && echo ' + uncommitted changes'
)"
```

### N2 (Nit) — 마이그레이션 주석이 "이 기능의 모든 경로"에 대해 거짓을 말한다

`server/src/schema/migrations/1787200000000-AddGoogleDriveConnectionId.ts:23`:

> No ledger row is ever deleted or reset here, which remains true of every path in this feature.

앞 절("here")은 참이지만 뒤 절은 거짓이다. `adoptUnstampedUploads`는
`repository.ts:185-199`에서 원장 행을 **삭제한다**(같은 자산에 이미 stamped 행이 있어 PK가
충돌할 때). 의도는 "업로드됨 상태를 잃는 삭제는 없다"일 텐데, 문장 그대로 읽으면 M1이 지적한
DELETE 분기의 존재 자체를 못 보게 만든다.

**Fix.** "…, and the only delete in this feature — the collision case in `adoptUnstampedUploads` —
removes a row only when an equivalent stamped row for the same asset already exists."

### N3 (Nit) — 재발급은 값 비교로만 고정돼 있고, 행동으로는 고정돼 있지 않다

`:94`(재링크 시 `uuid_generate_v4()`)를 지우면 실패하는 것은
`should mint a new connection identity on a re-link` **하나뿐**이고, 그 테스트는 새 값이 이전 값과
다른지만 본다. 입양 테스트는 **하나도** 실패하지 않는다. round-21 M5가 요구한 것은 "재발급이
없으면 이전 연결의 행을 상속한다"는 **행동**이었다.

지금 배치로도 커버는 된다(신원 비교 자체는 `:206` 변이로 고정돼 있다). 다만 두 조각이 서로를
가정하고 있으므로, 재발급 테스트에 세 줄만 얹어 "재링크 뒤 입양이 이전 연결의 `''` 행을 가져가지
않는다"까지 단언하면 한 테스트가 한 성질을 통째로 지킨다.

### N4 (Nit) — CI의 "마이그레이션이 실제로 적용됐는가" 단언이 가장 오래된 테이블을 묻는다

`.github/workflows/fork-google-drive.yml`의 `Check the migrations actually landed`는
`select 1 from google_drive_upload limit 1`을 던진다. 그 테이블은 `1785423600001`부터 있으므로,
**최근 마이그레이션이 빠진 DB도 이 관문을 통과**한다.

가설이 아니다 — 이 워크트리에서 그대로 겪었다. `server/dist`가 낡아 있던 상태에서
`sql-tools migrations run`이 `1787100000000`까지만 적용하고 멈췄는데(`sql-tools`는
`dist/schema/migrations`를 읽는다), `google_drive_upload`는 멀쩡히 존재했다. CI에는 앞에
`mise run //server:build`가 있어 이 경로가 재현되지는 않고, 뒤의 diff가 결국 시끄럽게 실패시키므로
**조용한 통과는 아니다**. 그래도 단언이 자기가 말하는 것을 말하게 하려면 최신 컬럼을 물으면 된다.

**Fix.** `select "connectionId" from google_drive_upload limit 0` 또는
`select 1 from kysely_migrations where name like '%AddGoogleDriveConnectionId'` — 후자는 마이그레이션이
추가될 때마다 갱신해야 하므로 전자를 권한다.

### N5 (Nit) — 리포트 §2의 M3 칸이 술어를 두 개만 센다

"834·837행을 **줄 번호로** 지워 각각 실패 확인"이라고 적었는데 M3은 술어가 셋이다
(`68ff15a62` 기준 833 = `userId` onRef, 834 = `ledgerMatches`, 837 = `asset.deletedAt`).
셋 다 지금은 각각 하나씩 실패시킨다(HEAD 기준 850/851/854에서 직접 확인). **과소 서술**이므로
실질 문제는 없고, 리뷰어가 "833은 왜 빠졌지"를 확인하는 데 든 시간만큼만 비싸다.

---

## Answers to what the report asked me to attack

### 1-a. `connectionId`가 재발급되지 않는 채로 연결이 바뀌는 경로가 있는가

**없다.** `user_google_drive`에 쓰는 문장은 넷뿐이다(`repository.ts:82` insert/upsert,
`:116` `setDriveAccountId`, `:227` `setFolderId`, `:244` `deleteCredentials`). 이 중
**연결의 정체가 바뀌는 것은 `:82`뿐**이고 거기서 항상 재발급한다. 나머지 둘은 같은 연결의 속성을
채우는 것이라 재발급하지 않는 것이 옳다 — 특히 `setDriveAccountId`가 재발급하면 그 순간
in-flight 업로드가 쓴 행이 전부 고아가 된다.

서비스 쪽 호출자도 하나뿐이다: `upsertCredentials`는 `service.ts:378`(`linkAccount`)에서만 불린다
(`grep -rn upsertCredentials src --include=*.ts` 결과). 드레인은
`adoptUnstampedUploads`만 부르고, 그것은 `user_google_drive`를 **읽고 잠글 뿐** 쓰지 않는다.
`disconnect`는 `deleteCredentials`로 행을 지우고, 다음 링크는 INSERT라 컬럼 DEFAULT
(`uuid_generate_v4()`)가 새 값을 만든다 — 실 DB에서 컬럼 정의를 확인했다.

Google이 **같은 refresh token을 다시 돌려주는** 경우도 봤다(`service.ts:338-356`이 그 가능성을
명시한다). 그러면 입양의 CAS(`where refreshToken = ?`)가 재링크를 **감지하지 못한다**. 하지만
잠금 안에서 읽는 `connectionId`는 이미 새 값이므로 옛 연결이 쓴 행은 **claim되지 않는다** —
실패 방향이 "정리 누락"이라 안전하다. 토큰이 회전해도 코드는 그것을 저장하지 않으므로
(`refresh_token`을 쓰는 곳은 `setCredentials` 넷뿐, 저장 경로 없음) 이 축에서 신원이 어긋날 일은 없다.

### 1-b. 입양이 claim해야 하는데 못 하는 경우 — `recordUpload`의 값과 잠금 안 값이 어긋나는 조합

**어긋나는 조합은 있고, 전부 안전한 방향이다.** 세 가지를 확인했다.

1. **같은 토큰 재링크** (위) — 잠금 읽기는 새 `connectionId`, 행은 옛 것 → claim 안 함.
2. **입양이 이미 끝난 뒤 착지하는 인플라이트 업로드.** gate 1에서 미식별이었던 잡은
   `uploadAccountId = ''`로 결정되어 있고, 그 뒤 다른 잡이 계정을 식별해 입양을 돌리고 나면
   이 행은 `('', C1)`로 착지하지만 입양은 다시 돌지 않는다(`adoptIfNewlyIdentified`는
   `credentials.driveAccountId`가 차 있으면 즉시 반환). 영구 미상 — 하지만 `''`이 모든 연결과
   매칭되므로 재업로드는 없다. 이건 새 결함이 아니라 **시간 경계 때도 있던 성질**이다.
3. **`recordUpload`의 onConflict가 `connectionId`를 갱신하지 않는다**(`repository.ts:697`,
   `doUpdateSet({ driveFileId })`뿐). 같은 `(userId, assetId, '')`에 두 번째 업로드가 오면 행은
   **처음 쓴 연결의 신원을 유지**한다. 이것도 안전한 방향이다 — 갱신했다면 옛 연결이 쓴 행이
   새 연결의 이름을 얻어 claim 대상이 되었을 것이다. **다만 이 성질은 우연히 옳은 것이고
   주석이 한 줄도 없다.** `driveFileId`만 갱신하는 이유를 적어 두면 다음 사람이 "왜 신원은
   안 갱신하지?"를 다시 묻지 않는다.

반대로 **claim하면 안 되는 것을 claim하는 조합은 찾지 못했다.** 이유는 구조적이다:
입양이 손대는 것은 `driveAccountId = ''`인 행뿐이고, 그 행의 `connectionId`는 gate 1에서 읽은
값이며, 두 연결이 같은 uuid v4를 가질 방법이 없다. 시간축이 사라졌으므로 round-21의 probe A/G
(인플라이트 착지, 시계 역행)는 재현 자체가 불가능하고, 그 둘은 medium 테스트로 박제돼 있다
(`should not claim an unstamped row another connection wrote, even a newer one`,
`should be unaffected by a clock that steps backwards` — `:206` 변이로 둘 다 실패시켜 확인).

### 1-c. `connectionId`를 FK로 걸지 않은 선택이 만드는 문제

**없다.** 그 값은 **역참조되지 않는다** — 저장소 전체에서 `connectionId`가 쓰이는 곳은
`getCredentials`의 select, `upsertCredentials`의 재발급, 입양의 잠금 읽기와 두 개의 등가 비교,
`recordUpload`의 insert뿐이다(`grep -n connectionId`). 조인도, "이 id의 연결을 찾아라"도 없다.
따라서 연결 행이 사라져 dangling이 되어도 비교 결과는 그대로 "이 연결이 쓴 것이 아니다"이고,
그것이 정확히 원하는 답이다. uuid v4라 재사용 충돌도 없다.

부수 효과 둘을 확인했고 둘 다 비용이 아니다.
- **인덱스 없음**: 입양 UPDATE는 `userId + driveAccountId='' + connectionId`인데 6,996행에서
  Seq Scan **0.739 ms**(EXPLAIN ANALYZE). `google_drive_upload_userId_idx`도 있다. 무시해도 된다.
- **감사 불가**: 연결이 지워지면 그 `connectionId`가 어느 계정이었는지 물을 방법이 없다.
  하지만 그건 원장이 연결보다 오래 살아야 한다는 요구의 이면이고, 계정 정보는 `driveAccountId`가
  따로 들고 있다.

### 1-d. 마이그레이션이 이미 행이 있는 DB에서 안전한가 (운영 모양)

**안전하다. 실 DB에서 그 모양을 만들어 돌렸다.** `ghcr.io/immich-app/postgres:14-vectorchord0.4.3`에
전체 마이그레이션을 `1787100000000`까지 적용하고, user 1 / asset 6,996 / `user_google_drive` 1행
(`driveAccountId` 채움) / `google_drive_upload` 6,996행(전부 `driveAccountId=''`)을 넣은 뒤
`1787200000000`을 적용했다.

```
Migration "1787200000000-AddGoogleDriveConnectionId" succeeded     real 0m0.897s
user_google_drive.connectionId : uuid  not null  default uuid_generate_v4()   (값 1개, non-null)
google_drive_upload            : ledger 6996 | with_conn 0 | unstamped 6996
```

세부 확인:
- `uuid_generate_v4()`는 `uuid-ossp`가 필요한데 `1744910873969-InitialMigration.ts:27`이
  `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`를 하고 `schema/index.ts:96`의 `@Extensions`에도 있다.
  업스트림 마이그레이션들이 이미 같은 함수를 쓴다(`1762297277677`, `1777415973792`). 문제 없다.
- `NOT NULL DEFAULT uuid_generate_v4()`는 **volatile** 기본값이라 PostgreSQL이 테이블을 재작성한다.
  `user_google_drive`는 1행이므로 무의미하다. 원장 쪽은 nullable + default 없음이라 메타데이터
  변경만이고, 6,996행에서 체감되지 않았다.
- `sql-tools migrations generate` → **No changes detected**, `mise //:sql` 재생성 후
  `git status --porcelain -- server/src/queries` 비어 있음. 스키마 데코레이터와 마이그레이션이
  어긋나지 않는다.
- **롤백 안전성**도 확인해 둘 만하다: Wave 5 이미지로 되돌려도 `down()`은 돌지 않으므로 컬럼은
  남고, 옛 코드의 select 목록에는 `connectionId`가 없으며 insert는 그 컬럼을 생략해 null이 된다.
  옛 입양(`uploadedAt >= connectedAt`)이 다시 도는 것뿐이라 데이터가 깨지지 않는다.

### 1-e. 옵션 A("연결이 움직였으면 원장을 안 쓴다")가 더 나쁜 거래였다는 주장

**주장은 성립한다.** 두 선택이 남기는 상태를 끝까지 따라가면 이렇게 갈린다.

| | 채택안 (신원 도장) | 옵션 A (기록 거부) |
|---|---|---|
| A의 드라이브에 있는 파일 | `('', C1)`로 기록됨 | **기록 없음** |
| B가 그 자산을 보는 방식 | "업로드됨"(`''`이 모든 연결과 매칭) → B는 그 파일을 못 받는다 | "미업로드" → 재큐잉되어 B로 올라간다 |
| A를 재연결했을 때 | `hasUpload = true` → 재업로드 없음 | `hasUpload = false` → **A에 중복** |
| 되돌릴 수 있는가 | 있다 — `appProperties.immichAssetId`로 조정 가능 | **없다** — `files.create`에 멱등성 없음 |

핵심은 옵션 A가 손해를 **없애는 것이 아니라 비대칭적으로 옮긴다**는 것이다. 옵션 A는 "B가 파일을
못 받는다"를 고치는 대신 "A에 되돌릴 수 없는 중복"을 만든다. 이 기능이 처음부터 지켜 온 우선순위
(중복 > 누락, 되돌릴 수 없음 > 되돌릴 수 있음)에 비추면 채택안이 맞다.

**다만 리포트의 서술 한 군데는 정확하지 않다.** "옵션 A는 더 큰 손해를 **남긴다**(leaves)"가 아니라
**만든다**(creates)가 맞다 — 지금 코드에서 그 고아 상태는 존재하지 않고, 옵션 A를 택해야 생긴다.
그리고 채택안이 남기는 "B가 파일을 못 받는다"는 **조용하다** — 사용자에게도 로그에도 신호가 없다.
`feature-roadmap.md` §9.3이 조정(reconciliation)을 갚는 방법으로 적어 둔 것은 옳고, 여기에
"그때까지 이 누락은 관측되지 않는다"를 한 줄 더 붙이면 다음 사람이 놀라지 않는다.

세 번째 선택지도 확인해 두었다: **`''` 버킷 자체를 없애는 것**(연결이 미식별이면 업로드를 아예
하지 않는다). 그러면 모든 원장 행이 정확한 계정을 갖지만, 프로브가 실패하는 동안 백업이 통째로
멈춘다 — 신원 프로브를 best-effort로 둔 결정(`service.ts:520` 부근 주석)과 정면으로 충돌한다.
지금 선택이 맞다.

### 2. round-21 지적 반영 — 표의 "확인 방법"을 다시 돌려 봤다

| 지적 | 리포트 주장 | 내가 확인한 것 |
|---|---|---|
| M1 picker 취소 처리 | `if (true)` 변이가 두 번째를 실패시킴 | **재현**(`service.ts:838`, 1 failed). 단 같은 결함이 `getStorage`에 남았다 → **M2** |
| M2 `firstOfClass` | 제거 변이 → 그 테스트만 실패 | **재현**(`:760` → `and true`, `should not report the same class as first again on a plain retry` 1 failed). 리포트가 인정한 과장도 사실 확인 |
| M3 `getErrorSummary` 술어 3개 | 834·837을 줄 번호로 지워 각각 실패 | **재현, 그리고 3개 전부**(850/851/854 각각 1 failed). 리포트는 두 개만 셌다 → **N5** |
| M4 `recordUpload` 삭제 범위 | 필터 제거 → 실패 | **재현**(`:702`, 1 failed) |
| M5 재링크 신원 재발급 | 재발급 제거 → 실패 | **재현**(`:94`, 1 failed). 다만 값 비교뿐 → **N3** |
| M6 준비 대기 | `pg_isready -h 127.0.0.1` | **재현**(socket→TCP 격차 0.332 s 실측). 수정이 실효 |
| M7 untracked | `git status --porcelain` | **재현**(`git diff`는 CLEAN, `status`는 `??`). 수정이 실효 |
| M8 | 코드 수정 없음, 런북에 명시 | CLAUDE.md:420-423에 있음 확인 |
| N1 프로브 잔여 구간 | 주석 정정 | 문구 확인. 라이브러리 재확인은 안 했다(round-21에서 이미 함) |
| N2 `others` 필터 | 단독 실행해도 실패 | **재현**(`-t`로 그 테스트만 실행, 1 failed) — 잔여 행 의존 해소 |
| N3 CLAUDE.md 드레인 범위 | 경계와 같은 범위로 한정 | 수정은 됐으나 **H1이 그 경계를 다시 바꿨다** → **M3** |
| N4 증거 동봉 | 리포트 커밋에 동봉 | 동봉은 맞으나 **라벨·숫자가 어긋난다** → **N1** |

**"통과하면서도 틀릴 수 있는 조합"은 하나 남았다: M1.** M3의 세 술어는 각각 픽스처 하나에만
기대지만, 그 픽스처들은 술어를 정확히 겨냥한다 — 다른 계정 원장 행, 다른 사용자 원장 행, 휴지통
자산. 셋을 조합해 "통과하는데 SQL이 틀린" 상태는 만들지 못했다(각 술어를 `true`로 밀면 정확히
대응하는 테스트 하나가 죽는다). 대신 새로 생긴 술어 쌍(입양의 DELETE/UPDATE)에서 절반이
비어 있었고, 그것이 M1이다. **같은 뿌리다** — 픽스처가 한 축(여기서는 "다른 연결이 쓴 행"과
"이 계정에 이미 있는 행"의 조합)을 만들지 않으면 술어가 공허해진다.

### 3. P1 테스트는 주장하는 이유로 통과하는가

**둘 다 그렇다.**

- **백업 중 연결 끊김**: `service.ts:1216`의 `streamInfo.stream.destroy()`를 지우면 그 테스트만
  실패한다(1 failed / 81 passed). 즉 fd 누수 방어가 실제로 관문이다. `recordUpload` 미호출과
  `notification.create` 미호출이라는 **부정 단언**도 공허하지 않다 —
  `upsertError`가 `firstOfClass: true`를 돌려주도록 픽스처가 잡혀 있으므로 "알림을 안 보낸다"는
  Unknown 클래스가 알림 대상이 아니라는 **분류**를 실제로 고정한다. `service.ts:1166`의
  `isInvalidGrant`를 `if (true)`로 밀면 이 테스트가 같이 죽는 것으로 경로가 거기까지 도달함도 확인했다.
- **수동 백업 중 자동 토글 ON(순서)**: `subscribeAlbum`의 `subscribe` 호출을
  `queueGoogleDriveUploads` **뒤로** 옮기면 그 테스트만 실패한다. 그리고 **큐잉 자체를 없애면**
  `expected value must be number or bigint, received "undefined"`로 죽는다 — 즉
  `invocationCallOrder`가 비는 공허한 통과 경로가 없다. 이 두 방향을 다 확인했으므로
  "순서를 단언한다"는 주장은 성립한다.

### 4. §5 — 지금 배포해도 되는가, 신원 컬럼이 새 위험을 만들었는가

**된다. 신원 컬럼은 새 위험을 만들지 않았고, round-21의 배포 판정은 유지된다.** 근거는 위
1-d(마이그레이션 실측)와 다음 셋이다.

1. **배포 자체가 아무것도 재업로드하지 않는다.** 6,996행이 `connectionId is null`로 남고
   `driveAccountId=''`가 그대로이므로 `hasUpload`는 계속 참이다. 실 DB에서 확인했다.
2. **되돌릴 수 없는 손해의 경로가 하나 줄었다.** round-21이 재현한 오귀속(H1)은 이제 SQL 수준에서
   불가능하다.
3. **롤백도 안전하다**(1-d 마지막 항목).

**대신 배포 전에 두 가지를 권한다.**

- **M3을 먼저 고친다(문서 3줄).** 배포 직후 사장님이 실제로 볼 숫자가
  `unstamped = 6996 (그대로)`인데, 지금 런북은 드레인이 그 행들을 넘긴다고 읽힌다.
  숫자가 안 움직이는 것을 **고장으로 오해할 여지**가 있고, 그때 "연결을 지웠다 다시 붙여 보자"는
  판단이 나오면 §7이 경고하는 바로 그 조작이다(결과는 여전히 안전하지만, 근거 없는 조작을
  런북이 유도해서는 안 된다).
- **M1은 코드 수정이 아니라 테스트 하나이므로 배포와 병행해도 된다.** 다만 다음 라운드로 미루지
  말 것 — `connectionId` 등가 비교를 손보는 사람이 두 문장을 함께 볼 이유가 지금은 주석뿐이다.

M2는 배포와 무관하다(테스트 보강). N1~N5도 마찬가지다.

**`refreshToken` nullable 마이그레이션(M8의 근본 해법)은 배포 *뒤*로 미루라고 권한다.**
가치는 인정한다 — Testing 모드에서 주 1회 폴더를 다시 고르는 것은 실제 비용이고, `(c) 문서화`는
증상만 가린다. 그러나 지금 넣으면 **이번 라운드가 막 바꾼 코드와 검증되지 않은 방식으로 맞물린다.**
구체적으로 셋이다.

1. **입양의 CAS가 토큰 등가에 걸려 있다**(`repository.ts:161-163`,
   `where refreshToken = ?` + `forUpdate()`). `refreshToken`이 null이 될 수 있으면
   `= null`은 절대 참이 아니므로 그 경로는 조용히 `false`로 물러난다. 안전한 방향이긴 하나,
   "왜 입양이 안 도는가"를 다음 사람이 다시 추적하게 된다.
2. **연결 행의 존재가 "연결됨"을 뜻한다고 가정하는 조인이 최소 셋 있다** —
   `getSubscribers`(`repository.ts:275`), `streamPendingUploads`, `getSubscribableAlbums`가
   `innerJoin('user_google_drive', …)`만 하고 `refreshToken`을 보지 않는다. 토큰이 null인 채로
   행이 살아남으면 **취소된 사용자에게 계속 잡이 큐잉되어** 매번 실패하고 에러 행을 쌓는다.
   세 쿼리 모두에 술어를 더해야 하고, 그건 medium 테스트가 붙어 있는 SQL이다.
3. **이번 배포의 관문이 아니다.** M8은 UX 비용이지 데이터 안전 문제가 아니고, 되돌릴 수 없는
   손해(중복)와는 무관하다.

권하는 순서: **이번 배포 → 운영에서 `drive_account`가 하나뿐이고 안 바뀌는지 확인 → 그 다음
라운드에서 `refreshToken` nullable을 위 (1)(2)와 함께 설계.** 그때 (2)의 세 쿼리에 대한 medium
테스트를 먼저 쓰는 것이 순서상 맞다.

**UI `stalled` 상태**는 round-21의 판정("관측 품질 문제이지 데이터 안전 문제가 아니다")에
**동의한다.** 이번 변경은 그 판단을 바꾸지 않았다 — 오히려 되돌릴 수 없는 쪽(오귀속)이 하나 더
닫혔으므로 관측 공백의 최악은 여전히 "안 올라간다"이다.

---

## What I did not verify

- **웹 유닛 39개와 svelte-check 베이스라인 게이트.** 이번 다섯 커밋은 `web/`을 건드리지 않았고
  (`git show --stat`) CI의 web 잡이 통과했으므로 돌리지 않았다.
- **CI 잡 로그 본문.** GitHub API가 인증 없이는 로그에 403을 준다. 스텝별 결론(전부 success)과
  애노테이션(warning 4건, 전부 mise-action Node 20)까지만 확인했다. `Start Postgres`가 러너에서
  몇 초 걸렸는지, `Regenerate`가 러너에서 몇 쿼리를 썼는지는 보지 못했다 — M6은 **같은 이미지로
  내 기계에서** 재현한 것이다.
- **CI 아티팩트(`google-drive-evidence`)의 내용.** 다운로드에 인증이 필요해 열지 못했다.
  N1의 판정은 저장소에 커밋된 `20260905-0942.txt`와 내가 직접 돌린 수치만 근거로 했다.
- **`FOR UPDATE` 잠금의 동시성 재현.** round-21에서 probe E/F로 확인했고 잠금 문장은 이번에
  select 컬럼만 바뀌었으므로(`connectedAt` → `connectionId`, WHERE는 동일) 다시 돌리지 않았다.
  데드락 사이클도 재조사하지 않았다.
- **`retry: false`와 OAuth 갱신 다리의 재시도 횟수.** round-21에서 소스로 판정했고 이번 변경과
  무관하다.
- **실제 구글 5xx / `invalid_grant` 응답 형태.** `isInvalidGrant`의 좁음은 코드 독해로만 판정했다.
- **운영 DB.** 어떤 조회도 하지 않았다. 6,996행·연결 1개라는 모양은 CLAUDE.md §7의 기술을 그대로
  실 DB에 재현한 것이지 운영 데이터를 본 것이 아니다.
- **e2e·모바일·SDK 생성물.** 이번 변경은 DTO·컨트롤러·enum을 건드리지 않았고
  (`grep -rn connectionId src/dtos src/controllers`가 비어 있다) 커밋에도 생성물 변경이 없다.
  `mise //:open-api`는 돌리지 않았다.
- **M1이 재현하는 상태가 운영에서 얼마나 자주 생기는가.** SQL 수준의 손해는 실 DB로 보였지만,
  "`('', C1)`과 `('account-b', C2)`가 같은 자산에 공존하는" 상태에 이르는 확률은 측정하지 않았다.

---

## Feeding back into the plan

`dev-docs/google-drive/feature-roadmap.md` §9(이번에 잘 쓰였다)에 얹을 것.

1. **§9에 "입양은 문장이 둘"이라고 못박는다.** `DELETE`(PK 충돌 회피)와 `UPDATE`(도장 찍기)는
   같은 불변식을 걸어야 하고, 지금 테스트는 UPDATE만 지킨다(M1). 다음에 이 블록을 손보는 사람이
   한쪽만 고치지 않도록.
2. **medium 픽스처 기본형에 축을 하나 더 넣는다.** round-21이 "두 번째 사용자 + 다른 계정 원장 행"을
   넣게 했고 그건 효과가 있었다(M3/M4/N2가 전부 닫혔다). 이번에 비어 있던 축은
   **"다른 연결이 쓴 `''` 행 + 이 계정에 이미 있는 stamped 행"**이다. 이 조합을 `connect`/`ledger`
   헬퍼 옆에 표준 픽스처로 두면 M1 같은 구멍이 다시 생기지 않는다.
3. **"결함 클래스는 자리마다 세어라."** round-21 M1(`invalid_grant` 분기에 부정 테스트 없음)은
   `getPickerConfig`에서 발견됐지만 클래스로는 `getStorage`·업로드 경로에도 있었다. 리뷰 지적을
   반영할 때 **그 결함이 몇 자리에 있는지 먼저 세는** 절차를 §9.5에 한 줄로 넣는다.
4. **경계를 바꾸면 CLAUDE.md §7 런북을 같은 커밋에서 고친다.** 이번엔 `68ff15a62`가 런북을 고치고
   `0c47d192e`가 30분 뒤 그 전제를 바꿨다(M3). 런북은 배포할 때 실제로 읽는 유일한 문서다.
5. **증거 파일은 트리의 더러움까지 기록한다**(N1, `run.sh:113`). "어느 커밋에서 돌렸나"보다
   "돌린 트리가 그 커밋과 같은가"가 리뷰어에게 필요한 정보다.
6. **`recordUpload`의 onConflict가 `connectionId`를 갱신하지 않는 이유를 코드에 적는다**
   (1-b 3번). 지금은 우연히 옳은 것처럼 보이고, "일관성을 위해" 갱신을 추가하는 리팩터가
   오귀속을 되살린다.

---

## 워크트리 상태

모든 변이는 원본 사본(`gdr.orig.ts`, `gds.orig.ts`)에서 복원했고, 임시 `.sql` 파일과
postgres 컨테이너(`gd-rev22-pg`)는 제거했다. `mise run //:sql`로 재생성한
`server/src/queries`는 커밋본과 바이트 단위로 같아 변경이 남지 않았다(`server/dist`는
`.gitignore` 대상). 마지막 `git status --porcelain` 결과는 **이 리뷰 파일 하나뿐**이다.
작성자 트리 `/home/gwyun/workspace/immich`에는 읽기도 쓰기도 하지 않았다.
