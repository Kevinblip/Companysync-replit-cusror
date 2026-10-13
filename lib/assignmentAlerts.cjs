'use strict';

const { createHash } = require('node:crypto');
const { sendPlatformEmail } = require('./emailTransport.cjs');
const { getNotificationQuietHours } = require('./notificationQuietHours.cjs');
const TABLES = { Task: 'tasks', Lead: 'leads', Customer: 'customers', Project: 'projects' };
const normalize = value => String(value || '').trim().toLowerCase();
const array = value => Array.isArray(value) ? value : [];
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function normalizeDedicatedRow(row) {
  const merged = { ...row };
  for (const [key, value] of Object.entries(row.data || {})) {
    if (merged[key] === undefined || merged[key] === null || merged[key] === '') merged[key] = value;
  }
  if (row.created_at) merged.created_date = row.created_at;
  if (row.updated_at) merged.updated_date = row.updated_at;
  return merged;
}

function activeTask(task) {
  if (!task || task.is_deleted || task.is_archived) return false;
  return ![task.status, task.column].some(value => {
    const key = normalize(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    return /archive|job completed/.test(key) ||
      /^(complete(d)?(\s.*)?|done|closed|cancelled|canceled|dismissed|customer lost)$/.test(key);
  });
}

function assignmentEmails(record, staff) {
  const emails = new Set();
  const candidates = [
    ...array(record.assignees).map(a => typeof a === 'string' ? a : a?.email || a?.name),
    ...array(record.assigned_to_users),
    ...array(record.team_members).map(a => typeof a === 'string' ? a : a?.email || a?.name),
    ...String(record.assigned_to_email || '').split(','),
    ...String(record.assigned_to || '').split(','),
    ...String(record.assigned_to_name || '').split(','),
  ].map(normalize).filter(Boolean);
  for (const person of staff) {
    const email = normalize(person.user_email || person.email);
    if (email && (candidates.includes(email) ||
      (person.full_name && candidates.includes(normalize(person.full_name)) &&
       staff.filter(s => normalize(s.full_name) === normalize(person.full_name)).length === 1))) {
      emails.add(email);
    }
  }
  return [...emails].sort();
}

async function readAssignment(pool, entityType, entityId, companyId) {
  const table = TABLES[entityType];
  if (!table) throw new Error('Unsupported assignment type');
  const result = await pool.query(
    `SELECT * FROM ${table} WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [entityId, companyId],
  );
  const row = result.rows[0];
  return row ? normalizeDedicatedRow(row) : null;
}

async function listAssignmentsForCaller(pool, { companyId, entityType, email, isSuperAdmin = false }) {
  const table = TABLES[entityType];
  if (!table) throw new Error('Unsupported assignment type');
  email = normalize(email);
  if (!companyId || !email) throw new Error('Company and authenticated caller required');
  const companies = await pool.query('SELECT created_by FROM companies WHERE id = $1', [companyId]);
  const profiles = await pool.query(
    'SELECT * FROM staff_profiles WHERE company_id = $1 AND is_active = true', [companyId],
  );
  const roster = profiles.rows;
  const ownsCompany = normalize(companies.rows[0]?.created_by) === email;
  const callerProfile = roster.find(p => normalize(p.user_email || p.email) === email);
  if (!ownsCompany && !callerProfile && !isSuperAdmin) throw new Error('Access denied for this company');
  const canManageTeam = isSuperAdmin || ownsCompany || callerProfile?.is_administrator === true;
  const result = await pool.query(`SELECT * FROM ${table} WHERE company_id = $1 ORDER BY created_at DESC`, [companyId]);
  const records = result.rows.map(normalizeDedicatedRow)
    .filter(row => !row.is_deleted && (canManageTeam || assignmentEmails(row, roster).includes(email)));
  const openRecords = entityType === 'Task' ? records.filter(activeTask) : records;
  return { success: true, records: openRecords.slice(0, 500), truncated: openRecords.length > 500, canManageTeam };
}

// Every built-in assignment/reminder channel shares this atomic notification
// claim. Payloads/recipients are read from saved company records, never the browser.
async function deliverAssignmentAlert(pool, {
  companyId, entityType, entityId, action = 'create', record, occurrence,
  recipientEmails, title, message, sendSms, sendEmail = sendPlatformEmail,
  now = new Date(), quietHours = getNotificationQuietHours,
}) {
  record = record || await readAssignment(pool, entityType, entityId, companyId);
  if (!record || record.is_deleted || (entityType === 'Task' && !activeTask(record))) {
    return { success: true, skipped: true, successCount: 0 };
  }
  const quiet = await quietHours(pool, companyId, now);
  // Scheduled reminders retry after quiet hours instead of being marked sent.
  if (occurrence && quiet.active) return { success: true, deferred: true, successCount: 0 };
  const staffResult = await pool.query(
    'SELECT * FROM staff_profiles WHERE company_id = $1 AND is_active = true', [companyId],
  );
  const staff = staffResult.rows;
  const selected = recipientEmails
    ? new Set(recipientEmails.map(normalize))
    : new Set(assignmentEmails(record, staff));
  if (action === 'create' && !occurrence) {
    for (const person of staff) if (person.is_administrator === true) selected.add(normalize(person.user_email || person.email));
  }
  const recipients = new Map();
  for (const person of staff) {
    const email = normalize(person.user_email || person.email);
    if (email && selected.has(email)) recipients.set(email, person);
  }
  const revision = occurrence || (action === 'create' ? 'created' :
    new Date(record.updated_date || record.updated_at || record.created_date).toISOString());
  title = title || (action === 'create' ? 'New task assignment' : `${entityType} assignment changed`);
  const due = record.due_date instanceof Date ? record.due_date.toISOString().slice(0, 10) : String(record.due_date || '').slice(0, 10);
  message = message || `${record.name || record.title || record.full_name || entityType}${due ? ` — Due: ${due}` : ''}`;
  const link = entityType === 'Task' ? `/Tasks?task_id=${encodeURIComponent(entityId)}`
    : entityType === 'Project' ? `/Projects?project=${encodeURIComponent(entityId)}`
      : `/${entityType}Profile?id=${encodeURIComponent(entityId)}`;
  let successCount = 0, errorCount = 0;
  for (const [email, person] of recipients) {
    const id = 'assignment_alert_' + createHash('sha256')
      .update(JSON.stringify([companyId, entityType, entityId, action, revision, email])).digest('hex').slice(0, 40);
    const state = {
      user_email: email, title, message, type: occurrence ? 'task_reminder' : 'task_assigned',
      related_entity_type: entityType, related_entity_id: entityId, link_url: link, is_read: false,
      delivery_revision: revision,
      ...(quiet.active ? { deferred_until: quiet.deferredUntil, deferred_reason: 'company_notification_quiet_hours' } : {}),
    };
    const claim = await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'Notification', $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT (id, entity_type) DO NOTHING`, [id, companyId, JSON.stringify(state)],
    );
    if (!claim.rowCount) continue;
    successCount++;
    if (quiet.active) continue;
    const saveStatus = (channel, status) => pool.query(
      `UPDATE generic_entities SET data = data || $2::jsonb, updated_date = NOW()
       WHERE id = $1 AND entity_type = 'Notification' AND company_id = $3`,
      [id, JSON.stringify({ [`${channel}_status`]: status }), companyId],
    );
    try {
      const sent = await sendEmail({
        to: [email], subject: title,
        html: `<div style="font-family:sans-serif"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><p>Sign in to CompanySync to view the assignment.</p></div>`,
        context: { companyId, source: occurrence ? 'task_reminder' : 'assignment_alert' },
      });
      const failed = sent?.success === false;
      if (failed) errorCount++;
      await saveStatus('email', failed ? 'failed' : 'submitted');
    } catch {
      errorCount++;
      await saveStatus('email', 'failed');
    }
    const phone = person.cell_phone || person.phone || person.data?.cell_phone || person.data?.phone;
    if (phone && sendSms) {
      try {
        const sent = await sendSms({ to: phone, message: `${title}\n${message}`, companyId });
        const failed = sent?.success === false;
        if (failed && !sent.skipped) errorCount++;
        await saveStatus('sms', failed ? sent.skipped ? 'suppressed' : 'failed' : 'submitted');
      } catch {
        errorCount++;
        await saveStatus('sms', 'failed');
      }
    }
  }
  return { success: true, successCount, errorCount, recipientCount: recipients.size, alreadyClaimed: recipients.size - successCount };
}

module.exports = { TABLES, activeTask, assignmentEmails, normalizeDedicatedRow, readAssignment, listAssignmentsForCaller, deliverAssignmentAlert };
