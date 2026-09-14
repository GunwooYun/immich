# 리뷰 요청 — 관리자 설정 표면 제거, `enabled` 플래그 폐지

| | |
|---|---|
| 브랜치 | `feat/google-drive-album-sync-v3.1.0` |
| HEAD | (이 리포트 커밋) |
| 리뷰 대상 커밋 | `f4a6e2906` + 이 리포트 |
| 직전 리뷰 | `../review/google-drive-wave7-settings-cards-20260908-2215-review.md` |
| 증거 | `dev-test/google-drive/results/20260914-2238.txt` — 커밋 `f4a6e2906`, dirty 표시 없음 |
| 작성 | 2026-09-14 22:40 |

## 테스트 결과 (첨부)

```
commit: f4a6e2906  (dirty marker 없음)
server (unit)              Tests 278 passed
web (unit)                 Tests  45 passed
web (svelte-check, gated)  no regressions vs baseline

RESULT: PASS
```

전체 스위트: `mise //server:ci-unit` **2,388 passed / 2 skipped**, exit 0.
`mise //web:ci-unit` **563 passed / 2 skipped**, exit 0.
OpenAPI · TS SDK · Dart SDK는 `git add` **전에** 재생성했다.

**⚠ medium 스위트는 돌리지 못했다** — 이 기계의 Docker Desktop이 내려가 있다(WSL 통합 없음,
`Could not find a working container runtime strategy`). 이번 변경은 리포지토리·스키마·마이그레이션·
생성 SQL을 **하나도 건드리지 않아**(`git show --stat`으로 확인) 그 스위트의 사정권 밖이라고 판단했다.
**이 판단이 맞는지 확인을 구한다.**

---

## 배경 — 사장님 요구

"관리 → 설정 → Google Drive 항목을 없애고 싶다. clientId·secret·redirect URL·API key를 어디에도
입력하고 싶지 않다." 자격증명은 Wave 6부터 이미 `IMMICH_GOOGLE_DRIVE_*`에서 왔고, 관리 폼은 그
위에 덧씌우는 잔여 통로였다. 막고 있던 것은 둘이다.

## 1. `enabled` 플래그를 숨기지 않고 **없앴다**

기본값이 `false`다. 토글만 지웠으면 **새 배포는 자격증명을 완비하고도 조용히 꺼진 채** 남고, 켤
수단이 화면에 없다. 이 포크가 두 번 겪은 최악의 실패 모드다.

```ts
// 전: enabled && clientId && clientSecret && redirectUrl파생가능
// 후:            clientId && clientSecret && redirectUrl파생가능
```

끄는 방법은 `.env`의 client id를 비우고 재시작이며, `/api/server/features`의 `googleDrive`로
결과가 관측된다.

**공격 요청**: 이 규칙 변경이 **의도치 않게 기능을 켜는** 설치가 있는가? 즉 자격증명이 env에 있는데
관리자가 일부러 `enabled: false`로 꺼 두었던 배포가 이 업그레이드로 **갑자기 켜지는** 시나리오.
(이 포크는 사용자가 한 명이라 실질 위험은 없다고 봤지만, 판단을 구한다.)

## 2. `IMMICH_GOOGLE_DRIVE_REDIRECT_URL` 추가

redirect URL만 env 변수가 없었다. 대안인 `server.externalDomain`은 쓸 수 없다 — 이 서버는 LAN
전용이고, 구글은 사설 IP를 redirect로 거부하며, 동작하는 URL은 localhost 터널이다. 게다가
`externalDomain`은 공유 링크와 이메일 템플릿에도 쓰이므로, 그걸 터널 origin으로 바꾸면 **무관한
기능을 망가뜨려 이 기능 하나를 고치는** 꼴이 된다.

## 3. 일부러 하지 않은 것 — 여기가 가장 검토가 필요하다

- **저장된 system-config partial을 지우는 마이그레이션을 만들지 않았다.** partial이 env를 이기는
  성질이 이번 배포를 **무변화(no-op)**로 만든다: redirect URL은 DB 행에서, 자격증명은 env에서 계속
  오고, 남겨진 `enabled` 키는 무력해진다. 지우는 마이그레이션은 새 env 변수를 아직 안 넣은 설치를
  즉시 중단시킨다. 정리는 **배포 후 수동**(백업 + 확인)으로 남겼다.
- **`SystemConfigGoogleDriveSchema`는 남겼다.** `SystemConfig`은 zod와 무관한 손으로 쓴 타입이고
  `buildConfig`은 파싱 결과를 반환한다 — 평범한 `z.object()`는 모르는 키를 **벗겨내므로**, 섹션을
  지우면 런타임에 `config.googleDrive`가 `undefined`가 되면서 타입상으로는 멀쩡한 채 모든
  `isGoogleDriveEnabled` 호출이 터진다. 이 주장은 설계 검토가 제기했고 내가 `utils/config.ts`에서
  직접 확인했다. `enabled` 줄만 제거했다.

**공격 요청**: 위 두 판단이 맞는가. 특히 **partial을 남겨두는 것이 "env로 완결"이라는 목표를
거짓으로 만들지 않는지** — 새 설치에는 참이고 기존 설치에는 거짓인 상태가 수용 가능한가?

## 4. 업그레이드 경로 테스트

과거 두 사고가 같은 모양이었으므로 전용 테스트를 넣었다: 저장된 partial에 `googleDrive.enabled:
false`가 남아 있어도 설정이 **에러 없이 로드되고**, 그 값이 **아무것도 끄지 못한다**.
(`system-config.service.spec.ts`, 타입에 없는 키라 `as never` 캐스트 — 그 의도를 주석에 적었다.)

## 5. 변이 확인 (전부 이 HEAD)

| 변이 | 결과 |
|---|---|
| 판정을 `false`로 강제 | 5 failed |
| `clientSecret` 검사 제거 | 1 failed |
| `redirectUrl`의 env 읽기 제거 | 1 failed |

## 6. 배포 전 필수 조건

랩탑 `.env`에 **DB 행과 똑같은 문자열**을 넣어야 이번 배포가 진짜 무변화가 된다:
```
IMMICH_GOOGLE_DRIVE_REDIRECT_URL=http://localhost:2283/api/google-drive/callback
```

## 7. 검증하지 못한 것

- **medium 스위트** (위 사유).
- **실제 관리 화면**: 항목이 사라진 모습을 브라우저로 보지 않았다.
- **배포 후 동작**: `/api/server/features`가 계속 `true`인지는 배포해야 확인된다.
