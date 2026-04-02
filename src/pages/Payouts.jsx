import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { 
  DollarSign, Plus, Send, Clock, CheckCircle, AlertCircle, 
  Filter, Search, Wrench, Users, TrendingUp, Edit, Trash2, Check
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { format } from 'date-fns';
import { toast } from "sonner";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";

export default function Payouts() {
  const [user, setUser] = useState(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingPayout, setEditingPayout] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [customPayoutTypes, setCustomPayoutTypes] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');

  const [formData, setFormData] = useState({
    recipient_email: '',
    recipient_name: '',
    payout_type: 'installer',
    amount: '',
    description: '',
    payment_method: 'direct_deposit',
    bank_account: '',
    routing_number: '',
    scheduled_date: new Date().toISOString().split('T')[0],
    customer_id: '',
    customer_name: ''
  });

  const queryClient = useQueryClient();

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);

  React.useEffect(() => {
    setCustomPayoutTypes(myCompany?.settings?.payout_types || []);
  }, [myCompany?.settings?.payout_types]);

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const filteredCustomers = React.useMemo(() => {
    const term = customerSearch.toLowerCase();
    return customers.filter(c => !term || c.name?.toLowerCase().includes(term));
  }, [customers, customerSearch]);

  const myStaffProfile = staffProfiles.find(s => s.user_email === user?.email);
  const canProcessPayments = user?.role === 'admin' || myStaffProfile?.can_process_commission_payments;

  const { data: payouts = [] } = useQuery({
    queryKey: ['payouts', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Payout.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const createPayoutMutation = useMutation({
    mutationFn: async (data) => {
      const recipient = staffProfiles.find(s => s.user_email === data.recipient_email);
      const customer = data.customer_id ? customers.find(c => c.id === data.customer_id) : null;
      
      const payout = await base44.entities.Payout.create({
        company_id: myCompany.id,
        recipient_email: data.recipient_email || null,
        recipient_name: data.recipient_name || recipient?.full_name || data.recipient_email,
        payout_type: data.payout_type,
        amount: parseFloat(data.amount),
        description: data.description,
        payment_method: data.payment_method,
        bank_account: data.bank_account,
        routing_number: data.routing_number,
        scheduled_date: data.scheduled_date,
        customer_id: data.customer_id || null,
        customer_name: customer?.name || null,
        status: 'pending',
        fee_amount: data.payment_method === 'direct_deposit' ? 2.90 : 0,
        net_amount: parseFloat(data.amount) - (data.payment_method === 'direct_deposit' ? 2.90 : 0)
      });

      return payout;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payouts'] });
      setShowCreateDialog(false);
      setFormData({
        recipient_email: '',
        recipient_name: '',
        payout_type: 'installer',
        amount: '',
        description: '',
        payment_method: 'direct_deposit',
        bank_account: '',
        routing_number: '',
        scheduled_date: new Date().toISOString().split('T')[0],
        customer_id: '',
        customer_name: ''
      });
      toast.success('Payout created successfully!');
    },
    onError: (error) => {
      toast.error(`Failed to create payout: ${error.message}`);
    }
  });

  const updatePayoutMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      return await base44.entities.Payout.update(id, data);
    },
    onSuccess: async (updatedPayout) => {
      queryClient.invalidateQueries({ queryKey: ['payouts'] });
      
      // If this is a completed commission payout, sync to accounting AND create CommissionPayment
      if (updatedPayout.payout_type === 'commission' && updatedPayout.status === 'completed') {
        // Sync to accounting
        if (myCompany?.id) {
          base44.functions.invoke('autoSyncToAccounting', {
            entity_type: 'Payout',
            entity_id: updatedPayout.id,
            company_id: myCompany.id,
            action: 'completed'
          }).catch(err => console.error('Accounting sync failed:', err));
        }
        
        // Create CommissionPayment record
        const payPeriod = format(new Date(updatedPayout.payment_date || new Date()), 'yyyy-MM');
        try {
          await base44.entities.CommissionPayment.create({
            company_id: myCompany.id,
            sales_rep_email: updatedPayout.recipient_email,
            sales_rep_name: updatedPayout.recipient_name,
            pay_period: payPeriod,
            gross_commission: updatedPayout.amount,
            total_deductions: 0,
            net_commission: updatedPayout.amount,
            status: 'paid',
            payment_date: updatedPayout.payment_date || new Date().toISOString().split('T')[0],
            payment_method: updatedPayout.payment_method,
            notes: updatedPayout.description
          });
          queryClient.invalidateQueries({ queryKey: ['commission-payments'] });
        } catch (err) {
          console.error('Failed to create CommissionPayment:', err);
        }
      }
      
      setShowEditDialog(false);
      setEditingPayout(null);
      toast.success('Payout updated successfully!');
    },
    onError: (error) => {
      toast.error(`Failed to update payout: ${error.message}`);
    }
  });

  const deletePayoutMutation = useMutation({
    mutationFn: async (id) => {
      return await base44.entities.Payout.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payouts'] });
      toast.success('Payout deleted successfully!');
    },
    onError: (error) => {
      toast.error(`Failed to delete payout: ${error.message}`);
    }
  });

  const markAsPaidMutation = useMutation({
    mutationFn: async (payout) => {
      return await base44.entities.Payout.update(payout.id, {
        status: 'completed',
        payment_date: new Date().toISOString().split('T')[0]
      });
    },
    onSuccess: async (updatedPayout) => {
      queryClient.invalidateQueries({ queryKey: ['payouts'] });
      
      // Auto-sync to accounting
      if (myCompany?.id) {
        base44.functions.invoke('autoSyncToAccounting', {
          entity_type: 'Payout',
          entity_id: updatedPayout.id,
          company_id: myCompany.id,
          action: 'completed'
        }).catch(err => console.error('Accounting sync failed:', err));
      }
      
      // If this is a commission payout, create CommissionPayment record
      if (updatedPayout.payout_type === 'commission') {
        const payPeriod = format(new Date(updatedPayout.payment_date || new Date()), 'yyyy-MM');
        try {
          await base44.entities.CommissionPayment.create({
            company_id: myCompany.id,
            sales_rep_email: updatedPayout.recipient_email,
            sales_rep_name: updatedPayout.recipient_name,
            pay_period: payPeriod,
            gross_commission: updatedPayout.amount,
            total_deductions: 0,
            net_commission: updatedPayout.amount,
            status: 'paid',
            payment_date: updatedPayout.payment_date || new Date().toISOString().split('T')[0],
            payment_method: updatedPayout.payment_method,
            notes: updatedPayout.description
          });
          queryClient.invalidateQueries({ queryKey: ['commission-payments'] });
        } catch (err) {
          console.error('Failed to create CommissionPayment:', err);
        }
      }
      
      toast.success('Marked as paid!');
    },
    onError: (error) => {
      toast.error(`Failed to mark as paid: ${error.message}`);
    }
  });

  const processPayoutMutation = useMutation({
    mutationFn: async (payout) => {
      if (payout.payment_method === 'direct_deposit') {
        const result = await base44.functions.invoke('processDirectDeposit', {
          salesRepEmail: payout.recipient_email,
          salesRepName: payout.recipient_name,
          amount: payout.net_amount,
          payPeriod: format(new Date(), 'yyyy-MM'),
          bankAccount: payout.bank_account,
          routingNumber: payout.routing_number,
          companyId: myCompany.id,
          payoutType: payout.payout_type,
          payoutId: payout.id
        });

        if (result.success) {
          await base44.entities.Payout.update(payout.id, {
            status: 'completed',
            payment_date: new Date().toISOString().split('T')[0],
            transaction_id: result.transaction?.id || result.transaction?.transaction_id
          });
        }

        return result;
      } else if (payout.payment_method === 'wise') {
        const result = await base44.functions.invoke('processWisePayout', {
          salesRepEmail: payout.recipient_email,
          salesRepName: payout.recipient_name,
          amount: payout.net_amount,
          payPeriod: format(new Date(), 'yyyy-MM'),
          bankAccount: payout.bank_account,
          routingNumber: payout.routing_number,
          companyId: myCompany.id,
          payoutType: payout.payout_type,
          payoutId: payout.id
        });

        if (result.success) {
          await base44.entities.Payout.update(payout.id, {
            status: 'completed',
            payment_date: new Date().toISOString().split('T')[0],
            transaction_id: result.transaction?.id || result.transaction?.transferId
          });
        }

        return result;
      } else {
        // Manual payment methods
        await base44.entities.Payout.update(payout.id, {
          status: 'completed',
          payment_date: new Date().toISOString().split('T')[0]
        });
        return { success: true };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payouts'] });
      toast.success('Payment processed successfully!');
    },
    onError: (error) => {
      toast.error(`Payment failed: ${error.message}`);
    }
  });

  const handleEdit = (payout) => {
    setEditingPayout(payout);
    setFormData({
      recipient_email: payout.recipient_email || '',
      recipient_name: payout.recipient_name || '',
      payout_type: payout.payout_type,
      amount: payout.amount.toString(),
      description: payout.description,
      payment_method: payout.payment_method,
      bank_account: payout.bank_account || '',
      routing_number: payout.routing_number || '',
      scheduled_date: payout.scheduled_date || new Date().toISOString().split('T')[0],
      customer_id: payout.customer_id || '',
      customer_name: payout.customer_name || ''
    });
    setShowEditDialog(true);
  };

  const handleDelete = (payout) => {
    if (window.confirm(`Delete payout to ${payout.recipient_name}?`)) {
      deletePayoutMutation.mutate(payout.id);
    }
  };

  const handleAddCustomPayoutType = async () => {
    const raw = window.prompt('Add a new payout type (e.g., Referral Bonus)');
    if (!raw) return;
    const key = raw.trim().toLowerCase().replace(/\s+/g, '_');
    if (!key) return;
    const updated = Array.from(new Set([...(customPayoutTypes || []), key]));
    setCustomPayoutTypes(updated);
    if (myCompany?.id) {
      const settings = { ...(myCompany.settings || {}), payout_types: updated };
      await base44.entities.Company.update(myCompany.id, { settings });
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    }
    setFormData((prev) => ({ ...prev, payout_type: key }));
    toast.success('Payout type added');
  };

  const handleSaveEdit = () => {
    if (!editingPayout) return;
    
    const customer = formData.customer_id ? customers.find(c => c.id === formData.customer_id) : null;
    
    updatePayoutMutation.mutate({
      id: editingPayout.id,
      data: {
        recipient_email: formData.recipient_email || null,
        recipient_name: formData.recipient_name,
        payout_type: formData.payout_type,
        amount: parseFloat(formData.amount),
        description: formData.description,
        payment_method: formData.payment_method,
        bank_account: formData.bank_account,
        routing_number: formData.routing_number,
        scheduled_date: formData.scheduled_date,
        customer_id: formData.customer_id || null,
        customer_name: customer?.name || null,
        fee_amount: formData.payment_method === 'direct_deposit' ? 2.90 : 0,
        net_amount: parseFloat(formData.amount) - (formData.payment_method === 'direct_deposit' ? 2.90 : 0)
      }
    });
  };

  const getStatusIcon = (status) => {
    const icons = {
      pending: Clock,
      processing: Send,
      completed: CheckCircle,
      failed: AlertCircle
    };
    return icons[status] || Clock;
  };

  const getStatusColor = (status) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      processing: 'bg-blue-100 text-blue-800 border-blue-300',
      completed: 'bg-green-100 text-green-800 border-green-300',
      failed: 'bg-red-100 text-red-800 border-red-300'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const getTypeIcon = (type) => {
    const icons = {
      commission: TrendingUp,
      installer: Wrench,
      staff_reimbursement: Users,
      contractor: Users,
      bonus: DollarSign,
      other: DollarSign
    };
    return icons[type] || DollarSign;
  };

  const filteredPayouts = payouts.filter(p => {
    const matchesType = filterType === 'all' || p.payout_type === filterType;
    const matchesStatus = filterStatus === 'all' || p.status === filterStatus;
    const matchesSearch = !searchTerm || 
      p.recipient_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.description?.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesType && matchesStatus && matchesSearch;
  });

  const totalPending = payouts.filter(p => p.status === 'pending').reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const totalCompleted = payouts.filter(p => p.status === 'completed').reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const installers = staffProfiles.filter(s => s.is_installer);
  const salesReps = staffProfiles.filter(s => s.commission_rate > 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Payouts</h1>
          <p className="text-gray-500 mt-1">Manage installer, contractor, and staff payments</p>
        </div>
        {canProcessPayments && (
          <Button onClick={() => setShowCreateDialog(true)} className="bg-green-600 hover:bg-green-700">
            <Plus className="w-4 h-4 mr-2" />
            New Payout
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Pending Payouts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-600">${totalPending.toFixed(2)}</div>
            <p className="text-xs text-gray-500 mt-1">{payouts.filter(p => p.status === 'pending').length} payments</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">${totalCompleted.toFixed(2)}</div>
            <p className="text-xs text-gray-500 mt-1">{payouts.filter(p => p.status === 'completed').length} payments</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Active Installers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">{installers.length}</div>
            <p className="text-xs text-gray-500 mt-1">Available for jobs</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Sales Reps</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-600">{salesReps.length}</div>
            <p className="text-xs text-gray-500 mt-1">On commission</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search payouts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="installer">Installer</SelectItem>
                <SelectItem value="commission">Commission</SelectItem>
                <SelectItem value="contractor">Contractor</SelectItem>
                <SelectItem value="staff_reimbursement">Reimbursement</SelectItem>
                <SelectItem value="bonus">Bonus</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {filteredPayouts.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <DollarSign className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>No payouts found</p>
              </div>
            ) : (
              filteredPayouts.map(payout => {
                const StatusIcon = getStatusIcon(payout.status);
                const TypeIcon = getTypeIcon(payout.payout_type);
                
                return (
                  <div key={payout.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center">
                        <TypeIcon className="w-6 h-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold">{payout.recipient_name}</h4>
                          <Badge variant="outline" className="capitalize">
                            {payout.payout_type.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">{payout.description}</p>
                        {payout.customer_name && (
                          <p className="text-xs text-blue-600 mt-1">
                            Job: {payout.customer_name}
                          </p>
                        )}
                        {payout.scheduled_date && payout.status === 'pending' && (
                          <p className="text-xs text-gray-500 mt-1">
                            Scheduled: {format(new Date(payout.scheduled_date), 'MMM d, yyyy')}
                          </p>
                        )}
                        {payout.payment_date && payout.status === 'completed' && (
                          <p className="text-xs text-green-600 mt-1">
                            Paid: {format(new Date(payout.payment_date), 'MMM d, yyyy')}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-2xl font-bold text-gray-900">${Number(payout.amount || 0).toFixed(2)}</p>
                        {payout.fee_amount > 0 && (
                          <p className="text-xs text-gray-500">Fee: ${Number(payout.fee_amount || 0).toFixed(2)}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <Badge variant="outline" className={`${getStatusColor(payout.status)} flex items-center gap-1`}>
                          <StatusIcon className="w-3 h-3" />
                          {payout.status}
                        </Badge>
                        {canProcessPayments && (
                          <div className="flex gap-1">
                            {payout.status === 'pending' && (
                              <>
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  onClick={() => markAsPaidMutation.mutate(payout)}
                                  disabled={markAsPaidMutation.isPending}
                                  className="text-green-600"
                                  title="Mark as paid (manual)"
                                >
                                  <Check className="w-3 h-3" />
                                </Button>
                                <Button 
                                  size="sm" 
                                  onClick={() => processPayoutMutation.mutate(payout)}
                                  disabled={processPayoutMutation.isPending}
                                  className="bg-green-600 hover:bg-green-700"
                                >
                                  <Send className="w-3 h-3 mr-1" />
                                  Pay Now
                                </Button>
                              </>
                            )}
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleEdit(payout)}
                            >
                              <Edit className="w-3 h-3" />
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleDelete(payout)}
                              className="text-red-600"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Payout</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Recipient</Label>
              <div className="grid gap-2">
                <Select 
                  value={formData.recipient_email} 
                  onValueChange={(v) => {
                    const s = staffProfiles.find(st => st.user_email === v);
                    setFormData({ ...formData, recipient_email: v, recipient_name: s?.full_name || formData.recipient_name });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select staff (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {staffProfiles.filter(s => s.user_email).map(staff => (
                      <SelectItem key={staff.user_email} value={staff.user_email}>
                        {staff.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Recipient name"
                  value={formData.recipient_name}
                  onChange={(e) => setFormData({ ...formData, recipient_name: e.target.value })}
                />
                <Input
                  type="email"
                  placeholder="Recipient email (optional)"
                  value={formData.recipient_email}
                  onChange={(e) => setFormData({ ...formData, recipient_email: e.target.value })}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label>Payout Type *</Label>
                <Button type="button" variant="outline" size="sm" onClick={handleAddCustomPayoutType} className="h-7 px-2">
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              </div>
              <Select 
                value={formData.payout_type} 
                onValueChange={(v) => setFormData({...formData, payout_type: v})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="installer">Installer Payment</SelectItem>
                  <SelectItem value="commission">Commission</SelectItem>
                  <SelectItem value="contractor">Contractor</SelectItem>
                  <SelectItem value="staff_reimbursement">Staff Reimbursement</SelectItem>
                  <SelectItem value="bonus">Bonus</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                  {customPayoutTypes.map((t) => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Amount *</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({...formData, amount: e.target.value})}
                placeholder="0.00"
              />
            </div>

            <div>
              <Label>Description *</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                placeholder="e.g., Roof installation at 123 Main St"
                rows={3}
              />
            </div>

            <div>
              <Label>Customer/Job (Optional)</Label>
              <Input
                placeholder="Search customers..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className="mb-2"
              />
              <Select 
                value={formData.customer_id} 
                onValueChange={(v) => {
                  const customer = customers.find(c => c.id === v);
                  setFormData({...formData, customer_id: v, customer_name: customer?.name || ''});
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None (general payout)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>None (general payout)</SelectItem>
                  {filteredCustomers.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-1">Link to specific customer for job costing</p>
            </div>

            <div>
              <Label>Payment Method</Label>
              <Select 
                value={formData.payment_method} 
                onValueChange={(v) => setFormData({...formData, payment_method: v})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="direct_deposit">Direct Deposit (ACH - $2.90 fee)</SelectItem>
                  <SelectItem value="wise">Wise (USD Bank Transfer)</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="wire_transfer">Wire Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(formData.payment_method === 'direct_deposit' || formData.payment_method === 'wise') && (
              <>
                <div>
                  <Label>Bank Account Number *</Label>
                  <Input
                    type="text"
                    value={formData.bank_account}
                    onChange={(e) => setFormData({...formData, bank_account: e.target.value})}
                    placeholder="Enter account number"
                  />
                </div>
                <div>
                  <Label>Routing Number *</Label>
                  <Input
                    type="text"
                    value={formData.routing_number}
                    onChange={(e) => setFormData({...formData, routing_number: e.target.value})}
                    placeholder="9-digit routing number"
                    maxLength={9}
                  />
                </div>
              </>
            )}

            <div>
              <Label>Scheduled Date</Label>
              <Input
                type="date"
                value={formData.scheduled_date}
                onChange={(e) => setFormData({...formData, scheduled_date: e.target.value})}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveEdit}
              disabled={updatePayoutMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {updatePayoutMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Payout</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Recipient</Label>
              <div className="grid gap-2">
                <Select 
                  value={formData.recipient_email} 
                  onValueChange={(v) => {
                    const s = staffProfiles.find(st => st.user_email === v);
                    setFormData({ ...formData, recipient_email: v, recipient_name: s?.full_name || formData.recipient_name });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select staff (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {staffProfiles.filter(s => s.user_email).map(staff => (
                      <SelectItem key={staff.user_email} value={staff.user_email}>
                        {staff.full_name} - {staff.is_installer ? 'Installer' : staff.commission_rate > 0 ? 'Sales Rep' : 'Staff'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Recipient name"
                  value={formData.recipient_name}
                  onChange={(e) => setFormData({ ...formData, recipient_name: e.target.value })}
                />
                <Input
                  type="email"
                  placeholder="Recipient email (optional)"
                  value={formData.recipient_email}
                  onChange={(e) => setFormData({ ...formData, recipient_email: e.target.value })}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label>Payout Type *</Label>
                <Button type="button" variant="outline" size="sm" onClick={handleAddCustomPayoutType} className="h-7 px-2">
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              </div>
              <Select 
                value={formData.payout_type} 
                onValueChange={(v) => setFormData({...formData, payout_type: v})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="installer">Installer Payment</SelectItem>
                  <SelectItem value="commission">Commission</SelectItem>
                  <SelectItem value="contractor">Contractor</SelectItem>
                  <SelectItem value="staff_reimbursement">Staff Reimbursement</SelectItem>
                  <SelectItem value="bonus">Bonus</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                  {customPayoutTypes.map((t) => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Amount *</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({...formData, amount: e.target.value})}
                placeholder="0.00"
              />
            </div>

            <div>
              <Label>Description *</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                placeholder="e.g., Roof installation at 123 Main St"
                rows={3}
              />
            </div>

            <div>
              <Label>Customer/Job (Optional)</Label>
              <Input
                placeholder="Search customers..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className="mb-2"
              />
              <Select 
                value={formData.customer_id} 
                onValueChange={(v) => {
                  const customer = customers.find(c => c.id === v);
                  setFormData({...formData, customer_id: v, customer_name: customer?.name || ''});
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None (general payout)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>None (general payout)</SelectItem>
                  {filteredCustomers.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-1">Link to specific customer for job costing</p>
            </div>

            <div>
              <Label>Payment Method</Label>
              <Select 
                value={formData.payment_method} 
                onValueChange={(v) => setFormData({...formData, payment_method: v})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="direct_deposit">Direct Deposit (ACH - $2.90 fee)</SelectItem>
                  <SelectItem value="wise">Wise (USD Bank Transfer)</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="wire_transfer">Wire Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(formData.payment_method === 'direct_deposit' || formData.payment_method === 'wise') && (
              <>
                <div>
                  <Label>Bank Account Number *</Label>
                  <Input
                    type="text"
                    value={formData.bank_account}
                    onChange={(e) => setFormData({...formData, bank_account: e.target.value})}
                    placeholder="Enter account number"
                  />
                </div>
                <div>
                  <Label>Routing Number *</Label>
                  <Input
                    type="text"
                    value={formData.routing_number}
                    onChange={(e) => setFormData({...formData, routing_number: e.target.value})}
                    placeholder="9-digit routing number"
                    maxLength={9}
                  />
                </div>
              </>
            )}

            <div>
              <Label>Scheduled Date</Label>
              <Input
                type="date"
                value={formData.scheduled_date}
                onChange={(e) => setFormData({...formData, scheduled_date: e.target.value})}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => createPayoutMutation.mutate(formData)}
              disabled={createPayoutMutation.isPending || !formData.recipient_name || !formData.amount || !formData.description || ((formData.payment_method==='direct_deposit' || formData.payment_method==='wise') && (!formData.bank_account || formData.routing_number.length!==9))}
              className="bg-green-600 hover:bg-green-700"
            >
              {createPayoutMutation.isPending ? 'Creating...' : 'Create Payout'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}