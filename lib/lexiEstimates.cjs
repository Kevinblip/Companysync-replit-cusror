'use strict';

// Estimate follow-ups and new drafts for Lexi. Follow-up texts use the same
// drafted-message path as payment reminders. A new estimate is inserted as a
// draft only, after yes. Nothing here edits an accepted or sent estimate,
// changes a price on an existing estimate, deletes a row, or sends the estimate.

const { formatMoney, zonedYmd } = require('./lexiFinance.cjs');

const LIST_CAP = 10;
const FOLLOWUP_CAP = 20;
const DEFAULT_DAYS = 7;
const OPEN_STATUS = new Set(['sent', 'viewed']);
const LOCKED_ACTION = /^(update|edit|reprice|change|revise|delete|remove|void)$/;

function roundMoney(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function parseData(row) {
  if (!row) return {};
  if (row.data && typeof row.data === 'object') return row.data;
  if (typeof row.data === 'string') {
    try { return JSON.parse(row.data) || {}; } catch (e) { return {}; }
  }
  return {};
}

function parseItems(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }
  return [];
}

function requireCompany(owner) {
  if (!owner?.companyId) {
    return {
      success: false,
      code: 'COMPANY_UNRESOLVED',
      error: `No company is linked to ${owner?.userEmail || 'this caller'}, so no estimates were read. Say that sentence.`,
    };
  }
  return null;
}

async function readRows(pool, label, sql, params) {
  try {
    const { rows } = await pool.query(sql, params);
    return rows || [];
  } catch (err) {
    console.warn(`[LexiEstimates] ${label} skipped:`, err.message);
    return [];
  }
}

function ownCompany(rows, companyId) {
  return (rows || []).filter((row) => String(row.company_id || companyId) === String(companyId));
}

function last10(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function nameMatches(candidate, query) {
  const want = String(query || '').trim().toLowerCase();
  if (!want) return true;
  return String(candidate || '').toLowerCase().includes(want);
}

function firstNameOf(name) {
  const first = String(name || '').trim().split(/\s+/)[0];
  return first || 'there';
}

function ymdOf(value, now) {
  if (!value) return '';
  const text = String(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match && text.length <= 10) return match[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return zonedYmd(parsed);
}

function daysBetween(earlierYmd, laterYmd) {
  const a = Date.parse(`${earlierYmd}T00:00:00Z`);
  const b = Date.parse(`${laterYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

function followUpDays(args) {
  const raw = args?.days ?? args?.after_days ?? args?.older_than_days;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 3650) return null;
  return n;
}

function statusOf(row) {
  return String(row.status || parseData(row).status || '').toLowerCase();
}

function archived(row) {
  const data = parseData(row);
  return row.is_archived === true || data.is_archived === true;
}

function activityIso(row) {
  const data = parseData(row);
  const status = statusOf(row);
  const candidates = status === 'viewed'
    ? [data.viewed_at, data.last_viewed_at, data.sent_at, data.sent_date, row.updated_at, row.created_at]
    : [data.sent_at, data.sent_date, data.emailed_at, data.viewed_at, row.updated_at, row.created_at];
  return candidates.find(Boolean) || '';
}

function storedLink(row) {
  const data = parseData(row);
  const link = String(data.share_url || data.estimate_url || data.signed_url || '').trim();
  if (!/^https:\/\//i.test(link)) return '';
  if (/viewestimate/i.test(link) && !/[?&](t|token|sig)=/i.test(link)) return '';
  return link;
}

async function loadEstimates(pool, companyId) {
  return ownCompany(await readRows(
    pool,
    'estimates',
    `SELECT id, company_id, customer_id, lead_id, customer_name, customer_email, customer_phone,
            estimate_number, title, status, total_amount, property_address, items, notes, data,
            created_at, updated_at
     FROM estimates WHERE company_id = $1`,
    [companyId]
  ), companyId);
}

async function loadCustomers(pool, companyId) {
  return ownCompany(await readRows(
    pool,
    'customers',
    `SELECT id, company_id, name, phone, email, address, street, city, state, zip
     FROM customers WHERE company_id = $1`,
    [companyId]
  ), companyId);
}

async function loadLeads(pool, companyId) {
  return ownCompany(await readRows(
    pool,
    'leads',
    `SELECT id, company_id, name, phone, email, address, street, city, state, zip
     FROM leads WHERE company_id = $1`,
    [companyId]
  ), companyId);
}

async function loadCompanyName(pool, companyId) {
  const rows = await readRows(
    pool,
    'company',
    `SELECT company_name, name FROM companies WHERE id = $1 LIMIT 1`,
    [companyId]
  );
  return rows[0]?.company_name || rows[0]?.name || '';
}

async function loadPriceItems(pool, companyId) {
  const rows = ownCompany(await readRows(
    pool,
    'price-list',
    `SELECT id, company_id, data FROM generic_entities
     WHERE entity_type = 'PriceListItem' AND company_id = $1
     LIMIT 2000`,
    [companyId]
  ), companyId);
  return rows.map((row) => {
    const data = parseData(row);
    const price = Number(data.price ?? data.rate ?? data.unit_price);
    return {
      id: row.id,
      code: String(data.code || data.sku || '').trim(),
      description: String(data.description || data.name || '').trim(),
      source: String(data.source || '').trim(),
      unit: String(data.unit || data.uom || '').trim(),
      price: Number.isFinite(price) ? price : null,
      active: data.is_active !== false && data.active !== false,
    };
  }).filter((item) => item.active && item.description && item.price !== null);
}

function describeFollowUp(row, todayYmd) {
  const when = activityIso(row);
  const ymd = ymdOf(when);
  const days = ymd ? daysBetween(ymd, todayYmd) : null;
  return {
    id: row.id,
    company_id: row.company_id,
    customer_name: String(row.customer_name || '').trim() || 'Unknown customer',
    customer_phone: String(row.customer_phone || '').trim(),
    customer_email: String(row.customer_email || '').trim(),
    customer_id: row.customer_id || '',
    estimate_number: String(row.estimate_number || '').trim(),
    title: String(row.title || '').trim(),
    status: statusOf(row),
    total_amount: roundMoney(row.total_amount),
    total: formatMoney(row.total_amount),
    days,
    when: ymd,
    link: storedLink(row),
    row,
  };
}

function waitingEstimates(rows, days, todayYmd) {
  return rows
    .filter((row) => !archived(row) && OPEN_STATUS.has(statusOf(row)))
    .map((row) => describeFollowUp(row, todayYmd))
    .filter((row) => row.days !== null && row.days >= days)
    .sort((a, b) => {
      if (a.when !== b.when) return a.when < b.when ? 1 : -1;
      return String(b.estimate_number).localeCompare(String(a.estimate_number));
    });
}

function followUpSpoken(rows, days) {
  if (!rows.length) return `No sent or viewed estimates have been waiting ${days} day${days === 1 ? '' : 's'}.`;
  const total = formatMoney(rows.reduce((sum, row) => sum + row.total_amount, 0));
  return `${rows.length} estimate${rows.length === 1 ? '' : 's'} need a follow-up after ${days} day${days === 1 ? '' : 's'}, ${total}. Newest is ${rows[0].customer_name}, ${rows[0].total}.`;
}

async function listEstimateFollowUps(pool, owner, args = {}, now = new Date()) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  const days = followUpDays(args);
  if (days === null) return { success: false, error: 'Say a whole number of days, or leave it blank for 7.' };
  const rows = waitingEstimates(await loadEstimates(pool, owner.companyId), days, zonedYmd(now));
  const listed = rows.slice(0, LIST_CAP).map((row) => ({
    id: row.id,
    customer_name: row.customer_name,
    estimate_number: row.estimate_number,
    title: row.title,
    status: row.status,
    days: row.days,
    total: row.total,
  }));
  const spoken = followUpSpoken(rows, days);
  return {
    success: true,
    days,
    count: rows.length,
    total: formatMoney(rows.reduce((sum, row) => sum + row.total_amount, 0)),
    rows: listed,
    spoken,
    message: `On a call, say only this: ${spoken} In a text, you may list up to ${LIST_CAP} with the estimate number, status, days, and total. Do not invent an estimate.`,
  };
}

function contactFor(estimate, customers) {
  const byId = estimate.customer_id
    ? customers.find((row) => String(row.id) === String(estimate.customer_id))
    : null;
  return {
    name: estimate.customer_name || byId?.name || 'there',
    phone: estimate.customer_phone || byId?.phone || '',
    email: estimate.customer_email || byId?.email || '',
  };
}

function followUpText({ firstName, companyName, estimateNumber, title, amount, link }) {
  const who = companyName || 'us';
  const what = estimateNumber ? `Estimate ${estimateNumber}` : (title || 'Your estimate');
  const extra = link ? ` You can review it here: ${link}` : '';
  return `Hi ${firstName}, this is ${who}. ${what} for ${formatMoney(amount)} is still open.${extra} Reply if you have a question. Thank you.`;
}

function buildFollowUp(estimate, contact, channel, companyName) {
  const to = channel === 'email' ? contact.email : contact.phone;
  const number = estimate.estimate_number;
  return {
    channel,
    to: String(to || '').trim(),
    subject: channel === 'email' ? `Estimate ${number || estimate.title || ''} from ${companyName || 'us'}`.trim() : '',
    message: followUpText({
      firstName: firstNameOf(contact.name),
      companyName,
      estimateNumber: number,
      title: estimate.title,
      amount: estimate.total_amount,
      link: estimate.link,
    }),
    contact_name: contact.name,
    estimate_number: number,
    amount: estimate.total,
  };
}

function pickChannel(args, contact) {
  const requested = String(args.channel || '').toLowerCase();
  if (requested === 'email' || requested === 'sms') return requested;
  return contact.phone ? 'sms' : 'email';
}

async function matchFollowUps(pool, owner, args, now) {
  const days = followUpDays(args);
  if (days === null) return { error: { success: false, error: 'Say a whole number of days, or leave it blank for 7.' } };
  const estimates = waitingEstimates(await loadEstimates(pool, owner.companyId), days, zonedYmd(now));
  const number = String(args.estimate_number || args.number || '').trim();
  const customer = String(args.customer || args.customer_name || args.name || '').trim();
  let matches = estimates;
  if (number) matches = matches.filter((row) => row.estimate_number.toLowerCase() === number.toLowerCase());
  if (customer) matches = matches.filter((row) => nameMatches(row.customer_name, customer));
  return { days, matches, customers: await loadCustomers(pool, owner.companyId), companyName: await loadCompanyName(pool, owner.companyId) };
}

async function draftEstimateFollowUp(pool, owner, args = {}, state, now = new Date()) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  if (!String(args.estimate_number || args.number || args.customer || args.customer_name || args.name || '').trim()) {
    return { success: false, error: 'Say which estimate or customer the follow-up is for.' };
  }
  const scoped = { ...args };
  if (scoped.days == null && scoped.after_days == null && scoped.older_than_days == null) scoped.days = 0;
  const found = await matchFollowUps(pool, owner, scoped, now);
  if (found.error) return found.error;
  if (!found.matches.length) {
    return {
      success: false,
      error: found.days > 0
        ? 'No sent or viewed estimate is waiting that long for that customer. Nothing was drafted.'
        : 'No sent or viewed estimate for that customer. Nothing was drafted.',
    };
  }
  if (found.matches.length > 1) {
    const listed = found.matches.slice(0, LIST_CAP).map((row) => `${row.customer_name} ${row.estimate_number} ${row.total}`).join('; ');
    return { success: false, code: 'WHICH_ESTIMATE', error: `Several estimates match. Ask which one. ${listed}` };
  }
  const estimate = found.matches[0];
  const contact = contactFor(estimate, found.customers);
  const channel = pickChannel(args, contact);
  const draft = buildFollowUp(estimate, contact, channel, found.companyName);
  if (!draft.to) {
    return { success: false, error: `No ${channel === 'email' ? 'email' : 'phone'} is on file for ${contact.name}. Nothing was drafted.` };
  }
  state.pendingReminderBatch = null;
  state.pendingDraft = {
    channel: draft.channel,
    to: draft.to,
    subject: draft.subject,
    message: draft.message,
    contact_name: draft.contact_name,
    drafted_at: new Date().toISOString(),
  };
  const who = draft.contact_name || draft.to;
  const readBack = channel === 'email'
    ? `Email to ${who} at ${draft.to}. Subject: ${draft.subject}. ${draft.message}`
    : `Text to ${who} at ${draft.to}: ${draft.message}`;
  return {
    success: true,
    drafted: true,
    sent: false,
    read_back: readBack,
    message: `Draft only. Read the full text and the recipient back. Do not say it was sent. He must say "yes, send it". The estimate itself is not sent. ${readBack}`,
  };
}

async function prepareEstimateFollowUps(pool, owner, args = {}, state, now = new Date()) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  const found = await matchFollowUps(pool, owner, args, now);
  if (found.error) return found.error;
  const requested = String(args.channel || 'sms').toLowerCase();
  const channel = requested === 'email' ? 'email' : 'sms';
  const skipped = [];
  const ready = [];
  for (const estimate of found.matches) {
    const contact = contactFor(estimate, found.customers);
    const draft = buildFollowUp(estimate, contact, channel, found.companyName);
    if (!draft.to) {
      skipped.push(`${estimate.customer_name} ${estimate.estimate_number} has no ${channel === 'email' ? 'email' : 'phone'}`);
      continue;
    }
    ready.push(draft);
  }
  const capped = ready.slice(0, FOLLOWUP_CAP);
  const leftOut = ready.length - capped.length;
  if (!capped.length) {
    state.pendingReminderBatch = null;
    return { success: false, error: skipped[0] || 'No estimates are waiting for a follow-up. Nothing was drafted.' };
  }
  state.pendingDraft = null;
  state.pendingReminderBatch = {
    kind: 'estimate_followup',
    channel,
    items: capped,
    prepared_at: new Date().toISOString(),
  };
  const lines = capped.map((item) => `${item.contact_name}, ${item.estimate_number}, ${item.amount}, ${item.channel} to ${item.to}`);
  const spoken = `${capped.length} estimate follow-up${capped.length === 1 ? '' : 's'} ${capped.length === 1 ? 'is' : 'are'} ready. ${lines.join('. ')}. Nothing was sent. One "yes, send it" sends this batch.`;
  return {
    success: true,
    drafted: true,
    sent: false,
    count: capped.length,
    capped: leftOut > 0,
    left_out: leftOut,
    skipped,
    days: found.days,
    items: capped.map((item) => ({
      contact_name: item.contact_name,
      estimate_number: item.estimate_number,
      amount: item.amount,
      channel: item.channel,
      to: item.to,
      message: item.message,
    })),
    spoken,
    message: `${spoken}${leftOut > 0 ? ` ${leftOut} more were left out because the batch stops at ${FOLLOWUP_CAP}.` : ''}${skipped.length ? ` Skipped: ${skipped.join('; ')}.` : ''} On a call, say each name, estimate number, and total. In a text, you may include each full message. The estimates themselves are not sent.`,
  };
}

function lockedEdit(args) {
  const action = String(args?.action || args?.entity_action || '').toLowerCase();
  if (LOCKED_ACTION.test(action)) return true;
  if (args?.new_price != null || args?.price_change != null || args?.change_price != null) return true;
  return false;
}

function lockedResult() {
  return {
    success: false,
    code: 'EXISTING_ESTIMATE_LOCKED',
    written: false,
    error: 'An existing estimate was not changed. Accepted and sent estimates stay as they are, and prices on an existing estimate are not edited. A new draft can be saved after yes. Nothing was sent.',
  };
}

function normalizeSearch(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function significantWords(text) {
  return normalizeSearch(text).split(' ').filter((word) => word.length > 3);
}

function uniqueMatch(items, predicate) {
  const hits = items.filter(predicate);
  if (hits.length === 1) return { item: hits[0] };
  if (hits.length > 1) return { ambiguous: hits };
  return null;
}

function matchCatalog(description, items) {
  const custom = items.filter((item) => item.source.toLowerCase() === 'custom');
  const pools = custom.length ? [custom, items.filter((item) => item.source.toLowerCase() !== 'custom')] : [items];
  const want = normalizeSearch(description);
  const words = significantWords(description);
  for (const pool of pools) {
    const exactCode = uniqueMatch(pool, (item) => normalizeSearch(item.code) === want && want);
    if (exactCode) return exactCode;
    const exact = uniqueMatch(pool, (item) => normalizeSearch(item.description) === want);
    if (exact) return exact;
    if (words.length) {
      const wordHit = uniqueMatch(pool, (item) => {
        const desc = normalizeSearch(item.description);
        return words.every((word) => desc.split(' ').includes(word) || desc.includes(word));
      });
      if (wordHit) return wordHit;
    }
    if (custom.length && pool === custom) continue;
  }
  return null;
}

function spokenLines(args) {
  const raw = args.items || args.line_items || args.lines;
  if (Array.isArray(raw) && raw.length) return raw;
  const scope = String(args.scope || args.description || args.job_type || '').trim();
  if (!scope) return [];
  return [{
    description: scope,
    quantity: args.quantity,
    unit: args.unit,
    unit_price: args.unit_price ?? args.price ?? args.rate,
  }];
}

function addressOf(row) {
  if (!row) return '';
  if (row.address) return String(row.address).trim();
  if (row.property_address) return String(row.property_address).trim();
  return [row.street, row.city, row.state, row.zip].filter(Boolean).join(', ');
}

function peopleMatch(rows, args) {
  const phone = last10(args.phone);
  const name = String(args.customer || args.customer_name || args.name || args.lead || '').trim();
  if (!phone && !name) return [];
  return rows.filter((row) => {
    if (phone && last10(row.phone) !== phone) return false;
    if (name && !nameMatches(row.name, name)) return false;
    return true;
  });
}

async function resolveParty(pool, owner, args) {
  const customers = peopleMatch(await loadCustomers(pool, owner.companyId), args);
  if (customers.length > 1) {
    return { error: { success: false, code: 'WHICH_CUSTOMER', error: `Several customers match. Ask which one. ${customers.slice(0, LIST_CAP).map((row) => row.name).join('; ')}` } };
  }
  if (customers.length === 1) return { party: customers[0], kind: 'customer' };
  const leads = peopleMatch(await loadLeads(pool, owner.companyId), args);
  if (leads.length > 1) {
    return { error: { success: false, code: 'WHICH_LEAD', error: `Several leads match. Ask which one. ${leads.slice(0, LIST_CAP).map((row) => row.name).join('; ')}` } };
  }
  if (leads.length === 1) return { party: leads[0], kind: 'lead' };
  const spoken = String(args.customer || args.customer_name || args.name || args.lead || '').trim();
  if (!spoken && !last10(args.phone)) return { error: { success: false, error: 'Say who the estimate is for.' } };
  return {
    party: {
      name: spoken || 'Customer',
      phone: String(args.phone || '').trim(),
      email: String(args.email || '').trim(),
      address: String(args.address || '').trim(),
    },
    kind: 'spoken',
  };
}

function priceLines(rawLines, catalog) {
  const lines = [];
  for (const raw of rawLines) {
    const description = String(raw.description || raw.name || raw.scope || '').trim();
    if (!description) return { error: 'Every line needs a description. Nothing was saved.' };
    const quantity = raw.quantity == null || raw.quantity === '' ? 1 : Number(raw.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return { error: `Quantity for ${description} needs to be a number above zero. Nothing was saved.` };
    const spoken = raw.unit_price ?? raw.price ?? raw.rate;
    let rate = null;
    let unit = String(raw.unit || '').trim();
    let code = '';
    let pricedFrom = '';
    if (spoken !== undefined && spoken !== null && spoken !== '') {
      rate = Number(spoken);
      if (!Number.isFinite(rate) || rate < 0) return { error: `The price for ${description} is not a number. Nothing was saved.` };
      pricedFrom = 'spoken';
    } else {
      const found = matchCatalog(description, catalog);
      if (found?.ambiguous) {
        const choices = found.ambiguous.slice(0, 5).map((item) => `${item.description} ${formatMoney(item.price)}`).join('; ');
        return { error: `Several catalog prices match ${description}. Ask which one. ${choices}`, code: 'WHICH_PRICE' };
      }
      if (!found?.item) return { error: `No catalog price for ${description}. Say the price. Nothing was saved.` };
      rate = found.item.price;
      unit = unit || found.item.unit;
      code = found.item.code;
      pricedFrom = 'catalog';
    }
    const amount = roundMoney(quantity * rate);
    lines.push({
      description,
      quantity,
      unit: unit || 'EA',
      rate: roundMoney(rate),
      unit_price: roundMoney(rate),
      amount,
      rcv: amount,
      code,
      priced_from: pricedFrom,
    });
  }
  return { lines };
}

function lineReadBack(line) {
  return `${line.description}, ${line.quantity} ${line.unit} at ${formatMoney(line.rate)}, ${formatMoney(line.amount)}`;
}

function nextEstimateNumber(rows) {
  let max = 0;
  for (const row of rows) {
    const match = String(row.estimate_number || '').trim().match(/^EST-(\d+)$/i);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `EST-${String(max + 1).padStart(4, '0')}`;
}

function newId() {
  return `est_lexi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isExplicitEstimateConfirmation(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/[“”"]/g, '')
    .replace(/[.!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/send it|book it|move it|cancel it/.test(t)) return false;
  return /^(yes|yeah|yep|yes please|yes,? do it|yes,? save it|yes,? save the draft|yes,? duplicate it)$/.test(t);
}

async function prepareEstimateDraft(pool, owner, args = {}, state) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  if (lockedEdit(args)) return lockedResult();
  const rawLines = spokenLines(args);
  if (!rawLines.length) return { success: false, error: 'Say the line items or a rough scope. Nothing was saved.' };
  const partyResult = await resolveParty(pool, owner, args);
  if (partyResult.error) return partyResult.error;
  const catalog = await loadPriceItems(pool, owner.companyId);
  const priced = priceLines(rawLines, catalog);
  if (priced.error) return { success: false, code: priced.code, written: false, error: priced.error };
  const estimates = await loadEstimates(pool, owner.companyId);
  const party = partyResult.party;
  const address = String(args.address || addressOf(party) || '').trim();
  const job = String(args.job_type || args.trade || '').trim();
  const title = (job || priced.lines[0].description).slice(0, 120);
  const total = roundMoney(priced.lines.reduce((sum, line) => sum + line.amount, 0));
  const number = nextEstimateNumber(estimates);
  const record = {
    id: newId(),
    company_id: owner.companyId,
    customer_id: partyResult.kind === 'customer' ? party.id : null,
    lead_id: partyResult.kind === 'lead' ? party.id : null,
    customer_name: party.name || '',
    customer_email: party.email || String(args.email || '').trim(),
    customer_phone: party.phone || String(args.phone || '').trim(),
    estimate_number: number,
    title,
    status: 'draft',
    total_amount: total,
    property_address: address,
    items: priced.lines,
    notes: String(args.scope || args.notes || '').trim(),
    created_by: owner.userEmail || '',
    data: {
      source: 'lexi_phone',
      job_type: job,
      line_items: priced.lines,
      created_from: 'spoken',
    },
  };
  const lines = priced.lines.map(lineReadBack).join('. ');
  const who = party.name || 'that customer';
  const where = address ? ` at ${address}` : '';
  const readBack = `Draft estimate ${number} for ${who}${where}. ${title}. ${lines}. Total ${formatMoney(total)}. This stays a draft until you say yes. It will not be sent.`;
  state.pendingEstimate = { action: 'create', company_id: owner.companyId, label: who, read_back: readBack, record };
  return {
    success: true,
    written: false,
    sent: false,
    read_back: readBack,
    total: formatMoney(total),
    lines: priced.lines.map((line) => ({ description: line.description, quantity: line.quantity, unit: line.unit, rate: formatMoney(line.rate), amount: formatMoney(line.amount), priced_from: line.priced_from })),
    message: `Read every line and the total. Do not say it is saved. He must say yes. Do not send it to the customer. ${readBack}`,
  };
}

function findEstimates(rows, args) {
  const id = String(args.estimate_id || args.id || '').trim();
  const number = String(args.estimate_number || args.number || '').trim();
  const customer = String(args.customer || args.customer_name || args.name || '').trim();
  let matches = rows.filter((row) => !archived(row));
  if (id) matches = matches.filter((row) => String(row.id) === id);
  if (number) matches = matches.filter((row) => String(row.estimate_number || '').toLowerCase() === number.toLowerCase());
  if (customer) matches = matches.filter((row) => nameMatches(row.customer_name, customer));
  if (!id && !number && !customer) return [];
  return matches;
}

function copiedItems(row) {
  const data = parseData(row);
  const items = parseItems(row.items);
  if (items.length) return items;
  return parseItems(data.line_items);
}

async function prepareEstimateDuplicate(pool, owner, args = {}, state) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  if (lockedEdit(args)) return lockedResult();
  const rows = await loadEstimates(pool, owner.companyId);
  const matches = findEstimates(rows, args);
  if (!matches.length) return { success: false, error: 'No matching estimate to duplicate. Nothing was saved.' };
  if (matches.length > 1) {
    const listed = matches.slice(0, LIST_CAP).map((row) => `${row.customer_name || 'Unknown'} ${row.estimate_number || ''} ${formatMoney(row.total_amount)}`).join('; ');
    return { success: false, code: 'WHICH_ESTIMATE', error: `Several estimates match. Ask which one. ${listed}` };
  }
  const source = matches[0];
  const items = copiedItems(source).map((item) => ({ ...item }));
  const number = nextEstimateNumber(rows);
  const data = parseData(source);
  const kept = { ...data };
  for (const key of ['sent_at', 'sent_date', 'emailed_at', 'viewed_at', 'last_viewed_at', 'share_url', 'estimate_url', 'signed_url', 'public_url', 'accepted_date', 'status', 'id']) {
    delete kept[key];
  }
  kept.source = 'lexi_duplicate';
  kept.duplicated_from_id = source.id;
  kept.duplicated_from_number = source.estimate_number || '';
  kept.line_items = items;
  const record = {
    id: newId(),
    company_id: owner.companyId,
    customer_id: source.customer_id || null,
    lead_id: source.lead_id || null,
    customer_name: source.customer_name || '',
    customer_email: source.customer_email || '',
    customer_phone: source.customer_phone || '',
    estimate_number: number,
    title: source.title || 'Estimate',
    status: 'draft',
    total_amount: roundMoney(source.total_amount),
    property_address: source.property_address || '',
    items,
    notes: source.notes || '',
    created_by: owner.userEmail || '',
    data: kept,
  };
  const who = source.customer_name || 'that customer';
  const readBack = `Duplicate ${source.estimate_number || 'that estimate'} for ${who} as new draft ${number}. ${items.length} line${items.length === 1 ? '' : 's'}, total ${formatMoney(record.total_amount)}. The original stays ${statusOf(source) || 'unchanged'}. Say yes to save the copy. It will not be sent.`;
  state.pendingEstimate = { action: 'duplicate', company_id: owner.companyId, label: who, read_back: readBack, record, source_id: source.id };
  return {
    success: true,
    written: false,
    sent: false,
    read_back: readBack,
    message: `Read this back and wait. Do not say it is saved. He must say yes. Do not change the original and do not send the copy. ${readBack}`,
  };
}

async function confirmEstimateDraft(pool, owner, state) {
  const pending = state.pendingEstimate;
  if (!pending?.record) return { success: false, code: 'NOTHING_TO_SAVE', written: false, error: 'There is no estimate draft waiting. Read one back first.' };
  if (!isExplicitEstimateConfirmation(state.latestUserText)) {
    return { success: false, code: 'CONFIRMATION_REQUIRED', written: false, error: 'Do not save it. He has not said yes. "yes, send it" does not save it and does not send the estimate.' };
  }
  const missing = requireCompany(owner);
  if (missing) return missing;
  if (String(pending.company_id) !== String(owner.companyId) || String(pending.record.company_id) !== String(owner.companyId)) {
    return { success: false, written: false, error: 'That estimate is not in this company. Nothing was saved.' };
  }
  if (pending.record.status !== 'draft') return lockedResult();
  const record = pending.record;
  const result = await pool.query(
    `INSERT INTO estimates (
       id, company_id, customer_id, lead_id, customer_name, customer_email, customer_phone,
       estimate_number, title, status, total_amount, property_address, items, notes, created_by, data, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$11,$12::jsonb,$13,$14,$15::jsonb,NOW(),NOW()
     )`,
    [
      record.id,
      owner.companyId,
      record.customer_id,
      record.lead_id,
      record.customer_name,
      record.customer_email,
      record.customer_phone,
      record.estimate_number,
      record.title,
      record.total_amount,
      record.property_address,
      JSON.stringify(record.items || []),
      record.notes || '',
      record.created_by || '',
      JSON.stringify(record.data || {}),
    ]
  );
  if (result && result.rowCount === 0) {
    return { success: false, written: false, error: 'The draft was not saved.' };
  }
  state.pendingEstimate = null;
  state.actions.push({ type: 'estimate_draft', summary: `${pending.action} ${record.estimate_number} for ${pending.label}` });
  return {
    success: true,
    written: true,
    sent: false,
    estimate_number: record.estimate_number,
    status: 'draft',
    message: `Saved draft ${record.estimate_number} for ${pending.label}. It was not sent. Kevin can review it in Estimates and send it from the app.`,
  };
}

module.exports = {
  LIST_CAP,
  FOLLOWUP_CAP,
  DEFAULT_DAYS,
  isExplicitEstimateConfirmation,
  listEstimateFollowUps,
  draftEstimateFollowUp,
  prepareEstimateFollowUps,
  prepareEstimateDraft,
  prepareEstimateDuplicate,
  confirmEstimateDraft,
};
