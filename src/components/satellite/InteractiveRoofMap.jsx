import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Undo, Trash2, Save, ArrowLeft, Pencil, Ruler, Plus, X,
  Home, CheckCircle2, Sparkles, Camera, Loader2, ChevronDown, ChevronUp,
  Layers, AlertTriangle
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import StreetViewPanel from "./StreetViewPanel";

const SECTION_COLORS = [
  { fill: '#3b82f6', stroke: '#1d4ed8', label: 'blue' },
  { fill: '#f97316', stroke: '#ea580c', label: 'orange' },
  { fill: '#10b981', stroke: '#059669', label: 'green' },
  { fill: '#8b5cf6', stroke: '#7c3aed', label: 'purple' },
  { fill: '#ec4899', stroke: '#db2777', label: 'pink' },
  { fill: '#14b8a6', stroke: '#0d9488', label: 'teal' },
];

const QUICK_SECTION_NAMES = ['Dormer', 'Garage', 'Addition', 'Porch', 'Extension'];

const LINE_COLORS = {
  ridge: '#9333ea',
  valley: '#10b981',
  rake: '#f97316',
  eave: '#ef4444',
  hip: '#3b82f6',
  step_flashing: '#ec4899'
};

const LINE_STROKE_WEIGHT = 9;
const POLYGON_STROKE_WEIGHT = 3;

export default function InteractiveRoofMap({
  latitude, longitude, address, onMeasurementsComplete, onBack, googleMapsLoaded,
  crewCamPhotoCount = 0
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const drawingManagerRef = useRef(null);
  const [drawingManager, setDrawingManager] = useState(null);
  const [currentTool, setCurrentTool] = useState(null);
  const currentToolRef = useRef(null);

  // ─── DAMAGE LAYER STATE ───
  const [damageLayerOn, setDamageLayerOn] = useState(false);
  const [damageMode, setDamageMode] = useState('hail'); // 'hail' | 'wind'
  const [damageMarkers, setDamageMarkers] = useState([]);
  const damageModeActiveRef = useRef(false); // tracks whether overlay is ON
  const damageModeTypeRef = useRef('hail');  // tracks hail vs wind
  const damagePinsRef = useRef([]);          // Google Maps marker objects
  const crewCamMarkerRef = useRef(null);     // single camera icon marker
  const [features, setFeatures] = useState([]);
  const [sectionPolygons, setSectionPolygons] = useState({});
  const sectionPolygonsRef = useRef({});
  const [pitch, setPitch] = useState("7/12");
  const [sections, setSections] = useState([{ id: 1, name: "Main Roof" }]);
  const [activeSectionId, setActiveSectionId] = useState(1);
  const activeSectionIdRef = useRef(1);
  const [editingSectionName, setEditingSectionName] = useState(null);
  const [includeGutters, setIncludeGutters] = useState(false);
  const [gutterLF, setGutterLF] = useState(0);
  const [downspoutCount, setDownspoutCount] = useState(0);

  // AI line detection
  const [isAIDetecting, setIsAIDetecting] = useState(false);
  const [aiDetectionNote, setAIDetectionNote] = useState(null);
  const [mapReady, setMapReady] = useState(false);

  // Street View
  const [streetViewImages, setStreetViewImages] = useState([]);
  const [isLoadingStreetView, setIsLoadingStreetView] = useState(false);
  const [streetViewOpen, setStreetViewOpen] = useState(false);

  // Heading/tilt status for compass overlay
  const [headingStatus, setHeadingStatus] = useState('Top-down · N');

  useEffect(() => { currentToolRef.current = currentTool; }, [currentTool]);
  useEffect(() => { activeSectionIdRef.current = activeSectionId; }, [activeSectionId]);
  useEffect(() => { sectionPolygonsRef.current = sectionPolygons; }, [sectionPolygons]);
  useEffect(() => { damageModeActiveRef.current = damageLayerOn; }, [damageLayerOn]);
  useEffect(() => { damageModeTypeRef.current = damageMode; }, [damageMode]);

  // Auto-detect and draw AI lines once map is ready
  useEffect(() => {
    if (!mapReady) return;
    handleAIDetectLines();
  }, [mapReady]);

  // Initialize Google Map
  useEffect(() => {
    if (!googleMapsLoaded || !mapRef.current || mapInstanceRef.current) return;
    if (typeof window === 'undefined' || !window.google) return;
    if (!window.google.maps || !window.google.maps.drawing) return;

    const mapInstance = new window.google.maps.Map(mapRef.current, {
      center: { lat: latitude, lng: longitude },
      zoom: 20,
      mapTypeId: 'satellite',
      tilt: 0,
      rotateControl: true,
      zoomControl: true,
      fullscreenControl: true,
      streetViewControl: false,
      gestureHandling: 'greedy',
    });

    const updateHeadingStatus = () => {
      const h = mapInstance.getHeading() || 0;
      const dirs = ["N","NE","E","SE","S","SW","W","NW"];
      const dir = dirs[Math.round(h / 45) % 8];
      const tilted = mapInstance.getTilt() > 0;
      setHeadingStatus(tilted ? `45° · ${dir}` : `Top-down · ${dir}`);
    };
    mapInstance.addListener('heading_changed', updateHeadingStatus);
    mapInstance.addListener('tilt_changed', updateHeadingStatus);

    const manager = new window.google.maps.drawing.DrawingManager({
      drawingMode: null,
      drawingControl: false,
      polygonOptions: {
        fillOpacity: 0.2,
        strokeWeight: POLYGON_STROKE_WEIGHT,
        editable: true,
        draggable: false,
      },
      polylineOptions: {
        strokeWeight: LINE_STROKE_WEIGHT,
        editable: true,
        draggable: false,
      }
    });

    manager.setMap(mapInstance);
    mapInstanceRef.current = mapInstance;
    drawingManagerRef.current = manager;
    setDrawingManager(manager);

    window.google.maps.event.addListener(manager, 'polygoncomplete', (polygon) => {
      manager.setDrawingMode(null);
      setCurrentTool(null);
      currentToolRef.current = null;
      const sId = activeSectionIdRef.current;
      const sIdx = sections.findIndex(s => s.id === sId);
      const color = SECTION_COLORS[(sIdx >= 0 ? sIdx : 0) % SECTION_COLORS.length];
      const existing = sectionPolygonsRef.current[sId];
      if (existing) existing.setMap(null);
      polygon.setOptions({ fillColor: color.fill, strokeColor: color.stroke, fillOpacity: 0.2, strokeWeight: POLYGON_STROKE_WEIGHT });
      sectionPolygonsRef.current = { ...sectionPolygonsRef.current, [sId]: polygon };
      setSectionPolygons(prev => ({ ...prev, [sId]: polygon }));
    });

    window.google.maps.event.addListener(manager, 'polylinecomplete', (polyline) => {
      manager.setDrawingMode(null);
      const toolType = currentToolRef.current;
      const sectionId = activeSectionIdRef.current;
      polyline.setOptions({ strokeColor: LINE_COLORS[toolType] || '#000', strokeWeight: LINE_STROKE_WEIGHT });
      setFeatures(prev => [...prev, { id: Date.now(), type: toolType, polyline, sectionId, color: LINE_COLORS[toolType] }]);
      setCurrentTool(null);
      currentToolRef.current = null;
    });

    // ─── DAMAGE LAYER: drop a pin on map click ───
    window.google.maps.event.addListener(mapInstance, 'click', (e) => {
      if (!damageModeActiveRef.current) return;
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      const type = damageModeTypeRef.current;
      const color = type === 'hail' ? '#ef4444' : '#3b82f6';
      const label = type === 'hail' ? '🧊' : '💨';
      const pin = new window.google.maps.Marker({
        position: { lat, lng },
        map: mapInstance,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: color,
          fillOpacity: 0.9,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
        title: type === 'hail' ? '🧊 Hail Damage' : '💨 Wind Damage',
        zIndex: 999,
      });
      damagePinsRef.current.push({ marker: pin, type });
      setDamageMarkers(prev => [...prev, { id: Date.now() + Math.random(), lat, lng, type }]);
    });

    // Once tiles load (bounds are available), trigger AI auto-draw
    window.google.maps.event.addListenerOnce(mapInstance, 'tilesloaded', () => {
      setMapReady(true);
    });
  }, [googleMapsLoaded, latitude, longitude]);

  const getSectionIndex = (sId) => Math.max(0, sections.findIndex(s => s.id === sId));
  const getSectionColor = (sId) => SECTION_COLORS[getSectionIndex(sId) % SECTION_COLORS.length];
  const getActiveSection = () => sections.find(s => s.id === activeSectionId);

  const calculatePolygonArea = (polygon) => {
    if (!polygon || typeof window === 'undefined' || !window.google) return 0;
    return window.google.maps.geometry.spherical.computeArea(polygon.getPath()) * 10.7639;
  };

  const calculateLineLength = (polyline) => {
    if (typeof window === 'undefined' || !window.google) return 0;
    return window.google.maps.geometry.spherical.computeLength(polyline.getPath()) * 3.28084;
  };

  const totalSqft = Object.values(sectionPolygons).reduce((s, p) => s + calculatePolygonArea(p), 0);
  const totalSQ = totalSqft / 100;

  const getMeasurementsBySection = () => {
    const result = {};
    sections.forEach(section => {
      const sf = features.filter(f => f.sectionId === section.id);
      result[section.id] = {
        sectionName: section.name,
        ridge_lf: sf.filter(f => f.type === 'ridge').reduce((s, f) => s + calculateLineLength(f.polyline), 0),
        valley_lf: sf.filter(f => f.type === 'valley').reduce((s, f) => s + calculateLineLength(f.polyline), 0),
        rake_lf: sf.filter(f => f.type === 'rake').reduce((s, f) => s + calculateLineLength(f.polyline), 0),
        eave_lf: sf.filter(f => f.type === 'eave').reduce((s, f) => s + calculateLineLength(f.polyline), 0),
        hip_lf: sf.filter(f => f.type === 'hip').reduce((s, f) => s + calculateLineLength(f.polyline), 0),
        step_flashing_lf: sf.filter(f => f.type === 'step_flashing').reduce((s, f) => s + calculateLineLength(f.polyline), 0),
      };
    });
    return result;
  };

  const sectionMeasurements = getMeasurementsBySection();
  const currentSectionMeasures = sectionMeasurements[activeSectionId] || {
    ridge_lf: 0, valley_lf: 0, rake_lf: 0, eave_lf: 0, hip_lf: 0, step_flashing_lf: 0
  };

  // ──────────────────────────────────────────
  //  AI LINE DETECTION → Draw on Google Maps
  // ──────────────────────────────────────────
  const handleAIDetectLines = async () => {
    if (!mapInstanceRef.current || typeof window === 'undefined' || !window.google) return;
    setIsAIDetecting(true);
    setAIDetectionNote(null);
    try {
      const result = await base44.functions.invoke('aiRoofMeasurement', {
        latitude, longitude, address
      });
      if (!result?.data?.success) throw new Error(result?.data?.error || 'AI detection failed');

      const detectedLines = result.data.detectedLines || {};
      const bounds = mapInstanceRef.current.getBounds();
      if (!bounds) throw new Error('Map bounds not available yet');

      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const north = ne.lat(), south = sw.lat(), east = ne.lng(), west = sw.lng();

      // Convert 0-1000 normalized image coordinates → lat/lng
      const toLat = (y) => north - (y / 1000) * (north - south);
      const toLng = (x) => west + (x / 1000) * (east - west);

      const newFeatures = [];
      let totalDrawn = 0;

      for (const [lineType, lines] of Object.entries(detectedLines)) {
        if (!LINE_COLORS[lineType] || !Array.isArray(lines) || lines.length === 0) continue;
        for (const line of lines) {
          if (line.x1 == null || line.y1 == null || line.x2 == null || line.y2 == null) continue;
          const path = [
            new window.google.maps.LatLng(toLat(line.y1), toLng(line.x1)),
            new window.google.maps.LatLng(toLat(line.y2), toLng(line.x2)),
          ];
          const polyline = new window.google.maps.Polyline({
            path,
            strokeColor: LINE_COLORS[lineType],
            strokeWeight: LINE_STROKE_WEIGHT + 1,  // slightly thicker so AI lines stand out
            strokeOpacity: 0.9,
            editable: true,
            draggable: false,
            map: mapInstanceRef.current,
          });
          newFeatures.push({ id: Date.now() + Math.random(), type: lineType, polyline, sectionId: activeSectionId, color: LINE_COLORS[lineType], aiGenerated: true });
          totalDrawn++;
        }
      }

      setFeatures(prev => [...prev, ...newFeatures]);
      setAIDetectionNote(`AI drew ${totalDrawn} lines on the map. Adjust any that don't look right.`);

      // Also set pitch from AI if available
      if (result.data.pitch) setPitch(result.data.pitch);
    } catch (e) {
      setAIDetectionNote(`AI detection failed: ${e.message}`);
    }
    setIsAIDetecting(false);
  };

  // ────────────────
  //  STREET VIEW
  // ────────────────
  const handleLoadStreetView = async () => {
    setIsLoadingStreetView(true);
    try {
      const result = await base44.functions.invoke('getStreetViewImages', { latitude, longitude, address });
      setStreetViewImages(result?.data?.images || []);
    } catch (e) {
      setStreetViewImages([{ direction: 'Error', available: false, error: e.message }]);
    }
    setIsLoadingStreetView(false);
  };

  // ─────────────────
  //  DRAWING ACTIONS
  // ─────────────────
  const handleStartDrawing = (type) => {
    if (!drawingManagerRef.current || typeof window === 'undefined' || !window.google) return;
    const mgr = drawingManagerRef.current;
    if (type === 'roof_outline') {
      const color = getSectionColor(activeSectionId);
      mgr.setOptions({ polygonOptions: { fillColor: color.fill, strokeColor: color.stroke, fillOpacity: 0.2, strokeWeight: POLYGON_STROKE_WEIGHT, editable: true, draggable: false } });
      mgr.setDrawingMode(window.google.maps.drawing.OverlayType.POLYGON);
    } else {
      mgr.setOptions({ polylineOptions: { strokeWeight: LINE_STROKE_WEIGHT, strokeColor: LINE_COLORS[type] || '#000', editable: true, draggable: false } });
      mgr.setDrawingMode(window.google.maps.drawing.OverlayType.POLYLINE);
    }
    setCurrentTool(type);
    currentToolRef.current = type;
  };

  const handleCancelDrawing = () => {
    if (!drawingManagerRef.current) return;
    drawingManagerRef.current.setDrawingMode(null);
    setCurrentTool(null);
    currentToolRef.current = null;
  };

  const clearDamagePins = () => {
    damagePinsRef.current.forEach(({ marker }) => marker.setMap(null));
    damagePinsRef.current = [];
    setDamageMarkers([]);
  };

  // ─── CrewCam: show camera icon marker at property center ───
  useEffect(() => {
    if (!mapInstanceRef.current || typeof window === 'undefined' || !window.google) return;
    if (crewCamMarkerRef.current) {
      crewCamMarkerRef.current.setMap(null);
      crewCamMarkerRef.current = null;
    }
    if (crewCamPhotoCount > 0) {
      const svgIcon = encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="16" fill="#6366f1" stroke="white" stroke-width="2"/>
          <text x="18" y="24" text-anchor="middle" font-size="16">📷</text>
        </svg>
      `);
      crewCamMarkerRef.current = new window.google.maps.Marker({
        position: { lat: latitude, lng: longitude },
        map: mapInstanceRef.current,
        icon: {
          url: `data:image/svg+xml,${svgIcon}`,
          scaledSize: new window.google.maps.Size(36, 36),
          anchor: new window.google.maps.Point(18, 18),
        },
        title: `📷 ${crewCamPhotoCount} CrewCam photo${crewCamPhotoCount !== 1 ? 's' : ''} at this property`,
        zIndex: 1000,
      });
      const infoWindow = new window.google.maps.InfoWindow({
        content: `<div style="font-size:13px;padding:4px 6px;"><strong>📷 CrewCam</strong><br/>${crewCamPhotoCount} inspection photo${crewCamPhotoCount !== 1 ? 's' : ''} at this property</div>`,
      });
      crewCamMarkerRef.current.addListener('click', () => {
        infoWindow.open(mapInstanceRef.current, crewCamMarkerRef.current);
      });
    }
  }, [crewCamPhotoCount, latitude, longitude]);

  const handleDeleteSectionPolygon = (sId) => {
    const poly = sectionPolygons[sId];
    if (poly) poly.setMap(null);
    setSectionPolygons(prev => { const n = { ...prev }; delete n[sId]; return n; });
  };

  const handleUndo = () => {
    const last = features[features.length - 1];
    if (last) { last.polyline.setMap(null); setFeatures(prev => prev.slice(0, -1)); }
  };

  const handleClearSection = (sId) => {
    handleDeleteSectionPolygon(sId);
    features.filter(f => f.sectionId === sId).forEach(f => f.polyline.setMap(null));
    setFeatures(prev => prev.filter(f => f.sectionId !== sId));
  };

  const handleClearAll = () => {
    Object.values(sectionPolygons).forEach(p => p.setMap(null));
    setSectionPolygons({});
    features.forEach(f => f.polyline.setMap(null));
    setFeatures([]);
    setAIDetectionNote(null);
  };

  const handleAddSection = (name) => {
    const newId = Math.max(...sections.map(s => s.id)) + 1;
    setSections(prev => [...prev, { id: newId, name: name || `Section ${newId}` }]);
    setActiveSectionId(newId);
    activeSectionIdRef.current = newId;
  };

  const handleRemoveSection = (sId) => {
    if (sections.length === 1) return;
    handleClearSection(sId);
    setSections(prev => prev.filter(s => s.id !== sId));
    if (activeSectionId === sId) {
      const newActive = sections.find(s => s.id !== sId)?.id || 1;
      setActiveSectionId(newActive);
      activeSectionIdRef.current = newActive;
    }
  };

  useEffect(() => {
    if (includeGutters) {
      const totalEaves = Object.values(sectionMeasurements).reduce((s, m) => s + m.eave_lf, 0);
      setGutterLF(totalEaves);
      setDownspoutCount(Math.ceil(totalEaves / 35));
    }
  }, [includeGutters, features]);

  const handleSaveMeasurements = () => {
    if (Object.keys(sectionPolygons).length === 0) {
      alert("Please draw at least one roof section outline first");
      return;
    }
    const allMeasures = Object.values(sectionMeasurements);
    onMeasurementsComplete({
      roof_area_sqft: totalSqft, roof_area_sq: totalSQ,
      ridge_lf: allMeasures.reduce((s, m) => s + m.ridge_lf, 0),
      valley_lf: allMeasures.reduce((s, m) => s + m.valley_lf, 0),
      rake_lf: allMeasures.reduce((s, m) => s + m.rake_lf, 0),
      eave_lf: allMeasures.reduce((s, m) => s + m.eave_lf, 0),
      hip_lf: allMeasures.reduce((s, m) => s + m.hip_lf, 0),
      step_flashing_lf: allMeasures.reduce((s, m) => s + m.step_flashing_lf, 0),
      pitch, sections: sections.map(s => ({
        id: s.id, name: s.name,
        area_sqft: calculatePolygonArea(sectionPolygons[s.id] || null),
        measurements: sectionMeasurements[s.id]
      })),
      gutter_lf: includeGutters ? gutterLF : 0,
      downspout_count: includeGutters ? downspoutCount : 0
    });
  };

  const usedQuickNames = sections.map(s => s.name);
  const availableQuickNames = QUICK_SECTION_NAMES.filter(n => !usedQuickNames.includes(n));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Pencil className="w-5 h-5 text-blue-600" />
          Manual Drawing Mode
        </h3>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-sm text-blue-800 font-medium">📍 {address}</p>
        <p className="text-xs text-blue-600 mt-1">
          Draw each roof section separately — main roof, dormers, garage, additions. Each gets its own color.
        </p>
      </div>

      {/* ─── STREET VIEW ─── */}
      <Card className="border-indigo-200">
        <button
          className="w-full flex items-center justify-between p-4 text-left"
          onClick={() => { setStreetViewOpen(o => !o); if (!streetViewOpen && streetViewImages.length === 0) handleLoadStreetView(); }}
          data-testid="btn-street-view-toggle"
        >
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-indigo-600" />
            <span className="font-semibold text-sm text-indigo-900">Street View — 4 Sides of the House</span>
            <span className="text-xs text-indigo-500">Helps confirm pitch and roof layout</span>
          </div>
          {streetViewOpen ? <ChevronUp className="w-4 h-4 text-indigo-400" /> : <ChevronDown className="w-4 h-4 text-indigo-400" />}
        </button>

        {streetViewOpen && (
          <CardContent className="pt-0 pb-4">
            <StreetViewPanel
              latitude={latitude}
              longitude={longitude}
              address={address}
              googleMapsLoaded={googleMapsLoaded}
            />
          </CardContent>
        )}
      </Card>

      {/* ─── SECTIONS ─── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Home className="w-4 h-4" /> Roof Sections
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="flex flex-wrap gap-2">
            {sections.map((section, idx) => {
              const color = SECTION_COLORS[idx % SECTION_COLORS.length];
              const hasPoly = !!sectionPolygons[section.id];
              const isActive = activeSectionId === section.id;
              return (
                <div key={section.id} className="flex items-center gap-1">
                  {editingSectionName === section.id ? (
                    <Input
                      value={section.name}
                      onChange={(e) => setSections(prev => prev.map(s => s.id === section.id ? { ...s, name: e.target.value } : s))}
                      onBlur={() => setEditingSectionName(null)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setEditingSectionName(null); }}
                      className="w-28 h-8 text-sm" autoFocus
                    />
                  ) : (
                    <button
                      onClick={() => { setActiveSectionId(section.id); activeSectionIdRef.current = section.id; }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border-2 transition-all ${isActive ? 'text-white shadow-md' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                      style={isActive ? { backgroundColor: color.stroke, borderColor: color.stroke } : { borderColor: color.fill }}
                      data-testid={`section-tab-${section.id}`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: isActive ? 'rgba(255,255,255,0.7)' : color.fill }} />
                      {section.name}
                      {hasPoly && <CheckCircle2 className="w-3 h-3 opacity-80" />}
                    </button>
                  )}
                  <button onClick={() => setEditingSectionName(section.id)} className="p-1 rounded text-gray-400 hover:text-gray-600" title="Rename"><Pencil className="w-3 h-3" /></button>
                  {sections.length > 1 && (
                    <button onClick={() => handleRemoveSection(section.id)} className="p-1 rounded text-red-400 hover:text-red-600" title="Remove"><X className="w-3 h-3" /></button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            {availableQuickNames.slice(0, 4).map(name => (
              <Button key={name} variant="outline" size="sm" className="h-7 text-xs border-dashed" onClick={() => handleAddSection(name)} data-testid={`quick-add-${name.toLowerCase()}`}>
                <Plus className="w-3 h-3 mr-1" />{name}
              </Button>
            ))}
            <Button variant="outline" size="sm" className="h-7 text-xs border-dashed" onClick={() => handleAddSection('')} data-testid="add-custom-section">
              <Plus className="w-3 h-3 mr-1" />Custom
            </Button>
          </div>

          <p className="text-xs text-gray-500">
            Active: <strong>{getActiveSection()?.name}</strong> — outlines will be
            <span className="inline-block w-3 h-3 rounded-full mx-1 align-middle" style={{ backgroundColor: getSectionColor(activeSectionId).fill }} />
            {getSectionColor(activeSectionId).label}
          </p>
        </CardContent>
      </Card>

      {/* ─── DAMAGE LAYER CARD ─── */}
      <Card className="border-orange-200 bg-orange-50/40">
        <CardContent className="pt-3 pb-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-orange-500" />
              <span className="text-sm font-semibold text-orange-900">Damage Layer</span>
              {crewCamPhotoCount > 0 && (
                <Badge className="bg-indigo-100 text-indigo-700 border border-indigo-300 text-xs">
                  📷 {crewCamPhotoCount} Photo{crewCamPhotoCount !== 1 ? 's' : ''}
                </Badge>
              )}
            </div>
            <Switch
              checked={damageLayerOn}
              onCheckedChange={(on) => setDamageLayerOn(on)}
              data-testid="toggle-damage-layer"
            />
          </div>

          {damageLayerOn && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  onClick={() => setDamageMode('hail')}
                  className={damageMode === 'hail'
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'border border-red-300 text-red-600 bg-white hover:bg-red-50'}
                  variant={damageMode === 'hail' ? 'default' : 'outline'}
                  data-testid="btn-damage-hail"
                >
                  🧊 Hail
                </Button>
                <Button
                  size="sm"
                  onClick={() => setDamageMode('wind')}
                  className={damageMode === 'wind'
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'border border-blue-300 text-blue-600 bg-white hover:bg-blue-50'}
                  variant={damageMode === 'wind' ? 'default' : 'outline'}
                  data-testid="btn-damage-wind"
                >
                  💨 Wind
                </Button>
                {damageMarkers.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-gray-400 hover:text-red-500 ml-auto text-xs"
                    onClick={clearDamagePins}
                    data-testid="btn-clear-damage-pins"
                  >
                    <X className="w-3 h-3 mr-1" />
                    Clear all ({damageMarkers.length})
                  </Button>
                )}
              </div>
              <p className="text-xs text-orange-700">
                {damageMode === 'hail'
                  ? '🧊 Click anywhere on the map to drop a red Hail damage pin'
                  : '💨 Click anywhere on the map to drop a blue Wind damage pin'}
              </p>
              {damageMarkers.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {damageMarkers.filter(m => m.type === 'hail').length > 0 && (
                    <Badge className="bg-red-100 text-red-700 border border-red-300">
                      🧊 {damageMarkers.filter(m => m.type === 'hail').length} Hail
                    </Badge>
                  )}
                  {damageMarkers.filter(m => m.type === 'wind').length > 0 && (
                    <Badge className="bg-blue-100 text-blue-700 border border-blue-300">
                      💨 {damageMarkers.filter(m => m.type === 'wind').length} Wind
                    </Badge>
                  )}
                </div>
              )}
            </div>
          )}

          {!damageLayerOn && (
            <p className="text-xs text-orange-600">Toggle ON to drop Hail 🧊 or Wind 💨 damage pins on the map</p>
          )}
        </CardContent>
      </Card>

      {/* ─── MAP ─── */}
      <div className="relative w-full rounded-lg overflow-hidden border-2 border-gray-300 shadow-lg">
        <div ref={mapRef} className="w-full h-[440px]" />
        {/* Heading status label */}
        <div className="absolute top-3 right-16 bg-black/70 text-white text-xs px-2 py-1 rounded font-bold z-20 pointer-events-none">
          {headingStatus}
        </div>
        {/* N / E / S / W + 3D compass buttons */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex gap-1">
          {[{l:"N",h:0},{l:"E",h:90},{l:"S",h:180},{l:"W",h:270}].map(d => (
            <button
              key={d.l}
              onClick={() => {
                const m = mapInstanceRef.current;
                if (m) { m.setHeading(d.h); m.setTilt(45); }
              }}
              className="bg-indigo-600/90 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded shadow-lg"
              data-testid={`map-rotate-${d.l.toLowerCase()}`}
            >
              {d.l}
            </button>
          ))}
          <button
            onClick={() => {
              const m = mapInstanceRef.current;
              if (m) m.setTilt(m.getTilt() > 0 ? 0 : 45);
            }}
            className="bg-amber-600/90 hover:bg-amber-700 text-white text-xs font-bold px-3 py-1.5 rounded shadow-lg ml-1"
            data-testid="map-toggle-3d"
          >
            3D
          </button>
        </div>
      </div>

      {/* ─── STEP 1: Outlines ─── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">STEP 1: Draw Roof Section Outlines</CardTitle>
          <p className="text-sm text-gray-600">Select a section above, then click to trace its perimeter on the map. Click your first point to close the shape.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button
              onClick={() => currentTool === 'roof_outline' ? handleCancelDrawing() : handleStartDrawing('roof_outline')}
              variant={currentTool === 'roof_outline' ? 'default' : 'outline'}
              className="flex-1"
              style={currentTool !== 'roof_outline' ? { borderColor: getSectionColor(activeSectionId).stroke, color: getSectionColor(activeSectionId).stroke } : {}}
              data-testid="draw-roof-outline"
            >
              <Ruler className="w-4 h-4 mr-2" />
              {currentTool === 'roof_outline' ? '✏️ Drawing… (click map to place points)' : sectionPolygons[activeSectionId] ? `Redraw ${getActiveSection()?.name}` : `Draw ${getActiveSection()?.name} Outline`}
            </Button>
            {currentTool === 'roof_outline' && <Button variant="outline" size="sm" onClick={handleCancelDrawing}>Cancel</Button>}
          </div>

          {/* Section area chips */}
          <div className="flex flex-wrap gap-2">
            {sections.map((section, idx) => {
              const poly = sectionPolygons[section.id];
              if (!poly) return null;
              const sqft = calculatePolygonArea(poly);
              const color = SECTION_COLORS[idx % SECTION_COLORS.length];
              return (
                <div key={section.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm" style={{ borderColor: color.fill, backgroundColor: color.fill + '18' }}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color.fill }} />
                  <span className="font-medium">{section.name}:</span>
                  <span className="font-bold">{(sqft / 100).toFixed(2)} SQ</span>
                  <span className="text-gray-500 text-xs">({sqft.toFixed(0)} ft²)</span>
                  <button onClick={() => handleDeleteSectionPolygon(section.id)} className="ml-1 text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                </div>
              );
            })}
          </div>

          {Object.keys(sectionPolygons).length > 0 && (
            <div className="p-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg flex items-center justify-between">
              <span className="text-sm font-semibold text-blue-900">Total Roof Area:</span>
              <div className="text-right">
                <span className="text-2xl font-bold text-blue-700">{totalSQ.toFixed(2)} SQ</span>
                <span className="text-xs text-blue-500 ml-2">({totalSqft.toFixed(0)} ft²)</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── STEP 2: Linear Features + AI ─── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">STEP 2: Draw Linear Features</CardTitle>
              <p className="text-sm text-gray-600 mt-0.5">Draw lines for <strong>{getActiveSection()?.name}</strong>, or let the AI do it</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">

          {/* AI Detect Button */}
          <div className="p-3 bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-200 rounded-lg space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-600" />
              <span className="text-sm font-semibold text-violet-900">AI Line Detection</span>
            </div>
            <p className="text-xs text-violet-700">
              The AI will analyze the satellite image and automatically draw ridges, valleys, rakes, eaves, and hip lines in color on the map. You can adjust any line afterward.
            </p>
            <Button
              onClick={handleAIDetectLines}
              disabled={isAIDetecting}
              className="bg-violet-600 hover:bg-violet-700 text-white w-full"
              data-testid="btn-ai-detect-lines"
            >
              {isAIDetecting
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />AI is analyzing the roof…</>
                : <><Sparkles className="w-4 h-4 mr-2" />AI Draw Lines for Me</>
              }
            </Button>
            {aiDetectionNote && (
              <p className={`text-xs mt-1 ${aiDetectionNote.includes('failed') ? 'text-red-600' : 'text-violet-700'}`}>
                {aiDetectionNote}
              </p>
            )}
          </div>

          {/* Manual line tools */}
          <div>
            <p className="text-xs text-gray-500 mb-2 font-medium">OR draw manually:</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {['ridge', 'valley', 'rake', 'eave', 'hip', 'step_flashing'].map(type => (
                <Button
                  key={type}
                  onClick={() => currentTool === type ? handleCancelDrawing() : handleStartDrawing(type)}
                  variant={currentTool === type ? 'default' : 'outline'}
                  size="sm"
                  className="capitalize"
                  style={currentTool === type ? { backgroundColor: LINE_COLORS[type], borderColor: LINE_COLORS[type] } : { borderColor: LINE_COLORS[type], color: LINE_COLORS[type] }}
                  data-testid={`draw-${type}`}
                >
                  <div className="w-3 h-3 rounded-full mr-1.5 flex-shrink-0" style={{ backgroundColor: LINE_COLORS[type] }} />
                  {type.replace('_', ' ')}
                </Button>
              ))}
            </div>
          </div>

          {/* Line legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 border-t pt-2">
            {Object.entries(LINE_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center gap-1">
                <div className="w-5 h-1.5 rounded" style={{ backgroundColor: color }} />
                <span className="capitalize">{type.replace('_', ' ')}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button onClick={handleUndo} variant="outline" size="sm" disabled={features.length === 0}>
              <Undo className="w-4 h-4 mr-1.5" />Undo Last
            </Button>
            <Button onClick={() => handleClearSection(activeSectionId)} variant="outline" size="sm"
              disabled={!sectionPolygons[activeSectionId] && features.filter(f => f.sectionId === activeSectionId).length === 0}>
              <Trash2 className="w-4 h-4 mr-1.5" />Clear Section
            </Button>
            <Button onClick={handleClearAll} variant="outline" size="sm"
              disabled={Object.keys(sectionPolygons).length === 0 && features.length === 0}
              className="text-red-600 hover:text-red-700">
              Clear All
            </Button>
          </div>

          {features.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {sections.map((section, idx) => {
                const count = features.filter(f => f.sectionId === section.id).length;
                const aiCount = features.filter(f => f.sectionId === section.id && f.aiGenerated).length;
                if (count === 0) return null;
                const color = SECTION_COLORS[idx % SECTION_COLORS.length];
                return (
                  <span key={section.id} className="text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: color.fill, color: color.stroke, backgroundColor: color.fill + '18' }}>
                    {section.name}: {count} line{count !== 1 ? 's' : ''}{aiCount > 0 ? ` (${aiCount} AI)` : ''}
                  </span>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── GUTTERS ─── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Gutters & Downspouts</CardTitle>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={includeGutters} onChange={(e) => setIncludeGutters(e.target.checked)} className="w-4 h-4" data-testid="include-gutters" />
              <span className="text-sm">Include in estimate</span>
            </label>
          </div>
        </CardHeader>
        {includeGutters && (
          <CardContent className="space-y-3 pt-0">
            <div>
              <Label>Gutter Length (LF)</Label>
              <Input type="number" value={gutterLF} onChange={(e) => setGutterLF(Number(e.target.value))} className="mt-1" data-testid="input-gutter-lf" />
              <p className="text-xs text-gray-500 mt-1">Auto-filled from eave measurements</p>
            </div>
            <div>
              <Label>Number of Downspouts</Label>
              <Input type="number" value={downspoutCount} onChange={(e) => setDownspoutCount(Number(e.target.value))} className="mt-1" data-testid="input-downspout-count" />
              <p className="text-xs text-gray-500 mt-1">Typically 1 per 30–40 LF</p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ─── MEASUREMENTS SUMMARY ─── */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Measurements Summary</CardTitle></CardHeader>
        <CardContent>
          <Tabs defaultValue="current">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="current">Active Section</TabsTrigger>
              <TabsTrigger value="all">All Sections</TabsTrigger>
            </TabsList>

            <TabsContent value="current" className="space-y-2 pt-3">
              <p className="text-sm font-semibold text-gray-700">{getActiveSection()?.name}</p>
              {sectionPolygons[activeSectionId] && (
                <div className="text-sm font-medium text-blue-700 mb-2">
                  Area: {(calculatePolygonArea(sectionPolygons[activeSectionId]) / 100).toFixed(2)} SQ
                  &nbsp;({calculatePolygonArea(sectionPolygons[activeSectionId]).toFixed(0)} ft²)
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[
                  { color: 'bg-purple-500', label: 'Ridge', val: currentSectionMeasures.ridge_lf },
                  { color: 'bg-green-500', label: 'Valley', val: currentSectionMeasures.valley_lf },
                  { color: 'bg-orange-500', label: 'Rake', val: currentSectionMeasures.rake_lf },
                  { color: 'bg-red-500', label: 'Eave', val: currentSectionMeasures.eave_lf },
                  { color: 'bg-blue-500', label: 'Hip', val: currentSectionMeasures.hip_lf },
                  { color: 'bg-pink-500', label: 'Step Flash', val: currentSectionMeasures.step_flashing_lf },
                ].map(({ color, label, val }) => (
                  <div key={label} className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
                    <span className="text-gray-600">{label}:</span>
                    <span className="font-semibold">{val.toFixed(1)} LF</span>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="all" className="space-y-3 pt-3">
              <div className="p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                <p className="text-sm font-semibold text-gray-900 mb-1">Combined Total</p>
                <p className="text-3xl font-bold text-blue-700">{totalSQ.toFixed(2)} SQ</p>
                <p className="text-xs text-gray-600">({totalSqft.toFixed(0)} ft²)</p>
              </div>

              {sections.map((section, idx) => {
                const measures = sectionMeasurements[section.id] || {};
                const poly = sectionPolygons[section.id];
                const sectionSqft = calculatePolygonArea(poly);
                const color = SECTION_COLORS[idx % SECTION_COLORS.length];
                const lineCount = features.filter(f => f.sectionId === section.id).length;
                if (!poly && lineCount === 0) return null;
                return (
                  <div key={section.id} className="border rounded-lg p-3" style={{ borderColor: color.fill }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color.fill }} />
                      <p className="font-semibold text-sm">{section.name}</p>
                      {poly && <span className="text-xs text-gray-600 ml-auto">{(sectionSqft / 100).toFixed(2)} SQ</span>}
                    </div>
                    {lineCount > 0 ? (
                      <div className="grid grid-cols-2 gap-1 text-xs text-gray-600">
                        {measures.ridge_lf > 0 && <div>Ridge: {measures.ridge_lf.toFixed(1)} LF</div>}
                        {measures.valley_lf > 0 && <div>Valley: {measures.valley_lf.toFixed(1)} LF</div>}
                        {measures.rake_lf > 0 && <div>Rake: {measures.rake_lf.toFixed(1)} LF</div>}
                        {measures.eave_lf > 0 && <div>Eave: {measures.eave_lf.toFixed(1)} LF</div>}
                        {measures.hip_lf > 0 && <div>Hip: {measures.hip_lf.toFixed(1)} LF</div>}
                        {measures.step_flashing_lf > 0 && <div>Step Flash: {measures.step_flashing_lf.toFixed(1)} LF</div>}
                      </div>
                    ) : <p className="text-xs text-gray-400">No linear measurements yet</p>}
                  </div>
                );
              })}

              {includeGutters && (
                <div className="border rounded-lg p-3 bg-green-50 border-green-200">
                  <p className="font-semibold text-sm mb-1 text-green-900">Gutters & Downspouts</p>
                  <div className="grid grid-cols-2 gap-2 text-xs text-green-800">
                    <div>Gutters: {gutterLF.toFixed(1)} LF</div>
                    <div>Downspouts: {downspoutCount} EA</div>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <div className="mt-4">
            <Label>Roof Pitch</Label>
            <Input value={pitch} onChange={(e) => setPitch(e.target.value)} placeholder="e.g., 5/12, 7/12, 10/12" className="w-36 mt-1" data-testid="input-roof-pitch" />
          </div>

          <Button
            onClick={handleSaveMeasurements}
            className="w-full bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700 text-white mt-4"
            disabled={Object.keys(sectionPolygons).length === 0}
            data-testid="save-measurements"
          >
            <Save className="w-4 h-4 mr-2" />
            Use These Measurements for Estimate
            {Object.keys(sectionPolygons).length > 0 && <Badge className="ml-2 bg-white/20">{totalSQ.toFixed(1)} SQ</Badge>}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
