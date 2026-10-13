'use strict';

// ============================================================================
// AI VOICE ASSISTANT NAME — single source of truth
//
// The voice assistant is always "Alex". This used to be subscriber-configurable
// (the name was extracted from the system prompt and saved as `assistant_name`),
// which meant live calls answered as "Sarah", "Marcus", etc. and confused
// homeowners who had been told who would be calling.
//
// The settings UI now always writes 'alex', but AssistantSettings rows seeded
// before that change still carry the old values. Those stale rows must be
// IGNORED rather than migrated, so every tenant self-heals without a risky
// bulk data update.
//
// Required by BOTH vite-twilio-ws-plugin.js (dev bridge) and prod-server.cjs
// (prod bridge). Keep the logic here — do not re-implement it at a call site.
// ============================================================================

const ASSISTANT_NAME = 'Alex';

// Values that must never win over the fixed name.
const LEGACY_NAMES = new Set(['sarah', 'lexi', 'assistant', 'ai', 'agent']);

/** True when `raw` is a real, subscriber-meaningful name we should honor. */
function isUsableAssistantName(raw) {
  const n = String(raw || '').trim();
  if (!n) return false;
  if (/^\{.*\}$/.test(n)) return false; // unresolved "{template}" placeholder
  if (LEGACY_NAMES.has(n.toLowerCase())) return false; // stale seeded default
  return true;
}

/**
 * Resolve the name to speak, trying each candidate in priority order and
 * falling back to the fixed ASSISTANT_NAME.
 */
function resolveAssistantName(...candidates) {
  for (const candidate of candidates) {
    if (isUsableAssistantName(candidate)) {
      const n = String(candidate).trim();
      return n.charAt(0).toUpperCase() + n.slice(1);
    }
  }
  return ASSISTANT_NAME;
}

module.exports = { ASSISTANT_NAME, LEGACY_NAMES, isUsableAssistantName, resolveAssistantName };
