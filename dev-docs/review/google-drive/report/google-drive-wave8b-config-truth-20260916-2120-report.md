# 리뷰 요청 — wave8 리뷰 반영: 설정이 실제로 어디서 오는지 바로잡기

| | |
|---|---|
| 브랜치 | `feat/google-drive-album-sync-v3.1.0` |
| HEAD | (이 리포트 커밋) |
| 리뷰 대상 커밋 | `0d0d42a83`, `28401f8fb` |
| 범위 밖 | `45c344392` — `CLAUDE.md`의 agy 모델 예시 한 줄. 기능 코드와 무관 |
| 직전 리뷰 | `../review/google-drive-wave8-config-surface-20260914-2240-review.md` (NOT BLOCKED) |
| 증거 | `dev-test/google-drive/results/20260916-2117.txt` — 커밋 `45c344392`, dirty 표시 없음 |
| 작성 | 2026-09-16 21:20 |

## 테스트 결과 (첨부)

```
commit: 45c344392  (dirty marker 없음 — 0d0d42a83의 코드를 포함)
server (unit)              Tests 278 passed
web (unit)                 Tests  45 passed
web (svelte-check, gated)  no regressions vs baseline

RESULT: PASS
```

`mise //server:ci-unit` **2,388 passed / 2 skipped**, `mise //web:ci-unit` **563 passed**, 둘 다 exit 0.

**⚠ medium 스위트는 여전히 못 돌렸다** — Docker Desktop이 내려가 있다. 직전 리뷰가 이 변경군이
리포지토리·스키마·마이그레이션·생성 SQL을 건드리지 않아 사정권 밖이라고 독립적으로 판단했고,
이번 두 커밋도 마찬가지다.

---

## 1. 내가 확인 없이 단언했던 kill switch가 틀렸다 (직전 리뷰 N1)

`f4a6e2906` 커밋 메시지에 "끄려면 client id를 비우고 재시작"이라고 적었다. 운영에서는 **아무 일도
일어나지 않는다.** `buildConfig`가 저장된 partial을 defaults **위에** 덮는데, 운영 row를 키 이름만
조회해 보니 **다섯 키가 전부** 들어 있었다(`clientId`·`clientSecret`·`apiKey`·`redirectUrl`·`enabled`).
값은 보지 않았다(§1).

그래서 이 인스턴스는 **아직 env로 기술되지 않는다.** 런북(`CLAUDE.md` §8)에 그대로 적었다.

## 2. 런북에 적은 정리 방법 — **이게 이번에 가장 공격받아야 할 주장이다**

> env가 row와 같은 값을 갖게 한 뒤, 관리 화면에서 **아무 설정이나 한 번 저장**하면 googleDrive
> partial이 통째로 사라진다. `updateConfig`는 defaults와 같은 값을 저장에서 빼기 때문이다.

직전 리뷰어가 제시한 근거(`updateConfig`는 `getKeysDeep(defaults)`만 순회)를 받아 적었고,
**나는 이 흐름을 끝까지 실측하지 않았다.** 확인이 필요한 전제가 셋이다:

- **관리 화면이 다른 섹션을 저장할 때 `googleDrive`를 요청 본문에 실어 보내는가?** 관리 UI에서
  Google Drive 섹션은 지웠지만 DTO는 남겼다. 웹이 **편집한 섹션만** 보낸다면 `googleDrive`는 diff
  대상에 아예 안 들어가고, row는 그대로 남는다 — 그러면 런북의 정리 방법은 거짓이다.
- 반대로 전체 config를 보낸다면, 그 `googleDrive` 값은 **row에서 온 값**이다. env와 같으면 빠지고
  다르면 남는다 — 이건 의도대로다.
- **env가 비어 있는 상태에서 저장하면** row 값이 defaults(`''`)와 달라 그대로 다시 쓰인다 — 해롭지는
  않지만, "저장하면 사라진다"가 조건부라는 걸 런북이 충분히 말하는가?

**이 셋을 코드로(가능하면 테스트로) 확정해 달라.** 틀리면 운영자가 존재하지 않는 정리 경로를 믿게 된다.

## 3. 없어진 화면을 가리키던 문자열들 (직전 리뷰 N2)

- 사용자에게 보이는 에러 `"...Set these under Administration → Settings → Google Drive."` →
  `"...Set the IMMICH_GOOGLE_DRIVE_* variables in the server environment and restart."`
- redirect URL 누락 라벨이 새 env 변수를 알려준다.
- `getOAuth2Client` 주석과 `isGoogleDriveEnabled` JSDoc이 사라진 토글을 전제하던 것을 정정.

**공격 요청**: 이 문자열을 단언하는 테스트가 있는가? 없다면 다음 사람이 다시 옛 화면을 가리키게
바꿔도 아무것도 안 깨진다.

## 4. `docker/example.env`에 변수 4개 (직전 리뷰 N3)

지금까지 compose·devcontainer·환경변수 문서 어디에도 없었다. 활성화 규칙과 함께 적었다.

## 5. 선존재 공허 테스트 하나 (직전 리뷰 N4)

`syncAlbum`의 활성화 게이트를 통째로 지워도 전체가 통과했다 — 테스트가 `BadRequestException`만
봤는데 바로 아래 권한 검사가 같은 타입을 던지기 때문이다. 이제 메시지를 단언하고, "권한 검사 전에
멈췄다"는 목격자(`checkOwnerAccess` 미호출)를 함께 둔다. 게이트 제거 → 1 failed / 94 passed 확인.

**공격 요청**: 같은 패턴 — 같은 예외 타입을 던지는 가드 둘이 연달아 있고 테스트가 타입만 보는 —
이 이 서비스의 다른 메서드에도 남아 있는가? `resumeUploads`는 제대로 붙들려 있다고 직전 리뷰가
확인했다. 나머지를 봐 달라.

## 6. 정정 기록 (직전 리뷰 N5)

직전 리포트 변이표의 "5 failed"는 실패한 **파일 수**였고, 실제 실패 테스트는 **41개**였다.

## 7. 배포 전 필수 조건 (변동 없음)

- 랩탑 `.env`에 `IMMICH_GOOGLE_DRIVE_REDIRECT_URL=` — **row와 같은 문자열**로. 현재 **아직 없음**
  (이름으로만 확인).
- Docker Desktop — 이미지 빌드에 필요. 현재 **내려가 있음**.

## 8. 검증하지 못한 것

- **§2의 정리 경로 전체** — 가장 중요한 미검증 항목.
- medium 스위트.
- 바뀐 에러 문자열이 실제 화면에 어떻게 보이는지.
