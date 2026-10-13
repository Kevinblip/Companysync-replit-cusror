// ============================================================
// STAFF VOICE AUTH — shared by the dev phone bridge
// (vite-twilio-ws-plugin.js) and prod-server.cjs.
//
// Lets a staff member call the company's AI phone line from
// their own cell and unlock the full Lexi CRM tool set AFTER
// verifying a spoken PIN. Caller ID alone is NEVER trusted
// (it is spoofable): the PIN is the real factor, caller ID
// only selects WHICH staff profile to challenge.
//
// PIN storage (staff_profiles.data JSONB):
//   voice_pin_salt  — random hex salt
//   voice_pin_hash  — sha256(`${salt}:${pin}`) hex
//   voice_pin_failed_count / voice_pin_locked_until — lockout state
//
// Lockout is PERSISTED so redialing does not reset attempts:
// 5 consecutive failures → locked for 15 minutes.
// ============================================================
'use strict';

const crypto = require('crypto');

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const MAX_ATTEMPTS_PER_CALL = 3;

function normalizePhoneLast10(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

function hashPin(pin, salt) {
  return crypto.createHash('sha256').update(`${salt}:${String(pin)}`).digest('hex');
}

function constantTimeEqualHex(aHex, bHex) {
  try {
    const a = Buffer.from(String(aHex), 'hex');
    const b = Buffer.from(String(bHex), 'hex');
    if (a.length !== b.length || a.length === 0) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

function parseJsonb(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (_) { return {}; }
  }
  return raw;
}

/**
 * Match an inbound caller against active staff profiles of the company.
 * Returns null when no match OR the matched staff has no voice PIN set
 * (no PIN → staff mode never activates; they get the normal customer flow).
 *
 * Returns: { staffId, fullName, userEmail, timezone, isAdministrator } | null
 */
async function findStaffByCallerPhone(pool, companyId, callerPhone) {
  const callerKey = normalizePhoneLast10(callerPhone);
  if (!pool || !companyId || !callerKey || callerKey.length < 10) return null;

  const res = await pool.query(
    `SELECT sp.id, sp.full_name, sp.user_email, sp.cell_phone, sp.phone, sp.data, sp.is_administrator,
            c.data AS company_data, c.settings AS company_settings
       FROM staff_profiles sp
       LEFT JOIN companies c ON c.id = sp.company_id
      WHERE sp.company_id = $1
        AND sp.is_active = true
        AND (sp.cell_phone IS NOT NULL OR sp.phone IS NOT NULL)`,
    [String(companyId)]
  );

  for (const row of res.rows) {
    const cellKey = normalizePhoneLast10(row.cell_phone);
    const phoneKey = normalizePhoneLast10(row.phone);
    if ((cellKey && cellKey === callerKey) || (phoneKey && phoneKey === callerKey)) {
      const data = parseJsonb(row.data);
      // No PIN configured → this row can't unlock staff mode (caller ID
      // alone is spoofable) — but keep scanning: another staff profile may
      // share the same last-10 digits (e.g. a shared office line) AND have
      // a PIN set, and row ordering must not shadow it.
      if (!data.voice_pin_hash || !data.voice_pin_salt) continue;
      const companyData = parseJsonb(row.company_data);
      const companySettings = parseJsonb(row.company_settings);
      return {
        staffId: row.id,
        fullName: row.full_name || 'there',
        userEmail: row.user_email || '',
        timezone: companyData.timezone || companySettings.timezone || 'America/New_York',
        isAdministrator: !!row.is_administrator,
      };
    }
  }
  return null;
}

/**
 * Verify one spoken PIN attempt for a staff profile. Persists lockout
 * state in staff_profiles.data so failures survive redials.
 *
 * Returns: { ok, locked, lockedUntil, attemptsLeft }
 */
async function verifyPinAttempt(pool, staffId, pin) {
  const res = await pool.query(
    `SELECT data FROM staff_profiles WHERE id = $1 AND is_active = true`,
    [String(staffId)]
  );
  if (res.rows.length === 0) return { ok: false, locked: false, attemptsLeft: 0 };

  const data = parseJsonb(res.rows[0].data);
  const now = Date.now();

  const lockedUntil = data.voice_pin_locked_until ? Date.parse(data.voice_pin_locked_until) : 0;
  if (lockedUntil && lockedUntil > now) {
    return { ok: false, locked: true, lockedUntil: new Date(lockedUntil).toISOString(), attemptsLeft: 0 };
  }

  const hash = data.voice_pin_hash;
  const salt = data.voice_pin_salt;
  const cleanPin = String(pin == null ? '' : pin).replace(/\D/g, '');
  const good = !!(hash && salt && cleanPin) && constantTimeEqualHex(hashPin(cleanPin, salt), hash);

  if (good) {
    await pool.query(
      `UPDATE staff_profiles
          SET data = COALESCE(data, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
        WHERE id = $2`,
      [JSON.stringify({ voice_pin_failed_count: 0, voice_pin_locked_until: null }), String(staffId)]
    );
    return { ok: true, locked: false, attemptsLeft: MAX_FAILED_ATTEMPTS };
  }

  const failed = (parseInt(data.voice_pin_failed_count, 10) || 0) + 1;
  const patch = { voice_pin_failed_count: failed };
  let locked = false;
  if (failed >= MAX_FAILED_ATTEMPTS) {
    patch.voice_pin_locked_until = new Date(now + LOCKOUT_MINUTES * 60 * 1000).toISOString();
    patch.voice_pin_failed_count = 0; // counter resets when the lock expires
    locked = true;
  }
  await pool.query(
    `UPDATE staff_profiles
        SET data = COALESCE(data, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify(patch), String(staffId)]
  );
  return {
    ok: false,
    locked,
    lockedUntil: patch.voice_pin_locked_until || null,
    attemptsLeft: locked ? 0 : MAX_FAILED_ATTEMPTS - failed,
  };
}

/**
 * Redact digit runs (3+ digits, spoken PINs often transcribe with spaces
 * or dashes) from a transcript chunk. Used while a staff caller is still
 * UNVERIFIED so the PIN never lands in the stored call transcript.
 */
function redactPinDigits(text) {
  if (!text) return text;
  return String(text).replace(/\d[\s\-.,]*(?:\d[\s\-.,]*){2,}\d?/g, '[digits redacted]');
}

// Tool declaration shared by both bridges (Gemini Live function_declarations shape).
const VERIFY_STAFF_PIN_TOOL = {
  name: 'verify_staff_pin',
  description: 'Verify the caller\'s spoken staff PIN. Call this IMMEDIATELY whenever the caller says a sequence of digits while unverified. Pass digits only.',
  parameters: {
    type: 'object',
    properties: {
      pin: { type: 'string', description: 'The PIN digits the caller spoke, digits only (e.g. "4271")' },
    },
    required: ['pin'],
  },
};

/**
 * Lean staff-mode system prompt for the PHONE bridge.
 * SECURITY: deliberately contains NO customer list and NO knowledge base —
 * the caller is unverified when this prompt is installed, and all data
 * access must flow through the server-gated tools.
 */
function buildStaffPhonePrompt(companyName, assistantName, staffName, timezone) {
  const now = new Date();
  const currentDateString = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone });
  const currentTimeString = now.toLocaleString('en-US', { timeZone: timezone });

  return `You are ${assistantName}, the AI assistant for ${companyName}, on an INTERNAL STAFF CALL. The caller's phone number matches team member ${staffName}, but their identity is NOT yet verified.

VERIFICATION — DO THIS FIRST:
1. Greet them briefly by first name and ask for their voice PIN.
2. When they say digits, call verify_staff_pin with the digits immediately. Never repeat the digits back aloud.
3. If verification fails, tell them and ask them to try again. If the tool reports they are locked out or out of attempts, apologize, tell them to update their Voice PIN in their staff profile, and treat the rest of the call as a normal customer call with NO CRM access.
4. Until verify_staff_pin succeeds, EVERY other tool is locked and you must not reveal ANY business or customer information.

AFTER VERIFICATION — you are their hands-free CRM assistant:
- Look up customers, leads, estimates, invoices, payments, projects, tasks, staff, and calendar via get_crm_data and the other tools.
- Create leads, tasks, notes, calendar events; update records; send emails/SMS (confirm before sending).
- Record payments is NOT available by voice — if asked, say payments must be entered in the app.
- You CANNOT delete records. If asked, say deletions must be done in the CRM directly.
- Summarize data conversationally; don't read long lists — offer to narrow down.
- Never invent data. If a tool fails or finds nothing, say so plainly.

DATE CONTEXT:
- Today: ${currentDateString}
- Current time: ${currentTimeString} (${timezone})

VOICE & BEHAVIOR RULES (always apply):
1. BREVITY: Keep every response to 1 to 2 short sentences unless reading back requested data. Never give long speeches or bulleted lists.
2. NATURAL FLOW: Speak like a real person over the phone. Use natural phrases like "Got it," "Sure thing," "On it," or "One sec."
3. ONE QUESTION AT A TIME: When you need information, end your turn with a single, clear question, then STOP speaking and wait.
4. HANDLING INTERRUPTIONS: If the caller cuts in or speaks over you, stop immediately and address what they just said.
5. INTENT: Be fast, direct, and action-oriented. Confirm what you did in one short sentence.`;
}

module.exports = {
  findStaffByCallerPhone,
  verifyPinAttempt,
  hashPin,
  redactPinDigits,
  buildStaffPhonePrompt,
  VERIFY_STAFF_PIN_TOOL,
  MAX_ATTEMPTS_PER_CALL,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MINUTES,
  _normalizePhoneLast10: normalizePhoneLast10,
};
