import { useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import BackToWebsiteLink from "@/components/BackToWebsiteLink";

// Video is served from public/videos/ (Vite copies public/ → dist/ at build time).
// Prod server checks dist/videos/ at line 8421 (DIST_DIR + pathname), so this
// relative path works in both dev and production.
const MARKETING_VIDEO_URL = "/videos/companysync_marketing_final.mp4";

const FEATURES = [
  {
    number: "01",
    title: "AI Receptionist — Alex",
    icon: "📞",
    tagline: "Never miss a call again.",
    description:
      "Alex answers calls 24/7, books appointments, looks up job status, takes messages, and transfers to your team when needed. Callers get a live, intelligent response even at 2am on a Sunday — without hiring anyone.",
  },
  {
    number: "02",
    title: "AI Estimator + Satellite Roof Measurement",
    icon: "🛰️",
    tagline: "From satellite to signed estimate in minutes.",
    description:
      "Google Solar API pulls the exact roof geometry from satellite imagery. AI auto-fills line items by material and pitch, then generates a branded, ready-to-send estimate. What used to take hours now takes minutes.",
  },
  {
    number: "03",
    title: "Full CRM — Leads, Pipeline & Follow-Up",
    icon: "📋",
    tagline: "Every lead tracked. Nothing falls through.",
    description:
      "Pipeline stages, lead scoring, storm-canvassing import, GoHighLevel sync, and automatic follow-up sequences all built in. Map view shows every open lead by address. Action Items escalate reminders so no prospect goes cold.",
  },
  {
    number: "04",
    title: "Estimates → E-Sign → Invoice → Payment",
    icon: "💳",
    tagline: "One seamless flow from quote to cash.",
    description:
      "Build a line-item estimate, send it for e-signature with a branded portal link, convert to invoice, and collect payment online — all in one place. Customers can even apply for financing directly in the same portal.",
  },
  {
    number: "05",
    title: "Build Schedule & Crew Management",
    icon: "🏗️",
    tagline: "Every job tracked from install to completion.",
    description:
      "Schedule jobs, assign crews, track stage progress, and send automated homeowner text/email updates. A Scope of Work checklist is auto-generated from the estimate line items so nothing gets skipped on the job.",
  },
  {
    number: "06",
    title: "Storm Tracking & Canvassing",
    icon: "⛈️",
    tagline: "Be first on the door after every storm.",
    description:
      "Real-time hail and wind alerts from NWS + IEM pulled onto a map. Get notified the moment a storm hits your service area and instantly turn it into a canvassing list. Alerts go to your phone via email and SMS.",
  },
  {
    number: "07",
    title: "Workflow Automation",
    icon: "⚡",
    tagline: "Set it once. Works 24/7 without you.",
    description:
      "Event-triggered sequences handle the follow-up your team forgets: new lead → auto-text in 5 minutes; estimate sent → reminder at 48 hours; job completed → review request on day 3. All configurable, all automatic.",
  },
  {
    number: "08",
    title: "QuickBooks Sync + Commission Tracking",
    icon: "📊",
    tagline: "Books balanced. Reps paid. No spreadsheets.",
    description:
      "Invoices sync to QuickBooks automatically. Payments reconcile in real time. Sales rep commissions are calculated, tracked, and sent in a weekly digest email to each rep — no manual math, no disputes.",
  },
  {
    number: "09",
    title: "Customer Portal",
    icon: "🏠",
    tagline: "Give homeowners a VIP experience.",
    description:
      "Every customer gets a branded link to view their estimate, approve it, apply for financing, sign the contract, pay, and track job progress — all on their phone. Fewer calls to your office. Happier customers.",
  },
  {
    number: "10",
    title: "Multi-Tenant SaaS — Built to Scale",
    icon: "🏢",
    tagline: "Run your whole operation, or license to others.",
    description:
      "Full multi-tenant architecture — each roofing company gets its own isolated data and branding. Subscribers can plug in their own API keys (Gemini, Twilio, SMTP). Trial limits, metered billing, and subscription management are all built in.",
  },
  {
    number: "★",
    title: "PhotoSync — AI Damage Detection",
    icon: "📸",
    tagline: "Bonus: your crew's photos become your strongest evidence.",
    description:
      "Crews upload photos from the field directly in the mobile app. AI instantly analyzes every image for hail strikes, wind damage, missing shingles, and water intrusion — with annotated counts and a PDF report ready for the adjuster. No more back-and-forth. No more \"we need more photos.\"",
    isBonusFeature: true,
  },
];

export default function MarketingFeatures() {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.pause();
    } else {
      if (!video.getAttribute('src')) video.src = MARKETING_VIDEO_URL;
      video.play();
    }
    setIsPlaying(!isPlaying);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const openFullscreen = () => {
    if (videoRef.current?.requestFullscreen) {
      videoRef.current.requestFullscreen();
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* ── HERO ── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }}
        />
        <div className="relative max-w-5xl mx-auto px-6 py-20 text-center">
          <div className="inline-flex items-center gap-2 bg-blue-600/20 border border-blue-500/30 rounded-full px-4 py-1.5 text-sm text-blue-300 mb-6">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            Built for Roofing Contractors
          </div>
          <h1 className="text-5xl md:text-6xl font-black tracking-tight mb-4">
            <span className="text-white">Company</span>
            <span className="text-blue-400">Sync</span>
          </h1>
          <p className="text-xl md:text-2xl text-slate-300 max-w-2xl mx-auto mb-8 leading-relaxed">
            The all-in-one platform that runs your roofing business — CRM, AI estimating, scheduling, invoicing, and a 24/7 AI receptionist.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <a href="/signup">
              <Button size="lg" className="bg-blue-600 hover:bg-blue-500 text-white text-lg px-8 py-6 rounded-xl font-bold shadow-lg shadow-blue-900/40">
                Start Free 14-Day Trial
              </Button>
            </a>
            <a href="/login">
              <Button size="lg" variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-800 text-lg px-8 py-6 rounded-xl">
                Log In
              </Button>
            </a>
          </div>
          <BackToWebsiteLink className="inline-block mt-6 text-sm text-slate-400 hover:text-white" />
        </div>
      </div>

      {/* ── MARKETING VIDEO ── */}
      <div className="max-w-5xl mx-auto px-6 py-14">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-white mb-2">See It in Action</h2>
          <p className="text-slate-400">A 2-minute tour of everything CompanySync does for your business.</p>
        </div>

        <div className="relative rounded-2xl overflow-hidden bg-black border border-slate-800 shadow-2xl shadow-black/60 group">
          <video
            ref={videoRef}
            poster="/icons/icon-512.png"
            preload="none"
            className="w-full aspect-video object-cover bg-slate-900"
            onEnded={() => setIsPlaying(false)}
            playsInline
          />

          {/* overlay controls */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-end p-5 gap-3">
            <button
              onClick={togglePlay}
              className="w-11 h-11 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur flex items-center justify-center transition"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause className="w-5 h-5 text-white" /> : <Play className="w-5 h-5 text-white" />}
            </button>
            <button
              onClick={toggleMute}
              className="w-11 h-11 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur flex items-center justify-center transition"
              aria-label={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <VolumeX className="w-5 h-5 text-white" /> : <Volume2 className="w-5 h-5 text-white" />}
            </button>
            <div className="flex-1" />
            <button
              onClick={openFullscreen}
              className="w-11 h-11 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur flex items-center justify-center transition"
              aria-label="Full screen"
            >
              <Maximize2 className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* big play button when paused */}
          {!isPlaying && (
            <button
              onClick={togglePlay}
              className="absolute inset-0 flex items-center justify-center group/play"
              aria-label="Play video"
            >
              <div className="w-20 h-20 rounded-full bg-blue-600/90 hover:bg-blue-500 backdrop-blur flex items-center justify-center shadow-xl shadow-blue-900/60 transition-transform group-hover/play:scale-105">
                <Play className="w-9 h-9 text-white ml-1" />
              </div>
            </button>
          )}
        </div>

        {/* direct video link */}
        <div className="text-center mt-4">
          <a
            href={MARKETING_VIDEO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-400 hover:text-blue-300 underline underline-offset-4"
          >
            ↗ Open video in new tab / download
          </a>
        </div>
      </div>

      {/* ── FEATURES ── */}
      <div className="max-w-5xl mx-auto px-6 pb-20">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold text-white mb-2">Top 10 Features & Benefits</h2>
          <p className="text-slate-400 max-w-xl mx-auto">
            Everything your roofing business needs — in one platform, on any device.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {FEATURES.map((f) => (
            <div
              key={f.number}
              className={[
                "relative rounded-2xl border p-7 transition-all duration-200 hover:shadow-lg",
                f.isBonusFeature
                  ? "col-span-full border-amber-500/40 bg-gradient-to-br from-amber-950/40 to-slate-900 hover:border-amber-400/60 hover:shadow-amber-900/30"
                  : "border-slate-800 bg-slate-900 hover:border-slate-600 hover:shadow-slate-900/50",
              ].join(" ")}
            >
              {f.isBonusFeature && (
                <span className="absolute top-4 right-4 text-xs font-bold uppercase tracking-widest text-amber-400 bg-amber-400/10 border border-amber-500/30 rounded-full px-3 py-1">
                  Bonus Feature
                </span>
              )}
              <div className="flex items-start gap-4">
                <div className={[
                  "flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center text-2xl",
                  f.isBonusFeature ? "bg-amber-500/10" : "bg-blue-600/10",
                ].join(" ")}>
                  {f.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className={[
                      "text-xs font-mono font-bold",
                      f.isBonusFeature ? "text-amber-500" : "text-blue-500",
                    ].join(" ")}>
                      {f.number}
                    </span>
                    <h3 className="text-lg font-bold text-white leading-snug">{f.title}</h3>
                  </div>
                  <p className={[
                    "text-sm font-semibold mb-2",
                    f.isBonusFeature ? "text-amber-400" : "text-blue-400",
                  ].join(" ")}>
                    {f.tagline}
                  </p>
                  <p className="text-sm text-slate-400 leading-relaxed">{f.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── BOTTOM CTA ── */}
        <div className="mt-16 rounded-2xl bg-gradient-to-br from-blue-900/60 to-blue-950/60 border border-blue-700/40 p-10 text-center">
          <h3 className="text-2xl font-bold text-white mb-3">Ready to run your business smarter?</h3>
          <p className="text-slate-300 mb-7 max-w-md mx-auto">
            Start your free 14-day trial. No credit card required. Everything included from day one.
          </p>
          <a href="/signup">
            <Button size="lg" className="bg-blue-600 hover:bg-blue-500 text-white text-lg px-10 py-6 rounded-xl font-bold shadow-lg shadow-blue-900/50">
              Start Free Trial →
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}
