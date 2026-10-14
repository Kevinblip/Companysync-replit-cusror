'use strict';

const crypto = require('crypto');
const { checkRateLimit, getClientIp } = require('./rateLimit.cjs');

// Handlers that are reachable without a browser session. Each one still has
// its own token, webhook secret, or rate limit. Anything not listed requires
// a signed-in session (or the internal cron / service token).
const PUBLIC_FUNCTIONS = new Set([
  'getPublicEstimate',
  'updatePublicEstimateStatus',
  'getPublicTrainingVideo',
  'generateColorVisualizationPublic',
  'publicSignupInvite',
  'autoSignupFromMarketing',
  'getEstimateLineReview',
  'submitEstimateLineReview',
  'recordEmailDeliveryEvent',
  'generateInvoicePDF',
]);

// Repair and privilege handlers. A signed-in company admin may run these
// only for a company they administer. A platform super-admin may name any
// company. Omitting company_id never means "every tenant".
const ADMIN_FUNCTIONS = new Set([
  'markOldInvoicesPaid',
  'fixInvoiceStatuses',
  'syncEstimateAdjustmentToInvoice',
  'createCallAssistantRole',
  'grantStaffAdminAccess',
  'fixPaymentDataCorruption',
  'fixPaymentCompanyIds',
  'deleteDuplicateLeads',
  'deleteDuplicatePayments',
  'deleteDuplicateCustomers',
  'cleanupAllOrphanedData',
  'runDataRepairs',
  'restoreFromBackup',
  'backfillInvoiceCommissions',
  'backfillPaymentNumbers',
  'linkAllEstimatesToCustomers',
  'createCustomersFromInvoices',
  'deleteUserAccount',
  'setSubscriptionOverride',
]);

function targetCompanyId(params) {
  const id = params?.company_id || params?.companyId || null;
  return id ? String(id) : null;
}

function cronTokenOk(req, env = process.env) {
  const secret = env.SESSION_SECRET || '';
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update('internal-cron-2026').digest('hex');
  const given = String(req?.headers?.['x-cron-token'] || '');
  if (!given || given.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  } catch {
    return false;
  }
}

function decideInvokeAccess({
  functionName,
  authenticated = false,
  viaCron = false,
  viaServiceToken = false,
  isSuperAdmin = false,
  isImpersonating = false,
  administratorCompanyIds = [],
  companyId = null,
} = {}) {
  if (!functionName || typeof functionName !== 'string') {
    return { ok: false, status: 400, error: 'functionName is required' };
  }
  if (functionName.startsWith('_')) {
    return { ok: false, status: 403, error: 'Not a callable function' };
  }
  if (PUBLIC_FUNCTIONS.has(functionName)) {
    return { ok: true, access: 'public' };
  }

  const internal = !!(viaCron || viaServiceToken);
  if (!authenticated && !internal) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }
  if (!ADMIN_FUNCTIONS.has(functionName)) {
    return { ok: true, access: internal && !authenticated ? 'internal' : 'session' };
  }

  if (!authenticated || internal) {
    return { ok: false, status: 403, error: 'Admin session required' };
  }
  if (isImpersonating) {
    return { ok: false, status: 403, error: 'Not available while impersonating' };
  }

  const adminSet = new Set((administratorCompanyIds || []).filter(Boolean).map(String));
  let resolved = companyId ? String(companyId) : null;
  if (!resolved) {
    if (adminSet.size === 1) resolved = [...adminSet][0];
    else return { ok: false, status: 400, error: 'company_id is required' };
  }
  if (isSuperAdmin || adminSet.has(resolved)) {
    return { ok: true, access: 'admin', companyId: resolved };
  }
  return { ok: false, status: 403, error: 'Admin access required for this company' };
}

async function authorizeFunctionInvoke({ req, functionName, params, pool, resolveContext }) {
  if (PUBLIC_FUNCTIONS.has(functionName)) {
    const ip = getClientIp(req || { headers: {} });
    const limit = checkRateLimit(`invoke-public:${functionName}:${ip}`, { max: 60, windowMs: 15 * 60 * 1000 });
    if (!limit.allowed) {
      return {
        ok: false,
        status: 429,
        error: 'Too many requests. Please try again later.',
        retryAfterMs: limit.retryAfterMs,
      };
    }
    return { ok: true, access: 'public' };
  }

  let ctx = {
    authenticated: false,
    viaServiceToken: false,
    isSuperAdmin: false,
    isImpersonating: false,
    administratorCompanyIds: new Set(),
  };
  if (pool && typeof resolveContext === 'function') {
    try {
      ctx = await resolveContext(req, pool) || ctx;
    } catch (err) {
      console.warn('[invoke-auth] could not resolve session:', err.message);
    }
  }

  const userSession = !!ctx.authenticated && !ctx.viaServiceToken;
  const decision = decideInvokeAccess({
    functionName,
    authenticated: userSession,
    viaCron: cronTokenOk(req),
    viaServiceToken: !!ctx.viaServiceToken,
    isSuperAdmin: userSession && !!ctx.isSuperAdmin,
    isImpersonating: !!ctx.isImpersonating,
    administratorCompanyIds: [...(ctx.administratorCompanyIds || [])],
    companyId: targetCompanyId(params),
  });

  if (decision.ok && decision.companyId && params && typeof params === 'object') {
    params.company_id = decision.companyId;
    params.companyId = decision.companyId;
  }
  return decision;
}

module.exports = {
  PUBLIC_FUNCTIONS,
  ADMIN_FUNCTIONS,
  decideInvokeAccess,
  authorizeFunctionInvoke,
  cronTokenOk,
  targetCompanyId,
};
