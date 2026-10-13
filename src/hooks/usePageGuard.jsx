import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { createPageUrl } from "@/utils";
import { isPlatformAdminCheck } from "@/hooks/usePlatformAdmin";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import { hasFeatureAccess } from "@/components/SubscriptionGate";

/**
 * usePageGuard — hard-redirect staff who don't have access to a page.
 *
 * Usage:
 *   const { isAllowed, isChecking } = usePageGuard({ feature: 'invoices' });
 *
 * @param {object} options
 * @param {string}  [options.feature]       - Role permission feature key (e.g. 'invoices', 'reports').
 *                                            If omitted, only admin/owner check applies.
 * @param {string}  [options.planFeature]   - Subscription feature key that the active company must have.
 * @param {string}  [options.capability]    - Permission capability to check (default: 'view').
 * @param {boolean} [options.adminOnly]     - If true, only company owners and admins can access.
 * @param {boolean} [options.platformOnly]  - If true, only platform admins (CompanySync) can access.
 * @param {string}  [options.redirectTo]    - Page name to redirect to (default: 'Dashboard').
 * @returns {{ isAllowed: boolean, isChecking: boolean }}
 */
export function usePageGuard({
  feature,
  planFeature,
  capability = 'view',
  adminOnly = false,
  platformOnly = false,
  redirectTo = 'Dashboard',
} = {}) {
  const navigate = useNavigate();

  const { data: user = null } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => base44.auth.me(),
    staleTime: 5 * 60 * 1000,
  });

  // Resolve the active company independently of ownership so plan entitlements
  // follow the selected company and support platform-admin impersonation.
  const { company: activeCompany, isLoading: loadingActiveCompany } = useCurrentCompany(user);

  const { data: myProfiles = [], isLoading: loadingProfiles } = useQuery({
    queryKey: ['my-staff-profile', user?.email],
    queryFn: () => user?.email ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user?.email,
    staleTime: 10 * 60 * 1000,
  });

  const { data: ownedCompanies = [], isLoading: loadingOwned } = useQuery({
    queryKey: ['owned-companies', user?.email],
    queryFn: () => user?.email
      ? base44.entities.Company.filter({ created_by: user.email, is_deleted: { $ne: true } })
      : [],
    enabled: !!user?.email,
    staleTime: 10 * 60 * 1000,
  });

  const myCompany = activeCompany || ownedCompanies[0] || null;
  // A user can have more than one staff profile. The first profile returned by
  // the API is not guaranteed to belong to the active company, so using it for
  // the guard can incorrectly deny a page and send the user to Dashboard.
  const myStaffProfile =
    myProfiles.find(profile => profile?.company_id === myCompany?.id) ||
    myProfiles.find(profile => profile?.is_administrator || profile?.is_super_admin) ||
    myProfiles[0];

  const isLoading = !user || loadingProfiles || loadingOwned || loadingActiveCompany;

  const isPlatformAdmin = useMemo(() => {
    if (!user) return false;
    return isPlatformAdminCheck(user, myCompany, myStaffProfile);
  }, [user, myCompany, myStaffProfile]);

  const isOwner = String(myCompany?.created_by || '').trim().toLowerCase() ===
    String(user?.email || '').trim().toLowerCase();
  const isAdmin = isOwner || myStaffProfile?.is_administrator || myStaffProfile?.is_super_admin;

  const targetCompanyId = useMemo(() => {
    if (typeof window !== 'undefined') {
      const imp = sessionStorage.getItem('impersonating_company_id');
      if (imp) return imp;
    }
    return myCompany?.id;
  }, [myStaffProfile, myCompany]);

  const { data: staffRoles = [], isLoading: loadingRole } = useQuery({
    queryKey: ['page-guard-role', myStaffProfile?.role_id],
    queryFn: () => myStaffProfile?.role_id
      ? base44.entities.StaffRole.filter({ id: myStaffProfile.role_id })
      : [],
    enabled: !!myStaffProfile?.role_id && !isAdmin,
    staleTime: 10 * 60 * 1000,
  });

  const myRole = staffRoles[0];

  const isChecking = isLoading || (!isAdmin && !!myStaffProfile?.role_id && loadingRole);

  const isAllowed = useMemo(() => {
    if (isChecking) return true; // optimistic while loading
    if (isPlatformAdmin) return true;

    if (platformOnly) return false;  // not platform admin → blocked

    if (planFeature && !hasFeatureAccess(myCompany?.subscription_plan || 'trial', planFeature)) {
      return false;
    }

    if (isAdmin) {
      if (adminOnly) return true;
      if (!feature) return true;
      return true; // admins pass feature checks too
    }

    if (adminOnly) return false;

    if (!feature) return true; // no feature requirement — any logged-in staff

    if (!myRole) return false; // no role → can't pass feature check

    const perms = myRole.permissions || {};
    // Permission records have existed with both display-name keys
    // (for example "Workflows") and normalized keys (for example
    // "workflows"/"workflow_automation"). Resolve all known spellings here so
    // a visible menu item cannot route into a guard-driven Dashboard redirect.
    const featureKey = feature.toLowerCase().replace(/ /g, '_');
    const permissionKeys = [
      feature,
      featureKey,
      featureKey.replace(/-/g, '_'),
      ...(featureKey === 'workflows' ? ['workflow_automation'] : []),
    ].filter((key, index, keys) => key && keys.indexOf(key) === index);
    const permissions = permissionKeys
      .map(key => perms[key])
      .filter(Boolean);
    const hasCapability = capabilityName =>
      permissions.some(permission => permission?.[capabilityName] === true);

    if (capability === 'view') {
      return hasCapability('view') ||
             hasCapability('view_own') ||
             hasCapability('view_global');
    }
    if (capability === 'edit') {
      return hasCapability('edit') || hasCapability('edit_own');
    }
    if (capability === 'delete') {
      return hasCapability('delete') || hasCapability('delete_own');
    }
    return hasCapability(capability);
  }, [isChecking, isPlatformAdmin, platformOnly, planFeature, myCompany?.subscription_plan, isAdmin, adminOnly, feature, capability, myRole]);

  useEffect(() => {
    if (!isChecking && !isAllowed) {
      navigate(createPageUrl(redirectTo), { replace: true });
    }
  }, [isChecking, isAllowed, navigate, redirectTo]);

  return { isAllowed, isChecking };
}
