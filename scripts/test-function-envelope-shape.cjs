#!/usr/bin/env node
/**
 * Proves the contract that src/lib/functionResult.js depends on:
 *
 *   POST /api/functions/invoke  ->  { data: <handler payload> }
 *
 * The AI workspace ("Alex") crashed with
 *   "Cannot read properties of undefined (reading 'toFixed')"
 * because the page read stats straight off this envelope instead of off
 * `.data`, so every numeric field was undefined.
 *
 * Run from the workspace root:  node scripts/test-function-envelope-shape.cjs
 */
const crypto = require('crypto');
const { createPool } = require('./lib/db-pool.cjs');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:5000';
const SESSION_SECRET = process.env.SESSION_SECRET;

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function signSessionId(sid, secret) {
  const sig = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return 's:' + sid + '.' + sig;
}

(async () => {
  if (!SESSION_SECRET) {
    console.error('SESSION_SECRET is not set — cannot forge a session.');
    process.exit(1);
  }
  const pool = createPool({ connectionString: process.env.DATABASE_URL });
  let sid = null;

  try {
    // Pick a company that has an active staff member we can impersonate.
    const { rows } = await pool.query(
      `SELECT sp.email, sp.company_id
         FROM staff_profiles sp
        WHERE sp.email IS NOT NULL
          AND sp.company_id IS NOT NULL
          AND sp.is_active IS NOT FALSE
        ORDER BY sp.created_at DESC NULLS LAST
        LIMIT 1`
    );
    if (!rows.length) {
      console.error('No active staff profile found in the dev database — cannot run.');
      process.exit(1);
    }
    const { email, company_id } = rows[0];
    console.log(`Using company ${company_id} as ${email}\n`);

    // Forge a session. cookie.expires is REQUIRED: without it express-session
    // throws on touch and the whole request 500s before the handler runs.
    sid = crypto.randomUUID();
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    const sess = {
      cookie: {
        originalMaxAge: 3600000,
        expires: expires.toISOString(),
        httpOnly: true,
        path: '/',
      },
      passport: {
        user: {
          claims: { sub: email, email, full_name: 'Envelope Shape Test' },
          expires_at: Math.floor(expires.getTime() / 1000),
        },
      },
      company_id,
    };
    await pool.query(
      `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
      [sid, JSON.stringify(sess), expires]
    );
    const cookie = `connect.sid=${encodeURIComponent(signSessionId(sid, SESSION_SECRET))}`;

    const res = await fetch(`${BASE}/api/functions/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        functionName: 'getSarahPerformanceStats',
        params: { company_id, timezone: 'America/New_York' },
      }),
    });

    console.log('Envelope shape');
    check('request succeeds (HTTP 200)', res.status === 200, `got ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    check('response is JSON', ct.includes('application/json'), ct);

    const body = await res.json();

    check('envelope has no error', !body.error, body.error);
    check('payload is nested under .data', body.data && typeof body.data === 'object',
      JSON.stringify(body).slice(0, 200));

    console.log('\nThe crash that was fixed');
    check('reading avgCallDuration off the ENVELOPE is undefined (this caused the crash)',
      body.avgCallDuration === undefined, String(body.avgCallDuration));
    check('reading avgCallDuration through .data is a finite number',
      Number.isFinite(Number(body.data?.avgCallDuration)), String(body.data?.avgCallDuration));

    console.log('\nEvery stat the workspace renders');
    for (const field of ['totalCalls', 'inboundCalls', 'totalSMS', 'avgCallDuration', 'emergencies', 'aiHandled']) {
      check(`.data.${field} is numeric`, Number.isFinite(Number(body.data?.[field])),
        String(body.data?.[field]));
    }
    check('.data.comms is an array (drives the live conversations list)',
      Array.isArray(body.data?.comms), typeof body.data?.comms);

    console.log('\nRender safety');
    const avg = Number(body.data?.avgCallDuration);
    let threw = false;
    try { (Number.isFinite(avg) ? avg : 0).toFixed(1); } catch { threw = true; }
    check('the coerced value is safe to call .toFixed(1) on', !threw);
  } catch (err) {
    failed++;
    console.error('\nUnexpected failure:', err.message);
  } finally {
    if (sid) {
      await pool.query('DELETE FROM sessions WHERE sid = $1', [sid]).catch(() => {});
    }
    await pool.end().catch(() => {});
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
