#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Portal Privacy Pre-Deploy Check
#
# Spins up a temporary instance of prod-server.cjs on an isolated port,
# runs the HTTP-based portal privacy smoke test, then tears the server down.
#
# Exit code mirrors the test exit code — a non-zero exit blocks the caller
# (post-merge, Railway build, CI step, etc.).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

echo ""
echo "[portal-privacy-ci] ═══════════════════════════════════════════════════"
echo "[portal-privacy-ci]  Portal Privacy Pre-Deploy Check"
echo "[portal-privacy-ci] ═══════════════════════════════════════════════════"

# Use a dedicated port so we don't clash with a live dev/prod server.
export PORT="${PORTAL_PRIVACY_PORT:-5099}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo ""
  echo "[portal-privacy-ci] ERROR: DATABASE_URL is not set."
  echo "[portal-privacy-ci]        Set DATABASE_URL before running this check."
  exit 1
fi

# Start the production server in the background on the isolated port.
echo "[portal-privacy-ci] Starting test server on port $PORT…"
node prod-server.cjs &
SERVER_PID=$!

# Always kill the background server on exit, regardless of success/failure.
cleanup() {
  local exit_code=$?
  echo ""
  echo "[portal-privacy-ci] Stopping test server (PID $SERVER_PID)…"
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  exit $exit_code
}
trap cleanup EXIT INT TERM

# Run the smoke test.  The script itself waits up to 30 s for the server
# to become ready, then exercises every assertion.
# Temporarily suspend set -e so we can capture the exit code and print a
# clear failure banner before the trap fires.
echo "[portal-privacy-ci] Running portal privacy smoke test…"
echo ""
set +e
npm run test:portal-privacy
TEST_EXIT=$?
set -e

if [ $TEST_EXIT -ne 0 ]; then
  echo ""
  echo "[portal-privacy-ci] ✗  PORTAL PRIVACY CHECK FAILED"
  echo "[portal-privacy-ci]    One or more privacy assertions failed."
  echo "[portal-privacy-ci]    Deployment is BLOCKED until these are fixed."
  echo "[portal-privacy-ci] ═══════════════════════════════════════════════════"
  exit $TEST_EXIT
fi

echo ""
echo "[portal-privacy-ci] ✓  All portal privacy assertions passed."
echo "[portal-privacy-ci] ═══════════════════════════════════════════════════"
