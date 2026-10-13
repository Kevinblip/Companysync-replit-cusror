#!/usr/bin/env node
/**
 * Where a document's customer-name link should send you.
 *
 * Built from real production shapes: of 347 estimates on the live company only
 * 148 carry a customer_id. 111 resolve by customer name, 65 only have a lead_id,
 * 3 name a lead, and 20 name nobody at all. Before this logic existed every one
 * of those rows linked to CustomerProfile?name=<name>, and the 88 that were not
 * customers dead-ended on "Customer not found".
 */

const fs = require('fs');
const path = require('path');

// Load the ES module source without a bundler.
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'contactResolution.js'), 'utf8');
const cjs = src.replace(/^export\s+function\s+/gm, 'function ') +
  '\nmodule.exports = { normalizeName, resolveContactTarget, contactTargetQuery, findNameMatches, collectNameCandidates, classifyNameCandidates };\n';
const mod = { exports: {} };
new Function('module', 'exports', 'require', cjs)(mod, mod.exports, require);
const {
  normalizeName, resolveContactTarget, contactTargetQuery, findNameMatches,
  collectNameCandidates, classifyNameCandidates,
} = mod.exports;

/**
 * Mirrors what CustomerProfile does with a `?name=` link: it never resolves the
 * name itself, it runs a loose search over customers and leads, keeps only true
 * matches, and then either opens the single hit, asks, or reports nothing found.
 */
function customerProfileNameOutcome(name, { customers = [], leads = [], leadIdHint = null } = {}) {
  const loose = (rows) => rows.filter(r =>
    (r.name || '').toLowerCase().includes((name || '').trim().toLowerCase()));
  const candidates = collectNameCandidates(name, [
    { kind: 'customer', rows: loose(customers) },
    { kind: 'lead', rows: loose(leads) },
  ]);
  const verdict = classifyNameCandidates(candidates);
  if (verdict.action === 'open') {
    return { action: 'open', url: verdict.target.page + contactTargetQuery(verdict.target) };
  }
  if (verdict.action === 'choose') {
    return { action: 'choose', options: verdict.candidates.map(c => `${c.kind}:${c.id}`) };
  }
  if (leadIdHint) {
    const t = { page: 'LeadProfile', params: { id: leadIdHint } };
    return { action: 'open', url: t.page + contactTargetQuery(t) };
  }
  return { action: 'none' };
}

/** The full journey: click a row, then whatever CustomerProfile does with it. */
function clickThrough(record, data) {
  const target = resolveContactTarget(record);
  if (!target) return { action: 'none' };
  if (target.params.id) {
    return { action: 'open', url: target.page + contactTargetQuery(target) };
  }
  return customerProfileNameOutcome(target.params.name, {
    ...data,
    leadIdHint: target.params.lead_id || null,
  });
}

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${label}\n      expected ${e}\n      actual   ${a}`);
  }
}

// Real records from the live company.
const CUSTOMERS = [
  { id: 'local_1779808115182_frqb5530w', name: 'Fabiano Fernandes' },
  { id: 'local_1774543514476_t97m62zor', name: 'Yolanda Homes' },
  { id: 'local_1787319045741_nzj442e8t', name: 'Jorell Eaddy' },
  { id: 'cust_ty', name: 'Ty Mayfield' },
];

console.log('\nContact resolution — estimates & proposals\n');

// --- 1. customer_id wins ---------------------------------------------------
check('estimate with customer_id goes to that customer',
  resolveContactTarget(
    { customer_name: 'Fabiano Fernandes', customer_id: 'local_1779808115182_frqb5530w' },
    CUSTOMERS),
  { page: 'CustomerProfile', params: { id: 'local_1779808115182_frqb5530w' } });

check('customer_id beats a conflicting name',
  resolveContactTarget(
    { customer_name: 'Yolanda Homes', customer_id: 'local_1779808115182_frqb5530w' },
    CUSTOMERS),
  { page: 'CustomerProfile', params: { id: 'local_1779808115182_frqb5530w' } });

check('customer_id beats lead_id',
  resolveContactTarget(
    { customer_name: 'Someone', customer_id: 'cust_ty', lead_id: 'lead_9' },
    CUSTOMERS),
  { page: 'CustomerProfile', params: { id: 'cust_ty' } });

// --- 2. a name is never resolved to a record by the row itself -------------
// Only CustomerProfile can do that: it is the one place that sees customers
// AND leads together and can tell a unique name from an ambiguous one.
check('EST-2015: no customer_id, so the name is handed on, not resolved',
  resolveContactTarget({ estimate_number: 'EST-2015 (AI)', customer_name: 'Jorell Eaddy' }),
  { page: 'CustomerProfile', params: { name: 'Jorell Eaddy' } });

check('the name is passed through exactly as stored',
  resolveContactTarget({ customer_name: 'Ty MAyfield' }),
  { page: 'CustomerProfile', params: { name: 'Ty MAyfield' } });

check('surrounding whitespace is trimmed off the link',
  resolveContactTarget({ customer_name: '  Yolanda Homes ' }),
  { page: 'CustomerProfile', params: { name: 'Yolanda Homes' } });

// --- 3. leads --------------------------------------------------------------
check('a name plus a lead_id sends both: name first, lead as a hint',
  resolveContactTarget({ customer_name: 'Someone New', lead_id: 'lead_123' }),
  { page: 'CustomerProfile', params: { name: 'Someone New', lead_id: 'lead_123' } });

check('no name at all: go straight to the lead',
  resolveContactTarget({ lead_id: 'lead_123' }),
  { page: 'LeadProfile', params: { id: 'lead_123' } });

check('EST-2016 JJS HOUSES LLC: name only, no pointers',
  resolveContactTarget({ customer_name: 'JJS HOUSES LLC' }),
  { page: 'CustomerProfile', params: { name: 'JJS HOUSES LLC' } });

// --- 4. degenerate input never throws or navigates nowhere -----------------
check('no record at all', resolveContactTarget(null), null);
check('record with no name and no ids', resolveContactTarget({}), null);
check('blank name only', resolveContactTarget({ customer_name: '   ' }), null);
check('blank name but a real lead_id still reaches the lead',
  resolveContactTarget({ customer_name: '  ', lead_id: 'lead_7' }),
  { page: 'LeadProfile', params: { id: 'lead_7' } });
check('an extra customers argument is ignored',
  resolveContactTarget({ customer_name: 'Ty Mayfield' }, CUSTOMERS),
  { page: 'CustomerProfile', params: { name: 'Ty Mayfield' } });

// --- 4b. duplicate names must never be resolved by guessing ----------------
// Real duplicates on the live company: two "Linda Hall", two "Rebecca Heasley",
// "Dorothy  Hawkins" vs "Dorothy Hawkins", "scott bickel" vs "Scott  Bickel".
const DUPES = [
  { id: 'cust_linda_a', name: 'Linda Hall' },
  { id: 'cust_linda_b', name: 'Linda Hall' },
  { id: 'cust_dot_a', name: 'Dorothy  Hawkins' },
  { id: 'cust_dot_b', name: 'Dorothy Hawkins' },
  { id: 'cust_scott_a', name: 'scott bickel' },
  { id: 'cust_scott_b', name: 'Scott  Bickel' },
  { id: 'cust_solo', name: 'Fabiano Fernandes' },
];

check('two customers named Linda Hall: neither is picked',
  findNameMatches('Linda Hall', DUPES).length, 2);

check('duplicates that differ only by whitespace are still duplicates',
  findNameMatches('Dorothy Hawkins', DUPES).map(c => c.id),
  ['cust_dot_a', 'cust_dot_b']);

check('duplicates that differ only by case are still duplicates',
  findNameMatches('Scott Bickel', DUPES).map(c => c.id),
  ['cust_scott_a', 'cust_scott_b']);

check('an explicit customer_id still wins over an ambiguous name',
  resolveContactTarget({ customer_name: 'Linda Hall', customer_id: 'cust_linda_b' }),
  { page: 'CustomerProfile', params: { id: 'cust_linda_b' } });

check('a unique name in the same list is a single match',
  findNameMatches('Fabiano Fernandes', DUPES).map(c => c.id), ['cust_solo']);

check('findNameMatches counts every normalized duplicate',
  findNameMatches('linda   HALL', DUPES).map(c => c.id),
  ['cust_linda_a', 'cust_linda_b']);

check('findNameMatches ignores records with no id',
  findNameMatches('Ghost', [{ name: 'Ghost' }, { id: 'g1', name: 'Ghost' }]).map(c => c.id),
  ['g1']);

check('findNameMatches on a blank name matches nothing',
  findNameMatches('   ', DUPES), []);

// --- 5. query string building ---------------------------------------------
check('id query', contactTargetQuery({ page: 'CustomerProfile', params: { id: 'abc' } }), '?id=abc');
check('name query is encoded',
  contactTargetQuery({ page: 'CustomerProfile', params: { name: 'Robert & Ilka Hall' } }),
  '?name=Robert+%26+Ilka+Hall');
check('empty values are dropped', contactTargetQuery({ page: 'X', params: { id: '' } }), '');
check('null target', contactTargetQuery(null), '');

// --- 5b. what CustomerProfile does with a ?name= link ----------------------
const PROFILE_DATA = {
  customers: [
    { id: 'c_fab', name: 'Fabiano Fernandes' },
    { id: 'c_linda_a', name: 'Linda Hall' },
    { id: 'c_linda_b', name: 'LINDA HALL' },      // case-only duplicate
    { id: 'c_yolanda', name: 'Yolanda Homes' },
    { id: 'c_shared', name: 'Sedgwick' },
  ],
  leads: [
    { id: 'l_jjs', name: 'JJS HOUSES LLC' },
    { id: 'l_shared', name: 'sedgwick' },          // same name as a customer
  ],
};

check('one customer with that name: open it',
  customerProfileNameOutcome('Fabiano Fernandes', PROFILE_DATA),
  { action: 'open', url: 'CustomerProfile?id=c_fab' });

check('case-only duplicate customers: ask, never open one',
  customerProfileNameOutcome('Linda Hall', PROFILE_DATA),
  { action: 'choose', options: ['customer:c_linda_a', 'customer:c_linda_b'] });

check('a customer and a lead share the name: ask',
  customerProfileNameOutcome('Sedgwick', PROFILE_DATA),
  { action: 'choose', options: ['customer:c_shared', 'lead:l_shared'] });

check('only a lead has that name: forward to the lead profile',
  customerProfileNameOutcome('JJS HOUSES LLC', PROFILE_DATA),
  { action: 'open', url: 'LeadProfile?id=l_jjs' });

check('nobody has that name: honest dead end',
  customerProfileNameOutcome('Nobody At All', PROFILE_DATA),
  { action: 'none' });

check('a partial name never opens the longer record',
  customerProfileNameOutcome('Yolanda', PROFILE_DATA),
  { action: 'none' });

check('loose search noise is filtered out, single true match still opens',
  customerProfileNameOutcome('Yolanda Homes', PROFILE_DATA),
  { action: 'open', url: 'CustomerProfile?id=c_yolanda' });

check('collectNameCandidates dedupes the same row returned twice',
  collectNameCandidates('Ann Lee', [
    { kind: 'customer', rows: [{ id: 'x', name: 'Ann Lee' }, { id: 'x', name: 'ann lee' }] },
  ]),
  [{ id: 'x', name: 'Ann Lee', kind: 'customer' }]);

check('same id on a customer and a lead counts as two records',
  collectNameCandidates('Ann Lee', [
    { kind: 'customer', rows: [{ id: 'x', name: 'Ann Lee' }] },
    { kind: 'lead', rows: [{ id: 'x', name: 'Ann Lee' }] },
  ]).length,
  2);

check('classifyNameCandidates on nothing', classifyNameCandidates([]), { action: 'none', candidates: [] });
check('classifyNameCandidates on null', classifyNameCandidates(null), { action: 'none', candidates: [] });
check('classifyNameCandidates drops id-less rows',
  classifyNameCandidates([{ name: 'no id' }, { id: 'a', name: 'A', kind: 'customer' }]).action, 'open');

// --- 5c. end to end: clicking the name on a row ----------------------------
check('E2E name-only row, one customer with that name',
  clickThrough({ customer_name: 'Fabiano Fernandes' }, PROFILE_DATA),
  { action: 'open', url: 'CustomerProfile?id=c_fab' });

check('E2E name-only row where a customer AND a lead share the name: ask',
  clickThrough({ customer_name: 'Sedgwick' }, PROFILE_DATA),
  { action: 'choose', options: ['customer:c_shared', 'lead:l_shared'] });

check('E2E duplicate customers: ask, never open one',
  clickThrough({ customer_name: 'Linda Hall' }, PROFILE_DATA),
  { action: 'choose', options: ['customer:c_linda_a', 'customer:c_linda_b'] });

check('E2E converted lead: dead lead_id ignored because the name is now a customer',
  clickThrough({ customer_name: 'Fabiano Fernandes', lead_id: 'l_deleted' }, PROFILE_DATA),
  { action: 'open', url: 'CustomerProfile?id=c_fab' });

check('E2E live lead: name matches nobody, so the lead pointer is used',
  clickThrough({ customer_name: 'Brand New Prospect', lead_id: 'l_live' }, PROFILE_DATA),
  { action: 'open', url: 'LeadProfile?id=l_live' });

check('E2E ambiguous name plus a lead_id: still ask, never follow the pointer',
  clickThrough({ customer_name: 'Linda Hall', lead_id: 'l_live' }, PROFILE_DATA),
  { action: 'choose', options: ['customer:c_linda_a', 'customer:c_linda_b'] });

check('E2E no name at all, only a lead_id',
  clickThrough({ lead_id: 'l_live' }, PROFILE_DATA),
  { action: 'open', url: 'LeadProfile?id=l_live' });

check('E2E name matching nobody and no lead pointer: honest dead end',
  clickThrough({ customer_name: 'JJS NOBODY LLC' }, PROFILE_DATA),
  { action: 'none' });

check('E2E customer_id always wins, no name search at all',
  clickThrough({ customer_name: 'Linda Hall', customer_id: 'c_linda_b', lead_id: 'l_live' }, PROFILE_DATA),
  { action: 'open', url: 'CustomerProfile?id=c_linda_b' });

// A name is not an id: "?name=<something>" must never open a lead just because
// some unrelated lead's id happens to equal that string.
check('a name that collides with an unrelated lead id opens nothing',
  clickThrough({ customer_name: 'l_jjs' }, PROFILE_DATA),
  { action: 'none' });

check('the name link carries the lead pointer through the URL',
  resolveContactTarget({ customer_name: 'Someone', lead_id: 'l_live' }),
  { page: 'CustomerProfile', params: { name: 'Someone', lead_id: 'l_live' } });

check('and that URL is built correctly',
  contactTargetQuery(resolveContactTarget({ customer_name: 'Robert & Ilka Hall', lead_id: 'l_9' })),
  '?name=Robert+%26+Ilka+Hall&lead_id=l_9');

// --- 6. name normalisation -------------------------------------------------
check('normalizeName trims, lowercases, collapses', normalizeName('  Ty   MAyfield '), 'ty mayfield');
check('normalizeName on null', normalizeName(null), '');
check('two different people are not conflated',
  normalizeName('Angela Patterson') === normalizeName('Angela Patteson'), false);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
