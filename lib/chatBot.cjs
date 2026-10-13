// ── CompanySync Bot — system chat alerts ─────────────────────────────────────
// Shared by BOTH dev (vite-db-plugin.js / vite-stripe-plugin.js) and prod
// (db/prod-db.cjs / prod-server.cjs). Fix once here; do not mirror.
//
// Posts styled system alerts as the "CompanySync Bot" user into a designated
// per-company alerts Space (broadcast type → visible to all staff).
// All entry points are fire-and-forget safe: they never throw.

const BOT_EMAIL = 'companysync-bot@system';
const BOT_NAME = 'CompanySync Bot';
const ALERTS_SPACE_NAME = 'CompanySync Alerts';

function alertsSpaceId(companyId) {
  return `conv_alerts_${companyId}`;
}

// Idempotent + race-safe: deterministic id with ON CONFLICT DO NOTHING.
async function ensureAlertsSpace(pool, companyId) {
  const id = alertsSpaceId(companyId);
  await pool.query(
    `INSERT INTO chat_conversations (id, company_id, chat_type, name, participants, created_by, created_at, updated_at)
     VALUES ($1, $2, 'broadcast', $3, '[]', $4, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [id, companyId, ALERTS_SPACE_NAME, BOT_EMAIL]
  );
  return id;
}

// Eager variant used when someone opens Team Chat: makes sure the bot's
// alerts Space exists right away (instead of only after the first event)
// and posts a one-time welcome message so the space isn't empty.
// Fire-and-forget safe: never throws. Per-process cache skips the DB round
// trip after the first success (the conversations list is polled often).
const _eagerEnsured = new Set();
async function ensureAlertsSpaceEager(pool, companyId) {
  if (!pool || !companyId) return false;
  if (_eagerEnsured.has(companyId)) return true;
  try {
    const id = alertsSpaceId(companyId);
    const ins = await pool.query(
      `INSERT INTO chat_conversations (id, company_id, chat_type, name, participants, created_by, created_at, updated_at)
       VALUES ($1, $2, 'broadcast', $3, '[]', $4, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [id, companyId, ALERTS_SPACE_NAME, BOT_EMAIL]
    );
    if (ins.rows.length > 0) {
      await sendSystemChatMessage(pool, companyId, id,
        `👋 Hi team! I'm the **CompanySync Bot**. I'll post alerts here automatically when a new lead comes in, an invoice gets paid, or a job's status changes — so everyone stays in the loop.`);
    }
    _eagerEnsured.add(companyId);
    return true;
  } catch (e) {
    console.warn('[ChatBot] ensureAlertsSpaceEager failed:', e.message);
    return false;
  }
}

// Insert a system message from the bot into a space. Verifies the space
// belongs to the company (defense against forged/cross-tenant spaceId).
async function sendSystemChatMessage(pool, companyId, spaceId, messageText) {
  if (!pool || !companyId || !spaceId || !messageText) return false;
  try {
    const conv = await pool.query(
      `SELECT id FROM chat_conversations WHERE id = $1 AND company_id = $2`,
      [spaceId, companyId]
    );
    if (conv.rows.length === 0) return false;
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await pool.query(
      `INSERT INTO chat_messages (id, company_id, conversation_id, sender_email, sender_name, message, message_type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'system', NOW())`,
      [id, companyId, spaceId, BOT_EMAIL, BOT_NAME, messageText]
    );
    await pool.query(
      `UPDATE chat_conversations SET last_message = $1, last_message_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [messageText.length > 80 ? messageText.slice(0, 80) + '…' : messageText, spaceId]
    );
    return true;
  } catch (e) {
    console.warn('[ChatBot] sendSystemChatMessage failed:', e.message);
    return false;
  }
}

async function postAlert(pool, companyId, messageText) {
  try {
    const spaceId = await ensureAlertsSpace(pool, companyId);
    return await sendSystemChatMessage(pool, companyId, spaceId, messageText);
  } catch (e) {
    console.warn('[ChatBot] postAlert failed:', e.message);
    return false;
  }
}

// Field reader tolerant of both flattened records and {data: {...}} JSONB shapes.
function f(rec, key) {
  if (!rec || typeof rec !== 'object') return undefined;
  if (rec[key] !== undefined && rec[key] !== null) return rec[key];
  if (rec.data && typeof rec.data === 'object' && rec.data[key] !== undefined) return rec.data[key];
  return undefined;
}

function money(v) {
  const n = Number(v || 0);
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function invoicePaidText(inv) {
  const num = f(inv, 'invoice_number');
  const cust = f(inv, 'customer_name') || 'a customer';
  const amt = f(inv, 'total_amount') ?? f(inv, 'amount');
  return `💰 **Invoice paid** — ${num ? `Invoice ${num}` : 'An invoice'} from ${cust} was just paid${amt ? ` (${money(amt)})` : ''}.`;
}

// Called by the Stripe webhook code paths (which mark invoices paid via
// direct SQL, bypassing the entity API). Caller must only invoke on a real
// transition into 'paid'.
async function notifyInvoicePaid(pool, companyId, invoiceRow) {
  if (!companyId) return false;
  return postAlert(pool, companyId, invoicePaidText(invoiceRow || {}));
}

// Called at entity-API mutation hook sites (single create/update only).
// { sdkName, mutationType: 'create'|'update', before, after }
async function notifyEntityEvent(pool, { sdkName, mutationType, before, after } = {}) {
  try {
    if (!pool || !after) return false;
    const companyId = f(after, 'company_id');
    if (!companyId) return false;

    if (sdkName === 'Lead' && mutationType === 'create') {
      const name = f(after, 'name') || f(after, 'full_name')
        || [f(after, 'first_name'), f(after, 'last_name')].filter(Boolean).join(' ')
        || 'Unknown';
      const source = f(after, 'source') || f(after, 'lead_source');
      const phone = f(after, 'phone');
      const city = f(after, 'city');
      const state = f(after, 'state');
      const loc = [city, state].filter(Boolean).join(', ');
      const bits = [source ? `from ${source}` : null, phone ? `📞 ${phone}` : null, loc ? `📍 ${loc}` : null].filter(Boolean).join(' · ');
      return postAlert(pool, companyId, `🎯 **New lead** — ${name}${bits ? ` (${bits})` : ''} just came in. Check the Lead Manager to follow up.`);
    }

    if (sdkName === 'Invoice' && mutationType === 'update') {
      const prevStatus = String(f(before, 'status') || '').toLowerCase();
      const newStatus = String(f(after, 'status') || '').toLowerCase();
      if (newStatus === 'paid' && prevStatus !== 'paid') {
        return postAlert(pool, companyId, invoicePaidText(after));
      }
      return false;
    }

    if (sdkName === 'BuildSchedule' && mutationType === 'update') {
      const prevStatus = String(f(before, 'status') || '').toLowerCase();
      const newStatus = String(f(after, 'status') || '').toLowerCase();
      if (!newStatus || newStatus === prevStatus) return false;
      const cust = f(after, 'customer_name') || 'a job';
      const jobType = f(after, 'job_type');
      const jobLabel = Array.isArray(jobType) ? jobType.join(' & ') : (jobType || '');
      const pretty = (s) => s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Unknown';
      return postAlert(pool, companyId, `🔨 **Job status update** — ${jobLabel ? `${jobLabel} for ` : ''}${cust}: ${pretty(prevStatus)} → ${pretty(newStatus)}.`);
    }

    return false;
  } catch (e) {
    console.warn('[ChatBot] notifyEntityEvent failed:', e.message);
    return false;
  }
}

module.exports = {
  BOT_EMAIL,
  BOT_NAME,
  ALERTS_SPACE_NAME,
  alertsSpaceId,
  ensureAlertsSpace,
  ensureAlertsSpaceEager,
  sendSystemChatMessage,
  notifyInvoicePaid,
  notifyEntityEvent,
};
