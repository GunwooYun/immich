# Code Review Request — Wave 3: backup progress display

Front-end only. No server changes, no schema, no migration — it consumes the `me/status` endpoint
Wave 2 built for exactly this.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit | `316165fb3` |
| Design | `dev-docs/google-drive/feature-roadmap.md` §4 |
| Prior review | `../review/google-drive-wave2-20260820-1030-review.md` (all verdicts applied in `5c6435e82`) |

## Unit test results

`./dev-test/google-drive/run.sh --medium` — full output archived at
`dev-test/google-drive/results/20260820-0737.txt`.

```
date:   2026-08-20T07:37:05+09:00
commit: 316165fb3 (feat/google-drive-album-sync-v3.1.0)

── server (unit) ──────────────────────────────────
      Tests  197 passed (197)
── web (unit) ─────────────────────────────────────
      Tests  7 passed (7)
── server (medium, needs a database) ──────────────
      Tests  4 passed (4)
════════════════════════════════════════════════════
RESULT: PASS
```

Regression suites: 2,323 server + 525 web pass. `tsc --noEmit` and `eslint --max-warnings 0` clean
on both; `svelte-check` unchanged at the 7 pre-existing errors in unrelated spec files.

New this wave: 7 tests in `web/src/lib/managers/google-drive-progress-manager.svelte.spec.ts` —
shared timer across watchers, polling stops when the last watcher leaves, idle back-off, blocked
account not reported as active, and last-known values preserved when a poll fails.

## What changed

A shared polling manager, a corner progress card, and a live row inside the album Drive menu.

- **`google-drive-progress-manager.svelte.ts`** — reference-counted subscribers so the card and
  the menu share one timer; 3s cadence easing to 15s when the count stops moving; skips the
  request while the tab is hidden and refreshes on return; a failed poll is silent and keeps the
  previous numbers.
- **`GoogleDriveProgressPanel.svelte`** — bottom-corner card, modelled on `DownloadPanel` so it
  reads as the same kind of object. Appears only for work the user started *in this tab*. A
  blocked account gets prose and a link to Settings instead of a bar.
- **Album menu** — the "sync now" row reports live progress while a sync is moving, rather than
  the snapshot taken when the menu opened.
- **`ButtonContextMenu`** — unchanged this wave (the `onOpen` addition was Wave 2).

## Where to attack

### 1. The card's visibility rule, and the edge it accepts

It shows on `userInitiated && (pending > 0 || blocked)`, where `userInitiated` is set by pressing
sync or turning backup on. Rationale: adding photos to an album also queues uploads, and a card
appearing unbidden for that is startling, where the same card is useful feedback for a button you
just pressed.

**The accepted cost:** reloading mid-sync loses the flag, so the card does not come back. Progress
is still in the album menu. The roadmap review suggested a more robust trigger
(`pending > 0 && connected && (session-initiated || movement seen)`). I did not build that —
"movement seen" would make the card appear for background work after one tick, which is the
surprise the flag exists to avoid. **Is the simpler rule the right trade, or is the reload edge
worse than I'm treating it?**

### 2. Progress is derived from a remembered peak

The client never learns a total — only how many are outstanding. So the bar uses the highest
`pending` seen this session as the denominator and fills as it drops. Consequences: a second batch
queued mid-run raises the peak and the bar jumps backwards; and the peak resets when pending hits
zero. **Acceptable, or should the bar be replaced with a plain count while there's no honest
denominator?**

### 3. Module singleton with a live timer

The manager is a module-level instance holding a `setTimeout`. It is never torn down (the app has
no unmount), and its `visibilitychange` listener is registered at import time and never removed.
Fine for a SPA that lives as long as the tab, but flag it if you disagree — and note this shape
already bit the tests twice, where a failing assertion skipped cleanup and leaked a live timer
into the next test (fixed by moving unsubscription to `afterEach`).

### 4. `pending` counts blocked work, and the UI has to keep remembering that

Wave 2 decided `pending` includes a paused account's outstanding assets, with `blockedReason`
travelling alongside. The manager exposes `active = pending > 0 && !blockedReason` so consumers
don't have to re-derive it, and both consumers use it. **Is one derived flag enough, or will the
next consumer forget again?**

### 5. Two components, one store — is the coupling right?

The album menu subscribes on menu-open and unsubscribes on component destroy, so opening a menu
while the card is already polling costs nothing. But the menu also keeps its own snapshot
(`driveUploaded` / `driveTotal`) for the not-syncing case, so there are two sources of truth on
that row depending on `active`. It reads correctly to me; say so if it doesn't.

## Not verified

Not deployed. The card and the live row have never been seen in a browser — only the manager's
logic is covered by tests. No test exercises the Svelte components themselves; per
`dev-test/google-drive/README.md` that is a deliberate coverage gap (logic lives in the manager,
markup is left to `svelte-check` and on-device checking), but it means the visual states —
especially the blocked-account prose — are unproven.
