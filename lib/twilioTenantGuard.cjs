const crypto = require('crypto');

function parseCookies(header) {
  const cookies = {};
  String(header || '').split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    const raw = part.slice(idx + 1).trim();
    try { cookies[key] = decodeURIComponent(raw); } catch { cookies[key] = raw; }
  });
  return cookies;
}

function unsignSessionCookie(value, secret) {
  if (!value || !secret || !value.startsWith('s:')) return null;
  const signed = value.slice(2);
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  const sid = signed.slice(0, dot);
  const actual = signed.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  if (actual.length !== expected.length) return null;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected)) ? sid : null;
}

function isProtectedCompany(company) {
  const id = String(company?.id || company?.company_id || '').toLowerCase();
  const name = String(company?.company_name || company?.name || '').toLowerCase();
  return id === 'companysync_master_001' ||
    name.includes('yicn') ||
    name.includes('insurance claims network');
}

async function sessionEmail(req, pool) {
  const secret = process.env.SESSION_SECRET;
  const sid = unsignSessionCookie(parseCookies(req?.headers?.cookie)['connect.sid'], secret);
  if (!sid) return '';
  const result = await pool.query('SELECT sess FROM sessions WHERE sid = $1 AND expire > NOW()', [sid]);
  if (!result.rows[0]) return '';
  const sess = typeof result.rows[0].sess === 'string'
    ? JSON.parse(result.rows[0].sess)
    : result.rows[0].sess;
  const user = sess?.passport?.user || sess?.user;
  return String(user?.claims?.email || user?.email || '').trim().toLowerCase();
}

async function authorizeTwilioTenant({ req, pool, companyId, bridgeSecret = '' }) {
  if (!companyId) {
    const error = new Error('company_id is required');
    error.statusCode = 400;
    throw error;
  }

  const suppliedBridgeSecret = String(req?.headers?.['x-bridge-secret'] || '');
  const trustedInternal = !!bridgeSecret && suppliedBridgeSecret === bridgeSecret;
  const email = trustedInternal ? '' : await sessionEmail(req, pool);
  if (!trustedInternal && !email) {
    const error = new Error('Not authenticated');
    error.statusCode = 401;
    throw error;
  }

  if (!trustedInternal) {
    const membership = await pool.query(
      `SELECT 1 FROM staff_profiles
       WHERE company_id = $1 AND LOWER(user_email) = $2 AND is_active = true
       LIMIT 1`,
      [companyId, email]
    );
    if (!membership.rows[0]) {
      const error = new Error('Not authorized for this company');
      error.statusCode = 403;
      throw error;
    }
  }

  const companyResult = await pool.query(
    'SELECT id, company_name FROM companies WHERE id = $1 LIMIT 1',
    [companyId]
  );
  const company = companyResult.rows[0];
  if (!company) {
    const error = new Error('Company not found');
    error.statusCode = 404;
    throw error;
  }
  if (isProtectedCompany(company)) {
    const error = new Error('Twilio settings for this protected company cannot be changed here');
    error.statusCode = 403;
    throw error;
  }
  return { company, email, trustedInternal };
}

async function assertTwilioIdentityAvailable({ pool, companyId, accountSid, phoneNumber }) {
  const sid = String(accountSid || '').trim();
  if (sid) {
    const duplicateSid = await pool.query(
      `SELECT company_id FROM generic_entities
       WHERE entity_type = 'TwilioSettings'
         AND company_id <> $1
         AND UPPER(COALESCE(data->>'account_sid', '')) = UPPER($2)
       LIMIT 1`,
      [companyId, sid]
    );
    if (duplicateSid.rows[0]) {
      const error = new Error('This Twilio Account SID is already assigned to another company');
      error.statusCode = 409;
      throw error;
    }
  }

  const phone = String(phoneNumber || '').replace(/[^\d+]/g, '');
  if (phone) {
    const duplicatePhone = await pool.query(
      `SELECT company_id FROM generic_entities
       WHERE entity_type = 'TwilioSettings'
         AND company_id <> $1
         AND REGEXP_REPLACE(COALESCE(data->>'main_phone_number', ''), '[^0-9]', '', 'g')
             = REGEXP_REPLACE($2, '[^0-9]', '', 'g')
       LIMIT 1`,
      [companyId, phone]
    );
    if (duplicatePhone.rows[0]) {
      const error = new Error('This Twilio phone number is already assigned to another company');
      error.statusCode = 409;
      throw error;
    }
  }
}

module.exports = {
  authorizeTwilioTenant,
  assertTwilioIdentityAvailable,
  isProtectedCompany,
};