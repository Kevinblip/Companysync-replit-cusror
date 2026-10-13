'use strict';

function parseSettings(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return {}; }
}

function zonedParts(date, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
}

function getQuietHoursWindow(settings, timeZone) {
  const quiet = settings?.notification_quiet_hours || {};
  if (quiet.enabled !== true) return { enabled: false };
  const start = /^\d{2}:\d{2}$/.test(quiet.start || '') ? quiet.start : '22:00';
  const end = /^\d{2}:\d{2}$/.test(quiet.end || '') ? quiet.end : '07:00';
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  return {
    enabled: true,
    timezone: timeZone || 'America/New_York',
    start,
    end,
    startMinutes: startHour * 60 + startMinute,
    endMinutes: endHour * 60 + endMinute,
  };
}

function isWithinQuietHours(window, now = new Date()) {
  if (!window?.enabled) return false;
  const parts = zonedParts(now, window.timezone);
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (window.startMinutes === window.endMinutes) return true;
  return window.startMinutes < window.endMinutes
    ? currentMinutes >= window.startMinutes && currentMinutes < window.endMinutes
    : currentMinutes >= window.startMinutes || currentMinutes < window.endMinutes;
}

function localWallClockToUtc(timeZone, localDate, localTime) {
  const [year, month, day] = localDate.split('-').map(Number);
  const [hour, minute] = localTime.split(':').map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const probe = new Date(wallClockAsUtc);
  const probeParts = zonedParts(probe, timeZone);
  const probeAsUtc = Date.UTC(
    Number(probeParts.year),
    Number(probeParts.month) - 1,
    Number(probeParts.day),
    Number(probeParts.hour),
    Number(probeParts.minute),
    Number(probeParts.second),
    0,
  );
  const offset = probeAsUtc - wallClockAsUtc;
  return new Date(wallClockAsUtc - offset);
}

function nextQuietHoursEnd(window, now = new Date()) {
  if (!window?.enabled || !isWithinQuietHours(window, now)) return null;
  const parts = zonedParts(now, window.timezone);
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  let localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const crossesMidnight = window.startMinutes > window.endMinutes;
  if (window.startMinutes === window.endMinutes || (crossesMidnight && currentMinutes >= window.endMinutes)) {
    const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1));
    localDate = date.toISOString().slice(0, 10);
  }
  return localWallClockToUtc(window.timezone, localDate, window.end);
}

async function getNotificationQuietHours(pool, companyId, now = new Date()) {
  if (!pool || !companyId) return { active: false };
  const result = await pool.query(
    'SELECT timezone, settings FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1',
    [String(companyId)],
  );
  const company = result.rows[0];
  const settings = parseSettings(company?.settings);
  const timezone = company?.timezone || settings.time_zone || settings.timezone || 'America/New_York';
  const window = getQuietHoursWindow(settings, timezone);
  const active = isWithinQuietHours(window, now);
  return {
    active,
    timezone,
    start: window.start,
    end: window.end,
    deferredUntil: active ? nextQuietHoursEnd(window, now)?.toISOString() : null,
  };
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

// Company quiet hours apply to internal staff recipients only. Customer-facing
// transactional messages must continue to deliver normally.
async function getStaffNotificationQuietHours(pool, companyId, { email, phone } = {}, now = new Date()) {
  const quietHours = await getNotificationQuietHours(pool, companyId, now);
  if (!quietHours.active || !companyId) return { active: false };

  const normalizedEmail = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
  const normalizedPhone = normalizePhone(phone) || null;
  if (!normalizedEmail && !normalizedPhone) return { active: false };

  const result = await pool.query(
    `SELECT 1
       FROM staff_profiles
      WHERE (company_id = $1 OR company_id IN (
        SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1
      ))
        AND (
          ($2::text IS NOT NULL AND (LOWER(email) = $2 OR LOWER(user_email) = $2))
          OR
          ($3::text IS NOT NULL AND (
            regexp_replace(COALESCE(NULLIF(cell_phone, ''), NULLIF(phone, ''), ''), '\\D', '', 'g') = $3
          ))
        )
      LIMIT 1`,
    [String(companyId), normalizedEmail, normalizedPhone],
  );

  return result.rows.length > 0 ? quietHours : { active: false };
}

module.exports = {
  getNotificationQuietHours,
  getStaffNotificationQuietHours,
  getQuietHoursWindow,
  isWithinQuietHours,
  nextQuietHoursEnd,
};