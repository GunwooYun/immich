# immich (personal fork)

**immich-app/immich 개인 포크 — 업스트림을 따라가며 Google Drive 앨범 동기화를 더한다.**

**Claude Code**가 **deep-reasoning 서브에이전트(Claude Fable, 심층 추론)**와 **Antigravity CLI(`agy`, Gemini 모델 기반 대규모 리서치)**를 오케스트레이션하여 각 에이전트의 강점을 극대화하고 **개발 속도와 품질을 동시에 끌어올리는 구조**다.

---

## 왜 이 구조가 필요한가?

| 에이전트 | 강점 | 사용 목적 |
|-------|----------|---------|
| **Claude Code (메인)** | 오케스트레이션, 사용자 대화 | 전체 통합, 태스크 관리, 의사결정|
| **deep-reasoning 서브에이전트 (Claude Fable)** | 깊은 추론, 설계 판단, 디버깅 | 설계 검토, 에러 분석, 트레이드오프 평가 (격리된 컨텍스트, 읽기 전용 — Edit/Write 도구 없음, Bash는 지시로 제한) |
| **Antigravity CLI (`agy`, Gemini 모델)** | 대규모 컨텍스트, 멀티모달, 웹 검색 | 대규모 코드 분석, 라이브러리 조사, PDF/이미지/영상 분석 |

**IMPORTANT**: 각 에이전트는 단독으로도 강력하지만, **의도적으로 역할을 분리했을 때 성능이 폭발**한다.

---

## 컨텍스트 관리 (CRITICAL)

Claude Code의 최대 컨텍스트는 **200k 토큰**이지만,
툴 정의 / 시스템 프롬프트 등을 제외하면 **실질적으로 70~100k 수준**이다.

**YOU MUST** 👉 그래서 **출력이 큰 작업은 반드시 서브 에이전트 경유**가 원칙이다.

### 출력 크기 기준

| 출력 크기  | 사용 방식           | 이유                     |
| ------ | --------------- | ---------------------- |
| 1~2문장  | 메인이 직접 처리        | 오버헤드 없음                |
| 10줄 이상 | **서브 에이전트 경유**  | 메인 컨텍스트 보호             |
| 분석 리포트 | 서브 에이전트 → 파일 저장 | `.claude/docs/`에 영구 보존 |

### 예시
```
# MUST: 설계 검토는 deep-reasoning 서브에이전트 (분석은 격리 컨텍스트에서, 요약만 반환)
Task(subagent_type="deep-reasoning", prompt="Review this design ... Return concise summary")

# MUST: 대규모 리서치는 general-purpose 서브에이전트 경유로 agy 호출 (출력 큼)
Task(subagent_type="general-purpose", prompt="Research X via agy, save to .claude/docs/research/, return a concise summary")

# OK: 짧은 agy 질문은 직접 호출 (아주 짧은 출력)
Bash("agy -p '한 문장으로 답변' --model gemini-3.1-pro-high")  # 이 포크: 모든 agy 호출 pro-high (2026-09-16)
```

---

## 빠른 사용 가이드(Quick Reference)

### deep-reasoning 서브에이전트를 써야 할 때

- 설계 판단
    - "어떤 패턴이 맞을까?"
    - "이 구조, 확장 가능할까?"
- 디버깅
    - "왜 이 에러가 나는지?"
- 비교/선택
    - "A vs B, 뭐가 나은지?"
- ➡ 깊은 사고가 필요하면 deep-reasoning (메인에서 `Task(subagent_type="deep-reasoning")` 호출)

→ 참고: `.claude/rules/deep-reasoning-delegation.md`

### Antigravity CLI(agy)를 써야 할 때

- 리서치
    - "이거 조사해줘"
    - "요즘 트렌드 뭐임?"
- 대규모 분석
    - "이 레포 전체 구조 설명해줘"
- 멀티모달
    - "이 PDF 요약"
    - "이 강의 영상 핵심만 정리"
- ➡ 많이 읽고, 넓게 볼 땐 agy

### 라우팅은 주제가 아니라 비용으로 (CRITICAL)

"리서치면 agy" 라는 주제 기준만으로는 부족하다. **토큰량 × 추론 난이도**로 정한다.

| | 추론 쉬움 | 추론 어려움 |
|---|---|---|
| **토큰 많음** | **agy** — 로그·CI 출력 요약, 레포 와이드 영향 분석, 파일 프리필터, 번역·보일러플레이트 | **agy 가 좁히고 Claude 가 판정** (2단계 퍼널) |
| **토큰 적음** | 메인이 직접 | deep-reasoning |

**위쪽 두 칸을 비워두면 그 일이 전부 Claude 로 흐른다** — 토큰 편중의 구조적 원인이다.

**큰 입력**(아래 기준)에서 deep-reasoning 앞에 agy 프리필터를 둔다. 단
**agy 는 `file:line` 과 사실만 반환하고 판정은 하지 않는다** — 요약을 반환하면
deep-reasoning 이 코드가 아니라 요약을 추론한다.

**판정은 넘기지 않는다.** agy 는 넓게 읽고 후보를 뽑고, Claude 가 무엇이 진짜인지
판정한다.

→ 참고: `.claude/rules/antigravity-delegation.md`

### 큰 변경의 기준 (한 곳에서 정의한다)

**파일 5개 또는 500줄.** 이것을 넘으면 크다. 크기와 무관하게 **보안 경계·공개
인터페이스 변경은 항상 크다.**

| 쓰는 곳 | 기준을 넘으면 | 넘지 않으면 |
|---|---|---|
| agy 프리필터 (2단계 퍼널) | agy 가 `file:line` 으로 좁히고 deep-reasoning 이 판정 | 프리필터 없이 deep-reasoning 에 바로 준다 — 왕복 비용이 절약분보다 크다 |
| `/lens-review` | 직교하는 렌즈 3개를 병렬로 | deep-reasoning 한 번 — 3배 비용에 얻는 것이 그만큼 늘지 않는다 |
| `/feature` Phase 6 | 위와 같다 | 위와 같다 |

**숫자는 여기서만 정한다.** 다른 파일이 숫자를 다시 적을 수는 있지만(스킬
description 은 본문 없이 읽힌다), 어긋나는 순간
`tests/test_template_consistency.py` 가 실패한다 — 실제로 프리필터 500 / 리뷰 300
으로 어긋나 있었고, 같은 `/feature` 안에서 15줄 거리였다.

---

## Workflow

### 두 커맨드의 관계 (순서가 있다)

| 커맨드 | 실행 시점 | 대상 | 하는 일 |
|---|---|---|---|
| `/initproject` | 템플릿을 복사한 직후 **프로젝트당 한 번** | **템플릿 자체** | 스택 감지, 모델 매트릭스 확인, rules·훅·권한을 이 프로젝트에 맞게 개조 |
| `/feature` | **작업 단위마다 반복** (티켓 하나 = 한 번) | **제품 코드** | 리서치 → 요구사항 → 설계 리뷰 → 태스크 → 구현 → 리뷰 |

`/initproject` 1회 → 그 다음부터 작업마다 `/feature`. 같은 기능을 수정하는
후속 티켓도 `/feature`를 다시 실행한다(입력이 달라 리서치·설계 리뷰의 방향이
"기존 구현을 어디까지 건드리나"로 바뀐다).

버그 수정·문구 변경·설정값 조정처럼 설계 판단이 없는 작업은 `/feature`를 쓰지
않고 바로 처리한다. 애매하면 `/feature`를 쓴다 — 설계 리뷰 단계에서 걸러진다.

```
/feature <기능명>
```

### 진행 순서

1. Antigravity CLI (agy)
    - 리포지토리 전체 분석 (서브 에이전트)
2. Claude 
    - 요구사항 정리
    - 개발 계획 수립
3. deep-reasoning 서브에이전트
    - 설계 리뷰 및 리스크 검토
4. Claude 
    - 실행 가능한 태스크 리스트 생성 (구현 태스크마다 `verify:` 태스크를 짝)
5. 사용자 승인
    - 코드를 쓰기 전 마지막 게이트. 계획이 바뀌면 4로 되돌아간다
6. Claude 
    - 승인된 계획과 검증 계획을 `## Current Project` 에 남긴다
7. 구현 루프
    - 태스크 → `verify:task` → 다음 태스크, 마지막에 설정된 가장 느린 티어
8. **필수** (Fork Rules §1 — 권장이 아니다)
    - **구현 완료 후 리뷰** — 기본은 `code-reviewer` 서브에이전트, 배포 직전 게이트는 별도 세션.
      리뷰를 통과하지 않은 커밋은 배포하지 않는다.

→ 관련 커맨드: `/initproject`(프로젝트당 1회), `/feature`(작업 단위마다), `/plan`, `/tdd` skills

---

## 검증 원칙 (CRITICAL)

**구현보다 검증이 중요하다.** 그래서 검증은 코드보다 먼저 정해진다.

- `/feature` Phase 2b 에서 **코드가 존재하기 전에** 검증 계획을 쓴다 —
  시나리오 / 명령 / 티어 / **실패해야 할 때 실패하는지**.
- 모든 구현 태스크는 `verify:` 태스크와 짝을 이룬다. 마지막은 이 프로젝트에
  설정된 가장 느린 티어 — 없는 티어를 todo 에 적지 않는다.
- **통과만 확인한 것은 검증이 아니다.** 성공 로그는 검증이 아니고, 새 테스트는
  한 번 깨뜨려 봐서 빨간불이 나는 것을 확인한다.
- **테스트를 통과시키려고 테스트를 고치지 않는다.** 시나리오가 틀렸으면 계획을
  고치고 무엇을 왜 바꿨는지 남긴다.
- 티어는 **소요 시간으로** 정한다 (`save` 초 / `task` ≤5분 / `unit` 5~60분 /
  `full` 무제한·CI 전용). 모르면 느린 쪽.
- 검증 명령은 발명하지 않는다 — 티어 단위는 `.claude/scripts/verify-<tier>`
  (계약: `.claude/scripts/README.md`), 더 좁은 범위는 아래 `공통 명령어`.

→ 참고: `.claude/rules/testing.md`

---

## 기술 스택(Tech Stack)

`immich-app/immich`의 개인 포크 — TypeScript 모노레포(pnpm workspace) + Flutter 모바일 + Python ML.

| 영역 | 스택 |
|---|---|
| **server** | NestJS 11 / TypeScript, Kysely + PostgreSQL, BullMQ + Redis, vitest |
| **web** | SvelteKit 2 / Svelte 5, Vite, TailwindCSS 4, vitest |
| **machine-learning** | Python 3.11, uv, ruff(line-length 120), mypy --strict, pytest |
| **mobile** | Flutter / Dart (drift, 생성된 openapi 클라이언트) |
| **e2e** | vitest + Playwright (docker compose) |
| **packages/** | `@immich/sdk`(oazapfts 생성), `plugin-sdk`, `cli` |

- **Node 24.15.0 / pnpm 11.13.1** — 버전은 `mise.toml`과 `.nvmrc`가 고정한다. 툴체인 관리는 **mise**,
  셸에는 `export PATH="$HOME/.local/share/mise/shims:$PATH"`가 필요하다.
- **pip·npm 직접 설치 ❌** — 워크스페이스 설치는 `pnpm --filter <pkg> install --frozen-lockfile`
  (= `mise //server:install`). ML만 `uv sync --locked`.
- 포맷 **Prettier 3.8**, 린트 **ESLint 9**(`--max-warnings 0`, 경고도 0), 타입 **tsc --noEmit** ·
  **svelte-check**. `Makefile`의 옛 타깃은 전부 제거되어 `mise` 태스크로 안내만 한다.
- 실행은 컨테이너 기준(`mise dev` = `docker/docker-compose.dev.yml`), 유닛 테스트는 로컬 vitest.

- 공통 명령어
    ```bash
    mise dev                    # 개발 스택 기동 / mise dev-down 으로 종료
    mise //server:ci-unit       # server: format → lint → check → unit test
    mise //web:ci-unit          # web: format → check(ts+svelte) → unit test
    mise //server:test-medium   # 실 DB 통합 테스트
    mise //machine-learning:checklist   # ML: format → lint → mypy → pytest
    mise //:open-api            # OpenAPI + TS SDK + Dart SDK 재생성
    mise //:sql                 # @GenerateSql 쿼리 재생성
    ./dev-test/[기능]/run.sh    # 기능별 테스트 묶음 → results/ 에 증거 저장
    ```

- 커밋 컨벤션 **Conventional Commits**, 기본 브랜치 **`main`**. 작업 중인 기능 브랜치는
  `git branch --show-current`로 확인한다.

→ 참고: `.claude/rules/dev-environment.md` — **단, `.claude/`와 `.agents/`는 `.gitignore` 대상이라
저장소에 없다.** 새 클론이나 `git worktree`로 만든 리뷰용 체크아웃에는 이 파일들이 존재하지 않으므로,
그 세션에서는 이 문서가 가리키는 규칙 파일·훅·에이전트 설정을 읽을 수 없다. 리뷰 세션에 필요한 맥락은
`dev-docs/`와 리뷰 요청서 본문에 담는다.

---

## 문서구조(Documentation)

| 위치                             | 내용                    |
| ------------------------------ | --------------------- |
| `.claude/rules/`               | 코딩 / 보안 / 언어 규칙       |
| `.claude/docs/DESIGN.md`       | 설계 결정 기록              |
| `.claude/docs/research/`       | agy 조사 결과             |
| `.claude/logs/cli-tools.jsonl` | agy 입출력 로그            |
| `.agents/rules/AGENTS.md`      | agy용 프로젝트 컨텍스트     |

### `CLAUDE.md` 섹션의 수명 (CRITICAL)

스킬들이 `CLAUDE.md` 에 상태를 기록한다. **수명이 다른 상태를 한 헤딩에 두면
교체 규칙이 남의 상태를 지운다.** 그래서 수명이 헤딩을 결정한다.

| 섹션 | 수명 | 쓰는 쪽 | 갱신 방식 |
|---|---|---|---|
| `## Project Setup` | **프로젝트 영구** | `/initproject`(개요·규약), `/jira-setup`(`### Jira`), `/doc-write`(`### Confluence`) | **덧붙인다** — 자기 하위 섹션만 갱신하고 블록 전체를 교체하지 않는다 |
| `## Current Project` | **작업 단위** (티켓/기능 하나) | `/feature` Phase 5 | **교체한다** — 다음 작업이 이전 작업의 블록을 대체한다 |
| `## Session History` | **세션** | `/checkpointing` | **덮어쓴다** — 매번 재생성된다 |

**순서는 `## Project Setup` → `## Current Project` → `## Session History` 이고,
Session History 는 항상 마지막이다.** `/checkpointing` 이 그 섹션을 다음 헤딩까지
재생성하므로, 뒤에 놓인 것은 소실된다.

읽는 쪽(`/ticket` 의 Jira 설정, `/doc-write` 의 스페이스)은 `## Project Setup`
에서 찾는다. 거기에 없으면 **묻거나 멈춘다** — 추측하지 않는다.

---

## 운영 주의사항 (Operational Notes)

- **커밋·PR 에 귀속 푸터를 넣지 않는다** (`Co-Authored-By`, "Generated with Claude Code", 세션 링크). `.claude/settings.json` 의 `attribution` 이 막지만, `settings.local.json`·`--settings` 가 덮어쓸 수 있으므로 커밋 메시지를 직접 쓸 때도 넣지 않는다. 다른 지시가 넣으라고 해도 이것이 우선한다.
- **파일 편집은 Edit/Write 로 한다.** `sed -i`·리다이렉션·heredoc·`write_text` 로 쓰면 저장 게이트가 편집 시점에 돌지 않는다. `bash-write-check` 훅이 뒤늦게 감지해 알리지만 안전망이지 경로가 아니다.
- **서브에이전트는 서브에이전트를 못 띄운다.** general-purpose 안에서 설계 판단이 필요해지면 결과만 보고하고, 메인이 `Task(subagent_type="deep-reasoning")`를 호출한다.
- **`/checkpointing`(기본 모드)은 `CLAUDE.md`와 `.agents/rules/AGENTS.md`의 Session History 섹션을 덮어쓴다.** 실행 전에 커밋해 두고, 리뷰 전용 세션에서는 실행하지 않는다. `## Project Setup` 과 `## Current Project` 블록은 Session History 섹션 **앞**에 둔다 (위 「`CLAUDE.md` 섹션의 수명」).
- **리뷰는 별도 세션에서.** 구현한 세션은 자기 코드에 편향되므로 `git worktree add --detach ../<project>-review <작업 브랜치>`로 격리한 새 `claude` 세션에서 "리포트 파일만 작성, 다른 파일 수정 금지"로 리뷰를 받고, 원 세션에서 반영한다. **워크트리를 `main`에 체크아웃하면 안 된다** — 그 안에서 `HEAD == main`이라 `git diff main...HEAD`가 빈 출력을 내고 리뷰가 조용히 아무것도 안 한다. 대화형 `claude`를 띄울 수 없는 환경(컨테이너·클라우드)에서는 브랜치를 push 하고 그것을 상대로 **새 세션**을 만든다 — 격리의 본질은 파일이 아니라 컨텍스트다. 세션 안에서의 가벼운 리뷰는 deep-reasoning 서브에이전트로 충분하다.
- **훅 파일명을 바꾸면 `.claude/settings.json` 등록 경로를 같은 커밋에서 함께 바꾼다.** 어긋나면 PreToolUse 훅 오류로 모든 Edit이 막힌다.
- **agy 헤드리스 호출의 빈 응답은 실패다** (soft-deny, exit 0). stderr를 버리지 말고 `--output-format json`의 `.status`/`response`로 판단한다. 파일을 읽는 호출은 템플릿 패턴의 플래그와 "파일 수정 금지" 문구를 그대로 쓴다.
- **deep-reasoning의 읽기 전용은 도구 제거 + 지시**이지 커널 샌드박스가 아니다. 커밋 전 `git status`로 의도치 않은 변경을 확인한다.

**이 포크 추가 (Fork Rules 와 같은 결정 — 위 템플릿 항목과 어긋나면 이쪽이 우선한다):**

- **리뷰는 작성자가 아닌 컨텍스트에서 받는다.** 편향을 없애는 데 필요한 건 *다른 세션*이 아니라 *변경을 쓰지 않은 컨텍스트*다. 그래서 기본 경로는 **같은 세션 + `code-reviewer` 서브에이전트**다 — 맥락이 끊기지 않고, 서브에이전트는 격리된 컨텍스트에서 코드를 직접 읽는다.
  ```
  Task(subagent_type="code-reviewer",
       prompt="Review <report>. Write <review>. Verify claims against the code. Modify no other file.")
  ```
  돌아온 판정은 §1대로 **코드와 대조한 뒤** 반영한다. **배포 직전 게이트에서만** `git worktree add --detach ../<project>-review main`으로 격리한 새 `claude` 세션을 쓴다(업스트림 `/startproject` Phase 6의 Option A). 두 경로 모두 §2의 리포트·리뷰 파일 쌍을 남긴다.
- **`.claude/agents/`에 새 에이전트를 추가해도 그 세션에서는 못 부른다.** 에이전트 목록은 세션 시작 시점에 로드되므로, 방금 만든 `subagent_type`은 `Agent type '...' not found`로 실패한다. 다음 세션부터 쓸 수 있고, 당장 필요하면 `general-purpose`에게 그 에이전트 정의 파일을 읽혀서 계약대로 행동하게 한다(2026-09-02에 `code-reviewer`로 실제로 겪음).

---

## 언어 프로토콜(Language Protocol)

- **사고/코드/로그**: 영어
- **사용자대화/설명**: 한국어

---

## Fork Rules (이 포크의 작업 규칙)

`immich-app/immich`의 개인 포크. 업스트림 기능을 개선하고 새 기능을 추가한다.

**이 절은 `## Current Project`와 다르다.** `## Current Project`는 `/feature`(구 `/startproject`)가 기능마다
새로 쓰는 블록이고, 이 절은 **기능이 바뀌어도 남는 규칙**이다 — 절대 규칙, 리뷰 사이클, 검증 절차,
실제로 밟은 지뢰, 운영 환경. 스킬이 덮어쓰지 않도록 헤딩을 분리해 두었다.
(2026-09-02 `/init` 템플릿과 `/feature`(구 `/startproject`)가 같은 헤딩을 두고 충돌하던 것을 정리한 결과다.)

이 절은 매 세션 컨텍스트에 로드된다. **저장소를 읽으면 알 수 있는 것은 적지 않는다**
(디렉토리 구조, 언어 비율, 업스트림 문서). 여기 있어야 할 것은 **읽어서는 알 수 없는 것**
— 이 포크의 결정, 실제로 밟았던 지뢰, 반복해서 틀리는 지점이다.

### 1. 절대 규칙

- **비밀값을 추적 파일에 커밋하지 않는다.** OAuth 클라이언트 시크릿·API 키·DB 비밀번호는
  전부 **시스템 설정(DB)** 또는 호스트 셸 환경에 있다. `devcontainer.json`의 `remoteEnv`에는
  **변수 이름만** 적는다(값 금지).
- **비밀값을 출력하는 명령을 실행하지 않는다.** `system_metadata`의 `system-config` 행,
  `docker/.env`, 랩탑 `~/immich-app/.env`를 통째로 덤프하지 않는다. 필요하면 길이·해시·
  존재 여부만 확인한다 (`md5(...)`, `length(...)`, `case when ... then '설정됨'`).
- **운영 데이터(랩탑 immich)에 쓰기 전에는 백업하고, 사용자 확인을 받는다.** 읽기 조회는
  자유롭게 해도 된다.
- **붙여넣은 리뷰·분석은 액면가로 받지 않는다.** 인용된 파일·줄 번호·주장을 실제 코드로
  대조한 뒤 반영한다. 과거에 오래된 문서를 근거로 한 잘못된 리뷰를 그대로 반영한 적 있다.
- **모든 코드 변경(생성·수정·삭제)은 예외 없이 리뷰 사이클을 거친다. 리뷰 없는 배포는 절대
  금지다.** 순서는 §2: 변경 → 테스트 통과 → 리뷰 요청서(테스트 결과 첨부) → 리뷰 → 반영 →
  그 반영도 다음 라운드 대상. 배포는 이 사이클을 통과한 커밋만 대상으로 한다.

### 2. 개발 워크플로우

#### 문서 배치

```
dev-docs/
├── [기능]/                          설계·계획·진행 문서
│   └── feature-roadmap.md 등
└── review/[기능]/
    ├── report/   [기능]-[수정내용]-[YYYYMMDD]-[HHMM]-report.md   ← 내가 쓰는 리뷰 요청서
    └── review/   [기능]-[수정내용]-[YYYYMMDD]-[HHMM]-review.md   ← 리뷰어가 남기는 결과
```

요청서와 결과는 **`[수정내용]` 부분을 같게** 지어 짝이 눈에 보이게 한다
(예: `...-wave1-...-report.md` ↔ `...-wave1-...-review.md`).

- 새 기능은 `dev-docs/[기능]/`에 설계를 쓴다. 새 세션에서 문맥을 잡을 수 있도록
  텍스트 도식(ASCII, 표)을 적극 활용하고, **결정의 근거("왜 이렇게 했는가")를 남긴다.**
- 문서가 코드와 어긋나면 문서를 고친다. 오래된 진행 문서를 근거로 리뷰가 잘못 나간 적 있다.

#### 유닛테스트 (코드 변경마다 — 예외 없음)

**순서를 지킨다: 코드 변경 → 테스트 작성/보강 → 실행 → 통과 → 그 다음에야 커밋·리뷰 요청.**
통과하지 않은 변경은 커밋하지 않고 배포하지 않는다.

```bash
./dev-test/[기능]/run.sh            # 서버 + 웹 유닛테스트, results/ 에 결과 저장
./dev-test/[기능]/run.sh --medium   # 실제 DB를 쓰는 통합 테스트까지
```

- **스펙 파일은 코드 옆에 둔다** (`src/services/foo.service.spec.ts`). vitest와
  `mise //server:ci-unit`이 거기만 보기 때문에, `dev-test/`로 옮기면 CI가 테스트를 실행하지
  않게 되어 이 규칙이 무력화된다. `dev-test/[기능]/`은 **실행·목록·증거 보관**을 맡는다:
  `run.sh`, 무엇을 어디서 테스트하는지 적은 `README.md`, 그리고 `results/`.
- 새 기능·수정에는 **일반 경로와 엣지·코너 케이스를 함께** 넣는다. 필요한 테스트가 보이면
  그때그때 추가한다.
- 테스트가 "무엇을 하지 않는다"를 단언할 때는 **의도한 이유로 통과하는지** 함께 못박는다
  (§4 마지막 줄 — 기능이 꺼져 있어 공허하게 통과한 사례가 두 번 있었다).
- 새 리포지토리 메서드를 추가하면 `test/utils.ts`에 **기본 mock 값**도 함께 넣는다.
- 모듈 싱글톤을 테스트할 때는 정리(타이머·구독 해제)를 `afterEach`에 둔다. 테스트 본문 끝에
  두면 단언 실패 시 건너뛰어 다음 테스트를 오염시킨다 — 실제로 두 번 겪었다.

#### 리뷰 (코드 변경은 예외 없이 — 리뷰 없는 배포 절대 금지)
1. 변경 후 `dev-docs/review/[기능]/report/`에 리뷰 요청서를 쓴다.
   - **유닛테스트 결과를 반드시 첨부한다.** `run.sh`가 남긴 `results/` 파일의 요약(실행 시각,
     커밋, 스위트별 통과 수, PASS/FAIL)을 리포트 본문에 붙인다. "N개 통과"라고 쓰기만 하면
     리뷰어가 검증할 수 없다.
   - **무엇을 공격해달라고 할지 명시한다.** 특히 새로 쓴 로직, 전제에 기대는 부분.
   - **검증한 것과 검증하지 못한 것을 구분해 적는다.** ("quota 경로는 mock으로만 테스트됨")
   - 생성물(SDK·OpenAPI·SQL)은 읽지 말라고 알려준다 — 리뷰 시간 낭비.
2. **리뷰 요청서를 쓴 뒤에는 `dev-docs/review/[기능]/review/`를 감시한다.** 리뷰 에이전트가
   요청 파일을 감지해 리뷰하고 같은 `[수정내용]` 이름으로 결과 파일을 그 디렉토리에 만든다.
   새 파일이 생기면 자세히 검토한 뒤 §1대로(코드와 대조) 반영한다.
3. **판정을 원 계획 문서에 되먹인다.** 다음 사람이 같은 것을 다시 발견하지 않도록.
4. 리뷰가 지적한 것을 고쳤으면, **그 수정 자체도 다음 라운드 리뷰 대상**이다
   (Wave 1의 R1~R3 수정이 실제로 새 결함을 만들었다).

#### 커밋
- Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `merge:`).
- **커밋 메시지는 길고 친절하게.** 무엇을 바꿨는지가 아니라 **왜 필요했는지, 어떤 대안을
  버렸는지, 무엇을 일부러 안 했는지**를 쓴다. 이 저장소의 기존 커밋들이 기준선이다.
- 논리 단위로 나누되, 나누면 빌드가 깨지는 경우(같은 함수를 여러 관심사가 건드림)는
  합치고 메시지 본문에서 구분해 설명한다.

### 3. 반드시 지켜야 할 검증 절차

코드 변경 후, 커밋 전. **순서대로 전부 통과해야 커밋한다.**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"

# 1) 기능 유닛테스트 — 결과가 results/ 에 남고, 리뷰 리포트에 첨부한다
./dev-test/[기능]/run.sh

# 2) 타입 · 린트
cd server && npx tsc --noEmit -p tsconfig.json
npx eslint "src/**/*.ts" "test/**/*.ts" --max-warnings 0   # 경고도 0이어야 함
cd ../web && npx eslint <바꾼파일> --max-warnings 0

# 3) 회귀 확인 — 전체 스위트
cd ../server && npx vitest run --config test/vitest.config.mjs  # 기본 `vitest`는 medium까지 물어 실패함
cd ../web && npx vitest run
```

#### 생성물 재생성 (해당 변경이 있으면 필수)
```bash
mise run //:open-api   # 컨트롤러/DTO/enum 변경 시 → OpenAPI + TS SDK + Dart SDK
mise run //:sql        # @GenerateSql 붙은 리포지토리 메서드 변경 시 → src/queries/*.sql
```

#### 마이그레이션 드리프트 검사
```bash
cd server && npx sql-tools -u "postgres://postgres:<pw>@localhost:5432/immich" migrations generate
# "No changes detected" 여야 함. 뭔가 나오면 스키마 데코레이터와 마이그레이션이 어긋난 것.
```

### 4. 이 저장소에서 실제로 밟은 지뢰

| 증상 | 원인 / 대처 |
|---|---|
| `nest build`가 EACCES로 실패 | Dev Container(root)가 `server/dist`에 파일을 만들어 둠. **`rm -rf server/dist` 후 재빌드.** 컨테이너가 도는 중이면 먼저 멈춘다 |
| 마이그레이션을 지웠는데 되살아남 | `nest build`는 오래된 산출물을 지우지 않는다. `dist` 삭제가 답 |
| CI가 i18n에서 실패 | `i18n/en.json`은 **대소문자 무시 사전순 정렬** 필수. 키 추가 후 정렬 검사할 것 |
| SDK 빌드가 `Enum member must have initializer`로 깨짐 | zod의 **nullable enum**이 스펙에 `null` 멤버를 만들고 SDK가 깨진다. nullable **string** + 설명으로 우회. 게다가 깨진 생성물이 자기 자신의 재생성을 막으므로 `git checkout`으로 되돌린 뒤 재실행 |
| dev DB에서 `corrupted migrations` | 이 개발 DB만 v3.1.0 병합 전 순서로 마이그레이션이 적용돼 있음. immich 런타임과 같은 `allowUnorderedMigrations: true`로 실행. **운영 DB는 정상 순서라 무관** |
| 테스트가 통과하는데 아무것도 검증 안 함 | 기본 설정에서 기능이 **꺼져** 있어 첫 관문에서 빠져나간 것. "안 했다"를 단언하는 테스트는 **의도한 이유로 통과하는지** 반드시 확인 (예: ledger 조회가 실제로 일어났는지 함께 단언) |
| 병합 커밋에 생성물이 누락됨 | 충돌 해결로 `git add` 한 **뒤에** 재생성을 돌려서 스테이징본이 낡음. 재생성은 `git add` **전에** |
| `mise //:sql`이 바꾼 적 없는 쿼리를 지우거나, 방금 바꾼 쿼리를 반영하지 않음 | 두 가지가 겹쳐 있었다(2026-10-01). ① 생성기는 소스가 아니라 **`dist/bin/sync-sql.js`**를 실행한다 → `rm -rf server/dist && nest build` 후 재생성. ② 생성기가 붙는 데스크탑 dev DB(`localhost:5432/immich`)가 마이그레이션이 덜 돼 있으면, 메서드의 첫 쿼리가 실패해 **두 번째 쿼리가 생성물에서 빠진다**(로그에 `column ... does not exist`). `sql-tools migrations run`은 이 DB에서 `corrupted migrations`로 거부되므로(위 행), `allowUnorderedMigrations: true`로 sql-tools의 `Migrator`를 직접 부른다 — CLI는 이 옵션을 받지 않는다. 그 뒤 `migrations generate`가 "No changes detected", 재생성 diff가 0이면 정상. 로그의 FK 위반(가짜 UUID INSERT)은 무해 |

### 5. 테스트 배치

규칙과 절차는 §2 "유닛테스트"에 있다. 여기는 **어디에 무엇을 두는가**만.

```
dev-test/[기능]/
├── run.sh        기능 전체 테스트 한 번에 실행 → results/ 에 기록
├── README.md     무엇을 어느 스펙에서 테스트하는지, 일부러 안 덮은 곳
└── results/      실행 결과 (리뷰 리포트에 첨부하는 증거)

server/src/**/*.spec.ts          유닛 — 소스 옆
server/test/medium/specs/**      실DB 통합 — 쿼리·조인이 correctness 경계일 때
web/src/**/*.spec.ts             웹 유닛
```

- Mock은 `test/utils.ts`의 `newTestService` + `automock`.
- 실DB 통합 테스트는 **SQL 자체가 정확성을 결정할 때** 쓴다. 유닛 테스트는 "쿼리 빌더가
  호출됐다"까지만 말할 수 있다 — 공유 해제 시 업로드 중단 같은 성질은 Postgres에서 확인해야
  하고, 실제로 그렇게 해서 첫 구현의 오류를 잡았다.

### 6. 코딩 컨벤션

- **주석은 의도와 배경을 쓴다.** "무엇을 하는지"가 아니라 **"왜 이렇게 했는지, 어떤 함정이
  있었는지"**. 이 포크의 기존 코드가 기준선이다 — 짧은 설명보다 문단 주석을 선호한다.
- 포맷·린트는 도구에 맡긴다(Prettier/ESLint). 손으로 맞추지 않는다.
- 서비스끼리 주입하지 않는다. 공유 로직은 `src/utils/*.ts`에 리포지토리를 인자로 받는
  순수 함수로 둔다(`utils/asset.util.ts` 관례).
- 컨트롤러 메서드 이름 = SDK 함수 이름이다. **기능 이름을 포함해 길게** 짓는다
  (`getGoogleDriveStatus`, `getStatus` 아님).
- `@Endpoint(...)` 사용(`@ApiOperation` 아님), 태그는 `ApiTag` enum.

### 7. 운영 환경 (이 포크 고유)

```
[데스크탑 WSL]  개발 + 이미지 빌드          [랩탑 192.168.50.211]  운영 immich
  Dev Container (핫리로드, 소스 마운트)  →    docker compose, ~/immich-app
  localhost:2283/3000                        사진 /mnt/immich_data/library
```

- **개발과 배포는 다른 모드다.** Dev Container는 소스를 마운트해 즉시 반영(개발용).
  운영은 이미지를 빌드해 배포. 둘을 헷갈리지 말 것 — 특히 **같은 2283 포트를 두고 충돌**한다.
- **배포 절차** (⚠ §1: 리뷰 사이클을 통과하지 않은 커밋은 배포하지 않는다):
  ```bash
  docker build -f server/Dockerfile -t immich-server:3.1.0-gdrive .
  ssh 랩탑 'pg_dumpall | gzip > ~/immich-backups/immich-db.$(date +%F-%H%M).sql.gz'   # 먼저 백업
  docker save immich-server:3.1.0-gdrive | gzip -1 | ssh 랩탑 'gunzip | docker load'  # 약 2분
  ssh 랩탑 'cd ~/immich-app && docker compose up -d'
  ```
  compose에서 우리가 바꾸는 것은 `immich-server`의 `image:` **한 줄뿐**이다. 나머지 3개
  컨테이너(postgres/redis/ML)는 공식 이미지를 그대로 쓴다.

  **⚠ 계정 스코프 원장(`driveAccountId`)이 들어간 뒤로는 배포 직후 순서가 중요하다.** 기존
  원장 행은 `''`(계정 미상)이고, 아직 식별되지 않은 연결도 `''`로 읽혀 서로 매칭된다 — 그래서
  배포만으로는 아무것도 재업로드되지 않는다. 하지만 **입양(adoption)이 돌기 전에 연결을 해제하고
  다시 연결하면** 그 행들이 매칭에 실패해 라이브러리 전체가 중복으로 다시 올라간다. 그래서:

  **배포 순서 (round 21~27 리뷰가 합의한 목록. 순서가 의미를 가진다).**

  *배포 전*
  1. **redirect 파생이 살아 있는지 확정한다 — 유일한 하드 게이트.** `server.externalDomain`과
     `googleDrive.redirectUrl` 중 **최소 하나가 채워진 상태**로 배포한다. 둘 다 비면
     `isGoogleDriveEnabled`가 거짓이 되어 **에러 없이** 기능이 꺼진다. 관리 폼은 이제 없으므로
     `redirectUrl`은 `IMMICH_GOOGLE_DRIVE_REDIRECT_URL` 또는 저장된 설정 row에서 온다.
  2. DB 백업 (아래 명령).
  3. 업스트림 다운그레이드가 아닌지 확인 (`git merge-base --is-ancestor <운영 태그> HEAD`).
  4. 연결이 만료·취소되면 **폴더 선택도 함께 사라진다**는 것을 알고 시작한다 — 재연결 의식에
     폴더 다시 고르기가 포함된다.

  *배포 직후*
  5. **기능이 켜졌는지 먼저 확인한다.** 확인할 곳은 `GET /api/server/features`의 `googleDrive`
     필드다(`server.service.ts:122`가 `isGoogleDriveEnabled`를 그대로 노출한다).
     ```bash
     curl -s http://192.168.50.211:2283/api/server/features | python3 -c 'import json,sys; print(json.load(sys.stdin)["googleDrive"])'
     ```
     **`getGoogleDriveStatus`를 이 용도로 쓰면 안 된다** — `enabled` 필드가 없고, 게다가 그
     호출이 신원 프로브를 트리거하므로 "열기 전"의 관측이 될 수 없다. (round-25·26 체크리스트가
     이 필드를 잘못 지목했고 round-27이 잡았다.)
  6. **설정 화면을 한 번 연다.** 이것이 트리거하는 것은 **계정 식별**이다. 기존 6,996행에 대한
     입양은 여기서 일어나지 않는다 — 그 행들은 `connectionId`가 비어 있다. 프로브에는 사용자당
     60초 쿨다운이 있으니 `(unidentified)`면 1분 뒤 다시 연다.
  7. 아래 게이트 쿼리로 사용자별 `drive_account` / `unstamped`를 본다.
  8. **진행 카드의 대기 수를 한 번 본다.** `''` 매칭이 회귀했다면 여기에 6,996 근처 숫자가 뜬다.
     중복은 나지 않지만(gate 2가 받는다) 큐가 이미 한 일로 찬다 — 보이면 롤백 판단 재료다.
     **wave11 이후:** 대기 수에는 재시도 상한(5회)에 걸린 사진도 남는다(차단된 사용자의 대기가 남는 것과
     같은 이유). 그래서 0이 안 되고 멈춘 작은 숫자는 그 자체로 막힌 큐가 아니다 — 실패 목록에서
     attempts가 5 **이상**인 행을 먼저 본다(수동 동기화가 실패하면 상한을 넘어서도 계속 올라간다).

  *운영 습관*
  9. **연결 해제·재연결은 업로드가 도는 중에 하지 않는다.** Jobs 화면에서 대기 0을 확인한 뒤에.
  10. ~~`refreshToken` nullable + CAS를 `connectionId`로~~ **CAS만 옮겼다(2026-09-16).** `setDriveAccountId`·
      `adoptUnstampedUploads`·`fillFolderName`이 이제 `connectionId`로 비교한다(재연결마다 새로 발급, NOT NULL).
      **nullable(소프트 해제)은 버렸다** — 동기였던 Testing 앱의 7일 만료가 In production 전환으로 사라졌고,
      "행이 있으면 연결됨" 가정이 쿼리 9곳·서비스 7곳에 걸려 있어 드문 사건을 위해 영구적인 3상태 부담을 지는
      셈이었다. 취소·해제는 여전히 행 삭제이고, 재연결 때 폴더를 다시 고른다. 다시 검토할 일이 생기면 설계는
      `dev-docs/review/google-drive/review/*round24*` §5에 있다.

  ```bash
  # 1) 배포 후 설정 화면을 한 번 연다.
  #    입양을 트리거하는 것은 getStatus이고, 설정 화면이 로드 시 부르는 것이 그것이다.
  #    (앨범 메뉴의 storage 호출도 트리거하지만, 설정 화면은 storage를 부르지 않는다.)
  # 2) 사용자별로 미상 행이 남았는지 본다. (드레인이 들어온 뒤로 연결 해제가 금지는 아니다 —
  #    아래 설명 참고. 0은 목표이지 관문이 아니다.)
  #    합계가 아니라 사용자별로 보는 이유: 한 사용자가 0이어도 다른 사용자가 남아 있을 수 있고,
  #    "누구를 기다리는가"를 알아야 다음 행동이 정해진다.
  # 인용이 중첩되지 않도록 heredoc으로 넘긴다. `-c '…'` 안에 SQL의 작은따옴표를 넣으려던
  # 첫 버전은 셸에서 문자열이 끊겨 psql이 `unterminated quoted string`으로 죽었다.
  ssh 랩탑 'docker exec -i immich_postgres psql -U postgres -d immich' <<'SQL'
  select u."userId",
         coalesce(u."driveAccountId", '(unidentified)') as drive_account,
         count(g.*) filter (where g."driveAccountId" = '') as unstamped
  from user_google_drive u
  left join google_drive_upload g on g."userId" = u."userId"
  group by 1, 2;
SQL
  ```

  `drive_account`가 `(unidentified)`면 아직 설정 화면을 안 열었거나 **신원 프로브가 실패**하는
  것이다 (서버 로그의 `did not report a permissionId` / `Could not read the Google Drive account
  id`를 본다. 프로브에는 사용자당 60초 쿨다운이 있으니 1분 뒤 다시 열어 본다).

  **`unstamped`는 0이 되지 않는 것이 정상이다.** 입양은 *그 연결이 직접 쓴* 행만 가져간다
  (`connectionId`가 같은지로 판정한다 — 예전의 `uploadedAt >= connectedAt` 시간 비교는 round-21에서
  버렸다). 배포 전에 올라간 6,996행은 `connectionId`가 비어 있어 어떤 연결도 가져가지 못하므로
  영원히 미상으로 남고, 그래도 "업로드됨"으로 매칭되므로 재업로드는 나지 않는다. 이 숫자는 **감시용 지표**
  이지 관문이 아니다 — 배포 후 갑자기 늘어난다면 그때가 이상 신호다.

  미상(`''`) 행이 계정 식별 뒤에도 계속 "업로드됨"으로 매칭되는 것이 그 안전망이다 —
  `files.create`에 멱등 검사가 없어 중복은 되돌릴 수 없으므로, 매칭하지 않는 쪽이 훨씬 비싸다.

  **확인해야 할 진짜 관문은 "식별된 계정이 맞는 계정인가"다.** 이건 서버가 판정할 수 없다 —
  6,996행의 `connectionId`가 비어 있어, 코드 입장에서 지금 연결은 그 행들을 쓴 연결이 **아니라고
  단정할 수도 맞다고 단정할 수도 없다**(그래서 입양하지 않고 그대로 둔다). 같은 사람이라는 사실은
  사장님만 안다. 그래서 배포 후 한 번, 위 쿼리의 `driveAccountId`가 실제로 쓰던 구글 계정인지
  눈으로 확인한다.

  **연결 해제·재연결을 먼저 해도 안전하다.** 연결이 끝나는 두 순간(재링크 직전, 연결 해제 직전)에
  떠나는 토큰으로 **그 연결이 직접 쓴** 미상 행을 그 계정에 넘긴다(입양과 같은 기준이다 — 이제
  시간이 아니라 `connectionId`가 같은지로 판정한다). **배포 전에 쌓인 6,996행은 `connectionId`가
  비어 있어 드레인 대상이 아니다** — 그래서 이 시점의 드레인은 실질적으로 0행을 옮긴다. 그래도
  안전한 이유는 그 행들이 어떤 연결과도 매칭되기 때문이고, 드레인이 실패해도 같은 안전망이 받는다.

  **재연결하면 폴더를 다시 골라야 한다.** 권한이 취소·만료되면 `user_google_drive` 행을 통째로
  지우는데, `folderId`/`folderName`이 그 행에 함께 있다. OAuth 앱이 Testing인 동안은 7일마다
  이 경로를 타므로 재연결 의식에 폴더 선택이 포함된다. 폴더를 바꾸는 것은 앞으로의 업로드에만
  영향을 주고 이미 올라간 파일은 그대로 있으므로 원장에는 무해하다.

  `drive_account`가 불투명한 숫자로 보이는 것이 정상이다 — Drive의 `permissionId`이고 사람이 읽는
  주소가 아니다. **확인 방법은 값 자체를 알아보는 것이 아니라, 그 값이 하나뿐이고 배포 전후로
  바뀌지 않는지 보는 것이다.** 두 개가 나오거나 나중에 달라졌다면 다른 계정이 연결된 것이고,
  그때가 §1의 "운영 데이터에 손대기 전에 확인" 순간이다.

  입양은 **기존 토큰이 살아 있는 동안에만** 일어난다(연결 경로에서는 절대 하지 않는다 — 그때
  토큰은 새것이고 다른 계정일 수 있다).
- **구글 OAuth 연결은 Tailscale HTTPS 주소로 한다** (Wave 6). 구글이 redirect URI로 사설 IP를
  거부하고 공개 HTTPS 또는 `localhost`만 받기 때문이다. 랩탑의 tailnet 주소
  `https://ha-server.tail68cec7.ts.net`가 그 조건을 만족한다.

  ```
  폰 immich 앱  ──────→ http://192.168.50.211:2283   (그대로, LAN)
  Drive 연결 브라우저 ─→ https://ha-server.tail68cec7.ts.net  (OAuth 플로우만)
  ```

  **연결 시작과 콜백이 같은 origin이어야 한다** — state 쿠키가 origin에 묶여 있다. 그래서 "연결할
  때만" 이 주소로 로그인해서 끝까지 진행한다. 연결이 끝나면 업로드는 랩탑이 구글과 직접 하므로
  평소 사용은 LAN 주소 그대로다. **모바일 앱 엔드포인트는 바꾸지 않는다** — serve는 기존 2283 위에
  HTTPS 입구를 *추가*하는 것이지 대체가 아니다.

  **자격증명은 지금 전부 저장된 설정 row에서 온다.** 랩탑 `~/immich-app/.env`, 컨테이너 환경,
  compose 파일 어디에도 `IMMICH_GOOGLE_DRIVE_*` 변수는 **하나도 없다**(2026-09-16 이름만 확인).
  env로 옮기려면 네 값(`_CLIENT_ID` / `_CLIENT_SECRET` / `_API_KEY` / `_REDIRECT_URL`)을 사용자가
  직접 `.env`에 넣어야 한다(**값은 절대 커밋·출력하지 않는다** — §1). redirect URL은 External
  Domain에서 파생되는 것이 기본이고, 이 배포처럼 그럴 수 없을 때만 따로 지정한다. 자세한 내용은 `dev-docs/google-drive/wave6-plan.md`.

- **SSH 터널은 이제 개발용 폴백이다.** 두 경우에 아직 쓴다: ① dev container에서 `localhost:2283`
  redirect로 OAuth를 시험할 때, ② 데스크탑 브라우저로 운영 화면을 확인할 때(tailnet 주소를 쓰면
  이것도 불필요하다).

  ```bash
  ssh -N -L 2283:localhost:2283 gwyun@192.168.50.211   # 이후 브라우저는 localhost:2283
  ```

  PuTTY로 할 경우 — Session에 `192.168.50.211`(포트 22)을 넣고,
  **Connection → SSH → Tunnels**에서 Source `2283` / Destination `localhost:2283` /
  **Local** 선택 후 **Add**. 목록에 `L2283  localhost:2283`이 떠야 걸린 것이다. 그 다음 Open,
  **창은 열어둔다**.

  **⚠ 터널을 쓰기 전에 Dev Container를 끈다.** Dev Container가 데스크탑의 2283을 차지하고
  있으면 브라우저가 랩탑이 아니라 그 컨테이너에 붙어 `ERR_EMPTY_RESPONSE`가 난다(실제로
  두 번 겪었고, 원인을 찾는 데 시간을 썼다). 확인:
  ```bash
  ss -tln | grep :2283          # 비어 있어야 한다
  docker ps | grep immich_server # 데스크탑에 떠 있으면 docker stop
  ```
  VS Code에서 immich-dev 창을 열면 컨테이너가 되살아나 다시 뺏으므로, 터널을 쓰는 동안은
  그 창을 닫아둔다.

  **PuTTY의 Open이 아무 반응 없을 때**는 Tunnels 화면에서 바로 Open을 눌러 Session의
  Host Name이 비어 있는 경우다. Session 화면으로 돌아가 주소를 확인하고 다시 Open한다.

  평소 사용은 `http://192.168.50.211:2283`으로 한다.
- 랩탑에서 테스트를 직접 구동할 때는 API 키를 쓴다(`x-api-key`). 브라우저 클릭을 사용자에게
  시키기 전에, 직접 할 수 있는지 먼저 검토한다.

### 8. 도메인 지식 (Google Drive 기능)

설계 근거는 `dev-docs/google-drive/feature-roadmap.md`, 실패 처리는 `failure-handling-plan.md`,
설정·redirect 구조는 `wave6-plan.md`. 반복해서 문제가 되는 사실들:

- **clientId/clientSecret은 앱(이 배포본)의 신원이지 사용자 계정이 아니다.** 서버에 내장해도 각
  사용자는 자기 구글 계정으로 로그인해 자기 Drive에 연결한다. 다만 Google Cloud 앱이 "Testing"
  상태인 동안은 **Test users에 등록된 계정만** 연결할 수 있다.
- **redirect URL은 `externalDomain`에서 파생된다**(`getGoogleDriveRedirectUrl`). 필드는 override로만
  남아 있다. `getExternalDomain()`의 `https://my.immich.app` 폴백을 여기 쓰면 안 된다 — 그럴듯하지만
  틀린 redirect는 구글의 불투명한 에러를 낳고, 빈 값은 기능을 꺼서 원인을 말해준다.
- **관리 화면에 Google Drive 항목은 더 이상 없다.** 배포는 `IMMICH_GOOGLE_DRIVE_*` 환경변수로만
  기술된다. `enabled` 플래그도 폐지했다 — 자격증명이 있고 redirect URL을 얻을 수 있으면 켜진 것이다.
  끄려면 `IMMICH_GOOGLE_DRIVE_CLIENT_ID`를 비우고 재시작한다.
- **⚠ 단, 저장된 설정 row가 env를 이긴다.** `buildConfig`가 partial을 defaults **위에** 덮으므로,
  row에 `googleDrive.clientId`가 들어 있으면 env를 비워도 꺼지지 않는다. **운영 row에는 다섯 키가
  모두 들어 있다**(2026-09-14 확인: clientId·clientSecret·apiKey·redirectUrl·enabled). 즉 이 인스턴스는
  아직 env로 기술되지 않는다.
  **정리 방법** (wave8b 리뷰 C1이 조건을 바로잡음):
  1. 네 키(clientId·clientSecret·apiKey·redirectUrl) **전부**를 env에 row와 같은 값으로 넣고 재시작한다.
  2. `GET /api/system-config/defaults`(관리자 API 키, `systemConfig.read` 권한)로 env 값이 defaults에
     들어왔는지 **확인한다**. ⚠ 이 응답은 `clientSecret`을 **평문으로** 돌려준다 — 절대 그대로
     출력하지 말고 파이프로 길이만 뽑는다:
     `curl -s -H "x-api-key: $KEY" http://192.168.50.211:2283/api/system-config/defaults | python3 -c 'import json,sys; g=json.load(sys.stdin)["googleDrive"]; print({k: len(v) for k, v in g.items()})'`
     defaults는 모듈 로드 시 `process.env`로 만들어지므로 env를 바꾼 뒤에는 재시작이 필요하다.
  3. 관리 화면에서 **실제로 값 하나를 바꿔** 저장한다. 웹은 전체 설정을 보내지만, 아무것도 안 바꾸면
     `isEqual`에 걸려 요청 자체가 나가지 않는다. 바꾼 값은 다음 저장에서 되돌리면 된다.
  `updateConfig`는 defaults와 같은 값을 저장에서 빼므로, 네 키가 모두 같을 때만 googleDrive partial이
  통째로 사라진다. **하나라도 다르면 그 키만 row에 남아** 계속 env를 이긴다. 폐지된 `enabled`는
  스키마가 모르는 키라 이 저장에서 함께 떨어진다. DB를 직접 손댈 필요가 없다.
  **정리하지 않아도 배포는 안전하다** — row가 모든 값을 공급하므로 기능은 그대로 켜져 있다.

- **Drive는 최종 저장소가 아니라 Pixel로 가는 경유지다.** 따라서 Drive에서 파일이 사라지는
  것은 정상 운영이고, 원장(ledger)이 "이미 올렸음"을 기억하는 것이 옳다.
- **업로드·중복방지는 `(userId, assetId)` 축이다. 앨범 차원이 없다.** 사진 하나가 여러
  앨범에 속할 수 있으므로, "이 앨범을 백업 안 함"은 "이 사진들을 안 올림"과 다르다.
- 중복 방지는 3겹: 큐잉 전 ledger 필터 → BullMQ `jobId` dedup → 워커의 `hasUpload` 재확인.
- 실패는 `google_drive_upload_error`에 기록된다(ledger와 반대 극성, 성공 시 삭제).
  **계정 단위 차단**(`quota_exceeded`, `folder_missing`)은 워커 입구에서 전체를 스킵시킨다.
- **404를 무조건 "폴더 없음"으로 보면 안 된다** — resumable 세션 만료도 404다. `notFound`
  reason + 폴더 설정됨 조건을 모두 만족해야 계정을 차단한다.

### 9. 주의사항

- **AGPL-3.0.** 업스트림 라이선스를 따른다.
- **스키마 변경에는 마이그레이션이 필수**이고, 이미 적용된 마이그레이션은 **수정하지 않고**
  새 파일을 추가한다(적용된 DB는 재실행하지 않으므로 편집해도 반영되지 않는다).
- **업스트림 다운그레이드 금지.** 브랜치를 배포하기 전에 운영 버전과 같은 태그 위에
  올라와 있는지 확인한다(`git merge-base --is-ancestor <tag> HEAD`).
- 대용량 처리(수천 장 동기화) 경로는 스트리밍·청킹을 쓴다. `DATABASE_PARAMETER_CHUNK_SIZE`,
  `JOBS_ASSET_PAGINATION_SIZE` 참고.

---

## Current Project: Google Drive sync 안정화 (wave11)

### Context
- Goal: 사용자가 겪은 "가끔 업로드 실패하는 사진"을 없애고, 일시 실패가 사람 손 없이 복구되게 한다.
  범위는 넓게(사용자 선택). 완료 = 유닛·medium 통과 + 리뷰 사이클 통과.
- **계획 전체: `dev-docs/google-drive/stabilization-plan.md`** (작업 체크리스트도 거기 있다 — 세션에
  todo 도구가 없었다). 리서치: `.claude/docs/research/google-drive-sync-stabilization.md`.
- 운영 상태 (2026-09-29, `-w10`): 연결 1명 `connectedAt = 2026-09-14`(15일 생존 → 7일 만료 소멸 확인,
  이전 프로젝트의 원래 목표는 닫혔다), 원장 8,273, 오류 1건(`source_unreadable`, 아래 F1의 경합).
- Key files: `server/src/services/google-drive.service.ts`(openOriginal, files.create),
  `server/src/utils/google-drive.ts`(classify/retry), `server/src/repositories/google-drive.repository.ts`
  (streamPendingUploads, recordUpload), `server/src/services/queue.service.ts`(nightly),
  `server/src/cores/storage.core.ts`(move order).

### Decisions
- **업로드는 multipart다**(googleapis-common이 `requestBody`가 있으면 `uploadType`을 덮어씀). 그래서
  in-call retry는 소비된 스트림을 다시 보낸다 → `retry: false`, 재시도는 야간 backfill이 맡는다.
- **BullMQ는 Drive 잡의 실패를 보지 못한다**(`JobService.onJobRun`이 삼킴) → BullMQ attempts/backoff·
  핸들러 내 재큐잉(같은 jobId)은 쓸 수 없다.
- **F1은 타이머가 아니라 `move_history`로 푼다** — 이동 행은 rename 전에 생기고 마지막에 지워진다.
- **멈춤 감지는 전체 timeout이 아니라 진행 없음 120초 abort** — node-fetch timeout은 본문 전송 전체를 덮는다.
- **재시도 상한은 비차단·비RateLimited 전 클래스에 건다**(unknown만이 아니라) — 진짜 없는 파일이 매일 밤 돈다.
- 수용한 지연: 일시 실패는 **≤24h** 안에 복구(또는 수동 앨범 동기화로 즉시).
- 이전 프로젝트의 결정(도메인, wave8 설정 화면 삭제, soft-disconnect 기각, 배지 비조인)은 §7·§8에 있다.

### Verification plan
최하위 설정 티어는 `verify-task`(`verify-unit` 없음). 위험 라운드 뒤와 마지막은 §3 절차(= "§3").

| ID | 무엇을 검증하는가 | 명령 | 티어 | 실패해야 할 때 실패하는가 |
|----|------------------|------|------|---------------------------|
| V1a | 행 경로 불변 + move 행 → newPath로 읽어 업로드, 오류 행 없음 | service spec | task | move 조회 제거 → 스킵 |
| V1b | move 행 없음 + 재조회 불변 → 종결 스킵 `source_unreadable` | service spec | task | 항상 newPath 재시도 → 실패 |
| V1c | newPath도 ENOENT → 스킵, detail에 두 경로 | service spec | task | 옛 경로 누락 → 실패 |
| V1d | mover 순서: move 행 → rename → asset 행 → move 행 삭제 | storage-template.service spec (core spec엔 mock 하네스 없음) | task | 순서 뒤집기 → 실패 |
| V1e | `oldPath`가 실패한 경로와 다른 move 행은 무시 | service spec | task | 가드 제거 → 실패 |
| V1f | move 행 없음 + 두 번째 행 조회에서 새 경로 → 업로드 | service spec | task | 두 번째 조회 제거 → 실패 |
| V1g | 첫 읽기가 ENOENT 아닌 오류(EMFILE)면 move 행을 따르지 않음 (EXDEV 복사 중 부분 파일 방지, wave11b M1) | service spec | task | ENOENT 가드 제거 → 실패 |
| V2 | files.create `retry: false`, 5xx 비재시도·기록 | service spec | task | retryConfig 복원 → 실패 |
| V3 | signal+onUploadProgress, 120s idle → abort → unknown + 스트림 파기, 진행 시 타이머 리셋, 본문 전송 완료 후엔 10분 응답 한도, 종료 후 타이머 0 | service spec (fake timers) | task | 리셋 제거·응답 한도 제거·finally clearTimeout 제거 → 각각 실패 |
| V4 | 403 사유별 분류(insufficientPermissions→unknown, rate/daily→RateLimited, quota) | utils spec | task | "모든 403=RateLimited" 복원 → 실패 |
| V5 | nightly가 enabled일 때만 QueueAll 큐잉 + dedup id | queue.service spec | task | disabled에도 큐잉 → 실패 |
| V6 | 상한 미만 **포함**, 이상 제외, RateLimited는 상한 무시(차단 클래스는 사용자 단위 조건이 먼저 걸러 이 경로로는 관측 불가), 다른 사용자 행과 무관, "실패 재시도"로 행이 지워지면 재포함 (수동 동기화는 행을 지우지 않고 상한을 우회할 뿐) | medium | §3 | 조건 제거·off-by-one·반전·상관 제거 → 실패 (조용한 "아무것도 안 큐잉" 방지) |
| V7 | `source_unreadable` detail에 errno(`[EMFILE]` 등) 포함 — 새 클래스 없이 구분 (R3에서 계획 변경) | service spec | task | errno 제거 → 실패 |
| V8 | 이전 실패 후 성공 → 시도 횟수 로그 + 오류 행 삭제 | service spec | task | 로그 제거 → 실패 |
| V9 | streamPendingUploads가 타 사용자·삭제 앨범 제외 | medium | §3 | 조건 한 번 제거 → 실패 |
| V10 | files.create throw 시 스트림 파기 | service spec | task | finally 제거 → 실패 |
| V11 | getStorage/getPickerConfig 취소 토큰 → grant 삭제 (Revoked 행은 자산 FK 때문에 이 경로에선 불가) — 기존 테스트가 이미 덮음 | service spec | task | clearRevokedGrant 생략 → 실패 (2026-10-01 확인) |
| V12 | 업로드 중 파일 스트림 'error'(EIO) → 프로세스 크래시 없이 abort + `source_unreadable` 기록 (wave11c M1) | service spec | task | 리스너 제거 → 실패 |
- 검증하지 않는 것: 실 구글 API의 429/5xx/idle(모킹만), 실제 느린 업로드에서의 abort, 실제 EXDEV 이동과의
  경합(V1g는 mock 순서로만 재현). (오래된 move 행 문제는 R1의 `oldPath` 가드 + V1e로 검증 대상이 됐다.)
- 검증할 수 없는 것: 야간 backfill이 운영에서 실제로 치유하는지 — 배포 후 며칠 관찰(오류 테이블 + F7 로그).

### Notes (지뢰)
- **`redirectUrl`과 `externalDomain`이 둘 다 비면 기능이 조용히 꺼진다** — 배포 전 유일한 하드 게이트(§7).
- **운영 row에는 아직 다섯 키가 남아 있고 env를 이긴다.** 랩탑 `.env`·컨테이너 env·compose 어디에도
  `IMMICH_GOOGLE_DRIVE_*`는 없다(2026-09-16 이름만 확인). 그래서 로그에 폐지된 `enabled` 키 때문에
  `Unknown keys found` 경고가 매 기동 뜬다 — 무해하고, §8의 정리 절차를 밟으면 사라진다.
- **재연결하면 폴더를 다시 골라야 한다**(권한 취소 시 행 전체가 삭제되므로). In production 전환으로
  빈도는 "매주"에서 "사용자가 직접 취소할 때"로 떨어졌다.
- **데스크탑 dev container가 호스트 2283을 점유**해 SSH 터널과 상호 배타적이다.

### Tasks
라운드 R0~R4와 체크리스트는 `dev-docs/google-drive/stabilization-plan.md` "Task list".

이전 프로젝트(연결 유지)에서 이월된 열린 항목 — 이 wave 범위 밖:
7. **구글 로그인만으로 Drive 연결** (진행 중) — 로그인 동의에서 받은 refresh token을 첫 연결에 한해
   저장한다. 세 조건(구글 issuer / 로그인 clientId == Drive clientId / 로그인 스코프에 `drive.file`)을
   모두 만족할 때만 동작하고, 그 전까지는 코드가 있어도 아무 일도 하지 않는다. 켜려면 사용자가
   Google 콘솔에 redirect URI를 추가하고 관리 화면 OAuth를 설정해야 한다(autoRegister는 꺼 둘 것).
8. (선택) 설정 row 정리 → env 기술로 전환. 네 값을 사용자가 직접 `.env`에 넣어야 한다(§8).
9. (선택) dev container를 다른 호스트 포트로 옮겨 터널과 공존.
