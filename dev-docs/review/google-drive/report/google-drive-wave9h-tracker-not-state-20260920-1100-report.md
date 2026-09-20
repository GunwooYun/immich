# Review request — wave9h: album-id tracker is a plain variable

**Commit:** `HEAD` (one line + comment, web only) · **Previous:** wave9g review, N1
**Diff:** `git diff 6fec788a3 HEAD -- web/src`

wave9g N1: `driveIndicatorAlbumId` as `$state` was read and written in one `$effect`, which
re-schedules it once; since the load call is outside the guard, both indicator requests fired
twice per mount and per album change. Now a plain `let` — nothing renders it.

**Tests:** `mise //web:ci-unit` 594 passed / 2 skipped; svelte-check 0 errors in that file.
No new test: nothing in this repo renders this page, so the double-fetch is not observable from
vitest. Reviewer's runtime-script method is the only demonstration so far.

**Attack:** (1) Is a plain `let` correct here, or does the effect need the value to survive a
component re-init that a non-reactive variable would lose? (2) Does the guard still do its job —
same-album reload keeps the dot, different album clears it? (3) Any other `$state` in this file
read-and-written in one effect with the same problem?

**Short by design:** keeping the review, cutting the paperwork (user decision, 2026-09-20).
