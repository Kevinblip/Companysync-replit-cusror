import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
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
import { createPageUrl } from "@/utils";
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
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { TablePageSkeleton } from "@/components/PageSkeleton";
import useTranslation from "@/hooks/useTranslation";

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
  
  const [newInvoiceForm, setNewInvoiceForm] = useState({
    invoice_number: "",
    customer_name: "",
    customer_email: "",
    amount: "",
    status: "draft",
    due_date: "",
    issue_date: new Date().toISOString().split('T')[0],
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
  const [selectedInvoices, setSelectedInvoices] = useState([]);
  const [showBatchPaymentsDialog, setShowBatchPaymentsDialog] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState({
    invoice_number: true,
    amount: true,
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
    initialData: [],
    enabled: !!myCompany?.id
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Customer.filter({ company_id: myCompany.id }) : [],
    initialData: [],
    enabled: !!myCompany?.id
  });

  const { data: estimates = [] } = useQuery({
    queryKey: ['estimates', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Estimate.filter({ company_id: myCompany.id }) : [],
    initialData: [],
    enabled: !!myCompany?.id
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
    initialData: [],
    enabled: !!myCompany?.id
  });

  // 🔐 Filter data based on permissions
  const filteredCustomers = useMemo(() => {
    if (typeof filterCustomers !== 'function') return [];
    return filterCustomers(customers) || [];
  }, [customers, filterCustomers]);

  const invoices = useMemo(() => {
    if (typeof filterInvoices !== 'function') return [];
    return filterInvoices(allInvoices, filteredCustomers) || [];
  }, [allInvoices, filteredCustomers, filterInvoices]);

  const generateNextInvoiceNumber = () => {
    if (invoices.length === 0) {
      return "INV-0001";
    }
    
    const numbers = invoices
      .map(inv => inv.invoice_number)
      .filter(num => num && num.startsWith('INV-'))
      .map(num => parseInt(num.replace('INV-', '')))
      .filter(num => !isNaN(num));
    
    if (numbers.length === 0) {
      return "INV-0001";
    }
    
    const maxNumber = Math.max(...numbers);
    const nextNumber = maxNumber + 1;
    return `INV-${nextNumber.toString().padStart(4, '0')}`;
  };

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const prefill = params.get('prefill');
    const createNew = params.get('create_new');
    const customerName = params.get('customer_name');
    const customerEmail = params.get('customer_email');

    if (prefill === 'true' && createNew === 'true' && !showCreateDialog) {
      const nextNumber = generateNextInvoiceNumber();
      
      let autoAmount = "";
      if (customerName && customers.length > 0) {
        const matchingCustomer = customers.find(c => c.name?.toLowerCase() === customerName?.toLowerCase());
        if (matchingCustomer) {
          const customerEstimates = estimates.filter(est => 
            est.customer_id === matchingCustomer.id || 
            est.customer_name?.toLowerCase() === matchingCustomer.name?.toLowerCase()
          );
          const latestEst = customerEstimates
            .filter(est => Number(est.total_amount) > 0)
            .sort((a, b) => new Date(b.created_date || b.created_at || 0) - new Date(a.created_date || a.created_at || 0))[0];
          if (latestEst) {
            autoAmount = String(Number(latestEst.total_amount).toFixed(2));
          } else if (Number(matchingCustomer.total_revenue) > 0) {
            autoAmount = String(Number(matchingCustomer.total_revenue).toFixed(2));
          }
        }
      }

      setNewInvoiceForm({
        invoice_number: nextNumber,
        customer_name: customerName || "",
        customer_email: customerEmail || "",
        amount: autoAmount,
        status: "draft",
        due_date: "",
        issue_date: new Date().toISOString().split('T')[0],
        items: [],
        notes: "",
        sale_agent: "",
        commission_splits: []
      });
      setShowCreateDialog(true);
    }
  }, [location.search, invoices]); // eslint-disable-line react-hooks/exhaustive-deps

  const createInvoiceMutation = useMutation({
    mutationFn: async (invoiceData) => {
      let commissionSplits = [];
      const customer = customers.find(c => c.name === invoiceData.customer_name);
      
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
              message: `Invoice ${newInvoice.invoice_number} - $${newInvoice.amount}${isAssignee ? ' (assigned to you)' : ''}`,
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
                <p><strong>Amount:</strong> $${newInvoice.amount}</p>
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
            message: `Invoice ${newInvoice.invoice_number} for ${newInvoice.customer_name} - $${newInvoice.amount}${commissionSplits.length > 0 ? ` (Assigned to: ${commissionSplits.map(cs => cs.user_name).join(', ')})` : ''}`,
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
      
      if (myCompany?.id) {
        try {
          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'invoice_created',
            companyId: myCompany.id,
            entityType: 'Invoice',
            entityId: newInvoice.id,
            entityData: {
              invoice_number: newInvoice.invoice_number || '',
              customer_name: newInvoice.customer_name || '',
              customer_email: newInvoice.customer_email || '',
              amount: newInvoice.amount || 0,
              due_date: newInvoice.due_date || '',
              status: newInvoice.status || 'draft',
              app_url: window.location.origin || ''
            }
          });
        } catch (error) {
          console.error('Workflow trigger failed (non-critical):', error);
        }
      }
      
      return newInvoice;
    },
    onSuccess: async (newInvoice) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.email] });
      setShowCreateDialog(false);
      
      if (myCompany?.id) {
        try {
          await base44.functions.invoke('autoTriggerWorkflowsFromMutation', {
            action: 'create',
            entityType: 'Invoice',
            entityId: newInvoice.id,
            entityData: newInvoice,
            companyId: myCompany.id
          });
          console.log('✅ Workflows triggered for new invoice:', newInvoice.id);
        } catch (error) {
          console.error('⚠️ Workflow trigger failed:', error);
        }
      }
      
      setNewInvoiceForm({
        invoice_number: "",
        customer_name: "",
        customer_email: "",
        amount: "",
        due_date: "",
        issue_date: new Date().toISOString().split('T')[0],
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

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const oldInvoice = invoices.find(i => i.id === id);
      const updatedInvoice = await base44.entities.Invoice.update(id, data);

      if (data.status === 'paid' && oldInvoice?.status !== 'paid') {
        // Check for referral fee owed
        const invoiceCustomer = customers.find(c => c.name === updatedInvoice.customer_name);
        if (invoiceCustomer?.referral_source) {
          setTimeout(() => {
            toast.success(`💰 Referral Fee Owed — ${updatedInvoice.customer_name} was referred by ${invoiceCustomer.referral_source}. Don't forget to pay the referral fee!`, { duration: 8000 });
          }, 800);
        }

        try {
          const salesRepEmails = updatedInvoice.commission_splits?.map(cs => cs.user_email) ||
                                 (updatedInvoice.sale_agent ? [updatedInvoice.sale_agent] : []) ||
                                 (updatedInvoice.created_by ? [updatedInvoice.created_by] : []);

          if (salesRepEmails.length > 0 && updatedInvoice.amount) {
            for (const salesRepEmail of salesRepEmails) {
              await base44.functions.invoke('updateCommissions', {
                paymentId: `invoice_payment_${id}_${salesRepEmail}`,
                invoiceId: id,
                amount: updatedInvoice.amount / salesRepEmails.length,
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
              amount: updatedInvoice.amount || 0,
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
              amount: updatedInvoice.amount || 0,
              payment_date: new Date().toISOString(),
              app_url: window.location.origin || ''
            }
          });
        } catch (error) {
          console.error('Workflow trigger failed (non-critical):', error);
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
          if (salesRepEmails.length > 0 && invoice.amount) {
            for (const salesRepEmail of salesRepEmails) {
              commissionUpdates.push({
                invoiceId: id,
                amount: invoice.amount / salesRepEmails.length,
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

  const batchDeleteMutation = useMutation({
    mutationFn: async () => {
      const deletePromises = selectedInvoices.map(id => 
        base44.entities.Invoice.delete(id)
      );
      await Promise.all(deletePromises);
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

    if (window.confirm(`⚠️ DELETE INVOICE\n\nAre you sure you want to delete invoice ${invoice.invoice_number}?\n\nCustomer: ${invoice.customer_name}\nAmount: $${invoice.amount}\n\nThis action CANNOT be undone!`)) {
      deleteInvoiceMutation.mutate(invoice.id);
    }
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

  const sendInvoiceMutation = useMutation({
    mutationFn: async (invoice) => {
      if (myCompany?.id) {
        await base44.functions.invoke('sendInvoiceEmail', {
          invoiceId: invoice.id,
          companyId: myCompany.id
        });
      }

      const updatedInvoice = await base44.entities.Invoice.update(invoice.id, {
        status: 'sent',
        sent_date: new Date().toISOString()
      });

      if (myCompany?.id && updatedInvoice.status === 'sent') {
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
              title: '📤 Invoice Sent',
              message: `Invoice ${updatedInvoice.invoice_number} sent to ${updatedInvoice.customer_name}${isAssignee ? ' (your commission)' : ''}`,
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

      if (myCompany?.id) {
        try {
          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'invoice_created',
            entityType: 'Invoice',
            entityId: updatedInvoice.id,
            entityData: {
              ...updatedInvoice,
              invoice_number: updatedInvoice.invoice_number || '',
              customer_name: updatedInvoice.customer_name || '',
              customer_email: updatedInvoice.customer_email || '',
              amount: updatedInvoice.amount || 0,
            },
            companyId: myCompany.id
          });
        } catch (error) {
          console.error('Workflow trigger failed (non-critical):', error);
        }
      }

      return updatedInvoice;
    },
    onSuccess: (data, invoice) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      alert(`✅ Invoice sent to ${invoice.customer_email}!`);
    },
    onError: (error) => {
      toast.error(`❌ Failed to send invoice: ${error.message}`);
    }
  });

  const handleSendInvoice = (invoice) => {
    if (!invoice.customer_email) {
      toast.error('❌ Cannot send invoice: Customer email is missing.\n\nPlease add an email address first.');
      return;
    }

    if (window.confirm(`Send invoice ${invoice.invoice_number} to ${invoice.customer_email}?`)) {
      sendInvoiceMutation.mutate(invoice);
    }
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
      customer_name: "",
      customer_email: "",
      amount: "",
      status: "draft",
      due_date: "",
      issue_date: new Date().toISOString().split('T')[0],
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
      customer_name: "",
      customer_email: "",
      amount: "",
      status: "draft",
      due_date: "",
      issue_date: new Date().toISOString().split('T')[0],
      items: [],
      notes: "",
      sale_agent: "",
      commission_splits: []
    });
    setShowCreateDialog(true);
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
    .filter(i => i.issue_date && !isNaN(new Date(i.issue_date).getTime()))
    .map(i => new Date(i.issue_date).getFullYear())
  )];
  
  const availableYears = [...new Set([currentYear, ...yearsFromInvoices])].sort((a, b) => b - a);

  // ✅ YEAR FILTER: Filter all invoices by selected year
  const yearFilteredInvoices = selectedYear === 'all'
    ? invoices
    : invoices.filter(i => {
        if (!i.issue_date) return false;
        return new Date(i.issue_date).getFullYear().toString() === selectedYear;
      });

  // For the table - show ALL invoices
  const tableInvoices = invoices;

  // ✅ PAID INVOICES: Year-filtered (only show paid invoices for selected year)
  const paidInvoices = yearFilteredInvoices.filter(i => i.status === 'paid');
  
  // ✅ OVERDUE & OUTSTANDING: Show ALL from any year (roll over to current year)
  const overdueInvoices = invoices.filter(inv => {
    if (inv.status === 'paid' || inv.status === 'cancelled') return false;
    if (!inv.due_date) return false;
    const dueDate = new Date(inv.due_date);
    dueDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dueDate < today;
  });

  const unpaidInvoices = invoices.filter(i =>
    !i.status ||
    i.status === 'draft' ||
    i.status === 'sent' ||
    i.status === 'viewed' ||
    i.status === 'partially_paid'
  );

  const draftInvoices = yearFilteredInvoices.filter(i => i.status === 'draft');
  const partiallyPaidInvoices = yearFilteredInvoices.filter(i => i.status === 'partially_paid');

  const totalCount = yearFilteredInvoices.length;
  const paidTotal = paidInvoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

  // Outstanding = remaining balance on unpaid invoices (year-filtered)
  const outstandingTotal = unpaidInvoices.reduce((sum, inv) => {
    const remaining = (Number(inv.amount) || 0) - (Number(inv.amount_paid) || 0);
    return sum + remaining;
  }, 0);

  // Overdue = remaining balance on overdue invoices (year-filtered)
  const overdueTotal = overdueInvoices.reduce((sum, inv) => {
    const remaining = (Number(inv.amount) || 0) - (Number(inv.amount_paid) || 0);
    return sum + remaining;
  }, 0);

  const getPercentage = (count) => totalCount > 0 ? ((count / totalCount) * 100).toFixed(2) : '0.00';

  const filteredInvoices = tableInvoices.filter(invoice => {
    const matchesTab =
      (activeTab === 'all') ||
      (activeTab === 'unpaid' && (!invoice.status || invoice.status === 'draft' || invoice.status === 'sent' || invoice.status === 'viewed' || invoice.status === 'partially_paid')) ||
      (activeTab === 'paid' && invoice.status === 'paid') ||
      (activeTab === 'partially_paid' && invoice.status === 'partially_paid') ||
      (activeTab === 'overdue' && invoice.status === 'overdue') ||
      (activeTab === 'draft' && invoice.status === 'draft');

    if (!matchesTab) return false;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        invoice.invoice_number?.toLowerCase().includes(query) ||
        invoice.customer_name?.toLowerCase().includes(query) ||
        invoice.customer_email?.toLowerCase().includes(query) ||
        invoice.claim_number?.toLowerCase().includes(query) ||
        invoice.insurance_company?.toLowerCase().includes(query)
      );
    }

    return true;
  });

  const totalPages = Math.ceil(filteredInvoices.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedInvoices = filteredInvoices.slice(startIndex, endIndex);

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
    <div className="p-6 space-y-6">
      <Toaster />
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-white border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <div className="text-sm text-gray-600">{t.invoices.paid} {t.invoices.title}</div>
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-gray-100 flex-wrap h-auto">
          <TabsTrigger value="all" className="flex-col items-start">
            <span>{t.common.all}</span>
            <span className="text-xs text-gray-500">({totalCount})</span>
          </TabsTrigger>
          <TabsTrigger value="unpaid" className="flex-col items-start">
            <span>{t.invoices.amountDue}</span>
            <span className="text-xs text-gray-500">({getPercentage(unpaidInvoices.length)}%) {unpaidInvoices.length} / {totalCount}</span>
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
            <span className="text-xs text-gray-500">({getPercentage(overdueInvoices.length)}%) {overdueInvoices.length} / {totalCount}</span>
          </TabsTrigger>
          <TabsTrigger value="draft" className="flex-col items-start">
            <span>{t.invoices.draft}</span>
            <span className="text-xs text-gray-500">({getPercentage(draftInvoices.length)}%) {draftInvoices.length} / {totalCount}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

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
            <Button
              variant="outline"
              onClick={() => {
                if (window.confirm(`⚠️ DELETE ${selectedInvoices.length} INVOICES\n\nAre you sure you want to delete ${selectedInvoices.length} selected invoice(s)?\n\nThis action CANNOT be undone!`)) {
                  batchDeleteMutation.mutate();
                }
              }}
              disabled={selectedInvoices.length === 0 || batchDeleteMutation.isPending}
              className="border-red-500 text-red-700 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {batchDeleteMutation.isPending ? t.common.loading : `${t.common.delete} (${selectedInvoices.length})`}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={async () => {
              if (confirm(t.common.status === 'sent' ? 'Recalculate all invoice statuses based on payment amounts? This will fix any out-of-sync invoices.' : '¿Recalcular todos los estados de las facturas en función de los importes de los pagos? Esto corregirá cualquier factura desincronizada.')) {
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
              }
            }}
            className="bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100"
          >
            {t.common.status === 'sent' ? 'Fix Statuses' : 'Corregir estados'}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Select value={itemsPerPage.toString()} onValueChange={(val) => setItemsPerPage(parseInt(val))}>
            <SelectTrigger className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
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

      <Card className="bg-white shadow-md">
        <CardContent className="p-0">
          {isMobile ? (
            <div className="pb-20">
              {paginatedInvoices.length === 0 ? (
                <div className="py-12 text-center text-gray-500">
                  {t.invoices.noInvoices}
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {paginatedInvoices.map((invoice) => {
                    const balance = Number(invoice.amount || 0) - Number(invoice.amount_paid || 0);
                    return (
                      <button
                        key={invoice.id}
                        onClick={() => navigate(createPageUrl('invoice-details') + `?id=${invoice.id}`)}
                        className="w-full text-left p-4 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                        data-testid={`card-invoice-${invoice.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-blue-600 text-base">{invoice.invoice_number}</span>
                          <Badge variant="outline" className={getStatusColor(invoice.status)}>
                            {invoice.status?.replace(/_/g, ' ') || 'Draft'}
                          </Badge>
                        </div>
                        <div className="mt-1.5">
                          <p className="font-medium text-gray-900 text-sm">{invoice.customer_name}</p>
                          {invoice.due_date && (
                            <p className="text-xs text-gray-400 mt-0.5">{t.invoices.dueDate}: {invoice.due_date}</p>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <div>
                            <span className="text-lg font-bold text-gray-900">${(Number(invoice.amount) || 0).toFixed(2)}</span>
                            {invoice.status !== 'paid' && balance > 0 && (
                              <span className="text-xs text-red-500 ml-2">{t.invoices.balance}: ${balance.toFixed(2)}</span>
                            )}
                          </div>
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
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
                        ${(Number(invoice.amount) || 0).toFixed(2)}
                      </td>
                    )}
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
                        <button
                          onClick={() => navigate(createPageUrl('CustomerProfile') + `?name=${encodeURIComponent(invoice.customer_name)}`)}
                          className="text-gray-900 hover:text-blue-600"
                        >
                          {invoice.customer_name}
                        </button>
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
                    {visibleColumns.status && (
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={getStatusColor(invoice.status)}>
                          {invoice.status === 'sent' || invoice.status === 'viewed' ? t.invoices.amountDue :
                           invoice.status === 'partially_paid' ? t.invoices.partiallyPaid :
                           invoice.status === 'paid' ? t.invoices.paid :
                           invoice.status === 'overdue' ? t.invoices.overdue :
                           invoice.status === 'draft' ? t.invoices.draft :
                           invoice.status === 'cancelled' ? t.invoices.cancelled :
                           invoice.status?.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                    )}
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
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
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
                    <td colSpan={20} className="py-12 text-center text-gray-500">
                      {t.invoices.noInvoices}
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

            <div>
              <Label htmlFor="customer_name">{t.invoices.customer} *</Label>
              <Input
                id="customer_name"
                value={newInvoiceForm.customer_name}
                onChange={(e) => {
                  const value = e.target.value;
                  setNewInvoiceForm({...newInvoiceForm, customer_name: value});
                  
                  const matchingCustomer = customers.find(c => c.name?.toLowerCase() === value.toLowerCase());
                  if (matchingCustomer) {
                    const customerEstimates = estimates.filter(est => 
                      est.customer_id === matchingCustomer.id || 
                      est.customer_name?.toLowerCase() === matchingCustomer.name?.toLowerCase()
                    );
                    const latestEstimate = customerEstimates
                      .filter(est => Number(est.total_amount) > 0)
                      .sort((a, b) => new Date(b.created_date || b.created_at || 0) - new Date(a.created_date || a.created_at || 0))[0];
                    
                    const autoAmount = latestEstimate 
                      ? String(Number(latestEstimate.total_amount).toFixed(2))
                      : (Number(matchingCustomer.total_revenue) > 0 ? String(Number(matchingCustomer.total_revenue).toFixed(2)) : newInvoiceForm.amount);

                    setNewInvoiceForm(prev => ({
                      ...prev,
                      customer_email: matchingCustomer.email || prev.customer_email,
                      amount: prev.amount || autoAmount
                    }));
                  }
                }}
                placeholder={t.invoices.customer}
                list="customers-list-invoices"
                required
              />
              <datalist id="customers-list-invoices">
                {customers.map((customer, idx) => (
                  <option key={idx} value={customer.name}>
                    {customer.email ? `${customer.name} (${customer.email})` : customer.name}
                  </option>
                ))}
              </datalist>
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
                const matchingCustomer = customers.find(c => c.name?.toLowerCase() === newInvoiceForm.customer_name?.toLowerCase());
                if (!matchingCustomer) return null;
                const customerEstimates = estimates.filter(est => est.customer_id === matchingCustomer.id || est.customer_name?.toLowerCase() === matchingCustomer.name?.toLowerCase());
                const latestEst = customerEstimates.filter(est => Number(est.total_amount) > 0).sort((a, b) => new Date(b.created_date || b.created_at || 0) - new Date(a.created_date || a.created_at || 0))[0];
                if (!latestEst) return null;
                return <p className="text-xs text-blue-600 mt-1">Auto-filled from estimate {latestEst.estimate_number || ''} (${Number(latestEst.total_amount).toFixed(2)})</p>;
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
                disabled={createInvoiceMutation.isPending || !newInvoiceForm.customer_name || !newInvoiceForm.amount || parseFloat(newInvoiceForm.amount) <= 0}
                className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto"
              >
                {createInvoiceMutation.isPending ? t.common.loading : t.invoices.createInvoice}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

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
    </div>
  );
}