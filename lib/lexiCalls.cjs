'use strict';

// Call and voicemail answers for Lexi. Reads the communications already stored
// for the owner's company. Nothing here calls Twilio or changes a phone number.

const { periodBounds } = require('./lexiFinance.cjs');

const LIST_CAP = 10;
const LOOKBACK_LIMIT = 200;
const ALEX_LINES = [
  { digits: '2167777154', number: '+12167777154', label: 'main line' },
  { digits: '2167777081', number: '+12167777081', label: 'company line' },
];
const MISSED_STATUS = new Set(['no-answer', 'no_answer', 'busy', 'failed', 'missed', 'voicemail']);

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

function requireCompany(owner) {
  if (!owner?.companyId) {
    return {
      success: false,
      code: 'COMPANY_UNRESOLVED',
      error: `No company is linked to ${owner?.userEmail || 'this caller'}, so no calls were read. Say that sentence.`,
    };
  }
  return null;
}

async function readRows(pool, label, sql, params) {
  try {
    const { rows } = await pool.query(sql, params);
    return rows || [];
  } catch (err) {
    console.warn(`[LexiCalls] ${label} skipped:`, err.message);
    return [];
  }
}

function ownCompany(rows, companyId) {
  return (rows || []).filter((row) => String(row.company_id || companyId) === String(companyId));
}

function lineOf(data) {
  const raw = data.called_number || data.to_number || data.twilio_phone || data.our_number || data.line || '';
  const digits = last10(raw);
  return ALEX_LINES.find((line) => line.digits === digits) || null;
}

function typeOf(row) {
  return String(row.communication_type || row.type || '').toLowerCase();
}

function isLexiPrivate(row, data) {
  const source = String(data.source || '').toLowerCase();
  return source === 'lexi_phone' || data.lexi_phone === true;
}

function isAlexRecord(row) {
  const data = parseData(row);
  if (isLexiPrivate(row, data)) return false;
  const type = typeOf(row);
  const source = String(data.source || '').toLowerCase();
  const assistant = String(data.assistant_name || '').toLowerCase();
  const callish = type === 'call' || type === 'voicemail' || type === 'voice';
  const message = type === 'sms' || type === 'message';
  const line = lineOf(data);
  const otherLine = last10(data.called_number || data.to_number || data.twilio_phone || data.our_number || data.line || '');
  if (otherLine && !line) return false;
  const alex = assistant === 'alex' || assistant === 'sarah' || source === 'ai_voice' || source === 'recording_webhook' || source === 'missed_call';
  if (line && (callish || message)) return true;
  return alex && callish;
}

function statusOf(row) {
  const data = parseData(row);
  return String(row.status || data.call_status || data.status || '').toLowerCase();
}

function isMissed(row) {
  const data = parseData(row);
  if (typeOf(row) === 'voicemail' || data.voicemail === true) return true;
  return MISSED_STATUS.has(statusOf(row));
}

function synopsisOf(row) {
  const data = parseData(row);
  const synopsis = data.call_synopsis;
  return synopsis && typeof synopsis === 'object' ? synopsis : {};
}

function messageTaken(row) {
  const data = parseData(row);
  const synopsis = synopsisOf(row);
  if (synopsis.next_action) return true;
  if (data.message_for_rep || data.callback_requested) return true;
  return /callback|message|voicemail/.test(String(row.intent || '').toLowerCase());
}

function declined(row) {
  return String(parseData(row).screening_outcome || '').toLowerCase() === 'declined';
}

function handled(row) {
  const data = parseData(row);
  return data.callback_handled === true || data.callback_handled === 'true';
}

function wanted(row) {
  const data = parseData(row);
  const synopsis = synopsisOf(row);
  return String(synopsis.service_needed || row.intent || row.subject || data.call_summary || row.ai_summary || '').trim();
}

function outcome(row) {
  const data = parseData(row);
  const synopsis = synopsisOf(row);
  return String(data.screening_outcome || synopsis.next_action || row.status || '').replace(/_/g, ' ').trim();
}

function snippet(row) {
  const data = parseData(row);
  const synopsis = synopsisOf(row);
  const text = data.call_summary || row.ai_summary || synopsis.summary || data.transcript || data.transcription || row.body || row.message || '';
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 220);
}

function whenIso(row) {
  return row.created_at || row.created_date || parseData(row).created_at || '';
}

function humanReturn(row) {
  if (String(row.direction || '').toLowerCase() !== 'outbound') return false;
  const data = parseData(row);
  if (data.ai_reply === true || data.missed_call_followup === true) return false;
  const source = String(data.source || '').toLowerCase();
  if (source === 'ai_voice' || source === 'lexi_phone') return false;
  const by = String(row.created_by || '').toLowerCase();
  if (by === 'alex' || by === 'sarah' || by === 'lexi') return false;
  return true;
}

async function loadCommunications(pool, companyId) {
  return ownCompany(await readRows(
    pool,
    'communications',
    `SELECT id, company_id, type, communication_type, direction, contact_name, contact_phone,
            subject, body, message, status, ai_summary, intent, is_read, data, created_at, created_by
     FROM communications
     WHERE company_id = $1
     ORDER BY created_at DESC
     LIMIT ${LOOKBACK_LIMIT}`,
    [companyId]
  ), companyId);
}

async function loadMissedNotifications(pool, companyId) {
  const rows = ownCompany(await readRows(
    pool,
    'missed-notifications',
    `SELECT id, company_id, data, created_date
     FROM generic_entities
     WHERE entity_type = 'Notification' AND company_id = $1
       AND COALESCE(data->>'type', '') = 'missed_call'
     ORDER BY created_date DESC
     LIMIT 50`,
    [companyId]
  ), companyId);
  return rows.map((row) => {
    const data = parseData(row);
    return {
      id: row.id,
      company_id: row.company_id,
      kind: 'notification',
      type: 'missed_call',
      communication_type: 'call',
      direction: 'inbound',
      contact_name: data.caller_name || '',
      contact_phone: data.caller_phone || '',
      status: data.call_status || 'missed',
      body: data.message || data.title || '',
      data,
      created_at: row.created_date || data.created_at || '',
    };
  });
}

function viewCall(row) {
  const data = parseData(row);
  const line = lineOf(data);
  return {
    id: row.id,
    kind: row.kind || 'communication',
    name: row.contact_name || 'Unknown caller',
    phone: row.contact_phone || '',
    line: line ? line.label : (isAlexRecord(row) ? 'line not recorded' : ''),
    line_number: line ? line.number : '',
    wanted: wanted(row),
    outcome: outcome(row),
    snippet: snippet(row),
    missed: isMissed(row),
    when: whenIso(row),
    status: statusOf(row) || row.status || '',
  };
}

function inPeriod(row, bounds) {
  const when = new Date(whenIso(row));
  if (Number.isNaN(when.getTime())) return false;
  return when.getTime() >= Date.parse(bounds.start) && when.getTime() <= Date.parse(bounds.end);
}

async function summarizeCalls(pool, owner, args = {}, now = new Date()) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  const bounds = periodBounds(args.period || args.start_date || args.end_date ? args : { period: 'today' }, now);
  if (!bounds) return { success: false, error: 'Use today, yesterday, this week, or a start and end date.' };
  const rows = (await loadCommunications(pool, owner.companyId)).filter((row) => isAlexRecord(row) && inPeriod(row, bounds));
  rows.sort((a, b) => new Date(whenIso(b)) - new Date(whenIso(a)));
  const listed = rows.slice(0, LIST_CAP).map(viewCall);
  const spoken = rows.length
    ? `${rows.length} call${rows.length === 1 ? '' : 's'} ${bounds.label}. ${listed[0].name} wanted ${listed[0].wanted || 'something unstated'}.`
    : `No Alex calls ${bounds.label}.`;
  return {
    success: true,
    period: bounds.label,
    count: rows.length,
    rows: listed,
    spoken,
    message: `On a call, say only this: ${spoken} In a text, you may list up to ${LIST_CAP} callers with what they wanted and the outcome. Do not invent a call.`,
  };
}

function openCallbacks(communications, notifications) {
  const returned = (row) => {
    const phone = last10(row.contact_phone);
    const when = new Date(whenIso(row)).getTime();
    if (!phone || !when) return false;
    return communications.some((other) => humanReturn(other) && last10(other.contact_phone) === phone && new Date(whenIso(other)).getTime() > when);
  };
  const fromComms = communications.filter((row) => {
    if (String(row.direction || 'inbound').toLowerCase() === 'outbound') return false;
    if (!(isMissed(row) || messageTaken(row))) return false;
    if (!isAlexRecord(row) && !isMissed(row)) return false;
    if (declined(row) || handled(row) || returned(row)) return false;
    return true;
  });
  const phones = new Set(fromComms.map((row) => last10(row.contact_phone)).filter(Boolean));
  const fromNotes = notifications.filter((row) => {
    if (handled(row) || declined(row)) return false;
    const phone = last10(row.contact_phone);
    if (phone && phones.has(phone)) return false;
    const line = lineOf(parseData(row));
    return !!line || isMissed(row);
  });
  return fromComms.concat(fromNotes).sort((a, b) => new Date(whenIso(b)) - new Date(whenIso(a)));
}

async function listCallbacks(pool, owner) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  const communications = await loadCommunications(pool, owner.companyId);
  const notifications = await loadMissedNotifications(pool, owner.companyId);
  const open = openCallbacks(communications, notifications);
  const listed = open.slice(0, LIST_CAP).map(viewCall);
  const spoken = open.length
    ? `${open.length} callback${open.length === 1 ? '' : 's'} waiting. Newest is ${listed[0].name}.`
    : 'No callbacks are waiting.';
  return {
    success: true,
    count: open.length,
    rows: listed,
    spoken,
    message: `On a call, say only this: ${spoken} In a text, you may list up to ${LIST_CAP}, newest first.`,
  };
}

function callerMatches(row, args) {
  const phone = last10(args.phone || '');
  const name = String(args.name || args.caller || '').trim().toLowerCase();
  const id = String(args.call_id || args.id || '').trim();
  if (id && String(row.id) !== id) return false;
  if (phone && last10(row.contact_phone) !== phone) return false;
  if (name && !String(row.contact_name || '').toLowerCase().includes(name)) return false;
  return !!(id || phone || name);
}

async function lookupCallerCalls(pool, owner, args = {}) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  if (!String(args.name || args.caller || args.phone || args.call_id || args.id || '').trim()) {
    return { success: false, error: 'Give a caller name or phone number.' };
  }
  const rows = (await loadCommunications(pool, owner.companyId))
    .filter((row) => callerMatches(row, args) && (isAlexRecord(row) || typeOf(row) === 'call' || typeOf(row) === 'voicemail'))
    .sort((a, b) => new Date(whenIso(b)) - new Date(whenIso(a)))
    .slice(0, LIST_CAP)
    .map(viewCall);
  if (!rows.length) return { success: true, matches: [], message: 'No calls for that person. Say that.' };
  const first = rows[0];
  const spoken = `${first.name}'s last call: ${first.wanted || first.snippet || 'no summary stored'}.`;
  return {
    success: true,
    matches: rows,
    spoken,
    message: `On a call, say: ${spoken} In a text you may list up to ${LIST_CAP}, including the stored snippet.`,
  };
}

function isExplicitCallbackConfirmation(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/[“”"]/g, '')
    .replace(/[.!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/send it|book it|move it|cancel it|save it/.test(t)) return false;
  return /^(yes|yeah|yep|yes please|yes,? do it|yes,? add it|yes,? add the note|yes,? mark it|yes,? mark it handled)$/.test(t);
}

async function findCallback(pool, owner, args) {
  const communications = await loadCommunications(pool, owner.companyId);
  const notifications = await loadMissedNotifications(pool, owner.companyId);
  const poolRows = communications.concat(notifications);
  const id = String(args.call_id || args.id || '').trim();
  if (id) {
    const hit = poolRows.find((row) => String(row.id) === id);
    return hit ? [hit] : [];
  }
  return openCallbacks(communications, notifications).filter((row) => callerMatches(row, args));
}

async function prepareCallbackUpdate(pool, owner, args, state, now = new Date()) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  const action = String(args.action || '').toLowerCase();
  if (action !== 'handled' && action !== 'note') {
    return { success: false, error: 'Action must be handled or note.' };
  }
  const note = String(args.note || args.text || '').trim();
  if (action === 'note' && !note) return { success: false, error: 'A note needs text.' };
  const matches = await findCallback(pool, owner, args);
  if (!matches.length) return { success: false, error: 'No matching callback. Nothing was saved.' };
  if (matches.length > 1) {
    return {
      success: false,
      code: 'WHICH_CALL',
      error: `Several callbacks match. Ask which one. ${matches.slice(0, LIST_CAP).map((row) => `${row.contact_name || 'Unknown'} ${row.contact_phone || ''} ${String(whenIso(row)).slice(0, 10)}`).join('; ')}`,
    };
  }
  const row = matches[0];
  const day = periodBounds({ period: 'today' }, now).startYmd;
  const previous = String(parseData(row).callback_note || '').trim();
  const line = note ? `[${day}] ${note}` : '';
  state.pendingCallbackChange = {
    action,
    kind: row.kind || 'communication',
    id: row.id,
    company_id: owner.companyId,
    label: row.contact_name || row.contact_phone || 'that caller',
    note_line: line ? (previous ? `${previous}\n${line}` : line) : previous,
    spoken_note: note,
  };
  const pending = state.pendingCallbackChange;
  const readBack = action === 'handled'
    ? `Mark ${pending.label}'s callback as handled${note ? `. Note: ${note}` : ''}.`
    : `Add this note to ${pending.label}'s callback: ${note}`;
  return {
    success: true,
    written: false,
    read_back: readBack,
    message: `Read this back and wait. Do not say it is saved. He must say yes. ${readBack}`,
  };
}

async function confirmCallbackChange(pool, owner, state) {
  const pending = state.pendingCallbackChange;
  if (!pending) return { success: false, code: 'NOTHING_TO_CHANGE', written: false, error: 'There is no callback change waiting. Read one back first.' };
  if (!isExplicitCallbackConfirmation(state.latestUserText)) {
    return { success: false, code: 'CONFIRMATION_REQUIRED', written: false, error: 'Do not save it. He has not said yes.' };
  }
  const missing = requireCompany(owner);
  if (missing) return missing;
  if (String(pending.company_id) !== String(owner.companyId)) {
    return { success: false, written: false, error: 'That call is not in this company. Nothing was saved.' };
  }
  const patch = {
    callback_updated_at: new Date().toISOString(),
  };
  if (pending.action === 'handled') patch.callback_handled = true;
  if (pending.note_line) patch.callback_note = pending.note_line;
  const sql = pending.kind === 'notification'
    ? `UPDATE generic_entities SET data = COALESCE(data, '{}'::jsonb) || $3::jsonb, updated_date = NOW()
       WHERE id = $1 AND company_id = $2 AND entity_type = 'Notification'`
    : `UPDATE communications SET data = COALESCE(data, '{}'::jsonb) || $3::jsonb, updated_at = NOW()
       WHERE id = $1 AND company_id = $2`;
  const result = await pool.query(sql, [pending.id, owner.companyId, JSON.stringify(patch)]);
  if (result && result.rowCount === 0) {
    return { success: false, written: false, error: 'That call was not in this company. Nothing was saved.' };
  }
  state.pendingCallbackChange = null;
  state.actions.push({ type: 'callback', summary: `${pending.action} ${pending.label}` });
  const message = pending.action === 'handled'
    ? `Marked ${pending.label}'s callback handled. No call was placed.`
    : `Saved the note on ${pending.label}'s callback. No call was placed.`;
  return { success: true, written: true, message };
}

module.exports = {
  LIST_CAP,
  ALEX_LINES,
  isExplicitCallbackConfirmation,
  summarizeCalls,
  listCallbacks,
  lookupCallerCalls,
  prepareCallbackUpdate,
  confirmCallbackChange,
};
