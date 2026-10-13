import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { fnData, fnError } from '@/lib/functionResult';
import { TablePageSkeleton } from "@/components/PageSkeleton";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import useTranslation from "@/hooks/useTranslation";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DollarSign, TrendingDown, Users, Calendar, Download, CheckCircle, AlertCircle, Plus, Split, Wrench, Edit, Trash2, FileText, Mail, RefreshCw, Clock, ExternalLink, Bell, MessageSquare, Info } from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear, subYears, startOfWeek, endOfWeek, startOfDay, endOfDay } from 'date-fns';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { toast } from "sonner";
import AssistPayables from "@/components/commission/AssistPayables";
import { localToday } from "@/utils/localDate";
import { makeInvoiceMatcher } from "@/utils/paymentOwnership";

// Helper function for generating page URLs
const createPageUrl = (page) => {
    // Assuming a simple routing convention where page names correspond to lowercased paths
    // e.g., 'CommissionReport' -> '/commissionreport'
    return `/${page.toLowerCase()}`;
};

export default function CommissionReport() {
  const { t } = useTranslation();
  const [selectedPeriodType, setSelectedPeriodType] = useState('this_month');
  const [selectedRep, setSelectedRep] = useState('all');
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showDeductionDialog, setShowDeductionDialog] = useState(false);
  const [showManualCommissionDialog, setShowManualCommissionDialog] = useState(false);
  const [selectedRepForPayment, setSelectedRepForPayment] = useState(null);
  const [selectedRepForDeduction, setSelectedRepForDeduction] = useState(null);
  const [activeView, setActiveView] = useState('commissions');
  const [editingDeduction, setEditingDeduction] = useState(null);
  const [paymentData, setPaymentData] = useState({
    payment_date: localToday(),
    payment_method: 'check',
    notes: '',
    bank_account: '',
    routing_number: ''
  });
  const [deductionData, setDeductionData] = useState({
    deduction_type: 'ladder_assist',
    amount: '',
    deduction_date: localToday(),
    description: ''
  });
  const [manualCommissionData, setManualCommissionData] = useState({
    sales_rep_email: '',
    gross_commission: '',
    total_deductions: '',
    payment_date: localToday(),
    pay_period: format(new Date(), 'yyyy-MM'),
    payment_method: 'check',
    notes: '',
    description: ''
  });

  // Reminder dialog state
  const [reminderDialog, setReminderDialog] = useState(false);
  const [reminderLine, setReminderLine] = useState(null);
  const [reminderEmail, setReminderEmail] = useState('');
  const [reminderPhone, setReminderPhone] = useState('');
  const [reminderNote, setReminderNote] = useState('');
  const [reminderChannel, setReminderChannel] = useState('email');

  const queryClient = useQueryClient();

  const { user, myCompany, isAdmin, myStaffProfile, effectiveUserEmail } = useRoleBasedData();
  const canProcessPayments = isAdmin || myStaffProfile?.can_process_commission_payments;

  const { data: staffProfiles = [], isLoading: isLoadingStaff } = useQuery({
    queryKey: ['staff-profiles-commreport', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  const { data: invoices = [], isLoading: isLoadingInvoices } = useQuery({
    queryKey: ['invoices', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Invoice.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
  });

  const { data: payments = [], isLoading: isLoadingPayments } = useQuery({
    queryKey: ['payments', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Payment.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
  });

  const { data: deductions = [] } = useQuery({
    queryKey: ['deductions', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.CommissionDeduction.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  const { data: commissionPayments = [] } = useQuery({
    queryKey: ['commission-payments', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.CommissionPayment.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  const { data: digestRecords = [], isLoading: isLoadingDigests, refetch: refetchDigests } = useQuery({
    queryKey: ['weekly-commission-digests', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.WeeklyCommissionDigest.filter({ company_id: myCompany.id }, '-sent_at', 200) : [],
    enabled: !!myCompany && isAdmin,
  });

  const resendDigestMutation = useMutation({
    mutationFn: async ({ repEmail, weekKey }) => {
      const envelope = await base44.functions.invoke('sendWeeklyCommissionDigest', {
        company_id: myCompany.id,
        rep_email: repEmail,
        week_key: weekKey,
        force: true,
      });
      // invoke() resolves even on failure, so without this onSuccess claimed
      // the digest had been re-sent when it had not.
      if (fnError(envelope)) throw new Error(fnError(envelope));
      return fnData(envelope);
    },
    onSuccess: () => {
      toast.success('Digest re-sent successfully');
      refetchDigests();
    },
    onError: (err) => {
      toast.error('Failed to re-send digest: ' + (err?.message || 'Unknown error'));
    },
  });

  const sendReminderMutation = useMutation({
    mutationFn: async ({ line, email, phone, channel, note }) => {
      const result = await base44.functions.invoke('sendPaymentReminder', {
        invoiceId: line.invoice_id,
        companyId: myCompany?.id,
        email: email || undefined,
        phone: phone || undefined,
        channel,
        customMessage: note || undefined,
      });
      if (fnError(result)) throw new Error(fnError(result));
      const data = fnData(result);
      if (!data?.success) throw new Error(data?.error || 'Reminder failed');
      return data;
    },
    onSuccess: (data) => {
      const via = (data.channels || []).map(c => c === 'email' ? 'email' : 'SMS').join(' & ');
      toast.success(`✅ Payment reminder sent via ${via || 'message'}!`);
      setReminderDialog(false);
      setReminderLine(null);
      setReminderEmail('');
      setReminderPhone('');
      setReminderNote('');
      setReminderChannel('email');
    },
    onError: (err) => {
      toast.error(`❌ Reminder failed: ${err.message}`);
    }
  });

  const openReminderDialog = (line) => {
    setReminderLine(line);
    setReminderEmail(line.customer_email || '');
    setReminderPhone(line.customer_phone || '');
    setReminderNote('');
    setReminderChannel(line.customer_email ? 'email' : 'sms');
    setReminderDialog(true);
  };

  // Role-based: non-admins only see their own commission data
  const visibleStaffProfiles = React.useMemo(() => {
    if (isAdmin) return staffProfiles;
    return staffProfiles.filter(s => s.user_email === effectiveUserEmail);
  }, [staffProfiles, isAdmin, effectiveUserEmail]);

  const visibleInvoices = React.useMemo(() => {
    if (isAdmin) return invoices;
    return invoices.filter(inv => inv.sale_agent === effectiveUserEmail || inv.created_by === effectiveUserEmail);
  }, [invoices, isAdmin, effectiveUserEmail]);

  // Invoice-id-first matcher. Judged over the FULL company invoice list, not the
  // visible subset, so a number duplicated on another rep's invoice is still
  // recognised as ambiguous and left unallocated rather than paid twice.
  const matchesInv = React.useMemo(() => makeInvoiceMatcher(invoices), [invoices]);

  const markAsPaidMutation = useMutation({
    mutationFn: async ({ repData, paymentInfo }) => {
      const period = selectedPeriodType === 'this_month' ? format(new Date(), 'yyyy-MM') :
                     selectedPeriodType === 'last_month' ? format(subMonths(new Date(), 1), 'yyyy-MM') :
                     format(new Date(), 'yyyy-MM');

      const commissionPayment = await base44.entities.CommissionPayment.create({
        company_id: myCompany.id,
        sales_rep_email: repData.email,
        sales_rep_name: repData.name,
        pay_period: period,
        gross_commission: repData.grossCommission,
        total_deductions: repData.totalDeductions,
        net_commission: repData.netCommission,
        status: 'paid',
        // 'settlement' = "Mark as Paid" record; drives isPaid flag only,
        // never added on top of calculated commission amounts.
        commission_type: 'settlement',
        payment_date: paymentInfo.payment_date,
        payment_method: paymentInfo.payment_method,
        notes: paymentInfo.notes
      });

      // Auto-sync to accounting
      if (myCompany?.id) {
        base44.functions.invoke('autoSyncToAccounting', {
          entity_type: 'CommissionPayment',
          entity_id: commissionPayment.id,
          company_id: myCompany.id,
          action: 'created'
        }).catch(err => console.error('Accounting sync failed:', err));
      }

      // 🔔 Send notifications when commission is PAID
      try {
        const allStaff = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
        const notifyEmails = [...new Set([repData.email, ...(myCompany?.created_by ? [myCompany.created_by] : [])])];

        for (const email of notifyEmails) {
          const isRecipient = email === repData.email;
          
          await base44.entities.Notification.create({
            company_id: myCompany.id,
            user_email: email,
            title: isRecipient ? '💰 Commission Paid!' : '💰 Commission Payment Recorded',
            message: `${repData.name} - $${Number(repData.netCommission || 0).toFixed(2)} ${isRecipient ? 'paid to you' : 'paid out'}`,
            type: 'payment_received',
            related_entity_type: 'CommissionPayment',
            related_entity_id: commissionPayment.id,
            link_url: createPageUrl('CommissionReport'),
            is_read: false,
          });

          await base44.integrations.Core.SendEmail({
            to: email,
            from_name: myCompany.company_name || 'CRM',
            subject: isRecipient ? `💰 Commission Paid - $${Number(repData.netCommission || 0).toFixed(2)}` : `Commission Payment: ${repData.name}`,
            html: `<h2>Commission Payment ${isRecipient ? 'Received' : 'Recorded'}</h2>
              ${isRecipient ? '<p style="color: green; font-size: 18px;"><strong>Your commission has been paid!</strong></p>' : ''}
              <p><strong>Sales Rep:</strong> ${repData.name}</p>
              <p><strong>Period:</strong> ${period}</p>
              <p><strong>Gross Commission:</strong> $${Number(repData.grossCommission || 0).toFixed(2)}</p>
              <p><strong>Total Deductions:</strong> -$${Number(repData.totalDeductions || 0).toFixed(2)}</p>
              ${repData.totalLadderAssist > 0 ? `<p style="color: orange;"><strong>Ladder Assist:</strong> -$${Number(repData.totalLadderAssist || 0).toFixed(2)}</p>` : ''}
              <p style="font-size: 20px;"><strong>Net Paid:</strong> <span style="color: green;">$${Number(repData.netCommission || 0).toFixed(2)}</span></p>
              <p><strong>Payment Date:</strong> ${format(new Date(paymentInfo.payment_date), 'MMM d, yyyy')}</p>
              <p><strong>Payment Method:</strong> ${paymentInfo.payment_method}</p>
              ${paymentInfo.notes ? `<p><strong>Notes:</strong> ${paymentInfo.notes}</p>` : ''}
              <p><a href="${window.location.origin}${createPageUrl('CommissionReport')}">View Commission Report</a></p>`
          });
        }
      } catch (error) {
        console.error('Failed to send commission payment notifications:', error);
      }

      return commissionPayment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-payments'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setShowPaymentDialog(false);
      setSelectedRepForPayment(null);
      setPaymentData({
        payment_date: localToday(),
        payment_method: 'check',
        notes: ''
      });
      toast.success('Commission payment recorded and notifications sent!');
    },
    onError: (error) => {
      toast.error(`Failed to record payment: ${error.message}`);
    }
  });

  const addDeductionMutation = useMutation({
    mutationFn: async ({ repEmail, deductionInfo }) => {
      if (editingDeduction) {
        return await base44.entities.CommissionDeduction.update(editingDeduction.id, {
          deduction_type: deductionInfo.deduction_type,
          amount: parseFloat(deductionInfo.amount),
          deduction_date: deductionInfo.deduction_date,
          description: deductionInfo.description
        });
      } else {
        return await base44.entities.CommissionDeduction.create({
          company_id: myCompany.id,
          sales_rep_email: repEmail,
          deduction_type: deductionInfo.deduction_type,
          amount: parseFloat(deductionInfo.amount),
          deduction_date: deductionInfo.deduction_date,
          description: deductionInfo.description
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deductions'] });
      setShowDeductionDialog(false);
      setSelectedRepForDeduction(null);
      setEditingDeduction(null);
      setDeductionData({
        deduction_type: 'ladder_assist',
        amount: '',
        deduction_date: localToday(),
        description: ''
      });
      toast.success(editingDeduction ? 'Deduction updated successfully!' : 'Deduction added successfully!');
    },
    onError: (error) => {
      toast.error(`Failed to ${editingDeduction ? 'update' : 'add'} deduction: ${error.message}`);
    }
  });

  const deleteDeductionMutation = useMutation({
    mutationFn: async (deduction) => {
      await base44.entities.CommissionDeduction.delete(deduction.id);

      // 🔔 Send notifications when deduction is DELETED
      try {
        const allStaff = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
        const repProfile = staffProfiles.find(s => s.user_email === deduction.sales_rep_email);
        const notifyEmails = [...new Set([deduction.sales_rep_email, ...(myCompany?.created_by ? [myCompany.created_by] : [])])];

        for (const email of notifyEmails) {
          const isRecipient = email === deduction.sales_rep_email;
          
          await base44.entities.Notification.create({
            company_id: myCompany.id,
            user_email: email,
            title: isRecipient ? '✅ Deduction Removed' : '🗑️ Deduction Deleted',
            message: `${repProfile?.full_name || deduction.sales_rep_email} - $${Number(deduction.amount || 0).toFixed(2)} deduction removed${isRecipient ? ' from your account' : ''}`,
            type: 'general',
            related_entity_type: 'CommissionDeduction',
            related_entity_id: deduction.id,
            link_url: createPageUrl('CommissionReport'),
            is_read: false,
          });

          await base44.integrations.Core.SendEmail({
            to: email,
            from_name: myCompany.company_name || 'CRM',
            subject: `Deduction Removed: ${repProfile?.full_name || deduction.sales_rep_email}`,
            html: `<h2>Commission Deduction Deleted</h2>
              ${isRecipient ? '<p style="color: green; font-size: 18px;"><strong>A deduction has been removed from your account!</strong></p>' : ''}
              <p><strong>Sales Rep:</strong> ${repProfile?.full_name || deduction.sales_rep_email}</p>
              <p><strong>Deduction Type:</strong> ${deduction.deduction_type.replace(/_/g, ' ')}</p>
              <p><strong>Amount:</strong> <span style="color: green;">+$${Number(deduction.amount || 0).toFixed(2)}</span></p>
              <p><strong>Date:</strong> ${format(new Date(deduction.deduction_date), 'MMM d, yyyy')}</p>
              ${deduction.description ? `<p><strong>Description:</strong> ${deduction.description}</p>` : ''}
              <p style="color: ${isRecipient ? 'green' : 'gray'};">${isRecipient ? 'This amount will be added back to your commission calculations.' : `Deleted by: ${user?.full_name || user?.email}`}</p>
              <p><a href="${window.location.origin}${createPageUrl('CommissionReport')}">View Commission Report</a></p>`
          });
        }
      } catch (error) {
        console.error('Failed to send deduction deletion notifications:', error);
      }

      return deduction;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deductions'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('Deduction deleted and notifications sent!');
    },
    onError: (error) => {
      toast.error(`Failed to delete deduction: ${error.message}`);
    }
  });

  const addManualCommissionMutation = useMutation({
    mutationFn: async (data) => {
      const grossAmount = parseFloat(data.gross_commission) || 0;
      const deductionsAmount = parseFloat(data.total_deductions) || 0;
      const netAmount = grossAmount - deductionsAmount;

      const commissionPayment = await base44.entities.CommissionPayment.create({
        company_id: myCompany.id,
        sales_rep_email: data.sales_rep_email,
        sales_rep_name: staffProfiles.find(s => s.user_email === data.sales_rep_email)?.full_name || data.sales_rep_email,
        pay_period: data.pay_period,
        gross_commission: grossAmount,
        total_deductions: deductionsAmount,
        net_commission: netAmount,
        status: 'paid',
        // 'bonus' = admin-entered manual bonus; always added on top of
        // invoice-based commissions (never used as a settlement marker).
        commission_type: 'bonus',
        payment_date: data.payment_date,
        payment_method: data.payment_method,
        notes: data.notes || data.description || 'Manual commission entry'
      });

      // Send notifications
      try {
        const allStaff = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
        const notifyEmails = [...new Set([data.sales_rep_email, ...(myCompany?.created_by ? [myCompany.created_by] : [])])];

        for (const email of notifyEmails) {
          const isRecipient = email === data.sales_rep_email;
          
          await base44.entities.Notification.create({
            company_id: myCompany.id,
            user_email: email,
            title: isRecipient ? '💰 Commission Added!' : '💰 Manual Commission Recorded',
            message: `${commissionPayment.sales_rep_name} - $${Number(netAmount || 0).toFixed(2)} ${isRecipient ? 'added to your record' : 'recorded'}`,
            type: 'payment_received',
            related_entity_type: 'CommissionPayment',
            related_entity_id: commissionPayment.id,
            link_url: createPageUrl('CommissionReport'),
            is_read: false,
          });

          await base44.integrations.Core.SendEmail({
            to: email,
            from_name: myCompany.company_name || 'CRM',
            subject: isRecipient ? `💰 Commission Added - $${Number(netAmount || 0).toFixed(2)}` : `Manual Commission: ${commissionPayment.sales_rep_name}`,
            html: `<h2>Manual Commission ${isRecipient ? 'Added' : 'Recorded'}</h2>
              ${isRecipient ? '<p style="color: green; font-size: 18px;"><strong>A commission has been added to your record!</strong></p>' : ''}
              <p><strong>Sales Rep:</strong> ${commissionPayment.sales_rep_name}</p>
              <p><strong>Period:</strong> ${data.pay_period}</p>
              <p><strong>Gross Commission:</strong> $${Number(grossAmount || 0).toFixed(2)}</p>
              ${deductionsAmount > 0 ? `<p><strong>Deductions:</strong> -$${Number(deductionsAmount || 0).toFixed(2)}</p>` : ''}
              <p style="font-size: 20px;"><strong>Net Amount:</strong> <span style="color: green;">$${Number(netAmount || 0).toFixed(2)}</span></p>
              <p><strong>Payment Date:</strong> ${format(new Date(data.payment_date), 'MMM d, yyyy')}</p>
              ${data.notes ? `<p><strong>Notes:</strong> ${data.notes}</p>` : ''}
              <p><a href="${window.location.origin}${createPageUrl('CommissionReport')}">View Commission Report</a></p>`
          });
        }
      } catch (error) {
        console.error('Failed to send notifications:', error);
      }

      return commissionPayment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-payments'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setShowManualCommissionDialog(false);
      setManualCommissionData({
        sales_rep_email: '',
        gross_commission: '',
        total_deductions: '',
        payment_date: localToday(),
        pay_period: format(new Date(), 'yyyy-MM'),
        payment_method: 'check',
        notes: '',
        description: ''
      });
      toast.success('Commission added successfully!');
    },
    onError: (error) => {
      toast.error(`Failed to add commission: ${error.message}`);
    }
  });

  const getDateRange = () => {
    const now = new Date();
    
    switch(selectedPeriodType) {
      case 'today':
        return { start: startOfDay(now), end: endOfDay(now) };
      
      case 'this_week':
        return { start: startOfWeek(now), end: endOfWeek(now) };
      
      case 'this_month':
        return { start: startOfMonth(now), end: endOfMonth(now) };
      
      case 'last_month':
        const lastMonth = subMonths(now, 1);
        return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
      
      case 'this_year':
        return { start: startOfYear(now), end: endOfYear(now) };
      
      case 'last_year':
        const lastYear = subYears(now, 1);
        return { start: startOfYear(lastYear), end: endOfYear(lastYear) };
      
      case 'last_3_months':
        return { start: subMonths(now, 3), end: now };
      
      case 'last_6_months':
        return { start: subMonths(now, 6), end: now };
      
      case 'last_12_months':
        return { start: subMonths(now, 12), end: now };
      
      case 'all_time':
        return { start: new Date('2000-01-01'), end: new Date('2099-12-31') };
      
      default:
        return { start: startOfMonth(now), end: endOfMonth(now) };
    }
  };

  const calculateCommissions = () => {
    const { start, end } = getDateRange();
    
    const periodPayments = payments.filter(p => {
      if (!p.payment_date) return false;
      // Withheld-offset payments are internal accounting entries with no real cash
      // received — including them inflates the commission base.
      if (p.is_withheld_offset) return false;
      const paymentDate = new Date(p.payment_date);
      return paymentDate >= start && paymentDate <= end;
    });

    const commissionsByRep = {};

    // 🔥 CRITICAL FIX: Only calculate commissions for staff with commission_rate > 0
    // Uses visibleStaffProfiles so non-admins only see their own data
    visibleStaffProfiles.filter(staff => staff.commission_rate > 0).forEach(staff => {
      const repInvoices = visibleInvoices.filter(inv => {
        // CRITICAL: Filter by company first
        if (inv.company_id !== myCompany?.id) return false;
        
        // Check direct sale agent assignment
        if (inv.sale_agent === staff.user_email) return true;
        
        // Check commission splits
        if (inv.commission_splits?.some(cs => cs.user_email === staff.user_email)) return true;
        
        // Fallback: invoice creator (only when no sale_agent is set on the invoice at all)
        if (!inv.sale_agent && inv.created_by === staff.user_email) return true;
        
        return false;
      });
      
      // Amount-tolerance helper: loose fallbacks only fire when the payment
      // amount is within 1 % (or $1) of the invoice total to avoid crediting
      // a shared-customer payment to the wrong rep.
      const amountMatches = (payment, inv) => {
        const invTotal = parseFloat(inv.total_amount) || 0;
        const payAmt   = parseFloat(payment.amount)   || 0;
        if (invTotal <= 0) return false;
        return Math.abs(payAmt - invTotal) <= Math.max(invTotal * 0.01, 1);
      };

      const repPayments = periodPayments.filter(payment => {
        // CRITICAL: Filter by company first
        if (payment.company_id !== myCompany?.id) return false;
        
        // Match payment to rep's invoices only
        const invoice = repInvoices.find(inv => {
          // An invoice_id is definitive. If it doesn't point at one of this rep's
          // invoices, the payment isn't theirs — don't fall through to the loose
          // matches, and never match on invoice_number, which isn't unique.
          if (payment.invoice_id) return inv.id === payment.invoice_id;
          if (matchesInv(payment, inv)) return true;

          // Loose fallbacks: require a close amount match to avoid cross-rep attribution
          if (payment.customer_id && inv.customer_id === payment.customer_id) {
            if (amountMatches(payment, inv)) return true;
            console.warn(
              `[CommissionReport] loose customer_id match skipped (amount mismatch): ` +
              `payment ${payment.id} ($${payment.amount}) vs invoice ${inv.id} ($${inv.total_amount}) ` +
              `customer_id=${payment.customer_id}`
            );
            return false;
          }

          if (!payment.invoice_id && !payment.invoice_number && !payment.customer_id &&
              inv.customer_name && inv.customer_name === payment.customer_name) {
            if (amountMatches(payment, inv)) return true;
            console.warn(
              `[CommissionReport] loose customer_name match skipped (amount mismatch): ` +
              `payment ${payment.id} ($${payment.amount}) vs invoice ${inv.id} ($${inv.total_amount}) ` +
              `customer_name="${payment.customer_name}"`
            );
            return false;
          }

          return false;
        });
        return !!invoice;
      });
      
      // Calculate commission WITH SPLIT SUPPORT
      let grossCommission = 0;
      const splitCommissions = [];

      repPayments.forEach(payment => {
        // Mirror the same safe-match logic used in the repPayments filter above.
        const invoice = repInvoices.find(inv => {
          if (payment.invoice_id) return inv.id === payment.invoice_id;
          if (matchesInv(payment, inv)) return true;
          if (payment.customer_id && inv.customer_id === payment.customer_id && amountMatches(payment, inv)) return true;
          if (!payment.invoice_id && !payment.invoice_number && !payment.customer_id &&
              inv.customer_name && inv.customer_name === payment.customer_name && amountMatches(payment, inv)) return true;
          return false;
        });
        
        const commissionRate = staff.commission_rate || 10;
        let repCommission = payment.amount * (commissionRate / 100);

        if (invoice) {
          // Check if this invoice has commission splits
          if (invoice.commission_splits && invoice.commission_splits.length > 0) {
            const repSplit = invoice.commission_splits.find(cs => cs.user_email === staff.user_email);
            if (repSplit) {
              const splitPercentage = repSplit.split_percentage / 100;
              repCommission = payment.amount * (commissionRate / 100) * splitPercentage;
              
              splitCommissions.push({
                invoice: invoice.invoice_number,
                customer: payment.customer_name,
                payment: payment.amount,
                splitPercentage: repSplit.split_percentage,
                role: repSplit.role,
                commission: repCommission
              });
            } else {
              // This invoice has splits defined but this rep is NOT one of the
              // recipients — they split their share away to teammates.  Zero out
              // rather than falling back to full-rate commission.
              repCommission = 0;
            }
          }
        }

        grossCommission += repCommission;
      });

      // Split CommissionPayment records in this date range by type:
      //   'bonus'      — manual bonus entry → always added on top of invoice-based commission
      //   'settlement' — "Mark as Paid" record → drives isPaid only, never double-counted
      //   untyped      — legacy records without a type tag → backward-compat fallback only
      const periodCPs = commissionPayments.filter(cp =>
        cp.sales_rep_email === staff.user_email &&
        cp.payment_date &&
        new Date(cp.payment_date) >= start &&
        new Date(cp.payment_date) <= end &&
        cp.status === 'paid'
      );

      const bonusEntries = periodCPs.filter(cp => cp.commission_type === 'bonus');
      const legacyEntries = periodCPs.filter(cp => !cp.commission_type);
      // settlement entries (commission_type === 'settlement') are intentionally
      // excluded from grossCommission — they record payout, not earned amount.

      // Always add explicit bonuses on top of calculated invoice-based commission.
      const bonusGross = bonusEntries.reduce((sum, e) => sum + Number(e.gross_commission || 0), 0);
      const bonusDeductions = bonusEntries.reduce((sum, e) => sum + Number(e.total_deductions || 0), 0);
      grossCommission += bonusGross;

      // Backward-compat: if no invoice-based commissions AND no typed records, treat
      // untyped legacy entries as the full commission amount (preserves old behaviour).
      const useManualOnly = grossCommission === 0 && legacyEntries.length > 0;
      if (useManualOnly) {
        grossCommission = legacyEntries.reduce((sum, e) => sum + Number(e.gross_commission || 0), 0);
      }

      const totalSales = repPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

      const repDeductions = deductions.filter(d => {
        if (d.sales_rep_email !== staff.user_email) return false;
        if (!d.deduction_date) return false;
        const deductionDate = new Date(d.deduction_date);
        return deductionDate >= start && deductionDate <= end;
      });

      const ladderAssistDeductions = repDeductions.filter(d => d.deduction_type === 'ladder_assist');
      const totalLadderAssist = ladderAssistDeductions.reduce((sum, d) => sum + Number(d.amount || 0), 0);
      const legacyDeductions = useManualOnly
        ? legacyEntries.reduce((sum, e) => sum + Number(e.total_deductions || 0), 0) : 0;
      const totalDeductions = repDeductions.reduce((sum, d) => sum + Number(d.amount || 0), 0) + bonusDeductions + legacyDeductions;
      const netCommission = grossCommission - totalDeductions;

      const period = selectedPeriodType === 'this_month' ? format(new Date(), 'yyyy-MM') :
                     selectedPeriodType === 'last_month' ? format(subMonths(new Date(), 1), 'yyyy-MM') :
                     null;

      // Settlement record for this period (searched by pay_period, not date range):
      // drives isPaid and paymentDetails — not a source of commission amounts.
      const settlementForPeriod = period ? commissionPayments.find(cp =>
        cp.sales_rep_email === staff.user_email &&
        cp.pay_period === period &&
        cp.commission_type === 'settlement'
      ) : null;
      // Legacy untyped record for backward compatibility
      const legacyForPeriod = period ? commissionPayments.find(cp =>
        cp.sales_rep_email === staff.user_email &&
        cp.pay_period === period &&
        !cp.commission_type
      ) : null;

      commissionsByRep[staff.user_email] = {
        name: staff.full_name,
        email: staff.user_email,
        totalSales,
        commissionRate: staff.commission_rate || 10,
        grossCommission,
        splitCommissions,
        deductions: repDeductions,
        ladderAssistDeductions,
        totalLadderAssist,
        totalDeductions,
        netCommission,
        paymentCount: repPayments.length,
        payments: repPayments,
        invoices: repInvoices.filter(inv => repPayments.some(p =>
          matchesInv(p, inv) ||
          p.customer_name === inv.customer_name
        )),
        isPaid: settlementForPeriod?.status === 'paid' ||
                (useManualOnly && legacyEntries.some(e => e.pay_period === period)),
        paymentDetails: settlementForPeriod || (useManualOnly ? legacyForPeriod : null)
      };
    });

    return commissionsByRep;
  };

  const calculatePendingPipeline = () => {
    const pendingInvoices = invoices.filter(inv => {
      if (inv.company_id !== myCompany?.id) return false;
      if (['paid', 'cancelled', 'void'].includes(inv.status)) return false;
      const total = parseFloat(inv.total_amount) || 0;
      return total > 0;
    });

    const pendingByRep = {};

    visibleStaffProfiles.filter(staff => staff.commission_rate > 0).forEach(staff => {
      const repEmail = staff.user_email;
      const commissionRate = staff.commission_rate || 10;
      let totalPending = 0;
      const pendingLines = [];

      for (const inv of pendingInvoices) {
        const splits = Array.isArray(inv.commission_splits) ? inv.commission_splits : [];
        const splitEntry = splits.find(cs => cs.user_email === repEmail);
        const isSaleAgent = inv.sale_agent === repEmail;

        const isCustomerAssigned = (() => {
          if (isSaleAgent || splitEntry) return false;
          const customer = customers.find(c =>
            c.name === inv.customer_name || (inv.customer_id && c.id === inv.customer_id)
          );
          if (!customer) return false;
          const assignedUsers = customer.assigned_to_users?.length
            ? customer.assigned_to_users
            : (customer.assigned_to ? [customer.assigned_to] : []);
          return assignedUsers.includes(repEmail);
        })();

        if (!isSaleAgent && !splitEntry && !isCustomerAssigned) continue;

        const invoiceTotal = parseFloat(inv.total_amount) || 0;
        if (invoiceTotal <= 0) continue;

        let pendingCommission = invoiceTotal * (commissionRate / 100);
        if (splitEntry) {
          pendingCommission = invoiceTotal * (commissionRate / 100) * ((parseFloat(splitEntry.split_percentage) || 100) / 100);
        }
        if (pendingCommission <= 0) continue;

        const linkedCustomer = customers.find(c =>
          (inv.customer_id && c.id === inv.customer_id) || c.name === inv.customer_name
        );
        pendingLines.push({
          invoice_id: inv.id,
          invoice_number: inv.invoice_number || '—',
          customer_name: inv.customer_name || '—',
          customer_email: inv.customer_email || linkedCustomer?.email || '',
          customer_phone: inv.customer_phone || linkedCustomer?.phone || '',
          invoice_total: invoiceTotal,
          pending_commission: pendingCommission,
          split_pct: splitEntry ? parseFloat(splitEntry.split_percentage) : null,
          status: inv.status || 'pending',
        });
        totalPending += pendingCommission;
      }

      pendingByRep[repEmail] = { totalPending, pendingLines };
    });

    return pendingByRep;
  };

  const commissionsData = calculateCommissions();
  const pendingPipelineData = calculatePendingPipeline();

  // Show all reps with commission_rate > 0, even if no activity in current period
  const filteredData = selectedRep === 'all' 
    ? Object.values(commissionsData)
    : [commissionsData[selectedRep]].filter(Boolean);

  const totalGrossCommissions = filteredData.reduce((sum, rep) => sum + rep.grossCommission, 0);
  const totalDeductions = filteredData.reduce((sum, rep) => sum + rep.totalDeductions, 0);
  const totalLadderAssist = filteredData.reduce((sum, rep) => sum + rep.totalLadderAssist, 0);
  const totalNetCommissions = filteredData.reduce((sum, rep) => sum + rep.netCommission, 0);
  const totalOutstanding = filteredData.filter(r => !r.isPaid).reduce((sum, rep) => sum + rep.netCommission, 0);
  const totalPaid = filteredData.filter(r => r.isPaid).reduce((sum, rep) => sum + rep.netCommission, 0);
  const totalPendingPipeline = filteredData.reduce((sum, rep) => sum + (pendingPipelineData[rep.email]?.totalPending || 0), 0);

  const handleMarkAsPaid = (repData) => {
    setSelectedRepForPayment(repData);
    setShowPaymentDialog(true);
  };

  const handleAddDeduction = (repEmail) => {
    setSelectedRepForDeduction(repEmail);
    setEditingDeduction(null);
    setDeductionData({
      deduction_type: 'ladder_assist',
      amount: '',
      deduction_date: localToday(),
      description: ''
    });
    setShowDeductionDialog(true);
  };

  const handleEditDeduction = (deduction, repEmail) => {
    if (!isAdmin) {
      toast.error('Only admins can edit deductions');
      return;
    }
    setSelectedRepForDeduction(repEmail);
    setEditingDeduction(deduction);
    setDeductionData({
      deduction_type: deduction.deduction_type,
      amount: deduction.amount.toString(),
      deduction_date: deduction.deduction_date,
      description: deduction.description || ''
    });
    setShowDeductionDialog(true);
  };

  const handleDeleteDeduction = (deduction) => {
    if (!isAdmin) {
      toast.error('Only admins can delete deductions');
      return;
    }
    if (window.confirm('Are you sure you want to delete this deduction?')) {
      deleteDeductionMutation.mutate(deduction);
    }
  };

  const handlePaymentSubmit = async () => {
    if (!selectedRepForPayment) return;

    // If direct deposit, process via OnlineCheckWriter
    if (paymentData.payment_method === 'direct_deposit') {
      if (!paymentData.bank_account || !paymentData.routing_number) {
        toast.error('Please provide bank account and routing number for direct deposit');
        return;
      }

      try {
        const period = selectedPeriodType === 'this_month' ? format(new Date(), 'yyyy-MM') :
                       selectedPeriodType === 'last_month' ? format(subMonths(new Date(), 1), 'yyyy-MM') :
                       format(new Date(), 'yyyy-MM');

        const result = await base44.functions.invoke('processDirectDeposit', {
          salesRepEmail: selectedRepForPayment.email,
          salesRepName: selectedRepForPayment.name,
          amount: selectedRepForPayment.netCommission,
          payPeriod: period,
          bankAccount: paymentData.bank_account,
          routingNumber: paymentData.routing_number,
          companyId: myCompany.id
        });

        // Payload is nested under .data on the invoke envelope.
        const dd = fnError(result) ? { success: false, message: fnError(result) } : fnData(result);

        if (dd.success) {
          queryClient.invalidateQueries({ queryKey: ['commission-payments'] });
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          setShowPaymentDialog(false);
          setSelectedRepForPayment(null);
          setPaymentData({
            payment_date: localToday(),
            payment_method: 'check',
            notes: '',
            bank_account: '',
            routing_number: ''
          });
          toast.success(dd.message || 'Direct deposit processed successfully!');
        } else {
          toast.error(`Failed to process direct deposit${dd.message ? `: ${dd.message}` : ''}`);
        }
      } catch (error) {
        console.error('Direct deposit error:', error);
        toast.error(`Direct deposit failed: ${error.message}`);
      }
    } else {
      // Regular payment recording
      markAsPaidMutation.mutate({
        repData: selectedRepForPayment,
        paymentInfo: paymentData
      });
    }
  };

  const handleDeductionSubmit = () => {
    if (selectedRepForDeduction && deductionData.amount) {
      addDeductionMutation.mutate({
        repEmail: selectedRepForDeduction,
        deductionInfo: deductionData
      });
      
      // 🔔 NEW: Trigger workflow for deduction added/edited
      if (myCompany?.id) {
        const repProfile = staffProfiles.find(s => s.user_email === selectedRepForDeduction);
        base44.functions.invoke('triggerWorkflow', {
          triggerType: editingDeduction ? 'deduction_edited' : 'deduction_added',
          companyId: myCompany.id,
          entityType: 'CommissionDeduction',
          entityId: editingDeduction?.id || 'new',
          entityData: {
            sales_rep_email: selectedRepForDeduction,
            sales_rep_name: repProfile?.full_name || selectedRepForDeduction,
            name: repProfile?.full_name || selectedRepForDeduction,
            deduction_type: deductionData.deduction_type,
            amount: parseFloat(deductionData.amount),
            deduction_date: deductionData.deduction_date,
            description: deductionData.description,
            app_url: window.location.origin
          }
        }).catch(error => {
          console.error('Failed to trigger deduction workflow:', error);
        });
      }
    }
  };

  const generateRepReport = (rep) => {
    const { start, end } = getDateRange();
    const periodLabel = selectedPeriodType === 'this_month' ? format(new Date(), 'MMMM yyyy') :
                        selectedPeriodType === 'last_month' ? format(subMonths(new Date(), 1), 'MMMM yyyy') :
                        selectedPeriodType === 'this_year' ? format(new Date(), 'yyyy') :
                        selectedPeriodType === 'last_year' ? format(subYears(new Date(), 1), 'yyyy') :
                        selectedPeriodType === 'all_time' ? 'All Time' :
                        selectedPeriodType === 'today' ? format(new Date(), 'MMMM d, yyyy') :
                        selectedPeriodType === 'this_week' ? `Week of ${format(startOfWeek(new Date()), 'MMM d')} - ${format(endOfWeek(new Date()), 'MMM d, yyyy')}` :
                        format(new Date(), 'MMMM yyyy');

    const fmt = (v) => `$${Number(v || 0).toFixed(2)}`;
    const fmtDate = (d) => { try { return format(new Date(d), 'MMM d, yyyy'); } catch { return d || '—'; } };

    const paymentsRows = (rep.payments || []).map(p => {
      const inv = (rep.invoices || []).find(i => matchesInv(p, i));
      return `<tr>
        <td>${p.customer_name || 'Unknown'}</td>
        <td>${inv?.invoice_number || p.invoice_number || '—'}</td>
        <td>${fmtDate(p.payment_date)}</td>
        <td class="num">${fmt(p.amount)}</td>
        <td class="num">${fmt(p.amount * (rep.commissionRate / 100))}</td>
      </tr>`;
    }).join('');

    const splitsRows = (rep.splitCommissions || []).map(s =>
      `<tr>
        <td>${s.customer || '—'}</td>
        <td>${s.invoice || '—'}</td>
        <td>${s.role || '—'}</td>
        <td class="num">${s.splitPercentage}%</td>
        <td class="num">${fmt(s.payment)}</td>
        <td class="num">${fmt(s.commission)}</td>
      </tr>`
    ).join('');

    const assistDeductions = (rep.deductions || []).filter(d =>
      d.deduction_type === 'ladder_assist' || d.deduction_type === 'drone_assist'
    );
    const nonAssistDeductions = (rep.deductions || []).filter(d =>
      d.deduction_type !== 'ladder_assist' && d.deduction_type !== 'drone_assist'
    );
    const totalAssistFees = assistDeductions.reduce((s, d) => s + Number(d.amount || 0), 0);

    const assistRows = assistDeductions.map(d =>
      `<tr>
        <td>${d.deduction_type === 'ladder_assist' ? 'Ladder Assist' : 'Drone Assist'}</td>
        <td>${d.description || '—'}</td>
        <td>${fmtDate(d.deduction_date)}</td>
        <td class="num deduct">-${fmt(d.amount)}</td>
      </tr>`
    ).join('');

    const deductionRows = nonAssistDeductions.map(d =>
      `<tr>
        <td>${(d.deduction_type || '').replace(/_/g, ' ')}</td>
        <td>${d.description || '—'}</td>
        <td>${fmtDate(d.deduction_date)}</td>
        <td class="num deduct">-${fmt(d.amount)}</td>
      </tr>`
    ).join('');

    const allDeductionRows = (rep.deductions || []).map(d =>
      `<tr>
        <td>${(d.deduction_type || '').replace(/_/g, ' ')}</td>
        <td>${d.description || '—'}</td>
        <td>${fmtDate(d.deduction_date)}</td>
        <td class="num deduct">-${fmt(d.amount)}</td>
      </tr>`
    ).join('');

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Commission Report - ${rep.name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; padding: 40px; max-width: 900px; margin: 0 auto; font-size: 13px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  h2 { font-size: 16px; margin: 28px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #e5e7eb; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 3px solid #1e40af; }
  .company { font-size: 11px; color: #6b7280; }
  .period { font-size: 12px; color: #4b5563; margin-top: 4px; }
  .status { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .paid { background: #dcfce7; color: #166534; }
  .outstanding { background: #fef3c7; color: #92400e; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
  .summary-box { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; text-align: center; }
  .summary-box .label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
  .summary-box .value { font-size: 20px; font-weight: 700; margin-top: 4px; }
  .green { color: #16a34a; } .red { color: #dc2626; } .blue { color: #2563eb; } .orange { color: #ea580c; } .purple { color: #7c3aed; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 20px; }
  th { background: #f3f4f6; text-align: left; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; color: #4b5563; border-bottom: 2px solid #d1d5db; }
  td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .deduct { color: #dc2626; }
  .calc-row { display: flex; justify-content: space-between; padding: 6px 0; }
  .calc-row.total { border-top: 2px solid #1a1a1a; margin-top: 4px; padding-top: 10px; font-weight: 700; font-size: 16px; }
  .calc-section { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 12px 0; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af; text-align: center; }
  .empty { color: #9ca3af; font-style: italic; padding: 12px; text-align: center; }
  @media print { body { padding: 20px; } .no-print { display: none; } }
</style>
</head><body>
<div class="header">
  <div>
    <h1>Commission Statement</h1>
    <div class="company">${myCompany?.name || 'Company'}</div>
    <div class="period">Period: ${periodLabel} &nbsp;|&nbsp; Generated: ${format(new Date(), 'MMM d, yyyy h:mm a')}</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:18px;font-weight:700">${rep.name}</div>
    <div style="font-size:11px;color:#6b7280">${rep.email}</div>
    <div style="margin-top:6px"><span class="status ${rep.isPaid ? 'paid' : 'outstanding'}">${rep.isPaid ? '● Paid' : '○ Outstanding'}</span></div>
  </div>
</div>

<div class="summary-grid">
  <div class="summary-box"><div class="label">Total Sales</div><div class="value">${fmt(rep.totalSales)}</div></div>
  <div class="summary-box"><div class="label">Commission Earned</div><div class="value green">${fmt(rep.grossCommission)}</div></div>
  <div class="summary-box"><div class="label">You Owe (Deductions)</div><div class="value red">-${fmt(rep.totalDeductions)}</div></div>
  <div class="summary-box"><div class="label">Net Owed to You</div><div class="value blue">${fmt(rep.netCommission)}</div></div>
</div>

${totalAssistFees > 0 ? `<div style="margin:12px 0;padding:10px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;font-size:12px">
  <strong style="color:#ea580c">Assist Fees You Owe: -${fmt(totalAssistFees)}</strong>
  <span style="color:#92400e"> — Ladder/drone assist costs deducted from your commission (see details below)</span>
</div>` : ''}

<h2>Payments Received (${(rep.payments || []).length})</h2>
${(rep.payments || []).length > 0 ? `<table>
  <thead><tr><th>Customer</th><th>Invoice</th><th>Date</th><th class="num">Amount</th><th class="num">Commission (${rep.commissionRate}%)</th></tr></thead>
  <tbody>${paymentsRows}</tbody>
  <tfoot><tr><td colspan="3" style="font-weight:600">Total</td><td class="num" style="font-weight:600">${fmt(rep.totalSales)}</td><td class="num" style="font-weight:600">${fmt(rep.grossCommission)}</td></tr></tfoot>
</table>` : '<div class="empty">No payments received this period</div>'}

${(rep.splitCommissions || []).length > 0 ? `<h2>Split Commissions (${rep.splitCommissions.length})</h2>
<table>
  <thead><tr><th>Customer</th><th>Invoice</th><th>Role</th><th class="num">Split %</th><th class="num">Payment</th><th class="num">Commission</th></tr></thead>
  <tbody>${splitsRows}</tbody>
</table>` : ''}

${assistDeductions.length > 0 ? `<h2>Assist Fees You Owe (${assistDeductions.length})</h2>
<p style="font-size:11px;color:#6b7280;margin-bottom:8px">Ladder and drone assist costs billed to your account — deducted from your commission</p>
<table>
  <thead><tr><th>Type</th><th>Details</th><th>Date</th><th class="num">Amount</th></tr></thead>
  <tbody>${assistRows}</tbody>
  <tfoot><tr><td colspan="3" style="font-weight:600">Total Assist Fees</td><td class="num deduct" style="font-weight:600">-${fmt(totalAssistFees)}</td></tr></tfoot>
</table>` : ''}

${nonAssistDeductions.length > 0 ? `<h2>Other Deductions (${nonAssistDeductions.length})</h2>
<table>
  <thead><tr><th>Type</th><th>Description</th><th>Date</th><th class="num">Amount</th></tr></thead>
  <tbody>${deductionRows}</tbody>
  <tfoot><tr><td colspan="3" style="font-weight:600">Total Other Deductions</td><td class="num deduct" style="font-weight:600">-${fmt(nonAssistDeductions.reduce((s, d) => s + Number(d.amount || 0), 0))}</td></tr></tfoot>
</table>` : ''}

${(rep.deductions || []).length === 0 ? '<h2>Deductions</h2><div class="empty">No deductions this period</div>' : ''}

<h2>Commission Calculation</h2>
<div class="calc-section">
  <div class="calc-row"><span>Total Sales</span><span>${fmt(rep.totalSales)}</span></div>
  <div class="calc-row"><span>Commission Rate</span><span>${rep.commissionRate}%</span></div>
  <div class="calc-row"><span>Gross Commission</span><span class="green">${fmt(rep.grossCommission)}</span></div>
  ${(rep.splitCommissions || []).length > 0 ? `<div class="calc-row"><span style="color:#7c3aed">+ Split Commissions (${rep.splitCommissions.length})</span><span class="purple">included above</span></div>` : ''}
  ${totalAssistFees > 0 ? `<div class="calc-row"><span class="orange">− Assist Fees (Ladder/Drone)</span><span class="orange">-${fmt(totalAssistFees)}</span></div>` : ''}
  ${nonAssistDeductions.length > 0 ? `<div class="calc-row"><span class="red">− Other Deductions (${nonAssistDeductions.length})</span><span class="red">-${fmt(nonAssistDeductions.reduce((s, d) => s + Number(d.amount || 0), 0))}</span></div>` : ''}
  ${rep.totalDeductions > 0 && totalAssistFees > 0 && nonAssistDeductions.length > 0 ? `<div class="calc-row"><span style="color:#6b7280;font-size:11px">Total Deductions</span><span style="color:#6b7280;font-size:11px">-${fmt(rep.totalDeductions)}</span></div>` : (rep.totalDeductions > 0 && totalAssistFees === 0 ? `<div class="calc-row"><span class="red">− Total Deductions</span><span class="red">-${fmt(rep.totalDeductions)}</span></div>` : '')}
  <div class="calc-row total"><span>Net Owed to You</span><span class="blue">${fmt(rep.netCommission)}</span></div>
</div>

${rep.isPaid && rep.paymentDetails ? `<h2>Payment Details</h2>
<div class="calc-section">
  <div class="calc-row"><span>Status</span><span class="green"><strong>Paid</strong></span></div>
  <div class="calc-row"><span>Paid On</span><span>${fmtDate(rep.paymentDetails.payment_date)}</span></div>
  <div class="calc-row"><span>Method</span><span style="text-transform:capitalize">${rep.paymentDetails.payment_method || '—'}</span></div>
  ${rep.paymentDetails.notes ? `<div class="calc-row"><span>Notes</span><span>${rep.paymentDetails.notes}</span></div>` : ''}
</div>` : ''}

<div class="footer">
  This is a system-generated commission statement from ${myCompany?.name || 'CompanySync'}.
  Report period: ${periodLabel} &nbsp;|&nbsp; Rep: ${rep.name} (${rep.email})
</div>

<div class="no-print" style="text-align:center;margin-top:20px">
  <button onclick="window.print()" style="padding:10px 24px;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">Print / Save as PDF</button>
</div>
</body></html>`;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
    } else {
      toast.error('Please allow pop-ups to generate the report');
    }
  };

  const exportReport = () => {
    const headers = ['Sales Rep', 'Total Sales', 'Commission Rate', 'Gross Commission', 'Total Deductions', 'Ladder Assist', 'Net Commission', 'Status'];
    const rows = filteredData.map(rep => [
      rep.name,
      `$${Number(rep.totalSales || 0).toFixed(2)}`,
      `${rep.commissionRate}%`,
      `$${Number(rep.grossCommission || 0).toFixed(2)}`,
      `-$${Number(rep.totalDeductions || 0).toFixed(2)}`,
      `-$${Number(rep.totalLadderAssist || 0).toFixed(2)}`,
      `$${Number(rep.netCommission || 0).toFixed(2)}`,
      rep.isPaid ? 'Paid' : 'Outstanding'
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `commission_report_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  if (isLoadingStaff || isLoadingInvoices || isLoadingPayments) {
    return <TablePageSkeleton />;
  }

  return (
    <div className="p-3 sm:p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{t.sidebar.commissionTracker}</h1>
          <p className="text-gray-500 mt-1">Track sales commissions, splits, and deductions</p>
          <p className="flex items-center gap-1 mt-1 text-xs text-blue-600">
            <Info className="w-3.5 h-3.5 shrink-0" />
            <span>
              <strong>Cash basis</strong> — totals are based on payment received dates.
              Commission Tracking uses invoice dates (accrual basis) and may differ.
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          {isAdmin && activeView === 'commissions' && (
            <Button variant="outline" onClick={() => setShowManualCommissionDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Commission
            </Button>
          )}
          {activeView === 'commissions' && (
            <Button variant="outline" onClick={exportReport}>
              <Download className="w-4 h-4 mr-2" />
              {t.common.export}
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit" data-testid="commission-view-toggle">
        <Button
          variant={activeView === 'commissions' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveView('commissions')}
          data-testid="button-view-commissions"
        >
          <DollarSign className="w-4 h-4 mr-1" />
          Sales Commissions
        </Button>
        <Button
          variant={activeView === 'assists' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveView('assists')}
          data-testid="button-view-assists"
        >
          <Wrench className="w-4 h-4 mr-1" />
          Assist Payables
        </Button>
        {isAdmin && (
          <Button
            variant={activeView === 'digest_history' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveView('digest_history')}
            data-testid="button-view-digest-history"
          >
            <Mail className="w-4 h-4 mr-1" />
            Digest History
          </Button>
        )}
      </div>

      {activeView === 'assists' ? (
        <AssistPayables company={myCompany} isAdmin={isAdmin} user={user} staffProfiles={staffProfiles} />
      ) : activeView === 'digest_history' ? (
        <Card data-testid="digest-history-panel">
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5 text-blue-600" />
                  Weekly Commission Digest History
                </CardTitle>
                <p className="text-sm text-gray-500 mt-1">
                  Records of automated Friday 4 PM digest emails sent to reps
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchDigests()}
                disabled={isLoadingDigests}
                data-testid="button-refresh-digests"
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${isLoadingDigests ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingDigests ? (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                Loading digest history...
              </div>
            ) : digestRecords.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
                <Mail className="w-10 h-10 opacity-30" />
                <p className="text-sm">No digest records found. Digests run automatically every Friday at 4 PM.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-3 pr-4 font-semibold text-gray-700">Rep</th>
                      <th className="pb-3 pr-4 font-semibold text-gray-700">Week Of</th>
                      <th className="pb-3 pr-4 font-semibold text-gray-700 text-right">Earned</th>
                      <th className="pb-3 pr-4 font-semibold text-gray-700 text-right">Pending</th>
                      <th className="pb-3 pr-4 font-semibold text-gray-700">Sent At</th>
                      <th className="pb-3 font-semibold text-gray-700">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {digestRecords.map((record) => {
                      const d = record.data || record;
                      const sentAt = d.sent_at ? new Date(d.sent_at) : null;
                      return (
                        <tr key={record.id} className="hover:bg-gray-50" data-testid={`digest-row-${record.id}`}>
                          <td className="py-3 pr-4">
                            <div className="font-medium text-gray-900">{d.rep_name || '—'}</div>
                            <div className="text-xs text-gray-500">{d.rep_email || '—'}</div>
                          </td>
                          <td className="py-3 pr-4">
                            <Badge variant="outline" className="font-mono text-xs">
                              {d.week_key || '—'}
                            </Badge>
                          </td>
                          <td className="py-3 pr-4 text-right">
                            <span className="font-semibold text-green-700">
                              ${Number(d.total_earned || 0).toFixed(2)}
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-right">
                            <span className="text-orange-600">
                              ${Number(d.total_pending || 0).toFixed(2)}
                            </span>
                          </td>
                          <td className="py-3 pr-4">
                            {sentAt ? (
                              <div className="flex items-center gap-1 text-gray-600">
                                <Clock className="w-3 h-3" />
                                <span>{format(sentAt, 'MMM d, yyyy h:mm a')}</span>
                              </div>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="py-3">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => resendDigestMutation.mutate({ repEmail: d.rep_email, weekKey: d.week_key })}
                              disabled={resendDigestMutation.isPending}
                              data-testid={`button-resend-digest-${record.id}`}
                            >
                              <Mail className="w-3 h-3 mr-1" />
                              Re-send
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-xs text-gray-400 mt-4">
                  Showing last {digestRecords.length} digest{digestRecords.length !== 1 ? 's' : ''} across all reps
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
        <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium mb-2 block">{t.reports.dateRange}</Label>
              <Select value={selectedPeriodType} onValueChange={setSelectedPeriodType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">{t.dashboard.today}</SelectItem>
                  <SelectItem value="this_week">{t.dashboard.this_week}</SelectItem>
                  <SelectItem value="this_month">{t.dashboard.this_month}</SelectItem>
                  <SelectItem value="last_month">{t.dashboard.last_month}</SelectItem>
                  <SelectItem value="last_3_months">Last 3 Months</SelectItem>
                  <SelectItem value="last_6_months">Last 6 Months</SelectItem>
                  <SelectItem value="last_12_months">Last 12 Months</SelectItem>
                  <SelectItem value="this_year">This Year</SelectItem>
                  <SelectItem value="last_year">Last Year</SelectItem>
                  <SelectItem value="all_time">{t.common.all}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium mb-2 block">{t.sidebar.sales}</Label>
              <Select value={selectedRep} onValueChange={setSelectedRep}>
                <SelectTrigger>
                  <SelectValue placeholder="Select sales rep" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.common.all}</SelectItem>
                  {visibleStaffProfiles.filter(staff => staff.commission_rate > 0 && staff.user_email).map(staff => (
                    <SelectItem key={staff.user_email} value={staff.user_email}>
                      {staff.full_name} ({staff.commission_rate}%)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Gross Commissions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">${Number(totalGrossCommissions || 0).toFixed(2)}</div>
            <p className="text-xs text-gray-500 mt-1">Before deductions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Ladder Assist</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600">-${Number(totalLadderAssist || 0).toFixed(2)}</div>
            <p className="text-xs text-gray-500 mt-1">Ladder fees</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Total Deductions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">-${Number(totalDeductions || 0).toFixed(2)}</div>
            <p className="text-xs text-gray-500 mt-1">All deductions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Outstanding</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-600">${Number(totalOutstanding || 0).toFixed(2)}</div>
            <p className="text-xs text-gray-500 mt-1">Not yet paid</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">{t.common.paid}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">${Number(totalPaid || 0).toFixed(2)}</div>
            <p className="text-xs text-gray-500 mt-1">Already paid out</p>
          </CardContent>
        </Card>

        <Card data-testid="card-pending-pipeline" className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-amber-700 flex items-center gap-1">
              <TrendingDown className="w-4 h-4 rotate-180" />
              Pending in Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-600" data-testid="text-pending-pipeline-total">${Number(totalPendingPipeline || 0).toFixed(2)}</div>
            <p className="text-xs text-amber-600 mt-1">Est. from open invoices</p>
          </CardContent>
        </Card>
      </div>

      {filteredData.map(rep => (
        <Card key={rep.email}>
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>{rep.name}</CardTitle>
                  {rep.isPaid ? (
                    <Badge className="bg-green-100 text-green-800 border-green-300">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      {t.common.paid}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-300">
                      <AlertCircle className="w-3 h-3 mr-1" />
                      Outstanding
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  {rep.paymentCount} payments received • {rep.commissionRate}% commission rate
                  {rep.splitCommissions.length > 0 && ` • ${rep.splitCommissions.length} split commissions`}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge variant="outline" className="bg-blue-50 text-blue-700 text-lg px-3 py-1">
                  Net: ${Number(rep.netCommission || 0).toFixed(2)}
                </Badge>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => generateRepReport(rep)} data-testid={`button-rep-report-${rep.email}`}>
                    <FileText className="w-4 h-4 mr-1" />
                    Report
                  </Button>
                  {isAdmin && (
                    <Button size="sm" variant="outline" onClick={() => handleAddDeduction(rep.email)}>
                      <Wrench className="w-4 h-4 mr-1" />
                      Add Deduction
                    </Button>
                  )}
                  {canProcessPayments && !rep.isPaid && rep.netCommission > 0 && (
                    <Button size="sm" onClick={() => handleMarkAsPaid(rep)} className="bg-green-600 hover:bg-green-700">
                      {t.invoices.recordPayment}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <Tabs defaultValue="payments" className="w-full">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="payments">{t.sidebar.payments} ({rep.paymentCount})</TabsTrigger>
                <TabsTrigger value="splits">Splits ({rep.splitCommissions.length})</TabsTrigger>
                <TabsTrigger value="deductions">Deductions ({rep.deductions.length})</TabsTrigger>
                <TabsTrigger value="pipeline" data-testid={`tab-pipeline-${rep.email}`}>
                  Pipeline ({(pendingPipelineData[rep.email]?.pendingLines || []).length})
                </TabsTrigger>
                <TabsTrigger value="summary">Summary</TabsTrigger>
              </TabsList>

              <TabsContent value="payments" className="space-y-3 mt-4">
                {rep.payments && rep.payments.length > 0 ? (
                  rep.payments.map(payment => {
                    const invoice = rep.invoices.find(inv => matchesInv(payment, inv));
                    return (
                      <div key={payment.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                        <div className="flex-1">
                          <p className="font-medium text-sm">{payment.customer_name || 'Unknown Customer'}</p>
                          <p className="text-xs text-gray-600 mt-1">
                            Invoice: {invoice?.invoice_number || payment.invoice_number} • {format(new Date(payment.payment_date), 'MMM d, yyyy')}
                          </p>
                        </div>
                        <span className="font-bold text-gray-900">${Number(payment.amount || 0).toFixed(2)}</span>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-gray-500 text-center py-6">No payments in this period</p>
                )}
              </TabsContent>

              <TabsContent value="splits" className="space-y-3 mt-4">
                {rep.splitCommissions.length > 0 ? (
                  rep.splitCommissions.map((split, idx) => (
                    <div key={idx} className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Split className="w-4 h-4 text-purple-600" />
                            <p className="font-medium text-sm">{split.customer}</p>
                          </div>
                          <p className="text-xs text-gray-600">
                            Invoice: {split.invoice} • Role: {split.role}
                          </p>
                          <p className="text-xs text-purple-700 font-medium mt-1">
                            {split.splitPercentage}% split of commission
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-600">Payment: ${Number(split.payment || 0).toFixed(2)}</p>
                          <p className="font-bold text-purple-600">+${Number(split.commission || 0).toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 text-center py-6">No split commissions in this period</p>
                )}
              </TabsContent>

              <TabsContent value="deductions" className="space-y-3 mt-4">
                {rep.deductions.length > 0 ? (
                  rep.deductions.map(deduction => (
                    <div key={deduction.id} className="flex justify-between items-center p-3 bg-red-50 rounded-lg border border-red-200">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {deduction.deduction_type === 'ladder_assist' && <Wrench className="w-4 h-4 text-orange-600" />}
                          {deduction.deduction_type === 'chargeback' && <TrendingDown className="w-4 h-4 text-red-600" />}
                          <p className="font-medium text-sm">{deduction.description}</p>
                        </div>
                        <p className="text-xs text-gray-600 mt-1">
                          {deduction.deduction_type.replace(/_/g, ' ')} • {format(new Date(deduction.deduction_date), 'MMM d, yyyy')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-red-600">-${Number(deduction.amount || 0).toFixed(2)}</span>
                        {isAdmin && (
                          <div className="flex gap-1">
                            <Button 
                              size="sm" 
                              variant="ghost" 
                              onClick={() => handleEditDeduction(deduction, rep.email)}
                              className="h-8 w-8 p-0"
                            >
                              <Edit className="w-4 h-4 text-blue-600" />
                            </Button>
                            <Button 
                              size="sm" 
                              variant="ghost" 
                              onClick={() => handleDeleteDeduction(deduction)}
                              className="h-8 w-8 p-0"
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 text-center py-6">No deductions in this period</p>
                )}
              </TabsContent>

              <TabsContent value="pipeline" className="space-y-3 mt-4" data-testid={`panel-pipeline-${rep.email}`}>
                {(() => {
                  const pipeline = pendingPipelineData[rep.email] || { totalPending: 0, pendingLines: [] };
                  return (
                    <>
                      {pipeline.pendingLines.length > 0 ? (
                        <>
                          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex justify-between items-center">
                            <span className="text-sm font-medium text-amber-800">Est. pending commission from {pipeline.pendingLines.length} open invoice{pipeline.pendingLines.length !== 1 ? 's' : ''}</span>
                            <span className="text-lg font-bold text-amber-700" data-testid={`text-rep-pipeline-total-${rep.email}`}>${Number(pipeline.totalPending || 0).toFixed(2)}</span>
                          </div>
                          {pipeline.pendingLines.map((line, idx) => (
                            <div key={idx} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-200" data-testid={`row-pipeline-${rep.email}-${idx}`}>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm">{line.customer_name}</p>
                                <p className="text-xs text-gray-500 mt-1">
                                  Invoice {line.invoice_number}
                                  {line.split_pct != null && ` • ${line.split_pct}% split`}
                                  {' • '}
                                  <span className="capitalize">{line.status}</span>
                                  {' • '}
                                  Invoice total: ${Number(line.invoice_total || 0).toFixed(2)}
                                </p>
                              </div>
                              <div className="flex items-center gap-3 ml-2 shrink-0">
                                <div className="text-right">
                                  <p className="font-bold text-amber-700">+${Number(line.pending_commission || 0).toFixed(2)}</p>
                                  <p className="text-xs text-gray-400">est. commission</p>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-8 px-2 gap-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                                  onClick={() => openReminderDialog(line)}
                                  data-testid={`btn-remind-invoice-${rep.email}-${idx}`}
                                  title="Send payment reminder"
                                >
                                  <Bell className="h-3 w-3" />
                                  Remind
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-8 px-2 gap-1"
                                  onClick={() => {
                                    if (line.invoice_id) {
                                      window.location.href = `${createPageUrl('invoice-details')}?id=${encodeURIComponent(line.invoice_id)}`;
                                    } else {
                                      window.location.href = `${createPageUrl('Invoices')}?search=${encodeURIComponent(line.invoice_number !== '—' ? line.invoice_number : line.customer_name)}`;
                                    }
                                  }}
                                  data-testid={`btn-view-invoice-${rep.email}-${idx}`}
                                  title="View invoice"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  View
                                </Button>
                              </div>
                            </div>
                          ))}
                        </>
                      ) : (
                        <p className="text-gray-500 text-center py-6">No open invoices in pipeline</p>
                      )}
                    </>
                  );
                })()}
              </TabsContent>

              <TabsContent value="summary" className="mt-4 space-y-4">
                {rep.isPaid && rep.paymentDetails && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <h4 className="font-semibold text-sm mb-2 text-green-900">Payment Information</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-600">Paid on:</span>
                        <span className="ml-2 font-medium">{format(new Date(rep.paymentDetails.payment_date), 'MMM d, yyyy')}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Method:</span>
                        <span className="ml-2 font-medium capitalize">{rep.paymentDetails.payment_method}</span>
                      </div>
                      {rep.paymentDetails.notes && (
                        <div className="col-span-2">
                          <span className="text-gray-600">Notes:</span>
                          <span className="ml-2 font-medium">{rep.paymentDetails.notes}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-semibold text-sm mb-3">Commission Calculation</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Total Sales</span>
                      <span className="font-semibold">${Number(rep.totalSales || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Commission Rate</span>
                      <span className="font-semibold">{rep.commissionRate}%</span>
                    </div>
                    <div className="flex justify-between text-sm border-t pt-2">
                      <span className="text-gray-900 font-medium">Gross Commission</span>
                      <span className="font-bold text-green-600">${Number(rep.grossCommission || 0).toFixed(2)}</span>
                    </div>
                    {rep.splitCommissions.length > 0 && (
                      <div className="flex justify-between text-sm text-purple-600">
                        <span className="flex items-center gap-1">
                          <Split className="w-3 h-3" />
                          Includes Split Commissions
                        </span>
                        <span className="font-semibold">{rep.splitCommissions.length} splits</span>
                      </div>
                    )}
                    {rep.totalLadderAssist > 0 && (
                      <div className="flex justify-between text-sm text-orange-600">
                        <span className="flex items-center gap-1">
                          <Wrench className="w-3 h-3" />
                          Ladder Assist Fees
                        </span>
                        <span className="font-semibold">-${Number(rep.totalLadderAssist || 0).toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm text-red-600">
                      <span>Total Deductions</span>
                      <span className="font-semibold">-${Number(rep.totalDeductions || 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className={`${rep.isPaid ? 'bg-green-50' : 'bg-blue-50'} rounded-lg p-4`}>
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-bold text-gray-900">Net Commission to Pay</span>
                    <span className={`text-2xl font-bold ${rep.isPaid ? 'text-green-600' : 'text-blue-600'}`}>
                      ${Number(rep.netCommission || 0).toFixed(2)}
                    </span>
                  </div>
                </div>

                {(pendingPipelineData[rep.email]?.totalPending || 0) > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="text-sm font-semibold text-amber-800">Pending in Pipeline</span>
                        <p className="text-xs text-amber-600 mt-0.5">
                          Est. from {(pendingPipelineData[rep.email]?.pendingLines || []).length} open invoice{(pendingPipelineData[rep.email]?.pendingLines || []).length !== 1 ? 's' : ''} — not yet collected
                        </p>
                      </div>
                      <span className="text-xl font-bold text-amber-700" data-testid={`text-summary-pipeline-${rep.email}`}>
                        ${Number(pendingPipelineData[rep.email]?.totalPending || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      ))}
        </>
      )}

      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.invoices.recordPayment}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>{t.sidebar.sales} Rep</Label>
              <Input value={selectedRepForPayment?.name || ''} disabled />
            </div>
            <div>
              <Label>{t.common.amount}</Label>
              <Input value={`$${Number(selectedRepForPayment?.netCommission || 0).toFixed(2)}`} disabled />
            </div>
            <div>
              <Label>{t.common.date}</Label>
              <Input
                type="date"
                value={paymentData.payment_date}
                onChange={(e) => setPaymentData({...paymentData, payment_date: e.target.value})}
              />
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select value={paymentData.payment_method} onValueChange={(v) => setPaymentData({...paymentData, payment_method: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="zelle">Zelle</SelectItem>
                  <SelectItem value="venmo">Venmo</SelectItem>
                  <SelectItem value="cashapp">Cash App</SelectItem>
                  <SelectItem value="direct_deposit">Direct Deposit (ACH - $2.90 fee)</SelectItem>
                  <SelectItem value="wire_transfer">Wire Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {paymentData.payment_method === 'direct_deposit' && (
              <>
                <div>
                  <Label>Bank Account Number *</Label>
                  <Input
                    type="text"
                    value={paymentData.bank_account}
                    onChange={(e) => setPaymentData({...paymentData, bank_account: e.target.value})}
                    placeholder="Enter account number"
                    required
                  />
                </div>
                <div>
                  <Label>Routing Number *</Label>
                  <Input
                    type="text"
                    value={paymentData.routing_number}
                    onChange={(e) => setPaymentData({...paymentData, routing_number: e.target.value})}
                    placeholder="Enter 9-digit routing number"
                    maxLength={9}
                    required
                  />
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm text-blue-900">
                    💳 <strong>Direct Deposit via OnlineCheckWriter</strong>
                  </p>
                  <p className="text-xs text-blue-700 mt-1">
                    • ACH transfer fee: $2.90<br/>
                    • Funds typically arrive in 1-3 business days<br/>
                    • Secure & encrypted transfer
                  </p>
                </div>
              </>
            )}

            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                value={paymentData.notes}
                onChange={(e) => setPaymentData({...paymentData, notes: e.target.value})}
                placeholder="Check #1234, etc."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={handlePaymentSubmit} disabled={markAsPaidMutation.isPending}>
              {markAsPaidMutation.isPending ? t.common.loading : t.invoices.recordPayment}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeductionDialog} onOpenChange={setShowDeductionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingDeduction ? 'Edit Deduction' : 'Add Deduction'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Sales Rep</Label>
              <Input 
                value={staffProfiles.find(s => s.user_email === selectedRepForDeduction)?.full_name || ''} 
                disabled 
              />
            </div>
            <div>
              <Label>Deduction Type</Label>
              <Select 
                value={deductionData.deduction_type} 
                onValueChange={(v) => setDeductionData({...deductionData, deduction_type: v})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ladder_assist">Ladder Assist</SelectItem>
                  <SelectItem value="chargeback">Chargeback</SelectItem>
                  <SelectItem value="advance">Advance Repayment</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                value={deductionData.amount}
                onChange={(e) => setDeductionData({...deductionData, amount: e.target.value})}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={deductionData.deduction_date}
                onChange={(e) => setDeductionData({...deductionData, deduction_date: e.target.value})}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={deductionData.description}
                onChange={(e) => setDeductionData({...deductionData, description: e.target.value})}
                placeholder="e.g., Ladder assist for 123 Main St inspection"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeductionDialog(false)}>
              {t.common.cancel}
            </Button>
            <Button 
              onClick={handleDeductionSubmit} 
              disabled={addDeductionMutation.isPending || !deductionData.amount}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {addDeductionMutation.isPending ? t.common.loading : (editingDeduction ? t.common.update : t.common.add)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showManualCommissionDialog} onOpenChange={setShowManualCommissionDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Manual Commission</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Sales Rep *</Label>
              <Select 
                value={manualCommissionData.sales_rep_email} 
                onValueChange={(v) => setManualCommissionData({...manualCommissionData, sales_rep_email: v})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select sales rep" />
                </SelectTrigger>
                <SelectContent>
                  {visibleStaffProfiles.filter(s => s.user_email).map(staff => (
                    <SelectItem key={staff.user_email} value={staff.user_email}>
                      {staff.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Gross Commission Amount *</Label>
              <Input
                type="number"
                step="0.01"
                value={manualCommissionData.gross_commission}
                onChange={(e) => setManualCommissionData({...manualCommissionData, gross_commission: e.target.value})}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>Deductions (optional)</Label>
              <Input
                type="number"
                step="0.01"
                value={manualCommissionData.total_deductions}
                onChange={(e) => setManualCommissionData({...manualCommissionData, total_deductions: e.target.value})}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>Net Amount</Label>
              <Input
                value={`$${((parseFloat(manualCommissionData.gross_commission) || 0) - (parseFloat(manualCommissionData.total_deductions) || 0)).toFixed(2)}`}
                disabled
                className="bg-green-50 font-bold text-green-700"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Payment Date *</Label>
                <Input
                  type="date"
                  value={manualCommissionData.payment_date}
                  onChange={(e) => setManualCommissionData({...manualCommissionData, payment_date: e.target.value})}
                />
              </div>
              <div>
                <Label>Period (YYYY-MM) *</Label>
                <Input
                  type="month"
                  value={manualCommissionData.pay_period}
                  onChange={(e) => setManualCommissionData({...manualCommissionData, pay_period: e.target.value})}
                />
              </div>
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select 
                value={manualCommissionData.payment_method} 
                onValueChange={(v) => setManualCommissionData({...manualCommissionData, payment_method: v})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="direct_deposit">Direct Deposit</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="wire_transfer">Wire Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Description/Notes</Label>
              <Textarea
                value={manualCommissionData.notes}
                onChange={(e) => setManualCommissionData({...manualCommissionData, notes: e.target.value})}
                placeholder="e.g., Commission from previous job, backfill, bonus, etc."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManualCommissionDialog(false)}>
              {t.common.cancel}
            </Button>
            <Button 
              onClick={() => addManualCommissionMutation.mutate(manualCommissionData)}
              disabled={addManualCommissionMutation.isPending || !manualCommissionData.sales_rep_email || !manualCommissionData.gross_commission}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {addManualCommissionMutation.isPending ? t.common.loading : t.common.add}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Reminder Dialog */}
      <Dialog open={reminderDialog} onOpenChange={(open) => { if (!open) { setReminderDialog(false); setReminderLine(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-amber-500" />
              Send Payment Reminder
            </DialogTitle>
            <DialogDescription>
              {reminderLine && (
                <span>
                  Invoice <strong>{reminderLine.invoice_number}</strong> — {reminderLine.customer_name} —{' '}
                  <strong className="text-red-600">
                    ${Number(reminderLine.invoice_total || 0).toFixed(2)} total
                  </strong>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
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
                    data-testid={`pipeline-reminder-channel-${opt.value}`}
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {(reminderChannel === 'email' || reminderChannel === 'both') && (
              <div>
                <Label htmlFor="pipeline-reminder-email">Customer Email</Label>
                <Input
                  id="pipeline-reminder-email"
                  type="email"
                  value={reminderEmail}
                  onChange={e => setReminderEmail(e.target.value)}
                  placeholder="customer@example.com"
                  data-testid="input-pipeline-reminder-email"
                />
                {!reminderEmail && (
                  <p className="text-xs text-red-500 mt-1">Email is required to send via email</p>
                )}
              </div>
            )}

            {(reminderChannel === 'sms' || reminderChannel === 'both') && (
              <div>
                <Label htmlFor="pipeline-reminder-phone">Customer Phone (for SMS)</Label>
                <Input
                  id="pipeline-reminder-phone"
                  type="tel"
                  value={reminderPhone}
                  onChange={e => setReminderPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  data-testid="input-pipeline-reminder-phone"
                />
                {!reminderPhone && (
                  <p className="text-xs text-red-500 mt-1">Phone number is required to send via SMS</p>
                )}
              </div>
            )}

            <div>
              <Label htmlFor="pipeline-reminder-note">Custom message <span className="text-gray-400 font-normal">(optional)</span></Label>
              <Textarea
                id="pipeline-reminder-note"
                value={reminderNote}
                onChange={e => setReminderNote(e.target.value)}
                placeholder="Leave blank to use the default reminder message…"
                rows={3}
                data-testid="input-pipeline-reminder-note"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setReminderDialog(false); setReminderLine(null); }}
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
                onClick={() => sendReminderMutation.mutate({ line: reminderLine, email: reminderEmail, phone: reminderPhone, channel: reminderChannel, note: reminderNote })}
                className="bg-amber-500 hover:bg-amber-600 text-white"
                data-testid="btn-pipeline-send-reminder"
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
    </div>
  );
}