'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  validateSignupEmail,
  checkSignupAbuse,
} = require('../lib/signupSafety.cjs');

const originalDeployment = process.env.REPLIT_DEPLOYMENT;
const originalNodeEnv = process.env.NODE_ENV;
let passed = 0;

function check(label, condition, details) {
  if (!condition) {
    console.error(`✗ ${label}`, details || '');
    process.exitCode = 1;
    return;
  }
  passed += 1;
  console.log(`✓ ${label}`);
}

try {
  delete process.env.REPLIT_DEPLOYMENT;
  process.env.NODE_ENV = 'development';
  check('normal Gmail signup is allowed', validateSignupEmail('owner@gmail.com').allowed);
  check('Yopmail is rejected', !validateSignupEmail('sync@yopmail.com').allowed);
  check('generated probe domains are rejected', !validateSignupEmail('x@t1536probe.com').allowed);
  check('generated race domains are rejected', !validateSignupEmail('x@t1536race.com').allowed);
  check('development example fixtures remain available', validateSignupEmail('fixture@example.com').allowed);

  process.env.REPLIT_DEPLOYMENT = '1';
  process.env.NODE_ENV = 'production';
  check('production example fixtures are rejected', !validateSignupEmail('fixture@example.com').allowed);
  check('production .invalid fixtures are rejected', !validateSignupEmail('fixture@company.invalid').allowed);

  const calls = [];
  const limiter = (key, options) => {
    calls.push({ key, options });
    const count = calls.filter(call => call.key === key).length;
    return { allowed: count <= options.max, retryAfterMs: 3600000 };
  };
  check('domain throttle allows first three attempts', checkSignupAbuse({ email: 'a@gmail.com', ip: '1.2.3.4', checkRateLimit: limiter }).allowed);
  check('domain throttle allows second attempt', checkSignupAbuse({ email: 'b@gmail.com', ip: '1.2.3.4', checkRateLimit: limiter }).allowed);
  check('domain throttle allows third attempt', checkSignupAbuse({ email: 'c@gmail.com', ip: '1.2.3.4', checkRateLimit: limiter }).allowed);
  check('domain throttle rejects the fourth attempt', !checkSignupAbuse({ email: 'd@gmail.com', ip: '1.2.3.4', checkRateLimit: limiter }).allowed);

  const localAuth = fs.readFileSync(path.join(__dirname, '..', 'db', 'local-auth.cjs'), 'utf8');
  const plugin = fs.readFileSync(path.join(__dirname, '..', 'vite-functions-plugin.js'), 'utf8');
  check('local auth uses the shared signup guard', localAuth.includes("require('../lib/signupSafety.cjs')"));
  check('public onboarding uses the shared signup guard', plugin.includes("nodeRequire('./lib/signupSafety.cjs')"));
  check('marketing onboarding uses the shared signup guard', plugin.includes('async autoSignupFromMarketing') && plugin.includes('checkSignupAbuse'));
  check('synthetic trial alerts are suppressed', plugin.includes('isSyntheticSignupEmail(ownerEmail)'));
  check('trial alerts are production-only', plugin.includes("process.env.REPLIT_DEPLOYMENT !== '1' || isSyntheticSignupEmail(ownerEmail)"));
} finally {
  if (originalDeployment === undefined) delete process.env.REPLIT_DEPLOYMENT;
  else process.env.REPLIT_DEPLOYMENT = originalDeployment;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
}

if (process.exitCode) {
  console.error(`\n${passed} signup safety checks passed; failures found.`);
  process.exit(1);
}
console.log(`\n${passed} signup safety checks passed.`);