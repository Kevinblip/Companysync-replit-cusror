import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trophy, Star, Zap, TrendingUp, Calendar, User, Award, Crown, Medal, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";

const EVENT_LABELS = {
  appointment_created:   { label: 'Appointment booked',   color: 'bg-blue-100 text-blue-700',   icon: '📅' },
  appointment_completed: { label: 'Appointment completed', color: 'bg-blue-100 text-blue-700',   icon: '✅' },
  inspection_scheduled:  { label: 'Inspection scheduled',  color: 'bg-purple-100 text-purple-700', icon: '🔍' },
  lead_created:          { label: 'Lead added',            color: 'bg-green-100 text-green-700', icon: '🌱' },
  lead_status_changed:   { label: 'Lead moved forward',    color: 'bg-green-100 text-green-700', icon: '📈' },
  customer_created:      { label: 'Customer created',      color: 'bg-teal-100 text-teal-700',   icon: '🤝' },
  estimate_sent:         { label: 'Estimate sent',         color: 'bg-yellow-100 text-yellow-700', icon: '📋' },
  estimate_accepted:     { label: 'Deal closed! 🎉',       color: 'bg-emerald-100 text-emerald-700', icon: '🏆' },
  proposal_created:      { label: 'Proposal sent',         color: 'bg-yellow-100 text-yellow-700', icon: '📄' },
  job_completed:         { label: 'Job completed',         color: 'bg-orange-100 text-orange-700', icon: '🔨' },
  project_started:       { label: 'Project started',       color: 'bg-orange-100 text-orange-700', icon: '🚀' },
  review_requested:      { label: 'Review requested',      color: 'bg-pink-100 text-pink-700',  icon: '⭐' },
  invoice_sent:          { label: 'Invoice sent',          color: 'bg-indigo-100 text-indigo-700', icon: '💰' },
  payment_received:      { label: 'Payment received',      color: 'bg-indigo-100 text-indigo-700', icon: '💵' },
};

const ROLE_LABELS = {
  admin: 'Admin',
  owner: 'Admin',
  production_manager: 'Admin',
  rep: 'Rep',
  subcontractor: 'Sub',
  sub: 'Sub',
};

const ROLE_COLORS = {
  Admin: 'bg-violet-100 text-violet-700',
  Rep:   'bg-blue-100 text-blue-700',
  Sub:   'bg-orange-100 text-orange-700',
  staff: 'bg-slate-100 text-slate-600',
};

function getRoleLabel(role) {
  if (!role) return 'Staff';
  const r = role.toLowerCase();
  if (r.includes('admin') || r.includes('owner') || r.includes('manager')) return 'Admin';
  if (r.includes('rep') || r.includes('sales')) return 'Rep';
  if (r.includes('sub') || r.includes('contractor') || r.includes('crew')) return 'Sub';
  return 'Staff';
}

function RankBadge({ rank }) {
  if (rank === 1) return <span className="text-2xl">🥇</span>;
  if (rank === 2) return <span className="text-2xl">🥈</span>;
  if (rank === 3) return <span className="text-2xl">🥉</span>;
  return <span className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-500">#{rank}</span>;
}

function PointBar({ points, maxPoints }) {
  const pct = maxPoints > 0 ? Math.round((points / maxPoints) * 100) : 0;
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 bg-slate-100 rounded-full h-2">
        <div
          className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-500 w-8 text-right">{pct}%</span>
    </div>
  );
}

function StaffCard({ entry, maxPoints, rank, onClick }) {
  const roleLabel = getRoleLabel(entry.role);
  const initials = (entry.staff_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const isTop3 = rank <= 3;

  return (
    <div
      className={`flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 ${isTop3 ? 'bg-gradient-to-r from-white to-blue-50/30 border-blue-100' : 'bg-white border-slate-100'}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-center w-10">
        <RankBadge rank={rank} />
      </div>

      <Avatar className="h-10 w-10 shrink-0">
        <AvatarImage src={entry.avatar_url} />
        <AvatarFallback className="bg-gradient-to-br from-blue-400 to-violet-500 text-white font-bold text-sm">
          {initials}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-slate-900 truncate">{entry.staff_name}</span>
          <Badge className={`text-xs px-1.5 py-0.5 ${ROLE_COLORS[roleLabel] || ROLE_COLORS['staff']}`}>
            {roleLabel}
          </Badge>
        </div>
        <PointBar points={entry.total_points} maxPoints={maxPoints} />
      </div>

      <div className="text-right shrink-0">
        <div className="text-xl font-bold text-slate-900">{entry.total_points.toLocaleString()}</div>
        <div className="text-xs text-slate-500">{entry.event_count} actions</div>
      </div>

      <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
    </div>
  );
}

function ActivityFeed({ events }) {
  if (!events?.length) {
    return (
      <div className="text-center py-12 text-slate-400">
        <Zap className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p>No activity yet. Scores update automatically as your team works.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {events.map(ev => {
        const meta = EVENT_LABELS[ev.event_type] || { label: ev.description, color: 'bg-slate-100 text-slate-600', icon: '⚡' };
        return (
          <div key={ev.id} className="flex items-center gap-3 p-3 rounded-lg bg-white border border-slate-100 hover:border-slate-200 transition-colors">
            <span className="text-lg shrink-0">{meta.icon}</span>
            <div className="flex-1 min-w-0">
              <span className="font-medium text-slate-800 text-sm">{ev.staff_name || ev.staff_email}</span>
              <span className="text-slate-500 text-sm"> — {meta.label}</span>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <Badge className="bg-emerald-50 text-emerald-700 text-xs font-bold">+{ev.points} pts</Badge>
              <span className="text-xs text-slate-400">
                {ev.created_at ? formatDistanceToNow(new Date(ev.created_at), { addSuffix: true }) : ''}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StaffDetail({ entry, events, onBack }) {
  const roleLabel = getRoleLabel(entry.role);
  const initials = (entry.staff_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const byType = useMemo(() => {
    const map = {};
    for (const ev of (events || [])) {
      map[ev.event_type] = (map[ev.event_type] || 0) + ev.points;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [events]);

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 mb-2">
        ← Back to leaderboard
      </button>

      {/* Profile header */}
      <Card className="border-0 shadow-sm">
        <CardContent className="pt-6">
          <div className="flex items-center gap-5">
            <Avatar className="h-16 w-16">
              <AvatarImage src={entry.avatar_url} />
              <AvatarFallback className="bg-gradient-to-br from-blue-400 to-violet-500 text-white font-bold text-xl">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-slate-900">{entry.staff_name}</h2>
                <Badge className={`${ROLE_COLORS[roleLabel] || ROLE_COLORS['staff']}`}>{roleLabel}</Badge>
              </div>
              <p className="text-sm text-slate-500">{entry.staff_email}</p>
            </div>
            <div className="ml-auto text-right">
              <div className="text-3xl font-black text-slate-900">{entry.total_points.toLocaleString()}</div>
              <div className="text-sm text-slate-500">total points</div>
            </div>
          </div>

          {byType.length > 0 && (
            <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {byType.map(([type, pts]) => {
                const meta = EVENT_LABELS[type] || { label: type, icon: '⚡' };
                return (
                  <div key={type} className="rounded-lg bg-slate-50 p-3 flex flex-col gap-1">
                    <span className="text-base">{meta.icon}</span>
                    <span className="text-xs text-slate-500 leading-tight">{meta.label}</span>
                    <span className="text-sm font-bold text-slate-800">{pts.toLocaleString()} pts</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <h3 className="font-semibold text-slate-700">Recent Activity</h3>
      <ActivityFeed events={events?.slice(0, 30)} />
    </div>
  );
}

export default function Leaderboard() {
  const { myCompany, myStaffProfile } = useRoleBasedData();
  const navigate = useNavigate();
  const [period, setPeriod] = useState('month');
  const [roleFilter, setRoleFilter] = useState('all');
  const [selectedStaff, setSelectedStaff] = useState(null);

  const companyId = myCompany?.id;

  const { data: scoresData, isLoading: scoresLoading } = useQuery({
    queryKey: ['staff-scores', companyId, period],
    queryFn: () => base44.functions.getStaffScores({ company_id: companyId, period }),
    enabled: !!companyId,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: ['score-events', companyId, selectedStaff?.staff_email],
    queryFn: () => base44.functions.getScoreEvents({
      company_id: companyId,
      staff_email: selectedStaff?.staff_email || undefined,
      limit: selectedStaff ? 50 : 30,
    }),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const leaderboard = scoresData?.leaderboard || [];
  const events = eventsData?.events || [];

  const filtered = useMemo(() => {
    if (roleFilter === 'all') return leaderboard;
    return leaderboard.filter(e => {
      const rl = getRoleLabel(e.role);
      return rl.toLowerCase() === roleFilter.toLowerCase();
    });
  }, [leaderboard, roleFilter]);

  const maxPoints = filtered[0]?.total_points || 1;

  const totalPoints = leaderboard.reduce((s, e) => s + e.total_points, 0);
  const totalActions = leaderboard.reduce((s, e) => s + e.event_count, 0);
  const topPerformer = leaderboard[0];

  if (selectedStaff) {
    const staffEvents = events; // already filtered by staff_email in query
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 pb-24">
        <StaffDetail
          entry={selectedStaff}
          events={staffEvents}
          onBack={() => setSelectedStaff(null)}
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 pb-24 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center shadow-sm">
            <Trophy className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900">Leaderboard</h1>
            <p className="text-sm text-slate-500">Scores update automatically as your team works</p>
          </div>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-36 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-4 w-4 text-yellow-500" />
              <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">Total Points</span>
            </div>
            <div className="text-2xl font-black text-slate-900">{totalPoints.toLocaleString()}</div>
            <div className="text-xs text-slate-400 mt-0.5">team-wide</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">Actions</span>
            </div>
            <div className="text-2xl font-black text-slate-900">{totalActions.toLocaleString()}</div>
            <div className="text-xs text-slate-400 mt-0.5">scored events</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Crown className="h-4 w-4 text-orange-500" />
              <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">Leader</span>
            </div>
            <div className="text-sm font-bold text-slate-900 truncate">
              {topPerformer ? topPerformer.staff_name.split(' ')[0] : '—'}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {topPerformer ? `${topPerformer.total_points.toLocaleString()} pts` : 'no scores yet'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Role filter + Rankings */}
      <Tabs value={roleFilter} onValueChange={setRoleFilter}>
        <TabsList className="mb-4">
          <TabsTrigger value="all">All Staff</TabsTrigger>
          <TabsTrigger value="rep">Reps</TabsTrigger>
          <TabsTrigger value="sub">Subs</TabsTrigger>
          <TabsTrigger value="admin">Admins</TabsTrigger>
        </TabsList>

        <TabsContent value={roleFilter} className="mt-0">
          {scoresLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Trophy className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">No scores yet for this period</p>
              <p className="text-sm mt-1">Scores accumulate automatically as your team books appointments, closes deals, completes jobs, and more.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((entry, i) => (
                <StaffCard
                  key={entry.staff_email}
                  entry={entry}
                  rank={i + 1}
                  maxPoints={maxPoints}
                  onClick={() => setSelectedStaff(entry)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Recent activity feed */}
      <div>
        <h2 className="font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <Zap className="h-4 w-4 text-yellow-500" />
          Live Activity Feed
        </h2>
        {eventsLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />)}
          </div>
        ) : (
          <ActivityFeed events={events} />
        )}
      </div>

      {/* Point values reference */}
      <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-600 flex items-center gap-2">
            <Award className="h-4 w-4" /> How Points Are Earned
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.entries(EVENT_LABELS).map(([type, meta]) => {
              const rule = {
                appointment_created: 10, appointment_completed: 15, inspection_scheduled: 10,
                lead_created: 5, lead_status_changed: 8, customer_created: 5,
                estimate_sent: 15, estimate_accepted: 50, proposal_created: 10,
                job_completed: 40, project_started: 10, review_requested: 25,
                invoice_sent: 10, payment_received: 20,
              }[type];
              return (
                <div key={type} className="flex items-center gap-2 text-sm py-1">
                  <span>{meta.icon}</span>
                  <span className="text-slate-600 flex-1 truncate">{meta.label}</span>
                  <span className="font-bold text-emerald-600 shrink-0">+{rule}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
