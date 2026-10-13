import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getTranslations, getStoredLanguage } from '@/utils/translations';
import useHiddenFeatures from "@/hooks/useHiddenFeatures";
import { addressIdentity, buildAddressTierAssignments, fetchCensusZipMedianValues, stormAddressCacheKey } from '@/lib/stormAddressUtils';
import { fetchAllStormEvents, formatStormSeverityLabel } from '@/lib/stormTrackingData';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY'
];

const KNOWN_CITY_COORDS = {
  'cleveland': { lat: 41.4993, lng: -81.6944, state: 'OH' },
  'columbus': { lat: 39.9612, lng: -82.9988, state: 'OH' },
  'cincinnati': { lat: 39.1031, lng: -84.5120, state: 'OH' },
  'akron': { lat: 41.0814, lng: -81.5190, state: 'OH' },
  'toledo': { lat: 41.6528, lng: -83.5379, state: 'OH' },
  'dayton': { lat: 39.7589, lng: -84.1916, state: 'OH' },
  'youngstown': { lat: 41.0998, lng: -80.6495, state: 'OH' },
  'canton': { lat: 40.7989, lng: -81.3784, state: 'OH' },
  'bedford heights': { lat: 41.3939, lng: -81.5068, state: 'OH' },
  'bedford': { lat: 41.3931, lng: -81.5349, state: 'OH' },
  'garfield heights': { lat: 41.4167, lng: -81.6057, state: 'OH' },
  'maple heights': { lat: 41.4109, lng: -81.5651, state: 'OH' },
  'parma': { lat: 41.3845, lng: -81.7229, state: 'OH' },
  'strongsville': { lat: 41.3145, lng: -81.8360, state: 'OH' },
  'independence': { lat: 41.3665, lng: -81.6382, state: 'OH' },
  'solon': { lat: 41.3892, lng: -81.4413, state: 'OH' },
  'seven hills': { lat: 41.3820, lng: -81.6869, state: 'OH' },
  'beachwood': { lat: 41.4648, lng: -81.5093, state: 'OH' },
  'euclid': { lat: 41.5931, lng: -81.5268, state: 'OH' },
  'mentor': { lat: 41.6661, lng: -81.3398, state: 'OH' },
  'lorain': { lat: 41.4523, lng: -82.1821, state: 'OH' },
  'elyria': { lat: 41.3684, lng: -82.1074, state: 'OH' },
  'medina': { lat: 41.1384, lng: -81.8638, state: 'OH' },
  'brunswick': { lat: 41.2384, lng: -81.8421, state: 'OH' },
  'lakewood': { lat: 41.4820, lng: -81.7982, state: 'OH' },
  'westlake': { lat: 41.4553, lng: -81.9179, state: 'OH' },
  'north olmsted': { lat: 41.4153, lng: -81.9235, state: 'OH' },
  'rocky river': { lat: 41.4759, lng: -81.8413, state: 'OH' },
  'bay village': { lat: 41.4887, lng: -81.9221, state: 'OH' },
  'sandusky': { lat: 41.4487, lng: -82.7079, state: 'OH' },
  'warren': { lat: 41.2376, lng: -80.8184, state: 'OH' },
  'niles': { lat: 41.1859, lng: -80.7673, state: 'OH' },
  'houston': { lat: 29.7604, lng: -95.3698, state: 'TX' },
  'dallas': { lat: 32.7767, lng: -96.7970, state: 'TX' },
  'austin': { lat: 30.2672, lng: -97.7431, state: 'TX' },
  'miami': { lat: 25.7617, lng: -80.1918, state: 'FL' },
  'orlando': { lat: 28.5383, lng: -81.3792, state: 'FL' },
  'tampa': { lat: 27.9506, lng: -82.4572, state: 'FL' },
  'chicago': { lat: 41.8781, lng: -87.6298, state: 'IL' },
  'detroit': { lat: 42.3314, lng: -83.0458, state: 'MI' },
  'pittsburgh': { lat: 40.4406, lng: -79.9959, state: 'PA' },
  'atlanta': { lat: 33.7490, lng: -84.3880, state: 'GA' },
  'denver': { lat: 39.7392, lng: -104.9903, state: 'CO' },
  'phoenix': { lat: 33.4484, lng: -112.0740, state: 'AZ' },
  'indianapolis': { lat: 39.7684, lng: -86.1581, state: 'IN' },
  'nashville': { lat: 36.1627, lng: -86.7816, state: 'TN' },
  'charlotte': { lat: 35.2271, lng: -80.8431, state: 'NC' },
  'oklahoma city': { lat: 35.4676, lng: -97.5164, state: 'OK' },
};

// Haversine distance in miles between two lat/lng points
const haversineDistMiles = (lat1, lng1, lat2, lng2) => {
  const R = 3958.8;
  const toRad = x => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
};

// Fetch IEM LSR hail reports in a bounding box around a point within ±6 hours of the storm
const fetchIemHailReports = async (lat, lng, startTime) => {
  try {
    const center = startTime ? new Date(startTime) : new Date();
    const sts = new Date(center.getTime() - 6 * 3600000).toISOString().slice(0, 16);
    const ets = new Date(center.getTime() + 6 * 3600000).toISOString().slice(0, 16);
    // ±0.25° ≈ 17 miles bounding box — wide enough to catch reports near our ring points
    const pad = 0.25;
    const bbox = `${(lng - pad).toFixed(4)},${(lat - pad).toFixed(4)},${(lng + pad).toFixed(4)},${(lat + pad).toFixed(4)}`;
    const url = `https://mesonet.agron.iastate.edu/geojson/lsr.php?sts=${sts}&ets=${ets}&type=H&bbox=${bbox}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features || []).map(f => {
      const raw = f.properties?.magnitude != null ? parseFloat(f.properties.magnitude) : null;
      // Sanity check: IEM magnitude for hail is in inches. Anything > 6" is almost certainly
      // a wind-speed value leaking in from a mismatched LSR — discard it.
      const hailSize = (raw != null && raw >= 0.25 && raw <= 6.0) ? raw.toFixed(2) : null;
      return {
        lat: f.geometry?.coordinates?.[1],
        lng: f.geometry?.coordinates?.[0],
        hailSize,
      };
    }).filter(r => r.lat != null && r.lng != null);
  } catch { return []; }
};

// Reverse geocode a lat/lng to a city name using Nominatim
const reverseGeocodePoint = async (lat, lng) => {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`,
      { headers: { 'Accept-Language': 'en-US' } }
    );
    const data = await res.json();
    if (!data || data.error) return null;
    const addr = data.address || {};
    // Prefer city > town > village > suburb > county
    const name = addr.city || addr.town || addr.village || addr.suburb || addr.county || null;
    const stateAbbr = addr.state_code || addr.state || '';
    return name ? `${name}, ${stateAbbr}`.trim().replace(/, $/, '') : null;
  } catch { return null; }
};

// Generate lat/lng points in a ring around a center at `radiusMiles`
const ringPoints = (centerLat, centerLng, radiusMiles, bearings = [0, 45, 90, 135, 180, 225, 270, 315]) => {
  const dLat = radiusMiles / 69;
  const dLng = radiusMiles / (69 * Math.cos((centerLat * Math.PI) / 180));
  return bearings.map(bearing => {
    const rad = (bearing * Math.PI) / 180;
    return {
      lat: centerLat + dLat * Math.cos(rad),
      lng: centerLng + dLng * Math.sin(rad),
    };
  });
};

const geocodeAddress = async (address, state = null) => {
  if (!address) return null;

  const cityLower = address.toLowerCase().trim();
  if (KNOWN_CITY_COORDS[cityLower]) {
    const known = KNOWN_CITY_COORDS[cityLower];
    if (!state || state.toUpperCase() === known.state) {
      console.log(`📍 Using known coords for ${address}: ${known.lat}, ${known.lng}`);
      return { lat: known.lat, lng: known.lng };
    }
  }

  try {
    const queries = state
      ? [`${address}, ${state}, USA`]
      : [
          `${address}, USA`,
          address
        ];

    for (const query of queries) {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=3&countrycodes=us`
      );
      const data = await response.json();
      if (data && data.length > 0) {
        const result = data.find(d => d.type === 'city' || d.type === 'administrative') || data[0];
        return {
          lat: parseFloat(result.lat),
          lng: parseFloat(result.lon)
        };
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch (error) {
    console.error('Geocoding error:', error);
  }

  // Nominatim failed (rate-limited/blocked/no result) — fall back to the
  // server-side Google geocoder so saved secondary areas still get circles.
  try {
    const r = await fetch('/api/functions/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        functionName: 'geocodeAddress',
        params: { address: state ? `${address}, ${state}, USA` : `${address}, USA` },
      }),
    });
    const json = await r.json();
    const d = json?.data || json;
    if (d?.success && typeof d.lat === 'number' && typeof d.lng === 'number') {
      return { lat: d.lat, lng: d.lng };
    }
  } catch (error) {
    console.error('Server geocode fallback error:', error);
  }
  return null;
};

function isSevereStorm(storm) {
  return (storm.hail_size_inches && parseFloat(storm.hail_size_inches) > 1.0) ||
         (storm.wind_speed_mph && parseFloat(storm.wind_speed_mph) > 60);
}

function getAddrTier(address, tierAssignments) {
  const tier = tierAssignments?.[addressIdentity(address)];
  if (!tier) return null;
  const style = tier.n === 1
    ? 'bg-amber-100 text-amber-700 border border-amber-300'
    : tier.n === 2
      ? 'bg-blue-100 text-blue-700 border border-blue-200'
      : 'bg-slate-100 text-slate-600 border border-slate-200';
  return { ...tier, bg: style };
}

function stormActionError(error, fallback) {
  const message = String(error?.message || '').trim();
  if (!message || /base44|is not a function/i.test(message)) return fallback;
  return message;
}
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePageVisibility } from "@/hooks/usePageVisibility";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MapContainer, TileLayer, Circle, Popup, Marker, GeoJSON, ImageOverlay, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';

// ── SBW polygon styles by NWS phenomena code ──────────────────────────────────
const SBW_PHENOMENA_STYLES = {
  TO: { color: '#dc2626', fillColor: '#dc2626' }, // Tornado Warning — red
  SV: { color: '#f97316', fillColor: '#f97316' }, // Severe Thunderstorm — orange
  FF: { color: '#16a34a', fillColor: '#16a34a' }, // Flash Flood — green
  FL: { color: '#16a34a', fillColor: '#16a34a' }, // Flood — green
  HW: { color: '#d97706', fillColor: '#d97706' }, // High Wind — amber
  EW: { color: '#d97706', fillColor: '#d97706' }, // Extreme Wind — amber
  BZ: { color: '#6366f1', fillColor: '#6366f1' }, // Blizzard — indigo
  WS: { color: '#6366f1', fillColor: '#6366f1' }, // Winter Storm — indigo
  IS: { color: '#8b5cf6', fillColor: '#8b5cf6' }, // Ice Storm — purple
};
const getSBWStyle = (feature) => {
  const phen = feature?.properties?.phenomena || '';
  const { color = '#3b82f6', fillColor = '#3b82f6' } = SBW_PHENOMENA_STYLES[phen] || {};
  return { color, fillColor, fillOpacity: 0.25, opacity: 0.85, weight: 2.5 };
};
import {
  Cloud,
  CloudRain,
  Wind,
  AlertTriangle,
  RefreshCw,
  MapPin,
  Users,
  Search,
  Settings,
  Info,
  CheckCircle,
  XCircle,
  Loader2,
  Bell,
  Filter,
  CheckCircle2,
  ChevronRight
} from "lucide-react";
import { format } from "date-fns";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";
import 'leaflet/dist/leaflet.css';
import useRoleBasedData from "@/components/hooks/useRoleBasedData";
import { useToast } from "@/components/ui/use-toast";
import StormCanvassPlanner from "@/components/storms/StormCanvassPlanner";
import { GoogleAddressAutocomplete } from "@/components/GoogleAddressAutocomplete";

function getDistanceInMiles(lat1, lon1, lat2, lon2) {
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null || isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) return Infinity;
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Fix for default marker icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Helper to track map events
function MapEventsHandler({ onZoomEnd }) {
  const map = useMapEvents({
    zoomend: () => {
      onZoomEnd(map.getZoom());
    },
  });
  return null;
}

// Confidence tier presentation shared across chips, cards, and address rows
const CONFIDENCE_META = {
  high_confidence: { icon: '🟢', short: 'Verified Impact', cls: 'bg-green-100 text-green-800 border-green-300' },
  high_opportunity: { icon: '🟠', short: 'Unreported Damage', cls: 'bg-orange-100 text-orange-800 border-orange-300' },
  low_priority: { icon: '⚪', short: 'Unconfirmed', cls: 'bg-slate-100 text-slate-500 border-slate-300' },
  unknown: { icon: '', short: '', cls: '' },
};

/**
 * Fetches the MRMS MESH radar overlay for the current viewport whenever the
 * map settles (moveend/zoomend). Debounced + stale-guarded so pans never block
 * the UI; the fetch runs async on the server and only the newest result wins.
 */
function MeshOverlayFetcher({ enabled, storm, onOverlay }) {
  const timerRef = useRef(null);
  const reqIdRef = useRef(0);
  const map = useMapEvents({
    moveend: () => schedule(),
    zoomend: () => schedule(),
  });
  const fetchOverlay = useCallback(async () => {
    const b = map.getBounds();
    const reqId = ++reqIdRef.current;
    try {
      const result = await base44.functions.invoke('getMeshSwathOverlay', {
        minLat: b.getSouth(), maxLat: b.getNorth(), minLng: b.getWest(), maxLng: b.getEast(),
        stormId: storm?.id || null,
        stormTime: storm?.start_time || null,
      });
      if (reqId !== reqIdRef.current) return; // stale — a newer pan superseded us
      const d = result?.data || result || {};
      onOverlay({ loading: false, ...d });
    } catch (e) {
      if (reqId === reqIdRef.current) onOverlay({ loading: false, available: false, error: e.message });
    }
  }, [map, onOverlay, storm?.id, storm?.start_time]);
  const schedule = useCallback(() => {
    if (!enabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(fetchOverlay, 500);
  }, [enabled, fetchOverlay]);
  useEffect(() => {
    if (enabled) { onOverlay((prev) => ({ ...(typeof prev === 'object' ? prev : {}), loading: true })); fetchOverlay(); }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); reqIdRef.current++; };
  }, [enabled, fetchOverlay, onOverlay]);
  return null;
}

function MapController({ center, zoom, flyKey }) {
  const map = useMap();
  const lastKeyRef = useRef(null);
  useEffect(() => {
    if (center && flyKey !== lastKeyRef.current) {
      lastKeyRef.current = flyKey;
      map.flyTo(center, zoom, { duration: 0.8 });
    }
  }, [flyKey]);
  return null;
}

function FitBoundsController({ bounds, boundsKey }) {
  const map = useMap();
  const lastKeyRef = useRef(null);
  useEffect(() => {
    if (bounds && boundsKey !== lastKeyRef.current) {
      lastKeyRef.current = boundsKey;
      try {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10, animate: true, duration: 0.8 });
      } catch (e) {}
    }
  }, [boundsKey]);
  return null;
}

// Renders the NWS SBW polygon and fits the map to it when it first loads
function SwathPolygonLayer({ stormId, feature }) {
  const map = useMap();
  const fittedRef = useRef(null);
  useEffect(() => {
    if (!feature || fittedRef.current === stormId) return;
    fittedRef.current = stormId;
    try {
      const bounds = L.geoJSON(feature).getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 11, animate: true, duration: 0.8 });
      }
    } catch (e) {}
  }, [stormId, feature]);
  return null;
}

export default function StormTracking() {
  const isPageVisible = usePageVisibility();
  const navigate = useNavigate();
  const { toast } = useToast();
  const t = getTranslations(getStoredLanguage()).stormTracking;
  const [selectedStorm, setSelectedStorm] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [filterState, setFilterState] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(20);
  const listEndRef = useRef(null);
  const [mapCenter, setMapCenter] = useState([39.8283, -98.5795]);
  const [mapZoom, setMapZoom] = useState(4);
  const [mapFlyKey, setMapFlyKey] = useState(0);
  const flyMapTo = useCallback((center, zoom) => {
    setMapCenter(center);
    setMapZoom(zoom);
    setMapFlyKey(k => k + 1);
  }, []);
  const [serviceCenterCoords, setServiceCenterCoords] = useState(null);
  const [isGeocoding, setIsGeocoding] = useState(true);
  const [showAllStorms, setShowAllStorms] = useState(() => {
    const saved = localStorage.getItem('showAllStorms');
    return saved !== null ? saved === 'true' : true;
  });

  // Persist showAllStorms to localStorage
  useEffect(() => {
    localStorage.setItem('showAllStorms', showAllStorms.toString());
  }, [showAllStorms]);
  const [autoRefresh, setAutoRefresh] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('stormAutoRefresh') === 'true';
    }
    return false;
  });
  useEffect(() => {
    localStorage.setItem('stormAutoRefresh', autoRefresh.toString());
  }, [autoRefresh]);
  const [daysBack, setDaysBack] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('stormDaysBack');
      return saved ? parseInt(saved) : 365;
    }
    return 365;
  });
  const [geocodedAreas, setGeocodedAreas] = useState({});
  const [geocodedSecondaryAreas, setGeocodedSecondaryAreas] = useState({});
  const [editingStormId, setEditingStormId] = useState(null);
  const [editSecondaryInput, setEditSecondaryInput] = useState('');
  const [secondarySuggestions, setSecondarySuggestions] = useState({});   // { stormId: [{name,hailSize,confirmed}] }
  const [suggestingForStorm, setSuggestingForStorm] = useState(null);     // stormId | null
  const [selectedSuggestions, setSelectedSuggestions] = useState({});     // { stormId: Set<string> }
  const [secondaryAreaAddressCache, setSecondaryAreaAddressCache] = useState({}); // { "stormId::cityName": {loading,addresses,error} }
  const [activeSecondaryAddressKey, setActiveSecondaryAddressKey] = useState(null); // "stormId::cityName"
  const [impactStormId, setImpactStormId] = useState(null);
  const [canvassPlannerContext, setCanvassPlannerContext] = useState(null);
  const [addressSearchRadius, setAddressSearchRadius] = useState(2);
  const [addressSearchMode, setAddressSearchMode] = useState('radius');
  const [stormAddressCache, setStormAddressCache] = useState({});
  const [addressTierData, setAddressTierData] = useState({});
  const [addressTierFilter, setAddressTierFilter] = useState({});
  const [stormSaveState, setStormSaveState] = useState({}); // { [stormId|key]: {loading,done,name,error} }
  const [savedCanvassLists, setSavedCanvassLists] = useState(null); // null=not loaded, []=empty, [{...}]=loaded
  const [savedListsLoading, setSavedListsLoading] = useState(false);
  const savedListsRef = useRef(null);
  const [ownerEnrichState, setOwnerEnrichState] = useState({}); // { [stormId]: {status,enriched[],matchCount,crmMatchCount,error} }
  const [prospectSaveState, setProspectSaveState] = useState({}); // { [stormId]: {loading,done,name,count} }
  const [skipCrmInProspect, setSkipCrmInProspect] = useState({}); // { [stormId]: boolean } — default true (skip existing)
  const [clusters, setClusters] = useState([]);
  const [selectedClusterStorms, setSelectedClusterStorms] = useState(null);
  const [mapBounds, setMapBounds] = useState(null);
  const [mapBoundsKey, setMapBoundsKey] = useState(0);
  // SBW polygon state: { stormId → { loading, feature, error } }
  const [swathPolygons, setSwathPolygons] = useState({});
  const [activeSwathStormId, setActiveSwathStormId] = useState(null);

  // ── Property History Lookup ───────────────────────────────────────────────
  const [propLookupAddress, setPropLookupAddress] = useState('');
  const [propLookupRadius, setPropLookupRadius] = useState(15);
  const [propLookupDays, setPropLookupDays] = useState(1825); // 5 years
  const [propLookupLoading, setPropLookupLoading] = useState(false);
  const [propLookupResults, setPropLookupResults] = useState(null); // null = no query yet
  const [propLookupError, setPropLookupError] = useState(null);
  const [propLookupResolvedAddr, setPropLookupResolvedAddr] = useState('');
  const [propLookupCoords, setPropLookupCoords] = useState(null);
  const [propLookupOpen, setPropLookupOpen] = useState(false);

  const handlePropertyAddressSelect = useCallback((address, details) => {
    setPropLookupAddress(address || '');
    setPropLookupError(null);
    setPropLookupResults(null);

    const location = details?.geometry?.location;
    const lat = typeof location?.lat === 'function' ? location.lat() : location?.lat;
    const lng = typeof location?.lng === 'function' ? location.lng() : location?.lng;
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      setPropLookupCoords({ lat: Number(lat), lng: Number(lng) });
    } else {
      // The search handler will use its server-side geocoder when Place Details
      // could not provide geometry.
      setPropLookupCoords(null);
    }
  }, []);

  const handlePropertyLookup = useCallback(async () => {
    const addr = propLookupAddress.trim();
    if (!addr) return;
    setPropLookupLoading(true);
    setPropLookupError(null);
    setPropLookupResults(null);
    setPropLookupResolvedAddr('');
    try {
      // A selected Google suggestion already contains authoritative geometry.
      // Only geocode typed/manual text or a suggestion whose details lacked it.
      const coords = propLookupCoords || await geocodeAddress(addr);
      if (!coords) {
        setPropLookupError('Could not find coordinates for that address. Select a complete address from the suggestions or include the city, state, and ZIP code.');
        return;
      }
      setPropLookupResolvedAddr(addr);
      const result = await base44.functions.invoke('getPropertyStormHistory', {
        lat: coords.lat,
        lng: coords.lng,
        radiusMiles: propLookupRadius,
        daysBack: propLookupDays,
      });
      const data = result?.data || result || {};
      if (!data.success) {
        setPropLookupError(data.error || 'Failed to fetch storm history.');
        return;
      }
      setPropLookupResults(data);
    } catch (err) {
      setPropLookupError(err.message || 'An error occurred while fetching storm history.');
    } finally {
      setPropLookupLoading(false);
    }
  }, [propLookupAddress, propLookupCoords, propLookupRadius, propLookupDays]);

  const handleCopyPropertyReport = useCallback(() => {
    if (!propLookupResults) return;
    const { stats, hailEvents, windEvents, tornadoEvents } = propLookupResults;
    const lines = [
      `Property Storm History Report`,
      `Address: ${propLookupResolvedAddr}`,
      `Search Radius: ${stats.radiusMiles} miles | Period: ${Math.round(stats.daysBack / 365)} year(s)`,
      `Risk Rating: ${stats.riskRating}`,
      ``,
      `HAIL EVENTS (≥1.0"): ${stats.hailCount} | Max: ${stats.maxHailInches > 0 ? stats.maxHailInches + '"' : 'N/A'}`,
      ...hailEvents.map(e => `  • ${e.start_time ? format(new Date(e.start_time), 'MMM d, yyyy') : '?'} — ${e.hail_size_inches}" hail${e.location ? ' @ ' + e.location : ''}${e.distance_miles != null ? ' (' + e.distance_miles + ' mi)' : ''}`),
      ``,
      `WIND EVENTS (≥55 mph): ${stats.windCount} | Max: ${stats.maxWindMph > 0 ? stats.maxWindMph + ' mph' : 'N/A'}`,
      ...windEvents.map(e => `  • ${e.start_time ? format(new Date(e.start_time), 'MMM d, yyyy') : '?'} — ${e.wind_speed_mph} mph${e.location ? ' @ ' + e.location : ''}${e.distance_miles != null ? ' (' + e.distance_miles + ' mi)' : ''}`),
      ``,
      `TORNADO EVENTS: ${stats.tornadoCount}`,
      ...tornadoEvents.map(e => `  • ${e.start_time ? format(new Date(e.start_time), 'MMM d, yyyy') : '?'}${e.location ? ' @ ' + e.location : ''}${e.distance_miles != null ? ' (' + e.distance_miles + ' mi)' : ''}`),
      ``,
      `Generated: ${format(new Date(), 'PPP')}`,
    ];
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      toast({ title: 'Report copied to clipboard' });
    }).catch(() => {
      toast({ title: 'Copy failed', description: 'Please select and copy manually.', variant: 'destructive' });
    });
  }, [propLookupResults, propLookupResolvedAddr, toast]);

  // MRMS MESH radar swath view
  const [mapViewMode, setMapViewMode] = useState(() => localStorage.getItem('stormMapViewMode') || 'spotter'); // 'radar' | 'spotter'
  useEffect(() => { localStorage.setItem('stormMapViewMode', mapViewMode); }, [mapViewMode]);
  const [meshOverlay, setMeshOverlay] = useState({ loading: false, available: false });
  const [stormMeshInfo, setStormMeshInfo] = useState({}); // { stormId: { meshInches, confidence, confidenceLabel } }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    setVisibleCount(20);
  }, [debouncedSearch, filterType, filterState]);

  const queryClient = useQueryClient();

  const { myCompany, isAdmin, hasPermission, isPermissionsReady } = useRoleBasedData();
  const HIDDEN_FEATURES = useHiddenFeatures();
  // 🔐 Only users with leads create access may generate CRM leads from storms
  const canGenerateLeads = !isPermissionsReady || isAdmin || hasPermission('leads', 'create');

  const { data: alertSettingsData = [], isLoading: isLoadingSettings } = useQuery({
    queryKey: ['storm-alert-settings', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StormAlertSettings.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    refetchOnWindowFocus: false,
  });

  const companySettings = alertSettingsData[0];

  // Parse office_locations from settings, falling back to legacy single-office fields
  const officeConfigs = useMemo(() => {
    if (!companySettings) return [];
    const offices = companySettings.office_locations;
    if (offices && offices.length > 0) return offices;
    // Legacy fallback
    if (companySettings.service_center_location) {
      return [{
        id: 'primary',
        name: 'Primary Office',
        location: companySettings.service_center_location,
        radius_miles: companySettings.service_radius_miles || 50,
        service_areas: companySettings.service_areas || [],
      }];
    }
    return [];
  }, [companySettings]);

  // Resolve quick coords for each office from KNOWN_CITY_COORDS
  const officeQuickCoords = useMemo(() => {
    return officeConfigs.map(office => {
      const city = (office.location || '').split(',')[0].toLowerCase().trim();
      const known = KNOWN_CITY_COORDS[city];
      if (known) return { ...office, lat: known.lat, lng: known.lng, state: known.state };
      return { ...office, lat: null, lng: null, state: null };
    });
  }, [officeConfigs]);

  // States across all offices for NWS advisory matching
  const includeStates = useMemo(() => {
    const states = new Set();
    officeQuickCoords.forEach(o => {
      if (o.state) states.add(o.state);
      (o.service_areas || []).forEach(area => {
        const match = area.match(/\b([A-Z]{2})\b/);
        if (match) states.add(match[1]);
      });
    });
    return Array.from(states);
  }, [officeQuickCoords]);

  // Geocoded coords for all offices (async, with fallback to quick coords)
  const [geocodedOffices, setGeocodedOffices] = useState([]);
  useEffect(() => {
    if (officeConfigs.length === 0) { setGeocodedOffices([]); setIsGeocoding(false); return; }
    setIsGeocoding(true);
    Promise.all(officeConfigs.map(async (office, idx) => {
      const quick = officeQuickCoords[idx];
      if (quick?.lat) return { ...office, lat: quick.lat, lng: quick.lng };
      const parts = (office.location || '').split(',').map(p => p.trim());
      const coords = await geocodeAddress(parts[0], parts[1] || null);
      return { ...office, lat: coords?.lat || null, lng: coords?.lng || null };
    })).then(results => {
      setGeocodedOffices(results);
      setIsGeocoding(false);
      // Fly to primary office if only one office
      const primary = results[0];
      if (primary?.lat && primary?.lng && !showAllStorms) {
        flyMapTo([primary.lat, primary.lng], results.length === 1 ? 8 : 7);
      }
    });
  }, [JSON.stringify(officeConfigs)]);

  // Primary office coords for backward compat (serviceCenterCoords)
  const centerCoordsForQuery = useMemo(() => {
    const first = officeQuickCoords[0];
    if (first?.lat) return { lat: first.lat, lng: first.lng };
    return null;
  }, [officeQuickCoords]);

  // Build officeLocations param for multi-office queries
  const officeLocationsParam = useMemo(() => {
    const offices = geocodedOffices.filter(o => o.lat && o.lng);
    if (offices.length === 0) return null;
    return offices.map(o => ({
      lat: o.lat,
      lng: o.lng,
      radiusMiles: o.radius_miles || 50,
      name: o.name || 'Office',
      includeStates: (() => {
        const st = new Set();
        const city = (o.location || '').split(',')[0].toLowerCase().trim();
        const known = KNOWN_CITY_COORDS[city];
        if (known?.state) st.add(known.state);
        (o.service_areas || []).forEach(area => {
          const m = area.match(/\b([A-Z]{2})\b/);
          if (m) st.add(m[1]);
        });
        return Array.from(st);
      })(),
    }));
  }, [geocodedOffices]);

  // Primary storms query — server-side geographic + date filtering
  const stormsQueryKey = ['storm-events-area',
    JSON.stringify(officeLocationsParam?.map(o => `${o.lat},${o.lng},${o.radiusMiles}`)),
    daysBack, showAllStorms, filterState, filterType,
    JSON.stringify(companySettings?.storm_types_to_monitor)];

  const { data: stormsData, isLoading: isLoadingStorms, error: stormsError, refetch: refetchStorms } = useQuery({
    queryKey: stormsQueryKey,
    queryFn: () => {
      const stateArg = filterState !== 'all' ? filterState : undefined;
      // When no specific type is selected in the UI, default to the user's configured types
      // so the server only returns relevant events rather than fetching everything and relying
      // solely on the client-side matchesUserSettings filter (which needs companySettings loaded).
      const configuredTypes = companySettings?.storm_types_to_monitor;
      const typesArg = filterType !== 'all'
        ? [filterType]
        : (configuredTypes && configuredTypes.length > 0 ? configuredTypes : undefined);
      const fetchStormPages = (params) => fetchAllStormEvents(
        (_functionName, pageParams) => base44.functions.invoke('getStormsInArea', pageParams),
        params,
      );
      if (showAllStorms) {
        return fetchStormPages({ lat: null, lng: null, radiusMiles: 0, daysBack, stateFilter: stateArg, types: typesArg });
      }
      // Multi-office path
      if (officeLocationsParam && officeLocationsParam.length > 0) {
        return fetchStormPages({ officeLocations: officeLocationsParam, daysBack, stateFilter: stateArg, types: typesArg });
      }
      // Single legacy office or no coords yet
      if (centerCoordsForQuery || serviceCenterCoords) {
        const coords = centerCoordsForQuery || serviceCenterCoords;
        return fetchStormPages({
          lat: coords.lat,
          lng: coords.lng,
          radiusMiles: companySettings?.service_radius_miles || 50,
          daysBack,
          includeStates,
          stateFilter: stateArg,
          types: typesArg,
        });
      }
      // No office configured — use state filter if available to still return results
      if (stateArg) {
        return fetchStormPages({ lat: null, lng: null, radiusMiles: 0, daysBack, stateFilter: stateArg, types: typesArg });
      }
      return fetchStormPages({ lat: null, lng: null, radiusMiles: 0, daysBack, types: typesArg });
    },
    enabled: isPageVisible,
    refetchInterval: autoRefresh ? 300000 : false,
    refetchIntervalInBackground: false,
    select: (res) => res?.data?.storms || [],
  });

  const storms = stormsData || [];

  // Active NWS alerts query — refreshes every 5 minutes automatically
  const { data: activeAlertsData = [] } = useQuery({
    queryKey: ['storm-active-alerts-all'],
    queryFn: () => base44.functions.invoke('getStormsInArea', { lat: null, lng: null, radiusMiles: 0, daysBack: 0, statusFilter: 'active', limit: 100 }),
    enabled: isPageVisible,
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
    select: (res) => res?.data?.storms || [],
  });

  const activeAlerts = activeAlertsData;

  // Keep serviceCenterCoords in sync with the primary geocoded office (for map auto-zoom compat)
  useEffect(() => {
    if (geocodedOffices.length > 0 && geocodedOffices[0]?.lat) {
      setServiceCenterCoords({ lat: geocodedOffices[0].lat, lng: geocodedOffices[0].lng });
    } else {
      setServiceCenterCoords(null);
    }
  }, [geocodedOffices]);

  // Helper to extract location from NWS area strings
  const extractLocationFromArea = (area) => {
    // Extract city and state from strings like "Coastal Waters from Eastport, ME to Schoodic Point, ME"
    // or "Knox, Lincoln, Sagadahoc, Waldo, Washington, ME"
    
    // Try to extract state abbreviation
    const stateMatch = area.match(/\b([A-Z]{2})\b/);
    if (!stateMatch) return area;
    
    const state = stateMatch[1];
    
    // Extract first city/county name before comma and state
    const locationMatch = area.match(/([A-Za-z\s]+),\s*[A-Z]{2}/);
    if (locationMatch) {
      const location = locationMatch[1].trim();
      // Remove common prefixes like "Coastal Waters from"
      const cleanLocation = location.replace(/^(Coastal Waters from|Waters from|from)\s+/i, '');
      return `${cleanLocation}, ${state}`;
    }
    
    // If multiple counties listed, just use the first one with state
    const countyMatch = area.match(/^([A-Za-z\s]+),/);
    if (countyMatch) {
      return `${countyMatch[1].trim()}, ${state}`;
    }
    
    return area;
  };



  const fetchStormsMutation = useMutation({
    mutationFn: (variables) => {
      const days = variables?.daysBack || daysBack;
      const isNationwide = variables?.nationwide ?? showAllStorms;
      console.log('🔄 Fetching storms (V2) with daysBack:', days, 'Nationwide:', isNationwide);
      return base44.functions.invoke('fetchStormDataV2', { 
        daysBack: days,
        nationwide: isNationwide
      });
    },
    onSuccess: async (response) => {
      console.log('✅ Fetch complete:', response.data);
      await refetchStorms();
    },
    onError: (error) => {
      console.error('❌ Fetch error:', error);
      toast({ title: t.failedFetchStormData, description: error.message, variant: 'destructive' });
    }
  });

  // Auto-fetch nationwide storms when database is empty (first-time / fresh account)
  const hasAutoFetched = useRef(false);
  useEffect(() => {
    if (
      showAllStorms &&
      !isLoadingStorms &&
      !fetchStormsMutation.isPending &&
      storms.length === 0 &&
      !hasAutoFetched.current &&
      myCompany
    ) {
      hasAutoFetched.current = true;
      fetchStormsMutation.mutate({ daysBack: 365, nationwide: true });
    }
  }, [showAllStorms, isLoadingStorms, fetchStormsMutation.isPending, storms.length, myCompany]);

  const updateSecondaryAreasMutation = useMutation({
    mutationFn: ({ stormId, secondaryAreas }) =>
      fetch('/api/functions/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ functionName: 'updateStormSecondaryAreas', params: { stormId, secondary_areas: secondaryAreas } }),
      }).then(async r => {
        const json = await r.json();
        if (!r.ok || json.error) throw new Error(json.error || 'Failed to save');
        return json;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stormsQueryKey });
      setEditingStormId(null);
      toast({ title: 'Secondary areas saved' });
    },
    onError: (error) => toast({ title: 'Failed to save secondary areas', description: error.message, variant: 'destructive' }),
  });

  const suggestNearbyAreas = useCallback(async (storm) => {
    const lat = parseFloat(storm.latitude || storm.lat);
    const lng = parseFloat(storm.longitude || storm.lng);
    if (!lat || !lng) return;
    setSuggestingForStorm(storm.id);
    try {
      const result = await base44.functions.invoke('suggestStormSwathAreas', {
        lat, lng,
        stormId: storm.id,
        startTime: storm.start_time || null,
        affectedAreas: storm.affected_areas || (storm.location ? [storm.location] : []),
        secondaryAreas: storm.secondary_areas || [],
      });
      const payload = result?.data || result || {};
      const suggestions = (payload.suggestions || []).map(s => ({ ...s, radarSource: payload.radarSource || null }));
      console.log(`🔵 Swath suggestions: ${suggestions.length} areas, IEM reports: ${result?.data?.iemCount ?? result?.iemCount ?? 'n/a'}`);
      setSecondarySuggestions(prev => ({ ...prev, [storm.id]: suggestions }));
      const preSelected = new Set(suggestions.filter(s => s.confirmed || s.confidence === 'high_opportunity').map(s => s.name));
      setSelectedSuggestions(prev => ({ ...prev, [storm.id]: preSelected }));
    } catch (e) {
      console.error('suggestNearbyAreas error', e);
    } finally {
      setSuggestingForStorm(null);
    }
  }, []);

  const fetchStormAddresses = useCallback(async (storm, radiusMiles) => {
    const r = radiusMiles || 2;
    const cacheKey = stormAddressCacheKey(storm.id, 'radius', r);
    if (!storm.latitude || !storm.longitude) {
      setStormAddressCache(prev => ({ ...prev, [cacheKey]: { loading: false, addresses: [], mode: 'radius', radiusMiles: r, error: 'No coordinates available for this storm.' } }));
      return;
    }
    setStormAddressCache(prev => ({ ...prev, [cacheKey]: { loading: true, addresses: [], mode: 'radius', radiusMiles: r, error: null, coverageWarning: null } }));
    try {
      const result = await base44.functions.invoke('fetchStormZoneAddresses', {
        lat: parseFloat(storm.latitude), lng: parseFloat(storm.longitude), radiusMiles: r,
      });
      const { addresses = [], mode, radiusMiles: rm, warning, coverageWarning } = result?.data || result || {};
      setStormAddressCache(prev => ({ ...prev, [cacheKey]: { loading: false, addresses, mode: mode || 'radius', radiusMiles: rm ?? r, error: warning || null, coverageWarning: coverageWarning || null } }));
      if (addresses.length) enrichStormAddressesWithMesh(cacheKey, addresses, storm.start_time, storm.id); // async, never blocks the list
    } catch (err) {
      setStormAddressCache(prev => ({ ...prev, [cacheKey]: { loading: false, addresses: [], mode: 'radius', radiusMiles: r, error: err.message, coverageWarning: null } }));
    }
  }, []);

  const fetchStormAddressesByCity = useCallback(async (storm) => {
    const cacheKey = stormAddressCacheKey(storm.id, 'city');
    const cityName = storm.affected_areas?.[0] || storm.city || null;
    if (!cityName) {
      setStormAddressCache(prev => ({ ...prev, [cacheKey]: { loading: false, addresses: [], mode: 'city', error: 'No city is available for this storm.' } }));
      return;
    }
    setStormAddressCache(prev => ({ ...prev, [cacheKey]: { loading: true, addresses: [], mode: 'city', error: null, coverageWarning: null } }));
    try {
      const params = { cityName, radiusMiles: null };
      if (storm.latitude != null && storm.longitude != null) {
        params.lat = parseFloat(storm.latitude);
        params.lng = parseFloat(storm.longitude);
      }
      const result = await base44.functions.invoke('fetchStormZoneAddresses', {
        ...params,
      });
      const { addresses = [], mode, radiusMiles: rm, scope, warning, coverageWarning } = result?.data || result || {};
      setStormAddressCache(prev => ({ ...prev, [cacheKey]: {
        loading: false,
        addresses,
        mode: mode || 'city',
        radiusMiles: rm ?? null,
        scope,
        error: warning || null,
        coverageWarning: coverageWarning || null,
      } }));
      if (addresses.length) enrichStormAddressesWithMesh(cacheKey, addresses, storm.start_time, storm.id);
    } catch (err) {
      setStormAddressCache(prev => ({ ...prev, [cacheKey]: { loading: false, addresses: [], mode: 'city', error: err.message, coverageWarning: null } }));
    }
  }, []);

  const fetchAddressesForSecondaryCity = useCallback(async (stormId, cityName, radiusMiles, stormTime) => {
    const key = `${stormId}::${cityName}`;
    setSecondaryAreaAddressCache(prev => ({ ...prev, [key]: { loading: true, addresses: [], error: null, coverageWarning: null, mode: radiusMiles ? 'radius' : 'city', radiusMiles } }));
    setActiveSecondaryAddressKey(key);
    try {
      const result = await base44.functions.invoke('fetchStormZoneAddresses', {
        cityName, radiusMiles: radiusMiles || null,
      });
      const { addresses = [], mode, radiusMiles: rm, warning, coverageWarning } = result?.data || result || {};
      setSecondaryAreaAddressCache(prev => ({ ...prev, [key]: { loading: false, addresses, error: warning || null, coverageWarning: coverageWarning || null, mode: mode || (radiusMiles ? 'radius' : 'city'), radiusMiles: rm ?? radiusMiles } }));
      if (addresses.length) enrichSecondaryAddressesWithMesh(key, addresses, stormTime, stormId);
    } catch (err) {
      setSecondaryAreaAddressCache(prev => ({ ...prev, [key]: { loading: false, addresses: [], error: err.message, coverageWarning: null, mode: radiusMiles ? 'radius' : 'city' } }));
    }
  }, []);

  // ── MRMS MESH enrichment ──────────────────────────────────────────────────
  // Samples the radar grid for a list of address points and returns per-point
  // confidence tiers. Async + non-blocking: callers merge results when ready.
  // Hail radar confidence only makes sense for hail-capable events — never badge wind/winter/flood advisories
  const isHailRelevant = (storm) => ['hail', 'thunderstorm', 'tornado'].includes(storm?.event_type);

  const sampleMeshForAddresses = useCallback(async (addresses, stormTime, stormId) => {
    const pts = (addresses || [])
      .map(a => ({ lat: parseFloat(a.lat), lng: parseFloat(a.lon ?? a.lng) }))
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (!pts.length) return null;
    try {
      const result = await base44.functions.invoke('sampleMeshPoints', { points: pts.slice(0, 2000), stormTime, stormId });
      const d = result?.data || result || {};
      return d.available ? { results: d.results, radarSource: d.radarSource || null } : null;
    } catch { return null; }
  }, []);

  // Enrich an address cache entry (primary storm zone) with mesh confidence
  const enrichStormAddressesWithMesh = useCallback(async (cacheKey, addresses, stormTime, stormId) => {
    const meshData = await sampleMeshForAddresses(addresses, stormTime, stormId);
    if (!meshData) return;
    setStormAddressCache(prev => {
      const entry = prev[cacheKey];
      if (!entry || entry.addresses !== addresses) return prev; // stale
      return { ...prev, [cacheKey]: { ...entry, meshResults: meshData.results, radarSource: meshData.radarSource } };
    });
  }, [sampleMeshForAddresses]);

  const enrichSecondaryAddressesWithMesh = useCallback(async (key, addresses, stormTime, stormId) => {
    const meshData = await sampleMeshForAddresses(addresses, stormTime, stormId);
    if (!meshData) return;
    setSecondaryAreaAddressCache(prev => {
      const entry = prev[key];
      if (!entry || entry.addresses !== addresses) return prev;
      return { ...prev, [key]: { ...entry, meshResults: meshData.results, radarSource: meshData.radarSource } };
    });
  }, [sampleMeshForAddresses]);

  // Sample current radar for fresh storms and persisted snapshots for older ones.
  useEffect(() => {
    if (!selectedClusterStorms?.length) return;
    const candidates = selectedClusterStorms.filter(s => {
      if (stormMeshInfo[s.id]) return false;
      if (!isHailRelevant(s)) return false; // wind/winter/flood events get no hail badge
      const lat = parseFloat(s.latitude || s.lat), lng = parseFloat(s.longitude || s.lng);
      return Number.isFinite(lat) && Number.isFinite(lng);
    });
    if (!candidates.length) return;
    (async () => {
      try {
        const sampled = await Promise.all(candidates.map(async (s) => {
          const result = await base44.functions.invoke('sampleMeshPoints', {
            points: [{
              lat: parseFloat(s.latitude || s.lat),
              lng: parseFloat(s.longitude || s.lng),
              hasSpotterReport: (s.source || '').toLowerCase().includes('iem') || s.event_type === 'hail',
            }],
            stormTime: s.start_time,
            stormId: s.id,
          });
          const d = result?.data || result || {};
          return d.available ? { result: d.results?.[0], radarSource: d.radarSource } : null;
        }));
        setStormMeshInfo(prev => {
          const next = { ...prev };
          candidates.forEach((s, i) => {
            if (sampled[i]?.result) next[s.id] = { ...sampled[i].result, radarSource: sampled[i].radarSource };
          });
          return next;
        });
      } catch { /* non-fatal — cards just omit the badge */ }
    })();
  }, [selectedClusterStorms]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveStormCanvassList = useCallback(async (key, addresses, stormTitle, stormId, radiusMiles, mode) => {
    if (!addresses?.length) return;
    setStormSaveState(prev => ({ ...prev, [key]: { loading: true, done: false, name: null, error: null } }));
    try {
      const result = await base44.functions.invoke('saveCanvassList', {
        addresses,
        stormTitle: stormTitle || '',
        stormId: stormId || '',
        radiusMiles: radiusMiles || null,
        mode: mode || 'radius',
      });
      const d = result?.data || result || {};
      setStormSaveState(prev => ({
        ...prev,
        [key]: { loading: false, done: true, name: d.name || 'Canvass List', count: d.addressCount || addresses.length, error: null },
      }));
      // Refresh saved lists panel and scroll to it
      setSavedCanvassLists(null);
      loadSavedCanvassLists();
      setTimeout(() => savedListsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
    } catch (e) {
      setStormSaveState(prev => ({ ...prev, [key]: {
        loading: false,
        done: false,
        name: null,
        error: stormActionError(e, 'Could not save this canvass list. Please try again.'),
      } }));
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const loadSavedCanvassLists = useCallback(async () => {
    setSavedListsLoading(true);
    try {
      const result = await base44.functions.invoke('getCanvassLists', {});
      setSavedCanvassLists(result?.data?.lists || result?.lists || []);
    } catch {
      setSavedCanvassLists([]);
    } finally {
      setSavedListsLoading(false);
    }
  }, []);

  // Enrich storm addresses with BatchLeads owner data
  const enrichStormOwners = useCallback(async (stormId, addresses, stormTitle) => {
    if (!addresses?.length) return;
    setOwnerEnrichState(prev => ({ ...prev, [stormId]: { status: 'loading', enriched: [], matchCount: 0, error: null } }));
    try {
      const result = await base44.functions.invoke('enrichStormAddresses', {
        addresses,
        stormTitle: stormTitle || '',
        stormId: stormId || '',
      });
      const d = result?.data || result || {};
      if (d.hasApiKey === false) {
        setOwnerEnrichState(prev => ({ ...prev, [stormId]: { status: 'no_key', enriched: [], matchCount: 0, crmMatchCount: 0, error: null } }));
      } else if (d.success) {
        setOwnerEnrichState(prev => ({ ...prev, [stormId]: { status: 'done', enriched: d.enriched || [], matchCount: d.matchCount || 0, crmMatchCount: d.crmMatchCount || 0, error: null } }));
        // Default: skip already-in-CRM records when saving as prospect list
        setSkipCrmInProspect(prev => ({ ...prev, [stormId]: prev[stormId] !== false }));
      } else {
        setOwnerEnrichState(prev => ({ ...prev, [stormId]: { status: 'error', enriched: [], matchCount: 0, crmMatchCount: 0, error: d.message || 'Enrichment failed' } }));
      }
    } catch (e) {
      setOwnerEnrichState(prev => ({ ...prev, [stormId]: {
        status: 'error',
        enriched: [],
        matchCount: 0,
        error: stormActionError(e, 'Owner information could not be loaded. Please try again.'),
      } }));
    }
  }, []);

  // Save enriched addresses as a ProspectList entity for Lead Finder
  const saveAsProspectList = useCallback(async (stormId, enrichedAddresses, stormTitle) => {
    if (!enrichedAddresses?.length) return;
    setProspectSaveState(prev => ({ ...prev, [stormId]: { loading: true, done: false, name: null } }));
    try {
      const result = await base44.functions.invoke('saveStormProspectList', {
        addresses: enrichedAddresses,
        stormTitle: stormTitle || '',
        stormId: stormId || '',
      });
      const d = result?.data || result || {};
      setProspectSaveState(prev => ({ ...prev, [stormId]: { loading: false, done: true, name: d.name || 'Prospect List', count: d.count || enrichedAddresses.length } }));
      toast({ title: '✅ Prospect List saved!', description: 'Open Lead Finder and search this area — prospects appear with "Add" buttons.' });
    } catch (e) {
      const message = stormActionError(e, 'Could not save this prospect list. Please try again.');
      setProspectSaveState(prev => ({ ...prev, [stormId]: { loading: false, done: false, name: null, error: message } }));
      toast({ title: 'Failed to save prospect list', description: message, variant: 'destructive' });
    }
  }, [toast]);

  const downloadAddressCSV = useCallback((storm, addresses, tierAssignments) => {
    const hasTiers = tierAssignments && Object.keys(tierAssignments).length > 0;
    const header = hasTiers ? 'Tier,Value Signal,Street Address,City,State,ZIP\n' : 'Street Address,City,State,ZIP\n';
    const rows = addresses.map(a => {
      const tier = hasTiers ? getAddrTier(a, tierAssignments) : null;
      const tierStr = tier ? tier.label : '';
      const valStr = tier?.value ? `$${tier.value.toLocaleString()}` : tier?.source || '';
      return hasTiers
        ? `"${tierStr}","${valStr}","${a.street}","${a.city}","${a.state}","${a.zip}"`
        : `"${a.street}","${a.city}","${a.state}","${a.zip}"`;
    }).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `storm-addresses-${storm.id.slice(-6)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const fetchAddressTiers = useCallback(async (cacheKey, addresses) => {
    const zips = [...new Set(addresses.map(a => a.zip).filter(z => /^\d{5}$/.test(z)))];
    if (zips.length === 0) {
      setAddressTierData(prev => ({ ...prev, [cacheKey]: {
        loading: false,
        zipValues: {},
        tierAssignments: {},
        error: 'No valid ZIP codes were available for the home-value lookup.',
      } }));
      return;
    }
    setAddressTierData(prev => ({ ...prev, [cacheKey]: { loading: true, zipValues: {}, tierAssignments: {}, error: null } }));
    try {
      const allZipValues = await fetchCensusZipMedianValues();
      const zipValues = Object.fromEntries(zips
        .filter(zip => allZipValues[zip] > 0)
        .map(zip => [zip, allZipValues[zip]]));
      setAddressTierData(prev => ({ ...prev, [cacheKey]: { loading: false, zipValues, tierAssignments: buildAddressTierAssignments(addresses, zipValues), error: null } }));
    } catch (err) {
      setAddressTierData(prev => ({ ...prev, [cacheKey]: {
        loading: false,
        zipValues: {},
        tierAssignments: {},
        error: stormActionError(err, 'Home-value data could not be loaded.'),
      } }));
    }
  }, []);

  const generateLeadsMutation = useMutation({
    mutationFn: (stormId) => base44.functions.invoke('generateStormLeads', { stormId }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['storm-events'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      const count = response.data?.leadsGenerated || 0;
      toast({ title: `Generated ${count} lead${count === 1 ? '' : 's'}`, description: `From "${response.data?.stormTitle}"` });
    },
    onError: (error) => {
      toast({ title: t.failedGenerateLeads, description: error.message, variant: 'destructive' });
    }
  });

  const handleGenerateLeads = (storm) => {
    generateLeadsMutation.mutate(storm.id);
  };

  const getStormIcon = (type) => {
    const icons = {
      hail: Cloud,
      tornado: Wind,
      thunderstorm: CloudRain,
      high_wind: Wind,
      flood: CloudRain,
      winter_storm: Cloud
    };
    return icons[type] || AlertTriangle;
  };

  const getSeverityColorClasses = (severity) => {
    const normalizedSeverity = formatStormSeverityLabel(severity).toLowerCase();
    const configs = {
      minor: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
      moderate: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-200' },
      severe: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
      extreme: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' }
    };
    return configs[normalizedSeverity] || configs.moderate;
  };

  const getCircleColor = (severity) => {
    const normalizedSeverity = formatStormSeverityLabel(severity).toLowerCase();
    const colors = {
      minor: '#3b82f6',
      moderate: '#f59e0b',
      severe: '#f97316',
      extreme: '#ef4444'
    };
    return colors[normalizedSeverity] || colors.moderate;
  };

  const getSeverityBgColor = (severity) => {
    const normalizedSeverity = formatStormSeverityLabel(severity).toLowerCase();
    const colors = {
      minor: 'rgba(59, 130, 246, 0.4)',      // blue
      moderate: 'rgba(245, 158, 11, 0.4)',   // yellow/amber
      severe: 'rgba(249, 115, 22, 0.4)',    // orange
      extreme: 'rgba(239, 68, 68, 0.5)'      // red
    };
    return colors[normalizedSeverity] || colors.moderate;
  };

  // Server already filters by geography and date — this memo just handles remaining UI filters
  const stormsInServiceArea = useMemo(() => {
    return storms; // Server-filtered: already within radius + date range
  }, [storms]);

  const filteredStorms = useMemo(() => {
    return stormsInServiceArea.filter(storm => {
      const isWinterNWSEvent = storm.source === 'NWS_HISTORICAL' && (
        storm.nws_event?.includes('Winter') || storm.nws_event?.includes('Blizzard') ||
        storm.nws_event?.includes('Ice Storm') || storm.nws_event?.includes('Lake Effect Snow')
      );
      const matchesType = filterType === 'all'
        || storm.event_type === filterType
        || (filterType === 'high_wind' && storm.event_type === 'high_wind')
        || (filterType === 'winter_storm' && (storm.event_type === 'winter_storm' || isWinterNWSEvent));

      let matchesState = true;
      if (filterState !== 'all') {
        const stateUpper = filterState.toUpperCase();
        // Check affected_areas text, OR nws_state field (for advisory-type storms with county-only area names)
        matchesState = storm.nws_state === stateUpper ||
          storm.affected_areas?.some(area => {
            const match = area.match(/\b([A-Z]{2})\b/);
            return match && match[1] === stateUpper;
          }) || false;
      }

      const searchLower = debouncedSearch.toLowerCase();
      let matchesSearch = true;
      if (searchLower) {
        const stateAbbreviations = {
          'alabama': 'al', 'alaska': 'ak', 'arizona': 'az', 'arkansas': 'ar', 'california': 'ca',
          'colorado': 'co', 'connecticut': 'ct', 'delaware': 'de', 'florida': 'fl', 'georgia': 'ga',
          'hawaii': 'hi', 'idaho': 'id', 'illinois': 'il', 'indiana': 'in', 'iowa': 'ia',
          'kansas': 'ks', 'kentucky': 'ky', 'louisiana': 'la', 'maine': 'me', 'maryland': 'md',
          'massachusetts': 'ma', 'michigan': 'mi', 'minnesota': 'mn', 'mississippi': 'ms', 'missouri': 'mo',
          'montana': 'mt', 'nebraska': 'ne', 'nevada': 'nv', 'new hampshire': 'nh', 'new jersey': 'nj',
          'new mexico': 'nm', 'new york': 'ny', 'north carolina': 'nc', 'north dakota': 'nd', 'ohio': 'oh',
          'oklahoma': 'ok', 'oregon': 'or', 'pennsylvania': 'pa', 'rhode island': 'ri', 'south carolina': 'sc',
          'south dakota': 'sd', 'tennessee': 'tn', 'texas': 'tx', 'utah': 'ut', 'vermont': 'vt',
          'virginia': 'va', 'washington': 'wa', 'west virginia': 'wv', 'wisconsin': 'wi', 'wyoming': 'wy'
        };
        const stateAbbr = stateAbbreviations[searchLower];
        matchesSearch = storm.title?.toLowerCase().includes(searchLower) ||
                            storm.affected_areas?.some(area => {
                              const areaLower = area.toLowerCase();
                              if (areaLower.includes(searchLower)) return true;
                              if (stateAbbr && areaLower.includes(`, ${stateAbbr}`)) return true;
                              return false;
                            });
      }

      const userEnabledTypes = companySettings?.storm_types_to_monitor || [];
      const matchesUserSettings = filterType !== 'all' ? true : (userEnabledTypes.length === 0 || userEnabledTypes.includes(storm.event_type));

      return matchesType && matchesState && matchesSearch && matchesUserSettings;
    });
  }, [stormsInServiceArea, filterType, filterState, debouncedSearch, showAllStorms, companySettings]);

  const sortedStorms = useMemo(() => {
    return [...filteredStorms].sort((a, b) => {
      const aSevere = isSevereStorm(a) ? 1 : 0;
      const bSevere = isSevereStorm(b) ? 1 : 0;
      if (bSevere !== aSevere) return bSevere - aSevere;
      const severityOrder = { extreme: 4, severe: 3, moderate: 2, minor: 1 };
      const bSeverity = formatStormSeverityLabel(b.severity).toLowerCase();
      const aSeverity = formatStormSeverityLabel(a.severity).toLowerCase();
      const severityDiff = (severityOrder[bSeverity] || 0) - (severityOrder[aSeverity] || 0);
      if (severityDiff !== 0) return severityDiff;
      return new Date(b.start_time) - new Date(a.start_time);
    });
  }, [filteredStorms]);

  const visibleStorms = useMemo(() => {
    return sortedStorms.slice(0, visibleCount);
  }, [sortedStorms, visibleCount]);

  const handleLoadMore = useCallback(() => {
    setVisibleCount(prev => prev + 20);
  }, []);

  // Geocode filtered storms that are missing coordinates
  useEffect(() => {
    const geocodeMissing = async () => {
      // Only process filtered storms to save resources
      const missingCoords = filteredStorms.filter(s => 
        !s.latitude && !s.longitude && 
        s.affected_areas && 
        s.affected_areas.some(area => !geocodedAreas[`${s.id}-${area}`])
      );

      if (missingCoords.length === 0) return;

      console.log(`🌍 Geocoding ${missingCoords.length} filtered storms...`);
      const newGeocodedAreas = { ...geocodedAreas };
      let updated = false;

      for (const storm of missingCoords) {
        // Only geocode the first affected area for mapping purposes to save time
        // The clustering logic looks for *any* geocoded area.
        
        for (const area of storm.affected_areas) {
           const key = `${storm.id}-${area}`;
           if (newGeocodedAreas[key]) continue; // Already have it (in local accumulation)

           const cleanArea = extractLocationFromArea(area); 
           const coords = await geocodeAddress(cleanArea);
           if (coords) {
             newGeocodedAreas[key] = coords;
             updated = true;
             // One valid coordinate is enough to show the storm on the map
             break; 
           }
           // Small delay to prevent rate limiting
           await new Promise(r => setTimeout(r, 200)); 
        }
      }

      if (updated) {
        setGeocodedAreas(prev => ({ ...prev, ...newGeocodedAreas }));
      }
    };

    // Use a small timeout to debounce typing in search box
    const timer = setTimeout(() => {
      if (filteredStorms.length > 0 && filteredStorms.length < 100) { // Limit to avoid massive geocoding batches
        geocodeMissing();
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [filteredStorms, geocodedAreas]);

  // Geocode secondary_areas for storms that have them
  useEffect(() => {
    const geocodeSecondary = async () => {
      const toGeocode = filteredStorms.filter(s =>
        s.secondary_areas?.length > 0 &&
        s.secondary_areas.some(area => !geocodedSecondaryAreas[`${s.id}-sec-${area}`])
      );
      if (toGeocode.length === 0) return;
      const updated = { ...geocodedSecondaryAreas };
      let changed = false;
      for (const storm of toGeocode) {
        for (const area of storm.secondary_areas) {
          const key = `${storm.id}-sec-${area}`;
          if (updated[key]) continue;
          const cityLower = area.toLowerCase().trim();
          if (KNOWN_CITY_COORDS[cityLower]) {
            updated[key] = { lat: KNOWN_CITY_COORDS[cityLower].lat, lng: KNOWN_CITY_COORDS[cityLower].lng };
            changed = true;
          } else {
            const cleanArea = extractLocationFromArea(area);
            const coords = await geocodeAddress(cleanArea);
            if (coords) { updated[key] = coords; changed = true; }
            await new Promise(r => setTimeout(r, 200));
          }
        }
      }
      if (changed) setGeocodedSecondaryAreas(prev => ({ ...prev, ...updated }));
    };
    const timer = setTimeout(() => { if (filteredStorms.length > 0) geocodeSecondary(); }, 1500);
    return () => clearTimeout(timer);
  }, [filteredStorms, geocodedSecondaryAreas]);

  // Optimized Clustering Logic
  useEffect(() => {
    // Debounce to prevent freezing UI during rapid zoom/pan
    const timer = setTimeout(() => {
      const calculateClusters = () => {
        // 1. Prepare data with coordinates (O(N))
        const points = [];
        for (const storm of filteredStorms) {
          let lat = storm.lat || storm.latitude;
          let lng = storm.lng || storm.longitude;
          
          // If no direct coords, try geocoded areas (use first valid one)
          if ((!lat || !lng) && storm.affected_areas) {
            for (const area of storm.affected_areas) {
              const key = `${storm.id}-${area}`;
              const coords = geocodedAreas[key];
              if (coords) {
                lat = coords.lat;
                lng = coords.lng;
                break; 
              }
            }
          }
          
          if (lat && lng) {
            points.push({ ...storm, lat, lng });
          }
        }

        // 2. Grid-based Clustering (O(N)) - Much faster than distance-based O(N^2)
        // Divide map into grid cells. All points in same cell = one cluster.
        // Cell size depends on zoom level.
        // At zoom 4, 360 deg longitude / 20 = 18 deg per cell roughly. 
        // We want simpler: approx 50px visual size.
        // 360 degrees / 2^zoom = degrees per tile. 
        // 40px threshold ~ 40/256 * (360/2^zoom)
        const gridSize = 60 / Math.pow(2, mapZoom); // Degrees width of a grid cell
        const grid = {};

        points.forEach(point => {
          // Calculate grid cell indices
          const row = Math.floor(point.lat / gridSize);
          const col = Math.floor(point.lng / gridSize);
          const key = `${row}-${col}`;

          if (!grid[key]) {
            grid[key] = {
              id: `g-${key}`,
              points: [],
              latSum: 0,
              lngSum: 0,
              maxSeverity: 'minor'
            };
          }

          const cluster = grid[key];
          cluster.points.push(point);
          cluster.latSum += point.lat;
          cluster.lngSum += point.lng;
          
          // Update max severity
          const sevOrder = { extreme: 4, severe: 3, moderate: 2, minor: 1 };
          const normalizedSeverity = formatStormSeverityLabel(point.severity).toLowerCase();
          if (sevOrder[normalizedSeverity] > sevOrder[cluster.maxSeverity]) {
            cluster.maxSeverity = normalizedSeverity;
          }
        });

        // 3. Convert grid back to array and calculate centroids
        const newClusters = Object.values(grid).map(cluster => ({
          id: cluster.id,
          points: cluster.points,
          lat: cluster.latSum / cluster.points.length,
          lng: cluster.lngSum / cluster.points.length,
          maxSeverity: cluster.maxSeverity
        }));

        setClusters(newClusters);
      };

      calculateClusters();
    }, 50); // 50ms debounce

    return () => clearTimeout(timer);
  }, [filteredStorms, mapZoom, geocodedAreas]);

  useEffect(() => {
    if (debouncedSearch && filteredStorms.length > 0) {
      // Get all storms with coords (both direct + geocoded affected areas)
      const stormsWithCoords = filteredStorms.filter(s => {
        if (s.latitude && s.longitude) return true;
        if (!s.latitude && !s.longitude && s.affected_areas) {
          return s.affected_areas.some(area => {
            const key = `${s.id}-${area}`;
            return geocodedAreas[key];
          });
        }
        return false;
      });
      
      if (stormsWithCoords.length > 0) {
        let totalLat = 0, totalLng = 0, count = 0;
        
        // Add direct coords
        stormsWithCoords.forEach(s => {
          if (s.latitude && s.longitude) {
            totalLat += s.latitude;
            totalLng += s.longitude;
            count++;
          }
        });
        
        // Add geocoded area coords
        stormsWithCoords.forEach(s => {
          if (!s.latitude && !s.longitude && s.affected_areas) {
            s.affected_areas.forEach(area => {
              const key = `${s.id}-${area}`;
              const coords = geocodedAreas[key];
              if (coords) {
                totalLat += coords.lat;
                totalLng += coords.lng;
                count++;
              }
            });
          }
        });
        
        if (count > 0) {
          flyMapTo([totalLat / count, totalLng / count], 6);
        }
      }
    } else if (!debouncedSearch && serviceCenterCoords) {
      flyMapTo([serviceCenterCoords.lat, serviceCenterCoords.lng], 8);
    }
  }, [debouncedSearch, filteredStorms.length, serviceCenterCoords, geocodedAreas]);

  // When nationwide mode is enabled, return map to US overview
  useEffect(() => {
    if (showAllStorms) {
      flyMapTo([39.8283, -98.5795], 4);
    }
  }, [showAllStorms]);

  // Auto-fit map to bounding box of service-area storms when data loads.
  // When showAllStorms=true (nationwide), keep the US default view — don't try to fit 500 global storms.
  useEffect(() => {
    if (debouncedSearch) return;
    if (showAllStorms) return; // Nationwide mode — stay at US overview
    if (!storms || storms.length === 0) return;

    const US_LAT_MIN = 24.0, US_LAT_MAX = 50.5;
    const US_LNG_MIN = -125.5, US_LNG_MAX = -66.0;

    const points = [];
    // Include all geocoded office locations in the fit bounds calculation
    geocodedOffices.filter(o => o.lat && o.lng).forEach(o => points.push([o.lat, o.lng]));

    storms.forEach(s => {
      const lat = s.lat ? parseFloat(s.lat) : (s.latitude ? parseFloat(s.latitude) : null);
      const lng = s.lng ? parseFloat(s.lng) : (s.longitude ? parseFloat(s.longitude) : null);
      if (lat && lng && !isNaN(lat) && !isNaN(lng)
          && lat >= US_LAT_MIN && lat <= US_LAT_MAX && lng >= US_LNG_MIN && lng <= US_LNG_MAX) {
        points.push([lat, lng]);
      }
    });

    if (points.length >= 2) {
      const lats = points.map(p => p[0]);
      const lngs = points.map(p => p[1]);
      const bounds = [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ];
      setMapBounds(bounds);
      setMapBoundsKey(k => k + 1);
    } else {
      const firstOffice = geocodedOffices.find(o => o.lat && o.lng);
      if (firstOffice) flyMapTo([firstOffice.lat, firstOffice.lng], 8);
    }
  }, [storms.length, geocodedOffices, showAllStorms]);

  // In local mode the server already radius-filtered, so every filtered storm IS in your area.
  // In nationwide mode, do a client-side haversine check against each geocoded office.
  const activeStorms = useMemo(() => {
    if (!showAllStorms) return filteredStorms.length;
    const offices = geocodedOffices.filter(o => o.lat && o.lng);
    if (offices.length === 0) return 0;
    return filteredStorms.filter(storm => {
      const lat = parseFloat(storm.latitude);
      const lng = parseFloat(storm.longitude);
      if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return false;
      return offices.some(o => haversineDistMiles(o.lat, o.lng, lat, lng) <= (o.radius_miles || 50));
    }).length;
  }, [filteredStorms, showAllStorms, geocodedOffices]);
  const severeStorms = filteredStorms.filter(s => s.severity === 'severe' || s.severity === 'extreme').length;
  const totalAffectedAreas = new Set(filteredStorms.flatMap(s => s.affected_areas || [])).size;
  const totalLeadsGenerated = filteredStorms.reduce((sum, s) => sum + (s.leads_generated || 0), 0);
  // Only show the radar toggle when hail-capable storms are in view — otherwise it's just noise
  const hasHailEvents = filteredStorms.some(s => isHailRelevant(s));

  const hasSettings = officeConfigs.length > 0 && officeConfigs.some(o => o.location);
  const showSetupPrompt = !hasSettings && !showAllStorms && !isLoadingStorms && !isLoadingSettings && !!myCompany;

  return (
    <div className="p-2 sm:p-4 md:p-6 space-y-3 sm:space-y-4 md:space-y-6 bg-gray-50 min-h-screen">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">Storm Tracking</h1>
          <p className="text-xs sm:text-sm md:text-base text-gray-500 mt-1">
            Real-time severe weather monitoring powered by NOAA
            {geocodedOffices.length > 1 && (
              <span className="ml-2 text-blue-600 font-medium">
                · {geocodedOffices.length} offices monitored
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => navigate(createPageUrl('StormAlertSettings'))}
            className="flex-1 md:flex-none"
          >
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </Button>
          <Button
            onClick={() => {
              console.log('🔄 Manual refresh triggered with daysBack:', daysBack, 'Nationwide:', showAllStorms);
              fetchStormsMutation.mutate({ daysBack, nationwide: showAllStorms });
            }}
            disabled={fetchStormsMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700 flex-1 md:flex-none"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${fetchStormsMutation.isPending ? 'animate-spin' : ''}`} />
            {fetchStormsMutation.isPending ? 'Updating...' : `Refresh ${showAllStorms ? 'Nationwide' : 'Local'} (${daysBack}d)`}
          </Button>
          {!showAllStorms && (
            <Button
              onClick={() => {
                setShowAllStorms(true);
                fetchStormsMutation.mutate({ daysBack, nationwide: true });
              }}
              disabled={fetchStormsMutation.isPending}
              className="bg-purple-600 hover:bg-purple-700 flex-1 md:flex-none"
            >
              <Search className="w-4 h-4 mr-2" />
              Find All (Nationwide)
            </Button>
          )}
        </div>
      </div>

      {/* ACTIVE NWS WARNINGS BANNER — shown when live alerts exist in service area */}
      {activeAlerts.length > 0 && (
        <div className="bg-red-600 text-white rounded-lg p-4 shadow-lg animate-pulse border-2 border-red-400">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-bold text-lg">⚡ Active Weather Warning in Your Service Area</div>
              <div className="mt-1 space-y-1">
                {activeAlerts.slice(0, 3).map((alert, i) => (
                  <div key={alert.id || i} className="text-sm text-red-100">
                    <span className="font-semibold">{alert.nws_event || alert.event_type?.replace('_', ' ').toUpperCase()}</span>
                    {alert.distance_miles > 0 && (
                      <span> — {Number(alert.distance_miles || 0).toFixed(0)} miles from {alert.nearest_office || 'your service center'}</span>
                    )}
                    {alert.expires_at && <span className="opacity-75"> · Expires {new Date(alert.expires_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}</span>}
                  </div>
                ))}
                {activeAlerts.length > 3 && <div className="text-sm text-red-200">+{activeAlerts.length - 3} more active warnings</div>}
              </div>
              <div className="mt-2 text-xs text-red-200">Source: NOAA National Weather Service · Updates every 5 minutes</div>
            </div>
            <div className="text-right text-sm font-bold bg-red-700 rounded px-2 py-1">
              {activeAlerts.length} ACTIVE
            </div>
          </div>
        </div>
      )}

      {showSetupPrompt && (
        <Alert className="bg-yellow-50 border-yellow-200">
          <Info className="h-4 w-4 text-yellow-600" />
          <AlertDescription>
            <div className="flex items-start justify-between">
              <div>
                <strong className="text-yellow-900">Setup Required</strong>
                <p className="text-sm text-yellow-800 mt-1">
                  Configure your service area to receive storm alerts and filter relevant storms.
                </p>
              </div>
              <Button 
                size="sm" 
                onClick={() => navigate(createPageUrl('StormAlertSettings'))}
                className="bg-yellow-600 hover:bg-yellow-700 ml-4"
              >
                Setup Now
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {storms.length > 0 && (
        <details className="group rounded-lg border border-green-300 bg-gradient-to-r from-green-50 to-emerald-50 shadow-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-green-900 marker:content-none">
            <Info className="h-4 w-4 shrink-0 text-green-700" />
            <strong className="flex-1 text-base">How to Get REAL Property Owner Leads (100% FREE)</strong>
            <span aria-hidden="true" className="text-lg transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <div className="border-t border-green-200 px-4 pb-4 pt-3">
            <div className="text-sm text-green-900 max-h-[320px] overflow-y-auto pr-2">
              <ol className="list-decimal list-inside mt-3 space-y-2 ml-2">
                <li><strong>When a storm hits</strong> → Note the affected zip codes (e.g., 44903, 44906)</li>
                <li><strong>Visit county auditor website</strong> → Go to Property Search</li>
                <li><strong>Filter by zip code</strong> → Select storm-affected areas</li>
                <li><strong>Download CSV</strong> → Export 100-500 REAL property owner records</li>
                <li><strong>Import here</strong> → Click "Get REAL Leads" button on any storm below</li>
                <li><strong>Optional: Get phone numbers</strong> → Use skip tracing to enrich leads with contact info</li>
              </ol>
              <div className="mt-4 p-3 bg-white border border-green-200 rounded-lg">
                <p className="font-semibold text-green-900 mb-2">📊 Current Summary:</p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li><strong>{storms.length} total storms</strong> in database</li>
                  {officeConfigs.length > 1 ? (
                    officeConfigs.map((o, i) => (
                      <li key={o.id || i}><strong>{o.name || `Office ${i + 1}`}</strong>: {o.location} · {o.radius_miles || 50} mi radius</li>
                    ))
                  ) : companySettings?.service_center_location ? (
                    <>
                      <li>Service center: <strong>{companySettings.service_center_location}</strong></li>
                      <li>Service radius: <strong>{companySettings.service_radius_miles || 50} miles</strong></li>
                    </>
                  ) : null}
                  <li className="font-bold text-green-900">
                    {showAllStorms ? (
                      `Showing all ${storms.length} storms nationwide`
                    ) : (
                      `${stormsInServiceArea.length} storms in your service area`
                    )}
                  </li>
                  <li className="text-orange-700 italic">⚠️ Note: NWS alerts (High Wind Warnings) appear in the list but not as circles on the map because they cover entire counties without specific coordinates.</li>
                </ul>
              </div>
            </div>
          </div>
        </details>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-gradient-to-r from-blue-50 to-cyan-50 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  {autoRefresh ? <CheckCircle className="w-5 h-5 text-blue-600" /> : <Bell className="w-5 h-5 text-blue-600" />}
                </div>
                <div>
                  <p className="font-medium text-blue-900">Auto-Refresh Storm Data</p>
                  <p className="text-sm text-blue-700">
                    {autoRefresh ? 'Checking for new storms every 5 minutes' : 'Manual refresh only'}
                  </p>
                </div>
              </div>
              <Switch
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
                data-testid="switch-auto-refresh-storms"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <Label className="font-medium text-purple-900">Search History</Label>
                <p className="text-sm text-purple-700 mt-1">
                  Currently searching back {daysBack} days
                </p>
              </div>
              <select
                value={daysBack.toString()}
                onChange={(e) => {
                  const newDays = parseInt(e.target.value);
                  console.log('📅 Days changed to:', newDays);
                  setDaysBack(newDays);
                  localStorage.setItem('stormDaysBack', newDays.toString());
                }}
                className="px-3 py-2 border border-purple-200 rounded-lg text-sm bg-white font-medium text-purple-900 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              >
                <option value={1}>Today</option>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days (3 months)</option>
                <option value={180}>180 days (6 months)</option>
                <option value={365}>365 days (1 year)</option>
              </select>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-purple-50 border-purple-200">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="font-medium text-purple-900">Show All Storms (Nationwide)</p>
              <p className="text-sm text-purple-700 mt-1">
                {showAllStorms 
                  ? `Currently showing all ${storms.length} storms nationwide.${officeConfigs.filter(o => o.location).length > 0 ? ` Monitoring ${officeConfigs.filter(o => o.location).length} office location${officeConfigs.filter(o => o.location).length > 1 ? 's' : ''}.` : ''}` 
                  : officeConfigs.filter(o => o.location).length > 0
                    ? `Monitoring ${officeConfigs.filter(o => o.location).length} office location${officeConfigs.filter(o => o.location).length > 1 ? 's' : ''}: ${officeConfigs.filter(o => o.location).map(o => o.name || o.location).join(', ')}.`
                    : 'Configure your service area in settings to filter storms by location.'}
              </p>
              {officeConfigs.filter(o => o.location).length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2" data-testid="office-legend">
                  {officeConfigs.filter(o => o.location).map((office, idx) => {
                    const colors = ['#3b82f6','#14b8a6','#22c55e','#a855f7','#f97316'];
                    const color = colors[idx % colors.length];
                    return (
                      <span
                        key={office.id || idx}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium text-white"
                        style={{ backgroundColor: color }}
                        data-testid={`office-badge-${idx}`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-white/70 inline-block" />
                        {office.name || office.location} · {office.radius_miles || 50}mi
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <Switch
              checked={showAllStorms}
              onCheckedChange={setShowAllStorms}
              className="ml-4"
              data-testid="switch-show-all-storms"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 md:gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-cyan-50 hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-blue-700">
                  {showAllStorms ? 'Active (All)' : 'In Service Area'}
                </p>
                <p className="text-2xl md:text-3xl font-bold text-blue-900">{activeStorms}</p>
              </div>
              <CloudRain className="w-6 h-6 md:w-8 md:h-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-50 to-red-50 hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-orange-700">Severe Events</p>
                <p className="text-2xl md:text-3xl font-bold text-orange-900">{severeStorms}</p>
              </div>
              <AlertTriangle className="w-6 h-6 md:w-8 md:h-8 text-orange-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-pink-50 hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-purple-700">Affected Areas</p>
                <p className="text-2xl md:text-3xl font-bold text-purple-900">{totalAffectedAreas}</p>
              </div>
              <MapPin className="w-6 h-6 md:w-8 md:h-8 text-purple-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-emerald-50 hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate(createPageUrl('Leads'))}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-green-700">Leads Generated</p>
                <p className="text-2xl md:text-3xl font-bold text-green-900">{totalLeadsGenerated}</p>
              </div>
              <Users className="w-6 h-6 md:w-8 md:h-8 text-green-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Property History Lookup ──────────────────────────────────────── */}
      <Card className="bg-gradient-to-br from-sky-50 to-indigo-50 border-sky-200">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sky-900">
              <Search className="w-5 h-5 text-sky-600" />
              Property History Lookup
            </CardTitle>
            <button
              onClick={() => setPropLookupOpen(o => !o)}
              className="text-xs text-sky-700 hover:text-sky-900 font-medium px-2 py-1 rounded border border-sky-200 hover:bg-sky-100 transition-colors"
              data-testid="button-property-lookup-toggle"
            >
              {propLookupOpen ? '▲ Collapse' : '▼ Expand'}
            </button>
          </div>
          <p className="text-sm text-sky-700 mt-1">
            Pull 5-year NOAA storm history for any property address — useful for insurance supplements and new leads.
          </p>
        </CardHeader>
        {propLookupOpen && (
          <CardContent className="pt-0">
            {/* Input row */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1 min-w-0">
                <GoogleAddressAutocomplete
                  initialAddress={propLookupAddress}
                  onAddressChange={(address) => {
                    setPropLookupAddress(address);
                    setPropLookupCoords(null);
                    setPropLookupError(null);
                    setPropLookupResults(null);
                  }}
                  onAddressSelect={handlePropertyAddressSelect}
                  placeholder="123 Main St, Cleveland, OH"
                />
              </div>
              <select
                value={propLookupRadius}
                onChange={e => setPropLookupRadius(Number(e.target.value))}
                className="px-3 py-2 border border-sky-200 rounded-md text-sm bg-white text-sky-900 min-w-[130px]"
                data-testid="select-property-radius"
              >
                <option value={5}>5 mi radius</option>
                <option value={10}>10 mi radius</option>
                <option value={15}>15 mi radius</option>
                <option value={25}>25 mi radius</option>
                <option value={50}>50 mi radius</option>
              </select>
              <select
                value={propLookupDays}
                onChange={e => setPropLookupDays(Number(e.target.value))}
                className="px-3 py-2 border border-sky-200 rounded-md text-sm bg-white text-sky-900 min-w-[130px]"
                data-testid="select-property-days"
              >
                <option value={365}>1 year</option>
                <option value={730}>2 years</option>
                <option value={1825}>5 years</option>
                <option value={3650}>10 years</option>
              </select>
              <Button
                onClick={handlePropertyLookup}
                disabled={propLookupLoading || !propLookupAddress.trim()}
                className="bg-sky-600 hover:bg-sky-700 text-white shrink-0"
                data-testid="button-property-lookup-search"
              >
                {propLookupLoading ? (
                  <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Searching…</>
                ) : (
                  <><Search className="w-4 h-4 mr-1.5" />Search</>
                )}
              </Button>
            </div>

            {/* Error */}
            {propLookupError && (
              <Alert className="mt-3 bg-red-50 border-red-200">
                <XCircle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800 text-sm">{propLookupError}</AlertDescription>
              </Alert>
            )}

            {/* Results */}
            {propLookupResults && (() => {
              const { stats, hailEvents, windEvents, tornadoEvents } = propLookupResults;
              const riskColors = {
                EXTREME: 'bg-red-100 text-red-800 border-red-300',
                HIGH: 'bg-orange-100 text-orange-800 border-orange-300',
                MODERATE: 'bg-yellow-100 text-yellow-800 border-yellow-300',
                LOW: 'bg-green-100 text-green-700 border-green-300',
              };
              const riskIcon = { EXTREME: '🔴', HIGH: '🟠', MODERATE: '🟡', LOW: '🟢' };
              return (
                <div className="mt-4" data-testid="property-lookup-results">
                  {/* Summary bar */}
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${riskColors[stats.riskRating] || riskColors.LOW}`}>
                      {riskIcon[stats.riskRating]} {stats.riskRating} RISK
                    </span>
                    <span className="text-xs text-sky-700 font-medium">
                      📍 {propLookupResolvedAddr} · {stats.radiusMiles}-mile radius · {Math.round(stats.daysBack / 365)}yr history
                    </span>
                    <div className="ml-auto flex gap-2">
                      <button
                        onClick={handleCopyPropertyReport}
                        className="text-xs px-2.5 py-1 rounded border border-sky-300 text-sky-700 hover:bg-sky-100 transition-colors"
                        title="Copy report to clipboard"
                        data-testid="button-copy-property-report"
                      >
                        📋 Copy Report
                      </button>
                      <button
                        onClick={() => window.print()}
                        className="text-xs px-2.5 py-1 rounded border border-sky-300 text-sky-700 hover:bg-sky-100 transition-colors"
                        title="Print report"
                        data-testid="button-print-property-report"
                      >
                        🖨 Print
                      </button>
                    </div>
                  </div>

                  {/* Stat badges */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 mb-4">
                    <div className="bg-white rounded-lg border border-sky-100 p-3 text-center shadow-sm">
                      <p className="text-2xl font-bold text-orange-700">{stats.hailCount}</p>
                      <p className="text-xs text-slate-600 mt-0.5">Hail Events<br/><span className="text-slate-400">(≥1.0")</span></p>
                    </div>
                    <div className="bg-white rounded-lg border border-sky-100 p-3 text-center shadow-sm">
                      <p className="text-2xl font-bold text-blue-700">{stats.windCount}</p>
                      <p className="text-xs text-slate-600 mt-0.5">Wind Events<br/><span className="text-slate-400">(≥55 mph)</span></p>
                    </div>
                    <div className="bg-white rounded-lg border border-sky-100 p-3 text-center shadow-sm">
                      <p className="text-2xl font-bold text-red-700">{stats.tornadoCount}</p>
                      <p className="text-xs text-slate-600 mt-0.5">Tornado<br/>Events</p>
                    </div>
                    <div className="bg-white rounded-lg border border-sky-100 p-3 text-center shadow-sm">
                      <p className="text-2xl font-bold text-orange-600">{stats.maxHailInches > 0 ? `${stats.maxHailInches}"` : '—'}</p>
                      <p className="text-xs text-slate-600 mt-0.5">Largest<br/>Hail</p>
                    </div>
                    <div className="bg-white rounded-lg border border-sky-100 p-3 text-center shadow-sm">
                      <p className="text-2xl font-bold text-blue-600">{stats.maxWindMph > 0 ? `${stats.maxWindMph}` : '—'}</p>
                      <p className="text-xs text-slate-600 mt-0.5">Max Wind<br/><span className="text-slate-400">mph</span></p>
                    </div>
                  </div>

                  {/* No results message */}
                  {stats.hailCount === 0 && stats.windCount === 0 && stats.tornadoCount === 0 && (
                    <div className="text-center py-6 text-slate-500">
                      <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-400" />
                      <p className="font-medium text-sm">No qualifying storm events found near this address</p>
                      <p className="text-xs mt-1 text-slate-400">within {stats.radiusMiles} miles over the past {Math.round(stats.daysBack / 365)} year(s)</p>
                    </div>
                  )}

                  {/* Hail events table */}
                  {hailEvents.length > 0 && (
                    <div className="mb-4">
                      <p className="text-sm font-semibold text-orange-800 mb-1.5">🧊 Hail Events ({hailEvents.length})</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse" data-testid="table-hail-events">
                          <thead>
                            <tr className="bg-orange-50 text-orange-900">
                              <th className="text-left p-2 border-b border-orange-100 font-semibold">Date</th>
                              <th className="text-left p-2 border-b border-orange-100 font-semibold">Size</th>
                              <th className="text-left p-2 border-b border-orange-100 font-semibold">Location</th>
                              <th className="text-right p-2 border-b border-orange-100 font-semibold">Distance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {hailEvents.slice(0, 20).map((e, i) => (
                              <tr key={e.id || i} className="border-b border-slate-100 hover:bg-orange-50/50">
                                <td className="p-2 text-slate-700 whitespace-nowrap">
                                  {e.start_time ? format(new Date(e.start_time), 'MMM d, yyyy') : '—'}
                                </td>
                                <td className="p-2 font-semibold whitespace-nowrap">
                                  <span className={parseFloat(e.hail_size_inches) >= 2.0 ? 'text-red-700' : parseFloat(e.hail_size_inches) >= 1.5 ? 'text-orange-700' : 'text-orange-600'}>
                                    {e.hail_size_inches}"
                                  </span>
                                </td>
                                <td className="p-2 text-slate-600 max-w-[160px] truncate">{e.location || e.affected_areas?.join(', ') || '—'}</td>
                                <td className="p-2 text-slate-500 text-right whitespace-nowrap">{e.distance_miles != null ? `${e.distance_miles} mi` : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {hailEvents.length > 20 && (
                          <p className="text-xs text-slate-400 mt-1 text-right">Showing top 20 of {hailEvents.length} events</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Wind events table */}
                  {windEvents.length > 0 && (
                    <div className="mb-4">
                      <p className="text-sm font-semibold text-blue-800 mb-1.5">💨 Wind Events ({windEvents.length})</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse" data-testid="table-wind-events">
                          <thead>
                            <tr className="bg-blue-50 text-blue-900">
                              <th className="text-left p-2 border-b border-blue-100 font-semibold">Date</th>
                              <th className="text-left p-2 border-b border-blue-100 font-semibold">Speed</th>
                              <th className="text-left p-2 border-b border-blue-100 font-semibold">Location</th>
                              <th className="text-right p-2 border-b border-blue-100 font-semibold">Distance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {windEvents.slice(0, 20).map((e, i) => (
                              <tr key={e.id || i} className="border-b border-slate-100 hover:bg-blue-50/50">
                                <td className="p-2 text-slate-700 whitespace-nowrap">
                                  {e.start_time ? format(new Date(e.start_time), 'MMM d, yyyy') : '—'}
                                </td>
                                <td className="p-2 font-semibold whitespace-nowrap">
                                  <span className={parseFloat(e.wind_speed_mph) >= 80 ? 'text-red-700' : parseFloat(e.wind_speed_mph) >= 65 ? 'text-orange-700' : 'text-blue-700'}>
                                    {e.wind_speed_mph} mph
                                  </span>
                                </td>
                                <td className="p-2 text-slate-600 max-w-[160px] truncate">{e.location || e.affected_areas?.join(', ') || '—'}</td>
                                <td className="p-2 text-slate-500 text-right whitespace-nowrap">{e.distance_miles != null ? `${e.distance_miles} mi` : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {windEvents.length > 20 && (
                          <p className="text-xs text-slate-400 mt-1 text-right">Showing top 20 of {windEvents.length} events</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Tornado events table */}
                  {tornadoEvents.length > 0 && (
                    <div className="mb-1">
                      <p className="text-sm font-semibold text-red-800 mb-1.5">🌪 Tornado Events ({tornadoEvents.length})</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse" data-testid="table-tornado-events">
                          <thead>
                            <tr className="bg-red-50 text-red-900">
                              <th className="text-left p-2 border-b border-red-100 font-semibold">Date</th>
                              <th className="text-left p-2 border-b border-red-100 font-semibold">Location</th>
                              <th className="text-right p-2 border-b border-red-100 font-semibold">Distance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tornadoEvents.slice(0, 20).map((e, i) => (
                              <tr key={e.id || i} className="border-b border-slate-100 hover:bg-red-50/50">
                                <td className="p-2 text-slate-700 whitespace-nowrap">
                                  {e.start_time ? format(new Date(e.start_time), 'MMM d, yyyy') : '—'}
                                </td>
                                <td className="p-2 text-slate-600 max-w-[200px] truncate">{e.location || e.affected_areas?.join(', ') || '—'}</td>
                                <td className="p-2 text-slate-500 text-right whitespace-nowrap">{e.distance_miles != null ? `${e.distance_miles} mi` : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Date range footer */}
                  {(stats.oldestEventDate || stats.newestEventDate) && (
                    <p className="text-xs text-slate-400 mt-3">
                      Events range: {stats.oldestEventDate ? format(new Date(stats.oldestEventDate), 'MMM d, yyyy') : '—'} — {stats.newestEventDate ? format(new Date(stats.newestEventDate), 'MMM d, yyyy') : '—'}
                    </p>
                  )}
                </div>
              );
            })()}
          </CardContent>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 lg:gap-6">
         <Card className="bg-white">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="w-5 h-5" />
              Storm Events ({filteredStorms.length})
            </CardTitle>
            <div className="flex flex-col md:flex-row gap-2 mt-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search storms..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                  data-testid="input-storm-search"
                />
              </div>
              <select
                value={filterState}
                onChange={(e) => setFilterState(e.target.value)}
                className="px-3 py-2 border rounded-md text-sm bg-white min-w-[80px]"
                data-testid="select-storm-state"
              >
                <option value="all">All States</option>
                {US_STATES.map(st => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-3 py-2 border rounded-md text-sm bg-white"
                data-testid="select-storm-type"
              >
                <option value="all">All Types</option>
                <option value="hail">Hail</option>
                <option value="tornado">Tornado</option>
                <option value="thunderstorm">Thunderstorm</option>
                <option value="high_wind">High Wind</option>
                <option value="flood">Flood</option>
                <option value="winter_storm">Winter Storm</option>
                <option value="general_advisory">General Advisory</option>
              </select>
            </div>
          </CardHeader>
          <CardContent className="max-h-[600px] overflow-y-auto space-y-3">
            {isLoadingStorms || isGeocoding ? (
              <div className="text-center py-12 text-gray-500">
                <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-gray-400" />
                <p className="font-medium">{isGeocoding ? 'Locating your service area...' : 'Loading storms...'}</p>
                <p className="text-xs mt-1">Please wait</p>
              </div>
            ) : stormsError ? (
              <Alert className="bg-red-50 border-red-200">
                <XCircle className="h-4 w-4 text-red-600" />
                <AlertDescription>
                  <strong className="text-red-900">Error loading storms</strong>
                  <p className="text-sm text-red-800 mt-1">{stormsError.message}</p>
                  <Button 
                    size="sm" 
                    onClick={() => fetchStormsMutation.mutate()}
                    className="mt-3"
                  >
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            ) : sortedStorms.length > 0 ? (
              <>
              {visibleStorms.map((storm) => {
                  const StormIcon = getStormIcon(storm.event_type);
                  const severityConfig = getSeverityColorClasses(storm.severity);
                  const severe = isSevereStorm(storm);
                  return (
                    <Card
                      key={storm.id}
                      className={`cursor-pointer transition-all hover:shadow-md border-l-4 ${
                        severe
                          ? 'bg-red-50 border-red-400 ring-1 ring-red-200'
                          : `${severityConfig.bg} ${severityConfig.border}`
                      } ${selectedStorm?.id === storm.id ? 'ring-2 ring-blue-500 shadow-lg' : ''}`}
                      onClick={() => {
                        setSelectedStorm(storm);
                        if (storm.latitude && storm.longitude) {
                          flyMapTo([storm.latitude, storm.longitude], 9);
                        } else if (storm.affected_areas && storm.affected_areas.length > 0) {
                          const firstArea = storm.affected_areas[0];
                          const key = `${storm.id}-${firstArea}`;
                          const coords = geocodedAreas[key];
                          if (coords) {
                            flyMapTo([coords.lat, coords.lng], 9);
                          }
                        }
                      }}
                      data-testid={`card-storm-${storm.id}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className={`p-2 rounded-lg flex-shrink-0 ${severe ? 'bg-red-100 text-red-700' : `${severityConfig.bg} ${severityConfig.text}`}`}>
                            <StormIcon className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="font-semibold text-sm line-clamp-2">{storm.title}</h3>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <Badge variant="outline" className={`${severityConfig.bg} ${severityConfig.text} ${severityConfig.border} text-xs`}>
                                  {formatStormSeverityLabel(storm.severity)}
                                </Badge>
                              </div>
                            </div>
                            {storm.secondary_areas?.length > 0 ? (
                              <div className="mt-1 space-y-0.5">
                                <button
                                  className="text-xs text-gray-700 font-medium text-left hover:text-indigo-700 hover:underline transition-colors"
                                  title="Click to get addresses in this city"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setImpactStormId(storm.id);
                                    setAddressSearchMode('city');
                                    fetchStormAddressesByCity(storm);
                                  }}
                                >🔴 {storm.affected_areas?.join(', ')}</button>
                                <div className="flex flex-wrap items-center gap-1 mt-0.5">
                                  <span className="text-xs text-slate-400">🔵</span>
                                  {storm.secondary_areas.map(area => {
                                    const addrKey = `${storm.id}::${area}`;
                                    const isActive = activeSecondaryAddressKey === addrKey;
                                    return (
                                      <button
                                        key={area}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (isActive) { setActiveSecondaryAddressKey(null); return; }
                                          fetchAddressesForSecondaryCity(storm.id, area, null, storm.start_time);
                                        }}
                                        title={`Get addresses in ${area}`}
                                        className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${isActive ? 'bg-indigo-600 text-white border-indigo-700' : 'text-slate-500 border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-300'}`}
                                      >
                                        🏠 {area}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : (
                              <button
                                className="text-xs text-gray-600 mt-1 text-left line-clamp-2 hover:text-indigo-700 hover:underline transition-colors block"
                                title="Click to get addresses in this city"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setImpactStormId(storm.id);
                                  setAddressSearchMode('city');
                                  const cityCacheKey = stormAddressCacheKey(storm.id, 'city');
                                  setAddressTierFilter(prev => ({ ...prev, [cityCacheKey]: 'all' }));
                                  fetchStormAddressesByCity(storm);
                                }}
                              >{storm.affected_areas?.join(', ')}</button>
                            )}
                            <div className="flex flex-wrap gap-2 mt-2">
                              {storm.hail_size_inches && (
                                <span className={`text-xs font-medium px-2 py-1 rounded ${parseFloat(storm.hail_size_inches) > 1.0 ? 'text-red-700 bg-red-100 font-bold' : 'text-orange-600 bg-orange-50'}`}>
                                  🧊 {storm.hail_size_inches}" hail
                                </span>
                              )}
                              {storm.wind_speed_mph && (
                                <span className={`text-xs font-medium px-2 py-1 rounded ${parseFloat(storm.wind_speed_mph) > 60 ? 'text-red-700 bg-red-100 font-bold' : 'text-blue-600 bg-blue-50'}`}>
                                  💨 {storm.wind_speed_mph} mph
                                </span>
                              )}
                              <span className={`text-xs font-medium px-2 py-1 rounded ${
                                storm.status === 'active' ? 'text-green-600 bg-green-50' : 'text-gray-600 bg-gray-50'
                              }`}>
                                {storm.status === 'active' ? '🔴 Active' : '✅ Ended'}
                              </span>
                              {storm.source === 'IEM V2' && (
                                <span className="text-xs font-medium px-2 py-1 rounded bg-teal-50 text-teal-700 border border-teal-200" title="Confirmed by a certified NWS ground spotter who physically observed and measured this event — not a radar estimate. Other storm tracking services rely on radar, which can generate false positives. Our alerts are ground-truth verified.">
                                  ✅ NWS Human Verified
                                </span>
                              )}
                              {(storm.hail_source === 'nws_parsed' || storm.wind_source === 'nws_parsed') && (
                                <span className="text-xs font-medium px-2 py-1 rounded bg-sky-50 text-sky-700" title="Hail/wind data parsed from official NWS warning text">
                                  📻 NWS Parsed
                                </span>
                              )}
                            </div>
                            {storm.leads_generated > 0 && (
                              <p className="text-xs font-medium text-green-600 mt-2 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                {storm.leads_generated} leads generated
                              </p>
                            )}
                            {storm.start_time && (
                              <p className="text-xs text-gray-500 mt-2">
                                📅 {format(new Date(storm.start_time), 'MMM d, yyyy h:mm a')}
                              </p>
                            )}
                            <div className="flex gap-2 mt-4">
                              {HIDDEN_FEATURES.STORM_GET_REAL_LEADS && canGenerateLeads && (
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const allAreas = [
                                    ...(storm.affected_areas || []),
                                    ...(storm.secondary_areas || [])
                                  ].join(', ');
                                  navigate(createPageUrl('PropertyDataImporter') + `?storm=${encodeURIComponent(storm.title)}&areas=${encodeURIComponent(allAreas)}`);
                                }}
                                className="bg-green-600 hover:bg-green-700"
                                data-testid={`button-get-leads-${storm.id}`}
                              >
                                <Users className="w-3 h-3 mr-1" />
                                Import County Data
                              </Button>
                              )}
                              {HIDDEN_FEATURES.STORM_GET_REAL_LEADS && canGenerateLeads && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const firstArea = (storm.affected_areas || [])[0] || (storm.secondary_areas || [])[0] || '';
                                  navigate(createPageUrl('LeadFinder') + `?location=${encodeURIComponent(firstArea)}`);
                                }}
                                className="border-blue-300 text-blue-700 hover:bg-blue-50"
                                data-testid={`button-search-leads-${storm.id}`}
                              >
                                🔍 Search Lead Finder
                              </Button>
                              )}
                              <button
                                title="Show NWS warning polygon on map + add/edit secondary hail areas"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (editingStormId === storm.id) {
                                    // Close editor + hide polygon
                                    setEditingStormId(null);
                                    setActiveSwathStormId(null);
                                  } else {
                                    // Open editor + fetch SBW polygon
                                    setEditingStormId(storm.id);
                                    setEditSecondaryInput(storm.secondary_areas?.join(', ') || '');
                                    setActiveSwathStormId(storm.id);
                                    if (!swathPolygons[storm.id]) {
                                      const sLat = parseFloat(storm.latitude || storm.lat);
                                      const sLng = parseFloat(storm.longitude || storm.lng);
                                      // Only query IEM for recent storms — SBW archive only holds active warnings
                                      const stormAgeHrs = storm.start_time
                                        ? (Date.now() - new Date(storm.start_time).getTime()) / 36e5
                                        : Infinity;
                                      if (sLat && sLng && storm.start_time && stormAgeHrs <= 12) {
                                        setSwathPolygons(prev => ({ ...prev, [storm.id]: { loading: true, feature: null, error: null } }));
                                        base44.functions.invoke('fetchStormSBWPolygon', {
                                          stormId: storm.id, lat: sLat, lng: sLng,
                                          startTime: storm.start_time, eventType: storm.event_type,
                                        }).then(result => {
                                          const feature = result?.data?.feature ?? result?.feature ?? null;
                                          setSwathPolygons(prev => ({
                                            ...prev,
                                            [storm.id]: { loading: false, feature, error: feature ? null : 'No active NWS warning polygon for this storm' },
                                          }));
                                        }).catch(err => {
                                          setSwathPolygons(prev => ({
                                            ...prev,
                                            [storm.id]: { loading: false, feature: null, error: err.message },
                                          }));
                                        });
                                      }
                                      // else: older storm — skip IEM fetch, editor opens instantly
                                    }
                                  }
                                }}
                                className={`p-2 rounded border text-xs flex items-center gap-1 ${
                                  editingStormId === storm.id
                                    ? swathPolygons[storm.id]?.feature
                                      ? 'bg-blue-100 border-blue-400 text-blue-700'
                                      : 'bg-slate-100 border-slate-400 text-slate-700'
                                    : 'border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                                }`}
                                data-testid={`button-edit-secondary-${storm.id}`}
                              >
                                {swathPolygons[storm.id]?.loading
                                  ? <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70"/></svg>
                                  : '🔵'
                                }
                                +Swath
                              </button>
                              <button
                                title="Find street addresses within this storm zone (free, from OpenStreetMap)"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (impactStormId === storm.id) {
                                    setImpactStormId(null);
                                  } else {
                                    setImpactStormId(storm.id);
                                    setAddressSearchMode('radius');
                                    const cacheKey = stormAddressCacheKey(storm.id, 'radius', addressSearchRadius);
                                    if (!stormAddressCache[cacheKey]) {
                                      fetchStormAddresses(storm, addressSearchRadius);
                                    }
                                  }
                                }}
                                className={`p-2 rounded border text-xs ${impactStormId === storm.id ? 'bg-indigo-100 border-indigo-400 text-indigo-700' : 'border-slate-200 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'}`}
                                data-testid={`button-addresses-${storm.id}`}
                              >
                                🏠 Addresses
                              </button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(createPageUrl('StormReport') + `?id=${storm.id}`);
                                }}
                                className="border-blue-300 text-blue-700 hover:bg-blue-50"
                                data-testid={`button-report-${storm.id}`}
                              >
                                <ChevronRight className="w-4 h-4 mr-1" />
                                Report
                              </Button>
                            </div>
                            {/* Inline secondary swath editor */}
                            {editingStormId === storm.id && (
                              <div className="mt-3 pt-3 border-t border-dashed border-slate-200" onClick={e => e.stopPropagation()}>
                                {/* Header row */}
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-xs font-semibold text-slate-700">Secondary canvassing areas</p>
                                  {(storm.latitude || storm.lat) && (
                                    <button
                                      onClick={() => suggestNearbyAreas(storm)}
                                      disabled={suggestingForStorm === storm.id}
                                      className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-green-300 bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-60 disabled:cursor-not-allowed"
                                      data-testid={`button-suggest-secondary-${storm.id}`}
                                    >
                                      {suggestingForStorm === storm.id ? (
                                        <>
                                          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70"/></svg>
                                          Scanning nearby areas…
                                        </>
                                      ) : (
                                        <>🎯 Auto-suggest low-competition areas</>
                                      )}
                                    </button>
                                  )}
                                </div>

                                {/* Auto-suggested chips */}
                                {secondarySuggestions[storm.id]?.length > 0 && (
                                  <div className="mb-3 p-2 bg-slate-50 border border-slate-200 rounded">
                                    {/* Header */}
                                    <p className="text-xs font-medium text-slate-700 mb-0.5">
                                      🎯 Low-competition zones — 4–10 mi from the storm center
                                    </p>
                                    <p className="text-xs text-slate-500 mb-2">
                                      Other storm tracking services saturate the direct hit. Green = IEM confirmed hail with size. Gray = no hail reports found — skip unless you have other intel.
                                    </p>
                                    {/* Summary counts */}
                                    {(() => {
                                      const confirmed = secondarySuggestions[storm.id].filter(s => s.confirmed).length;
                                      const unconfirmed = secondarySuggestions[storm.id].length - confirmed;
                                      return (
                                        <p className="text-xs mb-2">
                                          <span className="text-green-700 font-medium">✓ {confirmed} confirmed</span>
                                          {unconfirmed > 0 && <span className="text-slate-400 ml-2">· {unconfirmed} unconfirmed (hidden by default)</span>}
                                        </p>
                                      );
                                    })()}
                                    <div className="flex flex-wrap gap-1.5">
                                      {secondarySuggestions[storm.id].map(item => {
                                        const cityName = typeof item === 'string' ? item : item.name;
                                        const hailSize = typeof item === 'string' ? null : item.hailSize;
                                        const confirmed = typeof item === 'string' ? true : item.confirmed;
                                        const confidence = typeof item === 'string' ? 'unknown' : (item.confidence || 'unknown');
                                        const meshInches = typeof item === 'string' ? null : item.meshInches;
                                         const radarSource = typeof item === 'string' ? null : item.radarSource;
                                        const confMeta = CONFIDENCE_META[confidence] || CONFIDENCE_META.unknown;
                                        const sel = selectedSuggestions[storm.id]?.has(cityName);
                                        const addrKey = `${storm.id}::${cityName}`;
                                        const isActiveAddr = activeSecondaryAddressKey === addrKey;
                                        const chipTitle = confidence !== 'unknown'
                                          ? `${confMeta.short}${meshInches != null && meshInches > 0 ? ` — ${radarSource === 'archived' ? 'archived' : 'live'} radar shows up to ${meshInches}" hail here` : ` — no hail core in ${radarSource === 'archived' ? 'the archived snapshot' : 'live radar'}`}${confirmed && hailSize ? `; spotter report ${hailSize}"` : ''}`
                                          : (confirmed
                                            ? (hailSize ? `IEM reports ${hailSize}" hail nearby` : 'IEM confirmed hail nearby')
                                            : 'No IEM hail reports within 5 mi — verify before sending crew');
                                        return (
                                          <div key={cityName} className="flex items-center gap-0">
                                            <button
                                              onClick={() => {
                                                setSelectedSuggestions(prev => {
                                                  const next = new Set(prev[storm.id] || []);
                                                  if (next.has(cityName)) next.delete(cityName); else next.add(cityName);
                                                  return { ...prev, [storm.id]: next };
                                                });
                                              }}
                                              title={chipTitle}
                                              className={`text-xs px-2 py-0.5 border transition-colors ${(confirmed || confidence === 'high_opportunity') ? 'rounded-l-full' : 'rounded-full'} ${
                                                sel && confirmed ? 'bg-green-600 text-white border-green-700'
                                                : sel && confidence === 'high_opportunity' ? 'bg-orange-500 text-white border-orange-600'
                                                : sel && !confirmed ? 'bg-slate-500 text-white border-slate-600'
                                                : confirmed ? 'bg-green-50 text-green-700 border-green-300 hover:bg-green-100'
                                                : confidence === 'high_opportunity' ? 'bg-orange-50 text-orange-700 border-orange-300 hover:bg-orange-100'
                                                : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'
                                              }`}
                                              data-testid={`chip-suggestion-${storm.id}-${cityName}`}
                                            >
                                              {confMeta.icon && <span className="mr-0.5">{confMeta.icon}</span>}
                                              {sel ? '✓ ' : '+ '}{cityName}
                                              {hailSize && <span className="ml-1 opacity-80">🧊{hailSize}"</span>}
                                              {meshInches != null && meshInches >= 0.5 && !hailSize && <span className="ml-1 opacity-80">📡{meshInches}"</span>}
                                               {radarSource === 'archived' && <span className="ml-1 opacity-70">Archived</span>}
                                              {!confirmed && confidence === 'unknown' && <span className="ml-1 opacity-60">❓</span>}
                                            </button>
                                            {(confirmed || confidence === 'high_opportunity') && (
                                              <button
                                                onClick={() => {
                                                  if (isActiveAddr) { setActiveSecondaryAddressKey(null); return; }
                                                  fetchAddressesForSecondaryCity(storm.id, cityName, null, storm.start_time);
                                                }}
                                                title={`Get addresses in ${cityName}`}
                                                className={`text-xs px-1.5 py-0.5 rounded-r-full border-t border-r border-b transition-colors ${
                                                  isActiveAddr ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white border-green-300 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-300'
                                                }`}
                                              >🏠</button>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>

                                    {/* Secondary area address panel — shown when a 🏠 chip is active */}
                                    {activeSecondaryAddressKey?.startsWith(`${storm.id}::`) && (() => {
                                      const cityName = activeSecondaryAddressKey.replace(`${storm.id}::`, '');
                                      const cache = secondaryAreaAddressCache[activeSecondaryAddressKey];
                                      return (
                                        <div className="mt-2 pt-2 border-t border-dashed border-indigo-200">
                                          <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                                            <p className="text-xs font-semibold text-indigo-700">🏠 Addresses — {cityName}</p>
                                            <div className="flex items-center gap-1 flex-wrap">
                                              <button onClick={() => fetchAddressesForSecondaryCity(storm.id, cityName, null, storm.start_time)} className={`text-xs px-1.5 py-0.5 rounded border ${!cache?.radiusMiles ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-500 hover:bg-indigo-50'}`}>📍 City</button>
                                              {[1,2,3,5].map(r => (
                                                <button key={r} onClick={() => fetchAddressesForSecondaryCity(storm.id, cityName, r, storm.start_time)} className={`text-xs px-1.5 py-0.5 rounded border ${cache?.radiusMiles === r ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-500 hover:bg-indigo-50'}`}>{r}mi</button>
                                              ))}
                                              {cache && !cache.loading && cache.addresses?.length > 0 && (
                                                <>
                                                  <button onClick={() => { const ra = cache.addresses.map((a,i) => ({...a,id:`sec-${i}`,lng:a.lon,name:a.street,status:'new'})); sessionStorage.setItem('stormRouteAddresses',JSON.stringify({title:cityName,mode:cache.mode||'city',addresses:ra})); navigate(createPageUrl('InspectionRouting')); }} className="text-xs px-1.5 py-0.5 rounded border border-blue-300 text-blue-600 hover:bg-blue-50" title="Open route planner now">🗺️ Route Now →</button>
                                                  <button onClick={() => { const rows=cache.addresses.map(a=>`"${a.street}","${a.city}","${a.state}","${a.zip}"`).join('\n'); const blob=new Blob(['Street,City,State,ZIP\n'+rows],{type:'text/csv'}); const u=URL.createObjectURL(blob); const el=document.createElement('a'); el.href=u; el.download=`${cityName.replace(/[^a-z0-9]/gi,'-')}-addresses.csv`; el.click(); URL.revokeObjectURL(u); }} className="text-xs px-1.5 py-0.5 rounded border border-indigo-300 text-indigo-600 hover:bg-indigo-50">⬇ CSV</button>
                                                  {(() => {
                                                    const secKey = `${storm.id}::${cityName}`;
                                                    const sv = stormSaveState[secKey];
                                                    if (sv?.done) return (
                                                      <span className="text-xs px-1.5 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-700">✓ Saved ↓</span>
                                                    );
                                                    return (
                                                      <button
                                                        onClick={() => saveStormCanvassList(secKey, cache.addresses, cityName, storm.id, cache.radiusMiles, cache.mode)}
                                                        disabled={sv?.loading}
                                                        className="text-xs px-1.5 py-0.5 rounded border border-emerald-400 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                                                        title="Save for later — reopen from Saved Lists below"
                                                      >
                                                        {sv?.loading ? '⏳…' : '💾 Save for Later'}
                                                      </button>
                                                    );
                                                  })()}
                                                </>
                                              )}
                                            </div>
                                          </div>
                                          {(!cache || cache.loading) && <p className="text-xs text-slate-400 flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin inline mr-1"/>Querying OpenStreetMap…</p>}
                                          {cache && !cache.loading && cache.error && (
                                            <div role="alert" className="text-xs text-red-600 flex items-center gap-2 flex-wrap">
                                              <span>{cache.error}</span>
                                              <button
                                                className="underline font-medium"
                                                onClick={() => fetchAddressesForSecondaryCity(storm.id, cityName, cache.radiusMiles || null, storm.start_time)}
                                              >
                                                Retry address lookup
                                              </button>
                                            </div>
                                          )}
                                          {cache && !cache.loading && !cache.error && cache.coverageWarning && (
                                            <p role="note" className="text-xs text-amber-700 mb-1">{cache.coverageWarning}</p>
                                          )}
                                          {cache && !cache.loading && !cache.error && cache.addresses?.length === 0 && <p className="text-xs text-slate-400">No mapped addresses found. OSM coverage may be limited here — try a radius instead of City.</p>}
                                          {cache && !cache.loading && cache.addresses?.length > 0 && (
                                            <div className="max-h-36 overflow-y-auto rounded border border-slate-100 bg-slate-50 p-1.5">
                                              <p className="text-xs text-slate-500 mb-1">{cache.addresses.length} address{cache.addresses.length !== 1 ? 'es' : ''}{cache.addresses.length === 300 ? ' (first 300)' : ''}</p>
                                              {cache.addresses.map((addr, i) => {
                                                const mr = cache.meshResults?.[i];
                                                const cm = mr && mr.confidence !== 'unknown' ? CONFIDENCE_META[mr.confidence] : null;
                                                return (
                                                  <p key={i} className="text-xs text-slate-700 leading-snug">
                                                    {cm && <span title={`${cm.short}${mr.meshInches != null && mr.meshInches > 0 ? ` — ${cache.radarSource === 'archived' ? 'archived' : 'live'} radar up to ${mr.meshInches}" hail` : ''}`} className="mr-1">{cm.icon}{cache.radarSource === 'archived' ? ' Archived' : ''}</span>}
                                                    {addr.street}{addr.city ? `, ${addr.city}` : ''} {addr.state} {addr.zip}
                                                  </p>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })()}

                                    <button
                                      className="mt-2 text-xs text-green-700 hover:underline"
                                      onClick={() => {
                                        const picked = [...(selectedSuggestions[storm.id] || [])];
                                        const current = editSecondaryInput.split(',').map(s => s.trim()).filter(Boolean);
                                        const merged = [...new Set([...current, ...picked])];
                                        setEditSecondaryInput(merged.join(', '));
                                        setSecondarySuggestions(prev => ({ ...prev, [storm.id]: [] }));
                                      }}
                                    >
                                      Add selected to my list →
                                    </button>
                                  </div>
                                )}

                                {/* Manual text input + save */}
                                <div className="flex gap-2">
                                  <input
                                    className="flex-1 text-xs border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                    placeholder="e.g. Garfield Hts, Maple Heights, Seven Hills"
                                    value={editSecondaryInput}
                                    onChange={e => setEditSecondaryInput(e.target.value)}
                                    autoFocus
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        const areas = editSecondaryInput.split(',').map(s => s.trim()).filter(Boolean);
                                        updateSecondaryAreasMutation.mutate({ stormId: storm.id, secondaryAreas: areas });
                                      }
                                      if (e.key === 'Escape') setEditingStormId(null);
                                    }}
                                  />
                                  <button
                                    disabled={updateSecondaryAreasMutation.isPending}
                                    onClick={() => {
                                      const areas = editSecondaryInput.split(',').map(s => s.trim()).filter(Boolean);
                                      updateSecondaryAreasMutation.mutate({ stormId: storm.id, secondaryAreas: areas });
                                    }}
                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded disabled:opacity-50"
                                  >
                                    {updateSecondaryAreasMutation.isPending ? '…' : 'Save'}
                                  </button>
                                </div>
                                <p className="text-xs text-slate-400 mt-1">These show as dashed circles on the map. Press Enter to save.</p>
                              </div>
                            )}
                            {/* Storm Address Impact Panel */}
                            {impactStormId === storm.id && (() => {
                              const cacheKey = stormAddressCacheKey(storm.id, addressSearchMode, addressSearchRadius);
                              const cache = stormAddressCache[cacheKey];
                              return (
                                <div className="mt-3 pt-3 border-t border-dashed border-indigo-200" onClick={e => e.stopPropagation()}>
                                  {/* Header row */}
                                  <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <p className="text-xs font-semibold text-indigo-700">🏠 Addresses in Storm Zone</p>
                                      <div className="flex items-center gap-1 text-xs text-slate-500 flex-wrap">
                                        <span>Area:</span>
                                        <button
                                          onClick={() => {
                                            setAddressSearchMode('city');
                                            setAddressTierFilter(prev => ({ ...prev, [cacheKey]: 'all' }));
                                            fetchStormAddressesByCity(storm);
                                          }}
                                          className={`px-1.5 py-0.5 rounded border text-xs transition-colors ${addressSearchMode === 'city' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'}`}
                                          title="Get all addresses within the city/municipality boundary where this storm hit"
                                        >
                                          📍 City
                                        </button>
                                        <span className="text-slate-300">|</span>
                                        {[1, 2, 3, 5, 10].map(r => (
                                          <button
                                            key={r}
                                            onClick={() => {
                                              setAddressSearchRadius(r);
                                              setAddressSearchMode('radius');
                                              setAddressTierFilter(prev => ({ ...prev, [stormAddressCacheKey(storm.id, 'radius', r)]: 'all' }));
                                              fetchStormAddresses(storm, r);
                                            }}
                                            className={`px-1.5 py-0.5 rounded border text-xs transition-colors ${addressSearchMode === 'radius' && addressSearchRadius === r ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'}`}
                                          >
                                            {r}mi
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    {/* How this works — collapsible hint */}
                                      <details className="mb-2 text-xs text-slate-500">
                                      <summary className="cursor-pointer select-none hover:text-slate-700 flex items-center gap-1">
                                        <Info className="w-3 h-3" /> How this works
                                      </summary>
                                      <div className="mt-1.5 ml-4 space-y-1 text-slate-500 leading-snug">
                                        <p>① <strong>Tier by Value</strong> — sorts addresses by estimated home value (T1 = premium). Optional.</p>
                                        <p>② <strong>Route Now →</strong> — opens the Route Planner immediately so you can pick stops and start driving today.</p>
                                          <p>③ <strong>AI Build Canvassing Plan</strong> — ranks a selected number of doors and splits them across reps. It is a potential-impact plan, never a damage confirmation.</p>
                                          <p>④ <strong>Save for Later</strong> — saves this address list so you can come back and route it another day without re-fetching. See the Saved Lists panel below.</p>
                                      </div>
                                    </details>
                                    <div className="flex items-center gap-1.5">
                                      {cache && !cache.loading && cache.addresses.length > 0 && (() => {
                                        const td = addressTierData[cacheKey];
                                        const hasTiers = td && !td.loading && Object.keys(td.tierAssignments || {}).length > 0;
                                        return (
                                          <button
                                          onClick={() => {
                                              if (!td || (!td.loading && (!hasTiers || td.error))) {
                                                fetchAddressTiers(cacheKey, cache.addresses);
                                              }
                                            }}
                                            disabled={td?.loading}
                                            className={`text-xs px-2 py-1 rounded border flex items-center gap-1 ${hasTiers ? 'bg-amber-100 border-amber-300 text-amber-700' : 'border-slate-300 text-slate-500 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700'} disabled:opacity-50`}
                                            title="Sort & tag addresses by neighborhood home value (free, from US Census)"
                                          >
                                            {td?.loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : '🎯'}
                                            {td?.loading ? 'Loading…' : td?.error ? 'Retry Value Lookup' : hasTiers ? 'Tiered ✓' : 'Tier by Value'}
                                          </button>
                                        );
                                      })()}
                                      {cache && !cache.loading && cache.addresses.length > 0 && (
                                        <>
                                           <button
                                             onClick={() => setCanvassPlannerContext({ storm, cacheKey, addresses: cache.addresses, tierAssignments: addressTierData[cacheKey]?.tierAssignments || {}, meshResults: cache.meshResults || [] })}
                                             className="text-xs px-2 py-1 rounded border border-violet-300 text-violet-700 hover:bg-violet-50 flex flex-col items-center leading-tight"
                                             title="Build a rep-ready plan from this potential impact area"
                                             data-testid={`build-canvass-plan-${storm.id}`}
                                           >
                                             <span>✨ AI Build Plan</span>
                                             <span className="text-[10px] text-violet-500 font-normal">prioritize & split</span>
                                           </button>
                                          <button
                                            onClick={() => {
                                              const routeAddresses = cache.addresses.map((a, i) => ({
                                                ...a,
                                                id: `storm-addr-${storm.id}-${i}`,
                                                lng: a.lon,
                                                name: a.street,
                                                status: 'new',
                                              }));
                                              sessionStorage.setItem('stormRouteAddresses', JSON.stringify({
                                                title: storm.title,
                                                mode: cache.mode || 'radius',
                                                addresses: routeAddresses,
                                              }));
                                              navigate(createPageUrl('InspectionRouting'));
                                            }}
                                            className="text-xs px-2 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 flex flex-col items-center leading-tight"
                                            title="Open these addresses in the Route Planner right now to optimize and start knocking"
                                          >
                                            <span>🗺️ Route Now →</span>
                                            <span className="text-[10px] text-blue-400 font-normal">open planner</span>
                                          </button>
                                          <button
                                            onClick={() => downloadAddressCSV(storm, cache.addresses, addressTierData[cacheKey]?.tierAssignments)}
                                            className="text-xs px-2 py-1 rounded border border-indigo-300 text-indigo-600 hover:bg-indigo-50"
                                          >
                                            ⬇ CSV
                                          </button>
                                          {(() => {
                                            const sv = stormSaveState[storm.id];
                                            if (sv?.done) return (
                                              <span className="text-xs px-2 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 flex flex-col items-center leading-tight">
                                                <span>✓ Saved {sv.count}</span>
                                                <span className="text-[10px] text-emerald-500">↓ see below</span>
                                              </span>
                                            );
                                            return (
                                              <button
                                                onClick={() => saveStormCanvassList(storm.id, cache.addresses, storm.title, storm.id, cache.radiusMiles, cache.mode)}
                                                disabled={sv?.loading}
                                                className="text-xs px-2 py-1 rounded border border-emerald-400 text-emerald-700 hover:bg-emerald-50 flex flex-col items-center leading-tight disabled:opacity-50"
                                                title="Save this list to reopen and route another day — no need to re-fetch addresses"
                                              >
                                                <span>{sv?.loading ? '⏳ Saving…' : '💾 Save for Later'}</span>
                                                {!sv?.loading && <span className="text-[10px] text-emerald-500 font-normal">reopen anytime</span>}
                                              </button>
                                            );
                                          })()}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                   {canvassPlannerContext?.storm?.id === storm.id && canvassPlannerContext.cacheKey === cacheKey && (
                                     <StormCanvassPlanner
                                       storm={storm}
                                       addresses={canvassPlannerContext.addresses}
                                       tierAssignments={canvassPlannerContext.tierAssignments}
                                       meshResults={canvassPlannerContext.meshResults}
                                       companyId={myCompany?.id}
                                       onClose={() => setCanvassPlannerContext(null)}
                                     />
                                   )}

                                  {/* Loading addresses */}
                                  {(!cache || cache.loading) && (
                                    <div className="flex items-center gap-2 py-3 text-xs text-slate-500">
                                      <RefreshCw className="w-3 h-3 animate-spin" />
                                      Querying OpenStreetMap for addresses…
                                    </div>
                                  )}

                                  {/* Error */}
                                  {cache && !cache.loading && cache.error && (
                                    <div role="alert" className="text-xs text-red-600 py-2 flex items-center gap-2 flex-wrap">
                                      <span>{cache.error}</span>
                                      <button
                                        className="underline font-medium"
                                        onClick={() => cache.mode === 'city'
                                          ? fetchStormAddressesByCity(storm)
                                          : fetchStormAddresses(storm, cache.radiusMiles || addressSearchRadius)}
                                      >
                                        Retry address lookup
                                      </button>
                                    </div>
                                  )}

                                  {cache && !cache.loading && !cache.error && cache.coverageWarning && (
                                    <p role="note" className="text-xs text-amber-700 py-1">{cache.coverageWarning}</p>
                                  )}

                                  {/* Empty */}
                                  {cache && !cache.loading && !cache.error && cache.addresses.length === 0 && (
                                    <p className="text-xs text-slate-500 py-2">No mapped addresses found in the selected {cache.mode === 'city' ? 'city boundary' : `${cache.radiusMiles} mile radius`}. Try another area selection.</p>
                                  )}

                                  {addressTierData[cacheKey]?.error && (
                                    <p role="status" className="text-xs text-amber-700 py-1">
                                      Home-value data could not be loaded, so no value tiers were applied. You can retry the lookup.
                                    </p>
                                  )}

                                  {/* Address list with tiers */}
                                  {cache && !cache.loading && cache.addresses.length > 0 && (() => {
                                    const td = addressTierData[cacheKey];
                                    const tierAssignments = td?.tierAssignments || {};
                                    const hasTiers = Object.keys(tierAssignments).length > 0;
                                    const activeTierFilter = addressTierFilter[cacheKey] || 'all';

                                    // Sort by tier (T1 first) when tiers are loaded
                                    const sorted = hasTiers
                                      ? [...cache.addresses].sort((a, b) => {
                                          const ta = getAddrTier(a, tierAssignments)?.n ?? 99;
                                          const tb = getAddrTier(b, tierAssignments)?.n ?? 99;
                                          return ta - tb;
                                        })
                                      : cache.addresses;

                                    // Count per tier for filter tabs
                                    const tierCounts = hasTiers ? { 1: 0, 2: 0, 3: 0, null: 0 } : null;
                                    if (hasTiers) sorted.forEach(a => {
                                      const t = getAddrTier(a, tierAssignments)?.n ?? null;
                                      if (t) tierCounts[t]++; else tierCounts.null++;
                                    });

                                    const visible = activeTierFilter === 'all'
                                      ? sorted
                                      : sorted.filter(a => (getAddrTier(a, tierAssignments)?.n ?? null) === parseInt(activeTierFilter));

                                    return (
                                      <>
                                        {/* Tier legend */}
                                        {hasTiers && (
                                          <div className="mb-2 flex flex-wrap gap-1 items-center">
                                            <span className="text-xs text-slate-400 mr-1">Legend:</span>
                                            {[
                                              { n: '1', label: 'T1', desc: 'Top 20%', bg: 'bg-amber-100 text-amber-700 border-amber-300' },
                                              { n: '2', label: 'T2', desc: 'Middle 50%', bg: 'bg-blue-100 text-blue-700 border-blue-200' },
                                              { n: '3', label: 'T3', desc: 'Remaining', bg: 'bg-slate-100 text-slate-600 border-slate-200' },
                                            ].map(t => (
                                              <span key={t.n} className={`text-xs px-1.5 py-0.5 rounded border ${t.bg}`}>{t.label} {t.desc}</span>
                                            ))}
                                          </div>
                                        )}

                                        {/* Tier filter tabs */}
                                        {hasTiers && (
                                          <div className="flex gap-1 mb-2 flex-wrap">
                                            {[['all', `All (${sorted.length})`], ['1', `🥇 T1 (${tierCounts[1]})`], ['2', `🥈 T2 (${tierCounts[2]})`], ['3', `🥉 T3 (${tierCounts[3]})`]].map(([val, lbl]) => (
                                              <button
                                                key={val}
                                                onClick={() => setAddressTierFilter(prev => ({ ...prev, [cacheKey]: val }))}
                                                className={`text-xs px-2 py-0.5 rounded border transition-colors ${activeTierFilter === val ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                                              >
                                                {lbl}
                                              </button>
                                            ))}
                                          </div>
                                        )}

                                        <p className="text-xs text-slate-500 mb-1.5">
                                          {visible.length} address{visible.length !== 1 ? 'es' : ''}{activeTierFilter !== 'all' ? ` in this tier` : cache.mode === 'city' ? ` in the ${cache.scope || 'selected city'}` : ` within ${cache.radiusMiles} mi`}{cache.addresses.length === 300 && activeTierFilter === 'all' ? ' (first 300)' : ''}
                                          {hasTiers && <span className="ml-1 text-slate-400">· sorted highest value first</span>}
                                        </p>

                                        <div className="max-h-52 overflow-y-auto space-y-0.5 rounded border border-slate-100 bg-slate-50 p-2">
                                          {visible.map((addr, i) => {
                                            const tier = hasTiers ? getAddrTier(addr, tierAssignments) : null;
                                            const meshIdx = cache.addresses.indexOf(addr);
                                            const mr = meshIdx >= 0 ? cache.meshResults?.[meshIdx] : null;
                                            const meshCm = mr && mr.confidence !== 'unknown' ? CONFIDENCE_META[mr.confidence] : null;
                                            const enriched = ownerEnrichState[storm.id];
                                            const ownerRecord = enriched?.status === 'done'
                                              ? enriched.enriched.find(e =>
                                                  (e.street || '').toLowerCase().trim() === (addr.street || '').toLowerCase().trim()
                                                )
                                              : null;
                                            return (
                                              <div key={i} className="flex items-start gap-1.5 min-w-0">
                                                {tier && (
                                                  <span className={`flex-shrink-0 text-xs px-1 py-0.5 rounded border font-medium mt-0.5 ${tier.bg}`} title={tier.value != null ? `Median home value: $${tier.value.toLocaleString()}` : `Ranked by ${tier.source || 'address order'}`}>
                                                    {tier.label}
                                                  </span>
                                                )}
                                                <div className="min-w-0 flex-1">
                                                  <p className="text-xs text-slate-700 truncate">
                                                    {meshCm && <span title={`${meshCm.short}${mr.meshInches != null && mr.meshInches > 0 ? ` — ${cache.radarSource === 'archived' ? 'archived' : 'live'} radar up to ${mr.meshInches}" hail` : ''}`} className="mr-1">{meshCm.icon}{cache.radarSource === 'archived' ? ' Archived' : ''}</span>}
                                                    {addr.street}{addr.city ? `, ${addr.city}` : ''}{addr.state ? ` ${addr.state}` : ''}{addr.zip ? ` ${addr.zip}` : ''}
                                                  </p>
                                                  <div className="flex items-center gap-1 flex-wrap">
                                                    {ownerRecord?.ownerName && (
                                                      <span className="text-xs text-violet-700 font-medium truncate">{ownerRecord.ownerName}</span>
                                                    )}
                                                    {ownerRecord?.already_in_crm && (
                                                      <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-300 font-medium leading-none whitespace-nowrap">In CRM ✓</span>
                                                    )}
                                                  </div>
                                                  {ownerRecord?.phone && (
                                                    <a
                                                      href={`tel:${ownerRecord.phone.replace(/\D/g, '')}`}
                                                      className="text-xs text-slate-500 hover:text-blue-600 truncate block"
                                                      onClick={e => e.stopPropagation()}
                                                    >
                                                      {ownerRecord.phone}
                                                    </a>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          })}
                                          {visible.length === 0 && <p className="text-xs text-slate-400 py-1">No addresses in this tier.</p>}
                                        </div>
                                      </>
                                    );
                                  })()}

                                  {/* Property Owner Data — BatchLeads enrichment */}
                                  {(() => {
                                    const es = ownerEnrichState[storm.id];
                                    const status = es?.status || 'idle';
                                    const ps = prospectSaveState[storm.id];
                                    const addrCount = cache?.addresses?.length || 0;

                                    if (status === 'idle') return (
                                      <div className="mt-3 rounded-lg border border-dashed border-violet-300 bg-violet-50 p-3">
                                        <div className="flex items-start gap-2">
                                          <span className="text-lg leading-none">🔓</span>
                                          <div className="flex-1 min-w-0">
                                            <p className="text-xs font-semibold text-violet-800 mb-0.5">Property Owner + Contact Data</p>
                                            <p className="text-xs text-violet-700 leading-snug mb-2">
                                              Get owner names and phone numbers for properties in this zone via BatchLeads — then save as a Prospect List for Lead Finder.
                                            </p>
                                            <button
                                              onClick={() => enrichStormOwners(storm.id, cache?.addresses || [], storm.title)}
                                              disabled={!addrCount}
                                              className="text-xs px-3 py-1.5 rounded border border-violet-400 bg-white text-violet-700 hover:bg-violet-100 font-medium disabled:opacity-50"
                                            >
                                              🔓 Unlock Owner Data ({addrCount})
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    );

                                    if (status === 'no_key') return (
                                      <div className="mt-3 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3">
                                        <div className="flex items-start gap-2">
                                          <span className="text-lg leading-none">🔑</span>
                                          <div className="flex-1 min-w-0">
                                            <p className="text-xs font-semibold text-amber-800 mb-0.5">BatchLeads API Key Required</p>
                                            <p className="text-xs text-amber-700 leading-snug mb-2">
                                              Add your BatchLeads API key in Settings → API Keys to unlock owner names and contact data for this storm zone.
                                            </p>
                                            <button
                                              onClick={() => navigate(createPageUrl('Settings'))}
                                              className="text-xs px-3 py-1.5 rounded border border-amber-400 bg-white text-amber-700 hover:bg-amber-100 font-medium"
                                            >
                                              Go to API Keys →
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    );

                                    if (status === 'loading') return (
                                      <div className="mt-3 rounded-lg border border-dashed border-blue-200 bg-blue-50 p-3">
                                        <div className="flex items-center gap-2">
                                          <Loader2 className="w-4 h-4 text-blue-600 animate-spin flex-shrink-0" />
                                          <p className="text-xs text-blue-700 font-medium">Looking up owner data from BatchLeads…</p>
                                        </div>
                                      </div>
                                    );

                                    if (status === 'error') return (
                                      <div className="mt-3 rounded-lg border border-dashed border-red-300 bg-red-50 p-3">
                                        <p className="text-xs text-red-700 font-medium mb-1">⚠️ {es?.error || 'Enrichment failed'}</p>
                                        <button
                                          onClick={() => setOwnerEnrichState(prev => ({ ...prev, [storm.id]: { status: 'idle', enriched: [], matchCount: 0, error: null } }))}
                                          className="text-xs text-red-600 underline"
                                        >
                                          Try again
                                        </button>
                                      </div>
                                    );

                                    // status === 'done'
                                    if (ps?.done) return (
                                      <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3">
                                        <p className="text-xs text-emerald-700 font-medium">
                                          ✅ Saved as "{ps.name}" ({ps.count} prospects) — open Lead Finder and search this area to add them to your CRM.
                                        </p>
                                      </div>
                                    );

                                    {
                                      const skipCrm = skipCrmInProspect[storm.id] !== false;
                                      const crmCount = es?.crmMatchCount || 0;
                                      const allAddresses = es?.enriched || [];
                                      const addressesToSave = skipCrm
                                        ? allAddresses.filter(a => !a.already_in_crm)
                                        : allAddresses;
                                      return (
                                        <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3">
                                          <div className="flex items-start gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                                            <div className="flex-1 min-w-0">
                                              <p className="text-xs font-semibold text-emerald-800 mb-0.5">
                                                Owner data found for {es?.matchCount || 0} of {allAddresses.length} addresses
                                                {crmCount > 0 && (
                                                  <span className="ml-1.5 text-emerald-600 font-normal">· {crmCount} already in CRM</span>
                                                )}
                                              </p>
                                              <p className="text-xs text-emerald-700 leading-snug mb-2">
                                                Owner names are shown on each address above. Save as a Prospect List to access them in Lead Finder.
                                              </p>
                                              {crmCount > 0 && (
                                                <label className="flex items-center gap-1.5 mb-2 cursor-pointer select-none">
                                                  <input
                                                    type="checkbox"
                                                    checked={skipCrm}
                                                    onChange={e => setSkipCrmInProspect(prev => ({ ...prev, [storm.id]: e.target.checked }))}
                                                    className="w-3.5 h-3.5 accent-emerald-600"
                                                  />
                                                  <span className="text-xs text-emerald-800">Skip {crmCount} address{crmCount !== 1 ? 'es' : ''} already in CRM</span>
                                                </label>
                                              )}
                                              <button
                                                onClick={() => saveAsProspectList(storm.id, addressesToSave, storm.title)}
                                                disabled={ps?.loading || addressesToSave.length === 0}
                                                className="text-xs px-3 py-1.5 rounded border border-emerald-500 bg-white text-emerald-700 hover:bg-emerald-100 font-medium disabled:opacity-50 inline-flex items-center gap-1"
                                              >
                                                {ps?.loading
                                                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
                                                  : `💾 Save as Prospect List (${addressesToSave.length})`}
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    }
                                  })()}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                {visibleCount < sortedStorms.length && (
                  <div className="text-center py-3" ref={listEndRef}>
                    <Button
                      variant="outline"
                      onClick={handleLoadMore}
                      className="w-full"
                      data-testid="button-load-more-storms"
                    >
                      Load More ({sortedStorms.length - visibleCount} remaining)
                    </Button>
                  </div>
                )}

                {/* ── Saved Canvass Lists Panel ──────────────────────────────────── */}
                <div ref={savedListsRef} className="mt-2">
                  <Card className="border-emerald-200 bg-emerald-50/40">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-sm font-semibold text-emerald-800 flex items-center gap-1.5">
                            💾 Saved Canvass Lists
                          </CardTitle>
                          <p className="text-xs text-emerald-600 mt-0.5">Lists you saved earlier — load any one to route it now</p>
                        </div>
                        <button
                          onClick={loadSavedCanvassLists}
                          disabled={savedListsLoading}
                          className="text-xs px-2 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-100 flex items-center gap-1 disabled:opacity-50"
                        >
                          {savedListsLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                          {savedCanvassLists === null ? 'Load Lists' : 'Refresh'}
                        </button>
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      {savedCanvassLists === null && !savedListsLoading && (
                        <p className="text-xs text-slate-400 italic">Click "Load Lists" to see canvass lists saved from address panels above.</p>
                      )}
                      {savedListsLoading && (
                        <div className="flex items-center gap-2 py-2 text-xs text-slate-500">
                          <RefreshCw className="w-3 h-3 animate-spin" /> Loading saved lists…
                        </div>
                      )}
                      {savedCanvassLists !== null && !savedListsLoading && savedCanvassLists.length === 0 && (
                        <p className="text-xs text-slate-400 italic">No saved lists yet. Open an address panel above and click "💾 Save for Later".</p>
                      )}
                      {savedCanvassLists !== null && !savedListsLoading && savedCanvassLists.length > 0 && (
                        <div className="space-y-1.5">
                          {savedCanvassLists.map(list => (
                            <div key={list.id} className="flex items-center justify-between gap-2 rounded border border-emerald-200 bg-white px-3 py-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-slate-700 truncate">{list.name}</p>
                                <p className="text-[10px] text-slate-400 truncate">
                                  {list.address_count ? `${list.address_count} addresses` : ''}
                                  {list.storm_title ? ` · ${list.storm_title}` : ''}
                                  {list.created_date ? ` · ${new Date(list.created_date).toLocaleDateString()}` : ''}
                                </p>
                              </div>
                              <button
                                onClick={async () => {
                                  try {
                                    const detail = await base44.functions.invoke('getCanvassList', { id: list.id });
                                    const addresses = detail?.data?.addresses || detail?.addresses || [];
                                    if (!addresses.length) { alert('No addresses found in this list.'); return; }
                                    const routeAddresses = addresses.map((a, i) => ({
                                      ...a,
                                      id: `saved-${list.id}-${i}`,
                                      lng: a.lon || a.lng,
                                      name: a.street,
                                      status: 'new',
                                    }));
                                    sessionStorage.setItem('stormRouteAddresses', JSON.stringify({
                                      title: list.name,
                                      mode: 'saved',
                                      addresses: routeAddresses,
                                    }));
                                    navigate(createPageUrl('InspectionRouting'));
                                  } catch {
                                    alert('Failed to load this canvass list. Please try again.');
                                  }
                                }}
                                className="flex-shrink-0 text-xs px-2.5 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 whitespace-nowrap"
                              >
                                🗺️ Route Now →
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
                {visibleCount >= sortedStorms.length && sortedStorms.length > 20 && (
                  <p className="text-center text-xs text-gray-400 py-2">
                    Showing all {sortedStorms.length} storms
                  </p>
                )}
              </>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <CloudRain className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="font-medium">No storms found</p>
                <p className="text-sm mt-1">
                  {debouncedSearch || filterState !== 'all'
                    ? 'No storms match your filters' 
                    : showAllStorms 
                      ? 'No storms available' 
                      : 'No storms in your service area'}
                </p>
                {!showAllStorms && hasSettings && !debouncedSearch && (
                  <Button 
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAllStorms(true)}
                    className="mt-3"
                  >
                    Show All Storms Nationwide
                  </Button>
                )}
                {!hasSettings && (
                  <Button 
                    size="sm"
                    onClick={() => navigate(createPageUrl('StormAlertSettings'))}
                    className="mt-3 bg-blue-600 hover:bg-blue-700"
                  >
                    Configure Service Area
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-1">
          <Card>
            <CardContent className="p-0">
              <div className="h-[400px] md:h-[600px] rounded-lg overflow-hidden relative">
                <MapContainer
                center={mapCenter}
                zoom={mapZoom}
                style={{ height: '100%', width: '100%' }}
                className="z-0"
                >
                <MapController center={mapCenter} zoom={mapZoom} flyKey={mapFlyKey} />
                <FitBoundsController bounds={mapBounds} boundsKey={mapBoundsKey} />
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; OpenStreetMap contributors'
                />

                {/* Map Events Handler to track zoom for clustering */}
                <MapEventsHandler onZoomEnd={(z) => setMapZoom(z)} />

                {/* MRMS MESH radar swath — fetches per-viewport when Radar view is on */}
                <MeshOverlayFetcher enabled={mapViewMode === 'radar'} storm={selectedStorm} onOverlay={setMeshOverlay} />
                {mapViewMode === 'radar' && meshOverlay.available && meshOverlay.imageDataUrl && (
                  <ImageOverlay
                    key={meshOverlay.imageDataUrl.slice(-24)}
                    url={meshOverlay.imageDataUrl}
                    bounds={meshOverlay.bounds}
                    opacity={0.75}
                    zIndex={400}
                  />
                )}

                {clusters.map((cluster) => {
                  // --- RENDER CLUSTER (Multi-storm group) ---
                  if (cluster.points.length > 1) {
                    const hasActive = cluster.points.some(p => p.status === 'active');
                    const size = Math.min(60, 30 + (cluster.points.length * 2));
                    const color = hasActive ? 'rgba(220, 38, 38, 0.85)' : getSeverityBgColor(cluster.maxSeverity);
                    const border = hasActive ? '3px solid #fca5a5' : '2px solid white';

                    const icon = L.divIcon({
                      html: `<div aria-label="${cluster.points.length} storm events" style="background-color: ${color}; width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: white; font-weight: bold; border: ${border}; box-shadow: 0 4px 6px rgba(0,0,0,0.3); font-size: ${size > 40 ? '16px' : '12px'}; cursor: pointer; pointer-events: auto; ${hasActive ? 'animation: pulse 1.5s infinite;' : ''}">${cluster.points.length}</div>`,
                      className: 'custom-cluster-icon',
                      iconSize: [size, size],
                      iconAnchor: [size / 2, size / 2]
                    });

                    return (
                      <Marker 
                        key={cluster.id}
                        position={[cluster.lat, cluster.lng]}
                        icon={icon}
                        eventHandlers={{
                          click: (e) => {
                            setSelectedClusterStorms(cluster.points);
                          }
                        }}
                      />
                    );
                  }

                  // --- RENDER SINGLE STORM ---
                   const storm = cluster.points[0];
                   if (!storm || storm.lat === null || storm.lat === undefined || storm.lng === null || storm.lng === undefined) {
                     return null;
                   }
                   const isActiveStorm = storm.status === 'active';
                   if (isActiveStorm) {
                     const icon = L.divIcon({
                       html: `<div style="background-color: rgba(220,38,38,0.9); width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: white; font-size: 18px; border: 3px solid #fca5a5; box-shadow: 0 0 12px rgba(220,38,38,0.6); cursor: pointer; pointer-events: auto;">⚡</div>`,
                       className: 'active-alert-icon',
                       iconSize: [36, 36],
                       iconAnchor: [18, 18]
                     });
                     return (
                       <Marker
                         key={`${storm.id}-active`}
                         position={[storm.lat, storm.lng]}
                         icon={icon}
                         eventHandlers={{ click: () => setSelectedClusterStorms([storm]) }}
                       >
                         <Popup>
                           <div className="font-bold text-red-700">{storm.title}</div>
                           <div className="text-sm">{storm.headline || storm.description?.substring(0, 120)}</div>
                           {storm.expires_at && <div className="text-xs text-gray-500 mt-1">Expires: {new Date(storm.expires_at).toLocaleString()}</div>}
                         </Popup>
                       </Marker>
                     );
                   }
                   if (mapViewMode === 'radar') {
                     // Radar view: the MESH heatmap shows impact area — draw a small
                     // tap-target marker instead of the estimated-radius circle.
                     const dotIcon = L.divIcon({
                       html: `<div style="background:${getCircleColor(storm.severity)}; width:14px; height:14px; border-radius:50%; border:2px solid white; box-shadow:0 1px 4px rgba(0,0,0,0.4); cursor:pointer;"></div>`,
                       className: 'mesh-storm-dot', iconSize: [14, 14], iconAnchor: [7, 7],
                     });
                     return (
                       <Marker
                         key={`${storm.id}-radar-dot`}
                         position={[parseFloat(storm.lat), parseFloat(storm.lng)]}
                         icon={dotIcon}
                         eventHandlers={{ click: () => setSelectedClusterStorms([storm]) }}
                       >
                         <Popup>
                           <div className="font-bold text-sm">{storm.title}</div>
                           {storm.start_time && <div className="text-xs text-gray-600 mt-1">📅 {format(new Date(storm.start_time), 'MMM d, yyyy h:mm a')}</div>}
                         </Popup>
                       </Marker>
                     );
                   }
                   return (
                     <Circle
                       key={`${storm.id}-single`}
                       center={[parseFloat(storm.lat), parseFloat(storm.lng)]}
                       radius={Math.max((storm.radius_miles || 5) * 1609.34, 500)}
                       pathOptions={{
                         color: getCircleColor(storm.severity),
                         opacity: 0.7,
                         fillColor: getCircleColor(storm.severity),
                         fillOpacity: selectedStorm?.id === storm.id ? 0.4 : 0.2,
                         weight: selectedStorm?.id === storm.id ? 3 : 2
                       }}
                       eventHandlers={{
                         click: (e) => {
                           setSelectedClusterStorms([storm]);
                         }
                       }}
                     >
                       <Popup>
                         <div className="font-bold text-sm">{storm.title}</div>
                         {storm.start_time && <div className="text-xs text-gray-600 mt-1">📅 {format(new Date(storm.start_time), 'MMM d, yyyy h:mm a')}</div>}
                       </Popup>
                     </Circle>
                   );
                })}

                {/* NWS Storm-Based Warning (SBW) polygon — rendered when +Swath is active */}
                {activeSwathStormId && swathPolygons[activeSwathStormId]?.feature && (
                  <>
                    <GeoJSON
                      key={`sbw-${activeSwathStormId}`}
                      data={swathPolygons[activeSwathStormId].feature}
                      style={getSBWStyle}
                    />
                    <SwathPolygonLayer
                      stormId={activeSwathStormId}
                      feature={swathPolygons[activeSwathStormId].feature}
                    />
                  </>
                )}

                {/* Secondary hail swath circles — dashed, lighter, one per geocoded secondary area (spotter view only) */}
                {mapViewMode !== 'radar' && filteredStorms.filter(s => s.secondary_areas?.length > 0).flatMap(storm =>
                  storm.secondary_areas.map(area => {
                    const coords = geocodedSecondaryAreas[`${storm.id}-sec-${area}`];
                    if (!coords) return null;
                    return (
                      <Circle
                        key={`${storm.id}-sec-${area}`}
                        center={[coords.lat, coords.lng]}
                        radius={Math.max((storm.radius_miles || 3) * 1609.34 * 0.7, 800)}
                        pathOptions={{
                          color: '#64748b',
                          opacity: 0.55,
                          fillColor: '#94a3b8',
                          fillOpacity: 0.1,
                          weight: 2,
                          dashArray: '7, 5'
                        }}
                      >
                        <Popup>
                          <div className="font-semibold text-xs text-slate-700">{area}</div>
                          <div className="text-xs text-slate-500">Secondary hail area</div>
                          <div className="text-xs text-slate-400 mt-1">{storm.title}</div>
                        </Popup>
                      </Circle>
                    );
                  })
                ).filter(Boolean)}

                {geocodedOffices.filter(o => o.lat && o.lng).map((office, idx) => {
                  const color = ['#3b82f6','#14b8a6','#22c55e','#a855f7','#f97316'][idx % 5];
                  return (
                    <React.Fragment key={office.id || idx}>
                      <Marker position={[office.lat, office.lng]}>
                        <Popup>
                          <strong>{office.name || `Office ${idx + 1}`}</strong><br/>
                          {office.location}<br/>
                          Radius: {office.radius_miles || 50} miles
                          {(office.service_areas || []).length > 0 && (
                            <><br/>Areas: {office.service_areas.join(', ')}</>
                          )}
                        </Popup>
                      </Marker>
                      <Circle
                        center={[office.lat, office.lng]}
                        radius={(office.radius_miles || 50) * 1609.34}
                        pathOptions={{ color, fillColor: color, fillOpacity: 0.07, weight: 2, dashArray: '6, 4' }}
                      />
                    </React.Fragment>
                  );
                })}
                </MapContainer>

                {/* Radar / Spotter view toggle — only shown when hail/thunderstorm events are in view */}
                {hasHailEvents && (
                  <div style={{ zIndex: 900 }} className="absolute top-2 right-2 flex rounded-lg overflow-hidden shadow-md border border-slate-300 bg-white">
                    <button
                      onClick={() => setMapViewMode('radar')}
                      data-testid="button-radar-view"
                      className={`text-xs px-2.5 py-1.5 font-medium ${mapViewMode === 'radar' ? 'bg-purple-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                    >📡 Radar Swath</button>
                    <button
                      onClick={() => setMapViewMode('spotter')}
                      data-testid="button-spotter-view"
                      className={`text-xs px-2.5 py-1.5 font-medium border-l border-slate-200 ${mapViewMode === 'spotter' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                    >👁 Spotter Reports</button>
                  </div>
                )}

                {/* MESH legend + status (radar view only) */}
                {mapViewMode === 'radar' && (
                  <div style={{ zIndex: 900 }} className="absolute bottom-2 left-2 bg-white/95 rounded-lg shadow-md border border-slate-200 px-2.5 py-2 text-xs max-w-[200px]">
                    <p className="font-semibold text-slate-700 mb-1">
                      Radar Hail Size {meshOverlay.radarSource === 'archived' ? '(archived)' : '(live 24h)'}
                    </p>
                    {meshOverlay.loading && <p className="text-slate-400">Loading radar data…</p>}
                    {!meshOverlay.loading && !meshOverlay.available && <p className="text-slate-400">No radar hail data in view{meshOverlay.error ? ' — radar feed unavailable' : ''}</p>}
                    {!meshOverlay.loading && meshOverlay.available && (
                      <>
                        {(meshOverlay.legend || []).slice(0, 4).map(l => (
                          <div key={l.min} className="flex items-center gap-1.5">
                            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: l.color }} />
                            <span className="text-slate-600">{l.label}</span>
                          </div>
                        ))}
                        {meshOverlay.validTime && <p className="text-slate-400 mt-1">NOAA MRMS · {meshOverlay.radarSource === 'archived' ? 'Archived ' : 'Live '}{format(new Date(meshOverlay.validTime), 'MMM d h:mm a')}</p>}
                      </>
                    )}
                  </div>
                )}

                {/* Storm detail overlay — slides up from bottom of map on circle tap */}
                {selectedClusterStorms && (
                  <div
                    style={{ zIndex: 1000 }}
                    className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl border-t border-gray-200 max-h-[75%] flex flex-col"
                  >
                    {/* Handle bar */}
                    <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-100 shrink-0">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-blue-600" />
                        <span className="font-semibold text-sm text-gray-800">
                          {selectedClusterStorms.length === 1 ? selectedClusterStorms[0].title : `${selectedClusterStorms.length} Storm Events`}
                        </span>
                      </div>
                      <button
                        onClick={() => setSelectedClusterStorms(null)}
                        className="text-gray-400 hover:text-gray-700 text-lg font-bold leading-none p-1"
                        data-testid="button-close-storm-overlay"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Scrollable storm cards */}
                    <div className="overflow-y-auto p-3 space-y-3">
                      {selectedClusterStorms
                        .sort((a, b) => new Date(b.start_time) - new Date(a.start_time))
                        .map((storm, idx) => (
                          <div key={`overlay-${storm.id}-${idx}`} className="border rounded-xl p-3 bg-gray-50">
                            <div className="flex items-start justify-between mb-1">
                              <h4 className="font-semibold text-sm text-gray-900 leading-snug pr-2">{storm.title}</h4>
                              <Badge className={`${getSeverityColorClasses(storm.severity).bg} ${getSeverityColorClasses(storm.severity).text} border-0 shrink-0 text-xs`}>
                                {formatStormSeverityLabel(storm.severity)}
                              </Badge>
                            </div>
                            {(() => {
                              const mi = stormMeshInfo[storm.id];
                              if (!mi || mi.confidence === 'unknown' || !isHailRelevant(storm)) return null;
                              const cm = CONFIDENCE_META[mi.confidence] || CONFIDENCE_META.unknown;
                              return (
                                <span
                                  className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full border mb-1 ${cm.cls}`}
                                  title={mi.meshInches != null && mi.meshInches > 0
                                    ? `${mi.radarSource === 'archived' ? 'Archived radar' : 'Live radar'} shows up to ${mi.meshInches}" hail here`
                                    : `No hail core in ${mi.radarSource === 'archived' ? 'the archived radar snapshot' : 'live radar'}`}
                                  data-testid={`badge-confidence-${storm.id}`}
                                >
                                  {cm.icon} {cm.short}{mi.meshInches != null && mi.meshInches >= 0.5 ? ` · 📡 ${mi.meshInches}"` : ''}{mi.radarSource === 'archived' ? ' · Archived' : ''}
                                </span>
                              );
                            })()}
                            {storm.secondary_areas?.length > 0 ? (
                              <div className="mb-1 space-y-0.5">
                                <p className="text-xs text-gray-600">🔴 {storm.affected_areas?.join(', ')}</p>
                                <p className="text-xs text-slate-400">🔵 Also: {storm.secondary_areas.join(', ')}</p>
                              </div>
                            ) : storm.affected_areas?.length > 0 && (
                              <p className="text-xs text-gray-600 mb-1">{storm.affected_areas.join(', ')}</p>
                            )}
                            {storm.start_time && (
                              <p className="text-xs text-gray-400 mb-3">
                                📅 {format(new Date(storm.start_time), 'MMM d, yyyy h:mm a')}
                              </p>
                            )}
                            <div className="flex gap-2">
                              {HIDDEN_FEATURES.STORM_GET_REAL_LEADS && canGenerateLeads && (
                              <Button
                                size="sm"
                                onClick={() => {
                                  const allAreas = [
                                    ...(storm.affected_areas || []),
                                    ...(storm.secondary_areas || [])
                                  ].join(', ');
                                  navigate(createPageUrl('PropertyDataImporter') + `?storm=${encodeURIComponent(storm.title)}&areas=${encodeURIComponent(allAreas)}`);
                                }}
                                className="bg-green-600 hover:bg-green-700 text-xs h-8"
                                data-testid={`button-get-leads-${storm.id}`}
                              >
                                🎯 Import Data
                              </Button>
                              )}
                              {HIDDEN_FEATURES.STORM_GET_REAL_LEADS && canGenerateLeads && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const firstArea = (storm.affected_areas || [])[0] || (storm.secondary_areas || [])[0] || '';
                                  navigate(createPageUrl('LeadFinder') + `?location=${encodeURIComponent(firstArea)}`);
                                }}
                                className="text-xs h-8 px-2 border-blue-300 text-blue-700 hover:bg-blue-50"
                                data-testid={`button-search-leads-${storm.id}`}
                              >
                                🔍 Lead Finder
                              </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => navigate(createPageUrl('StormReport') + `?id=${storm.id}`)}
                                className="text-xs h-8 px-3"
                                data-testid={`button-storm-report-${storm.id}`}
                              >
                                Report
                              </Button>
                              {/* +Swath button — mirrors list card behavior; uses shared swathPolygons + activeSwathStormId state */}
                              <button
                                title="Show NWS warning polygon on map"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (activeSwathStormId === storm.id) {
                                    // Second tap: hide polygon
                                    setActiveSwathStormId(null);
                                  } else {
                                    // First tap: show polygon (fetch if not yet cached in state)
                                    setActiveSwathStormId(storm.id);
                                    if (!swathPolygons[storm.id]) {
                                      const sLat = parseFloat(storm.latitude || storm.lat);
                                      const sLng = parseFloat(storm.longitude || storm.lng);
                                      // Only query IEM for recent storms (≤12h) — SBW archive covers active warnings.
                                      // Cached storms (from task #919 DB cache) are returned instantly regardless of age.
                                      const stormAgeHrs = storm.start_time
                                        ? (Date.now() - new Date(storm.start_time).getTime()) / 36e5
                                        : Infinity;
                                      if (sLat && sLng && storm.start_time && stormAgeHrs <= 12) {
                                        setSwathPolygons(prev => ({ ...prev, [storm.id]: { loading: true, feature: null, error: null } }));
                                        base44.functions.invoke('fetchStormSBWPolygon', {
                                          stormId: storm.id, lat: sLat, lng: sLng,
                                          startTime: storm.start_time, eventType: storm.event_type,
                                        }).then(result => {
                                          const feature = result?.data?.feature ?? result?.feature ?? null;
                                          setSwathPolygons(prev => ({
                                            ...prev,
                                            [storm.id]: { loading: false, feature, error: feature ? null : 'No active NWS warning polygon for this storm' },
                                          }));
                                        }).catch(err => {
                                          setSwathPolygons(prev => ({
                                            ...prev,
                                            [storm.id]: { loading: false, feature: null, error: err.message },
                                          }));
                                        });
                                      }
                                    }
                                  }
                                }}
                                className={`h-8 px-2 rounded border text-xs flex items-center gap-1 ${
                                  activeSwathStormId === storm.id
                                    ? swathPolygons[storm.id]?.feature
                                      ? 'bg-blue-100 border-blue-400 text-blue-700'
                                      : 'bg-slate-100 border-slate-400 text-slate-700'
                                    : 'border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                                }`}
                                data-testid={`button-swath-overlay-${storm.id}`}
                              >
                                {swathPolygons[storm.id]?.loading
                                  ? <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70"/></svg>
                                  : '🔵'
                                }
                                +Swath
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}