import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePageVisibility } from "@/hooks/usePageVisibility";
import { useRoleBasedData } from "../components/hooks/useRoleBasedData";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { getDaysOverdue, getInvoiceBalance, isInvoiceOverdue } from "@/utils/invoiceFinance";
import SaaSAdminDashboard from "./SaaSAdminDashboard";
import GoogleCalendarReconnectBanner from "@/components/calendar/GoogleCalendarReconnectBanner";
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
  MoreVertical,
  ExternalLink,
  Bell,
} from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek, subDays } from "date-fns";
import { BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from 'sonner';
import { getSignupAttribution, trackSignUpOnce } from '@/lib/analytics';
import { DashboardSkeleton } from "@/components/PageSkeleton";
import useTranslation from "@/hooks/useTranslation";
import { useImpersonation } from "@/lib/ImpersonationContext";
import { localToday } from "@/utils/localDate";
import { makeInvoiceMatcher } from "@/utils/paymentOwnership";
import { reverseStandaloneDeduction } from "@/utils/standaloneDeduction";

// 🎨 Event type color mapping - same as Calendar page
const EVENT_TYPE_COLORS = {
  meeting: '#3b82f6',        // Blue
  inspection: '#10b981',     // Green
  call: '#8b5cf6',           // Purple
  appointment: '#f59e0b',    // Orange
  reminder: '#eab308',       // Yellow
  estimate: '#06b6d4',       // Cyan
  roofing_contractor: '#14b8a6', // Teal
  follow_up: '#ec4899',      // Pink
  check_pickup: '#f97316',   // Orange-red
  other: '#6b7280'           // Gray
};

const getColorForEventType = (eventType) => {
  return EVENT_TYPE_COLORS[eventType] || EVENT_TYPE_COLORS.other;
};

function SmallMetricCard({ title, value, total, icon: Icon, color, darkMode }) {
  const colorClasses = {
    blue: { 
      bg: darkMode ? "bg-blue-900/20" : "bg-blue-50", 
      icon: darkMode ? "text-blue-400" : "text-blue-600", 
      border: darkMode ? "border-blue-800" : "border-blue-200", 
      text: darkMode ? "text-blue-400" : "text-blue-600" 
    },
    green: { 
      bg: darkMode ? "bg-green-900/20" : "bg-green-50", 
      icon: darkMode ? "text-green-400" : "text-green-600", 
      border: darkMode ? "border-green-800" : "border-green-200", 
      text: darkMode ? "text-green-400" : "text-green-600" 
    },
    orange: { 
      bg: darkMode ? "bg-orange-900/20" : "bg-orange-50", 
      icon: darkMode ? "text-orange-400" : "text-orange-600", 
      border: darkMode ? "border-orange-800" : "border-orange-200", 
      text: darkMode ? "text-orange-400" : "text-orange-600" 
    },
    purple: { 
      bg: darkMode ? "bg-purple-900/20" : "bg-purple-50", 
      icon: darkMode ? "text-purple-400" : "text-purple-600", 
      border: darkMode ? "border-purple-800" : "border-purple-200", 
      text: darkMode ? "text-purple-400" : "text-purple-600" 
    },
  };
  const selected = colorClasses[color] || colorClasses.blue;

  return (
    <Card className={`border ${selected.border} hover:shadow-md transition-shadow ${darkMode ? 'bg-slate-800' : 'bg-white'}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg ${darkMode ? 'bg-slate-700' : 'bg-gray-100'} flex items-center justify-center flex-shrink-0`}>
            {Icon && <Icon className={`w-5 h-5 ${selected.icon}`} />}
          </div>
          <div>
            <p className={`text-xs ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>{title}</p>
            <p className={`text-xl font-bold ${selected.text}`}>
              {value}{total != null && <> / {total}</>}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const isPageVisible = usePageVisibility();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const dashboardLocale = t.common?.dateLocale || 'en-US';
  const formatLocalizedDate = (value, options = {}) => {
    const date = value instanceof Date ? value : new Date(value);
    return !Number.isNaN(date.getTime())
      ? date.toLocaleDateString(dashboardLocale, options)
      : t.dashboard.dateNA;
  };
  const formatLocalizedDateTime = (value, options = {}) => {
    const date = value instanceof Date ? value : new Date(value);
    return !Number.isNaN(date.getTime())
      ? date.toLocaleString(dashboardLocale, options)
      : t.dashboard.dateNA;
  };
  const dashboardStatus = (status) => {
    const labels = {
      scheduled: t.dashboard.scheduled,
      confirmed: t.dashboard.confirmed,
      in_progress: t.dashboard.inProgress,
      postponed: t.dashboard.postponed,
      completed: t.dashboard.completed,
      cancelled: t.dashboard.cancelled,
      draft: t.common.draft,
      active: t.common.active,
      overdue: t.common.overdue,
      sent: t.common.sent,
      paid: t.common.paid,
    };
    return labels[status] || String(status || '').replace(/_/g, ' ');
  };
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isDashboardDataReady, setIsDashboardDataReady] = useState(false);

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
    filterCustomers, 
    filterEstimates, 
    filterInvoices, 
    filterProposals,
    myRole,
    isDataLoading
  } = useRoleBasedData();

  // The complete dashboard totals require several tenant-wide collection
  // reads. Let the shell paint first, then hydrate those accurate collections
  // during the browser's idle time instead of competing with the first render.
  useEffect(() => {
    setIsDashboardDataReady(false);
    if (isDataLoading || !myCompany?.id) return undefined;

    let cancelled = false;
    let idleId;
    let timeoutId;
    const activate = () => {
      if (!cancelled) setIsDashboardDataReady(true);
    };

    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(activate, { timeout: 750 });
    } else {
      timeoutId = window.setTimeout(activate, 250);
    }

    return () => {
      cancelled = true;
      if (idleId !== undefined && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [isDataLoading, myCompany?.id]);

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
  const [showPipelineSheet, setShowPipelineSheet] = useState(false);
  const [showCollectionsAlert, setShowCollectionsAlert] = useState(false);

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
    todayFocus: true,
    revenueMetrics: true,
    salesPipelineValue: true,
    repPipelineWidget: true,
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
    actionItemsWidget: true,
    aiTaskHealth: true,
    workflowMonitor: true,
    aiRecommendations: true,
    recentActivity: true,
    conversionMetrics: true,
    topPerformers: true,
    usageCredits: true,
    buildSchedule: true,
    remindersWidget: true,
  };

  const DEFAULT_WIDGET_ORDER = [
    'todayFocus',
    'usageCredits',
    'staleLeadsAlert',
    'draftEstimatesAlert',
    'actionItemsWidget',
    'remindersWidget',
    'aiTaskHealth',
    'aiRecommendations',
    'repPipelineWidget',
    'salesPipelineValue',
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
  const marketingSignupInFlight = React.useRef(false);

  // Filter widgets that should be displayed in the draggable list
  const draggableWidgets = React.useMemo(() => {
    return widgetOrder.filter(id => visibleWidgets[id] && id !== 'estimateOverview');
  }, [widgetOrder, visibleWidgets]);

  // User fetched via useRoleBasedData

  // 🚀 Auto-signup from marketing site
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const email = params.get('email');
    
    if (email && !user && !marketingSignupInFlight.current) {
      marketingSignupInFlight.current = true;
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
      base44.functions.invoke('autoSignupFromMarketing', {
        userData,
        companyData,
        attribution: getSignupAttribution(),
      })
        .then(async response => {
          if (response.data?.success) {
            const tracking = response.data.tracking;
            if (tracking?.is_new_trial && tracking.event_id) {
              await trackSignUpOnce({
                eventId: tracking.event_id,
                method: 'marketing',
                plan: companyData.plan_type,
                email: userData.email,
              });
            }
            toast.success(response.data.message);
            // Clear URL params
            window.history.replaceState({}, document.title, window.location.pathname);
          } else {
            marketingSignupInFlight.current = false;
            toast.error(response.data?.error || 'Signup failed');
          }
        })
        .catch(error => {
          marketingSignupInFlight.current = false;
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
      navigate('/QuickSetup?new_signup=true');
    }
  }, [isDataLoading, user, myCompany, myStaffProfile, navigate]);

  // 🔥 NEW: Load dashboard settings from database
  const { data: dashboardSettings = [] } = useQuery({
    queryKey: ['dashboard-settings', user?.email],
    queryFn: () => user ? base44.entities.DashboardSettings.filter({ user_email: user.email }) : [],
    enabled: !!user,
  });

  const currentSettings = dashboardSettings[0];

  // Load settings from database when available
  // ← Guarded by !hasUnsavedChanges so a background refetch doesn't snap dragged widgets back
  useEffect(() => {
    if (currentSettings && !hasUnsavedChanges) {
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
        const finalOrder = newWidgets.includes('usageCredits')
          ? [...newWidgets, ...savedOrder]
          : ['usageCredits', ...savedOrder.filter(w => w !== 'usageCredits')];
        setWidgetOrder(finalOrder);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSettings, hasUnsavedChanges]);

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
      toast.success(`${t.dashboard.title} ${t.dashboard.saveLayout.toLowerCase()}.`);
    },
    onError: (error) => {
      toast.error(`Failed to save layout: ${error.message}`);
    }
  });

  // 🔐 Fetch data with permission filtering.
  // Dashboard cards show company totals, so they must not use a viewport-specific
  // row cap. A mobile-only cap made the cards display 250/500 as if those were
  // real totals, and the old generic query keys also allowed the warmup cache
  // to replace a full dashboard result with a capped slice.
  const entityFetchLimit = 10000;

  const { data: allInvoices = [], isLoading: isLoadingInvoices } = useQuery({
    queryKey: ['invoices', 'dashboard', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Invoice.filter({ company_id: myCompany.id }, "-created_date", entityFetchLimit) : [],
    refetchInterval: 2 * 60 * 1000,
    refetchIntervalInBackground: false,
    enabled: !!myCompany?.id && isPageVisible && isDashboardDataReady,
  });

  const { data: allCustomers = [], isLoading: isLoadingCustomers } = useQuery({
    queryKey: ['customers', 'dashboard', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date", entityFetchLimit) : [],
    enabled: !!myCompany?.id && isDashboardDataReady,
  });

  const { data: allEstimates = [] } = useQuery({
    queryKey: ['estimates', 'dashboard', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Estimate.filter({ company_id: myCompany.id }, "-created_date", entityFetchLimit) : [],
    enabled: !!myCompany?.id && isDashboardDataReady,
  });

  const { data: allProposals = [] } = useQuery({
    queryKey: ['proposals', 'dashboard', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Proposal.filter({ company_id: myCompany.id }, "-created_date", entityFetchLimit) : [],
    enabled: !!myCompany?.id && isDashboardDataReady,
  });

  const { data: allProjects = [] } = useQuery({
    queryKey: ['projects', 'dashboard', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Project.filter({ company_id: myCompany.id }, "-created_date", entityFetchLimit) : [],
    enabled: !!myCompany?.id && isDashboardDataReady,
  });

  const { data: allLeads = [] } = useQuery({
    queryKey: ['leads', 'dashboard', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Lead.filter({ company_id: myCompany.id }, "-created_date", entityFetchLimit) : [],
    enabled: !!myCompany?.id && isDashboardDataReady,
  });

  const { data: allActionItems = [] } = useQuery({
    queryKey: ['action-items', 'dashboard', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.ActionItem.filter({ company_id: myCompany.id }, "-created_date", isMobile ? 200 : 500) : [],
    enabled: !!myCompany?.id && isPageVisible && isDashboardDataReady,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
  });

  const { data: allTasks = [], refetch: refetchTasks } = useQuery({
    queryKey: ['tasks', 'dashboard', myCompany?.id],
    queryFn: async () => {
      if (!myCompany?.id) return [];
      const tasks = await base44.entities.Task.filter({ company_id: myCompany.id }, "-updated_date", entityFetchLimit);
      console.log('🔄 Dashboard tasks refreshed:', tasks.length, 'tasks loaded');
      return tasks;
    },
    enabled: !!myCompany?.id && isDashboardDataReady,
  });

  // 🔐 Use centralized role-based filtering
  // const { filterCustomers, filterEstimates, filterInvoices, filterProposals } = useRoleBasedData(); // Already imported at top

  // Filter customers first
  const customers = React.useMemo(() => filterCustomers(allCustomers), [allCustomers, filterCustomers]);

  // Filter invoices based on customer relationship
  const invoices = React.useMemo(() => filterInvoices(allInvoices, customers), [allInvoices, customers, filterInvoices]);

  // Filter estimates based on customer relationship
  const estimates = React.useMemo(() => filterEstimates(allEstimates, customers), [allEstimates, customers, filterEstimates]);

  // Filter proposals based on customer relationship
  const proposals = React.useMemo(() => filterProposals(allProposals, customers), [allProposals, customers, filterProposals]);

  const projects = React.useMemo(() => {
    if (!user?.email) return allProjects;
    if (isAdmin) return allProjects;
    return allProjects.filter(proj => 
      proj.team_members?.includes(user.email) || proj.created_by === user.email
    );
  }, [allProjects, isAdmin, user?.email]);

  const leads = React.useMemo(() => {
    if (!user?.email) return allLeads;
    if (isAdmin) return allLeads;
    return allLeads.filter(lead => 
      lead.assigned_to === user.email || 
      lead.assigned_to_users?.includes(user.email) ||
      lead.created_by === user.email
    );
  }, [allLeads, isAdmin, user?.email]);

  const tasks = React.useMemo(() => {
    if (!user?.email) return allTasks;
    if (isAdmin) return allTasks;
    return allTasks.filter(task => 
      task.assigned_to === user.email ||
      task.assignees?.some(a => a.email === user.email) ||
      task.created_by === user.email
    );
  }, [allTasks, isAdmin, user?.email]);

  const allCompanyTasks = React.useMemo(() => {
    if (isAdmin) return allTasks;
    return tasks;
  }, [allTasks, tasks, isAdmin]);

  // Dashboard Calendar: Main calendar — ALL staff see ALL company events
  const { data: calendarEvents = [], isFetching: isCalendarFetching } = useQuery({
    queryKey: ['calendar-events-dashboard', myCompany?.id],
    queryFn: async () => {
      if (!myCompany?.id) return [];
      return await base44.entities.CalendarEvent.filter({ company_id: myCompany.id }, "-start_time", 500);
    },
    enabled: !!myCompany?.id && isPageVisible && isDashboardDataReady,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
  });

  // 🔐 For non-admins, scope calendar events to their own events only
  const myCalendarEvents = React.useMemo(() => {
    if (isAdmin) return calendarEvents;
    return calendarEvents.filter(evt =>
      evt.assigned_to_email === user?.email ||
      evt.created_by === user?.email ||
      (Array.isArray(evt.attendees) && evt.attendees.some(a => a.email === user?.email))
    );
  }, [calendarEvents, isAdmin, user?.email]);

  const { data: allPayments = [] } = useQuery({
    queryKey: ['payments', 'dashboard', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Payment.filter({ company_id: myCompany.id }, "-payment_date", 1000) : [],
    enabled: !!myCompany?.id && isDashboardDataReady,
  });

  const { data: allCommunications = [] } = useQuery({
    queryKey: ['communications', 'dashboard', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Communication.filter({ company_id: myCompany.id }, "-created_date", 50) : [],
    enabled: !!myCompany?.id && isDashboardDataReady,
  });

  const payments = React.useMemo(() => {
    if (!user?.email) return allPayments;
    if (isAdmin) return allPayments;
    // Non-admins only see payments for their own invoices
    const userInvoiceIds = invoices.map(inv => inv.id);
    return allPayments.filter(pay => userInvoiceIds.includes(pay.invoice_id));
  }, [allPayments, isAdmin, user?.email, invoices]);

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', 'dashboard', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id && isDashboardDataReady,
  });

  // Pending commission pipeline: mirrors CommissionReport's calculatePendingPipeline logic
  const repPendingPipeline = React.useMemo(() => {
    if (!myCompany?.id || !staffProfiles.length) return { total: 0, repTotal: 0, count: 0, myLines: [] };

    const repEmail = user?.email;
    const pendingInvoices = allInvoices.filter(inv => {
      if (inv.company_id !== myCompany.id) return false;
      if (['paid', 'cancelled', 'void'].includes(inv.status)) return false;
      return (parseFloat(inv.total_amount) || 0) > 0;
    });

    const commissionStaff = staffProfiles.filter(s => (s.commission_rate || 0) > 0);
    let companyTotal = 0;
    let myTotal = 0;
    let myCount = 0;
    let myLines = [];

    commissionStaff.forEach(staff => {
      const rate = (staff.commission_rate || 10) / 100;
      let repTotal = 0;
      const isMyProfile = staff.user_email === repEmail;

      for (const inv of pendingInvoices) {
        const splits = Array.isArray(inv.commission_splits) ? inv.commission_splits : [];
        const splitEntry = splits.find(cs => cs.user_email === staff.user_email);
        const isSaleAgent = inv.sale_agent === staff.user_email;
        const isCustomerAssigned = (() => {
          if (isSaleAgent || splitEntry) return false;
          const cust = allCustomers.find(c =>
            c.name === inv.customer_name || (inv.customer_id && c.id === inv.customer_id)
          );
          if (!cust) return false;
          const assigned = cust.assigned_to_users?.length
            ? cust.assigned_to_users
            : (cust.assigned_to ? [cust.assigned_to] : []);
          return assigned.includes(staff.user_email);
        })();

        if (!isSaleAgent && !splitEntry && !isCustomerAssigned) continue;

        const invoiceTotal = parseFloat(inv.total_amount) || 0;
        if (invoiceTotal <= 0) continue;

        let pending = invoiceTotal * rate;
        if (splitEntry) {
          pending = invoiceTotal * rate * ((parseFloat(splitEntry.split_percentage) || 100) / 100);
        }
        if (pending <= 0) continue;

        repTotal += pending;

        if (isMyProfile) {
          myLines.push({
            invoice_id: inv.id,
            invoice_number: inv.invoice_number || inv.id?.slice(-6) || '—',
            customer_name: inv.customer_name || 'Unknown Customer',
            invoice_total: invoiceTotal,
            pending_commission: pending,
            status: inv.status || 'pending',
          });
        }
      }

      companyTotal += repTotal;
      if (isMyProfile) {
        myTotal = repTotal;
        myCount = pendingInvoices.filter(inv => {
          const splits = Array.isArray(inv.commission_splits) ? inv.commission_splits : [];
          const isSaleAgent = inv.sale_agent === staff.user_email;
          const isSplit = splits.some(cs => cs.user_email === staff.user_email);
          if (isSaleAgent || isSplit) return true;
          const cust = allCustomers.find(c =>
            c.name === inv.customer_name || (inv.customer_id && c.id === inv.customer_id)
          );
          if (!cust) return false;
          const assigned = cust.assigned_to_users?.length
            ? cust.assigned_to_users
            : (cust.assigned_to ? [cust.assigned_to] : []);
          return assigned.includes(staff.user_email);
        }).length;
      }
    });

    return { total: companyTotal, repTotal: myTotal, count: isAdmin ? pendingInvoices.length : myCount, myLines };
  }, [allInvoices, allCustomers, staffProfiles, myCompany?.id, user?.email, isAdmin]);

  const { data: buildScheduleItems = [] } = useQuery({
    queryKey: ['build-schedule', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.BuildSchedule.filter({ company_id: myCompany.id }, '-build_date', 500) : [],
    enabled: !!myCompany?.id && isDashboardDataReady,
  });

  const { data: dashboardWorkflows = [] } = useQuery({
    queryKey: ['dashboard-workflows', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Workflow.filter({ company_id: myCompany.id }, '-created_date') : [],
    enabled: !!myCompany?.id && isDashboardDataReady,
  });

  const filteredBuildScheduleItems = React.useMemo(() => {
    if (!buildScheduleItems.length) return [];
    if (isAdmin) return buildScheduleItems;
    const myName = myStaffProfile?.full_name || user?.name;
    const myEmail = user?.email;
    return buildScheduleItems.filter(b => {
      const assigned = Array.isArray(b.assigned_to)
        ? b.assigned_to
        : (b.assigned_to ? [b.assigned_to] : []);
      const assignedEmails = Array.isArray(b.assigned_to_users) ? b.assigned_to_users : [];
      return assigned.some(a => a === myName || a === myEmail)
        || assignedEmails.includes(myEmail)
        || b.rep === myName || b.rep === myEmail
        || b.rep_email === myEmail || b.created_by === myEmail;
    });
  }, [buildScheduleItems, isAdmin, myStaffProfile, user]);

  const { data: inspectionJobs = [] } = useQuery({
    queryKey: ['inspection-jobs-dashboard', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.InspectionJob.filter({ company_id: myCompany.id }, '-created_date', 200) : [],
    enabled: !!myCompany?.id && isDashboardDataReady,
  });

  // Fetch subscription usage for the Usage & Credits widget
  const { data: subscriptionUsage = [] } = useQuery({
    queryKey: ['subscription-usage', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.SubscriptionUsage.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
  });

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
      if (!myCompany?.id || payment.company_id !== myCompany.id) {
        throw new Error('Cannot delete a payment outside the active company.');
      }

      const reversal = await reverseStandaloneDeduction({ payment, companyId: myCompany.id, invoke: base44.functions.invoke });
      if (reversal.handled) return { payment, recalcFailed: false };

      const companyInvoices = invoices.filter(inv => !inv.company_id || inv.company_id === myCompany.id);
      const exactInvoice = payment.invoice_id
        ? companyInvoices.find(inv => inv.id === payment.invoice_id)
        : null;
      const matchesInv = makeInvoiceMatcher(companyInvoices);
      const legacyInvoice = !payment.invoice_id
        ? companyInvoices.find(inv => matchesInv(payment, inv))
        : null;
      const invoiceIdForRecalc = exactInvoice?.id || legacyInvoice?.id || null;

      await base44.entities.Payment.delete(paymentId);

      let recalcFailed = false;
      if (invoiceIdForRecalc) {
        try {
          const raw = await base44.functions.invoke('recalculateInvoicePayments', {
            invoice_id: invoiceIdForRecalc,
          });
          const result = raw?.data ?? raw;
          if (result?.success !== true) {
            throw new Error(result?.error || 'Invoice recalculation was not confirmed.');
          }
        } catch (error) {
          console.error('Invoice recalculation after payment deletion failed:', error);
          recalcFailed = true;
        }
      } else if (payment.invoice_id || payment.invoice_number) {
        recalcFailed = true;
      }
      return { payment, recalcFailed };
    },
    onSuccess: (result) => {
      if (result.recalcFailed) {
        toast.warning('Payment deleted but balance could not be recalculated; open invoice and use Sync Payments', { duration: 8000 });
      } else {
        toast.success('Payment and any matching fee-deduction expense deleted successfully!');
      }
    },
    onError: (error) => {
      toast.error('Failed to delete payment: ' + error.message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['customer-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    }
  });

  const updateBuildStatusMutation = useMutation({
    mutationFn: ({ id, status }) => base44.entities.BuildSchedule.update(id, {
      status,
      last_activity_at: new Date().toISOString(),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['build-schedule', myCompany?.id] });
      toast.success('Build status updated');
    },
    onError: (e) => toast.error('Failed to update build status: ' + e.message),
  });

  const updateInspectionStatusMutation = useMutation({
    mutationFn: ({ id, status }) => base44.entities.InspectionJob.update(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspection-jobs-dashboard', myCompany?.id] });
      toast.success('Inspection status updated');
    },
    onError: (e) => toast.error('Failed to update inspection status: ' + e.message),
  });

  // ✅ FIX: Always include current year in dropdown
  const currentYear = new Date().getFullYear();
  const yearsWithInvoices = [...new Set(invoices
    .map(i => i.issue_date || i.created_date || i.created_at)
    .filter(d => d && !isNaN(new Date(d).getTime()))
    .map(d => new Date(d).getFullYear())
  )];
  const availableYears = [...new Set([...yearsWithInvoices, currentYear])].sort((a, b) => b - a);

  const yearFilteredInvoices = React.useMemo(() => {
    return selectedYear === 'all'
      ? invoices
      : invoices.filter(i => {
          const d = i.issue_date || i.created_date || i.created_at;
          if (!d) return true; // no date → include in current year
          return new Date(d).getFullYear().toString() === selectedYear;
        });
  }, [invoices, selectedYear]);

  const paidInvoicesArray = yearFilteredInvoices.filter(i => i.status === 'paid');

  const filterByYear = (items, dateField) => {
    if (selectedYear === 'all') return items;
    return items.filter(item => {
      const d = item[dateField] || item.created_date || item.created_at;
      if (!d) return selectedYear === currentYear.toString(); // no date → treat as current year
      return new Date(d).getFullYear().toString() === selectedYear;
    });
  };

  const yearFilteredEstimates = React.useMemo(() => filterByYear(estimates, 'created_date'), [estimates, selectedYear]);
  const yearFilteredProposals = React.useMemo(() => filterByYear(proposals, 'created_date'), [proposals, selectedYear]);
  const yearFilteredPayments = React.useMemo(() => filterByYear(payments, 'payment_date'), [payments, selectedYear]);
  const yearFilteredLeads = React.useMemo(() => filterByYear(leads, 'created_date'), [leads, selectedYear]);
  const yearFilteredCustomers = React.useMemo(() => filterByYear(customers, 'created_date'), [customers, selectedYear]);
  const yearFilteredProjects = React.useMemo(() => filterByYear(projects, 'created_date'), [projects, selectedYear]);
  const yearFilteredTasks = React.useMemo(() => filterByYear(tasks, 'created_date'), [tasks, selectedYear]);
  
  // ✅ Outstanding and Overdue should ALWAYS show ALL invoices (not year-filtered)
  // These roll over from previous years because they're still owed!
  const allUnpaidInvoices = React.useMemo(() => {
    return invoices.filter(i =>
      !i.status ||
      i.status === 'draft' ||
      i.status === 'sent' ||
      i.status === 'viewed' ||
      i.status === 'partially_paid'
    );
  }, [invoices]);

  const allOverdueInvoices = React.useMemo(() => {
    // "To collect": a sent (non-draft, non-cancelled) invoice that still has a
    // real balance owed and is past its EFFECTIVE due date (due_date, or
    // created_at + 30 days when no due_date is set). Without the fallback,
    // almost nothing counts as past due because due_date is rarely filled in,
    // so the collections total badly undercounts what is actually owed.
    // Uses total_amount (canonical) — NOT inv.amount, a stale legacy value.
    return invoices.filter(inv => {
      if (inv.status === 'overdue') {
        return (Number(inv.total_amount) || 0) - (Number(inv.amount_paid) || 0) > 0;
      }
      return isInvoiceOverdue(inv);
    });
  }, [invoices]);

  // Outstanding = unpaid invoices + remaining balance on partially paid (ALL YEARS - ROLLS OVER)
  const outstandingAmount = allUnpaidInvoices.reduce((sum, inv) => {
    const remaining = (Number(inv.total_amount) || 0) - (Number(inv.amount_paid) || 0);
    return sum + Math.max(0, remaining);
  }, 0);

  // Overdue amount (remaining balance for overdue invoices, ALL YEARS - ROLLS OVER)
  const overdueAmount = allOverdueInvoices.reduce((sum, inv) => {
    const remaining = (Number(inv.total_amount) || 0) - (Number(inv.amount_paid) || 0);
    return sum + Math.max(0, remaining);
  }, 0);

  // Collections alert — show once per day if overdue invoices exist.
  // On mobile, defer by 1.5 s so the alert doesn't race with the initial
  // render burst (which freezes lower-end phones like the Samsung A24).
  React.useEffect(() => {
    if (!allOverdueInvoices.length) return;
    const today = new Date().toDateString();
    const dismissed = localStorage.getItem('collections_alert_dismissed');
    if (dismissed === today) return;
    if (isMobile) {
      const tid = setTimeout(() => setShowCollectionsAlert(true), 1500);
      return () => clearTimeout(tid);
    }
    setShowCollectionsAlert(true);
  }, [allOverdueInvoices, isMobile]);

  // This year revenue = sum of all payments received in current year (based on payment_date, not invoice issue_date)
  const thisYearRevenue = payments.filter(payment => {
    if (!payment.payment_date) return false;
    return new Date(payment.payment_date).getFullYear() === currentYear;
  }).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  // Paid invoices total for selected year (based on invoice issue_date)
  const totalRevenue = paidInvoicesArray.reduce((sum, inv) => sum + Number(inv.total_amount || inv.amount || 0), 0);

  // "Awaiting payment" = sent, viewed, partially paid, or overdue — NOT draft (not sent yet)
  const invoicesAwaitingPaymentCount = yearFilteredInvoices.filter(i =>
    i.status === 'sent' || i.status === 'viewed' ||
    i.status === 'partially_paid' || i.status === 'overdue'
  ).length;
  // All counts respect the selected year (defaults to current year) so the
  // dashboard only reflects the chosen year's activity.
  const convertedLeads = yearFilteredLeads.filter(l => l.status === 'won').length;
  const leadsNewCount = yearFilteredLeads.filter(l => l.status === 'new' || !l.status).length;
  const leadsContactedCount = yearFilteredLeads.filter(l => l.status === 'contacted').length;
  const leadsQualifiedCount = yearFilteredLeads.filter(l => l.status === 'qualified').length;
  const leadsProposalCount = yearFilteredLeads.filter(l => l.status === 'proposal').length;
  const leadsNegotiationCount = yearFilteredLeads.filter(l => l.status === 'negotiation').length;
  const leadsLostCount = yearFilteredLeads.filter(l => l.status === 'lost').length;
  const projectsInProgress = yearFilteredProjects.filter(p => p.status === 'in_progress').length;
  // "Not finished" = not archived AND neither status nor column is job_completed
  const tasksNotFinished = yearFilteredTasks.filter(t => !t.is_archived && t.status !== 'job_completed' && t.column !== 'job_completed').length;

  const invoiceStats = {
    draft: yearFilteredInvoices.filter(i => i.status === 'draft' || !i.status).length,
    sent: yearFilteredInvoices.filter(i => i.status === 'sent').length,
    partiallyPaid: yearFilteredInvoices.filter(i => i.status === 'partially_paid').length,
    overdue: yearFilteredInvoices.filter(inv => {
      if (inv.status === 'paid' || inv.status === 'cancelled') return false;
      if (!inv.due_date) return false;
      const dueDate = new Date(inv.due_date);
      dueDate.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return dueDate < today;
    }).length,
    paid: yearFilteredInvoices.filter(i => i.status === 'paid').length,
  };

  const totalInvoiceCount = yearFilteredInvoices.length;

  const estimateStats = {
    draft: yearFilteredEstimates.filter(e => e.status === 'draft' || !e.status).length,
    sent: yearFilteredEstimates.filter(e => e.status === 'sent').length,
    expired: yearFilteredEstimates.filter(e => e.status === 'expired').length,
    declined: yearFilteredEstimates.filter(e => e.status === 'declined').length,
    accepted: yearFilteredEstimates.filter(e => e.status === 'accepted').length,
  };

  const totalEstimateCount = yearFilteredEstimates.length;

  const proposalStats = {
    // Use all proposals (not year-filtered) — year-filtering wipes out prior-year proposals
    draft: proposals.filter(p => p.status === 'draft' || !p.status).length,
    sent: proposals.filter(p => p.status === 'sent').length,
    declined: proposals.filter(p => p.status === 'declined').length,
    accepted: proposals.filter(p => p.status === 'accepted').length,
  };

  const totalProposalCount = proposals.length;

  const leadsData = [
    { name: t.leads.newLead, value: yearFilteredLeads.filter(l => l.status === 'new').length, color: '#8b5cf6' },
    { name: t.leads.contacted, value: yearFilteredLeads.filter(l => l.status === 'contacted').length, color: '#3b82f6' },
    { name: t.leads.qualified, value: yearFilteredLeads.filter(l => l.status === 'qualified').length, color: '#f59e0b' },
    { name: t.leads.won, value: convertedLeads, color: '#10b981' },
    { name: t.leads.lost, value: yearFilteredLeads.filter(l => l.status === 'lost').length, color: '#ef4444' },
  ];

  const projectsData = [
    { name: t.dashboard.projectNotStarted, value: yearFilteredProjects.filter(p => p.status === 'not_started').length, color: '#94a3b8' },
    { name: t.dashboard.inProgress, value: projectsInProgress, color: '#3b82f6' },
    { name: t.dashboard.projectOnHold, value: yearFilteredProjects.filter(p => p.status === 'on_hold').length, color: '#f59e0b' },
    { name: t.dashboard.completed, value: yearFilteredProjects.filter(p => p.status === 'completed').length, color: '#10b981' },
  ];

  // 🚨 Critical tasks needing attention
  const outstandingByCustomer = React.useMemo(() => {
    const map = new Map();
    (invoices || []).forEach(inv => {
      const name = inv.customer_name?.trim();
      if (!name) return;
      const remaining = (Number(inv.total_amount) || 0) - (Number(inv.amount_paid) || 0);
      if (inv.status !== 'paid' && inv.status !== 'cancelled' && remaining > 0) {
        map.set(name, (map.get(name) || 0) + remaining);
      }
    });
    return map;
  }, [invoices]);

  const criticalTasks = React.useMemo(() => {
    const filtered = tasks.filter(t => {
      // Hide tasks for customers who have no outstanding invoices
      const taskCustomer = (t.related_to || '').trim() || (t.name?.split(' - ').slice(-1)[0]?.trim() || '');
      if (taskCustomer && !(outstandingByCustomer.get(taskCustomer) > 0)) return false;
      if (t.is_archived || t.column === 'job_completed') return false;

      // Exclude tasks in "customer_lost" column
      if (t.column === 'customer_lost') return false;

      // Check if overdue
      if (t.due_date) {
        const dueDate = new Date(t.due_date);
        dueDate.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (dueDate < today) return true;
      }

      // Check if stuck >5 days in critical columns
      const criticalColumns = ['not_started', 'in_progress', 'awaiting_payment', 'follow_up_needed', 'awaiting_feedback'];
      if (criticalColumns.includes(t.column)) {
        const daysSinceUpdate = Math.floor((new Date() - new Date(t.updated_date)) / (1000 * 60 * 60 * 24));
        if (daysSinceUpdate >= 5) return true;
      }

      return false;
    });
    console.log('🎯 Critical tasks recalculated:', filtered.length);
    return filtered;
  }, [tasks]);

  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dayName = format(date, 'EEE');
    const dayPayments = payments.filter(p => {
      if (!p.payment_date) return false;
      return format(new Date(p.payment_date), 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd');
    });
    last7Days.push({
      name: dayName,
      amount: dayPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
    });
  }

  const getStaffCommissions = () => {
    // 🔐 Filter based on role permissions
    let profiles = staffProfiles;
    if (!isAdmin) {
      profiles = staffProfiles.filter(s => s.user_email === user?.email);
    }

    // ✅ Include: Anyone with commission percentage set OR commission earnings
    // ❌ Exclude: Operations staff (Vicky, Raffy) and test accounts
    const excludedEmails = [
      'victoriafeliciapatindol@gmail.com',
      'raffy.vpa28@gmail.com',
      'guidatorivirtuali@gmail.com',
      'luisas@base44.com',
      'rubaitradbusiness3333@gmail.com'
    ];

    profiles = profiles.filter(s => {
      if (excludedEmails.includes(s.user_email)) return false;

      // Include anyone with commission percentage set OR commission earnings
      const hasCommissionRate = (s.commission_percentage || 0) > 0;
      const hasCommissionEarnings = (s.total_commissions_earned || 0) > 0;
      
      return hasCommissionRate || hasCommissionEarnings;
    });

    return profiles.map(staff => ({
      name: staff.full_name || staff.user_email,
      email: staff.user_email,
      total_earned: staff.total_commissions_earned || 0,
      deductions: staff.total_deductions || 0,
      net: (staff.total_commissions_earned || 0) - (staff.total_deductions || 0),
    })).sort((a, b) => b.net - a.net);
  };

  const topPerformers = React.useMemo(() => 
    isAdmin 
      ? getStaffCommissions().slice(0, 5) 
      : getStaffCommissions(),
    [isAdmin, staffProfiles, user?.email]
  );

  // 🤖 AI Task Health Score
  const taskHealthScore = React.useMemo(() => {
    const activeTasks = tasks.filter(t => !t.is_archived && t.column !== 'job_completed');
    const totalTasks = activeTasks.length;
    
    console.log('📊 Task Health Calculation:', {
      totalTasks,
      activeTasks: activeTasks.length,
      allTasks: tasks.length
    });
    
    if (totalTasks === 0) return { score: 100, status: t.dashboard.excellent, color: 'green', insights: [] };
    
    const criticalCount = criticalTasks.length;
    const overdue = activeTasks.filter(t => {
      if (!t.due_date) return false;
      const dueDate = new Date(t.due_date);
      dueDate.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return dueDate < today;
    }).length;
    const unassigned = activeTasks.filter(t => t.column !== 'customer_lost' && !t.assignees?.length && !t.assigned_to).length;
    const highPriority = activeTasks.filter(t => t.column !== 'customer_lost' && t.priority === 'high').length;
    
    console.log('📊 Task Metrics:', { criticalCount, overdue, unassigned, highPriority });
    
    let score = 100;
    score -= (criticalCount / totalTasks) * 40;
    score -= (overdue / totalTasks) * 30;
    score -= (unassigned / totalTasks) * 20;
    score -= (highPriority / totalTasks) * 10;
    score = Math.max(0, Math.round(score));
    
    const insights = [];
    if (criticalCount > 0) insights.push(t.dashboard.tasksNeedImmediateAttention(criticalCount));
    if (overdue > 0) insights.push(t.dashboard.tasksAreOverdue(overdue));
    if (unassigned > 3) insights.push(t.dashboard.tasksUnassigned(unassigned));
    if (highPriority > 5) insights.push(t.dashboard.highPriorityTasks(highPriority));
    
    const status = score >= 80 ? t.dashboard.excellent : score >= 60 ? t.dashboard.good : score >= 40 ? t.dashboard.needsAttention : t.dashboard.critical;
    const color = score >= 80 ? 'green' : score >= 60 ? 'blue' : score >= 40 ? 'yellow' : 'red';
    
    console.log('📊 Final Score:', { score, status, insights });
    
    return { score, status, color, insights };
  }, [tasks, criticalTasks, t]);

  // 🎯 AI Recommendations
  const aiRecommendations = React.useMemo(() => {
    const recs = [];
    
    if (criticalTasks.length > 5) {
      recs.push({
        type: 'urgent',
        icon: '🚨',
        title: t.dashboard.highTaskBacklog,
        action: t.dashboard.reviewRedistributeTasks,
        impact: 'High',
        target: 'tasks'
      });
    }
    
    const overdueInvoicesCount = invoices.filter(i => i.status === 'overdue').length;
    if (overdueInvoicesCount > 3) {
      recs.push({
        type: 'financial',
        icon: '💰',
        title: `${overdueInvoicesCount} ${t.dashboard.overdueInvoices}`,
        action: t.dashboard.sendFollowupReminders,
        impact: 'High',
        target: 'invoices'
      });
    }
    
    const oldLeads = leads.filter(l => {
      const daysSince = Math.floor((new Date() - new Date(l.created_date)) / (1000 * 60 * 60 * 24));
      return daysSince > 14 && l.status === 'new';
    }).length;
    
    if (oldLeads > 10) {
      recs.push({
        type: 'opportunity',
        icon: '🎯',
        title: t.dashboard.staleLeadsRecommendation(oldLeads),
        action: t.dashboard.followupArchiveLeads,
        impact: 'Medium',
        target: 'leads'
      });
    }
    
    if (estimates.filter(e => e.status === 'sent').length > 10) {
      recs.push({
        type: 'sales',
        icon: '📊',
        title: t.dashboard.multiplePendingEstimates,
        action: t.dashboard.followupCustomerDecisions,
        impact: 'Medium',
        target: 'estimates'
      });
    }

    if (recs.length === 0) {
      recs.push({
        type: 'success',
        icon: '✨',
        title: t.dashboard.everythingLooksGreat,
        action: t.dashboard.keepExcellentWork,
        impact: 'None',
        target: 'dashboard'
      });
    }
    
    return recs;
  }, [criticalTasks, invoices, leads, estimates, t]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  const daysInView = eachDayOfInterval({ start: startDate, end: endDate });

  const getEventsForDay = (date) => {
    const baseEvents = myCalendarEvents.filter(event => {
      const eventDate = new Date(event.start_time);
      return isSameDay(eventDate, date);
    });

    // Add BuildSchedule items as synthetic events on the mini-calendar
    const buildEvents = filteredBuildScheduleItems
      .filter(b => {
        if (!b.build_date) return false;
        const bd = new Date(b.build_date + 'T08:00:00');
        return isSameDay(bd, date);
      })
      .map(b => {
        const jobLabel = Array.isArray(b.job_type) && b.job_type.length > 0 ? b.job_type.join(' & ') : 'Build';
        return {
          id: `build-${b.id}`,
          title: `🏗️ ${jobLabel}: ${b.customer_name || b.address || 'Build'}`,
          start_time: new Date(b.build_date + 'T08:00:00').toISOString(),
          color: '#f97316',
          event_type: 'build',
        };
      });

    // Add InspectionJob items as synthetic events on the mini-calendar
    const inspectEvents = inspectionJobs
      .filter(j => {
        const dateStr = j.inspection_date || j.scheduled_date;
        if (!dateStr) return false;
        const d = new Date(dateStr.length === 10 ? dateStr + 'T09:00:00' : dateStr);
        return isSameDay(d, date);
      })
      .map(j => {
        const clientName = j.client_name || j.customer_name || j.property_address || 'Inspection';
        const dateStr = j.inspection_date || j.scheduled_date;
        return {
          id: `inspect-${j.id}`,
          title: `🔍 Inspection: ${clientName}`,
          start_time: new Date(dateStr.length === 10 ? dateStr + 'T09:00:00' : dateStr).toISOString(),
          color: '#10b981',
          event_type: 'inspection',
        };
      });

    return [...baseEvents, ...buildEvents, ...inspectEvents];
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
      case 'todayFocus': {
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);

        const todayActionItems = allActionItems.filter(i => {
          if (i.status !== 'pending' && i.status !== 'overdue') return false;
          if (!i.due_at) return false;
          const d = new Date(i.due_at);
          return d <= todayEnd; // due today or overdue
        });

        const todayEvents = myCalendarEvents.filter(ev => {
          const d = ev.start_date ? new Date(ev.start_date) : (ev.start_time ? new Date(ev.start_time) : null);
          if (!d) return false;
          return d >= todayStart && d <= todayEnd;
        });

        const todayFollowups = allLeads.filter(l => {
          if (!l.next_follow_up_date) return false;
          const d = new Date(l.next_follow_up_date);
          return d >= todayStart && d <= todayEnd;
        });

        const total = todayActionItems.length + todayEvents.length + todayFollowups.length;

        content = (
          <Card
            className={`border-l-4 ${total === 0 ? 'border-l-green-500' : 'border-l-orange-500'} ${darkMode ? 'bg-slate-800 border-slate-700' : ''}`}
            data-testid="widget-today-focus"
          >
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move flex-shrink-0 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                  <Target className="w-4 h-4 text-orange-500" />
                  {t.dashboard.todaysFocus}
                  {total > 0 && (
                    <Badge className="bg-orange-100 text-orange-700 border-orange-300 text-xs ml-1">{total}</Badge>
                  )}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {total === 0 ? (
                <div className={`text-center py-3 ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
                  <CheckCircle2 className="w-7 h-7 mx-auto mb-1.5 opacity-70" />
                  <p className="font-semibold text-sm">{t.dashboard.cleanSlate}</p>
                  <p className={`text-xs mt-0.5 ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{t.dashboard.nothingUrgent}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {todayActionItems.length > 0 && (
                    <div>
                      <p className={`text-xs font-semibold mb-1.5 flex items-center gap-1 ${darkMode ? 'text-orange-400' : 'text-orange-700'}`}>
                        <CheckSquare className="w-3 h-3" /> {t.dashboard.actionItems} ({todayActionItems.length})
                      </p>
                      <div className="space-y-1">
                        {todayActionItems.slice(0, 3).map(item => (
                          <div
                            key={item.id}
                            className={`text-xs p-1.5 rounded cursor-pointer truncate ${darkMode ? 'hover:bg-slate-700 text-slate-300' : 'hover:bg-orange-50 text-gray-700'}`}
                            onClick={() => navigate(createPageUrl('ActionItems'))}
                          >
                            {item.due_at && new Date(item.due_at) < new Date() ? '🔴 ' : '🟡 '}{item.title}
                          </div>
                        ))}
                        {todayActionItems.length > 3 && (
                          <p className={`text-xs ${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>+{todayActionItems.length - 3} {t.dashboard.more}</p>
                        )}
                      </div>
                    </div>
                  )}
                  {todayEvents.length > 0 && (
                    <div>
                      <p className={`text-xs font-semibold mb-1.5 flex items-center gap-1 ${darkMode ? 'text-blue-400' : 'text-blue-700'}`}>
                        <CalendarIcon className="w-3 h-3" /> {t.dashboard.appointments} ({todayEvents.length})
                      </p>
                      <div className="space-y-1">
                        {todayEvents.slice(0, 3).map(ev => {
                          const t = ev.start_time ? new Date(ev.start_time) : null;
                          return (
                            <div key={ev.id} className={`text-xs p-1.5 rounded truncate ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>
                              📅 {ev.title}{t ? ` — ${t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {todayFollowups.length > 0 && (
                    <div>
                      <p className={`text-xs font-semibold mb-1.5 flex items-center gap-1 ${darkMode ? 'text-pink-400' : 'text-pink-700'}`}>
                        <Users className="w-3 h-3" /> {t.dashboard.followUps} ({todayFollowups.length})
                      </p>
                      <div className="space-y-1">
                        {todayFollowups.slice(0, 3).map(lead => (
                          <div
                            key={lead.id}
                            className={`text-xs p-1.5 rounded cursor-pointer truncate ${darkMode ? 'hover:bg-slate-700 text-slate-300' : 'hover:bg-pink-50 text-gray-700'}`}
                            onClick={() => navigate(createPageUrl('LeadProfile') + `?id=${lead.id}`)}
                          >
                            📞 {lead.name}
                          </div>
                        ))}
                        {todayFollowups.length > 3 && (
                          <p className={`text-xs ${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>+{todayFollowups.length - 3} {t.dashboard.more}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
        break;
      }

      case 'revenueMetrics':
        // 🔐 Show revenue metrics based on role permissions
        const canViewAllFinancials = isAdmin;
        const revenueLabel = canViewAllFinancials ? t.dashboard.invoicesAwaitingPayment : `${t.dashboard.my} ${t.dashboard.invoicesAwaitingPayment}`;
        const yearLabel = canViewAllFinancials ? `${t.common.paid} ${t.invoices.title} (${selectedYear})` : `${t.common.paid} ${t.invoices.title} (${selectedYear})`;
        const thisYearLabel = canViewAllFinancials ? `${t.dashboard.thisWeek} ${t.dashboard.revenue} (${new Date().getFullYear()})` : `${t.dashboard.my} ${t.dashboard.revenue} (${new Date().getFullYear()})`;
        
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
                <CardTitle className="text-base">{t.dashboard.leadsOverview}</CardTitle>
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
                    {new Intl.DateTimeFormat(dashboardLocale, { month: 'long', year: 'numeric' }).format(currentMonth)}
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
              <div className="overflow-x-auto">
              <div style={{minWidth:'420px'}}>
              <div className={`grid grid-cols-7 border-b ${darkMode ? 'bg-slate-900 border-slate-700' : 'bg-gray-50'}`}>
                {Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(dashboardLocale, { weekday: 'short' }).format(new Date(2024, 0, 7 + index))).map(day => (
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
                                  +{dayEvents.length - 2} {t.dashboard.more}
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
              </div>{/* /minWidth */}
              </div>{/* /overflow-x-auto */}
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
                    {t.dashboard.staleLeadsTitle}
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
                    {t.dashboard.viewLeads}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {staleLeads.length === 0 ? (
                <div className={`text-center py-4 ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-70" />
                  <p className="font-semibold text-sm">{t.dashboard.allLeadsHandled}</p>
                  <p className={`text-xs mt-1 ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{t.dashboard.noLeadsStuck}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className={`text-xs mb-2 ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {t.dashboard.noLeadsStuck}
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
                           {hoursOld}h
                        </Badge>
                      </div>
                    );
                  })}
                  {staleLeads.length > 5 && (
                    <p className={`text-xs text-center pt-1 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>
                       +{staleLeads.length - 5} {t.dashboard.moreStaleLeads}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
        break;
      }

      case 'actionItemsWidget': {
        const activeItems = allActionItems.filter(i => i.status === 'pending' || i.status === 'overdue');
        const overdueItems = activeItems.filter(i => i.due_at && new Date(i.due_at) < new Date());
        const urgentItems = activeItems.filter(i => i.priority === 'urgent' || i.priority === 'high');

        content = (
          <Card
            className={`border-l-4 ${overdueItems.length > 0 ? 'border-l-red-500' : activeItems.length > 0 ? 'border-l-blue-500' : 'border-l-green-500'} ${darkMode ? 'bg-slate-800 border-slate-700' : ''}`}
            data-testid="widget-action-items"
          >
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move flex-shrink-0 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <div className="flex items-center justify-between flex-1">
                  <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <CheckSquare className={`w-4 h-4 ${overdueItems.length > 0 ? 'text-red-500' : 'text-blue-500'}`} />
                    {t.dashboard.actionItemsTitle}
                    {activeItems.length > 0 && (
                      <Badge className={`${overdueItems.length > 0 ? 'bg-red-100 text-red-700 border-red-300' : 'bg-blue-100 text-blue-700 border-blue-300'} text-xs ml-1`}>
                        {activeItems.length}
                      </Badge>
                    )}
                  </CardTitle>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => navigate(createPageUrl('ActionItems'))}
                    className={`h-auto p-0 text-xs ${darkMode ? 'text-blue-400' : ''}`}
                  >
                    {t.dashboard.viewAll}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {activeItems.length === 0 ? (
                <div className={`text-center py-4 ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-70" />
                  <p className="font-semibold text-sm">{t.dashboard.allCaughtUp}</p>
                  <p className={`text-xs mt-1 ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{t.dashboard.noPendingActions}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {overdueItems.length > 0 && (
                    <p className="text-xs text-red-600 font-semibold">{overdueItems.length} {t.common.overdue.toLowerCase()} {t.dashboard.actionItems.toLowerCase()}</p>
                  )}
                  {[...activeItems].sort((a, b) => {
                    const aOverdue = a.due_at && new Date(a.due_at) < new Date() ? 1 : 0;
                    const bOverdue = b.due_at && new Date(b.due_at) < new Date() ? 1 : 0;
                    if (bOverdue !== aOverdue) return bOverdue - aOverdue;
                    const pOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
                    const pDiff = (pOrder[a.priority] || 2) - (pOrder[b.priority] || 2);
                    if (pDiff !== 0) return pDiff;
                    return new Date(a.due_at || '9999') - new Date(b.due_at || '9999');
                  }).slice(0, 5).map(item => {
                    const isOverdue = item.due_at && new Date(item.due_at) < new Date();
                    return (
                      <div
                        key={item.id}
                        className={`flex items-center justify-between text-sm p-2 rounded cursor-pointer ${darkMode ? 'hover:bg-slate-700' : isOverdue ? 'hover:bg-red-50 bg-red-50/50' : 'hover:bg-blue-50'}`}
                        onClick={() => navigate(createPageUrl('ActionItems'))}
                        data-testid={`action-item-row-${item.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium text-xs truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>{item.title}</p>
                          <p className={`text-xs ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                            {item.due_at ? (isOverdue ? t.common.overdue : `${t.dashboard.due} ${formatLocalizedDateTime(item.due_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`) : t.dashboard.noDueDate}
                          </p>
                        </div>
                        <Badge variant="outline" className={`text-xs whitespace-nowrap ml-2 ${
                          item.priority === 'urgent' ? 'bg-red-100 text-red-700 border-red-300' :
                          item.priority === 'high' ? 'bg-orange-100 text-orange-700 border-orange-300' :
                          'bg-gray-100 text-gray-600 border-gray-300'
                        }`}>
                          {item.priority}
                        </Badge>
                      </div>
                    );
                  })}
                  {activeItems.length > 5 && (
                    <p className={`text-xs text-center pt-1 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>
                       +{activeItems.length - 5} {t.dashboard.moreItems}
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
                    {t.dashboard.unsentDraftEstimates}
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
                    {t.dashboard.viewAll}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {draftEstimates.length === 0 ? (
                <div className={`text-center py-4 ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-70" />
                  <p className="font-semibold text-sm">{t.dashboard.noUnsentDrafts}</p>
                  <p className={`text-xs mt-1 ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{t.dashboard.allEstimatesSent}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className={`text-xs mb-2 ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {t.dashboard.draftEstimateSummary(draftEstimates.length)}
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
                        <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200 text-xs">{t.common.draft}</Badge>
                      </div>
                    </div>
                  ))}
                  {draftEstimates.length > 5 && (
                    <p className={`text-xs text-center pt-1 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>
                       +{draftEstimates.length - 5} {t.dashboard.moreDraftsWaiting}
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
        // Only count invoices that still have a real balance owed. Use total_amount
        // (canonical) minus amount_paid — never inv.amount (stale Base44 data JSONB),
        // so zero-total/overpaid imported invoices don't show as $0/negative follow-ups.
        const followUpRemaining = (inv) => (Number(inv.total_amount) || 0) - (Number(inv.amount_paid) || 0);
        const overdueInvoices = invoices.filter(inv => {
          if (inv.status === 'paid' || inv.status === 'cancelled') return false;
          if (followUpRemaining(inv) <= 0) return false;
          if (!inv.due_date) return false;
          const dueDate = new Date(inv.due_date);
          dueDate.setHours(0, 0, 0, 0);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          return dueDate < today;
        }).sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

        const partiallyPaidInvoices = invoices.filter(inv => 
          inv.status === 'partially_paid' && followUpRemaining(inv) > 0
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
                const remaining = (Number(invoice.total_amount) || 0) - (Number(invoice.amount_paid) || 0);

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
                      <p className={`text-xs ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{t.dashboard.due}</p>
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
        if (!isAdmin) { content = null; break; }
        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move flex-shrink-0 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <div className="flex items-center justify-between flex-1">
                  <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <span className={darkMode ? 'text-orange-400' : 'text-orange-600'}>⚠️</span>
                    {t.dashboard.critical} {t.dashboard.actionItems.toLowerCase()} ({criticalTasks.length})
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
                             {t.dashboard.needsAttention} {daysSinceUpdate}d
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
                  {t.dashboard.taskHealthMonitor}
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

      case 'workflowMonitor': {
        if (!isAdmin) { content = null; break; }
        const activeWfs = dashboardWorkflows.filter(w => w.is_active);
        const inactiveWfs = dashboardWorkflows.filter(w => !w.is_active);
        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move flex-shrink-0 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <div className="flex items-center justify-between flex-1">
                  <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <Zap className={`w-4 h-4 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                  {t.dashboard.workflowMonitor}
                  </CardTitle>
                  <Button variant="link" size="sm" onClick={() => navigate(createPageUrl('Workflows'))} className="h-auto p-0 text-xs">
                    {t.dashboard.viewAll}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {dashboardWorkflows.length === 0 ? (
                <div className="text-center py-6 text-gray-500">
                  <Zap className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm font-medium">{t.dashboard.noWorkflows}</p>
                  <Button variant="link" size="sm" className="text-xs mt-1" onClick={() => navigate(createPageUrl('Workflows'))}>
                    {t.dashboard.createFirstWorkflow}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div
                    className="flex items-center justify-between p-2 bg-blue-50 rounded-lg border border-blue-200 cursor-pointer hover:bg-blue-100 transition-colors"
                    onClick={() => navigate(createPageUrl('Workflows'))}
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">{t.dashboard.activeWorkflows}</p>
                      <p className="text-xs text-gray-600">{activeWfs.length} of {dashboardWorkflows.length} {t.dashboard.enabled}</p>
                    </div>
                    <Badge className="bg-blue-100 text-blue-700 text-xs">{activeWfs.length} {t.dashboard.on}</Badge>
                  </div>

                  {activeWfs.slice(0, 4).map(wf => (
                    <div
                      key={wf.id}
                      className="flex items-center justify-between p-2 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => navigate(createPageUrl('Workflows'))}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{wf.workflow_name || t.dashboard.unnamed}</p>
                        <p className="text-xs text-gray-500 capitalize">{(wf.trigger_type || '').replace(/_/g, ' ')}</p>
                      </div>
                      <Badge className="bg-green-100 text-green-700 text-xs ml-2 flex-shrink-0">{t.common.active}</Badge>
                    </div>
                  ))}

                  {inactiveWfs.length > 0 && (
                    <p className="text-xs text-gray-400 text-center pt-1">
                      {inactiveWfs.length} {t.dashboard.paused}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
        break;
      }

      case 'aiRecommendations':
        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                  <Target className={`w-4 h-4 ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`} />
                  {t.dashboard.aiRecommendations}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {aiRecommendations.map((rec, index) => {
                // Determine navigation target based on recommendation type
                let targetUrl = createPageUrl('Dashboard');
                if (rec.target === 'tasks') {
                  targetUrl = createPageUrl('Tasks') + '?filter=critical';
                } else if (rec.target === 'invoices') {
                  targetUrl = createPageUrl('Invoices') + '?status=overdue';
                } else if (rec.target === 'leads') {
                  targetUrl = createPageUrl('Leads') + '?filter=stale';
                } else if (rec.target === 'estimates') {
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
        if (!isAdmin) { content = null; break; }
        const installsRepairs = filteredBuildScheduleItems.filter(b =>
          b.status !== 'completed' && b.status !== 'cancelled'
        ).sort((a, b) => {
          if (a.build_date && b.build_date) return new Date(a.build_date) - new Date(b.build_date);
          if (a.build_date) return -1;
          if (b.build_date) return 1;
          return 0;
        });

        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move flex-shrink-0 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <div className="flex items-center justify-between flex-1">
                  <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <span className={darkMode ? 'text-blue-400' : 'text-blue-600'}>🔧</span>
                    {t.dashboard.pendingInstallsRepairs} ({installsRepairs.length})
                  </CardTitle>
                  <Button variant="link" size="sm" onClick={() => navigate(createPageUrl('BuildSchedule'))} className="h-auto p-0 text-xs">
                    {t.dashboard.viewAll}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {installsRepairs.slice(0, 5).map((build) => {
                const daysUntil = build.build_date
                  ? Math.floor((new Date(build.build_date) - new Date()) / (1000 * 60 * 60 * 24))
                  : null;
                const jobLabel = Array.isArray(build.job_type) && build.job_type.length > 0
                  ? build.job_type.join(' & ')
                   : t.dashboard.job;
                const statusColors = {
                  scheduled: 'bg-blue-100 text-blue-700',
                  in_progress: 'bg-yellow-100 text-yellow-700',
                  on_hold: 'bg-orange-100 text-orange-700',
                };
                return (
                  <div
                    key={build.id}
                    className="flex items-start gap-2 pb-2 border-b last:border-0 cursor-pointer hover:bg-gray-50 p-2 rounded"
                    onClick={() => navigate(createPageUrl('BuildSchedule'))}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-xs truncate">{build.customer_name || t.dashboard.customer}</p>
                      <p className="text-xs text-gray-500 truncate">{jobLabel}{build.address ? ` · ${build.address}` : ''}</p>
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        {daysUntil !== null && (
                          <Badge variant="outline" className={`text-xs ${
                            daysUntil < 0 ? 'bg-red-100 text-red-700' :
                            daysUntil === 0 ? 'bg-orange-100 text-orange-700' :
                            daysUntil <= 3 ? 'bg-yellow-100 text-yellow-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>
                            {daysUntil < 0 ? t.dashboard.daysOverdueShort(Math.abs(daysUntil)) :
                             daysUntil === 0 ? t.dashboard.today :
                             t.dashboard.inDays(daysUntil)}
                          </Badge>
                        )}
                        <Badge variant="outline" className={`text-xs ${statusColors[build.status] || 'bg-gray-100 text-gray-700'}`}>
                          {(build.status || 'scheduled').replace(/_/g, ' ')}
                        </Badge>
                      </div>
                    </div>
                  </div>
                );
              })}
              {installsRepairs.length === 0 && (
                <div className="text-center py-6 text-green-600">
                  <p className="font-semibold text-sm">{t.dashboard.noPendingInstalls}</p>
                  <p className="text-xs text-gray-500 mt-1">{t.dashboard.nothingScheduled}</p>
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
                     {t.dashboard.estimatesExpiringSoon} ({expiringEstimates.length})
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

      case 'repPipelineWidget': {
        const pipelineDisplayValue = isAdmin ? repPendingPipeline.total : repPendingPipeline.repTotal;
        const pipelineLabel = isAdmin ? t.dashboard.companyCommissionPipeline : t.dashboard.myPendingCommission;
        const pipelineSubLabel = isAdmin ? t.dashboard.totalAcrossReps : t.dashboard.pendingInvoiceCommissions;
        const myStaffHasRate = myStaffProfile?.commission_rate > 0;
        if (!isAdmin && !myStaffHasRate) break;
        const hasBreakdown = !isAdmin && repPendingPipeline.myLines.length > 0;

        content = (
          <Card
            className={`hover:shadow-md transition-shadow ${darkMode ? 'bg-slate-800 border-slate-700' : ''}`}
            data-testid="widget-rep-pipeline"
          >
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                  <TrendingUp className={`w-4 h-4 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`} />
                  {pipelineLabel}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <button
                className={`w-full text-left p-3 rounded-lg border transition-colors ${darkMode ? 'bg-amber-900/20 border-amber-800 hover:bg-amber-900/30' : 'bg-gradient-to-br from-amber-50 to-yellow-50 border-amber-200 hover:from-amber-100 hover:to-yellow-100'} ${hasBreakdown ? 'cursor-pointer' : 'cursor-default'}`}
                onClick={hasBreakdown ? () => setShowPipelineSheet(true) : () => navigate(createPageUrl('CommissionReport'))}
                data-testid="btn-pipeline-breakdown"
              >
                <p className={`text-xs ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>{t.dashboard.pendingInPipeline}</p>
                <p className={`text-2xl font-bold ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                  ${pipelineDisplayValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </p>
                <p className={`text-xs mt-1 ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>
                  {t.dashboard.invoicesCount(repPendingPipeline.count)} · {hasBreakdown ? t.dashboard.tapToSeeBreakdown : pipelineSubLabel}
                </p>
              </button>
              <button
                onClick={() => navigate(createPageUrl('CommissionReport'))}
                className={`flex items-center gap-1 text-xs w-full ${darkMode ? 'text-amber-400 hover:text-amber-300' : 'text-amber-700 hover:text-amber-900'} transition-colors`}
                data-testid="btn-pipeline-view-report"
              >
                <ExternalLink className="w-3 h-3" />
                <span>{t.dashboard.viewCommissionReport}</span>
              </button>
            </CardContent>
          </Card>
        );
        break;
      }

      case 'salesPipelineValue':
        if (!isAdmin) { content = null; break; }
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
                  {t.dashboard.salesPipelineValue}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className={`p-2 rounded-lg border ${darkMode ? 'bg-green-900/20 border-green-800' : 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-200'}`}>
                <p className={`text-xs ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>{t.dashboard.totalPipeline}</p>
                <p className={`text-xl font-bold ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
                  ${totalPipelineValue.toLocaleString('en-US', {minimumFractionDigits: 0})}
                </p>
                <p className={`text-xs ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>
                  {pipelineEstimates.length + pipelineProposals.length} {t.dashboard.pendingCount}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className={`p-2 rounded-lg border ${darkMode ? 'bg-blue-900/20 border-blue-800' : 'bg-blue-50 border-blue-200'}`}>
                  <p className={`text-xs ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>{t.dashboard.pendingLabel}</p>
                  <p className={`text-sm font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>${pipelineEstimates.reduce((s, e) => s + Number(e.amount || 0), 0).toLocaleString()}</p>
                </div>
                <div className={`p-2 rounded-lg border ${darkMode ? 'bg-purple-900/20 border-purple-800' : 'bg-purple-50 border-purple-200'}`}>
                  <p className={`text-xs ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>{t.dashboard.acceptedLabel}</p>
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
                  <p className={`text-xs font-medium ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>{t.dashboard.estimateToInvoice}</p>
                  <Badge className={`text-xs ${darkMode ? 'bg-blue-900/50 text-blue-400 border-blue-700' : 'bg-blue-100 text-blue-700'}`}>{estimateConversionRate}%</Badge>
                </div>
                <Progress value={parseFloat(estimateConversionRate)} className={`h-1.5 ${darkMode ? 'bg-slate-700 [&>div]:bg-blue-400' : '[&>div]:bg-blue-600'}`} />
              </div>

              <div className={`p-2 rounded-lg border ${darkMode ? 'bg-purple-900/20 border-purple-800' : 'bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200'}`}>
                <div className="flex items-center justify-between mb-1">
                  <p className={`text-xs font-medium ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>{t.dashboard.leadToCustomer}</p>
                  <Badge className={`text-xs ${darkMode ? 'bg-purple-900/50 text-purple-400 border-purple-700' : 'bg-purple-100 text-purple-700'}`}>{leadConversionRate}%</Badge>
                </div>
                <Progress value={parseFloat(leadConversionRate)} className={`h-1.5 ${darkMode ? 'bg-slate-700 [&>div]:bg-purple-400' : '[&>div]:bg-purple-600'}`} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className={`text-center p-1.5 rounded ${darkMode ? 'bg-green-900/20' : 'bg-green-50'}`}>
                  <div className={`text-lg font-bold ${darkMode ? 'text-green-400' : 'text-green-600'}`}>{yearFilteredEstimates.filter(e => e.status === 'accepted').length}</div>
                  <div className={`text-xs ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>{t.dashboard.acceptedLabel}</div>
                </div>
                <div className={`text-center p-1.5 rounded ${darkMode ? 'bg-red-900/20' : 'bg-red-50'}`}>
                  <div className={`text-lg font-bold ${darkMode ? 'text-red-400' : 'text-red-600'}`}>{yearFilteredEstimates.filter(e => e.status === 'declined').length}</div>
                  <div className={`text-xs ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>{t.dashboard.declinedLabel}</div>
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
        if (!isAdmin) { content = null; break; }
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
        const todayDate = localToday();
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
          scheduled: t.dashboard.scheduled, confirmed: t.dashboard.confirmed, in_progress: t.dashboard.inProgress,
          postponed: t.dashboard.postponed, completed: t.dashboard.completed, cancelled: t.dashboard.cancelled,
        };

        content = (
          <Card className={darkMode ? 'bg-slate-800 border-slate-700' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move flex-shrink-0 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                <div className="flex items-center justify-between flex-1">
                  <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <span className={darkMode ? 'text-blue-400' : 'text-blue-600'}>🏗️</span>
                    {t.dashboard.buildSchedule || t.sidebar.buildSchedule} ({weekBuilds.length})
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
                  {t.dashboard.noBuildsScheduled}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className={darkMode ? 'border-b border-slate-700' : 'border-b'}>
                        <th className={`text-left px-2 py-1.5 font-medium ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{t.dashboard.date}</th>
                        <th className={`text-left px-2 py-1.5 font-medium ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{t.dashboard.customerLabel}</th>
                        <th className={`text-left px-2 py-1.5 font-medium ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{t.dashboard.type}</th>
                        <th className={`text-left px-2 py-1.5 font-medium ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{t.dashboard.rep}</th>
                        <th className={`text-left px-2 py-1.5 font-medium ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{t.dashboard.crew}</th>
                        <th className={`text-left px-2 py-1.5 font-medium ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{t.dashboard.address}</th>
                        <th className={`text-left px-2 py-1.5 font-medium ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{t.dashboard.status}</th>
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
                              {build.build_date ? formatLocalizedDate(build.build_date + 'T12:00:00', { month: 'short', day: 'numeric' }) : '—'}
                              {isToday && <Badge className="text-[8px] bg-blue-600 ml-1 py-0 px-0.5">{t.dashboard.todayUpper}</Badge>}
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

      case 'remindersWidget': {
        const now = new Date();
        const cutoff30 = subDays(now, 30);
        const myRemindTasks = tasks.filter(t =>
          t.due_date && !t.is_archived &&
          t.column !== 'job_completed' && t.status !== 'job_completed' &&
          new Date(t.due_date) >= cutoff30
        );
        const overdueRemind = myRemindTasks.filter(t => new Date(t.due_date) < now);
        const todayRemind = myRemindTasks.filter(t => {
          const d = new Date(t.due_date);
          return d >= now && d < new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        });
        const totalRemind = myRemindTasks.length;
        const borderColor = overdueRemind.length > 0 ? 'border-l-yellow-500' : totalRemind > 0 ? 'border-l-blue-500' : 'border-l-green-500';

        content = (
          <Card className={`border-l-4 ${borderColor} ${darkMode ? 'bg-slate-800 border-slate-700' : ''} cursor-pointer hover:shadow-md transition-shadow`} onClick={() => navigate(createPageUrl('Reminders'))} data-testid="widget-reminders">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <GripVertical className={`w-4 h-4 cursor-move flex-shrink-0 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`} onClick={e => e.stopPropagation()} />
                <div className="flex items-center justify-between flex-1">
                  <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <Bell className={`w-4 h-4 ${overdueRemind.length > 0 ? 'text-yellow-500' : 'text-blue-500'}`} />
                    {t.dashboard.reminders}
                    {totalRemind > 0 && (
                      <Badge className={`${overdueRemind.length > 0 ? 'bg-yellow-100 text-yellow-700 border-yellow-300' : 'bg-blue-100 text-blue-700 border-blue-300'} text-xs ml-1`}>
                        {totalRemind}
                      </Badge>
                    )}
                  </CardTitle>
                  <Button variant="link" size="sm" onClick={e => { e.stopPropagation(); navigate(createPageUrl('Reminders')); }} className={`h-auto p-0 text-xs ${darkMode ? 'text-blue-400' : ''}`}>
                    {t.dashboard.viewAll}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {totalRemind === 0 ? (
                <div className={`text-center py-4 ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-70" />
                  <p className="font-semibold text-sm">{t.dashboard.allCaughtUp}</p>
                  <p className={`text-xs mt-1 ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{t.dashboard.noPendingReminders}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {overdueRemind.length > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5 text-red-600 font-semibold">
                        <AlertCircle className="w-3.5 h-3.5" />
                         {t.dashboard.overdueTasks(overdueRemind.length)}
                      </span>
                    </div>
                  )}
                  {todayRemind.length > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className={`flex items-center gap-1.5 font-medium ${darkMode ? 'text-orange-400' : 'text-orange-600'}`}>
                        <Clock className="w-3.5 h-3.5" />
                         {t.dashboard.dueToday(todayRemind.length)}
                      </span>
                    </div>
                  )}
                  {myRemindTasks.slice(0, 3).map(t => (
                    <div key={t.id} className={`text-xs px-2 py-1.5 rounded flex items-center gap-2 ${darkMode ? 'bg-slate-700 text-slate-300' : 'bg-gray-50 text-gray-700'}`}>
                      <Bell className="w-3 h-3 shrink-0 text-blue-400" />
                      <span className="truncate">{t.name}</span>
                      <span className={`ml-auto shrink-0 ${new Date(t.due_date) < now ? 'text-red-500' : darkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                        {format(new Date(t.due_date), 'MMM d')}
                      </span>
                    </div>
                  ))}
                  {totalRemind > 3 && (
                     <p className={`text-xs text-center pt-1 ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{t.dashboard.moreInReminders(totalRemind - 3)}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
        break;
      }

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
    return <div className="p-3 sm:p-6 text-center text-gray-500">Redirecting to Admin Dashboard...</div>;
  }

  // Do not hold the entire dashboard behind the largest two collection
  // requests. Customers and invoices can contain thousands of records, and
  // the screenshot-worthy blank skeleton made login feel stalled even though
  // the company context and dashboard shell were already available. The
  // widgets use their empty states while these queries fill in, then update
  // automatically when the results arrive.
  if (isDataLoading || (user && !myCompany)) {
    return <DashboardSkeleton />;
  }

  return (
    <div className={`p-2 sm:p-3 lg:p-4 min-h-screen transition-colors ${darkMode ? 'bg-slate-900' : 'bg-gray-50'}`}>
      {(!isDashboardDataReady || isLoadingInvoices || isLoadingCustomers) && (
        <div className={`mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
          darkMode
            ? 'border-slate-700 bg-slate-800 text-slate-300'
            : 'border-blue-100 bg-blue-50 text-blue-700'
        }`}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {!isDashboardDataReady ? 'Preparing the dashboard…' : 'Loading the latest dashboard totals…'}
        </div>
      )}

      {/* Google Calendar revoked its token — appointments are silently not syncing.
          Renders nothing when the calendar is healthy or was never connected. */}
      <div className="mb-3 empty:hidden">
        <GoogleCalendarReconnectBanner />
      </div>

      {/* ── Collections Alert Popup ── */}
      {/* Mobile: compact tap-to-dismiss banner — avoids blocking the initial render */}
      {isMobile && showCollectionsAlert && allOverdueInvoices.length > 0 && (
        <div className="fixed left-3 right-3 z-50 bg-red-600 text-white rounded-xl shadow-lg px-4 py-3 flex items-center justify-between gap-3" style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}>
          <div className="min-w-0">
            <p className="font-semibold text-sm leading-tight">
              💰 {allOverdueInvoices.length} overdue invoice{allOverdueInvoices.length !== 1 ? 's' : ''}
            </p>
            <p className="text-xs text-red-100 mt-0.5">
              ${overdueAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} outstanding
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              className="text-xs bg-white text-red-600 font-semibold px-3 py-1.5 rounded-lg"
              onClick={() => {
                localStorage.setItem('collections_alert_dismissed', new Date().toDateString());
                setShowCollectionsAlert(false);
                navigate(createPageUrl('Invoices'));
              }}
            >
              View
            </button>
            <button
              className="text-red-200 hover:text-white text-lg leading-none px-1"
              onClick={() => {
                localStorage.setItem('collections_alert_dismissed', new Date().toDateString());
                setShowCollectionsAlert(false);
              }}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Desktop: modal dialog (dismissible via outside-click or Escape) */}
      <Dialog open={!isMobile && showCollectionsAlert && allOverdueInvoices.length > 0} onOpenChange={(open) => {
        if (!open) setShowCollectionsAlert(false);
      }}>
        <DialogContent
          className="max-w-md"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <span className="text-xl">💰</span> Outstanding Invoices
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-center">
              <p className="text-2xl font-bold text-red-600">
                ${overdueAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-sm text-red-500 mt-0.5">
                {allOverdueInvoices.length} invoice{allOverdueInvoices.length !== 1 ? 's' : ''} past due
              </p>
            </div>

            <div className="space-y-1 max-h-40 overflow-y-auto">
              {[...allOverdueInvoices]
                .sort((a, b) => getDaysOverdue(b) - getDaysOverdue(a))
                .slice(0, 6)
                .map((inv) => {
                  const remaining = getInvoiceBalance(inv);
                  const daysOverdue = getDaysOverdue(inv);
                  return (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between text-sm px-3 py-2 bg-gray-50 rounded cursor-pointer hover:bg-gray-100"
                      onClick={() => { navigate(createPageUrl('invoice-details') + '?id=' + inv.id); setShowCollectionsAlert(false); }}
                    >
                      <div>
                        <span className="font-medium">{inv.invoice_number || 'Invoice'}</span>
                        <span className="text-gray-500 ml-1.5">— {inv.customer_name || t.dashboard.customer}</span>
                        {daysOverdue > 0 && (
                          <span className="ml-1.5 text-xs text-red-500 font-medium">{daysOverdue}d overdue</span>
                        )}
                      </div>
                      <span className="font-bold text-red-600">${remaining.toFixed(0)}</span>
                    </div>
                  );
                })}
            </div>

            {allOverdueInvoices.length > 6 && (
              <p className="text-xs text-gray-500 text-center">
                +{allOverdueInvoices.length - 6} {t.dashboard.more} — {t.dashboard.viewAllBelow}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1 text-sm"
                onClick={() => {
                  localStorage.setItem('collections_alert_dismissed', new Date().toDateString());
                  setShowCollectionsAlert(false);
                }}
              >
                {t.dashboard.dismissForToday}
              </Button>
              <Button
                className="flex-1 text-sm bg-red-600 hover:bg-red-700 text-white"
                onClick={() => {
                  localStorage.setItem('collections_alert_dismissed', new Date().toDateString());
                  setShowCollectionsAlert(false);
                  navigate(createPageUrl('Invoices'));
                }}
              >
                {t.dashboard.goCollect}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <div>
          <h1 className={`text-xl sm:text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{t.dashboard.title}</h1>
          <p className={`text-xs sm:text-sm ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{t.dashboard.welcomeBack}, {myStaffProfile?.full_name || user?.full_name || t.common.name}</p>
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={selectedYear}
            onValueChange={(value) => setSelectedYear(value)}
          >
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue placeholder={t.dashboard.year} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.dashboard.allYears}</SelectItem>
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
                {t.dashboard.customize}
              </Button>
            </SheetTrigger>
            <SheetContent className="flex flex-col h-full overflow-hidden">
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
              <div className="mt-6 flex-1 overflow-y-auto pr-1">
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
                            aiTaskHealth: t.dashboard.taskHealthMonitor,
                            aiRecommendations: t.dashboard.aiRecommendations,
                            repPipelineWidget: t.dashboard.myPendingCommission,
                            salesPipelineValue: t.dashboard.salesPipelineValue,
                            revenueMetrics: t.dashboard.revenue,
                            conversionMetrics: t.dashboard.conversionMetrics,
                            calendar: t.calendar.title,
                            invoicesNeedingFollowUp: t.dashboard.invoicesAwaitingPayment,
                            estimateOverview: t.estimates.title + ' Overview',
                            criticalJobsPending: t.dashboard.critical,
                            pendingInstallsRepairs: t.dashboard.pendingInstallsRepairs,
                            estimatesExpiringSoon: t.dashboard.estimatesExpiringSoon,
                            workflowMonitor: t.dashboard.workflowMonitor,
                            topPerformers: t.dashboard.topPerformers,
                            leadsOverview: t.dashboard.leadsOverview,
                            actionItemsWidget: t.dashboard.actionItemsTitle,
                            staleLeadsAlert: t.dashboard.staleLeadsTitle,
                            draftEstimatesAlert: t.dashboard.draftEstimatesAlert,
                            projectStatus: t.projects.title + ' ' + t.common.status,
                            recentActivity: t.dashboard.recentActivity,
                            usageCredits: t.dashboard.usageCredits,
                            buildSchedule: t.dashboard.thisWeekBuilds,
                            remindersWidget: t.dashboard.reminders,
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
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t.dashboard.saving}</>
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
        // Use rolling 7-day window (matches Build Schedule page "This Week" stat)
        // so jobs appearing in Build Schedule always appear here too.
        const wkStartStr = todayStr;
        const wkEndStr = format(new Date(today.getTime() + 7 * 86400000), 'yyyy-MM-dd');

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

         const fmtDate = (d) => d ? formatLocalizedDate(d + 'T12:00:00', { weekday: 'short', month: 'short', day: 'numeric' }) : '—';

        const BSC = { scheduled: 'bg-blue-100 text-blue-700', confirmed: 'bg-green-100 text-green-700', in_progress: 'bg-yellow-100 text-yellow-700', postponed: 'bg-orange-100 text-orange-700', completed: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-red-100 text-red-700' };
         const BUILD_STATUS_LABELS = { scheduled: t.dashboard.scheduled, confirmed: t.dashboard.confirmed, in_progress: t.dashboard.inProgress, postponed: t.dashboard.postponed, completed: t.dashboard.completed, cancelled: t.dashboard.cancelled };
        const ISC = { assigned: 'bg-blue-100 text-blue-700', in_progress: 'bg-yellow-100 text-yellow-700', completed: 'bg-green-100 text-green-700', draft: 'bg-gray-100 text-gray-600', cancelled: 'bg-red-100 text-red-700' };

        return (
          <div className="space-y-3 mb-4" data-testid="weekly-ops-panel">
            {/* Pulsing TODAY Alert Banner — only shown when items exist today */}
            {hasTodayItems && (
              <div className={`flex items-start gap-3 p-3 rounded-lg border-2 ${darkMode ? 'bg-amber-950/40 border-amber-500/60' : 'bg-amber-50 border-amber-400'}`} data-testid="banner-today-alert">
                <div className="animate-pulse flex-shrink-0 mt-0.5 text-xl">🔔</div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                     {todayCount} {t.dashboard.actionItems.toLowerCase()} {t.dashboard.today.toLowerCase()}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {todayBuilds.map(b => (
                      <span key={b.id} className={`text-xs px-2 py-0.5 rounded-full font-medium ${darkMode ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-700'}`} data-testid={`today-build-${b.id}`}>
                         🏗️ {b.customer_name || t.dashboard.job}{b.address ? ` — ${b.address}` : ''}
                      </span>
                    ))}
                    {todayInspections.map(j => (
                      <span key={j.id} className={`text-xs px-2 py-0.5 rounded-full font-medium ${darkMode ? 'bg-emerald-900/50 text-emerald-300' : 'bg-emerald-100 text-emerald-700'}`} data-testid={`today-inspection-${j.id}`}>
                         🔍 {j.customer_name || j.address || t.dashboard.thisWeekInspections}
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
                      <span>🏗️</span> {t.dashboard.thisWeekBuilds}
                      <Badge className={`text-xs ${weekBuilds.length > 0 ? 'bg-blue-600 text-white' : darkMode ? 'bg-slate-700 text-slate-400' : 'bg-gray-100 text-gray-600'}`}>{weekBuilds.length}</Badge>
                    </CardTitle>
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={(e) => { e.stopPropagation(); navigate(createPageUrl('BuildSchedule')); }} data-testid="link-week-builds-view-all">{t.dashboard.viewAll}</Button>
                  </div>
                </CardHeader>
                {buildsOpen && (
                <CardContent className="px-4 pb-3">
                  {weekBuilds.length === 0 ? (
                    <p className={`text-xs py-2 text-center ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{t.dashboard.noBuildsThisWeek}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {weekBuilds.slice(0, 5).map(b => {
                        const isToday = b.build_date === todayStr;
                        return (
                          <div key={b.id} className={`flex items-center gap-2 p-1.5 rounded-md text-xs ${isToday ? darkMode ? 'bg-blue-900/30' : 'bg-blue-50' : darkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-50'}`}
                            data-testid={`week-build-${b.id}`}>
                            {isToday && <span className="animate-pulse w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />}
                            <span className={`w-16 flex-shrink-0 ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{fmtDate(b.build_date)}</span>
                            <span
                              className={`font-medium flex-1 truncate cursor-pointer hover:underline ${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'}`}
                              onClick={e => { e.stopPropagation(); navigate(createPageUrl('CustomerProfile') + (b.customer_id ? `?id=${b.customer_id}` : `?name=${encodeURIComponent(b.customer_name)}`)); }}
                              data-testid={`build-customer-link-${b.id}`}
                            >{b.customer_name || '—'}</span>
                            <span className={`truncate max-w-[80px] ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{Array.isArray(b.job_type) ? b.job_type[0] : b.job_type || '—'}</span>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border cursor-pointer hover:opacity-80 focus:outline-none flex-shrink-0 ${BSC[b.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}
                                  data-testid={`status-badge-build-${b.id}`}
                                  onClick={e => e.stopPropagation()}
                                >
                                  {BUILD_STATUS_LABELS[b.status] || b.status || '—'}
                                  <ChevronDown className="w-3 h-3 opacity-60" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                 <DropdownMenuLabel className="text-[10px] text-gray-500">{t.dashboard.moveTo || 'Move to:'}</DropdownMenuLabel>
                                {Object.entries(BUILD_STATUS_LABELS).map(([val, label]) => (
                                  <DropdownMenuItem key={val}
                                    className={`text-xs gap-2 ${b.status === val ? 'font-semibold bg-blue-50' : ''}`}
                                    onClick={() => updateBuildStatusMutation.mutate({ id: b.id, status: val })}
                                    data-testid={`build-status-option-${val}`}>
                                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{background: val === 'scheduled' ? '#93c5fd' : val === 'confirmed' ? '#86efac' : val === 'in_progress' ? '#fde68a' : val === 'postponed' ? '#fdba74' : val === 'completed' ? '#6ee7b7' : '#fca5a5'}} />
                                    {label}
                                    {b.status === val && <span className="ml-auto">✓</span>}
                                  </DropdownMenuItem>
                                ))}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-xs gap-2" onClick={() => navigate(createPageUrl('BuildSchedule'))} data-testid={`build-open-${b.id}`}>
                                   <ExternalLink className="w-3 h-3" /> {t.dashboard.openBuildSchedule || t.dashboard.viewAll}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        );
                      })}
                       {weekBuilds.length > 5 && <p className={`text-xs text-center pt-1 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>+{weekBuilds.length - 5} {t.dashboard.more}</p>}
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
                      <span>🔍</span> {t.dashboard.thisWeekInspections}
                      <Badge className={`text-xs ${weekInspections.length > 0 ? 'bg-emerald-600 text-white' : darkMode ? 'bg-slate-700 text-slate-400' : 'bg-gray-100 text-gray-600'}`}>{weekInspections.length}</Badge>
                    </CardTitle>
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={(e) => { e.stopPropagation(); navigate(createPageUrl('InspectionsDashboard')); }} data-testid="link-week-inspections-view-all">{t.dashboard.viewAll}</Button>
                  </div>
                </CardHeader>
                {inspectionsOpen && (
                <CardContent className="px-4 pb-3">
                  {weekInspections.length === 0 ? (
                    <p className={`text-xs py-2 text-center ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{t.dashboard.noInspectionsThisWeek}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {weekInspections.slice(0, 5).map(j => {
                        const jDate = j.inspection_date || j.scheduled_date || (j.created_date ? j.created_date.slice(0, 10) : null);
                        const isToday = jDate === todayStr;
                        const inspectorProfile = staffProfiles.find(s => s.user_email === j.assigned_to_email);
                        const inspectorName = inspectorProfile?.full_name || j.assigned_to_email?.split('@')[0] || '—';
                        const clientName = j.client_name || j.customer_name || '—';
                        const address = j.property_address || j.address || '';
                         const INSP_STATUS_LABELS = { assigned: t.dashboard.assignedTo.replace(/:$/, ''), in_progress: t.dashboard.inProgress, completed: t.dashboard.completed, draft: t.common.draft, cancelled: t.dashboard.cancelled };
                        const INSP_STATUS_DOTS = { assigned: '#93c5fd', in_progress: '#fde68a', completed: '#6ee7b7', draft: '#d1d5db', cancelled: '#fca5a5' };
                        return (
                          <div key={j.id} className={`flex items-start gap-2 p-2 rounded-md text-xs ${isToday ? darkMode ? 'bg-emerald-900/30' : 'bg-emerald-50' : darkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-50'}`}
                            data-testid={`week-inspection-${j.id}`}>
                            {isToday && <span className="animate-pulse w-2 h-2 rounded-full bg-green-500 flex-shrink-0 mt-1" />}
                            <span className={`w-14 flex-shrink-0 ${darkMode ? 'text-slate-400' : 'text-gray-500'}`}>{fmtDate(jDate)}</span>
                            <div className="flex-1 min-w-0">
                              <p
                                className={`font-medium truncate cursor-pointer hover:underline ${darkMode ? 'text-emerald-400 hover:text-emerald-300' : 'text-emerald-700 hover:text-emerald-900'}`}
                                onClick={e => { e.stopPropagation(); navigate(createPageUrl('InspectionCapture') + `?jobId=${j.id}`); }}
                                data-testid={`inspection-client-link-${j.id}`}
                              >{clientName}</p>
                              {address && <p className={`truncate ${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>{address}</p>}
                              <p className={`${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>👤 {inspectorName}</p>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border cursor-pointer hover:opacity-80 focus:outline-none flex-shrink-0 mt-0.5 ${ISC[j.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}
                                  data-testid={`status-badge-inspection-${j.id}`}
                                  onClick={e => e.stopPropagation()}
                                >
                                  {INSP_STATUS_LABELS[j.status] || j.status || '—'}
                                  <ChevronDown className="w-3 h-3 opacity-60" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                 <DropdownMenuLabel className="text-[10px] text-gray-500">{t.dashboard.moveTo || 'Move to:'}</DropdownMenuLabel>
                                {Object.entries(INSP_STATUS_LABELS).map(([val, label]) => (
                                  <DropdownMenuItem key={val}
                                    className={`text-xs gap-2 ${j.status === val ? 'font-semibold bg-emerald-50' : ''}`}
                                    onClick={() => updateInspectionStatusMutation.mutate({ id: j.id, status: val })}
                                    data-testid={`inspection-status-option-${val}`}>
                                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: INSP_STATUS_DOTS[val] || '#d1d5db' }} />
                                    {label}
                                    {j.status === val && <span className="ml-auto">✓</span>}
                                  </DropdownMenuItem>
                                ))}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-xs gap-2" onClick={() => navigate(createPageUrl('InspectionsDashboard'))} data-testid={`inspection-open-${j.id}`}>
                                  <ExternalLink className="w-3 h-3" /> Open in Inspections
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        );
                      })}
                       {weekInspections.length > 5 && <p className={`text-xs text-center pt-1 ${darkMode ? 'text-slate-500' : 'text-gray-400'}`}>+{weekInspections.length - 5} {t.dashboard.more}</p>}
                    </div>
                  )}
                </CardContent>
                )}
              </Card>
            </div>
          </div>
        );
      })()}

      {/* Top 5 Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <SmallMetricCard title={t.dashboard.invoicesAwaitingPayment} value={invoicesAwaitingPaymentCount} total={yearFilteredInvoices.length} icon={FileText} color="blue" darkMode={darkMode} />
        <SmallMetricCard title={t.dashboard.convertedLeads} value={convertedLeads} total={yearFilteredLeads.length} icon={TrendingUp} color="green" darkMode={darkMode} />
        <SmallMetricCard title={t.customers.totalCustomers} value={customers.length} icon={Users} color="blue" darkMode={darkMode} />
        <SmallMetricCard title={t.dashboard.projectsInProgress} value={projectsInProgress} total={yearFilteredProjects.length} icon={Briefcase} color="orange" darkMode={darkMode} />
        <SmallMetricCard title={t.dashboard.tasksNotFinished} value={tasksNotFinished} total={yearFilteredTasks.length} icon={CheckSquare} color="purple" darkMode={darkMode} />
      </div>

      {/* Proposal, Invoice & Estimate Overview - 3 columns on same line */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {/* Leads Pipeline */}
        <Card className={darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white'}>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className={`text-lg font-semibold ${darkMode ? 'text-white' : ''}`}>{t.sidebar.leads} Pipeline <span className="text-sm font-normal text-gray-400">({selectedYear === 'all' ? t.dashboard.allYears : selectedYear})</span></CardTitle>
            <Button variant="link" size="sm" onClick={() => navigate(createPageUrl('Leads'))} className={darkMode ? 'text-blue-400' : ''}>
              {t.dashboard.viewAll}
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: t.leads?.newLead || 'New', count: leadsNewCount, color: '[&>div]:bg-gray-400' },
              { label: t.leads?.contacted || 'Contacted', count: leadsContactedCount, color: '[&>div]:bg-blue-400' },
              { label: t.leads?.qualified || 'Qualified', count: leadsQualifiedCount, color: '[&>div]:bg-indigo-500' },
              { label: t.leads?.proposalSent || 'Proposal', count: leadsProposalCount, color: '[&>div]:bg-orange-400' },
              { label: t.leads?.negotiation || 'Negotiation', count: leadsNegotiationCount, color: '[&>div]:bg-yellow-500' },
              { label: t.leads?.won || 'Won', count: convertedLeads, color: '[&>div]:bg-green-500' },
              { label: t.leads?.lost || 'Lost', count: leadsLostCount, color: '[&>div]:bg-red-400' },
            ].map(({ label, count, color }) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className={`text-sm ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>{count} {label}</span>
                  <span className={`text-sm ${darkMode ? 'text-slate-500' : 'text-gray-500'}`}>{yearFilteredLeads.length > 0 ? ((count / yearFilteredLeads.length) * 100).toFixed(0) : 0}%</span>
                </div>
                {count > 0 && (
                  <Progress value={(count / yearFilteredLeads.length) * 100 || 0} className={`h-1.5 bg-gray-200 ${color}`} />
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Invoice Overview */}
        <Card className={darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white'}>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className={`text-lg font-semibold ${darkMode ? 'text-white' : ''}`}>{t.invoices.title} {t.common.status} <span className="text-sm font-normal text-gray-400">({selectedYear === 'all' ? t.dashboard.allYears : selectedYear})</span></CardTitle>
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
                <span className={`text-sm ${darkMode ? 'text-slate-300' : 'text-gray-700'}`}>{invoiceStats.sent} {t.common.sent}</span>
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
            <CardTitle className={`text-lg font-semibold ${darkMode ? 'text-white' : ''}`}>{t.estimates.title} {t.common.status} <span className="text-sm font-normal text-gray-400">({selectedYear === 'all' ? t.dashboard.allYears : selectedYear})</span></CardTitle>
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
            <DialogTitle>{t.dashboard.dayEvents}</DialogTitle>
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
                       return !isNaN(date.getTime()) ? formatLocalizedDateTime(date, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
                    } catch (e) { return ''; }
                  })()}
                </div>
              </div>
            ))}
            {dayEventsList.length === 0 && (
              <p className="text-sm text-gray-500">{t.dashboard.noEventsForDay}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={selectedEvent !== null} onOpenChange={() => setSelectedEvent(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl">{selectedEvent?.title}</DialogTitle>
          </DialogHeader>
          {selectedEvent && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-gray-600">
                <CalendarIcon className="w-5 h-5" />
                <div>
                  <div className="font-medium">
                    {(() => {
                      try {
                        const date = new Date(selectedEvent.start_time);
                        return !isNaN(date.getTime()) ? formatLocalizedDate(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : t.dashboard.invalidDate;
                      } catch (e) { return t.dashboard.invalidDate; }
                    })()}
                  </div>
                  <div className="text-sm">
                    {(() => {
                      try {
                        const start = new Date(selectedEvent.start_time);
                        const end = selectedEvent.end_time ? new Date(selectedEvent.end_time) : null;
                        const validStart = !isNaN(start.getTime());
                        const validEnd = end && !isNaN(end.getTime());
                        
                        if (!validStart) return t.dashboard.invalidTime;
                        
                        return (
                          <>
                             {formatLocalizedDateTime(start, { hour: 'numeric', minute: '2-digit' })}
                             {validEnd && ` - ${formatLocalizedDateTime(end, { hour: 'numeric', minute: '2-digit' })}`}
                          </>
                        );
                      } catch (e) { return t.dashboard.invalidTime; }
                    })()}
                  </div>
                </div>
              </div>

              {selectedEvent.event_type && (
                <div>
                  <span className="font-semibold">{t.dashboard.type}: </span>
                  <Badge 
                    variant="outline"
                    style={{ 
                      backgroundColor: (selectedEvent.color || getColorForEventType(selectedEvent.event_type)) + '20',
                      borderColor: selectedEvent.color || getColorForEventType(selectedEvent.event_type),
                      color: selectedEvent.color || getColorForEventType(selectedEvent.event_type)
                    }}
                  >
                    {selectedEvent.event_type.replace(/_/g, ' ')}
                  </Badge>
                </div>
              )}

              {selectedEvent.description && (
                <div>
                  <span className="font-semibold">{t.dashboard.descriptionLabel}</span>
                  <p className="text-gray-600 mt-1">{selectedEvent.description}</p>
                </div>
              )}

              {selectedEvent.location && (
                <div>
                  <span className="font-semibold">{t.dashboard.locationLabel} </span>
                  {selectedEvent.location}
                </div>
              )}

              {selectedEvent.assigned_to && (
                <div>
                  <span className="font-semibold">{t.dashboard.assignedTo} </span>
                  {selectedEvent.assigned_to}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button 
                  variant="outline" 
                  onClick={() => handleDeleteEvent(selectedEvent.id)}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  disabled={deleteEventMutation.isPending}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {deleteEventMutation.isPending ? t.dashboard.deleting : t.common.delete}
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => handleEditEvent(selectedEvent)}
                >
                  <Edit className="w-4 h-4 mr-2" />
                  {t.common.edit}
                </Button>
                <Button onClick={() => setSelectedEvent(null)}>
                  {t.common.close}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showEventDialog} onOpenChange={setShowEventDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingEvent ? t.dashboard.editEvent : t.dashboard.addNewEvent}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEventSubmit} className="space-y-4">
            <div>
              <Label htmlFor="eventTitle">{t.dashboard.eventTitle} *</Label>
              <Input
                id="eventTitle"
                value={eventFormData.title}
                onChange={(e) => setEventFormData({...eventFormData, title: e.target.value})}
                required
                 placeholder={t.calendar?.eventTitle || 'Meeting, Inspection, Call, etc.'}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="startTime">{t.dashboard.startTime} *</Label>
                <Input
                  id="startTime"
                  type="datetime-local"
                  value={eventFormData.start_time}
                  onChange={(e) => setEventFormData({...eventFormData, start_time: e.target.value})}
                  required
                />
              </div>
              <div>
                <Label htmlFor="endTime">{t.dashboard.endTime} *</Label>
                <Input
                  id="endTime"
                  type="datetime-local"
                  value={eventFormData.end_time}
                  onChange={(e) => setEventFormData({...eventFormData, end_time: e.target.value})}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="eventType">{t.dashboard.eventType}</Label>
                <Select 
                  value={eventFormData.event_type || "meeting"} 
                  onValueChange={(v) => setEventFormData({
                    ...eventFormData, 
                    event_type: v,
                    color: getColorForEventType(v)
                  })}
                >
                  <SelectTrigger id="eventType">
                    <SelectValue placeholder={t.dashboard.selectEventType}/>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meeting">🟦 {t.dashboard.meeting}</SelectItem>
                    <SelectItem value="inspection">🟢 {t.dashboard.inspection}</SelectItem>
                    <SelectItem value="call">🟣 {t.dashboard.call}</SelectItem>
                    <SelectItem value="appointment">🟠 {t.dashboard.appointment}</SelectItem>
                    <SelectItem value="reminder">🟡 {t.dashboard.reminder}</SelectItem>
                    <SelectItem value="estimate">🔵 {t.dashboard.estimate}</SelectItem>
                    <SelectItem value="roofing_contractor">🟤 {t.dashboard.roofingContractor}</SelectItem>
                    <SelectItem value="follow_up">🔴 {t.dashboard.followUp}</SelectItem>
                    <SelectItem value="check_pickup">🟧 {t.dashboard.checkPickup}</SelectItem>
                    <SelectItem value="other">⚫ {t.dashboard.other}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="eventColor">{t.dashboard.colorAutoSet}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="eventColor"
                    type="color"
                    value={eventFormData.color}
                    onChange={(e) => setEventFormData({...eventFormData, color: e.target.value})}
                    className="w-20"
                  />
                   <span className="text-sm text-gray-500">{t.dashboard.orCustomize}</span>
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="eventLocation">{t.dashboard.locationLabel.replace(/:$/, '')}</Label>
              <Input
                id="eventLocation"
                value={eventFormData.location}
                onChange={(e) => setEventFormData({...eventFormData, location: e.target.value})}
                 placeholder={t.dashboard.addressOrMeetingLink}
              />
            </div>

            <div>
              <Label htmlFor="eventDescription">{t.dashboard.descriptionLabel.replace(/:$/, '')}</Label>
              <Textarea
                id="eventDescription"
                value={eventFormData.description}
                onChange={(e) => setEventFormData({...eventFormData, description: e.target.value})}
                rows={3}
                 placeholder={t.dashboard.eventDetails}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="addGoogleMeet"
                checked={eventFormData.add_google_meet}
                onCheckedChange={(checked) => setEventFormData({...eventFormData, add_google_meet: checked})}
              />
               <Label htmlFor="addGoogleMeet">{t.dashboard.addGoogleMeet}</Label>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => {
                setShowEventDialog(false);
                setEditingEvent(null);
              }}>
                {t.common.cancel}
              </Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={createEventMutation.isPending || updateEventMutation.isPending}>
                {editingEvent ? (updateEventMutation.isPending ? t.dashboard.updating : t.dashboard.updateEvent) : (createEventMutation.isPending ? t.dashboard.creating : t.dashboard.createEvent)}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Pipeline breakdown sheet — shown when a rep taps the pending commission widget */}
      <Sheet open={showPipelineSheet} onOpenChange={setShowPipelineSheet}>
        <SheetContent side="bottom" className="h-[90dvh] max-h-[90dvh] flex flex-col rounded-t-2xl">
          <SheetHeader className="pb-2 border-b border-gray-100">
            <SheetTitle className="flex items-center gap-2 text-amber-700">
              <TrendingUp className="w-5 h-5" />
              {t.dashboard.myPendingCommission}
            </SheetTitle>
            <SheetDescription className="text-gray-500">
              ${repPendingPipeline.repTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t.dashboard.estimatedCommission} · {t.dashboard.invoicesCount(repPendingPipeline.myLines.length)}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto py-3 space-y-2">
            {repPendingPipeline.myLines.length === 0 ? (
              <p className="text-center text-gray-500 py-10">{t.dashboard.noOpenInvoicesPipeline}</p>
            ) : (
              repPendingPipeline.myLines.map((line, idx) => {
                const statusColors = {
                  sent: 'bg-blue-100 text-blue-700',
                  viewed: 'bg-purple-100 text-purple-700',
                  overdue: 'bg-red-100 text-red-700',
                  draft: 'bg-gray-100 text-gray-600',
                };
                const statusClass = statusColors[line.status] || 'bg-amber-100 text-amber-700';
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer hover:bg-amber-50 hover:border-amber-200 active:bg-amber-100 transition-colors"
                    data-testid={`pipeline-sheet-row-${idx}`}
                    onClick={() => { setShowPipelineSheet(false); navigate(createPageUrl('invoice-details') + '?id=' + line.invoice_id); }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">{line.customer_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-gray-500">{t.invoices.title} #{line.invoice_number}</p>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${statusClass}`}>
                          {line.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{t.dashboard.invoiceTotal}: ${line.invoice_total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0 ml-3">
                      <div className="text-right">
                        <p className="font-bold text-amber-700">+${line.pending_commission.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        <p className="text-[10px] text-gray-400">{t.dashboard.estimatedCommission}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-400 ml-1" />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="pt-3 border-t border-gray-100">
            <button
              onClick={() => { setShowPipelineSheet(false); navigate(createPageUrl('CommissionReport')); }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold transition-colors"
              data-testid="btn-pipeline-sheet-full-report"
            >
              <ExternalLink className="w-4 h-4" />
              {t.dashboard.viewCommissionReport}
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}