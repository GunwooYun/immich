# Google Drive — 테스트 허브

이 기능의 유닛테스트를 **한 명령으로 실행**하고, 그 결과를 리뷰 리포트에 첨부할 수 있도록
보관하는 곳.

```bash
./dev-test/google-drive/run.sh            # 서버 + 웹 유닛테스트
./dev-test/google-drive/run.sh --medium   # 실제 DB를 쓰는 통합 테스트까지
```

결과는 `results/YYYYMMDD-HHMM.txt`로 저장되고, 실패하면 종료 코드가 0이 아니다.

## 스펙 파일은 왜 여기 없는가

**vitest와 CI(`mise //server:ci-unit`)가 `server/src/**/*.spec.ts`만 찾기 때문이다.**
스펙을 이 디렉토리로 옮기면 CI가 그것들을 더 이상 실행하지 않게 되고, 결과적으로
"테스트 없이는 반영하지 않는다"는 규칙이 **강화가 아니라 무력화**된다. 업스트림도 소스 옆에
두는 관례라, 옮기면 병합 충돌면만 넓어진다.

그래서 스펙은 코드 옆에 두고, **이 디렉토리가 실행·목록·증거 보관을 맡는다.**

## 무엇을 어디서 테스트하는가

| 영역 | 스펙 | 다루는 것 |
|---|---|---|
| 오류 분류 | `server/src/utils/google-drive.spec.ts` | Drive 오류 두 가지 모양 파싱, quota/rate-limit/404 구분, `shouldRetry` 재시도 판정 |
| 서비스 | `server/src/services/google-drive.service.spec.ts` | 업로드 게이트·기록 지점·크기 검증·알림, 폴더/구독/재개, 용량 캐시, 상태 조회 |
| 큐잉 축 | `server/src/services/album.service.spec.ts` | 앨범 추가 시 **선택자**에게 큐잉(소유자 아님), 미선택·비활성 시 무동작 |
| 큐 등록 | `server/src/services/queue.service.spec.ts` | GoogleDriveUpload 큐가 목록에 존재 |
| 기능 플래그 | `server/src/services/server.service.spec.ts` | `googleDrive` 플래그 노출 |
| 설정 스키마 | `server/src/services/system-config.service.spec.ts` | 기본 설정 형태 |
| 폴링 (웹) | `web/src/lib/managers/google-drive-progress-manager.svelte.spec.ts` | 구독 공유·정지, 백오프, 차단 계정, 폴 실패 시 값 보존 |
| 통합 (DB) | `server/test/medium/specs/repositories/google-drive.repository.spec.ts` | **공유 해제 시 업로드 중단**, 선택 행 보존, 미연결 제외, `accessLost` 전환 |

`album.service` 등 이름이 이 기능과 다른 파일도 목록에 있는 이유: 이 기능이 그것들의 동작을
바꿨으므로(큐잉 축, 큐 등록, 설정 형태) 거기서 깨지면 이 기능이 깨진 것이다.

## 커버리지 관점에서 의도적으로 비운 곳

- **컨트롤러**: 얇은 위임 계층이고 권한 검사는 서비스 테스트가 덮는다.
- **Svelte 컴포넌트 렌더링**: 로직은 매니저로 빼서 테스트했고, 마크업은 `svelte-check`와
  실기기 확인에 맡긴다.
- **실제 Google API 호출**: mock으로 대체. 단 `about.get`이 `drive.file` 스코프로 되는지는
  구현 전에 실계정으로 한 번 확인했다(Wave 2 리포트 참조).

## 규칙

1. 코드를 바꿨으면 `run.sh`를 돌린다. **통과하지 않은 변경은 커밋하지 않는다.**
2. 새 동작에는 새 테스트를 붙인다. 일반 경로뿐 아니라 **엣지·코너 케이스**를 함께 넣는다.
3. 리뷰 요청 리포트에 `results/`의 해당 실행 결과를 첨부한다.
4. 테스트가 "무엇을 하지 않는다"를 단언할 때는 **의도한 이유로 통과하는지** 함께 못박는다
   (기능이 꺼져 있어 공허하게 통과한 사례가 두 번 있었다).
