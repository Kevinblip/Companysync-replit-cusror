#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

for (const file of ['vite-functions-plugin.js', 'prod-server.cjs']) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const marker = '`[Cron:stormAlerts] ran — ';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${file} must log the storm alert heartbeat`);

  const heartbeat = source.slice(start, start + 400);
  assert.match(heartbeat, /\$\{result\.totalStorms \|\| 0\} candidates/);
  assert.match(heartbeat, /\$\{result\.totalCompanies \|\| 0\} companies/);
  assert.match(
    heartbeat,
    /\$\{\(result\.emailsSent \|\| 0\) \+ \(result\.smsSent \|\| 0\)\} sent/
  );
  assert.doesNotMatch(heartbeat, /JSON\.stringify/);
}

console.log('Storm alert heartbeat is present in development and production.');