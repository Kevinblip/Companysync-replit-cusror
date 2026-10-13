import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { CheckCircle2, X, Loader2, Send, Star, RefreshCw } from 'lucide-react';
import useCurrentCompany from "@/components/hooks/useCurrentCompany";

export default function ReviewRequests() {
  const qc = useQueryClient();
  const [user, setUser] = React.useState(null);
  React.useEffect(() => { base44.auth.me().then(setUser).catch(() => {}); }, []);

  const { company: myCompany } = useCurrentCompany(user);

  const [running, setRunning] = React.useState(false);
  const [sendingId, setSendingId] = React.useState(null);
  const [skippingId, setSkippingId] = React.useState(null);

  const skipInvoice = async (invoice) => {
    setSkippingId(invoice.id);
    try {
      await base44.entities.ReviewRequest.create({
        company_id: myCompany.id,
        invoice_id: invoice.id,
        customer_name: invoice.customer_name || 'Unknown',
        invoice_number: invoice.invoice_number || '',
        customer_email: invoice.customer_email || '',
        customer_phone: invoice.customer_phone || '',
        status: 'skipped',
      });
      qc.invalidateQueries({ queryKey: ['review-requests'] });
    } catch (e) {
      alert(`Failed to skip: ${e?.message || e}`);
    } finally {
      setSkippingId(null);
    }
  };

  const runNow = async () => {
    try {
      setRunning(true);
      const res = await base44.functions.invoke('runReviewRequestsNow', {});
      const sent = res?.data?.sent ?? res?.sent ?? 0;
      alert(`Sent ${sent} review message(s).`);
      qc.invalidateQueries({ queryKey: ['review-requests'] });
    } catch (e) {
      alert(`Failed to run: ${e?.message || e}`);
    } finally {
      setRunning(false);
    }
  };

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['review-requests', user?.email, myCompany?.id],
    queryFn: async () => {
      if (!user || !myCompany) return [];
      const staff = await base44.entities.StaffProfile.filter({ user_email: user.email });
      const isAdmin = myCompany?.created_by === user?.email || staff[0]?.is_super_admin;
      if (isAdmin) return base44.entities.ReviewRequest.filter({ company_id: myCompany.id }, '-created_date', 1000);
      return base44.entities.ReviewRequest.filter({ company_id: myCompany.id, sale_agent_email: user.email });
    },
    enabled: !!user && !!myCompany,
  });

  const { data: paidInvoices = [] } = useQuery({
    queryKey: ['paid-invoices-for-review', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      return base44.entities.Invoice.filter({ company_id: myCompany.id, status: 'paid' }, '-created_date', 500);
    },
    enabled: !!myCompany,
  });

  const invoiceIdsWithRequests = React.useMemo(() => {
    const ids = new Set();
    for (const rr of requests) {
      if (rr.invoice_id) ids.add(rr.invoice_id);
    }
    return ids;
  }, [requests]);

  const invoicesNeedingRequest = React.useMemo(() => {
    return paidInvoices.filter(inv => !invoiceIdsWithRequests.has(inv.id));
  }, [paidInvoices, invoiceIdsWithRequests]);

  const sendReviewRequest = async (invoice) => {
    setSendingId(invoice.id);
    try {
      const createRes = await base44.functions.invoke('createReviewRequestForInvoice', { invoiceId: invoice.id });
      const rrId = createRes?.data?.review_request_id ?? createRes?.review_request_id;
      if (!rrId && createRes?.data?.error) {
        alert(createRes.data.error);
        return;
      }
      if (!rrId && createRes?.data?.message) {
        alert(createRes.data.message);
        qc.invalidateQueries({ queryKey: ['review-requests'] });
        qc.invalidateQueries({ queryKey: ['paid-invoices-for-review'] });
        return;
      }
      if (rrId) {
        await base44.functions.invoke('runReviewRequestsNow', { reviewRequestId: rrId });
      }
      qc.invalidateQueries({ queryKey: ['review-requests'] });
      qc.invalidateQueries({ queryKey: ['paid-invoices-for-review'] });
    } catch (e) {
      alert(`Failed: ${e?.message || e}`);
    } finally {
      setSendingId(null);
    }
  };

  const approveMutation = useMutation({
    mutationFn: ({ id, approved }) => base44.functions.invoke('approveReviewRequest', { id, approved }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review-requests'] })
  });

  const [showApprovalDialog, setShowApprovalDialog] = React.useState(false);
  const [activePending, setActivePending] = React.useState(null);

  const pending = requests.filter(r => r.status === 'pending_approval');
  const active = requests.filter(r => r.status === 'approved');
  const done = requests.filter(r => r.status === 'completed' || r.status === 'declined' || r.status === 'cancelled' || r.status === 'skipped');

  React.useEffect(() => {
    if (pending.length > 0 && !showApprovalDialog) {
      setActivePending(pending[0]);
      setShowApprovalDialog(true);
    }
  }, [pending.length]);

  return (
    <div className="p-3 sm:p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Review Requests</h1>
          <p className="text-gray-500 text-sm">Up to 4 messages per customer, every 10 days over 30 days. SMS + Email = better results!</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={runNow} disabled={running}>
            {running ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Run Now
          </Button>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => { setActivePending(pending[0]); setShowApprovalDialog(true); }}>
            Review Pending ({pending.length})
          </Button>
        </div>
      )}

      <Alert>
        <AlertDescription>
          Make sure your Google review link is set in <strong>Settings → General</strong>. Requests won't send without it.
        </AlertDescription>
      </Alert>

      <Dialog open={showApprovalDialog} onOpenChange={setShowApprovalDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve review request</DialogTitle>
            <DialogDescription>
              {activePending ? `Review request for ${activePending.customer_name} (Invoice ${activePending.invoice_number || ''})` : 'No pending requests'}
            </DialogDescription>
          </DialogHeader>
          {activePending && (
            <div className="space-y-2 text-sm">
              <div><strong>Customer:</strong> {activePending.customer_name}</div>
              {activePending.customer_email && <div><strong>Email:</strong> {activePending.customer_email}</div>}
              {activePending.customer_phone && <div><strong>Phone:</strong> {activePending.customer_phone}</div>}
              <div><strong>Sales Rep:</strong> {activePending.sale_agent_name || activePending.sale_agent_email}</div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setShowApprovalDialog(false)}>Later</Button>
            <Button variant="outline" className="text-red-600" onClick={() => activePending && approveMutation.mutate({ id: activePending.id, approved: false }, { onSuccess: () => setShowApprovalDialog(false) })}>
              <X className="w-4 h-4 mr-1"/> Decline
            </Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={() => activePending && approveMutation.mutate({ id: activePending.id, approved: true }, { onSuccess: () => setShowApprovalDialog(false) })}>
              <CheckCircle2 className="w-4 h-4 mr-1"/> Approve & Start
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {invoicesNeedingRequest.length > 0 && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-blue-800">
              <Star className="w-5 h-5" />
              Paid Jobs — No Review Request Yet ({invoicesNeedingRequest.length})
            </CardTitle>
            <p className="text-sm text-blue-600">Hit Send to start a 30-day follow-up sequence for any completed job.</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {invoicesNeedingRequest.map(inv => (
              <div key={inv.id} className="flex items-center justify-between bg-white rounded-lg border p-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{inv.customer_name || 'Unknown Customer'}</div>
                  <div className="text-xs text-gray-500 flex gap-3">
                    {inv.invoice_number && <span>#{inv.invoice_number}</span>}
                    {inv.customer_email && <span>📧 {inv.customer_email}</span>}
                    {inv.customer_phone && <span>📱 {inv.customer_phone}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700"
                    disabled={sendingId === inv.id || skippingId === inv.id}
                    onClick={() => sendReviewRequest(inv)}
                    data-testid={`send-review-request-${inv.id}`}
                  >
                    {sendingId === inv.id
                      ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      : <Send className="w-4 h-4 mr-1" />}
                    Send
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                    disabled={skippingId === inv.id || sendingId === inv.id}
                    title="Remove from list"
                    onClick={() => skipInvoice(inv)}
                  >
                    {skippingId === inv.id
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <X className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Pending Approval ({pending.length})</CardTitle>
            {pending.length > 0 && (
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={() => { setActivePending(pending[0]); setShowApprovalDialog(true); }}>
                  Open Approval Popup
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {pending.map(rr => (
              <div key={rr.id} className="border rounded p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{rr.customer_name}</div>
                    <div className="text-xs text-gray-500">Invoice {rr.invoice_number}</div>
                  </div>
                  <Badge>Pending</Badge>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" className="bg-green-600 hover:bg-green-700" disabled={approveMutation.isPending}
                    onClick={() => approveMutation.mutate({ id: rr.id, approved: true })}>
                    {approveMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin"/> : <CheckCircle2 className="w-4 h-4 mr-1"/>}
                    Approve & Start
                  </Button>
                  <Button size="sm" variant="outline" disabled={approveMutation.isPending}
                    onClick={() => approveMutation.mutate({ id: rr.id, approved: false })}>
                    <X className="w-4 h-4 mr-1"/>
                    Decline
                  </Button>
                </div>
              </div>
            ))}
            {pending.length === 0 && <div className="text-sm text-gray-500">No pending requests</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Active — Sending ({active.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {active.map(rr => (
              <div key={rr.id} className="border rounded p-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="font-medium">{rr.customer_name}</div>
                    <div className="text-xs text-gray-500">Next: {rr.next_send_at ? new Date(rr.next_send_at).toLocaleDateString() : '—'}</div>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {rr.customer_email && <Badge variant="outline" className="text-xs">📧 Email</Badge>}
                      {rr.customer_phone && <Badge variant="outline" className="text-xs">📱 SMS</Badge>}
                    </div>
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {rr.email_delivered && <Badge className="bg-blue-100 text-blue-700 text-xs">✓ Delivered</Badge>}
                      {rr.email_opened && <Badge className="bg-green-100 text-green-700 text-xs">👁️ Opened</Badge>}
                      {rr.link_clicked && <Badge className="bg-purple-100 text-purple-700 text-xs">🔗 Clicked</Badge>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{rr.total_sent_count || 0}/4</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={async () => {
                        if (window.confirm(`Stop review request for ${rr.customer_name}?`)) {
                          await base44.entities.ReviewRequest.update(rr.id, { status: 'cancelled', next_send_at: null });
                          qc.invalidateQueries({ queryKey: ['review-requests'] });
                        }
                      }}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {active.length === 0 && <div className="text-sm text-gray-500">No active requests</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Completed / Declined ({done.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {done.map(rr => (
              <div key={rr.id} className="border rounded p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{rr.customer_name}</div>
                    <div className="text-xs text-gray-500 capitalize">{rr.status} · {rr.total_sent_count || 0} sent</div>
                  </div>
                  <CheckCircle2 className="w-4 h-4 text-gray-400"/>
                </div>
              </div>
            ))}
            {done.length === 0 && <div className="text-sm text-gray-500">Nothing here yet</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
