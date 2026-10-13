import { renderElevationSet } from '@/utils/elevationDrawings';

/**
 * Shared elevation-drawings grid: to-scale front/right/back/left drawings
 * rendered from siding measurement data. Un-photographed faces render dashed
 * with an "estimated" tag.
 *
 * The SVG strings come from our own builder (all values escaped there); no
 * user-controlled HTML reaches the dangerouslySetInnerHTML sink.
 */
export default function ElevationDrawingsGrid({ measurements, satellite }) {
  if (!measurements) return null;
  return (
    <div className="mt-2">
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Elevation drawings (to scale)</p>
      <div className="grid grid-cols-2 gap-2">
        {renderElevationSet(measurements, satellite || {}).map(({ model, svg }) => (
          <div key={model.face} className={`bg-white rounded border ${model.photographed ? 'border-gray-200' : 'border-dashed border-amber-300'} p-1`}>
            <p className={`text-[10px] font-medium text-center ${model.photographed ? 'text-gray-500' : 'text-amber-600'}`}>
              {model.label}{model.photographed ? '' : ' — estimated'}
            </p>
            <div className="flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
        ))}
      </div>
    </div>
  );
}
