import React, { useState, useEffect, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Search, Mail, Phone, MessageCircle, Eye, Edit, Trash2, Download, RefreshCw, Upload, Filter, MapPin, Building2, ChevronLeft, Users, Loader2, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import Dialer from "../components/communication/Dialer";
import EmailDialog from "../components/communication/EmailDialog";
import SMSDialog from "../components/communication/SMSDialog";
import SwipeableCard from "../components/SwipeableCard";
// import PullToRefresh from "../components/PullToRefresh";
import StaffMultiSelect from "../components/customers/StaffMultiSelect";
import CustomerGroupSelect from "../components/customers/CustomerGroupSelect";
import { useRoleBasedData } from "../components/hooks/useRoleBasedData";
import { useSubscriptionLimits } from "../components/hooks/useSubscriptionLimits";
import { useImpersonationGuard } from "../components/hooks/useImpersonationGuard";
import { toast } from "sonner";
import useTranslation from "@/hooks/useTranslation";
import { TablePageSkeleton } from "@/components/PageSkeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Define predefined sources
const PREDEFINED_SOURCES = [
  "website", "referral", "storm_tracker", "property_importer",
  "social_media", "advertisement", "cold_call", "walk_in", "other"
];

export default function Customers() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const [showForm, setShowForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showDialer, setShowDialer] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showSMSDialog, setShowSMSDialog] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [selectedCustomers, setSelectedCustomers] = useState([]);
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState('created_date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [showFilters, setShowFilters] = useState(false);
  const [duplicateLead, setDuplicateLead] = useState(null);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [filters, setFilters] = useState({
    status: 'all',
    group: 'all',
    source: 'all',
    customer_type: 'all'
  });
  const [formData, setFormData] = useState({
    name: "",
    company: "",
    customer_type: "residential",
    email: "",
    phone: "",
    phone_2: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    website: "",
    source: "other", // Default to 'other' so custom_source can be shown if needed
    referral_source: "",
    custom_source: "", // New field for custom 'other' source
    is_active: true,
    notes: "",
    group: "",
    assigned_to: "",
    assigned_to_users: [],
    tags: [],
    insurance_company: "",
    adjuster_name: "",
    adjuster_phone: ""
  });

  const [visibleColumns, setVisibleColumns] = useState({
    id: true,
    company: false,
    name: true,
    customer_type: true,
    email: true,
    phone: true,
    phone_2: false,
    address: true,
    source: true,
    assigned: true,
    group: false,
    insurance_company: false,
    adjuster_name: false,
    adjuster_phone: false,
    active: true,
    communication: true,
    date_created: true,
    actions: true
  });

  // 🔐 Use centralized role-based data hook
  const { 
    user, 
    myCompany, 
    filterCustomers,
    hasPermission,
    isAdmin,
    isDataLoading: isRoleDataLoading
  } = useRoleBasedData();

  const { canCreateCustomer } = useSubscriptionLimits();
  const { isImpersonating, guardAction } = useImpersonationGuard();

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles'],
    queryFn: () => base44.entities.StaffProfile.list("-created_date", 1000),
    initialData: [],
  });

  // 🔥 FIX: Deduplicate staff profiles by email
  const uniqueStaffProfiles = useMemo(() => {
    const seen = new Set();
    return staffProfiles.filter(staff => {
      if (seen.has(staff.user_email)) {
        return false;
      }
      seen.add(staff.user_email);
      return true;
    });
  }, [staffProfiles]);

  const { data: allCustomers = [], isLoading: isLoadingCustomers } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_at") : [],
    initialData: [],
    enabled: !!myCompany?.id,
    refetchOnMount: 'always',
    staleTime: 0
  });

  // 🔐 Filter customers based on role permissions using the hook
  const customers = useMemo(() => {
    // SAFETY CHECK: If platform admin, always show all customers to prevent filtering issues
    if (user?.platform_role === 'super_admin' || myCompany?.id === 'companysync_master_001') {
      return allCustomers;
    }
    return filterCustomers(allCustomers);
  }, [allCustomers, filterCustomers, user, myCompany]);

  const totalCustomers = customers.length;
  const activeCustomers = customers.filter(c => c.is_active).length;
  const inactiveCustomers = customers.filter(c => !c.is_active).length;
  const contactsLoggedInToday = 0;

  const handleFormChange = useCallback((field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const getStaffAvatars = useCallback((assignedUsers) => {
    if (!assignedUsers || assignedUsers.length === 0) return [];
    return assignedUsers.map(email => {
      const staff = uniqueStaffProfiles.find(s => s.user_email === email);
      return {
        email,
        avatar_url: staff?.avatar_url || null,
        full_name: staff?.full_name || email,
        initials: staff?.full_name
          ? staff.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
          : (email && email.length > 0 ? email[0].toUpperCase() : '?')
      };
    });
  }, [uniqueStaffProfiles]);

  const convertLeadToCustomer = async (leadId, leadData) => {
    try {
      const newCustomer = await base44.entities.Customer.create({
        name: leadData.name || '',
        email: leadData.email || '',
        phone: leadData.phone || '',
        phone_2: leadData.phone_2 || '',
        address: leadData.address || '',
        street: leadData.street || '',
        city: leadData.city || '',
        state: leadData.state || '',
        zip: leadData.zip || '',
        company: leadData.company || '',
        website: leadData.website || '',
        source: leadData.lead_source || 'other',
        customer_type: 'residential',
        is_active: true,
        company_id: myCompany?.id,
        assigned_to_users: [user?.email],
        assigned_to: user?.email,
      });
      await base44.entities.Lead.delete(leadId);
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success(`✅ Lead "${leadData.name}" converted to customer!`);
      setShowDuplicateDialog(false);
      setDuplicateLead(null);
      setShowForm(false);
      setFormData({
        name: "", email: "", phone: "", phone_2: "", street: "", city: "", state: "", zip: "",
        company: "", website: "", source: "other", referral_source: "", custom_source: "",
        is_active: true, notes: "", group: "", assigned_to: "", assigned_to_users: [],
        tags: [], insurance_company: "", adjuster_name: "", adjuster_phone: ""
      });
      return newCustomer;
    } catch (error) {
      toast.error('Failed to convert lead: ' + error.message);
      throw error;
    }
  };

  const createMutation = useMutation({
    mutationFn: async (customerData) => {
      const companyId = myCompany?.id || localStorage.getItem('last_used_company_id');
      if (!companyId) {
        throw new Error('No company context found. Please log out and log back in.');
      }

      const trimmedEmail = customerData.email?.trim().toLowerCase() || '';
      const trimmedPhone = customerData.phone?.trim() || '';
      
      if (trimmedEmail || trimmedPhone) {
        const allLeads = await base44.entities.Lead.filter({ company_id: companyId }, "-created_date", 10000);
        const matchingLead = allLeads.find(lead => {
          const leadEmail = (lead.email?.trim().toLowerCase() || '');
          const leadPhone = (lead.phone?.trim() || '');
          const leadPhone2 = (lead.phone_2?.trim() || '');
          return (trimmedEmail && trimmedEmail === leadEmail) ||
                 (trimmedPhone && (trimmedPhone === leadPhone || trimmedPhone === leadPhone2));
        });
        
        if (matchingLead) {
          setDuplicateLead(matchingLead);
          setShowDuplicateDialog(true);
          throw new Error('duplicate_found');
        }
      }

      try {
        const canAdd = await canCreateCustomer(companyId);
        if (!canAdd) {
          throw new Error('Customer limit reached');
        }
      } catch (limitErr) {
        if (limitErr.message === 'Customer limit reached') throw limitErr;
        console.error('[Customers] Limit check failed, allowing creation:', limitErr.message);
      }

      const { id, street, city, state, zip, custom_source, ...dataWithoutIdAndAddressParts } = customerData;

      const maxNumber = customers.reduce((max, c) =>
        Math.max(max, c.customer_number || 0), 0
      );
      const nextNumber = maxNumber + 1;

      const addressParts = [street, city, state, zip].filter(Boolean);
      const fullAddress = addressParts.join(', ');

      const sourceForApi = dataWithoutIdAndAddressParts.source === 'other'
        ? custom_source || 'other'
        : dataWithoutIdAndAddressParts.source;

      // Auto-assign creator if no assignees specified
      let finalAssignedToUsers = dataWithoutIdAndAddressParts.assigned_to_users || [];
      if (finalAssignedToUsers.length === 0 && user?.email) {
        finalAssignedToUsers = [user.email];
      }

      const newCustomer = await base44.entities.Customer.create({
        ...dataWithoutIdAndAddressParts,
        customer_number: nextNumber,
        company_id: companyId,
        street,
        city,
        state,
        zip,
        address: fullAddress || undefined,
        source: sourceForApi,
        assigned_to_users: finalAssignedToUsers,
        assigned_to: finalAssignedToUsers[0] || undefined,
      });

      // 🔔 UNIVERSAL NOTIFICATION DISPATCHER
      if (myCompany?.id) {
        try {
          await base44.functions.invoke('universalNotificationDispatcher', {
            action: 'create',
            entityType: 'Customer',
            entityId: newCustomer.id,
            entityData: newCustomer,
            companyId: myCompany.id
          });
        } catch (error) {
          console.error('Notification dispatch failed:', error);
        }

        // Send welcome email to customer
        if (newCustomer.email) {
          try {
            await base44.functions.invoke('sendUnifiedEmail', {
              to: newCustomer.email,
              templateName: 'Welcome New Customer',
              templateData: {
                customer_name: newCustomer.name || 'Valued Customer',
                company_name: myCompany.company_name || 'CompanySync',
                company_phone: myCompany.phone || '216-777-7154',
                company_email: myCompany.email || 'io.companysync@gmail.com',
                customer_portal_link: window.location.origin
              },
              companyId: myCompany.id,
              contactName: newCustomer.name
            });
            console.log('✅ Welcome email sent to customer');
          } catch (emailError) {
            console.error('⚠️ Failed to send welcome email:', emailError);
          }
        }

        // Trigger workflows
        try {
          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'customer_created',
            companyId: myCompany.id,
            entityType: 'Customer',
            entityId: newCustomer.id,
            entityData: {
              customer_name: newCustomer.name,
              customer_email: newCustomer.email || '',
              customer_phone: newCustomer.phone || '',
              customer_address: newCustomer.address || '',
              source: newCustomer.source || '',
              app_url: window.location.origin
            }
          });
        } catch (error) {
          console.error('Workflow trigger failed:', error);
        }
      }

      return newCustomer;
    },
    onSuccess: async (newCustomer) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.email] });
      setShowForm(false);
      setEditingCustomer(null);
      
      // 🔥 UNIVERSAL WORKFLOW TRIGGER
      if (myCompany?.id) {
        try {
          await base44.functions.invoke('autoTriggerWorkflowsFromMutation', {
            action: 'create',
            entityType: 'Customer',
            entityId: newCustomer.id,
            entityData: newCustomer,
            companyId: myCompany.id
          });
          console.log('✅ Workflows triggered for new customer:', newCustomer.id);
        } catch (error) {
          console.error('⚠️ Workflow trigger failed:', error);
        }
      }
      setFormData({
        name: "",
        company: "",
        customer_type: "residential",
        email: "",
        phone: "",
        phone_2: "",
        street: "",
        city: "",
        state: "",
        zip: "",
        website: "",
        source: "other",
        referral_source: "",
        custom_source: "", // Reset custom_source
        is_active: true,
        notes: "",
        group: "",
        assigned_to: "",
        assigned_to_users: [],
        tags: [],
        insurance_company: "",
        adjuster_name: "",
        adjuster_phone: ""
      });
      alert('Customer created successfully!');
    },
    onError: (error) => {
      if (error.message === 'duplicate_found') return;
      console.error("Error creating customer:", error);
      if (error.message === 'Not found' || error.message?.includes('404')) {
        alert('Failed to create customer: Server route not found. Please refresh the page and try again. If the problem persists, try logging out and back in.');
      } else {
        alert(`Failed to create customer: ${error.message}`);
      }
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const { street, city, state, zip, custom_source, ...dataWithoutAddressParts } = data;
      const addressParts = [street, city, state, zip].filter(Boolean);
      const fullAddress = addressParts.join(', ');

      const sourceForApi = dataWithoutAddressParts.source === 'other'
        ? custom_source || 'other'
        : dataWithoutAddressParts.source;

      const updatedCustomer = await base44.entities.Customer.update(id, {
        ...dataWithoutAddressParts,
        street,
        city,
        state,
        zip,
        address: fullAddress || undefined,
        source: sourceForApi,
      });

      if (myCompany?.id) {
        try {
          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'customer_updated',
            companyId: myCompany.id,
            entityType: 'Customer',
            entityId: updatedCustomer.id,
            entityData: {
              customer_name: updatedCustomer.name,
              customer_email: updatedCustomer.email,
              customer_phone: updatedCustomer.phone,
              customer_address: updatedCustomer.address,
              app_url: window.location.origin
            }
          });
          console.log('✅ Workflows triggered for updated customer:', updatedCustomer.id);
        } catch (error) {
          console.error('⚠️ Workflow trigger failed (non-critical):', error);
        }
      }

      return updatedCustomer;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setShowForm(false);
      setEditingCustomer(null);
      setFormData({
        name: "",
        company: "",
        customer_type: "residential",
        email: "",
        phone: "",
        phone_2: "",
        street: "",
        city: "",
        state: "",
        zip: "",
        website: "",
        source: "other",
        referral_source: "",
        custom_source: "", // Reset custom_source
        is_active: true,
        notes: "",
        group: "",
        assigned_to: "",
        assigned_to_users: [],
        tags: [],
        insurance_company: "",
        adjuster_name: "",
        adjuster_phone: ""
      });
      alert('Customer updated successfully!');
    },
    onError: (error) => {
      console.error("Error updating customer:", error);
      alert(`Failed to update customer: ${error.message}`);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Customer.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids) => {
      let successCount = 0;
      let errorCount = 0;
      const errors = [];

      for (const id of ids) {
        try {
          await base44.entities.Customer.delete(id);
          successCount++;
        } catch (error) {
          errorCount++;
          errors.push({ id, error: error.message });
          console.error(`Failed to delete customer ${id}:`, error);
        }
      }

      return { successCount, errorCount, errors };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setSelectedCustomers([]);

      if (result.errorCount > 0) {
        alert(`Deleted ${result.successCount} customers successfully.\n${result.errorCount} customers could not be deleted.`);
      } else {
        alert(`Successfully deleted ${result.successCount} customers!`);
      }
    },
    onError: (error) => {
      console.error("Bulk delete failed:", error);
      alert('Failed to delete customers. Please try again.');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!guardAction("Creating/updating customers")) return;
    if (editingCustomer) {
      updateMutation.mutate({ id: editingCustomer.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingCustomer(null);
    setFormData({
      name: "",
      company: "",
      customer_type: "residential",
      email: "",
      phone: "",
      phone_2: "",
      street: "",
      city: "",
      state: "",
      zip: "",
      website: "",
      source: "other",
      referral_source: "",
      custom_source: "", // Reset custom_source
      is_active: true,
      notes: "",
      group: "",
      assigned_to: "",
      assigned_to_users: [],
      tags: [],
      insurance_company: "",
      adjuster_name: "",
      adjuster_phone: ""
    });
  };

  const handleToggleActive = (customer) => {
    if (!guardAction("Updating customers")) return;
    // Construct the data payload, making sure source and custom_source are handled
    const sourceForUpdate = customer.source && !PREDEFINED_SOURCES.includes(customer.source)
      ? 'other' // If current source is custom, treat as 'other' for form state logic if we were editing it, but we're just toggling active
      : customer.source || 'other';

    const customSourceForUpdate = customer.source && !PREDEFINED_SOURCES.includes(customer.source)
      ? customer.source
      : '';

    updateMutation.mutate({
      id: customer.id,
      data: {
        ...customer,
        is_active: !customer.is_active,
        source: sourceForUpdate,
        custom_source: customSourceForUpdate, // Pass along custom source if it was one
      }
    });
  };

  const handleDelete = (id) => {
    if (!guardAction("Deleting customers")) return;
    if (window.confirm(t.customers.deleteConfirm)) {
      deleteMutation.mutate(id);
    }
  };

  const handleCommunication = (customer, type) => {
    setSelectedCustomer(customer);
    if (type === 'phone') setShowDialer(true);
    if (type === 'email') setShowEmailDialog(true);
    if (type === 'sms') setShowSMSDialog(true);
  };

  const handleSelectAll = () => {
    const currentPageCustomerIds = paginatedCustomers.map(customer => customer.id);
    const areAllCurrentPageSelected = currentPageCustomerIds.every(id => selectedCustomers.includes(id));

    if (areAllCurrentPageSelected) {
      setSelectedCustomers(prev => prev.filter(id => !currentPageCustomerIds.includes(id)));
    } else {
      setSelectedCustomers(prev => [...new Set([...prev, ...currentPageCustomerIds])]);
    }
  };

  const handleSelectCustomer = (id) => {
    if (selectedCustomers.includes(id)) {
      setSelectedCustomers(selectedCustomers.filter(customerId => customerId !== id));
    } else {
      setSelectedCustomers([...selectedCustomers, id]);
    }
  };

  const handleBulkDelete = () => {
    if (!guardAction("Deleting customers")) return;
    if (selectedCustomers.length === 0) {
      alert('Please select at least one customer to delete.');
      return;
    }

    const existingSelectedCustomers = selectedCustomers.filter(id =>
      customers.some(customer => customer.id === id)
    );

    if (existingSelectedCustomers.length === 0) {
      alert('No valid customers selected. They may have been already deleted.');
      setSelectedCustomers([]);
      return;
    }

    if (existingSelectedCustomers.length < selectedCustomers.length) {
      const difference = selectedCustomers.length - existingSelectedCustomers.length;
      if (!window.confirm(`${difference} of your selected customers no longer exist.\n\nDelete the remaining ${existingSelectedCustomers.length} customers? This cannot be undone!`)) {
        setSelectedCustomers(existingSelectedCustomers);
        return;
      }
    } else {
      if (!window.confirm(`Are you sure you want to delete ${existingSelectedCustomers.length} selected customers? This cannot be undone!`)) {
        return;
      }
    }

    bulkDeleteMutation.mutate(existingSelectedCustomers);
  };

  const handleExportCSV = () => {
    const customersToExport = selectedCustomers.length > 0
      ? filteredCustomers.filter(customer => selectedCustomers.includes(customer.id))
      : filteredCustomers;

    if (customersToExport.length === 0) {
      alert('No customers to export');
      return;
    }

    const headers = ['ID', 'Customer Number', 'Name', 'Company', 'Type', 'Email', 'Phone 1', 'Phone 2', 'Website', 'Street', 'City', 'State', 'Zip', 'Source', 'Referral Source', 'Group', 'Assigned To (Primary)', 'Assigned To (All)', 'Insurance Company', 'Adjuster Name', 'Adjuster Phone', 'Active', 'Date Created', 'Notes'];
    const rows = customersToExport.map(customer => [
      customer.id,
      customer.customer_number || '',
      customer.name || '',
      customer.company || '',
      customer.customer_type || '',
      customer.email || '',
      customer.phone || '',
      customer.phone_2 || '',
      customer.website || '',
      customer.street || '',
      customer.city || '',
      customer.state || '',
      customer.zip || '',
      customer.source || '', // This will contain the actual source, custom or predefined
      customer.referral_source || '',
      customer.group || '',
      customer.assigned_to || '',
      customer.assigned_to_users?.join(';') || '',
      customer.insurance_company || '',
      customer.adjuster_name || '',
      customer.adjuster_phone || '',
      customer.is_active ? 'Yes' : 'No',
      new Date(customer.created_date).toLocaleDateString(),
      customer.notes || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers_export_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();

    alert(`Exported ${customersToExport.length} customers to CSV!`);
  };

  const handleImport = () => {
    navigate(createPageUrl('DataImport') + '?entity=Customer');
  };

  const handleEdit = (customer) => {
    let initialSource = customer.source || "other";
    let initialCustomSource = "";

    // Determine if the source is a predefined one or a custom 'other'
    if (customer.source && !PREDEFINED_SOURCES.includes(customer.source)) {
      initialCustomSource = customer.source;
      initialSource = "other";
    }

    setEditingCustomer(customer);
    setFormData({
      name: customer.name || "",
      company: customer.company || "",
      customer_type: customer.customer_type || "residential",
      email: customer.email || "",
      phone: customer.phone || "",
      phone_2: customer.phone_2 || "",
      street: customer.street || "",
      city: customer.city || "",
      state: customer.state || "",
      zip: customer.zip || "",
      website: customer.website || "",
      source: initialSource, // Set based on logic above
      referral_source: customer.referral_source || "",
      custom_source: initialCustomSource, // Set custom_source
      is_active: customer.is_active,
      notes: customer.notes || "",
      group: customer.group || "",
      assigned_to: customer.assigned_to || "",
      assigned_to_users: Array.isArray(customer.assigned_to_users) ? customer.assigned_to_users : (customer.assigned_to ? [customer.assigned_to] : []),
      tags: customer.tags || [],
      insurance_company: customer.insurance_company || "",
      adjuster_name: customer.adjuster_name || "",
      adjuster_phone: customer.adjuster_phone || ""
    });
    setShowForm(true);
  };

  const toggleColumn = (column) => {
    setVisibleColumns(prev => ({
      ...prev,
      [column]: !prev[column]
    }));
  };

  const columnDisplayNames = {
    id: "Customer #",
    company: t.common.companyName,
    name: t.customers.name,
    customer_type: "Type",
    email: t.customers.email,
    phone: t.customers.phone,
    phone_2: "Phone 2",
    address: t.customers.address,
    source: t.customers.source,
    assigned: t.customers.assigned,
    group: "Group",
    insurance_company: "Insurance",
    adjuster_name: "Adjuster Name",
    adjuster_phone: "Adjuster Phone",
    active: t.customers.active,
    communication: "Communication",
    date_created: t.customers.createdDate,
    actions: t.common.actions,
  };

  let filteredCustomers = customers.filter(customer =>
    customer.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.address?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.street?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.city?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.state?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.zip?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.phone?.includes(searchTerm) ||
    customer.phone_2?.includes(searchTerm)
  );

  if (filters.status === 'active') {
    filteredCustomers = filteredCustomers.filter(c => c.is_active);
  } else if (filters.status === 'inactive') {
    filteredCustomers = filteredCustomers.filter(c => !c.is_active);
  }

  if (filters.group !== 'all') {
    filteredCustomers = filteredCustomers.filter(c => c.group === filters.group);
  }

  // Filter by source, including custom sources
  if (filters.source !== 'all') {
    filteredCustomers = filteredCustomers.filter(c => c.source === filters.source);
  }

  if (filters.customer_type !== 'all') {
    filteredCustomers = filteredCustomers.filter(c => c.customer_type === filters.customer_type);
  }

  filteredCustomers = [...filteredCustomers].sort((a, b) => {
    if (sortBy === 'customer_number') {
      const na = a.customer_number || 0, nb = b.customer_number || 0;
      return sortOrder === 'desc' ? nb - na : na - nb;
    }
    const da = new Date(a.created_date || 0).getTime();
    const db = new Date(b.created_date || 0).getTime();
    return sortOrder === 'desc' ? db - da : da - db;
  });

  const uniqueGroups = [...new Set(customers.map(c => c.group).filter(Boolean))];
  const uniqueSources = [...new Set(customers.map(c => c.source).filter(Boolean))];

  const effectivePageSize = pageSize === 'all' ? filteredCustomers.length : pageSize;
  const totalPages = effectivePageSize === 0 ? 0 : Math.ceil(filteredCustomers.length / effectivePageSize);
  const paginatedCustomers = pageSize === 'all'
    ? filteredCustomers
    : filteredCustomers.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize);

  const handleRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['customers'] });
  };

  // Desktop view table rendering
  const renderDesktopTable = () => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="px-4 py-2 text-left">
              <Checkbox
                checked={paginatedCustomers.length > 0 && paginatedCustomers.every(customer => selectedCustomers.includes(customer.id))}
                indeterminate={paginatedCustomers.length > 0 && paginatedCustomers.some(customer => selectedCustomers.includes(customer.id)) && !paginatedCustomers.every(customer => selectedCustomers.includes(customer.id))}
                onCheckedChange={handleSelectAll}
                disabled={paginatedCustomers.length === 0}
              />
            </th>
            {visibleColumns.id && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>}
            {visibleColumns.name && (
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-2">
                <span>{t.customers.name}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-1 hover:text-gray-700 ml-auto focus:outline-none">
                      <span className="text-[10px] font-normal lowercase text-gray-400">
                        {sortBy === 'customer_number'
                          ? (sortOrder === 'desc' ? '# ↓' : '# ↑')
                          : (sortOrder === 'desc' ? 'Newest' : 'Oldest')}
                      </span>
                      <Filter className="w-3 h-3 text-gray-400" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => { setSortBy('created_date'); setSortOrder('desc'); }}>
                      🆕 Newest First
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setSortBy('created_date'); setSortOrder('asc'); }}>
                      📅 Oldest First
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setSortBy('customer_number'); setSortOrder('desc'); }}>
                      # High → Low
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setSortBy('customer_number'); setSortOrder('asc'); }}>
                      # Low → High
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </th>
            )}
            {visibleColumns.company && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.common.companyName}</th>}
            {visibleColumns.customer_type && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>}
            {visibleColumns.email && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.customers.email}</th>}
            {visibleColumns.phone && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.customers.phone}</th>}
            {visibleColumns.phone_2 && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone 2</th>}
            {visibleColumns.address && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.customers.address}</th>}
            {visibleColumns.source && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.customers.source}</th>}
            {visibleColumns.assigned && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.customers.assigned}</th>}
            {visibleColumns.group && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Group</th>}
            {visibleColumns.insurance_company && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Insurance</th>}
            {visibleColumns.adjuster_name && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Adjuster Name</th>}
            {visibleColumns.adjuster_phone && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Adjuster Phone</th>}
            {visibleColumns.active && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.customers.active}</th>}
            {visibleColumns.communication && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Communication</th>}
            {visibleColumns.date_created && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.customers.createdDate}</th>}
            {visibleColumns.actions && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.common.actions}</th>}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {paginatedCustomers.map((customer) => {
            const assignedUsers = Array.isArray(customer.assigned_to_users) ? customer.assigned_to_users : (customer.assigned_to ? [customer.assigned_to] : []);
            const staffAvatars = assignedUsers.map(email => {
              const staff = uniqueStaffProfiles.find(s => s.user_email === email);
              return {
                email,
                avatar_url: staff?.avatar_url || null,
                full_name: staff?.full_name || email,
                initials: staff?.full_name
                  ? staff.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                  : (email && email.length > 0 ? email[0].toUpperCase() : '?')
              };
            });

            return (
              <tr key={customer.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 whitespace-nowrap">
                  <Checkbox
                    checked={selectedCustomers.includes(customer.id)}
                    onCheckedChange={() => handleSelectCustomer(customer.id)}
                  />
                </td>
                {visibleColumns.id && <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{customer.customer_number || '-'}</td>}
                {visibleColumns.name && (
                  <td className="px-6 py-4 whitespace-nowrap">
                    <button
                      onClick={() => navigate(createPageUrl('CustomerProfile') + `?id=${customer.id}`)}
                      className="text-blue-600 hover:text-blue-800 font-medium hover:underline text-left"
                    >
                      {customer.name}
                    </button>
                  </td>
                )}
                {visibleColumns.company && <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{customer.company || '-'}</td>}
                {visibleColumns.customer_type && (
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Badge variant="outline" className="text-xs">{customer.customer_type || 'Residential'}</Badge>
                  </td>
                )}
                {visibleColumns.email && <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-600">{customer.email || '-'}</td>}
                {visibleColumns.phone && <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{customer.phone || '-'}</td>}
                {visibleColumns.phone_2 && <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{customer.phone_2 || '-'}</td>}
                {visibleColumns.address && (
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {customer.street || customer.address ? (
                      <div>
                        {customer.street && <div>{customer.street}</div>}
                        {(customer.city || customer.state || customer.zip) && (
                          <div className="text-xs text-gray-500">
                            {[customer.city, customer.state, customer.zip].filter(Boolean).join(', ')}
                          </div>
                        )}
                        {!customer.street && customer.address && <div>{customer.address}</div>}
                      </div>
                    ) : '-'}
                  </td>
                )}
                {visibleColumns.source && (
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Badge variant="outline" className="text-xs">
                      {customer.source ? customer.source.replace(/_/g, ' ') : '-'}
                    </Badge>
                  </td>
                )}
                {visibleColumns.assigned && (
                  <td className="px-6 py-4 whitespace-nowrap">
                    {staffAvatars.length === 0 ? (
                      <span className="text-gray-400">-</span>
                    ) : (
                      <div className="flex -space-x-2">
                        {staffAvatars.slice(0, 3).map((staff) => (
                          <TooltipProvider key={staff.email}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex-shrink-0">
                                  <Avatar className="w-8 h-8 border-2 border-white">
                                    <AvatarImage src={staff.avatar_url} alt={staff.full_name} />
                                    <AvatarFallback className="bg-blue-100 text-blue-600 text-xs font-semibold">
                                      {staff.initials}
                                    </AvatarFallback>
                                  </Avatar>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{staff.full_name}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ))}
                        {staffAvatars.length > 3 && (
                          <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-600 border-2 border-white flex items-center justify-center text-xs font-semibold">
                            +{staffAvatars.length - 3}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                )}
                {visibleColumns.group && <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                  {customer.group || '-'}
                </td>}
                {visibleColumns.insurance_company && <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{customer.insurance_company || '-'}</td>}
                {visibleColumns.adjuster_name && <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{customer.adjuster_name || '-'}</td>}
                {visibleColumns.adjuster_phone && <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{customer.adjuster_phone || '-'}</td>}
                {visibleColumns.active && (
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Switch
                      checked={customer.is_active}
                      onCheckedChange={() => handleToggleActive(customer)}
                    />
                  </td>
                )}
                {visibleColumns.communication && (
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <button
                        className="p-1.5 hover:bg-blue-50 rounded-full transition-colors"
                        title={t.customers.sendEmail}
                        onClick={() => handleCommunication(customer, 'email')}
                      >
                        <Mail className="w-3.5 h-3.5 text-blue-600" />
                      </button>
                      <button
                        className="p-1.5 hover:bg-green-50 rounded-full transition-colors"
                        title={t.customers.call}
                        onClick={() => handleCommunication(customer, 'phone')}
                      >
                        <Phone className="w-3.5 h-3.5 text-green-600" />
                      </button>
                      <button
                        className="p-1.5 hover:bg-purple-50 rounded-full transition-colors"
                        title={t.customers.sendSMS}
                        onClick={() => handleCommunication(customer, 'sms')}
                      >
                        <MessageCircle className="w-3.5 h-3.5 text-purple-600" />
                      </button>
                    </div>
                  </td>
                )}
                {visibleColumns.date_created && (
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {format(new Date(customer.created_date), 'yyyy-MM-dd')}
                  </td>
                )}
                {visibleColumns.actions && (
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <button
                        className="p-1.5 hover:bg-blue-100 rounded-full transition-colors"
                        title={t.customers.view}
                        onClick={() => navigate(createPageUrl('CustomerProfile') + `?id=${customer.id}`)}
                      >
                        <Eye className="w-3.5 h-3.5 text-blue-600" />
                      </button>
                      <button
                        className="p-1.5 hover:bg-gray-100 rounded-full transition-colors"
                        title={t.customers.edit}
                        onClick={() => handleEdit(customer)}
                      >
                        <Edit className="w-3.5 h-3.5 text-gray-600" />
                      </button>
                      <button
                        className="p-1.5 hover:bg-red-100 rounded-full transition-colors"
                        title={t.customers.delete}
                        onClick={() => handleDelete(customer.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-600" />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
          {paginatedCustomers.length === 0 && (
            <tr>
              <td colSpan={Object.values(visibleColumns).filter(Boolean).length + 1} className="px-4 py-8 text-center text-gray-500 text-sm">
                {t.customers.noCustomers}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  if (isLoadingCustomers || isRoleDataLoading) {
    return <TablePageSkeleton />;
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="p-4 md:p-6 space-y-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.customers.title}</h1>
          <button
            onClick={() => navigate(createPageUrl('Customers'))}
            className="text-blue-600 hover:underline text-sm flex items-center gap-1 mt-1"
          >
            {t.sidebar.communication || "Contacts"} →
          </button>
        </div>

        <div className="overflow-x-auto no-scrollbar">
          <div className="flex md:grid md:grid-cols-4 lg:grid-cols-6 gap-3 pb-2" style={{ minWidth: isMobile ? '800px' : 'auto' }}>
            <Card className="bg-white flex-shrink-0" style={{ minWidth: isMobile ? '180px' : 'auto' }}>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-gray-900">{totalCustomers}</div>
                <div className="text-sm text-gray-500">{t.customers.totalCustomers}</div>
              </CardContent>
            </Card>
            <Card className="bg-white flex-shrink-0" style={{ minWidth: isMobile ? '180px' : 'auto' }}>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-green-600">{activeCustomers}</div>
                <div className="text-sm text-gray-500">{t.customers.active} {t.customers.title}</div>
              </CardContent>
            </Card>
            <Card className="bg-white flex-shrink-0" style={{ minWidth: isMobile ? '180px' : 'auto' }}>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-red-600">{inactiveCustomers}</div>
                <div className="text-sm text-gray-500">{t.customers.inactive} {t.customers.title}</div>
              </CardContent>
            </Card>
            <Card className="bg-white flex-shrink-0" style={{ minWidth: isMobile ? '180px' : 'auto' }}>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-blue-600">{activeCustomers}</div>
                <div className="text-sm text-gray-500">{t.customers.active} Contacts</div>
              </CardContent>
            </Card>
            <Card className="bg-white flex-shrink-0" style={{ minWidth: isMobile ? '180px' : 'auto' }}>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-orange-600">{inactiveCustomers}</div>
                <div className="text-sm text-gray-500">{t.customers.inactive} Contacts</div>
              </CardContent>
            </Card>
            <Card className="bg-white flex-shrink-0" style={{ minWidth: isMobile ? '180px' : 'auto' }}>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-gray-900">{contactsLoggedInToday}</div>
                <div className="text-sm text-gray-500">{t.customers.active} Contacts {t.dashboard.today}</div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className={`${isMobile ? 'sticky top-0 z-20 bg-background -mx-4 px-4 pt-3 pb-1 shadow-sm' : ''}`}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <Input
                placeholder={t.customers.searchCustomers}
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-10 h-12 text-base"
                autoComplete="off"
              />
            </div>
            {!isMobile && (
              <Select value={pageSize.toString()} onValueChange={(value) => {
                setPageSize(value === 'all' ? 'all' : parseInt(value));
                setCurrentPage(1);
              }}>
                <SelectTrigger className="w-24 h-12">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {selectedCustomers.length > 0 && (
          <div className="bg-blue-50 border border-blue-300 rounded-lg p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Checkbox
                checked={true}
                onCheckedChange={() => setSelectedCustomers([])}
              />
              <span className="font-semibold text-blue-900">
                {selectedCustomers.length} {t.customers.title.toLowerCase()}{selectedCustomers.length !== 1 ? 's' : ''} {t.common.selected || "selected"}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const allIds = filteredCustomers.map(c => c.id);
                  setSelectedCustomers(allIds);
                }}
              >
                Select All {filteredCustomers.length}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCSV}
              >
                <Download className="w-4 h-4 mr-2" />
                Export Selected
              </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleBulkDelete}
                        disabled={bulkDeleteMutation.isPending}
                      >
                        {bulkDeleteMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            {t.common.loading}
                          </>
                        ) : (
                          <>
                            <Trash2 className="w-4 h-4 mr-2" />
                            {t.common.delete} {selectedCustomers.length}
                          </>
                        )}
                      </Button>
            </div>
          </div>
        )}

        <div className="flex gap-2 items-center justify-between">
          <div className="flex gap-2">
            {isMobile ? (
              <Sheet open={showForm} onOpenChange={setShowForm}>
                <SheetTrigger asChild>
                  <Button className="flex-1 bg-blue-600 hover:bg-blue-700 h-12">
                    <Plus className="w-5 h-5 mr-2" />
                    {t.customers.addCustomer}
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="h-[90vh] overflow-y-auto">
                  <SheetHeader>
                    <SheetTitle>{editingCustomer ? t.customers.editCustomer : t.customers.addCustomer}</SheetTitle>
                  </SheetHeader>
                  <div className="mt-6">
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="name">{t.customers.name} *</Label>
                          <Input
                            id="name"
                            value={formData.name}
                            onChange={(e) => handleFormChange("name", e.target.value)}
                            placeholder="John Doe"
                            required
                            className="h-12 text-base"
                            autoComplete="off"
                          />
                        </div>

                        <div>
                          <Label htmlFor="company">{t.common.companyName}</Label>
                          <Input
                            id="company"
                            value={formData.company}
                            onChange={(e) => handleFormChange("company", e.target.value)}
                            placeholder="ABC Roofing Inc."
                            className="h-12 text-base"
                            autoComplete="off"
                          />
                        </div>

                        <div>
                          <Label htmlFor="customer_type">Customer Type</Label>
                          <Select value={formData.customer_type} onValueChange={(v) => handleFormChange("customer_type", v)}>
                            <SelectTrigger id="customer_type" className="h-12 text-base">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="residential">Residential</SelectItem>
                              <SelectItem value="commercial">Commercial</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label htmlFor="email">{t.customers.email}</Label>
                          <Input
                            id="email"
                            type="email"
                            value={formData.email}
                            onChange={(e) => handleFormChange("email", e.target.value)}
                            placeholder="john@example.com"
                            className="h-12 text-base"
                            autoComplete="off"
                          />
                        </div>

                        <div>
                          <Label htmlFor="phone">{t.customers.phone} 1</Label>
                          <Input
                            id="phone"
                            type="tel"
                            value={formData.phone}
                            onChange={(e) => handleFormChange("phone", e.target.value)}
                            placeholder="(555) 123-4567"
                            className="h-12 text-base"
                            autoComplete="off"
                          />
                        </div>
                        <div>
                          <Label htmlFor="phone_2">{t.customers.phone} 2</Label>
                          <Input
                            id="phone_2"
                            type="tel"
                            value={formData.phone_2}
                            onChange={(e) => handleFormChange("phone_2", e.target.value)}
                            placeholder="(555) 987-6543"
                            className="h-12 text-base"
                            autoComplete="off"
                          />
                        </div>

                        <div className="border-t pt-4">
                          <h3 className="font-semibold mb-3">{t.customers.address}</h3>
                          <div className="grid grid-cols-1 gap-4">
                            <div>
                              <Label htmlFor="street">{t.customers.address}</Label>
                              <Input
                                id="street"
                                value={formData.street}
                                onChange={(e) => handleFormChange("street", e.target.value)}
                                placeholder="123 Main Street"
                                className="h-12 text-base"
                                autoComplete="off"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <Label htmlFor="city">{t.customers.city}</Label>
                                <Input
                                  id="city"
                                  value={formData.city}
                                  onChange={(e) => handleFormChange("city", e.target.value)}
                                  placeholder="Cleveland"
                                  className="h-12 text-base"
                                  autoComplete="off"
                                />
                              </div>
                              <div>
                                <Label htmlFor="state">{t.customers.state}</Label>
                                <Input
                                  id="state"
                                  value={formData.state}
                                  onChange={(e) => handleFormChange("state", e.target.value)}
                                  placeholder="OH"
                                  maxLength={2}
                                  className="h-12 text-base"
                                  autoComplete="off"
                                />
                              </div>
                              <div>
                                <Label htmlFor="zip">{t.customers.zip}</Label>
                                <Input
                                  id="zip"
                                  value={formData.zip}
                                  onChange={(e) => handleFormChange("zip", e.target.value)}
                                  placeholder="44101"
                                  className="h-12 text-base"
                                  autoComplete="off"
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        <div>
                          <Label htmlFor="website">{t.customers.website}</Label>
                          <Input
                            id="website"
                            value={formData.website}
                            onChange={(e) => handleFormChange("website", e.target.value)}
                            placeholder="https://example.com"
                            className="h-12 text-base"
                            autoComplete="off"
                          />
                        </div>

                        <div>
                          <Label htmlFor="source">{t.customers.source} *</Label>
                          <Select value={formData.source} onValueChange={(value) => setFormData(prev => ({...prev, source: value, custom_source: value === 'other' ? prev.custom_source : ''}))}>
                            <SelectTrigger id="source" className="h-12 text-base">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="website">{t.customers.website}</SelectItem>
                              <SelectItem value="referral">{t.customers.referral}</SelectItem>
                              <SelectItem value="storm_tracker">{t.customers.stormTracker}</SelectItem>
                              <SelectItem value="property_importer">{t.customers.propertyImporter}</SelectItem>
                              <SelectItem value="social_media">{t.customers.socialMedia}</SelectItem>
                              <SelectItem value="advertisement">{t.customers.advertisement}</SelectItem>
                              <SelectItem value="cold_call">{t.customers.coldCall}</SelectItem>
                              <SelectItem value="walk_in">{t.customers.walkIn}</SelectItem>
                              <SelectItem value="other">{t.customers.other}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {formData.source === 'other' && (
                          <div>
                            <Label htmlFor="custom_source">Custom Source *</Label>
                            <Input
                              id="custom_source"
                              value={formData.custom_source || ''}
                              onChange={(e) => handleFormChange("custom_source", e.target.value)}
                              placeholder="Enter custom source (e.g., Trade Show, Vendor Referral)"
                              required
                            />
                          </div>
                        )}
                        <div>
                          <Label htmlFor="referral_source">Referred By <span className="text-gray-400 font-normal text-xs">(optional)</span></Label>
                          <Input
                            id="referral_source"
                            value={formData.referral_source}
                            onChange={(e) => handleFormChange("referral_source", e.target.value)}
                            placeholder="Name of person who referred this customer"
                            className="h-12 text-base"
                            autoComplete="off"
                            data-testid="input-referred-by-customer"
                          />
                        </div>

                        <div className="border-t pt-4">
                          <h3 className="font-semibold mb-3">{t.sidebar.aiMemory || "Additional Info"}</h3>
                          <div className="grid grid-cols-1 gap-4">
                            <div>
                              <Label htmlFor="group">Group</Label>
                              <CustomerGroupSelect
                                value={formData.group}
                                onChange={(value) => handleFormChange("group", value)}
                                companyId={myCompany?.id}
                              />
                            </div>

                            <div>
                              <Label>{t.customers.assigned}</Label>
                              <StaffMultiSelect
                                staffProfiles={uniqueStaffProfiles}
                                selectedEmails={formData.assigned_to_users || []}
                                onChange={(emails) => {
                                  handleFormChange("assigned_to_users", emails);
                                  handleFormChange("assigned_to", emails[0] || "");
                                }}
                              />
                            </div>

                            <div>
                              <Label htmlFor="insurance_company">Insurance Company</Label>
                              <Input
                                id="insurance_company"
                                value={formData.insurance_company}
                                onChange={(e) => handleFormChange("insurance_company", e.target.value)}
                                placeholder="e.g., State Farm"
                                className="h-12 text-base"
                                autoComplete="off"
                              />
                            </div>
                            <div>
                              <Label htmlFor="adjuster_name">Adjuster Name</Label>
                              <Input
                                id="adjuster_name"
                                value={formData.adjuster_name}
                                onChange={(e) => handleFormChange("adjuster_name", e.target.value)}
                                className="h-12 text-base"
                                autoComplete="off"
                              />
                            </div>
                            <div>
                              <Label htmlFor="adjuster_phone">Adjuster Phone</Label>
                              <Input
                                id="adjuster_phone"
                                value={formData.adjuster_phone}
                                onChange={(e) => handleFormChange("adjuster_phone", e.target.value)}
                                className="h-12 text-base"
                                autoComplete="off"
                              />
                            </div>
                          </div>
                        </div>

                        <div>
                          <Label htmlFor="notes">{t.customers.notes}</Label>
                          <Textarea
                            id="notes"
                            value={formData.notes}
                            onChange={(e) => handleFormChange("notes", e.target.value)}
                            rows={3}
                            placeholder="Additional notes about this customer..."
                            className="text-base"
                            autoComplete="off"
                          />
                        </div>

                        <div className="flex items-center gap-3">
                          <Switch
                            id="is_active"
                            checked={formData.is_active}
                            onCheckedChange={(checked) => handleFormChange("is_active", checked)}
                          />
                          <Label htmlFor="is_active">{t.customers.active}</Label>
                        </div>
                      </div>

                      <div className="flex gap-3 pt-4">
                        <Button type="button" variant="outline" onClick={handleCancel} className="flex-1 h-12">
                          {t.common.cancel}
                        </Button>
                        <Button
                          type="submit"
                          className="flex-1 h-12 bg-blue-600 hover:bg-blue-700"
                          disabled={createMutation.isPending || updateMutation.isPending}
                        >
                          {createMutation.isPending || updateMutation.isPending ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t.common.loading}</>
                          ) : (
                            <>{editingCustomer ? t.customers.editCustomer : t.customers.addCustomer}</>
                          )}
                        </Button>
                      </div>
                    </form>
                  </div>
                </SheetContent>
              </Sheet>
            ) : (
              <>
              <Button className="bg-blue-600 hover:bg-blue-700 text-sm h-9" onClick={() => { setEditingCustomer(null); setShowForm(true); }}>
                <Plus className="w-4 h-4 mr-2" />
                {t.customers.addCustomer}
              </Button>
              <Sheet open={showForm} onOpenChange={setShowForm}>
                <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto z-[100]">
                  <SheetHeader>
                    <SheetTitle>{editingCustomer ? t.customers.editCustomer : t.customers.addCustomer}</SheetTitle>
                  </SheetHeader>
                  <div className="mt-6">
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="name">{t.customers.name} *</Label>
                          <Input
                            id="name"
                            value={formData.name}
                            onChange={(e) => handleFormChange("name", e.target.value)}
                            placeholder="John Doe"
                            required
                            className="h-12 text-base"
                            autoComplete="off"
                          />
                        </div>

                        <div>
                          <Label htmlFor="company">{t.common.companyName}</Label>
                          <Input
                            id="company"
                            value={formData.company}
                            onChange={(e) => handleFormChange("company", e.target.value)}
                            placeholder="ABC Roofing Inc."
                            className="h-12 text-base"
                            autoComplete="off"
                          />
                        </div>

                        <div>
                          <Label htmlFor="customer_type">Customer Type</Label>
                          <Select value={formData.customer_type} onValueChange={(v) => handleFormChange("customer_type", v)}>
                            <SelectTrigger id="customer_type" className="h-12 text-base">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="residential">Residential</SelectItem>
                              <SelectItem value="commercial">Commercial</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label htmlFor="email">{t.customers.email}</Label>
                          <Input
                            id="email"
                            type="email"
                            value={formData.email}
                            onChange={(e) => handleFormChange("email", e.target.value)}
                            placeholder="john@example.com"
                            className="h-12 text-base"
                            autoComplete="off"
                          />
                        </div>

                        <div>
                          <Label htmlFor="phone">{t.customers.phone} 1</Label>
                          <Input
                            id="phone"
                            type="tel"
                            value={formData.phone}
                            onChange={(e) => handleFormChange("phone", e.target.value)}
                            placeholder="(555) 123-4567"
                            className="h-12 text-base"
                            autoComplete="off"
                          />
                        </div>
                        <div>
                          <Label htmlFor="phone_2">{t.customers.phone} 2</Label>
                          <Input
                            id="phone_2"
                            type="tel"
                            value={formData.phone_2}
                            onChange={(e) => handleFormChange("phone_2", e.target.value)}
                            placeholder="(555) 987-6543"
                            className="h-12 text-base"
                            autoComplete="off"
                          />
                        </div>

                        <div className="border-t pt-4">
                          <h3 className="font-semibold mb-3">{t.customers.address}</h3>
                          <div className="grid grid-cols-1 gap-4">
                            <div>
                              <Label htmlFor="street">{t.customers.address}</Label>
                              <Input
                                id="street"
                                value={formData.street}
                                onChange={(e) => handleFormChange("street", e.target.value)}
                                placeholder="123 Main Street"
                                className="h-12 text-base"
                                autoComplete="off"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <Label htmlFor="city">{t.customers.city}</Label>
                                <Input
                                  id="city"
                                  value={formData.city}
                                  onChange={(e) => handleFormChange("city", e.target.value)}
                                  placeholder="Cleveland"
                                  className="h-12 text-base"
                                  autoComplete="off"
                                />
                              </div>
                              <div>
                                <Label htmlFor="state">{t.customers.state}</Label>
                                <Input
                                  id="state"
                                  value={formData.state}
                                  onChange={(e) => handleFormChange("state", e.target.value)}
                                  placeholder="OH"
                                  maxLength={2}
                                  className="h-12 text-base"
                                  autoComplete="off"
                                />
                              </div>
                              <div>
                                <Label htmlFor="zip">{t.customers.zip}</Label>
                                <Input
                                  id="zip"
                                  value={formData.zip}
                                  onChange={(e) => handleFormChange("zip", e.target.value)}
                                  placeholder="44101"
                                  className="h-12 text-base"
                                  autoComplete="off"
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        <div>
                          <Label htmlFor="website">{t.customers.website}</Label>
                          <Input
                            id="website"
                            value={formData.website}
                            onChange={(e) => handleFormChange("website", e.target.value)}
                            placeholder="https://example.com"
                            className="h-12 text-base"
                            autoComplete="off"
                          />
                        </div>

                        <div>
                          <Label htmlFor="source">{t.customers.source} *</Label>
                          <Select value={formData.source} onValueChange={(value) => setFormData(prev => ({...prev, source: value, custom_source: value === 'other' ? prev.custom_source : ''}))}>
                            <SelectTrigger id="source" className="h-12 text-base">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="website">{t.customers.website}</SelectItem>
                              <SelectItem value="referral">{t.customers.referral}</SelectItem>
                              <SelectItem value="storm_tracker">{t.customers.stormTracker}</SelectItem>
                              <SelectItem value="property_importer">{t.customers.propertyImporter}</SelectItem>
                              <SelectItem value="social_media">{t.customers.socialMedia}</SelectItem>
                              <SelectItem value="advertisement">{t.customers.advertisement}</SelectItem>
                              <SelectItem value="cold_call">{t.customers.coldCall}</SelectItem>
                              <SelectItem value="walk_in">{t.customers.walkIn}</SelectItem>
                              <SelectItem value="other">{t.customers.other}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {formData.source === 'other' && (
                          <div>
                            <Label htmlFor="custom_source">Custom Source *</Label>
                            <Input
                              id="custom_source"
                              value={formData.custom_source || ''}
                              onChange={(e) => handleFormChange("custom_source", e.target.value)}
                              placeholder="Enter custom source (e.g., Trade Show, Vendor Referral)"
                              required
                            />
                          </div>
                        )}
                        <div>
                          <Label htmlFor="referral_source">Referred By <span className="text-gray-400 font-normal text-xs">(optional)</span></Label>
                          <Input
                            id="referral_source"
                            value={formData.referral_source}
                            onChange={(e) => handleFormChange("referral_source", e.target.value)}
                            placeholder="Name of person who referred this customer"
                            className="h-12 text-base"
                            autoComplete="off"
                            data-testid="input-referred-by-customer"
                          />
                        </div>

                        <div className="border-t pt-4">
                          <h3 className="font-semibold mb-3">{t.sidebar.aiMemory || "Additional Info"}</h3>
                          <div className="grid grid-cols-1 gap-4">
                            <div>
                              <Label htmlFor="group">Group</Label>
                              <CustomerGroupSelect
                                value={formData.group}
                                onChange={(value) => handleFormChange("group", value)}
                                companyId={myCompany?.id}
                              />
                            </div>

                            <div>
                              <Label>{t.customers.assigned}</Label>
                              <StaffMultiSelect
                                staffProfiles={uniqueStaffProfiles}
                                selectedEmails={formData.assigned_to_users || []}
                                onChange={(emails) => {
                                  handleFormChange("assigned_to_users", emails);
                                  handleFormChange("assigned_to", emails[0] || "");
                                }}
                              />
                            </div>

                            <div>
                              <Label htmlFor="insurance_company">Insurance Company</Label>
                              <Input
                                id="insurance_company"
                                value={formData.insurance_company}
                                onChange={(e) => handleFormChange("insurance_company", e.target.value)}
                                placeholder="e.g., State Farm"
                                className="h-12 text-base"
                                autoComplete="off"
                              />
                            </div>
                            <div>
                              <Label htmlFor="adjuster_name">Adjuster Name</Label>
                              <Input
                                id="adjuster_name"
                                value={formData.adjuster_name}
                                onChange={(e) => handleFormChange("adjuster_name", e.target.value)}
                                className="h-12 text-base"
                                autoComplete="off"
                              />
                            </div>
                            <div>
                              <Label htmlFor="adjuster_phone">Adjuster Phone</Label>
                              <Input
                                id="adjuster_phone"
                                value={formData.adjuster_phone}
                                onChange={(e) => handleFormChange("adjuster_phone", e.target.value)}
                                className="h-12 text-base"
                                autoComplete="off"
                              />
                            </div>
                          </div>
                        </div>

                        <div>
                          <Label htmlFor="notes">{t.customers.notes}</Label>
                          <Textarea
                            id="notes"
                            value={formData.notes}
                            onChange={(e) => handleFormChange("notes", e.target.value)}
                            rows={3}
                            placeholder="Additional notes about this customer..."
                            className="text-base"
                            autoComplete="off"
                          />
                        </div>

                        <div className="flex items-center gap-3">
                          <Switch
                            id="is_active"
                            checked={formData.is_active}
                            onCheckedChange={(checked) => handleFormChange("is_active", checked)}
                          />
                          <Label htmlFor="is_active">{t.customers.active}</Label>
                        </div>
                      </div>

                      <div className="flex gap-3 pt-4">
                        <Button type="button" variant="outline" onClick={handleCancel} className="flex-1 h-12">
                          {t.common.cancel}
                        </Button>
                        <Button
                          type="submit"
                          className="flex-1 h-12 bg-blue-600 hover:bg-blue-700"
                          disabled={createMutation.isPending || updateMutation.isPending}
                        >
                          {createMutation.isPending || updateMutation.isPending ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t.common.loading}</>
                          ) : (
                            <>{editingCustomer ? t.customers.editCustomer : t.customers.addCustomer}</>
                          )}
                        </Button>
                      </div>
                    </form>
                  </div>
                </SheetContent>
              </Sheet>
              </>
            )}

            <Button variant="outline" onClick={handleImport} className="text-sm h-9">
              <Upload className="w-4 h-4 mr-2" />
              {t.customers.importCustomers}
            </Button>
          </div>

          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <Eye className="w-4 h-4 mr-2" />
                  {t.sidebar.columns || "Columns"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {Object.keys(visibleColumns).map(col => (
                  <DropdownMenuItem
                    key={col}
                    onSelect={(e) => {
                      e.preventDefault();
                      toggleColumn(col);
                    }}
                    className="flex items-center justify-between"
                  >
                    <span>{columnDisplayNames[col]}</span>
                    <Checkbox checked={visibleColumns[col]} className="ml-2 pointer-events-none" />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className={`text-sm h-9 ${showFilters ? 'bg-blue-50 border-blue-300' : ''}`}
            >
              <Filter className="w-4 h-4 mr-2" />
              {t.customers.filters}
            </Button>
          </div>
        </div>

        {showFilters && (
          <div className="px-4 py-3 border-b bg-gray-50 rounded-lg">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">{t.customers.status}</Label>
                <Select value={filters.status} onValueChange={(value) => {
                  setFilters({...filters, status: value});
                  setCurrentPage(1);
                }}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.customers.allStatuses}</SelectItem>
                    <SelectItem value="active">{t.customers.active}</SelectItem>
                    <SelectItem value="inactive">{t.customers.inactive}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={filters.customer_type} onValueChange={(value) => {
                  setFilters({...filters, customer_type: value});
                  setCurrentPage(1);
                }}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="residential">Residential</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t.customers.source}</Label>
                <Select value={filters.source} onValueChange={(value) => {
                  setFilters({...filters, source: value});
                  setCurrentPage(1);
                }}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.customers.selectSource}</SelectItem>
                    {uniqueSources.filter(source => source && source.trim() !== "").map(source => (
                      <SelectItem key={source} value={source}>{source.replace(/_/g, ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Group</Label>
                <Select value={filters.group} onValueChange={(value) => {
                  setFilters({...filters, group: value});
                  setCurrentPage(1);
                }}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Groups</SelectItem>
                    {uniqueGroups.filter(group => group && group.trim() !== "").map(group => (
                      <SelectItem key={group} value={group}>{group}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}
      </div>

      {isMobile ? (
        <div className="flex-1 overflow-auto">
            <div className="px-4 pb-4 space-y-3">
              {paginatedCustomers.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-2 flex items-center gap-2 text-sm text-blue-800">
                  <ChevronLeft className="w-5 h-5" />
                  <span>💡 Swipe left on any card for quick actions</span>
                </div>
              )}

              {paginatedCustomers.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Users className="w-16 h-16 mx-auto mb-3 text-gray-300" />
                  <p className="font-medium">{t.customers.noCustomers}</p>
                  <p className="text-sm mt-1">Try adjusting your search or filters</p>
                </div>
              )}

              {paginatedCustomers.map((customer) => (
                <SwipeableCard
                  key={customer.id}
                  onCall={customer.phone ? () => handleCommunication(customer, 'phone') : null}
                  onEmail={customer.email ? () => handleCommunication(customer, 'email') : null}
                  onSMS={customer.phone ? () => handleCommunication(customer, 'sms') : null}
                  onDelete={() => handleDelete(customer.id)}
                  className="p-4 rounded-lg shadow-sm border border-gray-200"
                >
                  <div
                    onClick={() => navigate(createPageUrl('CustomerProfile') + `?id=${customer.id}`)}
                    className="space-y-3"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 pr-6">
                        <h3 className="font-semibold text-lg text-gray-900">{customer.name}</h3>
                        {customer.company && (
                          <div className="flex items-center gap-1 text-sm text-gray-600 mt-1">
                            <Building2 className="w-4 h-4" />
                            {customer.company}
                          </div>
                        )}
                        {(() => {
                          const assignedUsers = Array.isArray(customer.assigned_to_users) ? customer.assigned_to_users : (customer.assigned_to ? [customer.assigned_to] : []);
                          const staffAvatars = getStaffAvatars(assignedUsers);

                          if (staffAvatars.length === 0) return null;

                          return (
                            <div className="flex -space-x-1.5 mt-2">
                              {staffAvatars.slice(0, 3).map((staff, idx) => (
                                <div key={staff.email} className="flex-shrink-0" title={staff.full_name}>
                                  {staff.avatar_url ? (
                                    <img
                                      src={staff.avatar_url}
                                      alt={staff.full_name}
                                      className="w-6 h-6 rounded-full object-cover border border-white"
                                    />
                                  ) : (
                                    <div className="w-6 h-6 rounded-full bg-green-100 text-green-600 border border-white flex items-center justify-center text-xs font-semibold">
                                      {staff.initials}
                                    </div>
                                  )}
                                </div>
                              ))}
                              {staffAvatars.length > 3 && (
                                <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 border border-white flex items-center justify-center text-xs font-semibold">
                                  +{staffAvatars.length - 3}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant="outline" className={customer.is_active ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-700"}>
                          {customer.is_active ? t.customers.active : t.customers.inactive}
                        </Badge>
                        {customer.customer_type && (
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 text-xs">
                            {customer.customer_type}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      {customer.phone && (
                        <div className="flex items-center gap-2 text-sm">
                          <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <a href={`tel:${customer.phone}`} className="text-blue-600 font-medium" onClick={(e) => e.stopPropagation()}>
                            {customer.phone}
                          </a>
                        </div>
                      )}
                      {customer.email && (
                        <div className="flex items-center gap-2 text-sm">
                          <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <a href={`mailto:${customer.email}`} className="text-blue-600 truncate" onClick={(e) => e.stopPropagation()}>
                            {customer.email}
                          </a>
                        </div>
                      )}
                      {(customer.street || customer.address) && (
                        <div className="flex items-start gap-2 text-sm text-gray-600">
                          <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                          <div>
                            {customer.street && <div>{customer.street}</div>}
                            {(customer.city || customer.state || customer.zip) && (
                              <div className="text-gray-500">
                                {[customer.city, customer.state, customer.zip].filter(Boolean).join(', ')}
                              </div>
                            )}
                            {!customer.street && customer.address && <div>{customer.address}</div>}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t">
                      <span className="font-medium">#{customer.customer_number || '-'}</span>
                      <span>{format(new Date(customer.created_date), 'MMM d, yyyy')}</span>
                    </div>
                  </div>
                </SwipeableCard>
              ))}
            </div>
          {paginatedCustomers.length > 0 && pageSize !== 'all' && totalPages > 1 && (
            <div className="px-4 py-2 border-t flex items-center justify-between bg-white sticky bottom-0 z-10">
              <div className="text-xs text-gray-500">
                Showing {((currentPage - 1) * effectivePageSize) + 1} to {Math.min(currentPage * effectivePageSize, filteredCustomers.length)} of {filteredCustomers.length} customers
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="h-8 text-xs"
                >
                  {t.common.back}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="h-8 text-xs"
                >
                  {t.common.next}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-6 pb-6">
          <Card className="bg-white shadow-md">
            <div className="px-4 py-2 border-b bg-gray-50 flex items-center gap-2">
              <Select value={pageSize.toString()} onValueChange={(value) => {
                setPageSize(value === 'all' ? 'all' : parseInt(value));
                setCurrentPage(1);
              }}>
                <SelectTrigger className="w-16 h-8 text-sm">
                  <SelectValue placeholder="Page Size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>

              <Button variant="outline" size="sm" onClick={handleExportCSV} className="h-8 text-xs">
                <Download className="w-3 h-3 mr-1" />
                {t.customers.exportCSV}
              </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">
                  {t.customers.bulkActions || "Bulk Actions"}
                  {selectedCustomers.length > 0 && (
                    <Badge variant="secondary" className="ml-2 text-xs">
                      {selectedCustomers.length}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => {
                  const allIds = filteredCustomers.map(c => c.id);
                  setSelectedCustomers(allIds);
                }}>
                  <Checkbox className="w-3 h-3 mr-2" />
                  {t.common.selectAll || "Select All"} ({filteredCustomers.length})
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSelectedCustomers([])}>
                  <X className="w-3 h-3 mr-2" />
                  {t.common.none || "Deselect All"}
                </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleExportCSV} disabled={selectedCustomers.length === 0}>
                    <Download className="w-3 h-3 mr-2" />
                    {t.customers.exportCSV} {t.common.selected || "Selected"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={handleBulkDelete}
                    className="text-red-600"
                    disabled={selectedCustomers.length === 0}
                  >
                    <Trash2 className="w-3 h-3 mr-2" />
                    {t.common.delete} {t.common.selected || "Selected"} ({selectedCustomers.length})
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="outline"
                size="sm"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['customers'] })}
                className="h-8"
              >
                <RefreshCw className="w-3 h-3" />
              </Button>

              <div className="ml-auto text-xs text-gray-500">
                {filteredCustomers.length} customer{filteredCustomers.length !== 1 ? 's' : ''}
              </div>
            </div>

            <CardContent className="p-0">
              {renderDesktopTable()}

              {filteredCustomers.length > 0 && pageSize !== 'all' && totalPages > 1 && (
                <div className="px-4 py-2 border-t flex items-center justify-between">
                  <div className="text-xs text-gray-500">
                    Showing {((currentPage - 1) * effectivePageSize) + 1} to {Math.min(currentPage * effectivePageSize, filteredCustomers.length)} of {filteredCustomers.length} customers
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="h-8 text-xs"
                    >
                      {t.common.previous || "Previous"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="h-8 text-xs"
                    >
                      {t.common.next || "Next"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialer
        open={showDialer}
        onOpenChange={setShowDialer}
        defaultNumber={selectedCustomer?.phone || selectedCustomer?.phone_2}
      />
      <EmailDialog
        open={showEmailDialog}
        onOpenChange={setShowEmailDialog}
        defaultTo={selectedCustomer?.email}
        defaultName={selectedCustomer?.name}
      />
      <SMSDialog
        open={showSMSDialog}
        onOpenChange={setShowSMSDialog}
        defaultTo={selectedCustomer?.phone || selectedCustomer?.phone_2}
        defaultName={selectedCustomer?.name}
      />

      <Dialog open={showDuplicateDialog} onOpenChange={setShowDuplicateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>⚠️ Lead Already Exists</DialogTitle>
            <DialogDescription>
              This person is already in your system as a lead. Convert to customer instead of creating a duplicate?
            </DialogDescription>
          </DialogHeader>

          {duplicateLead && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3 my-4">
              <div>
                <p className="text-sm font-semibold text-gray-900">{duplicateLead.name}</p>
                {duplicateLead.email && (
                  <p className="text-xs text-gray-600 flex items-center gap-1">
                    <Mail className="w-3 h-3" /> {duplicateLead.email}
                  </p>
                )}
                {duplicateLead.phone && (
                  <p className="text-xs text-gray-600 flex items-center gap-1">
                    <Phone className="w-3 h-3" /> {duplicateLead.phone}
                  </p>
                )}
                {duplicateLead.lead_source && (
                  <p className="text-xs text-gray-500 mt-1">Source: {duplicateLead.lead_source}</p>
                )}
              </div>
            </div>
          )}

          <p className="text-sm text-gray-700">
            Converting this lead will move them to your customers list and remove them from leads. The lead data will be preserved.
          </p>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowDuplicateDialog(false);
                setDuplicateLead(null);
              }}
            >
              Cancel
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => {
                if (duplicateLead) {
                  convertLeadToCustomer(duplicateLead.id, duplicateLead);
                }
              }}
            >
              ✓ Convert to Customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}