import React, { useState, useEffect, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { BulkDeleteButton, BulkDeleteMenuItem } from "@/components/BulkDeleteControls";
import { syncPhotoSyncClientNames } from "@/utils/photoSyncCustomerName";
import { getLastUsedCompanyId } from "@/lib/activeCompanySelection";
import { normalizeAssignmentStaff, resolveCustomerCompanyId } from "@/utils/customerStaffAssignment";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Search, Mail, Phone, MessageCircle, Eye, Edit, Trash2, Download, RefreshCw, Upload, Filter, MapPin, Building2, ChevronLeft, Users, Loader2, X, AlertTriangle } from "lucide-react";
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
import { findSimilarCustomers } from "@/utils/duplicateCheck";
import { createPageUrl } from "@/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCompanyInspections } from "../components/inspections/InspectionPill";
import { localToday } from "@/utils/localDate";
import { matchesAddressSearch } from "@/utils/addressSearch";
import { CustomerInspectionStatus, CustomerInspectionStatusDialog } from "@/components/customers/CustomerInspectionStatus";
import { isCustomerInspected } from "@/utils/customerInspectionStatus";

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
  const [inspectionSelection, setInspectionSelection] = useState(null);
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [duplicateLead, setDuplicateLead] = useState(null);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [showDeleteCustomerDialog, setShowDeleteCustomerDialog] = useState(false);
  const [deleteCustomerId, setDeleteCustomerId] = useState(null);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [bulkDeleteDialogInfo, setBulkDeleteDialogInfo] = useState(null);
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
    adjuster_phone: "",
    claim_number: ""
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
    inspection: true,
    actions: true
  });

  // Storm Mode chips: filter customers by inspection state.
  const [stormFilter, setStormFilter] = useState('all');

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
  const openInspectionUpdate = (records, clear = false) => {
    if (!records.length || !guardAction("Updating inspection status")) return;
    setInspectionSelection({ customers: records, clear });
  };

  const assignmentCompanyId = resolveCustomerCompanyId(myCompany, getLastUsedCompanyId(user?.email));
  const {
    data: staffProfiles = [],
    isFetching: isStaffLoading,
    error: staffLoadError,
    refetch: refreshAssignmentStaff,
  } = useQuery({
    queryKey: ['customer-assignment-staff', assignmentCompanyId],
    queryFn: () => {
      if (!assignmentCompanyId) throw new Error('No company selected.');
      return base44.entities.StaffProfile.filter({ company_id: assignmentCompanyId }, "-created_date", 1000);
    },
    enabled: !!user && !!assignmentCompanyId,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  // StaffProfile rows created by older setup flows may store the address in
  // `email` instead of `user_email`. Normalize before deduplicating so those
  // staff members remain assignable.
  const uniqueStaffProfiles = useMemo(() => normalizeAssignmentStaff(staffProfiles), [staffProfiles]);

  // Centralized inspection lookup (shared with the Leads page).
  const { getInspectionForCustomer, photoCountForJob } = useCompanyInspections(myCompany?.id);

  // Once per session per company, ask the backfill function to scan EVERY
  // inspection (not just the ones we render) and link any that are missing
  // related_customer_id to a Customer with an exact, unambiguous name match.
  // The function decides whether work is needed; older unlinked jobs may sit
  // outside the page's window so we never gate on a visible sample.
  const inspectionCustomerBackfillRanRef = React.useRef(new Set());
  const inspectionCustomerBackfillInFlightRef = React.useRef(new Set());
  React.useEffect(() => {
    const cid = myCompany?.id;
    if (!cid) return;
    if (inspectionCustomerBackfillRanRef.current.has(cid)) return;
    if (inspectionCustomerBackfillInFlightRef.current.has(cid)) return;
    inspectionCustomerBackfillInFlightRef.current.add(cid);
    (async () => {
      try {
        const res = await base44.functions.invoke('backfillInspectionCustomerIds', {});
        // Only mark this company as backfilled on success — a transient
        // failure should be retried the next time the page mounts.
        inspectionCustomerBackfillRanRef.current.add(cid);
        if (res?.data?.updated > 0) {
          queryClient.invalidateQueries({ queryKey: ['company-inspections', cid] });
        }
      } catch (e) {
        console.warn('Inspection customer backfill skipped:', e?.message || e);
      } finally {
        inspectionCustomerBackfillInFlightRef.current.delete(cid);
      }
    })();
  }, [myCompany?.id, queryClient]);

  const { data: allCustomers = [], isLoading: isLoadingCustomers } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_at") : [],
    enabled: !!myCompany?.id,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // 🔐 Filter customers based on role permissions using the hook
  const customers = useMemo(() => {
    // SAFETY CHECK: If platform admin, always show all customers to prevent filtering issues
    if (user?.platform_role === 'super_admin') {
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
        tags: [], insurance_company: "", adjuster_name: "", adjuster_phone: "", claim_number: ""
      });
      return newCustomer;
    } catch (error) {
      toast.error('Failed to convert lead: ' + error.message);
      throw error;
    }
  };

  const createMutation = useMutation({
    mutationFn: async (customerData) => {
      const companyId = assignmentCompanyId;
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

      // If notes were entered, also add them as a structured customer_notes entry
      const notesText = (dataWithoutIdAndAddressParts.notes || '').trim();
      const initialCustomerNotes = notesText ? [{
        id: `note_create_${Date.now()}`,
        note: notesText,
        created_at: new Date().toISOString(),
        created_by: user?.email || 'system',
        source: 'customer_form'
      }] : [];

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
        customer_notes: initialCustomerNotes,
      });

      // Customer.create() already fires the single server-side create
      // notification. Do not call universalNotificationDispatcher here too:
      // that would send a duplicate admin email/SMS.
      if (myCompany?.id) {
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
      }

      return newCustomer;
    },
    onSuccess: async (newCustomer) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.email] });
      setShowForm(false);
      setEditingCustomer(null);
      
      // Workflow automations for the new customer fire automatically via the entity API
      // (autoTriggerWorkflowsFromMutation runs server-side on create); the explicit
      // re-trigger here was removed because it caused duplicate customer emails/SMS.
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
        adjuster_phone: "",
        claim_number: ""
      });
      toast.success('Customer created successfully!');
    },
    onError: (error) => {
      if (error.message === 'duplicate_found') return;
      console.error("Error creating customer:", error);
      if (error.message === 'Not found' || error.message?.includes('404')) {
        toast.error('Failed to create customer: Server route not found. Please refresh the page and try again. If the problem persists, try logging out and back in.');
      } else {
        toast.error(`Failed to create customer: ${error.message}`);
      }
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data, previousCustomer }) => {
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
      if (updatedCustomer.name?.trim() !== previousCustomer?.name?.trim()) {
        try {
          await syncPhotoSyncClientNames(base44.entities.InspectionJob, updatedCustomer, myCompany?.id);
        } catch (error) {
          updatedCustomer._photoSyncNameSyncError = error.message;
          console.error('Customer name saved but PhotoSync name sync failed:', error);
        }
      }

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

      // Sync assignment to linked leads and inspections
      if (data.assigned_to_users && data.assigned_to_users.length > 0) {
        const primaryAssignee = data.assigned_to_users[0];
        try {
          const leads = await base44.entities.Lead.filter({ customer_id: id });
          for (const lead of leads) {
            await base44.entities.Lead.update(lead.id, {
              assigned_to: primaryAssignee,
              assigned_to_users: data.assigned_to_users,
            });
          }
        } catch (e) { console.error('Customer→Lead assignment sync failed:', e); }
        try {
          const jobs = await base44.entities.InspectionJob.filter({ related_customer_id: id });
          for (const job of jobs) {
            await base44.entities.InspectionJob.update(job.id, { assigned_to_email: primaryAssignee });
          }
        } catch (e) { console.error('Customer→Inspection assignment sync failed:', e); }
        try {
          const custName = updatedCustomer.name;
          if (custName) {
            const tasks = await base44.entities.Task.filter({ related_to: custName });
            for (const task of tasks) {
              if (task.column !== 'job_completed' && task.column !== 'customer_lost') {
                await base44.entities.Task.update(task.id, {
                  assigned_to: primaryAssignee,
                  assignees: [{ email: primaryAssignee, name: primaryAssignee }],
                });
              }
            }
          }
        } catch (e) { console.error('Customer→Task assignment sync failed:', e); }
      }

      // Auto-push contact field changes (address / phone / email) to linked inspections
      try {
        const oldStreet = previousCustomer?.street ?? '';
        const oldCity   = previousCustomer?.city   ?? '';
        const oldState  = previousCustomer?.state  ?? '';
        const oldZip    = previousCustomer?.zip    ?? '';
        const newStreet = data.street ?? oldStreet;
        const newCity   = data.city   ?? oldCity;
        const newState  = data.state  ?? oldState;
        const newZip    = data.zip    ?? oldZip;

        const oldAddress = [oldStreet, oldCity, oldState, oldZip].filter(Boolean).join(', ');
        const newAddress = [newStreet, newCity, newState, newZip].filter(Boolean).join(', ');

        const addressChanged = newAddress !== oldAddress;
        const phoneChanged   = data.phone !== undefined && data.phone !== (previousCustomer?.phone ?? '');
        const emailChanged   = data.email !== undefined && data.email !== (previousCustomer?.email ?? '');

        if (addressChanged || phoneChanged || emailChanged) {
          const linkedJobs = await base44.entities.InspectionJob.filter({ related_customer_id: id });
          if (linkedJobs.length > 0) {
            const patch = {};
            if (addressChanged) patch.property_address = newAddress;
            if (phoneChanged)   patch.client_phone     = data.phone;
            if (emailChanged)   patch.client_email     = data.email;
            await Promise.all(linkedJobs.map(job => base44.entities.InspectionJob.update(job.id, patch)));
            updatedCustomer._syncedInspectionCount = linkedJobs.length;
          }
        }
      } catch (syncErr) {
        console.warn('[Customers] Could not auto-sync inspections:', syncErr.message);
      }

      return updatedCustomer;
    },
    onSuccess: (updatedCustomer) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['inspection-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['inspectionJobs'] });
      queryClient.invalidateQueries({ queryKey: ['inspectionJob'] });
      queryClient.invalidateQueries({ queryKey: ['customer-inspection-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['photoSyncCustomer'] });
      queryClient.invalidateQueries({ queryKey: ['photoSyncCustomerNames'] });
      if (updatedCustomer?._syncedInspectionCount > 0) {
        const n = updatedCustomer._syncedInspectionCount;
        toast.success(`📋 ${n} linked inspection${n > 1 ? 's' : ''} updated with new contact info.`);
      }
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
        adjuster_phone: "",
        claim_number: ""
      });
      if (updatedCustomer?._photoSyncNameSyncError) {
        toast.error(`Customer saved, but PhotoSync could not update all linked job names: ${updatedCustomer._photoSyncNameSyncError}`);
      } else {
        toast.success('Customer updated successfully!');
      }
    },
    onError: (error) => {
      console.error("Error updating customer:", error);
      toast.error(`Failed to update customer: ${error.message}`);
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
      const result = await base44.entities.Customer.bulkDelete(ids);
      return { successCount: result.deleted_count, errorCount: 0, errors: [] };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setSelectedCustomers([]);

      if (result.errorCount > 0) {
        toast.error(`Deleted ${result.successCount} customers successfully. ${result.errorCount} customers could not be deleted.`);
      } else {
        toast.success(`Successfully deleted ${result.successCount} customers!`);
      }
    },
    onError: (error) => {
      console.error("Bulk delete failed:", error);
      toast.error('Failed to delete customers. Please try again.');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!guardAction("Creating/updating customers")) return;
    if (editingCustomer) {
      updateMutation.mutate({ id: editingCustomer.id, data: formData, previousCustomer: editingCustomer });
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
      adjuster_phone: "",
      claim_number: ""
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
      },
      previousCustomer: customer,
    });
  };

  const handleDelete = (id) => {
    if (!guardAction("Deleting customers")) return;
    setDeleteCustomerId(id);
    setShowDeleteCustomerDialog(true);
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
      toast.error('Please select at least one customer to delete.');
      return;
    }

    const existingSelectedCustomers = selectedCustomers.filter(id =>
      customers.some(customer => customer.id === id)
    );

    if (existingSelectedCustomers.length === 0) {
      toast.error('No valid customers selected. They may have been already deleted.');
      setSelectedCustomers([]);
      return;
    }

    if (existingSelectedCustomers.length < selectedCustomers.length) {
      const difference = selectedCustomers.length - existingSelectedCustomers.length;
      setBulkDeleteDialogInfo({
        existingSelectedCustomers,
        message: `${difference} of your selected customers no longer exist. Delete the remaining ${existingSelectedCustomers.length} customers? This cannot be undone!`,
        onCancel: () => setSelectedCustomers(existingSelectedCustomers),
      });
      setShowBulkDeleteDialog(true);
    } else {
      setBulkDeleteDialogInfo({
        existingSelectedCustomers,
        message: `Are you sure you want to delete ${existingSelectedCustomers.length} selected customers? This cannot be undone!`,
        onCancel: null,
      });
      setShowBulkDeleteDialog(true);
    }
  };

  const handleExportCSV = () => {
    const customersToExport = selectedCustomers.length > 0
      ? filteredCustomers.filter(customer => selectedCustomers.includes(customer.id))
      : filteredCustomers;

    if (customersToExport.length === 0) {
      toast.error('No customers to export');
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
    a.download = `customers_export_${localToday()}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();

    toast.success(`Exported ${customersToExport.length} customers to CSV!`);
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
      assigned_to_users: customer.assigned_to_users || (customer.assigned_to ? [customer.assigned_to] : []),
      tags: customer.tags || [],
      insurance_company: customer.insurance_company || "",
      adjuster_name: customer.adjuster_name || "",
      adjuster_phone: customer.adjuster_phone || "",
      claim_number: customer.claim_number || ""
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
    inspection: "Inspection",
    actions: t.common.actions,
  };

  let filteredCustomers = customers.filter(customer =>
    customer.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    matchesAddressSearch(customer, searchTerm) ||
    customer.phone?.includes(searchTerm) ||
    customer.phone_2?.includes(searchTerm) ||
    customer.claim_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.insurance_claim_number?.toLowerCase().includes(searchTerm.toLowerCase())
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

  // Storm Mode filter — same presets as Leads, adapted for Customers
  // ("sold" maps to "active" since customers are post-sale).
  const matchesCustomerStorm = (c, key) => {
    if (key === 'all') return true;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const job = getInspectionForCustomer(c);
    switch (key) {
      case 'not_inspected':
        return !job && !isCustomerInspected(c, job);
      case 'scheduled_today': {
        if (!job) return false;
        const scheduledStatuses = new Set(['scheduled', 'assigned', 'in_progress', 'draft']);
        if (job.status && !scheduledStatuses.has(job.status)) return false;
        if (!job.scheduled_date) return false;
        const d = new Date(job.scheduled_date); d.setHours(0, 0, 0, 0);
        return d.getTime() === today.getTime();
      }
      case 'inspected':
        return isCustomerInspected(c, job);
      default:
        return true;
    }
  };

  // Per-chip counts respect the current search/filter context (computed
  // before the storm filter is applied so each chip shows its bucket size).
  const customerStormCounts = ['all', 'not_inspected', 'scheduled_today', 'inspected'].reduce((acc, key) => {
    acc[key] = key === 'all'
      ? filteredCustomers.length
      : filteredCustomers.filter(c => matchesCustomerStorm(c, key)).length;
    return acc;
  }, {});

  if (stormFilter !== 'all') {
    filteredCustomers = filteredCustomers.filter(c => matchesCustomerStorm(c, stormFilter));
  }

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
        <thead className="bg-gray-50 border-b sticky top-0 z-10">
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
                        Newest
                      </span>
                      <Filter className="w-3 h-3 text-gray-400" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => queryClient.invalidateQueries({ queryKey: ['customers'] })}>
                      🆕 Newest First
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
            {visibleColumns.inspection && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Inspection</th>}
            {visibleColumns.actions && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.common.actions}</th>}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {paginatedCustomers.map((customer) => {
            const assignedUsers = customer.assigned_to_users || (customer.assigned_to ? [customer.assigned_to] : []);
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
                    <div className="mt-1">
                      <CustomerInspectionStatus record={customer} job={getInspectionForCustomer(customer)}
                        photoCount={photoCountForJob(getInspectionForCustomer(customer)?.id)} navigate={navigate}
                        onMark={record => openInspectionUpdate([record])}
                        onClear={record => openInspectionUpdate([record], true)} />
                    </div>
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
                {visibleColumns.inspection && (
                  <td className="px-4 py-3 whitespace-nowrap">
                    {(() => {
                      const job = getInspectionForCustomer(customer);
                      return (
                        <CustomerInspectionStatus
                          record={customer}
                          job={job}
                          photoCount={job ? photoCountForJob(job.id) : 0}
                          navigate={navigate}
                        />
                      );
                    })()}
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
              <td colSpan={Object.values(visibleColumns).filter(Boolean).length + 1} className="px-4 py-12 text-center">
                <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="text-gray-500 font-medium">{t.customers.noCustomers}</p>
                <p className="text-gray-400 text-sm mt-1">Add your first customer or try different filters</p>
                <button
                  onClick={() => { setEditingCustomer(null); setShowForm(true); }}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  {t.customers.addCustomer}
                </button>
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
    <div className="flex min-w-0 w-full flex-col h-screen overflow-x-hidden">
        <div className="p-1.5 md:p-6 space-y-1 md:space-y-4 flex-shrink-0">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">{t.customers.title}</h1>
          <button
            onClick={() => navigate(createPageUrl('Customers'))}
            className="hidden text-blue-600 hover:underline text-xs md:text-sm md:flex items-center gap-1 mt-0.5 md:mt-1"
          >
            {t.sidebar.communication || "Contacts"} →
          </button>
        </div>

        <div className="w-full overflow-hidden">
          {isMobile ? (
            <div className="flex items-center gap-1.5 overflow-x-auto py-0 text-[11px] whitespace-nowrap" aria-label="Customer totals">
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700"><strong className="text-gray-900">{totalCustomers}</strong> total</span>
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-green-700"><strong>{activeCustomers}</strong> active</span>
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700"><strong>{inactiveCustomers}</strong> inactive</span>
            </div>
          ) : (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5 md:gap-3 pb-0.5 md:pb-2">
            <Card className="bg-white min-w-0">
              <CardContent className="p-2 md:p-4">
                <div className="text-lg md:text-2xl font-bold text-gray-900">{totalCustomers}</div>
                <div className="truncate text-[9px] leading-tight md:text-sm text-gray-500">{t.customers.totalCustomers}</div>
              </CardContent>
            </Card>
            <Card className="bg-white min-w-0">
              <CardContent className="p-2 md:p-4">
                <div className="text-lg md:text-2xl font-bold text-green-600">{activeCustomers}</div>
                <div className="truncate text-[9px] leading-tight md:text-sm text-gray-500">{t.customers.active} {t.customers.title}</div>
              </CardContent>
            </Card>
            <Card className="bg-white min-w-0">
              <CardContent className="p-2 md:p-4">
                <div className="text-lg md:text-2xl font-bold text-red-600">{inactiveCustomers}</div>
                <div className="truncate text-[9px] leading-tight md:text-sm text-gray-500">{t.customers.inactive} {t.customers.title}</div>
              </CardContent>
            </Card>
            <Card className="bg-white min-w-0">
              <CardContent className="p-2 md:p-4">
                <div className="text-lg md:text-2xl font-bold text-blue-600">{activeCustomers}</div>
                <div className="truncate text-[9px] leading-tight md:text-sm text-gray-500">{t.customers.active} Contacts</div>
              </CardContent>
            </Card>
            <Card className="bg-white min-w-0">
              <CardContent className="p-2 md:p-4">
                <div className="text-lg md:text-2xl font-bold text-orange-600">{inactiveCustomers}</div>
                <div className="truncate text-[9px] leading-tight md:text-sm text-gray-500">{t.customers.inactive} Contacts</div>
              </CardContent>
            </Card>
            <Card className="bg-white min-w-0">
              <CardContent className="p-2 md:p-4">
                <div className="text-lg md:text-2xl font-bold text-gray-900">{contactsLoggedInToday}</div>
                <div className="truncate text-[9px] leading-tight md:text-sm text-gray-500">{t.customers.active} Contacts {t.dashboard.today}</div>
              </CardContent>
            </Card>
          </div>
          )}
        </div>

        <div className={`${isMobile ? 'sticky top-0 z-20 bg-background -mx-1.5 px-1.5 pt-0 pb-0 shadow-sm' : ''}`}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 md:left-3 md:w-5 md:h-5" />
              <Input
                placeholder={t.customers.searchCustomers}
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-8 h-9 text-sm md:pl-10 md:h-12 md:text-base"
                autoComplete="off"
              />
            </div>
            <Select value={pageSize.toString()} onValueChange={(value) => {
              setPageSize(value === 'all' ? 'all' : parseInt(value));
              setCurrentPage(1);
            }}>
              <SelectTrigger className="w-20 h-9 shrink-0 md:w-24 md:h-12" aria-label="Customers per page">
                <SelectValue aria-label="Customers per page" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                {!isMobile && <SelectItem value="all">All</SelectItem>}
              </SelectContent>
            </Select>
          </div>
        </div>

        <CustomerInspectionStatusDialog
          selection={inspectionSelection}
          email={user?.email}
          onDismiss={() => setInspectionSelection(null)}
          onSaved={result => {
            const remaining = result.failed.map(item => item.customer);
            setSelectedCustomers(remaining.map(customer => customer.id));
            setInspectionSelection(previous => remaining.length ? { ...previous, customers: remaining } : null);
          }}
        />
        {/* Storm Mode chips — quick presets for inspection state */}
        <div className="hidden md:flex flex-wrap items-center gap-2" data-testid="storm-mode-chips">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1">Storm Mode:</span>
          {[
            { key: 'all', label: 'All' },
            { key: 'not_inspected', label: 'Not Inspected' },
            { key: 'scheduled_today', label: 'Scheduled Today' },
            { key: 'inspected', label: 'Inspected' },
          ].map(chip => (
            <button
              key={chip.key}
              type="button"
              onClick={() => { setStormFilter(chip.key); setCurrentPage(1); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                stormFilter === chip.key
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
              data-testid={`chip-storm-${chip.key}`}
            >
              {chip.label}
              <span
                className={`ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] px-1 rounded-full text-[10px] font-semibold ${
                  stormFilter === chip.key
                    ? 'bg-white/25 text-white'
                    : 'bg-gray-100 text-gray-600'
                }`}
                data-testid={`chip-storm-count-${chip.key}`}
              >
                {customerStormCounts[chip.key] ?? 0}
              </span>
            </button>
          ))}
        </div>

        {selectedCustomers.length > 0 && (
          <div className="bg-blue-50 border border-blue-300 rounded-lg p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <Checkbox
                checked={true}
                onCheckedChange={() => setSelectedCustomers([])}
              />
              <span className="font-semibold text-blue-900">
                {selectedCustomers.length} {t.customers.title.toLowerCase()}{selectedCustomers.length !== 1 ? 's' : ''} {t.common.selected || "selected"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm"
                onClick={() => openInspectionUpdate(customers.filter(customer => selectedCustomers.includes(customer.id)))}>
                Mark selected as inspected
              </Button>
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
                      <BulkDeleteButton
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
                      </BulkDeleteButton>
            </div>
          </div>
        )}

        <div className="flex gap-2 items-center justify-between">
          <div className="flex gap-2">
            {isMobile ? (
              <Sheet open={showForm} onOpenChange={setShowForm}>
                <SheetTrigger asChild>
                  <Button className="flex-1 bg-blue-600 hover:bg-blue-700 h-9 px-3 text-xs">
                    <Plus className="w-4 h-4 mr-1.5" />
                    {t.customers.addCustomer}
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="h-[92dvh] max-h-[92dvh] p-0 flex flex-col">
                  <SheetHeader className="p-4 border-b bg-white shrink-0">
                    <SheetTitle>{editingCustomer ? t.customers.editCustomer : t.customers.addCustomer}</SheetTitle>
                  </SheetHeader>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 pb-2">
                    <form id="customer-form-mobile" onSubmit={handleSubmit} className="space-y-4">
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
                          {!editingCustomer && (() => {
                            const similar = findSimilarCustomers(allCustomers, formData.name);
                            if (similar.length === 0) return null;
                            return (
                              <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm text-amber-800 mt-2" data-testid="customer-duplicate-warning">
                                <div className="flex items-start gap-2">
                                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                                  <span className="flex-1 font-semibold">A customer with this name already exists:</span>
                                </div>
                                <ul className="mt-1 ml-6 space-y-1">
                                  {similar.map(c => (
                                    <li key={c.id} className="flex items-center justify-between">
                                      <span className="font-medium">{c.name}</span>
                                      <button
                                        type="button"
                                        className="text-blue-600 underline hover:text-blue-800 text-xs ml-2"
                                        onClick={() => { setShowForm(false); navigate(createPageUrl('CustomerProfile') + '?id=' + c.id); }}
                                        data-testid={`customer-dup-view-${c.id}`}
                                      >
                                        View existing →
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                                <p className="text-xs text-amber-600 mt-2">Open the existing record above, or keep typing to save as a new customer.</p>
                              </div>
                            );
                          })()}
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

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                                isLoading={isStaffLoading}
                                error={staffLoadError || (!assignmentCompanyId ? 'Choose a company before assigning staff.' : null)}
                                onRetry={assignmentCompanyId ? refreshAssignmentStaff : undefined}
                                onOpen={() => assignmentCompanyId && refreshAssignmentStaff()}
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
                            <div>
                              <Label htmlFor="claim_number">Insurance Claim #</Label>
                              <Input
                                id="claim_number"
                                value={formData.claim_number}
                                onChange={(e) => handleFormChange("claim_number", e.target.value)}
                                placeholder="e.g., CLM-2024-00123"
                                className="h-12 text-base"
                                autoComplete="off"
                                data-testid="input-claim-number-customer"
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

                    </form>
                  </div>
                  <div className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white border-t flex gap-3">
                    <Button type="button" variant="outline" onClick={handleCancel} className="flex-1 h-12">
                      {t.common.cancel}
                    </Button>
                    <Button
                      type="submit"
                      form="customer-form-mobile"
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
                </SheetContent>
              </Sheet>
            ) : (
              <>
              <Button className="bg-blue-600 hover:bg-blue-700 text-sm h-9" onClick={() => { setEditingCustomer(null); setShowForm(true); }}>
                <Plus className="w-4 h-4 mr-2" />
                {t.customers.addCustomer}
              </Button>
              <Sheet open={showForm} onOpenChange={setShowForm}>
                <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
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
                          {!editingCustomer && (() => {
                            const similar = findSimilarCustomers(allCustomers, formData.name);
                            if (similar.length === 0) return null;
                            return (
                              <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm text-amber-800 mt-2" data-testid="customer-duplicate-warning">
                                <div className="flex items-start gap-2">
                                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                                  <span className="flex-1 font-semibold">A customer with this name already exists:</span>
                                </div>
                                <ul className="mt-1 ml-6 space-y-1">
                                  {similar.map(c => (
                                    <li key={c.id} className="flex items-center justify-between">
                                      <span className="font-medium">{c.name}</span>
                                      <button
                                        type="button"
                                        className="text-blue-600 underline hover:text-blue-800 text-xs ml-2"
                                        onClick={() => { setShowForm(false); navigate(createPageUrl('CustomerProfile') + '?id=' + c.id); }}
                                        data-testid={`customer-dup-view-${c.id}`}
                                      >
                                        View existing →
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                                <p className="text-xs text-amber-600 mt-2">Open the existing record above, or keep typing to save as a new customer.</p>
                              </div>
                            );
                          })()}
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
                                isLoading={isStaffLoading}
                                error={staffLoadError || (!assignmentCompanyId ? 'Choose a company before assigning staff.' : null)}
                                onRetry={assignmentCompanyId ? refreshAssignmentStaff : undefined}
                                onOpen={() => assignmentCompanyId && refreshAssignmentStaff()}
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
                            <div>
                              <Label htmlFor="claim_number">Insurance Claim #</Label>
                              <Input
                                id="claim_number"
                                value={formData.claim_number}
                                onChange={(e) => handleFormChange("claim_number", e.target.value)}
                                placeholder="e.g., CLM-2024-00123"
                                className="h-12 text-base"
                                autoComplete="off"
                                data-testid="input-claim-number-customer"
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
        <div className="flex-1 min-w-0 w-full overflow-auto">
            <div className="min-w-0 w-full px-1.5 pb-2 space-y-0">

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
                  compact
                  className="w-full min-w-0 p-1.5 rounded-lg shadow-sm border border-gray-200"
                >
                  <div
                    onClick={() => navigate(createPageUrl('CustomerProfile') + `?id=${customer.id}`)}
                    className="min-w-0 space-y-0.5"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <div className="min-w-0 flex-1 pr-1">
                        <h3 className="truncate font-semibold text-sm text-gray-900">{customer.name}</h3>
                        {customer.company && (
                          <div className="hidden md:flex items-center gap-1 text-sm text-gray-600 mt-1">
                            <Building2 className="w-4 h-4" />
                            {customer.company}
                          </div>
                        )}
                        {(() => {
                          const assignedUsers = customer.assigned_to_users || (customer.assigned_to ? [customer.assigned_to] : []);
                          const staffAvatars = getStaffAvatars(assignedUsers);

                          if (staffAvatars.length === 0) return null;

                          return (
                            <div className="hidden md:flex -space-x-1.5 mt-2">
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
                      <div className="flex shrink-0 flex-col items-end gap-0.5">
                        <Badge variant="outline" className={`px-1.5 py-0 text-[9px] leading-4 ${customer.is_active ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-700"}`}>
                          {customer.is_active ? t.customers.active : t.customers.inactive}
                        </Badge>
                        {customer.customer_type && (
                          <Badge variant="outline" className="px-1.5 py-0 text-[9px] leading-4 bg-purple-50 text-purple-700 border-purple-200">
                            {customer.customer_type}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="min-w-0 space-y-0.5">
                      {customer.phone && (
                        <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
                          <Phone className="w-3 h-3 text-gray-400 flex-shrink-0" />
                          <a href={`tel:${customer.phone}`} className="truncate text-blue-600 font-medium" onClick={(e) => e.stopPropagation()}>
                            {customer.phone}
                          </a>
                        </div>
                      )}
                      {customer.email && (
                        <div className="hidden md:flex items-center gap-2 text-sm">
                          <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <a href={`mailto:${customer.email}`} className="text-blue-600 truncate" onClick={(e) => e.stopPropagation()}>
                            {customer.email}
                          </a>
                        </div>
                      )}
                      {(customer.street || customer.address) && (
                        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-gray-600">
                          <MapPin className="w-3 h-3 text-gray-400 flex-shrink-0" />
                          <div className="min-w-0 truncate">
                            {customer.address || [customer.street, customer.city, customer.state, customer.zip].filter(Boolean).join(', ')}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="hidden md:flex items-center" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const job = getInspectionForCustomer(customer);
                        return (
                          <CustomerInspectionStatus
                            record={customer}
                            job={job}
                            photoCount={job ? photoCountForJob(job.id) : 0}
                            navigate={navigate}
                            onMark={record => openInspectionUpdate([record])}
                            onClear={record => openInspectionUpdate([record], true)}
                          />
                        );
                      })()}
                    </div>

                    <div className="flex items-center justify-between text-[9px] text-gray-500 pt-0.5 border-t">
                      <span className="font-medium">#{customer.customer_number || '-'}</span>
                      <span className="hidden md:inline">{format(new Date(customer.created_date), 'MMM d, yyyy')}</span>
                    </div>
                  </div>
                </SwipeableCard>
              ))}
            </div>
          {paginatedCustomers.length > 0 && pageSize !== 'all' && totalPages > 1 && (
            <div className="flex min-w-0 w-full items-center gap-2 border-t bg-white px-3 py-2 sticky bottom-0 z-10">
              <div className="min-w-0 flex-1 truncate whitespace-nowrap text-[11px] text-gray-500">
                Showing {((currentPage - 1) * effectivePageSize) + 1} to {Math.min(currentPage * effectivePageSize, filteredCustomers.length)} of {filteredCustomers.length} customers
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="h-8 px-2 text-xs"
                >
                  {t.common.back}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="h-8 px-2 text-xs"
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
                    disabled={selectedCustomers.length === 0}
                    onSelect={() => openInspectionUpdate(customers.filter(customer => selectedCustomers.includes(customer.id)))}>
                    Mark selected as inspected
                  </DropdownMenuItem>
                  <BulkDeleteMenuItem
                    onSelect={handleBulkDelete}
                    className="text-red-600"
                    disabled={selectedCustomers.length === 0}
                  >
                    <Trash2 className="w-3 h-3 mr-2" />
                    {t.common.delete} {t.common.selected || "Selected"} ({selectedCustomers.length})
                  </BulkDeleteMenuItem>
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

      {/* Delete Customer Confirmation Dialog */}
      <Dialog open={showDeleteCustomerDialog} onOpenChange={(open) => {
        setShowDeleteCustomerDialog(open);
        if (!open) setDeleteCustomerId(null);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Delete Customer
            </DialogTitle>
            <DialogDescription>{t.customers.deleteConfirm}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              data-testid="button-cancel-delete-customer"
              onClick={() => {
                setShowDeleteCustomerDialog(false);
                setDeleteCustomerId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              data-testid="button-confirm-delete-customer"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (!deleteCustomerId) return;
                const id = deleteCustomerId;
                setShowDeleteCustomerDialog(false);
                setDeleteCustomerId(null);
                deleteMutation.mutate(id);
              }}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Yes, Delete Customer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Customers Confirmation Dialog */}
      <Dialog open={showBulkDeleteDialog} onOpenChange={(open) => {
        setShowBulkDeleteDialog(open);
        if (!open) setBulkDeleteDialogInfo(null);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Delete Customers
            </DialogTitle>
            <DialogDescription>{bulkDeleteDialogInfo?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              data-testid="button-cancel-bulk-delete-customers"
              onClick={() => {
                setShowBulkDeleteDialog(false);
                if (bulkDeleteDialogInfo?.onCancel) bulkDeleteDialogInfo.onCancel();
                setBulkDeleteDialogInfo(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              data-testid="button-confirm-bulk-delete-customers"
              disabled={bulkDeleteMutation.isPending}
              onClick={() => {
                if (!bulkDeleteDialogInfo) return;
                const { existingSelectedCustomers } = bulkDeleteDialogInfo;
                setShowBulkDeleteDialog(false);
                setBulkDeleteDialogInfo(null);
                bulkDeleteMutation.mutate(existingSelectedCustomers);
              }}
            >
              {bulkDeleteMutation.isPending ? 'Deleting...' : 'Yes, Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}