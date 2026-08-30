# Review request — Wave 6 implementation (env credentials, derived redirect URL, picker gating)

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commits to review | `1f00f78e2` (server), `b38d36a84` (web) |
| HEAD at request | `659b4540d` |
| Plan | `dev-docs/google-drive/wave6-plan.md` |

Wave 5 is deployed; this wave removes the setup cost that made it hard to actually use. Three
changes, plus an infra decision that is documented but not yet applied.

## What changed

**1. Credentials default from the environment** (`config.ts`) — `IMMICH_GOOGLE_DRIVE_CLIENT_ID` /
`_CLIENT_SECRET` / `_API_KEY`, following the `machineLearning` precedent (defaults object, not
`EnvSchema`). Rewrote `getOAuth2Client`'s "deliberately no env fallback" comment, which this
reverses.

**2. Redirect URL derived from `server.externalDomain`** — new `getGoogleDriveRedirectUrl` in
`utils/misc.ts`; `isGoogleDriveEnabled` now takes `(googleDrive, server)`; three callers updated
(`server.service.ts`, `album.service.ts`, `google-drive.service.ts`). The `redirectUrl` field
survives as an override. No `my.immich.app` fallback, on purpose.

**3. `pickerAvailable` on the status DTO** = `!!apiKey`; web hides the picker button when false
(it previously rendered always and failed on click).

Web also marks credential fields whose value comes from the environment, using
`systemConfigManager.defaultValue` (no new API).

## Please attack

1. **The no-freeze claim.** I assert that env-as-defaults can't get frozen into the DB because
   `updateConfig` skips values equal to `defaults`. Verify against `utils/config.ts` — is there a
   path (partial merge, nested key, admin form submitting a full config) where an env-supplied
   credential ends up persisted, so that a later environment change is silently ignored?
2. **`isGoogleDriveEnabled` signature fan-out.** I updated three callers found by grep. Is there a
   fourth path — a controller, a guard, mobile, anything — that decides "is this feature on" by a
   different means and is now inconsistent with the derived-redirect definition?
3. **Vacuous passes in the gate tests** (CLAUDE.md §4). The disabled cases assert the redirect URL is
   *not* what failed, and the enabled case asserts the credentials are present. Find a test that
   still passes for the wrong reason — especially the `config.spec.ts` env test, which depends on
   `vi.resetModules()` + dynamic import actually re-evaluating the module.
4. **The derivation itself.** `externalDomain` is normalized to an origin at bootstrap and I strip
   trailing slashes defensively. Is there a shape (path in externalDomain, port, trailing slash,
   uppercase host) that yields a URL Google would not byte-match against the registered one?
5. **Security of the exposure.** The env `clientSecret` is now visible to admins via
   `/system-config` and `/system-config/defaults`. I judged this the same class as upstream's
   `oauth.clientSecret`. Is it?

## Verified / not verified

- **Verified:** feature suite 208/29/10 + svelte-check gate clean; server full 2347 (2 skip); web
  full 547 (2 skip); `tsc` and `eslint --max-warnings 0` clean (server all, web changed files);
  `mise run //:open-api` regenerated (SDK carries `pickerAvailable`); migration drift
  "No changes detected"; `i18n/en.json` still sorted case-insensitively.
- **Not verified (needs the deployment):** the Tailscale HTTPS path end to end — certificate
  issuance, `tailscale serve` proxying, and whether `X-Forwarded-Proto` really yields a Secure
  state cookie through the existing `trust proxy` config (verified in code, not in practice); an
  actual family-member connect flow.
- **Carried over from Wave 5, still unverified:** the four visual states in a browser; the gate
  end-to-end through a live BullMQ queue.
- Generated artefacts (`open-api/`, `packages/sdk/`, `mobile/openapi/`) need no reading.

## Test evidence

`dev-test/google-drive/results/20260830-0835.txt`:

```
── server (unit) ──               Tests  208 passed (208)    ← was 199
── web (unit) ──                  Tests   29 passed (29)
── web (svelte-check, baseline) ── no regressions vs baseline (3 pre-existing files)
── server (medium) ──             Tests   10 passed (10)
RESULT: PASS
```

(The run predates adding `config.spec.ts`/`misc.spec.ts` to `run.sh`; both were run directly and
are in the 2347 full-suite figure.)
