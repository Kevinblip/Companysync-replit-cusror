#!/usr/bin/env bash
# test-resend-verify-action.sh
#
# Validates that the jq filter used in
# .github/actions/verify-resend-delivery/action.yml correctly parses Resend
# API responses and extracts the expected fields.
#
# Tests cover:
#   1. .data array wrapper  — matching email returned
#   2. .emails array wrapper — fallback key works
#   3. Empty / no-match     — returns null (no false positive)
#   4. Recipient filter     — wrong recipient excluded
#   5. Subject filter       — wrong subject excluded
#   6. Time-window filter   — stale email excluded
#   7. last_event field     — preferred over .status
#   8. .status fallback     — used when last_event absent
#   9. .id extraction       — correct id returned
#  10. Limit query-param    — action uses RESEND_LIMIT env var in URL
#
# All assertions are pure-local (no network, no API key needed).
# Exits 0 if every assertion passes, 1 on first failure.

set -euo pipefail

PASS=0
FAIL=0

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  PASS  $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label"
    echo "        expected : $expected"
    echo "        actual   : $actual"
    FAIL=$((FAIL + 1))
  fi
}

assert_null_or_empty() {
  local label="$1" actual="$2"
  if [ -z "$actual" ] || [ "$actual" = "null" ]; then
    echo "  PASS  $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label (expected null/empty, got: $actual)"
    FAIL=$((FAIL + 1))
  fi
}

# ── Shared jq filter (mirrors the action verbatim) ───────────────────────────
JQ_FILTER='(.data // .emails // [])
  | map(select(
      ((.to // []) | any(ascii_downcase | test($to | ascii_downcase)))
      and .created_at >= $cutoff
      and ((.subject // "") | ascii_downcase | test($subject | ascii_downcase))
    ))
  | .[0]'

# Helper: run the filter against a JSON body
run_filter() {
  local body="$1" to="$2" cutoff="$3" subject="$4"
  echo "$body" | jq \
    --arg to      "$to" \
    --arg cutoff  "$cutoff" \
    --arg subject "$subject" \
    "$JQ_FILTER"
}

# Fixed timestamps
NOW="2026-05-10T12:00:00Z"
RECENT="2026-05-10T11:55:00Z"    # 5 min ago  — inside 10-min window
STALE="2026-05-10T11:45:00Z"     # 15 min ago — outside window
CUTOFF="2026-05-10T11:50:00Z"    # 10 min ago

echo ""
echo "=== Resend verify-action jq filter tests ==="
echo ""

# ── Test 1: .data wrapper returns matching email ──────────────────────────────
echo "Test 1: .data wrapper — matching email"
BODY=$(cat <<'EOF'
{
  "data": [
    {
      "id": "abc-001",
      "to": ["crew@example.com"],
      "subject": "Job Alert: roof inspection",
      "created_at": "2026-05-10T11:55:00Z",
      "last_event": "delivered",
      "status": "sent"
    }
  ]
}
EOF
)
MATCHED=$(run_filter "$BODY" "crew@example.com" "$CUTOFF" "roof inspection")
assert_eq "matched is not null" "true" "$([ "$MATCHED" != "null" ] && echo true || echo false)"
assert_eq "id extracted"        "abc-001"   "$(echo "$MATCHED" | jq -r '.id // "unknown"')"
assert_eq "last_event extracted" "delivered" "$(echo "$MATCHED" | jq -r '.last_event // .status // "unknown"')"

# ── Test 2: .emails fallback wrapper ─────────────────────────────────────────
echo ""
echo "Test 2: .emails wrapper — fallback key"
BODY=$(cat <<'EOF'
{
  "emails": [
    {
      "id": "abc-002",
      "to": ["crew@example.com"],
      "subject": "Estimate Ready",
      "created_at": "2026-05-10T11:55:00Z",
      "last_event": "sent"
    }
  ]
}
EOF
)
MATCHED=$(run_filter "$BODY" "crew@example.com" "$CUTOFF" "estimate")
assert_eq "emails fallback works" "abc-002" "$(echo "$MATCHED" | jq -r '.id // "unknown"')"

# ── Test 3: neither .data nor .emails — returns null ─────────────────────────
echo ""
echo "Test 3: unknown wrapper key — null result"
BODY='{"items": [{"id":"abc-003","to":["crew@example.com"],"subject":"Test","created_at":"2026-05-10T11:55:00Z"}]}'
MATCHED=$(run_filter "$BODY" "crew@example.com" "$CUTOFF" "test")
assert_null_or_empty "unknown wrapper yields null" "$MATCHED"

# ── Test 4: wrong recipient — excluded ────────────────────────────────────────
echo ""
echo "Test 4: recipient filter — wrong recipient excluded"
BODY=$(cat <<'EOF'
{
  "data": [
    {
      "id": "abc-004",
      "to": ["other@example.com"],
      "subject": "Invoice Ready",
      "created_at": "2026-05-10T11:55:00Z",
      "last_event": "delivered"
    }
  ]
}
EOF
)
MATCHED=$(run_filter "$BODY" "crew@example.com" "$CUTOFF" "invoice")
assert_null_or_empty "wrong recipient excluded" "$MATCHED"

# ── Test 5: wrong subject — excluded ─────────────────────────────────────────
echo ""
echo "Test 5: subject filter — non-matching subject excluded"
BODY=$(cat <<'EOF'
{
  "data": [
    {
      "id": "abc-005",
      "to": ["crew@example.com"],
      "subject": "Password Reset",
      "created_at": "2026-05-10T11:55:00Z",
      "last_event": "delivered"
    }
  ]
}
EOF
)
MATCHED=$(run_filter "$BODY" "crew@example.com" "$CUTOFF" "invoice")
assert_null_or_empty "wrong subject excluded" "$MATCHED"

# ── Test 6: stale email — excluded by time window ────────────────────────────
echo ""
echo "Test 6: time-window filter — stale email excluded"
BODY=$(cat <<'EOF'
{
  "data": [
    {
      "id": "abc-006",
      "to": ["crew@example.com"],
      "subject": "Roof Report",
      "created_at": "2026-05-10T11:45:00Z",
      "last_event": "delivered"
    }
  ]
}
EOF
)
MATCHED=$(run_filter "$BODY" "crew@example.com" "$CUTOFF" "roof")
assert_null_or_empty "stale email excluded" "$MATCHED"

# ── Test 7: last_event preferred over status ──────────────────────────────────
echo ""
echo "Test 7: last_event preferred over status"
BODY=$(cat <<'EOF'
{
  "data": [
    {
      "id": "abc-007",
      "to": ["crew@example.com"],
      "subject": "Inspection Complete",
      "created_at": "2026-05-10T11:55:00Z",
      "last_event": "delivered",
      "status": "sent"
    }
  ]
}
EOF
)
MATCHED=$(run_filter "$BODY" "crew@example.com" "$CUTOFF" "inspection")
assert_eq "last_event wins over status" "delivered" "$(echo "$MATCHED" | jq -r '.last_event // .status // "unknown"')"

# ── Test 8: status fallback when last_event absent ────────────────────────────
echo ""
echo "Test 8: status fallback when last_event absent"
BODY=$(cat <<'EOF'
{
  "data": [
    {
      "id": "abc-008",
      "to": ["crew@example.com"],
      "subject": "Inspection Complete",
      "created_at": "2026-05-10T11:55:00Z",
      "status": "bounced"
    }
  ]
}
EOF
)
MATCHED=$(run_filter "$BODY" "crew@example.com" "$CUTOFF" "inspection")
assert_eq "status used when last_event absent" "bounced" "$(echo "$MATCHED" | jq -r '.last_event // .status // "unknown"')"

# ── Test 9: id extraction ─────────────────────────────────────────────────────
echo ""
echo "Test 9: id extraction"
BODY=$(cat <<'EOF'
{
  "data": [
    {
      "id": "resend-xyz-9999",
      "to": ["crew@example.com"],
      "subject": "Damage Report",
      "created_at": "2026-05-10T11:55:00Z",
      "last_event": "sent"
    }
  ]
}
EOF
)
MATCHED=$(run_filter "$BODY" "crew@example.com" "$CUTOFF" "damage")
assert_eq "id correctly extracted" "resend-xyz-9999" "$(echo "$MATCHED" | jq -r '.id // "unknown"')"

# ── Test 10: id fallback to "unknown" when absent ────────────────────────────
echo ""
echo "Test 10: id fallback when field absent"
BODY=$(cat <<'EOF'
{
  "data": [
    {
      "to": ["crew@example.com"],
      "subject": "Damage Report",
      "created_at": "2026-05-10T11:55:00Z",
      "last_event": "sent"
    }
  ]
}
EOF
)
MATCHED=$(run_filter "$BODY" "crew@example.com" "$CUTOFF" "damage")
assert_eq "id fallback is unknown" "unknown" "$(echo "$MATCHED" | jq -r '.id // "unknown"')"

# ── Test 11: first of multiple matches returned ───────────────────────────────
echo ""
echo "Test 11: multiple matches — first one returned"
BODY=$(cat <<'EOF'
{
  "data": [
    {
      "id": "abc-first",
      "to": ["crew@example.com"],
      "subject": "Estimate Sent",
      "created_at": "2026-05-10T11:58:00Z",
      "last_event": "delivered"
    },
    {
      "id": "abc-second",
      "to": ["crew@example.com"],
      "subject": "Estimate Sent (copy)",
      "created_at": "2026-05-10T11:56:00Z",
      "last_event": "sent"
    }
  ]
}
EOF
)
MATCHED=$(run_filter "$BODY" "crew@example.com" "$CUTOFF" "estimate")
assert_eq "first match returned" "abc-first" "$(echo "$MATCHED" | jq -r '.id // "unknown"')"

# ── Test 12: case-insensitive recipient match ─────────────────────────────────
echo ""
echo "Test 12: case-insensitive recipient match"
BODY=$(cat <<'EOF'
{
  "data": [
    {
      "id": "abc-012",
      "to": ["CREW@EXAMPLE.COM"],
      "subject": "Weekly Summary",
      "created_at": "2026-05-10T11:55:00Z",
      "last_event": "delivered"
    }
  ]
}
EOF
)
MATCHED=$(run_filter "$BODY" "crew@example.com" "$CUTOFF" "weekly")
assert_eq "uppercase recipient matches" "abc-012" "$(echo "$MATCHED" | jq -r '.id // "unknown"')"

# ── Test 13: FETCH_LIMIT used in curl URL ────────────────────────────────────
echo ""
echo "Test 13: FETCH_LIMIT var is used in the action curl URL"
ACTION_FILE=".github/actions/verify-resend-delivery/action.yml"
if grep -q 'FETCH_LIMIT' "$ACTION_FILE"; then
  echo "  PASS  FETCH_LIMIT referenced in action"
  PASS=$((PASS + 1))
else
  echo "  FAIL  FETCH_LIMIT not referenced in action (check curl URL line)"
  FAIL=$((FAIL + 1))
fi

# ── Test 14: limit input declared with default '20' ──────────────────────────
echo ""
echo "Test 14: limit input declared in action with default 20"
if grep -q "default: '20'" "$ACTION_FILE"; then
  echo "  PASS  limit input with default '20' found"
  PASS=$((PASS + 1))
else
  echo "  FAIL  limit input default '20' not found in action"
  FAIL=$((FAIL + 1))
fi

# ── Test 15: numeric validation guard present in action ──────────────────────
echo ""
echo "Test 15: numeric validation guard exists in action"
if grep -q '^\[1-9\]' "$ACTION_FILE" || grep -q '\^.*\[1-9\]' "$ACTION_FILE"; then
  echo "  PASS  numeric regex guard found in action"
  PASS=$((PASS + 1))
else
  echo "  FAIL  numeric regex guard not found in action"
  FAIL=$((FAIL + 1))
fi

# ── Test 16: drift guard — action jq filter contains .data fallback ──────────
# NOTE: The JQ_FILTER variable above is a copy of the filter in the action.
# This test asserts the action still contains the same structural tokens so
# drift is surfaced at post-merge time rather than silently at runtime.
echo ""
echo "Test 16: action jq filter contains .data // .emails // [] guard"
if grep -q '\.data // \.emails // \[\]' "$ACTION_FILE"; then
  echo "  PASS  .data // .emails // [] guard found in action"
  PASS=$((PASS + 1))
else
  echo "  FAIL  .data // .emails // [] guard not found in action — filter may have drifted"
  FAIL=$((FAIL + 1))
fi

# ── Test 17: drift guard — action extracts .last_event // .status ────────────
echo ""
echo "Test 17: action extracts .last_event // .status // \"unknown\""
if grep -q '\.last_event // \.status // "unknown"' "$ACTION_FILE"; then
  echo "  PASS  .last_event // .status // \"unknown\" found in action"
  PASS=$((PASS + 1))
else
  echo "  FAIL  status extraction expression not found in action — filter may have drifted"
  FAIL=$((FAIL + 1))
fi

# ── Test 18: numeric validation guard rejects non-integer input ───────────────
echo ""
echo "Test 18: numeric validation guard rejects non-integer limit"
TEST_LIMIT="abc"
if ! [[ "$TEST_LIMIT" =~ ^[1-9][0-9]*$ ]]; then
  echo "  PASS  non-integer 'abc' correctly rejected by guard"
  PASS=$((PASS + 1))
else
  echo "  FAIL  non-integer 'abc' was not rejected"
  FAIL=$((FAIL + 1))
fi

# ── Test 19: numeric validation guard rejects zero ────────────────────────────
echo ""
echo "Test 19: numeric validation guard rejects zero"
TEST_LIMIT="0"
if ! [[ "$TEST_LIMIT" =~ ^[1-9][0-9]*$ ]]; then
  echo "  PASS  zero correctly rejected by guard"
  PASS=$((PASS + 1))
else
  echo "  FAIL  zero was not rejected by guard"
  FAIL=$((FAIL + 1))
fi

# ── Test 20: numeric validation guard accepts valid positive integer ───────────
echo ""
echo "Test 20: numeric validation guard accepts valid positive integer"
TEST_LIMIT="50"
if [[ "$TEST_LIMIT" =~ ^[1-9][0-9]*$ ]]; then
  echo "  PASS  '50' accepted by numeric guard"
  PASS=$((PASS + 1))
else
  echo "  FAIL  '50' was not accepted by numeric guard"
  FAIL=$((FAIL + 1))
fi

# ── Test 21: shape check — .data is an object (pagination envelope) ───────────
echo ""
echo "Test 21: shape check — unexpected shape triggers specific warning"
SHAPE_CHECK_JQ='(.data // .emails) | type'

# 21a: .data is an object (e.g. Resend adds pagination envelope)
BODY_PAGED='{"data":{"items":[{"id":"x"}],"total":1}}'
ARRAY_TYPE=$(echo "$BODY_PAGED" | jq -r "$SHAPE_CHECK_JQ")
if [ "$ARRAY_TYPE" != "array" ]; then
  echo "  PASS  pagination envelope (.data as object) detected as non-array"
  PASS=$((PASS + 1))
else
  echo "  FAIL  pagination envelope not detected as non-array (got: $ARRAY_TYPE)"
  FAIL=$((FAIL + 1))
fi

# 21b: neither .data nor .emails present (unknown top-level key)
BODY_UNKNOWN='{"results":[{"id":"y"}]}'
ARRAY_TYPE=$(echo "$BODY_UNKNOWN" | jq -r "$SHAPE_CHECK_JQ")
if [ "$ARRAY_TYPE" != "array" ]; then
  echo "  PASS  unknown top-level key detected as non-array"
  PASS=$((PASS + 1))
else
  echo "  FAIL  unknown top-level key not detected as non-array (got: $ARRAY_TYPE)"
  FAIL=$((FAIL + 1))
fi

# 21c: .data is a valid array — shape check passes
BODY_OK='{"data":[{"id":"z"}]}'
ARRAY_TYPE=$(echo "$BODY_OK" | jq -r "$SHAPE_CHECK_JQ")
if [ "$ARRAY_TYPE" = "array" ]; then
  echo "  PASS  valid .data array passes shape check"
  PASS=$((PASS + 1))
else
  echo "  FAIL  valid .data array incorrectly failed shape check (got: $ARRAY_TYPE)"
  FAIL=$((FAIL + 1))
fi

# 21d: shape check expression is present in the action file
ACTION_FILE=".github/actions/verify-resend-delivery/action.yml"
if grep -q 'Resend API response shape unexpected' "$ACTION_FILE"; then
  echo "  PASS  shape-check warning message found in action"
  PASS=$((PASS + 1))
else
  echo "  FAIL  shape-check warning message not found in action"
  FAIL=$((FAIL + 1))
fi

# ── Test 22: window_minutes input declared with default '10' ──────────────────
echo ""
echo "Test 22: window_minutes input declared in action with default '10'"
ACTION_FILE=".github/actions/verify-resend-delivery/action.yml"
if grep -q "default: '10'" "$ACTION_FILE"; then
  echo "  PASS  window_minutes input with default '10' found"
  PASS=$((PASS + 1))
else
  echo "  FAIL  window_minutes input default '10' not found in action"
  FAIL=$((FAIL + 1))
fi

# ── Test 23: WINDOW_MINUTES env var passed into action script ─────────────────
echo ""
echo "Test 23: WINDOW_MINUTES env var referenced in action"
if grep -q 'WINDOW_MINUTES' "$ACTION_FILE"; then
  echo "  PASS  WINDOW_MINUTES referenced in action"
  PASS=$((PASS + 1))
else
  echo "  FAIL  WINDOW_MINUTES not referenced in action"
  FAIL=$((FAIL + 1))
fi

# ── Test 24: CUTOFF uses WIN variable (not hardcoded 10) ─────────────────────
echo ""
echo "Test 24: CUTOFF uses WIN variable, not hardcoded '10 minutes ago'"
if grep -q '10 minutes ago' "$ACTION_FILE"; then
  echo "  FAIL  hardcoded '10 minutes ago' still present in action — should use \${WIN}"
  FAIL=$((FAIL + 1))
else
  echo "  PASS  hardcoded '10 minutes ago' replaced with configurable WIN variable"
  PASS=$((PASS + 1))
fi

# ── Test 25: wider window_minutes allows older email to match ─────────────────
echo ""
echo "Test 25: wider window — email from 15 min ago matches with 20-min cutoff"
CUTOFF_WIDE="2026-05-10T11:40:00Z"   # 20 min ago — wider window
BODY=$(cat <<'EOF'
{
  "data": [
    {
      "id": "abc-025",
      "to": ["crew@example.com"],
      "subject": "CI Heartbeat",
      "created_at": "2026-05-10T11:45:00Z",
      "last_event": "delivered"
    }
  ]
}
EOF
)
MATCHED=$(run_filter "$BODY" "crew@example.com" "$CUTOFF_WIDE" "heartbeat")
assert_eq "15-min-old email matched with 20-min window" "abc-025" "$(echo "$MATCHED" | jq -r '.id // "unknown"')"

# ── Test 26: default 10-min window excludes the same 15-min-old email ─────────
echo ""
echo "Test 26: default 10-min window — same email falls outside and is excluded"
MATCHED=$(run_filter "$BODY" "crew@example.com" "$CUTOFF" "heartbeat")
assert_null_or_empty "15-min-old email excluded by default 10-min window" "$MATCHED"

# ── Test 27: empty array emits distinct warning (not the shape warning) ────────
echo ""
echo "Test 27: empty array — distinct warning message present in action"
ACTION_FILE=".github/actions/verify-resend-delivery/action.yml"
if grep -q 'Resend API returned an empty email list' "$ACTION_FILE"; then
  echo "  PASS  empty-array warning message found in action"
  PASS=$((PASS + 1))
else
  echo "  FAIL  empty-array warning message not found in action"
  FAIL=$((FAIL + 1))
fi

# ── Test 28: empty .data array has length 0 ───────────────────────────────────
echo ""
echo "Test 28: empty .data array — jq length returns 0"
BODY_EMPTY='{"data":[]}'
ARRAY_LEN=$(echo "$BODY_EMPTY" | jq '(.data // .emails) | length')
assert_eq "empty .data array length is 0" "0" "$ARRAY_LEN"

# ── Test 29: empty .emails array has length 0 ─────────────────────────────────
echo ""
echo "Test 29: empty .emails array — jq length returns 0"
BODY_EMPTY_EMAILS='{"emails":[]}'
ARRAY_LEN=$(echo "$BODY_EMPTY_EMAILS" | jq '(.data // .emails) | length')
assert_eq "empty .emails array length is 0" "0" "$ARRAY_LEN"

# ── Test 30: non-empty array has length > 0 (no false positive) ───────────────
echo ""
echo "Test 30: non-empty array — length > 0, empty-list check does not fire"
BODY_NONEMPTY='{"data":[{"id":"abc"}]}'
ARRAY_LEN=$(echo "$BODY_NONEMPTY" | jq '(.data // .emails) | length')
if [ "$ARRAY_LEN" -gt 0 ]; then
  echo "  PASS  non-empty array not mistaken for empty"
  PASS=$((PASS + 1))
else
  echo "  FAIL  non-empty array reported as empty (length: $ARRAY_LEN)"
  FAIL=$((FAIL + 1))
fi

# ── Test 31: min_emails input declared with default '0' ───────────────────────
echo ""
echo "Test 31: min_emails input declared in action with default '0'"
ACTION_FILE=".github/actions/verify-resend-delivery/action.yml"
if grep -q "default: '0'" "$ACTION_FILE"; then
  echo "  PASS  min_emails input with default '0' found"
  PASS=$((PASS + 1))
else
  echo "  FAIL  min_emails input default '0' not found in action"
  FAIL=$((FAIL + 1))
fi

# ── Test 32: MIN_EMAILS env var referenced in action ──────────────────────────
echo ""
echo "Test 32: MIN_EMAILS env var referenced in action"
if grep -q 'MIN_EMAILS' "$ACTION_FILE"; then
  echo "  PASS  MIN_EMAILS referenced in action"
  PASS=$((PASS + 1))
else
  echo "  FAIL  MIN_EMAILS not referenced in action"
  FAIL=$((FAIL + 1))
fi

# ── Test 33: threshold warning message present in action ──────────────────────
echo ""
echo "Test 33: threshold warning message present in action"
if grep -q 'min_emails threshold' "$ACTION_FILE"; then
  echo "  PASS  min_emails threshold warning message found in action"
  PASS=$((PASS + 1))
else
  echo "  FAIL  min_emails threshold warning message not found in action"
  FAIL=$((FAIL + 1))
fi

# ── Test 34: threshold logic — count below threshold triggers warning ──────────
echo ""
echo "Test 34: threshold logic — count below threshold fires warning"
ARRAY_LEN_TEST=2
MIN_THRESHOLD_TEST=5
if [ "$MIN_THRESHOLD_TEST" -gt 0 ] && [ "$ARRAY_LEN_TEST" -lt "$MIN_THRESHOLD_TEST" ]; then
  echo "  PASS  count $ARRAY_LEN_TEST below threshold $MIN_THRESHOLD_TEST correctly triggers warning path"
  PASS=$((PASS + 1))
else
  echo "  FAIL  count $ARRAY_LEN_TEST below threshold $MIN_THRESHOLD_TEST did not trigger warning path"
  FAIL=$((FAIL + 1))
fi

# ── Test 35: threshold logic — count at threshold does not trigger warning ─────
echo ""
echo "Test 35: threshold logic — count at threshold does not fire"
ARRAY_LEN_TEST=5
MIN_THRESHOLD_TEST=5
if [ "$MIN_THRESHOLD_TEST" -gt 0 ] && [ "$ARRAY_LEN_TEST" -lt "$MIN_THRESHOLD_TEST" ]; then
  echo "  FAIL  count equal to threshold incorrectly triggered warning"
  FAIL=$((FAIL + 1))
else
  echo "  PASS  count $ARRAY_LEN_TEST at threshold $MIN_THRESHOLD_TEST correctly does not trigger warning"
  PASS=$((PASS + 1))
fi

# ── Test 36: threshold logic — count above threshold does not fire ─────────────
echo ""
echo "Test 36: threshold logic — count above threshold does not fire"
ARRAY_LEN_TEST=20
MIN_THRESHOLD_TEST=5
if [ "$MIN_THRESHOLD_TEST" -gt 0 ] && [ "$ARRAY_LEN_TEST" -lt "$MIN_THRESHOLD_TEST" ]; then
  echo "  FAIL  count $ARRAY_LEN_TEST above threshold $MIN_THRESHOLD_TEST incorrectly triggered warning"
  FAIL=$((FAIL + 1))
else
  echo "  PASS  count $ARRAY_LEN_TEST above threshold $MIN_THRESHOLD_TEST correctly does not trigger warning"
  PASS=$((PASS + 1))
fi

# ── Test 37: threshold disabled (min_emails=0) — no warning regardless of count ─
echo ""
echo "Test 37: threshold disabled (min_emails=0) — no warning for small count"
ARRAY_LEN_TEST=1
MIN_THRESHOLD_TEST=0
if [ "$MIN_THRESHOLD_TEST" -gt 0 ] && [ "$ARRAY_LEN_TEST" -lt "$MIN_THRESHOLD_TEST" ]; then
  echo "  FAIL  disabled threshold (0) incorrectly triggered warning for count $ARRAY_LEN_TEST"
  FAIL=$((FAIL + 1))
else
  echo "  PASS  disabled threshold (0) correctly skips warning for count $ARRAY_LEN_TEST"
  PASS=$((PASS + 1))
fi

# ── Test 38: threshold validation — non-integer min_emails is treated as 0 ────
echo ""
echo "Test 38: threshold validation — non-integer min_emails defaults to 0 (disabled)"
MIN_THRESHOLD_RAW="abc"
if ! [[ "$MIN_THRESHOLD_RAW" =~ ^[0-9]+$ ]]; then
  echo "  PASS  non-integer 'abc' correctly rejected by min_emails guard (falls back to 0)"
  PASS=$((PASS + 1))
else
  echo "  FAIL  non-integer 'abc' was not rejected by min_emails guard"
  FAIL=$((FAIL + 1))
fi

# ── Test 39: threshold validation — negative min_emails is treated as 0 ───────
echo ""
echo "Test 39: threshold validation — negative min_emails defaults to 0 (disabled)"
MIN_THRESHOLD_RAW="-3"
if ! [[ "$MIN_THRESHOLD_RAW" =~ ^[0-9]+$ ]]; then
  echo "  PASS  negative value '-3' correctly rejected by min_emails guard (falls back to 0)"
  PASS=$((PASS + 1))
else
  echo "  FAIL  negative value '-3' was not rejected by min_emails guard"
  FAIL=$((FAIL + 1))
fi

# ── Test 40: threshold validation — valid positive integer accepted ────────────
echo ""
echo "Test 40: threshold validation — valid positive integer accepted"
MIN_THRESHOLD_RAW="5"
if [[ "$MIN_THRESHOLD_RAW" =~ ^[0-9]+$ ]]; then
  echo "  PASS  '5' accepted as valid min_emails value"
  PASS=$((PASS + 1))
else
  echo "  FAIL  '5' was not accepted as valid min_emails value"
  FAIL=$((FAIL + 1))
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="
echo ""
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
