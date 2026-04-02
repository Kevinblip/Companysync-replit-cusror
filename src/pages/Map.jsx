import React, { useState, useEffect, useCallback, useMemo } from "react";
import useTranslation from "@/hooks/useTranslation";
import { isPlatformAdminCheck } from "@/hooks/usePlatformAdmin";
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
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
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
      ">
        ${count}
      </div>
    `,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
};

// Custom marker icons by type and status
const createMarkerIcon = (type, status, count = null) => {
  // If count is provided and greater than 1, create a cluster-style marker
  if (count && count > 1) {
    return createClusterIcon(count);
  }
  
  let color = '#3b82f6'; // default blue
  
  if (type === 'lead') {
    if (status === 'won') color = '#10b981'; // green
    else if (status === 'lost') color = '#ef4444'; // red
    else if (status === 'qualified') color = '#f59e0b'; // orange
    else if (status === 'contacted') color = '#8b5cf6'; // purple
    else color = '#3b82f6'; // blue for new
  } else if (type === 'customer') {
    color = '#10b981'; // green for customers
  } else if (type === 'company') {
    color = '#7c3aed'; // purple for companies
  }
  
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        background: ${color};
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
      "></div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};

export default function Map() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
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
    search: ''
  });
  const [mapItems, setMapItems] = useState([]);
  const [isLoadingCoordinates, setIsLoadingCoordinates] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0 }); // NEW state
  const [itemsWithoutAddress, setItemsWithoutAddress] = useState([]);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  // Fetch MORE companies for the map if we are admin
  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date", 200),
    initialData: [],
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles'],
    queryFn: () => base44.entities.StaffProfile.list(),
    initialData: [],
  });

  const myCompany = React.useMemo(() => {
    if (!user) return null;

    // 0. Check for impersonation
    const impersonatedId = sessionStorage.getItem('impersonating_company_id');
    if (impersonatedId) {
      const target = companies.find(c => c.id === impersonatedId);
      if (target) return target;
    }
    
    // 1. Try to find a company created by the current user
    const ownedCompanies = companies.filter(c => c.created_by === user.email);
    if (ownedCompanies.length > 0) {
      // Use oldest company (primary) to match Layout/Utilities logic
      return [...ownedCompanies].sort((a, b) => new Date(a.created_date) - new Date(b.created_date))[0];
    }
    
    // 2. If no company is owned, check if the user is a staff member of any company
    const staffProfile = staffProfiles.find(s => s.user_email === user.email);
    if (staffProfile?.company_id) {
      return companies.find(c => c.id === staffProfile.company_id);
    }
    
    return null;
  }, [user, companies, staffProfiles]);

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
      const byCompany = await base44.entities.Lead.filter({ company_id: myCompany.id }, '-created_date', 500);
      // Fallback: if company_id filter returns nothing, fetch all (company_id may not be set on older leads)
      if (byCompany.length === 0) {
        return await base44.entities.Lead.filter({}, '-created_date', 500);
      }
      return byCompany;
    },
    enabled: !!user && !!myCompany,
    initialData: [],
  });

  const { data: allCustomers = [] } = useQuery({
    queryKey: ['customers-map', myCompany?.id],
    queryFn: async () => {
      if (!myCompany?.id) return [];
      const byCompany = await base44.entities.Customer.filter({ company_id: myCompany.id }, '-created_date', 500);
      if (byCompany.length === 0) {
        return await base44.entities.Customer.filter({}, '-created_date', 500);
      }
      return byCompany;
    },
    enabled: !!user && !!myCompany,
    initialData: [],
  });

  const isAdmin = user?.is_administrator === true;
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

  const leads = useMemo(() => isAdmin 
    ? allLeads 
    : allLeads.filter(lead => 
        lead.assigned_to === user?.email || 
        (lead.assigned_to_users && lead.assigned_to_users.includes(user?.email))
      ), [isAdmin, allLeads, user?.email]);

  const customers = useMemo(() => isAdmin 
    ? allCustomers 
    : allCustomers.filter(customer => 
        customer.assigned_to === user?.email || 
        (customer.assigned_to_users && customer.assigned_to_users.includes(user?.email))
      ), [isAdmin, allCustomers, user?.email]);
  
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
        
        // NEW format: street + city (zip optional — geocoding works without it)
        const hasNewFormat = lead.street && lead.city;
        
        // OLD format: single 'address' field
        const hasOldFormat = lead.address && 
                             lead.address.trim().length > 0 && 
                             !lead.address.includes('@'); // Not an email
        
        if (!hasNewFormat && !hasOldFormat) return false;
        
        // Filter by status if selected
        if (currentLeadStatusesFilter.length > 0 && !currentLeadStatusesFilter.includes(lead.status)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (b.value || 0) - (a.value || 0)) // Sort by value DESC
      .slice(0, 100) // Limit to 100 leads max
      .map(lead => {
        // Try NEW format first, fallback to OLD format
        const fullAddress = lead.street && lead.city 
          ? [lead.street, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')
          : (lead.address || '');
        
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
          geocoding_key: fullAddress
        };
      });
  }, [leads, currentLeadStatusesFilter]);

  const processedCustomers = useMemo(() => {
    if (!customers || customers.length === 0) return [];
    
    return customers
      .filter(customer => {
        // Exclude explicitly deactivated customers (is_active: null/undefined = include)
        if (customer.is_active === false) return false;
        
        // NEW format: street + city (zip optional — geocoding works without it)
        const hasNewFormat = customer.street && customer.city;
        
        // OLD format: single 'address' field
        const hasOldFormat = customer.address && 
                             customer.address.trim().length > 0 && 
                             !customer.address.includes('@'); // Not an email
        
        if (!hasNewFormat && !hasOldFormat) return false;

        // Filter out system/internal records to avoid duplication with 'Subscriber' view
        // if (customer.name === 'CompanySync') return false; // User requested to see these
        
        return true;
      })
      .sort((a, b) => (b.total_revenue || 0) - (a.total_revenue || 0)) // Sort by revenue DESC
      .slice(0, 100) // Limit to 100 customers max
      .map(customer => {
        // Try NEW format first, fallback to OLD format
        let fullAddress = customer.street && customer.city
          ? [customer.street, customer.city, customer.state, customer.zip].filter(Boolean).join(', ')
          : (customer.address || '');

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
          total_revenue: customer.total_revenue,
          geocoding_key: fullAddress
        };
      });
  }, [customers]);

  // Geocode addresses using Backend Function (supports global addresses + fallback)
  const geocodeAddress = useCallback(async (address) => {
    if (!address) return null;
    
    // Try server function first
    try {
      const response = await base44.functions.invoke('geocodeAddress', { address });
      if (response.data && response.data.lat && response.data.lng) {
        return { lat: response.data.lat, lng: response.data.lng };
      }
    } catch (error) {
      console.warn('Server geocoding failed, trying Nominatim directly:', error.message);
    }

    // Direct Nominatim fallback (client-side, no server needed)
    try {
      const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
      const resp = await fetch(nominatimUrl, { headers: { 'User-Agent': 'CompanySync/1.0' } });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.length > 0) {
          return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        }
      }
    } catch (e) {
      console.error('Nominatim geocoding failed for', address, ':', e.message);
    }
    return null;
  }, []);

  useEffect(() => {
    const loadCoordinates = async () => {
      // Include companies if platform admin
      const allItems = [...processedCompanies, ...processedLeads, ...processedCustomers];
      
      if (allItems.length === 0) {
        setMapItems([]);
        setItemsWithoutAddress([]);
        setIsLoadingCoordinates(false);
        setLoadingProgress({ current: 0, total: 0 });
        return;
      }

      console.log('🗺️ Starting to geocode', allItems.length, 'locations');
      setIsLoadingCoordinates(true);
      setLoadingProgress({ current: 0, total: allItems.length });
      
      const items = [];
      const noAddress = [];
      
      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];
        setLoadingProgress({ current: i + 1, total: allItems.length });
        
        if (item.address) { // Check if address exists after filtering in memos
          const coords = await geocodeAddress(item.address);
          if (coords) {
            items.push({
              ...item,
              coordinates: coords
            });
          } else {
            noAddress.push({ type: item.type, name: item.name, reason: 'Could not geocode', address: item.address });
          }
        } else {
          noAddress.push({ type: item.type, name: item.name, reason: 'No address provided', address: 'N/A' });
        }
      }
      
      console.log('✅ Geocoding complete:', items.length, 'successful,', noAddress.length, 'failed');
      setMapItems(items);
      setItemsWithoutAddress(noAddress);
      setIsLoadingCoordinates(false);
    };
    
    if (user && (processedLeads.length > 0 || processedCustomers.length > 0 || processedCompanies.length > 0)) {
      loadCoordinates();
    } else if (user) { // If user exists but no processed items, clear map and errors
      setMapItems([]);
      setItemsWithoutAddress([]);
      setIsLoadingCoordinates(false);
      setLoadingProgress({ current: 0, total: 0 });
    }
  }, [processedLeads, processedCustomers, processedCompanies, user, geocodeAddress]);

  const filteredItems = mapItems.filter(item => {
    if (filters.type === 'companies' && item.type !== 'company') return false;
    if (filters.type === 'leads' && item.type !== 'lead') return false;
    if (filters.type === 'customers' && item.type !== 'customer') return false;
    
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

  const totalLeads = filteredItems.filter(i => i.type === 'lead').length;
  const totalCustomers = filteredItems.filter(i => i.type === 'customer').length;
  const newLeads = filteredItems.filter(i => i.type === 'lead' && i.status === 'new').length;
  const wonLeads = filteredItems.filter(i => i.type === 'lead' && i.status === 'won').length;

  const assignedStaff = [...new Set(
    mapItems.flatMap(i => [i.assigned_to, ...(i.assigned_to_users || [])])
      .filter(Boolean)
  )];

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
    <div className="p-4 md:p-6 space-y-4 bg-gray-50 min-h-screen">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-3xl font-bold text-gray-900">{t.sidebar.map}</h1>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            {totalLeads} {t.leads.title}
          </Badge>
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            {totalCustomers} {t.customers.title}
          </Badge>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-white border-blue-200 hover:shadow-md transition-shadow">
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

        <Card className="bg-white border-purple-200 hover:shadow-md transition-shadow">
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

        <Card className="bg-white border-green-200 hover:shadow-md transition-shadow">
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

        <Card className="bg-white border-green-200 hover:shadow-md transition-shadow">
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

      {/* 🔥 NEW: Rep Breakdown Card */}
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
                  className="p-3 bg-gradient-to-br from-indigo-50 to-blue-50 rounded-lg border border-indigo-200 hover:shadow-md transition-shadow"
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

      {/* 🔥 NEW: Personal Stats for Non-Admin */}
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

      {/* Service Area Selector */}
      <Card className="bg-white">
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
      <Card className="bg-white">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Filter className="w-5 h-5" />
              {t.common.filters}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilters({ type: 'all', status: 'all', assignedTo: 'all', search: '' })}
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
      <Card className="bg-white">
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
      {(processedLeads.length + processedCustomers.length) > 200 && (
        <Alert className="bg-orange-50 border-orange-200">
          <AlertDescription>
            ⚠️ <strong>Performance Optimization Active:</strong> Showing top {processedLeads.length} highest-value leads and {processedCustomers.length} top-revenue customers.
            Consider applying more specific filters for an optimal experience.
          </AlertDescription>
        </Alert>
      )}

      {/* Warning Banner */}
      {itemsWithoutAddress.length > 0 && (
        <Alert className="bg-yellow-50 border-yellow-200">
          <AlertDescription>
            <div className="flex flex-col gap-2">
              <div>
                ⚠️ <strong>{itemsWithoutAddress.length} items</strong> have invalid addresses or could not be geocoded and cannot be shown on the map.
              </div>
              
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

      {/* Map Container */}
      <Card className="bg-white overflow-hidden">
        <CardContent className="p-0">
          {isLoadingCoordinates ? (
            <div className="h-[600px] flex items-center justify-center bg-gray-50">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600 font-medium">{t.common.loading}</p>
                <p className="text-sm text-gray-500 mt-1">Geocoding {loadingProgress.current} of {loadingProgress.total} locations</p>
              </div>
            </div>
          ) : (
            <div className="h-[600px] rounded-lg overflow-hidden relative">
              {filteredItems.length === 0 && (
                <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000] bg-white/90 backdrop-blur shadow-lg rounded-full px-6 py-2 border border-gray-200">
                  <p className="text-sm font-medium text-gray-600 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-gray-400" />
                    {t.common.noResults}
                  </p>
                </div>
              )}
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
                  const icon = createMarkerIcon(firstItem.type, firstItem.status || (firstItem.is_active ? 'active' : 'inactive'), count);
                  
                  return (
                    <Marker
                      key={coordKey}
                      position={[firstItem.coordinates.lat, firstItem.coordinates.lng]}
                      icon={icon}
                    >
                      <Popup maxWidth={300} className="custom-popup">
                        <div className="p-2 max-w-[300px]">
                          {count > 1 && (
                            <div className="mb-3 p-2 bg-purple-50 rounded-lg border border-purple-200">
                              <p className="text-sm font-semibold text-purple-900">
                                📍 {count} {t.common.all.toLowerCase()} at this {t.common.address.toLowerCase()}
                              </p>
                            </div>
                          )}
                          
                          {items.map((item, idx) => (
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
                              
                            <Button
                              size="sm"
                              className="w-full mt-3 bg-blue-600 hover:bg-blue-700 text-xs"
                              onClick={() => {
                                if (item.type === 'company') {
                                  // Impersonate or view company details
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
                            </div>
                          ))}
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}
              </MapContainer>
            </div>
          )}
        </CardContent>
      </Card>

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
  );
}