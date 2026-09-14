# Code Review — 관리자 설정 표면 제거 · `enabled` 플래그 폐지 (`f4a6e2906`)

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `a0cdc42de` |
| Commits reviewed | `f4a6e2906`, `a0cdc42de` (`git log --oneline 44c38c445..a0cdc42de` = 2, 그중 `a0cdc42de`는 리포트 + 증거 파일) |
| Report | `../report/google-drive-wave8-config-surface-20260914-2240-report.md` |
| Prior review | `./google-drive-wave7-settings-cards-20260908-2215-review.md` |
| Reviewed | 2026-09-14 (모든 수치는 이 워크트리 HEAD에서 직접 돌린 것) |

## Verdict

**배포 판정: 막지 않는다 (NOT BLOCKED).** 리포트가 가장 검토를 구한 두 판단은 **둘 다 맞다**.
`SystemConfigGoogleDriveSchema`를 남긴 이유는 추측이 아니라 실측으로 확인된다 — 루트 스키마에서
`googleDrive: SystemConfigGoogleDriveSchema`(`system-config.dto.ts:432`) 한 줄만 지우면
`buildConfig`이 `result.data`를 반환하므로(`utils/config.ts:116`) `config.googleDrive`가 `undefined`가
되고, `server.service.spec.ts:174`가 `TypeError: Cannot read properties of unde…`로 죽는다(M6).
마이그레이션을 만들지 않은 것도 옳다. 다만 **리포트가 든 근거보다 더 강한 근거가 있다**:
`updateConfig`는 `getKeysDeep(defaults)`만 순회하므로(`utils/misc.ts:59-79`) 실효값을 **절대**
바꾸지 못한다 — 기본값과 같으면 버리고 다르면 유지한다. 그래서 남겨둔 partial은 위험하지 않고,
게다가 관리자가 **아무 설정 섹션이나 한 번 저장하면 orphan `googleDrive.enabled`는 저절로 사라진다**
(실증: 저장된 row에 그 키를 넣고 저장시키면 `systemMetadata.set`에 `{}`가 간다). "배포 후 수동 정리"는
필요조건이 아니다.

**가장 중요한 문제는 문서화된 kill switch가 운영 인스턴스에서는 동작하지 않는다는 것이다(N1).**
커밋 메시지와 리포트는 "끄는 방법은 `.env`의 client id를 비우고 재시작"이라고 못박지만, `buildConfig`은
저장된 partial을 defaults **위에** 덮는다(`utils/config.ts:83-87`). 운영 row가 `googleDrive.clientId`를
들고 있으면 env를 비워도 기능은 켜진 채다. 그리고 **그 row를 화면에서 지울 수단이 이번 커밋으로
사라졌다** — `enabled` 토글과 `SettingButtonsRow keys={['googleDrive']}`가 함께 삭제됐다. 운영
인스턴스가 그 상태일 가능성은 추정이 아니라 이력으로 뒷받침된다: env 자격증명은 Wave 6
(`1f00f78e2`, 2026-08-30)에 들어왔고 **배포본은 Wave 5**(2026-08-27, `906ebe959`가 기록)다. 즉 지금
운영 row를 쓴 빌드는 `defaults.googleDrive.*`가 전부 `''`이던 빌드이고, 관리자가 폼에 입력한 네 값은
전부 row에 있다. 이것은 데이터 위험이 아니라 **롤백 수단의 후퇴**이므로 배포를 막지는 않지만, 배포와
같은 세션에서 런북을 고쳐야 한다.

### Evidence I ran myself

전부 이 워크트리 HEAD(`a0cdc42de`)에서 돌렸다. `run.sh`는 **일부러 쓰지 않았다** — `results/`에 새
파일을 남겨 "리뷰 파일 하나만 쓴다"는 계약을 깨기 때문이다. 대신 `run.sh`가 부르는 명령을 그대로 재현했다.
변이는 전부 줄 번호로 `sed` 치환한 뒤 매번 `git checkout --`으로 복원했고, 복원마다 `git status`가
0줄임을 확인했다(`server/src/utils/misc.ts` md5 `af1f3f6e…`가 최초/최종 동일).

| Check | Result |
|---|---|
| server unit — `run.sh`의 8스펙 | `Test Files 8 passed / Tests 278 passed (278)` — **리포트 278과 일치** |
| server unit — 전체 (`--config test/vitest.config.mjs`) | `Test Files 94 passed / Tests 2388 passed \| 2 skipped (2390)` — **리포트 2,388/2와 일치** |
| web unit — `run.sh`의 5스펙 | `Test Files 5 passed / Tests 45 passed (45)` — **리포트 45와 일치** |
| web unit — 전체 | `Test Files 58 passed \| 1 skipped / Tests 563 passed \| 2 skipped (565)` — **리포트 563/2와 일치** |
| `svelte-check --output machine` (web 전체) | 오류 파일 3개 · 총 7건이 `svelte-check-baseline.txt`와 **정확히 일치** (회귀 0) |
| server `npx tsc --noEmit -p tsconfig.json` | exit 0. `include`가 `["src","test"]`이므로 **medium 스펙까지 타입 검사됨** |
| server `npx eslint "src/**/*.ts" "test/**/*.ts" --max-warnings 0` | exit 0 |
| web `npx eslint src/routes/admin/system-settings/+page.svelte` | exit 0 (직전 라운드에서 크래시하던 룰이 이번엔 정상) |
| `i18n/en.json` 정렬 · prettier | 1,722키 · admin 447키, 대소문자 무시 사전순 위반 0, `prettier --check` 통과 |
| 생성물 정합 | `SystemConfigGoogleDriveDto`가 OpenAPI·TS SDK·Dart에서 모두 4필드(`enabled` 없음). 재생성이 실제로 돌았다 |
| 제거된 i18n 키 잔존 참조 | `google_drive_settings`/`_enabled`/`_client_id`/`_client_secret`/`_api_key`/`_redirect_url`/`_env_default_description` → `web/src`·`mobile/lib`·다른 89개 로케일에서 **0건** |
| `enabled`를 읽는 프로덕션 코드 | **0건**. `googleDrive.enabled`는 스펙 3곳(주석·업그레이드 테스트·잔여 fixture)에만 남음 |
| 웹 분기 경로 | 전부 `featureFlagsManager.value.googleDrive` (`+layout.svelte:273`, `UserSettingsList.svelte:143`, 앨범 `+page.svelte:676`, `QueuePanel.svelte:94`) → `server.service.ts:122`의 `isGoogleDriveEnabled` 하나로 수렴 |
| `git merge-base --is-ancestor v3.1.0 HEAD` | ancestor 맞음 (업스트림 다운그레이드 아님) |
| server medium (실 DB) | **돌리지 못했다** — `docker info` exit 1(이 WSL에도 Docker 미가동). §"검증하지 못한 것" 참고 |
| 첨부 증거 `results/20260914-2238.txt` | `commit: f4a6e2906`, **dirty 마커 없음**, 278 / 45 / svelte-check 회귀 없음, `RESULT: PASS` — 주장대로 |
| `git status --porcelain` (종료 시) | **이 리뷰 파일 하나뿐** |

**변이 전수.** R은 리포트 §5가 주장한 3종, M은 내가 추가한 것. 무변이 기준은 8스펙 `278 passed`.

| # | 변이 (파일:줄) | 방향 | 결과 | 죽은 테스트 |
|---|---|---|---|---|
| R1 | `utils/misc.ts:151`에 `false &&` 삽입 | 판정을 항상 거짓으로 | `Test Files 5 failed \| 3 passed` / **`Tests 41 failed \| 237 passed`** | 41건. **리포트의 "5 failed"는 테스트 수가 아니라 파일 수다 — §N5** |
| R2 | 〃 `!!googleDrive.clientSecret &&` 제거 | 시크릿 없이도 켜짐 | `1 failed \| 277 passed` | `should be disabled when 'clientSecret' is missing…` ✔ 리포트대로 |
| R3 | `config.ts:366` → `redirectUrl: ""` | 새 env 변수를 무시 | `1 failed \| 277 passed` | `should take the redirect URL from the environment` ✔ 리포트대로 |
| M4 | `utils/misc.ts:151`에 `!!(googleDrive as unknown as {enabled?:boolean}).enabled &&` 복원 | **`enabled`를 다시 읽는 회귀** | 3 failed | `system-config.service.spec.ts` 업그레이드 테스트 ✔ + `misc.spec.ts` `should ignore a stale enabled flag` ✔ + `should be enabled with credentials and a derivable redirect URL` |
| M5 | `utils/config.ts:116` → `const config = rawConfig as SystemConfig;` | zod strip을 끔 | `3 failed \| 29 passed` | 업그레이드 테스트의 `toEqual`이 **죽는다** → 그 단언은 공허하지 않다 |
| M6 | `system-config.dto.ts:432` 삭제 (`googleDrive` 섹션 제거) | 리포트 §3의 두 번째 주장 재현 | `2 files / 10 failed` | `TypeError: Cannot read properties of unde…` — **주장 그대로** |
| M7 | `server.service.ts:122` → `googleDrive: true` | 기능 플래그를 항상 켬 | `2 failed \| 14 passed` | `should respond the server features`, `should not report Google Drive as available when no redirect URL can be derived` ✔ |
| M8 | `google-drive.service.ts:1507-1509` 삭제 (`syncAlbum` 게이트) | 게이트 자체를 제거 | **`95 passed`** | **없음 — §N4** |
| M9 | 〃 `:1622-1624` 삭제 (`resumeUploads` 게이트) | 〃 | `1 failed \| 94 passed` | `resumeUploads > should reject when the feature is disabled` ✔ |
| M10 | `config.ts:366` → `|| 'https://my.immich.app/…'` | 그럴듯하지만 틀린 폴백 | `1 failed \| 46 passed` | `should leave the redirect URL empty when the environment does not set it` ✔ |
| M11 | `google-drive.service.spec.ts:87` 삭제 (`enabled: true`) | 잔여 fixture 키 제거 | `95 passed` | 없음 — 그 키는 무력하다(§N6) |
| M12 | `system-config.service.spec.ts:539`의 mock을 `{googleDrive:{enabled:false}}`로 | **orphan 키가 저장 시 살아남는지** | `1 passed` (`set(…, {})`) | — orphan 키는 **다음 설정 저장에서 자동 소멸**한다 |

## Findings

### N1 — 문서화된 kill switch가 이 배포에서는 동작하지 않는다 (심각도: 중, 비차단, 런북 수정 필요)

커밋 메시지: *"The kill switch becomes blanking the client id and restarting"*. 리포트 §1도 같다.
코드를 따라가면 이렇다.

1. `config.ts:365` `clientId: process.env.IMMICH_GOOGLE_DRIVE_CLIENT_ID || ''` → env를 비우면 default가 `''`.
2. `utils/config.ts:83-87` — `rawConfig = _.cloneDeep(defaults)` 뒤 저장된 partial의 **모든 leaf가
   defaults를 덮는다**. row에 `googleDrive.clientId`가 있으면 row가 이긴다.
3. → `isGoogleDriveEnabled`는 계속 참. **재시작해도 안 꺼진다.**

운영 row가 그 상태일 근거: `git log -S"IMMICH_GOOGLE_DRIVE_CLIENT_ID" -- server/src`는
`1f00f78e2`(2026-08-30, Wave 6)가 최초다. 그런데 배포본은 Wave 5(2026-08-27)다. 즉 지금 운영 row를 쓴
빌드에서는 네 필드의 default가 전부 `''`였고, `updateConfig`의 "기본값과 다르면 저장" 규칙에 따라
관리자가 입력한 clientId·clientSecret·redirectUrl·apiKey가 **전부 row에 들어갔다**. `CLAUDE.md`의
현재 상태 기록(`googleDrive.redirectUrl = http://localhost:2283/...`)이 그 row가 비어 있지 않다는 것을
직접 확인해 준다.

이번 커밋이 `enabled` 토글과 함께 `SettingButtonsRow keys={['googleDrive']}`(구
`44c38c445:web/src/routes/admin/system-settings/GoogleDriveSettings.svelte:80`)를 지웠으므로, **row의 googleDrive 키를 UI에서 지우는 정규 경로가
없어졌다.** 남은 것은 (a) 관리 화면의 config JSON **Upload**(`web/src/lib/services/system-config.service.ts:66`
→ `handleSystemConfigSave` → `updateConfig`의 diff 재작성), (b) DB 직접 수정, (c) 이미지 롤백이다.

**고치는 법 (코드 변경 아님, 문구·런북).**
- 커밋 메시지/리포트의 "client id를 비우고 재시작"에 **"저장된 partial에 그 키가 없을 때만"**을 붙인다.
- 배포 전 체크리스트에 **값이 아니라 키 이름만** 보는 조회를 넣는다 (§1의 "존재 여부만" 규칙 준수):
  ```bash
  ssh 랩탑 'docker exec -i immich_postgres psql -U postgres -d immich' <<'SQL'
  select jsonb_object_keys(value::jsonb -> 'googleDrive')
  from system_metadata where key = 'system-config';
SQL
  ```
  `clientId`가 나오면 env kill switch는 무력하다.
- 되돌릴 필요가 생기면 **이미지 롤백이 유일하게 확실한 수단**임을 배포 노트에 적는다.

### N2 — 없어진 화면을 가리키는 에러 메시지와, 거짓이 된 주석 (심각도: 낮음, 사용자 가시)

- `server/src/services/google-drive.service.ts:163`
  ``…missing ${missing.join(', ')}. Set these under Administration → Settings → Google Drive.``
  → 그 섹션은 이번 커밋이 삭제했다. 자격증명이 불완전할 때 사용자/관리자가 보는 **유일한 진단 문구**가
  존재하지 않는 화면으로 안내한다.
- 같은 파일 `:156` `['redirect URL (set it, or set the server External Domain)', redirectUrl]` — 새로 생긴
  `IMMICH_GOOGLE_DRIVE_REDIRECT_URL`을 모른다. 리뷰 요청 3번 항목("redirect URL이 config row나
  externalDomain에서만 온다고 가정하는 곳")의 **정확한 답이 여기다.** 동작은 옳고(값은 이미 env에서 옴)
  안내만 낡았다.
- 같은 파일 `:136` *"use the `enabled` toggle to turn the feature off instead"* — 토글이 없다.
- `server/src/utils/misc.ts:143-148` JSDoc이 *"needs both an explicit opt-in **and** a complete OAuth
  client — an admin who flips the switch on…"*를 그대로 유지한다. 이 함수의 계약이 바뀐 커밋인데
  계약을 설명하는 주석이 안 바뀌었다.
- `server/src/services/album.service.ts:301` *"switched on **and** fully configured"* — 같은 문제. 단
  **선존재**이고(`git show 44c38c445:…`에 동일) 이번 커밋이 건드리지 않았다.

**고치는 법.** `:163`을 `Set IMMICH_GOOGLE_DRIVE_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URL in the
server environment.` 류로 바꾸고, `:156`의 라벨에 env 변수명을 넣고, `:136`·`misc.ts:143-148`을
새 규칙으로 다시 쓴다.

### N3 — "env로 완결"인데 env를 설명하는 곳이 저장소에 없다 (심각도: 낮음, 운영)

`IMMICH_GOOGLE_DRIVE_*`는 `docker/example.env`·`docker/docker-compose*.yml`·`.devcontainer/`·
`docs/docs/install/environment-variables.md` **어디에도 없다**(각각 grep 0건). 관리 폼이 있을 때는
그 폼이 "이 값들이 존재한다"는 사실과 **도착 여부**를 동시에 보여줬다(`google_drive_env_default_description`이
"Provided by the server environment"라고 알려줬다). 이제 둘 다 없다.

부작용이 하나 더 있다. 리포트 §6이 "배포 전 필수 조건"으로 요구하는
`IMMICH_GOOGLE_DRIVE_REDIRECT_URL`은 **row가 이기기 때문에 배포 시점에 검증할 수 없다** — 오타가 나도
아무 증상이 없고, 나중에 row를 정리하는 순간 기능이 죽는다.

**고치는 법.** 관측점은 이미 있다. `GET /api/system-config/defaults`
(`system-config.controller.ts:29`, `getConfigDefaults`)가 **env에서 만든 defaults를 그대로** 돌려주므로,
배포 직후 `.googleDrive.redirectUrl`을 읽으면 env가 도착했는지 확인된다. 이걸 `CLAUDE.md` §7 배포
순서의 5번(`/api/server/features` 확인) 옆에 나란히 적는다. 여력이 되면 `docker/example.env`에
**주석 처리된 이름만**(값 금지) 넣어 발견 가능성을 되살리는 것도 방법이다.

### N4 — `syncAlbum`의 enabled 게이트는 테스트가 붙들지 않는다 (심각도: 낮음, 선존재)

`google-drive.service.ts:1507-1509`를 통째로 지워도 `google-drive.service.spec.ts` **95개가 전부
통과한다**(M8). 리포트가 새 의미론("disabled = 자격증명 없음")의 증거로 지목한 바로 그 테스트
(`:1567 should reject when the feature is disabled`)가 **다른 이유로 통과**하기 때문이다:
`clientId: ''`만 바꾸고 access mock은 기본값(거부)이라, 게이트가 없어도 곧이어
`requireAccess`(`utils/access.ts:40`)가 `BadRequestException('Not found or no album.download access')`를
던진다. 단언이 `rejects.toBeInstanceOf(BadRequestException)`뿐이라 구별하지 못한다.

**선존재임을 확인했다** — 부모 커밋(`44c38c445`)의 파일들을 꺼내 같은 줄을 지우고 돌려도 `95 passed`다.
이번 커밋이 만든 결함은 아니지만, **이번 커밋이 그 테스트를 직접 고쳤고 리포트가 인용했으므로** 지금
같이 조인다. 대조군: `resumeUploads`의 같은 게이트는 제대로 붙들려 있다(M9, 1 failed).

**고치는 법 (한 줄).** 단언을 메시지까지 못박는다.
```ts
await expect(sut.syncAlbum(...)).rejects.toThrow(/not enabled on this server/);
```
(또는 `mocks.access.album.checkDownloadAccess.mockResolvedValue(new Set([albumId]))`로 접근을 열어
게이트만 남긴다.)

### N5 — 리포트 §5 변이표의 단위가 섞여 있다 (심각도: 낮음, 정확성)

"판정을 `false`로 강제 → 5 failed"는 **테스트 파일 5개**이고 실제 죽는 테스트는 **41개**다
(`Test Files 5 failed | 3 passed`, `Tests 41 failed | 237 passed`). 나머지 두 줄은 파일 1 / 테스트 1이라
같은 숫자여서 차이가 드러나지 않는다. 결론(변이가 잡힌다)은 옳지만, "이 HEAD에서 돌린 수치"를 인용하는
표라면 단위를 고정해야 한다.

### N6 — 잔여물 두 개 (nitpick)

- `server/src/services/google-drive.service.spec.ts:87`에 `enabled: true`가 남아 있다. 다른 스펙
  (`server.service.spec.ts`, `misc.spec.ts`, `system-config.service.spec.ts`)에서는 전부 지웠다.
  이 키는 `buildConfig`의 zod strip에 걸려 **무력**하다(M11: 지워도 95 passed). 지우는 게 맞다 —
  남겨두면 다음 사람에게 "이 축이 아직 있다"고 거짓말한다.
- `i18n/en.json:1186`의 `google_drive_folder_current`는 참조 0건이다. 단 **선존재**다
  (`git grep 44c38c445`로 확인 — 부모에서도 참조 0건). 이번 제거와 무관하지만, i18n을 만지는 김에
  치우면 좋다.

### N7 — `CLAUDE.md` 런북이 없어진 화면을 전제한다 (심각도: 낮음, 다음 세션이 밟을 지뢰)

이번 두 커밋은 `CLAUDE.md`를 건드리지 않았다. 지금 상태에서 틀린 곳:

| 줄 | 내용 | 왜 틀렸나 |
|---|---|---|
| `383` | `` `isGoogleDriveEnabled`(`utils/misc.ts:150-154`) `` | 이제 150-151. 152-154는 빈 줄과 `isConnectionAborted` |
| `384` | "관리자 폼의 '비워두면 External Domain을 쓴다'를 따라 `redirectUrl`을 지우는 것이…" | 그 폼이 없다. 이제 그 상태를 만드는 방법은 env 미설정 + row 정리다 |
| `529` | "끄려면 `enabled` 토글을 쓴다" | 토글이 없다. §N1 참고 — 대체 수단이 자명하지 않다 |
| `578-579` | "`utils/misc.ts:150-154`… 관리자 폼의 설명(`i18n/en.json:94`)" | `en.json:94`는 지금 `image_prefer_embedded_preview_setting_description`(무관한 키) |

배포 순서 1번("redirect 파생이 살아 있는지 확정한다 — 유일한 하드 게이트")은 **여전히 유효하고 여전히
유일한 하드 게이트**다. 다만 그것을 깨뜨리는 방법으로 적힌 시나리오(폼에서 지우기)가 사라졌으므로,
새 시나리오(env 미설정 + row 정리)로 교체해야 한다.

## Answers to what the report asked me to attack

### 1. 이 규칙 변경이 의도치 않게 기능을 켜는 설치가 있는가

**켜진다 — 정의상.** `enabled: false` + 자격증명 + 파생 가능한 redirect를 가진 설치는 이 업그레이드로
**켜진다.** 하지만 이 포크에서 그런 설치는 존재하기 어렵다:

- 저장소 어디에도 `IMMICH_GOOGLE_DRIVE_*`를 공급하는 곳이 없다(N3). `docker/`·`.devcontainer/` 전부
  0건 → **개발 스택은 자격증명이 없어 계속 꺼져 있다.** 데스크탑 dev container가 갑자기 Drive에
  붙는 일은 없다.
- 운영 인스턴스는 `CLAUDE.md` 기록상 이미 `enabled = true`다. **무변화.**
- 이 기능은 포크 전용이라 제3자 설치가 없다.

한 가지만 짚는다. 기능이 켜지면 `featureFlagsManager.value.googleDrive`가 참이 되어 **모든 사용자**의
설정 화면에 "Connect to Google Drive"가 나타난다(`UserSettingsList.svelte:143`). 가족 계정이 웹에
들어오면 보인다는 뜻이다. 연결은 여전히 사용자별 opt-in이고 아무것도 자동으로 올라가지 않으므로
위험은 아니지만, 사장님이 "가족은 이 기능을 안 쓴다"고 적어둔 것과는 화면상 어긋난다.

**진짜 문제는 "켜지는 쪽"이 아니라 "끄는 쪽"이다** — §N1.

### 2-a. 마이그레이션 없이 partial을 남긴 판단

**맞다. 그리고 리포트가 든 근거보다 더 강한 근거가 있다.**

리포트는 "partial이 env를 이겨서 no-op"이라고만 말한다. 실제로는 그보다 강하게, **`updateConfig`가
실효값을 바꿀 수 없다**는 성질이 있다(`utils/config.ts:45-58`): 새 값이 기본값과 같으면 저장을 건너뛰고
(→ 기본값이 같은 값을 공급), 다르면 저장한다(→ row가 계속 이긴다). 어느 쪽이든 **실효값은 동일**하다.
따라서 partial을 남기는 것이 사고를 일으킬 경로가 없다.

"마이그레이션이 위험했다"도 맞다. `googleDrive.redirectUrl`을 지우면서 env를 안 넣은 설치는 그 즉시
`isGoogleDriveEnabled`가 거짓이 되어 **에러 없이** 꺼진다 — 이 기능이 두 번 겪은 실패 모드 그대로다.

**다만 리포트의 "정리는 배포 후 수동" 표현은 과하다.** orphan `googleDrive.enabled`는
`getKeysDeep(defaults)`(`utils/misc.ts:59-79`)에 없으므로 `updateConfig`가 새 partial에 **복사하지
않는다**. 실측: 저장된 row에 `{googleDrive:{enabled:false}}`를 두고 아무 설정이나 저장시키면
`systemMetadata.set`에 `{}`가 간다(M12). 즉 **관리자가 아무 섹션이나 한 번 저장하면 키는 자동으로
사라지고**, "Unknown keys found" 경고도 그때 멈춘다. DB 수술은 필요 없다.

### 2-b. partial을 남기면 "env로 완결"이 거짓이 되는가 — 새 설치엔 참, 기존 설치엔 거짓인 상태가 수용 가능한가

**수용 가능하다. 단 리포트가 생각하는 것보다 기존 설치 쪽 거짓의 범위가 넓다.**

리포트는 "redirect URL은 DB 행에서, 자격증명은 env에서" 온다고 쓴다. **운영 인스턴스에서는 자격증명도
row에서 올 가능성이 매우 높다** — env 자격증명은 Wave 6(`1f00f78e2`)이고 배포본은 Wave 5다(§N1).
그러면 이 배포는 여전히 no-op이지만(좋다), "기존 설치는 redirect 하나만 row에 남았다"는 그림은 틀리고,
그 틀린 그림 위에 세워진 kill switch 설명도 틀린다.

수용 가능하다고 보는 이유는 두 상태가 **수렴하기 때문**이다: env를 전부 채운 뒤 설정을 한 번
저장하거나 config JSON을 round-trip하면 row의 googleDrive 키는 기본값과 같아져 **전부 떨어져 나가고**,
그 시점부터 기존 설치도 "env로 완결"이 된다. 다만 그 순서를 지켜야 한다 — **env를 확인하기 전에 row를
정리하면 기능이 죽는다.** 이것이 배포 노트에 들어가야 할 한 문장이다.

### 2-c. `SystemConfigGoogleDriveSchema`를 남긴 근거

**정확하다. 실측으로 재현했다(M6).** `system-config.dto.ts:432` 한 줄을 지우면:

- `SystemConfigSchema`는 평범한 `z.object()`다(`:428-454`, `.strict()`·`.passthrough()` 없음) → 모르는
  키를 벗겨낸다.
- `buildConfig`은 성공 시 **파싱 결과**를 돌려준다: `const config = (result.success ? result.data :
  rawConfig) as SystemConfig` (`utils/config.ts:116`).
- 결과: `config.googleDrive === undefined`인데 타입은 멀쩡. `server.service.spec.ts:174`가
  `TypeError: Cannot read properties of unde…`로 실패하고, 두 스펙에서 10개가 죽는다.

리포트가 "설계 검토가 제기했고 내가 직접 확인했다"고 한 그대로다. `SystemConfig`이 손으로 쓴 타입
(`config.ts:119-127`)이라 컴파일러가 이 구멍을 못 잡는다는 것도 맞다.

### 3. 새 env 변수와, redirect URL의 출처를 아직 좁게 가정하는 곳

`IMMICH_GOOGLE_DRIVE_REDIRECT_URL`의 배선 자체는 옳다. `config.ts:366`이 default로 읽고,
`getGoogleDriveRedirectUrl`(`misc.ts:126-138`)의 우선순위는 **partial/env로 온 `redirectUrl` → 없으면
`externalDomain` 파생 → 없으면 `''`**이며, `https://my.immich.app` 폴백을 만들지 않는 결정도 그대로다
(M10으로 그 폴백을 넣으면 테스트가 잡는다).

**아직 좁게 가정하는 곳은 문구 하나다** — `google-drive.service.ts:156`의
`'redirect URL (set it, or set the server External Domain)'`. 새 env 변수를 모른다. §N2에 넣었다.
그 외에 `redirectUrl`을 읽는 코드는 `misc.ts:130-131`(우선순위 본체)과
`google-drive.service.ts:147`(호출)뿐이고, 웹·모바일·e2e에는 참조가 없다.

### 4. 테스트 — 변이표 재확인과, `as never`를 쓴 업그레이드 테스트

**변이표는 방향으로는 전부 맞고, 첫 줄의 숫자 단위가 틀렸다**(§N5, 41 tests / 5 files).

새 업그레이드 테스트(`system-config.service.spec.ts:304-325`)는 **주장하는 것을 실제로 시험한다.**
두 단언이 각각 다른 변이에 죽는다:

- `expect(config.googleDrive).toEqual({...})` — M5(`buildConfig`이 strip을 멈춤)에서 죽는다. 즉 "저장된
  `enabled`가 실제로 벗겨진다"를 붙들고 있지, mock이 undefined를 돌려줘서 통과하는 게 아니다.
- `expect(isGoogleDriveEnabled(...)).toBe(true)` — M4(게이트가 `enabled`를 다시 읽음)에서 죽는다.
  strip 뒤 `enabled`가 `undefined`가 되므로 게이트가 그 값을 보기만 하면 거짓이 된다.

`as never` 두 개는 **가리는 게 없다.**
- `mockResolvedValue({...} as never)` — 저장된 row는 타입 없는 JSON이고 `enabled`는 타입에서 사라졌으니,
  재현하려는 상황을 표현하는 유일한 방법이다. 캐스트가 없으면 컴파일이 안 된다.
- `{ externalDomain: 'https://immich.example.com' } as never` — `isGoogleDriveEnabled`가 읽는
  `server` 필드가 그것뿐이라 부분 객체로 충분하다. 오타를 내면 `getGoogleDriveRedirectUrl`의
  `server.externalDomain.replace(...)`가 `undefined`에서 터져 테스트가 **실패**하므로 조용히 통과할 수
  없다.

공허한 테스트는 **다른 곳**에서 찾았다 — `syncAlbum`의 게이트(§N4, 선존재).

### 5. 제거가 남긴 것

- **dead i18n**: 제거된 7개 admin 키에 대한 잔존 참조 0건, 다른 89개 로케일에도 없음, 정렬·prettier 통과.
  `google_drive_folder_current` 하나가 미사용이지만 **선존재**(§N6).
- **dead imports**: `+page.svelte`에서 컴포넌트와 `mdiGoogleDrive` 모두 제거됨. eslint exit 0,
  svelte-check 회귀 0. 관리자 전용 스펙 파일은 애초에 없었으므로 고아 스펙도 없다.
  `systemConfigManager.defaultValue`는 업스트림 공용이라 여전히 쓰인다.
- **stale comments**: §N2에 4곳.
- **runbook**: §N7에 `CLAUDE.md` 4곳.

## What I did not verify

- **medium 스위트.** 이 워크트리에서도 `docker info`가 exit 1이다(Docker Desktop 미가동). **리포트의
  "사정권 밖"이라는 판단은 맞다고 본다**: `git diff --name-only 44c38c445..a0cdc42de -- 'server/src/repositories/*'
  'server/src/schema/*' 'server/src/queries/*' 'server/test/medium/*'`가 **0줄**이고, 유일한 medium 스펙
  (`test/medium/specs/repositories/google-drive.repository.spec.ts`)은 `SystemConfig`을 아예 참조하지
  않는다(grep 0건). 게다가 `server/tsconfig.json`의 `include`가 `["src","test"]`라 **medium 스펙도
  `tsc --noEmit`에 포함**되며 exit 0이다 — 타입 수준의 파급은 없다. 다만 "돌려서 초록을 봤다"고는 말할
  수 없다.
- **운영 DB의 실제 row 내용.** §N1의 "row가 clientId를 들고 있다"는 **이력에 근거한 강한 추정**이지
  관측이 아니다. 운영 DB를 조회하지 않았다(리뷰 세션이고, §1의 덤프 금지도 있다). 위에 적은
  `jsonb_object_keys` 조회로 **값 없이** 확정할 수 있다.
- **랩탑 `.env`에 `IMMICH_GOOGLE_DRIVE_*`가 실제로 있는지.** `CLAUDE.md` §7은 있다고 적지만 Wave 6은
  배포된 적이 없다. 확인하지 않았다.
- **브라우저 화면.** 관리 → 설정에서 항목이 사라진 모습, 그리고 남은 사용자 설정 카드가 정상인지는
  눈으로 보지 않았다(svelte-check + 45개 웹 유닛까지만).
- **`mise //server:ci-unit` / `//web:ci-unit` 전체 파이프라인.** 구성 명령(vitest·tsc·eslint·prettier)은
  개별로 돌려 전부 통과했지만 mise 태스크 자체는 돌리지 않았다.
- **CI 실행 결과.** 이 환경에 `gh`가 없다.

## Feeding back into the plan

`dev-docs/google-drive/`(그리고 `CLAUDE.md` §7 배포 순서)에 남길 것.

1. **"끄는 방법"을 다시 쓴다.** `.env`의 client id 비우기는 **저장된 partial에 그 키가 없을 때만**
   동작한다. 배포 전 `jsonb_object_keys(value::jsonb -> 'googleDrive')`로 키 이름만 확인하고, 확실한
   되돌리기는 **이미지 롤백**임을 적는다. (§N1)
2. **row 정리는 env 확인 뒤에.** 순서가 의미를 가진다: ① `.env`에 네 값이 다 있는지 →
   ② `GET /api/system-config/defaults`로 도착 확인 → ③ 그 다음에야 row 정리. 반대로 하면 기능이 죽는다.
   그리고 정리는 DB 수술이 아니라 **관리 화면에서 아무 설정이나 한 번 저장**하는 것으로 끝난다
   (`updateConfig`가 partial을 defaults 키 기준으로 재작성한다). (§2-b, M12)
3. **`updateConfig`는 실효값을 바꿀 수 없다**는 성질을 명시적으로 기록한다 — 기본값과 같으면 버리고
   다르면 유지. 이것이 "partial을 남겨도 안전한" 진짜 이유이고, 앞으로 같은 종류의 판단이 올 때마다
   다시 유도하지 않아도 되게 한다.
4. **관측점 목록을 한 곳에 모은다.** 기능 on/off = `GET /api/server/features`의 `googleDrive`,
   env 도착 여부 = `GET /api/system-config/defaults`의 `googleDrive.*`, 실효값 = `GET /api/system-config`.
   관리 폼이 사라진 지금 이 셋이 유일한 창이다. (§N3)
5. **`CLAUDE.md` 383-384 · 529 · 578-579를 고친다.** 없어진 폼과 토글을 전제한 문장이고, 줄 번호 인용
   두 개도 어긋났다(`misc.ts:150-154` → 150-151, `i18n/en.json:94` → 무관한 키). (§N7)
6. **`syncAlbum`의 게이트 테스트를 메시지까지 못박는다** — 이 저장소가 반복해서 밟는 "의도한 이유로
   통과하는가" 항목이고, 지금 통과 이유는 `requireAccess`다. (§N4)
7. **변이표에는 단위를 적는다** (`Test Files N / Tests M`). 이번 표의 첫 줄이 5와 41을 같은 칸에 넣었다.
   (§N5)

---

*확인: 이 세션이 이 워크트리에 남긴 변경은 `git status --porcelain` 기준 **이 리뷰 파일 하나뿐**이다.
변이 실험에 쓴 6개 소스 파일은 매번 `git checkout --`으로 복원했고 최종 상태가 0줄임을 확인했다.*
