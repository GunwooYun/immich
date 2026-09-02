# Claude Code Orchestrator

**멀티 에이전트 협업 프레임워크**

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
Bash("agy -p '한 문장으로 답변' --model gemini-3.7-flash-low")
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

→ 참고: `.claude/rules/antigravity-delegation.md`

---

## Workflow

```
/startproject <기능명>
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
    - 실행 가능한 태스크 리스트 생성
5. **필수** (§1 — 권장이 아니다)
    - **구현 완료 후 별도 세션에서 리뷰.** 리뷰를 통과하지 않은 커밋은 배포하지 않는다.

→ 관련 커맨드: `/startproject`, `/plan`, `/tdd` skills

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

---

## 운영 주의사항 (Operational Notes)

- **서브에이전트는 서브에이전트를 못 띄운다.** general-purpose 안에서 설계 판단이 필요해지면 결과만 보고하고, 메인이 `Task(subagent_type="deep-reasoning")`를 호출한다.
- **`/checkpointing`(기본 모드)은 `CLAUDE.md`와 `.agents/rules/AGENTS.md`의 Session History 섹션을 덮어쓴다.** 실행 전에 커밋해 두고, 리뷰 전용 세션에서는 실행하지 않는다. 이 파일에는 아직 Session History 섹션이 없으며, 생기면 `## Fork Rules`와 `## Current Project` 블록이 그 **앞**에 오도록 유지한다. **`/startproject`(Phase 5)는 `## Current Project`만 교체한다** — `## Fork Rules`를 건드리면 안 된다.
- **리뷰는 별도 세션에서.** 구현한 세션은 자기 코드에 편향되므로 `git worktree add --detach ../<project>-review main`으로 격리한 새 `claude` 세션에서 "리포트 파일만 작성, 다른 파일 수정 금지"로 리뷰를 받고, 원 세션에서 반영한다. 세션 안에서 deep-reasoning 서브에이전트에게 받는 리뷰는 **이 사이클의 대체가 아니라 보조**다 — 작성자와 같은 세션에서 나온 판단이므로 §2의 리뷰 요청서·리뷰 파일을 면제하지 않는다.
- **훅 파일명을 바꾸면 `.claude/settings.json` 등록 경로를 같은 커밋에서 함께 바꾼다.** 어긋나면 PreToolUse 훅 오류로 모든 Edit이 막힌다.
- **agy 헤드리스 호출의 빈 응답은 실패다** (soft-deny, exit 0). stderr를 버리지 말고 `--output-format json`의 `.status`/`response`로 판단한다. 파일을 읽는 호출은 템플릿 패턴의 플래그와 "파일 수정 금지" 문구를 그대로 쓴다.
- **deep-reasoning의 읽기 전용은 도구 제거 + 지시**이지 커널 샌드박스가 아니다. 커밋 전 `git status`로 의도치 않은 변경을 확인한다.

---

## 언어 프로토콜(Language Protocol)

- **사고/코드/로그**: 영어
- **사용자대화/설명**: 한국어

---

## Fork Rules (이 포크의 작업 규칙)

`immich-app/immich`의 개인 포크. 업스트림 기능을 개선하고 새 기능을 추가한다.

**이 절은 `## Current Project`와 다르다.** `## Current Project`는 `/startproject`가 기능마다
새로 쓰는 블록이고, 이 절은 **기능이 바뀌어도 남는 규칙**이다 — 절대 규칙, 리뷰 사이클, 검증 절차,
실제로 밟은 지뢰, 운영 환경. 스킬이 덮어쓰지 않도록 헤딩을 분리해 두었다.
(2026-09-02 `/init` 템플릿과 `/startproject`가 같은 헤딩을 두고 충돌하던 것을 정리한 결과다.)

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

  자격증명은 랩탑 `~/immich-app/.env`의 `IMMICH_GOOGLE_DRIVE_CLIENT_ID` / `_CLIENT_SECRET` /
  `_API_KEY`에서 온다(**값은 절대 커밋하지 않는다** — §1). redirect URL은 admin의 External Domain
  설정에서 파생되므로 따로 입력하지 않는다. 자세한 내용은 `dev-docs/google-drive/wave6-plan.md`.

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
- **env 값이 DB에 고착되지 않는 이유**: `updateConfig`가 defaults와 diff해 "비었거나 같으면" 저장을
  생략한다. env 값이 곧 defaults라 무변경 저장은 아무것도 쓰지 않는다. 대신 **env가 제공하는 필드는
  UI에서 빈 값으로 강제할 수 없다** — 끄려면 `enabled` 토글을 쓴다.

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
