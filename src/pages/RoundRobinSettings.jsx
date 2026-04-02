import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Save, Users, Clock, Calendar, Check, X, UserX } from "lucide-react";
import { toast } from "sonner";

export default function RoundRobinSettings() {
  const [user, setUser] = useState(null);
  const [myCompany, setMyCompany] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  useEffect(() => {
    if (user && companies.length > 0) {
      const ownedCompany = companies.find(c => c.created_by === user.email);
      if (ownedCompany) setMyCompany(ownedCompany);
    }
  }, [user, companies]);

  const { data: allStaffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', myCompany?.id],
    queryFn: () => myCompany
      ? base44.entities.StaffProfile.filter({ company_id: myCompany.id })
      : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const staffProfiles = allStaffProfiles.filter(s => s.is_active !== false);

  const { data: settings = [] } = useQuery({
    queryKey: ['round-robin-settings', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.RoundRobinSettings.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const currentSettings = settings[0];

  const [formData, setFormData] = useState({
    enabled: false,
    assignment_type: 'leads',
    eligible_staff: [],
    excluded_staff: [],
    skip_weekends: false,
    business_hours_only: false,
    business_hours_start: '09:00',
    business_hours_end: '17:00',
  });

  useEffect(() => {
    if (currentSettings) {
      setFormData({
        enabled: currentSettings.enabled || false,
        assignment_type: currentSettings.assignment_type || 'leads',
        eligible_staff: currentSettings.eligible_staff || [],
        excluded_staff: currentSettings.excluded_staff || [],
        skip_weekends: currentSettings.skip_weekends || false,
        business_hours_only: currentSettings.business_hours_only || false,
        business_hours_start: currentSettings.business_hours_start || '09:00',
        business_hours_end: currentSettings.business_hours_end || '17:00',
      });
    }
  }, [currentSettings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data = { company_id: myCompany.id, ...formData };
      if (currentSettings) {
        return await base44.entities.RoundRobinSettings.update(currentSettings.id, data);
      } else {
        return await base44.entities.RoundRobinSettings.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['round-robin-settings'] });
      toast.success('Round robin settings saved!');
    },
    onError: (error) => {
      toast.error('Failed to save: ' + error.message);
    }
  });

  function getStaffState(email) {
    if (formData.excluded_staff.includes(email)) return 'excluded';
    if (formData.eligible_staff.includes(email)) return 'eligible';
    return 'neutral';
  }

  function setStaffState(email, state) {
    setFormData(prev => {
      let eligible = [...prev.eligible_staff];
      let excluded = [...prev.excluded_staff];

      eligible = eligible.filter(e => e !== email);
      excluded = excluded.filter(e => e !== email);

      if (state === 'eligible') eligible.push(email);
      if (state === 'excluded') excluded.push(email);

      return { ...prev, eligible_staff: eligible, excluded_staff: excluded };
    });
  }

  const visibleStaff = staffProfiles.filter(s => getStaffState(s.user_email) !== 'excluded');
  const excludedStaff = staffProfiles.filter(s => getStaffState(s.user_email) === 'excluded');

  if (!myCompany) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-gray-500">Loading company data...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <RefreshCw className="w-8 h-8 text-blue-600" />
            Round Robin Settings
          </h1>
          <p className="text-gray-600 mt-1">Automatically distribute leads to your sales team</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Enable Round Robin</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base">Automatic Assignment</Label>
              <p className="text-sm text-gray-500">Turn on round robin distribution</p>
            </div>
            <Switch
              checked={formData.enabled}
              onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
              data-testid="switch-rr-enabled"
            />
          </div>

          {formData.enabled && (
            <>
              <div className="border-t pt-6 space-y-4">
                <div>
                  <Label>Assignment Type</Label>
                  <Select
                    value={formData.assignment_type}
                    onValueChange={(value) => setFormData({ ...formData, assignment_type: value })}
                  >
                    <SelectTrigger data-testid="select-assignment-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="leads">Leads Only</SelectItem>
                      <SelectItem value="customers">Customers Only</SelectItem>
                      <SelectItem value="both">Both Leads & Customers</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="flex items-center gap-2 mb-1">
                    <Users className="w-4 h-4" />
                    Eligible Staff Members ({formData.eligible_staff.length} in rotation)
                  </Label>
                  <p className="text-xs text-gray-400 mb-3">
                    Click a person to include them in rotation. Use <UserX className="w-3 h-3 inline" /> to deactivate them — they'll be hidden from this list.
                  </p>
                  <div className="border rounded-lg divide-y max-h-72 overflow-y-auto">
                    {visibleStaff.length === 0 && (
                      <p className="text-center text-gray-500 py-6 text-sm">
                        No active staff members found.
                      </p>
                    )}
                    {visibleStaff.map(staff => {
                      const state = getStaffState(staff.user_email);
                      const isEligible = state === 'eligible';
                      return (
                        <div
                          key={staff.user_email}
                          className={`flex items-center justify-between px-4 py-3 transition-colors ${
                            isEligible ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'
                          }`}
                          data-testid={`row-staff-${staff.user_email}`}
                        >
                          <button
                            className="flex items-center gap-3 flex-1 text-left"
                            onClick={() => setStaffState(staff.user_email, isEligible ? 'neutral' : 'eligible')}
                            data-testid={`toggle-staff-${staff.user_email}`}
                          >
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                              isEligible ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                            }`}>
                              {isEligible && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <div>
                              <p className="font-medium text-sm">{staff.full_name || staff.name || staff.user_email}</p>
                              <p className="text-xs text-gray-500">{staff.role || staff.position || 'Staff Member'}</p>
                            </div>
                          </button>
                          <button
                            onClick={() => setStaffState(staff.user_email, 'excluded')}
                            className="ml-3 p-1.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
                            title="Deactivate — hide from round robin"
                            data-testid={`deactivate-staff-${staff.user_email}`}
                          >
                            <UserX className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {excludedStaff.length > 0 && (
                  <div>
                    <Label className="text-sm text-gray-500 flex items-center gap-2 mb-2">
                      <UserX className="w-4 h-4" />
                      Deactivated ({excludedStaff.length}) — not eligible for round robin
                    </Label>
                    <div className="border rounded-lg divide-y bg-gray-50">
                      {excludedStaff.map(staff => (
                        <div
                          key={staff.user_email}
                          className="flex items-center justify-between px-4 py-2.5"
                          data-testid={`row-excluded-${staff.user_email}`}
                        >
                          <div>
                            <p className="text-sm text-gray-500 line-through">{staff.full_name || staff.name || staff.user_email}</p>
                            <p className="text-xs text-gray-400">{staff.role || staff.position || 'Staff Member'}</p>
                          </div>
                          <button
                            onClick={() => setStaffState(staff.user_email, 'neutral')}
                            className="text-xs text-blue-600 hover:underline"
                            data-testid={`reactivate-staff-${staff.user_email}`}
                          >
                            Reactivate
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="border-t pt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        Skip Weekends
                      </Label>
                      <p className="text-sm text-gray-500">Don't assign on Saturday/Sunday</p>
                    </div>
                    <Switch
                      checked={formData.skip_weekends}
                      onCheckedChange={(checked) => setFormData({ ...formData, skip_weekends: checked })}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        Business Hours Only
                      </Label>
                      <p className="text-sm text-gray-500">Only assign during work hours</p>
                    </div>
                    <Switch
                      checked={formData.business_hours_only}
                      onCheckedChange={(checked) => setFormData({ ...formData, business_hours_only: checked })}
                    />
                  </div>

                  {formData.business_hours_only && (
                    <div className="grid grid-cols-2 gap-4 pl-8">
                      <div>
                        <Label>Start Time</Label>
                        <Input
                          type="time"
                          value={formData.business_hours_start}
                          onChange={(e) => setFormData({ ...formData, business_hours_start: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>End Time</Label>
                        <Input
                          type="time"
                          value={formData.business_hours_end}
                          onChange={(e) => setFormData({ ...formData, business_hours_end: e.target.value })}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end pt-4 border-t">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
              data-testid="button-save-rr-settings"
            >
              {saveMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Settings
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {currentSettings && (
        <Card>
          <CardHeader>
            <CardTitle>Current Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Status:</span>
                <Badge className={currentSettings.enabled ? 'bg-green-600' : 'bg-gray-400'}>
                  {currentSettings.enabled ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Last Assigned Index:</span>
                <span className="font-medium">{currentSettings.last_assigned_index || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Next Assignment:</span>
                <span className="font-medium">
                  {currentSettings.eligible_staff?.[((currentSettings.last_assigned_index || 0) + 1) % (currentSettings.eligible_staff?.length || 1)] || 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">In Rotation:</span>
                <span className="font-medium">{currentSettings.eligible_staff?.length || 0} staff</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
