#!/bin/bash
# scripts/setup-dev.sh
#
# One-time developer environment setup.
# Called automatically by `npm install` via the `prepare` lifecycle script.
#
# Currently does:
#   - Activates the .githooks directory so pre-push lint checks run on every push.
#
# Safe to run in CI/CD environments where .git does not exist (skips silently).

set -euo pipefail

if [ ! -d ".git" ]; then
  exit 0
fi

git config core.hooksPath .githooks

echo "[setup] Git hooks activated via .githooks"
