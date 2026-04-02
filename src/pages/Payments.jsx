import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
} from "lucide-react";
import { format } from "date-fns";
import { useNavigate, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

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
  const [editPaymentForm, setEditPaymentForm] = React.useState({
    id: null,
    amount: "",
    payment_method: "cash",
    payment_date: format(new Date(), 'yyyy-MM-dd'),
    invoice_number: "",
    reference_number: "",
    notes: ""
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
    initialData: [],
    enabled: !!myCompany?.id
  });

  const customers = allCustomers;

  const { data: allPayments = [] } = useQuery({
    queryKey: ['payments', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Payment.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    initialData: [],
    enabled: !!myCompany?.id
  });

  // 🔐 Filter payments based on role permissions
  const payments = React.useMemo(() => {
    if (!user?.email) return allPayments;
    // For admins/global view, still restrict to current company (handled by query above, but double check)
    if (isAdmin || hasPermission('payments', 'view_global')) return allPayments;
    
    if (hasPermission('payments', 'view_own')) {
      // Only see payments for customers assigned to them
      return allPayments.filter(payment => {
        const customer = customers.find(c => c.name === payment.customer_name);
        if (!customer) return false;
        return customer.assigned_to === user.email || customer.assigned_to_users?.includes(user.email);
      });
    }
    return [];
  }, [allPayments, isAdmin, user?.email, customers, hasPermission]);

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Invoice.filter({ company_id: myCompany.id }) : [],
    initialData: [],
    enabled: !!myCompany?.id
  });

  const getPeriodDateRange = (period) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    switch (period) {
      case "all_time":
        return { start: null, end: null };
      case "this_month":
        return {
          start: new Date(now.getFullYear(), now.getMonth(), 1),
          end: new Date(now.getFullYear(), now.getMonth() + 1, 0)
        };
      case "last_month":
        return {
          start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
          end: new Date(now.getFullYear(), now.getMonth(), 0)
        };
      case "this_year":
        return {
          start: new Date(now.getFullYear(), 0, 1),
          end: new Date(now.getFullYear(), 11, 31)
        };
      case "last_year":
        return {
          start: new Date(now.getFullYear() - 1, 0, 1),
          end: new Date(now.getFullYear() - 1, 11, 31)
        };
      case "last_3_months":
        return {
          start: new Date(now.getFullYear(), now.getMonth() - 2, 1),
          end: today
        };
      case "last_6_months":
        return {
          start: new Date(now.getFullYear(), now.getMonth() - 5, 1),
          end: today
        };
      case "last_12_months":
        return {
          start: new Date(now.getFullYear() - 1, now.getMonth(), 1),
          end: today
        };
      default:
        return { start: null, end: null };
    }
  };

  const filteredPayments = React.useMemo(() => {
    const { start, end } = getPeriodDateRange(periodFilter);
    
    return payments.filter(payment => {
      const matchesSearch = !searchTerm || 
        payment.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        payment.payment_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        payment.invoice_number?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesPeriod = !start || !end || (() => {
        if (!payment.payment_date) return false;
        const paymentDate = new Date(payment.payment_date);
        return paymentDate >= start && paymentDate <= end;
      })();
      
      return matchesSearch && matchesPeriod;
    });
  }, [payments, searchTerm, periodFilter]);

  const totalReceived = React.useMemo(() => {
    return filteredPayments.filter(p => p.status === 'received').reduce((sum, p) => sum + Number(p.amount || 0), 0);
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
      
      // 🔥 FIX: Update invoice BEFORE creating payment
      if (paymentData.invoice_number && paymentData.invoice_number !== 'none') {
        try {
          const invoiceList = await base44.entities.Invoice.filter({ invoice_number: paymentData.invoice_number });
          if (invoiceList[0]) {
            const invoice = invoiceList[0];
            const newAmountPaid = (invoice.amount_paid || 0) + paymentData.amount;
            const totalAmount = invoice.amount || 0;
            
            let newStatus = 'partially_paid';
            if (newAmountPaid >= totalAmount) {
              newStatus = 'paid';
            }
            
            await base44.entities.Invoice.update(invoice.id, {
              amount_paid: newAmountPaid,
              status: newStatus
            });
            console.log(`✅ Invoice ${invoice.invoice_number} updated: $${newAmountPaid.toFixed(2)} paid, status: ${newStatus}`);
          }
        } catch (error) {
          console.error('⚠️ Invoice update failed:', error);
        }
      }
      
      const newPayment = await base44.entities.Payment.create({
        ...paymentData,
        payment_number: paymentNumber,
        company_id: myCompany?.id,
        status: 'received'
      });
      console.log('✅ Payment created:', newPayment.payment_number);

      // 🔥 TRIGGER COMMISSION UPDATE
      if (paymentData.invoice_number && paymentData.invoice_number !== 'none') {
        try {
          const invoiceList = await base44.entities.Invoice.filter({ invoice_number: paymentData.invoice_number });
          if (invoiceList[0]) {
            const invoice = invoiceList[0];

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
              <p><strong>Payment Date:</strong> ${format(new Date(newPayment.payment_date), 'MMM d, yyyy')}</p>
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
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
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
      const updated = await base44.entities.Payment.update(editPaymentForm.id, {
        amount: parseFloat(editPaymentForm.amount),
        payment_method: mapped,
        payment_date: editPaymentForm.payment_date,
        reference_number: editPaymentForm.reference_number || '',
        notes: finalNotes,
        invoice_number: (editPaymentForm.invoice_number || '').trim()
      });
      if (updated.invoice_number) {
        try { await base44.functions.invoke('recalculateInvoicePayments', { invoice_number: updated.invoice_number }); } catch (_) {}
      }
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setShowEditPaymentDialog(false);
    },
    onError: (e) => {
      toast.error('Failed to update payment: ' + e.message);
    }
  });

  const deletePaymentMutation = useMutation({
    mutationFn: async (payment) => {
      console.log('🗑️ Deleting payment:', payment.payment_number);
      
      // 🔥 FIX: Update invoice BEFORE deleting payment
      if (payment.invoice_number) {
        try {
          const invoiceList = await base44.entities.Invoice.filter({ invoice_number: payment.invoice_number });
          if (invoiceList[0]) {
            const invoice = invoiceList[0];
            const newAmountPaid = Math.max(0, (invoice.amount_paid || 0) - payment.amount);
            
            let newStatus = 'sent';
            if (newAmountPaid === 0) {
              newStatus = 'sent';
            } else if (newAmountPaid < invoice.amount) {
              newStatus = 'partially_paid';
            } else {
              newStatus = 'paid';
            }
            
            await base44.entities.Invoice.update(invoice.id, {
              amount_paid: newAmountPaid,
              status: newStatus
            });
            console.log(`✅ Invoice ${invoice.invoice_number} updated after payment deletion`);
          }
        } catch (error) {
          console.error('⚠️ Invoice update failed:', error);
        }
      }
      
      await base44.entities.Payment.delete(payment.id);

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
          notificationsSent: response.data.successCount,
          emailsSent: response.data.successCount,
          totalAdmins: response.data.successCount 
        };
      } catch (error) {
        console.error('Notification dispatcher failed:', error);
        return { payment, notificationsSent: 0, emailsSent: 0, totalAdmins: 0 };
      }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success(`Payment deleted. Sent ${result.emailsSent} email(s) to admins.`, { duration: 3000 });
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
      
      if (data.matchedPayments && data.matchedPayments.length > 0) {
        try {
          for (const match of data.matchedPayments) {
            const invoices = await base44.entities.Invoice.filter({ invoice_number: match.invoice });
            const invoice = invoices[0];
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
    },
    onError: (error) => {
      toast.error(`Sync failed: ${error.message}`);
    }
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
          await base44.integrations.Core.SendEmail({
            to: email,
            from_name: myCompany.company_name || 'CrewCam',
            subject: '🧪 Test Notification - Payment System',
            html: `<h2>Test Notification</h2>
              <p>This is a test email from your payment notification system.</p>
              <p><strong>Status:</strong> ✅ All automations are working correctly!</p>
              <p><strong>Company:</strong> ${myCompany.company_name}</p>
              <p><strong>Sent to:</strong> ${email}</p>
              <p><strong>Test performed by:</strong> ${user.full_name || user.email}</p>
              <hr>
              <p><small>When you record a payment, notifications like this will be sent to assignees and admins automatically, and customer receipts will be sent to customers.</small></p>`
          });
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

    createPaymentMutation.mutate({
      customer_name: paymentForm.customer_name,
      customer_email: paymentForm.customer_email, // NEW: Pass customer_email
      amount: parseFloat(paymentForm.amount),
      payment_method: paymentForm.payment_method,
      payment_date: paymentForm.payment_date,
      invoice_number: paymentForm.invoice_number || null,
      reference_number: paymentForm.reference_number || null,
      notes: paymentForm.notes || null,
      send_receipt: paymentForm.send_receipt
    });
  };

  const handleDeletePayment = (payment) => {
    if (confirm(`Delete payment ${payment.payment_number} ($${payment.amount} from ${payment.customer_name})? This will notify all admins.`)) {
      deletePaymentMutation.mutate(payment);
    }
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
      p.payment_date ? format(new Date(p.payment_date), 'yyyy-MM-dd') : ''
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payments_${new Date().toISOString().split('T')[0]}.csv`;
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

  const handleBulkDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${selectedPayments.length} payments? This action cannot be undone.`)) return;

    let successCount = 0;
    let failCount = 0;

    for (const id of selectedPayments) {
      const payment = payments.find(p => p.id === id);
      if (payment) {
        try {
          await deletePaymentMutation.mutateAsync(payment);
          successCount++;
        } catch (error) {
          failCount++;
        }
      }
    }

    toast.success(`Deleted ${successCount} payments. ${failCount > 0 ? `${failCount} failed.` : ''}`);
    setSelectedPayments([]);
  };

  const getVisibleColumnCount = () => {
    return Object.values(visibleColumns).filter(Boolean).length;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.sidebar.payments}</h1>
          <p className="text-gray-500 mt-1">Track all customer payments</p>
        </div>
        
        <div className="flex gap-2">
          {selectedPayments.length > 0 && (
            <Button 
              variant="destructive" 
              onClick={handleBulkDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {t.common.delete} ({selectedPayments.length})
            </Button>
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
                    disabled={createPaymentMutation.isPending}
                    className="flex-1 bg-green-600 hover:bg-green-700 min-h-[48px]"
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
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <DollarSign className="w-8 h-8" />
              <span className="text-sm opacity-80">Total Received</span>
            </div>
            <h3 className="text-3xl font-bold">${totalReceived.toFixed(2)}</h3>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-yellow-500 to-yellow-600 text-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="w-8 h-8" />
              <span className="text-sm opacity-80">{t.common.pending}</span>
            </div>
            <h3 className="text-3xl font-bold">${pendingAmount.toFixed(2)}</h3>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <CardContent className="p-6">
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
                        <td className="py-4">
                          <button
                            onClick={() => {
                              const customer = customers.find(c => c.name === payment.customer_name);
                              const target = customer?.id
                                ? createPageUrl('CustomerProfile') + `?id=${customer.id}`
                                : createPageUrl('CustomerProfile') + `?name=${encodeURIComponent(payment.customer_name)}`;
                              navigate(target);
                            }}
                            className="text-blue-600 hover:underline"
                          >
                            {payment.customer_name}
                          </button>
                        </td>
                      )}
                      {visibleColumns.invoice && <td className="py-4 text-sm text-gray-600">{payment.invoice_number || '-'}</td>}
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
                          <Badge variant="outline" className={getStatusColor(payment.status)}>
                            {payment.status === 'paid' ? t.common.paid : payment.status === 'pending' ? t.common.pending : payment.status}
                          </Badge>
                        </td>
                      )}
                      {visibleColumns.date && (
                        <td className="py-4 text-sm text-gray-600">
                          {payment.payment_date ? format(new Date(payment.payment_date), 'MMM d, yyyy') : '-'}
                        </td>
                      )}
                      {visibleColumns.actions && (
                        <td className="py-4 flex gap-1">
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
    </div>
  );
}