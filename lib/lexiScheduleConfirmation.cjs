'use strict';

/**
 * Atomically consumes a pending Lexi schedule confirmation and creates its
 * event. The transaction-scoped advisory lock serializes bookings for one
 * company/assignee even though calendar_events has no exclusion constraint.
 */
async function confirmScheduleAndCreate(pool, { token, companyId, userEmail, title, assignedTo, startTime, endTime }, createEvent) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`lexi-calendar:${companyId}:${assignedTo}`]);
    const pending = await client.query(
      `SELECT data FROM generic_entities WHERE id = $1 AND entity_type = 'LexiPendingSchedule' AND company_id = $2 FOR UPDATE`,
      [token, companyId]
    );
    const saved = pending.rows[0]?.data || {};
    const selected = Array.isArray(saved.alternatives) && saved.alternatives.some((slot) => slot.start === startTime && slot.end === endTime);
    if (!pending.rowCount || saved.user_email !== userEmail || saved.status !== 'pending'
      || new Date(saved.expires_at || 0).getTime() < Date.now()
      || saved.requested?.title !== title || saved.requested?.assigned_to !== assignedTo || !selected) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'SCHEDULE_CONFIRMATION_INVALID' };
    }
    const conflict = await client.query(
      `SELECT id, title, start_time, end_time FROM calendar_events WHERE company_id = $1 AND assigned_to = $2
       AND COALESCE(status, '') NOT IN ('cancelled', 'tentative') AND start_time < $4 AND end_time > $3 LIMIT 1`,
      [companyId, assignedTo, startTime, endTime]
    );
    if (conflict.rowCount) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'CALENDAR_CONFLICT', conflict: conflict.rows[0] };
    }
    const event = await createEvent(client);
    const claimed = await client.query(
      `UPDATE generic_entities SET data = data || $1::jsonb, updated_date = NOW()
       WHERE id = $2 AND entity_type = 'LexiPendingSchedule' AND company_id = $3
         AND data->>'status' = 'pending'`,
      [JSON.stringify({ status: 'used', used_at: new Date().toISOString() }), token, companyId]
    );
    if (!claimed.rowCount) throw new Error('Confirmation was already used');
    await client.query('COMMIT');
    return { ok: true, event };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { confirmScheduleAndCreate };