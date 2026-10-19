import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import InteractiveRoofMap from '@/components/satellite/InteractiveRoofMap'
import { installMockGoogleMaps } from './mockGoogleMaps'
import '@/index.css'

// 38 South Cir, Bedford OH. Esri imagery is drawn by the map double because
// this environment has no Google Maps JavaScript key.
const LAT = 41.3828633
const LNG = -81.5607747

installMockGoogleMaps({
  visual: true,
  zoom: 21,
  center: { lat: LAT, lng: LNG },
})

function Preview() {
  const [saved, setSaved] = useState(null)
  const lines = saved?.manual_lines || []
  return (
    <div className="mx-auto max-w-5xl bg-white p-3 md:p-6">
      <p className="mb-3 text-xs text-gray-500" data-testid="preview-imagery-note">
        38 South Cir, Bedford OH — Esri World Imagery under the real manual trace. Map clicks use a local Google Maps stand-in; no Google JavaScript API key is configured here.
      </p>
      {saved && (
        <div className="mb-3 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900" data-testid="save-success">
          <p className="font-semibold">Measurements saved</p>
          <p>
            {(Number(saved.corrected_area_sq) || 0).toFixed(2)} SQ
            {' · '}Ridge {(Number(saved.ridge_lf) || 0).toFixed(1)} LF
            {' · '}Hip {(Number(saved.hip_lf) || 0).toFixed(1)} LF
            {' · '}Rake {(Number(saved.rake_lf) || 0).toFixed(1)} LF
            {' · '}Eave {(Number(saved.eave_lf) || 0).toFixed(1)} LF
            {' · '}Drip edge {(Number(saved.drip_edge_lf) || 0).toFixed(1)} LF
          </p>
          {lines.length > 0 && (
            <p>
              Drawn lines: {lines.map((line) => `${String(line.type).replace('_', ' ')} ${Number(line.length_ft).toFixed(1)} ft`).join(', ')}
            </p>
          )}
        </div>
      )}
      <InteractiveRoofMap
        latitude={LAT}
        longitude={LNG}
        address="38 South Cir, Bedford OH"
        googleMapsLoaded
        initialMeasurements={{ pitch: '4/12' }}
        onMeasurementsComplete={setSaved}
        onBack={() => {}}
      />
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<Preview />)
