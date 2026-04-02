import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, Save } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export default function JournalEntry() {
  const [user, setUser] = useState(null);
  const [entries, setEntries] = useState([
    { debit_account_id: '', credit_account_id: '', amount: '', description: '' }
  ]);
  const [journalDate, setJournalDate] = useState(new Date().toISOString().split('T')[0]);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');

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

  const createJournalMutation = useMutation({
    mutationFn: async (data) => {
      const transactions = [];
      
      for (const entry of data.entries) {
        if (!entry.debit_account_id || !entry.credit_account_id || !entry.amount) continue;
        
        const debitAccount = chartOfAccounts.find(a => a.id === entry.debit_account_id);
        const creditAccount = chartOfAccounts.find(a => a.id === entry.credit_account_id);
        
        // Create transaction record
        const transaction = await base44.entities.Transaction.create({
          company_id: myCompany.id,
          transaction_date: data.date,
          transaction_type: 'journal_entry',
          reference_number: data.reference_number,
          description: entry.description || data.notes,
          debit_account_id: entry.debit_account_id,
          debit_account_name: debitAccount?.account_name,
          debit_amount: parseFloat(entry.amount),
          credit_account_id: entry.credit_account_id,
          credit_account_name: creditAccount?.account_name,
          credit_amount: parseFloat(entry.amount),
          notes: data.notes
        });
        
        transactions.push(transaction);
        
        // Update account balances
        await base44.entities.ChartOfAccounts.update(entry.debit_account_id, {
          balance: (debitAccount.balance || 0) + parseFloat(entry.amount)
        });
        
        await base44.entities.ChartOfAccounts.update(entry.credit_account_id, {
          balance: (creditAccount.balance || 0) - parseFloat(entry.amount)
        });
      }
      
      return transactions;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      setEntries([{ debit_account_id: '', credit_account_id: '', amount: '', description: '' }]);
      setReferenceNumber('');
      setNotes('');
      toast.success('Journal entry saved!');
    },
    onError: (error) => {
      toast.error(`Failed to save: ${error.message}`);
    }
  });

  const addEntry = () => {
    setEntries([...entries, { debit_account_id: '', credit_account_id: '', amount: '', description: '' }]);
  };

  const removeEntry = (index) => {
    setEntries(entries.filter((_, i) => i !== index));
  };

  const updateEntry = (index, field, value) => {
    const updated = [...entries];
    updated[index][field] = value;
    setEntries(updated);
  };

  const handleSubmit = () => {
    const totalDebit = entries.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    const totalCredit = entries.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      toast.error('Debits must equal credits!');
      return;
    }
    
    createJournalMutation.mutate({
      date: journalDate,
      reference_number: referenceNumber,
      notes,
      entries
    });
  };

  const totalDebit = entries.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const totalCredit = entries.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Journal Entry</h1>
        <p className="text-gray-500 mt-1">Record manual accounting transactions</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New Journal Entry</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Date *</Label>
              <Input
                type="date"
                value={journalDate}
                onChange={(e) => setJournalDate(e.target.value)}
              />
            </div>
            <div>
              <Label>Reference Number</Label>
              <Input
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold">Transactions</h3>
              <Button onClick={addEntry} variant="outline" size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Add Line
              </Button>
            </div>

            <div className="space-y-4">
              {entries.map((entry, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 p-4 bg-gray-50 rounded-lg">
                  <div className="col-span-3">
                    <Label className="text-xs">Debit Account *</Label>
                    <Select 
                      value={entry.debit_account_id} 
                      onValueChange={(v) => updateEntry(index, 'debit_account_id', v)}
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
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs">Credit Account *</Label>
                    <Select 
                      value={entry.credit_account_id} 
                      onValueChange={(v) => updateEntry(index, 'credit_account_id', v)}
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
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Amount *</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={entry.amount}
                      onChange={(e) => updateEntry(index, 'amount', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs">Description</Label>
                    <Input
                      value={entry.description}
                      onChange={(e) => updateEntry(index, 'description', e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="col-span-1 flex items-end">
                    {entries.length > 1 && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => removeEntry(index)}
                        className="text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center mt-4 p-4 bg-blue-50 rounded-lg">
              <div>
                <p className="text-sm text-gray-600">Total Debit: <span className="font-bold">${totalDebit.toFixed(2)}</span></p>
                <p className="text-sm text-gray-600">Total Credit: <span className="font-bold">${totalCredit.toFixed(2)}</span></p>
              </div>
              {!isBalanced && (
                <p className="text-red-600 font-semibold">⚠️ Not balanced! Difference: ${Math.abs(totalDebit - totalCredit).toFixed(2)}</p>
              )}
              {isBalanced && totalDebit > 0 && (
                <p className="text-green-600 font-semibold">✓ Balanced</p>
              )}
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes about this journal entry"
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button 
              onClick={handleSubmit}
              disabled={!isBalanced || totalDebit === 0 || createJournalMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Save className="w-4 h-4 mr-2" />
              {createJournalMutation.isPending ? 'Saving...' : 'Save Journal Entry'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}