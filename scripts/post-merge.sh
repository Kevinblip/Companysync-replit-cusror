#!/bin/bash
set -e
npm install

# ── Portal Privacy SQL Guard (static — no server required) ────────────────────
# Verifies that all is_public = true / false literals are still present in the
# portal API SQL queries in both the dev plugin and production server.
echo ""
echo "[post-merge] Running portal privacy SQL guard (static analysis)…"
node scripts/check-portal-privacy-sql.cjs

# Environment-dependent HTTP tests are intentionally not run here. Post-merge
# setup runs concurrently with workflow reconciliation, and these tests start
# temporary servers and mutate database fixtures. That made unrelated merges
# wait on startup/database locks until the setup timeout. Their focused workflow
# validations remain available when the affected areas change; this merge hook
# is limited to deterministic, non-network checks.

# ── HMAC Estimate-Token Helper Unit Tests (no server required) ───────────────
# Verifies sign/verify/append/checkAccess for the public-estimate signed-URL
# helper. Pure-CPU; safe to run on every merge.
echo ""
echo "[post-merge] Running estimate-token HMAC unit tests…"
if ! node scripts/test-estimate-token.cjs; then
  echo "[post-merge] ⚠ Estimate-token tests failed — investigate before deploying."
  exit 1
fi

# ── Alerting-Heartbeat Workflow Static Analysis (no server required) ─────────
# Validates .github/workflows/alerting-heartbeat.yml: YAML parsability, step-ID
# uniqueness, steps.<id>.outcome/outputs reference consistency, secrets-guard
# integrity, and timestamp-anchor existence. Pure-CPU; safe to run on every merge.
echo ""
echo "[post-merge] Running alerting-heartbeat workflow static analysis…"
if ! node scripts/test-heartbeat-workflow.cjs; then
  echo "[post-merge] ⚠ Heartbeat workflow validation failed — investigate before deploying."
  exit 1
fi

# ── Slack Webhook Delivery-Check Unit Tests (no server required) ──────────────
# Verifies the two-layer Slack delivery-failure detection logic: non-200 HTTP
# status AND ok==false body check. Spins up a local Python mock server; pure
# local; safe to run on every merge.
echo ""
echo "[post-merge] Running Slack webhook delivery-check tests…"
if ! bash scripts/test-slack-webhook-check.sh; then
  echo "[post-merge] ⚠ Slack webhook delivery-check tests failed — investigate before deploying."
  exit 1
fi

# ── Resend Verify-Action jq Filter Tests (no server required) ────────────────
# Validates that the jq filter in the verify-resend-delivery composite action
# correctly extracts recipient, status, and id fields from mocked Resend API
# responses. Also asserts the limit input is wired into the curl URL so the
# search window can be raised for high-volume accounts without editing the
# action. Pure-CPU; safe to run on every merge.
echo ""
echo "[post-merge] Running Resend verify-action jq filter tests…"
if ! bash scripts/test-resend-verify-action.sh; then
  echo "[post-merge] ⚠ Resend verify-action tests failed — investigate before deploying."
  exit 1
fi

# ── Email Verify-Step Lint Unit Tests (no server required) ───────────────────
# Exercises the three-check lint algorithm against in-memory fixture YAML
# content. Covers: correct pair, missing id, wrong verify name, verify if:
# referencing the wrong step id (copy-paste mistake), send-mail as last step,
# and YAML-parse fallback with a correct pair.
echo ""
echo "[post-merge] Running email verify-step lint unit tests…"
if ! node scripts/test-email-verify-steps.cjs; then
  echo "[post-merge] ⚠ Email verify-step lint unit tests failed — investigate before deploying."
  exit 1
fi

# ── Email Verify-Step Enforcement (static — no server required) ──────────────
# Scans every .github/workflows/*.yml for dawidd6/action-send-mail steps and
# fails if any step is missing an id: or is not immediately followed by a
# "Verify … email delivery (Resend)" step that references its id. Prevents
# new send-mail steps from silently bypassing delivery verification.
echo ""
echo "[post-merge] Running email verify-step enforcement lint…"
if ! node scripts/check-email-verify-steps.cjs; then
  echo "[post-merge] ⚠ Email verify-step enforcement failed — investigate before deploying."
  exit 1
fi

# ── Pre-Push Shell-Guard Self-Test (no server required) ──────────────────────
# Invokes .githooks/pre-push via sh (not bash) with a synthetic git stdin
# payload and asserts that the bash-version guard fires: exit 0 with the
# expected warning message. Prevents silent regressions in the guard logic.
echo ""
echo "[post-merge] Running pre-push shell-guard self-test…"
if ! bash scripts/test-pre-push-shell-guard.sh; then
  echo "[post-merge] ⚠ Pre-push shell-guard self-test failed — investigate before deploying."
  exit 1
fi

# ── Insurance Estimate Template Tests (no server required) ───────────────────
# Runs the vitest suite that validates every insurance carrier template generator
# (ACV/RCV line items, overhead, depreciation, supplement fields). Pure-CPU;
# safe to run on every merge.
echo ""
echo "[post-merge] Running insurance estimate template tests…"
if ! npx vitest run src/__tests__/insuranceEstimateTemplates.test.js --reporter=verbose 2>&1; then
  echo "[post-merge] ⚠ Insurance estimate template tests failed — investigate before deploying."
  exit 1
fi

echo ""
echo "[post-merge] All checks passed ✓"
