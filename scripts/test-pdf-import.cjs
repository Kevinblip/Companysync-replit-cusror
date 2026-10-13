// Smoke test: importXactimatePdf background job (fresh company, forged session)
const crypto = require('crypto');
const { createPool } = require('./lib/db-pool.cjs');
const pool = createPool({ connectionString: process.env.DATABASE_URL });

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';
const SID = 'smoke-pdf-import-sid';
const EMAIL = 'smoke-pdf-import@example.com';
const UID = 'smoke-pdf-import-uid';
const PDF_URL = `${BASE_URL}/uploads/21b1fa39-8b08-4137-a2b4-cc734d9ab850.pdf`;

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

async function cleanup(companyId) {
  if (companyId) {
    await pool.query(`DELETE FROM generic_entities WHERE company_id = $1`, [companyId]);
    await pool.query('DELETE FROM staff_profiles WHERE company_id = $1', [companyId]);
    await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
  }
  await pool.query('DELETE FROM companies WHERE LOWER(created_by) = $1', [EMAIL]);
  await pool.query('DELETE FROM staff_profiles WHERE LOWER(COALESCE(user_email, email)) = $1', [EMAIL]);
  await pool.query('DELETE FROM users WHERE id = $1 OR LOWER(email) = $2', [UID, EMAIL]);
  await pool.query('DELETE FROM sessions WHERE sid = $1', [SID]);
}

(async () => {
  let companyId = null;
  try {
    await cleanup();
    await pool.query(`INSERT INTO users (id, email, first_name, created_at, updated_at) VALUES ($1, $2, 'SmokePdf', NOW(), NOW())`, [UID, EMAIL]);
    const sess = { cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' }, passport: { user: { claims: { email: EMAIL } } } };
    await pool.query(`INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3) ON CONFLICT (sid) DO UPDATE SET sess = $2::jsonb, expire = $3`,
      [SID, JSON.stringify(sess), new Date(Date.now() + 3600000)]);
    const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(SID).digest('base64').replace(/=+$/, '');
    const Cookie = `connect.sid=${encodeURIComponent(`s:${SID}.${sig}`)}`;

    // Create company + owner profile
    const co = await fetchJson(`${BASE_URL}/api/local/entity/Company`, { method: 'POST', headers: { Cookie }, body: JSON.stringify({ company_name: 'PDF Smoke Co' }) });
    companyId = co.body?.id;
    console.log('company:', co.status, companyId);
    const sp = await fetchJson(`${BASE_URL}/api/local/entity/StaffProfile`, { method: 'POST', headers: { Cookie }, body: JSON.stringify({ company_id: companyId, user_email: EMAIL, email: EMAIL, full_name: 'Smoke Pdf', is_administrator: true, role: 'admin' }) });
    console.log('staff:', sp.status);

    // Kick off import
    const start = await fetchJson(`${BASE_URL}/api/functions/invoke`, { method: 'POST', headers: { Cookie }, body: JSON.stringify({ functionName: 'importXactimatePdf', params: { fileUrl: PDF_URL, company_id: companyId, source: 'Xactimate', merge: false } }) });
    console.log('start:', start.status, JSON.stringify(start.body).slice(0, 200));
    const jobId = start.body?.jobId || start.body?.data?.jobId;
    if (!jobId) throw new Error('No jobId returned');

    // Poll
    const t0 = Date.now();
    while (Date.now() - t0 < 12 * 60 * 1000) {
      await new Promise((r) => setTimeout(r, 10000));
      const st = await fetchJson(`${BASE_URL}/api/functions/invoke`, { method: 'POST', headers: { Cookie }, body: JSON.stringify({ functionName: 'getPdfImportStatus', params: { jobId } }) });
      const s = st.body?.data || st.body || {};
      console.log(`[${Math.round((Date.now()-t0)/1000)}s]`, s.status, '-', s.progress || s.error || '');
      if (s.status === 'done') {
        const { rows } = await pool.query(`SELECT COUNT(*) FROM generic_entities WHERE company_id = $1 AND entity_type = 'PriceListItem'`, [companyId]);
        console.log(`DONE: imported=${s.imported}, DB rows=${rows[0].count}`);
        const sample = await pool.query(`SELECT data->>'code' code, data->>'description' descr, data->>'price' price, data->>'unit' unit FROM generic_entities WHERE company_id = $1 AND entity_type = 'PriceListItem' LIMIT 3`, [companyId]);
        console.log('sample:', JSON.stringify(sample.rows));
        process.exitCode = 0;
        return;
      }
      if (s.status === 'failed' || s.status === 'not_found') { console.error('FAILED:', s.error || s.status); process.exitCode = 1; return; }
    }
    console.error('TIMEOUT'); process.exitCode = 1;
  } catch (e) {
    console.error('ERROR:', e.message); process.exitCode = 1;
  } finally {
    await cleanup(companyId).catch(() => {});
    await pool.end();
  }
})();
