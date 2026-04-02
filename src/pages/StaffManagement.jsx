import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useSubscriptionLimits } from "@/components/hooks/useSubscriptionLimits";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserPlus, Edit, Search, Download, AlertCircle, Trash2, ShieldCheck, ShieldAlert, ShieldOff, CheckCircle2, XCircle, ClipboardList } from "lucide-react";
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

export default function StaffManagement() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [pageSize, setPageSize] = useState("25");
  const { canCreateStaff } = useSubscriptionLimits();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
    initialData: [],
  });

  const myCompany = React.useMemo(() => {
    if (!user) return null;

    // Priority 1: Impersonation
    const impersonatedId = typeof window !== 'undefined' ? sessionStorage.getItem('impersonating_company_id') : null;
    if (impersonatedId) {
      const target = companies.find(c => c.id === impersonatedId);
      if (target) return target;
    }

    // Priority 2: Staff profile company
    const staffProfile = staffProfiles[0];
    if (staffProfile?.company_id) {
      const profileCompany = companies.find(c => c.id === staffProfile.company_id);
      if (profileCompany) return profileCompany;
    }

    // Priority 3: Owned company
    const ownedCompany = companies.find(c => c.created_by === user.email);
    if (ownedCompany) return ownedCompany;
    return null;
  }, [user, companies, staffProfiles]);

  const handleNewStaffClick = () => {
    console.log('按钮被点击 - 正在尝试添加新员工');
    // 直接跳转，不等待限额检查，限额检查可以在目标页面进行或者后台进行
    // 这样用户体验最快，且不会因为后台挂了导致按钮点不动
    navigate(createPageUrl(`StaffProfilePage`) + `?email=new`);
  };

  const { data: companyStaffProfiles = [] } = useQuery({
    queryKey: ['company-staff-profiles', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const updateProfileMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.StaffProfile.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-staff-profiles'] });
    }
  });

  const deleteProfileMutation = useMutation({
    mutationFn: (id) => base44.entities.StaffProfile.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-staff-profiles'] });
    }
  });

  // Show ALL staff profiles, with a flag if they don't have a User account yet
  const staff = companyStaffProfiles
    .map(profile => ({
      ...profile,
      profile_id: profile.id,
      full_name: profile.full_name,
      email: profile.user_email,
      position: profile.position,
      phone: profile.phone,
      twilio_number: profile.twilio_number, // Kept for consistency with original profile, even if not displayed
      whatsapp_enabled: profile.whatsapp_enabled, // Kept for consistency with original profile, even if not displayed
      is_active: profile.is_active,
      avatar_url: profile.avatar_url,
      commission_rate: profile.commission_rate,
      is_administrator: profile.is_administrator,
      is_super_admin: profile.is_super_admin,
      role_name: profile.role_name,
      last_login: profile.last_login,
    }))
    .filter(s => 
      s.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.position?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.role_name?.toLowerCase().includes(searchTerm.toLowerCase()) // Added role_name to search
    );

  const handleToggleActive = (member) => {
    if (member.profile_id) {
      updateProfileMutation.mutate({
        id: member.profile_id,
        data: { is_active: !member.is_active }
      });
    }
  };

  const handleToggleWhatsApp = (member) => {
    // This function is no longer triggered by a displayed switch, but kept if needed elsewhere.
    if (member.profile_id) {
      updateProfileMutation.mutate({
        id: member.profile_id,
        data: { whatsapp_enabled: !member.whatsapp_enabled }
      });
    }
  };
  
  const handleEditClick = (email) => {
    navigate(createPageUrl(`StaffProfilePage`) + `?email=${encodeURIComponent(email)}`);
  };

  const handleDelete = (member) => {
    if (window.confirm(`⚠️ ${t.common.delete} ${member.full_name}?\n\n${t.common.confirmDeleteMessage || "This will remove their staff profile but NOT delete their user account."}\n\n${t.common.confirmMessage || "Are you sure?"}`)) {
      deleteProfileMutation.mutate(member.profile_id);
    }
  };

  const [deleteEmail, setDeleteEmail] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [diagnosticMember, setDiagnosticMember] = useState(null);
  const [activityMember, setActivityMember] = useState(null);

  // Fetch role for the diagnostic member
  const { data: diagnosticRoleArr = [], isLoading: isLoadingDiagRole } = useQuery({
    queryKey: ['diagnostic-role', diagnosticMember?.role_id],
    queryFn: () => diagnosticMember?.role_id
      ? base44.entities.StaffRole.filter({ id: diagnosticMember.role_id })
      : [],
    enabled: !!diagnosticMember?.role_id,
    initialData: [],
  });
  const diagnosticRole = diagnosticRoleArr[0] || null;
  // A role is "assigned" if the profile has role_id or role_name, even while the full role loads
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
    const isOwner = myCompany?.created_by === diagnosticMember.email;
    // Mirror the hook's isAdmin logic exactly
    const isIsAdministrator = !!(diagnosticMember.is_administrator);
    const isAdmin = isOwner || diagnosticMember.is_super_admin || isIsAdministrator;
    // hasRole: true if member has a role_id/role_name on profile (even before full role data loads)
    const hasRole = diagnosticHasRole;
    const roleDataLoaded = !!diagnosticRole;

    const check = (feature, cap) => {
      if (isAdmin) return true;
      if (!roleDataLoaded) return null; // null = still loading
      return perms[feature]?.[cap] === true;
    };

    // Summarize which features have view_global enabled in this role
    const globalViewFeatures = roleDataLoaded
      ? Object.entries(perms)
          .filter(([, caps]) => caps?.view_global === true || caps?.view === true)
          .map(([feature]) => feature)
      : [];

    return {
      isAdmin,
      isOwner,
      isIsAdministrator,
      hasRole,
      roleDataLoaded,
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
      alert(t.common.requiredEmail || 'Please enter an email address');
      return;
    }
    
    if (!confirm(`🗑️ ${t.common.delete} ${t.common.authAccount || "authentication account"} ${t.common.for} ${deleteEmail}?\n\n${t.common.reuseEmailMessage || "This will allow the email to be reused."}\n\n${t.common.confirmMessage || "Are you sure?"}`)) {
      return;
    }
    
    setIsDeleting(true);
    try {
      await base44.functions.invoke('deleteUserAccount', { email: deleteEmail });
      alert(`✅ ${t.common.user} ${t.common.account} ${deleteEmail} ${t.common.deletedSuccessfully || "deleted successfully!"}`);
      setDeleteEmail("");
    } catch (error) {
      alert(`❌ ${t.common.failed || "Failed"}: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="p-6 space-y-6 bg-white min-h-screen">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">{t.sidebar.staffManagement}</h1>
        <Button onClick={handleNewStaffClick}>
          <UserPlus className="w-4 h-4 mr-2" />
          {t.common.add} {t.sidebar.staffManagement}
        </Button>
      </div>

      {user && isPlatformAdminCheck(user, myCompany, null) && (
        <Card className="bg-orange-50 border-orange-200">
          <CardContent className="p-4 flex flex-col md:flex-row items-start md:items-center gap-4">
            <div className="bg-orange-100 p-2 rounded-full">
              <AlertCircle className="w-6 h-6 text-orange-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-orange-800">{t.common.delete} Orphaned User Account</h3>
              <p className="text-xs text-orange-700">{t.common.use || "Use"} {t.common.this || "this"} {t.common.to} {t.common.delete} {t.common.user} {t.common.accounts || "accounts"} {t.common.that || "that"} {t.common.dont || "don't"} {t.common.have} {t.sidebar.staffManagement} {t.common.profiles || "profiles"} ({t.common.so} {t.common.you} {t.common.can} {t.common.reuse} {t.common.the} {t.common.email} {t.common.for} {t.common.testing || "testing"})</p>
            </div>
            <div className="flex w-full md:w-auto gap-2">
              <Input 
                placeholder={t.common.email} 
                className="bg-white border-orange-200"
                value={deleteEmail}
                onChange={(e) => setDeleteEmail(e.target.value)}
              />
              <Button 
                variant="destructive" 
                onClick={handleDeleteOrphanedAccount}
                disabled={isDeleting}
              >
                {isDeleting ? t.common.loading : t.common.delete}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
            <Button variant="outline">
                <Download className="w-4 h-4 mr-2"/>
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
                  <th className="p-4 text-left font-semibold text-gray-600">{t.common.name}</th>
                  <th className="p-4 text-left font-semibold text-gray-600">{t.common.email}</th>
                  <th className="p-4 text-left font-semibold text-gray-600">{t.settings.rolesPermissions?.split(' ')[0] || "Role"}</th>
                  <th className="p-4 text-left font-semibold text-gray-600">{t.common.description}</th>
                  <th className="p-4 text-left font-semibold text-gray-600">{t.calendar.lastActivity || "Last Login"}</th>
                  <th className="p-4 text-left font-semibold text-gray-600">Commission %</th>
                  <th className="p-4 text-left font-semibold text-gray-600">{t.common.active}</th>
                  <th className="p-4 text-left font-semibold text-gray-600">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {staff.map((member) => (
                  <tr key={member.profile_id} className="hover:bg-gray-50">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarImage src={member.avatar_url} />
                          <AvatarFallback>{member.full_name?.charAt(0).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div>
                          <span className="font-medium">{member.full_name}</span>
                          {member.is_super_admin && (
                            <Badge className="ml-2 bg-purple-100 text-purple-700 text-xs">{t.sidebar.saasAdmin || "Super Admin"}</Badge>
                          )}
                          {myCompany?.created_by === member.email && !member.is_super_admin && (
                            <Badge className="ml-2 bg-red-100 text-red-700 text-xs">Owner</Badge>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-gray-600">{member.email}</td>
                    <td className="p-4">
                      {member.role_name ? (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700">
                          {member.role_name}
                        </Badge>
                      ) : (
                        <span className="text-gray-400 text-sm">{t.common.na}</span>
                      )}
                    </td>
                    <td className="p-4 text-gray-600">
                        {member.position || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="p-4 text-gray-600">
                        {member.last_login ? (
                            <span>{formatDistanceToNow(new Date(member.last_login), { addSuffix: true })}</span>
                        ) : (
                            <span className="text-gray-400">{t.common.none}</span>
                        )}
                    </td>
                    <td className="p-4">
                      {member.commission_rate ? (
                        <Badge className="bg-green-100 text-green-800 font-semibold">
                          {member.commission_rate}%
                        </Badge>
                      ) : (
                        <span className="text-gray-400 text-sm">{t.common.na}</span>
                      )}
                    </td>
                    <td className="p-4">
                      <Switch
                        checked={member.is_active ?? true}
                        onCheckedChange={() => handleToggleActive(member)}
                      />
                    </td>
                    <td className="p-4">
                      <div className="flex gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEditClick(member.email)} title="Edit staff member">
                          <Edit className="w-4 h-4" />
                        </Button>
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
                          title="Check permissions"
                          className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
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
                      </div>
                    </td>
                  </tr>
                ))}
                {staff.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-12 text-center text-gray-500">
                      <UserPlus className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <h3 className="text-lg font-semibold mb-2">{t.common.noResults}</h3>
                      <p>{t.common.add} {t.sidebar.staffManagement} {t.common.to} {t.common.add} {t.common.your} {t.common.team}</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
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
              {/* Status overview */}
              <div className={`rounded-lg p-3 text-sm space-y-1 ${diagInfo.isAdmin ? 'bg-orange-50 border border-orange-200' : 'bg-blue-50 border border-blue-200'}`}>
                {diagInfo.isOwner && (
                  <p className="font-semibold text-orange-700">Company Owner — has full access to everything</p>
                )}
                {diagInfo.isIsAdministrator && !diagInfo.isOwner && (
                  <p className="font-semibold text-orange-700">
                    ⚠️ is_administrator flag is ON — this bypasses all role permissions.<br />
                    Go to their profile and uncheck "Administrator" to enforce their role.
                  </p>
                )}
                {!diagInfo.isAdmin && diagInfo.hasRole && (
                  <>
                    <p className="text-blue-700">Role: <strong>{diagInfo.roleName}</strong></p>
                    {diagInfo.roleDataLoaded && diagInfo.globalViewFeatures.length > 0 && (
                      <div className="mt-1">
                        <p className="text-xs text-orange-600 font-semibold">Features with "View All" (company-wide) enabled in this role:</p>
                        <p className="text-xs text-orange-700">{diagInfo.globalViewFeatures.join(', ')}</p>
                        <p className="text-xs text-gray-500 mt-1">To restrict staff to only their own records, edit this role and uncheck "View Global" for those features.</p>
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
                    Assign a role in Roles &amp; Permissions to control access.
                  </p>
                )}
              </div>

              {/* Leads permissions */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">Leads Access</h4>
                <PermCheck
                  label="View ALL leads (company-wide)"
                  granted={diagInfo.leadsGlobal}
                  detail={diagInfo.isAdmin ? "via Admin" : diagInfo.leadsGlobal ? "via Role" : ""}
                />
                <PermCheck
                  label="View own assigned leads only"
                  granted={diagInfo.leadsOwn || !diagInfo.leadsGlobal}
                  detail={!diagInfo.hasRole && !diagInfo.isAdmin ? "fallback" : ""}
                />
                <PermCheck label="Create leads" granted={diagInfo.canCreateLeads} />
                <PermCheck label="Edit leads" granted={diagInfo.canEditLeads} />
              </div>

              {/* Customers permissions */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">Customers Access</h4>
                <PermCheck
                  label="View ALL customers (company-wide)"
                  granted={diagInfo.customersGlobal}
                  detail={diagInfo.isAdmin ? "via Admin" : diagInfo.customersGlobal ? "via Role" : ""}
                />
                <PermCheck
                  label="View own assigned customers only"
                  granted={diagInfo.customersOwn || !diagInfo.customersGlobal}
                  detail={!diagInfo.hasRole && !diagInfo.isAdmin ? "fallback" : ""}
                />
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