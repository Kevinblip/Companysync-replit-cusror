import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompanyData } from "@/hooks/useCompanyData";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import SaaSAdminDashboard from "./SaaSAdminDashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  FileText,
  TrendingUp,
  Briefcase,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Settings,
  Sparkles,
  ArrowRight,
  Brain,
  Zap,
  Target,
  AlertCircle,
  Calendar as CalendarIcon,
  Clock,
  X,
  Trophy,
  Award,
  GripVertical,
  Plus,
  Edit,
  Trash2,
  Loader2,
  Save,
  Activity,
  Users,
  CheckCircle2,
  LogOut,
  Camera,
  Phone,
  UserPlus,
  MapPin,
} from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek } from "date-fns";
import { BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from 'sonner';
import { DashboardSkeleton } from "@/components/PageSkeleton";
import useTranslation from "@/hooks/useTranslation";
import { useDashboardPrefetch } from "@/hooks/useFastQuery";
import { useImpersonation } from "@/lib/ImpersonationContext";
import SmallMetricCard from "@/components/shared/SmallMetricCard";
import EventFormDialog, { getColorForEventType } from "@/components/shared/EventFormDialog";
import EventDetailDialog from "@/components/shared/EventDetailDialog";
import {
  getUnpaidInvoices,
  getOverdueInvoices,
  calcOutstandingAmount,
  calcOverdueAmount,
  calcThisYearRevenue,
  calcTotalRevenue,
  filterByYear,
  calcInvoiceStats,
  calcEstimateStats,
  calcProposalStats,
  calcLeadsData,
  calcProjectsData,
  calcOutstandingByCustomer,
  calcCriticalTasks,
  calcLast7DaysPayments,
  calcStaffCommissions,
  calcTaskHealthScore,
  calcAiRecommendations,
  getAvailableYears,
} from "@/utils/dashboardCalculations";

export default function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  const {
    user,
    myCompany,
    myStaffProfile,
    isAdmin,
    hasPermission,
    myRole,
    isDataLoading,
    companyId,
    leads,
    customers,
    invoices,
    allInvoices,
    estimates,
    proposals,
    projects,
    allProjects,
    tasks,
    allTasks,
    allCompanyTasks,
    payments,
    allPayments,
    calendarEvents,
    isCalendarFetching,
    staffProfiles,
    filteredBuildScheduleItems,
    allCommunications,
    inspectionJobs,
    subscriptionUsage,
    refetchTasks,
    isLoadingInvoices,
    isLoadingCustomers,
  } = useCompanyData({
    enableLeads: true,
    enableCustomers: true,
    enableInvoices: true,
    enableEstimates: true,
    enableProposals: true,
    enableProjects: true,
    enableTasks: true,
    enablePayments: true,
    enableCalendarEvents: true,
    enableStaffProfiles: true,
    enableBuildSchedule: true,
    enableCommunications: true,
    enableInspectionJobs: true,
    enableSubscriptionUsage: true,
  });

  useDashboardPrefetch(companyId);

  const [darkMode, setDarkMode] = useState(false);

  const toggleDarkMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    if (newMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('dashboardDarkMode', newMode.toString());
  };

  useEffect(() => {
    const saved = localStorage.getItem('dashboardDarkMode');
    if (saved === 'true') {
      setDarkMode(true);
      document.documentElement.classList.add('dark');
    } else if (saved === 'false') {
      setDarkMode(false);
      document.documentElement.classList.remove('dark');
    } else {
      // Default to light mode for better readability
      setDarkMode(false);
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showWidgetPanel, setShowWidgetPanel] = useState(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showEventDialog, setShowEventDialog] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showDayEvents, setShowDayEvents] = useState(false);
  const [buildsOpen, setBuildsOpen] = useState(true);
  const [inspectionsOpen, setInspectionsOpen] = useState(true);
  const [dayEventsList, setDayEventsList] = useState([]);

  const [eventFormData, setEventFormData] = useState({
    title: "",
    description: "",
    start_time: "",
    end_time: "",
    event_type: "meeting",
    color: getColorForEventType("meeting"),
    location: "",
    add_google_meet: false,
  });

  const DEFAULT_WIDGET_VISIBILITY = {
    revenueMetrics: true,
    salesPipelineValue: true,
    estimateOverview: true,
    leadsOverview: true,
    staleLeadsAlert: true,
    draftEstimatesAlert: true,
    projectStatus: true,
    calendar: true,
    invoicesNeedingFollowUp: true,
    criticalJobsPending: true,
    pendingInstallsRepairs: true,
    estimatesExpiringSoon: true,
    aiTaskHealth: true,
    workflowMonitor: true,
    aiRecommendations: true,
    recentActivity: true,
    conversionMetrics: true,
    topPerformers: true,
    usageCredits: true,
    buildSchedule: true,
  };

  const DEFAULT_WIDGET_ORDER = [
    'usageCredits',
    'salesPipelineValue',
    'staleLeadsAlert',
    'draftEstimatesAlert',
    'aiTaskHealth',
    'aiRecommendations',
    'revenueMetrics',
    'conversionMetrics',
    'calendar',
    'invoicesNeedingFollowUp',
    'estimateOverview',
    'criticalJobsPending',
    'pendingInstallsRepairs',
    'workflowMonitor',
    'topPerformers',
    'leadsOverview',
    'projectStatus',
    'buildSchedule',
    'recentActivity'
  ];

  const [visibleWidgets, setVisibleWidgets] = useState(DEFAULT_WIDGET_VISIBILITY);
  const [widgetOrder, setWidgetOrder] = useState(DEFAULT_WIDGET_ORDER);

  // Filter widgets that should be displayed in the draggable list
  const draggableWidgets = React.useMemo(() => {
    return widgetOrder.filter(id => visibleWidgets[id] && id !== 'estimateOverview');
  }, [widgetOrder, visibleWidgets]);

  // User fetched via useRoleBasedData

  // 🚀 Auto-signup from marketing site
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const email = params.get('email');
    
    if (email && !user) {
      // User came from marketing site with signup data
      const userData = {
        email: params.get('email'),
        full_name: params.get('name'),
        phone: params.get('phone'),
      };
      
      const companyData = {
        name: params.get('company') || params.get('name'),
        industry: params.get('industry') || 'roofing',
        address: params.get('address'),
        city: params.get('city'),
        state: params.get('state'),
        zip: params.get('zip'),
        team_size: params.get('team_size'),
        plan_type: params.get('plan') || 'professional',
        phone: params.get('company_phone') || params.get('phone')
      };

      // Call backend to create company and invite user
      base44.functions.invoke('autoSignupFromMarketing', { userData, companyData })
        .then(response => {
          if (response.data?.success) {
            toast.success(response.data.message);
            // Clear URL params
            window.history.replaceState({}, document.title, window.location.pathname);
          } else {
            toast.error(response.data?.error || 'Signup failed');
          }
        })
        .catch(error => {
          console.error('Auto-signup error:', error);
          toast.error('Failed to create account. Please try again.');
        });
    }
  }, [user]);

  // 🚀 Auto-redirect new users (no company) to QuickSetup wizard
  // Uses isDataLoading from useRoleBasedData to wait for queries to complete
  useEffect(() => {
    // Don't check until data has finished loading
    if (isDataLoading) return;
    if (!user) return;
    // Never redirect CompanySync admins or platform owners
    if (user?.platform_role === 'super_admin') return;
    // Never redirect if company already exists (even if setup not "completed")
    if (myCompany) return;
    // Never redirect if user has a staff profile (they belong to someone's company)
    if (myStaffProfile) return;
    // Only redirect truly new users with no company and no staff profile
    const alreadySkipped = localStorage.getItem('quickSetupCompleted');
    if (!alreadySkipped) {
      navigate(createPageUrl('QuickSetup') + '?new_signup=true');
    }
  }, [isDataLoading, user, myCompany, myStaffProfile, navigate]);

  // 🔥 NEW: Load dashboard settings from database
  const { data: dashboardSettings = [] } = useQuery({
    queryKey: ['dashboard-settings', user?.email],
    queryFn: () => user ? base44.entities.DashboardSettings.filter({ user_email: user.email }) : [],
    enabled: !!user,
    initialData: [],
  });

  const currentSettings = dashboardSettings[0];

  // Load settings from database when available
  useEffect(() => {
    if (currentSettings) {
      if (currentSettings.widget_visibility && typeof currentSettings.widget_visibility === 'object') {
        // Merge saved settings with defaults so new widgets appear (defaults take precedence for new widgets)
        setVisibleWidgets({
          ...DEFAULT_WIDGET_VISIBILITY,
          ...currentSettings.widget_visibility,
          // Force new widgets to be visible
          usageCredits: currentSettings.widget_visibility.usageCredits !== false ? true : false
        });
      }
      if (currentSettings.widget_order && Array.isArray(currentSettings.widget_order)) {
        // Add new widgets to the top of saved order, and ensure uniqueness to prevent key collision crashes
        const savedOrder = [...new Set(currentSettings.widget_order)]; // Deduplicate saved order
        const newWidgets = DEFAULT_WIDGET_ORDER.filter(w => !savedOrder.includes(w));
        // Make sure usageCredits is at the top
        let finalOrder = newWidgets.includes('usageCredits') 
          ? [...newWidgets, ...savedOrder]
          : ['usageCredits', ...savedOrder.filter(w => w !== 'usageCredits')];
        // Migrate: ensure salesPipelineValue always comes before aiTaskHealth and workflowMonitor
        const spvIdx = finalOrder.indexOf('salesPipelineValue');
        const taskIdx = Math.min(
          ...[finalOrder.indexOf('aiTaskHealth'), finalOrder.indexOf('workflowMonitor')].filter(i => i >= 0)
        );
        if (spvIdx > taskIdx && taskIdx >= 0 && spvIdx >= 0) {
          finalOrder = finalOrder.filter(w => w !== 'salesPipelineValue');
          finalOrder.splice(taskIdx, 0, 'salesPipelineValue');
        }
        setWidgetOrder(finalOrder);
      }
    }
  }, [currentSettings]);

  // 🔥 NEW: Save dashboard settings mutation
  const saveDashboardSettingsMutation = useMutation({
    mutationFn: async () => {
      const settingsData = {
        user_email: user.email,
        widget_visibility: visibleWidgets,
        widget_order: widgetOrder
      };

      if (currentSettings) {
        return await base44.entities.DashboardSettings.update(currentSettings.id, settingsData);
      } else {
        return await base44.entities.DashboardSettings.create(settingsData);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-settings'] });
      setHasUnsavedChanges(false);
      toast.success('Dashboard layout saved!');
    },
    onError: (error) => {
      toast.error(`Failed to save layout: ${error.message}`);
    }
  });

  // Data fetching and role-based filtering handled by useCompanyData hook above

  const createEventMutation = useMutation({
    mutationFn: async (data) => {
      const event = await base44.entities.CalendarEvent.create({
        ...data,
        company_id: myCompany?.id,
        color: getColorForEventType(data.event_type),
      });

      if (myCompany?.id && user?.email) {
        try {
          await base44.entities.Notification.create({
            company_id: myCompany.id,
            user_email: user.email,
            title: '📅 New Event Scheduled',
            message: `${event.title} - ${format(new Date(event.start_time), 'MMM d, h:mm a')}`,
            type: 'general',
            related_entity_type: 'CalendarEvent',
            related_entity_id: event.id,
            link_url: '/calendar',
            is_read: false
          });
        } catch (error) {
          console.error('Failed to create notification:', error);
        }
      }

      if (myCompany?.id) {
        try {
          await base44.functions.invoke('executeWorkflow', {
            triggerType: 'appointment_created',
            entityType: 'CalendarEvent',
            entityId: event.id,
            entityData: event,
            companyId: myCompany.id
          });
        } catch (error) {
          console.error('Workflow trigger error:', error);
        }
      }

      return event;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-events-dashboard'] }); // ✅ Refresh Dashboard calendar
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setShowEventDialog(false);
      setEditingEvent(null);
      setEventFormData({
        title: "",
        description: "",
        start_time: "",
        end_time: "",
        event_type: "meeting",
        color: getColorForEventType("meeting"),
        location: "",
        add_google_meet: false,
      });
    },
  });

  const updateEventMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.CalendarEvent.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-events-dashboard'] }); // ✅ Refresh Dashboard calendar
      setShowEventDialog(false);
      setEditingEvent(null);
      setSelectedEvent(null);
      setEventFormData({
        title: "",
        description: "",
        start_time: "",
        end_time: "",
        event_type: "meeting",
        color: getColorForEventType("meeting"),
        location: "",
        add_google_meet: false,
      });
    },
  });

  const deleteEventMutation = useMutation({
    mutationFn: (id) => base44.entities.CalendarEvent.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      setSelectedEvent(null);
    },
  });

  const deletePaymentMutation = useMutation({
    mutationFn: async (paymentId) => {
      const payment = payments.find(p => p.id === paymentId);
      if (!payment) throw new Error("Payment not found");

      if (payment.invoice_number) {
        const invoice = invoices.find(inv => inv.invoice_number === payment.invoice_number);
        if (invoice) {
          const newAmountPaid = Math.max(0, (invoice.amount_paid || 0) - payment.amount);
          let newStatus = 'sent';
          if (newAmountPaid === 0) {
            newStatus = 'sent';
          } else if (newAmountPaid < invoice.amount) {
            newStatus = 'partially_paid';
          } else {
            newStatus = 'paid';
          }
          await base44.entities.Invoice.update(invoice.id, {
            amount_paid: newAmountPaid,
            status: newStatus
          });
        }
      }
      await base44.entities.Payment.delete(paymentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Payment deleted successfully!');
    },
    onError: (error) => {
      toast.error('Failed to delete payment: ' + error.message);
    }
  });

  const currentYear = new Date().getFullYear();
  const availableYears = React.useMemo(() => getAvailableYears(invoices, currentYear), [invoices, currentYear]);

  const yearFilteredInvoices = React.useMemo(() => filterByYear(invoices, 'issue_date', selectedYear), [invoices, selectedYear]);
  const paidInvoicesArray = yearFilteredInvoices.filter(i => i.status === 'paid');
  const yearFilteredEstimates = React.useMemo(() => filterByYear(estimates, 'created_date', selectedYear), [estimates, selectedYear]);
  const yearFilteredProposals = React.useMemo(() => filterByYear(proposals, 'created_date', selectedYear), [proposals, selectedYear]);
  const yearFilteredPayments = React.useMemo(() => filterByYear(payments, 'payment_date', selectedYear), [payments, selectedYear]);
  const yearFilteredLeads = React.useMemo(() => filterByYear(leads, 'created_date', selectedYear), [leads, selectedYear]);

  const allUnpaidInvoices = React.useMemo(() => getUnpaidInvoices(invoices), [invoices]);
  const allOverdueInvoices = React.useMemo(() => getOverdueInvoices(invoices), [invoices]);
  const outstandingAmount = React.useMemo(() => calcOutstandingAmount(invoices), [invoices]);
  const overdueAmount = React.useMemo(() => calcOverdueAmount(allOverdueInvoices), [allOverdueInvoices]);
  const thisYearRevenue = React.useMemo(() => calcThisYearRevenue(payments, currentYear), [payments, currentYear]);
  const totalRevenue = React.useMemo(() => calcTotalRevenue(paidInvoicesArray), [paidInvoicesArray]);

  const invoicesAwaitingPaymentCount = allUnpaidInvoices.length;
  const convertedLeads = yearFilteredLeads.filter(l => l.status === 'won').length;
  const projectsInProgress = projects.filter(p => p.status === 'in_progress').length;
  const tasksNotFinished = tasks.filter(t => t.status !== 'job_completed' && !t.is_archived).length;

  const invoiceStats = React.useMemo(() => calcInvoiceStats(yearFilteredInvoices), [yearFilteredInvoices]);
  const totalInvoiceCount = yearFilteredInvoices.length;
  const estimateStats = React.useMemo(() => calcEstimateStats(yearFilteredEstimates), [yearFilteredEstimates]);
  const totalEstimateCount = yearFilteredEstimates.length;
  const proposalStats = React.useMemo(() => calcProposalStats(yearFilteredProposals), [yearFilteredProposals]);
  const totalProposalCount = yearFilteredProposals.length;

  const leadsData = React.useMemo(() => calcLeadsData(yearFilteredLeads, convertedLeads), [yearFilteredLeads, convertedLeads]);
  const projectsData = React.useMemo(() => calcProjectsData(projects, projectsInProgress), [projects, projectsInProgress]);

  const outstandingByCustomer = React.useMemo(() => calcOutstandingByCustomer(invoices), [invoices]);
  const criticalTasks = React.useMemo(() => calcCriticalTasks(tasks, outstandingByCustomer), [tasks, outstandingByCustomer]);
  const last7Days = React.useMemo(() => calcLast7DaysPayments(payments), [payments]);

  const getStaffCommissions = React.useCallback(
    () => calcStaffCommissions(staffProfiles, isAdmin, hasPermission, user?.email),
    [staffProfiles, isAdmin, hasPermission, user?.email]
  );

  const topPerformers = React.useMemo(() =>
    (isAdmin || hasPermission('commission_report', 'view_global'))
      ? getStaffCommissions().slice(0, 5)
      : getStaffCommissions(),
    [isAdmin, hasPermission, getStaffCommissions]
  );

  const taskHealthScore = React.useMemo(() => calcTaskHealthScore(tasks, criticalTasks), [tasks, criticalTasks]);
  const aiRecommendations = React.useMemo(() => calcAiRecommendations(criticalTasks, invoices, leads, estimates), [criticalTasks, invoices, leads, estimates]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  const daysInView = eachDayOfInterval({ start: startDate, end: endDate });

  const getEventsForDay = (date) => {
    return calendarEvents.filter(event => {
      const eventDate = new Date(event.start_time);
      return isSameDay(eventDate, date);
    });
  };

  const recentProjects = projects.slice(0, 5);

  const toggleWidget = (widgetKey) => {
    setVisibleWidgets(prev => ({ ...prev, [widgetKey]: !prev[widgetKey] }));
    setHasUnsavedChanges(true);
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;

    // Reorder the visible list
    const newDraggable = Array.from(draggableWidgets);
    const [reorderedItem] = newDraggable.splice(result.source.index, 1);
    newDraggable.splice(result.destination.index, 0, reorderedItem);

    // Merge back into the full order list preserving positions of hidden items
    const newOrder = [];
    let draggableIdx = 0;
    
    for (const id of widgetOrder) {
      // If this ID is in our draggable list (visible and not excluded)
      if (visibleWidgets[id] && id !== 'estimateOverview') {
        newOrder.push(newDraggable[draggableIdx]);
        draggableIdx++;
      } else {
        // Keep hidden items in their original relative positions
        newOrder.push(id);
      }
    }

    setWidgetOrder(newOrder);
    setHasUnsavedChanges(true);
  };

  const handleResetWidgets = () => {
    setWidgetOrder(DEFAULT_WIDGET_ORDER);
    setVisibleWidgets(DEFAULT_WIDGET_VISIBILITY);
    setHasUnsavedChanges(true);
  };

  const handleSaveLayout = () => {
    saveDashboardSettingsMutation.mutate();
  };

  const handleEventSubmit = (e) => {
    e.preventDefault();
    if (!eventFormData.title || !eventFormData.start_time || !eventFormData.end_time) {
      alert("Please fill in all required fields (Title, Start Time, End Time).");
      return;
    }

    const finalData = {
      ...eventFormData,
      color: eventFormData.color || getColorForEventType(eventFormData.event_type)
    };

    if (editingEvent) {
      updateEventMutation.mutate({ id: editingEvent.id, data: finalData });
    } else {
      createEventMutation.mutate(finalData);
    }
  };

  const handleEditEvent = (event) => {
    setEditingEvent(event);
    setEventFormData({
      title: event.title,
      description: event.description || "",
      start_time: event.start_time ? new Date(event.start_time).toISOString().slice(0, 16) : "",
      end_time: event.end_time ? new Date(event.end_time).toISOString().slice(0, 16) : "",
      event_type: event.event_type || "meeting",
      color: event.color || getColorForEventType(event.event_type || "meeting"),
      location: event.location || "",
      add_google_meet: event.add_google_meet || false,
    });
    setSelectedEvent(null);
    setShowEventDialog(true);
  };

  const handleDeleteEvent = (eventId) => {
    if (confirm('Are you sure you want to delete this event?')) {
      deleteEventMutation.mutate(eventId);
    }
  };

  const handleDayClick = (day) => {
    const startTime = new Date(day);
    startTime.setHours(9, 0, 0, 0);
    const endTime = new Date(day);
    endTime.setHours(10, 0, 0, 0);
    
    setEditingEvent(null);
    setEventFormData({
      title: "",
      description: "",
      start_time: startTime.toISOString().slice(0, 16),
      end_time: endTime.toISOString().slice(0, 16),
      event_type: "meeting",
      color: getColorForEventType("meeting"),
      location: "",
      add_google_meet: false,
    });
    setShowEventDialog(true);
  };

  const renderWidget = (widgetId) => {
    if (!visibleWidgets[widgetId]) return null;

    let content = null;

    switch (widgetId) {
      case 'revenueMetrics':
        // 🔐 Show revenue metrics based on role permissions
        const canViewAllFinancials = isAdmin || hasPermission('invoices', 'view_global') || hasPermission('invoices', 'view_all');
        const revenueLabel = canViewAllFinancials ? t.dashboard.invoicesAwaitingPayment : `My ${t.dashboard.invoicesAwaitingPayment}`;
        const yearLabel = canViewAllFinancials ? `${t.common.paid} ${t.invoices.title} (${selectedYear})` : `My ${t.common.paid} ${t.invoices.title} (${selectedYear})`;
        const thisYearLabel = canViewAllFinancials ? `This Year ${t.dashboard.revenue} (${new Date().getFullYear()})` : `My ${t.dashboard.revenue} (${new Date().getFullYear()})`;
        
        content = (
          <div className="lg:col-span-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Card className={`border-l-4 ${darkMode ? 'border-l-amber-400 bg-slate-800 border-slate-700' : 'border-l-amber-300'}`}>
                <CardContent className="p-2">
                  <div className={`text-sm ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>{revenueLabel}</div>
                  <div className={`text-lg font-bold mt-0.5 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                    ${outstandingAmount.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}
                  </div>
                </CardContent>
              </Card>

              <Card className={`border-l-4 ${darkMode ? 'border-l-rose-400 bg-slate-800 border-slate-700' : 'border-l-rose-300'}`}>
                <CardContent className="p-2">
                  <div className={`text-sm ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>{canViewAllFinancials ? t.dashboard.overdueInvoices : `My ${t.dashboard.overdueInvoices}`}</div>
                  <div className={`text-lg font-bold mt-0.5 ${darkMode ? 'text-rose-400' : 'text-rose-600'}`}>
                    ${overdueAmount.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}
                  </div>
                </CardContent>
              </Card>

              <Card className={`border-l-4 ${darkMode ? 'border-l-teal-400 bg-slate-800 border-slate-700' : 'border-l-teal-300'}`}>
                <CardContent className="p-2">
                  <div className={`text-sm ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>{yearLabel}</div>
                  <div className={`text-lg font-bold mt-0.5 ${darkMode ? 'text-teal-400' : 'text-teal-600'}`}>
                    ${totalRevenue.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}
                  </div>
                </CardContent>
              </Card>

              <Card className={`border-l-4 ${darkMode ? 'border-l-blue-400 bg-slate-800 border-slate-700' : 'border-l-blue-300'}`}>
                <CardContent className="p-2">
                  <div className={`text-sm ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>{thisYearLabel}</div>
                  <div className={`text-lg font-bold mt-0.5 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                    ${thisYearRevenue.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        );
        break;



      case 'estimateOverview':
        // Estimate Overview now rendered above, skip in draggable widgets
        content = null;
        break;



      case 'leadsOverview':
        content = (
          <>
            <CardHeader>
              <div className="flex items-center gap-2">
                <GripVertical className="w-4 h-4 text-gray-400 cursor-move" />
                <CardTitle className="text-base">{t.leads.title} Overview</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={leadsData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {leadsData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-2">
                {leadsData.map((item) => (
                  <div key={item.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                      <span className="text-gray-600">{item.name}</span>
                    </div>
                    <span className="font-semibold">{item.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </>
        );
        break;

      case 'projectStatus':
        content = (
          <>
            <CardHeader>
              <div className="flex items-center gap-2">
                <GripVertical className="w-4 h-4 text-gray-400 cursor-move" />
                <CardTitle className="text-base">{t.projects.title} {t.common.status}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={projectsData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {projectsData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-2">
                {projectsData.map((item) => (
                  <div key={item.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                      <span className="text-gray-600">{item.name}</span>
                    </div>
                    <span className="font-semibold">{item.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </>
        );
        break;

      case 'calendar':
        const handleCalendarDragEnd = (result) => {
          if (!result.destination) return;

          const eventId = result.draggableId;
          const event = calendarEvents.find(e => e.id === eventId);
          if (!event) return;

          const newDateStr = result.destination.droppableId.replace('cal-day-', '');
          const [year, month, day] = newDateStr.split('-').map(Number);
          
          const oldStartTime = new Date(event.start_time);
          const newStartTime = new Date(year, month - 1, day, oldStartTime.getHours(), oldStartTime.getMinutes(), 0, 0);
          
          let newEndTime;
          if (event.end_time) {
            const oldEndTime = new Date(event.end_time);
            const duration = oldEndTime.getTime() - oldStartTime.getTime();
            newEndTime = new Date(newStartTime.getTime() + duration);
          } else {
            newEndTime = new Date(newStartTime.getTime() + (60 * 60 * 1000));
          }

          updateEventMutation.mutate({
            id: eventId,
            data: {
              start_time: newStartTime.toISOString(),
              end_time: newEndTime.toISOString(),
            }
          });
        };

        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader className={`border-b pb-2 ${darkMode ? 'border-slate-700' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GripVertical className={`w-4 h-4 cursor-move ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                  <CardTitle className={`flex items-center gap-2 text-sm font-semibold ${darkMode ? 'text-white' : ''}`}>
                    <CalendarIcon className="w-4 h-4" />
                    {format(currentMonth, 'MMMM yyyy')}
                  </CardTitle>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                    <ChevronLeft className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                    <ChevronRight className="w-3 h-3" />
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setEditingEvent(null);
                      const now = new Date();
                      const defaultStartTime = new Date(now.getTime() + 5 * 60 * 1000);
                      const defaultEndTime = new Date(defaultStartTime.getTime() + 60 * 60 * 1000);
                      setEventFormData({
                        title: "",
                        description: "",
                        start_time: defaultStartTime.toISOString().slice(0, 16),
                        end_time: defaultEndTime.toISOString().slice(0, 16),
                        event_type: "meeting",
                        color: getColorForEventType("meeting"),
                        location: "",
                        add_google_meet: false,
                      });
                      setShowEventDialog(true);
                    }}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    {t.common.add}
                  </Button>
                  <Button variant="link" size="sm" className="h-7 text-xs" onClick={() => navigate(createPageUrl('Calendar'))}>
                    {t.dashboard.viewAll}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isCalendarFetching && (<div className="p-2 text-xs text-gray-500">{t.common.loading}</div>) }
              <div className={`grid grid-cols-7 border-b ${darkMode ? 'bg-slate-900 border-slate-700' : 'bg-gray-50'}`}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className={`p-2 text-center text-xs font-semibold ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>
                    {day}
                  </div>
                ))}
              </div>
              <DragDropContext onDragEnd={handleCalendarDragEnd}>
                <div className="grid grid-cols-7">
                  {daysInView.map((day, i) => {
                    const dayEvents = getEventsForDay(day);
                    const isToday = isSameDay(day, new Date());
                    const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
                    const dayId = `cal-day-${format(day, 'yyyy-MM-dd')}`;

                    return (
                      <Droppable key={dayId} droppableId={dayId}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={`min-h-[80px] p-1.5 border-r border-b ${darkMode ? 'border-slate-700' : ''} ${
                              isToday ? (darkMode ? 'bg-blue-900/40' : 'bg-blue-50') : isCurrentMonth ? (darkMode ? 'bg-slate-800' : 'bg-white') : (darkMode ? 'bg-slate-900' : 'bg-gray-50')
                            } ${snapshot.isDraggingOver ? (darkMode ? 'bg-blue-800/40' : 'bg-blue-100') : ''} ${darkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'} transition-colors cursor-pointer`}
                            onClick={() => handleDayClick(day)}
                          >
                            <div className={`text-xs font-medium mb-0.5 ${
                              isToday ? (darkMode ? 'text-blue-400 font-bold' : 'text-blue-600 font-bold') : isCurrentMonth ? (darkMode ? 'text-slate-300' : 'text-gray-700') : (darkMode ? 'text-slate-600' : 'text-gray-400')
                            }`}>
                              {format(day, 'd')}
                            </div>
                            <div className="space-y-1">
                              {dayEvents.slice(0, 2).map((event, index) => (
                                <Draggable key={event.id} draggableId={event.id} index={index}>
                                  {(provided, snapshot) => (
                                    <div
                                      ref={provided.innerRef}
                                      {...provided.draggableProps}
                                      {...provided.dragHandleProps}
                                      className={`text-[9px] px-1 py-0.5 rounded truncate text-white cursor-move hover:opacity-80 ${
                                        snapshot.isDragging ? 'opacity-50 shadow-lg' : ''
                                      }`}
                                      style={{ 
                                        backgroundColor: event.color || getColorForEventType(event.event_type),
                                        ...provided.draggableProps.style
                                      }}
                                      title={event.title}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedEvent(event);
                                      }}
                                    >
                                      {event.title}
                                    </div>
                                  )}
                                </Draggable>
                              ))}
                              {dayEvents.length > 2 && (
                                <div 
                                  className="text-[9px] text-gray-500 px-1 cursor-pointer hover:underline"
                                  onClick={(e) => {
                                      e.stopPropagation();
                                      setDayEventsList(dayEvents);
                                      setShowDayEvents(true);
                                    }}
                                >
                                  +{dayEvents.length - 2} {t.dashboard.viewAll.toLowerCase()}
                                </div>
                              )}
                            </div>
                            {provided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    );
                  })}
                </div>
                </DragDropContext>
                </CardContent>
                </Card>
                );
                break;

      case 'staleLeadsAlert': {
        const staleLeads = leads.filter(lead => {
          const isNew = (lead.status || '').toLowerCase() === 'new';
          if (!isNew) return false;
          const createdAt = new Date(lead.created_at || lead.synced_at);
          return (Date.now() - createdAt.getTime()) > 24 * 60 * 60 * 1000;
        });

        content = (
          <Card
            className={`border-l-4 ${staleLeads.length > 0 ? 'border-l-orange-500' : 'border-l-green-500'} ${darkMode ? 'bg-slate-800 border-slate-700' : ''}`}
            data-testid="widget-stale-leads-alert"
          >
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move flex-shrink-0 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <div className="flex items-center justify-between flex-1">
                  <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <AlertCircle className={`w-4 h-4 ${staleLeads.length > 0 ? 'text-orange-500' : 'text-green-500'}`} />
                    Stale Leads — Need Attention
                    {staleLeads.length > 0 && (
                      <Badge className="bg-orange-100 text-orange-700 border-orange-300 text-xs ml-1" data-testid="stale-leads-count">
                        {staleLeads.length}
                      </Badge>
                    )}
                  </CardTitle>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => navigate(createPageUrl('Leads'))}
                    className={`h-auto p-0 text-xs ${darkMode ? 'text-blue-400' : ''}`}
                  >
                    View Leads
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {staleLeads.length === 0 ? (
                <div className={`text-center py-4 ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-70" />
                  <p className="font-semibold text-sm">All leads are being handled!</p>
                  <p className={`text-xs mt-1 ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>No leads stuck in New status over 24 hours.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className={`text-xs mb-2 ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    These leads have been in <strong>New</strong> status for over 24 hours:
                  </p>
                  {staleLeads.slice(0, 5).map(lead => {
                    const hoursOld = Math.floor((Date.now() - new Date(lead.created_at || lead.synced_at).getTime()) / (1000 * 60 * 60));
                    return (
                      <div
                        key={lead.id}
                        className={`flex items-center justify-between text-sm p-2 rounded cursor-pointer ${darkMode ? 'hover:bg-slate-700' : 'hover:bg-orange-50'}`}
                        onClick={() => navigate(createPageUrl('Leads') + '?id=' + lead.id)}
                        data-testid={`stale-lead-row-${lead.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium text-xs truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>{lead.name || 'Unknown Lead'}</p>
                          <p className={`text-xs ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{lead.phone || lead.email || 'No contact'}</p>
                        </div>
                        <Badge variant="outline" className="bg-orange-100 text-orange-700 border-orange-300 text-xs whitespace-nowrap ml-2">
                          {hoursOld}h old
                        </Badge>
                      </div>
                    );
                  })}
                  {staleLeads.length > 5 && (
                    <p className={`text-xs text-center pt-1 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>
                      +{staleLeads.length - 5} more stale leads
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
        break;
      }

      case 'draftEstimatesAlert': {
        const draftEstimates = estimates.filter(e => (e.status || '').toLowerCase() === 'draft');

        content = (
          <Card
            className={`border-l-4 ${draftEstimates.length > 0 ? 'border-l-blue-500' : 'border-l-green-500'} ${darkMode ? 'bg-slate-800 border-slate-700' : ''}`}
            data-testid="widget-draft-estimates-alert"
          >
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move flex-shrink-0 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <div className="flex items-center justify-between flex-1">
                  <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <FileText className={`w-4 h-4 ${draftEstimates.length > 0 ? 'text-blue-500' : 'text-green-500'}`} />
                    Unsent Draft Estimates
                    {draftEstimates.length > 0 && (
                      <Badge className="bg-blue-100 text-blue-700 border-blue-300 text-xs ml-1" data-testid="draft-estimates-count">
                        {draftEstimates.length}
                      </Badge>
                    )}
                  </CardTitle>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => navigate(createPageUrl('Estimates'))}
                    className={`h-auto p-0 text-xs ${darkMode ? 'text-blue-400' : ''}`}
                  >
                    View All
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {draftEstimates.length === 0 ? (
                <div className={`text-center py-4 ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-70" />
                  <p className="font-semibold text-sm">No unsent drafts!</p>
                  <p className={`text-xs mt-1 ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>All estimates have been sent to customers.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className={`text-xs mb-2 ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    <strong>{draftEstimates.length}</strong> estimate{draftEstimates.length !== 1 ? 's are' : ' is'} still in Draft — send them to win more jobs!
                  </p>
                  {draftEstimates.slice(0, 5).map(est => (
                    <div
                      key={est.id}
                      className={`flex items-center justify-between text-sm p-2 rounded cursor-pointer ${darkMode ? 'hover:bg-slate-700' : 'hover:bg-blue-50'}`}
                      onClick={() => navigate(createPageUrl('Estimates') + '?id=' + est.id)}
                      data-testid={`draft-estimate-row-${est.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium text-xs truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>{est.customer_name || 'Unknown Customer'}</p>
                        <p className={`text-xs ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{est.title || est.estimate_number || 'Draft Estimate'}</p>
                      </div>
                      <div className="text-right ml-2">
                        <p className={`font-bold text-xs ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>${Number(est.total || est.amount || 0).toFixed(0)}</p>
                        <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200 text-xs">Draft</Badge>
                      </div>
                    </div>
                  ))}
                  {draftEstimates.length > 5 && (
                    <p className={`text-xs text-center pt-1 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>
                      +{draftEstimates.length - 5} more drafts waiting
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
        break;
      }

      case 'invoicesNeedingFollowUp':
        const overdueInvoices = invoices.filter(inv => {
          if (inv.status === 'paid' || inv.status === 'cancelled') return false;
          if (!inv.due_date) return false;
          const dueDate = new Date(inv.due_date);
          dueDate.setHours(0, 0, 0, 0);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          return dueDate < today;
        }).sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

        const partiallyPaidInvoices = invoices.filter(inv => 
          inv.status === 'partially_paid'
        );

        const combinedFollowUp = [...overdueInvoices, ...partiallyPaidInvoices];
        const allFollowUpInvoices = Array.from(
          new Map(combinedFollowUp.map(inv => [inv.id, inv])).values()
        );

        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move flex-shrink-0 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <div className="flex items-center justify-between flex-1">
                  <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <span className={darkMode ? 'text-red-400' : 'text-red-600'}>⚠️</span>
                    {t.dashboard.invoicesAwaitingPayment} ({allFollowUpInvoices.length})
                  </CardTitle>
                  <Button variant="link" size="sm" onClick={() => navigate(createPageUrl('Invoices'))} className={`h-auto p-0 text-xs ${darkMode ? 'text-blue-400' : ''}`}>
                    {t.dashboard.viewAll}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {allFollowUpInvoices.slice(0, 5).map((invoice) => {
                const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;
                const today = new Date();
                const daysPastDue = dueDate ? Math.floor((today - dueDate) / (1000 * 60 * 60 * 24)) : 0;
                const remaining = (invoice.amount || 0) - (invoice.amount_paid || 0);

                return (
                  <div 
                    key={invoice.id} 
                    className={`flex items-start gap-3 text-sm pb-3 border-b last:border-0 cursor-pointer p-2 rounded ${darkMode ? 'border-slate-700 hover:bg-slate-700' : 'hover:bg-gray-50'}`}
                    onClick={() => navigate(createPageUrl('invoice-details') + '?id=' + invoice.id)}
                  >
                    <div className="flex-1">
                      <p className={`font-medium text-xs ${darkMode ? 'text-white' : 'text-gray-900'}`}>{invoice.invoice_number}</p>
                      <p className={`text-xs ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>{invoice.customer_name}</p>
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        {daysPastDue > 0 && (
                          <Badge variant="outline" className="bg-red-100 text-red-700 text-xs">
                            {daysPastDue}d {t.invoices.overdue.toLowerCase()}
                          </Badge>
                        )}
                        {invoice.status === 'partially_paid' && (
                          <Badge variant="outline" className="bg-yellow-100 text-yellow-700 text-xs">
                            {t.invoices.partiallyPaid}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold text-sm ${darkMode ? 'text-red-400' : 'text-red-600'}`}>${remaining.toFixed(0)}</p>
                      <p className={`text-xs ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>due</p>
                    </div>
                  </div>
                );
              })}
              {allFollowUpInvoices.length === 0 && (
                <div className={`text-center py-6 ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
                  <p className="font-semibold text-sm">✓ {t.dashboard.noActivity}!</p>
                  <p className={`text-xs mt-1 ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{t.common.noResults}</p>
                </div>
              )}
            </CardContent>
          </Card>
        );
        break;





      case 'criticalJobsPending':
        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move flex-shrink-0 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <div className="flex items-center justify-between flex-1">
                  <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <span className={darkMode ? 'text-orange-400' : 'text-orange-600'}>⚠️</span>
                    Critical Jobs Pending ({criticalTasks.length})
                  </CardTitle>
                  <Button variant="link" size="sm" onClick={() => navigate(createPageUrl('Tasks'))} className="h-auto p-0 text-xs">
                    {t.dashboard.viewAll}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {criticalTasks.slice(0, 5).map((task) => {
                const daysSinceUpdate = Math.floor((new Date() - new Date(task.updated_date)) / (1000 * 60 * 60 * 24));
                const isOverdue = task.due_date && new Date(task.due_date) < new Date();
                const daysPastDue = task.due_date ? Math.floor((new Date() - new Date(task.due_date)) / (1000 * 60 * 60 * 24)) : 0;

                return (
                  <div 
                    key={task.id} 
                    className="flex items-start gap-3 text-sm pb-3 border-b last:border-0 cursor-pointer hover:bg-gray-50 p-2 rounded"
                    onClick={() => navigate(createPageUrl('Tasks'))}
                  >
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 text-xs">{task.name}</p>
                      {task.related_to && (
                        <p className="text-xs text-gray-600">{task.related_to}</p>
                      )}
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        {isOverdue && (
                          <Badge variant="outline" className="bg-red-100 text-red-700 text-xs">
                            {daysPastDue}d {t.tasks.overdue.toLowerCase()}
                          </Badge>
                        )}
                        {daysSinceUpdate >= 5 && (
                          <Badge variant="outline" className="bg-orange-100 text-orange-700 text-xs">
                            Stuck {daysSinceUpdate}d
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {criticalTasks.length === 0 && (
                <div className="text-center py-6 text-green-600">
                  <p className="font-semibold text-sm">✓ {t.dashboard.noActivity}!</p>
                  <p className="text-xs text-gray-500 mt-1">{t.common.noResults}</p>
                </div>
              )}
            </CardContent>
          </Card>
        );
        break;

      case 'aiTaskHealth':
        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                  <Brain className={`w-4 h-4 ${darkMode ? 'text-purple-400' : 'text-purple-600'}`} />
                  Task Health Monitor
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-center mb-4">
                <div className="relative inline-flex items-center justify-center w-32 h-32">
                  <svg className="w-32 h-32 transform -rotate-90">
                    <circle cx="64" cy="64" r="56" stroke="#e5e7eb" strokeWidth="12" fill="none" />
                    <circle 
                      cx="64" 
                      cy="64" 
                      r="56" 
                      stroke={taskHealthScore.color === 'green' ? '#10b981' : taskHealthScore.color === 'blue' ? '#3b82f6' : taskHealthScore.color === 'yellow' ? '#f59e0b' : '#ef4444'}
                      strokeWidth="12" 
                      fill="none"
                      strokeDasharray={`${(taskHealthScore.score / 100) * 351.7} 351.7`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute text-center">
                    <div className="text-3xl font-bold">{taskHealthScore.score}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{t.dashboard.tasksNotFinished}</div>
                  </div>
                </div>
                <div className="mt-2">
                  <Badge className={`text-xs px-3 py-1 ${
                    taskHealthScore.color === 'green' ? 'bg-green-100 text-green-700' :
                    taskHealthScore.color === 'blue' ? 'bg-blue-100 text-blue-700' :
                    taskHealthScore.color === 'yellow' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {taskHealthScore.status}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                <div 
                  className="text-center p-2 bg-orange-50 rounded-lg cursor-pointer hover:bg-orange-100 transition-all"
                  onClick={() => navigate(createPageUrl('Tasks') + '?filter=critical')}
                >
                  <div className="text-xl font-bold text-orange-600">{criticalTasks.length}</div>
                  <div className="text-xs text-gray-600">{t.tasks.high}</div>
                </div>
                <div 
                  className="text-center p-2 bg-red-50 rounded-lg cursor-pointer hover:bg-red-100 transition-all"
                  onClick={() => navigate(createPageUrl('Tasks') + '?filter=overdue')}
                >
                  <div className="text-xl font-bold text-red-600">
                    {tasks.filter(t => !t.is_archived && t.column !== 'job_completed' && t.column !== 'customer_lost' && t.due_date && new Date(t.due_date) < new Date()).length}
                  </div>
                  <div className="text-xs text-gray-600">{t.tasks.overdue}</div>
                </div>
                <div 
                  className="text-center p-2 bg-blue-50 rounded-lg cursor-pointer hover:bg-blue-100 transition-all"
                  onClick={() => navigate(createPageUrl('Tasks') + '?filter=unassigned')}
                >
                  <div className="text-xl font-bold text-blue-600">
                    {tasks.filter(t => !t.is_archived && t.column !== 'job_completed' && t.column !== 'customer_lost' && !t.assignees?.length && !t.assigned_to).length}
                  </div>
                  <div className="text-xs text-gray-600">{t.common.none}</div>
                </div>
                <div 
                  className="text-center p-2 bg-purple-50 rounded-lg cursor-pointer hover:bg-purple-100 transition-all"
                  onClick={() => navigate(createPageUrl('Tasks') + '?filter=high-priority')}
                >
                  <div className="text-xl font-bold text-purple-600">
                    {tasks.filter(t => !t.is_archived && t.column !== 'job_completed' && t.column !== 'customer_lost' && t.priority === 'high').length}
                  </div>
                  <div className="text-xs text-gray-600">{t.tasks.high} {t.tasks.priority}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
        break;

      case 'workflowMonitor':
        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move flex-shrink-0 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <div className="flex items-center justify-between flex-1">
                  <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <Zap className={`w-4 h-4 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                    Workflow Monitor
                  </CardTitle>
                  <Button variant="link" size="sm" onClick={() => navigate(createPageUrl('Workflows'))} className="h-auto p-0 text-xs">
                    {t.dashboard.viewAll}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div 
                  className="text-center p-2 bg-blue-50 rounded-lg border border-blue-200 cursor-pointer hover:bg-blue-100 transition-colors"
                  onClick={() => navigate(createPageUrl('Workflows'))}
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{t.common.active} {t.sidebar.workflowAutomation}</p>
                    <p className="text-xs text-gray-600">{t.common.loading}</p>
                  </div>
                  <Clock className="w-6 h-6 text-blue-600" />
                </div>
                
                <div 
                  className="text-center p-2 bg-green-50 rounded-lg border border-green-200 cursor-pointer hover:bg-green-100 transition-colors"
                  onClick={() => navigate(createPageUrl('Tasks'))}
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{t.tasks.title} {t.sidebar.reminders}</p>
                    <p className="text-xs text-gray-600">{t.dashboard.today}</p>
                  </div>
                  <Badge className="bg-green-100 text-green-700 text-xs">{t.common.active}</Badge>
                </div>

                <div 
                  className="text-center p-2 bg-purple-50 rounded-lg border border-purple-200 cursor-pointer hover:bg-purple-100 transition-colors"
                  onClick={() => navigate(createPageUrl('Invoices'))}
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{t.invoices.title} {t.sidebar.reminders}</p>
                    <p className="text-xs text-gray-600">{t.dashboard.today}</p>
                  </div>
                  <Badge className="bg-purple-100 text-purple-700 text-xs">{t.common.active}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        );
        break;

      case 'aiRecommendations':
        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                  <Target className={`w-4 h-4 ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`} />
                  AI Recommendations
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {aiRecommendations.map((rec, index) => {
                // Determine navigation target based on recommendation type
                let targetUrl = createPageUrl('Dashboard');
                if (rec.type === 'urgent' && rec.title.includes('Task Backlog')) {
                  targetUrl = createPageUrl('Tasks') + '?filter=critical';
                } else if (rec.type === 'financial' && rec.title.includes('Overdue Invoices')) {
                  targetUrl = createPageUrl('Invoices') + '?status=overdue';
                } else if (rec.type === 'opportunity' && rec.title.includes('Stale Leads')) {
                  targetUrl = createPageUrl('Leads') + '?filter=stale';
                } else if (rec.type === 'sales' && rec.title.includes('Pending Estimates')) {
                  targetUrl = createPageUrl('Estimates') + '?status=sent';
                }

                return (
                  <div 
                    key={index} 
                    onClick={() => navigate(targetUrl)}
                    className={`p-3 rounded-lg border cursor-pointer hover:shadow-md transition-all ${
                      rec.type === 'urgent' ? 'bg-red-50 border-red-200 hover:bg-red-100' :
                      rec.type === 'financial' ? 'bg-amber-50 border-amber-200 hover:bg-amber-100' :
                      rec.type === 'opportunity' ? 'bg-blue-50 border-blue-200 hover:bg-blue-100' :
                      rec.type === 'sales' ? 'bg-purple-50 border-purple-200 hover:bg-purple-100' :
                      'bg-green-50 border-green-200 hover:bg-green-100'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="text-2xl">{rec.icon}</div>
                      <div className="flex-1">
                        <p className="font-medium text-sm text-gray-900">{rec.title}</p>
                        <p className="text-xs text-gray-600 mt-1">{rec.action}</p>
                        <Badge 
                          variant="outline" 
                          className={`mt-2 text-xs ${
                            rec.impact === 'High' ? 'bg-red-100 text-red-700' :
                            rec.impact === 'Medium' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-green-100 text-green-700'
                          }`}
                        >
                          {rec.impact === 'High' ? t.tasks.high : rec.impact === 'Medium' ? t.tasks.medium : t.tasks.low} {t.reports.performance}
                        </Badge>
                      </div>
                      <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
        break;

      case 'pendingInstallsRepairs':
        const installsRepairs = allCompanyTasks.filter(t => {
          // Hide tasks for customers who have no outstanding invoices
          const taskCustomer = (t.related_to || '').trim() || (t.name?.split(' - ').slice(-1)[0]?.trim() || '');
          if (taskCustomer && !(outstandingByCustomer.get(taskCustomer) > 0)) return false;
          // Skip archived and completed tasks
          if (t.is_archived || t.column === 'job_completed') return false;

          // Only check column - any task in these columns shows up
          const installRepairColumns = [
            'col_1761736905255',  // Work Order/Schedule Crew
            'col_1761736905832',  // Order Material
            'col_1764967708839'   // Install Pending
          ];
          
          return installRepairColumns.includes(t.column);
        }).sort((a, b) => {
          // Sort by due date (earliest first)
          if (a.due_date && b.due_date) {
            return new Date(a.due_date) - new Date(b.due_date);
          }
          if (a.due_date) return -1;
          if (b.due_date) return 1;
          return new Date(b.created_date) - new Date(a.created_date);
        });

        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move flex-shrink-0 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <div className="flex items-center justify-between flex-1">
                  <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <span className={darkMode ? 'text-blue-400' : 'text-blue-600'}>🔧</span>
                    Pending Installs & Repairs ({installsRepairs.length})
                  </CardTitle>
                  <Button variant="link" size="sm" onClick={() => navigate(createPageUrl('Tasks'))} className="h-auto p-0 text-xs">
                    {t.dashboard.viewAll}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {installsRepairs.slice(0, 5).map((task) => {
                const isScheduled = task.due_date || task.start_date;
                const scheduledDate = task.due_date || task.start_date;
                const daysUntil = scheduledDate ? Math.floor((new Date(scheduledDate) - new Date()) / (1000 * 60 * 60 * 24)) : null;

                return (
                  <div 
                    key={task.id} 
                    className="flex items-start gap-3 text-sm pb-2 border-b last:border-0 cursor-pointer hover:bg-gray-50 p-2 rounded"
                    onClick={() => navigate(createPageUrl('Tasks'))}
                  >
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 text-xs">{task.name}</p>
                      {task.related_to && (
                        <p className="text-xs text-gray-600">{task.related_to}</p>
                      )}
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        {isScheduled && (
                          <Badge 
                            variant="outline" 
                            className={`text-xs ${
                              daysUntil < 0 ? 'bg-red-100 text-red-700' :
                              daysUntil === 0 ? 'bg-orange-100 text-orange-700' :
                              daysUntil <= 3 ? 'bg-yellow-100 text-yellow-700' :
                              'bg-blue-100 text-blue-700'
                            }`}
                          >
                            {daysUntil < 0 ? `${Math.abs(daysUntil)}d overdue` :
                             daysUntil === 0 ? t.dashboard.today :
                             `${t.common.back} ${daysUntil}d`}
                          </Badge>
                        )}
                        {task.tags && task.tags.length > 0 && (
                          <Badge variant="outline" className="text-xs bg-gray-100">
                            {task.tags[0]}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {installsRepairs.length === 0 && (
                <div className="text-center py-6 text-green-600">
                  <p className="font-semibold text-sm">✓ {t.dashboard.noActivity}!</p>
                  <p className="text-xs text-gray-500 mt-1">{t.common.noResults}</p>
                </div>
              )}
            </CardContent>
          </Card>
        );
        break;

      case 'estimatesExpiringSoon':
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const in7Days = new Date(today);
        in7Days.setDate(in7Days.getDate() + 7);

        const expiringEstimates = estimates.filter(est => {
          if (est.status === 'accepted' || est.status === 'declined' || est.status === 'expired') return false;
          if (!est.valid_until) return false;
          const validUntil = new Date(est.valid_until);
          validUntil.setHours(0, 0, 0, 0);
          return validUntil >= today && validUntil <= in7Days;
        }).sort((a, b) => new Date(a.valid_until) - new Date(b.valid_until));

        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move flex-shrink-0 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <div className="flex items-center justify-between flex-1">
                  <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <span className={darkMode ? 'text-amber-400' : 'text-amber-600'}>⏰</span>
                    Estimates Expiring Soon ({expiringEstimates.length})
                  </CardTitle>
                  <Button variant="link" size="sm" onClick={() => navigate(createPageUrl('Estimates'))} className="h-auto p-0 text-xs">
                    {t.dashboard.viewAll}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {expiringEstimates.slice(0, 5).map((estimate) => {
                const validUntil = new Date(estimate.valid_until);
                validUntil.setHours(0, 0, 0, 0);
                const daysUntilExpiry = Math.floor((validUntil - today) / (1000 * 60 * 60 * 24));

                return (
                  <div 
                    key={estimate.id} 
                    className="flex items-start gap-3 text-sm pb-2 border-b last:border-0 cursor-pointer hover:bg-gray-50 p-2 rounded"
                    onClick={() => navigate(createPageUrl('Estimates'))}
                  >
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 text-xs">{estimate.estimate_number}</p>
                      <p className="text-xs text-gray-600">{estimate.customer_name}</p>
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        <Badge 
                          variant="outline" 
                          className={`text-xs ${
                            daysUntilExpiry === 0 ? 'bg-red-100 text-red-700' :
                            daysUntilExpiry <= 2 ? 'bg-orange-100 text-orange-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}
                        >
                          {daysUntilExpiry === 0 ? t.dashboard.today : `${daysUntilExpiry}d ${t.common.back}`}
                        </Badge>
                        {estimate.status && (
                          <Badge variant="outline" className="text-xs capitalize">
                            {estimate.status}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-amber-600 text-sm">${Number(estimate.amount || 0).toFixed(0)}</p>
                    </div>
                  </div>
                );
              })}
              {expiringEstimates.length === 0 && (
                <div className="text-center py-6 text-green-600">
                  <p className="font-semibold text-sm">✓ {t.dashboard.noActivity}!</p>
                  <p className="text-xs text-gray-500 mt-1">{t.common.noResults}</p>
                </div>
              )}
            </CardContent>
          </Card>
        );
        break;

      case 'salesPipelineValue':
        const pipelineEstimates = yearFilteredEstimates.filter(e => e.status === 'sent' || e.status === 'viewed');
        const pipelineProposals = yearFilteredProposals.filter(p => p.status === 'sent' || p.status === 'viewed');
        const totalPipelineValue = [
          ...pipelineEstimates.map(e => Number(e.amount || 0)),
          ...pipelineProposals.map(p => Number(p.amount || 0))
        ].reduce((sum, val) => sum + val, 0);

        const acceptedEstimates = yearFilteredEstimates.filter(e => e.status === 'accepted');
        const potentialRevenue = acceptedEstimates.reduce((sum, e) => sum + Number(e.amount || 0), 0);

        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                  <DollarSign className={`w-4 h-4 ${darkMode ? 'text-green-400' : 'text-green-600'}`} />
                  Sales Pipeline Value
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className={`p-2 rounded-lg border ${darkMode ? 'bg-green-900/20 border-green-800' : 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-200'}`}>
                <p className={`text-xs ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>Total Pipeline</p>
                <p className={`text-xl font-bold ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
                  ${totalPipelineValue.toLocaleString('en-US', {minimumFractionDigits: 0})}
                </p>
                <p className={`text-xs ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>
                  {pipelineEstimates.length + pipelineProposals.length} pending
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className={`p-2 rounded-lg border ${darkMode ? 'bg-blue-900/20 border-blue-800' : 'bg-blue-50 border-blue-200'}`}>
                  <p className={`text-xs ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>Pending</p>
                  <p className={`text-sm font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>${pipelineEstimates.reduce((s, e) => s + Number(e.amount || 0), 0).toLocaleString()}</p>
                </div>
                <div className={`p-2 rounded-lg border ${darkMode ? 'bg-purple-900/20 border-purple-800' : 'bg-purple-50 border-purple-200'}`}>
                  <p className={`text-xs ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>Accepted</p>
                  <p className={`text-sm font-bold ${darkMode ? 'text-purple-400' : 'text-purple-600'}`}>${potentialRevenue.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
        break;

      case 'conversionMetrics':
        const estimatesToInvoices = yearFilteredInvoices.filter(inv => 
          yearFilteredEstimates.some(est => est.customer_name === inv.customer_name)
        ).length;
        const estimateConversionRate = yearFilteredEstimates.length > 0 
          ? ((estimatesToInvoices / yearFilteredEstimates.length) * 100).toFixed(0) 
          : 0;

        const leadsToCustomers = customers.filter(cust =>
          yearFilteredLeads.some(lead => lead.email === cust.email || lead.phone === cust.phone)
        ).length;
        const leadConversionRate = yearFilteredLeads.length > 0
          ? ((leadsToCustomers / yearFilteredLeads.length) * 100).toFixed(0)
          : 0;

        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                  <TrendingUp className={`w-4 h-4 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                  {t.dashboard.conversionMetrics}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className={`p-2 rounded-lg border ${darkMode ? 'bg-blue-900/20 border-blue-800' : 'bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200'}`}>
                <div className="flex items-center justify-between mb-1">
                  <p className={`text-xs font-medium ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>Estimate → Invoice</p>
                  <Badge className={`text-xs ${darkMode ? 'bg-blue-900/50 text-blue-400 border-blue-700' : 'bg-blue-100 text-blue-700'}`}>{estimateConversionRate}%</Badge>
                </div>
                <Progress value={parseFloat(estimateConversionRate)} className={`h-1.5 ${darkMode ? 'bg-slate-700 [&>div]:bg-blue-400' : '[&>div]:bg-blue-600'}`} />
              </div>

              <div className={`p-2 rounded-lg border ${darkMode ? 'bg-purple-900/20 border-purple-800' : 'bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200'}`}>
                <div className="flex items-center justify-between mb-1">
                  <p className={`text-xs font-medium ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>Lead → Customer</p>
                  <Badge className={`text-xs ${darkMode ? 'bg-purple-900/50 text-purple-400 border-purple-700' : 'bg-purple-100 text-purple-700'}`}>{leadConversionRate}%</Badge>
                </div>
                <Progress value={parseFloat(leadConversionRate)} className={`h-1.5 ${darkMode ? 'bg-slate-700 [&>div]:bg-purple-400' : '[&>div]:bg-purple-600'}`} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className={`text-center p-1.5 rounded ${darkMode ? 'bg-green-900/20' : 'bg-green-50'}`}>
                  <div className={`text-lg font-bold ${darkMode ? 'text-green-400' : 'text-green-600'}`}>{yearFilteredEstimates.filter(e => e.status === 'accepted').length}</div>
                  <div className={`text-xs ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>Accepted</div>
                </div>
                <div className={`text-center p-1.5 rounded ${darkMode ? 'bg-red-900/20' : 'bg-red-50'}`}>
                  <div className={`text-lg font-bold ${darkMode ? 'text-red-400' : 'text-red-600'}`}>{yearFilteredEstimates.filter(e => e.status === 'declined').length}</div>
                  <div className={`text-xs ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>Declined</div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
        break;

      case 'topPerformers':
        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move flex-shrink-0 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <div className="flex items-center justify-between flex-1">
                  <CardTitle className={`text-base flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <DollarSign className={`w-4 h-4 ${darkMode ? 'text-green-400' : 'text-green-600'}`} />
                    {t.dashboard.topPerformers}
                  </CardTitle>
                  <Button variant="outline" size="sm" onClick={() => navigate(createPageUrl('CommissionReport'))}>
                    {t.reports.title}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {getStaffCommissions().slice(0, 5).map((staff) => (
                  <div key={staff.email} className={`flex items-center justify-between pb-3 border-b last:border-0 ${darkMode ? 'border-slate-700' : ''}`}>
                    <div>
                      <p className={`font-medium ${darkMode ? 'text-white' : ''}`}>{staff.name}</p>
                      <p className={`text-xs ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{staff.email}</p>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold ${darkMode ? 'text-green-400' : 'text-green-600'}`}>${Number(staff.net || 0).toFixed(2)}</p>
                      <p className={`text-xs ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>
                        ${Number(staff.total_earned || 0).toFixed(2)} - ${Number(staff.deductions || 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                ))}
                {getStaffCommissions().length === 0 && (
                  <p className={`text-center py-4 ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{t.common.noResults}</p>
                )}
              </div>
            </CardContent>
          </Card>
        );
        break;

      case 'usageCredits':
        const isTrial = myCompany?.subscription_status === 'trial';
        const planName = myCompany?.subscription_plan || 'trial';
        
        const PLAN_LIMITS = {
          trial: { ai: 50, sms: 10, calls: 5 },
          basic: { ai: 1000, sms: 200, calls: 50 },
          business: { ai: 5000, sms: 1000, calls: 200 },
          enterprise: { ai: -1, sms: -1, calls: -1 },
          legacy: { ai: -1, sms: -1, calls: -1 },
          lifetime: { ai: -1, sms: -1, calls: -1 },
          unlimited: { ai: -1, sms: -1, calls: -1 },
          professional: { ai: 10000, sms: 2000, calls: 500 },
        };
        const limits = PLAN_LIMITS[planName] || PLAN_LIMITS.trial;

        const usageCurrentMonth = new Date().toISOString().slice(0, 7);
        const monthUsage = subscriptionUsage.filter(u => u.usage_month === usageCurrentMonth);
        const aiUsed = monthUsage.filter(u => u.feature === 'lexi' || u.feature === 'ai').reduce((s, u) => s + (u.units || 1), 0);
        const smsUsed = monthUsage.filter(u => u.feature === 'sms_ai' || u.feature === 'sms').reduce((s, u) => s + (u.units || 1), 0);
        const callUsed = monthUsage.filter(u => u.feature === 'sarah').reduce((s, u) => s + (u.units || 1), 0);

        const aiTotal = limits.ai;
        const smsTotal = limits.sms;
        const callTotal = limits.calls;
        const aiPercent = aiTotal > 0 ? Math.min((aiUsed / aiTotal) * 100, 100) : 0;
        const smsPercent = smsTotal > 0 ? Math.min((smsUsed / smsTotal) * 100, 100) : 0;
        const callPercent = callTotal > 0 ? Math.min((callUsed / callTotal) * 100, 100) : 0;

        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <div className="flex items-center justify-between flex-1">
                  <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <Zap className={`w-4 h-4 ${darkMode ? 'text-yellow-400' : 'text-yellow-600'}`} />
                    {t.dashboard.usageCredits}
                    <Badge className={`ml-2 text-xs ${isTrial ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                      {planName.charAt(0).toUpperCase() + planName.slice(1)}
                    </Badge>
                  </CardTitle>
                  <Button variant="link" size="sm" onClick={() => navigate(createPageUrl('SubscriptionUsage'))} className="h-auto p-0 text-xs">
                    {t.dashboard.viewAll}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* AI Interactions */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-medium ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>AI Interactions</span>
                  <span className={`text-xs ${aiPercent >= 80 ? 'text-red-600 font-bold' : darkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {aiTotal < 0 ? '∞' : `${aiUsed} / ${aiTotal}`}
                  </span>
                </div>
                {aiTotal > 0 && (
                  <Progress 
                    value={aiPercent} 
                    className={`h-2 ${aiPercent >= 80 ? '[&>div]:bg-red-500' : '[&>div]:bg-blue-500'}`} 
                  />
                )}
                {aiTotal < 0 && <div className={`text-xs ${darkMode ? 'text-green-400' : 'text-green-600'}`}>Unlimited</div>}
              </div>

              {/* SMS Messages */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-medium ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>SMS Messages</span>
                  <span className={`text-xs ${smsPercent >= 80 ? 'text-red-600 font-bold' : darkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {smsTotal < 0 ? '∞' : `${smsUsed} / ${smsTotal}`}
                  </span>
                </div>
                {smsTotal > 0 && (
                  <Progress 
                    value={smsPercent} 
                    className={`h-2 ${smsPercent >= 80 ? '[&>div]:bg-red-500' : '[&>div]:bg-purple-500'}`} 
                  />
                )}
                {smsTotal < 0 && <div className={`text-xs ${darkMode ? 'text-green-400' : 'text-green-600'}`}>Unlimited</div>}
              </div>

              {/* Call Minutes */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-medium ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>Call Minutes</span>
                  <span className={`text-xs ${callPercent >= 80 ? 'text-red-600 font-bold' : darkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {callTotal < 0 ? '∞' : `${Math.round(callUsed)} / ${callTotal}`}
                  </span>
                </div>
                {callTotal > 0 && (
                  <Progress 
                    value={callPercent} 
                    className={`h-2 ${callPercent >= 80 ? '[&>div]:bg-red-500' : '[&>div]:bg-green-500'}`} 
                  />
                )}
                {callTotal < 0 && <div className={`text-xs ${darkMode ? 'text-green-400' : 'text-green-600'}`}>Unlimited</div>}
              </div>

              {(isTrial || (planName !== 'legacy' && planName !== 'enterprise' && (aiTotal > 0 || smsTotal > 0 || callTotal > 0))) && (
                <div className="pt-2 border-t">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full text-xs"
                    onClick={() => navigate(createPageUrl('SubscriptionUsage'))}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    {isTrial ? t.dashboard.usageCredits : t.dashboard.usageCredits}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
        break;

      case 'recentActivity':
        const recentActivities = [];
        
        // Recent customers (last 5)
        customers.slice(0, 3).forEach(c => {
          recentActivities.push({
            type: 'customer',
            icon: '👤',
            title: `New customer: ${c.name}`,
            time: c.created_date,
            link: createPageUrl('Customers')
          });
        });
        
        // Recent invoices sent (last 5)
        invoices.filter(i => i.status === 'sent' || i.status === 'viewed')
          .slice(0, 3)
          .forEach(i => {
            recentActivities.push({
              type: 'invoice',
              icon: '📄',
              title: `Invoice sent: ${i.invoice_number}`,
              subtitle: i.customer_name,
              time: i.created_date,
              link: createPageUrl('Invoices')
            });
          });
        
        // Recent payments (last 5)
        payments.slice(0, 3).forEach(p => {
          recentActivities.push({
            type: 'payment',
            icon: '💰',
            title: `Payment received: $${Number(p.amount || 0).toFixed(2)}`,
            subtitle: p.customer_name,
            time: p.payment_date || p.created_date,
            link: createPageUrl('Payments')
          });
        });
        
        // Recent communications (last 5)
        allCommunications.slice(0, 3).forEach(c => {
          const icon = c.communication_type === 'email' ? '📧' : c.communication_type === 'sms' ? '💬' : '📞';
          recentActivities.push({
            type: 'communication',
            icon: icon,
            title: `${c.communication_type}: ${c.contact_name || 'Contact'}`,
            subtitle: c.subject || c.message?.substring(0, 40),
            time: c.created_date,
            link: createPageUrl('Communication')
          });
        });

        const sortedActivities = recentActivities
          .sort((a, b) => new Date(b.time) - new Date(a.time))
          .slice(0, 5);

        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                  <Activity className={`w-4 h-4 ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`} />
                  {t.dashboard.recentActivity}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              {sortedActivities.map((activity, idx) => (
                <div 
                  key={idx}
                  className={`flex items-start gap-3 p-2 rounded-lg cursor-pointer transition-colors ${darkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-50'}`}
                  onClick={() => navigate(activity.link)}
                >
                  <div className="text-xl flex-shrink-0">{activity.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>{activity.title}</p>
                    {activity.subtitle && (
                      <p className={`text-xs truncate ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{activity.subtitle}</p>
                    )}
                    <p className={`text-xs ${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>
                      {(() => {
                        try {
                          const date = new Date(activity.time);
                          return !isNaN(date.getTime()) ? format(date, 'MMM d, h:mm a') : 'Date N/A';
                        } catch (e) {
                          return 'Date N/A';
                        }
                      })()}
                    </p>
                  </div>
                </div>
              ))}
              {sortedActivities.length === 0 && (
                <p className={`text-center py-6 text-xs ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{t.dashboard.noActivity}</p>
              )}
            </CardContent>
          </Card>
        );
        break;

      case 'buildSchedule':
        const todayDate = new Date().toISOString().split('T')[0];
        const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
        const weekBuilds = filteredBuildScheduleItems.filter(b =>
          b.build_date >= todayDate && b.build_date <= weekEnd &&
          b.status !== 'cancelled' && b.status !== 'completed'
        ).sort((a, b) => (a.build_date || '').localeCompare(b.build_date || ''));

        const BUILD_STATUS_COLORS = {
          scheduled: 'bg-blue-100 text-blue-700',
          confirmed: 'bg-green-100 text-green-700',
          in_progress: 'bg-yellow-100 text-yellow-700',
          postponed: 'bg-orange-100 text-orange-700',
          completed: 'bg-emerald-100 text-emerald-700',
          cancelled: 'bg-red-100 text-red-700',
        };
        const BUILD_STATUS_LABELS = {
          scheduled: 'Scheduled', confirmed: 'Confirmed', in_progress: 'In Progress',
          postponed: 'Postponed', completed: 'Completed', cancelled: 'Cancelled',
        };

        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move flex-shrink-0 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <div className="flex items-center justify-between flex-1">
                  <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <span className={darkMode ? 'text-blue-400' : 'text-blue-600'}>🏗️</span>
                    Build Schedule ({weekBuilds.length})
                  </CardTitle>
                  <Button variant="link" size="sm" onClick={() => navigate(createPageUrl('BuildSchedule'))} className="h-auto p-0 text-xs" data-testid="link-view-all-builds">
                    {t.dashboard.viewAll}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {weekBuilds.length === 0 ? (
                <p className={`text-sm text-center py-4 ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                  No builds scheduled this week
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className={darkMode ? 'border-b border-slate-700' : 'border-b'}>
                        <th className={`text-left px-2 py-1.5 font-medium ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>Date</th>
                        <th className={`text-left px-2 py-1.5 font-medium ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>Customer</th>
                        <th className={`text-left px-2 py-1.5 font-medium ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>Type</th>
                        <th className={`text-left px-2 py-1.5 font-medium ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>Rep</th>
                        <th className={`text-left px-2 py-1.5 font-medium ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>Crew</th>
                        <th className={`text-left px-2 py-1.5 font-medium ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>Address</th>
                        <th className={`text-left px-2 py-1.5 font-medium ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weekBuilds.slice(0, 6).map((build) => {
                        const isToday = build.build_date === todayDate;
                        return (
                          <tr
                            key={build.id}
                            className={`cursor-pointer ${
                              isToday
                                ? darkMode ? 'bg-blue-900/30 hover:bg-blue-900/50' : 'bg-blue-50 hover:bg-blue-100'
                                : darkMode ? 'hover:bg-slate-700 border-b border-slate-700' : 'hover:bg-gray-50 border-b'
                            }`}
                            onClick={() => navigate(createPageUrl('BuildSchedule'))}
                            data-testid={`widget-build-${build.id}`}
                          >
                            <td className={`px-2 py-1.5 whitespace-nowrap ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>
                              {build.build_date ? new Date(build.build_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                              {isToday && <Badge className="text-[8px] bg-blue-600 ml-1 py-0 px-0.5">TODAY</Badge>}
                            </td>
                            <td className={`px-2 py-1.5 font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{build.customer_name || '—'}</td>
                            <td className={`px-2 py-1.5 ${darkMode ? 'text-slate-300' : 'text-gray-600'}`}>{build.job_type || '—'}</td>
                            <td className={`px-2 py-1.5 ${darkMode ? 'text-slate-300' : 'text-gray-600'}`}>{build.rep || '—'}</td>
                            <td className={`px-2 py-1.5 ${darkMode ? 'text-slate-300' : 'text-gray-600'}`}>{build.assigned_to || '—'}</td>
                            <td className={`px-2 py-1.5 max-w-[120px] truncate ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{build.address || '—'}</td>
                            <td className="px-2 py-1.5">
                              <Badge className={`text-[9px] ${BUILD_STATUS_COLORS[build.status] || 'bg-gray-100 text-gray-700'}`}>
                                {BUILD_STATUS_LABELS[build.status] || build.status}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        );
        break;

      default:
        return null;
    }

    if (!content) return null;

    return content;
  };

  const validAvailableYears = availableYears.filter(year => year && !isNaN(year));
  if (validAvailableYears.length === 0) {
    validAvailableYears.push(new Date().getFullYear());
  }

  const { isImpersonating } = useImpersonation();

  const isCompanySyncUser = !isImpersonating && !!user && myCompany?.id === 'companysync_master_001';

  useEffect(() => {
    if (!isDataLoading && isCompanySyncUser && !isImpersonating && user) {
      navigate(createPageUrl('SaaSAdminDashboard'), { replace: true });
    }
  }, [isDataLoading, isCompanySyncUser, isImpersonating, user, navigate]);

  if (!isDataLoading && isCompanySyncUser && !isImpersonating) {
    return <div className="p-6 text-center text-gray-500">Redirecting to Admin Dashboard...</div>;
  }

  if (isLoadingInvoices || isLoadingCustomers) {
    return <DashboardSkeleton />;
  }

  return (
    <div className={`p-2 sm:p-3 lg:p-4 min-h-screen transition-colors ${darkMode ? 'bg-slate-900' : 'bg-gray-50'}`}>
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <div>
          <h1 className={`text-xl sm:text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{t.dashboard.title}</h1>
          <p className={`text-xs sm:text-sm ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{t.dashboard.welcome} back, {myStaffProfile?.full_name || user?.full_name || 'User'}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={toggleDarkMode}
            className={darkMode ? 'bg-gray-800 border-gray-700 text-gray-200' : ''}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? '☀️' : '🌙'}
          </Button>

          <Select
            value={selectedYear}
            onValueChange={(value) => setSelectedYear(value)}
          >
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Years</SelectItem>
              {validAvailableYears.filter(year => year && !isNaN(year)).map(year => (
                <SelectItem key={year} value={year.toString()}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Sheet open={showWidgetPanel} onOpenChange={setShowWidgetPanel}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings className="w-4 h-4 mr-1" />
                Customize
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <div className="flex items-center justify-between">
                  <SheetTitle>{t.dashboard.title}</SheetTitle>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleResetWidgets}
                    className="text-xs"
                  >
                    {t.dashboard.recentActivity}
                  </Button>
                </div>
              </SheetHeader>
              <div className="mt-6">
                <p className="text-sm text-gray-600 mb-4">{t.dashboard.recentActivity}</p>
                <DragDropContext onDragEnd={handleDragEnd}>
                  <Droppable droppableId="widgets-list">
                    {(provided) => (
                      <div 
                        {...provided.droppableProps} 
                        ref={provided.innerRef}
                        className="space-y-2"
                      >
                        {widgetOrder.map((key, index) => {
                          const widgetNames = {
                            aiTaskHealth: 'AI Task Health',
                            aiRecommendations: 'AI Recommendations',
                            salesPipelineValue: 'Sales Pipeline Value',
                            revenueMetrics: 'Revenue Metrics',
                            conversionMetrics: t.dashboard.conversionMetrics,
                            calendar: t.calendar.title,
                            invoicesNeedingFollowUp: 'Invoices Needing Follow Up',
                            estimateOverview: t.estimates.title + ' Overview',
                            criticalJobsPending: 'Critical Jobs Pending',
                            pendingInstallsRepairs: 'Pending Installs & Repairs',
                            estimatesExpiringSoon: 'Estimates Expiring Soon',
                            workflowMonitor: 'Workflow Monitor',
                            topPerformers: t.dashboard.topPerformers,
                            leadsOverview: t.dashboard.leadsOverview,
                            staleLeadsAlert: 'Stale Leads Alert',
                            draftEstimatesAlert: 'Draft Estimates Alert',
                            projectStatus: t.projects.title + ' ' + t.common.status,
                            recentActivity: t.dashboard.recentActivity,
                            usageCredits: t.dashboard.usageCredits,
                            buildSchedule: 'Build Schedule'
                          };

                          return (
                            <Draggable key={key} draggableId={key} index={index}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className={`flex items-center justify-between p-3 bg-white border rounded-lg ${
                                    snapshot.isDragging ? 'shadow-lg' : 'shadow-sm'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <GripVertical className="w-4 h-4 text-gray-400" />
                                    <Label htmlFor={key} className="cursor-pointer">
                                      {widgetNames[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                                    </Label>
                                  </div>
                                  <Checkbox
                                    id={key}
                                    checked={visibleWidgets[key]}
                                    onCheckedChange={() => toggleWidget(key)}
                                  />
                                </div>
                              )}
                            </Draggable>
                          );
                        })}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              </div>

              <div className="mt-6 flex gap-2">
                <Button 
                  onClick={() => {
                    handleSaveLayout();
                    setShowWidgetPanel(false);
                  }}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  disabled={saveDashboardSettingsMutation.isPending || !hasUnsavedChanges}
                >
                  {saveDashboardSettingsMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                  ) : (
                    <><Save className="w-4 h-4 mr-2" /> {t.common.save}</>
                  )}
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => setShowWidgetPanel(false)}
                  className="flex-1"
                >
                  {t.common.cancel}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>



      

      {/* ===== THIS WEEK OPERATIONS PANEL (pinned, non-draggable) ===== */}
      {(() => {
        const today = new Date();
        const todayStr = format(today, 'yyyy-MM-dd');
        const wkStart = startOfWeek(today, { weekStartsOn: 1 }); // Monday
        const wkEnd = endOfWeek(today, { weekStartsOn: 1 });     // Sunday
        const wkStartStr = format(wkStart, 'yyyy-MM-dd');
        const wkEndStr = format(wkEnd, 'yyyy-MM-dd');

        const weekBuilds = filteredBuildScheduleItems
          .filter(b => b.build_date >= wkStartStr && b.build_date <= wkEndStr && b.status !== 'cancelled' && b.status !== 'completed')
          .sort((a, b) => (a.build_date || '').localeCompare(b.build_date || ''));

        const weekInspections = inspectionJobs
          .filter(j => {
            const d = j.inspection_date || j.scheduled_date || (j.created_date ? j.created_date.slice(0, 10) : null);
            if (!d || d < wkStartStr || d > wkEndStr || j.status === 'cancelled' || j.status === 'completed') return false;
            if (!isAdmin && j.assigned_to_email && j.assigned_to_email !== user?.email) return false;
            return true;
          })
          .sort((a, b) => {
            const da = a.inspection_date || a.scheduled_date || (a.created_date ? a.created_date.slice(0, 10) : '');
            const db = b.inspection_date || b.scheduled_date || (b.created_date ? b.created_date.slice(0, 10) : '');
            return da.localeCompare(db);
          });

        const todayBuilds = weekBuilds.filter(b => b.build_date === todayStr);
        const todayInspections = weekInspections.filter(j => (j.inspection_date || j.scheduled_date || (j.created_date ? j.created_date.slice(0, 10) : null)) === todayStr);
        const hasTodayItems = todayBuilds.length > 0 || todayInspections.length > 0;
        const todayCount = todayBuilds.length + todayInspections.length;

        const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '—';

        const BSC = { scheduled: 'bg-blue-100 text-blue-700', confirmed: 'bg-green-100 text-green-700', in_progress: 'bg-yellow-100 text-yellow-700', postponed: 'bg-orange-100 text-orange-700' };
        const ISC = { assigned: 'bg-blue-100 text-blue-700', in_progress: 'bg-yellow-100 text-yellow-700', completed: 'bg-green-100 text-green-700', draft: 'bg-gray-100 text-gray-600' };

        return (
          <div className="space-y-3 mb-4" data-testid="weekly-ops-panel">
            {/* Pulsing TODAY Alert Banner — only shown when items exist today */}
            {hasTodayItems && (
              <div className={`flex items-start gap-3 p-3 rounded-lg border-2 ${darkMode ? 'bg-amber-950/40 border-amber-500/60' : 'bg-amber-50 border-amber-400'}`} data-testid="banner-today-alert">
                <div className="animate-pulse flex-shrink-0 mt-0.5 text-xl">🔔</div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                    You have {todayCount} item{todayCount !== 1 ? 's' : ''} today
                  </p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {todayBuilds.map(b => (
                      <span key={b.id} className={`text-xs px-2 py-0.5 rounded-full font-medium ${darkMode ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-700'}`} data-testid={`today-build-${b.id}`}>
                        🏗️ {b.customer_name || 'Build'}{b.address ? ` — ${b.address}` : ''}
                      </span>
                    ))}
                    {todayInspections.map(j => (
                      <span key={j.id} className={`text-xs px-2 py-0.5 rounded-full font-medium ${darkMode ? 'bg-emerald-900/50 text-emerald-300' : 'bg-emerald-100 text-emerald-700'}`} data-testid={`today-inspection-${j.id}`}>
                        🔍 {j.customer_name || j.address || 'Inspection'}
                      </span>
                    ))}
                  </div>
                </div>
                <span className={`animate-pulse w-2.5 h-2.5 rounded-full inline-block flex-shrink-0 mt-1 ${darkMode ? 'bg-amber-400' : 'bg-amber-500'}`} />
              </div>
            )}

            {/* This Week's Builds + Inspections — two-card grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Card className={darkMode ? 'bg-slate-800 border-slate-700' : 'border-blue-200'} data-testid="card-week-builds">
                <CardHeader className="pb-2 pt-3 px-4 cursor-pointer select-none" onClick={() => setBuildsOpen(o => !o)} data-testid="toggle-week-builds">
                  <div className="flex items-center justify-between">
                    <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                      <ChevronDown className={`w-4 h-4 transition-transform ${buildsOpen ? '' : '-rotate-90'}`} />
                      <span>🏗️</span> This Week's Builds
                      <Badge className={`text-xs ${weekBuilds.length > 0 ? 'bg-blue-600 text-white' : darkMode ? 'bg-slate-700 text-slate-400' : 'bg-gray-100 text-gray-600'}`}>{weekBuilds.length}</Badge>
                    </CardTitle>
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={(e) => { e.stopPropagation(); navigate(createPageUrl('BuildSchedule')); }} data-testid="link-week-builds-view-all">View All</Button>
                  </div>
                </CardHeader>
                {buildsOpen && (
                <CardContent className="px-4 pb-3">
                  {weekBuilds.length === 0 ? (
                    <p className={`text-xs py-2 text-center ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>No builds scheduled this week</p>
                  ) : (
                    <div className="space-y-1.5">
                      {weekBuilds.slice(0, 5).map(b => {
                        const isToday = b.build_date === todayStr;
                        return (
                          <div key={b.id} className={`flex items-center gap-2 p-1.5 rounded-md text-xs cursor-pointer ${isToday ? darkMode ? 'bg-blue-900/30' : 'bg-blue-50' : darkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-50'}`}
                            onClick={() => navigate(createPageUrl('BuildSchedule'))} data-testid={`week-build-${b.id}`}>
                            {isToday && <span className="animate-pulse w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />}
                            <span className={`w-16 flex-shrink-0 ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{fmtDate(b.build_date)}</span>
                            <span className={`font-medium flex-1 truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>{b.customer_name || '—'}</span>
                            <span className={`truncate max-w-[80px] ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{Array.isArray(b.job_type) ? b.job_type[0] : b.job_type || '—'}</span>
                            <Badge className={`text-[9px] flex-shrink-0 ${BSC[b.status] || 'bg-gray-100 text-gray-600'}`}>{b.status || '—'}</Badge>
                          </div>
                        );
                      })}
                      {weekBuilds.length > 5 && <p className={`text-xs text-center pt-1 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>+{weekBuilds.length - 5} more</p>}
                    </div>
                  )}
                </CardContent>
                )}
              </Card>

              <Card className={darkMode ? 'bg-slate-800 border-slate-700' : 'border-emerald-200'} data-testid="card-week-inspections">
                <CardHeader className="pb-2 pt-3 px-4 cursor-pointer select-none" onClick={() => setInspectionsOpen(o => !o)} data-testid="toggle-week-inspections">
                  <div className="flex items-center justify-between">
                    <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                      <ChevronDown className={`w-4 h-4 transition-transform ${inspectionsOpen ? '' : '-rotate-90'}`} />
                      <span>🔍</span> This Week's Inspections
                      <Badge className={`text-xs ${weekInspections.length > 0 ? 'bg-emerald-600 text-white' : darkMode ? 'bg-slate-700 text-slate-400' : 'bg-gray-100 text-gray-600'}`}>{weekInspections.length}</Badge>
                    </CardTitle>
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={(e) => { e.stopPropagation(); navigate(createPageUrl('InspectionsDashboard')); }} data-testid="link-week-inspections-view-all">View All</Button>
                  </div>
                </CardHeader>
                {inspectionsOpen && (
                <CardContent className="px-4 pb-3">
                  {weekInspections.length === 0 ? (
                    <p className={`text-xs py-2 text-center ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>No inspections scheduled this week</p>
                  ) : (
                    <div className="space-y-1.5">
                      {weekInspections.slice(0, 5).map(j => {
                        const jDate = j.inspection_date || j.scheduled_date || (j.created_date ? j.created_date.slice(0, 10) : null);
                        const isToday = jDate === todayStr;
                        const inspectorProfile = staffProfiles.find(s => s.user_email === j.assigned_to_email);
                        const inspectorName = inspectorProfile?.full_name || j.assigned_to_email?.split('@')[0] || '—';
                        const clientName = j.client_name || j.customer_name || '—';
                        const address = j.property_address || j.address || '';
                        return (
                          <div key={j.id} className={`flex items-start gap-2 p-2 rounded-md text-xs cursor-pointer ${isToday ? darkMode ? 'bg-emerald-900/30' : 'bg-emerald-50' : darkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-50'}`}
                            onClick={() => navigate(createPageUrl('InspectionCapture') + `?jobId=${j.id}`)} data-testid={`week-inspection-${j.id}`}>
                            {isToday && <span className="animate-pulse w-2 h-2 rounded-full bg-green-500 flex-shrink-0 mt-1" />}
                            <span className={`w-14 flex-shrink-0 ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{fmtDate(jDate)}</span>
                            <div className="flex-1 min-w-0">
                              <p className={`font-medium truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>{clientName}</p>
                              {address && <p className={`truncate ${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>{address}</p>}
                              <p className={`${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>👤 {inspectorName}</p>
                            </div>
                            <Badge className={`text-[9px] flex-shrink-0 mt-0.5 ${ISC[j.status] || 'bg-gray-100 text-gray-600'}`}>{j.status || '—'}</Badge>
                          </div>
                        );
                      })}
                      {weekInspections.length > 5 && <p className={`text-xs text-center pt-1 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>+{weekInspections.length - 5} more</p>}
                    </div>
                  )}
                </CardContent>
                )}
              </Card>
            </div>
          </div>
        );
      })()}

      {/* Top 4 Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <SmallMetricCard title={t.dashboard.invoicesAwaitingPayment} value={invoicesAwaitingPaymentCount} total={invoices.length} icon={FileText} color="blue" darkMode={darkMode} />
        <SmallMetricCard title={t.dashboard.convertedLeads} value={convertedLeads} total={yearFilteredLeads.length} icon={TrendingUp} color="green" darkMode={darkMode} />
        <SmallMetricCard title={t.dashboard.projectsInProgress} value={projectsInProgress} total={projects.length} icon={Briefcase} color="orange" darkMode={darkMode} />
        <SmallMetricCard title={t.dashboard.tasksNotFinished} value={tasksNotFinished} total={tasks.length} icon={CheckSquare} color="purple" darkMode={darkMode} />
      </div>

      {/* Proposal, Invoice & Estimate Overview - 3 columns on same line */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {/* Proposal Overview */}
        <Card className={darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white'}>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className={`text-lg font-semibold ${darkMode ? 'text-white' : ''}`}>{t.sidebar.proposals} {t.common.status}</CardTitle>
            <Button variant="link" size="sm" onClick={() => navigate(createPageUrl('Proposals'))} className={darkMode ? 'text-blue-400' : ''}>
              {t.dashboard.viewAll}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>{proposalStats.draft} {t.common.draft}</span>
                <span className={`text-sm ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{totalProposalCount > 0 ? ((proposalStats.draft / totalProposalCount) * 100).toFixed(1) : 0}%</span>
              </div>
              <Progress value={(proposalStats.draft / totalProposalCount) * 100 || 0} className="h-2 bg-gray-200 [&>div]:bg-gray-500" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>{proposalStats.sent} {t.common.sent}</span>
                <span className={`text-sm ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{totalProposalCount > 0 ? ((proposalStats.sent / totalProposalCount) * 100).toFixed(1) : 0}%</span>
              </div>
              <Progress value={(proposalStats.sent / totalProposalCount) * 100 || 0} className="h-2 bg-gray-200 [&>div]:bg-blue-500" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>{proposalStats.declined} {t.estimates.declined}</span>
                <span className={`text-sm ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{totalProposalCount > 0 ? ((proposalStats.declined / totalProposalCount) * 100).toFixed(1) : 0}%</span>
              </div>
              <Progress value={(proposalStats.declined / totalProposalCount) * 100 || 0} className="h-2 bg-gray-200 [&>div]:bg-red-500" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>{proposalStats.accepted} {t.estimates.accepted}</span>
                <span className={`text-sm ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{totalProposalCount > 0 ? ((proposalStats.accepted / totalProposalCount) * 100).toFixed(1) : 0}%</span>
              </div>
              <Progress value={(proposalStats.accepted / totalProposalCount) * 100 || 0} className="h-2 bg-gray-200 [&>div]:bg-green-500" />
            </div>
          </CardContent>
        </Card>

        {/* Invoice Overview */}
        <Card className={darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white'}>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className={`text-lg font-semibold ${darkMode ? 'text-white' : ''}`}>{t.invoices.title} {t.common.status}</CardTitle>
            <Button variant="link" size="sm" onClick={() => navigate(createPageUrl('Invoices'))} className={darkMode ? 'text-blue-400' : ''}>
              {t.dashboard.viewAll}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>{invoiceStats.draft} {t.common.draft}</span>
                <span className={`text-sm ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{totalInvoiceCount > 0 ? ((invoiceStats.draft / totalInvoiceCount) * 100).toFixed(1) : 0.0}%</span>
              </div>
              {invoiceStats.draft > 0 && (
                <Progress value={(invoiceStats.draft / totalInvoiceCount) * 100 || 0} className="h-2 bg-gray-200 [&>div]:bg-gray-600" />
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>{invoiceStats.sent} {t.common.none} {t.common.sent}</span>
                <span className={`text-sm ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{totalInvoiceCount > 0 ? ((invoiceStats.sent / totalInvoiceCount) * 100).toFixed(1) : 0.0}%</span>
              </div>
              {invoiceStats.sent > 0 && (
                <Progress value={(invoiceStats.sent / totalInvoiceCount) * 100 || 0} className="h-2 bg-gray-200 [&>div]:bg-red-500" />
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>{invoiceStats.partiallyPaid} {t.invoices.partiallyPaid}</span>
                <span className={`text-sm ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{totalInvoiceCount > 0 ? ((invoiceStats.partiallyPaid / totalInvoiceCount) * 100).toFixed(1) : 0.0}%</span>
              </div>
              {invoiceStats.partiallyPaid > 0 && (
                <Progress value={(invoiceStats.partiallyPaid / totalInvoiceCount) * 100 || 0} className="h-2 bg-gray-200 [&>div]:bg-orange-500" />
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>{invoiceStats.overdue} {t.invoices.overdue}</span>
                <span className={`text-sm ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{totalInvoiceCount > 0 ? ((invoiceStats.overdue / totalInvoiceCount) * 100).toFixed(1) : 0.0}%</span>
              </div>
              {invoiceStats.overdue > 0 && (
                <Progress value={(invoiceStats.overdue / totalInvoiceCount) * 100 || 0} className="h-2 bg-gray-200 [&>div]:bg-orange-600" />
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>{invoiceStats.paid} {t.invoices.paid}</span>
                <span className={`text-sm ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{totalInvoiceCount > 0 ? ((invoiceStats.paid / totalInvoiceCount) * 100).toFixed(1) : 0.0}%</span>
              </div>
              {invoiceStats.paid > 0 && (
                <Progress value={(invoiceStats.paid / totalInvoiceCount) * 100 || 0} className="h-2 bg-gray-200 [&>div]:bg-green-500" />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Estimate Overview */}
        <Card className={darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white'}>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className={`text-lg font-semibold ${darkMode ? 'text-white' : ''}`}>{t.estimates.title} {t.common.status}</CardTitle>
            <Button variant="link" size="sm" onClick={() => navigate(createPageUrl('Estimates'))} className={darkMode ? 'text-blue-400' : ''}>
              {t.dashboard.viewAll}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>{estimateStats.draft} {t.common.draft}</span>
                <span className={`text-sm ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{totalEstimateCount > 0 ? ((estimateStats.draft / totalEstimateCount) * 100).toFixed(0) : 0}%</span>
              </div>
              {estimateStats.draft > 0 && (
                <Progress value={(estimateStats.draft / totalEstimateCount) * 100 || 0} className="h-2 bg-gray-200 [&>div]:bg-gray-500" />
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>{estimateStats.sent} {t.common.sent}</span>
                <span className={`text-sm ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{totalEstimateCount > 0 ? ((estimateStats.sent / totalEstimateCount) * 100).toFixed(0) : 0}%</span>
              </div>
              {estimateStats.sent > 0 && (
                <Progress value={(estimateStats.sent / totalEstimateCount) * 100 || 0} className="h-2 bg-gray-200 [&>div]:bg-blue-500" />
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>{estimateStats.accepted} {t.estimates.accepted}</span>
                <span className={`text-sm ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{totalEstimateCount > 0 ? ((estimateStats.accepted / totalEstimateCount) * 100).toFixed(0) : 0}%</span>
              </div>
              {estimateStats.accepted > 0 && (
                <Progress value={(estimateStats.accepted / totalEstimateCount) * 100 || 0} className="h-2 bg-gray-200 [&>div]:bg-green-500" />
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>{estimateStats.declined} {t.estimates.declined}</span>
                <span className={`text-sm ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{totalEstimateCount > 0 ? ((estimateStats.declined / totalEstimateCount) * 100).toFixed(0) : 0}%</span>
              </div>
              {estimateStats.declined > 0 && (
                <Progress value={(estimateStats.declined / totalEstimateCount) * 100 || 0} className="h-2 bg-gray-200 [&>div]:bg-red-500" />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Draggable Widgets */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="dashboard-widgets">
          {(provided) => (
            <div 
              {...provided.droppableProps} 
              ref={provided.innerRef}
              className="space-y-4"
            >
              {draggableWidgets.map((widgetId, index) => {
                const widget = renderWidget(widgetId);
                // Even if widget is null (shouldn't be due to filter), we must render Draggable to keep indices correct
                // But we filtered draggableWidgets so widget should be valid.
                
                return (
                  <Draggable key={widgetId} draggableId={widgetId} index={index}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className={snapshot.isDragging ? 'opacity-50' : ''}
                      >
                        <div {...provided.dragHandleProps}>
                          {widget || <div className="p-4 text-center text-gray-500">Widget failed to load</div>}
                        </div>
                      </div>
                    )}
                  </Draggable>
                );
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {hasUnsavedChanges && (
        <div className="flex justify-center mt-6">
          <Button 
            onClick={handleSaveLayout}
            className="bg-green-600 hover:bg-green-700 px-8 py-6 text-lg"
            disabled={saveDashboardSettingsMutation.isPending}
          >
            {saveDashboardSettingsMutation.isPending ? (
              <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Saving...</>
            ) : (
              <><Save className="w-5 h-5 mr-2" /> {t.common.save} Layout</>
            )}
          </Button>
        </div>
      )}

      <Dialog open={showDayEvents} onOpenChange={setShowDayEvents}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Day Events</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {dayEventsList.map((event) => (
              <div key={event.id} className="p-2 rounded border cursor-pointer hover:bg-gray-50"
                   onClick={() => { setSelectedEvent(event); setShowDayEvents(false); }}>
                <div className="text-sm font-medium">{event.title}</div>
                <div className="text-xs text-gray-500">
                  {(() => {
                    try {
                      const date = new Date(event.start_time);
                      return !isNaN(date.getTime()) ? format(date, 'MMM d, h:mm a') : '';
                    } catch (e) { return ''; }
                  })()}
                </div>
              </div>
            ))}
            {dayEventsList.length === 0 && (
              <p className="text-sm text-gray-500">No events for this day.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <EventDetailDialog
        selectedEvent={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onEdit={handleEditEvent}
        onDelete={handleDeleteEvent}
        isDeleting={deleteEventMutation.isPending}
      />

      <EventFormDialog
        open={showEventDialog}
        onOpenChange={setShowEventDialog}
        editingEvent={editingEvent}
        eventFormData={eventFormData}
        setEventFormData={setEventFormData}
        onSubmit={handleEventSubmit}
        isSubmitting={createEventMutation.isPending || updateEventMutation.isPending}
        cancelLabel={t.common.cancel}
      />
    </div>
  );
}