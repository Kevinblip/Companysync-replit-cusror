import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, Copy, Loader2, Mail, MessageSquare, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { base44 } from "@/api/base44Client";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";

const statuses = ["pending", "accepted", "completed", "approved", "paid"];
const currency = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);
const titleStatus = (status) => status.charAt(0).toUpperCase() + status.slice(1);
const freshDraft = () => ({ project_id: "", subcontractor_id: "", title: "", scope_of_work: "", items: [{ labor_rate_id: "", quantity: "1", description: "" }] });

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

function StatusBadge({ status }) {
  const classes = { pending: "bg-slate-100 text-slate-700", accepted: "bg-blue-100 text-blue-700", completed: "bg-amber-100 text-amber-800", approved: "bg-emerald-100 text-emerald-700", paid: "bg-violet-100 text-violet-700" };
  return <Badge className={classes[status] || ""}>{titleStatus(status)}</Badge>;
}

export default function SubcontractorWorkOrders() {
  const { myCompany } = useRoleBasedData();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState(freshDraft);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const cid = myCompany?.id;

  const { data: ordersData, isLoading } = useQuery({
    queryKey: ["subcontractor-work-orders", cid, statusFilter],
    queryFn: () => request(`/api/work-orders?company_id=${encodeURIComponent(cid)}${statusFilter === "all" ? "" : `&status=${statusFilter}`}`),
    enabled: Boolean(cid),
  });
  const { data: ratesData } = useQuery({
    queryKey: ["labor-rates", cid],
    queryFn: () => request(`/api/labor-rates?company_id=${encodeURIComponent(cid)}`),
    enabled: Boolean(cid),
  });
  const { data: selectedSubcontractorRates } = useQuery({
    queryKey: ["work-order-subcontractor-rates", cid, draft.subcontractor_id],
    queryFn: () => request(`/api/subcontractors/${encodeURIComponent(draft.subcontractor_id)}/rates?company_id=${encodeURIComponent(cid)}`),
    enabled: Boolean(cid && draft.subcontractor_id),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["work-order-projects", cid],
    queryFn: () => base44.entities.Project.filter({ company_id: cid }, "-created_date", 500),
    enabled: Boolean(cid),
  });
  const { data: subcontractors = [] } = useQuery({
    queryKey: ["work-order-subcontractors", cid],
    queryFn: () => base44.entities.Subcontractor.filter({ company_id: cid, is_active: true }, "-created_date", 500),
    enabled: Boolean(cid),
  });
  const orders = ordersData?.work_orders || [];
  const rates = ratesData?.labor_rates?.filter((rate) => rate.is_active !== false) || [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["subcontractor-work-orders", cid] });
  const createOrder = useMutation({
    mutationFn: () => request(`/api/work-orders/generate?company_id=${encodeURIComponent(cid)}`, { method: "POST", body: JSON.stringify(draft) }),
    onSuccess: (result) => {
      invalidate();
      setShowCreate(false);
      setDraft(freshDraft());
      copyCrewLink(result.crew_portal_path);
      toast.success("Work order created. The crew link was copied.");
    },
    onError: (error) => toast.error(error.message),
  });
  const transition = useMutation({
    mutationFn: ({ id, action }) => request(`/api/work-orders/${encodeURIComponent(id)}/${action}?company_id=${encodeURIComponent(cid)}`, { method: "POST" }),
    onSuccess: () => { invalidate(); setSelectedOrder(null); toast.success("Work-order status updated."); },
    onError: (error) => toast.error(error.message),
  });

  const summary = useMemo(() => statuses.reduce((acc, status) => ({ ...acc, [status]: orders.filter((order) => order.status === status).length }), {}), [orders]);
  const updateItem = (index, patch) => setDraft({ ...draft, items: draft.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  const copyCrewLink = async (path) => {
    try { await navigator.clipboard.writeText(`${window.location.origin}${path}`); } catch { /* manual link remains available in details */ }
  };
  const selectedRate = (id) => selectedSubcontractorRates?.labor_rates?.find((rate) => rate.id === id) || rates.find((rate) => rate.id === id);
  const effectiveRateCents = (rate) => rate?.custom_rate === null || rate?.custom_rate === undefined
    ? Number(rate?.rate_cents) || 0
    : Math.round(Number(rate.custom_rate) * 100);
  const draftPayout = draft.items.reduce((total, item) => {
    const rate = selectedRate(item.labor_rate_id);
    return total + ((Number(item.quantity) || 0) * (effectiveRateCents(rate) / 100));
  }, 0);

  return (
    <main className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div><div className="flex gap-2 items-center text-emerald-700 mb-2"><ClipboardList className="w-5 h-5" /><span className="font-semibold text-sm">Subcontractor approval dashboard</span></div><h1 className="text-3xl font-bold">Work Orders</h1><p className="text-muted-foreground mt-1">Generate measured labor payouts, collect completion photos, then approve payment.</p></div>
        <Button onClick={() => setShowCreate(true)} disabled={!cid}><Plus className="w-4 h-4 mr-2" />New work order</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {statuses.map((status) => <Card key={status} className="cursor-pointer hover:border-primary/50" onClick={() => setStatusFilter(status)}><CardContent className="p-4"><p className="text-sm text-muted-foreground">{titleStatus(status)}</p><p className="text-2xl font-bold">{summary[status] || 0}</p></CardContent></Card>)}
      </div>

      <div className="flex items-center gap-3"><Label>Status</Label><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{statuses.map((status) => <SelectItem key={status} value={status}>{titleStatus(status)}</SelectItem>)}</SelectContent></Select></div>

      <Card>
        <CardContent className="p-0 divide-y">
          {isLoading && <div className="p-12 flex justify-center"><Loader2 className="animate-spin" /></div>}
          {!isLoading && orders.length === 0 && <div className="p-12 text-center text-muted-foreground">No work orders match this filter.</div>}
          {orders.map((order) => <button type="button" onClick={() => setSelectedOrder(order)} key={order.id} className="w-full text-left p-4 hover:bg-muted/50 transition flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
            <div><div className="flex items-center gap-2"><p className="font-semibold">{order.title}</p><StatusBadge status={order.status} /></div><p className="text-sm text-muted-foreground">{order.subcontractor_name || "Subcontractor"} · {order.project_title || "Project"}{order.photo_count ? ` · ${order.photo_count} photo${order.photo_count === 1 ? "" : "s"}` : ""}</p></div>
            <div className="font-bold">{currency(order.payout_cents)}</div>
          </button>)}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create work order</DialogTitle><DialogDescription>Select the measured labor lines. The payout is locked using this subcontractor’s custom rates when saved, otherwise the standard rates.</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); createOrder.mutate(); }}>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Project</Label><Select value={draft.project_id} onValueChange={(project_id) => setDraft({ ...draft, project_id })}><SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.title || project.address || project.id}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Subcontractor</Label><Select value={draft.subcontractor_id} onValueChange={(subcontractor_id) => setDraft({ ...draft, subcontractor_id })}><SelectTrigger><SelectValue placeholder="Select subcontractor" /></SelectTrigger><SelectContent>{subcontractors.map((subcontractor) => <SelectItem key={subcontractor.id} value={subcontractor.id}>{subcontractor.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Work-order title (optional)</Label><Input value={draft.title} placeholder="Defaults to project title" onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></div>
              <div className="space-y-2"><Label>Scope of work</Label><Textarea value={draft.scope_of_work} placeholder="Crew instructions and expectations" onChange={(event) => setDraft({ ...draft, scope_of_work: event.target.value })} /></div>
            </div>
            <div className="space-y-3"><div className="flex justify-between items-center"><Label>Measured labor lines</Label><Button type="button" variant="outline" size="sm" onClick={() => setDraft({ ...draft, items: [...draft.items, { labor_rate_id: "", quantity: "1", description: "" }] })}><Plus className="w-4 h-4 mr-1" />Add line</Button></div>
              {draft.items.map((item, index) => <div className="grid grid-cols-1 md:grid-cols-[1fr_110px_1fr_auto] gap-2 p-3 border rounded-lg" key={index}>
                <Select value={item.labor_rate_id} onValueChange={(labor_rate_id) => updateItem(index, { labor_rate_id })}><SelectTrigger><SelectValue placeholder="Labor rate" /></SelectTrigger><SelectContent>{rates.map((rate) => { const resolved = selectedRate(rate.id); const custom = resolved?.custom_rate !== null && resolved?.custom_rate !== undefined; return <SelectItem key={rate.id} value={rate.id}>{rate.name} · {currency(effectiveRateCents(resolved || rate))}/{rate.unit}{custom ? " (custom)" : ""}</SelectItem>; })}</SelectContent></Select>
                <Input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => updateItem(index, { quantity: event.target.value })} />
                <Input value={item.description} placeholder="Optional line note" onChange={(event) => updateItem(index, { description: event.target.value })} />
                <Button type="button" variant="ghost" disabled={draft.items.length === 1} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, itemIndex) => itemIndex !== index) })}>Remove</Button>
              </div>)}
            </div>
            <div className="flex justify-between items-center rounded-lg bg-emerald-50 p-4"><span className="font-medium">Estimated payout</span><span className="text-xl font-bold text-emerald-800">{currency(Math.round(draftPayout * 100))}</span></div>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button type="submit" disabled={createOrder.isPending}>{createOrder.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Create & copy crew link</Button></div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedOrder)} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          {selectedOrder && <OrderDetails orderId={selectedOrder.id} companyId={cid} onApprove={() => transition.mutate({ id: selectedOrder.id, action: "approve" })} onPaid={() => transition.mutate({ id: selectedOrder.id, action: "paid" })} onCopy={copyCrewLink} busy={transition.isPending} />}
        </DialogContent>
      </Dialog>
    </main>
  );
}

function OrderDetails({ orderId, companyId, onApprove, onPaid, onCopy, busy }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["work-order-detail", orderId], queryFn: () => request(`/api/work-orders/${encodeURIComponent(orderId)}?company_id=${encodeURIComponent(companyId)}`) });
  const sendInvite = useMutation({
    mutationFn: (method) => request(`/api/work-orders/${encodeURIComponent(orderId)}/send?company_id=${encodeURIComponent(companyId)}`, { method: "POST", body: JSON.stringify({ method }) }),
    onSuccess: (result, method) => {
      queryClient.invalidateQueries({ queryKey: ["work-order-detail", orderId] });
      queryClient.invalidateQueries({ queryKey: ["subcontractor-work-orders", companyId] });
      if (result.invite_delivery_status === "sending") toast.warning(result.warning || "Delivery confirmation is pending. Check provider logs before resending.");
      else toast.success(`Work-order link sent by ${method === "sms" ? "SMS" : "email"}.`);
    },
    onError: (error) => toast.error(error.message),
  });
  const order = data?.work_order;
  if (isLoading || !order) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin" /></div>;
  const path = `/crew-portal?token=${encodeURIComponent(order.access_token)}`;
  return <>
    <DialogHeader><div className="flex gap-2 items-center"><DialogTitle>{order.title}</DialogTitle><StatusBadge status={order.status} /></div><DialogDescription>{order.work_order_number} · {order.project_title} · {order.subcontractor_name}</DialogDescription></DialogHeader>
    <div className="space-y-4 py-3">
      {order.scope_of_work && <p className="text-sm whitespace-pre-wrap">{order.scope_of_work}</p>}
      <div className="rounded-lg bg-muted p-3 flex justify-between"><span>Locked subcontractor payout</span><b>{currency(order.payout_cents)}</b></div>
      <div className="divide-y border rounded-lg">{order.items.map((item) => <div key={item.id} className="p-3 flex justify-between text-sm"><span>{item.description} · {item.quantity} {item.unit}</span><b>{currency(item.total_cents)}</b></div>)}</div>
      <div><h3 className="font-medium mb-2">Completion photos ({order.photos.length})</h3>{order.photos.length ? <div className="grid grid-cols-3 gap-2">{order.photos.map((photo) => <a key={photo.id} target="_blank" rel="noreferrer" href={photo.file_url}><img className="aspect-square object-cover rounded-lg border" src={photo.file_url} alt="Completion" /></a>)}</div> : <p className="text-sm text-muted-foreground">No photos submitted yet.</p>}</div>
      {order.completion_notes && <div><h3 className="font-medium">Crew notes</h3><p className="text-sm text-muted-foreground whitespace-pre-wrap">{order.completion_notes}</p></div>}
       {order.invite_delivery_status && <div className={`rounded-lg border p-3 text-sm ${order.invite_delivery_status === "sent" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : order.invite_delivery_status === "failed" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
         <b>{order.invite_delivery_status === "sent" ? "Invite sent" : order.invite_delivery_status === "failed" ? "Invite delivery failed" : "Invite delivery confirmation pending"}</b>
         <span> · {order.invite_delivery_method === "sms" ? "SMS" : "Email"}{order.invite_delivery_status === "sent" && order.invite_delivered_at ? ` · ${new Date(order.invite_delivered_at).toLocaleString()}` : ""}</span>
         {order.invite_delivery_error && <p className="mt-1">{order.invite_delivery_error}</p>}
       </div>}
    </div>
    <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => onCopy(path)}><Copy className="w-4 h-4 mr-1" />Copy crew link</Button><Button variant="outline" onClick={() => sendInvite.mutate("sms")} disabled={sendInvite.isPending || order.invite_delivery_status === "sending"}><MessageSquare className="w-4 h-4 mr-1" />Text crew</Button><Button variant="outline" onClick={() => sendInvite.mutate("email")} disabled={sendInvite.isPending || order.invite_delivery_status === "sending"}><Mail className="w-4 h-4 mr-1" />Email crew</Button>{order.status === "completed" && <Button onClick={onApprove} disabled={busy}><CheckCircle2 className="w-4 h-4 mr-1" />Approve</Button>}{order.status === "approved" && <Button onClick={onPaid} disabled={busy}><Wallet className="w-4 h-4 mr-1" />Mark paid</Button>}</div>
  </>;
}