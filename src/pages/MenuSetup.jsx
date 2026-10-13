import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch"; // This import is not used in the updated code, but preserving as it was in original
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { GripVertical, Save, RotateCcw, Eye, EyeOff } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { applyEditorToLegacyMenu, applySavedMenuToEditor, buildSidebarEditorTree, captureSidebarOrder } from "@/lib/sidebarNav";

export default function MenuSetup() {
  const [user, setUser] = useState(null);
  const [menuItems, setMenuItems] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
  });

  // Get staff profile to find company
  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
  });

  // Find company - impersonation > staff profile > owned
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

  const { data: menuSettings = [] } = useQuery({
    queryKey: ['menu-settings', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.MenuSettings.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  const currentSettings = menuSettings[0];

  // Default menu structure - matches Layout.js navigation items
  const defaultMenuItems = useMemo(() => [
    { id: 'dashboard', title: 'Dashboard', enabled: true, order: 0 },
    { id: 'my-assignments', title: 'My Assignments', enabled: true, order: 0.2 },
    
    // AI Tools
    {
      id: 'ai-tools',
      title: 'AI Tools',
      enabled: true,
      order: 1,
      hasSubmenu: true,
      submenuItems: [
        { id: 'ai-estimator', title: 'AI Estimator', enabled: true },
        { id: 'lexi', title: 'Lexi AI Assistant', enabled: true },
        { id: 'lexi-memory', title: 'Lexi Memory', enabled: true },
        { id: 'permit-assistant', title: 'Permit Assistant', enabled: true },
        { id: 'daily-reports', title: 'Daily Reports', enabled: true },
        { id: 'ai-staff', title: 'AI Team', enabled: true },
        { id: 'ai-training', title: 'AI Memory', enabled: true },
        { id: 'video-training', title: 'Video Training Generator', enabled: true },
      ]
    },

    // Lead Manager
    {
      id: 'lead-manager',
      title: 'Lead Manager',
      enabled: true,
      order: 2,
      hasSubmenu: true,
      submenuItems: [
        { id: 'all-leads', title: 'All Leads', enabled: true },
        { id: 'lead-finder', title: 'Lead Finder', enabled: true },
        { id: 'lead-inspections', title: 'Lead Inspections', enabled: true },
        { id: 'storm-tracking', title: 'Storm Tracking', enabled: true },
      ]
    },

    // Sales
    {
      id: 'sales',
      title: 'Sales',
      enabled: true,
      order: 3,
      hasSubmenu: true,
      submenuItems: [
        { id: 'customers', title: 'Customers', enabled: true },
        { id: 'sales-dashboard', title: 'Sales Dashboard', enabled: true },
        { id: 'estimates', title: 'Estimates', enabled: true },
        { id: 'proposals', title: 'Proposals', enabled: true },
        { id: 'invoices', title: 'Invoices', enabled: true },
        { id: 'payments', title: 'Payments', enabled: true },
        { id: 'items', title: 'Items & Pricing', enabled: true },
        { id: 'commissions', title: 'Commission Tracker', enabled: true },
        { id: 'family-commissions', title: 'Family Commissions', enabled: true },
        { id: 'rep-performance', title: 'Rep Performance', enabled: true },
      ]
    },

    // Accounting
    {
      id: 'accounting',
      title: 'Accounting',
      enabled: true,
      order: 3.7,
      hasSubmenu: true,
      submenuItems: [
        { id: 'accounting-setup', title: 'Setup Wizard', enabled: true },
        { id: 'accounting-dashboard', title: 'Dashboard', enabled: true },
        { id: 'bills', title: 'Bills & Payables', enabled: true },
        { id: 'transactions', title: 'Transactions', enabled: true },
        { id: 'journal-entry', title: 'Journal Entry', enabled: true },
        { id: 'transfer', title: 'Transfer', enabled: true },
        { id: 'chart-of-accounts', title: 'Chart of Accounts', enabled: true },
        { id: 'reconcile', title: 'Reconcile', enabled: true },
        { id: 'reports', title: 'Reports', enabled: true },
        { id: 'expenses', title: 'Expenses', enabled: true },
        { id: 'payouts', title: 'Payouts', enabled: true },
      ]
    },

    // Field Operations
    {
      id: 'field-operations',
      title: 'Field Operations',
      enabled: true,
      order: 3.5,
      hasSubmenu: true,
      submenuItems: [
        { id: 'field-sales-tracker', title: 'Field Sales Tracker', enabled: true },
        { id: 'field-rep-app', title: 'Work Territory', enabled: true },
        { id: 'territory-manager', title: 'Territory Manager', enabled: true },
        { id: 'inspection-routing', title: 'Route Planner', enabled: true },
        { id: 'build-schedule', title: 'Build Schedule', enabled: true },
      ]
    },

    // Operations - CrewCam & Tasks
    {
      id: 'operations',
      title: 'Operations',
      enabled: true,
      order: 4,
      hasSubmenu: true,
      submenuItems: [
        { id: 'crewcam-dashboard', title: 'PhotoSync Dashboard', enabled: true },
        { id: 'new-crewcam', title: 'New PhotoSync Job', enabled: true },
        { id: 'crewcam-capture', title: 'PhotoSync Capture', enabled: true },
        { id: 'ai-damage', title: 'AI Damage Analysis', enabled: true },
        { id: 'subcontractors', title: 'Subcontractors', enabled: true },
        { id: 'subcontractor-work-orders', title: 'Work Orders', enabled: true },
        { id: 'labor-rates', title: 'Labor Rates', enabled: true },
        { id: 'tasks', title: 'Tasks', enabled: true },
        { id: 'review-requests', title: 'Review Requests', enabled: true },
        { id: 'action-items', title: 'Action Items', enabled: true },
        { id: 'projects', title: 'Projects', enabled: true },
        { id: 'leaderboard', title: 'Leaderboard', enabled: true },
        { id: 'activity', title: 'Activity Feed', enabled: true },
      ]
    },

    // Smart Glasses
    { id: 'smart-glasses', title: 'Smart Glasses', enabled: true, order: 4.1 },

    // Calendar
    { id: 'calendar', title: 'Calendar', enabled: true, order: 5 },
    { id: 'reminders', title: 'Reminders', enabled: true, order: 5.5 },

    // Communication
    {
      id: 'communication',
      title: 'Communication',
      enabled: true,
      order: 6,
      hasSubmenu: true,
      submenuItems: [
        { id: 'live-call-dashboard', title: 'Live Call Dashboard', enabled: true },
        { id: 'communication-hub', title: 'Communication Hub', enabled: true },
        { id: 'campaigns', title: 'Campaign Manager', enabled: true },
        { id: 'ad-builder', title: 'Ad Builder', enabled: true },
        { id: 'workflow-automation', title: 'Workflow Automation', enabled: true },
        { id: 'ai-dashboard', title: 'AI Dashboard', enabled: true },
        { id: 'mailbox', title: 'Mailbox', enabled: true },
        { id: 'messages', title: 'Messages', enabled: true },
        { id: 'team-chat', title: 'Team Chat', enabled: true },
        { id: 'zoom', title: 'Zoom Meeting', enabled: true },
        { id: 'google-meet', title: 'Google Meet', enabled: true },
        { id: 'slack', title: 'Slack', enabled: true },
        { id: 'google-chat', title: 'Google Chat', enabled: true },
      ]
    },

    // Documents
    {
      id: 'documents',
      title: 'Documents',
      enabled: true,
      order: 7,
      hasSubmenu: true,
      submenuItems: [
        { id: 'all-documents', title: 'All Documents', enabled: true },
        { id: 'contracts', title: 'Contracts', enabled: true },
        { id: 'contract-templates', title: 'Contract Templates', enabled: true },
        { id: 'contract-signing', title: 'Contract Signing', enabled: true },
      ]
    },

    // Reports
    {
      id: 'reports',
      title: 'Reports',
      enabled: true,
      order: 8,
      hasSubmenu: true,
      submenuItems: [
        { id: 'analytics-dashboard', title: 'Analytics', enabled: true },
        { id: 'report-builder', title: 'Report Builder', enabled: true },
        { id: 'sales-reports', title: 'Sales Reports', enabled: true },
        { id: 'competitor-analysis', title: 'Competitor Analysis', enabled: true },
      ]
    },

    // Map
    { id: 'map', title: 'Map', enabled: true, order: 9 },

    // Knowledge Base
    { id: 'knowledge-base', title: 'Knowledge Base', enabled: true, order: 10 },
    { id: 'training-videos', title: 'Training Videos', enabled: true, order: 10.5 },

    // Subscription
    { id: 'subscription', title: 'Subscription', enabled: true, order: 11 },

    // Feature Comparison
    { id: 'feature-comparison', title: 'Feature Comparison', enabled: true, order: 11.5 },

    // Coming Soon
    { id: 'coming-soon', title: 'Coming Soon', enabled: true, order: 12 },
  ], []);

  useEffect(() => {
    setMenuItems(applySavedMenuToEditor(
      buildSidebarEditorTree(),
      currentSettings?.menu_items,
      currentSettings?.sidebar_order
    ));
  }, [currentSettings]);

  const saveMenuMutation = useMutation({
    mutationFn: async (items) => {
      if (!myCompany) {
        throw new Error('No company found for user');
      }

      const payload = {
        menu_items: items.menu_items,
        sidebar_order: items.sidebar_order,
      };
      if (currentSettings) {
        return base44.entities.MenuSettings.update(currentSettings.id, payload);
      } else {
        return base44.entities.MenuSettings.create({
          company_id: myCompany.id,
          ...payload,
        });
      }
    },
    onSuccess: (response) => {
      console.log('MenuSettings saved response:', response);
      queryClient.invalidateQueries({ queryKey: ['menu-settings', myCompany?.id] });
      setHasChanges(false);
      alert('✅ Menu settings saved successfully! The sidebar will update when you navigate.');
    },
    onError: (error) => {
      console.error('Error saving menu settings:', error);
      alert('❌ Error saving menu settings: ' + error.message);
    },
  });

  const toggleNode = (nodes, id) => nodes.map((node) => {
    if (node.id === id) {
      const enabled = node.enabled === false;
      const setAll = (entry) => entry.items
        ? { ...entry, enabled, items: entry.items.map(setAll) }
        : { ...entry, enabled };
      return setAll({ ...node, enabled });
    }
    if (node.items) {
      const items = toggleNode(node.items, id);
      const leaves = [];
      const collect = (entries) => entries.forEach((entry) => (entry.items ? collect(entry.items) : leaves.push(entry)));
      collect(items);
      return { ...node, items, enabled: leaves.some((leaf) => leaf.enabled !== false) };
    }
    return node;
  });

  const toggleItem = (itemId) => {
    setMenuItems((current) => toggleNode(current, itemId));
    setHasChanges(true);
  };

  const reorderList = (list, startIndex, endIndex) => {
    const next = Array.from(list);
    const [moved] = next.splice(startIndex, 1);
    next.splice(endIndex, 0, moved);
    return next;
  };

  const reorderTree = (nodes, droppableId, startIndex, endIndex) => {
    if (droppableId === "root") return reorderList(nodes, startIndex, endIndex);
    return nodes.map((node) => {
      if (!node.items) return node;
      if (`children:${node.id}` === droppableId) {
        return { ...node, items: reorderList(node.items, startIndex, endIndex) };
      }
      return { ...node, items: reorderTree(node.items, droppableId, startIndex, endIndex) };
    });
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    if (result.source.droppableId !== result.destination.droppableId) return;
    if (result.source.index === result.destination.index) return;
    setMenuItems((current) => reorderTree(
      current,
      result.source.droppableId,
      result.source.index,
      result.destination.index
    ));
    setHasChanges(true);
  };

  const handleSave = () => {
    const legacyItems = applyEditorToLegacyMenu(defaultMenuItems, menuItems);
    const itemsToSave = legacyItems.map((item) => {
      const savedItem = {
        id: item.id,
        title: item.title,
        enabled: item.enabled,
        order: item.order,
        hasSubmenu: item.hasSubmenu || false,
      };
      if (item.hasSubmenu && item.submenuItems && item.submenuItems.length > 0) {
        const subItems = item.submenuItems.map((sub) => ({
          id: sub.id,
          title: sub.title,
          enabled: sub.enabled !== false,
        }));
        savedItem.submenuItems = subItems;
        savedItem.submenu = subItems;
      }
      return savedItem;
    });
    saveMenuMutation.mutate({
      menu_items: itemsToSave,
      sidebar_order: captureSidebarOrder(menuItems),
    });
  };

  const handleReset = () => {
    if (window.confirm('Reset to default menu settings? This cannot be undone.')) {
      setMenuItems(buildSidebarEditorTree());
      setHasChanges(true);
    }
  };

  const renderMenuNodes = (nodes, droppableId, depth = 0) => (
    <Droppable droppableId={droppableId} type={droppableId}>
      {(provided) => (
        <div ref={provided.innerRef} {...provided.droppableProps}>
          {nodes.map((node, index) => (
            <Draggable key={node.id} draggableId={String(node.id)} index={index}>
              {(dragProvided, snapshot) => (
                <div
                  ref={dragProvided.innerRef}
                  {...dragProvided.draggableProps}
                  className={`${depth === 0 ? "border-b last:border-b-0" : ""} ${snapshot.isDragging ? "bg-blue-50 shadow-lg" : "bg-white"}`}
                >
                  <div className={`flex items-center gap-3 py-3 pr-4 hover:bg-gray-50 ${depth === 0 ? "pl-2" : ""}`} style={{ paddingLeft: depth === 0 ? undefined : 12 + depth * 20 }}>
                    <div
                      className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-700 p-1 rounded hover:bg-gray-100"
                      title="Drag to move"
                      {...dragProvided.dragHandleProps}
                      aria-label={`Move ${node.title}`}
                    >
                      <GripVertical className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className={depth === 0 ? "font-medium text-gray-900" : "text-sm text-gray-700"}>
                        {node.title}
                      </div>
                      {node.items && (
                        <div className="text-xs text-gray-500 mt-0.5">{node.items.length} items</div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleItem(node.id)}
                      className="text-gray-600 hover:text-gray-900"
                      aria-label={node.enabled === false ? `Show ${node.title}` : `Hide ${node.title}`}
                    >
                      {node.enabled === false ? (
                        <EyeOff className="w-4 h-4 text-red-500" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                  {node.items && (
                    <div className="bg-gray-50 border-t border-gray-100">
                      {renderMenuNodes(node.items, `children:${node.id}`, depth + 1)}
                    </div>
                  )}
                </div>
              )}
            </Draggable>
          ))}
          {provided.placeholder}
        </div>
      )}
    </Droppable>
  );

  if (!user) {
    return (
      <div className="p-3 sm:p-6">
        <Alert>
          <AlertDescription>Loading user profile...</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!myCompany) {
    return (
      <div className="p-3 sm:p-6">
        <Alert variant="destructive">
          <AlertDescription>
            ⚠️ No company found for user {user.email}. Please set up your company profile first in Admin → Company Setup, or ensure you are associated with a company as a staff member.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Menu Setup</h1>
          <p className="text-gray-500 mt-1">
            Drag the grip on the left to move a section or a page. Use the eye to show or hide it. Save to update the sidebar.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={saveMenuMutation.isPending}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveMenuMutation.isPending}
            className={hasChanges ? "bg-blue-600 hover:bg-blue-700" : "bg-green-600 hover:bg-green-700"}
          >
            <Save className="w-4 h-4 mr-2" />
            {saveMenuMutation.isPending ? 'Saving...' : hasChanges ? 'Save Changes' : 'Save (Apply Now)'}
          </Button>
        </div>
      </div>

      {hasChanges ? (
        <Alert className="bg-yellow-50 border-yellow-200">
          <AlertDescription className="text-yellow-800">
            ⚠️ You have unsaved changes — click Save to apply them to the sidebar
          </AlertDescription>
        </Alert>
      ) : currentSettings && (
        <Alert className="bg-green-50 border-green-200">
          <AlertDescription className="text-green-800">
            ✅ Settings saved. If the sidebar isn't reflecting changes, click "Save (Apply Now)" to re-apply.
          </AlertDescription>
        </Alert>
      )}

      <Card className="bg-white shadow-md">
        <CardHeader>
          <CardTitle>Menu Items</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DragDropContext onDragEnd={handleDragEnd}>
            {renderMenuNodes(menuItems, "root")}
          </DragDropContext>
        </CardContent>
      </Card>

      <Alert className="bg-blue-50 border-blue-200">
        <AlertDescription className="text-blue-900 text-sm">
          <strong>How it works:</strong>
          <ul className="mt-2 space-y-1 ml-4 list-disc">
            <li>Drag the grip handle to move a section or a page</li>
            <li>A section takes its pages with it</li>
            <li>Click the eye to show or hide a page</li>
            <li>Save, then the sidebar uses this order</li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}