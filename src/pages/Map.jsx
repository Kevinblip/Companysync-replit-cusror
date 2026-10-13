import React, { useState, useEffect, useCallback, useMemo } from "react";
import useTranslation from "@/hooks/useTranslation";
import { isPlatformAdminCheck } from "@/hooks/usePlatformAdmin";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { usePageGuard } from '@/hooks/usePageGuard';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MapContainer, TileLayer, Marker, Popup, Circle, CircleMarker, useMap } from 'react-leaflet';
import {
  MapPin,
  Users,
  TrendingUp,
  Filter,
  X,
  Phone,
  Mail,
  DollarSign,
  Home,
  Navigation,
  Layers,
  Search,
  Target,
  User,
  Building2,
  Pencil,
  Plus,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix Leaflet default marker icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Default service areas fallback
const DEFAULT_SERVICE_AREAS = [
  {
    id: 'northeast-ohio',
    name: 'Northeast Ohio',
    lat: 41.4993, 
    lng: -81.6944,
    zoom: 10,
    radius: 50000,
  },
  {
    id: 'columbus-ohio',
    name: 'Columbus, OH',
    lat: 39.9612, 
    lng: -82.9988,
    zoom: 11,
    radius: 40000,
  },
  {
    id: 'cincinnati-ohio',
    name: 'Cincinnati, OH',
    lat: 39.1031, 
    lng: -84.5120,
    zoom: 11,
    radius: 40000,
  },
  {
    id: 'toledo-ohio',
    name: 'Toledo, OH',
    lat: 41.6528, 
    lng: -83.5379,
    zoom: 11,
    radius: 35000,
  },
  {
    id: 'akron-ohio',
    name: 'Akron, OH',
    lat: 41.0814, 
    lng: -81.5190,
    zoom: 12,
    radius: 30000,
  },
];

// Create cluster icon showing number of items
const createClusterIcon = (count) => {
  return L.divIcon({
    className: 'custom-cluster-marker',
    html: `
      <div style="
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: 4px solid white;
        box-shadow: 0 6px 16px rgba(0,0,0,0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
        font-size: 16px;
        cursor: pointer;
        pointer-events: auto;
      ">
        ${count}
      </div>
    `,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
};

// Returns the fill color for a marker based on type/status
const getMarkerColor = (type, status) => {
  if (type === 'lead') {
    if (status === 'won') return '#10b981';
    if (status === 'lost') return '#ef4444';
    if (status === 'qualified') return '#f59e0b';
    if (status === 'contacted') return '#8b5cf6';
    return '#3b82f6';
  }
  if (type === 'customer') return '#10b981';
  if (type === 'company') return '#7c3aed';
  return '#3b82f6';
};

export default function Map() {
  usePageGuard({ feature: 'map' });
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Centralized role/company/admin resolution — same hook as Leads & Customers
  const {
    user,
    myCompany: hookMyCompany,
    isAdmin: hookIsAdmin,
    filterLeads,
    filterCustomers,
  } = useRoleBasedData();

  const [selectedArea, setSelectedArea] = useState('northeast-ohio');
  // Initialize with default or empty, will update in useEffect when company data loads
  const [mapCenter, setMapCenter] = useState([41.4993, -81.6944]);
  const [mapZoom, setMapZoom] = useState(10);
  
  // Service Area Management
  const [manageAreasDialog, setManageAreasDialog] = useState(false);
  const [newAreaForm, setNewAreaForm] = useState({ name: '', location: '', radius: 20 });
  const [isAddingArea, setIsAddingArea] = useState(false);
  const [editingAreaId, setEditingAreaId] = useState(null);
  const [mapKey, setMapKey] = useState(0); // Force map re-render on area change
  const [filters, setFilters] = useState({
    type: 'all',
    status: 'all',
    assignedTo: 'all',
    search: '',
    activeOnly: false,
  });
  const [mapItems, setMapItems] = useState([]);
  const [isLoadingCoordinates, setIsLoadingCoordinates] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0 });
  const [bgGeocoding, setBgGeocoding] = useState({ active: false, current: 0, total: 0 });
  const [itemsWithoutAddress, setItemsWithoutAddress] = useState([]);
  // Nominatim queue — enforces strict serial 1-req/sec regardless of concurrent callers
  const nominatimQueue = React.useRef(Promise.resolve());

  // myCompany and user come from useRoleBasedData (declared above)
  const myCompany = hookMyCompany;

  // Fetch all companies for the platform-admin multi-company map view
  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date", 200),
  });

  // Staff profiles scoped to this company — used for the assignee filter dropdown
  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
  });

  // 🌍 Compute active service areas (Company specific or Defaults)
  const serviceAreas = useMemo(() => {
    if (myCompany?.service_areas && myCompany.service_areas.length > 0) {
      return myCompany.service_areas;
    }
    return DEFAULT_SERVICE_AREAS;
  }, [myCompany]);

  // Update map state when company data loads or service areas change
  useEffect(() => {
    if (serviceAreas.length > 0) {
      // If currently selected area is not in list, select first one
      const currentExists = serviceAreas.find(a => a.id === selectedArea);
      if (!currentExists) {
        const first = serviceAreas[0];
        setSelectedArea(first.id);
        setMapCenter([first.lat, first.lng]);
        setMapZoom(first.zoom || 10);
      }
    }
  }, [serviceAreas, selectedArea]);

  const updateCompanyMutation = useMutation({
    mutationFn: async (updates) => {
      if (!myCompany?.id) throw new Error("No company found");
      return await base44.entities.Company.update(myCompany.id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
    onError: (err) => {
      alert("Failed to update settings: " + err.message);
    }
  });

  const handleAddArea = async () => {
    if (!newAreaForm.name) {
      alert("Please enter an Area Name");
      return;
    }
    
    // For new areas, location is required. For edits, it's optional (keeps current center).
    if (!editingAreaId && !newAreaForm.location) {
       alert("Please enter a Location (City, State)");
       return;
    }
    
    setIsAddingArea(true);
    try {
      let lat, lng;
      
      // If location is provided, geocode it
      if (newAreaForm.location) {
        try {
          const response = await base44.functions.invoke('geocodeAddress', { address: newAreaForm.location });
          if (response.data && response.data.lat && response.data.lng) {
            lat = response.data.lat;
            lng = response.data.lng;
          } else {
            console.error("Geocoding error:", response.data);
            throw new Error(response.data?.error || 'Location not found');
          }
        } catch (e) {
          console.error("Geocoding exception:", e);
          alert("Could not find location: " + newAreaForm.location + ". Please check the spelling or try a more specific address (e.g., City, State, Zip).");
          setIsAddingArea(false);
          return;
        }
      }

      const currentAreas = myCompany?.service_areas || [];
      let updatedAreas;

      if (editingAreaId) {
        // Update existing area
        updatedAreas = currentAreas.map(area => {
          if (area.id === editingAreaId) {
            return {
              ...area,
              name: newAreaForm.name,
              lat: lat !== undefined ? lat : area.lat, // Use new lat if geocoded, else keep old
              lng: lng !== undefined ? lng : area.lng,
              radius: parseFloat(newAreaForm.radius) * 1609.34, // Miles to Meters
            };
          }
          return area;
        });
      } else {
        // Calculate appropriate zoom level based on radius (miles)
        const radiusMiles = parseFloat(newAreaForm.radius);
        let zoom = 10; // Default (City level, ~20-30 miles)
        if (radiusMiles > 1000) zoom = 3;      // Country/Continent
        else if (radiusMiles > 400) zoom = 4;  // Multi-state
        else if (radiusMiles > 100) zoom = 6;  // State
        else if (radiusMiles > 50) zoom = 8;   // Region

        // Add new area
        const newArea = {
          id: `area_${Date.now()}`,
          name: newAreaForm.name,
          lat: lat,
          lng: lng,
          radius: radiusMiles * 1609.34, // Miles to Meters
          zoom: zoom
        };
        updatedAreas = [...currentAreas, newArea];
      }
      
      await updateCompanyMutation.mutateAsync({ service_areas: updatedAreas });
      
      // Auto-select the newly created or edited area and move map to it
      const targetAreaId = editingAreaId || updatedAreas[updatedAreas.length - 1].id;
      const targetArea = updatedAreas.find(a => a.id === targetAreaId);
      
      if (targetArea) {
        setSelectedArea(targetArea.id);
        setMapCenter([targetArea.lat, targetArea.lng]);
        setMapZoom(targetArea.zoom || 10);
        setMapKey(prev => prev + 1); // Force map re-render
      }

      setNewAreaForm({ name: '', location: '', radius: 20 });
      setEditingAreaId(null);
    } finally {
      setIsAddingArea(false);
    }
  };

  const handleEditArea = (area) => {
    setEditingAreaId(area.id);
    setNewAreaForm({
      name: area.name,
      location: '', // Leave empty to indicate "keep current location"
      radius: Math.round(area.radius / 1609.34) // Meters to Miles
    });
  };

  const cancelEdit = () => {
    setEditingAreaId(null);
    setNewAreaForm({ name: '', location: '', radius: 20 });
  };

  const handleDeleteArea = async (areaId) => {
    if (!confirm("Remove this service area?")) return;
    const updatedAreas = (myCompany?.service_areas || []).filter(a => a.id !== areaId);
    await updateCompanyMutation.mutateAsync({ service_areas: updatedAreas });
  };

  // Load all leads and customers (is_active handled in memo to include null/undefined)
  const { data: allLeads = [] } = useQuery({
    queryKey: ['leads-map', myCompany?.id],
    queryFn: async () => {
      if (!myCompany?.id) return [];
      // Don't filter is_active in query — some leads have it as null (not explicitly false)
      const byCompany = await base44.entities.Lead.filter({ company_id: myCompany.id }, '-created_date', 5000);
      // Fallback: if company_id filter returns nothing, fetch all (company_id may not be set on older leads)
      if (byCompany.length === 0) {
        return await base44.entities.Lead.filter({}, '-created_date', 5000);
      }
      return byCompany;
    },
    enabled: !!user && !!myCompany,
  });

  const { data: allCustomers = [] } = useQuery({
    queryKey: ['customers-map', myCompany?.id],
    queryFn: async () => {
      if (!myCompany?.id) return [];
      const byCompany = await base44.entities.Customer.filter({ company_id: myCompany.id }, '-created_date', 5000);
      if (byCompany.length === 0) {
        return await base44.entities.Customer.filter({}, '-created_date', 5000);
      }
      return byCompany;
    },
    enabled: !!user && !!myCompany,
  });

  const { data: allInvoices = [] } = useQuery({
    queryKey: ['invoices-map', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Invoice.filter({ company_id: myCompany.id }, '-created_date', 2000) : [],
    enabled: !!user && !!myCompany,
  });

  // Sum amount_paid per customer name from real invoices — source of truth for revenue
  const revenueByCustomer = useMemo(() => {
    const map = {};
    for (const inv of allInvoices) {
      const paid = Number(inv.amount_paid || 0);
      if (!paid) continue;
      const key = (inv.customer_name || '').trim().toLowerCase();
      if (key) map[key] = (map[key] || 0) + paid;
    }
    return map;
  }, [allInvoices]);

  // isAdmin from useRoleBasedData — consistent with Leads/Customers pages
  const isAdmin = hookIsAdmin;
  const isPlatformAdmin = isPlatformAdminCheck(user, myCompany, null);

  const processedCompanies = useMemo(() => {
    if (!isPlatformAdmin || !companies.length) return [];

    return companies
      .filter(c => c.address || (c.city && c.state))
      .map(c => {
         const fullAddress = c.address && c.city 
          ? [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ')
          : (c.address || [c.city, c.state].filter(Boolean).join(', '));

         return {
           id: c.id,
           name: c.company_name,
           type: 'company',
           status: c.subscription_plan || 'trial',
           address: fullAddress,
           email: c.email,
           phone: c.phone,
           company: c.company_name, // self
           value: 0, // could map to plan price
           assigned_to: null,
           geocoding_key: fullAddress
         };
      });
  }, [companies, isPlatformAdmin]);

  // Use the same filter functions as Leads/Customers pages for consistent scoping
  const leads = useMemo(() => filterLeads(allLeads), [filterLeads, allLeads]);
  const customers = useMemo(() => filterCustomers(allCustomers), [filterCustomers, allCustomers]);
  
  // Debug logging
  console.log('🗺️ MAP DEBUG:', {
    isAdmin,
    userEmail: user?.email,
    allLeadsCount: allLeads.length,
    allCustomersCount: allCustomers.length,
    filteredLeadsCount: leads.length,
    filteredCustomersCount: customers.length,
    sampleLead: leads[0],
    sampleCustomer: customers[0]
  });
      
  // Derived state to map filters.status to the array format expected by the outline
  const currentLeadStatusesFilter = useMemo(() => {
    if (filters.status === 'all' || !['new', 'contacted', 'qualified', 'won', 'lost'].includes(filters.status)) {
      return [];
    }
    return [filters.status];
  }, [filters.status]);

  // 🔥 FIX: Support BOTH old 'address' field AND new 'street/city/zip' fields
  const processedLeads = useMemo(() => {
    if (!leads || leads.length === 0) return [];
    
    return leads
      .filter(lead => {
        // Exclude explicitly deactivated leads (is_active: null/undefined = include)
        if (lead.is_active === false) return false;
        
        // Accept any lead that has at least one address-like field
        const hasStreet = !!(lead.street && lead.street.trim());
        const hasCity   = !!(lead.city   && lead.city.trim());
        const hasZip    = !!(lead.zip    && String(lead.zip).trim());
        const hasOldAddr = !!(lead.address && lead.address.trim() && !lead.address.includes('@'));
        // Also accept pre-stored coordinates (previously geocoded)
        const hasCoords = !!(lead.lat && lead.lng);

        if (!hasStreet && !hasCity && !hasZip && !hasOldAddr && !hasCoords) return false;
        
        // Filter by status if selected
        if (currentLeadStatusesFilter.length > 0 && !currentLeadStatusesFilter.includes(lead.status)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (b.value || 0) - (a.value || 0)) // Sort by value DESC
      // No hard cap — all geocoded leads are shown
      .map(lead => {
        // Build best possible address from whatever fields are populated
        const structured = [lead.street, lead.city, lead.state, lead.zip].filter(Boolean).join(', ');
        const fullAddress = structured || (lead.address && !lead.address.includes('@') ? lead.address : '');
        
        return {
          id: lead.id,
          name: lead.name,
          type: 'lead',
          status: lead.status || 'new',
          address: fullAddress,
          email: lead.email,
          phone: lead.phone,
          company: lead.company,
          value: lead.value,
          source: lead.source,
          assigned_to: lead.assigned_to,
          assigned_to_users: lead.assigned_to_users || [],
          geocoding_key: fullAddress,
          preCoords: lead.lat && lead.lng ? { lat: Number(lead.lat), lng: Number(lead.lng) } : null,
        };
      });
  }, [leads, currentLeadStatusesFilter]);

  const processedCustomers = useMemo(() => {
    if (!customers || customers.length === 0) return [];
    
    return customers
      .filter(customer => {
        // Exclude explicitly deactivated customers (is_active: null/undefined = include)
        if (customer.is_active === false) return false;
        
        // Accept any customer that has at least one address-like field
        const hasStreet  = !!(customer.street && customer.street.trim());
        const hasCity    = !!(customer.city   && customer.city.trim());
        const hasZip     = !!(customer.zip    && String(customer.zip).trim());
        const hasOldAddr = !!(customer.address && customer.address.trim() && !customer.address.includes('@'));
        // Also accept pre-stored coordinates (previously geocoded)
        const hasCoords  = !!(customer.lat && customer.lng);

        if (!hasStreet && !hasCity && !hasZip && !hasOldAddr && !hasCoords) return false;

        return true;
      })
      .sort((a, b) => {
        const aRev = revenueByCustomer[(a.name || '').trim().toLowerCase()] ?? (a.total_revenue || 0);
        const bRev = revenueByCustomer[(b.name || '').trim().toLowerCase()] ?? (b.total_revenue || 0);
        return bRev - aRev;
      }) // Sort by real revenue DESC
      // No hard cap — all geocoded customers are shown
      .map(customer => {
        const computedRevenue = revenueByCustomer[(customer.name || '').trim().toLowerCase()] ?? customer.total_revenue ?? 0;
        // Build best possible address from whatever fields are populated
        const structured = [customer.street, customer.city, customer.state, customer.zip].filter(Boolean).join(', ');
        let fullAddress = structured || (customer.address && !customer.address.includes('@') ? customer.address : '');

        // Fallback: If address is missing, check if this customer matches a Company name and use that address
        if ((!fullAddress || fullAddress.trim() === '') && companies.length > 0) {
          const matchingCompany = companies.find(c => 
            c.company_name?.toLowerCase().trim() === customer.name?.toLowerCase().trim() ||
            (customer.name?.toLowerCase().includes(c.company_name?.toLowerCase().trim()) && c.company_name.length > 5)
          );
          
          if (matchingCompany) {
             fullAddress = matchingCompany.address && matchingCompany.city 
              ? [matchingCompany.address, matchingCompany.city, matchingCompany.state, matchingCompany.zip].filter(Boolean).join(', ')
              : (matchingCompany.address || [matchingCompany.city, matchingCompany.state].filter(Boolean).join(', '));
             console.log(`📍 Found company address for customer ${customer.name}: ${fullAddress}`);
          }
        }
        
        return {
          id: customer.id,
          name: customer.name,
          type: 'customer',
          status: 'customer',
          address: fullAddress,
          email: customer.email,
          phone: customer.phone,
          company: customer.company,
          is_active: customer.is_active,
          assigned_to: customer.assigned_to,
          assigned_to_users: customer.assigned_to_users || [],
          total_revenue: computedRevenue,
          geocoding_key: fullAddress,
          preCoords: customer.lat && customer.lng ? { lat: Number(customer.lat), lng: Number(customer.lng) } : null,
        };
      });
  }, [customers, revenueByCustomer]);

  // ── Geocode cache helpers (localStorage, 30-day TTL) ──────────────────────
  // v2: clears poisoned null entries cached by the v1 batch-rate-limit bug
  const GEO_CACHE_KEY = 'companysync_geocache_v2';
  const GEO_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;

  const readGeoCache = useCallback(() => {
    try { return JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}'); }
    catch { return {}; }
  }, []);

  const writeGeoCache = useCallback((cache) => {
    try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache)); }
    catch { /* storage full — ignore */ }
  }, []);

  // Geocode addresses using Backend Function (supports global addresses + fallback)
  const geocodeAddress = useCallback(async (address) => {
    if (!address) return null;

    // 1. Check localStorage cache first (only successful results are cached)
    const cache = readGeoCache();
    const cacheKey = address.trim().toLowerCase();
    const cached = cache[cacheKey];
    if (cached && cached.ts && Date.now() - cached.ts < GEO_CACHE_TTL) {
      return cached.coords || null;
    }

    let coords = null;

    // 2. Try server function
    try {
      const response = await base44.functions.invoke('geocodeAddress', { address });
      if (response?.data?.lat && response?.data?.lng) {
        coords = { lat: response.data.lat, lng: response.data.lng };
      } else if (response?.lat && response?.lng) {
        coords = { lat: response.lat, lng: response.lng };
      }
    } catch (error) {
      console.warn('Server geocoding failed, trying Nominatim directly:', error.message);
    }

    // 3. Nominatim fallback — strictly serialised via a shared promise queue so
    //    concurrent callers never fire simultaneously (Nominatim enforces 1 req/sec).
    if (!coords) {
      coords = await new Promise((resolve) => {
        nominatimQueue.current = nominatimQueue.current.then(async () => {
          // Always wait 1.1 s between successive Nominatim requests
          await new Promise(r => setTimeout(r, 1100));
          try {
            const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
            const resp = await fetch(nominatimUrl, { headers: { 'User-Agent': 'CompanySync/1.0' } });
            if (resp.ok) {
              const data = await resp.json();
              if (data && data.length > 0) {
                resolve({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) });
                return;
              }
            }
          } catch (e) {
            console.error('Nominatim geocoding failed for', address, ':', e.message);
          }
          resolve(null);
        });
      });
    }

    // 4. Only cache successful results — failed lookups are always retried next load
    if (coords) {
      const updatedCache = readGeoCache();
      updatedCache[cacheKey] = { coords, ts: Date.now() };
      for (const k of Object.keys(updatedCache)) {
        if (Date.now() - (updatedCache[k].ts || 0) > GEO_CACHE_TTL) delete updatedCache[k];
      }
      writeGeoCache(updatedCache);
    }

    return coords;
  }, [readGeoCache, writeGeoCache]);

  useEffect(() => {
    const loadCoordinates = async () => {
      const allItems = [...processedCompanies, ...processedLeads, ...processedCustomers];

      if (allItems.length === 0) {
        setMapItems([]);
        setItemsWithoutAddress([]);
        setIsLoadingCoordinates(false);
        setLoadingProgress({ current: 0, total: 0 });
        setBgGeocoding({ active: false, current: 0, total: 0 });
        return;
      }

      // ── Phase 1: instant render from localStorage cache ──────────────────
      // Read every item's cached coords synchronously — no network calls.
      const cache = readGeoCache();
      const cachedItems = [];
      const needsGeocode = [];
      const noAddress = [];

      for (const item of allItems) {
        // Fastest path: lat/lng already stored on the entity (persisted after prior geocode)
        if (item.preCoords) {
          cachedItems.push({ ...item, coordinates: item.preCoords });
          continue;
        }
        if (!item.address) {
          noAddress.push({ type: item.type, name: item.name, reason: 'No address provided', address: 'N/A' });
          continue;
        }
        const cacheKey = item.address.trim().toLowerCase();
        const hit = cache[cacheKey];
        if (hit && hit.ts && Date.now() - hit.ts < GEO_CACHE_TTL && hit.coords) {
          cachedItems.push({ ...item, coordinates: hit.coords });
        } else {
          needsGeocode.push(item);
        }
      }

      // Show the map immediately with whatever is cached — no spinner needed.
      setMapItems(cachedItems);
      setItemsWithoutAddress(noAddress);
      setIsLoadingCoordinates(false);
      setLoadingProgress({ current: 0, total: 0 });

      if (needsGeocode.length === 0) {
        setBgGeocoding({ active: false, current: 0, total: 0 });
        return;
      }

      // ── Phase 2: geocode the rest in the background ───────────────────────
      // Deduplicate: many leads/customers share the same address — geocode once, fan out.
      const addressGroupMap = new Map();
      for (const item of needsGeocode) {
        const key = item.address.trim().toLowerCase();
        if (!addressGroupMap.has(key)) addressGroupMap.set(key, []);
        addressGroupMap.get(key).push(item);
      }
      // The server geocodes + persists the bulk (see the server-geocode effect
      // below); the browser only handles a small safety cap so mobile never stalls
      // hammering hundreds of addresses. Deferred addresses arrive from the server.
      const CLIENT_GEOCODE_CAP = 40;
      const allUniqueAddresses = [...addressGroupMap.entries()];
      const uniqueAddresses = allUniqueAddresses.slice(0, CLIENT_GEOCODE_CAP);
      const deferredUnique = allUniqueAddresses.length - uniqueAddresses.length;
      const cappedItemCount = uniqueAddresses.reduce((sum, [, items]) => sum + items.length, 0);

      console.log(`🗺️ Map rendered with ${cachedItems.length} instant pins; geocoding ${uniqueAddresses.length}/${allUniqueAddresses.length} unique addresses (${cappedItemCount} items) in browser${deferredUnique > 0 ? `, ${deferredUnique} deferred to server` : ''}`);
      setBgGeocoding({ active: true, current: 0, total: cappedItemCount });

      const BATCH_SIZE = 10;
      let bgCompleted = 0;

      for (let b = 0; b < uniqueAddresses.length; b += BATCH_SIZE) {
        const batch = uniqueAddresses.slice(b, b + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async ([address, items]) => {
            const coords = await geocodeAddress(address);
            return { address, items, coords };
          })
        );

        const newPins = [];
        for (const r of results) {
          if (r.status !== 'fulfilled') continue;
          const { items, coords } = r.value;
          if (coords) {
            for (const item of items) {
              newPins.push({ ...item, coordinates: coords });
            }
            // Persist coords back to entity so future map loads skip geocoding entirely
            for (const item of items) {
              if (item.type === 'lead') {
                base44.entities.Lead.update(item.id, { lat: coords.lat, lng: coords.lng }).catch(() => {});
              } else if (item.type === 'customer') {
                base44.entities.Customer.update(item.id, { lat: coords.lat, lng: coords.lng }).catch(() => {});
              }
            }
          } else {
            for (const item of items) {
              noAddress.push({ type: item.type, name: item.name, reason: 'Could not geocode', address: item.address });
            }
          }
        }

        // Merge new pins into the map incrementally
        if (newPins.length > 0) {
          setMapItems(prev => [...prev, ...newPins]);
        }
        if (noAddress.length > 0) {
          setItemsWithoutAddress([...noAddress]);
        }

        bgCompleted += batch.reduce((sum, [, items]) => sum + items.length, 0);
        setBgGeocoding({ active: true, current: Math.min(bgCompleted, cappedItemCount), total: cappedItemCount });
      }

      console.log(`✅ Background geocoding complete. Total pins: ${cachedItems.length + needsGeocode.length - noAddress.filter(i => i.reason === 'Could not geocode').length}`);
      setBgGeocoding({ active: false, current: 0, total: 0 });
    };

    if (user && (processedLeads.length > 0 || processedCustomers.length > 0 || processedCompanies.length > 0)) {
      loadCoordinates();
    } else if (user) {
      setMapItems([]);
      setItemsWithoutAddress([]);
      setIsLoadingCoordinates(false);
      setLoadingProgress({ current: 0, total: 0 });
      setBgGeocoding({ active: false, current: 0, total: 0 });
    }
  }, [processedLeads, processedCustomers, processedCompanies, user, geocodeAddress, readGeoCache]);

  // ── Server-side bulk geocode + persist ────────────────────────────────────
  // On Map open, ask the server to geocode any leads/customers that have an
  // address but no saved coordinates, and store the coordinates in Postgres.
  // Runs in the background (never blocks rendering); as batches complete we
  // refetch so pins appear, and future visits load instantly from saved coords.
  const serverGeocodeRef = React.useRef(null);
  useEffect(() => {
    const companyId = myCompany?.id;
    if (!companyId || serverGeocodeRef.current === companyId) return;
    serverGeocodeRef.current = companyId;

    (async () => {
      for (let i = 0; i < 6; i++) {
        let data;
        try {
          const resp = await base44.functions.invoke('bulkGeocodeEntities', { company_id: companyId, limit: 300 });
          data = resp?.data || resp || {};
        } catch (err) {
          console.warn('[Map] server geocoding failed:', err?.message);
          break;
        }
        if (data.geocoded > 0) {
          queryClient.invalidateQueries({ queryKey: ['leads-map', companyId] });
          queryClient.invalidateQueries({ queryKey: ['customers-map', companyId] });
        }
        if (!data.remaining || data.remaining <= 0 || !data.geocoded) break;
      }
    })();
  }, [myCompany?.id, queryClient]);

  const filteredItems = mapItems.filter(item => {
    if (filters.type === 'companies' && item.type !== 'company') return false;
    if (filters.type === 'leads' && item.type !== 'lead') return false;
    if (filters.type === 'customers' && item.type !== 'customer') return false;
    // Active-only: hide won/lost leads (they're closed, not being worked)
    if (filters.activeOnly && item.type === 'lead' && ['won', 'lost'].includes(item.status)) return false;
    
    // Note: For leads, status filtering based on filters.status is already applied in processedLeads.
    // This check here mostly affects customers or ensures consistency.
    if (filters.status !== 'all') {
      if (item.type === 'lead') {
        // This condition is mostly redundant due to processedLeads filtering, but safe.
        if (currentLeadStatusesFilter.length > 0 && !currentLeadStatusesFilter.includes(item.status)) return false;
      }
      else if (item.type === 'customer') {
        // Map lead-like statuses to customer 'is_active' or filter out
        if (filters.status === 'won' && !item.is_active) return false;
        if (filters.status === 'lost' && item.is_active) return false;
        // For 'new', 'contacted', 'qualified', customers don't apply
        if (['new', 'contacted', 'qualified'].includes(filters.status)) return false;
      }
    }
    
    if (filters.assignedTo !== 'all') {
      const isAssigned = item.assigned_to === filters.assignedTo || 
                         (item.assigned_to_users && item.assigned_to_users.includes(filters.assignedTo));
      if (!isAssigned) return false;
    }
    
    if (filters.search) {
      const search = filters.search.toLowerCase();
      return item.name?.toLowerCase().includes(search) ||
             item.email?.toLowerCase().includes(search) ||
             item.company?.toLowerCase().includes(search) ||
             item.address?.toLowerCase().includes(search);
    }
    
    return true;
  });

  // Group items by coordinates (cluster overlapping markers)
  const groupedItems = {};
  filteredItems.forEach(item => {
    // Round coordinates to cluster nearby locations together
    // Using precision of 3 decimal places groups items within ~100 meters
    // This prevents map from being overwhelmed by nearby markers
    const key = `${item.coordinates.lat.toFixed(3)},${item.coordinates.lng.toFixed(3)}`;
    if (!groupedItems[key]) {
      groupedItems[key] = [];
    }
    groupedItems[key].push(item);
  });

  // Map pin counts (geocoded items only — need address to show on map)
  const totalLeadPins = filteredItems.filter(i => i.type === 'lead').length;
  const totalCustomerPins = filteredItems.filter(i => i.type === 'customer').length;
  // Raw counts from DB — shown in stat cards so 0 doesn't confuse the user
  const totalLeads = leads.length;
  const totalCustomers = customers.length;
  const newLeads = leads.filter(l => l.status === 'new').length;
  const wonLeads = leads.filter(l => l.status === 'won').length;
  // How many are missing addresses (can't be geocoded)
  const leadsNoAddress = processedLeads.length === 0 && leads.length > 0;
  const customersNoAddress = processedCustomers.length === 0 && customers.length > 0;

  // Derive assignee list: include all company staff profiles so the dropdown
  // shows everyone regardless of whether they have assigned items in raw data.
  const assignedStaff = [...new Set([
    ...staffProfiles
      .filter(s => myCompany ? s.company_id === myCompany.id : false)
      .map(s => s.user_email),
    ...allLeads.flatMap(l => [l.assigned_to, ...(l.assigned_to_users || [])]),
    ...allCustomers.flatMap(c => [c.assigned_to, ...(c.assigned_to_users || [])]),
  ].filter(v => v && v.includes('@')))].sort();

  const handleAreaChange = (areaId) => {
    setSelectedArea(areaId);
    const area = serviceAreas.find(a => a.id === areaId);
    if (area) {
      setMapCenter([area.lat, area.lng]);
      setMapZoom(area.zoom || 10);
      setMapKey(prev => prev + 1);
    }
  };

  const getStaffName = (email) => {
    const staff = staffProfiles.find(s => s.user_email === email);
    return staff?.full_name || email;
  };

  // 🔥 NEW: Calculate rep breakdown
  const repBreakdown = useMemo(() => {
    const breakdown = {};
    
    filteredItems.forEach(item => {
      const assignees = item.assigned_to_users && item.assigned_to_users.length > 0 
        ? item.assigned_to_users 
        : (item.assigned_to ? [item.assigned_to] : []);
      
      assignees.forEach(email => {
        if (!breakdown[email]) {
          breakdown[email] = { leads: 0, customers: 0, total: 0 };
        }
        if (item.type === 'lead') {
          breakdown[email].leads++;
        } else {
          breakdown[email].customers++;
        }
        breakdown[email].total++;
      });
    });
    
    return Object.entries(breakdown)
      .map(([email, counts]) => ({
        email,
        name: getStaffName(email),
        ...counts
      }))
      .sort((a, b) => b.total - a.total);
  }, [filteredItems, staffProfiles]);

  return (
    <div className="p-4 md:p-6 flex flex-col gap-4 bg-gray-50 min-h-screen">
      <div className="flex items-center justify-between gap-4 flex-wrap order-1">
        <h1 className="text-3xl font-bold text-gray-900">{t.sidebar.map}</h1>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 cursor-pointer hover:bg-blue-100"
            onClick={() => setFilters(f => ({ ...f, type: f.type === 'leads' ? 'all' : 'leads' }))}>
            {totalLeadPins}/{totalLeads} {t.leads.title}
          </Badge>
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 cursor-pointer hover:bg-green-100"
            onClick={() => setFilters(f => ({ ...f, type: f.type === 'customers' ? 'all' : 'customers' }))}>
            {totalCustomerPins}/{totalCustomers} {t.customers.title}
          </Badge>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 order-2">
        <Card className="bg-white border-blue-200 hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => setFilters(f => ({ ...f, type: f.type === 'leads' ? 'all' : 'leads', status: 'all' }))}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600">{t.dashboard.totalLeads}</p>
                <p className="text-3xl font-bold text-blue-600">{totalLeads}</p>
              </div>
              <TrendingUp className="w-10 h-10 text-blue-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-purple-200 hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => setFilters(f => ({ ...f, type: 'leads', status: f.status === 'new' ? 'all' : 'new' }))}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600">{t.leads.newLead}</p>
                <p className="text-3xl font-bold text-purple-600">{newLeads}</p>
              </div>
              <Target className="w-10 h-10 text-purple-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-green-200 hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => setFilters(f => ({ ...f, type: 'leads', status: f.status === 'won' ? 'all' : 'won' }))}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600">Won Deals</p>
                <p className="text-3xl font-bold text-green-600">{wonLeads}</p>
              </div>
              <Home className="w-10 h-10 text-green-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-green-200 hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => setFilters(f => ({ ...f, type: f.type === 'customers' ? 'all' : 'customers', status: 'all' }))}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600">{t.customers.title}</p>
                <p className="text-3xl font-bold text-green-600">{totalCustomers}</p>
              </div>
              <Users className="w-10 h-10 text-green-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Missing address notice */}
      <div className="order-4">
      {(leadsNoAddress || customersNoAddress) && (
        <Alert className="border-amber-300 bg-amber-50">
          <MapPin className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            <strong>No map pins yet</strong> — your {leadsNoAddress && customersNoAddress ? 'leads and customers' : leadsNoAddress ? 'leads' : 'customers'} don't have addresses saved, so they can't be placed on the map. Open each lead or customer and add a street address to see them as pins.
          </AlertDescription>
        </Alert>
      )}
      </div>

      {/* 🔥 NEW: Rep Breakdown Card */}
      <div className="order-5">
      {isAdmin && repBreakdown.length > 0 && (
        <Card className="bg-white border-indigo-200">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <User className="w-5 h-5 text-indigo-600" />
              Sales Rep Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {repBreakdown.map(rep => (
                <div 
                  key={rep.email} 
                  className={`p-3 bg-gradient-to-br from-indigo-50 to-blue-50 rounded-lg border cursor-pointer transition-all ${
                    filters.assignedTo === rep.email
                      ? 'border-indigo-500 shadow-md ring-2 ring-indigo-300'
                      : 'border-indigo-200 hover:shadow-md hover:border-indigo-400'
                  }`}
                  onClick={() => setFilters(f => ({
                    ...f,
                    assignedTo: f.assignedTo === rep.email ? 'all' : rep.email
                  }))}
                  title={`Click to filter map to ${rep.name}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-semibold text-sm text-gray-900 truncate flex-1">
                      {rep.name}
                    </p>
                    <Badge className="bg-indigo-600 text-white ml-2">
                      {rep.total}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-600">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                      {rep.leads} {t.leads.title.toLowerCase()}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-500"></span>
                      {rep.customers} {t.customers.title.toLowerCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      </div>

      {/* 🔥 NEW: Personal Stats for Non-Admin */}
      <div className="order-6">
      {!isAdmin && (
        <Card className="bg-gradient-to-br from-indigo-50 to-blue-50 border-indigo-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Your Assigned Locations</p>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                    <span className="text-lg font-bold text-blue-600">{totalLeads} {t.leads.title.toLowerCase()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-green-500"></span>
                    <span className="text-lg font-bold text-green-600">{totalCustomers} {t.customers.title.toLowerCase()}</span>
                  </div>
                </div>
                {(totalLeads === 0 && totalCustomers === 0) && (
                  <p className="text-xs text-gray-400 mt-1">
                    ({leads.length} assigned, {allLeads.length} total fetched — {processedLeads.length} with addresses)
                  </p>
                )}
              </div>
              <User className="w-10 h-10 text-indigo-400" />
            </div>
          </CardContent>
        </Card>
      )}
      </div>

      {/* Service Area Selector */}
      <Card className="bg-white order-7">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Navigation className="w-5 h-5" />
              {t.sidebar.workTerritory || "Service Area"}
            </CardTitle>
            {isAdmin && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setManageAreasDialog(true)}
                className="text-xs"
              >
                <Filter className="w-3 h-3 mr-1" />
                Manage Areas
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="flex flex-wrap gap-2">
            {serviceAreas.map((area) => (
              <Button
                key={area.id}
                variant={selectedArea === area.id ? "default" : "outline"}
                onClick={() => handleAreaChange(area.id)}
                className={selectedArea === area.id ? "bg-blue-600 hover:bg-blue-700" : ""}
              >
                <MapPin className="w-4 h-4 mr-2" />
                {area.name}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={manageAreasDialog} onOpenChange={setManageAreasDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Service Areas</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2 max-h-40 overflow-y-auto border rounded p-2">
              {myCompany?.service_areas && myCompany.service_areas.length > 0 ? (
                myCompany.service_areas.map(area => (
                  <div key={area.id} className="flex items-center justify-between p-2 bg-gray-50 rounded border border-gray-100">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{area.name}</span>
                      <span className="text-xs text-gray-500">{Math.round(area.radius / 1609.34)} miles radius</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleEditArea(area)}
                        className="text-blue-600 h-8 w-8 p-0 hover:bg-blue-50"
                        title={t.common.edit}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleDeleteArea(area.id)}
                        className="text-red-600 h-8 w-8 p-0 hover:bg-red-50"
                        title={t.common.delete}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 text-center py-2">{t.common.noResults}</p>
              )}
            </div>

            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">{editingAreaId ? t.common.edit : t.common.add}</h4>
                {editingAreaId && (
                  <Button variant="ghost" size="sm" onClick={cancelEdit} className="h-6 text-xs">
                    {t.common.cancel}
                  </Button>
                )}
              </div>
              
              <div>
                <Label>{t.common.name}</Label>
                <Input 
                  value={newAreaForm.name} 
                  onChange={e => setNewAreaForm({...newAreaForm, name: e.target.value})} 
                  placeholder="e.g. Home Base"
                />
              </div>
              <div>
                <Label>{t.common.address} {editingAreaId && <span className="text-xs text-gray-500 font-normal">({t.common.optional})</span>}</Label>
                <Input 
                  value={newAreaForm.location} 
                  onChange={e => setNewAreaForm({...newAreaForm, location: e.target.value})} 
                  placeholder={editingAreaId ? "Enter new city/state to move area" : "e.g. Sandusky, OH"}
                />
              </div>
              <div>
                <Label>Radius (miles)</Label>
                <Input 
                  type="number" 
                  value={newAreaForm.radius} 
                  onChange={e => setNewAreaForm({...newAreaForm, radius: e.target.value})} 
                  placeholder="20"
                />
              </div>
              <Button 
                onClick={handleAddArea} 
                disabled={isAddingArea} 
                className={`w-full ${editingAreaId ? 'bg-indigo-600 hover:bg-indigo-700' : ''}`}
              >
                {isAddingArea ? t.common.loading : (editingAreaId ? t.common.update : t.common.add)}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Map Filters */}
      <Card className="bg-white order-8">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Filter className="w-5 h-5" />
              {t.common.filters}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilters({ type: 'all', status: 'all', assignedTo: 'all', search: '', activeOnly: false })}
            >
              <X className="w-4 h-4 mr-2" />
              {t.common.clearFilters}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label className="text-sm mb-1 block">{t.common.view}</Label>
              <Select value={filters.type} onValueChange={(value) => setFilters({...filters, type: value})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.common.all}</SelectItem>
                  {isPlatformAdmin && (
                    <SelectItem value="companies">Subscribers (Companies)</SelectItem>
                  )}
                  <SelectItem value="leads">{t.leads.title}</SelectItem>
                  <SelectItem value="customers">{t.customers.title}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm mb-1 block">{t.common.status}</Label>
              <Select value={filters.status} onValueChange={(value) => setFilters({...filters, status: value})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.common.all}</SelectItem>
                  <SelectItem value="new">{t.common.new}</SelectItem>
                  <SelectItem value="contacted">{t.leads.contacted}</SelectItem>
                  <SelectItem value="qualified">{t.leads.qualified}</SelectItem>
                  <SelectItem value="won">{t.leads.won}</SelectItem>
                  <SelectItem value="lost">{t.leads.lost}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col justify-end">
              <Label className="text-sm mb-1 block text-gray-500">Lead visibility</Label>
              <Button
                type="button"
                variant={filters.activeOnly ? 'default' : 'outline'}
                size="sm"
                className={`w-full justify-start gap-2 ${filters.activeOnly ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'text-gray-600'}`}
                onClick={() => setFilters(f => ({ ...f, activeOnly: !f.activeOnly, status: 'all' }))}
                data-testid="button-active-leads-only"
              >
                <span className={`inline-block w-2 h-2 rounded-full ${filters.activeOnly ? 'bg-white' : 'bg-gray-300'}`} />
                Active leads only
              </Button>
              {filters.activeOnly && (
                <p className="text-[10px] text-blue-600 mt-1">Hiding won &amp; lost leads</p>
              )}
            </div>

            {isAdmin && (
              <div>
                <Label className="text-sm mb-1 block">{t.leads.assignedTo}</Label>
                <Select value={filters.assignedTo} onValueChange={(value) => setFilters({...filters, assignedTo: value})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.common.all}</SelectItem>
                    {assignedStaff.map(email => (
                      <SelectItem key={email} value={email}>
                        {getStaffName(email)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label className="text-sm mb-1 block">{t.common.search}</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder={`${t.common.name}, ${t.common.address.toLowerCase()}...`}
                  value={filters.search}
                  onChange={(e) => setFilters({...filters, search: e.target.value})}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <Card className="bg-white order-9">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-center text-sm">
            <span className="font-semibold flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Legend:
            </span>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-sm"></div>
              <span>{t.leads.newLead}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-purple-500 border-2 border-white shadow-sm"></div>
              <span>{t.leads.contacted}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-orange-500 border-2 border-white shadow-sm"></div>
              <span>{t.leads.qualified}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-green-500 border-2 border-white shadow-sm"></div>
              <span>{t.leads.won} / {t.customers.title}</span>
            </div>
            {isPlatformAdmin && (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-purple-600 border-2 border-white shadow-sm"></div>
                <span>Subscriber</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-red-500 border-2 border-white shadow-sm"></div>
              <span>{t.leads.lost}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-700 border-2 border-white text-white text-xs font-bold flex items-center justify-center shadow-sm">
                #
              </div>
              <span>Multiple at this {t.common.address.toLowerCase()}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 🔥 NEW: Performance Warning */}
      <div className="order-10">
      {(processedLeads.length + processedCustomers.length) > 500 && (
        <Alert className="bg-orange-50 border-orange-200">
          <AlertDescription>
            ⚠️ <strong>Performance Optimization Active:</strong> Showing top {processedLeads.length} highest-value leads and {processedCustomers.length} top-revenue customers.
            Consider applying more specific filters for an optimal experience.
          </AlertDescription>
        </Alert>
      )}
      </div>

      {/* Warning Banner */}
      <div className="order-11">
      {itemsWithoutAddress.length > 0 && (
        <Alert className="bg-yellow-50 border-yellow-200">
          <AlertDescription>
            <div className="flex flex-col gap-2">
              {(() => {
                const noAddr = itemsWithoutAddress.filter(i => i.reason === 'No address provided');
                const failedGeo = itemsWithoutAddress.filter(i => i.reason === 'Could not geocode');
                return (
                  <div>
                    ⚠️{' '}
                    {noAddr.length > 0 && (
                      <><strong>{noAddr.length} {noAddr.length === 1 ? 'record is' : 'records are'} missing an address</strong> — add one to plot {noAddr.length === 1 ? 'it' : 'them'} on the map.{' '}</>
                    )}
                    {failedGeo.length > 0 && (
                      <><strong>{failedGeo.length} {failedGeo.length === 1 ? 'address' : 'addresses'} could not be geocoded</strong> — {failedGeo.length === 1 ? 'it has' : 'they have'} an address but the map lookup failed. Reload the page to retry.</>
                    )}
                  </div>
                );
              })()}

              {itemsWithoutAddress.length > 0 && (
                <div className="bg-yellow-100/50 p-2 rounded-md text-sm border border-yellow-200 mt-1">
                  <p className="font-semibold text-yellow-800 mb-1">Items needing attention:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    {itemsWithoutAddress.slice(0, 5).map((item, idx) => (
                      <li key={idx} className="text-yellow-900">
                        <span className="font-medium">{item.name}</span>
                        <span className="text-yellow-700 text-xs ml-2">
                           ({item.type === 'lead' ? t.leads.title : item.type === 'company' ? 'Subscriber' : t.customers.title} • {item.reason})
                        </span>
                      </li>
                    ))}
                    {itemsWithoutAddress.length > 5 && (
                      <li className="text-yellow-700 italic">...and {itemsWithoutAddress.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {itemsWithoutAddress.some(i => i.type === 'company') && (
                  <button
                    onClick={() => navigate(createPageUrl('SaaSAdminDashboard'))}
                    className="text-blue-600 hover:underline font-semibold text-left w-fit"
                  >
                    Go to SaaS Dashboard to fix subscriber addresses →
                  </button>
                )}
                {itemsWithoutAddress.some(i => i.type === 'lead') && (
                  <button
                    onClick={() => navigate(createPageUrl('Leads'))}
                    className="text-blue-600 hover:underline font-semibold text-left w-fit"
                  >
                    Go to {t.leads.title} to fix addresses →
                  </button>
                )}
                {itemsWithoutAddress.some(i => i.type === 'customer') && (
                  <button
                    onClick={() => navigate(createPageUrl('Customers'))}
                    className="text-blue-600 hover:underline font-semibold text-left w-fit"
                  >
                    Go to {t.customers.title} to fix addresses →
                  </button>
                )}
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}
      </div>

      {/* Map Container */}
      <Card className="bg-white order-3">
        <CardContent className="p-0">
          <div className="h-[600px] rounded-lg overflow-hidden relative">
              {/* Background geocoding progress badge */}
              {bgGeocoding.active && mapItems.length > 0 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] bg-white/95 backdrop-blur shadow-md rounded-full px-4 py-1.5 border border-gray-200 flex items-center gap-2">
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-500"></div>
                  <span className="text-xs text-gray-600">Adding pins… {bgGeocoding.current}/{bgGeocoding.total}</span>
                </div>
              )}
              {bgGeocoding.active && mapItems.length === 0 && (
                <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-white/80 backdrop-blur-sm">
                  <div className="bg-white rounded-2xl shadow-xl border border-gray-100 px-8 py-6 flex flex-col items-center gap-3 max-w-xs mx-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-100 border-t-blue-500"></div>
                    <p className="text-sm font-semibold text-gray-800 text-center">Locating addresses…</p>
                    <p className="text-xs text-gray-500 text-center">{bgGeocoding.current} of {bgGeocoding.total} placed</p>
                  </div>
                </div>
              )}
              {filteredItems.length === 0 && !bgGeocoding.active && (() => {
                const totalRaw = allLeads.length + allCustomers.length;
                const visibleRaw = leads.length + customers.length;
                const processedCount = processedLeads.length + processedCustomers.length;
                const hasActiveFilters = filters.type !== 'all' || filters.status !== 'all' || filters.assignedTo !== 'all' || !!filters.search;

                let msg = t.common.noResults;
                if (totalRaw === 0) {
                  msg = 'No leads or customers yet — add one to see it on the map.';
                } else if (!isAdmin && visibleRaw === 0) {
                  msg = 'No leads or customers are assigned to you. Ask an admin to assign records or switch accounts.';
                } else if (itemsWithoutAddress.length > 0) {
                  msg = `${itemsWithoutAddress.length} record${itemsWithoutAddress.length === 1 ? '' : 's'} could not be mapped — check that each has a valid street address.`;
                } else if (processedCount === 0 && visibleRaw > 0) {
                  // Records exist but none have an address field set
                  msg = `${visibleRaw} record${visibleRaw === 1 ? '' : 's'} ${visibleRaw === 1 ? 'is' : 'are'} missing an address — open each lead or customer and add a street address to plot ${visibleRaw === 1 ? 'it' : 'them'} on the map.`;
                } else if (mapItems.length > 0 && hasActiveFilters) {
                  // Items exist but current filters are hiding everything
                  msg = 'No records match the current filters — try adjusting or clearing the filters.';
                }
                return (
                  <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000] bg-white/90 backdrop-blur shadow-lg rounded-full px-6 py-2 border border-gray-200" data-testid="map-empty-state">
                    <p className="text-sm font-medium text-gray-600 flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-gray-400" />
                      {msg}
                    </p>
                  </div>
                );
              })()}
              <MapContainer
                key={mapKey}
                center={mapCenter}
                zoom={mapZoom}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; OpenStreetMap contributors'
                />
                
                {(() => {
                  const area = serviceAreas.find(a => a.id === selectedArea);
                  if (area) {
                    return (
                      <Circle 
                        center={[area.lat, area.lng]}
                        radius={area.radius}
                        pathOptions={{ 
                          color: '#3b82f6', 
                          fillColor: '#3b82f6', 
                          fillOpacity: 0.1,
                          weight: 2,
                          dashArray: '5, 10'
                        }} 
                      />
                    );
                  }
                  return null;
                })()}
                
                {Object.entries(groupedItems).map(([coordKey, items]) => {
                  const firstItem = items[0];
                  const count = items.length;
                  const status = firstItem.status || (firstItem.is_active ? 'active' : 'inactive');
                  const color = getMarkerColor(firstItem.type, status);
                  const popupContent = (
                      <Popup maxWidth={300} className="custom-popup">
                        <div className="p-2 max-w-[300px]">
                          {count > 1 && (
                            <div className="mb-3 p-2 bg-purple-50 rounded-lg border border-purple-200">
                              <p className="text-sm font-semibold text-purple-900">
                                📍 {count} {t.common.all.toLowerCase()} at this {t.common.address.toLowerCase()}
                              </p>
                            </div>
                          )}
                          
                          {items.map((item, idx) => {
                            const isAssignedToMe = item.assigned_to === user?.email ||
                              (item.assigned_to_users && item.assigned_to_users.includes(user?.email));
                            const canView = isAdmin || isAssignedToMe || item.created_by === user?.email;
                            return (
                              <div key={`${item.type}-${item.id}`} className={idx > 0 ? "mt-4 pt-4 border-t border-gray-200" : ""}>
                                <div className="flex items-center justify-between mb-2">
                                  <Badge className={
                                    item.type === 'lead' ? 'bg-blue-100 text-blue-700' : 
                                    item.type === 'company' ? 'bg-purple-100 text-purple-700' :
                                    'bg-green-100 text-green-700'
                                  }>
                                    {item.type === 'lead' ? `📋 ${t.leads.title}` : 
                                     item.type === 'company' ? '🏢 Subscriber' : 
                                     `✅ ${t.customers.title}`}
                                  </Badge>
                                  {item.status && (
                                    <Badge variant="outline" className="capitalize text-xs">
                                      {item.status}
                                    </Badge>
                                  )}
                                </div>
                                
                                <h3 className="font-bold text-base mb-2">{item.name}</h3>
                                
                                {item.company && (
                                  <p className="text-sm text-gray-600 mb-1">🏢 {item.company}</p>
                                )}
                                
                                <p className="text-sm text-gray-600 mb-2">📍 {item.address}</p>
                                
                                {item.email && (
                                  <p className="text-sm text-blue-600 flex items-center gap-1 mb-1">
                                    <Mail className="w-3 h-3" />
                                    {item.email}
                                  </p>
                                )}
                                
                                {item.phone && (
                                  <p className="text-sm text-green-600 flex items-center gap-1 mb-2">
                                    <Phone className="w-3 h-3" />
                                    {item.phone}
                                  </p>
                                )}
                                
                                {item.value && (
                                  <p className="text-sm font-semibold text-purple-600 flex items-center gap-1 mb-2">
                                    <DollarSign className="w-3 h-3" />
                                    ${item.value.toLocaleString()}
                                  </p>
                                )}

                                {item.total_revenue && (
                                  <p className="text-sm font-semibold text-green-600 flex items-center gap-1 mb-2">
                                    <DollarSign className="w-3 h-3" />
                                    {t.accounting.revenue}: ${item.total_revenue.toLocaleString()}
                                  </p>
                                )}
                                
                                {item.assigned_to && (
                                  <p className="text-xs text-gray-500 mt-2">
                                    👤 {getStaffName(item.assigned_to)}
                                  </p>
                                )}
                                
                                {canView && (
                                  <Button
                                    size="sm"
                                    className="w-full mt-3 bg-blue-600 hover:bg-blue-700 text-xs"
                                    onClick={() => {
                                      if (item.type === 'company') {
                                        navigate(createPageUrl('SaaSAdminDashboard'));
                                      } else if (item.type === 'lead') {
                                        navigate(createPageUrl('Leads') + `?view_lead_id=${item.id}`);
                                      } else {
                                        navigate(createPageUrl('CustomerProfile') + `?name=${encodeURIComponent(item.name)}`);
                                      }
                                    }}
                                  >
                                    {item.type === 'company' ? 'Manage Company' : t.common.view}
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </Popup>
                  );
                  
                  // Single-item dot: use CircleMarker (native SVG path — always interactive/clickable)
                  if (count === 1) {
                    return (
                      <CircleMarker
                        key={coordKey}
                        center={[firstItem.coordinates.lat, firstItem.coordinates.lng]}
                        radius={14}
                        pathOptions={{
                          color: '#ffffff',
                          weight: 3,
                          fillColor: color,
                          fillOpacity: 1,
                        }}
                      >
                        {popupContent}
                      </CircleMarker>
                    );
                  }
                  
                  // Cluster: Marker with numbered divIcon
                  return (
                    <Marker
                      key={coordKey}
                      position={[firstItem.coordinates.lat, firstItem.coordinates.lng]}
                      icon={createClusterIcon(count)}
                      eventHandlers={{ click: (e) => e.target.openPopup() }}
                    >
                      {popupContent}
                    </Marker>
                  );
                })}
              </MapContainer>
            </div>
        </CardContent>
      </Card>

      <div className="order-12">
      {filteredItems.length > 0 && (
        <Alert className="bg-blue-50 border-blue-200">
          <MapPin className="w-4 h-4 text-blue-600" />
          <AlertDescription>
            <strong>{t.common.view.split(' ')[0]} {filteredItems.length} {t.common.address.toLowerCase()}s</strong> - {totalLeads} {t.leads.title.toLowerCase()} and {totalCustomers} {t.customers.title.toLowerCase()} 
            {isAdmin ? ` across all ${t.sidebar.staffManagement.toLowerCase()}` : ' assigned to you'} in {serviceAreas.find(a => a.id === selectedArea)?.name || 'Selected Area'}.
            {Object.keys(groupedItems).length < filteredItems.length && (
              <span className="block mt-1 text-purple-700 font-semibold">
                ⚠️ Some markers are grouped together - click the purple clusters to see all locations!
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}
      </div>
    </div>
  );
}