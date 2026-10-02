/**
 * Per-rep Twilio routing decisions for the AI receptionist.
 * Pure functions so on-duty, no-answer, voicemail screening, and SMS
 * fallback can be tested without a database or a live call.
 */

const crypto = require('crypto');

function toE164(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

function phoneLookupVariants(calledNumber) {
  const raw = String(calledNumber || '').trim();
  if (!raw) return [];
  const digits = raw.replace(/\D/g, '');
  const e164 = toE164(raw);
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : (digits.length === 10 ? digits : '');
  return [...new Set([raw, e164, national, digits, digits ? `+${digits}` : ''].filter(Boolean))];
}

function comparableDigits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return [];
  const keys = new Set([digits]);
  if (digits.length === 11 && digits.startsWith('1')) keys.add(digits.slice(1));
  if (digits.length === 10) keys.add(`1${digits}`);
  return [...keys];
}

function phonesMatch(a, b) {
  const left = comparableDigits(a);
  const right = new Set(comparableDigits(b));
  return left.some((d) => right.has(d));
}

function hoursFromStaffData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const enabled = d.after_hours_enabled === true || d.after_hours_enabled === 'true' || d.after_hours_enabled === 1;
  return {
    after_hours_enabled: enabled,
    after_hours_start: d.after_hours_start || '',
    after_hours_end: d.after_hours_end || '',
  };
}

function parseClockMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;
  if (hour === 24 && minute === 0) return 0;
  if (hour > 23) return null;
  return hour * 60 + minute;
}

function minutesInTimeZone(date, timeZone) {
  const when = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(when.getTime())) return null;
  const zone = timeZone || 'America/New_York';
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch (e) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }
  const parts = fmt.formatToParts(when);
  let hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  if (hour === 24) hour = 0;
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function isOnDuty({ availabilityStatus, hours, timeZone, now } = {}) {
  if (String(availabilityStatus || '').toLowerCase() === 'unavailable') return false;
  const schedule = hours || {};
  const enabled = schedule.after_hours_enabled === true || schedule.after_hours_enabled === 'true';
  if (!enabled) return true;
  const start = parseClockMinutes(schedule.after_hours_start);
  const end = parseClockMinutes(schedule.after_hours_end);
  if (start == null || end == null || start === end) return true;
  const current = minutesInTimeZone(now || new Date(), timeZone || 'America/New_York');
  if (current == null) return true;
  if (end > start) return current >= start && current < end;
  return current >= start || current < end;
}

function effectiveRoutingMode(input = {}) {
  const mode = input.routingMode || 'sarah_answers';
  if (!isOnDuty(input)) return 'sarah_answers';
  return mode;
}

function planInboundCall(input = {}) {
  if (!input.companyId) {
    return { action: 'unassigned', mode: 'sarah_answers', screen: false, handoffReason: '', selfCall: false };
  }
  const configured = input.routingMode || 'sarah_answers';
  const mode = effectiveRoutingMode(input);
  let handoffReason = '';
  if (configured !== 'sarah_answers' && mode === 'sarah_answers') {
    handoffReason = String(input.availabilityStatus || '').toLowerCase() === 'unavailable' ? 'unavailable' : 'after_hours';
  }
  const selfCall = !!(input.cellPhone && input.callerPhone && phonesMatch(input.callerPhone, input.cellPhone));
  if (mode === 'forward_to_cell' && input.cellPhone && !selfCall) {
    return { action: 'dial', mode, screen: true, handoffReason: '', selfCall: false };
  }
  return { action: 'ai', mode, screen: false, handoffReason, selfCall };
}

function chooseCompanyRow(rows, companyHint) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return null;
  if (companyHint) {
    const scoped = list.filter((row) => row.company_id === companyHint);
    if (scoped.length) return scoped[0];
  }
  return list[0];
}

function routeFromStaffRow(row) {
  if (!row) return null;
  const hours = hoursFromStaffData(row.staff_data || row.data || {});
  return {
    companyId: row.company_id || '',
    repName: row.full_name || row.rep_name || '',
    repEmail: row.user_email || row.rep_email || '',
    cellPhone: row.cell_phone || '',
    routingMode: row.call_routing_mode || row.routing_mode || 'sarah_answers',
    availabilityStatus: row.availability_status || 'available',
    hours,
    timeZone: row.time_zone || 'America/New_York',
    twilioNumber: row.twilio_number || '',
  };
}

function defaultNameMatch(storedName, searchTerm) {
  const stored = String(storedName || '').toLowerCase();
  const search = String(searchTerm || '').toLowerCase().trim();
  if (!stored || !search) return false;
  if (stored === search || stored.includes(search)) return true;
  return stored.split(/\s+/).includes(search);
}

function resolveTransferTarget({ targetPerson, subscribers, companyId, dialedOwner, nameMatches } = {}) {
  const subs = (subscribers || []).filter((s) => !companyId || s.company_id === companyId);
  const match = typeof nameMatches === 'function' ? nameMatches : defaultNameMatch;
  const person = String(targetPerson || '').trim();
  if (person) {
    const found = subs.find((s) => s.rep_name && match(s.rep_name, person) && s.cell_phone);
    if (!found) return null;
    return {
      cell: toE164(found.cell_phone),
      name: found.rep_name,
      email: found.rep_email || '',
      source: 'name',
    };
  }
  if (dialedOwner && dialedOwner.cell) {
    return {
      cell: toE164(dialedOwner.cell),
      name: dialedOwner.name || '',
      email: dialedOwner.email || '',
      source: 'dialed_number',
    };
  }
  const number = dialedOwner && dialedOwner.twilioNumber;
  if (number) {
    const owner = subs.find((s) => s.cell_phone && phonesMatch(s.phone_number, number));
    if (owner) {
      return {
        cell: toE164(owner.cell_phone),
        name: owner.rep_name || '',
        email: owner.rep_email || '',
        source: 'dialed_number',
      };
    }
  }
  return null;
}

function dialWasAnswered({ dialStatus, dialDuration, dialBridged } = {}) {
  if (dialBridged === false || dialBridged === 'false' || dialBridged === '0') return false;
  const status = String(dialStatus || '').toLowerCase();
  const duration = Number.parseInt(dialDuration, 10);
  return status === 'completed' && Number.isFinite(duration) && duration > 15;
}

function fallbackReason(dialStatus) {
  const status = String(dialStatus || '').toLowerCase();
  if (status === 'busy') return 'busy';
  if (status === 'failed') return 'failed';
  if (status === 'completed') return 'voicemail';
  if (status === 'canceled' || status === 'cancelled') return 'canceled';
  return 'no_answer';
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null) continue;
    search.set(key, String(value));
  }
  return search.toString();
}

function buildForwardDialTwiml({
  host,
  calledNumber,
  cellPhone,
  companyId,
  callerPhone,
  repName,
  repEmail,
  maxDuration,
  callSid,
  recordCallback,
} = {}) {
  const action = `https://${host}/api/twilio/forward-fallback?${queryString({
    companyId: companyId || '',
    callerPhone: callerPhone || '',
    repName: repName || '',
    repEmail: repEmail || '',
    maxDuration: String(maxDuration || 1800),
    calledNumber: calledNumber || '',
    staffCellPhone: cellPhone || '',
    callSid: callSid || '',
  })}`;
  const screen = `https://${host}/api/twilio/screen?${queryString({
    repName: repName || '',
    callerPhone: callerPhone || '',
    companyId: companyId || '',
  })}`;
  const recording = recordCallback
    ? ` record="record-from-answer" recordingStatusCallback="${xmlEscape(recordCallback)}" recordingStatusCallbackMethod="POST"`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial callerId="${xmlEscape(calledNumber || '')}" timeout="20" answerOnBridge="true"${recording} action="${xmlEscape(action)}" method="POST">
        <Number url="${xmlEscape(screen)}">${xmlEscape(cellPhone || '')}</Number>
    </Dial>
</Response>`;
}

function buildScreenTwiml({ host, callerPhone, companyId } = {}) {
  const action = `https://${host}/api/twilio/screen-result?${queryString({ companyId: companyId || '' })}`;
  const who = callerPhone ? ` Caller ${callerPhone}.` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather numDigits="1" timeout="8" action="${xmlEscape(action)}" method="POST">
        <Say voice="alice">CompanySync.${xmlEscape(who)} Press 1 to accept this call. Otherwise hang up and the assistant will take a message.</Say>
    </Gather>
    <Hangup/>
</Response>`;
}

function screenAccepted(digits) {
  return String(digits || '').trim() === '1';
}

function buildScreenResultTwiml(digits) {
  if (screenAccepted(digits)) return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
  return '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
}

function hangupTwiml() {
  return '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
}

function unassignedNumberTwiml() {
  return '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">This phone number is not assigned to a company yet. Please contact the business directly. Goodbye.</Say><Hangup/></Response>';
}

function missedHandoffParameters(input = {}) {
  return {
    companyId: input.companyId || '',
    from: input.callerPhone || '',
    callerPhone: input.callerPhone || '',
    callSid: input.callSid || '',
    calledNumber: input.calledNumber || '',
    staffCellPhone: input.staffCellPhone || '',
    forwardedRepName: input.repName || '',
    forwardedRepEmail: input.repEmail || '',
    forwardedRepPhone: input.staffCellPhone || '',
    callRoutingMode: 'sarah_answers',
    isForwardedCall: 'true',
    maxCallDuration: String(input.maxDuration || 1800),
    handoffReason: input.reason || 'no_answer',
  };
}

function buildAiFallbackTwiml({ host, ...input } = {}) {
  const params = missedHandoffParameters(input);
  const rep = input.repName || '';
  const say = rep
    ? `${rep} is not available right now. I will take a message.`
    : 'The person you are trying to reach is not available right now. I will take a message.';
  const parameters = Object.entries(params)
    .map(([name, value]) => `            <Parameter name="${xmlEscape(name)}" value="${xmlEscape(value)}" />`)
    .join('\n');
  const recording = input.recordCallback
    ? ` record="record-from-answer" recordingStatusCallback="${xmlEscape(input.recordCallback)}" recordingStatusCallbackMethod="POST"`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">${xmlEscape(say)}</Say>
    <Connect${recording}>
        <Stream url="wss://${xmlEscape(host)}/ws/twilio">
${parameters}
        </Stream>
    </Connect>
</Response>`;
}

function buildTransferDialTwiml(input = {}) {
  const action = `https://${input.host}/api/twilio/forward-fallback?${queryString({
    companyId: input.companyId || '',
    callerPhone: input.callerPhone || '',
    repName: input.repName || '',
    repEmail: input.repEmail || '',
    maxDuration: String(input.maxDuration || 1800),
    calledNumber: input.calledNumber || '',
    staffCellPhone: input.cellPhone || '',
    callSid: input.callSid || '',
  })}`;
  const screen = `https://${input.host}/api/twilio/screen?${queryString({
    repName: input.repName || '',
    callerPhone: input.callerPhone || '',
    companyId: input.companyId || '',
  })}`;
  const who = input.repName || 'your representative';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">Let me transfer you to ${xmlEscape(who)} now. One moment please.</Say>
    <Dial callerId="${xmlEscape(input.callerId || '')}" timeout="30" answerOnBridge="true" action="${xmlEscape(action)}" method="POST">
        <Number url="${xmlEscape(screen)}">${xmlEscape(input.cellPhone || '')}</Number>
    </Dial>
</Response>`;
}

function handoffGreeting({ assistantName, companyName, repName, reason } = {}) {
  const rep = repName || 'the representative';
  const assistant = assistantName || 'Sarah';
  const company = companyName || 'the company';
  const why = reason === 'after_hours'
    ? `${rep} is off duty`
    : reason === 'unavailable'
      ? `${rep} is marked unavailable`
      : reason === 'busy'
        ? `${rep} was busy`
        : reason === 'voicemail'
          ? `${rep}'s voicemail picked up`
          : `${rep} did not answer`;
  return `The caller reached ${rep}'s line and ${why}. Greet them as ${assistant} from ${company}. Tell them ${rep} is not available and take a message. Collect their name, callback number, and what they need. Save the lead assigned to ${rep}. Then call notify_rep with the caller's name, number, and message. Do not transfer the call.`;
}

function buildRepSmsBody({ callerName, callerPhone, message, companyName } = {}) {
  const who = callerName && !/^voice caller$/i.test(String(callerName).trim()) ? String(callerName).trim() : 'A caller';
  const num = callerPhone || 'unknown number';
  const msg = String(message || '').replace(/\s+/g, ' ').trim() || 'No message was left.';
  const prefix = companyName ? `${companyName}: ` : '';
  let body = `${prefix}${who} (${num}): ${msg}`;
  if (body.length > 320) body = `${body.slice(0, 317)}...`;
  return body;
}

function callerMessageFromTranscript(transcript) {
  const lines = String(transcript || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const spoken = lines
    .filter((line) => /^caller\s*:/i.test(line))
    .map((line) => line.replace(/^caller\s*:\s*/i, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (spoken || String(transcript || '').replace(/\s+/g, ' ').trim()).slice(0, 240);
}

function isPhilippinesNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.startsWith('63') && digits.length >= 11;
}

function isUsLongCode(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1');
}

function planSmsDelivery({ to, from } = {}) {
  if (isPhilippinesNumber(to) && isUsLongCode(from)) {
    return {
      skipSms: true,
      code: 21612,
      reason: 'Twilio 21612: a US long code cannot send SMS to a Philippines (+63) number',
    };
  }
  return { skipSms: false, code: null, reason: '' };
}

function twilioErrorCode(body) {
  if (body && typeof body === 'object') return Number(body.code) || null;
  const text = String(body || '');
  try {
    const parsed = JSON.parse(text);
    return Number(parsed.code) || null;
  } catch (e) {
    const match = text.match(/"code"\s*:\s*(\d+)/);
    return match ? Number(match[1]) : null;
  }
}

function shouldEmailOnSmsFailure(code, httpStatus) {
  if (Number(code) === 21612) return true;
  return Number(httpStatus) >= 400;
}

function twilioSignature(authToken, url, params) {
  const data = Object.keys(params || {}).sort().reduce((acc, key) => acc + key + (params[key] ?? ''), url);
  return crypto.createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

function signaturesEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function twilioSignatureMatches({ tokens, signature, urls, params } = {}) {
  if (!signature || !tokens || !tokens.length || !urls || !urls.length) return false;
  for (const token of tokens) {
    if (!token) continue;
    for (const url of urls) {
      if (signaturesEqual(twilioSignature(token, url, params || {}), signature)) return true;
    }
  }
  return false;
}

function webhookUrlCandidates({ pathAndQuery, hosts } = {}) {
  const path = pathAndQuery && String(pathAndQuery).startsWith('/') ? String(pathAndQuery) : `/${pathAndQuery || ''}`;
  const urls = [];
  const seen = new Set();
  for (const raw of hosts || []) {
    const host = String(raw || '').split(',')[0].trim();
    if (!host) continue;
    for (const proto of ['https', 'http']) {
      const url = `${proto}://${host}${path}`;
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }
  return urls;
}

module.exports = {
  toE164,
  phoneLookupVariants,
  comparableDigits,
  phonesMatch,
  hoursFromStaffData,
  parseClockMinutes,
  minutesInTimeZone,
  isOnDuty,
  effectiveRoutingMode,
  planInboundCall,
  chooseCompanyRow,
  routeFromStaffRow,
  resolveTransferTarget,
  dialWasAnswered,
  fallbackReason,
  xmlEscape,
  buildForwardDialTwiml,
  buildScreenTwiml,
  screenAccepted,
  buildScreenResultTwiml,
  hangupTwiml,
  unassignedNumberTwiml,
  missedHandoffParameters,
  buildAiFallbackTwiml,
  buildTransferDialTwiml,
  handoffGreeting,
  buildRepSmsBody,
  callerMessageFromTranscript,
  isPhilippinesNumber,
  isUsLongCode,
  planSmsDelivery,
  twilioErrorCode,
  shouldEmailOnSmsFailure,
  twilioSignature,
  twilioSignatureMatches,
  webhookUrlCandidates,
};
