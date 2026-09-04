# Code Review — 입양(adoption) 수정 4건 + 첫 blocking CI 실행

|                  |                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch / HEAD    | `feat/google-drive-album-sync-v3.1.0` / `202ce87d1`                                                                                                           |
| Commits reviewed | `8f22e65df`(C1/C2/N1), `7a2b68f9b`(C3 관측화), `1d1ce48ab`(나머지 N), `fe9fe4fed`(medium 하네스)                                                              |
| Report           | `../report/google-drive-adoption-fixes-20260904-0924-report.md`                                                                                               |
| Prior review     | `google-drive-account-scoped-ledger-20260904-0728-review.md`                                                                                                  |
| Reviewed         | 2026-09-04                                                                                                                                                    |
| 작업 환경        | 격리 워크트리 `git worktree add --detach /tmp/gd-review-$$ 202ce87d1` — 모든 변이 실험·테스트를 그 안에서만 수행하고 `git worktree remove --force`로 제거했다 |

## Verdict

**코드 쪽은 진짜로 고쳐졌다.** 직전 라운드의 C1·C2·N1은 내가 직접 되돌려 보고 확인했다 — C1을
재도입하면 정확히 1개, 거기에 `getStatus` 훅까지 빼면 정확히 2개가 실패하고, N1의 좁은 setter를
`upsertCredentials`로 되돌려도 1개가 실패한다. 리포트의 숫자(248/39/20, medium 418/424, CI 3잡
success)도 전부 내 손으로 재현했다. **그런데 이번 라운드의 가장 중요한 결함은 코드가 아니라 다시
한 번 절차와 증거 쪽에 있다.** 두 가지다. (1) **직전 리뷰 C2의 실패 유형이 그대로 반복됐다** —
C2를 닫으면서 다시 쓴 `CLAUDE.md:385-390`의 게이트 명령은 **셸 인용이 깨져서 실행되지 않는다.**
psql이 실제로 받는 문자열은 `… = '\`(개행)`group by 1, 2;`이고, 실제 Postgres에 먹여 보면
`ERROR: unterminated quoted string`이다. 운영자가 배포 후 유일하게 확인하도록 지시받은 명령이
에러를 뱉는다. (2) **"두 번 초록이었으니 blocking으로 승격한다"는 근거가 사실이 아니었다** —
run `33715025550`·`33758496224`의 medium 잡은 둘 다 **실제로 빨간불**이었고
(`continue-on-error`가 REST의 `conclusion`을 `success`로 만든다), GitHub 애노테이션에
`the medium suite failed; it is non-blocking for now`와 문제의 3개 실패가 그대로 남아 있다.
직전 리뷰가 "step 단위로 봐도 실패가 없다"고 적은 것도 **틀렸다**(내 실수이기도 하니 여기서
정정한다). 즉 `fe9fe4fed`가 고친 결함은 "CI가 처음 잡아낸 것"이 아니라 **CI가 두 번 말했는데
아무도 읽지 않은 것**이다.

설계 축에서 새로 지적할 것이 하나 있다. **`getStatus`에 훅을 단 것이 C3의 발화 시점을
"언젠가"에서 "링크 직후 다음 렌더"로 당겼다.** OAuth 콜백은 설정 화면으로 리다이렉트하고, 그
화면은 `onMount`에서 곧바로 `getStatus`를 부른다. 링크 시 프로브가 일시적으로 실패한 계정이
1초 뒤 성공하면 그 즉시 남의 6,996행에 도장이 찍힌다. C3를 유지하기로 한 판단 자체에는
동의하지만, **이 커밋이 C3를 더 잘 터지게 만들었다는 사실은 리포트에 없다.**

### Evidence I ran myself

| Check                                                                            | Result                                                                                                                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 서버 유닛 8스펙 (`run.sh`의 `SERVER_SPECS`), HEAD `202ce87d1`                    | `Test Files 8 passed / Tests 248 passed` — 리포트와 일치                                                                                                |
| 웹 유닛 4스펙                                                                    | `Tests 39 passed` — 일치                                                                                                                                |
| medium `google-drive.repository.spec.ts` (testcontainer, 전 마이그레이션 적용)   | `Tests 20 passed`, `AddGoogleDriveUploadAccountId succeeded`                                                                                            |
| **medium 전체** (`vitest --config test/vitest.config.medium.mjs`)                | `418 passed / 424`, 실패 6건은 전부 `exif/*` (test-assets 서브모듈 미초기화) — 리포트대로                                                               |
| **비공허 E1**: `recordUpload` 인자를 `credentials.driveAccountId ?? ''`로 되돌림 | `1 failed                                                                                                                                               | 66 passed` — 실패한 것은 정확히 "should record an upload that triggered adoption…" |
| **비공허 E2**: E1 + `getStatus`의 입양 훅 제거                                   | `2 failed                                                                                                                                               | 65 passed` — **리포트의 "정확히 그 2개"와 완전 일치**                              |
| **비공허 E3**: `getDriveAccountId`/`adoptIfNewlyIdentified`의 warn 2개 제거      | `1 failed` — "should still record under the empty bucket…" (로그 단언이 비공허함)                                                                       |
| **비공허 E4**: `setDriveAccountId` → `upsertCredentials`로 되돌림(N1 회귀)       | `1 failed` — "should identify the account and adopt its rows…" (N1도 핀되어 있다)                                                                       |
| **하네스 결함 재현**: `SystemMetadataRepository` 제거 후 workflow medium 스펙    | `3 failed                                                                                                                                               | 16 passed`, 메시지 `Cannot read properties of undefined (reading 'get')` — 일치    |
| **하네스 결함의 기원**: 같은 스펙을 `6bfd4708a`에서 실행                         | `3 failed                                                                                                                                               | 16 passed` — **이번 세션 이전에 이미 빨간불**                                      |
| 같은 스펙을 `b7d21efce`(2026-08-14)에서 실행                                     | 같은 3개 실패, 같은 `(reading 'get')`                                                                                                                   |
| 같은 스펙을 `b6ef3b39c`(2026-08-12, v3.1.0 머지)에서 실행                        | 같은 3개 실패, 단 메시지는 `(reading 'getUploadedAssetIds')` — **결함은 머지 시점부터다**                                                               |
| `git log 6bfd4708a..HEAD -- server/src/services/album.service.ts`                | 0 커밋 — 리포트 주장 사실                                                                                                                               |
| **게이트 명령 실행**: `CLAUDE.md`의 명령을 두 겹 셸(로컬+원격)로 에뮬레이트      | psql이 받는 SQL이 `… = '\`(개행)`group by 1, 2;` — **문자열 리터럴 미종료**                                                                             |
| 그 SQL을 실제 Postgres(`ghcr.io/immich-app/postgres:14`)에 투입                  | `ERROR: unterminated quoted string at or near "'\ …"` — **명령이 동작하지 않는다**                                                                      |
| 의도한 쿼리(`= ''`)를 같은 DB에서 실행                                           | 정상. `count(g.*)` 관용구도 의도대로(미연결 매칭 시 0) — **쿼리 자체는 맞다, 인용만 깨졌다**                                                            |
| `npx tsc --noEmit` (server)                                                      | rc=0                                                                                                                                                    |
| CI run `33818957172` (`fe9fe4fed`) 잡·스텝 전수                                  | 3잡 all success, 실패 step 0 — 리포트대로                                                                                                               |
| CI run `33818014039` (`7a2b68f9b`)                                               | `Full sweep` / `Medium` 두 잡 failure — 리포트대로                                                                                                      |
| **CI run `33715025550`·`33758496224` 애노테이션**                                | 둘 다 `the medium suite failed; it is non-blocking for now` + `AssertionError: expected 'failed' to be undefined` ×3 — **"두 번 초록"은 사실이 아니다** |
| `recordUpload` / `adoptUnstampedUploads` / `setDriveAccountId` 호출 지점 전수    | 각각 1곳(`:1001`) / 1곳(`:425`) / 1곳(`:424`) — C1 수정이 모든 기록 경로를 덮는다                                                                       |
| 워크트리·메인 `git status --porcelain`                                           | 워크트리 clean 후 제거, 메인은 이 리뷰 파일 외 변경 없음                                                                                                |

---

## Findings

### C1 — 새로 쓴 배포 게이트 명령이 실행되지 않는다. 직전 라운드 C2와 **같은 유형의 실패** (Critical, 문서)

`CLAUDE.md:385-390`:

```bash
ssh 랩탑 "docker exec immich_postgres psql -U postgres -d immich -c '
  …
  left join google_drive_upload g on g.\"userId\" = u.\"userId\" and g.\"driveAccountId\" = '\''\''
  group by 1, 2;'"
```

`'\''\''`는 원격 셸에서 `''`(빈 SQL 문자열)이 되도록 의도한 것이지만, 여기서는 **바깥 작은따옴표가
이미 열려 있는 상태**라 그렇게 되지 않는다. 두 겹(로컬 → sshd → 원격 셸)을 그대로 에뮬레이트해
psql이 받는 인자를 찍어 보면:

```
    left join google_drive_upload g on g."userId" = u."userId" and g."driveAccountId" = '\
    group by 1, 2;
```

`'` 뒤에 백슬래시와 개행이 오고 문자열이 **끝나지 않는다.** 실제 Postgres에 먹이면:

```
ERROR:  unterminated quoted string at or near "'\
    group by 1, 2;"
```

쿼리 자체는 맞다 — `= ''`로 고쳐서 같은 DB에 넣으니 미식별 사용자 2행 / 식별된 사용자 0행으로
의도대로 나온다. **깨진 것은 인용뿐이고, 그래서 더 나쁘다**: 직전 리뷰 C1/C2를 닫는 커밋에서
운영자가 유일하게 실행하도록 지시받은 검증 명령이 에러를 뱉고, 그 다음 행동이 "쿼리가 이상하네,
그냥 진행하자"가 되면 그것이 곧 6,996개 중복 업로드다.

**Fix (인용 지옥을 없애는 쪽으로)**:

```bash
ssh 랩탑 "docker exec -i immich_postgres psql -U postgres -d immich" <<'SQL'
select u."userId", u."driveAccountId" is null as unidentified, count(g.*) as unstamped
from user_google_drive u
left join google_drive_upload g on g."userId" = u."userId" and g."driveAccountId" = ''
group by 1, 2;
SQL
```

(`docker exec`에 `-i`가 필요하다. 굳이 한 줄로 유지하고 싶으면 `= ''` 대신
`length(g."driveAccountId") = 0`을 쓰면 따옴표가 아예 사라진다.) **그리고 이번에는 붙여넣어
한 번 돌린 출력을 증거로 남기는 것을 권한다** — 이 명령은 두 라운드 연속으로 "적혀 있지만 돌지
않는" 상태였다.

---

### C2 — blocking 승격의 근거였던 "두 번 초록"이 사실이 아니다. medium은 이미 두 번 빨간불이었고 `continue-on-error`가 그것을 API에서 지웠다 (High, 프로세스)

`cd727214b`가 `continue-on-error`를 떼면서 남긴 근거는 _"Blocking as of runs 33715025550 and
33758496224, both green"_ 이다. 확인해 보면:

- 나는 `6bfd4708a`(= run `33758496224`의 head)에서 `workflow-core-plugin.spec.ts`를 직접 돌려
  **`3 failed | 16 passed`** 를 재현했다. 이 스펙은 서브모듈도 네트워크도 쓰지 않으므로
  CI에서 통과했을 리가 없다.
- 그런데 REST `/jobs`는 그 run의 `server — medium tests` step을 `conclusion: success`로 보고한다.
  `continue-on-error: true`가 붙은 step은 `outcome`이 failure여도 `conclusion`이 success가 되고,
  **REST는 `outcome`을 노출하지 않는다.** 워크플로 자신도 이 사실을 알고 있었다 —
  요약 step이 `${{ steps.medium.outcome }}`을 읽는다(`6bfd4708a:.github/workflows/fork-google-drive.yml`).
- 결정적 증거: 두 run의 check-run 애노테이션에 그대로 남아 있다.
  `the medium suite failed; it is non-blocking for now`, `Process completed with exit code 1.`,
  그리고 run `33715025550`에는 `AssertionError: expected 'failed' to be undefined` **3건**
  (= 바로 그 assetAddToAlbums 3개).

따라서 리포트 3절의 서사 — _"승격 후 첫 실행이 medium에서 빨간불이 났다 … 아무도 못 본 이유는 이
포크가 `//server:ci-medium`을 한 번도 돌린 적이 없어서다"_ — 는 사실이 아니다. **두 번 돌았고, 두
번 다 실패했고, 워크플로가 경고까지 띄웠다.** 못 본 이유는 실행하지 않아서가 아니라
**non-blocking 잡의 요약을 읽지 않아서**다. (직전 리뷰가 "step 단위로 확인해도 실패한 step이
하나도 없다"고 쓴 것도 같은 함정에 빠진 것이다. 여기서 정정한다.)

sweep 잡은 두 run 모두 애노테이션 0으로 **진짜 초록**이었다. 승격 근거가 반만 사실이었던 셈이다.

**Fix**: (a) `cd727214b`와 이 리포트의 서술을 정정한다 — "두 번 초록"이 아니라 "두 번 실패했고
경고를 읽지 못했다". (b) 앞으로 `continue-on-error` step을 검증할 때는 REST `conclusion`이 아니라
**애노테이션 또는 `$GITHUB_STEP_SUMMARY`** 를 본다. 이 한 줄을 리뷰 체크리스트에 넣는 것이
이번 라운드에서 가장 값싼 개선이다.

---

### H1 — 입양 setter가 refreshToken을 확인하지 않는다: in-flight 프로브와 재링크가 겹치면 연결이 **영구히 남의 계정 id를 달고** 산다 (High)

직전 리뷰 N1의 Fix는 `where "userId" = $1 and "driveAccountId" is null **and "refreshToken" = $3**`
였다. 구현된 것은 앞의 둘뿐이다:

```ts
// server/src/repositories/google-drive.repository.ts:85-92
setDriveAccountId(userId: string, driveAccountId: string) {
  return this.db.updateTable('user_google_drive').set({ driveAccountId })
    .where('userId', '=', userId)
    .where('driveAccountId', 'is', null)
    .execute();
}
```

refreshToken을 덮어쓰지 않게 된 것은 맞고, 그것만으로 lost-update의 절반은 사라졌다. 남는 절반:

1. `getStatus`가 credentials `{token: T_A, driveAccountId: null}`을 읽고 프로브를 시작한다.
2. 그 사이 사용자가 계정 B로 재링크한다. **B의 링크 시 프로브가 실패**하면
   `upsertCredentials(userId, T_B, null)` → 행은 `{T_B, null}`.
3. 1의 프로브가 A를 돌려준다. `driveAccountId is null`이 **여전히 참**이므로 `setDriveAccountId`가
   성공해 행은 `{T_B, 'A'}` — **B의 토큰을 든 연결이 자기를 A라고 말한다.**
   이어서 `adoptUnstampedUploads(userId, 'A')`가 `''` 행 전부를 A로 찍는다.
4. 이후 업로드는 실제로는 **B의 Drive**로 가는데 원장에는 **A**로 기록되고, `hasUpload`는 A로
   비교하므로 A에 올라갔던 자산은 B에 영원히 올라가지 않는다. `driveAccountId`가 더는 null이
   아니므로 **다시는 프로브가 돌지 않아 자가 복구도 없다.**

`setDriveAccountId`가 0행을 갱신했을 때 `adoptUnstampedUploads`를 취소하지 않는 것도 같은
Fix에 포함돼 있었는데(직전 리뷰 N1: _"영향 행이 0이면 원장 도장도 찍지 않는다"_) 반영되지 않았다.
다만 그 경로(B의 프로브가 **성공**한 경우)는 `''` 행을 A로 찍는 것이 의미상 옳으므로 무해하다 —
문제는 3번뿐이다.

**Fix**: `.where('refreshToken', '=', refreshToken)`을 추가하고 시그니처를
`setDriveAccountId(userId, refreshToken, driveAccountId)`로 넓힌다. `numUpdatedRows === 0n`이면
`adoptUnstampedUploads`를 건너뛰고 warn 한 줄을 남긴다(그 로그가 곧 "재링크와 경합했다"의 신호다).

---

### H2 — `getStatus`가 타임아웃 없는 Google 왕복 + 무제한 DB 쓰기를 하는 GET이 됐고, **설정 화면만 부르는 엔드포인트가 아니다** (High — 요청 2번에 대한 답)

`google-drive.service.ts:528-533`의 주석은 _"the settings page calls this endpoint on load … Costs
one probe, and only while the id is still unknown"_ 이라고 적는다. 두 문장 다 부정확하다.

- **부르는 곳이 둘이다.** 설정 화면(`GoogleDriveSettings.svelte:72`, `onMount`)과
  **앨범 페이지의 Drive 메뉴**(`albums/[albumId=id]/…/+page.svelte:377`, `loadGoogleDriveMenu`의
  `Promise.allSettled` 안). 후자는 메뉴를 **열 때마다** 돈다. `getStorage`에는 60초 캐시가 있어
  프로브가 분당 1회로 묶이지만(`:602-605`), `getStatus`에는 캐시가 없으므로 **메뉴 토글 한 번 =
  `about.get` 한 번**이다.
- **`Costs one probe`가 아니다.** 조건은 `credentials?.driveAccountId === null`이고, 프로브가
  구조적으로 null을 돌려주는 배포(= `drive.file` 스코프에서 `about.get`이 `user`를 채우지 않는
  경우, **여전히 미검증**)에서는 영원히 참이다. 같은 과장이 `uploadAsset` 쪽 주석에서는
  `1d1ce48ab`가 고쳤는데(`:793-798`) 여기는 그대로 남았다.
- **타임아웃이 없다.** `googleapis` 호출 어디에도 timeout 설정이 없다(`grep timeout`
  → `google-drive.service.ts` 0건). 예외는 `getDriveAccountId`가 삼키지만 **hang은 예외가
  아니다.** 즉 이 커밋 이후 `GET /google-drive/status`는 **Google이 응답하지 않으면 같이 멈춘다**
  — 그리고 그 화면이 Disconnect 버튼이 있는 화면이다. 이전에는 순수 DB 읽기였다.
- 부수적으로, 이 GET은 이제 **쓰기**를 한다. 랩탑 기준 첫 로드에서 `adoptUnstampedUploads`가
  6,996행에 대한 delete+update 트랜잭션을 HTTP 요청 안에서 돈다. 7천 행이면 순간이지만 상한이
  코드 어디에도 없다.

**그래서 받아들일 만한가**: 훅을 `getStatus`로 옮긴 것 자체는 **맞다**(그것이 C2의 유일한 해법이다).
필요한 것은 가드다.

**가드는 무엇을 키로 잡아야 하나 — `userId` + 마지막 프로브 시각.** `refreshToken`이나
`driveAccountId`는 실패 상태에서 변하지 않으므로 키가 될 수 없다. 구체적으로:

```ts
// storageCache와 같은 모양, 같은 이유
private probeCooldown = new Map<string, number>();
private static readonly PROBE_COOLDOWN_MS = 5 * 60_000;
```

세 호출 지점(`getStatus:532`, `getStorage:634`, `uploadAsset:799`)이 공유한다. 프로세스 로컬이라
워커와 API가 각자 5분에 한 번씩 시도하지만, 그것으로 "매 메뉴 토글마다"와 "매 잡마다"가 모두
사라진다. **더 강한 안(권장)**: `uploadAsset`에서는 프로브를 아예 뺀다. 그러면 최악의 비용이
사람이 화면을 여는 빈도로 상한되고, 직전 리뷰 N4가 지적한 "7,000건 백로그 = 7,000번의 `about.get`"이
구조적으로 불가능해진다. 입양은 사람이 여는 두 경로만으로 충분하다 — 그게 C2의 결론이었다.
추가로 `about.get`에 `timeout`(예: 10s)을 주면 설정 화면이 Google과 함께 멈추는 일은 없앨 수 있다.

---

### H3 — C2 수정이 C3의 발화 시점을 "언젠가"에서 "링크 직후 다음 렌더"로 당겼다 (High — 요청 4번에 대한 답의 핵심)

OAuth 콜백 라우트는 **설정 화면으로** 리다이렉트하고(`?google-drive=connected`), 그 화면의
`onMount`는 **다른 무엇보다 먼저** `loadStatus()`를 부른다(`GoogleDriveSettings.svelte:110-115`,
주석이 명시적으로 "Load status first"라고 적는다). 그 `loadStatus`가 `getGoogleDriveStatus()`이고,
이제 그 엔드포인트가 입양을 수행한다.

따라서 C3의 5단계 시나리오가 이렇게 압축된다:

1. 계정 B로 링크. `getDriveAccountId`가 **일시적으로** 실패 → `upsertCredentials(userId, T_B, null)`.
2. 브라우저가 설정 화면으로 리다이렉트되고 **같은 초에** `getStatus`가 다시 프로브한다.
3. 이번엔 성공 → **A의 6,996행 전부에 B의 id가 영구히 찍힌다.**

수정 전에는 이 도장이 "앨범 Drive 메뉴를 열거나 업로드 잡이 돌 때"였다. 수정 후에는 **링크의
자연스러운 다음 화면**이다. 그리고 "한 번 실패하고 곧바로 성공"은 네트워크 blip·5xx·rate limit에서
가장 흔한 형태다. 즉 이 커밋은 C2를 닫으면서 **C3의 발생 확률을 눈에 띄게 올렸고, 리포트는 그
사실을 언급하지 않는다.**

C3를 이번 배포에서 유지하는 판단에는 동의한다(아래 "요청 4번" 참조). 다만 **위 3단계를 막는
가드는 sentinel 없이도 가능하고 작다** — `linkAccount`가 도는 순간 그 연결에 "이 연결은 컬럼
도입 이후에 만들어졌다"는 표시를 남기고, 입양은 그 표시가 없는 연결에서만 돌게 하는 것이다.
자세한 내용은 "요청 4번"에 적었다.

---

### M1 — 직전 리뷰 N2는 "재현 못 함"으로 닫혔지만, **커밋된 산출물이 틀렸다는 것은 재현과 무관하게 눈으로 확인된다** (Medium)

리포트는 _"직전 리뷰의 N2(생성 SQL 비결정성)는 5회 재현 시도 모두 동일해 재현하지 못했다"_ 로
답했다. 그것은 **다른 질문에 대한 답**이다. 생성기가 이 기계에서 결정적인지와, 체크인된 파일이
맞는지는 별개다. HEAD의 `server/src/queries/integrity.repository.sql:3-17`은 지금 이렇다:

```sql
-- IntegrityRepository.getById
select "error" from "google_drive_upload_error"
where "userId" = $1 and "error" in ($2, $3)
order by case "error" when $4 then 0 else 1 end
limit $5
select "integrity_report".* from "integrity_report" where "id" = $1
```

첫 번째 쿼리는 `GoogleDriveRepository.getBlockingError`(`google-drive.repository.ts:694-705`)이고,
`IntegrityRepository`와는 아무 관계가 없다. 대칭적으로 `google.drive.repository.sql`의
`-- GoogleDriveRepository.getErrorSummary` 블록에는 **count 쿼리 하나뿐**이고 `Promise.all`의 두 번째
쿼리가 없다. **두 파일 모두 자기가 아닌 것을 자기라고 적고 있다.** 이 파일들의 존재 이유가
"코드와 대조"인데 대조가 불가능하다. 게다가 `integrity.repository.sql`은 **업스트림 소유 파일**이라
이 오염은 머지 충돌 표면이기도 하다(리포트가 3번에서 걱정한 것과 같은 종류인데, 이쪽은 8줄이
아니라 "남의 파일에 남의 쿼리가 아닌 것"이다).

**Fix**: `getErrorSummary`에서 `@GenerateSql`을 떼거나 두 쿼리를 순차 await로 바꾸고(생성기의 수집
창이 동시 쿼리를 표현하지 못한다는 코멘트를 남긴다), 재생성해서 두 파일을 원복한다. 재현
가능성과 무관하게 **지금 커밋된 상태가 틀렸다**는 것이 요점이다.

---

### M2 — `setDriveAccountId`의 `where "driveAccountId" is null` 가드에 테스트가 하나도 없다 (Medium)

이 `where`가 N1 수정의 **유일한 안전장치**인데, 저장소 전체에서 `setDriveAccountId`를 언급하는
단언은 `google-drive.service.spec.ts:1255` 하나이고 그것은 **모킹된 저장소 호출 인자**만 본다.
`where` 절을 통째로 지워도 248개가 전부 초록이다. medium 스펙(`google-drive.repository.spec.ts`,
실 DB)에는 `setDriveAccountId`가 **0회** 등장한다 — `adoptUnstampedUploads`는 거기서 잘 검증돼
있는데 짝이 되는 setter만 빠졌다.

**Fix**: medium에 2케이스. (a) `driveAccountId`가 null인 행 → 갱신되고 1행 영향, (b) 이미 값이
있는 행 → **0행 영향, 값 불변**. H1의 refreshToken 조건을 넣는다면 (c) 토큰이 바뀐 행 → 0행.

---

### M3 — 직전 리뷰 N4는 주석만 고쳐졌고 동작은 그대로다 (Medium)

`1d1ce48ab`는 `uploadAsset`의 주석을 _"Costs one probe, once"_ → _"One probe per job while the id
is unknown … a permanently unidentifiable account pays it every time"_ 으로 정확하게 고쳤다.
**정직한 수정이지만 결함은 그대로 남아 있다.** 랩탑 상태(6,996행, `driveAccountId` NULL) 그대로
백필이 돌고 프로브가 계속 실패하면 `about.get`이 잡 수만큼 나간다. 동시성 5에서 Drive의
per-user rate limit을 건드리면 **프로브 자체가 업로드 실패의 원인**이 된다. H2의 cooldown 또는
"업로드 경로에서 프로브 제거"로 함께 닫히므로 별도 작업이 아니다.

---

### M4 — 직전 리뷰 N8이 절반만 반영돼, 이제 두 파일이 **서로 모순된다** (Medium)

`1d1ce48ab`는 `context-menu-position.ts:5-14`의 뒤집힌 인과를 아주 잘 고쳤다 — _"`top` is
monotonically non-increasing in height, so a more accurate height moves a menu up, never down"_.
그런데 같은 지적의 나머지 절반인 스펙 주석은 그대로다:

```ts
// web/src/lib/components/shared-components/context-menu/context-menu-position.spec.ts:47-48
// The other half of the report: the menu overlapped the toolbar above it. That happens when the
// clamp runs against a height smaller than the menu ends up being, so the lift is too small.
```

`.ts`가 "그게 아니다"라고 명시적으로 부정한 문장을 `.spec.ts`가 여전히 주장한다. 고치기 전에는
한 곳이 틀렸을 뿐이었지만 지금은 **두 곳이 반대로 말한다** — 다음 사람이 어느 쪽을 믿을지
알 수 없다. 테스트 자체(`shortBox.top === 700`, `grown.top === 400`)는 옳고 통과한다.

**Fix**: 스펙 주석을 "이 케이스는 화면 아래로 넘칠 때의 lift를 지킨다. 툴바 겹침은 앵커 문제였고
`ButtonContextMenu`의 `align`/호출부 `offset`에서 고쳤다"로 바꾼다.

---

### M5 — 하네스 수정은 **기능이 꺼져 있어서만** 통과한다. `GoogleDriveRepository`는 여전히 빠져 있다 (Medium — 요청 3번의 보강)

`fe9fe4fed`의 주석은 _"Real rather than mocked so the config comes back with the feature off by
default, which is what makes the call return before it touches anything Drive-related"_ 라고 정확히
적는다. 그 문장이 사실이라는 것은 내가 `b6ef3b39c`에서 같은 3개 테스트가
**`Cannot read properties of undefined (reading 'getUploadedAssetIds')`** 로 죽는 것을 확인해
증명했다 — 즉 config 게이트가 없으면 그 다음 줄에서 `this.googleDriveRepository`가 undefined다.

의미: **이 하네스는 Drive 경로에 대해 커버리지가 0이고, 누군가 medium에서 `googleDrive`를 켜는
순간 다시 빨간불이 된다.** 지금은 맞는 수정이지만 한 줄 뒤에 같은 함정이 있다.

**Fix(작다)**: `real:`에 `GoogleDriveRepository`와 `JobRepository`도 넣거나(그러면 켜도 안 죽는다),
주석에 _"켜는 순간 `GoogleDriveRepository`도 필요해진다"_ 를 한 줄 덧붙인다. 나는 전자를 권한다 —
어차피 업스트림 파일을 건드리는 마당에 8줄이 12줄이 되는 차이뿐이고, 다음 사람이 같은 스택
트레이스를 두 번 파지 않아도 된다.

---

### L1 — `adoptIfNewlyIdentified` 위에 JSDoc이 **두 개** 겹쳐 있다 (Low, 이번 커밋이 만든 것)

`google-drive.service.ts:384-394`(옛 것)와 `:395-407`(새 것)이 연속으로 붙어 있고, 함수 선언은
`:408`이다. 타입스크립트/에디터가 붙이는 것은 두 번째뿐이고 첫 번째는 죽은 블록이다. 내용도
겹친다("Safe here and nowhere else" / "Safe here and nowhere near linkAccount"). 이 포크는 주석을
1차 산출물로 다루므로, 남기려면 합치고 아니면 첫 블록을 지운다.

(같은 모양이 `album.service.ts:302-308`에도 있다 — `isGoogleDriveEnabled`를 설명하는 블록이
`queueGoogleDriveUploadsForAlbums`(`:326`) 위에 얹혀 있고, 정작 `isGoogleDriveEnabled`(`:362`)에는
주석이 없다. 이쪽은 `cbea3384e` 때부터라 이번 커밋들의 책임은 아니다.)

---

### L2 — 존재하지 않는 함수 `ensureAccountIdentified`를 가리키는 참조 2곳 (Low)

- `google-drive.service.ts:371` — _"Adoption happens only while the pre-existing token is still in
  place — see ensureAccountIdentified."_
- `server/src/schema/tables/google-drive-upload.table.ts:49` — _"(see GoogleDriveService#ensureAccountIdentified)"_

실제 이름은 `adoptIfNewlyIdentified`다. 저장소 전체에 `ensureAccountIdentified`는 이 두 주석에만
존재한다.

---

### L3 — `driveAccountId` 컬럼 주석이 아직 옛 설계(리셋 방식)를 설명한다 (Low)

`server/src/schema/tables/user-google-drive.table.ts:36-41`:

> _"read once at link time. It exists because the upload ledger is keyed (userId, assetId) with no
> notion of which Drive an asset went to … **Comparing this on each link is what lets us notice and
> reset.**"_

셋 다 이제 틀리다. 원장은 `(userId, assetId, driveAccountId)`로 키가 잡혔고, **리셋은 어디에도
없으며**(오히려 "리셋하지 않는다"가 설계의 핵심이다), 링크 시 한 번만 읽히지도 않는다(입양이
읽는다). 직전 리뷰 N7이 같은 종류의 지적이었고 저장소 쪽은 `1d1ce48ab`가 잘 고쳤는데 스키마
파일이 남았다.

---

### L4 — "미식별" 경고에 `userId`가 없다 (Low)

`7a2b68f9b`의 요점은 _"if uploads stop after a reconnect, these lines are what say why"_ 인데,
정작 두 warn 중 프로브 쪽에는 사용자 식별자가 없다:

- `google-drive.service.ts:452-458` — `'Google Drive did not report a permissionId for this account; …'`
- `google-drive.service.ts:464-467` — `` `Could not read the Google Drive account id: ${error}. …` ``

`adoptIfNewlyIdentified` 쪽(`:419`)에는 `user ${userId}`가 있으므로 둘을 시간으로 짝지어 추정할
수는 있지만, 여러 사용자가 동시에 미식별인 배포에서는 짝짓기가 불가능하다. 그리고 새 `CLAUDE.md`
문구가 운영자에게 **바로 이 두 문자열을 찾으라**고 지시한다(`CLAUDE.md:394-396`). 한 인자 추가로
끝난다.

---

### L5 — `getStatus` 주석의 "Costs one probe" (nitpick)

`google-drive.service.ts:528-531`. H2에서 다룬 내용의 문서 절반. `uploadAsset` 쪽 같은 과장은
`1d1ce48ab`가 고쳤으니 대칭을 맞추면 된다.

---

### L6 — 리포트 3절의 사실관계 두 건 (nitpick, 다만 결론은 유지된다)

- **"Wave 6이 넣은 코드"가 아니다.** `this.isGoogleDriveEnabled()`가 album 추가 경로에 들어온 것은
  `b7d21efce`(2026-08-14)이고, 그보다 앞서 `b6ef3b39c`(2026-08-12, v3.1.0 머지) 시점에 이미 같은
  3개가 `getUploadedAssetIds` undefined로 죽고 있었다. 즉 **결함은 업스트림 스펙이 머지로 들어온
  순간부터**이고 Wave 6(`1f00f78e2`)과는 무관하다. 리포트의 결론("이번 세션 커밋이 아니다")은
  오히려 **더 강하게** 참이다.
- **"`assetAddToAlbums` 케이스가 전부 죽었다"가 아니다.** 그 describe의 `it`은 6개이고 죽은 것은
  3개다(`should not use the name when there is an albumId`, `should add an asset to an album`,
  `should add an asset to multiple albums`). `should create an album by name`,
  `should require album access`, `should favorite an asset within a given radius`는 통과한다.

---

## Answers to what the report asked me to attack

### 1. C1 수정이 모든 기록 경로를 덮는가 — **덮는다. 확인했다.**

- `recordUpload`의 호출 지점은 저장소 전체에서 **하나**다(`google-drive.service.ts:1001`), 그리고
  거기에 들어가는 값은 `uploadAccountId`뿐이다(`grep -rn "recordUpload" src/ | grep -v spec`).
- `uploadAccountId`가 정해진 `:799-801` 이후 `uploadAsset` 본문에서 `credentials`를 다시 읽는 곳은
  없고, 남은 사용처는 `credentials.refreshToken`(OAuth 클라이언트, `:872`)과
  `credentials.folderId`(`:912`)뿐이다 — 계정 축과 무관하다.
- 나머지 계정 비교는 **전부 SQL 안**에 있다: `currentAccountOf(userId)`(`google-drive.repository.ts:34`)
  또는 `LEDGER_MATCHES_CURRENT_ACCOUNT`(`:38`)를 쓰는 6곳(`:306, :360, :507, :580, :762`). 이들은
  요청 도중에 상관 서브쿼리로 **다시 읽으므로** 입양 직후에도 최신 값을 본다. 그래서
  게이트 2(`hasUpload`, `:808`)가 입양 직후에도 올바르게 매칭된다 — 이건 좋은 설계다.
- `getStatus`/`getStorage`는 입양 이후 `credentials`의 계정 필드를 쓰지 않는다(`getStatus`는
  `folderId`/`folderName`/`connectedAt`만, `getStorage`는 quota만).

**단, "덮는다"는 stale 읽기 축에서만 참이다.** 쓰기 축에는 H1이 남아 있다 — `setDriveAccountId`가
어느 토큰의 프로브 결과인지 확인하지 않는다.

### 2. `getStatus`에 훅을 단 대가 — **가드가 필요하다. 키는 `userId` + 마지막 프로브 시각.**

H2 전문. 요약하면: (a) 이 엔드포인트는 설정 화면만이 아니라 **앨범 Drive 메뉴가 열릴 때마다**
불리고 캐시가 없다, (b) `getStorage`와 달리 프로브를 묶어 주는 60초 캐시가 없다, (c) `about.get`에
**타임아웃이 없어** Google이 멈추면 설정 화면이 같이 멈춘다 — 이전에는 순수 DB 읽기였다,
(d) 이 GET이 이제 6,996행 트랜잭션을 돌린다.

**받아들일 수 있는가**: 훅의 위치는 맞다. 다만 그대로 두면 안 된다. 최소 가드는
`Map<userId, lastProbeAt>` + 5분 TTL을 세 호출 지점이 공유하는 것이고(`storageCache`와 같은 모양,
`:582-583`), 더 나은 안은 **`uploadAsset`에서 프로브를 제거**해 비용 상한을 "사람이 화면을 여는
빈도"로 내리는 것이다(직전 리뷰 N4와 같은 방향, M3도 함께 닫힌다). `about.get`에 timeout을 주는
것은 그와 별개로 해야 한다.

### 3. 하네스 수정이 옳은 쪽이었나 — **옳았다. 다만 이유는 리포트가 든 것과 다르고, 절반만 고쳤다.**

**하네스가 맞는 쪽인 이유**: 이 결함은 "AlbumService가 config 없이 못 돈다"가 아니라 "테스트
하네스가 AlbumService를 **불완전한 저장소 집합으로** 조립한다"이다. 운영에는 `SystemMetadataRepository`가
항상 있다. 서비스 쪽을 관대하게 만들면 (a) 테스트 전용 조건을 위한 방어 코드가 운영에 들어가고,
(b) **다음에 빠지는 저장소를 숨긴다** — 실제로 이 하네스에는 지금도 `GoogleDriveRepository`가
없고(M5), 기능을 켜는 순간 다시 죽는다. `getConfig`는 `BaseService`의 인프라라 "없으면 기본값"
같은 관용은 표현할 자리도 마땅치 않다.

**머지 충돌 표면 걱정에 대한 답**: 8줄이 걱정할 크기라면, 같은 기능이 `album.service.ts`
(업스트림 파일)에 이미 갖고 있는 **~60줄**(`:200-211`, `:290-296`, `:301-360`)이 훨씬 큰 문제다.
하네스 8줄은 그 표면의 부속물이지 새로운 축이 아니다. 진짜로 표면을 줄이고 싶다면 방향은 다르다 —
큐잉을 `AlbumService`에서 빼서 이벤트 핸들러(`GoogleDriveService`가 구독)로 옮기면
`album.service.ts` diff가 통째로 사라지고 하네스도 원복된다. 지금 라운드에 할 일은 아니고,
플랜에 적을 항목이다.

**내가 방어하지 않는 부분**: 리포트의 _"Wave 6이 넣었다"_ 와 _"이 포크가 `//server:ci-medium`을 한
번도 돌린 적이 없어서다"_. 둘 다 사실이 아니다(L6, C2). 결함은 `b6ef3b39c`(2026-08-12)부터
존재했고, CI는 두 번 돌려서 두 번 다 실패를 보고했다.

### 4. C3를 유지하고 로그만 붙인 판단 — **이번 배포에 한해 동의한다. 다만 근거가 하나 바뀌었고, sentinel 말고 더 싼 구조적 가드가 있다.**

**동의하는 이유**: 트레이드의 방향은 옳다. sentinel(링크마다 고유 값)은 "같은 계정 재연결 +
프로브 실패"에서 **라이브러리 전량 중복**을 낳고, Drive의 중복 파일은 되돌릴 수단이 없다
(`files.create`에 멱등 마커가 없고 `appProperties`를 읽는 코드가 아직 없다). 빈 Drive는 재연결
한 번으로 회복된다. 비대칭이 분명하다.

**그러나 리포트가 말하지 않은 것**: `8f22e65df`가 **C3의 발생 확률을 올렸다**(H3). 링크 직후
설정 화면이 곧바로 재프로브하므로, "링크 시 일시 실패 → 1초 뒤 성공"이라는 가장 흔한 형태가
곧바로 도장으로 이어진다. 같은 라운드에서 한 결정이므로 같은 라운드의 리포트에 있어야 했다.

**sentinel을 쓰지 않고 실패 모드를 감당하는 방법 (다음 라운드 1순위로 권함)**:
입양의 조건을 _"이 연결의 id가 아직 null인가"_ 에서 _"이 연결이 **컬럼 도입 이전부터** 존재했는가"_
로 바꾼다. 후자가 안전 속성의 실제 내용이고, 검사 가능하다.

- 마이그레이션이 기존 `user_google_drive` 행에 `adoptable = true`를 남긴다(또는 신규 컬럼
  `linkedAfterAccountColumn boolean not null default true`를 두고 기존 행만 false로 백필한다).
- `linkAccount`는 **프로브 성공 여부와 무관하게** 그 표시를 "입양 불가"로 세운다.
- `adoptIfNewlyIdentified`는 그 표시가 "입양 가능"일 때만 도장을 찍는다.

결과:

- 마이그레이션 이전부터 있던 연결(= 랩탑의 그 한 명) → 지금과 똑같이 입양된다. **이번 배포의
  이득은 그대로다.**
- 마이그레이션 이후에 만들어진 연결은 프로브가 실패했더라도 **절대 남의 행에 도장을 찍지
  않는다.** H3와 C3의 되돌릴 수 없는 절반이 사라진다.
- **sentinel의 실패 모드는 생기지 않는다.** 미식별 연결은 여전히 `''` 버킷을 읽고 쓰므로 같은
  계정 재연결은 전량 매칭되고 중복이 없다.

남는 잔여물은 정직하게 적어 둔다: 다른 계정 B가 프로브 실패 상태로 링크되면 B는 A의 `''` 행을
읽어 **빈 Drive**가 되고, 이제는 나중 프로브가 그것을 "고쳐 주지도" 않는다(재링크 전까지 영구
미식별). 그러나 그 상태는 재연결 한 번으로 회복되고, `7a2b68f9b`가 넣은 두 warn이 정확히 그
상태를 말한다 — **되돌릴 수 없는 쪽을 되돌릴 수 있는 쪽으로 바꾸는 교환**이며, 이 포크가 C3에서
이미 채택한 논리와 같다.

⚠️ **`connectedAt`으로 이 판정을 하려는 유혹은 피해야 한다.** `upsertCredentials`의 `doUpdateSet`은
`{refreshToken, driveAccountId}`뿐이라(`google-drive.repository.ts:69-74`) **재링크해도 `connectedAt`은
최초 연결 시각 그대로**다. 즉 `connectedAt < 마이그레이션 시각` 판정은 재링크한 새 계정을
"이전부터 있던 연결"로 오판한다. 명시적인 플래그가 필요하다.

---

## 추가로 요청받은 세 가지

### (a) `fe9fe4fed`의 medium 실패가 이 세션 이전이라는 주장 — **참이다. 리포트가 든 것보다 3주 더 오래됐다.**

리포트의 커밋 범위를 믿지 않고 직접 확인했다. 격리 워크트리에서 `workflow-core-plugin.spec.ts`를
세 시점에서 실행:

| commit                                | 결과          | 메시지                            |
| ------------------------------------- | ------------- | --------------------------------- |
| `6bfd4708a` (2026-09-03, 원격 tip)    | `3 failed     | 16 passed`                        | `Cannot read properties of undefined (reading 'get')` |
| `b7d21efce` (2026-08-14)              | 같은 3개 실패 | 같은 `(reading 'get')`            |
| `b6ef3b39c` (2026-08-12, v3.1.0 머지) | 같은 3개 실패 | `(reading 'getUploadedAssetIds')` |

세 실패의 이름도 세 시점에서 동일하다. `git log 6bfd4708a..HEAD -- server/src/services/album.service.ts`도
0커밋으로 확인했다. **단, 원인 귀속은 리포트가 틀렸다** — Wave 6(`1f00f78e2`)이 아니라
v3.1.0 머지(`b6ef3b39c`)가 업스트림의 `assetAddToAlbums` 스펙을 들여온 순간부터이고, `.get`으로
메시지가 바뀐 것은 `b7d21efce`부터다(L6). 그리고 **CI는 이 실패를 두 번 보고했다**(C2).

### (b) 세 개의 새 입양 테스트가 주장하는 것을 정말 핀하는가 — **핀한다. 네 가지 변이로 확인했다.**

| 변이                                                            | 결과                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------- |
| `recordUpload(…, credentials.driveAccountId ?? '')` (C1 재도입) | `1 failed` — "should record an upload that triggered adoption…"만     |
| 위 + `getStatus`의 입양 훅 제거                                 | `2 failed` — 위 + "should identify the account … settings page loads" |
| `getDriveAccountId`/`adoptIfNewlyIdentified`의 warn 2개 제거    | `1 failed` — "should still record under the empty bucket…"            |
| `setDriveAccountId` → `upsertCredentials` (N1 회귀)             | `1 failed` — "should identify the account…"                           |

리포트의 "정확히 그 2개"는 사실이다. **핀되지 않는 것도 있다**: `setDriveAccountId`의
`where "driveAccountId" is null` 가드(M2)와, `getStorage`의 `fields: 'storageQuota,user(permissionId)'`
문자열(직전 리뷰 N5가 지적했고 여전히 어디서도 단언되지 않는다). 그리고 세 번째 테스트는
**결정을 스위트에 박아 넣는다** — `recordUpload(…, '')`를 단언하므로 훗날 sentinel로 가려면 이
테스트를 고쳐야 한다. 나쁘지 않지만, 그 테스트는 "사실"이 아니라 "선택"을 지키고 있다는 점을
주석에 적어 두는 편이 정직하다.

### (c) 운영 상태(6,996행 / 연결 사용자 1명, `driveAccountId` NULL / Wave 5 이미지)를 더 나쁘게 만드는가

_(운영 DB에는 접속하지 않았다. 주어진 상태를 사실로 두고 코드로만 따졌다.)_

**나아지는 축 (직전 라운드 대비, 그리고 큰 폭으로)**

1. 설정 화면을 여는 것만으로 입양이 실제로 돈다(C2 해결). 절차의 1단계가 처음으로 진짜가 됐다.
2. 입양을 유발한 업로드가 자기를 `''`로 기록하지 않는다(C1 해결). 게이트가 0에 도달할 수 있고,
   중복 파일 1개/잡이 사라진다.
3. 미식별 상태가 로그로 드러난다(C3 관측화). 지금 상태에서 프로브가 구조적으로 실패하는지
   여부를 **배포 직후 로그 한 줄로** 알 수 있다 — 이건 실질적으로 큰 개선이다.

**나빠지는 축 (네 가지, 전부 새로 생긴 것)**

1. **운영자의 유일한 검증 명령이 에러를 뱉는다**(C1). 게이트가 닫혔는지 확인할 방법이 문서상
   없어졌고, "쿼리가 이상하니 그냥 진행"이 곧 6,996개 중복 업로드다. **배포 전에 이것 하나만
   고쳐도 위험의 대부분이 사라진다.**
2. **`GET /google-drive/status`가 Google 가용성에 종속됐다**(H2). 타임아웃이 없어 Drive가 느리면
   설정 화면이 멈추고, 그 화면이 Disconnect 버튼이 있는 화면이다. 랩탑은 사용자 1명이라
   부하는 문제가 아니지만 **hang은 사용자 수와 무관**하다.
3. **C3가 더 잘 터진다**(H3). 링크 → 설정 화면 리다이렉트 → 즉시 재프로브. 이 포크의 개발
   과정에서 연결/해제를 반복해 왔다는 점을 생각하면 무시할 확률이 아니다.
4. 첫 설정 화면 로드가 6,996행 트랜잭션을 HTTP 요청 안에서 돈다. 7천 행이면 문제가 아니지만
   상한이 없다.

**권고 순서**: (i) `CLAUDE.md` 게이트 명령을 heredoc으로 고치고 **한 번 실행해 출력을 증거로
남긴다**, (ii) 배포 후 **로그에서 `did not report a permissionId` / `Identified the Google Drive
account for user …` 중 어느 쪽이 나오는지 먼저 본다** — 이 한 줄이 "프로브가 이 배포에서
동작하는가"라는, 두 라운드째 미검증인 최대 항목을 즉시 결판낸다. (iii) 게이트가 0이 된 것을
확인하기 **전에는** 설정 화면에서 Disconnect를 누르지 않는다. H1·H2·H3는 배포를 막을 사유는
아니지만 다음 라운드의 상위 항목이다.

---

## What I did not verify

- **운영 DB.** 6,996행과 `driveAccountId` NULL은 요청서 값을 사실로 받아들였고 랩탑에 접속하지
  않았다. 데이터가 있는 상태에서의 마이그레이션도 여전히 신선한 testcontainer에서만 확인했다.
- **`about.get`이 `drive.file` 스코프에서 `user.permissionId`를 실제로 채우는지.** 세 라운드째
  최대 미검증 항목이다. 실 OAuth 자격 증명이 필요해 이번에도 확인하지 못했다. C3·H2·M3의
  심각도가 전부 여기에 달려 있다. 다행히 `7a2b68f9b`의 로그가 **배포 직후 이것을 관측 가능하게**
  만들었다 — 배포 후 첫 설정 화면 로드의 로그를 보는 것이 이 항목을 닫는 가장 싼 방법이다.
- **lint / prettier / svelte-check.** 나는 vitest와 `tsc --noEmit`만 돌렸다. 포맷·린트는
  CI run `33818957172`의 sweep 잡이 초록인 것으로 대신했다(그 잡은 `continue-on-error`가 없으므로
  이 신뢰는 C2의 함정에 걸리지 않는다).
- **브라우저 렌더.** 메뉴 위치·차단 표시의 시각적 확인은 이번에도 하지 못했다. `context-menu-position`
  변경은 주석뿐이라 렌더에 영향이 없다.
- **SQL 재생성.** M1은 **커밋된 파일을 읽어서** 판정했고, 생성기를 이 환경에서 다시 돌리지는
  않았다(그 재현성 논쟁은 M1의 요점이 아니다).
- **CI run `33715025550`·`33758496224`의 medium 로그 본문.** 인증 없는 API로는 애노테이션까지만
  볼 수 있었다. 다만 애노테이션에 실패 문구와 `AssertionError` 3건이 그대로 있고, 나는 같은
  커밋에서 같은 3개를 로컬에서 재현했으므로 결론은 확정적이라고 본다.
- **H1의 경합을 실제로 재현하지는 않았다.** 코드 읽기와 `where` 절 구성으로 판정했다.
  medium 테스트 하나면 결정적으로 확인할 수 있다(M2의 Fix가 곧 그 테스트다).

---

## Feeding back into the plan

1. **`continue-on-error` step은 REST `conclusion`으로 검증할 수 없다.** `outcome`은 노출되지 않고
   `conclusion`은 항상 success다. 검증은 **애노테이션 또는 `$GITHUB_STEP_SUMMARY`** 로 한다.
   이 한 줄이 이번 라운드에서 가장 값싼 교훈이고, 리포트와 직전 리뷰가 **둘 다** 여기에 걸렸다.
   더 근본적으로: **non-blocking 잡을 만들 때는 "언제 읽을 것인가"를 같이 정한다.** 읽지 않는
   경고는 없는 것과 같다.
2. **절차에 적는 명령은 반드시 한 번 실행해 출력을 붙인다.** 두 라운드 연속으로 "문서에 적혔지만
   돌지 않는" 절차가 나왔다(round-16 C2: 그 화면은 그 엔드포인트를 부르지 않는다 / 이번 C1: 그
   명령은 SQL 에러다). 절차 문구는 코드와 같은 수준의 증거를 요구한다.
3. **입양의 안전 속성을 코드에 표현한다.** 직전 리뷰의 1번 항목이 그대로 남았다.
   _"이 연결의 id가 null이다"_ 와 _"이 `''` 행들은 이 연결의 것이다"_ 는 다르다. sentinel 대신
   **"컬럼 도입 이전부터 존재한 연결인가"** 라는 명시적 플래그로 후자를 구조적으로 참으로 만드는
   안을 다음 라운드 1순위로 적는다(요청 4번의 답). `connectedAt`은 재링크 시 갱신되지 않으므로
   그 판정에 쓸 수 없다는 사실도 같이 적는다.
4. **외부 API를 호출하는 read 엔드포인트에는 (a) 타임아웃, (b) 사용자 단위 쿨다운을 의무화한다.**
   `getStorage`는 캐시가 있고 `getStatus`는 없어서 같은 프로브의 비용이 두 배로 갈렸다.
   "어느 화면이 어느 엔드포인트를 부르는가" 표(직전 플랜 2번)에 **호출 빈도**를 한 칸 더한다 —
   `getStatus`가 "설정 화면 로드"만이 아니라 "앨범 Drive 메뉴 열 때마다"라는 사실이 이번 결함의
   절반이다.
5. **업스트림 파일에 대한 fork diff 목록을 문서로 유지한다.** 이번에 하네스 8줄이 논쟁이 됐지만
   진짜 표면은 `album.service.ts`의 ~60줄이다. 목록이 있으면 "이벤트 핸들러로 옮기면 표면이
   통째로 사라진다" 같은 판단을 근거를 갖고 할 수 있다.
6. **"주석만 고치고 동작은 남긴" 항목에 표시를 남긴다.** M3(N4)와 M4(N8 절반)가 그 예다.
   리뷰 지적을 닫을 때 "문서만 반영 / 동작까지 반영"을 구분해 적으면, 다음 라운드가 같은 것을
   다시 발견하지 않는다.

---

**변경 파일 확인**: 리뷰 작성 직전 메인 저장소에서 `git status --porcelain`을 실행했고, 출력은
이 리뷰 파일 하나뿐이다(작성 전에는 **완전히 비어 있었다**). 모든 변이 실험·테스트·SQL 실행은
격리 워크트리 `/tmp/gd-review-$$`(detached `202ce87d1`)에서만 수행했고, 종료 시
`git worktree remove --force`로 제거해 `git worktree list`에 남아 있지 않다. 실험용으로 띄운
Postgres 컨테이너도 `docker stop`으로 정리했다.
