import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MapPin,
  DoorOpen,
  Calendar,
  CheckCircle,
  XCircle,
  Clock,
  Camera,
  User,
  Phone,
  Mail,
  FileText,
  LogIn,
  LogOut,
  Target,
  TrendingUp
} from "lucide-react";
import { format } from "date-fns";
import { toast } from 'sonner';
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import useTranslation from "@/hooks/useTranslation";

export default function FieldRepApp() {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [showActivityDialog, setShowActivityDialog] = useState(false);
  const [activityType, setActivityType] = useState("door_knock");

  const [formData, setFormData] = useState({
    address: "",
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    notes: "",
    appointment_date: "",
    sale_amount: "",
    photo_url: "",
  });
  
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [dailyGoal, setDailyGoal] = useState({ doors: 50, appointments: 5, sales: 1 });

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);

  // Get today's activities for this rep
  const { data: todayActivities = [] } = useQuery({
    queryKey: ['today-activities', user?.email, myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      const all = await base44.entities.FieldActivity.filter({ company_id: myCompany.id }, "-created_date", 1000);
      const today = format(new Date(), 'yyyy-MM-dd');
      return all.filter(a => a.rep_email === user.email && a.created_date?.startsWith(today));
    },
    enabled: !!user && !!myCompany,
    initialData: [],
  });

  // Calculate today's stats
  const todayStats = {
    doors: todayActivities.filter(a => a.activity_type === 'door_knock').length,
    appointments: todayActivities.filter(a => a.activity_type === 'appointment_set').length,
    sales: todayActivities.filter(a => a.activity_type === 'sale_made').length,
    revenue: todayActivities
      .filter(a => a.activity_type === 'sale_made')
      .reduce((sum, a) => sum + Number(a.sale_amount || 0), 0),
  };
  
  // Get all reps stats for leaderboard
  const { data: allActivities = [] } = useQuery({
    queryKey: ['all-activities-today', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      const all = await base44.entities.FieldActivity.filter({ company_id: myCompany.id }, "-created_date", 10000);
      const today = format(new Date(), 'yyyy-MM-dd');
      return all.filter(a => a.created_date?.startsWith(today));
    },
    enabled: !!myCompany,
    initialData: [],
    refetchInterval: 60000,
  });
  
  const leaderboard = React.useMemo(() => {
    const repStats = {};
    allActivities.forEach(activity => {
      if (!repStats[activity.rep_email]) {
        repStats[activity.rep_email] = {
          name: activity.rep_name,
          doors: 0,
          appointments: 0,
          sales: 0,
          revenue: 0
        };
      }
      if (activity.activity_type === 'door_knock') repStats[activity.rep_email].doors++;
      if (activity.activity_type === 'appointment_set') repStats[activity.rep_email].appointments++;
      if (activity.activity_type === 'sale_made') {
        repStats[activity.rep_email].sales++;
        repStats[activity.rep_email].revenue += (activity.sale_amount || 0);
      }
    });
    return Object.entries(repStats)
      .map(([email, stats]) => ({ email, ...stats }))
      .sort((a, b) => b.sales - a.sales || b.appointments - a.appointments || b.doors - a.doors);
  }, [allActivities]);

  // Get current location and send updates
  useEffect(() => {
    if (!navigator.geolocation || !user || !myCompany) return;

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        };
        
        setCurrentLocation(location);
        setLocationError(null);

        // Update location in database every time it changes
        if (isCheckedIn) {
          try {
            const address = await getAddressFromCoords(location.latitude, location.longitude);
            
            // Get battery level if available
            let batteryLevel = null;
            if ('getBattery' in navigator) {
              const battery = await navigator.getBattery();
              batteryLevel = Math.round(battery.level * 100);
            }

            // Check if user already has a location record
            const existingLocations = await base44.entities.RepLocation.filter({ 
              rep_email: user.email 
            });

            if (existingLocations.length > 0) {
              // Update existing location
              await base44.entities.RepLocation.update(existingLocations[0].id, {
                latitude: location.latitude,
                longitude: location.longitude,
                accuracy: location.accuracy,
                address: address,
                is_active: true,
                battery_level: batteryLevel
              });
            } else {
              // Create new location record
              await base44.entities.RepLocation.create({
                company_id: myCompany.id,
                rep_email: user.email,
                rep_name: user.full_name,
                latitude: location.latitude,
                longitude: location.longitude,
                accuracy: location.accuracy,
                address: address,
                is_active: true,
                battery_level: batteryLevel
              });
            }
          } catch (error) {
            console.error('Failed to update location:', error);
          }
        }
      },
      (error) => {
        console.error("Location error:", error);
        const msgs = {
          1: 'Permission denied — please allow location access in your browser settings.',
          2: 'GPS signal unavailable. Move to an open area or check your device settings.',
          3: 'Location request timed out. Check your GPS signal and try again.',
        };
        setLocationError(msgs[error.code] || 'Location unavailable.');
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 27000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [user, myCompany, isCheckedIn]);

  // Reverse geocode to get address
  const getAddressFromCoords = async (lat, lng) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
      );
      const data = await response.json();
      return data.display_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    } catch (error) {
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
  };

  const logActivityMutation = useMutation({
    mutationFn: async (activityData) => {
      return await base44.entities.FieldActivity.create({
        company_id: myCompany?.id,
        rep_email: user?.email,
        rep_name: user?.full_name,
        ...activityData
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['today-activities'] });
      queryClient.invalidateQueries({ queryKey: ['field-activities'] });
      setShowActivityDialog(false);
      setFormData({
        address: "",
        customer_name: "",
        customer_phone: "",
        customer_email: "",
        notes: "",
        appointment_date: "",
        sale_amount: "",
      });
      toast.success('Activity logged successfully!');
    },
    onError: (error) => {
      toast.error('Failed to log activity: ' + error.message);
    }
  });

  const handleCheckIn = async () => {
    if (!currentLocation) {
      toast.error('Unable to get your location');
      return;
    }

    const address = await getAddressFromCoords(currentLocation.latitude, currentLocation.longitude);

    logActivityMutation.mutate({
      activity_type: 'check_in',
      latitude: currentLocation.latitude,
      longitude: currentLocation.longitude,
      address: address,
      notes: 'Started work day'
    });

    setIsCheckedIn(true);
    toast.success('🎯 Checked in! Let\'s crush today\'s goals!');
  };

  const handleCheckOut = async () => {
    if (!currentLocation) {
      toast.error('Unable to get your location');
      return;
    }

    const address = await getAddressFromCoords(currentLocation.latitude, currentLocation.longitude);

    logActivityMutation.mutate({
      activity_type: 'check_out',
      latitude: currentLocation.latitude,
      longitude: currentLocation.longitude,
      address: address,
      notes: 'Ended work day'
    });

    // Mark location as inactive
    try {
      const existingLocations = await base44.entities.RepLocation.filter({ 
        rep_email: user.email 
      });
      if (existingLocations.length > 0) {
        await base44.entities.RepLocation.update(existingLocations[0].id, {
          is_active: false
        });
      }
    } catch (error) {
      console.error('Failed to update location status:', error);
    }

    setIsCheckedIn(false);
  };

  const handleQuickLog = async (type) => {
    if (!currentLocation) {
      toast.error('Unable to get your location');
      return;
    }

    const address = await getAddressFromCoords(currentLocation.latitude, currentLocation.longitude);

    // Auto-open detailed form for appointments and sales
    if (type === 'appointment_set' || type === 'sale_made') {
      setActivityType(type);
      setFormData({ ...formData, address });
      setShowActivityDialog(true);
      return;
    }

    logActivityMutation.mutate({
      activity_type: type,
      latitude: currentLocation.latitude,
      longitude: currentLocation.longitude,
      address: address
    });
  };

  const handleDetailedLog = async () => {
    if (!currentLocation) {
      toast.error('Unable to get your location');
      return;
    }

    const address = formData.address || await getAddressFromCoords(currentLocation.latitude, currentLocation.longitude);

    logActivityMutation.mutate({
      activity_type: activityType,
      latitude: currentLocation.latitude,
      longitude: currentLocation.longitude,
      address: address,
      customer_name: formData.customer_name,
      customer_phone: formData.customer_phone,
      customer_email: formData.customer_email,
      notes: formData.notes,
      appointment_date: formData.appointment_date || null,
      sale_amount: formData.sale_amount ? parseFloat(formData.sale_amount) : null,
      photo_url: formData.photo_url || null,
    });
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{t.common.loading}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-4 pb-20">
      {/* Header */}
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900" data-testid="text-welcome">
            {t.dashboard.welcome}, {user?.full_name?.split(' ')[0] || 'Rep'}! 👋
          </h1>
          <p className="text-gray-600" data-testid="text-ready">Ready to crush it today?</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => base44.auth.logout()}
          className="text-red-600 border-red-300 hover:bg-red-50"
          data-testid="button-logout"
        >
          {t.sidebar.logout}
        </Button>
      </div>

      <Tabs defaultValue="field" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="field" data-testid="tab-field-work">{t.mobileNav.fieldWork}</TabsTrigger>
          <TabsTrigger value="stats" data-testid="tab-performance">{t.reports.performance}</TabsTrigger>
        </TabsList>

        <TabsContent value="field" className="space-y-6 mt-6">
          {/* Check In/Out */}
          <Card className="border-2 border-blue-500 bg-gradient-to-r from-blue-50 to-purple-50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-lg" data-testid="text-gps-tracking">Live GPS Tracking</div>
                  <div className="text-sm text-gray-600 flex items-center gap-2 mt-1">
                    {currentLocation ? (
                      <>
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                          <span className="text-green-600 font-medium" data-testid="status-location-active">Location Active</span>
                        </div>
                        {currentLocation.accuracy && (
                          <span className="text-xs text-gray-500" data-testid="text-location-accuracy">
                            ±{Math.round(currentLocation.accuracy)}m
                          </span>
                        )}
                      </>
                    ) : locationError ? (
                      <button
                        className="text-left"
                        data-testid="button-retry-location"
                        onClick={() => {
                          setLocationError(null);
                          navigator.geolocation?.getCurrentPosition(
                            (pos) => setCurrentLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
                            (err) => {
                              const msgs = { 1: 'Permission denied — allow location in browser settings.', 2: 'GPS signal unavailable.', 3: 'Timed out.' };
                              setLocationError(msgs[err.code] || 'Location unavailable.');
                            },
                            { enableHighAccuracy: true, timeout: 10000 }
                          );
                        }}
                      >
                        <span className="text-amber-600 font-medium text-xs block">⚠️ {locationError}</span>
                        <span className="text-blue-600 text-xs underline">Tap to retry / enable location</span>
                      </button>
                    ) : (
                      <span className="text-gray-500 text-xs" data-testid="text-location-loading">{t.common.loading}</span>
                    )}
                  </div>
                  {isCheckedIn && (
                    <div className="text-xs text-blue-600 mt-1 font-medium" data-testid="text-visible-manager">
                      ✓ Visible to manager on live map
                    </div>
                  )}
                </div>

                {!isCheckedIn ? (
                  <Button
                    onClick={handleCheckIn}
                    className="bg-green-600 hover:bg-green-700"
                    disabled={!currentLocation}
                    data-testid="button-check-in"
                  >
                    <LogIn className="w-4 h-4 mr-2" />
                    Check In
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        setIsOnBreak(!isOnBreak);
                        toast.success(isOnBreak ? '✅ Back from break!' : '☕ Enjoy your break!');
                      }}
                      variant="outline"
                      size="sm"
                      className={isOnBreak ? 'border-orange-500 text-orange-600' : ''}
                      data-testid="button-break-toggle"
                    >
                      {isOnBreak ? '▶️ Resume' : '⏸️ Break'}
                    </Button>
                    <Button
                      onClick={handleCheckOut}
                      variant="outline"
                      className="border-red-600 text-red-600 hover:bg-red-50"
                      data-testid="button-check-out"
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      Check Out
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg" data-testid="text-quick-log-title">Quick Log Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={() => handleQuickLog('door_knock')}
                  className="h-24 flex flex-col gap-2 bg-blue-500 hover:bg-blue-600 text-white"
                  disabled={!currentLocation || logActivityMutation.isPending}
                  data-testid="button-door-knock"
                >
                  <DoorOpen className="w-8 h-8" />
                  <span className="font-semibold" data-testid="text-door-knock">Door Knock</span>
                  <span className="text-xs opacity-90" data-testid="text-quick-log-door">Quick log</span>
                </Button>

                <Button
                  onClick={() => handleQuickLog('not_home')}
                  className="h-24 flex flex-col gap-2 bg-gray-500 hover:bg-gray-600 text-white"
                  disabled={!currentLocation || logActivityMutation.isPending}
                  data-testid="button-not-home"
                >
                  <XCircle className="w-8 h-8" />
                  <span className="font-semibold" data-testid="text-not-home">Not Home</span>
                  <span className="text-xs opacity-90" data-testid="text-quick-log-not-home">Quick log</span>
                </Button>

                <Button
                  onClick={() => handleQuickLog('appointment_set')}
                  className="h-24 flex flex-col gap-2 bg-purple-500 hover:bg-purple-600 text-white"
                  disabled={!currentLocation}
                  data-testid="button-appointment"
                >
                  <Calendar className="w-8 h-8" />
                  <span className="font-semibold" data-testid="text-appointment">{t.calendar.appointment}</span>
                  <span className="text-xs opacity-90" data-testid="text-add-details-appointment">Add details</span>
                </Button>

                <Button
                  onClick={() => handleQuickLog('sale_made')}
                  className="h-24 flex flex-col gap-2 bg-green-500 hover:bg-green-600 text-white"
                  disabled={!currentLocation}
                  data-testid="button-sale"
                >
                  <CheckCircle className="w-8 h-8" />
                  <span className="font-semibold" data-testid="text-sale">Sale! 🎉</span>
                  <span className="text-xs opacity-90" data-testid="text-add-details-sale">Add details</span>
                </Button>
              </div>
              
              {!currentLocation && (
                <div className="mt-3 text-sm text-center">
                  {locationError
                    ? <span className="text-amber-600">⚠️ {locationError} <button className="text-blue-600 underline ml-1" onClick={() => navigator.geolocation?.getCurrentPosition(p => setCurrentLocation({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }), () => {}, { enableHighAccuracy: true, timeout: 10000 })} data-testid="button-retry-gps">Retry</button></span>
                    : <span className="text-gray-500">Requesting GPS… please allow location access if prompted.</span>
                  }
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stats" className="space-y-6 mt-6">
          {/* Daily Goals Progress */}
          <Card className="bg-gradient-to-r from-blue-500 to-purple-500 text-white">
            <CardContent className="p-4">
              <div className="text-lg font-bold mb-3" data-testid="text-goals-title">🎯 Today's Goals</div>
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span data-testid="text-goal-doors">Doors: {todayStats.doors}/{dailyGoal.doors}</span>
                    <span data-testid="text-goal-doors-percent">{Math.round((todayStats.doors / dailyGoal.doors) * 100)}%</span>
                  </div>
                  <div className="h-2 bg-white/30 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-white rounded-full transition-all"
                      style={{ width: `${Math.min((todayStats.doors / dailyGoal.doors) * 100, 100)}%` }}
                      data-testid="progress-doors"
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span data-testid="text-goal-appointments">{t.calendar.appointment}s: {todayStats.appointments}/{dailyGoal.appointments}</span>
                    <span data-testid="text-goal-appointments-percent">{Math.round((todayStats.appointments / dailyGoal.appointments) * 100)}%</span>
                  </div>
                  <div className="h-2 bg-white/30 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-white rounded-full transition-all"
                      style={{ width: `${Math.min((todayStats.appointments / dailyGoal.appointments) * 100, 100)}%` }}
                      data-testid="progress-appointments"
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span data-testid="text-goal-sales">Sales: {todayStats.sales}/{dailyGoal.sales}</span>
                    <span data-testid="text-goal-sales-percent">{Math.round((todayStats.sales / dailyGoal.sales) * 100)}%</span>
                  </div>
                  <div className="h-2 bg-white/30 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-white rounded-full transition-all"
                      style={{ width: `${Math.min((todayStats.sales / dailyGoal.sales) * 100, 100)}%` }}
                      data-testid="progress-sales"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Leaderboard */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2" data-testid="text-leaderboard-title">
                🏆 Today's Leaderboard
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-60 overflow-y-auto" data-testid="list-leaderboard">
                {leaderboard.map((rep, idx) => (
                  <div 
                    key={rep.email} 
                    className={`flex items-center gap-3 p-2 rounded-lg ${
                      rep.email === user?.email ? 'bg-blue-50 border-2 border-blue-500' : 'bg-gray-50'
                    }`}
                    data-testid={`row-leaderboard-${idx}`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                      idx === 0 ? 'bg-yellow-400 text-yellow-900' :
                      idx === 1 ? 'bg-gray-300 text-gray-700' :
                      idx === 2 ? 'bg-orange-400 text-orange-900' :
                      'bg-gray-200 text-gray-600'
                    }`} data-testid={`text-rank-${idx}`}>
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate" data-testid={`text-rep-name-${idx}`}>
                        {rep.name} {rep.email === user?.email && '(You)'}
                      </div>
                      <div className="text-xs text-gray-600" data-testid={`text-rep-stats-${idx}`}>
                        {rep.doors} doors • {rep.appointments} appts • {rep.sales} sales
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg" data-testid="text-activity-title">Today's Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto" data-testid="list-activities">
                {todayActivities.length === 0 ? (
                  <div className="text-center py-6 text-gray-500" data-testid="text-no-activities">
                    <Target className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                    <p className="text-sm">{t.common.noResults}. Get knocking!</p>
                  </div>
                ) : (
                  todayActivities.map((activity, idx) => (
                    <div key={activity.id} className="flex items-start gap-3 p-2 bg-gray-50 rounded-lg" data-testid={`row-activity-${idx}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        activity.activity_type === 'sale_made' ? 'bg-green-100 text-green-600' :
                        activity.activity_type === 'appointment_set' ? 'bg-purple-100 text-purple-600' :
                        'bg-blue-100 text-blue-600'
                      }`} data-testid={`icon-activity-${idx}`}>
                        {activity.activity_type === 'sale_made' ? <CheckCircle className="w-4 h-4" /> :
                         activity.activity_type === 'appointment_set' ? <Calendar className="w-4 h-4" /> :
                         <DoorOpen className="w-4 h-4" />}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-medium" data-testid={`text-activity-type-${idx}`}>
                          {activity.activity_type.replace('_', ' ').toUpperCase()}
                        </div>
                        <div className="text-xs text-gray-600" data-testid={`text-activity-time-${idx}`}>
                          {format(new Date(activity.created_date), 'h:mm a')}
                        </div>
                        {activity.customer_name && (
                          <div className="text-xs text-gray-700 mt-1" data-testid={`text-activity-customer-${idx}`}>
                            {activity.customer_name}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Detailed Activity Dialog */}
      <Dialog open={showActivityDialog} onOpenChange={setShowActivityDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">
              {activityType === 'appointment_set' ? 'Log Appointment' : 'Log Sale'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label data-testid="label-address">{t.common.address}</Label>
              <Input
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Auto-filled from GPS"
                className="bg-gray-50"
                data-testid="input-address"
              />
              <p className="text-xs text-gray-500 mt-1" data-testid="text-auto-detected">✓ Auto-detected from your location</p>
            </div>

            <div>
              <Label data-testid="label-name">{t.common.name}</Label>
              <Input
                value={formData.customer_name}
                onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                placeholder="John Doe"
                data-testid="input-name"
              />
            </div>

            <div>
              <Label data-testid="label-phone">{t.common.phone}</Label>
              <Input
                type="tel"
                value={formData.customer_phone}
                onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })}
                placeholder="(555) 123-4567"
                data-testid="input-phone"
              />
            </div>

            {activityType === 'appointment_set' && (
              <div>
                <Label data-testid="label-appointment-date">{t.common.date} & Time</Label>
                <Input
                  type="datetime-local"
                  value={formData.appointment_date}
                  onChange={(e) => setFormData({ ...formData, appointment_date: e.target.value })}
                  data-testid="input-appointment-date"
                />
              </div>
            )}

            {activityType === 'sale_made' && (
              <div>
                <Label data-testid="label-sale-amount">{t.common.amount} ($)</Label>
                <Input
                  type="number"
                  value={formData.sale_amount}
                  onChange={(e) => setFormData({ ...formData, sale_amount: e.target.value })}
                  placeholder="5000"
                  data-testid="input-sale-amount"
                />
              </div>
            )}

            <div>
              <Label data-testid="label-notes">{t.common.notes}</Label>
              <div className="flex gap-2 mb-2 flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFormData({ ...formData, notes: "Interested in roof replacement" })}
                  data-testid="button-note-roof"
                >
                  🏠 Roof replacement
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFormData({ ...formData, notes: "Needs insurance claim help" })}
                  data-testid="button-note-insurance"
                >
                  💼 Insurance claim
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFormData({ ...formData, notes: "Call back later" })}
                  data-testid="button-note-callback"
                >
                  📞 Call back
                </Button>
              </div>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
                placeholder="Any additional details..."
                data-testid="textarea-notes"
              />
            </div>

            <div>
              <Label data-testid="label-photo">Photo ({t.common.optional})</Label>
              <Input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    try {
                      const { file_url } = await base44.integrations.Core.UploadFile({ file });
                      setFormData({ ...formData, photo_url: file_url });
                      toast.success('📸 Photo uploaded!');
                    } catch (error) {
                      toast.error('Failed to upload photo');
                    }
                  }
                }}
                className="cursor-pointer"
                data-testid="input-photo"
              />
              {formData.photo_url && (
                <img src={formData.photo_url} alt="Property" className="mt-2 w-full rounded-lg max-h-40 object-cover" data-testid="img-preview" />
              )}
            </div>

            <Button
              onClick={handleDetailedLog}
              className="w-full bg-blue-600 hover:bg-blue-700"
              disabled={logActivityMutation.isPending}
              data-testid="button-submit-log"
            >
              {logActivityMutation.isPending ? t.common.loading : 'Log Activity'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}