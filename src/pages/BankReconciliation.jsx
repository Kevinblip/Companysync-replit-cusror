import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Save, CheckCircle } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from 'date-fns';
import { toast } from "sonner";

export default function BankReconciliation() {
  const [user, setUser] = useState(null);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [statementDate, setStatementDate] = useState(new Date().toISOString().split('T')[0]);
  const [statementBalance, setStatementBalance] = useState('');
  const [checkedTransactions, setCheckedTransactions] = useState(new Set());

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

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['bank-accounts', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.BankAccount.filter({ company_id: myCompany.id, is_active: true }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions', myCompany?.id, selectedAccount],
    queryFn: () => {
      if (!myCompany || !selectedAccount) return [];
      return base44.entities.Transaction.filter({ 
        company_id: myCompany.id,
        reconciled: false
      });
    },
    enabled: !!myCompany && !!selectedAccount,
    initialData: [],
  });

  const reconcileMutation = useMutation({
    mutationFn: async () => {
      const account = bankAccounts.find(a => a.id === selectedAccount);
      
      // Update transactions as reconciled
      for (const transactionId of checkedTransactions) {
        await base44.entities.Transaction.update(transactionId, {
          reconciled: true,
          reconciled_date: statementDate
        });
      }
      
      // Update bank account
      await base44.entities.BankAccount.update(selectedAccount, {
        last_reconciled_date: statementDate,
        last_reconciled_balance: parseFloat(statementBalance),
        current_balance: parseFloat(statementBalance)
      });
      
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      setCheckedTransactions(new Set());
      toast.success('Reconciliation complete!');
    }
  });

  const toggleTransaction = (id) => {
    const newSet = new Set(checkedTransactions);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setCheckedTransactions(newSet);
  };

  const currentAccount = bankAccounts.find(a => a.id === selectedAccount);
  const accountTransactions = transactions.filter(t => 
    t.debit_account_id === currentAccount?.chart_account_id || 
    t.credit_account_id === currentAccount?.chart_account_id
  );

  const startingBalance = Number(currentAccount?.last_reconciled_balance || currentAccount?.opening_balance || 0);

  const clearedBalance = accountTransactions
    .filter(t => checkedTransactions.has(t.id))
    .reduce((sum, t) => {
      if (t.debit_account_id === currentAccount?.chart_account_id) {
        return sum + Number(t.debit_amount || 0);
      } else {
        return sum - Number(t.credit_amount || 0);
      }
    }, startingBalance);

  const difference = parseFloat(statementBalance || 0) - clearedBalance;

  const autoMatch = () => {
    const matched = new Set();
    accountTransactions.forEach(t => {
      const transDate = new Date(t.transaction_date);
      const stmtDate = new Date(statementDate);
      if (transDate <= stmtDate) {
        matched.add(t.id);
      }
    });
    setCheckedTransactions(matched);
    toast.success(`Auto-matched ${matched.size} transactions`);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Bank Reconciliation</h1>
        <p className="text-gray-500 mt-1">Match your bank statement with transactions</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reconcile Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Bank Account *</Label>
              <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map(acc => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.account_name} - {acc.bank_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Statement Date *</Label>
              <Input
                type="date"
                value={statementDate}
                onChange={(e) => setStatementDate(e.target.value)}
              />
            </div>
            <div>
              <Label>Statement Ending Balance *</Label>
              <Input
                type="number"
                step="0.01"
                value={statementBalance}
                onChange={(e) => setStatementBalance(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          {selectedAccount && (
            <>
              <div className="grid grid-cols-3 gap-4 mt-6 p-4 bg-blue-50 rounded-lg">
                <div>
                  <p className="text-sm text-gray-600">Beginning Balance</p>
                  <p className="text-xl font-bold">${startingBalance.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Cleared Balance</p>
                  <p className="text-xl font-bold">${clearedBalance.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Difference</p>
                  <p className={`text-xl font-bold ${Math.abs(difference) < 0.01 ? 'text-green-600' : 'text-red-600'}`}>
                    ${difference.toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold">Unreconciled Transactions</h3>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={autoMatch}
                    disabled={accountTransactions.length === 0}
                  >
                    Auto-Match by Date
                  </Button>
                </div>
                <div className="border rounded-lg">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="p-2 w-12"></th>
                        <th className="text-left p-2">Date</th>
                        <th className="text-left p-2">Description</th>
                        <th className="text-right p-2">Debit</th>
                        <th className="text-right p-2">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accountTransactions.map(t => (
                        <tr key={t.id} className="border-b hover:bg-gray-50">
                          <td className="p-2 text-center">
                            <Checkbox
                              checked={checkedTransactions.has(t.id)}
                              onCheckedChange={() => toggleTransaction(t.id)}
                            />
                          </td>
                          <td className="p-2">{format(new Date(t.transaction_date), 'MMM d')}</td>
                          <td className="p-2 text-sm">{t.description}</td>
                          <td className="p-2 text-right">
                            {t.debit_account_id === currentAccount?.chart_account_id && `$${Number(t.debit_amount || 0).toFixed(2)}`}
                          </td>
                          <td className="p-2 text-right">
                            {t.credit_account_id === currentAccount?.chart_account_id && `$${Number(t.credit_amount || 0).toFixed(2)}`}
                          </td>
                        </tr>
                      ))}
                      {accountTransactions.length === 0 && (
                        <tr>
                          <td colSpan="5" className="p-8 text-center text-gray-500">
                            No unreconciled transactions
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <Button 
                  onClick={() => reconcileMutation.mutate()}
                  disabled={Math.abs(difference) > 0.01 || !statementBalance || reconcileMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  {reconcileMutation.isPending ? 'Reconciling...' : 'Complete Reconciliation'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}