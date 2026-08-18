# CLAUDE.md

`immich-app/immich`의 개인 포크. 업스트림 기능을 개선하고 새 기능을 추가한다.
현재 진행 중: **Google Drive 앨범 동기화** (`dev-docs/google-drive-*.md`).

이 파일은 매 세션 컨텍스트에 로드된다. **저장소를 읽으면 알 수 있는 것은 적지 않는다**
(디렉토리 구조, 언어 비율, 업스트림 문서). 여기 있어야 할 것은 **읽어서는 알 수 없는 것**
— 이 포크의 결정, 실제로 밟았던 지뢰, 반복해서 틀리는 지점이다.

---

## 1. 절대 규칙

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

## 2. 개발 워크플로우

### 문서화
- 새 기능은 `dev-docs/[기능]-*.md`에 설계를 쓴다. 새 세션에서 문맥을 잡을 수 있도록
  텍스트 도식(ASCII, 표)을 적극 활용하고, **결정의 근거("왜 이렇게 했는가")를 남긴다.**
- 문서가 코드와 어긋나면 문서를 고친다. 오래된 진행 문서를 근거로 리뷰가 잘못 나간 적 있다.

### 리뷰 (코드 변경은 예외 없이)
1. 변경 후 `dev-docs/[기능]-review-request-N.md`로 리뷰 요청서를 쓴다.
   - **무엇을 공격해달라고 할지 명시한다.** 특히 새로 쓴 로직, 전제에 기대는 부분.
   - **검증한 것과 검증하지 못한 것을 구분해 적는다.** ("quota 경로는 mock으로만 테스트됨")
   - 생성물(SDK·OpenAPI·SQL)은 읽지 말라고 알려준다 — 리뷰 시간 낭비.
2. 리뷰 결과는 `dev-docs/[기능]-*-review.md`로 저장된다.
3. **판정을 원 계획 문서에 되먹인다.** 다음 사람이 같은 것을 다시 발견하지 않도록.

### 커밋
- Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `merge:`).
- **커밋 메시지는 길고 친절하게.** 무엇을 바꿨는지가 아니라 **왜 필요했는지, 어떤 대안을
  버렸는지, 무엇을 일부러 안 했는지**를 쓴다. 이 저장소의 기존 커밋들이 기준선이다.
- 논리 단위로 나누되, 나누면 빌드가 깨지는 경우(같은 함수를 여러 관심사가 건드림)는
  합치고 메시지 본문에서 구분해 설명한다.

## 3. 반드시 지켜야 할 검증 절차

코드 변경 후, 커밋 전:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"

cd server && npx tsc --noEmit -p tsconfig.json          # 타입
npx eslint "src/**/*.ts" "test/**/*.ts" --max-warnings 0 # 린트 (경고도 0이어야 함)
npx vitest run --config test/vitest.config.mjs           # 유닛 (기본 `vitest`는 medium까지 물어 실패함)

cd ../web && npx vitest run
npx eslint <바꾼파일> --max-warnings 0
```

### 생성물 재생성 (해당 변경이 있으면 필수)
```bash
mise run //:open-api   # 컨트롤러/DTO/enum 변경 시 → OpenAPI + TS SDK + Dart SDK
mise run //:sql        # @GenerateSql 붙은 리포지토리 메서드 변경 시 → src/queries/*.sql
```

### 마이그레이션 드리프트 검사
```bash
cd server && npx sql-tools -u "postgres://postgres:<pw>@localhost:5432/immich" migrations generate
# "No changes detected" 여야 함. 뭔가 나오면 스키마 데코레이터와 마이그레이션이 어긋난 것.
```

## 4. 이 저장소에서 실제로 밟은 지뢰

| 증상 | 원인 / 대처 |
|---|---|
| `nest build`가 EACCES로 실패 | Dev Container(root)가 `server/dist`에 파일을 만들어 둠. **`rm -rf server/dist` 후 재빌드.** 컨테이너가 도는 중이면 먼저 멈춘다 |
| 마이그레이션을 지웠는데 되살아남 | `nest build`는 오래된 산출물을 지우지 않는다. `dist` 삭제가 답 |
| CI가 i18n에서 실패 | `i18n/en.json`은 **대소문자 무시 사전순 정렬** 필수. 키 추가 후 정렬 검사할 것 |
| SDK 빌드가 `Enum member must have initializer`로 깨짐 | zod의 **nullable enum**이 스펙에 `null` 멤버를 만들고 SDK가 깨진다. nullable **string** + 설명으로 우회. 게다가 깨진 생성물이 자기 자신의 재생성을 막으므로 `git checkout`으로 되돌린 뒤 재실행 |
| dev DB에서 `corrupted migrations` | 이 개발 DB만 v3.1.0 병합 전 순서로 마이그레이션이 적용돼 있음. immich 런타임과 같은 `allowUnorderedMigrations: true`로 실행. **운영 DB는 정상 순서라 무관** |
| 테스트가 통과하는데 아무것도 검증 안 함 | 기본 설정에서 기능이 **꺼져** 있어 첫 관문에서 빠져나간 것. "안 했다"를 단언하는 테스트는 **의도한 이유로 통과하는지** 반드시 확인 (예: ledger 조회가 실제로 일어났는지 함께 단언) |
| 병합 커밋에 생성물이 누락됨 | 충돌 해결로 `git add` 한 **뒤에** 재생성을 돌려서 스테이징본이 낡음. 재생성은 `git add` **전에** |

## 5. 테스트 규칙

- 새 기능·수정에는 **반드시** 유닛 테스트. 엣지·코너 케이스를 적극 포함한다.
- **테스트는 위치가 정해져 있다**: 소스 옆 `*.spec.ts` (`src/services/foo.service.spec.ts`).
  별도 `tests/` 디렉토리를 만들지 않는다 — 업스트림 관례를 따른다.
- Mock은 `test/utils.ts`의 `newTestService` + `automock`. 새 리포지토리 메서드를 추가하면
  **기본 mock 값**도 함께 추가한다(안 하면 `undefined`가 흘러 다른 스펙이 깨진다).
- 테스트가 "무엇을 하지 않는다"를 단언할 때는 **그 이유까지 고정**한다(§4 마지막 줄 참조).

## 6. 코딩 컨벤션

- **주석은 의도와 배경을 쓴다.** "무엇을 하는지"가 아니라 **"왜 이렇게 했는지, 어떤 함정이
  있었는지"**. 이 포크의 기존 코드가 기준선이다 — 짧은 설명보다 문단 주석을 선호한다.
- 포맷·린트는 도구에 맡긴다(Prettier/ESLint). 손으로 맞추지 않는다.
- 서비스끼리 주입하지 않는다. 공유 로직은 `src/utils/*.ts`에 리포지토리를 인자로 받는
  순수 함수로 둔다(`utils/asset.util.ts` 관례).
- 컨트롤러 메서드 이름 = SDK 함수 이름이다. **기능 이름을 포함해 길게** 짓는다
  (`getGoogleDriveStatus`, `getStatus` 아님).
- `@Endpoint(...)` 사용(`@ApiOperation` 아님), 태그는 `ApiTag` enum.

## 7. 운영 환경 (이 포크 고유)

```
[데스크탑 WSL]  개발 + 이미지 빌드          [랩탑 192.168.50.211]  운영 immich
  Dev Container (핫리로드, 소스 마운트)  →    docker compose, ~/immich-app
  localhost:2283/3000                        사진 /mnt/immich_data/library
```

- **개발과 배포는 다른 모드다.** Dev Container는 소스를 마운트해 즉시 반영(개발용).
  운영은 이미지를 빌드해 배포. 둘을 헷갈리지 말 것 — 특히 **같은 2283 포트를 두고 충돌**한다.
- **배포 절차**:
  ```bash
  docker build -f server/Dockerfile -t immich-server:3.1.0-gdrive .
  ssh 랩탑 'pg_dumpall | gzip > ~/immich-backups/immich-db.$(date +%F-%H%M).sql.gz'   # 먼저 백업
  docker save immich-server:3.1.0-gdrive | gzip -1 | ssh 랩탑 'gunzip | docker load'  # 약 2분
  ssh 랩탑 'cd ~/immich-app && docker compose up -d'
  ```
  compose에서 우리가 바꾸는 것은 `immich-server`의 `image:` **한 줄뿐**이다. 나머지 3개
  컨테이너(postgres/redis/ML)는 공식 이미지를 그대로 쓴다.
- **구글 OAuth 연결(재연결)에는 SSH 터널이 필요하다.** 구글이 리디렉션 대상으로 사설 IP를
  거부하고 `localhost`만 받기 때문:
  ```bash
  ssh -N -L 2283:localhost:2283 gwyun@192.168.50.211   # 이후 브라우저는 localhost:2283
  ```
  **연결이 끝나면 터널은 불필요하다** — 업로드는 랩탑이 구글과 직접 통신한다.
- 랩탑에서 테스트를 직접 구동할 때는 API 키를 쓴다(`x-api-key`). 브라우저 클릭을 사용자에게
  시키기 전에, 직접 할 수 있는지 먼저 검토한다.

## 8. 도메인 지식 (Google Drive 기능)

설계 근거는 `dev-docs/google-drive-feature-roadmap.md`에 있다. 반복해서 문제가 되는 사실들:

- **Drive는 최종 저장소가 아니라 Pixel로 가는 경유지다.** 따라서 Drive에서 파일이 사라지는
  것은 정상 운영이고, 원장(ledger)이 "이미 올렸음"을 기억하는 것이 옳다.
- **업로드·중복방지는 `(userId, assetId)` 축이다. 앨범 차원이 없다.** 사진 하나가 여러
  앨범에 속할 수 있으므로, "이 앨범을 백업 안 함"은 "이 사진들을 안 올림"과 다르다.
- 중복 방지는 3겹: 큐잉 전 ledger 필터 → BullMQ `jobId` dedup → 워커의 `hasUpload` 재확인.
- 실패는 `google_drive_upload_error`에 기록된다(ledger와 반대 극성, 성공 시 삭제).
  **계정 단위 차단**(`quota_exceeded`, `folder_missing`)은 워커 입구에서 전체를 스킵시킨다.
- **404를 무조건 "폴더 없음"으로 보면 안 된다** — resumable 세션 만료도 404다. `notFound`
  reason + 폴더 설정됨 조건을 모두 만족해야 계정을 차단한다.

## 9. 주의사항

- **AGPL-3.0.** 업스트림 라이선스를 따른다.
- **스키마 변경에는 마이그레이션이 필수**이고, 이미 적용된 마이그레이션은 **수정하지 않고**
  새 파일을 추가한다(적용된 DB는 재실행하지 않으므로 편집해도 반영되지 않는다).
- **업스트림 다운그레이드 금지.** 브랜치를 배포하기 전에 운영 버전과 같은 태그 위에
  올라와 있는지 확인한다(`git merge-base --is-ancestor <tag> HEAD`).
- 대용량 처리(수천 장 동기화) 경로는 스트리밍·청킹을 쓴다. `DATABASE_PARAMETER_CHUNK_SIZE`,
  `JOBS_ASSET_PAGINATION_SIZE` 참고.
