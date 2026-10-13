// Deno twin of lib/lexiBuildIntent.cjs — keep both in lockstep.
//
// Builds and installations must never be created as plain calendar events.
// A build lives in the Build Schedule and owns a linked CalendarEvent; a bare
// calendar event looks scheduled to the user while the Build Schedule stays
// empty, and crews work off the Build Schedule. The routing rule exists in the
// Lexi system prompt, but a prompt is advice — this guard is the enforcement.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const BUILD_WORD_RE = /\b(builds?|build[-\s]?jobs?|install|installs|installed|installing|installations?|tear[-\s]?offs?|re[-\s]?roofs?|reroofs?|roof[-\s]?replacements?|replace[-\s](?:the[-\s])?roof|(?:roof|roofing|siding|gutter|gutters|shingle|shingles)[-\s](?:jobs?|crews?|days?))\b/i;

const BUILD_EVENT_TYPES = new Set(['build', 'install', 'installation', 'build_job']);

export const BUILD_ROUTE_CODE = 'BUILD_ROUTE_REQUIRED';

export const CALENDAR_ENTITY_NAMES = new Set(['calendarevent', 'calendar_event', 'calendarevents', 'calendar_events', 'event', 'events']);

const OVERRIDE_SECRET = (() => {
  try { return (globalThis as any).Deno?.env?.get('SESSION_SECRET') || randomBytes(32).toString('hex'); }
  catch { return randomBytes(32).toString('hex'); }
})();

// The token is bound to the WHOLE event, not just its title: otherwise a retry
// could keep an innocent title and move the build details into the description.
// It also expires, so a token cannot be reused days later for a different job.
const TOKEN_WINDOW_MS = 15 * 60 * 1000;

function tokenPayload(args: any, bucket: number) {
  const a = args || {};
  return [
    String(a.title || '').trim().toLowerCase(),
    String(a.description || '').trim().toLowerCase(),
    String(a.event_type || '').trim().toLowerCase(),
    String(a.start_time || '').trim(),
    bucket,
  ].join('|');
}

function signPayload(args: any, bucket: number) {
  return createHmac('sha256', OVERRIDE_SECRET).update(tokenPayload(args, bucket)).digest('hex').slice(0, 32);
}

export function issueRetryToken(args: any) {
  return signPayload(args, Math.floor(Date.now() / TOKEN_WINDOW_MS));
}

function verifyRetryToken(args: any, token: any) {
  if (typeof token !== 'string' || token.length !== 32) return false;
  const current = Math.floor(Date.now() / TOKEN_WINDOW_MS);
  return [current, current - 1].some((bucket) => {
    const expected = Buffer.from(signPayload(args, bucket));
    const provided = Buffer.from(token);
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  });
}

export function detectCalendarBuildIntent(args: any) {
  const a = args || {};
  const eventType = String(a.event_type || '').trim().toLowerCase();
  if (BUILD_EVENT_TYPES.has(eventType)) return { reason: 'event_type', overridable: false };
  const text = `${a.title || ''} ${a.description || ''}`;
  if (BUILD_WORD_RE.test(text)) return { reason: 'text', overridable: true };
  return null;
}

export function calendarBuildRouteGuard(args: any) {
  const detection = detectCalendarBuildIntent(args);
  if (!detection) return null;
  const a = args || {};
  if (detection.overridable && verifyRetryToken(a, a.not_a_build_token)) return null;
  const base = 'Builds and installations must be created with create_build_schedule (customer_name or customer_id, build_date as YYYY-MM-DD, and job_types) so the Build Schedule and the calendar stay linked. No event was created. Do not tell the user anything was scheduled.';
  const refusal: any = { success: false, code: BUILD_ROUTE_CODE, error: base };
  if (detection.overridable) {
    refusal.error = `${base} If the user actually asked for a meeting, walkthrough, inspection, or another non-installation event, call create_calendar_event again with the exact same title and start_time plus not_a_build_token set to the retry_token below.`;
    refusal.retry_token = issueRetryToken(a);
  }
  return refusal;
}

export function manageEntityBuildRouteGuard(entityName: any, entityAction: any, entityData: any) {
  const name = String(entityName || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!CALENDAR_ENTITY_NAMES.has(name)) return null;
  const action = String(entityAction || '').trim().toLowerCase();
  if (action !== 'create') return null;
  return calendarBuildRouteGuard(entityData || {});
}
