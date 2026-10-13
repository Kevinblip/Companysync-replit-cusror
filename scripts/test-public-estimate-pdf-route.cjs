'use strict';

// Exercise the actual production route with an isolated database fixture.
// No sessions, real customer records, emails, or live database writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync('prod-server.cjs', 'utf8');
const start = source.indexOf("  if (pathname === '/api/public-estimate-pdf' && req.method === 'GET')");
const end = source.indexOf("\n  if (pathname.startsWith('/api/'))", start);
assert.ok(start > 0 && end > start);
const route = source.slice(start, end);
let renderer;

async function run({ valid = true, generic = false, missing = false } = {}) {
  let queries = 0, poolCalls = 0, rendered = null;
  const output = {};
  const estimate = {
    id: 'fixture-estimate', company_id: 'fixture-company',
    data: {
      estimate_number: 'FIXTURE-1', customer_name: 'Example Customer',
      total_rcv: 10002.61, format_id: 'fixture-format',
      line_items: [{ code: 'FIXTURE', description: 'Saved amount', quantity: 1, rate: 10002.61, rcv: 10002.61 }],
    },
  };
  const context = {
    pathname: '/api/public-estimate-pdf',
    req: { method: 'GET', url: '/api/public-estimate-pdf?id=fixture-estimate&t=fixture-token', headers: { host: 'example.test' } },
    res: { writeHead(status, headers) { output.status = status; output.headers = headers; }, end(body) { output.body = body; } },
    URL, Buffer, console,
    prodDb: { getPool() {
      poolCalls++;
      return { async query(sql, values) {
        queries++;
        if (sql.includes('FROM estimates')) return { rows: generic || missing ? [] : [estimate] };
        if (sql.includes("LOWER(entity_type) = 'estimate'")) return { rows: missing ? [] : [estimate] };
        if (sql.includes('FROM companies')) {
          assert.equal(values[0], 'fixture-company');
          return { rows: [{ id: 'fixture-company', company_name: 'Fixture Company' }] };
        }
        if (sql.includes("'estimateformat'")) {
          assert.equal(values[1], 'fixture-company');
          return { rows: [{ data: { format_name: 'Saved format' } }] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      } };
    } },
    require(name) {
      if (name === './lib/estimateToken.cjs') return { checkEstimateAccess(id, token, audience) {
        assert.equal(id, 'fixture-estimate');
        assert.equal(token, 'fixture-token');
        assert.equal(audience, 'public-estimate-pdf');
        return { ok: valid };
      } };
      if (name === './db/prod-integrations.cjs') return { getFunctionHandlers: async () => ({
        async generateEstimatePDF(params) {
          rendered = params;
          return renderer(params, null, {});
        },
      }) };
      throw new Error(`Unexpected module: ${name}`);
    },
  };
  await vm.runInNewContext(`(async () => { ${route} })()`, context);
  return { output, queries, poolCalls, rendered };
}

(async () => {
  const { functionHandlers } = await import(path.resolve(__dirname, '../vite-functions-plugin.js'));
  renderer = functionHandlers.generateEstimatePDF;
  for (const generic of [false, true]) {
    const result = await run({ generic });
    assert.equal(result.poolCalls, 1, 'the production route initializes its own pool');
    assert.equal(result.output.status, 200);
    assert.equal(result.output.headers['Content-Type'], 'application/pdf');
    assert.match(result.output.body.toString(), /^%PDF-/);
    assert.equal(result.rendered.estimate.total_rcv, 10002.61);
    assert.equal(result.rendered.estimate.line_items[0].rcv, 10002.61);
    assert.equal(result.rendered.trusted_company.company_name, 'Fixture Company');
    assert.equal(result.rendered.format.format_name, 'Saved format');
    assert.ok(result.rendered.returnBase64);
  }
  const denied = await run({ valid: false });
  assert.equal(denied.output.status, 403);
  assert.equal(denied.poolCalls, 0);
  assert.equal(denied.queries, 0);
  assert.equal(denied.rendered, null);
  const missing = await run({ missing: true });
  assert.equal(missing.output.status, 404);
  assert.equal(missing.rendered, null);
  console.log('PASS: production PDF route initializes the pool, serves dedicated/generic estimates, preserves saved totals, and retains access checks');
})().catch(error => { console.error(error); process.exitCode = 1; });
