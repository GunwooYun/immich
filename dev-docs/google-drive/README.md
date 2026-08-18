# Google Drive 앨범 동기화 — 문서 색인

immich 개인 포크에 추가한 기능. 앨범의 사진을 사용자의 구글 드라이브로 자동 백업하고,
그 드라이브를 Pixel 기기가 받아가 Google Photos로 올리는 파이프라인의 앞단이다.

## 읽는 순서

| 문서 | 내용 |
|---|---|
| [feature-roadmap.md](feature-roadmap.md) | **여기서 시작.** 전체 설계 근거, Wave 1~4 계획, 일부러 안 하는 것 |
| [failure-handling-plan.md](failure-handling-plan.md) | 실패 기록·quota 차단·알림 설계 (Wave 1의 근거) |
| [wave1.5-plan.md](wave1.5-plan.md) | 진행 중: 앨범별 백업 ON/OFF (소유자 축 → 선택 축) |
| [album-sync-plan.md](album-sync-plan.md) | 최초 설계 문서 (역사적 기록) |
| [implementation-progress.md](implementation-progress.md) | 구현 진행 현황 |

## 리뷰 기록

요청서는 `../review/google-drive/report/`, 결과는 `../review/google-drive/review/`.

| 시점 | 대상 | 결과 |
|---|---|---|
| 2026-08-14 | 브랜치 전체 | High 1 + Medium 9 → 전부 반영 |
| 2026-08-14 | R1~R3 수정분 | 3건 확인, skip 경로 기록 누락 발견 |
| 2026-08-15 | 로드맵(Wave 1~4 설계) | 갭 8건, Gap A(quota 입구 게이트)가 필수 판정 |
| 2026-08-15 | Wave 1 구현 | 404 오분류(계정 차단) + revoked 배너 미전달 |
| 2026-08-19 | Wave 1.5 설계 | 접근 조인이 정확성 요구사항, AlbumDownload 권한 |

## 현재 상태 (2026-08-19)

- **배포됨**: Wave 1까지 랩탑 운영 인스턴스에 적용, 라이브 검증 완료
- **진행 중**: Wave 1.5 — 앨범별 ON/OFF, 기본 OFF
- **대기**: Wave 2(드롭다운·용량 게이지), 3(진행 표시), 4(선택 업로드)
