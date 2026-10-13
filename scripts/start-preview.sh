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

exec npm run dev
