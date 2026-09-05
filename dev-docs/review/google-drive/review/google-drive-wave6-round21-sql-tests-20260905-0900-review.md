# Code Review — 입양 경계(C1/M4/N1) · 프로브 상한 · 읽기 경로 취소 처리 · 손으로 쓴 SQL의 실 DB 테스트 · SQL 드리프트 잡

| | |
|---|---|
| Branch / HEAD | `feat/google-drive-album-sync-v3.1.0` / `b1110eafe` |
| Commits reviewed | `d37cdb70c`, `afd3af62d`, `933e05df5`, `834be27ba`, `b1110eafe` |
| Report | `../report/google-drive-wave6-round21-sql-tests-20260905-0900-report.md` |
| Prior review | `google-drive-drain-guard-20260904-1513-review.md` |
| Reviewed | 2026-09-05 |
| 작업 환경 | 격리 워크트리 `/home/gwyun/workspace/immich-review`(detached `b1110eafe`). 빌드·변이·throwaway 스펙·SQL 생성기·postgres 컨테이너(`gd-rev21-pg`, 호스트 포트 55432)는 전부 그 안에서만. 작성자 트리(`/home/gwyun/workspace/immich`)는 리포트 1개만 읽고 쓰지 않았다 |

## Verdict

**다섯 커밋의 방향은 전부 옳고, 이번 라운드의 핵심 주장 두 개는 실 DB에서 재현해 확인했다.**
`FOR UPDATE` 잠금은 진짜로 재링크를 배제한다 — 재링크가 먼저 커밋되면 잠금 재검사가 행을
탈락시켜 입양이 `false`로 물러나고(probe E), 입양이 먼저 잠그면 재링크가 커밋까지 대기한다
(probe F). 데드락 사이클은 찾지 못했다. `retry: false`는 라이브러리 수준에서 실효한다
(`googleapis-common/apirequest.js:263` → `gaxios/retry.js:18`). SQL 드리프트도 마이그레이션을
적용한 실 DB에서 생성기를 돌려 `426 queries` / `git diff` 비어 있음으로 재현했다. CI는
b1110eafe에서 4잡 전부 success이고 `sql` 잡이 9스텝을 끝까지 통과했다.

**가장 중요한 문제는 입양 경계가 아직 한 종류의 오귀속을 막지 못한다는 것이다(H1).**
`uploadAccountId`는 `uploadAsset` 입구(`service.ts:930`)에서 정해지지만 원장 기록은 업로드가
끝난 뒤(`service.ts:1136`)이고, 그 사이에 다른 계정이 연결되면 **A의 드라이브에 들어간 파일이
B의 `connectedAt`보다 늦은 `uploadedAt`으로 `''` 버킷에 떨어진다.** 그 뒤 B의 프로브가 성공하면
경계 `uploadedAt >= connectedAt`이 그 행을 통과시켜 `account-B`로 도장을 찍는다. 실 DB에서
그대로 만들어 봤고, A를 재연결하니 `hasUpload = false` — 즉 **A의 드라이브로 중복 재업로드**다.
이번 커밋이 닫으려던 바로 그 실패 클래스가, 이번엔 시간축의 반대편에서 열려 있다. 다만 **계정이
바뀌지 않는 이 배포본에서는 무해**하다(자세한 것은 H1과 §8 답변).

두 번째로 중요한 것: **리포트 §6의 "변이 확인" 표 한 칸이 사실과 다르다.** `old_row` 비교를
`false`로 바꾸면 실패하지만, 실제로 의미 있는 변이인 **연언(conjunct) 제거(→ `true`)는 30/30 통과**한다.
지금 테스트는 "다른 자산이 같은 클래스로 이미 실패한 뒤의 재시도"만 보므로 `others` 절반이
결과를 떠받치고, `old_row` 절반은 아무것도 고정하지 못한다. 자산이 하나뿐인 사용자에게
"드라이브가 가득 찼습니다"가 재시도마다 날아가는 회귀를 이 스위트는 잡지 못한다.

셋째: **`getErrorSummary`의 방어 술어 세 개가 전부 공허하다.** `ledgerMatches`, `userId` onRef,
`asset.deletedAt is null` — 각각 제거해도 medium 30개가 그대로 통과한다. 코드 자체는 맞다
(throwaway probe B/C로 확인). 틀린 것은 테스트가 증명한다고 말한 범위다. `recordUpload`의
에러 행 삭제에 걸린 `userId` 필터도 같다.

넷째: **드리프트 잡은 아직 "조용히 통과"할 길이 하나 남아 있다** — `git diff`는 **추적되지 않는
새 파일**을 보지 못하므로, 새 리포지토리가 생겨 `server/src/queries/*.sql`이 하나 늘어나는 경우
이 잡은 아무것도 비교하지 않고 성공한다(재현함). 준비 대기 루프도 initdb 단계의 임시 서버를
"준비됨"으로 읽는다(재현함).

### Evidence I ran myself

| Check | Result |
|---|---|
| 서버 유닛 8스펙(`run.sh`의 `SERVER_SPECS`), `b1110eafe` | `Test Files 8 passed / Tests 258 passed` — 리포트와 일치 |
| medium `google-drive.repository.spec.ts` | `Tests 30 passed` — 리포트와 일치 |
| `npx tsc --noEmit -p tsconfig.json`(server) | rc=0 |
| `npx eslint`(바뀐 TS 4파일, `--max-warnings 0`) | rc=0 |
| CI 런 `33931116529`(GitHub API, `head_sha = b1110eafe`) | 4잡 전부 `success`. `Generated SQL is current`는 `Start Postgres` → `Apply migrations` → `Regenerate` → `Fail if …` 9스텝 모두 success (잡 로그 본문은 403으로 못 읽음) |
| **SQL 생성기**, 마이그레이션 적용 DB(`ghcr.io/immich-app/postgres:14-vectorchord0.4.3`, 55432) | `Wrote 52 files` / `Generated 426 queries`, `git diff -- server/src/queries` **비어 있음** — 드리프트 없음, 리포트와 일치 |
| 같은 생성기, **연결 불가** DB | 전 파일 삭제(`36 files … 8823 deletions`) → `git diff`가 잡는다. 즉 DB 미가동은 **조용히** 통과하지 않는다 |
| `git diff --exit-code -- server/src/queries` + **새 untracked 파일** | **CLEAN이라고 답함** → 잡이 통과 (M7) |
| `docker run` + `pg_isready` 폴링 실측 | `isready=READY`인 순간 `docker logs`의 `ready to accept connections`가 **1줄**, TCP 리스너 없음. 로그 33행(임시 서버) vs 53행(`listening on IPv4`) (M6) |
| **실 DB probe A**: A의 인플라이트 업로드가 B 연결 뒤에 착지 | 원장 행 `{"driveAccountId":"account-B","driveFileId":"file-in-A"}`, A 재연결 시 `hasUpload = false` — **중복 재업로드 경로** (H1) |
| **실 DB probe G**: 시계가 뒤로 조정된 뒤 B가 연결 | 같은 결과 — 경계가 시계 역행에 그대로 노출 (H1) |
| **실 DB probe E**: 재링크가 먼저 커밋 → 입양의 잠금 읽기 | `undefined` → 입양 `false`. **잠금 재검사가 올바르게 동작** |
| **실 DB probe F**: 입양이 잠금 보유 중 재링크 시도 | 순서 `["locked","adoption committed","re-link committed"]` — **상호 배제 성립** |
| **실 DB probe B**: 다른 계정 원장 행 + 에러 행 | `failedCount = 1` — 코드는 옳다 |
| **실 DB probe C**: 휴지통에 넣은 자산의 에러 행 | `1 → 0` — 코드는 옳다 |
| 변이 `uploadedAt >= connectedAt` 2곳 제거 | 1 failed (`should not claim unstamped rows written before this connection existed`) — 리포트 주장대로 **비공허** |
| 변이 `recordUpload`의 `deleteFrom` 제거 | 1 failed (`should clear the failure row …`) — 리포트 주장대로 |
| 변이 `google_drive_upload.assetId is null` 제거 | 1 failed (`should move the pending count …`) — 리포트 주장대로 |
| 변이 `(select "c" from "others") = 0` → `true` | 1 failed — 리포트 주장대로 |
| **변이 `coalesce((select "error" from "old_row"), '') <> ${error}` → `true`** | **30/30 통과** — 리포트 §6 표와 어긋남 (M2) |
| 변이 `getErrorSummary`의 `.on(ledgerMatches(userId))` 제거 | **30/30 통과** (M3) |
| 변이 `getErrorSummary`의 `userId` onRef 제거 | **30/30 통과** (M3) |
| 변이 `getErrorSummary`의 `asset.deletedAt is null` 제거 | **30/30 통과** (M3) |
| 변이 `recordUpload`의 에러 삭제에서 `userId` 필터 제거 | **30/30 통과** (M4) |
| 변이 `upsertCredentials`의 `connectedAt` = `now()` 제거 (`repository.ts:86`) | **30/30 통과** (M5) |
| 변이 `adoptUnstampedUploads`의 `.forUpdate()` 제거 | 30/30 통과 (예상됨 — 동시성은 스위트가 재현하지 못한다) |
| 변이 `getPickerConfig`의 `if (this.isInvalidGrant(error))` → `if (true)` | **77/77 통과** — 그 분기에 테스트가 하나도 없다 (M1) |
| 변이 `upsertError`의 `others`에서 `userId` 필터 제거 | 1 failed — 다만 **다른 describe가 남긴 잔여 행** 때문 (N2) |
| `dev-test/google-drive/results/20260905-0853.txt` | b1110eafe에는 없고 리포트 커밋 `78f9264fe`에 있다. 내용은 `commit: b1110eafe` / 258 / 39 / 30 / `RESULT: PASS` — 리포트 표와 일치 |
| 워크트리 `git status --porcelain`(모든 변이·throwaway 복원 후) | **이 리뷰 파일 하나뿐** |

---

## Findings

### H1 (High) — 입양 경계는 "늦게 착지한 업로드"를 여전히 잘못 귀속시킨다

**증거(재현).** `uploadAsset`은 입구에서 `uploadAccountId`를 정하고(`service.ts:930`) 실제 원장
기록은 업로드가 끝난 뒤에 한다(`service.ts:1136`). 큰 영상 하나면 그 사이가 수 분이다. 그 창에서
연결이 다른 계정으로 갈아끼워지고 **새 연결도 미식별로 시작**하면 다음이 성립한다.

```
t0  연결 A(미식별, connectedAt=t0). 자산 X 업로드 시작 → A의 드라이브로 들어감
t1  사용자가 연결 해제/재링크. 드레인 프로브 실패 → '' 행은 그대로
t2  연결 B(미식별, connectedAt=t2)
t3  t0에 시작한 업로드가 이제야 recordUpload → ('' , uploadedAt=t3),  t3 > t2
t4  B의 프로브 성공 → adoptUnstampedUploads → uploadedAt(t3) >= connectedAt(t2) → account-B로 도장
```

워크트리에 throwaway medium 스펙을 넣어 그대로 실행한 결과:

```
A: ledger after adoption = [{"driveAccountId":"account-B","driveFileId":"file-in-A"}]
A: hasUpload for the original account = false
```

파일은 A의 드라이브에 있는데 원장은 B라고 말하고, A를 재연결하면 `hasUpload`가 false다 —
`files.create`에 멱등성이 없으므로 **되돌릴 수 없는 중복**이다. 이것은 `d37cdb70c`가 닫았다고
말하는 실패 클래스와 동일하다. 커밋 메시지의 "Rows older than connectedAt were written by
somebody else"는 참이지만, 그 역("connectedAt보다 새 행은 이 연결이 썼다")은 **거짓**이고 경계는
후자에 의존한다.

**시계.** `uploadedAt`과 `connectedAt`은 둘 다 같은 DB의 `now()` 기본값이므로
(`1785423600001-CreateGoogleDriveUploadTable.ts:21`, `1785475800000-CreateUserGoogleDriveTable.ts:21`)
호스트 간 스큐는 없고, `now()`가 트랜잭션 시작 시각이라는 성질도 안전한 방향(업로드가 오래 걸릴수록
`uploadedAt`이 이르게 찍혀 입양에서 **빠진다**)으로 작동한다. 위험한 것은 **DB 시계의 역행**이다.
NTP가 한 시간 뒤로 물리면 새 연결의 `connectedAt`이 직전 연결이 쓴 행들보다 이르게 찍혀 그
구간 전체가 입양 대상이 된다. probe G로 재현했다(같은 결과).

**공격 요청 1번의 직답: 있다.** 트랜잭션 시작 시각이나 커밋 순서가 아니라, **업로드 결정 시점과
원장 기록 시점의 간격**이 만드는 조합이다.

**Fix(구체).** 시간 대신 **연결의 동일성**으로 경계를 지어야 한다. 가장 작은 변경은
`uploadAsset`이 gate 1에서 읽은 `credentials.connectedAt`을 들고 가서 `recordUpload`에 넘기고,
`recordUpload`가 같은 트랜잭션 안에서 `user_google_drive`를 읽어 `connectedAt`이 움직였으면
`''`로 쓰지 않는 것이다(그 경우 이미 다른 계정 소유이므로 원장 기록을 건너뛰고 실패로 남기는 쪽이
안전하다 — 지금 코드가 `hasUpload` 재확인으로 중복을 막는 것과 같은 계열의 방어다). 더 튼튼한
쪽은 원장 행에 "쓴 연결의 `connectedAt`"을 함께 저장해 입양이 시간 비교가 아니라 같은 값 비교를
하게 만드는 것이지만, 마이그레이션이 필요하고 이번 배포의 관문은 아니다.

**이 배포본에서의 실질 위험은 낮다.** 시나리오는 *다른 구글 계정*이 연결될 때만 손해가 되는데,
사장님은 늘 같은 계정을 재연결한다. 같은 계정이면 도장이 `account-A`로 찍혀 결과가 오히려 옳다.
그래서 **배포를 막지는 않되, 계획 문서에 남겨야 하는 결함**으로 분류했다.

### M1 (Medium) — `getPickerConfig`의 취소-처리 분기에 테스트가 하나도 없다

**증거.** `933e05df5`는 `getStorage`에만 단언을 추가했다(`spec.ts` 891행 부근). `getPickerConfig`
쪽(`service.ts:835`)에는 아무것도 없다. `if (this.isInvalidGrant(error))`를 `if (true)`로 바꿔도
`google-drive.service.spec.ts` **77/77 통과**했다 — 즉 "일시적 5xx가 멀쩡한 연결을 지우지 않는다"는
성질이 이 경로에서는 **코드를 읽어야만** 알 수 있다.

**공격 요청 3번의 직답: 분류 자체는 충분히 좁다.** `isInvalidGrant`(`service.ts:1212-1221`)는
`response.data.error === 'invalid_grant'` 또는 `message`에 그 문자열이 있을 때만 참이다.
Drive API의 5xx는 `response.data.error`가 **객체**(`{code,message,errors}`)라 문자열 비교에
걸리지 않고, 네트워크 오류에는 `response`가 없다. 코드는 옳다. **테스트가 그것을 지키지 않을 뿐이다.**

다만 하나 짚어둘 경계 사례: 관리자가 시스템 설정의 `clientId`를 새 Google Cloud 프로젝트 것으로
바꾸면 기존 refresh token은 그 클라이언트 소유가 아니므로 구글이 `invalid_grant`를 준다. 그러면
**설정 화면을 여는 것만으로** 모든 사용자의 연결이 지워진다. 판정 자체는 맞지만(그 토큰은 실제로
죽었다), 업로드 경로에서만 일어나던 일이 이제 페이지 로드에서도 일어난다는 사실은 M8과 함께
읽어야 한다.

**Fix.** `getStorage`에 붙인 것과 같은 형태로 두 개: (a) `getAccessToken`이 `invalid_grant`로
던지면 `deleteCredentials`가 불렸다 + `getAccessToken`이 실제로 불렸다(증인), (b) 500/네트워크
오류로 던지면 `deleteCredentials`가 **불리지 않았다** + 그래도 예외는 났다.

### M2 (Medium) — 리포트 §6의 변이 표가 `firstOfClass`에 대해 사실보다 강하게 말한다

**증거.** 리포트는 "`old_row` 비교 → `false` … 해당 테스트만 실패"라고 적었고 그 방향은 맞다.
그러나 연언을 **제거**하는 변이(`… and true as "firstOfClass"`, `repository.ts:743`)는
**30/30 통과**한다. 이유는 기존 테스트의 세 번째 호출이 이미 `second` 자산에 같은 클래스 행을
만든 **뒤**에 오기 때문이다 — 그 시점엔 `others`가 1이라 `others = 0` 절반만으로 false가 나온다.

빠진 경우는 **"다른 자산이 하나도 실패하지 않은 상태에서 같은 자산이 같은 클래스로 재시도"**다.
그때는 `others = 0`이므로 `old_row` 절반만이 false를 만든다. 그 케이스를 두 줄짜리 throwaway
테스트로 넣어 확인했다: 원본에서는 통과, 위 변이에서는 실패.

**의미.** 이 절반이 회귀하면 실패 자산이 하나뿐인 사용자는 **재시도마다** "드라이브가 가득 찼습니다"
알림을 받는다. 리포트가 "spam on every retry"를 막았다고 주장한 바로 그 방향인데, 지금 스위트는
그것을 잡지 못한다.

**Fix.** `failure bookkeeping` describe에 다음을 추가한다(자산 하나, 사용자 하나).

```ts
it('should not report the same class as first again on a plain retry', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  await expect(sut.upsertError(user.id, asset.id, GoogleDriveUploadErrorClass.QuotaExceeded, 'full'))
    .resolves.toEqual({ firstOfClass: true });
  // `others` is still 0 here, so only the old_row conjunct can make this false.
  await expect(sut.upsertError(user.id, asset.id, GoogleDriveUploadErrorClass.QuotaExceeded, 'full'))
    .resolves.toEqual({ firstOfClass: false });
});
```

### M3 (Medium) — `getErrorSummary`의 방어 술어 세 개가 전부 공허하다

**증거.** `repository.ts:831-837`의 세 조각을 하나씩 없애고 medium 30개를 돌렸다.

| 제거한 것 | 결과 |
|---|---|
| `.on(ledgerMatches(userId))` (:834) | 30/30 통과 |
| `.onRef('google_drive_upload.userId', …)` (:833) | 30/30 통과 |
| `.where('asset.deletedAt', 'is', null)` (:837) | 30/30 통과 |

새 테스트 `should not count a failure whose asset has since been uploaded`는 원장 행을
`'account-x'`로, 연결도 `'account-x'`로 만들기 때문에 계정 조건이 있으나 없으나 같은 답이 나온다.
`userId` onRef도 같은 사용자만 쓰므로 마찬가지고, 소프트 삭제는 픽스처에 아예 없다.

**공격 요청 4번의 직답: 남아 있다.** "다른 계정의 원장 행", "다른 사용자의 원장 행",
"소프트 삭제된 자산" 셋 다 통과하면서 SQL이 틀릴 수 있는 조합이다. 현재 코드는 맞다 —
throwaway probe로 다른 계정 원장 행에 대해 `failedCount = 1`, 휴지통에 넣으면 `1 → 0`을 확인했다.
문제는 **테스트가 그 답을 고정하지 않는다**는 것이고, `deletedAt` 조건은 특히 운영에서
`source_unreadable` 2건을 푼 근거였다(CLAUDE.md `## Current Project` Tasks 2번) — 회귀하면
그 처방이 조용히 안 듣는다.

**Fix.** 기존 픽스처에 세 줄씩 얹으면 된다.
1. 원장 행을 `'account-other'`로 넣고 `failedCount = 1`을 단언.
2. 두 번째 사용자에게 **같은 자산**의 원장 행을 넣고, 첫 사용자의 `failedCount`가 여전히 1임을 단언.
3. 에러 행을 만든 뒤 `asset.deletedAt`을 채우고 `1 → 0`을 단언.

### M4 (Medium) — `recordUpload`의 에러 삭제가 사용자 범위인지 아무도 확인하지 않는다

**증거.** `repository.ts:685`의 `.where('userId', '=', userId)`를 제거해도 30/30 통과한다.
공유 앨범의 같은 자산을 두 사용자가 각각 백업하다 둘 다 실패한 상태에서 한 쪽이 성공하면,
그 필터가 없으면 **다른 사용자의 실패 행까지 사라진다**. 테스트에 사용자가 하나뿐이라 보이지 않는다.

**Fix.** `should clear the failure row when the upload finally succeeds`에 두 번째 사용자와 같은
자산의 에러 행을 하나 더 넣고, 첫 사용자의 `recordUpload` 뒤에도 그 행이 **남아 있음**을 단언.

### M5 (Medium) — C1 수정의 절반(`connectedAt`이 재링크에서 움직인다)에 테스트가 없다

**증거.** `repository.ts:86`의 `onConflict(... doUpdateSet({ ..., connectedAt: now() }))`에서
`connectedAt` 항목을 빼도 medium 30/30이 통과한다.
커밋 메시지는 이 한 줄이 없으면 "경계가 아무것도 구분하지 못한다"고 정확히 말하는데, 그 진술을
지키는 것은 지금 **생성된 참조 SQL**(`google.drive.repository.sql:25`의 `"connectedAt" = now()`)
뿐이다 — 그리고 그건 재생성만 하면 같이 바뀌므로 관문이 아니다. 실제 동작은 throwaway probe D로
확인했다(재링크 뒤 `connectedAt`이 현재 시각으로 이동).

**Fix.** medium 테스트 하나: 오래된 `connectedAt`으로 연결을 만들고 그보다 나중이지만 재링크보다
**이른** `uploadedAt`의 `''` 행을 넣은 뒤, 같은 계정으로 `upsertCredentials` → 입양이 그 행을
**가져가지 않음**을 단언한다. 이러면 `connectedAt` 이동과 경계를 한 번에 고정한다.

### M6 (Medium) — 드리프트 잡의 준비 대기 루프가 initdb 단계의 임시 서버를 "준비됨"으로 읽는다

**증거(재현).** 워크플로와 같은 이미지·같은 플래그로 컨테이너를 띄우고 0.2초 간격으로 관찰했다.

```
i=2 isready=no    readylines=0
i=3 isready=READY readylines=1     ← 여기서 루프가 exit 0 한다
i=4 isready=READY readylines=2
```

로그를 보면 33행 `database system is ready to accept connections`는 엔트리포인트가
`listen_addresses=''`로 띄운 **초기화용 임시 서버**이고, TCP 리스너는 53행
`listening on IPv4 address "0.0.0.0", port 5432`부터다. `docker exec … pg_isready`는 유닉스 소켓으로
붙으므로 그 구간에서 0을 돌려준다. 다음 스텝은 `DB_URL=…@localhost:5432`로 **TCP** 접속하므로
`ECONNREFUSED`가 날 수 있다. 내 기계에서는 창이 0.4초였고 러너에서는 initdb + init 스크립트가
더 오래 걸린다. b1110eafe의 실제 런은 통과했지만, 이건 통과한 것이 아니라 **이긴 것**이다.

medium 스위트의 `globalSetup.ts:34`가 정확히 이 문제를 알고
`Wait.forLogMessage('database system is ready to accept connections', 2)`로 **두 번째** 줄을
기다린다. 워크플로 주석은 "같은 이미지·같은 플래그"라고 말하면서 **대기 전략만 다르게** 가져왔다.

**Fix(둘 중 하나).**

```yaml
# (a) globalSetup.ts와 같은 판정
for _ in $(seq 1 60); do
  if [ "$(docker logs immich-postgres 2>&1 | grep -c 'database system is ready to accept connections')" -ge 2 ]; then
    exit 0
  fi
  sleep 2
done
# (b) 실제로 쓰는 경로(TCP)로 묻는다
if docker exec immich-postgres pg_isready -h 127.0.0.1 -U postgres -d immich >/dev/null 2>&1; then
```

`(b)`가 한 글자 수준의 변경이고, "다음 스텝이 쓰는 것과 같은 경로로 확인한다"는 점에서 더 낫다.

**포트 충돌은 위험이 아니다.** GitHub 호스티드 `ubuntu-latest`에서 PostgreSQL 서비스는 기본
정지 상태이고, 설령 점유돼 있어도 `docker run -d`가 0이 아닌 코드로 죽으므로 스텝이 **시끄럽게**
실패한다(`run:`은 `bash -e`). 조용한 실패 경로가 아니다.

### M7 (Medium) — `git diff --exit-code`는 새로 생긴 쿼리 파일을 보지 못한다

**증거(재현).** `server/src/queries/zz.new.repository.sql`을 만들고
`git diff --exit-code -- server/src/queries`를 돌리면 **CLEAN**이라고 답한다(`git status --porcelain`은
`?? …`로 본다). 새 리포지토리가 추가되면 생성기는 새 파일을 쓰고 이 잡은 **아무것도 비교하지 않은 채**
성공한다. 잡의 존재 이유("이 실수가 다시 조용히 일어날 수 없게")에 정확히 반하는 구멍이다.

반대로 **DB가 아예 없을 때는 조용히 통과하지 않는다** — 생성기가 시작할 때 `src/queries`를
통째로 지우고(`sync-sql.ts`의 `rm(targetDir, …)`) 다시 못 쓰므로 36개 파일 삭제가 diff에 뜬다.
직접 확인했다.

**Fix.**

```yaml
- name: Fail if the committed SQL is out of date
  run: |
    if [ -n "$(git status --porcelain -- server/src/queries)" ]; then
      git status --porcelain -- server/src/queries
      git diff -- server/src/queries
      echo "::error::server/src/queries is out of date — run \`mise //:sql\` against a migrated database and commit the result"
      exit 1
    fi
```

덤으로, "마이그레이션이 정말로 적용됐는가"를 확인하는 한 줄을 `Apply migrations` 뒤에 두면
이 잡의 마지막 가정도 닫힌다(예:
`docker exec immich-postgres psql -U postgres -d immich -c "select 1 from google_drive_upload limit 1"`).
지금은 마이그레이션이 조용히 no-op이어도 — 커밋된 SQL 역시 미적용 DB에서 만들어졌다면 —
diff가 비어 나올 수 있다.

### M8 (Medium) — 취소 처리가 사용자의 폴더 선택을 함께 지운다 (B3가 넓힌 기존 비용)

**증거.** `clearRevokedGrant`(`service.ts:416-422`)와 업로드 경로 둘 다 `deleteCredentials`를
부르고, 그것은 `user_google_drive` **행 전체**를 지운다(`repository.ts` `deleteCredentials`).
그 행에는 `folderId` / `folderName`이 함께 있다(`user-google-drive.table.ts:50,63`).
`upsertCredentials`는 재링크 때 폴더를 일부러 건드리지 않는데(그 주석이 명시한다), 행이 이미
사라진 뒤라면 지킬 것이 없다.

Testing 모드의 7일 만료가 **주 1회** 이 경로를 태우므로, 사장님은 재연결할 때마다 폴더를 다시
골라야 한다. B3는 그 계기를 "업로드가 눈치챌 때"에서 "설정 화면을 열 때"로 앞당겼으므로 빈도가
올라간다. dev-docs 어디에도 이 비용이 적혀 있지 않다.

**Fix(택1).** (a) `refreshToken`을 nullable로 바꾸고 "연결됨"의 판정을 `refreshToken is not null`로
옮기는 마이그레이션 — 폴더·계정 id가 보존된다. (b) 마이그레이션 없이 가려면, 지우기 직전에
`folderId`/`folderName`을 읽어 두고 다음 `linkAccount`에서 되살릴 저장소(예: `system_metadata`)를
쓰는 방법이 있으나 상태가 두 곳으로 갈라져 권하지 않는다. (c) 최소한 **문서화**: 재연결 의식에
"폴더 다시 고르기"가 포함된다는 사실을 `wave6-plan.md`와 CLAUDE.md 배포 절차에 적는다.

### N1 (Nit) — 프로브 상한 주석이 남은 구간을 실제보다 작게 말한다

`retry: false`는 실효한다(확인함). 하지만 주석이 "still unbounded … that leg plus this"라고 적은
OAuth 갱신 구간은 **타임아웃이 없을 뿐 아니라 재시도된다**:
`google-auth-library/build/src/auth/oauth2client.js:213`이 `AuthClient.RETRY_CONFIG`
(`authclient.js:107-114` — `retry: true`, `httpMethodsToRetry`에 `POST` 포함)를 펼치고,
gaxios 기본값이 `retry: 3` / `noResponseRetries: 2`다. 즉 최악은 "한 다리 + 10초"가 아니라
"무한정 × 최대 3 + 10초"다. `disconnect`가 구글에 붙잡히지 않는다는 약속은 아직 성립하지 않는다.

**Fix.** 신원은 best-effort이고 null이 안전하므로 프로브 **전체**에 데드라인을 씌우는 것이 가장 싸다:

```ts
const permissionId = await Promise.race([
  probe(),
  setTimeout(GoogleDriveService.ACCOUNT_PROBE_TIMEOUT_MS).then(() => null),
]);
```

(`node:timers/promises`의 `setTimeout`. 백그라운드에 남는 요청은 결과가 버려질 뿐 해가 없다.)

### N2 (Nit) — `others`의 `userId` 필터는 다른 describe의 잔여 행 덕에 잡힌다

그 필터를 제거하면 테스트 하나가 실패하지만, 실패하는 이유는 **앞선 describe들이 같은 DB에
`QuotaExceeded` 행을 남겨 놓았기 때문**이다. 픽스처가 바뀌거나 describe 순서가 바뀌면 조용히
공허해진다. `failure bookkeeping` 안에 두 번째 사용자를 명시적으로 만들어 두면 우연에 기대지 않는다.

### N3 (Nit) — CLAUDE.md의 드레인 설명이 새 경계보다 넓게 약속한다

`CLAUDE.md:415-416`은 "연결이 끝나는 두 순간에 떠나는 토큰으로 **미상 행을** 그 계정에 넘긴다"고
적었는데, 이제 넘어가는 것은 `uploadedAt >= connectedAt`인 행뿐이다. 바로 위 문단이 "0이 되지
않는 것이 정상"이라고 옳게 설명하므로 모순까지는 아니지만, 두 문장이 서로 다른 범위를 말한다.
"그 연결 이후에 쌓인 미상 행을"로 한정하면 끝난다.

### N4 (Nit) — 리포트의 증거 파일은 리뷰 대상 커밋에 없다

`dev-test/google-drive/results/20260905-0853.txt`는 `b1110eafe`에 없고 리포트 커밋 `78f9264fe`에
들어 있다. 내용은 `commit: b1110eafe`로 올바르게 재생성됐고 수치도 내가 재현한 것과 일치하므로
실질 문제는 없다. 다만 리뷰어가 대상 커밋만 체크아웃하면 증거를 못 찾는다 — 리포트 표의 경로
옆에 "리포트 커밋에 동봉"이라고 한 마디만 적으면 된다.

---

## Answers to what the report asked me to attack

### 1. 입양 경계가 시간에 기대는 것 — 잘못된 귀속을 만드는 조합이 있는가

**있다. H1이 그것이고 실 DB에서 재현했다.** 트랜잭션 시작 시각(`now()`)과 커밋 순서는 **안전한
방향**으로만 작동한다 — `now()`가 트랜잭션 시작 시각이라 업로드가 오래 걸릴수록 `uploadedAt`이
이르게 찍히고, 이르게 찍힌 행은 입양에서 **빠진다**(정리 누락, 재업로드 아님). 두 타임스탬프가
같은 DB의 같은 함수에서 오므로 호스트 간 스큐도 없다.

깨지는 것은 **업로드 결정과 원장 기록 사이의 간격**이다. `uploadAsset`이 A의 자격증명으로
파일을 A의 드라이브에 넣은 뒤, B가 연결된 다음에 `''` 행을 쓰면 그 행의 `uploadedAt`은 B의
`connectedAt`보다 **크다**. 경계는 그것을 B의 것으로 읽는다. 성립 조건은 (i) 인플라이트 업로드,
(ii) 그 사이의 계정 교체, (iii) 새 연결이 링크 시점에 미식별(프로브 실패)일 것 — 좁지만 실재한다.
**DB 시계의 역행**은 (i)조차 필요 없게 만든다(probe G).

### 2. `FOR UPDATE`가 실제로 재링크를 배제하는가, 데드락은 없는가

**배제한다. 양방향 모두 확인했다.**

- 재링크가 **먼저** 커밋 → 입양의 `SELECT … WHERE refreshToken = <old> FOR UPDATE`는 Postgres의
  EvalPlanQual 재검사에서 새 튜플의 토큰이 조건에 맞지 않아 행을 탈락시킨다. probe E:
  `locked read saw = undefined` → `adoption would have proceeded = false`.
- 입양이 **먼저** 잠금 → `upsertCredentials`의 `INSERT … ON CONFLICT DO UPDATE`가 충돌 튜플의
  잠금을 기다린다. probe F의 커밋 순서: `["locked","adoption committed","re-link committed"]`.

**데드락 사이클은 없다.** 두 테이블을 한 트랜잭션에서 잡는 것은 `adoptUnstampedUploads`뿐이고
(`user_google_drive` → `google_drive_upload`), 반대 방향으로 잡는 트랜잭션이 없다.
`recordUpload`는 `google_drive_upload` → `google_drive_upload_error`만 잡고 `user_google_drive`를
건드리지 않는다. FK가 `user` 행에 거는 것은 서로 호환되는 `FOR KEY SHARE`다. 같은 사용자에 대한
두 입양은 연결 행 잠금에서 직렬화되고, 다른 사용자면 행이 겹치지 않는다.

**남는 비용은 지연이다.** 입양의 `update … where driveAccountId = ''`가 수천 행을 훑는 동안
연결 행 잠금을 계속 쥐고 있으므로, 그 사이의 링크·연결 해제가 대기한다. 운영 6,996행 기준으로도
수십 ms 수준이라 실무상 문제는 아니지만, 잠금이 **의도적으로** 그 범위를 덮고 있다는 사실을
주석에 한 줄 남기면 다음 사람이 놀라지 않는다.

### 3. 읽기 경로의 취소 처리가 너무 공격적인가

**분류는 충분히 좁다.** `isInvalidGrant`는 `response.data.error`가 문자열 `'invalid_grant'`이거나
메시지에 그 문자열이 있을 때만 참이다. Drive API의 5xx는 `response.data.error`가 객체라
문자열 비교에 걸리지 않고, 타임아웃·네트워크 오류에는 `response` 자체가 없다. `getStorage`가
`about.get`에서 받는 오류로 이 분기에 잘못 들어갈 경로는 찾지 못했다.

**그러나 `getPickerConfig` 분기에는 테스트가 하나도 없다(M1).** `if (true)`로 바꿔도 유닛
77개가 전부 통과한다. 그리고 판정이 옳을 때조차 **폴더 선택이 함께 사라진다(M8)** — 이것이
"너무 공격적"이라는 질문에 대한 실질적인 답이다. 지우는 조건이 아니라 **지우는 범위**가 넓다.

### 4. 테스트가 통과하면서도 SQL이 틀릴 수 있는 조합

**넷 확인했다.** 다른 계정의 원장 행(M3), 다른 사용자의 원장 행(M3), 소프트 삭제된 자산(M3),
`recordUpload`의 사용자 범위(M4). 여기에 리포트 표 자체가 과장된 칸이 하나 있다(M2 —
`firstOfClass`의 `old_row` 절반). 다섯 개 모두 **코드는 현재 옳고 테스트만 공허**하다.
리포트가 "변이 확인"으로 못박았다고 적은 세 줄 중 두 줄은 재현되지만(`deleteFrom` 제거,
`assetId is null` 제거), 세 번째는 변이 방향에 따라 갈린다.

### 5. SQL 드리프트 잡 — 포트 충돌, 대기 로직, 조용한 통과

- **포트 충돌**: 위험이 아니다. `ubuntu-latest`의 PostgreSQL은 정지 상태이고, 점유돼 있으면
  `docker run -d`가 실패해 스텝이 시끄럽게 죽는다.
- **대기 로직**: 실패 모드가 하나 있다 — initdb 임시 서버를 준비됨으로 읽는다(M6, 재현함).
  60회 × 2초 상한 자체는 문제없고, 실패 시 `docker logs`를 남기는 것도 좋다.
- **조용한 통과**: 하나 있다 — 새 `*.sql` 파일은 `git diff`에 안 보인다(M7, 재현함).
  덧붙여 "마이그레이션이 실제로 적용됐다"를 확인하는 단언이 없어, 잡의 마지막 가정이 열려 있다.
  DB가 아예 없는 경우는 파일이 통째로 지워져 **잡힌다**(확인함).

### 6. §8 — 지금 배포해도 되는가

**된다. 미뤄 둔 세 가지 중 배포를 막는 것은 없다.**

- **UI `stalled` 상태**: 없어도 `getMyStatus`가 `blockedReason`을 pending 카운트와 함께 돌려주므로
  (quota / folder_missing) 사용자가 "왜 멈췄는지"를 알 수 있는 경로는 이미 있다. 비어 있는 것은
  "블록도 아닌데 진행이 안 되는" 상태의 표현이고, 그건 **관측 품질의 문제이지 데이터 안전의
  문제가 아니다.** 이번 라운드에서 실제로 위험한 것들(오귀속·중복)은 전부 원장 쪽이다.
- **P1 테스트(백업 중 연결 끊김, `subscribe()`와 큐잉 순서)**: 안 덮은 것은 사실이지만, 그
  경로의 최악은 "업로드가 안 된다"이고 되돌릴 수 없는 손해는 아니다. 되돌릴 수 없는 쪽
  (중복 업로드)은 원장 + `''` 매칭 안전망이 받고 있고, 그 안전망은 이번 라운드에 medium 테스트로
  고정돼 있다.
- **메뉴 요청 2·4번**: 순수 UX, 사장님 결정 대기. 무관하다.

**대신 배포 전에 두 가지를 하라고 권한다.**

1. **H1을 계획 문서에 적고, 배포 후 재연결 의식에 규칙 하나를 추가한다** — "연결 해제/재연결은
   업로드가 도는 중에 하지 않는다(Jobs 화면에서 대기 0을 확인한 뒤에 한다)". 같은 계정만 쓰는 한
   H1은 무해하지만, 언젠가 다른 계정을 붙이는 날 이 습관이 유일한 방어다.
2. **M8을 사장님에게 미리 말해 둔다** — 만료로 연결이 끊기면 폴더 선택도 사라지므로, 재연결
   뒤에 폴더를 다시 골라야 한다. 모르면 "폴더를 골랐는데 루트에 올라간다"로 보인다.

M1~M5는 전부 **테스트 보강**이고 코드는 옳으므로, 배포와 병행해도 되고 다음 라운드로 미뤄도 된다.
M6·M7은 CI 신뢰도 문제라 배포와 무관하지만, 고치는 데 각각 몇 줄이라 같은 커밋에 넣는 편이 싸다.

---

## What I did not verify

- **CI 잡의 실제 로그 본문.** GitHub API가 잡 로그에 403을 준다(인증 없음). 스텝별 결론
  (전부 success)까지만 확인했고, `Start Postgres`가 몇 초 만에 준비됐는지, `Regenerate`가 정말
  426 쿼리를 썼는지는 러너 위에서 보지 못했다. M6은 **같은 이미지·같은 명령으로 내 기계에서**
  재현한 것이지 러너에서 재현한 것이 아니다.
- **웹 유닛 39개와 svelte-check 베이스라인 게이트.** 이번 다섯 커밋은 `web/`을 건드리지 않았고
  (`git show --stat`) CI의 web 잡이 통과했으므로 다시 돌리지 않았다.
- **전체 서버 스위트 2368개.** `run.sh`의 서버 8스펙(258)과 medium(30)만 직접 돌렸다. 나머지는
  CI 런 `33931116529`의 `Full server + web unit sweep` success에 의존한다.
- **`retry: false`의 런타임 동작.** 라이브러리 소스(`apirequest.js:263`, `gaxios/retry.js:18`,
  `authclient.js:107`)를 읽어 판정했고, 실제로 무응답 상황을 만들어 재시도 횟수를 세지는 않았다.
- **`getStorage`가 실제 구글 5xx에서 어떻게 보이는가.** `isInvalidGrant`의 좁음은 코드 독해와
  googleapis의 오류 형태에 대한 지식으로 판정했다. 실제 5xx 응답을 재현하지는 않았다.
- **운영 DB.** 어떤 조회도 하지 않았다. 6,996행/입양 관련 서술은 CLAUDE.md와 리포트의 기술을
  그대로 인용한 것이다.
- **H1의 발생 빈도.** 경로가 실재함은 재현했지만, 실제 업로드 시간 분포에서 이 창이 얼마나
  자주 열리는지는 측정하지 않았다.

---

## Feeding back into the plan

`dev-docs/google-drive/feature-roadmap.md`(또는 `failure-handling-plan.md`)에 남길 것.

1. **`uploadedAt >= connectedAt`은 "이 연결이 썼다"의 근사이지 등가가 아니다.** 반대 방향
   (`connectedAt`보다 새 행은 이 연결이 썼다)이 거짓이며, 그 반례가 H1이다. 다음에 이 경계를
   손볼 사람이 같은 자리를 다시 발견하지 않도록 시나리오 5줄을 그대로 적어 둔다. 근본 해법은
   시간이 아니라 **원장 행에 쓴 연결의 신원을 함께 남기는 것**이라는 결론도 함께.
2. **`now()` 계열의 안전 방향.** 트랜잭션 시작 시각·커밋 순서는 안전한 쪽으로만 작동하고,
   위험한 것은 (a) 업로드 결정과 원장 기록의 간격, (b) DB 시계 역행 — 이 둘뿐이라는 판정.
   다음 라운드가 시계 이야기를 처음부터 다시 하지 않게.
3. **"변이로 확인했다"는 방향을 함께 적는다.** M2가 그 예다 — 연언을 `false`로 만드는 변이와
   제거하는 변이는 다른 것을 증명한다. 리포트 템플릿의 변이 표에 "어느 방향으로 바꿨는지"를
   칸으로 추가한다.
4. **medium 픽스처의 기본형에 "두 번째 사용자"와 "다른 계정의 원장 행"을 넣는다.** M3/M4/N2가
   전부 같은 뿌리 — 픽스처에 사용자가 하나뿐이라 범위 술어가 공허해진다.
5. **취소 처리는 폴더 선택을 함께 지운다(M8).** 재연결 의식의 일부로 문서화하거나,
   `refreshToken` nullable 마이그레이션을 백로그에 올린다.
6. **CI 계약 두 줄**: 준비 판정은 `globalSetup.ts`와 같아야 한다(로그 2회 또는 TCP 프로브),
   생성물 검사는 `git diff`가 아니라 `git status --porcelain`이어야 한다(untracked).

---

## 워크트리 상태

모든 변이 실험은 원본 사본(`gdr.orig.ts`, `gds.orig.ts`)에서 복원했고, throwaway 스펙 두 개와
임시 `.sql` 파일, postgres 컨테이너(`gd-rev21-pg`)는 전부 제거했다. 마지막
`git status --porcelain` 결과는 **이 리뷰 파일 하나뿐**이다.
작성자 트리 `/home/gwyun/workspace/immich`에는 아무것도 쓰지 않았고, 읽은 것은 리뷰 요청서
1개뿐이다.
