'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-phone-'));
process.env.SALES_AGENT_DATA_DIR = dataDir;
process.env.STAGING_READ_ONLY_SIDE_EFFECTS = '1';
process.env.SALES_AGENT_DRY_RUN = '1';
process.env.SALES_AGENT_SKIP_SYNOPSIS = '1';
process.env.SALES_AGENT_SKIP_SMS_BRAIN = '1';
process.env.SALES_AGENT_SKIP_CALENDAR = '1';
process.env.TWILIO_AUTH_TOKEN = 'test-twilio-token';
process.env.SALES_AGENT_PHONE_NUMBER = '+18886703112';
process.env.SALES_AGENT_SMS_FROM = '+18886703112';
process.env.SALES_AGENT_PHONE_ALLOWLIST = '+12163318323';
delete process.env.SALES_AGENT_DB_WRITES;

const staging = require('../lib/stagingSideEffects.cjs');
staging.installOutboundGuards();

const policy = require('../lib/salesAgent/phonePolicy.cjs');
const audio = require('../lib/salesAgent/audio.cjs');
const http = require('../lib/salesAgent/http.cjs');
const outbound = require('../lib/salesAgent/outbound.cjs');
const store = require('../lib/salesAgent/salesStore.cjs');
const pricing = require('../lib/salesAgent/pricing.cjs');

function formReq({ url, body, signature, host = 'localhost' }) {
  return {
    method: 'POST',
    url,
    headers: {
      host,
      'x-forwarded-proto': 'https',
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signature || '',
    },
    destroy() {},
    on(event, fn) {
      if (event === 'data') queueMicrotask(() => fn(Buffer.from(body)));
      if (event === 'end') queueMicrotask(() => fn());
    },
  };
}

function res() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(payload) { this.body = payload; },
  };
}

function signedBody(pathname, fields) {
  const params = { ...fields };
  const body = new URLSearchParams(params).toString();
  const url = `https://localhost${pathname}`;
  const signature = policy.twilioSignature(process.env.TWILIO_AUTH_TOKEN, url, params);
  return { body, signature, params };
}

async function post(pathname, fields, { signature, body } = {}) {
  const packed = body ? { body, signature } : signedBody(pathname, fields);
  const response = res();
  const handled = await http.handleSalesRequest(formReq({
    url: pathname,
    body: packed.body,
    signature: signature === undefined ? packed.signature : signature,
  }), response);
  assert.strictEqual(handled, true);
  return response;
}

(async () => {
  assert.strictEqual(policy.isColeNumber('+1 (888) 670-3112'), true);
  assert.strictEqual(policy.isColeNumber('+18886703112'), true);
  assert.strictEqual(policy.isColeNumber('+12167777154'), false);
  assert.strictEqual(policy.phoneAllowed('+1 216-331-8323'), true);
  assert.strictEqual(policy.phoneAllowed('+15555550100'), false);
  assert.strictEqual(policy.smsFromNumber(), '+18886703112');
  assert.strictEqual(policy.transactionalSmsKind('booking_confirmation'), true);
  assert.strictEqual(policy.transactionalSmsKind('reminder_24h'), true);
  assert.strictEqual(policy.transactionalSmsKind('reminder_1h'), true);
  assert.strictEqual(policy.transactionalSmsKind('day5_checkin'), false);
  assert.strictEqual(policy.transactionalSmsKind('no_show'), false);
  assert.strictEqual(policy.transactionalSmsKind('trial_link'), false);
  assert.strictEqual(policy.keywordKind('STOP'), 'stop');
  assert.strictEqual(policy.keywordKind('Help'), 'help');

  const previousNumber = process.env.SALES_AGENT_PHONE_NUMBER;
  const previousSms = process.env.SALES_AGENT_SMS_FROM;
  process.env.SALES_AGENT_PHONE_NUMBER = '+19995550111';
  process.env.SALES_AGENT_SMS_FROM = '+19995550111';
  assert.strictEqual(policy.isColeNumber('+19995550111'), true);
  assert.strictEqual(policy.isColeNumber('+18886703112'), false);
  assert.strictEqual(policy.isColeNumber('+12167777154'), false);
  process.env.SALES_AGENT_PHONE_NUMBER = previousNumber;
  process.env.SALES_AGENT_SMS_FROM = previousSms;

  const previousList = process.env.SALES_AGENT_PHONE_ALLOWLIST;
  delete process.env.SALES_AGENT_PHONE_ALLOWLIST;
  assert.strictEqual(policy.allowlistActive(), false);
  assert.strictEqual(policy.phoneAllowed('+15555550100'), true);
  process.env.SALES_AGENT_PHONE_ALLOWLIST = previousList;

  const pcm = Buffer.alloc(4800);
  const mulaw = audio.geminiToTwilio(pcm.toString('base64'));
  assert.ok(mulaw.length > 10);
  const frames = audio.mulawFrames(mulaw);
  assert.ok(frames.length > 0);
  assert.ok(frames.every((frame) => Buffer.from(frame, 'base64').length <= 160));
  assert.ok(Buffer.from(audio.twilioToGemini(mulaw), 'base64').length > 0);

  const bad = await post('/api/sales-agent/voice', {
    From: '+12163318323',
    To: '+18886703112',
    CallSid: 'CA_bad',
  }, { body: 'From=%2B12163318323&To=%2B18886703112&CallSid=CA_bad', signature: 'not-a-signature' });
  assert.strictEqual(bad.statusCode, 403);
  assert.match(bad.body, /<Reject\/>/);

  const voice = await post('/api/sales-agent/voice', {
    From: '+12163318323',
    To: '+18886703112',
    CallSid: 'CA_ok',
  });
  assert.strictEqual(voice.statusCode, 200);
  assert.match(voice.body, /<Say[^>]*>This call is recorded and transcribed so we can follow up accurately\.<\/Say>/);
  assert.strictEqual((voice.body.match(/This call is recorded and transcribed/g) || []).length, 1);
  assert.match(voice.body, /<Connect action="https:\/\/localhost\/api\/sales-agent\/voice-fallback"/);
  assert.match(voice.body, /<Stream url="wss:\/\/localhost\/ws\/sales-phone"/);
  const previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = 'https://getcompanysync.com';
  assert.strictEqual(
    policy.streamUrl({ headers: { host: 'companysync-web-production.up.railway.app', 'x-forwarded-proto': 'https' } }),
    'wss://companysync-web-production.up.railway.app/ws/sales-phone',
  );
  if (previousAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousAppUrl;

  const again = await post('/api/sales-agent/voice', {
    From: '+12163318323',
    To: '+18886703112',
    CallSid: 'CA_ok',
  });
  assert.strictEqual(again.statusCode, 200);
  assert.ok(!again.body.includes('This call is recorded'));
  assert.ok(!again.body.includes('<Stream'));
  assert.match(again.body, /Sorry, Cole can&apos;t join this call right now/);
  assert.match(again.body, /<Hangup\/>/);

  const third = await post('/api/sales-agent/voice', {
    From: '+12163318323',
    To: '+18886703112',
    CallSid: 'CA_ok',
  });
  assert.ok(!third.body.includes('This call is recorded'));
  assert.ok(!third.body.includes('Sorry, Cole can'));
  assert.match(third.body, /<Hangup\/>/);

  const fallback = await post('/api/sales-agent/voice-fallback', {
    From: '+12163318323',
    To: '+18886703112',
    CallSid: 'CA_never_connected',
  });
  assert.match(fallback.body, /Sorry, Cole can&apos;t join this call right now/);
  assert.match(fallback.body, /<Hangup\/>/);
  assert.ok(!fallback.body.includes('<Stream'));
  assert.match(voice.body, /name="from" value="\+12163318323"/);
  assert.ok(!voice.body.includes('2167777154'));
  pricing.assertCatalogPrices(voice.body, 'voice twiml');

  const blockedCaller = await post('/api/sales-agent/voice', {
    From: '+15555550199',
    To: '+18886703112',
    CallSid: 'CA_block',
  });
  assert.strictEqual(blockedCaller.statusCode, 200);
  assert.match(blockedCaller.body, /This test line can only take calls/);
  assert.ok(!blockedCaller.body.includes('<Stream'));

  const yicn = await post('/api/sales-agent/voice', {
    From: '+12163318323',
    To: '+12167777154',
    CallSid: 'CA_yicn',
  });
  assert.strictEqual(yicn.statusCode, 200);
  assert.ok(!yicn.body.includes('/ws/sales-phone'));
  assert.match(yicn.body, /<Say/);

  const help = await post('/api/sales-agent/sms', {
    From: '+12163318323',
    To: '+18886703112',
    Body: 'HELP',
    MessageSid: 'SM_help',
  });
  assert.strictEqual(help.statusCode, 200);
  assert.match(help.body, /<Message>/);
  assert.match(help.body, /Reply STOP to opt out/);
  assert.deepStrictEqual(pricing.foreignDollarAmounts(help.body), []);

  const chat = await post('/api/sales-agent/sms', {
    From: '+12163318323',
    To: '+18886703112',
    Body: 'Can you confirm my demo?',
    MessageSid: 'SM_chat',
  });
  assert.match(chat.body, /<Message>/);
  assert.match(chat.body, /Cole/);
  assert.deepStrictEqual(pricing.foreignDollarAmounts(chat.body), []);

  const stranger = await post('/api/sales-agent/sms', {
    From: '+15555550999',
    To: '+18886703112',
    Body: 'Tell me about pricing',
    MessageSid: 'SM_stranger',
  });
  assert.ok(!stranger.body.includes('<Message>'));

  const stop = await post('/api/sales-agent/sms', {
    From: '+12163318323',
    To: '+18886703112',
    Body: 'STOP',
    MessageSid: 'SM_stop',
  });
  assert.match(stop.body, /unsubscribed/);
  const opted = store.readState().leads.find((lead) => policy.last10(lead.phone) === '2163318323');
  assert.ok(opted && opted.optedOut);

  const otherLine = await post('/api/sales-agent/sms', {
    From: '+12163318323',
    To: '+12167777154',
    Body: 'HELP',
    MessageSid: 'SM_other',
  });
  assert.ok(!otherLine.body.includes('<Message>'));

  const missed = await post('/api/sales-agent/status', {
    From: '+12163318323',
    To: '+18886703112',
    CallSid: 'CA_miss',
    CallStatus: 'no-answer',
  });
  assert.strictEqual(missed.statusCode, 200);
  assert.ok(store.readState().notifications.some((note) => note.kind === 'missed_call' && note.title.includes('+12163318323')));
  assert.ok(store.readState().calls.some((call) => call.callSid === 'CA_miss' && call.outcome === 'missed'));

  const fetches = [];
  globalThis.__stagingOriginalFetch = async (url) => {
    fetches.push(String(url));
    return new Response(JSON.stringify({ sid: 'SM_real', status: 'queued' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const held = await outbound.deliverSms({ to: '+15555550111', body: 'booked', kind: 'booking_confirmation' });
  assert.strictEqual(held.suppressed, true);
  assert.strictEqual(fetches.length, 0);
  const real = await outbound.deliverSms({ to: '+12163318323', body: 'Your demo is booked.', kind: 'booking_confirmation' });
  assert.strictEqual(real.sid, 'SM_real');
  assert.strictEqual(real.suppressed, false);
  assert.strictEqual(fetches.length, 1);
  assert.match(fetches[0], /\/Messages\.json$/);
  const marketing = await outbound.deliverSms({ to: '+12163318323', body: 'checking in', kind: 'day5_checkin' });
  assert.strictEqual(marketing.reason, 'sms_not_transactional');
  assert.strictEqual(fetches.length, 1);

  const repo = process.cwd();
  const prod = fs.readFileSync(path.join(repo, 'prod-server.cjs'), 'utf8');
  assert.ok(!prod.includes("slice(-10) === '2167777154'"));
  assert.ok(prod.includes('/ws/sales-phone'));
  assert.ok(prod.includes("'+12167777154'"));
  const incoming = fs.readFileSync(path.join(repo, 'functions/incomingCall.ts'), 'utf8');
  assert.ok(!incoming.includes('2167777154'));
  assert.ok(incoming.includes('SALES_AGENT_PHONE_NUMBER'));
  assert.ok(incoming.includes('/ws/sales-phone'));
  assert.ok(fs.readFileSync(path.join(repo, 'vite-sales-demo-plugin.js'), 'utf8').includes('/ws/sales-phone'));

  staging.restoreOutboundGuards();
  console.log('sales phone tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
