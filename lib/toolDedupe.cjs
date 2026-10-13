'use strict';

// Gemini Live frequently re-issues the same logical tool call several times in
// a single turn, re-wording the free-text arguments each time. Keying dedupe on
// the raw argument JSON therefore misses them — one simulated emergency call
// produced 19 separate staff alerts that all said the same thing in different
// words, which in production means 19 SMS/notifications for one caller.
//
// For notification-style tools we key on the fields that identify WHO/WHAT the
// request is about rather than how it was phrased, so the side effect happens
// once per burst.
//
// Deliberately NOT listed here: schedule_inspection and book_appointment.
// Those legitimately change within one call (she proposes "tomorrow 10am", the
// caller counters with "Thursday afternoon"), and suppressing the second call
// would book the wrong slot. They keep exact-argument dedupe only, so identical
// repeats collapse while a genuine change still goes through.
const STABLE_KEY_FIELDS = {
  send_alert: ['category', 'caller_name', 'caller_phone'],
  notify_rep: ['target_person', 'rep_name'],
};

// How long a completed tool result stays dedupe-worthy. The retry bursts we're
// suppressing happen within seconds; a caller escalating a genuinely new
// problem later in the same call must still be able to raise a fresh alert.
const DEDUPE_TTL_MS = 60000;

function parseArgs(args) {
  let parsed = args;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch (e) { parsed = {}; }
  }
  if (!parsed || typeof parsed !== 'object') parsed = {};
  return parsed;
}

function toolDedupeKey(name, args) {
  const parsed = parseArgs(args);
  const fields = STABLE_KEY_FIELDS[name];
  if (!fields) return `${name}:${JSON.stringify(parsed)}`;

  const parts = fields.map((f) => String(parsed[f] == null ? '' : parsed[f]).trim().toLowerCase());
  // If every identifying field is blank we can't tell two requests apart, so
  // fall back to the wording rather than collapsing unrelated alerts.
  if (parts.every((p) => p === '')) return `${name}:${JSON.stringify(parsed)}`;
  return `${name}:${parts.join('|')}`;
}

// These handlers RESOLVE with a failure shape instead of rejecting, so a plain
// promise cache would happily replay the failure for the rest of the call and
// block a retry that would have worked.
function isFailureResult(result) {
  if (!result || typeof result !== 'object') return false;
  return result.success === false || Boolean(result.error) || result.status === 'failed';
}

// Per-call cache shared by the dev (vite-twilio-ws-plugin.js) and prod
// (prod-server.cjs) bridges so the two cannot drift.
function createToolCallCache(ttlMs = DEDUPE_TTL_MS) {
  const entries = new Map();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (Date.now() - entry.ts > ttlMs) {
        entries.delete(key);
        return null;
      }
      return entry.promise;
    },
    set(key, promise) {
      entries.set(key, { promise, ts: Date.now() });
      // Evict anything that didn't actually succeed so a retry can get through.
      promise.then(
        (result) => { if (isFailureResult(result)) entries.delete(key); },
        () => { entries.delete(key); }
      );
    },
    get size() { return entries.size; },
  };
}

module.exports = { toolDedupeKey, createToolCallCache, isFailureResult, STABLE_KEY_FIELDS, DEDUPE_TTL_MS };
