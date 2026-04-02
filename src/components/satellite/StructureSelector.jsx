import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function StructureSelector({ 
  latitude, 
  longitude, 
  address,
  onStructureSelect,
  onCancel,
  googleMapsLoaded,
  existingStructuresCount = 0
}) {
  const mapRef = useRef(null);
  const [map, setMap] = useState(null);
  const [selectedStructures, setSelectedStructures] = useState([]);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!googleMapsLoaded || !mapRef.current) return;

    // Clear any existing markers
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    const mapInstance = new window.google.maps.Map(mapRef.current, {
      center: { lat: latitude, lng: longitude },
      zoom: 21,
      mapTypeId: 'satellite',
      tilt: 0,
      heading: 0,
      fullscreenControl: false,
      streetViewControl: false,
      mapTypeControl: false,
      zoomControl: true,
      gestureHandling: 'greedy',
      disableDoubleClickZoom: true,
    });

    setMap(mapInstance);

    // Add click listener
    const clickListener = mapInstance.addListener('click', (e) => {
      console.log('Map clicked at:', e.latLng.lat(), e.latLng.lng());
      
      const clickedLat = e.latLng.lat();
      const clickedLng = e.latLng.lng();
      
      // Calculate marker number STARTING from existingStructuresCount + 1
      const markerNumber = existingStructuresCount + selectedStructures.length + 1;
      
      // Add new structure to array
      const newStructure = {
        id: Date.now(),
        coords: { lat: clickedLat, lng: clickedLng },
        name: `Structure ${markerNumber}`
      };
      
      setSelectedStructures(prev => {
        const updated = [...prev, newStructure];
        console.log('Updated structures:', updated);
        return updated;
      });

      // Add new marker at clicked location (don't remove previous ones)
      const newMarker = new window.google.maps.Marker({
        position: { lat: clickedLat, lng: clickedLng },
        map: mapInstance,
        label: {
          text: String(markerNumber),
          color: '#ffffff',
          fontSize: '16px',
          fontWeight: 'bold'
        },
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 16,
          fillColor: '#ef4444',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        },
        animation: window.google.maps.Animation.DROP,
        clickable: false
      });

      markersRef.current.push(newMarker);
      console.log('Marker added. Total markers:', markersRef.current.length);
    });

    return () => {
      window.google.maps.event.removeListener(clickListener);
      markersRef.current.forEach(m => m.setMap(null));
      markersRef.current = [];
    };
  }, [googleMapsLoaded, latitude, longitude, selectedStructures.length]);

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 border-2 border-purple-200">
        <h3 className="font-semibold flex items-center gap-2 mb-2">
          <MapPin className="w-5 h-5 text-purple-600" />
          Click on Each Structure to Measure
        </h3>
        <p className="text-sm text-gray-700">
          📍 Click on the center of each building (house, garage, shed). Each click adds a numbered marker. AI will measure all marked structures.
        </p>
      </div>

      {!googleMapsLoaded ? (
        <div className="h-[500px] bg-gray-100 rounded-lg flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : (
        <div 
          ref={mapRef} 
          className="h-[500px] w-full rounded-lg border-4 border-blue-300 shadow-lg cursor-crosshair"
        />
      )}

      {selectedStructures.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-sm text-green-800 font-medium mb-2">
            ✓ {selectedStructures.length} structure{selectedStructures.length > 1 ? 's' : ''} marked {existingStructuresCount > 0 ? `(adding to ${existingStructuresCount} already analyzed)` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {selectedStructures.map((structure, idx) => (
              <div key={structure.id} className="flex items-center gap-1 bg-white px-2 py-1 rounded text-xs">
                <span className="font-bold text-red-600">#{existingStructuresCount + idx + 1}</span>
                <span className="text-gray-600">{structure.name}</span>
                <button
                  onClick={() => {
                    setSelectedStructures(prev => prev.filter(s => s.id !== structure.id));
                    markersRef.current[idx]?.setMap(null);
                    markersRef.current = markersRef.current.filter((_, i) => i !== idx);
                  }}
                  className="text-red-600 hover:text-red-800 ml-1"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={onCancel}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          onClick={() => onStructureSelect(selectedStructures.map(s => s.coords))}
          disabled={selectedStructures.length === 0}
          className="flex-1 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
        >
          Measure {selectedStructures.length > 0 ? `${selectedStructures.length} Structure${selectedStructures.length > 1 ? 's' : ''}` : 'Structures'} {existingStructuresCount > 0 ? `(#${existingStructuresCount + 1}${selectedStructures.length > 1 ? `-${existingStructuresCount + selectedStructures.length}` : ''})` : ''}
        </Button>
      </div>
    </div>
  );
}