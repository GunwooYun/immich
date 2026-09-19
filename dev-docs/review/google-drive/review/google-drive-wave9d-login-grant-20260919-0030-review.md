# Code Review — wave9d: wave9b fold-in + Google-login Drive grant (`b72e446f1` … `cfc8cdb93`)

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review-b` @ `dbf12fe3f` (`feat/google-drive-album-sync-v3.1.0`) |
| Commits reviewed | `b72e446f1` (wave9b fold-in, web), `76ab2a3f0` (CLAUDE.md Current Project), `cfc8cdb93` (login grant, server), `1c8944740` (증거), `dbf12fe3f` (리포트) — `git diff f47d59906 cfc8cdb93 -- server/src web/src CLAUDE.md` |
| Report | `../report/google-drive-wave9d-login-grant-20260919-0030-report.md` |
| Reviewed | 2026-09-19 (모든 수치는 이 워크트리 HEAD에서 직접 돌린 것) |

## Verdict

**배포 판정: 막지 않는다 (NOT BLOCKED).** 두 파트 모두 리포트가 말한 대로다. Part 1의 `AuthLogout` 구독과 `handleDisconnect`의
`reset()`은 코드에 있고 새 테스트는 emit 전 `has('a') === true`를 먼저 단언해 공허하지 않다. Part 2의 게이트 다섯 절, `authorize`의
extraParams 선(先)전개, `callback`/`link`의 try/catch, 핸들러의 "기존 연결이 있으면 아무 것도 쓰지 않는다"까지 전부 확인했고,
리포트 수치(스펙 3개 241 / 서버 전체 2,431+2 / 웹 전체 586+2 / 증거 파일 307·70·PASS)도 전부 재현됐다. 리포트 변이 3건은 물론
내가 추가한 변이 2건(M-A, M-B)도 정확한 테스트 하나에 잡혔다. 이 배포본은 OAuth 로그인 자체가 꺼져 있어 새 경로는 죽은 코드다.

가장 중요한 문제는 **게이트가 `oauth.prompt`를 보지 않는다**는 것이다(N1). 운영자가 로그인에 `prompt=consent`를 켜 둔 상태에서
이 게이트가 열리면 **로그인할 때마다** 구글이 새 refresh token을 발급하는데, 첫 연결 이후의 것은 저장되지 않고 버려진다. 구글은
계정×클라이언트당 refresh token을 100개까지만 유지하고 넘치면 **가장 오래된 것을 경고 없이 무효화**한다 — 그 가장 오래된 것이
바로 저장된 Drive 토큰이다. 이 배포본의 기본값(`prompt: ''`)에서는 일어나지 않으므로 N으로 둔다. 나머지는 항목 3·4에 대한 답
(secret 비교 권고, `include_granted_scopes` 주석 오류)과 테스트 공백 두 건이다.

### Evidence I ran myself

워크트리의 `server/node_modules`·`web/node_modules`는 이전 라운드가 남긴 메인 저장소로의 심볼릭 링크였다(`.gitignore` 대상,
`porcelain`에 안 잡힘). 메인 저장소에서는 아무것도 돌리지 않았다. 변이는 `sed`/`python`으로 넣고 매번 `git checkout --`으로
되돌렸으며, 세 파일의 md5가 변이 전과 같음을 `md5sum -c`로 확인했다(`OK` 3건). N3 실험용 임시 스펙은 실행 직후 삭제했고
`ls`로 부재를 확인했다.

| Check | Result |
|---|---|
| server unit — `auth.service.spec.ts` + `google-drive.service.spec.ts` + `utils/google-drive.spec.ts` | `3 passed / 241 passed` (101 + 105 + 35) |
| server unit — 전체 (`--config test/vitest.config.mjs`) | `94 passed / 2431 passed \| 2 skipped (2433)` — **리포트와 일치** |
| web unit — `google-drive-uploaded-manager.svelte.spec.ts` + `Thumbnail.spec.ts` | `2 passed / 11 passed` |
| web unit — 전체 (`npx vitest run`) | `60 passed \| 1 skipped / 586 passed \| 2 skipped (588)` — **리포트와 일치** |
| server `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| server `npx eslint` (바뀐 8파일, `--max-warnings 0`) | exit 0 |
| 첨부 증거 `results/20260919-0841.txt` | `commit: cfc8cdb93`, 서버 307 / 웹 70, svelte-check 회귀 없음, `RESULT: PASS` — 주장대로. 단 리포트 파일명의 `0030`은 이 증거(08:41 +0900)와 커밋(08:41·08:42)보다 **앞선** 시각이다 (N6) |
| `git diff f47d59906 cfc8cdb93 --stat` | 13 files, +703/−51 — 서버 9(스펙 3 포함), 웹 4, CLAUDE.md 1 |
| CLAUDE.md 헤딩 변화 | `## Current Project: …` 한 줄만 바뀜, `## Fork Rules` 무변경 (`git diff … \| grep '^[-+]#'`) |
| Google OAuth 문서 (WebFetch) | `include_granted_scopes`·`access_type=offline`·refresh token 발급 조건·100개 상한 원문 인용 — 아래 §답변 4 |
| svelte-check / web eslint / medium | 돌리지 않았다 (§What I did not verify) |
| `git status --porcelain` (종료 시) | 이 리뷰 파일 + 지시받은 대로 건드리지 않은 stale 파일 `…wave9b-drive-badge-20260916-2335-review.md` 뿐 |

**변이.** 줄 번호는 HEAD 기준.

| # | 변이 | 결과 | 판단 |
|---|---|---|---|
| R1 (리포트) | 핸들러의 existing-credentials return 삭제 | 리포트: `leave an existing connection completely alone` 실패 | 재실행하지 않음 — 테스트 본문(`google-drive.service.spec.ts:2130-2146`)이 `upsertCredentials`·`adoptUnstampedUploads`·`driveAboutGet` 셋 다 `not.toHaveBeenCalled`이고 `getCredentials` 호출을 목격자로 두므로 논리상 잡힌다 |
| M-A (추가) | `auth.service.ts:500` `!refreshToken \|\|` 절 삭제 | `1 failed \| 100` — `should not emit when Google returned no refresh token` | 잡힌다 |
| M-B (추가) | `google-drive.service.ts:426-428` `isEnabled` 게이트 삭제 | `1 failed \| 104` — `should do nothing at all when the feature is not configured`, *expected "spy" to not be called at all, but actually been called 2 times* | 잡힌다. 설정이 비어 `getOAuth2Client`가 던져도 프로브가 삼켜 `null`로 upsert까지 가므로, 이 게이트가 없으면 실제로 쓴다 |
| M-C (추가) | `oauth.repository.ts:68` `...extraParams`를 `state` **뒤로** 이동 | **`190 passed` — 살아남음** (`auth.service.spec.ts` + `src/repositories/`) | "선전개라 덮어쓸 수 없다"는 불변식을 지키는 테스트가 없다 (N4). `oauth.repository.spec.ts`는 존재하지 않는다 |
| X-1 (실험) | 임시 스펙: `vi.spyOn(authManager, 'isSharedLink', 'get').mockReturnValue(true)` 후 `Thumbnail` 렌더 | `3 passed` — 배지 사라짐, `mockRestore` 후 `false`로 복귀, 다음 테스트에서 배지 다시 보임 | 리포트 N3의 "매니저를 통째로 mock해야 한다"는 전제가 틀렸다 (N5) |

## Findings

### N1 — 게이트가 `oauth.prompt`를 보지 않는다: `prompt=consent` 배포에서 로그인마다 버려지는 refresh token이 저장된 Drive 토큰을 밀어낸다 (nice-to-have, 게이트를 실제로 여는 배포에서는 must)

- `server/src/services/auth.service.ts:305-307` — 게이트가 참이면 `access_type=offline`을 **모든** 로그인에 붙인다.
  `server/src/repositories/oauth.repository.ts:74-76` — `config.prompt`가 있으면 그대로 `prompt=`로 나간다.
  `server/src/config.ts:381` — 기본값 `prompt: ''`.
- 구글 문서(`developers.google.com/identity/protocols/oauth2/web-server`, WebFetch 인용): *"The `refresh_token` is only returned on
  the first authorization"* unless `prompt=consent`. 같은 사이트 `/oauth2#expiration`: *"There is currently a limit of 100 refresh
  tokens per Google Account per OAuth 2.0 client ID. If the limit is reached, creating a new refresh token automatically invalidates
  the oldest refresh token without warning."*
- 조합하면: 운영자가 로그인에 `prompt=consent`를 켜 두면(계정 선택 화면을 매번 띄우려고 흔히 켠다) 게이트가 열린 뒤 **모든** 로그인이
  새 refresh token을 받는다. 핸들러는 첫 연결 이후 것을 `google-drive.service.ts:431-434`에서 버린다(옳다). 그러나 발급 자체는 구글
  쪽에서 이미 일어났고, 100번째 로그인에서 무효화되는 "가장 오래된" 토큰은 그 사용자의 **저장된 Drive 토큰**이다. 워커는
  `invalid_grant`로 `clearRevokedGrant`를 타 연결이 사라진다 — 원인을 가리키는 로그가 없다.
- 기본값에서는 refresh token이 첫 동의 때 한 번만 나오므로 일어나지 않는다. 이 배포본은 OAuth 로그인 자체가 꺼져 있다.
- **Fix.** `isGoogleDriveLoginGrantEnabled`(`server/src/utils/google-drive.ts:278-298`)에 절 하나 추가:
  `oauth.prompt`를 공백으로 나눈 토큰에 `consent`가 있으면 `false`. 이유 주석은 위 두 인용으로 충분하다. 테스트는 `allTrue({ oauth:
  { prompt: 'consent' } })` → false, `prompt: 'select_account'` → true 두 줄. 대안(문서만)은 약하다 — 이 실패는 몇 달 뒤 조용히 온다.

### N2 — 항목 3: `oauth.clientSecret`도 비교하는 것이 맞다 (nice-to-have)

- `server/src/utils/google-drive.ts:289-291` — `clientId`만 비교한다. `server/src/services/google-drive.service.ts:146-172`
  `getOAuth2Client`는 **`googleDrive.clientSecret`**으로 클라이언트를 만들고, 저장된 토큰의 refresh는 전부 여기를 지난다.
- 코드 교환은 `oauth.clientSecret`으로 성공하므로(`oauth.repository.ts:103`), `googleDrive.clientSecret`이 틀려도 로그인 경로는
  토큰을 손에 넣는다. 그 뒤 `storeGrant` → `getDriveAccountId`(`:584-625`)가 refresh에 실패하지만 **catch에서 `null`을 돌려주고**
  (`:619-624`) `:392-393`이 그대로 upsert한다. 결과: "연결됨"으로 보이지만 refresh마다 `invalid_client`로 죽는 연결. `isInvalidGrant`
  (`:1460-1469`)는 `invalid_grant`만 보므로 revoked 정리도 안 되고, `classifyDriveError`(`utils/google-drive.ts:121-130`)는 `Unknown`
  으로 떨어져 잡마다 재시도한다. 이 포크가 가장 싫어하는 "조용히 연결된 척" 상태다.
- 같은 오설정에서 **수동 경로는 시끄럽게 실패한다** — `linkAccount`(`:334-362`)의 `getToken`이 던지고 `Failed to link`로 돌아온다.
  로그인 경로만 비대칭으로 조용하다.
- 반론: 구글 콘솔은 클라이언트 하나에 secret 여러 개(회전용)를 허용하므로 서로 다른 두 값이 둘 다 유효할 수 있다. 그 경우 비교는
  false negative(로그인이 Drive를 안 잇는다)를 만들 뿐 안전한 방향이고, "로그인 클라이언트가 Drive 클라이언트여야 한다"는 절의
  의미에도 secret이 들어가는 편이 정직하다.
- **Fix.** `:289` 절을 `!googleDrive.clientId || oauth.clientId !== googleDrive.clientId || oauth.clientSecret !== googleDrive.clientSecret`
  로. 비교만 하고 어느 쪽도 로그·에러에 싣지 않는다. 테스트는 `allTrue({ oauth: { clientSecret: 'other' } })` → false 한 줄
  (`allTrue`의 oauth 픽스처에 `clientSecret: 'client-secret'` 추가 필요). 더 강한 대안 — 로그인 경로에 한해 프로브가 **예외**로
  끝나면 저장하지 않기 — 는 "Drive가 응답했으나 permissionId 없음"과 구분하는 리팩터가 필요해 이번 라운드 권고에서 뺀다.

### N3 — 항목 4: `include_granted_scopes=true`는 이 게이트 아래에서 무의미하고, 주석이 그 의미를 잘못 적었다 (nice-to-have)

- `server/src/services/auth.service.ts:296-299` 주석: *"keeps Google's incremental-authorization contract: a user who has already
  granted drive.file is not asked again, and the token response still reports the full granted scope list"*.
- 구글 문서 원문: *"If you set this parameter's value to `true` and the authorization request is granted, then the new access token
  will also cover any scopes to which the user previously granted the application access."* — 이 파라미터는 **새 토큰의 범위를
  과거 허가와 합집합으로 만드는** 것이지, 동의 화면을 다시 띄울지 여부를 정하지 않는다(그건 `prompt`다). 이미 허가한 scope를
  다시 묻지 않는 것은 이 파라미터와 무관한 구글의 기본 동작이다.
- 게이트가 참이려면 로그인 scope에 이미 `drive.file`이 있으므로(`utils/google-drive.ts:293`), 합집합이 더해 주는 것은 없다 —
  과거에 더 넓은 scope(예: `drive`)를 허가받은 적이 있을 때 그것이 **딸려 들어오는** 효과만 있다. 이 기능에는 해가 없지만
  의도한 것도 아니다.
- **Fix.** 파라미터를 빼서 게이트 유무의 차이를 `access_type=offline` 하나로 줄이거나(권장 — `:305-307`, 스펙
  `auth.service.spec.ts:1500-1508` 기대값 수정), 남기려면 주석을 위 인용대로 고친다.

### N4 — `authorize`의 "extraParams는 선전개라 덮어쓸 수 없다"에 테스트가 없다 (nitpick)

- 변이 M-C(`oauth.repository.ts:68`의 `...extraParams`를 마지막으로 이동)가 190개 테스트를 전부 통과했다. `oauth.repository.spec.ts`는
  없다. 위험은 이론적이다 — `extraParams`는 `auth.service.ts:306`의 상수 리터럴이지 입력이 아니다 — 하지만 주석(`:44-49`)이
  약속하는 성질이면 테스트가 있어야 한다.
- **Fix.** `oauth.repository.spec.ts`를 새로 만들 필요까지는 없다. `params` 조립을 순수 함수(예: `buildAuthorizationParams(config,
  redirectUrl, state, extraParams)`)로 빼고 `{ redirect_uri: 'evil' }`을 넘겨도 `redirect_uri`가 유지되는지 한 줄 단언하면 된다.

### N5 — 항목 7: wave9b N3의 "테스트를 뺀 이유"가 틀렸다 — `vi.spyOn(authManager, 'isSharedLink', 'get')` 한 줄이면 된다 (nice-to-have)

- `web/src/lib/components/assets/thumbnail/__test__/Thumbnail.spec.ts:52-56` 주석: *"a test cannot flip it without mocking the
  manager itself — which would weaken every other case in this file"*.
- `$derived` 클래스 필드(`web/src/lib/managers/auth-manager.svelte.ts:18`)는 프로토타입 **getter**로 컴파일된다. vitest의 `spyOn(obj,
  prop, 'get')`은 프로토타입 체인에서 descriptor를 찾아 **인스턴스에 own property로** 덮으므로 derived 캐시를 우회하고,
  `mockRestore()`가 그 own property를 걷어 원래 getter로 돌아간다. 매니저의 다른 어떤 것도 건드리지 않는다.
- 실증(X-1): 임시 스펙 3건 — 기본 렌더에서 배지 있음 → spy 후 렌더에서 `[data-icon-google-drive]` null이고 `[data-thumbnail-focus-
  container]`는 있음 → `mockRestore` 후 `isSharedLink === false`, 다음 테스트에서 배지 다시 있음. **`3 passed`.** 스펙은 삭제했다.
- **Fix.** 배지 `describe`에 위 형태의 테스트 하나를 넣고(`spy.mockRestore()`는 §2 규칙대로 `afterEach`에), `:52-56` 주석은 지운다.
  wave9b 리뷰 M9(`Thumbnail.svelte:352`의 `!authManager.isSharedLink &&` 삭제)가 이 테스트로 잡히는지 확인하면 끝이다.

### N6 — 문서·정합성 nitpick 묶음

- **모바일 OAuth 로그인도 이 경로를 탄다.** 리포트는 "Mobile OAuth deliberately out of scope"라 했지만 그것은 *테스트 범위*지
  *동작 범위*가 아니다. 모바일 앱의 OAuth도 `oauth.controller.ts:64-76` `callback`으로 들어오고 `resolveRedirectUri`(`auth.service.ts
  :725-`)가 앱 스킴을 처리하므로, 게이트가 열리면 폰에서 처음 구글 로그인한 사용자도 Drive가 연결되고 그 로그인 응답도 프로브를
  기다린다. 리포트/플랜에 "동작은 공통, 검증만 웹" 으로 적어야 다음 라운드가 되묻지 않는다.
- **로그인 경로는 사실상 "첫 offline 동의 한 번"이다.** `disconnect`(`google-drive.service.ts:1014-1020`)는 구글에 revoke하지
  않고 행만 지운다. 따라서 연결 해제 뒤의 로그인은 (기본 `prompt`에서) refresh token을 받지 못해 다시 잇지 못하고, 복구는 수동
  Connect(그쪽은 `prompt: 'consent'`)다. 의도와 맞지만 플랜에 한 줄 있어야 한다.
- **리포트 파일명 스탬프 `20260919-0030`**이 증거(`08:41 +0900`)와 커밋(`08:41`/`08:42`)보다 이르다. §2 규칙은 리포트 스탬프를
  작성 시각으로 둔다 — 짝 이름은 그대로 두되 다음부터는 실제 시각을 쓴다.
- `linkAccount` docblock(`google-drive.service.ts:326-333`, 특히 `:330`) "the only supported entry point into linking an account is the callback
  flow"는 `linkAccount` 자신에 대해서는 여전히 참이지만, 한 줄 아래 `storeGrant`에 두 번째 진입점이 생겼으므로 "…into *this
  method*"로 좁혀 두면 오해가 없다.

## Answers to what the report asked me to attack

### 1. emit을 await하는 것이 맞는가

**맞다. 유지한다.** 근거:

- 경로: `auth.service.ts:505` `await this.eventRepository.emit(...)` → `event.repository.ts:239-249` `onEvent`가 핸들러를 **순차
  await** → `google-drive.service.ts:424-438` → `storeGrant(:376-402)` = `drainUnstampedUploads`(이 경로에선 `:491-494`에서 즉시
  return, 자격증명이 없으므로) + `getDriveAccountId`(`:584-625`, `about.get` 10s·`retry:false`, 단 그 앞의 토큰 refresh는
  google-auth-library 안에서 무한정 — 주석 `:598-604`가 스스로 인정) + upsert + clearErrors. 즉 로그인 지연 = refresh 1회 + 10s
  이내 프로브 + DB 3회.
- **비용은 사용자당 한 번이다.** 첫 연결 이후에는 (a) 기본 `prompt`에서 구글이 refresh token을 안 주므로 `:500`에서 빠지거나,
  (b) 줘도 `:431-434`가 DB 읽기 두 번으로 끝낸다.
- **분리하면 경합이 생긴다.** 로그인 직후 페이지가 설정 화면이면 `getStatus`가 upsert보다 먼저 돌아 "미연결"을 보여 주고, 사용자가
  Connect를 누르면 수동 `linkAccount`와 로그인 그랜트의 `storeGrant`가 **동시에** `connectionId`를 찍는다. await는 이 경합을
  없앤다.
- 남는 위험: 클라이언트 HTTP 타임아웃이 프로브 중에 끊기면 세션은 만들어졌는데 사용자는 로그인 실패를 본다(코드는 이미 소비돼
  재시도도 실패). 이 배포본은 무관하고, 정말 문제가 되면 **분리가 아니라 refresh에 상한을 거는** 쪽이 답이다 — 그것은 `:598-604`
  가 이미 알고 미룬 일이다.

### 2. `link` 경로

**옳고, 안전하다.** `oauth.controller.ts:54-67`(`@Authenticated()`) → `auth.service.ts:447-475`. 다른 immich 사용자에 이미 묶인
구글 계정이면 `:460-463`이 emit **전에** 던진다. 이미 Drive를 A 계정으로 잇고 있는 사용자가 로그인을 B 계정에 묶으면 emit은 되지만
핸들러가 `:431-434`에서 기존 연결을 그대로 둔다(debug 로그, 토큰 없음). Drive가 없는 사용자가 B를 묶으면 B의 Drive가 연결된다 —
"로그인 계정 = Drive 계정"이라는 이 기능의 전제와 일치한다. `link`도 `callback`과 같은 try/catch 안에 있어 실패해도 링크는 남는다
(`should still link the account when connecting Drive throws`, `user.update` 호출을 목격자로 둠).

### 3. 게이트 완전성 — `oauth.clientSecret`도 비교해야 하는가

**비교해야 한다.** N2에 근거·결과·수정을 적었다. 요약: refresh는 `googleDrive.clientSecret`으로만 일어나고(`:146-172`), 프로브 실패는
`null`로 삼켜져(`:619-624`) 그대로 upsert되므로(`:392-393`), secret이 어긋난 배포는 로그인 경로에서만 **조용히** "연결된 척" 하는
행을 만든다. 수동 경로는 같은 조건에서 시끄럽게 실패한다. 그 외 조합: `oauth.issuerUrl`이 구글이지만 **다른 GCP 프로젝트**의
클라이언트 — `clientId` 비교가 이미 막는다. `googleDrive.apiKey`는 Picker 전용이라 토큰 사용성과 무관하다. `oauth.prompt`는 N1.

### 4. `include_granted_scopes=true`의 의미

- 구글 문서상 이 파라미터는 **새 토큰의 scope를 과거 허가와의 합집합**으로 만든다(N3 인용). 따라서 "나중 로그인의 토큰이
  drive.file을 **잃는** 경우"는 이 파라미터로는 생길 수 없다 — 합집합은 줄지 않는다. 반대 방향(사용자가 이번 화면에서 drive.file을
  풀었는데 과거 허가 때문에 `scope`에 drive.file이 보고되는 경우)은 구글의 세분화 권한 모델상 **정확한 보고**다: 과거 허가는 사용자가
  계정 설정에서 revoke하기 전까지 살아 있고, revoke하면 앱의 토큰이 통째로 죽어 `invalid_grant` 경로로 정리된다.
- 첫 연결만 쓰므로(`:431-434`) 나중 로그인의 scope는 어차피 결과에 영향이 없다.
- 실제로 문제가 되는 것은 scope가 아니라 **refresh token 개수**다(N1). 그리고 파라미터 자체는 게이트 아래에서 무의미하다(N3).

### 5. `authorize` extraParams

**확인했다.** `oauth.repository.ts:67-72` — `...extraParams`가 첫 줄, 그 뒤 `redirect_uri`·`scope`·`state`가 덮고, `:74-76`
`prompt`, `:78-81` PKCE가 그 뒤에 온다. openid-client의 `buildAuthorizationUrl`(`node_modules/openid-client/build/index.js:1133-1138`)
은 `client_id`·`response_type`을 **없을 때만** 채우므로 이 둘은 이론상 extraParams로 덮일 수 있지만, extraParams는 `auth.service.ts:306`
의 상수 리터럴이지 입력이 아니다. 게이트가 닫히면 `extraParams === undefined`이고 `{ ...undefined }`는 빈 전개라 `params` 객체는
이전과 **동일**하다 — 스펙 `auth.service.spec.ts:1511-1526`이 다섯째 인자 `undefined`를 단언한다. 단 선전개 불변식 자체는 테스트가
없다(N4, M-C 생존).

### 6. `storeGrant` 추출이 `linkAccount`를 바꿨는가

**바꾸지 않았다.** `git show f47d59906:server/src/services/google-drive.service.ts`(`:364-388`)의 try/catch 이후 순서 —
`drainUnstampedUploads` → `getDriveAccountId` → `upsertCredentials` → `clearErrors(Object.values(...))` — 가 `storeGrant`(`:376-402`)에
그대로 있고, `linkAccount`(`:334-365`)의 try/catch와 "refresh token 없으면 던진다"는 손대지 않았다. 주석 이동 외 diff 없음.

### 7. Part 1 N3 — 테스트를 뺀 것이 옳은가

**옳지 않다.** N5. `spyOn` getter 한 줄로 뒤집히고, 실증했다.

## What I did not verify

- **새 경로의 실제 실행.** 이 배포본은 OAuth 로그인이 꺼져 있고 게이트를 열려면 구글 콘솔 변경이 필요하다. 구글의 실제 응답
  (refresh token 유무, `scope` 필드, 세분화 동의 화면)은 문서 인용으로만 확인했다.
- **연결 해제 뒤·Testing 7일 만료 뒤 구글이 refresh token을 다시 주는지.** `disconnect`가 revoke하지 않는다는 것(`:1018-1020`)만
  코드로 확인했고, 그 뒤 구글 동작은 추론이다(N6 둘째 항목).
- svelte-check, web ESLint(이전 리뷰 N5의 환경 크래시 그대로일 것으로 봄), medium 테스트(SQL 변경 없음). `run.sh`는 돌리지 않았고
  `results/20260919-0841.txt`를 읽어 대조만 했다.
- `EventRepository.onEvent`가 핸들러 예외를 emit 호출자까지 전파한다는 것은 `:239-249`의 `await handler(...)`에 try/catch가 없다는
  것으로 판단했다. 스펙 `should still log the user in when connecting Drive throws`는 `mocks.event.emit.mockRejectedValue`로 그
  전제를 대신 세운다.
- 웹 스펙의 `AuthLogout` 테스트가 `eventManager`의 실제 구현을 타는지(`vi.mock` 없음)는 import만 보고 판단했다.

## Feeding back into the plan

`dev-docs/google-drive/`의 플랜(login-grant 절이 있는 문서)에 다음을 남긴다:

1. **게이트 절 목록에 두 개 추가 후보**: `oauth.prompt`에 `consent`가 없을 것(N1 — 구글의 100개 상한 인용과 함께), `oauth.clientSecret
   === googleDrive.clientSecret`(N2 — 프로브 실패가 `null`로 삼켜져 upsert된다는 사실과 함께).
2. **`include_granted_scopes`의 실제 의미**(합집합, 동의 화면과 무관)와 이 게이트 아래에서 무의미하다는 결론. 빼거나 주석을 고친 쪽을
   기록한다.
3. **로그인 그랜트는 "첫 offline 동의 한 번"**이고, `disconnect`는 구글에 revoke하지 않으므로 그 뒤 복구는 수동 Connect다.
4. **모바일 OAuth 로그인도 같은 서버 경로**를 탄다 — 검증만 웹에 한정했다는 것을 분명히.
5. **await 유지의 근거**(설정 화면 `getStatus`와의 경합 제거, 비용은 사용자당 1회)와 남는 위험(클라이언트 타임아웃; 답은 분리가 아니라
   refresh 상한).
6. **`$derived` 클래스 필드는 `vi.spyOn(obj, prop, 'get')`으로 뒤집을 수 있다** — Thumbnail 배지의 공유 링크 가드 테스트에 쓴다.
   같은 이유로 wave9b N3는 종결이 아니라 재개다.
7. 리포트 파일명 스탬프는 작성 시각이어야 한다(이번 `0030`은 증거·커밋보다 앞섰다).

---

**VERDICT: NOT BLOCKED** — must-fix(C) 없음. N1·N2·N3은 게이트를 실제로 여는 배포 전에, N4·N5·N6은 편할 때.
