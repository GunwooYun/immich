# 리뷰 요청 — round-10 지적 반영 (C1/C2/C3/N2 + CLAUDE.md 긴장 3건)

| | |
|---|---|
| 브랜치 | `feat/google-drive-album-sync-v3.1.0` |
| HEAD | `1c63c4edc` |
| 리뷰 대상 커밋 | `fa00a7abf`(N2), `6fd2667fa`(C1/C2/C3), `1c63c4edc`(문서) |
| 직전 리뷰 | `../review/google-drive-wave6-n1-ci-20260902-0845-review.md` |
| 증거 | `dev-test/google-drive/results/20260902-0950.txt` |
| 작성 | 2026-09-02 09:52 |

## 테스트 결과 (첨부)

```
date:   2026-09-02T09:50:47+09:00
commit: 1c63c4edc (feat/google-drive-album-sync-v3.1.0)

server (unit)                Test Files  8 passed (8)    Tests  239 passed (239)
web (unit)                   Test Files  3 passed (3)    Tests   29 passed (29)
web (svelte-check, gated)    no svelte-check regressions vs baseline (3 pre-existing files)
server (medium, real DB)     Test Files  1 passed (1)    Tests   10 passed (10)

RESULT: PASS
```

증거는 세 커밋을 모두 포함한 `1c63c4edc`에서 생성했다.

## 지적별 반영

| # | 지적 | 내가 코드에서 확인한 것 | 반영 |
|---|---|---|---|
| C1 | `feature` 잡이 `@immich/plugin-sdk`를 안 빌드 | `server/src/enum.ts:1`이 `WorkflowTrigger`를 런타임 값으로 import, 진입점 `dist/index.js`, `packages/plugin-sdk/.gitignore`에 `/dist` → `git check-ignore -v`로 확인 | 설치 단계 맨 앞에 `plugin-sdk` install+build. `//:plugins`는 plugin-core(wasm)까지 끌어와서 사용 안 함 |
| C2 | `medium` 잡에 서브모듈 체크아웃 없음 | `medium.factory.ts`의 `testAssetsDir` → `e2e/test-assets`, `git submodule status`가 `-6742055…`(미초기화). 업스트림 `test.yml:381`도 `submodules: 'recursive'` | medium 체크아웃에 `submodules: 'recursive'` |
| C3 | 잡 단위 `continue-on-error`는 실패를 숨김 | GitHub Actions 동작 | 스텝 단위로 이동 + `$GITHUB_STEP_SUMMARY` 기록 + 실패 시 `::warning::` |
| N2 | 반환된 실효 설정을 단언하지 않음 | `updateSystemConfig`는 `mapConfig(newConfig)` 반환, `mapConfig`는 identity | `expect(result.googleDrive.clientId).toBe('env-client-id')` 추가 |
| CLAUDE.md ①②③ | "(권장)" 리뷰 / "deep-reasoning으로 충분" / 없는 Session History 절 | 파일에서 확인 | ① **필수**로, ② "사이클의 대체가 아니라 보조"로, ③ "생기면 앞에 둔다"로 수정. 브랜치명 하드코딩도 제거 |
| (리뷰어 지적 ④) | `.claude/`·`.agents/`가 gitignore라 리뷰 워크트리엔 없음 | `git check-ignore` | CLAUDE.md에 **명시**하고, "리뷰 세션이 읽을 수 있는 건 `dev-docs/`와 요청서뿐"이라고 적음. §7의 "훅 그대로 있다"도 git 검증 불가임을 밝힘 |

**추가 결정**: `medium` 잡도 첫 실행 동안 비차단으로 둔다. `run.sh --medium`은 스펙 1개(10 테스트)만
돌지만 `//server:ci-medium`은 medium 스펙 56개를 전부 돌리고 이 포크에서 한 번도 실행된 적이 없다.
두 잡 모두 "초록 한 번 확인 후 `continue-on-error` 줄 삭제"를 주석과 플랜(§9)에 적어 두었다.

## 공격해 주셨으면 하는 것

1. **C1 수정이 충분한지.** `plugin-sdk`만 빌드하면 되는지, 아니면 서버 스펙이 런타임에 기대는
   다른 워크스페이스 산출물이 더 있는지. (`enum.ts` 외에 `dist`를 요구하는 import가 더 있는지
   훑어봐 주십시오.) 설치 **순서**(plugin-sdk → sdk → server → web)도 봐 주십시오.
2. **C3 수정이 실제로 보이게 만드는지.** 스텝 단위 `continue-on-error` + summary가 GitHub UI에서
   기대대로 보이는지, `steps.<id>.outcome` 참조가 맞는 문법인지.
3. **N2 단언의 강도.** `mapConfig`가 identity라는 사실에 기대고 있는데, 이 의존이 드러나 있는지
   (주석으로 적어 두긴 했습니다) 아니면 더 직접적인 방법이 있는지.
4. **CLAUDE.md 수정이 §1을 실제로 강화했는지**, 아니면 문구만 바꾸고 여전히 빠져나갈 구멍이
   남는지.

## 검증한 것 / 못 한 것

**검증함**: 239/29/10 PASS(`1c63c4edc`), `config.spec.ts` 4/4, YAML 파싱 + `prettier --check`,
C1·C2의 근거를 각각 `git check-ignore`와 `git submodule status`로 실측.

**검증 못 함**: **여전히 CI를 한 번도 돌리지 않았다.** Actions 활성 여부, `jdx/mise-action@v3`의
동작, 56개 medium 스펙과 `//web:ci-unit`이 이 브랜치에서 초록인지는 모두 열려 있다. C1/C2는
러너 로그가 아니라 저장소를 읽어서 고친 것이다.

## 리뷰어에게

- 코드 변경은 **테스트 파일 1개**(단언 1줄 추가)뿐입니다. 나머지는 워크플로 YAML과 문서입니다.
- 생성물은 이번에도 포함되지 않았습니다.
