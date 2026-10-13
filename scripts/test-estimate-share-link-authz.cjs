#!/usr/bin/env node
'use strict';

/**
 * getEstimateShareLink authorization.
 *
 * This handler used to refuse outright whenever NODE_ENV was production,
 * because it signed a public estimate URL for ANY caller. That made texting or
 * emailing an estimate produce a message with no working link in the live app.
 * It now authorizes the caller against the estimate's own company, so it can
 * run everywhere — these checks are what make that safe:
 *
 *   1. no session            -> refused
 *   2. staff of the estimate's company -> signed URL with a token
 *   3. staff of a DIFFERENT company    -> refused (no token leaked)
 *   4. unknown estimate id             -> refused
 *
 * Run: node scripts/test-estimate-share-link-authz.cjs
 */

const crypto = require('crypto');
const { createPool } = require('./lib/db-pool.cjs');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';
const pool = createPool({ connectionString: process.env.DATABASE_URL });

const SUFFIX = crypto.randomBytes(4).toString('hex');
const COMPANY_A = `esl_a_${SUFFIX}`;
const COMPANY_B = `esl_b_${SUFFIX}`;
const ESTIMATE_ID = `esl_est_${SUFFIX}`;
const OWNER_A = { uid: `esl_ua_${SUFFIX}`, email: `esl-a-${SUFFIX}@example.com`, sid: `esl_sa_${SUFFIX}` };
const OWNER_B = { uid: `esl_ub_${SUFFIX}`, email: `esl-b-${SUFFIX}@example.com`, sid: `esl_sb_${SUFFIX}` };

let passed = 0;
let failed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log(`  \u2713 ${label}`); }
  else { failed++; console.log(`  \u2717 ${label}${detail ? ` — ${detail}` : ''}`); }
}

function forgeSessionCookie(sid) {
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}

async function seedSession({ uid, email, sid }) {
  await pool.query(
    `INSERT INTO users (id, email, first_name, created_at, updated_at)
     VALUES ($1, $2, 'ShareLinkSmoke', NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET email = $2`,
    [uid, email]
  );
  // express-session inflates every stored session and reads sess.cookie.expires,
  // so a session row without a `cookie` block 500s the whole request before the
  // handler is ever reached.
  const expires = new Date(Date.now() + 3600000);
  const sess = {
    cookie: { originalMaxAge: 3600000, expires: expires.toISOString(), httpOnly: true, path: '/' },
    passport: { user: { claims: { email } } },
  };
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = $2::jsonb, expire = $3`,
    [sid, JSON.stringify(sess), expires]
  );
  return forgeSessionCookie(sid);
}

async function invoke(params, cookie) {
  const res = await fetch(`${BASE_URL}/api/functions/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ functionName: 'getEstimateShareLink', params }),
  });
  const json = await res.json().catch(() => ({}));
  return json?.data ?? json;
}

async function setup() {
  for (const [id, name] of [[COMPANY_A, 'Share Link Co A'], [COMPANY_B, 'Share Link Co B']]) {
    await pool.query(
      `INSERT INTO companies (id, company_name, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
      [id, name]
    );
  }
  for (const [owner, companyId] of [[OWNER_A, COMPANY_A], [OWNER_B, COMPANY_B]]) {
    await pool.query(
      `INSERT INTO staff_profiles (id, company_id, user_email, is_administrator)
       VALUES ($1, $2, $3, true) ON CONFLICT (id) DO NOTHING`,
      [`sp_${owner.uid}`, companyId, owner.email]
    );
  }
  await pool.query(
    `INSERT INTO estimates (id, company_id, customer_name, estimate_number, created_at)
     VALUES ($1, $2, 'Share Link Customer', 'EST-SHARELINK', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ESTIMATE_ID, COMPANY_A]
  );
}

async function cleanup() {
  await pool.query('DELETE FROM estimates WHERE id = $1', [ESTIMATE_ID]);
  await pool.query('DELETE FROM staff_profiles WHERE company_id IN ($1, $2)', [COMPANY_A, COMPANY_B]);
  await pool.query('DELETE FROM companies WHERE id IN ($1, $2)', [COMPANY_A, COMPANY_B]);
  await pool.query('DELETE FROM sessions WHERE sid IN ($1, $2)', [OWNER_A.sid, OWNER_B.sid]);
  await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [OWNER_A.uid, OWNER_B.uid]);
}

(async () => {
  if (!process.env.SESSION_SECRET) {
    console.error('[share-link] SESSION_SECRET is not set — cannot forge a session. Aborting.');
    process.exit(1);
  }

  console.log('\n=== getEstimateShareLink authorization ===\n');
  try {
    await cleanup();
    await setup();
    const cookieA = await seedSession(OWNER_A);
    const cookieB = await seedSession(OWNER_B);

    console.log('[1] No session at all');
    const anon = await invoke({ id: ESTIMATE_ID });
    check('unauthenticated caller is refused', !!anon?.error, JSON.stringify(anon));
    check('unauthenticated caller gets no token', !anon?.token && !anon?.url);

    console.log('\n[2] Staff of the estimate\'s own company');
    const own = await invoke({ id: ESTIMATE_ID }, cookieA);
    check('own-company caller gets a URL', !!own?.url, JSON.stringify(own));
    check('own-company caller gets a token', !!own?.token);
    check('URL points at ViewEstimate with the id', String(own?.url || '').includes(`/ViewEstimate?id=${ESTIMATE_ID}`));
    check('URL carries the signing token', String(own?.url || '').includes(`t=${own?.token}`));

    console.log('\n[3] Staff of a DIFFERENT company');
    const other = await invoke({ id: ESTIMATE_ID }, cookieB);
    check('cross-company caller is refused', other?.error === 'Forbidden', JSON.stringify(other));
    check('cross-company caller gets no token', !other?.token);
    check('cross-company caller gets no URL', !other?.url);

    console.log('\n[4] Unknown estimate id');
    const missing = await invoke({ id: `no_such_estimate_${SUFFIX}` }, cookieA);
    check('unknown estimate is refused', !!missing?.error, JSON.stringify(missing));
    check('unknown estimate leaks no token', !missing?.token);

    console.log('\n[5] Missing id');
    const noId = await invoke({}, cookieA);
    check('missing id is refused', !!noId?.error, JSON.stringify(noId));
  } catch (err) {
    failed++;
    console.error('\nFatal:', err.message);
  } finally {
    await cleanup().catch(() => {});
    await pool.end().catch(() => {});
  }

  console.log(`\n[share-link] ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
