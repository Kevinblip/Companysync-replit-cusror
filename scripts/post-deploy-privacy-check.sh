#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Post-Deploy Portal Privacy Check
#
# Runs the full portal privacy smoke test against the live production server.
# Unlike run-portal-privacy-check.sh (which spins up a local server), this
# script targets the already-deployed production URL directly via BASE_URL.
#
# Usage:
#   BASE_URL=https://your-app.up.railway.app \
#   DATABASE_URL=postgres://... \
#   bash scripts/post-deploy-privacy-check.sh
#
# Optional — send a Slack alert on failure:
#   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... \
#   bash scripts/post-deploy-privacy-check.sh
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
# Optional — also send a short "all clear" email on SUCCESS (opt-in; off by
# default so it doesn't spam teams that don't want positive confirmation).
# Set the same SMTP_* / ONCALL_EMAIL variables above, plus:
#   PRIVACY_CHECK_NOTIFY_ON_SUCCESS=1       # any of: 1, true, yes (case-insensitive)
# Without this flag, only failure emails are sent (preserving prior behavior).
#
# Exit code mirrors the test exit code. Non-zero means a privacy assertion
# failed; the caller (CI, a deploy hook, etc.) should treat this as blocking.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Two-layer Slack delivery check ────────────────────────────────────────────
# Checks HTTP status (must be 200) AND the Slack API ok field (must not be
# false). Prints a warning on failure but always returns 0 so a broken webhook
# does not abort the privacy check result itself.
send_slack_checked() {
  local url="$1"
  local payload="$2"
  local prefix="${3:-[post-deploy-privacy]}"

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
Script  : post-deploy-privacy-check
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
echo "[post-deploy-privacy] ═══════════════════════════════════════════════════"
echo "[post-deploy-privacy]  Post-Deploy Portal Privacy Smoke Test"
echo "[post-deploy-privacy] ═══════════════════════════════════════════════════"

# ── Validate required environment variables ────────────────────────────────

if [ -z "${BASE_URL:-}" ]; then
  echo "[post-deploy-privacy] ERROR: BASE_URL is not set."
  echo "[post-deploy-privacy]        Set BASE_URL to the production URL before running."
  echo "[post-deploy-privacy]        e.g. BASE_URL=https://your-app.up.railway.app"
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[post-deploy-privacy] ERROR: DATABASE_URL is not set."
  echo "[post-deploy-privacy]        The smoke test needs a Postgres connection to"
  echo "[post-deploy-privacy]        create and clean up isolated test fixtures."
  exit 1
fi

echo "[post-deploy-privacy] Target URL : ${BASE_URL}"
echo "[post-deploy-privacy] DB host    : $(echo "$DATABASE_URL" | sed 's|.*@||;s|/.*||')"
echo ""

# ── Static SQL guard (no server required) ─────────────────────────────────

echo "[post-deploy-privacy] Running static SQL guard…"
node scripts/check-portal-privacy-sql.cjs
echo "[post-deploy-privacy] Static guard passed."
echo ""

# ── HTTP smoke test against production ────────────────────────────────────

echo "[post-deploy-privacy] Running HTTP smoke test against ${BASE_URL}…"
echo ""
set +e
node scripts/test-portal-privacy.cjs
TEST_EXIT=$?
set -e

# ── Report results ─────────────────────────────────────────────────────────

# ── Helper: send an email via curl SMTP ───────────────────────────────────
# Usage: send_email "Subject line" "Body text (multi-line ok)"
# Returns 0 on success, non-zero on failure. Caller is expected to check that
# ONCALL_EMAIL / SMTP_* are set before invoking.
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

# Truthy check for the success-notification opt-in flag.
notify_on_success_enabled() {
  case "$(echo "${PRIVACY_CHECK_NOTIFY_ON_SUCCESS:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes) return 0 ;;
    *)          return 1 ;;
  esac
}

if [ $TEST_EXIT -ne 0 ]; then
  echo ""
  echo "[post-deploy-privacy] ✗  PORTAL PRIVACY CHECK FAILED"
  echo "[post-deploy-privacy]    One or more privacy assertions failed on production."
  echo "[post-deploy-privacy]    A data-leak regression may have shipped."
  echo "[post-deploy-privacy] ═══════════════════════════════════════════════════"

  # Optional Slack alert ────────────────────────────────────────────────────
  if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
    PAYLOAD="{\"text\":\":rotating_light: *Portal Privacy Check FAILED* after deploy.\nURL: ${BASE_URL}\nOne or more privacy assertions failed — investigate immediately.\"}"
    send_slack_checked "$SLACK_WEBHOOK_URL" "$PAYLOAD" "[post-deploy-privacy]"
  fi

  # Optional email alert ────────────────────────────────────────────────────
  if [ -n "${ONCALL_EMAIL:-}" ] && [ -n "${SMTP_URL:-}" ] \
     && [ -n "${SMTP_USERNAME:-}" ] && [ -n "${SMTP_PASSWORD:-}" ]; then
    FAIL_BODY="The post-deploy portal privacy smoke test FAILED.

URL: ${BASE_URL}
One or more privacy assertions failed — a data-leak regression
may have shipped. Investigate immediately."
    if send_email "🚨 Portal Privacy Check FAILED on production" "$FAIL_BODY"; then
      echo "[post-deploy-privacy] Email alert sent to ${ONCALL_EMAIL}."
    else
      echo "[post-deploy-privacy] WARNING: Failed to send email alert." >&2
    fi
  fi

  exit $TEST_EXIT
fi

echo ""
echo "[post-deploy-privacy] ✓  All portal privacy assertions passed."
echo "[post-deploy-privacy] ═══════════════════════════════════════════════════"

# Optional "all clear" success email — opt-in via PRIVACY_CHECK_NOTIFY_ON_SUCCESS
# so teams that don't want positive-confirmation pings aren't spammed.
if notify_on_success_enabled; then
  if [ -n "${ONCALL_EMAIL:-}" ] && [ -n "${SMTP_URL:-}" ] \
     && [ -n "${SMTP_USERNAME:-}" ] && [ -n "${SMTP_PASSWORD:-}" ]; then
    SUCCESS_BODY="The post-deploy portal privacy smoke test PASSED.

URL: ${BASE_URL}
All privacy assertions succeeded against the live production server.

This message confirms the check actually ran — if you stop seeing it after a
deploy, the workflow may have silently stopped firing."
    if send_email "✅ Portal Privacy Check passed on production" "$SUCCESS_BODY"; then
      echo "[post-deploy-privacy] Success email sent to ${ONCALL_EMAIL}."
    else
      echo "[post-deploy-privacy] WARNING: Failed to send success email." >&2
    fi
  else
    echo "[post-deploy-privacy] PRIVACY_CHECK_NOTIFY_ON_SUCCESS is set, but ONCALL_EMAIL / SMTP_* are not fully configured — skipping success email."
  fi
fi
