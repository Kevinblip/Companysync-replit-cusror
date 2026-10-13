#!/usr/bin/env node
const fs = require('fs');
const assert = require('assert');

const prompt = fs.readFileSync('lib/lexiSystemPrompt.cjs', 'utf8');
const dev = fs.readFileSync('vite-functions-plugin.js', 'utf8');
const prod = fs.readFileSync('db/prod-integrations.cjs', 'utf8');
const ui = fs.readFileSync('src/pages/AIAssistant.jsx', 'utf8');
const native = fs.readFileSync('vite-lexi-native-plugin.js', 'utf8');
const nativeProd = fs.readFileSync('prod-server.cjs', 'utf8');
const fallback = fs.readFileSync('functions/lexiChat.ts', 'utf8');
const bridge = fs.readFileSync('functions/lexiBridgeAPI.ts', 'utf8');

for (const name of ['route_lead_to_sequence', 'trigger_document_packet', 'dispatch_team_notification']) {
  assert(prompt.includes(`name: '${name}'`), `Shared Gemini schema is missing ${name}`);
  assert(dev.includes(`fname === '${name}'`), `Development Lexi dispatcher is missing ${name}`);
  assert(prod.includes(`fname === '${name}'`), `Production Lexi dispatcher is missing ${name}`);
  assert(native.includes(`name: "${name}"`), `Development native voice schema is missing ${name}`);
  assert(nativeProd.includes(`name: "${name}"`), `Production native voice schema is missing ${name}`);
  assert(fallback.includes(`name: '${name}'`), `Fallback Lexi schema is missing ${name}`);
  assert(fallback.includes(`fname === '${name}'`), `Fallback Lexi dispatcher is missing ${name}`);
  assert(bridge.includes(`'${name}'`), `Legacy voice bridge is missing ${name}`);
}
for (const source of [native, nativeProd]) {
  assert(source.includes('confirm_lexi_orchestration'), 'Native voice must expose a confirmation tool for approved routing');
  assert(source.includes('LexiPendingOrchestration'), 'Native voice approvals must be session-bound and persisted');
  assert(source.includes("status: 'used'"), 'Native voice approvals must be single-use');
  assert(source.includes("data->>'status'='pending'") && source.includes('RETURNING id'), 'Native voice approvals must be atomically claimed');
  assert(source.includes("new Date(Date.now() + 10 * 60 * 1000)"), 'Native voice approvals must expire');
}
assert(dev.includes("entity_type='SequenceEnrollment'"), 'Sequence enrollment must be persisted and idempotently checked');
assert(dev.includes("'WorkflowExecution'"), 'Enrollment must create a real workflow execution for immediate and delayed steps');
assert(dev.includes('executeWorkflowAction(pool, step'), 'Enrollment must execute immediate workflow actions');
assert(dev.includes("'DocumentPacket'"), 'Packet delivery must be auditable');
assert(dev.includes('JSON.stringify(data).slice'), 'Packet delivery must include selected record summaries, not only labels');
assert(dev.includes("async executeLexiOrchestration"), 'Approved actions need server-side execution');
assert(prod.includes("functionName === 'executeLexiOrchestration'"), 'Production function router must expose approved orchestration execution');
assert(prod.includes('handlers.executeLexiOrchestration'), 'Production route must delegate to the protected executor');
assert(dev.includes("buildLexiAccessPolicy"), 'Approved actions must enforce administrator policy');
assert(dev.includes("WHERE id=$1 AND company_id=$2"), 'Approved actions must scope selected records to the company');
assert(dev.includes("LIMIT 2"), 'Named team assignment must reject ambiguous staff names');
assert(ui.includes("executeLexiOrchestration"), 'The confirmation UI must execute approved orchestration actions');
for (const source of [native, fallback, bridge]) {
  assert(source.includes('requires_confirmation'), 'Sequence and packet routing must require explicit approval');
  assert(source.includes('company_id'), 'Voice routing validation must be tenant-scoped');
  assert(source.includes('More than one teammate matches that name'), 'Voice routing must reject ambiguous teammate names');
}
assert(bridge.includes('authenticatedUser?.email') && bridge.includes('ORCHESTRATION_TOOL_CONTRACTS'), 'Voice bridge routing must require an authenticated administrator');
console.log('Lexi team orchestration source-level regression checks passed.');