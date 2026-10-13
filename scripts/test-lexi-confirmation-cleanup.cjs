#!/usr/bin/env node
// Storage-hygiene guard for Lexi's scheduling confirmations.
//
// Every calendar conflict writes a LexiPendingSchedule row with a 10-minute TTL.
// Confirmed rows are stamped 'used', abandoned ones are never touched again, and
// neither can be redeemed afterwards — so a scheduled sweep has to remove them,
// in BOTH the dev cron scheduler and the production one (a dev-only registration
// means the table only ever grows where it actually matters).
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const handlers = fs.readFileSync(path.join(root, 'vite-functions-plugin.js'), 'utf8');
const devCron = fs.readFileSync(path.join(root, 'vite-cron-plugin.js'), 'utf8');
const prodCron = fs.readFileSync(path.join(root, 'prod-server.cjs'), 'utf8');

const JOB = 'cronCleanupLexiPendingSchedules';
let failed = 0;
function check(label, value) {
  console.log(`${value ? 'PASS' : 'FAIL'} - ${label}`);
  if (!value) failed++;
}

// The sweep exists at all.
check('handler: cleanup handler is registered in the function registry', handlers.includes(`async ${JOB}(`));

// Bound the slice to this handler only — the next `async name(` in the registry
// starts a different function whose SQL must not count toward these assertions.
const bodyStart = handlers.indexOf(`async ${JOB}(`);
const nextHandler = handlers.indexOf('\n  async ', bodyStart + 1);
const body = handlers.slice(bodyStart, nextHandler === -1 ? handlers.length : nextHandler);

// Tenant safety: the DELETE may only ever match Lexi confirmation rows. Both the
// outer statement and the id sub-select must carry the entity_type filter, or a
// bare `id IN (...)` could reach another tenant's records in the shared table.
const entityFilters = (body.match(/entity_type = 'LexiPendingSchedule'/g) || []).length;
check('cleanup: DELETE is scoped to LexiPendingSchedule on both sides of the sub-select', entityFilters >= 2);
check('cleanup: touches no other entity type', !/entity_type = '(?!LexiPendingSchedule)/.test(body));
check('cleanup: only deletes, never mutates other records', !/\bUPDATE\s+generic_entities/i.test(body) && !/\bINSERT\s+INTO/i.test(body));

// Age gate: rows must outlive their 10-minute TTL by a grace margin before removal.
check('cleanup: age gate uses created_date (a JSONB timestamp cast throws on one bad row)',
  body.includes('created_date <') && !/data->>'expires_at'\)::timestamptz/.test(body));
check('cleanup: deletes in bounded batches', /LIMIT \$?\d?/.test(body) && body.includes('BATCH_SIZE'));

// Both schedulers must run it.
check('dev cron: job registered in vite-cron-plugin', devCron.includes(`name: '${JOB}'`));
check('prod cron: job mirrored in prod-server', prodCron.includes(`callInternalFunction('${JOB}'`));

console.log(`\n${failed ? `${failed} TEST(S) FAILED` : 'ALL TESTS PASSED'}`);
process.exit(failed ? 1 : 0);
