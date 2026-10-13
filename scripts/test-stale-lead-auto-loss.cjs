#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const handlers = fs.readFileSync('vite-functions-plugin.js', 'utf8');
const production = fs.readFileSync('prod-server.cjs', 'utf8');
const check = handlers.slice(handlers.indexOf('async checkStaleLeads(params)'), handlers.indexOf('\n  },', handlers.indexOf('async checkStaleLeads(params)')));

assert.match(check, /created_at < \$2/, 'auto-close must use lead age');
assert.match(check, /60 \* 24 \* 60 \* 60 \* 1000/, 'auto-close threshold must be 60 days');
assert.match(check, /\(status = 'New' OR status = 'new'\)/, 'auto-close must only target New leads');
assert.match(check, /\(is_active IS NULL OR is_active = true\)/, 'auto-close must leave inactive leads alone');
assert.match(check, /status = 'lost'/, 'auto-close must set lost status');
assert.match(check, /is_active = false/, 'auto-close must close the lead');
assert.match(check, /'lost_reason', 'stale_60_days'/, 'auto-close must record why it closed');
assert.match(check, /RETURNING id, name/, 'auto-close must report affected leads');
assert.match(production, /Also closes untouched New leads at 60 days/, 'production cron must document the new behavior');
assert.match(production, /Startup catch-up marked/, 'production cron must catch up after startup');
assert.match(production, /d\.totalLost > 0/, 'production cron must surface auto-closed leads');

console.log('PASS: stale New leads are auto-marked lost after 60 days');