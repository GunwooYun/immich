# 리뷰 요청 — round-12 지적(N1/N2) 반영: 순서를 표현 불가능하게 만들기

| | |
|---|---|
| 브랜치 | `feat/google-drive-album-sync-v3.1.0` |
| HEAD | `2defdb13e` |
| 리뷰 대상 커밋 | `2defdb13e` (단일) |
| 직전 리뷰 | `../review/google-drive-wave6-round11-order-20260902-1146-review.md` |
| 증거 | `dev-test/google-drive/results/20260902-1159.txt` |
| 작성 | 2026-09-02 12:00 |

## 테스트 결과 (첨부)

```
date:   2026-09-02T11:59:59+09:00
commit: 2defdb13e (feat/google-drive-album-sync-v3.1.0)

server (unit)                Tests  239 passed (239)
web (unit)                   Tests   29 passed (29)
web (svelte-check, gated)    no svelte-check regressions vs baseline (3 pre-existing files)
server (medium, real DB)     Tests   10 passed (10)

RESULT: PASS
```

## 무엇을 바꿨나

직전 리뷰의 N1은 "주석으로 순서를 지키게 하지 말고, 틀릴 수 없는 형태를 쓰라"였다. 네 줄의
순서 의존 명령을 **multi-filter 한 쌍**으로 바꿨다.

```yaml
pnpm --filter @immich/sdk --filter @immich/plugin-sdk install --frozen-lockfile
pnpm --filter @immich/sdk --filter @immich/plugin-sdk build
```

**직접 확인**: 두 산출물을 지우고 필터를 **거꾸로** 나열해
(`--filter @immich/plugin-sdk --filter @immich/sdk build`) 실행하면 pnpm이
`packages/sdk build: Done` → `packages/plugin-sdk build: Done` 순으로 돌고 exit 0이다.
즉 나열 순서가 결과에 영향을 주지 않는다. `mise.toml:52-53`의 `//:plugins`가 이미 같은 관용구다.

## 주석의 사실 오류 2건도 정정

- **이유를 절반만 적고 있었다.** `packages/sdk/build`를 지우고 web 유닛 스펙을 돌리면
  `Failed to resolve import "@immich/sdk"`로 2개가 죽는다(직접 재현). 즉 sdk 빌드는
  plugin-sdk 번들링뿐 아니라 **web 스펙 때문에도** load bearing이다. 반대로 server 스펙은
  sdk 빌드 없이도 통과한다 — plugin-sdk의 esbuild(`bundle: true`)가 인라인하기 때문이다.
- **`//:plugins` 기각 사유가 틀렸다.** `java = "21.0.2"`(`mise.toml:27`)는
  `npm:@openapitools/openapi-generator-cli`(`mise.toml:22`)용이고, plugin-core의 `build:wasm`이
  요구하는 것은 `extism-js`와 binaryen이다. 기각 결론은 유효, 사유만 정정했다.

## 공격해 주셨으면 하는 것

1. **multi-filter가 `install`에도 안전한가.** `build`가 의존성 순서를 따른다는 것은 확인했지만,
   같은 형태의 `install --frozen-lockfile`이 두 패키지를 함께 설치할 때 순서나 링크에서
   달라지는 것이 없는지. (제 확인은 `node_modules`가 이미 있는 상태였다.)
2. **주석이 이제 정확한가.** 세 문단(왜 두 패키지를 빌드하는가 / 왜 multi-filter인가 /
   왜 `//:plugins`가 아닌가)이 사실과 일치하는지, 특히 "server 스펙은 sdk 빌드 없이도 통과한다"는
   문장이 이 job이 실제로 돌리는 스펙 8개 기준으로 맞는지.
3. **남은 순서 의존이 있는가.** `immich` install → `immich-web` install → `svelte-kit sync`
   구간에도 같은 종류의 암묵적 순서가 남아 있는지.

## 검증한 것 / 못 한 것

**검증함**: 필터 역순 실행(dependency order 유지, exit 0), `packages/sdk/build` 제거 시 web 스펙
실패 재현, `mise.toml`·`packages/plugin-core/package.json`으로 툴체인 주장 대조,
239/29/10 PASS(`2defdb13e`), YAML 파싱 + `prettier --check`.

**검증 못 함**: **CI를 한 번도 실행하지 않았다** — 이 라운드에서도 동일하다. Actions 활성 여부,
`jdx/mise-action@v3`, 빈 `node_modules`에서의 `--frozen-lockfile` 실동작은 열려 있고,
이것들은 리뷰로 닫히지 않는다(러너에서 한 번 돌려야 닫힌다).

## 리뷰어에게

- 코드 변경 없음. 워크플로 YAML 한 파일(명령 2줄 + 주석)뿐이다.
- 이 라운드가 깨끗하면 CI 건은 여기서 닫고, 남은 미검증 사항은 "Actions를 켜고 실제로 한 번
  돌린다"는 별도 작업으로 넘기는 것을 제안한다.
