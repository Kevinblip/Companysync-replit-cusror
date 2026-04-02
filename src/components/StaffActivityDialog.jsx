import React, { useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Users,
  UserCheck,
  FileText,
  CheckSquare,
  Phone,
  Mail,
  Camera,
  MessageSquare,
  ClipboardList,
} from "lucide-react";
import { formatDistanceToNow, parseISO, isValid } from "date-fns";

const SINCE_DAYS = 60;

function sinceDate() {
  const d = new Date();
  d.setDate(d.getDate() - SINCE_DAYS);
  return d.toISOString();
}

function safeDate(val) {
  if (!val) return null;
  try {
    const d = typeof val === "string" ? parseISO(val) : new Date(val);
    return isValid(d) ? d : null;
  } catch {
    return null;
  }
}

function timeAgo(val) {
  const d = safeDate(val);
  if (!d) return "";
  return formatDistanceToNow(d, { addSuffix: true });
}

const TYPE_META = {
  lead_created:      { label: "Created lead",       color: "bg-blue-100 text-blue-700",   icon: Users },
  lead_assigned:     { label: "Assigned lead",       color: "bg-indigo-100 text-indigo-700", icon: UserCheck },
  customer_created:  { label: "Created customer",    color: "bg-green-100 text-green-700", icon: UserCheck },
  task_created:      { label: "Created task",        color: "bg-yellow-100 text-yellow-800", icon: CheckSquare },
  task_assigned:     { label: "Task assigned",       color: "bg-orange-100 text-orange-700", icon: CheckSquare },
  note:              { label: "Note / communication",color: "bg-gray-100 text-gray-700",   icon: MessageSquare },
  call:              { label: "Call logged",         color: "bg-purple-100 text-purple-700", icon: Phone },
  email:             { label: "Email sent",          color: "bg-teal-100 text-teal-700",   icon: Mail },
  estimate:          { label: "Created estimate",    color: "bg-pink-100 text-pink-700",   icon: FileText },
  inspection:        { label: "Inspection job",      color: "bg-cyan-100 text-cyan-700",   icon: Camera },
};

function ActivityItem({ type, title, subtitle, date }) {
  const meta = TYPE_META[type] || { label: type, color: "bg-gray-100 text-gray-600", icon: ClipboardList };
  const Icon = meta.icon;
  return (
    <div className="flex gap-3 py-3 border-b border-gray-100 last:border-0">
      <div className={`mt-0.5 flex-shrink-0 p-1.5 rounded-full ${meta.color}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className={`text-xs px-1.5 py-0 ${meta.color} border-0`}>
            {meta.label}
          </Badge>
          <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
            {timeAgo(date)}
          </span>
        </div>
        <p className="text-sm font-medium text-gray-800 mt-0.5 truncate">{title}</p>
        {subtitle && <p className="text-xs text-gray-500 truncate">{subtitle}</p>}
      </div>
    </div>
  );
}

export default function StaffActivityDialog({ member, companyId, onClose }) {
  const open = !!member;
  const email = member?.email || member?.user_email;

  const { data: leads = [], isLoading: loadLeads } = useQuery({
    queryKey: ["staff-activity-leads", email, companyId],
    queryFn: () =>
      companyId
        ? base44.entities.Lead.filter({ company_id: companyId }, "-created_date", 200)
        : [],
    enabled: open && !!companyId,
    staleTime: 60_000,
  });

  const { data: customers = [], isLoading: loadCustomers } = useQuery({
    queryKey: ["staff-activity-customers", email, companyId],
    queryFn: () =>
      companyId
        ? base44.entities.Customer.filter({ company_id: companyId }, "-created_at", 200)
        : [],
    enabled: open && !!companyId,
    staleTime: 60_000,
  });

  const { data: tasks = [], isLoading: loadTasks } = useQuery({
    queryKey: ["staff-activity-tasks", email, companyId],
    queryFn: () =>
      companyId
        ? base44.entities.Task.filter({ company_id: companyId }, "-created_date", 200)
        : [],
    enabled: open && !!companyId,
    staleTime: 60_000,
  });

  const { data: comms = [], isLoading: loadComms } = useQuery({
    queryKey: ["staff-activity-comms", email, companyId],
    queryFn: () =>
      companyId
        ? base44.entities.Communication.filter({ company_id: companyId }, "-created_date", 200)
        : [],
    enabled: open && !!companyId,
    staleTime: 60_000,
  });

  const { data: estimates = [], isLoading: loadEstimates } = useQuery({
    queryKey: ["staff-activity-estimates", email, companyId],
    queryFn: () =>
      companyId
        ? base44.entities.Estimate.filter({ company_id: companyId }, "-created_date", 200)
        : [],
    enabled: open && !!companyId,
    staleTime: 60_000,
  });

  const { data: inspections = [], isLoading: loadInspections } = useQuery({
    queryKey: ["staff-activity-inspections", email, companyId],
    queryFn: () =>
      companyId
        ? base44.entities.InspectionJob.filter({ company_id: companyId }, "-created_date", 200)
        : [],
    enabled: open && !!companyId,
    staleTime: 60_000,
  });

  const isLoading = loadLeads || loadCustomers || loadTasks || loadComms || loadEstimates || loadInspections;

  const events = useMemo(() => {
    if (!email) return [];
    const items = [];

    leads.forEach((l) => {
      if (l.created_by === email) {
        items.push({ type: "lead_created", title: l.name || "Unnamed Lead", subtitle: l.address || l.phone, date: l.created_date || l.created_at, _d: safeDate(l.created_date || l.created_at) });
      }
      if (l.assigned_to === email || l.assigned_to_users?.includes(email)) {
        if (l.created_by !== email) {
          items.push({ type: "lead_assigned", title: l.name || "Unnamed Lead", subtitle: l.address || l.phone, date: l.created_date || l.created_at, _d: safeDate(l.created_date || l.created_at) });
        }
      }
    });

    customers.forEach((c) => {
      if (c.created_by === email) {
        items.push({ type: "customer_created", title: c.name || "Unnamed Customer", subtitle: c.address || c.email, date: c.created_at || c.created_date, _d: safeDate(c.created_at || c.created_date) });
      }
    });

    tasks.forEach((t) => {
      if (t.created_by === email) {
        items.push({ type: "task_created", title: t.title || t.name || "Task", subtitle: t.status, date: t.created_date || t.created_at, _d: safeDate(t.created_date || t.created_at) });
      } else if (t.assigned_to === email || t.assignees?.some((a) => a?.email === email)) {
        items.push({ type: "task_assigned", title: t.title || t.name || "Task", subtitle: t.status, date: t.created_date || t.created_at, _d: safeDate(t.created_date || t.created_at) });
      }
    });

    comms.forEach((c) => {
      if (c.created_by !== email) return;
      const type = c.type === "call" ? "call" : c.type === "email" ? "email" : "note";
      items.push({ type, title: c.subject || c.notes?.slice(0, 60) || "Communication", subtitle: c.customer_name || c.lead_name, date: c.created_date || c.created_at, _d: safeDate(c.created_date || c.created_at) });
    });

    estimates.forEach((e) => {
      if (e.created_by === email) {
        items.push({ type: "estimate", title: `Estimate for ${e.customer_name || "unknown"}`, subtitle: e.status, date: e.created_date || e.created_at, _d: safeDate(e.created_date || e.created_at) });
      }
    });

    inspections.forEach((j) => {
      if (j.created_by === email || j.assigned_to_email === email) {
        items.push({ type: "inspection", title: j.job_name || j.address || "Inspection", subtitle: j.status, date: j.created_date || j.created_at, _d: safeDate(j.created_date || j.created_at) });
      }
    });

    items.sort((a, b) => {
      if (!a._d && !b._d) return 0;
      if (!a._d) return 1;
      if (!b._d) return -1;
      return b._d - a._d;
    });

    return items.slice(0, 100);
  }, [email, leads, customers, tasks, comms, estimates, inspections]);

  const summary = useMemo(() => {
    if (!email) return {};
    return {
      leadsCreated: leads.filter((l) => l.created_by === email).length,
      leadsAssigned: leads.filter((l) => l.assigned_to === email || l.assigned_to_users?.includes(email)).length,
      customersCreated: customers.filter((c) => c.created_by === email).length,
      tasksCreated: tasks.filter((t) => t.created_by === email).length,
      commsLogged: comms.filter((c) => c.created_by === email).length,
      estimatesCreated: estimates.filter((e) => e.created_by === email).length,
    };
  }, [email, leads, customers, tasks, comms, estimates]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarImage src={member?.avatar_url} />
              <AvatarFallback>{member?.full_name?.charAt(0)?.toUpperCase() || "?"}</AvatarFallback>
            </Avatar>
            <div>
              <DialogTitle>{member?.full_name || "Staff Member"} — Activity</DialogTitle>
              <DialogDescription>{email}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Summary counts */}
        {!isLoading && (
          <div className="flex-shrink-0 grid grid-cols-3 gap-2 py-2">
            {[
              { label: "Leads Created", value: summary.leadsCreated },
              { label: "Leads Assigned", value: summary.leadsAssigned },
              { label: "Customers", value: summary.customersCreated },
              { label: "Tasks", value: summary.tasksCreated },
              { label: "Comms Logged", value: summary.commsLogged },
              { label: "Estimates", value: summary.estimatesCreated },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-50 rounded-lg p-2 text-center">
                <p className="text-xl font-bold text-gray-900">{value}</p>
                <p className="text-xs text-gray-500 leading-tight">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Timeline */}
        <div className="flex-1 min-h-0">
          <p className="text-xs text-gray-500 mb-2 flex-shrink-0">Recent activity (last {SINCE_DAYS} days)</p>
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">Loading activity…</div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-sm gap-2">
              <ClipboardList className="w-8 h-8 text-gray-300" />
              <p>No activity found for this staff member.</p>
            </div>
          ) : (
            <ScrollArea className="h-[340px] pr-2">
              {events.map((ev, i) => (
                <ActivityItem key={i} type={ev.type} title={ev.title} subtitle={ev.subtitle} date={ev.date} />
              ))}
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
