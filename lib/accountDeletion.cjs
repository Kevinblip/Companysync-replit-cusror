'use strict';

const { checkRateLimit, getClientIp } = require('./rateLimit.cjs');

const PROTECTED_COMPANY_IDS = new Set(['companysync_master_001']);

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function planAccountDeletion({ sessionEmail, confirmation, isImpersonating } = {}) {
  const email = normalizeEmail(sessionEmail);
  if (isImpersonating) {
    return { ok: false, status: 403, error: 'Account deletion is not available while impersonating.' };
  }
  if (!email) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }
  const typed = normalizeEmail(confirmation);
  if (!typed || typed !== email) {
    return { ok: false, status: 400, error: 'Type your account email to confirm deletion.' };
  }
  return { ok: true, email };
}

function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 100000) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function executeAccountDeletion(pool, { sessionEmail, confirmation, isImpersonating } = {}) {
  const plan = planAccountDeletion({ sessionEmail, confirmation, isImpersonating });
  if (!plan.ok) return plan;

  const email = plan.email;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query(
      'SELECT id, email, company_id FROM users WHERE LOWER(BTRIM(email)) = $1',
      [email]
    );
    const staffResult = await client.query(
      `SELECT id, company_id FROM staff_profiles
       WHERE LOWER(BTRIM(user_email)) = $1
          OR (user_email IS NULL AND LOWER(BTRIM(email)) = $1)`,
      [email]
    );
    if (userResult.rows.length === 0 && staffResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'Account not found' };
    }

    const ownedResult = await client.query(
      `SELECT id FROM companies
       WHERE LOWER(BTRIM(created_by)) = $1
         AND (is_deleted IS NULL OR is_deleted = false)`,
      [email]
    );

    await client.query(
      `DELETE FROM staff_profiles
       WHERE LOWER(BTRIM(user_email)) = $1
          OR (user_email IS NULL AND LOWER(BTRIM(email)) = $1)`,
      [email]
    );

    const closedTenants = [];
    for (const row of ownedResult.rows) {
      const companyId = row.id;
      if (!companyId || PROTECTED_COMPANY_IDS.has(String(companyId))) continue;
      const remaining = await client.query(
        `SELECT COUNT(*)::int AS n FROM staff_profiles
         WHERE company_id = $1 AND COALESCE(is_active, true) = true`,
        [companyId]
      );
      if (Number(remaining.rows[0]?.n || 0) > 0) continue;
      const closed = await client.query(
        `UPDATE companies SET is_deleted = true, updated_at = NOW()
         WHERE id = $1 AND LOWER(BTRIM(created_by)) = $2`,
        [companyId, email]
      );
      if (closed.rowCount > 0) closedTenants.push(companyId);
    }

    await client.query(
      `DELETE FROM sessions WHERE LOWER(sess #>> '{passport,user,claims,email}') = $1`,
      [email]
    );
    await client.query('DELETE FROM password_reset_tokens WHERE LOWER(BTRIM(email)) = $1', [email]);
    await client.query('DELETE FROM pending_signups WHERE LOWER(BTRIM(email)) = $1', [email]);
    await client.query('DELETE FROM users WHERE LOWER(BTRIM(email)) = $1', [email]);
    await client.query('COMMIT');

    return {
      ok: true,
      status: 200,
      body: {
        success: true,
        account_deleted: true,
        closed_own_tenant: closedTenants.length > 0,
      },
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already aborted */ }
    console.error('[accountDeletion] Failed:', err.message);
    return { ok: false, status: 500, error: 'Could not delete the account. Please try again.' };
  } finally {
    client.release();
  }
}

async function handleDeleteOwnAccount(req, res, { pool, sessionEmail, isImpersonating }) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const limit = checkRateLimit(`account-delete:${normalizeEmail(sessionEmail) || getClientIp(req)}`, {
    max: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.allowed) {
    sendJson(res, 429, { error: 'Too many attempts. Please try again later.' });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid request' });
    return;
  }
  const result = await executeAccountDeletion(pool, {
    sessionEmail,
    confirmation: body.confirmation,
    isImpersonating,
  });
  if (!result.ok) {
    sendJson(res, result.status, { error: result.error });
    return;
  }
  sendJson(res, 200, result.body);
}

async function handleAppLogout(req, res, { pool, getSession, destroySession }) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  try {
    const session = await getSession(req, pool);
    if (session?.sid && destroySession) await destroySession(pool, session.sid);
  } catch (err) {
    console.error('[logout-app] Session cleanup failed:', err.message);
  }
  const clearCookie = 'connect.sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax';
  res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': clearCookie });
  res.end(JSON.stringify({ success: true }));
}

module.exports = {
  PROTECTED_COMPANY_IDS,
  normalizeEmail,
  planAccountDeletion,
  executeAccountDeletion,
  handleDeleteOwnAccount,
  handleAppLogout,
};
