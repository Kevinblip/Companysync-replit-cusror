import React from "react";
import { base44 } from "@/api/base44Client";
import { BulkDeleteButton } from "@/components/BulkDeleteControls";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TablePageSkeleton } from "@/components/PageSkeleton";
import { useRoleBasedData } from "../components/hooks/useRoleBasedData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useTranslation from "@/hooks/useTranslation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DollarSign,
  CreditCard,
  TrendingUp,
  RefreshCw,
  Columns3,
  Download,
  Search,
  Plus,
  Loader2,
  Check,
  ChevronsUpDown,
  Trash2,
  Pencil,
  AlertTriangle,
  ExternalLink,
  Upload,
} from "lucide-react";
import { format } from "date-fns";
import { useNavigate, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { isPaymentCreateBlocked, isPaymentEditBlocked, getPaidInvoiceDeleteWarning, getBulkPaidInvoiceDeleteWarnings, findDuplicatePayment } from "@/utils/paymentGuards";
import { getQBPaymentUrl, QB_MANUAL_SENTINEL } from "@/utils/quickbooksUtils";
import { localToday } from "@/utils/localDate";
import { parsePaymentDate, paymentDateInput, paymentIsInPeriod } from "@/utils/paymentDates";
import { pickInvoiceForPayment, makeInvoiceMatcher } from "@/utils/paymentOwnership";
import { reverseStandaloneDeduction } from "@/utils/standaloneDeduction";
import { getAddressSearchText } from "@/utils/addressSearch";

export default function Payments() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  
  // 🔐 Use centralized role-based data hook
  const { 
    user, 
    myCompany, 
    myStaffProfile, 
    isAdmin, 
    hasPermission,
    filterPayments 
  } = useRoleBasedData();

  const [itemsPerPage, setItemsPerPage] = React.useState(25);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [qbBannerDismissed, setQbBannerDismissed] = React.useState(() => sessionStorage.getItem('qb-reconnect-banner-dismissed') === '1');
  
  // Initialize search term from URL query param if present
  const searchParams = new URLSearchParams(location.search);
  const [searchTerm, setSearchTerm] = React.useState(searchParams.get("search") || "");
  const [periodFilter, setPeriodFilter] = React.useState("this_month");
  const [showAddPayment, setShowAddPayment] = React.useState(false);
  const [paymentForm, setPaymentForm] = React.useState({
    customer_name: "",
    customer_email: "", // NEW: Added customer_email to form state
    amount: "",
    payment_method: "cash",
    payment_date: format(new Date(), 'yyyy-MM-dd'), // 🔥 FIX: Use date-fns format to avoid timezone offset
    invoice_number: "",
    reference_number: "",
    notes: "",
    send_receipt: true
  });

  const [selectedPayments, setSelectedPayments] = React.useState([]);

  const [visibleColumns, setVisibleColumns] = React.useState({
    select: true,
    payment_number: true,
    customer: true,
    invoice: true,
    amount: true,
    method: true,
    status: true,
    date: true,
    actions: true,
  });

  const [customerSearchOpen, setCustomerSearchOpen] = React.useState(false);
  const [showEditPaymentDialog, setShowEditPaymentDialog] = React.useState(false);
  const [showDeleteConfirmDialog, setShowDeleteConfirmDialog] = React.useState(false);
  const [deleteConfirmPayment, setDeleteConfirmPayment] = React.useState(null);
  const [deleteConfirmInvoiceInfo, setDeleteConfirmInvoiceInfo] = React.useState(null);
  const [showBulkDeleteConfirmDialog, setShowBulkDeleteConfirmDialog] = React.useState(false);
  const [bulkDeleteAffectedInvoices, setBulkDeleteAffectedInvoices] = React.useState([]);
  const [showDuplicatePaymentDialog, setShowDuplicatePaymentDialog] = React.useState(false);
  const [duplicatePaymentInfo, setDuplicatePaymentInfo] = React.useState(null);
  const [pendingPaymentData, setPendingPaymentData] = React.useState(null);
  const [showSimpleDeletePaymentDialog, setShowSimpleDeletePaymentDialog] = React.useState(false);
  const [simpleDeleteConfirmPayment, setSimpleDeleteConfirmPayment] = React.useState(null);
  const [showSimpleBulkDeleteDialog, setShowSimpleBulkDeleteDialog] = React.useState(false);
  const [editPaymentForm, setEditPaymentForm] = React.useState({
    id: null,
    amount: "",
    payment_method: "cash",
    payment_date: format(new Date(), 'yyyy-MM-dd'),
    invoice_number: "",
    reference_number: "",
    notes: "",
    _originalInvoiceNumber: "",
    _originalAmount: ""
  });

  React.useEffect(() => {
    const params = new URLSearchParams(location.search);
    const search = params.get("search");
    if (search !== null) {
      setSearchTerm(search);
    }
  }, [location.search]);

  const { data: allCustomers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Customer.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
  });

  const customers = allCustomers;

  const { data: allPayments = [], isLoading: isLoadingPayments } = useQuery({
    queryKey: ['payments', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Payment.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany?.id,
  });

  // 🔐 Filter payments based on role permissions
  const payments = React.useMemo(() => {
    if (!user?.email) return allPayments;
    if (isAdmin) return allPayments;
    // Non-admins see only payments for their own assigned or created customers
    return allPayments.filter(payment => {
      const customer = customers.find(c => c.name === payment.customer_name);
      if (!customer) return false;
      return (
        customer.assigned_to === user.email ||
        customer.assigned_to_users?.includes(user.email) ||
        customer.created_by === user.email
      );
    });
  }, [allPayments, isAdmin, user?.email, customers]);

  const { data: invoices = [], isLoading: isLoadingInvoices } = useQuery({
    queryKey: ['invoices', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Invoice.filter({ company_id: myCompany.id }) : [],
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

  const buildQBPaymentUrl = (qbPaymentId) =>
    getQBPaymentUrl(qbStatus?.realm_id, qbPaymentId, qbStatus?.sandbox ?? false);

  const filteredPayments = React.useMemo(() => {
    return payments.filter(payment => {
      const matchesSearch = !searchTerm || 
        payment.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        payment.payment_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        payment.invoice_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        getAddressSearchText(
          payment,
          customers.find(customer =>
            (payment.customer_id && customer.id === payment.customer_id) ||
            (payment.customer_name &&
              String(customer.name || '').trim().toLowerCase() === String(payment.customer_name).trim().toLowerCase())
          )
        ).includes(searchTerm.toLowerCase().trim());
      
      const matchesPeriod = paymentIsInPeriod(payment.payment_date, periodFilter);
      
      return matchesSearch && matchesPeriod;
    });
  }, [payments, customers, searchTerm, periodFilter]);

  // A payment is "unlinked" when it has no invoice_id — that's the field invoice
  // balances are calculated from (invoice_number is just a display label).
  const isUnlinked = (p) => (!p.invoice_id || String(p.invoice_id).trim() === '') && (!p.invoice_number || p.invoice_number.trim() === '');
  const unlinkedPayments = React.useMemo(() => {
    return payments.filter(isUnlinked);
  }, [payments]);
  const customerHasInvoice = React.useCallback((payment) => {
    const paymentName = payment.customer_name?.trim().toLowerCase();
    return invoices.some(invoice =>
      (payment.customer_id && invoice.customer_id === payment.customer_id) ||
      (paymentName && invoice.customer_name?.trim().toLowerCase() === paymentName)
    );
  }, [invoices]);
  const canCreateInvoiceFromPayment = React.useCallback((payment) => {
    const status = String(payment.status || 'received').toLowerCase();
    return !isLoadingInvoices
      && ['received', 'completed'].includes(status)
      && Number(payment.amount) > 0
      && !customerHasInvoice(payment);
  }, [customerHasInvoice, isLoadingInvoices]);

  const totalReceived = React.useMemo(() => {
    return filteredPayments.filter(p => p.status === 'received').reduce((sum, p) => sum + Number(p.amount || 0), 0);
  }, [filteredPayments]);

  const unlinkedReceivedTotal = React.useMemo(() => {
    return filteredPayments
      .filter(p => p.status === 'received' && isUnlinked(p))
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  }, [filteredPayments]);

  const pendingAmount = React.useMemo(() => {
    return filteredPayments.filter(p => p.status === 'pending').reduce((sum, p) => sum + Number(p.amount || 0), 0);
  }, [filteredPayments]);

  const getStatusColor = (status) => {
    const colors = {
      'received': 'bg-green-100 text-green-700 border-green-200',
      'pending': 'bg-yellow-100 text-yellow-700 border-yellow-200',
      'failed': 'bg-red-100 text-red-700 border-red-200',
      'refunded': 'bg-gray-100 text-gray-700 border-gray-200'
    };
    return colors[status] || colors.pending;
  };

  const getMethodIcon = (method) => {
    if (method?.includes('card')) return CreditCard;
    return DollarSign;
  };

  const generateNextPaymentNumber = () => {
    if (payments.length === 0) {
      return "PAY-2025-0001";
    }
    
    const numbers = payments
      .map(p => p.payment_number)
      .filter(num => num && num.startsWith('PAY-'))
      .map(num => parseInt(num.replace(/PAY-\d{4}-|[^\d]/g, '')))
      .filter(num => !isNaN(num));
    
    if (numbers.length === 0) {
      return "PAY-2025-0001";
    }
    
    const maxNumber = Math.max(...numbers);
    const nextNumber = maxNumber + 1;
    return `PAY-2025-${nextNumber.toString().padStart(4, '0')}`;
  };

  const createPaymentMutation = useMutation({
    mutationFn: async (paymentData) => {
      console.log('🔵 Starting payment creation...');
      const paymentNumber = generateNextPaymentNumber();

      // Resolve which invoice this payment is really for. Invoice numbers are not
      // unique, so taking the first match here would happily file the money under
      // an unrelated customer.
      let resolvedInvoice = null;
      if (paymentData.invoice_number && paymentData.invoice_number !== 'none') {
        const invoiceList = await base44.entities.Invoice.filter({
          invoice_number: paymentData.invoice_number,
          company_id: myCompany?.id,
        });
        const picked = pickInvoiceForPayment(invoiceList, {
          customerName: paymentData.customer_name,
          customerId: paymentData.customer_id,
        });
        if (picked.ambiguous) {
          throw new Error(
            `${picked.candidateCount} different invoices are numbered ${paymentData.invoice_number}, so this payment can't be filed safely. Open the correct invoice and record the payment from there.`
          );
        }
        resolvedInvoice = picked.invoice;
      }
      const resolvedInvoiceId = resolvedInvoice?.id || null;
      const paymentForInvoice = resolvedInvoiceId
        ? {
            invoice_id: resolvedInvoiceId,
            invoice_number: resolvedInvoice.invoice_number || paymentData.invoice_number,
            customer_id: resolvedInvoice.customer_id || paymentData.customer_id || null,
            customer_name: resolvedInvoice.customer_name || paymentData.customer_name || '',
            customer_email: resolvedInvoice.customer_email || paymentData.customer_email || '',
          }
        : {};

      const newPayment = await base44.entities.Payment.create({
        ...paymentData,
        payment_number: paymentNumber,
        company_id: myCompany?.id,
        status: 'received',
        ...paymentForInvoice,
      });
      console.log('✅ Payment created:', newPayment.payment_number);

      // Recalculate invoice amount_paid from all linked payments (reliable, prevents drift).
      // Always by id — a number-keyed recalc hits whichever duplicate comes back first.
      if (resolvedInvoiceId) {
        try {
          await base44.functions.invoke('recalculateInvoicePayments', {
            invoice_id: resolvedInvoiceId,
          });
          console.log(`✅ Invoice ${paymentData.invoice_number} amount_paid recalculated`);
        } catch (error) {
          console.error('⚠️ Invoice recalculation failed:', error);
        }
      }

      // 🔥 TRIGGER COMMISSION UPDATE
      if (resolvedInvoice) {
        try {
          {
            const invoice = resolvedInvoice;

            // Update commission for all reps on this invoice
            const salesRepEmails = invoice.commission_splits?.map(cs => cs.user_email) ||
                                   (invoice.sale_agent ? [invoice.sale_agent] : []);

            if (salesRepEmails.length > 0) {
              for (const salesRepEmail of salesRepEmails) {
                await base44.functions.invoke('updateCommissions', {
                  paymentId: newPayment.id,
                  invoiceId: invoice.id,
                  amount: paymentData.amount,
                  salesRepEmail: salesRepEmail
                });
                console.log('✅ Commission updated for:', salesRepEmail);
              }
            }
          }
        } catch (commError) {
          console.error('⚠️ Commission update failed (non-critical):', commError);
        }
      }

      // 🔔 Send unified notifications to staff
      let notificationResult = { successCount: 0, errorCount: 0, errors: [] };
      try {
        const response = await base44.functions.invoke('universalNotificationDispatcher', {
          action: 'create',
          entityType: 'Payment',
          entityId: newPayment.id,
          entityData: newPayment,
          companyId: myCompany.id
        });
        notificationResult = response.data;
      } catch (error) {
        console.error('Notification dispatcher failed:', error);
        notificationResult.errors.push(error.message);
      }

      // 💌 Send receipt to customer using sendEmailFromCRM (supports external emails)
      let customerReceiptSent = false;
      if (myCompany?.id && newPayment.customer_email && paymentData.send_receipt) {
        try {
          await base44.functions.invoke('sendEmailFromCRM', {
            to: newPayment.customer_email,
            subject: `Payment Receipt - $${Number(newPayment.amount || 0).toFixed(2)}`,
            html: `<h2>Payment Received - Thank You!</h2>
              <p>Dear ${newPayment.customer_name},</p>
              <p>We have received your payment. Here are the details:</p>
              <p><strong>Amount:</strong> $${Number(newPayment.amount || 0).toFixed(2)}</p>
              <p><strong>Payment Date:</strong> ${format(parsePaymentDate(newPayment.payment_date), 'MMM d, yyyy')}</p>
              <p><strong>Payment Method:</strong> ${newPayment.payment_method}</p>
              ${newPayment.invoice_number ? `<p><strong>Invoice:</strong> ${newPayment.invoice_number}</p>` : ''}
              ${newPayment.reference_number ? `<p><strong>Reference:</strong> ${newPayment.reference_number}</p>` : ''}
              <p>Thank you for your business!</p>
              <p>Best regards,<br/>${myCompany.company_name || 'Your Team'}</p>`,
            companyId: myCompany.id
          });
          customerReceiptSent = true;
        } catch (error) {
          console.error('Failed to send payment receipt to customer:', error);
          notificationResult.errors.push(`Customer receipt failed: ${error.message}`);
        }
      }

      // Trigger workflows
      try {
        await base44.functions.invoke('triggerWorkflow', {
          triggerType: 'payment_received',
          companyId: myCompany.id,
          entityType: 'Payment',
          entityId: newPayment.id,
          entityData: {
            payment_number: newPayment.payment_number,
            customer_name: newPayment.customer_name,
            customer_email: newPayment.customer_email || '',
            amount: newPayment.amount,
            payment_method: newPayment.payment_method,
            invoice_number: newPayment.invoice_number,
            payment_date: newPayment.payment_date,
            app_url: window.location.origin
          }
        });
        console.log('✅ Workflow triggered');
      } catch (error) {
        console.error('Workflow failed:', error);
      }

      // 👨‍👩‍👧‍👦 TRIGGER FAMILY COMMISSION DISTRIBUTION
      try {
        console.log('🔔 Triggering family commission for payment:', newPayment.id, 'Company:', myCompany.id);
        const commissionResult = await base44.functions.invoke('distributeFamilyCommission', {
          payment_id: newPayment.id,
          company_id: myCompany.id
        });
        console.log('✅ Family commission result:', commissionResult.data);
      } catch (error) {
        console.error('⚠️ Family commission failed:', error);
        console.error('Error details:', error.message, error.stack);
      }

      return { 
        newPayment, 
        notificationsSent: notificationResult.successCount, 
        emailsSent: notificationResult.successCount,
        errors: notificationResult.errors || [], 
        totalRecipients: notificationResult.successCount, 
        customerReceiptSent 
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice'] }); // Also invalidate singular invoice detail queries
      queryClient.invalidateQueries({ queryKey: ['staff-profiles'] }); // Refresh commission data
      setShowAddPayment(false); // Matches setShowDialog from outline
      setPaymentForm({ // Matches setFormData from outline
        customer_name: "",
        customer_email: "", // NEW: Reset customer_email
        amount: "",
        payment_method: "cash",
        payment_date: format(new Date(), 'yyyy-MM-dd'), // 🔥 FIX: Use date-fns format to avoid timezone offset
        invoice_number: "",
        reference_number: "",
        notes: "",
        send_receipt: true
      });
      
      let toastMessage = `Payment recorded! Sent ${result.notificationsSent} bell notifications and ${result.emailsSent} emails to ${result.totalRecipients} people.`;
      if (result.customerReceiptSent) {
        toastMessage += ` Customer receipt sent.`;
      }
      toast.success(toastMessage, {
        duration: 5000
      });

      if (result.errors.length > 0) {
        console.error('Notification errors:', result.errors);
        toast.error(`Some notifications failed. Check console.`, { duration: 3000 });
      }
    },
    onError: (error) => {
      if (error?.__cancelled) return;
      console.error('Payment creation error:', error);
      toast.error(`Failed to record payment: ${error.message}`);
    }
  });

  const updatePaymentMutation = useMutation({
    mutationFn: async () => {
      if (!editPaymentForm.id) throw new Error('No payment selected');
      const unsupported = ['cash_app','zelle','venmo'];
      const mapped = unsupported.includes(editPaymentForm.payment_method) ? 'other' : editPaymentForm.payment_method;
      const finalNotes = unsupported.includes(editPaymentForm.payment_method)
        ? (editPaymentForm.notes ? `${editPaymentForm.notes} | Recorded via ${editPaymentForm.payment_method.replace('_',' ')}` : `Recorded via ${editPaymentForm.payment_method.replace('_',' ')}`)
        : editPaymentForm.notes;

      // Resolve invoice_id when linking to an invoice
      const originalInvoiceId = editPaymentForm.invoice_id || null;
      const newInvoiceNumber = (editPaymentForm.invoice_number || '').trim();
      let resolvedInvoiceId = null;
      if (newInvoiceNumber) {
        const invoiceList = await base44.entities.Invoice.filter({
          invoice_number: newInvoiceNumber,
          company_id: myCompany?.id,
        });
        const picked = pickInvoiceForPayment(invoiceList, {
          customerName: editPaymentForm.customer_name,
          customerId: editPaymentForm.customer_id,
        });
        if (picked.ambiguous) {
          throw new Error(
            `${picked.candidateCount} different invoices are numbered ${newInvoiceNumber}, so this payment can't be linked safely. Open the correct invoice and link it from there.`
          );
        }
        resolvedInvoiceId = picked.invoice?.id || null;
      }

      const updated = await base44.entities.Payment.update(editPaymentForm.id, {
        amount: parseFloat(editPaymentForm.amount),
        payment_method: mapped,
        payment_date: editPaymentForm.payment_date,
        reference_number: editPaymentForm.reference_number || '',
        notes: finalNotes,
        invoice_number: newInvoiceNumber,
        // Explicit, not spread-conditional: unlinking must clear the old id, or
        // the payment stays attached to an invoice it no longer names.
        invoice_id: resolvedInvoiceId,
      });
      // Recalculate BOTH ends. Moving a payment leaves the invoice it came from
      // still counting money that is no longer linked to it.
      for (const invoiceId of [...new Set([originalInvoiceId, resolvedInvoiceId].filter(Boolean))]) {
        try {
          await base44.functions.invoke('recalculateInvoicePayments', { invoice_id: invoiceId });
        } catch (_) {}
      }
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice'] });
      setShowEditPaymentDialog(false);
    },
    onError: (e) => {
      toast.error('Failed to update payment: ' + e.message);
    }
  });

  const fixPaymentsMutation = useMutation({
    mutationFn: async () => {
      if (!myCompany?.id) throw new Error('Company not loaded');
      const raw = await base44.functions.invoke('fixPaymentDataCorruption', { company_id: myCompany.id });
      const result = raw?.data ?? raw;
      if (!result?.success) throw new Error(result?.error || 'Fix failed');
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payments'] });
      const hadFixes = Array.isArray(result.changes) && result.changes.some(c => ['linked', 'relinked', 'backfilled_invoice_number', 'recalculated'].includes(c.action));
      const msg = result.summary || 'Payment data corrected successfully.';
      if (result.unfixable?.length > 0 && !hadFixes) {
        toast.warning(msg, { duration: 10000 });
      } else if (result.unfixable?.length > 0) {
        toast.info(msg, { duration: 10000 });
      } else {
        toast.success(msg, { duration: 6000 });
      }
    },
    onError: (e) => {
      toast.error('Fix failed: ' + e.message);
    }
  });

  const createInvoiceFromPaymentMutation = useMutation({
    mutationFn: async (payment) => {
      if (!myCompany?.id) throw new Error('Company not loaded');
      const raw = await base44.functions.invoke('createInvoiceFromUnlinkedPayment', {
        company_id: myCompany.id,
        payment_id: payment.id,
      });
      const result = raw?.data ?? raw;
      if (!result?.success) throw new Error(result?.error || 'Could not create invoice');
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payments'] });
      toast.success(`Created invoice ${result.invoice?.invoice_number || ''} and linked the payment.`, { duration: 6000 });
    },
    onError: (error) => {
      toast.error('Could not create invoice: ' + error.message);
    },
  });

  const deletePaymentMutation = useMutation({
    mutationFn: async (payment) => {
      console.log('🗑️ Deleting payment:', payment.payment_number);

      if (!myCompany?.id || payment.company_id !== myCompany.id) {
        throw new Error('Cannot delete a payment outside the active company.');
      }

      const invNumForRecalc = payment.invoice_number;
      // Never recalculate by number alone — the server resolves a number with
      // LIMIT 1, so a duplicate would rewrite a different customer's balance.
      // For legacy payments with no invoice_id, resolve the number to exactly one
      // invoice here or leave the balance alone and say so.
      const exactLinkedInvoice = payment.invoice_id
        ? invoices.find(i =>
            i.id === payment.invoice_id &&
            (!i.company_id || i.company_id === myCompany.id)
          )
        : null;
      const invIdForRecalc = exactLinkedInvoice?.id || (!payment.invoice_id && invNumForRecalc
        ? pickInvoiceForPayment(
            invoices.filter(i =>
              (!i.company_id || i.company_id === myCompany.id) &&
              (i.invoice_number || '').trim() === invNumForRecalc.trim()
            ),
            { customerName: payment.customer_name, customerId: payment.customer_id }
          ).invoice?.id || null
        : null);

      const reversal = await reverseStandaloneDeduction({ payment, companyId: myCompany.id, invoke: base44.functions.invoke });
      if (reversal.handled) {
        return { payment, recalcFailed: false, notificationsSent: 0, emailsSent: 0, totalAdmins: 0 };
      }

      if (payment.bulkDeletion) {
        await base44.entities.Payment.bulkDelete([payment.id]);
      } else {
        await base44.entities.Payment.delete(payment.id);
      }

      // Recompute the invoice from the SUM of its REMAINING payments (source of truth)
      // instead of subtracting this payment's amount. Subtracting (and the old check
      // against invoice.amount, a column that doesn't exist) drifted the balance/status.
      let recalcFailed = false;
      if (invIdForRecalc) {
        try {
          const response = await base44.functions.invoke('recalculateInvoicePayments', {
            invoice_id: invIdForRecalc
          });
          if (!response?.data?.success) throw new Error(response?.data?.error || 'Invoice recalculation failed.');
          console.log(`✅ Invoice ${invNumForRecalc || invIdForRecalc} recalculated after payment deletion`);
        } catch (error) {
          console.error('⚠️ Invoice recalculation after delete failed:', error);
          recalcFailed = true;
        }
      } else if (invNumForRecalc) {
        console.warn(`⚠️ Payment ${payment.id} named invoice ${invNumForRecalc} but it could not be pinned to a single invoice — balance left untouched.`);
        recalcFailed = true;
      }

      // Send notifications via universalNotificationDispatcher
      try {
        const response = await base44.functions.invoke('universalNotificationDispatcher', {
          action: 'delete',
          entityType: 'Payment',
          entityId: payment.id,
          entityData: payment,
          companyId: myCompany.id
        });
        console.log('✅ Notifications sent:', response.data);
        return { 
          payment,
          recalcFailed,
          notificationsSent: response.data.successCount,
          emailsSent: response.data.successCount,
          totalAdmins: response.data.successCount 
        };
      } catch (error) {
        console.error('Notification dispatcher failed:', error);
        return { payment, recalcFailed, notificationsSent: 0, emailsSent: 0, totalAdmins: 0 };
      }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payments'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      if (result.recalcFailed) {
        toast.warning('Payment and any matching fee-deduction expense were deleted, but the linked invoice balance could not be updated automatically. Please open the invoice and use "Sync Payments" to correct the balance.', { duration: 8000 });
      } else {
        toast.success(`Payment and any matching fee-deduction expense deleted. Sent ${result.emailsSent} email(s) to admins.`, { duration: 3000 });
      }
    },
    onError: (error) => {
      console.error('Delete error:', error);
      toast.error(`Failed to delete payment: ${error.message}`);
    }
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('syncPaymentsToInvoices');
      return response.data;
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      
      let ambiguousSkipped = 0;
      if (data.matchedPayments && data.matchedPayments.length > 0) {
        try {
          for (const match of data.matchedPayments) {
            const matchedPayment = payments.find(p => p.id === match.payment);
            const candidates = await base44.entities.Invoice.filter({
              invoice_number: match.invoice,
              company_id: myCompany?.id,
            });
            // Never take candidates[0]: a duplicated number would credit the
            // commission to whichever rep happens to be first in the result set.
            const picked = pickInvoiceForPayment(candidates, {
              customerName: matchedPayment?.customer_name,
              customerId: matchedPayment?.customer_id,
            });
            if (picked.ambiguous) {
              console.warn(`[Sync] Commission skipped for payment ${match.payment}: invoice ${match.invoice} matches ${picked.candidateCount} invoices.`);
              ambiguousSkipped++;
              continue;
            }
            const invoice = picked.invoice;
            if (invoice) {
              const salesRepEmails = invoice.commission_splits?.map(cs => cs.user_email) ||
                                   (invoice.sale_agent ? [invoice.sale_agent] : []);
              if (salesRepEmails.length > 0) {
                for (const salesRepEmail of salesRepEmails) {
                  await base44.functions.invoke('updateCommissions', {
                    paymentId: match.payment,
                    invoiceId: invoice.id,
                    amount: match.amount,
                    salesRepEmail: salesRepEmail
                  });
                }
              }
            }
          }
          queryClient.invalidateQueries({ queryKey: ['staff-profiles'] });
        } catch (commError) {
          console.error('Commission updates failed:', commError);
        }
      }
      
      toast.success(`Synced! Updated ${data.updated} invoices, matched ${data.matchedPayments?.length} payments.`);
      if (ambiguousSkipped > 0) {
        toast.warning(`${ambiguousSkipped} payment(s) name an invoice number that more than one invoice uses, so no commission was credited for them. Open each payment and link it to the right invoice.`, { duration: 10000 });
      }
    },
    onError: (error) => {
      toast.error(`Sync failed: ${error.message}`);
    }
  });

  const markQBManualMutation = useMutation({
    mutationFn: async ({ paymentId }) => {
      if (!myCompany?.id) throw new Error('No company');
      const res = await base44.functions.invoke('markPaymentQBManual', {
        companyId: myCompany.id,
        ...(paymentId ? { paymentId } : {}),
      });
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: (data, { paymentId }) => {
      queryClient.invalidateQueries({ queryKey: ['payments', myCompany?.id] });
      toast.success(paymentId
        ? 'Marked as already in QuickBooks — won\'t be pushed again.'
        : `Marked ${data?.updated ?? 'all'} payments as already in QB.`
      );
    },
    onError: (err) => toast.error('Could not mark payment: ' + err.message),
  });

  const syncPaymentToQBMutation = useMutation({
    mutationFn: async (paymentId) => {
      const res = await base44.functions.invoke('syncQuickBooksPayment', { payment_id: paymentId });
      if (res.error) throw new Error(res.error);
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments', myCompany?.id] });
      toast.success('Payment pushed to QuickBooks!');
    },
    onError: (err) => toast.error('QB sync failed: ' + err.message),
  });

  const testNotificationMutation = useMutation({
    mutationFn: async () => {
      console.log('🧪 Testing notification system...');
      
      if (!myCompany?.id) {
        throw new Error('Company ID not found');
      }
      if (!user?.email) {
        throw new Error('User email not found');
      }

      const allStaffProfiles = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
      const adminEmails = myCompany?.created_by ? [myCompany.created_by] : [];
      
      let bellSent = 0;
      let emailsSent = 0;
      let customerEmailSent = 0; // NEW: Track customer email test
      let testErrors = []; // Use a different name for errors to avoid confusion

      const testRecipients = [...new Set([user.email, ...adminEmails])];
      
      // Attempt to find a customer with an email for testing receipt
      const testCustomer = customers.find(c => c.email);
      if (testCustomer && testCustomer.email && !testRecipients.includes(testCustomer.email)) {
        testRecipients.push(testCustomer.email); // Add customer to test recipients
      }


      for (const email of testRecipients) {
        // Skip notification creation for customer emails (they don't have accounts)
        const isCustomerEmail = testCustomer && email === testCustomer.email;
        if (isCustomerEmail) {
          continue; // Skip bell notification for customers
        }
        
        try {
          await base44.entities.Notification.create({
            company_id: myCompany.id,
            user_email: email,
            title: '🧪 Test Notification',
            message: 'This is a test notification from the payment system. All automations are working!',
            type: 'payment_received',
            link_url: '/payments',
            is_read: false
          });
          bellSent++;
        } catch (error) {
          console.error(`Bell notification failed for ${email}:`, error);
          testErrors.push(`Bell notification failed for ${email}: ${error.message}`);
        }
      }

      for (const email of testRecipients) {
        try {
          const emailResponse = await base44.integrations.Core.SendEmail({
            to: email,
            from_name: myCompany.company_name || 'PhotoSync',
            subject: '🧪 Test Notification - Payment System',
            html: `<h2>Test Notification</h2>
              <p>This is a test email from your payment notification system.</p>
              <p><strong>Status:</strong> ✅ All automations are working correctly!</p>
              <p><strong>Company:</strong> ${myCompany.company_name}</p>
              <p><strong>Sent to:</strong> ${email}</p>
              <p><strong>Test performed by:</strong> ${user.full_name || user.email}</p>
              <hr>
              <p><small>When you record a payment, notifications like this will be sent to assignees and admins automatically, and customer receipts will be sent to customers.</small></p>`,
            manualSend: true,
          });
          const emailOutcome = emailResponse?.data ?? emailResponse;
          if (emailResponse?.error || emailOutcome?.success === false || emailOutcome?.skipped) {
            throw new Error(
              emailResponse?.error || emailOutcome?.reason || emailOutcome?.error || 'Test notification email was not sent.',
            );
          }
          // Distinguish between customer and internal emails for counting
          if (email === testCustomer?.email) {
            customerEmailSent++;
          } else {
            emailsSent++;
          }
        } catch (error) {
          console.error(`Email failed for ${email}:`, error);
          testErrors.push(`Email failed for ${email}: ${error.message}`);
        }
      }
      
      // Separate check for customer receipt email if customer was not in general testRecipients
      if (testCustomer && testCustomer.email && !testRecipients.includes(testCustomer.email)) {
        try {
          await base44.functions.invoke('sendEmailFromCRM', {
            to: testCustomer.email,
            subject: `🧪 Test Payment Receipt - $100.00`,
            html: `<h2>Test Payment Received - Thank You!</h2>
              <p>Dear ${testCustomer.name},</p>
              <p>This is a test receipt from your payment system. All automations are working!</p>
              <p><strong>Amount:</strong> $100.00</p>
              <p><strong>Payment Date:</strong> ${format(new Date(), 'MMM d, yyyy')}</p>
              <p><strong>Payment Method:</strong> Test Method</p>
              <p>Thank you for your business!</p>
              <p>Best regards,<br/>${myCompany.company_name || 'Your Team'}</p>`,
            companyId: myCompany.id
          });
          customerEmailSent++;
        } catch (error) {
          console.error(`Test customer receipt email failed for ${testCustomer.email}:`, error);
          testErrors.push(`Test customer receipt - ${error.message}`);
        }
      }


      try {
        await base44.functions.invoke('triggerWorkflow', {
          triggerType: 'payment_received',
          companyId: myCompany.id,
          entityType: 'Payment',
          entityData: {
            payment_number: 'TEST-001',
            customer_name: 'Test Customer',
            customer_email: testCustomer?.email || 'test@example.com', // Added customer_email
            amount: 100,
            payment_method: 'test',
            app_url: window.location.origin
          }
        });
        console.log('✅ Workflow test triggered');
      } catch (error) {
        console.error('Workflow test failed:', error);
        testErrors.push(`Workflow trigger failed: ${error.message}`);
      }

      return { bellSent, emailsSent, customerEmailSent, totalRecipients: testRecipients.length, recipients: testRecipients, errors: testErrors };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      let message = `Test complete! Sent ${result.bellSent} bell notifications, ${result.emailsSent} internal emails.`;
      if (result.customerEmailSent > 0) {
        message += ` Sent ${result.customerEmailSent} customer receipt email(s).`;
      }
      message += ` Total recipients: ${result.recipients.join(', ')}.`;

      toast.success(message, {
        duration: 8000
      });

      if (result.errors.length > 0) {
        console.error('Test notification errors:', result.errors);
        toast.error(`Some test notifications failed. Check console.`, { duration: 5000 });
      }
    },
    onError: (error) => {
      console.error('Test failed:', error);
      toast.error(`Test failed: ${error.message}`);
    }
  });

  const handleCreatePayment = async (e) => {
    e.preventDefault();
    
    if (!paymentForm.customer_name || !paymentForm.amount) {
      toast.error('Please fill in customer name and amount');
      return;
    }

    if (!myCompany?.id) {
      toast.error('Company profile not loaded. Please refresh the page.');
      return;
    }

    const newPaymentData = {
      customer_name: paymentForm.customer_name,
      customer_email: paymentForm.customer_email, // NEW: Pass customer_email
      amount: parseFloat(paymentForm.amount),
      payment_method: paymentForm.payment_method,
      payment_date: paymentForm.payment_date,
      invoice_number: paymentForm.invoice_number || null,
      reference_number: paymentForm.reference_number || null,
      notes: paymentForm.notes || null,
      send_receipt: paymentForm.send_receipt
    };

    // Duplicate-payment guard: warn when an identical payment (same invoice or
    // customer + same amount within a few days) already exists. This is the most
    // common corruption when several staff record the same claim payment.
    const possibleDupes = findDuplicatePayment(allPayments, {
      invoice_number: newPaymentData.invoice_number,
      customer_name: newPaymentData.customer_name,
      customer_id: newPaymentData.customer_id,
      amount: newPaymentData.amount,
      payment_date: newPaymentData.payment_date,
    });
    if (possibleDupes.length > 0) {
      setDuplicatePaymentInfo(possibleDupes[0]);
      setPendingPaymentData(newPaymentData);
      setShowDuplicatePaymentDialog(true);
      return;
    }

    createPaymentMutation.mutate(newPaymentData);
  };

  const initiateDeletePayment = (payment, onDeleted) => {
    const linkedInvoice = invoices.find(i => makeInvoiceMatcher(invoices)(payment, i));
    const warning = getPaidInvoiceDeleteWarning(linkedInvoice, payment.amount);
    if (warning) {
      setDeleteConfirmPayment({ payment, onDeleted: onDeleted || null });
      setDeleteConfirmInvoiceInfo(warning);
      setShowDeleteConfirmDialog(true);
    } else {
      setSimpleDeleteConfirmPayment({ payment, onDeleted: onDeleted || null });
      setShowSimpleDeletePaymentDialog(true);
    }
  };

  const handleDeletePayment = (payment) => {
    initiateDeletePayment(payment);
  };

  const totalPages = itemsPerPage === 99999 ? 1 : Math.ceil(filteredPayments.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = itemsPerPage === 99999 ? filteredPayments.length : startIndex + itemsPerPage;
  const paginatedPayments = filteredPayments.slice(startIndex, endIndex);

  const handleExport = () => {
    const headers = ['Payment #', 'Customer', 'Invoice', 'Amount', 'Method', 'Status', 'Date'];
    const rows = filteredPayments.map(p => [
      p.payment_number,
      p.customer_name,
      p.invoice_number || '',
      Number(p.amount || 0).toFixed(2) || '0.00',
      p.payment_method || '',
      p.status || '',
      paymentDateInput(p.payment_date)
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payments_${localToday()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const toggleSelectAll = () => {
    if (selectedPayments.length === paginatedPayments.length) {
      setSelectedPayments([]);
    } else {
      setSelectedPayments(paginatedPayments.map(p => p.id));
    }
  };

  const toggleSelectPayment = (id) => {
    if (selectedPayments.includes(id)) {
      setSelectedPayments(selectedPayments.filter(pId => pId !== id));
    } else {
      setSelectedPayments([...selectedPayments, id]);
    }
  };

  const performBulkDelete = async () => {
    try {
      await base44.entities.Payment.bulkDelete(selectedPayments, { validateOnly: true });
    } catch (error) {
      toast.error(error.message);
      return;
    }
    let successCount = 0;
    let failCount = 0;

    for (const id of selectedPayments) {
      const payment = payments.find(p => p.id === id);
      if (payment) {
        try {
          await deletePaymentMutation.mutateAsync({ ...payment, bulkDeletion: true });
          successCount++;
        } catch (error) {
          failCount++;
        }
      }
    }

    toast.success(`Deleted ${successCount} payments. ${failCount > 0 ? `${failCount} failed.` : ''}`);
    setSelectedPayments([]);
  };

  const handleBulkDelete = async () => {
    // Aggregate selected payments by their linked "paid" invoice so we can warn
    // about any invoices that would be left underpaid after the bulk delete.
    const affectedInvoices = getBulkPaidInvoiceDeleteWarnings(selectedPayments, payments, invoices);

    if (affectedInvoices.length > 0) {
      setBulkDeleteAffectedInvoices(affectedInvoices);
      setShowBulkDeleteConfirmDialog(true);
      return;
    }

    setShowSimpleBulkDeleteDialog(true);
  };

  const getVisibleColumnCount = () => {
    return Object.values(visibleColumns).filter(Boolean).length;
  };

  if (isLoadingPayments) {
    return <TablePageSkeleton />;
  }

  return (
    <div className="p-3 sm:p-6 space-y-6">
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
          <h1 className="text-3xl font-bold text-gray-900">{t.sidebar.payments}</h1>
          <p className="text-gray-500 mt-1">Track all customer payments</p>
        </div>
        
        <div className="flex gap-2">
          {selectedPayments.length > 0 && (
            <BulkDeleteButton
              variant="destructive" 
              onClick={handleBulkDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {t.common.delete} ({selectedPayments.length})
            </BulkDeleteButton>
          )}
          <Dialog open={showAddPayment} onOpenChange={setShowAddPayment}>
            <DialogTrigger asChild>
              <Button className="bg-green-600 hover:bg-green-700">
                <Plus className="w-4 h-4 mr-2" />
                {t.invoices.recordPayment}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t.invoices.recordPayment}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreatePayment} className="space-y-4">
                <div>
                  <Label>{t.invoices.customer}</Label>
                  <Popover open={customerSearchOpen} onOpenChange={setCustomerSearchOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={customerSearchOpen}
                        className="w-full justify-between"
                      >
                        {paymentForm.customer_name || t.customers.searchCustomers}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-full p-0" align="start">
                      <Command>
                        <CommandInput placeholder={t.customers.searchCustomers} />
                        <CommandEmpty>{t.common.noResults}</CommandEmpty>
                        <CommandGroup className="max-h-64 overflow-auto">
                          {customers.map(c => (
                            <CommandItem
                              key={c.id}
                              value={c.name}
                              onSelect={(currentValue) => {
                                const selectedCustomer = customers.find(cust => cust.name === currentValue);
                                setPaymentForm({
                                  ...paymentForm,
                                  customer_name: currentValue,
                                  customer_email: selectedCustomer?.email || "", // NEW: Set customer_email on selection
                                });
                                setCustomerSearchOpen(false);
                              }}
                            >
                              <Check
                                className={`mr-2 h-4 w-4 ${
                                  paymentForm.customer_name === c.name ? "opacity-100" : "opacity-0"
                                }`}
                              />
                              {c.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                <div>
                  <Label>{t.sidebar.invoices} ({t.common.optional})</Label>
                  <Select 
                    value={paymentForm.invoice_number} 
                    onValueChange={(val) => setPaymentForm({...paymentForm, invoice_number: val})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t.common.all} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t.common.all}</SelectItem>
                      {invoices
                        .filter(inv => inv.customer_name === paymentForm.customer_name && inv.invoice_number && inv.invoice_number.trim() !== "")
                        .map(inv => (
                          <SelectItem key={inv.id} value={inv.invoice_number}>
                            {inv.invoice_number} - ${inv.amount}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {(() => {
                  const hasInvoice = paymentForm.invoice_number && paymentForm.invoice_number !== 'none';
                  if (!hasInvoice) return null;
                  const inv = invoices.find(i => i.invoice_number === paymentForm.invoice_number);
                  if (!inv) return null;
                  const totalAmt = Number(inv.total_amount || inv.amount || 0);
                  const amtPaid = Number(inv.amount_paid || 0);
                  const balance = Math.max(0, totalAmt - amtPaid);
                  const isAlreadyPaid = inv.status === 'paid' || (totalAmt > 0 && amtPaid >= totalAmt);
                  if (isAlreadyPaid) {
                    return (
                      <div className="flex items-start gap-2 bg-red-50 border border-red-300 rounded-lg p-3 text-sm text-red-800" data-testid="payment-already-paid-warning">
                        <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold">Invoice {inv.invoice_number} is already paid in full.</p>
                          <p className="text-xs mt-0.5">Total: ${totalAmt.toFixed(2)} · Already received: ${amtPaid.toFixed(2)}</p>
                          <p className="text-xs mt-0.5 font-medium">Adding another payment would create a duplicate. Select a different invoice or clear the invoice field.</p>
                        </div>
                      </div>
                    );
                  }
                  const enteredAmt = parseFloat(paymentForm.amount);
                  const wouldOverpay = !isNaN(enteredAmt) && enteredAmt > balance + 0.005;
                  if (wouldOverpay) {
                    return (
                      <div className="flex items-start gap-2 bg-red-50 border border-red-300 rounded-lg p-3 text-sm text-red-800" data-testid="payment-overpay-warning">
                        <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold">This payment would overpay invoice {inv.invoice_number}.</p>
                          <p className="text-xs mt-0.5">Balance due: <strong>${balance.toFixed(2)}</strong> · You entered: ${enteredAmt.toFixed(2)}</p>
                          <p className="text-xs mt-0.5 font-medium">Reduce the amount to ${balance.toFixed(2)} or less.</p>
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}

                <div>
                  <Label>{t.common.amount}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm({...paymentForm, amount: e.target.value})}
                    placeholder="0.00"
                    required
                  />
                </div>

                <div>
                  <Label>{t.common.method}</Label>
                  <Select 
                    value={paymentForm.payment_method} 
                    onValueChange={(val) => setPaymentForm({...paymentForm, payment_method: val})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="check">Check</SelectItem>
                      <SelectItem value="credit_card">Credit Card</SelectItem>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="paypal">PayPal</SelectItem>
                      <SelectItem value="stripe">Stripe</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>{t.common.date}</Label>
                  <Input
                    type="date"
                    value={paymentForm.payment_date}
                    onChange={(e) => setPaymentForm({...paymentForm, payment_date: e.target.value})}
                  />
                </div>

                <div>
                  <Label>Reference Number ({t.common.optional})</Label>
                  <Input
                    value={paymentForm.reference_number}
                    onChange={(e) => setPaymentForm({...paymentForm, reference_number: e.target.value})}
                    placeholder="Check #, Transaction ID, etc."
                  />
                </div>

                <div>
                  <Label>{t.common.notes} ({t.common.optional})</Label>
                  <Input
                    value={paymentForm.notes}
                    onChange={(e) => setPaymentForm({...paymentForm, notes: e.target.value})}
                    placeholder={t.common.notes}
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="send_receipt"
                    checked={paymentForm.send_receipt}
                    onChange={(e) => setPaymentForm({...paymentForm, send_receipt: e.target.checked})}
                    className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <Label htmlFor="send_receipt" className="font-normal cursor-pointer">Send receipt to customer</Label>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button
                    type="submit"
                    disabled={createPaymentMutation.isPending || (() => {
                      const hasInvoice = paymentForm.invoice_number && paymentForm.invoice_number !== 'none';
                      if (!hasInvoice) return false;
                      const inv = invoices.find(i => i.invoice_number === paymentForm.invoice_number);
                      return isPaymentCreateBlocked(inv, paymentForm.amount);
                    })()}
                    className="flex-1 bg-green-600 hover:bg-green-700 min-h-[48px] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {createPaymentMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {t.common.save}...
                      </>
                    ) : (
                      t.common.save
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowAddPayment(false)}
                    className="min-h-[48px]"
                  >
                    {t.common.cancel}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <DollarSign className="w-8 h-8" />
              <span className="text-sm opacity-80">Total Received</span>
            </div>
            <h3 className="text-3xl font-bold">${totalReceived.toFixed(2)}</h3>
            {unlinkedReceivedTotal > 0 && (
              <p className="text-xs mt-1 bg-white/20 rounded px-2 py-0.5 inline-block">
                ⚠️ incl. ${unlinkedReceivedTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} unlinked
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-yellow-500 to-yellow-600 text-white">
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="w-8 h-8" />
              <span className="text-sm opacity-80">{t.common.pending}</span>
            </div>
            <h3 className="text-3xl font-bold">${pendingAmount.toFixed(2)}</h3>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <CreditCard className="w-8 h-8" />
              <span className="text-sm opacity-80">Transactions</span>
            </div>
            <h3 className="text-3xl font-bold">{filteredPayments.length}</h3>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="w-full sm:w-56">
          <Select value={periodFilter} onValueChange={(val) => {
            setPeriodFilter(val);
            setCurrentPage(1);
          }}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_time">{t.common.all}</SelectItem>
              <SelectItem value="this_month">{t.dashboard.thisMonth}</SelectItem>
              <SelectItem value="last_month">{t.dashboard.lastMonth}</SelectItem>
              <SelectItem value="this_year">This Year</SelectItem>
              <SelectItem value="last_year">Last Year</SelectItem>
              <SelectItem value="last_3_months">Last 3 months</SelectItem>
              <SelectItem value="last_6_months">Last 6 months</SelectItem>
              <SelectItem value="last_12_months">Last 12 months</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder={t.common.search}
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2">
          <Select value={itemsPerPage.toString()} onValueChange={(val) => {
            setItemsPerPage(val === 'all' ? 99999 : parseInt(val));
            setCurrentPage(1);
          }}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
              <SelectItem value="250">250</SelectItem>
              <SelectItem value="500">500</SelectItem>
              <SelectItem value="all">{t.common.all}</SelectItem>
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <Columns3 className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {Object.keys(visibleColumns).map(key => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={visibleColumns[key]}
                  onCheckedChange={(checked) => setVisibleColumns(prev => ({...prev, [key]: checked}))}
                >
                  {key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="icon" onClick={handleExport} title={t.common.export}>
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {unlinkedPayments.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 flex items-start gap-3">
          <span className="text-orange-500 text-xl">⚠️</span>
          <div className="flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-orange-800">
                {unlinkedPayments.length} payment{unlinkedPayments.length > 1 ? 's are' : ' is'} not linked to an invoice
              </p>
              <Button
                size="sm"
                variant="outline"
                className="border-orange-400 text-orange-700 hover:bg-orange-100 text-xs whitespace-nowrap"
                onClick={() => fixPaymentsMutation.mutate()}
                disabled={fixPaymentsMutation.isPending}
                data-testid="button-fix-payment-links"
              >
                {fixPaymentsMutation.isPending ? 'Fixing...' : 'Auto-Fix All'}
              </Button>
            </div>
            <p className="text-sm text-orange-700 mt-0.5">
              These payments show on customer profiles but are <strong>not reflected on any invoice's balance</strong> — which means the invoice list and accounting reports will show incorrect amounts owed.
              Click <strong>Auto-Fix All</strong> to automatically link each payment to the correct customer invoice, or click a payment below to fix it manually.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {unlinkedPayments.slice(0, 5).map(p => (
                <div key={p.id} className="flex items-center bg-orange-100 border border-orange-300 rounded-full overflow-hidden">
                  <button
                    onClick={() => {
                      setEditPaymentForm({
                        id: p.id,
                        amount: p.amount?.toString() || "",
                        payment_method: p.payment_method || "cash",
                        payment_date: paymentDateInput(p.payment_date) || localToday(),
                        invoice_number: "",
                        reference_number: p.reference_number || "",
                        notes: p.notes || "",
                        customer_name: p.customer_name || "",
                        customer_id: p.customer_id || "",
                        invoice_id: p.invoice_id || "",
                        _originalInvoiceNumber: "",
                        _originalAmount: p.amount?.toString() || ""
                      });
                      setShowEditPaymentDialog(true);
                    }}
                    className="text-orange-800 text-xs px-2 py-1 hover:bg-orange-200 transition-colors"
                  >
                    {p.customer_name} — ${Number(p.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </button>
                  {canCreateInvoiceFromPayment(p) && (
                    <button
                      onClick={() => createInvoiceFromPaymentMutation.mutate(p)}
                      disabled={createInvoiceFromPaymentMutation.isPending}
                      className="border-l border-orange-300 px-2 py-1 text-xs font-semibold text-orange-800 hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-60"
                      title="Create a paid invoice for this payment"
                      data-testid={`button-create-invoice-from-payment-${p.id}`}
                    >
                      {createInvoiceFromPaymentMutation.isPending && createInvoiceFromPaymentMutation.variables?.id === p.id
                        ? 'Creating…'
                        : 'Create invoice'}
                    </button>
                  )}
                  <button
                    onClick={() => initiateDeletePayment(p)}
                    className="text-orange-600 hover:text-red-700 hover:bg-red-100 px-1.5 py-1 transition-colors text-xs font-bold"
                    title="Delete this payment"
                    data-testid={`button-delete-unlinked-${p.id}`}
                  >
                    ×
                  </button>
                </div>
              ))}
              {unlinkedPayments.length > 5 && (
                <span className="text-xs text-orange-600 self-center">+{unlinkedPayments.length - 5} more</span>
              )}
            </div>
          </div>
        </div>
      )}

      <Card className="bg-white shadow-md">
        <CardHeader>
          <CardTitle>Payment History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-gray-500">
                  {visibleColumns.select && (
                    <th className="pb-3 w-[50px]">
                      <Checkbox 
                        checked={paginatedPayments.length > 0 && selectedPayments.length === paginatedPayments.length}
                        onCheckedChange={toggleSelectAll}
                        aria-label="Select all"
                      />
                    </th>
                  )}
                  {visibleColumns.payment_number && <th className="pb-3 font-medium">Payment #</th>}
                  {visibleColumns.customer && <th className="pb-3 font-medium">{t.invoices.customer}</th>}
                  {visibleColumns.invoice && <th className="pb-3 font-medium">{t.sidebar.invoices}</th>}
                  {visibleColumns.amount && <th className="pb-3 font-medium">{t.common.amount}</th>}
                  {visibleColumns.method && <th className="pb-3 font-medium">{t.common.method}</th>}
                  {visibleColumns.status && <th className="pb-3 font-medium">{t.common.status}</th>}
                  {visibleColumns.date && <th className="pb-3 font-medium">{t.common.date}</th>}
                  {visibleColumns.actions && <th className="pb-3 font-medium">{t.common.actions}</th>}
                </tr>
              </thead>
              <tbody>
                {paginatedPayments.map((payment) => {
                  const MethodIcon = getMethodIcon(payment.payment_method);
                  return (
                    <tr key={payment.id} className="border-b hover:bg-gray-50">
                      {visibleColumns.select && (
                        <td className="py-4">
                          <Checkbox 
                            checked={selectedPayments.includes(payment.id)}
                            onCheckedChange={() => toggleSelectPayment(payment.id)}
                            aria-label={`Select payment ${payment.payment_number}`}
                          />
                        </td>
                      )}
                      {visibleColumns.payment_number && <td className="py-4 font-medium">{payment.payment_number}</td>}
                      {visibleColumns.customer && (
                        <td className="py-4 align-middle text-left">
                          <button
                            onClick={() => {
                              const customer = customers.find(c => c.name === payment.customer_name);
                              const target = customer?.id
                                ? createPageUrl('CustomerProfile') + `?id=${customer.id}`
                                : createPageUrl('CustomerProfile') + `?name=${encodeURIComponent(payment.customer_name)}`;
                              navigate(target);
                            }}
                            className="block w-full text-left text-blue-600 hover:underline"
                          >
                            {payment.customer_name}
                          </button>
                        </td>
                      )}
                      {visibleColumns.invoice && (
                        <td className="py-4 text-sm text-gray-600">
                          {payment.invoice_number
                            ? payment.invoice_number
                            : <span className="inline-flex items-center gap-1 text-orange-600 font-medium"><span>⚠️</span> Not linked</span>
                          }
                        </td>
                      )}
                      {visibleColumns.amount && (
                        <td className="py-4 font-semibold text-green-600">
                          ${Number(payment.amount || 0).toFixed(2)}
                        </td>
                      )}
                      {visibleColumns.method && (
                        <td className="py-4">
                          <div className="flex items-center gap-2">
                            <MethodIcon className="w-4 h-4 text-gray-400" />
                            <span className="text-sm capitalize">{payment.payment_method?.replace(/_/g, ' ')}</span>
                          </div>
                        </td>
                      )}
                      {visibleColumns.status && (
                        <td className="py-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge variant="outline" className={getStatusColor(payment.status)}>
                              {payment.status === 'paid' ? t.common.paid : payment.status === 'pending' ? t.common.pending : payment.status}
                            </Badge>
                            {(() => {
                              const qbId = payment.quickbooks_payment_id;
                              // Already synced via app → green link
                              const qbUrl = buildQBPaymentUrl(qbId);
                              if (qbUrl) {
                                return (
                                  <a
                                    href={qbUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    title="View in QuickBooks"
                                    data-testid={`badge-qb-payment-${payment.id}`}
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700 border border-green-300 hover:bg-green-200 transition-colors"
                                  >
                                    QB ✓
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                );
                              }
                              // Marked as manually entered in QB — no link, no sync
                              if (qbId === QB_MANUAL_SENTINEL) {
                                return (
                                  <span
                                    data-testid={`badge-qb-payment-manual-${payment.id}`}
                                    title="Marked as already in QuickBooks (manually entered — won't be synced again)"
                                    className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200"
                                  >
                                    In QB
                                  </span>
                                );
                              }
                              // QB connected but not yet synced — show Pending with options
                              if (qbStatus?.connected) {
                                if (isAdmin) {
                                  return (
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <button
                                          data-testid={`badge-qb-payment-pending-${payment.id}`}
                                          onClick={e => e.stopPropagation()}
                                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition-colors cursor-pointer"
                                          title="This payment hasn't been pushed to QuickBooks yet. Click for options."
                                        >
                                          {syncPaymentToQBMutation.isPending && syncPaymentToQBMutation.variables === payment.id
                                            ? <Loader2 className="w-3 h-3 animate-spin" />
                                            : <Upload className="w-3 h-3" />}
                                          Sync to QB
                                        </button>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-64 p-3" onClick={e => e.stopPropagation()}>
                                        <p className="text-xs text-gray-600 mb-2 font-medium">QuickBooks sync options</p>
                                        <Button
                                          size="sm"
                                          className="w-full text-xs mb-2"
                                          disabled={syncPaymentToQBMutation.isPending}
                                          onClick={() => syncPaymentToQBMutation.mutate(payment.id)}
                                        >
                                          {syncPaymentToQBMutation.isPending && syncPaymentToQBMutation.variables === payment.id
                                            ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Pushing…</>
                                            : 'Push to QuickBooks'}
                                        </Button>
                                        <p className="text-xs text-gray-500 mb-2">
                                          Or, if this payment is already in QuickBooks:
                                        </p>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="w-full text-xs"
                                          disabled={markQBManualMutation.isPending}
                                          onClick={() => markQBManualMutation.mutate({ paymentId: payment.id })}
                                        >
                                          {markQBManualMutation.isPending ? 'Saving…' : 'Already in QB (don\'t sync)'}
                                        </Button>
                                      </PopoverContent>
                                    </Popover>
                                  );
                                }
                                return (
                                  <span
                                    data-testid={`badge-qb-payment-pending-${payment.id}`}
                                    className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200"
                                  >
                                    QB Pending
                                  </span>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        </td>
                      )}
                      {visibleColumns.date && (
                        <td className="py-4 text-sm text-gray-600">
                          {parsePaymentDate(payment.payment_date) ? format(parsePaymentDate(payment.payment_date), 'MMM d, yyyy') : '-'}
                        </td>
                      )}
                      {visibleColumns.actions && (
                        <td className="py-4 flex gap-1 items-center">
                          {payment.file_url && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => window.open(payment.file_url, '_blank')}
                              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                              title="View Check/Receipt"
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            title={payment.invoice_number ? "Edit payment" : "⚠️ Link to invoice"}
                            onClick={() => {
                              setEditPaymentForm({
                                id: payment.id,
                                amount: payment.amount?.toString() || "",
                                payment_method: payment.payment_method || "cash",
                                payment_date: paymentDateInput(payment.payment_date) || localToday(),
                                invoice_number: payment.invoice_number || "",
                                reference_number: payment.reference_number || "",
                                notes: payment.notes || "",
                                customer_name: payment.customer_name || "",
                                customer_id: payment.customer_id || "",
                                invoice_id: payment.invoice_id || "",
                                _originalInvoiceNumber: payment.invoice_number || "",
                                _originalAmount: payment.amount?.toString() || ""
                              });
                              setShowEditPaymentDialog(true);
                            }}
                            className={payment.invoice_number ? "text-gray-600 hover:text-gray-800 hover:bg-gray-50" : "text-orange-600 hover:text-orange-700 hover:bg-orange-50"}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeletePayment(payment)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {paginatedPayments.length === 0 && (
                  <tr>
                    <td colSpan={getVisibleColumnCount()} className="py-12 text-center text-gray-500">
                      {t.common.noResults}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {filteredPayments.length > 0 && itemsPerPage !== 99999 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 mt-4">
              <div className="text-sm text-gray-600">
                Showing {startIndex + 1} to {Math.min(endIndex, filteredPayments.length)} of {filteredPayments.length} entries
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  {t.common.previous}
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
                  {t.common.next}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Payment Dialog */}
      <Dialog open={showEditPaymentDialog} onOpenChange={setShowEditPaymentDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-sm font-medium">Customer</Label>
              <p className="text-gray-700 mt-1 font-semibold">{editPaymentForm.customer_name || '—'}</p>
            </div>
            <div>
              <Label className="text-sm font-medium">Amount ($)</Label>
              <Input
                type="number"
                value={editPaymentForm.amount}
                onChange={e => setEditPaymentForm(f => ({ ...f, amount: e.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Payment Method</Label>
              <Select
                value={editPaymentForm.payment_method}
                onValueChange={v => setEditPaymentForm(f => ({ ...f, payment_method: v }))}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="credit_card">Credit Card</SelectItem>
                  <SelectItem value="zelle">Zelle</SelectItem>
                  <SelectItem value="venmo">Venmo</SelectItem>
                  <SelectItem value="cash_app">Cash App</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium">Payment Date</Label>
              <Input
                type="date"
                value={editPaymentForm.payment_date}
                onChange={e => setEditPaymentForm(f => ({ ...f, payment_date: e.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm font-medium text-orange-700">
                Link to Invoice {!editPaymentForm.invoice_number && <span className="text-orange-500 font-bold">← Required to update invoice balance</span>}
              </Label>
              <Select
                value={editPaymentForm.invoice_number || 'none'}
                onValueChange={v => setEditPaymentForm(f => ({ ...f, invoice_number: v === 'none' ? '' : v }))}
              >
                <SelectTrigger className={`mt-1 ${!editPaymentForm.invoice_number ? 'border-orange-400' : ''}`}>
                  <SelectValue placeholder="Select invoice..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No invoice</SelectItem>
                  {(() => {
                    const matched = editPaymentForm.customer_name
                      ? invoices.filter(inv => inv.customer_name === editPaymentForm.customer_name && inv.invoice_number)
                      : invoices.filter(inv => inv.invoice_number);
                    const list = matched.length > 0 ? matched : invoices.filter(inv => inv.invoice_number);
                    return list.map(inv => (
                      <SelectItem key={inv.id} value={inv.invoice_number}>
                        {inv.invoice_number} — {inv.customer_name} — ${Number(inv.amount || 0).toFixed(0)}
                      </SelectItem>
                    ));
                  })()}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium">Reference / Check #</Label>
              <Input
                value={editPaymentForm.reference_number}
                onChange={e => setEditPaymentForm(f => ({ ...f, reference_number: e.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Notes</Label>
              <Input
                value={editPaymentForm.notes}
                onChange={e => setEditPaymentForm(f => ({ ...f, notes: e.target.value }))}
                className="mt-1"
              />
            </div>
            {(() => {
              const inv = invoices.find(i => i.invoice_number === editPaymentForm.invoice_number);
              if (!inv) return null;
              const totalAmt = Number(inv.total_amount || inv.amount || 0);
              const rawAmtPaid = Number(inv.amount_paid || 0);
              // When editing a payment on the same invoice it was originally on,
              // subtract the original payment amount so we compute the balance as
              // if this payment slot is vacant — preventing false overpay blocks.
              const sameInvoice = editPaymentForm._originalInvoiceNumber === inv.invoice_number;
              const originalAmt = parseFloat(editPaymentForm._originalAmount) || 0;
              const projectedAmtPaid = sameInvoice ? Math.max(0, rawAmtPaid - originalAmt) : rawAmtPaid;
              const balance = Math.max(0, totalAmt - projectedAmtPaid);
              const isAlreadyPaid = totalAmt > 0 && projectedAmtPaid >= totalAmt;
              if (isAlreadyPaid) {
                return (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-300 rounded-lg p-3 text-sm text-red-800" data-testid="edit-payment-already-paid-warning">
                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Invoice {inv.invoice_number} is already paid in full.</p>
                      <p className="text-xs mt-0.5">Total: ${totalAmt.toFixed(2)} · Already received: ${rawAmtPaid.toFixed(2)}</p>
                      <p className="text-xs mt-0.5 font-medium">Adding another payment would create a duplicate. Select a different invoice or clear the invoice field.</p>
                    </div>
                  </div>
                );
              }
              const enteredAmt = parseFloat(editPaymentForm.amount);
              const wouldOverpay = !isNaN(enteredAmt) && enteredAmt > balance + 0.005;
              if (wouldOverpay) {
                return (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-300 rounded-lg p-3 text-sm text-red-800" data-testid="edit-payment-overpay-warning">
                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">This payment would overpay invoice {inv.invoice_number}.</p>
                      <p className="text-xs mt-0.5">Balance due: <strong>${balance.toFixed(2)}</strong> · You entered: ${enteredAmt.toFixed(2)}</p>
                      <p className="text-xs mt-0.5 font-medium">Reduce the amount to ${balance.toFixed(2)} or less.</p>
                    </div>
                  </div>
                );
              }
              return null;
            })()}
            <div className="flex gap-2 pt-2">
              <Button
                className="flex-1"
                onClick={() => updatePaymentMutation.mutate()}
                disabled={updatePaymentMutation.isPending || (() => {
                  const inv = invoices.find(i => i.invoice_number === editPaymentForm.invoice_number);
                  return isPaymentEditBlocked(inv, editPaymentForm.amount, editPaymentForm._originalInvoiceNumber, editPaymentForm._originalAmount);
                })()}
              >
                {updatePaymentMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button variant="outline" onClick={() => setShowEditPaymentDialog(false)}>
                Cancel
              </Button>
              <Button
                variant="outline"
                className="border-red-300 text-red-600 hover:bg-red-50"
                data-testid="button-delete-payment-dialog"
                onClick={() => {
                  const paymentObj = payments.find(p => p.id === editPaymentForm.id) || editPaymentForm;
                  initiateDeletePayment(paymentObj, () => setShowEditPaymentDialog(false));
                }}
                disabled={deletePaymentMutation.isPending}
              >
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Payment Warning Dialog */}
      <Dialog open={showDeleteConfirmDialog} onOpenChange={setShowDeleteConfirmDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Delete Payment?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {deleteConfirmInvoiceInfo && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 space-y-1">
                <p className="font-semibold text-amber-800 text-sm flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  Invoice #{deleteConfirmInvoiceInfo.invoice_number} is currently marked as Paid
                </p>
                <p className="text-sm text-amber-700">
                  Deleting this payment will leave an outstanding balance of{' '}
                  <strong>${deleteConfirmInvoiceInfo.outstandingBalance.toFixed(2)}</strong>.
                </p>
                <p className="text-sm text-amber-700">
                  The invoice status will automatically be updated to <strong>{deleteConfirmInvoiceInfo.newStatus}</strong>.
                </p>
              </div>
            )}
            <p className="text-sm text-gray-600">
              Are you sure you want to delete this payment? If it is a fee deduction, its matching expense will also be removed. This action cannot be undone.
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowDeleteConfirmDialog(false);
                  setDeleteConfirmPayment(null);
                  setDeleteConfirmInvoiceInfo(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                data-testid="button-confirm-delete-payment"
                disabled={deletePaymentMutation.isPending}
                onClick={() => {
                  if (!deleteConfirmPayment) return;
                  const { payment, onDeleted } = deleteConfirmPayment;
                  setShowDeleteConfirmDialog(false);
                  setDeleteConfirmPayment(null);
                  setDeleteConfirmInvoiceInfo(null);
                  deletePaymentMutation.mutate(payment, { onSuccess: onDeleted || undefined });
                }}
              >
                {deletePaymentMutation.isPending ? 'Deleting...' : 'Yes, Delete Payment'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Duplicate Payment Confirmation Dialog */}
      <Dialog open={showDuplicatePaymentDialog} onOpenChange={(open) => {
        setShowDuplicatePaymentDialog(open);
        if (!open) {
          setDuplicatePaymentInfo(null);
          setPendingPaymentData(null);
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="w-5 h-5" />
              Possible Duplicate Payment
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {duplicatePaymentInfo && pendingPaymentData && (
              <p className="text-sm text-gray-600">
                A payment of <strong>${Number(pendingPaymentData.amount || 0).toFixed(2)}</strong> for{' '}
                <strong>{pendingPaymentData.customer_name || 'this customer'}</strong> already exists
                ({duplicatePaymentInfo.payment_number || 'no #'}
                {duplicatePaymentInfo.payment_date ? `, ${duplicatePaymentInfo.payment_date}` : ''}
                {duplicatePaymentInfo.invoice_number ? `, invoice ${duplicatePaymentInfo.invoice_number}` : ''}).
              </p>
            )}
            <p className="text-sm text-gray-600">Record this payment anyway?</p>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                data-testid="button-cancel-duplicate-payment"
                onClick={() => {
                  setShowDuplicatePaymentDialog(false);
                  setDuplicatePaymentInfo(null);
                  setPendingPaymentData(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                data-testid="button-confirm-duplicate-payment"
                disabled={createPaymentMutation.isPending}
                onClick={() => {
                  if (!pendingPaymentData) return;
                  const dataToSubmit = { ...pendingPaymentData, __forceDuplicate: true };
                  setShowDuplicatePaymentDialog(false);
                  setDuplicatePaymentInfo(null);
                  setPendingPaymentData(null);
                  createPaymentMutation.mutate(dataToSubmit);
                }}
              >
                {createPaymentMutation.isPending ? 'Recording...' : 'Yes, Record Payment'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Simple Delete Payment Dialog (no linked paid invoice) */}
      <Dialog open={showSimpleDeletePaymentDialog} onOpenChange={(open) => {
        setShowSimpleDeletePaymentDialog(open);
        if (!open) setSimpleDeleteConfirmPayment(null);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Delete Payment?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {simpleDeleteConfirmPayment && (
              <p className="text-sm text-gray-600">
                Delete this payment of{' '}
                <strong>${Number(simpleDeleteConfirmPayment.payment?.amount || 0).toLocaleString()}</strong> from{' '}
                <strong>{simpleDeleteConfirmPayment.payment?.customer_name}</strong>? Any matching fee-deduction expense will also be removed. This cannot be undone.
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                data-testid="button-cancel-simple-delete-payment"
                onClick={() => {
                  setShowSimpleDeletePaymentDialog(false);
                  setSimpleDeleteConfirmPayment(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                data-testid="button-confirm-simple-delete-payment"
                disabled={deletePaymentMutation.isPending}
                onClick={() => {
                  if (!simpleDeleteConfirmPayment) return;
                  const { payment, onDeleted } = simpleDeleteConfirmPayment;
                  setShowSimpleDeletePaymentDialog(false);
                  setSimpleDeleteConfirmPayment(null);
                  deletePaymentMutation.mutate(payment, { onSuccess: onDeleted || undefined });
                }}
              >
                {deletePaymentMutation.isPending ? 'Deleting...' : 'Yes, Delete Payment'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Simple Bulk Delete Dialog (no affected paid invoices) */}
      <Dialog open={showSimpleBulkDeleteDialog} onOpenChange={setShowSimpleBulkDeleteDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Delete {selectedPayments.length} Payments?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-600">
              Are you sure you want to delete {selectedPayments.length} payments? Matching expenses for fee deductions will also be removed. This action cannot be undone.
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                data-testid="button-cancel-simple-bulk-delete"
                onClick={() => setShowSimpleBulkDeleteDialog(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                data-testid="button-confirm-simple-bulk-delete"
                onClick={async () => {
                  setShowSimpleBulkDeleteDialog(false);
                  await performBulkDelete();
                }}
              >
                {`Yes, Delete ${selectedPayments.length} Payments`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Payments Warning Dialog */}
      <Dialog open={showBulkDeleteConfirmDialog} onOpenChange={setShowBulkDeleteConfirmDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Delete {selectedPayments.length} Payments?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 space-y-2">
              <p className="font-semibold text-amber-800 text-sm flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {bulkDeleteAffectedInvoices.length} paid {bulkDeleteAffectedInvoices.length === 1 ? 'invoice' : 'invoices'} will be left underpaid
              </p>
              <p className="text-sm text-amber-700">
                Deleting the selected payments will reduce the amount received on these invoices and
                automatically change their status:
              </p>
              <div className="space-y-1.5 pt-1">
                {bulkDeleteAffectedInvoices.map((inv) => (
                  <div
                    key={inv.invoice_number}
                    className="flex items-start justify-between gap-3 bg-white border border-amber-200 rounded-md px-3 py-2 text-sm"
                    data-testid={`bulk-delete-affected-invoice-${inv.invoice_number}`}
                  >
                    <span className="font-medium text-gray-800">Invoice #{inv.invoice_number}</span>
                    <span className="text-right text-amber-700">
                      Outstanding <strong>${inv.outstandingBalance.toFixed(2)}</strong>
                      <span className="block text-xs text-amber-600">→ {inv.newStatus}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-sm text-gray-600">
              Are you sure you want to delete {selectedPayments.length} payments? Matching expenses for fee deductions will also be removed. This action cannot be undone.
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                data-testid="button-cancel-bulk-delete"
                onClick={() => {
                  setShowBulkDeleteConfirmDialog(false);
                  setBulkDeleteAffectedInvoices([]);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                data-testid="button-confirm-bulk-delete"
                disabled={deletePaymentMutation.isPending}
                onClick={async () => {
                  setShowBulkDeleteConfirmDialog(false);
                  setBulkDeleteAffectedInvoices([]);
                  await performBulkDelete();
                }}
              >
                {deletePaymentMutation.isPending ? 'Deleting...' : `Yes, Delete ${selectedPayments.length} Payments`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}