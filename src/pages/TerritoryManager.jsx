import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MapContainer, TileLayer, Polygon, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Plus, Edit2, Trash2, Users } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { createPageUrl } from "@/utils";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";

export default function TerritoryManager() {
  const { toast } = useToast();

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { company: myCompany } = useCurrentCompany(user);

  const [showDialog, setShowDialog] = useState(false);
  const [editingTerritory, setEditingTerritory] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    assigned_reps: [],
    color: "#3b82f6",
    boundary_points: []
  });

  const queryClient = useQueryClient();

  const { data: allStaffProfiles = [] } = useQuery({
    queryKey: ['all-staff-profiles', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
    initialData: [],
  });

  const { data: territories = [] } = useQuery({
    queryKey: ['territories', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Territory.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
    initialData: [],
  });

  const createTerritoryMutation = useMutation({
    mutationFn: (data) => base44.entities.Territory.create({
      ...data,
      company_id: myCompany?.id
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['territories'] });
      setShowDialog(false);
      setFormData({
        name: "",
        description: "",
        assigned_reps: [],
        color: "#3b82f6",
        boundary_points: [],
        start_address: "",
        end_address: "",
        route_notes: ""
      });
      toast({ title: 'Territory created!' });
    },
  });

  const updateTerritoryMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Territory.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['territories'] });
      setShowDialog(false);
      setEditingTerritory(null);
      setFormData({
        name: "",
        description: "",
        assigned_reps: [],
        color: "#3b82f6",
        boundary_points: [],
        start_address: "",
        end_address: "",
        route_notes: ""
      });
      toast({ title: 'Territory updated!' });
    },
  });

  const deleteTerritoryMutation = useMutation({
    mutationFn: (id) => base44.entities.Territory.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['territories'] });
      toast({ title: 'Territory deleted!' });
    },
  });

  const handleEdit = (territory) => {
    setEditingTerritory(territory);
    setFormData({
      name: territory.name,
      description: territory.description || "",
      assigned_reps: territory.assigned_reps || [],
      color: territory.color || "#3b82f6",
      boundary_points: territory.boundary_points || [],
      start_address: territory.start_address || "",
      end_address: territory.end_address || "",
      route_notes: territory.route_notes || ""
    });
    setShowDialog(true);
  };

  const handleSubmit = () => {
    if (editingTerritory) {
      updateTerritoryMutation.mutate({
        id: editingTerritory.id,
        data: formData
      });
    } else {
      createTerritoryMutation.mutate(formData);
    }
  };

  const [drawingMode, setDrawingMode] = useState(false);
  const [tempPoints, setTempPoints] = useState([]);
  const [mapCenter, setMapCenter] = useState([39.9612, -82.9988]);
  const [searchAddress, setSearchAddress] = useState('');
  const [showAIDialog, setShowAIDialog] = useState(false);
  const [aiCityName, setAiCityName] = useState('');
  const [selectedRepsForAI, setSelectedRepsForAI] = useState([]);

  function MapClickHandler() {
    useMapEvents({
      click: (e) => {
        if (drawingMode) {
          const newPoint = { lat: e.latlng.lat, lng: e.latlng.lng };
          setTempPoints([...tempPoints, newPoint]);
        }
      },
    });
    return null;
  }

  const handleFinishDrawing = () => {
    if (tempPoints.length < 3) {
      toast({ title: 'Need at least 3 points to create a territory', variant: 'destructive' });
      return;
    }

    const centerLat = tempPoints.reduce((sum, p) => sum + p.lat, 0) / tempPoints.length;
    const centerLng = tempPoints.reduce((sum, p) => sum + p.lng, 0) / tempPoints.length;
    
    setFormData({
      ...formData,
      boundary_points: tempPoints,
      center_lat: centerLat,
      center_lng: centerLng
    });
    
    setDrawingMode(false);
    setTempPoints([]);
    toast({ title: 'Territory boundary set!' });
  };

  const handleClearDrawing = () => {
    setTempPoints([]);
    setFormData({
      ...formData,
      boundary_points: [],
      center_lat: null,
      center_lng: null
    });
  };

  const handleSearchCity = async () => {
    if (!searchAddress.trim()) return;
    
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchAddress)}`
      );
      const data = await response.json();
      
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        setMapCenter([lat, lng]);
        toast({ title: `Found: ${data[0].display_name}` });
      } else {
        toast({ title: 'Location not found', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Failed to search location', variant: 'destructive' });
    }
  };

  const generateAITerritoriesMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('aiGenerateTerritories', {
        cityName: aiCityName,
        repEmails: selectedRepsForAI,
        companyId: myCompany?.id
      });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['territories'] });
      setShowAIDialog(false);
      setAiCityName('');
      setSelectedRepsForAI([]);
      toast({ title: `Created ${data.territories.length} territories!` });
      
      if (data.cityCenter) {
        setMapCenter([data.cityCenter.lat, data.cityCenter.lng]);
      }
    },
    onError: (error) => {
      toast({ title: 'Failed to generate territories', description: error.message, variant: 'destructive' });
    }
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <MapPin className="w-8 h-8 text-blue-600" />
            Territory Manager
          </h1>
          <p className="text-gray-500 mt-1">Assign and manage sales territories</p>
        </div>

        <div className="flex gap-2">
          <Button onClick={() => setShowAIDialog(true)} className="bg-purple-600 hover:bg-purple-700">
            <MapPin className="w-4 h-4 mr-2" />
            AI Generate Territories
          </Button>
          <Button onClick={() => setShowDialog(true)} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-2" />
            Manual Territory
          </Button>
        </div>
      </div>

      {/* Territory List */}
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle>Active Territories</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {territories.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <MapPin className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>No territories yet</p>
              </div>
            )}
            {territories.map((territory) => (
              <div
                key={territory.id}
                className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded"
                      style={{ backgroundColor: territory.color }}
                    ></div>
                    <div className="font-semibold">{territory.name}</div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(territory)}
                      className="h-8 w-8"
                    >
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm('Delete this territory?')) {
                          deleteTerritoryMutation.mutate(territory.id);
                        }
                      }}
                      className="h-8 w-8 text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                
                {territory.description && (
                  <p className="text-sm text-gray-600 mb-2">{territory.description}</p>
                )}

                {(territory.start_address || territory.route_notes) ? (
                  <div className="text-sm space-y-2 mb-2 p-3 bg-green-50 rounded border border-green-200">
                    <div className="font-semibold text-green-900 mb-1">📍 Route Instructions:</div>
                    {territory.start_address && (
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-start gap-1 flex-1">
                          <span className="font-semibold text-green-900">Start:</span>
                          <span className="text-green-800">{territory.start_address}</span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(territory.start_address)}`, '_blank')}
                          className="bg-blue-600 text-white hover:bg-blue-700 border-blue-600"
                        >
                          Navigate
                        </Button>
                      </div>
                    )}
                    {territory.end_address && (
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-start gap-1 flex-1">
                          <span className="font-semibold text-green-900">End:</span>
                          <span className="text-green-800">{territory.end_address}</span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(territory.end_address)}`, '_blank')}
                          className="bg-blue-600 text-white hover:bg-blue-700 border-blue-600"
                        >
                          Navigate
                        </Button>
                      </div>
                    )}
                    {territory.route_notes && (
                      <div className="flex items-start gap-1">
                        <span className="font-semibold text-green-900">Direction:</span>
                        <span className="text-green-800">{territory.route_notes}</span>
                      </div>
                    )}
                    <div className="pt-2 border-t border-green-300">
                      <Button
                        size="sm"
                        onClick={() => {
                          localStorage.setItem('activeTerritory', JSON.stringify(territory));
                          window.location.href = createPageUrl('FieldRepApp');
                        }}
                        className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold"
                      >
                        🚀 Start Working This Territory
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm mb-2 p-3 bg-yellow-50 rounded border border-yellow-200">
                    <div className="font-semibold text-yellow-900 mb-1">⚠️ No route instructions</div>
                    <p className="text-yellow-800 text-xs">Delete this territory and use "AI Generate Territories" to auto-create start/end points and directions.</p>
                  </div>
                )}

                <div className="text-sm">
                  <div className="flex items-center gap-1 text-gray-600">
                    <Users className="w-3 h-3" />
                    {territory.assigned_reps?.length || 0} reps assigned
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Territory Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTerritory ? 'Edit Territory' : 'Create New Territory'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Territory Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Downtown, North Side, etc."
              />
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={2}
                placeholder="Optional description..."
              />
            </div>

            <div>
              <Label>Color</Label>
              <Input
                type="color"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="w-20 h-10"
              />
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-semibold text-blue-900 mb-2">💡 Route Instructions (Optional)</h4>
              <p className="text-sm text-blue-800 mb-4">
                Give your reps clear starting/ending points and direction. <strong>Tip:</strong> Use "AI Generate Territories" to auto-fill these!
              </p>

              <div className="space-y-3">
                <div>
                  <Label>Start Address</Label>
                  <Input
                    value={formData.start_address || ""}
                    onChange={(e) => setFormData({ ...formData, start_address: e.target.value })}
                    placeholder="e.g., 123 Main St, Cleveland, OH"
                  />
                  <p className="text-xs text-gray-500 mt-1">Where to begin the day</p>
                </div>

                <div>
                  <Label>End Address</Label>
                  <Input
                    value={formData.end_address || ""}
                    onChange={(e) => setFormData({ ...formData, end_address: e.target.value })}
                    placeholder="e.g., 789 Oak Ave, Cleveland, OH"
                  />
                  <p className="text-xs text-gray-500 mt-1">Where to finish</p>
                </div>

                <div>
                  <Label>Route Direction</Label>
                  <Textarea
                    value={formData.route_notes || ""}
                    onChange={(e) => setFormData({ ...formData, route_notes: e.target.value })}
                    rows={2}
                    placeholder="e.g., Start north and work your way south, focus on residential streets"
                  />
                  <p className="text-xs text-gray-500 mt-1">Strategy for covering the territory</p>
                </div>
              </div>
            </div>

            <div>
              <Label>Assign Reps</Label>
              <Select
                value={formData.assigned_reps[0] || ""}
                onValueChange={(value) => {
                  if (value && !formData.assigned_reps.includes(value)) {
                    setFormData({
                      ...formData,
                      assigned_reps: [...formData.assigned_reps, value]
                    });
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Click to add reps..." />
                </SelectTrigger>
                <SelectContent>
                  {allStaffProfiles.filter(s => s.user_email).map((staff) => (
                    <SelectItem key={staff.user_email} value={staff.user_email}>
                      {staff.full_name || staff.user_email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formData.assigned_reps.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {formData.assigned_reps.map((email) => {
                    const staff = allStaffProfiles.find(s => s.user_email === email);
                    return (
                      <div key={email} className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">
                        {staff?.full_name || email}
                        <button
                          type="button"
                          onClick={() => setFormData({
                            ...formData,
                            assigned_reps: formData.assigned_reps.filter(e => e !== email)
                          })}
                          className="ml-1 hover:text-blue-900"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <Label>Territory Boundary</Label>
              <p className="text-sm text-gray-600 mb-2">
                Search for a city to center the map, then draw your boundary
              </p>

              <div className="flex gap-2 mb-3">
                <Input
                  placeholder="Type city name (e.g., Maple Heights, Ohio)"
                  value={searchAddress}
                  onChange={(e) => setSearchAddress(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearchCity()}
                  className="flex-1"
                />
                <Button
                  type="button"
                  onClick={handleSearchCity}
                  variant="outline"
                >
                  Search
                </Button>
              </div>

              <div className="flex gap-2 mb-2 flex-wrap">
                <Button
                  type="button"
                  variant={drawingMode ? "default" : "outline"}
                  onClick={() => setDrawingMode(!drawingMode)}
                  size="sm"
                >
                  {drawingMode ? '✓ Drawing Mode' : 'Draw Custom'}
                </Button>
                
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const center = [39.9612, -82.9988];
                    const offset = 0.05;
                    setFormData({
                      ...formData,
                      boundary_points: [
                        { lat: center[0] + offset, lng: center[1] + offset },
                        { lat: center[0] + offset, lng: center[1] - offset },
                        { lat: center[0] - offset, lng: center[1] - offset },
                        { lat: center[0] - offset, lng: center[1] + offset },
                      ],
                      center_lat: center[0],
                      center_lng: center[1]
                    });
                    toast({ title: 'Square territory created' });
                  }}
                >
                  □ Quick Square
                </Button>
                
                {tempPoints.length > 0 && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleFinishDrawing}
                      className="bg-green-50 border-green-500 text-green-700"
                    >
                      ✓ Finish ({tempPoints.length} pts)
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleClearDrawing}
                      className="text-red-600"
                    >
                      Clear
                    </Button>
                  </>
                )}
              </div>

              <div className="h-[500px] rounded-lg overflow-hidden border">
                <MapContainer
                  center={mapCenter}
                  zoom={13}
                  style={{ height: '100%', width: '100%' }}
                  key={mapCenter.join(',')}
                >
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <MapClickHandler />
                  
                  {tempPoints.length > 0 && (
                    <Polygon
                      positions={tempPoints.map(p => [p.lat, p.lng])}
                      pathOptions={{
                        color: formData.color,
                        fillColor: formData.color,
                        fillOpacity: 0.2,
                        dashArray: '5, 5'
                      }}
                    />
                  )}
                  
                  {formData.boundary_points.length > 0 && !drawingMode && (
                    <Polygon
                      positions={formData.boundary_points.map(p => [p.lat, p.lng])}
                      pathOptions={{
                        color: formData.color,
                        fillColor: formData.color,
                        fillOpacity: 0.2
                      }}
                    />
                  )}
                </MapContainer>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowDialog(false);
                  setEditingTerritory(null);
                  setFormData({
                    name: "",
                    description: "",
                    assigned_reps: [],
                    color: "#3b82f6",
                    boundary_points: [],
                    start_address: "",
                    end_address: "",
                    route_notes: ""
                  });
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleSubmit} className="bg-blue-600 hover:bg-blue-700">
                {editingTerritory ? 'Update' : 'Create'} Territory
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Territory Generation Dialog */}
      <Dialog open={showAIDialog} onOpenChange={setShowAIDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>AI Generate Territories</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <p className="text-sm text-purple-900">
                <strong>🤖 How it works:</strong> Enter a city name and select your reps. 
                AI will automatically divide the city into equal territories, one for each rep, with different colors.
              </p>
            </div>

            <div>
              <Label>City Name</Label>
              <Input
                placeholder="e.g., Columbus, Ohio or Cleveland, OH"
                value={aiCityName}
                onChange={(e) => setAiCityName(e.target.value)}
              />
            </div>

            <div>
              <Label>Select Reps ({selectedRepsForAI.length} selected)</Label>
              <Select
                onValueChange={(value) => {
                  if (value && !selectedRepsForAI.includes(value)) {
                    setSelectedRepsForAI([...selectedRepsForAI, value]);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Click to add reps..." />
                </SelectTrigger>
                <SelectContent>
                  {allStaffProfiles.filter(s => s.user_email).map((staff) => (
                    <SelectItem key={staff.user_email} value={staff.user_email}>
                      {staff.full_name || staff.user_email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedRepsForAI.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {selectedRepsForAI.map((email) => {
                    const staff = allStaffProfiles.find(s => s.user_email === email);
                    return (
                      <div key={email} className="flex items-center gap-1 bg-purple-100 text-purple-800 px-2 py-1 rounded text-sm">
                        {staff?.full_name || email}
                        <button
                          type="button"
                          onClick={() => setSelectedRepsForAI(selectedRepsForAI.filter(e => e !== email))}
                          className="ml-1 hover:text-purple-900"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAIDialog(false);
                  setAiCityName('');
                  setSelectedRepsForAI([]);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => generateAITerritoriesMutation.mutate()}
                disabled={!aiCityName || selectedRepsForAI.length === 0 || generateAITerritoriesMutation.isPending}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {generateAITerritoriesMutation.isPending ? 'Generating...' : `Generate for ${selectedRepsForAI.length} Rep${selectedRepsForAI.length !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
