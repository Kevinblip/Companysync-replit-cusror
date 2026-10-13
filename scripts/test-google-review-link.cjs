#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const plugin = fs.readFileSync('vite-functions-plugin.js', 'utf8');
const processRequests = fs.readFileSync('functions/processReviewRequests.ts', 'utf8');
const runNow = fs.readFileSync('functions/runReviewRequestsNow.ts', 'utf8');
const taskReview = fs.readFileSync('functions/sendTaskCompletionReviewEmail.ts', 'utf8');
const tracker = fs.readFileSync('functions/trackReviewClick.ts', 'utf8');

assert.match(plugin, /'https:\/\/tiny\.one\/letsreview'/, 'local review handlers must use the working fallback');
assert.doesNotMatch(plugin, /https:\/\/g\.page\/r\/review/, 'local handlers must not use the broken placeholder link');
assert.doesNotMatch(plugin, /google\.com\/search\?q=.*reviews/, 'workflow review messages must not fall back to a search page');
assert.match(processRequests, /https:\/\/tiny\.one\/letsreview/, 'scheduled review requests must use the working fallback');
assert.match(runNow, /https:\/\/tiny\.one\/letsreview/, 'manual review requests must use the working fallback');
assert.match(taskReview, /https:\/\/tiny\.one\/letsreview/, 'task completion review email must use the working fallback');
assert.match(processRequests, /CompanySetting\.filter\(\{ company_id: rr\.company_id \}\)/, 'scheduled requests must use the current company setting');
assert.match(runNow, /CompanySetting\.filter\(\{ company_id: rr\.company_id \}\)/, 'manual requests must use the current company setting');
assert.doesNotMatch(processRequests, /trackedLink/, 'scheduled email hrefs must not use the unreliable tracking hop');
assert.doesNotMatch(runNow, /trackedLink/, 'manual email hrefs must not use the unreliable tracking hop');
assert.match(processRequests, /htmlBody = emailTpl\.body\.replaceAll/, 'scheduled email must retain the resolved direct link');
assert.match(runNow, /htmlBody = emailTpl\.body\.replaceAll/, 'manual email must retain the resolved direct link');
assert.match(tracker, /safeTarget = 'https:\/\/tiny\.one\/letsreview'/, 'legacy tracker must have a working fallback');
assert.doesNotMatch(tracker, /Response\.redirect\('https:\/\/google\.com'/, 'tracker must never redirect customers to generic Google');

console.log('PASS: automated Google review messages use a direct, company-scoped review destination');