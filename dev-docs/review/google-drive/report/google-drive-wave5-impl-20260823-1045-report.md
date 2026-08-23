# Code Review Request — Wave 5 implementation (album menu UX + worker selection gate)

The design for this was reviewed first
(`../review/google-drive-album-menu-ux-20260820-1130-review.md`); this is the implementation of
that design with every verdict applied. Two commits: the server gate, then the web UI.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commits | `320646871` (server), `9c1e52bd3` (web) |
| Diff | 10 files, +628/−114 (excluding generated SQL) |
| Design + decisions | `dev-docs/google-drive/album-menu-ux-plan.md` |

## Unit test results

`./dev-test/google-drive/run.sh --medium`, run at HEAD (`9c1e52bd3`) so the evidence matches a
checkout of this branch. Archived at `dev-test/google-drive/results/20260823-1042.txt`.

```
commit: 9c1e52bd3
── server (unit) ──   199 passed
── web (unit) ─────     8 passed
── server (medium) ─    4 (in this file) of 8 GD-repo medium passed
════════════════════════
RESULT: PASS
```

Full suites: 526 web pass. `tsc --noEmit` and `eslint --max-warnings 0` clean on server and web;
`svelte-check` unchanged at 7 pre-existing errors in unrelated specs; SQL regenerated; migration
drift check clean.

## What shipped

**Server — the worker selection gate (design decision 1).** Deselecting an album deletes the
selection row but can't recall queued jobs, and the worker never checked selection — so those jobs
kept writing real files into the user's Drive. `uploadAsset` now skips an asset unless it's still
in *some* album the user has selected and can see (`isAssetInSubscribedAlbum`). Gate order is
`enabled → connected → hasUpload → selection → blocked` (review Q2: PK lookup before the join;
join only for genuinely-pending assets).

**Web — the three UI asks**, in a dedicated `GoogleDriveAlbumMenu` component so the shared
`MenuOption` is untouched: a real toggle switch, a storage bar (80%/95% colour thresholds), and
dividers with 10px rows. "Sync now" stays visible-but-disabled at zero pending.

## Where to attack

### 1. The selection gate join (server) — highest value

`isAssetInSubscribedAlbum` joins `album_asset ⋈ google_drive_album ⋈ album_user`. This is the same
membership join the feature keeps getting subtly wrong, so it has four medium tests on real
Postgres (in a selected+visible album → true; after deselect → false; still true via a second
selected album; false after unshare while the selection row survives). **Please check the join
itself** — is there a shape where it returns true for an asset that should no longer upload, or
false for one that should?

### 2. Is "any selected album" the right rule?

An asset in albums A and B, with only A deselected, keeps uploading because of B. That matches the
ledger's per-asset idempotency, but it means "turn off album A" doesn't stop an asset also in B —
which is correct but could surprise. Confirm the semantics.

### 3. Gate ordering cost

`hasUpload` (PK) now precedes the selection join, so idempotent re-queues bail cheaply. But the
selection join and the blocking lookup are both per-job for genuinely-pending assets — two queries
where there was one. At this scale it's nothing; flag if the ordering could be tighter.

### 4. The new component duplicates MenuOption's styling by hand

`GoogleDriveAlbumMenu` reimplements row layout, hover, and dividers rather than extending
`MenuOption`, deliberately (so the shared component stays untouched). The cost is that if the app's
menu styling changes, this drifts. Reasonable fork, or should it have been a variant prop?

### 5. Storage bar thresholds live in two places

The web bar uses 80%/95% (`GoogleDriveAlbumMenu`), matching the server's quota-block behaviour.
They're not shared — a constant in TS and the server's own logic. Acceptable duplication, or worth
a shared source?

## Not verified

Not deployed. The toggle, bar, and dividers have never been seen in a browser — only the server
logic and the progress manager have tests. The visual states (bar colours, disabled "sync now",
the unconnected-member row) are unproven until deploy. The gate's *end-to-end* effect
(deselect → queued job actually skips) is proven at the repository layer by the medium tests but
not through a live queue.
