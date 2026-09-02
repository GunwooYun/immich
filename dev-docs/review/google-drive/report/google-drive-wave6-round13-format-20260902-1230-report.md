# 리뷰 요청 — round-13 지적 반영: 스윕을 막던 포맷 + 워크플로 정정 5건

| | |
|---|---|
| 브랜치 | `feat/google-drive-album-sync-v3.1.0` |
| HEAD | `2630f1783` |
| 리뷰 대상 커밋 | `2630f1783` (단일) |
| 직전 리뷰 | `../review/google-drive-wave6-round12-multifilter-20260902-1200-review.md` |
| 증거 | `dev-test/google-drive/results/20260902-1224.txt` + 아래 전체 스윕 |
| 작성 | 2026-09-02 12:30 |

## 테스트 결과 (첨부)

**기능 스위트** (`2630f1783`):
```
date:   2026-09-02T12:24:01+09:00
commit: 2630f1783
server (unit) 239 / web (unit) 29 / svelte-check gate clean / medium 10     RESULT: PASS
```

**그리고 이번엔 전체 스윕도 돌렸다** — 직전 리뷰의 N1이 "이 잡은 첫 실행에서 테스트 하나도 못
돌리고 죽는다"였으므로, 그 잡이 실제로 도는 명령을 그대로 실행했다:

```
mise run //web:ci-unit     → format → check(ts+svelte) → test
                             Test Files 56 passed | 1 skipped (57)
                             Tests     547 passed | 2 skipped (549)     exit 0

mise run //server:ci-unit  → format → lint → check → test
                             Test Files 94 passed (94)
                             Tests    2349 passed | 2 skipped (2351)    exit 0
```

즉 **N1이 지적한 실패 경로가 실측으로 닫혔다.** 이전 라운드까지 "러너 없이는 모른다"고 적었던
항목의 상당 부분이 사실은 로컬에서 확인 가능했다.

## 무엇을 바꿨나

### N1 (MEDIUM) — 스윕을 막던 포맷 위반 3건

`//web:ci-unit`·`//server:ci-unit`은 **첫 단계가 `prettier --check`**이고, 이 포크가 작성한 세 파일이
그것을 통과하지 못했다:

```
web/src/lib/components/album-page/GoogleDriveAlbumMenu.spec.ts
web/src/lib/components/shared-components/context-menu/ButtonContextMenu.spec.ts
server/test/medium/specs/repositories/google-drive.repository.spec.ts
```

포맷 후 두 스코프 모두 clean, 재포맷된 web 스펙 2개는 21 테스트 통과. **코드 변경은 이 세 파일의
포맷뿐이며 로직 변경은 없다**(diff: 16 insertions / 11 deletions, 전부 줄바꿈·들여쓰기).

### 워크플로 정정 5건 (전부 대조 후 반영)

| # | 지적 | 확인한 근거 | 처리 |
|---|---|---|---|
| N3 | java 오류가 파일 **위쪽에 잔존** | `:52`에 남아 있었다 — 직전 커밋이 아래쪽만 고쳤다 | `extism-js, binaryen`으로 정정 |
| N2 | "prettier가 워크스페이스 전체" 거짓 | `web/package.json:19`은 `web/` 기준 | 정정하고, **포맷 실패가 스윕 전체를 막는다**는 사실을 주석에 명시 |
| N4 | `svelte-kit sync` 중복 | `web/package.json:24`의 `prepare`가 install 때 이미 실행 | 해당 줄 삭제 |
| N5 | `ls -t`가 클린 체크아웃에서 옛 증거를 고를 수 있음 | 체크아웃은 모든 파일 mtime이 동일 | 파일명 사전순(`YYYYMMDD-HHMM`) 정렬로 변경 |
| N7 | "12 spec files" | 이 잡은 11개 실행(12번째는 medium 잡) | 11로 정정 |

### N6 — 고치지 않고 기록

`pnpm-workspace.yaml:65`의 `injectWorkspacePackages: true`가 실제로 이행되는 pnpm에서는 합친
install/build가 옛 4줄보다 약하다는 지적. 현재는 symlink라 무해하므로 **되돌리지 않고**, 되돌려야
할 조건을 주석에 적었다(순서 안전성을 잃지 않기 위해).

## 공격해 주셨으면 하는 것

1. **포맷 변경이 정말 포맷뿐인가.** 세 파일의 diff에 로직·단언이 바뀐 곳이 없는지. 특히
   `ButtonContextMenu.spec.ts`는 +17/-4로 다른 둘보다 변화가 크다.
2. **N5 수정이 실제로 결정적인가.** 파일명 사전순 정렬이 `run.sh`가 방금 쓴 파일을 반드시 고르는지
   (같은 분에 두 번 실행되면? `results/`에 다른 형식의 파일이 섞이면?).
3. **N6를 기록으로 남긴 판단.** 지금 되돌려 per-package 순서로 가는 편이 나은지, 아니면 순서
   안전성을 지키고 주석으로 두는 편이 나은지.
4. **전체 스윕 결과의 해석.** 2,349 + 547이 통과했다는 것이 `regression` 잡이 러너에서도 통과한다는
   뜻은 아니다. 로컬과 러너가 갈릴 지점이 어디인지(캐시된 `node_modules`, mise 툴 설치, 서브모듈).

## 검증한 것 / 못 한 것

**검증함**: 세 파일의 prettier 위반과 수정 후 clean, 재포맷 스펙 21 통과, `//web:ci-unit`
547 통과·`//server:ci-unit` 2,349 통과(둘 다 exit 0), 기능 스위트 239/29/10 PASS(`2630f1783`),
YAML 파싱 + `prettier --check`, N2~N5·N7의 근거를 각각 파일에서 직접 확인.

**검증 못 함**: CI 실행 자체(Actions 활성 여부, `jdx/mise-action@v3`, 클린 러너에서의 install).
다만 직전 라운드에서 배운 대로, 이 범주에 넣기 전에 로컬에서 먼저 시도해 봤다.

## 리뷰어에게

- 코드 변경은 **세 스펙 파일의 포맷**뿐이고 로직 변경은 없다.
- 나머지는 워크플로 YAML 주석·명령 정리다.
- 이번 라운드는 닫자는 제안을 하지 않는다. 남길지 닫을지는 판단해 주기 바란다.
