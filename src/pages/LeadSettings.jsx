import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, UserPlus } from "lucide-react";
import useTranslation from "@/hooks/useTranslation";

export default function LeadSettings() {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
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

  const [leadSettings, setLeadSettings] = useState({
    kanban_limit: 50,
    default_status: 'new',
    default_source: 'manual',
    validation_fields: [],
    auto_assign_admin_on_convert: true,
    allow_non_admin_import: false,
    default_kanban_sort: 'last_contact',
    do_not_allow_edit_after_convert: false,
    kanban_sort_ascending: true,
  });

  useEffect(() => {
    if (myCompany?.settings?.leads) {
      setLeadSettings({ ...leadSettings, ...myCompany.settings.leads });
    }
  }, [myCompany]);

  const updateMutation = useMutation({
    mutationFn: (data) => {
      const currentSettings = myCompany.settings || {};
      return base44.entities.Company.update(myCompany.id, { 
        settings: { ...currentSettings, leads: data } 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      alert('✅ ' + t.settings.saved);
    },
  });

  const handleSave = () => {
    updateMutation.mutate(leadSettings);
  };

  if (!myCompany) return <div className="p-6">{t.common.loading}</div>;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.leads.title} {t.settings.title}</h1>
          <p className="text-gray-500 mt-1">Configure lead management preferences</p>
        </div>
        <Button onClick={handleSave} className="bg-green-600 hover:bg-green-700">
          <Save className="w-4 h-4 mr-2" />
          {t.settings.saveChanges}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lead Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Limit leads kanban rows per status</Label>
            <Input
              type="number"
              value={leadSettings.kanban_limit}
              onChange={(e) => setLeadSettings({...leadSettings, kanban_limit: parseInt(e.target.value)})}
            />
          </div>

          <div>
            <Label>Default Lead Status</Label>
            <Select value={leadSettings.default_status} onValueChange={(v) => setLeadSettings({...leadSettings, default_status: v})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">{t.common.new}</SelectItem>
                <SelectItem value="contacted">{t.leads.contacted}</SelectItem>
                <SelectItem value="qualified">{t.leads.qualified}</SelectItem>
                <SelectItem value="proposal">Proposal</SelectItem>
                <SelectItem value="negotiation">{t.leads.negotiation}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Default Lead Source</Label>
            <Select value={leadSettings.default_source} onValueChange={(v) => setLeadSettings({...leadSettings, default_source: v})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="website">{t.customers.website}</SelectItem>
                <SelectItem value="referral">{t.customers.referral}</SelectItem>
                <SelectItem value="social_media">{t.customers.socialMedia}</SelectItem>
                <SelectItem value="advertisement">{t.customers.advertisement}</SelectItem>
                <SelectItem value="cold_call">{t.customers.coldCall}</SelectItem>
                <SelectItem value="storm_tracker">{t.customers.stormTracker}</SelectItem>
                <SelectItem value="property_importer">{t.customers.propertyImporter}</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Default leads kanban sort</Label>
            <div className="flex gap-2">
              <Select value={leadSettings.default_kanban_sort} onValueChange={(v) => setLeadSettings({...leadSettings, default_kanban_sort: v})} className="flex-1">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="last_contact">{t.customers.lastContact}</SelectItem>
                  <SelectItem value="created_date">{t.customers.createdDate}</SelectItem>
                  <SelectItem value="name">{t.common.name}</SelectItem>
                  <SelectItem value="value">{t.leads.value}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={leadSettings.kanban_sort_ascending ? 'ascending' : 'descending'} onValueChange={(v) => setLeadSettings({...leadSettings, kanban_sort_ascending: v === 'ascending'})}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ascending">Ascending</SelectItem>
                  <SelectItem value="descending">Descending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between py-3 border-t">
            <div>
              <Label className="text-base">Auto assign an admin to customer after convert</Label>
            </div>
            <Switch
              checked={leadSettings.auto_assign_admin_on_convert}
              onCheckedChange={(v) => setLeadSettings({...leadSettings, auto_assign_admin_on_convert: v})}
            />
          </div>

          <div className="flex items-center justify-between py-3 border-t">
            <div>
              <Label className="text-base">Allow non-admin staff members to import leads</Label>
            </div>
            <Switch
              checked={leadSettings.allow_non_admin_import}
              onCheckedChange={(v) => setLeadSettings({...leadSettings, allow_non_admin_import: v})}
            />
          </div>

          <div className="flex items-center justify-between py-3 border-t">
            <div>
              <Label className="text-base">Do not allow leads to be edited after they are converted to customers</Label>
              <p className="text-sm text-gray-500">Administrators not applied</p>
            </div>
            <Switch
              checked={leadSettings.do_not_allow_edit_after_convert}
              onCheckedChange={(v) => setLeadSettings({...leadSettings, do_not_allow_edit_after_convert: v})}
            />
          </div>
        </CardContent>
      </Card>
      <div className="pt-4 text-xs text-gray-400">
        {t.common.lastActivity}: {new Date().toLocaleDateString()}
      </div>
    </div>
  );
}