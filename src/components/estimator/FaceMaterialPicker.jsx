import React, { useEffect, useState } from 'react';

const MATERIALS = ['stone', 'stucco', 'brick', 'siding'];
const FACES = ['front', 'back', 'left_side', 'right_side'];

/** The picker is a staging review control. Production hosts do not render it. */
export function isStagingMaterialPickerHost(hostname = '') {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host.includes('staging');
}

function roundedShares(shares) {
  return MATERIALS.reduce((out, material) => {
    const value = Math.round(Number(shares?.[material]) || 0);
    out[material] = Math.max(0, Math.min(100, value));
    return out;
  }, {});
}

/**
 * Per-wall material picker. Values start from the AI proposal. Confirming a
 * wall sends those percents back as the billed material and skips the AI read.
 */
export default function FaceMaterialPicker({ proposals, busy = false, onConfirm }) {
  const [drafts, setDrafts] = useState({});

  useEffect(() => {
    const next = {};
    for (const proposal of proposals || []) {
      if (!FACES.includes(proposal?.face)) continue;
      next[proposal.face] = roundedShares(proposal.shares);
    }
    setDrafts(next);
  }, [proposals]);

  if (typeof window === 'undefined') return null;
  if (!isStagingMaterialPickerHost(window.location.hostname)) return null;
  if (!Array.isArray(proposals) || proposals.length === 0) return null;

  return (
    <div className="rounded border border-slate-200 bg-white p-3 space-y-2" data-testid="face-material-picker">
      <p className="text-xs font-semibold text-slate-800">Wall materials</p>
      <p className="text-xs text-slate-500">
        Prefilled from the AI read. Confirm a wall to bill those percents and skip the next AI read for that wall.
      </p>
      {FACES.map((face) => {
        const proposal = proposals.find((row) => row.face === face);
        if (!proposal) return null;
        const shares = drafts[face] || roundedShares(proposal.shares);
        return (
          <div key={face} className="flex flex-wrap items-end gap-2" data-testid={`face-material-row-${face}`}>
            <div className="min-w-[11rem]">
              <p className="text-xs font-medium text-slate-700">{proposal.label}</p>
              {proposal.confirmed ? (
                <p className="text-[11px] text-emerald-700" data-testid={`face-material-confirmed-${face}`}>Confirmed</p>
              ) : null}
            </div>
            {MATERIALS.map((material) => (
              <label key={material} className="text-[11px] text-slate-600">
                {material}
                <input
                  data-testid={`face-material-${face}-${material}`}
                  type="number"
                  min="0"
                  max="100"
                  className="mt-0.5 block w-16 rounded border border-slate-300 px-1 py-0.5 text-xs"
                  value={shares[material] ?? 0}
                  onChange={(event) => {
                    const value = Math.max(0, Math.min(100, Number(event.target.value) || 0));
                    setDrafts((prev) => ({
                      ...prev,
                      [face]: { ...(prev[face] || roundedShares(proposal.shares)), [material]: value },
                    }));
                  }}
                />
              </label>
            ))}
            <button
              type="button"
              data-testid={`face-material-confirm-${face}`}
              disabled={busy}
              className="rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
              onClick={() => onConfirm?.(face, { ...shares })}
            >
              Confirm
            </button>
          </div>
        );
      })}
    </div>
  );
}
