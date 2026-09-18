# Code Review — wave9b: 사진별 "Drive에 있음" 배지 (`2f83943cb` … `f5b1128bc`)

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review-b` @ `d934ede84` (`feat/google-drive-album-sync-v3.1.0`) |
| Commits reviewed | `2f83943cb` (기능), `07c7b937d` (runner 목록), `f05f8d7ba` (증거 FAIL), `00e87c6cd` (fixture 수정), `f5b1128bc` (증거 PASS), `d934ede84` (리포트) — `git diff 9fa7d564e 00e87c6cd -- server/src web/src dev-test` |
| Report | `../report/google-drive-wave9b-drive-badge-20260916-2325-report.md` |
| Reviewed | 2026-09-16 (모든 수치는 이 워크트리 HEAD에서 직접 돌린 것) |

## Verdict

**배포 판정: 막는다 (BLOCKED) — C1 하나 때문이고, 고치는 데 3줄이다.** 서버 쪽(엔드포인트·DTO·서비스 게이트)과 매니저의
배치·재질의·실패 처리, 썸네일 배지 렌더링은 리포트 주장대로이고, 리포트 변이 5건과 내가 추가한 변이 2건(M7·M8)이
전부 정확한 테스트 하나에 잡혔다. 리포트 수치(서버 8스펙 284 / 웹 8스펙 66 / 전체 2,394+2 / 582+2)도 전부 재현됐다.

가장 중요한 문제는 리포트 §4가 스스로 물은 것이다: **`googleDriveUploadedManager.reset()`은 운영 코드 어디서도 호출되지
않는다.** immich 웹의 로그아웃은 전체 리로드가 아니라 `goto()`(SPA 내비게이션)이고, 이 저장소의 다른 모듈 싱글톤 7개는
전부 `eventManager.on({ AuthLogout: ... })`로 자기를 비우는데 이 매니저만 빠졌다. 같은 탭에서 A가 로그아웃하고 B가
로그인하면, B의 타임라인에 A가 Drive에 올린 공유 자산이 보이는 순간 "내 Drive에 있음" 배지가 거짓으로 뜬다. 주석이
"For logout / tests"라고 적어 둔 의도와 코드가 어긋나 있다.

둘째로 리포트 §2의 전제 하나가 틀렸다 — `request()`는 반응형 `SvelteSet`을 **읽는다**(`#uploaded.has(id)`). 그래서
Timeline의 `$effect`는 flush가 뭔가를 add할 때마다 한 번 더 돈다. 루프는 아니고(재실행이 새로 큐에 넣을 것이 없다) 비용도
작지만, "루프가 될 수 없다"는 근거는 리포트가 적은 것과 다르다.

### Evidence I ran myself

워크트리에 `node_modules`가 없어 `web/node_modules`·`server/node_modules`를 메인 저장소의 것으로 **심볼릭 링크**해 돌렸다
(pnpm 링크가 상대 경로라 실제 위치 기준으로 풀린다; `.gitignore` 대상이라 `porcelain`에 안 잡히고, 종료 전에 지웠다).
메인 저장소는 리뷰 도중 이미 다음 라운드 수정이 진행 중이어서(`git status`에 서버 파일 6개 M) **메인에서는 아무것도
돌리지 않았다** — 모든 수치는 이 워크트리의 HEAD 파일로 얻은 것이다. 변이는 `sed`로 넣고 매번 `git checkout --`으로
되돌렸으며, 세 파일의 md5가 변이 전과 같음을 `md5sum -c`로 확인했다.

| Check | Result |
|---|---|
| server unit — `google-drive.service.spec.ts` 단독 | `101 passed` (리포트 증거 `20260916-2322.txt`의 101과 일치) |
| server unit — 전체 (`--config test/vitest.config.mjs`) | `94 passed / 2394 passed \| 2 skipped (2396)` — **리포트와 일치** |
| web unit — 배지 관련 3스펙 | `3 passed / 15 passed` |
| web unit — 전체 (`npx vitest run`) | `60 passed \| 1 skipped / 582 passed \| 2 skipped (584)` — **리포트와 일치** |
| server `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| server `npx eslint` (바뀐 4파일, `--max-warnings 0`) | exit 0 |
| web `npx eslint` (바뀐 5파일) | **실행 불가** — `tscompat/tscompat` 룰이 `TypeError: Cannot read properties of undefined (reading 'Class')`로 크래시. 업스트림 파일(`upload-manager.svelte.ts`, `timeline-day.svelte.ts`)도 같은 방식으로 죽고 `google-drive-indicator.spec.ts`만 통과 → **이 변경과 무관한 환경 문제** (N5) |
| 첨부 증거 `results/20260916-2322.txt` | `commit: 00e87c6cd`, 284 / 66 / svelte-check 회귀 없음, `RESULT: PASS` — 주장대로 |
| 첨부 증거 `results/20260916-2319.txt` | `commit: 07c7b937d`, `RESULT: FAIL` — 리포트가 말한 대로 실패 증거를 남겨 뒀다 |
| `git diff 9fa7d564e 00e87c6cd --stat` | 12 files, +424/−2 — 서버 4, 웹 6, dev-test 2(+results 1) |
| 생성물 존재 | `open-api/immich-openapi-specs.json`에 `me/uploaded` 1건, `packages/sdk/src/fetch-client.ts:5059` `getMyGoogleDriveUploadedAssets`, `mobile/openapi/lib/model/google_drive_uploaded_lookup_{dto,response_dto}.dart` — 내용은 읽지 않았다 |
| `web/src` 전체에서 `googleDriveUploadedManager` 사용처 | `Timeline.svelte:18,111,690` 뿐 — **`reset()` 호출 0건** (C1) |
| server medium (실 DB) | 돌리지 못했다 (Docker 미기동). 대신 `getUploadedAssetIds`의 medium 커버리지를 눈으로 확인 — 아래 §Not verified |
| svelte-check | 직접 돌리지 않았다. `run.sh`의 baseline 게이트 결과(회귀 없음)에 의존 |
| `git status --porcelain` (종료 시) | **이 리뷰 파일 하나뿐** |

**변이 전수.** 줄 번호는 HEAD 기준.

| # | 변이 | 결과 | 판단 |
|---|---|---|---|
| M1 | `google-drive.service.ts:872-874` 자격증명 게이트 삭제 | `1 failed \| 100` — `should return nothing for a user who is not connected…`, *expected { assetIds: [ 'would-be-a-lie' ] } to deeply equal { assetIds: [] }* | **리포트 그대로.** mock이 `'would-be-a-lie'`를 돌려주도록 해 둔 것이 공허 통과를 막는다 |
| M2 | manager `:42` `now - askedAt < REASK_AFTER_MS` → `true` | `1 failed \| 4` — `re-asks … only after the re-ask window`, *called 2 times, but got 1* | 리포트 그대로 |
| M3 | manager `:72` catch 안의 `#askedAt.delete(id)` 삭제 | `1 failed \| 4` — `forgets a failed lookup…`, 같은 문장 | 리포트 그대로 |
| M4 | `Thumbnail.svelte:352` `&& driveUploaded` 삭제(항상 표시) | `1 failed \| 4` — `shows no badge otherwise`, *expected <div data-icon-google-drive> to be null* | 리포트 그대로 |
| M5 | `:352` → `{#if false}` | `1 failed \| 4` — `shows the badge for an asset already in Drive` | 리포트 그대로 |
| M7 (추가) | manager `:39` `#uploaded.has(id) \|\|` 삭제(아는 것도 재질의) | `1 failed \| 4` — `does not ask again about an asset already known to be uploaded` | 잡힌다 |
| M8 (추가) | manager `:21` `BATCH_SIZE` 1000 → 5000 | `1 failed \| 4` — `splits more than 1000 ids…` | 잡힌다 |
| M9 (추가) | `:352` `!authManager.isSharedLink &&` 삭제 | **`5 passed` — 살아남음** | 공유 링크에서 배지가 안 뜬다는 테스트가 없다. Timeline이 공유 링크에서 `request()` 자체를 안 하므로 실질 위험은 낮다 (N3) |
| M10 (추가) | `:357` `assetOwner ? 'bottom-7' : 'bottom-2'` → `'bottom-2'` | **`5 passed` — 살아남음** | 소유자 이름 위로 올리는 레이아웃은 테스트가 없다. 시각 문제라 nitpick (N3) |

## Findings

### C1 — `reset()`이 로그아웃에 연결돼 있지 않다: 같은 탭의 다음 사용자가 이전 사용자의 배지를 본다 (must-fix)

- `web/src/lib/managers/google-drive-uploaded-manager.svelte.ts:78-85` — `/** For logout / tests. */ reset()`. 호출처는
  `google-drive-uploaded-manager.svelte.spec.ts:17`의 `afterEach`뿐이다 (`grep -rn googleDriveUploadedManager web/src`로 확인).
- `web/src/lib/managers/auth-manager.svelte.ts:92-114` — 로그아웃은 `redirectUri.startsWith('/')`이면 `this.reset(); eventManager.emit('AuthLogout'); await goto(redirectUri)`. **전체 리로드가 아니다.** 로그인도
  `routes/auth/login/+page.svelte:32` `goto(data.continueUrl, { invalidateAll: true })` — SPA다. 모듈 싱글톤 `#uploaded`는 탭이
  살아 있는 한 그대로다.
- 이 저장소의 다른 싱글톤은 전부 이 이벤트를 받는다: `upload-manager.svelte.ts:12 AuthLogout: () => this.reset()`,
  `memory-manager.svelte.ts:27`, `plugin-manager.svelte.ts:25`, `stores/user.svelte.ts:38`, `folders.svelte.ts:23`,
  `notification-manager.svelte.ts:13`, `search.svelte.ts:9`. 이 매니저만 빠졌다.
- 재현 시나리오: A가 앨범을 공유해 B도 볼 수 있는 자산 X를 A가 Drive에 올렸다. A가 웹에서 X를 보고(캐시됨) 로그아웃, 같은 탭에서
  B가 로그인해 그 앨범을 연다. `Timeline.svelte:690`이 `has(X)`로 `true`를 읽어 B에게 "내 Drive에 있음" 배지를 보여 준다 —
  B는 Drive를 연결한 적도 없다. 서버 게이트(`google-drive.service.ts:871-874`)는 B의 새 조회에 `[]`를 주지만, 캐시 `#uploaded`는
  `add`만 있고 새 조회 결과로 **빼지 않으므로** 서버가 바로잡을 길이 없다.
- 영향은 작다(공유 자산 + 같은 브라우저 탭 + 배지는 장식). 그래도 "다른 사용자가 무엇을 백업했는가"가 새는 것이고, 저장소
  관례와 주석의 의도 모두를 어기고 있어 C로 둔다.

**Fix.** `upload-manager.svelte.ts:8-13` 그대로:
```ts
import { eventManager } from '$lib/managers/event-manager.svelte';
class GoogleDriveUploadedManager {
  constructor() {
    eventManager.on({ AuthLogout: () => this.reset() });
  }
```
테스트는 `eventManager.emit('AuthLogout')` 뒤 `has('a')`가 `false`가 되는지 — 그리고 emit 전에는 `true`였다는 목격자를 같이.
스펙의 `afterEach`가 `manager.reset()`을 직접 부르는 것은 그대로 둬도 된다.

### N1 — 리포트 §2의 "`request()`는 비반응형 Map/Set만 만진다"는 틀렸다; effect는 flush마다 한 번 더 돈다 (nice-to-have, 문서/주석)

- `google-drive-uploaded-manager.svelte.ts:39` `this.#uploaded.has(id)` — `#uploaded`는 `SvelteSet`(`:26`)이다. Timeline의
  `$effect`(`Timeline.svelte:97-112`)가 `request(ids)`를 부르므로 이 읽기는 **effect 안의 반응형 읽기**다.
- Svelte 5.56.5 `svelte/src/reactivity/set.js:119-142`: `has(value)`는 값이 **없으면** 키별 source를 만들지 않고 `get(this.#version)`
  으로 집합 전체 버전을 구독한다(`:124-129`). `add()`는 `increment(this.#version)`(`:150`). 즉 flush가 뭔가 add하면 effect가
  다시 돌고, `request()`가 다시 모든 id를 훑는다.
- 루프는 아니다: 재실행에서 `#uploaded`에 있는 id는 `:39`에서, 방금 "없음"으로 돌아온 id는 `#askedAt` 60초 창(`:42`)에서
  걸러져 큐가 비고 타이머가 안 걸린다. 실패한 배치의 id만 `:72`로 잊혀 재큐잉되는데, 그 재시도가 또 실패하면 add가 없어
  effect가 다시 돌지 않는다 — 유한하다.
- 비용: 재실행 1회당 near-viewport 월의 자산 수만큼 `Set.has` — 수백~수천 번의 마이크로초 작업. 허용 범위.

**Fix.** 코드는 그대로 두고 매니저 주석과 리포트/계획 문서의 근거를 고친다: "루프가 없는 이유는 request()가 반응형 상태를 안
읽어서가 아니라, 재실행이 새로 큐에 넣을 것이 없어서다." 굳이 재실행 자체를 없애려면 `request()` 안의 `has`를 `untrack()`으로
감싸면 되지만, 그러면 Timeline effect가 `#uploaded`를 구독하지 않게 되어 지금 동작과 차이가 없다(배지는 `:690`의 `has()`가
따로 구독한다). 선택 사항.

### N2 — 연결 해제 뒤에도 이 세션의 배지가 남는다 (nice-to-have)

- `routes/(user)/user-settings/GoogleDriveSettings.svelte:241-249` `handleDisconnect`는 `disconnectGoogleDrive()` 뒤 로컬 상태만
  바꾼다 — SPA라 `#uploaded`는 그대로다. 서버는 이후 조회에 `[]`를 주지만(`google-drive.service.ts:871-874`) 캐시에서 빼는
  경로가 없다.
- **재연결은 문제없다** — `:153-160` `connectGoogleDrive`가 `location.assign(url)`로 구글로 나갔다 돌아오므로 전체 리로드가
  일어나 모듈 상태가 자연히 비워진다. 리포트 §5의 "다른 계정으로 재연결" 걱정은 이 경로 덕분에 실제로는 생기지 않는다.

**Fix.** `handleDisconnect` 성공 분기에 `googleDriveUploadedManager.reset()` 한 줄. C1의 `AuthLogout` 구독과는 별개다.

### N3 — 테스트 공백 둘: 공유 링크 가드(M9)와 소유자 이름 위 배치(M10) (nitpick)

- `Thumbnail.svelte:352`의 `!authManager.isSharedLink &&`는 방어선일 뿐이다 — `Timeline.svelte:98`이 공유 링크에서 `request()`를
  막고, 공유 링크 페이지는 `has()`가 항상 `false`인 빈 집합을 본다. 그래도 같은 파일의 `asset.isFavorite`(`:344`), 보관함(`:372`)
  가드와 같은 급의 방어선이니, `authManager.isSharedLink`를 `true`로 만든 케이스 하나(`page.route.id`를 공유 링크 경로로 mock)가
  있으면 M9가 죽는다.
- `:357`의 `bottom-7`은 시각 배치라 DOM 단언이 어색하다. 클래스 문자열 단언 하나면 되지만 가치가 낮다 — 브라우저에서 한 번
  보는 것이 낫다(리포트 §Not verified가 이미 인정).

### N4 — 배지가 붙는 곳은 `Timeline`뿐이다 (범위 확인, nitpick)

`<Thumbnail`을 쓰는 곳은 `Timeline.svelte`, `GalleryViewer.svelte`, `AssetViewer.svelte`, `LargeAssetData.svelte` 네 곳이고
`driveUploaded`를 넘기는 것은 Timeline뿐이다. `GalleryViewer`는 검색·폴더·추억·개인 공유 뷰가 쓴다. 검색 결과에서 배지가 안 보이는
것은 설계 선택으로 읽히지만(리포트 §Design "rendered assets only"), 문서에 "검색/폴더/추억에는 배지 없음"을 한 줄 적어 두는
것이 다음 라운드의 "버그인가?"를 막는다.

### N5 — web ESLint가 이 환경에서 크래시한다 (환경, 이 변경과 무관)

`npx eslint <file> --max-warnings 0`이 `tscompat/tscompat` 룰에서 `TypeError: Cannot read properties of undefined (reading
'Class')`로 죽는다(ESLint 10.7.0, `@koddsson/eslint-plugin-tscompat@0.2.0`, typescript 6.0.2 조합). 업스트림
`upload-manager.svelte.ts`·`timeline-day.svelte.ts`도 같은 자리에서 죽고, `google-drive-indicator.spec.ts`만 통과한다.
`web/mise.toml:45-52`의 `ci-unit`은 lint를 포함하지 않으므로(`:54-58` `checklist`만 포함) 리포트의 "582 passed"와는 모순이 없다.
다만 `CLAUDE.md` §3의 `cd ../web && npx eslint <바꾼파일>` 관문이 지금 실행 불가라는 것은 알고 있어야 한다. 이번 라운드 책임은 아니다.

## Answers to what the report asked me to attack

### 1. 권한 — 다른 사용자의 자산에 대해 뭔가 알 수 있는가?

**없다.** `google-drive.controller.ts:280-285`가 `auth.user.id`를 넘기고, `google-drive.service.ts:875`가 그대로
`getUploadedAssetIds(userId, assetIds)`에 넘기며, `google-drive.repository.ts:621-627`이 `.where('userId', '=', userId)
.where('assetId', 'in', assetIds).where(ledgerMatches(userId))`다. 응답은 **호출자 자신의 원장 행**의 부분집합이지 자산 테이블
조회가 아니다 — 남의 자산 id를 넣어도 그 id가 내 원장에 없으면 빠질 뿐이고, 있다면 그것은 내가 올린 것이다. 입력은
`z.array(z.uuidv4()).max(1000)`(`google-drive.dto.ts:158-162`)을 전역 `ZodValidationPipe`(`app.module.ts:47`)가 검증하고, 바인딩은
Kysely다. API 키는 `@Authenticated()`에 permission이 없어 `Permission.All`이 필요한데(`auth.service.ts:224`), 이 컨트롤러의 다른
14개 엔드포인트와 같은 수준이다.

`requireAccess(AssetRead)`는 **넣지 않는 쪽에 동의한다.** 원장 행은 업로드 시점에 앨범 접근 검사를 통과해 생긴 것이라, 지금
접근이 끊긴 자산이 응답에 남을 수는 있지만 그 사실("내가 예전에 올렸다")은 호출자 자신의 것이다. 스크롤마다 1000개 접근 검사를
얹을 값어치가 없다.

### 2. `$effect` 재실행 빈도·비용·루프

의존성은 `timelineManager.months`(`timeline-manager.svelte.ts:71` `$state([])`), 월마다 `#viewportProximity`
(`timeline-month.svelte.ts:32` `$state`), `isLoaded`(`:33`), `timelineDays`(`:34`), 일마다 `viewerAssets`
(`timeline-day.svelte.ts:34` `$state([])`), `ViewerAsset.asset`(`viewer-asset.svelte.ts:6` `$state()`)의 `id` — 그리고 **N1의
`#uploaded` 버전**이다. 스크롤로 월의 근접도가 바뀔 때, 월이 로드될 때, 자산이 추가·삭제될 때, flush가 add할 때 돈다.
`isFavorite` 토글 같은 필드 변경은 `id`만 읽으므로 안 돈다. 한 번의 비용은 near-viewport 월 자산 수 × (`concat` 복사 +
`Set.has` 2~3회) — 수천 건이어도 밀리초 단위. **루프 없음, 단 근거는 N1처럼 고쳐 적어야 한다.**

### 3. 썸네일의 `has()` — add 하나가 무엇을 다시 그리는가

`set.js:124-129`: 값이 **없는** id의 `has()`는 `#version`을 구독하고, **있는** id는 키별 source를 구독한다. 그래서 add 한 번에
(a) 아직 배지가 없는 모든 렌더된 썸네일의 `driveUploaded={has(asset.id)}` 식이 재평가되고(값은 그대로 `false`라 DOM은 안 바뀐다),
(b) 이미 배지가 있는 썸네일은 건드리지 않는다. flush는 `for … add`(`:65`)로 N번 add하지만 effect 스케줄링이 마이크로태스크로
합쳐져 재평가는 flush당 한 번이다. 답: "전부"도 "바뀐 것만"도 아니고 **"아직 없는 것 전부의 조건식만"**이며, 비용은 무시할 만하다.

### 4. 로그아웃 / 사용자 교체

**리포트의 걱정이 맞다 — C1.** 전체 리로드는 보장되지 않는다(`auth-manager.svelte.ts:104-110` `goto`). 외부 `redirectUri`
(OAuth 로그아웃)일 때만 `location.assign`(`:112`)이다.

### 5. 다른 계정으로 재연결한 뒤의 의미

**허용 가능하고, 실제로는 문제가 안 생긴다.** 연결 흐름이 `location.assign`(`GoogleDriveSettings.svelte:156`)으로 페이지를 떠나
돌아오므로 모듈 상태가 비워진다. 남는 것은 **연결 해제**(N2)뿐이다.

### 6. 공유 컴포넌트 `Thumbnail.svelte` — 기존 오버레이 회귀

배지는 `:352-362`, 기존 오버레이는 즐겨찾기 `inset-s-2 bottom-2`(`:345`), 보관함 `inset-s-2 bottom-2/10`(`:373`), 소유자 이름
`inset-e-2 bottom-1`(`:365`), 360°·길이 `inset-e-0 top-0`(`:379,387`), 스택 `top-0/top-7`(`:399`). 왼쪽 아래·오른쪽 위와는 겹치지
않고, 오른쪽 아래의 소유자 이름은 `bottom-7`로 피한다. **한 곳 겹친다:** 미리보기 버튼 `inset-e-1 bottom-1`(`:464`) — 선택
모드에서 hover 때만 나타나고(`Timeline.svelte:707`), DOM 순서상 버튼이 위라 클릭은 멀쩡하고 배지만 잠깐 가려진다. 소유자 이름도
같은 자리에서 같은 식으로 가려지던 업스트림 동작이라 회귀는 아니다. 렌더 조건이 `driveUploaded`가 `true`일 때뿐이라 기본값
`false`(`:74`)인 다른 세 호출처(N4)는 바뀐 것이 없다.

## What I did not verify

- **medium 스위트를 돌리지 못했다** (Docker 미기동). 리포트가 물은 "`getUploadedAssetIds`에 medium 커버리지가 있는가"는 눈으로만
  확인했다: `server/test/medium/specs/repositories/google-drive.repository.spec.ts:414`가 계정 전환 뒤 `getUploadedAssetIds`가 빈
  집합을 주는지 단언한다(`:396-415`, 그 전에 `hasUpload`로 행이 보였다는 목격자 포함). 이 변경은 SQL을 건드리지 않으므로 충분하다.
- **svelte-check**를 직접 돌리지 않았다. `run.sh`의 baseline 게이트 결과와 `f05f8d7ba`(FAIL) → `00e87c6cd`(수정) 흐름이 그 게이트가
  실제로 작동함을 보여 주는 것으로 갈음했다.
- **브라우저에서 보지 않았다.** `bottom-7` 배치, 미리보기 버튼과의 겹침, 배지가 "한 박자 늦게" 뜨는 체감은 확인하지 못했다.
- Timeline `$effect`의 재실행 횟수는 코드로 추론했지 계측하지 않았다 (컴포넌트 테스트가 없다 — 리포트도 인정).
- 생성물(OpenAPI/SDK/Dart)은 존재만 확인하고 내용은 읽지 않았다.
- web ESLint(N5)는 환경 문제라 판단했지만, 다른 머신에서 재현되는지는 모른다.

## Feeding back into the plan

- **웹 모듈 싱글톤 체크리스트에 "`AuthLogout` 구독"을 넣는다.** `reset()`을 만들었다고 끝이 아니다 — 이 저장소의 로그아웃은
  SPA 내비게이션이다. (C1)
- 매니저 설계 노트에 반응성 사실을 적어 둔다: `SvelteSet.has()`는 없는 키에 대해 집합 버전을 구독하므로, `request()`를 effect
  안에서 부르는 한 flush마다 effect가 한 번 더 돈다. 루프가 없는 이유는 "재실행이 큐에 넣을 것이 없다"이다. (N1)
- 연결 해제 경로는 SPA이고 연결 경로는 전체 리로드다 — 클라이언트 캐시를 가진 기능은 앞으로도 이 비대칭을 기억해야 한다. (N2)
- "배지는 Timeline(사진·앨범)에서만 뜬다. 검색·폴더·추억(`GalleryViewer`)에는 없다"를 기능 문서에 한 줄. (N4)
- `CLAUDE.md` §3의 web ESLint 관문이 현재 환경에서 크래시한다는 것을 지뢰 표에 올릴지 결정한다. (N5)

---

**Verdict: BLOCKED** — C1(`AuthLogout` 구독 누락) 반영 후 재리뷰. 나머지는 N.

`git status --porcelain` (심볼릭 링크 제거 후): 이 리뷰 파일 하나만 `??`로 잡힌다.
