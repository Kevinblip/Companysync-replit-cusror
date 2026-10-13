import React, { useState, useEffect, useMemo } from "react";
import { deductionTypesForInvoice, calculateFeeDeduction, hasRemainingBalanceForDeduction } from "@/utils/paymentDeductionTypes";
import FeeDeductionCalculator from "@/components/invoice/FeeDeductionCalculator";
import { previewStandaloneDeduction, reverseStandaloneDeduction } from "@/utils/standaloneDeduction";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import {
  Download,
  Mail,
  Send,
  Edit,
  Trash2,
  CheckCircle,
  Printer,
  Copy,
  MoreVertical,
  DollarSign,
  Link as LinkIcon,
  ExternalLink,
  CreditCard,
  AlertCircle,
  AlertTriangle,
  UserPlus,
  Split,
  Plus,
  RefreshCw,
  Pencil,
  Loader2,
  Clock,
  ChevronDown,
  Calculator,
  Camera,
  MessageSquare,
  MinusCircle,
  X,
  Banknote,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { isRecordPaymentBlocked } from "@/utils/paymentGuards";
import { formatToE164 } from "@/utils";
import { buildInvoiceSmsMessage, resolveSmsPhone, hasTextablePhone } from "@/utils/documentSms";
import { requireMessageSubmission } from "@/utils/paymentRequestDelivery";
import { localToday, formatDateOnly } from "@/utils/localDate";
import { getQBInvoiceUrl, QB_MANUAL_SENTINEL } from "@/utils/quickbooksUtils";
import { buildInvoiceUpdatePayload } from "@/utils/invoiceEditorPayload";
import PhotoMeasurementUploader from "@/components/measurements/PhotoMeasurementUploader";

export default function InvoiceDetails() {
  const queryClient = useQueryClient();
  const [invoiceId, setInvoiceId] = useState(null);
  const [activeTab, setActiveTab] = useState('invoice');
  const [showCommissionSplitDialog, setShowCommissionSplitDialog] = useState(false);
  const [commissionSplits, setCommissionSplits] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id) setInvoiceId(id);
  }, []);

  const { data: invoice } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: async () => {
      const invoices = await base44.entities.Invoice.filter({ id: invoiceId });
      return invoices[0];
    },
    enabled: !!invoiceId,
    refetchOnMount: true,
  });

  // Use centralized role-based data hook for consistent company/user resolution (including impersonation)
  const { myCompany, user, myStaffProfile, isAdmin, hasPermission, isPermissionsReady, effectiveUserEmail } = useRoleBasedData();
  const { data: deliverySummary, isError: deliverySummaryError } = useQuery({
    queryKey: ['invoice-delivery-summary', invoiceId],
    queryFn: async () => {
      const response = await base44.functions.invoke('getInvoiceDeliverySummary', { invoiceId });
      if (response.error || response.data?.success === false) {
        throw new Error(response.error || response.data?.error || 'Could not load delivery history');
      }
      return response.data;
    },
    enabled: !!invoiceId && !!myCompany?.id,
    refetchInterval: 30000,
  });
  const invoiceEmailAttempts = (deliverySummary?.emailAttempts || [])
    .filter(item => item.purpose !== 'payment_request');
  const latestInvoiceEmail = invoiceEmailAttempts[0];
  const emailDeliveryLabel = status => ({
    delivered: 'Delivered to mail server (not proof of reading)',
    bounced: 'Bounced',
    complained: 'Marked as spam',
    failed: 'Failed',
    submitted: 'Submitted to email provider; delivery unconfirmed',
    sent: 'Submitted to email provider; delivery unconfirmed',
    pending: 'Attempt recorded; provider outcome pending',
  })[status] || 'Delivery unconfirmed';
  const staffChannelLabel = status => ({
    created: 'In-app alert created',
    deferred: 'In-app alert deferred',
    submitted: 'Submitted to provider; delivery unconfirmed',
    failed: 'Failed',
    suppressed_quiet_hours: 'Suppressed during quiet hours (not queued)',
    not_configured: 'Not configured for recipient',
    pending: 'Send pending',
  })[status] || 'Not tracked';

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Customer.filter({ company_id: myCompany.id }, '-created_date', 1000) : [],
    enabled: !!myCompany?.id,
  });

  // Resolve a customer only from the invoice's explicit customer ID. A matching
  // name is not enough to associate an invoice with a customer record.
  const { data: specificCustomer } = useQuery({
    queryKey: ['customer-for-invoice', invoice?.customer_id, myCompany?.id],
    queryFn: async () => {
      if (!invoice?.customer_id || !myCompany?.id) return null;
      const res = await base44.entities.Customer.filter({ id: invoice.customer_id, company_id: myCompany.id });
      return res[0] || null;
    },
    enabled: !!invoice && !!myCompany?.id,
  });

  // Define customer here to be used in next query
  const customer = specificCustomer
    || customers.find(c => String(c.id) === String(invoice?.customer_id));
  const invoiceCustomerIsLinked = !!invoice?.customer_id && (
    String(customer?.id) === String(invoice.customer_id)
    || String(customer?.base44_id) === String(invoice.customer_id)
  );
  const paymentRequestPhone = (invoiceCustomerIsLinked
    ? (customer.phone || customer.phone_2)
    : null) || invoice?.customer_phone;
  const trackedPaymentEmailIds = useMemo(
    () => (invoice?.payment_requests || []).map(request => request.communication_id).filter(Boolean),
    [invoice?.payment_requests],
  );
  const { data: paymentEmailDelivery = {} } = useQuery({
    queryKey: ['invoice-payment-email-delivery', invoice?.id, trackedPaymentEmailIds.join(',')],
    queryFn: async () => {
      const records = await Promise.all(trackedPaymentEmailIds.map(id =>
        base44.entities.Communication.filter({ id, company_id: myCompany.id })
      ));
      return Object.fromEntries(records.flat().map(row =>
        [row.id, row.data?.delivery_status || row.delivery_status || row.status]
      ));
    },
    enabled: !!myCompany?.id && trackedPaymentEmailIds.length > 0,
    refetchInterval: 30000,
  });

  // Fetch ALL payments for this customer (to show unlinked ones)
  const { data: allCustomerPayments = [] } = useQuery({
    queryKey: ['customer-payments', customer?.id, customer?.name],
    queryFn: async () => {
      if (!customer) return [];
      const byId = await base44.entities.Payment.filter({ customer_id: customer.id, company_id: myCompany.id });
      const byName = await base44.entities.Payment.filter({ customer_name: customer.name, company_id: myCompany.id });
      
      // Merge and deduplicate
      const all = [...byId, ...byName];
      const unique = all.filter((p, index, self) => 
        index === self.findIndex(t => t.id === p.id)
      );
      return unique;
    },
    enabled: !!customer,
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

  // Fetch payments linked directly to this invoice — filter by invoice_id only to prevent cross-customer contamination
  const { data: invoicePayments = [], isFetched: paymentsReady } = useQuery({
    queryKey: ['invoice-payments', invoice?.id],
    queryFn: async () => {
      if (!invoice?.id) return [];
      return await base44.entities.Payment.filter({ invoice_id: invoice.id });
    },
    enabled: !!invoice?.id,
  });

  const payments = invoicePayments;

  // Duplicate display numbers are common across customers. Keep these
  // candidates visible on the destination invoice so an administrator can
  // deliberately move a payment by invoice_id instead of guessing from the
  // number alone.
  const { data: duplicateNumberPayments = [] } = useQuery({
    queryKey: ['duplicate-number-payments', invoice?.id, invoice?.invoice_number, myCompany?.id],
    queryFn: async () => {
      if (!invoice?.invoice_number || !myCompany?.id) return [];
      return await base44.entities.Payment.filter({
        company_id: myCompany.id,
        invoice_number: invoice.invoice_number,
      });
    },
    enabled: !!invoice?.invoice_number && !!myCompany?.id,
  });

  const sameNumberOtherCustomerPayments = duplicateNumberPayments.filter((payment) =>
    payment.invoice_id &&
    payment.invoice_id !== invoice?.id &&
    (
      (payment.customer_id && payment.customer_id !== invoice?.customer_id) ||
      (!payment.customer_id && payment.customer_name !== invoice?.customer_name)
    )
  );
  
  // Unlinked payments are those for this customer WITHOUT an invoice_id linking them anywhere
  const unlinkedPayments = allCustomerPayments.filter(p => !p.invoice_id && (!p.invoice_number || p.invoice_number === 'none' || p.invoice_number === ''));

  // Payments for this customer that are linked to a DIFFERENT invoice — can be re-linked here
  const otherInvoicePayments = allCustomerPayments.filter(p =>
    p.invoice_id && p.invoice_id !== invoice?.id &&
    !payments.some(lp => lp.id === p.id)
  );

  // Shared helper: recalculate + persist an invoice's amount_paid and status from DB
  const _recalcInvoiceBalance = async (invId) => {
    const response = await base44.functions.invoke('recalculateInvoicePayments', { invoice_id: invId });
    const result = response?.data ?? response;
    if (result?.success !== true) throw new Error(result?.error || 'Invoice balance could not be recalculated.');
    if (result.status === 'paid' && invoice?.status !== 'paid') _triggerJobLearning(invId);
    return result;
  };

  // Fire-and-forget: when a job's invoice is fully paid, let the AI Estimator
  // learn from the final quantities (server is idempotent — one learning per invoice).
  const _triggerJobLearning = (invId) => {
    base44.functions.invoke('learnFromFinishedJob', { invoice_id: invId })
      .then((res) => {
        if (res?.data?.success && res?.data?.learned && !res?.data?.already_learned) {
          toast.success('AI Estimator updated', {
            description: 'Learned from this finished job to improve future measurement estimates.'
          });
        }
      })
      .catch((e) => console.warn('[learnFromFinishedJob] skipped:', e?.message || e));
  };

  const linkPaymentMutation = useMutation({
    mutationFn: async (payment) => {
        const sourceInvoiceId = payment.invoice_id; // save before overwriting

        await base44.entities.Payment.update(payment.id, {
            invoice_number: invoice.invoice_number,
            invoice_id: invoice.id,
            customer_id: invoice.customer_id || customer?.id || null,
            customer_name: customer?.name || invoice.customer_name || '',
        });

        // Recalculate destination invoice balance from fresh DB data
        await _recalcInvoiceBalance(invoice.id);

        // Recalculate the source invoice so it no longer counts this payment
        if (sourceInvoiceId && sourceInvoiceId !== invoice.id) {
          await _recalcInvoiceBalance(sourceInvoiceId);
        }

        // Fire commission earned alert — non-blocking
        base44.functions.invoke('notifyCommissionEarned', {
          invoiceId: invoice.id,
          paymentId: payment.id,
          paymentAmount: Number(payment.amount || 0),
          companyId: myCompany?.id
        }).catch(e => console.warn('[Commission] Link-payment notification skipped:', e?.message));
    },
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
        queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
        queryClient.invalidateQueries({ queryKey: ['invoice-payments'] });
        toast.success("Payment linked successfully!");
    },
    onError: (error) => {
        toast.error("Failed to link payment: " + error.message);
    }
  });

  const linkAllPaymentsMutation = useMutation({
    mutationFn: async (paymentsToLink) => {
      const sourceInvoiceIds = new Set(paymentsToLink.map(p => p.invoice_id).filter(Boolean));
      // Move all payments to this invoice in parallel
      await Promise.all(paymentsToLink.map(p =>
        base44.entities.Payment.update(p.id, {
          invoice_number: invoice.invoice_number,
            invoice_id: invoice.id,
            customer_id: invoice.customer_id || customer?.id || null,
            customer_name: customer?.name || invoice.customer_name || '',
        })
      ));
      // Recalculate destination invoice
      await _recalcInvoiceBalance(invoice.id);
      // Recalculate all source invoices
      await Promise.all(
        [...sourceInvoiceIds].filter(id => id !== invoice.id).map(id => _recalcInvoiceBalance(id))
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payments'] });
      toast.success("All payments re-linked successfully!");
    },
    onError: (error) => {
      toast.error("Failed to re-link payments: " + error.message);
    }
  });

  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [copyToCustomerProfile, setCopyToCustomerProfile] = useState(false);

  useEffect(() => {
    if (invoice?.notes) setInvoiceNotes(invoice.notes);
  }, [invoice]);

  // Reconcile once when this invoice's payment query is ready. The displayed
  // list contains only directly linked payments; it cannot be compared to a
  // balance that also includes safely resolved legacy cash payments.
  // Do not depend on amount_paid or the payment array: our own refresh would
  // otherwise trigger a repeating repair cycle.
  useEffect(() => {
    if (!invoice?.id || !paymentsReady) return;
    if (invoice.status === 'cancelled') return;
    let active = true;
    _recalcInvoiceBalance(invoice.id)
      .then(() => {
        if (!active) return;
        queryClient.invalidateQueries({ queryKey: ['invoice', invoice.id] });
        queryClient.invalidateQueries({ queryKey: ['invoices'] });
      })
      .catch((error) => {
        if (active) toast.error('Could not verify invoice balance', { description: error.message });
      });
    return () => { active = false; };
  }, [invoice?.id, paymentsReady, queryClient]);

  // user and myCompany are provided by useRoleBasedData hook at the top

  const saveNotesMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.Invoice.update(invoice.id, { notes: invoiceNotes });
      
      if (copyToCustomerProfile) {
        if (!invoice.customer_id || !customer) {
          throw new Error('This invoice is not linked to a customer. Link it to the correct customer before copying notes to a profile.');
        }

        // Fetch fresh customer data to ensure we don't lose existing notes
        const freshCustomerList = await base44.entities.Customer.filter({ id: customer.id, company_id: myCompany?.id });
        const freshCustomer = freshCustomerList[0];
        
        if (freshCustomer) {
          await base44.entities.CustomerNote.create({
            company_id: myCompany?.id,
            customer_id: freshCustomer.id,
            note: `[Invoice ${invoice.invoice_number}] ${invoiceNotes}`,
            source_type: 'manual',
            source_label: `Invoice ${invoice.invoice_number}`,
            created_by: user?.email || 'system',
            created_by_name: user?.full_name || user?.email || 'system',
            created_at: new Date().toISOString(),
          });
        }
      }
    },
    onSuccess: () => {
      toast.success(copyToCustomerProfile ? "Notes saved and copied to customer profile!" : "Notes saved successfully!");
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      if (copyToCustomerProfile) queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer-for-invoice'] });
    },
    onError: (error) => {
      toast.error("Failed to save notes: " + error.message);
    }
  });

  // Initialize edit form when invoice loads
  useEffect(() => {
    if (invoice && !editForm) {
      setEditForm({
        customer_name: invoice.customer_name || '',
        customer_email: invoice.customer_email || '',
        issue_date: invoice.issue_date || '',
        due_date: invoice.due_date || '',
        items: invoice.items || invoice.line_items || [],
        notes: invoice.notes || '',
        claim_number: invoice.claim_number || '',
        insurance_company: invoice.insurance_company || '',
        discount_type: invoice.discount_type || 'none',
        discount_value: invoice.discount_value || 0,
        adjustment_amount: invoice.adjustment_amount || 0,
        deposit_type: invoice.data?.deposit_type || 'none',
        deposit_value: invoice.data?.deposit_value || 0,
        deductible_amount: Number(invoice.deductible_amount || invoice.data?.deductible_amount || 0),
        supplement_amount: Number(invoice.data?.supplement_amount || invoice.supplement_amount || 0),
        depreciation_held: Number(invoice.data?.depreciation_held || invoice.depreciation_held || 0),
      });
    }
  }, [invoice, editForm]);

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  // myStaffProfile and isAdmin are provided by useRoleBasedData hook at the top

  // Initialize commission splits from invoice
  // Auto-populate for Sedgwick-tagged jobs (assigned rep + crew lead)
  useEffect(() => {
    if (!invoice || !staffProfiles.length) return;

    let splits = invoice.commission_splits || [];

    // Auto-populate commission splits for Sedgwick claims (assigned rep + crew lead)
    {
      const hasSedgwickTag = invoice.tags?.some(tag => {
        const tagStr = typeof tag === 'object' ? tag.name || tag.label || JSON.stringify(tag) : String(tag);
        return tagStr.toLowerCase().includes('sedgwick');
      });

      if (hasSedgwickTag && (!splits || splits.length === 0)) {
        const newSplits = [];

        // Try multiple fields to find assigned rep email
        let assignedRepEmail = null;
        const possibleRepFields = [
          invoice.assigned_to,
          invoice.assigned_rep_email,
          invoice.sale_agent,
          invoice.data?.assigned_to,
          invoice.data?.assigned_rep_email
        ];
        
        for (const field of possibleRepFields) {
          if (field && field.includes('@')) {
            assignedRepEmail = field;
            break;
          }
        }

        // Add assigned rep to splits
        if (assignedRepEmail) {
          const assignedRep = staffProfiles.find(sp => sp.user_email === assignedRepEmail);
          if (assignedRep && assignedRep.user_email !== myCompany?.created_by) {
            newSplits.push({
              user_email: assignedRepEmail,
              user_name: assignedRep.full_name,
              split_percentage: 50, // 50% for rep
              role: assignedRep.job_title || 'Sales Rep'
            });
          }
        }

        // Try multiple fields to find crew lead/foreman email
        let crewLeadEmail = null;
        const possibleCrewFields = [
          invoice.crew_lead,
          invoice.crew_lead_email,
          invoice.foreman,
          invoice.foreman_email,
          invoice.crew_in_charge,
          invoice.crew_in_charge_email,
          invoice.data?.crew_lead,
          invoice.data?.crew_lead_email,
          invoice.data?.foreman,
          invoice.data?.foreman_email,
          invoice.data?.crew_in_charge,
          invoice.data?.crew_in_charge_email
        ];
        
        for (const field of possibleCrewFields) {
          if (field && field.includes('@')) {
            crewLeadEmail = field;
            break;
          }
        }

        // Add crew lead to splits
        if (crewLeadEmail && crewLeadEmail !== assignedRepEmail) {
          const crewLead = staffProfiles.find(sp => sp.user_email === crewLeadEmail);
          if (crewLead && crewLead.user_email !== myCompany?.created_by) {
            newSplits.push({
              user_email: crewLeadEmail,
              user_name: crewLead.full_name,
              split_percentage: 50, // 50% for crew lead
              role: crewLead.job_title || 'Crew Lead'
            });
          }
        }

        // Only save if we have splits to add
        if (newSplits.length > 0) {
          splits = newSplits;
          // Auto-save the commission splits
          base44.entities.Invoice.update(invoice.id, { commission_splits: splits })
            .catch(err => console.warn('Failed to auto-set Sedgwick commission:', err));
        }
      }
    }

    setCommissionSplits(splits || []);
  }, [invoice, staffProfiles, myCompany]);

  const sendInvoiceMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('sendInvoiceEmail', {
        invoiceId: invoice.id,
        companyId: myCompany?.id
      });

      requireMessageSubmission(response, 'email');

      // Only mark as sent once we know the email was accepted
      let statusUpdateFailed = false;
      // Editing even the sent date on a paid invoice can re-fire invoice_paid.
      // Its email delivery record already holds the submission evidence.
      if (invoice.status !== 'paid') {
        try {
          await base44.entities.Invoice.update(invoice.id, {
            ...(invoice.status === 'draft' ? { status: 'sent' } : {}),
            sent_date: new Date().toISOString()
          });
        } catch (error) {
          // The provider already accepted the message. Never tell the sender that
          // the send failed and encourage a duplicate customer email.
          statusUpdateFailed = true;
          console.warn('[sendInvoiceEmail] Provider accepted, invoice timestamp update failed:', error);
        }
      }
      
      return { ...response, statusUpdateFailed };
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoice-delivery-summary', invoiceId] });
      toast.success(`Invoice submitted to the email provider for ${invoice.customer_email}. Delivery is not yet confirmed.`);
      if (response.data?.deliveryTrackingDegraded) {
        toast.warning('Email accepted, but delivery tracking is delayed. Check its status before trying again.');
      }
      if (response.statusUpdateFailed) {
        toast.warning('Email was submitted, but the invoice date could not be updated. Check delivery history before trying again.');
      }
    },
    onError: (error) => {
      console.error("Error sending invoice:", error);
      toast.error('Failed to send invoice', { description: error.message });
    }
  });

  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [sendReceipt, setSendReceipt] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentDate, setPaymentDate] = useState(localToday());
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [editPaymentOpen, setEditPaymentOpen] = useState(false);
  const [editPaymentMethod, setEditPaymentMethod] = useState('cash');
  const [editPaymentDate, setEditPaymentDate] = useState(localToday());
  const [requestAmount, setRequestAmount] = useState('');
  const [showRequestHistory, setShowRequestHistory] = useState(false);
  const [editingRequestId, setEditingRequestId] = useState(null);
  const [editingRequestAmount, setEditingRequestAmount] = useState('');
  const [showVoidPaymentDialog, setShowVoidPaymentDialog] = useState(false);
  const [feeWithheldAmount, setFeeWithheldAmount] = useState('');
  const [showDeductionPanel, setShowDeductionPanel] = useState(false);
  const [voidPaymentPending, setVoidPaymentPending] = useState(false);
  const [showDeleteInvoiceDialog, setShowDeleteInvoiceDialog] = useState(false);
  const [deleteInvoicePending, setDeleteInvoicePending] = useState(false);
  const [showRelinkPaymentDialog, setShowRelinkPaymentDialog] = useState(false);
  const [relinkPaymentTarget, setRelinkPaymentTarget] = useState(null);
  const [showRelinkAllDialog, setShowRelinkAllDialog] = useState(false);
  const [showForceMarkPaidDialog, setShowForceMarkPaidDialog] = useState(false);
  const [showMarkFullyPaidDialog, setShowMarkFullyPaidDialog] = useState(false);
  const [showCheckScanDialog, setShowCheckScanDialog] = useState(false);
  const [reviewPrompt, setReviewPrompt] = useState(null); // { invoiceId, customerName } shown after paid-in-full
  const [sendingReviewRequest, setSendingReviewRequest] = useState(false);
  const [isProcessingCheck, setIsProcessingCheck] = useState(false);

  const handleCheckScan = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessingCheck(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const result = await base44.functions.invoke('processCheckPayment', {
        fileUrl: file_url,
        customerId: customer?.id,
        customerName: invoice?.customer_name,
        companyId: myCompany?.id,
        invoiceId: invoice?.id,
        invoiceNumber: invoice?.invoice_number,
      });
      if (result.data?.success) {
        const ex = result.data.extracted_data;
        toast.success(`✅ Check Payment Recorded!\n\nAmount: $${Number(ex.amount || 0).toFixed(2)}\nCheck #: ${ex.check_number || 'N/A'}\nDate: ${ex.check_date || 'N/A'}\nFrom: ${ex.payer_name || 'N/A'}`, { duration: 6000 });
        queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
        queryClient.invalidateQueries({ queryKey: ['payments'] });
        queryClient.invalidateQueries({ queryKey: ['invoice-payments'] });
        queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
        setShowCheckScanDialog(false);
      } else {
        toast.error(result.data?.error || 'Failed to process check');
      }
    } catch (err) {
      toast.error('Failed to process check: ' + err.message);
    } finally {
      setIsProcessingCheck(false);
    }
  };

  const handleDeleteInvoice = async () => {
    setDeleteInvoicePending(true);
    try {
      await base44.entities.Invoice.delete(invoice.id);
      toast.success('Invoice deleted');
      setShowDeleteInvoiceDialog(false);
      window.history.back();
    } catch (error) {
      toast.error('Failed to delete: ' + error.message);
    } finally {
      setDeleteInvoicePending(false);
    }
  };

  const handleSavePaymentEdit = async () => {
    if (!selectedPayment) return;
    const unsupported = ['cash_app','zelle','venmo'];
    const mapped = unsupported.includes(editPaymentMethod) ? 'other' : editPaymentMethod;
    const note = unsupported.includes(editPaymentMethod) ? `Recorded via ${editPaymentMethod.replace('_',' ')}` : selectedPayment.notes;
    await base44.entities.Payment.update(selectedPayment.id, {
      payment_method: mapped,
      payment_date: editPaymentDate,
      notes: note
    });
    queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
    queryClient.invalidateQueries({ queryKey: ['invoice-payments'] });
    setEditPaymentOpen(false);
  };

  const recordPaymentMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(paymentAmount);
      
      if (!amount || amount <= 0) {
        throw new Error('Invalid payment amount');
      }

      // Generate Payment Number
      const allPayments = myCompany ? await base44.entities.Payment.filter({ company_id: myCompany.id }, '-created_date', 1000) : [];
      const numbers = allPayments
        .map(p => p.payment_number)
        .filter(num => num && num.startsWith('PAY-'))
        .map(num => parseInt(num.replace(/PAY-\d{4}-|[^\d]/g, '')))
        .filter(num => !isNaN(num));
      
      const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;
      const currentYear = new Date().getFullYear();
      const paymentNumber = `PAY-${currentYear}-${String(maxNumber + 1).padStart(4, '0')}`;

      // Create payment record FIRST
      // Map UI method to entity enum; unsupported ones go to 'other' with a note
      const unsupported = ['cash_app','zelle','venmo'];
      const mappedMethod = unsupported.includes(paymentMethod) ? 'other' : paymentMethod;
      const methodNote = unsupported.includes(paymentMethod) ? `Recorded via ${paymentMethod.replace('_',' ')}` : '';

      const newPayment = await base44.entities.Payment.create({
        company_id: myCompany?.id,
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        customer_name: invoice.customer_name,
        customer_id: customer?.id,
        customer_email: invoice.customer_email,
        amount: amount,
        payment_method: mappedMethod,
        payment_number: paymentNumber,
        payment_date: paymentDate,
        status: 'received',
        notes: methodNote || undefined
      });

      // Recompute the invoice balance from the SUM of its real payments (source of
      // truth) instead of incrementing previousPaid+amount. Incrementing drifts upward
      // when several staff record / edit / re-link payments on the same job.
      const balance = await _recalcInvoiceBalance(invoice.id);

      // Fire invoice_paid notification only on the authoritative transition.
      if (balance.status === 'paid' &&
        String(balance.previous_status || '').toLowerCase() !== 'paid' &&
        myCompany?.id) {
        try {
          await base44.functions.invoke('universalNotificationDispatcher', {
            action: 'update',
            entityType: 'Invoice',
            entityId: invoice.id,
            entityData: { ...invoice, status: 'paid', amount_paid: balance.amount_paid },
            previousData: { status: balance.previous_status },
            companyId: myCompany?.id
          });
        } catch (e) {
          console.warn('[universalNotificationDispatcher] invoice_paid notify failed:', e?.message);
        }
      }

      // Send payment receipt email to customer
      if (invoice.customer_email && sendReceipt) {
        try {
          await base44.functions.invoke('sendPaymentNotification', {
            paymentId: newPayment.id,
            companyId: myCompany?.id
          });
        } catch (emailError) {
          console.warn('Failed to send payment notification:', emailError);
        }
      }

      // Notify admins and assigned staff
      try {
        await base44.functions.invoke('universalNotificationDispatcher', {
          action: 'create',
          entityType: 'Payment',
          entityId: newPayment.id,
          entityData: newPayment,
          companyId: myCompany?.id
        });
      } catch (notifError) {
        console.warn('Failed to send staff notifications:', notifError);
      }

      // Fire commission earned alert (email + SMS + bell) — non-blocking
      base44.functions.invoke('notifyCommissionEarned', {
        invoiceId: invoice.id,
        paymentId: newPayment.id,
        paymentAmount: amount,
        companyId: myCompany?.id
      }).catch(e => console.warn('[Commission] Notification skipped:', e?.message));

      return { payment: newPayment, balance };
    },
    onSuccess: async ({ balance } = {}) => {
      // Use the locked server-side recalculation result, not the possibly stale
      // invoice query cache or the amount entered for this one payment.
      const isNewlyPaid = balance?.status === 'paid' &&
        String(balance.previous_status || '').toLowerCase() !== 'paid';

      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payments'] });
      setShowPaymentDialog(false);
      setPaymentAmount('');
      setSendReceipt(true);
      setPaymentMethod('cash');
      setPaymentDate(localToday());
      toast.success(sendReceipt ? 'Payment recorded and receipt sent!' : 'Payment recorded successfully!');

      if (isNewlyPaid) {
        setReviewPrompt({ invoiceId: invoice.id, customerName: invoice.customer_name });
      }
    },
    onError: (error) => {
      console.error("Error recording payment:", error);
      toast.error('Failed to record payment: ' + error.message);
    }
  });

  // Force-mark paid WITHOUT creating a new payment — used when payments exist elsewhere
  const forceMarkPaidMutation = useMutation({
    mutationFn: async () => {
      const total = Number(invoice.total_amount || invoice.amount || 0);
      if (total === 0) throw new Error('Invoice has no amount to pay.');
      await base44.entities.Invoice.update(invoice.id, {
        status: 'paid',
        amount_paid: total,
      });
      _triggerJobLearning(invoice.id);
      // Notify via dispatcher — invoice forcibly marked paid
      try {
        await base44.functions.invoke('universalNotificationDispatcher', {
          action: 'update',
          entityType: 'Invoice',
          entityId: invoice.id,
          entityData: { ...invoice, status: 'paid' },
          previousData: { status: invoice.status },
          companyId: myCompany?.id
        });
      } catch (e) {
        console.warn('[universalNotificationDispatcher] invoice_paid notify failed:', e?.message);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Invoice marked as paid in full.');
    },
    onError: (error) => {
      toast.error('Failed: ' + (error.message || 'Please try again.'));
    },
  });

  const markAsPaidMutation = useMutation({
    mutationFn: async () => {
      const total = Number(invoice.total_amount || invoice.amount || 0);
      const alreadyPaid = Number(invoice.amount_paid || 0);
      const amountDue = total - alreadyPaid;

      if (total === 0) {
        throw new Error('Invoice has no amount to pay.');
      }
      if (amountDue <= 0) {
        throw new Error('Invoice is already fully paid.');
      }

      // 1) Create a real Payment record for the remaining balance and link it to this invoice
      // Generate next payment number (PAY-YYYY-####)
      const allPayments = myCompany ? await base44.entities.Payment.filter({ company_id: myCompany.id }, '-created_date', 1000) : [];
      const year = new Date().getFullYear();
      const numbers = allPayments
        .map(p => p.payment_number)
        .filter(num => num && String(num).startsWith(`PAY-${year}-`))
        .map(num => parseInt(String(num).replace(/PAY-\d{4}-|[^\d]/g, '')))
        .filter(n => !isNaN(n));
      const nextSeq = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
      const paymentNumber = `PAY-${year}-${String(nextSeq).padStart(4, '0')}`;

      const newMarkPaidPayment = await base44.entities.Payment.create({
        company_id: myCompany?.id,
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        customer_id: customer?.id,
        customer_name: invoice.customer_name,
        customer_email: invoice.customer_email || customer?.email,
        amount: amountDue,
        payment_method: 'cash',
        payment_number: paymentNumber,
        payment_date: localToday(),
        status: 'received'
      });

      // We just created a real payment for the remaining balance — recompute amount_paid
      // and status from the SUM of payments rather than incrementing alreadyPaid+amountDue.
      await _recalcInvoiceBalance(invoice.id);

      // Notify via dispatcher — invoice is now fully paid
      try {
        await base44.functions.invoke('universalNotificationDispatcher', {
          action: 'update',
          entityType: 'Invoice',
          entityId: invoice.id,
          entityData: { ...invoice, status: 'paid' },
          previousData: { status: invoice.status },
          companyId: myCompany?.id
        });
      } catch (e) {
        console.warn('[universalNotificationDispatcher] invoice_paid notify failed:', e?.message);
      }

      // Fire-and-forget commission alerts
      base44.functions.invoke('notifyCommissionEarned', {
        invoiceId: invoice.id,
        paymentId: newMarkPaidPayment?.id,
        paymentAmount: amountDue,
        companyId: myCompany?.id,
      }).catch(e => console.warn('[CommissionEarned] mark-as-paid trigger failed:', e?.message || e));

    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      await queryClient.invalidateQueries({ queryKey: ['payments'] });
      await queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
      await queryClient.invalidateQueries({ queryKey: ['invoice-payments'] });
      setShowMarkFullyPaidDialog(false);
      toast.success('Marked as paid and recorded a payment for the remaining balance.');
      setReviewPrompt({ invoiceId: invoice.id, customerName: invoice.customer_name });
    },
    onError: (error) => {
      console.error('Error marking invoice as paid:', error);
      toast.error(`Failed to mark invoice as fully paid: ${error.message || 'Please try again.'}`);
    }
  });

  const updateCommissionSplitsMutation = useMutation({
    mutationFn: async (splits) => {
      await base44.entities.Invoice.update(invoice.id, {
        commission_splits: splits
      });

      // Send notifications using Resend (same method as invoice emails)
      const response = await base44.functions.invoke('sendCommissionNotification', {
        invoiceId: invoice.id,
        companyId: myCompany.id,
        splits: splits
      });

      return { splits, notificationResult: response.data };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setShowCommissionSplitDialog(false);
      
      const { splits, notificationResult } = result;
      toast.success('Commission splits updated', { description: `Sent ${notificationResult.successCount} emails to sales reps.` });
    },
    onError: (error) => {
      toast.error('Failed to update commission splits', { description: error.message });
    }
  });

  const markCommissionPaidMutation = useMutation({
    mutationFn: async ({ splitIndex, split, amount }) => {
      const createdExpense = await base44.entities.Expense.create({
        company_id: myCompany.id,
        expense_date: localToday(),
        vendor_name: split.user_name,
        category: 'commission',
        amount: amount,
        description: `Commission/MRP fee paid to ${split.user_name} — Invoice ${invoice.invoice_number}`,
        payment_method: 'other',
        reference_number: invoice.invoice_number,
        customer_id: invoice.customer_id || '',
        tax_deductible: true,
        status: 'paid',
      });
      const updatedSplits = [...(invoice.commission_splits || [])];
      updatedSplits[splitIndex] = {
        ...updatedSplits[splitIndex],
        paid: true,
        paid_date: localToday(),
        paid_amount: amount,
        paid_expense_id: createdExpense?.id || null,
      };
      await base44.entities.Invoice.update(invoice.id, { commission_splits: updatedSplits });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['expenses', myCompany?.id] });
      toast.success('Marked as paid!', { description: 'Expense entry created in your books.' });
    },
    onError: (err) => toast.error('Error', { description: err.message }),
  });

  // Undo a paid split — reverses whichever flow recorded it:
  //  - regular payout: deletes the matching commission Expense
  //  - withheld fee: deletes the offset Payment AND the Expense, then recalcs the balance
  // Matching is by invoice reference + vendor (+ amount when available) since older
  // records didn't store the created record IDs on the split.
  const undoSplitPaidMutation = useMutation({
    mutationFn: async ({ splitIndex, split }) => {
      if (!myCompany?.id) throw new Error('Company not loaded yet — try again in a moment.');

      // 1) Delete the matching expense.
      // Prefer the exact ID stored on the split (new records); fall back to a
      // conservative heuristic match for older records that predate the ID.
      let expenseDeleted = false;
      try {
        if (split.paid_expense_id) {
          await base44.entities.Expense.delete(split.paid_expense_id);
          expenseDeleted = true;
        } else {
          const expenses = await base44.entities.Expense.filter({
            company_id: myCompany.id,
            reference_number: invoice.invoice_number,
            category: 'commission',
          }, '-created_date', 50);
          const vendorCandidates = expenses.filter(e => e.vendor_name === split.user_name);
          // Exact vendor + amount match first
          let match = vendorCandidates.find(e =>
            split.paid_amount && Math.abs(Number(e.amount) - Number(split.paid_amount)) < 0.01
          );
          // Vendor-only fallback ONLY when it's unambiguous: exactly one candidate
          // AND no other split for this same vendor is still marked paid (their
          // expense could otherwise be deleted out from under them).
          if (!match && vendorCandidates.length === 1) {
            const otherPaidSameVendor = (invoice.commission_splits || []).some((s, i) =>
              i !== splitIndex && s.paid && s.user_name === split.user_name
            );
            if (!otherPaidSameVendor) match = vendorCandidates[0];
          }
          if (match) {
            await base44.entities.Expense.delete(match.id);
            expenseDeleted = true;
          }
        }
      } catch (e) {
        console.warn('Undo: expense cleanup failed (continuing):', e);
      }

      // 2) If this was a withheld fee, delete the offset payment too
      if (split.paid_via === 'withheld') {
        if (split.paid_offset_payment_id) {
          await base44.entities.Payment.delete(split.paid_offset_payment_id);
        } else {
          const invPayments = await base44.entities.Payment.filter({
            company_id: myCompany.id,
            invoice_id: invoice.id,
          }, '-created_date', 100);
          const offset = invPayments.find(p =>
            (p.is_withheld_offset === true || (p.notes || '').includes(`Fee withheld by ${split.user_name}`)) &&
            (!split.paid_amount || Math.abs(Number(p.amount) - Number(split.paid_amount)) < 0.01)
          );
          if (offset) await base44.entities.Payment.delete(offset.id);
        }
      }

      // 3) Mark the split unpaid again
      const updatedSplits = [...(invoice.commission_splits || [])];
      const { paid, paid_date, paid_amount, paid_via, paid_expense_id, paid_offset_payment_id, ...rest } = updatedSplits[splitIndex];
      updatedSplits[splitIndex] = { ...rest, paid: false };
      await base44.entities.Invoice.update(invoice.id, { commission_splits: updatedSplits });

      // 4) Recompute the invoice balance from the sum of its real payments
      await _recalcInvoiceBalance(invoice.id);
      return { expenseDeleted };
    },
    onSuccess: ({ expenseDeleted }) => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payments'] });
      queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
      queryClient.invalidateQueries({ queryKey: ['expenses', myCompany?.id] });
      if (expenseDeleted) {
        toast.success('Undone', { description: 'The payout record was reversed. You can now record it the right way.' });
      } else {
        toast.success('Undone', { description: 'The split was reset, but the matching expense could not be found automatically — check the Expenses page and remove it there if needed.' });
      }
    },
    onError: (err) => toast.error('Undo failed', { description: err.message }),
  });

  // Fee WITHHELD from the payment (e.g. Sedgwick MRP keeps its % out of the claim
  // check). No cash arrives for this portion, so we record an offset payment to
  // close the invoice balance AND an expense for the fee — books stay balanced:
  // full invoice = revenue, withheld fee = expense, cash received = the difference.
  const recordFeeWithheldMutation = useMutation({
    mutationFn: async ({ splitIndex, split, amount }) => {
      if (!amount || amount <= 0) throw new Error('Enter the amount that was withheld.');
      if (!myCompany?.id) throw new Error('Company not loaded yet — try again in a moment.');

      // Generate the next payment number (same scheme as manual payments)
      const allPayments = await base44.entities.Payment.filter({ company_id: myCompany.id }, '-created_date', 1000);
      const numbers = allPayments
        .map(p => p.payment_number)
        .filter(num => num && num.startsWith('PAY-'))
        .map(num => parseInt(num.replace(/PAY-\d{4}-|[^\d]/g, '')))
        .filter(num => !isNaN(num));
      const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;
      const paymentNumber = `PAY-${new Date().getFullYear()}-${String(maxNumber + 1).padStart(4, '0')}`;
      const today = localToday();

      // 1) Offset payment so the invoice balance closes (clearly labeled — no cash received)
      const createdOffsetPayment = await base44.entities.Payment.create({
        company_id: myCompany.id,
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        customer_name: invoice.customer_name,
        customer_id: customer?.id,
        customer_email: invoice.customer_email,
        amount: amount,
        payment_method: 'other',
        payment_number: paymentNumber,
        payment_date: today,
        status: 'received',
        is_withheld_offset: true,
        notes: `Fee withheld by ${split.user_name} (${split.split_percentage}%) — deducted from claim payment, no cash received. Offset by matching expense.`,
      });

      // 2) Matching expense so the withheld fee shows in your books
      const createdWithheldExpense = await base44.entities.Expense.create({
        company_id: myCompany.id,
        expense_date: today,
        vendor_name: split.user_name,
        category: 'commission',
        amount: amount,
        description: `Fee withheld by ${split.user_name} (${split.split_percentage}%) from payment on Invoice ${invoice.invoice_number}`,
        payment_method: 'other',
        reference_number: invoice.invoice_number,
        customer_id: invoice.customer_id || '',
        tax_deductible: true,
        status: 'paid',
      });

      // 3) Mark this split settled (via withholding)
      const updatedSplits = [...(invoice.commission_splits || [])];
      updatedSplits[splitIndex] = {
        ...updatedSplits[splitIndex],
        paid: true,
        paid_date: today,
        paid_amount: amount,
        paid_via: 'withheld',
        paid_expense_id: createdWithheldExpense?.id || null,
        paid_offset_payment_id: createdOffsetPayment?.id || null,
      };
      await base44.entities.Invoice.update(invoice.id, { commission_splits: updatedSplits });

      // 4) Recompute the invoice balance from the sum of its payments (source of truth)
      await _recalcInvoiceBalance(invoice.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payments'] });
      queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
      queryClient.invalidateQueries({ queryKey: ['expenses', myCompany?.id] });
      setFeeWithheldAmount('');
      toast.success('Withheld fee recorded', { description: 'Invoice balance closed and the fee was logged as an expense.' });
    },
    onError: (err) => toast.error('Error', { description: err.message }),
  });

  const paymentDeductionsEnabled = myCompany?.data?.payment_deductions_enabled === true;
  const deductionTypeOptions = useMemo(
    () => deductionTypesForInvoice(myCompany?.data?.payment_deduction_types),
    [myCompany?.data?.payment_deduction_types]
  );
  const recordStandaloneDeductionMutation = useMutation({
    mutationFn: async ({ deductionType, ...input }) => {
      if (input.mode === 'amount') {
        const preview = previewStandaloneDeduction(input.value, amountDue);
        if (preview.error) throw new Error(preview.error);
      }
      const { amount, rateNote, error } = calculateFeeDeduction({
        ...input,
        remainingBalance: amountDue,
        invoiceTotal: total,
      });
      if (error) throw new Error(error);
      if (!deductionTypeOptions.some(type => type.name === deductionType)) throw new Error('Select a deduction type.');
      if (!myCompany?.id) throw new Error('Company not loaded — try again.');
      const allPayments = await base44.entities.Payment.filter({ company_id: myCompany.id }, '-created_date', 1000);
      const numbers = allPayments
        .map(p => p.payment_number).filter(n => n && n.startsWith('PAY-'))
        .map(n => parseInt(n.replace(/PAY-\d{4}-|[^\d]/g, ''))).filter(n => !isNaN(n));
      const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;
      const paymentNumber = `PAY-${new Date().getFullYear()}-${String(maxNumber + 1).padStart(4, '0')}`;
      const today = localToday();
      const offsetPayment = await base44.entities.Payment.create({
        company_id: myCompany.id,
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        customer_name: invoice.customer_name,
        customer_id: customer?.id,
        customer_email: invoice.customer_email,
        amount: amount,
        payment_method: 'other',
        payment_number: paymentNumber,
        payment_date: today,
        status: 'received',
        is_withheld_offset: true,
        notes: `${deductionType}${rateNote} — deducted from payment, no cash received. Offset by matching expense.`,
      });
      let offsetExpense;
      try {
        offsetExpense = await base44.entities.Expense.create({
          company_id: myCompany.id,
          invoice_id: invoice.id,
          withheld_offset_payment_id: offsetPayment.id,
          is_withheld_offset: true,
          expense_date: today,
          vendor_name: deductionType,
          category: 'other',
          amount: amount,
          description: `${deductionType} deducted from payment on Invoice ${invoice.invoice_number}${rateNote}`,
          payment_method: 'other',
          reference_number: invoice.invoice_number,
          customer_id: invoice.customer_id || '',
          tax_deductible: true,
          status: 'paid',
        });
        await base44.entities.Payment.update(offsetPayment.id, { withheld_expense_id: offsetExpense.id });
      } catch (error) {
        try {
          if (offsetExpense?.id) await base44.entities.Expense.delete(offsetExpense.id);
          await base44.entities.Payment.delete(offsetPayment.id);
          await _recalcInvoiceBalance(invoice.id);
        } catch {
          throw new Error('The deduction could not be completed or fully reversed. Check this invoice’s payments and expenses before trying again.');
        }
        throw error;
      }
      await _recalcInvoiceBalance(invoice.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payments'] });
      queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
      queryClient.invalidateQueries({ queryKey: ['expenses', myCompany?.id] });
      setShowDeductionPanel(false);
      toast.success('Fee deduction recorded', { description: 'The invoice balance was reduced by the withheld amount and the fee was logged as an expense.' });
    },
    onError: (err) => toast.error('Error', { description: err.message }),
  });

  const undoStandaloneDeductionMutation = useMutation({
    mutationFn: async (payment) => {
      if (!myCompany?.id || payment.company_id !== myCompany.id || payment.invoice_id !== invoice.id) {
        throw new Error('This deduction does not belong to this invoice.');
      }
      const reversal = await reverseStandaloneDeduction({ payment, companyId: myCompany.id, invoke: base44.functions.invoke });
      if (!reversal.handled) {
        throw new Error('This payment is not a standalone fee deduction. Use its original undo action.');
      }
    },
    onSuccess: () => toast.success('Fee deduction undone', { description: 'The offset payment and matching expense were removed, and the invoice balance was recalculated.' }),
    onError: (err) => toast.error('Could not undo deduction', { description: err.message }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payments'] });
      queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
      queryClient.invalidateQueries({ queryKey: ['expenses', myCompany?.id] });
    },
  });

  const [achPayoutPendingIdx, setAchPayoutPendingIdx] = useState(null);

  const initiateRepPayoutMutation = useMutation({
    mutationFn: async ({ splitIndex, split, amount, staffProfile }) => {
      if (!staffProfile?.id) throw new Error('Rep profile not found.');
      if (!staffProfile.data?.stripe_express_account_id) throw new Error('This rep has not set up their bank account yet. Go to Settings → Rep ACH Payouts to send them a setup link.');
      if (staffProfile.data?.stripe_payout_status !== 'active') throw new Error('This rep\'s bank account is not fully verified yet. Ask them to complete their Stripe setup, then check their status in Settings.');
      if (!myCompany?.id) throw new Error('Company not loaded — try again.');
      const res = await base44.functions.invoke('initiateRepPayout', {
        invoiceId: invoice.id,
        splitIndex,
        amount,
        repStaffProfileId: staffProfile.id,
        companyId: myCompany.id,
      });
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['expenses', myCompany?.id] });
      setAchPayoutPendingIdx(null);
      toast.success('ACH payout sent!', { description: data?.message || 'The rep will receive funds within 1–5 business days.' });
    },
    onError: (err) => {
      setAchPayoutPendingIdx(null);
      toast.error('Payout failed', { description: err.message });
    },
  });

  const handleAddSplit = () => {
    setCommissionSplits([...commissionSplits, {
      user_email: '',
      user_name: '',
      split_percentage: 0,
      role: ''
    }]);
  };

  const handleRemoveSplit = (index) => {
    setCommissionSplits(commissionSplits.filter((_, i) => i !== index));
  };

  const handleSplitChange = (index, field, value) => {
    const newSplits = [...commissionSplits];
    newSplits[index][field] = value;
    
    if (field === 'user_email') {
      const staff = staffProfiles.find(s => s.user_email === value);
      if (staff) {
        newSplits[index].user_name = staff.full_name;
      }
    }
    
    setCommissionSplits(newSplits);
  };

  const handleSaveCommissionSplits = () => {
    const totalPercentage = commissionSplits.reduce((sum, split) => sum + (parseFloat(split.split_percentage) || 0), 0);
    
    if (totalPercentage > 100) {
      toast.error('Total split percentage cannot exceed 100%');
      return;
    }

    const validSplits = commissionSplits.filter(split => 
      split.user_email && split.split_percentage > 0
    );

    updateCommissionSplitsMutation.mutate(validSplits);
  };

  const updateInvoiceMutation = useMutation({
    mutationFn: async (data) => {
      // buildInvoiceUpdatePayload merges into the invoice's existing `data`
      // JSONB — other parts of the app store keys there (estimate_id, change
      // order bookkeeping, ...) that a deposit edit must not wipe out.
      const payload = buildInvoiceUpdatePayload(data, invoice);
      return await base44.entities.Invoice.update(invoice.id, payload);
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      setIsEditing(false);
      toast.success('Invoice updated successfully!');
    },
    onError: (error) => {
      toast.error('Failed to update invoice: ' + error.message);
    }
  });

  const handleSaveInvoice = () => {
    updateInvoiceMutation.mutate(editForm);
  };

  const [isDownloading, setIsDownloading] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  const handleDownloadPDF = async () => {
    setIsDownloading(true);
    try {
      const response = await base44.functions.invoke('generateInvoicePDF', {
        invoice: invoice,
        customer: customer
      });
      
      if (response.data.success && response.data.pdf_url) {
        // Download from the URL
        const link = document.createElement('a');
        link.href = response.data.pdf_url;
        link.download = response.data.file_name || `Invoice-${invoice.invoice_number}.pdf`;
        link.target = '_blank'; // Open in new tab as fallback
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        toast.success("Invoice PDF generated and downloading...");
      } else {
        throw new Error(response.data.error || "Failed to generate PDF");
      }
    } catch (error) {
      console.error("PDF download failed:", error);
      toast.error("Failed to download invoice PDF: " + error.message);
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      const response = await base44.functions.invoke('generateInvoicePDF', {
        invoice: invoice,
        customer: customer
      });
      
      if (response.data.success && response.data.pdf_url) {
        // Open PDF in new window for printing
        const printWindow = window.open(response.data.pdf_url, '_blank');
        if (printWindow) {
            printWindow.focus();
        } else {
            toast.error("Popup blocked. Please allow popups for this site.");
        }
      } else {
        throw new Error(response.data.error || "Failed to generate PDF for printing");
      }
    } catch (error) {
      console.error("Print generation failed:", error);
      toast.error("Failed to generate print version: " + error.message);
    } finally {
      setIsPrinting(false);
    }
  };

  const handleAddItem = () => {
    setEditForm({
      ...editForm,
      items: [...editForm.items, { description: '', quantity: 1, rate: 0, amount: 0 }]
    });
  };

  const handleRemoveItem = (index) => {
    setEditForm({
      ...editForm,
      items: editForm.items.filter((_, i) => i !== index)
    });
  };

  const handleItemChange = (index, field, value) => {
    const newItems = [...editForm.items];
    newItems[index][field] = value;
    
    if (field === 'quantity' || field === 'rate') {
      newItems[index].amount = (newItems[index].quantity || 0) * (newItems[index].rate || 0);
    }
    
    setEditForm({ ...editForm, items: newItems });
  };

  // --- Payment request hooks (MUST be before any early return) ---
  useEffect(() => {
    if (!invoice?.id) return;
    const total = Number(invoice.total_amount || invoice.amount || 0);
    const paid = Number(invoice.amount_paid || 0);
    const due = total - paid;
    if (due > 0) setRequestAmount(due.toFixed(2));
  }, [invoice?.id]);

  const sendPaymentRequestMutation = useMutation({
    mutationFn: async (amount) => {
      // Prefer email stored on the invoice; fall back to the linked customer record
      const resolvedEmail = invoice?.customer_email || customer?.email;
      if (!resolvedEmail) throw new Error('No customer email on this invoice. Add an email first.');
      // If the invoice was missing the email, backfill it now so sendInvoiceEmail
      // (which reads the invoice from the DB) picks it up correctly
      if (!invoice?.customer_email && customer?.email) {
        await base44.entities.Invoice.update(invoice.id, { customer_email: customer.email });
      }
      const response = await base44.functions.invoke('sendInvoiceEmail', {
        invoiceId: invoice.id,
        companyId: myCompany?.id,
        custom_amount: parseFloat(amount),
        purpose: 'payment_request',
      });
      return requireMessageSubmission(response, 'email');
    },
    onSuccess: async (result, amount) => {
      const resolvedEmail = invoice?.customer_email || customer?.email;
      toast.success(`Payment request for $${parseFloat(amount).toFixed(2)} submitted to the email provider for ${resolvedEmail}. Delivery is not yet confirmed.`);
      if (result.deliveryTrackingDegraded) {
        toast.warning('The provider accepted the email, but delivery tracking is delayed. Check its status before trying again.');
      }
      try {
        await logPaymentRequestEntry(amount, 'email', {
          status: 'submitted', provider: result.provider,
          provider_message_id: result.id, communication_id: result.communicationId || null,
        });
      } catch (error) {
        toast.warning('Email was submitted, but the request history could not be saved. Check before trying again.');
      }
      queryClient.invalidateQueries({ queryKey: ['invoice', invoice.id] });
      queryClient.invalidateQueries({ queryKey: ['invoice-delivery-summary', invoice.id] });
    },
    onError: (error) => {
      toast.error(`❌ Failed to send: ${error.message}`);
    },
  });

  const generateStripeLinkMutation = useMutation({
    mutationFn: async (amount) => {
      const result = await base44.functions.invoke('createPaymentLinkForInvoice', {
        invoice_id: invoice.id,
        custom_amount: parseFloat(amount),
      });
      return { data: result.data, amount };
    },
    onSuccess: async ({ data, amount }) => {
      if (data?.payment_url) {
        navigator.clipboard.writeText(data.payment_url);
        toast.success(`✅ Stripe link for $${parseFloat(amount).toFixed(2)} copied to clipboard!`);
        await logPaymentRequestEntry(amount, 'stripe');
      } else {
        toast.error('Failed to generate payment link');
      }
    },
    onError: (err) => toast.error('Failed to generate Stripe link: ' + err.message),
  });

  const sendPaymentRequestSMSMutation = useMutation({
    mutationFn: async (amount) => {
      const rawPhone = paymentRequestPhone;
      if (!rawPhone) throw new Error('No phone number on file for this customer. Add a phone number first.');
      const phone = formatToE164(rawPhone) || rawPhone;
      const amt = parseFloat(amount);

      const linkResponse = await base44.functions.invoke('createPaymentLinkForInvoice', {
        invoice_id: invoice.id,
        custom_amount: amt,
      });
      const payLink = linkResponse?.data?.payment_url;
      if (linkResponse?.error || linkResponse?.data?.error || !payLink) {
        throw new Error(linkResponse?.error || linkResponse?.data?.error || 'Could not create a payment link. No text was sent.');
      }

      const companyName = myCompany?.company_name || 'Your Team';
      const message = `Hi ${invoice.customer_name || 'there'}! Payment request from ${companyName} for invoice ${invoice.invoice_number}.\n\nAmount due: $${amt.toFixed(2)}\n\nPay securely here: ${payLink}\n\nThank you!`;

      const response = await base44.functions.invoke('sendSMS', {
        to: phone,
        message,
        contactName: invoice.customer_name,
        companyId: myCompany?.id,
        senderEmail: user?.email || effectiveUserEmail || undefined,
        paymentInvoiceId: invoice.id,
      });
      return { amount: amt, phone, result: requireMessageSubmission(response, 'sms') };
    },
    onSuccess: async ({ amount, phone, result }) => {
      toast.success(`Payment request for $${amount.toFixed(2)} submitted to the text provider for ${phone}. Delivery is not yet confirmed.`);
      try {
        await logPaymentRequestEntry(amount, 'sms', { status: 'submitted', provider: 'twilio', provider_message_id: result.sid });
      } catch (error) {
        toast.warning('Text was submitted, but the request history could not be saved. Check before trying again.');
      }
    },
    onError: (error) => {
      toast.error(`❌ Failed to text payment request: ${error.message}`);
    },
  });
  // Text the invoice itself (not just a payment request) so customers and
  // leads without an email on file can still receive it.
  const sendInvoiceSmsMutation = useMutation({
    mutationFn: async () => {
      const phone = resolveSmsPhone(invoice?.customer_phone, customer?.phone, customer?.phone_2);
      if (!phone) throw new Error('No phone number on file for this customer. Add a phone number first.');

      let payUrl = '';
      try {
        const result = await base44.functions.invoke('createPaymentLinkForInvoice', {
          invoice_id: invoice.id,
        });
        payUrl = result?.data?.payment_url || '';
      } catch (e) {
        console.warn('[invoice-details] Stripe link failed; texting without pay link:', e?.message);
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
        senderEmail: user?.email || effectiveUserEmail || undefined,
        paymentInvoiceId: invoice.id,
      });
      requireMessageSubmission(res, 'sms');
      return phone;
    },
    onSuccess: async (phone) => {
      toast.success(`Invoice submitted to the text provider for ${phone}. Delivery is not yet confirmed.`);
      // Only advance a not-yet-settled invoice. Texting a receipt-style copy of
      // a paid or partially paid invoice must never rewrite its payment status.
      // Both 'partial' and 'partially_paid' exist in real data for the same
      // state; missing either one would reset a part-paid invoice to 'sent'.
      const status = String(invoice?.status || '').toLowerCase();
      if (!['paid', 'cancelled', 'void', 'refunded'].includes(status)) {
        try {
          await base44.entities.Invoice.update(invoice.id, {
            ...(status === 'draft' ? { status: 'sent' } : {}),
            sent_date: new Date().toISOString(),
          });
        } catch (e) {
          console.warn('[invoice-details] could not mark invoice sent after SMS:', e?.message);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['invoice', invoice.id] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (error) => {
      toast.error(`❌ Failed to text invoice: ${error.message}`);
    },
  });
  // --- end payment request hooks ---

  if (!invoice) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading invoice...</p>
        </div>
      </div>
    );
  }

  // 🔐 Access guard: non-admins can only view invoices they're the sale agent on,
  // or where the customer is assigned to them
  if (isPermissionsReady && !isAdmin && effectiveUserEmail) {
    const relatedCustomer = specificCustomer || customers.find(c =>
      String(c.id) === String(invoice.customer_id || '')
    );
    const hasAccess = 
      invoice.sale_agent === effectiveUserEmail ||
      (relatedCustomer && (
        relatedCustomer.assigned_to === effectiveUserEmail ||
        relatedCustomer.assigned_to_users?.includes(effectiveUserEmail) ||
        relatedCustomer.created_by === effectiveUserEmail
      ));
    if (!hasAccess) {
      return (
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <p className="text-gray-600">You don't have access to this invoice.</p>
          </div>
        </div>
      );
    }
  }

  const getStatusColor = (status) => {
    const colors = {
      'paid': 'bg-green-100 text-green-700 border-green-200',
      'sent': 'bg-blue-100 text-blue-700 border-blue-200',
      'viewed': 'bg-purple-100 text-purple-700 border-purple-200',
      'draft': 'bg-gray-100 text-gray-700 border-gray-200',
      'overdue': 'bg-red-100 text-red-700 border-red-200',
      'partially_paid': 'bg-orange-100 text-orange-700 border-orange-200',
      'deposit_request': 'bg-amber-100 text-amber-700 border-amber-200',
    };
    return colors[status] || 'bg-gray-100 text-gray-700 border-gray-200';
  };

  const invoiceItems = invoice.items || invoice.line_items || [];
  const subtotal = invoiceItems.reduce((sum, item) => sum + Number(item.rcv || item.amount || 0), 0) || 0;
  const discountAmount = invoice.discount_type === "percentage"
    ? subtotal * (Number(invoice.discount_value || 0) / 100)
    : invoice.discount_type === "fixed"
      ? Number(invoice.discount_value || 0)
      : 0;
  const computedTotal = subtotal - discountAmount + Number(invoice.adjustment_amount || 0);
  const total = (invoice.discount_type && invoice.discount_type !== "none" && invoice.discount_value > 0)
    ? computedTotal
    : Number(invoice.total_amount || invoice.amount || 0);
  const amountPaid = Number(invoice.amount_paid || 0);
  const amountDue = total - amountPaid;
  const hasRemainingBalance = hasRemainingBalanceForDeduction(amountDue);

  const depositType = invoice.data?.deposit_type || 'none';
  const depositValue = Number(invoice.data?.deposit_value || 0);
  const depositAmount = depositType === 'percentage' ? total * depositValue / 100
                      : depositType === 'fixed' ? depositValue : 0;
  const isDepositRequest = depositAmount > 0 && amountPaid === 0;

  const calculateRepCommissionForInvoice = (repEmail, invoice) => {
    const staffProfile = staffProfiles.find(s => s.user_email === repEmail);
    const commissionRate = staffProfile?.commission_rate || 10;
    const split = invoice.commission_splits?.find(cs => cs.user_email === repEmail);
    const splitPercentage = split ? split.split_percentage / 100 : 1;
    
    const totalPotentialCommission = Number(invoice.total_amount || invoice.amount || 0) * (commissionRate / 100) * splitPercentage;
    const paidRatio = Number(invoice.amount_paid || 0) / Number(invoice.total_amount || invoice.amount || 1);
    const earnedCommission = totalPotentialCommission * paidRatio;
    const remainingCommission = totalPotentialCommission - earnedCommission;
    
    return {
      potential: totalPotentialCommission,
      earned: earnedCommission,
      remaining: remainingCommission
    };
  };

  const logPaymentRequestEntry = async (amount, method, delivery = {}) => {
    const existing = invoice?.payment_requests || [];
    const entry = {
      id: Date.now().toString(),
      amount: parseFloat(amount),
      method,
      date: new Date().toISOString(),
      requested_by: user?.email || effectiveUserEmail || '',
      ...delivery,
    };
    await base44.entities.Invoice.update(invoice.id, {
      payment_requests: [...existing, entry],
    });
    queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
  };

  const paymentRequestDeliveryLabel = (request) => {
    if (request.method === 'email') {
      const status = paymentEmailDelivery[request.communication_id];
      if (status === 'delivered') return 'Email delivered';
      if (status === 'bounced') return 'Email bounced';
      if (status === 'complained') return 'Email marked as spam';
      if (status === 'failed') return 'Email failed';
      return request.status === 'submitted' ? 'Email submitted · delivery unconfirmed' : 'Unverified email attempt · delivery unknown';
    }
    if (request.method === 'sms') return request.status === 'submitted'
      ? 'Text submitted · delivery unconfirmed' : 'Unverified text attempt · delivery unknown';
    return request.method === 'stripe' ? 'Stripe link' : 'Copied';
  };

  const deletePaymentRequest = async (reqId) => {
    const updated = (invoice?.payment_requests || []).filter(r => r.id !== reqId);
    await base44.entities.Invoice.update(invoice.id, { payment_requests: updated });
    queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
  };

  const saveEditedPaymentRequest = async (reqId) => {
    const newAmt = parseFloat(editingRequestAmount);
    if (!newAmt || newAmt <= 0) return;
    const updated = (invoice?.payment_requests || []).map(r =>
      r.id === reqId ? { ...r, amount: newAmt } : r
    );
    await base44.entities.Invoice.update(invoice.id, { payment_requests: updated });
    queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
    setEditingRequestId(null);
    setEditingRequestAmount('');
  };

  const handleCopyPaymentDetails = async () => {
    const amt = parseFloat(requestAmount) > 0 ? parseFloat(requestAmount) : amountDue;
    const paymentText = `Payment Request from ${myCompany?.company_name || 'Your Company'}

Invoice #: ${invoice.invoice_number}
Customer: ${invoice.customer_name}
Amount Requested: $${amt.toFixed(2)}${Math.abs(amt - amountDue) > 0.01 ? ` (Total balance: $${amountDue.toFixed(2)})` : ''}
Due Date: ${invoice.due_date ? format(new Date(invoice.due_date), 'MMMM d, yyyy') : 'Not set'}

Please send payment to:
${myCompany?.company_name || 'Company Name'}
${myCompany?.email || 'Email not set'}
${myCompany?.phone || 'Phone not set'}

Payment methods accepted:
- Stripe (Card, ACH, Cash App)
- Zelle
- Check
- Cash`;

    navigator.clipboard.writeText(paymentText);
    toast.success('✅ Payment details copied!');
    await logPaymentRequestEntry(amt, 'copy');
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Invoice {invoice.invoice_number}</h1>
          <Badge variant="outline" className={getStatusColor(invoice.status)}>
            {invoice.status}
          </Badge>
          {(() => {
            const qbId = invoice.quickbooks_invoice_id;
            const qbUrl = buildQBInvoiceUrl(qbId);
            if (qbUrl) {
              return (
                <a
                  href={qbUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View in QuickBooks"
                  data-testid="badge-qb-invoice-detail"
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700 border border-green-300 hover:bg-green-200 transition-colors"
                >
                  QB ✓
                  <ExternalLink className="w-3 h-3" />
                </a>
              );
            }
            if (qbId === QB_MANUAL_SENTINEL) {
              return (
                <span
                  data-testid="badge-qb-invoice-manual"
                  title="Marked as already in QuickBooks (manually entered — won't be synced again)"
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200"
                >
                  In QB
                </span>
              );
            }
            if (qbStatus?.connected) {
              return (
                <span
                  data-testid="badge-qb-invoice-pending"
                  title="This invoice hasn't been pushed to QuickBooks yet"
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200"
                >
                  QB Pending
                </span>
              );
            }
            return null;
          })()}
        </div>

        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleDownloadPDF}
            disabled={isDownloading}
          >
            {isDownloading ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            Download
          </Button>
          {invoice.status !== 'paid' && (
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700"
              onClick={async () => {
                const targetEmail = invoice.customer_email || customer?.email;
                if (!targetEmail) {
                  toast.error('Cannot send invoice', { description: 'Customer email is missing. Please add a customer email first.' });
                  return;
                }
                
                // If invoice is missing email but customer has one, update it first so backend can use it
                if (!invoice.customer_email && customer?.email) {
                   try {
                     await base44.entities.Invoice.update(invoice.id, { customer_email: customer.email });
                   } catch (e) {
                     console.error("Failed to auto-update invoice email", e);
                   }
                }
                
                sendInvoiceMutation.mutate();
              }}
              disabled={sendInvoiceMutation.isPending}
            >
              <Send className="w-4 h-4 mr-2" />
              {sendInvoiceMutation.isPending ? 'Sending...' : 'Send Invoice'}
            </Button>
          )}
          {invoice.status !== 'paid' && (
            <Button
              size="sm"
              variant="outline"
              className="border-green-500 text-green-700 hover:bg-green-50"
              onClick={() => sendInvoiceSmsMutation.mutate()}
              disabled={sendInvoiceSmsMutation.isPending || !hasTextablePhone(invoice.customer_phone, customer?.phone, customer?.phone_2)}
              title={!hasTextablePhone(invoice.customer_phone, customer?.phone, customer?.phone_2)
                ? 'Add a phone number for this customer first'
                : 'Text this invoice to the customer'}
              data-testid="button-text-invoice"
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              {sendInvoiceSmsMutation.isPending ? 'Texting...' : 'Text Invoice'}
            </Button>
          )}

          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowDeleteInvoiceDialog(true)}
              className="border-red-500 text-red-700 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setIsEditing(true)}>
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.info('Duplicate functionality coming soon')}>
                <Copy className="w-4 h-4 mr-2" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={async () => {
                try {
                  toast.info('Syncing to QuickBooks...');
                  const res = await base44.functions.invoke('syncQuickBooksInvoice', { invoice_id: invoice?.id });
                  if (res.data?.success) {
                    toast.success('Invoice synced to QuickBooks');
                  } else {
                    toast.error(res.data?.error || 'QuickBooks sync failed');
                  }
                } catch (e) {
                  toast.error('QuickBooks sync failed: ' + e.message);
                }
              }}>
                <Calculator className="w-4 h-4 mr-2" />
                Sync to QuickBooks
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem 
                  className="text-red-600"
                  onClick={() => setShowDeleteInvoiceDialog(true)}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm" data-testid="invoice-email-delivery">
          <p className="font-semibold text-blue-900">Customer invoice email</p>
          {deliverySummaryError ? (
            <p className="text-red-700">Delivery history could not be loaded. Do not assume the invoice was delivered.</p>
          ) : !deliverySummary ? (
            <p className="text-blue-800">Checking recorded send attempts…</p>
          ) : latestInvoiceEmail ? (
            <div className="text-blue-800">
              <p>{emailDeliveryLabel(latestInvoiceEmail.delivery_status || latestInvoiceEmail.status)}
                {latestInvoiceEmail.purpose ? '' : ' (older invoice-related email; purpose unverified)'}.
              </p>
              <p>To: {latestInvoiceEmail.contact_email} · {new Date(latestInvoiceEmail.created_at).toLocaleString()}</p>
              {invoiceEmailAttempts.length > 1 && <p>{invoiceEmailAttempts.length} recorded invoice-related attempts. Latest shown.</p>}
            </div>
          ) : (
            <p className="text-blue-800">
              No invoice email attempt recorded. A “sent” status or a recorded payment alone does not prove delivery.
              Check before sending again if the customer might have received it another way.
            </p>
          )}
        </div>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="invoice">Invoice</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
              <TabsTrigger value="measurements">Measurements</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="activity">Activity Log</TabsTrigger>
            <TabsTrigger value="reminders">Reminders</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="payments">
            <Card>
              <CardContent className="p-3 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold">Payments History ({payments.length})</h2>
                  <div className="flex gap-2 flex-wrap justify-end">
                    {hasRemainingBalance && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (!paymentDeductionsEnabled) {
                            toast.info('Withheld-fee recording is disabled for this company. An admin can enable it in General Settings under Payment Deductions.');
                            return;
                          }
                          setShowDeductionPanel(p => !p);
                        }}
                        className={paymentDeductionsEnabled
                          ? 'border-amber-400 text-amber-700 hover:bg-amber-50'
                          : 'border-gray-300 text-gray-600 hover:bg-gray-50'}
                        title={paymentDeductionsEnabled
                          ? 'Record a fee withheld from the payment by Sedgwick or another third party'
                          : 'An admin must enable Payment Deductions in General Settings before this can be recorded'}
                        data-testid="button-show-fee-deduction"
                      >
                        <MinusCircle className="w-4 h-4 mr-2" />
                        Record Withheld Fee
                      </Button>
                    )}
                    <Button onClick={() => setShowCheckScanDialog(true)} className="bg-blue-600 hover:bg-blue-700">
                      <Camera className="w-4 h-4 mr-2" />
                      Scan Check
                    </Button>
                    <Button onClick={() => setShowPaymentDialog(true)} className="bg-green-600 hover:bg-green-700">
                      <DollarSign className="w-4 h-4 mr-2" />
                      Record Payment
                    </Button>
                  </div>
                </div>
                {hasRemainingBalance && !paymentDeductionsEnabled && (
                  <p className="mb-4 text-xs text-gray-600" data-testid="text-fee-deduction-disabled">
                    The remaining balance may be an insurer or Sedgwick withholding. Withheld-fee recording is disabled for this company; an admin can enable it in General Settings under Payment Deductions.
                  </p>
                )}

                {/* Standalone Fee Deduction panel */}
                {showDeductionPanel && paymentDeductionsEnabled && (
                  <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-amber-800">Record Fee Deduction</p>
                      <button onClick={() => setShowDeductionPanel(false)} className="text-amber-500 hover:text-amber-700">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-xs text-amber-700">
                      Use this when a third party takes their fee out of the money before it reaches you. It logs the fee as an expense and drops the invoice balance by that amount — no cash received on your end. Record the fee first, then record the payment you actually received.
                    </p>
                    <FeeDeductionCalculator
                      types={deductionTypeOptions}
                      invoiceTotal={total}
                      remainingBalance={amountDue}
                      pending={recordStandaloneDeductionMutation.isPending}
                      onRecord={input => recordStandaloneDeductionMutation.mutate(input)}
                    />
                  </div>
                )}
                <div className="space-y-3">
                  {payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                      <div>
                        <div className="font-medium">{payment.payment_number}</div>
                        <div className="text-sm text-gray-500">
                          {payment.payment_date ? format(new Date(payment.payment_date), 'MMM d, yyyy') : ''}
                        </div>
                        <div className="text-xs text-gray-400">{payment.payment_method}</div>
                        <div className="mt-2 text-xs text-gray-600" data-testid={`payment-alert-${payment.id}`}>
                          {deliverySummaryError ? 'Staff alert history unavailable' : !deliverySummary ? 'Checking staff alerts…' :
                            (deliverySummary.paymentAlerts || []).filter(alert => alert.payment_id === payment.id).length === 0
                              ? (deliverySummary.unroutedPaymentIds || []).includes(payment.id)
                                ? 'No active administrator or assigned rep was configured for an alert.'
                                : 'Staff notification status unknown for this payment.'
                              : (deliverySummary.paymentAlerts || []).filter(alert => alert.payment_id === payment.id).map((alert, index) => (
                                <p key={`${alert.recipient}-${index}`}>
                                  {alert.recipient}: {staffChannelLabel(alert.bell_status)}
                                  {alert.deferred_until ? ` until ${new Date(alert.deferred_until).toLocaleString()}` : ''};
                                  {' '}email {staffChannelLabel(alert.email_status).toLowerCase()};
                                  {' '}SMS {staffChannelLabel(alert.sms_status).toLowerCase()}.
                                </p>
                              ))
                          }
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="font-semibold text-green-600">${Number(payment.amount || 0).toFixed(2)}</div>
                          <Badge variant="outline" className="bg-green-100 text-green-700">
                            {payment.status}
                          </Badge>
                        </div>
                        {(payment.withheld_expense_id || payment.data?.withheld_expense_id || String(payment.notes || payment.data?.notes || '').includes('deducted from payment, no cash received')) && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={undoStandaloneDeductionMutation.isPending}
                            data-testid={`button-undo-deduction-${payment.id}`}
                            onClick={() => {
                              if (window.confirm('Undo this fee deduction? This removes the offset payment AND its matching expense and restores the deducted amount to the invoice balance.')) {
                                undoStandaloneDeductionMutation.mutate(payment);
                              }
                            }}
                          >
                            Undo Fee Deduction
                          </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-blue-600 hover:bg-blue-50"
                            onClick={() => {
                              setSelectedPayment(payment);
                              setEditPaymentMethod((payment.payment_method || 'cash'));
                              setEditPaymentDate(payment.payment_date || localToday());
                              setEditPaymentOpen(true);
                            }}
                            title="Edit payment"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                      </div>
                    </div>
                  ))}
                  {payments.length === 0 && (
                    <div className="text-center py-12 text-gray-500">
                      <CreditCard className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                      <p>No payments linked to this invoice</p>
                    </div>
                  )}
                </div>

                {/* Unlinked Payments Section */}
                {unlinkedPayments.length > 0 && (
                    <div className="mt-8 pt-6 border-t">
                        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                            <AlertCircle className="w-5 h-5 text-orange-600" />
                            Unlinked Payments for {customer?.name}
                        </h3>
                        <p className="text-sm text-gray-600 mb-4">
                            These payments are recorded for this customer but not linked to any invoice. Click "Link" to apply them to this invoice.
                        </p>
                        <div className="space-y-3">
                            {unlinkedPayments.map((payment) => (
                                <div key={payment.id} className="flex items-center justify-between p-4 border border-orange-200 bg-orange-50 rounded-lg">
                                    <div>
                                        <div className="font-medium">{payment.payment_number}</div>
                                        <div className="text-sm text-gray-500">
                                            {payment.payment_date ? format(new Date(payment.payment_date), 'MMM d, yyyy') : ''}
                                        </div>
                                        <div className="text-xs text-gray-400">{payment.payment_method}</div>
                                        {payment.notes && <div className="text-xs text-gray-500 mt-1 italic">{payment.notes}</div>}
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="font-semibold text-green-600">${Number(payment.amount || 0).toFixed(2)}</div>
                                        <Button 
                                            size="sm" 
                                            onClick={() => linkPaymentMutation.mutate(payment)}
                                            disabled={linkPaymentMutation.isPending}
                                            className="bg-blue-600 hover:bg-blue-700"
                                        >
                                            {linkPaymentMutation.isPending ? 'Linking...' : 'Link to Invoice'}
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Payments on OTHER invoices for this customer — can be re-linked here */}
                {otherInvoicePayments.length > 0 && (
                    <div className="mt-8 pt-6 border-t">
                        <div className="flex items-start justify-between mb-2">
                            <h3 className="text-lg font-semibold flex items-center gap-2">
                                <AlertCircle className="w-5 h-5 text-blue-600" />
                                Payments on Other Invoices for {customer?.name}
                            </h3>
                            {otherInvoicePayments.length > 1 && (
                                <Button
                                    size="sm"
                                    className="bg-blue-600 hover:bg-blue-700 shrink-0"
                                    disabled={linkAllPaymentsMutation.isPending}
                                    onClick={() => setShowRelinkAllDialog(true)}
                                >
                                    {linkAllPaymentsMutation.isPending ? 'Linking all...' : `Re-link All (${otherInvoicePayments.length})`}
                                </Button>
                            )}
                        </div>
                        <p className="text-sm text-gray-600 mb-4">
                            These payments were recorded for this customer but linked to a different invoice. If they should apply here, click "Re-link to this Invoice".
                        </p>
                        <div className="space-y-3">
                            {otherInvoicePayments.map((payment) => (
                                <div key={payment.id} className="flex items-center justify-between p-4 border border-blue-200 bg-blue-50 rounded-lg">
                                    <div>
                                        <div className="font-medium">{payment.payment_number}</div>
                                        <div className="text-sm text-gray-500">
                                            {payment.payment_date ? format(new Date(payment.payment_date), 'MMM d, yyyy') : '—'}
                                        </div>
                                        <div className="text-xs text-gray-500">{payment.payment_method}</div>
                                        <div className="text-xs text-blue-600 mt-0.5">
                                            Currently on: {payment.invoice_number || payment.invoice_id}
                                        </div>
                                        {payment.notes && <div className="text-xs text-gray-500 mt-1 italic">{payment.notes}</div>}
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="font-semibold text-green-600">${Number(payment.amount || 0).toFixed(2)}</div>
                                        <Button
                                            size="sm"
                                            onClick={() => {
                                                setRelinkPaymentTarget(payment);
                                                setShowRelinkPaymentDialog(true);
                                            }}
                                            disabled={linkPaymentMutation.isPending}
                                            className="bg-blue-600 hover:bg-blue-700"
                                        >
                                            {linkPaymentMutation.isPending ? 'Linking...' : 'Re-link to this Invoice'}
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {sameNumberOtherCustomerPayments.length > 0 && (
                    <div className="mt-8 pt-6 border-t">
                        <div className="flex items-start justify-between mb-2">
                            <h3 className="text-lg font-semibold flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5 text-amber-600" />
                                Invoice-number collision — payments are not applied here
                            </h3>
                        </div>
                        <p className="text-sm text-amber-800 mb-4">
                            These payments contain the same display number <strong>{invoice?.invoice_number}</strong>, but their authoritative invoice IDs point to another customer or invoice. They are not part of this invoice&apos;s payment history. Review the payer and payment date before moving one here.
                        </p>
                        <div className="space-y-3">
                            {sameNumberOtherCustomerPayments.map((payment) => (
                                <div key={payment.id} className="flex items-center justify-between p-4 border border-amber-300 bg-amber-50 rounded-lg">
                                    <div>
                                        <div className="font-medium">{payment.payment_number || payment.id}</div>
                                        <div className="text-sm text-gray-600">
                                            {payment.payment_date ? format(new Date(payment.payment_date), 'MMM d, yyyy') : 'Date not recorded'}
                                            {' · '}{payment.payment_method || 'payment'}
                                        </div>
                                        <div className="text-xs text-gray-600 mt-1">
                                            Currently applied to: {payment.customer_name || payment.customer_id || 'Unknown customer'}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                            Existing invoice ID: {payment.invoice_id}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="font-semibold text-green-600">${Number(payment.amount || 0).toFixed(2)}</div>
                                        <Button
                                            size="sm"
                                            onClick={() => {
                                                setRelinkPaymentTarget(payment);
                                                setShowRelinkPaymentDialog(true);
                                            }}
                                            disabled={linkPaymentMutation.isPending}
                                            className="bg-amber-600 hover:bg-amber-700"
                                        >
                                            Review & Move Here
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Force Mark as Paid — for when payments were recorded on other invoices */}
                {invoice?.status !== 'paid' && invoice?.status !== 'cancelled' && (
                    <div className="mt-8 pt-6 border-t">
                        <h3 className="text-base font-semibold mb-1 text-gray-700">Already collected all payments?</h3>
                        <p className="text-sm text-gray-500 mb-3">
                            If the full balance has been collected but was recorded on a different invoice, use this to mark the invoice as paid without creating a new payment entry.
                        </p>
                        <Button
                            variant="outline"
                            className="border-green-500 text-green-700 hover:bg-green-50"
                            onClick={() => setShowForceMarkPaidDialog(true)}
                            disabled={forceMarkPaidMutation.isPending}
                        >
                            <CheckCircle className="w-4 h-4 mr-2" />
                            {forceMarkPaidMutation.isPending ? 'Updating...' : 'Mark as Paid in Full (No New Payment)'}
                        </Button>
                    </div>
                )}

                {/* Edit Payment Dialog */}
                <Dialog open={editPaymentOpen} onOpenChange={setEditPaymentOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Edit Payment</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                      <div>
                        <Label>Payment Method</Label>
                        <Select value={editPaymentMethod} onValueChange={setEditPaymentMethod}>
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cash">Cash</SelectItem>
                            <SelectItem value="check">Check</SelectItem>
                            <SelectItem value="credit_card">Credit Card</SelectItem>
                            <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                            <SelectItem value="paypal">PayPal</SelectItem>
                            <SelectItem value="stripe">Stripe</SelectItem>
                            <SelectItem value="cash_app">Cash App</SelectItem>
                            <SelectItem value="zelle">Zelle</SelectItem>
                            <SelectItem value="venmo">Venmo</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Payment Date</Label>
                        <Input type="date" value={editPaymentDate} onChange={(e) => setEditPaymentDate(e.target.value)} className="mt-1" />
                      </div>
                      <div className="flex justify-end gap-3 pt-2">
                        <Button variant="outline" onClick={() => setEditPaymentOpen(false)}>Cancel</Button>
                        <Button onClick={handleSavePaymentEdit} className="bg-blue-600 hover:bg-blue-700">Save</Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
                </CardContent>
                </Card>
          </TabsContent>

          <TabsContent value="measurements">
            <PhotoMeasurementUploader
              invoiceId={invoice?.id}
              jobId={invoice?.job_id || invoice?.inspection_job_id || invoice?.data?.job_id || invoice?.data?.inspection_job_id}
              companyId={myCompany?.id}
            />
          </TabsContent>

          <TabsContent value="invoice">
            {isEditing && editForm ? (
              <Card>
                <CardContent className="p-3 sm:p-6 space-y-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold">Edit Invoice</h2>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => {
                        setIsEditing(false);
                        setEditForm({
                          customer_name: invoice.customer_name || '',
                          customer_email: invoice.customer_email || '',
                          issue_date: invoice.issue_date || '',
                          due_date: invoice.due_date || '',
                          items: invoice.items || invoice.line_items || [],
                          notes: invoice.notes || '',
                          claim_number: invoice.claim_number || '',
                          insurance_company: invoice.insurance_company || '',
                          discount_type: invoice.discount_type || 'none',
                          discount_value: invoice.discount_value || 0,
                          adjustment_amount: invoice.adjustment_amount || 0,
                          deposit_type: invoice.data?.deposit_type || 'none',
                          deposit_value: invoice.data?.deposit_value || 0,
                          deductible_amount: Number(invoice.deductible_amount || invoice.data?.deductible_amount || 0),
                          supplement_amount: Number(invoice.data?.supplement_amount || invoice.supplement_amount || 0),
                          depreciation_held: Number(invoice.data?.depreciation_held || invoice.depreciation_held || 0),
                        });
                      }}>
                        Cancel
                      </Button>
                      <Button onClick={handleSaveInvoice} disabled={updateInvoiceMutation.isPending} className="bg-blue-600 hover:bg-blue-700">
                        {updateInvoiceMutation.isPending ? 'Saving...' : 'Save Changes'}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Customer Name</Label>
                      <Input
                        value={editForm.customer_name}
                        onChange={(e) => setEditForm({...editForm, customer_name: e.target.value})}
                      />
                    </div>
                    <div>
                      <Label>Customer Email</Label>
                      <Input
                        type="email"
                        value={editForm.customer_email}
                        onChange={(e) => setEditForm({...editForm, customer_email: e.target.value})}
                      />
                    </div>

                    <div>
                      <Label>Issue Date</Label>
                      <Input
                        type="date"
                        value={editForm.issue_date}
                        onChange={(e) => setEditForm({...editForm, issue_date: e.target.value})}
                      />
                    </div>
                    <div>
                      <Label>Due Date</Label>
                      <Input
                        type="date"
                        value={editForm.due_date}
                        onChange={(e) => setEditForm({...editForm, due_date: e.target.value})}
                      />
                    </div>
                    <div>
                      <Label>Claim Number</Label>
                      <Input
                        value={editForm.claim_number}
                        onChange={(e) => setEditForm({...editForm, claim_number: e.target.value})}
                      />
                    </div>
                    <div>
                      <Label>Insurance Company</Label>
                      <Input
                        value={editForm.insurance_company}
                        onChange={(e) => setEditForm({...editForm, insurance_company: e.target.value})}
                      />
                    </div>
                  </div>

                  {/* Insurance Claim Amounts */}
                  <div className="pt-4 border-t">
                    <h3 className="font-semibold mb-3 text-blue-800">🏦 Insurance Claim Amounts</h3>
                    <p className="text-xs text-gray-500 mb-3">These fields track insurance breakdown — they don't change the invoice total, they're for your records and reports.</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <Label>Deductible Amount ($)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editForm.deductible_amount || ''}
                          onChange={(e) => setEditForm({...editForm, deductible_amount: parseFloat(e.target.value) || 0})}
                          placeholder="e.g. 1500.00"
                        />
                        <p className="text-xs text-gray-400 mt-1">Homeowner's out-of-pocket</p>
                      </div>
                      <div>
                        <Label>Supplement Amount ($)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editForm.supplement_amount || ''}
                          onChange={(e) => setEditForm({...editForm, supplement_amount: parseFloat(e.target.value) || 0})}
                          placeholder="e.g. 800.00"
                        />
                        <p className="text-xs text-gray-400 mt-1">
                          Reference only — does not change the invoice total. Bill it by adding line items.
                        </p>
                      </div>
                      <div>
                        <Label>Depreciation Held ($)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editForm.depreciation_held || ''}
                          onChange={(e) => setEditForm({...editForm, depreciation_held: parseFloat(e.target.value) || 0})}
                          placeholder="e.g. 2200.00"
                        />
                        <p className="text-xs text-gray-400 mt-1">Held back — released on completion</p>
                      </div>
                    </div>
                    {(editForm.deductible_amount > 0 || editForm.supplement_amount > 0 || editForm.depreciation_held > 0) && (() => {
                      const subtotal = editForm.items.reduce((s, i) => s + Number(i.amount || 0), 0);
                      let disc = 0;
                      if (editForm.discount_type === 'percentage') disc = subtotal * (editForm.discount_value / 100);
                      else if (editForm.discount_type === 'fixed') disc = editForm.discount_value;
                      const total = (subtotal - disc) + Number(editForm.adjustment_amount || 0);
                      const acv = total - Number(editForm.depreciation_held || 0);
                      // Supplement is deliberately NOT added here: it is a note of an
                      // approved amount, not billed money. It only reaches the balance
                      // once it is on the invoice as line items.
                      const insurancePays = acv - Number(editForm.deductible_amount || 0);
                      return (
                        <div className="mt-3 bg-blue-50 border border-blue-200 rounded p-3 text-sm space-y-1">
                          <div className="flex justify-between text-gray-700"><span>Invoice Total (RCV):</span><span className="font-semibold">${total.toFixed(2)}</span></div>
                          {editForm.depreciation_held > 0 && <div className="flex justify-between text-orange-700"><span>Less Depreciation Held:</span><span>-${Number(editForm.depreciation_held).toFixed(2)}</span></div>}
                          {editForm.depreciation_held > 0 && <div className="flex justify-between text-gray-700"><span>ACV (initial payment):</span><span>${acv.toFixed(2)}</span></div>}
                          {editForm.deductible_amount > 0 && <div className="flex justify-between text-red-700"><span>Less Deductible:</span><span>-${Number(editForm.deductible_amount).toFixed(2)}</span></div>}
                          <div className="flex justify-between font-bold border-t border-blue-300 pt-1 text-blue-900"><span>Insurance Pays:</span><span>${insurancePays.toFixed(2)}</span></div>
                          {editForm.supplement_amount > 0 && (
                            <div className="border-t border-blue-200 pt-1 mt-1">
                              <div className="flex justify-between text-gray-600"><span>Supplement approved (not billed):</span><span>${Number(editForm.supplement_amount).toFixed(2)}</span></div>
                              <p className="text-xs text-gray-500">Not included above — add line items to bill it.</p>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <Label className="text-lg">Line Items</Label>
                      <Button onClick={handleAddItem} size="sm" variant="outline">
                        <Plus className="w-4 h-4 mr-2" />
                        Add Item
                      </Button>
                    </div>
                    
                    <div className="space-y-3">
                      {editForm.items.map((item, index) => (
                        <Card key={index} className="border-2">
                          <CardContent className="p-4">
                            <div className="grid grid-cols-12 gap-3 items-start">
                              <div className="col-span-5">
                                <Label className="text-xs">Description</Label>
                                <Input
                                  value={item.description}
                                  onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                                  placeholder="Item description"
                                />
                              </div>
                              <div className="col-span-2">
                                <Label className="text-xs">Qty</Label>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={item.quantity}
                                  onChange={(e) => handleItemChange(index, 'quantity', parseFloat(e.target.value) || 0)}
                                />
                              </div>
                              <div className="col-span-2">
                                <Label className="text-xs">Rate</Label>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={item.rate}
                                  onChange={(e) => handleItemChange(index, 'rate', parseFloat(e.target.value) || 0)}
                                />
                              </div>
                              <div className="col-span-2">
                                <Label className="text-xs">Amount</Label>
                                <Input
                                  type="number"
                                  value={item.amount}
                                  disabled
                                  className="bg-gray-50"
                                />
                              </div>
                              <div className="col-span-1 flex items-end">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleRemoveItem(index)}
                                  className="text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>

                    <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold">Total:</span>
                        <span className="text-2xl font-bold text-green-600">
                          ${editForm.items.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label>Notes (visible to customer)</Label>
                    <Textarea
                      value={editForm.notes}
                      onChange={(e) => setEditForm({...editForm, notes: e.target.value})}
                      rows={4}
                      placeholder="Add any notes for the customer..."
                    />
                  </div>

                  {/* Discount & Adjustment */}
                  <div className="pt-4 border-t">
                    <h3 className="font-semibold mb-3">Discount & Adjustments</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <Label>Discount Type</Label>
                        <Select 
                          value={editForm.discount_type} 
                          onValueChange={(value) => setEditForm({...editForm, discount_type: value})}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No Discount</SelectItem>
                            <SelectItem value="percentage">Percentage (%)</SelectItem>
                            <SelectItem value="fixed">Fixed Amount ($)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {editForm.discount_type !== "none" && (
                        <div>
                          <Label>Discount Value</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={editForm.discount_value}
                            onChange={(e) => setEditForm({...editForm, discount_value: parseFloat(e.target.value) || 0})}
                            placeholder={editForm.discount_type === "percentage" ? "10" : "100.00"}
                          />
                        </div>
                      )}

                      <div>
                        <Label>Adjustment</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={editForm.adjustment_amount ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '') {
                              setEditForm({...editForm, adjustment_amount: 0});
                            } else {
                              const num = parseFloat(val);
                              setEditForm({...editForm, adjustment_amount: isNaN(num) ? 0 : num});
                            }
                          }}
                          onFocus={(e) => {
                            if (e.target.value === '0') {
                              e.target.select();
                            }
                          }}
                          placeholder="Enter -1189.75 to subtract"
                        />
                        <p className="text-xs text-gray-500 mt-1">+ or - amount (e.g., -1773.44)</p>
                      </div>

                      <div className="border-t pt-4">
                        <Label className="flex items-center gap-2 mb-2">
                          <span className="text-amber-700 font-semibold">Deposit Request</span>
                          <span className="text-xs text-gray-500">(optional — request partial payment upfront)</span>
                        </Label>
                        <Select
                          value={editForm.deposit_type}
                          onValueChange={(value) => setEditForm({...editForm, deposit_type: value, deposit_value: 0})}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No Deposit Request</SelectItem>
                            <SelectItem value="percentage">Percentage of Total (%)</SelectItem>
                            <SelectItem value="fixed">Fixed Amount ($)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {editForm.deposit_type !== 'none' && (
                        <div>
                          <Label>{editForm.deposit_type === 'percentage' ? 'Deposit Percentage (%)' : 'Deposit Amount ($)'}</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={editForm.deposit_value}
                            onChange={(e) => setEditForm({...editForm, deposit_value: parseFloat(e.target.value) || 0})}
                            placeholder={editForm.deposit_type === 'percentage' ? '50' : '8600.09'}
                          />
                          {(() => {
                            const previewSub = editForm.items.reduce((s, i) => s + Number(i.amount || 0), 0);
                            let previewDiscount = 0;
                            if (editForm.discount_type === 'percentage') previewDiscount = previewSub * (Number(editForm.discount_value || 0) / 100);
                            else if (editForm.discount_type === 'fixed') previewDiscount = Number(editForm.discount_value || 0);
                            const previewTotal = (previewSub - previewDiscount) + Number(editForm.adjustment_amount || 0);
                            const previewDeposit = editForm.deposit_type === 'percentage' ? previewTotal * editForm.deposit_value / 100 : editForm.deposit_value;
                            return previewDeposit > 0 ? (
                              <p className="text-xs text-amber-700 mt-1 font-medium">
                                Deposit due now: ${previewDeposit.toFixed(2)} — Invoice will show this as the amount owed
                              </p>
                            ) : null;
                          })()}
                        </div>
                      )}
                    </div>

                    {/* Totals Preview */}
                    <div className="mt-4 bg-white p-4 rounded border">
                      {(() => {
                        const subtotal = editForm.items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
                        let discount = 0;
                        if (editForm.discount_type === "percentage") {
                          discount = subtotal * (Number(editForm.discount_value || 0) / 100);
                        } else if (editForm.discount_type === "fixed") {
                          discount = Number(editForm.discount_value || 0);
                        }
                        const afterDiscount = subtotal - discount;
                        const total = afterDiscount + Number(editForm.adjustment_amount || 0);

                        return (
                          <div className="space-y-2 text-right">
                            <div className="flex justify-between">
                              <span className="text-gray-600">Subtotal:</span>
                              <span className="font-medium">${subtotal.toFixed(2)}</span>
                            </div>
                            {editForm.discount_type !== "none" && discount > 0 && (
                              <div className="flex justify-between text-red-600">
                                <span>Discount ({editForm.discount_type === "percentage" ? `${editForm.discount_value}%` : "Fixed"}):</span>
                                <span>-${discount.toFixed(2)}</span>
                              </div>
                            )}
                            {editForm.adjustment_amount !== 0 && (
                              <div className={`flex justify-between ${editForm.adjustment_amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                <span>Adjustment:</span>
                                <span>{Number(editForm.adjustment_amount || 0) > 0 ? '+' : ''}${Number(editForm.adjustment_amount || 0).toFixed(2)}</span>
                              </div>
                            )}
                            <div className="flex justify-between text-lg font-bold border-t pt-2">
                              <span>Total:</span>
                              <span>${total.toFixed(2)}</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="flex justify-end pt-4 border-t">
                    <Button
                      onClick={handleSaveInvoice}
                      disabled={updateInvoiceMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      {updateInvoiceMutation.isPending ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
            <div className="grid grid-cols-3 gap-6">
              <div className="col-span-2 space-y-6">
                {invoice.status === 'draft' && (
                  <Card className="bg-blue-50 border-blue-200">
                    <CardContent className="p-4">
                      <p className="text-sm text-blue-800">
                        This invoice is with status <strong>Draft</strong>, invoice will be auto-changed when you send the invoice to the customer or mark as sent.
                      </p>
                    </CardContent>
                  </Card>
                )}
                {invoice.status === 'partially_paid' && (
                  <Card className="bg-orange-50 border-orange-200">
                    <CardContent className="p-4">
                      <p className="text-sm text-orange-800">
                        This invoice is <strong>Partially Paid</strong>. Amount Due: <strong>${amountDue.toFixed(2)}</strong>.
                      </p>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardContent className="p-3 sm:p-6">
                    <div className="mb-6">
                      <h2 className="text-xl font-bold mb-4">Invoice - {invoice.invoice_number}</h2>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm font-semibold text-gray-600">Bill To:</p>
                          <p className="text-sm font-medium">{invoice.customer_name}</p>
                          {customer?.company && (
                            <p className="text-sm text-gray-600">{customer.company}</p>
                          )}
                          {customer?.street && (
                            <p className="text-sm text-gray-600">{customer.street}</p>
                          )}
                          {(customer?.city || customer?.state || customer?.zip) && (
                            <p className="text-sm text-gray-600">
                              {[customer.city, customer.state, customer.zip].filter(Boolean).join(', ')}
                            </p>
                          )}
                          {customer?.phone && (
                            <p className="text-sm text-gray-600">{customer.phone}</p>
                          )}
                          {invoice.customer_email && (
                            <p className="text-sm text-gray-600">{invoice.customer_email}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-sm"><span className="font-semibold">Invoice Date:</span> {invoice.issue_date ? format(new Date(invoice.issue_date), 'yyyy-MM-dd') : '-'}</p>
                          <p className="text-sm"><span className="font-semibold">Due Date:</span> {invoice.due_date ? format(new Date(invoice.due_date), 'yyyy-MM-dd') : '-'}</p>
                          <p className="text-sm"><span className="font-semibold">Customer:</span> {invoice.customer_name}</p>
                          {invoice.claim_number && (
                            <p className="text-sm"><span className="font-semibold">Claim Number:</span> {invoice.claim_number}</p>
                          )}
                          {invoice.insurance_company && (
                            <p className="text-sm"><span className="font-semibold">Ins. Company:</span> {invoice.insurance_company}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto mb-6">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">#</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">Item</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">Description</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-600">Qty</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-600">Rate</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-600">Tax</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-600">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoiceItems.map((item, index) => (
                            <tr key={index} className="border-b">
                              <td className="px-4 py-3 text-sm">{index + 1}</td>
                              <td className="px-4 py-3 text-sm">{item.description || 'Item'}</td>
                              <td className="px-4 py-3 text-sm text-gray-600">{item.description || '-'}</td>
                              <td className="px-4 py-3 text-sm text-center">{item.quantity || 1}</td>
                              <td className="px-4 py-3 text-sm text-right">${Number(item.rate || 0).toFixed(2)}</td>
                              <td className="px-4 py-3 text-sm text-right">0%</td>
                              <td className="px-4 py-3 text-sm text-right font-semibold">${Number(item.rcv || item.amount || 0).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex justify-end">
                      <div className="w-64">
                        <div className="flex justify-between py-2 border-b">
                          <span className="text-sm">Subtotal</span>
                          <span className="text-sm font-semibold">${subtotal.toFixed(2)}</span>
                        </div>
                        {invoice.discount_type !== "none" && invoice.discount_value > 0 && (() => {
                          const discount = invoice.discount_type === "percentage" 
                            ? subtotal * (invoice.discount_value / 100)
                            : invoice.discount_value;
                          return (
                            <div className="flex justify-between py-2 border-b text-red-600">
                              <span className="text-sm">
                                Discount ({invoice.discount_type === "percentage" ? `${invoice.discount_value}%` : "Fixed"}):
                              </span>
                              <span className="text-sm font-semibold">-${discount.toFixed(2)}</span>
                            </div>
                          );
                        })()}
                        {Number(invoice.adjustment_amount) !== 0 && (
                          <div className={`flex justify-between py-2 border-b ${invoice.adjustment_amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            <span className="text-sm">Adjustment:</span>
                            <span className="text-sm font-semibold">
                              {Number(invoice.adjustment_amount) > 0 ? '+' : ''}${Number(invoice.adjustment_amount || 0).toFixed(2)}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between py-2 border-b">
                          <span className="text-sm font-bold">Total (RCV)</span>
                          <span className="text-sm font-bold">${total.toFixed(2)}</span>
                        </div>
                        {(Number(invoice.deductible_amount || invoice.data?.deductible_amount) > 0 || Number(invoice.data?.supplement_amount || invoice.supplement_amount) > 0 || Number(invoice.data?.depreciation_held || invoice.depreciation_held) > 0) && (() => {
                          const dep = Number(invoice.data?.depreciation_held || invoice.depreciation_held || 0);
                          const ded = Number(invoice.deductible_amount || invoice.data?.deductible_amount || 0);
                          const sup = Number(invoice.data?.supplement_amount || invoice.supplement_amount || 0);
                          const acv = total - dep;
                          // Supplement stays out of this figure — see the edit form note:
                          // it is a recorded approval, not an amount billed on this invoice.
                          const insPays = acv - ded;
                          return (
                            <div className="mt-1 mb-1 bg-blue-50 border border-blue-200 rounded p-2 text-xs space-y-1">
                              <p className="font-semibold text-blue-800 mb-1">Insurance Breakdown</p>
                              {dep > 0 && <div className="flex justify-between text-orange-700"><span>Depreciation Held:</span><span>-${dep.toFixed(2)}</span></div>}
                              {dep > 0 && <div className="flex justify-between text-gray-600"><span>ACV (initial check):</span><span>${acv.toFixed(2)}</span></div>}
                              {ded > 0 && <div className="flex justify-between text-red-700"><span>Deductible:</span><span>-${ded.toFixed(2)}</span></div>}
                              <div className="flex justify-between font-bold border-t border-blue-300 pt-1 text-blue-900"><span>Insurance Pays:</span><span>${insPays.toFixed(2)}</span></div>
                              {sup > 0 && (
                                <div className="border-t border-blue-200 pt-1 mt-1">
                                  <div className="flex justify-between text-gray-600"><span>Supplement approved (not billed):</span><span>${sup.toFixed(2)}</span></div>
                                  <p className="text-[11px] text-gray-500">Not included above — add line items to bill it.</p>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {amountPaid > 0 && (
                          <div className="flex justify-between py-2 border-b text-green-600">
                            <span className="text-sm">Amount Paid</span>
                            <span className="text-sm font-semibold">-${amountPaid.toFixed(2)}</span>
                          </div>
                        )}
                        {isDepositRequest ? (
                          <div className="flex justify-between py-3 bg-amber-50 border border-amber-200 rounded px-2 mt-1">
                            <div>
                              <span className="text-lg font-bold text-amber-700">Deposit Due Now</span>
                              <p className="text-xs text-amber-600 mt-0.5">
                                {depositType === 'percentage' ? `${depositValue}% of total` : 'Fixed deposit'} · Balance ${(total - depositAmount).toFixed(2)} due on completion
                              </p>
                            </div>
                            <span className="text-lg font-bold text-amber-700">${depositAmount.toFixed(2)}</span>
                          </div>
                        ) : (
                          <div className="flex justify-between py-3">
                            <span className="text-lg font-bold text-red-600">Amount Due</span>
                            <span className="text-lg font-bold text-red-600">${amountDue.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {invoice.notes && (
                      <div className="mt-6 pt-6 border-t">
                        <h3 className="font-semibold mb-2">Note:</h3>
                        <p className="text-sm text-gray-600 whitespace-pre-wrap">{invoice.notes}</p>
                      </div>
                    )}

                    <div className="mt-6 pt-6 border-t">
                      <h3 className="font-semibold mb-2">Terms & Conditions</h3>
                      <p className="text-sm text-gray-600">
                        In addition, all work is backed by 3-year workmanship, with no defect warranty. If for any reason, the home experience any leakage around the area that was repaired or replaced, we will gladly fix the problem at no charge to the homeowner. In addition, a 5-year warranty extends to the roof valley for a 2-year period.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="col-span-1">
                <Card>
                  <CardContent className="p-4 space-y-4">
                    <div>
                      <h3 className="font-semibold text-sm mb-2">Invoice Information</h3>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Status:</span>
                          <Badge variant="outline" className={getStatusColor(invoice.status)}>
                            {invoice.status || 'draft'}
                          </Badge>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Invoice Number:</span>
                          <span className="font-medium">{invoice.invoice_number}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Customer:</span>
                          <span className="font-medium">{invoice.customer_name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Email:</span>
                          <span className="font-medium">{invoice.customer_email || '-'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Issue Date:</span>
                          <span className="font-medium">
                            {invoice.issue_date ? format(new Date(invoice.issue_date), 'yyyy-MM-dd') : '-'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Due Date:</span>
                          <span className="font-medium">
                            {invoice.due_date ? format(new Date(invoice.due_date), 'yyyy-MM-dd') : '-'}
                          </span>
                        </div>
                        
                        <div className="border-t pt-3 mt-3">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-gray-600">Total Amount:</span>
                            <span className="font-semibold text-lg">${Number(invoice.total_amount || invoice.amount || 0).toFixed(2)}</span>
                          </div>
                          {amountPaid > 0 && (
                            <div className="flex justify-between items-center mb-2 text-green-600">
                              <span>Amount Paid:</span>
                              <span className="font-semibold">-${amountPaid.toFixed(2)}</span>
                            </div>
                          )}
                          {isDepositRequest ? (
                            <div className="pt-2 border-t bg-amber-50 rounded p-2 -mx-1">
                              <div className="flex justify-between items-center">
                                <span className="font-semibold text-amber-700">Deposit Due:</span>
                                <span className="font-bold text-xl text-amber-700">${depositAmount.toFixed(2)}</span>
                              </div>
                              <p className="text-xs text-amber-600 mt-0.5">
                                Balance ${(total - depositAmount).toFixed(2)} due on completion
                              </p>
                            </div>
                          ) : (
                            <div className="flex justify-between items-center pt-2 border-t">
                              <span className="font-semibold text-gray-900">Amount Due:</span>
                              <span className={`font-bold text-xl ${amountDue > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                ${amountDue.toFixed(2)}
                              </span>
                            </div>
                          )}
                        </div>

                        {invoice.claim_number && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">Claim #:</span>
                            <span className="font-medium">{invoice.claim_number}</span>
                          </div>
                        )}
                        {invoice.insurance_company && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">Insurance:</span>
                            <span className="font-medium">{invoice.insurance_company}</span>
                          </div>
                        )}
                        </div>
                        </div>

                        {isAdmin && amountPaid > 0 && (
                        <div className="border-t pt-3 mt-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full text-red-600 border-red-300 hover:bg-red-50 text-xs"
                            onClick={() => setShowVoidPaymentDialog(true)}
                          >
                            Void / Clear Payment (${ amountPaid.toFixed(2)})
                          </Button>
                          <p className="text-xs text-gray-400 mt-1 text-center">Removes incorrectly applied payment</p>
                        </div>
                        )}

                        {isAdmin && (
                        <div className="border-t pt-4">
                        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                          <Split className="w-4 h-4 text-purple-600" />
                          Commission Split
                        </h3>
                        {invoice.commission_splits && invoice.commission_splits.length > 0 ? (
                          <div className="space-y-2 mb-3">
                            {invoice.commission_splits.map((split, idx) => {
                              const staffProfile = staffProfiles.find(s => s.user_email === split.user_email);
                              const repCommissionData = calculateRepCommissionForInvoice(split.user_email, invoice);
                              
                              return (
                                <Dialog key={idx}>
                                  <DialogTrigger asChild>
                                    <button className={`w-full border rounded p-2 hover:opacity-90 transition-colors text-left cursor-pointer ${split.paid ? 'bg-green-50 border-green-200' : 'bg-purple-50 border-purple-200'}`}>
                                      <div className="flex items-center justify-between">
                                        <p className="text-sm font-medium">{split.user_name}</p>
                                        {split.paid && <span className="text-xs text-green-700 font-semibold flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Paid</span>}
                                      </div>
                                      <p className={`text-xs ${split.paid ? 'text-green-700' : 'text-purple-700'}`}>{split.split_percentage}% - {split.role}</p>
                                    </button>
                                  </DialogTrigger>
                                  <DialogContent className="max-w-md">
                                    <DialogHeader>
                                      <DialogTitle className="flex items-center gap-2">
                                        <Split className="w-5 h-5 text-purple-600" />
                                        Commission Details - {split.user_name}
                                      </DialogTitle>
                                    </DialogHeader>
                                    <div className="space-y-4 py-4">
                                      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                                        <div className="flex justify-between items-center mb-3">
                                          <span className="text-sm text-gray-600">Invoice Amount:</span>
                                          <span className="font-bold">${Number(invoice.total_amount || invoice.amount || 0).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between items-center mb-3">
                                          <span className="text-sm text-gray-600">Amount Paid:</span>
                                          <span className="font-bold text-green-600">${Number(invoice.amount_paid || 0).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between items-center mb-3 pb-3 border-b">
                                          <span className="text-sm text-gray-600">Commission Rate:</span>
                                          <span className="font-bold">{staffProfile?.commission_rate || 10}%</span>
                                        </div>
                                        <div className="flex justify-between items-center mb-2">
                                          <span className="text-sm text-gray-600">Split Percentage:</span>
                                          <span className="font-bold text-purple-600">{split.split_percentage}%</span>
                                        </div>
                                        <div className="flex justify-between items-center mb-2">
                                          <span className="text-sm text-gray-600">Role:</span>
                                          <span className="font-medium">{split.role}</span>
                                        </div>
                                        <div className="flex justify-between items-center pt-3 border-t mt-3">
                                          <span className="text-base font-semibold">Earned Commission:</span>
                                          <span className="text-xl font-bold text-green-600">
                                            ${Number(repCommissionData.earned || 0).toFixed(2)}
                                          </span>
                                        </div>
                                        {repCommissionData.remaining > 0 && (
                                          <div className="flex justify-between items-center mt-2 text-orange-600">
                                            <span className="text-sm">Remaining (unpaid balance):</span>
                                            <span className="font-bold">${Number(repCommissionData.remaining || 0).toFixed(2)}</span>
                                          </div>
                                        )}
                                      </div>
                                      
                                      <div className="text-xs text-gray-500 space-y-1">
                                        <p><strong>📊 How commission is calculated:</strong></p>
                                        <p>1. Invoice amount × Commission rate = Total commission</p>
                                        <p>2. Total commission × Your split % = Your commission</p>
                                        <p>3. (Amount paid ÷ Invoice amount) × Your commission = Earned</p>
                                        <p className="mt-2 text-purple-700">
                                          <strong>Example:</strong> $10,000 invoice × 10% × 50% split = $500 potential commission. If $5,000 paid, you've earned $250.
                                        </p>
                                      </div>

                                      {/* Mark as Paid / Paid status */}
                                      <div className="border-t pt-3">
                                        {split.paid ? (
                                          <div>
                                            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded p-3">
                                              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                                              <div>
                                                <p className="text-sm font-semibold text-green-800">{split.paid_via === 'withheld' ? 'Fee withheld from payment' : 'Paid out'}</p>
                                                <p className="text-xs text-green-700">
                                                  {split.paid_date ? formatDateOnly(split.paid_date) : ''} · ${Number(split.paid_amount || 0).toFixed(2)}
                                                </p>
                                                <p className="text-xs text-green-600 mt-1">{split.paid_via === 'withheld' ? 'They kept this fee out of the payment — expense logged in your books.' : 'Expense logged in your books.'}</p>
                                              </div>
                                            </div>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="w-full mt-2 text-gray-500 hover:text-red-600"
                                              onClick={() => undoSplitPaidMutation.mutate({ splitIndex: idx, split })}
                                              disabled={undoSplitPaidMutation.isPending}
                                              data-testid="button-undo-split-paid"
                                            >
                                              {undoSplitPaidMutation.isPending ? 'Undoing...' : 'Undo — I recorded this wrong'}
                                            </Button>
                                          </div>
                                        ) : (
                                          <div>
                                            <p className="text-xs font-semibold text-gray-700 mb-1">How was this fee settled? Pick ONE:</p>
                                            <div className="bg-green-50/60 border border-green-200 rounded p-3">
                                              <p className="text-xs font-semibold text-green-800 mb-1">
                                                Option 1 — I sent {split.user_name} the money myself
                                              </p>
                                              <p className="text-xs text-green-700 mb-2">
                                                Money left your account (check, transfer, etc.). Logs an expense only — does NOT change what the customer owes on this invoice.
                                              </p>
                                              <div className="bg-white border rounded p-2 mb-2 flex justify-between text-sm">
                                                <span className="text-gray-600">Amount (invoice × {split.split_percentage}%):</span>
                                                <span className="font-bold">${(Number(invoice.total_amount || 0) * split.split_percentage / 100).toFixed(2)}</span>
                                              </div>
                                              <Button
                                                className="w-full bg-green-600 hover:bg-green-700 text-white"
                                                onClick={() => markCommissionPaidMutation.mutate({
                                                  splitIndex: idx,
                                                  split,
                                                  amount: Number(invoice.total_amount || 0) * split.split_percentage / 100
                                                })}
                                                disabled={markCommissionPaidMutation.isPending}
                                                data-testid="button-mark-commission-paid"
                                              >
                                                <CheckCircle className="w-4 h-4 mr-2" />
                                                {markCommissionPaidMutation.isPending ? 'Saving...' : 'I Paid Them — Log Expense'}
                                              </Button>
                                            </div>

                                            <div className="flex items-center gap-2 my-3">
                                              <div className="flex-1 border-t" />
                                              <span className="text-xs text-gray-400">or</span>
                                              <div className="flex-1 border-t" />
                                            </div>

                                            <div className="bg-amber-50 border border-amber-200 rounded p-3">
                                              <p className="text-xs font-semibold text-amber-800 mb-1">
                                                Option 2 — {split.user_name} kept their fee OUT of the payment
                                              </p>
                                              <p className="text-xs text-amber-700 mb-2">
                                                They deducted their fee before sending you the money (like Sedgwick withholding from a claim check). This closes out the remaining invoice balance AND logs the fee as an expense.
                                              </p>
                                              <div className="relative mb-2">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                                                <Input
                                                  type="number"
                                                  min="0.01"
                                                  step="0.01"
                                                  value={feeWithheldAmount}
                                                  onChange={(e) => setFeeWithheldAmount(e.target.value)}
                                                  placeholder={(amountDue > 0.005 ? amountDue : Number(invoice.total_amount || 0) * split.split_percentage / 100).toFixed(2)}
                                                  className="pl-7 pr-3 bg-white"
                                                  data-testid="input-fee-withheld-amount"
                                                />
                                              </div>
                                              {amountDue > 0.005 && (
                                                <p className="text-[11px] text-amber-600 mb-2">
                                                  Current balance: ${amountDue.toFixed(2)} (pre-filled if you leave the box empty)
                                                </p>
                                              )}
                                              <Button
                                                variant="outline"
                                                className="w-full border-amber-400 text-amber-800 hover:bg-amber-100"
                                                onClick={() => recordFeeWithheldMutation.mutate({
                                                  splitIndex: idx,
                                                  split,
                                                  amount: parseFloat(feeWithheldAmount) > 0
                                                    ? parseFloat(feeWithheldAmount)
                                                    : (amountDue > 0.005 ? amountDue : Number(invoice.total_amount || 0) * split.split_percentage / 100)
                                                })}
                                                disabled={recordFeeWithheldMutation.isPending}
                                                data-testid="button-record-fee-withheld"
                                              >
                                                {recordFeeWithheldMutation.isPending ? 'Recording...' : 'Record Withheld Fee + Close Balance'}
                                              </Button>
                                            </div>

                                            {/* Option 3 — ACH payout (only when add-on enabled + rep has bank set up) */}
                                            {myCompany?.data?.rep_payouts_enabled && staffProfile?.data?.stripe_express_account_id && (
                                              <>
                                                <div className="flex items-center gap-2 my-3">
                                                  <div className="flex-1 border-t" />
                                                  <span className="text-xs text-gray-400">or</span>
                                                  <div className="flex-1 border-t" />
                                                </div>
                                                <div className="bg-blue-50 border border-blue-200 rounded p-3">
                                                  <p className="text-xs font-semibold text-blue-800 mb-1">
                                                    Option 3 — Send {split.user_name} the money via ACH
                                                  </p>
                                                  <p className="text-xs text-blue-700 mb-2">
                                                    Sends the commission directly to {split.user_name}'s bank account via Stripe ACH. They'll receive it within 1–5 business days. An expense is logged automatically.
                                                  </p>
                                                  {staffProfile.data?.stripe_payout_status === 'active' ? (
                                                    <>
                                                      <div className="bg-white border rounded p-2 mb-2 flex justify-between text-sm">
                                                        <span className="text-gray-600">Amount (invoice × {split.split_percentage}%):</span>
                                                        <span className="font-bold">${(Number(invoice.total_amount || 0) * split.split_percentage / 100).toFixed(2)}</span>
                                                      </div>
                                                      <Button
                                                        className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                                                        onClick={() => {
                                                          setAchPayoutPendingIdx(idx);
                                                          initiateRepPayoutMutation.mutate({
                                                            splitIndex: idx,
                                                            split,
                                                            amount: Number(invoice.total_amount || 0) * split.split_percentage / 100,
                                                            staffProfile,
                                                          });
                                                        }}
                                                        disabled={initiateRepPayoutMutation.isPending && achPayoutPendingIdx === idx}
                                                        data-testid={`button-send-ach-payout-${idx}`}
                                                      >
                                                        <Banknote className="w-4 h-4 mr-2" />
                                                        {initiateRepPayoutMutation.isPending && achPayoutPendingIdx === idx ? 'Sending…' : `Send $${(Number(invoice.total_amount || 0) * split.split_percentage / 100).toFixed(2)} via ACH`}
                                                      </Button>
                                                    </>
                                                  ) : (
                                                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                                                      ⚠️ {split.user_name}'s bank account is still being verified by Stripe. Go to Settings → Rep ACH Payouts and click "Refresh" to check their status.
                                                    </p>
                                                  )}
                                                </div>
                                              </>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </DialogContent>
                                </Dialog>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500 mb-3">No commission split set</p>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => setShowCommissionSplitDialog(true)}
                        >
                          <UserPlus className="w-4 h-4 mr-2" />
                          {invoice.commission_splits?.length > 0 ? 'Edit Split' : 'Set Commission Split'}
                        </Button>
                        </div>
                        )}

                    {amountDue > 0 && (
                      <div className="border-t pt-4">
                        <div className="flex items-center gap-2 mb-3">
                          <CreditCard className="w-4 h-4 text-blue-600" />
                          <h3 className="font-semibold text-sm">Request Payment</h3>
                        </div>

                        {/* Editable request amount */}
                        <div className="mb-3">
                          <Label className="text-xs text-gray-500 mb-1 block">Request Amount</Label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                            <Input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={requestAmount}
                              onChange={(e) => setRequestAmount(e.target.value)}
                              className="pl-7 pr-3"
                              data-testid="input-request-amount"
                            />
                          </div>
                          <div className="flex justify-between mt-1 text-xs text-gray-400">
                            <span>Balance: <span className="font-medium text-red-600">${amountDue.toFixed(2)}</span></span>
                            {parseFloat(requestAmount) > 0 && Math.abs(parseFloat(requestAmount) - amountDue) > 0.01 && (
                              <button
                                className="text-blue-500 hover:underline"
                                onClick={() => setRequestAmount(amountDue.toFixed(2))}
                              >reset to balance</button>
                            )}
                          </div>
                        </div>

                        <Button
                          className="w-full bg-green-600 hover:bg-green-700 mb-2"
                          onClick={() => sendPaymentRequestMutation.mutate(requestAmount)}
                          disabled={!(parseFloat(requestAmount) > 0) || sendPaymentRequestMutation.isPending}
                          data-testid="button-send-payment-request"
                        >
                          {sendPaymentRequestMutation.isPending ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending…</>
                          ) : (
                            <><Send className="w-4 h-4 mr-2" />Send Payment Request</>
                          )}
                        </Button>

                        <Button
                          className="w-full bg-teal-600 hover:bg-teal-700 mb-2"
                          onClick={() => sendPaymentRequestSMSMutation.mutate(requestAmount)}
                           disabled={!(parseFloat(requestAmount) > 0) || sendPaymentRequestSMSMutation.isPending || !paymentRequestPhone}
                           title={!paymentRequestPhone ? 'Link a customer or add an invoice phone number first' : 'Text a payment request to the customer'}
                          data-testid="button-text-payment-request"
                        >
                          {sendPaymentRequestSMSMutation.isPending ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Texting…</>
                          ) : (
                            <><MessageSquare className="w-4 h-4 mr-2" />Text Payment Request</>
                          )}
                        </Button>
                        {!paymentRequestPhone && (
                          <p className="mb-2 text-xs text-amber-700">
                            Link the correct customer to this invoice or add their phone number to the invoice to enable payment-request texts.
                          </p>
                        )}

                        <Button
                          className="w-full bg-blue-600 hover:bg-blue-700 mb-2"
                          onClick={handleCopyPaymentDetails}
                          disabled={!(parseFloat(requestAmount) > 0)}
                          data-testid="button-copy-payment-details"
                        >
                          <Copy className="w-4 h-4 mr-2" />
                          Copy Payment Details
                        </Button>

                        <Button
                          className="w-full bg-purple-600 hover:bg-purple-700 mb-3"
                          onClick={() => generateStripeLinkMutation.mutate(requestAmount)}
                          disabled={!(parseFloat(requestAmount) > 0) || generateStripeLinkMutation.isPending}
                          data-testid="button-generate-stripe-link"
                        >
                          {generateStripeLinkMutation.isPending ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating…</>
                          ) : (
                            <><LinkIcon className="w-4 h-4 mr-2" />Generate Stripe Link</>
                          )}
                        </Button>

                        {/* Payment request history */}
                        {invoice?.payment_requests?.length > 0 && (
                          <div className="mb-3">
                            <button
                              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-2"
                              onClick={() => setShowRequestHistory(v => !v)}
                            >
                              <Clock className="w-3 h-3" />
                               <span>{invoice.payment_requests.length} request{invoice.payment_requests.length !== 1 ? 's' : ''} logged</span>
                              <ChevronDown className={`w-3 h-3 transition-transform ${showRequestHistory ? 'rotate-180' : ''}`} />
                            </button>
                            {showRequestHistory && (
                              <div className="space-y-1.5 bg-gray-50 rounded-md p-2 border">
                                 {invoice.payment_requests.some(req => (req.method === 'sms' || req.method === 'email') && !req.status) && (
                                   <p className="text-xs text-amber-700">Older requests were logged without provider confirmation; some may never have been sent.</p>
                                 )}
                                {[...invoice.payment_requests].reverse().map((req) => (
                                  <div key={req.id} className="text-xs">
                                    {editingRequestId === req.id ? (
                                      <div className="flex items-center gap-1">
                                        <span className="text-gray-400">$</span>
                                        <input
                                          type="number"
                                          min="0.01"
                                          step="0.01"
                                          value={editingRequestAmount}
                                          onChange={e => setEditingRequestAmount(e.target.value)}
                                          onKeyDown={e => { if (e.key === 'Enter') saveEditedPaymentRequest(req.id); if (e.key === 'Escape') { setEditingRequestId(null); setEditingRequestAmount(''); } }}
                                          className="w-24 border rounded px-1 py-0.5 text-xs"
                                          autoFocus
                                        />
                                        <button
                                          onClick={() => saveEditedPaymentRequest(req.id)}
                                          className="text-green-600 hover:text-green-800 font-semibold px-1"
                                        >Save</button>
                                        <button
                                          onClick={() => { setEditingRequestId(null); setEditingRequestAmount(''); }}
                                          className="text-gray-400 hover:text-gray-600"
                                        ><X className="w-3 h-3" /></button>
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-between group">
                                        <div className="flex items-center gap-1.5">
                                          {req.method === 'stripe' ? (
                                            <LinkIcon className="w-3 h-3 text-purple-500" />
                                          ) : req.method === 'email' ? (
                                            <Send className="w-3 h-3 text-green-500" />
                                          ) : req.method === 'sms' ? (
                                            <MessageSquare className="w-3 h-3 text-teal-500" />
                                          ) : (
                                            <Copy className="w-3 h-3 text-blue-500" />
                                          )}
                                          <span className="font-semibold text-gray-800">${Number(req.amount).toFixed(2)}</span>
                                           <span className="text-gray-400">{paymentRequestDeliveryLabel(req)}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-gray-400">{req.date ? format(new Date(req.date), 'MMM d') : ''}</span>
                                          <button
                                            onClick={() => { setEditingRequestId(req.id); setEditingRequestAmount(String(req.amount)); }}
                                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600 transition-opacity"
                                            title="Edit amount"
                                          ><Pencil className="w-3 h-3" /></button>
                                          <button
                                            onClick={() => { if (window.confirm('Delete this payment request entry?')) deletePaymentRequest(req.id); }}
                                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 transition-opacity"
                                            title="Delete entry"
                                          ><Trash2 className="w-3 h-3" /></button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="text-xs text-gray-500 space-y-1 mb-3">
                          <p className="font-semibold mb-1">💳 Payment Methods:</p>
                          <div className="flex items-center gap-1">
                            <CreditCard className="w-3 h-3" />
                            <span>Stripe (Card, ACH, Cash App)</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <DollarSign className="w-3 h-3" />
                            <span>Zelle / Venmo</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <DollarSign className="w-3 h-3" />
                            <span>Check / Cash</span>
                          </div>
                        </div>

                        <Button
                          className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={isRecordPaymentBlocked(total, amountPaid)}
                          title={isRecordPaymentBlocked(total, amountPaid) ? "Invoice is already paid in full" : undefined}
                          onClick={() => setShowPaymentDialog(true)}
                        >
                          <DollarSign className="w-4 h-4 mr-2" />
                          Record Payment
                        </Button>

                        {invoice.status !== 'paid' && amountDue > 0 && (
                          <Button
                            onClick={() => setShowMarkFullyPaidDialog(true)}
                            disabled={markAsPaidMutation.isPending || amountDue === 0}
                            className="w-full bg-blue-600 hover:bg-blue-700 mt-2"
                          >
                            <CheckCircle className="w-4 h-4 mr-2" />
                            {markAsPaidMutation.isPending ? 'Marking...' : 'Mark as Fully Paid'}
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
            )}
          </TabsContent>

          <TabsContent value="tasks">
            <Card>
              <CardContent className="p-3 sm:p-6">
                <p className="text-center text-gray-500 py-12">No tasks yet</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activity">
            <Card>
              <CardContent className="p-3 sm:p-6">
                <div className="space-y-4">
                  <div className="flex gap-3">
                    <div className="w-2 h-2 bg-blue-600 rounded-full mt-2"></div>
                    <div>
                      <p className="text-sm"><strong>{user?.full_name}</strong> created invoice</p>
                      <p className="text-xs text-gray-500">{invoice.created_date ? format(new Date(invoice.created_date), 'PPpp') : ''}</p>
                    </div>
                  </div>
                  {invoice.sent_date && (
                    <div className="flex gap-3">
                      <div className="w-2 h-2 bg-green-600 rounded-full mt-2"></div>
                      <div>
                        <p className="text-sm">Invoice send recorded for {invoice.customer_email}; email delivery is shown above, not guaranteed by this date.</p>
                        <p className="text-xs text-gray-500">{format(new Date(invoice.sent_date), 'PPpp')}</p>
                      </div>
                    </div>
                  )}
                  {invoice.amount_paid > 0 && invoice.status !== 'paid' && (
                    <div className="flex gap-3">
                      <div className="w-2 h-2 bg-orange-600 rounded-full mt-2"></div>
                      <div>
                        <p className="text-sm">Partial payment(s) recorded, total paid: ${Number(invoice.amount_paid || 0).toFixed(2)}</p>
                        <p className="text-xs text-gray-500">{new Date().toLocaleDateString()}</p>
                      </div>
                    </div>
                  )}
                  {invoice.status === 'paid' && invoice.amount_paid > 0 && (
                    <div className="flex gap-3">
                      <div className="w-2 h-2 bg-green-600 rounded-full mt-2"></div>
                      <div>
                        <p className="text-sm">Invoice marked as paid in full. Total paid: ${Number(invoice.amount_paid || 0).toFixed(2)}</p>
                        <p className="text-xs text-gray-500">{new Date().toLocaleDateString()}</p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reminders">
            <Card>
              <CardContent className="p-3 sm:p-6">
                <p className="text-center text-gray-500 py-12">No reminders set</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notes">
            <Card>
              <CardContent className="p-3 sm:p-6 space-y-4">
                <Textarea
                  placeholder="Add internal notes (not visible to customer)..."
                  rows={8}
                  value={invoiceNotes}
                  onChange={(e) => setInvoiceNotes(e.target.value)}
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="copyToCustomer"
                      checked={copyToCustomerProfile}
                      onChange={(e) => setCopyToCustomerProfile(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <Label htmlFor="copyToCustomer" className="font-normal cursor-pointer text-sm text-gray-600">
                      Also add to Customer Profile notes
                    </Label>
                  </div>
                  <Button 
                    onClick={() => saveNotesMutation.mutate()} 
                    disabled={saveNotesMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {saveNotesMutation.isPending ? 'Saving...' : 'Save Notes'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={showCommissionSplitDialog} onOpenChange={setShowCommissionSplitDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Split className="w-5 h-5 text-purple-600" />
              Commission Split for {invoice.invoice_number}
            </DialogTitle>
          </DialogHeader>

          <Alert className="bg-blue-50 border-blue-200">
            <AlertCircle className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-900 text-sm">
              <strong>💡 Commission is based on invoice sales agent, NOT customer assignment.</strong> Only people with commission settings in their profile will receive commissions when payments are made.
            </AlertDescription>
          </Alert>

          <div className="space-y-4 py-4">
            {commissionSplits.map((split, index) => (
              <Card key={index} className="border-2 border-purple-200">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 space-y-3">
                      <div>
                        <Label className="text-xs">Sales Rep</Label>
                        <Select
                          value={split.user_email}
                          onValueChange={(value) => handleSplitChange(index, 'user_email', value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select sales rep" />
                          </SelectTrigger>
                          <SelectContent>
                            {staffProfiles.filter(s => s.user_email).map(staff => (
                              <SelectItem key={staff.user_email} value={staff.user_email}>
                                {staff.full_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Split %</Label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={split.split_percentage}
                            onChange={(e) => handleSplitChange(index, 'split_percentage', parseFloat(e.target.value) || 0)}
                            placeholder="50"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Role</Label>
                          <Input
                            value={split.role}
                            onChange={(e) => handleSplitChange(index, 'role', e.target.value)}
                            placeholder="Closer, Lead Gen..."
                          />
                        </div>
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveSplit(index)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}

            <Button
              variant="outline"
              onClick={handleAddSplit}
              className="w-full border-dashed border-2"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Sales Rep
            </Button>

            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="font-medium">Total Split:</span>
                <span className={`font-bold text-lg ${
                  commissionSplits.reduce((sum, s) => sum + (parseFloat(s.split_percentage) || 0), 0) > 100 
                    ? 'text-red-600' 
                    : 'text-green-600'
                }`}>
                  {commissionSplits.reduce((sum, s) => sum + (parseFloat(s.split_percentage) || 0), 0)}%
                </span>
              </div>
              {commissionSplits.reduce((sum, s) => sum + (parseFloat(s.split_percentage) || 0), 0) > 100 && (
                <p className="text-xs text-red-600 mt-2">⚠️ Total cannot exceed 100%</p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => {
                setShowCommissionSplitDialog(false);
                setCommissionSplits(invoice?.commission_splits || []);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveCommissionSplits}
              disabled={
                updateCommissionSplitsMutation.isPending ||
                commissionSplits.reduce((sum, s) => sum + (parseFloat(s.split_percentage) || 0), 0) > 100
              }
              className="bg-purple-600 hover:bg-purple-700"
            >
              {updateCommissionSplitsMutation.isPending ? 'Saving...' : 'Save Commission Split'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Void / Clear Payment Warning Dialog */}
      <Dialog open={showVoidPaymentDialog} onOpenChange={setShowVoidPaymentDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Void / Clear Payment?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 space-y-1">
              <p className="font-semibold text-amber-800 text-sm flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {invoice?.invoice_number ? `Invoice #${invoice.invoice_number}` : 'This invoice'}
                {invoice?.status === 'paid' ? ' is currently marked as Paid' : ' currently has a recorded payment'}
              </p>
              <p className="text-sm text-amber-700">
                Clearing the recorded payment will remove the{' '}
                <strong>${amountPaid.toFixed(2)}</strong> amount paid and leave the full balance outstanding.
              </p>
              <p className="text-sm text-amber-700">
                The invoice status will automatically be reset to <strong>Sent</strong>.
              </p>
            </div>
            <p className="text-sm text-gray-600">
              This only unlinks the payment from this invoice — it does <strong>not</strong> delete any payment records. Continue?
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                data-testid="button-cancel-void-payment"
                onClick={() => setShowVoidPaymentDialog(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                data-testid="button-confirm-void-payment"
                disabled={voidPaymentPending}
                onClick={async () => {
                  setVoidPaymentPending(true);
                  try {
                    await base44.entities.Invoice.update(invoice.id, { amount_paid: 0, status: 'sent' });
                    queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
                    toast.success('Payment cleared — invoice reset to Sent status.');
                    setShowVoidPaymentDialog(false);
                  } catch (error) {
                    toast.error('Failed to clear payment: ' + (error.message || 'Please try again.'));
                  } finally {
                    setVoidPaymentPending(false);
                  }
                }}
              >
                {voidPaymentPending ? 'Clearing...' : 'Yes, Clear Payment'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Invoice Dialog ── */}
      <Dialog open={showDeleteInvoiceDialog} onOpenChange={setShowDeleteInvoiceDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              Delete Invoice?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-1">
              <p className="font-semibold text-red-800 text-sm">
                {invoice?.invoice_number || 'This invoice'} will be permanently deleted.
              </p>
              <p className="text-sm text-red-700">
                All associated line items and history will be removed. This cannot be undone.
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowDeleteInvoiceDialog(false)}
                disabled={deleteInvoicePending}
                data-testid="button-cancel-delete-invoice"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleDeleteInvoice}
                disabled={deleteInvoicePending}
                data-testid="button-confirm-delete-invoice"
              >
                {deleteInvoicePending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Deleting…</>
                ) : 'Yes, Delete Invoice'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Re-link Single Payment Dialog ── */}
      <Dialog open={showRelinkPaymentDialog} onOpenChange={setShowRelinkPaymentDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-blue-600">
              <LinkIcon className="w-5 h-5" />
              Re-link Payment?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-1">
                <p className="font-semibold text-blue-800 text-sm">
                  {relinkPaymentTarget?.payment_number || relinkPaymentTarget?.id}{relinkPaymentTarget ? ` — $${Number(relinkPaymentTarget.amount || 0).toFixed(2)}` : ''}
              </p>
              <p className="text-sm text-blue-700">
                This payment will be moved from{' '}
                <strong>{relinkPaymentTarget?.invoice_number || relinkPaymentTarget?.invoice_id}</strong>{' '}
                  to <strong>{invoice?.invoice_number}</strong> for <strong>{customer?.name || invoice?.customer_name}</strong>.
              </p>
              <p className="text-sm text-blue-700">
                  The original payment date will not change. Both invoice balances will be recalculated automatically.
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setShowRelinkPaymentDialog(false); setRelinkPaymentTarget(null); }}
                disabled={linkPaymentMutation.isPending}
                data-testid="button-cancel-relink-payment"
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700"
                onClick={() => {
                  linkPaymentMutation.mutate(relinkPaymentTarget);
                  setShowRelinkPaymentDialog(false);
                  setRelinkPaymentTarget(null);
                }}
                disabled={linkPaymentMutation.isPending}
                data-testid="button-confirm-relink-payment"
              >
                {linkPaymentMutation.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Linking…</>
                ) : 'Yes, Re-link Payment'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Re-link All Payments Dialog ── */}
      <Dialog open={showRelinkAllDialog} onOpenChange={setShowRelinkAllDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-blue-600">
              <LinkIcon className="w-5 h-5" />
              Re-link All Payments?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-1">
              <p className="font-semibold text-blue-800 text-sm">
                {otherInvoicePayments?.length} payment{otherInvoicePayments?.length !== 1 ? 's' : ''} —{' '}
                ${otherInvoicePayments?.reduce((s, p) => s + Number(p.amount || 0), 0).toFixed(2)} total
              </p>
              <p className="text-sm text-blue-700">
                All payments will be moved to <strong>{invoice?.invoice_number}</strong> and removed from their current invoices.
              </p>
              <p className="text-sm text-blue-700">
                All affected invoices will be recalculated automatically.
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowRelinkAllDialog(false)}
                disabled={linkAllPaymentsMutation.isPending}
                data-testid="button-cancel-relink-all"
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700"
                onClick={() => {
                  linkAllPaymentsMutation.mutate(otherInvoicePayments);
                  setShowRelinkAllDialog(false);
                }}
                disabled={linkAllPaymentsMutation.isPending}
                data-testid="button-confirm-relink-all"
              >
                {linkAllPaymentsMutation.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Linking…</>
                ) : `Yes, Re-link All (${otherInvoicePayments?.length})`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Force Mark as Paid in Full Dialog (no new payment) ── */}
      <Dialog open={showForceMarkPaidDialog} onOpenChange={setShowForceMarkPaidDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <CheckCircle className="w-5 h-5" />
              Mark as Paid in Full?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-1">
              <p className="font-semibold text-green-800 text-sm">
                {invoice?.invoice_number} — ${Number(invoice?.total_amount || invoice?.amount || 0).toFixed(2)}
              </p>
              <p className="text-sm text-green-700">
                This will mark the invoice as <strong>Paid</strong> without creating a new payment record.
              </p>
              <p className="text-sm text-green-700">
                Use this only when the payment was recorded on a different invoice. No new payment entry will be added.
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowForceMarkPaidDialog(false)}
                disabled={forceMarkPaidMutation.isPending}
                data-testid="button-cancel-force-mark-paid"
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => {
                  forceMarkPaidMutation.mutate();
                  setShowForceMarkPaidDialog(false);
                }}
                disabled={forceMarkPaidMutation.isPending}
                data-testid="button-confirm-force-mark-paid"
              >
                {forceMarkPaidMutation.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Updating…</>
                ) : 'Yes, Mark as Paid'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Mark as Fully Paid Dialog (records a payment) ── */}
      <Dialog open={showMarkFullyPaidDialog} onOpenChange={setShowMarkFullyPaidDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <CheckCircle className="w-5 h-5" />
              Mark as Fully Paid?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-1">
              <p className="font-semibold text-green-800 text-sm">
                {invoice?.invoice_number} — Balance due: ${typeof amountDue === 'number' ? amountDue.toFixed(2) : '—'}
              </p>
              <p className="text-sm text-green-700">
                This will record a payment for the remaining balance and set the invoice status to <strong>Paid</strong>.
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowMarkFullyPaidDialog(false)}
                disabled={markAsPaidMutation.isPending}
                data-testid="button-cancel-mark-fully-paid"
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => markAsPaidMutation.mutate()}
                disabled={markAsPaidMutation.isPending}
                data-testid="button-confirm-mark-fully-paid"
              >
                {markAsPaidMutation.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Processing…</>
                ) : 'Yes, Mark as Fully Paid'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showCheckScanDialog} onOpenChange={setShowCheckScanDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5 text-blue-600" />
              Scan Check Payment
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription className="text-blue-900 text-sm">
                📸 Take a clear photo of the check. AI will automatically extract the amount, check number, date, and payer name, then record a payment on this invoice.
              </AlertDescription>
            </Alert>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleCheckScan}
                disabled={isProcessingCheck}
                className="hidden"
                id="invoice-check-upload-input"
              />
              <label htmlFor="invoice-check-upload-input" className="cursor-pointer">
                {isProcessingCheck ? (
                  <div className="space-y-3">
                    <Loader2 className="w-12 h-12 mx-auto text-blue-600 animate-spin" />
                    <p className="text-sm text-gray-600">Processing check with AI...</p>
                    <p className="text-xs text-gray-500">This may take 10–15 seconds</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Camera className="w-12 h-12 mx-auto text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-700">Click to take photo or upload</p>
                      <p className="text-xs text-gray-500 mt-1">Supports JPG, PNG, HEIC</p>
                    </div>
                  </div>
                )}
              </label>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-1">
              <p className="font-semibold text-gray-700">Tips for best results:</p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li>Good lighting, no glare</li>
                <li>Capture the entire check</li>
                <li>Keep the check flat and straight</li>
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Record Payment dialog — lives at root level so it works from ANY tab */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="payment-amount-root">Payment Amount</Label>
              <Input
                id="payment-amount-root"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                min="0.01"
                max={amountDue.toFixed(2)}
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">Amount due: ${amountDue.toFixed(2)}</p>
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="credit_card">Credit Card</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="paypal">PayPal</SelectItem>
                  <SelectItem value="stripe">Stripe</SelectItem>
                  <SelectItem value="cash_app">Cash App</SelectItem>
                  <SelectItem value="zelle">Zelle</SelectItem>
                  <SelectItem value="venmo">Venmo</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Payment Date</Label>
              <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="mt-1" />
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="send_receipt_root"
                checked={sendReceipt}
                onChange={(e) => setSendReceipt(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
              />
              <Label htmlFor="send_receipt_root" className="font-normal cursor-pointer">Send receipt to customer</Label>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>Cancel</Button>
              <Button
                onClick={() => recordPaymentMutation.mutate()}
                disabled={
                  !paymentAmount ||
                  parseFloat(paymentAmount) <= 0 ||
                  Math.round(parseFloat(paymentAmount) * 100) > Math.round(amountDue * 100) ||
                  recordPaymentMutation.isPending
                }
                className="bg-green-600 hover:bg-green-700"
              >
                {recordPaymentMutation.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Processing...</>
                ) : 'Record Payment'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Review Request Prompt (shows after paid-in-full) ── */}
      <Dialog open={!!reviewPrompt} onOpenChange={open => { if (!open) setReviewPrompt(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-2xl">⭐</span> Send a review request?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            {reviewPrompt?.customerName || 'This customer'} just paid in full. Want to kick off a 5-star review request?
            We'll send personalized messages from the assigned rep over 30 days.
          </p>
          <div className="flex gap-2 pt-2">
            <Button
              className="flex-1 bg-blue-600 hover:bg-blue-700"
              disabled={sendingReviewRequest}
              onClick={async () => {
                setSendingReviewRequest(true);
                try {
                  const res = await base44.functions.invoke('createReviewRequestForInvoice', { invoiceId: reviewPrompt.invoiceId });
                  const rrId = res?.data?.review_request_id ?? res?.review_request_id;
                  if (rrId) {
                    await base44.functions.invoke('runReviewRequestsNow', { reviewRequestId: rrId });
                  }
                  toast.success('Review request sent!');
                } catch (e) {
                  toast.error('Failed to send: ' + (e?.message || e));
                } finally {
                  setSendingReviewRequest(false);
                  setReviewPrompt(null);
                }
              }}
            >
              {sendingReviewRequest ? <><span className="mr-2 animate-spin">⏳</span>Sending…</> : '⭐ Yes, send it'}
            </Button>
            <Button variant="outline" className="flex-1" disabled={sendingReviewRequest} onClick={() => setReviewPrompt(null)}>
              Not now
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}