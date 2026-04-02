import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MapContainer, TileLayer, Marker, Popup, Circle, Polygon, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import useTranslation from "@/hooks/useTranslation";
import { 
  MapPin, 
  Users, 
  DoorOpen, 
  Calendar, 
  TrendingUp, 
  Clock,
  CheckCircle,
  XCircle,
  Phone,
  DollarSign,
  Target,
  Navigation,
  Activity
} from "lucide-react";
import { format } from "date-fns";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";

// Fix leaflet default icon issue
import L from 'leaflet';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

export default function FieldSalesTracker() {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedRep, setSelectedRep] = useState("all");

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);

  // Territory compliance check (refreshes every 2 minutes)
  const { data: complianceData } = useQuery({
    queryKey: ['territory-compliance'],
    queryFn: async () => {
      const response = await base44.functions.invoke('checkTerritoryCompliance', {});
      return response.data;
    },
    refetchInterval: 120000, // Check every 2 minutes
    enabled: !!myCompany?.id,
  });

  const { data: allStaffProfiles = [] } = useQuery({
    queryKey: ['all-staff-profiles', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
    initialData: [],
  });

  const { data: activities = [] } = useQuery({
    queryKey: ['field-activities', selectedDate, myCompany?.id],
    queryFn: () => myCompany ? base44.entities.FieldActivity.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  // Real-time rep locations (refreshes every 30 seconds)
  const { data: repLocations = [] } = useQuery({
    queryKey: ['rep-locations', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.RepLocation.filter({ company_id: myCompany.id }, "-updated_date", 100) : [],
    enabled: !!myCompany,
    refetchInterval: 30000,
    initialData: [],
  });

  // Territories
  const { data: territories = [] } = useQuery({
    queryKey: ['territories', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Territory.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
    initialData: [],
  });

  // Filter activities by selected date and rep
  const filteredActivities = activities.filter(a => {
    const activityDate = a.created_date ? a.created_date.split('T')[0] : '';
    const dateMatch = activityDate === selectedDate;
    const repMatch = selectedRep === "all" || a.rep_email === selectedRep;
    return dateMatch && repMatch;
  });

  // Get unique active reps for today
  const activeReps = allStaffProfiles.filter(staff => {
    return filteredActivities.some(a => a.rep_email === staff.user_email);
  });

  // Calculate metrics
  const totalDoors = filteredActivities.filter(a => a.activity_type === 'door_knock').length;
  const appointments = filteredActivities.filter(a => a.activity_type === 'appointment_set').length;
  const sales = filteredActivities.filter(a => a.activity_type === 'sale_made').length;
  const totalRevenue = filteredActivities
    .filter(a => a.activity_type === 'sale_made')
    .reduce((sum, a) => sum + Number(a.sale_amount || 0), 0);

  // Calculate per-rep metrics
  const repMetrics = activeReps.map(rep => {
    const repActivities = filteredActivities.filter(a => a.rep_email === rep.user_email);
    const doors = repActivities.filter(a => a.activity_type === 'door_knock').length;
    const appts = repActivities.filter(a => a.activity_type === 'appointment_set').length;
    const repSales = repActivities.filter(a => a.activity_type === 'sale_made').length;
    const revenue = repActivities
      .filter(a => a.activity_type === 'sale_made')
      .reduce((sum, a) => sum + Number(a.sale_amount || 0), 0);
    
    const lastActivity = repActivities[0];
    
    return {
      ...rep,
      doors,
      appointments: appts,
      sales: repSales,
      revenue,
      conversion: doors > 0 ? ((appts / doors) * 100).toFixed(1) : 0,
      lastLocation: lastActivity ? {
        lat: lastActivity.latitude,
        lng: lastActivity.longitude,
        address: lastActivity.address,
        time: lastActivity.created_date
      } : null
    };
  });

  // Get map center (first active rep or company address)
  const activeRepLocation = repLocations.find(loc => loc.is_active);
  const mapCenter = activeRepLocation
    ? [activeRepLocation.latitude, activeRepLocation.longitude]
    : repMetrics[0]?.lastLocation 
    ? [repMetrics[0].lastLocation.lat, repMetrics[0].lastLocation.lng]
    : [39.9612, -82.9988]; // Columbus, OH as default

  // Activity markers for map
  const activityMarkers = filteredActivities
    .filter(a => a.latitude && a.longitude)
    .map(activity => ({
      position: [activity.latitude, activity.longitude],
      activity
    }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Navigation className="w-8 h-8 text-blue-600" />
            {t.sidebar.fieldSalesTracker}
          </h1>
          <p className="text-gray-500 mt-1">Real-time GPS tracking • Auto-refresh every 30s</p>
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm font-medium text-green-600">
                {repLocations.filter(loc => loc.is_active).length} reps live
              </span>
            </div>
            <div className="text-sm text-gray-500">
              {t.dashboard.lastUpdated || "Last updated"}: {format(new Date(), 'h:mm:ss a')}
            </div>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <select
            value={selectedRep}
            onChange={(e) => setSelectedRep(e.target.value)}
            className="px-4 py-2 border rounded-lg bg-white"
          >
            <option value="all">All Reps</option>
            {allStaffProfiles.map(rep => (
              <option key={rep.user_email} value={rep.user_email}>
                {rep.full_name || rep.user_email}
              </option>
            ))}
          </select>
          
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-4 py-2 border rounded-lg"
          />
        </div>
      </div>

      {/* Compliance Alert Banner */}
      {complianceData && complianceData.violations && complianceData.violations.length > 0 && (
        <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-4 shadow-md">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <XCircle className="w-6 h-6 text-red-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-red-900 text-lg">⚠️ Territory Violations Detected</h3>
              <p className="text-sm text-red-700 mt-1">
                {complianceData.violations.length} rep{complianceData.violations.length > 1 ? 's are' : ' is'} outside their assigned territory
              </p>
              <div className="mt-2 space-y-1">
                {complianceData.violations.map((v, idx) => (
                  <div key={idx} className="text-sm text-red-800 bg-white/50 rounded px-2 py-1">
                    <strong>{v.rep_name}</strong> - Should be in: {v.assigned_territories.join(', ')}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compliance Summary Card */}
      {complianceData && (
        <Card className="bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-blue-300 shadow-md">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 text-lg">Territory Compliance</h3>
              <Target className="w-6 h-6 text-blue-600" />
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-green-600">
                  {complianceData.inCompliance || 0}
                </div>
                <div className="text-xs text-gray-600">In Territory</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">
                  {complianceData.outOfBounds || 0}
                </div>
                <div className="text-xs text-gray-600">Out of Bounds</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-blue-600">
                  {complianceData.totalReps > 0 
                    ? Math.round((complianceData.inCompliance / complianceData.totalReps) * 100)
                    : 0}%
                </div>
                <div className="text-xs text-gray-600">{t.sidebar.compliance || "Compliance"}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white border-l-4 border-blue-500 shadow-md hover:shadow-lg transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <DoorOpen className="w-8 h-8 text-blue-500" />
              <span className="text-sm text-gray-600">Doors Knocked</span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900">{totalDoors}</h3>
            <p className="text-sm text-gray-500 mt-1">{activeReps.length} reps active</p>
          </CardContent>
        </Card>

        <Card className="bg-white border-l-4 border-purple-500 shadow-md hover:shadow-lg transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <Calendar className="w-8 h-8 text-purple-500" />
              <span className="text-sm text-gray-600">{t.calendar.appointment}s</span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900">{appointments}</h3>
            <p className="text-sm text-gray-500 mt-1">
              {totalDoors > 0 ? ((appointments / totalDoors) * 100).toFixed(1) : 0}% conversion
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white border-l-4 border-green-500 shadow-md hover:shadow-lg transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle className="w-8 h-8 text-green-500" />
              <span className="text-sm text-gray-600">Sales Closed</span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900">{sales}</h3>
            <p className="text-sm text-gray-500 mt-1">
              {appointments > 0 ? ((sales / appointments) * 100).toFixed(1) : 0}% close rate
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white border-l-4 border-orange-500 shadow-md hover:shadow-lg transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <DollarSign className="w-8 h-8 text-orange-500" />
              <span className="text-sm text-gray-600">{t.dashboard.revenue} {t.dashboard.today}</span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900">${totalRevenue.toLocaleString()}</h3>
            <p className="text-sm text-gray-500 mt-1">
              ${sales > 0 ? (totalRevenue / sales).toFixed(0) : 0} avg sale
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs: Map View and Team View */}
      <Tabs defaultValue="map" className="space-y-4">
        <TabsList className="bg-white shadow-sm">
          <TabsTrigger value="map" className="gap-2">
            <MapPin className="w-4 h-4" />
            {t.sidebar.map}
          </TabsTrigger>
          <TabsTrigger value="team" className="gap-2">
            <Users className="w-4 h-4" />
            Team Performance
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-2">
            <Activity className="w-4 h-4" />
            {t.sidebar.activityFeed}
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2">
            <TrendingUp className="w-4 h-4" />
            {t.sidebar.dailyReports}
          </TabsTrigger>
        </TabsList>

        {/* Map View */}
        <TabsContent value="map">
          {repLocations.filter(loc => loc.is_active).length === 0 && territories.length === 0 && (
            <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5 text-yellow-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-yellow-900">No Active Reps or Territories</h3>
                  <p className="text-sm text-yellow-700 mt-1">
                    • Reps need to open <strong>Field Rep App</strong> and click <strong>Check In</strong> to appear on map<br/>
                    • Create territories in <strong>Territory Manager</strong> to see boundary zones
                  </p>
                </div>
              </div>
            </div>
          )}
          
          <Card className="shadow-md">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle>Live GPS Map</CardTitle>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow"></div>
                    <span>Live Rep</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-purple-200 border border-purple-500"></div>
                    <span>Territory</span>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="h-[600px] w-full">
                <MapContainer
                  center={mapCenter}
                  zoom={13}
                  style={{ height: '100%', width: '100%' }}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  
                  {/* Territories */}
                  {territories.map((territory) => 
                    territory.boundary_points && territory.boundary_points.length > 0 ? (
                      <Polygon
                        key={territory.id}
                        positions={territory.boundary_points.map(p => [p.lat, p.lng])}
                        pathOptions={{
                          color: territory.color || '#3b82f6',
                          fillColor: territory.color || '#3b82f6',
                          fillOpacity: 0.1,
                          weight: 2
                        }}
                      >
                        <Popup>
                          <div className="p-2">
                            <div className="font-semibold text-lg mb-1">{territory.name}</div>
                            {territory.description && (
                              <div className="text-sm text-gray-600 mb-2">{territory.description}</div>
                            )}
                            <div className="text-sm">
                              <strong>Assigned Reps:</strong>
                              {territory.assigned_reps && territory.assigned_reps.length > 0 ? (
                                <div className="mt-1 space-y-1">
                                  {territory.assigned_reps.map(email => {
                                    const staff = allStaffProfiles.find(s => s.user_email === email);
                                    return (
                                      <div key={email} className="text-gray-700">
                                        • {staff?.full_name || email}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <span className="text-gray-500"> None</span>
                              )}
                            </div>
                          </div>
                        </Popup>
                      </Polygon>
                    ) : null
                  )}

                  {/* Real-time rep locations with pulsing effect */}
                  {repLocations
                  .filter(loc => loc.is_active && loc.latitude && loc.longitude)
                  .map((location) => {
                  const staff = allStaffProfiles.find(s => s.user_email === location.rep_email);
                  const repData = repMetrics.find(r => r.user_email === location.rep_email);

                  return (
                  <React.Fragment key={location.rep_email}>
                  <Marker
                    position={[location.latitude, location.longitude]}
                    icon={L.divIcon({
                      className: 'custom-marker',
                      html: `
                        <div style="position: relative; width: 50px; height: 50px;">
                          <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 60px; height: 60px; border-radius: 50%; background: rgba(34, 197, 94, 0.3); animation: pulse 2s infinite;"></div>
                          <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 46px; height: 46px; border-radius: 50%; border: 4px solid #22c55e; background: ${staff?.avatar_url ? `url('${staff.avatar_url}')` : '#10b981'}; background-size: cover; background-position: center; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
                            ${!staff?.avatar_url ? `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 18px;">${location.rep_name?.[0] || '?'}</div>` : ''}
                          </div>
                          <div style="position: absolute; top: -2px; right: -2px; width: 16px; height: 16px; border-radius: 50%; background: #22c55e; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>
                        </div>
                        <style>
                          @keyframes pulse {
                            0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.6; }
                            50% { transform: translate(-50%, -50%) scale(1.3); opacity: 0.2; }
                          }
                        </style>
                      `,
                      iconSize: [50, 50],
                      iconAnchor: [25, 25]
                    })}
                  >
                            <Popup>
                              <div className="p-2 min-w-[200px]">
                                <div className="flex items-center gap-2 mb-2">
                                  {staff?.avatar_url ? (
                                    <img src={staff.avatar_url} alt={location.rep_name} className="w-10 h-10 rounded-full" />
                                  ) : (
                                    <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold">
                                      {location.rep_name?.[0] || '?'}
                                    </div>
                                  )}
                                  <div>
                                    <div className="font-semibold">{location.rep_name}</div>
                                    <div className="text-xs text-green-600 flex items-center gap-1">
                                      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                                      Live - {format(new Date(location.updated_date), 'h:mm a')}
                                    </div>
                                  </div>
                                </div>
                                <div className="text-sm space-y-1 border-t pt-2">
                                  <div className="text-gray-600">📍 {location.address || 'Getting address...'}</div>
                                  {location.accuracy && (
                                    <div className="text-xs text-gray-500">Accuracy: {Math.round(location.accuracy)}m</div>
                                  )}
                                  {location.battery_level && (
                                    <div className="text-xs text-gray-500">Battery: {location.battery_level}%</div>
                                  )}
                                </div>
                                {repData && (
                                  <div className="mt-2 pt-2 border-t">
                                    <div className="font-semibold text-blue-600 text-sm">Today's Stats</div>
                                    <div className="grid grid-cols-2 gap-2 mt-1 text-xs">
                                      <div>🚪 {repData.doors} doors</div>
                                      <div>📅 {repData.appointments} appts</div>
                                      <div>✅ {repData.sales} sales</div>
                                      <div>💰 ${repData.revenue.toLocaleString()}</div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </Popup>
                          </Marker>
                          
                          {/* Accuracy circle with glow */}
                          {location.accuracy && location.accuracy < 100 && (
                            <Circle
                              center={[location.latitude, location.longitude]}
                              radius={location.accuracy}
                              pathOptions={{
                                color: '#22c55e',
                                fillColor: '#22c55e',
                                fillOpacity: 0.15,
                                weight: 2,
                                dashArray: '5, 5'
                              }}
                            />
                          )}
                        </React.Fragment>
                      );
                    })
                  }

                  {/* Activity markers */}
                  {activityMarkers.map((marker, idx) => (
                    <Circle
                      key={idx}
                      center={marker.position}
                      radius={50}
                      pathOptions={{
                        color: 
                          marker.activity.activity_type === 'sale_made' ? '#22c55e' :
                          marker.activity.activity_type === 'appointment_set' ? '#8b5cf6' :
                          marker.activity.activity_type === 'not_interested' ? '#ef4444' :
                          '#3b82f6',
                        fillColor: 
                          marker.activity.activity_type === 'sale_made' ? '#22c55e' :
                          marker.activity.activity_type === 'appointment_set' ? '#8b5cf6' :
                          marker.activity.activity_type === 'not_interested' ? '#ef4444' :
                          '#3b82f6',
                        fillOpacity: 0.3
                      }}
                    >
                      <Popup>
                        <div className="p-2">
                          <div className="font-semibold mb-1">
                            {marker.activity.activity_type.replace('_', ' ').toUpperCase()}
                          </div>
                          <div className="text-sm space-y-1">
                            <div>{marker.activity.rep_name}</div>
                            <div className="text-gray-600">{marker.activity.address}</div>
                            {marker.activity.customer_name && (
                              <div>👤 {marker.activity.customer_name}</div>
                            )}
                            {marker.activity.notes && (
                              <div className="text-gray-600">{marker.activity.notes}</div>
                            )}
                          </div>
                        </div>
                      </Popup>
                    </Circle>
                  ))}
                </MapContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Team Performance */}
        <TabsContent value="team">
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle>Team Performance - {format(new Date(selectedDate), 'MMMM d, yyyy')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {repMetrics.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>{t.common.noResults}</p>
                  </div>
                )}
                {repMetrics
                  .sort((a, b) => b.sales - a.sales || b.appointments - a.appointments)
                  .map((rep, index) => (
                    <div
                      key={rep.user_email}
                      className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${
                        index === 0 ? 'bg-yellow-100 text-yellow-600' :
                        index === 1 ? 'bg-gray-200 text-gray-600' :
                        index === 2 ? 'bg-orange-100 text-orange-600' :
                        'bg-blue-50 text-blue-600'
                      }`}>
                        {index + 1}
                      </div>

                      {rep.avatar_url ? (
                        <img src={rep.avatar_url} alt={rep.full_name} className="w-12 h-12 rounded-full" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold">
                          {rep.full_name?.[0] || '?'}
                        </div>
                      )}

                      <div className="flex-1">
                        <div className="font-semibold text-gray-900">{rep.full_name}</div>
                        {rep.lastLocation && (
                          <div className="text-sm text-gray-500">
                            📍 Last seen {format(new Date(rep.lastLocation.time), 'h:mm a')}
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-4 gap-4 text-center">
                        <div>
                          <div className="text-xs text-gray-500">Doors</div>
                          <div className="text-lg font-bold text-blue-600">{rep.doors}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Appts</div>
                          <div className="text-lg font-bold text-purple-600">{rep.appointments}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">{t.leads.won}</div>
                          <div className="text-lg font-bold text-green-600">{rep.sales}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">{t.dashboard.revenue}</div>
                          <div className="text-lg font-bold text-orange-600">${rep.revenue.toLocaleString()}</div>
                        </div>
                      </div>

                      <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                        {rep.conversion}% conv
                      </Badge>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Daily Reports Tab */}
        <TabsContent value="reports">
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle>{t.sidebar.dailyReports}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {repMetrics.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <TrendingUp className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>{t.common.noResults}</p>
                  </div>
                )}
                {repMetrics.map((rep) => {
                  // Calculate territory compliance for this rep
                  const repActivities = filteredActivities.filter(a => a.rep_email === rep.user_email);
                  const assignedTerritory = territories.find(t => t.assigned_reps?.includes(rep.user_email));
                  
                  let activitiesInTerritory = 0;
                  if (assignedTerritory && assignedTerritory.boundary_points?.length >= 3) {
                    activitiesInTerritory = repActivities.filter(a => {
                      if (!a.latitude || !a.longitude) return false;
                      // Simple point-in-polygon check
                      let inside = false;
                      const polygon = assignedTerritory.boundary_points;
                      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                        const xi = polygon[i].lat, yi = polygon[i].lng;
                        const xj = polygon[j].lat, yj = polygon[j].lng;
                        const intersect = ((yi > a.longitude) !== (yj > a.longitude))
                            && (a.latitude < (xj - xi) * (a.longitude - yi) / (yj - yi) + xi);
                        if (intersect) inside = !inside;
                      }
                      return inside;
                    }).length;
                  }

                  const complianceScore = repActivities.length > 0 
                    ? Math.round((activitiesInTerritory / repActivities.length) * 100)
                    : 100;

                  return (
                    <div key={rep.user_email} className="p-4 bg-gradient-to-r from-gray-50 to-blue-50 rounded-lg border border-gray-200">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          {rep.avatar_url ? (
                            <img src={rep.avatar_url} alt={rep.full_name} className="w-12 h-12 rounded-full" />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold">
                              {rep.full_name?.[0] || '?'}
                            </div>
                          )}
                          <div>
                            <div className="font-semibold text-gray-900">{rep.full_name}</div>
                            <div className="text-sm text-gray-600">
                              {assignedTerritory ? assignedTerritory.name : 'No territory assigned'}
                            </div>
                          </div>
                        </div>
                        <Badge variant="secondary" className={complianceScore >= 80 ? 'bg-green-100 text-green-700' : complianceScore >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}>
                          {complianceScore}% {t.sidebar.compliance || "compliance"}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <div className="bg-white p-3 rounded border">
                          <div className="text-xs text-gray-500">Doors Knocked</div>
                          <div className="text-2xl font-bold text-blue-600">{rep.doors}</div>
                        </div>
                        <div className="bg-white p-3 rounded border">
                          <div className="text-xs text-gray-500">{t.calendar.appointment}s</div>
                          <div className="text-2xl font-bold text-purple-600">{rep.appointments}</div>
                        </div>
                        <div className="bg-white p-3 rounded border">
                          <div className="text-xs text-gray-500">{t.leads.won}</div>
                          <div className="text-2xl font-bold text-green-600">{rep.sales}</div>
                        </div>
                        <div className="bg-white p-3 rounded border">
                          <div className="text-xs text-gray-500">{t.dashboard.revenue}</div>
                          <div className="text-2xl font-bold text-orange-600">${rep.revenue.toLocaleString()}</div>
                        </div>
                        <div className="bg-white p-3 rounded border">
                          <div className="text-xs text-gray-500">Conversion</div>
                          <div className="text-2xl font-bold text-blue-600">{rep.conversion}%</div>
                        </div>
                      </div>

                      {assignedTerritory && (
                        <div className="mt-3 text-sm bg-white p-3 rounded border">
                          <div className="font-semibold text-gray-700 mb-1">Territory Coverage</div>
                          <div className="flex items-center gap-2 text-gray-600">
                            <CheckCircle className="w-4 h-4 text-green-500" />
                            {activitiesInTerritory} activities in territory
                          </div>
                          {repActivities.length - activitiesInTerritory > 0 && (
                            <div className="flex items-center gap-2 text-gray-600">
                              <XCircle className="w-4 h-4 text-red-500" />
                              {repActivities.length - activitiesInTerritory} activities outside territory
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activity Feed */}
        <TabsContent value="activity">
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle>{t.sidebar.activityFeed} - {format(new Date(selectedDate), 'MMMM d, yyyy')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {filteredActivities.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <Activity className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>{t.common.noResults}</p>
                  </div>
                )}
                {filteredActivities.map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                      activity.activity_type === 'sale_made' ? 'bg-green-100 text-green-600' :
                      activity.activity_type === 'appointment_set' ? 'bg-purple-100 text-purple-600' :
                      activity.activity_type === 'not_interested' ? 'bg-red-100 text-red-600' :
                      'bg-blue-100 text-blue-600'
                    }`}>
                      {activity.activity_type === 'sale_made' ? <CheckCircle className="w-5 h-5" /> :
                       activity.activity_type === 'appointment_set' ? <Calendar className="w-5 h-5" /> :
                       activity.activity_type === 'not_interested' ? <XCircle className="w-5 h-5" /> :
                       <DoorOpen className="w-5 h-5" />}
                    </div>

                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-1">
                        <div>
                          <span className="font-semibold text-gray-900">
                            {activity.rep_name}
                          </span>
                          <span className="text-gray-600 mx-2">•</span>
                          <span className="text-sm text-gray-600">
                            {activity.activity_type.replace('_', ' ')}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {format(new Date(activity.created_date), 'h:mm a')}
                        </span>
                      </div>

                      <div className="text-sm text-gray-600 mb-1">
                        📍 {activity.address}
                      </div>

                      {activity.customer_name && (
                        <div className="text-sm">
                          👤 <span className="font-medium">{activity.customer_name}</span>
                          {activity.customer_phone && (
                            <span className="ml-2 text-gray-600">• {activity.customer_phone}</span>
                          )}
                        </div>
                      )}

                      {activity.notes && (
                        <div className="text-sm text-gray-600 mt-1 italic">
                          "{activity.notes}"
                        </div>
                      )}

                      {activity.sale_amount && (
                        <Badge variant="secondary" className="mt-2 bg-green-100 text-green-700">
                          ${activity.sale_amount.toLocaleString()} {t.leads.won}
                        </Badge>
                      )}

                      {activity.appointment_date && (
                        <Badge variant="secondary" className="mt-2 bg-purple-100 text-purple-700">
                          {t.calendar.appointment}: {format(new Date(activity.appointment_date), 'MMM d, h:mm a')}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}