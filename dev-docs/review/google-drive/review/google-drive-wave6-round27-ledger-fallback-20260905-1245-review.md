# Code Review — `''` 폴백의 두 번째 형태는 이제 양방향으로 붙잡혀 있다 · 생존자 재심 · 배포 게이트 최종 판정

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `ae64e0ae3` |
| Commits reviewed | `f54456bb5`, `e69256d5c`, `ae64e0ae3` (`git log --oneline ffc7d181e..ae64e0ae3` = 3, 그중 `ae64e0ae3`는 리포트 자신) |
| Report | `../report/google-drive-wave6-round27-ledger-fallback-20260905-1245-report.md` |
| Prior review | `./google-drive-wave6-round26-user-scope-family-20260905-1215-review.md` (같은 리뷰어) |
| Reviewed | 2026-09-05 |

## Verdict

**배포를 막는 것은 없다.** 리포트가 공격을 요청한 세 가지를 그대로 답한다: (1) 새 테스트 2개는
**의도한 이유로** 통과한다 — 코드 쪽과 픽스처 쪽 양방향 변이로 확인했고, M1 테스트의 `0`은
`''` 폴백에서 온다(같은 픽스처에서 원장 계정만 `'account-y'`로 바꾸면 즉시 `1`이 된다).
(2) round-26이 남긴 생존자(`:398`·`:452`, 소프트삭제 10자리)는 **하나도 배포를 막지 않는다** —
이번에는 "그물이 있다"를 논증이 아니라 **그물 자체의 변이**로 보였다: `repository.ts:646`(gate 3)과
`google-drive.service.ts:1002`(gate 5)를 각각 변이시키면 실제로 테스트가 죽는다. (3) 체크리스트에는
빠진 항목이 하나 있고, **더 나쁘게는 이미 들어 있는 항목 하나(B-6)가 실행 불가능하다** — 이번 커밋이
만든 문제가 아니라 round-25에서 round-26으로 옮겨 적힌 오류다.

**이 라운드에서 가장 중요한 문제는 코드가 아니라 배포 당일 문서다.** N3(런북의 입양 경계)를 고친
문단은 정확해졌는데(`CLAUDE.md:402-405`), **같은 절 아홉 줄 아래 `:411-414`가 아직 `connectedAt`
시간 경계로 설명하고 있다.** 고친 문단이 "시간 비교는 round-21에서 버렸다"고 명시한 바로 그
비교를 그 아래 문단이 여전히 근거로 쓴다. 결론은 옳고 코드도 옳으므로 **배포를 막지 않지만**,
N3을 고친 이유("배포 당일 읽는 문서라 자기모순이 위험하다")가 그대로 남아 있다.

프로덕션 코드는 **0줄**이다(`git diff ffc7d181e..ae64e0ae3 -- server/src web/src ':!*.spec.ts'`
빈 출력). 런타임 동작이 문자 그대로 동일하므로 이 세 커밋은 배포 위험을 늘리지도 줄이지도 않는다.

### Evidence I ran myself

전부 이 워크트리 HEAD(`ae64e0ae3`)에서 돌렸다. 변이는 줄 번호로 넣고(전체 줄 삭제, 줄 안 부분
삭제, 또는 줄 치환), **매 실행 뒤 `git checkout --`으로 원본을 복원**했다. medium 하네스는 실행마다
testcontainer를 새로 띄우므로 실행 사이 오염은 없다. 아래 숫자는 전부 이 HEAD의 실행 결과다.

| Check | Result |
|---|---|
| medium (무변이) | `Test Files 1 passed / Tests 53 passed (53)` — 리포트의 53과 일치 |
| server unit (`run.sh`의 8스펙) | `Test Files 8 passed / Tests 264 passed (264)` — 리포트의 264와 일치 |
| `git diff ffc7d181e..ae64e0ae3 -- server/src web/src ':!*.spec.ts'` | **빈 출력** — 프로덕션 0줄, 리포트대로 |
| `git diff --name-only ffc7d181e..ae64e0ae3` | 5 files: `CLAUDE.md`, report 1, review 1, results 1, medium spec 1 |
| `git diff --name-only ffc7d181e..ae64e0ae3 -- .github` | `0` |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx eslint test/medium/specs/repositories/google-drive.repository.spec.ts --max-warnings 0` | exit 0 |
| 첨부 증거 `results/20260905-1241.txt` | `commit: f54456bb5`, dirty 마커 **없음**, 264 / 39 / 53, `no svelte-check regressions vs baseline (3 pre-existing files)`, `RESULT: PASS` — 주장대로 |
| CI `runs/33942630877` (api.github.com) | `head_sha ae64e0ae3…`, `conclusion success`, 잡 4개(`Feature suite` / `Generated SQL is current` / `Full server + web unit sweep` / `Medium (real database) tests`) **전부 success** |
| `git status --porcelain` (종료 시) | **이 리뷰 파일 하나뿐** |

**변이 전수 — 이번 라운드가 주장한 것과 재심한 것.** "격리"는 그 변이를 건 채 죽는 테스트 하나만
`-t`로 돌린 결과다.

| # | 변이 (파일:줄) | 방향 | 결과 |
|---|---|---|---|
| V1 | `repository.ts:48`에서 ` or "google_drive_upload"."driveAccountId" = ''`만 삭제 | 폴백 제거 | **`1 failed \| 52 passed`** — `spec.ts:1119` `expected 1 to be +0` |
| V2 | 같은 변이 + `-t "…pre-column rows…"` | 격리 | **`1 failed \| 52 skipped`** — 잔여 행에 의존하지 않는다 |
| V3 | 같은 변이 + `spec.ts:1119`(count 단언)를 주석으로 무력화 | 스트림 절반만 | **`1 failed \| 52 skipped`** — `spec.ts:1120` `expected [ {…(2)} ] to deeply equal []` |
| V4 | **무변이 코드** + `spec.ts:1117`의 `''` → `'account-y'` | 픽스처 역방향 | **`1 failed \| 52 skipped`** — `expected 1 to be +0`. **0은 폴백이 만든다** |
| V5 | `repository.ts:298` 줄 삭제 + `-t "…blocked subscriber…"` | 격리 | **`1 failed \| 52 skipped`** — `spec.ts:1138`, expected `["b4da…"]` / received `[]` |
| V6 | `repository.ts:562` 줄 삭제 + 같은 `-t` | 격리 | **`1 failed \| 52 skipped`** — `spec.ts:1140`, expected `[{assetId,userId}]` / received `[]` |
| V7 | **무변이 코드** + `spec.ts:1135`(`upsertError`) 제거 | 목격자 | **fail** — subscribers가 2명(`["94e5…","bc3a…"]`)이 되어 `toEqual([guest.id])`가 깨진다 |
| V8 | `repository.ts:45`에서 폴백만 삭제 | gate 2 경로 | `1 failed \| 52 passed` — `should keep treating unstamped rows as uploaded even once the account is known` |
| V9 | `repository.ts:398` `.on(ledgerMatches(userId))` 제거 | 계정 축 생존자 | **`53 passed`** (여전히 생존) |
| V10 | `repository.ts:452` 같은 제거 | 계정 축 생존자 | **`53 passed`** (여전히 생존) |
| V11 | `repository.ts:550` 줄 삭제 | 소프트삭제 생존자 | **`53 passed`** (여전히 생존) |
| V12 | `repository.ts:551` 줄 삭제 | 소프트삭제 생존자 | **`53 passed`** (여전히 생존) |
| V13 | `repository.ts:646` 줄 삭제 | **`:550`의 그물** | `1 failed \| 52 passed` — `isAssetInSubscribedAlbum > should be false once the album is soft-deleted, matching the stream predicate` |
| V14 | `google-drive.service.ts:1002`을 `if (false) {`로 치환 | **`:551`의 그물** | 유닛 `1 failed \| 82 passed` — `GoogleDriveService > trashed assets > should skip an asset that is in the trash` |
| V15 | `repository.ts:288` 줄 삭제 + `-t "…lost access…"` | 새 leftover의 영향 확인 | `1 failed \| 52 skipped` — round-26의 격리 kill이 이번 커밋 뒤에도 유지된다 |

---

## Findings

배포를 막는 것은 없다. 아래 셋은 전부 **나이트**이고, 그중 N1만 배포 *전에* 하는 편이 싸다.

### N1 (Nit — 그러나 배포 당일 문서다) — N3의 고침이 절반이다. `CLAUDE.md:411-414`가 아직 시간 경계로 설명한다

고쳐진 문단은 정확하다(`CLAUDE.md:402-405`):

> **`unstamped`는 0이 되지 않는 것이 정상이다.** 입양은 *그 연결이 직접 쓴* 행만 가져간다
> (`connectionId`가 같은지로 판정한다 — 예전의 `uploadedAt >= connectedAt` 시간 비교는 round-21에서
> 버렸다). 배포 전에 올라간 6,996행은 `connectionId`가 비어 있어 어떤 연결도 가져가지 못하므로 …

코드와 일치한다 — `adoptUnstampedUploads`의 두 문장은 각각
`.where('connectionId', '=', connection.connectionId)`(`repository.ts:198`, `:215`)이고,
`uploadedAt` 비교는 주석에만 남아 있다(`:181`). 여기까지는 좋다.

**그런데 아홉 줄 아래 `CLAUDE.md:411-414`가 그대로다:**

> **확인해야 할 진짜 관문은 "식별된 계정이 맞는 계정인가"다.** 이건 서버가 판정할 수 없다 —
> 현재 연결의 `connectedAt`이 6,996행보다 **나중**이라, 코드 입장에서 그 연결은 그 행들을 쓴
> 연결이 아니다.

방금 "버렸다"고 적은 그 시간 비교가 여기서 다시 근거로 쓰인다. 코드가 그 행들을 이 연결의 것이
아니라고 보는 이유는 `connectedAt`이 나중이라서가 아니라 **그 행들의 `connectionId`가 null이고
`null = uuid`가 참이 아니기 때문**이다(`repository.ts:188-191`의 주석이 정확히 그렇게 적혀 있다).

**배포를 막지 않는다** — 결론("서버가 판정할 수 없다, 눈으로 확인하라")은 옳고 관측 절차도 바뀌지
않는다. 다만 N3을 고친 이유가 문자 그대로 여기에도 적용된다. **한 문장 치환**이면 끝난다:

> 이건 서버가 판정할 수 없다 — 그 6,996행은 `connectionId`가 비어 있어 **어떤 연결의 것으로도
> 식별되지 않고**, 코드 입장에서 지금 연결은 그 행들을 쓴 연결이 아니다.

### N2 (Nit — 문서/체크리스트, 코드 아님) — 체크리스트 B-6이 **존재하지 않는 필드**를 보라고 한다

round-26 체크리스트의 6번:

> **설정 화면을 열기 *전에* `getGoogleDriveStatus`의 `enabled`가 `true`인지 확인한다 (round-25).**

`getGoogleDriveStatus`(`controllers/google-drive.controller.ts:75` → `services/google-drive.service.ts:613`)의
반환 타입은 `{ connected, folderId, folderName, connectedAt, failedCount, blockedReason, pickerAvailable }`
이다(`:613-621`). **`enabled`는 없다.** 이 오류의 출처는 round-25 리뷰(`…round25-…-review.md:340`,
`:406`)이고 round-26 체크리스트가 그대로 옮겨 적었다. 배포 당일 그대로 따르면 응답에서 그 필드를
못 찾고, 유일한 하드 게이트의 사후 확인이 조용히 건너뛰어진다.

게다가 **그 호출은 "설정 화면을 열기 전"의 관측이 아니다.** `getStatus`는 본문에서 신원 프로브와
입양을 트리거한다(`service.ts:632-639`: `if (credentials?.driveAccountId === null && this.probeAllowed(userId))`).
즉 6번을 실행하는 순간 7번이 함께 일어난다.

**실제로 그 불리언이 있는 곳**은 `GET /api/server/features`의 `googleDrive`다
(`controllers/server.controller.ts:96-104` → `services/server.service.ts:122`
`googleDrive: isGoogleDriveEnabled(googleDrive, server)`, DTO는 `dtos/server.dto.ts:148`).
이 엔드포인트는 `@Authenticated()`가 없어 **API 키 없이** 부를 수 있고, 신원 프로브를 건드리지
않으므로 "설정 화면을 열기 전"이라는 조건도 진짜로 만족한다. 대체 문구:

```bash
# B-6 (수정본): 설정 화면을 열기 전에, 하드 게이트가 살아 있는지 코드에게 직접 묻는다.
curl -s http://192.168.50.211:2283/api/server/features | jq .googleDrive   # → true 여야 한다
```

`false`면 A-1이 지켜지지 않은 것이다 — 설정 화면을 열지 말고 `externalDomain`/`redirectUrl`부터
채운다(`utils/misc.ts:150-154`, `:126-138`).

### N3 (Nit — 방법론) — M2의 고침이 **새로운 잔여 행 공급원**을 만들었다

이번에 추가된 `should exclude only the blocked subscriber…`(`spec.ts:1123-1144`)는
`upsertError(owner.id, …, QuotaExceeded, 'full')`(`:1135`)로 `google_drive_upload_error` 행을
쓰고 **지우지 않는다.** 이 medium 스펙에는 `beforeEach`/`afterEach` 정리가 전혀 없고(파일 전체에
`afterEach` 0건), 이 테스트 뒤에 같은 describe의 테스트가 다섯 개 더 온다(`:1146`, `:1172`,
`:1199`, `:1231`, `:1250`). 즉 round-26이 계획으로 되먹인 항목 2("전체 실행의 kill은 증거가 아니다")가
경고한 그 결합을 **이번 고침이 한 건 더 만들었다.**

**지금은 무해하다.** ① 오류 행은 `owner`에게만 달리고 뒤 테스트들은 매번 새 사용자를 만든다.
② 뒤 다섯 테스트가 격리에서도 죽는다는 것은 round-26이 확인했고, 그중 하나(`:288`/`spec.ts:1146`)를
이번 HEAD에서 다시 걸어 `1 failed | 52 skipped`로 재확인했다(V15). 그래서 **발견이 아니라
표지판**이다 — 다음에 이 파일에 부정 단언을 추가하는 사람이 알아야 할 것이고, 계획 문서로 간다.

---

## Answers to what the report asked me to attack

### 1. 새 테스트 2개가 의도한 이유로 통과하는가 — 특히 M1의 `0`이 폴백에서 오는가

**그렇다. 양방향으로 확인했다.**

**코드 방향(V1~V3).** `repository.ts:48`에서 **폴백만** 지우면(계정 등가는 그대로 둔 채)
전체 실행이 `1 failed | 52 passed`이고, 죽는 것은 정확히 새 테스트 하나다 —
`spec.ts:1119`에서 `expected 1 to be +0`. 리포트가 적은 그 숫자 그대로다. **격리(V2)에서도**
`1 failed | 52 skipped`로 죽으므로, 앞선 describe가 남긴 행 덕분에 죽는 것이 아니다.
`countPendingUploads`와 `streamPendingUploads` **두 경로가 각각 독립적으로** 죽는 것도 확인했다:
count 단언(`:1119`)을 주석으로 무력화한 채 같은 변이를 걸면(V3) 이번에는 `:1120`의 스트림 단언이
`expected [ {…(2)} ] to deeply equal []`로 죽는다. 리포트의 "두 경로로 단언한다"는 사실이다.

**픽스처 방향(V4) — 이게 질문의 핵심이다.** `0`이 "폴백" 때문인지 "픽스처의 다른 조건" 때문인지를
가르려면, **코드를 건드리지 않고 픽스처만** 폴백이 적용될 수 없게 만들어 보면 된다. 무변이 HEAD에서
`spec.ts:1117`의 원장 계정을 `''` → `'account-y'`로 바꾸자 같은 테스트가
`expected 1 to be +0`으로 죽었다(`1 failed | 52 skipped`).

이것이 배제하는 것들이 정확히 질문이 걱정한 것들이다: 사용자가 연결돼 있고(`connect(…, 'account-x', CONNECTION_A)`),
`google_drive_album` 선택 행이 있고, 자산이 앨범에 있고, 자산·앨범 어느 쪽도 소프트삭제가 아니며,
차단 오류도 없다 — **그 모든 조건이 만족되어 이 자산은 실제로 "대기 1"로 셀 수 있는 자산**이다.
그런데 원장 계정이 `''`이면 0이 된다. 즉 `0`은 "픽스처가 아무것도 못 보고 있어서"가 아니라
**`''` 폴백이 그 행을 '업로드됨'으로 읽어서** 나온 값이다.

**둘째 테스트(V5~V7).** `:298`(getSubscribers)과 `:562`(streamPendingUploads)의 차단 오류 상관을
각각 지우면, **격리 실행에서도** 새 테스트가 죽는다 — `1 failed | 52 skipped`. round-25 N1이
지적하고 round-26이 "안 고쳐졌다"고 판정한 상태(격리하면 살아남음)가 **이번 커밋으로 실제로
해소됐다.** 두 변이가 서로 다른 단언에서 죽는 것도 확인했다(`:298` → `spec.ts:1138`의 구독자 목록,
`:562` → `spec.ts:1140`의 게스트 스트림). 그리고 round-26이 요구한 **목격자**도 살아 있다(V7):
`upsertError` 한 줄을 빼면 구독자가 2명이 되어 `toEqual([guest.id])`가 깨진다 — 즉 이 테스트는
"차단이 실제로 기록됐다"를 함께 단언하고 있어 공허하게 통과할 수 없다.

### 2. round-26의 생존자 중 배포를 막는 것이 있는가 — 그 판정에 지금도 동의하는가

**하나도 없다. 동의한다.** 다만 round-26은 "뒤에 그물이 있다"를 코드 독해로 판정했고, 그것이
배포와 프로덕션 사이에 남은 유일한 것이 된 지금 **그물 자체를 변이시켜 다시 확인했다.**

**계정 축 `:398`·`:452`.** 이 HEAD에서 다시 걸어 둘 다 여전히 생존한다(V9·V10, 각각 `53 passed`).
"화면 숫자"라는 판정은 호출자를 세어 확인했다 — 이 두 메서드의 소비자는
`services/google-drive.service.ts:1245`(`getSubscribableAlbums`)와 `:1265`(`getAlbumBackupStatus`)
둘뿐이고, 둘 다 `assetCount`/`uploadedCount`/`subscribed`/`accessLost`를 DTO로 매핑해
`controllers/google-drive.controller.ts:305`·`:324`로 내보내는 **읽기 전용 경로**다. 업로드를
일으키는 경로(`countPendingUploads` `:488`, `streamPendingUploads` `:548`, `hasUpload` `:672`)는
별개의 술어를 쓰고 round-26이 kill을 확인했다. **회귀해도 진행률 숫자가 틀릴 뿐 파일은 정상적으로
올라간다.** 게다가 도달 조건이 "다른 구글 계정으로 재연결"인데, 이 배포본의 사용자는 한 명이고
체크리스트 B-8이 `drive_account`가 하나뿐인지를 관문으로 이미 보고 있다.

**소프트삭제 축 10자리.** 위험한 것은 "일을 *하게* 만드는" 두 자리뿐이라는 round-26의 구분이
맞다. 그 둘이 이 HEAD에서도 생존하는 것을 확인했고(V11·V12, `53 passed`), **그 뒤의 그물이 실제로
테스트에 붙잡혀 있는지를 변이로 확인했다**:

- `:550`(스트림의 `album.deletedAt`)의 그물은 워커 gate 3이다 —
  `service.ts:958`이 `isAssetInSubscribedAlbum`을 부르고, 그 안의 `album.deletedAt is null`은
  `repository.ts:646`이다. **그 줄을 지우면 medium이 죽는다**(V13, `1 failed | 52 passed`,
  `spec.ts:219`).
- `:551`(스트림의 `asset.deletedAt`)의 그물은 gate 5다 — `service.ts:1002`의
  `if (asset.deletedAt) return 'skipped'`. **그 조건을 `if (false)`로 바꾸면 유닛이 죽는다**
  (V14, `1 failed | 82 passed`, `google-drive.service.spec.ts:1684`의 `trashed assets`).

즉 "그물이 있다"는 이제 **주장이 아니라 관측**이다. 나머지 여덟 자리는 화면 숫자여서 회귀해도
되돌릴 수 없는 손해가 없다.

**`:48`(round-26의 M1) 자체는 이번 커밋이 닫았다.** 그리고 round-26이 "중복은 안 난다"의 근거로
쓴 gate 2 경로(`:45`의 폴백)가 여전히 테스트로 지켜지는 것도 재확인했다(V8, `1 failed | 52 passed`).
**이제 `''` 폴백은 두 형태가 모두 붙잡혀 있다** — 이 기능의 중복 방지 안전망 전체에 회귀 감지가
붙었다는 뜻이고, 이것이 이번 라운드가 배포 직전에 만든 유일한 실질적 변화다.

### 3. A/B/C 체크리스트에 빠진 항목이 있는가 — 이번 커밋 때문에 추가되어야 할 확인이 있는가

**이번 커밋이 만든 *추가* 확인은 없다.** 프로덕션 0줄이고, 바뀐 것은 테스트 2개와 런북 한 문단이라
운영에서 관측할 새 표면이 생기지 않았다. 하지만 체크리스트 자체에 손볼 것이 셋 있다.

1. **A-4는 완료 처리한다.** "런북 한 문장 고치기(N3) — `CLAUDE.md:402-403`의 입양 경계를
   `connectionId`로"는 이번 커밋이 했다(`:402-405`). **다만 절반이다** — N1대로 `:411-414`가
   남았으므로, A-4를 지우지 말고 **남은 문단으로 범위를 좁혀** 유지한다.
2. **B-6은 실행 불가능하다 — 고쳐야 한다.** N2대로 `getGoogleDriveStatus`에는 `enabled` 필드가
   없다. `curl -s <host>/api/server/features | jq .googleDrive` → `true`로 바꾼다. 이건 "빠진
   항목"보다 나쁘다: 있는데 따라 할 수 없어서, 유일한 하드 게이트의 사후 확인이 조용히 생략된다.
3. **B-9의 판정 기준을 한 줄 구체화한다(선택).** "진행 카드의 대기 수"가 나오는 곳은
   `GET /api/google-drive/me/status`의 `pending`이다(`controllers/google-drive.controller.ts:251-261`
   → `service.ts:784-797` → `countPendingUploads`). 화면을 못 열 때 API로 볼 수 있게 경로를 적어 둔다.

그밖에 A/B/C의 나머지 항목은 이번 커밋과 무관하게 그대로 유효하다. A-1(하드 게이트)의 근거인
`isGoogleDriveEnabled`(`utils/misc.ts:150-154`)와 `getGoogleDriveRedirectUrl`(`:126-138`)이 이 HEAD에서
round-25가 인용한 모습 그대로임을 확인했다.

---

## 게이트 판정

**배포를 막는 것은 없다.** 이 라운드에서 나온 것은 나이트 셋(N1 런북 잔여 문단, N2 체크리스트 B-6,
N3 방법론)뿐이고, 셋 다 코드가 아니라 문서·절차이며 그중 어느 것도 되돌릴 수 없는 손해로 이어지지
않는다. 리포트 §5의 종료 조건이 충족됐다 — **사이클을 종료하고 배포로 간다.**

배포 전에 두 가지만 손대는 것을 권한다. 둘 다 코드가 아니라 **배포 당일 읽는 글**이고 합쳐서
두 문장이다: **N1**(`CLAUDE.md:411-414`의 시간 경계 → `connectionId`)과
**N2**(체크리스트 B-6의 엔드포인트 → `/api/server/features`의 `googleDrive`). 이것도 게이트가
아니라 권고다.

### 하드 게이트 — round-26 체크리스트 1번 (원문 그대로)

> 1. **redirect 파생이 살아 있는지 확정한다 (유일한 하드 게이트, round-25).**
>    `server.externalDomain`과 `googleDrive.redirectUrl` 중 **최소 하나가 채워진 상태**로 배포한다.
>    둘 다 비면 `isGoogleDriveEnabled`가 거짓이 되어 **에러 없이** 기능이 꺼진다. 관리자 폼의 안내
>    ("비워두면 External Domain을 쓴다")를 따라 `redirectUrl`을 지우는 것이 정확히 그 상태를 만든다.

이 HEAD에서 근거를 다시 확인했다: `isGoogleDriveEnabled`(`server/src/utils/misc.ts:150-154`)는
`enabled && clientId && clientSecret && getGoogleDriveRedirectUrl(...)`이고,
`getGoogleDriveRedirectUrl`(`:126-138`)은 `redirectUrl`이 비면 `externalDomain`에서 파생하고
그것도 비면 **빈 문자열**을 돌려준다.

---

## What I did not verify

- **web 유닛 39개와 svelte-check 베이스라인 게이트.** 이 워크트리에는 web 의존성이 없다
  (`ls web/node_modules` → `No such file or directory`). 이 세 커밋은 `web/`을 전혀 건드리지
  않았고(변경 5파일에 `web/` 없음) CI `33942630877`의 `Full server + web unit sweep`가 success
  이므로 그것에 의존했다. **돌리지 못했다는 뜻이지, 돌려서 통과했다는 뜻이 아니다.**
- **`mise //server:ci-unit` exit 0.** 리포트 §"테스트 결과" 마지막 줄의 이 주장은 첨부된
  `results/20260905-1241.txt`에 **들어 있지 않다**(그 파일은 `run.sh`의 산출물이라 format/lint
  단계를 담지 않는다). 직접 돌리지 않았고, `tsc --noEmit` exit 0 · 바뀐 스펙의 `eslint
  --max-warnings 0` exit 0 · CI 4잡 success로 갈음했다.
- **전체 서버 스위트.** `run.sh`의 8스펙(264)과 medium(53)만 직접 돌렸다. 나머지는 CI에 의존한다.
- **CI 잡의 로그 본문.** 인증 없이 GitHub API가 로그를 주지 않는다. 잡별 `conclusion`까지만 봤다.
- **소프트삭제 축 나머지 여덟 자리의 재변이.** round-26이 전수했고 이번 커밋이 프로덕션을 건드리지
  않았으므로, 위험군 두 자리(`:550`·`:551`)와 그 그물 두 자리만 다시 걸었다. `:372`·`:388`·`:401`·
  `:431`·`:442`·`:455`·`:491`·`:492`는 **이번에 직접 돌리지 않았다** — round-26의 표에 의존한다.
- **계정 축 나머지.** `:398`·`:452`만 재확인했다. `:488`·`:548`·`:599`·`:672`·`:860`의 kill은
  round-26의 표에 의존한다.
- **브라우저 경로와 실제 구글 API, 운영 DB.** 설정 화면이 신원 프로브를 트리거한다는 것은
  `service.ts:632-639`의 코드 독해로만 확인했다. `/api/server/features`를 실제 운영 서버에 대고
  호출해 보지 않았다(라우트·DTO·핸들러가 이 HEAD에 존재한다는 것까지만 확인).
- **V14의 변이 방식.** gate 5는 `if (asset.deletedAt)`를 `if (false)`로 치환해 무력화했다. 줄
  삭제는 블록이 깨져 컴파일되지 않기 때문이고, 의미는 "이 gate가 아무도 막지 않는다"로 동일하다.

---

## Feeding back into the plan

`dev-docs/google-drive/feature-roadmap.md`에 남길 것 (round-26의 1~6번에 이어서):

7. **`''` 폴백은 이제 두 형태 다 붙잡혀 있다.** `ledgerMatches`(`repository.ts:45`)는
   `should keep treating unstamped rows as uploaded even once the account is known`이,
   `LEDGER_MATCHES_CURRENT_ACCOUNT`(`:48`)는 `should keep treating pre-column rows as uploaded in
   the queries that join the connection`(`spec.ts:1103`)이 지킨다. **둘 중 하나만 고치는 회귀도
   잡힌다** — 이 기능의 중복 방지 안전망에 회귀 감지가 완비된 시점이다. 다음에 이 술어를 손대는
   사람은 두 형태를 **함께** 옮겨야 한다는 것을 `:47`의 주석("Same comparison for…")이 말해 준다.
8. **부정 kill의 검증은 "코드 변이"와 "픽스처 역변이" 두 방향이다.** 코드 변이만으로는 "다른
   조건 때문에 0이 나온 것 아닌가"에 답할 수 없다. 이번에 `spec.ts:1117`의 `''` → `'account-y'`로
   같은 테스트가 `1`을 보게 만들어 그 질문을 닫았다(V4). 앞으로 "…하지 않는다" 테스트를 추가할 때
   **역변이 한 줄을 리포트에 함께 적는다.**
9. **오류 행을 쓰는 테스트는 잔여 행 공급원이다(N3).** `spec.ts:1135`의 `upsertError`는 정리되지
   않고, 이 medium 스펙에는 `afterEach`가 하나도 없다. 지금은 무해하지만(상관 술어가 사용자로
   좁히고, 뒤 테스트들은 새 사용자를 만든다), 이 파일에 부정 단언을 추가할 때는 **격리 실행으로
   kill을 재확인**한다 — round-26 항목 2의 구체 사례로 남긴다.
10. **런북의 시간 경계는 두 군데였다(N1).** round-22 M3이 드레인 문단을, round-27이 입양 문단을
    고쳤고, **`CLAUDE.md:411-414`의 "계정 확인" 문단이 아직 `connectedAt`으로 설명한다.** 같은
    사실을 세 문단이 반복하는 구조 자체가 원인이므로, 고칠 때 **"입양·드레인·계정확인 세 문단은
    같은 기준(`connectionId`)을 말한다"**를 한 줄로 못박아 둔다.
11. **배포 체크리스트 B-6은 `/api/server/features`의 `googleDrive`를 본다(N2).**
    `getGoogleDriveStatus`에는 `enabled` 필드가 없다(`service.ts:613-621`). round-25 → round-26으로
    옮겨 적히는 동안 아무도 응답 모양을 확인하지 않았다 — **체크리스트에 API 필드를 적을 때는
    DTO를 열어 본다**를 규칙으로 남긴다.

---

*이 리뷰를 쓰는 동안 만든 변이 15개는 전부 `git checkout --`으로 복원했고, 종료 시점의
`git status --porcelain` 출력은 이 리뷰 파일 하나뿐이다. `/home/gwyun/workspace/immich`는
읽지도 쓰지도 않았다.*
