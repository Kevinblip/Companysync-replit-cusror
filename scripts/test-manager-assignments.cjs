'use strict';
// Fully isolated provider/database doubles: never sends real mail or SMS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { activeTask, assignmentEmails, readAssignment, listAssignmentsForCaller, deliverAssignmentAlert } = require('../lib/assignmentAlerts.cjs');
const { reminderDue, nextOccurrence, checkSavedTaskReminders } = require('../lib/savedTaskReminders.cjs');
const now = new Date('2026-10-05T14:00:00Z');
const staff = [
  { company_id: 'company-a', user_email: 'one@example.test', full_name: 'One', phone: '+15550000001' },
  { company_id: 'company-a', user_email: 'two@example.test', full_name: 'Two', phone: '+15550000002' },
];
const task = {
  id: 'task-a', company_id: 'company-a', name: '<Task & name>', status: 'in_progress',
  assigned_to: 'ONE@example.test', assignees: [{ email: 'one@example.test' }, { email: 'two@example.test' }],
  updated_date: now, reminders: [],
};
const claims = new Map();
const company = { timezone: 'America/New_York', settings: {} };
const pool = {
  async query(sql, params = []) {
    if (sql.startsWith('SELECT t.id')) return { rows: [{ id: task.id, company_id: task.company_id }] };
    if (sql.startsWith('SELECT * FROM tasks')) return {
      rows: params[0] === task.id && params[1] === task.company_id ? [task] : [],
    };
    if (sql.startsWith('SELECT timezone')) return { rows: [company] };
    if (sql.startsWith('SELECT * FROM staff_profiles')) return { rows: staff.filter(s => s.company_id === params[0]) };
    if (sql.startsWith('INSERT INTO generic_entities')) {
      if (claims.has(params[0])) return { rowCount: 0, rows: [] };
      claims.set(params[0], JSON.parse(params[2]));
      return { rowCount: 1, rows: [] };
    }
    if (sql.startsWith('UPDATE generic_entities')) return { rowCount: 1 };
    if (sql.startsWith('UPDATE tasks SET reminders')) {
      task.reminders = JSON.parse(params[2]);
      return { rowCount: 1 };
    }
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return {};
    throw new Error('Unexpected SQL in isolated test: ' + sql);
  },
  async connect() { return { query: (...args) => pool.query(...args), release() {} }; },
};
let emails = 0, texts = 0;
const emailBodies = [];
const sendEmail = async opts => { emails++; emailBodies.push(opts.html); return { success: true }; };
const sendSms = async () => { texts++; return { success: true }; };
const options = { companyId: task.company_id, entityType: 'Task', entityId: task.id, now, sendEmail, sendSms };

async function run() {
  const accessPool = {
    async query(sql, params) {
      if (sql.startsWith('SELECT created_by')) return { rows: [{ created_by: 'owner@example.test' }] };
      if (sql.startsWith('SELECT * FROM staff_profiles')) return { rows: [
        ...staff.map(s => ({ ...s, role: 'Office Manager', is_administrator: false })),
        { user_email: 'manager@example.test', is_administrator: true },
      ] };
      if (sql.startsWith('SELECT * FROM tasks WHERE company_id')) return { rows: [
        task,
        { id: 'other-task', assigned_to: 'two@example.test', status: 'pending' },
        { id: 'unassigned-task', status: 'pending' },
      ] };
      throw new Error('Unexpected access SQL');
    },
  };
  const personal = await listAssignmentsForCaller(accessPool, { companyId: 'company-a', entityType: 'Task', email: 'one@example.test' });
  assert.equal(personal.canManageTeam, false, 'Office Manager title does not authorize team access');
  assert.deepEqual(personal.records.map(r => r.id), ['task-a']);
  const manager = await listAssignmentsForCaller(accessPool, { companyId: 'company-a', entityType: 'Task', email: 'manager@example.test' });
  assert.equal(manager.canManageTeam, true);
  assert.equal(manager.records.length, 3, 'authorized manager sees unassigned and other staff work');
  const owner = await listAssignmentsForCaller(accessPool, { companyId: 'company-a', entityType: 'Task', email: 'owner@example.test' });
  assert.equal(owner.canManageTeam, true);
  await assert.rejects(listAssignmentsForCaller(accessPool, { companyId: 'company-a', entityType: 'Task', email: 'outsider@example.test' }), /Access denied/);
  for (const status of ['completed', 'Done', 'job_completed', 'Job Completed/Archive', 'cancelled', 'customer_lost']) {
    assert.equal(activeTask({ status }), false, status);
  }
  assert.equal(activeTask({ status: 'pending', column: 'archived' }), false);
  assert.equal(activeTask({ status: 'pending', is_deleted: true }), false);
  assert.equal(activeTask(task), true);
  assert.deepEqual(assignmentEmails(task, staff), ['one@example.test', 'two@example.test']);
  assert.deepEqual(assignmentEmails({ assigned_to: 'Two' }, staff), ['two@example.test']);
  assert.deepEqual(assignmentEmails({ assigned_to: 'Two' }, [...staff, { user_email: 'other@example.test', full_name: 'Two' }]), []);
  assert.equal(await readAssignment(pool, 'Task', 'task-a', 'company-b'), null);
  await assert.rejects(readAssignment(pool, 'malicious SQL', 'task-a', 'company-a'), /Unsupported/);
  const responses = await Promise.all([deliverAssignmentAlert(pool, options), deliverAssignmentAlert(pool, options)]);
  assert.equal(responses.reduce((sum, r) => sum + r.successCount, 0), 2);
  assert.equal(emails, 2); assert.equal(texts, 2);
  assert(emailBodies.every(html => html.includes('&lt;Task &amp; name&gt;')));
  await deliverAssignmentAlert(pool, { ...options, action: 'assignment_changed' });
  await deliverAssignmentAlert(pool, { ...options, action: 'assignment_changed' });
  assert.equal(emails, 4, 'one notice per recipient per saved assignment revision');
  await deliverAssignmentAlert(pool, { ...options, occurrence: 'quiet-reminder', recipientEmails: ['one@example.test'],
    quietHours: async () => ({ active: true, deferredUntil: 'later' }) });
  assert.equal(emails, 4, 'quiet reminder not consumed or sent');
  const external = await deliverAssignmentAlert(pool, { ...options, occurrence: 'outside-company', recipientEmails: ['outside@example.test'] });
  assert.equal(external.recipientCount, 0);
  assert.equal(reminderDue('2026-10-05', new Date('2026-10-05T12:59:00Z'), 'America/New_York'), false);
  assert.equal(reminderDue('2026-10-05', now, 'America/New_York'), true);
  assert.equal(reminderDue('2026-10-05T15:00:00Z', now, 'America/New_York'), false);
  assert.equal(reminderDue('invalid', now, 'America/New_York'), false);
  assert.equal(nextOccurrence('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(nextOccurrence('2026-10-05', 'weekly'), '2026-10-12');
  task.reminders = [{ id: 'r1', reminder_date: '2026-10-04', reminder_to: staff.map(s => ({ email: s.user_email })), is_sent: false }];
  await checkSavedTaskReminders(pool, { now, sendEmail, sendSms });
  await checkSavedTaskReminders(pool, { now, sendEmail, sendSms });
  assert.equal(emails, 6, 'scheduler repeat cannot duplicate one-time reminders');
  assert.equal(task.reminders[0].is_sent, true);
  task.reminders = [{ id: 'r2', reminder_date: '2026-09-01', reminder_to: ['one@example.test'], is_recurring: true, recurrence_frequency: 'daily' }];
  await checkSavedTaskReminders(pool, { now, sendEmail, sendSms });
  assert.equal(emails, 7, 'one overdue recurrence catch-up, not a burst');
  assert.equal(task.reminders[0].next_reminder_date, '2026-10-06');
  task.status = 'completed';
  task.reminders = [{ id: 'r3', reminder_date: '2026-10-04', reminder_to: ['one@example.test'] }];
  await checkSavedTaskReminders(pool, { now, sendEmail, sendSms });
  assert.equal(emails, 7, 'completed task never delivers');
  task.status = 'pending';
  company.settings = { notification_quiet_hours: { enabled: true, start: '00:00', end: '23:59' } };
  await checkSavedTaskReminders(pool, { now, sendEmail, sendSms });
  assert.equal(task.reminders[0].is_sent, undefined, 'quiet hours preserve unsent schedule');
  const quick = fs.readFileSync('src/components/tasks/QuickTaskDialog.jsx', 'utf8');
  assert(!quick.includes("invoke('triggerWorkflow'") && !quick.includes('Core.SendEmail') && !quick.includes('Notification.create'));
  const handler = fs.readFileSync('vite-functions-plugin.js', 'utf8');
  assert(handler.includes('await authorizeWorkflowCatalogCompany(req, companyId)'));
  assert(handler.includes('if (data.task_reminder_id && data.task_id) continue'));
  console.log('PASS: manager assignments — scoped recipients, concurrent dedupe, escaped content, reminder recurrence/completion/quiet hours and single sender');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
