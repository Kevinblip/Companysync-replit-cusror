'use strict';

const { toE164 } = require('./phoneE164.cjs');

const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);
const START_WORDS = new Set(['start', 'unstop']);

function classifyInboundSms(body) {
  const first = String(body || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)[0]
    ?.replace(/[^a-z]/g, '') || '';
  if (STOP_WORDS.has(first)) return 'stop';
  if (START_WORDS.has(first)) return 'start';
  return null;
}

function optOutReply(kind) {
  if (kind === 'stop') {
    return "You're unsubscribed and will not receive more texts. Reply START to opt back in.";
  }
  if (kind === 'start') return "You're opted back in and can receive texts again.";
  return null;
}

let schemaReady = null;
async function ensureSchema(pool) {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS sms_opt_outs (
        phone_e164 TEXT NOT NULL,
        company_id TEXT NOT NULL DEFAULT '',
        opted_out BOOLEAN NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (phone_e164, company_id)
      )
    `).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function setOptOut(pool, phone, companyId, optedOut) {
  const phoneE164 = toE164(phone);
  if (!phoneE164) return false;
  await ensureSchema(pool);
  const company = companyId ? String(companyId) : '';
  await pool.query(
    `INSERT INTO sms_opt_outs (phone_e164, company_id, opted_out, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (phone_e164, company_id)
     DO UPDATE SET opted_out = EXCLUDED.opted_out, updated_at = NOW()`,
    [phoneE164, company, !!optedOut],
  );
  return true;
}

// 'out' blocks the send, 'in' is an explicit START that overrides older STOP
// history, null means this number has no durable choice yet.
async function optOutStatus(pool, phone, companyId) {
  const phoneE164 = toE164(phone);
  if (!phoneE164) return null;
  try {
    await ensureSchema(pool);
    const company = companyId ? String(companyId) : '';
    const { rows } = await pool.query(
      `SELECT company_id, opted_out FROM sms_opt_outs
       WHERE phone_e164 = $1 AND company_id IN ($2, '')`,
      [phoneE164, company],
    );
    const forCompany = rows.find((row) => row.company_id === company);
    if (forCompany) return forCompany.opted_out ? 'out' : 'in';
    const platform = rows.find((row) => row.company_id === '');
    if (platform) return platform.opted_out ? 'out' : 'in';
    return null;
  } catch (err) {
    console.warn('[sms-opt-out] lookup failed:', err.message);
    return null;
  }
}

module.exports = {
  STOP_WORDS,
  START_WORDS,
  classifyInboundSms,
  optOutReply,
  setOptOut,
  optOutStatus,
  ensureSchema,
};
