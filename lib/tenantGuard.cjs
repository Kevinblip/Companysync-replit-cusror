'use strict';
/**
 * Shared tenant/authorization guard for the universal entity API
 * (`/api/local/entity/*`). Used by BOTH the dev path (vite-db-plugin.js)
 * and the prod path (db/prod-db.cjs) — keep these in lockstep.
 *
 * Responsibilities:
 *  - Resolve the authenticated user (email, company memberships, super-admin
 *    flag) from the signed express-session cookie, without relying on
 *    framework-specific req.session (prod-server.cjs is a raw http server).
 *  - Support an internal `X-Service-Token` header for trusted server-to-server
 *    callers (e.g. functions/createCompleteBackup.ts) that legitimately need
 *    cross-company access without a browser session.
 *  - Provide helpers to scope list filters, strip/verify company_id on
 *    writes, and check per-record ownership.
 *
 * Rollout safety: by-id ownership enforcement (GET/PUT/DELETE returning 404
 * for cross-tenant access) is gated behind TENANT_GUARD_MODE ('log' | 'enforce').
 * Authentication (401 for no session) is ALWAYS hard-enforced — there is no
 * legitimate reason for this API to be reachable without a session or a valid
 * service token.
 */

const crypto = require('crypto');

function getGuardMode() {
  // Enforce unless an operator explicitly opts out with TENANT_GUARD_MODE=log
  // (or off). Authentication itself is always required.
  const mode = (process.env.TENANT_GUARD_MODE || 'enforce').toLowerCase();
  if (mode === 'log' || mode === 'off' || mode === 'monitor') return 'log';
  return 'enforce';
}

function parseCookies(req) {
  const header = req.headers?.cookie || '';
  const cookies = {};
  header.split(';').forEach((c) => {
    const idx = c.indexOf('=');
    if (idx > 0) {
      const key = c.slice(0, idx).trim();
      const val = c.slice(idx + 1).trim();
      try { cookies[key] = decodeURIComponent(val); } catch { cookies[key] = val; }
    }
  });
  return cookies;
}

/**
 * Resolve the authenticated user's full session data including impersonation state.
 * Reads the signed connect.sid cookie and queries the sessions table directly —
 * works identically in dev (express-session middleware) and prod (raw http server).
 */
async function resolveSessionData(req, pool) {
  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!SESSION_SECRET) return { email: null };
  const cookies = parseCookies(req);
  const signedSid = cookies['connect.sid'];
  if (!signedSid || !signedSid.startsWith('s:')) return { email: null };
  const val = signedSid.slice(2);
  const dotIndex = val.lastIndexOf('.');
  if (dotIndex === -1) return { email: null };
  const sid = val.slice(0, dotIndex);
  const sig = val.slice(dotIndex + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(sid).digest('base64').replace(/=+$/, '');
  if (sig !== expected) return { email: null };
  try {
    const result = await pool.query('SELECT sess FROM sessions WHERE sid = $1 AND expire > NOW()', [sid]);
    if (result.rows.length === 0) return { email: null };
    const sess = typeof result.rows[0].sess === 'string' ? JSON.parse(result.rows[0].sess) : result.rows[0].sess;
    const email = sess?.passport?.user?.claims?.email || sess?.passport?.user?.email || sess?.user?.email;
    return {
      email: email ? String(email).toLowerCase() : null,
      impersonatingCompanyId: sess?.impersonating_company_id || null,
      impersonationExpiresAt: sess?.impersonation_expires_at || null,
      impersonationLogId: sess?.impersonation_log_id || null,
      sid,
    };
  } catch (e) {
    console.error('[tenantGuard] session lookup error:', e.message);
    return { email: null };
  }
}

/**
 * Resolve the authenticated user's email from the signed connect.sid cookie.
 * Kept for backward compatibility — use resolveSessionData for impersonation checks.
 */
async function resolveSessionEmail(req, pool) {
  const data = await resolveSessionData(req, pool);
  return data.email;
}

function checkServiceToken(req) {
  const token = req.headers?.['x-service-token'];
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  if (!token || !expected) return false;
  try {
    const a = Buffer.from(String(token));
    const b = Buffer.from(String(expected));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Resolve the full authorization context for a request: who they are, which
 * company_id(s) they may access (covers multi-location staff), and whether
 * they're a platform super-admin.
 */
async function resolveRequestContext(req, pool) {
  if (checkServiceToken(req)) {
    return {
      authenticated: true,
      viaServiceToken: true,
      email: 'internal-service',
      isSuperAdmin: true,
      allowedCompanyIds: new Set(),
      platformRole: 'service',
      isImpersonating: false,
      impersonatedCompanyId: null,
    };
  }

  const sessData = await resolveSessionData(req, pool);
  const email = sessData.email;
  if (!email) {
    return { authenticated: false, email: null, isSuperAdmin: false, allowedCompanyIds: new Set(), isImpersonating: false, impersonatedCompanyId: null };
  }

  // Resolve impersonation state from session
  let isImpersonating = false;
  let impersonatedCompanyId = null;
  let impersonationExpired = false;
  if (sessData.impersonatingCompanyId && sessData.impersonationExpiresAt) {
    const expiresAt = new Date(sessData.impersonationExpiresAt);
    if (expiresAt > new Date()) {
      isImpersonating = true;
      impersonatedCompanyId = sessData.impersonatingCompanyId;
    } else {
      // Session expired — close audit log row + strip session keys (fire-and-forget)
      impersonationExpired = true;
      const logId = sessData.impersonationLogId;
      const sid = sessData.sid;
      setImmediate(() => {
        if (logId) {
          pool.query(
            `UPDATE impersonation_logs SET ended_at = NOW(), duration_minutes = ROUND(EXTRACT(EPOCH FROM (NOW() - started_at)) / 60), is_active = false WHERE id = $1 AND is_active = true`,
            [logId]
          ).catch(e => console.warn('[Impersonation] Expiry log close error:', e.message));
        }
        if (sid) {
          pool.query(
            `UPDATE sessions SET sess = sess - 'impersonating_company_id' - 'impersonation_expires_at' - 'impersonation_log_id' WHERE sid = $1`,
            [sid]
          ).catch(e => console.warn('[Impersonation] Expiry session strip error:', e.message));
        }
      });
    }
  }

  const [userResult, staffResult] = await Promise.all([
    pool.query('SELECT company_id, platform_role FROM users WHERE LOWER(email) = $1', [email]),
    pool.query(
      `SELECT company_id, is_super_admin, is_administrator FROM staff_profiles
       WHERE (LOWER(email) = $1 OR LOWER(user_email) = $1) AND is_active = true`,
      [email]
    ),
  ]);

  const userRow = userResult.rows[0];
  const platformRole = userRow?.platform_role || null;
  const allowedCompanyIds = new Set();
  if (userRow?.company_id) allowedCompanyIds.add(userRow.company_id);

  // Super-admin is an explicit platform role or staff flag. Membership in the
  // master company does not grant it.
  let isSuperAdmin = platformRole === 'super_admin';
  let isAdministrator = false;
  // Per-company admin set: keys are company IDs where this user has is_administrator=true.
  // Use this instead of the global isAdministrator boolean whenever the guard needs to
  // know whether the caller is admin specifically for the company being edited.
  const administratorCompanyIds = new Set();
  for (const row of staffResult.rows) {
    if (row.company_id) allowedCompanyIds.add(row.company_id);
    if (row.is_super_admin === true) isSuperAdmin = true;
    if (row.is_administrator === true) {
      isAdministrator = true; // kept for backward-compat callers
      administratorCompanyIds.add(row.company_id);
    }
  }

  return {
    authenticated: true,
    email,
    isSuperAdmin,
    isAdministrator,          // global flag — kept for backward compat; prefer administratorCompanyIds
    administratorCompanyIds,  // per-company: use this for company-scoped access checks
    allowedCompanyIds,
    platformRole,
    isImpersonating,
    impersonationExpired,
    impersonatedCompanyId,
    _impersonationLogId: sessData.impersonationLogId,
    _sid: sessData.sid,
  };
}

/**
 * For list/filter requests: force the company_id scope to the caller's own
 * companies (ignoring/overriding any client-supplied company_id) unless the
 * caller is a super-admin. This is always hard-enforced — it can only ever
 * narrow results, never break a legitimate same-tenant read.
 */
// Entity types that subscribers are allowed to read from platform-master companies.
// These are read-only "library" pools — price lists, templates, workflows, etc.
const MASTER_READABLE_ENTITY_TYPES = new Set([
  'PriceListItem',
  'EstimateFormat',
  'EstimateTemplate',
  'InspectionReportTemplate',
  'SMSTemplate',
  'EmailTemplate',
  'Workflow',
]);
// Platform master company IDs whose records are shared with all subscribers.
const PLATFORM_MASTER_COMPANY_IDS = [
  '695944e3c1fb00b7ab716c6f', // master price-list / template seed company
  'companysync_master_001',   // estimate formats / templates master
];

function scopeListFilters(ctx, filters, entityType) {
  if (!ctx || !ctx.authenticated) return filters;
  if (ctx.isSuperAdmin) return filters;
  const scoped = { ...filters };
  const ids = Array.from(ctx.allowedCompanyIds);

  // For shared library entity types, always include platform master company IDs
  // so subscribers can read default templates/price-lists without owning them.
  let effectiveIds = ids;
  if (entityType && MASTER_READABLE_ENTITY_TYPES.has(entityType)) {
    const combined = new Set([...ids, ...PLATFORM_MASTER_COMPANY_IDS]);
    effectiveIds = Array.from(combined);
  }

  if (effectiveIds.length === 0) {
    scoped.company_id = '__tenant_guard_no_company__';
  } else if (effectiveIds.length === 1) {
    scoped.company_id = effectiveIds[0];
  } else {
    scoped.company_id = { $in: effectiveIds };
  }
  return scoped;
}

/**
 * For create bodies: prevent an authenticated user from writing a record into
 * a company they don't belong to. Always fills in a missing company_id when
 * the caller has exactly one; only overrides a forged/foreign company_id when
 * TENANT_GUARD_MODE=enforce (log-mode just warns so we can audit legitimate
 * cross-company create flows before flipping the switch).
 */
function enforceCreateCompanyId(ctx, body, routeLabel) {
  if (!ctx || !ctx.authenticated || ctx.isSuperAdmin) return body;
  const ids = Array.from(ctx.allowedCompanyIds);
  if (ids.length === 0) return body;

  if (!body || body.company_id === undefined || body.company_id === null || body.company_id === '') {
    return ids.length === 1 ? { ...body, company_id: ids[0] } : body;
  }

  if (!ctx.allowedCompanyIds.has(body.company_id)) {
    const mode = getGuardMode();
    if (mode === 'enforce' && ids.length >= 1) {
      console.warn(`[tenantGuard] ENFORCE override forged company_id="${body.company_id}" -> "${ids[0]}" by ${ctx.email} at ${routeLabel || ''}`);
      return { ...body, company_id: ids[0] };
    }
    console.warn(`[tenantGuard] LOG-MODE would-override forged company_id="${body.company_id}" by ${ctx.email} at ${routeLabel || ''}`);
  }
  return body;
}

/**
 * For company CREATE bodies: force `created_by` to the authenticated session
 * email (overriding anything client-supplied). The `companies.created_by`
 * column is the root of the ownership chain — startCompanyTrial and the
 * no-company create guard below both authorize against it — so it must never
 * be attacker-controlled. Also makes onboarding work: QuickSetup creates the
 * company through the entity API without sending created_by at all, and the
 * subsequent owner StaffProfile create relies on this column being set.
 * Always enforced; super-admins and the service token bypass (they may
 * legitimately create companies on someone else's behalf).
 */
function enforceCompanyCreatedBy(ctx, entityType, body, routeLabel) {
  if (!body || typeof body !== 'object') return body;
  if (entityType !== 'companies') return body;
  if (!ctx || !ctx.authenticated) return body;
  if (ctx.isSuperAdmin || ctx.viaServiceToken) return body;
  if (!ctx.email) return body;

  const clone = { ...body, created_by: ctx.email };
  if (body.created_by !== undefined && body.created_by !== ctx.email) {
    console.warn(`[tenantGuard] overrode client-supplied created_by="${body.created_by}" -> "${ctx.email}" on companies create at ${routeLabel || ''}`);
  }
  // `data` JSONB fields are merged over NULL columns on read — scrub any
  // nested created_by so it can't shadow the forced column value later.
  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)
      && Object.prototype.hasOwnProperty.call(body.data, 'created_by')) {
    clone.data = { ...body.data };
    delete clone.data.created_by;
  }
  return clone;
}

/**
 * For CREATE bodies from a caller with NO company membership yet (empty
 * allowedCompanyIds): verify any client-supplied company_id points at a
 * company the caller actually created (companies.created_by matches their
 * session email). Without this, enforceCreateCompanyId passes no-company
 * bodies through untouched, so a brand-new user could POST a StaffProfile
 * with an ARBITRARY company_id, link themselves into an existing tenant, and
 * then satisfy startCompanyTrial's staff-membership ownership check.
 *
 * Legitimate onboarding still works: QuickSetup creates the Company first
 * (created_by forced to the session email by enforceCompanyCreatedBy above),
 * then creates the owner StaffProfile pointing at that company — the
 * created_by lookup passes.
 *
 * Enforcement: `staff_profiles` is an access-GRANTING record (a row is a
 * membership claim), so a failed check is ALWAYS blocked regardless of
 * TENANT_GUARD_MODE — same always-on posture as the money-critical billing/
 * subscription strips. Other entity types follow TENANT_GUARD_MODE
 * ('enforce' blocks, 'log' warns and allows) so legitimate-but-unknown
 * flows can be audited before being broken.
 *
 * Returns { blocked, reason } — the body itself is never modified.
 */
async function verifyNoCompanyCreateTarget(ctx, entityType, body, pool, routeLabel) {
  const pass = { blocked: false };
  if (!body || typeof body !== 'object') return pass;
  if (!ctx || !ctx.authenticated) return pass; // 401 is handled by the route
  if (ctx.isSuperAdmin || ctx.viaServiceToken) return pass;
  if (ctx.allowedCompanyIds && ctx.allowedCompanyIds.size > 0) return pass; // enforceCreateCompanyId covers members
  const targetCompanyId = body.company_id;
  if (targetCompanyId === undefined || targetCompanyId === null || targetCompanyId === '') return pass;

  let ownsTarget = false;
  try {
    const r = await pool.query(
      'SELECT id FROM companies WHERE id = $1 AND LOWER(created_by) = $2 LIMIT 1',
      [targetCompanyId, String(ctx.email || '').toLowerCase()]
    );
    ownsTarget = r.rows.length > 0;
  } catch (e) {
    // Fail closed: a lookup error must not silently grant a membership claim.
    console.error(`[tenantGuard] no-company create claim lookup failed at ${routeLabel || ''}:`, e.message);
    ownsTarget = false;
  }
  if (ownsTarget) return pass;

  const reason = 'You do not have access to this company';
  if (entityType === 'staff_profiles') {
    console.warn(`[tenantGuard] BLOCK no-company staff_profiles create targeting company_id="${targetCompanyId}" by ${ctx.email} at ${routeLabel || ''}`);
    return { blocked: true, reason };
  }
  if (getGuardMode() === 'enforce') {
    console.warn(`[tenantGuard] BLOCK no-company create targeting company_id="${targetCompanyId}" by ${ctx.email} at ${routeLabel || ''}`);
    return { blocked: true, reason };
  }
  console.warn(`[tenantGuard] LOG-MODE would-block no-company create targeting company_id="${targetCompanyId}" by ${ctx.email} at ${routeLabel || ''}`);
  return pass;
}

/**
 * For update bodies: never allow a request to re-home a record to a
 * different company_id. Always hard-enforced (dropping this key never
 * breaks a legitimate update).
 */
function stripCompanyIdFromUpdate(ctx, body) {
  if (!ctx || ctx.isSuperAdmin) return body;
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'company_id')) return body;
  const clone = { ...body };
  delete clone.company_id;
  return clone;
}

/**
 * For by-id GET/PUT/DELETE: verify the record belongs to one of the caller's
 * companies. Returns { allowed, blocked } — `blocked` is only true when
 * TENANT_GUARD_MODE=enforce; in 'log' mode we log the would-be block but
 * allow the request through so we can audit real traffic first.
 *
 * The `companies` table has NO `company_id` column — a company row *is* the
 * tenant boundary, so its own `id` is the company id to scope against. We key
 * on the RESOLVED table name (`entityType === 'companies'`), which is
 * bypass-proof: both the 'Company' SDK alias and the raw `/entity/companies/<id>`
 * route resolve to the same `companies` table (same rationale as
 * stripProtectedBillingFields). Without this, company records fell through the
 * "no company_id" branch below and any authenticated user could read/write any
 * company's record.
 */
function checkOwnership(ctx, entityType, record, routeLabel) {
  if (!record) return { allowed: true, blocked: false };
  if (!ctx || !ctx.authenticated) return { allowed: false, blocked: true };
  if (ctx.isSuperAdmin) return { allowed: true, blocked: false };

  const recordCompanyId = entityType === 'companies' ? record.id : record.company_id;
  if (!recordCompanyId) {
    // Legacy/orphan record with no company_id — can't scope it; allow but log.
    console.warn(`[tenantGuard] record with no company_id at ${routeLabel || ''} (id=${record.id})`);
    return { allowed: true, blocked: false };
  }

  if (ctx.allowedCompanyIds.has(recordCompanyId)) return { allowed: true, blocked: false };

  const mode = getGuardMode();
  if (mode === 'enforce') {
    console.warn(`[tenantGuard] BLOCK cross-tenant access by ${ctx.email} to company_id=${recordCompanyId} at ${routeLabel || ''}`);
    return { allowed: false, blocked: true };
  }
  console.warn(`[tenantGuard] LOG-MODE would-block cross-tenant access by ${ctx.email} to company_id=${recordCompanyId} at ${routeLabel || ''}`);
  return { allowed: true, blocked: false };
}

/**
 * Paid-usage-credit columns on the Company record. These represent credits a
 * customer has PAID for — they are only ever granted server-side by the Stripe
 * webhook after a confirmed payment. Nothing in the app writes them through the
 * universal entity API anymore, so any client CREATE/UPDATE that includes one
 * is an attempt to self-grant free credits.
 */
const PROTECTED_COMPANY_BILLING_FIELDS = [
  'ai_credits_purchased',
  'sms_credits_purchased',
  'call_credits_purchased',
  'extra_ai_credits',
  'extra_lexi_credits',
  'extra_marcus_credits',
];

/**
 * Strip paid-credit columns from a Company CREATE/UPDATE body so a tenant can't
 * hand themselves free usage credits by POSTing/PUTting to the entity API. This
 * covers only the PAID-CREDIT columns. Subscription plan/status, trial dates and
 * the plan `max_*` limits are handled separately by
 * stripProtectedSubscriptionFields() below (they used to be left alone here
 * because onboarding wrote them directly; onboarding now goes through the guarded
 * startCompanyTrial action instead).
 *
 * IMPORTANT: match on the RESOLVED table name (`entityType === 'companies'`),
 * NOT the raw SDK name. The route derives entityType from the URL and both the
 * SDK alias ('Company') and the raw table name ('companies') resolve to the
 * same `companies` table — keying on 'Company' alone would let a caller bypass
 * the strip by hitting `/api/local/entity/companies/<id>` directly.
 *
 * Always enforced (not gated by TENANT_GUARD_MODE, since granting free paid
 * credits is money-critical). Super-admins and the internal service token — the
 * only callers that can legitimately touch these — bypass the strip.
 */
// Delete every field in `fields` from a shallow copy of `obj`. Returns the copy
// (only when something was actually removed) plus the removed field names, so the
// caller can leave the original object untouched when there is nothing to strip.
function removeFields(obj, fields) {
  let clone = null;
  const removed = [];
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(obj, field)) {
      if (!clone) clone = { ...obj };
      delete clone[field];
      removed.push(field);
    }
  }
  return { clone, removed };
}

function stripProtectedBillingFields(ctx, entityType, body, routeLabel) {
  if (!body || typeof body !== 'object') return body;
  if (entityType !== 'companies') return body;
  if (ctx && (ctx.isSuperAdmin || ctx.viaServiceToken)) return body;

  let clone = null;
  const warn = (field, where) =>
    console.warn(`[tenantGuard] stripped protected billing field "${field}" (${where}) from companies write by ${ctx?.email || 'unknown'} at ${routeLabel || ''}`);

  // Top-level keys.
  const top = removeFields(body, PROTECTED_COMPANY_BILLING_FIELDS);
  if (top.clone) { clone = top.clone; top.removed.forEach((f) => warn(f, 'top-level')); }

  // Nested `data` JSONB: several company fields live only in the JSONB blob and
  // are merged over the real columns on read, so a `{data:{...}}` body would
  // smuggle protected fields straight past a top-level-only strip.
  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    const nested = removeFields(body.data, PROTECTED_COMPANY_BILLING_FIELDS);
    if (nested.clone) {
      if (!clone) clone = { ...body };
      clone.data = nested.clone;
      nested.removed.forEach((f) => warn(f, 'nested data'));
    }
  }

  return clone || body;
}

// Subscription / plan fields a tenant must NOT be able to self-grant through the
// entity API. Setting subscription_status='active' skips payment; extending
// trial_ends_at/trial_end_date gives a perpetual free trial; raising the plan
// max_* limits self-upgrades the plan. The only legitimate writers are the
// guarded startCompanyTrial action, the Stripe webhook (direct SQL, bypasses the
// entity API entirely), and super-admins / the internal service token. BOTH
// column spellings are listed because dev stores subscription_status as a real
// column while prod may keep some of these in the `data` JSONB blob, and the
// webhook writes `trial_end_date` while the frontend reads `trial_ends_at`.
// Kept as a SEPARATE list from PROTECTED_COMPANY_BILLING_FIELDS so each strip's
// intent (paid credits vs. subscription) stays independently testable.
const PROTECTED_COMPANY_SUBSCRIPTION_FIELDS = [
  'subscription_plan',
  'subscription_status',
  'trial_ends_at',
  'trial_end_date',
  'max_users',
  'max_leads',
  'max_customers',
];

/**
 * Strip subscription/plan fields from a Company CREATE/UPDATE body so a tenant
 * can't self-activate, extend their own trial, or raise their plan limits via the
 * entity API. Onboarding no longer writes these directly — it calls the guarded
 * startCompanyTrial action, which is the only entity-API-adjacent path that may
 * set them.
 *
 * On CREATE, we ALSO force subscription_status='pending'. The companies table's
 * subscription_status column defaults to 'active', so a create whose status was
 * just stripped would silently fall through to a free ACTIVE company — worse than
 * the hole being closed. 'pending' is a safe neutral state (nothing hard-locks
 * the UI on it); startCompanyTrial flips it to 'trial'. We never force a status
 * on UPDATE, which would downgrade a live company.
 *
 * Same match/bypass semantics as stripProtectedBillingFields: keys on the
 * resolved entityType==='companies' (bypass-proof against the /entity/companies
 * alias), always enforced (money-critical), and super-admins + the internal
 * service token bypass.
 */
function stripProtectedSubscriptionFields(ctx, entityType, body, isCreate, routeLabel) {
  if (!body || typeof body !== 'object') return body;
  if (entityType !== 'companies') return body;
  if (ctx && (ctx.isSuperAdmin || ctx.viaServiceToken)) return body;

  let clone = null;
  const warn = (field, where) =>
    console.warn(`[tenantGuard] stripped protected subscription field "${field}" (${where}) from companies ${isCreate ? 'create' : 'update'} by ${ctx?.email || 'unknown'} at ${routeLabel || ''}`);

  // Top-level keys.
  const top = removeFields(body, PROTECTED_COMPANY_SUBSCRIPTION_FIELDS);
  if (top.clone) { clone = top.clone; top.removed.forEach((f) => warn(f, 'top-level')); }

  // Nested `data` JSONB: trial_ends_at / max_customers live ONLY in the JSONB blob
  // (not real columns) and are merged over the columns on read, so a
  // `{data:{trial_ends_at:...}}` body would otherwise extend a trial unstripped.
  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    const nested = removeFields(body.data, PROTECTED_COMPANY_SUBSCRIPTION_FIELDS);
    if (nested.clone) {
      if (!clone) clone = { ...body };
      clone.data = nested.clone;
      nested.removed.forEach((f) => warn(f, 'nested data'));
    }
  }

  // On CREATE, force the real subscription_status column to 'pending' (its DB
  // default is 'active'). Any nested data.subscription_status was already removed
  // above, so nothing can override the column on the merged read.
  if (isCreate) {
    if (!clone) clone = { ...body };
    clone.subscription_status = 'pending';
  }

  return clone || body;
}

/**
 * Settings keys inside `company.settings` (the JSONB column) that only
 * administrators may change through the entity API. Regular staff members
 * can read the company record (for the shortcuts card in CompanySetup) but
 * must not be able to overwrite these fields by PUTting directly to
 * /api/local/entity/Company/<id> — that would bypass the isAdmin UI gate.
 *
 * Always hard-enforced (no TENANT_GUARD_MODE gate): this is a clear
 * role-based permission, not a cross-tenant isolation edge-case.
 * Super-admins and the internal service token bypass as usual.
 */
const ADMIN_ONLY_SETTINGS_KEYS = [
  // Quick-create UI configuration
  'quick_create_shortcuts',
  'shortcut_color_overrides',

  // Notification routing — who gets alerted when events occur.
  // A rogue staff member reassigning these could redirect or suppress alerts.
  'alert_recipients',               // storm-alert recipient list
  'approval_alert_phone',           // SMS recipient for adjuster-review approvals
  'adjuster_review_notify_email',   // email notification toggle
  'adjuster_review_notify_sms',     // SMS notification toggle
  'adjuster_review_notify_email_override', // override email for adjuster notifications

  // Financial numbering — invoice/estimate/customer prefix + counter.
  // Changing these mid-stream produces duplicate or out-of-sequence numbers.
  'default_tax_rate',
  'invoice_prefix',
  'invoice_next_number',
  'estimate_prefix',
  'estimate_next_number',
  'customer_prefix',
  'customer_next_number',

  // Company-wide AI voice command vocabulary — changing it affects all field
  // crew; only admins should be able to reconfigure the canonical word list.
  'voice_cheat_sheet',

  // Spends Google Solar dataLayers (~7.5¢ per uncached address). Admins only.
  'solar_datalayers_enabled',
];

/**
 * For Company PUT/PATCH bodies: if the request would CHANGE any admin-only
 * settings keys AND the caller is not an administrator (or super-admin /
 * service token), block the write and return { blocked: true, reason }.
 *
 * Change-detection (not mere key presence) is used intentionally: many pages
 * spread the full company settings object back on save, so a body that echoes
 * an UNCHANGED default_tax_rate (for example) must not 403 — only an actual
 * change to a protected key is blocked. Values are compared against
 * existing.settings (already fetched by the route for the ownership check).
 *
 * Called AFTER the subscription/billing strips so the body passed in here
 * is already sanitized of money-critical fields.
 *
 * @param {object} existing - the current company record (as returned by universalGet),
 *   or null if unavailable (in which case key-presence is used as a safe fallback).
 *
 * Returns { blocked: false } to allow, { blocked: true, reason } to deny.
 */
function enforceAdminOnlyCompanySettings(ctx, entityType, body, existing, routeLabel) {
  if (!body || typeof body !== 'object') return { blocked: false };
  if (entityType !== 'companies') return { blocked: false };
  if (!ctx || !ctx.authenticated) return { blocked: false }; // 401 handled upstream
  if (ctx.isSuperAdmin || ctx.viaServiceToken) return { blocked: false };
  // Per-company admin check: the caller must be administrator specifically for
  // the company being edited (existing.id), not just any company they belong to.
  // Falls back to the global flag only when existing is unavailable (safe default).
  const targetCompanyId = existing ? existing.id : null;
  const isAdminForThisCompany = targetCompanyId
    ? (ctx.administratorCompanyIds instanceof Set
        ? ctx.administratorCompanyIds.has(targetCompanyId)
        : ctx.isAdministrator) // back-compat if administratorCompanyIds not populated
    : ctx.isAdministrator;
  if (isAdminForThisCompany) return { blocked: false };
  // Company owner counts as admin for their own company (frontend parity).
  if (
    existing && existing.created_by && ctx.email &&
    String(existing.created_by).toLowerCase() === String(ctx.email).toLowerCase()
  ) {
    return { blocked: false };
  }

  // Detect any admin-only key inside body.settings
  const settings = body.settings;
  // If `settings` key is absent from body entirely, there is nothing to guard.
  if (!Object.prototype.hasOwnProperty.call(body, 'settings')) return { blocked: false };
  // If `settings` is present but is not a plain object (null, [], string, …) it is a
  // total-replacement write that erases the entire column — equivalent to removing every
  // key, including protected ones.  Block for non-admins when existing has protected keys.
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    const existingSettingsHere = (existing && existing.settings && typeof existing.settings === 'object' && !Array.isArray(existing.settings)) ? existing.settings : null;
    if (!existingSettingsHere) return { blocked: false }; // nothing protected to erase
    const hasProtected = ADMIN_ONLY_SETTINGS_KEYS.some(
      (k) => Object.prototype.hasOwnProperty.call(existingSettingsHere, k)
    );
    if (!hasProtected) return { blocked: false };
    console.warn(
      `[tenantGuard] BLOCK non-admin ${ctx.email} attempted settings erasure (non-object body.settings) on companies at ${routeLabel || ''}`
    );
    return { blocked: true, reason: 'Only company administrators can modify these settings.' };
  }

  // null and undefined compare equal (writing null over an absent key is a no-op).
  const same = (a, b) => {
    try { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }
    catch { return false; }
  };

  const existingSettings = (existing && existing.settings && typeof existing.settings === 'object') ? existing.settings : null;

  // companies.settings is a FULL-REPLACE column (UPDATE … SET settings = $n).
  // A non-admin bypass therefore has two shapes:
  //   (a) explicitly changing a protected key   → caught by value comparison
  //   (b) omitting a protected key that already exists → the column write
  //       silently erases it, equivalent to a change to null/absent
  //
  // The check below detects both by treating absent-in-body as null and
  // comparing against the existing value (also null-if-absent). Any
  // difference — addition, change, or removal — is an offence.
  //
  // Without an existing record we fall back to key-presence (safe default).
  const offending = ADMIN_ONLY_SETTINGS_KEYS.filter((k) => {
    if (!existingSettings) {
      // No existing record: block on key presence (conservative fallback).
      return Object.prototype.hasOwnProperty.call(settings, k);
    }
    // Treat absent (not a key in the object) as null for comparison purposes.
    const inBody     = Object.prototype.hasOwnProperty.call(settings, k);
    const inExisting = Object.prototype.hasOwnProperty.call(existingSettings, k);
    if (!inBody && !inExisting) return false; // both absent → no change
    const bodyVal     = inBody     ? settings[k]         : null;
    const existingVal = inExisting ? existingSettings[k] : null;
    return !same(bodyVal, existingVal); // any difference is an offence
  });

  if (offending.length === 0) return { blocked: false };

  console.warn(
    `[tenantGuard] BLOCK non-admin ${ctx.email} attempted to change admin-only settings keys [${offending.join(', ')}] on companies at ${routeLabel || ''}`
  );
  return { blocked: true, reason: 'Only company administrators can modify these settings.' };
}

/**
 * Top-level company columns that only administrators may CHANGE through the
 * entity API. These are the company's identity/branding/structural fields —
 * regular staff can read them everywhere but must not be able to rewrite the
 * company name, contact info, logo, branding or corporate structure by PUTting
 * to /api/local/entity/Company/<id> (or the raw /entity/companies/<id> alias).
 *
 * Deliberately EXCLUDED (legitimate non-admin write paths exist):
 * - `timezone`, `preferred_language` — GeneralSettings lets any staff member
 *   change the display language / timezone with no admin gate in the UI.
 * - `onboarding_completed` — written by the QuickSetup wizard; gating it risks
 *   an onboarding bounce-loop (see onboarding gate completion contract).
 * - `settings` — covered separately by enforceAdminOnlyCompanySettings().
 * - subscription/billing/credit columns — already hard-stripped by
 *   stripProtectedBillingFields / stripProtectedSubscriptionFields.
 *
 * Always hard-enforced (no TENANT_GUARD_MODE gate): role-based permission,
 * not a cross-tenant isolation edge-case. Super-admins, the internal service
 * token, administrators AND the company owner (companies.created_by matches
 * the session email — mirrors the frontend isAdmin logic, since older owner
 * accounts may lack an is_administrator staff profile) all bypass.
 */
const ADMIN_ONLY_COMPANY_FIELDS = [
  'name',
  'company_name',
  'company_tagline',
  'company_logo',
  'logo_url',
  'phone',
  'email',
  'address',
  'website',
  'industry',
  'branding',
  'features_enabled',
  'parent_company_id',
  'created_by',
  'base44_id',
  'is_deleted',
];

/**
 * For Company PUT/PATCH bodies: block non-admin attempts to CHANGE any
 * admin-only top-level company column. Change-detection (not mere key
 * presence) is used on purpose: several pages spread the full company record
 * back on save, so a body that echoes an UNCHANGED company_name must not 403.
 * Values are compared against the existing record (already fetched by the
 * route for the ownership check); on read the `data` JSONB fills in columns
 * that are empty (columns win when set), so a nested `{data:{company_name:...}}`
 * write is compared against the same merged value to close the smuggling path.
 *
 * Returns { blocked: false } to allow, { blocked: true, reason } to deny.
 */
function enforceAdminOnlyCompanyFields(ctx, entityType, body, existing, routeLabel) {
  if (!body || typeof body !== 'object') return { blocked: false };
  if (entityType !== 'companies') return { blocked: false };
  if (!ctx || !ctx.authenticated) return { blocked: false }; // 401 handled upstream
  if (ctx.isSuperAdmin || ctx.viaServiceToken) return { blocked: false };
  // Per-company admin check: mirrors enforceAdminOnlyCompanySettings — the caller
  // must be administrator specifically for the company being edited.
  const targetCompanyId = existing ? existing.id : null;
  const isAdminForThisCompany = targetCompanyId
    ? (ctx.administratorCompanyIds instanceof Set
        ? ctx.administratorCompanyIds.has(targetCompanyId)
        : ctx.isAdministrator)
    : ctx.isAdministrator;
  if (isAdminForThisCompany) return { blocked: false };
  // Company owner counts as admin for their own company (frontend parity).
  if (
    existing && existing.created_by && ctx.email &&
    String(existing.created_by).toLowerCase() === String(ctx.email).toLowerCase()
  ) {
    return { blocked: false };
  }

  // null and undefined compare equal (writing null over an absent field is a no-op).
  const same = (a, b) => {
    try { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }
    catch { return false; }
  };

  const offending = [];
  for (const k of ADMIN_ONLY_COMPANY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, k) && (!existing || !same(body[k], existing[k]))) {
      offending.push(k);
    }
  }
  // Nested `data` JSONB smuggling: data is merged over columns on read.
  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    for (const k of ADMIN_ONLY_COMPANY_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body.data, k) && (!existing || !same(body.data[k], existing[k]))) {
        offending.push(`data.${k}`);
      }
    }
  }
  if (offending.length === 0) return { blocked: false };

  console.warn(
    `[tenantGuard] BLOCK non-admin ${ctx.email} attempted to change admin-only company fields [${offending.join(', ')}] at ${routeLabel || ''}`
  );
  return { blocked: true, reason: 'Only company administrators can change company profile fields.' };
}

/**
 * Change-order decision fields on `estimates`. Approving a change order is a
 * MONEY decision: an approved change order's delta is auto-filled into the
 * customer's next invoice, so anyone who can flip this field can raise what a
 * homeowner is billed. It must be an administrator/owner action, and it must be
 * attributable to a real person.
 *
 * None of these are real columns on `estimates` — they land in the `data` JSONB
 * — so a caller can smuggle them either at the top level or nested under
 * `data`. Both shapes are checked, and both are normalized on the way through.
 *
 * Always hard-enforced (no TENANT_GUARD_MODE gate): role-based permission on a
 * billable amount, not a cross-tenant isolation edge case.
 */
const CHANGE_ORDER_DECISION_FIELDS = [
  'change_order_status',
  'change_order_approved_by',
  'change_order_approved_at',
  'change_order_rejected_by',
  'change_order_rejected_at',
];

/**
 * For Estimate PUT/PATCH bodies: block non-admin attempts to CHANGE a change
 * order's approval state, and stamp the approver from the SESSION rather than
 * trusting whatever identity the client sent.
 *
 * Change-detection (not key presence) is used on purpose — the estimate editor
 * spreads the whole record back on save, so a body echoing an UNCHANGED status
 * must not 403.
 *
 * Async because the owner bypass needs `companies.created_by`; the query only
 * runs on the rare path where a non-administrator touches a decision field.
 *
 * Returns { blocked: false, body } (body possibly rewritten) or
 * { blocked: true, reason }.
 */
/**
 * Fields that determine how much money an approved change order adds to an
 * invoice, plus the two that decide WHICH chain it bills into. An approval is
 * a decision about a specific amount on a specific job, so changing any of
 * these invalidates it.
 */
const CHANGE_ORDER_BILLABLE_FIELDS = [
  'total_amount',
  'amount',
  'line_items',
  'items',
  'supplement_of',
  'is_change_order',
];

/** Canonical "nobody has decided this yet" state. */
function pendingChangeOrderStamp() {
  return {
    change_order_status: 'pending',
    change_order_approved_by: '',
    change_order_approved_at: '',
    change_order_rejected_by: '',
    change_order_rejected_at: '',
  };
}

/**
 * Which decision fields a body would CHANGE relative to `existing` (null on
 * create). Checks the top level and the nested `data` JSONB, since these are
 * not real columns and can be smuggled either way.
 */
function detectChangeOrderDecisionChanges(body, existing) {
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const nested = (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) ? body.data : null;

  // null and undefined compare equal (writing null over an absent field is a no-op).
  const same = (a, b) => {
    try { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }
    catch { return false; }
  };

  // On read, `data` is merged over columns, so compare against the merged value.
  const existingData = (existing && existing.data && typeof existing.data === 'object' && !Array.isArray(existing.data))
    ? existing.data
    : null;
  const readExisting = (k) => {
    if (!existing) return null;
    if (existingData && hasOwn(existingData, k)) return existingData[k];
    return hasOwn(existing, k) ? existing[k] : null;
  };

  const offending = [];
  for (const k of CHANGE_ORDER_DECISION_FIELDS) {
    if (hasOwn(body, k) && !same(body[k], readExisting(k))) offending.push(k);
    if (nested && hasOwn(nested, k) && !same(nested[k], readExisting(k))) offending.push(`data.${k}`);
  }
  return { offending, nested, hasOwn, readExisting };
}

/** Read a field the way the API returns it: nested `data` merged over columns. */
function readMergedField(existing, key) {
  if (!existing) return null;
  const d = (existing.data && typeof existing.data === 'object' && !Array.isArray(existing.data)) ? existing.data : null;
  if (d && Object.prototype.hasOwnProperty.call(d, key)) return d[key];
  return Object.prototype.hasOwnProperty.call(existing, key) ? existing[key] : null;
}

/** Has a decision already been recorded on this row? */
function existingDecisionStatus(existing) {
  if (!existing) return 'pending';
  const raw = String(readMergedField(existing, 'change_order_status') || '').trim().toLowerCase();
  return raw === 'approved' || raw === 'rejected' ? raw : 'pending';
}

function existingIsChangeOrder(existing) {
  if (!existing) return false;
  const flag = readMergedField(existing, 'is_change_order');
  return flag === true || flag === 'true' || flag === 1 || flag === '1';
}

/** Which billable fields a body would CHANGE relative to `existing`. */
function detectChangeOrderBillableChanges(body, existing) {
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const nested = (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) ? body.data : null;
  const same = (a, b) => {
    try { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }
    catch { return false; }
  };
  const changed = [];
  for (const k of CHANGE_ORDER_BILLABLE_FIELDS) {
    const prev = readMergedField(existing, k);
    if (hasOwn(body, k) && !same(body[k], prev)) changed.push(k);
    else if (nested && hasOwn(nested, k) && !same(nested[k], prev)) changed.push(`data.${k}`);
  }
  return changed;
}

/**
 * Apply a decision stamp to a body, clearing the same fields out of the nested
 * `data` JSONB so the merged read can't resurrect the client's version.
 */
function applyChangeOrderStamp(body, nested, stamp) {
  const next = { ...body, ...stamp };
  if (nested) {
    next.data = { ...nested };
    for (const k of CHANGE_ORDER_DECISION_FIELDS) delete next.data[k];
  }
  return next;
}

/**
 * For Estimate CREATE (single and bulk): a change order is always born
 * pending. There is no legitimate way to create one that is already approved,
 * so rather than authorize the caller we simply force the canonical
 * undecided state — otherwise the PUT guard is just a speed bump that anyone
 * can walk around by POSTing `change_order_status: "approved"`.
 *
 * Super-admins and the internal service token bypass so backup/restore and
 * imports can round-trip a real historical decision.
 *
 * Returns the (possibly rewritten) body. Never blocks.
 */
function sanitizeChangeOrderOnCreate(ctx, entityType, body, routeLabel) {
  if (!body || typeof body !== 'object') return body;
  if (entityType !== 'estimates') return body;
  if (ctx && (ctx.isSuperAdmin || ctx.viaServiceToken)) return body;

  const { offending, nested } = detectChangeOrderDecisionChanges(body, null);
  if (offending.length === 0) return body;

  const alreadyPending =
    offending.every((k) => k.replace(/^data\./, '') === 'change_order_status') &&
    String(body.change_order_status || (nested && nested.change_order_status) || '').toLowerCase() === 'pending';
  if (!alreadyPending) {
    console.warn(
      `[tenantGuard] forced new change order to pending; caller ${ctx && ctx.email} supplied [${offending.join(', ')}] at ${routeLabel || ''}`
    );
  }
  return applyChangeOrderStamp(body, nested, pendingChangeOrderStamp());
}

/**
 * For the legacy direct `/api/local/estimates/:id` routes, which resolve no
 * tenant context and therefore cannot authorize or attribute anything.
 *
 * Two things are refused here:
 *  1. Any change to the decision fields — an approval needs a known approver.
 *  2. Any change to the billable scope of an ALREADY-DECIDED change order.
 *     On the entity API such an edit merely reverts the row to pending, but
 *     that relies on knowing who did it; with no caller to hold responsible,
 *     the only safe answer is to refuse.
 *
 * Ordinary estimate edits, and edits to pending change orders, pass through.
 *
 * Returns { blocked: false } or { blocked: true, reason }.
 */
function rejectChangeOrderDecision(entityType, body, existing, routeLabel) {
  if (!body || typeof body !== 'object') return { blocked: false };
  if (entityType !== 'estimates') return { blocked: false };

  const { offending } = detectChangeOrderDecisionChanges(body, existing);
  if (offending.length > 0) {
    console.warn(
      `[tenantGuard] BLOCK change-order decision fields [${offending.join(', ')}] on unauthenticated direct route ${routeLabel || ''}`
    );
    return { blocked: true, reason: 'Change order approvals must go through the estimate editor.' };
  }

  if (existingIsChangeOrder(existing) && existingDecisionStatus(existing) !== 'pending') {
    const billable = detectChangeOrderBillableChanges(body, existing);
    if (billable.length > 0) {
      console.warn(
        `[tenantGuard] BLOCK post-approval billable change [${billable.join(', ')}] on unauthenticated direct route ${routeLabel || ''}`
      );
      return {
        blocked: true,
        reason: 'This change order has already been decided. Edit it from the estimate editor so the change can be re-approved.',
      };
    }
  }

  return { blocked: false };
}

async function enforceChangeOrderApproval(ctx, entityType, body, existing, pool, routeLabel) {
  if (!body || typeof body !== 'object') return { blocked: false, body };
  if (entityType !== 'estimates') return { blocked: false, body };
  if (!ctx || !ctx.authenticated) return { blocked: false, body }; // 401 handled upstream
  if (ctx.isSuperAdmin || ctx.viaServiceToken) return { blocked: false, body };

  const { offending, nested, hasOwn, readExisting } = detectChangeOrderDecisionChanges(body, existing);

  // An approval is a decision about a SPECIFIC amount. Editing the total or
  // the line items of an already-approved change order would raise what the
  // homeowner is billed without anyone approving the new number.
  const wasDecided = existingIsChangeOrder(existing) && existingDecisionStatus(existing) !== 'pending';
  const billable = wasDecided ? detectChangeOrderBillableChanges(body, existing) : [];

  if (offending.length === 0) {
    if (billable.length > 0) {
      // Re-approving at the same status looks like "no change" to the field
      // diff, so an explicit decision in the payload counts as a fresh one and
      // goes through authorization below rather than being reverted.
      const asserted = String(
        (hasOwn(body, 'change_order_status') && body.change_order_status) ||
        (nested && hasOwn(nested, 'change_order_status') && nested.change_order_status) || ''
      ).trim().toLowerCase();
      if (asserted !== 'approved' && asserted !== 'rejected') {
        console.warn(
          `[tenantGuard] change order ${existing && existing.id} reverted to pending: ${ctx.email} changed [${billable.join(', ')}] after approval (${routeLabel || ''})`
        );
        return { blocked: false, body: applyChangeOrderStamp(body, nested, pendingChangeOrderStamp()) };
      }
    } else {
      return { blocked: false, body };
    }
  }

  const targetCompanyId = existing ? (existing.company_id || null) : null;
  let allowed = targetCompanyId
    ? (ctx.administratorCompanyIds instanceof Set
        ? ctx.administratorCompanyIds.has(targetCompanyId)
        : ctx.isAdministrator) // back-compat if administratorCompanyIds not populated
    : ctx.isAdministrator;

  // Company owner counts as admin for their own company (frontend parity —
  // older owner accounts may lack an is_administrator staff profile).
  if (!allowed && targetCompanyId && ctx.email && pool) {
    try {
      const owner = await pool.query('SELECT created_by FROM companies WHERE id = $1', [targetCompanyId]);
      const createdBy = owner.rows && owner.rows[0] && owner.rows[0].created_by;
      if (createdBy && String(createdBy).toLowerCase() === String(ctx.email).toLowerCase()) allowed = true;
    } catch (e) {
      console.warn(`[tenantGuard] change-order owner lookup failed for company ${targetCompanyId}: ${e.message}`);
      // fall through and block — an unresolvable owner is not an approval
    }
  }

  if (!allowed) {
    console.warn(
      `[tenantGuard] BLOCK non-admin ${ctx.email} attempted to change change-order decision fields [${offending.join(', ')}] at ${routeLabel || ''}`
    );
    return {
      blocked: true,
      reason: 'Only company administrators can approve or reject a change order.',
    };
  }

  // An approval with no identity behind it is worse than no approval — it looks
  // reviewed but names nobody. Refuse rather than record an empty approver.
  const who = String(ctx.email || '').trim();
  if (!who) {
    console.warn(`[tenantGuard] BLOCK unattributable change-order decision at ${routeLabel || ''}`);
    return {
      blocked: true,
      reason: 'Cannot record a change order decision without a signed-in user.',
    };
  }

  const requested = String(
    (hasOwn(body, 'change_order_status') ? body.change_order_status
      : (nested && hasOwn(nested, 'change_order_status')) ? nested.change_order_status
      : readExisting('change_order_status')) || ''
  ).trim().toLowerCase();

  const at = new Date().toISOString();
  let stamp;
  if (requested === 'approved') {
    stamp = {
      change_order_status: 'approved',
      change_order_approved_by: who,
      change_order_approved_at: at,
      change_order_rejected_by: '',
      change_order_rejected_at: '',
    };
  } else if (requested === 'rejected') {
    stamp = {
      change_order_status: 'rejected',
      change_order_rejected_by: who,
      change_order_rejected_at: at,
      change_order_approved_by: '',
      change_order_approved_at: '',
    };
  } else {
    // Anything unrecognized is not a decision. Normalize to pending with no
    // approver rather than persisting a status the readers can't interpret.
    stamp = pendingChangeOrderStamp();
  }

  return { blocked: false, body: applyChangeOrderStamp(body, nested, stamp) };
}

module.exports = {
  getGuardMode,
  resolveSessionEmail,
  resolveRequestContext,
  scopeListFilters,
  enforceChangeOrderApproval,
  sanitizeChangeOrderOnCreate,
  rejectChangeOrderDecision,
  CHANGE_ORDER_DECISION_FIELDS,
  enforceCreateCompanyId,
  enforceCompanyCreatedBy,
  verifyNoCompanyCreateTarget,
  stripCompanyIdFromUpdate,
  stripProtectedBillingFields,
  stripProtectedSubscriptionFields,
  enforceAdminOnlyCompanySettings,
  enforceAdminOnlyCompanyFields,
  checkOwnership,
  PROTECTED_COMPANY_BILLING_FIELDS,
  PROTECTED_COMPANY_SUBSCRIPTION_FIELDS,
  ADMIN_ONLY_SETTINGS_KEYS,
  ADMIN_ONLY_COMPANY_FIELDS,
};
