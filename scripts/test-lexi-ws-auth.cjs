// Live smoke test: /ws/lexi-native session verification.
//
// The Lexi voice assistant WebSocket must identify the user from the signed
// login-session cookie (same as every HTTP route) instead of trusting the
// companyId/userEmail query parameters. This test drives real WebSocket
// connections against the running dev server and asserts:
//   1. a connection with no session cookie is closed (policy code 1008)
//   2. a valid session may connect for its own company
//   3. a valid session may NOT connect for an unrelated company
//   4. a valid session with no companyId falls back to its own company
//
// Test sessions are minted directly in the sessions table (same HMAC signing
// as db/local-auth.cjs) and cleaned up at the end.

const crypto = require('crypto');
const { createPool } = require('./lib/db-pool.cjs');
const WebSocket = require('ws');

const BASE = process.env.TEST_BASE_WS || 'ws://localhost:5000';
const EMAIL = process.env.TEST_USER_EMAIL || 'stonekevin866@gmail.com';
const OWN_COMPANY = process.env.TEST_COMPANY_ID || 'loc_mmdvp1h5_e8i9eb';

function signSessionId(sid, secret) {
  const sig = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return 's:' + sid + '.' + sig;
}

async function main() {
  const pool = createPool({ connectionString: process.env.DATABASE_URL });

  // Find a company this user has no membership in (for the isolation check).
  const other = await pool.query(
    `SELECT id FROM companies WHERE id <> $1
       AND created_by IS DISTINCT FROM $2
       AND id NOT IN (SELECT company_id FROM staff_profiles WHERE (email=$2 OR user_email=$2) AND company_id IS NOT NULL)
     LIMIT 1`, [OWN_COMPANY, EMAIL]);
  const OTHER_COMPANY = other.rows[0]?.id;
  if (!OTHER_COMPANY) console.log('NOTE: no unrelated company found; isolation check will be skipped');

  // Mint a real session row, signed the same way local-auth does.
  const sid = 'testsid_' + crypto.randomBytes(12).toString('hex');
  const sess = { cookie: { originalMaxAge: 604800000, httpOnly: true, path: '/' }, passport: { user: { claims: { email: EMAIL } } } };
  await pool.query(`INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`, [sid, JSON.stringify(sess)]);
  const cookie = 'connect.sid=' + encodeURIComponent(signSessionId(sid, process.env.SESSION_SECRET));

  function tryConnect(label, companyId, useCookie, expectClosed) {
    return new Promise((resolve) => {
      const url = `${BASE}/ws/lexi-native?companyId=${encodeURIComponent(companyId)}&userEmail=${encodeURIComponent('someone.else@example.com')}&userName=Test`;
      const ws = new WebSocket(url, { headers: useCookie ? { Cookie: cookie } : {} });
      let closedByPolicy = false;
      setTimeout(() => {
        ws.terminate();
        const pass = expectClosed ? closedByPolicy : !closedByPolicy;
        console.log(`${pass ? 'PASS' : 'FAIL'} - ${label} (closedByPolicy=${closedByPolicy})`);
        resolve(pass);
      }, 8000);
      ws.on('close', (code) => { if (code === 1008) closedByPolicy = true; });
      ws.on('error', () => {});
    });
  }

  let allPass = true;
  allPass = (await tryConnect('no session cookie -> connection closed', OWN_COMPANY, false, true)) && allPass;
  allPass = (await tryConnect('valid session + own company -> allowed', OWN_COMPANY, true, false)) && allPass;
  if (OTHER_COMPANY) {
    allPass = (await tryConnect('valid session + unrelated company -> connection closed', OTHER_COMPANY, true, true)) && allPass;
  }
  allPass = (await tryConnect('valid session + no companyId -> allowed (own company fallback)', '', true, false)) && allPass;

  await pool.query('DELETE FROM sessions WHERE sid = $1', [sid]);
  await pool.end();
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  process.exit(allPass ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
