import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { createPageUrl } from "@/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ClipboardList,
  UserPlus,
  Users,
  Briefcase,
  Clock,
  ChevronRight,
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  ListTodo,
  FileText,
  AlertTriangle,
  CalendarClock,
  Flag,
} from "lucide-react";
import { format, isPast, isToday, isTomorrow, startOfDay } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { fetchAssignmentRecords, assignmentMatches, actionableTask, assignmentOwnerPatch, dateUrgency, matchesEmployeeScope, hasNoAssignment } from "@/utils/assignmentView";
import { parseDateOnly } from "@/utils/localDate";

const STATUS_COLORS = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  active: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  in_progress: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  pending: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  contacted: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  qualified: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  inspected: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
  proposal: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  completed: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  closed: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  inactive: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  won: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  lost: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  todo: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  done: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const PRIORITY_COLORS = {
  urgent: "text-red-600 dark:text-red-400",
  high: "text-orange-500 dark:text-orange-400",
  medium: "text-yellow-600 dark:text-yellow-400",
  low: "text-slate-400",
};

const LEAD_STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "inspected", label: "Inspected" },
  { value: "proposal", label: "Proposal Sent" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "closed", label: "Closed" },
];

const CUSTOMER_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "completed", label: "Completed" },
  { value: "closed", label: "Closed" },
];

const LEAD_CLOSED_STATUSES = ["closed", "lost", "won"];
const CUSTOMER_DONE_STATUSES = ["completed", "inactive", "closed"];

function StatusSelect({ value, options, onChange, onClick }) {
  return (
    <select
      data-testid="status-select"
      value={value || ""}
      onChange={e => onChange(e.target.value)}
      onClick={e => { e.stopPropagation(); if (onClick) onClick(e); }}
      className={`text-xs font-medium rounded px-2 py-0.5 border-0 cursor-pointer appearance-none pr-5 bg-no-repeat focus:outline-none focus:ring-1 focus:ring-blue-400 ${STATUS_COLORS[value] || "bg-slate-100 text-slate-600"}`}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")", backgroundPosition: "right 4px center" }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function EmptyState({ icon: Icon, label }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-600 gap-3">
      <Icon className="w-10 h-10 opacity-30" />
      <p className="text-sm">No {label} assigned to you</p>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

function TaskRow({ task, onClick, owner }) {
  const isDone = task.status === "done" || task.status === "completed";
  const isOverdue = task.due_date && !isDone && dateUrgency(task.due_date) === "overdue";
  return (
    <div
      data-testid={`task-row-${task.id}`}
      className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
      onClick={onClick}
    >
      {isDone
        ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-500" />
        : <Circle className="w-4 h-4 mt-0.5 shrink-0 text-slate-300 dark:text-slate-600" />}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${isDone ? "line-through text-slate-400" : "text-slate-800 dark:text-slate-200"}`}>
          {task.title || task.name || "Untitled Task"}
        </p>
        {(task.description || task.notes) && (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">
            {task.description || task.notes}
          </p>
        )}
        {owner && <p className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">Owner: {owner} · Open in Tasks to reassign</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {task.priority && (
          <span className={`text-xs font-medium capitalize ${PRIORITY_COLORS[task.priority] || "text-slate-400"}`}>
            {task.priority}
          </span>
        )}
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${STATUS_COLORS[task.status] || "bg-slate-100 text-slate-600"}`}>
          {(task.status || "todo").replace(/_/g, " ")}
        </span>
        {task.due_date && (
          <span className={`flex items-center gap-1 text-xs ${isOverdue ? "text-red-500 font-medium" : "text-slate-400"}`}>
            <Clock className="w-3 h-3" />
            {format(parseDateOnly(task.due_date), "MMM d")}
          </span>
        )}
        <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
      </div>
    </div>
  );
}

function OwnerControl({ record, staffProfiles, onAssign, onDueDate }) {
  const value = record.assigned_to_email || record.assigned_to || "";
  const due = record.due_date ? parseDateOnly(record.due_date) : null;
  const dueInputValue = due ? `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}` : "";
  return (
    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <select aria-label="Assignment owner" value={value} onChange={e => {
        const profile = staffProfiles.find(p => p.user_email === e.target.value);
        onAssign(e.target.value, profile?.full_name || "");
      }} className="max-w-28 rounded border border-slate-200 bg-white px-1.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900">
        <option value="">Unassigned</option>
        {staffProfiles.map(profile => <option key={profile.id} value={profile.user_email}>{profile.full_name || profile.user_email}</option>)}
      </select>
      {onDueDate && <input aria-label="Due date" type="date" value={dueInputValue} onChange={e => onDueDate(e.target.value || null)} className="w-28 rounded border border-slate-200 bg-white px-1 py-1 text-xs dark:border-slate-700 dark:bg-slate-900" />}
    </div>
  );
}

function LeadRow({ lead, onStatusChange, onSendEstimate, onClick, ownerControl }) {
  return (
    <div
      data-testid={`lead-row-${lead.id}`}
      className="flex items-center gap-2 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
    >
      <UserPlus
        className="w-4 h-4 shrink-0 text-slate-300 dark:text-slate-600 cursor-pointer"
        onClick={onClick}
      />
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onClick}>
        <p className="text-sm font-medium truncate text-slate-800 dark:text-slate-200">
          {lead.full_name || lead.name || lead.company_name || "Unknown Lead"}
        </p>
        {(lead.email || lead.phone) && (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            {lead.email || lead.phone}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {ownerControl}
        <StatusSelect
          value={lead.status || "new"}
          options={LEAD_STATUS_OPTIONS}
          onChange={onStatusChange}
        />
        <button
          data-testid={`lead-send-estimate-${lead.id}`}
          onClick={e => { e.stopPropagation(); onSendEstimate(); }}
          title="New Estimate"
          className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 transition-colors border border-green-200 dark:border-green-800"
        >
          <FileText className="w-3 h-3" />
          Estimate
        </button>
        {lead.created_date && (
          <span className="text-xs text-slate-400 hidden sm:block">
            {format(new Date(lead.created_date), "MMM d")}
          </span>
        )}
        <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 cursor-pointer" onClick={onClick} />
      </div>
    </div>
  );
}

function CompletionReview({ candidates, onDecision, isPending }) {
  if (!candidates.length) return null;

  return (
    <div
      data-testid="customer-completion-review"
      className="mb-4 rounded-xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-900/60 dark:bg-amber-950/20"
    >
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Review finished customer assignments
          </p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
            These customers appear to be paid in full with no open project or task. Mark them Completed, or keep them Active.
          </p>
          <div className="mt-3 space-y-2">
            {candidates.map(candidate => (
              <div
                key={candidate.customer_id}
                className="flex flex-col gap-2 rounded-lg border border-amber-200/80 bg-white/80 p-3 dark:border-amber-900/50 dark:bg-slate-900/50 sm:flex-row sm:items-center"
                data-testid={`completion-candidate-${candidate.customer_id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                    {candidate.customer_name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {candidate.invoice_count} invoice{candidate.invoice_count === 1 ? "" : "s"} paid in full
                    {" · "}
                    ${Number(candidate.total_paid || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} collected
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending}
                    onClick={() => onDecision(candidate, "completed")}
                    data-testid={`completion-accept-${candidate.customer_id}`}
                    className="bg-green-600 text-white hover:bg-green-700"
                  >
                    Mark Completed
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => onDecision(candidate, "kept_active")}
                    data-testid={`completion-keep-active-${candidate.customer_id}`}
                  >
                    Keep Active
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomerRow({ customer, onStatusChange, onClick, ownerControl }) {
  return (
    <div
      data-testid={`customer-row-${customer.id}`}
      className="flex items-center gap-2 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
    >
      <Users
        className="w-4 h-4 shrink-0 text-slate-300 dark:text-slate-600 cursor-pointer"
        onClick={onClick}
      />
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onClick}>
        <p className="text-sm font-medium truncate text-slate-800 dark:text-slate-200">
          {customer.full_name || customer.name || customer.company_name || "Unknown Customer"}
        </p>
        {(customer.email || customer.phone) && (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            {customer.email || customer.phone}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {ownerControl}
        <StatusSelect
          value={customer.status || "active"}
          options={CUSTOMER_STATUS_OPTIONS}
          onChange={onStatusChange}
        />
        <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 cursor-pointer" onClick={onClick} />
      </div>
    </div>
  );
}

function ProjectRow({ project, onClick, ownerControl }) {
  const isOverdue = project.due_date && !["completed", "closed"].includes(project.status) && dateUrgency(project.due_date) === "overdue";
  return (
    <div
      data-testid={`project-row-${project.id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <Briefcase className="w-4 h-4 shrink-0 text-slate-300 dark:text-slate-600" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-slate-800 dark:text-slate-200">
          {project.name || project.title || "Untitled Project"}
        </p>
        {project.customer_name && (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{project.customer_name}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {ownerControl}
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${STATUS_COLORS[project.status] || "bg-slate-100 text-slate-600"}`}>
          {(project.status || "active").replace(/_/g, " ")}
        </span>
        {project.due_date && (
          <span className={`flex items-center gap-1 text-xs ${isOverdue ? "text-red-500 font-medium" : "text-slate-400"}`}>
            <Clock className="w-3 h-3" />
            {format(parseDateOnly(project.due_date), "MMM d")}
          </span>
        )}
        <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
      </div>
    </div>
  );
}

const PRIORITY_META = {
  urgent: { label: "Urgent", color: "text-red-600 dark:text-red-400", chip: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  high:   { label: "High",   color: "text-orange-600 dark:text-orange-400", chip: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  normal: { label: "Normal", color: "text-slate-500 dark:text-slate-400", chip: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  low:    { label: "Low",    color: "text-slate-400 dark:text-slate-500", chip: "bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400" },
};

function urgencyOf(todo) {
  if (todo.is_done) return "done";
  if (!todo.due_date) return "none";
  const due = startOfDay(new Date(todo.due_date));
  const today = startOfDay(new Date());
  if (due < today) return "overdue";
  if (due.getTime() === today.getTime()) return "today";
  const diffDays = Math.ceil((due - today) / 86400000);
  if (diffDays <= 3) return "soon";
  return "future";
}

function dueLabel(d) {
  if (!d) return null;
  const date = new Date(d);
  if (isPast(date) && !isToday(date)) {
    const daysAgo = Math.floor((startOfDay(new Date()) - startOfDay(date)) / 86400000);
    return daysAgo === 1 ? "1 day overdue" : `${daysAgo} days overdue`;
  }
  if (isToday(date)) return "Due today";
  if (isTomorrow(date)) return "Due tomorrow";
  return `Due ${format(date, "MMM d")}`;
}

function PersonalToDoTab({ myEmail, companyId }) {
  const qc = useQueryClient();
  const [newText, setNewText] = useState("");
  const [newDueDate, setNewDueDate] = useState(null);
  const [newPriority, setNewPriority] = useState("normal");
  const [showDone, setShowDone] = useState(false);
  const inputRef = useRef(null);

  const qKey = ["personal-todos", myEmail, companyId];

  const { data: todos = [], isLoading } = useQuery({
    queryKey: qKey,
    queryFn: () =>
      base44.entities.PersonalTodo.filter(
        { user_email: myEmail, company_id: companyId },
        "created_date",
        500
      ),
    enabled: !!myEmail && !!companyId,
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: ({ title, due_date, priority }) =>
      base44.entities.PersonalTodo.create({
        user_email: myEmail,
        company_id: companyId,
        title,
        is_done: false,
        due_date: due_date || null,
        priority: priority || "normal",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qKey });
      setNewText("");
      setNewDueDate(null);
      setNewPriority("normal");
      inputRef.current?.focus();
    },
    onError: () => toast.error("Couldn't add item"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_done }) =>
      base44.entities.PersonalTodo.update(id, { is_done }),
    onMutate: async ({ id, is_done }) => {
      await qc.cancelQueries({ queryKey: qKey });
      const prev = qc.getQueryData(qKey);
      qc.setQueryData(qKey, (old = []) =>
        old.map(t => t.id === id ? { ...t, is_done } : t)
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(qKey, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: qKey }),
  });

  const updateFieldMutation = useMutation({
    mutationFn: ({ id, patch }) => base44.entities.PersonalTodo.update(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qKey });
      const prev = qc.getQueryData(qKey);
      qc.setQueryData(qKey, (old = []) =>
        old.map(t => t.id === id ? { ...t, ...patch } : t)
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(qKey, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: qKey }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.PersonalTodo.delete(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qKey });
      const prev = qc.getQueryData(qKey);
      qc.setQueryData(qKey, (old = []) => old.filter(t => t.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(qKey, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: qKey }),
  });

  const handleAdd = () => {
    const text = newText.trim();
    if (!text) return;
    addMutation.mutate({ title: text, due_date: newDueDate ? newDueDate.toISOString() : null, priority: newPriority });
  };

  const URG_RANK = { overdue: 0, today: 1, soon: 2, future: 3, none: 4, done: 5 };
  const PRIO_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };

  const sorted = [...todos].sort((a, b) => {
    const ua = urgencyOf(a), ub = urgencyOf(b);
    if (URG_RANK[ua] !== URG_RANK[ub]) return URG_RANK[ua] - URG_RANK[ub];
    const pa = PRIO_RANK[a.priority || "normal"], pb = PRIO_RANK[b.priority || "normal"];
    if (pa !== pb) return pa - pb;
    if (a.due_date && b.due_date) return new Date(a.due_date) - new Date(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return 0;
  });

  const pending = sorted.filter(t => !t.is_done);
  const done = sorted.filter(t => t.is_done);
  const overdueCount = pending.filter(t => urgencyOf(t) === "overdue").length;
  const todayCount = pending.filter(t => urgencyOf(t) === "today").length;
  const visible = showDone ? sorted : pending;

  const quickDates = [
    { label: "Today", value: () => new Date() },
    { label: "Tomorrow", value: () => { const d = new Date(); d.setDate(d.getDate() + 1); return d; } },
    { label: "Next week", value: () => { const d = new Date(); d.setDate(d.getDate() + 7); return d; } },
    { label: "Clear", value: () => null },
  ];

  return (
    <div className="p-4">
      {(overdueCount > 0 || todayCount > 0) && (
        <div className="mb-4 flex flex-wrap gap-2" data-testid="todo-nag-banner">
          {overdueCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm font-medium animate-pulse">
              <AlertTriangle className="w-4 h-4" />
              {overdueCount} overdue {overdueCount === 1 ? "item needs" : "items need"} your attention
            </div>
          )}
          {todayCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300 text-sm font-medium">
              <CalendarClock className="w-4 h-4" />
              {todayCount} due today
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-2">
        <Input
          ref={inputRef}
          data-testid="todo-input"
          placeholder="Add a to-do item…"
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleAdd()}
          className="flex-1 min-w-[180px] bg-white dark:bg-slate-900"
        />
        <Button
          data-testid="todo-add-btn"
          onClick={handleAdd}
          disabled={!newText.trim() || addMutation.isPending}
          size="sm"
          className="gap-1"
        >
          <Plus className="w-4 h-4" />
          Add
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs text-slate-500 dark:text-slate-400">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="todo-new-due"
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <CalendarClock className="w-3.5 h-3.5" />
              {newDueDate ? format(newDueDate, "MMM d") : "No due date"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start">
            <div className="flex flex-col gap-1 mb-2">
              {quickDates.map(q => (
                <button
                  key={q.label}
                  onClick={() => setNewDueDate(q.value())}
                  className="text-left text-xs px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {q.label}
                </button>
              ))}
            </div>
            <Calendar mode="single" selected={newDueDate || undefined} onSelect={(d) => setNewDueDate(d || null)} />
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="todo-new-priority"
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 ${PRIORITY_META[newPriority].color}`}
            >
              <Flag className="w-3.5 h-3.5" />
              {PRIORITY_META[newPriority].label}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {Object.entries(PRIORITY_META).map(([key, meta]) => (
              <DropdownMenuItem key={key} onClick={() => setNewPriority(key)} className={meta.color}>
                <Flag className="w-3.5 h-3.5 mr-2" />
                {meta.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isLoading ? (
        <LoadingRows />
      ) : todos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-600 gap-3">
          <ListTodo className="w-10 h-10 opacity-30" />
          <p className="text-sm">Your personal to-do list is empty</p>
          <p className="text-xs text-slate-400">Type something above, set a due date, and press Enter</p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {visible.map(todo => {
              const urgency = urgencyOf(todo);
              const ringClass =
                urgency === "overdue" ? "border-l-4 border-red-500 bg-red-50/60 dark:bg-red-950/20 animate-pulse" :
                urgency === "today"   ? "border-l-4 border-amber-500 bg-amber-50/60 dark:bg-amber-950/20" :
                urgency === "soon"    ? "border-l-4 border-blue-400 bg-blue-50/40 dark:bg-blue-950/20" :
                "border-l-4 border-transparent";
              const prio = PRIORITY_META[todo.priority || "normal"];
              return (
                <div
                  key={todo.id}
                  data-testid={`todo-item-${todo.id}`}
                  className={`flex items-start gap-3 px-3 py-2.5 rounded-lg group transition-colors ${ringClass} hover:bg-slate-50 dark:hover:bg-slate-800/50`}
                >
                  <button
                    data-testid={`todo-toggle-${todo.id}`}
                    onClick={() => toggleMutation.mutate({ id: todo.id, is_done: !todo.is_done })}
                    className="shrink-0 focus:outline-none mt-0.5"
                    aria-label={todo.is_done ? "Mark incomplete" : "Mark complete"}
                  >
                    {todo.is_done
                      ? <CheckCircle2 className="w-5 h-5 text-green-500" />
                      : <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 hover:text-blue-400 transition-colors" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm ${todo.is_done ? "line-through text-slate-400" : "text-slate-800 dark:text-slate-200"}`}>
                      {todo.title}
                    </div>
                    {!todo.is_done && (todo.due_date || todo.priority) && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {todo.due_date && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                data-testid={`todo-due-${todo.id}`}
                                className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${
                                  urgency === "overdue" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-semibold" :
                                  urgency === "today"   ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-semibold" :
                                  "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                                }`}
                              >
                                <CalendarClock className="w-3 h-3" />
                                {dueLabel(todo.due_date)}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-2" align="start">
                              <Calendar
                                mode="single"
                                selected={todo.due_date ? new Date(todo.due_date) : undefined}
                                onSelect={(d) => updateFieldMutation.mutate({ id: todo.id, patch: { due_date: d ? d.toISOString() : null, last_nagged_at: null } })}
                              />
                              <button
                                onClick={() => updateFieldMutation.mutate({ id: todo.id, patch: { due_date: null } })}
                                className="text-xs text-slate-500 hover:text-slate-700 mt-1 px-2 py-1"
                              >
                                Clear date
                              </button>
                            </PopoverContent>
                          </Popover>
                        )}
                        {todo.priority && todo.priority !== "normal" && (
                          <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${prio.chip}`}>
                            <Flag className="w-3 h-3" />
                            {prio.label}
                          </span>
                        )}
                      </div>
                    )}
                    {!todo.is_done && !todo.due_date && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            data-testid={`todo-add-due-${todo.id}`}
                            className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 mt-1"
                          >
                            <CalendarClock className="w-3 h-3" />
                            Set due date
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-2" align="start">
                          <Calendar
                            mode="single"
                            onSelect={(d) => updateFieldMutation.mutate({ id: todo.id, patch: { due_date: d ? d.toISOString() : null, last_nagged_at: null } })}
                          />
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                  <button
                    data-testid={`todo-delete-${todo.id}`}
                    onClick={() => deleteMutation.mutate(todo.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-red-500 focus:outline-none mt-0.5"
                    aria-label="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>

          {done.length > 0 && (
            <button
              data-testid="todo-toggle-done"
              onClick={() => setShowDone(v => !v)}
              className="mt-4 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              {showDone ? `Hide ${done.length} completed` : `Show ${done.length} completed`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function MyAssignments() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("tasks");
  const [showClosedLeads, setShowClosedLeads] = useState(false);
  const [showDoneCustomers, setShowDoneCustomers] = useState(false);
  const [employeeScope, setEmployeeScope] = useState("mine");
  const [urgencyScope, setUrgencyScope] = useState("open");
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const { user, myStaffProfile, myCompany, staffProfiles = [], isAdmin: roleAdmin } = useRoleBasedData();

  const myEmail = user?.email;
  const myName = myStaffProfile?.full_name;
  const companyId = myCompany?.id || myStaffProfile?.company_id;
  useEffect(() => {
    setEmployeeScope("mine");
    setUrgencyScope("open");
    setAssignmentSearch("");
  }, [companyId]);
  const isCompanyManager = !!myCompany && (myCompany.created_by === myEmail ||
    (myStaffProfile?.company_id === myCompany.id && myStaffProfile?.is_administrator === true));
  const canManageTeam = !!roleAdmin && isCompanyManager;
  const activeStaffProfiles = staffProfiles.filter(profile => profile.company_id === companyId && profile.is_active !== false && profile.user_email);
  const scopeKey = canManageTeam ? `company:${companyId}` : `personal:${myEmail}`;
  const selectedScope = canManageTeam ? employeeScope : "mine";
  const enabled = !!myEmail && !!companyId;

  const { data: taskRecords = [], isLoading: loadingTasks, isError: tasksError } = useQuery({
    queryKey: [canManageTeam ? "company-assignments-tasks" : "my-assignments-tasks", scopeKey, myEmail, companyId],
    queryFn: () => fetchAssignmentRecords(companyId, "Task"),
    enabled,
    staleTime: 60_000,
  });

  const { data: leadRecords = [], isLoading: loadingLeads, isError: leadsError } = useQuery({
    queryKey: [canManageTeam ? "company-assignments-leads" : "my-assignments-leads", scopeKey, myEmail, companyId],
    queryFn: () => fetchAssignmentRecords(companyId, "Lead"),
    enabled,
    staleTime: 60_000,
  });

  const { data: customerRecords = [], isLoading: loadingCustomers, isError: customersError } = useQuery({
    queryKey: [canManageTeam ? "company-assignments-customers" : "my-assignments-customers", scopeKey, myEmail, companyId],
    queryFn: () => fetchAssignmentRecords(companyId, "Customer"),
    enabled,
    staleTime: 60_000,
  });

  const completionCandidatesKey = ["my-assignments-completion-candidates", myEmail, companyId];
  const {
    data: completionCandidates = [],
    isLoading: loadingCompletionCandidates,
    isError: completionCandidatesError,
  } = useQuery({
    queryKey: completionCandidatesKey,
    queryFn: async () => {
      const response = await base44.functions.invoke("getCustomerCompletionCandidates", { company_id: companyId });
      const payload = response?.data;
      if (!payload?.success) throw new Error(payload?.error || "Could not check customer completion status");
      return Array.isArray(payload.candidates) ? payload.candidates : [];
    },
    enabled,
    staleTime: 60_000,
    retry: 1,
  });

  const { data: projectRecords = [], isLoading: loadingProjects, isError: projectsError } = useQuery({
    queryKey: [canManageTeam ? "company-assignments-projects" : "my-assignments-projects", scopeKey, myEmail, companyId],
    queryFn: () => fetchAssignmentRecords(companyId, "Project"),
    enabled,
    staleTime: 60_000,
  });

  const scopedRecords = (records) => records.filter(record =>
    matchesEmployeeScope(record, selectedScope, user, activeStaffProfiles) &&
    (!assignmentSearch.trim() || JSON.stringify(record).toLowerCase().includes(assignmentSearch.trim().toLowerCase())) &&
    (urgencyScope === "open" || dateUrgency(record.due_date) === urgencyScope)
  );
  const tasks = scopedRecords(taskRecords);
  const leads = scopedRecords(leadRecords);
  const customers = scopedRecords(customerRecords);
  const projects = scopedRecords(projectRecords);
  const updateDueDate = async (kind, record, date) => {
    try {
      await base44.entities[kind].update(record.id, { due_date: date });
      toast.success("Due date updated");
      queryClient.invalidateQueries({ queryKey: assignmentKey(`${kind.toLowerCase()}s`) });
    } catch { toast.error("Could not update due date"); }
  };

  const assignmentKey = (kind) => [canManageTeam ? `company-assignments-${kind}` : `my-assignments-${kind}`, scopeKey, myEmail, companyId];
  const updateOwnerMutation = useMutation({
    mutationFn: ({ kind, id, email, name }) => base44.entities[kind].update(id, assignmentOwnerPatch(email, name)),
    onSuccess: async (_data, { kind, email, id }) => {
      toast.success(email ? "Assignment handed off" : "Assignment cleared");
      const collection = `${kind.toLowerCase()}s`;
      await queryClient.invalidateQueries({ queryKey: assignmentKey(collection) });
      await queryClient.invalidateQueries({ queryKey: ["my-assignments-" + collection] });
      await queryClient.invalidateQueries({ queryKey: ["company-assignments-" + collection] });
      try {
        const response = await base44.functions.invoke("universalNotificationDispatcher", {
          action: "assignment_changed", entityType: kind, entityId: id, companyId,
        });
        const result = response?.data;
        if (!result?.success || result.errorCount) toast.warning("Assignment saved, but some handoff notices could not be sent.");
      } catch (error) {
        console.warn("Assignment notification dispatch failed", error);
        toast.warning("Assignment saved, but handoff notices could not be sent.");
      }
    },
    onError: () => toast.error("Could not update assignment"),
  });

  const updateLeadStatusMutation = useMutation({
    mutationFn: ({ id, status }) => base44.entities.Lead.update(id, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: assignmentKey("leads") });
      const prev = queryClient.getQueryData(assignmentKey("leads"));
      queryClient.setQueryData(assignmentKey("leads"), (old = []) =>
        old.map(l => l.id === id ? { ...l, status } : l)
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      queryClient.setQueryData(assignmentKey("leads"), ctx.prev);
      toast.error("Failed to update lead status");
    },
    onSuccess: (_, { status }) => {
      toast.success(`Lead status updated to ${status}`);
      queryClient.invalidateQueries({ queryKey: assignmentKey("leads") });
    },
  });

  const updateCustomerStatusMutation = useMutation({
    mutationFn: ({ id, status }) => base44.entities.Customer.update(id, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: assignmentKey("customers") });
      const prev = queryClient.getQueryData(assignmentKey("customers"));
      queryClient.setQueryData(assignmentKey("customers"), (old = []) =>
        old.map(c => c.id === id ? { ...c, status } : c)
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      queryClient.setQueryData(assignmentKey("customers"), ctx.prev);
      toast.error("Failed to update customer status");
    },
    onSuccess: (_, { status }) => {
      toast.success(`Customer status updated to ${status}`);
      queryClient.invalidateQueries({ queryKey: assignmentKey("customers") });
    },
  });

  const completionDecisionMutation = useMutation({
    mutationFn: async ({ candidate, decision }) => {
      const prompt = {
        status: decision,
        decided_at: new Date().toISOString(),
        decided_by: myEmail || null,
        reason: "paid_in_full_no_active_work",
      };
      return base44.entities.Customer.update(candidate.customer_id, {
        ...(decision === "completed" ? { status: "completed" } : {}),
        data: { completion_prompt: prompt },
      });
    },
    onMutate: async ({ candidate, decision }) => {
      await queryClient.cancelQueries({ queryKey: completionCandidatesKey });
      await queryClient.cancelQueries({ queryKey: assignmentKey("customers") });
      const previousCandidates = queryClient.getQueryData(completionCandidatesKey);
      const previousCustomers = queryClient.getQueryData(assignmentKey("customers"));
      queryClient.setQueryData(
        completionCandidatesKey,
        (old = []) => old.filter(item => item.customer_id !== candidate.customer_id),
      );
      if (decision === "completed") {
        queryClient.setQueryData(
          assignmentKey("customers"),
          (old = []) => old.map(customer => customer.id === candidate.customer_id
            ? { ...customer, status: "completed" }
            : customer),
        );
      }
      return { previousCandidates, previousCustomers };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(completionCandidatesKey, context?.previousCandidates || []);
      queryClient.setQueryData(assignmentKey("customers"), context?.previousCustomers || []);
      toast.error("Could not save the customer completion decision");
    },
    onSuccess: (_result, { candidate, decision }) => {
      toast.success(
        decision === "completed"
          ? `${candidate.customer_name} marked Completed`
          : `${candidate.customer_name} will stay Active`,
      );
      queryClient.invalidateQueries({ queryKey: completionCandidatesKey });
      queryClient.invalidateQueries({ queryKey: assignmentKey("customers") });
    },
  });

  const handleSendEstimate = async (lead) => {
    try {
      // First check if this lead already has an estimate
      const existing = await base44.entities.Estimate.filter({ lead_id: lead.id }, "-created_date", 1);
      if (existing && existing.length > 0) {
        navigate(createPageUrl("EstimateEditor") + "?estimate_id=" + existing[0].id);
        return;
      }
      // No existing estimate — create a new one pre-filled with lead info
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + 30);
      const newEstimate = await base44.entities.Estimate.create({
        company_id: companyId,
        lead_id: lead.id,
        customer_name: lead.full_name || lead.name || lead.company_name || "",
        customer_email: lead.email || "",
        customer_phone: lead.phone || "",
        property_address: lead.property_address || lead.address || "",
        insurance_company: lead.insurance_company || "",
        claim_number: lead.claim_number || "",
        status: "draft",
        valid_until: validUntil.toISOString().split('T')[0],
        amount: 0,
        items: [],
      });
      navigate(createPageUrl("EstimateEditor") + "?estimate_id=" + newEstimate.id);
    } catch (err) {
      console.error("Failed to open/create estimate:", err);
    }
  };

  const activeLeads = leads.filter(l => !LEAD_CLOSED_STATUSES.includes(l.status));
  const closedLeads = leads.filter(l => LEAD_CLOSED_STATUSES.includes(l.status));
  const visibleLeads = showClosedLeads ? leads : activeLeads;

  const activeCustomers = customers.filter(c => !CUSTOMER_DONE_STATUSES.includes(c.status));
  const doneCustomers = customers.filter(c => CUSTOMER_DONE_STATUSES.includes(c.status));
  const visibleCustomers = showDoneCustomers ? customers : activeCustomers;

  const counts = {
    tasks: tasks.filter(t => t.status !== "done" && t.status !== "completed").length,
    leads: activeLeads.length,
    customers: activeCustomers.length,
    projects: projects.filter(p => !["completed", "closed"].includes(p.status)).length,
  };

  const { data: todoForBadge = [] } = useQuery({
    queryKey: ["personal-todos", myEmail, companyId],
    queryFn: () =>
      base44.entities.PersonalTodo.filter(
        { user_email: myEmail, company_id: companyId },
        "created_date",
        500
      ),
    enabled: !!myEmail && !!companyId,
    staleTime: 30_000,
  });
  const todoOverdueCount = todoForBadge.filter(t => {
    if (t.is_done || !t.due_date) return false;
    return startOfDay(new Date(t.due_date)) < startOfDay(new Date());
  }).length;

  const tabDef = [
    { key: "tasks", label: "Tasks", icon: ClipboardList, count: counts.tasks },
    { key: "leads", label: "Leads", icon: UserPlus, count: counts.leads },
    { key: "customers", label: "Customers", icon: Users, count: counts.customers },
    { key: "projects", label: "Projects", icon: Briefcase, count: counts.projects },
    { key: "mytodo", label: "My To-Do", icon: ListTodo, count: todoOverdueCount, urgent: todoOverdueCount > 0 },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100" data-testid="my-assignments-title">
            My Assignments
          </h1>
          {myStaffProfile?.full_name && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Showing everything assigned to {myStaffProfile.full_name}
            </p>
          )}
        </div>

        {canManageTeam && (
          <div className="mb-4 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
              Employee
              <select aria-label="Employee scope" value={employeeScope} onChange={e => setEmployeeScope(e.target.value)} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                <option value="mine">Mine</option><option value="all">All team</option><option value="unassigned">Unassigned</option>
                {activeStaffProfiles.filter(p => p.user_email !== myEmail).map(p => <option key={p.id} value={p.user_email}>{p.full_name || p.user_email}</option>)}
              </select>
            </label>
            <select aria-label="Due status filter" value={urgencyScope} onChange={e => setUrgencyScope(e.target.value)} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900">
              <option value="open">All open / any date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="upcoming">Upcoming</option>
            </select>
            <Input aria-label="Search assignments" placeholder="Search assignments" value={assignmentSearch} onChange={e => setAssignmentSearch(e.target.value)} className="h-8 min-w-0 text-xs sm:max-w-56" />
          </div>
        )}
        {!canManageTeam && (
          <div className="mb-4 flex flex-wrap gap-2">
            <select aria-label="Due status filter" value={urgencyScope} onChange={e => setUrgencyScope(e.target.value)} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900">
              <option value="open">All open / any date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="upcoming">Upcoming</option>
            </select>
            <Input aria-label="Search assignments" placeholder="Search assignments" value={assignmentSearch} onChange={e => setAssignmentSearch(e.target.value)} className="h-8 min-w-0 text-xs sm:max-w-56" />
          </div>
        )}
        {canManageTeam && (
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <span><strong>{taskRecords.filter(task => actionableTask(task) && dateUrgency(task.due_date) === "overdue").length}</strong> overdue tasks</span>
            <span><strong>{[...taskRecords, ...leadRecords, ...customerRecords, ...projectRecords].filter(record => !record.is_deleted && !record.is_archived && !record.is_completed && hasNoAssignment(record)).length}</strong> unassigned records</span>
          </div>
        )}
        {(tasksError || leadsError || customersError || projectsError) && (
          <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            Some assignments could not be loaded. Successfully loaded items remain available; refresh to retry.
          </div>
        )}
        {[taskRecords, leadRecords, customerRecords, projectRecords].some(records => records.isTruncated) && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            At least one list reached its 500-record limit. Counts and results may be incomplete.
          </div>
        )}

        {loadingCompletionCandidates && enabled && (
          <div
            data-testid="customer-completion-checking"
            className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
          >
            Checking your assigned customers for completed, paid-in-full work…
          </div>
        )}

        {completionCandidatesError && (
          <div
            data-testid="customer-completion-error"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300"
          >
            We couldn’t check for completed customer assignments right now. Your existing assignments are still available below.
          </div>
        )}

        {!loadingCompletionCandidates && !completionCandidatesError && completionCandidates.length > 0 && (
          <CompletionReview
            candidates={completionCandidates}
            onDecision={(candidate, decision) => completionDecisionMutation.mutate({ candidate, decision })}
            isPending={completionDecisionMutation.isPending}
          />
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <div className="mb-4 overflow-x-auto -mx-1 px-1 pb-1">
            <TabsList className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 rounded-lg inline-flex w-auto min-w-full">
              {tabDef.map(({ key, label, icon: Icon, count, urgent }) => (
                <TabsTrigger
                  key={key}
                  value={key}
                  data-testid={`tab-${key}`}
                  className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap px-3"
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {label}
                  {count > 0 && (
                    <span className={`inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full text-xs font-semibold ${
                      urgent
                        ? "bg-red-500 text-white animate-pulse"
                        : "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                    }`}>
                      {count}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <Card className="border border-slate-200 dark:border-slate-800 shadow-none rounded-xl overflow-hidden">
            <CardContent className="p-0">

              <TabsContent value="tasks" className="m-0">
                {loadingTasks ? <LoadingRows /> : tasks.length === 0 ? (
                  <EmptyState icon={ClipboardList} label="tasks" />
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {tasks.map(task => (
                      <TaskRow
                        key={task.id}
                          task={task}
                          owner={canManageTeam ? (task.assigned_to_name || task.assigned_to_email || task.assigned_to || "Unassigned") : null}
                        onClick={() => navigate(createPageUrl("Tasks") + `?task_id=${task.id}`)}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="leads" className="m-0">
                {loadingLeads ? <LoadingRows /> : activeLeads.length === 0 && closedLeads.length === 0 ? (
                  <EmptyState icon={UserPlus} label="leads" />
                ) : (
                  <>
                    {visibleLeads.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-600 gap-3">
                        <UserPlus className="w-10 h-10 opacity-30" />
                        <p className="text-sm">All leads are closed</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {visibleLeads.map(lead => (
                          <LeadRow
                            key={lead.id}
                            lead={lead}
                            onStatusChange={status => updateLeadStatusMutation.mutate({ id: lead.id, status })}
                            onSendEstimate={() => handleSendEstimate(lead)}
                            onClick={() => navigate(createPageUrl("LeadProfile") + `?id=${lead.id}`)}
                            ownerControl={canManageTeam ? <OwnerControl record={lead} staffProfiles={activeStaffProfiles} onAssign={(email, name) => updateOwnerMutation.mutate({ kind: "Lead", id: lead.id, email, name })} onDueDate={date => updateDueDate("Lead", lead, date)} /> : null}
                          />
                        ))}
                      </div>
                    )}
                    {closedLeads.length > 0 && (
                      <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800">
                        <button
                          data-testid="toggle-closed-leads"
                          onClick={() => setShowClosedLeads(v => !v)}
                          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                        >
                          {showClosedLeads ? `Hide ${closedLeads.length} closed` : `Show ${closedLeads.length} closed`}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </TabsContent>

              <TabsContent value="customers" className="m-0">
                {loadingCustomers ? <LoadingRows /> : activeCustomers.length === 0 && doneCustomers.length === 0 ? (
                  <EmptyState icon={Users} label="customers" />
                ) : (
                  <>
                    {visibleCustomers.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-600 gap-3">
                        <Users className="w-10 h-10 opacity-30" />
                        <p className="text-sm">All customers are completed</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {visibleCustomers.map(customer => (
                          <CustomerRow
                            key={customer.id}
                            customer={customer}
                            onStatusChange={status => updateCustomerStatusMutation.mutate({ id: customer.id, status })}
                            onClick={() => navigate(createPageUrl("CustomerProfile") + `?id=${customer.id}`)}
                            ownerControl={canManageTeam ? <OwnerControl record={customer} staffProfiles={activeStaffProfiles} onAssign={(email, name) => updateOwnerMutation.mutate({ kind: "Customer", id: customer.id, email, name })} onDueDate={date => updateDueDate("Customer", customer, date)} /> : null}
                          />
                        ))}
                      </div>
                    )}
                    {doneCustomers.length > 0 && (
                      <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800">
                        <button
                          data-testid="toggle-done-customers"
                          onClick={() => setShowDoneCustomers(v => !v)}
                          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                        >
                          {showDoneCustomers ? `Hide ${doneCustomers.length} completed` : `Show ${doneCustomers.length} completed`}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </TabsContent>

              <TabsContent value="projects" className="m-0">
                {loadingProjects ? <LoadingRows /> : projects.length === 0 ? (
                  <EmptyState icon={Briefcase} label="projects" />
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {projects.map(project => (
                      <ProjectRow
                        key={project.id}
                        project={project}
                        onClick={() => navigate(createPageUrl("Projects") + `?project=${project.id}`)}
                        ownerControl={canManageTeam ? <OwnerControl record={project} staffProfiles={activeStaffProfiles} onAssign={(email, name) => updateOwnerMutation.mutate({ kind: "Project", id: project.id, email, name })} onDueDate={date => updateDueDate("Project", project, date)} /> : null}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="mytodo" className="m-0">
                <PersonalToDoTab myEmail={myEmail} companyId={companyId} />
              </TabsContent>

            </CardContent>
          </Card>
        </Tabs>
      </div>
    </div>
  );
}
