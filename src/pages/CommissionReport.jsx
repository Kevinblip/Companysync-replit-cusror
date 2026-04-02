import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import useTranslation from "@/hooks/useTranslation";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DollarSign, TrendingDown, Users, Calendar, Download, CheckCircle, AlertCircle, Plus, Split, Wrench, Edit, Trash2 } from 'lucide-react';
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
  const [editingDeduction, setEditingDeduction] = useState(null);
  const [paymentData, setPaymentData] = useState({
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'check',
    notes: '',
    bank_account: '',
    routing_number: ''
  });
  const [deductionData, setDeductionData] = useState({
    deduction_type: 'ladder_assist',
    amount: '',
    deduction_date: new Date().toISOString().split('T')[0],
    description: ''
  });
  const [manualCommissionData, setManualCommissionData] = useState({
    sales_rep_email: '',
    gross_commission: '',
    total_deductions: '',
    payment_date: new Date().toISOString().split('T')[0],
    pay_period: format(new Date(), 'yyyy-MM'),
    payment_method: 'check',
    notes: '',
    description: ''
  });

  const queryClient = useQueryClient();

  const { user, myCompany, isAdmin, myStaffProfile, effectiveUserEmail } = useRoleBasedData();
  const canProcessPayments = isAdmin || myStaffProfile?.can_process_commission_payments;

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles-commreport', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Invoice.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['payments', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Payment.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: deductions = [] } = useQuery({
    queryKey: ['deductions', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.CommissionDeduction.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: commissionPayments = [] } = useQuery({
    queryKey: ['commission-payments', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.CommissionPayment.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  // Role-based: non-admins only see their own commission data
  const visibleStaffProfiles = React.useMemo(() => {
    if (isAdmin) return staffProfiles;
    return staffProfiles.filter(s => s.user_email === effectiveUserEmail);
  }, [staffProfiles, isAdmin, effectiveUserEmail]);

  const visibleInvoices = React.useMemo(() => {
    if (isAdmin) return invoices;
    return invoices.filter(inv => inv.sale_agent === effectiveUserEmail || inv.created_by === effectiveUserEmail);
  }, [invoices, isAdmin, effectiveUserEmail]);

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
        payment_date: new Date().toISOString().split('T')[0],
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
        deduction_date: new Date().toISOString().split('T')[0],
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
        payment_date: new Date().toISOString().split('T')[0],
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
        
        // Check customer assignment
        const customer = customers.find(c => c.name === inv.customer_name);
        if (customer) {
          const assignedUsers = customer.assigned_to_users || (customer.assigned_to ? [customer.assigned_to] : []);
          if (assignedUsers.includes(staff.user_email)) return true;
        }
        
        // NEW: Check invoice customer_id directly
        if (inv.customer_id) {
          const customer = customers.find(c => c.id === inv.customer_id);
          if (customer) {
            const assignedUsers = customer.assigned_to_users || (customer.assigned_to ? [customer.assigned_to] : []);
            if (assignedUsers.includes(staff.user_email)) return true;
          }
        }
        
        return false;
      });
      
      const repPayments = periodPayments.filter(payment => {
        // CRITICAL: Filter by company first
        if (payment.company_id !== myCompany?.id) return false;
        
        // Try to match payment to rep's invoices first
        const invoice = repInvoices.find(inv => 
          inv.id === payment.invoice_id || 
          inv.invoice_number === payment.invoice_number ||
          inv.customer_name === payment.customer_name ||
          (payment.customer_id && inv.customer_id === payment.customer_id)
        );
        if (invoice) return true;
        
        // FALLBACK: If no invoice match, check if payment customer is assigned to this rep
        if (payment.customer_name || payment.customer_id) {
          const customer = customers.find(c => 
            c.name === payment.customer_name || 
            c.id === payment.customer_id
          );
          
          if (customer) {
            const assignedUsers = customer.assigned_to_users || (customer.assigned_to ? [customer.assigned_to] : []);
            return assignedUsers.includes(staff.user_email);
          }
        }
        
        return false;
      });
      
      // Calculate commission WITH SPLIT SUPPORT
      let grossCommission = 0;
      const splitCommissions = [];

      repPayments.forEach(payment => {
        const invoice = repInvoices.find(inv => 
          inv.id === payment.invoice_id || 
          inv.invoice_number === payment.invoice_number ||
          inv.customer_name === payment.customer_name ||
          (payment.customer_id && inv.customer_id === payment.customer_id)
        );
        
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
            }
          }
        }

        grossCommission += repCommission;
      });

      // Include manual commission entries ONLY when there are no payment-based commissions in this period
      const manualCommissionsForPeriod = commissionPayments.filter(cp =>
        cp.sales_rep_email === staff.user_email &&
        cp.payment_date &&
        new Date(cp.payment_date) >= start &&
        new Date(cp.payment_date) <= end &&
        cp.status === 'paid'
      );
      
      const manualGrossCommission = manualCommissionsForPeriod.reduce((sum, mc) => sum + mc.gross_commission, 0);
      const manualTotalDeductions = manualCommissionsForPeriod.reduce((sum, mc) => sum + mc.total_deductions, 0);
      
      const useManualOnly = grossCommission === 0 && manualCommissionsForPeriod.length > 0;
      if (useManualOnly) {
        grossCommission = manualGrossCommission;
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
      const totalDeductions = repDeductions.reduce((sum, d) => sum + Number(d.amount || 0), 0) + (useManualOnly ? manualTotalDeductions : 0);
      const netCommission = grossCommission - totalDeductions;

      const period = selectedPeriodType === 'this_month' ? format(new Date(), 'yyyy-MM') :
                     selectedPeriodType === 'last_month' ? format(subMonths(new Date(), 1), 'yyyy-MM') :
                     null;
      
      const commissionPayment = period ? commissionPayments.find(cp => 
        cp.sales_rep_email === staff.user_email && 
        cp.pay_period === period
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
          p.invoice_id === inv.id || 
          p.invoice_number === inv.invoice_number ||
          p.customer_name === inv.customer_name
        )),
        isPaid: commissionPayment?.status === 'paid' || (useManualOnly && manualCommissionsForPeriod.some(mc => mc.pay_period === period)),
        paymentDetails: commissionPayment || (useManualOnly ? manualCommissionsForPeriod.find(mc => mc.pay_period === period) : null)
      };
    });

    return commissionsByRep;
  };

  const commissionsData = calculateCommissions();
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
      deduction_date: new Date().toISOString().split('T')[0],
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

        if (result.success) {
          queryClient.invalidateQueries({ queryKey: ['commission-payments'] });
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          setShowPaymentDialog(false);
          setSelectedRepForPayment(null);
          setPaymentData({
            payment_date: new Date().toISOString().split('T')[0],
            payment_method: 'check',
            notes: '',
            bank_account: '',
            routing_number: ''
          });
          toast.success(result.message || 'Direct deposit processed successfully!');
        } else {
          toast.error('Failed to process direct deposit');
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

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{t.sidebar.commissionTracker}</h1>
          <p className="text-gray-500 mt-1">Track sales commissions, splits, and deductions</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Button variant="outline" onClick={() => setShowManualCommissionDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Commission
            </Button>
          )}
          <Button variant="outline" onClick={exportReport}>
            <Download className="w-4 h-4 mr-2" />
            {t.common.export}
          </Button>
        </div>
      </div>

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

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
                <div className="flex gap-2">
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
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="payments">{t.sidebar.payments} ({rep.paymentCount})</TabsTrigger>
                <TabsTrigger value="splits">Splits ({rep.splitCommissions.length})</TabsTrigger>
                <TabsTrigger value="deductions">Deductions ({rep.deductions.length})</TabsTrigger>
                <TabsTrigger value="summary">Summary</TabsTrigger>
              </TabsList>

              <TabsContent value="payments" className="space-y-3 mt-4">
                {rep.payments && rep.payments.length > 0 ? (
                  rep.payments.map(payment => {
                    const invoice = rep.invoices.find(inv => inv.id === payment.invoice_id || inv.invoice_number === payment.invoice_number);
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
                    <div key={deduction.id} className={`flex justify-between items-center p-3 rounded-lg border ${deduction.deduction_type === 'advance' ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {deduction.deduction_type === 'ladder_assist' && <Wrench className="w-4 h-4 text-orange-600" />}
                          {deduction.deduction_type === 'chargeback' && <TrendingDown className="w-4 h-4 text-red-600" />}
                          {deduction.deduction_type === 'advance' && <DollarSign className="w-4 h-4 text-blue-600" />}
                          <p className="font-medium text-sm">
                            {deduction.deduction_type === 'advance' ? '💵 Commission Advance' : (deduction.description || deduction.deduction_type.replace(/_/g, ' '))}
                          </p>
                        </div>
                        {deduction.deduction_type === 'advance' && deduction.description && (
                          <p className="text-xs text-blue-800 mt-1 font-medium">📝 {deduction.description}</p>
                        )}
                        <p className="text-xs text-gray-600 mt-1">
                          {deduction.deduction_type === 'advance' ? 'Advance given · will be deducted from commission' : deduction.deduction_type.replace(/_/g, ' ')} • {format(new Date(deduction.deduction_date), 'MMM d, yyyy')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`font-bold ${deduction.deduction_type === 'advance' ? 'text-blue-700' : 'text-red-600'}`}>-${Number(deduction.amount || 0).toFixed(2)}</span>
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
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      ))}

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

            {/* Advance warning — show if there are advance deductions */}
            {selectedRepForPayment?.deductions?.filter(d => d.deduction_type === 'advance').length > 0 && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 space-y-2">
                <p className="text-sm font-semibold text-amber-900">⚠️ Outstanding Commission Advances</p>
                <p className="text-xs text-amber-800">The following advances will be subtracted from this payment:</p>
                {selectedRepForPayment.deductions.filter(d => d.deduction_type === 'advance').map(adv => (
                  <div key={adv.id} className="flex justify-between items-start bg-white rounded border border-amber-200 px-3 py-2">
                    <div>
                      <p className="text-xs font-medium text-gray-800">{adv.description || 'Commission Advance'}</p>
                      <p className="text-xs text-gray-500">{format(new Date(adv.deduction_date), 'MMM d, yyyy')}</p>
                    </div>
                    <span className="text-sm font-bold text-red-600">-${Number(adv.amount || 0).toFixed(2)}</span>
                  </div>
                ))}
                <div className="border-t border-amber-200 pt-2 space-y-1">
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>Gross commission:</span>
                    <span>${Number(selectedRepForPayment?.grossCommission || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-red-700">
                    <span>Total advances deducted:</span>
                    <span>-${selectedRepForPayment.deductions.filter(d => d.deduction_type === 'advance').reduce((s, d) => s + Number(d.amount || 0), 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-green-700">
                    <span>Net payout:</span>
                    <span>${Number(selectedRepForPayment?.netCommission || 0).toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}

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
                  <SelectItem value="direct_deposit">Direct Deposit (ACH - $2.90 fee)</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
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
                  <SelectItem value="advance">Commission Advance</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {deductionData.deduction_type === 'advance' && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs text-blue-900 font-medium">💵 Commission Advance</p>
                <p className="text-xs text-blue-800 mt-1">
                  This records money you've already paid to this rep as an advance. The amount will automatically be deducted from their next commission payment. Add a description so you can identify it later.
                </p>
              </div>
            )}

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
              <Label>Description {deductionData.deduction_type === 'advance' ? '(required — explain what the advance was for)' : '(optional)'}</Label>
              <Textarea
                value={deductionData.description}
                onChange={(e) => setDeductionData({...deductionData, description: e.target.value})}
                placeholder={
                  deductionData.deduction_type === 'advance'
                    ? 'e.g., Advance paid to Brian on June 3 for July rent help'
                    : 'e.g., Ladder assist for 123 Main St inspection'
                }
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
              disabled={addDeductionMutation.isPending || !deductionData.amount || (deductionData.deduction_type === 'advance' && !deductionData.description.trim())}
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
    </div>
  );
}