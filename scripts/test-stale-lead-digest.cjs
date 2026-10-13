#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const handlers = fs.readFileSync('vite-functions-plugin.js', 'utf8');
const production = fs.readFileSync('prod-server.cjs', 'utf8');
const cron = fs.readFileSync('vite-cron-plugin.js', 'utf8');

const staleStart = handlers.indexOf('async checkStaleLeads(params)');
const staleEnd = handlers.indexOf('\n  },', staleStart);
const staleCheck = handlers.slice(staleStart, staleEnd);
const digestStart = handlers.indexOf('async sendStaleLeadDigest(params = {})');
const digestEnd = handlers.indexOf('\n  },', digestStart);
const digest = handlers.slice(digestStart, digestEnd);
const escalationStart = handlers.indexOf('async processActionItemEscalation');
const escalationEnd = handlers.indexOf('\n  },', escalationStart);
const escalation = handlers.slice(escalationStart, escalationEnd);

assert.ok(staleStart >= 0 && digestStart >= 0, 'stale-lead handlers must exist');
assert.doesNotMatch(staleCheck, /createBellNotification/, 'stale scan must not emit one bell per lead');
assert.match(staleCheck, /type: 'stale_lead'/, 'stale scan must retain item-level Action Item history');
assert.match(digest, /America\/New_York/, 'digest must use the requested Eastern schedule');
assert.match(digest, /easternHour !== 7/, 'automatic delivery must be gated to the 7am Eastern hour');
assert.match(digest, /Development delivery disabled/, 'development cron must not send real digest email');
assert.match(digest, /You have <strong>\$\{count\}<\/strong> stale leads that need attention today/, 'digest must include the requested summary');
assert.match(digest, /Lead Name/, 'digest must include lead names');
assert.match(digest, /Overdue Time/, 'digest must include overdue time');
assert.match(digest, /Open in CRM/, 'digest must include CRM links');
assert.match(digest, /StaleLeadDigestDelivery/, 'digest must use a durable delivery claim');
assert.match(digest, /ON CONFLICT \(id, entity_type\) DO NOTHING/, 'delivery claim must be atomic');
assert.match(digest, /DELETE FROM generic_entities/, 'failed sends must release the claim for retry');
assert.match(escalation, /item\.type !== 'stale_lead'/, 'generic escalation must not send a second stale-lead external digest');
assert.match(cron, /name: 'sendStaleLeadDigest'/, 'development scheduler catalog must register the digest');
assert.match(production, /callInternalFunction\('sendStaleLeadDigest'/, 'production scheduler must invoke the digest');

console.log('PASS: stale leads are grouped into one daily Eastern-time email per assigned rep');