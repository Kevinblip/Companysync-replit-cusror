import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, CheckCircle, AlertCircle, DollarSign, CreditCard } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { localToday } from "@/utils/localDate";

export default function CommissionSummary({ invoices, staffProfiles, payouts, companyId, customerId, customerName, onPayoutCreated, customer }) {
  const [payoutDialog, setPayoutDialog] = useState(null);
  const [repPickerOpen, setRepPickerOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('check');
  const [paymentDate, setPaymentDate] = useState(localToday());

  const commissionByRep = {};

  invoices.forEach(invoice => {
    const splits = invoice.commission_splits || [];
    const totalSplitPct = splits.reduce((sum, s) => sum + (parseFloat(s.split_percentage) || 0), 0);
    const splitEmails = new Set(splits.map(s => s.user_email));

    // Process explicit commission splits
    splits.forEach(split => {
      const splitAmount = (invoice.amount_paid || 0) * (split.split_percentage / 100);
      const commissionRate = staffProfiles.find(s => s.user_email === split.user_email)?.commission_rate || 0;
      const repCommission = splitAmount * (commissionRate / 100);
      if (!commissionByRep[split.user_email]) {
        commissionByRep[split.user_email] = { name: split.user_name, owed: 0, paid: 0 };
      }
      commissionByRep[split.user_email].owed += repCommission;
    });

    // Fill unaccounted percentage with the customer's assigned rep(s) not already in splits.
    // Example: splits total 50% (co-rep) → assigned sales rep gets the remaining 50%.
    const remainingPct = 100 - totalSplitPct;
    if (remainingPct > 0.01) {
      const assignedEmails = customer?.assigned_to_users || (customer?.assigned_to ? [customer.assigned_to] : []);
      const unaccounted = assignedEmails.filter(email => !splitEmails.has(email));
      if (unaccounted.length > 0) {
        const eachPct = remainingPct / unaccounted.length;
        unaccounted.forEach(email => {
          const agentProfile = staffProfiles.find(s => s.user_email === email);
          const commissionRate = agentProfile?.commission_rate || 0;
          if (commissionRate > 0) {
            const splitAmount = (invoice.amount_paid || 0) * (eachPct / 100);
            const repCommission = splitAmount * (commissionRate / 100);
            const agentName = agentProfile?.full_name || agentProfile?.name || email;
            if (!commissionByRep[email]) {
              commissionByRep[email] = { name: agentName, owed: 0, paid: 0 };
            }
            commissionByRep[email].owed += repCommission;
          }
        });
      }
    }
  });

  (payouts || [])
    .filter(p => p.payout_type === 'commission' && p.status === 'completed')
    .forEach(payout => {
      if (commissionByRep[payout.recipient_email]) {
        commissionByRep[payout.recipient_email].paid += (payout.amount || 0);
      }
    });

  const totalOwed = Object.values(commissionByRep).reduce((sum, rep) => sum + rep.owed, 0);
  const totalPaid = Object.values(commissionByRep).reduce((sum, rep) => sum + rep.paid, 0);
  const remaining = totalOwed - totalPaid;

  const createPayoutMutation = useMutation({
    mutationFn: async () => {
      return await base44.entities.Payout.create({
        company_id: companyId,
        recipient_email: payoutDialog.email,
        recipient_name: payoutDialog.name,
        payout_type: 'commission',
        amount: parseFloat(amount),
        description: description || `Commission payout for ${customerName || 'customer'}`,
        payment_method: paymentMethod,
        customer_id: customerId || null,
        customer_name: customerName || null,
        status: 'completed',
        payment_date: paymentDate,
        fee_amount: 0,
        net_amount: parseFloat(amount),
      });
    },
    onSuccess: () => {
      toast.success(`Payout of $${parseFloat(amount).toFixed(2)} recorded for ${payoutDialog.name}`);
      setPayoutDialog(null);
      setAmount('');
      setDescription('');
      setPaymentMethod('check');
      setPaymentDate(localToday());
      if (onPayoutCreated) onPayoutCreated();
    },
    onError: (err) => {
      toast.error('Failed to record payout: ' + err.message);
    }
  });

  const openDialog = (email, data) => {
    const outstanding = data.owed - data.paid;
    setPayoutDialog({ email, name: data.name, outstanding });
    setAmount(outstanding > 0 ? outstanding.toFixed(2) : '');
    setDescription(`Commission payout for ${customerName || 'customer'}`);
    setPaymentMethod('check');
    setPaymentDate(localToday());
  };

  const handleRecordPayoutClick = () => {
    const repsWithOutstanding = Object.entries(commissionByRep).filter(([, d]) => d.owed - d.paid > 0);
    if (repsWithOutstanding.length === 0) return;
    if (repsWithOutstanding.length === 1) {
      openDialog(repsWithOutstanding[0][0], repsWithOutstanding[0][1]);
    } else {
      setRepPickerOpen(true);
    }
  };

  const repsWithOutstanding = Object.entries(commissionByRep).filter(([, d]) => d.owed - d.paid > 0);
  const hasOutstanding = repsWithOutstanding.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">Commission from this customer's invoices only</p>
        {companyId && (
          <Button
            size="sm"
            onClick={handleRecordPayoutClick}
            disabled={!hasOutstanding}
            className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
            data-testid="button-record-commission-payout"
          >
            <CreditCard className="w-4 h-4" />
            Record Payout
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="w-8 h-8" />
              <span className="text-sm opacity-80">Total Owed</span>
            </div>
            <h3 className="text-3xl font-bold">${totalOwed.toFixed(2)}</h3>
            <p className="text-xs opacity-80 mt-1">From paid invoices</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle className="w-8 h-8" />
              <span className="text-sm opacity-80">Paid Out</span>
            </div>
            <h3 className="text-3xl font-bold">${totalPaid.toFixed(2)}</h3>
            <p className="text-xs opacity-80 mt-1">Via Payouts</p>
          </CardContent>
        </Card>

        <Card className={`bg-gradient-to-br ${remaining > 0 ? 'from-orange-500 to-red-600' : 'from-gray-400 to-gray-500'} text-white`}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <AlertCircle className="w-8 h-8" />
              <span className="text-sm opacity-80">Outstanding</span>
            </div>
            <h3 className="text-3xl font-bold">${remaining.toFixed(2)}</h3>
            <p className="text-xs opacity-80 mt-1">{remaining > 0 ? 'Needs payout' : 'Fully paid'}</p>
          </CardContent>
        </Card>
      </div>

      {Object.keys(commissionByRep).length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h4 className="font-semibold mb-3 text-sm">Commission Breakdown by Rep</h4>
            <div className="space-y-2">
              {Object.entries(commissionByRep).map(([email, data]) => {
                const outstanding = data.owed - data.paid;
                const canPay = companyId && outstanding > 0;
                return (
                  <div
                    key={email}
                    className={`flex items-center justify-between p-3 bg-gray-50 rounded-lg border transition-colors ${canPay ? 'cursor-pointer hover:bg-blue-50 hover:border-blue-200 active:bg-blue-100' : ''}`}
                    onClick={() => canPay && openDialog(email, data)}
                    data-testid={`rep-commission-row-${email}`}
                  >
                    <div>
                      <div className="font-medium text-sm">{data.name}</div>
                      <div className="text-xs text-gray-500">{email}</div>
                      {canPay && (
                        <div className="text-xs text-blue-600 mt-0.5 flex items-center gap-1">
                          <DollarSign className="w-3 h-3" />
                          Tap to record payout
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right text-xs">
                        <div className="text-gray-600">Owed: <span className="font-semibold">${data.owed.toFixed(2)}</span></div>
                        <div className="text-green-600">Paid: <span className="font-semibold">${data.paid.toFixed(2)}</span></div>
                      </div>
                      <Badge variant="outline" className={outstanding > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}>
                        ${outstanding.toFixed(2)}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rep picker — shown when multiple reps have outstanding balances */}
      <Dialog open={repPickerOpen} onOpenChange={setRepPickerOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Who are you paying?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 pt-1">
            {repsWithOutstanding.map(([email, data]) => {
              const outstanding = data.owed - data.paid;
              return (
                <button
                  key={email}
                  className="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-green-50 hover:border-green-300 transition-colors text-left"
                  onClick={() => { setRepPickerOpen(false); openDialog(email, data); }}
                  data-testid={`picker-rep-${email}`}
                >
                  <div>
                    <div className="font-medium text-sm">{data.name}</div>
                    <div className="text-xs text-gray-500">{email}</div>
                  </div>
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                    ${outstanding.toFixed(2)} owed
                  </Badge>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!payoutDialog} onOpenChange={(open) => { if (!open) setPayoutDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Commission Payout</DialogTitle>
          </DialogHeader>
          {payoutDialog && (
            <div className="space-y-4">
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="font-semibold">{payoutDialog.name}</div>
                <div className="text-sm text-gray-500">{payoutDialog.email}</div>
                <div className="text-sm mt-1">
                  Outstanding: <span className="font-bold text-red-600">${payoutDialog.outstanding.toFixed(2)}</span>
                </div>
              </div>

              <div>
                <Label htmlFor="payout-amount">Amount</Label>
                <Input
                  id="payout-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-payout-amount"
                />
              </div>

              <div>
                <Label htmlFor="payout-date">Date</Label>
                <Input
                  id="payout-date"
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  data-testid="input-payout-date"
                />
              </div>

              <div>
                <Label htmlFor="payout-method">Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger id="payout-method" data-testid="select-payout-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="zelle">Zelle</SelectItem>
                    <SelectItem value="venmo">Venmo</SelectItem>
                    <SelectItem value="cashapp">Cash App</SelectItem>
                    <SelectItem value="direct_deposit">Direct Deposit</SelectItem>
                    <SelectItem value="wire_transfer">Wire Transfer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="payout-description">Note (optional)</Label>
                <Input
                  id="payout-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Commission for job at 123 Main St"
                  data-testid="input-payout-description"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setPayoutDialog(null)}
                  data-testid="button-cancel-payout"
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  onClick={() => createPayoutMutation.mutate()}
                  disabled={!amount || parseFloat(amount) <= 0 || createPayoutMutation.isPending}
                  data-testid="button-confirm-payout"
                >
                  {createPayoutMutation.isPending ? 'Saving…' : 'Record Payout'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
