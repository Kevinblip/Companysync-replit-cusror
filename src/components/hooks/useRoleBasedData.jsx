import { useMemo, useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { getLastUsedCompanyId, getPreferredCompanyId, hasCrossTenantCompanyAccess, resolveActiveCompanyId } from "@/lib/activeCompanySelection";
import { IMPERSONATION_SYNCED_EVENT } from "@/lib/ImpersonationContext";

/**
 * Custom hook that automatically filters data based on user's role permissions.
 * This ensures consistent role-based access control across all pages.
 * 
 * @returns {Object} - Filtered data, permissions checker, and user info
 */
export function useRoleBasedData() {
  // AuthProvider already performs this session check before authenticated
  // routes render. Repeating it here adds another blocking request during
  // login, and this hook is mounted by both Layout and the current page.
  const { user = null } = useAuth();

  // 1. Get current user's staff profile directly
  const { data: myProfiles = [], isLoading: isLoadingProfiles } = useQuery({
    queryKey: ['my-staff-profile', user?.email],
    queryFn: () => user?.email ? base44.entities.StaffProfile.filter({ user_email: user.email }, "-created_date") : [],
    enabled: !!user?.email,
    staleTime: 10 * 60 * 1000,
  });
  // firstProfile is only used as a last-resort fallback inside targetCompanyId.
  // The exported myStaffProfile is re-derived AFTER targetCompanyId is known so
  // the name/role always matches the company that was actually selected.
  const firstProfile = myProfiles[0];

  // 2. Get companies created by user (for owners)
   const { data: ownedCompanies = [], isLoading: isLoadingOwned } = useQuery({
     queryKey: ['owned-companies', user?.email],
     queryFn: async () => {
       if (!user?.email) return [];
       return await base44.entities.Company.filter({ created_by: user.email, is_deleted: { $ne: true } }, "-created_date", 50);
     },
     enabled: !!user?.email,
     staleTime: 10 * 60 * 1000,
   });

  // 2b. If user has multiple staff profiles, fetch ALL associated companies to determine correct one
  const profileCompanyIds = useMemo(() => {
    if (myProfiles.length <= 1) return [];
    return [...new Set(myProfiles.map(p => p.company_id).filter(Boolean))];
  }, [myProfiles]);

  const { data: profileCompanies = [] } = useQuery({
    queryKey: ['profile-companies', profileCompanyIds.join(',')],
    queryFn: async () => {
      if (profileCompanyIds.length === 0) return [];
      const results = await Promise.all(
        profileCompanyIds.map(id => base44.entities.Company.filter({ id }))
      );
      return results.flat();
    },
    enabled: profileCompanyIds.length > 1,
    staleTime: 10 * 60 * 1000,
  });

  // 3. Determine Target Company ID
  // Priority: impersonation > owned company > admin profile > non-platform profile
  // Owned company beats staff membership (owner's "home" company).
  // Among staff profiles, an admin profile beats a non-admin one so a platform
  // admin who was accidentally added as non-admin staff in a tenant company
  // always lands on their admin company, not the tenant.
  //
  // skipImpersonation: set to true when sessionStorage has a stale/inaccessible
  // impersonating_company_id so we fall back to the user's own company instead of
  // returning undefined indefinitely.
  const [skipImpersonation, setSkipImpersonation] = useState(false);

  // The impersonation session and the stored selection live outside React.
  // Recompute when either is reconciled with the server or switched, otherwise
  // this hook keeps resolving a company the shell has already moved away from.
  const [companyContextVersion, setCompanyContextVersion] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const bump = () => setCompanyContextVersion(v => v + 1);
    window.addEventListener(IMPERSONATION_SYNCED_EVENT, bump);
    window.addEventListener('company-switched', bump);
    return () => {
      window.removeEventListener(IMPERSONATION_SYNCED_EVENT, bump);
      window.removeEventListener('company-switched', bump);
    };
  }, []);

  const targetCompanyId = useMemo(() => {
    const impersonatedId = !skipImpersonation && typeof window !== 'undefined'
      ? sessionStorage.getItem('impersonating_company_id')
      : null;
    return resolveActiveCompanyId({
      impersonatedId,
      selectedCompanyId: getLastUsedCompanyId(user?.email) || getPreferredCompanyId(myProfiles),
      profiles: myProfiles,
      ownedCompanies,
      isPlatformAdmin: hasCrossTenantCompanyAccess({ user, profiles: myProfiles }),
    }) || undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, myProfiles, ownedCompanies, skipImpersonation, companyContextVersion]);

  // 4. Fetch ONLY the target company
  const {
    data: companies = [],
    isLoading: isLoadingTargetCompany,
    isSuccess: isTargetCompanyLoaded,
  } = useQuery({
    queryKey: ['my-company', targetCompanyId],
    queryFn: () => targetCompanyId ? base44.entities.Company.filter({ id: targetCompanyId }) : [],
    enabled: !!targetCompanyId,
    staleTime: 5 * 60 * 1000,
  });
  const myCompany = companies[0];

  // Guard: if sessionStorage has an impersonating_company_id but the company is
  // genuinely not there (stale key left by a super-admin session on this
  // device), clear it and fall back so the app isn't permanently stuck.
  // A failed request must NOT trigger this: dropping impersonation on a network
  // blip silently repoints the whole page at a different tenant while the
  // server session still scopes and write-blocks by the impersonated company.
  useEffect(() => {
    if (skipImpersonation) return; // already cleared
    if (typeof window === 'undefined') return;
    const impersonatedId = sessionStorage.getItem('impersonating_company_id');
    if (!impersonatedId) return;
    if (isLoadingTargetCompany) return; // still in flight
    if (!isTargetCompanyLoaded) return; // errored — keep the session, don't guess
    if (!myCompany) {
      // Impersonation ID set but company not accessible — clear the stale key
      console.warn('[useRoleBasedData] Stale impersonating_company_id detected, clearing and falling back to own company');
      sessionStorage.removeItem('impersonating_company_id');
      sessionStorage.removeItem('impersonating_company_name');
      sessionStorage.removeItem('impersonation_expires_at');
      setSkipImpersonation(true);
      // Tell the shell too, so the sidebar stops branding a tenant this page is
      // no longer reading from.
      window.dispatchEvent(new CustomEvent('company-switched', { detail: { companyId: null } }));
    }
  }, [skipImpersonation, isLoadingTargetCompany, isTargetCompanyLoaded, myCompany]);

  // 5. Fetch ONLY staff for this company
  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['company-staff', targetCompanyId],
    queryFn: () => targetCompanyId ? base44.entities.StaffProfile.filter({ company_id: targetCompanyId }) : [],
    enabled: !!targetCompanyId,
    staleTime: 5 * 60 * 1000,
  });

  // 6. Derive myStaffProfile from the resolved target company so that the
  // displayed name and role always match the company that was actually selected.
  // Without this, myProfiles[0] (the newest profile) could belong to a different
  // company (e.g. a tenant the admin was accidentally added to) and would show
  // the wrong name and permissions.
  const myStaffProfile = useMemo(() => {
    if (!targetCompanyId) return firstProfile;
    return myProfiles.find(p => p.company_id === targetCompanyId) || firstProfile;
  }, [myProfiles, targetCompanyId, firstProfile]);

  // Check if user is an administrator or company owner. The profile `role`
  // field is also used for job titles (including sales reps whose legacy role
  // may be "admin"), so it must never grant full-company access by itself.
  const isOwner = myCompany?.created_by === user?.email;
  const isAdmin = myStaffProfile?.is_administrator === true ||
    user?.is_administrator === true ||
    isOwner;

  // Fetch user's role
  const { data: staffRoles = [], isFetched: isRoleFetched } = useQuery({
    queryKey: ['staff-roles', myStaffProfile?.role_id],
    queryFn: () => myStaffProfile?.role_id 
      ? base44.entities.StaffRole.filter({ id: myStaffProfile.role_id }) 
      : [],
    enabled: !!myStaffProfile?.role_id && !isAdmin,
  });

  const myRole = staffRoles[0];

  // effectiveUserEmail: alias for user.email (supports impersonation via sessionStorage)
  const effectiveUserEmail = user?.email;

  // isPermissionsReady: true once the full auth + profile + role chain has settled
  const isDataLoading = isLoadingProfiles || isLoadingOwned || !user;
  const isCompanyLoading = isDataLoading || (!!targetCompanyId && isLoadingTargetCompany);
  const isPermissionsReady = !isDataLoading && (
    isAdmin ||
    !myStaffProfile?.role_id ||
    isRoleFetched
  );

  /**
   * Check if user has permission for a specific feature and capability
   * @param {string} feature - Feature name (e.g., 'customers', 'invoices')
   * @param {string} capability - Capability type (e.g., 'view', 'edit', 'delete')
   * @returns {boolean} - Whether user has permission
   */
  const hasPermission = (feature, capability = 'view') => {
    if (isAdmin) return true;
    if (!myRole) return false;
    
    const rolePermissions = myRole.permissions || {};
    
    // Handle view permission variants
    if (capability === 'view') {
      return rolePermissions[feature]?.view === true || 
             rolePermissions[feature]?.view_own === true || 
             rolePermissions[feature]?.view_global === true;
    }

    // Handle view_global specifically
    // IMPORTANT: plain 'view' does NOT grant global access — only explicit view_global does.
    // Having view:true means the user can view their own records only.
    if (capability === 'view_global') {
      return rolePermissions[feature]?.view_global === true;
    }
    
    // Handle edit permission variants
    if (capability === 'edit') {
      return rolePermissions[feature]?.edit === true || 
             rolePermissions[feature]?.edit_own === true;
    }
    
    // Handle delete permission variants
    if (capability === 'delete') {
      return rolePermissions[feature]?.delete === true || 
             rolePermissions[feature]?.delete_own === true;
    }
    
    // For specific capabilities, check exact match
    return rolePermissions[feature]?.[capability] === true;
  };

  /**
   * Check if user can only view their own data (not global)
   * @param {string} feature - Feature name
   * @returns {boolean} - Whether user has view_own permission
   */
  const hasViewOwnOnly = (feature) => {
    if (isAdmin) return false;
    if (!myRole) return true;
    
    const rolePermissions = myRole.permissions || {};
    return rolePermissions[feature]?.view_own === true && 
           rolePermissions[feature]?.view_global !== true;
  };

  /**
   * Filter customers based on role permissions.
   * Only true admins (is_administrator / owner) see all customers.
   * All other users — regardless of role view_global setting — see only their own assigned customers.
   * @param {Array} allCustomers - All customers
   * @returns {Array} - Filtered customers
   */
  const filterCustomers = (allCustomers) => {
    if (!user?.email || !allCustomers) return [];
    if (isAdmin) return allCustomers;
    return allCustomers.filter(c => 
      c.assigned_to === user.email || 
      c.assigned_to_users?.includes(user.email) ||
      c.created_by === user.email
    );
  };

  /**
   * Filter leads based on role permissions.
   * Only true admins (is_administrator / owner) see all leads.
   * All other users — regardless of role view_global setting — see only their own assigned leads.
   * @param {Array} allLeads - All leads
   * @returns {Array} - Filtered leads
   */
  const filterLeads = (allLeads) => {
    if (!user?.email || !allLeads) return [];
    if (isAdmin) return allLeads;
    return allLeads.filter(lead => 
      lead.assigned_to === user.email || 
      lead.assigned_to_users?.includes(user.email) ||
      lead.created_by === user.email
    );
  };

  /**
   * Filter invoices/estimates/proposals based on role permissions
   * Uses customer relationship to determine access
   * @param {Array} allItems - All items
   * @param {Array} filteredCustomers - Already filtered customers
   * @param {string} feature - Feature name ('invoices', 'estimates', 'proposals')
   * @returns {Array} - Filtered items
   */
  const filterCustomerRelatedData = (allItems, filteredCustomers, feature) => {
    if (!user?.email || !allItems) return [];
    if (isAdmin) return allItems;
    if (feature === 'invoices') {
      const myCustomerIds = new Set((filteredCustomers || []).map(customer => String(customer.id)));
      return allItems.filter(item =>
        (item.customer_id && myCustomerIds.has(String(item.customer_id))) ||
        item.created_by === user.email
      );
    }
    const myCustomerNames = filteredCustomers.map(c => c.name);
    return allItems.filter(item =>
      myCustomerNames.includes(item.customer_name) ||
      item.created_by === user.email
    );
  };

  /**
   * Filter payments based on role permissions
   * @param {Array} allPayments - All payments
   * @param {Array} filteredCustomers - Already filtered customers
   * @returns {Array} - Filtered payments
   */
  const filterPayments = (allPayments, filteredCustomers) => {
    return filterCustomerRelatedData(allPayments, filteredCustomers, 'payments');
  };

  /**
   * Filter tasks based on role permissions
   * @param {Array} allTasks - All tasks
   * @returns {Array} - Filtered tasks
   */
  const filterTasks = (allTasks) => {
    if (!user?.email || !allTasks) return [];
    if (isAdmin) return allTasks;
    return allTasks.filter(task => 
      task.assigned_to === user.email || 
      task.assignees?.some(a => a.email === user.email) ||
      task.created_by === user.email
    );
  };

  /**
   * Filter projects based on role permissions
   * @param {Array} allProjects - All projects
   * @returns {Array} - Filtered projects
   */
  const filterProjects = (allProjects) => {
    if (!user?.email || !allProjects) return [];
    if (isAdmin) return allProjects;
    return allProjects.filter(project => 
      project.created_by === user.email || 
      project.team_members?.includes(user.email)
    );
  };

  /**
   * Filter calendar events based on role permissions
   * @param {Array} allEvents - All events
   * @returns {Array} - Filtered events
   */
  const filterCalendarEvents = (allEvents) => {
    if (!user?.email || !allEvents) return [];
    if (isAdmin) return allEvents;
    return allEvents.filter(event => 
      event.assigned_to === user.email || 
      event.attendees?.includes(user.email) ||
      event.created_by === user.email
    );
  };

  /**
   * Filter communications based on role permissions
   * @param {Array} allCommunications - All communications
   * @returns {Array} - Filtered communications
   */
  const filterCommunications = (allCommunications) => {
    if (!user?.email || !allCommunications) return [];
    if (isAdmin) return allCommunications;
    return allCommunications.filter(c =>
      c.assigned_to === user.email ||
      c.created_by === user.email
    );
  };

  /**
   * Filter inspection jobs based on role permissions
   * @param {Array} allJobs - All inspection jobs
   * @returns {Array} - Filtered jobs
   */
  const filterJobs = (allJobs) => {
    if (!user?.email || !allJobs) return [];
    if (isAdmin) return allJobs;
    return allJobs.filter(j =>
      j.assigned_to_email === user.email ||
      j.assigned_inspectors?.includes(user.email) ||
      j.created_by === user.email ||
      j.inspector_email === user.email
    );
  };

  /**
   * Filter messages based on role permissions
   * @param {Array} allMessages - All messages
   * @param {Array} visibleCustomers - Already filtered customers for reference
   * @returns {Array} - Filtered messages
   */
  const filterMessages = (allMessages, visibleCustomers = []) => {
    if (!user?.email || !allMessages) return [];
    if (isAdmin) return allMessages;
    const visiblePhones = new Set(visibleCustomers.map(c => c.phone).filter(Boolean));
    const visibleEmails = new Set(visibleCustomers.map(c => c.email).filter(Boolean));
    return allMessages.filter(m =>
      m.from_user_email === user.email ||
      m.to_user_email === user.email ||
      visiblePhones.has(m.to_phone) ||
      visiblePhones.has(m.from_phone) ||
      visibleEmails.has(m.to_user_email) ||
      visibleEmails.has(m.from_user_email)
    );
  };

  return {
    // User info
    user,
    effectiveUserEmail,
    myCompany,
    myStaffProfile,
    myRole,
    isAdmin,
    isDataLoading,
    isCompanyLoading,
    isPermissionsReady,
    staffProfiles,
    
    // Permission checkers
    hasPermission,
    hasViewOwnOnly,
    
    // Filter functions - pass in data and get filtered results
    filterCustomers,
    filterLeads,
    filterInvoices: (allInvoices, filteredCustomers) => 
      filterCustomerRelatedData(allInvoices, filteredCustomers, 'invoices'),
    filterEstimates: (allEstimates, filteredCustomers) => 
      filterCustomerRelatedData(allEstimates, filteredCustomers, 'estimates'),
    filterProposals: (allProposals, filteredCustomers) => 
      filterCustomerRelatedData(allProposals, filteredCustomers, 'proposals'),
    filterPayments,
    filterTasks,
    filterProjects,
    filterCalendarEvents,
    filterCommunications,
    filterJobs,
    filterMessages,
    
    // Generic filter for any customer-related entity
    filterByCustomerRelation: filterCustomerRelatedData,
  };
}

export default useRoleBasedData;
