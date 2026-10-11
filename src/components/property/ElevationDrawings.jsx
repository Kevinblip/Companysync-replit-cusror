import React from 'react';

function polylinePoints(outline, width, height, pad = 18) {
  if (!outline?.length || !width || !height) return '';
  const maxU = Math.max(...outline.map(p => p.u), width);
  const maxV = Math.max(...outline.map(p => p.v), height);
  const innerW = 220 - pad * 2;
  const innerH = 88;
  return outline
    .map((p, i) => {
      const x = pad + (p.u / maxU) * innerW;
      const y = pad + innerH - (p.v / maxV) * innerH;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ') + ' Z';
}

export default function ElevationDrawings({ elevations = [], source }) {
  return (
    <div className="space-y-2" data-testid="elevation-drawings">
      <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
        Elevation drawings (to scale)
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {elevations.map(el => {
          const estimated = el.estimated && source !== 'hover';
          const d = polylinePoints(el.outline, el.width_ft, el.height_ft);
          return (
            <div
              key={el.id}
              data-testid={`elevation-${el.id}`}
              className={`rounded-lg border bg-white p-3 ${estimated ? 'border-dashed border-orange-300' : 'border-emerald-200'}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium ${estimated ? 'text-orange-700' : 'text-gray-700'}`}>
                  {el.label} — {estimated ? 'estimated' : (el.photographed ? 'photographed' : 'Hover model')}
                </span>
                {el.materials?.length > 0 && (
                  <span className="text-[10px] text-gray-400">{el.materials.join(', ')}</span>
                )}
              </div>
              <svg viewBox="0 0 220 130" className="w-full h-28">
                {d && (
                  <path
                    d={d}
                    fill={estimated ? `url(#hatch-${el.id})` : '#f8fafc'}
                    stroke={estimated ? '#c2410c' : '#334155'}
                    strokeWidth="1.4"
                    strokeDasharray={estimated ? '4 3' : undefined}
                  />
                )}
                <defs>
                  <pattern id={`hatch-${el.id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="6" stroke="#fdba74" strokeWidth="1" />
                  </pattern>
                </defs>
                <text x="110" y="64" textAnchor="middle" fontSize="8" fill={estimated ? '#c2410c' : '#334155'} fontWeight="600">
                  {el.caption}
                </text>
                <text x="110" y="122" textAnchor="middle" fontSize="9" fill="#2563eb">{el.width_ft} ft</text>
                <text x="12" y="70" textAnchor="middle" fontSize="9" fill="#2563eb" transform={`rotate(-90 12 70)`}>{el.height_ft} ft</text>
              </svg>
            </div>
          );
        })}
      </div>
    </div>
  );
}
