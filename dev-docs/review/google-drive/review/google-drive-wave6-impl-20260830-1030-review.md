# Code Review — Wave 6 implementation (env credentials, derived redirect URL, picker gating)

First wave since Wave 5 shipped, and the first review in six rounds to cover shipped code rather
than test infrastructure.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commits reviewed | `1f00f78e2` (server), `b38d36a84` (web) |
| HEAD at review | `17a9ce2cf` |
| Report | `../report/google-drive-wave6-impl-20260830-1030-report.md` |
| Plan | `dev-docs/google-drive/wave6-plan.md` |
| Reviewed | 2026-08-30 |

## Verdict

**The three changes are sound and the four claims I could attack hold up.** The no-freeze argument
is correct and I could not find a path that persists an env-supplied credential. There is no fourth
`isGoogleDriveEnabled` path. The gate tests are genuinely non-vacuous — and I identified precisely
which test carries the load-bearing mechanism, which is not the one you'd assume. The security
judgment on the secret exposure is right for a reason worth stating: both endpoints carry the
*same* guard.

**Two findings:**

- **M1 (moderate, behavioural)** — the inverse of the freeze problem, which the analysis didn't
  reach: an admin **cannot clear** an env-supplied credential from the UI. Clearing the field and
  saving persists `{}` and the effective value silently reverts to the environment's. The admin
  gets success feedback for an action that did nothing. This is a behaviour change introduced by
  this wave, and it is untested. Verified end-to-end against the real `updateConfig` + `buildConfig`.
- **M2 (process)** — the attached test evidence **predates the code under review**. The cited
  `results/20260830-0835.txt` stamps commit `906ebe959`, the parent of both Wave 6 commits, and
  reports 208; the committed `run.sh` at HEAD produces **237**. The report discloses the spec-list
  mismatch but not that the run predates the code.

I re-ran the suite myself — **237 / 29 / 10 PASS**, gate clean, at `17a9ce2cf` — so M2 is an
evidence-discipline problem, not a correctness one. M1 is the only thing I'd want changed before
this is considered done, and it is small.

### Evidence I ran myself

| Check | Result |
|---|---|
| `./dev-test/google-drive/run.sh --medium` at HEAD `17a9ce2cf` | **237 / 29 / 10**, svelte-check gate clean, **PASS** |
| The report's cited evidence file | stamped `906ebe959` — **the parent of both Wave 6 commits** (M2) |
| `updateConfig` — full-form save with env-supplied defaults | persists `{}` — no freeze ✓ |
| `updateConfig` — **cleared** env-supplied field | persists `{}`, effective value stays `env-client-id` — **M1** |
| Writers of `SystemMetadataKey.SystemConfig` | exactly one (`utils/config.ts:61`) ✓ |
| `isGoogleDriveEnabled` consumers, repo-wide (server + web + mobile) | all routed through it; no fourth path ✓ |
| `config.spec.ts` with `vi.resetModules()` removed from **both** sites | only "should leave the credentials empty…" fails — mechanism is load-bearing ✓ |
| `getGoogleDriveRedirectUrl` across 8 externalDomain shapes | 6 clean; 2 survive normalization (see attack 4) |
| Guards on `/system-config` and `/system-config/defaults` | **identical** — `SystemConfigRead` + `admin: true` ✓ |
| Redaction of `oauth.clientSecret` anywhere in the codebase | **none exists** — same class confirmed ✓ |

---

## Answers to the five things you asked me to attack

### 1. The no-freeze claim — holds; but the inverse case is broken (**M1**)

`updateConfig` is the **only** writer of `SystemMetadataKey.SystemConfig` (one call site,
`utils/config.ts:61`), and it skips any property that is `isEmpty` or `isEqual` to the default:

```ts
const isEmpty = [undefined, null, ''].includes(newValue);
const isEqual = newValue === defaultValue || _.isEqual(newValue, defaultValue);
if (isEmpty || isEqual) { continue; }
```

Since an env-supplied credential *is* the default, a full-config save skips it. I confirmed this
against the real function rather than the test: saving `defaults` persists `{}`. No partial-merge or
nested-key path escapes it — `getKeysDeep(defaults)` walks leaves, and `buildConfig` merges the
stored partial *over* `defaults`, so an absent key means "use the default", which is the env value.
**No freeze.**

**What the analysis missed is the same rule running the other way.** `isEmpty` includes `''`, so an
admin who *clears* the client ID and saves also writes nothing — and `buildConfig` then falls back
to the default, which is now the environment's value rather than `''`. Verified end-to-end with
stubbed env and the real `updateConfig`:

```
admin clears clientId and saves
  persisted partial            -> {}
  effective clientId after save -> "env-client-id"
```

Before this wave the default was `''`, so clearing produced `''` — it worked. Now clearing is a
silent no-op: the field is editable, the save reports success, and reopening the form shows the
value back. The admin UI marks env-supplied fields with a description hint, which helps explain
*where* the value came from but does not say it cannot be removed, and does not disable the input.

Two concrete consequences: an operator who wants to stop using an env credential (rotation after
exposure, or moving credential management into the DB) cannot express that from the UI at all, and
the only way to express "no credential" is to unset the env and restart. That may well be the
intended model — but silently discarding an admin's edit is the pattern this repo has flagged
repeatedly, and it is currently undocumented and untested.

**Options, cheapest first:** make the hint say so ("supplied by the environment; clear it there"),
or render env-supplied fields read-only with that note, or treat an explicit clear as an override
(which would need a sentinel, since `''` already means "unset" for every other config key — I would
not do this). Whichever, add a `system-config.service.spec.ts` case pinning the chosen behaviour;
the two tests added this round cover the freeze direction only.

There is also a narrow **stale-form race** worth one line in the plan rather than code: the admin's
browser holds value X, the operator changes the env to Y and restarts, the admin saves the stale
form — now X ≠ defaults(Y), so X *is* persisted and genuinely frozen. Requires all three, so not
worth guarding, but it is the one shape where the freeze the claim rules out can actually happen.

### 2. `isGoogleDriveEnabled` fan-out — no fourth path

Grepped server, web and mobile for anything that decides whether this feature is on:

- `server.service.ts:122` — `isGoogleDriveEnabled(googleDrive, server)` → the `googleDrive` feature
  flag. **Every** web consumer reads that flag: `+layout.svelte:273`, the album page `:669`,
  `UserSettingsList.svelte:143`, `QueuePanel.svelte:94`. So the web has no independent notion.
- `album.service.ts:364` and `google-drive.service.ts:181` — both call it directly.
- `admin/system-settings/GoogleDriveSettings.svelte:37` binds `configToEdit.googleDrive.enabled` —
  that is the admin *toggle*, not a decision about whether the feature is on.
- Mobile has no Google Drive gate of its own.

The one that looks like a fourth path is `google-drive.service.ts:148`, a bare
`if (!googleDrive.enabled)` inside `getOAuth2Client`. It isn't a divergent definition: the function
goes on to check `clientId`, `clientSecret` and the derived `redirectUrl` individually, so it
evaluates the *same* predicate decomposed into per-field error messages. That is deliberate and the
doc-comment says why — the interactive path wants "missing client secret", not `false`. Consistent.

### 3. Vacuous passes — not vacuous, and the guard isn't the test you'd guess

Your concern was `config.spec.ts` depending on `vi.resetModules()` + dynamic import really
re-evaluating. I tested it by neutering — and my first attempt was wrong in an instructive way:
removing `vi.resetModules()` from `loadDefaults` alone changed nothing, because `afterEach` still
calls it. With it removed from **both** sites:

```
✓ should take the credentials from the environment
× should leave the credentials empty when the environment does not set them
  → expected 'env-client-id' to be ''
✓ should keep the feature off and the redirect URL underivable by default
```

So the mechanism **is** load-bearing, and the test that proves it is the *second* one — the one
that reads like a trivial negative. Test 1 passes with or without the reset, because it runs first
and its dynamic import evaluates the module fresh under its own stubs; it is not evidence the reset
works. Worth a comment on test 2 saying it is the guard, otherwise someone "simplifying" the
`afterEach` will remove the only thing holding the file honest.

**The `misc.spec.ts` gate tests are exemplary** and I could not make one pass for the wrong reason.
Each disabled case explicitly rules out the redirect URL as the cause before asserting `false`:

```ts
expect(getGoogleDriveRedirectUrl(config, server('https://immich.example.com'))).not.toBe('');
expect(isGoogleDriveEnabled(config, server('https://immich.example.com'))).toBe(false);
```

That is exactly the §4 standard, and the underivable-URL case does the mirror image (asserts the
credentials *are* present). No gap found.

### 4. The derivation — two shapes survive normalization

`buildConfig` reduces `externalDomain` with `new URL(...).origin`, and `getGoogleDriveRedirectUrl`
strips trailing slashes defensively on top. I ran the real normalization over eight shapes:

| externalDomain | derived redirect |
|---|---|
| `https://immich.example.com` | `https://immich.example.com/api/google-drive/callback` |
| `…/` and `…///` | same — trailing slashes handled ✓ |
| `https://Immich.EXAMPLE.com` | lowercased by `.origin` ✓ |
| `https://immich.example.com:2283` | port preserved ✓ |
| `https://immich.example.com/immich` | **`https://immich.example.com/api/…`** — subpath **dropped** |
| `http://user:pass@immich.example.com` | **`http://user:pass@immich.example.com/api/…`** |

The first four are exactly right, including the uppercase case the defensive `replace` doesn't
cover — `.origin` does.

The two that survive are both upstream normalization behaviour rather than anything introduced
here, but the derivation is what makes them matter:

- **Subpath deployment.** `.origin` strips the path, so an instance served at
  `https://host/immich` derives a callback missing `/immich` and Google would never match it. The
  `redirectUrl` override is the escape hatch and works — worth naming in the field's help text,
  since the failure is an opaque Google error.
- **Credentialed URL.** `buildConfig`'s `username && password` branch returns
  `${protocol}//${user}:${pass}@${host}` rather than an origin, so the credentials end up inside the
  redirect URI — which Google will reject, and which puts a password in a URL that gets logged.
  Absurd configuration, upstream's quirk, not this wave's bug. One line in the plan, not code.

### 5. Security of the exposure — same class, and for a checkable reason

Correct judgment. Both endpoints carry an identical guard:

```ts
@Get()          @Authenticated({ permission: Permission.SystemConfigRead, admin: true })
@Get('defaults') @Authenticated({ permission: Permission.SystemConfigRead, admin: true })
```

and there is **no redaction layer anywhere** — `oauth.clientSecret` is returned in plaintext by the
same endpoint today. So this is the established treatment for a deployment-level OAuth secret in
this codebase, not a new relaxation.

The one nuance worth recording: `/system-config/defaults` becomes secret-bearing **for the first
time** (its `googleDrive.clientSecret` was `''` before, as `oauth.clientSecret`'s still is). That
changes which endpoint holds the secret, not who can read it — same permission, same audience — so
the class is genuinely unchanged. It does mean anyone reasoning later about "defaults are static
constants, safe to log/cache" would now be wrong; worth a line in the plan.

---

## M2 — the attached evidence predates the code

The report's Test evidence block cites `dev-test/google-drive/results/20260830-0835.txt`. That file
stamps:

```
commit: 906ebe959 (feat/google-drive-album-sync-v3.1.0)
```

`906ebe959` is the Wave 5 deploy commit — the **parent of `1f00f78e2`**. So the run happened before
either Wave 6 commit existed. It presumably ran against an uncommitted working tree containing the
changes (it reports 208 where Wave 5 ended at 199), but that is exactly what cannot be verified
from the artefact, which is the reason CLAUDE.md §2 asks for it: *"N개 통과라고 쓰기만 하면 리뷰어가
검증할 수 없다."*

Separately, the headline number is stale: `659b4540d` added `config.spec.ts` and `misc.spec.ts` to
`SERVER_SPECS`, so the committed `run.sh` now yields **237**, not 208. The report notes the two
specs "were run directly", which is honest but leaves the attached figure unreproducible in both
directions.

I re-ran it at HEAD and everything passes — **237 / 29 / 10, gate clean, RESULT: PASS** — so this
costs nothing in substance. Regenerate the evidence at a commit that contains the code, and the
attachment does its job again.

---

## Affirmations

- **The `pickerAvailable` gating is the right shape.** `!!googleDrive.apiKey` on the server, `false`
  until the status call answers so the button cannot flash in, and the manual folder-id field
  becomes the only route rather than a second-class one. The parameterised spec covers both
  polarities.
- **Not putting `redirectUrl` in the environment** is a good call and the comment says why: it is
  derived, so there would be nothing to type. One less thing to get wrong.
- **Refusing a `my.immich.app` fallback** — "off beats subtly broken" is right, and it is the
  difference between a named error and an opaque Google one.
- **Rewriting the "deliberately no env fallback" comment** that this wave reverses. That comment
  would otherwise have become exactly the kind of stale doc CLAUDE.md §1 warns about, and it is the
  second time this branch has caught one on the way past.

## What I did not verify

- **The Tailscale HTTPS path** — certificate issuance, `tailscale serve` proxying, and whether
  `X-Forwarded-Proto` yields a Secure cookie through the existing `trust proxy` config. Unchanged
  from the report's own caveat; it needs the deployment.
- **An actual family-member connect flow** — same.
- **The four visual states in a browser**, and **the gate end-to-end through a live BullMQ queue** —
  both carried over from Wave 5 and still open.
- **The full server suite (2347) and web suite (547)** — I ran the feature suite and the specs this
  wave touches, not the full sweeps; no reason to doubt them.
- **M1's fix** — I reproduced the behaviour and described the options, but did not implement one.

## Feeding back into the plan

`wave6-plan.md` should record:

1. **The no-freeze property is real and verified**, and the two tests added for it cover the freeze
   direction only. **M1 is the missing direction** — clearing an env-supplied credential is a silent
   no-op — and whichever behaviour is chosen needs its own test.
2. **`config.spec.ts`'s guard is the "empty when unset" test**, not the "from the environment" one.
   Record that, because it is counter-intuitive and the `afterEach` reset looks removable.
3. **Two externalDomain shapes bypass the derivation** (subpath stripped by `.origin`; credentialed
   URL kept verbatim). Both are upstream behaviour that the derived redirect newly depends on. The
   `redirectUrl` override is the answer for the first.
4. **`/system-config/defaults` is now secret-bearing.** Same guard as `/system-config`, so the
   exposure class is unchanged — but "defaults are static constants" is no longer true, and anyone
   reasoning about caching or logging them later needs to know.
5. **Regenerate the test evidence at a commit that contains the code** (M2), and note that
   `run.sh` now reports 237 server tests.
