import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, Home, AlertTriangle, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import HouseModelViewer from './HouseModelViewer';
import ElevationDrawings from './ElevationDrawings';
import { assembleHoverHouse, assembleSolarHouse, toViewerModel } from '@/lib/houseGeometry';

export default function PropertyHouseModel({
  address,
  latitude,
  longitude,
  hoverJobId: hoverJobIdProp,
  building,
  photos,
  onHoverJobIdChange,
}) {
  const [hoverJobId, setHoverJobId] = useState(hoverJobIdProp || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [payload, setPayload] = useState(null);
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [selectedFacade, setSelectedFacade] = useState('customer');

  useEffect(() => {
    if (hoverJobIdProp && hoverJobIdProp !== hoverJobId) setHoverJobId(hoverJobIdProp);
  }, [hoverJobIdProp]);

  const load = async (jobId = hoverJobId) => {
    if (!address && !jobId && !latitude) return;
    setLoading(true);
    setError(null);
    try {
      const result = await base44.functions.invoke('getHoverHouseModel', {
        address,
        latitude,
        longitude,
        hoverJobId: jobId || undefined,
        building,
        photos: (photos || []).map(p => ({ label: p.label || p.name, url: p.url || p.imageUrl })),
      });
      const data = result?.data || result;
      let next = data;
      if (!next?.model && next?.xml) {
        next = {
          ...next,
          success: true,
          source: 'hover',
          hover_used: true,
          model: toViewerModel(assembleHoverHouse(next.xml, { address })),
        };
      }
      if (!next?.model) {
        const assembled = assembleSolarHouse({
          lengthFt: building?.building_length_ft,
          widthFt: building?.building_width_ft,
          eaveHeightFt: (Number(building?.story_count) || 1) * (Number(building?.story_height_ft) || 9),
          pitch: building?.pitch || '6/12',
          roofType: building?.roof_type || 'gable',
        });
        next = {
          success: true,
          source: 'solar_assembled',
          hover_configured: Boolean(next?.hover_configured),
          hover_used: false,
          hover_reason: next?.hover_reason || 'hover_unavailable',
          model: toViewerModel(assembled, { photos }),
          debug_logs: next?.debug_logs,
        };
      }
      if (!next?.model) throw new Error(next?.error || 'Could not build house model');
      setPayload(next);
      if (next.source === 'hover') setSelectedFacade('customer');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, latitude, longitude, JSON.stringify(building || {}), hoverJobIdProp]);

  const model = payload?.model;

  return (
    <div className="space-y-3" data-testid="property-house-model">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Home className="w-4 h-4 text-slate-600" />
          <span className="text-sm font-semibold text-slate-800">3D house model</span>
          {payload?.source === 'hover' && <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">Hover geometry</Badge>}
          {payload?.source === 'solar_assembled' && <Badge variant="outline">Assembled footprint</Badge>}
          {payload?.hover_configured === false && (
            <Badge className="bg-amber-50 text-amber-800 border-amber-200">Hover token not configured</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={hoverJobId}
            onChange={e => setHoverJobId(e.target.value)}
            placeholder="Hover job ID (e.g. 2-1514588)"
            className="h-8 w-52 text-xs"
            data-testid="input-hover-job-id"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => {
              onHoverJobIdChange?.(hoverJobId);
              load(hoverJobId);
            }}
            data-testid="button-load-hover-job"
          >
            Load Hover job
          </Button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-100 rounded-lg p-3">
          <Loader2 className="w-4 h-4 animate-spin" />
          Building assembled 3D model…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {model && (
        <>
          <ElevationDrawings elevations={model.elevations} source={payload.source} />
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
          {payload.hover_used === false && payload.hover_reason === 'hover_credentials_missing' && (
            <p className="text-xs text-gray-500">
              Hover API env vars are not set on this server, so this view uses an assembled footprint (roof attached to walls) instead of exploded Solar facets. To show Kevin’s real Antoinette model, set <code>HOVER_CLIENT_ID</code>, <code>HOVER_CLIENT_SECRET</code>, and <code>HOVER_REFRESH_TOKEN</code> (read in <code>src/lib/hoverHouseModel.js</code>) then load job <code>2-1514588</code>.
            </p>
          )}
          {model.hover?.experienceUrl && (
            <a
              href={model.hover.experienceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600"
            >
              Open Hover 3D experience <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </>
      )}
    </div>
  );
}
