#!/usr/bin/env bash
# The only way to start the local preview.
#
# A tmux session copies the tmux SERVER environment. Passing a clean env to the
# tmux client does not change that. This script has to unset the live variables
# itself, after the session has started, and then refuse to boot if they are
# still set.
set -euo pipefail
cd /workspace

unset DATABASE_URL \
  STRIPE_API_KEY \
  STRIPE_SECRET_KEY \
  STRIPE_WEBHOOK_SECRET \
  TWILIO_ACCOUNT_SID \
  TWILIO_AUTH_TOKEN \
  TWILIO_PHONE_NUMBER \
  TWILIO_REQUIRE_SIGNATURE \
  RESEND_API_KEY \
  POSTMARK_SERVER_TOKEN \
  SMTP_HOST \
  SMTP_PASS \
  SMTP_PORT \
  SMTP_USER \
  SMTP_FROM \
  REPL_IDENTITY \
  WEB_REPL_RENEWAL \
  REPLIT_CONNECTORS_HOSTNAME

export DATABASE_URL='postgresql://companysync:preview@127.0.0.1:5432/companysync_preview'
export EMAIL_PROVIDER=off
export EMAIL_POSTMARK_DISABLED=1

case "$DATABASE_URL" in
  postgresql://companysync:preview@127.0.0.1:5432/companysync_preview) ;;
  *)
    echo 'Refusing to start: DATABASE_URL is not the local preview database.' >&2
    exit 1
    ;;
esac

live_vars=(
  STRIPE_API_KEY
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  TWILIO_ACCOUNT_SID
  TWILIO_AUTH_TOKEN
  TWILIO_PHONE_NUMBER
  RESEND_API_KEY
  POSTMARK_SERVER_TOKEN
  SMTP_HOST
  SMTP_PASS
  REPL_IDENTITY
  WEB_REPL_RENEWAL
  REPLIT_CONNECTORS_HOSTNAME
)
for name in "${live_vars[@]}"; do
  if [[ -n "${!name:-}" ]]; then
    echo "Refusing to start: ${name} is still set." >&2
    exit 1
  fi
done

# Preview-only secrets. Generated in this process and never printed or stored.
# Production still requires the host to set these; this script is not that host.
if [[ -z "${SESSION_SECRET:-}" ]]; then
  SESSION_SECRET="$(openssl rand -hex 32)"
  export SESSION_SECRET
fi
if [[ -z "${ENCRYPTION_KEY:-}" ]]; then
  ENCRYPTION_KEY="$(openssl rand -hex 32)"
  export ENCRYPTION_KEY
fi
if [[ ${#SESSION_SECRET} -lt 32 ]]; then
  echo 'Refusing to start: SESSION_SECRET is too short.' >&2
  exit 1
fi
if [[ ! "$ENCRYPTION_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo 'Refusing to start: ENCRYPTION_KEY must be 64 hex characters.' >&2
  exit 1
fi
echo 'Preview secrets: SESSION_SECRET and ENCRYPTION_KEY are set for this local process only.'

exec npm run dev
