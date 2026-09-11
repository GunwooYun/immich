# Code Review — 설정 화면 카드 분리(`603d11e28`) · 눈먼 테스트 4건(`4a694ac89`) · CI 포트(`9db4880b9`)

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `258adebc1` |
| Commits reviewed | `4a694ac89`, `53a5051c9`, `9db4880b9`, `603d11e28`, `18a113da0`, `258adebc1` (`git log --oneline 2a3c2a9e5..258adebc1` = 6, 그중 `258adebc1`은 리포트 자신, `53a5051c9`·`18a113da0`은 증거 파일 1개씩만 추가) |
| Report | `../report/google-drive-wave7-settings-cards-20260908-2215-report.md` |
| Prior review | `./google-drive-wave7-folder-guard-20260908-0915-review.md` (C1·N1~N4를 제기한 라운드) |
| Reviewed | 2026-09-11 (세션 재시작으로 이어서 작성. 모든 수치는 이 HEAD에서 직접 돌린 것) |

## Verdict

**배포 판정: 막지 않는다 (NOT BLOCKED).** 업로드 대상이 틀어지거나 데이터가 위험해지는 경로는 찾지
못했다. 리포트가 가장 공격해 달라고 한 `handleUseRoot`는 **서버까지 끝까지 옳다** — `''`는
`google-drive.service.ts:594`의 `folderId || null`에서 **NULL로 저장**되고(빈 문자열이 폴더 id로
남지 않는다), `:603`에서 `FolderMissing` 차단까지 풀며, 업로드는 `:1133`의
`parents: folderId ? [folderId] : []`로 루트에 들어간다. 피커 경로에 저장할 것이 남아 있지 않다는
것도, ID를 이름이 없을 때만 보이는 것이 다른 실패를 가리지 않는다는 것도 확인했다.
`4a694ac89`의 변이 4개는 이 HEAD에서 **각각 정확히 테스트 하나씩** 죽이고, 웹 스펙 6개도 전부
공허하지 않다(변이마다 해당 테스트가 죽는다).

**이번 라운드에서 가장 중요한 문제는, 이번에 새로 만든 동작 두 개가 전혀 테스트되지 않는다는
것이다(N1).** "내 드라이브 최상위 사용" 버튼(`GoogleDriveSettings.svelte:364-370`)을 **통째로 지워도**
웹 스펙 6/6이 통과하고, 피커 버튼을 지워도(`:350`) 6/6 통과한다. 피커가 있는 배포에서는 이 둘이
폴더를 바꾸는 **유일한** 수단이고, `folder_missing` 배너가 "새 폴더를 고르세요"라며 가리키는 것도
이 버튼이다. 그리고 그 버튼을 누른 뒤에도 **배너가 사라지지 않는다**(N2 — 서버는 차단을 풀었는데
화면은 상태를 다시 읽지 않는다). 둘 다 배포 후 바로 고치면 되는 크기다.

리포트 §3의 "`4a694ac89`는 코드 동작을 하나도 바꾸지 않았다"는 **틀렸다**(N3). 런타임 변경이 두 개
있다(쿨다운 키의 범위, 기록되는 `detail` 문자열). 둘 다 해롭지 않고 테스트로 붙들려 있지만, 이
문장 때문에 그 변경들이 리뷰 대상에서 빠질 뻔했다.

### Evidence I ran myself

전부 이 워크트리 HEAD(`258adebc1`)에서 돌렸다. 변이는 원본을 스크래치패드에 복사해 두고 **줄 번호로**
`sed` 치환한 뒤 매 실행 후 복원했다(재시작 후 컴포넌트 md5 `049bcb44…`가 원본과 같음을 확인).
`web/node_modules`가 없어서 `pnpm --filter immich-web install --frozen-lockfile --offline`로
설치했다(gitignore 대상이라 `git status`에 나타나지 않는다).

| Check | Result |
|---|---|
| server unit — `run.sh`의 8스펙 | `Test Files 8 passed / Tests 276 passed (276)` — **리포트 276과 일치** |
| server unit — 전체 스위트 (`--config test/vitest.config.mjs`) | `Test Files 94 passed / Tests 2386 passed \| 2 skipped (2388)` — 직전 라운드 2384 대비 **+2**(새 backoff 테스트 2개), 회귀 0 |
| `google-drive.service.spec.ts` + `utils/google-drive.spec.ts` | `Tests 111 passed (111)` (95 + 16) |
| web unit — `run.sh`의 5스펙 | `Test Files 5 passed / Tests 45 passed (45)` — **리포트 45와 일치** |
| web — `GoogleDriveSettings.spec.ts` 단독 | `Tests 6 passed (6)` |
| `svelte-check --no-tsconfig --fail-on-warnings --compiler-warnings 'state_referenced_locally:ignore'` (web 전체) | `svelte-check found 0 errors and 0 warnings`, exit 0 |
| web prettier (컴포넌트·스펙, `web/` cwd) | `All matched files use Prettier code style!` |
| `i18n/en.json` 대소문자 무시 정렬 | 1722 키, 순서 위반 없음 |
| server `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| server `npx eslint`(service·spec·utils) `--max-warnings 0` | exit 0 |
| web `npx eslint` | **돌리지 못했다** — `tscompat/tscompat` 룰이 `TypeError: Cannot read properties of undefined (reading 'Class')`로 크래시. 이번 라운드에서 **안 바뀐** `src/lib/utils/handle-error.ts`, `GoogleDriveAlbumMenu.spec.ts`에서도 똑같이 크래시하므로 내 오프라인 설치 환경 문제로 본다. 리포트의 `//web:ci-unit exit 0`은 검증하지 못했다 |
| server medium (실 DB) | **돌리지 못했다** — 이 WSL 배포판에 `docker`가 없다. 단 `git diff --name-only 2a3c2a9e5..258adebc1`에 repository·schema·migration 변경이 **0**이라 medium 60의 대상 코드는 이 범위에서 바뀌지 않았다 |
| 첨부 증거 `results/20260908-2209.txt` | `commit: 603d11e28`, **`+ UNCOMMITTED CHANGES` 마커 없음**, 276 / 45 / svelte-check 회귀 없음 / 60, `RESULT: PASS` — 주장대로 |
| `git merge-base --is-ancestor v3.1.0 HEAD` | ancestor 맞음 |
| CI 실행 결과 | **확인하지 못했다** — 이 환경에 `gh`가 없다 |
| `git status --porcelain` (종료 시) | **이 리뷰 파일 하나뿐** |

**웹 변이 전수** (`GoogleDriveSettings.spec.ts`, 무변이 = `6 passed`). R은 리포트가 주장한 3종, M은 내가 추가한 것.

| # | 변이 (`GoogleDriveSettings.svelte`:줄) | 방향 | 결과 | 죽은 테스트 |
|---|---|---|---|---|
| R1 | `:339` `{#if !folderName}` → `{#if true}` | ID 항상 표시 | `1 failed \| 5 passed` | `should show the folder name and not its id` ✔ |
| R2 | `:363` `{#if pickerAvailable}` → `{#if false}` | 피커가 있어도 ID 필드 그림 | **`2 failed \| 4 passed`** | `should not offer an editable folder id…` ✔ + `should say uploads go to the root…` (`Found multiple elements with the text: /root of My Drive/`) — **리포트의 "해당 테스트만"과 다름, §N5** |
| R3 | `:331` href → `https://drive.google.com/drive/my-drive` | 링크를 루트로 | `1 failed \| 5 passed` | `should link the folder to Google Drive` ✔ |
| M2 | `:339` → `{#if false}` | ID 절대 표시 안 함 | `1 failed \| 5 passed` | `should fall back to the id only when the name could not be read` |
| M5 | `:347` `google_drive_folder_none` → `google_drive_folder_selected` | 루트 문장 제거 | `1 failed \| 5 passed` | `should say uploads go to the root when no folder is set` |
| M6 | `:363` → `{#if true}` | 피커 없는 배포에서도 필드 제거 | `1 failed \| 5 passed` | `should keep the folder id field where the picker cannot open` |
| M7 | `:364-370` 삭제 | **"Use My Drive root" 버튼 통째로 제거** | **`6 passed`** | 없음 — **§N1** |
| M8 | `:350` `{#if pickerAvailable}` → `{#if false}` | **피커(Change/Choose) 버튼 제거** | **`6 passed`** | 없음 — **§N1** |
| M9 | `:383-385` 삭제 | 피커 없는 경로의 Save 버튼 제거 | `6 passed` | 없음 — §N1(하위) |

**서버 변이 — `4a694ac89`가 주장한 4종** (service spec + utils spec, 무변이 = `111 passed`)

| # | 변이 (파일:줄) | 방향 | 결과 | 죽은 테스트 |
|---|---|---|---|---|
| S1 | `google-drive.service.ts:1339` `if (!fresh \|\| …)` → `if (fresh && fresh.originalPath === asset.originalPath)` | `!fresh` 가드 제거 (직전 리뷰 M-A와 같은 변이) | `1 failed \| 110 passed` | `should not retry when the asset disappeared during the window` — **직전 C1이 이제 진짜로 고쳐졌다** |
| S2 | 〃 `:743` `3_600_000` → `3_600_000_000` | 1시간 → 사실상 영구 포기 | `1 failed \| 110 passed` | `should try again once the hour is up` — 직전 N3 해소 |
| S3 | 〃 `:670`, `:675` 키 `folder:${userId}:${credentials.folderId}` → `folder:${userId}` | 쿨다운을 사용자 단위로 되돌림 | `1 failed \| 110 passed` | `should not make a corrected folder id wait out the wrong one` |
| S4 | `utils/google-drive.ts:40` ` (moved from ${startedFrom})` 삭제 | detail을 한 경로로 축소 | `1 failed \| 110 passed` | `should report the path it actually failed on, not the stale one` |

**직접 짠 탐침 테스트 3개** (`web/src/routes/(user)/user-settings/zz-review-probe.spec.ts`에 임시로
두고 실행 후 삭제 — 삭제를 확인했다). 결과 `Tests 3 passed (3)`. 즉 아래 세 문장은 **현재 동작으로 참이다**:

- A. 피커 없는 배포, 저장된 폴더 `ToPixel`(`folder-abc123`)에서 입력칸에 `folder-TYPO`를 **치기만**
  하면: 링크 `href`는 `…/folders/folder-TYPO`, 링크 글자는 여전히 `ToPixel`, `setGoogleDriveFolder`
  호출 0회.
- B. 같은 상황에서 입력칸을 **비우기만** 하면: 링크 0개, `Uploading to the root of My Drive.` 표시,
  저장 호출 0회.
- C. 피커 배포 + `blockedReason: 'folder_missing'`에서 "Use My Drive root" 클릭 →
  `setGoogleDriveFolder`가 `{ googleDriveSetFolderDto: { folderId: '' } }`로 호출되고 카드가 루트
  문장으로 바뀐다. **그러나 `…destination folder no longer exists…` 배너는 화면에 남아 있다.**

---

## Findings

배포를 막는 것은 없다. N1·N2는 배포 직후 다음 커밋에서, 나머지는 여유 있을 때.

### N1 (Medium — 테스트 공백) — 이번에 새로 만든 루트 복귀 버튼과 피커 버튼이 아무 테스트에도 붙들려 있지 않다

**증거.** 변이 M7(`GoogleDriveSettings.svelte:364-370` 삭제 — `handleUseRoot`를 부르는 유일한 버튼)과
M8(`:350` → `{#if false}` — 피커 버튼 제거) 모두 `Tests 6 passed (6)`. M9(`:383-385` Save 버튼 삭제)도
6/6.

리포트 §1이 이 버튼을 "**필드를 감추면서 새로 만든** 루트 복귀 수단"이라 부르고 공격을 요청했는데,
정작 스펙 6개는 **읽기 전용 표시**(이름·링크·ID·루트 문장·필드 유무)만 본다. 버튼 두 개는 피커가
있는 배포(= 운영, 아래 "검증하지 못한 것" 참고)에서 폴더를 바꾸는 **유일한** 두 수단이고, 둘 중 하나가
조용히 사라지면 `folder_missing` 배너(`en.json:1219` "Choose a new folder to continue")가 가리키는
행동을 할 방법이 없어진다 — 이 기능이 계속 없애려 해 온 **조용한 멈춤** 그대로다.

**구체적 수정.** 탐침 C가 곧 테스트다(이 HEAD에서 통과함을 확인). 스펙에 `setGoogleDriveFolder`를
호이스티드 mock으로 빼고 셋을 추가한다:

```ts
it('should put uploads back in the root when asked', async () => {
  status.mockResolvedValue(connected());
  setFolder.mockResolvedValue(undefined);
  render(GoogleDriveSettings);

  await fireEvent.click(await screen.findByRole('button', { name: 'Use My Drive root' }));

  expect(setFolder).toHaveBeenCalledWith({ googleDriveSetFolderDto: { folderId: '' } });
  expect(await screen.findByText('Uploading to the root of My Drive.')).toBeInTheDocument();
});

it('should not offer the root button when already at the root', async () => {
  status.mockResolvedValue(connected({ folderId: '', folderName: null }));
  render(GoogleDriveSettings);
  await screen.findByText('Uploading to the root of My Drive.');
  // presence proved by the test above, so this absence cannot be vacuous
  expect(screen.queryByRole('button', { name: 'Use My Drive root' })).not.toBeInTheDocument();
});

it('should offer the picker where it works', async () => {
  status.mockResolvedValue(connected());
  render(GoogleDriveSettings);
  expect(await screen.findByRole('button', { name: 'Change' })).toBeInTheDocument();
});
```

그러면 M7은 첫 번째, M8은 세 번째가 죽는다(M9는 피커 없는 경로의 Save 클릭 테스트를 하나 더 두면 잡힌다).

### N2 (Low-Medium — UX) — "새 폴더를 고르세요" 배너가, 고른 뒤에도 남는다

**증거.** 탐침 C. 서버는 `setFolderId`에서 폴더를 바꾸든 루트로 돌리든 `FolderMissing`을 지운다
(`google-drive.service.ts:603`). 하지만 `handleUseRoot`(`GoogleDriveSettings.svelte:213-222`)와
`handlePickFolder`(`:172-194`, 이건 이번 라운드 이전부터)는 `folderId`/`folderName`만 바꾸고
`blockedReason`은 그대로 둔다. 배너 조건은 `:287` `blockedReason === 'folder_missing'`이므로 새로고침
전까지 "업로드가 실패하고 있다, 새 폴더를 고르라"는 경고가 **방금 고른 폴더 옆에** 떠 있다. 사용자는
고친 것이 안 먹혔다고 읽는다.

**수정.** `handleResume`(`:233`)이 이미 쓰는 관례대로, 성공 뒤 `await loadStatus()`를 부른다
(`handlePickFolder`·`handleUseRoot` 둘 다). 왕복을 아끼려면
`if (blockedReason === 'folder_missing') blockedReason = null;` 한 줄로도 된다 — 서버가 같은 요청 안에서
지운 것이 확실하므로. 테스트는 탐침 C의 마지막 단언을 `.not.toBeInTheDocument()`로 뒤집으면 된다.

### N3 (Low — 리포트 정확성) — `4a694ac89`는 런타임 동작을 바꿨다

**증거.** 리포트 §3 "코드 동작은 하나도 안 바뀌었고", 커밋 메시지 "None of these change what the code
does". 실제 diff에는 런타임 변경이 둘 있다:

1. 폴더 이름 조회 쿨다운 키가 `folder:${userId}` → `folder:${userId}:${credentials.folderId}`
   (`google-drive.service.ts:670`, `:675`). 백오프의 **범위가 바뀌었다** — 커밋 메시지 본문도 스스로
   "Keyed on the folder, a new id gets a fresh key by construction"이라고 동작 변경을 설명한다.
2. 기록되는 `detail`과 로그 문구가 바뀌었다 — `describePaths`(`utils/google-drive.ts:37-41`)가
   경로가 다를 때 `… (moved from …)`를 붙이고, `google-drive.service.ts:1112-1115`가 그 문자열을
   로그와 `upsertError`에 쓴다.

둘 다 옳은 방향이고 각각 S3·S4로 붙들려 있다. 문제는 문장이다: "동작 변경 없음"은 리뷰어에게 "테스트만
보면 된다"는 신호이고, 실제로 이번 리포트 §3은 이 두 변경을 공격 목록에 올리지 않았다.
(부수 관찰: 키가 폴더 단위가 되면서 `accountProbeAt` 맵의 키 수가 "사용자 수"에서 "사용자 × 붙여 넣은 id
수"로 상한이 바뀐다. 1인 운영에서는 무의미하지만, 맵이 정리되는지는 확인하지 않았다.)

**수정.** 계획 문서의 이 항목 기록을 "테스트 4건 + 런타임 변경 2건(쿨다운 키, detail 형식)"으로 고친다.
코드 변경은 필요 없다.

### N4 (Low — 피커 없는 배포 한정) — 입력칸이 저장 전의 값을 "현재 위치"로 보여 준다

**증거.** 탐침 A·B. 입력칸이 `bind:value={folderId}`(`:381`)로 **카드가 표시하는 바로 그 상태**에
묶여 있어, 입력하는 순간 링크(`:325-338`)가 저장되지 않은 id를 가리키면서 글자는 **옛 폴더 이름**을
유지한다(A). 비우면 저장 전인데 "Uploading to the root of My Drive."라고 단언한다(B). 옛 코드에서도
"Uploading to: {folderName}"이 입력과 함께 흔들렸으므로 뿌리는 이번 라운드 이전이지만, **링크**가
생기면서 "이름 X를 누르면 폴더 Y가 열리는" 조합이 새로 생겼다.

**영향.** 피커가 없는 배포에서만 보인다. 운영은 API 키가 있어 피커 경로이므로(가정 — 아래 참고)
배포를 막을 이유가 아니다.

**수정.** 초안을 분리한다: `let folderIdDraft = $state('')`, `loadStatus`에서 함께 채우고, 입력칸은
`bind:value={folderIdDraft}`, `handleSaveFolder` 성공 시에만 `folderId = folderIdDraft`.

### N5 (Nit — 테스트 정밀도) — "root" 테스트의 정규식이 두 문자열에 걸린다

**증거.** `should say uploads go to the root…`의 `findByText(/root of My Drive/)`는
`google_drive_folder_none`(`en.json:1200`)과 `google_drive_folder_id_description`(`en.json:1199`,
"…Leave blank to use the root of My Drive.") **둘 다**에 맞는다. 그래서 R2(피커가 있어도 필드를
그림)에서 이 테스트가 `Found multiple elements`로 **곁다리로** 죽었다 — 리포트의 "변이 3종 각각 해당
테스트만 죽인다"는 이 한 건에서 틀린다. 공허한 것은 아니다(M5가 이 테스트를 정확한 이유로 죽인다).
하지만 실패 메시지가 원인을 가리키지 않는다.

**수정.** `findByText('Uploading to the root of My Drive.')`처럼 정확한 문자열로.

### N6 (Nit — CI) — 주석 하나가 낡았고, 주소 표기가 한 군데 어긋난다

1. `.github/workflows/fork-google-drive.yml:277-279`의 주석이 아직 "the next step, which connects to
   **localhost:5432**"라고 한다. 이제 포트는 도커가 고른다.
2. 게시는 `-p 127.0.0.1::5432`(`:261`)로 IPv4 루프백에만 하는데 `DB_URL`은 `localhost`(`:274`)를
   쓴다. 표준 러너 이미지에서는 문제없을 가능성이 크지만(확인하지 못했다) 해석기에 기대지 않도록
   `@127.0.0.1:$port`로 쓰는 편이 비용 없이 확실하다.
3. `port`(`:272`)가 비어도 검사 없이 `DB_URL=…@localhost:/immich`가 쓰인다. 게다가 준비 확인
   루프(`:280-288`)는 컨테이너 **안에서** `docker exec … pg_isready -h 127.0.0.1`을 하므로 호스트 매핑을
   전혀 보지 않는다. 컨테이너가 살아 있는데 매핑만 비는 경우는 사실상 없지만, 한 줄로 막을 수 있다:
   `[ -n "$port" ] || { echo "::error::no host port for 5432"; docker ps -a; exit 1; }`.

### N7 (Nit — 문서 드리프트) — 이번 변경이 틀리게 만든 문장들

- `i18n/en.json:1197` `google_drive_folder_current`는 이제 소비자가 없다(`web/src`·`mobile` grep 0건).
  `.github/workflows`에 미사용 키 검사도 없어 CI가 잡아 주지 않는다. 지운다.
- `GoogleDriveSettings.svelte:42-43` "Bound to the folder input" — 피커 경로에는 입력칸이 없다.
- `GoogleDriveSettings.svelte:196-198` "…or when someone would simply rather paste the id" — 피커가 있는
  배포에서는 이제 붙여 넣기 경로가 **존재하지 않는다**.
- `server/src/controllers/google-drive.controller.ts:190-192` "(currently very basic) folder-ID text
  input that calls this" — 이제 주 호출자는 피커와 루트 버튼이다.

### N8 (Nit — 설계 메모, 수정 불요) — 루트 버튼은 확인 없이 한 번에 동작한다

"Change" 바로 아래의 secondary 버튼 한 번으로 **앞으로의** 업로드가 루트로 간다. 이미 올라간 파일은
움직이지 않고 피커로 즉시 되돌릴 수 있으므로 되돌릴 수 없는 손실은 없다. 1인 운영에서는 지금대로 두는
것이 맞다고 본다 — 기록만 남긴다.

---

## Answers to what the report asked me to attack

### 1. `setGoogleDriveFolder({ folderId: '' })`는 서버에서 정말 "내 드라이브 루트"인가

**그렇다. 검증 거부도, 빈 문자열 저장도 아니다.** 전 경로:

| 단계 | 위치 | `''`에 대해 일어나는 일 |
|---|---|---|
| DTO | `server/src/dtos/google-drive.dto.ts:33` | `z.string()` — `min` 없음. 설명도 "empty string clears the setting". 통과 |
| SDK | `packages/sdk/src/fetch-client.ts:5013-5020` | 본문을 JSON으로 그대로 보냄 — `''` 보존 |
| 컨트롤러 | `google-drive.controller.ts:201-202` | `dto.folderId`를 그대로 전달 |
| 서비스 | `google-drive.service.ts:594-595` | `folderId \|\| null` → **NULL**, 이름도 `(folderId && folderName) \|\| null` → NULL |
| 저장소 | `google-drive.repository.ts:234-241` | `.set({ folderId, folderName })` — 컬럼에 NULL |
| 차단 해제 | `google-drive.service.ts:603` | `clearErrors(userId, [FolderMissing])` — 루트로 돌리는 것도 `folder_missing`의 해결책으로 처리 |
| 업로드 | `google-drive.service.ts:1133` | `parents: folderId ? [folderId] : []` → 루트 |
| 표시 | `GoogleDriveSettings.svelte:76` | `status.folderId ?? ''` → `:347` 루트 문장 |
| 이름 채우기 | `google-drive.service.ts:670` | `credentials.folderId &&`로 시작하므로 NULL 폴더에 이름이 되살아날 수 없다 |

유닛으로도 `google-drive.service.spec.ts:899-906`("should translate a blank folder into null")과
`:908-917`(빈 폴더 + 이름 → 둘 다 NULL)이 이미 붙들고 있다. 이번 라운드가 그 서버 경로를 바꾸지 않았다.

**버튼이 정말 필요했나** — 필요했다. 필드를 감추면 `folderId`를 NULL로 만드는 경로는 연결 해제뿐인데,
그건 행을 통째로 지우고(폴더 선택 포함) CLAUDE.md §7의 재연결 의식을 부른다. 루트 하나 때문에 그걸
시키는 것은 과하다. 다만 N1: 필요했던 만큼 테스트가 있어야 한다.

### 2. 피커 경로에서 저장할 것이 남아 있지 않은가

**남아 있지 않다.** 피커 경로에서 바뀔 수 있는 상태는 넷이고 전부 즉시 저장된다: 폴더
(`handlePickFolder` `:183-185`), 루트(`handleUseRoot` `:215`), 앨범 구독(`handleToggleAlbum`
`:90-92`), 연결 해제(`:243`). 피커 경로의 `folderId`는 어떤 입력에도 묶이지 않으므로(`:377-381`의 필드는
`{:else}` 안) `handleSaveFolder`로 보낼 초안이 생길 수 없다. 폼에 submit 버튼이 없어도 `onsubmit`
(`:258-260`)은 `preventDefault`만 하므로 무해하다.

### 3. ID를 이름을 못 읽을 때만 보이는 것이 다른 실패를 가리는가

**가리지 않는다.** 이 화면에서 실패를 알리는 통로는 ID가 아니라 배너(`:270-297`)와 실패 수(`:298-300`)다.
이름이 **있는데** 잘못된 경우는 둘뿐이다:
- 폴더가 Drive에서 지워졌거나 접근을 잃음 — 이름은 캐시에 남아 보이지만 첫 업로드가 `notFound`로
  실패하면 `folder_missing` 배너가 뜬다. ID는 이 상황의 신호가 아니었다.
- Drive에서 이름을 바꿈 — 표시 전용 오염, 직전 리뷰 N4에서 다룬 것.

그리고 이름이 있어도 **링크 `href`에 ID가 그대로 들어 있다**(`:331`) — 비교가 필요하면 링크를 열면 된다.
그래서 ID를 숨겨서 잃는 정보는 없다.

### 4. ID 필드 제거가 기존 흐름을 깨는가

| 흐름 | 피커 배포 | 피커 없는 배포 |
|---|---|---|
| 잘못 고른 폴더 바로잡기 | "Change"(`:350-361`) 또는 "Use My Drive root"(`:364-370`) — **동작하지만 둘 다 무테스트(N1)** | 필드 + Save — 그대로 |
| `FolderMissing` 복구 | 위 두 버튼 모두 `:603`으로 차단 해제 — **배너는 새로고침까지 남음(N2)** | 필드 + Save, 동일하게 해제 |
| 배너 "Choose a new folder to continue" | 가리키는 버튼(`:350`)이 같은 화면에 있다 | 필드가 있다 |
| 공유 드라이브 폴더를 id로 붙여 넣기 | 잃은 것 없음 — `files.create`에 `supportsAllDrives`가 없어(`google-drive.service.ts` grep 0건) 원래도 동작하지 않았다 | — |

즉 **깨진 흐름은 없다.** 새로 생긴 약점은 "깨졌을 때 아무도 모른다"(N1)와 "고쳤는데 고친 줄 모른다"(N2)다.

### 5. 웹 스펙의 나머지 4개도 공허한가 (`findByText('ToPixel')`류 포함)

**아니다. 6개 전부 해당 대상을 지우거나 뒤집는 변이에서 죽는다**(표의 R1·R3·M2·M5·M6, R2).
리포트가 특히 물은 `findByText('ToPixel')` 뒤의 부재 단언(`queryByText('folder-abc123')`)은 공허할 수
없다 — `loadStatus`(`:72-82`)가 `folderId`와 `folderName`을 **같은 동기 구간에서** 채우므로
`ToPixel`이 보이는 시점에는 ID 분기도 이미 결정돼 있고, R1이 실제로 그 테스트를 죽인다. `queryByText`는
`queryByLabelText`와 달리 라벨 연결에 기대지 않으며, 그 질의가 필드를 **볼 수 있다는 것**은 M6이 증명한다
(`Unable to find an element with the text: Target folder ID`로 죽음).

남는 흠은 공허함이 아니라 정밀도다: "root" 테스트의 정규식이 두 문자열에 맞아 R2에서 곁다리로 죽는다(N5).

### 6. CI: `DB_URL`을 `GITHUB_ENV`로 넘기는 전제가 이 워크플로에서 참인가

**참이다.** `DB_URL`을 쓰는 잡은 `sql` 하나뿐이다(워크플로 전체 grep에서 `DB_URL`은 `:274` 한 줄).
그 잡의 스텝 순서:

| 순서 | 스텝 | `DB_URL` 필요? |
|---|---|---|
| 1-4 | Checkout / Setup mise / Install workspaces / Build the server | 아니오 |
| 5 | Start Postgres — `:274`에서 `GITHUB_ENV`에 기록 | (생산자) |
| 6 | Apply migrations — `server/package.json:32` `sql-tools -u ${DB_URL:-…localhost:5432…}` | **예 — 이후 스텝이라 유효** |
| 7 | Check the migrations actually landed — `docker exec immich-postgres psql …` | 아니오 (컨테이너 직접) |
| 8 | Regenerate — `mise.toml:86-88` → `node ./dist/bin/sync-sql.js` → `ConfigRepository`가 `DB_URL` 읽음(`config.repository.ts:233`) | **예 — 이후 스텝이라 유효** |
| 9 | Fail if the committed SQL is out of date | 아니오 |

잡 수준 `env:`에서 제거한 것도 안전하다 — 5번 이전에 DB를 쓰는 스텝이 없다. `5432`는 워크플로에
`:255`(주석), `:261`(컨테이너 쪽 포트 — 맞음), `:272`(`docker port`의 컨테이너 쪽 — 맞음), `:278`(낡은 주석,
N6)에만 남는다. `feature`/`regression`/`medium` 잡은 `5432`를 쓰지 않는다(medium은 testcontainers).
`sync-open-api.ts:2`가 `5432`를 하드코딩하지만 이 잡에서 실행되지 않는다.

**좋은 안전망 하나**: 전파가 어떻게든 깨지면 6번은 `localhost:5432`로 폴백해 **엉뚱한 DB**에 붙을 수
있지만, 7번이 `docker exec`로 컨테이너 자체의 `kysely_migrations`를 보므로 시끄럽게 실패한다. 8번의
폴백은 호스트 `database`라 `ENOTFOUND`로 시끄럽게 실패한다.

### 7. `4a694ac89`의 주장 — "동작 변경 없음" + "눈먼 자리 4개가 이제 죽는다"

- 뒤쪽 주장은 **참**이다: S1~S4가 각각 정확히 한 테스트를 죽인다(위 표). 직전 리뷰 C1(`!fresh`)이
  이번에는 진짜로 고쳐졌다 — 로그의 `ENOENT` 단언이 두 세계를 가른다.
- 앞쪽 주장은 **거짓**이다(N3).

---

## What I did not verify

- **웹 ESLint와 `//web:ci-unit`** — 로컬 `tscompat` 룰 크래시(안 바뀐 파일에서도 재현)로 돌리지 못했다.
  prettier·svelte-check·vitest는 돌렸다.
- **medium 스위트(60)** — 이 WSL에 docker가 없다. 이 범위에 repository·schema 변경이 없어 영향은
  없다고 보지만 실행하지는 않았다.
- **CI 실행 결과와 `exit 125`의 실제 원인** — `gh`가 없다. 포트 경합이 원인이었다는 리포트의 진단은
  확인하지 못했다(같은 커밋이 `docker pull`도 분리했으므로 레지스트리 원인이었어도 이제 드러난다).
  러너에서 `localhost`가 IPv4로 해석되는지도 확인하지 못했다(N6-2).
- **실제 브라우저 화면·다크 모드** — 보지 않았다. 카드 레이아웃은 happy-dom에서 DOM 구조로만 봤다.
- **운영이 피커 경로라는 것** — CLAUDE.md §7이 랩탑 `.env`에 `IMMICH_GOOGLE_DRIVE_API_KEY`가 있다고
  적은 것에 기댄 가정이다. `GET /api/google-drive/status`의 `pickerAvailable`로 확인할 수 있다
  (단 그 호출은 신원 프로브를 트리거한다 — §7 참고).
- **Google Picker가 "내 드라이브" 루트 자체를 선택 가능하게 보여 주는지** — 컴포넌트 주석(`:211`)의
  "the Google Picker has no 'root' entry"를 구글 문서로 확인하지는 않았다. 결론(버튼이 필요)은
  연결 해제 외에 NULL로 돌릴 경로가 없다는 코드 사실만으로도 선다.
- **`accountProbeAt` 맵이 정리되는지** (N3 부수 관찰).
- 이 리뷰 동안 워크트리에 만든 것: `web/node_modules`(gitignore), 임시 탐침 스펙(삭제 확인),
  줄 번호 변이(매번 원본 복원, md5 확인). 추적 파일 변경은 이 리뷰 파일 하나다.

## Feeding back into the plan

- **"새 사용자 행동에는 클릭 테스트가 있어야 한다."** 이번 스펙은 표시 분기 4개를 꼼꼼히 붙들었지만
  버튼 두 개(루트·피커)는 삭제해도 아무도 죽지 않았다. 표시 테스트가 있다고 행동이 덮이는 것은 아니다.
  웹 스펙 체크리스트에 "이 PR이 추가/이동한 버튼마다 `click → SDK 호출 인자` 단언 1개"를 넣는다.
- **"동작 변경 없음"은 diff로 확인한 뒤에만 쓴다.** `4a694ac89`는 쿨다운 키와 detail 형식을 바꿨다.
  리포트가 "테스트/주석만"이라고 쓰면 리뷰어는 런타임 변경을 공격 목록에서 뺀다.
- **서버가 차단을 풀면 화면도 다시 읽는다.** `handleResume`만 `loadStatus()`를 부르고 폴더 쪽 두 핸들러는
  안 부른다(N2). 차단을 푸는 모든 핸들러에 같은 규칙을.
- **테스트 질의는 정확한 문자열로.** 부분 정규식은 i18n 문구가 겹치는 순간 곁다리로 죽는다(N5).
- **웹 ESLint는 이 리뷰 환경에서 안 돈다.** 다음 리뷰 워크트리를 만들 때 `web/node_modules`를 설치하는
  단계와, `tscompat` 크래시가 로컬 문제인지(CI에서는 도는지) 한 번 확인해 두는 단계를 리뷰 절차에 적는다.
- N3·N6·N7의 문서 드리프트는 코드 수정 없이 계획 문서와 주석에서 바로잡는다.
