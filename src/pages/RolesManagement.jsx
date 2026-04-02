import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Edit, Trash2, Shield, Loader2, Save, Wrench } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

const PERMISSION_CONFIG = [
    {
        group: "Core CRM",
        features: [
            { name: "Dashboard", capabilities: ["view_own", "view_global"] },
            { name: "Leads", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
            { name: "Customers", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
            { name: "Estimates", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own", "view_all_templates"] },
            { name: "Proposals", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own", "view_all_templates"] },
            { name: "Invoices", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
            { name: "Payments", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
            { name: "Items", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Projects", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own", "create_timesheets", "edit_milestones"] },
            { name: "Tasks", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own", "edit_timesheets", "delete_own_timesheets", "delete_global_timesheets"] },
            { name: "Reminders", capabilities: ["view_own", "view_global", "create", "edit", "delete"] },
            { name: "Contracts", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
        ],
    },
    {
        group: "AI & Automation",
        features: [
            { name: "AI Estimator", capabilities: ["view", "create", "generate_images", "generate_audio"] },
            { name: "Lexi AI", capabilities: ["view", "chat", "edit_memory"] },
            { name: "Permit Assistant", capabilities: ["view", "generate"] },
            { name: "Daily Reports", capabilities: ["view", "generate"] },
            { name: "AI Staff", capabilities: ["view", "create", "edit"] },
            { name: "Video Training", capabilities: ["view", "create", "generate"] },
            { name: "Workflows", capabilities: ["view", "create", "edit", "delete", "activate"] },
            { name: "Campaigns", capabilities: ["view", "create", "edit", "delete", "send"] },
        ],
    },
    {
        group: "Inspections & Field Work",
        features: [
            { name: "Inspections", capabilities: ["view_own", "view_global", "create", "capture_photos", "edit_own", "delete_own"] },
            { name: "Lead Inspections", capabilities: ["view_own", "create", "edit"] },
            { name: "Drone Analysis", capabilities: ["view", "upload", "analyze"] },
            { name: "Storm Tracking", capabilities: ["view", "generate_leads"] },
            { name: "Property Importer", capabilities: ["view", "import"] },
            { name: "Lead Finder", capabilities: ["view", "search", "export"] },
            { name: "Field Sales Tracker", capabilities: ["view", "track_activity"] },
            { name: "Field Rep App", capabilities: ["view", "log_activity"] },
            { name: "Territory Manager", capabilities: ["view", "create", "edit", "assign"] },
            { name: "Subcontractors", capabilities: ["view", "create", "edit", "delete", "search"] },
        ],
    },
    {
        group: "Communication",
        features: [
            { name: "Communication Hub", capabilities: ["view_own", "view_global", "audio_call", "video_call", "send_sms", "send_email"] },
            { name: "Live Call Dashboard", capabilities: ["view", "view_global"] },
            { name: "Mailbox", capabilities: ["view_own", "view_global", "send", "delete_own"] },
            { name: "Messages", capabilities: ["view_own", "view_global", "send"] },
            { name: "Email Templates", capabilities: ["view", "create", "edit", "delete"] },
            { name: "SMS Templates", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Zoom Meeting", capabilities: ["view", "create"] },
        ],
    },
    {
        group: "Finance & Accounting (⚠️ Restricted)",
        features: [
            { name: "Bills", capabilities: ["view_own", "view_global", "create", "edit", "approve", "delete"] },
            { name: "Accounting Setup", capabilities: ["view", "configure"] },
            { name: "Accounting Dashboard", capabilities: ["view_own", "view_global"] },
            { name: "Transactions", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
            { name: "Journal Entry", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
            { name: "Transfer Funds", capabilities: ["view", "create", "approve"] },
            { name: "Chart of Accounts", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Bank Reconciliation", capabilities: ["view", "reconcile"] },
            { name: "Accounting Reports", capabilities: ["view_own", "view_global", "export"] },
            { name: "Expenses", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
            { name: "Payouts", capabilities: ["view_own", "view_global", "create", "approve", "process"] },
            { name: "Commission Report", capabilities: ["view_own", "view_global"] },
            { name: "Family Commissions", capabilities: ["view_own", "view_global", "create", "edit", "process_payouts"] },
        ],
    },
    {
        group: "Documents & Files",
        features: [
            { name: "Documents", capabilities: ["view_own", "view_global", "upload", "delete_own"] },
            { name: "Contract Templates", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Contract Signing", capabilities: ["view_own", "view_global", "create", "send", "edit", "delete"] },
            { name: "Knowledge Base", capabilities: ["view", "create", "edit", "delete"] },
        ],
    },
    {
        group: "Reports & Analytics",
        features: [
            { name: "Reports", capabilities: ["view_own", "view_global", "view_timesheets_report"] },
            { name: "Analytics Dashboard", capabilities: ["view_own", "view_global"] },
            { name: "Report Builder", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
            { name: "Sales Reports", capabilities: ["view_own", "view_global"] },
            { name: "Sales Dashboard", capabilities: ["view_own", "view_global"] },
            { name: "Competitor Analysis", capabilities: ["view", "create"] },
        ],
    },
    {
        group: "Administrative (🔒 Manager/Admin Only)",
        features: [
            { name: "General Settings", capabilities: ["view", "edit"] },
            { name: "Notification Diagnostics", capabilities: ["view", "run"] },
            { name: "Company Setup", capabilities: ["view", "edit"] },
            { name: "PDF Branding", capabilities: ["view", "edit"] },
            { name: "Report Templates", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Staff Management", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Roles Management", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Round Robin Settings", capabilities: ["view", "edit"] },
            { name: "Templates", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Data Import", capabilities: ["view", "import"] },
            { name: "Task Importer", capabilities: ["view", "import"] },
            { name: "Utilities", capabilities: ["view", "cleanup", "run_repairs"] },
            { name: "Bulk Import", capabilities: ["view", "import"] },
            { name: "Custom Fields", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Menu Setup", capabilities: ["view", "edit"] },
            { name: "Tax Rates", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Integration Manager", capabilities: ["view", "configure"] },
            { name: "Google Chat Settings", capabilities: ["view", "configure"] },
            { name: "Slack Settings", capabilities: ["view", "configure"] },
        ],
    },
    {
        group: "Other Features",
        features: [
            { name: "Calendar", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
            { name: "Activity", capabilities: ["view_own", "view_global"] },
            { name: "Review Requests", capabilities: ["view_own", "view_global", "create", "send"] },
            { name: "Map", capabilities: ["view"] },
            { name: "Subscription", capabilities: ["view", "manage"] },
        ],
    }
];

const formatCapabilityName = (name) => {
    return name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

function PermissionsGrid({ permissions, onPermissionChange, onSelectAll }) {
  const areAllSelected = (groupFeatures) => {
    return groupFeatures.every(feature => {
      const normalizedFeatureKey = feature.name.toLowerCase().replace(/ /g, '_');
      return feature.capabilities.every(cap => permissions?.[normalizedFeatureKey]?.[cap]);
    });
  };

  const handleGroupToggle = (groupFeatures) => {
    const allSelected = areAllSelected(groupFeatures);
    groupFeatures.forEach(feature => {
      feature.capabilities.forEach(capability => {
        const normalizedFeatureKey = feature.name.toLowerCase().replace(/ /g, '_');
        const isCurrentlyChecked = permissions?.[normalizedFeatureKey]?.[capability];
        if (allSelected && isCurrentlyChecked) {
          onPermissionChange(feature.name, capability);
        } else if (!allSelected && !isCurrentlyChecked) {
          onPermissionChange(feature.name, capability);
        }
      });
    });
  };

  return (
    <div className="space-y-8 max-h-[60vh] overflow-y-auto p-1">
      {PERMISSION_CONFIG.map(({ group, features }) => (
        <div key={group}>
          <div className="flex items-center justify-between mb-4 border-b pb-2">
            <h3 className="text-xl font-bold">{group}</h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleGroupToggle(features)}
              className="text-blue-600 hover:text-blue-700"
            >
              {areAllSelected(features) ? 'Deselect All' : 'Select All'}
            </Button>
          </div>
          <div className="space-y-4">
            {features.map(feature => (
              <div key={feature.name} className="grid grid-cols-1 md:grid-cols-5 items-start">
                <span className="font-semibold col-span-1">{feature.name}</span>
                <div className="col-span-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {feature.capabilities.map(capability => (
                    <div key={capability} className="flex items-center gap-2">
                      <Checkbox
                        id={`${feature.name}-${capability}`}
                        checked={permissions?.[feature.name.toLowerCase().replace(/ /g, '_')]?.[capability] || false}
                        onCheckedChange={() => onPermissionChange(feature.name, capability)}
                      />
                      <Label htmlFor={`${feature.name}-${capability}`} className="text-sm font-normal">
                        {formatCapabilityName(capability)}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function RolesManagement() {
  const [user, setUser] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [isRepairingRole, setIsRepairingRole] = useState(false);
  const [repairResult, setRepairResult] = useState(null);

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const myCompany = companies.find(c => c.created_by === user?.email);

  const { data: roles = [], isLoading: isLoadingRoles } = useQuery({
    queryKey: ['staff-roles', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffRole.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  const upsertMutation = useMutation({
    mutationFn: (roleData) => {
      const payload = { ...roleData, company_id: myCompany.id };
      if (editingRole) {
        return base44.entities.StaffRole.update(editingRole.id, payload);
      } else {
        return base44.entities.StaffRole.create(payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-roles'] });
      setIsDialogOpen(false);
      setEditingRole(null);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (roleId) => base44.entities.StaffRole.delete(roleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-roles'] });
    }
  });

  const handleOpenDialog = (role = null) => {
    setEditingRole(role);
    setIsDialogOpen(true);
  };

  const handleDelete = (roleId) => {
    if (window.confirm("Are you sure you want to delete this role? This cannot be undone.")) {
      deleteMutation.mutate(roleId);
    }
  };

  const handleRepairClaimsRole = async () => {
    setIsRepairingRole(true);
    setRepairResult(null);
    try {
      if (!myCompany?.id) {
        setRepairResult({ success: false, message: 'Company not loaded yet — please wait a moment and try again.' });
        return;
      }
      const raw = await base44.functions.invoke('updateClaimsSpecialistRole', { company_id: myCompany.id });
      const result = raw?.data || raw || {};
      setRepairResult({ success: result.success, message: result.message || result.error || JSON.stringify(result) });
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['staff-roles'] });
      }
    } catch (err) {
      setRepairResult({ success: false, message: String(err?.message || err || 'Unknown error') });
    } finally {
      setIsRepairingRole(false);
    }
  };
  
  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Roles Management</h1>
          <p className="text-gray-500 mt-1">Create and manage staff roles with granular permissions</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleRepairClaimsRole} disabled={isRepairingRole} className="text-amber-700 border-amber-300 hover:bg-amber-50" data-testid="button-repair-claims-role">
            {isRepairingRole ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wrench className="w-4 h-4 mr-2" />}
            Fix Claims Specialist Permissions
          </Button>
          <Button onClick={() => handleOpenDialog()} data-testid="button-create-role">
            <Plus className="w-4 h-4 mr-2" />
            Create New Role
          </Button>
        </div>
      </div>

      {repairResult && (
        <div className={`p-4 rounded-lg text-sm font-semibold border-2 ${repairResult.success ? 'bg-green-100 text-green-900 border-green-400' : 'bg-red-100 text-red-900 border-red-400'}`}>
          {repairResult.message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All Roles</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingRoles ? (
            <div className="flex justify-center items-center h-32">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : roles.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Shield className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-semibold">No Roles Created Yet</h3>
              <p className="text-sm mb-4">Click "Create New Role" to set up roles like Claims Specialist, Office Manager, Sales Rep, etc.</p>
              <Button onClick={() => handleOpenDialog()}>
                <Plus className="w-4 h-4 mr-2" />
                Create New Role
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {roles.map(role => (
                <div key={role.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                  <div>
                    <span className="font-semibold text-gray-800">{role.name}</span>
                    {role.description && (
                      <p className="text-sm text-gray-500 mt-1">{role.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleOpenDialog(role)}>
                      <Edit className="w-4 h-4 mr-2" /> Edit
                    </Button>
                    <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => handleDelete(role.id)}>
                      <Trash2 className="w-4 h-4 mr-2" /> Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      
      <RoleFormDialog 
        isOpen={isDialogOpen} 
        onOpenChange={setIsDialogOpen}
        role={editingRole}
        onSave={upsertMutation.mutate}
        isLoading={upsertMutation.isPending}
      />
    </div>
  );
}

function RoleFormDialog({ isOpen, onOpenChange, role, onSave, isLoading }) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [permissions, setPermissions] = useState({});

    useEffect(() => {
        if (isOpen && role) {
            setName(role.name);
            setDescription(role.description || '');
            setPermissions(role.permissions || {});
        } else if (isOpen && !role) {
            setName('');
            setDescription('');
            setPermissions({});
        }
    }, [isOpen, role]);

    const handlePermissionChange = (featureKey, capability) => {
        setPermissions(p => {
          const newPermissions = JSON.parse(JSON.stringify(p));
          const normalizedFeatureKey = featureKey.toLowerCase().replace(/ /g, '_');
          if (!newPermissions[normalizedFeatureKey]) newPermissions[normalizedFeatureKey] = {};
          newPermissions[normalizedFeatureKey][capability] = !newPermissions[normalizedFeatureKey][capability];
          return newPermissions;
        });
    };
    
    const handleSave = () => {
        if (!name.trim()) {
            alert("Role name is required.");
            return;
        }
        onSave({ name, description, permissions });
    };
    
    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{role ? `Edit Role: ${role.name}` : 'Create New Role'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div>
                        <Label htmlFor="role-name" className="text-lg font-semibold">Role Name *</Label>
                        <Input 
                            id="role-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g., Claims Specialist, Office Manager, Sales Rep"
                            className="mt-2 text-base"
                        />
                    </div>
                    <div>
                        <Label htmlFor="role-description" className="text-lg font-semibold">Description (Optional)</Label>
                        <Input 
                            id="role-description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Brief description of this role"
                            className="mt-2 text-base"
                        />
                    </div>
                    <div className="border-t pt-4">
                        <Label className="text-lg font-semibold mb-4 block">Permissions</Label>
                        <PermissionsGrid permissions={permissions} onPermissionChange={handlePermissionChange} />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button onClick={handleSave} disabled={isLoading}>
                        {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        <Save className="w-4 h-4 mr-2" />
                        Save Role
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}