// Session verification for the Lexi native voice WebSocket (/ws/lexi-native).
//
// The browser client passes companyId/userEmail as query params for display
// purposes, but the server must NOT trust them: the connection grants access
// to company CRM data (tool calls) and attributes billed AI minutes to the
// company. This module resolves the real user from the same signed
// `connect.sid` session cookie used by every HTTP route (the browser sends
// cookies on same-origin WebSocket upgrades automatically), then confirms the
// requested company is one the user actually belongs to.
//
// Shared by BOTH the dev plugin (vite-lexi-native-plugin.js) and
// prod-server.cjs — fix things here once, do not mirror.

const crypto = require('crypto');

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const idx = c.indexOf('=');
    if (idx > 0) {
      const key = c.slice(0, idx).trim();
      const val = c.slice(idx + 1).trim();
      try { cookies[key] = decodeURIComponent(val); } catch { cookies[key] = val; }
    }
  });
  return cookies;
}

function unsignCookie(signedValue, secret) {
  if (!signedValue || !signedValue.startsWith('s:')) return null;
  const val = signedValue.slice(2);
  const dotIndex = val.lastIndexOf('.');
  if (dotIndex === -1) return null;
  const sid = val.slice(0, dotIndex);
  const sig = val.slice(dotIndex + 1);
  const expected = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) return sid;
  return null;
}

/**
 * Verify the session cookie on a WebSocket upgrade request and resolve which
 * company the connection may act as.
 *
 * @param {http.IncomingMessage} req  the upgrade request
 * @param {string} requestedCompanyId companyId query param from the client ('' if absent)
 * @param {pg.Pool} pool              database pool
 * @returns {Promise<{ok:true, email:string, companyId:string, isSuperAdmin:boolean}
 *                  |{ok:false, reason:string}>}
 */
async function authenticateLexiWs(req, requestedCompanyId, pool) {
  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!SESSION_SECRET) return { ok: false, reason: 'server session secret not configured' };

  const cookies = parseCookies(req.headers && req.headers.cookie);
  const signedSid = cookies['connect.sid'];
  if (!signedSid) return { ok: false, reason: 'no session cookie' };

  const sid = unsignCookie(signedSid, SESSION_SECRET);
  if (!sid) return { ok: false, reason: 'invalid session cookie' };

  let email = null;
  try {
    const result = await pool.query('SELECT sess FROM sessions WHERE sid = $1 AND expire > NOW()', [sid]);
    if (result.rows.length === 0) return { ok: false, reason: 'session expired' };
    const sess = typeof result.rows[0].sess === 'string' ? JSON.parse(result.rows[0].sess) : result.rows[0].sess;
    email = sess?.passport?.user?.claims?.email || null;
  } catch (e) {
    return { ok: false, reason: `session lookup failed: ${e.message}` };
  }
  if (!email) return { ok: false, reason: 'session has no user' };

  try {
    // All companies this user belongs to (multi-location users have several
    // staff_profiles rows; users.company_id is the primary/last-used one).
    const staffRes = await pool.query(
      'SELECT company_id, is_super_admin FROM staff_profiles WHERE (email = $1 OR user_email = $1)',
      [email]
    );
    const userRes = await pool.query('SELECT company_id, platform_role FROM users WHERE email = $1', [email]);
    const userRow = userRes.rows[0];

    const memberCompanies = new Set();
    for (const row of staffRes.rows) {
      if (row.company_id) memberCompanies.add(String(row.company_id));
    }
    if (userRow?.company_id) memberCompanies.add(String(userRow.company_id));

    const isSuperAdmin =
      userRow?.platform_role === 'super_admin' ||
      staffRes.rows.some(r => r.is_super_admin === true) ||
      memberCompanies.has('companysync_master_001');

    let companyId = requestedCompanyId ? String(requestedCompanyId) : '';
    if (companyId) {
      if (!isSuperAdmin && !memberCompanies.has(companyId)) {
        // Brand-new owner during onboarding: company exists but the staff
        // profile may not yet — created_by is the ownership root.
        const own = await pool.query(
          'SELECT 1 FROM companies WHERE id = $1 AND created_by = $2 LIMIT 1',
          [companyId, email]
        );
        if (own.rows.length === 0) {
          return { ok: false, reason: 'company access denied' };
        }
      }
    } else {
      // No company requested: fall back to the user's primary company.
      companyId = (userRow?.company_id && String(userRow.company_id)) ||
        (staffRes.rows[0]?.company_id && String(staffRes.rows[0].company_id)) || '';
      if (!companyId) return { ok: false, reason: 'no company membership' };
    }

    return { ok: true, email, companyId, isSuperAdmin };
  } catch (e) {
    return { ok: false, reason: `membership lookup failed: ${e.message}` };
  }
}

module.exports = { authenticateLexiWs, parseCookies, unsignCookie };
