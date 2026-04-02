import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";

/**
 * Custom hook that automatically filters data based on user's role permissions.
 * This ensures consistent role-based access control across all pages.
 * 
 * @returns {Object} - Filtered data, permissions checker, and user info
 */
export function useRoleBasedData() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

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

  // Check if user is admin or owner
  const isOwner = myCompany?.created_by === user?.email;
  const isAdmin = myStaffProfile?.is_administrator || isOwner || user?.email === 'yicnteam@gmail.com' || false;

  // Fetch user's role
  const { data: staffRoles = [] } = useQuery({
    queryKey: ['staff-roles', myStaffProfile?.role_id],
    queryFn: () => myStaffProfile?.role_id 
      ? base44.entities.StaffRole.filter({ id: myStaffProfile.role_id }) 
      : [],
    enabled: !!myStaffProfile?.role_id && !isAdmin,
    initialData: [],
  });

  const myRole = staffRoles[0];

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
    if (!user?.email || !allCustomers) return [];
    if (isAdmin || hasPermission('customers', 'view_global')) return allCustomers;
    if (hasPermission('customers', 'view_own')) {
      return allCustomers.filter(c => 
        c.assigned_to === user.email || 
        c.assigned_to_users?.includes(user.email) ||
        c.created_by === user.email
      );
    }
    return [];
  };

  /**
   * Filter leads based on role permissions
   * @param {Array} allLeads - All leads
   * @returns {Array} - Filtered leads
   */
  const filterLeads = (allLeads) => {
    if (!user?.email || !allLeads) return [];
    if (isAdmin || hasPermission('leads', 'view_global')) return allLeads;
    if (hasPermission('leads', 'view_own')) {
      return allLeads.filter(lead => 
        lead.assigned_to === user.email || 
        lead.assigned_to_users?.includes(user.email) ||
        lead.created_by === user.email
      );
    }
    return [];
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
    if (isAdmin || hasPermission(feature, 'view_global')) return allItems;
    if (hasPermission(feature, 'view_own')) {
      const myCustomerNames = filteredCustomers.map(c => c.name);
      return allItems.filter(item => 
        myCustomerNames.includes(item.customer_name) ||
        item.created_by === user.email
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
    if (!user?.email || !allTasks) return [];
    if (isAdmin || hasPermission('tasks', 'view_global')) return allTasks;
    if (hasPermission('tasks', 'view_own')) {
      return allTasks.filter(task => 
        task.assigned_to === user.email || 
        task.assignees?.some(a => a.email === user.email) ||
        task.created_by === user.email
      );
    }
    return [];
  };

  /**
   * Filter projects based on role permissions
   * @param {Array} allProjects - All projects
   * @returns {Array} - Filtered projects
   */
  const filterProjects = (allProjects) => {
    if (!user?.email || !allProjects) return [];
    if (isAdmin || hasPermission('projects', 'view_global')) return allProjects;
    if (hasPermission('projects', 'view_own')) {
      return allProjects.filter(project => 
        project.created_by === user.email || 
        project.team_members?.includes(user.email)
      );
    }
    return [];
  };

  /**
   * Filter calendar events based on role permissions
   * @param {Array} allEvents - All events
   * @returns {Array} - Filtered events
   */
  const filterCalendarEvents = (allEvents) => {
    if (!user?.email || !allEvents) return [];
    if (isAdmin || hasPermission('calendar', 'view_global')) return allEvents;
    if (hasPermission('calendar', 'view_own')) {
      return allEvents.filter(event => 
        event.assigned_to === user.email || 
        event.attendees?.includes(user.email) ||
        event.created_by === user.email
      );
    }
    return [];
  };

  const isDataLoading = isLoadingProfiles || isLoadingOwned || !user;

  return {
    // User info
    user,
    myCompany,
    myStaffProfile,
    myRole,
    isAdmin,
    isDataLoading,
    
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
    
    // Generic filter for any customer-related entity
    filterByCustomerRelation: filterCustomerRelatedData,
  };
}