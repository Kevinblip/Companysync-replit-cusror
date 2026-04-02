import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch"; // This import is not used in the updated code, but preserving as it was in original
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical, Save, RotateCcw, Eye, EyeOff, ArrowUpRight } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
    initialData: [],
  });

  // Get staff profile to find company
  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
    initialData: [],
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
    initialData: [],
  });

  const currentSettings = menuSettings[0];

  // Default menu structure - matches Layout.js navigation items
  const defaultMenuItems = useMemo(() => [
    { id: 'dashboard', title: 'Dashboard', enabled: true, order: 0 },
    
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
        { id: 'crewcam-dashboard', title: 'CrewCam Dashboard', enabled: true },
        { id: 'new-crewcam', title: 'New CrewCam Job', enabled: true },
        { id: 'crewcam-capture', title: 'CrewCam Capture', enabled: true },
        { id: 'ai-damage', title: 'AI Damage Analysis', enabled: true },
        { id: 'subcontractors', title: 'Subcontractors', enabled: true },
        { id: 'tasks', title: 'Tasks', enabled: true },
        { id: 'review-requests', title: 'Review Requests', enabled: true },
        { id: 'reminders', title: 'Reminders', enabled: true },
        { id: 'projects', title: 'Projects', enabled: true },
        { id: 'activity', title: 'Activity Feed', enabled: true },
      ]
    },

    // Smart Glasses
    { id: 'smart-glasses', title: 'Smart Glasses', enabled: true, order: 4.1 },

    // Calendar
    { id: 'calendar', title: 'Calendar', enabled: true, order: 5 },

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
        { id: 'zoom', title: 'Zoom Meeting', enabled: true },
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

    // Subscription
    { id: 'subscription', title: 'Subscription', enabled: true, order: 11 },

    // Feature Comparison
    { id: 'feature-comparison', title: 'Feature Comparison', enabled: true, order: 11.5 },

    // Coming Soon
    { id: 'coming-soon', title: 'Coming Soon', enabled: true, order: 12 },
  ], []);

  useEffect(() => {
    if (currentSettings?.menu_items) {
      // Merge saved settings with default structure
      // Start with defaults and overlay saved settings to preserve enabled states
      const mergedItems = defaultMenuItems.map(defaultItem => {
        const savedItem = currentSettings.menu_items.find(s => s.id === defaultItem.id);
        
        if (!savedItem) {
          // New item not in saved settings - use default
          return defaultItem;
        }
        
        if (defaultItem.hasSubmenu) {
          // For items with submenus, merge submenu enabled states
          const savedSubmenu = savedItem.submenuItems || savedItem.submenu || [];
          const mergedSubmenu = defaultItem.submenuItems.map(defaultSub => {
            const savedSub = savedSubmenu.find(s => s.id === defaultSub.id);
            return {
              ...defaultSub,
              enabled: savedSub ? savedSub.enabled : defaultSub.enabled
            };
          });
          
          return {
            ...defaultItem,
            enabled: savedItem.enabled !== undefined ? savedItem.enabled : defaultItem.enabled,
            order: savedItem.order !== undefined ? savedItem.order : defaultItem.order,
            submenuItems: mergedSubmenu
          };
        }
        
        // Simple item - use saved enabled state
        return {
          ...defaultItem,
          enabled: savedItem.enabled !== undefined ? savedItem.enabled : defaultItem.enabled,
          order: savedItem.order !== undefined ? savedItem.order : defaultItem.order
        };
      });
      
      // Sort by saved order
      mergedItems.sort((a, b) => (a.order || 0) - (b.order || 0));
      setMenuItems(mergedItems);
    } else {
      setMenuItems(defaultMenuItems);
    }
  }, [currentSettings, defaultMenuItems]);

  const saveMenuMutation = useMutation({
    mutationFn: async (items) => {
      if (!myCompany) {
        throw new Error('No company found for user');
      }

      if (currentSettings) {
        return base44.entities.MenuSettings.update(currentSettings.id, {
          menu_items: items
        });
      } else {
        return base44.entities.MenuSettings.create({
          company_id: myCompany.id,
          menu_items: items
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

  const handleDragEnd = (result) => {
    if (!result.destination) return;

    const items = Array.from(menuItems);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    const reordered = items.map((item, index) => ({
      ...item,
      order: index
    }));

    setMenuItems(reordered);
    setHasChanges(true);
  };

  const toggleItem = (itemId, submenuId = null) => {
    const updated = menuItems.map(item => {
      if (item.id === itemId) {
        if (submenuId && item.hasSubmenu && item.submenuItems) {
          return {
            ...item,
            submenuItems: item.submenuItems.map(sub => 
              sub.id === submenuId ? { ...sub, enabled: !sub.enabled } : sub
            )
          };
        } else {
          // If a parent item is toggled, also toggle all its submenu items to match
          const newEnabledState = !item.enabled;
          return { 
            ...item, 
            enabled: newEnabledState,
            submenuItems: item.submenuItems ? item.submenuItems.map(sub => ({ ...sub, enabled: newEnabledState })) : undefined
          };
        }
      }
      return item;
    });
    setMenuItems(updated);
    setHasChanges(true);
  };

  const promoteToStandalone = (parentId, subItemId) => {
    const updated = [...menuItems];
    
    // Find parent and submenu item
    const parentItem = updated.find(item => item.id === parentId);
    const subItem = parentItem?.submenuItems?.find(sub => sub.id === subItemId);
    
    if (!subItem) return;

    // Remove from parent's submenu
    if (parentItem) {
      parentItem.submenuItems = parentItem.submenuItems.filter(sub => sub.id !== subItemId);
    }

    // Get max order to place new item at the end
    const maxOrder = Math.max(...updated.map(item => item.order || 0), 0);
    
    // Find matching item from Layout to get the correct URL
    const layoutMatches = {
      'customers': '/customers',
      'sales-dashboard': '/sales-dashboard',
      'estimates': '/estimates',
      'proposals': '/proposals',
      'invoices': '/invoices',
      'payments': '/payments',
      'items': '/items',
      'commissions': '/commission-report',
      'all-leads': '/leads',
      'lead-finder': '/lead-finder',
      'lead-inspections': '/lead-inspections',
      'storm-tracking': '/storm-tracking',
      'property-importer': '/property-data-importer',
      'crewcam-dashboard': '/inspections-dashboard',
      'new-crewcam': '/new-inspection',
      'crewcam-capture': '/inspection-capture',
      'ai-damage': '/drone-inspections',
      'tasks': '/tasks',
      'projects': '/projects',
      'activity': '/activity',
    };
    
    const newStandaloneItem = {
      id: subItem.id,
      title: subItem.title,
      url: layoutMatches[subItem.id] || `/${subItem.id}`,
      enabled: subItem.enabled !== false,
      order: maxOrder + 1,
      hasSubmenu: false
    };
    
    updated.push(newStandaloneItem);

    setMenuItems(updated);
    setHasChanges(true);
  };

  const handleSave = () => {
    // Ensure submenuItems are saved correctly for Layout to read
    const itemsToSave = menuItems.map(item => {
      const savedItem = {
        id: item.id,
        title: item.title,
        enabled: item.enabled,
        order: item.order,
        hasSubmenu: item.hasSubmenu || false,
      };
      
      // Save submenu items for parent menus
      // CRITICAL: Save BOTH submenuItems AND submenu for backwards compatibility
      if (item.hasSubmenu && item.submenuItems && item.submenuItems.length > 0) {
        const subItems = item.submenuItems.map(sub => ({
          id: sub.id,
          title: sub.title,
          enabled: sub.enabled !== false // Default to true if undefined
        }));
        savedItem.submenuItems = subItems;
        savedItem.submenu = subItems; // Entity schema uses 'submenu' field
      }
      
      return savedItem;
    });
    console.log('Saving menu items:', JSON.stringify(itemsToSave, null, 2));
    saveMenuMutation.mutate(itemsToSave);
  };

  const handleReset = () => {
    if (window.confirm('Reset to default menu settings? This cannot be undone.')) {
      setMenuItems(defaultMenuItems);
      setHasChanges(true);
    }
  };

  if (!user) {
    return (
      <div className="p-6">
        <Alert>
          <AlertDescription>Loading user profile...</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!myCompany) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>
            ⚠️ No company found for user {user.email}. Please set up your company profile first in Admin → Company Setup, or ensure you are associated with a company as a staff member.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Menu Setup</h1>
          <p className="text-gray-500 mt-1">
            Drag parent items to reorder. All submenu items move together.
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
            disabled={!hasChanges || saveMenuMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Save className="w-4 h-4 mr-2" />
            {saveMenuMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {hasChanges && (
        <Alert className="bg-yellow-50 border-yellow-200">
          <AlertDescription className="text-yellow-800">
            ⚠️ You have unsaved changes
          </AlertDescription>
        </Alert>
      )}

      <Card className="bg-white shadow-md">
        <CardHeader>
          <CardTitle>Menu Items</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="menu-items">
              {(provided) => (
                <div
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                >
                  {menuItems.map((item, index) => (
                    <Draggable key={item.id} draggableId={item.id} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`border-b last:border-b-0 ${
                            snapshot.isDragging ? 'bg-blue-50 shadow-lg' : 'bg-white'
                          }`}
                        >
                          {/* Parent Item */}
                          <div className="flex items-center gap-3 p-4 hover:bg-gray-50">
                            <div {...provided.dragHandleProps} className="cursor-move">
                              <GripVertical className="w-5 h-5 text-gray-400" />
                            </div>
                            
                            <div className="flex-1">
                              <div className="font-medium text-gray-900">
                                {item.hasSubmenu && '▸ '}
                                {item.title}
                              </div>
                              {item.hasSubmenu && (
                                <div className="text-xs text-gray-500 mt-0.5">
                                  {item.submenuItems?.length || 0} submenu items
                                </div>
                              )}
                            </div>

                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleItem(item.id)}
                              className="text-gray-600 hover:text-gray-900"
                            >
                              {item.enabled ? (
                                <Eye className="w-4 h-4" />
                              ) : (
                                <EyeOff className="w-4 h-4 text-red-500" />
                              )}
                            </Button>
                          </div>

                          {/* Submenu Items - Indented Group */}
                          {item.hasSubmenu && item.submenuItems && (
                            <div className="bg-gray-50 border-t border-gray-200">
                              {item.submenuItems.map((subItem, subIndex) => (
                                <div
                                  key={subItem.id}
                                  className={`flex items-center gap-3 py-2.5 px-4 pl-16 hover:bg-gray-100 ${
                                    subIndex !== item.submenuItems.length - 1 ? 'border-b border-gray-200' : ''
                                  }`}
                                >
                                  <div className="w-1 h-1 rounded-full bg-gray-400" />

                                  <div className="flex-1 text-sm text-gray-700">
                                    {subItem.title}
                                  </div>

                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => promoteToStandalone(item.id, subItem.id)}
                                    className="text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                                    title="Make standalone menu item"
                                  >
                                    <ArrowUpRight className="w-4 h-4" />
                                  </Button>

                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => toggleItem(item.id, subItem.id)}
                                    className="text-gray-500 hover:text-gray-900"
                                  >
                                    {subItem.enabled ? (
                                      <Eye className="w-4 h-4" />
                                    ) : (
                                      <EyeOff className="w-4 h-4 text-red-500" />
                                    )}
                                  </Button>
                                </div>
                              ))}
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
          </DragDropContext>
        </CardContent>
      </Card>

      <Alert className="bg-blue-50 border-blue-200">
        <AlertDescription className="text-blue-900 text-sm">
          <strong>💡 How it works:</strong>
          <ul className="mt-2 space-y-1 ml-4 list-disc">
            <li>Drag the <strong>≡</strong> handle to reorder menu items</li>
            <li>Items with <strong>▸</strong> are parent menus with submenu items</li>
            <li>When you move a parent, all its submenu items move together</li>
            <li>Click the <strong>↗</strong> icon on submenu items to make them standalone</li>
            <li>Click the <strong>👁</strong> icon to show/hide items</li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}