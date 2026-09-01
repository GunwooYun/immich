# Review request — Wave 6 review fixes (M1, M2)

Fixes for `google-drive-wave6-impl-20260830-1030-review.md`, whose verdict was "the three changes
are sound and the four claims hold up" with two findings. Per CLAUDE.md §2.4 the fixes are
themselves a review target.

| | |
|---|---|
| Branch | `feat/google-drive-album-sync-v3.1.0` |
| Commits to review | `936efa611` (M1), `7128a36fc` (M2 evidence) |
| Prior review | `../review/google-drive-wave6-impl-20260830-1030-review.md` |
| Plan feedback | `dev-docs/google-drive/wave6-plan.md` §6 |

## What changed

**M1 — clearing an env-supplied credential is a silent no-op.** Confirmed against `updateConfig`:
`isEmpty` is checked before `isEqual`, so a cleared field persists nothing and the effective value
falls back to the (now environment-supplied) default.

Chosen response: **document, don't change the behaviour.** A sentinel for "deliberately empty"
would give `''` a second meaning it doesn't have anywhere else in the config; read-only fields
would break the override D4 exists to preserve — and overriding does work, only clearing doesn't.
So the hint on env-supplied fields now says clearing won't remove the value and names where it has
to be changed. Pinned with a test.

**That test needed reworking to not pass vacuously.** The obvious version — clear a googleDrive
credential — passes for the wrong reason, because under test no environment is set, so the default
is `''` and `isEqual` would skip it just as `isEmpty` does. It asserts on `oauth.buttonText`
instead (non-empty default), so only the `isEmpty` branch can explain the result.

Also: a comment on `config.spec.ts` recording which test is the load-bearing guard (the review
established it is the "empty when unset" one, not the one it looks like), and the redirect-URL help
text now names the sub-path case.

**M2 — the attached evidence predated the code.** Regenerated at `936efa611`, which contains the
implementation. Server count is now **238** (was 208 in the stale attachment; the review measured
237 before the M1 test existed).

## Please attack

1. **Is the M1 decision right?** I chose to document rather than change behaviour. Argue the other
   side: is there a shape where an admin genuinely needs to remove an env-supplied credential from
   the UI and cannot, badly enough to justify a sentinel or a read-only field?
2. **Is the reworked M1 test honest?** I verified it by neutering the `isEmpty` branch — only it
   fails. But it asserts on `oauth.buttonText`, not on this feature's fields. Does that indirection
   weaken it into testing a generic rule that could drift away from the googleDrive case?
3. **The new hint text.** Does it actually tell an admin what they need (that the value is
   environment-supplied, that overriding works, that clearing does not), without being so long it
   goes unread?
4. **Anything the plan's §6 records wrongly** — particularly the stale-form race, which I recorded
   as "not worth guarding" on the review's own reasoning.

## Verified / not verified

- **Verified:** feature suite **238 / 29 / 10** + svelte-check gate clean, at a commit containing
  the code (`results/20260902-0746.txt`, stamped `936efa611`); M1 test non-vacuous by neutering;
  `tsc` and `eslint --max-warnings 0` clean; `i18n/en.json` still sorted.
- **Not verified:** unchanged from the last round — the Tailscale HTTPS path, a real family-member
  connect flow, the four visual states in a browser, and the gate through a live BullMQ queue. All
  need the deployment.
- No schema or DTO change in these two commits ⇒ no SQL/SDK regeneration.
