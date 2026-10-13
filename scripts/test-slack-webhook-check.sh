#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Slack Webhook Delivery Check — Automated Tests
#
# Verifies that the two-layer Slack delivery-failure detection logic works:
#   Check 1 — HTTP status: any non-200 response is treated as a failure.
#   Check 2 — ok field   : a 200 response whose body has ok==false is also
#                          treated as a failure (Slack API convention).
#                          Parsed with jq to match workflow step logic exactly.
#
# Spins up a local Python HTTP mock server for each case, exercises the same
# curl+check logic used by the post-deploy alerting scripts, and asserts the
# expected exit code. No network access or secrets required.
#
# Usage:
#   bash scripts/test-slack-webhook-check.sh
#
# Exit codes
#   0 — all three cases behaved as expected
#   1 — one or more cases produced an unexpected result
#
# ── Runbook: Confirming the live Slack webhook is healthy ─────────────────────
#
# This script tests the detection *logic* using mock servers.  To verify the
# real webhook URL works end-to-end against Slack's API:
#
#   1. Grab the webhook URL from your secrets manager / CI environment:
#        export SLACK_WEBHOOK_URL=https://hooks.slack.com/services/…
#
#   2. Send a test message with curl and inspect both the HTTP status and body:
#        curl -s -o /tmp/slack_resp.json -w "\nHTTP status: %{http_code}\n" \
#          -X POST -H "Content-Type: application/json" \
#          -d '{"text":"[test] Slack webhook health check — ignore this message"}' \
#          "$SLACK_WEBHOOK_URL"
#        cat /tmp/slack_resp.json   # must be "ok", not {"ok":false,...}
#
#   3. Confirm the test message appears in the target Slack channel.
#      If it does not, common causes are:
#        • The webhook was deleted or revoked in Slack (Apps → Incoming Webhooks)
#        • SLACK_WEBHOOK_URL points to the wrong workspace or channel
#        • The Slack app was removed from the channel
#
#   4. If you see HTTP 200 but body is {"ok":false,"error":"..."}, the webhook
#      URL is accepted by Slack but the destination is wrong. Re-create the
#      incoming webhook in Slack and update SLACK_WEBHOOK_URL.
#
# When a delivery failure is detected during a post-deploy run, both scripts
# (post-deploy-privacy-check.sh and post-deploy-body-limit-check.sh) will
# automatically send a fallback email to ONCALL_EMAIL — provided the SMTP_*
# environment variables are configured — so the misconfiguration surfaces even
# when CI logs are not actively watched.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PASS=0
FAIL=0
MOCK_PORT=19874
MOCK_PID=""

ok()   { echo "  ok  : $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

echo ""
echo "[slack-webhook-check] Running Slack delivery-check tests..."
echo ""

# ── Prerequisite: jq must be present ─────────────────────────────────────────
if ! command -v jq &>/dev/null; then
  echo "[slack-webhook-check] ERROR: jq is not installed — required for JSON parsing" >&2
  exit 1
fi

# ── Mock-server helpers ───────────────────────────────────────────────────────

# start_mock <http_status> <body>
# Starts a Python HTTP server that responds to every request with the given
# status and body, running until stop_mock is called.  Sets $MOCK_PID.
start_mock() {
  local http_status="$1"
  local body="$2"

  python3 - "$MOCK_PORT" "$http_status" "$body" <<'PYEOF' &
import sys, http.server

port   = int(sys.argv[1])
status = int(sys.argv[2])
body   = sys.argv[3]

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass        # suppress request noise
    def do_POST(self):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body.encode())
    def do_GET(self):
        self.do_POST()

srv = http.server.HTTPServer(("127.0.0.1", port), Handler)
try:
    srv.serve_forever()
finally:
    srv.server_close()
PYEOF

  MOCK_PID=$!

  # Wait until the port is accepting connections (up to 3 s)
  local deadline
  deadline=$(($(date +%s) + 3))
  while ! python3 -c "
import socket, sys
s = socket.socket()
s.settimeout(0.2)
try:
    s.connect(('127.0.0.1', $MOCK_PORT))
    s.close()
    sys.exit(0)
except Exception:
    sys.exit(1)
" 2>/dev/null; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "[slack-webhook-check] ERROR: mock server did not start in time" >&2
      exit 1
    fi
    sleep 0.05
  done
}

stop_mock() {
  if [ -n "$MOCK_PID" ]; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
    MOCK_PID=""
  fi
}

# Ensure the mock server is always cleaned up on exit
trap 'stop_mock' EXIT

# ── Core check function (mirrors the logic in the post-deploy scripts) ────────
#
# Returns 0 (success) only when:
#   - curl exits without a transport error, AND
#   - the HTTP response status is 200, AND
#   - the response body does NOT parse as ok==false (via jq, matching workflow)
#
# This is the exact two-layer check the alerting steps are supposed to use.
send_slack_checked() {
  local url="$1"
  local payload='{"text":"test"}'

  # Capture both body and HTTP status in one round-trip.
  local response http_status body rc

  set +e
  response=$(curl -s -w $'\n__STATUS__%{http_code}' \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$payload" \
    --max-time 5 \
    "$url" 2>/dev/null)
  rc=$?
  set -e

  if [ "$rc" -ne 0 ]; then
    echo "[slack-check] curl transport error (exit $rc)" >&2
    return 1
  fi

  # Split body from appended status line
  body=$(printf '%s' "$response" | sed '$d')
  http_status=$(printf '%s' "$response" | grep '__STATUS__' | sed 's/__STATUS__//')

  # Check 1: HTTP status must be 200
  if [ "$http_status" != "200" ]; then
    echo "[slack-check] Slack webhook returned HTTP $http_status (expected 200)" >&2
    return 1
  fi

  # Check 2: Slack API ok field must not be false — use jq to match workflow logic
  if printf '%s' "$body" | jq -e '.ok == false' &>/dev/null; then
    echo "[slack-check] Slack webhook responded ok=false: $body" >&2
    return 1
  fi

  return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# Case 1 — Success path: HTTP 200 + {"ok":true}
# Expected: send_slack_checked exits 0
# ─────────────────────────────────────────────────────────────────────────────
echo '  Case 1: HTTP 200 + {"ok":true}  ->  expect success'
start_mock 200 '{"ok":true}'
if send_slack_checked "http://127.0.0.1:${MOCK_PORT}/webhook"; then
  ok 'HTTP 200 + ok=true is treated as success'
else
  fail 'HTTP 200 + ok=true should succeed but returned non-zero'
fi
stop_mock

# ─────────────────────────────────────────────────────────────────────────────
# Case 2 — Bad HTTP status: server returns 500
# Expected: send_slack_checked exits non-zero
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo '  Case 2: HTTP 500  ->  expect failure'
start_mock 500 '{"error":"internal_error"}'
if send_slack_checked "http://127.0.0.1:${MOCK_PORT}/webhook"; then
  fail 'HTTP 500 should be detected as failure but returned 0'
else
  ok 'HTTP 500 is correctly detected as a delivery failure'
fi
stop_mock

# ─────────────────────────────────────────────────────────────────────────────
# Case 3 — Slack ok=false: server returns 200 but {"ok":false}
# Expected: send_slack_checked exits non-zero
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo '  Case 3: HTTP 200 + {"ok":false}  ->  expect failure'
start_mock 200 '{"ok":false,"error":"channel_not_found"}'
if send_slack_checked "http://127.0.0.1:${MOCK_PORT}/webhook"; then
  fail 'HTTP 200 + ok=false should be detected as failure but returned 0'
else
  ok 'HTTP 200 + ok=false is correctly detected as a delivery failure'
fi
stop_mock

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "[slack-webhook-check] Results: ${PASS} passed, ${FAIL} failed"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "[slack-webhook-check] FAILED"
  exit 1
fi

echo "[slack-webhook-check] All Slack delivery-check tests passed"
