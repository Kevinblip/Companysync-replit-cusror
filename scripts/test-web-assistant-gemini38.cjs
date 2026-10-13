'use strict';

// Exercise production expressions without starting its crons, database, or mail.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');
const profile = require('../lib/twilioLineProfile.cjs');
const { auditVoiceTurn } = require('../lib/lexiVoiceGrounding.cjs');
const source = fs.readFileSync(require.resolve('../prod-server.cjs'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === 'object') {
        const result = find(child, predicate);
        if (result) return result;
      }
    }
  }
  return null;
}
const code = node => { assert.ok(node, 'Production expression missing'); return source.slice(node.start, node.end); };
const web = find(ast, node => node.type === 'CallExpression'
  && node.callee.object?.name === 'lexiWss' && node.callee.property?.name === 'on'
  && node.arguments[0]?.value === 'connection').arguments[1];
const setup = find(web, node => node.type === 'Property' && node.key.name === 'setup').value;
const voice = find(web, node => node.type === 'VariableDeclarator' && node.id.name === 'voiceName').init;
const tools = find(ast, node => node.type === 'VariableDeclarator' && node.id.name === 'LEXI_CRM_TOOLS').init;
const toolTry = find(web, node => node.type === 'TryStatement'
  && node.block.body.some(statement => statement.declarations?.some(d => d.id.name === 'toolPromise')));
const roof = find(web, node => node.type === 'VariableDeclarator' && node.id.name === 'roofSupplement').init;
const verdict = find(web, node => node.type === 'VariableDeclarator' && node.id.name === 'verdict').init;

function makeSetup(handsFree = false) {
  return vm.runInNewContext(`(${code(setup)})`, {
    ...profile, voiceName: vm.runInNewContext(code(voice)), handsFree,
    process: { env: { GEMINI_NATIVE_AUDIO_MODEL: 'models/old-rollback-model' } },
    LEXI_CRM_TOOLS: vm.runInNewContext(code(tools)),
    buildLexiSystemPrompt: () => 'Existing CRM prompt retained.',
    companyName: 'Fixture', userName: 'Fixture', timezone: 'America/New_York',
    knowledgeBase: '', customerList: '', staffList: [], preferredLanguage: 'en',
    recentSessionContext: null,
  });
}
async function dispatch(fc, handler = () => { throw new Error('Calculator must not access CRM'); }) {
  return vm.runInNewContext(`(async () => { let result; ${code(toolTry)}; return result; })()`, {
    ...profile, fc, handleLexiToolCall: handler, companyId: 'fixture-company',
    userEmail: 'fixture@example.invalid', timezone: 'America/New_York',
    buildConfirmationState: {}, Promise, setTimeout() { return 0; },
    console: { error() {} },
  });
}
function audit(toolCalls) {
  return vm.runInNewContext(`(() => { const roofSupplement = ${code(roof)}; return ${code(verdict)}; })()`, {
    voiceTurn: { userMessage: 'How much is the roof supplement?', assistantText: '$999,999', toolCalls },
    auditVoiceTurn,
  });
}
async function run() {
  for (const handsFree of [false, true]) {
    const config = makeSetup(handsFree);
    assert.equal(config.model, 'models/gemini-3.8-live');
    assert.equal(config.generation_config.speech_config.voice_config.prebuilt_voice_config.voice_name, 'Aoede');
    assert.equal(config.realtime_input_config.automatic_activity_detection.silence_duration_ms, handsFree ? 1600 : 1000);
    assert.ok(config.tools[0].function_declarations.some(t => t.name === 'get_crm_data'));
    assert.equal(config.tools[0].function_declarations.filter(t => t.name === 'calculate_roof_supplement').length, 1);
    assert.ok(!JSON.stringify(config).includes('code_execution'));
    assert.ok(!JSON.stringify(config).includes('codeExecution'));
  }
  for (const args of [{ old_sq: 20, new_sq: 25 }, '{"old_sq":20,"new_sq":25}']) {
    const result = await dispatch({ name: 'calculate_roof_supplement', args });
    assert.equal(result.supplement_amount_formatted, '$1,623.45');
    const grounded = audit([{ name: 'calculate_roof_supplement', result }]);
    assert.equal(grounded.blocked, false);
    assert.ok(grounded.response.includes('$1,623.45'));
    assert.ok(!grounded.response.includes('$999,999'));
  }
  for (const args of [{ old_sq: -1, new_sq: 25 }, {}, '{broken']) {
    const result = await dispatch({ name: 'calculate_roof_supplement', args });
    assert.equal(result.status, 'failed');
    assert.equal(audit([{ name: 'calculate_roof_supplement', result }]).blocked, true);
  }
  assert.equal(audit([]).blocked, true, 'Existing money guard must remain fail-closed');
  let delegated = false;
  const crm = await dispatch({ name: 'get_crm_data', args: {} }, (fc, companyId, email) => {
    delegated = true;
    assert.equal(fc.name, 'get_crm_data');
    assert.equal(companyId, 'fixture-company');
    assert.equal(email, 'fixture@example.invalid');
    return Promise.resolve({ error: 'Existing permission denial', access_restricted: true });
  });
  assert.ok(delegated);
  assert.equal(crm.access_restricted, true);
  assert.ok(code(web).indexOf('authenticateLexiWs(') < code(web).indexOf('new WebSocket('));
  console.log('PASS: production web Gemini 3.8/Aoede setup, calculator dispatch/grounding, invalid inputs, existing CRM delegation/auth and Drive Mode settings.');
}
module.exports = { makeSetup };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });