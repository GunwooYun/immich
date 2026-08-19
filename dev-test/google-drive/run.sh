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
WEB_SPECS=(src/lib/managers/google-drive-progress-manager.svelte.spec.ts)
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

if [[ $RUN_MEDIUM -eq 1 ]]; then
  # Needs a reachable Postgres. Kept opt-in so the everyday loop stays fast and offline-safe.
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
