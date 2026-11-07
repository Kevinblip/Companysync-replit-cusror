#!/usr/bin/env node
// Lexi lead and job tools. Fixture rows only. No database and no customer send.
'use strict';

const lexi = require('../lib/lexiPhone.cjs');
const leads = require('../lib/lexiLeads.cjs');

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

const LEADS = [
  { id: 'lead_ada', company_id: 'co_lexi', name: 'Ada Lane', phone: '+15555550111', address: '1 Ada St', status: 'new', source: 'Google', value: 1200, notes: '', created_at: '2026-10-21T14:00:00Z', assigned_to: 'kevin@example.com' },
  { id: 'lead_ben', company_id: 'co_lexi', name: 'Ben Ortiz', phone: '+15555550112', status: 'contacted', source: 'referral', created_at: '2026-10-19T16:00:00Z' },
  { id: 'lead_night', company_id: 'co_lexi', name: 'Night Owl', phone: '+15555550113', status: 'new', source: 'Google', created_at: '2026-10-21T02:00:00Z' },
  { id: 'lead_cara', company_id: 'co_lexi', name: 'Cara Nguyen', phone: '+15555550114', status: 'qualified', source: 'website', last_contact_date: '2026-10-20', created_at: '2026-10-02T15:00:00Z' },
  { id: 'lead_drew', company_id: 'co_lexi', name: 'Drew Patel', phone: '+15555550115', status: 'new', source: 'yard sign', created_at: '2026-09-01T15:00:00Z' },
  { id: 'lead_eve', company_id: 'co_lexi', name: 'Eve Cho', phone: '+15555550116', status: 'new', source: 'Google', next_follow_up_date: '2026-10-25', created_at: '2026-09-01T15:00:00Z' },
  { id: 'lead_won', company_id: 'co_lexi', name: 'Won Already', phone: '+15555550117', status: 'won', source: 'Google', created_at: '2026-08-01T15:00:00Z' },
  { id: 'lead_other', company_id: 'co_other', name: 'Ada Lane', phone: '+15555550111', status: 'new', source: 'Google', created_at: '2026-10-21T14:00:00Z' },
];

const PROJECTS = [
  { id: 'job_smith', company_id: 'co_lexi', customer_name: 'Smith Roofing', title: 'Roof', status: 'in_progress', assigned_to: 'Luis', address: '10 Main St', start_date: '2026-10-21', end_date: '2026-10-28', notes: 'Ladder on site' },
  { id: 'job_kim', company_id: 'co_lexi', customer_name: 'Kim Patio', title: 'Patio', status: 'not_started', assigned_to: 'Kim', address: '4 Pine', start_date: '2026-10-23' },
  { id: 'job_other', company_id: 'co_other', customer_name: 'Smith Roofing', title: 'Other roof', status: 'completed', assigned_to: 'Luis', address: '10 Main St', start_date: '2026-10-21' },
];

const BUILDS = [
  { id: 'build_cho', company_id: 'co_lexi', entity_type: 'BuildSchedule', data: { customer_name: 'Cho Siding', address: '8 Oak', build_date: '2026-10-22', status: 'scheduled', crew: ['Ana'], job_type: 'Siding', notes: '' } },
];

const EVENTS = [
  { id: 'cal_luis', company_id: 'co_lexi', title: 'Smith roof', event_type: 'build', start_time: '2026-10-21T15:00:00Z', location: '10 Main St', status: 'scheduled', assigned_to: 'Luis' },
  { id: 'cal_ana', company_id: 'co_lexi', title: 'Cho siding', event_type: 'build', start_time: '2026-10-22T15:00:00Z', location: '8 Oak', status: 'scheduled', assigned_to: 'Ana' },
  { id: 'cal_cancel', company_id: 'co_lexi', title: 'Cancelled', start_time: '2026-10-21T16:00:00Z', status: 'cancelled', assigned_to: 'Luis' },
  { id: 'cal_other', company_id: 'co_other', title: 'Other job', start_time: '2026-10-21T15:00:00Z', status: 'scheduled', assigned_to: 'Luis' },
];

const ORDERS = [
  { id: 'wo_1', company_id: 'co_lexi', project_id: 'job_smith', subcontractor_id: 'sub_rio', title: 'Tear off', status: 'accepted' },
];

const SUBS = [
  { id: 'sub_rio', company_id: 'co_lexi', entity_type: 'Subcontractor', data: { name: 'Rio Gutters' } },
];

function leadPool(extraLeads = []) {
  const leads = LEADS.concat(extraLeads).map((row) => ({ ...row }));
  const projects = PROJECTS.map((row) => ({ ...row }));
  const builds = BUILDS.map((row) => ({ ...row, data: { ...row.data } }));
  const calls = [];
  const pool = {
    calls,
    leads,
    projects,
    builds,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const companyId = params && params[0];
      if (/FROM leads/i.test(sql)) return { rows: leads.filter((row) => row.company_id === companyId) };
      if (/FROM communications/i.test(sql)) return { rows: [] };
      if (/FROM projects/i.test(sql)) return { rows: projects.filter((row) => row.company_id === companyId) };
      if (/entity_type = 'BuildSchedule'/i.test(sql)) return { rows: builds.filter((row) => row.company_id === companyId) };
      if (/FROM calendar_events/i.test(sql)) {
        return { rows: EVENTS.filter((row) => row.company_id === companyId && row.status !== 'cancelled' && row.start_time >= params[1] && row.start_time <= params[2]) };
      }
      if (/FROM work_orders/i.test(sql)) return { rows: ORDERS.filter((row) => row.company_id === companyId) };
      if (/entity_type = 'Subcontractor'/i.test(sql)) return { rows: SUBS.filter((row) => row.company_id === companyId) };
      if (/UPDATE leads SET notes/i.test(sql)) {
        const lead = leads.find((row) => row.id === params[0] && row.company_id === params[1]);
        if (!lead) return { rowCount: 0, rows: [] };
        lead.notes = params[2];
        return { rowCount: 1, rows: [] };
      }
      if (/UPDATE leads SET status/i.test(sql)) {
        const lead = leads.find((row) => row.id === params[0] && row.company_id === params[1]);
        if (!lead) return { rowCount: 0, rows: [] };
        lead.status = params[2];
        return { rowCount: 1, rows: [] };
      }
      if (/UPDATE projects SET notes/i.test(sql)) {
        const job = projects.find((row) => row.id === params[0] && row.company_id === params[1]);
        if (!job) return { rowCount: 0, rows: [] };
        job.notes = params[2];
        return { rowCount: 1, rows: [] };
      }
      if (/UPDATE generic_entities/i.test(sql)) {
        const build = builds.find((row) => row.id === params[0] && row.company_id === params[1]);
        if (!build) return { rowCount: 0, rows: [] };
        build.data.notes = params[2];
        return { rowCount: 1, rows: [] };
      }
      if (/INSERT|DELETE/i.test(sql)) throw new Error(`unexpected write: ${sql}`);
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
    { state, config: config(), pool: extra.pool || leadPool(), owner: OWNER }
  );
}

async function main() {
  console.log('\nLeads');
  const pool = leadPool();
  const summary = await leads.summarizeLeads(pool, OWNER, { period: 'this week' }, NOW);
  check('this week counts only this company', summary.count === 3, String(summary.count));
  check('sources are grouped', summary.by_source.find((row) => row.name === 'Google').count === 2 && summary.by_source.find((row) => row.name === 'referral').count === 1, JSON.stringify(summary.by_source));
  check('statuses are grouped', summary.by_status.find((row) => row.name === 'new').count === 2);
  const today = await leads.summarizeLeads(pool, OWNER, { period: 'today' }, NOW);
  check('today uses New York and skips late evening UTC', today.count === 1 && today.rows[0].name === 'Ada Lane', JSON.stringify(today));
  const custom = await leads.summarizeLeads(pool, OWNER, { start_date: '2026-10-01', end_date: '2026-10-10' }, NOW);
  check('custom dates find Cara', custom.count === 1 && custom.rows[0].name === 'Cara Nguyen');
  const stale = await leads.summarizeLeads(pool, OWNER, { days_without_follow_up: 5 }, NOW);
  check('quiet leads skip recent contact, a scheduled follow-up, won, and other tenants', stale.stale_count === 1 && stale.stale_rows[0].name === 'Drew Patel', JSON.stringify(stale.stale_rows));
  const found = await leads.lookupLead(pool, OWNER, { phone: '555-555-0111' }, NOW);
  check('phone lookup stays in the company', found.matches.length === 1 && found.matches[0].name === 'Ada Lane' && found.matches[0].status === 'new');
  check('a lead answer is short', /Ada Lane is new/.test(found.spoken));

  const many = leadPool(Array.from({ length: 12 }, (_, i) => ({
    id: `lead_extra_${i}`, company_id: 'co_lexi', name: `Extra ${i}`, status: 'new', source: 'ad', created_at: '2026-10-21T18:00:00Z',
  })));
  const capped = await leads.summarizeLeads(many, OWNER, { period: 'today' }, NOW);
  check('text rows stop at 10 while the count stays full', capped.rows.length === 10 && capped.count === 13, `${capped.rows.length} ${capped.count}`);

  console.log('\nJobs and crew');
  const job = await leads.lookupJob(pool, OWNER, { customer: 'Smith' });
  check('job lookup has stage, crew, and dates', job.matches.length === 1 && job.matches[0].stage === 'in_progress' && /Luis/.test(job.matches[0].crew) && /Rio Gutters/.test(job.matches[0].crew) && job.matches[0].start === '2026-10-21', JSON.stringify(job.matches && job.matches[0]));
  const byAddress = await leads.lookupJob(pool, OWNER, { address: '8 Oak' });
  check('address lookup finds the build', byAddress.matches.length === 1 && byAddress.matches[0].customer_name === 'Cho Siding' && byAddress.matches[0].crew === 'Ana');
  const todayCrew = await leads.crewSchedule(pool, OWNER, { period: 'today', crew: 'Luis' }, NOW);
  check('today for one crew skips cancelled and other tenants', todayCrew.count === 2 && todayCrew.rows.every((row) => /Luis/.test(row.crew) || /Smith/.test(row.title + row.customer_name)), JSON.stringify(todayCrew));
  const week = await leads.crewSchedule(pool, OWNER, { period: 'this week' }, NOW);
  check('this week includes a later scheduled job', week.count >= 4 && week.rows.some((row) => /Kim|Patio/.test(`${row.title} ${row.customer_name || ''} ${row.crew}`)), JSON.stringify(week.rows));
  const tomorrow = await leads.crewSchedule(pool, OWNER, { period: 'tomorrow', crew: 'Ana' }, NOW);
  check('tomorrow is the next New York day', tomorrow.count === 2, JSON.stringify(tomorrow));

  console.log('\nConfirmed writes');
  const noteState = unlocked();
  const drafted = await tool('prepare_record_note', { target: 'lead', name: 'Ada Lane', note: 'Left a voicemail' }, noteState, { pool });
  check('a lead note is read back and not saved', drafted.written === false && /Left a voicemail/.test(drafted.read_back) && pool.leads.find((row) => row.id === 'lead_ada').notes === '');
  noteState.latestUserText = 'yes, send it';
  const notSend = await tool('confirm_record_change', {}, noteState, { pool });
  check('yes, send it does not save the note', notSend.code === 'CONFIRMATION_REQUIRED' && pool.leads.find((row) => row.id === 'lead_ada').notes === '');
  noteState.latestUserText = 'yes';
  const saved = await tool('confirm_record_change', {}, noteState, { pool });
  const ada = pool.leads.find((row) => row.id === 'lead_ada');
  check('yes saves the note on this company only', saved.written === true && /Left a voicemail/.test(ada.notes) && pool.leads.find((row) => row.id === 'lead_other').notes === undefined);
  check('the note does not reassign anyone', ada.assigned_to === 'kevin@example.com');

  const jobState = unlocked();
  const jobNote = await tool('prepare_record_note', { target: 'job', customer: 'Smith Roofing', note: 'Crew is on site' }, jobState, { pool });
  check('a job note names the job', jobNote.written === false && /Smith Roofing/.test(jobNote.read_back));
  jobState.latestUserText = 'yes';
  await tool('confirm_record_change', {}, jobState, { pool });
  check('the job note is appended', /Crew is on site/.test(pool.projects.find((row) => row.id === 'job_smith').notes) && /Ladder on site/.test(pool.projects.find((row) => row.id === 'job_smith').notes));

  const statusState = unlocked();
  const status = await tool('prepare_lead_status', { name: 'Ada Lane', status: 'contacted' }, statusState, { pool });
  check('a status change is read back', status.written === false && /from new to contacted/.test(status.read_back));
  statusState.latestUserText = 'please do that';
  const held = await tool('confirm_record_change', {}, statusState, { pool });
  check('a vague yes does not change status', held.code === 'CONFIRMATION_REQUIRED' && pool.leads.find((row) => row.id === 'lead_ada').status === 'new');
  statusState.latestUserText = 'yes';
  const changed = await tool('confirm_record_change', {}, statusState, { pool });
  check('yes changes only the status', changed.written === true && pool.leads.find((row) => row.id === 'lead_ada').status === 'contacted' && pool.leads.find((row) => row.id === 'lead_ada').assigned_to === 'kevin@example.com');
  const bad = await tool('prepare_lead_status', { name: 'Ben Ortiz', status: 'archived' }, unlocked(), { pool });
  check('an unknown status is refused', bad.success === false && pool.leads.find((row) => row.id === 'lead_ben').status === 'contacted');
  const crew = await tool('assign_crew', { job_id: 'job_smith', crew: 'Someone Else' }, unlocked(), { pool });
  check('reassigning a crew is refused', crew.code === 'CREW_REASSIGN_FORBIDDEN' && pool.projects.find((row) => row.id === 'job_smith').assigned_to === 'Luis');
  const removed = await tool('delete_lead', { id: 'lead_ada' }, unlocked(), { pool });
  check('deleting a lead is refused', removed.code === 'DELETE_FORBIDDEN');

  console.log('\nGates');
  const lockedPool = leadPool();
  const denied = await tool('summarize_leads', { period: 'today' }, lexi.sessionFromThread(lexi.emptyThread('+15555550123')), { pool: lockedPool });
  check('lead answers need the PIN', denied.code === 'PIN_REQUIRED' && lockedPool.calls.length === 0);
  const prompt = lexi.buildPhoneSystemPrompt({ basePrompt: '', ownerName: 'Kevin', pinVerified: true, companyResolved: true });
  check('voice lead answers stay short', /speak only the spoken count/.test(prompt) && /summarize_leads/.test(prompt) && /crew_schedule/.test(prompt));
  const textPrompt = lexi.buildPhoneSystemPrompt({ basePrompt: '', ownerName: 'Kevin', pinVerified: true, companyResolved: true, channel: 'team_chat' });
  check('Team Chat does not ask for the PIN again', /Do not ask for a PIN/.test(textPrompt) && /up to 10 rows/.test(textPrompt));
  check('the prompt keeps customer sends on the draft flow', /yes, send it/.test(prompt) && /does not save it/.test(prompt));
  const pending = unlocked();
  pending.pendingRecordChange = { action: 'note', label: 'Ada' };
  const thread = lexi.applySessionToThread(lexi.emptyThread('+15555550123'), pending);
  check('a pending note survives the thread', thread.pending_record_change.label === 'Ada' && lexi.sessionFromThread(thread).pendingRecordChange.action === 'note');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
