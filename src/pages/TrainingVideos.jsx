import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Play, ChevronRight } from "lucide-react";

const CLIPS = [
  { id: "clip01-dashboard",     title: "Your Dashboard",       duration: "~2 min", tag: "Overview",    desc: "Command center walkthrough — metrics, pipeline, build schedule, cash position, action items, and how to customize your view." },
  { id: "clip02-leads",         title: "Lead Manager",         duration: "~2.5 min", tag: "CRM",       desc: "Adding leads, moving through pipeline stages, automatic follow-ups, lead scoring, assigning reps, and converting to a customer." },
  { id: "clip03-estimates",     title: "Estimates & Proposals", duration: "~2.5 min", tag: "Sales",    desc: "Building a line-item estimate, insurance mode, financing options, sending for e-signature, revisions, and converting to an invoice." },
  { id: "clip04-ai-estimator",  title: "AI Estimator",         duration: "~2.5 min", tag: "AI",        desc: "Satellite roof measurement, auto-filled line items, photo damage analysis, AI damage reports, and Xactimate export for insurance jobs." },
  { id: "clip05-build-schedule", title: "Build Schedule",      duration: "~2.5 min", tag: "Operations", desc: "Scheduling crews, job stages, automatic homeowner reminders, PhotoSync field updates, Scope of Work checklist, and ABC Supply ordering." },
  { id: "clip06-invoices",      title: "Invoices & Payments",  duration: "~2.5 min", tag: "Finance",   desc: "Creating invoices, online payment links, payment schedules, aging report, automatic reminders, commission tracking, and QuickBooks export." },
  { id: "clip07-customers",     title: "Customer Management",  duration: "~2.5 min", tag: "CRM",        desc: "Customer profiles, communication history, notes feed, job timeline, document storage, and turning one-time clients into repeat business." },
  { id: "clip08-staff",         title: "Team & Staff",         duration: "~2.5 min", tag: "Team",       desc: "Adding crew members, setting roles and permissions, assigning jobs, tracking field activity, and managing access for office vs. field staff." },
  { id: "clip09-communications", title: "Communications Hub",  duration: "~2.5 min", tag: "Comms",      desc: "Two-way SMS and email from inside the app, bulk messaging, auto-responses, conversation history, and never losing a customer thread." },
  { id: "clip10-automations",   title: "Workflow Automations", duration: "~2.5 min", tag: "Automation", desc: "Setting up event-triggered workflows, automatic follow-up sequences, status change alerts, and hands-free nurture campaigns." },
  { id: "clip11-storm-tracking", title: "Storm Tracking",      duration: "~2.5 min", tag: "Storm",      desc: "Real-time hail and wind alerts, map overlays, canvassing storm-hit neighborhoods, and turning weather events into booked jobs." },
  { id: "clip12-settings",      title: "General Settings",     duration: "~2.5 min", tag: "Setup",      desc: "Calendar and time zone, quiet hours, notifications, lead sources, payment options, personal preferences, password security, and recent account access." },
  { id: "clip13-reports",       title: "Reports & Analytics",  duration: "~2.5 min", tag: "Analytics",  desc: "Revenue dashboards, lead source ROI, crew performance, pipeline velocity, and exporting data for your accountant or leadership team." },
  { id: "clip14-financing",     title: "Customer Financing",   duration: "~2.5 min", tag: "Finance",    desc: "Enabling financing options on estimates, Hearth and GreenSky integration, customer payment plan views, and getting more jobs approved." },
  { id: "clip15-mobile",        title: "Mobile Field Use",     duration: "~2.5 min", tag: "Mobile",     desc: "Running the app from a phone on the job site — photos, voice notes, PhotoSync updates, quick estimates, and offline capabilities." },
  { id: "clip16-reviews",       title: "Reviews & Growth",     duration: "~2.5 min", tag: "Growth",     desc: "Automated review requests after job completion, Google review links, reputation monitoring, and using reviews to win more bids." },
  { id: "clip17-quickbooks",    title: "QuickBooks Sync",      duration: "~3 min", tag: "Accounting", desc: "Connect QuickBooks Online, confirm whether you are using a test or production company, read sync counts, prevent duplicate payments, import expenses and account categories, and understand what syncs in each direction." },
  { id: "clip18-contracts",     title: "E-Signatures & Contracts", duration: "~2.5 min", tag: "Legal",  desc: "Building contract templates, sending for e-signature, tracking signed documents, Direction to Pay clauses, and storing signed PDFs automatically." },
  { id: "clip19-pricelist",     title: "Price List & Materials", duration: "~2.5 min", tag: "Setup",   desc: "Building your price list, setting markups per category, bulk CSV import, Xactimate line code mapping, and keeping rates current with the market." },
  { id: "clip20-aivoice",       title: "AI Receptionist (Alex)", duration: "~2.5 min", tag: "AI",      desc: "Setting up Alex to answer calls 24/7, training her on your business, booking appointments, call transcripts, and overflow call handling." },
  { id: "clip21-portal",        title: "Customer Portal",      duration: "~2.5 min", tag: "CRM",       desc: "What your homeowner sees — estimate review, financing options, one-tap approval, online payment, contract access, and live job status." },
  { id: "clip22-photos",        title: "Photo & Damage Reports", duration: "~2.5 min", tag: "AI",      desc: "PhotoSync photo capture, AI damage analysis, photo annotation, generating branded PDF damage reports, and sharing directly with adjusters." },
  { id: "clip23-calendar",      title: "Google Calendar Sync", duration: "~2.5 min", tag: "Comms",     desc: "Connecting your Google Calendar, two-way appointment sync, crew scheduling visibility, preventing double-booking, and multi-crew calendar setup." },
  { id: "clip24-gohighlevel",   title: "GoHighLevel Integration", duration: "~2.5 min", tag: "Growth", desc: "Syncing GHL leads into CompanySync, pushing leads back to GHL, status updates flowing both ways, and bulk storm canvassing imports." },
  { id: "clip25-tasks",         title: "Action Items & Tasks", duration: "~2.5 min", tag: "Automation", desc: "Auto-created follow-up tasks, manual task assignment, overdue escalation, pre-install checklists, and post-job review and referral sequences." },
  { id: "clip26-onboarding",    title: "Getting Started",      duration: "~2.5 min", tag: "Overview",  desc: "First-week setup: company profile, price list, estimate template, adding your first lead, inviting your team, connecting integrations, and going live." },
  // NOTE: keep new clips at the END — the ?v= deep-link param is a 1-based index
  // into this array, and links to earlier positions are already in sent emails.
  { id: "clip27-alexsetup",     title: "Alex Setup Guide",     duration: "~3 min", tag: "AI",          desc: "Step-by-step Alex setup: where to start, connecting your phone number, voice and knowledge base, scheduling defaults, testing conversations, and daily monitoring." },
  { id: "clip28-lead-finder-storm", title: "Lead Finder & Storm Workflow", duration: "~3.5 min", tag: "Storm", desc: "The 4-step storm-to-signed-job workflow: spotting events in Storm Tracking, importing county records, scoring leads by storm proximity in Lead Finder, and connecting BatchLeads or PropStream for live property data." },
  { id: "clip29-accounting",   title: "Accounting & Bookkeeping", duration: "~2 min", tag: "Accounting", desc: "Set up your chart of accounts, connect bank accounts, record expenses and bills, reconcile transactions, create journal entries, and review accounting reports." },
  { id: "clip30-siding-estimator", title: "Siding & Exterior Measurements", duration: "~2.5 min", tag: "AI", desc: "Measure siding from guided exterior photos, satellite footprints, or manual dimensions; review wall areas and openings, create the measurement report, and build the siding estimate." },
  { id: "clip31-company-setup-part1", title: "Company Setup — Part 1", duration: "~1.5 min", tag: "Setup", desc: "Configure company identity, branding, preferred shingle brands, tax defaults, numbering formats, and the public customer booking form." },
  { id: "clip32-company-setup-part2", title: "Company Setup — Part 2", duration: "~1.5 min", tag: "Setup", desc: "Customize PhotoSync assignment emails and texts, resend reminders, customer inspection confirmations, and homeowner photo-upload alerts." },
  { id: "clip33-company-setup-part3", title: "Company Setup — Part 3", duration: "~1.5 min", tag: "Setup", desc: "Configure on-call escalation channels, guided inspection voice commands, document defaults, disclaimers, and Quick Create shortcuts." },
];

const TAG_COLORS = {
  "Overview":    "bg-purple-100 text-purple-700",
  "CRM":         "bg-green-100 text-green-700",
  "Sales":       "bg-yellow-100 text-yellow-700",
  "AI":          "bg-pink-100 text-pink-700",
  "Operations":  "bg-orange-100 text-orange-700",
  "Finance":     "bg-teal-100 text-teal-700",
  "Team":        "bg-indigo-100 text-indigo-700",
  "Comms":       "bg-sky-100 text-sky-700",
  "Automation":  "bg-violet-100 text-violet-700",
  "Storm":       "bg-slate-100 text-slate-700",
  "Setup":       "bg-gray-100 text-gray-700",
  "Analytics":   "bg-cyan-100 text-cyan-700",
  "Mobile":      "bg-lime-100 text-lime-700",
  "Growth":      "bg-rose-100 text-rose-700",
  "Accounting":  "bg-emerald-100 text-emerald-700",
  "Legal":       "bg-amber-100 text-amber-700",
};

export default function TrainingVideos() {
  const initialIndex = (() => {
    const v = new URLSearchParams(window.location.search).get('v');
    if (!v) return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(n - 1, CLIPS.length - 1)) : 0;
  })();
  const [active, setActive] = useState(CLIPS[initialIndex]);
  const src = `/videos/${active.id}.mp4`;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 pb-28 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Training Videos</h1>
        <p className="text-sm text-gray-500 mt-1">Step-by-step walkthroughs of every major feature — about 2–3 minutes each.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <div className="rounded-xl overflow-hidden bg-black shadow-lg aspect-video">
            <video
              key={src}
              src={src}
              controls
              autoPlay
              className="w-full h-full"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TAG_COLORS[active.tag]}`}>{active.tag}</span>
              <h2 className="font-semibold text-gray-900">{active.title}</h2>
              <span className="text-xs text-gray-400 ml-auto">{active.duration}</span>
            </div>
            <p className="text-sm text-gray-500">{active.desc}</p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">All videos</p>
          {CLIPS.map((clip, i) => (
            <button
              key={clip.id}
              onClick={() => setActive(clip)}
              className={`w-full text-left flex items-center gap-3 p-3 rounded-lg border transition-all ${
                active.id === clip.id
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 bg-white hover:border-blue-200 hover:bg-gray-50"
              }`}
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                active.id === clip.id ? "bg-blue-600" : "bg-gray-200"
              }`}>
                {active.id === clip.id
                  ? <Play className="w-3 h-3 text-white fill-white" />
                  : <span className="text-xs font-bold text-gray-600">{i + 1}</span>}
              </div>
              <div className="min-w-0">
                <p className={`text-sm font-medium truncate ${active.id === clip.id ? "text-blue-700" : "text-gray-800"}`}>
                  {clip.title}
                </p>
                <p className="text-xs text-gray-400">{clip.duration}</p>
              </div>
              {active.id === clip.id && <ChevronRight className="w-4 h-4 text-blue-400 ml-auto flex-shrink-0" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
