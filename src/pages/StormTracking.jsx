import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY'
];

function isSevereStorm(storm) {
  return (storm.hail_size_inches && parseFloat(storm.hail_size_inches) > 1.0) ||
         (storm.wind_speed_mph && parseFloat(storm.wind_speed_mph) > 60);
}
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MapContainer, TileLayer, Circle, Popup, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
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

const KNOWN_CITY_COORDS = {
  'cleveland': { lat: 41.4993, lng: -81.6944, state: 'OH' },
  'columbus': { lat: 39.9612, lng: -82.9988, state: 'OH' },
  'cincinnati': { lat: 39.1031, lng: -84.5120, state: 'OH' },
  'akron': { lat: 41.0814, lng: -81.5190, state: 'OH' },
  'toledo': { lat: 41.6528, lng: -83.5379, state: 'OH' },
  'dayton': { lat: 39.7589, lng: -84.1916, state: 'OH' },
  'youngstown': { lat: 41.0998, lng: -80.6495, state: 'OH' },
  'canton': { lat: 40.7989, lng: -81.3784, state: 'OH' },
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
  return null;
};

export default function StormTracking() {
  const navigate = useNavigate();
  const { toast } = useToast();
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
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [daysBack, setDaysBack] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('stormDaysBack');
      return saved ? parseInt(saved) : 365;
    }
    return 365;
  });
  const [geocodedAreas, setGeocodedAreas] = useState({});
  const [clusters, setClusters] = useState([]);
  const [selectedClusterStorms, setSelectedClusterStorms] = useState(null);
  const [mapBounds, setMapBounds] = useState(null);
  const [mapBoundsKey, setMapBoundsKey] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    setVisibleCount(20);
  }, [debouncedSearch, filterType, filterState]);

  const queryClient = useQueryClient();

  const { myCompany, isAdmin, hasPermission, isPermissionsReady } = useRoleBasedData();
  // 🔐 Only users with leads create access may generate CRM leads from storms
  const canGenerateLeads = !isPermissionsReady || isAdmin || hasPermission('leads', 'create');

  const { data: alertSettingsData = [], isLoading: isLoadingSettings } = useQuery({
    queryKey: ['storm-alert-settings', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StormAlertSettings.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
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
    daysBack, showAllStorms, filterState, filterType];

  const { data: stormsData, isLoading: isLoadingStorms, error: stormsError, refetch: refetchStorms } = useQuery({
    queryKey: stormsQueryKey,
    queryFn: () => {
      const stateArg = filterState !== 'all' ? filterState : undefined;
      const typesArg = filterType !== 'all' ? [filterType] : undefined;
      if (showAllStorms) {
        return base44.functions.invoke('getStormsInArea', { lat: null, lng: null, radiusMiles: 0, daysBack, limit: 500, stateFilter: stateArg, types: typesArg });
      }
      // Multi-office path
      if (officeLocationsParam && officeLocationsParam.length > 0) {
        return base44.functions.invoke('getStormsInArea', { officeLocations: officeLocationsParam, daysBack, limit: 500, stateFilter: stateArg, types: typesArg });
      }
      // Single legacy office or no coords yet
      if (centerCoordsForQuery || serviceCenterCoords) {
        const coords = centerCoordsForQuery || serviceCenterCoords;
        return base44.functions.invoke('getStormsInArea', {
          lat: coords.lat,
          lng: coords.lng,
          radiusMiles: companySettings?.service_radius_miles || 50,
          daysBack,
          limit: 500,
          includeStates,
          stateFilter: stateArg,
          types: typesArg,
        });
      }
      // No office configured — use state filter if available to still return results
      if (stateArg) {
        return base44.functions.invoke('getStormsInArea', { lat: null, lng: null, radiusMiles: 0, daysBack, limit: 500, stateFilter: stateArg, types: typesArg });
      }
      return base44.functions.invoke('getStormsInArea', { lat: null, lng: null, radiusMiles: 0, daysBack, limit: 200, types: typesArg });
    },
    enabled: true,
    refetchInterval: autoRefresh ? 300000 : false,
    select: (res) => res?.data?.storms || [],
  });

  const storms = stormsData || [];

  // Active NWS alerts query — refreshes every 5 minutes automatically
  const { data: activeAlertsData = [] } = useQuery({
    queryKey: ['storm-active-alerts-all'],
    queryFn: () => base44.functions.invoke('getStormsInArea', { lat: null, lng: null, radiusMiles: 0, daysBack: 0, statusFilter: 'active', limit: 100 }),
    refetchInterval: 5 * 60 * 1000,
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
      const newCount = response.data?.newEvents || 0;
      const summary = response.data?.summary || {};
      const activeAlertCount = summary.active_alerts || 0;
      
      if (newCount > 0) {
        toast({
          title: `Found ${newCount} new storm event${newCount === 1 ? '' : 's'}`,
          description: `${activeAlertCount > 0 ? `⚡ ${activeAlertCount} active NWS warnings + ` : ''}${(newCount - activeAlertCount)} historical reports imported. Total in database: ${summary.total_in_database || 0}`,
        });
      } else {
        toast({
          title: 'Storm data is up to date',
          description: `No new storms found in the last ${daysBack} days. ${summary.total_in_database || 0} total storms in database.`,
          variant: 'default',
        });
      }
    },
    onError: (error) => {
      console.error('❌ Fetch error:', error);
      toast({ title: 'Failed to fetch storm data', description: error.message, variant: 'destructive' });
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

  const generateLeadsMutation = useMutation({
    mutationFn: (stormId) => base44.functions.invoke('generateStormLeads', { stormId }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['storm-events'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      const count = response.data?.leadsGenerated || 0;
      toast({ title: `Generated ${count} lead${count === 1 ? '' : 's'}`, description: `From "${response.data?.stormTitle}"` });
    },
    onError: (error) => {
      toast({ title: 'Failed to generate leads', description: error.message, variant: 'destructive' });
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
    const configs = {
      minor: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
      moderate: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-200' },
      severe: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
      extreme: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' }
    };
    return configs[severity] || configs.moderate;
  };

  const getCircleColor = (severity) => {
    const colors = {
      minor: '#3b82f6',
      moderate: '#f59e0b',
      severe: '#f97316',
      extreme: '#ef4444'
    };
    return colors[severity] || colors.moderate;
  };

  const getSeverityBgColor = (severity) => {
    const colors = {
      minor: 'rgba(59, 130, 246, 0.4)',      // blue
      moderate: 'rgba(245, 158, 11, 0.4)',   // yellow/amber
      severe: 'rgba(249, 115, 22, 0.4)',    // orange
      extreme: 'rgba(239, 68, 68, 0.5)'      // red
    };
    return colors[severity] || colors.moderate;
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
      const severityDiff = (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
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
          if (sevOrder[point.severity] > sevOrder[cluster.maxSeverity]) {
            cluster.maxSeverity = point.severity;
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

  const activeStorms = filteredStorms.filter(s => s.status === 'active').length;
  const severeStorms = filteredStorms.filter(s => s.severity === 'severe' || s.severity === 'extreme').length;
  const totalAffectedAreas = new Set(filteredStorms.flatMap(s => s.affected_areas || [])).size;
  const totalLeadsGenerated = filteredStorms.reduce((sum, s) => sum + (s.leads_generated || 0), 0);

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
        <Alert className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-300 shadow-sm">
          <Info className="h-4 w-4 text-green-700" />
          <AlertDescription>
            <div className="text-sm text-green-900 max-h-[200px] overflow-y-auto pr-2">
              <strong className="text-lg">💰 How to Get REAL Property Owner Leads (100% FREE):</strong>
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
          </AlertDescription>
        </Alert>
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
                                {severe && (
                                  <Badge className="bg-red-100 text-red-700 border-red-300 text-xs">
                                    SEVERE
                                  </Badge>
                                )}
                                <Badge variant="outline" className={`${severityConfig.bg} ${severityConfig.text} ${severityConfig.border} text-xs`}>
                                  {storm.severity}
                                </Badge>
                              </div>
                            </div>
                            <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                              {storm.affected_areas?.join(', ')}
                            </p>
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
                              {canGenerateLeads && (
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(createPageUrl('PropertyDataImporter') + `?storm=${encodeURIComponent(storm.title)}&areas=${encodeURIComponent(storm.affected_areas?.join(', ') || '')}`);
                                }}
                                className="bg-green-600 hover:bg-green-700 flex-1"
                                data-testid={`button-get-leads-${storm.id}`}
                              >
                                <Users className="w-3 h-3 mr-1" />
                                Get REAL Leads
                              </Button>
                              )}
                              
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

                {clusters.map((cluster) => {
                  // --- RENDER CLUSTER (Multi-storm group) ---
                  if (cluster.points.length > 1) {
                    const hasActive = cluster.points.some(p => p.status === 'active');
                    const size = Math.min(60, 30 + (cluster.points.length * 2));
                    const color = hasActive ? 'rgba(220, 38, 38, 0.85)' : getSeverityBgColor(cluster.maxSeverity);
                    const border = hasActive ? '3px solid #fca5a5' : '2px solid white';

                    const icon = L.divIcon({
                      html: `<div style="background-color: ${color}; width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: white; font-weight: bold; border: ${border}; box-shadow: 0 4px 6px rgba(0,0,0,0.3); font-size: ${size > 40 ? '16px' : '12px'}; cursor: pointer; pointer-events: auto; ${hasActive ? 'animation: pulse 1.5s infinite;' : ''}">${hasActive ? '⚡' : ''}${cluster.points.length}</div>`,
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
                                {storm.severity}
                              </Badge>
                            </div>
                            {storm.affected_areas?.length > 0 && (
                              <p className="text-xs text-gray-600 mb-1">{storm.affected_areas.join(', ')}</p>
                            )}
                            {storm.start_time && (
                              <p className="text-xs text-gray-400 mb-3">
                                📅 {format(new Date(storm.start_time), 'MMM d, yyyy h:mm a')}
                              </p>
                            )}
                            <div className="flex gap-2">
                              {canGenerateLeads && (
                              <Button
                                size="sm"
                                onClick={() => navigate(createPageUrl('PropertyDataImporter') + `?storm=${encodeURIComponent(storm.title)}&areas=${encodeURIComponent(storm.affected_areas?.join(', ') || '')}`)}
                                className="flex-1 bg-green-600 hover:bg-green-700 text-xs h-8"
                                data-testid={`button-get-leads-${storm.id}`}
                              >
                                🎯 Get Leads
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