import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { BulkDeleteButton } from "@/components/BulkDeleteControls";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { useNavigate, useLocation } from "react-router-dom";
import {
  pickBaseEstimate,
  buildInvoiceFromEstimates,
  centsToDollars,
  formatCents,
  formatCentsSigned,
} from "@/lib/changeOrders";
import { createPageUrl } from "@/utils";
import { getInvoiceDisplayStatus, getInvoiceBalance, getInvoiceTrueTotal } from "@/utils/invoiceFinance";
import { buildInvoiceSmsMessage, resolveSmsPhone, hasTextablePhone } from "@/utils/documentSms";
import { requireMessageSubmission } from "@/utils/paymentRequestDelivery";
import {
  changeInvoiceCustomerName,
  getCompanyCustomerById,
  invoiceNeedsCustomerLink,
  selectInvoiceCustomer,
} from "@/utils/invoiceCustomerAssociation";
import CustomerIdentityPickerDialog from "@/components/invoices/CustomerIdentityPickerDialog";
import { Toaster, toast } from 'react-hot-toast';
import {
  Send,
  CheckCircle,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Columns,
  Trash2,
  MoreVertical,
  Link as LinkIcon,
  Copy,
  Bell,
  Mail,
  MessageSquare,
  AlertTriangle,
  Activity,
  Download,
  FileText,
  Info,
  Scale,
  ExternalLink,
  Loader2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { TablePageSkeleton } from "@/components/PageSkeleton";
import useTranslation from "@/hooks/useTranslation";
import { findUnpaidInvoicesForCustomer, findInvoicesByClaimNumber } from "@/utils/duplicateCheck";
import { getQBInvoiceUrl } from "@/utils/quickbooksUtils";
import { localToday } from "@/utils/localDate";
import { makeInvoiceMatcher } from "@/utils/paymentOwnership";
import { getAddressSearchText } from "@/utils/addressSearch";
import { nextInvoiceNumberFrom } from "@/utils/invoiceNumbering";

export default function InvoicesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  // Use the centralized hook for role-based data and impersonation
  const { 
    user, 
    myCompany, 
    myStaffProfile, 
    isAdmin, 
    hasPermission,
    filterInvoices,
    filterCustomers 
  } = useRoleBasedData();

  const safeFormatDate = (dateValue, formatString = 'yyyy-MM-dd') => {
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

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showCreateCustomerPicker, setShowCreateCustomerPicker] = useState(false);
  const [showLinkCustomerPicker, setShowLinkCustomerPicker] = useState(false);
  const [showLinkCustomerConfirm, setShowLinkCustomerConfirm] = useState(false);
  const [linkInvoiceTarget, setLinkInvoiceTarget] = useState(null);
  const [linkCustomerCandidate, setLinkCustomerCandidate] = useState(null);
  const [qbBannerDismissed, setQbBannerDismissed] = useState(() => sessionStorage.getItem('qb-reconnect-banner-dismissed') === '1');
  
  const [newInvoiceForm, setNewInvoiceForm] = useState({
    invoice_number: "",
    customer_id: "",
    customer_name: "",
    customer_email: "",
    amount: "",
    status: "draft",
    due_date: "",
    issue_date: localToday(),
    items: [],
    notes: "",
    sale_agent: "",
    commission_splits: []
  });

  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [agingFilter, setAgingFilter] = useState(null);
  const [selectedInvoices, setSelectedInvoices] = useState([]);
  const [showBatchPaymentsDialog, setShowBatchPaymentsDialog] = useState(false);
  const [reminderDialog, setReminderDialog] = useState(false);
  const [reminderInvoice, setReminderInvoice] = useState(null);
  const [reminderEmail, setReminderEmail] = useState('');
  const [reminderPhone, setReminderPhone] = useState('');
  const [reminderChannel, setReminderChannel] = useState('email');
  const [reminderNote, setReminderNote] = useState('');
  const [dupInvConfirmed, setDupInvConfirmed] = useState(false);
  const [dupClaimConfirmed, setDupClaimConfirmed] = useState(false);
  const [dismissInvoiceDuplicateWarning, setDismissInvoiceDuplicateWarning] = useState(false);
  const [showDeleteInvoiceDialog, setShowDeleteInvoiceDialog] = useState(false);
  const [deleteInvoiceTarget, setDeleteInvoiceTarget] = useState(null);
  const [showSendInvoiceDialog, setShowSendInvoiceDialog] = useState(false);
  const [sendInvoiceTarget, setSendInvoiceTarget] = useState(null);
  const [showBatchDeleteDialog, setShowBatchDeleteDialog] = useState(false);
  const [showInvoiceSentDialog, setShowInvoiceSentDialog] = useState(false);
  const [invoiceSentEmail, setInvoiceSentEmail] = useState('');
  const [showFixStatusesDialog, setShowFixStatusesDialog] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState({
    invoice_number: true,
    amount: true,
    balance: true,
    total_tax: true,
    date: true,
    customer: true,
    project: false,
    tags: false,
    due_date: true,
    status: true,
    claim_number: false,
    insurance_company: false,
    policy_number: false,
    deductible_amount: false,
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
  });

  const { data: customers = [], isLoading: isLoadingCustomers } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Customer.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
  });

  const { data: estimates = [] } = useQuery({
    queryKey: ['estimates', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Estimate.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
  });

  const { data: allInvoices = [], isLoading: isLoadingInvoices } = useQuery({
    queryKey: ['invoices', myCompany?.id],
    queryFn: async () => {
      if (!myCompany?.id) return [];
      try {
        const results = await base44.entities.Invoice.filter({ company_id: myCompany.id }, "-created_date");
        return Array.isArray(results) ? results : [];
      } catch (e) {
        console.error("Failed to fetch invoices", e);
        return [];
      }
    },
    enabled: !!myCompany?.id,
  });

  const { data: allPayments = [] } = useQuery({
    queryKey: ['payments', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Payment.filter({ company_id: myCompany.id }, '-payment_date', 10000) : [],
    enabled: !!myCompany?.id,
  });

  const { data: qbStatus } = useQuery({
    queryKey: ['qb-sync-status', myCompany?.id],
    queryFn: async () => {
      if (!myCompany?.id) return null;
      const res = await base44.functions.invoke('getQuickBooksSyncStatus');
      return res?.data ?? null;
    },
    enabled: !!myCompany?.id,
    staleTime: 5 * 60 * 1000,
  });

  const buildQBInvoiceUrl = (qbInvoiceId) =>
    getQBInvoiceUrl(qbStatus?.realm_id, qbInvoiceId, qbStatus?.sandbox ?? false);

  // 🔐 Filter data based on permissions
  const filteredCustomers = useMemo(() => {
    if (typeof filterCustomers !== 'function') return [];
    return filterCustomers(customers) || [];
  }, [customers, filterCustomers]);

  const invoices = useMemo(() => {
    if (typeof filterInvoices !== 'function') return [];
    return filterInvoices(allInvoices, filteredCustomers) || [];
  }, [allInvoices, filteredCustomers, filterInvoices]);

  // Preview only. The server allocates the stored number per company.
  const generateNextInvoiceNumber = () => nextInvoiceNumberFrom(allInvoices);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  /**
   * What to bill a customer: their newest ordinary estimate plus every change
   * order the office has APPROVED.
   *
   * A change order is a full copy of the estimate it revises, so only its delta
   * is added — billing its own total on top of the original would charge the
   * whole job twice. Pending and rejected change orders contribute nothing.
   */
  const resolveCustomerBilling = React.useCallback((customerId) => {
    const matchingCustomer = getCompanyCustomerById(customers, customerId, myCompany?.id);
    if (!matchingCustomer) return null;

    const customerEstimates = estimates.filter(est =>
      String(est.customer_id || '') === String(matchingCustomer.id)
    );
    const baseEstimate = pickBaseEstimate(customerEstimates);
    if (!baseEstimate) return { matchingCustomer, baseEstimate: null, billing: null };

    return {
      matchingCustomer,
      baseEstimate,
      billing: buildInvoiceFromEstimates(baseEstimate, customerEstimates),
    };
  }, [customers, estimates, myCompany?.id]);

  const prefillHandledRef = React.useRef(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const prefill = params.get('prefill');
    const createNew = params.get('create_new');
    const customerName = params.get('customer_name');
    const customerEmail = params.get('customer_email');
    const customerId = params.get('customer_id');
    const searchParam = params.get('search');

    if (searchParam) {
      setSearchQuery(searchParam);
    }

    const prefillKey = `${location.key || ''}:${location.search}`;
    if (
      prefill === 'true' &&
      createNew === 'true' &&
      !showCreateDialog &&
      !!myCompany?.id &&
      !isLoadingCustomers &&
      prefillHandledRef.current !== prefillKey
    ) {
      prefillHandledRef.current = prefillKey;
      const nextNumber = generateNextInvoiceNumber();
      const selectedCustomer = getCompanyCustomerById(customers, customerId, myCompany?.id);
      let autoAmount = "";
      let autoItems = [];
      if (selectedCustomer) {
        const resolved = resolveCustomerBilling(selectedCustomer.id);
        if (resolved?.billing) {
          autoAmount = centsToDollars(resolved.billing.totalCents).toFixed(2);
          autoItems = resolved.billing.items;
        } else if (resolved?.matchingCustomer && Number(resolved.matchingCustomer.total_revenue) > 0) {
          autoAmount = String(Number(resolved.matchingCustomer.total_revenue).toFixed(2));
        }
      }

      setNewInvoiceForm({
        invoice_number: nextNumber,
        customer_id: selectedCustomer?.id || "",
        customer_name: selectedCustomer?.name || customerName || "",
        customer_email: selectedCustomer?.email || customerEmail || "",
        amount: autoAmount,
        status: "draft",
        due_date: "",
        issue_date: localToday(),
        items: autoItems,
        notes: "",
        sale_agent: "",
        commission_splits: []
      });
      setDupInvConfirmed(false);
      setDupClaimConfirmed(false);
      setShowCreateDialog(true);
    }
  }, [
    location.key,
    location.search,
    showCreateDialog,
    isLoadingCustomers,
    customers,
    myCompany?.id,
    resolveCustomerBilling,
    invoices,
  ]);

  useEffect(() => {
    setDupInvConfirmed(false);
    setDupClaimConfirmed(false);
  }, [newInvoiceForm.customer_id, newInvoiceForm.customer_name, newInvoiceForm.claim_number]);

  const createInvoiceMutation = useMutation({
    mutationFn: async (invoiceData) => {
      let commissionSplits = [];
      const customer = getCompanyCustomerById(customers, invoiceData.customer_id, myCompany?.id);
      
      if (customer) {
        const assignedUsers = customer.assigned_to_users || (customer.assigned_to ? [customer.assigned_to] : []);
        
        if (assignedUsers.length > 0) {
          for (const userEmail of assignedUsers) {
            const staffProfile = staffProfiles.find(sp => sp.user_email === userEmail);
            if (staffProfile) {
              commissionSplits.push({
                user_email: userEmail,
                user_name: staffProfile.full_name || userEmail,
                split_percentage: 100 / assignedUsers.length,
                role: 'Sales Rep'
              });
            }
          }
        }
      }
      
      const newInvoice = await base44.entities.Invoice.create({
        ...invoiceData,
        amount: parseFloat(invoiceData.amount),
        total_amount: parseFloat(invoiceData.amount),
        company_id: myCompany?.id,
        commission_splits: commissionSplits.length > 0 ? commissionSplits : undefined,
        sale_agent: commissionSplits.length > 0 ? commissionSplits[0].user_email : undefined,
        sale_agent_name: commissionSplits.length > 0 ? commissionSplits[0].user_name : undefined
      });

      if (myCompany?.id && user) {
        try {
          const allStaff = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
          const adminEmails = myCompany?.created_by ? [myCompany.created_by] : [];
          
          let assigneeEmails = [];
          if (newInvoice.commission_splits?.length > 0) {
            assigneeEmails = newInvoice.commission_splits.map(s => s.user_email);
          } else if (newInvoice.sale_agent) {
            assigneeEmails = [newInvoice.sale_agent];
          }
          
          const notifyEmails = [...new Set([...assigneeEmails, ...adminEmails])];

          for (const email of notifyEmails) {
            const isAssignee = assigneeEmails.includes(email);
            await base44.entities.Notification.create({
              company_id: myCompany.id,
              user_email: email,
              title: '🧾 New Invoice Created',
              message: `Invoice ${newInvoice.invoice_number} - $${newInvoice.total_amount}${isAssignee ? ' (assigned to you)' : ''}`,
              type: 'invoice_created',
              related_entity_type: 'Invoice',
              related_entity_id: newInvoice.id,
              link_url: '/invoices',
              is_read: false,
            });

            await base44.integrations.Core.SendEmail({
              to: email,
              from_name: myCompany.company_name || 'CRM',
              subject: `New Invoice Created: ${newInvoice.invoice_number}`,
              html: `<h2>Invoice Created</h2>
                ${isAssignee ? '<p style="color: green;"><strong>This invoice is assigned to you!</strong></p>' : ''}
                <p><strong>Customer:</strong> ${newInvoice.customer_name}</p>
                <p><strong>Amount:</strong> $${newInvoice.total_amount}</p>
                <p><strong>Status:</strong> ${newInvoice.status}</p>
                <p><strong>Due Date:</strong> ${newInvoice.due_date || 'Not set'}</p>
                <p><a href="${window.location.origin}/invoices">View All Invoices</a></p>`
            });
          }
        } catch (error) {
          console.error('Failed to send invoice notifications:', error);
        }
      }
      
      if (myCompany?.id && user?.email) {
        try {
          await base44.entities.Notification.create({
            company_id: myCompany.id,
            user_email: user.email,
            title: '🧾 New Invoice Created',
            message: `Invoice ${newInvoice.invoice_number} for ${newInvoice.customer_name} - $${newInvoice.total_amount}${commissionSplits.length > 0 ? ` (Assigned to: ${commissionSplits.map(cs => cs.user_name).join(', ')})` : ''}`,
            type: 'invoice_created',
            related_entity_type: 'Invoice',
            related_entity_id: newInvoice.id,
            link_url: '/invoices',
            is_read: false
          });
        } catch (error) {
          console.error('Failed to create notification:', error);
        }
      }
      
      // Workflow automations for the new invoice fire automatically via the entity API
      // (autoTriggerWorkflowsFromMutation runs server-side on create); the explicit
      // re-trigger here was removed because it caused duplicate invoice emails/SMS.
      
      return newInvoice;
    },
    onSuccess: async (newInvoice) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.email] });
      setShowCreateDialog(false);
      
      // Duplicate create-trigger removed — the entity API already fires invoice
      // workflows automatically on create (see mutationFn note above).
      
      setNewInvoiceForm({
        invoice_number: "",
        customer_id: "",
        customer_name: "",
        customer_email: "",
        amount: "",
        due_date: "",
        issue_date: localToday(),
        status: "draft",
        items: [],
        notes: "",
        sale_agent: "",
        commission_splits: []
      });
      toast.success('Invoice created with notifications sent!');
    },
    onError: (error) => {
      toast.error(`Failed to create invoice: ${error.message}`);
    }
  });

  const linkUnassignedInvoiceMutation = useMutation({
    mutationFn: async ({ invoiceId, customerId }) => {
      const response = await fetch('/api/local/invoices/link-customer', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_id: invoiceId,
          customer_id: customerId,
          company_id: myCompany?.id,
          confirmed: true,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not link this invoice to the customer.');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', myCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ['customer-invoices'] });
      setShowLinkCustomerConfirm(false);
      setLinkInvoiceTarget(null);
      setLinkCustomerCandidate(null);
      toast.success('Invoice linked to the selected customer.');
    },
    onError: (error) => toast.error(error.message || 'Could not link this invoice.'),
  });

  const openLinkCustomerPicker = (invoice) => {
    if (!isAdmin || !invoiceNeedsCustomerLink(invoice, filteredCustomers)) return;
    setLinkInvoiceTarget(invoice);
    setLinkCustomerCandidate(null);
    setShowLinkCustomerPicker(true);
  };

  const handleLinkCustomerSelection = (customer) => {
    setLinkCustomerCandidate(customer);
    setShowLinkCustomerPicker(false);
    setShowLinkCustomerConfirm(true);
  };

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const oldInvoice = invoices.find(i => i.id === id);
      const updatedInvoice = await base44.entities.Invoice.update(id, data);

      if (data.status === 'paid' && oldInvoice?.status !== 'paid') {
        // Check for referral fee owed
        const invoiceCustomer = getCompanyCustomerById(customers, updatedInvoice.customer_id, myCompany?.id);
        if (invoiceCustomer?.referral_source) {
          setTimeout(() => {
            toast.success(`💰 Referral Fee Owed — ${updatedInvoice.customer_name} was referred by ${invoiceCustomer.referral_source}. Don't forget to pay the referral fee!`, { duration: 8000 });
          }, 800);
        }

        try {
          const salesRepEmails = updatedInvoice.commission_splits?.map(cs => cs.user_email) ||
                                 (updatedInvoice.sale_agent ? [updatedInvoice.sale_agent] : []) ||
                                 (updatedInvoice.created_by ? [updatedInvoice.created_by] : []);

          if (salesRepEmails.length > 0 && updatedInvoice.total_amount) {
            for (const salesRepEmail of salesRepEmails) {
              await base44.functions.invoke('updateCommissions', {
                paymentId: `invoice_payment_${id}_${salesRepEmail}`,
                invoiceId: id,
                amount: updatedInvoice.total_amount / salesRepEmails.length,
                salesRepEmail: salesRepEmail
              });
              console.log('✅ Commission updated for rep:', salesRepEmail);
            }
          }
        } catch (commError) {
          console.error('⚠️ Commission update failed (non-critical):', commError);
        }
      }

      if (data.status === 'overdue' && myCompany?.id) {
        try {
          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'invoice_overdue',
            companyId: myCompany.id,
            entityType: 'Invoice',
            entityId: id,
            entityData: {
              invoice_number: updatedInvoice.invoice_number || '',
              customer_name: updatedInvoice.customer_name || '',
              amount: updatedInvoice.total_amount || 0,
              app_url: window.location.origin || ''
            }
          });
        } catch (error) {
          console.error('Workflow trigger failed (non-critical):', error);
        }
      }

      if (data.status === 'paid' && myCompany?.id) {
        try {
          await base44.functions.invoke('createReviewRequestForInvoice', { invoiceId: id });
        } catch (e) {
          console.warn('CreateReviewRequestForInvoice failed (non-critical):', e);
        }
      }

      if (data.status === 'paid' && myCompany?.id) {
        try {
          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'invoice_paid',
            companyId: myCompany.id,
            entityType: 'Invoice',
            entityId: id,
            entityData: {
              invoice_number: updatedInvoice.invoice_number || '',
              customer_name: updatedInvoice.customer_name || '',
              customer_email: updatedInvoice.customer_email || '',
              amount: updatedInvoice.total_amount || 0,
              payment_date: new Date().toISOString(),
              app_url: window.location.origin || ''
            }
          });
        } catch (error) {
          console.error('Workflow trigger failed (non-critical):', error);
        }
      }

      if (data.status === 'paid' && oldInvoice?.status !== 'paid' && myCompany?.id) {
        try {
          await base44.functions.invoke('universalNotificationDispatcher', {
            action: 'update',
            entityType: 'Invoice',
            entityId: id,
            entityData: updatedInvoice,
            previousData: oldInvoice,
            companyId: myCompany?.id
          });
        } catch (e) {
          console.warn('[universalNotificationDispatcher] invoice_paid notify failed:', e?.message);
        }
      }

      return updatedInvoice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['staff-profiles'] });
    },
  });

  const batchPaymentMutation = useMutation({
    mutationFn: async () => {
      const updates = [];
      const commissionUpdates = [];

      for (const id of selectedInvoices) {
        const invoice = invoices.find(i => i.id === id);
        if (invoice) {
          updates.push(base44.entities.Invoice.update(id, { status: 'paid' }));
          
          const salesRepEmails = invoice.commission_splits?.map(cs => cs.user_email) ||
                                 (invoice.sale_agent ? [invoice.sale_agent] : []) ||
                                 (invoice.created_by ? [invoice.created_by] : []);
          if (salesRepEmails.length > 0 && invoice.total_amount) {
            for (const salesRepEmail of salesRepEmails) {
              commissionUpdates.push({
                invoiceId: id,
                amount: invoice.total_amount / salesRepEmails.length,
                salesRepEmail: salesRepEmail
              });
            }
          }
        }
      }

      await Promise.all(updates);

      for (const comm of commissionUpdates) {
        try {
          await base44.functions.invoke('updateCommissions', {
            paymentId: `batch_payment_${comm.invoiceId}_${comm.salesRepEmail}`,
            invoiceId: comm.invoiceId,
            amount: comm.amount,
            salesRepEmail: comm.salesRepEmail
          });
        } catch (error) {
          console.error('Commission update failed for invoice:', comm.invoiceId, error);
        }
      }

      return updates;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['staff-profiles'] });
      setShowBatchPaymentsDialog(false);
      setSelectedInvoices([]);
      toast.success(`✅ ${selectedInvoices.length} invoices marked as paid and commissions updated!`);
    },
    onError: (error) => {
      toast.error(`❌ Batch payment failed: ${error.message}`);
    }
  });

  const deleteInvoiceMutation = useMutation({
    mutationFn: async (invoiceId) => {
      await base44.entities.Invoice.delete(invoiceId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('✅ Invoice deleted successfully!');
    },
    onError: (error) => {
      toast.error(`❌ Failed to delete invoice: ${error.message}`);
    }
  });

  const syncInvoiceToQBMutation = useMutation({
    mutationFn: async (invoiceId) => {
      const res = await base44.functions.invoke('syncQuickBooksInvoice', { invoice_id: invoiceId });
      if (res.error) throw new Error(res.error);
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Invoice pushed to QuickBooks!');
    },
    onError: (err) => toast.error('QB sync failed: ' + err.message),
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.Invoice.bulkDelete(selectedInvoices);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setSelectedInvoices([]);
      toast.success(`✅ ${selectedInvoices.length} invoice(s) deleted successfully!`);
    },
    onError: (error) => {
      toast.error(`❌ Batch delete failed: ${error.message}`);
    }
  });

  const handleDeleteInvoice = (invoice) => {
    if (!isAdmin) {
      toast.error('⛔ Access Denied\n\nOnly administrators can delete invoices.\n\nPlease contact your admin if you need to delete this invoice.');
      return;
    }

    setDeleteInvoiceTarget(invoice);
    setShowDeleteInvoiceDialog(true);
  };

  const sendPaymentLinkMutation = useMutation({
    mutationFn: async (invoice) => {
      const result = await base44.functions.invoke('createPaymentLinkForInvoice', {
        invoiceId: invoice.id
      });
      return result.data;
    },
    onSuccess: (data, invoice) => {
      if (data?.payment_url) {
        navigator.clipboard.writeText(data.payment_url);
        toast.success(`✅ Payment link copied to clipboard!\n\nSend this link to ${invoice.customer_name} so they can pay instantly.`);
      } else {
        toast.error('Failed to generate payment link');
      }
    },
    onError: (error) => {
      toast.error(`Failed to create payment link: ${error.message}`);
    }
  });

  const sendReminderMutation = useMutation({
    mutationFn: async ({ invoice, email, phone, channel, note }) => {
      const result = await base44.functions.invoke('sendPaymentReminder', {
        invoiceId: invoice.id,
        companyId: myCompany?.id,
        email: email || undefined,
        phone: phone || undefined,
        channel,
        customMessage: note || undefined,
      });
      const data = result?.data ?? result;
      if (!data?.success) throw new Error(data?.error || 'Reminder failed');
      return data;
    },
    onSuccess: (data) => {
      const via = (data.channels || []).map(c => c === 'email' ? 'email' : 'SMS').join(' & ');
      toast.success(`✅ Payment reminder sent via ${via || 'message'}!`);
      setReminderDialog(false);
      setReminderInvoice(null);
      setReminderEmail('');
      setReminderPhone('');
      setReminderNote('');
      setReminderChannel('email');
    },
    onError: (err) => {
      toast.error(`❌ Reminder failed: ${err.message}`);
    }
  });

  const openReminderDialog = (invoice) => {
    setReminderInvoice(invoice);
    setReminderEmail(invoice.customer_email || '');
    setReminderPhone('');
    setReminderNote('');
    setReminderChannel(invoice.customer_email ? 'email' : 'sms');
    setReminderDialog(true);
  };

  const sendInvoiceMutation = useMutation({
    mutationFn: async (invoice) => {
      if (!myCompany?.id) throw new Error('Choose a company before sending an invoice');
      const response = await base44.functions.invoke('sendInvoiceEmail', {
        invoiceId: invoice.id,
        companyId: myCompany.id
      });
      const submission = requireMessageSubmission(response, 'email');
      let updatedInvoice = invoice;
      let statusUpdateFailed = false;
      // A paid invoice's status is financial; updating even its sent_date via the
      // generic entity route would replay an invoice_paid workflow.
      if (invoice.status !== 'paid') {
        try {
          updatedInvoice = await base44.entities.Invoice.update(invoice.id, {
            ...(invoice.status === 'draft' ? { status: 'sent' } : {}),
            sent_date: new Date().toISOString()
          });
        } catch (error) {
          statusUpdateFailed = true;
          console.warn('[sendInvoiceEmail] Provider accepted, invoice timestamp update failed:', error);
        }
      }

      if (!statusUpdateFailed) {
        try {
          const allStaff = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
          const adminEmails = myCompany?.created_by ? [myCompany.created_by] : [];
          
          let assigneeEmails = [];
          if (updatedInvoice.commission_splits?.length > 0) {
            assigneeEmails = updatedInvoice.commission_splits.map(s => s.user_email);
          } else if (updatedInvoice.sale_agent) {
            assigneeEmails = [updatedInvoice.sale_agent];
          }
          
          const notifyEmails = [...new Set([...assigneeEmails, ...adminEmails])];

          for (const email of notifyEmails) {
            const isAssignee = assigneeEmails.includes(email);
            await base44.entities.Notification.create({
              company_id: myCompany.id,
              user_email: email,
              title: '📤 Invoice Email Submitted',
              message: `Invoice ${updatedInvoice.invoice_number} submitted to the email provider for ${updatedInvoice.customer_name}; delivery is unconfirmed${isAssignee ? ' (your commission)' : ''}`,
              type: 'invoice_created',
              related_entity_type: 'Invoice',
              related_entity_id: updatedInvoice.id,
              link_url: '/invoices',
              is_read: false,
            });
          }
        } catch (error) {
          console.error('Failed to send notifications:', error);
        }
      }

      // Sending an invoice updates its status to 'sent', which the entity API already
      // maps to the 'invoice_sent' workflow trigger server-side. The explicit
      // 'invoice_created' trigger here was removed — it re-fired the CREATE event on
      // send, double-sending any "New Invoice" workflow to the customer.

      return { ...updatedInvoice, statusUpdateFailed, deliveryTrackingDegraded: submission.deliveryTrackingDegraded };
    },
    onSuccess: (data, invoice) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setInvoiceSentEmail(invoice.customer_email);
      setShowInvoiceSentDialog(true);
      if (data.statusUpdateFailed || data.deliveryTrackingDegraded) {
        toast.error('The email was accepted, but tracking is incomplete. Check delivery history before trying again.');
      }
    },
    onError: (error) => {
      toast.error(`❌ Failed to send invoice: ${error.message}`);
    }
  });

  const findLinkedCustomer = (doc) =>
    getCompanyCustomerById(customers, doc?.customer_id, myCompany?.id);

  // Offer the Text button whenever the send handler could actually find a
  // number, not only when the invoice carries its own phone snapshot.
  const canTextInvoice = (invoice) => {
    const linked = findLinkedCustomer(invoice);
    return hasTextablePhone(invoice?.customer_phone, linked?.phone, linked?.phone_2);
  };

  // Text an invoice straight from the list, for contacts with a phone but no email.
  const sendInvoiceSmsMutation = useMutation({
    mutationFn: async (invoice) => {
      // The phone snapshot on the invoice is often blank on older records, so
      // fall back to the linked customer (by id, then by name).
      const linked = findLinkedCustomer(invoice);
      const phone = resolveSmsPhone(invoice?.customer_phone, linked?.phone, linked?.phone_2);
      if (!phone) throw new Error('No phone number on this invoice. Add one on the customer first.');

      let payUrl = '';
      try {
        const result = await base44.functions.invoke('createPaymentLinkForInvoice', {
          invoice_id: invoice.id,
        });
        payUrl = result?.data?.payment_url || '';
      } catch (e) {
        console.warn('[Invoices] Stripe link failed; texting without pay link:', e?.message);
      }

      const message = buildInvoiceSmsMessage({
        invoice,
        companyName: myCompany?.company_name,
        companyPhone: myCompany?.phone,
        payUrl,
      });

      const res = await base44.functions.invoke('sendSMS', {
        to: phone,
        message,
        contactName: invoice.customer_name,
        companyId: myCompany?.id,
        manualSend: true,
      });
      requireMessageSubmission(res, 'sms');

      // Both 'partial' and 'partially_paid' exist in real data for the same
      // state; missing either one would reset a part-paid invoice to 'sent'.
      const status = String(invoice?.status || '').toLowerCase();
      if (!['paid', 'cancelled', 'void', 'refunded'].includes(status)) {
        await base44.entities.Invoice.update(invoice.id, {
          ...(status === 'draft' ? { status: 'sent' } : {}),
          sent_date: new Date().toISOString(),
        });
      }
      return phone;
    },
    onSuccess: (phone) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success(`✅ Invoice texted to ${phone}`);
    },
    onError: (error) => {
      toast.error(`❌ Failed to text invoice: ${error.message}`);
    },
  });

  const handleSendInvoice = (invoice) => {
    if (!invoice.customer_email) {
      toast.error('❌ Cannot send invoice: Customer email is missing.\n\nPlease add an email address first.');
      return;
    }

    setSendInvoiceTarget(invoice);
    setShowSendInvoiceDialog(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!newInvoiceForm.customer_name || !newInvoiceForm.amount || parseFloat(newInvoiceForm.amount) <= 0) {
      toast.error('Please fill in customer name and a valid amount.');
      return;
    }
    createInvoiceMutation.mutate(newInvoiceForm);
  };

  const handleClose = () => {
    setShowCreateDialog(false);
    setNewInvoiceForm({
      invoice_number: "",
      customer_id: "",
      customer_name: "",
      customer_email: "",
      amount: "",
      status: "draft",
      due_date: "",
      issue_date: localToday(),
      items: [],
      notes: "",
      sale_agent: "",
      commission_splits: []
    });
  };

  const handleCreateNew = () => {
    const nextNumber = generateNextInvoiceNumber();
    setNewInvoiceForm({
      invoice_number: nextNumber,
      customer_id: "",
      customer_name: "",
      customer_email: "",
      amount: "",
      status: "draft",
      due_date: "",
      issue_date: localToday(),
      items: [],
      notes: "",
      sale_agent: "",
      commission_splits: []
    });
    setDupInvConfirmed(false);
    setDupClaimConfirmed(false);
    setShowCreateDialog(true);
  };

  const handleCreateCustomerSelect = (customer) => {
    const resolved = resolveCustomerBilling(customer.id);
    const amount = resolved?.billing
      ? centsToDollars(resolved.billing.totalCents).toFixed(2)
      : Number(customer.total_revenue) > 0
        ? Number(customer.total_revenue).toFixed(2)
        : '';
    setNewInvoiceForm((previous) => ({
      ...previous,
      ...selectInvoiceCustomer(customer),
      amount,
      items: resolved?.billing?.items || [],
    }));
    setDismissInvoiceDuplicateWarning(false);
    setDupInvConfirmed(false);
    setShowCreateCustomerPicker(false);
  };

  const toggleColumn = (columnKey) => {
    setVisibleColumns(prev => ({
      ...prev,
      [columnKey]: !prev[columnKey]
    }));
  };

  const toggleInvoiceSelection = (invoiceId) => {
    setSelectedInvoices(prev =>
      prev.includes(invoiceId)
        ? prev.filter(id => id !== invoiceId)
        : [...prev, invoiceId]
    );
  };

  const currentYear = new Date().getFullYear();
  const yearsFromInvoices = [...new Set((invoices || [])
    .map(i => i.issue_date || i.created_date || i.created_at)
    .filter(d => d && !isNaN(new Date(d).getTime()))
    .map(d => new Date(d).getFullYear())
  )];
  
  const availableYears = [...new Set([currentYear, ...yearsFromInvoices])].sort((a, b) => b - a);

  // ✅ YEAR FILTER: Filter all invoices by selected year
  const yearFilteredInvoices = selectedYear === 'all'
    ? invoices
    : invoices.filter(i => {
        const d = i.issue_date || i.created_date || i.created_at;
        if (!d) return true; // no date at all → include in current year
        return new Date(d).getFullYear().toString() === selectedYear;
      });

  // For the table - show year-filtered invoices (respects year selector)
  const tableInvoices = yearFilteredInvoices;

  // ── One definition of paid / owing / overdue for this whole page ──────
  // The badge in the table is rendered from getInvoiceDisplayStatus, which is
  // BALANCE-derived: an imported invoice with total_amount = 0 and real
  // payments against it reads "Paid". The tabs used to read the raw stored
  // status instead, which is still "partially_paid" on those rows — so a
  // fully-paid invoice showed a Paid badge and simultaneously sat in the
  // Overdue tab. Classify tabs by the same display status the user sees, and
  // never call an invoice overdue when it has no balance left to collect.
  const displayStatusOf = (inv) => getInvoiceDisplayStatus(inv);

  const isOpenInvoice = (inv) => {
    const s = displayStatusOf(inv);
    return !s || s === 'draft' || s === 'sent' || s === 'viewed' || s === 'partially_paid';
  };

  const isOverdueInvoice = (inv) => {
    const s = displayStatusOf(inv);
    // A draft was never sent to the customer, so it cannot be late — matching
    // isInvoiceOverdue() in invoiceFinance.js. Without this a past-due draft
    // would show a "Draft" badge while sitting in the Overdue tab.
    if (s === 'paid' || s === 'cancelled' || s === 'draft') return false;
    // Nothing left owed → nothing to be late on, whatever the stored status says.
    if (getInvoiceBalance(inv) <= 0) return false;
    if (!inv.due_date) return false;
    const dueDate = new Date(inv.due_date);
    dueDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dueDate < today;
  };

  // ✅ PAID INVOICES: Year-filtered (only show paid invoices for selected year)
  const paidInvoices = yearFilteredInvoices.filter(i => displayStatusOf(i) === 'paid');

  // ✅ OVERDUE & OUTSTANDING: Show ALL from any year (roll over to current year)
  const overdueInvoices = invoices.filter(isOverdueInvoice);

  const unpaidInvoices = invoices.filter(isOpenInvoice);

  const draftInvoices = yearFilteredInvoices.filter(i => displayStatusOf(i) === 'draft');
  const partiallyPaidInvoices = yearFilteredInvoices.filter(i => displayStatusOf(i) === 'partially_paid');

  // Year-filtered versions for tab counts (so 35/32 doesn't happen).
  // Dollar totals above still use the cross-year arrays so unpaid balances
  // from earlier years roll forward.
  const unpaidInvoicesForCount = yearFilteredInvoices.filter(isOpenInvoice);
  const overdueInvoicesForCount = yearFilteredInvoices.filter(isOverdueInvoice);

  const totalCount = yearFilteredInvoices.length;
  const paidTotal = paidInvoices.reduce((sum, i) => sum + getInvoiceTrueTotal(i), 0);

  // Cash collected is based on actual valid payment records, not invoice status
  // or the invoice's stored amount_paid field. This intentionally follows the
  // payment date: money received this year still counts even when it was
  // applied to an invoice from a prior year.
  const totalCashCollected = useMemo(() => {
    const yearNum = selectedYear === 'all' ? null : parseInt(selectedYear);
    const excludedPaymentStatuses = new Set(['failed', 'refunded', 'ach_pending', 'void', 'cancelled']);
    return allPayments
      .filter(payment => {
        const status = String(payment.status || '').toLowerCase();
        if (excludedPaymentStatuses.has(status)) return false;
        if (!yearNum) return true;
        if (!payment.payment_date) return false;
        return new Date(payment.payment_date).getFullYear() === yearNum;
      })
      .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  }, [allPayments, selectedYear]);

  // Outstanding = remaining balance on unpaid invoices (year-filtered)
  const outstandingTotal = unpaidInvoices.reduce((sum, inv) => sum + getInvoiceBalance(inv), 0);

  // Overdue = remaining balance on overdue invoices (year-filtered)
  const overdueTotal = overdueInvoices.reduce((sum, inv) => sum + getInvoiceBalance(inv), 0);

  // ── Aging / AR breakdown ──────────────────────────────────────────
  const getInvoiceAgeDays = (inv) => {
    const d = inv.issue_date || inv.created_date || inv.created_at;
    if (!d) return 0;
    return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  };

  const AGING_BUCKETS = [
    { key: 'current', label: 'Current',      min: 0,   max: 30,       borderColor: 'border-l-emerald-500', textColor: 'text-emerald-700', bgColor: 'bg-white', activeBg: 'bg-emerald-50' },
    { key: '31-60',   label: '31–60 days',   min: 31,  max: 60,       borderColor: 'border-l-yellow-500',  textColor: 'text-yellow-700',  bgColor: 'bg-white', activeBg: 'bg-yellow-50'  },
    { key: '61-90',   label: '61–90 days',   min: 61,  max: 90,       borderColor: 'border-l-orange-500',  textColor: 'text-orange-700',  bgColor: 'bg-white', activeBg: 'bg-orange-50'  },
    { key: '91-180',  label: '91–180 days',  min: 91,  max: 180,      borderColor: 'border-l-red-500',     textColor: 'text-red-700',     bgColor: 'bg-white', activeBg: 'bg-red-50'     },
    { key: '180+',    label: '180+ days',    min: 181, max: Infinity,  borderColor: 'border-l-rose-900',    textColor: 'text-rose-900',    bgColor: 'bg-white', activeBg: 'bg-rose-50'    },
  ];

  const agingBucketData = AGING_BUCKETS.map(bucket => {
    const matched = unpaidInvoices.filter(inv => {
      // Gate on a real balance so the bucket COUNT matches the rows the user
      // gets when they click the bucket (the filter below gates the same way).
      if (getInvoiceBalance(inv) <= 0) return false;
      const days = getInvoiceAgeDays(inv);
      return days >= bucket.min && days <= bucket.max;
    });
    return {
      ...bucket,
      count: matched.length,
      total: matched.reduce((sum, inv) => sum + getInvoiceBalance(inv), 0),
    };
  });
  // ─────────────────────────────────────────────────────────────────

  const reconciliation = useMemo(() => {
    if (!allPayments.length && !yearFilteredInvoices.length) return null;
    const yearNum = selectedYear === 'all' ? null : parseInt(selectedYear);
    const yearPayments = allPayments.filter(p => {
      if (p.status !== 'received') return false;
      if (!yearNum) return true;
      if (!p.payment_date) return false;
      return new Date(p.payment_date).getFullYear() === yearNum;
    });
    const yearInvoiceNums = new Set(yearFilteredInvoices.map(i => i.invoice_number).filter(Boolean));
    const appliedToYearInvoices = yearPayments.filter(p => p.invoice_number && yearInvoiceNums.has(p.invoice_number));
    const appliedToOtherInvoices = yearPayments.filter(p => p.invoice_number && !yearInvoiceNums.has(p.invoice_number));
    const unlinkedPayments = yearPayments.filter(p => !p.invoice_number || p.invoice_number.trim() === '');
    const totalCashReceived = yearPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const totalAppliedToYear = appliedToYearInvoices.reduce((s, p) => s + Number(p.amount || 0), 0);
    const totalAppliedToOther = appliedToOtherInvoices.reduce((s, p) => s + Number(p.amount || 0), 0);
    const totalUnlinked = unlinkedPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const totalInvoiced = yearFilteredInvoices.reduce((s, i) => s + getInvoiceTrueTotal(i), 0);
    const totalCollected = yearFilteredInvoices.reduce((s, i) => s + Number(i.amount_paid || 0), 0);
    const totalOutstanding = yearFilteredInvoices.reduce((s, i) => s + getInvoiceBalance(i), 0);
    const paymentsByInvoice = {};
    yearPayments.forEach(p => {
      if (p.invoice_number) paymentsByInvoice[p.invoice_number] = (paymentsByInvoice[p.invoice_number] || 0) + Number(p.amount || 0);
    });
    const mismatchedInvoices = yearFilteredInvoices.filter(inv => {
      if (!inv.invoice_number) return false;
      const paymentSum = paymentsByInvoice[inv.invoice_number] || 0;
      const recorded = Number(inv.amount_paid || 0);
      return Math.abs(paymentSum - recorded) > 0.01 && (paymentSum > 0 || recorded > 0);
    });
    return {
      totalCashReceived, totalAppliedToYear, totalAppliedToOther, totalUnlinked,
      appliedToOtherInvoices, unlinkedPayments, totalInvoiced, totalCollected, totalOutstanding,
      mismatchedInvoices, yearPayments, paymentsByInvoice,
      discrepancy: totalCashReceived - totalAppliedToYear - totalAppliedToOther - totalUnlinked,
    };
  }, [allPayments, yearFilteredInvoices, selectedYear]);

  const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const getPercentage = (count) => totalCount > 0 ? ((count / totalCount) * 100).toFixed(2) : '0.00';

  const filteredInvoices = tableInvoices.filter(invoice => {
    const matchesTab =
      (activeTab === 'all') ||
      // Tabs classify by the SAME display status the badge shows, so a row can
      // never read "Paid" in one column and sit under Unpaid/Overdue.
      (activeTab === 'unpaid' && isOpenInvoice(invoice)) ||
      (activeTab === 'paid' && displayStatusOf(invoice) === 'paid') ||
      (activeTab === 'partially_paid' && displayStatusOf(invoice) === 'partially_paid') ||
      // Keep the table filter aligned with overdueInvoicesForCount above.
      // Overdue is derived from the due date, so requiring the stored status
      // to also be "overdue" made the tab show a count but no rows.
      (activeTab === 'overdue' && overdueInvoicesForCount.includes(invoice)) ||
      (activeTab === 'draft' && displayStatusOf(invoice) === 'draft');

    if (!matchesTab) return false;

    if (agingFilter) {
      const isOutstanding = isOpenInvoice(invoice) && getInvoiceBalance(invoice) > 0;
      if (!isOutstanding) return false;
      const bucket = AGING_BUCKETS.find(b => b.key === agingFilter);
      if (bucket) {
        const days = getInvoiceAgeDays(invoice);
        if (days < bucket.min || days > bucket.max) return false;
      }
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const relatedCustomer = getCompanyCustomerById(filteredCustomers, invoice.customer_id, myCompany?.id);
      return (
        invoice.invoice_number?.toLowerCase().includes(query) ||
        invoice.customer_name?.toLowerCase().includes(query) ||
        invoice.customer_email?.toLowerCase().includes(query) ||
        invoice.claim_number?.toLowerCase().includes(query) ||
        invoice.insurance_company?.toLowerCase().includes(query) ||
        getAddressSearchText(invoice, relatedCustomer).includes(query)
      );
    }

    return true;
  });

  const exportARtoCSV = () => {
    const dateStr = new Date().toLocaleDateString('en-US').replace(/\//g, '-');
    const activeFilter = agingFilter ? AGING_BUCKETS.find(b => b.key === agingFilter)?.label : null;
    const rows = [];

    rows.push([`AR Aging Report — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`]);
    if (activeFilter) rows.push([`Filter: ${activeFilter}`]);
    rows.push([]);

    rows.push(['Outstanding by Age']);
    rows.push(['Bucket', 'Invoices', 'Total Outstanding']);
    for (const b of agingBucketData) {
      rows.push([b.label, b.count, b.total.toFixed(2)]);
    }
    rows.push(['TOTAL', agingBucketData.reduce((s, b) => s + b.count, 0), agingBucketData.reduce((s, b) => s + b.total, 0).toFixed(2)]);
    rows.push([]);

    rows.push(['Invoice Detail']);
    rows.push(['Invoice #', 'Customer', 'Issue Date', 'Age Bucket', 'Days Old', 'Invoice Total', 'Paid', 'Balance Due', 'Status']);
    for (const inv of filteredInvoices) {
      const days = getInvoiceAgeDays(inv);
      const bucket = AGING_BUCKETS.find(b => days >= b.min && days <= b.max);
      const balance = getInvoiceBalance(inv);
      rows.push([
        inv.invoice_number || '',
        inv.customer_name || '',
        inv.issue_date ? new Date(inv.issue_date).toLocaleDateString('en-US') : '',
        bucket?.label || '',
        days,
        Number(inv.total_amount || 0).toFixed(2),
        Number(inv.amount_paid || 0).toFixed(2),
        balance.toFixed(2),
        // Export the status the user SEES on the row, not the raw stored one,
        // so a "Paid" row never exports as "partially paid".
        displayStatusOf(inv)?.replace(/_/g, ' ') || '',
      ]);
    }

    const csv = rows.map(row =>
      row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AR-Aging-${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const totalPages = itemsPerPage === 'all'
    ? 1
    : Math.ceil(filteredInvoices.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedInvoices = itemsPerPage === 'all'
    ? filteredInvoices
    : filteredInvoices.slice(startIndex, endIndex);

  const getStatusColor = (status) => {
    const colors = {
      'paid': 'bg-green-100 text-green-700 border-green-200',
      'sent': 'bg-blue-100 text-blue-700 border-blue-200',
      'viewed': 'bg-purple-100 text-purple-700 border-purple-200',
      'draft': 'bg-gray-100 text-gray-700 border-gray-200',
      'overdue': 'bg-red-100 text-red-700 border-red-200',
      'partially_paid': 'bg-orange-100 text-orange-700 border-orange-200',
    };
    return colors[status] || 'bg-gray-100 text-gray-700 border-gray-200';
  };

  if (isLoadingInvoices) {
    return <TablePageSkeleton />;
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden p-3 sm:p-6 space-y-6">
      <Toaster />
      {qbStatus && !qbStatus.connected && qbStatus.was_connected && !qbBannerDismissed && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-500 mt-0.5" />
          <p className="text-sm text-amber-800 flex-1">
            Your QuickBooks connection needs to be re-authorized.{' '}
            <a href={createPageUrl('Settings')} className="underline font-medium hover:text-amber-900">Go to Company Settings → QuickBooks</a>{' '}to reconnect.
          </p>
          <button
            onClick={() => { setQbBannerDismissed(true); sessionStorage.setItem('qb-reconnect-banner-dismissed', '1'); }}
            className="text-amber-600 hover:text-amber-800 text-sm font-medium flex-shrink-0"
            aria-label="Dismiss QuickBooks reconnect banner"
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.invoices.title}</h1>
          <p className="text-sm text-gray-500 mt-1">
            <a href="#" className="text-blue-600 hover:underline">{t.common.status === 'sent' ? 'Recurring Invoices →' : 'Facturas recurrentes →'}</a>
          </p>
        </div>

        <Select value={selectedYear} onValueChange={setSelectedYear}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder={t.common.select + " Year"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.common.all} Years</SelectItem>
            {availableYears.filter(year => year && !isNaN(year)).map(year => (
              <SelectItem key={year} value={year.toString()}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-green-50 border-l-4 border-l-green-500" data-testid="card-total-cash-collected">
          <CardContent className="p-4">
            <div className="flex items-center gap-1 text-sm font-medium text-green-800">
              <span>Total Cash Collected</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="rounded-full p-0.5 text-green-700/70 hover:text-green-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                      aria-label="What is Total Cash Collected?"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start" className="max-w-[280px] text-center">
                    Actual valid payments received during the selected year. This includes money applied to invoices from prior years and does not rely on an invoice being marked Paid.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="text-2xl font-bold text-green-900 mt-1">
              ${totalCashCollected.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-1 text-sm text-gray-600">
              <span>{t.invoices.paid} {t.invoices.title}</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="rounded-full p-0.5 text-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400"
                      aria-label="Why can Paid Invoices differ from Total Cash Collected?"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start" className="max-w-[280px] text-center">
                    Paid Invoices is the total value of invoices marked Paid for this year. It can differ from cash collected because payment timing, prior-year invoices, unlinked payments, and invoice status are tracked separately.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="text-2xl font-bold text-green-600 mt-1">
              ${paidTotal.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <div className="text-sm text-gray-600">{t.invoices.overdue} {t.invoices.title}</div>
            <div className="text-2xl font-bold text-red-600 mt-1">
              ${overdueTotal.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-l-4 border-l-orange-500">
          <CardContent className="p-4">
            <div className="text-sm text-gray-600">{t.invoices.amountDue} {t.invoices.title}</div>
            <div className="text-2xl font-bold text-orange-600 mt-1">
              ${outstandingTotal.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── AR Aging Breakdown ───────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Outstanding by Age</p>
          <div className="flex items-center gap-2">
            {agingFilter && (
              <button
                onClick={() => { setAgingFilter(null); setCurrentPage(1); }}
                className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                data-testid="button-clear-aging-filter"
              >
                ✕ Clear age filter
              </button>
            )}
            <button
              onClick={exportARtoCSV}
              className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 transition-colors"
              data-testid="button-export-ar-csv"
              title="Export AR aging report to CSV"
            >
              <Download className="w-3 h-3" />
              Export CSV
            </button>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {agingBucketData.map(bucket => {
            const isActive = agingFilter === bucket.key;
            return (
              <button
                key={bucket.key}
                data-testid={`button-aging-${bucket.key}`}
                onClick={() => { setAgingFilter(isActive ? null : bucket.key); setCurrentPage(1); }}
                className={`flex-shrink-0 min-w-[130px] border-l-4 rounded-lg p-3 text-left transition-all shadow-sm
                  ${bucket.borderColor}
                  ${isActive ? bucket.activeBg + ' ring-2 ring-offset-1 ring-current' : 'bg-white hover:' + bucket.activeBg}`}
              >
                <div className={`text-xs font-semibold ${bucket.textColor}`}>{bucket.label}</div>
                <div className={`text-lg font-bold mt-0.5 ${bucket.textColor}`}>
                  ${bucket.total.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{bucket.count} invoice{bucket.count !== 1 ? 's' : ''}</div>
                {isActive && <div className="text-xs text-gray-400 mt-1 italic">click to clear</div>}
              </button>
            );
          })}
        </div>
      </div>
      {/* ─────────────────────────────────────────────────────────────── */}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full min-w-0">
        <div className="w-full min-w-0 overflow-x-auto rounded-lg">
        <TabsList className="bg-gray-100 flex-nowrap h-auto w-max min-w-full">
          <TabsTrigger value="all" className="flex-col items-start">
            <span>{t.common.all}</span>
            <span className="text-xs text-gray-500">({totalCount})</span>
          </TabsTrigger>
          <TabsTrigger value="unpaid" className="flex-col items-start">
            <span>{t.invoices.amountDue}</span>
            <span className="text-xs text-gray-500">({getPercentage(unpaidInvoicesForCount.length)}%) {unpaidInvoicesForCount.length} / {totalCount}</span>
          </TabsTrigger>
          <TabsTrigger value="paid" className="flex-col items-start">
            <span>{t.invoices.paid}</span>
            <span className="text-xs text-gray-500">({getPercentage(paidInvoices.length)}%) {paidInvoices.length} / {totalCount}</span>
          </TabsTrigger>
          <TabsTrigger value="partially_paid" className="flex-col items-start">
            <span>{t.invoices.partiallyPaid}</span>
            <span className="text-xs text-gray-500">({getPercentage(partiallyPaidInvoices.length)}%) {partiallyPaidInvoices.length} / {totalCount}</span>
          </TabsTrigger>
          <TabsTrigger value="overdue" className="flex-col items-start">
            <span>{t.invoices.overdue}</span>
            <span className="text-xs text-gray-500">({getPercentage(overdueInvoicesForCount.length)}%) {overdueInvoicesForCount.length} / {totalCount}</span>
          </TabsTrigger>
          <TabsTrigger value="draft" className="flex-col items-start">
            <span>{t.invoices.draft}</span>
            <span className="text-xs text-gray-500">({getPercentage(draftInvoices.length)}%) {draftInvoices.length} / {totalCount}</span>
          </TabsTrigger>
          <TabsTrigger value="reconciliation" className="flex-col items-start border-l border-gray-300 ml-2 pl-3">
            <span className="flex items-center gap-1"><Scale className="w-3 h-3" /> Reconciliation</span>
            <span className="text-xs text-gray-500">QB View</span>
          </TabsTrigger>
        </TabsList>
        </div>
      </Tabs>

      {activeTab === 'reconciliation' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Cash Reconciliation — {selectedYear === 'all' ? 'All Years' : selectedYear}</h2>
            <p className="text-sm text-gray-500 mt-1">Match your cash received against invoices — the same breakdown QuickBooks shows in its A/R Reconciliation.</p>
          </div>

          {!reconciliation ? (
            <Card><CardContent className="p-8 text-center text-gray-400">No data yet for this period.</CardContent></Card>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardContent className="p-5 space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-green-500 flex-shrink-0"></div>
                      <h3 className="font-semibold text-gray-900">Cash Received</h3>
                      <span className="ml-auto text-xs text-gray-400 whitespace-nowrap">≈ QB Cash Receipts Journal</span>
                    </div>
                    <div className="space-y-2.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Applied to {selectedYear === 'all' ? 'these' : selectedYear} invoices</span>
                        <span className="font-medium">${fmt(reconciliation.totalAppliedToYear)}</span>
                      </div>
                      {reconciliation.totalAppliedToOther > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Applied to prior-year invoices</span>
                          <span className="font-medium text-amber-700">${fmt(reconciliation.totalAppliedToOther)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Not linked to any invoice</span>
                        <span className={`font-medium ${reconciliation.totalUnlinked > 0 ? 'text-red-600' : 'text-gray-900'}`}>${fmt(reconciliation.totalUnlinked)}</span>
                      </div>
                      <div className="border-t pt-2.5 flex justify-between font-bold">
                        <span>Total Cash Received</span>
                        <span className="text-green-700 text-base">${fmt(reconciliation.totalCashReceived)}</span>
                      </div>
                    </div>
                    {reconciliation.totalAppliedToOther > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-700">
                        <strong>${fmt(reconciliation.totalAppliedToOther)}</strong> was received in {selectedYear} for invoices from a prior year — this is why Payments &gt; Paid Invoices on this page.
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-5 space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-blue-500 flex-shrink-0"></div>
                      <h3 className="font-semibold text-gray-900">Invoice Summary — {selectedYear === 'all' ? 'All Years' : selectedYear}</h3>
                      <span className="ml-auto text-xs text-gray-400 whitespace-nowrap">≈ QB Open Invoices</span>
                    </div>
                    <div className="space-y-2.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Total invoiced ({yearFilteredInvoices.length} invoices)</span>
                        <span className="font-medium">${fmt(reconciliation.totalInvoiced)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Collected (recorded on invoices)</span>
                        <span className="font-medium text-green-700">${fmt(reconciliation.totalCollected)}</span>
                      </div>
                      <div className="border-t pt-2.5 flex justify-between font-bold">
                        <span>Outstanding balance</span>
                        <span className={`text-base ${reconciliation.totalOutstanding > 0 ? 'text-red-600' : 'text-gray-900'}`}>${fmt(reconciliation.totalOutstanding)}</span>
                      </div>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-700">
                      <strong>QB A/R Aging:</strong> Your <strong>${fmt(reconciliation.totalOutstanding)}</strong> outstanding balance should match the QuickBooks A/R Aging report total for {selectedYear === 'all' ? 'all years' : selectedYear}.
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card className={`border-2 ${Math.abs(reconciliation.discrepancy) < 0.01 ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3">
                    {Math.abs(reconciliation.discrepancy) < 0.01
                      ? <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0" />
                      : <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0" />}
                    <div>
                      <p className={`font-semibold ${Math.abs(reconciliation.discrepancy) < 0.01 ? 'text-green-800' : 'text-amber-800'}`}>
                        {Math.abs(reconciliation.discrepancy) < 0.01
                          ? '✓ All cash is accounted for — applied to invoices + unlinked = total received'
                          : `⚠ Unaccounted difference: $${fmt(Math.abs(reconciliation.discrepancy))}`}
                      </p>
                      <p className={`text-xs mt-0.5 ${Math.abs(reconciliation.discrepancy) < 0.01 ? 'text-green-700' : 'text-amber-700'}`}>
                        {Math.abs(reconciliation.discrepancy) < 0.01
                          ? 'Same check QuickBooks runs in Accounts Receivable reconciliation.'
                          : 'Applied to invoices + unlinked does not equal total received. Some payments may reference invalid invoice numbers.'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {reconciliation.mismatchedInvoices.length > 0 && (
                <Card className="border-2 border-amber-300">
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                      <h3 className="font-semibold text-amber-800">
                        {reconciliation.mismatchedInvoices.length} invoice{reconciliation.mismatchedInvoices.length !== 1 ? 's' : ''} with amount mismatch
                      </h3>
                      <span className="text-xs text-amber-600 ml-1">— QuickBooks would flag these in A/R reconciliation</span>
                    </div>
                    <p className="text-xs text-amber-700 mb-3">The amount recorded on the invoice doesn't match the sum of its payment transactions. This can cause incorrect balances in reports.</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-gray-500 border-b">
                            <th className="pb-2 pr-4">Invoice #</th>
                            <th className="pb-2 pr-4">Customer</th>
                            <th className="pb-2 pr-4 text-right">Invoice records paid</th>
                            <th className="pb-2 pr-4 text-right">Sum of payments</th>
                            <th className="pb-2 text-right">Difference</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reconciliation.mismatchedInvoices.slice(0, 20).map(inv => {
                            const paymentSum = reconciliation.yearPayments.filter(p => makeInvoiceMatcher(allInvoices)(p, inv)).reduce((s, p) => s + Number(p.amount || 0), 0);
                            const recorded = Number(inv.amount_paid || 0);
                            const diff = paymentSum - recorded;
                            return (
                              <tr key={inv.id} className="border-b border-amber-100">
                                <td className="py-2 pr-4 font-medium text-blue-600 cursor-pointer hover:underline"
                                    onClick={() => navigate(createPageUrl('invoice-details') + `?id=${inv.id}`)}>
                                  {inv.invoice_number}
                                </td>
                                <td className="py-2 pr-4 text-gray-700">{inv.customer_name || '—'}</td>
                                <td className="py-2 pr-4 text-right">${recorded.toFixed(2)}</td>
                                <td className="py-2 pr-4 text-right">${paymentSum.toFixed(2)}</td>
                                <td className={`py-2 text-right font-medium ${diff > 0 ? 'text-green-700' : 'text-red-700'}`}>{diff > 0 ? '+' : ''}${diff.toFixed(2)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {reconciliation.mismatchedInvoices.length > 20 && (
                        <p className="text-xs text-amber-600 mt-2">…and {reconciliation.mismatchedInvoices.length - 20} more.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {reconciliation.unlinkedPayments.length > 0 && (
                <Card>
                  <CardContent className="p-5">
                    <h3 className="font-semibold text-gray-900 mb-1">
                      Unlinked Payments ({reconciliation.unlinkedPayments.length})
                      <span className="ml-2 text-xs font-normal text-gray-500">≈ QB Unapplied Customer Credits</span>
                    </h3>
                    <p className="text-xs text-gray-500 mb-3">These payments have no invoice number — they're included in Total Received but don't reduce any invoice balance. Go to the Payments page and click "Auto-Fix All" to link them.</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-gray-500 border-b">
                            <th className="pb-2 pr-4">Payment #</th>
                            <th className="pb-2 pr-4">Customer</th>
                            <th className="pb-2 pr-4">Date</th>
                            <th className="pb-2 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reconciliation.unlinkedPayments.slice(0, 10).map(p => (
                            <tr key={p.id} className="border-b border-gray-100">
                              <td className="py-2 pr-4 font-medium">{p.payment_number || '—'}</td>
                              <td className="py-2 pr-4 text-gray-700">{p.customer_name || '—'}</td>
                              <td className="py-2 pr-4 text-gray-500">{p.payment_date || '—'}</td>
                              <td className="py-2 text-right font-medium text-green-700">${Number(p.amount || 0).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {reconciliation.unlinkedPayments.length > 10 && (
                        <p className="text-xs text-gray-400 mt-2">…and {reconciliation.unlinkedPayments.length - 10} more.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {activeTab !== 'reconciliation' && <>
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div className="flex gap-2">
          <Button
            className="bg-blue-600 hover:bg-blue-700"
            onClick={handleCreateNew}
          >
            <Plus className="w-4 h-4 mr-2" />
            {t.invoices.createInvoice}
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowBatchPaymentsDialog(true)}
            disabled={selectedInvoices.length === 0}
          >
            {t.invoices.recordPayment} ({selectedInvoices.length})
          </Button>
          {isAdmin && (
            <BulkDeleteButton
              variant="outline"
              onClick={() => setShowBatchDeleteDialog(true)}
              disabled={selectedInvoices.length === 0 || batchDeleteMutation.isPending}
              className="border-red-500 text-red-700 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {batchDeleteMutation.isPending ? t.common.loading : `${t.common.delete} (${selectedInvoices.length})`}
            </BulkDeleteButton>
          )}
          <Button
            variant="outline"
            onClick={() => setShowFixStatusesDialog(true)}
            className="bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100"
          >
            {'Fix Statuses'}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={itemsPerPage.toString()}
            onValueChange={(val) => {
              setItemsPerPage(val === 'all' ? 'all' : parseInt(val, 10));
              setCurrentPage(1);
            }}
          >
            <SelectTrigger className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns className="w-4 h-4 mr-2" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <div className="p-2 font-semibold text-sm">Toggle Columns</div>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={visibleColumns.invoice_number}
                onCheckedChange={() => toggleColumn('invoice_number')}
              >
                {t.invoices.invoiceNumber}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.amount}
                onCheckedChange={() => toggleColumn('amount')}
              >
                {t.invoices.amount}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.balance}
                onCheckedChange={() => toggleColumn('balance')}
              >
                Balance Due
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.total_tax}
                onCheckedChange={() => toggleColumn('total_tax')}
              >
                {t.invoices.tax}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.date}
                onCheckedChange={() => toggleColumn('date')}
              >
                {t.invoices.date}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.customer}
                onCheckedChange={() => toggleColumn('customer')}
              >
                {t.invoices.customer}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.project}
                onCheckedChange={() => toggleColumn('project')}
              >
                {t.projects.title}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.tags}
                onCheckedChange={() => toggleColumn('tags')}
              >
                Tags
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.due_date}
                onCheckedChange={() => toggleColumn('due_date')}
              >
                {t.invoices.dueDate}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.status}
                onCheckedChange={() => toggleColumn('status')}
              >
                {t.invoices.status}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.claim_number}
                onCheckedChange={() => toggleColumn('claim_number')}
              >
                {t.inspections.claimNumber}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.insurance_company}
                onCheckedChange={() => toggleColumn('insurance_company')}
              >
                {t.inspections.insuranceCompany}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.policy_number}
                onCheckedChange={() => toggleColumn('policy_number')}
              >
                Policy Number
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={visibleColumns.deductible_amount}
                onCheckedChange={() => toggleColumn('deductible_amount')}
              >
                Deductible Amount
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm">{t.common.export}</Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
        <Input
          placeholder={t.invoices.searchInvoices}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {agingFilter && (() => {
        const activeBucket = AGING_BUCKETS.find(b => b.key === agingFilter);
        return activeBucket ? (
          <div className="flex items-center gap-2" data-testid="aging-filter-badge">
            <span className="text-xs text-gray-500">Filtered by:</span>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${activeBucket.activeBg} ${activeBucket.textColor} border-current/20`}>
              {activeBucket.label}
              <button
                onClick={() => { setAgingFilter(null); setCurrentPage(1); }}
                className="hover:opacity-70"
                data-testid="button-inline-clear-aging"
                aria-label="Clear age filter"
              >
                ×
              </button>
            </span>
          </div>
        ) : null;
      })()}

      <Card className="bg-white shadow-md">
        <CardContent className="p-0">
          {isMobile ? (
            <div className="pb-20">
              {paginatedInvoices.length === 0 ? (
                <div className="py-16 text-center">
                  <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="text-gray-500 font-medium">{t.invoices.noInvoices}</p>
                  <p className="text-gray-400 text-sm mt-1">Create your first invoice to get started</p>
                  <button
                    onClick={() => setShowCreateDialog(true)}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    New Invoice
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {paginatedInvoices.map((invoice) => {
                    const balance = getInvoiceBalance(invoice);
                    const effectiveStatus = getInvoiceDisplayStatus(invoice);
                    return (
                      <React.Fragment key={invoice.id}>
                      <button
                        onClick={() => navigate(createPageUrl('invoice-details') + `?id=${invoice.id}`)}
                        className="w-full text-left p-4 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                        data-testid={`card-invoice-${invoice.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-blue-600 text-base">{invoice.invoice_number}</span>
                          <div className="flex items-center gap-1.5 flex-wrap justify-end">
                            <Badge variant="outline" className={`${getStatusColor(effectiveStatus)} whitespace-nowrap`}>
                              {effectiveStatus === 'partially_paid' ? t.invoices.partiallyPaid :
                               effectiveStatus === 'paid' ? t.invoices.paid :
                               effectiveStatus === 'sent' || effectiveStatus === 'viewed' ? t.invoices.amountDue :
                               effectiveStatus?.replace(/_/g, ' ') || 'Draft'}
                            </Badge>
                            {invoice.quickbooks_invoice_id ? (
                              <a
                                href={buildQBInvoiceUrl(invoice.quickbooks_invoice_id)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                title="View in QuickBooks"
                                data-testid={`badge-qb-invoice-mobile-${invoice.id}`}
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700 border border-green-300 hover:bg-green-200 transition-colors"
                              >
                                QB ✓
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : qbStatus?.connected && isAdmin ? (
                              <button
                                data-testid={`badge-qb-invoice-sync-mobile-${invoice.id}`}
                                onClick={(e) => { e.stopPropagation(); syncInvoiceToQBMutation.mutate(invoice.id); }}
                                disabled={syncInvoiceToQBMutation.isPending}
                                title="Push this invoice to QuickBooks"
                                 className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition-colors disabled:opacity-50"
                              >
                                {syncInvoiceToQBMutation.isPending && syncInvoiceToQBMutation.variables === invoice.id
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : null}
                                Sync to QB
                              </button>
                            ) : qbStatus?.connected ? (
                              <span
                                data-testid={`badge-qb-invoice-pending-mobile-${invoice.id}`}
                                 className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap bg-gray-100 text-gray-500 border border-gray-200"
                              >
                                QB Pending
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-1.5">
                          <p className="font-medium text-gray-900 text-sm">{invoice.customer_name}</p>
                          {invoice.due_date && (
                            <p className="text-xs text-gray-400 mt-0.5">{t.invoices.dueDate}: {invoice.due_date}</p>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <div>
                            <span className="text-lg font-bold text-gray-900">${getInvoiceTrueTotal(invoice).toFixed(2)}</span>
                            {balance > 0 && (
                              <span className="text-xs text-red-500 ml-2">Balance: ${balance.toFixed(2)}</span>
                            )}
                          </div>
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        </div>
                      </button>
                      {isAdmin && invoiceNeedsCustomerLink(invoice, filteredCustomers) && (
                        <div className="px-4 pb-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openLinkCustomerPicker(invoice)}
                            data-testid={`button-link-invoice-customer-mobile-${invoice.id}`}
                          >
                            <LinkIcon className="mr-1.5 h-4 w-4" />
                            Link to customer
                          </Button>
                          <p className="mt-1 text-xs text-amber-700">
                            {invoice.customer_id ? 'Customer id does not match a customer record.' : 'No customer linked.'}
                          </p>
                        </div>
                      )}
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="bg-gray-50 border-b sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3">
                    <Checkbox
                      checked={selectedInvoices.length === paginatedInvoices.length && paginatedInvoices.length > 0}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedInvoices(paginatedInvoices.map(inv => inv.id));
                        } else {
                          setSelectedInvoices([]);
                        }
                      }}
                    />
                  </th>
                  {visibleColumns.invoice_number && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                      {t.invoices.invoiceNumber}
                    </th>
                  )}
                  {visibleColumns.amount && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                      {t.invoices.amount}
                    </th>
                  )}
                  {visibleColumns.balance && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                      Balance Due
                    </th>
                  )}
                  {visibleColumns.total_tax && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                      {t.invoices.tax}
                    </th>
                  )}
                  {visibleColumns.date && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                      {t.invoices.date}
                    </th>
                  )}
                  {visibleColumns.customer && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                      {t.invoices.customer}
                    </th>
                  )}
                  {visibleColumns.project && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                      {t.projects.title}
                    </th>
                  )}
                  {visibleColumns.tags && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                      Tags
                    </th>
                  )}
                  {visibleColumns.due_date && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                      {t.invoices.dueDate}
                    </th>
                  )}
                  {visibleColumns.status && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                      {t.invoices.status}
                    </th>
                  )}
                  {visibleColumns.claim_number && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                      {t.inspections.claimNumber}
                    </th>
                  )}
                  {visibleColumns.insurance_company && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                      {t.inspections.insuranceCompany}
                    </th>
                  )}
                  {visibleColumns.policy_number && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                      Policy Number
                    </th>
                  )}
                  {visibleColumns.deductible_amount && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                      Deductible Amount
                    </th>
                  )}
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-600">
                    {t.common.actions}
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedInvoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Checkbox
                        checked={selectedInvoices.includes(invoice.id)}
                        onCheckedChange={() => toggleInvoiceSelection(invoice.id)}
                      />
                    </td>
                    {visibleColumns.invoice_number && (
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <button
                            onClick={() => navigate(createPageUrl('invoice-details') + `?id=${invoice.id}`)}
                            className="text-blue-600 hover:underline font-medium text-left"
                          >
                            {invoice.invoice_number}
                          </button>
                          <div className="flex gap-2 text-xs text-gray-500 mt-1">
                            <button
                              onClick={() => navigate(createPageUrl('invoice-details') + `?id=${invoice.id}`)}
                              className="hover:text-blue-600"
                            >
                              {t.common.view}
                            </button>
                            <span>|</span>
                            <button
                              onClick={() => navigate(createPageUrl('invoice-details') + `?id=${invoice.id}`)}
                              className="hover:text-blue-600"
                            >
                              {t.common.edit}
                            </button>
                            {isAdmin && (
                              <>
                                <span>|</span>
                                <button
                                  onClick={() => handleDeleteInvoice(invoice)}
                                  className="hover:text-red-600 font-medium"
                                  title="Admin only: Delete invoice"
                                >
                                  {t.common.delete}
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </td>
                    )}
                    {visibleColumns.amount && (
                      <td className="px-4 py-3 font-semibold">
                        ${getInvoiceTrueTotal(invoice).toFixed(2)}
                      </td>
                    )}
                    {visibleColumns.balance && (() => {
                      const bal = getInvoiceBalance(invoice);
                      return (
                        <td className="px-4 py-3 font-semibold">
                          {bal > 0 ? (
                            <span className="text-red-600">${bal.toFixed(2)}</span>
                          ) : (
                            <span className="text-green-600 text-sm">—</span>
                          )}
                        </td>
                      );
                    })()}
                    {visibleColumns.total_tax && (
                      <td className="px-4 py-3 text-gray-600">
                        {(Number(invoice.total_tax) || 0).toFixed(2)}
                      </td>
                    )}
                    {visibleColumns.date && (
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {safeFormatDate(invoice.issue_date)}
                      </td>
                    )}
                    {visibleColumns.customer && (
                      <td className="px-4 py-3">
                        {invoice.customer_id ? (
                          <button
                            onClick={() => navigate(createPageUrl('CustomerProfile') + `?customerId=${encodeURIComponent(invoice.customer_id)}`)}
                            className="text-gray-900 hover:text-blue-600"
                          >
                            {invoice.customer_name}
                          </button>
                        ) : (
                          <span className="text-gray-900">{invoice.customer_name}</span>
                        )}
                      </td>
                    )}
                    {visibleColumns.project && (
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {invoice.project_name || '-'}
                      </td>
                    )}
                    {visibleColumns.tags && (
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {invoice.tags?.join(', ') || '-'}
                      </td>
                    )}
                    {visibleColumns.due_date && (
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {safeFormatDate(invoice.due_date)}
                      </td>
                    )}
                    {visibleColumns.status && (() => {
                      const bal = getInvoiceBalance(invoice);
                      const effectiveStatus = getInvoiceDisplayStatus(invoice);
                      const qbUrl = buildQBInvoiceUrl(invoice.quickbooks_invoice_id);
                      return (
                         <td className="px-4 py-3 align-top">
                           <div className="flex items-start gap-1.5 flex-wrap">
                            <Badge variant="outline" className={`${getStatusColor(effectiveStatus)} whitespace-nowrap`}>
                              {effectiveStatus === 'sent' || effectiveStatus === 'viewed' ? t.invoices.amountDue :
                               effectiveStatus === 'partially_paid' ? t.invoices.partiallyPaid :
                               effectiveStatus === 'paid' ? t.invoices.paid :
                               effectiveStatus === 'overdue' ? t.invoices.overdue :
                               effectiveStatus === 'draft' ? t.invoices.draft :
                               effectiveStatus === 'cancelled' ? t.invoices.cancelled :
                               effectiveStatus?.replace(/_/g, ' ')}
                            </Badge>
                            {qbUrl ? (
                              <a
                                href={qbUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                title="View in QuickBooks"
                                data-testid={`badge-qb-invoice-${invoice.id}`}
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700 border border-green-300 hover:bg-green-200 transition-colors"
                              >
                                QB ✓
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : qbStatus?.connected && isAdmin ? (
                              <button
                                data-testid={`badge-qb-invoice-sync-${invoice.id}`}
                                onClick={(e) => { e.stopPropagation(); syncInvoiceToQBMutation.mutate(invoice.id); }}
                                disabled={syncInvoiceToQBMutation.isPending}
                                title="Push this invoice to QuickBooks"
                                 className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition-colors disabled:opacity-50"
                              >
                                {syncInvoiceToQBMutation.isPending && syncInvoiceToQBMutation.variables === invoice.id
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : null}
                                Sync to QB
                              </button>
                            ) : qbStatus?.connected ? (
                              <span
                                data-testid={`badge-qb-invoice-pending-${invoice.id}`}
                                 className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap bg-gray-100 text-gray-500 border border-gray-200"
                              >
                                QB Pending
                              </span>
                            ) : null}
                          </div>
                        </td>
                      );
                    })()}
                    {visibleColumns.claim_number && (
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {invoice.claim_number || '-'}
                      </td>
                    )}
                    {visibleColumns.insurance_company && (
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {invoice.insurance_company || '-'}
                      </td>
                    )}
                    {visibleColumns.policy_number && (
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {invoice.policy_number || '-'}
                      </td>
                    )}
                    {visibleColumns.deductible_amount && (
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {invoice.deductible_amount ? `$${(Number(invoice.deductible_amount) || 0).toFixed(2)}` : '-'}
                      </td>
                    )}
                     <td className="px-4 py-3 text-right align-top">
                       <div className="flex items-start justify-end gap-2">
                        {isAdmin && invoiceNeedsCustomerLink(invoice, filteredCustomers) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openLinkCustomerPicker(invoice)}
                            data-testid={`button-link-invoice-customer-${invoice.id}`}
                          >
                            <LinkIcon className="mr-1 h-4 w-4" />
                            Link customer
                          </Button>
                        )}
                        {invoice.status !== 'paid' && invoice.status !== 'cancelled' && myCompany?.stripe_onboarding_status === 'complete' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => sendPaymentLinkMutation.mutate(invoice)}
                            disabled={sendPaymentLinkMutation.isPending}
                            className="border-green-500 text-green-700 hover:bg-green-50"
                            title="Generate & copy Stripe payment link"
                          >
                            {sendPaymentLinkMutation.isPending && sendPaymentLinkMutation.variables?.id === invoice.id ? (
                              <>
                                <svg className="animate-spin h-4 w-4 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Creating...
                              </>
                            ) : (
                              <>
                                <LinkIcon className="w-4 h-4 mr-1" />
                                Payment Link
                              </>
                            )}
                          </Button>
                        )}
                        {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openReminderDialog(invoice)}
                            className="border-amber-400 text-amber-700 hover:bg-amber-50"
                            title="Send a payment reminder to the customer"
                            data-testid={`btn-remind-${invoice.id}`}
                          >
                            <Bell className="w-4 h-4 mr-1" />
                            Remind
                          </Button>
                        )}
                        {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
                          <Button
                            size="sm"
                            onClick={() => handleSendInvoice(invoice)}
                            disabled={sendInvoiceMutation.isPending && sendInvoiceMutation.variables?.id === invoice.id || !invoice.customer_email}
                            className="bg-blue-600 hover:bg-blue-700"
                            title={!invoice.customer_email ? 'Add customer email first' : 'Send invoice via email'}
                          >
                            {sendInvoiceMutation.isPending && sendInvoiceMutation.variables?.id === invoice.id ? (
                              <>
                                <svg className="animate-spin h-4 w-4 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Sending...
                              </>
                            ) : (
                              <>
                                <Send className="w-4 h-4 mr-1" />
                                {t.invoices.sendInvoice}
                              </>
                            )}
                          </Button>
                        )}
                        {invoice.status !== 'paid' && invoice.status !== 'cancelled' && canTextInvoice(invoice) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => sendInvoiceSmsMutation.mutate(invoice)}
                            disabled={sendInvoiceSmsMutation.isPending && sendInvoiceSmsMutation.variables?.id === invoice.id}
                            className="border-green-500 text-green-700 hover:bg-green-50"
                            title="Text this invoice to the customer"
                            data-testid={`btn-text-invoice-${invoice.id}`}
                          >
                            <MessageSquare className="w-4 h-4 mr-1" />
                            {sendInvoiceSmsMutation.isPending && sendInvoiceSmsMutation.variables?.id === invoice.id ? 'Texting...' : 'Text'}
                          </Button>
                        )}
                        {invoice.status === 'sent' && (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            {t.invoices.sent}
                          </Badge>
                        )}
                        {isAdmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDeleteInvoice(invoice)}
                            className="border-red-500 text-red-700 hover:bg-red-50"
                            title="Admin only: Delete invoice"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {paginatedInvoices.length === 0 && (
                  <tr>
                    <td colSpan={20} className="py-16 text-center">
                      <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                      <p className="text-gray-500 font-medium">{t.invoices.noInvoices}</p>
                      <p className="text-gray-400 text-sm mt-1">Create your first invoice to get started</p>
                      <button
                        onClick={() => setShowCreateDialog(true)}
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        New Invoice
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          )}

          {filteredInvoices.length > 0 && !isMobile && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
              <div className="text-sm text-gray-600">
                Showing {startIndex + 1} to {Math.min(endIndex, filteredInvoices.length)} of {filteredInvoices.length} entries
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                  {t.common.previous}
                </Button>

                <div className="flex gap-1">
                  {[...Array(Math.min(5, totalPages))].map((_, i) => {
                    const pageNum = i + 1;
                    return (
                      <Button
                        key={pageNum}
                        variant={currentPage === pageNum ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCurrentPage(pageNum)}
                        className={currentPage === pageNum ? "bg-blue-600" : ""}
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  {t.common.next}
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      </>}

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.invoices.createInvoice}</DialogTitle>
            <DialogDescription>
              {t.invoices.createInvoice}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="invoice_number">{t.invoices.invoiceNumber} *</Label>
                <Input
                  id="invoice_number"
                  value={newInvoiceForm.invoice_number}
                  readOnly
                  className="bg-gray-50 cursor-not-allowed"
                />
                <p className="text-xs text-gray-500 mt-1">{t.common.status === 'sent' ? 'Auto-generated' : 'Auto-generado'}</p>
              </div>
              <div>
                <Label htmlFor="issue_date">{t.invoices.date} *</Label>
                <Input
                  id="issue_date"
                  type="date"
                  value={newInvoiceForm.issue_date}
                  onChange={(e) => setNewInvoiceForm({...newInvoiceForm, issue_date: e.target.value})}
                  required
                />
              </div>
            </div>

            {(() => {
              if (!newInvoiceForm.customer_name) return null;
              const selectedCustomer = getCompanyCustomerById(customers, newInvoiceForm.customer_id, myCompany?.id);
              const unpaid = findUnpaidInvoicesForCustomer(
                allInvoices,
                newInvoiceForm.customer_name,
                selectedCustomer?.id
              );
              if (unpaid.length === 0) return null;
              const linkedToSelected = selectedCustomer
                ? unpaid.filter((invoice) => String(invoice.customer_id || '') === String(selectedCustomer.id)).length
                : 0;
              return (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm text-amber-800">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <span className="flex-1 font-semibold">
                      {selectedCustomer && linkedToSelected > 0
                        ? `${selectedCustomer.name} already has ${linkedToSelected} linked unpaid invoice${linkedToSelected > 1 ? 's' : ''}.`
                        : selectedCustomer
                          ? `Possible duplicate: an unlinked invoice uses the name ${selectedCustomer.name}.`
                          : 'Possible same-name invoices were found. The names may belong to different people.'}
                    </span>
                  </div>
                  {unpaid.some((invoice) => !invoice.customer_id) && (
                    <p className="ml-6 mt-1 text-xs">
                      Unlinked invoices below are only name matches; they are not attached to a customer record.
                    </p>
                  )}
                  <ul className="mt-1 ml-6 space-y-0.5">
                    {unpaid.map(inv => (
                      <li key={inv.id}>
                        <button
                          type="button"
                          className="font-medium text-amber-700 underline hover:text-amber-900"
                          onClick={() => { setShowCreateDialog(false); navigate(createPageUrl('Invoices') + '?search=' + encodeURIComponent(inv.invoice_number)); }}
                        >
                          {inv.invoice_number}
                        </button>
                        {' '}— ${(Number(inv.total_amount || inv.amount) || 0).toFixed(2)} ({inv.status}){' '}
                        <span className="text-xs">
                          {inv.customer_id && selectedCustomer && String(inv.customer_id) === String(selectedCustomer.id)
                            ? 'Linked to this customer'
                            : inv.customer_id
                              ? 'Linked to a customer record; name alone is not confirmation'
                              : 'Unlinked — same-name candidate only'}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={dupInvConfirmed}
                      onChange={e => setDupInvConfirmed(e.target.checked)}
                      className="h-4 w-4 rounded border-amber-400 text-amber-600"
                    />
                    <span className="text-xs font-medium text-amber-700">I understand — create a new invoice anyway</span>
                  </label>
                </div>
              );
            })()}

            {(() => {
              if (!newInvoiceForm.claim_number || !String(newInvoiceForm.claim_number).trim()) return null;
              const claimDupes = findInvoicesByClaimNumber(allInvoices, newInvoiceForm.claim_number);
              if (claimDupes.length === 0) return null;
              return (
                <div className="bg-red-50 border border-red-300 rounded-lg p-3 text-sm text-red-800">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <span className="flex-1 font-semibold">
                      Claim #{newInvoiceForm.claim_number} is already on {claimDupes.length} invoice{claimDupes.length > 1 ? 's' : ''}:
                    </span>
                  </div>
                  <ul className="mt-1 ml-6 space-y-0.5">
                    {claimDupes.map(inv => (
                      <li key={inv.id}>
                        <button
                          type="button"
                          className="font-medium text-red-700 underline hover:text-red-900"
                          onClick={() => { setShowCreateDialog(false); navigate(createPageUrl('Invoices') + '?search=' + encodeURIComponent(inv.invoice_number)); }}
                        >
                          {inv.invoice_number}
                        </button>
                        {' '}— {inv.customer_name} ${(Number(inv.total_amount || inv.amount) || 0).toFixed(2)} ({inv.status})
                      </li>
                    ))}
                  </ul>
                  <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={dupClaimConfirmed}
                      onChange={e => setDupClaimConfirmed(e.target.checked)}
                      className="h-4 w-4 rounded border-red-400 text-red-600"
                    />
                    <span className="text-xs font-medium text-red-700">I understand — this is a separate invoice for the same claim</span>
                  </label>
                </div>
              );
            })()}

            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <Label htmlFor="customer_name">{t.invoices.customer} *</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowCreateCustomerPicker(true)}
                  data-testid="button-select-invoice-customer"
                >
                  {newInvoiceForm.customer_id ? 'Change linked customer' : 'Choose existing customer'}
                </Button>
              </div>
              {newInvoiceForm.customer_id && (
                <p className="mb-2 text-xs text-green-700" data-testid="text-linked-invoice-customer">
                  Linked to {getCompanyCustomerById(customers, newInvoiceForm.customer_id, myCompany?.id)?.name || 'selected customer'}.
                  Editing the name below will clear this link.
                </p>
              )}
              <Input
                id="customer_name"
                value={newInvoiceForm.customer_name}
                onChange={(e) => {
                  const value = e.target.value;
                  setDismissInvoiceDuplicateWarning(false);
                  setNewInvoiceForm((previous) => changeInvoiceCustomerName(previous, value));
                }}
                placeholder={t.invoices.customer}
                required
              />
              <p className="mt-1 text-xs text-gray-500">
                Choosing an existing customer links this invoice. A name typed here stays unlinked.
              </p>
            </div>

            <div>
              <Label htmlFor="customer_email">{t.invoices.email}</Label>
              <Input
                id="customer_email"
                type="email"
                value={newInvoiceForm.customer_email}
                onChange={(e) => setNewInvoiceForm({...newInvoiceForm, customer_email: e.target.value})}
                placeholder="customer@example.com"
              />
            </div>

            <div>
              <Label htmlFor="amount">{t.invoices.amount} *</Label>
              <Input
                id="amount"
                type="text"
                value={newInvoiceForm.amount}
                onChange={(e) => {
                  const value = e.target.value.replace(/[^0-9.]/g, '');
                  setNewInvoiceForm({...newInvoiceForm, amount: value});
                }}
                placeholder="0.00"
                required
              />
              {(() => {
                if (!newInvoiceForm.customer_name || !newInvoiceForm.amount) return null;
                const resolved = resolveCustomerBilling(newInvoiceForm.customer_id);
                if (!resolved?.billing) return null;
                const { baseEstimate, billing } = resolved;
                return (
                  <div className="text-xs text-blue-600 mt-1 space-y-0.5" data-testid="text-invoice-autofill">
                    <p>Auto-filled from estimate {baseEstimate.estimate_number || ''} ({formatCents(billing.baseCents)})</p>
                    {billing.changeOrders.map((row) => (
                      <p key={row.changeOrder.id} className="text-purple-600" data-testid={`text-invoice-change-order-${row.changeOrder.id}`}>
                        + approved change order {row.changeOrder.estimate_number || ''} ({formatCentsSigned(row.deltaCents)})
                      </p>
                    ))}
                    {billing.changeOrders.length > 0 && (
                      <p className="font-semibold text-gray-700">Total {formatCents(billing.totalCents)}</p>
                    )}
                  </div>
                );
              })()}
            </div>

            <div>
              <Label htmlFor="due_date">{t.invoices.dueDate}</Label>
              <Input
                id="due_date"
                type="date"
                value={newInvoiceForm.due_date}
                onChange={(e) => setNewInvoiceForm({...newInvoiceForm, due_date: e.target.value})}
              />
            </div>

            <div>
              <Label htmlFor="notes">{t.invoices.notes}</Label>
              <Textarea
                id="notes"
                value={newInvoiceForm.notes}
                onChange={(e) => setNewInvoiceForm({...newInvoiceForm, notes: e.target.value})}
                placeholder={t.invoices.notes}
                rows={3}
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={handleClose} className="w-full sm:w-auto">
                {t.common.cancel}
              </Button>
              <Button 
                type="submit"
                disabled={createInvoiceMutation.isPending || !newInvoiceForm.customer_name || !newInvoiceForm.amount || parseFloat(newInvoiceForm.amount) <= 0 || (() => {
                  const selectedCustomer = getCompanyCustomerById(customers, newInvoiceForm.customer_id, myCompany?.id);
                  const unpaid = findUnpaidInvoicesForCustomer(allInvoices, newInvoiceForm.customer_name, selectedCustomer?.id);
                  if (unpaid.length > 0 && !dupInvConfirmed) return true;
                  const claimDupes = findInvoicesByClaimNumber(allInvoices, newInvoiceForm.claim_number);
                  if (claimDupes.length > 0 && !dupClaimConfirmed) return true;
                  return false;
                })()}
                className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createInvoiceMutation.isPending ? t.common.loading : t.invoices.createInvoice}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <CustomerIdentityPickerDialog
        open={showCreateCustomerPicker}
        onOpenChange={setShowCreateCustomerPicker}
        customers={filteredCustomers}
        selectedCustomerId={newInvoiceForm.customer_id}
        onSelect={handleCreateCustomerSelect}
        title="Select the invoice customer"
        description="Choose the existing customer record to link. Name, email, phone, and address are shown to distinguish people with the same name."
      />

      <CustomerIdentityPickerDialog
        open={showLinkCustomerPicker}
        onOpenChange={setShowLinkCustomerPicker}
        customers={filteredCustomers}
        onSelect={handleLinkCustomerSelection}
        title="Choose who this invoice belongs to"
        description="Search by name, email, phone, or address. The invoice is not changed until you confirm. Confirming sets the customer id and copies the customer's name and email."
      />

      <AlertDialog
        open={showLinkCustomerConfirm}
        onOpenChange={setShowLinkCustomerConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm invoice customer</AlertDialogTitle>
            <AlertDialogDescription>
              This sets the invoice customer id to the selected record and copies that customer's name and email. Amount and status stay the same.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {linkInvoiceTarget && linkCustomerCandidate && (
            <div className="space-y-3 rounded-md border bg-gray-50 p-3 text-sm">
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">Invoice</p>
                <p className="font-semibold text-gray-900">
                  {linkInvoiceTarget.invoice_number} — {linkInvoiceTarget.customer_name}
                </p>
                <p className="text-gray-600">
                  ${getInvoiceTrueTotal(linkInvoiceTarget).toFixed(2)} · {linkInvoiceTarget.status || 'draft'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">Link to this customer</p>
                <p className="font-semibold text-gray-900">{linkCustomerCandidate.name}</p>
                <p className="break-words text-gray-600">
                  {[
                    linkCustomerCandidate.customer_number != null ? `Customer #${linkCustomerCandidate.customer_number}` : '',
                    linkCustomerCandidate.email,
                    linkCustomerCandidate.phone || linkCustomerCandidate.phone_2,
                    linkCustomerCandidate.street || linkCustomerCandidate.address,
                    linkCustomerCandidate.city,
                    linkCustomerCandidate.state,
                    linkCustomerCandidate.zip,
                  ].filter(Boolean).join(' · ') || 'No additional contact details'}
                </p>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={linkUnassignedInvoiceMutation.isPending}>Cancel</AlertDialogCancel>
            <Button
              onClick={() => {
                if (!linkInvoiceTarget || !linkCustomerCandidate || !myCompany?.id) return;
                linkUnassignedInvoiceMutation.mutate({
                  invoiceId: linkInvoiceTarget.id,
                  customerId: linkCustomerCandidate.id,
                });
              }}
              disabled={
                !linkInvoiceTarget ||
                !linkCustomerCandidate ||
                linkUnassignedInvoiceMutation.isPending
              }
              data-testid="button-confirm-link-invoice-customer"
            >
              {linkUnassignedInvoiceMutation.isPending ? 'Linking…' : 'Confirm link'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showBatchPaymentsDialog} onOpenChange={setShowBatchPaymentsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.invoices.recordPayment}</DialogTitle>
            <DialogDescription>
              Mark {selectedInvoices.length} {t.invoices.title} {t.common.paid}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              You have selected {selectedInvoices.length} {t.invoices.title}. Click {t.common.confirm} to mark all of them as {t.common.paid}.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowBatchPaymentsDialog(false)}>
                {t.common.cancel}
              </Button>
              <Button
                onClick={() => batchPaymentMutation.mutate()}
                disabled={batchPaymentMutation.isPending}
                className="bg-green-600 hover:bg-green-700"
              >
                {batchPaymentMutation.isPending ? t.common.loading : t.common.confirm}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Payment Reminder Dialog */}
      <Dialog open={reminderDialog} onOpenChange={(open) => { if (!open) { setReminderDialog(false); setReminderInvoice(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-amber-500" />
              Send Payment Reminder
            </DialogTitle>
            <DialogDescription>
              {reminderInvoice && (
                <span>
                  Invoice <strong>{reminderInvoice.invoice_number}</strong> — {reminderInvoice.customer_name} —{' '}
                  <strong className="text-red-600">
                    ${getInvoiceBalance(reminderInvoice).toFixed(2)} due
                  </strong>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Channel selector */}
            <div>
              <Label className="text-sm font-medium mb-2 block">Send via</Label>
              <div className="flex gap-2">
                {[
                  { value: 'email', icon: <Mail className="w-4 h-4" />, label: 'Email' },
                  { value: 'sms',   icon: <MessageSquare className="w-4 h-4" />, label: 'SMS' },
                  { value: 'both',  icon: <Bell className="w-4 h-4" />, label: 'Both' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setReminderChannel(opt.value)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md border text-sm font-medium transition-colors ${
                      reminderChannel === opt.value
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                    data-testid={`reminder-channel-${opt.value}`}
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Email field */}
            {(reminderChannel === 'email' || reminderChannel === 'both') && (
              <div>
                <Label htmlFor="reminder-email">Customer Email</Label>
                <Input
                  id="reminder-email"
                  type="email"
                  value={reminderEmail}
                  onChange={e => setReminderEmail(e.target.value)}
                  placeholder="customer@example.com"
                  data-testid="input-reminder-email"
                />
                {!reminderEmail && (
                  <p className="text-xs text-red-500 mt-1">Email is required to send via email</p>
                )}
              </div>
            )}

            {/* Phone field */}
            {(reminderChannel === 'sms' || reminderChannel === 'both') && (
              <div>
                <Label htmlFor="reminder-phone">Customer Phone (for SMS)</Label>
                <Input
                  id="reminder-phone"
                  type="tel"
                  value={reminderPhone}
                  onChange={e => setReminderPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  data-testid="input-reminder-phone"
                />
                {!reminderPhone && (
                  <p className="text-xs text-red-500 mt-1">Phone number is required to send via SMS</p>
                )}
              </div>
            )}

            {/* Optional custom note */}
            <div>
              <Label htmlFor="reminder-note">Custom message <span className="text-gray-400 font-normal">(optional)</span></Label>
              <Textarea
                id="reminder-note"
                value={reminderNote}
                onChange={e => setReminderNote(e.target.value)}
                placeholder="Leave blank to use the default reminder message…"
                rows={3}
                data-testid="input-reminder-note"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setReminderDialog(false); setReminderInvoice(null); }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={
                  sendReminderMutation.isPending ||
                  ((reminderChannel === 'email' || reminderChannel === 'both') && !reminderEmail) ||
                  ((reminderChannel === 'sms'   || reminderChannel === 'both') && !reminderPhone)
                }
                onClick={() => sendReminderMutation.mutate({ invoice: reminderInvoice, email: reminderEmail, phone: reminderPhone, channel: reminderChannel, note: reminderNote })}
                className="bg-amber-500 hover:bg-amber-600 text-white"
                data-testid="btn-send-reminder"
              >
                {sendReminderMutation.isPending ? (
                  <span className="flex items-center gap-1.5">
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Sending…
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Bell className="w-4 h-4" />
                    Send Reminder
                  </span>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Invoice Confirmation Dialog */}
      <Dialog open={showDeleteInvoiceDialog} onOpenChange={(open) => {
        setShowDeleteInvoiceDialog(open);
        if (!open) setDeleteInvoiceTarget(null);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Delete Invoice
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {deleteInvoiceTarget && (
              <p className="text-sm text-gray-600">
                Are you sure you want to delete invoice <strong>{deleteInvoiceTarget.invoice_number}</strong>?
                <br />
                Customer: {deleteInvoiceTarget.customer_name}
                <br />
                Amount: ${deleteInvoiceTarget.total_amount}
                <br />
                <span className="font-semibold text-red-600">This action CANNOT be undone!</span>
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                data-testid="button-cancel-delete-invoice"
                onClick={() => {
                  setShowDeleteInvoiceDialog(false);
                  setDeleteInvoiceTarget(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                data-testid="button-confirm-delete-invoice"
                disabled={deleteInvoiceMutation.isPending}
                onClick={() => {
                  if (!deleteInvoiceTarget) return;
                  const invoiceId = deleteInvoiceTarget.id;
                  setShowDeleteInvoiceDialog(false);
                  setDeleteInvoiceTarget(null);
                  deleteInvoiceMutation.mutate(invoiceId);
                }}
              >
                {deleteInvoiceMutation.isPending ? 'Deleting...' : 'Yes, Delete Invoice'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Send Invoice Confirmation Dialog */}
      <Dialog open={showSendInvoiceDialog} onOpenChange={(open) => {
        setShowSendInvoiceDialog(open);
        if (!open) setSendInvoiceTarget(null);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Invoice</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {sendInvoiceTarget && (
              <p className="text-sm text-gray-600">
                Send invoice <strong>{sendInvoiceTarget.invoice_number}</strong> to{' '}
                <strong>{sendInvoiceTarget.customer_email}</strong>?
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                data-testid="button-cancel-send-invoice"
                onClick={() => {
                  setShowSendInvoiceDialog(false);
                  setSendInvoiceTarget(null);
                }}
              >
                Cancel
              </Button>
              <Button
                data-testid="button-confirm-send-invoice"
                disabled={sendInvoiceMutation.isPending}
                onClick={() => {
                  if (!sendInvoiceTarget) return;
                  const invoice = sendInvoiceTarget;
                  setShowSendInvoiceDialog(false);
                  setSendInvoiceTarget(null);
                  sendInvoiceMutation.mutate(invoice);
                }}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {sendInvoiceMutation.isPending ? 'Sending...' : 'Yes, Send Invoice'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Batch Delete Invoices Confirmation Dialog */}
      <Dialog open={showBatchDeleteDialog} onOpenChange={setShowBatchDeleteDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Delete {selectedInvoices.length} Invoices
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-600">
              Are you sure you want to delete {selectedInvoices.length} selected invoice(s)?{' '}
              <span className="font-semibold text-red-600">This action CANNOT be undone!</span>
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                data-testid="button-cancel-batch-delete-invoices"
                onClick={() => setShowBatchDeleteDialog(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                data-testid="button-confirm-batch-delete-invoices"
                disabled={batchDeleteMutation.isPending}
                onClick={() => {
                  setShowBatchDeleteDialog(false);
                  batchDeleteMutation.mutate();
                }}
              >
                {batchDeleteMutation.isPending ? 'Deleting...' : `Yes, Delete ${selectedInvoices.length} Invoices`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Fix Invoice Statuses Confirmation Dialog */}
      <Dialog open={showFixStatusesDialog} onOpenChange={setShowFixStatusesDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Fix Invoice Statuses</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-600">
              {t.common.status === 'sent'
                ? 'Recalculate all invoice statuses based on payment amounts? This will fix any out-of-sync invoices.'
                : '¿Recalcular todos los estados de las facturas en función de los importes de los pagos? Esto corregirá cualquier factura desincronizada.'}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                data-testid="button-cancel-fix-statuses"
                onClick={() => setShowFixStatusesDialog(false)}
              >
                Cancel
              </Button>
              <Button
                data-testid="button-confirm-fix-statuses"
                className="bg-orange-600 hover:bg-orange-700"
                onClick={async () => {
                  setShowFixStatusesDialog(false);
                  const loadingToast = toast.loading(t.common.loading);
                  try {
                    const result = await base44.functions.invoke('fixInvoiceStatuses');
                    toast.dismiss(loadingToast);
                    if (result.data.success) {
                      toast.success(t.common.status === 'sent' ? `✅ Fixed ${result.data.fixed_count} invoices! (${result.data.already_correct} already correct)` : `✅ ¡Se corrigieron ${result.data.fixed_count} facturas! (${result.data.already_correct} ya estaban correctas)`);
                      queryClient.invalidateQueries({ queryKey: ['invoices'] });
                    } else {
                      toast.error(t.common.status === 'sent' ? 'Fix failed' : 'Error al corregir');
                    }
                  } catch (error) {
                    toast.dismiss(loadingToast);
                    toast.error((t.common.status === 'sent' ? 'Fix failed: ' : 'Error al corregir: ') + error.message);
                  }
                }}
              >
                Yes, Fix Statuses
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Provider submission is not a delivery or read receipt. */}
      <Dialog open={showInvoiceSentDialog} onOpenChange={setShowInvoiceSentDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle className="w-5 h-5" />
              Invoice Email Submitted
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-600">
              Email submitted for {invoiceSentEmail}. Delivery is not yet confirmed; check the invoice's delivery history.
            </p>
            <div className="flex justify-end pt-1">
              <Button
                data-testid="button-close-invoice-sent"
                onClick={() => setShowInvoiceSentDialog(false)}
              >
                OK
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}