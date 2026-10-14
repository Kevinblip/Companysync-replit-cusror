#!/usr/bin/env bash
# Build the bundled CompanySync shell and copy it into the native projects.
# Does not publish Replit, talk to a live database, or send SMS, calls, or Stripe charges.
set -euo pipefail
cd "$(dirname "$0")/.."

API_BASE="${VITE_API_BASE_URL:-}"
if [ -z "$API_BASE" ]; then
  API_BASE="$(node -e "console.log(require('./mobile.config.json').apiBaseUrl)")"
fi

export VITE_API_BASE_URL="$API_BASE"
export VITE_CAPACITOR_BUILD=true
export CAPACITOR_BUILD=1
export VITE_PUSH_ENABLED="${VITE_PUSH_ENABLED:-false}"

echo "[mobile] API base: $VITE_API_BASE_URL"
echo "[mobile] Push registration: $VITE_PUSH_ENABLED"
node scripts/write-capacitor-config.cjs
npx vite build
npx cap sync
echo "[mobile] Synced. Open Xcode with: npx cap open ios"
echo "[mobile] Open Android Studio with: npx cap open android"
