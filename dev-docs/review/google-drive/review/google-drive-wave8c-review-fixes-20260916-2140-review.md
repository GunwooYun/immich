# Code Review — wave8c: wave8b 리뷰 반영 (`7048d8be2`, `2e1cdceb0`)

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `b4967e07e` |
| Commits reviewed | `7048d8be2` (fix), `2e1cdceb0` (evidence), `b4967e07e` (report) — `git diff 22fd909e6 7048d8be2 -- server/src CLAUDE.md` |
| Report | `../report/google-drive-wave8c-review-fixes-20260916-2140-report.md` |
| Prior review | `./google-drive-wave8b-config-truth-20260916-2120-review.md` |
| Reviewed | 2026-09-16 (모든 수치는 이 워크트리 HEAD에서 직접 돌린 것) |

## Verdict

**배포 판정: 막지 않는다 (NOT BLOCKED).** 이번 커밋의 운영 코드 변경은 `album.service.ts:301-303`의 JSDoc
한 문단뿐이고 나머지는 스펙·런북이다. 리포트의 수치(서버 8스펙 279 / 웹 45 / 전체 2,389+2 skip)와 변이
M1~M4는 전부 재현됐고, wave8b가 남긴 C1~C3·N1~N3는 모두 코드에 반영되어 있다. 런북 §8의 정리 절차는
`updateConfig`→`getKeysDeep(defaults)`→`system_metadata` 전체 교체 upsert 경로로 **참**이고, `enabled`가 떨어지는
이유도 리포트가 말한 것(`safeParse` strip)에 더해 두 겹이 더 있다(§Answers 1).

가장 중요한 문제는 리포트가 스스로 의심한 §3이다. `subscribeAlbum`의 접근 제어 테스트(spec `:1019-1030`)는
이름이 *"download access, not merely read access"*인데, `Permission.AlbumDownload`를 `AlbumRead`로 바꿔도
**96개 전부 통과한다**(M5). `getCredentials` 미호출 목격자는 "접근 제어 *전에* 자격증명을 읽지 않았다"까지만
증명하고, *어떤 권한으로* 막았는지는 못 본다 — `access.ts:166-173`과 `:211-218`이 같은 두 호출(owner ∪ Viewer)이라
mock 수준에서는 두 권한이 구별되지 않고, 유일한 구별점은 `requireAccess`가 던지는 문장
`Not found or no album.download access`(`access.ts:40`)다. `rejects.toBeDefined()`를 그 문장으로 바꾸면 잡힌다
(M8로 확인). `syncAlbum`에는 같은 권한 테스트가 아예 없다(M7). 둘 다 운영 코드는 맞게 되어 있으므로 차단
사유는 아니다.

### Evidence I ran myself

전부 이 워크트리 HEAD에서 돌렸다. `run.sh`는 `results/`에 파일을 남기므로 쓰지 않고, 그 안의 스펙 목록
(`run.sh:76-91`)을 같은 명령으로 재현했다. 변이는 `sed`로 줄 단위로 넣고 매번 `git checkout --`으로 복원했으며,
`google-drive.service.ts`의 md5 `ccbcd45c…`가 시작·매 변이 후·종료 시 동일함을 확인했다.

| Check | Result |
|---|---|
| server unit — `run.sh`의 8스펙 | `Test Files 8 passed / Tests 279 passed (279)` — **리포트 279와 일치** (wave8b 278 + `subscribeAlbum` 게이트 테스트 1) |
| server unit — 전체 (`--config test/vitest.config.mjs`) | `94 passed / 2389 passed \| 2 skipped (2391)` — **리포트 2,389/2와 일치** |
| web unit — `run.sh`의 5스펙 | `5 passed / 45 passed (45)` — **리포트 45와 일치** |
| `google-drive.service.spec.ts` 단독 | `96 passed` (변이 기준선; wave8b는 95) |
| server `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| server `npx eslint` (바뀐 4파일, `--max-warnings 0`) | exit 0 |
| 첨부 증거 `results/20260916-2139.txt` | `commit: 7048d8be2`, **UNCOMMITTED 마커 없음**, 279 / 45 / svelte-check 회귀 없음, `RESULT: PASS` — 주장대로 |
| `git merge-base --is-ancestor v3.1.0 HEAD` | ancestor 맞음 |
| 랩탑 이름만 확인 (`ssh … grep -c IMMICH_GOOGLE_DRIVE`) | `.env` 0건 / `docker-compose.yml` 0건 / `docker exec immich_server env` 0건 — **CLAUDE.md:481-482 주장 재현**. 값은 출력하지 않았다. 추가로 compose에 `env_file` 줄 2개, `immich_server` 컨테이너 실행 중 |
| server medium (실 DB) | **돌리지 못했다** — `docker info` exit 1 |
| `git status --porcelain` (종료 시) | **이 리뷰 파일 하나뿐** |

**변이 전수.** 대상 `server/src/services/google-drive.service.ts`(줄 번호는 HEAD 기준), 스펙 기준선 96.

| # | 변이 | 결과 | 판단 |
|---|---|---|---|
| M1 | `:1440-1442` 삭제 — `subscribeAlbum` enabled 게이트 | `1 failed \| 95` — `should refuse to subscribe when the feature is not configured`, 실패 사유 *expected 'Google Drive sync is not enabled…' but got 'Not found or no album.download access'* | **리포트 M1 그대로.** wave8b C2 닫힘. 실패 문장이 "다음 가드에서 죽었다"를 정확히 말한다 |
| M2 | `:158` 라벨과 `:165` 문장을 옛 문구로 되돌림 | `1 failed \| 95` — getAuthUrl redirect 테스트, *expected … 'IMMICH_GOOGLE_DRIVE_REDIRECT_URL'* | **리포트 M2 그대로.** wave8b C3 닫힘 |
| M3 | `:901-903` 삭제 + `:900`을 non-null assert로 | `1 failed \| 95` — *expected … 'Google Drive is not connected' but got 'Cannot read properties of undefined'* | **리포트 M3 그대로.** wave8b N1 닫힘 — 이제 TypeError를 "우연한 통과"가 아니라 **실패로** 본다 |
| M4 | `:1445` `getCredentials`를 `:1443` `requireAccess` 앞으로 | `1 failed \| 95` — `should gate subscribing on download access…`, *spy … called 1 times* | **리포트 M4 그대로.** 순서는 지킨다 |
| **M5** | `:1443` `Permission.AlbumDownload` → `Permission.AlbumRead` | **`96 passed`** | **테스트 이름이 약속한 것을 못 본다 → C1** |
| M6 | `:1440-1442` enabled 게이트를 `:1443` `requireAccess` **뒤로** 이동 | `1 failed \| 95` — `should refuse to subscribe when the feature is not configured`, *expected 'Google Drive sync is not enabled…' but got 'Not found or no album.download access'* | 새 게이트 테스트의 **문장 단언**이 순서 역전을 잡는다. `checkOwnerAccess` 목격자보다 먼저 문장에서 죽으므로 목격자는 이중 안전망이다 |
| **M7** | `:1517` `syncAlbum`의 `AlbumDownload` → `AlbumRead` | **`96 passed`** | **`syncAlbum`엔 권한 테스트 자체가 없다 → C2** |
| M8 | (스펙 수정 검증) `:1027` `rejects.toBeDefined()` → `rejects.toThrow('Not found or no album.download access')` + M5 재적용 | `1 failed \| 95` — *expected … 'album.download access' but got 'Not found or no album.read access'* | **C1의 제안 수정이 M5를 잡는다** |

## Findings

### C1 — `subscribeAlbum` 접근 제어 테스트는 "download이지 read가 아니다"를 못 본다 (심각도: 낮음, 비차단, 스펙 한 줄)

spec `:1019-1030`:
```ts
it('should gate subscribing on download access, not merely read access', async () => {
  …
  await expect(sut.subscribeAlbum(AuthFactory.create(user), 'album-1')).rejects.toBeDefined();
  expect(mocks.googleDrive.getCredentials).not.toHaveBeenCalled();
```
M5(`:1443`을 `AlbumRead`로) → **96 passed**. 이유는 두 층이다.

1. `utils/access.ts:166-173`(AlbumRead)와 `:211-218`(AlbumDownload)이 **같은 두 호출**(`checkOwnerAccess` ∪
   `checkSharedAlbumAccess(…, Viewer)`)이라 mock 호출 패턴으로는 구별이 안 된다. 지금 코드에서 둘의 의미가
   같다는 뜻이기도 하다 — 그래도 테스트 이름은 "share가 view-only로 제한되면"을 말하니, 그 날이 오면
   `access.ts`가 갈리고 이 테스트가 그것을 잡아야 한다.
2. 유일한 구별점은 `requireAccess`의 문장 `Not found or no ${request.permission} access`(`access.ts:40`)인데
   `rejects.toBeDefined()`는 **어떤 거부든** 받는다. 같은 이유로 이 테스트는 enabled 게이트가 잘못 거짓이 되어도
   (예: `isGoogleDriveEnabled`가 나중에 `apiKey`까지 요구하게 되면) 조용히 통과한다 — `getCredentials` 미호출은
   게이트에서 죽어도 성립한다.

**고치는 법 (M8로 검증).** `:1027`을
```ts
await expect(sut.subscribeAlbum(AuthFactory.create(user), 'album-1')).rejects.toThrow(
  'Not found or no album.download access',
);
```
로 바꾼다. 그러면 M5가 *expected 'album.download' but got 'album.read'*로 죽고, 게이트에서 죽는 경우도
문장이 달라 죽는다. `getCredentials`·`subscribe` 목격자는 그대로 둔다(순서 M4용).

### C2 — `syncAlbum`에는 권한 테스트가 없다 (심각도: 낮음, 비차단, 선존재)

M7(`:1517`을 `AlbumRead`로) → **96 passed**. `describe('syncAlbum')`(spec `:1586-`)의 11개 테스트 중
`requireAccess`가 거부하는 케이스는 없다 — 전부 `checkOwnerAccess`를 성공으로 stub한다. `syncAlbum:1512-1517`
주석은 "Download-level access, not merely read"를 길게 설명하는데, 그 결정을 붙드는 테스트가 없다.

**고치는 법.** C1의 테스트를 `syncAlbum`으로 복제한다 — `enabledConfig`, 접근 stub 없음,
`rejects.toThrow('Not found or no album.download access')`, 목격자 `album.getById`·`job.queueAll` 미호출.

### N1 — `syncAlbum` "not subscribed" 테스트는 4연속 같은 타입 가드 앞에서 클래스만 본다 (nitpick, 선존재)

spec `:1619` `rejects.toBeInstanceOf(BadRequestException)`. `syncAlbum:1509-1530`은 enabled → `requireAccess` →
`Album not found` → `isSubscribed` 네 가드가 **전부 `BadRequestException`**이다. wave8b M5가 보인 대로 `queueAll`
목격자 덕에 가드를 지우면 죽긴 하지만, 예컨대 `album.getById` stub이 사라져 `Album not found`에서 죽어도 통과한다.
`.rejects.toThrow('Add this album to your Google Drive backups before syncing it')`로 바꾸면 의도한 가드에서
멈췄음이 못 박힌다. 리포트 §4가 물은 "두 가드가 같은 타입인 곳"의 마지막 남은 자리다 — 나머지(`:879`, `:1193`,
`:1206`, `:1281`, `:1322`, `:1347`)는 §Answers 4에서 하나씩 판단했고 전부 괜찮다.

### N2 — 관리 화면을 전제하는 문구가 하나 더 남았다 (nitpick)

`system-config.service.spec.ts:548-549` *"typing a value in the admin UI must still win over whatever the
environment supplies"* 와 `:554`의 `'typed-in-the-admin-ui'`. 이번 커밋이 같은 파일 `:534-539`는 고쳤지만 이
블록은 남았다. 테스트 자체는 옳고(저장된 partial이 env를 이긴다 — C1 정리 절차의 "하나라도 다르면 그 키만 남는다"의
근거), 이름만 "stored partial"로 바꾸면 된다. `system-config.service.spec.ts:313`의 `enabled: false` 픽스처는
**의도된 것**(옛 row가 남긴 미지 키를 strip하는지 보는 테스트)이라 손대면 안 된다.

### N3 — 런북 step 2의 관측 명령에 붙일 조건 둘 (nitpick, 운영)

`CLAUDE.md:537-538`은 "값을 출력하지 말고 키별로 비었는지·해시가 같은지만 본다"고 쓰는데, 실제로 그 엔드포인트는
`mapConfig(defaults)`(identity, `system-config.dto.ts:462-464`)라 **`clientSecret`을 평문으로 돌려준다**. 즉 raw
`curl`은 §1 위반이다 — wave8b N3의 `len()` 파이프 명령을 런북에 그대로 넣어 두는 편이 안전하다. 또
`system-config.controller.ts:30`이 `admin: true` + `Permission.SystemConfigRead`를 요구하므로 API 키는 그 권한으로
만들어야 한다. 마지막으로, 랩탑 compose에 `env_file` 줄이 2개 있다는 것(이번에 이름만 확인)을 §7에 적어 두면
"`.env`에 넣으면 컨테이너에 도착한다"의 근거가 남는다.

## Answers to what the report asked me to attack

### 1. C1 레시피 — "네 키 모두 같으면 partial이 사라진다"는 `updateConfig` 경로에서 참인가? `enabled`는? 다른 키는?

**참이고, `enabled`가 떨어지는 층은 셋이다.**

- `utils/config.ts:44-64` `updateConfig`는 `getKeysDeep(defaults)`만 돌며 `isEmpty || isEqual`이면 건너뛰고
  `partialConfig`에 넣지 않는다. `config.ts:361-367`의 `defaults.googleDrive`는 **`clientId`·`clientSecret`·
  `redirectUrl`·`apiKey` 네 키뿐**이다(`SystemConfig` 타입 `config.ts:121-126`도 같다). 다른 키는 없다.
- 그래서 네 키가 전부 defaults(=env)와 같으면 `partialConfig`에 `googleDrive`가 아예 생기지 않고,
  `system-metadata.repository.ts:30-36`의 `set`은 `onConflict … doUpdateSet({ value })`로 **row 값 전체를
  교체**한다(merge가 아니다). 이것이 partial이 "통째로 사라지는" 실제 기전이다.
- `enabled`가 사라지는 이유: (a) GET 쪽 — `buildConfig`의 `SystemConfigSchema.safeParse`(`utils/config.ts:103`)가
  `z.object` 기본 strip으로 미지 키를 벗겨 응답 본문에 없다(리포트가 말한 것; `system-config.service.spec.ts:306-324`가
  이걸 핀한다). (b) PUT 쪽 — 본문 DTO가 `createZodDto(SystemConfigSchema)`라 들어와도 strip된다.
  (c) 저장 쪽 — `updateConfig`가 `defaults`의 키만 걷으므로 어떤 경로로 들어와도 `partialConfig`에 못 실린다.
  셋 중 하나만 있어도 충분하다.
- 조건 확인: `SystemConfigGoogleDriveSchema`(`system-config.dto.ts:229-245`)의 `redirectUrl`은 `refine`만 있고
  transform이 없어 GET 값 == row 값이다. `server.externalDomain`만 정규화되는데 `googleDrive` 밖이다.
- 말하지 않은 전제 하나: `IMMICH_CONFIG_FILE`이 설정된 인스턴스는 PUT 자체가 거부된다(`buildConfig:78-80`의
  파일 모드). 랩탑은 row를 쓰므로 해당 없다.

### 2. N3 — `GET /api/system-config/defaults`는 env에서 온 값인가, 정적 객체인가?

**env에서 온 값이다 — 단, 프로세스 시작 시점의 env다.** `system-config.service.ts:30-31` `getDefaults()`는
`mapConfig(defaults)`, `mapConfig`는 identity(`system-config.dto.ts:462-464`), `defaults`는 `config.ts:361-367`에서
모듈 로드 시 `process.env.IMMICH_GOOGLE_DRIVE_*`를 읽어 만든 const다. 그래서 런북 step 1의 "재시작"이 필요하고,
step 2가 그 재시작 뒤에 오는 순서가 맞다. 주의는 N3에 적었다 — 평문 시크릿을 돌려주고, 관리자 + `systemConfig.read`
권한이 필요하다.

### 3. M4 목격자 — `getCredentials` 미호출은 "접근 제어가 먼저 돌았다"의 건전한 대리인가?

**순서에 대해서는 건전하고(M4 재현), 권한에 대해서는 아니다(M5).** `getCredentials` 미호출이 증명하는 것은
"자격증명 조회 *전에* 어떤 거부가 있었다"까지다. 그 거부가 (a) `requireAccess`인지 enabled 게이트인지, (b)
`AlbumDownload`인지 `AlbumRead`인지는 못 본다. (a)는 오늘 픽스처가 `enabledConfig`라 우연히 접근 제어이고, (b)는
`access.ts:166-173`·`:211-218`이 같은 호출이라 mock으로 구별 불가다. 유일한 구별점은 `access.ts:40`의 문장이며
그것을 단언하면(C1) 둘 다 닫힌다 — M8로 확인.

### 4. 두 가드가 같은 예외 타입인 곳에 남은 타입 전용 단언

`grep toBeInstanceOf|rejects.toBeDefined` 9곳을 메서드 가드 사슬과 대조했다.

| spec | 메서드 · 가드 | 판단 |
|---|---|---|
| `:879` | `setFolderId:591-598` — 가드 1개(`updated === 0`) | 같은 타입 가드가 없어 무해. 문장 단언이면 더 좋다 |
| `:1027` | `subscribeAlbum` — enabled·access·credentials 3개 | **C1** |
| `:1193` | `getStorage:801-804` — 첫 가드, 앞에 다른 BadRequest 없음 | wave8b M4(resolve로 죽음)로 건전 |
| `:1206` | `getStorage` invalid_grant | `deleteCredentials` 목격자 → 건전 |
| `:1281` | `resumeUploads:1624-1626` — 가드 1개 | `clearErrors` 목격자. **기본 설정이 꺼져 있어서** 통과하지만 그것이 이 테스트의 의도다 |
| `:1322` | `getPickerConfig:896-898` apiKey — 뒤에 `:901` not-connected 같은 타입 | `getCredentials` 미호출 목격자가 두 가드를 **구별한다** → 건전 |
| `:1347` | `getPickerConfig` invalid_grant | `deleteCredentials` 목격자 → 건전 |
| `:1619` | `syncAlbum` — enabled·access·not-found·isSubscribed **4개 전부 BadRequest** | **N1** |

`uploadAsset`의 `rejects.toThrow()`(`:734` 등 5곳)는 워커 경로라 이번 질문 범위 밖이고, 각각 에러 테이블 기록을
단언하므로 공허하지 않다.

## What I did not verify

- **medium 스위트(실 DB).** `docker info` exit 1. 이번 커밋은 리포지토리·스키마·SQL을 건드리지 않고 `tsc`가
  medium 스펙까지 타입검사하므로 사정권 밖으로 본다.
- **런북 정리 절차의 실행.** 실행하지 않았다(사용자가 `.env`에 시크릿을 넣어야 한다). 리포트도 같은 입장이다.
- **랩탑 `docker exec … env` 결과 0의 해석.** `2>/dev/null`이라 exec 실패도 0으로 보일 수 있다 — 다만
  `docker ps`로 `immich_server`가 떠 있음을 함께 확인했으므로 exec는 성공했을 가능성이 높다.
- **svelte-check.** 웹 코드 변경이 없고 증거 파일이 회귀 없음을 기록한다.
- `git status --porcelain` — 종료 시 **이 리뷰 파일 하나만** 나온다. 변이 대상 서비스·스펙 파일은 매번
  `git checkout --`으로 복원했고 md5로 확인했다.

## Feeding back into the plan

`dev-docs/google-drive/wave6-plan.md`(또는 테스트 관례를 적는 곳)에 넣을 것:

1. **`requireAccess` 거부는 문장으로 단언한다.** `Not found or no <permission> access`가 mock 수준에서 권한을
   구별하는 유일한 신호다 — `AlbumRead`와 `AlbumDownload`는 `access.ts`에서 같은 두 호출이라 spy 패턴으로는
   같다. `rejects.toBeDefined()`는 이 목적에 쓰지 않는다(C1·C2).
2. **사용자 발 세 경로(`subscribeAlbum`/`syncAlbum`/`resumeUploads`)의 테스트 묶음은 게이트 + 권한 + 연결 셋이다.**
   게이트는 이번에 셋 다 갖췄고, 권한은 `subscribeAlbum`만(그것도 C1 상태), `syncAlbum`은 없다.
3. **런북 §8 정리 절차의 기전 세 줄**: `updateConfig`는 defaults의 키만 걷는다 → `set`은 row 값 전체 교체 →
   그래서 defaults에 없는 키(`enabled`)는 어떤 저장에서도 살아남지 못한다. 다음 사람이 §Answers 1을 다시
   파지 않도록.
4. `GET /api/system-config/defaults`는 **평문 시크릿을 돌려준다** — 런북에서 그 엔드포인트를 가리킬 때는 항상
   `len()`/해시 파이프를 같이 적는다(N3).

---

**VERDICT: NOT BLOCKED** — C1 (`subscribeAlbum` 권한 테스트가 download/read를 구별 못 함, 스펙 `:1027` 한 줄),
C2 (`syncAlbum` 권한 테스트 부재), N1 (`syncAlbum:1619` 4연속 같은 타입 가드에 클래스 단언), N2 (`system-config.service.spec.ts:548-554`
admin-UI 문구 잔여), N3 (defaults 엔드포인트의 평문·권한·`env_file` 주의). 운영 코드 결함 없음.
