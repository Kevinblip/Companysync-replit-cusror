const assert = require('assert');
const fs = require('fs');
const path = require('path');

(async () => {
  const { assertSmsRecipientAllowed, normalizeSmsPhone } = require(
    path.join(__dirname, '..', 'lib', 'smsRecipientGuard.cjs')
  );

  assert.strictEqual(normalizeSmsPhone('(216) 555-1234'), '+12165551234');
  assert.strictEqual(normalizeSmsPhone('+442071838750'), '+442071838750');
  assert.strictEqual(normalizeSmsPhone('0000000000'), '');
  assert.strictEqual(normalizeSmsPhone('1111111111'), '');
  assert.strictEqual(normalizeSmsPhone('2160000000'), '');
  assert.strictEqual(normalizeSmsPhone('1234'), '');

  const junkCases = [
    { name: 'jhon 2', phone: '+12165551234', reason: 'name' },
    { name: 'Tesr', phone: '+12165551234', reason: 'name' },
    { name: 'Real Lead', email: 'jhon@yopmail.com', phone: '+12165551234', reason: 'email' },
    { name: 'Real Lead', phone: '+12165551234', leadStatus: 'Demo', reason: 'status' },
    { name: 'Real Lead', phone: '+12165551234', isTest: true, reason: 'flag' },
    { name: 'Real Lead', phone: '0000000000', reason: 'phone' },
  ];
  for (const test of junkCases) {
    const result = assertSmsRecipientAllowed(test);
    assert.strictEqual(result.ok, false, `expected ${test.reason} case to skip`);
  }

  assert.deepStrictEqual(
    assertSmsRecipientAllowed({
      name: 'Jane Homeowner',
      email: 'jane@example.org',
      phone: '(216) 555-1234',
      leadStatus: 'new',
    }),
    { ok: true, normalizedPhone: '+12165551234' },
  );

  process.env.SMS_TEST_ALLOWLIST = '+12165551234';
  assert.strictEqual(
    assertSmsRecipientAllowed({
      name: 'jhon 2',
      email: 'test@yopmail.com',
      phone: '(216) 555-1234',
      leadStatus: 'Demo',
    }).ok,
    true,
  );
  delete process.env.SMS_TEST_ALLOWLIST;

  const plugin = fs.readFileSync(path.join(__dirname, '..', 'vite-functions-plugin.js'), 'utf8');

  assert.doesNotMatch(plugin, /functions\/utils\/smsRecipientGuard/);
  assert.match(plugin, /nodeRequire\('\.\/lib\/smsRecipientGuard\.cjs'\)/);
  assert.match(plugin, /isTest: d\.is_test/);
  assert.match(plugin, /is_junk: recipient\.isJunk/);
  assert.match(plugin, /return \{ success: false, skipped: true, reason \}/);

  console.log('SMS recipient guard checks passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});