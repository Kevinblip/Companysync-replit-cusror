#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Post-Deploy Body-Size Limit (HTTP 413) Check
#
# Runs the body-limit regression test (scripts/test-body-limit.cjs) against the
# already-deployed production server. Confirms that oversized request bodies
# are rejected with HTTP 413 (not 500 / 200) on the live deployment.
#
# Usage:
#   BASE_URL=https://your-app.up.railway.app \
#   bash scripts/post-deploy-body-limit-check.sh
#
# Optional — send a Slack alert on failure:
#   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... \
#   bash scripts/post-deploy-body-limit-check.sh
#
# Optional — also send an email alert on failure (additive to Slack).
# Requires curl with SMTP support. Set all of:
#   ONCALL_EMAIL=oncall@example.com         # comma-separated allowed
#   SMTP_URL=smtps://smtp.example.com:465   # or smtp://host:587 for STARTTLS
#   SMTP_USERNAME=user@example.com
#   SMTP_PASSWORD='app-password'
#   SMTP_FROM=alerts@example.com            # optional; defaults to SMTP_USERNAME
#
# Slack webhook misconfiguration alerts:
#   If SLACK_WEBHOOK_URL is set but delivery fails (bad URL, revoked webhook,
#   wrong channel, etc.), a fallback email is sent automatically — provided the
#   ONCALL_EMAIL + SMTP_* variables above are also configured. This ensures the
#   misconfiguration surfaces visibly rather than silently vanishing into logs.
#   Run scripts/test-slack-webhook-check.sh to confirm the webhook is healthy.
#
# Exit code mirrors the test exit code. Non-zero means a body-limit assertion
# failed; the caller (CI, a deploy hook, etc.) should treat this as blocking.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Email helper ──────────────────────────────────────────────────────────────
# Usage: send_email "Subject" "Body"
# Requires ONCALL_EMAIL, SMTP_URL, SMTP_USERNAME, SMTP_PASSWORD to be set.
# Returns 0 on success, non-zero on failure.
send_email() {
  local subject="$1"
  local body="$2"
  local email_from="${SMTP_FROM:-$SMTP_USERNAME}"
  local email_tmp
  email_tmp=$(mktemp)
  local rcpt_args=()
  local to_header=""
  IFS=',' read -ra rcpts <<< "$ONCALL_EMAIL"
  for r in "${rcpts[@]}"; do
    local r_trimmed
    r_trimmed="$(echo "$r" | xargs)"
    [ -z "$r_trimmed" ] && continue
    rcpt_args+=(--mail-rcpt "<$r_trimmed>")
    if [ -z "$to_header" ]; then to_header="$r_trimmed"; else to_header="$to_header, $r_trimmed"; fi
  done
  {
    echo "From: $email_from"
    echo "To: $to_header"
    echo "Subject: $subject"
    echo "Content-Type: text/plain; charset=UTF-8"
    echo ""
    echo "$body"
  } > "$email_tmp"
  local rc=0
  if ! curl -sS --url "$SMTP_URL" \
       --ssl-reqd \
       --mail-from "<$email_from>" \
       "${rcpt_args[@]}" \
       --user "${SMTP_USERNAME}:${SMTP_PASSWORD}" \
       --upload-file "$email_tmp"; then
    rc=1
  fi
  rm -f "$email_tmp"
  return $rc
}

# ── Two-layer Slack delivery check ────────────────────────────────────────────
# Checks HTTP status (must be 200) AND the Slack API ok field (must not be
# false). Prints a warning on failure but always returns 0 so a broken webhook
# does not abort the body-limit check result itself.
# Secondary notification: if delivery fails and ONCALL_EMAIL + SMTP are
# configured, sends a fallback email so the misconfiguration surfaces visibly.
send_slack_checked() {
  local url="$1"
  local payload="$2"
  local prefix="${3:-[post-deploy-body-limit]}"

  local response http_status body rc
  local slack_failed=0
  local slack_fail_reason=""

  set +e
  response=$(curl -s -w $'\n__STATUS__%{http_code}' \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$payload" \
    --max-time 10 \
    "$url" 2>/dev/null)
  rc=$?
  set -e

  if [ "$rc" -ne 0 ]; then
    echo "$prefix WARNING: Slack alert curl transport error (exit $rc) — alert NOT delivered" >&2
    slack_failed=1
    slack_fail_reason="curl transport error (exit $rc)"
  else
    body=$(printf '%s' "$response" | sed '$d')
    http_status=$(printf '%s' "$response" | grep '__STATUS__' | sed 's/__STATUS__//')

    if [ "$http_status" != "200" ]; then
      echo "$prefix WARNING: Slack webhook returned HTTP $http_status (expected 200) — alert NOT delivered" >&2
      slack_failed=1
      slack_fail_reason="webhook returned HTTP $http_status (expected 200)"
    elif command -v jq &>/dev/null; then
      if printf '%s' "$body" | jq -e '.ok == false' &>/dev/null; then
        echo "$prefix WARNING: Slack webhook responded ok=false: $body — alert NOT delivered" >&2
        slack_failed=1
        slack_fail_reason="webhook responded ok=false: $body"
      fi
    else
      echo "$prefix WARNING: jq not found — skipping ok-field check; raw body: $body" >&2
    fi
  fi

  if [ "$slack_failed" -eq 1 ]; then
    # Secondary notification: email if ONCALL_EMAIL and SMTP are configured.
    # This surfaces webhook misconfiguration even when no one is watching CI logs.
    if [ -n "${ONCALL_EMAIL:-}" ] && [ -n "${SMTP_URL:-}" ] \
       && [ -n "${SMTP_USERNAME:-}" ] && [ -n "${SMTP_PASSWORD:-}" ]; then
      echo "$prefix Attempting email fallback for Slack misconfiguration alert…" >&2
      local misconfig_body
      misconfig_body="The Slack webhook is misconfigured or unreachable.

Reason  : $slack_fail_reason
Script  : post-deploy-body-limit-check
Webhook : ${url:0:80}

The Slack alert was NOT delivered. No one will be paged via Slack until the
webhook is fixed.

Verify SLACK_WEBHOOK_URL is valid and the webhook is still active in Slack.
Run scripts/test-slack-webhook-check.sh to reproduce and confirm the failure."
      if send_email "$prefix Slack webhook misconfigured — alert NOT delivered" "$misconfig_body"; then
        echo "$prefix Fallback email sent to ${ONCALL_EMAIL}." >&2
      else
        echo "$prefix WARNING: Fallback email also failed — no secondary notification delivered." >&2
      fi
    fi
    return 0
  fi

  echo "$prefix Slack alert sent."
}

echo ""
echo "[post-deploy-body-limit] ════════════════════════════════════════════════"
echo "[post-deploy-body-limit]  Post-Deploy Body-Size Limit (HTTP 413) Check"
echo "[post-deploy-body-limit] ════════════════════════════════════════════════"

# ── Validate required environment variables ────────────────────────────────

if [ -z "${BASE_URL:-}" ]; then
  echo "[post-deploy-body-limit] ERROR: BASE_URL is not set."
  echo "[post-deploy-body-limit]        Set BASE_URL to the production URL before running."
  echo "[post-deploy-body-limit]        e.g. BASE_URL=https://your-app.up.railway.app"
  exit 1
fi

echo "[post-deploy-body-limit] Target URL : ${BASE_URL}"
echo ""

# ── Run the 413 regression suite against production ───────────────────────

echo "[post-deploy-body-limit] Running body-limit regression test against ${BASE_URL}…"
echo ""
set +e
BASE_URL="${BASE_URL}" node scripts/test-body-limit.cjs
TEST_EXIT=$?
set -e

# ── Report results ─────────────────────────────────────────────────────────

if [ $TEST_EXIT -ne 0 ]; then
  echo ""
  echo "[post-deploy-body-limit] ✗  BODY-LIMIT CHECK FAILED"
  echo "[post-deploy-body-limit]    Oversized request bodies are NOT being rejected with HTTP 413."
  echo "[post-deploy-body-limit]    A body-size regression may have shipped — investigate immediately."
  echo "[post-deploy-body-limit] ════════════════════════════════════════════════"

  # Optional Slack alert ────────────────────────────────────────────────────
  if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
    PAYLOAD="{\"text\":\":rotating_light: *Body-Limit Check FAILED* after deploy.\nURL: ${BASE_URL}\nOversized request bodies are no longer returning HTTP 413 — investigate immediately.\"}"
    send_slack_checked "$SLACK_WEBHOOK_URL" "$PAYLOAD" "[post-deploy-body-limit]"
  fi

  # Optional email alert ────────────────────────────────────────────────────
  if [ -n "${ONCALL_EMAIL:-}" ] && [ -n "${SMTP_URL:-}" ] \
     && [ -n "${SMTP_USERNAME:-}" ] && [ -n "${SMTP_PASSWORD:-}" ]; then
    EMAIL_FROM="${SMTP_FROM:-$SMTP_USERNAME}"
    EMAIL_TMP=$(mktemp)
    RCPT_ARGS=()
    IFS=',' read -ra RCPTS <<< "$ONCALL_EMAIL"
    TO_HEADER=""
    for r in "${RCPTS[@]}"; do
      r_trimmed="$(echo "$r" | xargs)"
      [ -z "$r_trimmed" ] && continue
      RCPT_ARGS+=(--mail-rcpt "<$r_trimmed>")
      if [ -z "$TO_HEADER" ]; then TO_HEADER="$r_trimmed"; else TO_HEADER="$TO_HEADER, $r_trimmed"; fi
    done
    {
      echo "From: $EMAIL_FROM"
      echo "To: $TO_HEADER"
      echo "Subject: 🚨 Body-Limit Check FAILED on production"
      echo "Content-Type: text/plain; charset=UTF-8"
      echo ""
      echo "The post-deploy body-size limit (HTTP 413) check FAILED."
      echo ""
      echo "URL: ${BASE_URL}"
      echo "Oversized request bodies are no longer returning HTTP 413 on one or"
      echo "more routes. A body-size regression may have shipped — investigate"
      echo "immediately."
    } > "$EMAIL_TMP"
    if curl -sS --url "$SMTP_URL" \
         --ssl-reqd \
         --mail-from "<$EMAIL_FROM>" \
         "${RCPT_ARGS[@]}" \
         --user "${SMTP_USERNAME}:${SMTP_PASSWORD}" \
         --upload-file "$EMAIL_TMP"; then
      echo "[post-deploy-body-limit] Email alert sent to ${ONCALL_EMAIL}."
    else
      echo "[post-deploy-body-limit] WARNING: Failed to send email alert." >&2
    fi
    rm -f "$EMAIL_TMP"
  fi

  exit $TEST_EXIT
fi

echo ""
echo "[post-deploy-body-limit] ✓  All body-limit guards confirmed on production."
echo "[post-deploy-body-limit] ════════════════════════════════════════════════"
