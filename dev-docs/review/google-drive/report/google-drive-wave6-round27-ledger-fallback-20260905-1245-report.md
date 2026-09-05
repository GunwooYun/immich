# 리뷰 요청 (최종) — `''` 폴백의 두 번째 형태와 차단 사용자 범위

| | |
|---|---|
| 브랜치 | `feat/google-drive-album-sync-v3.1.0` |
| HEAD | (이 커밋) |
| 리뷰 대상 커밋 | `f54456bb5` + 이 리포트 커밋 |
| 직전 리뷰 | `../review/google-drive-wave6-round26-user-scope-family-20260905-1215-review.md` (**게이트 통과** 판정) |
| 증거 | `dev-test/google-drive/results/20260905-1241.txt` — 커밋 `f54456bb5`, dirty 표시 없음 |
| 작성 | 2026-09-05 12:45 |

## 이 라운드의 성격

round-26이 **배포를 막는 것 없음**으로 게이트를 통과시켰고, 그 리뷰가 남긴 M1·M2·N3만 반영했다.
**프로덕션 코드 변경 0줄** — 테스트 2개와 런북 한 문장이다. §2.4가 "수정 자체도 리뷰 대상"이라
요청서를 쓰지만, **이 라운드에서 배포를 막는 것이 나오지 않으면 사이클을 종료한다.**

## 테스트 결과

```
commit: f54456bb5  (dirty marker 없음)
server (unit)              Tests 264 passed
web (unit)                 Tests  39 passed
web (svelte-check, gated)  no regressions vs baseline
server (medium, real DB)   Tests  53 passed

RESULT: PASS
```

`mise //server:ci-unit` exit 0.

## 1. M1 — `''` 폴백의 두 번째 형태가 무방비였다

`ledgerMatches`(`:45`)는 테스트가 있는데 쌍둥이인 `LEDGER_MATCHES_CURRENT_ACCOUNT`(`:48`)는
없었다. 폴백을 지워도 51개가 전부 통과했다.

이 폴백은 **배포 전체가 딛고 있는 판**이다: 계정 컬럼 이전에 쓰인 6,996행이 `''`을 들고 있고,
이것이 매칭을 멈추면 식별된 계정이 라이브러리 전체를 다시 "대기"로 읽는다. 중복은 gate 2가 막지만
(다른 형태를 쓴다) 큐가 이미 한 일로 가득 찬다.

`countPendingUploads`와 `streamPendingUploads` 두 경로로 단언한다. 지금 그 변이는 이 테스트만
실패시킨다(1 failed / 52 passed).

## 2. M2 — 차단 사용자 범위가 잔여 행으로만 죽고 있었다

`:298`(`getSubscribers`)와 `:562`(`streamPendingUploads`)의 차단 오류 상관은, 앞선 describe들이
공유 DB에 남긴 행 덕분에 죽고 있었다. `-t`로 격리하면 **네 조합 전부 통과**했다.

두 사용자를 명시한다 — 한 명은 quota로 차단, 한 명은 정상. 두 변이 모두 **격리 상태에서도**
죽는 것을 확인했다(1 failed / 52 skipped).

## 3. N3 — 런북이 폐기된 경계를 설명하고 있었다

`CLAUDE.md:402-403`이 입양을 아직 `uploadedAt >= connectedAt`으로 적었다. 세 문단 아래는 이미
`connectionId`로 맞게 적혀 있어 자기모순이었다. **배포 당일 읽는 문서**라 고쳤다.

## 4. 공격 요청 — 이것만 본다

1. 새 테스트 2개가 **의도한 이유로** 통과하는가. 특히 M1 테스트가 `''` 폴백이 아니라 다른 조건
   덕분에 0을 답하고 있지는 않은가.
2. round-26이 남긴 나머지 생존 변이(계정 축 `:398`·`:452`, 소프트삭제 축 10개) 중
   **배포를 막는 것**이 하나라도 있는가. round-26은 "전부 화면 숫자이거나 뒤에 그물이 있다"로
   판정했다 — 그 판정에 동의하는가.
3. round-26의 배포 체크리스트(A/B/C)에 **빠진 항목**이 있는가. 특히 이번 라운드가 만든 변경으로
   인해 추가되어야 할 확인이 있는가.

## 5. 종료 조건

위 세 가지에서 **배포를 막는 것이 나오지 않으면** 이 사이클을 종료하고 배포로 간다.
막는 것이 있으면 그것만 고치고 다시 한 라운드.
