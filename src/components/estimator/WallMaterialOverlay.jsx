import React from 'react';

const MATERIALS = ['siding', 'stone', 'stucco', 'brick', 'trim'];
const COLORS = {
  siding: '#38bdf8',
  stone: '#78716c',
  stucco: '#d97706',
  brick: '#b91c1c',
  trim: '#7c3aed',
};

function photoUrlFor(section, photos, elevationImages) {
  const label = String(section?.view_label || '').toLowerCase();
  const uploaded = (photos || []).find((photo) => String(photo?.label || '').toLowerCase() === label && (photo.url || photo.preview));
  if (uploaded) return uploaded.url || uploaded.preview;
  const street = (elevationImages || []).find((image) => {
    const name = String(image?.direction || image?.label || '').toLowerCase();
    return name && name === label;
  });
  return street?.imageUrl || street?.url || null;
}

function frameOf(sections) {
  let minX = 0;
  let maxX = 1;
  let minY = 0;
  let maxY = 1;
  for (const section of sections) {
    for (const point of section.polygon || []) {
      minX = Math.min(minX, Number(point[0]));
      maxX = Math.max(maxX, Number(point[0]));
      minY = Math.min(minY, Number(point[1]));
      maxY = Math.max(maxY, Number(point[1]));
    }
  }
  const pad = 0.02;
  return {
    minX: minX - pad,
    minY: minY - pad,
    width: Math.max(0.2, maxX - minX + pad * 2),
    height: Math.max(0.2, maxY - minY + pad * 2),
  };
}

function pointsAttr(polygon) {
  return (polygon || []).map((point) => `${point[0]},${point[1]}`).join(' ');
}

/**
 * Wall-frame material regions. Coordinates are the analyzer's frame
 * (x along the wall, y from the eave down to grade), drawn over the photo
 * so a rep can tap a region and retag it.
 */
export default function WallMaterialOverlay({
  measurement,
  photos = [],
  elevationImages = [],
  onRetag,
}) {
  const overlay = measurement?.overlay || [];
  if (!overlay.length) return null;
  const groups = [];
  const byPhoto = new Map();
  for (const section of overlay) {
    const key = section.photo_index ?? section.view_label;
    if (!byPhoto.has(key)) {
      const bucket = [];
      byPhoto.set(key, bucket);
      groups.push({ key, sections: bucket, sample: section });
    }
    byPhoto.get(key).push(section);
  }
  const totals = measurement.totals_gross_sqft || {};
  const nextMaterial = (current) => {
    const index = MATERIALS.indexOf(current);
    return MATERIALS[(index + 1) % MATERIALS.length];
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2" data-testid="wall-material-overlay">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-gray-700">Material sections</p>
        <p className="text-[10px] text-gray-500">Tap a region to retag. Eave is the top of the drawing, grade is the bottom.</p>
      </div>
      <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
        {MATERIALS.filter((material) => Number(totals[material]) > 0).map((material) => (
          <span key={material} className="inline-flex items-center gap-1 capitalize text-gray-700">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[material] }} />
            {material} {Math.round(totals[material]).toLocaleString()} ft²
          </span>
        ))}
        <span className="text-gray-500">
          {measurement.story?.story_count ? `${measurement.story.story_count} stories` : 'stories unset'}
          {measurement.perimeter_ft ? ` · ${measurement.perimeter_ft} LF ${measurement.perimeter_source || ''}` : ''}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {groups.map((group) => {
          const frame = frameOf(group.sections);
          const url = photoUrlFor(group.sample, photos, elevationImages);
          return (
            <div key={group.key} className="rounded border border-slate-100 p-1.5">
              <p className="mb-1 text-[11px] font-medium capitalize text-gray-600">
                {group.sample.view_label || group.sample.wall_face || 'Elevation'}
                {group.sample.wall_face ? ` · ${group.sample.wall_face}` : ''}
              </p>
              <div className="relative overflow-hidden rounded bg-slate-100" style={{ aspectRatio: '4 / 3' }}>
                {url && (
                  <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                )}
                <svg
                  className="absolute inset-0 h-full w-full"
                  viewBox={`${frame.minX} ${frame.minY} ${frame.width} ${frame.height}`}
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="Material regions"
                >
                  {group.sections.map((section) => (
                    <polygon
                      key={section.id}
                      points={pointsAttr(section.polygon)}
                      fill={COLORS[section.material] || '#94a3b8'}
                      fillOpacity={section.needs_review ? 0.35 : 0.55}
                      stroke="#ffffff"
                      strokeWidth={0.015}
                      className="cursor-pointer"
                      data-testid={`material-section-${section.id}`}
                      onClick={() => onRetag?.(section.id, nextMaterial(section.material))}
                    >
                      <title>
                        {`${section.material || 'untagged'} · ${section.area_sqft || 0} ft². Tap to retag.`}
                      </title>
                    </polygon>
                  ))}
                </svg>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {group.sections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className="rounded border px-1.5 py-0.5 text-[10px] capitalize"
                    style={{ borderColor: COLORS[section.material] || '#94a3b8' }}
                    onClick={() => onRetag?.(section.id, nextMaterial(section.material))}
                  >
                    {section.material || 'untagged'} {section.area_sqft || 0} ft²
                    {section.rep_corrected ? ' · edited' : ''}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
