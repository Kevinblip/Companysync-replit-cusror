import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, CheckCircle, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function CommissionSummary({ invoices, staffProfiles, payouts }) {
  // Calculate commission owed PER SALES REP based on their splits
  const commissionByRep = {};
  
  invoices.forEach(invoice => {
    if (!invoice.commission_splits || invoice.commission_splits.length === 0) return;
    
    invoice.commission_splits.forEach(split => {
      const splitAmount = (invoice.amount_paid || 0) * (split.split_percentage / 100);
      const commissionRate = staffProfiles.find(s => s.user_email === split.user_email)?.commission_rate || 0;
      const repCommission = splitAmount * (commissionRate / 100);
      
      if (!commissionByRep[split.user_email]) {
        commissionByRep[split.user_email] = {
          name: split.user_name,
          owed: 0,
          paid: 0
        };
      }
      commissionByRep[split.user_email].owed += repCommission;
    });
  });
  
  // Calculate commission paid PER SALES REP from completed payouts
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

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 mb-4">Commission from this customer's invoices only</p>
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
                return (
                  <div key={email} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
                    <div>
                      <div className="font-medium text-sm">{data.name}</div>
                      <div className="text-xs text-gray-500">{email}</div>
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
    </div>
  );
}