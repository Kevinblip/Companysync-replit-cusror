#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const guard = fs.readFileSync('src/hooks/usePageGuard.jsx', 'utf8');
const pages = fs.readFileSync('src/pages.config.js', 'utf8');
const layout = fs.readFileSync('src/Layout.jsx', 'utf8');

assert.match(pages, /"Workflows":\s*Workflows/, 'Workflows must remain registered as a page');
assert.match(layout, /url:\s*createPageUrl\("Workflows"\)/, 'menu must point to the Workflows route');
assert.match(guard, /featureKey === 'workflows' \? \['workflow_automation'\]/, 'page guard must accept the legacy workflow permission alias');
assert.match(guard, /hasCapability\('view'\)/, 'page guard must evaluate resolved permission aliases');

console.log('PASS: Workflow Automation menu and guarded route use compatible permission keys');