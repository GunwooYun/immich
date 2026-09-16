# Code Review — wave8d: wave8c 리뷰 반영 (`cf6bf36eb`, `a8e26b193`)

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `14e4ed72e` |
| Commits reviewed | `cf6bf36eb` (spec + 런북), `a8e26b193` (증거), `2e1cdceb0` (wave8c 증거, 이번에 처음 인용됨), `14e4ed72e` (리포트) — `git diff b4967e07e cf6bf36eb -- server/src CLAUDE.md` |
| Report | `../report/google-drive-wave8d-permission-tests-20260916-2210-report.md` |
| Prior review | `./google-drive-wave8c-review-fixes-20260916-2140-review.md` |
| Reviewed | 2026-09-16 (모든 수치는 이 워크트리 HEAD에서 직접 돌린 것) |

## Verdict

**배포 판정: 막지 않는다 (NOT BLOCKED). wave8 시리즈(`f4a6e2906`부터 HEAD까지)는 배포 가능하다.**
이번 커밋은 운영 코드를 한 줄도 바꾸지 않는다 — `git diff --stat`은 `CLAUDE.md`, 스펙 2개, 지난 리뷰 파일뿐이다.
리포트의 수치(서버 8스펙 280 / 웹 45 / 전체 2,390+2 skip)는 전부 재현됐고, 리포트 변이 M1~M3에 더해 내가 추가한
변이 3건(게이트 순서 역전, `getById` 선행, `AlbumUpdate`로 약화)도 전부 새 테스트 하나가 정확한 사유로 잡았다.
wave8c가 남긴 C1·C2·N1~N3는 코드와 런북에 모두 반영됐다. 남은 것은 리포트 문구의 범위 표기(`a0cdc42de..HEAD`가
실제 wave8 운영 커밋 `f4a6e2906`을 **빠뜨린다**)와 런북 한 줄의 자리표시자 같은 nitpick 둘뿐이다.

가장 중요한 문제라고 부를 만한 것은 없다. 굳이 고르면 N1 — 리포트가 "배포 적합성"을 물으며 준 범위가 시리즈의
유일한 운영 코드 커밋을 제외한다는 점인데, 그 커밋은 wave8 리뷰(`20260914-2240`)가 이미 NOT BLOCKED로 본 것이라
판정에는 영향이 없다.

### Evidence I ran myself

전부 이 워크트리 HEAD에서 돌렸다. `run.sh`는 `results/`에 파일을 남기므로 쓰지 않고, 그 안의 스펙 목록
(`run.sh:76-91`, `:95-108`)을 같은 명령으로 재현했다. 변이는 `sed`로 줄 단위로 넣고 매번 `git checkout --`으로
복원했으며, `google-drive.service.ts`의 md5 `ccbcd45c…`와 스펙의 `5469908d…`가 매 변이 후 동일함을 확인했다.

| Check | Result |
|---|---|
| server unit — `run.sh`의 8스펙 | `Test Files 8 passed / Tests 280 passed (280)` — **리포트 280과 일치** (wave8c 279 + `syncAlbum` 권한 테스트 1) |
| server unit — 전체 (`--config test/vitest.config.mjs`) | `94 passed / 2390 passed \| 2 skipped (2392)` — **리포트 2,390/2와 일치** |
| web unit — `run.sh`의 5스펙 | `5 passed / 45 passed (45)` — **리포트 45와 일치** |
| `google-drive.service.spec.ts` 단독 | `97 passed` (변이 기준선; 리포트 97과 일치) |
| server `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| server `npx eslint` (바뀐 스펙 2파일, `--max-warnings 0`) | exit 0 |
| 첨부 증거 `results/20260916-2153.txt` | `commit: cf6bf36eb`, **UNCOMMITTED 마커 없음**(`run.sh:122-123`이 `results/`만 제외하고 `porcelain`을 본다), 280 / 45 / svelte-check 회귀 없음, `RESULT: PASS` — 주장대로 |
| `git diff b4967e07e cf6bf36eb --stat` | `CLAUDE.md`, `google-drive.service.spec.ts`, `system-config.service.spec.ts`, wave8c 리뷰 파일 — **운영 코드 0줄, 리포트 주장 그대로** |
| `git merge-base --is-ancestor v3.1.0 HEAD` | ancestor 맞음 |
| 런북 N3 python 파이프 — 가짜 JSON 4종 | 아래 §Answers 2 |
| server medium (실 DB) | **돌리지 못했다** — Docker 미기동, 리포트와 같은 입장 |
| `git status --porcelain` (종료 시) | **이 리뷰 파일 하나뿐** |

**변이 전수.** 대상 `server/src/services/google-drive.service.ts`(줄 번호는 HEAD 기준), 스펙 기준선 97.

| # | 변이 | 결과 | 판단 |
|---|---|---|---|
| M1 | `:1443` `subscribeAlbum`의 `AlbumDownload` → `AlbumRead` | `1 failed \| 96` — `should gate subscribing on download access…`, *expected … 'album.download access' but got 'Not found or no album.read access'* | **리포트 M1 그대로.** wave8c C1 닫힘 — 지난 라운드 M5(96 passed)가 이제 죽는다 |
| M2 | `:1517` `syncAlbum`의 `AlbumDownload` → `AlbumRead` | `1 failed \| 96` — `should gate syncing on download access…`, 같은 문장 | **리포트 M2 그대로.** wave8c C2 닫힘 — 지난 라운드 M7(96 passed)가 이제 죽는다 |
| M3 | `:1528-1530` `isSubscribed` 가드 삭제 | `1 failed \| 96` — `should reject an album the caller has not chosen to back up`, *promise resolved "undefined" instead of rejecting* | **리포트 M3 그대로.** wave8c N1 닫힘 |
| M4 (추가) | `:1509-1511` enabled 게이트를 `:1517` `requireAccess` **뒤로** 이동 | `1 failed \| 96` — `should reject when the feature is disabled`, *expected 'Google Drive sync is not enabled…' but got 'Not found or no album.download access'* | `syncAlbum`의 게이트 순서는 기존 테스트(spec `:1596-1609`)의 문장 단언이 잡는다. 새 테스트는 여기서 필요 없다 |
| M5 (추가) | `:1519` `album.getById`를 `:1517` `requireAccess` **앞으로** 이동 | `1 failed \| 96` — `should gate syncing on download access…`, *expected "spy" to not be called at all, but actually been called 1 times* | 새 테스트의 `getById` 미호출 목격자가 **접근 제어가 먼저**를 붙든다 (wave8c M4의 `syncAlbum` 판) |
| M6 (추가) | `:1517` `AlbumDownload` → `AlbumUpdate` (Editor 역할) | `1 failed \| 96` — 같은 테스트, *… but got 'Not found or no album.update access'* | "더 센 권한"으로 바꿔도 죽는다 — 테스트는 *정확히 download*를 요구한다. 의도된 엄격함이다 |

## Findings

이번 라운드에 C(차단 후보)급은 없다. 아래는 전부 nitpick이다.

### N1 — 리포트의 "wave8 시리즈" 범위 `a0cdc42de..HEAD`는 시리즈의 운영 코드 커밋을 빠뜨린다 (nitpick, 문서)

`git log --oneline a0cdc42de~4..a0cdc42de`:
```
a0cdc42de docs(google-drive): review request for removing the admin config surface
f4a6e2906 feat: describe the Google Drive deployment by its environment, not an admin form
44c38c445 docs(google-drive): record the settings-cards review — not blocked
```
`a0cdc42de`는 wave8 리뷰 **요청서** 커밋이고 `a0cdc42de..HEAD`는 그것을 제외한 뒤부터다. 즉 이 범위에는
관리 폼을 제거한 실제 운영 커밋 `f4a6e2906`이 없다. 시리즈의 운영 코드 총량은 `git diff f4a6e2906^ HEAD --stat --
server/src web/src i18n`(스펙·SQL 제외)으로 봐야 한다:
`config.ts` +30/-, `system-config.dto.ts` -1, `album.service.ts` 3, `google-drive.service.ts` 22, `utils/misc.ts` 18,
`admin/system-settings/+page.svelte` -9, `GoogleDriveSettings.svelte`(admin) -84, `i18n/en.json` -11.
그 중 `f4a6e2906` 이후에 들어온 운영 변경은 `0d0d42a83`(wave8b: `misc.ts` 라벨·문장, `google-drive.service.ts` 게이트)과
`7048d8be2`(wave8c: `album.service.ts` JSDoc)뿐이고 각각 리뷰를 거쳤다. **고치는 법**: 리포트·배포 커밋 메시지에서
범위를 `44c38c445..HEAD`(= `f4a6e2906^..HEAD`)로 적는다. 판정에는 영향 없다 — §Answers 3.

### N2 — 런북 step 2의 `curl` 예시에 `...` 자리표시자가 남아 있다 (nitpick, 문서)

`CLAUDE.md:540`: `curl -s -H "x-api-key: $KEY" .../api/system-config/defaults | python3 …`. 같은 §7의 다른 명령들은
`http://192.168.50.211:2283/api/server/features`처럼 호스트를 그대로 적는다(`CLAUDE.md` step 5의 `curl`). 복사해서
바로 돌릴 수 있게 `http://192.168.50.211:2283/api/system-config/defaults`로 채우는 편이 이 런북의 관례에 맞다.
파이프 자체는 안전하다 — §Answers 2.

### N3 — `2e1cdceb0`은 이번 리포트가 처음 인용한다 (nitpick, 기록)

리포트 스스로 "uncited by any report"라고 밝힌 대로다. 내용은 `results/20260916-2139.txt` 하나이고, wave8c 리뷰가
이미 그 파일을 검증했다(commit `7048d8be2`, 279/45, PASS). 추가로 볼 것 없음. 다음부터는 증거 커밋을 그 라운드
리포트에 같이 적으면 이런 뒤늦은 인용이 생기지 않는다.

## Answers to what the report asked me to attack

### 1. 새 `syncAlbum` 권한 테스트는 "기본 stub이 비어 있다"에 기댄다 — 실제로 비어 있는가? 앞선 가드가 우연히 같은 문장을 낼 수 있는가?

**비어 있고, 같은 문장을 낼 앞선 가드는 없다.** 사슬을 끝까지 따라갔다.

- `newTestService`(`test/utils.ts:337`)는 `access: newAccessRepositoryMock()`을 주고, 그 mock은
  `album.checkOwnerAccess`·`album.checkSharedAlbumAccess` 모두 `vitest.fn().mockResolvedValue(new Set())`
  (`test/repositories/access.repository.mock.ts:27-28`)이다. 파일 최상위 `beforeEach`(spec `:202-213`)는
  `driveFilesGet`/`driveAboutGet`/`oauth2GetAccessToken`만 리셋하고 access는 건드리지 않는다. `describe('syncAlbum')`의
  `beforeEach`(spec `:1591-1593`)는 `systemMetadata.get`만 stub한다. 그 블록 안에서 `mocks.access`를 stub하는 줄은
  `:1631`, `:1653`, `:1673`, `:1696`, `:1710` — 전부 **개별 `it` 안**이고 새 테스트(`:1613-1624`)에는 없다.
- `AuthFactory.create(user)`(`test/factories/auth.factory.ts:10-15`)는 `#sharedLink`를 세팅하지 않으므로
  `checkAccess`(`utils/access.ts:53-55`)는 `checkOtherAccess` 분기를 탄다. `Permission.AlbumDownload` case
  (`access.ts:211-218`)는 owner ∪ Viewer, 둘 다 빈 Set → `requireAccess`(`access.ts:37-42`)가
  `areSetsEqual({'album-1'}, ∅)` 실패로 `Not found or no album.download access`를 던진다.
- 앞선 가드는 `syncAlbum:1509-1511`의 enabled 게이트 하나뿐이고 문장은 `Google Drive sync is not enabled on this
  server`다. `enabledConfig`(spec `:86-91`)는 clientId·clientSecret·redirectUrl이 채워져 있어 통과한다. 뒤의 가드
  (`:1521` `Album not found`, `:1529` `Add this album…`)는 `requireAccess`가 먼저 던지므로 도달하지 않는다 —
  M5로 `getById`를 앞당기면 목격자에서 죽는 것이 그 증거다.
- 문장이 우연히 맞을 가능성: `requireAccess`의 문장은 `${request.permission}` 보간이라 다른 권한으로는 절대 같은
  문장이 안 나온다(M1·M2·M6이 각각 `album.read`·`album.update`로 죽는다). enabled 게이트 문장과는 공통 접두어조차
  없다.

결론: 이 테스트는 "requireAccess가 AlbumDownload로 거부했고, 그 전에 아무것도 안 했다"를 정확히 그 이유로 본다.

### 2. N3 python 파이프는 값을 출력하는 일이 있는가?

**없다.** `config.ts:121-126`의 `SystemConfig['googleDrive']`는 네 키 전부 `string`이고, `getDefaults()`
(`system-config.service.ts:30-32`)는 `mapConfig(defaults)`, `mapConfig`는 identity(`system-config.dto.ts:462-464`)
라 응답의 `googleDrive`는 그 네 문자열뿐이다. 가짜 입력 네 가지로 실제로 돌려봤다(스크래치패드, 값은 `SECRET-…`
더미):

| 입력 | 출력 |
|---|---|
| 정상 응답 (문자열 4개) | `{'clientId': 13, 'clientSecret': 16, 'redirectUrl': 0, 'apiKey': 10}` — 길이만 |
| 비문자열 필드(`true`, `42`)가 섞인 경우 | `TypeError: object of type 'bool' has no len()` — 키 이름도 값도 없음 |
| 401 본문 (`{"message":…,"statusCode":401}`) | `KeyError: 'googleDrive'` |
| JSON이 아닌 본문 (HTML) | `JSONDecodeError: Expecting value: line 1 column 1` — 본문 미출력 |

`len()`이 성공하는 비문자열은 list/dict뿐인데 그때도 길이만 찍힌다. 어느 경로에서도 값이나 본문 조각이 stdout/stderr에
나오지 않는다. 런북의 권한 문구도 맞다 — `system-config.controller.ts:29-30`이 `@Authenticated({ permission:
Permission.SystemConfigRead, admin: true })`이고 enum 값은 `'systemConfig.read'`(`enum.ts:258`). "재시작 필요"도 맞다
— `defaults`는 `config.ts:345-352`에서 모듈 로드 시 `process.env`를 읽는 const다. 남은 것은 N2의 `...` 자리표시자뿐이다.

### 3. wave8 시리즈를 배포해도 되는가?

**된다.** 근거를 나열한다.

- **네 라운드 모두 NOT BLOCKED.** wave8(`20260914-2240-review.md:13`), wave8b(`…2120-review.md:13`),
  wave8c(`…2140-review.md:211`), 그리고 이번. 각 라운드의 C/N은 다음 라운드가 닫았고 이번 라운드는 열린 C가 없다.
- **운영 코드는 `f4a6e2906` + `0d0d42a83` + `7048d8be2`, 세 커밋뿐이다**(N1의 stat). 이번 라운드는 0줄.
- **테스트 관문.** 서버 전체 2,390 / 웹 45 / `tsc` / `eslint` 전부 통과. 시리즈 안에서 유일하게 남아 있던
  "테스트가 못 보는 결정"(download vs read)이 이번에 닫혔고, 변이 6건이 각각 한 테스트를 정확한 사유로 죽인다.
- **`v3.1.0`의 후손**(`merge-base --is-ancestor`), 즉 다운그레이드가 아니다.
- **배포 절차의 하드 게이트**(`CLAUDE.md` §7 "배포 전 1")는 코드가 아니라 설정이다: 운영 row가 다섯 키를 전부 갖고
  있음이 2026-09-14에 확인됐고(`CLAUDE.md` §8), `buildConfig`는 partial을 defaults 위에 덮으므로 폼이 사라져도 기능은
  켜진 채 남는다. 관리 폼을 지운 `f4a6e2906`은 값의 **출처**를 바꾼 것이지 값을 지운 것이 아니다. 런북 step 3의 전제
  ("웹은 전체 설정을 보낸다")도 확인했다 — `web/src/lib/services/system-config.service.ts:47-56`이 `getConfig()`로
  전체를 받아 `{...config, ...update}`를 만들고 `isEqual`이면 요청을 안 보낸다. 관리 웹에는 `googleDrive`가
  `QueuePanel.svelte:94`의 feature flag 참조 하나만 남았다.

**막을 것이 보이지 않는다.** 단, 배포 뒤 확인 순서(§7 "배포 직후 5~8")는 이 시리즈와 무관하게 그대로 밟아야 한다 —
특히 5번의 `GET /api/server/features`의 `googleDrive`가 `true`인지가 폼 제거 이후 첫 배포에서 볼 첫 번째 것이다.
런북 §8의 row 정리는 리포트 말대로 **배포와 독립**이고 아직 실행되지 않았다.

## What I did not verify

- **medium 스위트(실 DB).** Docker 미기동. 이번 커밋은 리포지토리·스키마·SQL을 건드리지 않고 `tsc`가 medium 스펙까지
  타입검사하므로 사정권 밖으로 본다.
- **런북 정리 절차의 실행과 `/api/system-config/defaults` 실호출.** 운영에 대고 돌리지 않았다(관리자 API 키가 필요하고,
  값이 평문으로 오는 엔드포인트다). 파이프의 안전성은 가짜 입력으로만 확인했다.
- **운영 row의 현재 상태.** 2026-09-14 확인(`CLAUDE.md` §8)에 기댔고 다시 조회하지 않았다. 배포 직후 §7 5번이 이것을
  대신 검증한다.
- **svelte-check.** 웹 코드 변경이 없고 증거 파일이 회귀 없음을 기록한다.
- `git status --porcelain` — 종료 시 **이 리뷰 파일 하나만** 나온다. 변이 대상 서비스·스펙 파일은 매번
  `git checkout --`으로 복원했고 md5로 확인했다.

## Feeding back into the plan

`dev-docs/google-drive/wave6-plan.md`(또는 테스트 관례를 적는 곳)에 넣을 것:

1. **사용자 발 세 경로의 테스트 묶음이 이제 완성됐다.** `subscribeAlbum`·`syncAlbum`은 게이트 + 권한(문장 단언) + 순서
   목격자, `resumeUploads`는 게이트 + 연결. wave8c 피드백 2번의 "권한은 `subscribeAlbum`만" 문장을 지운다.
2. **`requireAccess` 문장 단언은 "더 센 권한"으로 바꿔도 죽는다**(M6). 나중에 누가 `AlbumDownload`를 `AlbumUpdate`로
   올리고 싶다면 그건 정책 변경이고, 테스트 이름과 `syncAlbum:1512-1516` 주석을 함께 고쳐야 한다 — 테스트가 우연히
   깨진 것이 아니다.
3. **시리즈 범위는 리뷰 요청서 커밋이 아니라 운영 코드 커밋의 부모부터 적는다**(N1). `docs:` 커밋 해시를 기준으로 잡으면
   그 앞의 `feat:`가 빠진다.
4. **런북의 `curl` 예시는 호스트까지 채운다**(N2). §7의 다른 명령과 같은 관례.

---

**VERDICT: NOT BLOCKED** — 차단 사유 없음. N1(리포트 범위 표기 `a0cdc42de..HEAD`가 `f4a6e2906`을 빠뜨림, 문서),
N2(`CLAUDE.md:540` `curl` 자리표시자 `...`), N3(`2e1cdceb0` 뒤늦은 인용, 기록). 운영 코드 변경 0줄.
**wave8 시리즈(`f4a6e2906`~HEAD)는 배포에 적합하다** — 네 라운드 모두 NOT BLOCKED, 열린 C 없음, 전체 스위트 통과,
`v3.1.0` 후손. 배포 직후 §7 5~8번 확인 절차는 그대로 밟는다.
