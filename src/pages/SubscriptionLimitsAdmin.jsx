import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Users, Users2, Target, Edit2, Check, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

export default function SubscriptionLimitsAdmin() {
  const [user, setUser] = useState(null);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [overrideDialogs, setOverrideDialogs] = useState({});

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['saas-companies'],
    queryFn: () => base44.asServiceRole.entities.Company.list("-created_date", 100),
    enabled: !!user && user.platform_role === 'super_admin',
  });

  const { data: limitsData = {} } = useQuery({
    queryKey: ['company-limits', selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany) return {};
      
      const staffCount = await base44.asServiceRole.entities.StaffProfile.filter({ 
        company_id: selectedCompany.id 
      });
      const customerCount = await base44.asServiceRole.entities.Customer.filter({ 
        company_id: selectedCompany.id 
      });
      const leadCount = await base44.asServiceRole.entities.Lead.filter({ 
        company_id: selectedCompany.id 
      });

      // Get limits from backend
      const staffLimits = await base44.functions.invoke('checkSubscriptionLimits', {
        company_id: selectedCompany.id,
        entity_type: 'staff'
      });
      const customerLimits = await base44.functions.invoke('checkSubscriptionLimits', {
        company_id: selectedCompany.id,
        entity_type: 'customer'
      });
      const leadLimits = await base44.functions.invoke('checkSubscriptionLimits', {
        company_id: selectedCompany.id,
        entity_type: 'lead'
      });

      return {
        staff: staffLimits.data,
        customers: customerLimits.data,
        leads: leadLimits.data,
      };
    },
    enabled: !!selectedCompany?.id,
  });

  const handleSetOverride = async (entityType, newLimit, reason) => {
    try {
      await base44.functions.invoke('setSubscriptionOverride', {
        company_id: selectedCompany.id,
        entity_type: entityType,
        override_value: newLimit,
        reason: reason
      });
      toast.success(`Override set: ${entityType} → ${newLimit}`);
      setOverrideDialogs(prev => ({ ...prev, [entityType]: false }));
      // Refetch limits
      window.location.reload();
    } catch (error) {
      toast.error(`Failed: ${error.message}`);
    }
  };

  if (user?.platform_role !== 'super_admin') {
    return (
      <div className="p-6">
        <Alert>
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>Access denied - SaaS admin only</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl">
      <h1 className="text-3xl font-bold mb-6">Subscription Limits Management</h1>

      <div className="grid md:grid-cols-3 gap-4 mb-6">
        {companies.map(company => (
          <button
            key={company.id}
            onClick={() => setSelectedCompany(company)}
            className={`p-4 rounded-lg border-2 transition-all text-left ${
              selectedCompany?.id === company.id
                ? 'border-blue-600 bg-blue-50'
                : 'border-gray-200 hover:border-gray-400'
            }`}
          >
            <h3 className="font-semibold">{company.company_name}</h3>
            <p className="text-sm text-gray-600">{company.subscription_plan}</p>
          </button>
        ))}
      </div>

      {selectedCompany && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">{selectedCompany.company_name}</h2>
          <p className="text-gray-600">Plan: <Badge>{selectedCompany.subscription_plan}</Badge></p>

          <div className="grid md:grid-cols-3 gap-4">
            {/* Staff/Users */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Team Members
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-gray-600">Current Usage</p>
                  <p className="text-2xl font-bold">
                    {limitsData.staff?.current_count || 0} / {limitsData.staff?.limit || '?'}
                  </p>
                  <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        limitsData.staff?.is_at_limit ? 'bg-red-500' : 'bg-green-500'
                      }`}
                      style={{
                        width: `${Math.min(100, (limitsData.staff?.current_count || 0) / (limitsData.staff?.limit || 1) * 100)}%`
                      }}
                    />
                  </div>
                </div>
                {limitsData.staff?.has_override && (
                  <Alert>
                    <Check className="w-4 h-4" />
                    <AlertDescription className="text-sm">
                      <strong>Override Active:</strong> {limitsData.staff?.override_reason}
                    </AlertDescription>
                  </Alert>
                )}
                <OverrideDialog
                  entityType="staff"
                  currentLimit={limitsData.staff?.limit}
                  onSet={(limit, reason) => handleSetOverride('staff', limit, reason)}
                  isOpen={overrideDialogs.staff}
                  onOpenChange={(open) => setOverrideDialogs(prev => ({ ...prev, staff: open }))}
                />
              </CardContent>
            </Card>

            {/* Customers */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users2 className="w-5 h-5" />
                  Customers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-gray-600">Current Usage</p>
                  <p className="text-2xl font-bold">
                    {limitsData.customers?.current_count || 0} / {limitsData.customers?.limit || '?'}
                  </p>
                  <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        limitsData.customers?.is_at_limit ? 'bg-red-500' : 'bg-green-500'
                      }`}
                      style={{
                        width: `${Math.min(100, (limitsData.customers?.current_count || 0) / (limitsData.customers?.limit || 1) * 100)}%`
                      }}
                    />
                  </div>
                </div>
                {limitsData.customers?.has_override && (
                  <Alert>
                    <Check className="w-4 h-4" />
                    <AlertDescription className="text-sm">
                      <strong>Override Active:</strong> {limitsData.customers?.override_reason}
                    </AlertDescription>
                  </Alert>
                )}
                <OverrideDialog
                  entityType="customer"
                  currentLimit={limitsData.customers?.limit}
                  onSet={(limit, reason) => handleSetOverride('customer', limit, reason)}
                  isOpen={overrideDialogs.customer}
                  onOpenChange={(open) => setOverrideDialogs(prev => ({ ...prev, customer: open }))}
                />
              </CardContent>
            </Card>

            {/* Leads */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="w-5 h-5" />
                  Leads
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-gray-600">Current Usage</p>
                  <p className="text-2xl font-bold">
                    {limitsData.leads?.current_count || 0} / {limitsData.leads?.limit || '?'}
                  </p>
                  <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        limitsData.leads?.is_at_limit ? 'bg-red-500' : 'bg-green-500'
                      }`}
                      style={{
                        width: `${Math.min(100, (limitsData.leads?.current_count || 0) / (limitsData.leads?.limit || 1) * 100)}%`
                      }}
                    />
                  </div>
                </div>
                {limitsData.leads?.has_override && (
                  <Alert>
                    <Check className="w-4 h-4" />
                    <AlertDescription className="text-sm">
                      <strong>Override Active:</strong> {limitsData.leads?.override_reason}
                    </AlertDescription>
                  </Alert>
                )}
                <OverrideDialog
                  entityType="lead"
                  currentLimit={limitsData.leads?.limit}
                  onSet={(limit, reason) => handleSetOverride('lead', limit, reason)}
                  isOpen={overrideDialogs.lead}
                  onOpenChange={(open) => setOverrideDialogs(prev => ({ ...prev, lead: open }))}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function OverrideDialog({ entityType, currentLimit, onSet, isOpen, onOpenChange }) {
  const [newLimit, setNewLimit] = useState(currentLimit);
  const [reason, setReason] = useState('Great subscriber');

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full" size="sm">
          <Edit2 className="w-4 h-4 mr-2" />
          Set Override
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override {entityType} Limit</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-semibold">New Limit</label>
            <Input
              type="number"
              value={newLimit}
              onChange={(e) => setNewLimit(parseInt(e.target.value) || 0)}
              min="0"
            />
          </div>
          <div>
            <label className="text-sm font-semibold">Reason</label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Great subscriber, seasonal promotion, etc."
            />
          </div>
          <Button
            onClick={() => onSet(newLimit, reason)}
            className="w-full"
          >
            Confirm Override
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}