import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowRight, Save } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export default function TransferFunds() {
  const [user, setUser] = useState(null);
  const [formData, setFormData] = useState({
    from_account: '',
    to_account: '',
    amount: '',
    transfer_date: new Date().toISOString().split('T')[0],
    reference_number: '',
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

  const { data: chartOfAccounts = [] } = useQuery({
    queryKey: ['chart-of-accounts', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.ChartOfAccounts.filter({ company_id: myCompany.id, is_active: true }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const transferMutation = useMutation({
    mutationFn: async (data) => {
      const fromAccount = chartOfAccounts.find(a => a.id === data.from_account);
      const toAccount = chartOfAccounts.find(a => a.id === data.to_account);
      const amount = parseFloat(data.amount);
      
      // Create transaction
      const transaction = await base44.entities.Transaction.create({
        company_id: myCompany.id,
        transaction_date: data.transfer_date,
        transaction_type: 'transfer',
        reference_number: data.reference_number,
        description: data.description || `Transfer from ${fromAccount.account_name} to ${toAccount.account_name}`,
        debit_account_id: data.to_account,
        debit_account_name: toAccount.account_name,
        debit_amount: amount,
        credit_account_id: data.from_account,
        credit_account_name: fromAccount.account_name,
        credit_amount: amount
      });
      
      // Update account balances
      await base44.entities.ChartOfAccounts.update(data.from_account, {
        balance: Number(fromAccount.balance || 0) - amount
      });
      
      await base44.entities.ChartOfAccounts.update(data.to_account, {
        balance: Number(toAccount.balance || 0) + amount
      });
      
      return transaction;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      setFormData({
        from_account: '',
        to_account: '',
        amount: '',
        transfer_date: new Date().toISOString().split('T')[0],
        reference_number: '',
        description: ''
      });
      toast.success('Transfer completed!');
    },
    onError: (error) => {
      toast.error(`Transfer failed: ${error.message}`);
    }
  });

  const handleSubmit = () => {
    if (formData.from_account === formData.to_account) {
      toast.error('Cannot transfer to the same account');
      return;
    }
    
    transferMutation.mutate(formData);
  };

  const fromAccount = chartOfAccounts.find(a => a.id === formData.from_account);
  const toAccount = chartOfAccounts.find(a => a.id === formData.to_account);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Transfer Funds</h1>
        <p className="text-gray-500 mt-1">Move money between accounts</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New Transfer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Transfer Date *</Label>
              <Input
                type="date"
                value={formData.transfer_date}
                onChange={(e) => setFormData({...formData, transfer_date: e.target.value})}
              />
            </div>
            <div>
              <Label>Reference Number</Label>
              <Input
                value={formData.reference_number}
                onChange={(e) => setFormData({...formData, reference_number: e.target.value})}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 items-center">
            <div>
              <Label>From Account *</Label>
              <Select 
                value={formData.from_account} 
                onValueChange={(v) => setFormData({...formData, from_account: v})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {chartOfAccounts.map(acc => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.account_number} - {acc.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fromAccount && (
                <p className="text-sm text-gray-600 mt-1">
                  Balance: ${Number(fromAccount.balance || 0).toFixed(2)}
                </p>
              )}
            </div>

            <div className="text-center pt-6">
              <ArrowRight className="w-8 h-8 mx-auto text-blue-600" />
            </div>

            <div>
              <Label>To Account *</Label>
              <Select 
                value={formData.to_account} 
                onValueChange={(v) => setFormData({...formData, to_account: v})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {chartOfAccounts.map(acc => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.account_number} - {acc.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {toAccount && (
                <p className="text-sm text-gray-600 mt-1">
                  Balance: ${Number(toAccount.balance || 0).toFixed(2)}
                </p>
              )}
            </div>
          </div>

          <div>
            <Label>Amount *</Label>
            <Input
              type="number"
              step="0.01"
              value={formData.amount}
              onChange={(e) => setFormData({...formData, amount: e.target.value})}
              placeholder="0.00"
              className="text-lg font-semibold"
            />
          </div>

          <div>
            <Label>Description</Label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              placeholder="Optional description"
              rows={3}
            />
          </div>

          {formData.from_account && formData.to_account && formData.amount && (
            <div className="p-4 bg-blue-50 rounded-lg">
              <h4 className="font-semibold mb-2">Transfer Summary</h4>
              <p className="text-sm">
                Transfer <span className="font-bold">${parseFloat(formData.amount || 0).toFixed(2)}</span> from{' '}
                <span className="font-semibold">{fromAccount?.account_name}</span> to{' '}
                <span className="font-semibold">{toAccount?.account_name}</span>
              </p>
              <p className="text-sm mt-2 text-gray-600">
                New balance in {fromAccount?.account_name}: ${(Number(fromAccount?.balance || 0) - parseFloat(formData.amount || 0)).toFixed(2)}
              </p>
              <p className="text-sm text-gray-600">
                New balance in {toAccount?.account_name}: ${(Number(toAccount?.balance || 0) + parseFloat(formData.amount || 0)).toFixed(2)}
              </p>
            </div>
          )}

          <div className="flex justify-end">
            <Button 
              onClick={handleSubmit}
              disabled={!formData.from_account || !formData.to_account || !formData.amount || transferMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Save className="w-4 h-4 mr-2" />
              {transferMutation.isPending ? 'Processing...' : 'Complete Transfer'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}