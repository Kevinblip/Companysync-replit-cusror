'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { notifyPaymentStaff, alertId } = require('../lib/paymentStaffAlerts.cjs');
const { beginInvoiceEmailAttempt } = require('../lib/invoiceEmailDeliveryAudit.cjs');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
function fakeDb({ quiet = false, rep = false, phone = true, admins = true } = {}) {
  const notifications = new Map();
  const payments = new Map([
    ['pay1', { id: 'pay1', company_id: 'co1', invoice_id: 'inv1', invoice_number: 'INV-1', amount: 40, status: 'received' }],
    ['pay2', { id: 'pay2', company_id: 'co1', invoice_id: 'inv1', invoice_number: 'INV-1', amount: 60, status: 'received' }],
    ['offset', { id: 'offset', company_id: 'co1', amount: 5, status: 'received', is_withheld_offset: true }],
  ]);
  const pool = {
    async query(sql, args) {
      if (sql.startsWith('SELECT * FROM payments')) {
        const p = payments.get(args[0]);
        return { rows: p && p.company_id === args[1] ? [p] : [] };
      }
      if (sql.startsWith('SELECT timezone, settings FROM companies')) {
        return { rows: [{ timezone: 'America/New_York', settings: {
          notification_quiet_hours: { enabled: quiet, start: '22:00', end: '06:00' },
        } }] };
      }
      if (sql.includes('FROM staff_profiles') && !sql.includes('FROM invoices i')) {
        return { rows: admins ? [{ email: 'admin@example.test', phone: phone ? '+15555550123' : '' }] : [] };
      }
      if (sql.includes('FROM invoices i JOIN staff_profiles')) {
        return { rows: rep ? [{ email: 'rep@example.test', phone: '+15555550124' }] : [] };
      }
      if (sql.startsWith('INSERT INTO generic_entities')) {
        if (notifications.has(args[0])) return { rowCount: 0 };
        notifications.set(args[0], JSON.parse(args[2]));
        return { rowCount: 1 };
      }
      if (sql.startsWith('UPDATE generic_entities')) {
        notifications.set(args[0], { ...notifications.get(args[0]), ...JSON.parse(args[1]) });
        return { rowCount: 1 };
      }
      throw new Error(`Unexpected query in fake DB: ${sql.slice(0, 90)}`);
    },
  };
  return { pool, notifications, payments };
}

async function main() {
  const dev = read('vite-functions-plugin.js');
  const prod = read('db/prod-db.cjs');
  const prodServer = read('prod-server.cjs');
  const editor = read('src/pages/EstimateEditor.jsx');
  const details = read('src/pages/invoice-details.jsx');
  const conversion = dev.slice(dev.indexOf('async convertEstimateToInvoice('), dev.indexOf('async updateLeadScore('));
  assert.match(conversion, /status: 'draft'/);
  assert.match(conversion, /0, 'draft', JSON\.stringify\(invoiceItems\)/);
  assert.doesNotMatch(conversion, /sendInvoiceEmail|sendViaResend/);
  assert.match(editor, /Invoice created as a draft/);
  assert.match(details, /invoice-delivery-summary/);
  assert.match(details, /invoice\.status === 'draft' \? \{ status: 'sent' \}/);
  assert.match(details, /if \(invoice\.status !== 'paid'\) \{\s*try \{\s*await base44\.entities\.Invoice\.update\(invoice\.id/);
  assert.match(details, /if \(!\['paid', 'cancelled', 'void', 'refunded'\]\.includes\(status\)\) \{\s*try \{\s*await base44\.entities\.Invoice\.update\(invoice\.id/);
  assert.match(dev, /paymentStaffAlerts\.cjs'\)\.notifyPaymentStaff/);
  assert.match(prod, /paymentStaffAlerts\.cjs'\)\.notifyPaymentStaff/);
  assert.match(dev, /paymentId: rpPmtId,\s*sendSms: opts => functionHandlers\.sendSMS/);
  assert.match(prodServer, /paymentId: rpPmtId,\s*sendSms: opts => handlers\.sendSMS/);
  assert.match(dev, /async getInvoiceDeliverySummary/);

  const audit = [];
  await beginInvoiceEmailAttempt({ query: async (_sql, args) => { audit.push(JSON.parse(args[7])); } },
    { companyId: 'co1', invoiceId: 'inv1', to: 'homeowner@example.test', purpose: 'invoice' });
  assert.equal(audit[0].message_purpose, 'invoice');

  let emailSends = 0;
  let smsSends = 0;
  const sendEmail = async () => { emailSends++; return { success: true, id: 'accepted-id' }; };
  const sendSms = async () => { smsSends++; return { success: true, sid: 'accepted-sid' }; };
  const early = new Date('2026-09-29T09:29:00Z'); // 5:29 a.m. Eastern
  const daytime = new Date('2026-09-29T14:29:00Z');
  const q = fakeDb({ quiet: true, rep: true });
  await Promise.all([1, 2, 3].map(() => notifyPaymentStaff(q.pool, {
    companyId: 'co1', paymentId: 'pay1', sendEmail, sendSms, emailProvider: () => 'postmark', now: early,
  })));
  assert.equal(q.notifications.size, 2, 'admin and assigned rep get one alert each');
  assert.equal(emailSends, 0, 'quiet hours must not email');
  assert.equal(smsSends, 0, 'quiet hours must not text');
  const deferred = [...q.notifications.values()][0];
  assert.equal(deferred.email_status, 'suppressed_quiet_hours');
  assert.equal(deferred.sms_status, 'suppressed_quiet_hours');
  assert.equal(deferred.deferred_until, '2026-09-29T10:00:00.000Z');
  assert.equal(alertId('co1', 'pay1', 'ADMIN@example.test'), alertId('co1', 'pay1', 'admin@example.test'));

  const live = fakeDb();
  for (const paymentId of ['pay1', 'pay2', 'pay1']) {
    await notifyPaymentStaff(live.pool, {
      companyId: 'co1', paymentId, sendEmail, sendSms, emailProvider: () => 'postmark', now: daytime,
    });
  }
  assert.equal(live.notifications.size, 2, 'two payments, no duplicates');
  assert.equal(emailSends, 2);
  assert.equal(smsSends, 2);
  assert.deepEqual([...live.notifications.values()].map(n => n.email_status), ['submitted', 'submitted']);
  assert.deepEqual([...live.notifications.values()].map(n => n.sms_status), ['submitted', 'submitted']);
  await notifyPaymentStaff(live.pool, { companyId: 'co1', paymentId: 'offset', sendEmail, sendSms, now: daytime });
  assert.equal(live.notifications.size, 2, 'bookkeeping offsets never claim cash alerts');

  const noRep = fakeDb({ phone: false });
  await notifyPaymentStaff(noRep.pool, {
    companyId: 'co1', paymentId: 'pay1', sendEmail: async () => { throw new Error('provider down'); },
    sendSms, emailProvider: () => 'postmark', now: daytime,
  });
  assert.equal(noRep.notifications.size, 1, 'no rep assignment must not alert a stranger');
  assert.equal([...noRep.notifications.values()][0].email_status, 'failed');
  assert.equal([...noRep.notifications.values()][0].sms_status, 'not_configured');
  const unassigned = fakeDb({ admins: false });
  const notRouted = await notifyPaymentStaff(unassigned.pool, {
    companyId: 'co1', paymentId: 'pay1', sendEmail, sendSms, now: daytime,
  });
  assert.equal(notRouted.reason, 'No active admin or assigned rep');
  assert.equal([...unassigned.notifications.values()][0].reason, 'no_active_admin_or_assigned_rep');
  console.log('invoice delivery + payment staff alert regression checks passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });