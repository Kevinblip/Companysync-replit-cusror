import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useSubscriptionLimits } from "@/components/hooks/useSubscriptionLimits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  UserPlus, Edit, Search, Download, AlertCircle, Trash2,
  ShieldCheck, ShieldAlert, ShieldOff, CheckCircle2, XCircle,
  ClipboardList, Lock, Unlock, Users, ChevronDown, ChevronUp,
  Shield, Eye, EyeOff, Settings2, Bell, Mail, MessageSquare
} from "lucide-react";
import StaffActivityDialog from "@/components/StaffActivityDialog";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Switch } from "@/components/ui/switch";
import { formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { isPlatformAdminCheck } from "@/hooks/usePlatformAdmin";
import useTranslation from "@/hooks/useTranslation";
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
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Reminder preferences ─────────────────────────────────────────────────────
const REMINDER_INTERVALS = [
  { key: '1440', label: '24 hours before' },
  { key: '360',  label: '6 hours before' },
  { key: '240',  label: '4 hours before' },
  { key: '60',   label: '1 hour before' },
  { key: '30',   label: '30 min before' },
];

function ReminderPrefsPanel({ member, companyDefaultPrefs }) {
  const prefs = member.data?.reminder_preferences;
  const hasPrefs = prefs && typeof prefs === 'object' && Object.keys(prefs).length > 0;
  const hasCompanyDefaults = companyDefaultPrefs && typeof companyDefaultPrefs === 'object' && Object.keys(companyDefaultPrefs).length > 0;

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3" data-testid={`reminder-prefs-panel-${member.profile_id}`}>
      <div className="flex items-center gap-2 mb-1">
        <Bell className="w-4 h-4 text-gray-600" />
        <span className="text-sm font-semibold text-gray-700">Reminder Preferences — {member.full_name}</span>
        <span className="ml-auto text-xs text-gray-400 italic">Read-only · set by each staff member</span>
      </div>

      {!hasPrefs && !hasCompanyDefaults && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3" data-testid={`reminder-global-defaults-${member.profile_id}`}>
          <Bell className="w-4 h-4 text-blue-500 shrink-0" />
          <p className="text-sm text-blue-700">Using global defaults (all on)</p>
        </div>
      )}

      {!hasPrefs && hasCompanyDefaults && (
        <div>
          <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 mb-3" data-testid={`reminder-company-defaults-${member.profile_id}`}>
            <Bell className="w-4 h-4 text-purple-500 shrink-0" />
            <p className="text-sm text-purple-700 font-medium">Using company defaults</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="py-2 px-3 text-left font-medium text-gray-600">Reminder</th>
                  <th className="py-2 px-3 text-center font-medium text-gray-600">
                    <span className="flex items-center justify-center gap-1">
                      <Mail className="w-3 h-3" /> Email
                    </span>
                  </th>
                  <th className="py-2 px-3 text-center font-medium text-gray-600">
                    <span className="flex items-center justify-center gap-1">
                      <MessageSquare className="w-3 h-3" /> SMS
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {REMINDER_INTERVALS.map(({ key, label }) => {
                  const emailOn = companyDefaultPrefs[key]?.email !== false;
                  const smsOn   = companyDefaultPrefs[key]?.sms   !== false;
                  return (
                    <tr key={key} className="border-t border-gray-100">
                      <td className="py-2 px-3 text-gray-700">{label}</td>
                      <td className="py-2 px-3 text-center">
                        {emailOn
                          ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
                          : <XCircle className="w-4 h-4 text-gray-300 mx-auto" />}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {smsOn
                          ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
                          : <XCircle className="w-4 h-4 text-gray-300 mx-auto" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasPrefs && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="py-2 px-3 text-left font-medium text-gray-600">Reminder</th>
                <th className="py-2 px-3 text-center font-medium text-gray-600">
                  <span className="flex items-center justify-center gap-1">
                    <Mail className="w-3 h-3" /> Email
                  </span>
                </th>
                <th className="py-2 px-3 text-center font-medium text-gray-600">
                  <span className="flex items-center justify-center gap-1">
                    <MessageSquare className="w-3 h-3" /> SMS
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {REMINDER_INTERVALS.map(({ key, label }) => {
                const emailOn = prefs[key]?.email !== false;
                const smsOn   = prefs[key]?.sms   !== false;
                return (
                  <tr key={key} className="border-t border-gray-100">
                    <td className="py-2 px-3 text-gray-700">{label}</td>
                    <td className="py-2 px-3 text-center">
                      {emailOn
                        ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
                        : <XCircle className="w-4 h-4 text-gray-300 mx-auto" />}
                    </td>
                    <td className="py-2 px-3 text-center">
                      {smsOn
                        ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
                        : <XCircle className="w-4 h-4 text-gray-300 mx-auto" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Reminder Preferences Overview (all-staff grid) ──────────────────────────
function ReminderPrefsOverview({ staff, companyDefaultPrefs, onNavigate }) {
  if (staff.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Bell className="w-12 h-12 mx-auto mb-3 text-gray-300" />
        <p className="text-sm">No staff members found.</p>
      </div>
    );
  }

  // Resolve effective prefs for a member: personal → company → global (all on)
  const effectivePrefs = (member) => {
    const p = member.data?.reminder_preferences;
    if (p && typeof p === 'object' && Object.keys(p).length > 0) return { prefs: p, source: 'personal' };
    if (companyDefaultPrefs && typeof companyDefaultPrefs === 'object' && Object.keys(companyDefaultPrefs).length > 0)
      return { prefs: companyDefaultPrefs, source: 'company' };
    return { prefs: {}, source: 'global' };
  };

  // Count staff with any opt-out
  const nonDefaultCount = staff.filter(m => {
    const { prefs } = effectivePrefs(m);
    return REMINDER_INTERVALS.some(({ key }) => prefs[key]?.email === false || prefs[key]?.sms === false);
  }).length;

  return (
    <div className="space-y-4" data-testid="reminder-prefs-overview">
      {/* Info banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
        <Bell className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-800">Staff Reminder Preferences — read-only</p>
          <p className="text-xs text-amber-700 mt-1">
            Each cell shows whether that staff member receives <strong>email</strong> or <strong>SMS</strong> for each reminder interval.
            {" "}<span className="inline-flex items-center gap-1"><XCircle className="w-3 h-3 text-red-400 inline" /> Opted out</span> cells are highlighted in red.
            {" "}Staff change their own preferences from their personal Settings page.
          </p>
        </div>
        {nonDefaultCount > 0 && (
          <Badge className="bg-red-100 text-red-700 shrink-0 whitespace-nowrap">
            {nonDefaultCount} with opt-outs
          </Badge>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 px-1">
        <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> Enabled (default)</span>
        <span className="flex items-center gap-1"><XCircle className="w-3.5 h-3.5 text-red-400" /> Opted out</span>
        <span className="flex items-center gap-1 ml-2">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-purple-100 border border-purple-300" /> Using company defaults
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-100 border border-gray-300" /> Using global defaults
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-50 border border-blue-200" /> Personal overrides
        </span>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs min-w-[700px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {/* Staff name column */}
              <th className="py-3 px-4 text-left font-semibold text-gray-600 w-48 sticky left-0 bg-gray-50 z-10 border-r border-gray-200">
                Staff Member
              </th>
              {/* Interval × channel columns */}
              {REMINDER_INTERVALS.map(({ key, label }) => (
                <th key={key} colSpan={2} className="py-2 px-2 text-center font-semibold text-gray-600 border-l border-gray-200">
                  <div className="text-xs">{label}</div>
                  <div className="flex justify-center gap-3 mt-1 text-gray-400 font-normal">
                    <span className="flex items-center gap-0.5"><Mail className="w-3 h-3" />E</span>
                    <span className="flex items-center gap-0.5"><MessageSquare className="w-3 h-3" />S</span>
                  </div>
                </th>
              ))}
              <th className="py-3 px-3 text-center font-semibold text-gray-600 border-l border-gray-200 w-20">
                Settings
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {staff.map((member) => {
              const { prefs, source } = effectivePrefs(member);
              const hasAnyOptOut = REMINDER_INTERVALS.some(({ key }) =>
                prefs[key]?.email === false || prefs[key]?.sms === false
              );

              const rowBg =
                source === 'personal' ? 'bg-blue-50/30' :
                source === 'company'  ? 'bg-purple-50/30' :
                'bg-white';

              return (
                <tr key={member.profile_id} className={`${rowBg} hover:bg-amber-50/40 transition-colors`}
                    data-testid={`reminder-overview-row-${member.profile_id}`}>
                  {/* Name cell */}
                  <td className={`py-3 px-4 sticky left-0 z-10 border-r border-gray-200 ${rowBg}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar className="w-6 h-6 shrink-0">
                        <AvatarImage src={member.avatar_url} />
                        <AvatarFallback className="text-xs">{member.full_name?.charAt(0)?.toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{member.full_name}</p>
                        <p className="text-gray-400 truncate text-xs">{member.email}</p>
                      </div>
                      {hasAnyOptOut && (
                        <span className="shrink-0 inline-block w-1.5 h-1.5 rounded-full bg-red-400" title="Has opt-outs" />
                      )}
                    </div>
                  </td>

                  {/* Interval cells */}
                  {REMINDER_INTERVALS.map(({ key }) => {
                    const emailOn = prefs[key]?.email !== false;
                    const smsOn   = prefs[key]?.sms   !== false;
                    return (
                      <React.Fragment key={key}>
                        <td className={`py-3 px-2 text-center border-l border-gray-100 ${!emailOn ? 'bg-red-50' : ''}`}
                            title={emailOn ? 'Email on' : 'Email opted out'}>
                          {emailOn
                            ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
                            : <XCircle className="w-4 h-4 text-red-400 mx-auto" />}
                        </td>
                        <td className={`py-3 px-2 text-center ${!smsOn ? 'bg-red-50' : ''}`}
                            title={smsOn ? 'SMS on' : 'SMS opted out'}>
                          {smsOn
                            ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
                            : <XCircle className="w-4 h-4 text-red-400 mx-auto" />}
                        </td>
                      </React.Fragment>
                    );
                  })}

                  {/* Settings link */}
                  <td className="py-3 px-3 text-center border-l border-gray-100">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-blue-600 hover:text-blue-800"
                      onClick={() => onNavigate(member.email)}
                      title="Open staff settings"
                      data-testid={`btn-reminder-settings-${member.profile_id}`}
                    >
                      <Settings2 className="w-3 h-3 mr-1" />
                      Edit
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 text-right">
        Staff members change their own preferences from their personal Settings page.
      </p>
    </div>
  );
}

// ─── Access level helper ──────────────────────────────────────────────────────
function getAccessLevel(member, companyCreatedBy) {
  if (companyCreatedBy === member.email) return { label: "Owner", color: "bg-red-100 text-red-700", icon: Shield, tier: 3 };
  if (member.is_super_admin)           return { label: "Super Admin", color: "bg-purple-100 text-purple-700", icon: ShieldAlert, tier: 3 };
  if (member.is_administrator)         return { label: "Admin", color: "bg-orange-100 text-orange-700", icon: ShieldCheck, tier: 2 };
  if (member.role_name)                return { label: member.role_name, color: "bg-blue-100 text-blue-700", icon: Lock, tier: 1 };
  return { label: "No Role", color: "bg-gray-100 text-gray-500", icon: ShieldOff, tier: 0 };
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function formatExportLastLogin(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

// ─── Inline access-control panel for one staff member ────────────────────────
function AccessControlPanel({ member, roles, companyCreatedBy, onUpdate, isUpdating, myCompany }) {
  const level = getAccessLevel(member, companyCreatedBy);
  const isOwner = companyCreatedBy === member.email;
  const Icon = level.icon;

  const handleRoleChange = (val) => {
    const role = roles.find(r => r.id === val);
    onUpdate(member.profile_id, {
      role_id: val === "none" ? null : val,
      role_name: val === "none" ? null : (role?.name || null),
    });
  };

  const handleAdminToggle = (checked) => {
    onUpdate(member.profile_id, { is_administrator: checked });
  };

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" />
        <span className="text-sm font-semibold text-gray-700">Access Control — {member.full_name}</span>
        <Badge className={`text-xs ml-auto ${level.color}`}>{level.label}</Badge>
      </div>

      {isOwner ? (
        <p className="text-xs text-gray-500 italic">Company owner — always has full access. Cannot be changed here.</p>
      ) : (
        <div className="space-y-3">
          {/* Admin toggle */}
          <div className="flex items-center justify-between bg-white border rounded-lg p-3">
            <div>
              <p className="text-sm font-medium text-gray-800">Administrator</p>
              <p className="text-xs text-gray-500">Full access — bypasses all role restrictions</p>
            </div>
            <Switch
              checked={!!member.is_administrator}
              onCheckedChange={handleAdminToggle}
              disabled={isUpdating}
              data-testid={`toggle-admin-${member.profile_id}`}
            />
          </div>

          {/* Role assignment */}
          {!member.is_administrator && (
            <div className="flex items-center justify-between bg-white border rounded-lg p-3">
              <div className="flex-1 mr-3">
                <p className="text-sm font-medium text-gray-800">Assigned Role</p>
                <p className="text-xs text-gray-500">Controls which pages & data this person can access</p>
              </div>
              <Select
                value={member.role_id || "none"}
                onValueChange={handleRoleChange}
                disabled={isUpdating}
              >
                <SelectTrigger className="w-44" data-testid={`select-role-${member.profile_id}`}>
                  <SelectValue placeholder="No role assigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No role (own records only) —</SelectItem>
                  {roles.map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Access summary */}
          {!member.is_administrator && !member.role_id && (
            <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5 shrink-0" />
              <p className="text-xs text-yellow-700">
                No role assigned — this person can only see records assigned directly to them. Assign a role to grant broader access.
              </p>
            </div>
          )}

          {member.is_administrator && (
            <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-lg p-3">
              <ShieldAlert className="w-4 h-4 text-orange-600 mt-0.5 shrink-0" />
              <p className="text-xs text-orange-700">
                Administrator flag is ON — this person has full access to your company, just like the owner. Turn this off and assign a role to restrict their access.
              </p>
            </div>
          )}

          {/* Active status */}
          <div className="flex items-center justify-between bg-white border rounded-lg p-3">
            <div>
              <p className="text-sm font-medium text-gray-800">Account Active</p>
              <p className="text-xs text-gray-500">Inactive staff cannot log in</p>
            </div>
            <Switch
              checked={member.is_active ?? true}
              onCheckedChange={(checked) => onUpdate(member.profile_id, { is_active: checked })}
              disabled={isUpdating}
              data-testid={`toggle-active-${member.profile_id}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Team Overview (Access Control tab) ──────────────────────────────────────
function AccessControlOverview({ staff, roles, companyCreatedBy, onUpdate, isUpdating, onEdit }) {
  const accessGroups = [
    { tier: 3, label: "Full Access (Owners & Admins)", bg: "bg-red-50 border-red-200" },
    { tier: 2, label: "Administrators", bg: "bg-orange-50 border-orange-200" },
    { tier: 1, label: "Role-Based Access", bg: "bg-blue-50 border-blue-200" },
    { tier: 0, label: "No Role Assigned", bg: "bg-gray-50 border-gray-200" },
  ];

  const grouped = accessGroups.map(g => ({
    ...g,
    members: staff.filter(m => {
      const lvl = getAccessLevel(m, companyCreatedBy);
      if (g.tier === 3) return lvl.tier === 3;
      if (g.tier === 2) return lvl.tier === 2;
      if (g.tier === 1) return lvl.tier === 1;
      return lvl.tier === 0;
    }),
  })).filter(g => g.members.length > 0);

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
        <Shield className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-blue-800">How access control works</p>
          <p className="text-xs text-blue-700 mt-1">
            Each staff member has an access level. <strong>Owners</strong> always have full access. <strong>Admins</strong> see everything in your company. 
            Staff with a <strong>Role</strong> only see the pages and data that role allows. 
            Staff with <strong>No Role</strong> can only see records assigned directly to them.
          </p>
        </div>
      </div>

      {grouped.map(group => (
        <Card key={group.tier} className={`border ${group.bg}`}>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Users className="w-4 h-4" />
              {group.label}
              <Badge variant="outline" className="ml-auto">{group.members.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="space-y-2">
              {group.members.map(member => {
                const level = getAccessLevel(member, companyCreatedBy);
                const Icon = level.icon;
                const isOwner = companyCreatedBy === member.email;

                return (
                  <div key={member.profile_id} className="flex items-center gap-3 bg-white rounded-lg p-3 border">
                    <Avatar className="w-8 h-8 shrink-0">
                      <AvatarImage src={member.avatar_url} />
                      <AvatarFallback className="text-xs">{member.full_name?.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{member.full_name}</p>
                      <p className="text-xs text-gray-500 truncate">{member.email}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className={`text-xs ${level.color} flex items-center gap-1`}>
                        <Icon className="w-3 h-3" />
                        {level.label}
                      </Badge>
                      {!isOwner && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onEdit(member.email)}
                          data-testid={`btn-edit-access-${member.profile_id}`}
                        >
                          <Settings2 className="w-3 h-3 mr-1" />
                          Edit
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function StaffManagement() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [pageSize, setPageSize] = useState("25");
  const [activeTab, setActiveTab] = useState("members");
  const [expandedAccessPanel, setExpandedAccessPanel] = useState(null);
  const [expandedRemindersPanel, setExpandedRemindersPanel] = useState(null);
  const { canCreateStaff } = useSubscriptionLimits();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
  });

  const isCurrentUserAdmin = React.useMemo(() => {
    if (!user || !staffProfiles) return false;
    const myProfile = staffProfiles[0];
    return myProfile?.is_administrator === true || myProfile?.is_super_admin === true;
  }, [user, staffProfiles]);

  const myCompany = React.useMemo(() => {
    if (!user) return null;
    const impersonatedId = typeof window !== 'undefined' ? sessionStorage.getItem('impersonating_company_id') : null;
    if (impersonatedId) {
      const target = companies.find(c => c.id === impersonatedId);
      if (target) return target;
    }
    const staffProfile = staffProfiles[0];
    if (staffProfile?.company_id) {
      const profileCompany = companies.find(c => c.id === staffProfile.company_id);
      if (profileCompany) return profileCompany;
    }
    const ownedCompany = companies.find(c => c.created_by === user.email);
    if (ownedCompany) return ownedCompany;
    return null;
  }, [user, companies, staffProfiles]);

  const isOwner = myCompany?.created_by === user?.email;
  const canManageAccess = isOwner || isCurrentUserAdmin || isPlatformAdminCheck(user, myCompany, null);

  const handleNewStaffClick = () => {
    navigate(createPageUrl(`StaffProfilePage`) + `?email=new`);
  };

  const { data: companyStaffProfiles = [] } = useQuery({
    queryKey: ['company-staff-profiles', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  const { data: companyRoles = [] } = useQuery({
    queryKey: ['company-roles', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffRole.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  const { data: companyReminderSettings } = useQuery({
    queryKey: ['company-reminder-settings', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return null;
      const rows = await base44.entities.ReminderSettings.filter({ company_id: myCompany.id }, '-created_date', 1);
      return rows[0] || null;
    },
    enabled: !!myCompany,
  });

  const updateProfileMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.StaffProfile.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-staff-profiles'] });
      toast.success("Access updated");
    },
    onError: () => toast.error("Failed to update access"),
  });

  const deleteProfileMutation = useMutation({
    mutationFn: (id) => base44.entities.StaffProfile.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-staff-profiles'] });
    }
  });

  const staff = companyStaffProfiles
    .map(profile => ({
      ...profile,
      profile_id: profile.id,
      full_name: profile.full_name,
      email: profile.user_email,
      position: profile.position,
      is_active: profile.is_active,
      avatar_url: profile.avatar_url,
      commission_rate: profile.commission_rate,
      is_administrator: profile.is_administrator,
      is_super_admin: profile.is_super_admin,
      role_name: profile.role_name,
      role_id: profile.role_id,
      last_login: profile.last_login,
    }))
    .filter(s =>
      s.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.position?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.role_name?.toLowerCase().includes(searchTerm.toLowerCase())
    );

  const handleToggleActive = (member) => {
    if (member.profile_id) {
      updateProfileMutation.mutate({ id: member.profile_id, data: { is_active: !member.is_active } });
    }
  };

  const handleEditClick = (email) => {
    navigate(createPageUrl(`StaffProfilePage`) + `?email=${encodeURIComponent(email)}`);
  };

  const handleDelete = (member) => {
    if (window.confirm(`⚠️ Remove ${member.full_name}?\n\nThis will remove their staff profile but NOT delete their user account.\n\nAre you sure?`)) {
      deleteProfileMutation.mutate(member.profile_id);
    }
  };

  const handleExport = () => {
    if (staff.length === 0) {
      toast.info('There are no team members to export.');
      return;
    }

    const headers = ['Name', 'Email', 'Access Level', 'Position', 'Last Login', 'Commission %', 'Status'];
    const rows = staff.map((member) => [
      member.full_name || '',
      member.email || '',
      getAccessLevel(member, myCompany?.created_by).label,
      member.position || '',
      formatExportLastLogin(member.last_login),
      member.commission_rate == null ? '' : `${member.commission_rate}%`,
      member.is_active === false ? 'Inactive' : 'Active',
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(csvCell).join(','))
      .join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `staff-members-${new Date().toISOString().slice(0, 10)}.csv`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Let the browser start the download before releasing the object URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`Exported ${staff.length} team member${staff.length === 1 ? '' : 's'}.`);
  };

  const handleAccessUpdate = (profileId, data) => {
    updateProfileMutation.mutate({ id: profileId, data });
  };

  const [deleteEmail, setDeleteEmail] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [diagnosticMember, setDiagnosticMember] = useState(null);
  const [activityMember, setActivityMember] = useState(null);

  const { data: diagnosticRoleArr = [], isLoading: isLoadingDiagRole } = useQuery({
    queryKey: ['diagnostic-role', diagnosticMember?.role_id],
    queryFn: () => diagnosticMember?.role_id
      ? base44.entities.StaffRole.filter({ id: diagnosticMember.role_id })
      : [],
    enabled: !!diagnosticMember?.role_id,
  });
  const diagnosticRole = diagnosticRoleArr[0] || null;
  const diagnosticHasRole = !!(diagnosticMember?.role_id || diagnosticMember?.role_name);

  const PermCheck = ({ label, granted, detail }) => (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-700">{label}</span>
      <div className="flex items-center gap-2">
        {detail && <span className="text-xs text-gray-400">{detail}</span>}
        {granted === null
          ? <span className="text-xs text-gray-400">loading…</span>
          : granted
            ? <CheckCircle2 className="w-4 h-4 text-green-500" />
            : <XCircle className="w-4 h-4 text-red-400" />}
      </div>
    </div>
  );

  const getDiagnosticInfo = () => {
    if (!diagnosticMember) return null;
    const perms = diagnosticRole?.permissions || {};
    const isOwnerDiag = myCompany?.created_by === diagnosticMember.email;
    const isIsAdministrator = !!(diagnosticMember.is_administrator);
    const isAdmin = isOwnerDiag || diagnosticMember.is_super_admin || isIsAdministrator;
    const hasRole = diagnosticHasRole;
    const roleDataLoaded = !!diagnosticRole;

    const check = (feature, cap) => {
      if (isAdmin) return true;
      if (!roleDataLoaded) return null;
      return perms[feature]?.[cap] === true;
    };

    const globalViewFeatures = roleDataLoaded
      ? Object.entries(perms)
          .filter(([, caps]) => caps?.view_global === true || caps?.view === true)
          .map(([feature]) => feature)
      : [];

    return {
      isAdmin, isOwner: isOwnerDiag, isIsAdministrator, hasRole, roleDataLoaded,
      roleName: diagnosticRole?.name || diagnosticMember.role_name || null,
      leadsGlobal: check('leads', 'view_global'),
      leadsOwn: check('leads', 'view_own'),
      customersGlobal: check('customers', 'view_global'),
      customersOwn: check('customers', 'view_own'),
      canCreateLeads: check('leads', 'create'),
      canEditLeads: check('leads', 'edit_own') || check('leads', 'edit'),
      canCreateCustomers: check('customers', 'create'),
      globalViewFeatures,
      rawPerms: perms,
    };
  };
  const diagInfo = getDiagnosticInfo();

  const handleDeleteOrphanedAccount = async () => {
    if (!deleteEmail) {
      alert('Please enter an email address');
      return;
    }
    if (!confirm(`🗑️ Delete authentication account for ${deleteEmail}?\n\nThis will allow the email to be reused.\n\nAre you sure?`)) return;
    setIsDeleting(true);
    try {
      await base44.functions.invoke('deleteUserAccount', { email: deleteEmail });
      alert(`✅ User account ${deleteEmail} deleted successfully!`);
      setDeleteEmail("");
    } catch (error) {
      alert(`❌ Failed: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="p-3 sm:p-6 space-y-6 bg-white min-h-screen">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.sidebar.staffManagement}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {staff.length} team member{staff.length !== 1 ? 's' : ''} · {companyRoles.length} role{companyRoles.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        {canManageAccess && (
          <Button onClick={handleNewStaffClick} data-testid="btn-add-staff">
            <UserPlus className="w-4 h-4 mr-2" />
            Add Staff
          </Button>
        )}
      </div>

      {/* Platform admin orphan-delete tool */}
      {user && isPlatformAdminCheck(user, myCompany, null) && (
        <Card className="bg-orange-50 border-orange-200">
          <CardContent className="p-4 flex flex-col md:flex-row items-start md:items-center gap-4">
            <div className="bg-orange-100 p-2 rounded-full">
              <AlertCircle className="w-6 h-6 text-orange-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-orange-800">Delete Orphaned User Account</h3>
              <p className="text-xs text-orange-700">Use this to delete user accounts that don't have staff profiles (so the email can be reused for testing)</p>
            </div>
            <div className="flex w-full md:w-auto gap-2">
              <Input
                placeholder="email"
                className="bg-white border-orange-200"
                value={deleteEmail}
                onChange={(e) => setDeleteEmail(e.target.value)}
              />
              <Button variant="destructive" onClick={handleDeleteOrphanedAccount} disabled={isDeleting}>
                {isDeleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 max-w-lg">
          <TabsTrigger value="members" data-testid="tab-members">
            <Users className="w-4 h-4 mr-2" />
            Team Members
          </TabsTrigger>
          <TabsTrigger value="access" data-testid="tab-access-control">
            <Shield className="w-4 h-4 mr-2" />
            Access Control
          </TabsTrigger>
          <TabsTrigger value="reminders" data-testid="tab-reminder-prefs">
            <Bell className="w-4 h-4 mr-2" />
            Reminder Prefs
          </TabsTrigger>
        </TabsList>

        {/* ── Team Members tab ── */}
        <TabsContent value="members" className="space-y-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Select value={pageSize} onValueChange={setPageSize}>
                <SelectTrigger className="w-20">
                  <SelectValue placeholder="25" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={handleExport}
                data-testid="button-export-staff"
              >
                <Download className="w-4 h-4 mr-2" />
                {t.common.export}
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder={t.common.search}
                className="pl-10"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-4 text-left font-semibold text-gray-600">Name</th>
                      <th className="p-4 text-left font-semibold text-gray-600">Email</th>
                      <th className="p-4 text-left font-semibold text-gray-600">Access Level</th>
                      <th className="p-4 text-left font-semibold text-gray-600">Position</th>
                      <th className="p-4 text-left font-semibold text-gray-600">Last Login</th>
                      <th className="p-4 text-left font-semibold text-gray-600">Commission %</th>
                      <th className="p-4 text-left font-semibold text-gray-600">Active</th>
                      <th className="p-4 text-left font-semibold text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {staff.map((member) => {
                      const level = getAccessLevel(member, myCompany?.created_by);
                      const Icon = level.icon;
                      const isExpanded = expandedAccessPanel === member.profile_id;
                      const isRemindersExpanded = expandedRemindersPanel === member.profile_id;

                      return (
                        <React.Fragment key={member.profile_id}>
                          <tr className="hover:bg-gray-50">
                            <td className="p-4">
                              <div className="flex items-center gap-3">
                                <Avatar>
                                  <AvatarImage src={member.avatar_url} />
                                  <AvatarFallback>{member.full_name?.charAt(0).toUpperCase()}</AvatarFallback>
                                </Avatar>
                                <div>
                                  <span className="font-medium">{member.full_name}</span>
                                  {member.is_super_admin && (
                                    <Badge className="ml-2 bg-purple-100 text-purple-700 text-xs">Super Admin</Badge>
                                  )}
                                  {myCompany?.created_by === member.email && !member.is_super_admin && (
                                    <Badge className="ml-2 bg-red-100 text-red-700 text-xs">Owner</Badge>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="p-4 text-gray-600">{member.email}</td>
                            <td className="p-4">
                              <Badge className={`text-xs flex items-center gap-1 w-fit ${level.color}`}>
                                <Icon className="w-3 h-3" />
                                {level.label}
                              </Badge>
                            </td>
                            <td className="p-4 text-gray-600">
                              {member.position || <span className="text-gray-400">—</span>}
                            </td>
                            <td className="p-4 text-gray-600">
                              {member.last_login ? (
                                <span>{formatDistanceToNow(new Date(member.last_login), { addSuffix: true })}</span>
                              ) : (
                                <span className="text-gray-400">Never</span>
                              )}
                            </td>
                            <td className="p-4">
                              {member.commission_rate ? (
                                <Badge className="bg-green-100 text-green-800 font-semibold">
                                  {member.commission_rate}%
                                </Badge>
                              ) : (
                                <span className="text-gray-400 text-sm">—</span>
                              )}
                            </td>
                            <td className="p-4">
                              <Switch
                                checked={member.is_active ?? true}
                                onCheckedChange={() => canManageAccess && handleToggleActive(member)}
                                disabled={!canManageAccess}
                              />
                            </td>
                            <td className="p-4">
                              <div className="flex gap-1 flex-wrap">
                                {canManageAccess && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleEditClick(member.email)}
                                    title="Edit profile"
                                    data-testid={`btn-edit-${member.profile_id}`}
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="View activity"
                                  className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                  onClick={() => setActivityMember(member)}
                                  data-testid={`btn-activity-${member.profile_id}`}
                                >
                                  <ClipboardList className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="View reminder preferences"
                                  className={isRemindersExpanded ? 'text-amber-700 bg-amber-50' : 'text-amber-500 hover:text-amber-700 hover:bg-amber-50'}
                                  onClick={() => setExpandedRemindersPanel(isRemindersExpanded ? null : member.profile_id)}
                                  data-testid={`btn-reminders-${member.profile_id}`}
                                >
                                  <Bell className="w-4 h-4" />
                                </Button>
                                {canManageAccess && (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      title="Manage access"
                                      className={`${isExpanded ? 'text-blue-700 bg-blue-50' : 'text-blue-600 hover:text-blue-700 hover:bg-blue-50'}`}
                                      onClick={() => setExpandedAccessPanel(isExpanded ? null : member.profile_id)}
                                      data-testid={`btn-access-${member.profile_id}`}
                                    >
                                      {isExpanded ? <EyeOff className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      title="Check permissions"
                                      className="text-gray-500 hover:text-gray-700"
                                      onClick={() => setDiagnosticMember(member)}
                                      data-testid={`btn-permissions-${member.profile_id}`}
                                    >
                                      <ShieldCheck className="w-4 h-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleDelete(member)}
                                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                      title="Remove staff member"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* Inline Access Control Panel */}
                          {isExpanded && canManageAccess && (
                            <tr>
                              <td colSpan={8} className="px-4 pb-4 bg-gray-50">
                                <AccessControlPanel
                                  member={member}
                                  roles={companyRoles}
                                  companyCreatedBy={myCompany?.created_by}
                                  onUpdate={handleAccessUpdate}
                                  isUpdating={updateProfileMutation.isPending}
                                  myCompany={myCompany}
                                />
                              </td>
                            </tr>
                          )}

                          {/* Inline Reminder Preferences Panel */}
                          {isRemindersExpanded && (
                            <tr>
                              <td colSpan={8} className="px-4 pb-4 bg-gray-50">
                                <ReminderPrefsPanel member={member} companyDefaultPrefs={companyReminderSettings?.default_staff_preferences} />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {staff.length === 0 && (
                      <tr>
                        <td colSpan={8} className="p-12 text-center text-gray-500">
                          <UserPlus className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                          <h3 className="text-lg font-semibold mb-2">{t.common.noResults}</h3>
                          <p>Add staff members to build your team</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Reminder Preferences tab ── */}
        <TabsContent value="reminders" className="space-y-4">
          <ReminderPrefsOverview
            staff={staff}
            companyDefaultPrefs={companyReminderSettings?.default_staff_preferences}
            onNavigate={handleEditClick}
          />
        </TabsContent>

        {/* ── Access Control tab ── */}
        <TabsContent value="access" className="space-y-4">
          {companyRoles.length === 0 && (
            <div className="flex items-start gap-3 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-yellow-800">No roles created yet</p>
                <p className="text-xs text-yellow-700 mt-1">
                  Without roles, staff can only see records assigned directly to them.{" "}
                  <button
                    className="underline font-medium"
                    onClick={() => navigate(createPageUrl("RolesManagement"))}
                  >
                    Create roles in Roles & Permissions →
                  </button>
                </p>
              </div>
            </div>
          )}

          <AccessControlOverview
            staff={staff}
            roles={companyRoles}
            companyCreatedBy={myCompany?.created_by}
            onUpdate={handleAccessUpdate}
            isUpdating={updateProfileMutation.isPending}
            onEdit={handleEditClick}
          />

          {canManageAccess && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => navigate(createPageUrl("RolesManagement"))}
                data-testid="btn-go-to-roles"
              >
                <Shield className="w-4 h-4 mr-2" />
                Manage Roles & Permissions
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Staff Activity Modal */}
      <StaffActivityDialog
        member={activityMember}
        companyId={myCompany?.id}
        onClose={() => setActivityMember(null)}
      />

      {/* Permission Diagnostic Modal */}
      <Dialog open={!!diagnosticMember} onOpenChange={(open) => { if (!open) setDiagnosticMember(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {diagInfo?.isAdmin
                ? <ShieldAlert className="w-5 h-5 text-orange-500" />
                : <ShieldCheck className="w-5 h-5 text-blue-500" />}
              Permission Check: {diagnosticMember?.full_name}
            </DialogTitle>
            <DialogDescription>
              {diagnosticMember?.email}
            </DialogDescription>
          </DialogHeader>

          {diagInfo && (
            <div className="space-y-4">
              <div className={`rounded-lg p-3 text-sm space-y-1 ${diagInfo.isAdmin ? 'bg-orange-50 border border-orange-200' : 'bg-blue-50 border border-blue-200'}`}>
                {diagInfo.isOwner && (
                  <p className="font-semibold text-orange-700">Company Owner — has full access to everything</p>
                )}
                {diagInfo.isIsAdministrator && !diagInfo.isOwner && (
                  <p className="font-semibold text-orange-700">
                    ⚠️ Administrator flag is ON — bypasses all role permissions.<br />
                    Go to their profile and uncheck "Administrator" to enforce their role.
                  </p>
                )}
                {!diagInfo.isAdmin && diagInfo.hasRole && (
                  <>
                    <p className="text-blue-700">Role: <strong>{diagInfo.roleName}</strong></p>
                    {diagInfo.roleDataLoaded && diagInfo.globalViewFeatures.length > 0 && (
                      <div className="mt-1">
                        <p className="text-xs text-orange-600 font-semibold">Features with "View All" (company-wide) enabled:</p>
                        <p className="text-xs text-orange-700">{diagInfo.globalViewFeatures.join(', ')}</p>
                        <p className="text-xs text-gray-500 mt-1">Edit this role and uncheck "View Global" to restrict to own records only.</p>
                      </div>
                    )}
                    {diagInfo.roleDataLoaded && diagInfo.globalViewFeatures.length === 0 && (
                      <p className="text-xs text-green-600 mt-1">No "View All" permissions — staff sees only their own records.</p>
                    )}
                  </>
                )}
                {!diagInfo.isAdmin && !diagInfo.hasRole && (
                  <p className="font-semibold text-yellow-700">
                    ⚠️ No role assigned — staff sees only records assigned to them.<br />
                    Use the 🔒 Access button in the table to assign a role.
                  </p>
                )}
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">Leads Access</h4>
                <PermCheck label="View ALL leads (company-wide)" granted={diagInfo.leadsGlobal} detail={diagInfo.isAdmin ? "via Admin" : diagInfo.leadsGlobal ? "via Role" : ""} />
                <PermCheck label="View own assigned leads only" granted={diagInfo.leadsOwn || !diagInfo.leadsGlobal} detail={!diagInfo.hasRole && !diagInfo.isAdmin ? "fallback" : ""} />
                <PermCheck label="Create leads" granted={diagInfo.canCreateLeads} />
                <PermCheck label="Edit leads" granted={diagInfo.canEditLeads} />
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">Customers Access</h4>
                <PermCheck label="View ALL customers (company-wide)" granted={diagInfo.customersGlobal} detail={diagInfo.isAdmin ? "via Admin" : diagInfo.customersGlobal ? "via Role" : ""} />
                <PermCheck label="View own assigned customers only" granted={diagInfo.customersOwn || !diagInfo.customersGlobal} detail={!diagInfo.hasRole && !diagInfo.isAdmin ? "fallback" : ""} />
                <PermCheck label="Create customers" granted={diagInfo.canCreateCustomers} />
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => handleEditClick(diagnosticMember.email)}>
                  Edit Profile / Role
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => setDiagnosticMember(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
