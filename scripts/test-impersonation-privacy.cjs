#!/usr/bin/env node
/**
 * Impersonation privacy mask.
 * Personal info and dollar amounts are hidden while a platform admin is
 * signed in as a customer company. A normal session is not rewritten.
 *
 * Usage: node scripts/test-impersonation-privacy.cjs
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const privacy = require('../lib/impersonationPrivacy.cjs');
const { decideInvokeAccess } = require('../lib/functionInvokeAuth.cjs');

const root = path.join(__dirname, '..');
let passed = 0;

function ok(name, cond) {
  assert.strictEqual(!!cond, true, name);
  console.log(`  ✓ ${name}`);
  passed += 1;
}

function impersonating(extra = {}) {
  return { isImpersonating: true, privacyRevealed: false, ...extra };
}

const customer = {
  id: 'cust_1',
  company_id: 'co_1',
  name: 'John Smith',
  company_name: 'Smith Roofing',
  email: 'john@gmail.com',
  phone: '(216) 555-1223',
  phone_2: '216-555-1299',
  street: '123 Main St',
  city: 'Cleveland',
  state: 'OH',
  zip: '44113',
  address: '123 Main St, Cleveland, OH 44113',
  notes: 'Call John at (216) 555-1223 about the $4,200 roof.',
  portal_token: 'secret-portal-token',
  status: 'active',
  total_revenue: 4200,
  assigned_to: 'rep@acme.com',
};

const maskedCustomer = privacy.maskIfImpersonating(impersonating(), customer);

ok('customer name is masked', maskedCustomer.name === 'J*** S***');
ok('customer business name is masked', maskedCustomer.company_name === 'S*** R***');
ok('email keeps the domain', maskedCustomer.email === 'j***@gmail.com');
ok('phone keeps area code and last two digits', maskedCustomer.phone === '(216) ***-**23');
ok('second phone is masked', maskedCustomer.phone_2 === '(216) ***-**99');
ok('street number is hidden', maskedCustomer.street === '*** Main St');
ok('full address hides the number and zip', maskedCustomer.address === '*** Main St, Cleveland, OH ***');
ok('city and state stay', maskedCustomer.city === 'Cleveland' && maskedCustomer.state === 'OH');
ok('zip is hidden', maskedCustomer.zip === '***');
ok('notes are hidden', maskedCustomer.notes === '[hidden]' && !maskedCustomer.notes.includes('555') && !maskedCustomer.notes.includes('4200'));
ok('portal link is hidden', maskedCustomer.portal_token === '[hidden]');
ok('status and ids stay', maskedCustomer.status === 'active' && maskedCustomer.id === 'cust_1' && maskedCustomer.company_id === 'co_1');
ok('customer revenue is hidden', maskedCustomer.total_revenue === '$***');
ok('assigned rep email is hidden', maskedCustomer.assigned_to === 'r***@acme.com');
ok('raw customer secrets are not in the payload', !JSON.stringify(maskedCustomer).includes('john@gmail.com') && !JSON.stringify(maskedCustomer).includes('555-1223') && !JSON.stringify(maskedCustomer).includes('4200'));

const company = {
  id: 'co_1',
  name: 'Acme Roofing',
  company_name: 'Acme Roofing',
  email: 'owner@acme.com',
  phone: '2165550100',
  address: '9 Oak Ave',
  subscription_plan: 'pro',
  subscription_status: 'active',
  max_users: 5,
};
const maskedCompany = privacy.maskPayload(company);
ok('impersonated company name stays visible', maskedCompany.name === 'Acme Roofing' && maskedCompany.company_name === 'Acme Roofing');
ok('company contact details are still hidden', maskedCompany.email === 'o***@acme.com' && maskedCompany.phone === '(216) ***-**00' && maskedCompany.address === '*** Oak Ave');
ok('plan and user limit stay', maskedCompany.subscription_plan === 'pro' && maskedCompany.max_users === 5);

const staff = {
  id: 'staff_1',
  full_name: 'Mary Jones',
  name: 'Mary Jones',
  email: 'mary@acme.com',
  user_email: 'mary@acme.com',
  phone: '(216) 555-0177',
  role: 'Sales',
  is_administrator: true,
  commission_rate: 10,
};
const maskedStaff = privacy.maskPayload(staff);
ok('staff name and emails are masked', maskedStaff.full_name === 'M*** J***' && maskedStaff.name === 'M*** J***' && maskedStaff.email === 'm***@acme.com' && maskedStaff.user_email === 'm***@acme.com');
ok('staff role and commission rate stay', maskedStaff.role === 'Sales' && maskedStaff.commission_rate === 10);

const dashboard = {
  leads: { stats: { total: '12', new_count: 3, won_count: 1 } },
  invoices: { stats: { total: '4', paid_count: '2', total_amount: '8450.25', outstanding_amount: 1200 } },
  customers: { total: 9 },
  payments: { recent: [{ customer_name: 'John Smith', amount: 300, payment_method: 'check' }] },
  communications: { recent: [{ contact_name: 'John Smith', subject: 'Hello', body: 'The claim is approved', recording_url: 'https://api.twilio.com/Recordings/RE123' }] },
};
const maskedDash = privacy.maskPayload(dashboard);
ok('lead and invoice counts stay', maskedDash.leads.stats.total === '12' && maskedDash.leads.stats.new_count === 3 && maskedDash.invoices.stats.total === '4' && maskedDash.customers.total === 9);
ok('dashboard money is hidden', maskedDash.invoices.stats.total_amount === '$***' && maskedDash.invoices.stats.outstanding_amount === '$***' && maskedDash.payments.recent[0].amount === '$***');
ok('payment method stays', maskedDash.payments.recent[0].payment_method === 'check');
ok('message text and recording links are hidden', maskedDash.communications.recent[0].body === '[hidden]' && maskedDash.communications.recent[0].recording_url === '[hidden]' && maskedDash.communications.recent[0].subject === '[hidden]');
ok('contact on the payment is masked', maskedDash.payments.recent[0].customer_name === 'J*** S***');

const reports = {
  estimates: { stats: { total: '3', approved_count: 1, approved_value: '1500.00' } },
  revenue: [{ month: '2026-01-01', total: '6400.00', payment_count: '4' }],
  ar_aging: [{ customer_name: 'John Smith', outstanding: '900.50', invoice_count: 2 }],
  sale_agent: 'Mary Jones',
  assigned_to_users: ['mary@acme.com', 'Sam Lee'],
  calendar: { upcoming: [{ title: 'Meet John Smith', event_type: 'appointment', start_time: '2026-10-22T15:00:00Z', location: '123 Main St' }] },
};
const maskedReports = privacy.maskPayload(reports);
ok('approved estimate dollars are hidden', maskedReports.estimates.stats.approved_value === '$***' && maskedReports.estimates.stats.total === '3' && maskedReports.estimates.stats.approved_count === 1);
ok('monthly revenue total is hidden and the payment count stays', maskedReports.revenue[0].total === '$***' && maskedReports.revenue[0].payment_count === '4');
ok('aging balance is hidden', maskedReports.ar_aging[0].outstanding === '$***' && maskedReports.ar_aging[0].customer_name === 'J*** S***' && maskedReports.ar_aging[0].invoice_count === 2);
ok('rep name and teammate list are masked', maskedReports.sale_agent === 'M*** J***' && maskedReports.assigned_to_users[0] === 'm***@acme.com' && maskedReports.assigned_to_users[1] === 'S*** L***');
ok('calendar title and street are hidden', maskedReports.calendar.upcoming[0].title === '[hidden]' && maskedReports.calendar.upcoming[0].location === '*** Main St' && maskedReports.calendar.upcoming[0].event_type === 'appointment');

const estimate = {
  customer_name: 'Jane Doe',
  customer_email: 'jane.doe@outlook.com',
  customer_phone: '440-555-1212',
  property_address: '45 River Rd',
  total_amount: 0,
  line_items: [
    { name: 'Architectural Shingles', description: 'Install at 45 River Rd. Price is $1,250.00. Email jane.doe@outlook.com', quantity: 22, unit_price: 1250, total: 27500 },
  ],
};
const maskedEstimate = privacy.maskPayload(estimate);
ok('estimate identity and zero dollars are hidden', maskedEstimate.customer_name === 'J*** D***' && maskedEstimate.customer_email === 'j***@outlook.com' && maskedEstimate.total_amount === '$***');
ok('line item product name and quantity stay', maskedEstimate.line_items[0].name === 'Architectural Shingles' && maskedEstimate.line_items[0].quantity === 22);
ok('line item prices are hidden', maskedEstimate.line_items[0].unit_price === '$***' && maskedEstimate.line_items[0].total === '$***');
ok('address, email, and price inside a description are hidden', maskedEstimate.line_items[0].description.includes('*** River Rd') && maskedEstimate.line_items[0].description.includes('$***') && maskedEstimate.line_items[0].description.includes('j***@outlook.com') && !maskedEstimate.line_items[0].description.includes('1250') && !maskedEstimate.line_items[0].description.includes('jane.doe'));

const original = { name: 'Product only', quantity: 2, status: 'draft' };
ok('not impersonating returns the same object', privacy.maskIfImpersonating(null, original) === original);
ok('revealed impersonation returns the same object', privacy.maskIfImpersonating({ isImpersonating: true, privacyRevealed: true }, original) === original);
ok('a normal session does not rewrite a customer', privacy.maskIfImpersonating({ isImpersonating: false }, customer) === customer);
ok('masking is idempotent', JSON.stringify(privacy.maskPayload(maskedCustomer)) === JSON.stringify(maskedCustomer));
ok('input object is not mutated', customer.email === 'john@gmail.com' && customer.total_revenue === 4200 && customer.notes.includes('$4,200'));

ok('invoice pdf is blocked while impersonating', decideInvokeAccess({ functionName: 'generateInvoicePDF', isImpersonating: true }).status === 403);
ok('invoice pdf still works for a normal caller', decideInvokeAccess({ functionName: 'generateInvoicePDF' }).access === 'public');
ok('a logged reveal allows the pdf handler again', decideInvokeAccess({ functionName: 'generateInvoicePDF', isImpersonating: true, privacyRevealed: true }).access === 'public');
ok('Lexi is blocked while impersonating', decideInvokeAccess({ functionName: 'lexiChat', authenticated: true, isImpersonating: true }).status === 403);
ok('Lexi orchestration is blocked', decideInvokeAccess({ functionName: 'executeLexiOrchestration', authenticated: true, isImpersonating: true }).status === 403);
ok('Alex bridge handler is blocked', decideInvokeAccess({ functionName: 'sarahBridgeAPI', authenticated: true, isImpersonating: true }).status === 403);
ok('csv export is blocked', decideInvokeAccess({ functionName: 'exportCustomersCsv', authenticated: true, isImpersonating: true }).status === 403);
ok('a normal financial read is not blocked', decideInvokeAccess({ functionName: 'getFinancialSummary', authenticated: true, isImpersonating: true }).ok === true);
ok('public estimate stays public when nobody is impersonating', decideInvokeAccess({ functionName: 'getPublicEstimate' }).access === 'public');

const logs = [{ target_company_name: 'Acme Roofing', admin_email: 'admin@companysync.com', view_as_user_email: 'mary@acme.com', reason: 'Support' }];
const maskedLogs = privacy.maskLogRows(impersonating(), logs);
ok('audit log keeps the company name and hides the staff view-as email', maskedLogs[0].target_company_name === 'Acme Roofing' && maskedLogs[0].view_as_user_email === 'm***@acme.com');
ok('audit log is unchanged when not impersonating', privacy.maskLogRows({ isImpersonating: false }, logs) === logs);

ok('pdf and ai routes are blocked', privacy.isBlockedImpersonationPath('/api/public-estimate-pdf') && privacy.isBlockedImpersonationPath('/api/integrations/invoke-llm') && privacy.isBlockedImpersonationPath('/api/live-call-events'));
ok('auth and impersonation status are not masked', privacy.shouldMaskPath('/api/auth/user') === false && privacy.shouldMaskPath('/api/impersonation/status') === false);
ok('entity reads are masked', privacy.shouldMaskPath('/api/local/entity/Customer') === true && privacy.shouldMaskPath('/api/chat/messages') === true);

const viteDb = fs.readFileSync(path.join(root, 'vite-db-plugin.js'), 'utf8');
const prodDb = fs.readFileSync(path.join(root, 'db/prod-db.cjs'), 'utf8');
const prodServer = fs.readFileSync(path.join(root, 'prod-server.cjs'), 'utf8');
const banner = fs.readFileSync(path.join(root, 'src/components/ImpersonationBanner.jsx'), 'utf8');
ok('dev and prod entity responses pass through the mask', viteDb.includes('maskIfImpersonating') && prodDb.includes('maskIfImpersonating'));
ok('prod api responses are masked and sensitive downloads are blocked', prodServer.includes('installJsonMask') && prodServer.includes('isBlockedImpersonationPath'));
ok('banner tells support that privacy mode is on', banner.includes('Privacy mode: personal info and amounts hidden'));
ok('reveal route exists in dev and prod', viteDb.includes('/api/impersonation/reveal') && prodDb.includes('/api/impersonation/reveal'));

(async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT target_company_name/.test(sql)) return { rows: [{ target_company_name: 'Acme Roofing' }] };
      return { rows: [] };
    },
  };
  const revealCtx = {
    authenticated: true,
    isSuperAdmin: true,
    isImpersonating: true,
    impersonatedCompanyId: 'co_1',
    email: 'admin@companysync.com',
    _impersonationLogId: 'log_1',
    _sid: 'sid_1',
  };
  const short = await privacy.recordPrivacyReveal({ pool, ctx: revealCtx, reason: 'short' });
  ok('reveal requires a real reason', short.status === 400 && calls.length === 0);
  const revealed = await privacy.recordPrivacyReveal({ pool, ctx: revealCtx, reason: 'Customer asked us to verify the invoice' });
  ok('reveal is logged on the impersonation log', revealed.status === 200 && calls.some((call) => /INSERT INTO impersonation_logs/.test(call.sql) && call.sql.includes("'privacy_reveal'") && call.params.includes('Customer asked us to verify the invoice')));
  const sessionUpdate = calls.find((call) => /UPDATE sessions/.test(call.sql));
  ok('session flag is the reveal flag', !!sessionUpdate && JSON.parse(sessionUpdate.params[0]).impersonation_privacy_revealed === true);

  const { scrubMoneyText } = await import('../src/lib/privacyMoney.js');
  ok('computed dollar totals display as hidden', scrubMoneyText('Revenue $8,450.25') === 'Revenue $***');
  ok('a failed sum displays as hidden', scrubMoneyText('$NaN') === '$***');
  ok('an already hidden amount is left alone', scrubMoneyText('$***') === '$***');
  ok('a lead count with no dollar sign stays', scrubMoneyText('12 leads') === '12 leads');
  console.log(`\n${passed} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
