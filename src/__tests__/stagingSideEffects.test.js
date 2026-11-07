import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const staging = require('../../lib/stagingSideEffects.cjs');
const { ensureSchema } = require('../../db/ensure-schema.cjs');
const { reencryptStoredSecrets } = require('../../lib/reencryptSecrets.cjs');
const { sendPlatformEmail, sendPlatformSubscriberEmail } = require('../../lib/emailTransport.cjs');

function read(rel) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

afterEach(() => {
  delete process.env.STAGING_READ_ONLY_SIDE_EFFECTS;
  staging.restoreOutboundGuards();
});

describe('STAGING_READ_ONLY_SIDE_EFFECTS', () => {
  it('is off unless the value is exactly 1', () => {
    expect(staging.sideEffectsDisabled({})).toBe(false);
    expect(staging.sideEffectsDisabled({ STAGING_READ_ONLY_SIDE_EFFECTS: 'true' })).toBe(false);
    expect(staging.sideEffectsDisabled({ STAGING_READ_ONLY_SIDE_EFFECTS: '1' })).toBe(true);
  });

  it('logs the startup line once', () => {
    const lines = [];
    const log = { log: (line) => lines.push(line) };
    process.env.STAGING_READ_ONLY_SIDE_EFFECTS = '1';
    expect(staging.logDisabled(log)).toBe(true);
    expect(staging.logDisabled(log)).toBe(false);
    expect(lines).toEqual(['[staging] side effects disabled']);
  });

  it('does not start schedulers while the flag is set', () => {
    process.env.STAGING_READ_ONLY_SIDE_EFFECTS = '1';
    let ran = false;
    const timer = staging.armInterval('ghlAutoSyncCron', () => { ran = true; }, 1);
    expect(ran).toBe(false);
    expect(staging.skippedSchedulers).toContain('ghlAutoSyncCron');
    expect(typeof timer.unref).toBe('function');
  });

  it('still arms a scheduler when the flag is unset', () => {
    let ran = false;
    const timer = staging.armInterval('checkReminders', () => { ran = true; }, 60_000);
    expect(ran).toBe(false);
    expect(staging.skippedSchedulers).not.toContain('checkReminders');
    clearInterval(timer);
  });

  it('classifies mutating outbound calls and leaves reads alone', () => {
    expect(staging.classifyOutbound('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json', 'POST')).toBe('sms');
    expect(staging.classifyOutbound('https://api.twilio.com/2010-04-01/Accounts/AC1/Calls.json', 'POST')).toBe('call');
    expect(staging.classifyOutbound('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json', 'GET')).toBe(null);
    expect(staging.classifyOutbound('https://api.postmarkapp.com/email', 'POST')).toBe('email');
    expect(staging.classifyOutbound('https://email.us-east-1.amazonaws.com/', 'POST')).toBe('email');
    expect(staging.classifyOutbound('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', 'POST')).toBe('email');
    expect(staging.classifyOutbound('https://api.stripe.com/v1/webhook_endpoints', 'POST')).toBe('stripe-webhook');
    expect(staging.classifyOutbound('https://api.stripe.com/v1/webhook_endpoints/we_123', 'POST')).toBe('stripe-webhook');
    expect(staging.classifyOutbound('https://services.leadconnectorhq.com/contacts/', 'POST')).toBe('ghl');
    expect(staging.classifyOutbound('https://services.leadconnectorhq.com/contacts/', 'GET')).toBe(null);
  });

  it('logs Twilio, Stripe webhook, and SMTP sends instead of performing them', async () => {
    process.env.STAGING_READ_ONLY_SIDE_EFFECTS = '1';
    let networkCalls = 0;
    globalThis.fetch = async () => {
      networkCalls += 1;
      return new Response('should-not-send', { status: 500 });
    };
    staging.installOutboundGuards();
    const sms = await fetch('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json', { method: 'POST' });
    const listed = await fetch('https://api.twilio.com/2010-04-01/Accounts/AC1/IncomingPhoneNumbers.json');
    const webhook = await fetch('https://api.stripe.com/v1/webhook_endpoints', { method: 'POST' });
    expect(networkCalls).toBe(1);
    expect(sms.status).toBe(200);
    expect((await sms.json()).sid).toBe('staging-suppressed');
    expect(webhook.status).toBe(200);
    expect(listed.status).toBe(500);

    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const info = await transport.sendMail({ from: 'a@example.com', to: 'b@example.com', subject: 'Hi', text: 'Hello' });
    expect(info.messageId).toBe('staging-suppressed');
    expect(info.suppressed).toBe(true);
  });

  it('returns a suppressed email result before any provider call', async () => {
    process.env.STAGING_READ_ONLY_SIDE_EFFECTS = '1';
    const result = await sendPlatformEmail({ to: 'person@example.com', subject: 'Hello', html: '<p>Hi</p>' });
    const subscriber = await sendPlatformSubscriberEmail({ to: 'person@example.com', subject: 'Reset', html: '<p>Reset</p>' });
    expect(result).toMatchObject({ success: true, suppressed: true, provider: 'staging', id: 'staging-suppressed' });
    expect(subscriber.suppressed).toBe(true);
  });

  it('verify-only schema checks do not create or alter', async () => {
    const queries = [];
    const pool = {
      query: async (sql) => {
        queries.push(String(sql));
        if (String(sql).includes('to_regclass')) return { rows: [{ rel: null }] };
        return { rows: [] };
      },
    };
    process.env.STAGING_READ_ONLY_SIDE_EFFECTS = '1';
    const result = await ensureSchema(pool);
    expect(result.verifyOnly).toBe(true);
    expect(result.missing.some((item) => item.startsWith('table '))).toBe(true);
    expect(queries.some((sql) => /\b(CREATE|ALTER|DROP|DELETE|UPDATE|TRUNCATE)\b/i.test(sql))).toBe(false);
  });

  it('still creates schema when the flag is unset', async () => {
    const queries = [];
    const pool = {
      query: async (sql) => {
        queries.push(String(sql));
        return { rows: [{ rel: 'public.companies' }] };
      },
    };
    await ensureSchema(pool, { verifyOnly: false, env: {} });
    expect(queries.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS'))).toBe(true);
  });

  it('does not rewrite stored secrets when the flag is set', async () => {
    const pool = { query: async () => { throw new Error('database was queried'); } };
    const lines = [];
    const stats = await reencryptStoredSecrets(pool, { STAGING_READ_ONLY_SIDE_EFFECTS: '1' }, { info: (line) => lines.push(line) });
    expect(stats).toMatchObject({ rewritten: 0, rowsUpdated: 0, reason: 'staging_read_only' });
    expect(lines[0]).toContain('reason=staging_read_only');
  });

  it('blocks named sync and digest functions before they run', () => {
    expect(staging.blockedFunction('syncGHLContacts')).toBe(null);
    process.env.STAGING_READ_ONLY_SIDE_EFFECTS = '1';
    expect(staging.blockedFunction('getCustomers')).toBe(null);
    expect(staging.blockedFunction('syncGHLContacts')).toMatchObject({ suppressed: true, staging: true });
    const integrations = read('db/prod-integrations.cjs');
    expect(integrations).toContain('blockedFunction(functionName)');
  });

  it('wires the production startup paths to the flag', () => {
    const server = read('prod-server.cjs');
    const db = read('db/prod-db.cjs');
    const ensure = read('scripts/ensure-schema.cjs');
    const cron = read('vite-cron-plugin.js');
    for (const name of [
      'subscriberCacheRefresh',
      'processWorkflowQueue',
      'sendScheduledDailyReports',
      'stormAlerts',
      'checkReminders',
      'processLeadConfirmationOutreach',
      'bulkSyncAllCalendars',
      'processActionItemEscalation',
      'purgeStaleStormLeads',
      'scanBuildReminders',
      'checkStaleLeads',
      'sendStaleLeadDigest',
      'scanBuildProgressUpdates',
      'scanStuckJobs',
      'scanPunchListReminders',
      'nagPersonalTodos',
      'processScheduledCampaigns',
      'ghlAutoSyncCron',
      'checkInvoiceReminders',
      'checkTaskReminders',
      'decayLeadScores',
      'sendFridayPortalRecap',
      'processReviewRequests',
      'reconcileEmailDeliveryEvents',
      'createDailyBackup',
      'cronCleanupBackups',
      'checkOverdueInvoices',
      'processTrialLifecycle',
      'purgeOldStormEvents',
      'cronCleanupLexiPendingSchedules',
      'purgeOldDailyReports',
      'sendWeeklyCommissionDigest',
      'sendWeeklyLeaderboardDigest',
      'sendMorningDigest',
      'checkTenantCostAlerts',
      'geminiLiveProbe',
    ]) {
      expect(server).toContain(`armInterval('${name}'`);
    }
    expect(server).toContain("armTimeout('stormAlertsStartup'");
    expect(server).toContain("armTimeout('checkStaleLeadsStartup'");
    expect(server).toContain("noteSkippedScheduler('ghlAutoSyncCronStartup')");
    expect(server).toContain("logSuppressed('stripe-webhook'");
    expect(server).toContain("logSuppressed('call', { action: 'webrtc-token' })");
    expect(server).toContain("logSuppressed('call', { action: 'inbound-voice' })");
    expect(server).toContain("logSuppressed('twilio', { action: 'auto-provision' })");
    expect(server).toContain("logSuppressed('sms', { action: 'inbound-webhook' })");
    expect(server).toContain("logSuppressed('call', { action: 'twilio-media-stream' })");
    expect(server).toContain('[staging] startup rewrites skipped');
    const init = db.slice(db.indexOf('async function initDatabase'), db.indexOf('function generateId'));
    expect(init.indexOf('sideEffectsDisabled')).toBeGreaterThan(-1);
    expect(init.indexOf('sideEffectsDisabled')).toBeLessThan(init.indexOf('CREATE TABLE'));
    expect(ensure).toContain('logDisabled');
    expect(cron).toContain('scheduler not started: vite-cron');
    const rateLimit = server.slice(server.indexOf('RATE_LIMIT_BUCKETS'), server.indexOf('function setCorsHeaders'));
    expect(rateLimit).toContain('setInterval(');
    expect(rateLimit).not.toContain('armInterval(');
  });
});
