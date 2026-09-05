# Code Review — 여덟 자리는 정말 죽었다 · 남은 두 축의 전수 변이 · N1은 아직 안 고쳐졌다 · 배포 게이트 판정

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `ffc7d181e` |
| Commits reviewed | `b8a4458fb`, `2241e6586` (`git log --oneline 320a003ab..ffc7d181e` = 3, 그중 `ffc7d181e`는 리포트 자신) |
| Report | `../report/google-drive-wave6-round26-user-scope-family-20260905-1215-report.md` |
| Prior review | `./google-drive-wave6-round25-exists-correlation-20260905-1140-review.md` (같은 리뷰어) |
| Reviewed | 2026-09-05 |

## Verdict

**배포를 막는 것은 없다. 이 라운드는 통과다.** 리포트 §1의 표 여덟 줄을 이 HEAD에서 줄 번호로
다시 걸어 전부 재현했고 — 여덟 개 모두 `1 failed | 50 passed (51)` — 게다가 **여덟 개 전부
`-t`로 격리해도 죽는다.** 즉 이번 kill은 앞선 describe가 남긴 잔여 행이 아니라 새 `sharedAlbum`
픽스처가 만든 것이다. 프로덕션 코드 0줄도 사실이고(`git diff 320a003ab..ffc7d181e -- server/src
':!*.spec.ts'` 빈 출력), `.github/`도 안 건드렸으며(0 files), CI `33941074515`는 `head_sha
2241e6586`에 4잡 전부 success다. `tsc --noEmit` exit 0, 새 스펙 파일 `eslint --max-warnings 0`
exit 0.

리포트가 공격을 요청한 **두 축을 전수 변이했다.** 계정 축 11개 변이 중 3개 생존, 소프트삭제 축
13개 변이 중 **10개 생존**이다. 그런데 생존자들을 하나씩 따라가 보면 **되돌릴 수 없는 손해로
이어지는 것이 하나도 없다** — 소프트삭제 축에서 유일하게 일을 *하게* 만드는 두 자리
(`:550`·`:551`, `streamPendingUploads`)는 각각 워커 gate 3(`isAssetInSubscribedAlbum`의 `:646`,
테스트로 지켜짐)과 gate 5(`google-drive.service.ts:1002`, 유닛 테스트 있음)가 받고, 나머지는
전부 화면 숫자다. 계정 축 생존자 셋 중 둘(`:398`·`:452`)도 화면 숫자다.

**가장 중요한 문제는 셋째 생존자다: `LEDGER_MATCHES_CURRENT_ACCOUNT`(`:48`)의 `or … = ''`
폴백을 지우면 medium 51개가 전부 통과한다(M1).** 이건 CLAUDE.md 배포 런북이 "재업로드가 나지
않는 이유"로 명시적으로 기대고 있는 안전망인데, 그 절반이 무방비다. 실 스키마 프로브로 확인했다 —
계정이 식별된 사용자 + `driveAccountId = ''` 원장 행이면 원본은 `count 0`, 변이본은 `count 1`.
운영의 6,996행이 통째로 "대기"로 되살아나는 모양이다. **다만 배포를 막지 않는다**: (1) 코드는
지금 옳고, (2) 이 자리만 회귀해도 워커 gate 2(`hasUpload` → `ledgerMatches`, `:45`의 폴백은
테스트로 지켜짐 — 변이 시 1 failed)가 실제 업로드를 막으므로 손해는 "낭비 + 진행 카드가 안 내려감"이지
중복 파일이 아니다. (3) 이 공백은 이번 커밋이 만든 게 아니라 그 전부터 있었다(`320a003ab`의
스펙으로 같은 변이 → `45 passed`).

그리고 **round-25 N1은 고쳐지지 않았다(M2).** 리포트가 스스로 "확인하지 못했다"고 적은 그 항목이
맞다 — `:298`·`:562`는 여전히 격리 실행에서 살아남고, 전체 실행에서 죽는 이유는 여전히 잔여 행이다.

### Evidence I ran myself

전부 이 워크트리 HEAD(`ffc7d181e`)에서 돌렸다. 변이는 줄 번호로 넣고(전체 줄 삭제 또는 줄 안
부분 삭제), 매 실행 뒤 원본을 복원했다. medium 하네스는 `test/medium/globalSetup.ts:10-48`이
매 실행마다 testcontainer를 새로 띄우고 `IMMICH_TEST_POSTGRES_URL`을 **덮어쓰므로**, 실행 사이
오염은 없고 오염은 한 실행 안에서만 누적된다(이게 M2의 전제다).

| Check | Result |
|---|---|
| `git diff 320a003ab..ffc7d181e -- server/src ':!*.spec.ts'` | **빈 출력** — 프로덕션 코드 0줄, 리포트대로 |
| `git diff --name-only 320a003ab..ffc7d181e` | 4 files: report 1, review 1, results 1, medium spec 1 |
| `git diff --name-only 320a003ab..ffc7d181e -- .github/` | **0** — 리포트 §3 N3의 주장대로 |
| medium (HEAD, 무변이) | `Tests 51 passed (51)` — 리포트의 51과 일치 |
| server unit (`run.sh`의 8스펙, HEAD) | `Test Files 8 passed / Tests 264 passed (264)` — 리포트의 264와 일치 |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx eslint test/medium/specs/repositories/google-drive.repository.spec.ts --max-warnings 0` | exit 0 |
| 첨부 증거 `results/20260905-1208.txt` | `commit: b8a4458fb`, dirty 마커 없음, `RESULT: PASS`, 264/39/51 — 주장대로 |
| CI `runs/33941074515` (api.github.com) | `head_sha 2241e6586`, `conclusion success`, 잡 4개(`Feature suite` / `Medium` / `Full server + web unit sweep` / `Generated SQL is current`) 전부 success |
| `-t "scoping across users"` (무변이) | `6 passed | 45 skipped` — 새 테스트는 **6개**가 맞고, 잔여 행 없이도 통과한다 |
| 실 스키마 프로브 (leftover testcontainer의 `mich`, `begin … rollback`) | M1의 `count 0` vs `count 1` |
| `git status --porcelain` (종료 시) | **이 리뷰 파일 하나뿐.** 소스·스펙은 `git diff --exit-code`로 HEAD와 동일함을 확인 |

**리포트 §1 표의 재현 — 여덟 자리 전부.** "격리"는 그 변이를 건 채 죽는 테스트 하나만 `-t`로
돌린 결과다(`50 skipped`).

| 변이 | 위치 | 전체 실행 | 죽는 테스트 | 격리 실행 |
|---|---|---|---|---|
| `:288` 줄 삭제 | `getSubscribers` 멤버십 상관 | `1 failed | 50 passed` | `should stop returning a subscriber who has lost access to the album` (`spec.ts:1103`) | `1 failed | 50 skipped` ✔ |
| `:366` `.on(…userId)` 제거 | `getSubscribableAlbums` 선택 범위 | `1 failed | 50 passed` | `should not show another user's selection…` (`:1188`) | `1 failed` ✔ |
| `:397` 줄 삭제 | `getSubscribableAlbums` 업로드 범위 | `1 failed | 50 passed` | 같은 테스트 | `1 failed` ✔ |
| `:425` `.on(…userId)` 제거 | `getAlbumBackupStatus` 멤버십 범위 | `1 failed | 50 passed` | `should not report an album as subscribed…` (`:1156`) | `1 failed` ✔ |
| `:428` `.on(…userId)` 제거 | `getAlbumBackupStatus` 선택 범위 | `1 failed | 50 passed` | 같은 테스트 | `1 failed` ✔ |
| `:451` 줄 삭제 | `getAlbumBackupStatus` 업로드 범위 | `1 failed | 50 passed` | `should count only the caller's own uploads…` (`:1129`) | `1 failed` ✔ |
| `:480` `.onRef(…)` 제거 | `countPendingUploads` 멤버십 상관 | `1 failed | 50 passed` | `should not count another user's pending asset…` (`:1207`) | `1 failed` ✔ |
| `:547` 줄 삭제 | `streamPendingUploads` 원장 상관 | `1 failed | 50 passed` | `should not let one selector's ledger row suppress…` (`:1079`) | `1 failed` ✔ |

**여덟 개 모두 "잘못된 이유로 죽는" 경우가 아니다.** 각각의 kill이 격리에서도 재현되므로,
`sharedAlbum`(`spec.ts:61-68`)이 만든 상태가 실제로 그 술어를 관측하고 있다.

---

## Findings

### M1 (Medium) — `LEDGER_MATCHES_CURRENT_ACCOUNT`의 `''` 폴백은 무방비다. 런북이 기대는 바로 그 안전망이다

**계정 축 전수 변이.** `ledgerMatches`(`:44-45`)와 `LEDGER_MATCHES_CURRENT_ACCOUNT`(`:48`)를 쓰는
7개 자리 + 두 헬퍼 자체의 두 방향(계정 등가 제거 / `''` 폴백 제거)을 각각 걸었다.

| 변이 | 위치 | 메서드 | 결과 |
|---|---|---|---|
| A1 `:398` `.on(ledgerMatches(userId))` 제거 | 업로드 조인 | `getSubscribableAlbums` | **survives** (`51 passed`) |
| A2 `:452` 같은 제거 | 업로드 조인 | `getAlbumBackupStatus` | **survives** |
| A3 `:488` `.on(LEDGER_…)` 제거 | 업로드 조인 | `countPendingUploads` | killed (1) |
| A4 `:548` 같은 제거 | 업로드 조인 | `streamPendingUploads` | killed (1) |
| A5 `:599` 줄 삭제 | `.where(ledgerMatches)` | `getUploadedAssetIds` | killed (1) |
| A6 `:672` 줄 삭제 | `.where(ledgerMatches)` | `hasUpload` (gate 2) | killed (3) |
| A7 `:860` `.on(ledgerMatches(userId))` 제거 | 오류 조인 | `getErrorSummary` | killed (1) |
| A8 `:45`에서 ` or "…"."driveAccountId" = ''` 삭제 | `ledgerMatches`의 `''` 폴백 | (7곳 중 5곳) | killed (1) |
| **A9 `:48`에서 같은 절 삭제** | `LEDGER_…`의 `''` 폴백 | `countPendingUploads` · `streamPendingUploads` | **survives (`51 passed`)** |
| A10 `:45`에서 계정 등가 삭제 | | | killed (4) |
| A11 `:48`에서 계정 등가 삭제 | | | killed (2) |

**A9가 지키는 상태는 도달 가능한 정도가 아니라 지금 운영에 있는 상태다.** 실 스키마 프로브
(`mich` 템플릿, `begin … rollback`): 사용자 1명, 연결됨 + `driveAccountId = 'acct-a'`(식별 완료),
앨범 선택, 자산 1개, 원장 행 `driveAccountId = ''`(운영에 6,996개 있는 바로 그 행).

```
--- REAL countPendingUploads (fallback present) ---   count = 0
--- MUTANT A9 (fallback removed)              ---   count = 1
```

즉 이 폴백이 깨지면 **이미 올린 6,996장이 통째로 "대기"로 되살아나고 `streamPendingUploads`가
전부 다시 큐잉한다.** CLAUDE.md의 배포 절차가 문자 그대로 이걸 근거로 삼는다(`CLAUDE.md:406-407`:
"미상(`''`) 행이 계정 식별 뒤에도 계속 '업로드됨'으로 매칭되는 것이 그 안전망이다 —
`files.create`에 멱등 검사가 없어 중복은 되돌릴 수 없으므로").

**그런데 이것이 배포를 막지 않는 이유는 세 가지다.**

1. **코드는 지금 옳다.** 변이는 회귀 감지 능력을 재는 것이지 결함을 보인 게 아니다.
2. **이 자리만 회귀해도 중복 업로드는 나지 않는다.** 워커 gate 2는
   `hasUpload`(`google-drive.service.ts:947` → `repository.ts:672`)이고 그건 `ledgerMatches`(`:45`)를
   쓴다. `:45`의 폴백은 A8이 보여주듯 테스트로 지켜지고 있다(`should keep treating unstamped rows
   as uploaded even once the account is known`). 그래서 A9 단독 회귀의 실질 손해는
   **잡 6,996개의 낭비 + 진행 카드가 영영 0으로 안 내려감**이다. `:45`와 `:48`을 함께 고치는
   회귀(주석 `:47`이 "Same comparison for…"라 실제로 함께 고칠 만하다)는 A8이 잡는다.
3. **이번 커밋이 만든 공백이 아니다.** `320a003ab`의 스펙 파일로 되돌린 채 같은 A9 변이를 걸면
   `45 passed` — 그 전에도 무방비였다.

**가장 작은 고침 (테스트만, 프로덕션 0줄).** 이미 있는 `should keep treating unstamped rows as
uploaded even once the account is known`은 `hasUpload`/`getUploadedAssetIds`(=`:45` 경로)만 묻는다.
같은 픽스처에 **한 줄**을 더해 `:48` 경로도 묻게 하면 끝난다:

```ts
await expect(sut.countPendingUploads(user.id)).resolves.toBe(0);
```

계정이 식별된 사용자 + `''` 원장 행 + 선택된 앨범이 이미 그 테스트에 있으므로 픽스처 추가는
필요 없다. (원한다면 `drain(sut.streamPendingUploads(user.id))`가 `[]`인 것도 같이.)

### M2 (Medium, 그러나 배포와 무관) — round-25 N1은 고쳐지지 않았다. `:298`·`:562`는 여전히 잔여 행으로 죽는다

리포트 §3이 "확인하지 못했다"고 적은 항목의 답은 **아니오**다.

| 변이 | 전체 실행 | 격리 실행 |
|---|---|---|
| `:298` 삭제 (`getSubscribers`의 오류 상관) | `2 failed | 49 passed` — `should still return a user whose only failures are ordinary ones` + `should stop returning a subscriber who has lost access to the album` | 두 테스트 각각 `-t`로 → **둘 다 `1 passed`** |
| `:562` 삭제 (`streamPendingUploads`의 오류 상관) | `2 failed | 49 passed` — `should move the pending count with the connected account` + `should not let one selector's ledger row suppress another's pending asset` | 두 테스트 각각 `-t`로 → **둘 다 `1 passed`** |

새 `sharedAlbum` 테스트가 전체 실행에서 함께 죽는 것은 **덮었기 때문이 아니라, 그 시점에 앞선
describe가 남긴 차단 오류 행이 DB에 있기 때문**이다. 새 테스트들은 `google_drive_upload_error`
행을 하나도 만들지 않는다(`spec.ts:1078-1238`에 `upsertError` 호출 없음). 그래서 이 두 자리는
round-25와 **정확히 같은 상태**로 남아 있다 — "오늘의 실행 순서에서 우연히 덮임".

**배포를 막지 않는다.** 두 술어가 지키는 것은 "차단된 *다른* 사용자의 오류 행이 내 구독/스트림을
막지 않는다"이고, 회귀하면 **일을 덜 하는** 방향(업로드가 안 됨)이지 중복이 아니다. 그리고 이
배포본에는 Drive를 연결한 사용자가 한 명뿐이라 `google_drive_upload_error`의 다른 사용자 행 자체가
없다.

**가장 작은 고침.** 새 `scoping across users` describe에 테스트 하나:

```
sharedAlbum → 두 사용자 모두 연결 + 선택
A에게만 upsertError(QuotaExceeded)
expect: getSubscribers([album])에 B가 있다        // :298
expect: drain(streamPendingUploads(B))에 자산이 있다  // :562
expect: getSubscribers([album])에 A는 없다          // 목격자 — 픽스처가 살아 있음을 증명
```

마지막 줄이 중요하다. B가 있다만 단언하면 `upsertError`가 아무것도 안 써도 통과한다.

### N1 (Nit) — 소프트삭제 축은 13개 중 10개가 생존하지만, 위험한 두 자리는 뒤에 그물이 있다

`deletedAt` 술어 13개를 전부 줄 삭제로 걸었다.

| 변이 | 메서드 | 결과 | 회귀 시 무슨 일이 나는가 |
|---|---|---|---|
| `:292` `album.deletedAt` | `getSubscribers` | killed (1) | — |
| `:372` `album.deletedAt` | `getSubscribableAlbums` | **survives** | 삭제된 앨범이 설정 목록에 뜬다 (표시) |
| `:388` `asset.deletedAt` | `getSubscribableAlbums` (assetCount) | **survives** | 총계가 부풀려짐 (표시) |
| `:401` `asset.deletedAt` | `getSubscribableAlbums` (uploadedCount) | **survives** | 진행률이 부풀려짐 (표시) |
| `:431` `album.deletedAt` | `getAlbumBackupStatus` | **survives** | 삭제된 앨범의 카드가 살아 있음 (표시) |
| `:442` `asset.deletedAt` | `getAlbumBackupStatus` | **survives** | 표시 |
| `:455` `asset.deletedAt` | `getAlbumBackupStatus` | **survives** | 표시 |
| `:491` `album.deletedAt` | `countPendingUploads` | **survives** | 진행 카드가 0으로 안 내려감 (표시) |
| `:492` `asset.deletedAt` | `countPendingUploads` | **survives** | 같음 (표시) |
| `:550` `album.deletedAt` | `streamPendingUploads` | **survives** | **일을 함** → gate 3이 받는다 |
| `:551` `asset.deletedAt` | `streamPendingUploads` | **survives** | **일을 함** → gate 5가 받는다 |
| `:646` `album.deletedAt` | `isAssetInSubscribedAlbum` | killed (1) | — |
| `:863` `asset.deletedAt` | `getErrorSummary` | killed (1) | — |

**`:550`의 그물**: 워커 gate 3(`google-drive.service.ts:958`)이 `isAssetInSubscribedAlbum`을 부르고,
그 안의 `album.deletedAt is null`(`:646`)은 테스트로 지켜진다(`should be false once the album is
soft-deleted, matching the stream predicate`). 소프트삭제된 앨범의 자산이 큐잉되더라도 실행 시점에
걸린다 — 유출이 아니라 낭비다.

**`:551`의 그물**: gate 5(`google-drive.service.ts:1002`, `if (asset.deletedAt) return 'skipped'`)가
받는다. 그 gate는 유닛 스펙에 있다(`google-drive.service.spec.ts:1684` `describe('trashed assets')`,
`:1690`에서 `getById`가 `deletedAt` 있는 행을 준다). 코드 주석(`repository.ts:630`)도 "여기서는
일부러 안 본다, gate 5가 본다"라고 그 분업을 적어 두었다.

그래서 이 열 자리는 **전부 표시 품질이거나 이중 방어**다. 고칠 값어치는 있지만 배포와 직렬로
묶을 이유가 없다. 표시 쪽을 한 번에 닫고 싶으면 `sharedAlbum` 픽스처에 소프트삭제 한 줄을 더한
테스트 하나로 `:372`·`:388`·`:431`·`:442`·`:491`·`:492`를 같이 잡을 수 있다.

### N2 (Nit — 그러나 이 라운드의 진짜 교훈) — 사용자 축을 고정하려고 계정을 통일한 대가로, 그 픽스처는 계정 축을 볼 수 없게 됐다

A1(`:398`)·A2(`:452`)가 생존하는 이유는 우연이 아니다. 리포트 §2가 스스로 설명한 그 수정
— "두 사용자를 같은 구글 계정에 붙였다"(`spec.ts:1134-1136`, `:1194-1196`의 주석) — 때문에
**그 테스트들은 원장의 계정 술어를 관측할 수 없다.** 두 사용자가 같은 계정이면
`ledgerMatches`는 항상 참이라, 지워도 답이 같다.

이건 결함이 아니라 **한 픽스처가 두 축을 동시에 잡을 수 없다는 구조적 사실**이다. 리포트가
"계정이 다르면 사용자 범위가 가려진다"를 발견한 것의 정확한 쌍대다: 계정이 같으면 계정 범위가
가려진다. 다음 사람이 알아야 할 규칙은 "픽스처를 고칠 때 무엇이 가려졌는지 함께 적는다"이다.

`:398`·`:452`가 회귀하면 **다른 계정으로 재연결한 뒤 옛 계정의 원장 행이 진행률에 섞여** 앨범이
다 백업된 것처럼 보인다. 표시 오류이고, 실제 업로드 경로(`:488`·`:548`·`:672`)는 지켜지고 있으므로
파일은 정상적으로 올라간다. 나이트다. 고치려면 `getAlbumBackupStatus`용 테스트에 "다른 계정의
원장 행은 uploadedCount에 안 들어간다" 한 줄이면 된다 — 단, **같은 테스트에 넣지 말고 별도로**.
같은 픽스처에 두 축을 넣으면 방금 말한 상호 은폐가 다시 일어난다.

### N3 (Nit) — 배포 런북이 입양 경계를 아직 **시간**으로 설명한다. 코드는 `connectionId`다

`CLAUDE.md:402-403`:

> **`unstamped`는 0이 되지 않는 것이 정상이다.** 입양은 *그 연결이 쓸 수 있었던* 행만 가져간다
> (`uploadedAt >= connectedAt`). 배포 전에 올라간 6,996행은 지금 연결보다 오래됐으므로…

코드는 그렇지 않다. `adoptUnstampedUploads`의 두 문장은 각각
`.where('connectionId', '=', connection.connectionId)`(`repository.ts:198`, `:214`)이고,
`uploadedAt`은 이 파일에서 **주석에만** 남아 있다(`:181`: "The previous version compared
timestamps (`uploadedAt >= connection.connectedAt`) and was …"). round-22 M3이 같은 문서의
드레인 문단은 고쳤고(`CLAUDE.md:416-419`가 정확히 `connectionId`로 설명한다), **입양 문단만
남았다.** 문서가 15줄 간격으로 자기와 어긋나 있다.

결론(“`unstamped`는 0이 안 된다, 그래도 재업로드는 안 난다”)은 여전히 옳다. 틀린 것은 이유이고,
이유가 틀리면 **관측이 틀린다**: 시간 경계라면 "새 연결 이후 행은 입양될 것"이지만 실제로는
`connectionId`가 null인 6,996행은 **영원히** 입양되지 않는다. 고침은 한 문장:

> 입양은 **그 연결이 직접 쓴** 행만 가져간다(`connectionId` 등가). 배포 전에 올라간 6,996행은
> `connectionId`가 비어 있어 영원히 미상으로 남고, 그래도 "업로드됨"으로 매칭되므로 재업로드는
> 나지 않는다.

---

## Answers to what the report asked me to attack

### 1. 두 픽스처 함정이 남은 테스트에도 해당하는가 — 계정 축

**해당한다. 생존 3개(A1 `:398`, A2 `:452`, A9 `:48`).** 전수표는 M1에 있다.

- **A9(`:48`의 `''` 폴백)**: 상태 도달 가능 — 지금 운영 DB가 그 상태다(식별된 계정 + `''` 행
  6,996개). 뒤의 그물 — **있다.** gate 2(`hasUpload` → `:45`의 폴백, A8이 지킴)가 실제 업로드를
  막아 중복은 안 난다. 남는 손해는 낭비와 안 내려가는 카드.
- **A1(`:398`) / A2(`:452`)**: 상태 도달 가능 — 다른 구글 계정으로 재연결하면. 뒤의 그물 —
  표시 경로라 그물이 필요 없다(업로드 경로는 별도 술어로 지켜짐). 원인은 N2에 적었다.

### 2. 두 픽스처 함정이 남은 테스트에도 해당하는가 — 소프트삭제(시간) 축

**해당한다. 13개 중 10개 생존.** 전수표는 N1에 있다. 도달 가능성은 전부 일상적이다(사진을
휴지통에 넣거나 앨범을 지우면 된다). **뒤의 그물**: 일을 *하게* 만드는 두 자리(`:550`·`:551`)는
각각 gate 3(`:646`, 테스트 있음)과 gate 5(`service.ts:1002`, 유닛 테스트 있음)가 받는다.
나머지 여덟 자리는 화면 숫자여서 그물이라는 개념이 적용되지 않는다 — 틀리면 그냥 틀린 숫자가
보인다.

### 3. round-25 N1 — 새 `sharedAlbum` 픽스처가 `:298`·`:562`를 덮는가

**덮지 않는다.** M2에 격리 실행 결과를 적었다: 네 조합(변이 2 × 죽는 테스트 2) 모두 `-t` 격리에서
`1 passed`. 새 테스트들은 오류 행을 하나도 만들지 않으므로, 그 두 술어를 관측할 수단이 없다.
리포트가 "확인하지 못했다"고 유보한 것은 옳은 판단이었다.

### 4. 배포를 막는 것이 나오는가

**나오지 않는다.** 명시적으로:

- 이 두 커밋의 프로덕션 변경은 **0줄**이다. 런타임 동작이 문자 그대로 동일하므로 배포 위험이
  늘지도 줄지도 않았다.
- M1·M2·N1·N2는 전부 **테스트 커버리지 공백**이고 코드는 옳다. 셋 다 배포 후에 닫아도 된다.
- N3은 문서다. 다만 **배포 당일 읽는 문서**이므로 배포 전에 한 문장 고치는 편이 싸다.
- round-25가 "두 번째 Drive 사용자가 생기는 날 배포 게이트로 승격된다"고 지목한 `:547`은
  **이번 라운드로 해소됐다** — `spec.ts:1079`가 정확히 그 픽스처를 만들고, 격리 실행에서도 죽는다.
  그 조건부 게이트는 이제 없다.

---

## 배포 절차 — rounds 21~26이 만든 항목을 순서대로 한 목록으로

여섯 개 리뷰를 다시 읽지 않아도 되도록 합쳤다. 출처를 괄호에 적었다.

**A. 배포 전**

1. **redirect 파생이 살아 있는지 확정한다 (유일한 하드 게이트, round-25).**
   `server.externalDomain`과 `googleDrive.redirectUrl` 중 **최소 하나가 채워진 상태**로 배포한다.
   둘 다 비면 `isGoogleDriveEnabled`가 거짓이 되어 **에러 없이** 기능이 꺼진다. 관리자 폼의 안내
   ("비워두면 External Domain을 쓴다")를 따라 `redirectUrl`을 지우는 것이 정확히 그 상태를 만든다.
2. **백업.** `ssh 랩탑 'pg_dumpall | gzip > ~/immich-backups/immich-db.$(date +%F-%H%M).sql.gz'`
   (CLAUDE.md §1·§7).
3. **업스트림 다운그레이드가 아닌지 확인.** `git merge-base --is-ancestor <운영 태그> HEAD`
   (CLAUDE.md §9).
4. **런북 한 문장 고치기 (N3).** `CLAUDE.md:402-403`의 입양 경계를 `connectionId`로. 안 고치면
   5번 단계의 관측을 잘못 해석하게 된다.
5. **사장님에게 미리 알린다 (round-21 §6-2, M8).** 연결이 만료·취소되면 `user_google_drive` 행이
   통째로 지워지고 폴더 선택도 함께 사라진다. **재연결 뒤에는 폴더를 다시 골라야 한다.** 모르면
   "폴더를 골랐는데 루트에 올라간다"로 보인다.

**B. 배포 직후 (순서가 중요하다)**

6. **설정 화면을 열기 *전에* `getGoogleDriveStatus`의 `enabled`가 `true`인지 확인한다 (round-25).**
   1번이 지켜졌는지를 코드에게 직접 묻는 단계다. 실패가 조용하기 때문에 화면을 먼저 열면 원인이
   가려진다.
7. **설정 화면을 한 번 연다.** 이 단계가 트리거하는 것은 **계정 식별(`setDriveAccountId`)**이다.
   round-22가 정정했듯 **기존 6,996행에 대한 입양은 여기서 일어나지 않는다**(그 행들은
   `connectionId`가 null이라 입양·드레인 대상이 아니다). 신원 프로브에는 사용자당 60초 쿨다운이
   있으니 `(unidentified)`면 1분 뒤 다시 연다. 서버 로그의 `did not report a permissionId` /
   `Could not read the Google Drive account id`를 함께 본다.
8. **사용자별 `drive_account` / `unstamped`를 본다** (CLAUDE.md §7의 heredoc 쿼리). 판정 기준:
   - **`drive_account`가 하나뿐이고, 배포 전후로 바뀌지 않는다** ← 이것이 진짜 관문
     (round-23/24). 값 자체는 Drive의 `permissionId`라 사람이 읽는 주소가 아니다. 둘이 나오거나
     나중에 달라졌으면 다른 계정이 붙은 것이고, 그때가 §1의 "운영 데이터에 손대기 전 확인" 순간이다.
   - **`unstamped`는 0이 되지 않는 것이 정상이다.** 관문이 아니라 감시 지표다. **배포 후 갑자기
     늘어나면** 그때가 이상 신호다(M1이 회귀하면 이 숫자가 아니라 *대기 수*가 튄다 — 아래 9번).
9. **진행 카드의 대기 수를 한 번 본다.** M1이 지적한 자리가 회귀했다면 여기서 6,996 근처 숫자가
   나타난다. 정상은 0(또는 실제 신규분)이다. 파일이 중복으로 올라가지는 않지만(gate 2), 잡이
   낭비되므로 보이면 즉시 롤백 판단 재료다.

**C. 운영 습관으로 남길 것**

10. **연결 해제·재연결은 업로드가 도는 중에 하지 않는다 (round-21 H1).** Jobs 화면에서 대기 0을
    확인한 뒤에 한다. 같은 계정만 쓰는 한 H1은 무해하지만, 언젠가 다른 계정을 붙이는 날 이 습관이
    유일한 방어다.
11. **배포 후에 M8(`refreshToken` nullable + CAS를 `connectionId`로) (round-23/24).** 배포 전이
    아니어야 하는 이유는 round-23 §6에 있다 — 입양의 CAS가 `where refreshToken = ?` +
    `forUpdate()`에 걸려 있어서 두 곳을 함께 바꿔야 하고, 이번 배포의 관문이 아니다.
12. **두 번째 사용자가 Drive를 연결하는 날**, `:547`은 이제 테스트로 막혀 있으므로 게이트가
    아니다(round-25의 조건부 승격은 해소됐다). 대신 그때 확인할 것은 M2의 두 자리(`:298`·`:562`)와
    N2의 계정 축이다 — 둘 다 "일을 덜 하는" 방향이라 조용히 틀린다.

---

## What I did not verify

- **web 유닛 39개와 svelte-check 베이스라인 게이트.** 이 워크트리에는 web 의존성이 설치돼 있지
  않다 — `npx vitest run` 이 `Cannot find package '@sveltejs/enhanced-img' … from
  /home/gwyun/workspace/immich-review/node_modules/.vite-temp/…`로 죽는다. 이 두 커밋은 `web/`을
  전혀 건드리지 않았고(`git diff --name-only` 4파일) CI의 `Full server + web unit sweep`이
  success이므로 그것에 의존했다. **돌리지 못했다는 뜻이지, 돌려서 통과했다는 뜻이 아니다.**
- **전체 서버 스위트.** `run.sh`의 8스펙(264)과 medium(51)만 직접 돌렸다. 나머지는 CI 런
  `33941074515`에 의존한다.
- **CI 잡의 로그 본문.** 인증 없이 GitHub API가 잡 로그에 접근을 주지 않는다. 잡별 `conclusion`
  까지만 확인했다.
- **실 스키마 프로브에 쓴 컨테이너.** 앞선 medium 실행이 남긴 testcontainer(`determined_morse`)의
  `mich` 템플릿을 썼다. 이 HEAD에서 새로 마이그레이션을 돌린 컨테이너가 아니다 — 프로브가 쓴
  컬럼이 전부 존재하고 쿼리가 `src/queries/google.drive.repository.sql:224-278`의 생성물과
  글자 그대로 같다는 것까지만 확인했다.
- **사용자·계정·소프트삭제 **이외의** 축.** 오류 클래스 목록, 앨범/자산 조인 키, `limit`,
  `distinct` 같은 술어는 변이하지 않았다. 이번 라운드가 요청한 세 축만 전수했다.
- **브라우저 경로와 실제 구글 API.** 설정 화면이 실제로 신원 프로브를 트리거하는지는 이 라운드에서도
  코드 독해로만 확인했다(round-23·24와 동일). 운영 DB에는 손대지 않았다.
- **M1의 회귀가 실제 워커에서 어떻게 보이는가.** gate 2가 막는다는 것은 코드 경로(`service.ts:947`
  → `repository.ts:672` → `ledgerMatches`)와 A8/A6 변이 결과로 판정했고, A9를 건 채 워커를 돌려
  잡 6,996개가 스킵되는 것을 세지는 않았다.

---

## Feeding back into the plan

`dev-docs/google-drive/feature-roadmap.md`에 남길 것:

1. **원장 계정 술어는 헬퍼가 둘이고, 지켜지는 것은 하나 반이다.** `ledgerMatches`(`:45`)는
   폴백·계정 등가 양쪽 다 테스트가 있고, `LEDGER_MATCHES_CURRENT_ACCOUNT`(`:48`)는 계정 등가만
   있다. **`''` 폴백이 이 기능의 중복 방지 안전망 전체**인데 `:48` 쪽은 무방비다(M1). 고침은
   기존 테스트에 `countPendingUploads … toBe(0)` 한 줄.
2. **부정 kill은 격리에서 재확인한다.** 이번에 여덟 자리가 격리에서도 죽는 것을 확인했고,
   `:298`·`:562`는 여전히 안 죽는다(M2). medium 스펙은 파일 하나가 DB 하나를 공유하므로
   (`globalSetup.ts`가 실행마다 컨테이너를 새로 띄우고, `getKyselyDB`가 파일당 DB 하나를 만든다)
   **전체 실행의 kill은 증거가 아니다.** 변이표에 "격리" 열을 상시로 둔다.
3. **한 픽스처는 한 축만 잡는다.** 계정을 통일해 사용자 축을 드러낸 대가로 계정 축이 가려졌다(N2).
   픽스처를 고칠 때는 **무엇이 가려졌는지 주석에 함께 적는다** — 리포트 §2가 절반을 이미
   그렇게 했고, 나머지 절반(가려진 쪽)이 빠져 있다.
4. **소프트삭제 축의 열 자리는 표시이거나 이중 방어다(N1).** 스트림의 두 자리는 gate 3(`:646`)과
   gate 5(`service.ts:1002`)가 받는다는 분업을 명시해 두면, 다음 사람이 "왜 스트림에는 테스트가
   없나"에서 멈추지 않는다.
5. **런북의 입양 경계를 `connectionId`로 고친다(N3).** 같은 문서가 15줄 간격으로 시간 경계와
   신원 경계를 둘 다 말하고 있다. round-22 M3이 드레인 문단만 고쳤다.
6. **배포 체크리스트는 이 리뷰의 "배포 절차" 절을 그대로 옮긴다.** 21~26라운드가 만든 항목이
   여섯 문서에 흩어져 있었고, 배포 당일에 여섯 개를 다시 읽는 것은 현실적이지 않다.

---

*이 리뷰를 쓰는 동안 만든 변이는 전부 원본으로 복원했고, 종료 시점의
`git status --porcelain` 출력은 이 리뷰 파일 하나뿐이다. 소스와 스펙은 `git diff --exit-code`가
빈 출력임을 확인했다.*
