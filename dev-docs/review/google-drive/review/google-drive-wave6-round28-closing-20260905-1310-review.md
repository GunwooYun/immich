# Code Review — 관문 이후 델타는 정말 0이다 · 그러나 `afterEach`는 세 개의 술어에서 발판을 걷어냈다 · 사이클 종료 판정

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `0a4c955b4` |
| Commits reviewed | `16562832b`, `994d8835d`, `0a4c955b4` (`git log --oneline ae64e0ae3..0a4c955b4` = 3, 그중 `0a4c955b4`는 리포트 자신) |
| Report | `../report/google-drive-wave6-round28-closing-20260905-1310-report.md` |
| Prior review | `./google-drive-wave6-round27-ledger-fallback-20260905-1245-review.md` (관문 통과 커밋 `ae64e0ae3`) |
| Reviewed | 2026-09-05 |

## Verdict

**사이클을 종료해도 된다. 배포를 막는 것은 없다.**

물어본 두 가지에 각각 답하면 이렇다.

**(1) "운영에 나가는 코드는 관문을 통과한 그대로다"는 참이다** — 리포트가 인용한 명령보다 더 넓게
확인했다. 리포트의 `git diff … -- server/src web/src ':!*.spec.ts'`는 여전히 잘못된 도구다
(`.github/`·`docker/`·`package.json`·`pnpm-lock.yaml`·마이그레이션·`i18n/`·`packages/`를 전부
못 본다 — 실제로 한 번 workflow 변경을 놓쳤던 그 명령이다). 그래서 **경로 지정 없이** 전체
트리를 비교했고, 결과는 5개 파일뿐이다: `CLAUDE.md`, report 1, review 1, results 1, medium spec 1.
그리고 그 두 개(`CLAUDE.md`, medium spec)가 **이미지에 들어가지 않는다는 것을 논증이 아니라
빌드로 보였다** — `server/Dockerfile`은 `CLAUDE.md`를 COPY하지 않고,
`tsc -p tsconfig.build.json --listFiles`가 읽는 4,164개 입력 중 `server/test/` 아래 파일은
**0개**, `*.spec.ts`도 **0개**다.

**(2) 그런데 `afterEach`는 실제로 발판 세 개를 걷어냈다.** 53개는 그대로 통과하지만, 53개가
같은 것을 증명하지는 않는다. 저자가 확인한 네 개(`:48`·`:288`·`:298`·`:547`)는 전부 여전히 죽고
`:562`도 죽지만, **`afterEach` 이전에는 죽었는데 이후에는 살아남는 변이가 세 개** 있다:
`repository.ts:135`(`setDriveAccountId`의 되읽기 `userId` 스코프), `:790`(`getBlockingError`),
`:862`(`getErrorSummary`). 셋 다 **`userId` 스코프**이고, 셋 다 죽던 이유가 "앞선 describe가
남긴 *다른 사용자의* 행"이었다. 리포트의 "**모든 픽스처를 명시적으로 고쳤다**"는 문장은 이
셋에 대해서는 사실이 아니다.

**그럼에도 이것이 배포를 막지 않는 이유는 세 가지다.** ① 프로덕션 코드는 문자 그대로 0줄
바뀌었다 — 술어들은 전부 코드에 그대로 있고, 사라진 것은 *테스트가 그것을 볼 수 있는 능력*이지
술어 자체가 아니다. ② **공허해진 테스트는 없다.** 다섯 개의 `failure bookkeeping` 테스트는
자기 픽스처로 양의 값(`failedCount: 1`)을 단언하고, `:986`은 witness까지 갖고 있다 —
이름이 말하는 것은 여전히 증명한다. ③ 60개 변이 중 **37개가 죽는다**, 그중 이 배포의
핵심(원장 `''` 폴백 양쪽 형태 `:45`/`:48`, 입양의 CAS·connectionId·collision 전부,
blocked-subscriber 스코프)은 전부 포함된다.

**가장 중요한 문제 하나를 꼽자면**: 이번 커밋이 만든 결함이 아니라, 이번 커밋이 **드러낸
사실**이다 — 이 파일의 격리는 여러 라운드 동안 우연이었고, 그 우연에 기대던 곳이
저자가 찾은 둘(`:298`·`:562`)만이 아니라 최소 다섯이었다. 고칠 값은 **테스트 4줄**이고
(아래 N1에 실제로 돌려본 패치가 있다), 배포와는 직교한다.

### Evidence I ran myself

전부 이 워크트리 HEAD(`0a4c955b4`)에서 돌렸다. 변이는 줄 번호로 넣고(전체 줄 삭제 또는 줄 안
부분 삭제), **매 실행 뒤 `git checkout --`으로 복원**했다. medium 하네스는 실행마다
testcontainer를 새로 띄우므로 실행 사이 오염은 없다.

| Check | Result |
|---|---|
| medium (무변이) | `Test Files 1 passed / Tests 53 passed (53)` — 리포트의 53과 일치 |
| server unit (`run.sh`의 8스펙) | `Test Files 8 passed / Tests 264 passed (264)` — 리포트의 264와 일치 |
| `git diff --name-status ae64e0ae3..0a4c955b4` (**경로 지정 없음**) | 5 files: `M CLAUDE.md`, `A` report, `A` review, `A` results, `M` medium spec |
| `git diff --name-only ae64e0ae3..0a4c955b4 -- .github docker mise.toml package.json pnpm-lock.yaml server/package.json` | **0** |
| `server/Dockerfile`의 COPY 대상 | `./server`, `./packages/*`, `./web`, `./i18n`, `./mise.toml`, `LICENSE` — **`CLAUDE.md`는 어느 스테이지에도 들어가지 않는다** |
| `npx tsc -p tsconfig.build.json --noEmit --listFiles` | 입력 **4,164**개 중 `server/test/` 아래 **0개**, `*.spec.ts` **0개** (exit 0) |
| `server/package.json` `files` | `["bin","dist","helmet.json"]` — 최종 이미지가 가져가는 `/output/server-pruned`의 범위 |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx eslint test/medium/.../google-drive.repository.spec.ts --max-warnings 0` | exit 0 |
| 첨부 증거 `results/20260905-1304.txt` | `commit: 16562832b`, dirty 마커 **없음**, 264 / 39 / 53, `RESULT: PASS` — 주장대로 |
| CI `runs/33943593503` (api.github.com) | `head_sha 994d8835d…`, `conclusion success`, 잡 4개(`Feature suite` / `Generated SQL is current` / `Full server + web unit sweep` / `Medium (real database) tests`) **전부 success** — 주장대로 |
| 리포트의 코드 인용 `server.service.ts:122` | `googleDrive: isGoogleDriveEnabled(googleDrive, server)` — 맞다 |
| 리포트의 코드 인용 `misc.ts:150-154` | `isGoogleDriveEnabled` 정의가 정확히 그 줄 — 맞다 |
| `GoogleDriveStatusResponseSchema` (`dtos/google-drive.dto.ts:40-67`) | 필드는 `connected`/`folderId`/`folderName`/`connectedAt`/`failedCount`/`blockedReason`/`pickerAvailable` — **`enabled` 없음**. N2 주장 맞다 |
| `git status --porcelain` (종료 시) | **이 리뷰 파일 하나뿐** |

**변이 전수 (60개).** "before"는 `ae64e0ae3`의 스펙(= `afterEach` 없음)을 그대로 되돌려 놓고
같은 변이를 건 결과다. 회귀는 **before=DEAD / after=ALIVE** 인 줄뿐이다.

| 결과 | `repository.ts` 줄 | 판정 |
|---|---|---|
| **회귀 (before DEAD → after ALIVE)** | `135`, `790`, `862` | **N1** — 아래 |
| ALIVE, before에도 ALIVE (기존 공백, 이번 커밋과 무관) | `120`, `214`, `313`, `372`, `398`, `452`, `491`, `492`, `550`, `551`, `563`, `597`, `644`, `645`, `670`, `712`, `810`, `811`, `828`, `829` | N2 — 아래, 비차단 |
| DEAD (37개) | `45`, `48`, `119`, `171`, `196`, `197`, `198`, `203`, `205`, `213`, `215`, `288`, `292`, `298`, `299`, `397`, `451`, `487`, `488`, `490`, `493`, `540`, `547`, `548`, `552`, `562`, `569`, `599`, `642`, `646`, `672`, `711`, `791`, `859`, `860`, `863`, `864` | 저자가 확인한 4개(`48`·`288`·`298`·`547`) 포함, **`562`도 죽는다** |

`45`/`48`은 줄 삭제가 아니라 ` or "google_drive_upload"."driveAccountId" = ''`만 제거하는 치환으로
넣었고 둘 다 `1 failed | 52 passed`로 죽는다 — round-27이 세운 `''` 폴백의 두 형태는 그대로다.

## Findings

### N1 — `afterEach`가 세 개의 `userId` 스코프에서 (우연한) 커버리지를 걷어냈다 · **비차단**

세 변이 모두 `afterEach` 이전에는 죽었고 이후에는 살아남는다. 셋 다 "다른 사용자의 잔여 행"이
죽음의 원인이었다.

| 변이 | before | after | 원래 죽이던 테스트 |
|---|---|---|---|
| `repository.ts:135` `.where('userId', '=', userId)` (`setDriveAccountId`의 되읽기) 삭제 | `2 failed \| 51 passed` | `53 passed` | `spec.ts:457` `…token has changed`, `spec.ts:482` `…concurrent stamp already settled on` (둘 다 `expected null to be 'account-x'`) |
| `repository.ts:790` `.where('userId', '=', userId)` (`getBlockingError`) 삭제 | `5 failed \| 48 passed` | `53 passed` | `failure bookkeeping`의 다섯 개 (`spec.ts:963`, `:986`, `:1005`, `:1020`, `:1036`) |
| `repository.ts:862` `.where('google_drive_upload_error.userId', '=', userId)` (`getErrorSummary`) 삭제 | `5 failed \| 48 passed` | `53 passed` | 위와 같은 다섯 개 |

메커니즘은 리포트가 스스로 진단한 그것이다. `:790`/`:862`는 앞선 `getSubscribers` describe
(`spec.ts:317` "…blocked by a quota or a missing folder")가 **다른 사용자에게** 남긴
`quota_exceeded`/`folder_missing` 행이 스코프를 지운 쿼리에 딸려 들어와 `failedCount`와
`blockedReason`을 오염시켜 죽었다. `:135`는 되읽기가 `LIMIT 1`뿐이라, 잔여 `user_google_drive`
행(그중 `driveAccountId`가 null인 것)이 먼저 잡혀 `null`이 반환되어 죽었다.

**중요한 구분**: 이 다섯(+둘) 테스트가 **공허해진 것은 아니다.** `spec.ts:1020`은 여전히 두
사용자를 만들고 `failedCount: 1`을 단언하며, `spec.ts:986`은 "witness" 블록으로 0이 빈 테이블이
아니라 anti-join에서 온 것임을 못박는다. 사라진 것은 *이 세 술어를 관측할 수 있는 능력*이다.

**고칠 값 — 실제로 돌려봤다.** 이 저장소가 이미 갖고 있는 `sharedAlbum` 헬퍼의 주석
(`spec.ts:70-75`, "Every fixture in this file used to create a single user, which is why deleting
those predicates changed nothing")이 말하는 바로 그 처방이다. 두 테스트에 각각 두 줄:

```ts
// spec.ts:486 (`should report the account a concurrent stamp already settled on`) — user 행 삽입 앞
const { user: other } = await ctx.newUser();
await connect(ctx, other.id, 'account-other');

// spec.ts:1029 (`should not let another user's ledger row hide this user's failure`) — 원장 행 앞
const { asset: otherAsset } = await ctx.newAsset({ ownerId: other.id });
await sut.upsertError(other.id, otherAsset.id, GoogleDriveUploadErrorClass.QuotaExceeded, 'full');
```

결과: 무변이 `53 passed`, 그리고 `L135` → `1 failed | 52 passed`, `L790` → `1 failed | 52 passed`,
`L862` → `1 failed | 52 passed`. **세 개 전부 되살아난다.**

⚠ **한 가지는 정직하게 적어 둔다.** 위 `:486` 픽스처가 `L135`를 죽이는 것은 `executeTakeFirst()`가
`ORDER BY` 없는 `LIMIT 1`이라 **먼저 삽입된 `other`의 행이 먼저 잡히기 때문**이다 — 힙 순서에
기댄 킬이고, 원리적으로는 이번에 문제가 된 "우연한 격리"와 같은 종류다. 순서에 의존하지 않는
형태도 확인했다. 연결이 **없는** 사용자로 호출하면 정상 코드는 무조건 `null`, 변이는 무조건
남의 계정을 반환한다:

```ts
it("should not report another user's account for a connection that does not exist", async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { user: other } = await ctx.newUser();
  await connect(ctx, other.id, 'account-other');

  await expect(sut.setDriveAccountId(user.id, 'token-a', 'account-x')).resolves.toBeNull();
});
```
→ 무변이 `54 passed (54)`, `L135` 삭제 시 `1 failed | 53 passed (54)`. **이쪽을 권한다.**

**왜 배포를 막지 않는가**: 프로덕션 코드는 0줄 바뀌었고, 세 술어는 전부 코드에 그대로 있다.
이건 배포 위험이 아니라 **다음 라운드가 회귀를 잡을 수 있는가**의 문제다.

### N2 — before/after 모두 살아 있는 생존자 20개 (기존 공백, 이번 커밋과 무관) · **비차단·nitpick**

`120`, `214`, `313`, `372`, `398`, `452`, `491`, `492`, `550`, `551`, `563`, `597`, `644`, `645`,
`670`, `712`, `810`, `811`, `828`, `829`. **`afterEach`와 인과가 없다** — before 스펙에서도 전부
살아남았다. 그중 `:398`·`:452`는 round-26이 이미 지목했고 round-27이 gate 3/gate 5 그물로
비차단 판정을 내린 것들이고, `:810`/`:811`/`:828`/`:829`(`hasErrorOfClass`/`clearErrors`)는
이 medium 파일이 애초에 호출하지 않는 메서드다(유닛 스펙 관할). 이번 종료 확인의 범위 밖이므로
목록만 남긴다.

### N3 — 리포트의 줄 인용 하나가 두 줄 어긋난다 · **nitpick**

리포트 34행이 신원 프로브를 `service.ts:632-639`로 인용하는데, 실제 블록은
`google-drive.service.ts:634-640`(`if (credentials?.driveAccountId === null && this.probeAllowed(userId))`)
이고 `632-633`은 그 위 주석이다. 내용은 정확하다 — `getStatus`가 프로브를 트리거하므로 "설정
화면을 열기 전"의 관측이 될 수 없다는 N2 반영의 근거는 그대로 성립한다.

## Answers to what the report asked me to attack

### "운영에 나가는 코드는 관문을 통과한 그대로다" — 참인가?

**참이다.** 리포트가 인용한 명령을 믿지 않고 다시 확인했다.

1. **경로 지정 없이** `git diff --name-status ae64e0ae3..0a4c955b4` → 5개 파일뿐
   (`CLAUDE.md`, report, review, results, medium spec). `.github/`·`docker/`·`mise.toml`·
   `package.json`·`pnpm-lock.yaml`·`server/package.json` 한정 diff는 **0**.
   마이그레이션·`i18n/`·`open-api/`·`packages/`·`web/`도 변경 없음(위 5개가 전부이므로).
2. **이미지에 실제로 들어가는가**를 따로 확인했다. `server/Dockerfile`이 COPY하는 것은
   `./server`, `./packages/{sdk,plugin-sdk,plugin-core}`, `./web`, `./i18n`, `./mise.toml`,
   `LICENSE`뿐 — **`CLAUDE.md`는 빌드 컨텍스트에 들어가지도 않는다.**
3. medium 스펙은 `COPY ./server`로 builder 스테이지에는 들어가지만, 최종 스테이지가 가져가는 것은
   `pnpm --filter immich --prod deploy`가 만든 `/output/server-pruned`이고 `server/package.json`의
   `files`는 `["bin","dist","helmet.json"]`이다. 그리고 `dist`를 만드는 컴파일이 그 파일을
   **읽지도 않는다**: `tsconfig.build.json`의 `exclude`가 `["dist","node_modules","upload","test","e2e","**/*spec.ts"]`이고,
   `tsc -p tsconfig.build.json --listFiles`가 실제로 읽는 4,164개 입력 중 `server/test/` 아래는
   **0개**다.

즉 이번 델타에서 배포 산출물에 영향을 주는 변경은 **하나도 없다**. 지목할 것이 없다.

### `afterEach`가 다른 테스트의 근거를 없애지 않았는가?

**없앴다 — 세 곳에서.** 다만 "공허해진 테스트"는 없고, 배포를 막지도 않는다.

- 저자가 확인한 네 개(`:48`·`:288`·`:298`·`:547`)는 전부 재확인했고 그대로 죽는다. 저자가
  **확인하지 않은** `:562`(round-26에서 격리하면 살아 있던 둘 중 하나)도 죽는다 —
  `1 failed | 52 passed`.
- 저자가 보지 않은 곳에서 **`:135`·`:790`·`:862`** 가 살아났다. 전부 `userId` 스코프이고,
  전부 "앞선 describe의 잔여 행"에 기대고 있었다 (N1의 표에 before/after 숫자와 원래 죽이던
  테스트 이름을 적었다).
- **"공허하게 통과"하는 쪽으로 무너진 테스트는 찾지 못했다.** 영향받은 다섯 개
  (`failure bookkeeping`)는 전부 자기 픽스처로 `failedCount: 1` 같은 **양의** 값을 단언하고,
  `spec.ts:986`은 witness 블록을 갖고 있다. 무변이 실행에서 53개가 통과하고, 그 다섯 개를 죽이는
  다른 변이(`:791`, `:859`, `:860`, `:863`, `:864`)는 여전히 살아 있는 채로 죽는다 — 즉 그
  테스트들은 여전히 실제 쿼리를 통과하고 있다.
- 방향도 확인했다: 표의 37개 DEAD는 **`afterEach`가 들어간 지금** 죽는 것이고, 20개는
  `afterEach` 이전에도 살아 있던 것이다. `afterEach`가 순수하게 잃게 만든 것은 3개다.

## What I did not verify

- **웹 유닛 39개를 이 워크트리에서 돌리지 못했다.** `web/node_modules`가 없어
  (`Cannot find package '@sveltejs/enhanced-img'`) vitest가 config 로드 단계에서 죽는다.
  근거로 삼은 것은 ① 이번 델타에 `web/` 파일이 **하나도 없다**는 것과 ② CI의
  `Full server + web unit sweep` 잡이 `994d8835d`에서 success라는 것뿐이다. 직접 돌리지 않았다.
- **`svelte-check` 베이스라인 비교를 돌리지 않았다** (같은 이유). 리포트도 이번 라운드에서
  주장하지 않는다.
- **`sql-tools migrations generate` 드리프트 검사를 돌리지 않았다.** 이번 델타에 스키마·
  마이그레이션 파일이 없고, CI의 `Generated SQL is current` 잡이 success다.
- **`CLAUDE.md`에 새로 들어간 배포 순서(1~10)를 운영 환경에서 실행해 보지 않았다.** 5번의
  `curl /api/server/features | … ["googleDrive"]`는 **응답 스키마가 그 필드를 갖고 있다는 것만**
  코드에서 확인했다(`server.service.ts:122`). 랩탑에 실제로 쳐 보지는 않았다.
- **N2의 생존자 20개가 유닛 스펙이나 다른 medium 스펙에서 덮이는지 확인하지 않았다.** 이 파일
  안에서 살아남는다는 것만 말할 수 있다.
- 변이는 **줄 삭제(및 `:45`/`:48`의 부분 삭제)** 한 종류다. 조건 반전·경계값 변이는 걸지 않았다.

## Feeding back into the plan

`dev-docs/google-drive/`의 계획 문서에 남길 것.

1. **이 medium 파일의 격리 문제는 두 단계로 끝난다 — 이번 커밋은 첫 단계만 했다.** ① 정리를
   넣는 것(`afterEach`, 완료), ② 정리 때문에 관측 불가능해진 술어에 두 사용자 픽스처를 주는 것
   (**미완, N1의 세 개**). ①만 하면 커버리지가 조용히 줄어든다 — 53개가 그대로 통과하므로
   테스트 수로는 절대 안 보인다. **다음에 이 파일에 정리 로직을 추가할 때는 추가 전/후로 변이를
   한 번씩 돌려 before=DEAD/after=ALIVE를 뽑는 것이 검사 절차다.** 이 리뷰의 하네스가 그것이고,
   60개 변이에 medium 한 번당 약 12초, 전체 15분이면 끝난다.
2. **`CLAUDE.md` §2 "부정 단언은 의도한 이유로 통과하는지 확인한다"에 한 줄 덧붙일 값이 있다** —
   *긍정* 단언도 의도한 이유로 통과하는지는 별개 문제다. `:790`/`:862`를 죽이던 다섯 테스트는
   전부 긍정 단언(`failedCount: 1`)이었고, 그 킬은 남의 행에서 왔다.
3. **"프로덕션 델타 0" 확인 명령을 리포트 템플릿에서 고정한다.** `-- server/src web/src`는
   두 번 틀렸다(workflow, 그리고 잠재적으로 `docker/`·lockfile). 올바른 형태는 경로 지정 없는
   `git diff --name-status <gate>..HEAD`이고, 그 위에 "이 중 이미지에 들어가는 것이 있는가"를
   `server/Dockerfile`의 COPY 목록과 `tsconfig.build.json`의 `exclude`로 답한다.
4. round-26의 생존자 목록(`:398`·`:452`)에 N2의 나머지 18개를 합쳐 **한 곳에** 둔다. 지금은
   라운드마다 부분집합이 다시 발견된다.

## For later, not now (배포를 막지 않음)

- **N1의 테스트 4줄** — 위에 돌려본 패치가 그대로 있다. 배포 후 아무 때나.
- **N2의 생존자 20개** — 목록화만. 대부분은 다른 스펙이 덮거나(gate 3/gate 5) 이 파일 관할이 아니다.
- **N3의 줄 번호 두 칸** — 문서 오탈자 수준.
- 이 리뷰가 medium 하네스를 60여 번 돌리면서 **testcontainers 컨테이너가 데스크탑에 다수 남아
  있다.** 정리 명령(`docker rm -f $(docker ps -aq --filter label=org.testcontainers=true)`)은
  이 세션의 권한 정책에 막혀 실행하지 못했다. ryuk가 회수하지만, `docker ps -a`가 지저분해
  보이면 위 명령으로 치우면 된다. 저장소 파일과는 무관하다.

---

**`git status --porcelain` 확인**: 종료 시점에 이 워크트리의 변경은
`dev-docs/review/google-drive/review/google-drive-wave6-round28-closing-20260905-1310-review.md`
**하나뿐**이다. 변이는 전부 `git checkout --`으로 복원했고, 임시로 되돌렸던 `ae64e0ae3` 버전의
스펙도 복원했다. 소스 수정·수정 제안 반영은 하지 않았다.
