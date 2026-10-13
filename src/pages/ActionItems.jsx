import React, { useState, useEffect, useMemo, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePageVisibility } from "@/hooks/usePageVisibility";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertCircle,
  Bell,
  Check,
  CheckCircle2,
  CheckSquare,
  Clock,
  Filter,
  ListChecks,
  MoreVertical,
  Pause,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  User,
  Loader2,
  FileText,
  UserPlus,
  ArrowRight,
  XCircle,
  CalendarCheck,
  MapPin,
  Phone,
  Send,
  Hammer,
} from "lucide-react";
import { format, formatDistanceToNow, isPast, isToday, addHours, addDays } from "date-fns";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createPageUrl } from "@/utils";

// Convert an ISO timestamp to the value format expected by <input type="datetime-local">
// Returns "" for missing, invalid, or un-parseable input (e.g. AI-captured "sometime Tuesday").
function toDatetimeLocalStr(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

// Safely convert a datetime-local input value to an ISO string.
// Returns undefined if the value is empty or not a valid date.
function datetimeLocalToIso(val) {
  if (!val) return undefined;
  try {
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
  } catch {
    return undefined;
  }
}

const PRIORITY_CONFIG = {
  urgent: { label: "Urgent", color: "bg-red-100 text-red-800 border-red-300", dot: "bg-red-500" },
  high: { label: "High", color: "bg-orange-100 text-orange-800 border-orange-300", dot: "bg-orange-500" },
  medium: { label: "Medium", color: "bg-yellow-100 text-yellow-800 border-yellow-300", dot: "bg-yellow-500" },
  low: { label: "Low", color: "bg-blue-100 text-blue-800 border-blue-300", dot: "bg-blue-500" },
};

const TYPE_CONFIG = {
  follow_up_estimate: { label: "Follow Up: Estimate", icon: FileText },
  follow_up_lead: { label: "Follow Up: New Lead", icon: UserPlus },
  stale_lead: { label: "Stale Lead", icon: AlertCircle },
  pending_appointment_approval: { label: "Appointment Request", icon: CalendarCheck },
  pending_build_reminder: { label: "Build Reminder", icon: Hammer },
  stuck_job: { label: "Stuck Job", icon: Clock },
  open_punch_list: { label: "Open Punch List", icon: ListChecks },
  custom: { label: "Custom", icon: ListChecks },
};

const STATUS_TABS = [
  { value: "active", label: "Active" },
  { value: "snoozed", label: "Snoozed" },
  { value: "completed", label: "Completed" },
  { value: "dismissed", label: "Dismissed" },
];

export default function ActionItems() {
  const isPageVisible = usePageVisibility();
  const [user, setUser] = useState(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightedItemId = searchParams.get("itemId");
  const [activeTab, setActiveTab] = useState("active");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterAssignee, setFilterAssignee] = useState("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showSnoozeDialog, setShowSnoozeDialog] = useState(false);
  const [showReassignDialog, setShowReassignDialog] = useState(false);
  const [reassignTarget, setReassignTarget] = useState(null);
  const [reassignTo, setReassignTo] = useState("");
  const [snoozeTarget, setSnoozeTarget] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isBulkMode, setIsBulkMode] = useState(false);
  // Per-item edited build-reminder message text (keyed by action-item id).
  const [buildMsgDrafts, setBuildMsgDrafts] = useState({});
  // Per-item appointment approval options (keyed by action-item id):
  // { inspector: staff email, channel: 'text' | 'call' | 'none' }
  const [apptOptions, setApptOptions] = useState({});
  // Edit dialog for appointment approval: lets staff adjust time/address/title before confirming.
  const [apptEditDialog, setApptEditDialog] = useState({ open: false, item: null, form: {} });
  const [createForm, setCreateForm] = useState({
    title: "",
    description: "",
    priority: "medium",
    type: "custom",
    due_at: "",
    assigned_to: "",
  });

  const highlightRef = useRef(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);
  const { isAdmin, isDataLoading: isRoleLoading } = useRoleBasedData();

  // Non-admins fetch only their own assigned action items at the query level.
  // Wait for user.email + role to resolve before firing (fail-closed).
  const { data: actionItems = [], isLoading } = useQuery({
    queryKey: ["action-items", myCompany?.id, isAdmin ? "admin" : user?.email],
    queryFn: () => {
      if (!myCompany?.id || !user?.email) return [];
      const filter = isAdmin
        ? { company_id: myCompany.id }
        : { company_id: myCompany.id, assigned_to: user.email };
      return base44.entities.ActionItem.filter(filter, "-created_date", 5000);
    },
    enabled: !!myCompany?.id && isPageVisible && !isRoleLoading && !!user?.email,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (highlightedItemId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedItemId, actionItems]);

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ["staff-profiles", myCompany?.id],
    queryFn: () =>
      myCompany?.id
        ? base44.entities.StaffProfile.filter({ company_id: myCompany.id })
        : [],
    enabled: !!myCompany?.id,
  });

  // Company AssistantSettings — used for the Default Inspector on appointment
  // approvals (configured on the AI Assistant settings page).
  const { data: assistantSettingsList = [] } = useQuery({
    queryKey: ["assistant-settings-action-items", myCompany?.id],
    queryFn: () =>
      myCompany?.id
        ? base44.entities.AssistantSettings.filter({ company_id: myCompany.id })
        : [],
    enabled: !!myCompany?.id,
  });
  const defaultInspectorEmail = assistantSettingsList?.[0]?.default_inspector_email || "";

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ActionItem.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["action-items"] });
      setShowCreateDialog(false);
      setCreateForm({
        title: "",
        description: "",
        priority: "medium",
        type: "custom",
        due_at: "",
        assigned_to: "",
      });
      toast.success("Action item created");
    },
    onError: (err) => toast.error("Failed to create: " + err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => {
      if (!isAdmin && user?.email) {
        const item = actionItems.find((i) => i.id === id);
        // Fail closed: deny if item not in cache (unknown ID) or not owned
        if (!item || (item.assigned_to !== user.email && item.created_by !== user.email)) {
          throw new Error("Not authorized to update this item");
        }
      }
      return base44.entities.ActionItem.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["action-items"] });
    },
    onError: (err) => toast.error("Update failed: " + err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => {
      if (!isAdmin && user?.email) {
        const item = actionItems.find((i) => i.id === id);
        // Fail closed: deny if item not in cache (unknown ID) or not owned
        if (!item || (item.assigned_to !== user.email && item.created_by !== user.email)) {
          throw new Error("Not authorized to delete this item");
        }
      }
      return base44.entities.ActionItem.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["action-items"] });
      toast.success("Action item deleted");
    },
    onError: (err) => toast.error("Delete failed: " + err.message),
  });

  // Approve an AI-booked appointment: create the real CalendarEvent (status
  // "scheduled" so existing reminders fire) from the proposed details, then
  // complete the action item. No calendar event existed until this point.
  const approveAppointmentMutation = useMutation({
    mutationFn: async ({ item, overrides = {} }) => {
      // Idempotency: re-check the item is still pending before creating an
      // event, so two tabs/users can't double-book the same appointment.
      try {
        const fresh = await base44.entities.ActionItem.filter({ id: item.id });
        const current = fresh?.[0];
        if (current && (current.status === "completed" || current.status === "dismissed")) {
          throw new Error("already_handled");
        }
      } catch (e) {
        if (e?.message === "already_handled") throw e;
        /* lookup failed — proceed best-effort */
      }
      const appt = item.proposed_appointment || {};
      // Staff-edited values win over the AI-proposed values.
      const start = overrides.start_time || appt.start_time || new Date(Date.now() + 86400000).toISOString();
      const end =
        overrides.end_time ||
        appt.end_time ||
        new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
      const title = overrides.title || appt.title;
      const address = overrides.address !== undefined ? overrides.address : (appt.address || "");
      const description = overrides.description !== undefined ? overrides.description : (appt.description || "");

      let relatedLeadName = appt.contact_name || "";
      if (item.related_lead_id) {
        try {
          const leads = await base44.entities.Lead.filter({ id: item.related_lead_id });
          if (leads?.[0]?.name) relatedLeadName = leads[0].name;
        } catch (e) {
          /* non-fatal: fall back to contact_name */
        }
      }

      // Approval options for this item: which inspector gets it, and how the
      // customer is notified. Defaults: company Default Inspector (or the
      // approver), notify by TEXT.
      const opts = apptOptions[item.id] || {};
      const inspectorEmail = opts.inspector || defaultInspectorEmail || user?.email || "";
      const channel = opts.channel || "text";

      const createdEvent = await base44.entities.CalendarEvent.create({
        company_id: myCompany?.id,
        title: title || `Appointment - ${relatedLeadName || "Customer"}`,
        start_time: start,
        end_time: end,
        location: address,
        description: description,
        event_type: "appointment",
        status: "scheduled",
        related_lead: relatedLeadName || undefined,
        assigned_to: inspectorEmail || undefined,
      });

      await base44.entities.ActionItem.update(item.id, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });

      // Fire the post-approval notifications: customer confirmation (text or
      // AI call) + immediate inspector alert. The event stamp it applies is
      // also what lets the SMS assistant match the customer's "YES" reply.
      let notifyWarning = null;
      try {
        const res = await base44.functions.invoke("approveAppointmentNotify", {
          companyId: myCompany?.id,
          eventId: createdEvent?.id,
          inspectorEmail,
          customerName: appt.contact_name || relatedLeadName || "",
          customerPhone: appt.contact_phone || "",
          address: address,
          startTime: start,
          channel,
        });
        const payload = res?.data ?? res;
        if (res?.error || payload?.error) {
          notifyWarning = res?.error?.message || payload?.error || "notifications failed";
        } else {
          const warnings = [];
          if (channel !== "none" && appt.contact_phone && payload?.customer?.success === false) {
            warnings.push("the customer confirmation could not be sent");
          }
          // Bell notification is the baseline inspector alert; if even that
          // failed, don't tell the user the inspector was notified.
          if (payload?.inspector && payload.inspector.bell === false) {
            warnings.push("the inspector could not be notified");
          }
          if (warnings.length) notifyWarning = warnings.join(" and ");
        }
      } catch (e) {
        notifyWarning = e?.message || "notifications failed";
      }
      return { notifyWarning, channel, hasPhone: !!appt.contact_phone };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["action-items"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-events-user"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-events-company"] });
      if (result?.notifyWarning) {
        toast.warning(`Appointment added to the calendar, but ${result.notifyWarning}. You may want to reach out to the customer directly.`);
      } else if (result?.channel === "none" || !result?.hasPhone) {
        toast.success("Appointment added to the calendar and the inspector was notified");
      } else {
        toast.success(
          result?.channel === "call"
            ? "Appointment added — the AI is calling the customer to confirm, and the inspector was notified"
            : "Appointment added — confirmation text sent to the customer, and the inspector was notified"
        );
      }
    },
    onError: (err) => {
      if (err?.message === "already_handled") {
        queryClient.invalidateQueries({ queryKey: ["action-items"] });
        toast.info("This appointment was already handled.");
        return;
      }
      // Surface double-booking conflicts with the specific conflicting event details
      const msg = err?.message || "";
      if (err?.conflict || msg.toLowerCase().includes("already booked") || msg.toLowerCase().includes("already has")) {
        toast.error(`Scheduling conflict: ${msg}`, { duration: 8000 });
        return;
      }
      toast.error("Could not schedule appointment: " + msg);
    },
  });

  // Approve a drafted build reminder: send the (possibly edited) text to the
  // customer via SMS, mark the build so it won't re-draft, then complete the
  // action item. Nothing is sent until this runs — human approval is required.
  const approveBuildReminderMutation = useMutation({
    mutationFn: async (item) => {
      const proposed = item.proposed_reminder || {};

      // Idempotency: bail if another tab/user already handled this item, or if
      // this build occurrence was already texted (guards the read-then-send race).
      try {
        const fresh = await base44.entities.ActionItem.filter({ id: item.id });
        const current = fresh?.[0];
        if (current && (current.status === "completed" || current.status === "dismissed")) {
          throw new Error("already_handled");
        }
        if (item.related_build_id && proposed.build_date) {
          const builds = await base44.entities.BuildSchedule.filter({ id: item.related_build_id });
          if (builds?.[0]?.reminder_sent_for_date === proposed.build_date) {
            throw new Error("already_handled");
          }
        }
      } catch (e) {
        if (e?.message === "already_handled") throw e;
      }

      const to = proposed.customer_phone;
      let message = (buildMsgDrafts[item.id] ?? proposed.message ?? "").trim();
      if (!to) throw new Error("No customer phone on file for this build.");
      if (!message) throw new Error("The reminder message is empty.");

      // Requirement: EVERY customer message must identify our AI assistant.
      // If the approver edited the AI-identification line out of the draft,
      // re-prepend it so it can never be sent without it.
      const aiLine = (proposed.ai_line || "").trim();
      if (aiLine && !message.includes(aiLine)) {
        message = `${aiLine} ${message}`;
      }

      // Route through the shared reminder sender so the same guardrails apply as
      // the automated path (valid phone, STOP opt-out, AI-id line). force:true
      // because a human just approved this send (business hours were already
      // confirmed client-side above). channel:'call' places an AI voice call.
      const res = await base44.functions.invoke("sendCustomerReminder", {
        companyId: myCompany?.id,
        to,
        customerName: proposed.customer_name || undefined,
        message,
        aiLine,
        channel: proposed.channel || "text",
        reminderType: "build",
        force: true,
        context: { service: "your upcoming roof installation", address: proposed.address || "" },
      });
      if (res?.error) throw new Error(res.error.message || "The reminder could not be sent.");
      const payload = res?.data ?? res;
      if (!payload || payload.success === false) {
        const reason = payload?.skipped === "invalid_phone" ? "the phone number on file is invalid"
          : payload?.skipped === "opted_out" ? "the customer opted out of messages"
          : payload?.skipped === "empty_message" ? "the message is empty"
          : "the message could not be sent";
        throw new Error("Reminder not sent: " + reason);
      }

      // Mark the build so scanBuildReminders never re-drafts this occurrence.
      if (item.related_build_id && proposed.build_date) {
        try {
          await base44.entities.BuildSchedule.update(item.related_build_id, {
            reminder_sent_for_date: proposed.build_date,
            reminder_sent_at: new Date().toISOString(),
            last_activity_at: new Date().toISOString(),
          });
        } catch (e) {
          /* non-fatal: the item still completes; idempotency also guarded by item status */
        }
      }

      await base44.entities.ActionItem.update(item.id, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["action-items"] });
      toast.success("Reminder sent to the customer");
    },
    onError: (err) => {
      if (err?.message === "already_handled") {
        queryClient.invalidateQueries({ queryKey: ["action-items"] });
        toast.info("This reminder was already handled.");
        return;
      }
      toast.error("Could not send reminder: " + (err?.message || "unknown error"));
    },
  });

  // Skip a drafted build reminder: dismiss it without texting the customer.
  const skipBuildReminderMutation = useMutation({
    mutationFn: async (item) => {
      if (item.related_build_id && item.proposed_reminder?.build_date) {
        try {
          await base44.entities.BuildSchedule.update(item.related_build_id, {
            reminder_skipped_for_date: item.proposed_reminder.build_date,
            last_activity_at: new Date().toISOString(),
          });
        } catch (e) {
          /* non-fatal */
        }
      }
      await base44.entities.ActionItem.update(item.id, { status: "dismissed" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["action-items"] });
      toast.success("Reminder skipped — nothing was sent");
    },
    onError: (err) => toast.error("Could not skip: " + (err?.message || "unknown error")),
  });

  // Soft business-hours guard: warn (but allow) if the customer's local time is
  // outside the configured window. Returns true if the send should proceed.
  const confirmBusinessHours = (proposed) => {
    try {
      const tz = proposed?.timezone || "America/New_York";
      const start = proposed?.business_hours_start ?? 9;
      const end = proposed?.business_hours_end ?? 17;
      const hourStr = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date());
      const hour = parseInt(hourStr, 10);
      if (Number.isFinite(hour) && (hour < start || hour >= end)) {
        return window.confirm(
          `It's currently outside business hours (${start}:00–${end}:00) for this customer's area. Send the reminder anyway?`
        );
      }
    } catch (e) {
      /* if tz math fails, don't block the send */
    }
    return true;
  };

  const handleComplete = (item) => {
    updateMutation.mutate({
      id: item.id,
      data: { status: "completed", completed_at: new Date().toISOString() },
    });
    toast.success("Marked complete");
  };

  const handleDismiss = (item) => {
    updateMutation.mutate({
      id: item.id,
      data: { status: "dismissed" },
    });
    toast.success("Dismissed");
  };

  const handleBulkComplete = async () => {
    const ids = [...selectedIds];
    const now = new Date().toISOString();
    await Promise.all(
      ids.map((id) =>
        base44.entities.ActionItem.update(id, { status: "completed", completed_at: now })
      )
    );
    queryClient.invalidateQueries({ queryKey: ["action-items"] });
    setSelectedIds(new Set());
    setIsBulkMode(false);
    toast.success(`${ids.length} item${ids.length !== 1 ? "s" : ""} marked complete`);
  };

  const handleBulkDismiss = async () => {
    const ids = [...selectedIds];
    await Promise.all(
      ids.map((id) =>
        base44.entities.ActionItem.update(id, { status: "dismissed" })
      )
    );
    queryClient.invalidateQueries({ queryKey: ["action-items"] });
    setSelectedIds(new Set());
    setIsBulkMode(false);
    toast.success(`${ids.length} item${ids.length !== 1 ? "s" : ""} dismissed`);
  };

  const toggleSelectItem = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const activeIds = filteredItems
      .filter((i) => i.status === "pending" || i.status === "overdue")
      .map((i) => i.id);
    if (selectedIds.size === activeIds.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(activeIds));
    }
  };

  const handleSnooze = (item, hours) => {
    const snoozedUntil = addHours(new Date(), hours).toISOString();
    updateMutation.mutate({
      id: item.id,
      data: { status: "snoozed", snoozed_until: snoozedUntil },
    });
    setShowSnoozeDialog(false);
    setSnoozeTarget(null);
    toast.success(`Snoozed for ${hours} hours`);
  };

  const handleReactivate = (item) => {
    updateMutation.mutate({
      id: item.id,
      data: { status: "pending", snoozed_until: null },
    });
    toast.success("Reactivated");
  };

  const handleReassign = () => {
    if (!reassignTarget || !reassignTo) return;
    updateMutation.mutate({
      id: reassignTarget.id,
      data: { assigned_to: reassignTo },
    });
    setShowReassignDialog(false);
    setReassignTarget(null);
    setReassignTo("");
    toast.success("Reassigned successfully");
  };

  const handleCreate = () => {
    if (!createForm.title.trim()) {
      toast.error("Title is required");
      return;
    }
    const dueAt = createForm.due_at
      ? new Date(createForm.due_at).toISOString()
      : addDays(new Date(), 1).toISOString();

    createMutation.mutate({
      company_id: myCompany?.id,
      title: createForm.title,
      description: createForm.description,
      priority: createForm.priority,
      type: createForm.type,
      status: "pending",
      due_at: dueAt,
      assigned_to: createForm.assigned_to || user?.email || "",
      created_by: user?.email || "",
      escalation_level: 0,
    });
  };

  // Non-admin staff see only action items assigned to them or created by them.
  // Fail closed: return empty list until auth fully resolves.
  const visibleActionItems = useMemo(() => {
    if (!user?.email) return []; // auth not yet resolved — show nothing
    if (isAdmin) return actionItems;
    // Client-side catch-all: catches created_by items the server-side assigned_to
    // filter may have missed (e.g. items created by the user but assigned elsewhere)
    return actionItems.filter(
      (i) => i.assigned_to === user.email || i.created_by === user.email
    );
  }, [actionItems, isAdmin, user?.email]);

  const filteredItems = useMemo(() => {
    let items = visibleActionItems;

    if (activeTab === "active") {
      items = items.filter((i) => i.status === "pending" || i.status === "overdue");
    } else if (activeTab === "snoozed") {
      items = items.filter((i) => i.status === "snoozed");
    } else if (activeTab === "completed") {
      items = items.filter((i) => i.status === "completed");
    } else if (activeTab === "dismissed") {
      items = items.filter((i) => i.status === "dismissed");
    }

    if (filterPriority !== "all") {
      items = items.filter((i) => i.priority === filterPriority);
    }
    if (filterType !== "all") {
      items = items.filter((i) => i.type === filterType);
    }
    if (filterAssignee !== "all") {
      items = items.filter((i) => i.assigned_to === filterAssignee);
    }
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      items = items.filter(
        (i) =>
          i.title?.toLowerCase().includes(term) ||
          i.description?.toLowerCase().includes(term)
      );
    }

    return items.sort((a, b) => {
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      const pDiff = (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
      if (pDiff !== 0) return pDiff;
      return new Date(a.due_at || 0) - new Date(b.due_at || 0);
    });
  }, [visibleActionItems, activeTab, filterPriority, filterType, filterAssignee, searchTerm]);

  const counts = useMemo(() => {
    const active = visibleActionItems.filter((i) => i.status === "pending" || i.status === "overdue").length;
    const snoozed = visibleActionItems.filter((i) => i.status === "snoozed").length;
    const completed = visibleActionItems.filter((i) => i.status === "completed").length;
    const dismissed = visibleActionItems.filter((i) => i.status === "dismissed").length;
    const overdue = visibleActionItems.filter(
      (i) => (i.status === "pending" || i.status === "overdue") && i.due_at && isPast(new Date(i.due_at))
    ).length;
    return { active, snoozed, completed, dismissed, overdue };
  }, [visibleActionItems]);

  const getUrgencyStyle = (item) => {
    if (item.status === "completed") return "border-l-green-500";
    if (item.status === "snoozed") return "border-l-gray-400";
    if (item.status === "dismissed") return "border-l-gray-300";
    if (!item.due_at) return "border-l-blue-400";
    const dueDate = new Date(item.due_at);
    if (isPast(dueDate)) return "border-l-red-500";
    if (isToday(dueDate)) return "border-l-orange-500";
    return "border-l-blue-400";
  };

  const getTimeSince = (item) => {
    if (!item.due_at) return null;
    const dueDate = new Date(item.due_at);
    if (isPast(dueDate)) {
      return { text: `Overdue ${formatDistanceToNow(dueDate)}`, overdue: true };
    }
    return { text: `Due ${formatDistanceToNow(dueDate, { addSuffix: true })}`, overdue: false };
  };

  const navigateToRelated = (item) => {
    if (item.related_lead_id) {
      navigate(createPageUrl("LeadProfile") + `?id=${item.related_lead_id}`);
    } else if (item.related_customer_id) {
      navigate(createPageUrl("CustomerProfile") + `?id=${item.related_customer_id}`);
    } else if (item.related_estimate_id) {
      navigate(createPageUrl("EstimateEditor") + `?estimate_id=${item.related_estimate_id}`);
    }
  };

  const getStaffName = (email) => {
    const staff = staffProfiles.find((s) => s.user_email === email || s.email === email);
    return staff?.full_name || staff?.name || email || "Unassigned";
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen" data-testid="action-items-loading">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-4 md:p-6 pb-24">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-white rounded-lg shadow-sm p-4 md:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <ListChecks className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900" data-testid="text-page-title">
                  Action Items
                </h1>
                <p className="text-sm text-gray-600">
                  {counts.active === 0
                    ? "All caught up!"
                    : `${counts.active} active${counts.overdue > 0 ? ` (${counts.overdue} overdue)` : ""}`}
                </p>
              </div>
            </div>
            <Button
              onClick={() => setShowCreateDialog(true)}
              className="bg-blue-600 hover:bg-blue-700"
              data-testid="button-create-action-item"
            >
              <Plus className="w-4 h-4 mr-2" /> New Action Item
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-3 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search action items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
              data-testid="input-search-action-items"
            />
          </div>
          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger className="w-[140px]" data-testid="select-filter-priority">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[180px]" data-testid="select-filter-type">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="follow_up_estimate">Follow Up: Estimate</SelectItem>
              <SelectItem value="follow_up_lead">Follow Up: Lead</SelectItem>
              <SelectItem value="stale_lead">Stale Lead</SelectItem>
              <SelectItem value="stuck_job">Stuck Job</SelectItem>
              <SelectItem value="open_punch_list">Open Punch List</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterAssignee} onValueChange={setFilterAssignee}>
            <SelectTrigger className="w-[160px]" data-testid="select-filter-assignee">
              <SelectValue placeholder="Assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Assignees</SelectItem>
              {staffProfiles.map((s) => (
                <SelectItem key={s.user_email || s.email} value={s.user_email || s.email}>
                  {s.full_name || s.name || s.user_email || s.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setIsBulkMode(false); setSelectedIds(new Set()); }}>
          <div className="flex items-center gap-2">
            <TabsList className="bg-white shadow-sm flex-1 justify-start">
              {STATUS_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} data-testid={`tab-${tab.value}`}>
                  {tab.label}
                  {counts[tab.value] > 0 && (
                    <Badge variant="secondary" className="ml-2 text-xs">
                      {counts[tab.value]}
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {activeTab === "active" && (
              <Button
                variant={isBulkMode ? "default" : "outline"}
                size="sm"
                onClick={() => { setIsBulkMode((v) => !v); setSelectedIds(new Set()); }}
                data-testid="button-bulk-mode"
              >
                <CheckSquare className="w-4 h-4 mr-1" />
                {isBulkMode ? "Cancel" : "Select"}
              </Button>
            )}
          </div>

          {isBulkMode && activeTab === "active" && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex flex-wrap items-center gap-3">
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-900"
                data-testid="button-select-all"
              >
                <input
                  type="checkbox"
                  readOnly
                  checked={
                    selectedIds.size > 0 &&
                    selectedIds.size ===
                      filteredItems.filter((i) => i.status === "pending" || i.status === "overdue").length
                  }
                  className="w-4 h-4 accent-blue-600"
                />
                {selectedIds.size === 0
                  ? "Select all"
                  : `${selectedIds.size} selected`}
              </button>
              <div className="flex gap-2 ml-auto flex-wrap">
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 text-white h-8"
                  onClick={handleBulkComplete}
                  disabled={selectedIds.size === 0}
                  data-testid="button-bulk-complete"
                >
                  <Check className="w-3 h-3 mr-1" /> Complete ({selectedIds.size})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-gray-600"
                  onClick={handleBulkDismiss}
                  disabled={selectedIds.size === 0}
                  data-testid="button-bulk-dismiss"
                >
                  <XCircle className="w-3 h-3 mr-1" /> Dismiss ({selectedIds.size})
                </Button>
              </div>
            </div>
          )}

          {STATUS_TABS.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="space-y-2 mt-3">
              {filteredItems.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <ListChecks className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p className="text-gray-500">No {tab.label.toLowerCase()} action items</p>
                  </CardContent>
                </Card>
              ) : (
                filteredItems.map((item) => {
                  const timeInfo = getTimeSince(item);
                  const priorityCfg = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.medium;
                  const typeCfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.custom;
                  const TypeIcon = typeCfg.icon;

                  const isHighlighted = highlightedItemId === item.id;

                  const isSelected = selectedIds.has(item.id);
                  const isSelectable = isBulkMode && (item.status === "pending" || item.status === "overdue");

                  return (
                    <Card
                      key={item.id}
                      ref={isHighlighted ? highlightRef : undefined}
                      className={`border-l-4 ${getUrgencyStyle(item)} hover:shadow-md transition-shadow ${isHighlighted ? 'ring-2 ring-blue-500 bg-blue-50/50' : ''} ${isSelected ? 'ring-2 ring-blue-400 bg-blue-50/30' : ''}`}
                      data-testid={`card-action-item-${item.id}`}
                      onClick={isSelectable ? () => toggleSelectItem(item.id) : undefined}
                      style={isSelectable ? { cursor: 'pointer' } : undefined}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 mt-1">
                            {isSelectable ? (
                              <input
                                type="checkbox"
                                readOnly
                                checked={isSelected}
                                className="w-4 h-4 accent-blue-600"
                              />
                            ) : item.status === "completed" ? (
                              <CheckCircle2 className="w-5 h-5 text-green-500" />
                            ) : item.status === "snoozed" ? (
                              <Pause className="w-5 h-5 text-gray-400" />
                            ) : (
                              <div className={`w-3 h-3 rounded-full mt-1 ${priorityCfg.dot}`} />
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <h3
                                className={`font-semibold ${
                                  item.status === "completed"
                                    ? "line-through text-gray-400"
                                    : "text-gray-900"
                                }`}
                              >
                                {item.title}
                              </h3>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-menu-${item.id}`} onClick={(e) => e.stopPropagation()}>
                                    <MoreVertical className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {(item.status === "pending" || item.status === "overdue") && (
                                    <>
                                      <DropdownMenuItem onClick={() => handleComplete(item)} data-testid={`menu-complete-${item.id}`}>
                                        <Check className="w-4 h-4 mr-2" /> Mark Complete
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => {
                                          setSnoozeTarget(item);
                                          setShowSnoozeDialog(true);
                                        }}
                                        data-testid={`menu-snooze-${item.id}`}
                                      >
                                        <Pause className="w-4 h-4 mr-2" /> Snooze
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => handleDismiss(item)} data-testid={`menu-dismiss-${item.id}`}>
                                        <XCircle className="w-4 h-4 mr-2" /> Dismiss
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => {
                                          setReassignTarget(item);
                                          setReassignTo(item.assigned_to || "");
                                          setShowReassignDialog(true);
                                        }}
                                        data-testid={`menu-reassign-${item.id}`}
                                      >
                                        <UserPlus className="w-4 h-4 mr-2" /> Reassign
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                  {item.status === "snoozed" && (
                                    <DropdownMenuItem onClick={() => handleReactivate(item)}>
                                      <RefreshCw className="w-4 h-4 mr-2" /> Reactivate
                                    </DropdownMenuItem>
                                  )}
                                  {(item.related_lead_id || item.related_customer_id || item.related_estimate_id) && (
                                    <DropdownMenuItem onClick={() => navigateToRelated(item)}>
                                      <ArrowRight className="w-4 h-4 mr-2" /> View Related
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem
                                    onClick={() => {
                                      if (confirm("Delete this action item?")) {
                                        deleteMutation.mutate(item.id);
                                      }
                                    }}
                                    className="text-red-600"
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>

                            {item.description && (
                              <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                                {item.description}
                              </p>
                            )}

                            <div className="flex flex-wrap gap-2 mt-2 items-center">
                              <Badge variant="outline" className={priorityCfg.color}>
                                {priorityCfg.label}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                <TypeIcon className="w-3 h-3 mr-1" />
                                {typeCfg.label}
                              </Badge>
                              {timeInfo && (
                                <span
                                  className={`text-xs flex items-center gap-1 ${
                                    timeInfo.overdue ? "text-red-600 font-semibold" : "text-gray-500"
                                  }`}
                                >
                                  <Clock className="w-3 h-3" />
                                  {timeInfo.text}
                                </span>
                              )}
                              {item.assigned_to && (
                                <span className="text-xs text-gray-500 flex items-center gap-1">
                                  <User className="w-3 h-3" />
                                  {getStaffName(item.assigned_to)}
                                </span>
                              )}
                              {item.escalation_level > 0 && (
                                <Badge variant="destructive" className="text-xs">
                                  Escalated L{item.escalation_level}
                                </Badge>
                              )}
                              {item.status === "snoozed" && item.snoozed_until && (
                                <span className="text-xs text-gray-500">
                                  Until {format(new Date(item.snoozed_until), "MMM d, h:mm a")}
                                </span>
                              )}
                            </div>

                            {(item.status === "pending" || item.status === "overdue") && item.type === "pending_appointment_approval" && !isBulkMode && (
                              <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3" data-testid={`appointment-approval-${item.id}`}>
                                <div className="flex items-center gap-2 text-sm font-semibold text-blue-900">
                                  <CalendarCheck className="w-4 h-4" /> Appointment to confirm
                                </div>
                                {item.proposed_appointment && (
                                  <div className="text-sm text-blue-900/80 mt-1 space-y-0.5">
                                    {item.proposed_appointment.start_time && (
                                      <div className="flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {(() => { try { return format(new Date(item.proposed_appointment.start_time), "EEE, MMM d 'at' h:mm a"); } catch { return item.proposed_appointment.start_time; } })()}
                                      </div>
                                    )}
                                    {item.proposed_appointment.address && (
                                      <div className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {item.proposed_appointment.address}</div>
                                    )}
                                    {item.proposed_appointment.contact_phone && (
                                      <div className="flex items-center gap-1"><Phone className="w-3 h-3" /> {item.proposed_appointment.contact_phone}</div>
                                    )}
                                  </div>
                                )}
                                <div className="grid gap-2 mt-3 sm:grid-cols-2" onClick={(e) => e.stopPropagation()}>
                                  <div>
                                    <label className="text-xs font-medium text-blue-900/80">Assign inspector</label>
                                    <Select
                                      value={apptOptions[item.id]?.inspector || defaultInspectorEmail || user?.email || ""}
                                      onValueChange={(v) => setApptOptions((o) => ({ ...o, [item.id]: { ...o[item.id], inspector: v } }))}
                                    >
                                      <SelectTrigger className="mt-1 h-8 bg-white text-xs" data-testid={`select-inspector-${item.id}`}>
                                        <SelectValue placeholder="Choose inspector" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {staffProfiles
                                          .filter((s) => s.user_email || s.email)
                                          .map((s) => {
                                            const email = s.user_email || s.email;
                                            return (
                                              <SelectItem key={email} value={email} data-testid={`option-inspector-${email}`}>
                                                {(s.full_name || s.name || email)}{email === defaultInspectorEmail ? " (default)" : ""}
                                              </SelectItem>
                                            );
                                          })}
                                        {user?.email && !staffProfiles.some((s) => (s.user_email || s.email) === user.email) && (
                                          <SelectItem value={user.email}>{user.email} (me)</SelectItem>
                                        )}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div>
                                    <label className="text-xs font-medium text-blue-900/80">Customer confirmation</label>
                                    <Select
                                      value={apptOptions[item.id]?.channel || "text"}
                                      onValueChange={(v) => setApptOptions((o) => ({ ...o, [item.id]: { ...o[item.id], channel: v } }))}
                                    >
                                      <SelectTrigger className="mt-1 h-8 bg-white text-xs" data-testid={`select-confirm-channel-${item.id}`}>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="text">Text message (recommended)</SelectItem>
                                        <SelectItem value="call">AI phone call</SelectItem>
                                        <SelectItem value="none">Don't notify customer</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                                {(apptOptions[item.id]?.channel || "text") !== "none" && item.proposed_appointment?.contact_phone && (
                                  <p className="text-xs text-blue-700/70 mt-1.5">
                                    On approval, the customer gets a confirmation asking them to reply YES, and the inspector is notified immediately. When the customer replies, the inspector gets a heads-up too.
                                  </p>
                                )}
                                <div className="flex flex-wrap gap-2 mt-3">
                                  <Button
                                    size="sm"
                                    className="bg-blue-600 hover:bg-blue-700 text-white h-7 text-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const appt = item.proposed_appointment || {};
                                      setApptEditDialog({
                                        open: true,
                                        item,
                                        form: {
                                          title: appt.title || `Appointment - ${appt.contact_name || "Customer"}`,
                                          start: toDatetimeLocalStr(appt.start_time),
                                          end: toDatetimeLocalStr(appt.end_time),
                                          address: appt.address || "",
                                          notes: appt.description || "",
                                        },
                                      });
                                    }}
                                    disabled={approveAppointmentMutation.isPending}
                                    data-testid={`button-approve-appointment-${item.id}`}
                                  >
                                    {approveAppointmentMutation.isPending ? (
                                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                    ) : (
                                      <CalendarCheck className="w-3 h-3 mr-1" />
                                    )}
                                    Approve & Add to Calendar
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={(e) => { e.stopPropagation(); handleDismiss(item); }}
                                    data-testid={`button-dismiss-appointment-${item.id}`}
                                  >
                                    <XCircle className="w-3 h-3 mr-1" /> Dismiss
                                  </Button>
                                  {(item.related_lead_id || item.related_customer_id || item.related_estimate_id) && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs"
                                      onClick={(e) => { e.stopPropagation(); navigateToRelated(item); }}
                                      data-testid={`button-view-related-appt-${item.id}`}
                                    >
                                      <ArrowRight className="w-3 h-3 mr-1" /> View
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )}

                            {(item.status === "pending" || item.status === "overdue") && item.type === "pending_build_reminder" && !isBulkMode && (
                              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid={`build-reminder-approval-${item.id}`}>
                                <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                                  <Hammer className="w-4 h-4" /> Build reminder to review
                                </div>
                                {item.proposed_reminder && (
                                  <div className="text-sm text-amber-900/80 mt-1 space-y-0.5">
                                    {item.proposed_reminder.build_date_label && (
                                      <div className="flex items-center gap-1"><Clock className="w-3 h-3" /> {item.proposed_reminder.build_date_label}</div>
                                    )}
                                    {item.proposed_reminder.address && (
                                      <div className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {item.proposed_reminder.address}</div>
                                    )}
                                    {item.proposed_reminder.customer_phone && (
                                      <div className="flex items-center gap-1"><Phone className="w-3 h-3" /> {item.proposed_reminder.customer_phone}</div>
                                    )}
                                  </div>
                                )}
                                <div className="mt-2">
                                  <label className="text-xs font-medium text-amber-900/80">Message to send (you can edit it)</label>
                                  <Textarea
                                    rows={4}
                                    className="mt-1 bg-white text-sm"
                                    value={buildMsgDrafts[item.id] ?? item.proposed_reminder?.message ?? ""}
                                    onChange={(e) => setBuildMsgDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                                    onClick={(e) => e.stopPropagation()}
                                    data-testid={`textarea-build-reminder-${item.id}`}
                                  />
                                  <p className="text-xs text-amber-700/70 mt-1">This text clearly identifies our AI assistant. Nothing is sent until you approve.</p>
                                </div>
                                <div className="flex flex-wrap gap-2 mt-3">
                                  <Button
                                    size="sm"
                                    className="bg-amber-600 hover:bg-amber-700 text-white h-7 text-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!confirmBusinessHours(item.proposed_reminder)) return;
                                      approveBuildReminderMutation.mutate(item);
                                    }}
                                    disabled={approveBuildReminderMutation.isPending}
                                    data-testid={`button-approve-build-reminder-${item.id}`}
                                  >
                                    <Send className="w-3 h-3 mr-1" /> Approve & Send
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={(e) => { e.stopPropagation(); skipBuildReminderMutation.mutate(item); }}
                                    disabled={skipBuildReminderMutation.isPending}
                                    data-testid={`button-skip-build-reminder-${item.id}`}
                                  >
                                    <XCircle className="w-3 h-3 mr-1" /> Skip
                                  </Button>
                                  {(item.related_build_id || item.related_calendar_event_id) && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs"
                                      onClick={(e) => { e.stopPropagation(); navigate(createPageUrl("BuildSchedule")); }}
                                      data-testid={`button-view-build-${item.id}`}
                                    >
                                      <ArrowRight className="w-3 h-3 mr-1" /> View Build
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )}

                            {(item.status === "pending" || item.status === "overdue") && item.type === "stuck_job" && !isBulkMode && (
                              <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3" data-testid={`stuck-job-alert-${item.id}`}>
                                <div className="flex items-center gap-2 text-sm font-semibold text-orange-900">
                                  <Clock className="w-4 h-4" />
                                  {item.alert_count > 1 ? (
                                    <span className="flex items-center gap-2">
                                      Job still stuck — internal reminder (the customer is not contacted)
                                      <Badge className="bg-orange-600 text-white text-xs px-1.5 py-0.5" data-testid={`badge-stuck-reminder-${item.id}`}>
                                        Reminder #{item.alert_count}
                                      </Badge>
                                    </span>
                                  ) : (
                                    "Job stuck in stage — internal alert (the customer is not contacted)"
                                  )}
                                </div>
                                <div className="text-sm text-orange-900/80 mt-1 space-y-0.5">
                                  {item.stage_label && (
                                    <div className="flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {item.stage_label}{typeof item.days_in_stage === "number" ? ` · ${item.days_in_stage} days in stage` : ""}</div>
                                  )}
                                  {item.address && (
                                    <div className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {item.address}</div>
                                  )}
                                </div>
                                <div className="mt-2 max-w-xs">
                                  <label className="text-xs font-medium text-orange-900/80">Reason (confirm or change)</label>
                                  <Select
                                    value={item.category || item.suggested_category || "Stalled"}
                                    onValueChange={(v) => updateMutation.mutate({ id: item.id, data: { category: v } })}
                                  >
                                    <SelectTrigger className="mt-1 bg-white h-8 text-sm" data-testid={`select-stuck-category-${item.id}`} onClick={(e) => e.stopPropagation()}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="Stalled">Stalled</SelectItem>
                                      <SelectItem value="Waiting">Waiting</SelectItem>
                                      <SelectItem value="Forgotten">Forgotten</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {item.suggested_category && (
                                    <p className="text-xs text-orange-700/70 mt-1">Suggested: {item.suggested_category}</p>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-2 mt-3">
                                  <Button
                                    size="sm"
                                    className="bg-orange-600 hover:bg-orange-700 text-white h-7 text-xs"
                                    onClick={(e) => { e.stopPropagation(); handleComplete(item); }}
                                    data-testid={`button-resolve-stuck-${item.id}`}
                                  >
                                    <Check className="w-3 h-3 mr-1" /> Mark Resolved
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={(e) => { e.stopPropagation(); handleDismiss(item); }}
                                    data-testid={`button-dismiss-stuck-${item.id}`}
                                  >
                                    <XCircle className="w-3 h-3 mr-1" /> Dismiss
                                  </Button>
                                  {item.related_build_id && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs"
                                      onClick={(e) => { e.stopPropagation(); navigate(createPageUrl("BuildSchedule")); }}
                                      data-testid={`button-view-stuck-build-${item.id}`}
                                    >
                                      <ArrowRight className="w-3 h-3 mr-1" /> View Build
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )}

                            {(item.status === "pending" || item.status === "overdue") && item.type !== "pending_appointment_approval" && item.type !== "pending_build_reminder" && item.type !== "stuck_job" && !isBulkMode && (
                              <div className="flex gap-2 mt-3">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={(e) => { e.stopPropagation(); handleComplete(item); }}
                                  data-testid={`button-complete-${item.id}`}
                                >
                                  <Check className="w-3 h-3 mr-1" /> Complete
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSnoozeTarget(item);
                                    setShowSnoozeDialog(true);
                                  }}
                                  data-testid={`button-snooze-${item.id}`}
                                >
                                  <Pause className="w-3 h-3 mr-1" /> Snooze
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setReassignTarget(item);
                                    setReassignTo(item.assigned_to || "");
                                    setShowReassignDialog(true);
                                  }}
                                  data-testid={`button-reassign-${item.id}`}
                                >
                                  <UserPlus className="w-3 h-3 mr-1" /> Reassign
                                </Button>
                                {(item.related_lead_id || item.related_customer_id || item.related_estimate_id) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={(e) => { e.stopPropagation(); navigateToRelated(item); }}
                                    data-testid={`button-view-related-${item.id}`}
                                  >
                                    <ArrowRight className="w-3 h-3 mr-1" /> View
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Action Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Title *</label>
              <Input
                value={createForm.title}
                onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Follow up with customer..."
                data-testid="input-create-title"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={createForm.description}
                onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Additional details..."
                rows={3}
                data-testid="input-create-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Priority</label>
                <Select
                  value={createForm.priority}
                  onValueChange={(v) => setCreateForm((f) => ({ ...f, priority: v }))}
                >
                  <SelectTrigger data-testid="select-create-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Type</label>
                <Select
                  value={createForm.type}
                  onValueChange={(v) => setCreateForm((f) => ({ ...f, type: v }))}
                >
                  <SelectTrigger data-testid="select-create-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom">Custom</SelectItem>
                    <SelectItem value="follow_up_estimate">Follow Up: Estimate</SelectItem>
                    <SelectItem value="follow_up_lead">Follow Up: Lead</SelectItem>
                    <SelectItem value="stale_lead">Stale Lead</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Due Date</label>
              <Input
                type="datetime-local"
                value={createForm.due_at}
                onChange={(e) => setCreateForm((f) => ({ ...f, due_at: e.target.value }))}
                data-testid="input-create-due-date"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Assign To</label>
              <Select
                value={createForm.assigned_to}
                onValueChange={(v) => setCreateForm((f) => ({ ...f, assigned_to: v }))}
              >
                <SelectTrigger data-testid="select-create-assignee">
                  <SelectValue placeholder="Select team member" />
                </SelectTrigger>
                <SelectContent>
                  {staffProfiles.map((staff) => (
                    <SelectItem key={staff.id} value={staff.user_email || staff.email || staff.id}>
                      {staff.full_name || staff.name || staff.user_email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              data-testid="button-submit-create"
            >
              {createMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSnoozeDialog} onOpenChange={setShowSnoozeDialog}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Snooze Action Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {[
              { label: "1 hour", hours: 1 },
              { label: "2 hours", hours: 2 },
              { label: "4 hours", hours: 4 },
              { label: "Tomorrow (24h)", hours: 24 },
              { label: "3 days", hours: 72 },
              { label: "1 week", hours: 168 },
            ].map((opt) => (
              <Button
                key={opt.hours}
                variant="outline"
                className="w-full justify-start"
                onClick={() => snoozeTarget && handleSnooze(snoozeTarget, opt.hours)}
                data-testid={`button-snooze-${opt.hours}h`}
              >
                <Clock className="w-4 h-4 mr-2" />
                {opt.label}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Appointment edit dialog — lets staff adjust time/address/title before confirming */}
      <Dialog
        open={apptEditDialog.open}
        onOpenChange={(open) => !open && setApptEditDialog((s) => ({ ...s, open: false }))}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarCheck className="w-5 h-5 text-blue-600" /> Review &amp; Confirm Appointment
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500 -mt-1">
            Check the details the AI captured and correct anything before adding to the calendar.
          </p>
          <div className="space-y-3 mt-1">
            <div>
              <label className="text-xs font-medium text-gray-700">Title</label>
              <Input
                value={apptEditDialog.form.title || ""}
                onChange={(e) => setApptEditDialog((s) => ({ ...s, form: { ...s.form, title: e.target.value } }))}
                placeholder="Appointment title"
                className="mt-1"
                data-testid="input-appt-edit-title"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-700">Start date &amp; time</label>
                <Input
                  type="datetime-local"
                  value={apptEditDialog.form.start || ""}
                  onChange={(e) => setApptEditDialog((s) => ({ ...s, form: { ...s.form, start: e.target.value } }))}
                  className="mt-1"
                  data-testid="input-appt-edit-start"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">End date &amp; time</label>
                <Input
                  type="datetime-local"
                  value={apptEditDialog.form.end || ""}
                  onChange={(e) => setApptEditDialog((s) => ({ ...s, form: { ...s.form, end: e.target.value } }))}
                  className="mt-1"
                  data-testid="input-appt-edit-end"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Address</label>
              <Input
                value={apptEditDialog.form.address || ""}
                onChange={(e) => setApptEditDialog((s) => ({ ...s, form: { ...s.form, address: e.target.value } }))}
                placeholder="Property address"
                className="mt-1"
                data-testid="input-appt-edit-address"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Notes</label>
              <Textarea
                value={apptEditDialog.form.notes || ""}
                onChange={(e) => setApptEditDialog((s) => ({ ...s, form: { ...s.form, notes: e.target.value } }))}
                placeholder="Any additional notes"
                rows={2}
                className="mt-1"
                data-testid="textarea-appt-edit-notes"
              />
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button
              variant="outline"
              onClick={() => setApptEditDialog((s) => ({ ...s, open: false }))}
              data-testid="button-appt-edit-cancel"
            >
              Cancel
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white"
              disabled={approveAppointmentMutation.isPending}
              onClick={() => {
                const f = apptEditDialog.form;
                const startIso = datetimeLocalToIso(f.start);
                if (!startIso) {
                  toast.error("Please enter a valid start date and time before confirming.");
                  return;
                }
                const overrides = {
                  title: f.title || undefined,
                  start_time: startIso,
                  end_time: datetimeLocalToIso(f.end),
                  address: f.address,
                  description: f.notes,
                };
                setApptEditDialog((s) => ({ ...s, open: false }));
                approveAppointmentMutation.mutate({ item: apptEditDialog.item, overrides });
              }}
              data-testid="button-appt-edit-confirm"
            >
              {approveAppointmentMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CalendarCheck className="w-4 h-4 mr-2" />
              )}
              Confirm &amp; Add to Calendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showReassignDialog} onOpenChange={setShowReassignDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reassign Action Item</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600 mb-2">
            {reassignTarget?.title}
          </p>
          <Select value={reassignTo} onValueChange={setReassignTo}>
            <SelectTrigger data-testid="select-reassign-to">
              <SelectValue placeholder="Select team member" />
            </SelectTrigger>
            <SelectContent>
              {staffProfiles.map((staff) => (
                <SelectItem key={staff.id} value={staff.user_email || staff.email || staff.id}>
                  {staff.full_name || staff.name || staff.user_email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReassignDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleReassign}
              disabled={!reassignTo || updateMutation.isPending}
              data-testid="button-submit-reassign"
            >
              <UserPlus className="w-4 h-4 mr-2" /> Reassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
