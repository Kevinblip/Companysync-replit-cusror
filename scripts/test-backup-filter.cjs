// Regression test for the "complete backup" company_id filter bug.
//
// functions/createCompleteBackup.ts fetches each entity via
//   GET /api/local/entity/<Type>?company_id={"$in":["<companyId>"]}
// Previously db/prod-db.cjs universalFilter() ignored the {$in:[...]} operator on
// company_id and returned 0 rows for every entity type. This test asserts that the
// {$in:[id]} form and the plain scalar form return IDENTICAL counts for both a
// dedicated-table entity and a generic_entities entity.
//
// Self-contained: it picks a company that actually has data, then compares the two
// filter forms. It does NOT depend on specific seed counts, only that both forms agree.

const prodDb = require('../db/prod-db.cjs');
const { adoptPool } = require('./lib/db-pool.cjs');

function mockReqRes(pathname, search) {
  const url = new URL(`http://localhost${pathname}${search}`);
  const req = { method: 'GET', url: pathname + search, headers: {}, on: () => {} };
  let captured = { status: 200, body: null };
  const res = {
    writeHead: (s) => { captured.status = s; },
    setHeader: () => {},
    end: (b) => { captured.body = b; },
  };
  return { req, res, url, captured };
}

async function fetchCount(entityType, companyIdValue) {
  const search = `?company_id=${encodeURIComponent(companyIdValue)}&_limit=10000`;
  const pathname = `/api/local/entity/${entityType}`;
  const { req, res, url, captured } = mockReqRes(pathname, search);
  await prodDb.handleLocalDbRoute(req, res, pathname, url);
  let parsed;
  try { parsed = JSON.parse(captured.body); } catch { parsed = null; }
  if (!Array.isArray(parsed)) {
    throw new Error(`Non-array response for ${entityType}: ${String(captured.body).slice(0, 120)}`);
  }
  return parsed.length;
}

(async () => {
  // Shared module pool: adopt it so it carries the same session guards and
  // teardown as every other script pool, instead of lingering after a kill.
  const pool = adoptPool(prodDb.getPool());

  // Pick a company that has the most customers so the comparison is meaningful.
  const { rows } = await pool.query(
    `SELECT company_id, COUNT(*) AS n FROM customers WHERE company_id IS NOT NULL
     GROUP BY company_id ORDER BY n DESC LIMIT 1`
  );
  if (rows.length === 0) {
    console.log('SKIP: no customer data present to test against.');
    process.exit(0);
  }
  const companyId = rows[0].company_id;
  console.log(`Testing company ${companyId} (${rows[0].n} customers)\n`);

  const entityTypes = ['Customer', 'Lead', 'Estimate', 'Invoice', 'Task', 'JobMedia', 'Notification'];
  let failures = 0;

  for (const t of entityTypes) {
    const scalar = await fetchCount(t, companyId);
    const inForm = await fetchCount(t, JSON.stringify({ $in: [companyId] }));
    const ok = scalar === inForm;
    if (!ok) failures++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t.padEnd(12)} scalar=${scalar}  $in=${inForm}`);
  }

  // Empty $in must return zero rows (and must not error).
  const emptyIn = await fetchCount('Customer', JSON.stringify({ $in: [] }));
  const emptyOk = emptyIn === 0;
  if (!emptyOk) failures++;
  console.log(`  ${emptyOk ? 'PASS' : 'FAIL'}  ${'Customer'.padEnd(12)} empty $in => ${emptyIn} (expected 0)`);

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
