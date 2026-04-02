import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bell, Plus, X, Save, MapPin, Mail, MessageSquare, Target, Info, Trash2, Building2, ChevronDown, ChevronUp } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/components/ui/use-toast";

const OFFICE_COLORS = ["#3b82f6", "#14b8a6", "#22c55e", "#a855f7", "#f97316"];
const MAX_OFFICES = 5;
const MAX_AREAS_PER_OFFICE = 10;

function generateOfficeId() {
  return `office_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
}

function defaultOffice(overrides = {}) {
  return {
    id: generateOfficeId(),
    name: '',
    location: '',
    radius_miles: 60,
    service_areas: [],
    ...overrides,
  };
}

function OfficeCard({ office, index, total, onChange, onRemove }) {
  const [expanded, setExpanded] = useState(true);
  const [newAreaInput, setNewAreaInput] = useState('');
  const color = OFFICE_COLORS[index % OFFICE_COLORS.length];

  const handleAddAreas = () => {
    if (!newAreaInput.trim()) return;
    const parts = newAreaInput.split(',').map(p => p.trim()).filter(Boolean);
    const remaining = MAX_AREAS_PER_OFFICE - (office.service_areas || []).length;
    if (remaining <= 0) return;
    const toAdd = parts.slice(0, remaining);
    onChange({ ...office, service_areas: [...(office.service_areas || []), ...toAdd] });
    setNewAreaInput('');
  };

  const handleRemoveArea = (i) => {
    onChange({ ...office, service_areas: office.service_areas.filter((_, idx) => idx !== i) });
  };

  return (
    <Card className="border-2" style={{ borderColor: color }}>
      <CardHeader className="py-3 px-4 cursor-pointer" onClick={() => setExpanded(e => !e)}
        style={{ backgroundColor: `${color}10` }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="font-semibold text-gray-900">
              {office.name || `Office ${index + 1}`}
            </span>
            {office.location && (
              <span className="text-sm text-gray-500">— {office.location}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {total > 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                data-testid={`button-remove-office-${index}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
            {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Office Name</Label>
              <Input
                placeholder={`e.g., Cleveland HQ`}
                value={office.name}
                onChange={(e) => onChange({ ...office, name: e.target.value })}
                data-testid={`input-office-name-${index}`}
              />
              <p className="text-xs text-gray-400 mt-1">Label for this location</p>
            </div>
            <div>
              <Label>Location (City, State)</Label>
              <Input
                placeholder="e.g., Cleveland, OH"
                value={office.location}
                onChange={(e) => onChange({ ...office, location: e.target.value })}
                data-testid={`input-office-location-${index}`}
              />
              <p className="text-xs text-gray-400 mt-1">Center of monitoring radius</p>
            </div>
            <div>
              <Label>Radius (miles)</Label>
              <Input
                type="number"
                min={10}
                max={300}
                value={office.radius_miles}
                onChange={(e) => onChange({ ...office, radius_miles: parseInt(e.target.value) || 60 })}
                data-testid={`input-office-radius-${index}`}
              />
              <p className="text-xs text-gray-400 mt-1">Monitoring range from this office</p>
            </div>
          </div>

          <div>
            <Label className="flex items-center gap-2">
              Additional Counties / Cities
              <span className="text-xs text-gray-400 font-normal">
                ({(office.service_areas || []).length}/{MAX_AREAS_PER_OFFICE} used)
              </span>
            </Label>
            <p className="text-xs text-gray-500 mb-2">
              Specific counties or cities outside the radius to also monitor (comma-separated).
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="e.g., Cuyahoga, Summit, Medina"
                value={newAreaInput}
                onChange={(e) => setNewAreaInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddAreas()}
                disabled={(office.service_areas || []).length >= MAX_AREAS_PER_OFFICE}
                data-testid={`input-office-areas-${index}`}
              />
              <Button
                variant="outline"
                onClick={handleAddAreas}
                disabled={(office.service_areas || []).length >= MAX_AREAS_PER_OFFICE}
                data-testid={`button-add-area-${index}`}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {(office.service_areas || []).map((area, i) => (
                <Badge key={i} variant="secondary" className="px-3 py-1 text-sm">
                  {area}
                  <button onClick={() => handleRemoveArea(i)} className="ml-2 hover:text-red-600">
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
              {(office.service_areas || []).length === 0 && (
                <span className="text-xs text-gray-400 italic">No specific areas added</span>
              )}
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-xs text-gray-600">
              <span className="font-medium" style={{ color }}>●</span>
              {' '}<strong>{office.name || `Office ${index + 1}`}</strong> monitors a{' '}
              <strong>{office.radius_miles || 60} mile</strong> radius from{' '}
              <strong>{office.location || 'location not set'}</strong>
              {(office.service_areas || []).length > 0 && `, plus ${office.service_areas.length} specific area${office.service_areas.length > 1 ? 's' : ''}`}.
            </p>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function StormAlertSettings() {
  const [user, setUser] = useState(null);
  const { toast } = useToast();
  const [staffTypeFilter, setStaffTypeFilter] = useState('all');
  const [customRoleInput, setCustomRoleInput] = useState('');
  const [showCustomRoleInput, setShowCustomRoleInput] = useState(false);
  const isDirty = useRef(false);
  const settingsRef = useRef(null);
  const currentSettingsRef = useRef(null);

  const [settings, setSettings] = useState({
    office_locations: [defaultOffice({ name: 'Primary Office' })],
    min_severity: 'severe',
    enable_email_alerts: true,
    enable_sms_alerts: true,
    alert_recipients: [],
    auto_generate_leads: false,
    storm_types_to_monitor: ['hail', 'tornado', 'high_wind', 'thunderstorm', 'general_advisory'],
    notified_storm_ids: [],
  });

  const [newRecipient, setNewRecipient] = useState({
    name: '',
    email: '',
    phone: '',
    recipient_type: 'staff',
    notify_email: true,
    notify_sms: false
  });

  const queryClient = useQueryClient();

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
    const owned = companies.find(c => c.created_by === user?.email);
    if (owned) return owned;
    if (staffProfiles.length > 0) {
      const companyId = staffProfiles[0].company_id;
      return companies.find(c => c.id === companyId);
    }
    return null;
  }, [companies, staffProfiles, user?.email]);

  // Query all company staff for alert recipient selection
  const { data: companyStaff = [] } = useQuery({
    queryKey: ['company-staff', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  // Build unique role list from actual staff (role_name, role, job_title)
  const staffRoleOptions = React.useMemo(() => {
    const seen = new Set();
    const roles = [];
    companyStaff.forEach(s => {
      const r = s.role_name || s.role || s.job_title;
      if (r && !seen.has(r.toLowerCase())) {
        seen.add(r.toLowerCase());
        roles.push(r);
      }
    });
    return roles;
  }, [companyStaff]);

  // Filter staff by selected type
  const filteredStaff = React.useMemo(() => {
    if (staffTypeFilter === 'all') return companyStaff;
    return companyStaff.filter(s => {
      const roleStr = (s.role_name || s.role || s.job_title || '').toLowerCase();
      return roleStr.includes(staffTypeFilter.toLowerCase());
    });
  }, [companyStaff, staffTypeFilter]);

  const { data: alertSettings = [] } = useQuery({
    queryKey: ['storm-alert-settings', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StormAlertSettings.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
    refetchOnWindowFocus: false,
    staleTime: 60000,
  });

  const currentSettings = alertSettings[0];

  // Keep currentSettingsRef always in sync
  useEffect(() => {
    currentSettingsRef.current = currentSettings;
  }, [currentSettings]);

  // Keep settingsRef always in sync with state
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (currentSettings && !isDirty.current) {
      let officeLocations = currentSettings.office_locations;

      // Migrate legacy single-office fields if office_locations not yet saved
      if (!officeLocations || officeLocations.length === 0) {
        officeLocations = [
          defaultOffice({
            name: 'Primary Office',
            location: currentSettings.service_center_location || '',
            radius_miles: currentSettings.service_radius_miles || 60,
            service_areas: currentSettings.service_areas || [],
          })
        ];
      }

      setSettings({
        office_locations: officeLocations,
        min_severity: currentSettings.min_severity || currentSettings.alert_severity_threshold || 'severe',
        notified_storm_ids: currentSettings.notified_storm_ids || [],
        enable_email_alerts: currentSettings.enable_email_alerts ?? true,
        enable_sms_alerts: currentSettings.enable_sms_alerts ?? true,
        alert_recipients: currentSettings.alert_recipients || [],
        auto_generate_leads: currentSettings.auto_generate_leads ?? false,
        storm_types_to_monitor: currentSettings.storm_types_to_monitor || ['hail', 'tornado', 'high_wind', 'thunderstorm', 'general_advisory']
      });
    }
  }, [currentSettings]);

  const saveSettingsMutation = useMutation({
    mutationFn: async (data) => {
      // Always read from refs to avoid stale closure issues
      const loadedEntity = currentSettingsRef.current;
      if (loadedEntity?.id) {
        // Merge notified_storm_ids with server's latest value to prevent cron-overwrite race:
        // if the cron appended new IDs while the user had settings open, preserve them.
        try {
          const fresh = await base44.entities.StormAlertSettings.filter({ id: loadedEntity.id });
          if (fresh?.[0]?.notified_storm_ids?.length > 0) {
            const merged = [...new Set([
              ...(fresh[0].notified_storm_ids || []),
              ...(data.notified_storm_ids || []),
            ])];
            data = { ...data, notified_storm_ids: merged.slice(-500) };
          }
        } catch (e) {}
        return await base44.entities.StormAlertSettings.update(loadedEntity.id, data);
      } else {
        const cid = myCompany?.id || localStorage.getItem('last_used_company_id');
        return await base44.entities.StormAlertSettings.create({ ...data, company_id: cid });
      }
    },
    onSuccess: (savedEntity) => {
      isDirty.current = false;
      // Update the ref so subsequent saves use the correct ID
      if (savedEntity?.id) currentSettingsRef.current = savedEntity;
      // Update the cache directly instead of invalidating to avoid the
      // refetch→useEffect→state-reset race condition
      if (savedEntity) {
        queryClient.setQueryData(
          ['storm-alert-settings', myCompany?.id],
          (old) => old ? [savedEntity, ...old.slice(1)] : [savedEntity]
        );
      }
      toast({
        title: "Settings saved",
        description: "Storm alert settings updated successfully.",
      });
    },
    onError: (error) => {
      console.error('[StormAlertSettings] Save error:', error);
      toast({
        title: "Failed to save settings",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const handleOfficeChange = (index, updated) => {
    const newOffices = [...settings.office_locations];
    newOffices[index] = updated;
    setSettings({ ...settings, office_locations: newOffices });
  };

  const handleAddOffice = () => {
    if (settings.office_locations.length >= MAX_OFFICES) {
      toast({
        title: "Maximum offices reached",
        description: `You can configure up to ${MAX_OFFICES} office locations.`,
        variant: "destructive",
      });
      return;
    }
    setSettings({
      ...settings,
      office_locations: [...settings.office_locations, defaultOffice({ name: `Office ${settings.office_locations.length + 1}` })]
    });
  };

  const handleRemoveOffice = (index) => {
    if (settings.office_locations.length <= 1) return;
    setSettings({
      ...settings,
      office_locations: settings.office_locations.filter((_, i) => i !== index)
    });
  };

  const handleAddRecipient = () => {
    if (newRecipient.name && (newRecipient.email || newRecipient.phone)) {
      isDirty.current = true;
      setSettings(prev => ({
        ...prev,
        alert_recipients: [...(prev.alert_recipients || []), newRecipient]
      }));
      setNewRecipient({ name: '', email: '', phone: '', recipient_type: 'staff', notify_email: true, notify_sms: false });
    }
  };

  const handleAddStaffAsRecipient = (staff) => {
    const already = settings.alert_recipients.some(r => r.email && r.email === staff.email);
    if (already) {
      toast({ title: "Already added", description: `${staff.name || staff.email} is already in the list.`, variant: "destructive" });
      return;
    }
    const newRec = {
      name: staff.name || staff.email || 'Staff Member',
      email: staff.email || '',
      phone: staff.phone || '',
      recipient_type: staff.role_name || staff.role || staff.job_title || 'staff',
      notify_email: true,
      notify_sms: !!staff.phone
    };
    isDirty.current = true;
    setSettings(prev => ({
      ...prev,
      alert_recipients: [...prev.alert_recipients, newRec]
    }));
    toast({
      title: "Added",
      description: `${newRec.name} added to alert recipients`
    });
  };

  const handleRemoveRecipient = (index) => {
    isDirty.current = true;
    setSettings(prev => ({
      ...prev,
      alert_recipients: prev.alert_recipients.filter((_, i) => i !== index)
    }));
  };

  const toggleStormType = (type) => {
    const types = settings.storm_types_to_monitor;
    setSettings({
      ...settings,
      storm_types_to_monitor: types.includes(type) ? types.filter(t => t !== type) : [...types, type]
    });
  };

  const handleSave = () => {
    if (!myCompany) {
      toast({
        title: "No company found",
        description: "Please set up your company profile first.",
        variant: "destructive",
      });
      return;
    }
    // Read from ref to guarantee we get the absolutely latest state
    const latestSettings = settingsRef.current || settings;
    const primaryOffice = latestSettings.office_locations?.[0] || {};

    // Sync office_locations[0] → legacy fields for backward compat
    const dataToSave = {
      ...latestSettings,
      service_center_location: primaryOffice.location || '',
      service_radius_miles: primaryOffice.radius_miles || 60,
      service_areas: primaryOffice.service_areas || [],
    };
    console.log('[StormAlertSettings] Saving:', { recipients: dataToSave.alert_recipients?.length, id: currentSettingsRef.current?.id });
    saveSettingsMutation.mutate(dataToSave);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
          <Bell className="w-7 h-7 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Storm Alert Settings</h1>
          <p className="text-gray-500 mt-1">Configure automatic notifications for storms in your service areas</p>
        </div>
      </div>

      <Alert className="bg-blue-50 border-blue-200">
        <AlertDescription>
          <strong>How it works:</strong> Add up to 5 office locations. When storms hit within any office's radius, you'll automatically receive email/SMS alerts with storm details and the option to generate leads instantly.
        </AlertDescription>
      </Alert>

      {/* Office Locations */}
      <Card className="bg-white shadow-md">
        <CardHeader className="border-b bg-gray-50">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              Office Locations
              <Badge variant="outline" className="ml-2 bg-blue-50 text-blue-700 border-blue-200">
                {settings.office_locations.length}/{MAX_OFFICES} Offices
              </Badge>
            </CardTitle>
            <Button
              onClick={handleAddOffice}
              disabled={settings.office_locations.length >= MAX_OFFICES}
              variant="outline"
              size="sm"
              data-testid="button-add-office"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Office
            </Button>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Configure up to {MAX_OFFICES} office or branch locations. Storm tracking monitors all of them simultaneously.
          </p>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          {settings.office_locations.map((office, index) => (
            <OfficeCard
              key={office.id || index}
              office={office}
              index={index}
              total={settings.office_locations.length}
              onChange={(updated) => handleOfficeChange(index, updated)}
              onRemove={() => handleRemoveOffice(index)}
            />
          ))}
          {settings.office_locations.length < MAX_OFFICES && (
            <button
              onClick={handleAddOffice}
              className="w-full border-2 border-dashed border-gray-300 rounded-lg py-4 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors flex items-center justify-center gap-2"
              data-testid="button-add-office-dashed"
            >
              <Plus className="w-4 h-4" />
              Add another office location ({MAX_OFFICES - settings.office_locations.length} remaining)
            </button>
          )}
        </CardContent>
      </Card>

      {/* Storm Types */}
      <Card className="bg-white shadow-md">
        <CardHeader className="border-b bg-gray-50">
          <CardTitle>Storm Types to Monitor</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {['hail', 'tornado', 'high_wind', 'thunderstorm', 'flood', 'winter_storm', 'tropical', 'general_advisory'].map(type => (
              <div key={type} className="flex items-center gap-3 p-3 border rounded-lg">
                <Switch
                  checked={settings.storm_types_to_monitor.includes(type)}
                  onCheckedChange={() => toggleStormType(type)}
                  id={`storm-type-${type}`}
                />
                <Label className="capitalize cursor-pointer" htmlFor={`storm-type-${type}`}>
                  {type.replace(/_/g, ' ')}
                </Label>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Alert Settings */}
      <Card className="bg-white shadow-md">
        <CardHeader className="border-b bg-gray-50">
          <CardTitle>Alert Settings</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div>
            <Label>Minimum Severity Level</Label>
            <Select
              value={settings.min_severity}
              onValueChange={(value) => setSettings({...settings, min_severity: value})}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Storms (includes Advisories)</SelectItem>
                <SelectItem value="minor">Minor or Higher</SelectItem>
                <SelectItem value="moderate">Moderate or Higher</SelectItem>
                <SelectItem value="severe">Severe or Higher</SelectItem>
                <SelectItem value="extreme">Extreme Only</SelectItem>
              </SelectContent>
            </Select>
            <Alert variant="default" className="mt-2 text-sm bg-yellow-50 border-yellow-200 text-yellow-800">
              <Info className="h-4 w-4" />
              <AlertTitle>Tip</AlertTitle>
              <AlertDescription>
                To see "Advisories" and "Watches", set severity to "All Storms" or "Minor".
              </AlertDescription>
            </Alert>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Enable Email Alerts</Label>
              <p className="text-sm text-gray-500">Send storm notifications via email</p>
            </div>
            <Switch
              checked={settings.enable_email_alerts}
              onCheckedChange={(checked) => setSettings({...settings, enable_email_alerts: checked})}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Enable SMS Alerts</Label>
              <p className="text-sm text-gray-500">Send storm notifications via text message</p>
            </div>
            <Switch
              checked={settings.enable_sms_alerts}
              onCheckedChange={(checked) => setSettings({...settings, enable_sms_alerts: checked})}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Auto-Generate Leads</Label>
              <p className="text-sm text-gray-500">Automatically create leads when storms hit your areas</p>
            </div>
            <Switch
              checked={settings.auto_generate_leads}
              onCheckedChange={(checked) => setSettings({...settings, auto_generate_leads: checked})}
            />
          </div>
        </CardContent>
      </Card>

      {/* Alert Recipients */}
      <Card className="bg-white shadow-md">
        <CardHeader className="border-b bg-gray-50">
          <CardTitle>Alert Recipients</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Name</Label>
              <Input
                placeholder="John Doe"
                value={newRecipient.name}
                onChange={(e) => setNewRecipient({...newRecipient, name: e.target.value})}
              />
            </div>

            <div>
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="john@example.com"
                value={newRecipient.email}
                onChange={(e) => setNewRecipient({...newRecipient, email: e.target.value})}
              />
            </div>

            <div>
              <Label>Phone (for SMS)</Label>
              <Input
                placeholder="+1 (555) 123-4567"
                value={newRecipient.phone}
                onChange={(e) => setNewRecipient({...newRecipient, phone: e.target.value})}
              />
            </div>

            <div className="flex items-end gap-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={newRecipient.notify_email}
                  onCheckedChange={(checked) => setNewRecipient({...newRecipient, notify_email: checked})}
                />
                <Label>Email</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={newRecipient.notify_sms}
                  onCheckedChange={(checked) => setNewRecipient({...newRecipient, notify_sms: checked})}
                />
                <Label>SMS</Label>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleAddRecipient} className="flex-1" data-testid="button-add-recipient">
              <Plus className="w-4 h-4 mr-2" />
              Add Manual Recipient
            </Button>
          </div>

          {/* Staff Type Filter & Quick-Add */}
          <div className="border-t pt-4 mt-4">
            <Label className="text-sm font-semibold mb-2 block">Quick-Add Staff by Role</Label>
            <Select value={staffTypeFilter} onValueChange={(v) => { if (v === '__custom__') { setShowCustomRoleInput(true); } else { setStaffTypeFilter(v); setShowCustomRoleInput(false); } }}>
              <SelectTrigger className="w-full mb-2">
                <SelectValue placeholder="Filter staff by role..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Staff</SelectItem>
                {staffRoleOptions.map((role) => (
                  <SelectItem key={role} value={role}>{role}</SelectItem>
                ))}
                {staffRoleOptions.length === 0 && (
                  <>
                    <SelectItem value="sales rep">Sales Reps</SelectItem>
                    <SelectItem value="field agent">Field Agents</SelectItem>
                    <SelectItem value="staff">Staff</SelectItem>
                  </>
                )}
                <SelectItem value="__custom__">+ Search by custom role name...</SelectItem>
              </SelectContent>
            </Select>
            {showCustomRoleInput && (
              <div className="flex gap-2 mb-3">
                <Input
                  placeholder="Type role name (e.g. Insurance Claims Specialist)"
                  value={customRoleInput}
                  onChange={e => setCustomRoleInput(e.target.value)}
                  className="flex-1"
                  data-testid="input-custom-role"
                />
                <Button
                  size="sm"
                  onClick={() => { setStaffTypeFilter(customRoleInput); setShowCustomRoleInput(false); }}
                  disabled={!customRoleInput.trim()}
                  data-testid="button-apply-custom-role"
                >
                  Apply
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowCustomRoleInput(false); setCustomRoleInput(''); setStaffTypeFilter('all'); }}>
                  Cancel
                </Button>
              </div>
            )}
            {staffTypeFilter !== 'all' && (
              <p className="text-xs text-blue-600 mb-2">
                Filtering by: <strong>{staffTypeFilter}</strong> — {filteredStaff.length} staff member{filteredStaff.length !== 1 ? 's' : ''}
              </p>
            )}

            {filteredStaff.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                {filteredStaff.map((staff, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 border rounded bg-blue-50 hover:bg-blue-100">
                    <div className="text-sm flex-1 min-w-0">
                      <p className="font-medium truncate">{staff.name || staff.email}</p>
                      <p className="text-xs text-gray-600">{staff.role_name || staff.role || staff.job_title || 'Staff'}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleAddStaffAsRecipient(staff)}
                      className="ml-1 flex-shrink-0"
                      data-testid={`button-add-staff-${idx}`}
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recipients List */}
          <div className="space-y-2 mt-4">
            {settings.alert_recipients.map((recipient, index) => (
              <div key={index} className="flex items-center justify-between p-3 border rounded-lg bg-gray-50">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{recipient.name}</p>
                    {recipient.recipient_type && <Badge variant="outline" className="text-xs">{recipient.recipient_type}</Badge>}
                  </div>
                  <div className="flex gap-3 text-sm text-gray-600 mt-1">
                    {recipient.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        {recipient.email}
                      </span>
                    )}
                    {recipient.phone && (
                      <span className="flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" />
                        {recipient.phone}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveRecipient(index)}
                  data-testid={`button-remove-recipient-${index}`}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          {settings.alert_recipients.length === 0 && (
            <p className="text-sm text-gray-400 italic">No recipients configured yet</p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          className="bg-blue-600 hover:bg-blue-700"
          disabled={saveSettingsMutation.isPending}
          data-testid="button-save-settings"
        >
          <Save className="w-4 h-4 mr-2" />
          {saveSettingsMutation.isPending ? "Saving..." : "Save Alert Settings"}
        </Button>
      </div>
    </div>
  );
}
