'use strict';

const { activeTask, deliverAssignmentAlert } = require('./assignmentAlerts.cjs');
const { getNotificationQuietHours } = require('./notificationQuietHours.cjs');
const FREQUENCY_DAYS = { daily: 1, every_3_days: 3, weekly: 7, biweekly: 14 };
const recipients = reminder => (Array.isArray(reminder.reminder_to) ? reminder.reminder_to : [reminder.reminder_to])
  .map(person => typeof person === 'string' ? person : person?.email).filter(Boolean);

function companyDay(now, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function reminderDue(value, now, timezone) {
  if (!value) return false;
  // Date-only reminders become due at 9am in the company's own timezone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }).format(now));
    const day = companyDay(now, timezone);
    return value < day || (value === day && hour >= 9);
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp <= now.getTime();
}
function nextOccurrence(value, frequency) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T09:00:00Z` : value);
  if (!Number.isFinite(date.getTime())) return null;
  if (frequency === 'monthly') {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  } else if (FREQUENCY_DAYS[frequency]) date.setUTCDate(date.getUTCDate() + FREQUENCY_DAYS[frequency]);
  else return null;
  return dateOnly ? date.toISOString().slice(0, 10) : date.toISOString();
}

// Invoked by the existing appointment/reminder scheduler, not a new cron.
// Row locking serializes schedule advancement; per-recipient delivery uses the
// same deterministic claim as manual assignment alerts.
async function checkSavedTaskReminders(pool, { now = new Date(), sendSms, sendEmail } = {}) {
  const result = await pool.query(
    `SELECT t.id, t.company_id FROM tasks t
     WHERE jsonb_typeof(t.reminders) = 'array' AND jsonb_array_length(t.reminders) > 0`,
  );
  let sent = 0;
  for (const candidate of result.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const rows = await client.query(
        'SELECT * FROM tasks WHERE id = $1 AND company_id = $2 FOR UPDATE SKIP LOCKED',
        [candidate.id, candidate.company_id],
      );
      const row = rows.rows[0];
      const task = row && { ...(row.data || {}), ...row };
      if (!activeTask(task)) { await client.query('ROLLBACK'); continue; }
      const companies = await client.query('SELECT timezone, settings FROM companies WHERE id = $1', [task.company_id]);
      const company = companies.rows[0];
      if (!company) { await client.query('ROLLBACK'); continue; }
      const timezone = company.timezone || company.settings?.time_zone || company.settings?.timezone || 'America/New_York';
      const quiet = await getNotificationQuietHours(client, task.company_id, now);
      if (quiet.active) { await client.query('ROLLBACK'); continue; }
      let changed = false;
      const reminders = task.reminders.map(reminder => {
        // Clone so schedule advancement cannot mutate other cached data.
        return { ...reminder };
      });
      for (let index = 0; index < reminders.length; index++) {
        const reminder = reminders[index];
        if (reminder.is_deleted || reminder.is_cancelled || (!reminder.is_recurring && reminder.is_sent)) continue;
        const date = reminder.next_reminder_date || reminder.reminder_date;
        if (!reminderDue(date, now, timezone) || !recipients(reminder).length) continue;
        // Claims must commit independently BEFORE contacting providers. If the
        // schedule update rolls back, replay sees the committed claim and never
        // sends an accepted email/SMS twice.
        const delivery = await deliverAssignmentAlert(pool, {
          companyId: task.company_id, entityType: 'Task', entityId: task.id, record: task,
          action: 'reminder', occurrence: `${reminder.id || index}:${date}`,
          recipientEmails: recipients(reminder), title: 'Task reminder',
          message: `${task.name || task.title || 'Task'}${reminder.reminder_description ? ` — ${reminder.reminder_description}` : ''}`,
          now, sendSms, sendEmail,
        });
        if (delivery.deferred || !delivery.recipientCount) continue;
        sent += delivery.successCount;
        reminder.is_sent = true;
        reminder.last_sent_at = now.toISOString();
        if (reminder.is_recurring) {
          // One missed-occurrence catch-up, not a burst for every missed day.
          let next = nextOccurrence(date, reminder.recurrence_frequency);
          let steps = 0;
          while (next && reminderDue(next, now, timezone) && steps++ < 5000) next = nextOccurrence(next, reminder.recurrence_frequency);
          reminder.next_reminder_date = next;
          if (!next) reminder.is_recurring = false;
        }
        changed = true;
      }
      if (changed) await client.query(
        'UPDATE tasks SET reminders = $3::jsonb WHERE id = $1 AND company_id = $2',
        [task.id, task.company_id, JSON.stringify(reminders)],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[SavedTaskReminders] Failed task', candidate.id, error.message);
    } finally { client.release(); }
  }
  return { success: true, successCount: sent };
}

module.exports = { reminderDue, nextOccurrence, recipients, checkSavedTaskReminders };
