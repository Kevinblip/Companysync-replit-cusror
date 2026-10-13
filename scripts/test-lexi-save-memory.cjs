// Live e2e test: Lexi auto-saves personal preferences via the save_memory tool.
//
// Forges a real login session (same HMAC signing as db/local-auth.cjs), sends
// a preference statement through /api/functions/invoke → lexiChat, and asserts
// that a new AIMemory row appears scoped to the test user's email.
// Cleans up the session row and the created memory at the end.

const crypto = require('crypto');
const { createPool } = require('./lib/db-pool.cjs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5000';
const EMAIL = process.env.TEST_USER_EMAIL || 'stonekevin866@gmail.com';
const COMPANY = process.env.TEST_COMPANY_ID || 'loc_mmdvp1h5_e8i9eb';

function signSessionId(sid, secret) {
  const sig = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return 's:' + sid + '.' + sig;
}

async function main() {
  const pool = createPool({ connectionString: process.env.DATABASE_URL });

  // Unique marker so we can find (and clean up) exactly the row this run creates
  const marker = 'testpref_' + crypto.randomBytes(4).toString('hex');

  const sid = 'testsid_' + crypto.randomBytes(12).toString('hex');
  const sess = { cookie: { originalMaxAge: 604800000, httpOnly: true, path: '/' }, passport: { user: { claims: { email: EMAIL } } } };
  await pool.query(`INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`, [sid, JSON.stringify(sess)]);
  const cookie = 'connect.sid=' + encodeURIComponent(signSessionId(sid, process.env.SESSION_SECRET));

  let pass = false;
  let memId = null;
  try {
    const resp = await fetch(`${BASE}/api/functions/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        functionName: 'lexiChat',
        params: {
          message: `Please remember this preference of mine: my waste factor code word is ${marker} — I always add 15% waste to shingle orders.`,
          companyId: COMPANY,
          // Deliberately forged — the server must ignore this and use the
          // session email, so the memory can't be planted on a teammate.
          userEmail: 'someone.else@example.com',
          userName: 'Test User',
          conversationHistory: []
        }
      })
    });
    const body = await resp.json().catch(() => ({}));
    const actions = body?.data?.actions_executed || body?.actions_executed || [];
    console.log('HTTP', resp.status, '| response:', (body?.data?.response || body?.response || '').slice(0, 120));
    console.log('actions_executed:', JSON.stringify(actions));

    // Assert an AIMemory row with our marker exists for this user
    const memRes = await pool.query(
      `SELECT id, data FROM generic_entities
       WHERE entity_type = 'AIMemory' AND (data->>'user_email') = $1
         AND (data->>'value') ILIKE $2
       ORDER BY created_date DESC LIMIT 1`,
      [EMAIL, `%${marker}%`]
    );
    if (memRes.rows.length > 0) {
      memId = memRes.rows[0].id;
      const d = memRes.rows[0].data;
      const scoped = d.user_email === EMAIL && d.is_active === true && d.category !== 'company';
      console.log(`Found AIMemory row: key="${d.key}" category=${d.category} importance=${d.importance} user_email=${d.user_email}`);
      pass = scoped;
      if (!scoped) console.log('FAIL - memory row exists but scoping fields are wrong');

      // Isolation: the exact injection query used by the chat handlers must NOT
      // return this personal memory for a different teammate's email.
      const otherRes = await pool.query(
        `SELECT data FROM generic_entities
         WHERE entity_type = 'AIMemory'
           AND (data->>'company_id') = $1
           AND (data->>'is_active')::boolean = true
           AND data->>'category' NOT IN ('estimator_calibration','job_calibration')
           AND (
             data->>'user_email' = $2
             OR data->>'user_email' IS NULL
             OR data->>'user_email' = ''
             OR data->>'category' = 'company'
           )
           AND (data->>'value') ILIKE $3`,
        [COMPANY, 'teammate@example.com', `%${marker}%`]
      );
      if (otherRes.rows.length === 0) {
        console.log('PASS - personal memory is NOT injected for a different user');
      } else {
        console.log('FAIL - personal memory leaked into another user\'s injection query');
        pass = false;
      }
    } else {
      console.log('FAIL - no AIMemory row created with marker', marker);
    }
  } finally {
    await pool.query('DELETE FROM sessions WHERE sid = $1', [sid]);
    if (memId) await pool.query('DELETE FROM generic_entities WHERE id = $1', [memId]);
    await pool.end();
  }

  console.log(pass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  process.exit(pass ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
