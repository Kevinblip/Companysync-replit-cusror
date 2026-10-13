#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'ReminderSettingsPanel.jsx'),
  'utf8'
);

let failed = 0;
function expect(name, condition) {
  if (condition) console.log(`✓ ${name}`);
  else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

const mergeStart = source.indexOf('function mergeWithDefaults(saved)');
const mergeEnd = source.indexOf('function buildDefaultStaffPrefs()', mergeStart);
const merge = source.slice(mergeStart, mergeEnd);

expect('personal reminder preference merger is present', mergeStart >= 0 && mergeEnd > mergeStart);
expect(
  'legacy direct interval keys are supported',
  /const savedIntervals = saved\.intervals \|\| saved;/.test(merge)
);
expect(
  'all interval reads use the normalized settings object',
  /savedIntervals\[key\]/.test(merge) && !/saved\.intervals\[key\]/.test(merge)
);

console.log(`\n${3 - failed}/3 assertions passed`);
process.exit(failed ? 1 : 0);