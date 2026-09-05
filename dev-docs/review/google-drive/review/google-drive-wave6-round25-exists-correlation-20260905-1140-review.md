# Code Review — 세 번째 자리는 아홉 개였다 · 공허했던 단언(N1) · 정정을 남기는 방식(N2) · 멈춰도 되는가

| | |
|---|---|
| Branch / HEAD | detached worktree `/home/gwyun/workspace/immich-review` @ `320a003ab` |
| Commits reviewed | `5d89908b9`, `f03aebc75` (`git log --oneline 80fe69008..320a003ab` = 3, 그중 `320a003ab`는 리포트 자신) |
| Report | `../report/google-drive-wave6-round25-exists-correlation-20260905-1140-report.md` |
| Reviewed | 2026-09-05 |

## Verdict

**리포트의 사실 주장은 (숫자 하나를 빼고) 전부 재현됐고, 이번 라운드의 변경은 옳다.**
`:203` 변이는 새 테스트 하나만 죽이고(`1 failed | 44 passed`), `:196` 변이도 round-23이 넣은
테스트 하나만 죽인다 — 쌍둥이 두 개가 이제 각각 지켜진다. 프로덕션 코드 0줄도 사실이다.

그런데 **1절의 질문("같은 뿌리의 세 번째 자리가 있는가")의 답은 '있다'가 아니라 '아홉 개 있다'**이다.
`google-drive.repository.ts`의 사용자 상관 술어 16개를 줄 번호로 하나씩 지우고 medium 스위트를
돌린 결과, **9개가 45/45로 살아남았다.** 그중 하나(`:547`, `streamPendingUploads`의 원장 anti-join)는
성격이 다르다 — 나머지 8개는 실패해도 뒤에 그물이 하나 더 있거나 화면 표시가 틀릴 뿐인데,
`:547`은 **일을 빼먹는 쪽**이라 뒤에 그물이 없다. 지운 상태에서 실제 스키마에 두 사용자 상태를
넣어 돌려 보면 `streamPendingUploads`가 0행을 내놓는 동안 `countPendingUploads`는 1을 보고한다 —
"대기 1인데 아무 일도 안 일어남", 네 라운드째 "관측 품질 문제"로 미뤄 온 그 화면 상태와 같은 모양이다.

**다만 이것은 결함이 아니라 커버리지 공백이다.** 술어는 코드에 다 있고 올바르다. 그리고 그 공백을
찌르려면 **두 immich 사용자가 각자 Drive를 연결하고 한 공유 앨범을 함께 선택한 상태**가 필요한데,
이 배포본에는 그 상태가 없다(`## Current Project`: 가족은 이 기능을 쓰지 않는다). 그래서 **배포를
막지 않는다.** 가장 중요한 문제는 코드가 아니라 이것이다: **이 루프는 라운드마다 한 자리씩 찾아
고치는 방식으로는 끝나지 않는다.** 뿌리가 "픽스처가 사용자 하나뿐"이라는 구조적 사실이고, 리포트가
한 자리를 막는 동안 나는 아홉 자리를 더 찾았다. 4절 답은 아래 별도 절에 적었다.

### Evidence I ran myself

전부 이 워크트리 HEAD(`320a003ab`)에서 돌렸다. 변이는 `sed -i '<n>d'` 또는 줄 안 부분 삭제로 넣고,
매 실행 뒤 `git checkout --`로 되돌렸다.

| Check | Result |
|---|---|
| `git diff 80fe69008..320a003ab -- server/src ':!*.spec.ts'` | **빈 출력** — 프로덕션 코드 0줄, 리포트대로 |
| `git diff 80fe69008..320a003ab -- web/src ':!*.spec.ts'` | 빈 출력 |
| `git diff --stat 80fe69008..320a003ab` | 5 files: workflow 1, report 1, review 1, results 1, medium spec 1 |
| medium (HEAD, 무변이) | `Tests 45 passed (45)` — 리포트의 45와 일치 |
| server unit (`run.sh`의 8개 스펙, HEAD) | `Test Files 8 passed / Tests 264 passed (264)` — 리포트의 264와 일치 |
| 첨부 증거 `results/20260905-1131.txt` | `commit: 5d89908b9 (feat/…)`, dirty 마커 없음, `RESULT: PASS` — 주장대로 |
| CI `runs/33939338261` (api.github.com) | `head_sha f03aebc75`, `conclusion success`, 잡 4개 전부 `success` — 주장대로 |
| `:203` 삭제 | `1 failed | 44 passed` — 죽는 것은 새 테스트 하나뿐 ✔ |
| `:196` 삭제 | `1 failed | 44 passed` — round-23 테스트 하나 ✔ |
| 입양 전체 off (`:157` → `if (true)`) at HEAD | **`6 failed | 39 passed`** (리포트는 5라고 적었다) |
| 같은 변이 + `80fe69008`의 스펙 파일 | `4 failed | 40 passed` — "이전에는 4"는 맞다 |
| kysely `Migrator` 소스 확인 | `#ensureNoMissingMigrations`가 `:447`에서 **무조건** 실행되고 `allowUnorderedMigrations` 게이트(`:448`) **앞**이다 → N2 정정은 사실 |
| 실 스키마 프로브 (testcontainer `mich`, `begin … rollback`) | `:547`·`:480`·`:487`·`:288` 변이의 결과를 SQL로 직접 관측 (아래 M1) |
| `git status --porcelain` (종료 시) | **이 리뷰 파일 하나뿐.** 소스·스펙은 `git diff --exit-code`로 HEAD와 동일함을 확인 |

**변이 전수표** — `server/src/repositories/google-drive.repository.ts`의 사용자 축 술어 16개.
"survives"는 지워도 `45 passed (45)`라는 뜻이다.

| 줄 | 술어 | 메서드 | 결과 |
|---|---|---|---|
| `:196` | `.where('userId','=',userId)` (DELETE) | `adoptUnstampedUploads` | killed (1) |
| `:203` | `whereRef('stamped.userId', …)` | `adoptUnstampedUploads` | killed (1) — **이번 라운드** |
| `:288` | `onRef('album_user.userId','=','google_drive_album.userId')` | `getSubscribers` | **survives** |
| `:298` | `whereRef('…_error.userId','=','google_drive_album.userId')` | `getSubscribers` | killed (1) — **단, 잔여 행 때문**(N1) |
| `:359` | `on('album_user.userId','=',userId)` | `getSubscribableAlbums` | killed (1) |
| `:366` | `on('google_drive_album.userId','=',userId)` | `getSubscribableAlbums` | **survives** |
| `:397` | `on('google_drive_upload.userId','=',userId)` | `getSubscribableAlbums` | **survives** |
| `:425` | `on('album_user.userId','=',userId)` | `getAlbumBackupStatus` | **survives** |
| `:428` | `on('google_drive_album.userId','=',userId)` | `getAlbumBackupStatus` | **survives** |
| `:451` | `on('google_drive_upload.userId','=',userId)` | `getAlbumBackupStatus` | **survives** |
| `:480` | `onRef('album_user.userId','=','google_drive_album.userId')` | `countPendingUploads` | **survives** |
| `:487` | `onRef('google_drive_upload.userId','=','google_drive_album.userId')` | `countPendingUploads` | **survives** |
| `:540` | `onRef('album_user.userId','=','google_drive_album.userId')` | `streamPendingUploads` | killed (1) |
| `:547` | `onRef('google_drive_upload.userId','=','google_drive_album.userId')` | `streamPendingUploads` | **survives** ← 가장 나쁨 |
| `:562` | `whereRef('…_error.userId','=','google_drive_album.userId')` | `streamPendingUploads` | killed (1) — **잔여 행 때문**(N1) |
| `:642` | `onRef('album_user.userId','=','google_drive_album.userId')` | `isAssetInSubscribedAlbum` | killed (1) |

---

## Findings

### M1 (Medium) — 세 번째 자리는 `:547`이다. 유일하게 뒤에 그물이 없는 자리다

**증거 (변이).** `sed -i '547d'` 뒤 medium 스위트 `45 passed (45)`.

**증거 (실 스키마).** testcontainer의 `mich`(마이그레이션 98개 적용)에 `begin … rollback` 안에서
두 사용자 상태를 만들고, `src/queries/google.drive.repository.sql`의 `streamPendingUploads` SQL을
원본과 변이본으로 각각 돌렸다. 상태는 이렇다 — A가 소유한 앨범에 자산 1개, A·B 모두 `album_user`
멤버, **A·B 모두 Drive 연결 + 앨범 선택**, A에게만 원장 행이 있고 그 행은 `driveAccountId = ''`
(도장 안 된 행 — 운영 DB에 6,996개 있는 바로 그것):

```
--- REAL query (line 547 present) ---   pending_for = <B>      (1 row)
--- MUTANT (line 547 deleted) ---       (0 rows)
--- countPendingUploads for B ---       1
```

즉 변이본에서는 **A의 원장 행이 B의 대기 행을 지운다.** `''` 행은 설계상 *모든* 연결에 매칭되므로
(`LEDGER_MATCHES_CURRENT_ACCOUNT`, `:48`) 계정이 달라도 통과한다. B의 사진은 B의 Drive에 영원히
가지 않고, `countPendingUploads`는 `:487`이 살아 있으니 계속 1을 보고한다.

**왜 이 자리만 다른가.** 다른 8개 생존 변이는 뒤에 그물이 있거나 표시만 틀린다:

- `:288`(`getSubscribers`)이 뚫리면 접근을 잃은 사용자에게 잡이 큐잉되지만, 워커 입구 gate 3
  (`google-drive.service.ts:958` → `isAssetInSubscribedAlbum`)의 `:642`가 **지켜지고 있어서**
  실행 시점에 걸러진다. 유출이 아니라 낭비다 — `getSubscribers` 주석(`:274-277`)이 이미
  "큐가 바빠 보여 admin 버튼이 거절당한다"고 적어 둔 그 비용.
- `:480`·`:487`·`:366`·`:397`·`:425`·`:428`·`:451`은 전부 **화면 숫자**다(진행률 카드, 앨범 목록의
  `subscribed`/`uploadedCount`). 틀리면 사람이 오해하지만 파일이 움직이지는 않는다.
- `:547`은 **하지 않는 것**이라 뒤에 아무것도 없다. 빠뜨린 자산은 다음 트리거를 기다릴 뿐이고,
  같은 상태가 유지되는 한 다음 트리거에서도 똑같이 빠진다.

**도달 가능성.** `subscribeAlbum`은 `Permission.AlbumDownload`만 요구하므로
(`google-drive.service.ts:1288`) 공유받은 사람이 남의 앨범을 자기 Drive로 백업하는 것은
**설계된 일급 상태**다. `''` 행 쪽 조건은 더 쉽다 — 운영 DB에 이미 6,996행 있다.
다만 **이 배포본에는 Drive를 연결한 사용자가 관리자 한 명뿐**이라 오늘은 도달하지 않는다.
리포트가 M1의 근거로 든 "집에서 드라이브 하나를 같이 쓰면 일어난다"와 **같은 전제**이므로,
그 전제를 받아들여 `:203`을 고쳤다면 `:547`도 같은 무게로 받아야 한다.

**고치는 법 (테스트만, 프로덕션 코드는 건드리지 않는다).** 죽이는 픽스처:

```
user A, user B
album (owner A), asset X in it
album_user: A(owner), B(editor)
user_google_drive: A(acct-a), B(acct-b)          ← 둘 다 연결
google_drive_album: A→album, B→album             ← 둘 다 선택
google_drive_upload: (A, X, driveAccountId='')   ← A만 올렸고, 도장 안 된 행

expect: drain(streamPendingUploads()) 에 (B, X)가 있다
```

이 픽스처 하나가 `:547`을 죽인다. `google_drive_upload`를 `(A, X, 'acct-b')`로 바꾸면
"두 사용자가 같은 구글 계정"(리포트가 M1에서 든 바로 그 시나리오)으로도 같은 변이를 죽인다.

### M2 (Medium) — `getAlbumBackupStatus`는 medium 스위트에서 **한 번도 호출되지 않는다**

`sut.<method>(` 호출을 세어 보면 (`grep -n "sut\.[a-zA-Z]*(" … | sort | uniq -c`)
`adoptUnstampedUploads` 12, `upsertError` 18, `hasUpload` 11 … 인데 **`getAlbumBackupStatus`는 0**이다.
그래서 그 메서드의 사용자 축 술어 3개(`:425`, `:428`, `:451`)가 전부 살아남는다. e2e에도 없다
(`grep -rln "googleDrive\|google-drive" e2e/src` → 출력 없음). 즉 **이 쿼리의 SQL은 어떤 테스트도
실행하지 않는다** — 유닛 스펙은 mock이라 "쿼리 빌더가 불렸다"까지밖에 말하지 못한다.

폴링으로 앨범 카드를 그리는 쿼리이고(`controller.ts:324`), 주석이 스스로 "Wave 3가 이걸 폴링한다"고
적어 둔 만큼 화면에 계속 보이는 숫자다. 영향은 표시에 그치지만, **`getSubscribableAlbums`와
`getAlbumBackupStatus`가 같은 세 술어를 각자 복제**하고 있어(`:359/:366/:397` vs `:425/:428/:451`)
한쪽만 고치고 다른 쪽을 잊는 전형적 자리다 — 실제로 `:359`는 테스트가 있고 `:425`는 없다.

**죽이는 픽스처:** 공유 앨범 하나, A만 선택 + A만 업로드, **B**로 `getAlbumBackupStatus(B, album)`
호출 → `subscribed=false`, `uploadedCount=0`을 단언. 이 한 테스트가 `:428`과 `:451`을 동시에 죽인다.
`:425`는 M1과 같은 언셰어 픽스처(아래 M3)가 죽인다.

### M3 (Medium) — `getSubscribers`에는 언셰어 테스트가 없다. 형제 둘에는 있다

`streamPendingUploads`에는 `should stop streaming once the album is no longer shared with the selector`가,
`isAssetInSubscribedAlbum`에는 `should be false once the album is unshared…`가 있어서 각각
`:540`·`:642`를 죽인다. **`getSubscribers`에만 그게 없다** → `:288` 생존.

실 스키마 프로브(같은 방식, rollback):

```
A 소유 앨범, B가 선택한 뒤 언셰어됨(B의 album_user 행 삭제, google_drive_album 행은 존속)

--- getSubscribers REAL (line 288 present) ---   (0 rows)
--- getSubscribers MUTANT (288 deleted) ---      <B>   (1 row)
```

`getSubscribers`의 주석(`:268-271`)이 "이 조인이 없으면 열 수 없는 앨범의 사본을 조용히 무한정
받는다"고 정확히 이 상태를 서술해 두었는데, 그 문장을 지키는 테스트가 없다. 같은 프로브에서
`countPendingUploads(B)`도 REAL 0 → MUTANT 1로 갈라지므로 **`:480`도 같은 픽스처가 죽인다.**

**죽이는 픽스처:** 위 프로브 그대로 — 언셰어된 선택자 B로 `getSubscribers([album])`이 `[]`임을 단언.
단, "빈 배열"만 단언하면 픽스처가 망가져도 통과하니 **언셰어 전에 `toHaveLength(1)` 목격자**를
같이 넣는다 (같은 파일의 `should not return a user whose album has been soft-deleted`가 이미
그 관례를 쓴다 — `spec.ts:278-280`).

### N1 (Nit, 그러나 뿌리와 같은 뿌리) — 죽는 변이 중 둘은 **픽스처가 아니라 이전 테스트가 남긴 행** 때문에 죽는다

medium 스펙은 파일 전체에서 DB 하나를 공유한다 (`defaultDatabase = await getKyselyDB()`,
`spec.ts:24`). 각 `it`은 `ctx.newUser()`로 새 사용자를 만들지만 **앞 테스트의 행은 지워지지 않는다.**
그래서:

| 변이 | 전체 파일 실행 | 격리 실행 |
|---|---|---|
| `:298` | `1 failed` | `-t "should still return a user whose only failures are ordinary ones"` → **`1 passed`** |
| `:562` | `1 failed` | `-t "should move the pending count with the connected account"` → **`1 passed`** |

`:298`은 바로 앞 테스트(`should not return a user blocked by a quota or a missing folder`,
`spec.ts:287`)가 **다른 사용자**에게 남긴 `QuotaExceeded` 행 때문에 죽는다. `:562`는 파일 앞쪽
어딘가의 잔여 행 때문에 죽고, 죽는 테스트조차 `streamPendingUploads`가 아니라
`countPendingUploads` 테스트다.

**이게 왜 중요한가.** 리포트의 진단("픽스처가 한 사용자뿐이라 공허하다")은 맞다. 그런데 그
진단을 적용해 "이건 이미 덮여 있다"고 판단할 때, **덮은 것이 픽스처가 아니라 잔여 행인 경우가
있다.** 잔여 행에 의한 kill은 테스트 순서·이름·`-t` 필터에 따라 사라진다. 즉 두 술어는
"덮여 있음"이 아니라 **"오늘의 실행 순서에서 우연히 덮임"**이다. 다음 사람이 `getSubscribers`
describe의 테스트 순서를 바꾸는 순간 조용히 사라진다.

**고치는 법:** 이 두 자리에 명시적 두 사용자 픽스처를 넣는다(차단된 A + 정상 B, 같은 앨범).
그러면 순서와 무관하게 죽는다. 비용은 테스트 두 개다.

### N2 (Nit) — "4개가 아니라 5개가 실패한다"는 **6개**다

리포트 2절의 수치를 그대로 재현했다. `:157`을 `if (true) {`로 바꿔 입양을 통째로 끄면:

- 이 워크트리 HEAD: **`6 failed | 39 passed (45)`**
- `80fe69008`의 스펙 파일로 되돌린 뒤 같은 변이: `4 failed | 40 passed (44)` ← "이전에 4"는 맞다

6이 되는 이유는 리포트가 세지 않은 한 개, **이번 라운드에 새로 넣은 M1 테스트**(`spec.ts:587`)도
입양이 꺼지면 함께 죽기 때문이다. 즉 리포트는 자기 변경의 효과를 하나 적게 셌다.

**주장의 방향은 영향받지 않는다.** N1이 노린 것은 "`should not delete another user's colliding row`가
조기 반환에도 통과하던 것을 막았다"이고, 그 테스트는 실제로 4→6의 증가분 두 개 중 하나다.
다만 리뷰 계약상 **숫자는 재현 가능해야** 하므로, 다음 리포트에서는 변이 명령을 함께 적는 편이
낫다 (`sed -i '157s/if (!driveAccountId) {/if (true) {/'`).

### N3 (Nit) — "프로덕션 코드 0줄"의 근거 명령이 주장보다 좁다

리포트가 인용한 명령은 `git diff 80fe69008..f03aebc75 -- server/src ':!*.spec.ts'` 하나다.
그 범위에는 `web/src`도, `.github/`도, `server/test/`도 들어 있지 않다. 실제로 이 라운드는
**`.github/workflows/fork-google-drive.yml`도 건드렸다**(`5d89908b9`, +11/−7).

확인해 보니 **주장 자체는 참이다** — 그 workflow 변경은 주석뿐이고
(`git diff … -- .github/workflows/fork-google-drive.yml`로 확인: 바뀐 것은 `# Names, not counts…`
문단 하나, 실행되는 `ls`/`docker exec`/`diff` 세 줄은 그대로), `web/src`도 빈 diff다.
그러니 이건 결론이 아니라 **근거의 문제**다. 다음부터는 `git diff --stat <range>` 전체를 붙이고
"나머지는 주석"이라고 적는 편이 검증이 빠르다 — 나는 그 workflow 줄을 보고 5분을 썼다.

---

## Answers to what the report asked me to attack

### 1절 — 같은 뿌리의 세 번째 자리가 있는가

**있다. 아홉 개다.** 위 전수표가 전부이고, 요약하면:

| 자리 | 지키는 상태 | 애플리케이션이 도달하는가 | 결과의 성격 |
|---|---|---|---|
| **`:547`** `streamPendingUploads` 원장 | 공유 앨범 + 두 사용자 연결 + 상대의 `''` 행 | **예** (설계된 상태, `''` 행은 운영에 6,996개) | **업로드 누락 — 뒤에 그물 없음** |
| `:288` `getSubscribers` 멤버십 | 선택 후 언셰어 | **예** (주석이 서술한 상태) | 낭비 큐잉, gate 3(`:642`)이 막음 |
| `:480` `countPendingUploads` 멤버십 | 같은 언셰어 | **예** | 표시 (대기 수가 안 줄어듦) |
| `:487` `countPendingUploads` 원장 | 같은 두 사용자 상태 | **예** | 표시 (대기 0으로 보임) |
| `:366` `getSubscribableAlbums` 선택 | 남이 같은 앨범 선택 | **예** | 표시 (`subscribed` 오표시) |
| `:397` `getSubscribableAlbums` 원장 | 남이 같은 앨범 업로드 | **예** | 표시 (`uploadedCount` 부풀림) |
| `:425` `getAlbumBackupStatus` 멤버십 | 언셰어 | **예** | 표시 |
| `:428` `getAlbumBackupStatus` 선택 | 남이 선택 | **예** | 표시 |
| `:451` `getAlbumBackupStatus` 원장 | 남이 업로드 | **예** | 표시 |

**전부 "애플리케이션이 도달할 수 있는 상태"이지 합성 상태가 아니다.** 합성 상태는 하나도 없었다 —
리포트가 round-23에서 만든 "두 사용자가 같은 uuid `connectionId`" 같은 부류는 이번 목록에 없다.
`subscribeAlbum`이 `AlbumDownload` 권한만 요구하므로(`service.ts:1288`) 공유 앨범을 여러 사람이
각자 백업하는 것은 이 기능의 **의도된 사용 방식**이고, 위 아홉 자리는 전부 그 하나의 상태에서
갈라진다.

**단, 이 배포본에서는 지금 도달하지 않는다.** Drive를 연결한 사용자가 관리자 한 명뿐이라
`user_google_drive`에 행이 하나이고, 위 표의 모든 상태는 두 번째 행을 요구한다.

**픽스처는 세 개면 아홉 자리를 전부 덮는다** (테스트는 쓰지 않았다, 이름만 적는다):

1. `shared album, two connected selectors, one has an unstamped ledger row`
   → `:547`, `:487`, `:397`, `:451`, (`:428`도 `getAlbumBackupStatus` 호출을 붙이면)
2. `shared album, selector unshared afterwards` (선택 행은 존속)
   → `:288`, `:480`, `:425`
3. `shared album, only the other user selected it`
   → `:366`, `:428`

여기에 N1의 두 자리(`:298`, `:562`)를 명시 픽스처로 바꾸는 테스트 둘을 더하면
**테스트 다섯 개로 이 축이 닫힌다.** 프로덕션 코드는 한 줄도 필요 없다.

### 3절 — 틀린 근거를 지우지 않고 정정으로 남기는 방식

**원칙은 옳다. 이번 배치는 틀렸다.**

옳은 부분부터. 틀린 근거는 커밋 메시지로 이미 나갔고, 커밋 메시지는 `git log`로 계속 읽힌다.
그걸 조용히 바꾸면 다음 사람은 **틀린 문장을 근거로 삼은 채 코드만 맞는 상태**를 보게 되고,
그건 "왜 이렇게 했는가"를 남기라는 이 저장소의 규칙(`CLAUDE.md` §6)이 정확히 막으려는 상황이다.
게다가 이 틀린 근거의 출처는 작성자가 아니라 **리뷰어**다(round-24 리뷰의 되먹임 6번이
"round-23 N2(c)는 내가 틀렸다"고 스스로 적어 두었다). 리뷰어 판정이 그대로 코드 주석이 되는
경로가 있다는 사실 자체가 기록될 값이 있다.

틀린 부분. **배치가 코드다.** 지금 그 CI 스텝은 실행 줄이 3줄인데 주석이 14줄이고, 그중 6줄이
"세 번째 버전이 첫·둘째 버전보다 나은 이유"이고 5줄이 "둘째 버전에 대해 예전에 잘못 적은 말"이다.
다음에 이 스텝을 고칠 사람이 알아야 하는 것은 **"이름 비교다, 개수 비교로 되돌리지 마라"** 한 줄이고,
"예전에 왜 그렇게 믿었는가"는 그 사람의 행동을 바꾸지 않는다 — 믿음만 바꾼다.

**내가 제안하는 규칙 (한 줄):**

> 정정이 **다음 사람의 행동**을 바꾸면 코드 주석에, **믿음**만 바꾸면 계획·리뷰 문서에.

이 기준으로 이번 건은 후자다. 코드에는

```
# Names, not counts: a name diff says *which* migration is missing, not just how many.
# (Why the counting version was rejected, and a wrong reason that reached a commit message:
#  dev-docs/google-drive/feature-roadmap.md, "migration check" 절.)
```

정도면 충분하고, 다섯 줄짜리 kysely 인용은 계획 문서로 옮긴다. 정정을 **지우자는** 말이 아니다 —
**옮기자는** 말이다. 지금 형태는 다음 사람이 읽어야 할 것과 알아도 그만인 것을 같은 밀도로
쌓아 두어서, 결국 둘 다 안 읽히게 된다.

덧붙여, 그 정정 자체는 사실이다. `kysely`의 `Migrator`에서
`#ensureNoMissingMigrations`(`migrator.js:491`)는 `:447`에서 **무조건** 호출되고
`allowUnorderedMigrations` 게이트(`:448`)보다 **앞**에 있다. 즉 업스트림이 지운/이름 바꾼
마이그레이션이 적용돼 있는 DB는 `allowUnorderedMigrations: true`(`database.repository.ts:507`,
dev에서만 참)여도 마이그레이션 자체가 죽는다. 정정은 맞고, 정정이 뒤집은 원래 주장은 틀렸다.

---

## 4절 — 이 루프를 멈춰도 되는가

**멈춰라. 단, "다 봤다"가 아니라 "이 형식으로는 더 볼 게 안 나온다"는 이유로.**

### 근거: 21~25 라운드에서 지적이 작아졌는가, 자리만 옮겼는가

둘 다다. 그리고 그 구분이 답을 정한다. 리뷰 요청서 커밋을 경계로 프로덕션 코드 변경량을 세면
(`git diff --shortstat <req_n>..<req_n+1> -- server/src web/src ':!*.spec.ts'`):

| 라운드 | 프로덕션 변경 | 내용 |
|---|---|---|
| 21 → 22 | **6 files, +108 / −15** | 실제 동작 변경 (연결 정체성, 드레인 가드) |
| 22 → 23 | 2 files, +10 / −4 | **전부 주석** (마이그레이션·스키마 문서) |
| 23 → 24 | 1 file, +9 | 어떤 호출자도 만들지 않는 상태에 대한 가드 (`if (!driveAccountId)`) |
| 24 → 25 | **0** | 없음 |

**실행 경로가 마지막으로 바뀐 것은 round 21→22다.** 그 뒤 세 라운드가 만든 것은 주석 한 뭉치,
세 번째 그물 하나(round-24 리뷰가 스스로 "첫 그물이 아니다"라고 확인했다), 그리고 테스트다.
이건 수렴이다.

동시에, **지적이 사라진 것은 아니고 자리를 옮겼다.** 나는 이번에 아홉 개를 새로 찾았다. 그런데
아홉 개 **전부**가 같은 한 문장으로 요약된다: *"medium 픽스처가 사용자를 한 명만 만든다."*
round-24가 한 자리를 찾고, round-25가 한 자리를 막고, round-26이 아홉 자리를 찾는 이 진행은
**라운드가 뿌리를 못 보고 잎을 세고 있다는 뜻**이다. 한 라운드에 하나씩 막으면 아홉 라운드가 더
필요하고, 그 아홉 라운드가 바꿀 프로덕션 코드는 **0줄**이다 (전부 커버리지다).

그러므로: **리뷰 루프를 닫고, 남은 것을 "라운드"가 아니라 "한 건의 작업"으로 옮긴다.**
M1~M3과 N1은 합쳐서 **테스트 다섯 개 + 픽스처 헬퍼 하나**다. 이건 리뷰가 발견할 일이 아니라
그냥 하면 되는 일이고, 프로덕션 코드를 건드리지 않으므로 배포와 직렬로 묶을 이유가 없다.

### 배포 전에 반드시 해야 하는 것 — 한 줄

> **`server.externalDomain`과 `googleDrive.redirectUrl` 중 최소 하나가 채워진 상태로 배포하고,
> 배포 직후 설정 화면을 열기 전에 `getGoogleDriveStatus`가 `enabled: true`를 주는지 확인한다.**

이게 유일하게 "안 하면 배포가 실패하는" 항목인 이유는, **실패가 조용하기 때문**이다.
`isGoogleDriveEnabled`(`utils/misc.ts:150-154`)는 redirect URL을 *파생할 수 있을 때만* 참이고,
`getGoogleDriveRedirectUrl`(`:126-138`)은 `redirectUrl`이 비면 `externalDomain`에서 만들고
그것도 비면 **빈 문자열**을 돌려준다. 지금 운영은 `redirectUrl = http://localhost:2283/…`,
`externalDomain = (unset)`이다. Wave 6이 tailnet 주소로 가면서 관리자 폼의 안내
(`i18n/en.json`: "비워두면 External Domain을 쓴다")를 따라 `redirectUrl`을 지우는 순간,
**에러 없이 기능 전체가 꺼진다.** 이건 `## Current Project`의 Notes에 이미 지뢰로 적혀 있고
Tasks 4번이기도 한데, **코드로는 막을 수 없는 유일한 항목**이라 여기 다시 적는다.

나머지(M8 `refreshToken` nullable, UI `stalled`, 메뉴 요청 2·4번, 그리고 이 리뷰의 M1~M3)는
전부 배포 후로 미룰 수 있다. M1~M3이 배포를 막지 않는 근거는 위에 적었다 — 두 번째 Drive 연결
사용자가 없으면 아홉 자리 중 어느 것도 도달하지 않는다.

### 만약 두 번째 사용자를 붙일 계획이 생긴다면

그때는 **M1(`:547`)이 배포 게이트로 승격된다.** 다른 여덟 자리는 화면이 틀리거나 잡을 낭비하는
정도지만, `:547`은 사진이 조용히 안 올라가고 화면은 "대기 중"으로 남는다 — 이 기능이 존재하는
이유(사진을 Pixel로 보내기) 자체가 실패하는데 아무도 모른다. 위 픽스처 1번을 먼저 넣는다.

---

## What I did not verify

- **웹 유닛 테스트와 svelte-check.** 이 워크트리에는 `web/node_modules`가 없다
  (`server/node_modules`는 있다). 그래서 리포트의 `web (unit) 39 passed`와
  "no regressions vs baseline (3 pre-existing files)"는 **첨부 파일과 CI 결과로만** 확인했고
  직접 돌리지 못했다. 이 라운드가 `web/`을 한 줄도 건드리지 않았으므로(빈 diff 확인) 위험은 낮다.
- **`mise //server:ci-unit` exit 0.** 리포트의 주장이고, 나는 `run.sh`의 서버 스펙 8개만
  직접 돌렸다(264 통과). format/lint/check 세 단계는 돌리지 않았다 — 프로덕션 코드가 0줄이라
  lint/tsc 결과가 바뀔 소지가 없다고 판단했다.
- **`getUploadedAssetIds`·`hasUpload`의 `ledgerMatches` 계정 축.** 이번 리뷰는 **사용자 축**만
  전수 변이했다. 계정 축(`:45`의 `or driveAccountId = ''` 등)은 round-21~23에서 다뤄졌다고 보고
  다시 돌리지 않았다.
- **아홉 개 생존 변이 중 다섯 개(`:366`, `:397`, `:425`, `:428`, `:451`)의 실 SQL 관측.**
  `:547`·`:480`·`:487`·`:288`은 실 스키마에 상태를 넣어 두 버전의 SQL 결과를 직접 봤지만,
  나머지 다섯은 **변이 생존(45/45)과 코드 읽기**로만 판정했다. 성격이 전부 "표시 숫자"라
  추가 비용을 들이지 않았다.
- **운영 DB.** 아무것도 읽지도 쓰지도 않았다. `''` 행 6,996개라는 숫자는 `CLAUDE.md` §7 인용이다.
- **CI 워크플로가 실제로 무엇을 실행했는지.** `runs/33939338261`의 잡 4개 conclusion이
  `success`임을 GitHub API로 확인했고, 로그 본문은 읽지 않았다.

---

## Feeding back into the plan

`dev-docs/google-drive/feature-roadmap.md`에 남길 것:

1. **이 기능의 SQL 정확성은 medium 스펙 하나에만 걸려 있고, 그 스펙의 픽스처는 사용자를 한 명만
   만든다.** 그래서 "두 사용자" 상태를 요구하는 술어는 **구조적으로** 공허해진다. round-24가 한 자리,
   round-25가 한 자리를 막았고, round-25 리뷰가 **아홉 자리를 더** 찾았다(위 전수표). 라운드마다
   하나씩 막는 방식을 그만두고 **픽스처 헬퍼 하나 + 테스트 다섯 개**로 한 번에 닫는다.
2. **닫아야 할 아홉 자리와 그 픽스처 세 개**를 전수표째로 옮겨 적는다. 특히
   **`:547`만 성격이 다르다** — 나머지는 표시가 틀리거나 잡을 낭비하지만, `:547`은 업로드를
   빼먹고 그 뒤에 그물이 없다. 두 번째 Drive 사용자가 생기는 날 이것이 배포 게이트가 된다.
3. **medium 스펙은 파일 하나가 DB 하나를 공유한다**(`spec.ts:24`). 그래서 "변이가 죽었다"가
   "테스트가 잡았다"를 뜻하지 않는다 — `:298`과 `:562`는 **앞 테스트가 남긴 다른 사용자의 행**
   때문에 죽는다(`-t`로 격리하면 둘 다 통과). **변이 실험은 전체 실행과 `-t` 격리 실행을 모두
   돌린 뒤에 판정한다**는 문장을 검증 절차에 넣는다.
4. **`getSubscribableAlbums`와 `getAlbumBackupStatus`는 같은 세 술어를 각자 복제한다.**
   후자는 medium에서 한 번도 호출되지 않는다(호출 횟수 0). 한쪽을 고칠 때 다른 쪽을 잊는 자리이니
   두 메서드를 같은 테스트 블록에서 다룬다.
5. **배포 전 단 하나의 관문은 redirect 파생이다.** `externalDomain`과 `redirectUrl`이 둘 다 비면
   `isGoogleDriveEnabled`가 거짓이 되어 **에러 없이** 기능이 꺼진다(`utils/misc.ts:126-154`).
   관리자 폼의 안내가 그 상태로 유도하므로, 배포 절차서에 "설정 화면을 열기 **전에**
   `getGoogleDriveStatus`의 `enabled`를 확인한다"를 명시적 단계로 넣는다.
6. **정정은 옮기되 지우지 않는다.** 규칙: *정정이 다음 사람의 **행동**을 바꾸면 코드 주석에,
   **믿음**만 바꾸면 계획 문서에.* round-25의 CI 주석은 후자였다. 그리고 그 틀린 근거의 출처가
   **리뷰어**였다는 사실(round-24 되먹임 6번)도 함께 남긴다 — `CLAUDE.md` §1의 "붙여넣은 리뷰를
   액면가로 받지 않는다"가 실제로 필요했던 사례가 두 라운드 연속으로 나왔다.
7. **리뷰 루프를 닫는 조건을 문서화한다.** 이번 판단의 근거는 "더 볼 게 없다"가 아니라
   **"프로덕션 변경량이 108 → 10 → 9 → 0으로 줄었고, 남은 지적이 전부 하나의 뿌리에서 나온
   커버리지"**다. 다음에 같은 질문이 나올 때 세어 볼 지표로 그 수치를 남긴다.

---

## 변경 범위 확인

`git status --porcelain`을 실행해 **이 리뷰 파일 하나만** 새로 생겼음을 확인했다.
변이 실험에 쓴 `server/src/repositories/google-drive.repository.ts`와, 이전 커밋 버전으로
잠시 바꿔 둔 `server/test/medium/specs/repositories/google-drive.repository.spec.ts`는
`git diff --exit-code`로 HEAD와 **바이트 단위 동일**함을 확인했다. 실 스키마 프로브는 이 저장소가
띄운 테스트컨테이너의 일회용 `mich` DB에서 `begin … rollback` 안에서만 돌렸고 커밋하지 않았다.
운영(랩탑) DB와 데스크탑의 `immich` DB는 읽지도 쓰지도 않았다. 임시 파일은 전부 스크래치패드
디렉토리에 있다.
