// ─────────────────────────────────────────────────────────────────────────────
// Email provider health tracker — shared by dev vite plugins AND prod-server.cjs
//
// Tracks auth failures from any provider (Postmark, SES, Resend) and persists a
// status marker so the admin sees a banner when email is down.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_ID = 'email_provider_status';
const MASTER_COMPANY = 'companysync_master_001';
const PERSIST_DEBOUNCE_MS = 5 * 60 * 1000;

// Single source of truth: ./emailTransport.cjs owns provider selection (including
// the EMAIL_PROVIDER override and the SMTP tier). This module previously kept its
// own copy of that logic, which silently drifted — the admin banner and the
// launch-checklist status reported a provider that was NOT the one sending mail.
// Required lazily because emailTransport requires this module at load time.
function providerName() {
  try {
    return require('./emailTransport.cjs').activeProvider();
  } catch {
    // Only reachable if the transport module fails to load; never block a health
    // report on it.
    return 'none';
  }
}

const mem = {
  state: 'unknown',
  lastError: null,
  lastFailedAt: null,
  lastSuccessAt: null,
  lastPersistedState: null,
  lastPersistAt: 0,
  deliveryPausedAt: null,
  deliveryPauseReason: null,
};

const DELIVERY_WINDOW_MS = 15 * 60 * 1000;
// A safety pause must not become a permanent outage: nothing can clear it
// automatically, because clearing it requires a successful send and the pause
// blocks every send. After the cooldown we let traffic through again; if the
// bounces/complaints are still happening the breaker trips straight back.
const DELIVERY_PAUSE_COOLDOWN_MS = 60 * 60 * 1000;
const recentSignals = [];

// Provider webhooks are at-least-once: Postmark, Resend and SNS all retry until
// they get a 2xx. Counting the same bounce three times would pause ALL platform
// mail from a single real bounce, so identical signals are only counted once.
const DELIVERY_SIGNAL_DEDUPE_MS = 60 * 60 * 1000;
const MAX_TRACKED_SIGNAL_KEYS = 5000;
const seenSignals = new Map();

function isDuplicateSignal(key) {
  if (!key) return false;
  const now = Date.now();
  for (const [seenKey, at] of seenSignals) {
    if (now - at <= DELIVERY_SIGNAL_DEDUPE_MS) break; // insertion-ordered: rest are fresh
    seenSignals.delete(seenKey);
  }
  if (seenSignals.has(key)) return true;
  seenSignals.set(key, now);
  // Bound memory even if a provider floods unique ids.
  while (seenSignals.size > MAX_TRACKED_SIGNAL_KEYS) {
    seenSignals.delete(seenSignals.keys().next().value);
  }
  return false;
}

function pauseExpired() {
  if (!mem.deliveryPausedAt) return false;
  const pausedAt = Date.parse(mem.deliveryPausedAt);
  return Number.isFinite(pausedAt) && Date.now() - pausedAt >= DELIVERY_PAUSE_COOLDOWN_MS;
}

function assertDeliveryAllowed() {
  if (mem.state !== 'delivery_paused') return;
  if (pauseExpired()) {
    console.warn('[EmailHealth] Delivery pause cooldown elapsed — allowing sends again (breaker will re-trip if bounces continue).');
    resumeDelivery('cooldown elapsed');
    return;
  }
  const error = new Error(`Email delivery is paused for safety: ${mem.deliveryPauseReason || 'recent delivery failures'}`);
  error.code = 'EMAIL_DELIVERY_PAUSED';
  error.noRetry = true;
  throw error;
}

// Explicit release, for the cooldown above or an operator clearing the banner.
function resumeDelivery(reason = 'manually resumed') {
  if (mem.state !== 'delivery_paused') return { resumed: false, state: mem.state };
  mem.state = 'unknown';
  mem.deliveryPausedAt = null;
  mem.deliveryPauseReason = null;
  recentSignals.length = 0;
  mem.lastPersistedState = mem.state;
  mem.lastPersistAt = Date.now();
  persist(mem.state, mem).catch((e) => console.warn('[EmailHealth] Could not persist delivery resume:', e.message));
  console.log(`[EmailHealth] Delivery pause cleared (${reason}).`);
  return { resumed: true, state: mem.state };
}

// The breaker state lives in memory, but sends happen in several processes
// (web, cron, the Twilio websocket server) and survive restarts. Without this,
// a pause was fail-OPEN everywhere except the one process that tripped it.
let hydration = null;
async function ensureHydrated() {
  if (hydration) return hydration;
  hydration = (async () => {
    const pool = getPoolSafe();
    if (!pool) return;
    try {
      const r = await pool.query(
        `SELECT data FROM generic_entities WHERE id = $1 AND entity_type = 'EmailProviderStatus' LIMIT 1`,
        [STATUS_ID],
      );
      if (!r.rows.length) return;
      const d = typeof r.rows[0].data === 'string' ? JSON.parse(r.rows[0].data) : r.rows[0].data;
      // Only ever ADOPT a pause here. Local state is newer than the row for any
      // other transition, so hydration must not un-pause this process.
      if (d.state === 'delivery_paused' && mem.state !== 'delivery_paused') {
        mem.state = 'delivery_paused';
        mem.deliveryPausedAt = d.delivery_paused_at || new Date().toISOString();
        mem.deliveryPauseReason = d.delivery_pause_reason || 'recent delivery failures';
        mem.lastError = d.last_error || mem.lastError;
        console.warn(`[EmailHealth] Adopted persisted delivery pause: ${mem.deliveryPauseReason}`);
      }
    } catch { /* never block a send on the hydration read */ }
  })();
  // Re-read on the next send rather than caching a single boot-time snapshot,
  // so a pause tripped in another process reaches this one.
  hydration.finally(() => { setTimeout(() => { hydration = null; }, 60 * 1000).unref?.(); });
  return hydration;
}

function reportDeliveryEvent({ event, provider, messageId, recipient, companyId } = {}) {
  const normalized = String(event || '').toLowerCase();
  if (!['bounce', 'complaint'].includes(normalized)) return { accepted: false };

  // Identify the underlying event, not the delivery attempt. Fall back to the
  // recipient when the provider gave us no message id, so a retried webhook for
  // the same person is still recognised.
  const identity = messageId || recipient;
  if (identity && isDuplicateSignal(`${provider || providerName()}|${normalized}|${identity}`)) {
    return { accepted: false, duplicate: true, paused: mem.state === 'delivery_paused' };
  }

  const now = Date.now();
  recentSignals.push({ event: normalized, at: now });
  while (recentSignals.length && now - recentSignals[0].at > DELIVERY_WINDOW_MS) recentSignals.shift();
  const bounces = recentSignals.filter((signal) => signal.event === 'bounce').length;
  const complaints = recentSignals.filter((signal) => signal.event === 'complaint').length;
  // A complaint is an immediate reputation emergency. Three hard bounces inside
  // fifteen minutes is also far outside normal transactional traffic.
  if (complaints >= 1 || bounces >= 3) {
    mem.state = 'delivery_paused';
    mem.deliveryPausedAt = new Date(now).toISOString();
    mem.deliveryPauseReason = complaints
      ? 'A provider complaint was received'
      : `${bounces} bounce events were received within 15 minutes`;
    mem.lastError = `${provider || providerName()}: ${mem.deliveryPauseReason}`;
    mem.lastFailedAt = mem.deliveryPausedAt;
    console.error(`[EmailHealth] ⛔ DELIVERY SAFETY PAUSE — ${mem.lastError}; message=${messageId || 'unknown'}, recipient=${recipient || 'unknown'}, company=${companyId || 'unknown'}`);
    persist(mem.state, mem).catch((e) => console.warn('[EmailHealth] Could not persist delivery pause:', e.message));
  }
  return { accepted: true, paused: mem.state === 'delivery_paused', bounces, complaints };
}

function getPoolSafe() {
  try { return require('../db/prod-db.cjs').getPool(); } catch { return null; }
}

// `status` is an HTTP status for API providers and an SMTP reply code for the
// SMTP transport. reportResult() re-checks this to decide whether to flip the
// marker, so SMTP codes must be recognised HERE — classifying only at the call
// site leaves the admin banner green while every send fails on bad credentials.
// 530/534/535 are not valid HTTP statuses, so there is no collision.
function isAuthFailure(status, message) {
  if (status === 401 || status === 403) return true;
  if (status === 530 || status === 534 || status === 535) return true;
  return /suspended|api key is invalid|invalid api key|restricted|username and password not accepted|authentication failed|invalid login|bad credentials/i
    .test(String(message || ''));
}

async function persist(state, detail) {
  const pool = getPoolSafe();
  if (!pool) return;
  const data = {
    provider: providerName(),
    state,
    last_error: detail.lastError || null,
    last_failed_at: detail.lastFailedAt || null,
    last_success_at: detail.lastSuccessAt || null,
    delivery_paused_at: detail.deliveryPausedAt || null,
    delivery_pause_reason: detail.deliveryPauseReason || null,
    updated_at: new Date().toISOString(),
  };
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, 'EmailProviderStatus', $2, $3, NOW(), NOW())
     ON CONFLICT (id, entity_type) DO UPDATE SET data = $3, updated_date = NOW()`,
    [STATUS_ID, MASTER_COMPANY, JSON.stringify(data)]
  );
}

function reportResult({ ok, status, message } = {}) {
  const now = new Date().toISOString();
  if (ok) {
    mem.lastSuccessAt = now;
    // A successful send says nothing about reputation, and sends already in
    // flight when the breaker trips will report success moments later. Letting
    // that clear the pause would reopen delivery immediately after a bounce or
    // complaint emergency — exactly the traffic the pause exists to stop.
    // Only the cooldown (assertDeliveryAllowed) or an explicit resume may clear it.
    if (mem.state === 'delivery_paused') return;
    if (mem.state === 'auth_failed') {
      console.log(`[EmailHealth] ✅ Email delivery RESTORED — ${providerName()} accepted a send again.`);
    }
    mem.state = 'ok';
  } else if (isAuthFailure(status, message)) {
    mem.state = 'auth_failed';
    mem.lastError = `${providerName()} HTTP ${status || '?'}: ${message || 'auth failure'}`;
    mem.lastFailedAt = now;
    console.error(
      `[EmailHealth] ⛔ EMAIL PROVIDER AUTH FAILURE (${mem.lastError}) — ALL app email is DOWN ` +
      `until the ${providerName()} credentials are fixed.`
    );
  } else {
    return; // transient — don't flip the marker
  }

  const stateChanged = mem.state !== mem.lastPersistedState;
  const stale = Date.now() - mem.lastPersistAt > PERSIST_DEBOUNCE_MS;
  if (!stateChanged && !stale) return;
  mem.lastPersistedState = mem.state;
  mem.lastPersistAt = Date.now();
  persist(mem.state, mem).catch((e) =>
    console.warn('[EmailHealth] Could not persist provider status:', e.message)
  );
}

// Legacy alias — callers in old code used reportResendResult
const reportResendResult = reportResult;

async function getEmailProviderStatusPublic() {
  const full = await getEmailProviderStatus();
  return { provider: providerName(), state: full.state };
}

async function getEmailProviderStatus() {
  if (mem.state !== 'unknown') {
    return { provider: providerName(), state: mem.state, last_error: mem.lastError, last_failed_at: mem.lastFailedAt, last_success_at: mem.lastSuccessAt };
  }
  const pool = getPoolSafe();
  if (pool) {
    try {
      const r = await pool.query(
        `SELECT data FROM generic_entities WHERE id = $1 AND entity_type = 'EmailProviderStatus' LIMIT 1`,
        [STATUS_ID]
      );
      if (r.rows.length > 0) {
        const d = typeof r.rows[0].data === 'string' ? JSON.parse(r.rows[0].data) : r.rows[0].data;
        if (d.provider && d.provider !== providerName()) {
          return { provider: providerName(), state: 'unknown', last_error: null, last_failed_at: null, last_success_at: null };
        }
        return { provider: providerName(), state: d.state || 'unknown', last_error: d.last_error || null, last_failed_at: d.last_failed_at || null, last_success_at: d.last_success_at || null };
      }
    } catch { /* fall through */ }
  }
  return { provider: providerName(), state: 'unknown', last_error: null, last_failed_at: null, last_success_at: null };
}

module.exports = {
  reportResult, reportResendResult, reportDeliveryEvent, assertDeliveryAllowed,
  ensureHydrated, resumeDelivery,
  getEmailProviderStatus, getEmailProviderStatusPublic, isAuthFailure,
};
