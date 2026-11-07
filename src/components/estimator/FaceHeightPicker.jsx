import React, { useState } from 'react';
import { isStagingMaterialPickerHost } from './FaceMaterialPicker';

const FACES = ['front', 'back', 'left_side', 'right_side'];

const CHOICES = [
  { id: '1', label: '1', stories: 1 },
  { id: '1.5', label: '1.5', stories: 1.5 },
  { id: '2', label: '2', stories: 2 },
  { id: 'split', label: 'Split', stories: 'split' },
];

function formatFt(value) {
  const eave = Number(value);
  if (!(eave > 0)) return '—';
  return `${Math.round(eave * 10) / 10} ft`;
}

/**
 * Per-wall height picker. The AI guess is shown; one tap locks 1, 1.5, 2,
 * or split-level. Measure with ruler opens the door ruler for that face.
 * Same hosts as the material picker: localhost and staging only.
 */
export default function FaceHeightPicker({
  faces,
  busy = false,
  onConfirm,
  onMeasure,
  suggestedStories = null,
}) {
  const [splitFt, setSplitFt] = useState({});

  if (typeof window === 'undefined') return null;
  if (!isStagingMaterialPickerHost(window.location.hostname)) return null;
  const rows = (Array.isArray(faces) ? faces : []).filter((row) => FACES.includes(row?.face));
  if (!rows.length) return null;

  return (
    <div className="rounded border border-slate-200 bg-white p-3 space-y-2" data-testid="face-height-picker">
      <p className="text-xs font-semibold text-slate-800">Wall height</p>
      <p className="text-xs text-slate-500">
        The AI guess is on the left. Tap 1, 1.5, 2, or Split to lock that wall. 1 is 10 ft, 2 is 19 ft, 1.5 is a 10 ft side with the gable end between them, and Split defaults to 11 ft. Measure with ruler uses a garage or entry door on that wall&apos;s photo.
      </p>
      {FACES.map((face) => {
        const row = rows.find((item) => item.face === face);
        if (!row) return null;
        const splitValue = splitFt[face] ?? (row.stories === 'split' && row.eaveFt > 0 ? row.eaveFt : 11);
        return (
          <div key={face} className="flex flex-wrap items-center gap-2" data-testid={`face-height-row-${face}`}>
            <div className="min-w-[11rem]">
              <p className="text-xs font-medium text-slate-700">{row.label || face.replace(/_/g, ' ')}</p>
              <p className="text-[11px] text-slate-500" data-testid={`face-height-ai-${face}`}>
                AI {formatFt(row.aiEaveFt)}
              </p>
              {row.confirmed ? (
                <p className="text-[11px] text-emerald-700" data-testid={`face-height-confirmed-${face}`}>
                  Confirmed {formatFt(row.eaveFt)}
                  {row.stories != null ? ` · ${row.stories}` : ''}
                </p>
              ) : null}
            </div>
            {CHOICES.map((choice) => {
              const suggested = !row.confirmed && suggestedStories != null && String(suggestedStories) === String(choice.stories);
              return (
                <button
                  key={choice.id}
                  type="button"
                  data-testid={`face-height-${face}-${choice.id}`}
                  disabled={busy}
                  className={`rounded border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${suggested ? 'border-teal-600 bg-teal-50 text-teal-900' : 'border-slate-300 bg-white text-slate-800'}`}
                  onClick={() => onConfirm?.(face, {
                    stories: choice.stories,
                    ...(choice.stories === 'split' ? { eave_ft: Number(splitValue) || 11 } : {}),
                    source: 'tap',
                  })}
                >
                  {choice.label}
                </button>
              );
            })}
            <label className="text-[11px] text-slate-600">
              Split ft
              <input
                data-testid={`face-height-${face}-split-ft`}
                type="number"
                min="6"
                max="45"
                step="0.1"
                className="mt-0.5 block w-16 rounded border border-slate-300 px-1 py-0.5 text-xs"
                value={splitValue}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setSplitFt((prev) => ({ ...prev, [face]: value }));
                }}
              />
            </label>
            <button
              type="button"
              data-testid={`face-height-measure-${face}`}
              disabled={busy}
              className="rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
              onClick={() => onMeasure?.(face)}
            >
              Measure with ruler
            </button>
          </div>
        );
      })}
    </div>
  );
}
