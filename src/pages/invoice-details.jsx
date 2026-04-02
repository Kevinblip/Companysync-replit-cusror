import React, { useState, useEffect, useRef } from "react";
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
  UserPlus,
  Split,
  Plus,
  RefreshCw,
  Pencil,
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

export default function InvoiceDetails() {
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
    refetchOnMount: true, // Ensure fresh data on navigation
  });

  // Use centralized role-based data hook for consistent company/user resolution (including impersonation)
  const { myCompany, user, myStaffProfile, isAdmin, hasPermission, isPermissionsReady, effectiveUserEmail } = useRoleBasedData();

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Customer.filter({ company_id: myCompany.id }, '-created_date', 1000) : [],
    initialData: [],
    enabled: !!myCompany?.id
  });

  // Fetch specific customer for this invoice to ensure we have the data even if not in the first 1000 list
  const { data: specificCustomer } = useQuery({
    queryKey: ['customer-for-invoice', invoice?.customer_id, invoice?.customer_name],
    queryFn: async () => {
      if (!invoice) return null;
      if (invoice.customer_id) {
        const res = await base44.entities.Customer.filter({ id: invoice.customer_id });
        return res[0];
      }
      if (invoice.customer_name) {
        const res = await base44.entities.Customer.filter({ name: invoice.customer_name });
        return res[0];
      }
      return null;
    },
    enabled: !!invoice
  });

  // Define customer here to be used in next query
  const customer = specificCustomer || customers.find(c => c.name === invoice?.customer_name);

  // Fetch ALL payments for this customer (to show unlinked ones)
  const { data: allCustomerPayments = [] } = useQuery({
    queryKey: ['customer-payments', customer?.id, customer?.name],
    queryFn: async () => {
      if (!customer) return [];
      const byId = await base44.entities.Payment.filter({ customer_id: customer.id });
      const byName = await base44.entities.Payment.filter({ customer_name: customer.name });
      
      // Merge and deduplicate
      const all = [...byId, ...byName];
      const unique = all.filter((p, index, self) => 
        index === self.findIndex(t => t.id === p.id)
      );
      return unique;
    },
    enabled: !!customer
  });

  // Fetch payments linked directly to this invoice (by id or number)
  const { data: invoicePayments = [] } = useQuery({
    queryKey: ['invoice-payments', invoice?.id, invoice?.invoice_number],
    queryFn: async () => {
      if (!invoice) return [];
      const byId = await base44.entities.Payment.filter({ invoice_id: invoice.id });
      const byNum = await base44.entities.Payment.filter({ invoice_number: invoice.invoice_number });
      const all = [...byId, ...byNum];
      return all.filter((p, i, self) => i === self.findIndex(t => t.id === p.id));
    },
    enabled: !!invoice,
    initialData: [],
  });

  const payments = invoicePayments;
  
  // Unlinked payments are those WITHOUT an invoice number, or with a different invoice number
  const unlinkedPayments = allCustomerPayments.filter(p => !p.invoice_number || p.invoice_number === 'none' || p.invoice_number === '');

  // Auto-relink safeguard
  const autoRelinkTried = useRef(false);
  useEffect(() => {
    if (!invoice || autoRelinkTried.current) return;
    const linkedTotal = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const invoicePaid = Number(invoice.amount_paid || 0);
    // If invoice shows paid (or has higher paid total) but fewer linked payments, try a one-time relink
    const needsRelink = (invoicePaid > linkedTotal + 0.01) || (invoice.status === 'paid' && payments.length < 2 && invoicePaid > 0);
    if (needsRelink) {
      autoRelinkTried.current = true;
      base44.functions
        .invoke('relinkPaymentsToInvoices', { invoice_number: invoice.invoice_number, customer_name: invoice.customer_name })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
          queryClient.invalidateQueries({ queryKey: ['payments'] });
          queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
        })
        .catch(() => {
          // noop
        });
    }
  }, [invoice, payments]);

  const linkPaymentMutation = useMutation({
    mutationFn: async (payment) => {
        await base44.entities.Payment.update(payment.id, {
            invoice_number: invoice.invoice_number,
            invoice_id: invoice.id
        });
        
        // Trigger recalculation immediately
        await base44.functions.invoke('recalculateInvoicePayments', {
            invoice_number: invoice.invoice_number
        });
    },
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
        queryClient.invalidateQueries({ queryKey: ['customer-payments'] }); // Refresh the lists
        queryClient.invalidateQueries({ queryKey: ['invoice-payments'] });
        toast.success("Payment linked successfully!");
    },
    onError: (error) => {
        toast.error("Failed to link payment: " + error.message);
    }
  });

  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [copyToCustomerProfile, setCopyToCustomerProfile] = useState(false);

  useEffect(() => {
    if (invoice?.notes) setInvoiceNotes(invoice.notes);
  }, [invoice]);

  // user and myCompany are provided by useRoleBasedData hook at the top

  const saveNotesMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.Invoice.update(invoice.id, { notes: invoiceNotes });
      
      if (copyToCustomerProfile) {
        let targetCustomer = customer;
        
        if (!targetCustomer) {
          // Fallback: Try to find customer by name if not found yet
          if (invoice.customer_id) {
            const res = await base44.entities.Customer.filter({ id: invoice.customer_id });
            targetCustomer = res[0];
          } else if (invoice.customer_name) {
            let res = await base44.entities.Customer.filter({ name: invoice.customer_name });
            if (res.length === 0) {
               // Try trimming
               res = await base44.entities.Customer.filter({ name: invoice.customer_name.trim() });
            }
            targetCustomer = res[0];
          }
        }

        if (!targetCustomer) {
          throw new Error(`Could not find customer "${invoice.customer_name}" to copy notes to.`);
        }

        // Fetch fresh customer data to ensure we don't lose existing notes
        const freshCustomerList = await base44.entities.Customer.filter({ id: targetCustomer.id });
        const freshCustomer = freshCustomerList[0];
        
        if (freshCustomer) {
          const newNote = {
            id: Date.now().toString(),
            note: `[Invoice ${invoice.invoice_number}] ${invoiceNotes}`,
            created_at: new Date().toISOString(),
            created_by: user?.email
          };
          
          await base44.entities.Customer.update(freshCustomer.id, {
            customer_notes: [...(freshCustomer.customer_notes || []), newNote]
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
        property_address: invoice.property_address || invoice.data?.property_address || '',
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
      });
    }
  }, [invoice, editForm]);

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  // myStaffProfile and isAdmin are provided by useRoleBasedData hook at the top

  // Initialize commission splits from invoice
  // Auto-populate for Sedgwick-tagged jobs (assigned rep + crew lead)
  useEffect(() => {
    if (!invoice || !staffProfiles.length) return;

    let splits = invoice.commission_splits || [];

    // Auto-populate commission splits for Sedgwick claims (5% commission for assigned rep + crew lead)
    const isYICN = myCompany?.company_name?.includes('YICN') || myCompany?.id === 'loc_mmdvp1h5_e8i9eb';
    if (isYICN) {
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

  const queryClient = useQueryClient();

  const sendInvoiceMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('sendInvoiceEmail', {
        invoiceId: invoice.id,
        companyId: myCompany?.id
      });

      await base44.entities.Invoice.update(invoice.id, {
        status: 'sent',
        sent_date: new Date().toISOString()
      });
      
      return response;
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      alert(`✅ Invoice sent to ${invoice.customer_email}! Check spam folder if not received.`);
    },
    onError: (error) => {
      console.error("Error sending invoice:", error);
      alert(`❌ Failed to send invoice: ${error.message}. Please check that customer email is valid.`);
    }
  });

  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [sendReceipt, setSendReceipt] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [editPaymentOpen, setEditPaymentOpen] = useState(false);
  const [editPaymentMethod, setEditPaymentMethod] = useState('cash');
  const [editPaymentDate, setEditPaymentDate] = useState(new Date().toISOString().split('T')[0]);

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

      // Recalculate invoice status from ALL payments
      await base44.functions.invoke('recalculateInvoicePayments', {
        invoice_number: invoice.invoice_number
      });

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

      return newPayment;
    },
    onSuccess: async () => {
    queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
    queryClient.invalidateQueries({ queryKey: ['payments'] });
    queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
    queryClient.invalidateQueries({ queryKey: ['invoice-payments'] });
    setShowPaymentDialog(false);
    setPaymentAmount('');
    setSendReceipt(true);
    setPaymentMethod('cash');
    setPaymentDate(new Date().toISOString().split('T')[0]);
      toast.success(sendReceipt ? 'Payment recorded and receipt sent!' : 'Payment recorded successfully!');
      try {
        await base44.functions.invoke('createReviewRequestForInvoice', { invoiceId: invoice.id });
      } catch (e) {
        console.warn('Review request creation skipped:', e?.message || e);
      }
    },
    onError: (error) => {
      console.error("Error recording payment:", error);
      toast.error('Failed to record payment: ' + error.message);
    }
  });

  const markAsPaidMutation = useMutation({
    mutationFn: async () => {
      const total = Number(invoice.amount || 0);
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

      await base44.entities.Payment.create({
        company_id: myCompany?.id,
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        customer_id: customer?.id,
        customer_name: invoice.customer_name,
        customer_email: invoice.customer_email || customer?.email,
        amount: amountDue,
        payment_method: 'cash',
        payment_number: paymentNumber,
        payment_date: new Date().toISOString().split('T')[0],
        status: 'received'
      });

      await base44.entities.Invoice.update(invoice.id, {
        status: 'paid',
        amount_paid: alreadyPaid + amountDue
      });

      await base44.functions.invoke('recalculateInvoicePayments', {
        invoice_number: invoice.invoice_number
      });

      try {
        await base44.functions.invoke('createReviewRequestForInvoice', { invoiceId: invoice.id });
      } catch (_) {}
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      await queryClient.invalidateQueries({ queryKey: ['payments'] });
      await queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
      await queryClient.invalidateQueries({ queryKey: ['invoice-payments'] });
      alert('✅ Marked as paid and recorded a payment for the remaining balance.');
    },
    onError: (error) => {
      console.error('Error marking invoice as paid:', error);
      alert(`❌ Failed to mark invoice as fully paid: ${error.message || 'Please try again.'}`);
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
      alert(`✅ Commission splits updated! Sent ${notificationResult.successCount} emails to sales reps.`);
    },
    onError: (error) => {
      alert(`❌ Failed to update commission splits: ${error.message}`);
    }
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
      alert('⚠️ Total split percentage cannot exceed 100%');
      return;
    }

    const validSplits = commissionSplits.filter(split => 
      split.user_email && split.split_percentage > 0
    );

    updateCommissionSplitsMutation.mutate(validSplits);
  };

  const updateInvoiceMutation = useMutation({
    mutationFn: async (data) => {
      const subtotal = data.items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      
      let discount = 0;
      if (data.discount_type === "percentage") {
        discount = subtotal * (Number(data.discount_value || 0) / 100);
      } else if (data.discount_type === "fixed") {
        discount = Number(data.discount_value || 0);
      }
      
      const afterDiscount = subtotal - discount;
      const calculatedAmount = afterDiscount + Number(data.adjustment_amount || 0);
      
      const { deposit_type, deposit_value, ...restData } = data;
      return await base44.entities.Invoice.update(invoice.id, {
        ...restData,
        amount: calculatedAmount,
        data: { deposit_type: deposit_type || 'none', deposit_value: deposit_value || 0 },
      });
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

  // 🔐 Access guard: non-admins without global view can only view invoices they're the sale agent on,
  // or where the customer is assigned to them
  if (isPermissionsReady && !isAdmin && !hasPermission('invoices', 'view_global') && effectiveUserEmail) {
    const relatedCustomer = specificCustomer || customers.find(c => 
      c.id === invoice.customer_id || c.name === invoice.customer_name
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
  const total = Number(invoice.amount || 0);
  const amountPaid = Number(invoice.amount_paid || 0);
  const amountDue = total - amountPaid;

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
    
    const totalPotentialCommission = Number(invoice.amount || 0) * (commissionRate / 100) * splitPercentage;
    const paidRatio = Number(invoice.amount_paid || 0) / Number(invoice.amount || 1);
    const earnedCommission = totalPotentialCommission * paidRatio;
    const remainingCommission = totalPotentialCommission - earnedCommission;
    
    return {
      potential: totalPotentialCommission,
      earned: earnedCommission,
      remaining: remainingCommission
    };
  };

  const handleCopyPaymentDetails = () => {
    const paymentText = `Payment Request from ${myCompany?.company_name || 'Your Company'}

Invoice #: ${invoice.invoice_number}
Customer: ${invoice.customer_name}
Amount Due: $${amountDue.toFixed(2)}
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
    alert('✅ Payment details copied! You can paste this into an email or text message.');
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Invoice {invoice.invoice_number}</h1>
          <Badge variant="outline" className={getStatusColor(invoice.status)}>
            {invoice.status}
          </Badge>
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
                  alert('❌ Cannot send invoice: Customer email is missing. Please add customer email first.');
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

          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (confirm('⚠️ Delete this invoice permanently? This cannot be undone.')) {
                  base44.entities.Invoice.delete(invoice.id).then(() => {
                    toast.success('Invoice deleted');
                    window.history.back();
                  }).catch((error) => {
                    toast.error('Failed to delete: ' + error.message);
                  });
                }
              }}
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
              <DropdownMenuItem onClick={() => alert('Duplicate functionality coming soon')}>
                <Copy className="w-4 h-4 mr-2" />
                Duplicate
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem 
                  className="text-red-600"
                  onClick={() => {
                    if (confirm('Delete this invoice? This cannot be undone.')) {
                      base44.entities.Invoice.delete(invoice.id).then(() => {
                        window.history.back();
                      });
                    }
                  }}
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
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="invoice">Invoice</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="activity">Activity Log</TabsTrigger>
            <TabsTrigger value="reminders">Reminders</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="payments">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold">Payments History ({payments.length})</h2>
                  <Button onClick={() => setShowPaymentDialog(true)} className="bg-green-600 hover:bg-green-700">
                    <DollarSign className="w-4 h-4 mr-2" />
                    Record Payment
                  </Button>
                </div>
                <div className="space-y-3">
                  {payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                      <div>
                        <div className="font-medium">{payment.payment_number}</div>
                        <div className="text-sm text-gray-500">
                          {payment.payment_date ? format(new Date(payment.payment_date), 'MMM d, yyyy') : ''}
                        </div>
                        <div className="text-xs text-gray-400">{payment.payment_method}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="font-semibold text-green-600">${Number(payment.amount || 0).toFixed(2)}</div>
                          <Badge variant="outline" className="bg-green-100 text-green-700">
                            {payment.status}
                          </Badge>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-blue-600 hover:bg-blue-50"
                            onClick={() => {
                              setSelectedPayment(payment);
                              setEditPaymentMethod((payment.payment_method || 'cash'));
                              setEditPaymentDate(payment.payment_date || new Date().toISOString().split('T')[0]);
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

          <TabsContent value="invoice">
            {isEditing && editForm ? (
              <Card>
                <CardContent className="p-6 space-y-6">
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

                    <div className="col-span-2">
                      <Label>Property / Job Address</Label>
                      <Input
                        value={editForm.property_address}
                        onChange={(e) => setEditForm({...editForm, property_address: e.target.value})}
                        placeholder="Job site address (overrides customer profile address on invoice)"
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
                  <CardContent className="p-6">
                    <div className="mb-6">
                      <h2 className="text-xl font-bold mb-4">Invoice - {invoice.invoice_number}</h2>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm font-semibold text-gray-600">Bill To:</p>
                          <p className="text-sm font-medium">{invoice.customer_name}</p>
                          {customer?.company && (
                            <p className="text-sm text-gray-600">{customer.company}</p>
                          )}
                          {(invoice.property_address || invoice.data?.property_address) ? (
                            <p className="text-sm text-gray-600">{invoice.property_address || invoice.data?.property_address}</p>
                          ) : (
                            <>
                              {customer?.street && (
                                <p className="text-sm text-gray-600">{customer.street}</p>
                              )}
                              {(customer?.city || customer?.state || customer?.zip) && (
                                <p className="text-sm text-gray-600">
                                  {[customer.city, customer.state, customer.zip].filter(Boolean).join(', ')}
                                </p>
                              )}
                            </>
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
                        {invoice.adjustment_amount && invoice.adjustment_amount !== 0 && (
                          <div className={`flex justify-between py-2 border-b ${invoice.adjustment_amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            <span className="text-sm">Adjustment:</span>
                            <span className="text-sm font-semibold">
                              {Number(invoice.adjustment_amount) > 0 ? '+' : ''}${Number(invoice.adjustment_amount || 0).toFixed(2)}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between py-2 border-b">
                          <span className="text-sm font-bold">Total</span>
                          <span className="text-sm font-bold">${total.toFixed(2)}</span>
                        </div>
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
                            <span className="font-semibold text-lg">${Number(invoice.amount || 0).toFixed(2)}</span>
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
                            onClick={async () => {
                              if (!confirm(`This will remove the $${amountPaid.toFixed(2)} payment record and reset the invoice to "sent" status. This does NOT delete any payment records — only unlinks them from this invoice. Continue?`)) return;
                              await base44.entities.Invoice.update(invoice.id, { amount_paid: 0, status: 'sent' });
                              queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
                              toast.success('Payment cleared — invoice reset to Sent status.');
                            }}
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
                                    <button className="w-full bg-purple-50 border border-purple-200 rounded p-2 hover:bg-purple-100 transition-colors text-left cursor-pointer">
                                      <p className="text-sm font-medium">{split.user_name}</p>
                                      <p className="text-xs text-purple-700">{split.split_percentage}% - {split.role}</p>
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
                                          <span className="font-bold">${Number(invoice.amount || 0).toFixed(2)}</span>
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

                        <Alert className="mb-3 bg-blue-50 border-blue-200">
                          <AlertCircle className="w-4 h-4 text-blue-600" />
                          <AlertDescription className="text-blue-900 text-xs">
                            <strong>💳 How to Request Payment via Stripe:</strong>
                            <ol className="list-decimal list-inside mt-2 space-y-1">
                              <li>Click "Copy Payment Details" below</li>
                              <li>Text or email the copied details to customer</li>
                              <li>Go to Stripe → Create invoice or payment link</li>
                              <li>Or use Zelle/Check (see payment methods below)</li>
                            </ol>
                          </AlertDescription>
                        </Alert>

                        <Button
                          className="w-full bg-blue-600 hover:bg-blue-700 mb-2"
                          onClick={handleCopyPaymentDetails}
                        >
                          <Copy className="w-4 h-4 mr-2" />
                          Copy Payment Details
                        </Button>

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

                        <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
                          <DialogTrigger asChild>
                            <Button className="w-full bg-green-600 hover:bg-green-700">
                              <DollarSign className="w-4 h-4 mr-2" />
                              Record Payment
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Record Payment</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              <div>
                                <Label htmlFor="payment-amount">Payment Amount</Label>
                                <Input
                                  id="payment-amount"
                                  type="number"
                                  step="0.01"
                                  placeholder="0.00"
                                  value={paymentAmount}
                                  onChange={(e) => setPaymentAmount(e.target.value)}
                                  min="0.01"
                                  max={amountDue.toFixed(2)}
                                  className="mt-1"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                  Amount due: ${amountDue.toFixed(2)}
                                </p>
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
                                  id="send_receipt"
                                  checked={sendReceipt}
                                  onChange={(e) => setSendReceipt(e.target.checked)}
                                  className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                                />
                                <Label htmlFor="send_receipt" className="font-normal cursor-pointer">Send receipt to customer</Label>
                              </div>

                              <div className="flex justify-end gap-3">
                                <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>
                                  Cancel
                                </Button>
                                <Button
                                  onClick={() => recordPaymentMutation.mutate()}
                                  disabled={
                                    !paymentAmount ||
                                    parseFloat(paymentAmount) <= 0 ||
                                    parseFloat(paymentAmount) > amountDue ||
                                    recordPaymentMutation.isPending
                                  }
                                  className="bg-green-600 hover:bg-green-700"
                                >
                                  {recordPaymentMutation.isPending ? (
                                    <>
                                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                      Processing...
                                    </>
                                  ) : (
                                    'Record Payment'
                                  )}
                                </Button>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>

                        {invoice.status !== 'paid' && amountDue > 0 && (
                          <Button
                            onClick={() => {
                              if (window.confirm('Mark this invoice as fully paid? This will set the amount paid to the total invoice amount.')) {
                                markAsPaidMutation.mutate();
                              }
                            }}
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
              <CardContent className="p-6">
                <p className="text-center text-gray-500 py-12">No tasks yet</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activity">
            <Card>
              <CardContent className="p-6">
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
                        <p className="text-sm">Invoice sent to {invoice.customer_email}</p>
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
              <CardContent className="p-6">
                <p className="text-center text-gray-500 py-12">No reminders set</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notes">
            <Card>
              <CardContent className="p-6 space-y-4">
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
    </div>
  );
}