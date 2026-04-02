import React, { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Ruler, Trash2, Save, MapPin } from 'lucide-react';

const MEASUREMENT_TYPES = {
  ridge: { label: 'Ridge', color: '#8B5CF6', icon: '📐' },
  hip: { label: 'Hip', color: '#3B82F6', icon: '📏' },
  valley: { label: 'Valley', color: '#10B981', icon: '📊' },
  rake: { label: 'Rake', color: '#F59E0B', icon: '📝' },
  eave: { label: 'Eave', color: '#EF4444', icon: '📌' },
  step_flashing: { label: 'Step Flashing', color: '#EC4899', icon: '📍' },
};

export default function RoofMeasurementViewer({ address, coordinates, onMeasurementsChange }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const [map, setMap] = useState(null);
  const [activeTool, setActiveTool] = useState(null);
  const [measurements, setMeasurements] = useState([]);
  const [currentPolyline, setCurrentPolyline] = useState(null);
  const [polylines, setPolylines] = useState([]);

  useEffect(() => {
    if (!window.google || !mapRef.current || !coordinates) return;

    const mapInstance = new window.google.maps.Map(mapRef.current, {
      center: coordinates,
      zoom: 20,
      mapTypeId: 'satellite',
      tilt: 0,
      heading: 0,
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
    });

    // Add marker at property location
    new window.google.maps.Marker({
      position: coordinates,
      map: mapInstance,
      title: address,
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: '#EF4444',
        fillOpacity: 0.8,
        strokeColor: '#FFFFFF',
        strokeWeight: 2,
      }
    });

    mapInstanceRef.current = mapInstance;
    setMap(mapInstance);

    // Add click listener for drawing
    const clickListener = mapInstance.addListener('click', (e) => {
      if (activeTool) {
        handleMapClick(e.latLng, mapInstance);
      }
    });

    return () => {
      window.google.maps.event.removeListener(clickListener);
    };
  }, [coordinates, activeTool]);

  const handleMapClick = (latLng, mapInstance) => {
    if (!currentPolyline) {
      // Start new line
      const newPolyline = new window.google.maps.Polyline({
        path: [latLng],
        geodesic: true,
        strokeColor: MEASUREMENT_TYPES[activeTool].color,
        strokeOpacity: 1.0,
        strokeWeight: 4,
        map: mapInstance,
        editable: true,
        draggable: false,
      });

      setCurrentPolyline({ polyline: newPolyline, type: activeTool, points: [latLng] });
    } else {
      // Add point to current line
      const path = currentPolyline.polyline.getPath();
      path.push(latLng);
      
      setCurrentPolyline({
        ...currentPolyline,
        points: [...currentPolyline.points, latLng]
      });
    }
  };

  const finishCurrentLine = () => {
    if (!currentPolyline) return;

    const path = currentPolyline.polyline.getPath();
    const points = [];
    for (let i = 0; i < path.getLength(); i++) {
      points.push(path.getAt(i));
    }

    // Calculate distance in feet
    let totalDistance = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const distanceMeters = window.google.maps.geometry.spherical.computeDistanceBetween(
        points[i],
        points[i + 1]
      );
      totalDistance += distanceMeters * 3.28084; // Convert meters to feet
    }

    const measurement = {
      id: Date.now(),
      type: currentPolyline.type,
      length: Math.round(totalDistance * 10) / 10,
      polyline: currentPolyline.polyline,
      points: points
    };

    setMeasurements(prev => [...prev, measurement]);
    setPolylines(prev => [...prev, currentPolyline.polyline]);
    setCurrentPolyline(null);
    setActiveTool(null);

    updateMeasurementsSummary([...measurements, measurement]);
  };

  const deleteMeasurement = (id) => {
    const measurement = measurements.find(m => m.id === id);
    if (measurement?.polyline) {
      measurement.polyline.setMap(null);
    }

    const updated = measurements.filter(m => m.id !== id);
    setMeasurements(updated);
    updateMeasurementsSummary(updated);
  };

  const clearAll = () => {
    polylines.forEach(p => p.setMap(null));
    if (currentPolyline) {
      currentPolyline.polyline.setMap(null);
    }
    setPolylines([]);
    setMeasurements([]);
    setCurrentPolyline(null);
    setActiveTool(null);
    updateMeasurementsSummary([]);
  };

  const updateMeasurementsSummary = (allMeasurements) => {
    const summary = {};
    
    Object.keys(MEASUREMENT_TYPES).forEach(type => {
      const typeMeasurements = allMeasurements.filter(m => m.type === type);
      const totalLength = typeMeasurements.reduce((sum, m) => sum + m.length, 0);
      summary[`${type}_lf`] = Math.round(totalLength);
    });

    // Calculate roof area (estimate based on perimeter if available)
    const totalPerimeter = allMeasurements.reduce((sum, m) => sum + m.length, 0);
    const estimatedAreaSqFt = totalPerimeter > 0 ? Math.pow(totalPerimeter / 4, 2) : 0;
    summary.roof_area_sq = Math.round((estimatedAreaSqFt / 100) * 10) / 10;
    summary.roof_area_sqft = Math.round(estimatedAreaSqFt);

    if (onMeasurementsChange) {
      onMeasurementsChange(summary);
    }
  };

  const selectTool = (tool) => {
    if (currentPolyline) {
      finishCurrentLine();
    }
    setActiveTool(tool === activeTool ? null : tool);
  };

  const totalByType = (type) => {
    return measurements
      .filter(m => m.type === type)
      .reduce((sum, m) => sum + m.length, 0);
  };

  return (
    <div className="space-y-4">
      {/* Measurement Tools */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Ruler className="w-5 h-5 text-blue-600" />
            Measurement Tools
          </h3>
          {measurements.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={clearAll}
              className="text-red-600 hover:text-red-700"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Clear All
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
          {Object.entries(MEASUREMENT_TYPES).map(([key, config]) => (
            <Button
              key={key}
              variant={activeTool === key ? 'default' : 'outline'}
              size="sm"
              onClick={() => selectTool(key)}
              className={`justify-start ${activeTool === key ? 'ring-2 ring-offset-2' : ''}`}
              style={activeTool === key ? { backgroundColor: config.color, borderColor: config.color } : {}}
            >
              <span className="mr-2">{config.icon}</span>
              {config.label}
              {totalByType(key) > 0 && (
                <Badge variant="secondary" className="ml-auto">
                  {Math.round(totalByType(key))} LF
                </Badge>
              )}
            </Button>
          ))}
        </div>

        {activeTool && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
            <p className="text-sm text-blue-900 font-medium">
              {currentPolyline ? (
                <>Click to add points, then click "Finish Line" when done</>
              ) : (
                <>Click on the map to start drawing {MEASUREMENT_TYPES[activeTool].label}</>
              )}
            </p>
            {currentPolyline && (
              <Button
                size="sm"
                onClick={finishCurrentLine}
                className="mt-2 w-full"
                style={{ backgroundColor: MEASUREMENT_TYPES[activeTool].color }}
              >
                <Save className="w-4 h-4 mr-2" />
                Finish {MEASUREMENT_TYPES[activeTool].label}
              </Button>
            )}
          </div>
        )}

        {/* Measurement Summary */}
        {measurements.length > 0 && (
          <div className="bg-gray-50 rounded-lg p-3">
            <h4 className="font-semibold text-sm mb-2">Measurements:</h4>
            <div className="space-y-1">
              {measurements.map(m => (
                <div key={m.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: MEASUREMENT_TYPES[m.type].color }}
                    />
                    <span>{MEASUREMENT_TYPES[m.type].label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{m.length} LF</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMeasurement(m.id)}
                      className="h-6 w-6 p-0 text-red-600"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Satellite Map */}
      <Card className="overflow-hidden">
        <div 
          ref={mapRef} 
          className="w-full h-[600px]"
          style={{ background: '#e5e7eb' }}
        />
        {!coordinates && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
            <div className="text-center">
              <MapPin className="w-12 h-12 text-gray-400 mx-auto mb-2" />
              <p className="text-gray-500">Enter an address to load satellite view</p>
            </div>
          </div>
        )}
      </Card>

      {/* Instructions */}
      <Card className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
        <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
          <Ruler className="w-4 h-4 text-blue-600" />
          How to Measure:
        </h4>
        <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
          <li>Select a measurement type (Ridge, Valley, etc.)</li>
          <li>Click on the map to start drawing a line</li>
          <li>Click multiple points along the roof feature</li>
          <li>Click "Finish Line" to complete that measurement</li>
          <li>Repeat for all roof features</li>
          <li>Lines are color-coded and editable!</li>
        </ol>
      </Card>
    </div>
  );
}