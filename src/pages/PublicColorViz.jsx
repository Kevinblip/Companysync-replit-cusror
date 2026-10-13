import React, { useEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Palette, Download, AlertCircle, Loader2, Sparkles, Upload, Check, X, ZoomIn, ZoomOut } from "lucide-react";
import { format } from "date-fns";
import { base44 } from "@/api/base44Client";
import {
  SIDING_COLORS,
  SHUTTER_COLORS,
  ROOF_COLORS,
  GARAGE_DOOR_COLORS,
  AWNING_COLORS,
  BUILT_IN_SIDING_BRANDS,
  BUILT_IN_ROOF_BRANDS,
  getColorsForBrand,
  getRoofColorsForBrand,
  ColorSection,
  MaterialTypeSelector,
  BrandSelector,
  CornerPostStyleSelector,
  compressPhoto,
  urlToBase64,
  hexForColorName,
} from "@/components/visualizer/colorOptions";

// base44.functions.invoke wraps success as { data: handlerResult } and returns
// { error, data:{} } on server crashes — unwrap consistently.
const unwrapInvoke = (raw) => (raw?.error ? raw : (raw?.data ?? raw));

export default function PublicColorViz() {
  const [params] = useSearchParams();
  const id = params.get("id");
  const type = params.get("type") || "Customer";
  const t = params.get("t");

  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [visualizations, setVisualizations] = useState([]);
  const [usesRemaining, setUsesRemaining] = useState(0);
  const [sourcePhoto, setSourcePhoto] = useState(null);
  const [ownPhoto, setOwnPhoto] = useState(null);
  const [colorScheme, setColorScheme] = useState({
    siding: "Night Gray",
    sidingMaterial: "vinyl",
    sidingBrand: "generic",
    trim: "Bright White",
    soffit: "Bright White",
    shutters: "Black",
    garageDoor: "None (leave as-is)",
    awnings: "None (leave as-is)",
    roof: "Charcoal",
    roofBrand: "generic",
    cornerPosts: "White",
    cornerPostStyle: "standard",
  });
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState(null);
  const [customPalettes, setCustomPalettes] = useState([]);
  const [zoomedUrl, setZoomedUrl] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const fileInputRef = useRef();

  const allSidingBrands = [
    ...BUILT_IN_SIDING_BRANDS,
    ...customPalettes.filter(p => p.section === "siding").map(p => ({ id: p.id, label: p.label })),
  ];
  const allRoofBrands = [
    ...BUILT_IN_ROOF_BRANDS,
    ...customPalettes.filter(p => p.section === "roof").map(p => ({ id: p.id, label: p.label })),
  ];
  const activeSidingColors = colorScheme.sidingBrand !== "generic"
    ? (getColorsForBrand(colorScheme.sidingBrand, customPalettes) || SIDING_COLORS)
    : SIDING_COLORS;
  // Corner posts: "Match Siding" + "White" + full active siding palette
  const activeCornerPostColors = [
    { name: "Match Siding", hex: null, matchSiding: true },
    { name: "White", hex: "#FFFFFF" },
    ...activeSidingColors,
  ];
  // Trim/fascia: key neutrals pinned first, then full active siding palette
  const activeTrimColors = [
    { name: "Bright White", hex: "#FFFFFF" },
    { name: "Antique White", hex: "#FAEBD7" },
    { name: "Alabaster", hex: "#F2EDE4" },
    { name: "Light Gray", hex: "#D3D3D3" },
    { name: "Charcoal", hex: "#4A4A4A" },
    { name: "Black", hex: "#1A1A1A" },
    ...activeSidingColors,
  ];
  // Soffit: "None" first, then standard neutrals, then full active siding palette
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
  const sidingHex = hexForColorName(activeSidingColors, colorScheme.siding);
  const trimHex = hexForColorName(activeTrimColors, colorScheme.trim);

  useEffect(() => {
    if (!id || !t) {
      setState({ loading: false, error: "Invalid link — please ask your contractor for a fresh link.", data: null });
      return;
    }
    fetch(`/api/public/color-viz?id=${encodeURIComponent(id)}&type=${encodeURIComponent(type)}&t=${encodeURIComponent(t)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) throw new Error(d.error || "Could not load");
        setState({ loading: false, error: null, data: d });
        setVisualizations(d.visualizations || []);
        setUsesRemaining(typeof d.usesRemaining === "number" ? d.usesRemaining : 0);
        setSourcePhoto(d.sourcePhoto || null);
      })
      .catch(err => setState({ loading: false, error: err.message, data: null }));
  }, [id, type, t]);

  const handleOwnPhoto = async (e) => {
    const file = (e.target.files || [])[0];
    e.target.value = "";
    if (!file) return;
    const compressed = await compressPhoto(file);
    if (compressed) setOwnPhoto(compressed);
  };

  const handleGenerate = async () => {
    setNotice(null);
    if (usesRemaining <= 0) {
      setNotice({ type: "error", text: "You've used all your preview tries for this link. Contact your contractor for more." });
      return;
    }
    setGenerating(true);
    try {
      // Prefer the homeowner's own upload; otherwise re-use the contractor's stored source photo.
      let photo = null;
      if (ownPhoto?.base64) {
        photo = { base64: ownPhoto.base64, mimeType: ownPhoto.mimeType };
      } else if (sourcePhoto) {
        photo = await urlToBase64(sourcePhoto);
      }
      if (!photo?.base64) {
        setNotice({ type: "error", text: "Please upload a photo of your house to generate a preview." });
        setGenerating(false);
        return;
      }
      const raw = await base44.functions.invoke("generateColorVisualizationPublic", {
        entityId: id,
        entityType: type,
        colorScheme,
        photo: { base64: photo.base64, mimeType: photo.mimeType },
        t,
      });
      const result = unwrapInvoke(raw);
      if (typeof result?.usesRemaining === "number") setUsesRemaining(result.usesRemaining);
      if (result?.success && result.record) {
        setVisualizations(prev => [result.record, ...prev]);
        setNotice({ type: "success", text: "Here's your new preview! Scroll down to see it." });
      } else {
        setNotice({ type: "error", text: result?.error || "Couldn't generate that preview. Please try again." });
      }
    } catch (err) {
      setNotice({ type: "error", text: err.message || "Something went wrong. Please try again." });
    } finally {
      setGenerating(false);
    }
  };

  if (state.loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-purple-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Loading your color options…</p>
        </div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Link Unavailable</h2>
          <p className="text-gray-500 text-sm">{state.error}</p>
        </div>
      </div>
    );
  }

  const { name, companyName } = state.data;
  const canGenerate = !generating && usesRemaining > 0 && (ownPhoto || sourcePhoto);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50">
      {zoomedUrl && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90"
          onClick={() => setZoomedUrl(null)}
        >
          <div className="absolute top-4 right-4 flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setZoomLevel(z => Math.max(1, +(z - 0.5).toFixed(1)))}
              className="bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-colors"
              title="Zoom out"
            ><ZoomOut className="w-5 h-5" /></button>
            <span className="text-white text-sm font-medium w-12 text-center">{Math.round(zoomLevel * 100)}%</span>
            <button
              onClick={() => setZoomLevel(z => Math.min(4, +(z + 0.5).toFixed(1)))}
              className="bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-colors"
              title="Zoom in"
            ><ZoomIn className="w-5 h-5" /></button>
            <button
              onClick={() => setZoomedUrl(null)}
              className="bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-colors ml-2"
              title="Close"
            ><X className="w-5 h-5" /></button>
          </div>
          <div className="overflow-auto max-w-[95vw] max-h-[90vh] flex items-center justify-center" onClick={e => e.stopPropagation()}>
            <img
              src={zoomedUrl}
              alt="Zoomed view"
              style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center', transition: 'transform 0.2s', maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain' }}
            />
          </div>
          <p className="text-white/50 text-xs mt-4">Tap outside or × to close</p>
        </div>
      )}
      <div className="max-w-2xl mx-auto px-4 py-10 pb-20">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-full text-sm font-semibold mb-5">
            <Palette className="w-4 h-4" />
            Color Visualizer
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{companyName}</h1>
          <p className="text-gray-500 text-base">Color ideas prepared for <strong>{name}</strong></p>
        </div>

        {/* Interactive picker */}
        <div className="bg-white border border-purple-100 rounded-2xl shadow-sm overflow-hidden mb-8">
          <div className="px-6 py-4 border-b bg-purple-50/60">
            <h2 className="font-bold text-gray-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-500" /> Try your own colors
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Pick colors below and we'll show you what your home could look like.
            </p>
          </div>

          <div className="p-3 sm:p-6 space-y-6">
            {/* Photo source */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Your house photo</p>
              <div className="flex items-center gap-4">
                {(ownPhoto?.preview || sourcePhoto) && (
                  <img
                    src={ownPhoto?.preview || sourcePhoto}
                    alt="Your house"
                    className="w-24 h-24 object-cover rounded-lg border"
                    data-testid="source-photo-preview"
                  />
                )}
                <div className="flex-1">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg px-3 py-2 transition-colors"
                    data-testid="upload-own-photo-btn"
                  >
                    <Upload className="w-4 h-4" />
                    {ownPhoto ? "Use a different photo" : sourcePhoto ? "Use my own photo instead" : "Upload a photo"}
                  </button>
                  <p className="text-xs text-gray-400 mt-1">
                    {sourcePhoto && !ownPhoto
                      ? "We'll use the photo your contractor uploaded — or upload your own."
                      : "A clear, straight-on photo of the front of your house works best."}
                  </p>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleOwnPhoto}
                data-testid="own-photo-input"
              />
            </div>

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
            <ColorSection
              label="Trim & Fascia"
              colors={activeTrimColors}
              value={colorScheme.trim}
              onChange={v => setColorScheme(s => ({ ...s, trim: v }))}
            />
            <ColorSection
              label="Soffit (eave underside)"
              colors={activeSoffitColors}
              value={colorScheme.soffit || "Bright White"}
              onChange={v => setColorScheme(s => ({ ...s, soffit: v }))}
              sidingHex={sidingHex}
              trimHex={trimHex}
            />
            <ColorSection
              label="Shutters"
              colors={SHUTTER_COLORS}
              value={colorScheme.shutters}
              onChange={v => setColorScheme(s => ({ ...s, shutters: v }))}
            />
            <ColorSection
              label="Corner Posts"
              colors={activeCornerPostColors}
              value={colorScheme.cornerPosts}
              onChange={v => setColorScheme(s => ({ ...s, cornerPosts: v }))}
              sidingHex={sidingHex}
            />
            <ColorSection
              label="Garage Door"
              colors={GARAGE_DOOR_COLORS}
              value={colorScheme.garageDoor || "None (leave as-is)"}
              onChange={v => setColorScheme(s => ({ ...s, garageDoor: v }))}
              sidingHex={sidingHex}
            />
            <ColorSection
              label="Awnings"
              colors={AWNING_COLORS}
              value={colorScheme.awnings || "None (leave as-is)"}
              onChange={v => setColorScheme(s => ({ ...s, awnings: v }))}
              sidingHex={sidingHex}
              trimHex={trimHex}
            />
            <CornerPostStyleSelector
              value={colorScheme.cornerPostStyle}
              onChange={v => setColorScheme(s => ({ ...s, cornerPostStyle: v }))}
            />
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

            {notice && (
              <div
                className={`rounded-lg px-4 py-3 text-sm flex items-start gap-2 ${
                  notice.type === "success"
                    ? "bg-green-50 border border-green-200 text-green-800"
                    : "bg-red-50 border border-red-200 text-red-700"
                }`}
                data-testid="generate-notice"
              >
                {notice.type === "success" ? <Check className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                <span>{notice.text}</span>
              </div>
            )}

            <div>
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="w-full h-12 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:from-purple-700 hover:to-blue-700 transition-colors"
                data-testid="homeowner-generate-btn"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Generating… this can take up to a minute
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Generate My Preview
                  </>
                )}
              </button>
              <p className="text-center text-xs text-gray-400 mt-2" data-testid="uses-remaining">
                {usesRemaining > 0
                  ? `${usesRemaining} preview ${usesRemaining === 1 ? "try" : "tries"} left`
                  : "You've used all your preview tries for this link."}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-purple-100 rounded-2xl px-6 py-4 mb-8 text-center shadow-sm">
          <p className="text-gray-700 text-sm leading-relaxed">
            Found a look you love? Let us know which you prefer — give us a call or text us back!
          </p>
        </div>

        {visualizations.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-12 text-center border">
            <Palette className="w-12 h-12 text-purple-200 mx-auto mb-4" />
            <p className="text-gray-400">No previews yet — pick some colors above to create your first one.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {visualizations.map((viz, idx) => (
              <div key={viz.id || idx} className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <div className="px-5 py-4 border-b bg-gray-50">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-gray-900 text-lg">Option {visualizations.length - idx}</p>
                        {viz.source === "homeowner" && (
                          <span className="inline-block bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 text-xs font-medium">Your pick</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {viz.color_scheme?.siding && (
                          <span className="inline-block bg-white border border-gray-200 text-gray-700 rounded-full px-2.5 py-0.5 text-xs font-medium">
                            Siding: {viz.color_scheme.siding}
                          </span>
                        )}
                        {viz.color_scheme?.trim && (
                          <span className="inline-block bg-white border border-gray-200 text-gray-700 rounded-full px-2.5 py-0.5 text-xs font-medium">
                            Trim: {viz.color_scheme.trim}
                          </span>
                        )}
                        {viz.color_scheme?.shutters && viz.color_scheme.shutters !== "None" && (
                          <span className="inline-block bg-white border border-gray-200 text-gray-700 rounded-full px-2.5 py-0.5 text-xs font-medium">
                            Shutters: {viz.color_scheme.shutters}
                          </span>
                        )}
                        {viz.color_scheme?.cornerPosts && (
                          <span className="inline-block bg-white border border-gray-200 text-gray-700 rounded-full px-2.5 py-0.5 text-xs font-medium">
                            Corner Posts: {viz.color_scheme.cornerPosts}
                          </span>
                        )}
                        {viz.color_scheme?.roof && (
                          <span className="inline-block bg-white border border-gray-200 text-gray-700 rounded-full px-2.5 py-0.5 text-xs font-medium">
                            Roof: {viz.color_scheme.roof}
                          </span>
                        )}
                      </div>
                      {viz.created_at && (
                        <p className="text-xs text-gray-400 mt-1">
                          {format(new Date(viz.created_at), "MMMM d, yyyy")}
                        </p>
                      )}
                    </div>
                    {viz.photos?.[0] && (
                      <a
                        href={viz.photos[0]}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 flex items-center gap-1.5 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Save
                      </a>
                    )}
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  {(viz.photos || []).map((url, pIdx) => (
                    <div key={pIdx} className="rounded-xl overflow-hidden border bg-gray-50 relative group cursor-zoom-in"
                      onClick={() => { setZoomedUrl(url); setZoomLevel(1); }}
                    >
                      <img
                        src={url}
                        alt={`${viz.label} — view ${pIdx + 1}`}
                        className="w-full object-cover"
                        style={{ maxHeight: 420 }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                        <ZoomIn className="w-10 h-10 text-white drop-shadow" />
                      </div>
                      <p className="text-xs text-center text-gray-400 py-2">Tap to zoom</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-center text-xs text-gray-300 mt-12">Powered by CompanySync</p>
      </div>
    </div>
  );
}
