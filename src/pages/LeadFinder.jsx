import React, { useState, useEffect, useMemo, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { getLastUsedCompanyId } from "@/lib/activeCompanySelection";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search, MapPin, Building2, Phone, Mail, Plus, CheckCircle,
  ExternalLink, Loader2, Zap, CloudLightning, Info, Upload,
  List, Map as MapIcon, Navigation, Trash2, Pencil, X, CalendarDays, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Fix default leaflet icon paths broken by bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

// Patterns that indicate a non-residential (LLC, trust, business) owner name.
const BUSINESS_OWNER_PATTERNS = [
  /\bLLC\b/i,
  /\bINC\b/i,
  /\bCORP\b/i,
  /\bTRUST\b/i,
  /\bCOMPANY\b/i,
  /\bRENTAL\b/i,
  /\bRENTALS\b/i,
  /\bPROPERTIES\b/i,
  /\bPROPERTY\b/i,
  /\bINVESTMENT\b/i,
  /\bINVESTMENTS\b/i,
  /\bHOLDINGS\b/i,
  /\bENTERPRISES\b/i,
  /\bGROUP\b/i,
  /\bASSOCIATES\b/i,
  /\bL\.L\.C\b/i,
  /\bL\.P\.\b/i,
  /\bLP\b/i,
  /\bREALTY\b/i,
  /\bMANAGEMENT\b/i,
];

const isBusinessOwner = (name) => {
  if (!name) return false;
  return BUSINESS_OWNER_PATTERNS.some((re) => re.test(name));
};

const SOURCE_CONFIG = {
  imported: { label: "Imported", color: "bg-blue-100 text-blue-800 border-blue-200" },
  batchleads: { label: "BatchLeads", color: "bg-purple-100 text-purple-800 border-purple-200" },
  propstream: { label: "PropStream", color: "bg-green-100 text-green-800 border-green-200" },
};

const SEVERITY_EMOJI = { extreme: "🌪️", severe: "⛈️", moderate: "🌧️", minor: "💨" };

// Build storm pin icon (orange) vs normal pin (blue)
function makePin(color) {
  return L.divIcon({
    className: "",
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">
      <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24S24 21 24 12C24 5.373 18.627 0 12 0z" fill="${color}" stroke="white" stroke-width="1.5"/>
      <circle cx="12" cy="12" r="5" fill="white" opacity="0.9"/>
    </svg>`,
    iconSize: [24, 36],
    iconAnchor: [12, 36],
    popupAnchor: [0, -36],
  });
}
const pinBlue = makePin("#2563eb");
const pinOrange = makePin("#ea580c");
const pinSelected = makePin("#16a34a");

// Helper to extract lat/lng from a result
function getLatLng(result) {
  // Prefer top-level lat/lng returned by searchPropertyLeads, fall back to JSONB osm fields
  const lat = parseFloat(result.lat ?? result.data?.osm_lat ?? "");
  const lng = parseFloat(result.lng ?? result.data?.osm_lng ?? "");
  if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) return [lat, lng];
  return null;
}

// Fly to bounds when results change
function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [32, 32] });
    }
  }, [points.map((p) => p.join(",")).join("|")]); // eslint-disable-line
  return null;
}

export default function LeadFinder() {
  const [user, setUser] = useState(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("search"); // "search" | "lists"

  // ── Search tab state ──────────────────────────────────────────────────────
  const [location, setLocation] = useState(() => searchParams.get("location") || "");
  const [radius, setRadius] = useState(10);
  const [propertyType, setPropertyType] = useState("all");
  const [residentialOnly, setResidentialOnly] = useState(false);
  const [searched, setSearched] = useState(false);
  const [addingIds, setAddingIds] = useState(new Set());
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  // When a list is loaded into the results panel, we track it here
  const [activeListName, setActiveListName] = useState(null);

  const queryClient = useQueryClient();

  // View mode: "list" | "map"
  const [viewMode, setViewMode] = useState("list");
  // For map: highlighted result id (clicked pin → scroll list card)
  const [highlightedId, setHighlightedId] = useState(null);
  // For map: selected ids to hand to Route Planner
  const [selectedMapIds, setSelectedMapIds] = useState(new Set());
  const cardRefs = useRef({});

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ["companies"],
    queryFn: () => base44.entities.Company.list("-created_at"),
    enabled: !!user,
  });

  const myCompany = useMemo(() => {
    if (!user) return null;
    const impId = sessionStorage.getItem("impersonating_company_id");
    if (impId) return companies.find((c) => c.id === impId) || null;
    const lastId = getLastUsedCompanyId(user.email);
    if (lastId) { const f = companies.find((c) => c.id === lastId); if (f) return f; }
    const platformCompany = companies.find((c) => c.id === 'companysync_master_001');
    if (platformCompany) return platformCompany;
    return companies.find((c) => c.created_by === user?.email) || companies[0] || null;
  }, [user, companies]);

  const companyId = myCompany?.id;

  // ── Search logic ──────────────────────────────────────────────────────────
  const handleSearch = async () => {
    if (!location.trim()) { toast.error("Enter a city or ZIP code"); return; }
    if (!companyId) { toast.error("No company found"); return; }
    setSearching(true);
    setSearchError(null);
    setSearched(true);
    setHighlightedId(null);
    setSelectedMapIds(new Set());
    setActiveListName(null);
    try {
      const res = await base44.functions.invoke("searchPropertyLeads", {
        location: location.trim(),
        radiusMiles: Number(radius),
        propertyType,
        companyId,
      });
      if (res?.error) throw new Error(res.error);
      setSearchResults(res?.data || res);
    } catch (e) {
      setSearchError(e.message || "Search failed");
      setSearchResults(null);
    } finally {
      setSearching(false);
    }
  };

  // Load a prospect list's addresses into the results panel
  const handleOpenList = async (listId, listName) => {
    if (!companyId) return;
    setActiveTab("search");
    setSearching(true);
    setSearchError(null);
    setSearched(true);
    setActiveListName(listName);
    setSearchResults(null);
    try {
      const res = await base44.functions.invoke("getProspectListDetail", { listId, companyId });
      if (res?.error) throw new Error(res.error);
      const data = res?.data || res;
      // Shape to match searchPropertyLeads response so ResultCard works unchanged
      setSearchResults({ results: data.results || [], _listMode: true });
    } catch (e) {
      setSearchError(e.message || "Failed to load list");
    } finally {
      setSearching(false);
    }
  };

  const addToCrm = async (result) => {
    if (!companyId) return;
    const id = result.id;
    setAddingIds((prev) => new Set(prev).add(id));
    try {
      await base44.entities.Lead.create({
        name: result.name,
        phone: result.phone || undefined,
        email: result.email || undefined,
        street: result.street || undefined,
        city: result.city || undefined,
        state: result.state || undefined,
        zip: result.zip || undefined,
        company_id: companyId,
        source: result.source === "imported" ? "property_data" : result.source,
        lead_source: result.source,
        status: "new",
      });
      toast.success(`${result.name} added to CRM`);
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      setSearchResults((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          results: prev.results.map((r) =>
            r.id === id ? { ...r, already_in_crm: true } : r
          ),
        };
      });
    } catch (e) {
      toast.error("Failed to add: " + (e.message || e));
    } finally {
      setAddingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const allResults = searchResults?.results || [];
  const results = useMemo(
    () => residentialOnly ? allResults.filter((r) => !isBusinessOwner(r.name)) : allResults,
    [allResults, residentialOnly]
  );
  const hasBatchleads = searchResults?.has_batchleads;
  const hasPropstream = searchResults?.has_propstream;
  const blError = searchResults?.batchleads_error;
  const psError = searchResults?.propstream_error;
  const areaRecordCount = searchResults?.area_record_count ?? null;

  // Results that have coordinates
  const mappableResults = useMemo(
    () => results.filter((r) => getLatLng(r) !== null),
    [results]
  );

  const handlePinClick = (result) => {
    // Just highlight — don't switch view; popup stays open on the map
    setHighlightedId(result.id);
  };

  const handleViewInList = (result) => {
    setHighlightedId(result.id);
    setViewMode("list");
    setTimeout(() => {
      cardRefs.current[result.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  };

  const toggleMapSelect = (id) => {
    setSelectedMapIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const handleRouteSelected = () => {
    const toRoute = mappableResults.filter((r) => selectedMapIds.has(r.id));
    if (toRoute.length === 0) {
      toast.error("Select at least one pin first");
      return;
    }
    const addresses = toRoute.map((r) => ({
      id: r.id,
      name: r.name,
      address: r.address || [r.street, r.city, r.state].filter(Boolean).join(", "),
      street: r.street || r.address,
      city: r.city,
      state: r.state,
      zip: r.zip,
      lat: getLatLng(r)?.[0],
      lng: getLatLng(r)?.[1],
      data: r.data,
    }));
    sessionStorage.setItem(
      "stormRouteAddresses",
      JSON.stringify({ title: `Lead Finder — ${location}`, mode: "canvass", addresses })
    );
    navigate("/InspectionRouting");
  };

  // Show the map toggle only when there are mappable results
  const showMapToggle = results.length > 0 && mappableResults.length > 0;

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <Search className="w-8 h-8 text-blue-600" />
          Lead Finder
        </h1>
        <p className="text-gray-500 mt-1">
          Search your imported property data for potential customers — storm-hit addresses rise to the top.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200">
        <TabButton active={activeTab === "search"} onClick={() => setActiveTab("search")}>
          <Search className="w-4 h-4 mr-2" /> Search
        </TabButton>
        <TabButton active={activeTab === "lists"} onClick={() => setActiveTab("lists")}>
          <List className="w-4 h-4 mr-2" /> My Prospect Lists
        </TabButton>
      </div>

      {/* ── SEARCH TAB ─────────────────────────────────────────────────────── */}
      {activeTab === "search" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Search Criteria</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Location (City or ZIP Code)</Label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="e.g. Maple Heights or 44137"
                    className="pl-10"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Search Radius (miles)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={radius}
                    onChange={(e) => setRadius(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Property Type</Label>
                  <select
                    className="w-full border rounded-md p-2"
                    value={propertyType}
                    onChange={(e) => setPropertyType(e.target.value)}
                  >
                    <option value="all">All Properties</option>
                    <option value="Residential">Residential</option>
                    <option value="Commercial">Commercial</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="residential-only"
                  checked={residentialOnly}
                  onCheckedChange={(v) => setResidentialOnly(!!v)}
                />
                <label htmlFor="residential-only" className="text-sm text-gray-700 cursor-pointer select-none">
                  Residential owners only (hide LLCs, trusts &amp; businesses)
                </label>
              </div>

              <Button
                className="w-full bg-blue-600 hover:bg-blue-700"
                onClick={handleSearch}
                disabled={searching}
              >
                {searching ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Searching…</>
                ) : (
                  <><Search className="w-4 h-4 mr-2" /> Find Leads</>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* API key warnings */}
          {searched && searchResults && (blError || psError) && (
            <Alert className="border-amber-200 bg-amber-50">
              <Info className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-800 text-sm space-y-1">
                {blError && <div><strong>BatchLeads error:</strong> {blError}</div>}
                {psError && <div><strong>PropStream error:</strong> {psError}</div>}
              </AlertDescription>
            </Alert>
          )}

          {/* Results */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle>
                  {activeListName ? (
                    <span className="flex items-center gap-2">
                      <List className="w-5 h-5 text-blue-600" />
                      {activeListName}
                    </span>
                  ) : "Search Results"}
                </CardTitle>
                <div className="flex items-center gap-3 flex-wrap">
                  {searched && !activeListName && areaRecordCount !== null && (
                    <span className="text-xs text-gray-400">
                      {areaRecordCount.toLocaleString()} imported record{areaRecordCount === 1 ? "" : "s"} in {location}
                    </span>
                  )}
                  {allResults.length > 0 && (
                    <span className="text-sm text-gray-500">
                      {residentialOnly && results.length < allResults.length
                        ? `${results.length} of ${allResults.length} propert${allResults.length === 1 ? "y" : "ies"} (${allResults.length - results.length} business-owned hidden)`
                        : `${results.length} propert${results.length === 1 ? "y" : "ies"} found`}
                    </span>
                  )}
                  {showMapToggle && (
                    <div className="flex rounded-md border overflow-hidden">
                      <button
                        className={`px-3 py-1.5 text-xs flex items-center gap-1 transition-colors ${
                          viewMode === "list"
                            ? "bg-blue-600 text-white"
                            : "bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                        onClick={() => setViewMode("list")}
                      >
                        <List className="w-3.5 h-3.5" /> List
                      </button>
                      <button
                        className={`px-3 py-1.5 text-xs flex items-center gap-1 transition-colors border-l ${
                          viewMode === "map"
                            ? "bg-blue-600 text-white"
                            : "bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                        onClick={() => setViewMode("map")}
                      >
                        <MapIcon className="w-3.5 h-3.5" /> Map
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!searched && (
                <div className="text-center py-12 text-gray-500">
                  <Building2 className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <p>No results yet</p>
                  <p className="text-sm mt-1">Enter a city or ZIP to search your imported property data</p>
                </div>
              )}

              {searched && searchError && (
                <div className="text-center py-10 text-red-500">
                  <p className="font-medium">Search failed</p>
                  <p className="text-sm mt-1">{searchError}</p>
                </div>
              )}

              {searched && !searching && !searchError && results.length === 0 && !activeListName && (
                <NoResultsHelp location={location} hasBatchleads={hasBatchleads} hasPropstream={hasPropstream} areaRecordCount={areaRecordCount} />
              )}

              {searched && !searching && !searchError && results.length === 0 && activeListName && (
                <div className="text-center py-12 text-gray-500">
                  <List className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>This list has no prospects.</p>
                </div>
              )}

              {results.length > 0 && viewMode === "map" && (
                <StormLeadMap
                  results={mappableResults}
                  highlightedId={highlightedId}
                  selectedIds={selectedMapIds}
                  onPinClick={handlePinClick}
                  onViewInList={handleViewInList}
                  onToggleSelect={toggleMapSelect}
                  onRouteSelected={handleRouteSelected}
                  onAddToCrm={addToCrm}
                  addingIds={addingIds}
                />
              )}

              {results.length > 0 && viewMode === "list" && (
                <div className="space-y-3">
                  {results.map((result) => (
                    <div
                      key={result.id}
                      ref={(el) => { cardRefs.current[result.id] = el; }}
                    >
                      <ResultCard
                        result={result}
                        onAdd={addToCrm}
                        adding={addingIds.has(result.id)}
                        highlighted={highlightedId === result.id}
                        onClearHighlight={() => setHighlightedId(null)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ── MY PROSPECT LISTS TAB ──────────────────────────────────────────── */}
      {activeTab === "lists" && (
        <ProspectListsPanel companyId={companyId} onOpenList={handleOpenList} />
      )}
    </div>
  );
}

// ── Map view ──────────────────────────────────────────────────────────────────

function StormLeadMap({ results, highlightedId, selectedIds, onPinClick, onViewInList, onToggleSelect, onRouteSelected, onAddToCrm, addingIds }) {
  const points = results.map((r) => getLatLng(r)).filter(Boolean);
  const center = points.length > 0 ? points[0] : [39.5, -98.35];

  return (
    <div className="space-y-3">
      {/* Selection bar */}
      {results.length > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-600 flex-wrap gap-2">
          <span>
            {results.length} pin{results.length !== 1 ? "s" : ""} with coordinates
            {selectedIds.size > 0 && (
              <span className="ml-2 font-medium text-green-700">· {selectedIds.size} selected</span>
            )}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7"
              onClick={() => {
                // toggle all: if all selected → deselect all, else select all
                if (selectedIds.size === results.length) {
                  results.forEach((r) => onToggleSelect(r.id));
                } else {
                  results.filter((r) => !selectedIds.has(r.id)).forEach((r) => onToggleSelect(r.id));
                }
              }}
            >
              {selectedIds.size === results.length ? "Deselect all" : "Select all"}
            </Button>
            <Button
              size="sm"
              className="text-xs h-7 bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1"
              onClick={onRouteSelected}
              disabled={selectedIds.size === 0}
            >
              <Navigation className="w-3 h-3" />
              Route {selectedIds.size > 0 ? `${selectedIds.size} selected` : "selected"}
            </Button>
          </div>
        </div>
      )}

      {/* Map */}
      <div className="rounded-lg overflow-hidden border" style={{ height: 420 }}>
        <MapContainer
          center={center}
          zoom={12}
          style={{ width: "100%", height: "100%" }}
          scrollWheelZoom={true}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          <FitBounds points={points} />
          {results.map((result) => {
            const ll = getLatLng(result);
            if (!ll) return null;
            const isSelected = selectedIds.has(result.id);
            const isHighlighted = highlightedId === result.id;
            const isStorm = (result.storm_score || 0) >= 20;
            const icon = isSelected ? pinSelected : isStorm ? pinOrange : pinBlue;
            return (
              <Marker
                key={result.id}
                position={ll}
                icon={icon}
                eventHandlers={{
                  click: () => onPinClick(result),
                }}
              >
                <Popup minWidth={220}>
                  <MapPopup
                    result={result}
                    isSelected={isSelected}
                    onToggleSelect={() => onToggleSelect(result.id)}
                    onViewInList={() => onViewInList(result)}
                    onAddToCrm={() => onAddToCrm(result)}
                    adding={addingIds.has(result.id)}
                  />
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-blue-600" /> Normal lead
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-orange-600" /> Storm area
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-green-600" /> Selected for routing
        </span>
        <span className="text-gray-400">· Click a pin to see details · Click again to select for routing</span>
      </div>
    </div>
  );
}

function MapPopup({ result, isSelected, onToggleSelect, onViewInList, onAddToCrm, adding }) {
  const storm = result.nearest_storm;
  const stormScore = result.storm_score || 0;
  return (
    <div className="text-sm space-y-1.5 min-w-[200px]">
      <p className="font-semibold text-gray-900 leading-tight">{result.name}</p>
      {result.address && (
        <p className="text-gray-600 text-xs leading-tight">{result.address}</p>
      )}
      {stormScore >= 20 && storm && (
        <p className="text-orange-700 text-xs">
          {SEVERITY_EMOJI[storm.severity] || "⚡"} {storm.severity} storm{storm.distance_miles ? ` · ${storm.distance_miles} mi` : ""}
        </p>
      )}
      <div className="flex gap-1.5 pt-1 flex-wrap">
        <button
          className={`px-2 py-1 text-xs rounded border font-medium transition-colors ${
            isSelected
              ? "bg-green-100 text-green-700 border-green-300"
              : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200"
          }`}
          onClick={onToggleSelect}
        >
          {isSelected ? "✓ Selected" : "Select for route"}
        </button>
        {!result.already_in_crm && (
          <button
            className="px-2 py-1 text-xs rounded border font-medium bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100 disabled:opacity-50"
            onClick={onAddToCrm}
            disabled={adding}
          >
            {adding ? "Adding…" : "+ Add to CRM"}
          </button>
        )}
        {result.already_in_crm && (
          <span className="px-2 py-1 text-xs text-green-700 font-medium">✓ In CRM</span>
        )}
        <button
          className="px-2 py-1 text-xs rounded border font-medium bg-gray-50 text-gray-600 border-gray-300 hover:bg-gray-100"
          onClick={onViewInList}
        >
          View in list
        </button>
      </div>
    </div>
  );
}

// ── Tab button helper ─────────────────────────────────────────────────────────
function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-blue-600 text-blue-600"
          : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
      }`}
    >
      {children}
    </button>
  );
}

// ── My Prospect Lists panel ───────────────────────────────────────────────────
function ProspectListsPanel({ companyId, onOpenList }) {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["prospect-lists", companyId],
    queryFn: async () => {
      const res = await base44.functions.invoke("getProspectLists", { companyId });
      if (res?.error) throw new Error(res.error);
      return (res?.data || res)?.lists || [];
    },
    enabled: !!companyId,
  });

  const lists = data || [];

  const handleDelete = async (list) => {
    if (!window.confirm(`Delete "${list.name}"? This cannot be undone.`)) return;
    setDeletingId(list.id);
    try {
      const res = await base44.functions.invoke("deleteProspectList", { listId: list.id, companyId });
      if (res?.error) throw new Error(res.error);
      toast.success(`"${list.name}" deleted`);
      queryClient.invalidateQueries({ queryKey: ["prospect-lists"] });
    } catch (e) {
      toast.error("Delete failed: " + (e.message || e));
    } finally {
      setDeletingId(null);
    }
  };

  const startRename = (list) => {
    setRenamingId(list.id);
    setRenameValue(list.name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  const handleRename = async (listId) => {
    if (!renameValue.trim()) return;
    setSavingRename(true);
    try {
      const res = await base44.functions.invoke("renameProspectList", { listId, companyId, name: renameValue.trim() });
      if (res?.error) throw new Error(res.error);
      toast.success("List renamed");
      queryClient.invalidateQueries({ queryKey: ["prospect-lists"] });
      setRenamingId(null);
    } catch (e) {
      toast.error("Rename failed: " + (e.message || e));
    } finally {
      setSavingRename(false);
    }
  };

  if (!companyId) {
    return (
      <div className="text-center py-16 text-gray-500">
        <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-gray-300" />
        <p>Loading…</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="text-center py-16 text-gray-500">
        <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-gray-300" />
        <p>Loading your prospect lists…</p>
      </div>
    );
  }

  if (error) {
    return (
      <Alert className="border-red-200 bg-red-50">
        <Info className="w-4 h-4 text-red-600" />
        <AlertDescription className="text-red-800">
          Failed to load lists: {error.message}
        </AlertDescription>
      </Alert>
    );
  }

  if (lists.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <List className="w-16 h-16 mx-auto mb-4 text-gray-300" />
        <p className="font-medium">No prospect lists yet</p>
        <p className="text-sm mt-1 max-w-sm mx-auto">
          Import a county CSV on the{" "}
          <a href="/PropertyDataImporter" className="text-blue-600 underline">Property Data Importer</a>{" "}
          page, or save addresses from Storm Tracking. Your lists will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        {lists.length} saved list{lists.length !== 1 ? "s" : ""} — click any list to browse its addresses in the Search tab.
      </p>

      {lists.map((list) => (
        <Card key={list.id} className="hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              {/* List icon */}
              <div className="shrink-0 mt-0.5">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <List className="w-5 h-5 text-blue-600" />
                </div>
              </div>

              {/* Details */}
              <div className="flex-1 min-w-0">
                {renamingId === list.id ? (
                  <div className="flex items-center gap-2 mb-1">
                    <Input
                      className="h-8 text-sm"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(list.id);
                        if (e.key === "Escape") cancelRename();
                      }}
                      autoFocus
                    />
                    <Button
                      size="sm"
                      className="h-8 px-3 bg-blue-600 hover:bg-blue-700 text-white shrink-0"
                      onClick={() => handleRename(list.id)}
                      disabled={savingRename || !renameValue.trim()}
                    >
                      {savingRename ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 px-2 shrink-0" onClick={cancelRename}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <p className="font-semibold text-gray-900 truncate">{list.name}</p>
                )}

                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  <span className="text-sm text-gray-600 flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-gray-400" />
                    {list.address_count} address{list.address_count !== 1 ? "es" : ""}
                  </span>

                  {list.created_at && (
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <CalendarDays className="w-3 h-3" />
                      {new Date(list.created_at).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", year: "numeric",
                      })}
                    </span>
                  )}

                  {list.source === "storm_tracker_enriched" && (
                    <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200">
                      <CloudLightning className="w-3 h-3 mr-1" /> Storm
                    </Badge>
                  )}
                </div>

                {list.storm_context && (
                  <p className="text-xs text-orange-700 mt-1 flex items-center gap-1">
                    <CloudLightning className="w-3 h-3 shrink-0" />
                    {list.storm_context}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="shrink-0 flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-gray-400 hover:text-gray-700"
                  title="Rename list"
                  onClick={() => startRename(list)}
                  disabled={renamingId === list.id}
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                  title="Delete list"
                  onClick={() => handleDelete(list)}
                  disabled={deletingId === list.id}
                >
                  {deletingId === list.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </Button>
                <Button
                  size="sm"
                  className="ml-1 bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => onOpenList(list.id, list.name)}
                >
                  View <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── List view ─────────────────────────────────────────────────────────────────

function ResultCard({ result, onAdd, adding, highlighted, onClearHighlight }) {
  const sourceConf = SOURCE_CONFIG[result.source] || SOURCE_CONFIG.imported;
  const storm = result.nearest_storm;
  const stormScore = result.storm_score || 0;

  return (
    <div
      className={`flex items-start gap-3 p-4 border rounded-lg hover:bg-gray-50 transition-colors ${
        highlighted ? "border-blue-400 bg-blue-50 ring-2 ring-blue-300" : ""
      }`}
      onClick={highlighted ? onClearHighlight : undefined}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-900 truncate">{result.name}</span>
          <Badge variant="outline" className={`text-xs shrink-0 ${sourceConf.color}`}>
            {sourceConf.label}
          </Badge>
          {stormScore >= 20 && (
            <Badge variant="outline" className="text-xs shrink-0 bg-orange-50 text-orange-700 border-orange-200">
              <CloudLightning className="w-3 h-3 mr-1" />
              Storm area
            </Badge>
          )}
        </div>

        {result.address && (
          <p className="text-sm text-gray-600 mt-1 flex items-center gap-1">
            <MapPin className="w-3 h-3 shrink-0" />
            {result.address}
          </p>
        )}

        <div className="flex items-center gap-4 mt-1 flex-wrap">
          {result.phone && (
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <Phone className="w-3 h-3" /> {result.phone}
            </span>
          )}
          {result.email && (
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <Mail className="w-3 h-3" /> {result.email}
            </span>
          )}
        </div>

        {storm && (
          <p className="text-xs text-orange-700 mt-1">
            {SEVERITY_EMOJI[storm.severity] || "⚡"} {storm.severity} {storm.event_type?.replace("_", " ")} {storm.distance_miles ? `${storm.distance_miles} mi away` : ""} {storm.date ? `on ${storm.date}` : ""}
          </p>
        )}
      </div>

      <div className="shrink-0">
        {result.already_in_crm ? (
          <span className="flex items-center gap-1 text-xs text-green-700 font-medium">
            <CheckCircle className="w-4 h-4" /> In CRM
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="text-blue-600 border-blue-200 hover:bg-blue-50"
            onClick={() => onAdd(result)}
            disabled={adding}
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-3 h-3 mr-1" /> Add</>}
          </Button>
        )}
      </div>
    </div>
  );
}

function NoResultsHelp({ location, hasBatchleads, hasPropstream, areaRecordCount }) {
  const countPhrase = areaRecordCount !== null
    ? `among ${areaRecordCount.toLocaleString()} imported record${areaRecordCount === 1 ? "" : "s"}`
    : null;

  return (
    <div className="space-y-4 py-4">
      <div className="text-center text-gray-500 pb-2">
        <Building2 className="w-12 h-12 mx-auto mb-3 text-gray-300" />
        <p className="font-medium">No properties found for "{location}"</p>
        <p className="text-sm mt-1">
          {hasBatchleads || hasPropstream
            ? "No results from your connected data sources for this location."
            : countPhrase
              ? `No matches ${countPhrase} — try broadening your search or import more county data.`
              : "No imported data matches this location yet."}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Free path */}
        <div className="border rounded-lg p-4 bg-blue-50 border-blue-200">
          <div className="flex items-center gap-2 mb-2">
            <Upload className="w-4 h-4 text-blue-600" />
            <span className="font-semibold text-blue-900 text-sm">Free — County Records</span>
          </div>
          <p className="text-xs text-blue-800 mb-3">
            Download property owner CSVs from your county auditor's website (100% free public data), then import them here.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="text-blue-700 border-blue-300 w-full"
            onClick={() => window.location.href = "/PropertyDataImporter"}
          >
            <ExternalLink className="w-3 h-3 mr-1" /> Go to Property Data Importer
          </Button>
        </div>

        {/* Paid path */}
        <div className="border rounded-lg p-4 bg-purple-50 border-purple-200">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-purple-600" />
            <span className="font-semibold text-purple-900 text-sm">Paid — Live Property Data</span>
          </div>
          <p className="text-xs text-purple-800 mb-3">
            Connect BatchLeads or PropStream for real-time owner names, addresses, and phone numbers — no manual CSV required.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="text-purple-700 border-purple-300 w-full"
            onClick={() => window.location.href = "/APIKeysSettings"}
          >
            <ExternalLink className="w-3 h-3 mr-1" /> Add API Key in Settings
          </Button>
        </div>
      </div>
    </div>
  );
}
