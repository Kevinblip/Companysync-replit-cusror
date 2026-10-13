import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Download, Play, X, Video, ExternalLink, RefreshCw, Lock } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { base44 } from "@/api/base44Client";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
// ── Video catalogue (mirrors scripts/marketing-video-configs.cjs) ──────────
const VIDEOS = [
  { id: "01", feature: "PhotoSync 4-Layer Proof Package",   hook: "Adjusters Keep Denying Your Scope",        accent: "#2563EB", stat: "3X",    statLabel: "More Claims Approved" },
  { id: "02", feature: "AI Estimator",                      hook: "3 Hours Writing Estimates Every Night",    accent: "#7C3AED", stat: "45min", statLabel: "Saved per Estimate" },
  { id: "03", feature: "Keyword Evidence Gates",            hook: "Field Reps Miss Critical Photos",          accent: "#DC2626", stat: "100%",  statLabel: "Photo Compliance" },
  { id: "04", feature: "One-Tap Inspection Mode Toggle",    hook: "Insurance Forms Cluttering Retail Bids",   accent: "#059669", stat: "2X",    statLabel: "Faster Retail Close" },
  { id: "05", feature: "Auto-Sorted Slope Gallery",         hook: "100 Random Photos. Adjuster Says No.",     accent: "#D97706", stat: "100%",  statLabel: "Organized Every Time" },
  { id: "06", feature: "Production Photo Triggers",         hook: "Carriers Reject Decking Supplements",      accent: "#B45309", stat: "$2,400",statLabel: "Avg Decking Supplement" },
  { id: "07", feature: "Building Code Citations",           hook: "Carrier Denies Organic Replacement",       accent: "#6D28D9", stat: "$8,500",statLabel: "Avg Full-Replacement Win" },
  { id: "08", feature: "Lead Manager & Pipeline",           hook: "Storm Leads Dying in Your Spreadsheets",   accent: "#0891B2", stat: "41%",   statLabel: "Avg Close Rate Increase" },
  { id: "09", feature: "Subcontractor Dashboard",           hook: "Crews Install the Wrong Materials",        accent: "#0F766E", stat: "73%",   statLabel: "Fewer Rework Callbacks" },
  { id: "10", feature: "Hands-Free Voice Inspection",       hook: "Both Hands on the Roof, Not Your Phone",   accent: "#1D4ED8", stat: "3X",    statLabel: "Faster Inspection" },
  { id: "11", feature: "Xactimate PDF Exporter",            hook: "Carrier Rejects Your Estimate Format",     accent: "#BE185D", stat: "98%",   statLabel: "First-Submission Approval" },
  { id: "12", feature: "Claims Defense Package",            hook: "Waiting 60+ Days for Your Check",          accent: "#B45309", stat: "14d",   statLabel: "Avg Approval Time" },
  { id: "13", feature: "Live Field Operations Map",         hook: "No Idea Where Your Reps Are Today",        accent: "#047857", stat: "28%",   statLabel: "More Jobs per Rep/Day" },
  { id: "14", feature: "Automated Review Requests",         hook: "Perfect Roof. Zero Reviews.",              accent: "#CA8A04", stat: "5.0★",  statLabel: "Automated 5-Star Pipeline" },
  { id: "15", feature: "All-In-One Platform",               hook: "Paying for 5 Different Apps?",             accent: "#7C3AED", stat: "$850",  statLabel: "Saved vs. 5 Separate Tools" },
];

function videoUrl(id) { return `/generated_marketing_videos/video-${id}.mp4`; }

// Styled thumbnail card — gradient + feature text + play overlay
function VideoThumbnail({ video, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="relative rounded-lg overflow-hidden cursor-pointer select-none"
      style={{ aspectRatio: "9/16", background: `linear-gradient(160deg, #080C18 0%, ${video.accent}22 100%)` }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      {/* accent top bar */}
      <div className="absolute top-0 left-0 right-0 h-1" style={{ background: video.accent }} />

      {/* hook text */}
      <div className="absolute inset-0 flex flex-col justify-center items-center p-4 text-center">
        <span className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: video.accent }}>
          #{video.id}
        </span>
        <p className="text-white font-bold text-sm leading-snug mb-4">{video.hook}</p>
        <div className="mt-auto">
          <div className="text-3xl font-black" style={{ color: video.accent }}>{video.stat}</div>
          <div className="text-xs text-gray-300 uppercase tracking-wide">{video.statLabel}</div>
        </div>
      </div>

      {/* play hover overlay */}
      <div
        className="absolute inset-0 flex items-center justify-center transition-opacity duration-150"
        style={{ background: "rgba(0,0,0,0.45)", opacity: hovered ? 1 : 0 }}
      >
        <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: video.accent }}>
          <Play className="w-7 h-7 text-white fill-white ml-1" />
        </div>
      </div>

      {/* bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1" style={{ background: video.accent }} />
    </div>
  );
}

export default function MarketingVideos() {
  const { isAdmin, user } = useRoleBasedData();
  const isPlatformAdmin = user?.platform_role === 'super_admin';
  const [playing, setPlaying]   = useState(null); // video object
  const [search, setSearch]     = useState("");
  const [requesting, setRequesting] = useState(false); // HTTP request in flight
  const [rebuildActive, setRebuildActive] = useState(false); // background process running
  const [rebuildMsg, setRebuildMsg] = useState(null);
  const { toast } = useToast();

  async function handleRegenerate(force = false) {
    if (requesting || rebuildActive) return; // prevent concurrent spawns
    setRequesting(true);
    setRebuildMsg(null);
    try {
      const envelope = await base44.invokeFunction("generateMarketingVideos", { force });
      // base44.invokeFunction wraps handler result in { data: <payload> }.
      // Client-side/network errors come back as { error: string, data: {} }.
      if (envelope?.error) {
        const err = envelope.error;
        setRebuildMsg("Error: " + err);
        toast({ title: "Rebuild failed", description: err, variant: "destructive" });
      } else {
        const payload = envelope?.data ?? envelope;
        if (payload?.success) {
          const msg = payload.message || "Rebuild started in background.";
          setRebuildMsg(msg);
          setRebuildActive(true); // keep buttons locked until user dismisses
          toast({ title: "Video rebuild started", description: msg });
        } else {
          const err = payload?.error || "Unexpected error starting rebuild.";
          setRebuildMsg("Error: " + err);
          toast({ title: "Rebuild failed", description: err, variant: "destructive" });
        }
      }
    } catch (e) {
      const msg = e?.message || "Network error";
      setRebuildMsg("Error: " + msg);
      toast({ title: "Rebuild failed", description: msg, variant: "destructive" });
    } finally {
      setRequesting(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center text-gray-400">
          <Lock className="w-10 h-10 mx-auto mb-3 text-gray-600" />
          <p className="text-lg font-semibold text-white">Administrator access required</p>
          <p className="text-sm mt-1">This page is only available to company admins.</p>
        </div>
      </div>
    );
  }

  const filtered = search.trim()
    ? VIDEOS.filter(v =>
        v.feature.toLowerCase().includes(search.toLowerCase()) ||
        v.hook.toLowerCase().includes(search.toLowerCase())
      )
    : VIDEOS;

  function downloadVideo(video, e) {
    e.stopPropagation();
    const a = document.createElement("a");
    a.href = videoUrl(video.id);
    a.download = `companysync-video-${video.id}-${video.feature.replace(/\s+/g, "-").toLowerCase()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">

      {/* Header */}
      <div className="max-w-7xl mx-auto">
        <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
                <Video className="w-5 h-5" />
              </div>
              <h1 className="text-3xl font-black tracking-tight">Marketing Videos</h1>
            </div>
            <p className="text-gray-400 text-sm max-w-xl">
              15 short-form social videos (9:16, ~24 seconds) ready for Instagram Reels, TikTok, and Facebook. 
              Each features Gemini AI voiceover + Ken Burns animation.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="outline" className="border-green-600 text-green-400 text-xs px-3 py-1">
              {VIDEOS.length} videos · 1080×1920 · H.264/AAC
            </Badge>
            {isPlatformAdmin && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-gray-600 text-gray-300 hover:border-blue-500 hover:text-white h-8 text-xs"
                  disabled={requesting || rebuildActive}
                  onClick={() => handleRegenerate(false)}
                  title="Skip videos that already exist; only build missing ones"
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${requesting ? "animate-spin" : ""}`} />
                  {requesting ? "Starting…" : "Regenerate Missing"}
                </Button>
                <Button
                  size="sm"
                  className="bg-orange-600 hover:bg-orange-500 text-white h-8 text-xs"
                  disabled={requesting || rebuildActive}
                  onClick={() => handleRegenerate(true)}
                  title="Delete and rebuild all 15 videos from scratch"
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${requesting ? "animate-spin" : ""}`} />
                  {requesting ? "Starting…" : "Force Rebuild All"}
                </Button>
                {rebuildActive && (
                  <span className="text-xs text-yellow-400 flex items-center gap-1">
                    ⏳ Building in background…
                    <button
                      className="underline text-gray-500 hover:text-white ml-1"
                      onClick={() => { setRebuildActive(false); setRebuildMsg(null); }}
                    >
                      dismiss
                    </button>
                  </span>
                )}
                {!rebuildActive && rebuildMsg && (
                  <p className="text-xs text-gray-400 max-w-xs">{rebuildMsg}</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-8 max-w-xs">
          <input
            type="text"
            placeholder="Search features…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filtered.map(video => (
            <div key={video.id} className="flex flex-col gap-2">
              <VideoThumbnail video={video} onClick={() => setPlaying(video)} />

              {/* Card info */}
              <div className="px-1">
                <p className="text-white text-xs font-semibold leading-tight line-clamp-2">{video.feature}</p>
              </div>

              {/* Actions */}
              <div className="flex gap-1 px-1">
                <Button
                  size="sm"
                  className="flex-1 h-8 text-xs"
                  style={{ background: video.accent }}
                  onClick={() => setPlaying(video)}
                >
                  <Play className="w-3 h-3 mr-1 fill-white" /> Play
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-8 p-0 border-gray-600 hover:border-gray-400"
                  onClick={e => downloadVideo(video, e)}
                  title="Download MP4"
                >
                  <Download className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-20 text-gray-500">
            No videos match "{search}"
          </div>
        )}

        {/* Download all hint */}
        <div className="mt-10 text-center text-xs text-gray-600">
          Files live at <code className="text-gray-500">/generated_marketing_videos/video-NN.mp4</code> — right-click any video to save as.
        </div>
      </div>

      {/* Playback modal */}
      <Dialog open={!!playing} onOpenChange={open => !open && setPlaying(null)}>
        <DialogContent
          className="p-0 border-0 bg-transparent shadow-none max-w-sm w-full"
          style={{ maxHeight: "90vh" }}
        >
          <div className="relative rounded-xl overflow-hidden bg-black">
            {/* Close */}
            <button
              className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80"
              onClick={() => setPlaying(null)}
            >
              <X className="w-4 h-4" />
            </button>

            {/* Video player */}
            {playing && (
              <video
                key={playing.id}
                src={videoUrl(playing.id)}
                controls
                autoPlay
                className="w-full block"
                style={{ maxHeight: "82vh" }}
              />
            )}

            {/* Footer bar */}
            {playing && (
              <div
                className="px-4 py-3 space-y-2"
                style={{ background: playing.accent + "22", borderTop: `1px solid ${playing.accent}44` }}
              >
                {/* CTA link — the whole point of the video */}
                <a
                  href="https://companysync.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg font-black text-sm text-black transition-opacity hover:opacity-90"
                  style={{ background: playing.accent }}
                >
                  Start Free 14-Day Trial → companysync.io
                </a>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white text-xs font-semibold">{playing.feature}</p>
                    <p className="text-gray-500 text-xs">{playing.hook}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0 ml-4 text-gray-400 hover:text-white"
                    onClick={e => downloadVideo(playing, e)}
                  >
                    <Download className="w-3.5 h-3.5 mr-1" /> Download
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
