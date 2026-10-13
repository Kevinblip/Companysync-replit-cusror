#!/usr/bin/env node
/**
 * Database-backed work-order custom-rate API regression test.
 *
 * Requires the development server plus DATABASE_URL and SESSION_SECRET. Every
 * fixture is isolated and deleted in finally, so it is safe to run repeatedly.
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const { Pool } = require('pg');

const BASE_URL = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const marker = `smoke_work_order_rates_${crypto.randomBytes(6).toString('hex')}`;
const ids = {
  companyA: `${marker}_company_a`,
  companyB: `${marker}_company_b`,
  adminUser: `${marker}_admin_user`,
  staffUser: `${marker}_staff_user`,
  adminSession: `${marker}_admin_session`,
  staffSession: `${marker}_staff_session`,
  subcontractorA: `${marker}_sub_a`,
  subcontractorB: `${marker}_sub_b`,
  projectA: `${marker}_project_a`,
  rateA: `${marker}_rate_a`,
  rateB: `${marker}_rate_b`,
};
const adminEmail = `${marker}@example.test`;
const staffEmail = `${marker}_staff@example.test`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, BASE_URL);
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: `${url.pathname}${url.search}`,
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { body = JSON.parse(body); } catch { /* preserve raw response */ }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    if (options.body !== undefined) req.write(JSON.stringify(options.body));
    req.end();
  });
}

function signedCookie(sid) {
  const signature = crypto.createHmac('sha256', process.env.SESSION_SECRET)
    .update(sid).digest('base64').replace(/=+$/, '');
  return `connect.sid=${encodeURIComponent(`s:${sid}.${signature}`)}`;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const result = await request('/api/local/entity/Company?limit=1');
      if (result.status) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Server at ${BASE_URL} did not respond within 60 seconds.`);
}

async function seedSession(userId, email, sessionId, companyId) {
  await pool.query(
    `INSERT INTO users (id, email, company_id, first_name, created_at, updated_at)
     VALUES ($1,$2,$3,'Work order smoke test',NOW(),NOW())`,
    [userId, email, companyId]
  );
  const session = {
    cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' },
    passport: { user: { claims: { email } } },
  };
  await pool.query(
    'INSERT INTO sessions (sid, sess, expire) VALUES ($1,$2::jsonb,$3)',
    [sessionId, JSON.stringify(session), new Date(Date.now() + 3600000)]
  );
  return signedCookie(sessionId);
}

async function seedFixtures() {
  await pool.query(
    `INSERT INTO companies (id, company_name, created_by, email)
     VALUES ($1,'Work order rates A',$2,$2), ($3,'Work order rates B',$4,$4)`,
    [ids.companyA, adminEmail, ids.companyB, `${marker}_other@example.test`]
  );
  const adminCookie = await seedSession(ids.adminUser, adminEmail, ids.adminSession, ids.companyA);
  const staffCookie = await seedSession(ids.staffUser, staffEmail, ids.staffSession, ids.companyA);
  await pool.query(
    `INSERT INTO staff_profiles
      (id, company_id, user_email, email, full_name, is_administrator, is_active)
     VALUES
      ($1,$2,$3,$3,'Rates administrator',true,true),
      ($4,$2,$5,$5,'Rates staff member',false,true)`,
    [ `${marker}_admin_profile`, ids.companyA, adminEmail, `${marker}_staff_profile`, staffEmail ]
  );
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data)
     VALUES
      ($1,'Subcontractor',$2,$3::jsonb),
      ($4,'Subcontractor',$5,$6::jsonb)`,
    [ids.subcontractorA, ids.companyA, JSON.stringify({ name: 'Tenant A crew' }),
      ids.subcontractorB, ids.companyB, JSON.stringify({ name: 'Tenant B crew' })]
  );
  await pool.query(
    `INSERT INTO projects (id, company_id, title, address)
     VALUES ($1,$2,'Tenant A test project','100 Fixture Lane')`,
    [ids.projectA, ids.companyA]
  );
  await pool.query(
    `INSERT INTO labor_rates (id, company_id, name, category, unit, rate_cents, is_active)
     VALUES
      ($1,$2,'Install siding','Siding','square',10000,true),
      ($3,$4,'Tenant B rate','Roofing','square',7500,true)`,
    [ids.rateA, ids.companyA, ids.rateB, ids.companyB]
  );
  return { adminCookie, staffCookie };
}

async function cleanup() {
  try {
    await pool.query('DELETE FROM work_orders WHERE company_id IN ($1,$2)', [ids.companyA, ids.companyB]);
    await pool.query('DELETE FROM subcontractor_rates WHERE company_id IN ($1,$2)', [ids.companyA, ids.companyB]);
    await pool.query('DELETE FROM labor_rates WHERE company_id IN ($1,$2)', [ids.companyA, ids.companyB]);
    await pool.query('DELETE FROM projects WHERE company_id IN ($1,$2)', [ids.companyA, ids.companyB]);
    await pool.query('DELETE FROM generic_entities WHERE company_id IN ($1,$2)', [ids.companyA, ids.companyB]);
    await pool.query('DELETE FROM staff_profiles WHERE company_id IN ($1,$2)', [ids.companyA, ids.companyB]);
    await pool.query('DELETE FROM companies WHERE id IN ($1,$2)', [ids.companyA, ids.companyB]);
    await pool.query('DELETE FROM users WHERE id IN ($1,$2)', [ids.adminUser, ids.staffUser]);
    await pool.query('DELETE FROM sessions WHERE sid IN ($1,$2)', [ids.adminSession, ids.staffSession]);
  } catch (error) {
    console.warn('[work-order-rates-api] cleanup failed:', error.message);
  }
}

async function main() {
  if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
    throw new Error('DATABASE_URL and SESSION_SECRET must be set before running this test.');
  }
  await waitForServer();
  await cleanup();
  const { adminCookie, staffCookie } = await seedFixtures();
  const admin = { Cookie: adminCookie };
  const staff = { Cookie: staffCookie };
  const ownRatesPath = `/api/subcontractors/${ids.subcontractorA}/rates`;
  const foreignRatesPath = `/api/subcontractors/${ids.subcontractorB}/rates?company_id=${ids.companyB}`;

  const readable = await request(ownRatesPath, { headers: admin });
  assert.strictEqual(readable.status, 200);
  assert.strictEqual(readable.body.labor_rates[0].custom_rate, null);

  const saved = await request(ownRatesPath, {
    method: 'POST', headers: admin,
    body: { overrides: [{ labor_rate_id: ids.rateA, custom_rate: '125.50' }] },
  });
  assert.strictEqual(saved.status, 200);
  assert.strictEqual(saved.body.saved_count, 1);

  const updated = await request(ownRatesPath, { headers: admin });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.body.labor_rates[0].custom_rate, '125.50');

  for (const customRate of ['10.999', '-1', 'not-a-price']) {
    const invalid = await request(ownRatesPath, {
      method: 'POST', headers: admin,
      body: { overrides: [{ labor_rate_id: ids.rateA, custom_rate: customRate }] },
    });
    assert.strictEqual(invalid.status, 400, `custom rate ${customRate} must be rejected`);
  }

  const staffWrite = await request(ownRatesPath, {
    method: 'POST', headers: staff,
    body: { overrides: [{ labor_rate_id: ids.rateA, custom_rate: '110.00' }] },
  });
  assert.strictEqual(staffWrite.status, 403);

  const foreignRead = await request(foreignRatesPath, { headers: admin });
  assert.strictEqual(foreignRead.status, 403);
  const foreignWrite = await request(foreignRatesPath, {
    method: 'POST', headers: admin,
    body: { overrides: [{ labor_rate_id: ids.rateB, custom_rate: '110.00' }] },
  });
  assert.strictEqual(foreignWrite.status, 403);

  const firstOrder = await request('/api/work-orders/generate', {
    method: 'POST', headers: admin,
    body: {
      project_id: ids.projectA, subcontractor_id: ids.subcontractorA,
      items: [{ labor_rate_id: ids.rateA, quantity: '2' }],
    },
  });
  assert.strictEqual(firstOrder.status, 201);
  assert.strictEqual(firstOrder.body.work_order.payout_cents, 25100);
  const firstOrderId = firstOrder.body.work_order.id;

  const cleared = await request(ownRatesPath, { method: 'POST', headers: admin, body: { overrides: [] } });
  assert.strictEqual(cleared.status, 200);
  const afterClear = await request(ownRatesPath, { headers: admin });
  assert.strictEqual(afterClear.status, 200);
  assert.strictEqual(afterClear.body.labor_rates[0].custom_rate, null);

  const secondOrder = await request('/api/work-orders/generate', {
    method: 'POST', headers: admin,
    body: {
      project_id: ids.projectA, subcontractor_id: ids.subcontractorA,
      items: [{ labor_rate_id: ids.rateA, quantity: '2' }],
    },
  });
  assert.strictEqual(secondOrder.status, 201);
  assert.strictEqual(secondOrder.body.work_order.payout_cents, 20000);

  const snapshot = await pool.query(
    'SELECT unit_rate_cents, total_cents FROM work_order_items WHERE work_order_id=$1',
    [firstOrderId]
  );
  assert.deepStrictEqual(snapshot.rows[0], { unit_rate_cents: 12550, total_cents: 25100 });
  console.log('work-order custom-rate API regression checks passed');
}

main()
  .catch((error) => {
    console.error('work-order custom-rate API regression checks failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await pool.end();
  });