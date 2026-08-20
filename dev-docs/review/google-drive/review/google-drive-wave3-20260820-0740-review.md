# Code Review — Wave 3: backup progress display

Review of commit `316165fb3` (front-end only; consumes Wave 2's `me/status`). Verified the manager's
data source (`me/status` now returns `blockedReason` — the Wave 2 Q1 fix landed), the panel's
mount/poll lifecycle, and the album-menu live row against the fact that `me/status` is *user*-scoped.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Code | `316165fb3` (branch HEAD `074a73abb` = test hub only) |
| Reviewed | 2026-08-20 |
| Report | `../report/google-drive-wave3-20260820-0740-report.md` |

## Verdict

The manager is well-built — the reference-counted shared timer, idle back-off, hidden-tab skip, and
silent-failure-keeps-last-value are all right, and the tests cover the parts that are invisible when
wrong. But two things need fixing before deploy, and neither is quite where the five questions point:

- 🔴 **The album-menu live row shows the user's *total* pending on an *album* row** — wrong whenever
  someone backs up more than one album, which is gunwoo's actual configuration.
- 🟠 **The corner card polls `me/status` forever, unconditionally**, for every logged-in user on
  every instance — including ones where Drive is disabled — because the always-mounted panel calls
  `watch()` on mount, decoupled from `userInitiated`.

The five questions are answered below; the honest answer to Q5 is "no, and that's where the bug is."

---

## 🔴 Q4/Q5 — the live row conflates user-wide pending with this album's

This is the real content of Q5 ("two sources of truth on one row"). The menu row:

```svelte
{#if driveBackedUp && driveTotal > driveUploaded}
  count = active ? manager.pending : (driveTotal - driveUploaded)
```

`driveTotal - driveUploaded` is **this album's** pending (from `getGoogleDriveAlbums`, album-scoped).
`manager.pending` is **the user's** pending across *all* selected albums (`me/status`, which Wave 2
deliberately made user-scoped for gap E). These are different populations, and `active` switches
between them.

So when the user backs up more than one album, the row lies. Concrete, live case: gunwoo backs up
건우카메라 *and* 서희카메라. A 서희카메라 sync is moving (`manager.pending = 200`). He opens 건우카메라's
menu, which has 50 of its own pending. The row shows **"건우카메라: syncing — 200 pending"** — the
whole account's backlog attributed to one album. With a single backed-up album the two numbers
coincide, which is why it "reads correctly" in isolation, but the target deployment is precisely the
multi-album case.

There is no album-scoped *live* source to switch to — Wave 2 built only `me/status` (user-scoped),
and my Wave 2 review flagged that the per-album status endpoint wasn't built. So the fix now is:
**don't put `manager.pending` on an album row.** Keep the album row on its own snapshot
(`driveTotal - driveUploaded`), optionally refreshing that snapshot, and let the *corner card* — which
is legitimately user-scoped — carry the live user-wide number. When you build the per-album endpoint
(recommended for Wave 2/3 anyway), the row can go live against *that*. Until then, the honest album
row is the snapshot.

So my answer to Q5: the coupling is **not** right — the two truths measure different things, and
`active` blends them.

## 🟠 Q3 — the poller runs forever for everyone, not just "never torn down"

The report frames Q3 as "module singleton never torn down — fine for a SPA." The teardown isn't the
issue; the *coupling of the poll to component mount* is. `GoogleDriveProgressPanel` is rendered
unconditionally in `+layout.svelte` (no feature-flag guard, alongside `DownloadPanel`), and it calls
`onMount(() => googleDriveProgressManager.watch())`. `+layout` never unmounts, so `#watchers` is
permanently ≥ 1, so `#schedule()` loops for the entire tab session. Consequences:

- **Every logged-in user polls `me/status` every 3s (easing to 15s) for their whole session**, whether
  or not they've ever touched Drive. Each poll is `countPendingUploads` (a six-join query) +
  `getErrorSummary` (two queries).
- **On an instance where the Drive feature is disabled**, the panel still mounts and still polls —
  `featureFlagsManager.value.googleDrive` gates nothing here. That's pure waste hitting an endpoint for
  an off feature.
- `userInitiated`/`visible` gate only whether the card is *drawn*, not whether it *polls*.

At two users this is nothing; as an architecture (and if this ever goes upstream) it's wrong: a
background feature nobody is using shouldn't poll perpetually. And the card doesn't need a background
poll to *appear* — `markUserInitiated()` already calls `refresh()` on the triggering action, pushing
the state in. **Fix:** scope `watch()` to when the card actually needs data — an `$effect` that
watches while `userInitiated` (or `visible`) and releases when work completes — and gate the panel on
the Drive feature flag. That also dissolves the test-pollution shape the report notes: the leaked
timer is the same永-watcher problem seen from the test side.

(The never-removed `visibilitychange` listener is benign — one idempotent listener for the tab's life —
so leave it; the perpetual poll is the part to fix.)

## 🟠 Q2 — the peak denominator regresses; prefer a plain count or a cumulative total

The remembered-peak bar goes *backwards* exactly in the flow this pipeline does constantly: sync album
A (peak 100, drains to 50 → 50 %), then add photos to album B (auto-queues 200) → next poll
`pending = 250` → peak 250 → bar snaps from 50 % back to 0 %. On a deployment whose normal mode is
"keep adding to albums," that regression isn't an edge, it's Tuesday.

A bar needs an honest denominator and the client has none, so two better options:

1. **Plain count** — "N remaining · M failed." Always honest, never regresses. Simplest, and it's
   *already* what the album menu row shows, so the card would match it.
2. **Cumulative session total** — accumulate `done += max(0, prevPending − pending)` and
   `total = done + pending`; a new batch *extends* `total` (bar shrinks proportionally) but `done`
   never drops, so it's monotonic. This is the real DownloadPanel model — which has a known total; the
   peak hack is what you get when you copy the panel's *look* without its data.

Peak-pending is the one option that visibly lies. I'd take (1) for this scale — the goal is
reassurance, and "142 remaining" reassures without pretending to a percentage it can't compute.

## Q1 — visibility rule: accept, and you were right to decline my earlier suggestion

`userInitiated && loaded && (pending > 0 || blocked)` is a sound trade, and I'll note explicitly that
you correctly rebutted the roadmap review's "movement seen" idea — it *would* surface background
add-to-album work after one tick, which is the surprise the flag exists to prevent. Good call declining
it. The reload edge is genuinely minor: the flag is a module singleton, so it **persists across SPA
navigation** (the card follows you around the app mid-sync) and is lost only on a full reload, where
the album menu still carries the number. For a family server that's the right place to spend the
simplicity. Two small confirmations from reading it: work-finished correctly clears `userInitiated`
via the `pending === 0` branch; and a *revoked* account can't produce a false bar here because
`countPendingUploads` inner-joins the connection, so a disconnected user reports `pending = 0` and the
card defers to the settings banner. Keep the rule.

## Q4 — one `active` flag: adequate, but a status enum would be more foolproof

`active = pending > 0 && !blockedReason` is the right centralization and both consumers use it — this
is the Wave 2 Q1 concern properly discharged. The residual risk you're asking about (the *next*
consumer forgetting) isn't closed by a boolean it can still bypass by reading `.pending` raw. If you
want it foolproof, expose a single derived status — `'idle' | 'syncing' | 'paused' | 'done'` — and have
consumers switch on that instead of composing `pending`/`blockedReason`/`active` themselves. Not
required; it's the shape that makes the mistake unrepresentable rather than merely discouraged.

---

## Smaller notes

- **Gate the panel on the Drive feature flag** (folds into Q3). Right now it mounts and polls on
  instances with Drive turned off.
- **`peak` reset to 0 at `pending === 0`** is harmless only because `visible` also drops at
  `pending === 0` (the card hides before the 0 % is seen). Fine, just coupled — if the visibility rule
  ever changes, revisit.
- **`failed` on the card** is `me/status.failed`, which lumps every error class (`revoked`,
  `source_unreadable`, `rate_limited`, …), so it reads as "not yet succeeded," not "permanently
  failed." Consistent with Wave 1's `failedCount`, just worth knowing when the number looks alarming.

---

## Priority

1. **Fix the album-menu live row** (Q4/Q5) — it must not show `manager.pending` (user-wide) on an
   album row; use the album snapshot until a per-album live endpoint exists. Wrong on gunwoo's actual
   multi-album setup.
2. **Scope the poll to need** (Q3) — `watch()` while `userInitiated`/visible, not on mount, and gate
   the panel on the feature flag. Stops perpetual polling for everyone, everywhere.
3. **Replace the peak bar** (Q2) with a plain count (matches the menu row) or a cumulative total.
4. Accept: Q1 (good trade, correct rebuttal of the old suggestion), Q4 (`active` is enough; enum
   optional). The manager's timer/back-off/hidden-tab/silent-failure logic is correct and well-tested.

The polling machinery is the hard part and it's done well. The two fixes are both about *scope* — the
poll's scope (session-wide, should be need-scoped) and the live number's scope (user-wide, shown on an
album-scoped row). Get those aligned and Wave 3 is solid.
