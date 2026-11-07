'use strict';

const assert = require('node:assert/strict');
const { resolveAppUrl } = require('../lib/appUrl.cjs');

function withEnv(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] == null) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] == null) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

const req = (headers) => ({ headers });

withEnv({ APP_URL: 'https://app.example.com/', REPLIT_DOMAINS: 'old.replit.app' }, () => {
  assert.equal(resolveAppUrl(req({ host: 'evil.example', origin: 'https://evil.example' })), 'https://app.example.com');
});

withEnv({ APP_URL: '', REPLIT_DOMAINS: '' }, () => {
  assert.equal(resolveAppUrl(req({
    'x-forwarded-host': 'getcompanysync.com',
    'x-forwarded-proto': 'https',
    origin: 'https://evil.example',
  })), 'https://getcompanysync.com');
  assert.equal(resolveAppUrl(req({ host: 'crm.railway.app' })), 'https://crm.railway.app');
  assert.equal(resolveAppUrl(req({ host: 'localhost:5000' })), 'http://localhost:5000');
  assert.equal(resolveAppUrl(req({ host: 'bad host' })), 'http://localhost:5000');
  assert.equal(resolveAppUrl(), 'http://localhost:5000');
});

withEnv({ APP_URL: '', REPLIT_DOMAINS: 'companysync.replit.app,extra.replit.app' }, () => {
  assert.equal(resolveAppUrl(), 'https://companysync.replit.app');
});

console.log('PASS app url');
