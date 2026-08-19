# Code Review Request — Wave 2: album Drive menu, storage gauge, per-user status

Wave 2 of the roadmap, adjusted for what Wave 1.5 changed underneath it. Two new read endpoints
and a UI rewrite; no schema, no migration, no change to how anything is uploaded.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commit | `8b3287b7a` |
| Diff | 18 files, +659/−27; excluding generated artifacts: 10 files, +458/−13 |
| Design | `dev-docs/google-drive/feature-roadmap.md` §3–4 (Wave 2 + gap E) |
| Tests | 2,319 server + 518 web pass |

## The premise the gauge rests on — verified before building, not assumed

The roadmap review (Q6) flagged that if `about.get(storageQuota)` were unreachable under the
`drive.file` scope, the gauge would force re-consent from every user — and recommended checking
empirically first. I did, against the live account:

```
OK {"limit":"5499705622528","usage":"128243802559",
    "usageInDrive":"123498526848","usageInDriveTrash":"115171945473"}
```

It works: `storageQuota` is account metadata, so scope restricts which *files* are visible, not
whether quota can be read. **This also means the reviewer does not need to re-derive it** — the
question is settled, and what remains is whether the code around it is right.

Incidental finding folded into the design: 107 GB of the 119 GB used is trash. On a
transit-buffer deployment "how full am I" and "how much could I reclaim" are different questions,
so `usageInDriveTrashBytes` is reported separately.

## What changed

**`GET /google-drive/storage`** — quota via `about.get`, per-user 60-second in-process cache,
`invalid_grant` mapped to a 400 "reconnect" rather than a 500.

**`GET /google-drive/me/status`** — per-user `{pending, failed}`, deliberately not album-scoped
(design review gap E). `countPendingUploads` reuses `streamPendingUploads`' predicate exactly —
selection ⋈ live membership ⋈ connection, minus ledger, minus soft-deleted — with one intentional
divergence noted below.

**Album header menu** replaces the immediate-sync icon: backup on/off for this album (with
`uploaded/total` as subtitle), "sync now" shown *only when something is pending* with the count,
the storage figure, and open-in-Drive. Contents load on open, not on page render.

**`ButtonContextMenu` gained `onOpen`** (3 lines) to make that lazy load possible.

## Where to attack

### 1. `countPendingUploads` diverges from `streamPendingUploads` on purpose — is that right?

The stream excludes users blocked by quota/folder (Wave 1 anti-join); the count does **not**. My
reasoning: a paused account still has that work outstanding, and reporting zero would suggest it
had been done. But it means the UI can show "17 pending" for a user whose uploads are blocked and
will stay blocked — arguably worse, since it looks like progress is imminent. The banner is
separate. **Which reading is right?**

### 2. The count uses `count(distinct assetId)`; the stream uses `.distinct()` on rows

Same intent (an asset in two selected albums is one pending item), different mechanism. Please
confirm they cannot disagree — particularly that the count isn't inflated when an asset sits in
several of the same user's selected albums.

### 3. Static in-process cache

`GoogleDriveService.storageCache` is a static `Map`, so it is shared across service instances and
never evicted except by overwrite. At two users this is nothing, but: unbounded growth in user
count, no TTL sweep, and it survives for the process lifetime. Acceptable, or should it be
bounded/moved? Tests clear it explicitly, which is itself a smell worth judging.

### 4. Three parallel calls on menu open

`getGoogleDriveAlbums` + `getGoogleDriveStorage` + `getGoogleDriveStatus`. The first returns
*every* album the user can see just to find one row — wasteful for a single album's state. Should
there be a per-album status endpoint instead, or is reusing the existing list acceptable at this
scale?

### 5. Modifying a shared upstream component

`onOpen` on `ButtonContextMenu` is the first time this fork changes a component outside the
feature's own files. It is additive and optional, but it widens the merge surface against
upstream. Reasonable, or should the lazy load have been achieved another way (e.g. loading on
mount behind the feature flag)?

### 6. Trash is fetched but not surfaced

`usageInDriveTrashBytes` is in the DTO and unused by the UI. Deliberate (the menu shows one
number; trash belongs in a fuller storage view) or premature?

## Verified

`tsc --noEmit` and `eslint --max-warnings 0` clean on server and web · 2,319 server tests (6 new)
and 518 web tests pass · `svelte-check` unchanged at 7 pre-existing errors in unrelated spec files
· OpenAPI/SDK/SQL regenerated · no schema change, so no migration and no drift check needed.

**Not verified:** not deployed. The gauge has been exercised against the real Google API only
through the one-off probe above, not through the endpoint; the menu has never been clicked in a
browser. The `me/status` endpoint has no consumer yet — it exists for Wave 3.
