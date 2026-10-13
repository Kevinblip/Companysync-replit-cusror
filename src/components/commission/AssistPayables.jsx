import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Wrench, Plane, DollarSign, CheckCircle, Clock, AlertTriangle,
  CreditCard, Loader2, ChevronDown, ChevronRight, User,
} from 'lucide-react';
import { format, isValid } from 'date-fns';
import { toast } from "sonner";
import { localToday } from "@/utils/localDate";
import { makeInvoiceMatcher } from "@/utils/paymentOwnership";

function safeFormatDate(dateStr, fmt = 'MMM d, yyyy') {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return isValid(d) ? format(d, fmt) : '';
  } catch { return ''; }
}

export default function AssistPayables({ company, isAdmin, user, staffProfiles = [] }) {
  const queryClient = useQueryClient();
  const [selectedAssistant, setSelectedAssistant] = useState('all');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showPayDialog, setShowPayDialog] = useState(false);
  const [payMethod, setPayMethod] = useState('check');
  const [payNotes, setPayNotes] = useState('');
  const [expandedAssistant, setExpandedAssistant] = useState(null);
  const [singlePayItem, setSinglePayItem] = useState(null);

  useEffect(() => { setSelectedIds(new Set()); }, [selectedAssistant, selectedType]);

  const { data: inspectionJobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ['inspection-jobs-assists', company?.id],
    queryFn: () => company ? base44.entities.InspectionJob.filter({ company_id: company.id }) : [],
    enabled: !!company?.id,
  });

  const { data: assistPayouts = [], isLoading: payoutsLoading } = useQuery({
    queryKey: ['assist-payouts', company?.id],
    queryFn: () => company ? base44.entities.AssistPayout.filter({ company_id: company.id }) : [],
    enabled: !!company?.id,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', company?.id],
    queryFn: () => company ? base44.entities.Customer.filter({ company_id: company.id }) : [],
    enabled: !!company?.id,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['payments', company?.id],
    queryFn: () => company ? base44.entities.Payment.filter({ company_id: company.id }) : [],
    enabled: !!company?.id,
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices', company?.id],
    queryFn: () => company ? base44.entities.Invoice.filter({ company_id: company.id }) : [],
    enabled: !!company?.id,
  });

  const assistItems = useMemo(() => {
    // Invoice-id-first matcher; a duplicated invoice number is treated as
    // unresolvable rather than counted against several invoices at once.
    const matchesInv = makeInvoiceMatcher(invoices);
    const items = [];
    const paidMap = {};
    assistPayouts.forEach(p => {
      const key = `${p.inspection_job_id}-${p.assist_type}`;
      if (!paidMap[key]) paidMap[key] = { totalPaid: 0, records: [] };
      paidMap[key].totalPaid += Number(p.amount || 0);
      paidMap[key].records.push(p);
    });

    inspectionJobs.forEach(job => {
      if (!job.ladder_assist_needed && !job.drone_pilot_needed) return;

      const customerName = job.client_name || job.customer_name || job.related_customer_name || '';
      const customer = customers.find(c =>
        c.id === job.related_customer_id ||
        c.name === customerName ||
        (customerName && c.name?.toLowerCase() === customerName.toLowerCase())
      );
      const customerInvoices = customer ? invoices.filter(inv =>
        inv.customer_id === customer.id || inv.customer_name === customer.name
      ) : [];
      const customerPayments = customer ? payments.filter(p =>
        p.customer_id === customer.id || p.customer_name === customer.name ||
        customerInvoices.some(inv => matchesInv(p, inv))
      ) : [];
      const totalCustomerPaid = customerPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
      const hasCustomerPayment = totalCustomerPaid > 0;

      if (job.ladder_assist_needed) {
        const key = `${job.id}-ladder_assist`;
        const payoutInfo = paidMap[key] || { totalPaid: 0, records: [] };
        const cost = Number(job.ladder_assist_cost || 100);
        const remaining = Math.max(0, cost - payoutInfo.totalPaid);
        items.push({
          id: key,
          jobId: job.id,
          assistType: 'ladder_assist',
          assistantEmail: job.ladder_assistant_email || '',
          assistantName: job.ladder_assistant_name || job.ladder_assistant_email || 'Unknown',
          amountOwed: cost,
          amountPaid: payoutInfo.totalPaid,
          remaining,
          status: remaining <= 0 ? 'paid' : (payoutInfo.totalPaid > 0 ? 'partial' : 'pending'),
          customerName,
          address: job.property_address || job.address || '',
          salesRep: job.sales_rep_email || job.assigned_to_email || '',
          salesRepName: (() => {
            const repEmail = job.sales_rep_email || job.assigned_to_email || '';
            const profile = staffProfiles.find(s => s.user_email === repEmail);
            return profile?.full_name || repEmail || 'Unknown';
          })(),
          jobDate: job.scheduled_date || job.created_date || '',
          hasCustomerPayment,
          totalCustomerPaid,
          payoutRecords: payoutInfo.records,
        });
      }

      if (job.drone_pilot_needed) {
        const key = `${job.id}-drone_assist`;
        const payoutInfo = paidMap[key] || { totalPaid: 0, records: [] };
        const cost = Number(job.drone_pilot_cost || 150);
        const remaining = Math.max(0, cost - payoutInfo.totalPaid);
        items.push({
          id: key,
          jobId: job.id,
          assistType: 'drone_assist',
          assistantEmail: job.drone_pilot_email || '',
          assistantName: job.drone_pilot_name || job.drone_pilot_email || 'Unknown',
          amountOwed: cost,
          amountPaid: payoutInfo.totalPaid,
          remaining,
          status: remaining <= 0 ? 'paid' : (payoutInfo.totalPaid > 0 ? 'partial' : 'pending'),
          customerName,
          address: job.property_address || job.address || '',
          salesRep: job.sales_rep_email || job.assigned_to_email || '',
          salesRepName: (() => {
            const repEmail = job.sales_rep_email || job.assigned_to_email || '';
            const profile = staffProfiles.find(s => s.user_email === repEmail);
            return profile?.full_name || repEmail || 'Unknown';
          })(),
          jobDate: job.scheduled_date || job.created_date || '',
          hasCustomerPayment,
          totalCustomerPaid,
          payoutRecords: payoutInfo.records,
        });
      }
    });

    items.sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return new Date(b.jobDate) - new Date(a.jobDate);
    });
    return items;
  }, [inspectionJobs, assistPayouts, customers, payments, invoices, staffProfiles]);

  const getAssistantKey = (item) => item.assistantEmail || item.assistantName || 'unknown';

  const filteredItems = useMemo(() => {
    return assistItems.filter(item => {
      if (selectedAssistant !== 'all' && getAssistantKey(item) !== selectedAssistant) return false;
      if (selectedType !== 'all' && item.assistType !== selectedType) return false;
      return true;
    });
  }, [assistItems, selectedAssistant, selectedType]);

  const assistantList = useMemo(() => {
    const map = {};
    assistItems.forEach(item => {
      const key = getAssistantKey(item);
      if (!map[key]) {
        map[key] = { key, email: item.assistantEmail, name: item.assistantName || 'Unknown', count: 0, owed: 0 };
      }
      map[key].count++;
      map[key].owed += item.remaining;
    });
    return Object.values(map).filter(a => a.key && a.key !== 'unknown').sort((a, b) => b.owed - a.owed);
  }, [assistItems]);

  const groupedByAssistant = useMemo(() => {
    const groups = {};
    filteredItems.forEach(item => {
      const key = getAssistantKey(item);
      if (!groups[key]) groups[key] = { name: item.assistantName, email: item.assistantEmail, key, items: [], totalOwed: 0, totalPaid: 0, totalRemaining: 0 };
      groups[key].items.push(item);
      groups[key].totalOwed += item.amountOwed;
      groups[key].totalPaid += item.amountPaid;
      groups[key].totalRemaining += item.remaining;
    });
    return Object.values(groups).sort((a, b) => b.totalRemaining - a.totalRemaining);
  }, [filteredItems]);

  const totalOwed = filteredItems.reduce((s, i) => s + i.amountOwed, 0);
  const totalPaidOut = filteredItems.reduce((s, i) => s + i.amountPaid, 0);
  const totalRemaining = filteredItems.reduce((s, i) => s + i.remaining, 0);
  const pendingCount = filteredItems.filter(i => i.status === 'pending').length;
  const readyToPayCount = filteredItems.filter(i => i.status === 'pending' && i.hasCustomerPayment).length;

  const toggleSelectItem = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllPending = () => {
    const pendingIds = filteredItems.filter(i => i.remaining > 0).map(i => i.id);
    setSelectedIds(new Set(pendingIds));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const selectedTotal = filteredItems
    .filter(i => selectedIds.has(i.id))
    .reduce((s, i) => s + i.remaining, 0);

  const payoutMutation = useMutation({
    mutationFn: async ({ items, method, notes }) => {
      const results = { succeeded: [], failed: [] };
      for (const item of items) {
        if (item.remaining <= 0) continue;
        try {
          const payout = await base44.entities.AssistPayout.create({
            company_id: company.id,
            inspection_job_id: item.jobId,
            assist_type: item.assistType,
            assistant_email: item.assistantEmail,
            assistant_name: item.assistantName,
            amount: item.remaining,
            customer_name: item.customerName,
            address: item.address,
            sales_rep: item.salesRep,
            payment_method: method,
            notes: notes || '',
            paid_by: user?.email,
            paid_date: localToday(),
            status: 'paid',
          });
          results.succeeded.push(payout);
        } catch (err) {
          results.failed.push({ item, error: err.message });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ['assist-payouts'] });
      setSelectedIds(new Set());
      setSinglePayItem(null);
      setShowPayDialog(false);
      setPayNotes('');
      if (results.failed.length > 0 && results.succeeded.length > 0) {
        toast.warning(`${results.succeeded.length} paid, ${results.failed.length} failed`);
      } else if (results.failed.length > 0) {
        toast.error(`All ${results.failed.length} payouts failed`);
      } else {
        toast.success(`${results.succeeded.length} assist payment(s) recorded successfully`);
      }
    },
    onError: (err) => {
      toast.error('Failed to record payout: ' + err.message);
    },
  });

  const handlePaySelected = () => {
    if (selectedIds.size === 0) {
      toast.error('Select at least one assist to pay');
      return;
    }
    setSinglePayItem(null);
    setShowPayDialog(true);
  };

  const handlePaySingle = (item) => {
    setSinglePayItem(item);
    setShowPayDialog(true);
  };

  const confirmPay = () => {
    let itemsToPay;
    if (singlePayItem) {
      itemsToPay = [singlePayItem].filter(i => i.remaining > 0);
    } else {
      itemsToPay = filteredItems.filter(i => selectedIds.has(i.id) && i.remaining > 0);
    }
    if (itemsToPay.length === 0) {
      toast.error('No payable items found');
      return;
    }
    payoutMutation.mutate({ items: itemsToPay, method: payMethod, notes: payNotes });
  };

  const isLoading = jobsLoading || payoutsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-3 text-gray-500">Loading assist payables...</span>
      </div>
    );
  }

  if (assistItems.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-gray-500">
          <Wrench className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">No Ladder or Drone Assists Found</p>
          <p className="text-sm mt-1">When PhotoSync assignments include ladder or drone assists, they'll appear here for payout tracking.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">Assistant</Label>
              <Select value={selectedAssistant} onValueChange={setSelectedAssistant}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Assistants</SelectItem>
                  {assistantList.map(a => (
                    <SelectItem key={a.key} value={a.key}>{a.name} ({a.count})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">Type</Label>
              <Select value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="ladder_assist">Ladder Assist</SelectItem>
                  <SelectItem value="drone_assist">Drone Assist</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 font-medium">Total Assists</p>
            <p className="text-2xl font-bold text-gray-900">{filteredItems.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 font-medium">Total Owed</p>
            <p className="text-2xl font-bold text-orange-600">${totalOwed.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 font-medium">Already Paid</p>
            <p className="text-2xl font-bold text-green-600">${totalPaidOut.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 font-medium">Outstanding</p>
            <p className="text-2xl font-bold text-red-600">${totalRemaining.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 font-medium">Ready to Pay</p>
            <p className="text-2xl font-bold text-blue-600">{readyToPayCount}</p>
            <p className="text-[10px] text-gray-400">Customer paid</p>
          </CardContent>
        </Card>
      </div>

      {isAdmin && totalRemaining > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <Button size="sm" variant="outline" onClick={selectAllPending} data-testid="button-select-all-assists">
            Select All Unpaid ({filteredItems.filter(i => i.remaining > 0).length})
          </Button>
          {selectedIds.size > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={clearSelection}>
                Clear ({selectedIds.size})
              </Button>
              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={handlePaySelected} data-testid="button-pay-selected-assists">
                <CreditCard className="w-4 h-4 mr-1" />
                Pay Selected (${selectedTotal.toFixed(2)})
              </Button>
            </>
          )}
        </div>
      )}

      <div className="space-y-3">
        {groupedByAssistant.map(group => {
          const isExpanded = expandedAssistant === group.key;
          return (
            <Card key={group.key} data-testid={`assist-group-${group.key}`}>
              <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpandedAssistant(isExpanded ? null : group.key)}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                      <User className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{group.name}</CardTitle>
                      <p className="text-xs text-gray-500">{group.items.length} assist(s){group.email ? ` · ${group.email}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {group.totalRemaining > 0 ? (
                      <Badge className="bg-orange-100 text-orange-700 border-orange-300">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        Owed: ${group.totalRemaining.toFixed(2)}
                      </Badge>
                    ) : (
                      <Badge className="bg-green-100 text-green-700 border-green-300">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Paid in Full
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              {isExpanded && (
                <CardContent className="pt-0 space-y-2">
                  {group.items.map(item => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border ${
                        item.status === 'paid' ? 'bg-green-50 border-green-200' :
                        item.hasCustomerPayment ? 'bg-blue-50 border-blue-200' :
                        'bg-gray-50 border-gray-200'
                      }`}
                      data-testid={`assist-item-${item.id}`}
                    >
                      {isAdmin && item.remaining > 0 && (
                        <Checkbox
                          checked={selectedIds.has(item.id)}
                          onCheckedChange={() => toggleSelectItem(item.id)}
                          data-testid={`checkbox-assist-${item.id}`}
                        />
                      )}
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        item.assistType === 'ladder_assist' ? 'bg-orange-100' : 'bg-sky-100'
                      }`}>
                        {item.assistType === 'ladder_assist'
                          ? <Wrench className="w-4 h-4 text-orange-600" />
                          : <Plane className="w-4 h-4 text-sky-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{item.customerName || 'Unknown'}</p>
                        <p className="text-xs text-gray-500 truncate">{item.address}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {item.assistType === 'ladder_assist' ? 'Ladder' : 'Drone'}
                          </Badge>
                          {safeFormatDate(item.jobDate) && (
                            <span className="text-[10px] text-gray-400">
                              {safeFormatDate(item.jobDate)}
                            </span>
                          )}
                          {item.salesRepName && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-purple-50 text-purple-700 border-purple-200">
                              Bill to: {item.salesRepName}
                            </Badge>
                          )}
                          {item.hasCustomerPayment && item.status !== 'paid' && (
                            <Badge className="bg-blue-100 text-blue-700 text-[10px] px-1.5 py-0">
                              Customer Paid
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-sm">${item.amountOwed.toFixed(2)}</p>
                        {item.status === 'paid' ? (
                          <p className="text-xs text-green-600 font-medium flex items-center justify-end gap-1">
                            <CheckCircle className="w-3 h-3" /> Paid
                          </p>
                        ) : item.amountPaid > 0 ? (
                          <p className="text-xs text-orange-600">
                            ${item.remaining.toFixed(2)} remaining
                          </p>
                        ) : (
                          <p className="text-xs text-red-600 flex items-center justify-end gap-1">
                            <Clock className="w-3 h-3" /> Unpaid
                          </p>
                        )}
                        {isAdmin && item.remaining > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-1 h-6 text-xs px-2"
                            onClick={(e) => { e.stopPropagation(); handlePaySingle(item); }}
                            data-testid={`button-pay-${item.id}`}
                          >
                            <CreditCard className="w-3 h-3 mr-1" /> Pay
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      <Dialog open={showPayDialog} onOpenChange={setShowPayDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Assist Payout</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              {singlePayItem ? (
                <>
                  <p className="text-sm font-medium text-blue-800">
                    Pay {singlePayItem.assistantName} · ${singlePayItem.remaining.toFixed(2)}
                  </p>
                  <p className="text-xs text-blue-600 mt-1">
                    {singlePayItem.assistType === 'ladder_assist' ? 'Ladder' : 'Drone'} — {singlePayItem.customerName}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-blue-800">
                    Paying {selectedIds.size} assist(s) · Total: ${selectedTotal.toFixed(2)}
                  </p>
                  <div className="text-xs text-blue-600 mt-1 max-h-24 overflow-y-auto">
                    {filteredItems.filter(i => selectedIds.has(i.id)).map(i => (
                      <div key={i.id}>{i.assistantName} — {i.assistType === 'ladder_assist' ? 'Ladder' : 'Drone'} — {i.customerName} — ${i.remaining.toFixed(2)}</div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="zelle">Zelle</SelectItem>
                  <SelectItem value="venmo">Venmo</SelectItem>
                  <SelectItem value="direct_deposit">Direct Deposit</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea value={payNotes} onChange={e => setPayNotes(e.target.value)} placeholder="Add any notes..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayDialog(false)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={confirmPay}
              disabled={payoutMutation.isPending}
              data-testid="button-confirm-payout"
            >
              {payoutMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CreditCard className="w-4 h-4 mr-1" />}
              Confirm Payout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
