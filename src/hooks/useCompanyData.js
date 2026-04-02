import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useRoleBasedData } from "../components/hooks/useRoleBasedData";

export function useCompanyData(options = {}) {
  const {
    enableLeads = false,
    enableCustomers = false,
    enableInvoices = false,
    enableEstimates = false,
    enableProposals = false,
    enableProjects = false,
    enableTasks = false,
    enablePayments = false,
    enableCalendarEvents = false,
    enableStaffProfiles = false,
    enableBuildSchedule = false,
    enableCommunications = false,
    enableInspectionJobs = false,
    enableSubscriptionUsage = false,
    refetchInterval = undefined,
  } = options;

  const {
    user,
    myCompany,
    myStaffProfile,
    isAdmin,
    hasPermission,
    filterLeads,
    filterCustomers,
    filterEstimates,
    filterInvoices,
    filterProposals,
    myRole,
    isDataLoading,
  } = useRoleBasedData();

  const companyId = myCompany?.id;

  const { data: allLeads = [], isLoading: isLoadingLeads } = useQuery({
    queryKey: ['leads', companyId],
    queryFn: () => companyId ? base44.entities.Lead.filter({ company_id: companyId }, "-created_date", 10000) : [],
    initialData: [],
    enabled: enableLeads && !!companyId,
    refetchInterval,
  });

  const { data: allCustomers = [], isLoading: isLoadingCustomers } = useQuery({
    queryKey: ['customers', companyId],
    queryFn: () => companyId ? base44.entities.Customer.filter({ company_id: companyId }, "-created_date", 1000) : [],
    initialData: [],
    enabled: enableCustomers && !!companyId,
  });

  const { data: allInvoices = [], isLoading: isLoadingInvoices } = useQuery({
    queryKey: ['invoices', companyId],
    queryFn: () => companyId ? base44.entities.Invoice.filter({ company_id: companyId }, "-created_date", 1000) : [],
    initialData: [],
    refetchInterval: enableInvoices ? 60000 : undefined,
    refetchOnWindowFocus: true,
    enabled: enableInvoices && !!companyId,
  });

  const { data: allEstimates = [] } = useQuery({
    queryKey: ['estimates', companyId],
    queryFn: () => companyId ? base44.entities.Estimate.filter({ company_id: companyId }, "-created_date", 1000) : [],
    initialData: [],
    enabled: enableEstimates && !!companyId,
  });

  const { data: allProposals = [] } = useQuery({
    queryKey: ['proposals', companyId],
    queryFn: () => companyId ? base44.entities.Proposal.filter({ company_id: companyId }, "-created_date", 1000) : [],
    initialData: [],
    enabled: enableProposals && !!companyId,
  });

  const { data: allProjects = [] } = useQuery({
    queryKey: ['projects', companyId],
    queryFn: () => companyId ? base44.entities.Project.filter({ company_id: companyId }, "-created_date", 1000) : [],
    initialData: [],
    enabled: enableProjects && !!companyId,
  });

  const { data: allTasks = [], refetch: refetchTasks } = useQuery({
    queryKey: ['tasks', companyId],
    queryFn: async () => {
      if (!companyId) return [];
      return await base44.entities.Task.filter({ company_id: companyId }, "-updated_date", 1000);
    },
    initialData: [],
    refetchOnWindowFocus: true,
    enabled: enableTasks && !!companyId,
  });

  const { data: allPayments = [] } = useQuery({
    queryKey: ['payments', companyId],
    queryFn: () => companyId ? base44.entities.Payment.filter({ company_id: companyId }, "-payment_date", 1000) : [],
    initialData: [],
    enabled: enablePayments && !!companyId,
  });

  const { data: calendarEvents = [], isFetching: isCalendarFetching } = useQuery({
    queryKey: ['calendar-events-dashboard', companyId],
    queryFn: async () => {
      if (!companyId) return [];
      return await base44.entities.CalendarEvent.filter({ company_id: companyId }, "-start_time", 500);
    },
    enabled: enableCalendarEvents && !!companyId,
    initialData: [],
    refetchInterval: 30000,
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', companyId],
    queryFn: () => companyId ? base44.entities.StaffProfile.filter({ company_id: companyId }, "-created_date", 1000) : [],
    initialData: [],
    enabled: enableStaffProfiles && !!companyId,
  });

  const { data: buildScheduleItems = [] } = useQuery({
    queryKey: ['build-schedule', companyId],
    queryFn: () => companyId ? base44.entities.BuildSchedule.filter({ company_id: companyId }, '-build_date', 500) : [],
    initialData: [],
    enabled: enableBuildSchedule && !!companyId,
  });

  const { data: allCommunications = [] } = useQuery({
    queryKey: ['communications', companyId],
    queryFn: () => companyId ? base44.entities.Communication.filter({ company_id: companyId }, "-created_date", 50) : [],
    initialData: [],
    enabled: enableCommunications && !!companyId,
  });

  const { data: inspectionJobs = [] } = useQuery({
    queryKey: ['inspection-jobs-dashboard', companyId],
    queryFn: () => companyId ? base44.entities.InspectionJob.filter({ company_id: companyId }, '-created_date', 200) : [],
    initialData: [],
    enabled: enableInspectionJobs && !!companyId,
  });

  const { data: subscriptionUsage = [] } = useQuery({
    queryKey: ['subscription-usage', companyId],
    queryFn: () => companyId ? base44.entities.SubscriptionUsage.filter({ company_id: companyId }) : [],
    initialData: [],
    enabled: enableSubscriptionUsage && !!companyId,
  });

  const customers = useMemo(() => {
    if (!enableCustomers) return [];
    return filterCustomers(allCustomers);
  }, [allCustomers, filterCustomers, enableCustomers]);

  const leads = useMemo(() => {
    if (!enableLeads) return [];
    if (!user?.email) return allLeads;
    if (typeof filterLeads === 'function') {
      return filterLeads(allLeads) || [];
    }
    if (isAdmin || hasPermission('leads', 'view_global') || hasPermission('leads', 'view_all')) return allLeads;
    if (!hasPermission('leads', 'view')) return [];
    return allLeads.filter(lead =>
      lead.assigned_to === user.email ||
      lead.assigned_to_users?.includes(user.email)
    );
  }, [allLeads, filterLeads, isAdmin, user?.email, myRole, hasPermission, enableLeads]);

  const invoices = useMemo(() => {
    if (!enableInvoices) return [];
    return filterInvoices(allInvoices, customers);
  }, [allInvoices, customers, filterInvoices, enableInvoices]);

  const estimates = useMemo(() => {
    if (!enableEstimates) return [];
    return filterEstimates(allEstimates, customers);
  }, [allEstimates, customers, filterEstimates, enableEstimates]);

  const proposals = useMemo(() => {
    if (!enableProposals) return [];
    return filterProposals(allProposals, customers);
  }, [allProposals, customers, filterProposals, enableProposals]);

  const projects = useMemo(() => {
    if (!enableProjects) return [];
    if (!user?.email) return allProjects;
    if (isAdmin || hasPermission('projects', 'view_global') || hasPermission('projects', 'view_all')) return allProjects;
    if (!hasPermission('projects', 'view')) return [];
    return allProjects.filter(proj =>
      proj.team_members?.includes(user.email) || proj.created_by === user.email
    );
  }, [allProjects, isAdmin, user?.email, myRole, hasPermission, enableProjects]);

  const tasks = useMemo(() => {
    if (!enableTasks) return [];
    if (!user?.email) return allTasks;
    if (isAdmin || hasPermission('tasks', 'view_global') || hasPermission('tasks', 'view_all')) return allTasks;
    if (!hasPermission('tasks', 'view')) return [];
    return allTasks.filter(task =>
      task.assigned_to === user.email ||
      task.assignees?.some(a => a.email === user.email)
    );
  }, [allTasks, isAdmin, user?.email, myRole, hasPermission, enableTasks]);

  const payments = useMemo(() => {
    if (!enablePayments) return [];
    if (!user?.email) return allPayments;
    if (isAdmin || hasPermission('payments', 'view_global') || hasPermission('payments', 'view_all')) return allPayments;
    const userInvoiceIds = invoices.map(inv => inv.id);
    return allPayments.filter(pay => userInvoiceIds.includes(pay.invoice_id));
  }, [allPayments, isAdmin, user?.email, invoices, myRole, hasPermission, enablePayments]);

  const filteredBuildScheduleItems = useMemo(() => {
    if (!enableBuildSchedule || !buildScheduleItems.length) return [];
    if (isAdmin || hasPermission('build_schedule', 'view_global')) return buildScheduleItems;
    const myName = myStaffProfile?.full_name || user?.name;
    const myEmail = user?.email;
    return buildScheduleItems.filter(b => {
      const assigned = Array.isArray(b.assigned_to)
        ? b.assigned_to
        : (b.assigned_to ? [b.assigned_to] : []);
      if (assigned.length === 0) return true;
      return assigned.some(a => a === myName || a === myEmail);
    });
  }, [buildScheduleItems, isAdmin, myStaffProfile, user, hasPermission, enableBuildSchedule]);

  const allCompanyTasks = useMemo(() => {
    if (!enableTasks) return [];
    if (isAdmin || hasPermission('tasks', 'view_global')) return allTasks;
    return tasks;
  }, [allTasks, tasks, isAdmin, hasPermission, enableTasks]);

  return {
    user,
    myCompany,
    myStaffProfile,
    isAdmin,
    hasPermission,
    myRole,
    isDataLoading,
    companyId,

    allLeads,
    leads,
    isLoadingLeads,

    allCustomers,
    customers,
    isLoadingCustomers,

    allInvoices,
    invoices,
    isLoadingInvoices,

    allEstimates,
    estimates,

    allProposals,
    proposals,

    allProjects,
    projects,

    allTasks,
    tasks,
    allCompanyTasks,
    refetchTasks,

    allPayments,
    payments,

    calendarEvents,
    isCalendarFetching,

    staffProfiles,

    buildScheduleItems,
    filteredBuildScheduleItems,

    allCommunications,

    inspectionJobs,

    subscriptionUsage,

    filterLeads,
    filterCustomers,
    filterEstimates,
    filterInvoices,
    filterProposals,
  };
}
