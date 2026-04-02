import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Edit, Trash2, Search } from 'lucide-react';
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
import { toast } from "sonner";

export default function ChartOfAccountsPage() {
  const [user, setUser] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');

  const [formData, setFormData] = useState({
    account_number: '',
    account_name: '',
    account_type: 'asset',
    account_subtype: 'current_assets',
    parent_account_id: '',
    description: ''
  });

  const queryClient = useQueryClient();

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const myCompany = companies.find(c => c.created_by === user?.email);

  const { data: accounts = [] } = useQuery({
    queryKey: ['chart-of-accounts', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.ChartOfAccounts.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const createAccountMutation = useMutation({
    mutationFn: async (data) => {
      return await base44.entities.ChartOfAccounts.create({
        ...data,
        company_id: myCompany.id,
        balance: 0
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      setShowDialog(false);
      setEditingAccount(null);
      resetForm();
      toast.success('Account saved!');
    }
  });

  const updateAccountMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      return await base44.entities.ChartOfAccounts.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      setShowDialog(false);
      setEditingAccount(null);
      resetForm();
      toast.success('Account updated!');
    }
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async (id) => {
      return await base44.entities.ChartOfAccounts.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      toast.success('Account deleted!');
    }
  });

  const resetForm = () => {
    setFormData({
      account_number: '',
      account_name: '',
      account_type: 'asset',
      account_subtype: 'current_assets',
      parent_account_id: '',
      description: ''
    });
  };

  const handleEdit = (account) => {
    setEditingAccount(account);
    setFormData({
      account_number: account.account_number,
      account_name: account.account_name,
      account_type: account.account_type,
      account_subtype: account.account_subtype || 'current_assets',
      parent_account_id: account.parent_account_id || '',
      description: account.description || ''
    });
    setShowDialog(true);
  };

  const handleSubmit = () => {
    if (editingAccount) {
      updateAccountMutation.mutate({ id: editingAccount.id, data: formData });
    } else {
      createAccountMutation.mutate(formData);
    }
  };

  const filteredAccounts = accounts.filter(acc => {
    const matchesSearch = !searchTerm || 
      acc.account_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      acc.account_number?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesType = filterType === 'all' || acc.account_type === filterType;
    
    return matchesSearch && matchesType;
  }).sort((a, b) => a.account_number?.localeCompare(b.account_number));

  const getTypeColor = (type) => {
    const colors = {
      asset: 'bg-blue-100 text-blue-800',
      liability: 'bg-red-100 text-red-800',
      equity: 'bg-purple-100 text-purple-800',
      revenue: 'bg-green-100 text-green-800',
      expense: 'bg-orange-100 text-orange-800',
      cogs: 'bg-yellow-100 text-yellow-800'
    };
    return colors[type] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Chart of Accounts</h1>
          <p className="text-gray-500 mt-1">Manage your accounting structure</p>
        </div>
        <Button onClick={() => { resetForm(); setShowDialog(true); }} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-2" />
          Add Account
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search accounts..."
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
                <SelectItem value="asset">Assets</SelectItem>
                <SelectItem value="liability">Liabilities</SelectItem>
                <SelectItem value="equity">Equity</SelectItem>
                <SelectItem value="revenue">Revenue</SelectItem>
                <SelectItem value="expense">Expenses</SelectItem>
                <SelectItem value="cogs">COGS</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2 font-semibold">Number</th>
                  <th className="text-left p-2 font-semibold">Account Name</th>
                  <th className="text-left p-2 font-semibold">Type</th>
                  <th className="text-left p-2 font-semibold">Subtype</th>
                  <th className="text-right p-2 font-semibold">Balance</th>
                  <th className="text-right p-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map(acc => (
                  <tr key={acc.id} className="border-b hover:bg-gray-50">
                    <td className="p-2 font-mono">{acc.account_number}</td>
                    <td className="p-2 font-medium">{acc.account_name}</td>
                    <td className="p-2">
                      <Badge className={getTypeColor(acc.account_type)}>
                        {acc.account_type}
                      </Badge>
                    </td>
                    <td className="p-2 text-sm text-gray-600 capitalize">
                      {acc.account_subtype?.replace(/_/g, ' ') || '-'}
                    </td>
                    <td className="p-2 text-right font-semibold">${Number(acc.balance || 0).toFixed(2)}</td>
                    <td className="p-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => handleEdit(acc)}>
                          <Edit className="w-4 h-4" />
                        </Button>
                        {!acc.is_system_account && (
                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={() => {
                              if (window.confirm('Delete this account?')) {
                                deleteAccountMutation.mutate(acc.id);
                              }
                            }}
                            className="text-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredAccounts.length === 0 && (
                  <tr>
                    <td colSpan="6" className="p-12 text-center text-gray-500">
                      No accounts found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingAccount ? 'Edit Account' : 'Add New Account'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div>
              <Label>Account Number *</Label>
              <Input
                value={formData.account_number}
                onChange={(e) => setFormData({...formData, account_number: e.target.value})}
                placeholder="e.g., 1000"
              />
            </div>
            <div>
              <Label>Account Name *</Label>
              <Input
                value={formData.account_name}
                onChange={(e) => setFormData({...formData, account_name: e.target.value})}
                placeholder="e.g., Cash"
              />
            </div>
            <div>
              <Label>Account Type *</Label>
              <Select value={formData.account_type} onValueChange={(v) => setFormData({...formData, account_type: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asset">Asset</SelectItem>
                  <SelectItem value="liability">Liability</SelectItem>
                  <SelectItem value="equity">Equity</SelectItem>
                  <SelectItem value="revenue">Revenue</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="cogs">COGS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Subtype</Label>
              <Select value={formData.account_subtype} onValueChange={(v) => setFormData({...formData, account_subtype: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current_assets">Current Assets</SelectItem>
                  <SelectItem value="fixed_assets">Fixed Assets</SelectItem>
                  <SelectItem value="non_current_assets">Non-Current Assets</SelectItem>
                  <SelectItem value="current_liabilities">Current Liabilities</SelectItem>
                  <SelectItem value="non_current_liabilities">Non-Current Liabilities</SelectItem>
                  <SelectItem value="owner_equity">Owner's Equity</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="other_income">Other Income</SelectItem>
                  <SelectItem value="cost_of_sales">Cost of Sales</SelectItem>
                  <SelectItem value="operating_expenses">Operating Expenses</SelectItem>
                  <SelectItem value="other_expenses">Other Expenses</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                placeholder="Optional description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit}
              disabled={!formData.account_number || !formData.account_name}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {editingAccount ? 'Update' : 'Create'} Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}