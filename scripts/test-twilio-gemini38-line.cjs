'use strict';

// Execute the actual production route/setup/tool expressions with dependency
// stubs. Never boot prod-server (its startup runs crons and provider writes).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');
const {
  isGemini38Line, applyTwilioLineProfile, calculateRoofSupplement, invokeRoofSupplement,
} = require('../lib/twilioLineProfile.cjs');
const source = fs.readFileSync(require.resolve('../prod-server.cjs'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) { const result = find(child, predicate); if (result) return result; }
    } else if (value && typeof value === 'object') {
      const result = find(value, predicate); if (result) return result;
    }
  }
  return null;
}
function code(node) { assert.ok(node, 'Production expression must exist'); return source.slice(node.start, node.end); }
function readTools(name) {
  return vm.runInNewContext(code(find(ast, node =>
    node.type === 'VariableDeclarator' && node.id.name === name).init));
}
const phone = find(ast, node => node.type === 'CallExpression'
  && node.callee.object?.name === 'twilioWss' && node.callee.property?.name === 'on'
  && node.arguments[0]?.value === 'connection').arguments[1];
const setupNode = find(phone, node => node.type === 'Property' && node.key.name === 'setup'
  && node.value.callee?.name === 'applyTwilioLineProfile').value;
const toolNode = find(phone, node => node.type === 'VariableDeclarator' && node.id.name === 'toolResults').init;
const route = find(ast, node => node.type === 'IfStatement'
  && code(node.test).includes("pathname === '/api/functions/incomingCall'")
  && code(node.test).includes("pathname === '/api/twilio/voice'"));

function setupFor(number, outbound = false, staff = false) {
  return vm.runInNewContext(code(setupNode), {
    applyTwilioLineProfile, calledTwilioNumber: number, isOutboundCall: outbound,
    subscriberGeminiModel: 'models/existing-subscriber-model',
    process: { env: { GEMINI_NATIVE_AUDIO_MODEL: 'models/existing-env-model' } },
    voiceName: 'Aoede', vad: { end: 'END_SENSITIVITY_LOW', silenceMs: 900 },
    prompt: 'Test production setup.', staffCandidate: staff ? {} : null,
    VERIFY_STAFF_PIN_TOOL: { name: 'verify_staff_pin' },
    CRM_TOOLS: readTools('CRM_TOOLS'), LEXI_CRM_TOOLS: readTools('LEXI_CRM_TOOLS'),
    callRoutingMode: 'sarah_answers',
  });
}

async function run() {
  assert.ok(isGemini38Line('+12167771602'));
  assert.ok(isGemini38Line('(216) 777-1602'));
  assert.ok(!isGemini38Line('+442167771602'));
  assert.equal(calculateRoofSupplement(20, 25).supplement_amount_formatted, '$1,623.45');
  assert.equal(calculateRoofSupplement(20, 20.5).supplement_amount_formatted, '$162.35');
  assert.equal(calculateRoofSupplement(20.5, 20).supplement_amount_formatted, '-$162.35');
  assert.equal(calculateRoofSupplement(20, 20).supplement_amount_formatted, '$0.00');
  for (const invalid of [null, '20', -1, Infinity, NaN]) {
    assert.throws(() => calculateRoofSupplement(invalid, 25));
  }
  assert.throws(() => invokeRoofSupplement('+12167771554', { old_sq: 20, new_sq: 25 }));
  const unsupported = {
    model: 'old', tools: [{ code_execution: {} }, { codeExecution: {} },
      { code_execution: {}, function_declarations: [{ name: 'existing' }] }],
  };
  assert.equal(applyTwilioLineProfile(unsupported, '+15555550123'), unsupported);
  const clean = applyTwilioLineProfile(unsupported, '+12167771602');
  assert.ok(!JSON.stringify(clean).includes('code_execution'));
  assert.ok(!JSON.stringify(clean).includes('codeExecution'));
  for (const staff of [false, true]) {
    const setup = setupFor('+12167771602', false, staff);
    assert.equal(setup.model, 'models/gemini-3.8-live');
    const tools = setup.tools.flatMap(t => t.function_declarations || []);
    assert.equal(tools.filter(t => t.name === 'calculate_roof_supplement').length, 1);
    assert.ok(!JSON.stringify(setup).includes('code_execution'));
    if (staff) assert.ok(tools.some(t => t.name === 'verify_staff_pin'));
  }
  for (const [number, outbound] of [['+15555550123', false], ['+12167771602', true]]) {
    const setup = setupFor(number, outbound);
    assert.equal(setup.model, 'models/existing-subscriber-model');
    assert.ok(!setup.tools.some(t => t.function_declarations.some(f => f.name === 'calculate_roof_supplement')));
  }

  for (const number of ['+12167771602', '+15555550123']) {
    let body = '';
    await vm.runInNewContext(`(async () => { ${code(route)} })()`, {
      pathname: '/api/twilio/voice', isGemini38Line, setCorsHeaders() {},
      getPublicHost: () => 'voice-test.example',
      req: { headers: {} }, res: { writeHead(status) { assert.equal(status, 200); }, end(text) { body = text; } },
      readBody: async () => new URLSearchParams({ To: number, From: '+15555550234', CallSid: 'CA_FIXTURE' }).toString(),
      URLSearchParams, url: new URL('https://voice-test.example/api/twilio/voice'),
      prodDb: { getPool: () => ({ query: async sql => ({
        rows: sql.includes('SELECT id FROM companies') ? [{ id: 'fixture-company' }] : [],
      }) }) },
      require: name => {
        assert.equal(name, './lib/twilioSignature.cjs');
        return { verifyTwilioWebhook: async () => ({}), shouldRejectTwilio: () => false };
      },
      getCachedSubscriber: () => ({ companyId: 'fixture-company', routingMode: 'forward_to_cell',
        cellPhone: '+15555550345', repName: 'Fixture', data: {} }),
      DEFAULT_COMPANY_ID: 'fixture-company', BASE44_API_URL: '', console: { log() {}, warn() {} },
    });
    if (isGemini38Line(number)) {
      assert.ok(body.includes('wss://voice-test.example/ws/twilio'));
      assert.ok(body.includes('<Parameter name="calledNumber" value="+12167771602"'));
      assert.ok(!body.includes('<Dial'));
    } else {
      assert.ok(body.includes('<Dial'), 'Other lines retain cell-forwarding preferences');
    }

    const results = await vm.runInNewContext(`(async () => ${code(toolNode)})()`, {
      fcs: [{ name: 'calculate_roof_supplement', args: '{"old_sq":20,"new_sq":25}' }],
      invokeRoofSupplement, calledTwilioNumber: number, isOutboundCall: false,
      staffCandidate: null, Date, Promise, setTimeout() { return 0; },
      callSid: 'fixture', currentStreamSid: 'fixture', console: { log() {}, error() {} },
    });
    if (isGemini38Line(number)) assert.equal(results[0].supplement_amount_formatted, '$1,623.45');
    else assert.equal(results[0].status, 'failed');
  }
  console.log('PASS: production TwiML route, number-specific model/setup, no code execution, backend calculator dispatch, staff PIN tools retained, other lines and outbound calls unchanged.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });