import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Ruler, Trash2, Check, X, ChevronDown, ChevronUp, Plus } from 'lucide-react';

const CATEGORIES = [
  { value: 'shingle_length',   label: 'Shingle Length',    color: '#3b82f6',  unit: 'in' },
  { value: 'shingle_width',    label: 'Shingle Width',     color: '#06b6d4',  unit: 'in' },
  { value: 'shingle_exposure', label: 'Shingle Exposure',  color: '#8b5cf6',  unit: 'in' },
  { value: 'ridge_length',     label: 'Ridge',             color: '#ef4444',  unit: 'ft' },
  { value: 'eave_length',      label: 'Eave / Rake',       color: '#f59e0b',  unit: 'ft' },
  { value: 'valley_length',    label: 'Valley',            color: '#10b981',  unit: 'ft' },
  { value: 'hip_length',       label: 'Hip',               color: '#ec4899',  unit: 'ft' },
  { value: 'slope_width',      label: 'Slope Width',       color: '#f97316',  unit: 'ft' },
  { value: 'slope_height',     label: 'Slope Height',      color: '#a855f7',  unit: 'ft' },
  { value: 'flashing',         label: 'Flashing',          color: '#64748b',  unit: 'ft' },
  { value: 'custom',           label: 'Other / Custom',    color: '#6b7280',  unit: 'ft' },
];

const UNIT_OPTIONS = ['in', 'ft', 'LF', 'sq ft'];

const SHINGLE_QUICK_VALUES = [
  { label: '12"',    value: '12',    unit: 'in' },
  { label: '36"',    value: '36',    unit: 'in' },
  { label: '39⅜"',  value: '39.375', unit: 'in' },
  { label: '5½" exp', value: '5.5',  unit: 'in' },
];

function getCategoryMeta(cat) {
  return CATEGORIES.find(c => c.value === cat) || CATEGORIES[CATEGORIES.length - 1];
}

function px(norm, total) { return norm * total; }

export default function PhotoMeasureTool({ photoUrl, existingMeasurements = [], onSave, onClose }) {
  const imgRef  = useRef(null);
  const svgRef  = useRef(null);
  const wrapRef = useRef(null);

  const [imgBox,   setImgBox]   = useState(null);   // {left, top, width, height} relative to wrap
  const [drawStep, setDrawStep] = useState('idle'); // idle | pointA | pointB
  const [ptA,      setPtA]      = useState(null);   // {x,y} 0-1
  const [live,     setLive]     = useState(null);   // {x,y} 0-1 cursor while drawing
  const [draft,    setDraft]    = useState(null);   // {x1,y1,x2,y2}
  const [showForm, setShowForm] = useState(false);
  const [showList, setShowList] = useState(false);
  const [category, setCategory] = useState('shingle_length');
  const [value,    setValue]    = useState('');
  const [unit,     setUnit]     = useState('in');
  const [label,    setLabel]    = useState('');
  const [measurements, setMeasurements] = useState(
    (existingMeasurements || []).map((m, i) => ({ ...m, id: m.id || `m-${Date.now()}-${i}` }))
  );

  const measureCount = measurements.length;

  const updateBox = useCallback(() => {
    if (!imgRef.current || !wrapRef.current) return;
    const ir = imgRef.current.getBoundingClientRect();
    const wr = wrapRef.current.getBoundingClientRect();
    setImgBox({ left: ir.left - wr.left, top: ir.top - wr.top, width: ir.width, height: ir.height });
  }, []);

  useEffect(() => {
    updateBox();
    window.addEventListener('resize', updateBox);
    return () => window.removeEventListener('resize', updateBox);
  }, [updateBox]);

  useEffect(() => {
    if (!imgRef.current) return;
    if (imgRef.current.complete) updateBox();
    else imgRef.current.onload = updateBox;
  }, [photoUrl, updateBox]);

  const toNorm = useCallback((clientX, clientY) => {
    if (!imgRef.current) return null;
    const r = imgRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (clientY - r.top)  / r.height)),
    };
  }, []);

  const handlePointerDown = (e) => {
    if (showForm || drawStep === 'idle') return;
    e.preventDefault();
    updateBox();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const pt = toNorm(clientX, clientY);
    if (!pt) return;

    if (drawStep === 'pointA') {
      setPtA(pt);
      setDrawStep('pointB');
    } else if (drawStep === 'pointB' && ptA) {
      setDraft({ x1: ptA.x, y1: ptA.y, x2: pt.x, y2: pt.y });
      setPtA(null);
      setLive(null);
      setDrawStep('idle');
      setShowForm(true);
    }
  };

  const handlePointerMove = (e) => {
    if (drawStep === 'idle') return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const pt = toNorm(clientX, clientY);
    if (pt) setLive(pt);
  };

  const startDraw = () => {
    setDrawStep('pointA');
    setPtA(null);
    setLive(null);
    setShowList(false);
  };

  const cancelDraw = () => {
    setDrawStep('idle');
    setPtA(null);
    setLive(null);
  };

  const cancelForm = () => {
    setDraft(null);
    setShowForm(false);
    setValue('');
    setLabel('');
  };

  const commitMeasurement = () => {
    if (!draft || !value) return;
    const meta = getCategoryMeta(category);
    setMeasurements(prev => [...prev, {
      id: `m-${Date.now()}`,
      ...draft,
      label: label.trim() || meta.label,
      value: parseFloat(value),
      unit,
      category,
      recorded_at: new Date().toISOString(),
    }]);
    setDraft(null);
    setShowForm(false);
    setValue('');
    setLabel('');
  };

  const applyQuick = (q) => {
    setValue(q.value);
    setUnit(q.unit);
  };

  const deleteMeasurement = (id) => setMeasurements(prev => prev.filter(m => m.id !== id));

  const handleSave = () => onSave(measurements);

  const meta = getCategoryMeta(category);

  const svgW = imgBox?.width  || 0;
  const svgH = imgBox?.height || 0;

  return (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col select-none">

      {/* ── Top bar ─────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-950 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Ruler className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <span className="text-white font-semibold text-sm">Shingle Measure</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowList(v => !v); setShowForm(false); }}
            className="flex items-center gap-1 text-xs text-gray-300 bg-gray-800 hover:bg-gray-700 px-2 py-1.5 rounded-lg"
          >
            <span>{measureCount} line{measureCount !== 1 ? 's' : ''}</span>
            {showList ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg"
            data-testid="button-save-measurements"
          >
            <Check className="w-3.5 h-3.5" /> Save
          </button>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1.5 rounded-lg"
            data-testid="button-close-measure"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Measurements list (toggle) ──────────────────── */}
      {showList && (
        <div className="bg-gray-900 border-b border-gray-800 flex-shrink-0 max-h-48 overflow-y-auto">
          {measurements.length === 0 ? (
            <p className="text-gray-500 text-xs text-center py-4">No measurements yet</p>
          ) : (
            <div className="p-2 space-y-1.5">
              {measurements.map(m => {
                const mc = getCategoryMeta(m.category);
                return (
                  <div key={m.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: mc.color }} />
                      <span className="text-white text-sm font-semibold">{m.value} {m.unit}</span>
                      <span className="text-gray-400 text-xs">{m.label}</span>
                    </div>
                    <button
                      onClick={() => deleteMeasurement(m.id)}
                      className="text-red-400 hover:text-red-300 p-1"
                      data-testid={`button-delete-measurement-${m.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Photo canvas ────────────────────────────────── */}
      <div
        ref={wrapRef}
        className="flex-1 relative overflow-hidden flex items-center justify-center"
        style={{ cursor: drawStep !== 'idle' ? 'crosshair' : 'default', touchAction: drawStep !== 'idle' ? 'none' : 'auto' }}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
      >
        <img
          ref={imgRef}
          src={photoUrl}
          alt="Measure"
          className="max-w-full max-h-full object-contain pointer-events-none"
          onLoad={updateBox}
          draggable={false}
        />

        {imgBox && (svgW > 0) && (
          <svg
            ref={svgRef}
            className="absolute pointer-events-none"
            style={{ left: imgBox.left, top: imgBox.top, width: svgW, height: svgH }}
          >
            {/* Saved measurements */}
            {measurements.map(m => {
              const mc = getCategoryMeta(m.category);
              const x1 = px(m.x1, svgW), y1 = px(m.y1, svgH);
              const x2 = px(m.x2, svgW), y2 = px(m.y2, svgH);
              const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
              const lbl = `${m.value}${m.unit}`;
              const lblW = Math.max(lbl.length * 7 + 12, 40);
              return (
                <g key={m.id}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={mc.color} strokeWidth="2.5" strokeLinecap="round" />
                  <circle cx={x1} cy={y1} r="6" fill={mc.color} stroke="white" strokeWidth="1.5" />
                  <circle cx={x2} cy={y2} r="6" fill={mc.color} stroke="white" strokeWidth="1.5" />
                  <rect x={mx - lblW / 2} y={my - 11} width={lblW} height="22" rx="5" fill="rgba(0,0,0,0.82)" />
                  <text x={mx} y={my + 5} textAnchor="middle" fill="white" fontSize="11" fontFamily="monospace" fontWeight="bold">
                    {lbl}
                  </text>
                </g>
              );
            })}

            {/* Point A placed — live rubber-band line */}
            {drawStep === 'pointB' && ptA && live && (
              <g>
                <line
                  x1={px(ptA.x, svgW)} y1={px(ptA.y, svgH)}
                  x2={px(live.x, svgW)} y2={px(live.y, svgH)}
                  stroke="#facc15" strokeWidth="2" strokeDasharray="8,4"
                />
                <circle cx={px(ptA.x, svgW)} cy={px(ptA.y, svgH)} r="10" fill="#facc15" stroke="white" strokeWidth="2" />
                <text x={px(ptA.x, svgW)} y={px(ptA.y, svgH) + 4.5} textAnchor="middle" fill="black" fontSize="11" fontWeight="bold">A</text>
                <circle cx={px(live.x, svgW)} cy={px(live.y, svgH)} r="8" fill="#facc15" fillOpacity="0.5" stroke="white" strokeWidth="1.5" />
              </g>
            )}

            {/* Point A just placed, no live yet */}
            {drawStep === 'pointB' && ptA && !live && (
              <circle cx={px(ptA.x, svgW)} cy={px(ptA.y, svgH)} r="10" fill="#facc15" stroke="white" strokeWidth="2" />
            )}

            {/* Crosshair for first tap */}
            {drawStep === 'pointA' && live && (
              <g>
                <circle cx={px(live.x, svgW)} cy={px(live.y, svgH)} r="14" fill="rgba(250,204,21,0.2)" stroke="#facc15" strokeWidth="1.5" />
                <circle cx={px(live.x, svgW)} cy={px(live.y, svgH)} r="3" fill="#facc15" />
              </g>
            )}
          </svg>
        )}

        {/* ── Step instructions overlay ─────────────────── */}
        {drawStep === 'pointA' && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/80 text-yellow-300 font-semibold text-sm px-4 py-2 rounded-full shadow-lg pointer-events-none">
            👆 Tap Point A — start of measurement
          </div>
        )}
        {drawStep === 'pointB' && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/80 text-yellow-300 font-semibold text-sm px-4 py-2 rounded-full shadow-lg pointer-events-none">
            👆 Tap Point B — end of measurement
          </div>
        )}

        {/* ── Idle prompt ───────────────────────────────── */}
        {drawStep === 'idle' && !showForm && measurements.length === 0 && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 text-center pointer-events-none">
            <div className="bg-black/70 text-gray-300 text-sm px-4 py-3 rounded-xl">
              Tap <span className="text-yellow-300 font-semibold">+ New Line</span> to start measuring
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom action bar ────────────────────────────── */}
      <div className="bg-gray-950 border-t border-gray-800 px-4 py-3 flex-shrink-0 flex items-center justify-center gap-3">
        {drawStep === 'idle' ? (
          <button
            onClick={startDraw}
            className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 text-black font-bold text-base px-6 py-3 rounded-2xl shadow-lg"
            data-testid="button-start-measure"
          >
            <Plus className="w-5 h-5" />
            New Line
          </button>
        ) : (
          <button
            onClick={cancelDraw}
            className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold text-sm px-5 py-3 rounded-2xl"
          >
            <X className="w-4 h-4" /> Cancel
          </button>
        )}
      </div>

      {/* ── Measurement form modal ───────────────────────── */}
      {showForm && (
        <div className="absolute inset-0 z-30 flex items-end justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) cancelForm(); }}>
          <div className="bg-white w-full max-w-lg rounded-t-2xl shadow-2xl p-5 space-y-4">

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Ruler className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-gray-900 text-base">What did you measure?</h3>
              </div>
              <button onClick={cancelForm} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Category chips */}
            <div>
              <p className="text-xs text-gray-500 font-medium mb-2">Type</p>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(c => (
                  <button
                    key={c.value}
                    onClick={() => { setCategory(c.value); setUnit(c.unit); }}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition-all ${
                      category === c.value
                        ? 'text-white border-transparent'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                    }`}
                    style={category === c.value ? { background: c.color, borderColor: c.color } : {}}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick values for shingle measurements */}
            {(category === 'shingle_length' || category === 'shingle_width' || category === 'shingle_exposure') && (
              <div>
                <p className="text-xs text-gray-500 font-medium mb-2">Quick Values</p>
                <div className="flex gap-2 flex-wrap">
                  {SHINGLE_QUICK_VALUES.map(q => (
                    <button
                      key={q.label}
                      onClick={() => applyQuick(q)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-semibold border-2 transition-all ${
                        value === q.value && unit === q.unit
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-gray-50 text-gray-800 border-gray-200 hover:border-blue-400'
                      }`}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Value + unit */}
            <div>
              <p className="text-xs text-gray-500 font-medium mb-2">Measurement</p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder="e.g. 36"
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  className="flex-1 h-12 text-lg font-bold"
                  autoFocus
                  data-testid="input-measure-value"
                  onKeyDown={e => { if (e.key === 'Enter') commitMeasurement(); }}
                />
                <div className="flex gap-1">
                  {UNIT_OPTIONS.map(u => (
                    <button
                      key={u}
                      onClick={() => setUnit(u)}
                      className={`px-3 py-2 rounded-lg text-sm font-semibold border-2 transition-all ${
                        unit === u ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Optional label */}
            <div>
              <p className="text-xs text-gray-500 font-medium mb-1">Label <span className="text-gray-400">(optional)</span></p>
              <Input
                placeholder={getCategoryMeta(category).label}
                value={label}
                onChange={e => setLabel(e.target.value)}
                className="h-10"
                data-testid="input-measure-label"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={cancelForm}
                className="flex-1 h-12 rounded-xl border-2 border-gray-200 text-gray-700 font-semibold text-sm hover:bg-gray-50"
                data-testid="button-measure-cancel"
              >
                Cancel
              </button>
              <button
                onClick={commitMeasurement}
                disabled={!value}
                className="flex-1 h-12 rounded-xl text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40"
                style={{ background: meta.color }}
                data-testid="button-measure-confirm"
              >
                <Check className="w-4 h-4" />
                Add Measurement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
