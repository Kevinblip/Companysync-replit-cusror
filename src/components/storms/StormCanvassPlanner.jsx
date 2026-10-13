import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Sparkles, Users, Route } from "lucide-react";
import { createPageUrl } from "@/utils";
import { addressIdentity } from "@/lib/stormAddressUtils";

const severityScore = (storm) => {
  const hail = Number(storm?.hail_size_inches || 0);
  const wind = Number(storm?.wind_speed_mph || 0);
  return Math.min(35, Math.round(hail * 14) + (wind >= 60 ? 12 : 0) + (wind >= 75 ? 6 : 0));
};

function rankAddresses(addresses, storm, tierAssignments = {}, meshResults = []) {
  const originLat = Number(storm?.latitude || storm?.lat);
  const originLng = Number(storm?.longitude || storm?.lng);
  const unique = new Map();
  addresses.forEach((address, index) => {
    const key = addressIdentity(address) || `${address.street || ""}|${address.zip || ""}|${index}`;
    if (!unique.has(key)) unique.set(key, { ...address, sourceIndex: index });
  });
  return [...unique.values()].map((address) => {
    const tier = tierAssignments[addressIdentity(address)];
    const mesh = meshResults[address.sourceIndex];
    const lat = Number(address.lat ?? address.latitude);
    const lng = Number(address.lon ?? address.lng ?? address.longitude);
    const reasons = [];
    let score = severityScore(storm);
    if (Number(storm?.hail_size_inches || 0) >= 1) reasons.push(`${storm.hail_size_inches}" reported hail`);
    else if (Number(storm?.wind_speed_mph || 0) >= 60) reasons.push(`${storm.wind_speed_mph} mph wind report`);
    if (mesh?.confidence === "high_confidence") { score += 26; reasons.push("radar/spotter impact signal"); }
    else if (mesh?.confidence === "high_opportunity") { score += 16; reasons.push("near radar impact signal"); }
    if (tier?.n === 1) { score += 20; reasons.push("higher-value neighborhood"); }
    else if (tier?.n === 2) { score += 10; reasons.push("mid-value neighborhood"); }
    if (Number.isFinite(originLat) && Number.isFinite(originLng) && Number.isFinite(lat) && Number.isFinite(lng)) {
      const distance = Math.hypot((lat - originLat) * 69, (lng - originLng) * 52);
      score += Math.max(0, Math.round(15 - distance * 2));
      if (distance <= 3) reasons.push("close to storm report");
    }
    if (!reasons.length) reasons.push("inside selected potential-impact search area");
    return {
      ...address,
      id: address.id || `storm-address-${address.sourceIndex}`,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      priority_score: score,
      priority_reasons: reasons.slice(0, 3),
      priority_confidence: mesh?.confidence || "area_only",
      street_label: [address.street, address.city, address.state, address.zip].filter(Boolean).join(", "),
    };
  }).sort((a, b) => b.priority_score - a.priority_score);
}

export default function StormCanvassPlanner({
  storm,
  addresses,
  tierAssignments,
  meshResults,
  companyId,
  onClose,
}) {
  const [doorCount, setDoorCount] = useState(() => Math.min(50, addresses?.length || 0));
  const [selectedRepEmails, setSelectedRepEmails] = useState([]);
  const [name, setName] = useState(() => `${storm?.title || "Storm"} Canvass`);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const { data: staff = [] } = useQuery({
    queryKey: ["storm-canvass-staff", companyId],
    queryFn: () => companyId ? base44.entities.StaffProfile.filter({ company_id: companyId, is_active: true }) : [],
    enabled: !!companyId,
  });

  const ranked = useMemo(
    () => rankAddresses(addresses || [], storm, tierAssignments, meshResults),
    [addresses, storm, tierAssignments, meshResults]
  );
  const chosen = ranked.slice(0, Math.max(1, Math.min(Number(doorCount) || 1, ranked.length)));

  const toggleRep = (email) => setSelectedRepEmails((current) =>
    current.includes(email) ? current.filter((item) => item !== email) : [...current, email]
  );

  const createCampaign = async () => {
    if (!companyId || !chosen.length) return;
    if (!name.trim()) { setError("Give this campaign a name."); return; }
    if (!selectedRepEmails.length) { setError("Select at least one rep to receive doors."); return; }
    setCreating(true);
    setError("");
    try {
      const repMap = new Map(staff.map((rep) => [rep.user_email || rep.email, rep]));
      const assignedAddresses = chosen.map((address, index) => {
        const assigned_rep_email = selectedRepEmails[index % selectedRepEmails.length];
        const rep = repMap.get(assigned_rep_email);
        return {
          ...address,
          assigned_rep_email,
          assigned_rep_name: rep?.full_name || rep?.name || assigned_rep_email,
          assignment_order: Math.floor(index / selectedRepEmails.length) + 1,
          canvass_status: "assigned",
        };
      });
      const assignments = selectedRepEmails.map((email) => ({
        rep_email: email,
        rep_name: repMap.get(email)?.full_name || repMap.get(email)?.name || email,
        address_count: assignedAddresses.filter((address) => address.assigned_rep_email === email).length,
      }));
      const campaign = await base44.entities.StormCanvassCampaign.create({
        company_id: companyId,
        name: name.trim(),
        status: "ready",
        storm_id: storm?.id || null,
        storm_title: storm?.title || null,
        potential_impact_notice: "This campaign is prioritized from a storm warning/search area. It does not confirm damage at any address.",
        opportunity_method: "Storm severity, available radar/spotter context, proximity, and available property-value signals",
        address_count: assignedAddresses.length,
        selected_reps: assignments,
        addresses: assignedAddresses,
      });
      sessionStorage.setItem("stormRouteAddresses", JSON.stringify({
        title: name.trim(),
        mode: "storm_campaign",
        campaign: { id: campaign.id, name: name.trim(), storm_title: storm?.title || null, assignments },
        addresses: assignedAddresses.map((address) => ({
          ...address,
          id: address.id,
          name: address.ownerName || address.name || address.street,
          status: "new",
        })),
      }));
      window.location.assign(createPageUrl("InspectionRouting"));
    } catch (createError) {
      setError(createError?.message || "Could not create this storm campaign.");
      setCreating(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-violet-300 bg-violet-50 p-3" data-testid="storm-canvass-planner">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-violet-950 flex items-center gap-1.5"><Sparkles className="w-4 h-4" /> AI-assisted canvassing plan</p>
          <p className="text-xs text-violet-800 mt-1">Prioritizes a starting zone using available signals. A warning or search area is a potential-impact zone—not confirmed property damage.</p>
        </div>
        <button onClick={onClose} className="text-xs text-violet-600 hover:text-violet-900">Close</button>
      </div>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <div>
          <Label className="text-xs">Campaign name</Label>
          <Input value={name} onChange={(event) => setName(event.target.value)} className="h-8 mt-1 bg-white" />
        </div>
        <div>
          <Label className="text-xs">Doors to work</Label>
          <Input type="number" min="1" max={ranked.length} value={doorCount} onChange={(event) => setDoorCount(event.target.value)} className="h-8 mt-1 bg-white" />
        </div>
      </div>
      <div className="mt-3">
        <Label className="text-xs flex items-center gap-1"><Users className="w-3 h-3" /> Split doors among reps</Label>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {staff.length === 0 && <span className="text-xs text-slate-500">No active reps found yet.</span>}
          {staff.map((rep) => {
            const email = rep.user_email || rep.email;
            if (!email) return null;
            const active = selectedRepEmails.includes(email);
            return <button key={rep.id} onClick={() => toggleRep(email)} className={`text-xs px-2 py-1 rounded-full border ${active ? "bg-violet-600 text-white border-violet-700" : "bg-white text-slate-700 border-slate-300 hover:border-violet-400"}`}>{active ? "✓ " : ""}{rep.full_name || rep.name || email}</button>;
          })}
        </div>
      </div>
      <div className="mt-3 rounded-lg border border-violet-200 bg-white p-2">
        <p className="text-xs font-semibold text-slate-700">Recommended first {chosen.length} addresses</p>
        <div className="mt-1 space-y-1 max-h-28 overflow-y-auto">
          {chosen.map((address, index) => <div key={address.id} className="text-xs text-slate-600 flex gap-1.5"><span className="font-semibold text-violet-700 w-4">{index + 1}.</span><span className="min-w-0"><strong>{address.street_label}</strong> <span className="text-slate-400">— {address.priority_reasons.join(" · ")}</span></span></div>)}
        </div>
      </div>
      {error && <Alert className="mt-3 border-red-200 bg-red-50 py-2"><AlertDescription className="text-xs text-red-700">{error}</AlertDescription></Alert>}
      <div className="flex justify-end gap-2 mt-3">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={createCampaign} disabled={creating || !chosen.length} className="bg-violet-600 hover:bg-violet-700"><Route className="w-3.5 h-3.5 mr-1" />{creating ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Creating…</> : "Create plan & route"}</Button>
      </div>
    </div>
  );
}