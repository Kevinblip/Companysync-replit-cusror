import { useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";

/**
 * Custom hook that automatically filters data based on user's role permissions.
 * Supports "view as staff member" impersonation — when active, all filters and
 * permission checks run as if you ARE that staff member.
 */
export function useRoleBasedData() {
  // Read view-as email synchronously from sessionStorage (set by ImpersonationContext)
  const viewAsUserEmail = typeof window !== 'undefined'
    ? sessionStorage.getItem('view_as_user_email')
    : null;

  const { data: user = null } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => base44.auth.me(),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // 1. Get current user's staff profile directly
  const { data: myProfiles = [], isLoading: isLoadingProfiles } = useQuery({
    queryKey: ['my-staff-profile', user?.email],
    queryFn: () => user?.email ? base44.entities.StaffProfile.filter({ user_email: user.email }, "-created_date") : [],
    enabled: !!user?.email
  });
  const myStaffProfile = myProfiles[0];

  // 2. Get companies created by user (for owners)
   const { data: ownedCompanies = [], isLoading: isLoadingOwned } = useQuery({
     queryKey: ['owned-companies', user?.email],
     queryFn: async () => {
       if (!user?.email) return [];
       return await base44.entities.Company.filter({ created_by: user.email, is_deleted: { $ne: true } }, "-created_date", 50);
     },
     enabled: !!user?.email
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
    enabled: profileCompanyIds.length > 1
  });

  // 3. Determine Target Company ID - ALWAYS prioritize staff profile's company_id first
  // When user has multiple profiles, prefer non-platform company to prevent bleed
   const targetCompanyId = useMemo(() => {
     // Check for impersonation first
     if (typeof window !== 'undefined') {
         const impersonatedId = sessionStorage.getItem('impersonating_company_id');
         if (impersonatedId) return impersonatedId;
     }

     // When user has multiple profiles, pick the non-platform company
     if (myProfiles.length > 1 && profileCompanies.length > 0) {
       const nonPlatformCompany = profileCompanies.find(c => 
         c.company_name !== 'CompanySync' && !c.is_platform_owner
       );
       if (nonPlatformCompany) return nonPlatformCompany.id;
     }
     
     // PRIORITY: Staff profile company (this is what the user should see)
     if (myStaffProfile?.company_id) {
       return myStaffProfile.company_id;
     }

     // Fallback to owned companies - prefer non-platform
     if (ownedCompanies.length > 1) {
       const nonPlatform = ownedCompanies.find(c => 
         c.company_name !== 'CompanySync' && !c.is_platform_owner
       );
       if (nonPlatform) return nonPlatform.id;
     }
     return ownedCompanies[0]?.id;
   }, [myStaffProfile, myProfiles, ownedCompanies, profileCompanies]);

  // 4. Fetch ONLY the target company
  const { data: companies = [] } = useQuery({
    queryKey: ['my-company', targetCompanyId],
    queryFn: () => targetCompanyId ? base44.entities.Company.filter({ id: targetCompanyId }) : [],
    enabled: !!targetCompanyId
  });
  const myCompany = companies[0];

  // 5. Fetch ONLY staff for this company
  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['company-staff', targetCompanyId],
    queryFn: () => targetCompanyId ? base44.entities.StaffProfile.filter({ company_id: targetCompanyId }) : [],
    enabled: !!targetCompanyId
  });

  // 6. When viewing as a specific staff member, fetch their profile
  const { data: viewAsProfiles = [] } = useQuery({
    queryKey: ['view-as-staff-profile', viewAsUserEmail, targetCompanyId],
    queryFn: () => viewAsUserEmail && targetCompanyId
      ? base44.entities.StaffProfile.filter({ user_email: viewAsUserEmail, company_id: targetCompanyId })
      : [],
    enabled: !!viewAsUserEmail && !!targetCompanyId,
  });
  const viewAsStaffProfile = viewAsProfiles[0] || null;

  // When viewing as staff: use their profile for all permission/filter logic
  const effectiveStaffProfile = viewAsUserEmail ? viewAsStaffProfile : myStaffProfile;
  const effectiveUserEmail = viewAsUserEmail || user?.email;

  // Check if user is admin or owner
  // When viewing as a staff member, only grant admin if THEIR profile is admin
  const isOwner = myCompany?.created_by === user?.email;
  const isAdmin = viewAsUserEmail
    ? (effectiveStaffProfile?.is_administrator === true)
    : (myStaffProfile?.is_administrator || user?.is_administrator || isOwner || user?.email === 'yicnteam@gmail.com' || false);

  // Fetch the effective user's role
  const { data: staffRoles = [], isFetched: isRoleFetched } = useQuery({
    queryKey: ['staff-roles', effectiveStaffProfile?.role_id],
    queryFn: () => effectiveStaffProfile?.role_id 
      ? base44.entities.StaffRole.filter({ id: effectiveStaffProfile.role_id }) 
      : [],
    enabled: !!effectiveStaffProfile?.role_id && !isAdmin,
    initialData: [],
  });

  const myRole = staffRoles[0];

  // isPermissionsReady: true once the full auth + profile + role chain has settled
  const isDataLoading = isLoadingProfiles || isLoadingOwned || !user;
  const isPermissionsReady = !isDataLoading && (
    isAdmin ||
    !effectiveStaffProfile?.role_id ||
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
   * Filter customers based on role permissions
   * @param {Array} allCustomers - All customers
   * @returns {Array} - Filtered customers
   */
  const filterCustomers = (allCustomers) => {
    if (!effectiveUserEmail || !allCustomers) return [];
    if (isAdmin || hasPermission('customers', 'view_global')) return allCustomers;
    // Default: show own assigned records (whether or not a role is configured)
    return allCustomers.filter(c => 
      c.assigned_to === effectiveUserEmail || 
      c.assigned_to_users?.includes(effectiveUserEmail) ||
      c.created_by === effectiveUserEmail
    );
  };

  /**
   * Filter leads based on role permissions
   * @param {Array} allLeads - All leads
   * @returns {Array} - Filtered leads
   */
  const filterLeads = (allLeads) => {
    if (!effectiveUserEmail || !allLeads) return [];
    if (isAdmin || hasPermission('leads', 'view_global')) return allLeads;
    // Default: show own assigned records (whether or not a role is configured)
    return allLeads.filter(lead => 
      lead.assigned_to === effectiveUserEmail || 
      lead.assigned_to_users?.includes(effectiveUserEmail) ||
      lead.created_by === effectiveUserEmail
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
    if (!effectiveUserEmail || !allItems) return [];
    if (isAdmin || hasPermission(feature, 'view_global')) return allItems;
    if (hasPermission(feature, 'view_own')) {
      const myCustomerNames = filteredCustomers.map(c => c.name).filter(Boolean);
      const myCustomerIds   = filteredCustomers.map(c => c.id).filter(Boolean);
      return allItems.filter(item => 
        (item.customer_name && myCustomerNames.includes(item.customer_name)) ||
        (item.customer_id   && myCustomerIds.includes(item.customer_id))     ||
        item.created_by === effectiveUserEmail
      );
    }
    return [];
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
    if (!effectiveUserEmail || !allTasks) return [];
    if (isAdmin || hasPermission('tasks', 'view_global')) return allTasks;
    // Default: show own assigned records (whether or not a role is configured)
    return allTasks.filter(task => 
      task.assigned_to === effectiveUserEmail || 
      task.assignees?.some(a => a.email === effectiveUserEmail) ||
      task.created_by === effectiveUserEmail
    );
  };

  /**
   * Filter projects based on role permissions
   * @param {Array} allProjects - All projects
   * @returns {Array} - Filtered projects
   */
  const filterProjects = (allProjects) => {
    if (!effectiveUserEmail || !allProjects) return [];
    if (isAdmin || hasPermission('projects', 'view_global')) return allProjects;
    // Default: show own assigned records (whether or not a role is configured)
    return allProjects.filter(project => 
      project.created_by === effectiveUserEmail || 
      project.team_members?.includes(effectiveUserEmail)
    );
  };

  /**
   * Filter calendar events based on role permissions
   * @param {Array} allEvents - All events
   * @returns {Array} - Filtered events
   */
  const filterCalendarEvents = (allEvents) => {
    if (!effectiveUserEmail || !allEvents) return [];
    if (isAdmin || hasPermission('calendar', 'view_global')) return allEvents;
    // Default: show own assigned records (whether or not a role is configured)
    return allEvents.filter(event => 
      event.assigned_to === effectiveUserEmail || 
      event.attendees?.includes(effectiveUserEmail) ||
      event.created_by === effectiveUserEmail
    );
  };

  /**
   * Filter communications based on role permissions
   * @param {Array} allCommunications - All communications
   * @returns {Array} - Filtered communications
   */
  const filterCommunications = (allCommunications) => {
    if (!effectiveUserEmail || !allCommunications) return [];
    if (isAdmin || hasPermission('communication_hub', 'view_global')) return allCommunications;
    // Default: show own assigned records (whether or not a role is configured)
    return allCommunications.filter(c =>
      c.assigned_to === effectiveUserEmail ||
      c.created_by === effectiveUserEmail
    );
  };

  /**
   * Filter inspection jobs based on role permissions
   * @param {Array} allJobs - All inspection jobs
   * @returns {Array} - Filtered jobs
   */
  const filterJobs = (allJobs) => {
    if (!effectiveUserEmail || !allJobs) return [];
    if (isAdmin || hasPermission('inspections', 'view_global')) return allJobs;
    // Default: show own assigned records (whether or not a role is configured)
    return allJobs.filter(j =>
      j.assigned_to_email === effectiveUserEmail ||
      j.assigned_inspectors?.includes(effectiveUserEmail) ||
      j.created_by === effectiveUserEmail ||
      j.inspector_email === effectiveUserEmail
    );
  };

  /**
   * Filter messages based on role permissions
   * @param {Array} allMessages - All messages
   * @param {Array} visibleCustomers - Already filtered customers for reference
   * @returns {Array} - Filtered messages
   */
  const filterMessages = (allMessages, visibleCustomers = []) => {
    if (!effectiveUserEmail || !allMessages) return [];
    if (isAdmin || hasPermission('messages', 'view_global')) return allMessages;
    const visiblePhones = new Set(visibleCustomers.map(c => c.phone).filter(Boolean));
    const visibleEmails = new Set(visibleCustomers.map(c => c.email).filter(Boolean));
    return allMessages.filter(m =>
      m.from_user_email === effectiveUserEmail ||
      m.to_user_email === effectiveUserEmail ||
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
    myStaffProfile: effectiveStaffProfile,
    myRole,
    isAdmin,
    isDataLoading,
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
