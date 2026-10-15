'use strict';

// Shared office-hours window. True only when a schedule is configured AND the
// current time falls outside it. Used at call start and at mid-call transfer.
//
// timezone: IANA name for the company (defaults to America/New_York).
// Overnight windows (start > end, e.g. 22:00–06:00) wrap midnight.

function isOutsideWorkHours(scheduleData, now = new Date(), timezone = 'America/New_York') {
  if (!scheduleData || !scheduleData.after_hours_enabled || !scheduleData.after_hours_start || !scheduleData.after_hours_end) {
    return false;
  }
  let currentMins;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    const parts = fmt.formatToParts(now);
    const h = parseInt((parts.find((p) => p.type === 'hour') || {}).value || '0', 10);
    const m = parseInt((parts.find((p) => p.type === 'minute') || {}).value || '0', 10);
    currentMins = h * 60 + (isNaN(m) ? 0 : m);
  } catch (_) {
    currentMins = now.getHours() * 60 + now.getMinutes();
  }
  const [sH, sM] = String(scheduleData.after_hours_start).split(':').map(Number);
  const [eH, eM] = String(scheduleData.after_hours_end).split(':').map(Number);
  const startMins = sH * 60 + (sM || 0);
  const endMins = eH * 60 + (eM || 0);
  if (startMins === endMins) return false;
  if (startMins < endMins) {
    return currentMins < startMins || currentMins >= endMins;
  }
  return currentMins >= endMins && currentMins < startMins;
}

module.exports = { isOutsideWorkHours };
