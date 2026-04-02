import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle, Loader2, AlertCircle, Zap, Building2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import useTranslation from "@/hooks/useTranslation";
import { toast } from 'sonner';

export default function AccountingSetup() {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
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

  const { data: chartOfAccounts = [], isLoading } = useQuery({
    queryKey: ['chart-of-accounts', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.ChartOfAccounts.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['bank-accounts', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.BankAccount.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const [showBankForm, setShowBankForm] = useState(false);
  const [bankForm, setBankForm] = useState({
    account_name: '',
    bank_name: '',
    routing_number: '',
    account_number: '',
    account_type: 'checking',
    opening_balance: '',
    opening_balance_date: new Date().toISOString().split('T')[0],
    chart_account_id: ''
  });

  const setupAccountsMutation = useMutation({
    mutationFn: async () => {
      return await base44.functions.invoke('setupDefaultAccounts', {
        company_id: myCompany.id
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      toast.success(t.accounting?.chartOfAccountsCreated || 'Chart of Accounts created!');
    },
    onError: (error) => {
      toast.error(`${t.common.failed || 'Failed'}: ${error.message}`);
    }
  });

  const syncDataMutation = useMutation({
    mutationFn: async () => {
      const companyId = myCompany?.id || myCompany?.company_id || companies[0]?.id;
      
      if (!companyId) {
        throw new Error('No company ID found. Please refresh the page.');
      }
      
      console.log('🚀 Calling syncCRMToAccounting with company_id:', companyId);
      
      try {
        const result = await base44.functions.invoke('syncCRMToAccounting', {
          company_id: companyId
        });
        console.log('✅ Sync result:', result);
        return result;
      } catch (error) {
        console.error('❌ Sync error:', error);
        console.error('❌ Error details:', {
          message: error.message,
          response: error.response,
          status: error.status,
          data: error.data
        });
        throw error;
      }
    },
    onSuccess: (data) => {
      console.log('✅ Success data received:', data);
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      
      const results = data?.data?.results || data?.results;
      
      if (results) {
        toast.success(`${t.common.synced || 'Synced'} ${results.payments || 0} ${t.invoices?.payments || 'payments'}, ${results.expenses || 0} ${t.accounting?.expenses || 'expenses'}, ${results.payouts || 0} ${t.sidebar?.payouts || 'payouts'}!`);
      } else {
        toast.success(t.common.syncSuccess || 'Sync completed successfully!');
        console.warn('⚠️ Unexpected data structure:', data);
      }
    },
    onError: (error) => {
      console.error('🔥 Full error object:', error);
      const errorMsg = error?.data?.error || error?.message || t.common.unknownError || 'Unknown error';
      const errorDetails = error?.data?.details || error?.data?.receivedBody || '';
      toast.error(`${t.common.failed || 'Failed'}: ${errorMsg} ${errorDetails}`);
    }
  });

  const addBankMutation = useMutation({
    mutationFn: async (data) => {
      return await base44.entities.BankAccount.create({
        ...data,
        company_id: myCompany.id,
        current_balance: parseFloat(data.opening_balance) || 0
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      toast.success(t.accounting?.bankAccountAdded || 'Bank account added!');
      setShowBankForm(false);
      setBankForm({
        account_name: '',
        bank_name: '',
        routing_number: '',
        account_number: '',
        account_type: 'checking',
        opening_balance: '',
        opening_balance_date: new Date().toISOString().split('T')[0],
        chart_account_id: ''
      });
    },
    onError: (error) => {
      toast.error(`${t.common.failed || 'Failed'}: ${error.message}`);
    }
  });

  const hasAccounts = chartOfAccounts.length > 0;
  const hasBankAccounts = bankAccounts.length > 0;
  const cashAccount = chartOfAccounts.find(a => a.account_number === '1000');

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t.accounting?.setupTitle || 'Accounting Setup'}</h1>
        <p className="text-gray-500 mt-1">{t.accounting?.setupDescription || 'Set up your accounting system and sync existing CRM data'}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {hasAccounts ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : (
                <AlertCircle className="w-5 h-5 text-orange-600" />
              )}
              {t.accounting?.chartOfAccounts || 'Chart of Accounts'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <p className="text-gray-500">{t.common.loading || 'Loading...'}</p>
            ) : hasAccounts ? (
              <Alert className="bg-green-50 border-green-300">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-900">
                  ✓ {t.accounting?.chartOfAccountsSetup || 'Chart of Accounts is set up'} ({chartOfAccounts.length} {t.accounting?.accounts || 'accounts'})
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="bg-orange-50 border-orange-300">
                <AlertCircle className="w-4 h-4 text-orange-600" />
                <AlertDescription className="text-orange-900">
                  {t.accounting?.noAccountsFound || 'No accounts found. Create default chart of accounts to get started.'}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2 text-sm text-gray-600">
              <p>✓ {t.accounting?.assetAccounts || "Asset accounts (Cash, A/R, Equipment)"}</p>
              <p>✓ {t.accounting?.liabilityAccounts || "Liability accounts (A/P, Credit Card)"}</p>
              <p>✓ {t.accounting?.equityAccounts || "Equity accounts (Owner Equity, Retained Earnings)"}</p>
              <p>✓ {t.accounting?.revenueAccounts || "Revenue accounts (Sales, Services)"}</p>
              <p>✓ {t.accounting?.cogsAccounts || "COGS accounts (Materials, Subcontractors)"}</p>
              <p>✓ {t.accounting?.expenseAccounts || "Expense accounts (Commissions, Marketing, etc.)"}</p>
            </div>

            <Button 
              onClick={() => setupAccountsMutation.mutate()}
              disabled={setupAccountsMutation.isPending || hasAccounts}
              className="w-full"
            >
              {setupAccountsMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t.common.creating || 'Creating...'}
                </>
              ) : hasAccounts ? (
                t.common.alreadySetUp || 'Already Set Up'
              ) : (
                t.accounting?.createChartOfAccounts || 'Create Chart of Accounts'
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-blue-600" />
              {t.accounting?.syncCRMData || 'Sync CRM Data'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="bg-blue-50 border-blue-300">
              <AlertDescription className="text-blue-900">
                {t.accounting?.syncCRMDescription || 'Import your existing CRM data into the accounting system.'}
              </AlertDescription>
            </Alert>

            <div className="space-y-2 text-sm text-gray-600">
              <p>✓ {t.accounting?.syncPayments || "Sync all payments → Revenue transactions"}</p>
              <p>✓ {t.accounting?.syncExpenses || "Sync all expenses → Expense transactions"}</p>
              <p>✓ {t.accounting?.syncPayouts || "Sync all payouts → COGS/Expense transactions"}</p>
              <p>✓ {t.accounting?.syncCommissions || "Sync commission payments → Commission expense"}</p>
              <p>✓ {t.accounting?.updateBalances || "Update all account balances"}</p>
            </div>

            {!hasAccounts && (
              <Alert className="bg-yellow-50 border-yellow-300">
                <AlertCircle className="w-4 h-4 text-yellow-600" />
                <AlertDescription className="text-yellow-900">
                  {t.accounting?.createAccountsFirst || 'Create Chart of Accounts first before syncing data.'}
                </AlertDescription>
              </Alert>
            )}

            <Button 
              onClick={() => syncDataMutation.mutate()}
              disabled={syncDataMutation.isPending || !hasAccounts}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {syncDataMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t.common.syncing || 'Syncing...'}
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  {t.accounting?.syncCRMData || 'Sync CRM Data'}
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {hasBankAccounts ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : (
                <AlertCircle className="w-5 h-5 text-orange-600" />
              )}
              {t.accounting?.bankAccount || 'Bank Account'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasBankAccounts ? (
              <Alert className="bg-green-50 border-green-300">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-900">
                  ✓ {bankAccounts.length} {t.accounting?.bankAccountsConfigured || 'bank account(s) configured'}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="bg-orange-50 border-orange-300">
                <AlertCircle className="w-4 h-4 text-orange-600" />
                <AlertDescription className="text-orange-900">
                  {t.accounting?.addBankAccountReconciliation || 'Add your bank account to enable reconciliation.'}
                </AlertDescription>
              </Alert>
            )}

            {showBankForm ? (
              <div className="space-y-3">
                <div>
                  <Label>{t.accounting?.accountName || 'Account Name'} *</Label>
                  <p className="text-xs text-gray-500 mb-2">{t.accounting?.accountNameDescription || "Give this account a name you'll recognize (e.g., \"Main Checking\", \"Business Savings\")"}</p>
                  <Input
                    value={bankForm.account_name}
                    onChange={(e) => setBankForm({...bankForm, account_name: e.target.value})}
                    placeholder={t.accounting?.accountNamePlaceholder || "Business Checking"}
                  />
                </div>
                <div>
                  <Label>{t.accounting?.bankName || 'Bank Name'}</Label>
                  <Input
                    value={bankForm.bank_name}
                    onChange={(e) => setBankForm({...bankForm, bank_name: e.target.value})}
                    placeholder={t.accounting?.bankNamePlaceholder || "Chase"}
                  />
                </div>
                <div>
                  <Label>{t.accounting?.last4Routing || 'Last 4 Digits - Routing Number'}</Label>
                  <p className="text-xs text-gray-500 mb-2">{t.accounting?.last4DigitsOnly || 'Only enter the last 4 digits for identification purposes'}</p>
                  <Input
                    value={bankForm.routing_number}
                    onChange={(e) => setBankForm({...bankForm, routing_number: e.target.value})}
                    placeholder="6789"
                    maxLength={4}
                  />
                </div>
                <div>
                  <Label>{t.accounting?.last4Account || 'Last 4 Digits - Account Number'}</Label>
                  <p className="text-xs text-gray-500 mb-2">{t.accounting?.last4DigitsOnly || 'Only enter the last 4 digits for identification purposes'}</p>
                  <Input
                    value={bankForm.account_number}
                    onChange={(e) => setBankForm({...bankForm, account_number: e.target.value})}
                    placeholder="4321"
                    maxLength={4}
                  />
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-xs text-blue-800">
                    <strong>🔒 {t.common.securityNote || 'Security Note'}:</strong> {t.accounting?.securityNoteDescription || 'We only store the last 4 digits for reconciliation. For automated payments, connect a payment processor (Stripe, Wise) in Settings → Integrations.'}
                  </p>
                </div>
                <div>
                  <Label>{t.accounting?.accountType || 'Account Type'} *</Label>
                  <Select
                    value={bankForm.account_type}
                    onValueChange={(value) => setBankForm({...bankForm, account_type: value})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="checking">{t.accounting?.checking || 'Checking'}</SelectItem>
                      <SelectItem value="savings">{t.accounting?.savings || 'Savings'}</SelectItem>
                      <SelectItem value="credit_card">{t.accounting?.creditCard || 'Credit Card'}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t.accounting?.openingBalance || 'Opening Balance'}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={bankForm.opening_balance}
                    onChange={(e) => setBankForm({...bankForm, opening_balance: e.target.value})}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label>{t.accounting?.openingBalanceDate || 'Opening Balance Date'}</Label>
                  <Input
                    type="date"
                    value={bankForm.opening_balance_date}
                    onChange={(e) => setBankForm({...bankForm, opening_balance_date: e.target.value})}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      if (!bankForm.account_name) {
                        toast.error(t.accounting?.accountNameRequired || 'Account name is required');
                        return;
                      }
                      addBankMutation.mutate({
                        account_name: bankForm.account_name,
                        bank_name: bankForm.bank_name,
                        account_type: bankForm.account_type,
                        opening_balance: parseFloat(bankForm.opening_balance) || 0,
                        opening_balance_date: bankForm.opening_balance_date,
                        routing_number_last4: bankForm.routing_number,
                        account_number_last4: bankForm.account_number,
                        chart_account_id: cashAccount?.id
                      });
                    }}
                    disabled={addBankMutation.isPending}
                    className="flex-1"
                  >
                    {addBankMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {t.common.adding || 'Adding...'}
                      </>
                    ) : (
                      t.accounting?.addAccount || 'Add Account'
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowBankForm(false)}
                  >
                    {t.common.cancel || 'Cancel'}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {bankAccounts.length > 0 && (
                  <div className="space-y-2 text-sm">
                    {bankAccounts.map(acc => (
                      <div key={acc.id} className="p-2 bg-gray-50 rounded">
                        <p className="font-medium">{acc.account_name}</p>
                        <p className="text-gray-600">{acc.bank_name} • {acc.account_type}</p>
                        <p className="text-xs text-gray-500">
                          {t.accounting?.account || 'Account'}: ****{acc.account_number_last4 || '****'} | {t.accounting?.routing || 'Routing'}: ****{acc.routing_number_last4 || '****'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  onClick={() => setShowBankForm(true)}
                  disabled={!hasAccounts}
                  variant={hasBankAccounts ? "outline" : "default"}
                  className="w-full"
                >
                  <Building2 className="w-4 h-4 mr-2" />
                  {hasBankAccounts ? (t.accounting?.addAnotherAccount || 'Add Another Account') : (t.accounting?.addBankAccount || 'Add Bank Account')}
                </Button>
                {!hasAccounts && (
                  <p className="text-xs text-gray-500">{t.accounting?.createAccountsFirst || 'Create Chart of Accounts first'}</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {syncDataMutation.isSuccess && syncDataMutation.data && (
        <Card className="bg-green-50 border-green-300">
          <CardHeader>
            <CardTitle className="text-green-900">{t.common.syncComplete || 'Sync Complete!'}</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const results = syncDataMutation.data?.data?.results || syncDataMutation.data?.results;
              
              if (!results) {
                return <p className="text-gray-600">{t.common.syncSuccess || 'Sync completed successfully!'}</p>;
              }
              
              return (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">{t.invoices?.payments || 'Payments'}</p>
                      <p className="text-2xl font-bold text-green-700">{results.payments || 0}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">{t.accounting?.expenses || 'Expenses'}</p>
                      <p className="text-2xl font-bold text-green-700">{results.expenses || 0}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">{t.sidebar?.payouts || 'Payouts'}</p>
                      <p className="text-2xl font-bold text-green-700">{results.payouts || 0}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">{t.sidebar?.commissionTracker || 'Commissions'}</p>
                      <p className="text-2xl font-bold text-green-700">{results.commissions || 0}</p>
                    </div>
                  </div>
                  {results.errors?.length > 0 && (
                    <Alert className="mt-4 bg-yellow-50 border-yellow-300">
                      <AlertCircle className="w-4 h-4 text-yellow-600" />
                      <AlertDescription className="text-yellow-900">
                        {results.errors.length} {t.common.errorsOccurred || 'errors occurred during sync. Check console for details.'}
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}
    </div>
  );
}