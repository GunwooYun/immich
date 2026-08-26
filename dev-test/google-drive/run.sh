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
)
WEB_SPECS=(
  src/lib/managers/google-drive-progress-manager.svelte.spec.ts
  src/lib/components/album-page/GoogleDriveAlbumMenu.spec.ts
  # Shared component, but the album menu depends on its close/open/focus/onOpen behaviour — the
  # Wave 5 fixes (W1 guard, F1 focus, F2 onOpen-once) live here, so a regression is a feature
  # regression even though the file is named for something shared.
  src/lib/components/shared-components/context-menu/ButtonContextMenu.spec.ts
)
MEDIUM_SPECS=(test/medium/specs/repositories/google-drive.repository.spec.ts)

FAILED=0

{
  echo "Google Drive — unit test run"
  echo "date:   $(date --iso-8601=seconds)"
  echo "commit: $(git -C "$REPO_ROOT" rev-parse --short HEAD) ($(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD))"
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
# regenerate the baseline:
#   (cd web && npx svelte-check --output machine 2>&1 | grep ' ERROR ' \
#     | sed 's/^[0-9]* ERROR "//' | cut -d'"' -f1 | sort | uniq -c \
#     | awk '{print $2"\t"$1}' | sort) > dev-test/google-drive/svelte-check-baseline.txt
{
  echo "── web (svelte-check, baseline-gated) ──────────────────────────────────────────────"
} | tee -a "$OUT"
SC_BASELINE="$(dirname "${BASH_SOURCE[0]}")/svelte-check-baseline.txt"
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
  # Extract "path<TAB>count" for files with errors. Two parsing choices matter (fixes-round-4 H1/H2):
  #   - `awk '$2=="ERROR"'` not `grep ' ERROR '`: field match, so a WARNING whose *message* contains
  #     " ERROR " can't be mistaken for an error line and invent a phantom file (false FAIL).
  #   - `sed -E 's/^ *([0-9]+) (.*)/\2\t\1/'` not `awk '{print $2"\t"$1}'`: keeps the whole path, so a
  #     path containing a space is not truncated into a non-matching string (false FAIL).
  SC_CUR="$(awk '$2=="ERROR"' <<<"$SC_OUT" | sed 's/^[0-9]* ERROR "//' | cut -d'"' -f1 \
    | sort | uniq -c | sed -E 's/^ *([0-9]+) (.*)/\2\t\1/' | sort)"
  # Compare against the baseline in BOTH directions:
  #   REGRESSION — a path with more errors than baseline (absent baseline => 0). Fails the gate.
  #   STALE      — a path with FEWER errors than baseline (e.g. an upstream merge fixed a pre-existing
  #                one). Does NOT fail — under-count is fine — but is printed loudly, because a stale
  #                baseline silently widens what that file tolerates (H3). Regenerate when you see it.
  SC_CMP="$(awk -F'\t' '
    NR==FNR { base[$1]=$2; next }
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
    echo "no svelte-check regressions vs baseline ($(wc -l < "$SC_BASELINE") pre-existing files)" | tee -a "$OUT"
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
