'use strict';

const crypto = require('crypto');

function unsubscribeSecret(env = process.env) {
  return env.SESSION_SECRET || '';
}

function signUnsubscribe(email, env = process.env) {
  const secret = unsubscribeSecret(env);
  const normalized = String(email || '').trim().toLowerCase();
  if (!secret || !normalized) return '';
  return crypto.createHmac('sha256', secret).update(`unsubscribe:${normalized}`).digest('base64url');
}

function unsubscribeUrl(appUrl, email, env = process.env) {
  const token = signUnsubscribe(email, env);
  const normalized = String(email || '').trim().toLowerCase();
  if (!token) return '';
  const base = String(appUrl || '').replace(/\/+$/, '');
  return `${base}/api/email/unsubscribe?e=${encodeURIComponent(normalized)}&t=${encodeURIComponent(token)}`;
}

function verifyUnsubscribe(email, token, env = process.env) {
  const expected = signUnsubscribe(email, env);
  const given = String(token || '');
  if (!expected || given.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  } catch {
    return false;
  }
}

function stampUnsubscribeLink(html, appUrl, email, env = process.env) {
  const url = unsubscribeUrl(appUrl, email, env);
  const source = String(html || '');
  if (!source.includes('{{UNSUBSCRIBE_URL}}')) return source;
  if (!url) return source.replace(/<p[^>]*>\s*\{\{UNSUBSCRIBE_URL\}\}\s*<\/p>/g, '');
  return source.replaceAll('{{UNSUBSCRIBE_URL}}', url);
}

let schemaReady = null;
async function ensureSchema(pool) {
  if (require('./stagingSideEffects.cjs').sideEffectsDisabled()) return;
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS email_unsubscribes (
        email TEXT PRIMARY KEY,
        scope TEXT NOT NULL DEFAULT 'marketing',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function recordUnsubscribe(pool, email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  await ensureSchema(pool);
  await pool.query(
    `INSERT INTO email_unsubscribes (email, scope, created_at)
     VALUES ($1, 'marketing', NOW())
     ON CONFLICT (email) DO NOTHING`,
    [normalized],
  );
  return true;
}

async function isUnsubscribed(pool, email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  try {
    await ensureSchema(pool);
    const { rows } = await pool.query(
      'SELECT 1 FROM email_unsubscribes WHERE email = $1 LIMIT 1',
      [normalized],
    );
    return rows.length > 0;
  } catch (err) {
    console.warn('[email-unsubscribe] lookup failed:', err.message);
    return false;
  }
}

function unsubscribePage(ok) {
  const title = ok ? 'You are unsubscribed' : 'This unsubscribe link is not valid';
  const body = ok
    ? 'You will no longer receive CompanySync trial or marketing emails.'
    : 'Request a fresh message if you still want to unsubscribe.';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:Arial,sans-serif;max-width:560px;margin:48px auto;color:#1f2937"><h1>${title}</h1><p>${body}</p></body></html>`;
}

async function handleUnsubscribeRequest(req, res, pool) {
  const url = new URL(req.url, 'http://localhost');
  const email = url.searchParams.get('e');
  const token = url.searchParams.get('t');
  const ok = verifyUnsubscribe(email, token);
  if (ok) await recordUnsubscribe(pool, email);
  const html = unsubscribePage(ok);
  res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

module.exports = {
  signUnsubscribe,
  unsubscribeUrl,
  verifyUnsubscribe,
  stampUnsubscribeLink,
  recordUnsubscribe,
  isUnsubscribed,
  handleUnsubscribeRequest,
};
