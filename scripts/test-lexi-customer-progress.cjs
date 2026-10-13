const assert = require('node:assert/strict');
const { getCustomerPublicProgress, renderCustomerProgressReply, isExactVoiceProgressTranscript } = require('../lib/customerProjectProgress.cjs');
const { CUSTOMER_LEXI_TOOLS } = require('../lib/smsAssistant.cjs');

function poolFor({ customers = [{ id: 'customer-a' }], projects = [{ id: 'project-a', customer_id: 'customer-a', address: '10 Main St', status: 'active', data: {} }], logs = [{ content_body: 'Materials arrived. We will contact you with the next update.', created_at: '2026-10-08' }] } = {}) {
  return {
    async query(sql, params) {
      if (/FROM customers/.test(sql)) {
        assert.equal(params[0], 'company-a');
        assert.match(sql, /= ANY\(\$2::text\[\]\)/);
        assert.doesNotMatch(sql, /LIKE/);
        return { rows: customers };
      }
      if (/FROM projects/.test(sql)) {
        assert.deepEqual(params, ['company-a', 'customer-a']);
        return { rows: projects };
      }
      if (/FROM project_logs/.test(sql)) {
        assert.match(sql, /is_public = true/);
        assert.ok(projects.some(project => project.id === params[0]));
        return { rows: logs };
      }
      throw new Error('Unexpected query');
    },
  };
}

async function run() {
  const lookup = pool => getCustomerPublicProgress(pool, 'company-a', '+12165550101');
  const result = await lookup(poolFor());
  assert.equal(result.ok, true);
  assert.equal(result.status, 'in progress');
  assert.match(renderCustomerProgressReply(result), /Materials arrived/);
  assert.doesNotMatch(JSON.stringify(result), /customer-a|project-a|10 Main/);
  assert.equal((await lookup(poolFor({ customers: [] }))).reason, 'unverified_phone');
  assert.equal((await lookup(poolFor({ customers: [{ id: 'customer-a' }, { id: 'customer-b' }] }))).reason, 'ambiguous_customer');
  assert.equal((await lookup(poolFor({ projects: [] }))).reason, 'no_project');
  assert.equal((await lookup(poolFor({ projects: [{ id: 'p', customer_id: 'customer-a', data: { related_customer_id: 'customer-b' } }] }))).reason, 'conflicting_project_link');
  const multiple = poolFor({ projects: [
    { id: 'p1', customer_id: 'customer-a', address: '10 Main St', data: {} },
    { id: 'p2', customer_id: 'customer-a', address: '20 Main St', data: {} },
  ] });
  assert.equal((await lookup(multiple)).reason, 'project_selection_needed');
  assert.equal((await getCustomerPublicProgress(multiple, 'company-a', '+12165550101', '20 Main St')).ok, true);
  const restricted = await lookup(poolFor({ logs: [{ content_body: 'The adjuster approved an invoice for $500.', created_at: '2026-10-08' }] }));
  assert.deepEqual(restricted.updates, []);
  assert.equal((await lookup({ query: async () => { throw new Error('Expected test failure'); } })).reason, 'lookup_failed');
  assert.deepEqual(CUSTOMER_LEXI_TOOLS.map(tool => tool.name), ['get_customer_public_progress', 'schedule_callback_request']);
  assert.equal(isExactVoiceProgressTranscript('Materials arrived!', 'Materials arrived.'), true);
  assert.equal(isExactVoiceProgressTranscript('Materials arrived. Your invoice is paid.', 'Materials arrived.'), false);
  console.log('PASS: customer progress identity, tenant, public-only, conflict, failure, tool allowlist, and voice transcript checks.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
