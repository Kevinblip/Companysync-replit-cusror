import React, { useEffect, useRef } from 'react';
import { Card } from "@/components/ui/card";
import { MapPin } from "lucide-react";

export default function SatelliteMapPreview({ coordinates, address, googleMapsLoaded }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);

  useEffect(() => {
    if (googleMapsLoaded && coordinates && mapRef.current) {
      // Initialize map only once or update center
      if (!mapInstanceRef.current) {
        mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
          center: coordinates,
          zoom: 20,
          mapTypeId: 'satellite',
          tilt: 0,
          disableDefaultUI: true,
          zoomControl: true,
        });

        markerRef.current = new window.google.maps.Marker({
          position: coordinates,
          map: mapInstanceRef.current,
        });
      } else {
        mapInstanceRef.current.setCenter(coordinates);
        if (markerRef.current) {
          markerRef.current.setPosition(coordinates);
        }
      }
    }
  }, [googleMapsLoaded, coordinates]);

  return (
    <Card className="overflow-hidden relative h-[400px] w-full">
      <div 
        ref={mapRef} 
        className="w-full h-full"
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
      {address && (
        <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow-lg z-10">
          <p className="text-sm font-semibold text-gray-900">{address}</p>
        </div>
      )}
    </Card>
  );
}