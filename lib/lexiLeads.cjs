'use strict';

// Lead and job answers for Lexi. Reads stay on the owner's company.
// The only writes are a note, or a lead status, and each waits for "yes".

const { periodBounds, fullWeekBounds, formatMoney } = require('./lexiFinance.cjs');

const LIST_CAP = 10;
const CLOSED_LEAD = new Set(['won', 'lost', 'closed']);
const LEAD_STATUS = {
  new: 'new',
  contacted: 'contacted',
  qualified: 'qualified',
  inspected: 'inspected',
  proposal: 'proposal',
  'proposal sent': 'proposal',
  negotiation: 'negotiation',
  won: 'won',
  lost: 'lost',
  closed: 'closed',
};

function last10(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function parseData(row) {
  if (!row) return {};
  if (row.data && typeof row.data === 'object') return row.data;
  if (typeof row.data === 'string') {
    try { return JSON.parse(row.data) || {}; } catch (e) { return {}; }
  }
  return {};
}

function ymd(value) {
  if (!value) return '';
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function daysBetween(earlierYmd, laterYmd) {
  const a = Date.parse(`${earlierYmd}T00:00:00Z`);
  const b = Date.parse(`${laterYmd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

function inWindow(when, bounds) {
  const time = new Date(when);
  if (Number.isNaN(time.getTime())) {
    const day = ymd(when);
    return !!day && day >= bounds.startYmd && day <= bounds.endYmd;
  }
  return time.getTime() >= Date.parse(bounds.start) && time.getTime() <= Date.parse(bounds.end);
}

function nameMatches(candidate, query) {
  const want = String(query || '').trim().toLowerCase();
  if (!want) return false;
  return String(candidate || '').toLowerCase().includes(want);
}

function addressOf(row) {
  if (row.address) return String(row.address);
  return [row.street, row.city, row.state, row.zip].filter(Boolean).join(', ');
}

function requireCompany(owner) {
  if (!owner?.companyId) {
    return {
      success: false,
      code: 'COMPANY_UNRESOLVED',
      error: `No company is linked to ${owner?.userEmail || 'this caller'}, so no leads were read. Say that sentence.`,
    };
  }
  return null;
}

async function readRows(pool, label, sql, params) {
  try {
    const { rows } = await pool.query(sql, params);
    return rows || [];
  } catch (err) {
    console.warn(`[LexiLeads] ${label} skipped:`, err.message);
    return [];
  }
}

function ownCompany(rows, companyId) {
  return (rows || []).filter((row) => String(row.company_id || companyId) === String(companyId));
}

async function loadLeads(pool, companyId) {
  const leads = ownCompany(await readRows(
    pool,
    'leads',
    `SELECT id, company_id, name, email, phone, phone_2, address, street, city, state, zip,
            status, source, lead_source, value, notes, last_contact_date, next_follow_up_date,
            created_at, updated_at
     FROM leads WHERE company_id = $1`,
    [companyId]
  ), companyId);
  const communications = ownCompany(await readRows(
    pool,
    'communications',
    `SELECT lead_id, company_id, created_at FROM communications
     WHERE company_id = $1 AND lead_id IS NOT NULL`,
    [companyId]
  ), companyId);
  return { leads, communications };
}

function sourceOf(lead) {
  return String(lead.source || lead.lead_source || 'unknown').trim() || 'unknown';
}

function statusOf(lead) {
  return String(lead.status || 'new').trim().toLowerCase() || 'new';
}

function lastTouch(lead, commsByLead) {
  const comm = commsByLead.get(String(lead.id));
  const stamps = [lead.last_contact_date, comm].map((value) => new Date(value || 0).getTime());
  const latest = Math.max(...stamps.filter((value) => Number.isFinite(value) && value > 0), 0);
  return latest ? new Date(latest).toISOString() : '';
}

function commsMap(communications) {
  const map = new Map();
  for (const row of communications) {
    const id = String(row.lead_id || '');
    const when = new Date(row.created_at || 0).getTime();
    if (!id || !when) continue;
    const prev = map.get(id);
    if (!prev || when > new Date(prev).getTime()) map.set(id, new Date(when).toISOString());
  }
  return map;
}

function countBy(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function leadRow(lead, commsByLead, todayYmd) {
  const touch = lastTouch(lead, commsByLead);
  const follow = ymd(lead.next_follow_up_date);
  const basis = ymd(touch) || ymd(lead.created_at);
  const quietDays = basis ? Math.max(0, daysBetween(basis, todayYmd)) : 0;
  return {
    id: lead.id,
    name: lead.name || '',
    phone: lead.phone || '',
    address: addressOf(lead),
    status: statusOf(lead),
    source: sourceOf(lead),
    value: formatMoney(lead.value || 0),
    last_contact: ymd(touch),
    next_follow_up: follow,
    quiet_days: quietDays,
    created_at: lead.created_at || '',
  };
}

function spokenCounts(label, rows) {
  return rows.slice(0, 3).map((row) => `${row.count} ${row.name}`).join(', ');
}

async function summarizeLeads(pool, owner, args = {}, now = new Date()) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  const days = Number(args.days_without_follow_up ?? args.days ?? args.quiet_days);
  const wantsStale = Number.isFinite(days) && days > 0;
  const wantsNew = !!(args.period || args.start_date || args.end_date || !wantsStale);
  const bounds = wantsNew
    ? periodBounds(args.period || args.start_date || args.end_date ? args : { period: 'today' }, now)
    : null;
  if (wantsNew && !bounds) return { success: false, error: 'Use today, this week, tomorrow, or a start and end date.' };
  const loaded = await loadLeads(pool, owner.companyId);
  const todayYmd = periodBounds({ period: 'today' }, now).startYmd;
  const byLead = commsMap(loaded.communications);
  const described = loaded.leads.map((lead) => ({ raw: lead, view: leadRow(lead, byLead, todayYmd) }));
  const fresh = wantsNew
    ? described.filter((row) => inWindow(row.raw.created_at, bounds))
    : [];
  const bySource = countBy(fresh, (row) => row.view.source);
  const byStatus = countBy(fresh, (row) => row.view.status);
  const stale = wantsStale
    ? described.filter((row) => {
      if (CLOSED_LEAD.has(row.view.status)) return false;
      if (row.view.next_follow_up && row.view.next_follow_up >= todayYmd) return false;
      return row.view.quiet_days >= days;
    })
    : [];
  const freshRows = fresh
    .sort((a, b) => new Date(b.raw.created_at) - new Date(a.raw.created_at))
    .slice(0, LIST_CAP)
    .map((row) => row.view);
  const staleRows = stale
    .sort((a, b) => b.view.quiet_days - a.view.quiet_days)
    .slice(0, LIST_CAP)
    .map((row) => row.view);
  const parts = [];
  if (wantsNew) parts.push(`${fresh.length} new lead${fresh.length === 1 ? '' : 's'} ${bounds.label}.`);
  if (wantsNew && bySource.length) parts.push(`By source: ${spokenCounts(bounds.label, bySource)}.`);
  if (wantsStale) parts.push(`${stale.length} with no follow-up in ${days} day${days === 1 ? '' : 's'}.`);
  const spoken = parts.join(' ') || 'No leads in that window.';
  return {
    success: true,
    period: bounds?.label || '',
    count: fresh.length,
    by_source: bySource,
    by_status: byStatus,
    stale_count: stale.length,
    rows: freshRows,
    stale_rows: staleRows,
    spoken,
    message: `On a call, say only this: ${spoken} In a text, you may list up to ${LIST_CAP} leads. Do not add leads that are not in rows.`,
  };
}

function matchLeads(leads, args) {
  const phone = last10(args.phone || '');
  const name = String(args.name || args.customer || '').trim();
  const id = String(args.lead_id || args.id || '').trim();
  return leads.filter((lead) => {
    if (id && String(lead.id) !== id) return false;
    if (phone && last10(lead.phone) !== phone && last10(lead.phone_2) !== phone) return false;
    if (name && !nameMatches(lead.name, name)) return false;
    return !!(id || phone || name);
  });
}

async function lookupLead(pool, owner, args = {}, now = new Date()) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  if (!String(args.name || args.customer || args.phone || args.lead_id || args.id || '').trim()) {
    return { success: false, error: 'Give a lead name or phone number.' };
  }
  const loaded = await loadLeads(pool, owner.companyId);
  const todayYmd = periodBounds({ period: 'today' }, now).startYmd;
  const matches = matchLeads(loaded.leads, args)
    .map((lead) => leadRow(lead, commsMap(loaded.communications), todayYmd))
    .slice(0, LIST_CAP);
  if (!matches.length) return { success: true, matches: [], message: 'No matching lead. Say that.' };
  const first = matches[0];
  const spoken = matches.length === 1
    ? `${first.name || 'That lead'} is ${first.status}, from ${first.source}.`
    : `${matches.length} leads. The first is ${first.name}, ${first.status}.`;
  const readBack = matches.map((row) => `${row.name}. ${row.phone || 'no phone'}. ${row.address || 'no address'}. ${row.status}. Source ${row.source}. Last contact ${row.last_contact || 'none'}.`).join(' ');
  return {
    success: true,
    matches,
    spoken,
    read_back: readBack,
    message: `${matches.length > 1 ? 'Several leads. Ask which one. ' : ''}On a call, say: ${spoken} In a text you may read: ${readBack}`,
  };
}

function crewNames(row, data) {
  const members = []
    .concat(row.assigned_to || [])
    .concat(data.crew || [])
    .concat(data.assigned_crew || [])
    .concat(data.crew_name || [])
    .concat(data.team_members || []);
  return [...new Set(members.flat().map((item) => {
    if (item && typeof item === 'object') return item.name || item.email || '';
    return String(item || '');
  }).map((item) => item.trim()).filter(Boolean))];
}

function jobFromProject(project, crewExtra) {
  const data = parseData(project);
  const crew = [...new Set(crewNames(project, data).concat(crewExtra || []))];
  return {
    id: project.id,
    kind: 'project',
    company_id: project.company_id,
    customer_name: project.customer_name || data.customer_name || '',
    title: project.title || data.title || '',
    address: project.address || data.address || '',
    stage: project.status || data.stage || data.status || 'pending',
    crew: crew.join(', '),
    start: ymd(project.start_date || data.start_date),
    end: ymd(project.end_date || data.end_date || data.deadline),
    notes: project.notes || data.notes || '',
  };
}

function jobFromBuild(row) {
  const data = parseData(row);
  const crew = crewNames({ assigned_to: data.assigned_to }, data);
  const types = Array.isArray(data.job_type) ? data.job_type.join(', ') : (data.job_type || '');
  return {
    id: row.id,
    kind: 'build',
    company_id: row.company_id,
    customer_name: data.customer_name || '',
    title: types || data.title || 'Build',
    address: data.address || '',
    stage: data.stage || data.status || 'scheduled',
    crew: crew.join(', '),
    start: ymd(data.build_date),
    end: ymd(data.build_date),
    notes: data.notes || '',
  };
}

async function loadJobs(pool, companyId) {
  const projects = ownCompany(await readRows(
    pool,
    'projects',
    `SELECT id, company_id, customer_id, customer_name, title, status, start_date, end_date,
            assigned_to, address, notes, data
     FROM projects WHERE company_id = $1`,
    [companyId]
  ), companyId);
  const builds = ownCompany(await readRows(
    pool,
    'builds',
    `SELECT id, company_id, data FROM generic_entities
     WHERE entity_type = 'BuildSchedule' AND company_id = $1`,
    [companyId]
  ), companyId);
  const orders = ownCompany(await readRows(
    pool,
    'work_orders',
    `SELECT id, company_id, project_id, subcontractor_id, title, status
     FROM work_orders WHERE company_id = $1`,
    [companyId]
  ), companyId);
  const subs = await readRows(
    pool,
    'subcontractors',
    `SELECT id, company_id, data FROM generic_entities
     WHERE entity_type = 'Subcontractor' AND company_id = $1`,
    [companyId]
  );
  const subName = new Map(subs.map((row) => {
    const data = parseData(row);
    return [String(row.id), data.name || data.company_name || ''];
  }));
  const crewByProject = new Map();
  for (const order of orders) {
    const name = subName.get(String(order.subcontractor_id)) || '';
    if (!name) continue;
    const list = crewByProject.get(String(order.project_id)) || [];
    list.push(name);
    crewByProject.set(String(order.project_id), list);
  }
  return {
    jobs: projects.map((project) => jobFromProject(project, crewByProject.get(String(project.id)) || []))
      .concat(builds.map(jobFromBuild)),
  };
}

function jobMatches(job, args) {
  const id = String(args.job_id || args.project_id || args.id || '').trim();
  const customer = String(args.customer || args.customer_name || args.name || '').trim();
  const address = String(args.address || '').trim();
  if (id && String(job.id) !== id) return false;
  if (customer && !nameMatches(job.customer_name, customer) && !nameMatches(job.title, customer)) return false;
  if (address && !nameMatches(job.address, address)) return false;
  return !!(id || customer || address);
}

function jobSpoken(job) {
  const when = job.start ? ` Scheduled ${job.start}.` : '';
  const crew = job.crew ? ` Crew ${job.crew}.` : '';
  return `${job.customer_name || job.title || 'That job'} is ${String(job.stage || 'unknown').replace(/_/g, ' ')}.${crew}${when}`;
}

async function lookupJob(pool, owner, args = {}) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  if (!String(args.customer || args.customer_name || args.name || args.address || args.job_id || args.project_id || args.id || '').trim()) {
    return { success: false, error: 'Give a customer name or an address.' };
  }
  const loaded = await loadJobs(pool, owner.companyId);
  const matches = loaded.jobs.filter((job) => jobMatches(job, args)).slice(0, LIST_CAP);
  if (!matches.length) return { success: true, matches: [], message: 'No matching job. Say that.' };
  const spoken = matches.length === 1
    ? jobSpoken(matches[0])
    : `${matches.length} jobs. ${jobSpoken(matches[0])}`;
  return {
    success: true,
    matches,
    spoken,
    message: `${matches.length > 1 ? 'Several jobs. Ask which one. ' : ''}On a call, say: ${spoken} In a text you may list up to ${LIST_CAP}.`,
  };
}

function scheduleBounds(args, now) {
  const period = String(args.period || args.day || args.when || 'today').trim().toLowerCase();
  if (period === 'this week' || period === 'week') return fullWeekBounds(now);
  if (period === 'tomorrow') return periodBounds({ period: 'tomorrow' }, now);
  if (args.start_date || args.end_date) return periodBounds(args, now);
  return periodBounds({ period: period === 'today' ? 'today' : period }, now);
}

function scheduledWhen(job, bounds) {
  if (job.kind === 'build') return job.start && job.start >= bounds.startYmd && job.start <= bounds.endYmd;
  if (job.start && job.start >= bounds.startYmd && job.start <= bounds.endYmd) return true;
  return false;
}

async function crewSchedule(pool, owner, args = {}, now = new Date()) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  const bounds = scheduleBounds(args, now);
  if (!bounds) return { success: false, error: 'Use today, tomorrow, or this week.' };
  const crew = String(args.crew || args.crew_member || args.subcontractor || args.name || '').trim();
  const events = ownCompany(await readRows(
    pool,
    'calendar',
    `SELECT id, company_id, title, event_type, start_time, end_time, location, status, assigned_to
     FROM calendar_events
     WHERE company_id = $1
       AND COALESCE(status, '') <> 'cancelled'
       AND start_time >= $2 AND start_time <= $3
     ORDER BY start_time ASC`,
    [owner.companyId, bounds.start, bounds.end]
  ), owner.companyId);
  const jobs = (await loadJobs(pool, owner.companyId)).jobs.filter((job) => scheduledWhen(job, bounds));
  const rows = [];
  for (const event of events) {
    const who = String(event.assigned_to || '');
    if (crew && !nameMatches(`${who} ${event.title || ''} ${event.location || ''}`, crew)) continue;
    rows.push({
      kind: 'calendar',
      title: event.title || 'Scheduled',
      when: event.start_time,
      crew: who,
      address: event.location || '',
      stage: event.event_type || event.status || '',
    });
  }
  for (const job of jobs) {
    if (crew && !nameMatches(`${job.crew} ${job.customer_name} ${job.title} ${job.address}`, crew)) continue;
    rows.push({
      kind: job.kind,
      title: job.title || job.customer_name,
      customer_name: job.customer_name,
      when: job.start,
      crew: job.crew,
      address: job.address,
      stage: job.stage,
    });
  }
  rows.sort((a, b) => String(a.when).localeCompare(String(b.when)));
  const listed = rows.slice(0, LIST_CAP);
  const who = crew ? ` for ${crew}` : '';
  const spoken = `${rows.length} scheduled${who} ${bounds.label}.`;
  return {
    success: true,
    period: bounds.label,
    count: rows.length,
    crew: crew || '',
    rows: listed,
    spoken,
    message: `On a call, say only this: ${spoken} In a text, you may list up to ${LIST_CAP} rows.`,
  };
}

function isExplicitRecordConfirmation(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/[“”"]/g, '')
    .replace(/[.!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/send it|book it|move it|cancel it|save it/.test(t)) return false;
  return /^(yes|yeah|yep|yes please|yes,? do it|yes,? add it|yes,? add the note|yes,? change it|yes,? change the status)$/.test(t);
}

function noteLine(note, now) {
  const day = periodBounds({ period: 'today' }, now).startYmd;
  return `[${day}] ${String(note || '').trim()}`;
}

async function prepareRecordNote(pool, owner, args, state, now = new Date()) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  const note = String(args.note || args.text || '').trim();
  if (!note) return { success: false, error: 'A note needs text.' };
  const target = String(args.target || args.record || '').toLowerCase();
  const wantsJob = target === 'job' || target === 'project' || !!(args.address && !args.phone);
  if (wantsJob && target !== 'lead') {
    const loaded = await loadJobs(pool, owner.companyId);
    const matches = loaded.jobs.filter((job) => jobMatches(job, args));
    if (!matches.length) return { success: false, error: 'No matching job. Nothing was saved.' };
    if (matches.length > 1) {
      return { success: false, code: 'WHICH_JOB', error: `Several jobs match. Ask which one. ${matches.slice(0, LIST_CAP).map((job) => `${job.customer_name} ${job.title} ${job.address}`).join('; ')}` };
    }
    const job = matches[0];
    const line = noteLine(note, now);
    state.pendingRecordChange = {
      action: 'note',
      kind: job.kind,
      id: job.id,
      company_id: owner.companyId,
      label: job.customer_name || job.title || 'that job',
      note_line: job.notes ? `${job.notes}\n${line}` : line,
      spoken_note: note,
    };
  } else {
    const loaded = await loadLeads(pool, owner.companyId);
    const matches = matchLeads(loaded.leads, args);
    if (!matches.length) return { success: false, error: 'No matching lead. Nothing was saved.' };
    if (matches.length > 1) {
      return { success: false, code: 'WHICH_LEAD', error: `Several leads match. Ask which one. ${matches.slice(0, LIST_CAP).map((lead) => lead.name).join('; ')}` };
    }
    const lead = matches[0];
    const line = noteLine(note, now);
    state.pendingRecordChange = {
      action: 'note',
      kind: 'lead',
      id: lead.id,
      company_id: owner.companyId,
      label: lead.name || 'that lead',
      note_line: lead.notes ? `${String(lead.notes).trim()}\n${line}` : line,
      spoken_note: note,
    };
  }
  const pending = state.pendingRecordChange;
  const readBack = `Add this note to ${pending.label}: ${pending.spoken_note}`;
  return {
    success: true,
    written: false,
    read_back: readBack,
    message: `Read this back and wait. Do not say it is saved. He must say yes. ${readBack}`,
  };
}

async function prepareLeadStatus(pool, owner, args, state) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  if (args.assigned_to || args.crew || args.subcontractor) {
    return { success: false, code: 'CREW_REASSIGN_FORBIDDEN', error: 'Crew assignments stay as they are. Nothing was reassigned.' };
  }
  const next = LEAD_STATUS[String(args.status || '').trim().toLowerCase()];
  if (!next) {
    return { success: false, error: `Status must be one of: ${[...new Set(Object.values(LEAD_STATUS))].join(', ')}.` };
  }
  const loaded = await loadLeads(pool, owner.companyId);
  const matches = matchLeads(loaded.leads, args);
  if (!matches.length) return { success: false, error: 'No matching lead. Nothing was changed.' };
  if (matches.length > 1) {
    return { success: false, code: 'WHICH_LEAD', error: `Several leads match. Ask which one. ${matches.slice(0, LIST_CAP).map((lead) => `${lead.name} is ${statusOf(lead)}`).join('; ')}` };
  }
  const lead = matches[0];
  const from = statusOf(lead);
  if (from === next) return { success: false, error: `${lead.name} is already ${next}. Nothing was changed.` };
  state.pendingRecordChange = {
    action: 'status',
    kind: 'lead',
    id: lead.id,
    company_id: owner.companyId,
    label: lead.name || 'that lead',
    from_status: from,
    to_status: next,
  };
  const readBack = `Change ${state.pendingRecordChange.label} from ${from} to ${next}.`;
  return {
    success: true,
    written: false,
    read_back: readBack,
    message: `Read this back and wait. Do not say it is saved. He must say yes. ${readBack}`,
  };
}

async function confirmRecordChange(pool, owner, state) {
  const pending = state.pendingRecordChange;
  if (!pending) return { success: false, code: 'NOTHING_TO_CHANGE', written: false, error: 'There is no note or status change waiting. Read one back first.' };
  if (!isExplicitRecordConfirmation(state.latestUserText)) {
    return { success: false, code: 'CONFIRMATION_REQUIRED', written: false, error: 'Do not save it. He has not said yes.' };
  }
  const missing = requireCompany(owner);
  if (missing) return missing;
  if (String(pending.company_id) !== String(owner.companyId)) {
    return { success: false, code: 'COMPANY_UNRESOLVED', written: false, error: 'That record is not in this company. Nothing was saved.' };
  }
  let result;
  if (pending.action === 'note' && pending.kind === 'lead') {
    result = await pool.query(
      `UPDATE leads SET notes = $3, updated_at = NOW() WHERE id = $1 AND company_id = $2`,
      [pending.id, owner.companyId, pending.note_line]
    );
  } else if (pending.action === 'note' && pending.kind === 'project') {
    result = await pool.query(
      `UPDATE projects SET notes = $3, updated_at = NOW() WHERE id = $1 AND company_id = $2`,
      [pending.id, owner.companyId, pending.note_line]
    );
  } else if (pending.action === 'note' && pending.kind === 'build') {
    result = await pool.query(
      `UPDATE generic_entities
       SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object('notes', $3::text), updated_date = NOW()
       WHERE id = $1 AND company_id = $2 AND entity_type = 'BuildSchedule'`,
      [pending.id, owner.companyId, pending.note_line]
    );
  } else if (pending.action === 'status' && pending.kind === 'lead') {
    result = await pool.query(
      `UPDATE leads SET status = $3, updated_at = NOW() WHERE id = $1 AND company_id = $2`,
      [pending.id, owner.companyId, pending.to_status]
    );
  } else {
    return { success: false, written: false, error: 'That change is not available. Nothing was saved.' };
  }
  if (result && result.rowCount === 0) {
    return { success: false, written: false, error: 'That record was not in this company. Nothing was saved.' };
  }
  state.pendingRecordChange = null;
  state.actions.push({ type: 'record', summary: `${pending.action} ${pending.label}` });
  const message = pending.action === 'status'
    ? `Changed ${pending.label} to ${pending.to_status}. No customer message was sent.`
    : `Saved the note on ${pending.label}. No customer message was sent.`;
  return { success: true, written: true, message };
}

module.exports = {
  LIST_CAP,
  LEAD_STATUS,
  isExplicitRecordConfirmation,
  summarizeLeads,
  lookupLead,
  lookupJob,
  crewSchedule,
  prepareRecordNote,
  prepareLeadStatus,
  confirmRecordChange,
};
