import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MapPin,
  Loader2,
  Calendar,
  Navigation,
  CheckCircle,
  Clock,
  X,
  Radio,
} from "lucide-react";
import { format, isToday, isTomorrow } from "date-fns";
import { toast } from "react-hot-toast";

// Fix Leaflet default icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

// Color constants
const COLORS = {
  scheduled: "#10b981", // green
  inProgress: "#3b82f6", // blue
  unscheduled: "#f97316", // orange
  selected: "#7c3aed", // purple for clicked inspection
  nearby: "#ef4444", // red for highlighted nearby
};

function makeIcon(color, size = 30, selected = false) {
  const ring = selected ? `box-shadow:0 0 0 3px white,0 0 0 5px ${color};` : "";
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;
      border-radius:50%;
      background:${color};
      border:3px solid white;
      box-shadow:0 3px 10px rgba(0,0,0,0.35);
      ${ring}
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
  });
}

function getColor(inspection) {
  if (inspection.status === "draft" || !inspection.inspection_date) return COLORS.unscheduled;
  if (inspection.status === "in_progress") return COLORS.inProgress;
  return COLORS.scheduled;
}

function formatDateLabel(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr + "T00:00:00");
    if (isToday(d)) return "Today";
    if (isTomorrow(d)) return "Tomorrow";
    return format(d, "MMM d, yyyy");
  } catch {
    return dateStr;
  }
}

// Haversine distance in miles
function haversine(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Fly-to helper component
function FlyTo({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.flyTo(center, zoom, { duration: 0.8 });
  }, [center, zoom, map]);
  return null;
}

const RADIUS_OPTIONS = [5, 10, 15, 25];

export default function InspectionMapView({ inspections, onUpdateDates, isUpdating }) {
  const geocacheRef = useRef({}); // address -> { lat, lng } | null
  const [geocoded, setGeocoded] = useState([]); // { inspection, lat, lng }
  const [geocodingProgress, setGeocodingProgress] = useState({ done: 0, total: 0 });
  const [isGeocoding, setIsGeocoding] = useState(false);

  const [selectedId, setSelectedId] = useState(null);
  const [nearbyRadius, setNearbyRadius] = useState(10); // miles
  const [selectedNearby, setSelectedNearby] = useState(new Set());
  const [scheduleDate, setScheduleDate] = useState("");
  const [mapFly, setMapFly] = useState(null);

  // Geocode all inspection addresses, caching in memory
  const geocodeAll = useCallback(async (items) => {
    if (!items.length) return;
    setIsGeocoding(true);
    setGeocodingProgress({ done: 0, total: items.length });

    const results = [];
    for (let i = 0; i < items.length; i++) {
      const insp = items[i];
      const addr = insp.property_address;

      if (!addr) {
        setGeocodingProgress({ done: i + 1, total: items.length });
        continue;
      }

      let coords = geocacheRef.current[addr];
      if (coords === undefined) {
        try {
          const resp = await base44.functions.invoke("geocodeAddress", { address: addr });
          coords = (typeof resp?.data?.lat === "number" && typeof resp?.data?.lng === "number")
            ? { lat: resp.data.lat, lng: resp.data.lng }
            : null;
        } catch {
          coords = null;
        }
        geocacheRef.current[addr] = coords;
      }

      if (coords) {
        results.push({ inspection: insp, lat: coords.lat, lng: coords.lng });
      }
      setGeocodingProgress({ done: i + 1, total: items.length });
    }

    setGeocoded(results);
    setIsGeocoding(false);
  }, []);

  useEffect(() => {
    if (inspections.length > 0) geocodeAll(inspections);
  }, [inspections, geocodeAll]);

  const selectedItem = useMemo(
    () => geocoded.find((g) => g.inspection.id === selectedId) || null,
    [geocoded, selectedId]
  );

  const nearbyItems = useMemo(() => {
    if (!selectedItem) return [];
    return geocoded
      .filter((g) => g.inspection.id !== selectedId)
      .map((g) => ({
        ...g,
        distance: haversine(selectedItem.lat, selectedItem.lng, g.lat, g.lng),
      }))
      .filter((g) => g.distance <= nearbyRadius)
      .sort((a, b) => a.distance - b.distance);
  }, [selectedItem, geocoded, selectedId, nearbyRadius]);

  const mapCenter = useMemo(() => {
    if (geocoded.length === 0) return [39.9612, -82.9988]; // Ohio fallback
    const lat = geocoded.reduce((s, g) => s + g.lat, 0) / geocoded.length;
    const lng = geocoded.reduce((s, g) => s + g.lng, 0) / geocoded.length;
    return [lat, lng];
  }, [geocoded]);

  const handleMarkerClick = (item) => {
    setSelectedId(item.inspection.id);
    setSelectedNearby(new Set());
    setScheduleDate("");
    setMapFly({ center: [item.lat, item.lng], zoom: 13 });
  };

  const toggleNearby = (id) => {
    setSelectedNearby((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAllNearby = () => {
    setSelectedNearby(new Set(nearbyItems.map((n) => n.inspection.id)));
  };

  const handleSchedule = async () => {
    if (!scheduleDate) {
      toast.error("Please pick a date first.");
      return;
    }
    const ids = [
      ...(selectedId ? [selectedId] : []),
      ...Array.from(selectedNearby),
    ];
    if (ids.length === 0) {
      toast.error("Select at least one inspection.");
      return;
    }
    await onUpdateDates(ids, scheduleDate);
    toast.success(
      `Scheduled ${ids.length} inspection${ids.length > 1 ? "s" : ""} for ${formatDateLabel(scheduleDate)}`
    );
    setSelectedNearby(new Set());
    setScheduleDate("");
  };

  const radiusMeters = nearbyRadius * 1609.34;

  return (
    <div className="flex flex-col gap-3">
      {/* Header info bar */}
      <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 flex items-start gap-3">
        <Navigation className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <p className="font-semibold text-purple-900">Inspection Map View</p>
          <p className="text-sm text-purple-700 mt-0.5">
            Click any pin to see the nearest jobs. Use the Nearby panel to batch-schedule them on the same day.
          </p>
        </div>
        {isGeocoding && (
          <div className="flex items-center gap-2 text-xs text-purple-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            Geocoding {geocodingProgress.done}/{geocodingProgress.total}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap text-xs text-gray-600">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full inline-block" style={{ background: COLORS.scheduled }} />
          Scheduled / Completed
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full inline-block" style={{ background: COLORS.inProgress }} />
          In Progress
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full inline-block" style={{ background: COLORS.unscheduled }} />
          Unscheduled
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full inline-block" style={{ background: COLORS.selected }} />
          Selected
        </div>
      </div>

      <div className="flex gap-3 h-[580px]">
        {/* Map */}
        <div className="flex-1 rounded-xl overflow-hidden border border-gray-200 shadow-sm min-w-0">
          {geocoded.length === 0 && !isGeocoding ? (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50">
              <MapPin className="w-12 h-12 text-gray-300 mb-3" />
              <p className="text-gray-500 font-medium">
                {inspections.length === 0
                  ? "No inspections to show"
                  : "Could not geocode any inspection addresses"}
              </p>
            </div>
          ) : (
            <MapContainer
              center={mapCenter}
              zoom={10}
              style={{ width: "100%", height: "100%" }}
              key={mapCenter.join(",")}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              />
              {mapFly && <FlyTo center={mapFly.center} zoom={mapFly.zoom} />}

              {geocoded.map((item) => {
                const isSelected = item.inspection.id === selectedId;
                const isNearby = nearbyItems.some((n) => n.inspection.id === item.inspection.id);
                const color = isSelected
                  ? COLORS.selected
                  : isNearby
                  ? COLORS.nearby
                  : getColor(item.inspection);
                const size = isSelected ? 36 : 28;

                return (
                  <Marker
                    key={item.inspection.id}
                    position={[item.lat, item.lng]}
                    icon={makeIcon(color, size, isSelected)}
                    eventHandlers={{ click: () => handleMarkerClick(item) }}
                    data-testid={`marker-inspection-${item.inspection.id}`}
                  >
                    <Popup>
                      <div className="min-w-[180px]">
                        <p className="font-semibold text-gray-900 text-sm">
                          {item.inspection.customer_name || "Unknown Customer"}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {item.inspection.property_address}
                        </p>
                        {item.inspection.inspection_date ? (
                          <p className="text-xs text-green-700 mt-1 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            {formatDateLabel(item.inspection.inspection_date)}
                          </p>
                        ) : (
                          <p className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            No date scheduled
                          </p>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                );
              })}

              {/* Radius circle around selected pin */}
              {selectedItem && (
                <Circle
                  center={[selectedItem.lat, selectedItem.lng]}
                  radius={radiusMeters}
                  pathOptions={{
                    color: COLORS.selected,
                    fillColor: COLORS.selected,
                    fillOpacity: 0.06,
                    weight: 1.5,
                    dashArray: "6 4",
                  }}
                />
              )}
            </MapContainer>
          )}
        </div>

        {/* Nearby panel */}
        <div className="w-80 flex-shrink-0 flex flex-col gap-2 overflow-hidden">
          {!selectedItem ? (
            <Card className="flex-1 flex items-center justify-center">
              <CardContent className="text-center py-10 px-4">
                <Radio className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                <p className="text-sm font-medium text-gray-500">Click a pin to see nearby jobs</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Selected inspection card */}
              <Card className="border-purple-200 bg-purple-50">
                <CardHeader className="pb-2 pt-3 px-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-sm font-semibold text-purple-900 truncate">
                        {selectedItem.inspection.customer_name || "Unknown Customer"}
                      </CardTitle>
                      <p className="text-xs text-purple-700 mt-0.5 truncate">
                        {selectedItem.inspection.property_address}
                      </p>
                      {selectedItem.inspection.inspection_date && (
                        <p className="text-xs text-purple-600 mt-1">
                          📅 {formatDateLabel(selectedItem.inspection.inspection_date)}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => { setSelectedId(null); setSelectedNearby(new Set()); }}
                      className="text-purple-400 hover:text-purple-600 flex-shrink-0"
                      data-testid="btn-close-nearby"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </CardHeader>
              </Card>

              {/* Radius toggle */}
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                {RADIUS_OPTIONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setNearbyRadius(r)}
                    className={`flex-1 py-1 text-xs font-medium rounded-md transition-colors ${
                      nearbyRadius === r
                        ? "bg-white text-purple-700 shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                    data-testid={`btn-radius-${r}`}
                  >
                    {r} mi
                  </button>
                ))}
              </div>

              {/* Nearby list */}
              <Card className="flex-1 overflow-hidden flex flex-col">
                <CardHeader className="pb-2 pt-3 px-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">
                      Nearby jobs
                      {nearbyItems.length > 0 && (
                        <span className="ml-1.5 text-xs font-normal text-gray-500">
                          ({nearbyItems.length} within {nearbyRadius} mi)
                        </span>
                      )}
                    </CardTitle>
                    {nearbyItems.length > 0 && (
                      <button
                        onClick={selectAllNearby}
                        className="text-xs text-blue-600 hover:underline"
                        data-testid="btn-select-all-nearby"
                      >
                        Select all
                      </button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
                  {nearbyItems.length === 0 ? (
                    <div className="text-center py-6">
                      <MapPin className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                      <p className="text-xs text-gray-500">No other inspections within {nearbyRadius} miles</p>
                    </div>
                  ) : (
                    nearbyItems.map((item) => {
                      const isChecked = selectedNearby.has(item.inspection.id);
                      const dateLabel = formatDateLabel(item.inspection.inspection_date);
                      return (
                        <label
                          key={item.inspection.id}
                          className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                            isChecked
                              ? "bg-blue-50 border-blue-200"
                              : "bg-white border-gray-200 hover:bg-gray-50"
                          }`}
                          data-testid={`nearby-row-${item.inspection.id}`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleNearby(item.inspection.id)}
                            className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 cursor-pointer"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-gray-900 truncate">
                              {item.inspection.customer_name || "Unknown"}
                            </p>
                            <p className="text-[11px] text-gray-500 truncate">
                              {item.inspection.property_address}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1">
                              <Badge
                                className={`text-[10px] px-1.5 py-0 h-4 border-0 ${
                                  dateLabel
                                    ? "bg-green-100 text-green-700"
                                    : "bg-orange-100 text-orange-700"
                                }`}
                              >
                                {dateLabel ? (
                                  <><CheckCircle className="w-2.5 h-2.5 mr-0.5" />{dateLabel}</>
                                ) : (
                                  <><Clock className="w-2.5 h-2.5 mr-0.5" />No date</>
                                )}
                              </Badge>
                              <span className="text-[11px] text-gray-400">
                                {item.distance.toFixed(1)} mi
                              </span>
                            </div>
                          </div>
                        </label>
                      );
                    })
                  )}
                </CardContent>
              </Card>

              {/* Schedule panel */}
              <Card className="border-gray-200">
                <CardContent className="px-3 py-3 space-y-2">
                  <p className="text-xs font-medium text-gray-700">
                    Schedule{" "}
                    {selectedNearby.size > 0
                      ? `this + ${selectedNearby.size} nearby`
                      : "selected inspection"}{" "}
                    together:
                  </p>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <input
                      type="date"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-md px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                      data-testid="input-schedule-date"
                    />
                  </div>
                  <Button
                    size="sm"
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white text-xs"
                    onClick={handleSchedule}
                    disabled={!scheduleDate || isUpdating}
                    data-testid="btn-schedule-with-nearby"
                  >
                    <Calendar className="w-3 h-3 mr-1" />
                    {isUpdating ? (
                      <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Scheduling...</>
                    ) : (
                      `Schedule ${1 + selectedNearby.size} Job${selectedNearby.size > 0 ? "s" : ""}`
                    )}
                  </Button>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
