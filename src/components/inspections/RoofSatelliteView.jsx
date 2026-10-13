import { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Maximize2, Minimize2, Sparkles, Trash2, Undo2, AlertTriangle } from 'lucide-react';

const DIRECTIONS = [
  { label: 'N', heading: 0 },
  { label: 'E', heading: 90 },
  { label: 'S', heading: 180 },
  { label: 'W', heading: 270 },
];

const ROOF_COLORS = [
  { name: 'Main Roof', color: '#3B82F6', hex: 'blue' },
  { name: 'Garage', color: '#EF4444', hex: 'red' },
  { name: 'Porch', color: '#22C55E', hex: 'green' },
  { name: 'Addition', color: '#F59E0B', hex: 'amber' },
  { name: 'Shed/Other', color: '#8B5CF6', hex: 'purple' },
];

let _mapsLoadPromise = null;

// ─── ClickDrawingManager ──────────────────────────────────────────────────────
// Drop-in replacement for google.maps.drawing.DrawingManager (removed in v3.65).
// Builds polygons via map clicks; double-click completes the shape.
// ─────────────────────────────────────────────────────────────────────────────
class ClickDrawingManager {
  constructor(opts = {}) {
    this._opts = opts; this._map = null; this._mode = opts.drawingMode || null;
    this._vertices = []; this._dots = []; this._preview = null;
    this._clickL = null; this._dblL = null; this._handlers = {};
  }
  setMap(map) { this._map = map; if (map && this._mode) this._bind(); }
  setDrawingMode(mode) { this._reset(); this._mode = mode; if (mode && this._map) this._bind(); }
  addListener(event, fn) {
    (this._handlers[event] = this._handlers[event] || []).push(fn);
    return { remove: () => { this._handlers[event] = (this._handlers[event] || []).filter(f => f !== fn); } };
  }
  _emit(ev, ...a) { (this._handlers[ev] || []).forEach(fn => fn(...a)); }
  _color() { const o = this._opts.polygonOptions || {}; return o.strokeColor || o.fillColor || '#3B82F6'; }
  _bind() {
    const G = window.google.maps;
    // dblclick works on desktop; on mobile double-tap zooms instead,
    // so we also detect rapid double-tap inside the click handler.
    this._dblL = G.event.addListener(this._map, 'dblclick', (e) => {
      e.stop();
      if (this._vertices.length > 2) { this._vertices.pop(); const d = this._dots.pop(); if (d) d.setMap(null); }
      this._complete();
    });
    let _lastClickMs = 0;
    this._clickL = G.event.addListener(this._map, 'click', (e) => {
      e.stop();
      const now = Date.now();
      if (_lastClickMs > 0 && now - _lastClickMs < 350) {
        _lastClickMs = 0;
        if (this._vertices.length > 2) { const d = this._dots.pop(); if (d) d.setMap(null); this._vertices.pop(); }
        this._complete();
        return;
      }
      _lastClickMs = now;
      this._vertices.push(e.latLng);
      const G2 = window.google.maps; const o = this._opts.polygonOptions || {};
      this._dots.push(new G2.Marker({
        position: e.latLng, map: this._map, clickable: false, zIndex: 20,
        icon: { path: G2.SymbolPath.CIRCLE, scale: 5, fillColor: this._color(), fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      }));
      if (this._vertices.length >= 2) {
        const opts = { ...o, editable: false, draggable: false, map: this._map };
        if (!this._preview) this._preview = new G2.Polygon({ paths: this._vertices, ...opts });
        else this._preview.setPath(this._vertices);
      }
    });
    this._moveL = G.event.addListener(this._map, 'mousemove', (e) => {
      if (!this._vertices.length) return;
      const pts = [...this._vertices, e.latLng];
      if (!this._rubber) {
        this._rubber = new G.Polyline({ path: pts, strokeColor: this._color(), strokeWeight: 2, strokeOpacity: 0.6, clickable: false, zIndex: 15, map: this._map });
      } else { this._rubber.setPath(pts); }
    });
  }
  _complete() {
    if (this._vertices.length < 3) { this._reset(); return; }
    const G = window.google.maps; const verts = [...this._vertices]; const map = this._map;
    const opts = { ...(this._opts.polygonOptions || {}), editable: true, draggable: true, map };
    this._reset(); this._mode = null;
    this._emit('polygoncomplete', new G.Polygon({ paths: verts, ...opts }));
  }
  _reset() {
    if (this._preview) { this._preview.setMap(null); this._preview = null; }
    if (this._rubber)  { this._rubber.setMap(null);  this._rubber  = null; }
    this._dots.forEach(d => d.setMap(null)); this._dots = []; this._vertices = [];
    if (this._clickL && window.google) { window.google.maps.event.removeListener(this._clickL); this._clickL = null; }
    if (this._dblL   && window.google) { window.google.maps.event.removeListener(this._dblL);   this._dblL   = null; }
    if (this._moveL  && window.google) { window.google.maps.event.removeListener(this._moveL);  this._moveL  = null; }
  }
}

function loadGoogleMapsAPI() {
  if (_mapsLoadPromise) return _mapsLoadPromise;
  if (window.google?.maps?.geometry) return Promise.resolve();

  _mapsLoadPromise = (async () => {
    const response = await base44.functions.invoke('getGoogleMapsApiKey');
    const apiKey = response?.data?.apiKey || response?.apiKey;
    if (!apiKey) throw new Error('Google Maps API key not configured');

    if (window.google?.maps?.geometry) return;

    const existing = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existing) existing.remove();

    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry`;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        const check = setInterval(() => {
          if (window.google?.maps?.Map) {
            clearInterval(check);
            resolve();
          }
        }, 50);
        setTimeout(() => { clearInterval(check); reject(new Error('Maps API loading timeout')); }, 15000);
      };
      script.onerror = () => reject(new Error('Failed to load Google Maps'));
      document.head.appendChild(script);
    });
  })();

  _mapsLoadPromise.catch(() => { _mapsLoadPromise = null; });
  return _mapsLoadPromise;
}

function restoreOutlinesOnMap(outlines, map) {
  if (!outlines?.length || !window.google?.maps) return [];
  const restored = [];
  outlines.forEach((outline) => {
    if (!outline.path || outline.path.length < 3) return;
    const polygon = new window.google.maps.Polygon({
      paths: outline.path.map(v => ({ lat: Number(v.lat), lng: Number(v.lng) })),
      fillColor: outline.color || '#3B82F6',
      fillOpacity: 0.25,
      strokeColor: outline.color || '#3B82F6',
      strokeWeight: 2,
      editable: true,
      draggable: true,
      map,
    });
    restored.push({
      polygon,
      path: outline.path,
      section: outline.section || 'Main Roof',
      color: outline.color || '#3B82F6',
    });
  });
  return restored;
}

export default function RoofSatelliteView({ address, jobId, savedOutlines, onSaveOutlines }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const drawingManagerRef = useRef(null);
  const bullseyeRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mapError, setMapError] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentHeading, setCurrentHeading] = useState(0);
  const [is3D, setIs3D] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawnPolygons, setDrawnPolygons] = useState([]);
  const [activeRoofSection, setActiveRoofSection] = useState(0);
  const [aiDrawing, setAiDrawing] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [mapCenter, setMapCenter] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [damageLayerOn, setDamageLayerOn] = useState(false);
  const damageMarkersRef = useRef([]);
  const damageLayerRef = useRef(false);
  const damageListenerRef = useRef(null);
  const containerRef = useRef(null);
  const outlinesRestoredRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (drawingManagerRef.current) {
        drawingManagerRef.current.setMap(null);
        drawingManagerRef.current = null;
      }
      if (damageListenerRef.current && window.google?.maps) {
        window.google.maps.event.removeListener(damageListenerRef.current);
        damageListenerRef.current = null;
      }
      damageMarkersRef.current.forEach(m => m.setMap(null));
      damageMarkersRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!address) {
      setMapError('No property address available');
      setIsLoading(false);
      return;
    }
    initSatelliteView();
  }, [address]);

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !savedOutlines?.length || outlinesRestoredRef.current) return;
    outlinesRestoredRef.current = true;
    const restored = restoreOutlinesOnMap(savedOutlines, mapInstanceRef.current);
    if (restored.length > 0) setDrawnPolygons(restored);
  }, [mapReady, savedOutlines]);

  const initSatelliteView = async () => {
    setIsLoading(true);
    setMapError(null);
    setMapReady(false);
    outlinesRestoredRef.current = false;
    try {
      await loadGoogleMapsAPI();
      if (!mountedRef.current) return;
      await initMap();
    } catch (err) {
      console.error('Google Maps error:', err);
      if (mountedRef.current) setMapError(err.message || 'Failed to load satellite view');
    }
    if (mountedRef.current) setIsLoading(false);
  };

  const initMap = async () => {
    const geocoder = new window.google.maps.Geocoder();
    const result = await new Promise((resolve, reject) => {
      geocoder.geocode({ address }, (results, status) => {
        if (status === 'OK' && results[0]) resolve(results[0]);
        else reject(new Error(`Could not geocode address: ${status}`));
      });
    });

    if (!mountedRef.current || !mapRef.current) return;

    const location = result.geometry.location;
    const center = { lat: location.lat(), lng: location.lng() };
    setMapCenter(center);

    const map = new window.google.maps.Map(mapRef.current, {
      center: location,
      zoom: 20,
      mapTypeId: 'satellite',
      tilt: 0,
      heading: 0,
      disableDefaultUI: true,
      zoomControl: false,
      mapTypeControl: true,
      mapTypeControlOptions: {
        style: window.google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
        position: window.google.maps.ControlPosition.TOP_LEFT,
        mapTypeIds: ['roadmap', 'satellite']
      },
      gestureHandling: 'greedy',
      rotateControl: true,
      tiltControl: true,
      fullscreenControl: false,
      streetViewControl: false,
    });

    mapInstanceRef.current = map;
    setMapReady(true);
  };

  const changeHeading = useCallback((heading) => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.setHeading(heading);
    mapInstanceRef.current.setTilt(45);
    setCurrentHeading(heading);
    setIs3D(true);
  }, []);

  const toggle3D = useCallback(() => {
    if (!mapInstanceRef.current) return;
    const newTilt = is3D ? 0 : 45;
    mapInstanceRef.current.setTilt(newTilt);
    setIs3D(!is3D);
  }, [is3D]);

  const zoomIn = useCallback(() => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.setZoom(mapInstanceRef.current.getZoom() + 1);
  }, []);

  const zoomOut = useCallback(() => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.setZoom(mapInstanceRef.current.getZoom() - 1);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!isFullscreen) {
      if (containerRef.current.requestFullscreen) containerRef.current.requestFullscreen();
      else if (containerRef.current.webkitRequestFullscreen) containerRef.current.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
    setIsFullscreen(!isFullscreen);
  }, [isFullscreen]);

  const startDrawing = useCallback(() => {
    if (!mapInstanceRef.current || !window.google?.maps) return;
    if (drawingManagerRef.current) {
      drawingManagerRef.current.setDrawingMode(null);
    }
    const color = ROOF_COLORS[activeRoofSection]?.color || '#3B82F6';
    const dm = new ClickDrawingManager({
      drawingMode: 'polygon',
      polygonOptions: {
        fillColor: color,
        fillOpacity: 0.25,
        strokeColor: color,
        strokeWeight: 2,
        editable: true,
        draggable: true,
      }
    });
    dm.setMap(mapInstanceRef.current);
    dm.addListener('polygoncomplete', (polygon) => {
      const path = polygon.getPath().getArray().map(p => ({ lat: p.lat(), lng: p.lng() }));
      setDrawnPolygons(prev => [...prev, {
        polygon,
        path,
        section: ROOF_COLORS[activeRoofSection]?.name || 'Main Roof',
        color
      }]);
      setIsDrawing(false);
    });
    drawingManagerRef.current = dm;
    setIsDrawing(true);
  }, [activeRoofSection]);

  const stopDrawing = useCallback(() => {
    if (drawingManagerRef.current) {
      drawingManagerRef.current.setDrawingMode(null);
      drawingManagerRef.current = null;
    }
    setIsDrawing(false);
  }, []);

  const undoLastPolygon = useCallback(() => {
    setDrawnPolygons(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.polygon) last.polygon.setMap(null);
      return prev.slice(0, -1);
    });
  }, []);

  const clearAllPolygons = useCallback(() => {
    drawnPolygons.forEach(p => { if (p.polygon) p.polygon.setMap(null); });
    setDrawnPolygons([]);
  }, [drawnPolygons]);

  const handleAiDrawLines = async () => {
    if (!mapInstanceRef.current || !mapCenter) return;
    setAiDrawing(true);
    setAiError(null);
    try {
      const { lat, lng } = mapCenter;
      const apiKeyResp = await base44.functions.invoke('getGoogleMapsApiKey');
      const apiKey = apiKeyResp?.data?.apiKey || apiKeyResp?.apiKey;
      if (!apiKey) throw new Error('Google Maps API key not available');

      const staticUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=20&size=640x640&maptype=satellite&key=${apiKey}`;

      const aiResult = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a roof detection AI. I'm showing you a satellite image of a property at ${address}. 
The center of this image (lat: ${lat}, lng: ${lng}) is the target property.
Analyze the satellite image and identify the main roof outline(s) of the TARGET property (the one at the center).
Return a JSON array of roof sections. Each section should have:
- "name": string (e.g., "Main Roof", "Garage", "Porch")
- "vertices": array of objects with "lat" and "lng" numbers forming the polygon outline

The image is 640x640 pixels centered on lat ${lat}, lng ${lng} at zoom 20.
At zoom 20, each pixel is approximately 0.15 meters. The image covers roughly 96m x 96m.
To convert pixel coordinates (px, py) from center to lat/lng:
  offset_lat = (320 - py) * 0.00000134
  offset_lng = (px - 320) * 0.00000168
  vertex_lat = ${lat} + offset_lat
  vertex_lng = ${lng} + offset_lng

Return ONLY valid JSON. Be conservative — only include clearly visible roof outlines. Use 4-8 vertices per section.
Example: [{"name":"Main Roof","vertices":[{"lat":41.123,"lng":-81.456},{"lat":41.124,"lng":-81.455},...]}]`,
        file_urls: [staticUrl],
      });

      let roofData = [];
      try {
        if (Array.isArray(aiResult)) {
          roofData = aiResult;
        } else if (typeof aiResult === 'string') {
          const jsonMatch = aiResult.match(/\[[\s\S]*\]/);
          if (jsonMatch) roofData = JSON.parse(jsonMatch[0]);
        } else if (typeof aiResult === 'object' && aiResult !== null) {
          const text = JSON.stringify(aiResult);
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) roofData = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        console.error('AI parse error:', e);
        throw new Error('AI returned invalid roof data. Try again or draw manually.');
      }

      roofData = roofData.filter(s =>
        s?.vertices && Array.isArray(s.vertices) && s.vertices.length >= 3 &&
        s.vertices.every(v => typeof v.lat === 'number' && typeof v.lng === 'number')
      );

      if (roofData.length === 0) {
        setAiError('AI could not detect clear roof outlines. Try drawing manually.');
      } else if (window.google) {
        const newPolygons = [];
        roofData.forEach((section, idx) => {
          const colorIdx = Math.min(idx, ROOF_COLORS.length - 1);
          const color = ROOF_COLORS[colorIdx].color;
          const polygon = new window.google.maps.Polygon({
            paths: section.vertices.map(v => ({ lat: v.lat, lng: v.lng })),
            fillColor: color,
            fillOpacity: 0.25,
            strokeColor: color,
            strokeWeight: 2,
            editable: true,
            draggable: true,
            map: mapInstanceRef.current
          });
          newPolygons.push({
            polygon,
            path: section.vertices,
            section: section.name || ROOF_COLORS[colorIdx].name,
            color
          });
        });
        setDrawnPolygons(prev => [...prev, ...newPolygons]);
      }
    } catch (err) {
      console.error('AI draw error:', err);
      setAiError(err.message || 'AI roof detection failed. Try again or draw manually.');
    }
    setAiDrawing(false);
  };

  const saveOutlines = useCallback(async () => {
    if (!jobId) return;
    const outlineData = drawnPolygons.map(p => ({
      section: p.section,
      color: p.color,
      path: p.polygon ? p.polygon.getPath().getArray().map(pt => ({ lat: pt.lat(), lng: pt.lng() })) : p.path
    }));
    try {
      await base44.entities.InspectionJob.update(jobId, {
        roof_outlines: JSON.stringify(outlineData)
      });
      if (onSaveOutlines) onSaveOutlines(outlineData);
    } catch (e) {
      console.error('Failed to save roof outlines:', e);
    }
  }, [jobId, drawnPolygons, onSaveOutlines]);

  const toggleDamageLayer = useCallback(() => {
    const newVal = !damageLayerOn;
    setDamageLayerOn(newVal);
    damageLayerRef.current = newVal;

    if (damageListenerRef.current && window.google?.maps) {
      window.google.maps.event.removeListener(damageListenerRef.current);
      damageListenerRef.current = null;
    }

    if (!newVal) {
      damageMarkersRef.current.forEach(m => m.setMap(null));
      damageMarkersRef.current = [];
    } else if (mapInstanceRef.current && window.google) {
      damageListenerRef.current = mapInstanceRef.current.addListener('click', (e) => {
        if (!damageLayerRef.current) return;
        const marker = new window.google.maps.Marker({
          position: e.latLng,
          map: mapInstanceRef.current,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 6,
            fillColor: '#3B82F6',
            fillOpacity: 0.9,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
          title: 'Damage Pin',
          draggable: true,
        });
        marker.addListener('rightclick', () => {
          marker.setMap(null);
          damageMarkersRef.current = damageMarkersRef.current.filter(m => m !== marker);
        });
        damageMarkersRef.current.push(marker);
      });
    }
  }, [damageLayerOn]);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  if (!address) return null;

  return (
    <div className="space-y-3">
      {/* Damage Layer Toggle */}
      <Card className={`border-2 ${damageLayerOn ? 'border-orange-400 bg-orange-50' : 'border-orange-300'}`}>
        <CardContent className="p-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
              🛡️ Damage Layer
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              Toggle ON to drop Hail 🔵 or Wind 💎 damage pins on the map
            </p>
          </div>
          <button
            onClick={toggleDamageLayer}
            className={`relative w-12 h-6 rounded-full transition-colors ${damageLayerOn ? 'bg-orange-500' : 'bg-gray-300'}`}
            data-testid="btn-damage-layer-toggle"
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${damageLayerOn ? 'translate-x-6' : 'translate-x-0.5'}`} />
          </button>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-gray-300">
        <CardContent className="p-0">
          <div ref={containerRef} className={`relative ${isFullscreen ? 'fixed inset-0 z-50 bg-black' : ''}`}>
            <div
              ref={mapRef}
              className="w-full bg-gray-900"
              style={{ height: isFullscreen ? '100vh' : '400px' }}
              data-testid="satellite-map"
            />

            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-10">
                <div className="text-center text-white">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                  <p className="text-sm">Loading satellite view...</p>
                </div>
              </div>
            )}

            {mapError && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
                <div className="text-center p-4">
                  <AlertTriangle className="w-6 h-6 text-red-500 mx-auto mb-2" />
                  <p className="text-sm text-red-600">{mapError}</p>
                  <Button size="sm" variant="outline" className="mt-2" onClick={initSatelliteView}>
                    Retry
                  </Button>
                </div>
              </div>
            )}

            {/* Bullseye Crosshair */}
            {!isLoading && !mapError && (
              <div
                ref={bullseyeRef}
                className="absolute pointer-events-none z-10"
                style={{
                  top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '60px', height: '60px',
                }}
              >
                <svg viewBox="0 0 60 60" className="w-full h-full">
                  <circle cx="30" cy="30" r="28" fill="none" stroke="red" strokeWidth="2" opacity="0.7" />
                  <circle cx="30" cy="30" r="18" fill="none" stroke="red" strokeWidth="1.5" opacity="0.5" />
                  <circle cx="30" cy="30" r="8" fill="none" stroke="red" strokeWidth="1.5" opacity="0.7" />
                  <circle cx="30" cy="30" r="2" fill="red" opacity="0.9" />
                  <line x1="30" y1="0" x2="30" y2="22" stroke="red" strokeWidth="1" opacity="0.5" />
                  <line x1="30" y1="38" x2="30" y2="60" stroke="red" strokeWidth="1" opacity="0.5" />
                  <line x1="0" y1="30" x2="22" y2="30" stroke="red" strokeWidth="1" opacity="0.5" />
                  <line x1="38" y1="30" x2="60" y2="30" stroke="red" strokeWidth="1" opacity="0.5" />
                </svg>
              </div>
            )}

            {/* Top-right: Compass + Fullscreen */}
            {!isLoading && !mapError && (
              <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
                <div className="bg-white rounded shadow px-2 py-1 text-xs font-semibold text-gray-700 text-center">
                  Top-down · {DIRECTIONS.find(d => d.heading === currentHeading)?.label || 'N'}
                </div>
                <button
                  onClick={toggleFullscreen}
                  className="bg-white rounded shadow p-1.5 hover:bg-gray-100"
                  data-testid="btn-fullscreen-map"
                >
                  {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
              </div>
            )}

            {/* Zoom Controls */}
            {!isLoading && !mapError && (
              <div className="absolute right-2 bottom-16 z-10 flex flex-col gap-0.5">
                <button onClick={zoomIn} className="bg-white rounded-t shadow px-2 py-1 text-lg font-bold hover:bg-gray-100" data-testid="btn-zoom-in">+</button>
                <button onClick={zoomOut} className="bg-white rounded-b shadow px-2 py-1 text-lg font-bold hover:bg-gray-100" data-testid="btn-zoom-out">−</button>
              </div>
            )}

            {/* N E S W + 3D buttons at bottom center */}
            {!isLoading && !mapError && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex gap-1">
                {DIRECTIONS.map(d => (
                  <button
                    key={d.label}
                    onClick={() => changeHeading(d.heading)}
                    className={`w-9 h-9 rounded text-xs font-bold shadow transition-colors ${
                      currentHeading === d.heading
                        ? 'bg-purple-600 text-white'
                        : 'bg-purple-500 text-white hover:bg-purple-600'
                    }`}
                    data-testid={`btn-heading-${d.label.toLowerCase()}`}
                  >
                    {d.label}
                  </button>
                ))}
                <button
                  onClick={toggle3D}
                  className={`w-9 h-9 rounded text-xs font-bold shadow transition-colors ${
                    is3D
                      ? 'bg-amber-500 text-white'
                      : 'bg-amber-400 text-white hover:bg-amber-500'
                  }`}
                  data-testid="btn-3d-toggle"
                >
                  3D
                </button>
              </div>
            )}
          </div>

          {/* Drawing Tools Section */}
          {!isLoading && !mapError && (
            <div className="p-4 border-t border-gray-200 space-y-3">
              <p className="font-semibold text-gray-800 text-sm">STEP 1: Draw Roof Section Outlines</p>

              {/* Active Roof Section Selector */}
              <div className="flex flex-wrap gap-2">
                {ROOF_COLORS.map((rc, idx) => (
                  <button
                    key={rc.name}
                    onClick={() => setActiveRoofSection(idx)}
                    className={`px-3 py-1.5 rounded text-xs font-medium border-2 transition-colors ${
                      activeRoofSection === idx
                        ? 'border-gray-800 bg-gray-100'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                    data-testid={`btn-roof-section-${idx}`}
                  >
                    <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ backgroundColor: rc.color }} />
                    {rc.name}
                  </button>
                ))}
              </div>

              <p className="text-xs text-gray-500">
                Active: <strong>{ROOF_COLORS[activeRoofSection]?.name}</strong> — outlines will be{' '}
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: ROOF_COLORS[activeRoofSection]?.color }} />{' '}
                {ROOF_COLORS[activeRoofSection]?.hex}
              </p>

              {/* Drawing Buttons */}
              <div className="flex flex-wrap gap-2">
                {!isDrawing ? (
                  <Button
                    size="sm"
                    onClick={startDrawing}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    data-testid="btn-start-drawing"
                  >
                    ✏️ Draw Outline
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={stopDrawing}
                    className="border-red-300 text-red-600"
                    data-testid="btn-stop-drawing"
                  >
                    ✋ Stop Drawing
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAiDrawLines}
                  disabled={aiDrawing}
                  className="border-purple-300 text-purple-700 hover:bg-purple-50"
                  data-testid="btn-ai-draw"
                >
                  {aiDrawing ? (
                    <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> AI Detecting...</>
                  ) : (
                    <><Sparkles className="w-3.5 h-3.5 mr-1.5" /> AI Draw Lines</>
                  )}
                </Button>

                {drawnPolygons.length > 0 && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={undoLastPolygon}
                      data-testid="btn-undo-polygon"
                    >
                      <Undo2 className="w-3.5 h-3.5 mr-1" /> Undo
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={clearAllPolygons}
                      className="text-red-600"
                      data-testid="btn-clear-polygons"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear All
                    </Button>
                  </>
                )}
              </div>

              {/* AI Error */}
              {aiError && (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  {aiError}
                </div>
              )}

              {/* Drawn sections summary */}
              {drawnPolygons.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {drawnPolygons.map((p, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded-full px-2.5 py-1 border"
                      style={{ borderColor: p.color }}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                      {p.section}
                    </span>
                  ))}
                </div>
              )}

              {drawnPolygons.length > 0 && (
                <Button
                  size="sm"
                  onClick={saveOutlines}
                  className="bg-green-600 hover:bg-green-700 text-white"
                  data-testid="btn-save-outlines"
                >
                  💾 Save Outlines ({drawnPolygons.length} section{drawnPolygons.length > 1 ? 's' : ''})
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
