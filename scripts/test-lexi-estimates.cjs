#!/usr/bin/env node
// Lexi estimate follow-ups and drafts. Fixture rows only. No Twilio and no send.
'use strict';

const fs = require('fs');
const path = require('path');
const lexi = require('../lib/lexiPhone.cjs');
const estimates = require('../lib/lexiEstimates.cjs');

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

const PIN = '4271';
const OWNER = { companyId: 'co_lexi', userEmail: 'kevin@example.com', name: 'Kevin', phone: '+15555550123' };
const NOW = new Date('2026-10-21T15:00:00Z');

function config() {
  return {
    ...lexi.configFromEnv({ LEXI_PHONE_ALLOWLIST: '+15555550123' }),
    pin: PIN,
    companyId: OWNER.companyId,
    userEmail: OWNER.userEmail,
    userName: 'Kevin',
  };
}

function estimateRow(row) {
  return {
    company_id: 'co_lexi',
    status: 'sent',
    total_amount: 0,
    items: [],
    data: {},
    ...row,
  };
}

const ESTIMATES = [
  estimateRow({
    id: 'est_eve', estimate_number: 'EST-0004', customer_name: 'Eve Cole', customer_phone: '+15555550111',
    customer_id: 'cus_eve', title: 'Roof', total_amount: 1000, updated_at: '2026-10-21T14:00:00Z',
    data: { sent_at: '2026-10-14', share_url: 'https://example.com/e?token=abc' },
  }),
  estimateRow({
    id: 'est_ada', estimate_number: 'EST-0002', customer_name: 'Ada Lane', customer_phone: '+15555550112',
    customer_email: 'ada@example.com', title: 'Gutters', total_amount: 4200, updated_at: '2026-10-21T12:00:00Z',
    data: { sent_at: '2026-10-11' },
  }),
  estimateRow({
    id: 'est_pat', estimate_number: 'EST-0001', customer_name: 'Pat Kim', customer_phone: '+15555550113',
    title: 'Siding', total_amount: 800, updated_at: '2026-10-21T14:00:00Z',
    data: { sent_at: '2026-10-01', share_url: 'https://example.com/ViewEstimate?id=est_pat' },
  }),
  estimateRow({
    id: 'est_ben', estimate_number: 'EST-0003', customer_name: 'Ben Ortiz', customer_phone: '+15555550114',
    status: 'viewed', title: 'Windows', total_amount: 900, updated_at: '2026-10-21T14:00:00Z',
    data: { viewed_at: '2026-10-19T16:00:00Z' },
  }),
  estimateRow({
    id: 'est_night', estimate_number: 'EST-0006', customer_name: 'Night Owl', customer_phone: '+15555550116',
    title: 'Repair', total_amount: 50, updated_at: '2026-10-20T16:00:00Z', data: {},
  }),
  estimateRow({
    id: 'est_cara', estimate_number: 'EST-0005', customer_name: 'Cara Nguyen', customer_phone: '+15555550115',
    status: 'accepted', title: 'Roof', total_amount: 5000, updated_at: '2026-09-01T15:00:00Z',
    property_address: '9 Pine St',
    items: [{ description: 'Roof', quantity: 1, unit: 'EA', rate: 5000, amount: 5000 }],
    data: { sent_at: '2026-08-01', share_url: 'https://example.com/old?token=old' },
  }),
  estimateRow({
    id: 'est_dana', estimate_number: 'EST-0007', customer_name: 'Dana Fox', customer_phone: '+15555550117',
    status: 'draft', total_amount: 100, updated_at: '2026-09-01T15:00:00Z', data: {},
  }),
  estimateRow({
    id: 'est_declined', estimate_number: 'EST-0008', customer_name: 'Declined Dan', customer_phone: '+15555550118',
    status: 'declined', total_amount: 100, updated_at: '2026-09-01T15:00:00Z', data: {},
  }),
  estimateRow({
    id: 'est_other', company_id: 'co_other', estimate_number: 'EST-0099', customer_name: 'Ada Lane',
    customer_phone: '+15555550112', total_amount: 99999, updated_at: '2026-01-01T15:00:00Z',
    data: { sent_at: '2026-01-01' },
  }),
];

const CUSTOMERS = [
  { id: 'cus_ada', company_id: 'co_lexi', name: 'Ada Lane', phone: '+15555550112', email: 'ada@example.com', address: '12 Oak St' },
  { id: 'cus_ada2', company_id: 'co_lexi', name: 'Ada Other', phone: '+15555550199', email: 'ada2@example.com', address: '1 Other St' },
  { id: 'cus_other', company_id: 'co_other', name: 'Ada Lane', phone: '+15555550112', address: 'Elsewhere' },
];

const LEADS = [
  { id: 'lead_gus', company_id: 'co_lexi', name: 'Gus Hale', phone: '+15555550130', email: 'gus@example.com', address: '4 Elm St' },
];

const PRICES = [
  { id: 'price_arch', company_id: 'co_lexi', data: { source: 'Custom', description: 'Architectural shingles', code: 'RFG', unit: 'SQ', price: 450, is_active: true } },
  { id: 'price_tab', company_id: 'co_lexi', data: { source: 'Custom', description: '3-tab shingles', code: 'RFG3', unit: 'SQ', price: 300, is_active: true } },
  { id: 'price_hidden', company_id: 'co_lexi', data: { source: 'Custom', description: 'Architectural shingles', code: 'OLD', unit: 'SQ', price: 1, is_active: false } },
  { id: 'price_ice', company_id: 'co_lexi', data: { source: 'Xactimate', description: 'Ice and water shield', code: 'IWS', unit: 'SQ', price: 75, is_active: true } },
  { id: 'price_other', company_id: 'co_other', data: { source: 'Custom', description: 'Secret price', code: 'SEC', unit: 'EA', price: 5, is_active: true } },
];

function clone(row) {
  return { ...row, data: row.data ? { ...row.data } : {}, items: Array.isArray(row.items) ? row.items.map((item) => ({ ...item })) : row.items };
}

function estimatePool(extraEstimates = []) {
  const estimates = ESTIMATES.concat(extraEstimates).map(clone);
  const customers = CUSTOMERS.map((row) => ({ ...row }));
  const leads = LEADS.map((row) => ({ ...row }));
  const prices = PRICES.map((row) => ({ ...row, data: { ...row.data } }));
  const queries = [];
  const pool = {
    queries,
    estimates,
    query: async (sql, params) => {
      queries.push(sql);
      if (/twilio\.com|api\.openai|Accounts\//i.test(sql)) throw new Error(`unexpected live call: ${sql}`);
      const companyId = params && params[0];
      if (/INSERT INTO estimates/i.test(sql)) {
        if (!/'draft'/.test(sql)) throw new Error('insert did not force draft');
        const row = {
          id: params[0], company_id: params[1], customer_id: params[2], lead_id: params[3],
          customer_name: params[4], customer_email: params[5], customer_phone: params[6],
          estimate_number: params[7], title: params[8], status: 'draft', total_amount: params[9],
          property_address: params[10], items: JSON.parse(params[11]), notes: params[12],
          created_by: params[13], data: JSON.parse(params[14]),
        };
        if (row.company_id !== 'co_lexi') return { rowCount: 0, rows: [] };
        estimates.push(row);
        return { rowCount: 1, rows: [] };
      }
      if (/^\s*(UPDATE|DELETE)\b/i.test(sql)) throw new Error(`unexpected write: ${sql}`);
      if (/FROM estimates/i.test(sql)) return { rows: estimates.filter((row) => row.company_id === companyId) };
      if (/FROM customers/i.test(sql)) return { rows: customers.filter((row) => row.company_id === companyId) };
      if (/FROM leads/i.test(sql)) return { rows: leads.filter((row) => row.company_id === companyId) };
      if (/FROM companies/i.test(sql)) return { rows: [{ company_name: 'YICN' }] };
      if (/PriceListItem/i.test(sql)) return { rows: prices.filter((row) => row.company_id === companyId) };
      return { rows: [] };
    },
  };
  return pool;
}

function unlocked() {
  const state = lexi.sessionFromThread(lexi.emptyThread('+15555550123'));
  state.pinVerified = true;
  return state;
}

async function tool(name, args, state, extra = {}) {
  return lexi.executePhoneTool(
    { name, args },
    { state, config: config(), pool: extra.pool || estimatePool(), owner: extra.owner || OWNER, sendCustomerMessage: extra.send }
  );
}

async function main() {
  console.log('\nFollow-ups');
  const pool = estimatePool();
  const waiting = await estimates.listEstimateFollowUps(pool, OWNER, {}, NOW);
  const names = waiting.rows.map((row) => row.customer_name);
  check('default 7 days keeps sent and viewed that are old enough', waiting.count === 3 && names[0] === 'Eve Cole' && names.includes('Ada Lane') && names.includes('Pat Kim'), names.join(','));
  check('accepted, draft, declined, recent, and other tenants stay out', !names.some((name) => /Ben|Night|Cara|Dana|Declined/.test(name)));
  check('the spoken answer has the count and total', /3 estimates need a follow-up after 7 days/.test(waiting.spoken) && /\$6,000\.00/.test(waiting.spoken) && /Eve Cole/.test(waiting.spoken));
  check('a stored sent date beats a later edit', waiting.rows.find((row) => row.customer_name === 'Pat Kim').days === 20);
  const sooner = await estimates.listEstimateFollowUps(pool, OWNER, { days: 2 }, NOW);
  check('a shorter window adds the viewed estimate and stays newest first', sooner.count === 4 && sooner.rows[0].customer_name === 'Ben Ortiz' && sooner.rows.some((row) => row.customer_name === 'Eve Cole'));
  const many = estimatePool(Array.from({ length: 12 }, (_, i) => estimateRow({
    id: `extra_${i}`, estimate_number: `EST-${String(20 + i).padStart(4, '0')}`, customer_name: `Extra ${i}`,
    customer_phone: `+15555550${String(200 + i)}`, total_amount: 10, updated_at: '2026-09-01T15:00:00Z', data: {},
  })));
  const capped = await estimates.listEstimateFollowUps(many, OWNER, {}, NOW);
  check('text rows stop at 10 while the count stays full', capped.rows.length === 10 && capped.count === 15, `${capped.rows.length} ${capped.count}`);

  console.log('\nDrafted follow-ups');
  const wired = await tool('list_estimate_followups', { days: 0 }, unlocked(), { pool });
  check('the phone tool reaches the follow-up list', wired.success === true && wired.count >= 3);
  const state = unlocked();
  const sends = [];
  const send = async (draft) => { sends.push(draft); return { success: true }; };
  const one = await estimates.draftEstimateFollowUp(pool, OWNER, { customer: 'Eve Cole' }, state, NOW);
  check('one follow-up is read back in full and not sent', one.sent === false && /Eve Cole/.test(one.read_back) && /Estimate EST-0004/.test(one.read_back) && /\$1,000\.00/.test(one.read_back) && /token=abc/.test(one.read_back) && sends.length === 0);
  state.latestUserText = 'yes';
  const held = await tool('confirm_send', {}, state, { pool, send });
  check('yes does not send the follow-up', held.code === 'CONFIRMATION_REQUIRED' && sends.length === 0);
  state.latestUserText = 'yes, send it';
  const sent = await tool('confirm_send', {}, state, { pool, send });
  check('yes, send it sends the drafted text once', sent.sent === true && sends.length === 1 && /still open/.test(sends[0].message) && sends[0].to === '+15555550111');
  check('the follow-up does not change the estimate', pool.estimates.find((row) => row.id === 'est_eve').status === 'sent');

  const patState = unlocked();
  const pat = await tool('draft_estimate_followup', { estimate_number: 'EST-0001', channel: 'sms' }, patState, { pool });
  check('an unsigned estimate link is left out of the text', pat.sent === false && /ViewEstimate/.test(pat.read_back) === false && /EST-0001/.test(pat.read_back));
  const accepted = await estimates.draftEstimateFollowUp(pool, OWNER, { customer: 'Cara Nguyen' }, unlocked(), NOW);
  check('an accepted estimate is not followed up', accepted.success === false && /Nothing was drafted/.test(accepted.error));
  const recent = await estimates.draftEstimateFollowUp(pool, OWNER, { customer: 'Night Owl' }, unlocked(), NOW);
  const recentHeld = await estimates.draftEstimateFollowUp(pool, OWNER, { customer: 'Night Owl', days: 7 }, unlocked(), NOW);
  check('a named follow-up can be recent, and a 7-day follow-up cannot', recent.drafted === true && /Night Owl/.test(recent.read_back) && recentHeld.success === false);

  const batchState = unlocked();
  const batchSends = [];
  const batchPool = estimatePool();
  const batch = await estimates.prepareEstimateFollowUps(batchPool, OWNER, { days: 7, channel: 'sms' }, batchState, NOW);
  check('a batch is drafted and not sent', batch.sent === false && batch.count === 3 && batchSends.length === 0 && /yes, send it/.test(batch.spoken));
  batchState.latestUserText = 'yes, send it';
  const batchSent = await tool('confirm_send', {}, batchState, {
    pool: batchPool,
    send: async (draft) => { batchSends.push(draft); return { success: true }; },
  });
  check('one yes sends the whole follow-up batch', batchSent.sent === true && batchSent.count === 3 && batchSends.length === 3 && /estimate follow-up/.test(batchSent.message));

  const capPool = estimatePool(Array.from({ length: 21 }, (_, i) => estimateRow({
    id: `batch_${i}`, estimate_number: `EST-${String(30 + i).padStart(4, '0')}`, customer_name: `Batch ${i}`,
    customer_phone: `+15555551${String(100 + i)}`, total_amount: 25, updated_at: '2026-09-01T15:00:00Z', data: {},
  })));
  const capState = unlocked();
  const cap = await estimates.prepareEstimateFollowUps(capPool, OWNER, { days: 1 }, capState, NOW);
  check('follow-up batches stop at 20', cap.count === 20 && cap.left_out >= 1, `${cap.count} ${cap.left_out}`);

  console.log('\nNew drafts');
  const draftPool = estimatePool();
  const draftState = unlocked();
  const drafted = await tool('prepare_estimate_draft', {
    customer: 'Ada Lane',
    phone: '+15555550112',
    address: '12 Oak St',
    job_type: 'Roof',
    items: [
      { description: 'Architectural shingles', quantity: 30, unit: 'SQ' },
      { description: 'Ice and water shield', quantity: 2 },
    ],
  }, draftState, { pool: draftPool });
  check('a draft reads back catalog lines and the total without saving', drafted.written === false && /\$13,500\.00/.test(drafted.read_back) && /\$150\.00/.test(drafted.read_back) && /\$13,650\.00/.test(drafted.read_back) && draftPool.estimates.length === ESTIMATES.length);
  check('catalog prices are named as the source', drafted.lines.every((line) => line.priced_from === 'catalog'));
  draftState.latestUserText = 'yes, send it';
  const notSaved = await tool('confirm_estimate_draft', {}, draftState, { pool: draftPool });
  check('yes, send it does not save or send the estimate', notSaved.code === 'CONFIRMATION_REQUIRED' && draftPool.estimates.length === ESTIMATES.length);
  draftState.latestUserText = 'yes';
  const saved = await tool('confirm_estimate_draft', {}, draftState, { pool: draftPool });
  const created = draftPool.estimates.find((row) => row.estimate_number === 'EST-0009');
  check('yes saves one draft for this company only', saved.written === true && saved.sent === false && created && created.status === 'draft' && created.company_id === 'co_lexi' && created.customer_id === 'cus_ada' && created.total_amount === 13650, created && created.estimate_number);

  const priced = estimatePool();
  const pricedState = unlocked();
  const spoken = await tool('prepare_estimate_draft', {
    customer: 'Ada Lane',
    phone: '+15555550112',
    job_type: 'Roof',
    items: [{ description: 'Architectural shingles', quantity: 2, unit_price: 100 }],
  }, pricedState, { pool: priced });
  check('a spoken price beats the catalog', spoken.lines[0].priced_from === 'spoken' && /\$200\.00/.test(spoken.read_back));

  const fuzzy = await tool('prepare_estimate_draft', {
    customer: 'Ada Lane',
    phone: '+15555550112',
    items: [{ description: 'shingles', quantity: 1 }],
  }, unlocked(), { pool: estimatePool() });
  check('two catalog prices are not guessed', fuzzy.code === 'WHICH_PRICE' && fuzzy.written !== true);

  const missingPrice = await tool('prepare_estimate_draft', {
    customer: 'Ada Lane',
    phone: '+15555550112',
    scope: 'Secret price',
  }, unlocked(), { pool: estimatePool() });
  check('another company catalog price is not used', missingPrice.success === false && /No catalog price/.test(missingPrice.error));

  const which = await tool('prepare_estimate_draft', {
    customer: 'Ada',
    items: [{ description: 'Architectural shingles', quantity: 1, unit_price: 10 }],
  }, unlocked(), { pool: estimatePool() });
  check('two customers with the same name are not guessed', which.code === 'WHICH_CUSTOMER');

  const leadPool = estimatePool();
  const leadState = unlocked();
  await tool('prepare_estimate_draft', {
    customer: 'Gus Hale',
    job_type: 'Gutters',
    items: [{ description: 'Gutter install', quantity: 1, unit_price: 800 }],
  }, leadState, { pool: leadPool });
  leadState.latestUserText = 'yes';
  await tool('confirm_estimate_draft', {}, leadState, { pool: leadPool });
  const gus = leadPool.estimates.find((row) => row.customer_name === 'Gus Hale');
  check('a lead becomes a draft linked to the lead', gus && gus.lead_id === 'lead_gus' && gus.customer_id == null && gus.status === 'draft');

  const locked = await tool('prepare_estimate_draft', { action: 'update', customer: 'Ada Lane', phone: '+15555550112', unit_price: 1 }, unlocked(), { pool: estimatePool() });
  check('a price edit on an existing estimate is refused', locked.code === 'EXISTING_ESTIMATE_LOCKED');
  const financeWrite = await tool('update_estimate', { estimate_number: 'EST-0005', total_amount: 1 }, unlocked(), { pool: estimatePool() });
  check('a direct estimate update is still read-only', financeWrite.code === 'FINANCE_READ_ONLY');
  const deleted = await tool('delete_estimate', { id: 'est_ada' }, unlocked(), { pool: estimatePool() });
  check('deleting an estimate is refused', deleted.code === 'DELETE_FORBIDDEN');

  console.log('\nDuplicates');
  const copyPool = estimatePool();
  const copyState = unlocked();
  const copy = await tool('prepare_estimate_duplicate', { estimate_number: 'EST-0005' }, copyState, { pool: copyPool });
  check('a duplicate is read back and the original is untouched', copy.written === false && /EST-0009/.test(copy.read_back) && /\$5,000\.00/.test(copy.read_back) && /accepted/.test(copy.read_back) && copyPool.estimates.find((row) => row.id === 'est_cara').status === 'accepted');
  copyState.latestUserText = 'yes';
  const copied = await tool('confirm_estimate_draft', {}, copyState, { pool: copyPool });
  const copyRow = copyPool.estimates.find((row) => row.estimate_number === 'EST-0009');
  const original = copyPool.estimates.find((row) => row.id === 'est_cara');
  check('yes saves the copy as a draft and leaves the original accepted', copied.sent === false && copyRow.status === 'draft' && copyRow.total_amount === 5000 && copyRow.items[0].description === 'Roof' && copyRow.data.sent_at == null && copyRow.data.duplicated_from_id === 'est_cara' && original.status === 'accepted' && original.total_amount === 5000);

  console.log('\nGates');
  const lockedPool = estimatePool();
  const denied = await tool('list_estimate_followups', {}, lexi.sessionFromThread(lexi.emptyThread('+15555550123')), { pool: lockedPool });
  check('estimate answers need the PIN', denied.code === 'PIN_REQUIRED' && lockedPool.queries.length === 0);
  const src = fs.readFileSync(path.join(__dirname, '../lib/lexiEstimates.cjs'), 'utf8');
  check('estimate tools do not call Twilio or rewrite an existing row', !/api\.twilio\.com|TWILIO_AUTH|fetch\(/.test(src) && !/UPDATE estimates|DELETE FROM estimates/i.test(src));
  const prompt = lexi.buildPhoneSystemPrompt({ basePrompt: '', ownerName: 'Kevin', pinVerified: true, companyResolved: true });
  check('voice follow-ups stay short and a new estimate is not sent', /list_estimate_followups/.test(prompt) && /speak only the spoken count and total/.test(prompt) && /at most 20/.test(prompt) && /does not send it/.test(prompt));
  const textPrompt = lexi.buildPhoneSystemPrompt({ basePrompt: '', ownerName: 'Kevin', pinVerified: true, companyResolved: true, channel: 'team_chat' });
  check('Team Chat does not ask for the PIN again', /Do not ask for a PIN/.test(textPrompt) && /up to 10 rows/.test(textPrompt));
  const pending = unlocked();
  pending.pendingEstimate = { action: 'create', label: 'Ada' };
  const thread = lexi.applySessionToThread(lexi.emptyThread('+15555550123'), pending);
  check('a pending estimate survives the thread', thread.pending_estimate.label === 'Ada');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
