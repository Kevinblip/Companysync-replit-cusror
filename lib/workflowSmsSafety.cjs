const crypto = require('crypto');

function normalizeWorkflowSmsDestination(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const digits = raw.replace(/\D/g, '');
  let normalized = '';
  if (raw.startsWith('+')) normalized = `+${digits}`;
  else if (digits.length === 10) normalized = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith('1')) normalized = `+${digits}`;
  else return '';

  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) return '';
  if (/^(\d)\1+$/.test(normalized.slice(1))) return '';

  // North American numbers require valid NXX area and exchange codes.
  if (normalized.startsWith('+1') && !/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(normalized)) {
    return '';
  }
  return normalized;
}

function workflowSmsDedupeId({ companyId, to, message }) {
  const digest = crypto.createHash('sha256')
    .update(`${companyId || ''}\n${to || ''}\n${message || ''}`)
    .digest('hex')
    .slice(0, 40);
  return `workflow_sms_${digest}`;
}

module.exports = { normalizeWorkflowSmsDestination, workflowSmsDedupeId };