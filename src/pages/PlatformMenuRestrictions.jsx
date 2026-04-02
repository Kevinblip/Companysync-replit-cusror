import React, { useState, useEffect, useMemo } from "react";
import { isPlatformAdminCheck } from "@/hooks/usePlatformAdmin";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Lock, Unlock, Save, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function PlatformMenuRestrictions() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [restrictedItems, setRestrictedItems] = useState([]);
  const [restrictedSubmenuItems, setRestrictedSubmenuItems] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [], isFetched: companiesFetched } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list(),
    initialData: [],
  });

  const myCompany = companies.find(c => c.created_by === user?.email);
  const isPlatformOwner = isPlatformAdminCheck(user, myCompany, null);

  const { data: platformSettings = [] } = useQuery({
    queryKey: ['platform-menu-settings'],
    queryFn: () => base44.entities.PlatformMenuSettings.list(),
    initialData: [],
  });

  const currentSettings = platformSettings[0];

  useEffect(() => {
    if (currentSettings) {
      setRestrictedItems(currentSettings.restricted_items || []);
      setRestrictedSubmenuItems(currentSettings.restricted_submenu_items || []);
    }
  }, [currentSettings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data = {
        restricted_items: restrictedItems,
        restricted_submenu_items: restrictedSubmenuItems,
        last_updated_by: user.email,
        notes: `Updated on ${new Date().toLocaleString()}`
      };

      if (currentSettings) {
        return base44.entities.PlatformMenuSettings.update(currentSettings.id, data);
      } else {
        return base44.entities.PlatformMenuSettings.create(data);
      }
    },
    onSuccess: () => {
      toast.success('Platform restrictions saved! All subscribers will be affected.');
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: ['platform-menu-settings'] });
    },
    onError: (error) => {
      toast.error('Failed to save: ' + error.message);
    }
  });

  // All menu items available in the system
  const allMenuItems = useMemo(() => [
    { id: 'dashboard', title: 'Dashboard' },
    { 
      id: 'ai-tools', 
      title: 'AI Tools',
      submenu: [
        { id: 'ai-estimator', title: 'AI Estimator' },
        { id: 'lexi', title: 'Lexi AI Assistant' },
        { id: 'lexi-memory', title: 'Lexi Memory' },
        { id: 'permit-assistant', title: 'Permit Assistant' },
        { id: 'daily-reports', title: 'Daily Reports' },
        { id: 'ai-staff', title: 'AI Team' },
        { id: 'ai-training', title: 'AI Memory' },
        { id: 'video-training', title: 'Video Training Generator' },
      ]
    },
    { 
      id: 'lead-manager', 
      title: 'Lead Manager',
      submenu: [
        { id: 'all-leads', title: 'All Leads' },
        { id: 'lead-finder', title: 'Lead Finder' },
        { id: 'lead-inspections', title: 'Lead Inspections' },
        { id: 'storm-tracking', title: 'Storm Tracking' },
      ]
    },
    { 
      id: 'sales', 
      title: 'Sales',
      submenu: [
        { id: 'customers', title: 'Customers' },
        { id: 'sales-dashboard', title: 'Sales Dashboard' },
        { id: 'estimates', title: 'Estimates' },
        { id: 'proposals', title: 'Proposals' },
        { id: 'invoices', title: 'Invoices' },
        { id: 'payments', title: 'Payments' },
        { id: 'items', title: 'Items & Pricing' },
        { id: 'commissions', title: 'Commission Tracker' },
        { id: 'family-commissions', title: 'Family Commissions' },
      ]
    },
    { 
      id: 'accounting', 
      title: 'Accounting',
      submenu: [
        { id: 'accounting-setup', title: 'Setup Wizard' },
        { id: 'accounting-dashboard', title: 'Dashboard' },
        { id: 'bills', title: 'Bills & Payables' },
        { id: 'transactions', title: 'Transactions' },
        { id: 'journal-entry', title: 'Journal Entry' },
        { id: 'transfer', title: 'Transfer' },
        { id: 'chart-of-accounts', title: 'Chart of Accounts' },
        { id: 'reconcile', title: 'Reconcile' },
        { id: 'reports', title: 'Reports' },
        { id: 'expenses', title: 'Expenses' },
        { id: 'payouts', title: 'Payouts' },
      ]
    },
    { 
      id: 'field-operations', 
      title: 'Field Operations',
      submenu: [
        { id: 'field-sales-tracker', title: 'Field Sales Tracker' },
        { id: 'field-rep-app', title: 'Work Territory' },
        { id: 'territory-manager', title: 'Territory Manager' },
      ]
    },
    { 
      id: 'operations', 
      title: 'Operations',
      submenu: [
        { id: 'crewcam-dashboard', title: 'CrewCam Dashboard' },
        { id: 'new-crewcam', title: 'New CrewCam Job' },
        { id: 'crewcam-capture', title: 'CrewCam Capture' },
        { id: 'ai-damage', title: 'AI Damage Analysis' },
        { id: 'subcontractors', title: 'Subcontractors' },
        { id: 'tasks', title: 'Tasks' },
        { id: 'review-requests', title: 'Review Requests' },
        { id: 'reminders', title: 'Reminders' },
        { id: 'projects', title: 'Projects' },
        { id: 'activity', title: 'Activity Feed' },
      ]
    },
    { id: 'smart-glasses', title: 'Smart Glasses' },
    { id: 'calendar', title: 'Calendar' },
    { 
      id: 'communication', 
      title: 'Communication',
      submenu: [
        { id: 'live-call-dashboard', title: 'Live Call Dashboard' },
        { id: 'communication-hub', title: 'Communication Hub' },
        { id: 'campaigns', title: 'Campaign Manager' },
        { id: 'ad-builder', title: 'Ad Builder' },
        { id: 'workflow-automation', title: 'Workflow Automation' },
        { id: 'ai-dashboard', title: 'AI Dashboard' },
        { id: 'mailbox', title: 'Mailbox' },
        { id: 'messages', title: 'Messages' },
        { id: 'zoom', title: 'Zoom Meeting' },
      ]
    },
    { 
      id: 'documents', 
      title: 'Documents',
      submenu: [
        { id: 'all-documents', title: 'All Documents' },
        { id: 'contracts', title: 'Contracts' },
        { id: 'contract-templates', title: 'Contract Templates' },
        { id: 'contract-signing', title: 'Contract Signing' },
      ]
    },
    { 
      id: 'reports', 
      title: 'Reports',
      submenu: [
        { id: 'analytics-dashboard', title: 'Analytics' },
        { id: 'report-builder', title: 'Report Builder' },
        { id: 'sales-reports', title: 'Sales Reports' },
        { id: 'competitor-analysis', title: 'Competitor Analysis' },
      ]
    },
    { id: 'map', title: 'Map' },
    { id: 'knowledge-base', title: 'Knowledge Base' },
    { id: 'subscription', title: 'Subscription' },
    { id: 'feature-comparison', title: 'Feature Comparison' },
    { id: 'coming-soon', title: 'Coming Soon' },
  ], []);

  const isItemRestricted = (itemId) => {
    return restrictedItems.some(r => r.id === itemId);
  };

  const isSubmenuRestricted = (parentId, submenuId) => {
    return restrictedSubmenuItems.some(r => r.parent_id === parentId && r.submenu_id === submenuId);
  };

  const toggleItemRestriction = (itemId, itemTitle) => {
    if (isItemRestricted(itemId)) {
      setRestrictedItems(prev => prev.filter(r => r.id !== itemId));
    } else {
      setRestrictedItems(prev => [...prev, { 
        id: itemId, 
        reason: `Hidden by ${user?.email} on ${new Date().toLocaleDateString()}`
      }]);
    }
    setHasChanges(true);
  };

  const toggleSubmenuRestriction = (parentId, parentTitle, submenuId, submenuTitle) => {
    if (isSubmenuRestricted(parentId, submenuId)) {
      setRestrictedSubmenuItems(prev => 
        prev.filter(r => !(r.parent_id === parentId && r.submenu_id === submenuId))
      );
    } else {
      setRestrictedSubmenuItems(prev => [...prev, { 
        parent_id: parentId,
        submenu_id: submenuId,
        reason: `Hidden by ${user?.email} on ${new Date().toLocaleDateString()}`
      }]);
    }
    setHasChanges(true);
  };

  useEffect(() => {
    if (user && companiesFetched && !isPlatformOwner) {
      navigate(createPageUrl('Dashboard'), { replace: true });
    }
  }, [user, companiesFetched, isPlatformOwner, navigate]);

  if (!user || !companiesFetched) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (!isPlatformOwner) {
    return null;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Shield className="w-8 h-8 text-red-600" />
            Platform Menu Restrictions
          </h1>
          <p className="text-gray-600 mt-2">
            Control what menu items ALL subscribers can see. These restrictions override individual company settings.
          </p>
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!hasChanges || saveMutation.isPending}
          className="bg-red-600 hover:bg-red-700"
        >
          <Save className="w-4 h-4 mr-2" />
          {saveMutation.isPending ? 'Saving...' : 'Save Restrictions'}
        </Button>
      </div>

      {hasChanges && (
        <Alert className="bg-yellow-50 border-yellow-200">
          <AlertTriangle className="w-4 h-4 text-yellow-600" />
          <AlertDescription className="text-yellow-800">
            ⚠️ You have unsaved changes. Click "Save Restrictions" to apply them platform-wide.
          </AlertDescription>
        </Alert>
      )}

      <Alert className="bg-red-50 border-red-200">
        <Lock className="w-4 h-4 text-red-600" />
        <AlertDescription className="text-red-900">
          <strong>🔒 Security Notice:</strong> Items you hide here will be COMPLETELY INVISIBLE to all subscribers. 
          They cannot unhide them. Use this to protect sensitive features like SaaS Admin Dashboard, Utilities, etc.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Menu Items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {allMenuItems.map((item) => (
            <div key={item.id} className="border rounded-lg">
              {/* Parent Item */}
              <div className={`flex items-center justify-between p-4 ${
                isItemRestricted(item.id) ? 'bg-red-50' : 'bg-white hover:bg-gray-50'
              }`}>
                <div className="flex items-center gap-3">
                  <Lock className={`w-4 h-4 ${isItemRestricted(item.id) ? 'text-red-600' : 'text-gray-400'}`} />
                  <div>
                    <div className="font-medium text-gray-900">
                      {item.title}
                      {isItemRestricted(item.id) && (
                        <Badge variant="destructive" className="ml-2 text-xs">Platform Hidden</Badge>
                      )}
                    </div>
                    {item.submenu && (
                      <div className="text-xs text-gray-500 mt-1">
                        {item.submenu.length} submenu items
                        {restrictedSubmenuItems.filter(r => r.parent_id === item.id).length > 0 && (
                          <span className="text-red-600 ml-2">
                            ({restrictedSubmenuItems.filter(r => r.parent_id === item.id).length} hidden)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleItemRestriction(item.id, item.title)}
                  className={isItemRestricted(item.id) ? 'text-red-600 hover:text-red-700' : 'text-gray-600'}
                >
                  {isItemRestricted(item.id) ? (
                    <>
                      <EyeOff className="w-4 h-4 mr-2" />
                      Hidden from All
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4 mr-2" />
                      Visible to All
                    </>
                  )}
                </Button>
              </div>

              {/* Submenu Items */}
              {item.submenu && (
                <div className="border-t bg-gray-50">
                  {item.submenu.map((subitem) => (
                    <div
                      key={subitem.id}
                      className={`flex items-center justify-between px-4 py-3 pl-12 border-b last:border-b-0 ${
                        isSubmenuRestricted(item.id, subitem.id) ? 'bg-red-50' : 'hover:bg-gray-100'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                        <div>
                          <div className="text-sm text-gray-700">
                            {subitem.title}
                            {isSubmenuRestricted(item.id, subitem.id) && (
                              <Badge variant="destructive" className="ml-2 text-xs">Platform Hidden</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleSubmenuRestriction(item.id, item.title, subitem.id, subitem.title)}
                        className={`text-xs ${
                          isSubmenuRestricted(item.id, subitem.id) ? 'text-red-600 hover:text-red-700' : 'text-gray-600'
                        }`}
                        disabled={isItemRestricted(item.id)}
                      >
                        {isSubmenuRestricted(item.id, subitem.id) ? (
                          <>
                            <EyeOff className="w-3 h-3 mr-1" />
                            Hidden
                          </>
                        ) : (
                          <>
                            <Eye className="w-3 h-3 mr-1" />
                            Visible
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Alert className="bg-blue-50 border-blue-200">
        <AlertDescription className="text-blue-900">
          <strong>💡 How This Works:</strong>
          <ul className="mt-2 space-y-1 ml-4 list-disc text-sm">
            <li><strong>Platform Restrictions:</strong> Items you hide here are invisible to ALL subscribers (cannot be overridden)</li>
            <li><strong>Subscriber Settings:</strong> Each subscriber can still hide/show items NOT restricted by the platform</li>
            <li><strong>Layered Security:</strong> Platform restrictions → Subscription plan limits → Company menu settings → Role permissions</li>
            <li><strong>Example:</strong> Hide "SaaS Admin Dashboard" here = no subscriber will ever see it</li>
          </ul>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Current Restrictions Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Total Restricted Parent Items:</span>
              <Badge variant="destructive">{restrictedItems.length}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Total Restricted Submenu Items:</span>
              <Badge variant="destructive">{restrictedSubmenuItems.length}</Badge>
            </div>
            {currentSettings?.last_updated_by && (
              <div className="flex items-center justify-between text-sm pt-2 border-t">
                <span className="text-gray-600">Last Updated By:</span>
                <span className="font-medium">{currentSettings.last_updated_by}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}