import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ReminderSettingsPanel from "@/components/ReminderSettingsPanel";
import { useToast } from "@/components/ui/use-toast";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Bell,
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  Trash2,
  RefreshCw,
  Settings,
  ChevronRight,
  Plus,
  CalendarPlus,
  ListTodo,
} from "lucide-react";
import { format, isToday, isTomorrow, addDays } from "date-fns";
import { fetchAssignmentRecords, dateUrgency, actionableTask, assignmentMatches, hasNoAssignment } from "@/utils/assignmentView";
import { parseDateOnly, localToday } from "@/utils/localDate";

const EVENT_TYPES = [
  { value: "meeting",     label: "Meeting" },
  { value: "inspection",  label: "Inspection" },
  { value: "call",        label: "Call" },
  { value: "appointment", label: "Appointment" },
  { value: "reminder",    label: "Reminder" },
  { value: "estimate",    label: "Estimate" },
  { value: "other",       label: "Other" },
];

const PRIORITY_OPTIONS = [
  { value: "high",   label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low",    label: "Low" },
];

// ── Today's date string for <input type="date"> default ──────────────────────
function todayStr() {
  return localToday();
}
function tomorrowStr() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const EMPTY_EVENT_FORM = {
  title: "",
  date: tomorrowStr(),
  time: "09:00",
  event_type: "appointment",
  task_id: "",
  location: "",
  description: "",
};

const EMPTY_TASK_FORM = {
  name: "",
  due_date: tomorrowStr(),
  priority: "medium",
  description: "",
};

export default function Reminders() {
  const { user, myCompany, myStaffProfile, staffProfiles = [] } = useRoleBasedData();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // ── "Add Reminder" dialog state ──────────────────────────────────────────
  const [addOpen, setAddOpen]     = useState(false);
  const [addMode, setAddMode]     = useState("event"); // "event" | "task"
  const [eventForm, setEventForm] = useState(EMPTY_EVENT_FORM);
  const [taskForm, setTaskForm]   = useState(EMPTY_TASK_FORM);
  const [employeeScope, setEmployeeScope] = useState("mine");
  useEffect(() => setEmployeeScope("mine"), [myCompany?.id]);
  const canManageTeam = !!myCompany && (myCompany.created_by === user?.email ||
    (myStaffProfile?.company_id === myCompany.id && myStaffProfile?.is_administrator === true));
  const activeProfiles = staffProfiles.filter(p => p.company_id === myCompany?.id && p.is_active !== false && p.user_email);
  const isAdmin = canManageTeam;

  const { data: tasks = [], isLoading: tasksLoading, isError: tasksError } = useQuery({
    queryKey: [canManageTeam ? "company-reminder-tasks" : "my-tasks", user?.email, myCompany?.id],
    queryFn: async () => {
      if (!user || !myCompany) return [];
      return fetchAssignmentRecords(myCompany.id, "Task");
    },
    enabled: !!user && !!myCompany,
  });

  const { data: calendarEvents = [], isLoading: eventsLoading, isError: eventsError } = useQuery({
    queryKey: ["my-upcoming-events", user?.email, myCompany?.id],
    queryFn: async () => {
      if (!user || !myCompany) return [];
      const today = new Date();
      const nextWeek = addDays(today, 7);
      const allEvents = await base44.entities.CalendarEvent.filter({ company_id: myCompany.id }, "start_time", 500);
      return allEvents.filter((e) => {
        const eventDate = new Date(e.start_time);
        return (
          eventDate >= today &&
          eventDate <= nextWeek &&
          e.status === "scheduled" &&
          (e.assigned_to === user.email || e.attendees?.includes(user.email))
        );
      });
    },
    enabled: !!user && !!myCompany,
  });

  const completeTaskMutation = useMutation({
    mutationFn: ({ taskId, completed }) =>
      base44.entities.Task.update(taskId, {
        status: completed ? "job_completed" : "in_progress",
        column: completed ? "job_completed" : "in_progress",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["company-reminder-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["my-assignments-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["company-assignments-tasks"] });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId) => base44.entities.Task.delete(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["company-reminder-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["my-assignments-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["company-assignments-tasks"] });
    },
  });

  // ── Create Event mutation (syncs to Calendar) ────────────────────────────
  const createEventMutation = useMutation({
    mutationFn: async (form) => {
      const startDt = new Date(`${form.date}T${form.time}`);
      const endDt   = new Date(startDt.getTime() + 60 * 60 * 1000); // +1 hour
      const linkedTask = form.task_id ? tasks.find(task => String(task.id) === String(form.task_id)) : null;
      const taskReminderId = linkedTask ? crypto.randomUUID() : undefined;
      if (linkedTask) {
        const reminderRecipient = [{
          email: linkedTask.assigned_to_email || linkedTask.assigned_to || user.email,
          name: linkedTask.assigned_to_name || myStaffProfile?.full_name || user.email,
        }];
        await base44.entities.Task.update(linkedTask.id, {
          reminders: [...(linkedTask.reminders || []), {
            id: taskReminderId,
            reminder_date: startDt.toISOString(),
            reminder_to: reminderRecipient,
            reminder_description: form.description.trim() || form.title.trim(),
            is_recurring: false,
            recurrence_frequency: null,
            next_reminder_date: null,
            is_sent: false,
          }],
        });
      }
      return base44.entities.CalendarEvent.create({
        company_id:               myCompany.id,
        title:                    form.title.trim(),
        event_type:               form.event_type,
        start_time:               startDt.toISOString(),
        end_time:                 endDt.toISOString(),
        location:                 form.location.trim() || undefined,
        description:              form.description.trim() || undefined,
        task_id:                  form.task_id || undefined,
        task_reminder_id:         taskReminderId,
        assigned_to:              linkedTask?.assigned_to_email || linkedTask?.assigned_to || user.email,
        status:                   "scheduled",
        send_email_notification:  !linkedTask,
        send_browser_notification: !linkedTask,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-upcoming-events"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["company-reminder-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["my-assignments-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["company-assignments-tasks"] });
      toast({ title: "Event created", description: "It's now on your Calendar and Reminders list." });
      setAddOpen(false);
      setEventForm(EMPTY_EVENT_FORM);
    },
    onError: () => {
      toast({ title: "Couldn't create event", variant: "destructive" });
    },
  });

  // ── Create Task mutation (syncs to Tasks board) ──────────────────────────
  const createTaskMutation = useMutation({
    mutationFn: async (form) => {
      const recipientEmail = canManageTeam ? (form.assigned_to || user.email) : user.email;
      const recipientProfile = activeProfiles.find(profile => profile.user_email === recipientEmail);
      const recipient = { email: recipientEmail, name: recipientProfile?.full_name || myStaffProfile?.full_name || recipientEmail };
      const reminderId = crypto.randomUUID();
      const reminderDate = new Date(`${form.due_date}T09:00:00`).toISOString();
      const reminder = {
        id: reminderId,
        reminder_date: reminderDate,
        reminder_to: [recipient],
        reminder_description: form.description.trim() || form.name.trim(),
        is_recurring: false,
        recurrence_frequency: null,
        next_reminder_date: null,
        is_sent: false,
      };
      const task = await base44.entities.Task.create({
        company_id:  myCompany.id,
        name:        form.name.trim(),
        due_date:    form.due_date,
        priority:    form.priority,
        description: form.description.trim() || undefined,
        assigned_to: canManageTeam ? (form.assigned_to || user.email) : user.email,
        assigned_to_email: canManageTeam ? (form.assigned_to || user.email) : user.email,
        assigned_to_name: recipient.name,
        assignees:   [recipient],
        status:      "todo",
        column:      "todo",
        reminders:   [reminder],
      });
      let calendarEventError = false;
      try {
        const start = new Date(reminderDate);
        await base44.entities.CalendarEvent.create({
          company_id: myCompany.id,
          title: `Reminder: ${form.name.trim()}`,
          description: form.description.trim() || `Task reminder for: ${form.name.trim()}`,
          start_time: reminderDate,
          end_time: new Date(start.getTime() + 30 * 60 * 1000).toISOString(),
          assigned_to: recipientEmail,
          event_type: "reminder",
          task_id: task.id,
          task_reminder_id: reminderId,
          status: "scheduled",
          send_email_notification: false,
          send_browser_notification: false,
        });
      } catch (error) {
        calendarEventError = true;
        console.warn("Task saved, but its display calendar event could not be created", error);
      }
      return { ...task, calendarEventError };
    },
    onSuccess: async (createdTask) => {
      queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["company-reminder-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["my-assignments-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["company-assignments-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      try {
        const response = await base44.functions.invoke("universalNotificationDispatcher", {
          action: "create",
          entityType: "Task",
          entityId: createdTask?.id,
          companyId: myCompany.id,
        });
        const result = response?.data;
        if (!result?.success || result.errorCount) toast({ title: "Task saved", description: "Some assignment notices could not be sent." });
      } catch (error) {
        console.warn("[universalNotificationDispatcher] task create notification failed:", error?.message);
        toast({ title: "Task saved", description: "Assignment notices could not be sent." });
      }
      if (createdTask?.calendarEventError) toast({ title: "Task saved", description: "Its calendar display entry could not be created." });
      else toast({ title: "Task created", description: "It's now in your Tasks board and Reminders list." });
      setAddOpen(false);
      setTaskForm(EMPTY_TASK_FORM);
    },
    onError: () => {
      toast({ title: "Couldn't create task", variant: "destructive" });
    },
  });

  const handleAddSubmit = (e) => {
    e.preventDefault();
    if (addMode === "event") {
      if (!eventForm.title.trim()) return;
      createEventMutation.mutate(eventForm);
    } else {
      if (!taskForm.name.trim()) return;
      createTaskMutation.mutate(taskForm);
    }
  };

  const isAddPending = createEventMutation.isPending || createTaskMutation.isPending;

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getTaskPriorityColor = (priority) => {
    switch (priority) {
      case "high": return "bg-red-100 text-red-700 border-red-300";
      case "medium": return "bg-yellow-100 text-yellow-700 border-yellow-300";
      case "low": return "bg-blue-100 text-blue-700 border-blue-300";
      default: return "bg-gray-100 text-gray-700 border-gray-300";
    }
  };

  const getTaskUrgency = dueDate => {
    const urgency = dateUrgency(dueDate);
    if (urgency === "upcoming" && dueDate && isTomorrow(parseDateOnly(dueDate))) return "tomorrow";
    return urgency;
  };

  const visibleTasks = canManageTeam ? tasks.filter(task =>
    employeeScope === "all" ||
    (employeeScope === "unassigned" && hasNoAssignment(task)) ||
    (employeeScope === "mine" && assignmentMatches(task, { email: user?.email, name: myStaffProfile?.full_name })) ||
    (employeeScope !== "mine" && employeeScope !== "all" && employeeScope !== "unassigned" && assignmentMatches(task, { email: employeeScope, name: activeProfiles.find(p => p.user_email === employeeScope)?.full_name }))
  ) : tasks;
  const groupedTasks = React.useMemo(() => {
    const overdue  = visibleTasks.filter((t) => t.due_date && getTaskUrgency(t.due_date) === "overdue");
    const today    = visibleTasks.filter((t) => t.due_date && getTaskUrgency(t.due_date) === "today");
    const tomorrow = visibleTasks.filter((t) => t.due_date && getTaskUrgency(t.due_date) === "tomorrow");
    const upcoming = visibleTasks.filter((t) => t.due_date && getTaskUrgency(t.due_date) === "upcoming");
    return { overdue, today, tomorrow, upcoming };
  }, [visibleTasks]);

  const getEventTypeColor = (type) => {
    const colors = {
      meeting:     "bg-blue-100 text-blue-700",
      inspection:  "bg-green-100 text-green-700",
      call:        "bg-purple-100 text-purple-700",
      appointment: "bg-orange-100 text-orange-700",
      reminder:    "bg-yellow-100 text-yellow-700",
      estimate:    "bg-pink-100 text-pink-700",
      other:       "bg-gray-100 text-gray-700",
    };
    return colors[type] || colors.other;
  };

  const groupedEvents = React.useMemo(() => {
    const today    = calendarEvents.filter((e) => isToday(new Date(e.start_time)));
    const tomorrow = calendarEvents.filter((e) => isTomorrow(new Date(e.start_time)));
    const upcoming = calendarEvents.filter((e) => {
      const date = new Date(e.start_time);
      return !isToday(date) && !isTomorrow(date);
    });
    return { today, tomorrow, upcoming };
  }, [calendarEvents]);

  const totalReminders = tasks.length + calendarEvents.length;
  const isLoading = tasksLoading || eventsLoading;

  // ── Sub-components ────────────────────────────────────────────────────────
  const TaskCard = ({ task }) => (
    <div
      className="bg-white p-4 rounded-lg border shadow-sm cursor-pointer hover:border-blue-400 hover:shadow-md transition-all group"
      onClick={() => navigate(createPageUrl('Tasks') + `?task_id=${encodeURIComponent(task.id)}`)}
      data-testid={`card-task-${task.id}`}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={false}
          onCheckedChange={(checked) => completeTaskMutation.mutate({ taskId: task.id, completed: checked })}
          onClick={(e) => e.stopPropagation()}
          className="mt-1"
          data-testid={`checkbox-task-${task.id}`}
        />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">{task.name}</h3>
          {task.description && <p className="text-sm text-gray-600 mt-1 line-clamp-2">{task.description}</p>}
          <div className="flex flex-wrap gap-2 mt-2">
            <Badge variant="outline">
              <Clock className="w-3 h-3 mr-1" />
              {task.due_date ? format(parseDateOnly(task.due_date), "MMM d, yyyy") : "No date"}
            </Badge>
            {task.priority && <Badge className={getTaskPriorityColor(task.priority)}>{task.priority}</Badge>}
            {canManageTeam && <Badge variant="outline" className="max-w-48 truncate">{task.assigned_to_name || task.assigned_to_email || task.assigned_to || "Unassigned"}</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("Delete this task?")) deleteTaskMutation.mutate(task.id);
            }}
            className="text-red-500 hover:text-red-700"
            data-testid={`btn-delete-task-${task.id}`}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors" />
        </div>
      </div>
    </div>
  );

  const EventCard = ({ event }) => (
    <div
      className="bg-white p-4 rounded-lg border shadow-sm cursor-pointer hover:border-blue-400 hover:shadow-md transition-all group"
      onClick={() => navigate(event.task_id
        ? createPageUrl("Tasks") + `?task_id=${encodeURIComponent(event.task_id)}`
        : createPageUrl("Calendar"))}
      data-testid={`card-event-${event.id}`}
    >
      <div className="flex items-start gap-3">
        <Calendar className="w-5 h-5 text-blue-600 mt-1 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">{event.title}</h3>
          {event.description && <p className="text-sm text-gray-600 mt-1 line-clamp-2">{event.description}</p>}
          <div className="flex flex-wrap gap-2 mt-2">
            <Badge variant="outline">
              <Clock className="w-3 h-3 mr-1" />
              {format(new Date(event.start_time), "MMM d, h:mm a")}
            </Badge>
            <Badge className={getEventTypeColor(event.event_type)}>
              {event.event_type?.replace("_", " ")}
            </Badge>
            {event.location && (
              <Badge variant="outline" className="text-xs">{event.location}</Badge>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors mt-1 shrink-0" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-4 md:p-6 pb-24">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* ── Header ── */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <Bell className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Reminders</h1>
                <p className="text-sm text-gray-600">
                  {isLoading ? "Loading…" : totalReminders === 0 ? "All caught up!" : `${totalReminders} upcoming reminder${totalReminders > 1 ? "s" : ""}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => navigate(createPageUrl('Calendar'))}
                data-testid="btn-view-calendar"
              >
                <Calendar className="w-4 h-4" />
                <span className="hidden sm:inline">View Calendar</span>
              </Button>
              <Button
                size="sm"
                className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => { setAddOpen(true); setAddMode("event"); setEventForm(EMPTY_EVENT_FORM); setTaskForm(EMPTY_TASK_FORM); }}
                data-testid="btn-add-reminder"
              >
                <Plus className="w-4 h-4" />
                Add Reminder
              </Button>
            </div>
          </div>
        </div>

        {/* ── Main tabs ── */}
        <Tabs defaultValue="upcoming">
          <TabsList className="w-full" data-testid="tabs-reminders">
            <TabsTrigger value="upcoming" className="flex-1" data-testid="tab-upcoming">
              <Bell className="w-4 h-4 mr-2" />
              Upcoming
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex-1" data-testid="tab-settings">
              <Settings className="w-4 h-4 mr-2" />
              Reminder Settings
            </TabsTrigger>
          </TabsList>

          {/* ── UPCOMING TAB ── */}
          <TabsContent value="upcoming" className="space-y-6 mt-4">
            {canManageTeam && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <label htmlFor="reminder-employee-scope" className="text-xs font-medium text-slate-600 dark:text-slate-300">Employee</label>
                <select id="reminder-employee-scope" value={employeeScope} onChange={e => setEmployeeScope(e.target.value)} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                  <option value="mine">Mine</option><option value="all">All team</option><option value="unassigned">Unassigned</option>
                  {activeProfiles.filter(p => p.user_email !== user?.email).map(p => <option key={p.id} value={p.user_email}>{p.full_name || p.user_email}</option>)}
                </select>
              </div>
            )}
            {canManageTeam && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                <span><strong>{tasks.filter(task => dateUrgency(task.due_date) === "overdue").length}</strong> overdue tasks team-wide</span>
                <span><strong>{tasks.filter(hasNoAssignment).length}</strong> unassigned tasks</span>
              </div>
            )}
            {(tasksError || eventsError) && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                Some reminders could not be loaded. Refresh the page to retry; successfully loaded items remain available.
              </div>
            )}
            {tasks.isTruncated && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                Showing the first 500 company tasks. Narrow the view in Tasks to review additional records.
              </div>
            )}
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
              </div>
            )}

            {!isLoading && groupedTasks.overdue.length > 0 && (
              <Card className="border-red-300 bg-red-50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-red-700">
                    <AlertCircle className="w-5 h-5" />
                    Overdue Tasks ({groupedTasks.overdue.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {groupedTasks.overdue.map((t) => <TaskCard key={t.id} task={t} />)}
                </CardContent>
              </Card>
            )}

            {!isLoading && groupedTasks.today.length > 0 && (
              <Card className="border-orange-300 bg-orange-50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-orange-700">
                    <AlertCircle className="w-5 h-5" />
                    Due Today ({groupedTasks.today.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {groupedTasks.today.map((t) => <TaskCard key={t.id} task={t} />)}
                </CardContent>
              </Card>
            )}

            {!isLoading && groupedTasks.tomorrow.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-blue-700">
                    <Clock className="w-5 h-5" />
                    Due Tomorrow ({groupedTasks.tomorrow.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {groupedTasks.tomorrow.map((t) => <TaskCard key={t.id} task={t} />)}
                </CardContent>
              </Card>
            )}

            {!isLoading && groupedTasks.upcoming.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="w-5 h-5" />
                    Upcoming Tasks ({groupedTasks.upcoming.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {groupedTasks.upcoming.map((t) => <TaskCard key={t.id} task={t} />)}
                </CardContent>
              </Card>
            )}

            {!isLoading && groupedEvents.today.length > 0 && (
              <Card className="border-green-300 bg-green-50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-green-700">
                    <Calendar className="w-5 h-5" />
                    Today's Events ({groupedEvents.today.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {groupedEvents.today.map((e) => <EventCard key={e.id} event={e} />)}
                </CardContent>
              </Card>
            )}

            {!isLoading && groupedEvents.tomorrow.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="w-5 h-5" />
                    Tomorrow's Events ({groupedEvents.tomorrow.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {groupedEvents.tomorrow.map((e) => <EventCard key={e.id} event={e} />)}
                </CardContent>
              </Card>
            )}

            {!isLoading && groupedEvents.upcoming.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="w-5 h-5" />
                    Upcoming Events ({groupedEvents.upcoming.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {groupedEvents.upcoming.map((e) => <EventCard key={e.id} event={e} />)}
                </CardContent>
              </Card>
            )}

            {!isLoading && totalReminders === 0 && (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-4">
                    <CheckCircle2 className="w-10 h-10 text-green-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">All Caught Up!</h3>
                  <p className="text-gray-600 text-center max-w-md mb-6">
                    You have no pending tasks or upcoming events. Great job staying on top of things!
                  </p>
                  <Button
                    className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={() => { setAddOpen(true); setAddMode("event"); }}
                    data-testid="btn-add-first-reminder"
                  >
                    <Plus className="w-4 h-4" />
                    Add Your First Reminder
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── SETTINGS TAB ── */}
          <TabsContent value="settings" className="mt-4">
            <ReminderSettingsPanel user={user} showCompanyDefaults={isAdmin} />
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Add Reminder Dialog ── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Add Reminder</DialogTitle>
          </DialogHeader>

          {/* Type selector */}
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={() => setAddMode("event")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border text-sm font-medium transition-all ${
                addMode === "event"
                  ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                  : "bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600"
              }`}
              data-testid="btn-mode-event"
            >
              <CalendarPlus className="w-4 h-4" />
              Calendar Event
            </button>
            <button
              type="button"
              onClick={() => setAddMode("task")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border text-sm font-medium transition-all ${
                addMode === "task"
                  ? "bg-purple-600 text-white border-purple-600 shadow-sm"
                  : "bg-white text-gray-600 border-gray-200 hover:border-purple-300 hover:text-purple-600"
              }`}
              data-testid="btn-mode-task"
            >
              <ListTodo className="w-4 h-4" />
              Task
            </button>
          </div>

          <form onSubmit={handleAddSubmit} className="space-y-4">
            {addMode === "event" ? (
              <>
                <p className="text-xs text-gray-500 -mt-1">Creates an event on your Calendar. Email &amp; SMS reminders will be sent automatically.</p>

                <div className="space-y-1.5">
                  <Label htmlFor="event-title">Title <span className="text-red-500">*</span></Label>
                  <Input
                    id="event-title"
                    placeholder="e.g. Roof inspection — Smith property"
                    value={eventForm.title}
                    onChange={(e) => setEventForm((f) => ({ ...f, title: e.target.value }))}
                    required
                    autoFocus
                    data-testid="input-event-title"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="event-date">Date <span className="text-red-500">*</span></Label>
                    <Input
                      id="event-date"
                      type="date"
                      value={eventForm.date}
                      onChange={(e) => setEventForm((f) => ({ ...f, date: e.target.value }))}
                      required
                      data-testid="input-event-date"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="event-time">Time <span className="text-red-500">*</span></Label>
                    <Input
                      id="event-time"
                      type="time"
                      value={eventForm.time}
                      onChange={(e) => setEventForm((f) => ({ ...f, time: e.target.value }))}
                      required
                      data-testid="input-event-time"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="event-type">Type</Label>
                  <Select
                    value={eventForm.event_type}
                    onValueChange={(v) => setEventForm((f) => ({ ...f, event_type: v }))}
                  >
                    <SelectTrigger id="event-type" data-testid="select-event-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EVENT_TYPES.map((et) => (
                        <SelectItem key={et.value} value={et.value}>{et.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {tasks.length > 0 && (
                  <div className="space-y-1.5">
                    <Label htmlFor="event-task-link">Related task <span className="font-normal text-gray-400">(optional)</span></Label>
                    <Select value={eventForm.task_id || "none"} onValueChange={value => setEventForm(f => ({ ...f, task_id: value === "none" ? "" : value }))}>
                      <SelectTrigger id="event-task-link"><SelectValue placeholder="No related task" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No related task</SelectItem>
                        {tasks.map(task => <SelectItem key={task.id} value={String(task.id)}>{task.name || task.title || "Untitled task"}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="event-location">Location <span className="text-gray-400 font-normal">(optional)</span></Label>
                  <Input
                    id="event-location"
                    placeholder="Address or meeting link"
                    value={eventForm.location}
                    onChange={(e) => setEventForm((f) => ({ ...f, location: e.target.value }))}
                    data-testid="input-event-location"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="event-notes">Notes <span className="text-gray-400 font-normal">(optional)</span></Label>
                  <Textarea
                    id="event-notes"
                    placeholder="Any details about this appointment…"
                    rows={2}
                    value={eventForm.description}
                    onChange={(e) => setEventForm((f) => ({ ...f, description: e.target.value }))}
                    data-testid="input-event-notes"
                  />
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-500 -mt-1">{canManageTeam ? "Creates a task for a teammate. It will appear on the Tasks board." : "Creates a task assigned to you. It will appear on your Tasks board."}</p>
                {canManageTeam && (
                  <div className="space-y-1.5">
                    <Label htmlFor="task-recipient">Assign to</Label>
                    <Select value={taskForm.assigned_to || user?.email || ""} onValueChange={value => setTaskForm(f => ({ ...f, assigned_to: value }))}>
                      <SelectTrigger id="task-recipient"><SelectValue placeholder="Choose a teammate" /></SelectTrigger>
                      <SelectContent>
                        {activeProfiles.map(profile => <SelectItem key={profile.id} value={profile.user_email}>{profile.full_name || profile.user_email}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="task-name">Task name <span className="text-red-500">*</span></Label>
                  <Input
                    id="task-name"
                    placeholder="e.g. Follow up with Johnson estimate"
                    value={taskForm.name}
                    onChange={(e) => setTaskForm((f) => ({ ...f, name: e.target.value }))}
                    required
                    autoFocus
                    data-testid="input-task-name"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="task-due">Due date <span className="text-red-500">*</span></Label>
                    <Input
                      id="task-due"
                      type="date"
                      value={taskForm.due_date}
                      onChange={(e) => setTaskForm((f) => ({ ...f, due_date: e.target.value }))}
                      required
                      data-testid="input-task-due"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="task-priority">Priority</Label>
                    <Select
                      value={taskForm.priority}
                      onValueChange={(v) => setTaskForm((f) => ({ ...f, priority: v }))}
                    >
                      <SelectTrigger id="task-priority" data-testid="select-task-priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITY_OPTIONS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="task-desc">Description <span className="text-gray-400 font-normal">(optional)</span></Label>
                  <Textarea
                    id="task-desc"
                    placeholder="Any additional details…"
                    rows={2}
                    value={taskForm.description}
                    onChange={(e) => setTaskForm((f) => ({ ...f, description: e.target.value }))}
                    data-testid="input-task-desc"
                  />
                </div>
              </>
            )}

            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={isAddPending} data-testid="btn-cancel-reminder">
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isAddPending}
                className={addMode === "event" ? "bg-blue-600 hover:bg-blue-700" : "bg-purple-600 hover:bg-purple-700"}
                data-testid="btn-save-reminder"
              >
                {isAddPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
                ) : (
                  <><Plus className="w-4 h-4 mr-2" /> {addMode === "event" ? "Add to Calendar" : "Create Task"}</>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
