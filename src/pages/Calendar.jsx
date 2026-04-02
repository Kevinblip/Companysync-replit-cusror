import React, { useState, useEffect } from "react";
import { isPlatformAdminCheck } from "@/hooks/usePlatformAdmin";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Zap
} from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  task: '#f97316',           // Orange-red (for Tasks)
};

const getColorForEventType = (eventType) => {
  return EVENT_TYPE_COLORS[eventType] || EVENT_TYPE_COLORS.other;
};

// 🛠️ Helper to check for valid dates
const isValidDate = (d) => d instanceof Date && !isNaN(d);

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
  const [checkingConnection, setCheckingConnection] = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [showMoveEventDialog, setShowMoveEventDialog] = useState(false);
  const [eventToMove, setEventToMove] = useState(null);
  const [moveToDate, setMoveToDate] = useState(null);
  const [draggedEvent, setDraggedEvent] = useState(null);
  const [calendarViewMode, setCalendarViewMode] = useState('mine');
  const [selectedPeople, setSelectedPeople] = useState([]);

  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const formatReminderTime = (minutes) => {
    if (minutes === null || minutes === undefined) return t.common.unknown;
    if (minutes === 0) return t.calendar.today;
    if (minutes === 5) return `5 ${t.common.minutesAgo(5)}`;
    if (minutes === 10) return `10 ${t.common.minutesAgo(10)}`;
    if (minutes === 15) return `15 ${t.common.minutesAgo(15)}`;
    if (minutes === 30) return `30 ${t.common.minutesAgo(30)}`;
    if (minutes === 60) return `1 ${t.common.hoursAgo(1)}`;
    if (minutes === 120) return `2 ${t.common.hoursAgo(2)}`;
    if (minutes === 1440) return `1 ${t.common.daysAgo(1)}`;
    return `${minutes} ${t.common.minutesAgo(minutes)}`;
  };

  useEffect(() => {
    base44.auth.me().then(async (u) => {
      setUser(u);
      try {
        const result = await base44.functions.checkUserGoogleCalendarConnection();
        const isConnected = !!result?.connected;
        setGoogleCalendarConnected(isConnected);
        setLastSync(result?.last_sync || u?.last_google_sync);
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

  const { filterCalendarEvents, filterCustomers, filterLeads, myCompany, isAdmin, effectiveUserEmail } = useRoleBasedData();

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles-calendar', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
    initialData: [],
  });

  const allCompanyStaff = staffProfiles;

  // Main Calendar: Secured with Company ID Scoping
  const { data: calendarEvents = [] } = useQuery({
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
      
      return await base44.entities.CalendarEvent.filter(query, "-start_time", 1000);
    },
    enabled: !!user && !!myCompany?.id,
    initialData: [],
  });

  const { data: allStaffProfiles = [] } = useQuery({
    queryKey: ['all-staff-profiles'],
    queryFn: () => base44.entities.StaffProfile.list(),
    initialData: [],
  });

  const { data: rawCustomers = [] } = useQuery({
    queryKey: ['customers-for-calendar', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, '-created_date', 500) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  // 🔐 Filter customers by role — used in event creation dropdowns
  const allCustomers = React.useMemo(() => filterCustomers(rawCustomers), [rawCustomers, filterCustomers]);

  const { data: rawLeads = [] } = useQuery({
    queryKey: ['leads-for-calendar', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }, '-created_date', 500) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  // 🔐 Filter leads by role — used in event creation dropdowns
  const allLeads = React.useMemo(() => filterLeads(rawLeads), [rawLeads, filterLeads]);

  // 🔐 SaaS Admin Data (Only fetched if platform owner)
  const isPlatformOwner = React.useMemo(() => {
    if (!user) return false;
    return isPlatformAdminCheck(user, myCompany, null);
  }, [user, myCompany]);

  const { data: companies = [] } = useQuery({
    queryKey: ['all-companies-calendar'],
    queryFn: () => base44.entities.Company.filter({ is_deleted: { $ne: true } }, "-created_date", 500),
    enabled: !!isPlatformOwner,
    initialData: [],
  });

  // Fetch all invoices for Platform Owner
  const { data: adminAllInvoices = [] } = useQuery({
    queryKey: ['admin-all-invoices', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Invoice.filter({ company_id: myCompany.id }, '-created_date', 10000) : [],
    enabled: !!isPlatformOwner && !!myCompany,
    initialData: [],
  });

  // Fetch tasks with due dates to show on calendar
  const { data: companyTasks = [] } = useQuery({
    queryKey: ['tasks-for-calendar', myCompany?.id, user?.email],
    queryFn: async () => {
      if (!user || !myCompany?.id) return [];
      const allTasks = await base44.entities.Task.filter({ company_id: myCompany.id }, '-due_date', 1000);
      return allTasks.filter(t => t.due_date && !t.is_archived && t.status !== 'job_completed');
    },
    enabled: !!user && !!myCompany?.id,
    initialData: [],
  });

  // 🚀 Merge Standard Events with SaaS Admin Events
  const mergedCalendarEvents = React.useMemo(() => {
    let events = [...filterCalendarEvents(calendarEvents)];

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

    // Add Tasks with due dates
    companyTasks.forEach(task => {
      const date = new Date(task.due_date);
      if (isValidDate(date)) {
        date.setHours(8, 0, 0, 0); // Show at 8 AM on due date
        const priorityColor = task.priority === 'high' || task.priority === 'urgent'
          ? '#ef4444'  // Red
          : task.priority === 'low'
          ? '#6b7280'  // Gray
          : '#f97316'; // Orange (medium / default)
        events.push({
          id: `task-${task.id}`,
          title: `📋 ${task.name}`,
          start_time: date.toISOString(),
          end_time: new Date(date.getTime() + 30 * 60 * 1000).toISOString(),
          event_type: 'task',
          color: priorityColor,
          description: task.description || '',
          is_task: true,
        });
      }
    });

    return events;
  }, [calendarEvents, filterCalendarEvents, isPlatformOwner, companies, adminAllInvoices, companyTasks]);

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
        assigned_to: user?.email
      };
      
      const event = await base44.entities.CalendarEvent.create(eventData);
      
      // 🔔 Create bell notification
      try {
        await base44.entities.Notification.create({
          user_email: user.email,
          type: 'event_created',
          title: `📅 ${t.calendar.addEvent}`,
          message: `"${event.title}" ${t.calendar.appointment} ${format(new Date(event.start_time), 'MMM d, h:mm a')}`,
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
          newTime: format(new Date(event.start_time), 'MMM d, h:mm a')
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
          const oldTime = format(new Date(originalEvent.start_time), 'MMM d, h:mm a');
          const newTime = format(new Date(data.start_time), 'MMM d, h:mm a');
          
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
          const oldTime = format(new Date(originalStartTime), 'MMM d, h:mm a');
          const newTime = format(new Date(data.start_time), 'MMM d, h:mm a');
          
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
      // ✅ Removed blocking sync - it will happen in background via auto-sync
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
            message: `"${event.title}" scheduled for ${format(new Date(event.start_time), 'MMM d, h:mm a')} was deleted`,
            link_url: createPageUrl('Calendar'),
            is_read: false
          });
          playNotificationSound(); // 🔔 Play ding sound

          // 📧📱 Send immediate email/SMS notification
          await base44.functions.invoke('sendEventChangeNotification', {
            eventId: event.id,
            changeType: 'deleted',
            oldTime: format(new Date(event.start_time), 'MMM d, h:mm a')
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
      alert('Failed to connect to Google Calendar: ' + error.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleGoogleSync = async () => {
    setIsConnecting(true);
    try {
      const result = await base44.functions.invoke('syncUserGoogleCalendar', {});
      
      if (result.data.needsReconnect) {
        alert('⚠️ ' + result.data.error + '\n\nPlease disconnect and reconnect your Google Calendar.');
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
        alert('❌ 403 Permission Error\n\nYour Google Calendar is not properly configured.\n\nClick the "🔧 Setup Help" button for detailed instructions.');
        setGoogleCalendarConnected(false);
      } else {
        alert('Failed to sync calendar: ' + error.message);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleGoogleDisconnect = async () => {
    if (!confirm('Disconnect your Google Calendar? Your CRM events will remain, but auto-sync will stop.')) {
      return;
    }

    setIsConnecting(true);
    try {
      await base44.functions.invoke('disconnectUserGoogleCalendar', {});
      setGoogleCalendarConnected(false);
      setLastSync(null);
      setSyncRetries(0);
      setLastSyncError(null); // Clear any error on disconnect
      alert('✅ Google Calendar disconnected');
    } catch (error) {
      console.error('Error disconnecting:', error);
      alert('Failed to disconnect: ' + error.message);
    } finally {
      setIsConnecting(false);
    }
  };

  // 🎯 Drag and Drop Handlers
  const handleDragStart = (e, event) => {
    if (event.is_saas_event || event.is_task) return; // Disable dragging for system events and tasks
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

    // Calculate new start and end times
    const oldStartTime = new Date(draggedEvent.start_time);
    const newStartTime = new Date(targetDate);
    newStartTime.setHours(oldStartTime.getHours());
    newStartTime.setMinutes(oldStartTime.getMinutes());
    
    let newEndTime;
    if (draggedEvent.end_time) {
      const oldEndTime = new Date(draggedEvent.end_time);
      const duration = oldEndTime.getTime() - oldStartTime.getTime();
      newEndTime = new Date(newStartTime.getTime() + duration);
    } else {
      newEndTime = new Date(newStartTime.getTime() + (60 * 60 * 1000));
    }

    updateEventMutation.mutate({
      id: draggedEvent.id,
      originalEvent: draggedEvent,
      data: {
        start_time: newStartTime.toISOString(),
        end_time: newEndTime.toISOString(),
      }
    });

    setDraggedEvent(null);
  };

  const handleEditEvent = (event) => {
    // Prevent editing SaaS auto-generated events or tasks
    if (event.is_saas_event) {
      alert("This is an auto-generated system event and cannot be edited here.");
      return;
    }
    if (event.is_task) {
      alert("This is a task. Edit it from the Tasks or Reminders page.");
      return;
    }

    setEditingEvent(event);
    const safeStart = event.start_time && isValidDate(new Date(event.start_time)) 
      ? new Date(event.start_time).toISOString().slice(0, 16) 
      : "";
    const safeEnd = event.end_time && isValidDate(new Date(event.end_time))
      ? new Date(event.end_time).toISOString().slice(0, 16)
      : "";

    setFormData({
      title: event.title,
      description: event.description || "",
      start_time: safeStart,
      end_time: safeEnd,
      event_type: event.event_type || "meeting",
      color: event.color || getColorForEventType(event.event_type || "meeting"),
      location: event.location || "",
      attendees: event.attendees || [],
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

  const handleDeleteEvent = (eventId) => {
    // Check if it's a SaaS event or task
    const event = mergedCalendarEvents.find(e => e.id === eventId);
    if (event?.is_saas_event) {
      alert("This is an auto-generated system event and cannot be deleted here.");
      return;
    }
    if (event?.is_task) {
      alert("This is a task. Delete it from the Tasks or Reminders page.");
      return;
    }

    if (window.confirm(t.calendar.deleteConfirm)) {
      deleteEventMutation.mutate(eventId);
    }
  };

  const handleMoveEvent = (event) => {
    if (event.is_saas_event || event.is_task) {
      alert("This item cannot be moved here.");
      return;
    }
    setEventToMove(event);
    setMoveToDate(new Date(event.start_time));
    setShowMoveEventDialog(true);
  };

  const handleConfirmMove = () => {
    if (!eventToMove || !moveToDate) return;

    const oldStartTime = new Date(eventToMove.start_time);
    const newStartTime = new Date(moveToDate);
    newStartTime.setHours(oldStartTime.getHours());
    newStartTime.setMinutes(oldStartTime.getMinutes());
    
    let newEndTime;
    if (eventToMove.end_time) {
      const oldEndTime = new Date(eventToMove.end_time);
      const duration = oldEndTime.getTime() - oldStartTime.getTime();
      newEndTime = new Date(newStartTime.getTime() + duration);
    } else {
      newEndTime = new Date(newStartTime.getTime() + (60 * 60 * 1000));
    }

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
    // Set start time to selected day at 9 AM
    const startTime = new Date(day);
    startTime.setHours(9, 0, 0, 0);
    
    // Set end time to 1 hour later
    const endTime = new Date(startTime);
    endTime.setHours(10, 0, 0, 0);
    
    setFormData({
      ...formData,
      start_time: startTime.toISOString().slice(0, 16),
      end_time: endTime.toISOString().slice(0, 16),
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

    // View mode filter: "mine" shows only current user's events
    if (calendarViewMode === 'mine' && user?.email) {
      filteredEvents = filteredEvents.filter(e => e.assigned_to === user.email);
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
      if (!event.start_time) return;
      const dateKey = format(new Date(event.start_time), 'yyyy-MM-dd');
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(event);
    });

    return map;
  }, [mergedCalendarEvents, selectedFilters, calendarViewMode, selectedPeople, user?.email]);

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
              <h1 className="text-3xl font-bold">{format(currentMonth, 'MMMM yyyy')}</h1>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentMonth(new Date())}
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
                    className="bg-white/20 border-white/30 text-white hover:bg-white/30"
                  >
                    {(isConnecting || autoSyncing) ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    Sync Google
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

              <Button
                onClick={() => {
                  setShowEventDialog(true);
                  setEditingEvent(null);
                  const now = new Date();
                  const defaultStart = new Date(now.getTime() + 5 * 60 * 1000);
                  const defaultEnd = new Date(defaultStart.getTime() + 60 * 60 * 1000);
                  setFormData({
                    title: "",
                    description: "",
                    start_time: defaultStart.toISOString().slice(0, 16),
                    end_time: defaultEnd.toISOString().slice(0, 16),
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
                    add_google_meet: false,
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

            {/* My Calendar note */}
            {calendarViewMode === 'mine' && (
              <span className="text-white/50 text-xs">Your events also appear on the Team Calendar</span>
            )}
          </div>
        </div>
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
                  {lastSync && ` ${t.common.status}: ${format(new Date(lastSync), 'MMM d, h:mm a')}`}
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
                  const isToday = isSameDay(day, new Date());
                  const isCurrentMonth = day.getMonth() === currentMonth.getMonth();

                  return (
                    <div
                      key={i}
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
                            className="text-xs px-2 py-1.5 rounded cursor-move hover:opacity-80 transition-opacity active:cursor-grabbing"
                            style={{ 
                              backgroundColor: event.color || getColorForEventType(event.event_type),
                              color: 'white',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEvent(event);
                            }}
                          >
                            <div className="font-medium truncate">{event.title}</div>
                            <div className="text-[10px] opacity-90">
                              {isValidDate(new Date(event.start_time)) ? format(new Date(event.start_time), 'h:mm a') : t.common.invalid}
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
                      {isValidDate(new Date(event.start_time)) ? format(new Date(event.start_time), 'h:mm a') : t.common.invalid}
                      {event.end_time && isValidDate(new Date(event.end_time)) && ` - ${format(new Date(event.end_time), 'h:mm a')}`}
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
          {selectedEvent && selectedEvent.is_task ? (
            <div className="space-y-4 pb-4">
              <div className="flex items-center gap-3 p-3 rounded-lg" style={{ backgroundColor: (selectedEvent.color || '#f97316') + '15', borderLeft: `4px solid ${selectedEvent.color || '#f97316'}` }}>
                <span className="text-2xl">📋</span>
                <div>
                  <p className="font-semibold text-gray-900">{selectedEvent.title?.replace('📋 ', '')}</p>
                  <p className="text-sm text-gray-500">Due: {isValidDate(new Date(selectedEvent.start_time)) ? format(new Date(selectedEvent.start_time), 'MMMM d, yyyy') : 'Unknown date'}</p>
                </div>
              </div>
              {selectedEvent.description && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">Description</p>
                  <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded">{selectedEvent.description}</p>
                </div>
              )}
              <p className="text-xs text-gray-400 text-center">To edit or complete this task, go to the Tasks or Reminders page.</p>
            </div>
          ) : selectedEvent && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-gray-600">
                <CalendarIcon className="w-5 h-5" />
                <div>
                  {selectedDayEvents.date && (
                    <div className="font-medium">
                      {isValidDate(new Date(selectedDayEvents.date)) ? format(new Date(selectedDayEvents.date), 'EEEE, MMMM d, yyyy') : t.common.date}
                    </div>
                  )}
                  <div className="text-sm">
                    {isValidDate(new Date(selectedEvent.start_time)) ? format(new Date(selectedEvent.start_time), 'h:mm a') : ''} - 
                    {selectedEvent.end_time && isValidDate(new Date(selectedEvent.end_time)) && ` ${format(new Date(selectedEvent.end_time), 'h:mm a')}`}
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

              {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
                <div>
                  <span className="font-semibold">{t.calendar.attendees}:</span>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {selectedEvent.attendees.map((attendee, i) => (
                      <Badge key={i} variant="outline">{attendee}</Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t pt-4">
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
                                  <SelectItem value="0">{t.calendar.today}</SelectItem>
                                  <SelectItem value="5">5 {t.common.minutesAgo(5)}</SelectItem>
                                  <SelectItem value="10">10 {t.common.minutesAgo(10)}</SelectItem>
                                  <SelectItem value="15">15 {t.common.minutesAgo(15)}</SelectItem>
                                  <SelectItem value="30">30 {t.common.minutesAgo(30)}</SelectItem>
                                  <SelectItem value="60">1 {t.common.hoursAgo(1)}</SelectItem>
                                  <SelectItem value="120">2 {t.common.hoursAgo(2)}</SelectItem>
                                  <SelectItem value="1440">1 {t.common.daysAgo(1)}</SelectItem>
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
                                  <SelectItem value="0">{t.calendar.today}</SelectItem>
                                  <SelectItem value="5">5 {t.common.minutesAgo(5)}</SelectItem>
                                  <SelectItem value="10">10 {t.common.minutesAgo(10)}</SelectItem>
                                  <SelectItem value="15">15 {t.common.minutesAgo(15)}</SelectItem>
                                  <SelectItem value="30">30 {t.common.minutesAgo(30)}</SelectItem>
                                  <SelectItem value="60">1 {t.common.hoursAgo(1)}</SelectItem>
                                  <SelectItem value="120">2 {t.common.hoursAgo(2)}</SelectItem>
                                  <SelectItem value="1440">1 {t.common.daysAgo(1)}</SelectItem>
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
                                  <SelectItem value="0">{t.calendar.today}</SelectItem>
                                  <SelectItem value="5">5 {t.common.minutesAgo(5)}</SelectItem>
                                  <SelectItem value="10">10 {t.common.minutesAgo(10)}</SelectItem>
                                  <SelectItem value="15">15 {t.common.minutesAgo(15)}</SelectItem>
                                  <SelectItem value="30">30 {t.common.minutesAgo(30)}</SelectItem>
                                  <SelectItem value="60">1 {t.common.hoursAgo(1)}</SelectItem>
                                  <SelectItem value="120">2 {t.common.hoursAgo(2)}</SelectItem>
                                  <SelectItem value="1440">1 {t.common.daysAgo(1)}</SelectItem>
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
              </div>

              <div className="flex flex-wrap gap-2 pt-4 border-t">
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
                <Button 
                  variant="outline" 
                  onClick={() => handleDeleteEvent(selectedEvent.id)}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 min-h-[48px]"
                  disabled={deleteEventMutation.isPending}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {deleteEventMutation.isPending ? t.common.loading : t.common.delete}
                </Button>
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
                  {t.common.status}: {format(new Date(eventToMove.start_time), 'EEEE, MMM d, yyyy \'at\' h:mm a')}
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
                  {t.calendar.startTime}: {isValidDate(new Date(eventToMove.start_time)) ? format(new Date(eventToMove.start_time), 'h:mm a') : t.common.invalid}
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
                value={formData.title}
                onChange={(e) => setFormData({...formData, title: e.target.value})}
                required
                placeholder={`${t.calendar.meeting}, ${t.calendar.inspection}, ${t.calendar.call}, etc.`}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t.calendar.startTime} *</Label>
                <Input
                  type="datetime-local"
                  value={formData.start_time}
                  onChange={(e) => setFormData({...formData, start_time: e.target.value})}
                  required
                />
              </div>
              <div>
                <Label>{t.calendar.endTime} *</Label>
                <Input
                  type="datetime-local"
                  value={formData.end_time}
                  onChange={(e) => setFormData({...formData, end_time: e.target.value})}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t.calendar.type}</Label>
                <Select 
                  value={formData.event_type} 
                  onValueChange={(v) => setFormData({
                    ...formData, 
                    event_type: v,
                    color: getColorForEventType(v)
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
              </Label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t.estimates.customer} ({t.common.optional})</Label>
                <Select 
                  value={formData.related_customer} 
                  onValueChange={(v) => setFormData({...formData, related_customer: v})}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t.estimates.customer} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>{t.common.none}</SelectItem>
                    {allCustomers.map(customer => (
                      <SelectItem key={customer.id} value={customer.name}>
                        {customer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>{t.sidebar.allLeads} ({t.common.optional})</Label>
                <Select 
                  value={formData.related_lead} 
                  onValueChange={(v) => setFormData({...formData, related_lead: v})}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t.sidebar.allLeads} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>{t.common.none}</SelectItem>
                    {allLeads.map(lead => (
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
                              <SelectItem value="0">{t.calendar.today}</SelectItem>
                              <SelectItem value="5">5 {t.common.minutesAgo(5)}</SelectItem>
                              <SelectItem value="10">10 {t.common.minutesAgo(10)}</SelectItem>
                              <SelectItem value="15">15 {t.common.minutesAgo(15)}</SelectItem>
                              <SelectItem value="30">30 {t.common.minutesAgo(30)}</SelectItem>
                              <SelectItem value="60">1 {t.common.hoursAgo(1)}</SelectItem>
                              <SelectItem value="120">2 {t.common.hoursAgo(2)}</SelectItem>
                              <SelectItem value="1440">1 {t.common.daysAgo(1)}</SelectItem>
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
                              <SelectItem value="0">{t.calendar.today}</SelectItem>
                              <SelectItem value="5">5 {t.common.minutesAgo(5)}</SelectItem>
                              <SelectItem value="10">10 {t.common.minutesAgo(10)}</SelectItem>
                              <SelectItem value="15">15 {t.common.minutesAgo(15)}</SelectItem>
                              <SelectItem value="30">30 {t.common.minutesAgo(30)}</SelectItem>
                              <SelectItem value="60">1 {t.common.hoursAgo(1)}</SelectItem>
                              <SelectItem value="120">2 {t.common.hoursAgo(2)}</SelectItem>
                              <SelectItem value="1440">1 {t.common.daysAgo(1)}</SelectItem>
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
                              <SelectItem value="0">{t.calendar.today}</SelectItem>
                              <SelectItem value="5">5 {t.common.minutesAgo(5)}</SelectItem>
                              <SelectItem value="10">10 {t.common.minutesAgo(10)}</SelectItem>
                              <SelectItem value="15">15 {t.common.minutesAgo(15)}</SelectItem>
                              <SelectItem value="30">30 {t.common.minutesAgo(30)}</SelectItem>
                              <SelectItem value="60">1 {t.common.hoursAgo(1)}</SelectItem>
                              <SelectItem value="120">2 {t.common.hoursAgo(2)}</SelectItem>
                              <SelectItem value="1440">1 {t.common.daysAgo(1)}</SelectItem>
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
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={createEventMutation.isPending || updateEventFromFormMutation.isPending}>
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
    </div>
  );
}