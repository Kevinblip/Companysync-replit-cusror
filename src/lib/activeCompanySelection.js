// The active company is a browser preference, not an authentication claim.
// Keeping it under one global localStorage key let a selection made by one
// account silently control a different account's data requests after login.

export const LEGACY_LAST_USED_COMPANY_KEY = 'last_used_company_id';
export const ACTIVE_COMPANY_USER_KEY = 'active_company_user_email';
export const PLATFORM_COMPANY_ID = 'companysync_master_001';
const KEY_PREFIX = 'last_used_company_id:';

// Mirrors the server's unscoped-read rule (tenantGuard.resolveRequestContext).
// Only accounts the API will actually serve cross-tenant data to may keep a
// selection for a company they have no membership in — otherwise the shell
// would brand a tenant whose rows the API refuses to return.
export function hasCrossTenantCompanyAccess({ user = null, profiles = [] } = {}) {
  if (!user) return false;
  if (user.platform_role === 'super_admin') return true;
  if (user.company_id === PLATFORM_COMPANY_ID) return true;
  return profiles.some(
    (profile) => profile?.company_id === PLATFORM_COMPANY_ID && profile?.is_super_admin === true
  );
}

export function normalizeCompanyUserEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function companySelectionKey(email) {
  const normalized = normalizeCompanyUserEmail(email);
  return normalized ? `${KEY_PREFIX}${normalized}` : null;
}

function browserStorage() {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function getActiveCompanyUser(storage = browserStorage()) {
  return normalizeCompanyUserEmail(storage?.getItem(ACTIVE_COMPANY_USER_KEY));
}

export function getLastUsedCompanyId(email, storage = browserStorage()) {
  const key = companySelectionKey(email || getActiveCompanyUser(storage));
  return key ? storage?.getItem(key) || null : null;
}

export function getPreferredCompanyId(profiles = []) {
  const platformProfile = profiles.find((profile) => profile?.company_id === PLATFORM_COMPANY_ID);
  return platformProfile?.preferred_company_id || platformProfile?.data?.preferred_company_id || null;
}

export function setLastUsedCompanyId(companyId, email, storage = browserStorage()) {
  const key = companySelectionKey(email || getActiveCompanyUser(storage));
  if (!key || !storage) return;
  if (companyId) storage.setItem(key, companyId);
  else storage.removeItem(key);
}

export function clearLastUsedCompanyId(email, storage = browserStorage()) {
  const key = companySelectionKey(email || getActiveCompanyUser(storage));
  if (key) storage?.removeItem(key);
}

// Keep the fallback deterministic everywhere. CompanySync is the safe default
// for anyone with a CompanySync membership; another tenant only wins after an
// explicit selection for that same account.
export function getDefaultCompanyId({ profiles = [], ownedCompanies = [], isPlatformAdmin = false } = {}) {
  const platformProfile = profiles.find((profile) => profile?.company_id === PLATFORM_COMPANY_ID);
  if (platformProfile?.company_id) return platformProfile.company_id;

  const ownedIds = new Set(ownedCompanies.map((company) => company?.id).filter(Boolean));
  const ownedProfile = profiles.find((profile) => ownedIds.has(profile?.company_id));
  if (ownedProfile?.company_id) return ownedProfile.company_id;

  // Platform staff without a CompanySync staff row still belong on CompanySync.
  // Without this they fall through to whichever tenant they were once added to,
  // which is how the dashboard ended up greeting a different company entirely.
  if (isPlatformAdmin) return PLATFORM_COMPANY_ID;

  const nonPlatformAdmin = profiles.find((profile) =>
    profile?.is_administrator && profile.company_id !== PLATFORM_COMPANY_ID
  );
  if (nonPlatformAdmin?.company_id) return nonPlatformAdmin.company_id;

  const adminProfile = profiles.find((profile) => profile?.is_administrator);
  if (adminProfile?.company_id) return adminProfile.company_id;

  const nonPlatformOwned = ownedCompanies.find((company) =>
    company?.id !== 'companysync_master_001' && !company?.is_platform_owner
  );
  if (nonPlatformOwned?.id) return nonPlatformOwned.id;

  return profiles[0]?.company_id || ownedCompanies[0]?.id || null;
}

export function resolveActiveCompanyId({
  impersonatedId = null,
  selectedCompanyId = null,
  profiles = [],
  ownedCompanies = [],
  isPlatformAdmin = false,
} = {}) {
  if (impersonatedId) return impersonatedId;
  const isSelectedCompanyAllowed = !!selectedCompanyId && (
    isPlatformAdmin ||
    profiles.some((profile) => profile?.company_id === selectedCompanyId) ||
    ownedCompanies.some((company) => company?.id === selectedCompanyId)
  );
  return isSelectedCompanyAllowed
    ? selectedCompanyId
    : getDefaultCompanyId({ profiles, ownedCompanies, isPlatformAdmin });
}

function clearImpersonationSession() {
  if (typeof window === 'undefined') return;
  [
    'impersonating_company_id',
    'impersonating_company_name',
    'impersonation_session_id',
    'impersonation_expires_at',
    'pre_impersonation_company_id',
    'pre_impersonation_user_email',
    'view_as_user_email',
    'view_as_user_name',
  ].forEach((key) => window.sessionStorage.removeItem(key));
}

// Call this as soon as the server identifies the authenticated user. A session
// that changes accounts in the same browser must not retain the prior user's
// impersonation or legacy global company selection.
export function activateCompanySelectionUser(email, storage = browserStorage()) {
  const normalized = normalizeCompanyUserEmail(email);
  if (!normalized || !storage) return;

  const prior = getActiveCompanyUser(storage);
  if (prior !== normalized) {
    clearImpersonationSession();
    try {
      window.dispatchEvent(new CustomEvent('active-company-user-changed', {
        detail: { previousEmail: prior || null, userEmail: normalized },
      }));
    } catch (_) {}
  }

  // Never migrate an unscoped value: its owner cannot be proven. Ignoring it is
  // what prevents an old YICN selection from redirecting a CompanySync login.
  storage.removeItem(LEGACY_LAST_USED_COMPANY_KEY);
  storage.setItem(ACTIVE_COMPANY_USER_KEY, normalized);
  storage.setItem('base44_user_email', normalized);
}

export function clearActiveCompanySession(storage = browserStorage()) {
  if (!storage) return;
  clearImpersonationSession();
  storage.removeItem(LEGACY_LAST_USED_COMPANY_KEY);
  storage.removeItem(ACTIVE_COMPANY_USER_KEY);
  storage.removeItem('base44_user_email');
}