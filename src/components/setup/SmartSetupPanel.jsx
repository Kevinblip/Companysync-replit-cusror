import { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sparkles, Loader2, CheckCircle2, AlertTriangle, RefreshCw, Trash2,
  Globe, Clock, Users, MapPin, HardHat, BookOpen, Upload, ChevronDown, ChevronUp
} from "lucide-react";
import { SUB_SPECIALTIES, parseSubcontractorCsv } from "@/utils/subcontractorCsv";

// Bundle the pdf.js worker via Vite so it serves same-origin (CDN workers get
// blocked on some networks — same pattern as LexiWorkspace).
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

async function extractPdfTextFromFile(file) {
  const pdfjsLib = await import("pdfjs-dist");
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }
  const buffer = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageTexts = [];
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const content = await page.getTextContent({ includeMarkedContent: false });
    const rows = new Map();
    for (const it of content.items) {
      if (typeof it.str !== "string" || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], s: it.str });
    }
    const lines = [...rows.keys()].sort((a, b) => b - a).map(y =>
      rows.get(y).sort((a, b) => a.x - b.x).map(pt => pt.s).join(" ").trim()
    ).filter(Boolean);
    pageTexts.push(lines.join("\n"));
  }
  return pageTexts.join("\n\n");
}

const KB_CATEGORIES = ["services", "pricing", "policies", "faq", "processes", "products", "team", "general"];
const WORK_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const POSITIONS = ["Owner", "Manager", "Office Admin", "Sales Rep", "Crew Lead", "Crew"];

function lowConf(c) { return typeof c === "number" && c < 0.6; }
function confClass(c) { return lowConf(c) ? "bg-amber-50 border-amber-300" : ""; }

async function invokeParse(payload) {
  const res = await base44.functions.invoke("smartSetupParse", payload);
  const err = res?.error || res?.data?.error;
  if (err) throw new Error(typeof err === "string" ? err : (err.message || "AI could not process that. Please try again."));
  if (!res?.data?.parsed) throw new Error("AI returned no usable data. Please try again or fill this section manually.");
  return res.data;
}

const SECTION_META = {
  company: { icon: Globe, title: "Company Info", loading: "AI is reading your company details…" },
  hours: { icon: Clock, title: "Business Hours", loading: "AI is working out your hours…" },
  staff: { icon: Users, title: "Your Team", loading: "AI is organizing your team…" },
  service_areas: { icon: MapPin, title: "Service Area (Storm Alerts)", loading: "AI is mapping your service area…" },
  subcontractors: { icon: HardHat, title: "Subcontractors", loading: "AI is sorting your subcontractor list…" },
  knowledge: { icon: BookOpen, title: "Knowledge for Lexi & Alex", loading: "AI is building knowledge articles…" },
};

function SectionShell({ name, children, right, sectionState, warnings = [] }) {
  const meta = SECTION_META[name];
  const Icon = meta.icon;
  const st = sectionState || {};
  return (
    <Card className="border-gray-200" data-testid={`section-smart-${name}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2 text-gray-800">
            <Icon className="w-4 h-4 text-blue-600" /> {meta.title}
          </h3>
          {right}
        </div>
        {st.status === "parsing" && (
          <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-md p-2" data-testid={`loading-smart-${name}`}>
            <Loader2 className="w-4 h-4 animate-spin" /> {meta.loading}
          </div>
        )}
        {st.error && (
          <Alert className="bg-red-50 border-red-200" data-testid={`error-smart-${name}`}>
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800 flex items-center justify-between gap-2 w-full">
              <span>{st.error}</span>
            </AlertDescription>
          </Alert>
        )}
        {warnings.map((warning, index) => (
          <p key={index} className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {warning}</p>
        ))}
        {children}
      </CardContent>
    </Card>
  );
}

function ParseButton({ sectionState, onClick, disabled, label, retry, testId }) {
  const st = sectionState || {};
  return (
    <Button
      size="sm"
      onClick={onClick}
      disabled={disabled || st.status === "parsing"}
      className="bg-purple-600 hover:bg-purple-700"
      data-testid={testId}
    >
      {st.status === "parsing" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : (st.error && retry ? <RefreshCw className="w-4 h-4 mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />)}
      {st.error && retry ? "Retry" : label}
    </Button>
  );
}

export default function SmartSetupPanel({ user, myCompany, assistantSettings = [], onApplied }) {
  const queryClient = useQueryClient();
  const websiteDraftKey = myCompany?.id ? `smart_setup_website_draft:${myCompany.id}` : null;
  const websiteCompanyIdRef = useRef(myCompany?.id);

  // Intake
  const [websiteUrl, setWebsiteUrl] = useState(() => {
    if (typeof window !== "undefined" && myCompany?.id) {
      return sessionStorage.getItem(`smart_setup_website_draft:${myCompany.id}`) ?? myCompany.website ?? "";
    }
    return myCompany?.website || "";
  });
  const [aboutText, setAboutText] = useState("");
  const [hoursText, setHoursText] = useState("");
  const [rosterText, setRosterText] = useState("");
  const [areasText, setAreasText] = useState("");
  const [subsText, setSubsText] = useState("");
  const [docBusy, setDocBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);

  // Per-section: { status: 'idle'|'parsing'|'error', error }
  const [sec, setSec] = useState({});
  const setSection = (name, patch) => setSec(prev => ({ ...prev, [name]: { ...(prev[name] || {}), ...patch } }));

  // Parsed + editable review data
  const [companyDraft, setCompanyDraft] = useState(null);      // object
  const [hoursDraft, setHoursDraft] = useState(null);          // object
  const [staffDraft, setStaffDraft] = useState([]);            // rows
  const [areasDraft, setAreasDraft] = useState([]);            // office rows
  const [subsDraft, setSubsDraft] = useState([]);              // rows
  const [kbDraft, setKbDraft] = useState([]);                  // articles
  const [warningsBySection, setWarningsBySection] = useState({});
  const [expandedKb, setExpandedKb] = useState({});

  const [sendInvites, setSendInvites] = useState(false);
  const [applyError, setApplyError] = useState("");

  // Keep an unfinished URL intact if surrounding company data refetches and
  // remounts this setup panel. The draft is only cleared after Apply succeeds.
  useEffect(() => {
    if (websiteDraftKey) sessionStorage.setItem(websiteDraftKey, websiteUrl);
  }, [websiteDraftKey, websiteUrl]);

  // An intentional switch to a different company starts with that company's
  // own draft/value; a refetch of the same company never overwrites typing.
  useEffect(() => {
    if (websiteCompanyIdRef.current === myCompany?.id) return;
    websiteCompanyIdRef.current = myCompany?.id;
    const nextValue = myCompany?.id
      ? (sessionStorage.getItem(`smart_setup_website_draft:${myCompany.id}`) ?? myCompany.website ?? "")
      : "";
    setWebsiteUrl(nextValue);
  }, [myCompany?.id, myCompany?.website]);

  const runParse = async (section, payload, onParsed) => {
    setSection(section, { status: "parsing", error: "" });
    try {
      const data = await invokeParse({ section, ...payload });
      onParsed(data.parsed);
      setWarningsBySection(prev => ({ ...prev, [section]: data.warnings || [] }));
      setSection(section, { status: "idle" });
    } catch (e) {
      setSection(section, { status: "error", error: e.message });
    }
  };

  // A logo the owner uploaded by hand always wins over the website-discovered one.
  const parseCompany = () => runParse("company", { text: aboutText, websiteUrl }, p =>
    setCompanyDraft(prev => {
      if (prev?._logoSource === "upload" && prev.logo_url) return { ...p, logo_url: prev.logo_url, _logoSource: "upload" };
      return { ...p, _logoSource: p.logo_url ? "website" : "" };
    }));
  const parseHours = () => runParse("hours", { text: hoursText }, p => setHoursDraft(p));
  const parseStaff = () => runParse("staff", { text: rosterText }, p =>
    setStaffDraft(p.staff.map((r, i) => ({ ...r, _key: `${Date.now()}_${i}` }))));
  const parseAreas = () => runParse("service_areas", { text: areasText }, p => setAreasDraft(p.office_locations));
  const parseSubs = () => runParse("subcontractors", { text: subsText }, p =>
    setSubsDraft(prev => [...prev, ...p.subcontractors.map((r, i) => ({ ...r, _key: `${Date.now()}_${i}` }))]));

  const parseKnowledgeFromWebsite = () =>
    runParse("knowledge", { websiteUrl, sourceName: "Company website" }, p => setKbDraft(prev => [...prev, ...p.articles]));

  const handleKnowledgeFiles = async (files) => {
    setDocBusy(true);
    setSection("knowledge", { error: "" });
    try {
      for (const file of files) {
        let text = "";
        if (file.name.toLowerCase().endsWith(".pdf")) {
          text = await extractPdfTextFromFile(file);
        } else {
          text = await file.text();
        }
        if (!text.trim()) throw new Error(`No readable text found in ${file.name}. If it's a scanned PDF, try a text-based version.`);
        const data = await invokeParse({ section: "knowledge", text: text.slice(0, 30000), sourceName: file.name });
        setKbDraft(prev => [...prev, ...data.parsed.articles]);
        setWarningsBySection(prev => ({ ...prev, knowledge: [...(prev.knowledge || []), ...(data.warnings || [])] }));
      }
    } catch (e) {
      setSection("knowledge", { status: "error", error: e.message });
    } finally {
      setDocBusy(false);
    }
  };

  // Logo upload works with or without an AI parse: uploading first simply
  // starts a review draft with just the logo in it.
  const handleLogoUpload = async (file) => {
    setLogoBusy(true);
    setSection("company", { error: "" });
    try {
      if (!/^image\//.test(file.type)) throw new Error("That file isn't an image — please upload a PNG, JPG, or similar.");
      const res = await base44.integrations.Core.UploadFile({ file });
      const url = res?.file_url;
      if (!url) throw new Error("The logo upload didn't return a file. Please try again.");
      setCompanyDraft(prev => ({ ...(prev || {}), logo_url: url, _logoSource: "upload" }));
    } catch (e) {
      setSection("company", { status: "error", error: e.message });
    } finally {
      setLogoBusy(false);
    }
  };

  const handleSubsCsv = async (file) => {
    try {
      const parsed = parseSubcontractorCsv(await file.text());
      setSubsDraft(prev => [...prev, ...parsed]);
      setSection("subcontractors", { error: "" });
    } catch (e) {
      setSection("subcontractors", { status: "error", error: e.message });
    }
  };

  const hasAnything = !!companyDraft || !!hoursDraft || staffDraft.length > 0 || areasDraft.length > 0 || subsDraft.length > 0 || kbDraft.length > 0;

  // Checkpoint tracker: if the apply run fails partway, a retry must skip
  // sections/rows that already persisted, or we'd create duplicates.
  const appliedRef = useRef({ company: false, hours: false, areas: false, staff: new Set(), subs: new Set(), kb: new Set() });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!myCompany?.id) throw new Error("Your company hasn't been created yet — complete the Company Info step first.");
      const companyId = myCompany.id;
      const applied = appliedRef.current;
      const results = { staff: 0, subs: 0, kb: 0, invites: 0 };

      // 1) Company fields (only non-empty; never touches subscription fields)
      if (companyDraft && !applied.company) {
        const upd = {};
        for (const k of ["company_name", "phone", "email", "website", "address", "city", "state", "zip", "description", "logo_url", "brand_primary_color", "brand_secondary_color"]) {
          if (companyDraft[k]) upd[k] = companyDraft[k];
        }
        if (companyDraft.tagline) upd.company_tagline = companyDraft.tagline;
        if (companyDraft.services?.length) upd.services_offered = companyDraft.services;
        if (Object.keys(upd).length) await base44.entities.Company.update(companyId, upd);
        applied.company = true;
      }

      // 2) Business hours → AssistantSettings.scheduling_defaults (drives
      // after-hours AI behavior). If assistants don't exist yet, stash for the
      // AI Assistants step to pick up at creation time.
      if (hoursDraft && !applied.hours) {
        const sched = {
          business_hours_start: hoursDraft.business_hours_start,
          business_hours_end: hoursDraft.business_hours_end,
          work_days: hoursDraft.work_days,
        };
        sessionStorage.setItem("smart_setup_hours", JSON.stringify(sched));
        for (const as of assistantSettings) {
          await base44.entities.AssistantSettings.update(as.id, {
            scheduling_defaults: { ...(as.scheduling_defaults || {}), ...sched },
          });
        }
        applied.hours = true;
      }

      // 3) Service areas → StormAlertSettings.office_locations
      if (areasDraft.length > 0 && !applied.areas) {
        const offices = areasDraft.filter(o => o.location?.trim());
        if (offices.length) {
          const existing = await base44.entities.StormAlertSettings.filter({ company_id: companyId });
          if (existing?.[0]?.id) {
            await base44.entities.StormAlertSettings.update(existing[0].id, { office_locations: offices });
          } else {
            await base44.entities.StormAlertSettings.create({
              company_id: companyId,
              office_locations: offices,
              min_severity: "severe",
              enable_email_alerts: true,
              enable_sms_alerts: true,
              alert_recipients: user?.email ? [user.email] : [],
              storm_types_to_monitor: ["hail", "tornado", "high_wind", "thunderstorm", "general_advisory"],
            });
          }
        }
        applied.areas = true;
      }

      // 4) Staff profiles (+ optional invites, ONLY now — after explicit confirm)
      for (const row of staffDraft) {
        if (!row.full_name?.trim()) continue;
        if (applied.staff.has(row._key)) { results.staff++; continue; }
        const email = (row.email || "").trim().toLowerCase();
        if (email && user?.email && email === user.email.toLowerCase()) continue; // owner already has a profile
        await base44.entities.StaffProfile.create({
          company_id: companyId,
          user_email: email || undefined,
          email: email || undefined,
          full_name: row.full_name.trim(),
          phone: row.phone || "",
          position: row.position || "Sales Rep",
          is_administrator: !!row.is_administrator,
          is_active: true,
          ...(row.commission_rate !== null && row.commission_rate !== undefined && row.commission_rate !== "" ? { commission_rate: Number(row.commission_rate) } : {}),
        });
        applied.staff.add(row._key);
        results.staff++;
        if (sendInvites && email) {
          try {
            const forgotPasswordUrl = `${window.location.origin}/ForgotPassword`;
            await base44.functions.invoke("sendEmailFromCRM", {
              to: email,
              subject: `You're invited to join ${myCompany.company_name || "our team"} on CompanySync!`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <h1 style="color: #1e293b; margin-bottom: 8px;">You're Invited to ${myCompany.company_name || "Our Team"}!</h1>
                  <p style="color: #64748b; font-size: 15px;">Hi ${row.full_name},</p>
                  <p style="color: #334155; font-size: 15px;">You've been added as a <strong>${row.position || "team member"}</strong> at <strong>${myCompany.company_name || "our company"}</strong>.</p>
                  <ol style="color: #334155; font-size: 15px; line-height: 1.8; padding-left: 20px;">
                    <li>Click the button below to go to the password setup page</li>
                    <li>Enter your email (<strong>${email}</strong>) and click <strong>"Send Reset Link"</strong></li>
                    <li>Check your inbox for a link to set your password</li>
                  </ol>
                  <div style="text-align: center; margin: 32px 0;">
                    <a href="${forgotPasswordUrl}" style="display: inline-block; background-color: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600;">Set Up My Password</a>
                  </div>
                  <p style="color: #94a3b8; font-size: 13px; word-break: break-all;">Or copy this link: ${forgotPasswordUrl}</p>
                </div>`,
              companyId,
            });
            results.invites++;
          } catch (e) {
            console.warn("[SmartSetup] Invite email failed for", email, e.message);
          }
        }
      }

      // 5) Subcontractors
      for (const row of subsDraft) {
        if (!row.name?.trim()) continue;
        if (applied.subs.has(row._key)) { results.subs++; continue; }
        await base44.entities.Subcontractor.create({
          company_id: companyId,
          name: row.name.trim(),
          contact_person: row.contact_person || "",
          email: row.email || "",
          phone: row.phone || "",
          specialty: row.specialty || [],
          base_city: row.base_city || "",
          base_state: row.base_state || "",
          service_radius_miles: 30,
          payment_method_preference: "check",
          is_active: true,
        });
        applied.subs.add(row._key);
        results.subs++;
      }

      // 6) Knowledge base articles for Lexi & Alex (keyed by title on retry)
      for (const a of kbDraft) {
        if (!a.title?.trim() || !a.content?.trim()) continue;
        const kbKey = a.title.trim().toLowerCase();
        if (applied.kb.has(kbKey)) { results.kb++; continue; }
        await base44.entities.KnowledgeBaseArticle.create({
          company_id: companyId,
          title: a.title.trim(),
          content: a.content,
          category: KB_CATEGORIES.includes(a.category) ? a.category : "general",
          tags: a.tags || [],
          is_published: true,
          is_ai_training: true,
          ai_assistant_targets: ["lexi", "estimator", "sarah", "marcus"],
        });
        applied.kb.add(kbKey);
        results.kb++;
      }

      return results;
    },
    onSuccess: (results) => {
      setApplyError("");
      if (websiteDraftKey) sessionStorage.removeItem(websiteDraftKey);
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["layout-companies-list"] });
      queryClient.invalidateQueries({ queryKey: ["staff-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["assistant-settings"] });
      onApplied?.(results);
    },
    onError: (e) => setApplyError(e.message),
  });

  return (
    <div className="space-y-4">
      <Alert className="bg-purple-50 border-purple-200">
        <Sparkles className="w-4 h-4 text-purple-600" />
        <AlertDescription className="text-purple-900">
          <strong>Smart Fill with AI</strong> — paste your info in any format and AI organizes it. You review and edit
          everything before anything is saved, and team invites only go out after you confirm. Every section is
          optional — you can always fill things in manually later.
        </AlertDescription>
      </Alert>

      {/* Company info */}
      <SectionShell
        name="company"
        sectionState={sec.company}
        warnings={warningsBySection.company}
        right={<ParseButton sectionState={sec.company} onClick={parseCompany} disabled={!websiteUrl.trim() && !aboutText.trim()} label="Smart Fill" retry testId="button-parse-company" />}
      >
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Company website</Label>
            <Input placeholder="www.yourcompany.com" value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} data-testid="input-smart-website" />
            <p className="text-[10px] text-gray-400 mt-0.5">AI pulls your name, tagline, contact info — plus your logo and brand colors.</p>
          </div>
          <div>
            <Label className="text-xs">Logo (or let AI grab it from your website)</Label>
            <label className="block">
              <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); e.target.value = ""; }} data-testid="input-smart-logo" />
              <Button size="sm" variant="outline" asChild disabled={logoBusy}>
                <span className="cursor-pointer">{logoBusy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />} {companyDraft?.logo_url ? "Replace Logo" : "Upload Logo"}</span>
              </Button>
            </label>
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Tell us about your company (anything goes)</Label>
            <Textarea rows={2} placeholder="We're ABC Roofing in Dallas, TX. Family-owned since 2005, we do residential shingle and metal roofs, gutters, and storm damage repair…" value={aboutText} onChange={e => setAboutText(e.target.value)} data-testid="input-smart-about" />
          </div>
        </div>
        {companyDraft && (
          <div className="border rounded-lg p-3 bg-gray-50 space-y-2" data-testid="review-smart-company">
            <p className="text-xs font-medium text-gray-500 uppercase">Review & edit</p>
            <div className="grid md:grid-cols-2 gap-2">
              {[["company_name", "Company name"], ["tagline", "Tagline"], ["phone", "Phone"], ["email", "Email"], ["website", "Website"], ["address", "Address"], ["city", "City"], ["state", "State"], ["zip", "ZIP"]].map(([k, label]) => (
                <div key={k}>
                  <Label className="text-xs">{label} {lowConf(companyDraft.confidence?.[k]) && <Badge variant="outline" className="ml-1 text-amber-700 border-amber-400 text-[10px]">check this</Badge>}</Label>
                  <Input className={confClass(companyDraft.confidence?.[k])} value={companyDraft[k] || ""} onChange={e => setCompanyDraft({ ...companyDraft, [k]: e.target.value })} data-testid={`input-review-company-${k}`} />
                </div>
              ))}
              <div className="md:col-span-2">
                <Label className="text-xs">Description</Label>
                <Textarea rows={2} value={companyDraft.description || ""} onChange={e => setCompanyDraft({ ...companyDraft, description: e.target.value })} />
              </div>
              <div className="md:col-span-2 flex flex-wrap items-start gap-4 pt-1">
                <div data-testid="review-company-logo">
                  <Label className="text-xs">Logo {companyDraft._logoSource === "website" && <Badge variant="outline" className="ml-1 text-purple-700 border-purple-400 text-[10px]">found on your website</Badge>}</Label>
                  {companyDraft.logo_url ? (
                    <div className="flex items-center gap-2 mt-1">
                      <img src={companyDraft.logo_url} alt="Company logo preview" className="h-12 max-w-[160px] object-contain bg-white border rounded-md p-1" data-testid="img-review-logo"
                        onError={e => { e.currentTarget.style.display = "none"; }} />
                      <Button variant="ghost" size="sm" className="text-red-600" onClick={() => setCompanyDraft({ ...companyDraft, logo_url: "", _logoSource: "" })} data-testid="button-remove-logo"><Trash2 className="w-3 h-3 mr-1" /> Remove</Button>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1">No logo yet — upload one above.</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs">Brand colors {companyDraft._logoSource === "website" || companyDraft.brand_primary_color ? <Badge variant="outline" className="ml-1 text-purple-700 border-purple-400 text-[10px]">from your website</Badge> : null}</Label>
                  <div className="flex items-center gap-3 mt-1">
                    {[["brand_primary_color", "Primary"], ["brand_secondary_color", "Secondary"]].map(([k, label]) => (
                      <div key={k} className="flex items-center gap-1">
                        <input type="color" className="h-8 w-10 border rounded cursor-pointer bg-white" value={companyDraft[k] || (k === "brand_primary_color" ? "#3b82f6" : "#8b5cf6")}
                          onChange={e => setCompanyDraft({ ...companyDraft, [k]: e.target.value })} data-testid={`input-review-${k}`} />
                        <span className="text-[10px] text-gray-500">{label}{!companyDraft[k] && " (default)"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setCompanyDraft(null)} className="text-red-600" data-testid="button-clear-company"><Trash2 className="w-3 h-3 mr-1" /> Discard</Button>
            </div>
          </div>
        )}
      </SectionShell>

      {/* Hours */}
      <SectionShell
        name="hours"
        sectionState={sec.hours}
        warnings={warningsBySection.hours}
        right={<ParseButton sectionState={sec.hours} onClick={parseHours} disabled={!hoursText.trim()} label="Parse Hours" retry testId="button-parse-hours" />}
      >
        <Input placeholder={'e.g. "M-F 8 to 5, Saturdays by appointment"'} value={hoursText} onChange={e => setHoursText(e.target.value)} data-testid="input-smart-hours" />
        {hoursDraft && (
          <div className="border rounded-lg p-3 bg-gray-50 space-y-2" data-testid="review-smart-hours">
            <p className="text-xs font-medium text-gray-500 uppercase">Review & edit {lowConf(hoursDraft.confidence) && <Badge variant="outline" className="ml-1 text-amber-700 border-amber-400 text-[10px]">check this</Badge>}</p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="text-xs">Opens (hour, 0–23)</Label>
                <Input type="number" min={0} max={23} className="w-24" value={hoursDraft.business_hours_start} onChange={e => setHoursDraft({ ...hoursDraft, business_hours_start: Math.min(23, Math.max(0, parseInt(e.target.value) || 0)) })} data-testid="input-review-hours-start" />
              </div>
              <div>
                <Label className="text-xs">Closes (hour, 0–23)</Label>
                <Input type="number" min={0} max={23} className="w-24" value={hoursDraft.business_hours_end} onChange={e => setHoursDraft({ ...hoursDraft, business_hours_end: Math.min(23, Math.max(0, parseInt(e.target.value) || 0)) })} data-testid="input-review-hours-end" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {WORK_DAYS.map(d => (
                <label key={d} className={`text-xs px-2 py-1 rounded-full border cursor-pointer select-none ${hoursDraft.work_days?.includes(d) ? "bg-blue-100 border-blue-400 text-blue-800" : "bg-white border-gray-300 text-gray-500"}`}>
                  <input type="checkbox" className="hidden" checked={hoursDraft.work_days?.includes(d) || false}
                    onChange={() => setHoursDraft({ ...hoursDraft, work_days: hoursDraft.work_days?.includes(d) ? hoursDraft.work_days.filter(x => x !== d) : [...(hoursDraft.work_days || []), d] })} />
                  {d.slice(0, 3)}
                </label>
              ))}
            </div>
            {hoursDraft.notes && <p className="text-xs text-gray-500">Note: {hoursDraft.notes}</p>}
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setHoursDraft(null)} className="text-red-600"><Trash2 className="w-3 h-3 mr-1" /> Discard</Button>
            </div>
          </div>
        )}
      </SectionShell>

      {/* Staff */}
      <SectionShell
        name="staff"
        sectionState={sec.staff}
        warnings={warningsBySection.staff}
        right={<ParseButton sectionState={sec.staff} onClick={parseStaff} disabled={!rosterText.trim()} label="Organize Team" retry testId="button-parse-staff" />}
      >
        <Textarea rows={3} placeholder={"Paste your team in any format:\nJohn Smith, john@abc.com, 555-201-3344, sales rep, 10% commission\nMary Jones – office manager – mary@abc.com"} value={rosterText} onChange={e => setRosterText(e.target.value)} data-testid="input-smart-roster" />
        {staffDraft.length > 0 && (
          <div className="border rounded-lg p-3 bg-gray-50 space-y-2" data-testid="review-smart-staff">
            <p className="text-xs font-medium text-gray-500 uppercase">Review & edit — {staffDraft.length} team member{staffDraft.length > 1 ? "s" : ""}</p>
            <div className="space-y-2">
              {staffDraft.map((row, i) => (
                <div key={row._key} className={`border rounded-md p-2 bg-white grid md:grid-cols-6 gap-2 items-end ${lowConf(row.confidence) ? "border-amber-300" : "border-gray-200"}`} data-testid={`row-review-staff-${i}`}>
                  <div><Label className="text-[10px]">Name</Label><Input className="h-8 text-sm" value={row.full_name} onChange={e => setStaffDraft(s => s.map((r, j) => j === i ? { ...r, full_name: e.target.value } : r))} data-testid={`input-staff-name-${i}`} /></div>
                  <div><Label className="text-[10px]">Email {row.issues?.includes("missing_email") && <span className="text-amber-600">(needed to invite)</span>}</Label><Input className={`h-8 text-sm ${row.issues?.some(x => x.includes("email")) ? "border-amber-400 bg-amber-50" : ""}`} value={row.email || ""} onChange={e => setStaffDraft(s => s.map((r, j) => j === i ? { ...r, email: e.target.value } : r))} data-testid={`input-staff-email-${i}`} /></div>
                  <div><Label className="text-[10px]">Phone</Label><Input className="h-8 text-sm" value={row.phone || ""} onChange={e => setStaffDraft(s => s.map((r, j) => j === i ? { ...r, phone: e.target.value } : r))} /></div>
                  <div>
                    <Label className="text-[10px]">Role</Label>
                    <select className="h-8 w-full text-sm border rounded-md px-1" value={row.position} onChange={e => setStaffDraft(s => s.map((r, j) => j === i ? { ...r, position: e.target.value } : r))} data-testid={`select-staff-role-${i}`}>
                      {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                      {!POSITIONS.includes(row.position) && <option value={row.position}>{row.position}</option>}
                    </select>
                  </div>
                  <div className="flex items-center gap-1 pb-1">
                    <Checkbox checked={!!row.is_administrator} onCheckedChange={v => setStaffDraft(s => s.map((r, j) => j === i ? { ...r, is_administrator: !!v } : r))} id={`adm-${i}`} />
                    <Label htmlFor={`adm-${i}`} className="text-[10px]">Admin</Label>
                  </div>
                  <div className="flex items-end gap-1">
                    <div className="flex-1"><Label className="text-[10px]">Comm. %</Label><Input className="h-8 text-sm" type="number" value={row.commission_rate ?? ""} onChange={e => setStaffDraft(s => s.map((r, j) => j === i ? { ...r, commission_rate: e.target.value } : r))} /></div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setStaffDraft(s => s.filter((_, j) => j !== i))} data-testid={`button-remove-staff-${i}`}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Checkbox id="send-invites" checked={sendInvites} onCheckedChange={v => setSendInvites(!!v)} data-testid="checkbox-send-invites" />
              <Label htmlFor="send-invites" className="text-sm">Email each person an invite when I confirm (only rows with an email)</Label>
            </div>
          </div>
        )}
      </SectionShell>

      {/* Service areas */}
      <SectionShell
        name="service_areas"
        sectionState={sec.service_areas}
        warnings={warningsBySection.service_areas}
        right={<ParseButton sectionState={sec.service_areas} onClick={parseAreas} disabled={!areasText.trim()} label="Map It" retry testId="button-parse-service_areas" />}
      >
        <Input placeholder={'e.g. "Based in Dallas, TX — we cover everything within 75 miles, plus Fort Worth and Waco"'} value={areasText} onChange={e => setAreasText(e.target.value)} data-testid="input-smart-areas" />
        {areasDraft.length > 0 && (
          <div className="border rounded-lg p-3 bg-gray-50 space-y-2" data-testid="review-smart-areas">
            <p className="text-xs font-medium text-gray-500 uppercase">Review & edit — storm alerts will watch these areas</p>
            {areasDraft.map((o, i) => (
              <div key={i} className="grid md:grid-cols-4 gap-2 items-end bg-white border rounded-md p-2">
                <div><Label className="text-[10px]">Office name</Label><Input className="h-8 text-sm" value={o.name} onChange={e => setAreasDraft(a => a.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /></div>
                <div><Label className="text-[10px]">Location (City, ST)</Label><Input className="h-8 text-sm" value={o.location} onChange={e => setAreasDraft(a => a.map((x, j) => j === i ? { ...x, location: e.target.value } : x))} data-testid={`input-area-location-${i}`} /></div>
                <div><Label className="text-[10px]">Radius (miles)</Label><Input className="h-8 text-sm" type="number" value={o.radius_miles} onChange={e => setAreasDraft(a => a.map((x, j) => j === i ? { ...x, radius_miles: parseInt(e.target.value) || 60 } : x))} /></div>
                <div className="flex items-end gap-1">
                  <div className="flex-1"><Label className="text-[10px]">Extra areas (comma-sep)</Label><Input className="h-8 text-sm" value={(o.service_areas || []).join(", ")} onChange={e => setAreasDraft(a => a.map((x, j) => j === i ? { ...x, service_areas: e.target.value.split(",").map(s => s.trim()).filter(Boolean) } : x))} /></div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setAreasDraft(a => a.filter((_, j) => j !== i))}><Trash2 className="w-3 h-3" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionShell>

      {/* Subcontractors */}
      <SectionShell
        name="subcontractors"
        sectionState={sec.subcontractors}
        warnings={warningsBySection.subcontractors}
        right={
          <div className="flex gap-2">
            <label>
              <input type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleSubsCsv(f); e.target.value = ""; }} data-testid="input-subs-csv" />
              <Button size="sm" variant="outline" asChild><span className="cursor-pointer"><Upload className="w-4 h-4 mr-1" /> CSV</span></Button>
            </label>
            <ParseButton sectionState={sec.subcontractors} onClick={parseSubs} disabled={!subsText.trim()} label="Sort List" retry testId="button-parse-subcontractors" />
          </div>
        }
      >
        <Textarea rows={2} placeholder={"Paste subcontractors in any format, or import a CSV:\nGutterPros LLC – Mike – 555-888-1234 – gutters, Fort Worth"} value={subsText} onChange={e => setSubsText(e.target.value)} data-testid="input-smart-subs" />
        {subsDraft.length > 0 && (
          <div className="border rounded-lg p-3 bg-gray-50 space-y-2" data-testid="review-smart-subs">
            <p className="text-xs font-medium text-gray-500 uppercase">Review & edit — {subsDraft.length} subcontractor{subsDraft.length > 1 ? "s" : ""}</p>
            {subsDraft.map((row, i) => (
              <div key={row._key} className={`grid md:grid-cols-6 gap-2 items-end bg-white border rounded-md p-2 ${lowConf(row.confidence) ? "border-amber-300" : "border-gray-200"}`} data-testid={`row-review-sub-${i}`}>
                <div><Label className="text-[10px]">Company</Label><Input className="h-8 text-sm" value={row.name} onChange={e => setSubsDraft(s => s.map((r, j) => j === i ? { ...r, name: e.target.value } : r))} /></div>
                <div><Label className="text-[10px]">Contact</Label><Input className="h-8 text-sm" value={row.contact_person || ""} onChange={e => setSubsDraft(s => s.map((r, j) => j === i ? { ...r, contact_person: e.target.value } : r))} /></div>
                <div><Label className="text-[10px]">Email</Label><Input className="h-8 text-sm" value={row.email || ""} onChange={e => setSubsDraft(s => s.map((r, j) => j === i ? { ...r, email: e.target.value } : r))} /></div>
                <div><Label className="text-[10px]">Phone</Label><Input className="h-8 text-sm" value={row.phone || ""} onChange={e => setSubsDraft(s => s.map((r, j) => j === i ? { ...r, phone: e.target.value } : r))} /></div>
                <div><Label className="text-[10px]">Trades</Label><Input className="h-8 text-sm" value={(row.specialty || []).join(", ")} placeholder="Gutters, Siding" onChange={e => setSubsDraft(s => s.map((r, j) => j === i ? { ...r, specialty: e.target.value.split(",").map(x => x.trim()).map(x => SUB_SPECIALTIES.find(o => o.toLowerCase() === x.toLowerCase()) || x).filter(Boolean) } : r))} /></div>
                <div className="flex items-end gap-1">
                  <div className="flex-1"><Label className="text-[10px]">City, ST</Label><Input className="h-8 text-sm" value={[row.base_city, row.base_state].filter(Boolean).join(", ")} onChange={e => { const [c, st] = e.target.value.split(","); setSubsDraft(s => s.map((r, j) => j === i ? { ...r, base_city: (c || "").trim(), base_state: (st || "").trim().toUpperCase().slice(0, 2) } : r)); }} /></div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setSubsDraft(s => s.filter((_, j) => j !== i))}><Trash2 className="w-3 h-3" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionShell>

      {/* Knowledge */}
      <SectionShell
        name="knowledge"
        sectionState={sec.knowledge}
        warnings={warningsBySection.knowledge}
        right={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={parseKnowledgeFromWebsite} disabled={!websiteUrl.trim() || (sec.knowledge?.status === "parsing") || docBusy} data-testid="button-kb-from-website">
              <Globe className="w-4 h-4 mr-1" /> From Website
            </Button>
            <label>
              <input type="file" accept=".pdf,.txt,.md,.csv" multiple className="hidden" onChange={e => { const fs = Array.from(e.target.files || []); if (fs.length) handleKnowledgeFiles(fs); e.target.value = ""; }} data-testid="input-kb-files" />
              <Button size="sm" asChild className="bg-purple-600 hover:bg-purple-700" disabled={docBusy}>
                <span className="cursor-pointer">{docBusy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />} Upload Docs</span>
              </Button>
            </label>
          </div>
        }
      >
        <p className="text-xs text-gray-500">Upload price sheets, contracts, sample forms, or FAQs (PDF or text) — or pull from your website. AI turns them into knowledge your assistants Lexi & Alex use when answering calls and questions.</p>
        {docBusy && (
          <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-md p-2" data-testid="loading-kb-docs">
            <Loader2 className="w-4 h-4 animate-spin" /> AI is reading your documents…
          </div>
        )}
        {kbDraft.length > 0 && (
          <div className="border rounded-lg p-3 bg-gray-50 space-y-2" data-testid="review-smart-knowledge">
            <p className="text-xs font-medium text-gray-500 uppercase">Review & edit — {kbDraft.length} article{kbDraft.length > 1 ? "s" : ""}</p>
            {kbDraft.map((a, i) => (
              <div key={i} className={`bg-white border rounded-md p-2 space-y-1 ${lowConf(a.confidence) ? "border-amber-300" : "border-gray-200"}`} data-testid={`row-review-kb-${i}`}>
                <div className="flex items-center gap-2">
                  <Input className="h-8 text-sm flex-1 font-medium" value={a.title} onChange={e => setKbDraft(k => k.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
                  <select className="h-8 text-sm border rounded-md px-1" value={a.category} onChange={e => setKbDraft(k => k.map((x, j) => j === i ? { ...x, category: e.target.value } : x))}>
                    {KB_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setExpandedKb(p => ({ ...p, [i]: !p[i] }))}>{expandedKb[i] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setKbDraft(k => k.filter((_, j) => j !== i))}><Trash2 className="w-3 h-3" /></Button>
                </div>
                {a.source && <p className="text-[10px] text-gray-400">Source: {a.source}</p>}
                {expandedKb[i]
                  ? <Textarea rows={6} className="text-sm" value={a.content} onChange={e => setKbDraft(k => k.map((x, j) => j === i ? { ...x, content: e.target.value } : x))} />
                  : <p className="text-xs text-gray-500 line-clamp-2">{a.content}</p>}
              </div>
            ))}
          </div>
        )}
      </SectionShell>

      {/* Apply */}
      {hasAnything && (
        <Card className="border-green-300 bg-green-50/60" data-testid="card-smart-apply">
          <CardContent className="p-4 space-y-3">
            <h3 className="font-semibold text-green-900 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Ready to apply</h3>
            <ul className="text-sm text-green-900 space-y-0.5">
              {companyDraft && <li>• Company info will be updated{companyDraft.logo_url ? " (including your logo)" : ""}{companyDraft.brand_primary_color ? " with brand colors" : ""}</li>}
              {hoursDraft && <li>• Business hours saved for after-hours AI behavior</li>}
              {staffDraft.length > 0 && <li>• {staffDraft.length} team member{staffDraft.length > 1 ? "s" : ""} created{sendInvites ? " + invite emails sent" : " (no invites yet)"}</li>}
              {areasDraft.length > 0 && <li>• Storm alerts set up for {areasDraft.length} area{areasDraft.length > 1 ? "s" : ""}</li>}
              {subsDraft.length > 0 && <li>• {subsDraft.length} subcontractor{subsDraft.length > 1 ? "s" : ""} added</li>}
              {kbDraft.length > 0 && <li>• {kbDraft.length} knowledge article{kbDraft.length > 1 ? "s" : ""} for Lexi & Alex</li>}
            </ul>
            {applyError && (
              <Alert className="bg-red-50 border-red-200">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <AlertDescription className="text-red-800">{applyError} — anything already saved won't be duplicated; fix the issue and click Confirm again to finish the rest.</AlertDescription>
              </Alert>
            )}
            <Button
              onClick={() => applyMutation.mutate()}
              disabled={applyMutation.isPending || !myCompany}
              className="bg-green-600 hover:bg-green-700 w-full"
              data-testid="button-smart-apply"
            >
              {applyMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Applying your setup…</> : <>Confirm & Apply Everything</>}
            </Button>
            {!myCompany && <p className="text-xs text-amber-700">Finish the Company Info step first so there's a company to apply this to.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
