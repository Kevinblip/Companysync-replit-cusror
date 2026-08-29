import React, { useMemo, useState } from 'react';
import { Home, Camera } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import HouseModelViewer from './HouseModelViewer';
import ElevationDrawings from './ElevationDrawings';
import { assembleEstimatorHouse, toViewerModel } from '@/lib/houseGeometry';

export default function PropertyHouseModel({
  address,
  latitude,
  longitude,
  building,
  photos = [],
  photoAnalysis,
  satelliteAnalysis,
  sidingMeasurements,
  roofSegments,
}) {
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [selectedFacade, setSelectedFacade] = useState('customer');

  const payload = useMemo(() => {
    const hasPhotos = (photos || []).length > 0;
    const hasMeasure = Boolean(photoAnalysis || satelliteAnalysis || sidingMeasurements || building);
    if (!hasPhotos && !hasMeasure) return null;

    const assembled = assembleEstimatorHouse({
      photos,
      photoAnalysis,
      satelliteAnalysis: {
        ...(satelliteAnalysis || {}),
        building_length_ft: building?.building_length_ft ?? satelliteAnalysis?.building_length_ft,
        building_width_ft: building?.building_width_ft ?? satelliteAnalysis?.building_width_ft,
        story_count: building?.story_count ?? satelliteAnalysis?.story_count,
        story_height_ft: building?.story_height_ft ?? satelliteAnalysis?.story_height_ft,
        pitch: building?.pitch ?? satelliteAnalysis?.pitch,
        roof_type: building?.roof_type ?? satelliteAnalysis?.roof_type,
        latitude: latitude ?? satelliteAnalysis?.latitude,
        longitude: longitude ?? satelliteAnalysis?.longitude,
      },
      sidingMeasurements,
      roofSegments: roofSegments || satelliteAnalysis?.roof_segments,
      originLat: latitude,
      originLng: longitude,
    });
    return {
      success: true,
      source: assembled.source,
      model: toViewerModel(assembled, { photos }),
    };
  }, [photos, photoAnalysis, satelliteAnalysis, sidingMeasurements, building, roofSegments, latitude, longitude]);

  if (!payload?.model) return null;

  const model = payload.model;
  const photoCount = (photos || []).length;
  const texturedWalls = (model.faces || []).filter(f => f.type === 'WALL' && f.photoUrl).length;

  return (
    <div className="space-y-3" data-testid="property-house-model">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Home className="w-4 h-4 text-slate-600" />
          <span className="text-sm font-semibold text-slate-800">3D house from photos</span>
          {texturedWalls > 0 && (
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">
              {texturedWalls} textured wall{texturedWalls === 1 ? '' : 's'}
            </Badge>
          )}
          {model.assembled && (
            <Badge variant="outline" data-testid="badge-assembled">Roof attached</Badge>
          )}
        </div>
        {photoCount > 0 && (
          <span className="text-xs text-gray-500 flex items-center gap-1">
            <Camera className="w-3 h-3" />
            {photoCount} uploaded photo{photoCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {address && <p className="text-xs text-gray-500">{address}</p>}

      <ElevationDrawings elevations={model.elevations} />
      <HouseModelViewer
        model={model}
        selectedMaterial={selectedMaterial}
        selectedFacade={selectedFacade}
        onSelectMaterial={setSelectedMaterial}
        onSelectFacade={(id) => {
          setSelectedFacade(id);
          setSelectedMaterial(null);
        }}
      />
      <p className="text-xs text-gray-500" data-testid="house-model-source-note">
        Assembled from your uploaded facade photos and the estimator’s photo/satellite/solar measurements
        in one coordinate frame. This is not a Hover capture or photogrammetry twin — roof planes sit on
        the wall footprint (no floating Solar boxes).
      </p>
    </div>
  );
}
