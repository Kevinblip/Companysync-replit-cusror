import * as React from "react";
const { useState } = React;
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Edit2, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function SubscriptionLimitsAdmin({ companies = [] }) {
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [overrideDialog, setOverrideDialog] = useState(false);
  const [entityType, setEntityType] = useState("staff");
  const [overrideValue, setOverrideValue] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const queryClient = useQueryClient();

  const { data: limitsData = {} } = useQuery({
    queryKey: ['subscription-limits', selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany?.id) return {};

      const response = await base44.functions.invoke('checkSubscriptionLimits', {
        company_id: selectedCompany.id,
        entity_type: 'all'
      });

      return response.data || {};
    },
    enabled: !!selectedCompany?.id
  });

  // AI/SMS/Call usage from SubscriptionUsage (same source as Dashboard.jsx)
  const { data: subscriptionUsage = [] } = useQuery({
    queryKey: ['subscription-usage-admin', selectedCompany?.id],
    queryFn: () => selectedCompany?.id
      ? base44.entities.SubscriptionUsage.filter({ company_id: selectedCompany.id })
      : [],
    enabled: !!selectedCompany?.id,
  });

  // Plan-based limits (mirrors Dashboard.jsx logic)
  const PLAN_LIMITS = {
    trial:    { ai: 50,    sms: 10,   calls: 5 },
    basic:    { ai: 1000,  sms: 200,  calls: 50 },
    business: { ai: 5000,  sms: 1000, calls: 200 },
    enterprise: { ai: -1,   sms: -1,   calls: -1 },
    legacy:   { ai: -1,    sms: -1,   calls: -1 },
    lifetime: { ai: -1,    sms: -1,   calls: -1 },
    unlimited:{ ai: -1,    sms: -1,   calls: -1 },
    professional: { ai: 10000, sms: 2000, calls: 500 },
  };

  const planName = selectedCompany?.subscription_plan || 'trial';
  const planLimits = PLAN_LIMITS[planName] || PLAN_LIMITS.trial;

  const usageMonth = new Date().toISOString().slice(0, 7);
  const monthUsage = (Array.isArray(subscriptionUsage) ? subscriptionUsage : []).filter(u => u.usage_month === usageMonth);
  const aiUsed = monthUsage.filter(u => u.feature === 'lexi' || u.feature === 'ai').reduce((s, u) => s + (u.units || 1), 0);
  const smsUsed = monthUsage.filter(u => u.feature === 'sms_ai' || u.feature === 'sms').reduce((s, u) => s + (u.units || 1), 0);
  const callUsed = monthUsage.filter(u => u.feature === 'sarah').reduce((s, u) => s + (u.units || 1), 0);

  // Enrich limitsData with the real plan-based usage numbers
  const enrichedLimits = {
    ...limitsData,
    ai_used: aiUsed,
    ai_limit: planLimits.ai,
    sms_used: smsUsed,
    sms_limit: planLimits.sms,
    call_minutes_used: callUsed,
    call_minutes_limit: planLimits.calls,
  };

  const setOverrideMutation = useMutation({
    mutationFn: async ({ companyId, entityType, overrideValue, reason }) => {
      const response = await base44.functions.invoke('setSubscriptionOverride', {
        company_id: companyId,
        entity_type: entityType,
        override_value: parseInt(overrideValue),
        reason
      });
      return response.data;
    },
    onSuccess: () => {
      toast.success('Override set successfully');
      setOverrideDialog(false);
      setOverrideValue("");
      setOverrideReason("");
      queryClient.invalidateQueries({ queryKey: ['subscription-limits'] });
    },
    onError: (error) => {
      toast.error('Failed to set override: ' + error.message);
    }
  });

  const removeOverrideMutation = useMutation({
    mutationFn: async ({ companyId, entityType }) => {
      const response = await base44.functions.invoke('setSubscriptionOverride', {
        company_id: companyId,
        entity_type: entityType,
        override_value: null,
        reason: 'Override removed'
      });
      return response.data;
    },
    onSuccess: () => {
      toast.success('Override removed');
      queryClient.invalidateQueries({ queryKey: ['subscription-limits'] });
    },
    onError: (error) => {
      toast.error('Failed to remove override: ' + error.message);
    }
  });

  const getProgressColor = (percentage) => {
    if (percentage < 50) return 'bg-green-500';
    if (percentage < 80) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const renderLimitStatus = (label, current, limit, override) => {
    if (!limit || limit === -1) {
      return (
        <div className="flex items-center justify-between p-3 border rounded-lg bg-gray-50">
          <span className="font-medium">{label}</span>
          <span className="text-sm text-gray-600">Unlimited</span>
        </div>
      );
    }

    const percentage = (current / limit) * 100;
    const displayLimit = override || limit;

    return (
      <div className="border rounded-lg p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-medium">{label}</span>
          <span className="text-sm text-gray-600">
            {current} / {displayLimit}
            {override && <span className="text-xs text-blue-600 ml-2">(Override: {override})</span>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${getProgressColor(percentage)}`}
              style={{ width: `${Math.min(percentage, 100)}%` }}
            />
          </div>
          <span className="text-xs text-gray-600 font-semibold">{Math.round(percentage)}%</span>
        </div>
        {override && (
          <div className="flex gap-2 mt-2">
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={() => {
                setEntityType(label.toLowerCase().replace(' ', '_'));
                setOverrideDialog(true);
              }}
            >
              <Edit2 className="w-3 h-3 mr-1" />
              Edit Override
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-xs text-red-600"
              onClick={() => {
                removeOverrideMutation.mutate({
                  companyId: selectedCompany.id,
                  entityType: label.toLowerCase().replace(' ', '_')
                });
              }}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Company Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Company</CardTitle>
        </CardHeader>
        <CardContent>
          <select
            value={selectedCompany?.id || ''}
            onChange={(e) => {
              const company = companies.find(c => c.id === e.target.value);
              setSelectedCompany(company);
            }}
            className="w-full px-3 py-2 border rounded-lg"
          >
            <option value="">-- Select a company --</option>
            {companies.map(company => (
              <option key={company.id} value={company.id}>
                {company.company_name} ({company.subscription_plan || 'trial'})
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {/* Limits Display */}
      {selectedCompany && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-blue-600" />
              Subscription Limits for {selectedCompany.company_name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {renderLimitStatus(
                'Staff Members',
                limitsData.users_current || 0,
                limitsData.users_limit || selectedCompany.max_users || 5,
                limitsData.users_override
              )}
              {renderLimitStatus(
                'Customers',
                limitsData.customers_current || 0,
                limitsData.customers_limit || selectedCompany.max_customers || 1000,
                limitsData.customers_override
              )}
              {renderLimitStatus(
                'Leads',
                limitsData.leads_current || 0,
                limitsData.leads_limit || -1,
                limitsData.leads_override
              )}
            </div>

            {/* AI / SMS / Call Usage */}
            {limitsData.success && (
              <div className="mt-4 pt-4 border-t">
                <h4 className="font-semibold text-sm text-gray-700 mb-3">AI / SMS / Call Usage (from SubscriptionUsage)</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {renderLimitStatus(
                    'AI Interactions',
                    enrichedLimits.ai_used ?? 0,
                    enrichedLimits.ai_limit <= 0 ? -1 : enrichedLimits.ai_limit,
                    null
                  )}
                  {renderLimitStatus(
                    'SMS Messages',
                    enrichedLimits.sms_used ?? 0,
                    enrichedLimits.sms_limit <= 0 ? -1 : enrichedLimits.sms_limit,
                    null
                  )}
                  {renderLimitStatus(
                    'Call Minutes',
                    Math.round(enrichedLimits.call_minutes_used ?? 0),
                    enrichedLimits.call_minutes_limit <= 0 ? -1 : enrichedLimits.call_minutes_limit,
                    null
                  )}
                </div>
                {(enrichedLimits.ai_limit <= 0 && enrichedLimits.sms_limit <= 0 && enrichedLimits.call_minutes_limit <= 0) && (
                  <p className="text-xs text-green-600 mt-2">✓ Unlimited plan — no usage caps.</p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setEntityType('staff');
                  setOverrideDialog(true);
                }}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Set Override
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Override Dialog */}
      <Dialog open={overrideDialog} onOpenChange={setOverrideDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Subscription Override</DialogTitle>
          </DialogHeader>

          {selectedCompany && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="entity-type">Entity Type</Label>
                <select
                  id="entity-type"
                  value={entityType}
                  onChange={(e) => setEntityType(e.target.value)}
                  className="w-full mt-2 px-3 py-2 border rounded-lg"
                >
                  <option value="staff">Staff Members</option>
                  <option value="customers">Customers</option>
                  <option value="leads">Leads</option>
                </select>
              </div>

              <div>
                <Label htmlFor="override-value">New Limit (0 for unlimited)</Label>
                <Input
                  id="override-value"
                  type="number"
                  value={overrideValue}
                  onChange={(e) => setOverrideValue(e.target.value)}
                  placeholder="Enter new limit"
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="reason">Reason for Override</Label>
                <Textarea
                  id="reason"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g., VIP customer, extended trial"
                  className="mt-2"
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!overrideValue || !overrideReason.trim()) {
                  toast.error('Please fill in all fields');
                  return;
                }
                setOverrideMutation.mutate({
                  companyId: selectedCompany.id,
                  entityType,
                  overrideValue,
                  reason: overrideReason
                });
              }}
              disabled={setOverrideMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {setOverrideMutation.isPending ? 'Setting...' : 'Set Override'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}