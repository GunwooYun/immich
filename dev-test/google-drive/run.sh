#!/usr/bin/env bash
# Runs every test that covers the Google Drive feature, and writes the output to results/.
#
# Why this exists: the specs live beside the code they test (server/src/**, web/src/**), which is
# where vitest and `mise //server:ci-unit` look for them — moving them here would mean CI silently
# stopped running them. But "run everything this feature touches" was still a thing you had to
# remember to assemble by hand, and a review report claiming "2,323 tests pass" is not evidence of
# anything. This script is the one command, and its output is the evidence.
#
# Usage:
#   dev-test/google-drive/run.sh            # unit tests (server + web)
#   dev-test/google-drive/run.sh --medium   # also the database-backed integration test
#
# Exits non-zero if anything fails, so it can gate a commit.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESULTS_DIR="$(dirname "${BASH_SOURCE[0]}")/results"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="${RESULTS_DIR}/${STAMP}.txt"
export PATH="$HOME/.local/share/mise/shims:$PATH"
export NODE_OPTIONS="--max-old-space-size=4096"

SC_BASELINE="$(dirname "${BASH_SOURCE[0]}")/svelte-check-baseline.txt"

# The ONE parser for svelte-check --output machine → "path<TAB>error-count" per file. Both the gate
# and --regen-baseline call this, so the two can't drift (fixes-round-6 J1: they had already drifted
# once, the comment keeping an older `grep`/`awk` than the gate). Field choices matter:
#   - `awk '$2=="ERROR"'` not `grep ' ERROR '`: field match, so a WARNING whose *message* contains
#     " ERROR " can't be read as an error line and invent a phantom file (H2).
#   - `sed -E 's/^ *([0-9]+) (.*)/\2\t\1/'` not `awk '{print $2}'`: keeps the whole path, so a path
#     containing a space is not truncated into a non-matching string (H1).
sc_extract() {
  awk '$2=="ERROR"' | sed 's/^[0-9]* ERROR "//' | cut -d'"' -f1 | sort | uniq -c \
    | sed -E 's/^ *([0-9]+) (.*)/\2\t\1/' | sort
}

# `--regen-baseline`: recompute the baseline the safe way. Runs under this script's `set -o pipefail`
# (unlike the same pipeline pasted into an interactive shell, where a failed svelte-check would still
# `&& mv` a zero-byte file into place — J1), validates the result before installing it, and installs
# atomically via a temp file + mv. Use this instead of hand-editing the baseline or pasting a pipeline.
if [[ "${1:-}" == "--regen-baseline" ]]; then
  RAW="$(cd "${REPO_ROOT}/web" && timeout 600 npx svelte-check --output machine 2>&1)"
  if ! grep -q 'COMPLETED' <<<"$RAW"; then
    echo "svelte-check did not complete — baseline NOT regenerated"
    echo "$RAW" | tail -5
    exit 1
  fi
  NEW="$(sc_extract <<<"$RAW")"
  # Always write a comment header, so the file is never empty even when there are zero errors (K2).
  # An empty baseline is unrepresentable otherwise: the -s gate rejects it, regen used to refuse to
  # write it, and the STALE notice then nags "regenerate" forever with a command that refuses — a
  # dead end. With the header the zero-error state is a valid baseline that makes the gate stricter
  # (any error anywhere is then a regression). The comparison awk treats a `#`-led line as inert:
  # it has no tab, so its count parses as 0 and it produces neither REGRESSION nor STALE.
  SC_TMP="$(mktemp)"
  # Install as one guarded step (K1): the previous `printf … && mv` discarded its status, so a failed
  # mv (read-only checkout, full disk, permissions) still printed "regenerated" and cat'd the OLD
  # file while exiting 0 — the tool whose whole job is installing this file safely reporting success
  # while doing nothing. Now a failed install cleans up the temp file and exits non-zero, loudly.
  if ! { { echo "# svelte-check baseline — regenerate with: ./dev-test/google-drive/run.sh --regen-baseline"; printf '%s\n' "$NEW"; } > "$SC_TMP" && mv "$SC_TMP" "$SC_BASELINE"; }; then
    rm -f "$SC_TMP"
    echo "failed to install the baseline (see above) — nothing was changed"
    exit 1
  fi
  echo "baseline regenerated ($(grep -vc '^#' "$SC_BASELINE") files):"
  cat "$SC_BASELINE"
  exit 0
fi

RUN_MEDIUM=0
[[ "${1:-}" == "--medium" ]] && RUN_MEDIUM=1

mkdir -p "$RESULTS_DIR"

# Server specs that touch the feature. album/queue/server/system-config are included because the
# feature changed their behaviour (queueing axis, feature flag, queue registration, config shape) —
# a regression there is a regression in this feature even though the file is named for something
# else.
SERVER_SPECS=(
  src/utils/google-drive.spec.ts
  src/services/google-drive.service.spec.ts
  src/services/album.service.spec.ts
  src/services/queue.service.spec.ts
  src/services/server.service.spec.ts
  src/services/system-config.service.spec.ts
  # Wave 6 moved two decisions out of this feature's own files: the credentials now default from
  # the environment (config.spec.ts) and the redirect URL is derived from the External Domain
  # setting (misc.spec.ts, alongside the enabled-gate). Both files are named for something generic,
  # but a regression in either is a regression in this feature.
  src/config.spec.ts
  src/utils/misc.spec.ts
)
WEB_SPECS=(
  src/lib/managers/google-drive-progress-manager.svelte.spec.ts
  src/lib/components/album-page/GoogleDriveAlbumMenu.spec.ts
  # Shared component, but the album menu depends on its close/open/focus/onOpen behaviour — the
  # Wave 5 fixes (W1 guard, F1 focus, F2 onOpen-once) live here, so a regression is a feature
  # regression even though the file is named for something shared.
  src/lib/components/shared-components/context-menu/ButtonContextMenu.spec.ts
  # Same reasoning one level down: the album menu is the thing that exposed the positioning bug
  # (it opens as a one-row "Loading" box and then grows), so the clamp it depends on is covered
  # here even though ContextMenu is shared.
  src/lib/components/shared-components/context-menu/context-menu-position.spec.ts
)
MEDIUM_SPECS=(test/medium/specs/repositories/google-drive.repository.spec.ts)

FAILED=0

{
  echo "Google Drive — unit test run"
  echo "date:   $(date --iso-8601=seconds)"
  # The dirty marker matters more than it looks. Evidence stamped with a commit that does not
  # contain the code under test is worse than no evidence, and that is precisely what a run
  # against uncommitted changes produces — it happened, and a reviewer caught the mismatch by
  # counting tests rather than by reading this line.
  echo "commit: $(git -C "$REPO_ROOT" rev-parse --short HEAD) ($(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD))$(
    [ -n "$(git -C "$REPO_ROOT" status --porcelain -- ':!dev-test/google-drive/results')" ] &&
      echo ' + UNCOMMITTED CHANGES'
  )"
  echo
} | tee "$OUT"

run_suite() {
  local label="$1" dir="$2" config="$3"
  shift 3
  {
    echo "── ${label} ──────────────────────────────────────────────"
  } | tee -a "$OUT"

  local cmd=(npx vitest run)
  [[ -n "$config" ]] && cmd+=(--config "$config")
  cmd+=("$@")

  if (cd "${REPO_ROOT}/${dir}" && "${cmd[@]}" 2>&1) | tee -a "$OUT" | tail -n 4; then
    :
  else
    FAILED=1
  fi
  echo | tee -a "$OUT"
}

run_suite "server (unit)" server test/vitest.config.mjs "${SERVER_SPECS[@]}"
run_suite "web (unit)" web "" "${WEB_SPECS[@]}"

# Web type-checking. tsc/eslint do not type-check Svelte call sites — svelte-check does, and the
# Wave 5 fixes-round-2 review caught spec type errors that both of those missed.
#
# svelte-check runs project-wide and the repo carries pre-existing errors in unrelated files, so we
# gate against a checked-in baseline (svelte-check-baseline.txt: "path<TAB>error-count" per file)
# rather than a filename allowlist. The first version of this gate scoped by a grep of feature
# filenames and it had two holes the fixes-round-3 review reproduced: it missed the album +page
# (edited every round, matched by no pattern), and it failed *open* — if svelte-check couldn't run,
# the grep found nothing and the gate declared the feature clean. This version instead:
#   - fails closed: no COMPLETED line (svelte-check crashed/OOM'd/mis-invoked) => FAIL, not pass;
#   - compares the *set and per-file count* of files-with-errors to the baseline, so a NEW file with
#     errors or MORE errors in an existing file trips it, whatever the filename;
#   - matches on the extracted path only, not the whole machine line, so an error *message* that
#     happens to contain a path-like substring can't move the result.
# When you legitimately change the pre-existing set (e.g. fix one of the unrelated errors),
# regenerate the baseline with `./dev-test/google-drive/run.sh --regen-baseline` (defined near the
# top). That runs the extraction under this script's pipefail, validates it, and installs it
# atomically — never leaving a truncated baseline behind (fixes-round-6 J1). Do not hand-edit it.
{
  echo "── web (svelte-check, baseline-gated) ──────────────────────────────────────────────"
} | tee -a "$OUT"
# Validate the baseline BEFORE paying for a svelte-check run: a missing/empty baseline is already a
# FAIL, so there is nothing to learn from running the slowest step of the suite first (fixes-round-6
# nit). This guard is load-bearing, not a redundant existence check: with an empty first file the
# comparison awk's NR==FNR idiom stays true while reading the *current* rows, loading them all into
# base[] and leaving cur[] empty — so every real regression is silently classified away and the gate
# passes (I1). A missing file makes awk abort to stderr, which then scrolls past a RESULT: PASS. The
# regen path can still truncate the file to zero bytes, so this stays the last line of defence.
if [[ ! -s "$SC_BASELINE" ]]; then
  echo "svelte-check baseline missing or empty ($SC_BASELINE) — treating as failure" | tee -a "$OUT"
  echo "  regenerate with: ./dev-test/google-drive/run.sh --regen-baseline" | tee -a "$OUT"
  FAILED=1
else
  # timeout, not a bare call: the COMPLETED check below converts a *crash* into a FAIL, but a *hang*
  # (svelte-check wedged, not exited) would stall the whole suite instead — timeout turns that into a
  # non-zero exit with no COMPLETED line, i.e. a FAIL. (H review note.)
  SC_OUT="$(cd "${REPO_ROOT}/web" && timeout 600 npx svelte-check --output machine 2>&1)"
  if ! grep -q 'COMPLETED' <<<"$SC_OUT"; then
    # svelte-check never finished — treat as failure rather than "clean", the fail-open bug's fix.
    echo "svelte-check did not complete — treating as failure" | tee -a "$OUT"
    echo "$SC_OUT" | tail -5 | tee -a "$OUT"
    FAILED=1
  else
    SC_CUR="$(sc_extract <<<"$SC_OUT")"
    # Compare against the baseline in BOTH directions:
    #   REGRESSION — a path with more errors than baseline (absent baseline => 0). Fails the gate.
    #   STALE      — a path with FEWER errors than baseline (e.g. an upstream merge fixed a
    #                pre-existing one). Does NOT fail — under-count is fine — but is printed loudly,
    #                because a stale baseline silently widens what that file tolerates (H3).
    # The baseline's leading `#` comment header (written by --regen-baseline, K2) is skipped so it is
    # never treated as a path key.
    SC_CMP="$(awk -F'\t' '
      NR==FNR { if ($0 ~ /^#/) next; base[$1]=$2; next }
      $1!="" { cur[$1]=$2 }
      END {
        for (f in cur) {
          if (cur[f]+0 > base[f]+0)      print "REGRESSION\t" f "\t" cur[f] "\t" base[f]+0
          else if (cur[f]+0 < base[f]+0) print "STALE\t" f "\t" cur[f] "\t" base[f]+0
        }
        for (f in base) if (!(f in cur) && base[f]+0 > 0) print "STALE\t" f "\t0\t" base[f]+0
      }' "$SC_BASELINE" <(echo "$SC_CUR"))"
    SC_REG="$(grep '^REGRESSION' <<<"$SC_CMP" || true)"
    SC_STALE="$(grep '^STALE' <<<"$SC_CMP" || true)"
    if [[ -n "$SC_STALE" ]]; then
      echo "svelte-check baseline is stale (fewer errors than recorded) — regenerate it:" | tee -a "$OUT"
      echo "$SC_STALE" | sed 's/^STALE\t/  /' | tee -a "$OUT"
    fi
    if [[ -n "$SC_REG" ]]; then
      echo "svelte-check regressions vs baseline:" | tee -a "$OUT"
      echo "$SC_REG" | sed 's/^REGRESSION\t/  /' | tee -a "$OUT"
      FAILED=1
    else
      echo "no svelte-check regressions vs baseline ($(grep -vc '^#' "$SC_BASELINE") pre-existing files)" | tee -a "$OUT"
    fi
  fi
fi
echo | tee -a "$OUT"

if [[ $RUN_MEDIUM -eq 1 ]]; then
  # Needs a reachable Postgres. Kept opt-in so the everyday loop stays fast and offline-safe.
  #
  # The medium harness reads IMMICH_TEST_POSTGRES_URL and clones a `mich` template database per
  # test. If it isn't already set, point it at the dev Postgres from docker/.env — otherwise every
  # run makes you export it by hand, which is how a "just run the tests" script stops being one.
  if [[ -z "${IMMICH_TEST_POSTGRES_URL:-}" ]]; then
    DBPW="$(grep -oP '(?<=^DB_PASSWORD=).*' "${REPO_ROOT}/docker/.env" 2>/dev/null || echo postgres)"
    export IMMICH_TEST_POSTGRES_URL="postgres://postgres:${DBPW}@localhost:5432/mich"
  fi
  run_suite "server (medium, needs a database)" server test/vitest.config.medium.mjs "${MEDIUM_SPECS[@]}"
fi

{
  echo "════════════════════════════════════════════════════════════"
  if [[ $FAILED -eq 0 ]]; then
    echo "RESULT: PASS"
  else
    echo "RESULT: FAIL"
  fi
} | tee -a "$OUT"

echo
echo "saved to ${OUT}"
exit $FAILED
