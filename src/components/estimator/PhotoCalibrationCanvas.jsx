import React, { useState, useRef, useCallback, useEffect } from 'react';
import { eaveFeetFromRatio } from '../../utils/photoRuler.cjs';

/**
 * PhotoCalibrationCanvas — interactive calibration & measurement ruler overlay.
 *
 * Draw a known reference line (Line A, cyan — e.g. an 80" door) on an elevation
 * photo, then a target line (Line B, yellow — ground to eave) and optional
 * Line C (magenta — ground to gable peak). Heights are computed from the
 * pixel ratio: height_ft = (lineB_px / lineA_px) × (reference_inches / 12).
 *
 * All coordinates are stored NORMALIZED (0..1 fractions of the rendered image)
 * so window resize / zoom never changes the ratio math — ratios of normalized
 * lengths are identical to ratios of pixel lengths at any scale, as long as
 * both lines use the same aspect mapping (we convert to true pixel space using
 * the rendered image size before measuring, so diagonal lines are correct too).
 *
 * Touch-friendly: 22px-radius invisible hit targets around each handle,
 * pointer-event based (works with mouse, touch, pen).
 */

export const CALIBRATION_PRESETS = [
  { id: 'door', label: 'Front Door (80")', inches: 80 },
  { id: 'garage', label: 'Garage Door (84")', inches: 84 },
  { id: 'siding', label: '10 Siding Courses @ 4.5" (45")', inches: 45 },
  { id: 'custom', label: 'Custom (inches)', inches: null },
];

const HANDLE_R = 8;        // visible handle radius (px)
const HIT_R = 22;          // invisible touch target radius (px)

const DEFAULT_LINES = {
  // Line A: roughly where a front door usually sits (left-center, door-height span)
  a: { x1: 0.32, y1: 0.55, x2: 0.32, y2: 0.82 },
  // Line B: photo-center vertical, ground to upper wall
  b: { x1: 0.55, y1: 0.18, x2: 0.55, y2: 0.85 },
  // Line C: gable peak (hidden until enabled)
  c: { x1: 0.75, y1: 0.08, x2: 0.75, y2: 0.85 },
};

function formatFtIn(ft) {
  if (!ft || !isFinite(ft) || ft <= 0) return '—';
  const whole = Math.floor(ft);
  const inches = Math.round((ft - whole) * 12);
  if (inches === 12) return `${whole + 1}' 0"`;
  return `${whole}' ${inches}"`;
}

export default function PhotoCalibrationCanvas({
  imageUrl,
  initialCalibration = null,   // { lines, presetId, customInches, showGable }
  aiDoorBox = null,            // optional { x, y, w, h } normalized bbox of a detected door
  onChange = null,             // fires live: ({ eaveFt, gableFt, calibration })
}) {
  const containerRef = useRef(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 }); // rendered px size
  const [natural, setNatural] = useState({ w: 1, h: 1 });
  const [lines, setLines] = useState(() => {
    if (initialCalibration?.lines) return initialCalibration.lines;
    if (aiDoorBox) {
      return {
        ...DEFAULT_LINES,
        a: {
          x1: aiDoorBox.x + aiDoorBox.w / 2, y1: aiDoorBox.y,
          x2: aiDoorBox.x + aiDoorBox.w / 2, y2: aiDoorBox.y + aiDoorBox.h,
        },
      };
    }
    return DEFAULT_LINES;
  });
  const [presetId, setPresetId] = useState(initialCalibration?.presetId || 'door');
  const [customInches, setCustomInches] = useState(initialCalibration?.customInches || 80);
  const [showGable, setShowGable] = useState(initialCalibration?.showGable || false);
  const dragRef = useRef(null); // { line: 'a'|'b'|'c', point: 1|2 }

  const refInches = presetId === 'custom'
    ? (Number(customInches) || 0)
    : (CALIBRATION_PRESETS.find(p => p.id === presetId)?.inches || 80);

  // ── Measure rendered image size (ResizeObserver keeps overlay in sync) ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setImgSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Length of a line in TRUE pixel space (aspect-correct for diagonals) ──
  const pxLen = useCallback((ln) => {
    const dx = (ln.x2 - ln.x1) * imgSize.w;
    const dy = (ln.y2 - ln.y1) * imgSize.h;
    return Math.sqrt(dx * dx + dy * dy);
  }, [imgSize]);

  const lenA = pxLen(lines.a);
  const lenB = pxLen(lines.b);
  const lenC = pxLen(lines.c);
  // Same ratio the estimator uses when it scales a detected door.
  const eaveFt = eaveFeetFromRatio(lenA, lenB, refInches);
  const gableFt = showGable ? eaveFeetFromRatio(lenA, lenC, refInches) : 0;

  // Live-report upward
  useEffect(() => {
    if (!onChange) return;
    onChange({
      eaveFt: Math.round(eaveFt * 10) / 10,
      gableFt: showGable ? Math.round(gableFt * 10) / 10 : null,
      calibration: { lines, presetId, customInches, showGable },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eaveFt, gableFt, showGable, lines, presetId, customInches]);

  // ── Pointer drag handling ──────────────────────────────────────────────
  const clientToNorm = useCallback((clientX, clientY) => {
    const r = containerRef.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
    };
  }, []);

  const onPointerDown = (line, point) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { line, point };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const { line, point } = dragRef.current;
    const { x, y } = clientToNorm(e.clientX, e.clientY);
    setLines(prev => ({
      ...prev,
      [line]: { ...prev[line], [`x${point}`]: x, [`y${point}`]: y },
    }));
  };
  const onPointerUp = () => { dragRef.current = null; };

  const toPx = (nx, ny) => ({ x: nx * imgSize.w, y: ny * imgSize.h });

  const renderLine = (key, color, label, dash = false) => {
    const ln = lines[key];
    const p1 = toPx(ln.x1, ln.y1);
    const p2 = toPx(ln.x2, ln.y2);
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    return (
      <g key={key}>
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
          stroke={color} strokeWidth={3} strokeDasharray={dash ? '6 4' : undefined}
          style={{ filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.8))' }} />
        {[{ p: p1, n: 1 }, { p: p2, n: 2 }].map(({ p, n }) => (
          <g key={n}>
            {/* Invisible large touch target */}
            <circle cx={p.x} cy={p.y} r={HIT_R} fill="transparent"
              style={{ cursor: 'grab', touchAction: 'none' }}
              onPointerDown={onPointerDown(key, n)} />
            <circle cx={p.x} cy={p.y} r={HANDLE_R} fill={color} stroke="#fff" strokeWidth={2}
              pointerEvents="none" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }} />
          </g>
        ))}
        <text x={mid.x + 10} y={mid.y} fill={color} fontSize={13} fontWeight="bold"
          pointerEvents="none" style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.9))' }}>
          {label}
        </text>
      </g>
    );
  };

  return (
    <div className="select-none">
      {/* ── Live readout header ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 px-1">
        <div className="text-sm font-bold text-emerald-600" data-testid="text-calibrated-eave">
          Calibrated Eave Height: <span className="text-lg">{formatFtIn(eaveFt)}</span>
          {eaveFt > 0 && <span className="text-xs font-normal text-gray-500 ml-1">({eaveFt.toFixed(1)} ft)</span>}
        </div>
        {showGable && (
          <div className="text-sm font-bold text-fuchsia-600" data-testid="text-calibrated-gable">
            Gable Peak: <span className="text-base">{formatFtIn(gableFt)}</span>
          </div>
        )}
      </div>

      {/* ── Controls ── */}
      <div className="flex flex-wrap items-center gap-2 mb-2 px-1">
        <select
          value={presetId}
          onChange={e => setPresetId(e.target.value)}
          className="text-xs border rounded-md px-2 py-1.5 bg-white"
          data-testid="select-calibration-preset"
        >
          {CALIBRATION_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {presetId === 'custom' && (
          <input
            type="number" min="1" step="0.5" value={customInches}
            onChange={e => setCustomInches(e.target.value)}
            className="w-20 text-xs border rounded-md px-2 py-1.5"
            placeholder="inches"
            data-testid="input-custom-inches"
          />
        )}
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showGable} onChange={e => setShowGable(e.target.checked)}
            data-testid="checkbox-gable-line" />
          Measure gable peak (Line C)
        </label>
      </div>

      {/* ── Photo + SVG overlay ── */}
      <div
        ref={containerRef}
        className="relative w-full rounded-lg overflow-hidden bg-black"
        style={{ touchAction: 'none' }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          src={imageUrl}
          alt="Calibration"
          className="w-full h-auto block"
          draggable={false}
          onLoad={e => setNatural({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
        />
        {imgSize.w > 0 && (
          <svg
            className="absolute inset-0 w-full h-full"
            width={imgSize.w} height={imgSize.h}
            style={{ touchAction: 'none' }}
          >
            {renderLine('a', '#22d3ee', `A — Reference (${refInches}")`)}
            {renderLine('b', '#facc15', `B — Eave ${formatFtIn(eaveFt)}`)}
            {showGable && renderLine('c', '#e879f9', `C — Peak ${formatFtIn(gableFt)}`, true)}
          </svg>
        )}
      </div>

      <p className="text-[11px] text-gray-500 mt-1.5 px-1">
        Drag the <span className="text-cyan-600 font-semibold">cyan Line A</span> endpoints onto a known object
        (top &amp; bottom of a door). Drag the <span className="text-yellow-600 font-semibold">yellow Line B</span> from
        the ground to the eave (where the roof starts).
      </p>
    </div>
  );
}
