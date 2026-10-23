'use strict';

/**
 * Privacy mask for platform-admin "sign in as company" sessions.
 *
 * When a request context is impersonating and has not been explicitly
 * revealed, personal details and dollar amounts are rewritten before the
 * JSON leaves the server. When the caller is not impersonating, every
 * helper returns the original value without copying it.
 *
 * The impersonated company's own name is kept so support can tell which
 * account they are in. Counts (lead totals, quantities) are kept.
 */

const MASKED_MONEY = '$***';
const MASKED_HIDDEN = '[hidden]';

const MONEY_KEYS = new Set([
  'amount', 'price', 'cost', 'fee', 'fees', 'subtotal', 'taxamount', 'balance',
  'balancedue', 'amountdue', 'amountpaid', 'totalamount', 'totalpaid', 'totaldue',
  'totalvalue', 'totalcost', 'totalprice', 'outstandingamount', 'revenue',
  'totalrevenue', 'pipelinevalue', 'saleamount', 'paymentamount', 'paidamount',
  'commission', 'commissionamount', 'grosscommission', 'netcommission',
  'unitprice', 'extendedprice', 'linetotal', 'rcv', 'acv', 'deductible',
  'depreciation', 'overhead', 'profit', 'discount', 'refund', 'creditamount',
  'invoicetotal', 'estimatetotal', 'grandtotal', 'netamount', 'grossamount',
  'cashreceived', 'invoicesissued', 'collected', 'payout', 'premium',
  'labortotal', 'materialtotal', 'tax', 'margin', 'balanceowed',
  'remainingbalance', 'paid', 'payment', 'feeamount', 'totalrevenue',
  'approvedvalue', 'outstanding', 'pendingcommission',
]);

const NAME_KEYS = new Set([
  'name', 'fullname', 'firstname', 'lastname', 'customername', 'contactname',
  'clientname', 'leadname', 'homeownername', 'adjustername', 'repname',
  'staffname', 'username', 'displayname', 'ownername', 'salespersonname',
  'technicianname', 'callername', 'fromname', 'toname', 'uploadedbyname',
  'createdbyname', 'assignedtoname', 'sendername', 'recipientname',
  'homeowner', 'preferredname', 'nickname', 'viewasusername',
]);

const FREE_TEXT_KEYS = new Set([
  'note', 'notes', 'internalnotes', 'privatenotes', 'customernotes', 'callnotes',
  'jobnotes', 'body', 'message', 'messagebody', 'smsbody', 'textbody',
  'contentbody', 'emailbody', 'htmlbody', 'html', 'transcript', 'transcription',
  'calltranscript', 'comments', 'comment', 'voicemailtext', 'sms', 'textmessage',
  'chatmessage', 'messagetext', 'callsummary',
]);

const RECORDING_KEYS = new Set([
  'recordingurl', 'recordinglink', 'audiourl', 'voicemailurl', 'callrecordingurl',
  'recording', 'recordingid', 'voicemail', 'audiolink',
]);

const SECRET_LINK_KEYS = new Set([
  'portaltoken', 'sharetoken', 'signingtoken', 'signingurl', 'publictoken',
  'estimatetoken', 'pdfbase64', 'pdfurl', 'csvbase64', 'base64',
]);

const ZIP_KEYS = new Set(['zip', 'zipcode', 'postalcode', 'postal']);

const PERSON_REF_KEYS = new Set([
  'assignedto', 'assignedtousers', 'saleagent', 'salesperson',
  'createdby', 'updatedby', 'uploadedby',
]);

const BLOCKED_PATHS = [
  '/api/integrations/invoke-llm',
  '/api/live-call-events',
  '/api/public-estimate-pdf',
  '/api/proxy-pdf',
  '/api/extract-estimate',
];

const SKIP_MASK_PREFIXES = [
  '/api/auth/',
  '/api/impersonation/',
  '/api/login',
  '/api/logout',
  '/api/signup',
  '/api/callback',
  '/api/confirm-email',
  '/api/forgot-password',
  '/api/reset-password',
  '/api/change-password',
];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?1[\s.-])?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}/g;
const STREET_RE = /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Way|Place|Pl|Circle|Cir|Terrace|Ter|Highway|Hwy)\b\.?/gi;
const MONEY_RE = /\$\s?-?[\d,]+(?:\.\d{1,2})?/g;
const RECORDING_URL_RE = /https?:\/\/\S*(?:recording|voicemail|Recordings)\S*/gi;

function norm(key) {
  return String(key || '').replace(/[_-]/g, '').toLowerCase();
}

function shouldMask(ctx) {
  return !!(ctx && ctx.isImpersonating && !ctx.privacyRevealed);
}

function maskIfImpersonating(ctx, data) {
  if (!shouldMask(ctx)) return data;
  return maskPayload(data);
}

function maskPayload(data) {
  return maskNode(data);
}

function isBlockedDuringImpersonation(functionName) {
  const name = String(functionName || '');
  if (!name) return false;
  if (/(pdf|csv|xlsx|export|download|transcript|recording|analyze)/i.test(name)) return true;
  if (/(lexi|sarah|alex)/i.test(name)) return true;
  return false;
}

function isBlockedImpersonationPath(pathname) {
  const path = String(pathname || '');
  if (BLOCKED_PATHS.some((prefix) => path === prefix || path.startsWith(prefix))) return true;
  return /\/(pdf|csv|export|transcript|recording)(\/|$|\?)/i.test(path);
}

function shouldMaskPath(pathname) {
  const path = String(pathname || '');
  if (!path.startsWith('/api/')) return false;
  if (SKIP_MASK_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix))) return false;
  return true;
}

function privacyBlockBody() {
  return {
    error: 'This is unavailable while impersonating. Personal info and amounts stay hidden.',
  };
}

function validateRevealReason(reason) {
  const trimmed = String(reason || '').trim();
  if (trimmed.length < 8) {
    return { ok: false, error: 'A reason of at least 8 characters is required to reveal personal info.' };
  }
  return { ok: true, reason: trimmed };
}

async function recordPrivacyReveal({ pool, ctx, reason }) {
  if (!ctx?.authenticated || !ctx.isSuperAdmin) {
    return { status: 403, body: { error: 'Super-admin access required' } };
  }
  if (!ctx.isImpersonating || !ctx.impersonatedCompanyId) {
    return { status: 400, body: { error: 'No active impersonation session' } };
  }
  const check = validateRevealReason(reason);
  if (!check.ok) return { status: 400, body: { error: check.error } };

  let companyName = null;
  if (ctx._impersonationLogId) {
    const existing = await pool.query(
      'SELECT target_company_name FROM impersonation_logs WHERE id = $1',
      [ctx._impersonationLogId]
    );
    companyName = existing.rows[0]?.target_company_name || null;
  }
  const { randomUUID } = require('crypto');
  const id = randomUUID();
  await pool.query(
    `INSERT INTO impersonation_logs
      (id, admin_email, target_company_id, target_company_name, reason, is_active, expires_at, action_type)
     VALUES ($1, $2, $3, $4, $5, false, NOW(), 'privacy_reveal')`,
    [id, ctx.email, ctx.impersonatedCompanyId, companyName, check.reason]
  );
  if (ctx._sid) {
    await pool.query(
      `UPDATE sessions SET sess = sess || $1::jsonb WHERE sid = $2`,
      [JSON.stringify({ impersonation_privacy_revealed: true }), ctx._sid]
    );
  }
  return { status: 200, body: { success: true, privacy_revealed: true, log_id: id } };
}

function maskPersonRef(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return value;
    return text.includes('@') ? maskEmail(text) : maskPersonName(text);
  }
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? maskPersonRef(item) : maskNode(item)));
  }
  return value;
}

function maskPersonName(value) {
  const text = String(value ?? '').trim();
  if (!text) return text;
  if (text.includes('@')) return maskEmail(text);
  if (text.includes('***')) return text;
  return text.split(/\s+/).map((token) => {
    const ch = token[0];
    return ch ? `${ch.toUpperCase()}***` : '***';
  }).join(' ');
}

function maskEmail(value) {
  const text = String(value ?? '').trim();
  if (!text) return text;
  if (text.includes('***@') || text.includes('***')) {
    const at = text.indexOf('@');
    if (at > 0) return text;
  }
  const at = text.indexOf('@');
  if (at <= 0) return maskPersonName(text);
  const local = text.slice(0, at);
  const domain = text.slice(at + 1);
  const first = (local[0] || '*').toLowerCase();
  return `${first}***@${domain}`;
}

function maskPhone(value) {
  const text = String(value ?? '').trim();
  if (!text) return text;
  if (text.includes('***')) return text;
  let digits = text.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length >= 10) {
    return `(${digits.slice(0, 3)}) ***-**${digits.slice(-2)}`;
  }
  if (digits.length >= 4) return `***-**${digits.slice(-2)}`;
  return '***';
}

function maskStreet(value) {
  const text = String(value ?? '').trim();
  if (!text) return text;
  if (text.includes('***')) return text;
  let next = text.replace(/^\d{1,6}\s+/, '*** ');
  if (next === text) next = `*** ${text}`;
  next = next.replace(/\b\d{5}(?:-\d{4})?\b/g, '***');
  return next;
}

function redactInline(text) {
  if (typeof text !== 'string' || !text) return text;
  if (text === MASKED_MONEY || text === MASKED_HIDDEN || text.includes('***')) return text;
  let next = text;
  next = next.replace(RECORDING_URL_RE, MASKED_HIDDEN);
  next = next.replace(MONEY_RE, MASKED_MONEY);
  next = next.replace(EMAIL_RE, (match) => maskEmail(match));
  next = next.replace(PHONE_RE, (match) => maskPhone(match));
  next = next.replace(STREET_RE, (match) => maskStreet(match));
  return next;
}

function isTenantCompany(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const keys = new Set(Object.keys(obj).map(norm));
  return keys.has('subscriptionplan') || keys.has('subscriptionstatus') || keys.has('maxusers') || keys.has('companytagline');
}

function hasPersonSignals(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const keys = new Set(Object.keys(obj).map(norm));
  if (keys.has('firstname') || keys.has('lastname') || keys.has('fullname') || keys.has('useremail')) return true;
  if (keys.has('isadministrator') || keys.has('issuperadmin') || keys.has('cellphone')) return true;
  const hasPhone = [...keys].some((key) => key === 'phone' || key.startsWith('phone') || key.endsWith('phone'));
  const hasEmail = [...keys].some((key) => key === 'email' || key.endsWith('email'));
  return hasPhone && hasEmail;
}

function isCountKey(key) {
  return key === 'count' || key === 'quantity' || key === 'qty'
    || key.endsWith('count') || key.endsWith('qty') || key.endsWith('quantity')
    || key === 'total';
}

function isNumericMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed === MASKED_MONEY) return false;
  return /^-?\$?[\d,]+(\.\d+)?$/.test(trimmed);
}

function siblingNorms(parent) {
  if (!parent || typeof parent !== 'object') return [];
  return Object.keys(parent).map(norm);
}

function isMoneyKey(key, parent, value) {
  if (typeof value === 'boolean' || value == null) return false;
  if (key.endsWith('rate') || key.endsWith('percent') || key.endsWith('percentage')) return false;
  if (key !== 'total' && isCountKey(key)) return false;
  if (MONEY_KEYS.has(key)) return isNumericMoney(value);
  if (key === 'total') {
    if (!isNumericMoney(value)) return false;
    const keys = siblingNorms(parent);
    const moneyContext = keys.some((item) => ['unitprice', 'price', 'quantity', 'qty', 'rate', 'amount', 'month', 'paymentcount'].includes(item));
    const countContext = keys.some((item) => item.endsWith('count') && item !== 'paymentcount');
    return moneyContext && !countContext;
  }
  if (key === 'rate') {
    if (!isNumericMoney(value)) return false;
    const keys = siblingNorms(parent);
    return keys.some((item) => ['quantity', 'qty', 'amount', 'unitprice', 'price'].includes(item));
  }
  if (key === 'value' && isNumericMoney(value)) {
    const keys = siblingNorms(parent);
    return keys.some((item) => MONEY_KEYS.has(item) || item === 'phone' || item === 'email' || item === 'leadscore');
  }
  if (/(amount|price|cost|commission|revenue|subtotal|deductible|balance)/.test(key) && isNumericMoney(value)) {
    return true;
  }
  return false;
}

function isPreservedId(key) {
  if (key === 'id') return true;
  if (!key.endsWith('id')) return false;
  if (RECORDING_KEYS.has(key) || SECRET_LINK_KEYS.has(key)) return false;
  return true;
}

function maskField(key, value, parent) {
  const name = norm(key);
  if (value == null) return value;
  if (isPreservedId(name)) return value;
  if (name === 'companyname' || name === 'name') {
    if (isTenantCompany(parent)) return value;
  }
  if (typeof value === 'string' && (value === MASKED_HIDDEN || value === MASKED_MONEY)) return value;

  if (SECRET_LINK_KEYS.has(name) || RECORDING_KEYS.has(name)) {
    if (value === '' || value == null) return value;
    return MASKED_HIDDEN;
  }
  if (FREE_TEXT_KEYS.has(name) && typeof value === 'string') return MASKED_HIDDEN;
  if (ZIP_KEYS.has(name)) {
    if (typeof value === 'string' && !value.trim()) return value;
    if (value == null || value === '') return value;
    return '***';
  }
  if ((name === 'email' || name.endsWith('email')) && typeof value === 'string') return maskEmail(value);
  if ((name === 'phone' || name.startsWith('phone') || name.endsWith('phone')) && (typeof value === 'string' || typeof value === 'number')) {
    return maskPhone(value);
  }
  if (name.endsWith('address') || name === 'street' || name.endsWith('street') || name === 'address1' || name === 'addressline1' || name === 'addressline2' || name === 'line1') {
    if (typeof value === 'string') return maskStreet(value);
  }
  if (name === 'location' && typeof value === 'string' && STREET_RE.test(value)) {
    STREET_RE.lastIndex = 0;
    return maskStreet(value);
  }
  STREET_RE.lastIndex = 0;

  if (name === 'companyname' && typeof value === 'string' && !isTenantCompany(parent)) return maskPersonName(value);
  if (name === 'company' && typeof value === 'string' && hasPersonSignals(parent) && !isTenantCompany(parent)) {
    return maskPersonName(value);
  }
  if (NAME_KEYS.has(name) || name.endsWith('fullname') || name.endsWith('firstname') || name.endsWith('lastname') || name.endsWith('customername') || name.endsWith('contactname')) {
    if (typeof value === 'string' || typeof value === 'number') {
      if (name === 'name' && !hasPersonSignals(parent)) return redactInline(String(value));
      return maskPersonName(value);
    }
  }
  if (PERSON_REF_KEYS.has(name)) return maskPersonRef(value);
  if ((name === 'subject' || name === 'title') && typeof value === 'string') {
    const keys = siblingNorms(parent);
    if (keys.some((item) => ['eventtype', 'starttime', 'contactname', 'body', 'message', 'direction', 'recordingurl'].includes(item))) {
      return MASKED_HIDDEN;
    }
  }
  if (isMoneyKey(name, parent, value)) return MASKED_MONEY;
  if (Array.isArray(value)) return maskNode(value);
  if (value && typeof value === 'object') return maskNode(value);
  if (typeof value === 'string') return redactInline(value);
  return value;
}

function maskLogRows(ctx, rows) {
  if (!shouldMask(ctx) || !Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== 'object' || !row.view_as_user_email) return row;
    return { ...row, view_as_user_email: maskEmail(row.view_as_user_email) };
  });
}

function maskNode(value) {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const masked = typeof item === 'string' ? redactInline(item) : maskNode(item);
      if (masked !== item) changed = true;
      return masked;
    });
    return changed ? next : value;
  }
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;

  let changed = false;
  const next = {};
  for (const [key, child] of Object.entries(value)) {
    const masked = maskField(key, child, value);
    if (masked !== child) changed = true;
    next[key] = masked;
  }
  return changed ? next : value;
}

function installJsonMask(res) {
  if (!res || res._impersonationPrivacyMask) return;
  res._impersonationPrivacyMask = true;
  const origWriteHead = res.writeHead.bind(res);
  const origEnd = res.end.bind(res);

  const origSetHeader = res.setHeader.bind(res);
  res.setHeader = function setHeader(name, value) {
    if (String(name).toLowerCase() === 'content-length') return res;
    return origSetHeader(name, value);
  };

  res.writeHead = function writeHead(status, a, b) {
    const touch = (headers) => {
      if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return headers;
      const copy = { ...headers };
      delete copy['Content-Length'];
      delete copy['content-length'];
      return copy;
    };
    if (a && typeof a === 'object') return origWriteHead(status, touch(a));
    if (typeof a === 'string' && b && typeof b === 'object') return origWriteHead(status, a, touch(b));
    return origWriteHead(status, a, b);
  };

  res.end = function end(chunk, encoding, cb) {
    if (typeof chunk === 'function') return origEnd(chunk);
    if (typeof encoding === 'function') {
      cb = encoding;
      encoding = undefined;
    }
    try {
      const status = res.statusCode || 200;
      if (status < 400 && chunk != null) {
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : (typeof chunk === 'string' ? chunk : null);
        const type = String(res.getHeader('content-type') || '');
        if (text && (text[0] === '{' || text[0] === '[') && (!type || type.includes('json') || type.includes('text/plain'))) {
          const masked = JSON.stringify(maskPayload(JSON.parse(text)));
          if (typeof res.removeHeader === 'function') {
            try { res.removeHeader('Content-Length'); } catch (_) { /* header already sent */ }
          }
          if (encoding === undefined) return origEnd(masked, cb);
          return origEnd(masked, encoding, cb);
        }
      }
    } catch (_) { /* leave the original body untouched */ }
    if (encoding === undefined) return origEnd(chunk, cb);
    return origEnd(chunk, encoding, cb);
  };
}

module.exports = {
  MASKED_MONEY,
  MASKED_HIDDEN,
  shouldMask,
  maskIfImpersonating,
  maskPayload,
  maskPersonName,
  maskEmail,
  maskPhone,
  maskStreet,
  redactInline,
  isBlockedDuringImpersonation,
  isBlockedImpersonationPath,
  shouldMaskPath,
  privacyBlockBody,
  validateRevealReason,
  recordPrivacyReveal,
  installJsonMask,
  maskLogRows,
};
