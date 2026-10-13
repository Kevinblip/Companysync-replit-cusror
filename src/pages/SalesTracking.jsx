import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  Mail, Phone, DollarSign, TrendingUp, Target, Users, Calendar,
  Search, Download, Award, AlertTriangle, Clock, CheckCircle2,
  Activity, ChevronRight, Flame, Shield
} from "lucide-react";
import { format, formatDistanceToNow, parseISO, isValid } from "date-fns";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import StaffActivityDialog from "@/components/StaffActivityDialog";
import { localToday } from "@/utils/localDate";

const STALE_DAYS = 7;
const NEGLECT_DAYS = 14;

function safeDate(val) {
  if (!val) return null;
  try {
    const d = typeof val === "string" ? parseISO(val) : new Date(val);
    return isValid(d) ? d : null;
  } catch { return null; }
}

function daysSince(val) {
  const d = safeDate(val);
  if (!d) return 999;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

export default function SalesTracking() {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  const [activeView, setActiveView] = useState("pipeline");
  const [activityMember, setActivityMember] = useState(null);

  const queryClient = useQueryClient();
  const { company: myCompany } = useCurrentCompany(user);

  const { data: allStaffProfiles = [] } = useQuery({
    queryKey: ['all-staff-profiles', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['leads', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }, "-created_date") : [],
    enabled: !!myCompany,
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Invoice.filter({ company_id: myCompany.id }, "-created_date") : [],
    enabled: !!myCompany,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks-health', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Task.filter({ company_id: myCompany.id }, "-created_date", 500) : [],
    enabled: !!myCompany?.id && activeView === "health",
    staleTime: 120_000,
  });

  const { data: actionItems = [] } = useQuery({
    queryKey: ['action-items-health', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.ActionItem.filter({ company_id: myCompany.id }, "-created_date", 500) : [],
    enabled: !!myCompany?.id && activeView === "health",
    staleTime: 120_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Lead.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['my-assignments-leads'] });
    },
  });

  const columns = [
    { id: 'new', title: 'New Leads', color: '#3b82f6', bgColor: 'bg-blue-50', borderColor: 'border-blue-300' },
    { id: 'contacted', title: 'Contacted', color: '#f59e0b', bgColor: 'bg-amber-50', borderColor: 'border-amber-300' },
    { id: 'qualified', title: 'Qualified', color: '#8b5cf6', bgColor: 'bg-purple-50', borderColor: 'border-purple-300' },
    { id: 'proposal', title: 'Proposal', color: '#ec4899', bgColor: 'bg-pink-50', borderColor: 'border-pink-300' },
    { id: 'negotiation', title: 'Negotiation', color: '#f97316', bgColor: 'bg-orange-50', borderColor: 'border-orange-300' },
    { id: 'won', title: 'Won', color: '#22c55e', bgColor: 'bg-green-50', borderColor: 'border-green-300' },
  ];

  const filteredLeads = leads.filter(lead => {
    if (searchTerm && !lead.name?.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !lead.company?.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (filterAssignee !== "all" && lead.assigned_to !== filterAssignee) return false;
    if (filterSource !== "all" && lead.source !== filterSource) return false;
    if (dateRange !== "all" && lead.created_date) {
      const daysDiff = daysSince(lead.created_date);
      if (dateRange === "7days" && daysDiff > 7) return false;
      if (dateRange === "30days" && daysDiff > 30) return false;
      if (dateRange === "90days" && daysDiff > 90) return false;
    }
    return true;
  });

  const totalLeads = filteredLeads.length;
  const totalValue = filteredLeads.reduce((sum, l) => sum + Number(l.value || 0), 0);
  const wonLeads = filteredLeads.filter(l => l.status === 'won').length;
  const conversionRate = totalLeads > 0 ? ((wonLeads / totalLeads) * 100).toFixed(1) : 0;
  const avgDealSize = wonLeads > 0
    ? (filteredLeads.filter(l => l.status === 'won').reduce((sum, l) => sum + Number(l.value || 0), 0) / wonLeads).toFixed(0)
    : 0;

  const teamPerformance = allStaffProfiles.map(staff => {
    const staffLeads = filteredLeads.filter(l => l.assigned_to === staff.user_email);
    const staffWon = staffLeads.filter(l => l.status === 'won').length;
    const staffRevenue = invoices
      .filter(i => i.sale_agent === staff.user_email && i.status === 'paid')
      .reduce((sum, i) => sum + Number(i.amount || 0), 0);
    return {
      name: staff.full_name,
      email: staff.user_email,
      avatar: staff.avatar_url,
      leads: staffLeads.length,
      won: staffWon,
      revenue: staffRevenue,
      conversionRate: staffLeads.length > 0 ? ((staffWon / staffLeads.length) * 100).toFixed(1) : 0
    };
  }).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  // ── Team Health metrics ──────────────────────────────────────────────────
  const activeLeads = useMemo(
    () => leads.filter(l => !['won', 'lost'].includes(l.status)),
    [leads]
  );

  const now = new Date();

  const repHealth = useMemo(() => {
    return allStaffProfiles.map(staff => {
      const email = staff.user_email;
      const repLeads = activeLeads.filter(
        l => l.assigned_to === email || l.assigned_to_users?.includes(email)
      );
      const staleLeads = repLeads.filter(l => daysSince(l.updated_date || l.created_date) >= STALE_DAYS);
      const neglectedLeads = repLeads.filter(l => daysSince(l.updated_date || l.created_date) >= NEGLECT_DAYS);

      const repTasks = tasks.filter(t =>
        (t.assigned_to === email || t.assignees?.some(a => a?.email === email)) &&
        !['completed', 'done', 'closed'].includes((t.status || '').toLowerCase())
      );

      const repActionItems = actionItems.filter(ai =>
        (ai.assigned_to === email || ai.created_by === email) &&
        (ai.status === 'active' || !ai.status) &&
        ai.due_date && new Date(ai.due_date) < now
      );

      const lastActive = repLeads.reduce((latest, l) => {
        const d = l.updated_date || l.created_date;
        if (!d) return latest;
        return !latest || new Date(d) > new Date(latest) ? d : latest;
      }, null);

      const healthScore =
        neglectedLeads.length > 3 || repActionItems.length > 5 ? 'critical' :
        neglectedLeads.length > 0 || repActionItems.length > 0 || staleLeads.length > 3 ? 'warning' :
        'good';

      return { ...staff, email, repLeads, staleLeads, neglectedLeads, repTasks, repActionItems, lastActive, healthScore };
    }).filter(r => r.repLeads.length > 0 || r.repTasks.length > 0)
      .sort((a, b) => {
        const order = { critical: 0, warning: 1, good: 2 };
        return order[a.healthScore] - order[b.healthScore];
      });
  }, [allStaffProfiles, activeLeads, tasks, actionItems]);

  const needsAttention = useMemo(() => {
    return activeLeads
      .filter(l => l.assigned_to)
      .map(l => {
        const ds = daysSince(l.updated_date || l.created_date);
        const repName = allStaffProfiles.find(s => s.user_email === l.assigned_to)?.full_name || l.assigned_to;
        return { ...l, daysSince: ds, repName };
      })
      .filter(l => l.daysSince >= STALE_DAYS)
      .sort((a, b) => b.daysSince - a.daysSince)
      .slice(0, 12);
  }, [activeLeads, allStaffProfiles]);

  const unassignedLeads = useMemo(
    () => activeLeads.filter(l => !l.assigned_to),
    [activeLeads]
  );
  // ────────────────────────────────────────────────────────────────────────

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const leadId = result.draggableId;
    const newStatus = result.destination.droppableId;
    const lead = leads.find(l => l.id === leadId);
    if (lead && lead.status !== newStatus) {
      updateMutation.mutate({ id: leadId, data: { ...lead, status: newStatus } });
    }
  };

  const exportToCSV = () => {
    const headers = ['Name', 'Company', 'Status', 'Value', 'Source', 'Assigned To', 'Created Date'];
    const rows = filteredLeads.map(lead => [
      lead.name, lead.company || '', lead.status, lead.value || 0, lead.source || '',
      allStaffProfiles.find(s => s.user_email === lead.assigned_to)?.full_name || '',
      lead.created_date ? format(new Date(lead.created_date), 'yyyy-MM-dd') : ''
    ]);
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-pipeline-${localToday()}.csv`;
    a.click();
  };

  const healthColor = {
    good: 'border-l-green-400 bg-green-50',
    warning: 'border-l-amber-400 bg-amber-50',
    critical: 'border-l-red-500 bg-red-50',
  };
  const healthBadge = {
    good: 'bg-green-100 text-green-700',
    warning: 'bg-amber-100 text-amber-700',
    critical: 'bg-red-100 text-red-700',
  };
  const healthIcon = {
    good: <CheckCircle2 className="w-4 h-4 text-green-500" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-500" />,
    critical: <Flame className="w-4 h-4 text-red-500" />,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Target className="w-8 h-8 text-blue-600" />
            Sales Pipeline Tracker
          </h1>
          <p className="text-gray-500 mt-1">Drag and drop leads to update their status • Real-time team performance</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-white border rounded-lg overflow-hidden shadow-sm">
            <button
              onClick={() => setActiveView("pipeline")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${activeView === "pipeline" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}
              data-testid="tab-pipeline"
            >
              Pipeline
            </button>
            <button
              onClick={() => setActiveView("health")}
              className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${activeView === "health" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}
              data-testid="tab-team-health"
            >
              <Activity className="w-3.5 h-3.5" />
              Team Health
              {needsAttention.length > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold ${activeView === "health" ? "bg-white text-blue-600" : "bg-red-500 text-white"}`}>
                  {needsAttention.length}
                </span>
              )}
            </button>
          </div>
          {activeView === "pipeline" && (
            <Button onClick={exportToCSV} variant="outline" className="gap-2">
              <Download className="w-4 h-4" />
              Export CSV
            </Button>
          )}
        </div>
      </div>

      {/* Key Metrics — always visible */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white border-0 shadow-lg">
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <Target className="w-8 h-8 opacity-80" />
              <span className="text-sm opacity-80">Total Pipeline</span>
            </div>
            <h3 className="text-3xl font-bold">{totalLeads}</h3>
            <p className="text-sm opacity-80 mt-1">${totalValue.toLocaleString()} in value</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white border-0 shadow-lg">
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="w-8 h-8 opacity-80" />
              <span className="text-sm opacity-80">Conversion Rate</span>
            </div>
            <h3 className="text-3xl font-bold">{conversionRate}%</h3>
            <p className="text-sm opacity-80 mt-1">{wonLeads} deals won</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white border-0 shadow-lg">
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <DollarSign className="w-8 h-8 opacity-80" />
              <span className="text-sm opacity-80">Avg Deal Size</span>
            </div>
            <h3 className="text-3xl font-bold">${avgDealSize}</h3>
            <p className="text-sm opacity-80 mt-1">Per closed deal</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white border-0 shadow-lg">
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-8 h-8 opacity-80" />
              <span className="text-sm opacity-80">Active Reps</span>
            </div>
            <h3 className="text-3xl font-bold">{allStaffProfiles.length}</h3>
            <p className="text-sm opacity-80 mt-1">Sales team members</p>
          </CardContent>
        </Card>
      </div>

      {/* ═══════════════════════  PIPELINE VIEW  ═══════════════════════ */}
      {activeView === "pipeline" && (
        <>
          {/* Filters */}
          <Card className="shadow-md">
            <CardContent className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search leads..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                    data-testid="input-search-leads"
                  />
                </div>
                <Select value={filterAssignee} onValueChange={setFilterAssignee}>
                  <SelectTrigger data-testid="select-assignee"><SelectValue placeholder="All Assignees" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Assignees</SelectItem>
                    {allStaffProfiles.filter(s => s.user_email).map(staff => (
                      <SelectItem key={staff.user_email} value={staff.user_email}>{staff.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterSource} onValueChange={setFilterSource}>
                  <SelectTrigger data-testid="select-source"><SelectValue placeholder="All Sources" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sources</SelectItem>
                    <SelectItem value="website">Website</SelectItem>
                    <SelectItem value="referral">Referral</SelectItem>
                    <SelectItem value="social_media">Social Media</SelectItem>
                    <SelectItem value="advertisement">Advertisement</SelectItem>
                    <SelectItem value="cold_call">Cold Call</SelectItem>
                    <SelectItem value="storm_tracker">Storm Tracker</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={dateRange} onValueChange={setDateRange}>
                  <SelectTrigger data-testid="select-date-range"><SelectValue placeholder="All Time" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Time</SelectItem>
                    <SelectItem value="7days">Last 7 Days</SelectItem>
                    <SelectItem value="30days">Last 30 Days</SelectItem>
                    <SelectItem value="90days">Last 90 Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Pipeline Board */}
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              {columns.map((column) => {
                const columnLeads = filteredLeads.filter(l => l.status === column.id);
                const colValue = columnLeads.reduce((sum, l) => sum + Number(l.value || 0), 0);
                return (
                  <Droppable key={column.id} droppableId={column.id}>
                    {(provided, snapshot) => (
                      <Card className={`${snapshot.isDraggingOver ? 'ring-2 ring-blue-400 shadow-xl' : 'shadow-md'} border-t-4 transition-all`} style={{ borderTopColor: column.color }}>
                        <CardHeader className={`${column.bgColor} border-b ${column.borderColor}`}>
                          <CardTitle className="text-sm font-bold flex items-center justify-between">
                            <span style={{ color: column.color }}>{column.title}</span>
                            <Badge variant="secondary" className="bg-white">{columnLeads.length}</Badge>
                          </CardTitle>
                          <div className="text-xs font-bold mt-1" style={{ color: column.color }}>${colValue.toLocaleString()}</div>
                        </CardHeader>
                        <CardContent
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className="p-2 min-h-[500px] space-y-2 bg-gray-50"
                        >
                          {columnLeads.map((lead, index) => {
                            const assignedStaff = allStaffProfiles.find(s => s.user_email === lead.assigned_to);
                            return (
                              <Draggable key={lead.id} draggableId={lead.id} index={index}>
                                {(provided, snapshot) => (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                    className={`bg-white p-3 rounded-lg shadow border hover:shadow-lg transition-all ${snapshot.isDragging ? 'ring-2 ring-blue-400 shadow-2xl rotate-2' : ''}`}
                                  >
                                    <div className="flex items-start justify-between mb-2">
                                      <div className="font-semibold text-sm text-gray-900 flex-1">{lead.name}</div>
                                      {lead.value > 0 && (
                                        <Badge className="bg-green-100 text-green-700 text-xs">${lead.value.toLocaleString()}</Badge>
                                      )}
                                    </div>
                                    {lead.company && <div className="text-xs text-gray-500 mb-2">{lead.company}</div>}
                                    <div className="flex items-center gap-2 text-xs text-gray-600 mb-2">
                                      {lead.email && <Mail className="w-3 h-3" />}
                                      {lead.phone && <Phone className="w-3 h-3" />}
                                      {lead.source && <Badge variant="outline" className="text-xs">{lead.source}</Badge>}
                                    </div>
                                    {assignedStaff && (
                                      <div className="flex items-center gap-2 mt-2 pt-2 border-t">
                                        {assignedStaff.avatar_url ? (
                                          <img src={assignedStaff.avatar_url} alt={assignedStaff.full_name} className="w-5 h-5 rounded-full" />
                                        ) : (
                                          <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs">
                                            {assignedStaff.full_name?.[0] || '?'}
                                          </div>
                                        )}
                                        <span className="text-xs text-gray-600">{assignedStaff.full_name}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </Draggable>
                            );
                          })}
                          {provided.placeholder}
                          {columnLeads.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                              <Target className="w-8 h-8 mb-2" />
                              <p className="text-sm">No leads yet</p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </Droppable>
                );
              })}
            </div>
          </DragDropContext>

          {/* Team Performance Leaderboard */}
          {teamPerformance.length > 0 && (
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="w-5 h-5 text-yellow-500" />
                  Top Performers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {teamPerformance.map((member, index) => (
                    <div key={member.email} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                      <div className="flex items-center gap-3 flex-1">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                          index === 0 ? 'bg-yellow-100 text-yellow-600' :
                          index === 1 ? 'bg-gray-100 text-gray-600' :
                          index === 2 ? 'bg-orange-100 text-orange-600' :
                          'bg-blue-50 text-blue-600'
                        }`}>{index + 1}</div>
                        {member.avatar ? (
                          <img src={member.avatar} alt={member.name} className="w-10 h-10 rounded-full" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold">
                            {member.name?.[0] || '?'}
                          </div>
                        )}
                        <div className="flex-1">
                          <div className="font-semibold text-gray-900">{member.name}</div>
                          <div className="text-sm text-gray-500">{member.leads} leads • {member.won} won</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-green-600">${member.revenue.toLocaleString()}</div>
                        <div className="text-xs text-gray-500">{member.conversionRate}% conversion</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ═══════════════════════  TEAM HEALTH VIEW  ═══════════════════════ */}
      {activeView === "health" && (
        <div className="space-y-6">

          {/* Unassigned leads warning */}
          {unassignedLeads.length > 0 && (
            <Card className="border-l-4 border-l-red-500 bg-red-50 shadow-md">
              <CardContent className="p-4 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
                <div>
                  <span className="font-semibold text-red-700">{unassignedLeads.length} active lead{unassignedLeads.length !== 1 ? 's' : ''} with no rep assigned</span>
                  <span className="text-red-600 text-sm ml-2">— these will fall through the cracks</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Needs Attention list */}
          {needsAttention.length > 0 && (
            <Card className="shadow-md">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-amber-700">
                  <Clock className="w-5 h-5 text-amber-500" />
                  Needs Attention — Stale Leads ({needsAttention.length})
                </CardTitle>
                <p className="text-sm text-gray-500">Active leads that haven't been updated in {STALE_DAYS}+ days, sorted by most neglected first</p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {needsAttention.map(lead => (
                    <div key={lead.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors" data-testid={`stale-lead-${lead.id}`}>
                      <div className={`flex-shrink-0 text-center min-w-[52px]`}>
                        <div className={`text-lg font-bold ${lead.daysSince >= NEGLECT_DAYS ? 'text-red-600' : 'text-amber-600'}`}>{lead.daysSince}d</div>
                        <div className="text-xs text-gray-400">ago</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 truncate">{lead.name}</div>
                        <div className="text-xs text-gray-500 truncate">{lead.address || lead.phone || lead.email}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant="outline" className="text-xs capitalize">{lead.status}</Badge>
                        <span className="text-xs text-gray-500">{lead.repName}</span>
                      </div>
                      {lead.value > 0 && (
                        <div className="text-sm font-semibold text-green-600 min-w-[60px] text-right">${Number(lead.value).toLocaleString()}</div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Per-rep health cards */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-500" />
              Rep Scorecards
            </h2>
            {repHealth.length === 0 ? (
              <Card className="shadow-md">
                <CardContent className="p-12 text-center text-gray-400">
                  <Users className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                  <p>No reps with active leads yet.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {repHealth.map(rep => (
                  <Card key={rep.id} className={`shadow-md border-l-4 ${healthColor[rep.healthScore]} transition-all hover:shadow-lg`} data-testid={`rep-card-${rep.id}`}>
                    <CardContent className="p-4">
                      {/* Rep header */}
                      <div className="flex items-center gap-3 mb-4">
                        {rep.avatar_url ? (
                          <img src={rep.avatar_url} alt={rep.full_name} className="w-10 h-10 rounded-full flex-shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold flex-shrink-0">
                            {rep.full_name?.[0] || '?'}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-900 truncate">{rep.full_name}</span>
                            <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${healthBadge[rep.healthScore]}`}>
                              {healthIcon[rep.healthScore]}
                              {rep.healthScore === 'good' ? 'On Track' : rep.healthScore === 'warning' ? 'Needs Attention' : 'Critical'}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {rep.lastActive
                              ? `Last active ${formatDistanceToNow(new Date(rep.lastActive), { addSuffix: true })}`
                              : 'No recent activity'}
                          </div>
                        </div>
                      </div>

                      {/* Stats grid */}
                      <div className="grid grid-cols-4 gap-2 mb-4">
                        <div className="bg-white rounded-lg p-2 text-center border border-gray-100">
                          <div className="text-xl font-bold text-gray-900">{rep.repLeads.length}</div>
                          <div className="text-xs text-gray-500 leading-tight">Open Leads</div>
                        </div>
                        <div className={`rounded-lg p-2 text-center border ${rep.staleLeads.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-100'}`}>
                          <div className={`text-xl font-bold ${rep.staleLeads.length > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{rep.staleLeads.length}</div>
                          <div className="text-xs text-gray-500 leading-tight">Stale 7d+</div>
                        </div>
                        <div className={`rounded-lg p-2 text-center border ${rep.neglectedLeads.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}>
                          <div className={`text-xl font-bold ${rep.neglectedLeads.length > 0 ? 'text-red-600' : 'text-gray-900'}`}>{rep.neglectedLeads.length}</div>
                          <div className="text-xs text-gray-500 leading-tight">Neglected 14d+</div>
                        </div>
                        <div className={`rounded-lg p-2 text-center border ${rep.repActionItems.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}>
                          <div className={`text-xl font-bold ${rep.repActionItems.length > 0 ? 'text-red-600' : 'text-gray-900'}`}>{rep.repActionItems.length}</div>
                          <div className="text-xs text-gray-500 leading-tight">Overdue Items</div>
                        </div>
                      </div>

                      {/* Neglected lead list (inline) */}
                      {rep.neglectedLeads.length > 0 && (
                        <div className="mb-3 bg-white rounded-lg border border-red-100 divide-y divide-red-50">
                          {rep.neglectedLeads.slice(0, 3).map(l => (
                            <div key={l.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                              <Flame className="w-3 h-3 text-red-400 flex-shrink-0" />
                              <span className="flex-1 truncate text-gray-700">{l.name}</span>
                              <span className="text-red-500 font-medium">{daysSince(l.updated_date || l.created_date)}d</span>
                            </div>
                          ))}
                          {rep.neglectedLeads.length > 3 && (
                            <div className="px-3 py-1.5 text-xs text-gray-400 text-center">
                              +{rep.neglectedLeads.length - 3} more neglected
                            </div>
                          )}
                        </div>
                      )}

                      {/* View activity button */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-2 text-xs"
                        onClick={() => setActivityMember(rep)}
                        data-testid={`btn-view-activity-${rep.id}`}
                      >
                        <Activity className="w-3.5 h-3.5" />
                        View Full Activity
                        <ChevronRight className="w-3.5 h-3.5 ml-auto" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Staff activity dialog — shared across both views */}
      <StaffActivityDialog
        member={activityMember}
        companyId={myCompany?.id}
        onClose={() => setActivityMember(null)}
      />
    </div>
  );
}
