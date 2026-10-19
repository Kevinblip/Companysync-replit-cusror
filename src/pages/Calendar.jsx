import React, { useState, useEffect, useRef } from "react";
import { isPlatformAdminCheck } from "@/hooks/usePlatformAdmin";
import { base44 } from "@/api/base44Client";
import { BulkDeleteButton } from "@/components/BulkDeleteControls";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TablePageSkeleton } from "@/components/PageSkeleton";
import { usePageVisibility } from "@/hooks/usePageVisibility";
import { usePostPaintGate } from "@/hooks/usePostPaintGate";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Filter,
  Calendar as CalendarIcon,
  X,
  RefreshCw,
  Bell,
  Edit,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Link as LinkIcon,
  Video,
  Wrench,
  Sparkles,
  MoveRight,
  Zap,
  ClipboardList,
  Settings,
} from "lucide-react";
import ReminderSettingsPanel from "@/components/ReminderSettingsPanel";
import { toSafeDate, safeFormat } from "@/lib/safeDate";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, startOfWeek, endOfWeek } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import useTranslation from "@/hooks/useTranslation";
import GoogleCalendarReconnectBanner from "@/components/calendar/GoogleCalendarReconnectBanner";
import {
  calendarDateFromKey,
  dateKeyInTimeZone,
  dateTimeLocalInTimeZoneToUtc,
  formatInTimeZone,
  parseCalendarInstant,
  timeZoneName,
  toDateTimeLocalInTimeZone,
  DEFAULT_COMPANY_TIME_ZONE,
} from "@/utils/companyTimeZone";

// 🎨 Event type color mapping
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
  other: '#6b7280',          // Gray
  trial: '#f59e0b',          // Amber (for SaaS Admin)
  invoice: '#4f46e5',        // Indigo (for SaaS Admin)
  action_item: '#8b5cf6',    // Purple (Action Items)
  task: '#0ea5e9'            // Sky Blue (Tasks with due dates)
};

const getColorForEventType = (eventType) => {
  return EVENT_TYPE_COLORS[eventType] || EVENT_TYPE_COLORS.other;
};

// 🛠️ Helper to check for valid dates
const isValidDate = (d) => d instanceof Date && !isNaN(d.getTime());

// 🔔 Notification sound function
const playNotificationSound = () => {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Pleasant notification sound (like a bell)
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch (error) {
    console.log('Could not play notification sound:', error);
  }
};

export default function Calendar() {
  const isPageVisible = usePageVisibility();
  const { toast } = useToast();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showEventDialog, setShowEventDialog] = useState(false);
  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [editingReminders, setEditingReminders] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [showDayEventsDialog, setShowDayEventsDialog] = useState(false);
  const [selectedDayEvents, setSelectedDayEvents] = useState({ date: null, events: [] });
  const [showSetupDialog, setShowSetupDialog] = useState(false);
  const [setupDiagnosis, setSetupDiagnosis] = useState(null);
  const [isCategorizing, setIsCategorizing] = useState(false);
  const [syncRetries, setSyncRetries] = useState(0);
  const [lastSyncError, setLastSyncError] = useState(null); // NEW: State to store last sync error
  const [reminderSettings, setReminderSettings] = useState({
    send_email_notification: true,
    email_reminder_minutes: [0],
    send_sms_notification: false,
    sms_reminder_minutes: [10],
    send_browser_notification: true,
    browser_reminder_minutes: [0],
  });
  const [selectedFilters, setSelectedFilters] = useState({
    eventTypes: [],
    assignedTo: []
  });
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    start_time: "",
    end_time: "",
    event_type: "meeting",
    color: getColorForEventType("meeting"),
    location: "",
    attendees: [],
    assigned_to: "",
    related_customer: "",
    related_lead: "",
    send_email_notification: true,
    email_reminder_minutes: [0],
    send_sms_notification: false,
    sms_reminder_minutes: [10],
    send_browser_notification: true,
    browser_reminder_minutes: [0],
    add_google_meet: false,
  });
  const [user, setUser] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false);
  const [microsoftCalendarConnected, setMicrosoftCalendarConnected] = useState(false);
  const [isMsConnecting, setIsMsConnecting] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [showMoveEventDialog, setShowMoveEventDialog] = useState(false);
  const [eventToMove, setEventToMove] = useState(null);
  const [moveToDate, setMoveToDate] = useState(null);
  const [draggedEvent, setDraggedEvent] = useState(null);
  const [touchDragEvent, setTouchDragEvent] = useState(null);
  const touchDragCloneRef = useRef(null);
  const touchDragTimerRef = useRef(null);
  const touchDragTargetRef = useRef(null);
  const isDraggingByTouchRef = useRef(false);
  const [calendarViewMode, setCalendarViewMode] = useState('mine');
  const [selectedPeople, setSelectedPeople] = useState([]);
  const [showActionItems, setShowActionItems] = useState(true);
  const [showTasks, setShowTasks] = useState(true);
  const [completingActionItem, setCompletingActionItem] = useState(false);
  const [deleteSeriesTarget, setDeleteSeriesTarget] = useState(null); // { event, seriesEvents }
  const [showReminderSettings, setShowReminderSettings] = useState(false);

  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const formatReminderTime = (minutes) => {
    if (minutes === null || minutes === undefined) return t.common.unknown;
    if (minutes === 0) return 'At time of event';
    if (minutes === 5) return '5 minutes before';
    if (minutes === 10) return '10 minutes before';
    if (minutes === 15) return '15 minutes before';
    if (minutes === 30) return '30 minutes before';
    if (minutes === 60) return '1 hour before';
    if (minutes === 120) return '2 hours before';
    if (minutes === 1440) return '1 day before';
    return `${minutes} minutes before`;
  };

  useEffect(() => {
    base44.auth.me().then(async (u) => {
      setUser(u);
      try {
        const invoked = await base44.functions.invoke('checkUserGoogleCalendarConnection', {});
        // invoke() always wraps the handler payload in { data }. Reading the
        // response directly (as this did) made `connected` and `needs_reconnect`
        // permanently undefined, which is why a revoked connection never surfaced.
        const result = invoked?.data ?? invoked;
        const isConnected = !!result?.connected;
        setGoogleCalendarConnected(isConnected);
        setLastSync(result?.last_sync || u?.last_google_sync);
        // When the server cleared tokens due to revocation or Testing-mode 7-day expiry,
        // surface a proactive "reconnect" toast so the user knows WHY it's disconnected
        // rather than silently seeing the plain "Connect Google Calendar" button.
        if (!isConnected && result?.needs_reconnect) {
          toast({
            title: '⚠️ Google Calendar Disconnected',
            description: 'Your Google Calendar session expired. Click "Connect Google Calendar" to restore sync.',
            variant: 'destructive',
          });
        }
      } catch (e) {
        const hasToken = !!(u?.google_access_token || u?.google_calendar_connected);
        setGoogleCalendarConnected(hasToken);
        setLastSync(u?.last_google_sync);
      }
      setCheckingConnection(false);
    }).catch(() => {
      setCheckingConnection(false);
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('google_connected') === 'true') {
      toast({ title: '✅ Google Calendar Connected', description: 'Your calendar is now synced with CompanySync.' });
      setGoogleCalendarConnected(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (params.get('microsoft_connected') === 'true') {
      toast({ title: '✅ Outlook Calendar Connected', description: 'Your Microsoft/Outlook Calendar is now synced.' });
      setMicrosoftCalendarConnected(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
    const googleError = params.get('google_error');
    if (googleError) {
      toast({ title: 'Google Calendar Error', description: decodeURIComponent(googleError), variant: 'destructive' });
      window.history.replaceState({}, '', window.location.pathname);
    }
    const msError = params.get('microsoft_error');
    if (msError) {
      toast({ title: 'Microsoft Calendar Error', description: decodeURIComponent(msError), variant: 'destructive' });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    base44.functions.invoke('checkMicrosoftCalendarConnection', {})
      .then(res => setMicrosoftCalendarConnected(!!res?.data?.connected))
      .catch(() => {});
  }, []);

  // 🔄 OPTIMIZED AUTO-SYNC
  // Uses a ref to track the latest user/state without triggering re-renders of the effect
  const autoSyncStateRef = React.useRef({
    syncRetries: 0,
    isSyncing: false,
    user: null
  });

  // Update ref when state changes
  useEffect(() => {
    autoSyncStateRef.current = {
      syncRetries,
      isSyncing: autoSyncing,
      user
    };
  }, [syncRetries, autoSyncing, user]);

  useEffect(() => {
    if (!googleCalendarConnected) return;

    let timeoutId;
    let mounted = true;

    const performAutoSync = async (isInitial = false) => {
      const state = autoSyncStateRef.current;
      
      if (!state.user || !state.user.google_access_token) return;
      if (state.isSyncing) return;
      if (state.syncRetries >= 5) {
        console.log('⚠️ Auto-sync paused after 5 failed attempts');
        return;
      }

      try {
        if (mounted) setAutoSyncing(true);
        console.log('🔄 Starting auto-sync...');
        
        // Execute sync
        const result = await base44.functions.invoke('syncUserGoogleCalendar', {});
        
        if (mounted) {
          console.log('✅ Auto-sync completed');
          queryClient.invalidateQueries({ queryKey: ['calendar-events-user'] });
          queryClient.invalidateQueries({ queryKey: ['calendar-events-company'] });
          
          // Update last sync time locally without full user refetch if possible
          setLastSync(new Date().toISOString());
          setSyncRetries(0);
          setLastSyncError(null);
        }
      } catch (error) {
        console.log('⚠️ Auto-sync failed:', error.message);
        if (mounted) {
          if (error.message?.includes('403') || error.message?.includes('401')) {
            setGoogleCalendarConnected(false);
            setLastSyncError('Auth error');
          } else {
            setSyncRetries(prev => prev + 1);
          }
        }
      } finally {
        if (mounted) setAutoSyncing(false);
        
        // Schedule next sync
        const baseInterval = 5 * 60 * 1000; // 5 minutes
        const retryCount = autoSyncStateRef.current.syncRetries;
        const nextInterval = baseInterval * (1 + Math.min(retryCount, 3) * 0.5);
        
        console.log(`⏰ Next sync in ${nextInterval/1000}s`);
        timeoutId = setTimeout(() => performAutoSync(false), nextInterval);
      }
    };

    // Start initial sync after 10s
    timeoutId = setTimeout(() => performAutoSync(true), 10000);

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
    };
  }, [googleCalendarConnected, queryClient]);

  const { filterCalendarEvents, filterCustomers, filterLeads, myCompany, isAdmin, effectiveUserEmail, hasPermission } = useRoleBasedData();
  const companyTimeZone = myCompany?.timezone
    || myCompany?.settings?.time_zone
    || myCompany?.settings?.timezone
    || myCompany?.data?.timezone
    || DEFAULT_COMPANY_TIME_ZONE;
  const calendarMonthScopeRef = useRef('');
  useEffect(() => {
    if (!myCompany?.id) return;
    const scope = `${myCompany.id}:${companyTimeZone}`;
    if (calendarMonthScopeRef.current === scope) return;
    calendarMonthScopeRef.current = scope;
    const today = calendarDateFromKey(dateKeyInTimeZone(new Date(), companyTimeZone));
    if (today) setCurrentMonth(today);
  }, [myCompany?.id, companyTimeZone]);
  const companyTimeZoneLabel = timeZoneName(companyTimeZone);
  const formatCompanyEventTime = (value, options) =>
    formatInTimeZone(value, options, companyTimeZone);
  const isCalendarSecondaryDataReady = usePostPaintGate(!!myCompany?.id, 'calendar');

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles-calendar', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id && isCalendarSecondaryDataReady,
  });

  const allCompanyStaff = staffProfiles;

  // Main Calendar: Secured with Company ID Scoping
  const { data: calendarEvents = [], isLoading: isLoadingCalendar } = useQuery({
    queryKey: ['calendar-events-user', user?.email, myCompany?.id],
    queryFn: async () => {
      if (!user || !myCompany?.id) return [];

      // STRICT SCOPING: Only fetch events for this company
      // AND (assigned to me OR I'm an admin/scheduler OR related to my customers)
      // For now, simpler logic: Fetch all company events and filter in UI or fetch specific subset
      // To match typical CRM patterns: Admins see all, Users see theirs + unassigned
      
      // SECURITY: Enforce company_id filtering at all times
      if (!myCompany.id) return [];
      const query = { company_id: myCompany.id };
      
      // If not admin, restrict to own events? 
      // Note: Calendar usually allows seeing team events for scheduling. 
      // We will fetch ALL company events to allow filtering by "Assigned To" in the UI, 
      // but strictly limited to THIS company_id.
      
      // 1000 newest-by-start rows were all far-future Google recurring
      // instances once ~2000 events synced, hiding this month entirely.
      return await base44.entities.CalendarEvent.filter(query, "-start_time", 5000);
    },
    enabled: !!user && !!myCompany?.id,
  });

  const { data: allStaffProfiles = [] } = useQuery({
    queryKey: ['all-staff-profiles', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id && isCalendarSecondaryDataReady,
  });

  const { data: rawCustomers = [] } = useQuery({
    queryKey: ['customers-for-calendar', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, '-created_date', 500) : [],
    enabled: !!myCompany && isCalendarSecondaryDataReady,
  });

  // 🔐 Filter customers by role — used in event creation dropdowns
  const allCustomers = React.useMemo(() => filterCustomers(rawCustomers), [rawCustomers, filterCustomers]);

  // ⚠️ Live conflict detection: scans already-loaded company events for overlap.
  // Runs instantly on every formData change — no extra API call needed.
  const conflictingEvent = React.useMemo(() => {
    if (!showEventDialog || !formData.start_time || !formData.end_time) return null;
    const effectiveAssignee = formData.assigned_to || user?.email;
    if (!effectiveAssignee) return null;
    const newStartUtc = dateTimeLocalInTimeZoneToUtc(formData.start_time, companyTimeZone);
    const newEndUtc = dateTimeLocalInTimeZoneToUtc(formData.end_time, companyTimeZone);
    if (!newStartUtc || !newEndUtc) return null;
    const newStart = Date.parse(newStartUtc);
    const newEnd = Date.parse(newEndUtc);
    if (isNaN(newStart) || isNaN(newEnd) || newEnd <= newStart) return null;

    return (calendarEvents || []).find(ev => {
      if (ev.id === editingEvent?.id) return false; // skip self when editing
      // Legacy events may not have an assigned_to value. In that case the
      // creator is the rep responsible for the booking, so keep detecting
      // conflicts for that user's new event.
      const eventAssignee = ev.assigned_to === null ? ev.created_by : ev.assigned_to;
      if (eventAssignee !== effectiveAssignee) return false;
      if (ev._isActionItem || ev.is_saas_event) return false;
      const evStart = parseCalendarInstant(ev.start_time)?.getTime();
      if (!Number.isFinite(evStart)) return false;
      const evEnd = ev.end_time
        ? parseCalendarInstant(ev.end_time)?.getTime()
        : evStart + 60 * 60 * 1000;
      if (!Number.isFinite(evEnd)) return false;
      // True time overlap: new slot starts before existing ends AND ends after existing starts
      return newStart < evEnd && newEnd > evStart;
    }) || null;
  }, [calendarEvents, companyTimeZone, formData.assigned_to, formData.start_time, formData.end_time, editingEvent?.id, showEventDialog, user?.email]);

  const { data: rawLeads = [] } = useQuery({
    queryKey: ['leads-for-calendar', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }, '-created_date', 500) : [],
    enabled: !!myCompany && isCalendarSecondaryDataReady,
  });

  // 🔐 Filter leads by role — used in event creation dropdowns
  const allLeads = React.useMemo(() => filterLeads(rawLeads), [rawLeads, filterLeads]);

  // Action Items — fetched and merged into calendar as synthetic events
  const { data: rawActionItems = [] } = useQuery({
    queryKey: ['action-items-calendar', myCompany?.id],
    queryFn: () => myCompany?.id
      ? base44.entities.ActionItem.filter({ company_id: myCompany.id }, '-created_date', 2000)
      : [],
    enabled: !!myCompany?.id && isPageVisible && isCalendarSecondaryDataReady,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  // Build Schedule & Inspection Jobs — shown as synthetic calendar events
  const { data: calendarBuildSchedule = [] } = useQuery({
    queryKey: ['build-schedule-calendar', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.BuildSchedule.filter({ company_id: myCompany.id }, '-build_date', 500) : [],
    enabled: !!myCompany?.id && isPageVisible && isCalendarSecondaryDataReady,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  const { data: calendarInspectionJobs = [] } = useQuery({
    queryKey: ['inspection-jobs-calendar', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.InspectionJob.filter({ company_id: myCompany.id }, '-created_date', 200) : [],
    enabled: !!myCompany?.id && isPageVisible && isCalendarSecondaryDataReady,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  // Tasks with due dates — shown as synthetic calendar events
  const { data: calendarTasks = [] } = useQuery({
    queryKey: ['tasks-calendar', myCompany?.id],
    queryFn: () => myCompany?.id
      ? base44.entities.Task.filter({ company_id: myCompany.id }, '-due_date', 1000)
      : [],
    enabled: !!myCompany?.id && isPageVisible && isCalendarSecondaryDataReady,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  // 🔐 SaaS Admin Data (Only fetched if platform owner)
  const isPlatformOwner = React.useMemo(() => {
    if (!user) return false;
    return isPlatformAdminCheck(user, myCompany, null);
  }, [user, myCompany]);

  const { data: companies = [] } = useQuery({
    queryKey: ['all-companies-calendar'],
    queryFn: () => base44.entities.Company.filter({ is_deleted: { $ne: true } }, "-created_date", 500),
    enabled: !!isPlatformOwner,
  });

  // Fetch all invoices for Platform Owner
  const { data: adminAllInvoices = [] } = useQuery({
    queryKey: ['admin-all-invoices', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Invoice.filter({ company_id: myCompany.id }, '-created_date', 10000) : [],
    enabled: !!isPlatformOwner && !!myCompany,
  });

  // Fetch all companies for Platform Owner (already fetched as 'companies' but used here for logic)
  
  // 🚀 Merge Standard Events with SaaS Admin Events + Action Items
  const mergedCalendarEvents = React.useMemo(() => {
    let events = [...filterCalendarEvents(calendarEvents)];

    // Merge pending/overdue action items with a due_at as synthetic calendar events.
    // Non-admins only see items assigned to them — not the whole company's queue.
    const visibleActionItems = isAdmin
      ? rawActionItems
      : rawActionItems.filter(item =>
          item.assigned_to === effectiveUserEmail ||
          (Array.isArray(item.assigned_to_users) && item.assigned_to_users.includes(effectiveUserEmail))
        );
    if (showActionItems) {
      visibleActionItems
        .filter(item => item.due_at && item.status !== 'completed' && item.status !== 'dismissed')
        .forEach(item => {
          const due = new Date(item.due_at);
          if (!isValidDate(due)) return;
          const priorityColor = { urgent: '#ef4444', high: '#f97316', medium: '#8b5cf6', low: '#6b7280' };
          events.push({
            id: `ai-${item.id}`,
            _actionItemId: item.id,
            _isActionItem: true,
            title: `⚡ ${item.title}`,
            start_time: due.toISOString(),
            end_time: new Date(due.getTime() + 30 * 60 * 1000).toISOString(),
            event_type: 'action_item',
            color: priorityColor[item.priority] || '#8b5cf6',
            description: item.description || '',
            assigned_to: item.assigned_to || item.created_by,
            is_saas_event: false,
            _priority: item.priority,
            _status: item.status,
            _related_lead: item.related_lead_id,
            _related_customer: item.related_customer_id,
          });
        });
    }

    if (isPlatformOwner) {
      // Add Trial Expirations
      companies.forEach(c => {
        if (c.trial_ends_at && c.subscription_status === 'trial') {
          const date = new Date(c.trial_ends_at);
          if (isValidDate(date)) {
            // Normalize time to noon to avoid timezone edge cases
            date.setHours(12, 0, 0, 0);
            
            events.push({
              id: `trial-${c.id}`,
              title: `Trial Ends: ${c.company_name}`,
              start_time: date.toISOString(),
              end_time: new Date(date.getTime() + 60 * 60 * 1000).toISOString(), // 1 hour duration
              event_type: 'trial',
              description: `Plan: ${c.subscription_plan}\nUser: ${c.created_by}`,
              color: EVENT_TYPE_COLORS.trial,
              is_saas_event: true // Flag to disable editing
            });
          }
        }
      });

      // Add Invoice Due Dates
      adminAllInvoices.forEach(inv => {
        if (inv.due_date && inv.status !== 'paid' && inv.status !== 'cancelled') {
          const date = new Date(inv.due_date);
          if (isValidDate(date)) {
            date.setHours(9, 0, 0, 0); // Set to 9 AM

            events.push({
              id: `inv-${inv.id}`,
              title: `Due: $${inv.amount} (${inv.customer_name})`,
              start_time: date.toISOString(),
              end_time: new Date(date.getTime() + 60 * 60 * 1000).toISOString(),
              event_type: 'invoice',
              description: `Invoice #${inv.invoice_number}\nAmount: $${inv.amount}\nStatus: ${inv.status}`,
              color: EVENT_TYPE_COLORS.invoice,
              is_saas_event: true
            });
          }
        }
      });
    }

    // Merge BuildSchedule items as synthetic events
    calendarBuildSchedule.forEach(b => {
      // Lexi/UI-created builds already have a real CalendarEvent. Rendering a
      // synthetic copy would show the same build twice.
      if (b.calendar_event_id) return;
      const dateStr = b.build_date;
      if (!dateStr) return;
      const date = dateStr.length === 10
        ? parseCalendarInstant(dateTimeLocalInTimeZoneToUtc(`${dateStr}T08:00`, companyTimeZone))
        : parseCalendarInstant(dateStr);
      if (!isValidDate(date)) return;
      const jobLabel = Array.isArray(b.job_type) && b.job_type.length > 0 ? b.job_type.join(' & ') : 'Build';
      events.push({
        id: `build-${b.id}`,
        _buildScheduleId: b.id,
        _isBuildSchedule: true,
        title: `🏗️ ${jobLabel}: ${b.customer_name || b.address || 'Build'}`,
        start_time: date.toISOString(),
        end_time: new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString(),
        event_type: 'build',
        color: '#f97316',
        description: `📍 ${b.address || ''}\n👤 ${b.customer_name || ''}\n📞 ${b.customer_phone || ''}\n🏷️ ${jobLabel}${b.notes ? '\n📝 ' + b.notes : ''}`,
        location: b.address || '',
        related_customer: b.customer_name || '',
        is_saas_event: false,
        _status: b.status,
      });
    });

    // Merge InspectionJob items as synthetic events
    calendarInspectionJobs.forEach(j => {
      const dateStr = j.inspection_date || j.scheduled_date;
      if (!dateStr) return;
      const date = dateStr.length === 10
        ? parseCalendarInstant(dateTimeLocalInTimeZoneToUtc(`${dateStr}T09:00`, companyTimeZone))
        : parseCalendarInstant(dateStr);
      if (!isValidDate(date)) return;
      const clientName = j.client_name || j.customer_name || j.property_address || 'Inspection';
      events.push({
        id: `inspect-${j.id}`,
        _inspectionJobId: j.id,
        _isInspectionJob: true,
        title: `🔍 Inspection: ${clientName}`,
        start_time: date.toISOString(),
        end_time: new Date(date.getTime() + 2 * 60 * 60 * 1000).toISOString(),
        event_type: 'inspection',
        color: '#10b981',
        description: `📍 ${j.property_address || ''}\n👤 ${clientName}\n📞 ${j.client_phone || ''}\n🔍 ${j.damage_type || 'Assessment'}`,
        location: j.property_address || '',
        related_customer: clientName,
        is_saas_event: false,
        _status: j.status,
      });
    });

    // Merge Tasks with due_date as synthetic calendar events
    if (showTasks) {
      calendarTasks
        .filter(t => t.due_date && !t.is_archived && t.status !== 'job_completed')
        .forEach(t => {
          const dateStr = t.due_date;
          const date = dateStr.length === 10
            ? parseCalendarInstant(dateTimeLocalInTimeZoneToUtc(`${dateStr}T08:00`, companyTimeZone))
            : parseCalendarInstant(dateStr);
          if (!isValidDate(date)) return;
          const priorityColor = { high: '#ef4444', medium: '#f97316', low: '#0ea5e9' };
          events.push({
            id: `task-${t.id}`,
            _taskId: t.id,
            _isTask: true,
            title: `📋 ${t.name || 'Task'}`,
            start_time: date.toISOString(),
            end_time: new Date(date.getTime() + 60 * 60 * 1000).toISOString(),
            event_type: 'task',
            color: priorityColor[t.priority] || EVENT_TYPE_COLORS.task,
            description: `${t.description || ''}\n👤 ${t.assigned_to || ''}\n🏷️ ${t.priority || 'normal'} priority${t.status ? '\n📊 ' + t.status : ''}`,
            assigned_to: t.assigned_to,
            is_saas_event: false,
            _priority: t.priority,
            _status: t.status,
          });
        });
    }

    return events;
  }, [calendarEvents, filterCalendarEvents, isPlatformOwner, companies, adminAllInvoices, rawActionItems, showActionItems, calendarBuildSchedule, calendarInspectionJobs, calendarTasks, showTasks, companyTimeZone]);

  useEffect(() => {
    if (selectedEvent) {
      setReminderSettings({
        send_email_notification: selectedEvent.send_email_notification !== false,
        email_reminder_minutes: Array.isArray(selectedEvent.email_reminder_minutes) ? selectedEvent.email_reminder_minutes : [selectedEvent.email_reminder_minutes || 0],
        send_sms_notification: selectedEvent.send_sms_notification === true,
        sms_reminder_minutes: Array.isArray(selectedEvent.sms_reminder_minutes) ? selectedEvent.sms_reminder_minutes : [selectedEvent.sms_reminder_minutes || 10],
        send_browser_notification: selectedEvent.send_browser_notification !== false,
        browser_reminder_minutes: Array.isArray(selectedEvent.browser_reminder_minutes) ? selectedEvent.browser_reminder_minutes : [selectedEvent.browser_reminder_minutes || 0],
      });
      setEditingReminders(false);
    }
  }, [selectedEvent]);

  const resetEventForm = () => {
    setFormData({
      title: "",
      description: "",
      start_time: "",
      end_time: "",
      event_type: "meeting",
      color: getColorForEventType("meeting"),
      location: "",
      attendees: [],
      assigned_to: user?.email || "",
      related_customer: "",
      related_lead: "",
      send_email_notification: true,
      email_reminder_minutes: [0],
      send_sms_notification: false,
      sms_reminder_minutes: [10],
      send_browser_notification: true,
      browser_reminder_minutes: [0],
      add_google_meet: googleCalendarConnected,
    });
  };

  const handleShowSetup = async () => {
    setShowSetupDialog(true);
    setSetupDiagnosis(null);
    try {
      const result = await base44.functions.invoke('diagnoseGoogleCalendar', {});
      setSetupDiagnosis(result.data);
    } catch (error) {
      setSetupDiagnosis({ error: 'Failed to run diagnosis: ' + error.message });
    }
  };

  const handleAutoCategorize = async () => {
    if (!confirm('🎨 Auto-categorize all events?\n\nThis will analyze each event title and assign the appropriate type and color.\n\nExamples:\n• "Inspection" → Green\n• "Call" → Purple\n• "Meeting" → Blue\n• "Birthday" → Yellow\n\nContinue?')) {
      return;
    }

    setIsCategorizing(true);
    try {
      const result = await base44.functions.invoke('autoCategorizeEvents', {});
      
      if (result.data.success) {
        const msg = `✅ Auto-categorization complete!\n\n` +
                    `📊 Total events: ${result.data.total}\n` +
                    `✏️ Updated: ${result.data.updated}\n` +
                    `✓ Already correct: ${result.data.unchanged}\n\n` +
                    `Your calendar now has color-coded events!`;
        
        alert(msg);
        queryClient.invalidateQueries({ queryKey: ['calendar-events-user'] });
        queryClient.invalidateQueries({ queryKey: ['calendar-events-company'] });
      }
    } catch (error) {
      console.error('Auto-categorize error:', error);
      alert('Failed to auto-categorize events: ' + error.message);
    } finally {
      setIsCategorizing(false);
    }
  };

  // 🔔 FIXED: Create bell notification when event is created
  // 🔔 NEW: Send immediate email/SMS when event created
  const createEventMutation = useMutation({
    mutationFn: async (data) => {
      const eventData = {
        ...data,
        company_id: myCompany?.id,
        assigned_to: data.assigned_to || user?.email,
      };
      
      const event = await base44.entities.CalendarEvent.create(eventData);
      
      // 🔔 Create bell notification
      try {
        await base44.entities.Notification.create({
          user_email: user.email,
          type: 'event_created',
          title: `📅 ${t.calendar.addEvent}`,
          message: `"${event.title}" ${t.calendar.appointment} ${formatCompanyEventTime(event.start_time, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
          link_url: createPageUrl('Calendar'),
          is_read: false
        });
        playNotificationSound(); // 🔔 Play ding sound
      } catch (notifError) {
        console.error('Failed to create notification (non-critical):', notifError);
      }

      // 📧📱 Send immediate email/SMS notification
      try {
        await base44.functions.invoke('sendEventChangeNotification', {
          eventId: event.id,
          changeType: 'created',
          newTime: formatCompanyEventTime(event.start_time, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        });
      } catch (notifError) {
        console.log('Failed to send change notification (non-critical):', notifError.message);
      }

      // 🔄 Sync with Google Calendar immediately
      try {
        base44.functions.invoke('syncUserGoogleCalendar', {});
      } catch (e) { console.log('Background sync failed:', e); }
      
      // Trigger workflow for appointment_created
      if (myCompany?.id) {
        try {
          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'appointment_created',
            companyId: myCompany.id,
            entityType: 'CalendarEvent',
            entityId: event.id,
            entityData: {
              title: event.title,
              event_type: event.event_type,
              start_time: event.start_time,
              location: event.location,
              assigned_to: event.assigned_to,
              app_url: window.location.origin
            }
          });
        } catch (error) {
          console.log('Workflow trigger failed (non-critical):', error.message);
        }
      }
      
      return event;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events-user'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-events-company'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setShowEventDialog(false);
      resetEventForm();
    },
    onError: (error) => {
      console.error('[Calendar] Create event failed:', error);
      const msg = error?.message || "";
      const isConflict = msg.toLowerCase().includes("already booked") || msg.toLowerCase().includes("already has");
      toast({
        title: isConflict ? "⚠️ Scheduling Conflict" : "Failed to save event",
        description: isConflict ? msg : (msg || "Something went wrong. Please try again."),
        variant: "destructive",
        duration: isConflict ? 8000 : 5000,
      });
    },
  });

  const updateRemindersMutation = useMutation({
    mutationFn: async ({ eventId, settings }) => {
      return await base44.entities.CalendarEvent.update(eventId, settings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events-user'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-events-company'] });
      setEditingReminders(false);
      alert('✅ Reminders updated!');
    },
  });

  // 🔔 FIXED: Create bell notification when event time is moved
  // 🔔 NEW: Send immediate email/SMS when event moved
  const updateEventMutation = useMutation({
    mutationFn: async ({ id, data, originalEvent }) => {
      const oldEvent = calendarEvents.find(e => e.id === id);
      const resetData = { ...data };
      if (data.start_time) {
        resetData.notification_sent = false;
        resetData.notification_sent_at = null;
        resetData.sms_notification_sent = false;
        resetData.sms_notification_sent_at = null;
      }
      
      const updatedEvent = await base44.entities.CalendarEvent.update(id, resetData);
      
      // Trigger workflow for appointment_completed
      if (myCompany?.id && oldEvent?.status !== 'completed' && data.status === 'completed') {
        try {
          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'appointment_completed',
            companyId: myCompany.id,
            entityType: 'CalendarEvent',
            entityId: id,
            entityData: {
              title: updatedEvent.title,
              event_type: updatedEvent.event_type,
              customer_name: updatedEvent.related_customer,
              completed_by: user?.full_name || user?.email,
              app_url: window.location.origin
            }
          });
        } catch (error) {
          console.log('Workflow trigger failed (non-critical):', error.message);
        }
      }
      
      // 🔔 Create bell notification if time changed
      if (originalEvent && data.start_time && originalEvent.start_time !== data.start_time) {
        try {
          const eventTimeFormat = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
          const oldTime = formatCompanyEventTime(originalEvent.start_time, eventTimeFormat);
          const newTime = formatCompanyEventTime(data.start_time, eventTimeFormat);
          
          await base44.entities.Notification.create({
            user_email: user.email,
            type: 'event_updated',
            title: `📅 ${t.calendar.editEvent}`,
            message: `"${originalEvent.title}" ${t.common.status} ${oldTime} ${t.common.to} ${newTime}`,
            link_url: createPageUrl('Calendar'),
            is_read: false
          });
          playNotificationSound(); // 🔔 Play ding sound

          // 📧📱 Send immediate email/SMS notification
          await base44.functions.invoke('sendEventChangeNotification', {
            eventId: id,
            changeType: 'rescheduled',
            oldTime: oldTime,
            newTime: newTime
          });
        } catch (notifError) {
          console.error('Failed to send notifications (non-critical):', notifError);
        }
      }

      // 🔄 Sync with Google Calendar immediately
      try {
        base44.functions.invoke('syncUserGoogleCalendar', {});
      } catch (e) { console.log('Background sync failed:', e); }
      
      return updatedEvent;
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events-user'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-events-company'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      // ✅ Removed blocking sync - it will happen in background via auto-sync
    },
  });

  // 🔔 FIXED: Create bell notification when event is edited
  // 🔔 NEW: Send immediate email/SMS when event edited
  const updateEventFromFormMutation = useMutation({
    mutationFn: async ({ id, data, originalStartTime, originalEvent }) => {
      const resetData = { ...data };
      
      // If start_time changed, reset notification flags so reminders fire again
      if (data.start_time && originalStartTime && data.start_time !== originalStartTime) {
        resetData.notification_sent = false;
        resetData.notification_sent_at = null;
        resetData.sms_notification_sent = false;
        resetData.sms_notification_sent_at = null;
      }
      
      const updatedEvent = await base44.entities.CalendarEvent.update(id, resetData);
      
      // 🔔 Create notification if time changed
      if (data.start_time && originalStartTime && data.start_time !== originalStartTime) {
        try {
          const eventTimeFormat = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
          const oldTime = formatCompanyEventTime(originalStartTime, eventTimeFormat);
          const newTime = formatCompanyEventTime(data.start_time, eventTimeFormat);
          
          await base44.entities.Notification.create({
            user_email: user.email,
            type: 'event_updated',
            title: `📅 ${t.calendar.editEvent}`,
            message: `"${originalEvent.title}" ${t.common.status} ${oldTime} ${t.common.to} ${newTime}`,
            link_url: createPageUrl('Calendar'),
            is_read: false
          });
          playNotificationSound(); // 🔔 Play ding sound

          // 📧📱 Send immediate email/SMS notification
          await base44.functions.invoke('sendEventChangeNotification', {
            eventId: id,
            changeType: 'rescheduled',
            oldTime: oldTime,
            newTime: newTime
          });
        } catch (notifError) {
          console.error('Failed to send notifications (non-critical):', notifError);
        }
      }

      // 🔄 Sync with Google Calendar immediately
      try {
        base44.functions.invoke('syncUserGoogleCalendar', {});
      } catch (e) { console.log('Background sync failed:', e); }
      
      return updatedEvent;
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events-user'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-events-company'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setShowEventDialog(false);
      setEditingEvent(null);
      resetEventForm();
    },
    onError: (error) => {
      console.error('[Calendar] Update event failed:', error);
      const msg = error?.message || "";
      const isConflict = msg.toLowerCase().includes("already booked") || msg.toLowerCase().includes("already has");
      toast({
        title: isConflict ? "⚠️ Scheduling Conflict" : "Failed to update event",
        description: isConflict ? msg : (msg || "Something went wrong. Please try again."),
        variant: "destructive",
        duration: isConflict ? 8000 : 5000,
      });
    },
  });

  // 🔔 FIXED: Create bell notification when event is deleted
  // 🔔 NEW: Send immediate email/SMS when event deleted
  const deleteEventMutation = useMutation({
    mutationFn: async (id) => {
      const event = calendarEvents.find(e => e.id === id); // Find event before deleting
      await base44.entities.CalendarEvent.delete(id);
      
      // 🔔 Create notification
      if (event) {
        try {
          await base44.entities.Notification.create({
            user_email: user.email,
            type: 'event_deleted',
            title: '🗑️ Event Deleted',
            message: `"${event.title}" scheduled for ${formatCompanyEventTime(event.start_time, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} was deleted`,
            link_url: createPageUrl('Calendar'),
            is_read: false
          });
          playNotificationSound(); // 🔔 Play ding sound

          // 📧📱 Send immediate email/SMS notification
          await base44.functions.invoke('sendEventChangeNotification', {
            eventId: event.id,
            changeType: 'deleted',
            oldTime: formatCompanyEventTime(event.start_time, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          });
        } catch (notifError) {
          console.error('Failed to send notifications (non-critical):', notifError);
        }
      }

      // 🔄 Sync with Google Calendar immediately
      try {
        base44.functions.invoke('syncUserGoogleCalendar', {});
      } catch (e) { console.log('Background sync failed:', e); }
      
      return event;
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events-user'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-events-company'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setSelectedEvent(null);
      // ✅ Removed blocking sync - it will happen in background via auto-sync
    },
  });

  // 🗑️ Delete all events in a series (same title + same assigned_to)
  const deleteSeriesMutation = useMutation({
    mutationFn: async (eventIds) => {
      await base44.entities.CalendarEvent.bulkDelete(eventIds);
      // 🔄 Background sync after bulk delete
      try { base44.functions.invoke('syncUserGoogleCalendar', {}); } catch (e) {}
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events-user'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-events-company'] });
      setSelectedEvent(null);
      setDeleteSeriesTarget(null);
      toast({ title: `Events deleted`, description: 'All matching events have been removed.' });
    },
    onError: () => {
      toast({ title: 'Delete failed', description: 'Some events could not be deleted. Please try again.', variant: 'destructive' });
    },
  });

  const handleUpdateReminders = () => {
    if (selectedEvent) {
      updateRemindersMutation.mutate({
        eventId: selectedEvent.id,
        settings: reminderSettings
      });
    }
  };

  const handleGoogleConnect = async () => {
    setIsConnecting(true);
    try {
      const result = await base44.functions.invoke('connectUserGoogleCalendar', {});
      if (result.data?.authUrl) {
        window.location.href = result.data.authUrl;
      }
    } catch (error) {
      console.error('Error connecting to Google Calendar:', error);
      alert(t.syncStatus.failedConnectCalendar + ' ' + error.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleGoogleSync = async () => {
    setIsConnecting(true);
    try {
      const result = await base44.functions.invoke('syncUserGoogleCalendar', {});
      
      if (result.data.needsReconnect) {
        alert('⚠️ ' + result.data.error + '\n\n' + t.syncStatus.disconnectReconnectCalendar);
        setGoogleCalendarConnected(false);
        return;
      }
      
      const summary = result.data;
      const totalChanges = summary.total || 0;
      
      let message = `✅ Two-way sync complete!\n\n`;
      message += `📥 From Google Calendar:\n`;
      message += `  • ${summary.fromGoogle?.created || 0} new events imported\n`;
      message += `  • ${summary.fromGoogle?.updated || 0} events updated\n`;
      message += `  • ${summary.fromGoogle?.deleted || 0} events deleted\n\n`;
      message += `📤 To Google Calendar:\n`;
      message += `  • ${summary.toGoogle?.created || 0} CRM events pushed\n`;
      message += `  • ${summary.toGoogle?.updated || 0} CRM events updated\n\n`;
      message += `Total: ${totalChanges} changes synced`;
      
      alert(message);
      queryClient.invalidateQueries({ queryKey: ['calendar-events-user'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-events-company'] });
      
      const updatedUser = await base44.auth.me();
      setLastSync(updatedUser.last_google_sync);
      setSyncRetries(0); // Reset retries on successful manual sync
      setLastSyncError(null); // Clear any error on successful manual sync
    } catch (error) {
      console.error('Error syncing Google Calendar:', error);
      
      if (error.message?.includes('403') || error.message?.includes('Permission denied')) {
        alert('❌ ' + t.syncStatus.permissionError403);
        setGoogleCalendarConnected(false);
      } else {
        alert(t.syncStatus.failedSyncCalendar + ' ' + error.message);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleGoogleDisconnect = async () => {
    if (!confirm(t.syncStatus.disconnectCalendarConfirm)) {
      return;
    }

    setIsConnecting(true);
    try {
      await base44.functions.invoke('disconnectUserGoogleCalendar', {});
      setGoogleCalendarConnected(false);
      setLastSync(null);
      setSyncRetries(0);
      setLastSyncError(null); // Clear any error on disconnect
      alert('✅ ' + t.syncStatus.calendarDisconnected);
    } catch (error) {
      console.error('Error disconnecting:', error);
      alert(t.syncStatus.failedDisconnect + ' ' + error.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleMicrosoftConnect = async () => {
    setIsMsConnecting(true);
    try {
      const result = await base44.functions.invoke('connectMicrosoftCalendar', {});
      if (result.data?.authUrl) {
        window.location.href = result.data.authUrl;
      } else if (result.data?.needsSetup) {
        toast({ title: '⚙️ Setup Required', description: result.data.error || 'Microsoft Calendar not configured. Contact your admin.', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Connection Failed', description: 'Failed to connect Microsoft Calendar: ' + error.message, variant: 'destructive' });
    } finally {
      setIsMsConnecting(false);
    }
  };

  const handleMicrosoftSync = async () => {
    setIsMsConnecting(true);
    try {
      const result = await base44.functions.invoke('syncMicrosoftCalendar', {});
      if (result.data?.needsReconnect) {
        toast({ title: '⚠️ Reconnect Required', description: result.data.error || 'Please reconnect your Microsoft Calendar.', variant: 'destructive' });
        setMicrosoftCalendarConnected(false);
        return;
      }
      const summary = result.data || {};
      toast({ title: '✅ Outlook Synced', description: `${summary.created || 0} new, ${summary.updated || 0} updated events synced from Microsoft.` });
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
    } catch (error) {
      toast({ title: 'Sync Failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsMsConnecting(false);
    }
  };

  const handleMicrosoftDisconnect = async () => {
    if (!confirm('Disconnect Microsoft Calendar? Events already in the CRM will remain.')) return;
    setIsMsConnecting(true);
    try {
      await base44.functions.invoke('disconnectMicrosoftCalendar', {});
      setMicrosoftCalendarConnected(false);
      toast({ title: '✅ Disconnected', description: 'Microsoft Calendar disconnected.' });
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsMsConnecting(false);
    }
  };

  // 🎯 Shared move helper — used by both mouse drag/drop and touch drag
  const moveEventToDate = (event, targetDate) => {
    if (!event || !targetDate) return;
    const oldStart = parseCalendarInstant(event.start_time);
    const oldEnd = parseCalendarInstant(event.end_time);
    const targetDateKey = format(targetDate, 'yyyy-MM-dd');
    const oldLocalInput = toDateTimeLocalInTimeZone(oldStart, companyTimeZone);
    const localStart = dateTimeLocalInTimeZoneToUtc(
      `${targetDateKey}T${oldLocalInput ? oldLocalInput.slice(11, 16) : '09:00'}`,
      companyTimeZone,
    );
    if (!localStart) {
      toast({ title: 'Invalid local time', description: 'This time falls in a daylight-saving gap. Choose another time.', variant: 'destructive' });
      return;
    }
    const durationMs = oldStart && oldEnd && oldEnd > oldStart ? oldEnd - oldStart : 60 * 60 * 1000;
    const newStart = new Date(localStart);
    const newEnd = new Date(newStart.getTime() + durationMs);
    updateEventMutation.mutate({
      id: event.id,
      originalEvent: event,
      data: { start_time: newStart.toISOString(), end_time: newEnd.toISOString() },
    });
  };

  // 🖱️ Mouse Drag and Drop Handlers
  const handleDragStart = (e, event) => {
    if (event.is_saas_event) return;
    setDraggedEvent(event);
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.style.opacity = '0.5';
  };

  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = '1';
    setDraggedEvent(null);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, targetDate) => {
    e.preventDefault();
    if (!draggedEvent) return;
    moveEventToDate(draggedEvent, targetDate);
    setDraggedEvent(null);
  };

  // 📱 Touch Drag and Drop Handlers (mobile)
  const handleTouchStart = (e, event) => {
    if (event.is_saas_event) return;
    isDraggingByTouchRef.current = false;
    // Capture the element reference immediately — e.currentTarget is only valid
    // synchronously, not inside the setTimeout callback.
    const target = e.currentTarget;
    touchDragTimerRef.current = setTimeout(() => {
      isDraggingByTouchRef.current = true;
      // Lock touch-action NOW (only after confirmed long-press) so normal
      // scroll is not blocked on a regular tap or swipe.
      if (target) target.style.touchAction = 'none';
      if (navigator.vibrate) navigator.vibrate(50);
      const touch = e.touches[0];
      const rect = target.getBoundingClientRect();
      const clone = target.cloneNode(true);
      clone.style.cssText = `
        position:fixed;left:${rect.left}px;top:${rect.top}px;
        width:${rect.width}px;opacity:0.85;z-index:9999;
        pointer-events:none;border-radius:6px;
        box-shadow:0 8px 24px rgba(0,0,0,0.35);transform:scale(1.08);
        transition:transform 0.1s;
      `;
      document.body.appendChild(clone);
      touchDragCloneRef.current = clone;
      setTouchDragEvent(event);
    }, 350);
  };

  const handleTouchMove = (e) => {
    if (!isDraggingByTouchRef.current) {
      clearTimeout(touchDragTimerRef.current);
      return;
    }
    e.preventDefault();
    const touch = e.touches[0];
    if (touchDragCloneRef.current) {
      touchDragCloneRef.current.style.left = `${touch.clientX - 40}px`;
      touchDragCloneRef.current.style.top = `${touch.clientY - 20}px`;
      touchDragCloneRef.current.style.display = 'none';
    }
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (touchDragCloneRef.current) touchDragCloneRef.current.style.display = '';
    const cell = el?.closest('[data-date]');
    touchDragTargetRef.current = cell?.getAttribute('data-date') ?? null;
    document.querySelectorAll('[data-date]').forEach(d => d.classList.remove('ring-2', 'ring-blue-400', '!bg-blue-100'));
    if (cell) cell.classList.add('ring-2', 'ring-blue-400', '!bg-blue-100');
  };

  const handleTouchEnd = () => {
    clearTimeout(touchDragTimerRef.current);
    document.querySelectorAll('[data-date]').forEach(d => d.classList.remove('ring-2', 'ring-blue-400', '!bg-blue-100'));
    if (touchDragCloneRef.current) {
      document.body.removeChild(touchDragCloneRef.current);
      touchDragCloneRef.current = null;
    }
    if (isDraggingByTouchRef.current && touchDragEvent && touchDragTargetRef.current) {
      moveEventToDate(touchDragEvent, new Date(touchDragTargetRef.current));
    }
    isDraggingByTouchRef.current = false;
    setTouchDragEvent(null);
    touchDragTargetRef.current = null;
  };

  const handleEditEvent = (event) => {
    // Prevent editing SaaS auto-generated events
    if (event.is_saas_event) {
      alert("This is an auto-generated system event and cannot be edited here.");
      return;
    }

    setEditingEvent(event);
    // datetime-local fields show the shared company time, not this device's zone.
    const safeStart = toDateTimeLocalInTimeZone(event.start_time, companyTimeZone);
    const safeEnd = toDateTimeLocalInTimeZone(event.end_time, companyTimeZone);

    setFormData({
      title: event.title,
      description: event.description || "",
      start_time: safeStart,
      end_time: safeEnd,
      event_type: event.event_type || "meeting",
      color: event.color || getColorForEventType(event.event_type || "meeting"),
      location: event.location || (() => {
        if (event.related_customer) {
          const c = allCustomers.find(c => c.name === event.related_customer);
          if (c) return c.address || [c.street, c.city, c.state, c.zip].filter(Boolean).join(', ') || '';
        }
        if (event.related_lead) {
          const l = allLeads.find(l => l.name === event.related_lead);
          if (l) return l.address || l.property_address || [l.street, l.city, l.state, l.zip].filter(Boolean).join(', ') || '';
        }
        return '';
      })(),
      attendees: event.attendees || [],
      assigned_to: event.assigned_to || "",
      related_customer: event.related_customer || "",
      related_lead: event.related_lead || "",
      send_email_notification: event.send_email_notification !== false,
      email_reminder_minutes: Array.isArray(event.email_reminder_minutes) ? event.email_reminder_minutes : (event.email_reminder_minutes !== undefined && event.email_reminder_minutes !== null ? [event.email_reminder_minutes] : [0]),
      send_sms_notification: event.send_sms_notification === true,
      sms_reminder_minutes: Array.isArray(event.sms_reminder_minutes) ? event.sms_reminder_minutes : (event.sms_reminder_minutes !== undefined && event.sms_reminder_minutes !== null ? [event.sms_reminder_minutes] : [10]),
      send_browser_notification: event.send_browser_notification !== false,
      browser_reminder_minutes: Array.isArray(event.browser_reminder_minutes) ? event.browser_reminder_minutes : (event.browser_reminder_minutes !== undefined && event.browser_reminder_minutes !== null ? [event.browser_reminder_minutes] : [0]),
      add_google_meet: event.location === 'https://meet.google.com/new' || (event.description?.includes('Google Meet: https://meet.google.com/new') ?? false),
    });
    setSelectedEvent(null);
    setShowEventDialog(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Auto-update color based on event type
    let finalFormData = { 
      ...formData,
      color: getColorForEventType(formData.event_type)
    };

    // Convert company-local wall times into UTC instants for persistence.
    const startUtc = dateTimeLocalInTimeZoneToUtc(finalFormData.start_time, companyTimeZone);
    const endUtc = dateTimeLocalInTimeZoneToUtc(finalFormData.end_time, companyTimeZone);
    if (!startUtc || !endUtc) {
      alert(`Choose valid start and end times in ${companyTimeZone}. Times skipped by daylight-saving changes cannot be scheduled.`);
      return;
    }
    if (Date.parse(endUtc) <= Date.parse(startUtc)) {
      alert('End time must be after start time.');
      return;
    }
    finalFormData.start_time = startUtc;
    finalFormData.end_time = endUtc;

    if (formData.add_google_meet) {
      const meetUrl = 'https://meet.google.com/new';
      finalFormData = {
        ...finalFormData,
        location: meetUrl,
        description: `${formData.description || ''}\n\n📹 Google Meet: ${meetUrl}`.trim(),
        color: '#0b8043'
      };
    }

    if (editingEvent) {
      updateEventFromFormMutation.mutate({ 
        id: editingEvent.id, 
        data: finalFormData,
        originalStartTime: editingEvent.start_time,
        originalEvent: editingEvent
      });
    } else {
      createEventMutation.mutate(finalFormData);
    }
  };

  // Who can delete a calendar event:
  //   • Admins/owners can delete any event.
  //   • Non-admins can only delete events assigned to themselves
  //     (if their role grants delete_own on the calendar feature).
  const canDeleteCalendarEvent = (event) => {
    if (!event) return false;
    if (isAdmin) return true;
    if (!hasPermission('calendar', 'delete_own')) return false;
    return event.assigned_to === effectiveUserEmail;
  };

  const handleDeleteEvent = (eventId) => {
    const event = mergedCalendarEvents.find(e => e.id === eventId);
    if (event?.is_saas_event || event?._isActionItem) {
      alert("This is an auto-generated system event and cannot be deleted here.");
      return;
    }

    // Role gate — non-admins cannot delete events that aren't theirs
    if (!canDeleteCalendarEvent(event)) {
      alert("You don't have permission to delete this event. Contact your administrator.");
      return;
    }

    // Find all real calendar events with the same title (series detection)
    const seriesEvents = calendarEvents.filter(
      e => e.title?.trim().toLowerCase() === event?.title?.trim().toLowerCase()
        && e.assigned_to === event?.assigned_to
        && !e.is_saas_event
    );

    if (seriesEvents.length > 1) {
      // Show the series delete dialog instead of a plain confirm
      setDeleteSeriesTarget({ event, seriesEvents });
      return;
    }

    if (window.confirm(t.calendar.deleteConfirm)) {
      deleteEventMutation.mutate(eventId);
    }
  };

  const handleMoveEvent = (event) => {
    if (event.is_saas_event) {
      alert("System events cannot be moved.");
      return;
    }
    setEventToMove(event);
    setMoveToDate(
      calendarDateFromKey(dateKeyInTimeZone(event.start_time, companyTimeZone)) || new Date(),
    );
    setShowMoveEventDialog(true);
  };

  const handleConfirmMove = () => {
    if (!eventToMove || !moveToDate) return;

    const oldStartTime = parseCalendarInstant(eventToMove.start_time);
    const oldEndTime = parseCalendarInstant(eventToMove.end_time);
    const newStartUtc = dateTimeLocalInTimeZoneToUtc(
      `${format(moveToDate, 'yyyy-MM-dd')}T${toDateTimeLocalInTimeZone(oldStartTime, companyTimeZone).slice(11, 16) || '09:00'}`,
      companyTimeZone,
    );
    if (!newStartUtc) {
      toast({ title: 'Invalid local time', description: 'This time falls in a daylight-saving gap. Choose another time.', variant: 'destructive' });
      return;
    }
    const duration = oldStartTime && oldEndTime && oldEndTime > oldStartTime
      ? oldEndTime.getTime() - oldStartTime.getTime()
      : 60 * 60 * 1000;
    const newStartTime = new Date(newStartUtc);
    const newEndTime = new Date(newStartTime.getTime() + duration);

    updateEventMutation.mutate({
      id: eventToMove.id,
      originalEvent: eventToMove,
      data: {
        start_time: newStartTime.toISOString(),
        end_time: newEndTime.toISOString(),
      }
    });
    
    setShowMoveEventDialog(false);
    setEventToMove(null);
    setMoveToDate(null);
  };

  const handleDayClick = (day) => {
    const dateKey = format(day, 'yyyy-MM-dd');
    
    setFormData({
      ...formData,
      start_time: `${dateKey}T09:00`,
      end_time: `${dateKey}T10:00`,
    });
    
    setEditingEvent(null);
    setShowEventDialog(true);
  };

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  const daysInView = React.useMemo(() => 
    eachDayOfInterval({ start: startDate, end: endDate }), 
    [startDate, endDate]
  );

  // 🚀 MEMOIZED EVENT GROUPING
  // Pre-calculate events map to avoid O(N*M) filtering on every render
  const eventsByDate = React.useMemo(() => {
    const map = {};
    
    let filteredEvents = mergedCalendarEvents;

    // View mode filter: "mine" shows only current user's events.
    // Also include UNASSIGNED events the user created (created_by) so AI-created
    // events with no assignee still appear for their creator — without leaking
    // events the user created but delegated to someone else.
    if (calendarViewMode === 'mine' && user?.email) {
      filteredEvents = filteredEvents.filter(e => e.assigned_to === user.email || (!e.assigned_to && e.created_by === user.email));
    }

    // Team view: people pill filter (empty = show all)
    if (calendarViewMode === 'team' && selectedPeople.length > 0) {
      filteredEvents = filteredEvents.filter(e => selectedPeople.includes(e.assigned_to));
    }

    // Legacy filter dialog filters
    if (selectedFilters.eventTypes.length > 0) {
      filteredEvents = filteredEvents.filter(e => selectedFilters.eventTypes.includes(e.event_type));
    }
    if (selectedFilters.assignedTo.length > 0) {
      filteredEvents = filteredEvents.filter(e => selectedFilters.assignedTo.includes(e.assigned_to));
    }

    // Group by date
    filteredEvents.forEach(event => {
      const start = parseCalendarInstant(event.start_time);
      if (!start) {
        console.warn('[Calendar] skipping event with invalid start_time', event.id, event.start_time);
        return;
      }
      const dateKey = dateKeyInTimeZone(start, companyTimeZone);
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(event);
    });

    return map;
  }, [mergedCalendarEvents, selectedFilters, calendarViewMode, selectedPeople, user?.email, companyTimeZone]);

  const getEventsForDay = React.useCallback((date) => {
    const dateKey = format(date, 'yyyy-MM-dd');
    return eventsByDate[dateKey] || [];
  }, [eventsByDate]);

  const eventTypes = [...new Set(calendarEvents.map(e => e.event_type))].filter(Boolean);
  const assignedUsers = [...new Set(calendarEvents.map(e => e.assigned_to).filter(Boolean))];

  const toggleFilter = (type, value) => {
    setSelectedFilters(prev => {
      const current = prev[type];
      if (current.includes(value)) {
        return { ...prev, [type]: current.filter(v => v !== value) };
      } else {
        return { ...prev, [type]: [...current, value] };
      }
    });
  };

  const handleShowDayEvents = (day, events) => {
    setSelectedDayEvents({
      date: day,
      events: events
    });
    setShowDayEventsDialog(true);
  };

  const addEmailReminder = () => {
    setReminderSettings({
      ...reminderSettings,
      email_reminder_minutes: [...reminderSettings.email_reminder_minutes, 0]
    });
  };

  const addSMSReminder = () => {
    setReminderSettings({
      ...reminderSettings,
      sms_reminder_minutes: [...reminderSettings.sms_reminder_minutes, 10]
    });
  };

  const addBrowserReminder = () => {
    setReminderSettings({
      ...reminderSettings,
      browser_reminder_minutes: [...reminderSettings.browser_reminder_minutes, 0]
    });
  };

  const removeEmailReminder = (index) => {
    const newArray = reminderSettings.email_reminder_minutes.filter((_, i) => i !== index);
    setReminderSettings({
      ...reminderSettings,
      email_reminder_minutes: newArray.length > 0 ? newArray : [0]
    });
  };

  const removeSMSReminder = (index) => {
    const newArray = reminderSettings.sms_reminder_minutes.filter((_, i) => i !== index);
    setReminderSettings({
      ...reminderSettings,
      sms_reminder_minutes: newArray.length > 0 ? newArray : [10]
    });
  };

  const removeBrowserReminder = (index) => {
    const newArray = reminderSettings.browser_reminder_minutes.filter((_, i) => i !== index);
    setReminderSettings({
      ...reminderSettings,
      browser_reminder_minutes: newArray.length > 0 ? newArray : [0]
    });
  };

  const updateReminderTime = (type, index, minutes) => {
    setReminderSettings(prev => {
      const newArray = [...prev[type]];
      newArray[index] = parseInt(minutes);
      return { ...prev, [type]: newArray };
    });
  };

  const addFormEmailReminder = () => {
    setFormData({
      ...formData,
      email_reminder_minutes: [...formData.email_reminder_minutes, 0]
    });
  };

  const addFormSMSReminder = () => {
    setFormData({
      ...formData,
      sms_reminder_minutes: [...formData.sms_reminder_minutes, 10]
    });
  };

  const addFormBrowserReminder = () => {
    setFormData({
      ...formData,
      browser_reminder_minutes: [...formData.browser_reminder_minutes, 0]
    });
  };

  const removeFormEmailReminder = (index) => {
    const newArray = formData.email_reminder_minutes.filter((_, i) => i !== index);
    setFormData({
      ...formData,
      email_reminder_minutes: newArray.length > 0 ? newArray : [0]
    });
  };

  const removeFormSMSReminder = (index) => {
    const newArray = formData.sms_reminder_minutes.filter((_, i) => i !== index);
    setFormData({
      ...formData,
      sms_reminder_minutes: newArray.length > 0 ? newArray : [10]
    });
  };

  const removeFormBrowserReminder = (index) => {
    const newArray = formData.browser_reminder_minutes.filter((_, i) => i !== index);
    setFormData({
      ...formData,
      browser_reminder_minutes: newArray.length > 0 ? newArray : [0]
    });
  };

  const updateFormReminderTime = (type, index, minutes) => {
    setFormData(prev => {
      const newArray = [...prev[type]];
      newArray[index] = parseInt(minutes);
      return { ...prev, [type]: newArray };
    });
  };

  // Assign a stable color to each staff member for their pill
  const staffColors = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#f97316','#14b8a6','#6366f1'];
  const teamMembers = React.useMemo(() => {
    const seen = new Set();
    return allStaffProfiles.filter(sp => {
      if (!sp.user_email || seen.has(sp.user_email)) return false;
      seen.add(sp.user_email);
      return true;
    });
  }, [allStaffProfiles]);

  if (isLoadingCalendar) {
    return <TablePageSkeleton />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-r from-blue-700 via-blue-600 to-blue-800 text-white p-6 shadow-lg">
        <div className="max-w-7xl mx-auto">
          {/* Row 1: Month nav + actions */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                className="text-white hover:bg-white/20"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <div>
                <h1 className="text-3xl font-bold">{format(currentMonth, 'MMMM yyyy')}</h1>
                <span className="text-xs text-blue-100">All times: {companyTimeZoneLabel}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentMonth(calendarDateFromKey(dateKeyInTimeZone(new Date(), companyTimeZone)) || new Date())}
                className="bg-white/20 border-white/30 text-white hover:bg-white/30"
              >
                {t.calendar.today}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                className="text-white hover:bg-white/20"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>

            <div className="flex gap-2 flex-wrap sm:flex-nowrap justify-end items-center">
              {/* Google sync — only in My Calendar mode */}
              {calendarViewMode === 'mine' && !checkingConnection && (
                googleCalendarConnected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGoogleSync}
                    disabled={isConnecting || autoSyncing}
                    className="bg-green-500/20 border-green-400/50 text-white hover:bg-green-500/30"
                    title="Google Calendar connected — click to sync now"
                  >
                    {(isConnecting || autoSyncing) ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2 text-green-300" />}
                    Google Connected
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGoogleConnect}
                    disabled={isConnecting}
                    className="bg-white/10 border-white/40 text-white hover:bg-white/20"
                  >
                    {isConnecting ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <LinkIcon className="w-4 h-4 mr-2" />}
                    Connect Google
                  </Button>
                )
              )}

              {/* Microsoft / Outlook Calendar sync — only in My Calendar mode */}
              {calendarViewMode === 'mine' && !checkingConnection && (
                microsoftCalendarConnected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleMicrosoftSync}
                    disabled={isMsConnecting}
                    className="bg-green-500/20 border-green-400/50 text-white hover:bg-green-500/30"
                    data-testid="btn-sync-outlook"
                    title="Outlook Calendar connected — click to sync now"
                  >
                    {isMsConnecting ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2 text-green-300" />}
                    Outlook Connected
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleMicrosoftConnect}
                    disabled={isMsConnecting}
                    className="bg-white/10 border-white/40 text-white hover:bg-white/20"
                    data-testid="btn-connect-outlook"
                  >
                    {isMsConnecting ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <LinkIcon className="w-4 h-4 mr-2" />}
                    Connect Outlook
                  </Button>
                )
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowReminderSettings(true)}
                className="bg-white/20 border-white/30 text-white hover:bg-white/30"
                data-testid="btn-reminder-settings"
              >
                <Settings className="w-4 h-4 mr-2" />
                Reminders
              </Button>

              <Button
                data-testid="btn-add-event"
                onClick={() => {
                  setShowEventDialog(true);
                  setEditingEvent(null);
                  const defaultStart = new Date(Date.now() + 5 * 60 * 1000);
                  const defaultEnd = new Date(defaultStart.getTime() + 60 * 60 * 1000);
                  setFormData({
                    title: "",
                    description: "",
                    start_time: toDateTimeLocalInTimeZone(defaultStart, companyTimeZone),
                    end_time: toDateTimeLocalInTimeZone(defaultEnd, companyTimeZone),
                    event_type: "meeting",
                    color: getColorForEventType("meeting"),
                    location: "",
                    attendees: [],
                    related_customer: "",
                    related_lead: "",
                    send_email_notification: true,
                    email_reminder_minutes: [0],
                    send_sms_notification: false,
                    sms_reminder_minutes: [10],
                    send_browser_notification: true,
                    browser_reminder_minutes: [0],
                    add_google_meet: googleCalendarConnected,
                    assigned_to: calendarViewMode === 'mine' ? (user?.email || "") : "",
                  });
                }}
                className="bg-white text-blue-600 hover:bg-blue-50"
              >
                <Plus className="w-4 h-4 mr-2" />
                {t.calendar.addEvent}
              </Button>
            </div>
          </div>

          {/* Row 2: My Calendar / Team toggle + staff pills */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* View toggle */}
            <div className="flex bg-white/10 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setCalendarViewMode('mine')}
                className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${calendarViewMode === 'mine' ? 'bg-white text-blue-700 shadow' : 'text-white/80 hover:text-white'}`}
              >
                My Calendar
              </button>
              <button
                type="button"
                onClick={() => setCalendarViewMode('team')}
                className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${calendarViewMode === 'team' ? 'bg-white text-blue-700 shadow' : 'text-white/80 hover:text-white'}`}
              >
                Team Calendar
              </button>
            </div>

            {/* Staff people pills — Team mode */}
            {calendarViewMode === 'team' && teamMembers.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white/60 text-xs">Filter by:</span>
                {teamMembers.map((member, idx) => {
                  const color = staffColors[idx % staffColors.length];
                  const isActive = selectedPeople.includes(member.user_email);
                  const name = member.full_name || member.user_email?.split('@')[0] || 'Staff';
                  return (
                    <button
                      key={member.user_email}
                      type="button"
                      onClick={() => setSelectedPeople(prev =>
                        prev.includes(member.user_email)
                          ? prev.filter(e => e !== member.user_email)
                          : [...prev, member.user_email]
                      )}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border ${isActive ? 'text-white border-transparent shadow-md' : 'bg-white/10 text-white/70 border-white/20 hover:bg-white/20 hover:text-white'}`}
                      style={isActive ? { backgroundColor: color, borderColor: color } : {}}
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: isActive ? 'rgba(255,255,255,0.8)' : color }}
                      />
                      {name}
                    </button>
                  );
                })}
                {selectedPeople.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedPeople([])}
                    className="text-white/50 hover:text-white text-xs underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}

            {/* Action Items toggle */}
            <button
              type="button"
              onClick={() => setShowActionItems(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${showActionItems ? 'bg-white text-purple-700 border-white shadow' : 'bg-white/10 text-white/70 border-white/20 hover:bg-white/20 hover:text-white'}`}
              data-testid="toggle-action-items-calendar"
            >
              <Zap className="w-3.5 h-3.5" />
              Action Items
            </button>

            {/* Tasks toggle */}
            <button
              type="button"
              onClick={() => setShowTasks(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${showTasks ? 'bg-white text-sky-700 border-white shadow' : 'bg-white/10 text-white/70 border-white/20 hover:bg-white/20 hover:text-white'}`}
              data-testid="toggle-tasks-calendar"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              Tasks
            </button>

            {/* My Calendar note */}
            {calendarViewMode === 'mine' && (
              <span className="text-white/50 text-xs">Your events also appear on the Team Calendar</span>
            )}
          </div>
        </div>
      </div>

      {/* Revoked-token reconnect banner — persists until the user reconnects */}
      <div className="max-w-7xl mx-auto px-6 pt-6 empty:hidden">
        <GoogleCalendarReconnectBanner />
      </div>

      {/* Auth error reconnect banner */}
      {lastSyncError === 'Auth error' && !googleCalendarConnected && (
        <div className="max-w-7xl mx-auto px-6 pt-6">
          <Alert className="bg-red-50 border-red-300">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-900 flex items-center justify-between gap-4">
              <div>
                <strong>{t.calendar.meeting} (401)</strong>
                <p className="text-sm mt-1">{t.calendar.description}</p>
              </div>
              <Button
                size="sm"
                onClick={handleGoogleConnect}
                disabled={isConnecting}
                className="bg-red-600 hover:bg-red-700 text-white whitespace-nowrap flex-shrink-0"
              >
                {isConnecting ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
                {t.common.refresh} {t.calendar.meeting}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Single sync status alert */}
      {googleCalendarConnected && (
        <div className="max-w-7xl mx-auto p-6">
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-900 flex items-center justify-between">
              <div>
                <strong>✅ {t.calendar.meeting} {t.common.status}</strong>
                <p className="text-sm mt-1">
                  {t.calendar.calendar} {t.common.status}
                  {lastSync && ` ${t.common.status}: ${safeFormat(lastSync, 'MMM d, h:mm a')}`}
                  {autoSyncing && <span className="text-blue-600"> ({t.common.loading}...)</span>}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (!confirm(`${t.common.update}?`)) return;
                  setIsConnecting(true);
                  try {
                    const result = await base44.functions.invoke('fixGoogleCalendarEvents', {});
                    alert(result.data.message);
                    queryClient.invalidateQueries({ queryKey: ['calendar-events-user'] });
                    queryClient.invalidateQueries({ queryKey: ['calendar-events-company'] });
                  } catch (error) {
                    alert('Error: ' + error.message);
                  } finally {
                    setIsConnecting(false);
                  }
                }}
                disabled={isConnecting}
                className="bg-orange-100 border-orange-300 text-orange-700 hover:bg-orange-200 whitespace-nowrap"
              >
                <Zap className="w-4 h-4 mr-2" />
                Fix Missing Events
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      <Dialog open={showSetupDialog} onOpenChange={setShowSetupDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              <Wrench className="w-6 h-6 text-orange-600" />
              Google Calendar Setup Diagnostic
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            {setupDiagnosis ? (
              <div className="space-y-4">
                {setupDiagnosis.error ? (
                  <Alert className="bg-red-50 border-red-200">
                    <AlertCircle className="w-4 h-4 text-red-600" />
                    <AlertDescription className="text-red-900">
                      {setupDiagnosis.error}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <Card>
                      <CardContent className="pt-6">
                        <h3 className="font-semibold mb-3">📊 Current Status</h3>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div><strong>Connection:</strong> {setupDiagnosis.connection_status}</div>
                          <div><strong>Access Token:</strong> {setupDiagnosis.has_access_token ? 'Yes' : 'No'}</div>
                          <div><strong>Refresh Token:</strong> {setupDiagnosis.has_refresh_token ? 'Yes' : 'No'}</div>
                          <div><strong>Token Status:</strong> {setupDiagnosis.token_expired === 'N/A' ? 'N/A' : (setupDiagnosis.token_expired ? 'Expired' : 'Valid')}</div>
                          <div className="col-span-2"><strong>API Test:</strong> {setupDiagnosis.api_access_test}</div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="pt-6">
                        <h3 className="font-semibold mb-3">📋 Required Setup Steps</h3>
                        <div className="bg-gray-50 p-4 rounded-lg font-mono text-xs whitespace-pre-wrap">
                          {setupDiagnosis.required_steps.join('\n')}
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="pt-6">
                        <h3 className="font-semibold mb-3">🔗 Quick Links</h3>
                        <div className="space-y-2">
                          <a
                            href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-blue-600 hover:underline text-sm"
                          >
                            → Enable Google Calendar API
                          </a>
                          <a
                            href="https://console.cloud.google.com/apis/credentials/consent"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-blue-600 hover:underline text-sm"
                          >
                            → Configure OAuth Consent Screen
                          </a>
                          <a
                            href="https://console.cloud.google.com/apis/credentials"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-blue-600 hover:underline text-sm"
                          >
                            → Fix Redirect URI
                          </a>
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
                <span className="ml-3">{t.common.loading}...</span>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {checkingConnection ? (
        <div className="max-w-7xl mx-auto p-6">
          <Card className="shadow-lg">
            <CardContent className="py-16 text-center">
              <RefreshCw className="w-12 h-12 text-blue-600 mx-auto mb-4 animate-spin" />
              <p className="text-gray-600">{t.common.loading}</p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto px-6 pb-6">
          <Card className="shadow-lg">
            <CardContent className="p-0">
              <div className="grid grid-cols-7 border-b bg-gray-50">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="p-4 text-center font-semibold text-gray-700 border-r last:border-r-0">
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7">
                {daysInView.map((day, i) => {
                  const dayEvents = getEventsForDay(day);
                  const isToday = format(day, 'yyyy-MM-dd') === dateKeyInTimeZone(new Date(), companyTimeZone);
                  const isCurrentMonth = day.getMonth() === currentMonth.getMonth();

                  return (
                    <div
                      key={i}
                      data-date={format(day, 'yyyy-MM-dd')}
                      className={`min-h-[140px] p-3 border-r border-b last:border-r-0 ${
                        isToday ? 'bg-blue-50' : isCurrentMonth ? 'bg-white' : 'bg-gray-50'
                      } hover:bg-gray-100 transition-colors cursor-pointer`}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, day)}
                      onClick={() => handleDayClick(day)}
                    >
                      <div className={`text-sm font-semibold mb-2 ${
                        isToday 
                          ? 'text-blue-600 font-bold' 
                          : isCurrentMonth 
                          ? 'text-gray-700' 
                          : 'text-gray-400'
                      }`}>
                        {format(day, 'd')}
                      </div>

                      <div className="space-y-1">
                        {dayEvents.slice(0, 3).map((event) => (
                          <div
                            key={event.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, event)}
                            onDragEnd={handleDragEnd}
                            onTouchStart={(e) => handleTouchStart(e, event)}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={handleTouchEnd}
                            className="text-xs px-2 py-1.5 rounded cursor-move hover:opacity-80 transition-opacity active:cursor-grabbing select-none"
                            style={{ 
                              backgroundColor: event.color || getColorForEventType(event.event_type),
                              color: 'white',
                            }}
                            onClick={(e) => {
                              if (isDraggingByTouchRef.current) { e.stopPropagation(); return; }
                              e.stopPropagation();
                              setSelectedEvent(event);
                            }}
                          >
                            <div className="font-medium truncate">{event.title}</div>
                            <div className="text-[10px] opacity-90">
                              {formatCompanyEventTime(event.start_time, { hour: 'numeric', minute: '2-digit' }) || t.common.invalid}
                            </div>
                            {event.assigned_to && (
                              <div className="text-[10px] opacity-75 truncate">
                                {allStaffProfiles.find(s => s.user_email === event.assigned_to)?.full_name || event.assigned_to}
                              </div>
                            )}
                          </div>
                        ))}

                        {dayEvents.length > 3 && (
                          <div 
                            className="text-xs text-blue-600 font-medium px-2 cursor-pointer hover:underline active:scale-95"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleShowDayEvents(day, dayEvents);
                            }}
                          >
                            +{dayEvents.length - 3} {t.common.more}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={showDayEventsDialog} onOpenChange={setShowDayEventsDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>
              {selectedDayEvents.date && format(selectedDayEvents.date, 'EEEE, MMMM d, yyyy')}
            </DialogTitle>
            <p className="text-sm text-gray-500 mt-1">
              {selectedDayEvents.events.length} {t.sidebar.calendar} {selectedDayEvents.events.length !== 1 ? 's' : ''}
            </p>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-3">
              {selectedDayEvents.events.map((event) => (
                <div 
                  key={event.id}
                  className="p-4 border rounded-lg hover:shadow-md transition-shadow cursor-pointer"
                  style={{ borderLeft: `4px solid ${event.color || getColorForEventType(event.event_type)}` }}
                  onClick={() => {
                    setSelectedEvent(event);
                    setShowDayEventsDialog(false);
                  }}
                >
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-semibold text-lg">{event.title}</h4>
                    <Badge variant="outline">{event.event_type?.replace(/_/g, ' ')}</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                    <CalendarIcon className="w-4 h-4" />
                    <span>
                      {formatCompanyEventTime(event.start_time, { hour: 'numeric', minute: '2-digit' }) || t.common.invalid}
                      {event.end_time && formatCompanyEventTime(event.end_time, { hour: 'numeric', minute: '2-digit' }) && ` - ${formatCompanyEventTime(event.end_time, { hour: 'numeric', minute: '2-digit' })}`}
                    </span>
                  </div>
                  {event.location && (
                    <div className="text-sm text-gray-600 mt-1">
                      📍 {event.location}
                    </div>
                  )}
                  {event.description && (
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2">{event.description}</p>
                  )}
                  {event.assigned_to && (
                    <div className="text-xs text-gray-500 mt-2">
                      Assigned to: {allStaffProfiles.find(s => s.user_email === event.assigned_to)?.full_name || event.assigned_to}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={selectedEvent !== null} onOpenChange={() => setSelectedEvent(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between pr-8">
              <DialogTitle className="text-2xl">{selectedEvent?.title}</DialogTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedEvent(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </DialogHeader>
          {selectedEvent && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-gray-600">
                <CalendarIcon className="w-5 h-5" />
                <div>
                  <div className="font-medium">
                    {formatCompanyEventTime(selectedEvent.start_time, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) || t.common.date}
                  </div>
                  <div className="text-sm">
                    {formatCompanyEventTime(selectedEvent.start_time, { hour: 'numeric', minute: '2-digit' })} - 
                    {selectedEvent.end_time && ` ${formatCompanyEventTime(selectedEvent.end_time, { hour: 'numeric', minute: '2-digit' })}`}
                  </div>
                </div>
              </div>

              {selectedEvent.event_type && (
                <div>
                  <span className="font-semibold">{t.calendar.type}: </span>
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
                  <span className="font-semibold">{t.calendar.description}:</span>
                  <p className="text-gray-600 mt-1">{selectedEvent.description}</p>
                </div>
              )}

              {selectedEvent.location && (
                <div>
                  <span className="font-semibold">{t.calendar.location}: </span>
                  {selectedEvent.location}
                </div>
              )}

              {selectedEvent.assigned_to && (
                <div>
                  <span className="font-semibold">{t.tasks.assignedTo}: </span>
                  {allStaffProfiles.find(s => s.user_email === selectedEvent.assigned_to)?.full_name || selectedEvent.assigned_to}
                </div>
              )}

              {selectedEvent.related_customer && (
                <div>
                  <span className="font-semibold">{t.estimates.customer}: </span>
                  <Badge variant="outline" className="bg-blue-50 text-blue-700">
                    {selectedEvent.related_customer}
                  </Badge>
                </div>
              )}

              {selectedEvent.related_lead && (
                <div>
                  <span className="font-semibold">{t.sidebar.allLeads}: </span>
                  <Badge variant="outline" className="bg-purple-50 text-purple-700">
                    {selectedEvent.related_lead}
                  </Badge>
                </div>
              )}

              {(() => {
                const rawAttendees = selectedEvent.attendees;
                const attendees = Array.isArray(rawAttendees)
                  ? rawAttendees
                  : typeof rawAttendees === 'string' && rawAttendees.trim()
                    ? rawAttendees.split(',').map(a => a.trim()).filter(Boolean)
                    : [];
                return attendees.length > 0 ? (
                  <div>
                    <span className="font-semibold">{t.calendar.attendees}:</span>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {attendees.map((attendee, i) => (
                        <Badge key={i} variant="outline">{attendee}</Badge>
                      ))}
                    </div>
                  </div>
                ) : null;
              })()}

              {!selectedEvent._isActionItem && <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-semibold flex items-center gap-2">
                    <Bell className="w-5 h-5" />
                    {t.sidebar.reminders}:
                  </span>
                  {!editingReminders && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingReminders(true)}
                    >
                      <Edit className="w-4 h-4 mr-1" />
                      {t.common.edit}
                    </Button>
                  )}
                </div>

                {!editingReminders ? (
                  <div className="space-y-3">
                    {reminderSettings.send_email_notification ? (
                      <div>
                        <Label className="text-sm font-medium mb-1 block">Email:</Label>
                        <div className="flex flex-wrap gap-2">
                          {reminderSettings.email_reminder_minutes.map((min, i) => (
                            <Badge key={i} className="bg-green-100 text-green-700">
                              ✓ {formatReminderTime(min)}
                              {selectedEvent.notification_sent && i === 0 && (
                                <span className="ml-1 text-xs">({t.common.sent})</span>
                              )}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-gray-500">Email Reminders Off</Badge>
                    )}

                    {reminderSettings.send_sms_notification ? (
                      <div>
                        <Label className="text-sm font-medium mb-1 block">SMS:</Label>
                        <div className="flex flex-wrap gap-2">
                          {reminderSettings.sms_reminder_minutes.map((min, i) => (
                            <Badge key={i} className="bg-purple-100 text-purple-700">
                              ✓ {formatReminderTime(min)}
                              {selectedEvent.sms_notification_sent && i === 0 && (
                                <span className="ml-1 text-xs">({t.common.sent})</span>
                              )}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-gray-500">SMS Reminders Off</Badge>
                    )}

                    {reminderSettings.send_browser_notification ? (
                      <div>
                        <Label className="text-sm font-medium mb-1 block">Browser:</Label>
                        <div className="flex flex-wrap gap-2">
                          {reminderSettings.browser_reminder_minutes.map((min, i) => (
                            <Badge key={i} className="bg-blue-100 text-blue-700">
                              ✓ {formatReminderTime(min)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-gray-500">Browser Notifications Off</Badge>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4 bg-gray-50 p-4 rounded-lg">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="email-reminder-checkbox" className="font-medium cursor-pointer">{t.common.email} {t.sidebar.reminders}</Label>
                        <Checkbox
                          id="email-reminder-checkbox"
                          checked={reminderSettings.send_email_notification}
                          onCheckedChange={(checked) => 
                            setReminderSettings({...reminderSettings, send_email_notification: checked})
                          }
                        />
                      </div>
                      {reminderSettings.send_email_notification && (
                        <div className="space-y-2">
                          {reminderSettings.email_reminder_minutes.map((minutes, index) => (
                            <div key={`email-${index}`} className="flex items-center gap-2">
                              <Select
                                value={minutes.toString()}
                                onValueChange={(v) => updateReminderTime('email_reminder_minutes', index, v)}
                              >
                                <SelectTrigger className="flex-1">
                                  <SelectValue placeholder={t.calendar.startTime} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="0">At time of event</SelectItem>
                                  <SelectItem value="5">5 minutes before</SelectItem>
                                  <SelectItem value="10">10 minutes before</SelectItem>
                                  <SelectItem value="15">15 minutes before</SelectItem>
                                  <SelectItem value="30">30 minutes before</SelectItem>
                                  <SelectItem value="60">1 hour before</SelectItem>
                                  <SelectItem value="120">2 hours before</SelectItem>
                                  <SelectItem value="1440">1 day before</SelectItem>
                                </SelectContent>
                              </Select>
                              {reminderSettings.email_reminder_minutes.length > 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeEmailReminder(index)}
                                  className="text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          ))}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={addEmailReminder}
                            className="w-full"
                          >
                            <Plus className="w-4 h-4 mr-1" />
                            {t.common.add} {t.common.email}
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="sms-reminder-checkbox" className="font-medium cursor-pointer">{t.common.phone} {t.sidebar.reminders}</Label>
                        <Checkbox
                          id="sms-reminder-checkbox"
                          checked={reminderSettings.send_sms_notification}
                          onCheckedChange={(checked) => 
                            setReminderSettings({...reminderSettings, send_sms_notification: checked})
                          }
                        />
                      </div>
                      {reminderSettings.send_sms_notification && (
                        <div className="space-y-2">
                          {reminderSettings.sms_reminder_minutes.map((minutes, index) => (
                            <div key={`sms-${index}`} className="flex items-center gap-2">
                              <Select
                                value={minutes.toString()}
                                onValueChange={(v) => updateReminderTime('sms_reminder_minutes', index, v)}
                              >
                                <SelectTrigger className="flex-1">
                                  <SelectValue placeholder={t.calendar.startTime} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="0">At time of event</SelectItem>
                                  <SelectItem value="5">5 minutes before</SelectItem>
                                  <SelectItem value="10">10 minutes before</SelectItem>
                                  <SelectItem value="15">15 minutes before</SelectItem>
                                  <SelectItem value="30">30 minutes before</SelectItem>
                                  <SelectItem value="60">1 hour before</SelectItem>
                                  <SelectItem value="120">2 hours before</SelectItem>
                                  <SelectItem value="1440">1 day before</SelectItem>
                                </SelectContent>
                              </Select>
                              {reminderSettings.sms_reminder_minutes.length > 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeSMSReminder(index)}
                                  className="text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          ))}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={addSMSReminder}
                            className="w-full"
                          >
                            <Plus className="w-4 h-4 mr-1" />
                            {t.common.add} {t.common.phone}
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="browser-reminder-checkbox" className="font-medium cursor-pointer">{t.common.web} {t.sidebar.notifications}</Label>
                        <Checkbox
                          id="browser-reminder-checkbox"
                          checked={reminderSettings.send_browser_notification}
                          onCheckedChange={(checked) => 
                            setReminderSettings({...reminderSettings, send_browser_notification: checked})
                          }
                        />
                      </div>
                      {reminderSettings.send_browser_notification && (
                        <div className="space-y-2">
                          {reminderSettings.browser_reminder_minutes.map((minutes, index) => (
                            <div key={`browser-${index}`} className="flex items-center gap-2">
                              <Select
                                value={minutes.toString()}
                                onValueChange={(v) => updateReminderTime('browser_reminder_minutes', index, v)}
                              >
                                <SelectTrigger className="flex-1">
                                  <SelectValue placeholder={t.calendar.startTime} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="0">At time of event</SelectItem>
                                  <SelectItem value="5">5 minutes before</SelectItem>
                                  <SelectItem value="10">10 minutes before</SelectItem>
                                  <SelectItem value="15">15 minutes before</SelectItem>
                                  <SelectItem value="30">30 minutes before</SelectItem>
                                  <SelectItem value="60">1 hour before</SelectItem>
                                  <SelectItem value="120">2 hours before</SelectItem>
                                  <SelectItem value="1440">1 day before</SelectItem>
                                </SelectContent>
                              </Select>
                              {reminderSettings.browser_reminder_minutes.length > 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeBrowserReminder(index)}
                                  className="text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          ))}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={addBrowserReminder}
                            className="w-full"
                          >
                            <Plus className="w-4 h-4 mr-1" />
                            {t.common.add} {t.sidebar.notifications}
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingReminders(false);
                          setReminderSettings({
                            send_email_notification: selectedEvent.send_email_notification !== false,
                            email_reminder_minutes: Array.isArray(selectedEvent.email_reminder_minutes) ? selectedEvent.email_reminder_minutes : (selectedEvent.email_reminder_minutes !== undefined && selectedEvent.email_reminder_minutes !== null ? [selectedEvent.email_reminder_minutes] : [0]),
                            send_sms_notification: selectedEvent.send_sms_notification === true,
                            sms_reminder_minutes: Array.isArray(selectedEvent.sms_reminder_minutes) ? selectedEvent.sms_reminder_minutes : (selectedEvent.sms_reminder_minutes !== undefined && selectedEvent.sms_reminder_minutes !== null ? [selectedEvent.sms_reminder_minutes] : [10]),
                            send_browser_notification: selectedEvent.send_browser_notification !== false,
                            browser_reminder_minutes: Array.isArray(selectedEvent.browser_reminder_minutes) ? selectedEvent.browser_reminder_minutes : (selectedEvent.browser_reminder_minutes !== undefined && selectedEvent.browser_reminder_minutes !== null ? [selectedEvent.browser_reminder_minutes] : [0]),
                          });
                        }}
                      >
                        {t.common.cancel}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleUpdateReminders}
                        disabled={updateRemindersMutation.isPending}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        {updateRemindersMutation.isPending ? t.common.loading : t.common.save}
                      </Button>
                    </div>
                  </div>
                )}
              </div>}

              <div className="flex flex-wrap gap-2 pt-4 border-t">
                {selectedEvent._isActionItem ? (
                  <>
                    <Button
                      onClick={async () => {
                        setCompletingActionItem(true);
                        try {
                          await base44.entities.ActionItem.update(selectedEvent._actionItemId, { status: 'completed', completed_at: new Date().toISOString() });
                          queryClient.invalidateQueries({ queryKey: ['action-items-calendar'] });
                          queryClient.invalidateQueries({ queryKey: ['action-items'] });
                          queryClient.invalidateQueries({ queryKey: ['action-items-sidebar'] });
                          setSelectedEvent(null);
                        } catch (e) {
                          alert('Failed to complete action item');
                        } finally {
                          setCompletingActionItem(false);
                        }
                      }}
                      disabled={completingActionItem}
                      className="bg-green-600 hover:bg-green-700 text-white flex-1 min-h-[48px]"
                      data-testid="calendar-complete-action-item"
                    >
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      {completingActionItem ? 'Completing...' : 'Mark Done'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        window.location.href = createPageUrl('ActionItems') + `?itemId=${selectedEvent._actionItemId}`;
                        setSelectedEvent(null);
                      }}
                      className="flex-1 min-h-[48px]"
                      data-testid="calendar-view-action-item"
                    >
                      <Zap className="w-4 h-4 mr-2" />
                      View Action Item
                    </Button>
                  </>
                ) : (
                  <>
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        handleMoveEvent(selectedEvent);
                        setSelectedEvent(null);
                      }}
                      className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 flex-1 min-h-[48px]"
                    >
                      <MoveRight className="w-4 h-4 mr-2" />
                      {t.calendar.editEvent}
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => handleEditEvent(selectedEvent)}
                      className="flex-1 min-h-[48px]"
                    >
                      <Edit className="w-4 h-4 mr-2" />
                      {t.common.edit}
                    </Button>
                    {canDeleteCalendarEvent(selectedEvent) && (
                    <Button 
                      variant="outline" 
                      onClick={() => handleDeleteEvent(selectedEvent.id)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 min-h-[48px]"
                      disabled={deleteEventMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      {deleteEventMutation.isPending ? t.common.loading : t.common.delete}
                    </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showMoveEventDialog} onOpenChange={setShowMoveEventDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.calendar.editEvent}</DialogTitle>
          </DialogHeader>
          {eventToMove && (
            <div className="space-y-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <p className="font-semibold text-blue-900">{eventToMove.title}</p>
                <p className="text-sm text-blue-700 mt-1">
                  {t.common.status}: {formatCompanyEventTime(eventToMove.start_time, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>

              <div>
                <Label className="mb-2 block">{t.calendar.date}:</Label>
                <CalendarPicker
                  mode="single"
                  selected={moveToDate}
                  onSelect={setMoveToDate}
                  className="rounded-md border mx-auto"
                />
                <p className="text-sm text-gray-600 mt-3">
                  {t.calendar.startTime}: {formatCompanyEventTime(eventToMove.start_time, { hour: 'numeric', minute: '2-digit' }) || t.common.invalid}
                </p>
              </div>

              <div className="flex gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowMoveEventDialog(false);
                    setEventToMove(null);
                    setMoveToDate(null);
                  }}
                  className="flex-1 min-h-[48px]"
                >
                  {t.common.cancel}
                </Button>
                <Button
                  onClick={handleConfirmMove}
                  disabled={!moveToDate || updateEventMutation.isPending}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 min-h-[48px]"
                >
                  {updateEventMutation.isPending ? t.common.loading : t.calendar.editEvent}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 🗑️ Delete Series Dialog */}
      <Dialog open={!!deleteSeriesTarget} onOpenChange={(open) => { if (!open) setDeleteSeriesTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Recurring Events</DialogTitle>
          </DialogHeader>
          {deleteSeriesTarget && (
            <div className="space-y-4">
              <p className="text-gray-600 text-sm">
                There are <span className="font-semibold text-gray-900">{deleteSeriesTarget.seriesEvents.length} events</span> named{' '}
                <span className="font-semibold text-gray-900">"{deleteSeriesTarget.event.title}"</span>.
                What would you like to delete?
              </p>
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  className="w-full min-h-[48px] justify-start"
                  onClick={() => {
                    setDeleteSeriesTarget(null);
                    if (window.confirm(t.calendar.deleteConfirm)) {
                      deleteEventMutation.mutate(deleteSeriesTarget.event.id);
                    }
                  }}
                  disabled={deleteEventMutation.isPending || deleteSeriesMutation.isPending}
                >
                  <Trash2 className="w-4 h-4 mr-2 text-gray-500" />
                  Just this event
                </Button>
                <BulkDeleteButton
                  className="w-full min-h-[48px] justify-start bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => {
                    deleteSeriesMutation.mutate(deleteSeriesTarget.seriesEvents.map(e => e.id));
                  }}
                  disabled={deleteEventMutation.isPending || deleteSeriesMutation.isPending}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {deleteSeriesMutation.isPending
                    ? 'Deleting all...'
                    : `Delete all ${deleteSeriesTarget.seriesEvents.length} events`}
                </BulkDeleteButton>
                <Button
                  variant="ghost"
                  className="w-full min-h-[48px]"
                  onClick={() => setDeleteSeriesTarget(null)}
                  disabled={deleteEventMutation.isPending || deleteSeriesMutation.isPending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showEventDialog} onOpenChange={(open) => {
        if (!open) {
          setShowEventDialog(false);
          setEditingEvent(null);
          resetEventForm();
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingEvent ? t.calendar.editEvent : t.calendar.addEvent}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>{t.calendar.eventTitle} *</Label>
              <Input
                data-testid="input-event-title"
                value={formData.title}
                onChange={(e) => setFormData({...formData, title: e.target.value})}
                required
                placeholder={`${t.calendar.meeting}, ${t.calendar.inspection}, ${t.calendar.call}, etc.`}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t.calendar.startTime} ({companyTimeZone}) *</Label>
                <Input
                  data-testid="input-event-start-time"
                  type="datetime-local"
                  value={formData.start_time}
                  onChange={(e) => {
                    const newStart = e.target.value;
                    if (!newStart) { setFormData({...formData, start_time: newStart}); return; }
                    const newStartUtc = dateTimeLocalInTimeZoneToUtc(newStart, companyTimeZone);
                    const curStartUtc = formData.start_time
                      ? dateTimeLocalInTimeZoneToUtc(formData.start_time, companyTimeZone)
                      : null;
                    const curEndUtc = formData.end_time
                      ? dateTimeLocalInTimeZoneToUtc(formData.end_time, companyTimeZone)
                      : null;
                    if (!newStartUtc) {
                      setFormData({ ...formData, start_time: newStart, end_time: '' });
                      return;
                    }
                    const newStartMs = Date.parse(newStartUtc);
                    const curStartMs = curStartUtc ? Date.parse(curStartUtc) : null;
                    const curEndMs = curEndUtc ? Date.parse(curEndUtc) : null;
                    const durationMs = (curStartMs && curEndMs && curEndMs > curStartMs)
                      ? curEndMs - curStartMs
                      : 60 * 60 * 1000;
                    const newEndDate = new Date(newStartMs + durationMs);
                    const newEnd = toDateTimeLocalInTimeZone(newEndDate, companyTimeZone);
                    setFormData({...formData, start_time: newStart, end_time: newEnd});
                  }}
                  required
                />
              </div>
              <div>
                <Label>{t.calendar.endTime} ({companyTimeZone}) *</Label>
                <Input
                  data-testid="input-event-end-time"
                  type="datetime-local"
                  value={formData.end_time}
                  onChange={(e) => setFormData({...formData, end_time: e.target.value})}
                  required
                />
              </div>
            </div>

            {/* Assigned To — staff member responsible for this event */}
            <div>
              <Label>Assigned To</Label>
              <Select
                value={formData.assigned_to || user?.email || '__none__'}
                onValueChange={(v) => setFormData({ ...formData, assigned_to: v === '__none__' ? '' : v })}
              >
                <SelectTrigger data-testid="select-event-assignee">
                  <SelectValue placeholder="Select staff member…" />
                </SelectTrigger>
                <SelectContent>
                  {user?.email && (
                    <SelectItem value={user.email}>
                      {allStaffProfiles.find(s => s.user_email === user.email)?.full_name || user.email} (me)
                    </SelectItem>
                  )}
                  {allStaffProfiles
                    .filter(s => s.user_email && s.user_email !== user?.email && s.full_name)
                    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
                    .map(staff => (
                      <SelectItem key={staff.id} value={staff.user_email}>
                        {staff.full_name}
                      </SelectItem>
                    ))
                  }
                </SelectContent>
              </Select>
            </div>

            {/* ⚠️ Live conflict warning — shown when the chosen slot overlaps an existing event */}
            {conflictingEvent && (
              <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-300 rounded-lg" data-testid="conflict-warning">
                <AlertCircle className="w-4 h-4 text-yellow-700 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-yellow-800">
                    <strong>
                      {allStaffProfiles.find(s => s.user_email === (formData.assigned_to || user?.email))?.full_name
                        || formData.assigned_to || user?.email}
                    </strong>
                    {' '}already has <strong>"{conflictingEvent.title}"</strong> at{' '}
                    {parseCalendarInstant(conflictingEvent.start_time)
                      ? formatCompanyEventTime(conflictingEvent.start_time, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                      : 'this time'}.
                    {' '}You can still save — the server will validate the conflict.
                  </p>
                  {!conflictingEvent._isActionItem && !conflictingEvent.is_saas_event && (
                    <button
                      type="button"
                      className="mt-1 text-sm font-medium text-yellow-700 hover:text-yellow-900 underline underline-offset-2"
                      onClick={() => {
                        setShowEventDialog(false);
                        setSelectedEvent(conflictingEvent);
                      }}
                    >
                      View event →
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t.calendar.type}</Label>
                <Select 
                  value={formData.event_type} 
                  onValueChange={(v) => setFormData({
                    ...formData,
                    event_type: v,
                    color: getColorForEventType(v),
                    add_google_meet: googleCalendarConnected ? (v === 'meeting') : formData.add_google_meet,
                  })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t.calendar.type}/>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meeting">🟦 {t.calendar.meeting}</SelectItem>
                    <SelectItem value="inspection">🟢 {t.calendar.inspection}</SelectItem>
                    <SelectItem value="call">🟣 {t.calendar.call}</SelectItem>
                    <SelectItem value="appointment">🟠 {t.calendar.appointment}</SelectItem>
                    <SelectItem value="reminder">🟡 {t.calendar.reminder}</SelectItem>
                    <SelectItem value="estimate">🔵 {t.calendar.estimate}</SelectItem>
                    <SelectItem value="follow_up">🔴 {t.calendar.followUp}</SelectItem>
                    <SelectItem value="check_pickup">🟧 {t.calendar.other}</SelectItem>
                    {isPlatformOwner && (
                      <>
                        <SelectItem value="trial">⏳ {t.sidebar.saasAdmin}</SelectItem>
                        <SelectItem value="invoice">💰 {t.invoices.title}</SelectItem>
                      </>
                    )}
                    <SelectItem value="other">⚫ {t.calendar.other}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>{t.common.status}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={formData.color}
                    onChange={(e) => setFormData({...formData, color: e.target.value})}
                    className="w-20"
                  />
                  <span className="text-sm text-gray-500">{t.common.edit}</span>
                </div>
              </div>
            </div>

            <div>
              <Label>{t.calendar.location}</Label>
              <Input
                value={formData.location}
                onChange={(e) => setFormData({...formData, location: e.target.value})}
                placeholder="Address or meeting link"
                disabled={formData.add_google_meet}
              />
            </div>

            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <Checkbox
                id="add-google-meet"
                checked={formData.add_google_meet}
                onCheckedChange={(checked) => setFormData({...formData, add_google_meet: checked})}
              />
              <Label htmlFor="add-google-meet" className="cursor-pointer flex items-center gap-2 text-green-700 font-medium">
                <Video className="w-4 h-4" />
                {t.calendar.meeting}
                {googleCalendarConnected && formData.add_google_meet && (
                  <span className="text-xs font-normal text-green-600 ml-1">· auto-enabled</span>
                )}
              </Label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Link to Customer ({t.common.optional})</Label>
                <p className="text-xs text-gray-500 mb-1">Attaches this event to a customer's profile and auto-fills their address.</p>
                <Select 
                  value={formData.related_customer || '__none__'} 
                  onValueChange={(v) => {
                    const val = v === '__none__' ? null : v;
                    const c = rawCustomers.find(c => c.name === val);
                    const addr = c ? (c.address || [c.street, c.city, c.state, c.zip].filter(Boolean).join(', ') || '') : '';
                    setFormData({ ...formData, related_customer: val, location: formData.location || addr });
                  }}
                >
                  <SelectTrigger data-testid="select-event-customer">
                    <SelectValue placeholder={rawCustomers.length === 0 ? 'No customers yet' : 'Pick a customer…'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t.common.none}</SelectItem>
                    {[...rawCustomers].filter(c => c.name).sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(customer => (
                      <SelectItem key={customer.id} value={customer.name}>
                        {customer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Link to Lead ({t.common.optional})</Label>
                <p className="text-xs text-gray-500 mb-1">Attaches this event to a lead's profile and auto-fills their address.</p>
                <Select 
                  value={formData.related_lead || '__none__'} 
                  onValueChange={(v) => {
                    const val = v === '__none__' ? null : v;
                    const l = rawLeads.find(l => l.name === val);
                    const addr = l ? (l.address || l.property_address || [l.street, l.city, l.state, l.zip].filter(Boolean).join(', ') || '') : '';
                    setFormData({ ...formData, related_lead: val, location: formData.location || addr });
                  }}
                >
                  <SelectTrigger data-testid="select-event-lead">
                    <SelectValue placeholder={rawLeads.length === 0 ? 'No leads yet' : 'Pick a lead…'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t.common.none}</SelectItem>
                    {[...rawLeads].filter(l => l.name).sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(lead => (
                      <SelectItem key={lead.id} value={lead.name}>
                        {lead.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>{t.calendar.description}</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                rows={3}
                placeholder={`${t.calendar.description}...`}
              />
            </div>

            <div className="border-t pt-4">
              <Label className="text-base font-semibold mb-3 block flex items-center gap-2">
                <Bell className="w-5 h-5" />
                {t.sidebar.reminders}
              </Label>
              <div className="space-y-4 bg-gray-50 p-4 rounded-lg">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="new-event-email-reminder-checkbox" className="font-medium cursor-pointer">{t.common.email} {t.sidebar.reminders}</Label>
                    <Checkbox
                      id="new-event-email-reminder-checkbox"
                      checked={formData.send_email_notification}
                      onCheckedChange={(checked) => 
                        setFormData({...formData, send_email_notification: checked})
                      }
                    />
                  </div>
                  {formData.send_email_notification && (
                    <div className="space-y-2">
                      {formData.email_reminder_minutes.map((minutes, index) => (
                        <div key={`form-email-${index}`} className="flex items-center gap-2">
                          <Select
                            value={minutes.toString()}
                            onValueChange={(v) => updateFormReminderTime('email_reminder_minutes', index, v)}
                          >
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder={t.calendar.startTime} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">At time of event</SelectItem>
                              <SelectItem value="5">5 minutes before</SelectItem>
                              <SelectItem value="10">10 minutes before</SelectItem>
                              <SelectItem value="15">15 minutes before</SelectItem>
                              <SelectItem value="30">30 minutes before</SelectItem>
                              <SelectItem value="60">1 hour before</SelectItem>
                              <SelectItem value="120">2 hours before</SelectItem>
                              <SelectItem value="1440">1 day before</SelectItem>
                            </SelectContent>
                          </Select>
                          {formData.email_reminder_minutes.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeFormEmailReminder(index)}
                              className="text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addFormEmailReminder}
                        className="w-full"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        {t.common.add} {t.common.email}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="new-event-sms-reminder-checkbox" className="font-medium cursor-pointer">{t.common.phone} {t.sidebar.reminders}</Label>
                    <Checkbox
                      id="new-event-sms-reminder-checkbox"
                      checked={formData.send_sms_notification}
                      onCheckedChange={(checked) => 
                        setFormData({...formData, send_sms_notification: checked})
                      }
                    />
                  </div>
                  {formData.send_sms_notification && (
                    <div className="space-y-2">
                      {formData.sms_reminder_minutes.map((minutes, index) => (
                        <div key={`form-sms-${index}`} className="flex items-center gap-2">
                          <Select
                            value={minutes.toString()}
                            onValueChange={(v) => updateFormReminderTime('sms_reminder_minutes', index, v)}
                          >
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder={t.calendar.startTime} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">At time of event</SelectItem>
                              <SelectItem value="5">5 minutes before</SelectItem>
                              <SelectItem value="10">10 minutes before</SelectItem>
                              <SelectItem value="15">15 minutes before</SelectItem>
                              <SelectItem value="30">30 minutes before</SelectItem>
                              <SelectItem value="60">1 hour before</SelectItem>
                              <SelectItem value="120">2 hours before</SelectItem>
                              <SelectItem value="1440">1 day before</SelectItem>
                            </SelectContent>
                          </Select>
                          {formData.sms_reminder_minutes.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeFormSMSReminder(index)}
                              className="text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addFormSMSReminder}
                        className="w-full"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        {t.common.add} {t.common.phone}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="new-event-browser-reminder-checkbox" className="font-medium cursor-pointer">{t.common.web} {t.sidebar.notifications}</Label>
                    <Checkbox
                      id="new-event-browser-reminder-checkbox"
                      checked={formData.send_browser_notification}
                      onCheckedChange={(checked) => 
                        setFormData({...formData, send_browser_notification: checked})
                      }
                    />
                  </div>
                  {formData.send_browser_notification && (
                    <div className="space-y-2">
                      {formData.browser_reminder_minutes.map((minutes, index) => (
                        <div key={`form-browser-${index}`} className="flex items-center gap-2">
                          <Select
                            value={minutes.toString()}
                            onValueChange={(v) => updateFormReminderTime('browser_reminder_minutes', index, v)}
                          >
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder={t.calendar.startTime} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">At time of event</SelectItem>
                              <SelectItem value="5">5 minutes before</SelectItem>
                              <SelectItem value="10">10 minutes before</SelectItem>
                              <SelectItem value="15">15 minutes before</SelectItem>
                              <SelectItem value="30">30 minutes before</SelectItem>
                              <SelectItem value="60">1 hour before</SelectItem>
                              <SelectItem value="120">2 hours before</SelectItem>
                              <SelectItem value="1440">1 day before</SelectItem>
                            </SelectContent>
                          </Select>
                          {formData.browser_reminder_minutes.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeFormBrowserReminder(index)}
                              className="text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addFormBrowserReminder}
                        className="w-full"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        {t.common.add} {t.sidebar.notifications}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => {
                setShowEventDialog(false);
                setEditingEvent(null);
                resetEventForm();
              }}>
                {t.common.cancel}
              </Button>
              <Button data-testid="btn-save-event" type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={createEventMutation.isPending || updateEventFromFormMutation.isPending}>
                {editingEvent ? (updateEventFromFormMutation.isPending ? t.common.loading : t.common.update) : (createEventMutation.isPending ? t.common.loading : t.common.create)}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showFilterDialog} onOpenChange={setShowFilterDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.common.filters}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="font-semibold mb-3 block">{t.calendar.type}</Label>
              <div className="space-y-2">
                {eventTypes.map(type => (
                  <div key={type} className="flex items-center gap-2">
                    <Checkbox
                      id={`filter-event-type-${type}`}
                      checked={selectedFilters.eventTypes.includes(type)}
                      onCheckedChange={() => toggleFilter('eventTypes', type)}
                    />
                    <label htmlFor={`filter-event-type-${type}`} className="text-sm cursor-pointer flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: getColorForEventType(type) }}
                      ></div>
                      {type?.replace(/_/g, ' ')}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Label className="font-semibold mb-3 block">{t.tasks.assignedTo}</Label>
              <div className="space-y-2">
                {assignedUsers.map(user => (
                  <div key={user} className="flex items-center gap-2">
                    <Checkbox
                      id={`filter-assigned-to-${user}`}
                      checked={selectedFilters.assignedTo.includes(user)}
                      onCheckedChange={() => toggleFilter('assignedTo', user)}
                    />
                    <label htmlFor={`filter-assigned-to-${user}`} className="text-sm cursor-pointer">
                      {allStaffProfiles.find(s => s.user_email === user)?.full_name || user}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={() => setSelectedFilters({ eventTypes: [], assignedTo: [] })}
            >
              {t.common.clearFilters}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Reminder Settings Dialog ── */}
      <Dialog open={showReminderSettings} onOpenChange={setShowReminderSettings}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Reminder Settings
            </DialogTitle>
          </DialogHeader>
          <ReminderSettingsPanel user={user} />
        </DialogContent>
      </Dialog>
    </div>
  );
}