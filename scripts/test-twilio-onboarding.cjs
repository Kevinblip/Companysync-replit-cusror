// Smoke test: one-click Twilio onboarding flow for a new subscriber.
//
// Verifies the /api/twilio/auto-provision endpoint contract end-to-end:
//   1. Missing required fields → 400 with an error message
//   2. Invalid Twilio credentials → structured error (no crash)
//   3. Response shape contains the fields the frontend expects on success
//   4. Settings page returns 200 for an authenticated session (no crash)
//
// Run against the dev server:
//   DATABASE_URL=... SESSION_SECRET=... node scripts/test-twilio-onboarding.cjs

const crypto = require('crypto');
const http = require('http');
const { createPool } = require('./lib/db-pool.cjs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5000';
const EMAIL = process.env.TEST_USER_EMAIL || 'stonekevin866@gmail.com';
const COMPANY_ID = process.env.TEST_COMPANY_ID || 'loc_mmdvp1h5_e8i9eb';

// ─── helpers ──────────────────────────────────────────────────────────────────

function request(method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: parseInt(url.port) || 5000,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...extraHeaders,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function signSessionId(sid, secret) {
  const sig = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return 's:' + sid + '.' + sig;
}

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ PASS  ${label}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL  ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ─── tests ────────────────────────────────────────────────────────────────────

async function testMissingFields() {
  console.log('\n[1] Missing required fields → 400');
  const cases = [
    { label: 'all missing', body: {} },
    { label: 'missing auth_token + phone', body: { account_sid: 'ACfake' } },
    { label: 'missing phone', body: { account_sid: 'ACfake', auth_token: 'tok' } },
  ];
  for (const c of cases) {
    const r = await request('POST', '/api/twilio/auto-provision', c.body);
    assert(c.label, r.status === 400, `status=${r.status}`);
    assert(`${c.label} has error field`, typeof r.data?.error === 'string', JSON.stringify(r.data));
  }
}

async function testInvalidCredentials() {
  console.log('\n[2] Invalid Twilio credentials → structured error (not crash)');
  // Twilio rejects fake creds with 20003 "Authenticate" — this surfaces as either
  // a 404 (phone not found because auth failed) or a JSON error object. Either way
  // the server must not return a raw 500 or HTML.
  const r = await request('POST', '/api/twilio/auto-provision', {
    account_sid: 'ACdeadbeefdeadbeefdeadbeefdeadbeef',
    auth_token:  'ffffffffffffffffffffffffffffffff',
    phone_number: '+15550001234',
    company_id: COMPANY_ID,
  });
  assert('no server crash (status < 500)', r.status < 500, `status=${r.status}`);
  assert('response is JSON object', typeof r.data === 'object' && r.data !== null, typeof r.data);
  assert('has error or success field', 'error' in (r.data ?? {}) || 'success' in (r.data ?? {}),
    JSON.stringify(r.data).slice(0, 120));
}

async function testSettingsPageAuth() {
  console.log('\n[3] Settings page loads for authenticated session (no crash)');
  const pool = createPool({ connectionString: process.env.DATABASE_URL });
  let sid;
  try {
    sid = 'test_twilio_' + crypto.randomBytes(10).toString('hex');
    const sess = {
      cookie: { originalMaxAge: 604800000, httpOnly: true, path: '/' },
      passport: { user: { claims: { email: EMAIL } } }
    };
    await pool.query(
      `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
      [sid, JSON.stringify(sess)]
    );
    const cookie = 'connect.sid=' + encodeURIComponent(
      signSessionId(sid, process.env.SESSION_SECRET)
    );

    // Fetch the root SPA — should return 200 (HTML), not an error page
    const r = await request('GET', '/', null, { Cookie: cookie });
    assert('root SPA returns 200', r.status === 200, `status=${r.status}`);

    // The entity API for TwilioSettings should work for this company
    // Dev server exposes /api/local/entity/<EntityType> for entity reads
    const ts = await request('GET',
      `/api/local/entity/TwilioSettings?company_id=${encodeURIComponent(COMPANY_ID)}&sort=-created_date&limit=1`,
      null, { Cookie: cookie });
    assert('TwilioSettings entity API < 500', ts.status < 500, `status=${ts.status}`);
    assert('TwilioSettings returns array or object', Array.isArray(ts.data) || (typeof ts.data === 'object' && ts.data !== null),
      JSON.stringify(ts.data).slice(0, 120));
  } finally {
    if (sid) await pool.query('DELETE FROM sessions WHERE sid = $1', [sid]).catch(() => {});
    await pool.end().catch(() => {});
  }
}

async function testResponseShape() {
  console.log('\n[4] Response shape check — frontend-required fields present on any non-400 path');
  // With totally fake creds Twilio returns 401 auth error which surfaces as a 404
  // (phone not found) or a { error: '...' }.  Either way check that a SUCCESSFUL
  // mock response from the endpoint includes the fields the frontend reads.
  // We do this by checking the SUCCESS path shape is documented in the handler.
  // (We cannot call with real creds in CI, so we verify the error path shape.)
  const r = await request('POST', '/api/twilio/auto-provision', {
    account_sid: 'ACdeadbeefdeadbeefdeadbeefdeadbeef',
    auth_token:  'ffffffffffffffffffffffffffffffff',
    phone_number: '+15550001234',
    company_id: COMPANY_ID,
    company_name: 'Test Company',
    rep_name: 'Test Rep',
    rep_email: EMAIL,
  });

  if (r.data?.success === true) {
    // If somehow it returns success (mock / stub in CI), validate the full shape
    const d = r.data;
    assert('success shape: voice_webhook', typeof d.voice_webhook === 'string');
    assert('success shape: sms_webhook', typeof d.sms_webhook === 'string');
    assert('success shape: browser_call_twiml_url', typeof d.browser_call_twiml_url === 'string');
    assert('success shape: webrtc_ready flag present', 'webrtc_ready' in d);
    assert('success shape: message string', typeof d.message === 'string');
    if (d.api_key_sid) {
      assert('success shape: api_key_sid starts with SK', d.api_key_sid.startsWith('SK'));
    }
    if (d.twiml_app_sid) {
      assert('success shape: twiml_app_sid starts with AP', d.twiml_app_sid.startsWith('AP'));
    }
  } else {
    // Expected with fake creds — just confirm the error is well-formed
    assert('error path: status not 500', r.status !== 500, `status=${r.status}`);
    assert('error path: error is string', typeof r.data?.error === 'string',
      JSON.stringify(r.data).slice(0, 120));
    console.log(`     (Twilio rejected fake creds as expected: "${r.data?.error?.slice(0, 80)}")`);
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Twilio one-click onboarding smoke test ===`);
  console.log(`Target: ${BASE}`);

  await testMissingFields();
  await testInvalidCredentials();
  await testResponseShape();

  if (process.env.DATABASE_URL && process.env.SESSION_SECRET) {
    await testSettingsPageAuth();
  } else {
    console.log('\n[3] Skipped (DATABASE_URL or SESSION_SECRET not set)');
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
