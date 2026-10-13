import React, { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { BulkDeleteButton } from "@/components/BulkDeleteControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Route, Calendar, Search } from "lucide-react";
import { addMinutes, format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";
import { createPageUrl } from "@/utils";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";

// Fix Leaflet default icon paths (Vite asset hashing breaks them)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Helpers
function getLat(lead) {
  return parseFloat(lead.lat || lead.data?.lat || lead.data?.latitude || 0) || 0;
}
function getLng(lead) {
  return parseFloat(lead.lng || lead.lon || lead.data?.lng || lead.data?.longitude || 0) || 0;
}
function getAddress(lead) {
  return [
    lead.street || lead.address,
    lead.city || lead.data?.city,
    lead.state || lead.data?.state,
    lead.zip || lead.data?.zip,
  ].filter(Boolean).join(", ");
}
function getLeadName(lead) {
  return lead.name || lead.full_name || lead.first_name || "Unknown Lead";
}

// Greedy nearest-neighbor route optimizer
function optimizeRoute(leads) {
  const withCoords = leads.filter(l => getLat(l) !== 0 && getLng(l) !== 0);
  const withoutCoords = leads.filter(l => getLat(l) === 0 || getLng(l) === 0);
  if (withCoords.length <= 1) return leads;

  const remaining = [...withCoords];
  const route = [remaining.splice(0, 1)[0]];
  while (remaining.length > 0) {
    const last = route[route.length - 1];
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = Math.hypot(getLat(remaining[i]) - getLat(last), getLng(remaining[i]) - getLng(last));
      if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
    }
    route.push(remaining.splice(nearestIdx, 1)[0]);
  }
  return [...route, ...withoutCoords];
}

function makeMarkerIcon(selected, routeNumber) {
  const color = selected ? "#16a34a" : "#3b82f6";
  const label = selected && routeNumber != null
    ? `<span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(45deg);color:white;font-size:10px;font-weight:700;">${routeNumber}</span>`
    : "";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.35);">${label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
  });
}

function getSlotStart(scheduleDate, startTime, slotIndex, slotMinutes) {
  const [h, m] = startTime.split(":").map(Number);
  const base = new Date(scheduleDate + "T00:00:00");
  base.setHours(h, m, 0, 0);
  return addMinutes(base, slotIndex * slotMinutes);
}

const STATUS_PILL = {
  new: "bg-blue-100 text-blue-800 border-blue-200",
  contacted: "bg-purple-100 text-purple-800 border-purple-200",
  qualified: "bg-amber-100 text-amber-800 border-amber-200",
  scheduled: "bg-green-100 text-green-800 border-green-200",
};

export default function InspectionRouting() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });
  const { company } = useCurrentCompany(user);

  const [stormData, setStormData] = useState(null); // { title, mode, addresses[] } from sessionStorage
  const [selectedIds, setSelectedIds] = useState(new Set());
  // Keeps the first endpoint for Shift + click range selection.
  const selectionAnchorId = useRef(null);
  const [filterZip, setFilterZip] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [scheduleDate, setScheduleDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState("08:00");
  const [slotMinutes, setSlotMinutes] = useState(45);
  const [assignedRep, setAssignedRep] = useState("");
  const [isScheduling, setIsScheduling] = useState(false);
  const [isClearingEvents, setIsClearingEvents] = useState(false);
  const [clearFromDate, setClearFromDate] = useState(format(new Date(), "yyyy-MM-dd"));

  // Load storm addresses passed from Storm Tracker via sessionStorage
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('stormRouteAddresses');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.addresses?.length > 0) {
          setStormData(parsed);
          sessionStorage.removeItem('stormRouteAddresses');
        }
      }
    } catch {}
  }, []);

  const { data: allLeads = [], isLoading } = useQuery({
    queryKey: ["routing-leads", company?.id],
    queryFn: () =>
      company?.id
        ? base44.entities.Lead.filter(
            { company_id: company.id },
            "-created_date",
            500
          )
        : [],
    enabled: !!company?.id && !stormData,
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ["routing-staff", company?.id],
    queryFn: () =>
      company?.id
        ? base44.entities.StaffProfile.filter({ company_id: company.id, is_active: true })
        : [],
    enabled: !!company?.id,
  });

  // Load upcoming "Inspection — " route events so we can show a count + allow bulk delete
  const { data: scheduledRouteEvents = [], refetch: refetchRouteEvents } = useQuery({
    queryKey: ["route-inspection-events", company?.id],
    queryFn: () =>
      company?.id
        ? base44.entities.CalendarEvent.filter({ company_id: company.id }, "-start_time", 500)
        : [],
    enabled: !!company?.id,
    select: (all) => all.filter(e => (e.title || '').startsWith('Inspection — ')),
  });

  const handleClearRouteEvents = async () => {
    const toDelete = clearFromDate
      ? scheduledRouteEvents.filter(e => e.start_time && e.start_time >= clearFromDate)
      : scheduledRouteEvents;
    if (toDelete.length === 0) {
      toast({ title: "Nothing to delete", description: "No inspection route events found for that date range." });
      return;
    }
    if (!window.confirm(`Delete ${toDelete.length} scheduled inspection event${toDelete.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
      await base44.entities.CalendarEvent.bulkDelete(toDelete.map(event => event.id), { validateOnly: true });
    } catch (error) {
      toast({ title: 'Unable to delete events', description: error.message, variant: 'destructive' });
      return;
    }
    setIsClearingEvents(true);
    let deleted = 0, failed = 0;
    for (const ev of toDelete) {
      try {
        await base44.entities.CalendarEvent.bulkDelete([ev.id]);
        deleted++;
      } catch { failed++; }
    }
    await refetchRouteEvents();
    queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
    setIsClearingEvents(false);
    toast({
      title: `${deleted} event${deleted !== 1 ? 's' : ''} deleted`,
      description: failed > 0 ? `${failed} could not be removed.` : "Calendar cleared.",
      variant: failed > 0 ? "destructive" : "default",
    });
  };

  // In storm mode, use storm addresses instead of CRM leads
  const activeLeads = useMemo(() => {
    if (stormData) return stormData.addresses;
    return allLeads.filter(l => l.status !== "won" && l.status !== "lost");
  }, [allLeads, stormData]);

  const filteredLeads = useMemo(() => {
    return activeLeads.filter(lead => {
      const zip = lead.zip || lead.data?.zip || "";
      const city = (lead.city || lead.data?.city || "").toLowerCase();
      if (filterZip && !zip.startsWith(filterZip.trim())) return false;
      if (filterCity && !city.includes(filterCity.trim().toLowerCase())) return false;
      // status filter only applies in CRM mode
      if (!stormData && filterStatus !== "all" && lead.status !== filterStatus) return false;
      return true;
    });
  }, [activeLeads, filterZip, filterCity, filterStatus, stormData]);

  const geocodedLeads = useMemo(
    () => filteredLeads.filter(l => getLat(l) !== 0 && getLng(l) !== 0),
    [filteredLeads]
  );

  const selectedLeads = useMemo(
    () => filteredLeads.filter(l => selectedIds.has(l.id)),
    [filteredLeads, selectedIds]
  );

  const sortedRoute = useMemo(() => optimizeRoute(selectedLeads), [selectedLeads]);

  const mapCenter = useMemo(() => {
    if (geocodedLeads.length === 0) return [39.5, -98.35];
    const lat = geocodedLeads.reduce((s, l) => s + getLat(l), 0) / geocodedLeads.length;
    const lng = geocodedLeads.reduce((s, l) => s + getLng(l), 0) / geocodedLeads.length;
    return [lat, lng];
  }, [geocodedLeads]);

  const toggleLead = (id, { shiftKey = false } = {}) => {
    const anchorIndex = filteredLeads.findIndex(lead => lead.id === selectionAnchorId.current);
    const targetIndex = filteredLeads.findIndex(lead => lead.id === id);

    setSelectedIds(prev => {
      const next = new Set(prev);
      // Shift-click always adds the inclusive displayed-address range. Keeping
      // existing selections makes it possible to build several canvass blocks.
      if (shiftKey && anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = [anchorIndex, targetIndex].sort((a, b) => a - b);
        filteredLeads.slice(start, end + 1).forEach(lead => next.add(lead.id));
        return next;
      }
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    selectionAnchorId.current = id;
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredLeads.map(l => l.id)));
    selectionAnchorId.current = null;
  };
  const clearAll = () => {
    setSelectedIds(new Set());
    selectionAnchorId.current = null;
  };

  const totalHours = Math.round((sortedRoute.length * slotMinutes) / 6) / 10;

  const handleSchedule = async () => {
    if (sortedRoute.length === 0) {
      toast({ title: "Select at least one lead", variant: "destructive" });
      return;
    }
    setIsScheduling(true);
    let created = 0;
    let failed = 0;
    let reassigned = 0;
    let noStaff = 0;

    // Build an ordered list of reps to try: chosen rep first, then the rest
    const primaryEmail = assignedRep || user?.email;
    const primaryName =
      staffProfiles.find(sp => (sp.user_email || sp.email) === assignedRep)?.name ||
      primaryEmail;

    // All staff emails in round-robin order starting after the primary rep
    const allRepEmails = staffProfiles
      .map(sp => sp.user_email || sp.email)
      .filter(Boolean);
    // Ensure the primary rep is tried first, followed by others
    const primaryIdx = allRepEmails.indexOf(primaryEmail);
    const orderedReps = primaryIdx >= 0
      ? [primaryEmail, ...allRepEmails.slice(primaryIdx + 1), ...allRepEmails.slice(0, primaryIdx)]
      : [primaryEmail, ...allRepEmails];

    for (let i = 0; i < sortedRoute.length; i++) {
      const lead = sortedRoute[i];
      const slotStart = getSlotStart(scheduleDate, startTime, i, slotMinutes);
      const slotEnd = addMinutes(slotStart, slotMinutes);

      let scheduledForThisStop = false;
      let conflictCount = 0;
      let hardError = false;

      for (const repEmail of orderedReps) {
        const repName =
          staffProfiles.find(sp => (sp.user_email || sp.email) === repEmail)?.name ||
          repEmail;
        try {
          await base44.entities.CalendarEvent.create({
            title: `Inspection — ${getLeadName(lead)}`,
            start_time: slotStart.toISOString(),
            end_time: slotEnd.toISOString(),
            type: "appointment",
            description: `Roof inspection scheduled via Route Planner (stop ${i + 1} of ${sortedRoute.length}).\nAddress: ${getAddress(lead)}\nAssigned to: ${repName}`,
            address: getAddress(lead),
            lead_id: lead.id,
            company_id: company?.id,
            assigned_to: repEmail,
            color: "#3b82f6",
            status: "scheduled",
          });
          scheduledForThisStop = true;
          if (conflictCount === 0) {
            created++;
          } else {
            reassigned++;
          }
          break;
        } catch (e) {
          const msg = e?.message || "";
          const isConflict = msg.toLowerCase().includes("already booked") || msg.toLowerCase().includes("conflict") || String(e?.status) === "409";
          if (isConflict) {
            console.warn(`Route schedule conflict for lead ${lead.id} with rep ${repEmail} — trying next`);
            conflictCount++;
            // continue to next rep
          } else {
            console.error("Route schedule failed for lead", lead.id, e);
            hardError = true;
            failed++;
            break; // non-conflict error — don't retry other reps
          }
        }
      }

      if (!scheduledForThisStop && !hardError && conflictCount >= orderedReps.length) {
        // All reps were tried and all had conflicts for this slot
        noStaff++;
      }
    }

    queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
    setIsScheduling(false);

    const totalScheduled = created + reassigned;
    if (totalScheduled > 0) {
      const parts = [`${created} scheduled to ${primaryName}`];
      if (reassigned > 0) parts.push(`${reassigned} reassigned to other reps`);
      if (noStaff > 0) parts.push(`${noStaff} had no available staff`);
      if (failed > 0) parts.push(`${failed} failed`);
      toast({
        title: `${totalScheduled} inspection${totalScheduled !== 1 ? "s" : ""} scheduled!`,
        description: parts.join(", ") + ".",
        variant: "default",
      });
      clearAll();
    } else if (noStaff > 0) {
      toast({
        title: "No available staff",
        description: `All ${noStaff} slot${noStaff !== 1 ? "s" : ""} had conflicts for every available rep. Try different times or add more staff.`,
        variant: "destructive",
      });
    } else {
      toast({ title: "Scheduling failed", description: "Try again.", variant: "destructive" });
    }
  };

  const mapKey = mapCenter.join(",") + filteredLeads.length;

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-gray-50">
      {/* ── Left panel ── */}
      <div className="w-72 flex-shrink-0 flex flex-col bg-white border-r shadow-sm overflow-y-auto">
        <div className={`p-4 text-white ${stormData ? 'bg-gradient-to-br from-indigo-600 to-purple-700' : 'bg-gradient-to-br from-blue-600 to-blue-700'}`}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <Route className="w-5 h-5 flex-shrink-0" />
              <h1 className="text-base font-semibold">Inspection Route Planner</h1>
            </div>
            {stormData && (
              <button
                onClick={() => { setStormData(null); clearAll(); }}
                className="text-xs text-white/70 hover:text-white underline flex-shrink-0"
                title="Go back to CRM leads"
              >
                × Clear
              </button>
            )}
          </div>
          {stormData ? (
            <div>
              <p className="text-purple-200 text-xs font-medium">⚡ Storm mode: {stormData.title}</p>
              <p className="text-purple-300 text-xs mt-0.5">{stormData.addresses.length} addresses from storm zone · click a pin, then Shift + click another to add the range</p>
            </div>
          ) : (
            <p className="text-blue-200 text-xs">
              Filter leads by area → click pins (or Shift + click a range) → schedule the whole route in one shot
            </p>
          )}
        </div>

        <div className="p-4 space-y-5 flex-1">
          {/* Area filter */}
          <section>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Filter by Area</p>
            <div className="space-y-2">
              <Input
                data-testid="filter-zip"
                placeholder="ZIP code (e.g. 44146)"
                value={filterZip}
                onChange={e => { setFilterZip(e.target.value); clearAll(); }}
              />
              <Input
                data-testid="filter-city"
                placeholder="City (e.g. Cleveland)"
                value={filterCity}
                onChange={e => { setFilterCity(e.target.value); clearAll(); }}
              />
              {!stormData && (
                <Select
                  value={filterStatus}
                  onValueChange={v => { setFilterStatus(v); clearAll(); }}
                >
                  <SelectTrigger data-testid="filter-status">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="contacted">Contacted</SelectItem>
                    <SelectItem value="qualified">Qualified</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </section>

          {/* Schedule settings */}
          <section>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Schedule Settings</p>
            <div className="space-y-2">
              <div>
                <Label className="text-xs text-gray-600">Date</Label>
                <Input
                  data-testid="schedule-date"
                  type="date"
                  value={scheduleDate}
                  onChange={e => setScheduleDate(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs text-gray-600">Start Time</Label>
                <Input
                  data-testid="start-time"
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs text-gray-600">Time per Stop</Label>
                <Select
                  value={String(slotMinutes)}
                  onValueChange={v => setSlotMinutes(Number(v))}
                >
                  <SelectTrigger data-testid="slot-duration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 minutes</SelectItem>
                    <SelectItem value="45">45 minutes</SelectItem>
                    <SelectItem value="60">1 hour</SelectItem>
                    <SelectItem value="90">1.5 hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-gray-600">Assign To</Label>
                <Select value={assignedRep || "__self__"} onValueChange={v => setAssignedRep(v === "__self__" ? "" : v)}>
                  <SelectTrigger data-testid="assign-rep">
                    <SelectValue placeholder="Myself" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__self__">Myself</SelectItem>
                    {staffProfiles.map(sp => (
                      <SelectItem
                        key={sp.id}
                        value={sp.user_email || sp.email || sp.id}
                      >
                        {sp.name || sp.full_name || sp.user_email || sp.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* Clear route events */}
          {scheduledRouteEvents.length > 0 && (
            <section className="border-t pt-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                🗑️ Clear Route Events
              </p>
              <p className="text-xs text-gray-500 mb-2">
                <span className="font-semibold text-red-600">{scheduledRouteEvents.length}</span> scheduled inspection event{scheduledRouteEvents.length !== 1 ? 's' : ''} on your calendar from Route Planner.
              </p>
              <div className="space-y-2">
                <div>
                  <Label className="text-xs text-gray-600">Delete from date</Label>
                  <Input
                    type="date"
                    value={clearFromDate}
                    onChange={e => setClearFromDate(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <p className="text-xs text-gray-400 mt-0.5">
                    {clearFromDate
                      ? `${scheduledRouteEvents.filter(e => e.start_time && e.start_time >= clearFromDate).length} events on/after this date`
                      : 'All events'}
                  </p>
                </div>
                <BulkDeleteButton
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  onClick={handleClearRouteEvents}
                  disabled={isClearingEvents}
                >
                  {isClearingEvents ? 'Deleting…' : `Delete inspection events`}
                </BulkDeleteButton>
              </div>
            </section>
          )}

          {/* Selection actions */}
          <section className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">
                {selectedLeads.length > 0
                  ? `${selectedLeads.length} stop${selectedLeads.length !== 1 ? "s" : ""} selected`
                  : `${filteredLeads.length} leads shown`}
              </span>
              <div className="flex gap-3 text-xs">
                <button
                  data-testid="select-all"
                  className="text-blue-600 hover:underline"
                  onClick={selectAll}
                >
                  All
                </button>
                <button
                  data-testid="clear-all"
                  className="text-gray-400 hover:underline"
                  onClick={clearAll}
                >
                  Clear
                </button>
              </div>
            </div>

            {selectedLeads.length > 0 && (
              <div className="bg-blue-50 rounded-lg p-3 mb-3 text-xs text-blue-800 space-y-1">
                <div className="font-medium">Route summary</div>
                <div>{format(new Date(scheduleDate + "T" + startTime), "EEE, MMM d")} starting at {startTime}</div>
                <div>{selectedLeads.length} stops · ~{totalHours}h total drive time</div>
                <div className="text-blue-600">
                  Wraps up around{" "}
                  {format(getSlotStart(scheduleDate, startTime, sortedRoute.length, slotMinutes), "h:mm a")}
                </div>
              </div>
            )}

            {sortedRoute.length > 0 && (() => {
              const stops = sortedRoute.filter(l => getLat(l) !== 0 && getLng(l) !== 0);
              const mapsUrl = stops.length > 0
                ? `https://www.google.com/maps/dir/${stops.map(l => `${getLat(l)},${getLng(l)}`).join('/')}`
                : null;
              return mapsUrl ? (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center text-sm font-medium py-2 px-3 rounded-md bg-green-50 text-green-700 border border-green-300 hover:bg-green-100 transition-colors mb-2"
                >
                  🗺️ Open Route in Google Maps
                </a>
              ) : null;
            })()}
            {stormData?.campaign && (
              <Button
                variant="outline"
                className="w-full border-violet-300 text-violet-700 hover:bg-violet-50 mb-2"
                onClick={() => {
                  localStorage.setItem("activeStormCampaign", JSON.stringify(stormData.campaign));
                  window.location.assign(createPageUrl("FieldRepApp"));
                }}
                data-testid="start-storm-campaign-btn"
              >
                ⚡ Open campaign in Field App
              </Button>
            )}

            <Button
              data-testid="schedule-route-btn"
              className="w-full"
              onClick={handleSchedule}
              disabled={selectedLeads.length === 0 || isScheduling}
            >
              {isScheduling
                ? "Scheduling…"
                : selectedLeads.length > 0
                ? `Schedule ${selectedLeads.length} ${stormData ? "Canvass Stop" : "Inspection"}${selectedLeads.length !== 1 ? "s" : ""}`
                : `Select ${stormData ? "addresses" : "leads"} to schedule`}
            </Button>

            {!stormData && selectedLeads.length > 0 && (
              <a
                href={createPageUrl("Calendar")}
                className="block text-center text-xs text-blue-600 hover:underline mt-2"
              >
                View Calendar →
              </a>
            )}
          </section>
        </div>
      </div>

      {/* ── Right: map + list ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Map */}
        <div className="flex-1 min-h-0 relative">
          {geocodedLeads.length > 0 ? (
            <MapContainer
              key={mapKey}
              center={mapCenter}
              zoom={10}
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="© OpenStreetMap contributors"
              />
              {geocodedLeads.map(lead => {
                const isSelected = selectedIds.has(lead.id);
                const routeIdx = sortedRoute.findIndex(l => l.id === lead.id);
                return (
                  <Marker
                    key={lead.id}
                    position={[getLat(lead), getLng(lead)]}
                    icon={makeMarkerIcon(isSelected, isSelected ? routeIdx + 1 : null)}
                      eventHandlers={{ click: (event) => toggleLead(lead.id, { shiftKey: !!event.originalEvent?.shiftKey }) }}
                  >
                    <Popup>
                      <div className="text-sm min-w-[160px]">
                        <p className="font-semibold">{getLeadName(lead)}</p>
                        <p className="text-gray-500 text-xs mt-0.5">{getAddress(lead)}</p>
                        {isSelected && routeIdx >= 0 && (
                          <p className="text-green-700 text-xs mt-1 font-medium">
                            Stop #{routeIdx + 1} ·{" "}
                            {format(
                              getSlotStart(scheduleDate, startTime, routeIdx, slotMinutes),
                              "h:mm a"
                            )}
                          </p>
                        )}
                        <button
                          className={`mt-2 text-xs font-medium px-2 py-1 rounded ${isSelected ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-700"}`}
                          onClick={() => toggleLead(lead.id)}
                        >
                          {isSelected ? "Remove from route" : "Add to route"}
                        </button>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          ) : (
            <div className="h-full flex items-center justify-center bg-gray-100">
              <div className="text-center text-gray-400">
                <MapPin className="w-10 h-10 mx-auto mb-2 opacity-20" />
                <p className="text-sm font-medium">No geocoded leads to show</p>
                <p className="text-xs mt-1">
                  {isLoading
                    ? "Loading leads…"
                    : filterZip || filterCity
                    ? "Try a different zip or city"
                    : "Open the Map page to trigger geocoding for your leads"}
                </p>
              </div>
            </div>
          )}

          {/* Map hint overlay */}
          {geocodedLeads.length > 0 && selectedLeads.length === 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-sm shadow rounded-full px-4 py-1.5 text-xs text-gray-600 pointer-events-none z-[400]">
              Click a pin to add it · Shift + click another pin to add the addresses between them
            </div>
          )}
        </div>

        {/* Lead list */}
        <div className="h-64 border-t bg-white flex flex-col overflow-hidden">
          <div className="flex-shrink-0 px-4 py-2 bg-gray-50 border-b flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              {filteredLeads.length} {stormData ? "address" : "lead"}{filteredLeads.length !== 1 ? "es" : ""}
              {filterZip || filterCity
                ? ` in "${filterZip || filterCity}"`
                : ""}
            </span>
            <span className="text-xs text-gray-400">
              {geocodedLeads.length} on map · {filteredLeads.length - geocodedLeads.length} without pin
            </span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y">
            {isLoading ? (
              <div className="p-8 text-center text-gray-400 text-sm">Loading leads…</div>
            ) : filteredLeads.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                No leads match your filters
              </div>
            ) : (
              filteredLeads.map(lead => {
                const isSelected = selectedIds.has(lead.id);
                const routeIdx = sortedRoute.findIndex(l => l.id === lead.id);
                const hasCoords = getLat(lead) !== 0 && getLng(lead) !== 0;
                return (
                  <div
                    key={lead.id}
                    data-testid={`lead-row-${lead.id}`}
                    className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${isSelected ? "bg-blue-50 hover:bg-blue-50" : ""}`}
                    onClick={event => toggleLead(lead.id, { shiftKey: event.shiftKey })}
                  >
                    <Checkbox
                      checked={isSelected}
                      className="mt-0.5 flex-shrink-0"
                      onCheckedChange={() => toggleLead(lead.id)}
                      onClick={e => e.stopPropagation()}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">
                          {getLeadName(lead)}
                        </span>
                        {isSelected && routeIdx >= 0 && (
                          <span className="text-xs bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 font-semibold">
                            {routeIdx + 1}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {getAddress(lead) || "No address on file"}
                      </p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded border ${STATUS_PILL[lead.status] || "bg-gray-100 text-gray-600 border-gray-200"}`}
                        >
                          {lead.status || "new"}
                        </span>
                        {!hasCoords && (
                          <span className="text-xs text-orange-500 flex items-center gap-0.5">
                            <MapPin className="w-3 h-3" /> No map pin
                          </span>
                        )}
                        {isSelected && routeIdx >= 0 && (
                          <span className="text-xs text-blue-600 font-medium flex items-center gap-0.5">
                            <Calendar className="w-3 h-3" />
                            {format(
                              getSlotStart(scheduleDate, startTime, routeIdx, slotMinutes),
                              "h:mm a"
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                    {(() => {
                      const zip = lead.zip || lead.data?.zip || "";
                      if (!zip) return null;
                      return (
                        <button
                          title="Check nearby leads in Lead Finder"
                          className="flex-shrink-0 flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded px-1.5 py-1 transition-colors"
                          onClick={e => {
                            e.stopPropagation();
                            window.open(
                              createPageUrl("LeadFinder") + "?location=" + encodeURIComponent(zip),
                              "_blank"
                            );
                          }}
                        >
                          <Search className="w-3.5 h-3.5" />
                          <span>Nearby</span>
                        </button>
                      );
                    })()}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
