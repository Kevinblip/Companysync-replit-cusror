#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'prod-server.cjs'), 'utf8');
const viteSource = fs.readFileSync(path.join(__dirname, '..', 'vite-functions-plugin.js'), 'utf8');
let failed = 0;

function expect(name, condition) {
  if (condition) {
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

const callbackStart = source.indexOf("if (pathname === '/api/google-calendar-callback' && req.method === 'GET')");
const callbackEnd = source.indexOf('// Gmail debug', callbackStart);
const callback = source.slice(callbackStart, callbackEnd);

expect('production callback is present', callbackStart >= 0 && callbackEnd > callbackStart);
expect(
  'production callback splits the signed state payload and signature',
  /const \[statePayload, stateSignature\] = String\(state \|\| ''\)\.split\('\.'\);/.test(callback)
);
expect(
  'production callback validates the HMAC with the session secret',
  /createHmac\('sha256', process\.env\.SESSION_SECRET\)[\s\S]*digest\('base64url'\)/.test(callback)
);
expect(
  'production callback decodes only the base64url payload and rejects expired states',
  /Buffer\.from\(statePayload, 'base64url'\)[\s\S]*stateData\.expires_at/.test(callback)
);
expect(
  'calendar token refresh serializes per-user refresh attempts',
  /gcal_token_refresh:.*pg_advisory_lock/.test(viteSource.replace(/\n/g, ' '))
);
expect(
  'calendar token refresh preserves a rotated refresh token',
  /google_refresh_token = \$2/.test(viteSource)
);
expect(
  'invalid_client does not clear a user calendar connection',
  !/const revoked = tokens\.error === 'invalid_grant' \|\| tokens\.error === 'invalid_client'/.test(viteSource)
);
expect(
  'a Google calendar 401 gets one serialized refresh retry',
  /retriedAfter401[\s\S]*forceRefresh: true[\s\S]*googleResp = await fetch/.test(viteSource)
);

console.log(`\n${8 - failed}/8 assertions passed`);
process.exit(failed ? 1 : 0);