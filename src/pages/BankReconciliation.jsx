import React, { useState } from 'react';
import { usePageGuard } from '@/hooks/usePageGuard';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { fnData, fnError } from '@/lib/functionResult';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Save, CheckCircle, Loader2, RefreshCw, Building2, ArrowDownToLine } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from 'date-fns';
import { toast } from "sonner";
import { localToday } from "@/utils/localDate";

export default function BankReconciliation() {
  usePageGuard({ feature: 'bank_reconciliation', adminOnly: true });
  const [user, setUser] = useState(null);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [statementDate, setStatementDate] = useState(localToday());
  const [statementBalance, setStatementBalance] = useState('');
  const [checkedTransactions, setCheckedTransactions] = useState(new Set());
  const [importingBanks, setImportingBanks] = useState(false);
  const [importingTransactions, setImportingTransactions] = useState(false);

  const queryClient = useQueryClient();

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
  });

  const myCompany = companies.find(c => c.created_by === user?.email);

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['bank-accounts', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.BankAccount.filter({ company_id: myCompany.id, is_active: true }) : [],
    enabled: !!myCompany,
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
  });

  const reconcileMutation = useMutation({
    mutationFn: async () => {
      for (const transactionId of checkedTransactions) {
        await base44.entities.Transaction.update(transactionId, {
          reconciled: true,
          reconciled_date: statementDate
        });
      }
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

  const handleImportBankAccounts = async () => {
    setImportingBanks(true);
    try {
      const envelope = await base44.functions.invoke('importQBBankAccounts', {});
      if (fnError(envelope)) {
        toast.error(`Import failed: ${fnError(envelope)}`);
        return;
      }
      // Counts live in the handler payload under .data, not on the envelope.
      const result = fnData(envelope);
      if (result?.skipped) {
        toast.error('QuickBooks is not connected. Connect it in Settings → Integrations.');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      toast.success(
        `Imported ${result.imported} new bank account${result.imported !== 1 ? 's' : ''} from QuickBooks` +
        (result.updated ? `, updated ${result.updated}` : '')
      );
    } catch (err) {
      toast.error(`Import error: ${err.message}`);
    } finally {
      setImportingBanks(false);
    }
  };

  const handleImportTransactions = async () => {
    setImportingTransactions(true);
    try {
      const envelope = await base44.functions.invoke('importQBTransactions', {});
      if (fnError(envelope)) {
        toast.error(`Import failed: ${fnError(envelope)}`);
        return;
      }
      // Counts live in the handler payload under .data, not on the envelope.
      // result.skipped is TRUE (boolean sentinel) when QB is not connected,
      // and a NUMBER (duplicate count) on a successful re-import — check strictly
      // so that a non-zero duplicate count doesn't short-circuit the success path.
      const result = fnData(envelope);
      if (result?.skipped === true) {
        toast.error('QuickBooks is not connected. Connect it in Settings → Integrations.');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      const pmtLabel = result.payments ? `${result.payments} payment${result.payments !== 1 ? 's' : ''} from last 90 days` : 'no new payments';
      toast.success(
        `Imported ${result.imported} new transaction${result.imported !== 1 ? 's' : ''} (${pmtLabel})` +
        (result.skipped ? ` — ${result.skipped} already imported` : '')
      );
    } catch (err) {
      toast.error(`Import error: ${err.message}`);
    } finally {
      setImportingTransactions(false);
    }
  };

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
    <div className="p-3 sm:p-6 space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold">Bank Reconciliation</h1>
          <p className="text-gray-500 mt-1">Match your bank statement with transactions</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleImportBankAccounts}
            disabled={importingBanks}
            className="border-green-300 text-green-700 hover:bg-green-50"
          >
            {importingBanks
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing...</>
              : <><RefreshCw className="w-4 h-4 mr-2" />Import Bank Accounts</>
            }
          </Button>
          <Button
            variant="outline"
            onClick={handleImportTransactions}
            disabled={importingTransactions}
            className="border-blue-300 text-blue-700 hover:bg-blue-50"
          >
            {importingTransactions
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing...</>
              : <><ArrowDownToLine className="w-4 h-4 mr-2" />Import Transactions</>
            }
          </Button>
        </div>
      </div>

      {bankAccounts.length === 0 && !importingBanks && (
        <div className="border-2 border-dashed border-green-200 rounded-xl p-8 text-center bg-green-50">
          <Building2 className="w-10 h-10 text-green-400 mx-auto mb-3" />
          <p className="font-medium text-green-900 mb-1">No bank accounts yet</p>
          <p className="text-sm text-green-700 mb-4">
            Connect QuickBooks in <strong>Settings → Integrations</strong>, then use the buttons above to:
            <br />1. <strong>Import Bank Accounts</strong> — pulls your QB bank accounts in
            <br />2. <strong>Import Transactions</strong> — pulls the last 90 days of QB payments
          </p>
          <div className="flex gap-2 justify-center flex-wrap">
            <Button
              variant="outline"
              onClick={handleImportBankAccounts}
              disabled={importingBanks}
              className="border-green-400 text-green-700 hover:bg-green-100"
            >
              {importingBanks
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing...</>
                : <><RefreshCw className="w-4 h-4 mr-2" />Import Bank Accounts</>
              }
            </Button>
            <Button
              variant="outline"
              onClick={handleImportTransactions}
              disabled={importingTransactions}
              className="border-blue-400 text-blue-700 hover:bg-blue-100"
            >
              {importingTransactions
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing...</>
                : <><ArrowDownToLine className="w-4 h-4 mr-2" />Import Transactions</>
              }
            </Button>
          </div>
        </div>
      )}

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
                      {acc.account_name} {acc.bank_name ? `— ${acc.bank_name}` : ''}
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
