#!/usr/bin/env bash
# scripts/test-pre-push-shell-guard.sh
#
# Self-test: verifies that .githooks/pre-push exits 0 and prints the expected
# warning when invoked via sh (a non-bash shell) instead of bash.
#
# Usage:  bash scripts/test-pre-push-shell-guard.sh
# Exit:   0 — all assertions passed
#         1 — one or more assertions failed

set -euo pipefail

HOOK=".githooks/pre-push"
PASSED=0
FAILED=0

ok() {
  echo "  ✓ $1"
  PASSED=$((PASSED + 1))
}

fail() {
  echo "  ✗ $1"
  FAILED=$((FAILED + 1))
}

skip() {
  echo "  - $1 (skipped)"
  PASSED=$((PASSED + 1))
}

echo ""
echo "[pre-push-shell-guard] Running shell-guard self-test…"
echo ""

# Verify the hook file exists and is executable (or at least readable).
if [ ! -f "$HOOK" ]; then
  echo "  ABORT: $HOOK not found — cannot run tests."
  exit 1
fi

# Detect whether 'sh' on this machine IS bash (e.g. Nix resolves sh -> bash).
# When sh=bash the BASH_VERSION guard in the hook correctly does NOT fire
# (because bash is the interpreter), so warning-output assertions are vacuously
# true rather than a real failure.
SH_IS_BASH=0
SH_VERSION="$(sh --version 2>&1 || true)"
if echo "$SH_VERSION" | grep -qi "bash"; then
  SH_IS_BASH=1
  echo "  [note] 'sh' on this system resolves to bash — guard-output assertions will be skipped."
  echo ""
fi

# A synthetic git pre-push stdin payload:
#   <local-ref> <local-sha1> <remote-ref> <remote-sha1>
# The null SHA signals a new branch; the hook would try to diff against an
# empty tree, but the bash guard fires first so no git calls are made.
SYNTHETIC_STDIN="refs/heads/test-branch 0000000000000000000000000000000000000001 refs/heads/test-branch 0000000000000000000000000000000000000000"

# ── Test 1: exit code is 0 when run under sh ─────────────────────────────────
# Temporarily disable set -e so the assignment captures the real exit status
# rather than triggering an early abort. "|| true" is intentionally avoided
# because it resets $? to 0 before we can read it.
set +e
OUTPUT="$(echo "$SYNTHETIC_STDIN" | sh "$HOOK" origin "https://example.com" 2>&1)"
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -eq 0 ]; then
  ok "exit code is 0 when hook is invoked via sh"
else
  fail "exit code should be 0 when invoked via sh, got: $EXIT_CODE"
fi

# ── Test 2: warning about wrong shell is printed ─────────────────────────────
if [ "$SH_IS_BASH" -eq 1 ]; then
  skip "output contains the bash-required warning (sh=bash; guard correctly silent)"
elif echo "$OUTPUT" | grep -q "WARNING: This hook requires bash"; then
  ok "output contains the bash-required warning"
else
  fail "output should contain 'WARNING: This hook requires bash', got: $OUTPUT"
fi

# ── Test 3: skip-message is included ─────────────────────────────────────────
if [ "$SH_IS_BASH" -eq 1 ]; then
  skip "output contains the skip-checks message (sh=bash; guard correctly silent)"
elif echo "$OUTPUT" | grep -q "Skipping all pre-push checks"; then
  ok "output contains the skip-checks message"
else
  fail "output should contain 'Skipping all pre-push checks', got: $OUTPUT"
fi

# ── Test 4: no checks ran (no "[pre-push] " check output beyond the guard) ───
# Filter out the guard lines themselves; nothing else should appear.
# When sh=bash the hook runs normally against a null-SHA push (new branch with
# no previous commits to diff), so any output it produces is expected/benign.
if [ "$SH_IS_BASH" -eq 1 ]; then
  skip "no check output beyond the guard warning (sh=bash; hook ran as bash)"
else
  NON_GUARD_OUTPUT="$(echo "$OUTPUT" | grep -v "WARNING:" | grep -v "Skipping all" | grep -v "^$" || true)"
  if [ -z "$NON_GUARD_OUTPUT" ]; then
    ok "no check output beyond the guard warning"
  else
    fail "unexpected output beyond the guard: $NON_GUARD_OUTPUT"
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "[pre-push-shell-guard] Results: ${PASSED} passed, ${FAILED} failed."
echo ""

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

exit 0
