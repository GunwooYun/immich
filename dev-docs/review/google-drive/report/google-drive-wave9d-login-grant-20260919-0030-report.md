# Review request — wave9d: wave9b fold-in + Google-login Drive grant

**Branch:** `feat/google-drive-album-sync-v3.1.0`
**Commits:** `b72e446f1` (wave9b review fixes), `76ab2a3f0` (CLAUDE.md Current Project), `cfc8cdb93` (login grant), evidence commit after it
**Previous:** `review/google-drive-wave9b-drive-badge-20260916-2325-review.md` — BLOCKED (C1; N1–N5)
**Separately under review:** wave9c (disconnected dot + CAS on connectionId). Its commits precede these; ignore them here.
**Diff:** `git diff f47d59906 cfc8cdb93 -- server/src web/src CLAUDE.md`

## Part 1 — wave9b fold-in (`b72e446f1`, web only)
| Finding | Change |
|---|---|
| C1 badge cache survived logout (SPA `goto`, seven sibling singletons clear on `AuthLogout`; A's badges visible to B in the same tab via a shared album) | manager subscribes `eventManager.on({ AuthLogout: () => this.reset() })`; test asserts `has('a')` true before the emit and false after |
| N2 disconnect leaves stale badges | `handleDisconnect` in `GoogleDriveSettings.svelte` calls `reset()` |
| N1 report's "request() touches no reactive state" was wrong | comment corrected: `SvelteSet.has` on a missing key subscribes to the set version, so each flush re-runs Timeline's effect; still no loop because the re-run has nothing new to queue |
| N3 shared-link guard test | **not added, deliberately**: `authManager.isSharedLink` is `$derived` over a non-reactive mocked `page.route`, computed once per module; flipping it needs the manager mocked, which would weaken every other case in that file. Comment records this. **Please check my reasoning** |
| N4, N5 | no action |
Mutation: removing the `AuthLogout` subscription fails the new test.

## Part 2 — Google-login Drive grant (`cfc8cdb93`, server only)
Inert unless configured; this deployment does not meet the gate today.

| Layer | Change |
|---|---|
| `utils/google-drive.ts` | `GOOGLE_DRIVE_FILE_SCOPE`, `hasGoogleDriveFileScope` (whitespace split, whole-token match), private `normalizeIssuerUrl`, `isGoogleDriveLoginGrantEnabled(config)` = oauth.enabled ∧ issuer==accounts.google.com ∧ `oauth.clientId === googleDrive.clientId` (non-empty) ∧ login scope has drive.file ∧ `isGoogleDriveEnabled` |
| `repositories/oauth.repository.ts` | `authorize(..., extraParams?)` spread **first** so redirect_uri/scope/state/PKCE cannot be overridden; exchange returns `refreshToken`, `grantedScope` |
| `services/auth.service.ts` | gated `access_type=offline&include_granted_scopes=true`; `callback` and `link` call `connectGoogleDriveFromLogin` → emits `GoogleDriveLoginGrant {userId, refreshToken}` in try/catch, warning names only the user |
| `repositories/event.repository.ts` | event + payload type |
| `services/google-drive.service.ts` | `linkAccount`'s post-exchange half extracted to `storeGrant`; `@OnEvent` handler: not enabled → return; **existing credentials → return with no write** (no re-mint of connectionId, no drain, no probe); else `storeGrant` |

Mutations (author's, two re-run by me): existing-credentials return removed → "leave an existing connection completely alone" fails; granted-scope check removed → both callback and link negatives fail; clientId clause removed → 3 fail.

## Evidence
`dev-test/google-drive/results/` newest — commit `cfc8cdb93`, clean tree: server 307, web 70, svelte-check no regressions, RESULT: PASS. `mise //server:ci-unit` 2431 passed / 2 skipped; `mise //web:ci-unit` 586 passed / 2 skipped.

## Please attack
1. **The emit is awaited in-process.** On a first Drive connect the login response now waits for `storeGrant`, which probes Google (`about.get`, 10s timeout) and can hit google-auth-library's unbounded refresh retry. A failure cannot break login (catch), but a slow Google delays one login. Is awaiting right (the connection exists when the page loads) or should it be fire-and-forget?
2. **`link` path.** Linking OAuth to an existing account emits too — correct? Can `link` be reached by a user linking a *different* Google account than the one already connected to Drive, and does the first-link-only rule handle that safely?
3. **Gate completeness.** Any other config combination where a stored token would be unusable — e.g. `oauth.clientSecret` differing from `googleDrive.clientSecret` (not checked; refresh uses the Drive secret)? Should the secret be compared too?
4. **Scope handling.** `include_granted_scopes=true` (incremental auth) — can this yield a token whose granted scope lacks drive.file on a *later* login while the earlier grant still has it, and does that matter given first-link-only?
5. **`authorize` extraParams**: confirm nothing can override redirect_uri/state/PKCE, and that ungated logins are byte-identical to before.
6. Anything in `storeGrant`'s extraction that changed `linkAccount`'s behaviour.
7. Part 1 N3: is skipping that test right, or is there a clean way to flip `isSharedLink`?

## Not verified
- No end-to-end run of the new path: this deployment does not meet the gate (it has no OAuth login configured), and enabling it needs Google-console changes only the owner can make.
- Mobile OAuth deliberately out of scope.
- No medium test (no SQL change).
