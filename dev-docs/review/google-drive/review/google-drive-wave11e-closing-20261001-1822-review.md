# Code Review — wave11e (closing round): wave11d 반영분

| | |
|---|---|
| Branch / HEAD | `feat/google-drive-album-sync-v3.1.0` / `3458caadf` (작업 트리 = HEAD, dirty 는 ` M mise.lock` 뿐) |
| Commits reviewed | `68765f1ae..3458caadf` (3 commits: 코드 인접 `2409a8597`, 문서 `c0e99a0d7`, 요청서+증거 `3458caadf`) |
| Report | ../report/google-drive-wave11e-closing-20261001-1820-report.md |
| Reviewed | 2026-10-01 |

## Verdict

**NOT BLOCKED.** 이 범위에 런타임 코드 변경은 없다 — `git show 2409a8597 --stat` 은 `enum.ts` +7 (주석)과
`google-drive.service.spec.ts` +3 (단언 한 줄) 뿐이고, 나머지는 문서다. 요청서가 공격해 달라고 한 셋을 모두 코드와
실행으로 확인했다. (1) N1 의 클래스 간 누적은 `attempts` 의 모든 독자(DTO·설정 화면·`getFailures`·상한 술어, 그리고
요청서가 빠뜨린 F7 로그)에 대해 일관되고, "다섯 번 시도했고 마지막이 rate limit 이 아니다"는 상한 술어
`google-drive.repository.ts:642-643` 가 실제로 계산하는 것과 정확히 같다 — 재설계는 필요 없다. (2) R4 주장은 변이로
재현했다: 두 `clearRevokedGrant` 호출을 `void 0` 로 바꾸면 정확히 그 두 테스트가 빨간불이고, `clearRevokedGrant`
(`service.ts:468-474`) 는 `deleteCredentials` 와 throw 만 하므로 Revoked 행은 쓰이지 않는다. (3) 문서는 한 곳이 어긋난다 —
플랜의 V11 행(`stabilization-plan.md:96`)이 여전히 "records `Revoked`" 라고 적혀 있고, 60줄 아래(`:155`)에서 그 문장이
틀렸다고 말한다. 커밋 메시지는 "V11 is re-worded" 라고 하지만 고쳐진 것은 `CLAUDE.md` 의 행뿐이다. 가장 중요한 발견은
N1 이다: `google-drive-upload-error.table.ts:50-52` 의 컬럼 주석이 "there is no retry cap" 이라고 말한다 — R3 이전
문장이고, 요청서가 "내가 놓친 `attempts` 독자가 있는가" 라고 물은 것에 대한 답이 바로 이것이다(코드가 아니라 주석이지만
`enum.ts:1237-1243` 과 정면으로 충돌한다). 둘 다 문서 수정이고 배포를 막지 않는다.

### Evidence I ran myself

변이는 전부 스크래치패드에 `git worktree add --detach … 3458caadf` 로 만든 사본(`node_modules` 심링크)에서 돌리고
`git checkout --` 로 원복한 뒤 `git status --porcelain` 이 `?? node_modules` 뿐임을 확인했다. 리뷰 끝에 워크트리는
`git worktree remove --force` 로 지웠다. 메인 트리에서는 읽기 전용 명령만 돌렸다.

| Check | Result |
|---|---|
| `git log --oneline 68765f1ae..3458caadf` | 3 commits — 요청서의 범위(`..c0e99a0d7`)에 요청서 커밋 하나가 더해진 것 |
| `git show 2409a8597 --stat` | `enum.ts` +7, `google-drive.service.spec.ts` +3 — "No runtime code changed" 와 일치 |
| `dev-test/google-drive/results/20261001-1814.txt` | 헤더 `commit: c0e99a0d7 … M mise.lock`, server 328/328 (8 files), web 87/87, svelte-check 회귀 없음, medium 72/72, `RESULT: PASS` — 리포트 표와 일치 |
| 워크트리 `vitest` `google-drive.service.spec.ts` (기준선) | **126 passed** |
| 메인 트리 `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| 메인 트리 `npx eslint src/enum.ts src/services/google-drive.service.spec.ts --max-warnings 0` | exit 0 |
| 메인 트리 전체 `npx vitest run --config test/vitest.config.mjs` | **94 files, 2455 passed / 2 skipped**, exit 0 — 리포트 수치와 일치 |
| 변이 1 — `utils/google-drive.ts:59` `return code ? … : where` → `return where` (errno 접미사 제거) | **red 2**: "should report the path it actually failed on, not the stale one" (N4 의 새 단언) **와** "should not follow the move row when the first read failed for a reason other than ENOENT" (기존 `[EMFILE]` 단언). mid-upload `[EIO]` 테스트는 다른 코드 경로(`service.ts:1506`)라 녹색 유지 — 정상 |
| 변이 2 — `service.ts:906`·`:1093` 의 `await this.clearRevokedGrant(…)` 둘 다 `void 0` | **red 2**: "getStorage › should report a revoked grant as disconnected…", "getPickerConfig › should clear a revoked grant instead of only refusing" — 둘 다 `expected Error: x … to be an instance of BadRequestException` 에서 멈춤 (뒤의 `deleteCredentials` 단언도 실패했을 것). 다른 124 는 녹색 |
| 변이 3 — `service.ts:1354-1357` 스트림 `'error'` 리스너 블록 삭제 (V12 재확인) | **red 1**: "should turn a read error on the file stream into a recorded failure, not a crash" |
| `git status --porcelain` (리뷰 파일 작성 후) | ` M mise.lock` (기존) + 이 리뷰 파일 — 아래 "What I did not verify" 끝 |

medium 은 다시 돌리지 않았다 — 이 범위에 리포지토리·SQL 변경이 없고, 결과 파일이 `c0e99a0d7` 에서 72/72 를 기록하며
wave11d 리뷰가 같은 스펙을 일회용 Postgres 에서 재현한 바 있다.

## Findings

### N1 — 오류 테이블의 컬럼 주석이 "there is no retry cap" 이라고 말한다 (Low, 코드 주석 — 요청서 item 1 의 답)

`server/src/schema/tables/google-drive-upload-error.table.ts:50-52` (HEAD `3458caadf` 기준):

```
  // How many times this (user, asset) pair has failed. Purely informational: there is no retry
  // cap (a known, accepted long-tail — see the failure-handling plan §4), but surfacing the count
  // lets a human spot the asset that has failed 40 times and deal with it.
```

R3 가 `GOOGLE_DRIVE_MAX_UNATTENDED_ATTEMPTS` 를 넣은 뒤로 거짓이고, 이번 커밋이 `enum.ts:1237-1243` 에 적은 설명
("`attempts` counts every recorded failure … the cap reads as 'five tries …'")과 정면으로 충돌한다. `attempts` 의 의미를
찾는 사람이 가장 먼저 여는 파일이 스키마이므로, 요청서가 "내가 놓친 독자가 있는가" 라고 물은 것에 대한 답은 이것이다 —
코드 독자가 아니라 문서 독자이고, 그 독자가 지금 반대 결론을 읽는다. 인용된 `failure-handling-plan.md:152-153` 도
"제안: 상한 없이 두되 설정 UI에서 attempts를 보여줘" 로, R3 에서 뒤집힌 결정의 원안이다.

**Fix:** 주석을 "Bumped on every recorded failure regardless of class (see `GOOGLE_DRIVE_MAX_UNATTENDED_ATTEMPTS` for why);
the nightly backfill stops queueing a capped-class asset at that constant, the settings page shows the raw count" 정도로 바꾸고,
`failure-handling-plan.md:152-153` 에 "→ wave11 R3 에서 상한 5 로 결정, `stabilization-plan.md` F3" 한 줄을 단다. 코드
변경이 아니므로 다음 라운드 없이 docs 커밋으로 닫아도 된다.

### N2 — 플랜의 V11 행은 고쳐지지 않았다 (Nit, 문서 — 요청서 item 3)

`dev-docs/google-drive/stabilization-plan.md:96`:

```
| V11 | Revoked token on `getStorage`/`getPickerConfig` clears grant, records `Revoked` | service spec | task | Skip clearRevokedGrant → fails |
```

같은 파일 `:154-156` 은 "The plan's wording 'records `Revoked`' was also wrong … V11 is re-worded" 라고 쓰고, 커밋
`c0e99a0d7` 의 메시지도 그렇게 말한다. 실제로 재작성된 것은 `CLAUDE.md:721` 의 V11 행뿐이다(diff 로 확인: 플랜 쪽 hunk 는
`:91` V6 와 `:148-156` task 10 두 곳). 리뷰어가 V11 을 플랜에서 읽으면 "Revoked 행이 기록된다" 를 검증하려 들고, 그 단언은
존재하지 않는다(`spec.ts:1599-1619`, `:1964-1978` 은 `deleteCredentials` 와 `BadRequestException` 만 본다).

**Fix:** `:96` 을 CLAUDE.md 행과 같은 내용으로 — "clears grant (no `Revoked` row: the error table is keyed (user, asset)
with an asset FK, and these paths have no asset) — covered by existing tests, mutation-checked 2026-10-01".

### N3 — N5 의 배포 후 메모는 플랜에만 있고 `CLAUDE.md` §7 에는 없다 (Nit, 운영 문서)

wave11d N5 는 "§7 과 플랜의 관찰 단계에 한 줄" 을 제안했다. 플랜 `:195-198` ("Reading the pending count after deploy") 은
들어갔지만 `CLAUDE.md:502` 의 배포 직후 8번("진행 카드의 대기 수를 한 번 본다 — `''` 매칭이 회귀했다면 6,996 근처")은
그대로다. 요청서의 변경 표가 `CLAUDE.md, plan | … post-deploy note on reading the pending count (N5)` 로 묶어 적어
둘 다 반영된 것처럼 읽히지만, `git show c0e99a0d7 -- CLAUDE.md` 의 hunk 는 V6·V11 두 행뿐이다. 배포 당일 체크리스트를
따라가는 사람은 §7 을 보지 플랜을 보지 않는다.

**Fix:** `CLAUDE.md:502` 뒤에 "상한에 걸린 자산은 pending 에 남으므로 0 이 목표가 아니다 — 줄어들지 않는 작은 숫자는
먼저 실패 목록에서 5회 행을 센다" 한 문장.

### N4 — V6 의 "차단 클래스는 상한을 무시" 는 medium 이 고정하지 않는다 (Nit, 검증 표 정확성)

`CLAUDE.md:716` V6 와 플랜 `:91` 은 "blocking classes and RateLimited ignore the cap" 이라고 적고, 실패 모드로
"조건 제거·off-by-one·반전·상관 제거 → 실패" 를 든다. medium `google-drive.repository.spec.ts:202-284` 의 네 테스트는
capped 세 클래스(상한에서 제외), RateLimited 50회(계속 포함), 타 사용자 상관, `clearErrorsForAssets` 복귀를 고정한다.
차단 클래스를 상한 이상 `attempts` 로 넣고 "그래도 상한 때문에 빠지는 것이 아니다" 를 확인하는 테스트는 없다 — 그리고
있을 수도 없다: 차단 행은 `:527` 의 blocking 술어가 사용자째로 빼므로 `streamPendingUploads` 출력에서 두 이유를 구분할
수 없다. 문장은 코드(`GOOGLE_DRIVE_CAPPED_ERROR_CLASSES` 가 allowlist 라 quota/folder 가 애초에 없음)로는 참이지만,
"실패해야 할 때 실패하는가" 열이 약속하는 범위는 RateLimited 까지다. 표의 문장을 "RateLimited 는 상한을 무시(테스트),
차단 클래스는 allowlist 밖(코드로 확인)" 정도로 갈라 적으면 정확해진다. 고치지 않아도 해는 없다.

## Answers to what the report asked me to attack

### 1. N1 — 클래스 간 누적은 어떤 독자에게 틀린가 / 정지 규칙은 방어 가능한가

`attempts` 를 읽거나 쓰는 곳을 서버·웹·SQL 에서 전부 찾았다 (`grep -rn attempts` 에서 BullMQ 의 `attempts`/`attemptsMade`
제외):

| 독자 | 위치 | 클래스 간 누적이 맞는가 |
|---|---|---|
| 상한 술어 | `google-drive.repository.ts:642-643` — `error in (capped) and attempts >= 5` | 맞다. "현재 클래스가 capped 이고 누적 5" — 요청서의 "five tries, the last not a rate limit" 와 정확히 같은 술어다 |
| 쓰기 | `:858` `"attempts" = … + 1` (클래스 무관) | 의도대로 |
| `recordUpload` → F7 로그 | `:806` `returning('attempts')` → `service.ts:1450` "Uploaded … after N failed attempt(s)" | **요청서 목록에 없던 독자.** 맞다 — 429 도 실패한 시도이고 로그 문구가 "failed attempt(s)" 라 거짓이 아니다. 다만 wave11d 가 말했듯 "낫지 않는 실패 N회" 로 읽으면 안 된다 |
| `getFailures` → DTO → 설정 화면 | `:1047`, `service.ts:981`, `google-drive.dto.ts:194` "How many times this asset has been tried", `GoogleDriveSettings.svelte:450` `{count} attempts` | 맞다 — 요청서의 근거 그대로 |
| `firstOfClass` 알림 | `:845-867` | `attempts` 를 읽지 않는다 |
| 스키마 주석 | `google-drive-upload-error.table.ts:50-52` | **틀리다** — 위 N1 |

클래스 간 누적이 **틀린** 코드 독자는 없다. 정지 규칙은 방어 가능하다 — 술어가 계산하는 것이 정확히 그 문장이고, wave11d 가
지적한 반대 방향(상한에 걸린 Unknown 자산을 수동 동기화 → 429 → `attempts=6, rate_limited` → 다음 밤 다시 큐)도 같은
규칙("마지막이 rate limit 이면 아직 안 끝남")의 귀결이라 모순이 아니다. 더 정확한 문장은 "마지막이 capped 클래스" 다 —
마지막이 quota/folder 면 사용자가 차단되고, Revoked 면 연결이 사라지므로 "rate limit 이 아니다" 는 실무상 같은 뜻이다.
재설계는 권하지 않는다. 남은 비용은 R2 가 요청 내 재시도를 끈 뒤 큰 backlog 의 429 밤이 카운트를 먹는 것인데, 결과는
`enum.ts:1231-1234` 가 적은 대로 사람이 "retry failed" 로 되돌릴 수 있는 조기 포기다.

### 2. R4 — V11 이 이미 덮여 있는가 / Revoked 행이 쓰일 수 없는가

- **변이 재현**: 위 Evidence 변이 2. 두 호출(`service.ts:906`, `:1093`)을 `void 0` 로 바꾸면 그 두 테스트만 빨간불이고
  실패 지점은 `rejects.toBeInstanceOf(BadRequestException)` 이다 — `clearRevokedGrant` 가 빠지면 원래 `Error('x')` 가
  그대로 던져지기 때문. 뒤의 `deleteCredentials` 단언도 독립적으로 실패했을 것이다. `getStorage` 쪽은 `driveAboutGet` 호출
  증인(`spec.ts:1616`)이 있어 조기 탈출로 공허하게 통과할 수 없고, `getPickerConfig` 쪽은 증인이 없지만 그 경로에서
  `deleteCredentials(userId)` 를 부르는 코드가 `clearRevokedGrant` 뿐이고 바로 아래 `:1981-1994` 의 "socket hang up" 음성
  테스트가 분류 자체를 고정한다. 공허하지 않다.
- **Revoked 행 불가**: `clearRevokedGrant` (`service.ts:468-474`) 본문은 `logger.warn` → `deleteCredentials(userId)` →
  `throw BadRequestException` 세 줄이고 `upsertError` 호출이 없다. 테이블(`google-drive-upload-error.table.ts:34-38`)은
  `userId`·`assetId` 둘 다 `primary: true` 인 FK 라 자산 없는 경로는 행을 만들 수 없다. `upsertError(…, Revoked, …)` 는
  `service.ts:1473` 업로드 워커 한 곳뿐이다. 주장 맞다.

### 3. 문서 정확성 — 플랜의 wave11d 판정 절, `CLAUDE.md` V6·V7·V11·V12

- **플랜 "wave11d review verdicts (R3)"** (`:180-190`): 생성 SQL 제로 diff, 실제 googleapis 프로브(EIO 1 ms / 지연 open
  ENOENT / uncaught 없음), N1 유지·문서화, N2 수정, N4 단언 추가, N3 기록만, N5 — wave11d 리뷰 파일의 Evidence 표·Findings 와
  대조해 전부 맞다. 단 "N2 doc drift … fixed here and in CLAUDE.md" 는 V6/F3 에 한해 맞고, V11 은 N2 와 별개로 위 N2 에서
  어긋난다.
- **V6** (`CLAUDE.md:716`): "상한 미만 포함 / 이상 제외 / RateLimited 무시 / 다른 사용자 행과 무관 / retry failed 로 재포함
  (수동 동기화는 행을 지우지 않음)" — medium `:202-284` 네 테스트와 `clearErrorsForAssets` 경로에 대응한다. "차단 무시" 만 위
  N4. "수동 동기화는 행을 지우지 않고 상한을 우회할 뿐" 은 `enum.ts:1231-1234` 와 일치.
- **V7** (`:717`): "errno 제거 → 실패" — 변이 1 로 **2 red** 확인(새 단언 + 기존 EMFILE 단언). 플랜 `:93` 의 V7 은 다른
  실패 모드("Map EACCES to terminal skip path → fails") 를 적고 있는데, 둘 다 참이고 서로 모순은 아니다.
- **V11** (`:721`): "grant 삭제 (Revoked 행은 자산 FK 때문에 이 경로에선 불가) — 기존 테스트가 이미 덮음 / clearRevokedGrant
  생략 → 실패 (2026-10-01 확인)" — 변이 2 로 확인. 맞다. 플랜 쪽은 N2.
- **V12** (`:722`): "리스너 제거 → 실패" — 변이 3 으로 1 red 재확인. 이 범위에 변경 없음.

## What I did not verify

- medium 스위트는 재실행하지 않았다(위 Evidence 표 아래 설명). 결과 파일과 wave11d 리뷰의 재현에 기댔다.
- web vitest(리포트: 603 passed / 2 skipped)와 svelte-check 는 돌리지 않았다 — 이 범위에 web 변경이 없고 결과 파일이
  87/87·회귀 없음을 기록한다.
- `getPickerConfig` 의 revoked 테스트가 토큰 발급 지점까지 도달했다는 직접 증인(`oauth2GetAccessToken` 호출 단언)은 없다.
  위 2번의 간접 근거로 충분하다고 봤고, 원하면 한 줄 추가할 수 있다.
- 운영(랩탑)은 보지 않았다 — 요청서도 미배포라고 적었다.
- 정리: 스크래치 워크트리 제거 후 `git worktree list` 는 메인 트리와 기존의 `immich-review`·`immich-review-b` 둘뿐이다.
  작성 후 `git status --porcelain` 은 ` M mise.lock`(리뷰 전부터) 과 이 리뷰 파일(`??`) 두 줄이다. 이 세션이 만든 변경은
  이 리뷰 파일 하나다.

## Feeding back into the plan

- **스키마 주석 수정**(N1): `google-drive-upload-error.table.ts:50-52` 의 "no retry cap" 을 상한 상수로 가리키게 바꾸고,
  `failure-handling-plan.md:152-153` 에 R3 결정으로 뒤집혔다는 한 줄을 단다. `attempts` 의 의미는 한 곳(`enum.ts`)에만 적고
  나머지는 가리킨다.
- **플랜 V11 행**(N2)을 CLAUDE.md 행과 같게 — "V11 is re-worded" 가 실제가 되도록.
- **`CLAUDE.md` §7 item 8**(N3)에 N5 의 "pending = 진짜 대기 + capped, 0 이 목표가 아니다" 를 적는다.
- V6 의 "차단 클래스" 문구(N4)를 테스트가 고정하는 범위와 코드로 확인한 범위로 나눠 적는다.
- `dev-test/google-drive/README.md:36` 의 medium 행은 R3 가 더한 attempt-cap 네 테스트와 R4 의 ledger/deleted-album 술어
  테스트를 아직 열거하지 않는다(이 범위 밖의 부채지만 wave11 을 닫는 커밋에서 같이 갱신하는 것이 싸다).
- wave11d 가 제안한 두 가지 — §3 생성물 절에 "SQL 재생성은 마이그레이션된 DB 가 필요하다(testcontainers 절차)" 와
  플랜의 "검증하지 않는 것" 에서 스트림 오류 항목을 프로브 수치로 교체 — 는 이번 커밋에 들어가지 않았다. 플랜 `:181-183` 이
  프로브 결과를 기록하긴 했으나 `CLAUDE.md:723` 의 "검증하지 않는 것" 줄은 그대로다. 요청서가 반영을 주장하지 않았으므로
  발견이 아니라 남은 항목으로 적어 둔다.
