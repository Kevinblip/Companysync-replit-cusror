import React, { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2, Upload, Palette, Trash2, Download, Plus, ArrowLeft, Sparkles, Check, Share2,
  X, ZoomIn, ZoomOut, Layers, Mail, MessageSquare, Copy,
} from "lucide-react";
import ZoneDrawingCanvas from "@/components/visualizer/ZoneDrawingCanvas";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  SIDING_COLORS,
  SIDING_MATERIALS,


  SHUTTER_COLORS,
  ROOF_COLORS,
  GARAGE_DOOR_COLORS,
  AWNING_COLORS,
  FRONT_DOOR_COLORS,
  BUILT_IN_SIDING_BRANDS,
  BUILT_IN_ROOF_BRANDS,
  getColorsForBrand,
  getRoofColorsForBrand,
  ColorSection,
  MaterialTypeSelector,
  BrandSelector,
  CornerPostStyleSelector,
  compressPhoto,
  hexForColorName,
} from "@/components/visualizer/colorOptions";

export default function ColorVisualizerPanel({ entity, entityType, companyId, queryKey }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState("history");
  const [photos, setPhotos] = useState([]);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [colorScheme, setColorScheme] = useState({
    siding: "Storm",
    sidingMaterial: "vinyl",
    sidingBrand: "gentek",
    trim: "Snow White",
    soffit: "Snow White",
    shutters: "Black",
    frontDoor: "None (leave as-is)",
    garageDoor: "None (leave as-is)",
    awnings: "None (leave as-is)",
    roof: "Estate Gray",
    roofBrand: "owens_corning",
    cornerPosts: "Snow White",
    cornerPostStyle: "standard",
  });
  const [generating, setGenerating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [zoomedUrl, setZoomedUrl] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [zones, setZones] = useState([]);
  const [showZones, setShowZones] = useState(false);
  const [focusSection, setFocusSection] = useState(null);
  const fileInputRef = useRef();
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [sendingVia, setSendingVia] = useState(null); // 'email' | 'sms' — which channel is currently in-flight

  // Scroll to the focused section after switching into generate view
  useEffect(() => {
    if (view === "generate" && focusSection) {
      const t = setTimeout(() => {
        document.getElementById(focusSection)?.scrollIntoView({ behavior: "smooth", block: "center" });
        setFocusSection(null);
      }, 120);
      return () => clearTimeout(t);
    }
  }, [view, focusSection]);

  // Fetch company custom palettes so they appear in the brand selector
  const { data: customPalettesRaw } = useQuery({
    queryKey: ["company-color-palettes", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const res = await base44.entities.list("CompanyColorPalettes", { company_id: companyId });
      return Array.isArray(res) ? res[0] || null : null;
    },
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
  const customPalettes = customPalettesRaw?.custom_palettes || [];
  const allSidingBrands = [
    ...BUILT_IN_SIDING_BRANDS,
    ...customPalettes.filter(p => p.section === "siding").map(p => ({ id: p.id, label: p.label })),
  ];
  const allRoofBrands = [
    ...BUILT_IN_ROOF_BRANDS,
    ...customPalettes.filter(p => p.section === "roof").map(p => ({ id: p.id, label: p.label })),
  ];
  // Always pull from the selected brand; fall back to SIDING_COLORS only for
  // legacy saved visualizations that still carry sidingBrand: "generic".
  const activeSidingColors = getColorsForBrand(colorScheme.sidingBrand, customPalettes) || SIDING_COLORS;
  // Corner posts always offer "Match Siding" + "White" + the full active siding palette
  // so the rep can pick any siding colour for their corner posts.
  const activeCornerPostColors = [
    { name: "Match Siding", hex: null, matchSiding: true },
    { name: "White", hex: "#FFFFFF" },
    ...activeSidingColors,
  ];
  // Trim/fascia: key neutrals pinned first, then the full active siding palette
  const activeTrimColors = [
    { name: "Bright White", hex: "#FFFFFF" },
    { name: "Antique White", hex: "#FAEBD7" },
    { name: "Alabaster", hex: "#F2EDE4" },
    { name: "Light Gray", hex: "#D3D3D3" },
    { name: "Charcoal", hex: "#4A4A4A" },
    { name: "Black", hex: "#1A1A1A" },
    ...activeSidingColors,
  ];
  // Soffits: "None" first so houses without visible soffits skip the instruction,
  // then standard neutrals, then the full active siding palette.
  const activeSoffitColors = [
    { name: "None (leave as-is)", hex: null },
    { name: "Bright White", hex: "#FFFFFF" },
    { name: "Antique White", hex: "#FAEBD7" },
    { name: "Alabaster", hex: "#F2EDE4" },
    { name: "Match Trim", hex: null, matchTrim: true },
    ...activeSidingColors,
  ];
  const activeRoofColors = colorScheme.roofBrand !== "generic"
    ? (getRoofColorsForBrand(colorScheme.roofBrand, customPalettes) || ROOF_COLORS)
    : ROOF_COLORS;

  const savedViz = entity?.data?.color_visualizations || [];
  const sidingHex = hexForColorName(activeSidingColors, colorScheme.siding);

  const handleFileChange = useCallback(async e => {
    const files = Array.from(e.target.files || []).slice(0, 4 - photos.length);
    if (!files.length) return;
    const compressed = (await Promise.all(files.map(compressPhoto))).filter(Boolean);
    setPhotos(prev => [...prev, ...compressed].slice(0, 4));
    e.target.value = "";
  }, [photos.length]);

  const handleDrop = useCallback(async e => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files)
      .filter(f => f.type.startsWith("image/"))
      .slice(0, 4 - photos.length);
    if (!files.length) return;
    const compressed = (await Promise.all(files.map(compressPhoto))).filter(Boolean);
    setPhotos(prev => [...prev, ...compressed].slice(0, 4));
  }, [photos.length]);

  // base44.functions.invoke wraps success as { data: handlerResult }
  // and returns { error: msg, data: {} } on server-side crashes.
  // Unwrap consistently: prefer raw.data when present and clean, fall back to raw for errors.
  const unwrapInvoke = (raw) => raw?.error ? raw : (raw?.data ?? raw);

  const annotatePhotoWithZones = useCallback(async (photo, zoneList) => {
    const completed = (zoneList || []).filter(z => z.points && z.points.length >= 3);
    if (!completed.length) return photo;
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        completed.forEach(z => {
          const { points, fillHex, label } = z;
          ctx.beginPath();
          points.forEach(({ x, y }, i) => {
            i === 0
              ? ctx.moveTo(x * img.width, y * img.height)
              : ctx.lineTo(x * img.width, y * img.height);
          });
          ctx.closePath();
          ctx.fillStyle = fillHex + "55";
          ctx.fill();
          ctx.strokeStyle = fillHex;
          ctx.lineWidth = Math.max(2, img.width / 250);
          ctx.setLineDash([]);
          ctx.stroke();
          const cx = points.reduce((s, p) => s + p.x, 0) / points.length * img.width;
          const cy = points.reduce((s, p) => s + p.y, 0) / points.length * img.height;
          const fs = Math.max(16, img.width / 45);
          ctx.font = `bold ${fs}px Arial, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const tw = ctx.measureText(label).width + fs * 0.8;
          const th = fs * 1.4;
          ctx.fillStyle = fillHex + "dd";
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(cx - tw / 2, cy - th / 2, tw, th, 4);
          else ctx.rect(cx - tw / 2, cy - th / 2, tw, th);
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.fillText(label, cx, cy);
        });
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ ...photo, base64: dataUrl.split(",")[1], mimeType: "image/jpeg", preview: dataUrl });
      };
      img.onerror = () => resolve(photo);
      img.src = photo.preview;
    });
  }, []);

  const handleGenerate = async () => {
    if (!photos.length) return toast.error("Upload at least one house photo first");
    if (!colorScheme.siding && !colorScheme.roof) return toast.error("Select at least a siding or roof color");
    setGenerating(true);
    try {
      const annotatedPhotos = zones.length
        ? await Promise.all(photos.map(p => annotatePhotoWithZones(p, zones)))
        : photos;
      const raw = await base44.functions.invoke("generateColorVisualization", {
        companyId,
        entityId: entity.id,
        entityType,
        photos: annotatedPhotos.map(p => ({ base64: p.base64, mimeType: p.mimeType })),
        colorScheme,
        zones: zones.map(({ id, label, material, color, fillHex }) => ({ id, label, material, color, fillHex })),
      });
      const result = unwrapInvoke(raw);
      if (result?.success) {
        if (queryKey) queryClient.invalidateQueries({ queryKey });
        toast.success("Visualization saved! Tweak a color and regenerate, or go back to saved.");
        // Keep photos + colors so the contractor can quickly change a color and
        // regenerate without re-uploading. Show the fresh result inline.
        setLastResult(result.record || null);
      } else {
        toast.error(result?.error || "Generation failed. Try again with a clearer house photo.");
      }
    } catch (err) {
      toast.error("Failed: " + err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleShare = async () => {
    setSharing(true);
    try {
      const raw = await base44.functions.invoke("getColorVisualizerShareUrl", {
        companyId, entityId: entity.id, entityType,
      });
      const result = unwrapInvoke(raw);
      if (!result?.success) { toast.error(result?.error || "Could not generate share link"); return; }
      await navigator.clipboard.writeText(result.url).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = result.url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      });
      setCopied(true);
      toast.success("Link copied! Your customer can pick colors and try their own previews.");
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSharing(false);
    }
  };

  // Send the share link directly to the customer via email or SMS using the
  // contact info already on their record — no copy-paste needed.
  const handleShareVia = async (channel) => {
    setSendingVia(channel);
    try {
      const raw = await base44.functions.invoke("shareColorVizWithCustomer", {
        companyId, entityId: entity.id, entityType, channel,
      });
      const result = unwrapInvoke(raw);
      if (!result?.success) {
        toast.error(result?.error || `Could not send via ${channel}`);
      } else {
        const dest = result.to || (channel === "email" ? "their email" : "their phone");
        toast.success(`Preview link sent to ${dest}`);
        setShowShareDialog(false);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSendingVia(null);
    }
  };

  const handleDelete = async vizId => {
    if (!window.confirm("Delete this visualization?")) return;
    setDeletingId(vizId);
    try {
      const raw = await base44.functions.invoke("deleteColorVisualization", {
        companyId, entityId: entity.id, entityType, vizId,
      });
      const result = unwrapInvoke(raw);
      if (result?.success) {
        if (queryKey) queryClient.invalidateQueries({ queryKey });
        toast.success("Deleted");
      } else {
        toast.error(result?.error || "Delete failed");
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const leaveGenerate = () => {
    setView("history");
    setPhotos([]);
    setLastResult(null);
  };

  const loadVizForEdit = async (viz, section = null) => {
    if (viz.color_scheme) {
      setColorScheme(cs => ({ ...cs, ...viz.color_scheme }));
    }
    setLastResult(null);
    setZones([]);
    setFocusSection(section);
    setView("generate");

    // Restore the original house photo that was saved when this viz was generated.
    // entity.data.color_viz_source_photo is set by the server on every generate call.
    const srcUrl = entity?.data?.color_viz_source_photo;
    if (srcUrl) {
      try {
        const resp = await fetch(srcUrl);
        const blob = await resp.blob();
        const mimeType = blob.type || "image/jpeg";
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const preview = URL.createObjectURL(blob);
        setPhotos([{ base64, mimeType, preview, name: "house photo" }]);
      } catch {
        setPhotos([]); // fetch failed — user re-uploads as before
      }
    } else {
      setPhotos([]);
    }
  };

  // Shared zoom overlay — rendered in both views
  const zoomOverlay = zoomedUrl ? (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90"
      onClick={() => setZoomedUrl(null)}
      data-testid="zoom-overlay"
    >
      <div className="absolute top-4 right-4 flex items-center gap-2" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => setZoomLevel(z => Math.max(1, +(z - 0.5).toFixed(1)))}
          className="bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-colors"
          title="Zoom out"
          data-testid="zoom-out-btn"
        ><ZoomOut className="w-5 h-5" /></button>
        <span className="text-white text-sm font-medium w-12 text-center">{Math.round(zoomLevel * 100)}%</span>
        <button
          onClick={() => setZoomLevel(z => Math.min(4, +(z + 0.5).toFixed(1)))}
          className="bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-colors"
          title="Zoom in"
          data-testid="zoom-in-btn"
        ><ZoomIn className="w-5 h-5" /></button>
        <button
          onClick={() => setZoomedUrl(null)}
          className="bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-colors ml-2"
          title="Close"
          data-testid="zoom-close-btn"
        ><X className="w-5 h-5" /></button>
      </div>
      <div className="overflow-auto flex items-center justify-center" style={{ maxWidth: '96vw', maxHeight: '92vh' }} onClick={e => e.stopPropagation()}>
        <img
          src={zoomedUrl}
          alt="Zoomed view"
          style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center', transition: 'transform 0.2s', maxWidth: '94vw', maxHeight: '88vh', objectFit: 'contain' }}
          data-testid="zoom-image"
        />
      </div>
      <p className="text-white/50 text-xs mt-4">Click outside image or × to close</p>
    </div>
  ) : null;

  if (view === "generate") {
    return (
      <div className="space-y-5">
        {zoomOverlay}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={leaveGenerate}
            data-testid="back-to-history-btn"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Palette className="w-5 h-5 text-purple-500" /> New Color Visualization
            </h2>
            <p className="text-sm text-gray-500">
              Upload house photos and pick colors — AI generates realistic "after" previews
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold mb-3">
              Photos <span className="text-gray-400 font-normal text-sm">(up to 4)</span>
            </h3>
            {photos.length === 0 ? (
              <div
                className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50 transition-colors"
                onDrop={handleDrop}
                onDragOver={e => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                data-testid="color-viz-drop-zone"
              >
                <Upload className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-600 font-medium">Drop house photos here or click to upload</p>
                <p className="text-sm text-gray-400 mt-1">Front of house works best · JPG/PNG · auto-compressed</p>
              </div>
            ) : (
              <div className={`grid gap-3 ${photos.length === 1 ? "grid-cols-1" : photos.length === 2 ? "grid-cols-2" : "grid-cols-2 md:grid-cols-3"}`}>
                {photos.map((p, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={p.preview}
                      alt={p.name}
                      className="w-full object-cover rounded-lg border"
                      style={{ maxHeight: photos.length === 1 ? 480 : 260 }}
                    />
                    <button
                      onClick={() => setPhotos(prev => prev.filter((_, idx) => idx !== i))}
                      className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity font-bold text-xs leading-none"
                      data-testid={`remove-photo-${i}`}
                    >×</button>
                    <p className="text-xs text-gray-500 mt-1 truncate px-1">{p.name}</p>
                  </div>
                ))}
                {photos.length < 4 && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[120px] border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center hover:border-purple-400 hover:bg-purple-50 transition-colors gap-1"
                    data-testid="add-more-photos-btn"
                  >
                    <Plus className="w-6 h-6 text-gray-400" />
                    <span className="text-xs text-gray-400">Add photo</span>
                  </button>
                )}
              </div>
            )}
            {photos.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div
                  className={`rounded-xl border-2 transition-colors ${showZones ? "border-purple-300 bg-purple-50/40" : "border-dashed border-purple-200 bg-white hover:border-purple-400 hover:bg-purple-50/30"}`}
                >
                  <button
                    onClick={() => setShowZones(v => !v)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                    data-testid="toggle-zones-btn"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                        <Layers className="w-4 h-4 text-purple-600" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-800">
                          Paint different areas separately
                          {zones.length > 0 && (
                            <span className="ml-2 bg-purple-600 text-white text-xs rounded-full px-2 py-0.5">
                              {zones.length} zone{zones.length > 1 ? "s" : ""}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Draw regions on the photo — wood shake on the gable, stone on the base, board &amp; batten on a dormer, etc.
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-medium text-purple-600 flex-shrink-0">
                      {showZones ? "Hide ↑" : "Open ↓"}
                    </span>
                  </button>
                  {showZones && (
                    <div className="px-4 pb-4">
                      <ZoneDrawingCanvas
                        photo={photos[0]}
                        zones={zones}
                        onZonesChange={setZones}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
              data-testid="color-viz-file-input"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-5">
            <h3 className="font-semibold">Color Scheme</h3>
            <div id="cviz-siding">
              <MaterialTypeSelector
                value={colorScheme.sidingMaterial || "vinyl"}
                onChange={v => setColorScheme(s => ({ ...s, sidingMaterial: v }))}
              />
              <BrandSelector
                label="Siding Brand"
                brands={allSidingBrands}
                value={colorScheme.sidingBrand || "generic"}
                onChange={v => {
                  const colors = v !== "generic" ? (getColorsForBrand(v, customPalettes) || SIDING_COLORS) : SIDING_COLORS;
                  const match = colors.find(c => c.name === colorScheme.siding);
                  setColorScheme(s => ({ ...s, sidingBrand: v, siding: match ? s.siding : (colors[0]?.name || s.siding) }));
                }}
              />
              <ColorSection
                label="Siding Color"
                colors={activeSidingColors}
                value={colorScheme.siding}
                onChange={v => setColorScheme(s => ({ ...s, siding: v }))}
              />
            </div>
            <div id="cviz-trim">
              <ColorSection
                label="Trim & Fascia"
                colors={activeTrimColors}
                value={colorScheme.trim}
                onChange={v => setColorScheme(s => ({ ...s, trim: v }))}
              />
            </div>
            <div id="cviz-soffit">
              <ColorSection
                label="Soffit (eave underside)"
                colors={activeSoffitColors}
                value={colorScheme.soffit || "Bright White"}
                onChange={v => setColorScheme(s => ({ ...s, soffit: v }))}
                trimHex={sidingHex}
              />
            </div>
            <div id="cviz-shutters">
              <ColorSection
                label="Shutters"
                colors={SHUTTER_COLORS}
                value={colorScheme.shutters}
                onChange={v => setColorScheme(s => ({ ...s, shutters: v }))}
              />
            </div>
            <div id="cviz-front-door">
              <ColorSection
                label="Front Door"
                colors={FRONT_DOOR_COLORS}
                value={colorScheme.frontDoor || "None (leave as-is)"}
                onChange={v => setColorScheme(s => ({ ...s, frontDoor: v }))}
              />
            </div>
            <div id="cviz-garage">
              <ColorSection
                label="Garage Door"
                colors={GARAGE_DOOR_COLORS}
                value={colorScheme.garageDoor || "White"}
                onChange={v => setColorScheme(s => ({ ...s, garageDoor: v }))}
                sidingHex={sidingHex}
              />
            </div>
            <div id="cviz-awnings">
              <ColorSection
                label="Awnings & Overhangs"
                colors={AWNING_COLORS}
                value={colorScheme.awnings || "White"}
                onChange={v => setColorScheme(s => ({ ...s, awnings: v }))}
                sidingHex={sidingHex}
                trimHex={hexForColorName(activeTrimColors, colorScheme.trim)}
              />
            </div>
            <div id="cviz-corner-posts">
              <ColorSection
                label="Corner Posts"
                colors={activeCornerPostColors}
                value={colorScheme.cornerPosts}
                onChange={v => setColorScheme(s => ({ ...s, cornerPosts: v }))}
                sidingHex={sidingHex}
              />
              <CornerPostStyleSelector
                value={colorScheme.cornerPostStyle}
                onChange={v => setColorScheme(s => ({ ...s, cornerPostStyle: v }))}
              />
            </div>
            <div id="cviz-roof">
              <BrandSelector
                label="Roof Brand"
                brands={allRoofBrands}
                value={colorScheme.roofBrand || "generic"}
                onChange={v => {
                  const colors = v !== "generic" ? (getRoofColorsForBrand(v, customPalettes) || ROOF_COLORS) : ROOF_COLORS;
                  const match = colors.find(c => c.name === colorScheme.roof);
                  setColorScheme(s => ({ ...s, roofBrand: v, roof: match ? s.roof : (colors[0]?.name || s.roof) }));
                }}
              />
              <ColorSection
                label="Roof / Shingles"
                colors={activeRoofColors}
                value={colorScheme.roof}
                onChange={v => setColorScheme(s => ({ ...s, roof: v }))}
              />
            </div>
          </CardContent>
        </Card>

        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          <strong>Tip:</strong> Use a clear, straight-on photo of the house front for best results. Angled or partially blocked views still work but the AI performs best with a full frontal view.
        </div>

        {lastResult?.photos?.length > 0 && (
          <Card className="border-green-200">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2 text-green-700">
                  <Check className="w-4 h-4" /> Latest result
                </h3>
                <Button variant="outline" size="sm" onClick={leaveGenerate} data-testid="done-editing-btn">
                  Done — back to saved
                </Button>
              </div>
              <p className="text-sm text-gray-500 mb-3">
                Saved to this {entityType === "Customer" ? "customer" : "lead"}. Change any color above and press Generate again to try another look.
              </p>
              {/* Before / After comparison grid */}
              <div className="space-y-3">
                {lastResult.photos.map((url, idx) => (
                  <div key={idx} className="grid grid-cols-2 gap-2">
                    {/* BEFORE */}
                    <div className="rounded-lg overflow-hidden border bg-gray-100">
                      <div className="text-xs font-bold text-center py-1 bg-gray-200 text-gray-500 tracking-wider">BEFORE</div>
                      {photos[idx]?.preview ? (
                        <img
                          src={photos[idx].preview}
                          alt={`Original photo ${idx + 1}`}
                          className="w-full object-cover"
                          style={{ maxHeight: 300 }}
                        />
                      ) : (
                        <div className="flex items-center justify-center h-32 text-gray-400 text-xs px-2 text-center">
                          Original not available
                        </div>
                      )}
                    </div>
                    {/* AFTER */}
                    <div
                      className="rounded-lg overflow-hidden border bg-gray-50 relative group cursor-zoom-in"
                      onClick={() => { setZoomedUrl(url); setZoomLevel(1); }}
                    >
                      <div className="text-xs font-bold text-center py-1 bg-purple-100 text-purple-700 tracking-wider truncate px-1">
                        AFTER{lastResult.label ? `: ${lastResult.label}` : ""}
                      </div>
                      <img
                        src={url}
                        alt={`Generated view ${idx + 1}`}
                        className="w-full object-cover"
                        style={{ maxHeight: 300 }}
                        data-testid={`last-result-photo-${idx}`}
                      />
                      <div className="absolute top-7 inset-x-0 bottom-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                        <ZoomIn className="w-6 h-6 text-white drop-shadow" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Button
          onClick={handleGenerate}
          disabled={generating || !photos.length}
          className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 h-12 text-base font-semibold"
          data-testid="generate-visualization-btn"
        >
          {generating ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Generating {photos.length} photo{photos.length > 1 ? "s" : ""}… this may take up to a minute
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5 mr-2" />
              {lastResult ? "Regenerate With These Colors" : "Generate Color Visualization"}
            </>
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Palette className="w-5 h-5 text-purple-500" /> Color Visualizer
          </h2>
          <p className="text-sm text-gray-500">
            AI-generated house color previews saved to this {entityType === "Customer" ? "customer" : "lead"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedViz.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setShowShareDialog(true)}
              data-testid="share-visualization-btn"
              title="Share color previews with your customer"
            >
              <Share2 className="w-4 h-4 mr-2" />
              Share
            </Button>
          )}
          <Button
            onClick={() => { setView("generate"); setLastResult(null); }}
            className="bg-purple-600 hover:bg-purple-700"
            data-testid="new-visualization-btn"
          >
            <Plus className="w-4 h-4 mr-2" /> New Visualization
          </Button>
        </div>
      </div>

      {zoomOverlay}

      {/* Share dialog — copy link, email, or SMS to the customer */}
      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="w-4 h-4 text-purple-500" /> Share Color Previews
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500 mb-1">
            Send your customer a link where they can view saved previews and try additional color combinations on their own.
          </p>
          <div className="space-y-2 mt-2">
            <Button
              className="w-full justify-start"
              variant="outline"
              onClick={() => { setShowShareDialog(false); handleShare(); }}
              disabled={sharing}
            >
              {sharing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> :
               copied  ? <Check className="w-4 h-4 mr-2 text-green-500" /> :
                         <Copy  className="w-4 h-4 mr-2" />}
              {copied ? "Link copied!" : "Copy link to clipboard"}
            </Button>
            <Button
              className="w-full justify-start"
              variant="outline"
              onClick={() => handleShareVia("email")}
              disabled={!!sendingVia}
            >
              {sendingVia === "email"
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Mail className="w-4 h-4 mr-2" />}
              Email to customer
            </Button>
            <Button
              className="w-full justify-start"
              variant="outline"
              onClick={() => handleShareVia("sms")}
              disabled={!!sendingVia}
            >
              {sendingVia === "sms"
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <MessageSquare className="w-4 h-4 mr-2" />}
              SMS to customer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {savedViz.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-purple-100 flex items-center justify-center mx-auto mb-4">
              <Palette className="w-8 h-8 text-purple-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-700 mb-2">No color visualizations yet</h3>
            <p className="text-gray-500 mb-6 max-w-sm mx-auto">
              Upload a photo of the house, choose paint colors, and let the AI show what it could look like — all saved here.
            </p>
            <Button
              onClick={() => { setView("generate"); setLastResult(null); }}
              className="bg-purple-600 hover:bg-purple-700"
              data-testid="start-first-viz-btn"
            >
              <Sparkles className="w-4 h-4 mr-2" /> Create First Visualization
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {savedViz.map(viz => (
            <Card key={viz.id} className="overflow-hidden border">
              <div className="flex items-start justify-between px-5 py-3 bg-gray-50 border-b">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800">{viz.label}</p>
                    {viz.source === "homeowner" && (
                      <Badge className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-100">Customer pick</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {viz.color_scheme?.siding && (
                      <button onClick={() => loadVizForEdit(viz, "cviz-siding")} title="Click to tweak this color">
                        <Badge variant="outline" className="text-xs font-normal cursor-pointer hover:border-purple-400 hover:bg-purple-50 hover:text-purple-700 transition-colors">
                          Siding: {viz.color_scheme.siding}
                          {viz.color_scheme.sidingMaterial && viz.color_scheme.sidingMaterial !== "vinyl"
                            ? ` (${SIDING_MATERIALS.find(m => m.id === viz.color_scheme.sidingMaterial)?.label || viz.color_scheme.sidingMaterial})`
                            : ""}
                        </Badge>
                      </button>
                    )}
                    {viz.color_scheme?.trim && (
                      <button onClick={() => loadVizForEdit(viz, "cviz-trim")} title="Click to tweak this color">
                        <Badge variant="outline" className="text-xs font-normal cursor-pointer hover:border-purple-400 hover:bg-purple-50 hover:text-purple-700 transition-colors">Trim: {viz.color_scheme.trim}</Badge>
                      </button>
                    )}
                    {viz.color_scheme?.soffit && viz.color_scheme.soffit !== "Match Trim" && (
                      <button onClick={() => loadVizForEdit(viz, "cviz-soffit")} title="Click to tweak this color">
                        <Badge variant="outline" className="text-xs font-normal cursor-pointer hover:border-purple-400 hover:bg-purple-50 hover:text-purple-700 transition-colors">Soffit: {viz.color_scheme.soffit}</Badge>
                      </button>
                    )}
                    {viz.color_scheme?.shutters && viz.color_scheme.shutters !== "None" && (
                      <button onClick={() => loadVizForEdit(viz, "cviz-shutters")} title="Click to tweak this color">
                        <Badge variant="outline" className="text-xs font-normal cursor-pointer hover:border-purple-400 hover:bg-purple-50 hover:text-purple-700 transition-colors">Shutters: {viz.color_scheme.shutters}</Badge>
                      </button>
                    )}
                    {viz.color_scheme?.frontDoor && !/none/i.test(viz.color_scheme.frontDoor) && (
                      <button onClick={() => loadVizForEdit(viz, "cviz-front-door")} title="Click to tweak this color">
                        <Badge variant="outline" className="text-xs font-normal cursor-pointer hover:border-purple-400 hover:bg-purple-50 hover:text-purple-700 transition-colors">Front Door: {viz.color_scheme.frontDoor}</Badge>
                      </button>
                    )}
                    {viz.color_scheme?.garageDoor && !/none/i.test(viz.color_scheme.garageDoor) && (
                      <button onClick={() => loadVizForEdit(viz, "cviz-garage")} title="Click to tweak this color">
                        <Badge variant="outline" className="text-xs font-normal cursor-pointer hover:border-purple-400 hover:bg-purple-50 hover:text-purple-700 transition-colors">Garage Door: {viz.color_scheme.garageDoor}</Badge>
                      </button>
                    )}
                    {viz.color_scheme?.awnings && !/none/i.test(viz.color_scheme.awnings) && (
                      <button onClick={() => loadVizForEdit(viz, "cviz-awnings")} title="Click to tweak this color">
                        <Badge variant="outline" className="text-xs font-normal cursor-pointer hover:border-purple-400 hover:bg-purple-50 hover:text-purple-700 transition-colors">Awnings: {viz.color_scheme.awnings}</Badge>
                      </button>
                    )}
                    {viz.color_scheme?.cornerPosts && (
                      <button onClick={() => loadVizForEdit(viz, "cviz-corner-posts")} title="Click to tweak this color">
                        <Badge variant="outline" className="text-xs font-normal cursor-pointer hover:border-purple-400 hover:bg-purple-50 hover:text-purple-700 transition-colors">Corner Posts: {viz.color_scheme.cornerPosts}</Badge>
                      </button>
                    )}
                    {viz.color_scheme?.roof && (
                      <button onClick={() => loadVizForEdit(viz, "cviz-roof")} title="Click to tweak this color">
                        <Badge variant="outline" className="text-xs font-normal cursor-pointer hover:border-purple-400 hover:bg-purple-50 hover:text-purple-700 transition-colors">Roof: {viz.color_scheme.roof}</Badge>
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-purple-500 mt-1.5 italic">Click any color above to tweak &amp; regenerate</p>
                  {viz.created_at && (
                    <p className="text-xs text-gray-400 mt-1">
                      {format(new Date(viz.created_at), "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {viz.photos?.[0] && (
                    <a href={viz.photos[0]} download target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="icon" title="Download first image" data-testid={`download-viz-${viz.id}`}>
                        <Download className="w-4 h-4" />
                      </Button>
                    </a>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-red-500 hover:bg-red-50 hover:text-red-600"
                    onClick={() => handleDelete(viz.id)}
                    disabled={deletingId === viz.id}
                    title="Delete"
                    data-testid={`delete-viz-${viz.id}`}
                  >
                    {deletingId === viz.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-5">
                {(viz.photos || []).map((url, idx) => (
                  <div key={idx} className="rounded-lg overflow-hidden border bg-gray-50 relative group cursor-zoom-in"
                    onClick={() => { setZoomedUrl(url); setZoomLevel(1); }}
                  >
                    <img
                      src={url}
                      alt={`${viz.label} — view ${idx + 1}`}
                      className="w-full object-cover"
                      style={{ maxHeight: 460 }}
                      data-testid={`viz-photo-${viz.id}-${idx}`}
                    />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                      <ZoomIn className="w-8 h-8 text-white drop-shadow" />
                    </div>
                    <p className="text-xs text-center text-gray-400 py-1.5 bg-purple-50/60 truncate px-1">
                      AFTER: {viz.label} — view {idx + 1}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ColorVisualizerDialog({ open, onClose, entity, entityType, companyId, queryKey }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">Color Visualizer</DialogTitle>
        </DialogHeader>
        <ColorVisualizerPanel
          entity={entity}
          entityType={entityType}
          companyId={companyId}
          queryKey={queryKey}
        />
      </DialogContent>
    </Dialog>
  );
}
