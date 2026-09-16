# Code Review — wave8 리뷰 반영: 설정이 실제로 어디서 오는지 (`0d0d42a83`, `28401f8fb`)

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `22fd909e6` |
| Commits reviewed | `0d0d42a83`, `28401f8fb` (`git log --oneline a0cdc42de..22fd909e6` = 4, 그중 `45c344392`는 범위 밖 doc 한 줄, `22fd909e6`는 리포트 + 증거 파일) |
| Report | `../report/google-drive-wave8b-config-truth-20260916-2120-report.md` |
| Prior review | `./google-drive-wave8-config-surface-20260914-2240-review.md` |
| Reviewed | 2026-09-16 (모든 수치는 이 워크트리 HEAD에서 직접 돌린 것) |

## Verdict

**배포 판정: 막지 않는다 (NOT BLOCKED).** 두 커밋은 코드 동작을 바꾸지 않는다 — 바뀐 것은 문자열·주석·
`example.env`·런북·테스트 단언 하나이고, 서버 2,388 / 웹 563 / 기능 스위트 278·45가 리포트 수치 그대로
재현된다. 리포트가 가장 공격해 달라고 한 §2의 런북 문장은 **참이지만, 말하지 않은 조건이 둘 있다**(C1).
(1) 관리 화면은 **편집한 섹션만이 아니라 GET으로 받은 전체 실효 설정을 그대로 실어 보내므로**
`googleDrive`는 항상 요청 본문에 들어간다 — 리포트의 첫 번째 우려("편집한 섹션만 보낸다면 거짓")는
기우다. (2) 그러나 웹 헬퍼 `handleSystemConfigSave`는 저장할 섹션이 서버 값과 같으면 **요청 자체를
보내지 않는다**(`web/src/lib/services/system-config.service.ts:52-54`). "아무 설정이나 한 번 저장"을
값을 바꾸지 않은 채 누르면 아무 일도 일어나지 않는다. (3) "같은 값"은 **네 키 전부**여야 한다 —
`apiKey`까지 포함해서. 하나라도 다르면 그 키만 row에 남고 나머지는 사라진다(throwaway 스펙 D·E).
세 조건 모두 **실패 방향이 "아무것도 안 됨"이라 위험하지는 않다** — 그래서 차단하지 않는다. 다만 런북은
"저장하면 사라진다"가 아니라 "값을 바꿔 저장하면, 네 키가 전부 같을 때, 사라진다"로 고쳐야 한다.

부수 발견: `syncAlbum`과 같은 `enabled` 게이트가 `subscribeAlbum`에도 있는데(`google-drive.service.ts:1440-1442`)
**그 게이트를 지워도 95개가 전부 통과한다**(M2). 리포트가 물은 "같은 타입 가드가 연달아 있어 테스트가
공허한 패턴"은 다른 메서드에서는 재발하지 않았지만(M3~M5 전부 잡힘), 이 게이트는 공허한 게 아니라
**테스트가 아예 없다**(C2). 바뀐 에러 문자열은 예상대로 아무 테스트도 붙들지 않는다(C3, M6·M7).

### Evidence I ran myself

전부 이 워크트리 HEAD(`22fd909e6`)에서 돌렸다. `run.sh`는 **일부러 쓰지 않았다** — `results/`에 파일을
남겨 "리뷰 파일 하나만 쓴다"는 계약을 깨기 때문이다. `run.sh`가 부르는 명령을 그대로 재현했다. 변이는
전부 줄 번호로 `sed`한 뒤 매번 `git checkout --`으로 복원했고, `google-drive.service.ts`의 md5
`ccbcd45c…`가 최초/최종 동일함을 확인했다. §2용 throwaway 스펙 두 개는 실행 후 삭제했다.

| Check | Result |
|---|---|
| server unit — `run.sh`의 8스펙 | `Test Files 8 passed / Tests 278 passed (278)` — **리포트 278과 일치** |
| server unit — 전체 (`--config test/vitest.config.mjs`) | `Test Files 94 passed / Tests 2388 passed \| 2 skipped (2390)` — **리포트 2,388/2와 일치** |
| web unit — 전체 | `Test Files 58 passed \| 1 skipped / Tests 563 passed \| 2 skipped (565)` — **리포트 563과 일치** |
| `google-drive.service.spec.ts` 단독 | `95 passed` (변이 기준선) |
| server `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| server `npx eslint` (바뀐 3파일, `--max-warnings 0`) | exit 0 |
| `git merge-base --is-ancestor v3.1.0 HEAD` | ancestor 맞음 |
| 첨부 증거 `results/20260916-2117.txt` | `commit: 45c344392`, **dirty 마커 없음**, 278 / 45 / svelte-check 회귀 없음, `RESULT: PASS` — 주장대로. (`28401f8fb`가 커밋한 것은 `20260914-2307.txt`이고 `20260916-2117.txt`는 리포트 커밋 `22fd909e6`에 들어 있다 — 둘 다 존재) |
| `IMMICH_GOOGLE_DRIVE_` 문서화 위치 | `docker/example.env`에만 있음(리포트 §4대로). compose·devcontainer·`docs/docs/install/`은 여전히 0건 |
| server medium (실 DB) | **돌리지 못했다** — `docker info` exit 1. 이 WSL에도 Docker 없음 |
| `git status --porcelain` (종료 시) | **이 리뷰 파일 하나뿐** (아래 §"What I did not verify" 끝에 명시) |

**변이 전수.** 대상 파일 `server/src/services/google-drive.service.ts`, 스펙 `google-drive.service.spec.ts`(기준선 95).

| # | 변이 (줄) | 방향 | 결과 | 판단 |
|---|---|---|---|---|
| M1 | `:1509-1511` 삭제 — `syncAlbum` enabled 게이트 | 게이트 제거 | **`1 failed \| 94 passed`** — `syncAlbum > should reject when the feature is disabled` | **리포트 §5 주장 그대로.** 직전 리뷰 M8(95 passed)이 이제 잡힌다 |
| M2 | `:1440-1442` 삭제 — `subscribeAlbum` enabled 게이트 | 게이트 제거 | **`95 passed`** | **테스트 없음 → C2** |
| M3 | `:901-903` 삭제 — `getPickerConfig` credentials 가드 | 가드 제거 | `1 failed` — 단, 실패 원인이 `expected TypeError: Cannot read properties of unde… to be an instance of BadRequestException` | 잡히긴 하는데 **우연이다**: 다음 줄 `credentials.refreshToken`의 TypeError가 클래스 단언에 안 맞아서. 가드 아래가 바뀌면 사라지는 방어 → N1 |
| M4 | `:802-804` 삭제 — `getStorage` credentials 가드 | 가드 제거 | `1 failed` — `promise resolved "{ limitBytes: … }" instead of rejecting` | 제대로 붙들려 있다 |
| M5 | `:1528-1530` 삭제 — `syncAlbum` isSubscribed 가드 | 가드 제거 | `1 failed` — `should reject an album the caller has not chosen to back up` | 제대로 붙들려 있다(`queueAll` 목격자) |
| M6 | `:165` 에러 문자열을 옛 `Set these under Administration → Settings → Google Drive.`로 되돌림 | 회귀 재현 | **`95 passed`** | **아무 테스트도 없음 → C3** |
| M7 | `:158` 라벨에서 `IMMICH_GOOGLE_DRIVE_REDIRECT_URL`만 제거(`set it, or the server External Domain`) | 새 env 이름 누락 | **`95 passed`** | `:267`의 `/redirect URL.*External Domain/i`는 옛 문구에도 매치 → C3 |

**§2용 throwaway 스펙(삭제함).** 서버 `server/src/zz-review-config-truth.spec.ts` 5케이스, 웹
`web/src/lib/services/zz-review-config-truth.spec.ts` 2케이스. 결과는 §"Answers"의 §2에 표로 있다.

## Findings

### C1 — 런북 §8 "정리 방법" 문장은 참이지만 조건 둘을 빠뜨렸다 (심각도: 중, 비차단, 문구 수정 필요)

`CLAUDE.md:533-535`:
> **정리 방법**: env가 row와 같은 값을 갖게 한 뒤 관리 화면에서 아무 설정이나 한 번 저장하면 된다 —
> `updateConfig`는 defaults와 같은 값을 저장에서 빼므로 googleDrive partial이 통째로 사라진다.

코드 경로는 이렇다(전부 실측, 아래 §Answers §2 표 참고).

1. **웹이 보내는 본문.** `SystemConfigButtonRow.svelte:39` `handleSystemConfigSave(pick(configToEdit, keys))`
   → `system-config.service.ts:49-50` `const config = await getConfig(); const systemConfigDto = { ...config, ...update }`.
   즉 **GET `/api/system-config`의 전체 실효 설정** 위에 편집 섹션만 덮은 것이 본문이다. `googleDrive`는
   항상 실린다(웹 throwaway 1: `updateConfig`가 `{trash: {days: 31}, googleDrive: {row 4키}}`로 호출됨).
   `getSystemConfig`→`mapConfig`는 identity(`system-config.dto.ts:462-464`)라 `clientSecret`도 그대로 나간다.
   GET 단계에서 zod가 `enabled` 같은 미지 키를 벗겨내므로(`utils/config.ts:103,116`) 본문에는 4키만 있다.
2. **서버 diff.** `updateSystemConfig`(`system-config.service.ts:59-79`)는 `ConfigValidate` 이벤트 뒤 그대로
   `updateConfig`(`utils/config.ts:44-64`)로 넘긴다. 거기서 `getKeysDeep(defaults)`를 돌며 `isEmpty || isEqual`이면
   버린다. `defaults`는 모듈 로드 시 env로 만든 값(`config.ts:359-367`)이다.
3. **그래서 저장되는 `googleDrive` 키는** — 본문의 값이 **row의 값**이므로 — *row 값 ≠ env 값*인 키만이다.

   | 케이스 | env | 저장되는 `googleDrive` | 결론 |
   |---|---|---|---|
   | A | 네 키 모두 row와 같음 | **없음** (`set(…, { trash: { days: 31 } })`) | 런북 문장 참 |
   | B | 비어 있음 | `{clientId, clientSecret, redirectUrl, apiKey}` = row 4키 (`enabled`는 사라짐) | 리포트 세 번째 우려 그대로 — 무해 |
   | C | 네 키 모두 row와 다름 | row 4키 그대로. **env 값은 어디에도 안 들어간다** | 무해 |
   | D | 3키 같고 `redirectUrl`만 다름 | `{ redirectUrl: row값 }` | **부분 정리** — 런북이 말하지 않음 |
   | E | 3키 같고 env에 `apiKey` 없음(row엔 있음) | `{ apiKey: row값 }` | **`apiKey`도 맞춰야 한다** — 런북이 말하지 않음 |

4. **빠진 조건 하나 더.** `system-config.service.ts:52-54`
   ```ts
   if (isEqual(config, systemConfigDto)) {
     return;
   }
   ```
   저장할 섹션이 서버 값과 같으면 **요청이 나가지 않는다**(웹 throwaway 2: `getConfig` 1회 호출, `updateConfig`
   0회). "아무 설정이나 한 번 저장"을 값 변경 없이 누르면 토스트도, 쓰기도 없다.

**판정: "참이지만 조건을 말하지 않는다."** 실패 방향은 전부 "row가 그대로 남음"이라 기능이 죽지는 않는다 —
그래서 차단이 아니다. 다만 운영자가 "저장했는데 왜 키가 남아 있지?"에서 헤매지 않으려면 문구를 이렇게 바꾼다:

> **정리 방법**: 랩탑 `.env`의 `IMMICH_GOOGLE_DRIVE_CLIENT_ID`/`_CLIENT_SECRET`/`_REDIRECT_URL`/`_API_KEY`
> **네 개 전부**를 row와 같은 문자열로 맞추고 재시작한 뒤(`GET /api/system-config/defaults`의 `googleDrive`로
> env가 컨테이너에 도착했는지 먼저 본다), 관리 화면에서 **아무 섹션의 값 하나를 실제로 바꿔** 저장한다(바꾸지
> 않은 저장은 웹이 요청을 보내지 않는다 — `handleSystemConfigSave`의 `isEqual` 게이트). 관리 화면은 편집한
> 섹션만이 아니라 실효 설정 전체를 보내므로 `googleDrive`도 diff에 들어가고, `updateConfig`가 defaults(=env)와
> 같은 키를 저장에서 빼서 partial이 사라진다. **env와 다른 키는 그 키만 남는다** — 정리 뒤 아래 키 이름
> 조회로 `googleDrive` 키가 0개인지 확인한다. 바꾼 값은 다시 되돌려 한 번 더 저장해도 된다(두 번째 저장도
> `googleDrive`를 안 쓴다).

### C2 — `subscribeAlbum`의 enabled 게이트에는 테스트가 없다 (심각도: 낮음, 선존재)

`google-drive.service.ts:1440-1442`를 지워도 `95 passed`(M2). `describe('album subscriptions')`(spec `:941-1030`)의
네 테스트는 전부 `googleDrive: enabledConfig`로 시작한다 — "꺼져 있을 때 거부"는 없다. `syncAlbum`(N4→이번
수정)·`resumeUploads`(직전 M9)와 같은 게이트, 같은 문자열, 같은 사용자 발 경로인데 셋 중 하나만 비어 있다.
리포트 §5가 물은 "같은 예외 타입 가드가 연달아 있는 곳"이 정확히 여기다: `:1440` enabled → `:1443` requireAccess →
`:1446` credentials, 셋 다 `BadRequestException`. 다만 지금은 공허한 테스트가 아니라 **부재**다.

**고치는 법.** `syncAlbum`의 새 테스트(spec `:1567-1583`)를 그대로 옮긴다:
```ts
it('should reject when the feature is disabled', async () => {
  mocks.systemMetadata.get.mockResolvedValue({ googleDrive: { ...enabledConfig, clientId: '' } });
  await expect(sut.subscribeAlbum(AuthFactory.create(UserFactory.create()), 'album-1'))
    .rejects.toThrow('Google Drive sync is not enabled on this server');
  expect(mocks.access.album.checkOwnerAccess).not.toHaveBeenCalled(); // stopped before access control
  expect(mocks.googleDrive.subscribe).not.toHaveBeenCalled();
});
```

### C3 — 바뀐 사용자 가시 문자열을 붙드는 테스트가 없다 (심각도: 낮음, 리포트 §3이 물은 것)

M6(에러 문장을 옛 화면 안내로 되돌림)·M7(라벨에서 env 이름 제거) 둘 다 `95 passed`. `grep`으로도
`Set the IMMICH_GOOGLE_DRIVE`·`not configured: missing`을 단언하는 스펙은 0건. 유일하게 이 throw를 지나는
테스트 `:267 rejects.toThrow(/redirect URL.*External Domain/i)`는 옛 문구·새 문구 모두에 매치한다.

**고치는 법 (스펙 두 줄).** `:267`의 정규식을 `/IMMICH_GOOGLE_DRIVE_REDIRECT_URL.*External Domain/`로 조이고,
같은 테스트에 `.rejects.toThrow(/Set the IMMICH_GOOGLE_DRIVE_\* variables/)`를 하나 더 둔다. 그러면 M6·M7이
각각 1 failed가 된다. 문자열 회귀를 막는 것이 목적이므로 클래스가 아니라 **문장**을 단언해야 한다.

### N1 — `getPickerConfig` "not connected" 테스트는 우연히 잡는다 (nitpick, 선존재)

spec `:1307` `rejects.toBeInstanceOf(BadRequestException)`. M3에서 가드를 지우면 실패하긴 하는데, 이유가
`credentials.refreshToken`의 **TypeError가 BadRequestException이 아니어서**다. 가드 아래 코드가 optional
chaining 하나로 바뀌면 통과해 버린다. `.rejects.toThrow('Google Drive is not connected')`로 바꾸면 의도한
이유로 통과한다. `getStorage :1170`은 반대로 제대로 붙들려 있다(M4 — resolve로 죽음).

### N2 — 없어진 폼·토글을 전제하는 주석이 아직 남아 있다 (nitpick)

이번 커밋이 `misc.ts` JSDoc과 `getOAuth2Client` 주석을 고쳤지만 같은 종류가 더 있다:

| 위치 | 내용 | 왜 틀렸나 |
|---|---|---|
| `server/src/config.spec.ts:127-129` | *"Clearing the field in the admin UI cannot remove an env-supplied credential; `enabled: false` is the control that turns the feature off."* | 필드도 토글도 없다. **이 테스트가 이번 라운드가 기대는 `updateConfig` 규칙을 핀하는 바로 그 테스트**라 특히 어긋난다 |
| `server/src/config.spec.ts:13` | *"a value saved in the admin UI still wins"* | 저장할 UI가 없다. "저장된 partial이 이긴다"로 |
| `server/src/services/system-config.service.spec.ts:535-536` | *"the admin form shows them pre-filled — and if saving the untouched form wrote them…"* | 폼이 없다. 이제 이 테스트가 지키는 것은 **C1의 정리 경로**다 — 그렇게 적으면 다음 사람이 §2를 다시 안 판다 |
| `server/src/services/album.service.ts:302` | *"switched on \*and\* fully configured"* | 직전 리뷰 N2에서 지적, 미반영(선존재) |
| `server/src/services/google-drive.service.spec.ts:87` | `enabled: true` fixture 잔여 | 직전 리뷰 N6, 미반영. 무력하지만 "이 축이 있다"고 거짓말한다 |

### N3 — 직전 N3의 "env 도착 확인" 관측점이 런북에 안 들어갔다 (nitpick, 운영)

`grep -n "system-config/defaults\|getConfigDefaults" CLAUDE.md` 0건. C1의 정리 경로는 **env가 컨테이너에 실제로
도착했을 때만** 케이스 A가 된다 — 도착 안 하면 케이스 B(무해, 그러나 "왜 안 지워지지?"). 확인 명령 한 줄이면
된다(값이 아니라 **키 존재·길이**만 보는 §1 규칙 유지):
```bash
curl -s -H "x-api-key: …" http://192.168.50.211:2283/api/system-config/defaults \
  | python3 -c 'import json,sys; g=json.load(sys.stdin)["googleDrive"]; print({k: len(v) for k,v in g.items()})'
```

## Answers to what the report asked me to attack

### §2 — 런북의 정리 방법은 참인가?

**참이지만, 말하지 않은 조건 아래에서만.** 순서대로:

1. **웹이 다른 섹션을 저장할 때 `googleDrive`를 보내는가 — 보낸다.** `SystemConfigButtonRow.svelte:39`가
   `pick(configToEdit, keys)`(편집 섹션만)를 넘기지만 `handleSystemConfigSave`(`system-config.service.ts:47-64`)가
   `getConfig()`로 전체 실효 설정을 다시 받아 그 위에 덮은 뒤 **전체를** `updateConfig`에 보낸다. 웹 throwaway 1이
   본문 `{trash:{…,days:31}, googleDrive:{clientId:'row-id', clientSecret:'row-secret', redirectUrl:'http://x', apiKey:'row-key'}}`를
   확인했다. `GoogleDriveSettings.svelte`가 사라진 것과 무관하다 — 그 컴포넌트는 애초에 `keys={['googleDrive']}`로
   *자기 섹션을 편집*하는 수단이었지, 본문에 싣는 조건이 아니었다. 리포트의 첫 우려는 기우다.
2. **어떤 `googleDrive` 키가 저장되는가.** 서버 throwaway(5케이스 전부 통과, 위 C1 표). env = row(4키 전부) → **없음**;
   env 비움 → **row 4키 그대로**(`enabled`는 GET의 zod strip으로 본문에서 이미 빠져 어떤 케이스에서도 안 남는다);
   env ≠ row → **row 4키 그대로**, env 값은 안 섞인다. 추가로 **부분 일치는 부분 정리**(D·E).
3. **테스트로 증명했는가 — 했다.** 서버 5 + 웹 2, 전부 워크트리에서 실행 후 삭제. 서버 쪽은
   `config.spec.ts`와 같은 `vi.stubEnv` + `vi.resetModules()` + 동적 import 패턴으로 `defaults`를 env마다 다시
   만들었고, 각 케이스에 `defaults.googleDrive.clientId` 전제 단언을 두어 env가 실제로 `defaults`에 닿았음을 못박았다.
4. **판정과 정정 문구** — C1에 있다. 핵심 두 줄: *값을 실제로 바꿔* 저장해야 요청이 나간다(`isEqual` 게이트),
   그리고 *네 키 전부*(`apiKey` 포함)를 env에 맞춰야 partial이 통째로 사라진다. 어느 조건이 빠져도 결과는
   "row 유지"이지 "기능 정지"가 아니다.

### §3 — 바뀐 에러 문자열을 단언하는 테스트가 있는가?

**없다.** C3. M6·M7 둘 다 95 passed. 다음 사람이 옛 화면을 다시 가리켜도 아무것도 안 깨진다. 스펙 `:267`
두 줄로 막힌다.

### §5 — 같은 예외 타입 가드가 연달아 있고 테스트가 타입만 보는 패턴이 다른 메서드에도 있는가?

**공허한 테스트로는 재발하지 않는다. 대신 빈 자리가 하나 있다.** 클래스만 단언하는 8곳(spec `:875, :949, :1170,
:1183, :1258, :1299, :1307, :1322, :1594`)의 가드를 하나씩 지워 봤다(M2~M5, 직전 M9): `getStorage`·`syncAlbum`
isSubscribed·`resumeUploads`는 목격자(`queueAll`/`clearErrors` 미호출, resolve)로 제대로 잡히고, `getPickerConfig`
`:1307`은 잡히되 이유가 TypeError다(N1). 그리고 **`subscribeAlbum`의 enabled 게이트(`:1440-1442`)는 테스트가
없어서 지워도 95 passed**(C2). `syncAlbum`을 고친 방식(메시지 + `checkOwnerAccess` 미호출)을 그대로 옮기면 된다.

### §5 — `syncAlbum` 게이트 제거 시 정확히 하나만 실패하는가?

**맞다.** M1: `1 failed | 94 passed`, 죽는 테스트는 `syncAlbum > should reject when the feature is disabled` 하나.
직전 리뷰 M8(같은 줄 삭제 → 95 passed)이 이 커밋으로 잡히게 됐다.

## What I did not verify

- **medium 스위트(실 DB).** `docker info` exit 1 — 이 WSL에도 Docker가 없다. 직전 리뷰와 같은 근거로(이 두
  커밋은 리포지토리·스키마·마이그레이션·생성 SQL을 건드리지 않고, `tsc`가 medium 스펙까지 타입검사한다) 사정권
  밖이라고 본다.
- **운영 row의 실제 값이 env와 같은지.** 값을 볼 수 없고(§1) 보지 않았다. C1의 케이스 A/D/E 중 어디에 해당할지는
  정리 뒤 키 이름 조회로만 알 수 있다.
- **랩탑 compose가 `.env`의 `IMMICH_GOOGLE_DRIVE_*`를 컨테이너에 실제로 넘기는지**(`env_file`/`environment`).
  N3의 `defaults` 엔드포인트 확인이 이걸 대신한다.
- **바뀐 에러 문자열이 화면에 어떻게 보이는지** — 리포트 §8과 같다.
- `svelte-check`는 이번에 돌리지 않았다. 웹 코드 변경이 없고(두 커밋 모두 `web/` 미접촉) 리포트 증거 파일이 회귀
  없음을 기록한다.
- `git status --porcelain` — 종료 시 **이 리뷰 파일 하나만** 나온다. throwaway 스펙 두 개는 `rm`으로 지웠고
  변이 대상 파일은 md5로 원복을 확인했다.

## Feeding back into the plan

`dev-docs/google-drive/wave6-plan.md`(또는 설정 구조를 다루는 문서)에 넣을 것:

1. **관리 화면 저장의 본문은 언제나 실효 설정 전체다** (`handleSystemConfigSave`가 GET 후 덮어쓴다). 어떤
   섹션을 저장하든 `googleDrive`가 diff에 들어간다 — 이것이 "폼 없이도 row를 정리할 수 있다"의 근거이고,
   동시에 "row가 env와 다르면 매 저장마다 row 값이 다시 써진다"의 근거다.
2. **정리의 전제 셋**: env 네 키 전부 = row(`apiKey` 포함), env가 컨테이너에 도착(`/api/system-config/defaults`),
   그리고 **값을 실제로 바꾼 저장**(`isEqual` 게이트). 실패 방향은 전부 "row 유지"라 안전하다.
3. **사용자 발 세 경로(`subscribeAlbum`/`syncAlbum`/`resumeUploads`)의 enabled 게이트 테스트는 셋을 한 묶음으로
   유지한다** — 메시지 단언 + "권한 검사 전에 멈췄다" 목격자. 지금 `subscribeAlbum`만 없다(C2).
4. 사용자 가시 문자열은 **문장으로 단언**한다. 클래스 단언은 문구 회귀를 못 본다(C3).
5. `config.spec.ts:127-129`처럼 **폐지된 축(`enabled`)을 설명하는 주석이 핀 테스트에 남으면** 다음 리뷰가 또
   같은 곳을 판다. 주석은 "무엇을 지키는가"를 지금 규칙으로 다시 쓴다(N2).
