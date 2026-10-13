import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, AlertCircle, XCircle, HelpCircle, ChevronDown, ChevronUp, Download, Zap, Loader2 } from "lucide-react";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";

// ── Static claim definitions ───────────────────────────────────────────────
// Add new claims here. status field is the PRE-SEEDED default (overridden by DB).
const CLAIM_CATEGORIES = [
  {
    id: "inspection",
    label: "Inspection & Photo Documentation",
    claims: [
      { id: "ins-01", claim: "Photos auto-sorted wide-to-tight per slope, with section labels applied automatically" },
      { id: "ins-02", claim: "Professional inspection report generated in one tap from sorted photos" },
      { id: "ins-03", claim: "Keyword detection in scope notes blocks submission until required photo is uploaded" },
      { id: "ins-04", claim: "Evidence gates enforce zero missed required photos on every inspection" },
      { id: "ins-05", claim: "One-tap toggle switches between Insurance Claim mode and Retail mode" },
      { id: "ins-06", claim: "Retail mode removes all insurance evidence gates from the inspection flow" },
      { id: "ins-07", claim: "Production photo triggers automatically require tear-off / decking photos during install" },
      { id: "ins-08", claim: "Voice commands capture and categorize photos hands-free during inspection" },
      { id: "ins-09", claim: "AI transcribes scope notes from voice during a hands-free inspection" },
      { id: "ins-10", claim: "Hands-free mode works with Bluetooth earpiece / smart glasses" },
    ],
  },
  {
    id: "ai_photo",
    label: "AI Photo Analysis & Evidence",
    claims: [
      { id: "aip-01", claim: "AI analyzes inspection photos for hail damage evidence" },
      { id: "aip-02", claim: "AI analyzes inspection photos for wind damage evidence" },
      { id: "aip-03", claim: "Storm data (hail size, wind speed for the date/address) is automatically linked to the inspection" },
      { id: "aip-04", claim: "Brittle/granule loss test results are included in the 4-layer proof package" },
      { id: "aip-05", claim: "Adjuster portal link gives real-time read-only access to the full claims defense package" },
    ],
  },
  {
    id: "estimating",
    label: "AI Estimating & Carrier Export",
    claims: [
      { id: "est-01", claim: "AI reads inspection photos and generates a line-item estimate automatically" },
      { id: "est-02", claim: "Xactimate PDF export matches Xactimate's required line-item format exactly" },
      { id: "est-03", claim: "Symbility XML export uses the correct carrier schema (not a close approximation)", defaultStatus: "untested", flagged: true },
      { id: "est-04", claim: "Xactimate ESX file export produces a real .esx ZIP that Xactimate can import natively", defaultStatus: "broken", flagged: true, note: "Current export is plain XML with .esx extension — Xactimate rejects it. Waiting on real .esx sample to reverse-engineer schema. Interim: UI directs users to Quick Entry copy-paste path instead." },
      { id: "est-05", claim: "Symbility XML export ACV per-item equals RCV (depreciation only subtracted at Totals level)" },
      { id: "est-06", claim: "One click produces a carrier-ready PDF from an AI estimate" },
      { id: "est-07", claim: "Quick Entry Excel export (copy-paste into Xactimate Scope grid) works correctly" },
    ],
  },
  {
    id: "building_codes",
    label: "Building Code Citations",
    claims: [
      { id: "bc-01", claim: "App detects discontinued / organic shingle products on an estimate" },
      { id: "bc-02", claim: "State building code citations are automatically pulled for detected products" },
      { id: "bc-03", claim: "Reason-for-replacement proof document is generated from the code citations" },
    ],
  },
  {
    id: "crm",
    label: "CRM & Lead Management",
    claims: [
      { id: "crm-01", claim: "Visual drag-and-drop pipeline tracks leads from first contact to close" },
      { id: "crm-02", claim: "Automatic follow-up alerts fire when a lead goes cold (configurable threshold)" },
      { id: "crm-03", claim: "AI call screening captures inbound caller info and creates a lead record" },
      { id: "crm-04", claim: "Lead records include full call transcript from AI screening" },
    ],
  },
  {
    id: "operations",
    label: "Operations & Crew Management",
    claims: [
      { id: "ops-01", claim: "Job specs are pushed to subcontractor / crew in real time when a job is assigned" },
      { id: "ops-02", claim: "Crew photo check-ins are required at each job milestone" },
      { id: "ops-03", claim: "Material delivery confirmations are tracked per job" },
      { id: "ops-04", claim: "Live field map shows real-time rep locations and job status" },
      { id: "ops-05", claim: "Jobs / leads can be dispatched directly from the field operations map" },
      { id: "ops-06", claim: "Storm canvassing routes can be planned / optimized from the map" },
    ],
  },
  {
    id: "reviews",
    label: "Reviews & Reputation",
    claims: [
      { id: "rev-01", claim: "Review requests are automatically sent when a job is marked complete" },
      { id: "rev-02", claim: "Automated follow-up sequence fires if customer has not posted a review" },
      { id: "rev-03", claim: "Review links work for Google" },
      { id: "rev-04", claim: "Review links work for Facebook" },
      { id: "rev-05", claim: "Review links work for Yelp" },
    ],
  },
  {
    id: "integrations",
    label: "Platform Integrations",
    claims: [
      { id: "int-01", claim: "Twilio SMS inbound / outbound works (messages delivered, replies received)" },
      { id: "int-02", claim: "Twilio voice inbound calls route correctly to AI receptionist" },
      { id: "int-03", claim: "Google Calendar two-way sync (events created in Google appear in app and vice versa)" },
      { id: "int-04", claim: "QuickBooks sync exports invoices correctly" },
      { id: "int-05", claim: "Stripe payment links work and payments record correctly" },
      { id: "int-06", claim: "Customer share portal / proof package link shows correct photos for an inspection" },
      { id: "int-07", claim: "Download Full Package PDF from share portal generates a real PDF (not JSON)" },
    ],
  },
  {
    id: "stats",
    label: "Marketing Stats (need real data to run paid ads)",
    claims: [
      { id: "stat-01", claim: 'AD COPY: "Contractors using CompanySync report up to 3X more claims approved" — VERIFY: collect 2+ written customer quotes with before/after numbers before running paid ads', defaultStatus: "untested", flagged: true, note: 'Language qualified to "report up to" in all video scripts. Needs: 2+ customer case studies with actual supplement approval counts. Ask Kevin Stone and beta customers for documented examples.' },
      { id: "stat-02", claim: 'AD COPY: "Up to 45 min saved per estimate" — VERIFY: time 3+ real estimates before/after CompanySync (manual Xactimate entry typically takes 60-90 min per complex storm job)', defaultStatus: "untested", flagged: true, note: 'Benchmark: 60-90 min manual Xactimate → ~5-15 min with AI Estimator = 45-75 min savings on a complex job. Plausible but needs 2+ timed comparisons from real users to substantiate.' },
      { id: "stat-03", claim: '"100% photo compliance" — DEFINITIONAL: evidence gates block submission until every required photo is captured — verify the gate actually prevents bypass in all paths', defaultStatus: "partial", note: 'PARTIAL: The claim is definitional by product design (gate blocks submission). Partial because end-to-end bypass paths need confirmation (voice mode, direct API, admin override). See ins-03/ins-04 claims.' },
      { id: "stat-04", claim: 'AD COPY: "Contractors report up to 2X faster retail close" — VERIFY: collect 2+ customer quotes comparing retail close time before/after using the mode toggle', defaultStatus: "untested", flagged: true, note: 'Language qualified to "report up to" in all video scripts. Needs: 2+ customers tracking retail close rate who used the mode before/after CompanySync.' },
      { id: "stat-05", claim: 'AD COPY: "$2,400 avg decking supplement" — VERIFY: pull 5+ real completed decking supplement amounts from customer claim files; or cite a published roofing industry source', defaultStatus: "untested", flagged: true, note: 'Language qualified to "around $2,400" in video scripts. Sources to check: NRCA industry reports, RoofingContractor.com studies, or pull from 5+ actual customer supplement approvals.' },
      { id: "stat-06", claim: 'AD COPY: "$8,500 avg full-replacement win from building code argument" — VERIFY: pull 5+ real full-replacement values from customer claim files; or cite NRCA/industry source', defaultStatus: "untested", flagged: true, note: 'Language qualified to "full-replacement wins averaging around $8,500" in video scripts. Needs: 5+ real claim values from customers who used the building code citation feature.' },
      { id: "stat-07", claim: 'AD COPY: "Contractors report up to 41% avg close rate increase" — VERIFY: collect 2+ customer quotes with actual close rate numbers before/after CompanySync CRM', defaultStatus: "untested", flagged: true, note: 'Language qualified to "report up to 41% more leads closed" in video scripts. High-impact claim — FTC requires substantiation. Needs: 2+ customers with tracked close rates.' },
      { id: "stat-08", claim: 'AD COPY: "Contractors report up to 73% fewer rework callbacks" — VERIFY: collect 2+ customer quotes with actual callback counts before/after using job specs + photo check-ins', defaultStatus: "untested", flagged: true, note: 'Language qualified to "report callbacks dropping by up to 73%" in video scripts. Needs: 2+ customers with actual callback count data pre/post CompanySync.' },
      { id: "stat-09", claim: 'AD COPY: "Contractors report up to 3X faster roof inspection with hands-free voice mode" — VERIFY: time 3+ real inspections with and without voice mode', defaultStatus: "untested", flagged: true, note: 'Language qualified to "report inspecting up to three times faster" in video scripts. Needs: 2+ timed comparisons. Same-size roof, same tech skill level.' },
      { id: "stat-10", claim: 'AD COPY: "Targeting 98% first-submission approval" — VERIFY: track actual Xactimate/Symbility submission outcomes from 20+ real customer submissions', defaultStatus: "untested", flagged: true, note: 'Language changed to "targeting 98% first-submission approval" in video scripts (removes hard claim). Needs: real adjuster acceptance tracking. Ask customers to report back on re-submissions.' },
      { id: "stat-11", claim: 'AD COPY: "Targeting claim approval in 14 days" — VERIFY: track actual claim cycle time from 10+ completed customer claims; current industry avg is ~30-45 days', defaultStatus: "untested", flagged: true, note: 'Video script uses "so claims get approved in 14 days, not months" framing (aspirational). Needs: 10+ real claim cycle times. Industry benchmark: 30-45 days avg without organized docs.' },
      { id: "stat-12", claim: 'AD COPY: "Contractors report up to 28% more jobs per rep/day" — VERIFY: collect 2+ customers with jobs-per-rep dispatch metrics before/after using field ops map', defaultStatus: "untested", flagged: true, note: 'Language qualified to "report getting up to 28% more jobs" in video scripts. Needs: 2+ field ops customers with tracked dispatch efficiency data.' },
      { id: "stat-13", claim: '"$850/mo saved vs 5 separate tools" — COMPETITIVE PRICING: FollowUpBoss ~$99 + photo app ~$49 + Xactimate ~$200 + AI receptionist ~$300 + canvassing ~$50 = $698-$900/mo for equivalent stack', defaultStatus: "partial", note: 'PARTIAL: Competitive pricing math: FollowUpBoss/HubSpot $99-150 + photo doc $40-65 + Xactimate $150-200 + Ruby/Smith.ai AI receptionist $285-300 + canvassing/maps $50-100 = $624-$815/mo. $850 is the high end of a real comparable stack. Qualify as "up to $850/mo" and link to a public pricing comparison page before running paid ads.' },
    ],
  },
];

const ALL_CLAIMS = CLAIM_CATEGORIES.flatMap(c => c.claims.map(cl => ({ ...cl, categoryId: c.id, categoryLabel: c.label })));

// ── Status config ──────────────────────────────────────────────────────────
const STATUS_CYCLE = ["untested", "verified", "partial", "broken"];
const STATUS_CONFIG = {
  verified: { label: "Verified ✓",  color: "bg-green-900 text-green-300 border-green-700",  icon: CheckCircle2, dot: "bg-green-400" },
  partial:  { label: "Partial ⚠",   color: "bg-yellow-900 text-yellow-300 border-yellow-700", icon: AlertCircle,  dot: "bg-yellow-400" },
  broken:   { label: "Broken ✗",    color: "bg-red-900 text-red-300 border-red-700",          icon: XCircle,      dot: "bg-red-400" },
  untested: { label: "Untested",     color: "bg-gray-800 text-gray-400 border-gray-600",       icon: HelpCircle,   dot: "bg-gray-600" },
};

// ── Main component ─────────────────────────────────────────────────────────
export default function ClaimsAudit() {
  const [user, setUser] = useState(null);
  useEffect(() => { base44.auth.me().then(setUser).catch(() => {}); }, []);
  const { company } = useCurrentCompany(user);
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterFlagged, setFilterFlagged] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState({});
  const [draftNotes, setDraftNotes] = useState({});
  const [autoAuditing, setAutoAuditing] = useState(false);

  // ── Load saved statuses ────────────────────────────────────────────────
  const { data: savedItems = [] } = useQuery({
    queryKey: ["claims-audit", company?.id],
    queryFn: () => company ? base44.entities.ClaimsAuditItem.filter({ company_id: company.id }) : [],
    enabled: !!company?.id,
    staleTime: 30000,
  });

  // Build lookup: claim_id → saved record
  const savedMap = useMemo(() => {
    const m = {};
    for (const r of savedItems) if (r.data?.claim_id) m[r.data.claim_id] = r;
    return m;
  }, [savedItems]);

  // Merge static definitions with saved data
  const claims = useMemo(() => ALL_CLAIMS.map(cl => {
    const saved = savedMap[cl.id];
    return {
      ...cl,
      status: saved?.data?.status ?? cl.defaultStatus ?? "untested",
      notes:  saved?.data?.notes  ?? cl.note ?? "",
      recordId: saved?.id,
    };
  }), [savedMap]);

  // ── Mutation: upsert a claim's status/notes ────────────────────────────
  const upsert = useMutation({
    mutationFn: async ({ claimId, status, notes }) => {
      const existing = savedMap[claimId];
      const payload  = { data: { claim_id: claimId, status, notes, updated_at: new Date().toISOString() } };
      if (existing) {
        return base44.entities.ClaimsAuditItem.update(existing.id, payload);
      }
      return base44.entities.ClaimsAuditItem.create({ ...payload, company_id: company.id });
    },
    onSuccess: () => qc.invalidateQueries(["claims-audit", company?.id]),
  });

  const cycleStatus = useCallback((claim) => {
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(claim.status) + 1) % STATUS_CYCLE.length];
    upsert.mutate({ claimId: claim.id, status: next, notes: claim.notes });
  }, [upsert]);

  const saveNote = useCallback((claim) => {
    upsert.mutate({ claimId: claim.id, status: claim.status, notes: draftNotes[claim.id] ?? claim.notes });
    setExpandedNotes(p => ({ ...p, [claim.id]: false }));
  }, [upsert, draftNotes]);

  // ── Auto-audit: call function → bulk-save all verdicts ────────────────
  const runAutoAudit = useCallback(async () => {
    if (!company?.id) return;
    setAutoAuditing(true);
    try {
      const result = await base44.functions.invoke('runClaimsAutoAudit', { company_id: company.id });
      const verdicts = result?.data?.verdicts ?? [];
      // Save each verdict that doesn't already have a user-set status,
      // OR overwrite everything (fresh auto-audit). We overwrite all — the user
      // can always click a badge to correct any that are wrong.
      await Promise.all(verdicts.map(v => {
        const existing = savedMap[v.claim_id];
        const payload = { data: { claim_id: v.claim_id, status: v.status, notes: v.note, updated_at: new Date().toISOString() } };
        if (existing) return base44.entities.ClaimsAuditItem.update(existing.id, payload);
        return base44.entities.ClaimsAuditItem.create({ ...payload, company_id: company.id });
      }));
      qc.invalidateQueries(["claims-audit", company.id]);
    } catch (e) {
      console.error('Auto-audit failed:', e);
    }
    setAutoAuditing(false);
  }, [company, savedMap, qc]);

  // ── Filtered view ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return claims.filter(cl => {
      if (filterStatus !== "all" && cl.status !== filterStatus) return false;
      if (filterFlagged && !cl.flagged) return false;
      return true;
    });
  }, [claims, filterStatus, filterFlagged]);

  // ── Summary counts ─────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { verified: 0, partial: 0, broken: 0, untested: 0 };
    for (const cl of claims) c[cl.status]++;
    return c;
  }, [claims]);

  const total = claims.length;
  const pct = Math.round((counts.verified / total) * 100);

  // ── CSV export ─────────────────────────────────────────────────────────
  function exportCSV() {
    const rows = [["Category", "Claim ID", "Claim", "Status", "Notes", "Flagged"]];
    for (const cl of claims) {
      rows.push([cl.categoryLabel, cl.id, `"${cl.claim.replace(/"/g, '""')}"`, cl.status, `"${(cl.notes || "").replace(/"/g, '""')}"`, cl.flagged ? "YES" : ""]);
    }
    const csv  = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a    = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `claims-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  // ── Group filtered claims by category ─────────────────────────────────
  const grouped = useMemo(() => {
    const map = {};
    for (const cl of filtered) {
      if (!map[cl.categoryId]) map[cl.categoryId] = { label: cl.categoryLabel, items: [] };
      map[cl.categoryId].items.push(cl);
    }
    return Object.values(map);
  }, [filtered]);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight mb-1">Claims Audit</h1>
            <p className="text-gray-400 text-sm">Verify every marketing and feature claim against the live app before running paid ads.</p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={runAutoAudit}
              disabled={autoAuditing || !company?.id}
              className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold"
            >
              {autoAuditing ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Verifying…</> : <><Zap className="w-3.5 h-3.5 mr-1" /> Auto-Verify All</>}
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV} className="border-gray-600 text-gray-300 hover:bg-gray-800">
              <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
            </Button>
          </div>
        </div>

        {/* Summary bar */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <div className="sm:col-span-1 bg-gray-900 rounded-lg p-3 border border-gray-700">
            <div className="text-3xl font-black text-white">{pct}%</div>
            <div className="text-xs text-gray-400 mt-0.5">claims verified</div>
          </div>
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setFilterStatus(filterStatus === key ? "all" : key)}
              className={`bg-gray-900 rounded-lg p-3 border text-left transition-all ${filterStatus === key ? "border-white" : "border-gray-700 hover:border-gray-500"}`}
            >
              <div className={`text-2xl font-black ${key === "verified" ? "text-green-400" : key === "partial" ? "text-yellow-400" : key === "broken" ? "text-red-400" : "text-gray-400"}`}>
                {counts[key]}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">{cfg.label}</div>
            </button>
          ))}
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <button
            onClick={() => setFilterStatus("all")}
            className={`text-xs px-3 py-1.5 rounded-full border transition-all ${filterStatus === "all" ? "bg-white text-black border-white" : "border-gray-600 text-gray-400 hover:border-gray-400"}`}
          >
            All ({total})
          </button>
          <button
            onClick={() => setFilterFlagged(p => !p)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-all ${filterFlagged ? "bg-yellow-500 text-black border-yellow-500" : "border-gray-600 text-gray-400 hover:border-gray-400"}`}
          >
            ⚠ Flagged only ({claims.filter(c => c.flagged).length})
          </button>
          <span className="text-gray-600 text-xs ml-auto">Click a status badge to cycle it</span>
        </div>

        {/* Claim groups */}
        {grouped.map(group => (
          <div key={group.label} className="mb-8">
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 px-1">{group.label}</h2>
            <div className="border border-gray-800 rounded-xl overflow-hidden">
              {group.items.map((cl, i) => {
                const sCfg = STATUS_CONFIG[cl.status];
                const Icon = sCfg.icon;
                const isExpanded = expandedNotes[cl.id];
                const draft = draftNotes[cl.id] ?? cl.notes;

                return (
                  <div key={cl.id} className={`${i > 0 ? "border-t border-gray-800" : ""} bg-gray-900`}>
                    <div className="flex items-start gap-3 px-4 py-3">
                      {/* Status badge — click to cycle */}
                      <button
                        onClick={() => cycleStatus(cl)}
                        className={`shrink-0 flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border transition-all hover:opacity-80 mt-0.5 ${sCfg.color}`}
                        title="Click to change status"
                      >
                        <Icon className="w-3 h-3" />
                        <span className="hidden sm:inline">{sCfg.label}</span>
                      </button>

                      {/* Claim text */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm leading-snug ${cl.flagged ? "text-yellow-100" : "text-gray-200"}`}>
                          {cl.flagged && <span className="text-yellow-500 mr-1">⚠</span>}
                          {cl.claim}
                        </p>
                        {cl.notes && !isExpanded && (
                          <p className="text-xs text-gray-500 mt-1 italic">{cl.notes.slice(0, 120)}{cl.notes.length > 120 ? "…" : ""}</p>
                        )}
                        {isExpanded && (
                          <div className="mt-2 space-y-2">
                            <Textarea
                              value={draft}
                              onChange={e => setDraftNotes(p => ({ ...p, [cl.id]: e.target.value }))}
                              placeholder="Add notes, links to tickets, or verification steps…"
                              className="bg-gray-800 border-gray-700 text-gray-200 text-xs resize-none h-20"
                            />
                            <div className="flex gap-2">
                              <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700" onClick={() => saveNote(cl)}>Save</Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-400" onClick={() => {
                                setExpandedNotes(p => ({ ...p, [cl.id]: false }));
                                setDraftNotes(p => { const n = { ...p }; delete n[cl.id]; return n; });
                              }}>Cancel</Button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Notes toggle */}
                      <button
                        onClick={() => {
                          setExpandedNotes(p => ({ ...p, [cl.id]: !isExpanded }));
                          if (!isExpanded) setDraftNotes(p => ({ ...p, [cl.id]: cl.notes }));
                        }}
                        className="shrink-0 text-gray-600 hover:text-gray-300 mt-0.5"
                        title={isExpanded ? "Collapse notes" : "Add / edit notes"}
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-20 text-gray-600">No claims match the current filter.</div>
        )}

        <p className="text-center text-xs text-gray-700 mt-8 pb-4">
          Status is saved per company. Export CSV to share with the team or document for ad compliance.
        </p>
      </div>
    </div>
  );
}
