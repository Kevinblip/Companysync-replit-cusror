'use strict';

const crypto = require('crypto');

const TOKEN_WINDOW_MS = 15 * 60 * 1000;
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SCHEDULING_FIELDS = new Set([
  'build_date',
  'customer_id',
  'customer_name',
  'job_type',
  'job_types',
]);

function normalizeJobTypes(value) {
  const values = Array.isArray(value) ? value : (value ? [value] : []);
  return values.map((item) => String(item).trim().toLowerCase()).filter(Boolean).sort();
}

function confirmationPayload(details, bucket) {
  const d = details || {};
  return JSON.stringify({
    company: String(d.companyId || ''),
    user: String(d.userEmail || '').trim().toLowerCase(),
    action: String(d.action || 'update').trim().toLowerCase(),
    record: String(d.recordId || ''),
    customer_id: String(d.customerId || ''),
    customer_name: String(d.customerName || '').trim().toLowerCase().replace(/\s+/g, ' '),
    build_date: String(d.buildDate || ''),
    job_types: normalizeJobTypes(d.jobTypes),
    bucket,
  });
}

function sign(details, bucket) {
  return crypto.createHmac('sha256', SECRET)
    .update(confirmationPayload(details, bucket))
    .digest('hex')
    .slice(0, 40);
}

function verify(details, token) {
  if (typeof token !== 'string' || token.length !== 40) return false;
  const nowBucket = Math.floor(Date.now() / TOKEN_WINDOW_MS);
  return [nowBucket, nowBucket - 1].some((bucket) => {
    const expected = Buffer.from(sign(details, bucket));
    const supplied = Buffer.from(token);
    return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
  });
}

function buildScheduleConfirmationGuard(details, confirmationToken) {
  if (verify(details, confirmationToken)) return null;
  const token = sign(details, Math.floor(Date.now() / TOKEN_WINDOW_MS));
  const action = String(details?.action || 'update').toLowerCase() === 'create' ? 'schedule' : 'change';
  const jobs = normalizeJobTypes(details?.jobTypes);
  const jobText = jobs.length ? ` (${jobs.join(', ')})` : '';
  return {
    success: false,
    code: 'BUILD_CONFIRMATION_REQUIRED',
    requires_confirmation: true,
    confirmation_token: token,
    customer_id: details?.customerId || null,
    customer_name: details?.customerName || null,
    build_date: details?.buildDate || null,
    job_types: jobs,
    message: `Just to confirm: ${action} the build for ${details?.customerName || 'this customer'} to ${details?.buildDate || 'the requested date'}${jobText}? Ask for a clear yes or no. Do not make any change until the user says yes. If they say no or correct any detail, discard this token and confirm the corrected customer and date again.`,
  };
}

function isBuildSchedulingMutation(data) {
  return Object.keys(data || {}).some((key) => SCHEDULING_FIELDS.has(key));
}

function isExplicitConfirmationMessage(message) {
  return /^(yes|yeah|yep|yup|sure|okay|ok|go ahead|do it|confirm|confirmed)(\b|[\s,.!])/i.test(String(message || '').trim());
}

module.exports = {
  buildScheduleConfirmationGuard,
  isBuildSchedulingMutation,
  isExplicitConfirmationMessage,
};