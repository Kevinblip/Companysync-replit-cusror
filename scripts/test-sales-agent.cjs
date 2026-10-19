'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-agent-'));
process.env.SALES_AGENT_DATA_DIR = dataDir;
process.env.STAGING_READ_ONLY_SIDE_EFFECTS = '1';
process.env.SALES_AGENT_DRY_RUN = '1';
process.env.SALES_AGENT_SKIP_SYNOPSIS = '1';
process.env.SALES_AGENT_SKIP_CALENDAR = '1';
delete process.env.SALES_AGENT_DB_WRITES;

const staging = require('../lib/stagingSideEffects.cjs');
staging.installOutboundGuards();

const pricing = require('../lib/salesAgent/pricing.cjs');
const clips = require('../lib/salesAgent/clips.cjs');
const prompt = require('../lib/salesAgent/prompt.cjs');
const templates = require('../lib/salesAgent/templates.cjs');
const store = require('../lib/salesAgent/salesStore.cjs');
const dbAdapter = require('../lib/salesAgent/dbAdapter.cjs');
const booking = require('../lib/salesAgent/booking.cjs');
const sequences = require('../lib/salesAgent/sequences.cjs');
const tools = require('../lib/salesAgent/tools.cjs');
const summary = require('../lib/salesAgent/summary.cjs');
const scheduler = require('../lib/salesAgent/scheduler.cjs');
const http = require('../lib/salesAgent/http.cjs');
const recording = require('../lib/salesAgent/recording.cjs');

const logs = [];
const originalLog = console.log;
console.log = (...args) => {
  logs.push(args.join(' '));
  originalLog(...args);
};

function req({ method = 'GET', url, body, ip = '203.0.113.10' }) {
  return {
    method,
    url,
    headers: { host: 'localhost:5000', origin: 'http://localhost:5000' },
    socket: { remoteAddress: ip },
    destroy() {},
    on(event, fn) {
      if (event === 'data' && body != null) queueMicrotask(() => fn(Buffer.from(JSON.stringify(body))));
      if (event === 'end') queueMicrotask(() => fn());
      if (event === 'error') return;
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
    finished: false,
  };
}

async function call(method, url, body, extra) {
  const response = res();
  const handled = await http.handleSalesRequest(req({ method, url, body }), response, extra || {});
  assert.strictEqual(handled, true);
  return { status: response.statusCode, json: response.body ? JSON.parse(response.body) : null };
}

(async () => {
  const system = prompt.buildSalesSystemPrompt();
  assert.ok(system.includes(prompt.AI_LINE));
  assert.ok(system.includes(prompt.RECORDING_LINE));
  assert.deepStrictEqual(pricing.foreignDollarAmounts(system), []);
  assert.ok(system.includes('$99'));
  assert.ok(system.includes('$199'));
  assert.ok(system.includes('$399'));
  assert.throws(() => pricing.assertCatalogPrices('It is $59 a month'), /outside/);
  assert.strictEqual(prompt.agentVoice(), 'Fenrir');
  assert.strictEqual(prompt.agentName(), 'Cole');
  process.env.SALES_AGENT_VOICE = 'Charon';
  assert.strictEqual(prompt.agentVoice(), 'Charon');
  process.env.SALES_AGENT_VOICE = 'fenrir';
  assert.strictEqual(prompt.agentVoice(), 'Fenrir');
  process.env.SALES_AGENT_VOICE = 'Aoede';
  assert.strictEqual(prompt.agentVoice(), 'Fenrir');
  delete process.env.SALES_AGENT_VOICE;

  const phone = prompt.buildPhoneDemoPrompt();
  assert.ok(phone.includes('check_availability'));
  assert.ok(phone.includes('Do not call play_clip'));
  assert.ok(phone.includes('Read back the day, the time, and the time zone.'));
  assert.ok(phone.includes('Say the confirmation link was sent and that you will send a reminder.'));
  assert.ok(phone.includes('Ask if there is anything else or any questions, then answer them.'));
  assert.ok(phone.includes('Say a natural goodbye.'));
  assert.ok(phone.includes('Call end_call only after that goodbye, or let the caller hang up.'));
  assert.ok(phone.includes('Never call end_call in the same turn as book_appointment'));
  assert.ok(!phone.includes('Close by sending the trial link or booking time'));
  assert.ok(system.includes('Close by sending the trial link or booking time'));
  assert.deepStrictEqual(pricing.foreignDollarAmounts(phone), []);

  const raw = clips.loadRawClips();
  assert.strictEqual(raw.length, 33);
  const live = clips.agentClips();
  assert.strictEqual(live.length, 32);
  assert.ok(!live.some((clip) => clip.id === 'clip14-financing'));
  assert.ok(!live.some((clip) => /abc supply|hearth|greensky|wisetack|financ/i.test(JSON.stringify(clip))));
  assert.strictEqual(clips.resolveClip('clip14-financing').ok, false);
  const played = clips.resolveClip('clip04-ai-estimator', 4.1, 29.6);
  assert.strictEqual(played.ok, true);
  assert.ok(played.url.startsWith('https://getcompanysync.com/videos/'));

  for (const kind of Object.keys(templates.RENDERERS)) {
    const rendered = templates.renderTemplate(kind, {
      first_name: 'Sam',
      last_name: 'Lee',
      company: 'Lee Roofing',
      trade: 'storm',
      phone: '+15555550123',
      email: 'sam@example.com',
      team_size: '4',
      current_software: 'spreadsheet',
      pain: 'missed calls',
      rep_name: 'Kevin',
      agent_name: 'Cole',
      demo_time_local: 'Mon, Oct 19, 9:00 AM',
      tz: 'America/New_York',
      reschedule_url: 'https://example.test/SalesDemo/reschedule',
      join_url: 'https://example.test/SalesDemo',
      trial_url: 'https://example.test/PublicPricing',
      pricing_url: 'https://example.test/PublicPricing',
      book_url: 'https://example.test/SalesDemo',
      clip_url: 'https://getcompanysync.com/videos/clip04-ai-estimator.mp4',
      clip_title: 'AI Estimator',
      objection: 'price',
      recap_bullets: 'Alex and estimates',
      clip_links: 'https://getcompanysync.com/videos/clip04-ai-estimator.mp4',
      handoff_reason: 'a custom question',
      clips_shown: 'clip04',
      objections: 'price',
      next_step: 'rep call',
      recording_url: '',
      transcript_url: '',
      unsubscribe_url: 'https://example.test/unsub',
      date: '2026-10-19',
      calls: '1',
      minutes: '3',
      demos: '1',
      no_shows: '0',
      trials: '0',
      subs: '0',
      handoffs: '0',
      top_objections: 'price',
      stage_moves: 'New to Demo Booked',
      review_links: 'none',
    });
    pricing.assertCatalogPrices(JSON.stringify(rendered), kind);
  }

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push(String(url));
    return originalFetch(url, init);
  };

  const session = await call('POST', '/api/sales-demo/session');
  assert.strictEqual(session.status, 200);
  assert.strictEqual(session.json.agentName, 'Cole');
  assert.strictEqual(session.json.voice, 'Fenrir');
  assert.strictEqual(session.json.dryRun, true);

  const slots = await call('GET', '/api/sales-demo/slots');
  assert.ok(slots.json.slots.length > 0, 'expected open demo slots');
  const booked = await call('POST', '/api/sales-demo/book', {
    firstName: 'Sam',
    lastName: 'Lee',
    email: 'sam@example.com',
    phone: '+15555550123',
    company: 'Lee Roofing',
    trade: 'storm',
    start: slots.json.slots[slots.json.slots.length - 1].start,
  });
  assert.strictEqual(booked.status, 200, JSON.stringify(booked.json));
  assert.strictEqual(booked.json.lead.stage, 'Demo Booked');
  assert.strictEqual(booked.json.email.suppressed, true);
  assert.strictEqual(booked.json.sms.suppressed, true);

  const state = store.readState();
  const lead = state.leads[0];
  await store.update((draft) => {
    draft.calls.push({
      id: 'call_test',
      leadId: lead.id,
      bookingId: booked.json.booking.id,
      startedAt: new Date().toISOString(),
      transcript: [{ role: 'prospect', text: 'We use JobNimbus.', at: new Date().toISOString() }],
      clips: [],
      objections: [],
      outcome: '',
      synopsis: '',
    });
  });

  await sequences.enqueueNonBuyer(lead.id);
  const later = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
  const nurture = await sequences.runDue(later);
  assert.ok(nurture.sent > 0);

  const trial = await tools.handleTool('send_trial_link', { email: 'sam@example.com', first_name: 'Sam', phone: '+15555550123' }, { callId: 'call_test', appBase: 'https://example.test' });
  assert.strictEqual(trial.ok, true);
  const objection = await tools.handleTool('log_objection', { objection: 'price', note: 'asked for a discount' }, { callId: 'call_test' });
  assert.strictEqual(objection.ok, true);
  const ended = await tools.handleTool('end_call', { outcome: 'trial_link', summary: 'Wants to try one job.' }, { callId: 'call_test' });
  assert.strictEqual(ended.ok, true);

  const phoneSlots = booking.listSlots({});
  assert.ok(phoneSlots.length > 0, 'expected an open slot for the phone booking');
  const phoneBooked = await tools.handleTool('book_appointment', {
    slot_time: phoneSlots[phoneSlots.length - 1].start,
    name: 'Kevin Cole',
    email: 'kevin-phone@example.com',
    phone: '+12163318323',
  }, { callId: 'call_phone_book', channel: 'phone', appBase: 'https://example.test' });
  assert.strictEqual(phoneBooked.ok, true, JSON.stringify(phoneBooked));
  assert.strictEqual(phoneBooked.do_not_end_call, true);
  assert.match(phoneBooked.say, /Eastern time/);
  assert.match(phoneBooked.say, /confirmation link was sent/);
  assert.match(phoneBooked.say, /send a reminder/);
  assert.match(phoneBooked.say, /anything else or any questions/);
  assert.match(phoneBooked.say, /natural goodbye/);
  assert.match(phoneBooked.say, /Do not call end_call until that goodbye is finished/);
  assert.ok(phoneBooked.booking.when);
  assert.strictEqual(phoneBooked.booking.timezone_spoken, 'Eastern time');

  const preview = sequences.simulate({ leadId: lead.id });
  assert.ok(preview.messages.length >= 3);

  await sequences.runDue(later);

  const handoffSlots = booking.listSlots({});
  const handoff = await tools.handleTool('handoff_to_rep', {
    reason: 'custom contract',
    start_iso: handoffSlots[0].start,
    first_name: 'Sam',
    email: 'sam@example.com',
    phone: '+15555550123',
  }, { callId: 'call_test', appBase: 'https://example.test' });
  assert.strictEqual(handoff.ok, true, JSON.stringify(handoff));
  assert.strictEqual(handoff.rep, 'Kevin');

  const noshowLead = await booking.bookDemo({
    firstName: 'Riley',
    email: 'riley@example.com',
    phone: '+15555550199',
    trade: 'retail',
    start: handoffSlots[Math.min(3, handoffSlots.length - 1)].start,
  }, { appBase: 'https://example.test' });
  assert.strictEqual(noshowLead.ok, true);
  await sequences.runDue(new Date(new Date(noshowLead.booking.start).getTime() + 11 * 60 * 1000));
  const afterNoShow = store.readState().leads.find((row) => row.email === 'riley@example.com');
  assert.strictEqual(afterNoShow.stage, 'No-Show');

  const kinds = new Set(store.readState().messages.map((message) => message.kind));
  for (const kind of ['booking_confirmation', 'trial_link', 'handoff_prospect', 'trial_day1', 'day5_checkin', 'no_show']) {
    assert.ok(kinds.has(kind), `missing suppressed message ${kind}`);
  }
  assert.ok(store.readState().messages.every((message) => message.suppressed || message.skipped));
  assert.ok(store.readState().notifications.some((note) => note.kind === 'day5_task'));
  assert.ok(!calls.some((url) => /\/Calls\.json/i.test(url)), 'sales agent placed a phone call');
  assert.ok(logs.some((line) => line.includes('[staging] suppressed email')));
  assert.ok(logs.some((line) => line.includes('[staging] suppressed sms')));

  const adminDenied = await call('GET', '/api/sales-agent/admin/overview', null, {
    authorize: async () => ({ ok: false, status: 403 }),
  });
  assert.strictEqual(adminDenied.status, 403);
  const admin = await call('POST', '/api/sales-agent/admin/simulate', {}, {
    authorize: async () => ({ ok: true, email: 'admin@example.com' }),
  });
  assert.strictEqual(admin.status, 200);
  assert.ok(admin.json.messages.length >= 8);

  const daily = summary.buildDailySummary(new Date());
  pricing.assertCatalogPrices(daily.text, 'daily summary');
  scheduler.startSalesAgentScheduler();
  assert.ok(staging.skippedSchedulers.includes('salesAgentScheduler'));

  const recorder = recording.createRecorder('call_wav');
  recorder.pushInbound(Buffer.from([0, 0, 1, 0]).toString('base64'), 16000);
  recorder.pushOutbound(Buffer.from([0, 0, 2, 0]).toString('base64'), 24000);
  const files = recorder.flush();
  assert.ok(fs.existsSync(files.in));
  assert.ok(fs.readFileSync(files.in).slice(0, 4).toString() === 'RIFF');

  assert.strictEqual(dbAdapter.dbWritesEnabled ? store.dbWritesEnabled() : false, false);
  await assert.rejects(() => dbAdapter.insertLead({}), (err) => err.code === 'SALES_DB_DISABLED');
  process.env.SALES_AGENT_DB_WRITES = '1';
  assert.strictEqual(store.dbWritesEnabled(), false);
  delete process.env.STAGING_READ_ONLY_SIDE_EFFECTS;
  delete process.env.SALES_AGENT_DRY_RUN;
  assert.strictEqual(store.dbWritesEnabled(), true);
  await assert.rejects(() => dbAdapter.insertLead({}), (err) => err.code === 'SALES_DB_NOT_APPROVED');
  process.env.STAGING_READ_ONLY_SIDE_EFFECTS = '1';
  process.env.SALES_AGENT_DRY_RUN = '1';

  const repo = process.cwd();
  for (const file of ['prod-server.cjs', 'railway/server.js', 'functions/sarahFastVoice.ts', 'functions/sarahVoiceBridge.ts']) {
    const text = fs.readFileSync(path.join(repo, file), 'utf8');
    assert.ok(!text.includes('$99/month flat'), file);
    assert.ok(!text.includes('$500'), file);
  }
  assert.ok(fs.readFileSync(path.join(repo, 'prod-server.cjs'), 'utf8').includes('buildPhoneDemoPrompt'));
  assert.ok(fs.readFileSync(path.join(repo, 'vite-sales-demo-plugin.js'), 'utf8').includes('/ws/sales-demo'));
  assert.ok(fs.readFileSync(path.join(repo, 'prod-server.cjs'), 'utf8').includes('/ws/sales-demo'));

  const alignment = JSON.parse(fs.readFileSync(path.join(repo, 'config/salesPricingAlignment.json'), 'utf8'));
  assert.strictEqual(alignment.status, 'FLAGGED_SEPARATE_ITEM');
  assert.deepStrictEqual(alignment.decidedMonthlyUsd, { basic: 99, business: 199, enterprise: 399 });
  assert.deepStrictEqual(alignment.displayedMonthlyUsd, { basic: 59, business: 149, enterprise: 299 });
  assert.ok(fs.readFileSync(path.join(repo, 'src/pages/PublicPricing.jsx'), 'utf8').includes('price: 59'));
  assert.ok(fs.readFileSync(path.join(repo, 'src/pages/Pricing.jsx'), 'utf8').includes('price: 149'));

  console.log = originalLog;
  staging.restoreOutboundGuards();
  console.log('sales agent tests passed');
})().catch((err) => {
  console.log = originalLog;
  console.error(err);
  process.exit(1);
});
