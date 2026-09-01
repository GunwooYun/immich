# Wave 6 — 설정 없는 연결, 파생 redirect URL, picker 게이팅

Wave 5를 배포하고 **실제로 쓰기 시작하자** 드러난 두 가지 마찰을 없앤다. 기능 자체가 아니라
"쓸 수 있게 만드는 데 드는 비용"에 대한 웨이브다.

## 1. 왜

### 문제 A — 설정할 게 너무 많다

관리자가 4개 필드(clientId, clientSecret, redirectUrl, apiKey)를 손으로 채워야 기능이 켜졌다.
사용자의 지적: *"다른 모바일 앱은 구글 로그인하고 승인만 하면 드라이브에 접근되는데, 우리는 너무
복잡하다."*

그 앱들이 단순한 이유는 마법이 아니라 **자격증명이 앱에 내장돼 있기 때문**이다. clientId/secret은
**앱(이 배포본)의 신원**이지 사용자 계정이 아니다 — 내장해도 각 사용자는 여전히 자기 구글 계정으로
로그인해 자기 Drive에 연결한다. 셀프호스트라 공용 자격증명을 배포할 수는 없지만, **이 배포본의
운영자**는 자기 것을 한 번 넣어둘 수 있다.

### 문제 B — redirect URL이 구글 정책과 충돌한다

운영 immich는 `http://192.168.50.211:2283`(사설 IP)인데 Google은 redirect URI로 **localhost 또는
공개 HTTPS만** 허용한다. 사설 IP는 등록 자체가 거부된다. 그래서 지금까지는 redirectUrl을
localhost로 두고 **SSH 터널**로 브라우저를 붙여 연결했다 — 나 혼자는 되지만 **가족 구성원은
사실상 연결 불가**였다.

여기에 더해 OAuth state 쿠키가 origin에 묶여 있어(`@Authenticated()` 콜백 + HttpOnly state 쿠키)
**연결 시작과 콜백이 같은 origin**이어야 한다. 즉 "연결하는 순간만" 다른 주소를 쓰는 우회는 불가능
하고, 그 origin이 구글이 받아주는 주소여야 한다.

## 2. 결정

### D1. 자격증명은 `config.ts`의 **defaults**로 (서비스 fallback 아님)

`IMMICH_GOOGLE_DRIVE_CLIENT_ID` / `_CLIENT_SECRET` / `_API_KEY`.

선례가 이미 있다 — `machineLearning`이 `process.env.IMMICH_MACHINE_LEARNING_*`을 defaults에서
직접 읽는다(`config.ts`). `EnvSchema`는 건드리지 않는다(같은 선례).

**과거에 이걸 거부했던 주석이 `getOAuth2Client`에 있었고, 이번에 다시 썼다.** 당시 반대 이유는
정당했지만 *지금 하는 것*에는 해당하지 않는다:

| 당시 문제 (서비스 안에서 ad-hoc `process.env` 읽기) | 지금 (config 레이어 defaults) |
|---|---|
| `'YOUR_CLIENT_ID'` 같은 placeholder fallback → 조용히 실패 | placeholder 없음, 빈 값이면 게이트가 기능을 끔 |
| 흩어진 읽기, 문서화·타입·검증 없음 | 병합 지점 하나, 기존 config 파이프라인 |
| 관리자가 UI에서 지워도 env가 몰래 override | **저장된 값이 defaults 위에 병합되므로 UI가 이김** |
| 관리자가 유효값을 볼 수 없음 | `/system-config/defaults`로 노출 → UI가 "환경이 제공함" 표시 |

**env 값이 DB에 고착되지 않는 이유(핵심, 코드로 검증):** `updateConfig`(utils/config.ts)는 제출된
config를 `defaults`와 diff해서 **비었거나 같은 값은 저장하지 않는다.** env 값이 곧 defaults이므로:
- 폼을 그대로 저장 → `googleDrive` 키가 partial에 안 들어감 → env 변경이 계속 반영됨
- 필드를 비우고 저장 → isEmpty로 생략 → env 기본값 복귀
- 다른 값을 입력하고 저장 → partial에 들어가 override

**수용한 트레이드오프:** env가 값을 제공하는 필드를 UI에서 "빈 값으로 강제"할 수는 없다. 기능을
끄려면 `enabled` 토글을 쓴다. (테스트로 고정: system-config.service.spec.ts)

### D2. redirect URL은 `externalDomain`에서 파생

값이 **항상** `<origin>/api/google-drive/callback`이라 관리자가 타이핑할 이유가 없었다. 한 글자만
틀려도 구글이 아무 단서 없는 에러로 거절한다는 점에서 위험한 잡일이었다.

`server.externalDomain`은 이미 그 origin을 담고 있고(부트스트랩에서 origin으로 정규화), 이 기능이
콜백 후 브라우저를 UI로 되돌릴 때 **이미 쓰고 있던 값**이다.

- `redirectUrl` 필드는 **override로 존속** — dev container처럼 API origin(:2283)과 웹(:3000)이
  다를 때 필요하다.
- **`getExternalDomain()`의 `https://my.immich.app` 폴백은 쓰지 않는다.** 그럴듯하지만 틀린
  redirect URI는 구글의 불투명한 에러를 낳고, 빈 값은 "무엇을 설정하라"는 메시지와 함께 기능을
  꺼둔다. **꺼진 게 미묘하게 망가진 것보다 낫다.**
- `isGoogleDriveEnabled`가 `(googleDrive, server)`를 받도록 바뀌었다 — 파생 가능하면 설정된 것으로
  친다. 그래야 "env 자격증명 + externalDomain만 있고 폼은 손도 안 댄" 상태가 정상 동작한다.

### D3. `pickerAvailable`을 status에 실어 보낸다

기존 결함: apiKey가 없어도 "폴더 선택" 버튼이 그려지고 **누를 때만** 에러 토스트가 떴다. 웹은
apiKey 설정 여부를 알 방법이 없었기 때문이다.

기존 `GET /google-drive/status`에 boolean 하나(`!!apiKey`)를 추가한다. 새 엔드포인트를 만들지
않은 이유: 설정 페이지가 이미 로드 시 이 엔드포인트를 부른다 — 버튼 하나 그릴지 말지 때문에 왕복을
더 하는 건 더 나쁘다. `getPickerConfig`의 서버측 가드는 그대로 둔다(권위 있는 검사).

### D4. admin UI는 숨기지 않고 **표시**한다

`systemConfigManager.defaultValue`(= `/system-config/defaults`)에 env 값이 실리므로 새 API 없이
"환경이 제공함"을 알 수 있다. 필드는 계속 보이고(override 가능) 힌트만 붙는다.

**수용:** env clientSecret이 admin에게 노출된다 — upstream `oauth.clientSecret`과 같은 클래스다.

## 3. 인프라 — Tailscale HTTPS (문제 B의 답)

랩탑에 이미 Tailscale이 돌고 있다(`ha-server.tail68cec7.ts.net`). Tailscale은 `*.ts.net` 공개
HTTPS(자동 인증서)를 주므로 **구글이 받아주는 주소**가 생긴다.

```
폰 immich 앱  ──────→ http://192.168.50.211:2283   (그대로, LAN)
Drive 연결 브라우저 ─→ https://ha-server.tail68cec7.ts.net  (OAuth만)
서버 → Google 업로드 ─→ 랩탑이 직접 (주소 무관)
```

**모바일 앱 엔드포인트는 바꾸지 않는다.** 둘은 공존한다 — serve는 기존 :2283 위에 HTTPS 입구를
*추가*하는 것이지 대체가 아니다. 연결이 끝나면 업로드는 서버가 알아서 하므로 평소 사용은 LAN 주소
그대로다.

**trust proxy는 이미 정상**(코드 검증): `app.set('trust proxy', ['loopback', ...trustedProxies])`,
기본 `['linklocal','uniquelocal']` → tailscale serve의 `X-Forwarded-Proto: https`로
`request.secure=true` → state 쿠키에 Secure가 붙는다.

### 운영 체크리스트

1. **Tailscale admin 콘솔 → HTTPS Certificates 켜기** (현재 `CertDomains: None`)
2. serve 설정: `docker inspect tailscale`로 network mode 확인 → 대상 결정(host면
   `http://127.0.0.1:2283`) → `tailscale serve --bg <target>` → tailnet 기기에서
   `https://ha-server.tail68cec7.ts.net/api/server/ping` (첫 요청은 인증서 발급으로 ~1분)
3. 랩탑 `~/immich-app/.env`에 `IMMICH_GOOGLE_DRIVE_CLIENT_ID/_CLIENT_SECRET/_API_KEY` 추가
   (**값은 커밋 금지** — §1) → compose가 immich-server에 전달하는지 확인 → **컨테이너 재생성**
   (env는 프로세스 시작 시 평가되므로 restart로는 부족)
4. admin 설정: `externalDomain = https://ha-server.tail68cec7.ts.net`,
   **Google Drive Redirect URL 필드를 비우고 저장**(파생 시작). clientId 등 DB 값은 지워도(env
   복귀) 둬도(같은 값 override) 무방
5. **Google Cloud Console**: redirect URI에
   `https://ha-server.tail68cec7.ts.net/api/google-drive/callback` 추가(**기존 localhost는 dev용
   유지**), API 키에 referrer 제한이 있으면 tailnet origin 추가, 가족 계정을 **Test users**에 추가
6. 확인: tailnet 기기 브라우저 → tailscale 주소로 로그인 → 연결 → **콜백까지 같은 origin에서**
   완료

### 리스크

- **externalDomain 부수효과**: 공유 링크·알림 메일·콜백 bounce의 절대 URL이 tailnet 주소가 된다
  (비-tailnet에서 접근 불가). 가족 기기에 Tailscale을 깔면 해소되고, 아니면 수용한다 — LAN 사용
  자체는 계속 된다.
- **Google "Testing" 상태**: Test users만 연결 가능(최대 100명). `drive.file`은 비민감 scope라
  7일 refresh token 만료 대상이 아닌 것으로 알려져 있고, 현 배포가 그 증거다. 재연결 요구가
  반복되면 Production(unverified) 전환을 검토한다.

## 4. 검증

- 기능 스위트: 서버 **238** / 웹 29 / medium 10 / svelte-check 회귀 0 **PASS**
  (`dev-test/google-drive/results/20260902-0746.txt` — 커밋 `936efa611`, **코드를 포함한** 커밋에서
  생성. 첫 첨부본은 부모 커밋을 찍고 있었다 → §6 M2)
- 전체 회귀: 서버 2347 pass(2 skip), 웹 547 pass(2 skip). tsc·eslint clean.
- 생성물: `mise run //:open-api` 재생성(status DTO 변경 → SDK에 `pickerAvailable` 반영 확인).
  **스키마 무변경** → `//:sql`·마이그레이션 드리프트 검사 불필요.
- 새 테스트: env 기본값(stubEnv + resetModules + dynamic import), DB-over-env 우선순위,
  **no-freeze 회귀**(defaults와 같은 config 저장 시 partial에 googleDrive 없음), 파생 URL 4종
  (override/파생/trailing slash/둘 다 빔), 게이트 공허통과 가드(§4 — 실패 이유까지 단언),
  getAuthUrl이 파생 URL로 클라이언트를 만드는지, pickerAvailable true/false.

## 5. 미검증 (배포 후)

- Tailscale HTTPS 경로 실동작(인증서 발급, serve 프록시, Secure 쿠키)
- 가족 계정으로의 실제 연결 플로우
- Wave 5부터 이월된 항목: 브라우저 4개 시각 상태, 실 BullMQ 큐 e2e

---

## 6. 리뷰 되먹임 (2026-08-30, `google-drive-wave6-impl-...-review.md`)

판정: **세 변경 모두 타당, 공격 요청한 5개 주장 모두 성립.** no-freeze 경로 없음, 네 번째
`isGoogleDriveEnabled` 경로 없음, 게이트 테스트 비공허, 시크릿 노출은 upstream과 동일 클래스
(두 엔드포인트가 **같은 가드**를 쓴다는 것까지 확인). 지적 2건 반영:

### M1 — env가 제공하는 자격증명은 UI에서 **지울 수 없다** (반영: 문서화 + 테스트 고정)

no-freeze 분석이 놓친 **반대 방향**. `updateConfig`가 `isEmpty`를 `isEqual`보다 **먼저** 보므로,
관리자가 필드를 비우고 저장하면 아무것도 저장되지 않고 → 저장된 값이 없으니 → 실효값이 defaults,
즉 **env 값으로 되돌아간다**. 저장은 성공했다고 나오는데 편집은 조용히 버려진다.

Wave 6 이전엔 defaults가 `''`라 지우기가 실제로 동작했으므로 **이번 웨이브가 만든 동작 변화**다.

**선택: 고치지 않고 정직하게 말한다.** 대안은 "의도적으로 빔"을 뜻하는 sentinel이 필요한데,
`''`는 다른 모든 config 키에서 이미 "미설정"을 뜻한다 — 두 번째 빈 값을 발명하는 게 제약보다
나쁘다. 필드를 read-only로 만드는 것도 검토했으나 D4의 "override는 가능해야 한다"를 깬다
(**다른 값 입력은 정상 동작한다** — 지우기만 안 되는 것).
→ 힌트 문구가 "지워도 안 없어지고 환경으로 되돌아간다, 환경에서 바꿔라"라고 말하도록 수정.
→ `system-config.service.spec.ts`에 세 번째 방향 테스트 추가(비우고 저장 → `{}` 저장됨).

**stale-form 경쟁 상태(코드 아님, 기록만):** 관리자 브라우저가 값 X를 들고 있는 사이 운영자가
env를 Y로 바꾸고 재시작 → 관리자가 낡은 폼을 저장하면 X ≠ defaults(Y)이므로 X가 **실제로 고착**된다.
세 조건이 겹쳐야 해서 방어하지 않지만, no-freeze가 배제한다고 한 그 고착이 일어날 수 있는 유일한 형태.

### M2 — 첨부한 테스트 증거가 코드보다 앞섬 (반영: 재생성)

`results/20260830-0835.txt`가 `906ebe959`(Wave 6 커밋의 **부모**)를 찍고 있었다. 미커밋 워킹트리로
돌린 결과라 §2가 증거를 요구하는 이유("N개 통과라고 쓰기만 하면 리뷰어가 검증할 수 없다")를 정확히
위반. 게다가 `run.sh`에 spec 2개를 추가해 숫자도 208 → **237**로 바뀌었다.
→ 코드가 포함된 커밋에서 재생성.

### 리뷰가 밝혀준 사실 (되먹임)

- **`config.spec.ts`의 진짜 가드는 "환경이 설정 안 했을 때 빈 값" 테스트**다. 첫 번째 테스트는
  `resetModules` 없이도 통과한다(먼저 실행돼 자기 stub으로 fresh import). 반직관적이라 주석으로 명시.
- **externalDomain 두 형태가 파생을 통과한다** — 둘 다 upstream `buildConfig` 동작이지만 파생이
  새로 의존하게 된 것:
  ① **subpath**(`https://host/immich`) → `.origin`이 경로를 버려 콜백에서 `/immich`가 빠짐.
  **`redirectUrl` override가 답** → 필드 설명에 명시함.
  ② **자격증명 포함 URL**(`http://user:pass@host`) → `buildConfig`가 그대로 두어 redirect URI에
  비밀번호가 들어간다. 말도 안 되는 설정이고 upstream 몫이라 코드 변경 없음, 기록만.
- **`/system-config/defaults`가 처음으로 시크릿을 담게 됐다.** 가드가 `/system-config`과 동일
  (`SystemConfigRead` + `admin: true`)하고 redaction 레이어는 애초에 없으므로 **노출 클래스는 불변**.
  다만 "defaults는 정적 상수라 로깅·캐싱해도 안전"이라는 추론은 **이제 틀리다**.
- 대문자 호스트는 `.origin`이 소문자로 정규화하므로 방어적 `replace`가 못 잡는 부분까지 커버됨.
