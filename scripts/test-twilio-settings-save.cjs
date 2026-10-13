const assert = require('node:assert/strict');
const { test } = require('node:test');
const helper = import('../src/utils/twilioSettingsSave.js');

const existing = {
  account_sid: 'AC123',
  auth_token: 'token',
  main_phone_number: '+1 (216) 555-0100',
  available_numbers: [{ phone_number: '+12165550101', label: 'Sales', assigned_to: 'rep@example.test' }],
  api_key_sid: 'SK123',
  api_key_secret: 'secret',
  twiml_app_sid: 'AP123',
  enable_sms: true,
};

test('existing connection with unchanged credentials saves only feature preferences', async () => {
  const { prepareTwilioSettingsSave } = await helper;
  const result = prepareTwilioSettingsSave(existing, {
    ...existing,
    main_phone_number: '+12165550100',
    enable_recording: false,
  });
  assert.equal(result.mode, 'preferences');
  assert.deepEqual(result.data, {
    enable_sms: true,
    enable_calling: undefined,
    enable_recording: false,
    enable_transcription: undefined,
    enable_ai_summary: undefined,
    enable_sms_auto_summary: undefined,
  });
});

test('a new Twilio connection takes the protected connection-validation path', async () => {
  const { prepareTwilioSettingsSave } = await helper;
  const result = prepareTwilioSettingsSave(null, existing);
  assert.equal(result.mode, 'connection');
  assert.equal(result.data.auth_token, 'token');
});

test('changing credentials, phone, extra numbers, or browser dialer keys is not preference-only', async () => {
  const { prepareTwilioSettingsSave } = await helper;
  const changes = [
    { auth_token: 'new-token' },
    { main_phone_number: '+12165550199' },
    { available_numbers: [] },
    { api_key_sid: 'SK999' },
    { twiml_app_sid: 'AP999' },
  ];
  for (const change of changes) {
    const result = prepareTwilioSettingsSave(existing, { ...existing, ...change });
    assert.equal(result.mode, 'connection');
    assert.ok('auth_token' in result.data);
  }
});

test('reformatting a phone number alone does not revalidate the Twilio connection', async () => {
  const { prepareTwilioSettingsSave } = await helper;
  const result = prepareTwilioSettingsSave(existing, {
    ...existing,
    main_phone_number: '216-555-0100',
    enable_calling: false,
  });
  assert.equal(result.mode, 'preferences');
});
