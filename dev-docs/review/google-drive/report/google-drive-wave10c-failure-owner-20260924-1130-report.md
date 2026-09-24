# Review request — wave10c: owner on failure rows

**Commits:** `1e37a52c2` (feature) + evidence commit · **Diff:** `git diff 3cabbb496 HEAD -- server/src web/src i18n` (skip generated)

**Why:** the first production failure after the last deploy was a shared-album asset owned by another user. The list showed only the file name, and the reader searched their own library in vain. `getFailures` now joins `asset.ownerId` → `user.name`; the service blanks it when the owner is the reader; the row renders "IMG_0926.HEIC · Seohui's photo".

**Tests:** service (other's photo / own photo), medium (the join really reports the other user — unit tests mock the row, so only a real DB proves it), two web cases. Mutations: dropping the owner-is-reader blanking → unit case fails; breaking the join alias → medium case fails.

**Evidence:** `results/` newest at `1e37a52c2`, clean: server 316, web 87, medium 63, PASS. `mise //server:ci-unit` 2442 passed / 2 skipped; `mise //web:ci-unit` 603 passed / 2 skipped, svelte-check 0.

**Attack:**
1. **Privacy.** The reader now sees another user's display name on a failure row. They already see that person's photo in the shared album — but is there any path where an error row outlives the share (access revoked, album deleted, user removed from album) and leaks a name the reader should no longer see? `getFailures` filters on the *error row's* userId, not on current album membership.
2. Is `innerJoin('user as owner')` safe against a deleted user (soft-deleted accounts in immich)? Should it be a left join so a failure does not vanish when the owner's account is removed?
3. Generated SQL: I refreshed the `getFailures` block via DummyDriver again — does it match what the real generator would emit?
4. Wording: "{name}'s photo" — does it read right when the name is an email local-part or empty?

**Not verified:** browser; the live instance (its one failure was deleted, so the list is empty there now).
