'use strict';

const tenantGuard = require('./tenantGuard.cjs');

// ISO-8601 timestamps written by Date#toISOString and quiet-hours deferrals.
// The dot is matched with a character class so the pattern needs no escapes.
const DEFERRED_TIMESTAMP = '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$';

function companySql(companyPlaceholder) {
  return `company_id = ANY(${companyPlaceholder}::text[])`;
}

// This user, or a company-wide row (no user_email).
function audienceSql(emailPlaceholder) {
  return `(
    COALESCE(data->>'user_email', '') = ''
    OR LOWER(data->>'user_email') = LOWER(${emailPlaceholder})
  )`;
}

// Missing, false, and any value other than true stay unread.
function unreadSql() {
  return `LOWER(COALESCE(data->>'is_read', '')) <> 'true'`;
}

// A row with no deferred_until is visible. A future timestamp is not.
// Unparseable values stay hidden, matching the bell's Date parse check.
function notDeferredSql() {
  return `(
    COALESCE(data->>'deferred_until', '') = ''
    OR (
      COALESCE(data->>'deferred_until', '') ~ '${DEFERRED_TIMESTAMP}'
      AND (data->>'deferred_until')::timestamptz <= NOW()
    )
  )`;
}

function unreadCountSql() {
  return `SELECT COUNT(*)::int AS count
    FROM generic_entities
    WHERE entity_type = 'Notification'
      AND ${companySql('$1')}
      AND ${audienceSql('$2')}
      AND ${unreadSql()}
      AND ${notDeferredSql()}`;
}

function visibleListSql() {
  return `SELECT id, company_id, data, created_date, updated_date
    FROM generic_entities
    WHERE entity_type = 'Notification'
      AND ${companySql('$1')}
      AND ${audienceSql('$2')}
      AND ${notDeferredSql()}
    ORDER BY created_date DESC NULLS LAST
    LIMIT $3`;
}

function mapNotificationRow(row) {
  const data = row.data && typeof row.data === 'object' ? row.data : {};
  return {
    id: row.id,
    company_id: row.company_id,
    created_date: row.created_date,
    updated_date: row.updated_date,
    ...data,
  };
}

function scopedCompanyIds(ctx, requestedCompanyId) {
  const scoped = tenantGuard.scopeListFilters(ctx, { company_id: requestedCompanyId }, 'Notification');
  const scopedCompany = scoped && scoped.company_id;
  if (scopedCompany && typeof scopedCompany === 'object' && Array.isArray(scopedCompany.$in)) {
    return scopedCompany.$in.map(String);
  }
  if (scopedCompany === undefined || scopedCompany === null || scopedCompany === '') return [];
  return [String(scopedCompany)];
}

/**
 * Company scope for the bell. The caller must be authenticated, and the
 * requested company must survive the same list scoping as entity reads.
 * While impersonating, the only readable company is the impersonated one.
 * The audience email always comes from the session, never from the query.
 */
function resolveBellCompanyIds(ctx, requestedCompanyId) {
  if (!ctx || !ctx.authenticated) return { error: 'Unauthorized', status: 401 };
  if (ctx.impersonationExpired) {
    return { error: 'Impersonation session expired. Please return to the admin dashboard.', status: 401 };
  }
  if (!ctx.email) return { error: 'Unauthorized', status: 401 };

  const requested = typeof requestedCompanyId === 'string' ? requestedCompanyId.trim() : '';
  if (!requested) return { error: 'company_id required', status: 400 };

  if (ctx.isImpersonating) {
    if (!ctx.impersonatedCompanyId || requested !== ctx.impersonatedCompanyId) {
      return { error: 'Access denied', status: 403 };
    }
    return { companyIds: [ctx.impersonatedCompanyId], email: ctx.email };
  }

  if (!(ctx.isSuperAdmin || ctx.viaServiceToken) && !ctx.allowedCompanyIds) {
    return { error: 'Access denied', status: 403 };
  }

  const allowedIds = scopedCompanyIds(ctx, requested);
  if (!allowedIds.includes(requested)) return { error: 'Access denied', status: 403 };
  return { companyIds: [requested], email: ctx.email };
}

async function handleBellRequest(pool, ctx, { path, companyId, limit } = {}) {
  const access = resolveBellCompanyIds(ctx, companyId);
  if (access.error) return { status: access.status, body: { error: access.error } };

  if (path === '/api/local/notifications/unread-count') {
    const result = await pool.query(unreadCountSql(), [access.companyIds, access.email]);
    const count = Number(result.rows[0] ? result.rows[0].count : 0);
    return { status: 200, body: { count: Number.isFinite(count) ? count : 0 } };
  }

  const parsedLimit = Number.parseInt(limit, 10);
  const cappedLimit = Number.isFinite(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 100;
  const result = await pool.query(visibleListSql(), [access.companyIds, access.email, cappedLimit]);
  return { status: 200, body: result.rows.map(mapNotificationRow) };
}

module.exports = {
  unreadCountSql,
  visibleListSql,
  mapNotificationRow,
  resolveBellCompanyIds,
  handleBellRequest,
};
