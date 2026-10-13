'use strict';

const crypto = require('crypto');

// Builds and installations must never be created as plain calendar events.
// A build lives in the Build Schedule and owns a linked CalendarEvent; a bare
// calendar event looks scheduled to the user while the Build Schedule stays
// empty, and crews work off the Build Schedule. The routing rule exists in the
// Lexi system prompt, but a prompt is advice — this guard is the enforcement.
//
// Real incident: asked to schedule a build, the model called
// create_calendar_event with event_type "meeting" and title
// "Duckworth Build Job", then told the user it was scheduled.

const BUILD_WORD_RE = /\b(builds?|build[-\s]?jobs?|install|installs|installed|installing|installations?|tear[-\s]?offs?|re[-\s]?roofs?|reroofs?|roof[-\s]?replacements?|replace[-\s](?:the[-\s])?roof|(?:roof|roofing|siding|gutter|gutters|shingle|shingles)[-\s](?:jobs?|crews?|days?))\b/i;

const BUILD_EVENT_TYPES = new Set(['build', 'install', 'installation', 'build_job']);

const BUILD_ROUTE_CODE = 'BUILD_ROUTE_REQUIRED';

// Entity names that reach the calendar through the generic CRUD tool.
const CALENDAR_ENTITY_NAMES = new Set(['calendarevent', 'calendar_event', 'calendarevents', 'calendar_events', 'event', 'events']);

// The override must not be a plain flag the model can assert on its first call —
// that is exactly the instruction-following the guard exists to backstop. The
// server signs a token bound to the refused event, so a retry proves the model
// was refused first and consciously reclassified the event.
const OVERRIDE_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// The token is bound to the WHOLE event, not just its title: otherwise a retry
// could keep an innocent title and move the build details into the description.
// It also expires, so a token cannot be reused days later for a different job.
const TOKEN_WINDOW_MS = 15 * 60 * 1000;

function tokenPayload(args, bucket) {
  const a = args || {};
  return [
    String(a.title || '').trim().toLowerCase(),
    String(a.description || '').trim().toLowerCase(),
    String(a.event_type || '').trim().toLowerCase(),
    String(a.start_time || '').trim(),
    bucket,
  ].join('|');
}

function signPayload(args, bucket) {
  return crypto.createHmac('sha256', OVERRIDE_SECRET).update(tokenPayload(args, bucket)).digest('hex').slice(0, 32);
}

function issueRetryToken(args) {
  return signPayload(args, Math.floor(Date.now() / TOKEN_WINDOW_MS));
}

function verifyRetryToken(args, token) {
  if (typeof token !== 'string' || token.length !== 32) return false;
  const current = Math.floor(Date.now() / TOKEN_WINDOW_MS);
  // Accept the previous window too, so a token issued a second before a
  // boundary still works for the immediate retry.
  return [current, current - 1].some((bucket) => {
    const expected = Buffer.from(signPayload(args, bucket));
    const provided = Buffer.from(token);
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
  });
}

/**
 * Detects a build/installation being scheduled through a generic calendar tool.
 * Returns null when the request looks like an ordinary event.
 */
function detectCalendarBuildIntent(args) {
  const a = args || {};
  const eventType = String(a.event_type || '').trim().toLowerCase();
  if (BUILD_EVENT_TYPES.has(eventType)) return { reason: 'event_type', overridable: false };
  const text = `${a.title || ''} ${a.description || ''}`;
  if (BUILD_WORD_RE.test(text)) return { reason: 'text', overridable: true };
  return null;
}

/**
 * Returns a tool-result object that refuses the write and redirects the model
 * to create_build_schedule, or null when the event may be created normally.
 */
function calendarBuildRouteGuard(args) {
  const detection = detectCalendarBuildIntent(args);
  if (!detection) return null;
  const a = args || {};
  if (detection.overridable && verifyRetryToken(a, a.not_a_build_token)) return null;
  const base = 'Builds and installations must be created with create_build_schedule (customer_name or customer_id, build_date as YYYY-MM-DD, and job_types) so the Build Schedule and the calendar stay linked. No event was created. Do not tell the user anything was scheduled.';
  const refusal = { success: false, code: BUILD_ROUTE_CODE, error: base };
  if (detection.overridable) {
    refusal.error = `${base} If the user actually asked for a meeting, walkthrough, inspection, or another non-installation event, call create_calendar_event again with the exact same title and start_time plus not_a_build_token set to the retry_token below.`;
    refusal.retry_token = issueRetryToken(a);
  }
  return refusal;
}

/**
 * Same invariant for the generic CRUD tool: creating a CalendarEvent through
 * manage_entity must not become the back door around create_build_schedule.
 */
function manageEntityBuildRouteGuard(entityName, entityAction, entityData) {
  const name = String(entityName || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!CALENDAR_ENTITY_NAMES.has(name)) return null;
  const action = String(entityAction || '').trim().toLowerCase();
  if (action !== 'create') return null;
  return calendarBuildRouteGuard(entityData || {});
}

module.exports = {
  BUILD_ROUTE_CODE,
  BUILD_WORD_RE,
  CALENDAR_ENTITY_NAMES,
  detectCalendarBuildIntent,
  calendarBuildRouteGuard,
  manageEntityBuildRouteGuard,
  issueRetryToken,
};
