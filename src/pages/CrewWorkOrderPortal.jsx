import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Camera, CheckCircle2, ClipboardCheck, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

const currency = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}
function toBase64(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(file); });
}

export default function CrewWorkOrderPortal() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [order, setOrder] = useState(null);
  const [files, setFiles] = useState([]);
  const [notes, setNotes] = useState("");
  const [working, setWorking] = useState(false);
  const inputRef = useRef(null);

  const load = async () => {
    if (!token) { setError("This crew link is missing its secure access code."); setLoading(false); return; }
    try { const data = await request(`/api/public/work-orders?token=${encodeURIComponent(token)}`); setOrder(data.work_order); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [token]);
  const addFiles = (event) => {
    const selected = Array.from(event.target.files || []);
    const valid = selected.filter((file) => {
      if (!file.type.startsWith("image/")) { toast.error(`${file.name} is not an image.`); return false; }
      if (file.size > 8 * 1024 * 1024) { toast.error(`${file.name} is larger than 8 MB.`); return false; }
      return true;
    }).map((file) => ({ file, preview: URL.createObjectURL(file) }));
    setFiles((current) => [...current, ...valid]);
    event.target.value = "";
  };
  const removeFile = (index) => setFiles((current) => { URL.revokeObjectURL(current[index]?.preview); return current.filter((_, fileIndex) => fileIndex !== index); });
  const accept = async () => { setWorking(true); try { await request(`/api/public/work-orders/${order.id}/accept`, { method: "POST", body: JSON.stringify({ token }) }); toast.success("Work order accepted."); await load(); } catch (err) { toast.error(err.message); } finally { setWorking(false); } };
  const submit = async () => {
    if (!files.length && !order.photos?.length) { toast.error("Add at least one completion photo."); return; }
    setWorking(true);
    try {
      for (const { file } of files) {
        await request(`/api/public/work-orders/${order.id}/photos`, { method: "POST", body: JSON.stringify({ token, photo_base64: await toBase64(file), mime_type: file.type, filename: file.name }) });
      }
      await request(`/api/public/work-orders/${order.id}/complete`, { method: "POST", body: JSON.stringify({ token, completion_notes: notes }) });
      setFiles([]);
      toast.success("Submitted for payment review.");
      await load();
    } catch (err) { toast.error(err.message); } finally { setWorking(false); }
  };

  if (loading) return <PortalShell><Loader2 className="w-10 h-10 animate-spin mx-auto text-white" /><p className="text-center text-white mt-4">Loading work order…</p></PortalShell>;
  if (error) return <PortalShell><Card><CardContent className="p-8 text-center"><X className="w-12 h-12 text-red-500 mx-auto mb-3" /><h1 className="font-bold text-xl">Link unavailable</h1><p className="text-muted-foreground mt-2">{error}</p><p className="text-xs text-muted-foreground mt-4">Ask your project manager for a new work-order link.</p></CardContent></Card></PortalShell>;
  const finished = ["completed", "approved", "paid"].includes(order.status);
  return <PortalShell>
    <div className="text-center text-white mb-6"><div className="bg-white/15 w-14 h-14 rounded-2xl grid place-items-center mx-auto mb-3"><ClipboardCheck /></div><p className="font-semibold text-lg">Crew work order</p><p className="text-white/70 text-sm">{order.project_address || order.project_title}</p></div>
    <Card className="shadow-2xl"><CardContent className="p-5 space-y-5">
      <div><div className="flex items-start justify-between gap-3"><h1 className="text-xl font-bold">{order.title}</h1><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize">{order.status}</span></div><p className="text-sm text-muted-foreground mt-1">{order.work_order_number}</p></div>
      {order.scope_of_work && <div className="rounded-xl bg-slate-50 p-3 text-sm whitespace-pre-wrap">{order.scope_of_work}</div>}
      <div className="border rounded-xl divide-y">{order.items.map((item) => <div key={item.id} className="p-3 flex justify-between gap-3 text-sm"><span>{item.description}<small className="block text-muted-foreground">{item.quantity} {item.unit}</small></span><b>{currency(item.total_cents)}</b></div>)}<div className="p-4 flex justify-between"><span className="font-semibold">Your payout</span><b className="text-lg text-emerald-700">{currency(order.payout_cents)}</b></div></div>
      {order.status === "pending" && <Button className="w-full h-12" onClick={accept} disabled={working}><CheckCircle2 className="w-5 h-5 mr-2" />Accept work order</Button>}
      {order.status === "accepted" && <div className="space-y-4"><div><p className="font-semibold">Completion photos required</p><p className="text-sm text-muted-foreground">Add clear photos of the finished work before you submit for payment.</p></div>
        {files.length > 0 && <div className="grid grid-cols-3 gap-2">{files.map((entry, index) => <div key={entry.preview} className="relative"><img src={entry.preview} alt="" className="aspect-square object-cover rounded-lg" /><button type="button" className="absolute -top-2 -right-2 rounded-full bg-slate-800 text-white w-6 h-6" onClick={() => removeFile(index)}>×</button></div>)}</div>}
        {order.photos?.length > 0 && <p className="text-sm text-emerald-700">{order.photos.length} photo{order.photos.length === 1 ? "" : "s"} already uploaded.</p>}
        <Button variant="outline" className="w-full h-12" onClick={() => inputRef.current?.click()} disabled={working}><Camera className="w-5 h-5 mr-2" />Take or add photos</Button><input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple className="hidden" onChange={addFiles} />
        <Textarea placeholder="Optional completion notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
        <Button className="w-full h-12 bg-emerald-600 hover:bg-emerald-700" onClick={submit} disabled={working}>{working ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Send className="w-5 h-5 mr-2" />}Submit for payment</Button>
      </div>}
      {finished && <div className="text-center py-4"><CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-2" /><h2 className="font-bold text-lg">{order.status === "completed" ? "Submitted for payment review" : order.status === "paid" ? "Payment marked paid" : "Work approved"}</h2><p className="text-sm text-muted-foreground mt-1">Your project manager will contact you if anything else is needed.</p></div>}
    </CardContent></Card>
  </PortalShell>;
}
function PortalShell({ children }) { return <main className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-800 p-4 flex justify-center items-center"><div className="w-full max-w-md py-6">{children}</div></main>; }