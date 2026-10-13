import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DollarSign, Edit3, Loader2, Plus, Tags } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";

const blankRate = { name: "", category: "", unit: "square", rate: "", is_active: true };
const currency = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

export default function LaborRates() {
  const { myCompany } = useRoleBasedData();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(blankRate);
  const [editingId, setEditingId] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["labor-rates", myCompany?.id],
    queryFn: () => request(`/api/labor-rates?company_id=${encodeURIComponent(myCompany.id)}`),
    enabled: Boolean(myCompany?.id),
  });
  const rates = data?.labor_rates || [];

  const saveRate = useMutation({
    mutationFn: () => request(
      editingId
        ? `/api/labor-rates/${encodeURIComponent(editingId)}?company_id=${encodeURIComponent(myCompany.id)}`
        : `/api/labor-rates?company_id=${encodeURIComponent(myCompany.id)}`,
      { method: editingId ? "PATCH" : "POST", body: JSON.stringify(draft) }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labor-rates", myCompany?.id] });
      setDraft(blankRate);
      setEditingId(null);
      toast.success(editingId ? "Labor rate updated." : "Labor rate added.");
    },
    onError: (error) => toast.error(error.message),
  });

  const grouped = useMemo(() => rates.reduce((groups, rate) => {
    const key = rate.category || "Uncategorized";
    groups[key] = [...(groups[key] || []), rate];
    return groups;
  }, {}), [rates]);

  const startEdit = (rate) => {
    setEditingId(rate.id);
    setDraft({
      name: rate.name || "",
      category: rate.category || "",
      unit: rate.unit || "",
      rate: ((Number(rate.rate_cents) || 0) / 100).toFixed(2),
      is_active: rate.is_active !== false,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!myCompany && !isLoading) {
    return <div className="p-8 text-muted-foreground">Select a company to manage labor rates.</div>;
  }

  return (
    <main className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 text-emerald-700 mb-2"><Tags className="w-5 h-5" /><span className="font-semibold text-sm">Subcontractor settings</span></div>
        <h1 className="text-3xl font-bold tracking-tight">Labor Rates</h1>
        <p className="text-muted-foreground mt-1">Set standard payouts once, then use them to build consistent work orders.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Edit labor rate" : "Add a labor rate"}</CardTitle>
          <CardDescription>Rates are stored in dollars and calculated in cents when a work order is created.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-5 items-end" onSubmit={(event) => { event.preventDefault(); saveRate.mutate(); }}>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="rate-name">Work description</Label>
              <Input id="rate-name" required value={draft.name} placeholder="Install architectural shingles" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rate-category">Category</Label>
              <Input id="rate-category" value={draft.category} placeholder="Roofing" onChange={(event) => setDraft({ ...draft, category: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rate-unit">Unit</Label>
              <Input id="rate-unit" required value={draft.unit} placeholder="square" onChange={(event) => setDraft({ ...draft, unit: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rate-amount">Rate per unit</Label>
              <div className="flex gap-2">
                <Input id="rate-amount" required type="number" min="0" step="0.01" value={draft.rate} placeholder="0.00" onChange={(event) => setDraft({ ...draft, rate: event.target.value })} />
                <Button type="submit" disabled={saveRate.isPending}>
                  {saveRate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editingId ? "Save" : <><Plus className="w-4 h-4 mr-1" />Add</>}
                </Button>
              </div>
            </div>
            <div className="md:col-span-5 flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
              <div><p className="text-sm font-medium">Available for new work orders</p><p className="text-xs text-muted-foreground">Inactive rates stay on historical work orders but cannot be selected.</p></div>
              <Switch checked={draft.is_active} onCheckedChange={(is_active) => setDraft({ ...draft, is_active })} />
            </div>
            {editingId && <Button type="button" variant="ghost" className="w-fit" onClick={() => { setEditingId(null); setDraft(blankRate); }}>Cancel edit</Button>}
          </form>
        </CardContent>
      </Card>

      {isLoading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div> : (
        <div className="space-y-5">
          {Object.keys(grouped).length === 0 && (
            <Card><CardContent className="p-10 text-center text-muted-foreground"><DollarSign className="w-9 h-9 mx-auto mb-3 opacity-40" />No labor rates yet. Add your first standard payout above.</CardContent></Card>
          )}
          {Object.entries(grouped).map(([category, categoryRates]) => (
            <section key={category}>
              <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-2">{category}</h2>
              <Card>
                <CardContent className="p-0 divide-y">
                  {categoryRates.map((rate) => (
                    <div key={rate.id} className="flex items-center justify-between gap-4 p-4">
                      <div><p className="font-medium">{rate.name}</p><p className="text-sm text-muted-foreground">{rate.is_active === false ? "Inactive" : "Active"} · per {rate.unit}</p></div>
                      <div className="flex items-center gap-3"><span className="font-semibold">{currency(rate.rate_cents)}</span><Button variant="outline" size="sm" onClick={() => startEdit(rate)}><Edit3 className="w-4 h-4 mr-1" />Edit</Button></div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}