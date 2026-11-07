import React, { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Undo, Trash2, Save, ArrowLeft, Pencil, Ruler, Plus, X,
  CheckCircle2, Sparkles, Camera, Loader2, ChevronDown, ChevronUp,
  AlertTriangle, RotateCcw, RotateCw, Move
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import StreetViewPanel, { CompassStreetView } from "./StreetViewPanel";
import {
  pitchMultiplier,
} from "@/utils/companySyncFormulas";
import {
  createTiltControl,
  MAX_MEASUREMENT_ZOOM,
  getImageryBaseType,
} from "@/lib/mapImagery";
import { buildTracedRoofGraph } from "../../../functions/utils/roofTracedFacetGraph.js";
import {
  SNAP_MAX_FEET,
  SNAP_PIXELS,
  findSnapTarget,
  planNextFacet,
  resolveEdgeTotals,
  sumFacetEdgeLengths,
  MANUAL_LINE_TYPES,
} from "@/utils/roofTraceSession";

const SECTION_COLORS = [
  { fill: '#3b82f6', stroke: '#1d4ed8', label: 'blue' },
  { fill: '#f97316', stroke: '#ea580c', label: 'orange' },
  { fill: '#10b981', stroke: '#059669', label: 'green' },
  { fill: '#8b5cf6', stroke: '#7c3aed', label: 'purple' },
  { fill: '#ec4899', stroke: '#db2777', label: 'pink' },
  { fill: '#14b8a6', stroke: '#0d9488', label: 'teal' },
];

const LINE_COLORS = {
  ridge: '#9333ea',
  valley: '#10b981',
  rake: '#f97316',
  eave: '#ef4444',
  hip: '#3b82f6',
  step_flashing: '#ec4899',
  drip_edge: '#0891b2',
};

const LINE_LABELS = {
  ridge: 'Ridge',
  hip: 'Hip',
  valley: 'Valley',
  rake: 'Rake',
  eave: 'Eave',
  step_flashing: 'Step flashing',
  drip_edge: 'Drip edge',
};

const LINE_STROKE_WEIGHT = 9;
const POLYGON_STROKE_WEIGHT = 3;
const DIRECTION_OPTIONS = [
  { value: 0, label: 'North' },
  { value: 45, label: 'Northeast' },
  { value: 90, label: 'East' },
  { value: 135, label: 'Southeast' },
  { value: 180, label: 'South' },
  { value: 225, label: 'Southwest' },
  { value: 270, label: 'West' },
  { value: 315, label: 'Northwest' },
];

function collectSnapGeometry(polygons, excludePolygon = null) {
  const vertices = [];
  const segments = [];
  Object.values(polygons || {}).forEach((poly) => {
    if (!poly?.getPath || poly === excludePolygon) return;
    const path = poly.getPath();
    const n = path.getLength?.() || 0;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(path.getAt(i));
    if (pts.length === 0) return;
    vertices.push(...pts);
    for (let i = 0; i < pts.length; i++) {
      segments.push({ a: pts[i], b: pts[(i + 1) % pts.length] });
    }
  });
  return { vertices, segments };
}

/** Snap a map click to another facet's corner, or onto its edge. */
function snapMapLatLng(map, latLng, targets) {
  const proj = map?.getProjection?.();
  if (!proj || !latLng) return { latLng, snapped: false };
  const zoom = map.getZoom?.() ?? 19;
  const scale = 2 ** zoom;
  const toPx = (ll) => {
    if (!ll || typeof ll.lat !== 'function') return null;
    const world = proj.fromLatLngToPoint(ll);
    if (!world) return null;
    return { x: world.x * scale, y: world.y * scale, latLng: ll };
  };
  const cursor = toPx(latLng);
  if (!cursor) return { latLng, snapped: false };
  const vertices = (targets?.vertices || []).map(toPx).filter(Boolean);
  const segments = (targets?.segments || []).map((s) => {
    const a = toPx(s.a);
    const b = toPx(s.b);
    if (!a || !b) return null;
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }).filter(Boolean);
  const hit = findSnapTarget(cursor, vertices, segments, SNAP_PIXELS);
  if (!hit) return { latLng, snapped: false };
  let snappedLL = hit.latLng || null;
  if (!snappedLL && proj.fromPointToLatLng) {
    const G = window.google.maps;
    snappedLL = proj.fromPointToLatLng(new G.Point(hit.x / scale, hit.y / scale));
  }
  if (!snappedLL) return { latLng, snapped: false };
  const spherical = window.google?.maps?.geometry?.spherical;
  if (spherical?.computeDistanceBetween) {
    const feet = spherical.computeDistanceBetween(latLng, snappedLL) * 3.28084;
    if (Number.isFinite(feet) && feet > SNAP_MAX_FEET) return { latLng, snapped: false };
  }
  return { latLng: snappedLL, snapped: true, kind: hit.kind };
}

// ─── ClickDrawingManager ──────────────────────────────────────────────────────
// Drop-in replacement for google.maps.drawing.DrawingManager (removed in v3.65).
// Builds polygons/polylines via map clicks; double-click finishes the shape.
// ─────────────────────────────────────────────────────────────────────────────
class ClickDrawingManager {
  constructor(opts = {}) {
    this._opts     = opts;
    this._map      = null;
    this._mode     = opts.drawingMode || null;
    this._vertices = [];
    this._dots     = [];
    this._preview  = null;
    this._clickL   = null;
    this._dblL     = null;
    this._handlers = {};
    this._snapProvider = null;
    this._onSnap = null;
    this._onVertices = null;
    this._snapMarker = null;
    this._snapKind = null;
    this._lastClickMs = 0;
    this._lastClickPos = null;
    this._vertexTimes = [];
    this._zoomLocked = false;
  }
  setMap(map)  { this._map = map; if (map && this._mode) this._bind(); }
  setSnapProvider(fn) { this._snapProvider = fn; }
  setOnSnap(fn) { this._onSnap = fn; }
  setOnVertices(fn) { this._onVertices = fn; }
  setDrawingMode(mode) { this._reset(); this._mode = mode; if (mode && this._map) this._bind(); }
  setOptions(opts) {
    Object.assign(this._opts, opts);
    if (this._preview) {
      const o = this._mode === 'polygon' ? this._opts.polygonOptions : this._opts.polylineOptions;
      if (o) this._preview.setOptions(o);
    }
  }
  addListener(event, fn) {
    (this._handlers[event] = this._handlers[event] || []).push(fn);
    return { remove: () => { this._handlers[event] = (this._handlers[event] || []).filter(f => f !== fn); } };
  }
  _emit(ev, ...a) { (this._handlers[ev] || []).forEach(fn => fn(...a)); }
  _bind() {
    const G = window.google.maps;
    // A double-click both finishes the shape and, by default, zooms the map.
    // Turn the zoom off for the whole drawing session.
    if (this._map?.setOptions && !this._zoomLocked) {
      this._prevDisableDblZoom = this._map.get?.('disableDoubleClickZoom');
      this._map.setOptions({ disableDoubleClickZoom: true });
      this._zoomLocked = true;
    }
    // dblclick fires on desktop; on mobile double-tap zooms instead so we
    // also detect it in the click handler below.
    this._dblL = G.event.addListener(this._map, 'dblclick', (e) => {
      e.stop?.();
      if (!this._mode) return;
      // The click(s) that formed this double-click already dropped a point.
      // Take those back so the finish gesture is not an extra corner.
      this._dropGestureVertices(e.latLng);
      this._complete();
    });
    this._clickL = G.event.addListener(this._map, 'click', (e) => {
      e.stop();
      const now = Date.now();
      // Two taps in the SAME spot within 350 ms = double-tap to finish (covers
      // mobile where dblclick never fires). Requiring the taps to land on nearly
      // the same point stops fast corner-placing from being misread as "finish"
      // and dropping a real corner.
      const spherical = G.geometry && G.geometry.spherical;
      const nearLast = this._lastClickPos && spherical
        ? spherical.computeDistanceBetween(this._lastClickPos, e.latLng) < 1.5
        : false;
      if (this._lastClickMs > 0 && now - this._lastClickMs < 350 && nearLast) {
        this._lastClickMs = 0; this._lastClickPos = null;
        // Remove the near-duplicate vertex the first tap of the pair added
        if (this._vertices.length > (this._mode === 'polygon' ? 2 : 1)) {
          const d = this._dots.pop(); if (d) d.setMap(null);
          this._vertices.pop();
        }
        this._complete();
        return;
      }
      this._lastClickMs = now;
      this._lastClickPos = e.latLng;
      this._addVertex(e.latLng);
    });
    this._moveL = G.event.addListener(this._map, 'mousemove', (e) => {
      const snapped = this._snap(e.latLng);
      this._showSnap(snapped);
      if (!this._vertices.length) return;
      const pts = [...this._vertices, snapped.latLng];
      if (!this._rubber) {
        this._rubber = new G.Polyline({ path: pts, strokeColor: this._color(), strokeWeight: 2, strokeOpacity: 0.6, strokeDashArray: '6 4', clickable: false, zIndex: 15, map: this._map });
      } else { this._rubber.setPath(pts); }
    });
  }
  _snap(latLng) {
    if (!this._snapProvider || !this._map || !latLng) return { latLng, snapped: false };
    try {
      return snapMapLatLng(this._map, latLng, this._snapProvider() || {});
    } catch {
      return { latLng, snapped: false };
    }
  }
  _showSnap(snapped) {
    const G = window.google?.maps;
    if (!snapped?.snapped || !G || !this._map) {
      if (this._snapMarker) this._snapMarker.setMap(null);
      if (this._snapKind) { this._snapKind = null; this._onSnap?.(null); }
      return;
    }
    if (!this._snapMarker) {
      this._snapMarker = new G.Marker({
        map: this._map,
        clickable: false,
        zIndex: 80,
        icon: {
          path: G.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: '#facc15',
          fillOpacity: 0.35,
          strokeColor: '#ca8a04',
          strokeWeight: 3,
        },
      });
    }
    this._snapMarker.setPosition(snapped.latLng);
    this._snapMarker.setMap(this._map);
    if (this._snapKind !== snapped.kind) {
      this._snapKind = snapped.kind;
      this._onSnap?.(snapped.kind);
    }
  }
  _emitVertices() {
    let lengthFt = 0;
    const spherical = window.google?.maps?.geometry?.spherical;
    if (this._vertices.length >= 2 && spherical?.computeLength) {
      const path = { getLength: () => this._vertices.length, getAt: (i) => this._vertices[i] };
      lengthFt = spherical.computeLength(path) * 3.28084;
    }
    this._onVertices?.(this._vertices.length, lengthFt);
  }
  _dropGestureVertices(latLng) {
    const cutoff = Date.now() - 500;
    const spherical = window.google?.maps?.geometry?.spherical;
    let removed = 0;
    while (this._vertices.length && removed < 2) {
      const last = this._vertices[this._vertices.length - 1];
      const addedAt = this._vertexTimes[this._vertexTimes.length - 1] || 0;
      if (addedAt < cutoff) break;
      if (latLng && spherical?.computeDistanceBetween && spherical.computeDistanceBetween(last, latLng) > 3) break;
      this._vertices.pop();
      this._vertexTimes.pop();
      const dot = this._dots.pop();
      if (dot) dot.setMap(null);
      removed += 1;
    }
    if (this._vertices.length >= 2) this._updatePreview();
    else if (this._preview) { this._preview.setMap(null); this._preview = null; }
    this._emitVertices();
  }
  undoVertex() {
    if (!this._mode || this._vertices.length === 0) return false;
    // The undone tap is no longer a corner, so the next click there must
    // place the point again instead of finishing the facet.
    this._lastClickMs = 0;
    this._lastClickPos = null;
    this._vertices.pop();
    this._vertexTimes.pop();
    const dot = this._dots.pop();
    if (dot) dot.setMap(null);
    if (this._vertices.length < 2) {
      if (this._preview) { this._preview.setMap(null); this._preview = null; }
      if (this._rubber) { this._rubber.setMap(null); this._rubber = null; }
    } else {
      this._updatePreview();
    }
    this._emitVertices();
    return true;
  }
  _addVertex(latLng) {
    const snapped = this._snap(latLng);
    const point = snapped.latLng || latLng;
    this._showSnap(snapped);
    this._vertices.push(point);
    this._vertexTimes.push(Date.now());
    const G = window.google.maps; const col = this._color();
    this._dots.push(new G.Marker({
      position: point, map: this._map, clickable: false, zIndex: 20,
      icon: { path: G.SymbolPath.CIRCLE, scale: 7, fillColor: col, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
    }));
    this._updatePreview();
    this._emitVertices();
  }
  _color() {
    const o = this._mode === 'polygon' ? this._opts.polygonOptions : this._opts.polylineOptions;
    return (o && (o.strokeColor || o.fillColor)) || '#3B82F6';
  }
  _updatePreview() {
    if (this._vertices.length < 2) return;
    const G = window.google.maps;
    if (this._mode === 'polygon') {
      const opts = { ...(this._opts.polygonOptions || {}), editable: false, draggable: false, map: this._map };
      if (!this._preview) this._preview = new G.Polygon({ paths: this._vertices, ...opts });
      else this._preview.setPath(this._vertices);
    } else {
      const opts = { ...(this._opts.polylineOptions || {}), editable: false, draggable: false, map: this._map };
      if (!this._preview) this._preview = new G.Polyline({ path: this._vertices, ...opts });
      else this._preview.setPath(this._vertices);
    }
  }
  _complete() {
    if (this._completing) return;
    const min = this._mode === 'polygon' ? 3 : 2;
    if (this._vertices.length < min) return;
    this._completing = true;
    const G = window.google.maps; const verts = [...this._vertices]; const mode = this._mode; const map = this._map;
    const opts = mode === 'polygon'
      ? { ...(this._opts.polygonOptions || {}), editable: true, draggable: false, map }
      : { ...(this._opts.polylineOptions || {}), editable: true, draggable: false, map };
    this._reset(); this._mode = null;
    if (mode === 'polygon') { this._emit('polygoncomplete', new G.Polygon({ paths: verts, ...opts })); }
    else                    { this._emit('polylinecomplete', new G.Polyline({ path: verts, ...opts })); }
    this._completing = false;
  }
  complete() { this._complete(); }
  _reset() {
    if (this._preview) { this._preview.setMap(null); this._preview = null; }
    if (this._rubber)  { this._rubber.setMap(null);  this._rubber  = null; }
    if (this._snapMarker) { this._snapMarker.setMap(null); }
    if (this._snapKind) { this._snapKind = null; this._onSnap?.(null); }
    this._dots.forEach(d => d.setMap(null)); this._dots = []; this._vertices = []; this._vertexTimes = [];
    this._lastClickMs = 0;
    this._lastClickPos = null;
    if (this._zoomLocked && this._map?.setOptions) {
      this._map.setOptions({ disableDoubleClickZoom: !!this._prevDisableDblZoom });
      this._zoomLocked = false;
    }
    this._emitVertices();
    if (this._clickL && window.google) { window.google.maps.event.removeListener(this._clickL); this._clickL = null; }
    if (this._dblL   && window.google) { window.google.maps.event.removeListener(this._dblL);   this._dblL   = null; }
    if (this._moveL  && window.google) { window.google.maps.event.removeListener(this._moveL);  this._moveL  = null; }
  }
}

// ─── makePolygonEditable ────────────────────────────────────────────────────
// Replaces Google Maps' tiny built-in handles with large, easy-to-grab markers.
// • Solid white circles at each vertex  → drag to move that corner
// • Smaller colored circles at midpoints → drag to insert a new corner
// ─────────────────────────────────────────────────────────────────────────────
function makePolygonEditable(polygon, strokeColor, onGeometryChange = null, snapLatLng = null) {
  const G = window.google.maps;
  const handles = [];

  function clearHandles() {
    handles.forEach(h => h.setMap(null));
    handles.length = 0;
  }

  function buildHandles() {
    clearHandles();
    const path = polygon.getPath();
    const n = path.getLength();

    for (let i = 0; i < n; i++) {
      // ── Vertex handle ──
      const vi = i;
      const vMarker = new G.Marker({
        position: path.getAt(i),
        map: polygon.getMap(),
        draggable: true,
        cursor: 'move',
        zIndex: 60,
        title: 'Drag to move this corner',
        icon: { path: G.SymbolPath.CIRCLE, scale: 8, fillColor: '#ffffff', fillOpacity: 1, strokeColor: strokeColor, strokeWeight: 3 },
      });
      G.event.addListener(vMarker, 'drag', (e) => {
        const snapped = snapLatLng ? snapLatLng(e.latLng) : null;
        const next = snapped?.latLng || e.latLng;
        path.setAt(vi, next);
        vMarker.setPosition(next);
      });
      G.event.addListener(vMarker, 'dragend', () => { buildHandles(); onGeometryChange?.(); });
      handles.push(vMarker);

      // ── Midpoint handle (insert new vertex) ──
      const p1 = path.getAt(i);
      const p2 = path.getAt((i + 1) % n);
      const midPos = { lat: (p1.lat() + p2.lat()) / 2, lng: (p1.lng() + p2.lng()) / 2 };
      const insertAfter = i + 1;
      const mMarker = new G.Marker({
        position: midPos,
        map: polygon.getMap(),
        draggable: true,
        cursor: 'crosshair',
        zIndex: 50,
        title: 'Drag to add a new corner here',
        icon: { path: G.SymbolPath.CIRCLE, scale: 6, fillColor: strokeColor, fillOpacity: 0.85, strokeColor: '#ffffff', strokeWeight: 2 },
      });
      let inserted = false;
      G.event.addListener(mMarker, 'drag', (e) => {
        if (!inserted) { path.insertAt(insertAfter, e.latLng); inserted = true; buildHandles(); }
        else { path.setAt(insertAfter, e.latLng); }
      });
      G.event.addListener(mMarker, 'dragend', () => { buildHandles(); onGeometryChange?.(); });
      handles.push(mMarker);
    }
  }

  polygon.setOptions({ editable: false });
  buildHandles();
  return { destroy: clearHandles, refresh: buildHandles };
}

// ─── makePolylineEditable ───────────────────────────────────────────────────
// Same idea for linear features (ridge, valley, rake, etc.)
// ─────────────────────────────────────────────────────────────────────────────
function makePolylineEditable(polyline, strokeColor) {
  const G = window.google.maps;
  const handles = [];

  function clearHandles() {
    handles.forEach(h => h.setMap(null));
    handles.length = 0;
  }

  function buildHandles() {
    clearHandles();
    const path = polyline.getPath();
    const n = path.getLength();

    for (let i = 0; i < n; i++) {
      const vi = i;
      const vMarker = new G.Marker({
        position: path.getAt(i),
        map: polyline.getMap(),
        draggable: true,
        cursor: 'move',
        zIndex: 60,
        title: 'Drag to move this point',
        icon: { path: G.SymbolPath.CIRCLE, scale: 5, fillColor: '#ffffff', fillOpacity: 1, strokeColor: strokeColor, strokeWeight: 2 },
      });
      G.event.addListener(vMarker, 'drag', (e) => { path.setAt(vi, e.latLng); });
      G.event.addListener(vMarker, 'dragend', buildHandles);
      handles.push(vMarker);

      if (i < n - 1) {
        const p1 = path.getAt(i);
        const p2 = path.getAt(i + 1);
        const midPos = { lat: (p1.lat() + p2.lat()) / 2, lng: (p1.lng() + p2.lng()) / 2 };
        const insertAfter = i + 1;
        const mMarker = new G.Marker({
          position: midPos,
          map: polyline.getMap(),
          draggable: true,
          cursor: 'crosshair',
          zIndex: 50,
          title: 'Drag to add a new point here',
          icon: { path: G.SymbolPath.CIRCLE, scale: 3, fillColor: strokeColor, fillOpacity: 0.75, strokeColor: '#ffffff', strokeWeight: 1 },
        });
        let inserted = false;
        G.event.addListener(mMarker, 'drag', (e) => {
          if (!inserted) { path.insertAt(insertAfter, e.latLng); inserted = true; buildHandles(); }
          else { path.setAt(insertAfter, e.latLng); }
        });
        G.event.addListener(mMarker, 'dragend', buildHandles);
        handles.push(mMarker);
      }
    }
  }

  polyline.setOptions({ editable: false });
  buildHandles();
  return { destroy: clearHandles, refresh: buildHandles };
}

// Imagery sources, the Esri overzoom overlay and the tilt row now live in
// @/lib/mapImagery so the AI estimator map renders the identical controls.

export default function InteractiveRoofMap({
  latitude, longitude, address, onMeasurementsComplete, onBack, googleMapsLoaded,
  crewCamPhotoCount = 0,
  mapId = null,  // when provided, enables vector renderer → continuous tilt 0°–67°
  initialMeasurements = null,
  purpose = 'primary', // 'primary' replaces/creates the main roof; 'addon' measures an extra structure
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const drawingManagerRef = useRef(null);
  const [drawingManager, setDrawingManager] = useState(null);
  const [currentTool, setCurrentTool] = useState(null);
  const currentToolRef = useRef(null);
  const sectionHandlesRef = useRef({});  // id → { destroy }
  const featureHandlesRef = useRef({});  // feature id → { destroy }
  const featuresRef = useRef([]);        // mirror of features state, always fresh

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
  const [pitch, setPitch] = useState(initialMeasurements?.pitch || "7/12");
  // Pitch drives the ENTIRE roof area, so we flag it until it comes from a real
  // source (user-typed or AI-measured) rather than the untouched default guess.
  const [pitchConfirmed, setPitchConfirmed] = useState(false);
  // AI-detected pitch is a suggestion from the same imagery pipeline, NOT a human
  // verification, so it must not auto-confirm — it only changes the warning copy.
  const [pitchAISuggested, setPitchAISuggested] = useState(false);
  const [sections, setSections] = useState([{
    id: 1,
    name: "Facet 1",
    pitch: initialMeasurements?.pitch || "7/12",
    azimuth_degrees: 180,
  }]);
  const [activeSectionId, setActiveSectionId] = useState(1);
  const activeSectionIdRef = useRef(1);
  const sectionsRef = useRef(sections);
  const pitchRef = useRef(initialMeasurements?.pitch || "7/12");
  const pendingAutoFacetIdRef = useRef(null);
  const queueNextFacetRef = useRef(null);
  const startDrawingRef = useRef(null);
  const [drawingVertexCount, setDrawingVertexCount] = useState(0);
  const [drawingLengthFt, setDrawingLengthFt] = useState(0);
  const [snapHint, setSnapHint] = useState(null);
  const setSnapHintRef = useRef(null);
  const setVertexCountRef = useRef(null);
  const setDrawingLengthRef = useRef(null);
  const [includeGutters, setIncludeGutters] = useState(false);
  const [gutterLF, setGutterLF] = useState(0);
  const [downspoutCount, setDownspoutCount] = useState(0);
  const gutterEditedRef = useRef(false); // true once the user hand-edits gutter/downspout numbers

  // AI line detection
  const [isAIDetecting, setIsAIDetecting] = useState(false);
  const [aiDetectionNote, setAIDetectionNote] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [perspectiveView, setPerspectiveView] = useState(false);
  const measurementsRef = useRef(null);
  const classifiedEdgeLinesRef = useRef([]);
  const [geometryRevision, setGeometryRevision] = useState(0);

  // N/E/S/W heading & 3D (tracked via native Google Maps controls, not React state)

  // Internal geocoding (when lat/lng are not pre-provided)
  const [resolvedLat, setResolvedLat] = useState(latitude || 0);
  const [resolvedLng, setResolvedLng] = useState(longitude || 0);
  const [geocodingState, setGeocodingState] = useState(
    latitude && longitude ? 'done' : 'pending'
  );

  // Street View
  const [streetViewImages, setStreetViewImages] = useState([]);
  const [isLoadingStreetView, setIsLoadingStreetView] = useState(false);
  const [streetViewOpen, setStreetViewOpen] = useState(false);
  // Lets the imperatively-built map buttons (N/E/S/W + Sides) open the Street View
  // panel. A ref avoids stale closures since the map controls are built once.
  const openStreetViewRef = useRef(null);
  // Ref so the imperative map buttons can set compassPanoDir without stale closures.
  const setCompassPanoDirRef = useRef(null);

  const [compassPanoDir, setCompassPanoDir] = useState(null);

  sectionsRef.current = sections;
  pitchRef.current = pitch;
  setSnapHintRef.current = setSnapHint;
  setVertexCountRef.current = setDrawingVertexCount;
  setDrawingLengthRef.current = setDrawingLengthFt;

  useEffect(() => { currentToolRef.current = currentTool; }, [currentTool]);
  useEffect(() => { featuresRef.current = features; }, [features]);
  useEffect(() => { activeSectionIdRef.current = activeSectionId; }, [activeSectionId]);
  useEffect(() => { sectionPolygonsRef.current = sectionPolygons; }, [sectionPolygons]);
  useEffect(() => { damageModeActiveRef.current = damageLayerOn; }, [damageLayerOn]);
  useEffect(() => { damageModeTypeRef.current = damageMode; }, [damageMode]);

  // Destroy all custom drag handles on unmount to avoid leaking map markers/listeners
  useEffect(() => {
    return () => {
      Object.values(sectionHandlesRef.current).forEach(h => { try { h.destroy(); } catch { /* noop */ } });
      Object.values(featureHandlesRef.current).forEach(h => { try { h.destroy(); } catch { /* noop */ } });
      sectionHandlesRef.current = {};
      featureHandlesRef.current = {};
    };
  }, []);

  // NOTE: We intentionally do NOT auto-draw AI lines when the map loads.
  // The Solar API only gives axis-aligned (N/S/E/W) bounding boxes, so the
  // derived lines never match a roof that sits at an angle. Auto-drawing them
  // just put inaccurate lines on the map before the user started. Users can
  // still press the "AI Draw Lines for Me" button to get a rough starting point.

  // Geocode address internally when lat/lng are not provided
  useEffect(() => {
    if (!googleMapsLoaded || !window.google?.maps) return;
    if (geocodingState === 'done') return;
    if (!address) { setGeocodingState('error'); return; }
    setGeocodingState('loading');
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ address }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const loc = results[0].geometry.location;
        setResolvedLat(loc.lat());
        setResolvedLng(loc.lng());
        setGeocodingState('done');
      } else {
        console.warn('InteractiveRoofMap geocode failed:', status);
        setGeocodingState('error');
      }
    });
  }, [googleMapsLoaded, address, geocodingState]);

  // Initialize Google Map
  useEffect(() => {
    if (!googleMapsLoaded || !mapRef.current || mapInstanceRef.current) return;
    if (typeof window === 'undefined' || !window.google) return;
    if (!window.google.maps) return;
    if (geocodingState !== 'done') return;

    const mapInstance = new window.google.maps.Map(mapRef.current, {
      center: { lat: resolvedLat, lng: resolvedLng },
      // Start at a property-scale view, while allowing a close-up for precise
      // roof-edge tracing.
      zoom: 19,
      maxZoom: MAX_MEASUREMENT_ZOOM,
      mapTypeId: 'satellite',
      tilt: 0,
      heading: 0,
      zoomControl: true,
      zoomControlOptions: {
        position: window.google.maps.ControlPosition.RIGHT_CENTER,
      },
      rotateControl: false,
      fullscreenControl: false,
      streetViewControl: false,
      mapTypeControl: true,
      mapTypeControlOptions: {
        style: window.google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
        position: window.google.maps.ControlPosition.TOP_LEFT,
        mapTypeIds: ['roadmap', 'satellite']
      },
      gestureHandling: 'greedy',
      // mapId enables the vector renderer → continuous tilt 0°–67.5° (vs raster's 0°/45° only)
      ...(mapId ? { mapId } : {}),
    });

    // Vector maps with mapId sometimes ignore the constructor mapTypeId — force it ONCE after first idle.
    // Using a persistent listener caused setMapTypeId('satellite') to fire after every tilt/heading
    // change, silently resetting tilt back to 0 each time.
    if (mapId) {
      const onceListener = mapInstance.addListener('idle', () => {
        window.google.maps.event.removeListener(onceListener);
        if (mapInstance.getMapTypeId() !== getImageryBaseType(mapInstance)) mapInstance.setMapTypeId(getImageryBaseType(mapInstance));
      });
    }

    const manager = new ClickDrawingManager({
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
    manager.setSnapProvider(() => collectSnapGeometry(sectionPolygonsRef.current));
    manager.setOnSnap((kind) => setSnapHintRef.current?.(kind));
    manager.setOnVertices((count, lengthFt) => {
      setVertexCountRef.current?.(count);
      setDrawingLengthRef.current?.(Number(lengthFt) || 0);
    });
    mapInstanceRef.current = mapInstance;
    drawingManagerRef.current = manager;
    setDrawingManager(manager);

    // ─── Bullseye marker anchored to property lat/lng ───
    const bullseyeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60" width="60" height="60">
      <circle cx="30" cy="30" r="28" fill="none" stroke="red" stroke-width="2" opacity="0.7"/>
      <circle cx="30" cy="30" r="18" fill="none" stroke="red" stroke-width="1.5" opacity="0.5"/>
      <circle cx="30" cy="30" r="8" fill="none" stroke="red" stroke-width="1.5" opacity="0.7"/>
      <circle cx="30" cy="30" r="2" fill="red" opacity="0.9"/>
      <line x1="30" y1="0" x2="30" y2="22" stroke="red" stroke-width="1" opacity="0.5"/>
      <line x1="30" y1="38" x2="30" y2="60" stroke="red" stroke-width="1" opacity="0.5"/>
      <line x1="0" y1="30" x2="22" y2="30" stroke="red" stroke-width="1" opacity="0.5"/>
      <line x1="38" y1="30" x2="60" y2="30" stroke="red" stroke-width="1" opacity="0.5"/>
    </svg>`;
    new window.google.maps.Marker({
      position: { lat: resolvedLat, lng: resolvedLng },
      map: mapInstance,
      icon: {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(bullseyeSvg),
        scaledSize: new window.google.maps.Size(60, 60),
        anchor: new window.google.maps.Point(30, 30),
      },
      clickable: false,
      zIndex: 999,
      title: 'Property center',
    });

    manager.addListener('polygoncomplete', (polygon) => {
      // Restore clickability on all existing shapes now that drawing is done
      Object.values(sectionPolygonsRef.current).forEach(p => p?.setOptions({ clickable: true }));
      featuresRef.current.forEach(f => f.polyline?.setOptions({ clickable: true }));
      setCurrentTool(null);
      currentToolRef.current = null;
      const sId = activeSectionIdRef.current;
      const sIdx = sectionsRef.current.findIndex(s => s.id === sId);
      const color = SECTION_COLORS[(sIdx >= 0 ? sIdx : 0) % SECTION_COLORS.length];
      const existing = sectionPolygonsRef.current[sId];
      if (existing) existing.setMap(null);
      if (sectionHandlesRef.current[sId]) sectionHandlesRef.current[sId].destroy();
      polygon.setOptions({ fillColor: color.fill, strokeColor: color.stroke, fillOpacity: 0.2, strokeWeight: POLYGON_STROKE_WEIGHT, editable: false });
      polygon._drawnAt = Date.now(); // used by Undo to find the most-recently drawn shape
      sectionPolygonsRef.current = { ...sectionPolygonsRef.current, [sId]: polygon };
      setSectionPolygons(prev => ({ ...prev, [sId]: polygon }));
      sectionHandlesRef.current[sId] = makePolygonEditable(
        polygon,
        color.stroke,
        () => setGeometryRevision(v => v + 1),
        (latLng) => snapMapLatLng(
          mapInstanceRef.current,
          latLng,
          collectSnapGeometry(sectionPolygonsRef.current, polygon),
        ),
      );
      setGeometryRevision(v => v + 1);
      // Finishing a facet (Done or double-click / double-tap) starts the next one.
      pendingAutoFacetIdRef.current = null;
      queueNextFacetRef.current?.(sId);
    });

    manager.addListener('polylinecomplete', (polyline) => {
      // Restore clickability on all existing shapes now that drawing is done
      Object.values(sectionPolygonsRef.current).forEach(p => p?.setOptions({ clickable: true }));
      featuresRef.current.forEach(f => f.polyline?.setOptions({ clickable: true }));
      const toolType = currentToolRef.current;
      const sectionId = activeSectionIdRef.current;
      const strokeColor = LINE_COLORS[toolType] || '#000';
      polyline.setOptions({ strokeColor, strokeWeight: LINE_STROKE_WEIGHT, editable: false });
      const fid = Date.now();
      setFeatures(prev => [...prev, { id: fid, type: toolType, polyline, sectionId, color: strokeColor }]);
      featureHandlesRef.current[fid] = makePolylineEditable(polyline, strokeColor);
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

    // ─── N/E/S/W 45° aerial + Top-down + Street View controls ───
    // (injected inside the map DOM to avoid z-index conflicts with the drawing overlay)
    const compassPanel = document.createElement('div');
    compassPanel.style.cssText = 'margin:0 0 10px 0;display:flex;gap:3px;align-items:center;flex-wrap:wrap;justify-content:center;';

    const headingDirs = [
      { label: 'N', heading: 0 },
      { label: 'E', heading: 90 },
      { label: 'S', heading: 180 },
      { label: 'W', heading: 270 },
    ];

    // Helper: degrees-per-metre for offset calculations
    const DEG_PER_M_LAT = 1 / 111320;
    const DEG_PER_M_LNG = 1 / (111320 * Math.cos(resolvedLat * Math.PI / 180));
    const SV_OFFSET_M = 70; // metres from the house centre — far enough to see the full face

    // Helper to highlight one direction button and dim the rest
    const highlightDir = (activeBtn) => {
      compassPanel.querySelectorAll('button[data-dir]').forEach(b => {
        b.style.background = '#7c3aed';
        b.style.boxShadow = '0 2px 4px rgba(0,0,0,0.35)';
      });
      if (activeBtn) {
        activeBtn.style.background = '#5b21b6';
        activeBtn.style.boxShadow = '0 0 0 2px #fff,0 0 0 4px #5b21b6';
      }
      topDownBtn.style.background = '#374151';
    };

    // Top-down reset button — also exits Street View
    const topDownBtn = document.createElement('button');
    topDownBtn.textContent = '⬆ Top';
    topDownBtn.title = 'Return to flat top-down satellite view';
    topDownBtn.style.cssText = 'padding:0 9px;height:36px;border:none;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;background:#111827;color:#fff;box-shadow:0 2px 4px rgba(0,0,0,0.35);';
    topDownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close embedded Street View (pegman) if open
      const pano = mapInstance.getStreetView();
      if (pano.getVisible()) pano.setVisible(false);
      mapInstance.setMapTypeId(getImageryBaseType(mapInstance));
      mapInstance.setTilt(0);
      mapInstance.setHeading(0);
      compassPanel.querySelectorAll('button[data-dir]').forEach(b => { b.style.background = '#7c3aed'; b.style.boxShadow = '0 2px 4px rgba(0,0,0,0.35)'; });
      topDownBtn.style.background = '#111827';
    });
    compassPanel.appendChild(topDownBtn);

    headingDirs.forEach(d => {
      const btn = document.createElement('button');
      btn.textContent = d.label;
      btn.dataset.dir = d.label;
      btn.title = `View ${d.label} face of the house — Street View from the ${d.label}`;
      btn.style.cssText = 'width:36px;height:36px;border:none;border-radius:4px;font-size:12px;font-weight:700;cursor:pointer;background:#7c3aed;color:#fff;box-shadow:0 2px 4px rgba(0,0,0,0.35);';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        highlightDir(btn);

        // ── Step 1: calculate a point SV_OFFSET_M metres in direction d.heading from the house ──
        // Heading 0 = North, 90 = East, 180 = South, 270 = West
        const rad = d.heading * Math.PI / 180;
        const offsetLat = Math.cos(rad) * SV_OFFSET_M * DEG_PER_M_LAT;
        const offsetLng = Math.sin(rad) * SV_OFFSET_M * DEG_PER_M_LNG;
        const svPos = { lat: resolvedLat + offsetLat, lng: resolvedLng + offsetLng };

        // ── Step 2: find nearest Street View panorama to that offset point ──
        const svService = new window.google.maps.StreetViewService();
        const pano = mapInstance.getStreetView();
        // Looking back toward the house from the offset position
        const lookbackHeading = (d.heading + 180) % 360;

        svService.getPanorama({ location: svPos, radius: 150, source: window.google.maps.StreetViewSource.OUTDOOR }, (data, status) => {
          if (status === window.google.maps.StreetViewStatus.OK) {
            pano.setPosition(data.location.latLng);
            // pitch: 12 tilts slightly upward so the full wall face (foundation → eave) fills the frame
            // zoom: 1.2 narrows the FOV a bit so the house wall is larger rather than lots of sky/ground
            pano.setPov({ heading: lookbackHeading, pitch: 12, zoom: 1.2 });
            pano.setVisible(true);
          } else {
            // Street View unavailable here — fall back to satellite tilt (works in some cities)
            pano.setVisible(false);
            mapInstance.setMapTypeId(getImageryBaseType(mapInstance));
            mapInstance.setHeading(d.heading);
            mapInstance.setTilt(45);
            // Show a brief tooltip on the button
            btn.title = `No Street View nearby — showing satellite tilt for ${d.label}`;
          }
        });
      });
      compassPanel.appendChild(btn);
    });

    // Street View — separate ground-level button
    const tiltBtn = document.createElement('button');
    tiltBtn.textContent = '🚶 Street';
    tiltBtn.title = 'Ground-level Street View — house-facing reference';
    tiltBtn.style.cssText = 'padding:0 9px;height:36px;border:none;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;background:#f59e0b;color:#fff;box-shadow:0 2px 4px rgba(0,0,0,0.35);';
    tiltBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openStreetViewRef.current?.();
    });
    compassPanel.appendChild(tiltBtn);

    mapInstance.controls[window.google.maps.ControlPosition.BOTTOM_CENTER].push(compassPanel);

    // ─── Tilt angle row (vector mode only — needs mapId) ───────────────────
    // When a mapId is provided, Google uses the vector renderer which supports
    // any tilt from 0° up to ~67°. On the default raster map only 0° and 45° work.
    if (mapId) {
      mapInstance.controls[window.google.maps.ControlPosition.BOTTOM_CENTER].push(
        createTiltControl({
          map: mapInstance,
          // Going flat also re-arms the top-down button in the compass row.
          onTiltChange: (tilt) => {
            setPerspectiveView(tilt > 0);
            if (tilt === 0) topDownBtn.style.background = '#111827';
          },
        })
      );
    }

    // Heading/tilt status indicator (top-right)
    const statusDiv = document.createElement('div');
    statusDiv.style.cssText = 'margin:8px 8px 0 0;background:rgba(255,255,255,0.92);border-radius:4px;padding:3px 8px;font-size:11px;font-weight:600;color:#374151;box-shadow:0 1px 3px rgba(0,0,0,0.2);white-space:nowrap;';
    statusDiv.textContent = 'Top-down · N';
    mapInstance.controls[window.google.maps.ControlPosition.TOP_RIGHT].push(statusDiv);

    const updateStatus = () => {
      const h = mapInstance.getHeading() || 0;
      const t = Math.round(mapInstance.getTilt() || 0);
      setPerspectiveView(t > 0);
      const dirLabels = ['N','NE','E','SE','S','SW','W','NW'];
      const dir = dirLabels[Math.round(h / 45) % 8];
      statusDiv.textContent = t > 0 ? `${t}° · ${dir}` : `Top-down · ${dir}`;
    };
    mapInstance.addListener('heading_changed', updateStatus);
    mapInstance.addListener('tilt_changed', updateStatus);

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

  const traceGraph = useMemo(() => {
    const lat0 = Number(resolvedLat);
    const lng0 = Number(resolvedLng);
    if (!Number.isFinite(lat0) || !Number.isFinite(lng0)) {
      return buildTracedRoofGraph({ facets: [] });
    }
    const feetPerLatDegree = 111320 * 3.28084;
    const feetPerLngDegree = feetPerLatDegree * Math.cos(lat0 * Math.PI / 180);
    const facets = sections.map((section) => {
      const polygon = sectionPolygons[section.id];
      if (!polygon?.getPath) return null;
      const path = polygon.getPath();
      const points = [];
      for (let i = 0; i < path.getLength(); i++) {
        const p = path.getAt(i);
        points.push({
          x: (p.lng() - lng0) * feetPerLngDegree,
          y: (p.lat() - lat0) * feetPerLatDegree,
        });
      }
      return {
        id: `manual_facet_${section.id}`,
        label: section.name,
        polygon: points,
        pitch: section.pitch || pitch,
        azimuth_degrees: Number(section.azimuth_degrees ?? 180),
        confidence: 1,
      };
    }).filter(Boolean);
    return buildTracedRoofGraph({ facets, weldToleranceFt: 1.5 });
  }, [sectionPolygons, sections, pitch, geometryRevision, resolvedLat, resolvedLng]);

  const traceWarnings = traceGraph.warnings || [];
  const traceHasDisconnectedFacets = traceWarnings.some(w => String(w).startsWith('disconnected_facets:'));
  const traceReady = traceGraph.totals.facet_count > 0
    && traceGraph.totals.open_boundary_count === 0
    && !traceHasDisconnectedFacets;

  // Draw the edge classification produced by the facet graph. These lines are
  // derived from the polygons and never become a second source of quantities.
  useEffect(() => {
    classifiedEdgeLinesRef.current.forEach(line => line.setMap(null));
    classifiedEdgeLinesRef.current = [];
    const map = mapInstanceRef.current;
    const G = window.google?.maps;
    if (!map || !G || traceGraph.edges.length === 0) return;
    const feetPerLatDegree = 111320 * 3.28084;
    const feetPerLngDegree = feetPerLatDegree * Math.cos(Number(resolvedLat) * Math.PI / 180);
    traceGraph.edges.forEach((edge) => {
      const path = [
        { lat: Number(resolvedLat) + edge.y1 / feetPerLatDegree, lng: Number(resolvedLng) + edge.x1 / feetPerLngDegree },
        { lat: Number(resolvedLat) + edge.y2 / feetPerLatDegree, lng: Number(resolvedLng) + edge.x2 / feetPerLngDegree },
      ];
      classifiedEdgeLinesRef.current.push(new G.Polyline({
        path,
        map,
        clickable: false,
        strokeColor: LINE_COLORS[edge.type] || '#334155',
        strokeWeight: edge.open_boundary ? 7 : 5,
        strokeOpacity: edge.open_boundary ? 0.95 : 0.8,
        zIndex: 35,
      }));
    });
    return () => {
      classifiedEdgeLinesRef.current.forEach(line => line.setMap(null));
      classifiedEdgeLinesRef.current = [];
    };
  }, [traceGraph, resolvedLat, resolvedLng]);

  const totalSqft = traceGraph.totals.plan_area_sqft;
  const totalSQ = totalSqft / 100;
  const pitchRise = Number.parseFloat(pitch) || 6;
  const slopeMultiplier = totalSqft > 0
    ? traceGraph.totals.roof_area_sqft / totalSqft
    : pitchMultiplier(pitchRise);
  const totalSqftPitched = traceGraph.totals.roof_area_sqft;
  const totalSQPitched = totalSqftPitched / 100;

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
      const isLatLng = result.data.detected_lines_format === 'latlng';

      // Legacy fallback: 0-1000 normalized image coords need map bounds to convert
      let toLat, toLng;
      if (!isLatLng) {
        const bounds = mapInstanceRef.current.getBounds();
        if (!bounds) throw new Error('Map bounds not available yet');
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        const north = ne.lat(), south = sw.lat(), east = ne.lng(), west = sw.lng();
        toLat = (y) => north - (y / 1000) * (north - south);
        toLng = (x) => west + (x / 1000) * (east - west);
      }

      const newFeatures = [];
      let totalDrawn = 0;

      for (const [lineType, lines] of Object.entries(detectedLines)) {
        if (!LINE_COLORS[lineType] || !Array.isArray(lines) || lines.length === 0) continue;
        for (const line of lines) {
          let p1, p2;
          if (isLatLng) {
            if (line.lat1 == null || line.lng1 == null || line.lat2 == null || line.lng2 == null) continue;
            p1 = new window.google.maps.LatLng(line.lat1, line.lng1);
            p2 = new window.google.maps.LatLng(line.lat2, line.lng2);
          } else {
            if (line.x1 == null || line.y1 == null || line.x2 == null || line.y2 == null) continue;
            p1 = new window.google.maps.LatLng(toLat(line.y1), toLng(line.x1));
            p2 = new window.google.maps.LatLng(toLat(line.y2), toLng(line.x2));
          }
          const polyline = new window.google.maps.Polyline({
            path: [p1, p2],
            strokeColor: LINE_COLORS[lineType],
            strokeWeight: LINE_STROKE_WEIGHT + 1,  // slightly thicker so AI lines stand out
            strokeOpacity: 0.9,
            editable: false,
            draggable: false,
            map: mapInstanceRef.current,
          });
          const fid = Date.now() + Math.random();
          newFeatures.push({ id: fid, type: lineType, polyline, sectionId: activeSectionId, color: LINE_COLORS[lineType], aiGenerated: true });
          featureHandlesRef.current[fid] = makePolylineEditable(polyline, LINE_COLORS[lineType]);
          totalDrawn++;
        }
      }

      setFeatures(prev => [...prev, ...newFeatures]);
      setAIDetectionNote(totalDrawn > 0
        ? `AI drew ${totalDrawn} lines on the map. Drag the white dots to adjust them.`
        : `AI could not find roof lines for this address. Try drawing them manually below.`);

      // Set pitch from AI if available. This is a SUGGESTION from the same imagery
      // pipeline, not a human verification, so it does NOT auto-confirm.
      if (result.data.pitch) { setPitch(result.data.pitch); setPitchAISuggested(true); }
    } catch (e) {
      setAIDetectionNote(`AI detection failed: ${e.message}`);
    }
    setIsAIDetecting(false);
  };

  // Rotate ALL AI-drawn lines together around their shared center, so the user
  // can snap the whole skeleton onto an angled roof in one motion.
  const rotateAILines = (deltaDeg) => {
    const G = window.google?.maps;
    if (!G) return;
    const aiFeatures = features.filter(f => f.aiGenerated);
    if (aiFeatures.length === 0) return;

    // Find the shared center of every point on every AI line
    const pts = [];
    aiFeatures.forEach(f => {
      const path = f.polyline.getPath();
      for (let i = 0; i < path.getLength(); i++) {
        const p = path.getAt(i);
        pts.push({ lat: p.lat(), lng: p.lng() });
      }
    });
    if (pts.length === 0) return;
    const cLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const cLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;

    const D2R = Math.PI / 180;
    const mPerLat = 111320;
    const mPerLng = 111320 * Math.cos(cLat * D2R);
    const theta = deltaDeg * D2R;
    const cosT = Math.cos(theta), sinT = Math.sin(theta);

    aiFeatures.forEach(f => {
      const path = f.polyline.getPath();
      const newPath = [];
      for (let i = 0; i < path.getLength(); i++) {
        const p = path.getAt(i);
        const x = (p.lng() - cLng) * mPerLng;
        const y = (p.lat() - cLat) * mPerLat;
        const xr = x * cosT - y * sinT;
        const yr = x * sinT + y * cosT;
        newPath.push(new G.LatLng(cLat + yr / mPerLat, cLng + xr / mPerLng));
      }
      f.polyline.setPath(newPath);
      featureHandlesRef.current[f.id]?.refresh?.();
    });
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

  // Opens & scrolls to the house-facing Street View reference panel. Reassigned every
  // render so the map's N/E/S/W + Sides buttons always call the freshest version.
  openStreetViewRef.current = () => {
    setStreetViewOpen(true);
    if (streetViewImages.length === 0 && !isLoadingStreetView) handleLoadStreetView();
    setTimeout(() => {
      document.querySelector('[data-testid="btn-street-view-toggle"]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
  };
  setCompassPanoDirRef.current = (dir) => setCompassPanoDir(dir);

  // Scroll compass Street View card into view after it renders.
  useEffect(() => {
    if (!compassPanoDir) return;
    const el = document.querySelector('[data-testid="card-compass-sv"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [compassPanoDir]);

  // ─────────────────
  //  DRAWING ACTIONS
  // ─────────────────
  // When drawing is active, existing shapes must NOT intercept map clicks/dblclicks,
  // otherwise the drawing manager never receives them and double-click does nothing.
  const setAllShapesClickable = (clickable) => {
    Object.values(sectionPolygonsRef.current).forEach(p => p?.setOptions({ clickable }));
    featuresRef.current.forEach(f => f.polyline?.setOptions({ clickable }));
  };

  const handleStartDrawing = (type) => {
    if (!drawingManagerRef.current) return;
    // Drawing on a tilted vector map is geographically anchored but visually
    // misleading: roofs and tree lines are rendered in perspective. Return
    // to the flat tracing surface automatically when the user starts a tool.
    const map = mapInstanceRef.current;
    if (map && (map.getTilt?.() || 0) > 0) {
      map.setTilt(0);
      map.setHeading(0);
      setPerspectiveView(false);
    }
    const mgr = drawingManagerRef.current;
    setAllShapesClickable(false); // stop existing shapes from eating clicks
    if (type === 'roof_outline') {
      const sId = activeSectionIdRef.current;
      const sIdx = Math.max(0, sectionsRef.current.findIndex(s => s.id === sId));
      const color = SECTION_COLORS[sIdx % SECTION_COLORS.length];
      mgr.setOptions({ polygonOptions: { fillColor: color.fill, strokeColor: color.stroke, fillOpacity: 0.2, strokeWeight: POLYGON_STROKE_WEIGHT, editable: true, draggable: false } });
      mgr.setDrawingMode('polygon');
    } else {
      mgr.setOptions({ polylineOptions: { strokeWeight: LINE_STROKE_WEIGHT, strokeColor: LINE_COLORS[type] || '#000', editable: true, draggable: false } });
      mgr.setDrawingMode('polyline');
    }
    setCurrentTool(type);
    currentToolRef.current = type;
    setDrawingVertexCount(0);
    setDrawingLengthFt(0);
    setSnapHint(null);
  };
  startDrawingRef.current = handleStartDrawing;

  const discardPendingAutoFacet = () => {
    const pending = pendingAutoFacetIdRef.current;
    pendingAutoFacetIdRef.current = null;
    if (pending == null || sectionPolygonsRef.current[pending]) return;
    const remaining = sectionsRef.current.filter(s => s.id !== pending);
    if (remaining.length === 0 || remaining.length === sectionsRef.current.length) return;
    sectionsRef.current = remaining;
    setSections(remaining);
    if (activeSectionIdRef.current === pending) {
      const nextActive = remaining[remaining.length - 1].id;
      activeSectionIdRef.current = nextActive;
      setActiveSectionId(nextActive);
    }
  };

  const handleCancelDrawing = () => {
    if (!drawingManagerRef.current) return;
    drawingManagerRef.current.setDrawingMode(null);
    setAllShapesClickable(true); // restore interaction on existing shapes
    setCurrentTool(null);
    currentToolRef.current = null;
    setDrawingVertexCount(0);
    setDrawingLengthFt(0);
    setSnapHint(null);
    discardPendingAutoFacet();
  };

  const handleFinishDrawing = () => {
    const polygonsBefore = Object.keys(sectionPolygonsRef.current).length;
    drawingManagerRef.current?.complete();
    // A valid shape restores clickability inside the complete listeners and
    // starts the next facet. If the shape had too few points to complete,
    // restore here so existing shapes don't get stuck unclickable.
    setAllShapesClickable(true);
    setCurrentTool(null);
    currentToolRef.current = null;
    setDrawingVertexCount(0);
    setDrawingLengthFt(0);
    if (Object.keys(sectionPolygonsRef.current).length === polygonsBefore) {
      discardPendingAutoFacet();
    }
  };

  const handleUndoPoint = () => {
    drawingManagerRef.current?.undoVertex();
  };

  const updateSection = (sId, patch) => {
    setSections(prev => prev.map(s => s.id === sId ? { ...s, ...patch } : s));
    if (patch.pitch != null) { setPitchConfirmed(true); setPitchAISuggested(false); }
  };

  const selectFacet = (sId) => {
    if (sId === activeSectionIdRef.current) return;
    if (currentToolRef.current) handleCancelDrawing();
    if (!sectionsRef.current.some((s) => s.id === sId)) return;
    activeSectionIdRef.current = sId;
    setActiveSectionId(sId);
  };

  const handleAddFacet = () => {
    if (currentToolRef.current) handleCancelDrawing();
    const plan = planNextFacet(
      sectionsRef.current.map(s => ({ id: s.id, hasPolygon: true })),
      null,
    );
    const section = {
      id: plan.id,
      name: plan.name,
      pitch: pitchRef.current || '7/12',
      azimuth_degrees: plan.azimuth_degrees,
    };
    const next = [...sectionsRef.current, section];
    sectionsRef.current = next;
    setSections(next);
    activeSectionIdRef.current = section.id;
    setActiveSectionId(section.id);
    pendingAutoFacetIdRef.current = null;
    setTimeout(() => startDrawingRef.current?.('roof_outline'), 0);
  };

  queueNextFacetRef.current = (completedId) => {
    const plan = planNextFacet(
      sectionsRef.current.map(s => ({
        id: s.id,
        hasPolygon: Boolean(sectionPolygonsRef.current[s.id]),
      })),
      completedId,
    );
    if (plan.action === 'select') {
      pendingAutoFacetIdRef.current = null;
      activeSectionIdRef.current = plan.id;
      setActiveSectionId(plan.id);
    } else {
      const section = {
        id: plan.id,
        name: plan.name,
        pitch: pitchRef.current || '7/12',
        azimuth_degrees: plan.azimuth_degrees,
      };
      const next = [...sectionsRef.current, section];
      sectionsRef.current = next;
      setSections(next);
      activeSectionIdRef.current = section.id;
      setActiveSectionId(section.id);
      pendingAutoFacetIdRef.current = section.id;
    }
    setTimeout(() => startDrawingRef.current?.('roof_outline'), 0);
  };

  const handleDeleteFacet = (sId) => {
    if (currentToolRef.current) {
      pendingAutoFacetIdRef.current = null;
      handleCancelDrawing();
    }
    handleClearSection(sId);
    if (sectionsRef.current.length <= 1) {
      updateSection(sId, { name: 'Facet 1' });
      return;
    }
    const remaining = sectionsRef.current.filter(s => s.id !== sId);
    sectionsRef.current = remaining;
    setSections(remaining);
    if (activeSectionIdRef.current === sId) {
      const nextActive = remaining[Math.max(0, remaining.length - 1)].id;
      activeSectionIdRef.current = nextActive;
      setActiveSectionId(nextActive);
    }
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
        title: `📷 ${crewCamPhotoCount} PhotoSync photo${crewCamPhotoCount !== 1 ? 's' : ''} at this property`,
        zIndex: 1000,
      });
      const infoWindow = new window.google.maps.InfoWindow({
        content: `<div style="font-size:13px;padding:4px 6px;"><strong>📷 PhotoSync</strong><br/>${crewCamPhotoCount} inspection photo${crewCamPhotoCount !== 1 ? 's' : ''} at this property</div>`,
      });
      crewCamMarkerRef.current.addListener('click', () => {
        infoWindow.open(mapInstanceRef.current, crewCamMarkerRef.current);
      });
    }
  }, [crewCamPhotoCount, latitude, longitude]);

  const destroyFeatureHandle = (fid) => {
    const h = featureHandlesRef.current[fid];
    if (h) { h.destroy(); delete featureHandlesRef.current[fid]; }
  };

  const handleDeleteSectionPolygon = (sId) => {
    const poly = sectionPolygons[sId];
    if (poly) poly.setMap(null);
    if (sectionHandlesRef.current[sId]) { sectionHandlesRef.current[sId].destroy(); delete sectionHandlesRef.current[sId]; }
    setSectionPolygons(prev => { const n = { ...prev }; delete n[sId]; return n; });
    setGeometryRevision(v => v + 1);
  };

  const handleUndo = () => {
    if (currentToolRef.current && drawingManagerRef.current?.undoVertex()) return;
    // Undo the single most-recently drawn item — polygon OR line — by comparing
    // creation timestamps (feature ids and polygon._drawnAt are both Date.now()).
    const lastFeature = features[features.length - 1];
    const lastFeatureTime = lastFeature ? lastFeature.id : -1;
    let newestPolyKey = null, newestPolyTime = -1;
    Object.entries(sectionPolygonsRef.current).forEach(([sId, poly]) => {
      const t = poly?._drawnAt || 0;
      if (t > newestPolyTime) { newestPolyTime = t; newestPolyKey = sId; }
    });
    if (newestPolyKey !== null && newestPolyTime >= lastFeatureTime) {
      handleDeleteSectionPolygon(Number(newestPolyKey));
    } else if (lastFeature) {
      lastFeature.polyline.setMap(null);
      destroyFeatureHandle(lastFeature.id);
      setFeatures(prev => prev.slice(0, -1));
    }
  };

  const handleClearSection = (sId) => {
    handleDeleteSectionPolygon(sId);
    features.filter(f => f.sectionId === sId).forEach(f => { f.polyline.setMap(null); destroyFeatureHandle(f.id); });
    setFeatures(prev => prev.filter(f => f.sectionId !== sId));
  };

  const handleClearAll = () => {
    Object.values(sectionPolygons).forEach(p => p.setMap(null));
    Object.values(sectionHandlesRef.current).forEach(h => h.destroy());
    sectionHandlesRef.current = {};
    setSectionPolygons({});
    features.forEach(f => { f.polyline.setMap(null); destroyFeatureHandle(f.id); });
    featureHandlesRef.current = {};
    setFeatures([]);
    setAIDetectionNote(null);
    gutterEditedRef.current = false;
  };

  useEffect(() => {
    if (!currentTool) return undefined;
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      const undoKey = e.key === 'Backspace' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z');
      if (!undoKey) return;
      e.preventDefault();
      drawingManagerRef.current?.undoVertex();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentTool]);

  const graphEdgeTotals = traceGraph.edge_totals || { ridge: 0, hip: 0, valley: 0, rake: 0, eave: 0 };
  const manualLineTotal = (type) => features
    .filter(f => f.type === type)
    .reduce((sum, f) => sum + calculateLineLength(f.polyline), 0);
  const manualTotals = MANUAL_LINE_TYPES.reduce((acc, type) => {
    acc[type] = manualLineTotal(type);
    return acc;
  }, {});
  const usedEdges = resolveEdgeTotals(graphEdgeTotals, manualTotals);
  const resolvedEdge = (type) => Number(usedEdges[type] || 0);
  const tracedFacetCount = Object.values(sectionPolygons).filter((poly) => (poly?.getPath?.()?.getLength?.() || 0) >= 3).length;
  // An open high edge used to disable Save. Facets live in sectionPolygons;
  // the button stayed off because a real trace rarely welds every ridge.
  const canSave = tracedFacetCount > 0;

  useEffect(() => {
    // Auto-fill gutter length from eaves, but never clobber a number the user typed.
    if (includeGutters && !gutterEditedRef.current) {
      const eaves = resolvedEdge('eave');
      setGutterLF(eaves);
      setDownspoutCount(Math.ceil(eaves / 35));
    }
  }, [includeGutters, features, traceGraph]);

  const handleDeleteFeature = (fid) => {
    const feature = featuresRef.current.find((item) => item.id === fid);
    if (!feature) return;
    feature.polyline?.setMap(null);
    destroyFeatureHandle(fid);
    setFeatures((prev) => prev.filter((item) => item.id !== fid));
  };

  const handleSaveMeasurements = () => {
    if (tracedFacetCount === 0) {
      alert("Please draw at least one roof facet first");
      return;
    }
    // Soft gate: pitch sets the whole roof area, so warn before shipping a default guess.
    if (!pitchConfirmed) {
      const proceed = window.confirm(
        `You haven't confirmed the roof pitch (${pitchAISuggested ? `AI-suggested ${pitch}, not yet verified` : `using the default ${pitch}`}).\n\n` +
        `Pitch determines the ENTIRE roof area — a wrong pitch throws off the whole estimate.\n\n` +
        `Use these measurements anyway?`
      );
      if (!proceed) return;
    }
    const manualLines = featuresRef.current.map((feature) => ({
      id: feature.id,
      type: feature.type,
      section_id: feature.sectionId,
      length_ft: Math.round(calculateLineLength(feature.polyline) * 100) / 100,
    }));
    onMeasurementsComplete({
      // roof_area_* stay FLAT footprint (matches the satellite convention);
      // corrected_area_* apply pitch plus standard overhang and are what
      // materials order against.
      roof_area_sqft: traceGraph.totals.plan_area_sqft,
      roof_area_sq: traceGraph.totals.plan_area_sqft / 100,
      corrected_area_sqft: traceGraph.totals.roof_area_sqft,
      corrected_area_sq: traceGraph.totals.roof_area_sqft / 100,
      pitch_multiplier: traceGraph.totals.plan_area_sqft > 0
        ? traceGraph.totals.roof_area_sqft / traceGraph.totals.plan_area_sqft
        : 1,
      ridge_lf: usedEdges.ridge,
      valley_lf: usedEdges.valley,
      rake_lf: usedEdges.rake,
      eave_lf: usedEdges.eave,
      hip_lf: usedEdges.hip,
      step_flashing_lf: usedEdges.step_flashing,
      drip_edge_lf: usedEdges.drip_edge,
      drip_edge_source: usedEdges.drip_edge_source,
      manual_lines: manualLines,
      pitch: sections.length === 1 ? (sections[0].pitch || pitch) : 'Mixed',
      predominant_pitch: sections[0]?.pitch || pitch,
      measurement_source: 'manual_roof_trace',
      measurement_source_label: 'Manual roof trace',
      measurement_ready: true,
      requires_manual_review: false,
      manual_trace: true,
      roof_facets: traceGraph.facets,
      roof_facet_edge_totals: traceGraph.edge_totals,
      roof_measurement_graph: traceGraph,
      sections: sections.map(s => ({
        id: s.id, name: s.name,
        pitch: s.pitch || pitch,
        azimuth_degrees: Number(s.azimuth_degrees ?? 180),
        area_sqft: traceGraph.facets.find(f => f.id === `manual_facet_${s.id}`)?.plan_area_sqft || 0,
        area_sqft_pitched: traceGraph.facets.find(f => f.id === `manual_facet_${s.id}`)?.area_sqft || 0,
        measurements: sectionMeasurements[s.id]
      })),
      gutter_lf: includeGutters ? gutterLF : 0,
      downspout_count: includeGutters ? downspoutCount : 0
    });
  };

  return (
    <div className="space-y-4" data-testid="manual-trace-root">
      {/* Header. Add-on mode already has a title on the parent card. */}
      <div className="flex items-center justify-between gap-2">
        {purpose !== 'addon' ? (
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Pencil className="w-5 h-5 text-blue-600" />
            Manual Roof Trace
          </h3>
        ) : <span className="text-sm font-medium text-gray-700">Trace each plane of this extra structure</span>}
        <Button variant="outline" size="sm" onClick={onBack} className="min-h-11 touch-manipulation">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-sm text-blue-800 font-medium">📍 {address}</p>
        <p className="text-xs text-blue-600 mt-1">
          {purpose === 'addon'
            ? 'Outline every plane, then use the measurements. They are added to the automatic total.'
            : 'Trace every roof plane as its own facet. Shared corners snap together and the app calculates area, ridge, hip, valley, rake, and eave lengths.'}
        </p>
      </div>

      {/* ─── COMPASS STREET VIEW — single face shown when N/E/S/W clicked ─── */}
      {compassPanoDir && (
        <Card className="border-indigo-200" data-testid="card-compass-sv">
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-indigo-600" />
              <span className="font-semibold text-sm text-indigo-900">
                {{ 0: 'North', 90: 'East', 180: 'South', 270: 'West' }[compassPanoDir.deg]} Face
              </span>
              <span className="text-xs text-indigo-500">Drag to look around</span>
            </div>
            <button
              onClick={() => setCompassPanoDir(null)}
              className="text-gray-400 hover:text-gray-600 text-xs px-2 py-1 rounded hover:bg-gray-100"
              data-testid="btn-close-compass-sv"
            >✕ Close</button>
          </div>
          <CardContent className="pt-0 pb-4">
            <CompassStreetView
              latitude={latitude}
              longitude={longitude}
              compassDeg={compassPanoDir.deg}
              googleMapsLoaded={googleMapsLoaded}
            />
          </CardContent>
        </Card>
      )}

      {/* ─── STREET VIEW ─── */}
      <Card className="border-indigo-200">
        <button
          className="w-full flex items-center justify-between p-4 text-left"
          onClick={() => { setStreetViewOpen(o => !o); if (!streetViewOpen && streetViewImages.length === 0) handleLoadStreetView(); }}
          data-testid="btn-street-view-toggle"
        >
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-indigo-600" />
            <span className="font-semibold text-sm text-indigo-900">Street View — House-Facing Reference</span>
            <span className="text-xs text-indigo-500">Reference only; upload each elevation for measurements</span>
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

      {/* ─── MAP ─── */}
      <div className="relative">
        {geocodingState === 'loading' && (
          <div className="w-full h-[600px] rounded-lg border-2 border-gray-200 flex items-center justify-center bg-gray-50">
            <div className="text-center text-gray-500">
              <div className="animate-spin w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-2" />
              <p className="text-sm">Loading satellite view...</p>
            </div>
          </div>
        )}
        {geocodingState === 'error' && (
          <div className="w-full h-[600px] rounded-lg border-2 border-gray-200 flex items-center justify-center bg-gray-50">
            <div className="text-center text-gray-500">
              <p className="text-sm text-red-500 mb-2">Could not locate property address on map</p>
              <p className="text-xs text-gray-400">{address}</p>
            </div>
          </div>
        )}
        <div ref={mapRef} className={`w-full h-[52vh] min-h-[280px] md:h-[600px] rounded-lg border-2 border-gray-300 shadow-lg ${geocodingState !== 'done' ? 'hidden' : ''}`} style={{ zIndex: 1, touchAction: currentTool ? 'none' : 'manipulation' }} />

        {snapHint && geocodingState === 'done' && (
          <div
            data-testid="snap-indicator"
            className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full border border-yellow-500 bg-yellow-300 px-3 py-1.5 text-xs font-semibold text-yellow-950 shadow-md"
          >
            Snapped to {snapHint === 'vertex' ? 'shared corner' : 'shared edge'}
          </div>
        )}

        {perspectiveView && geocodingState === 'done' && (
          <div
            className="absolute left-3 right-3 top-3 z-10 rounded-lg border border-amber-300 bg-amber-50/95 px-3 py-2 text-xs font-medium text-amber-900 shadow-md"
            data-testid="perspective-view-warning"
          >
            3D perspective view — visual reference only. Return to <strong>Top</strong> before tracing roof edges.
          </div>
        )}
        {/* Bullseye, compass indicator, and N/E/S/W/3D controls are all
            injected as native Google Maps controls during map init */}
      </div>

      {/* ─── STEP 1: Facets ─── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">STEP 1: Trace Facets</CardTitle>
          <p className="text-sm text-gray-600">Choose a facet, then tap the map to place corners. <strong>Done</strong>, or a double-click / double-tap, finishes that facet and starts the next one. Corners snap to existing facet points.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1" role="tablist" data-testid="facet-list">
              {sections.map((section, idx) => {
                const color = SECTION_COLORS[idx % SECTION_COLORS.length];
                const selected = section.id === activeSectionId;
                const drawn = Boolean(sectionPolygons[section.id]);
                return (
                  <button
                    key={section.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    data-testid={`facet-tab-${section.id}`}
                    onClick={() => selectFacet(section.id)}
                    className={`flex min-h-11 shrink-0 touch-manipulation items-center gap-2 rounded-full border px-3 text-sm font-medium ${selected ? 'ring-2 ring-offset-1' : ''}`}
                    style={{ borderColor: color.stroke, color: color.stroke, backgroundColor: selected ? color.fill + '22' : 'white', ringColor: color.stroke }}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color.fill }} />
                    {section.name}
                    {drawn ? ' ✓' : ''}
                  </button>
                );
              })}
            </div>
            <Button type="button" size="sm" onClick={handleAddFacet} data-testid="button-add-facet" className="min-h-11 shrink-0 touch-manipulation">
              <Plus className="w-4 h-4 mr-1" />
              Add Facet
            </Button>
          </div>

          {getActiveSection() && (
            <div className="grid grid-cols-1 gap-3 rounded-lg border bg-gray-50 p-3 sm:grid-cols-2" data-testid="active-facet-editor">
              <div>
                <Label htmlFor="active-facet-name">Name</Label>
                <Input
                  id="active-facet-name"
                  data-testid="input-active-facet-name"
                  value={getActiveSection().name}
                  onChange={(e) => updateSection(activeSectionId, { name: e.target.value })}
                  className="mt-1 h-11"
                />
              </div>
              <div>
                <Label htmlFor="active-facet-pitch">Pitch</Label>
                <Input
                  id="active-facet-pitch"
                  data-testid="input-active-facet-pitch"
                  value={getActiveSection().pitch || ''}
                  onChange={(e) => updateSection(activeSectionId, { pitch: e.target.value })}
                  placeholder="7/12"
                  className="mt-1 h-11"
                />
              </div>
              <div>
                <Label htmlFor="active-facet-direction">Downslope</Label>
                <select
                  id="active-facet-direction"
                  data-testid="select-active-facet-direction"
                  value={String(getActiveSection().azimuth_degrees ?? 180)}
                  onChange={(e) => updateSection(activeSectionId, { azimuth_degrees: Number(e.target.value) })}
                  className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {DIRECTION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-gray-500">Direction water runs off this plane. It decides ridge, hip, valley, and eave.</p>
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleDeleteFacet(activeSectionId)}
                  data-testid="button-delete-active-facet"
                  className="min-h-11 w-full touch-manipulation text-red-600 hover:text-red-700"
                >
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  {sections.length > 1 ? 'Delete facet' : 'Clear facet'}
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={() => currentTool === 'roof_outline' ? handleCancelDrawing() : handleStartDrawing('roof_outline')}
              variant={currentTool === 'roof_outline' ? 'default' : 'outline'}
              className="min-h-11 flex-1 touch-manipulation"
              style={currentTool !== 'roof_outline' ? { borderColor: getSectionColor(activeSectionId).stroke, color: getSectionColor(activeSectionId).stroke } : {}}
              data-testid="draw-roof-outline"
            >
              <Ruler className="w-4 h-4 mr-2" />
              {currentTool === 'roof_outline'
                ? `Drawing ${getActiveSection()?.name}… tap the map`
                : sectionPolygons[activeSectionId]
                  ? `Redraw ${getActiveSection()?.name}`
                  : `Draw ${getActiveSection()?.name}`}
            </Button>
            {currentTool === 'roof_outline' && (
              <>
                <Button size="sm" className="min-h-11 touch-manipulation bg-green-600 text-white hover:bg-green-700" onClick={handleFinishDrawing} data-testid="btn-finish-drawing">Done ✓</Button>
                <Button variant="outline" size="sm" className="min-h-11 touch-manipulation" onClick={handleUndoPoint} disabled={drawingVertexCount === 0} data-testid="button-undo-point">
                  <Undo className="w-4 h-4 mr-1" />Undo Point
                </Button>
                <Button variant="outline" size="sm" className="min-h-11 touch-manipulation" onClick={handleCancelDrawing} data-testid="btn-cancel-drawing">Cancel</Button>
              </>
            )}
          </div>
          {currentTool === 'roof_outline' && (
            <p className="text-xs text-gray-600" data-testid="drawing-point-count">
              {drawingVertexCount} point{drawingVertexCount === 1 ? '' : 's'}
              {drawingLengthFt > 0 ? ` · ${drawingLengthFt.toFixed(1)} ft` : ''}
              {drawingVertexCount >= 3 ? ' — Done or double-click closes this facet' : ' — place at least 3 corners'}
              {Object.keys(sectionPolygons).length > 0 ? '. Hold near an existing corner to snap.' : ''}
            </p>
          )}

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
                  <span className="font-bold">{((traceGraph.facets.find(f => f.id === `manual_facet_${section.id}`)?.area_sqft || 0) / 100).toFixed(2)} SQ</span>
                  <span className="text-gray-500 text-xs">(footprint {(sqft / 100).toFixed(2)} SQ)</span>
                  <button onClick={() => handleDeleteSectionPolygon(section.id)} className="ml-1 text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                </div>
              );
            })}
          </div>

          {Object.keys(sectionPolygons).length > 0 && (
            <div className="space-y-2">
              <div className="p-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold text-blue-900">Traced Roof Area:</span>
                  <p className="text-[11px] text-blue-500">Footprint {totalSQ.toFixed(2)} SQ ({totalSqft.toFixed(0)} ft²)</p>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-bold text-blue-700">{totalSQPitched.toFixed(2)} SQ</span>
                  <span className="text-xs text-blue-500 ml-2">({totalSqftPitched.toFixed(0)} ft²)</span>
                </div>
              </div>
              <div
                className={`flex items-start gap-2 rounded-lg border p-3 ${traceReady ? 'border-green-200 bg-green-50' : 'border-amber-300 bg-amber-50'}`}
                data-testid="manual-trace-topology-status"
              >
                {traceReady
                  ? <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                  : <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />}
                <div>
                  <p className={`text-sm font-semibold ${traceReady ? 'text-green-900' : 'text-amber-900'}`}>
                    {traceReady ? 'Roof topology is closed' : 'Finish connecting the roof facets'}
                  </p>
                  <p className={`text-xs mt-0.5 ${traceReady ? 'text-green-700' : 'text-amber-800'}`}>
                    {traceReady
                      ? `${traceGraph.totals.facet_count} facet${traceGraph.totals.facet_count === 1 ? '' : 's'} connected with no open high edges. ${purpose === 'addon' ? 'This structure will be added to the automatic measurement.' : 'This trace can replace the automatic measurement.'}`
                      : traceGraph.totals.open_boundary_count > 0
                        ? `${traceGraph.totals.open_boundary_count} high edge${traceGraph.totals.open_boundary_count === 1 ? '' : 's'} still need a neighboring facet. Keep drawing — the next facet starts automatically — and snap its corners onto the highlighted edge.`
                        : 'Some facets are disconnected. Snap neighboring corners together so the roof forms one measured graph.'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── STEP 2: Classified edges + optional overrides ─── */}
      <Card data-testid="step-review-edges">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">STEP 2: Review Edges</CardTitle>
              <p className="text-sm text-gray-600 mt-0.5">Colored lines come from the facet topology across every plane. Shared ridge, hip, and valley lengths are counted once.</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="trace-edge-totals">
            {MANUAL_LINE_TYPES.map((type) => {
              const manual = manualTotals[type] || 0;
              const auto = type === 'drip_edge'
                ? (resolvedEdge('eave') + resolvedEdge('rake'))
                : Number(graphEdgeTotals[type] || 0);
              const used = resolvedEdge(type);
              return (
                <div key={type} className="rounded-md border px-2 py-2 text-sm" data-testid={`edge-total-${type}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-gray-600">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: LINE_COLORS[type] }} />
                      {LINE_LABELS[type]}
                    </span>
                    <span className="font-semibold">{used.toFixed(1)} LF</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-gray-500">
                    {manual > 0 ? `Drawn ${manual.toFixed(1)} ft replaces ${auto.toFixed(1)}` : `From trace ${auto.toFixed(1)} ft`}
                  </p>
                </div>
              );
            })}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-gray-800">Draw a line</p>
            <p className="mb-2 text-xs text-gray-500">Pick a type, click the map, then Done or double-click. The length is in feet. A drawn line replaces the traced total for that type.</p>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {MANUAL_LINE_TYPES.map(type => (
                <Button
                  key={type}
                  onClick={() => currentTool === type ? handleCancelDrawing() : handleStartDrawing(type)}
                  variant={currentTool === type ? 'default' : 'outline'}
                  size="sm"
                  className="min-h-11 touch-manipulation capitalize"
                  style={currentTool === type ? { backgroundColor: LINE_COLORS[type], borderColor: LINE_COLORS[type] } : { borderColor: LINE_COLORS[type], color: LINE_COLORS[type] }}
                  data-testid={`draw-${type}`}
                >
                  <div className="w-3 h-3 rounded-full mr-1.5 flex-shrink-0" style={{ backgroundColor: LINE_COLORS[type] }} />
                  {LINE_LABELS[type]}
                </Button>
              ))}
            </div>
            {currentTool && currentTool !== 'roof_outline' && (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <span className="flex-1 text-xs text-gray-600" data-testid="drawing-line-status">
                  Drawing <strong>{LINE_LABELS[currentTool] || currentTool}</strong>
                  {drawingVertexCount > 0 ? ` · ${drawingVertexCount} point${drawingVertexCount === 1 ? '' : 's'}` : ''}
                  {drawingLengthFt > 0 ? ` · ${drawingLengthFt.toFixed(1)} ft` : ''}
                  {' '}— Done or double-click finishes the line
                </span>
                <Button size="sm" className="min-h-11 bg-green-600 text-white hover:bg-green-700 touch-manipulation" onClick={handleFinishDrawing} data-testid="btn-finish-line-drawing">Done ✓</Button>
                <Button size="sm" variant="outline" className="min-h-11 touch-manipulation" onClick={handleUndoPoint} disabled={drawingVertexCount === 0} data-testid="button-undo-line-point">Undo Point</Button>
                <Button size="sm" variant="outline" className="min-h-11 touch-manipulation" onClick={handleCancelDrawing} data-testid="btn-cancel-line-drawing">Cancel</Button>
              </div>
            )}
          </div>

          {features.length > 0 && (
            <div className="space-y-1.5" data-testid="manual-line-list">
              {features.map((feature) => {
                const lengthFt = calculateLineLength(feature.polyline);
                return (
                  <div key={feature.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm" data-testid="manual-line-row">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: feature.color || LINE_COLORS[feature.type] }} />
                    <span className="font-medium">{LINE_LABELS[feature.type] || feature.type}</span>
                    <span className="text-gray-700" data-testid="manual-line-length">{lengthFt.toFixed(1)} ft</span>
                    <button
                      type="button"
                      className="ml-auto min-h-11 px-2 text-xs font-medium text-red-600 touch-manipulation"
                      onClick={() => handleDeleteFeature(feature.id)}
                      data-testid="button-delete-line"
                    >
                      Delete
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            {Object.entries(LINE_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center gap-1">
                <div className="h-1.5 w-5 rounded" style={{ backgroundColor: color }} />
                <span className="capitalize">{type.replace('_', ' ')}</span>
              </div>
            ))}
          </div>

          {/* Optional overrides and the rough AI helper stay out of the main path. */}
          <details data-testid="manual-trace-advanced" className="rounded-lg border border-gray-200 bg-gray-50">
            <summary className="min-h-11 cursor-pointer list-none px-3 py-3 text-sm font-semibold text-gray-800 touch-manipulation">
              Advanced — optional overrides and AI helper
            </summary>
            <div className="space-y-3 px-3 pb-3">
          <details className="p-3 bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-200 rounded-lg">
            <summary className="cursor-pointer text-sm font-semibold text-violet-900">
              Optional: rough AI line helper
            </summary>
            <div className="space-y-2 mt-2">
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

            {features.some(f => f.aiGenerated) && (
              <div className="pt-2 mt-1 border-t border-violet-200 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Move className="w-3.5 h-3.5 text-violet-600" />
                  <span className="text-xs font-medium text-violet-800">Roof at an angle? Rotate all AI lines to match:</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => rotateAILines(5)} className="flex-1 border-violet-300 text-violet-700 hover:bg-violet-100" data-testid="btn-rotate-ai-ccw-5">
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />5°
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => rotateAILines(1)} className="flex-1 border-violet-300 text-violet-700 hover:bg-violet-100" data-testid="btn-rotate-ai-ccw-1">
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />1°
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => rotateAILines(-1)} className="flex-1 border-violet-300 text-violet-700 hover:bg-violet-100" data-testid="btn-rotate-ai-cw-1">
                    1°<RotateCw className="w-3.5 h-3.5 ml-1" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => rotateAILines(-5)} className="flex-1 border-violet-300 text-violet-700 hover:bg-violet-100" data-testid="btn-rotate-ai-cw-5">
                    5°<RotateCw className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </div>
              </div>
            )}
            {features.some(f => f.aiGenerated) && !currentTool && (
              <Button
                onClick={() => measurementsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="bg-green-600 hover:bg-green-700 text-white w-full mt-2"
                data-testid="btn-ai-lines-done"
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Done ✓ — Lines Look Good
              </Button>
            )}
            </div>
          </details>

          {features.some(f => f.aiGenerated) && (
            <p className="text-xs text-violet-700">{features.filter(f => f.aiGenerated).length} AI line{features.filter(f => f.aiGenerated).length === 1 ? '' : 's'} are listed with the drawn lines above.</p>
          )}
            </div>
          </details>

          <div className="flex gap-2 flex-wrap">
            <Button onClick={handleUndo} variant="outline" size="sm" disabled={features.length === 0 && Object.keys(sectionPolygons).length === 0}>
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
              <Input type="number" value={gutterLF} onChange={(e) => { gutterEditedRef.current = true; setGutterLF(Number(e.target.value)); }} className="mt-1" data-testid="input-gutter-lf" />
              <p className="text-xs text-gray-500 mt-1">Auto-filled from eave measurements</p>
            </div>
            <div>
              <Label>Number of Downspouts</Label>
              <Input type="number" value={downspoutCount} onChange={(e) => { gutterEditedRef.current = true; setDownspoutCount(Number(e.target.value)); }} className="mt-1" data-testid="input-downspout-count" />
              <p className="text-xs text-gray-500 mt-1">Typically 1 per 30–40 LF</p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ─── STEP 3: Use measurements ─── */}
      <Card ref={measurementsRef}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">STEP 3: Use Measurements</CardTitle>
          <p className="text-sm text-gray-600">Totals cover every traced facet. A shared edge is counted once.</p>
        </CardHeader>
        <CardContent>
          <div className="p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200" data-testid="trace-summary-totals">
            <p className="text-sm font-semibold text-gray-900 mb-1">All facets</p>
            <p className="text-3xl font-bold text-blue-700">{totalSQPitched.toFixed(2)} SQ</p>
            <p className="text-xs text-gray-600">({totalSqftPitched.toFixed(0)} ft²) · Footprint {totalSQ.toFixed(2)} SQ</p>
            <div className="mt-2 grid grid-cols-2 gap-1 text-sm text-gray-700 sm:grid-cols-3">
              <div>Ridge {resolvedEdge('ridge').toFixed(1)} LF</div>
              <div>Hip {resolvedEdge('hip').toFixed(1)} LF</div>
              <div>Valley {resolvedEdge('valley').toFixed(1)} LF</div>
              <div>Rake {resolvedEdge('rake').toFixed(1)} LF</div>
              <div>Eave {resolvedEdge('eave').toFixed(1)} LF</div>
              <div>Drip edge {resolvedEdge('drip_edge').toFixed(1)} LF</div>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {sections.map((section, idx) => {
              const poly = sectionPolygons[section.id];
              if (!poly) return null;
              const facet = traceGraph.facets.find(f => f.id === `manual_facet_${section.id}`);
              const edges = sumFacetEdgeLengths(facet?.edges);
              const color = SECTION_COLORS[idx % SECTION_COLORS.length];
              return (
                <div key={section.id} className="rounded-lg border p-3" style={{ borderColor: color.fill }} data-testid={`facet-summary-${section.id}`}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color.fill }} />
                    <p className="text-sm font-semibold">{section.name}</p>
                    <span className="ml-auto text-xs text-gray-600">{((facet?.area_sqft || 0) / 100).toFixed(2)} SQ · {section.pitch || pitch}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs text-gray-600 sm:grid-cols-3">
                    <div>Ridge {edges.ridge.toFixed(1)}</div>
                    <div>Hip {edges.hip.toFixed(1)}</div>
                    <div>Valley {edges.valley.toFixed(1)}</div>
                    <div>Rake {edges.rake.toFixed(1)}</div>
                    <div>Eave {edges.eave.toFixed(1)}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {includeGutters && (
            <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3">
              <p className="mb-1 text-sm font-semibold text-green-900">Gutters & Downspouts</p>
              <div className="grid grid-cols-2 gap-2 text-xs text-green-800">
                <div>Gutters: {gutterLF.toFixed(1)} LF</div>
                <div>Downspouts: {downspoutCount} EA</div>
              </div>
            </div>
          )}

          <div className="mt-4">
            <Label>Default Pitch for New Facets</Label>
            <Input value={pitch} onChange={(e) => { setPitch(e.target.value); setPitchConfirmed(true); setPitchAISuggested(false); }} placeholder="e.g., 5/12, 7/12, 10/12" className="w-36 mt-1" data-testid="input-roof-pitch" />
            <p className="text-xs text-gray-500 mt-1">
              Each facet can have its own pitch above. Across the current trace, the combined slope multiplier is <strong>×{slopeMultiplier.toFixed(3)}</strong>.
            </p>
            <label className="flex items-center gap-2 mt-2 cursor-pointer" data-testid="check-pitch-confirmed">
              <Checkbox checked={pitchConfirmed} onCheckedChange={(v) => setPitchConfirmed(!!v)} />
              <span className="text-xs text-gray-700">I've verified this pitch matches the actual roof (Street View or a known value)</span>
            </label>
            {!pitchConfirmed && (
              <div className="flex items-start gap-2 mt-2 p-2 rounded-md bg-amber-50 border border-amber-200" data-testid="warn-pitch-unconfirmed">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800">
                  {pitchAISuggested
                    ? <>AI suggested this pitch from the satellite image — <strong>please verify it</strong> against the Street View above or a known value. Pitch sets your <strong>entire</strong> roof area, so a wrong pitch throws off the whole estimate.</>
                    : <>Pitch isn't confirmed yet — this is a default guess. Pitch sets your <strong>entire</strong> roof area, so a wrong pitch throws off the whole estimate. Check it against the Street View above or a known value.</>}
                </p>
              </div>
            )}
          </div>

          <Button
            onClick={handleSaveMeasurements}
            className="w-full bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700 text-white mt-4"
            disabled={!canSave}
            data-testid="save-measurements"
          >
            <Save className="w-4 h-4 mr-2" />
            Save Measurements
            {canSave && <Badge className="ml-2 bg-white/20">{totalSQPitched.toFixed(1)} SQ</Badge>}
          </Button>
          {!canSave && (
            <div className="flex items-start gap-2 mt-2 p-2 rounded-md bg-blue-50 border border-blue-200">
              <AlertTriangle className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-800">
                <strong>Draw a facet to save.</strong> Trace at least one roof plane. Open edges can stay open — drawn lines fill in any length the trace did not close.
              </p>
            </div>
          )}
          {canSave && !traceReady && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800" data-testid="save-open-edge-note">
              {traceGraph.totals.open_boundary_count} high edge{traceGraph.totals.open_boundary_count === 1 ? '' : 's'} still open. You can save now. Draw the neighboring facet, or draw the ridge, hip, rake, or eave yourself.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
