#!/bin/bash

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
REPO_URL="https://${GITHUB_TOKEN}@github.com/Kevinblip/Companysync-replit-cusror.git"

echo "[AutoDeploy] Starting pre-build git sync at $TIMESTAMP"

git add -A 2>/dev/null || true

if git diff --cached --quiet 2>/dev/null; then
  echo "[AutoDeploy] No new changes to commit"
else
  git commit -m "Auto-deploy: $TIMESTAMP" 2>/dev/null && echo "[AutoDeploy] Changes committed" || echo "[AutoDeploy] Commit skipped"
fi

if [ -n "$GITHUB_TOKEN" ]; then
  echo "[AutoDeploy] Pushing to GitHub..."
  GIT_LFS_SKIP_PUSH=1 timeout 60 git push --force --no-verify "$REPO_URL" HEAD:main 2>/dev/null \
    && echo "[AutoDeploy] Pushed to GitHub successfully" \
    || echo "[AutoDeploy] GitHub push skipped (build continues)"
fi

echo "[AutoDeploy] Running vite build..."
npx vite build
