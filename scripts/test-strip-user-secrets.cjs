const assert = require('assert');
const fs = require('fs');
const { stripUserSecrets, redactUserSecrets, isSecretUserField } = require('../lib/stripUserSecrets.cjs');
const { ghlOauthConfigured } = require('../lib/ghlConfig.cjs');
const { handleGetUser } = require('../db/prod-auth.cjs');

const leakedUser = {
  id: 'user_1',
  email: 'rep@example.com',
  first_name: 'Rep',
  last_name: 'One',
  password_hash: '$2b$10$should-not-leak',
  password: 'plaintext-no',
  is_local_auth: true,
  must_change_password: false,
  gmail_access_token: 'gmail-access',
  gmail_refresh_token: 'gmail-refresh',
  gmail_token_expires_at: '2026-01-01T00:00:00Z',
  gmail_email: 'rep@gmail.com',
  gmail_connected: true,
  google_access_token: 'gcal-access',
  google_refresh_token: 'gcal-refresh',
  google_token_expires_at: '2026-01-01T00:00:00Z',
  google_calendar_connected: true,
  microsoft_access_token: 'ms-access',
  microsoft_refresh_token: 'ms-refresh',
  microsoft_token_expires_at: '2026-01-01T00:00:00Z',
  api_key: 'should-not-leak',
  client_secret: 'should-not-leak',
  has_access_token: true,
  platform_role: 'user',
};

const safe = stripUserSecrets(leakedUser);
for (const key of [
  'password_hash', 'password', 'gmail_access_token', 'gmail_refresh_token',
  'gmail_token_expires_at', 'google_access_token', 'google_refresh_token',
  'google_token_expires_at', 'microsoft_access_token', 'microsoft_refresh_token',
  'microsoft_token_expires_at', 'api_key', 'client_secret',
]) {
  assert.equal(safe[key], undefined, `stripped field still present: ${key}`);
}
assert.equal(safe.email, 'rep@example.com');
assert.equal(safe.must_change_password, false);
assert.equal(safe.gmail_connected, true);
assert.equal(safe.google_calendar_connected, true);
assert.equal(safe.gmail_email, 'rep@gmail.com');
assert.equal(safe.has_access_token, true);
assert.equal(isSecretUserField('must_change_password'), false);

const integrationConfig = {
  access_token: 'qb-access',
  refresh_token: 'qb-refresh',
  realm_id: '123',
};
assert.deepEqual(redactUserSecrets(integrationConfig), integrationConfig);

const nested = redactUserSecrets({
  data: { user: leakedUser, quickbooks: integrationConfig },
});
assert.equal(nested.data.user.password_hash, undefined);
assert.equal(nested.data.user.google_refresh_token, undefined);
assert.equal(nested.data.user.email, 'rep@example.com');
assert.equal(nested.data.quickbooks.access_token, 'qb-access');

assert.equal(ghlOauthConfigured({}), false);
assert.equal(ghlOauthConfigured({ GHL_CLIENT_ID: ' id ', GHL_CLIENT_SECRET: '' }), false);
assert.equal(ghlOauthConfigured({ GHL_CLIENT_ID: 'id', GHL_CLIENT_SECRET: 'secret' }), true);

function mockRes() {
  return {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; },
    end(body) { this.body = body; },
  };
}

(async () => {
  const res = mockRes();
  const pool = {
    async query(sql) {
      if (sql.includes('FROM sessions')) return { rows: [] };
      if (sql.includes('FROM users')) return { rows: [leakedUser] };
      if (sql.includes('FROM staff_profiles')) return { rows: [{ is_administrator: true, is_super_admin: false }] };
      throw new Error('unexpected sql ' + sql);
    },
  };
  const req = {
    headers: { cookie: 'connect.sid=s:test.sig' },
  };
  // No valid session cookie, so this stays 401. Exercise the strip path directly
  // by calling the same response shape the handler builds.
  await handleGetUser(req, res, pool);
  assert.equal(res.status, 401);

  const authed = stripUserSecrets({ ...leakedUser, is_administrator: true });
  assert.equal(JSON.parse(JSON.stringify(authed)).password_hash, undefined);
  assert.equal(authed.is_administrator, true);

  const layout = fs.readFileSync('src/Layout.jsx', 'utf8');
  assert.match(layout, /sarah_answers: 'Alex Answers'/);
  assert.match(layout, /value="sarah_answers"/);
  assert.doesNotMatch(layout, /Sarah Answers/);

  const prod = fs.readFileSync('prod-server.cjs', 'utf8');
  assert.match(prod, /ghlOauthConfigured\(\)/);
  assert.match(prod, /process\.env\.PORT \|\| 5000/);
  assert.match(prod, /if \(!require\('\.\/lib\/ghlConfig\.cjs'\)\.ghlOauthConfigured\(\)\) return;/);

  console.log('strip-user-secrets checks passed');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
