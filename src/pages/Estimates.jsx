import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { BulkDeleteButton } from "@/components/BulkDeleteControls";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { resolveContactTarget, contactTargetQuery } from "@/utils/contactResolution";
import { buildEstimateSmsMessage, resolveSmsPhone, hasTextablePhone } from "@/utils/documentSms";
import { findOpenEstimatesForCustomer } from "@/utils/duplicateCheck";
import {
  buildSupplementCopyData,
  newChangeOrderFields,
  isChangeOrder,
} from "@/lib/changeOrders";
import ChangeOrderBadge from "@/components/estimates/ChangeOrderBadge";
import ReviseEstimateDialog, { aiEstimatorEditSearch } from "@/components/estimates/ReviseEstimateDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  FileText,
  Eye,
  Send,
  Trash2,
  Filter,
  Search,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Phone,
  Mail,
  MessageSquare,
  Columns3,
  Download,
  Upload,
  Merge,
  Loader2,
  ShoppingCart,
  ChevronRight,
  Copy,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import Dialer from "../components/communication/Dialer";
import EmailDialog from "../components/communication/EmailDialog";
import SMSDialog from "../components/communication/SMSDialog";
import { toast } from "sonner";
import { useRoleBasedData } from "../components/hooks/useRoleBasedData";
import { getAddressSearchText } from "@/utils/addressSearch";
import { useImpersonationGuard } from "../components/hooks/useImpersonationGuard";
import { TablePageSkeleton } from "@/components/PageSkeleton";
import useTranslation from "@/hooks/useTranslation";
import { localToday } from "@/utils/localDate";

export default function EstimatesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showForm, setShowForm] = useState(false);
  const [editingEstimate, setEditingEstimate] = useState(null);
  
  // 🔐 Use centralized role-based data hook
  const { 
    user, 
    myCompany,
    filterEstimates,
    hasPermission,
    isAdmin
  } = useRoleBasedData();

  const { isImpersonating, guardAction } = useImpersonationGuard();
  const { t } = useTranslation();

  const safeFormatDate = (dateValue, formatString = 'MMM d, yyyy') => {
    if (!dateValue) return '-';
    try {
      const date = new Date(dateValue);
      if (isNaN(date.getTime())) return '-';
      return format(date, formatString);
    } catch (e) {
      console.error("Error formatting date:", e, "Value:", dateValue);
      return '-';
    }
  };
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [estimatorFilter, setEstimatorFilter] = useState("all");
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  
  const [formData, setFormData] = useState({
    estimate_number: "",
    customer_name: "",
    customer_email: "",
    customer_phone: "",
    property_address: "",
    insurance_company: "",
    claim_number: "",
    adjuster_name: "",
    adjuster_phone: "",
    amount: 0,
    status: "draft",
    valid_until: "",
    items: [],
    notes: "",
  });

  const [showDialer, setShowDialer] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showSMSDialog, setShowSMSDialog] = useState(false);
  const [dupEstConfirmed, setDupEstConfirmed] = useState(false);
  const [selectedContact, setSelectedContact] = useState({ name: "", phone: "", email: "" });
  const [supplementTarget, setSupplementTarget] = useState(null);

  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState({
    estimate_number: true,
    customer_name: true,
    amount: true,
    status: true,
    estimator: true,
    created_date: true,
    valid_until: true,
    project_name: false,
    reference_number: false,
    insurance_company: false,
    adjuster_name: false,
    adjuster_phone: false,
    claim_number: false,
    actions: true,
  });

  const { data: allCustomers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Customer.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
    refetchOnMount: 'always', // Force refresh to prevent stale data
    staleTime: 0,
  });

  // An estimate's subject can be a Customer OR a Lead, and most older estimates
  // only carry the name. Resolve to a real record before navigating, otherwise
  // the customer page is opened with a name it can't look up and dead-ends on
  // "Customer not found".
  const openEstimateContact = React.useCallback((estimate) => {
    const target = resolveContactTarget(estimate);
    if (!target) return;
    navigate(createPageUrl(target.page) + contactTargetQuery(target));
  }, [navigate]);

  const { data: allEstimates = [], isLoading: isLoadingEstimates } = useQuery({
    queryKey: ['estimates', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Estimate.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
    refetchOnMount: 'always',
    staleTime: 0,
  });

  const { data: integrationSettings = [] } = useQuery({
    queryKey: ['integration-settings'],
    queryFn: () => myCompany ? base44.entities.IntegrationSetting.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  const abcSupplySetting = integrationSettings.find(s => s.integration_name === 'ABC Supply' && s.is_enabled);

  // 🔐 Filter data based on role permissions using the hook
  const customers = useMemo(() => {
    if (!user?.email) return allCustomers;
    if (isAdmin) return allCustomers;
    return allCustomers.filter(c => 
      c.assigned_to === user.email || 
      c.assigned_to_users?.includes(user.email) ||
      c.created_by === user.email
    );
  }, [allCustomers, isAdmin, user?.email]);

  const estimates = useMemo(() => {
    if (typeof filterEstimates !== 'function') return [];
    const findRelatedCustomer = (estimate) => {
      const estimateName = String(estimate?.customer_name || '').trim().toLowerCase();
      const estimateEmail = String(estimate?.customer_email || '').trim().toLowerCase();
      return allCustomers.find(customer =>
        (estimate.customer_id && customer.id === estimate.customer_id) ||
        (estimateEmail && String(customer.email || '').trim().toLowerCase() === estimateEmail) ||
        (estimateName && String(customer.name || '').trim().toLowerCase() === estimateName)
      );
    };
    return (filterEstimates(allEstimates, customers) || []).map(estimate => ({
      ...estimate,
      _address_search: getAddressSearchText(estimate, findRelatedCustomer(estimate)),
    }));
  }, [allEstimates, allCustomers, customers, filterEstimates]);

  // Calculate status stats
  const totalEstimates = estimates.length;
  const draftCount = estimates.filter(e => !e.status || e.status === 'draft').length;
  const sentCount = estimates.filter(e => e.status === 'sent').length;
  const viewedCount = estimates.filter(e => e.status === 'viewed').length;
  const acceptedCount = estimates.filter(e => e.status === 'accepted').length;
  const declinedCount = estimates.filter(e => e.status === 'declined').length;
  const expiredCount = estimates.filter(e => e.status === 'expired').length;

  const draftPct = totalEstimates > 0 ? ((draftCount / totalEstimates) * 100).toFixed(2) : 0;
  const sentPct = totalEstimates > 0 ? ((sentCount / totalEstimates) * 100).toFixed(2) : 0;
  const expiredPct = totalEstimates > 0 ? ((expiredCount / totalEstimates) * 100).toFixed(2) : 0;
  const declinedPct = totalEstimates > 0 ? ((declinedCount / totalEstimates) * 100).toFixed(2) : 0;
  const acceptedPct = totalEstimates > 0 ? ((acceptedCount / totalEstimates) * 100).toFixed(2) : 0;

  // Unique estimate writers derived from loaded estimates
  const uniqueWriters = useMemo(() => {
    const seen = new Set();
    const writers = [];
    for (const est of allEstimates) {
      const name = est.created_by_name || (est.assigned_to ? est.assigned_to.split('@')[0] : null);
      const key = est.assigned_to || est.created_by_email || name;
      if (name && key && !seen.has(key)) {
        seen.add(key);
        writers.push({ name, key });
      }
    }
    return writers.sort((a, b) => a.name.localeCompare(b.name));
  }, [allEstimates]);

  // Helper to generate the next estimate number
  const generateNextEstimateNumber = () => {
    if (estimates.length === 0) {
      return "EST-1";
    }
    
    const numbers = estimates
      .map(est => est.estimate_number)
      .filter(num => num && num.includes('EST'))
      .map(num => {
        // Extract all numeric sequences
        const matches = num.match(/\d+/g);
        if (!matches) return 0;
        
        // Find the last number that's 4 digits or less (the actual sequence number)
        const validNumbers = matches.map(n => parseInt(n)).filter(n => n > 0 && n <= 9999);
        return validNumbers.length > 0 ? Math.max(...validNumbers) : 0;
      })
      .filter(num => num > 0);
    
    if (numbers.length === 0) {
      return "EST-1";
    }
    
    const maxNumber = Math.max(...numbers);
    const nextNumber = maxNumber + 1;
    return `EST-${nextNumber}`;
  };

  // Prefill from URL params
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const prefill = urlParams.get('prefill') === 'true';
    const createNew = urlParams.get('create_new') === 'true';
    const prefillCustomerName = urlParams.get('customer_name');
    const prefillCustomerEmail = urlParams.get('customer_email');
    const prefillCustomerPhone = urlParams.get('customer_phone');
    const prefillAddress = urlParams.get('property_address');
    const prefillInsurance = urlParams.get('insurance_company');
    const prefillClaim = urlParams.get('claim_number');
    const prefillAdjusterName = urlParams.get('adjuster_name');
    const prefillAdjusterPhone = urlParams.get('adjuster_phone');
    const droneInspectionId = urlParams.get('drone_inspection_id');

    if (prefill && createNew) {
      const nextNumber = generateNextEstimateNumber();
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + 30); // 30 days from now

      const initForm = async () => {
        let initialItems = [];
        let initialNotes = "";
        let initialAmount = 0;

        if (droneInspectionId) {
          try {
            const inspections = await base44.entities.DroneInspection.filter({ id: droneInspectionId });
            if (inspections && inspections.length > 0) {
              const inspection = inspections[0];
              initialNotes = `Generated from Drone Inspection ${inspection.inspection_number}\nDate: ${inspection.inspection_date}\nCondition: ${inspection.overall_condition.toUpperCase()}`;
              
              // Generate smart line items based on findings
              if (inspection.overall_condition === 'poor' || inspection.overall_condition === 'critical') {
                initialItems.push({
                  code: "RFG 300",
                  description: "Remove & Replace Laminated Shingles (Full Replacement Recommended)",
                  quantity: 0, // User to fill
                  unit: "SQ",
                  rate: 0,
                  amount: 0
                });
                initialItems.push({
                  code: "RFG FELT15",
                  description: "Roofing felt - 15 lb.",
                  quantity: 0,
                  unit: "SQ",
                  rate: 0,
                  amount: 0
                });
              } else {
                if (inspection.hail_damage_detected) {
                  initialItems.push({
                    code: "RFG R&R",
                    description: `Hail Damage Repair - Spot Repairs (${inspection.overall_condition} condition)`,
                    quantity: 1,
                    unit: "EA",
                    rate: 0,
                    amount: 0
                  });
                }
                if (inspection.wind_damage_detected) {
                  initialItems.push({
                    code: "RFG R&R",
                    description: "Wind Damage Repair - Replace Missing/Creased Shingles",
                    quantity: 1,
                    unit: "EA",
                    rate: 0,
                    amount: 0
                  });
                }
              }

              // Add inspection fee line item if applicable
              initialItems.push({
                code: "INSP",
                description: `Drone Inspection Service - ${inspection.inspection_number}`,
                quantity: 1,
                unit: "EA",
                rate: 150,
                amount: 150
              });
              
              initialAmount = 150; // Base amount
            }
          } catch (err) {
            console.error("Failed to fetch drone inspection data", err);
          }
        }

        setFormData({
          estimate_number: nextNumber,
          customer_name: prefillCustomerName || "",
          customer_email: prefillCustomerEmail || "",
          customer_phone: prefillCustomerPhone || "",
          property_address: prefillAddress || "",
          insurance_company: prefillInsurance || "",
          claim_number: prefillClaim || "",
          adjuster_name: prefillAdjusterName || "",
          adjuster_phone: prefillAdjusterPhone || "",
          amount: initialAmount,
          status: "draft",
          valid_until: validUntil.toISOString().split('T')[0],
          items: initialItems,
          notes: initialNotes,
        });
        setShowForm(true);
      };

      initForm();
    }
  }, [location.search, estimates]);

  const createEstimateMutation = useMutation({
    mutationFn: async (data) => {
      const newEstimate = await base44.entities.Estimate.create({
        ...data,
        company_id: myCompany?.id,
      });
      
      return newEstimate;
    },
    onSuccess: async (newEstimate) => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      setShowForm(false);
      
      setFormData({
        estimate_number: "",
        customer_name: "",
        customer_email: "",
        customer_phone: "",
        amount: 0,
        status: "draft",
        valid_until: "",
        items: [],
        notes: "",
      });
      setEditingEstimate(null);

      if (newEstimate && newEstimate.id) {
        navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + newEstimate.id);
      }
    },
    onError: (error) => {
      toast.error(`Failed to create estimate: ${error.message}`);
    }
  });

  const updateEstimateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const oldEstimate = estimates.find(e => e.id === id);
      const updatedEstimate = await base44.entities.Estimate.update(id, data);
      
      if (data.status === 'accepted' && oldEstimate?.status !== 'accepted') {

        if (myCompany?.id) {
          try {
            const allStaff = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
            const adminEmails = myCompany?.created_by ? [myCompany.created_by] : [];
            
            const customer = customers.find(c => c.name === updatedEstimate.customer_name);
            let assigneeEmails = [];
            if (customer) {
              assigneeEmails = customer.assigned_to_users || (customer.assigned_to ? [customer.assigned_to] : []);
            }
            
            const notifyEmails = [...new Set([...assigneeEmails, ...adminEmails, user?.email])];

            for (const email of notifyEmails) {
              const isAssignee = assigneeEmails.includes(email);
              
              await base44.entities.Notification.create({
                company_id: myCompany.id,
                user_email: email,
                title: '✅ Estimate Accepted!',
                message: `Estimate ${updatedEstimate.estimate_number} accepted by ${updatedEstimate.customer_name}${isAssignee ? ' (your customer)' : ''}`,
                type: 'estimate_accepted',
                related_entity_type: 'Estimate',
                related_entity_id: id,
                link_url: '/estimates',
                is_read: false
              });

              // Notification only (removed email to avoid external user restriction)
            }

            await base44.functions.invoke('triggerWorkflow', {
              triggerType: 'estimate_accepted',
              companyId: myCompany.id,
              entityType: 'Estimate',
              entityId: id,
              entityData: {
                estimate_number: updatedEstimate.estimate_number,
                customer_name: updatedEstimate.customer_name,
                customer_email: updatedEstimate.customer_email || '',
                amount: updatedEstimate.amount,
                accepted_date: new Date().toISOString(),
                app_url: window.location.origin
              }
            });

            // Google Chat / universal notifications for estimate_accepted
            await base44.functions.invoke('universalNotificationDispatcher', {
              action: 'update',
              entityType: 'Estimate',
              entityId: id,
              entityData: updatedEstimate,
              previousData: oldEstimate,
              companyId: myCompany?.id
            });
          } catch (error) {
            console.error('Failed to send estimate accepted notifications:', error);
          }
        }
      }
      
      // Notify assigned rep(s) on any other status change (accepted and sent have their own dedicated flows)
      if (
        data.status &&
        data.status !== 'accepted' &&
        data.status !== 'sent' &&
        oldEstimate?.status !== data.status &&
        myCompany?.id
      ) {
        try {
          const customer = customers.find(c => c.name === updatedEstimate.customer_name);
          let assigneeEmails = [];
          if (customer) {
            assigneeEmails = customer.assigned_to_users || (customer.assigned_to ? [customer.assigned_to] : []);
          }
          if (updatedEstimate.assigned_to && !assigneeEmails.includes(updatedEstimate.assigned_to)) {
            assigneeEmails = [...assigneeEmails, updatedEstimate.assigned_to];
          }

          if (assigneeEmails.length > 0) {
            const statusLabel = data.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            for (const email of assigneeEmails) {
              await base44.entities.Notification.create({
                company_id: myCompany.id,
                user_email: email,
                title: `📋 Estimate Status Updated`,
                message: `Estimate ${updatedEstimate.estimate_number} for ${updatedEstimate.customer_name} moved to "${statusLabel}"`,
                type: 'estimate_status_changed',
                related_entity_type: 'Estimate',
                related_entity_id: id,
                link_url: '/estimates',
                is_read: false,
              });
            }
          }
        } catch (error) {
          console.error('Failed to send estimate status change notification:', error);
        }
      }

      return updatedEstimate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });

  const deleteEstimateMutation = useMutation({
    mutationFn: (id) => base44.entities.Estimate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
    },
  });

  const deleteAllEstimatesMutation = useMutation({
    mutationFn: async () => {
      if (!myCompany?.id) return 0;
      const allEstimates = await base44.entities.Estimate.filter({ company_id: myCompany.id }, "-created_date", 10000);
      if (!allEstimates.length) return 0;
      const result = await base44.entities.Estimate.bulkDelete(allEstimates.map(estimate => estimate.id));
      return result.deleted_count;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      alert(`✅ Successfully deleted ${count} estimates!`);
    },
    onError: error => toast.error(error.message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (estimateIds) => {
      const result = await base44.entities.Estimate.bulkDelete(estimateIds);
      return result.deleted_count;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      setSelectedEstimates([]);
      toast.success(`✅ Deleted ${count} estimates!`);
    },
    onError: error => toast.error(error.message),
  });

  const mergeEstimatesMutation = useMutation({
    mutationFn: async (data) => {
      return await base44.functions.invoke('mergeEstimates', data);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      setShowMergeDialog(false);
      setSelectedEstimates([]);
      toast.success(`✅ Estimates merged into ${result.data.merged_estimate.estimate_number}!`);
      navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + result.data.merged_estimate.id);
    },
    onError: (error) => {
      toast.error('Failed to merge estimates: ' + error.message);
    }
  });

  const placeABCOrderMutation = useMutation({
    mutationFn: async (data) => {
      return await base44.functions.invoke('placeABCSupplyOrder', data);
    },
    onSuccess: (result) => {
      toast.success(`✅ Order placed! Confirmation #: ${result.data.confirmation_number}`);
      setShowABCOrderDialog(false);
      setSelectedEstimateForOrder(null);
      setAbcOrderData({ branchNumber: '', deliveryDate: '', comments: '' });
    },
    onError: (error) => {
      toast.error('Failed to place order: ' + error.message);
    }
  });

  const handleOrderFromABC = (estimate) => {
    if (!abcSupplySetting) {
      toast.error('ABC Supply not connected. Go to Integration Manager to connect.');
      return;
    }
    
    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() + 3);
    
    setSelectedEstimateForOrder(estimate);
    setAbcOrderData({
      branchNumber: '',
      deliveryDate: deliveryDate.toISOString().split('T')[0],
      comments: `Materials for estimate ${estimate.estimate_number}`
    });
    setShowABCOrderDialog(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    createEstimateMutation.mutate({
      estimate_number: formData.estimate_number,
      customer_name: formData.customer_name,
      customer_email: formData.customer_email,
      customer_phone: formData.customer_phone,
      property_address: formData.property_address,
      insurance_company: formData.insurance_company,
      claim_number: formData.claim_number,
      adjuster_name: formData.adjuster_name,
      adjuster_phone: formData.adjuster_phone,
      amount: formData.amount,
      status: formData.status,
      valid_until: formData.valid_until,
      items: formData.items,
      notes: formData.notes,
    });
  };

  const handleCreateNew = () => {
    const urlParams = new URLSearchParams(location.search);
    const prefillCustomerName = urlParams.get('customer_name');
    const prefillCustomerEmail = urlParams.get('customer_email');
    const prefillCustomerPhone = urlParams.get('customer_phone');
    const prefillAddress = urlParams.get('property_address');
    const prefillInsurance = urlParams.get('insurance_company');
    const prefillClaim = urlParams.get('claim_number');
    const prefillAdjusterName = urlParams.get('adjuster_name');
    const prefillAdjusterPhone = urlParams.get('adjuster_phone');
    
    let aiEstimatorUrl = createPageUrl('AIEstimator');
    const params = new URLSearchParams();
    
    if (prefillCustomerName) params.set('customer_name', prefillCustomerName);
    if (prefillCustomerEmail) params.set('customer_email', prefillCustomerEmail);
    if (prefillCustomerPhone) params.set('customer_phone', prefillCustomerPhone);
    if (prefillAddress) params.set('property_address', prefillAddress);
    if (prefillInsurance) params.set('insurance_company', prefillInsurance);
    if (prefillClaim) params.set('claim_number', prefillClaim);
    if (prefillAdjusterName) params.set('adjuster_name', prefillAdjusterName);
    if (prefillAdjusterPhone) params.set('adjuster_phone', prefillAdjusterPhone);
    
    if (params.toString()) {
      aiEstimatorUrl += '?' + params.toString();
    }
    
    navigate(aiEstimatorUrl);
  };

  const handleDelete = (estimateId) => {
    if (!guardAction("Deleting estimates")) return;
    if (window.confirm("Are you sure you want to delete this estimate?")) {
      deleteEstimateMutation.mutate(estimateId);
    }
  };

  const handleCreateSupplement = async (estimate) => {
    setSupplementTarget(estimate);
  };

  const doCreateSupplement = async (estimate, { asChangeOrder = false, reason = '' } = {}) => {
    if (!myCompany?.id) return;
    try {
      const nums = allEstimates
        .map(e => e.estimate_number)
        .filter(n => n?.startsWith('EST-'))
        .map(n => parseInt(n.replace(/EST-|[^0-9]/g, '')))
        .filter(n => !isNaN(n));
      const nextNum = nums.length > 0
        ? `EST-${(Math.max(...nums) + 1).toString().padStart(4, '0')}`
        : 'EST-0001';

      // Shared with EstimateEditor's create path so the two cannot drift: the
      // parent's identity, status, BOTH directions of its chain links and its
      // change-order approval are all dropped before the copy.
      const copyData = buildSupplementCopyData(estimate);

      const newEstimate = await base44.entities.Estimate.create({
        ...copyData,
        company_id: myCompany.id,
        estimate_number: nextNum,
        status: 'draft',
        supplement_of: estimate.id,
        supplement_of_number: estimate.estimate_number || '',
        ...(asChangeOrder ? newChangeOrderFields(reason) : {}),
      });
      await base44.entities.Estimate.update(estimate.id, {
        has_supplement: true,
        has_supplement_id: newEstimate.id,
        has_supplement_number: nextNum,
      });
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      toast.success(
        asChangeOrder
          ? `Change order ${nextNum} created from ${estimate.estimate_number || 'estimate'} — pending approval`
          : `Supplement ${nextNum} created from ${estimate.estimate_number || 'estimate'}`,
      );
      navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + newEstimate.id);
    } catch (err) {
      toast.error(`Failed to create ${asChangeOrder ? 'change order' : 'supplement'}: ` + err.message);
    }
  };

  const handleDeleteAll = () => {
    if (!guardAction("Deleting estimates")) return;
    if (window.confirm(`⚠️ DELETE ALL ${estimates.length} ESTIMATES?\n\nThis cannot be undone!\n\nAre you absolutely sure?`)) {
      if (window.confirm(`🚨 FINAL WARNING: This will permanently delete ALL ${estimates.length} estimates!\n\nClick OK to proceed.`)) {
        deleteAllEstimatesMutation.mutate();
      }
    }
  };

  const handleSendEstimate = async (estimate) => {
    try {
      const result = await base44.functions.invoke('sendEstimateEmail', {
        estimateId: estimate.id,
        companyId: myCompany?.id
      });
      
      if (result && (result.error || result.success === false)) {
        throw new Error(result.error || 'Failed to send estimate email');
      }
      
      alert('Estimate email sent successfully!');
      updateEstimateMutation.mutate({id: estimate.id, data: { status: 'sent' }});
      
      // 🔔 Send notifications when estimate is sent
      if (myCompany?.id) {
        try {
          const allStaff = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
          const adminEmails = myCompany?.created_by ? [myCompany.created_by] : [];
          
          const customer = customers.find(c => c.name === estimate.customer_name);
          let assigneeEmails = [];
          if (customer) {
            assigneeEmails = customer.assigned_to_users || (customer.assigned_to ? [customer.assigned_to] : []);
          }
          
          const notifyEmails = [...new Set([...assigneeEmails, ...adminEmails])];

          for (const email of notifyEmails) {
            const isAssignee = assigneeEmails.includes(email);
            
            await base44.entities.Notification.create({
              company_id: myCompany.id,
              user_email: email,
              title: '📤 Estimate Sent',
              message: `Estimate ${estimate.estimate_number} sent to ${estimate.customer_name}${isAssignee ? ' (your customer)' : ''}`,
              type: 'estimate_sent',
              related_entity_type: 'Estimate',
              related_entity_id: estimate.id,
              link_url: '/estimates',
              is_read: false,
            });

            // Notification only (removed email to avoid external user restriction)
          }

          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'estimate_sent',
            companyId: myCompany.id,
            entityType: 'Estimate',
            entityId: estimate.id,
            entityData: {
              estimate_number: estimate.estimate_number,
              customer_name: estimate.customer_name,
              customer_email: estimate.customer_email || '',
              amount: estimate.amount,
              app_url: window.location.origin,
              sender_name: user?.full_name || user?.name || ''
            }
          });
        } catch (error) {
          console.error('Failed to send estimate notifications:', error);
        }
      }
      
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
    } catch (error) {
      alert('Failed to send estimate email: ' + error.message);
    }
  };

  const findLinkedCustomer = (doc) =>
    allCustomers.find(c => c.id === doc?.customer_id)
    || allCustomers.find(c => (c.name || '').trim().toLowerCase() === (doc?.customer_name || '').trim().toLowerCase());

  // The Text button must be offered whenever the send handler could find a
  // number, not just when the estimate carries its own phone snapshot —
  // otherwise the button is hidden for precisely the lead-only records the
  // fallback exists to reach. A lead_id counts, because the handler resolves
  // the lead's phone asynchronously and reports clearly if there isn't one.
  const canTextEstimate = (estimate) => {
    const linked = findLinkedCustomer(estimate);
    return hasTextablePhone(estimate?.customer_phone, linked?.phone, linked?.phone_2) || !!estimate?.lead_id;
  };

  const handleSendEstimateSMS = async (estimate) => {
    try {
      // Phone: the snapshot saved on the estimate, then the linked customer,
      // then the originating lead. Leads are the whole point of texting — they
      // very often have a phone on file and no email at all.
      let phone = resolveSmsPhone(estimate.customer_phone);
      if (!phone) {
        const linked = findLinkedCustomer(estimate);
        phone = resolveSmsPhone(linked?.phone, linked?.phone_2);
      }
      if (!phone && estimate.lead_id) {
        try {
          const leadRes = await base44.entities.Lead.filter({ id: estimate.lead_id });
          const lead = Array.isArray(leadRes) ? leadRes[0] : leadRes;
          phone = resolveSmsPhone(lead?.phone, lead?.phone_2);
        } catch (e) {
          console.warn('[Estimates] could not load lead for phone lookup:', e?.message);
        }
      }
      if (!phone) {
        toast.error('No phone number on file for this contact. Add one first.');
        return;
      }

      // The share link MUST be the signed one. An unsigned /ViewEstimate?id=...
      // is readable by anyone who has or guesses the id, so if signing fails we
      // stop rather than text a customer's pricing out on an open URL.
      const linkResp = await base44.functions.invoke('getEstimateShareLink', { id: estimate.id });
      const linkErr = linkResp?.error || linkResp?.data?.error;
      const rawUrl = linkResp?.data?.url || linkResp?.url;
      if (linkErr || !rawUrl) {
        throw new Error(linkErr || 'Could not create a secure link for this estimate.');
      }
      const shareUrl = rawUrl.startsWith('http') ? rawUrl : `${window.location.origin}${rawUrl}`;

      const smsMessage = buildEstimateSmsMessage({
        estimate,
        companyName: myCompany?.company_name,
        shareUrl,
      });

      const res = await base44.functions.invoke('sendSMS', {
        to: phone,
        message: smsMessage,
        contactName: estimate.customer_name,
        companyId: myCompany?.id,
        manualSend: true,
      });
      const sendErr = res?.error || res?.data?.error;
      if (sendErr) throw new Error(sendErr);

      toast.success(`✅ Estimate texted to ${phone}`);
      // Don't walk a decided estimate backwards to 'sent' on a re-send.
      const decided = ['accepted', 'approved', 'converted', 'declined', 'rejected'];
      if (!decided.includes(String(estimate.status || '').toLowerCase())) {
        updateEstimateMutation.mutate({ id: estimate.id, data: { status: 'sent' } });
      }
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
    } catch (error) {
      toast.error('Failed to send SMS: ' + error.message);
    }
  };

  const handleCall = (estimate) => {
    setSelectedContact({
      name: estimate.customer_name,
      phone: estimate.customer_phone || "",
      email: estimate.customer_email || ""
    });
    setShowDialer(true);
  };

  const handleEmail = (estimate) => {
    setSelectedContact({
      name: estimate.customer_name,
      phone: estimate.customer_phone || "",
      email: estimate.customer_email || ""
    });
    setShowEmailDialog(true);
  };

  const handleSMS = (estimate) => {
    setSelectedContact({
      name: estimate.customer_name,
      phone: estimate.customer_phone || "",
      email: estimate.customer_email || ""
    });
    setShowSMSDialog(true);
  };

  const filteredEstimates = estimates
    .filter(est => !est.is_archived) // Hide archived/merged estimates
    .filter(est => 
      statusFilter === 'all' || (statusFilter === 'draft' && (!est.status || est.status === 'draft')) || est.status === statusFilter
    )
    .filter(est => {
      if (estimatorFilter === 'all') return true;
      const key = est.assigned_to || est.created_by_email;
      const name = est.created_by_name || (est.assigned_to ? est.assigned_to.split('@')[0] : null);
      return key === estimatorFilter || name === estimatorFilter;
    })
    .filter(est =>
      est.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      est.estimate_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      est.customer_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      est.customer_phone?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      est.insurance_company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      est.adjuster_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      est.claim_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      est._address_search?.includes(searchTerm.toLowerCase().trim())
    )
    .sort((a, b) => {
      const getNumber = (str) => {
        if (!str) return 0;
        const match = str.match(/(\d+)/);
        return match ? parseInt(match[0]) : 0;
      };
      
      const numA = getNumber(a.estimate_number);
      const numB = getNumber(b.estimate_number);
      
      return numB - numA;
    });

  // Group supplement estimates immediately after their originals (same elements, reordered)
  const groupedFilteredEstimates = (() => {
    const originals = filteredEstimates.filter(e => !e.supplement_of);
    const supplements = filteredEstimates.filter(e => !!e.supplement_of);
    const result = [];
    for (const orig of originals) {
      const children = supplements.filter(s => s.supplement_of === orig.id);
      result.push({ ...orig, _isOriginal: true, _supplementCount: children.length });
      for (const child of children) {
        result.push({ ...child, _isSupplement: true });
      }
    }
    // Orphaned supplements whose original is filtered out still appear at end
    const orphans = supplements.filter(s => !originals.find(o => o.id === s.supplement_of));
    for (const orphan of orphans) {
      result.push({ ...orphan, _isSupplement: true });
    }
    return result;
  })();

  // Pipeline total: open estimates only, excluding supplements (no double-counting)
  const OPEN_STATUSES_PIPELINE = new Set(['draft', 'sent', 'viewed', 'pending']);
  const pipelineTotal = filteredEstimates
    .filter(e => !e.supplement_of && OPEN_STATUSES_PIPELINE.has(e.status || 'draft'))
    .reduce((sum, e) => sum + Number(e.total_amount || e.amount || 0), 0);

  const totalPages = itemsPerPage === 99999 ? 1 : Math.ceil(groupedFilteredEstimates.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = itemsPerPage === 99999 ? groupedFilteredEstimates.length : startIndex + itemsPerPage;
  const paginatedEstimates = groupedFilteredEstimates.slice(startIndex, endIndex);

  const handleExport = () => {
    const headers = ['Estimate #', 'Customer', 'Email', 'Phone', 'Amount', 'Status', 'Date', 'Valid Until'];
    const rows = filteredEstimates.map(est => [
      est.estimate_number,
      est.customer_name,
      est.customer_email || '',
      est.customer_phone || '',
      (Number(est.amount) || 0).toFixed(2),
      est.status || 'draft',
      safeFormatDate(est.created_date, 'yyyy-MM-dd'),
      safeFormatDate(est.valid_until, 'yyyy-MM-dd')
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `estimates_${localToday()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const getStatusBadge = (status) => {
    const statusConfig = {
      draft: { color: "bg-gray-100 text-gray-700", icon: Clock },
      sent: { color: "bg-blue-100 text-blue-700", icon: Send },
      viewed: { color: "bg-purple-100 text-purple-700", icon: Eye },
      accepted: { color: "bg-green-100 text-green-700", icon: CheckCircle },
      declined: { color: "bg-red-100 text-red-700", icon: XCircle },
      expired: { color: "bg-orange-100 text-orange-700", icon: AlertCircle }
    };

    const config = statusConfig[status] || statusConfig.draft;
    const Icon = config.icon;

    const statusLabels = {
      draft: t.estimates.draft,
      sent: t.estimates.sent,
      accepted: t.estimates.accepted,
      declined: t.estimates.declined,
      expired: t.estimates.expired,
    };

    return (
      <Badge className={`${config.color} flex items-center justify-center gap-1`}>
        <span className="sr-only">{statusLabels[status] || status || t.estimates.draft}</span>
        <Icon className="w-3 h-3" />
        <span className="capitalize">{statusLabels[status] || status || t.estimates.draft}</span>
      </Badge>
    );
  };

  const [showMethodChoice, setShowMethodChoice] = useState(false);
  const [selectedEstimates, setSelectedEstimates] = useState([]);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [showABCOrderDialog, setShowABCOrderDialog] = useState(false);
  const [selectedEstimateForOrder, setSelectedEstimateForOrder] = useState(null);
  const [abcOrderData, setAbcOrderData] = useState({
    branchNumber: '',
    deliveryDate: '',
    comments: ''
  });
  const [mergeFormData, setMergeFormData] = useState({
    customer_name: "",
    customer_email: "",
    customer_phone: "",
    property_address: "",
    insurance_company: "",
    adjuster_name: "",
    adjuster_phone: "",
    claim_number: "",
    category: "",
    notes: "",
    valid_until: "",
    format_id: ""
  });

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingEstimate(null);
    setFormData({
      estimate_number: "", customer_name: "", customer_email: "", customer_phone: "",
      property_address: "", insurance_company: "", claim_number: "", adjuster_name: "", adjuster_phone: "",
      amount: 0, status: "draft", valid_until: "", items: [], notes: "",
    });
  };

  const FormContent = useMemo(() => {
    const openEsts = (!editingEstimate && formData.customer_name)
      ? findOpenEstimatesForCustomer(allEstimates, null, formData.customer_name)
      : [];
    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="estimate_number">{t.estimates.estimateNumber} *</Label>
            <Input
              id="estimate_number"
              value={formData.estimate_number}
              readOnly
              className="bg-gray-50 cursor-not-allowed"
            />
            <p className="text-xs text-gray-500 mt-1">Auto-generated</p>
          </div>
          <div>
            <Label htmlFor="valid_until">{t.estimates.validUntil} *</Label>
            <Input
              id="valid_until"
              type="date"
              value={formData.valid_until}
              onChange={(e) => setFormData(prev => ({...prev, valid_until: e.target.value}))}
              required
            />
          </div>
        </div>

        <div>
          <Label htmlFor="customer_name">{t.estimates.customer} *</Label>
          <Input
            id="customer_name"
            value={formData.customer_name}
            onChange={(e) => {
              const value = e.target.value;
              setDupEstConfirmed(false);
              setFormData(prev => ({...prev, customer_name: value}));
              
              const matchingCustomer = customers.find(c => c.name?.toLowerCase() === value?.toLowerCase());
              if (matchingCustomer) {
                const fullAddress = [matchingCustomer.street, matchingCustomer.city, matchingCustomer.state, matchingCustomer.zip]
                  .filter(Boolean)
                  .join(', ');
                setFormData(prev => ({
                  ...prev,
                  customer_email: matchingCustomer.email || "",
                  customer_phone: matchingCustomer.phone || "",
                  property_address: fullAddress || "",
                  insurance_company: matchingCustomer.insurance_company || "",
                  claim_number: matchingCustomer.claim_number || "",
                  adjuster_name: matchingCustomer.adjuster_name || "",
                  adjuster_phone: matchingCustomer.adjuster_phone || ""
                }));
              }
            }}
            placeholder="Type or select customer"
            list="customers-list-estimates"
            required
          />
          <datalist id="customers-list-estimates">
            {customers.map((customer, idx) => (
              <option key={idx} value={customer.name}>
                {customer.email ? `${customer.name} (${customer.email})` : customer.name}
              </option>
            ))}
          </datalist>
          {openEsts.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm text-amber-800 mt-2" data-testid="estimate-duplicate-warning">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <span className="flex-1 font-semibold">
                  {formData.customer_name} already has {openEsts.length} open estimate{openEsts.length > 1 ? 's' : ''}:
                </span>
              </div>
              <ul className="mt-1 ml-6 space-y-0.5">
                {openEsts.map(est => (
                  <li key={est.id} className="flex items-center gap-2">
                    <span className="font-medium text-amber-700">{est.estimate_number}</span>
                    <span>— ${(Number(est.total_amount || est.amount) || 0).toFixed(2)} ({est.status})</span>
                  </li>
                ))}
              </ul>
              <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={dupEstConfirmed}
                  onChange={e => setDupEstConfirmed(e.target.checked)}
                  className="h-4 w-4 rounded border-amber-400 text-amber-600"
                />
                <span className="text-xs font-medium text-amber-700">I understand — create a new estimate anyway</span>
              </label>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="customer_email">Customer Email</Label>
            <Input
              id="customer_email"
              type="email"
              value={formData.customer_email}
              onChange={(e) => setFormData(prev => ({...prev, customer_email: e.target.value}))}
              placeholder="customer@example.com"
            />
          </div>

          <div>
            <Label htmlFor="customer_phone">Customer Phone</Label>
            <Input
              id="customer_phone"
              type="tel"
              value={formData.customer_phone}
              onChange={(e) => setFormData(prev => ({...prev, customer_phone: e.target.value}))}
              placeholder="(123) 456-7890"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="property_address">Property Address</Label>
          <Input
            id="property_address"
            value={formData.property_address}
            onChange={(e) => setFormData(prev => ({...prev, property_address: e.target.value}))}
            placeholder="123 Main St, City, ST 12345"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="insurance_company">Insurance Company</Label>
            <Input
              id="insurance_company"
              value={formData.insurance_company}
              onChange={(e) => setFormData(prev => ({...prev, insurance_company: e.target.value}))}
              placeholder="e.g., State Farm"
            />
          </div>

          <div>
            <Label htmlFor="claim_number">Claim Number</Label>
            <Input
              id="claim_number"
              value={formData.claim_number}
              onChange={(e) => setFormData(prev => ({...prev, claim_number: e.target.value}))}
              placeholder="e.g., CLM-123"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="adjuster_name">Adjuster Name</Label>
            <Input
              id="adjuster_name"
              value={formData.adjuster_name}
              onChange={(e) => setFormData(prev => ({...prev, adjuster_name: e.target.value}))}
              placeholder="e.g., John Doe"
            />
          </div>

          <div>
            <Label htmlFor="adjuster_phone">Adjuster Phone</Label>
            <Input
              id="adjuster_phone"
              type="tel"
              value={formData.adjuster_phone}
              onChange={(e) => setFormData(prev => ({...prev, adjuster_phone: e.target.value}))}
              placeholder="e.g., (123) 456-7890"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="notes">{t.estimates.notes}</Label>
          <Textarea
            id="notes"
            value={formData.notes}
            onChange={(e) => setFormData(prev => ({...prev, notes: e.target.value}))}
            placeholder="Internal notes..."
            rows={3}
          />
        </div>

        <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4">
          <Button type="button" variant="outline" onClick={handleCloseForm} className="w-full sm:w-auto">
            {t.common.cancel}
          </Button>
          <Button
            type="submit"
            disabled={!editingEstimate && openEsts.length > 0 && !dupEstConfirmed}
            className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {editingEstimate ? t.common.save : t.estimates.createEstimate}
          </Button>
        </div>
      </form>
    );
  }, [formData, handleSubmit, customers, editingEstimate, allEstimates, dupEstConfirmed, setDupEstConfirmed]);

  if (isLoadingEstimates) {
    return <TablePageSkeleton />;
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Status Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card 
          className={`cursor-pointer transition-all ${statusFilter === 'draft' ? 'ring-2 ring-gray-500' : 'hover:shadow-lg'}`}
          onClick={() => setStatusFilter(statusFilter === 'draft' ? 'all' : 'draft')}
        >
          <CardContent className="p-4">
            <div className="text-sm text-gray-600 mb-1">{t.estimates.draft} ({draftPct}%)</div>
            <div className="text-2xl font-bold text-gray-900">{draftCount} / {totalEstimates}</div>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer transition-all ${statusFilter === 'sent' ? 'ring-2 ring-blue-500' : 'hover:shadow-lg'}`}
          onClick={() => setStatusFilter(statusFilter === 'sent' ? 'all' : 'sent')}
        >
          <CardContent className="p-4">
            <div className="text-sm text-blue-600 mb-1">{t.estimates.sent} ({sentPct}%)</div>
            <div className="text-2xl font-bold text-blue-900">{sentCount} / {totalEstimates}</div>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer transition-all ${statusFilter === 'expired' ? 'ring-2 ring-orange-500' : 'hover:shadow-lg'}`}
          onClick={() => setStatusFilter(statusFilter === 'expired' ? 'all' : 'expired')}
        >
          <CardContent className="p-4">
            <div className="text-sm text-orange-600 mb-1">{t.estimates.expired} ({expiredPct}%)</div>
            <div className="text-2xl font-bold text-orange-900">{expiredCount} / {totalEstimates}</div>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer transition-all ${statusFilter === 'declined' ? 'ring-2 ring-red-500' : 'hover:shadow-lg'}`}
          onClick={() => setStatusFilter(statusFilter === 'declined' ? 'all' : 'declined')}
        >
          <CardContent className="p-4">
            <div className="text-sm text-red-600 mb-1">{t.estimates.declined} ({declinedPct}%)</div>
            <div className="text-2xl font-bold text-red-900">{declinedCount} / {totalEstimates}</div>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer transition-all ${statusFilter === 'accepted' ? 'ring-2 ring-green-500' : 'hover:shadow-lg'}`}
          onClick={() => setStatusFilter(statusFilter === 'accepted' ? 'all' : 'accepted')}
        >
          <CardContent className="p-4">
            <div className="text-sm text-green-600 mb-1">{t.estimates.accepted} ({acceptedPct}%)</div>
            <div className="text-2xl font-bold text-green-900">{acceptedCount} / {totalEstimates}</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">{t.estimates.title}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {filteredEstimates.length} {t.estimates.title.toLowerCase()}
            {pipelineTotal > 0 && (
              <span className="ml-2 text-blue-600 font-medium">
                · Open pipeline: ${pipelineTotal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
            )}
          </p>
        </div>
        
        <div className="flex gap-2 flex-wrap sm:flex-nowrap justify-end">
          {selectedEstimates.length > 0 && (
            <BulkDeleteButton
              onClick={() => {
                if (confirm(`${t.common.delete} ${selectedEstimates.length} selected estimates?\n\nThis cannot be undone!`)) {
                  bulkDeleteMutation.mutate(selectedEstimates);
                }
              }}
              disabled={bulkDeleteMutation.isPending}
              variant="destructive"
              className="w-full sm:w-auto"
            >
              {bulkDeleteMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t.common.loading}
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t.common.delete} {t.common.selected} ({selectedEstimates.length})
                </>
              )}
            </BulkDeleteButton>
          )}

          {selectedEstimates.length === 2 && (
            <Button 
              onClick={() => {
                const est1 = estimates.find(e => e.id === selectedEstimates[0]);
                const est2 = estimates.find(e => e.id === selectedEstimates[1]);
                const validUntil = new Date();
                validUntil.setDate(validUntil.getDate() + 30);
                
                setMergeFormData({
                  customer_name: est1.customer_name,
                  customer_email: est1.customer_email || est2.customer_email || "",
                  customer_phone: est1.customer_phone || est2.customer_phone || "",
                  property_address: est1.property_address || est2.property_address || "",
                  insurance_company: est1.insurance_company || est2.insurance_company || "",
                  adjuster_name: est1.adjuster_name || est2.adjuster_name || "",
                  adjuster_phone: est1.adjuster_phone || est2.adjuster_phone || "",
                  claim_number: est1.claim_number || est2.claim_number || "",
                  category: est1.category || est2.category || "",
                  notes: "",
                  valid_until: validUntil.toISOString().split('T')[0],
                  format_id: est1.format_id || est2.format_id || ""
                });
                setShowMergeDialog(true);
              }}
              className="bg-purple-600 hover:bg-purple-700 w-full sm:w-auto"
            >
              <Merge className="w-4 h-4 mr-2" />
              Merge 2 {t.estimates.title}
            </Button>
          )}

          {estimates.length > 0 && (
            <BulkDeleteButton
              variant="outline"
              onClick={handleDeleteAll}
              disabled={deleteAllEstimatesMutation.isPending}
              className="text-red-600 hover:text-red-700 hover:bg-red-50 w-full sm:w-auto"
            >
              {deleteAllEstimatesMutation.isPending ? (
                <>
                  <Trash2 className="w-4 h-4 mr-2 animate-spin" />
                  {t.common.loading}
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t.common.delete} {t.common.all} ({estimates.length})
                </>
              )}
            </BulkDeleteButton>
          )}

          <Button 
            onClick={() => setShowMethodChoice(true)} 
            className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto"
          >
            <Plus className="w-4 h-4 mr-2" />
            {t.estimates.createEstimate}
          </Button>
          
          {/* Method Choice Dialog */}
          <Dialog open={showMethodChoice} onOpenChange={setShowMethodChoice}>
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle className="text-2xl">{t.estimates.createEstimate}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <p className="text-gray-600 mb-4">Choose how you want to create your estimate:</p>
                
                <Button
                  onClick={handleCreateNew}
                  className="w-full h-auto py-6 flex-col bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <Plus className="w-6 h-6" />
                    <span className="text-xl font-bold">Use AI Estimator</span>
                  </div>
                  <span className="text-sm opacity-90">Upload documents or use satellite measurements</span>
                </Button>

                <Button
                  onClick={() => {
                    setShowMethodChoice(false);
                    const nextNumber = generateNextEstimateNumber();
                    const validUntil = new Date();
                    validUntil.setDate(validUntil.getDate() + 30);
                    setFormData(prev => ({
                      ...prev,
                      estimate_number: nextNumber,
                      valid_until: validUntil.toISOString().split('T')[0],
                    }));
                    setShowForm(true);
                  }}
                  variant="outline"
                  className="w-full h-auto py-6 flex-col border-2 border-gray-300 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <FileText className="w-6 h-6" />
                    <span className="text-xl font-bold">Create Manually</span>
                  </div>
                  <span className="text-sm text-gray-600">Quick form - add line items later</span>
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Manual Form Dialog/Sheet */}
          {isMobile ? (
            <Sheet open={showForm} onOpenChange={handleCloseForm}>
              <SheetContent side="bottom" className="h-[92dvh] max-h-[92dvh] p-0 flex flex-col">
                <SheetHeader className="p-4 border-b bg-white shrink-0">
                  <SheetTitle>{editingEstimate ? t.estimates.editEstimate : t.estimates.createEstimate}</SheetTitle>
                </SheetHeader>
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4">
                  {FormContent}
                </div>
              </SheetContent>
            </Sheet>
          ) : (
            <Dialog open={showForm} onOpenChange={handleCloseForm}>
              <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingEstimate ? t.estimates.editEstimate : t.estimates.createEstimate}</DialogTitle>
                </DialogHeader>
                {FormContent}
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 min-w-0">
        <div className="relative w-full min-w-0 lg:flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder={t.estimates.searchEstimates}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
          <Select value={itemsPerPage.toString()} onValueChange={(val) => {
            setItemsPerPage(val === 'all' ? 99999 : parseInt(val));
            setCurrentPage(1);
          }}>
            <SelectTrigger className="w-24 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
              <SelectItem value="250">250</SelectItem>
              <SelectItem value="500">500</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="min-w-0 flex-1 sm:w-48 sm:flex-none">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.estimates.status}</SelectItem>
              <SelectItem value="draft">{t.estimates.draft}</SelectItem>
              <SelectItem value="sent">{t.estimates.sent}</SelectItem>
              <SelectItem value="viewed">Viewed</SelectItem>
              <SelectItem value="accepted">{t.estimates.accepted}</SelectItem>
              <SelectItem value="declined">{t.estimates.declined}</SelectItem>
              <SelectItem value="expired">{t.estimates.expired}</SelectItem>
            </SelectContent>
          </Select>

          {uniqueWriters.length > 1 && (
            <Select value={estimatorFilter} onValueChange={(val) => { setEstimatorFilter(val); setCurrentPage(1); }}>
              <SelectTrigger className="min-w-[9rem] flex-1 sm:w-44 sm:flex-none">
                <SelectValue placeholder="All estimators" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All estimators</SelectItem>
                {uniqueWriters.map(w => (
                  <SelectItem key={w.key} value={w.key}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <Columns3 className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuCheckboxItem
                checked={visibleColumns.estimate_number}
                onCheckedChange={(checked) => setVisibleColumns(prev => ({...prev, estimate_number: checked}))}
              >
                {t.estimates.estimateNumber}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.customer_name}
                onCheckedChange={(checked) => setVisibleColumns(prev => ({...prev, customer_name: checked}))}
              >
                {t.estimates.customer}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.amount}
                onCheckedChange={(checked) => setVisibleColumns(prev => ({...prev, amount: checked}))}
              >
                {t.estimates.amount}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.status}
                onCheckedChange={(checked) => setVisibleColumns(prev => ({...prev, status: checked}))}
              >
                {t.estimates.status}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.estimator}
                onCheckedChange={(checked) => setVisibleColumns(prev => ({...prev, estimator: checked}))}
              >
                Estimator
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.created_date}
                onCheckedChange={(checked) => setVisibleColumns(prev => ({...prev, created_date: checked}))}
              >
                {t.estimates.date}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.valid_until}
                onCheckedChange={(checked) => setVisibleColumns(prev => ({...prev, valid_until: checked}))}
              >
                {t.estimates.validUntil}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.project_name}
                onCheckedChange={(checked) => setVisibleColumns(prev => ({...prev, project_name: checked}))}
              >
                Project
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.reference_number}
                onCheckedChange={(checked) => setVisibleColumns(prev => ({...prev, reference_number: checked}))}
              >
                Reference #
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.insurance_company}
                onCheckedChange={(checked) => setVisibleColumns(prev => ({...prev, insurance_company: checked}))}
              >
                Insurance
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.adjuster_name}
                onCheckedChange={(checked) => setVisibleColumns(prev => ({...prev, adjuster_name: checked}))}
              >
                Adjuster
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.adjuster_phone}
                onCheckedChange={(checked) => setVisibleColumns(prev => ({...prev, adjuster_phone: checked}))}
              >
                Adj. Phone
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.claim_number}
                onCheckedChange={(checked) => setVisibleColumns(prev => ({...prev, claim_number: checked}))}
              >
                Claim #
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="icon" onClick={handleExport} title="Export to CSV">
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <Card className="bg-white shadow-md">
        <CardContent className="p-0">
          {isMobile ? (
            <div className="pb-20">
              {paginatedEstimates.length === 0 ? (
                <div className="py-12 text-center">
                  <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500 text-lg">{t.estimates.noEstimates}</p>
                  <p className="text-gray-400 text-sm mt-1">Create your first estimate to get started</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {paginatedEstimates.map((estimate) => (
                    <button
                      key={estimate.id}
                      onClick={() => navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + estimate.id)}
                      className={`w-full text-left p-4 transition-colors ${
                        estimate._isSupplement
                          ? 'bg-orange-50/50 border-l-2 border-l-orange-400 pl-5 hover:bg-orange-50 active:bg-orange-100'
                          : 'hover:bg-gray-50 active:bg-gray-100'
                      }`}
                      data-testid={`card-estimate-${estimate.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-blue-600 text-base flex items-center gap-1.5">
                          {estimate._isSupplement && <span className={isChangeOrder(estimate) ? 'text-purple-500 font-bold' : 'text-orange-500 font-bold'}>↳</span>}
                          {estimate.estimate_number}
                          {estimate._isSupplement && <ChangeOrderBadge estimate={estimate} />}
                        </span>
                        {getStatusBadge(estimate.status)}
                      </div>
                      {(estimate._isSupplement || (!estimate._isSupplement && estimate.supplement_of) || estimate._supplementCount > 0 || (estimate.has_supplement && !estimate.supplement_of && !estimate._supplementCount)) && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {(estimate._isSupplement || (!estimate._isSupplement && estimate.supplement_of)) && estimate.supplement_of && (
                            <span
                              role="button"
                              tabIndex={0}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium cursor-pointer ${isChangeOrder(estimate) ? 'bg-purple-100 text-purple-700 active:bg-purple-200' : 'bg-orange-100 text-orange-700 active:bg-orange-200'}`}
                              title={`${isChangeOrder(estimate) ? 'Change order to' : 'Supplement of'} ${estimate.supplement_of_number || 'original'} — tap to open original`}
                              onClick={(e) => { e.stopPropagation(); navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + estimate.supplement_of); }}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + estimate.supplement_of); } }}
                              data-testid={`badge-supp-of-${estimate.id}`}
                            >
                              ↳ {isChangeOrder(estimate) ? 'CO to' : 'Supp of'} {estimate.supplement_of_number || '—'}
                            </span>
                          )}
                          {estimate._supplementCount > 0 && estimate.has_supplement_id && (
                            <span
                              role="button"
                              tabIndex={0}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 active:bg-blue-200 cursor-pointer"
                              title={`${estimate._supplementCount} supplement${estimate._supplementCount !== 1 ? 's' : ''} — tap to open`}
                              onClick={(e) => { e.stopPropagation(); navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + estimate.has_supplement_id); }}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + estimate.has_supplement_id); } }}
                              data-testid={`badge-supp-count-${estimate.id}`}
                            >
                              {estimate._supplementCount} supp{estimate._supplementCount !== 1 ? 's' : ''}
                            </span>
                          )}
                          {(estimate.has_supplement && !estimate.supplement_of && !estimate._supplementCount) && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                              +SUPP
                            </span>
                          )}
                        </div>
                      )}
                      <div className="mt-1.5">
                        <p className="font-medium text-gray-900 text-sm">{estimate.customer_name}</p>
                        {estimate.created_date && (
                          <p className="text-xs text-gray-400 mt-0.5">{estimate.created_date}</p>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-lg font-bold text-green-600">${(Number(estimate.amount) || 0).toFixed(2)}</span>
                        <div className="flex items-center gap-2">
                          {(() => {
                            const name = estimate.created_by_name || (estimate.assigned_to ? estimate.assigned_to.split('@')[0] : null);
                            if (!name) return null;
                            const initials = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
                            const colors = ['bg-blue-100 text-blue-700', 'bg-purple-100 text-purple-700', 'bg-green-100 text-green-700', 'bg-orange-100 text-orange-700', 'bg-pink-100 text-pink-700'];
                            const color = colors[name.charCodeAt(0) % colors.length];
                            return (
                              <div className="flex items-center gap-1.5">
                                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold ${color}`}>{initials}</span>
                                <span className="text-xs text-gray-500">{name.split(' ')[0]}</span>
                              </div>
                            );
                          })()}
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b bg-gray-50 sticky top-0 z-10">
                <tr className="text-left text-xs text-gray-600 uppercase tracking-wider">
                  <th className="p-4 font-medium w-12">
                    <input
                      type="checkbox"
                      className="w-4 h-4"
                      checked={selectedEstimates.length === paginatedEstimates.length && paginatedEstimates.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedEstimates(paginatedEstimates.map(est => est.id));
                        } else {
                          setSelectedEstimates([]);
                        }
                      }}
                    />
                  </th>
                  {visibleColumns.estimate_number && <th className="p-4 font-medium">{t.estimates.estimateNumber}</th>}
                  {visibleColumns.customer_name && <th className="p-4 font-medium">{t.estimates.customer}</th>}
                  {visibleColumns.amount && <th className="p-4 font-medium">{t.estimates.amount}</th>}
                  {visibleColumns.status && <th className="p-4 font-medium">{t.estimates.status}</th>}
                  {visibleColumns.estimator && <th className="p-4 font-medium">Estimator</th>}
                  {visibleColumns.created_date && <th className="p-4 font-medium">{t.estimates.date}</th>}
                  {visibleColumns.valid_until && <th className="p-4 font-medium">{t.estimates.validUntil}</th>}
                  {visibleColumns.project_name && <th className="p-4 font-medium">Project</th>}
                  {visibleColumns.reference_number && <th className="p-4 font-medium">Reference #</th>}
                  {visibleColumns.insurance_company && <th className="p-4 font-medium">Insurance</th>}
                  {visibleColumns.adjuster_name && <th className="p-4 font-medium">Adjuster</th>}
                  {visibleColumns.adjuster_phone && <th className="p-4 font-medium">Adj. Phone</th>}
                  {visibleColumns.claim_number && <th className="p-4 font-medium">Claim #</th>}
                  {visibleColumns.actions && <th className="p-4 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {paginatedEstimates.map((estimate) => (
                  <tr
                    key={estimate.id}
                    className={`border-b transition-colors ${
                      estimate._isSupplement
                        ? 'bg-orange-50/50 border-l-2 border-l-orange-400 hover:bg-orange-50'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="p-4 w-12">
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={selectedEstimates.includes(estimate.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedEstimates([...selectedEstimates, estimate.id]);
                          } else {
                            setSelectedEstimates(selectedEstimates.filter(id => id !== estimate.id));
                          }
                        }}
                      />
                    </td>
                    {visibleColumns.estimate_number && (
                      <td className="px-4 py-3">
                        <div className={estimate._isSupplement ? 'flex items-center gap-1.5 pl-4' : 'flex items-center gap-1.5'}>
                          {estimate._isSupplement && (
                            <span className={`font-bold text-sm select-none ${isChangeOrder(estimate) ? 'text-purple-500' : 'text-orange-500'}`}>↳</span>
                          )}
                          <button
                            onClick={() => navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + estimate.id)}
                            className="font-medium text-blue-600 hover:underline"
                          >
                            {estimate.estimate_number}
                          </button>
                          {(estimate._isSupplement || estimate.supplement_of) && (
                            <>
                              <ChangeOrderBadge estimate={estimate} />
                              <button
                                type="button"
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${isChangeOrder(estimate) ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}
                                title={`${isChangeOrder(estimate) ? 'Change order to' : 'Supplement of'} ${estimate.supplement_of_number || 'original'} — click to open original`}
                                onClick={(e) => { e.stopPropagation(); navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + estimate.supplement_of); }}
                              >
                                {estimate._isSupplement ? '↳ ' : ''}{isChangeOrder(estimate) ? 'CO to' : 'Supp of'} {estimate.supplement_of_number || '—'}
                              </button>
                            </>
                          )}
                        </div>
                        {estimate._supplementCount > 0 && (
                          <button
                            type="button"
                            className="mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200"
                            title={`${estimate._supplementCount} supplement${estimate._supplementCount !== 1 ? 's' : ''} — click to open`}
                            onClick={(e) => { e.stopPropagation(); navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + estimate.has_supplement_id); }}
                          >
                            {estimate._supplementCount} supp{estimate._supplementCount !== 1 ? 's' : ''}
                          </button>
                        )}
                        {(estimate.has_supplement && !estimate.supplement_of && !estimate._supplementCount) && (
                          <span className="mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                            +SUPP
                          </span>
                        )}
                      </td>
                    )}
                    {visibleColumns.customer_name && (
                      <td className="px-4 py-3">
                        <div>
                          <button
                            onClick={() => openEstimateContact(estimate)}
                            className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
                          >
                            {estimate.customer_name}
                          </button>
                          {estimate.customer_email && (
                            <div className="text-xs text-gray-500">{estimate.customer_email}</div>
                          )}
                          {estimate.customer_phone && (
                            <div className="text-xs text-gray-500">{estimate.customer_phone}</div>
                          )}
                        </div>
                      </td>
                    )}
                    {visibleColumns.amount && (
                      <td className="p-4">
                        <div className="font-semibold text-green-600">
                          ${(Number(estimate.amount) || 0).toFixed(2)}
                        </div>
                      </td>
                    )}
                    {visibleColumns.status && (
                      <td className="p-4">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <div className="cursor-pointer">
                              {getStatusBadge(estimate.status)}
                            </div>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => updateEstimateMutation.mutate({ id: estimate.id, data: { status: 'draft' }})}>
                              <Clock className="w-4 h-4 mr-2" />
                              {t.estimates.draft}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => updateEstimateMutation.mutate({ id: estimate.id, data: { status: 'sent' }})}>
                              <Send className="w-4 h-4 mr-2" />
                              {t.estimates.sent}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => updateEstimateMutation.mutate({ id: estimate.id, data: { status: 'viewed' }})}>
                              <Eye className="w-4 h-4 mr-2" />
                              Viewed
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => updateEstimateMutation.mutate({ id: estimate.id, data: { status: 'accepted' }})}>
                              <CheckCircle className="w-4 h-4 mr-2" />
                              {t.estimates.accepted}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => updateEstimateMutation.mutate({ id: estimate.id, data: { status: 'declined' }})}>
                              <XCircle className="w-4 h-4 mr-2" />
                              {t.estimates.declined}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => updateEstimateMutation.mutate({ id: estimate.id, data: { status: 'expired' }})}>
                              <AlertCircle className="w-4 h-4 mr-2" />
                              {t.estimates.expired}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    )}
                    {visibleColumns.estimator && (
                      <td className="p-4">
                        {(() => {
                          const name = estimate.created_by_name || (estimate.assigned_to ? estimate.assigned_to.split('@')[0] : null);
                          if (!name) return <span className="text-gray-400 text-sm">—</span>;
                          const initials = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
                          const colors = ['bg-blue-100 text-blue-700', 'bg-purple-100 text-purple-700', 'bg-green-100 text-green-700', 'bg-orange-100 text-orange-700', 'bg-pink-100 text-pink-700'];
                          const color = colors[name.charCodeAt(0) % colors.length];
                          return (
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold shrink-0 ${color}`}>{initials}</span>
                              <span className="text-sm text-gray-700 truncate max-w-[100px]">{name.split(' ')[0]}</span>
                            </div>
                          );
                        })()}
                      </td>
                    )}
                    {visibleColumns.created_date && (
                      <td className="p-4 text-sm text-gray-600">
                        {safeFormatDate(estimate.created_date)}
                      </td>
                    )}
                    {visibleColumns.valid_until && (
                      <td className="p-4 text-sm text-gray-600">
                        {safeFormatDate(estimate.valid_until)}
                      </td>
                    )}
                    {visibleColumns.project_name && (
                      <td className="p-4 text-sm text-gray-600">
                        {estimate.project_name || '-'}
                      </td>
                    )}
                    {visibleColumns.reference_number && (
                      <td className="p-4 text-sm text-gray-600">
                        {estimate.reference_number || '-'}
                      </td>
                    )}
                    {visibleColumns.insurance_company && (
                      <td className="p-4 text-sm text-gray-600">
                        {estimate.insurance_company || '-'}
                      </td>
                    )}
                    {visibleColumns.adjuster_name && (
                      <td className="p-4 text-sm text-gray-600">
                        {estimate.adjuster_name || '-'}
                      </td>
                    )}
                    {visibleColumns.adjuster_phone && (
                      <td className="p-4 text-sm text-gray-600">
                        {estimate.adjuster_phone || '-'}
                      </td>
                    )}
                    {visibleColumns.claim_number && (
                      <td className="p-4 text-sm text-gray-600">
                        {estimate.claim_number || '-'}
                      </td>
                    )}
                    {visibleColumns.actions && (
                      <td className="p-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleCall(estimate)}
                            className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                            title="Call customer"
                            disabled={!estimate.customer_phone}
                          >
                            <Phone className="w-4 h-4" />
                          </Button>
                          
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleEmail(estimate)}
                            className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            title="Email customer"
                            disabled={!estimate.customer_email}
                          >
                            <Mail className="w-4 h-4" />
                          </Button>
                          
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleSMS(estimate)}
                            className="h-8 w-8 text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                            title="Send SMS"
                            disabled={!estimate.customer_phone}
                          >
                            <MessageSquare className="w-4 h-4" />
                          </Button>

                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleCreateSupplement(estimate)}
                            className="h-8 w-8 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                            title="Change this estimate"
                            data-testid={`button-change-estimate-${estimate.id}`}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>

                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + estimate.id)}
                            className="h-8 w-8 text-gray-600 hover:text-gray-700 hover:bg-gray-100"
                            title="Edit estimate"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>

                          {estimate.status === 'draft' && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleSendEstimate(estimate)}
                              className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                              title="Send estimate via email"
                            >
                              <Send className="w-4 h-4" />
                            </Button>
                          )}

                          {/* Texting stays available after the first send: a resend
                              or a nudge to a lead who never opened the email is the
                              common case, and gating it to drafts hid it exactly then. */}
                          {canTextEstimate(estimate) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleSendEstimateSMS(estimate)}
                              className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                              title="Send estimate via SMS"
                            >
                              <MessageSquare className="w-4 h-4" />
                            </Button>
                          )}

                          {abcSupplySetting && estimate.status === 'accepted' && (
                           <Button
                             size="icon"
                             variant="ghost"
                             onClick={() => handleOrderFromABC(estimate)}
                             className="h-8 w-8 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                             title="Order materials from ABC Supply"
                           >
                             <ShoppingCart className="w-4 h-4" />
                           </Button>
                          )}

                          <Button
                           size="icon"
                           variant="ghost"
                           onClick={() => handleDelete(estimate.id)}
                           className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                           title="Delete estimate"
                          >
                           <Trash2 className="w-4 h-4" />
                          </Button>
                          </div>
                          </td>
                          )}
                          </tr>
                          ))}
                          {filteredEstimates.length === 0 && (
                          <tr>
                          <td colSpan={13} className="py-12 text-center">
                          <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                          <p className="text-gray-500 text-lg">{t.estimates.noEstimates}</p>
                          <p className="text-gray-400 text-sm mt-1">Create your first estimate to get started</p>
                          </td>
                          </tr>
                          )}
                          </tbody>
                          </table>
                          </div>
          )}

          {filteredEstimates.length > 0 && itemsPerPage !== 99999 && !isMobile && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
              <div className="text-sm text-gray-600">
                Showing {startIndex + 1} to {Math.min(endIndex, filteredEstimates.length)} of {filteredEstimates.length} entries
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <span className="text-sm text-gray-600">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialer
        open={showDialer}
        onOpenChange={setShowDialer}
        defaultNumber={selectedContact.phone}
        defaultName={selectedContact.name}
      />
      <EmailDialog
        open={showEmailDialog}
        onOpenChange={setShowEmailDialog}
        defaultTo={selectedContact.email}
        defaultName={selectedContact.name}
        companyId={myCompany?.id}
      />
      <SMSDialog
        open={showSMSDialog}
        onOpenChange={setShowSMSDialog}
        defaultTo={selectedContact.phone}
        defaultName={selectedContact.name}
      />

      <Dialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Merge className="w-5 h-5 text-purple-600" />
              Merge Estimates
            </DialogTitle>
          </DialogHeader>
          
          {selectedEstimates.length === 2 && (
            <div className="space-y-6">
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <p className="font-semibold text-purple-900 mb-2">📋 Estimates Being Merged:</p>
                {selectedEstimates.map(estId => {
                  const est = estimates.find(e => e.id === estId);
                  return (
                    <div key={estId} className="text-sm text-purple-800 ml-4">
                      • {est?.estimate_number} - {est?.customer_name} - ${(Number(est?.amount) || 0).toFixed(2)}
                      {est?.insurance_company && ` (${est.insurance_company})`}
                    </div>
                  );
                })}
                <p className="text-sm text-purple-700 mt-3">
                  💡 All line items will be combined. Original estimates will be marked as merged.
                </p>
              </div>

              <div className="space-y-4">
                <h3 className="font-semibold">Choose Details for Merged Estimate:</h3>
                
                <div>
                  <Label>{t.estimates.customer} *</Label>
                  <Input
                    value={mergeFormData.customer_name}
                    onChange={(e) => setMergeFormData({...mergeFormData, customer_name: e.target.value})}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Email</Label>
                    <Input
                      value={mergeFormData.customer_email}
                      onChange={(e) => setMergeFormData({...mergeFormData, customer_email: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <Input
                      value={mergeFormData.customer_phone}
                      onChange={(e) => setMergeFormData({...mergeFormData, customer_phone: e.target.value})}
                    />
                  </div>
                </div>

                <div>
                  <Label>Property Address</Label>
                  <Input
                    value={mergeFormData.property_address}
                    onChange={(e) => setMergeFormData({...mergeFormData, property_address: e.target.value})}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Insurance Company</Label>
                    <Input
                      value={mergeFormData.insurance_company}
                      onChange={(e) => setMergeFormData({...mergeFormData, insurance_company: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label>Claim Number</Label>
                    <Input
                      value={mergeFormData.claim_number}
                      onChange={(e) => setMergeFormData({...mergeFormData, claim_number: e.target.value})}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Adjuster Name</Label>
                    <Input
                      value={mergeFormData.adjuster_name}
                      onChange={(e) => setMergeFormData({...mergeFormData, adjuster_name: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label>Adjuster Phone</Label>
                    <Input
                      value={mergeFormData.adjuster_phone}
                      onChange={(e) => setMergeFormData({...mergeFormData, adjuster_phone: e.target.value})}
                    />
                  </div>
                </div>

                <div>
                  <Label>{t.estimates.validUntil} *</Label>
                  <Input
                    type="date"
                    value={mergeFormData.valid_until}
                    onChange={(e) => setMergeFormData({...mergeFormData, valid_until: e.target.value})}
                    required
                  />
                </div>

                <div>
                  <Label>{t.estimates.notes}</Label>
                  <Textarea
                    value={mergeFormData.notes}
                    onChange={(e) => setMergeFormData({...mergeFormData, notes: e.target.value})}
                    placeholder="Add any notes about this merged estimate..."
                    rows={3}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowMergeDialog(false);
                    setSelectedEstimates([]);
                  }}
                >
                  {t.common.cancel}
                </Button>
                <Button
                  onClick={() => {
                    mergeEstimatesMutation.mutate({
                      estimate1Id: selectedEstimates[0],
                      estimate2Id: selectedEstimates[1],
                      mergedEstimateData: mergeFormData
                    });
                  }}
                  disabled={mergeEstimatesMutation.isPending}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  {mergeEstimatesMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Merging...
                    </>
                  ) : (
                    <>
                      <Merge className="w-4 h-4 mr-2" />
                      Merge Estimates
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ABC Supply Order Dialog */}
      <Dialog open={showABCOrderDialog} onOpenChange={setShowABCOrderDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-orange-600" />
              Order from ABC Supply
            </DialogTitle>
          </DialogHeader>
          
          {selectedEstimateForOrder && (
            <div className="space-y-4">
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <p className="font-semibold text-orange-900">Estimate: {selectedEstimateForOrder.estimate_number}</p>
                <p className="text-sm text-orange-800">Customer: {selectedEstimateForOrder.customer_name}</p>
                <p className="text-sm text-orange-800">Amount: ${(Number(selectedEstimateForOrder.amount) || 0).toFixed(2)}</p>
                <p className="text-xs text-orange-700 mt-2">
                  {selectedEstimateForOrder.items?.length || 0} line items will be sent to ABC Supply
                </p>
              </div>

              <div>
                <Label>ABC Branch Number *</Label>
                <Input
                  placeholder="e.g., 1234"
                  value={abcOrderData.branchNumber}
                  onChange={(e) => setAbcOrderData({...abcOrderData, branchNumber: e.target.value})}
                  required
                />
                <p className="text-xs text-gray-500 mt-1">Contact your ABC rep for your branch number</p>
              </div>

              <div>
                <Label>Delivery Date *</Label>
                <Input
                  type="date"
                  value={abcOrderData.deliveryDate}
                  onChange={(e) => setAbcOrderData({...abcOrderData, deliveryDate: e.target.value})}
                  required
                />
              </div>

              <div>
                <Label>Special Instructions</Label>
                <Textarea
                  placeholder="Any special delivery or handling instructions..."
                  value={abcOrderData.comments}
                  onChange={(e) => setAbcOrderData({...abcOrderData, comments: e.target.value})}
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowABCOrderDialog(false);
                    setSelectedEstimateForOrder(null);
                  }}
                >
                  {t.common.cancel}
                </Button>
                <Button
                  onClick={() => {
                    if (!abcOrderData.branchNumber) {
                      toast.error('Please enter your ABC branch number');
                      return;
                    }
                    placeABCOrderMutation.mutate({
                      estimateId: selectedEstimateForOrder.id,
                      branchNumber: abcOrderData.branchNumber,
                      deliveryDate: abcOrderData.deliveryDate,
                      comments: abcOrderData.comments
                    });
                  }}
                  disabled={placeABCOrderMutation.isPending}
                  className="bg-orange-600 hover:bg-orange-700"
                >
                  {placeABCOrderMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Placing Order...
                    </>
                  ) : (
                    <>
                      <ShoppingCart className="w-4 h-4 mr-2" />
                      Place Order
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ReviseEstimateDialog
        open={!!supplementTarget}
        onOpenChange={(open) => {
          if (!open) setSupplementTarget(null);
        }}
        estimate={supplementTarget}
        onEditHere={() => {
          const id = supplementTarget?.id;
          setSupplementTarget(null);
          if (id) navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + id);
        }}
        onOpenAiEstimator={() => {
          const target = supplementTarget;
          setSupplementTarget(null);
          if (!target) return;
          navigate(createPageUrl('AIEstimator') + '?' + aiEstimatorEditSearch(target));
        }}
        onCreateCopy={({ asChangeOrder, reason }) => {
          const target = supplementTarget;
          setSupplementTarget(null);
          if (target) doCreateSupplement(target, { asChangeOrder, reason });
        }}
      />
    </div>
  );
}