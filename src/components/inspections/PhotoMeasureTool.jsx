import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Ruler, Trash2, Plus, Check, X, Move, RotateCcw } from 'lucide-react';

const CATEGORIES = [
  { value: 'siding_height',    label: 'Exterior – Siding Height',   color: '#3b82f6' },
  { value: 'gutter_run',       label: 'Exterior – Gutter Run',      color: '#10b981' },
  { value: 'wall_width',       label: 'Exterior – Wall Width',      color: '#f59e0b' },
  { value: 'fascia_length',    label: 'Exterior – Fascia Length',   color: '#8b5cf6' },
  { value: 'drywall_segment',  label: 'Interior – Drywall Segment', color: '#ef4444' },
  { value: 'floor_perimeter',  label: 'Interior – Floor Perimeter', color: '#ec4899' },
  { value: 'ceiling_height',   label: 'Interior – Ceiling Height',  color: '#06b6d4' },
  { value: 'custom',           label: 'Custom',                     color: '#6b7280' },
];
const UNITS = ['ft', 'LF', 'in', 'm', 'sq ft'];

function getCategoryMeta(cat) {
  return CATEGORIES.find(c => c.value === cat) || CATEGORIES[CATEGORIES.length - 1];
}

export default function PhotoMeasureTool({ photoUrl, existingMeasurements = [], onSave, onClose }) {
  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const [imgRect, setImgRect] = useState(null);

  const [measurements, setMeasurements] = useState(
    (existingMeasurements || []).map((m, i) => ({ ...m, id: m.id || `m-${Date.now()}-${i}` }))
  );
  const [drawState, setDrawState] = useState('idle'); // idle | first | second
  const [pendingPt, setPendingPt] = useState(null);   // {x, y} normalized 0-1
  const [cursorPt, setCursorPt] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [draftLine, setDraftLine] = useState(null);   // {x1,y1,x2,y2} normalized
  const [form, setForm] = useState({ label: '', value: '', unit: 'ft', category: 'siding_height' });

  const updateRect = useCallback(() => {
    if (imgRef.current) {
      const r = imgRef.current.getBoundingClientRect();
      setImgRect(r);
    }
  }, []);

  useEffect(() => {
    updateRect();
    window.addEventListener('resize', updateRect);
    return () => window.removeEventListener('resize', updateRect);
  }, [updateRect]);

  useEffect(() => {
    if (imgRef.current) {
      const img = imgRef.current;
      if (img.complete) updateRect();
      else img.onload = updateRect;
    }
  }, [photoUrl, updateRect]);

  const toNorm = (clientX, clientY) => {
    if (!imgRect) return null;
    return {
      x: Math.max(0, Math.min(1, (clientX - imgRect.left) / imgRect.width)),
      y: Math.max(0, Math.min(1, (clientY - imgRect.top) / imgRect.height)),
    };
  };

  const handleMouseMove = (e) => {
    if (drawState === 'idle' || !imgRect) return;
    const pt = toNorm(e.clientX, e.clientY);
    setCursorPt(pt);
  };

  const handleTouchMove = (e) => {
    if (drawState === 'idle' || !imgRect) return;
    const t = e.touches[0];
    const pt = toNorm(t.clientX, t.clientY);
    setCursorPt(pt);
  };

  const handleClick = (e) => {
    if (drawState === 'idle' || showForm) return;
    updateRect();
    const pt = toNorm(e.clientX, e.clientY);
    if (!pt) return;

    if (drawState === 'first') {
      setPendingPt(pt);
      setDrawState('second');
    } else if (drawState === 'second') {
      setDraftLine({ x1: pendingPt.x, y1: pendingPt.y, x2: pt.x, y2: pt.y });
      setPendingPt(null);
      setCursorPt(null);
      setDrawState('idle');
      setShowForm(true);
    }
  };

  const handleTouchEnd = (e) => {
    if (drawState === 'idle' || showForm) return;
    const t = e.changedTouches[0];
    updateRect();
    const pt = toNorm(t.clientX, t.clientY);
    if (!pt) return;

    if (drawState === 'first') {
      setPendingPt(pt);
      setDrawState('second');
    } else if (drawState === 'second') {
      setDraftLine({ x1: pendingPt.x, y1: pendingPt.y, x2: pt.x, y2: pt.y });
      setPendingPt(null);
      setCursorPt(null);
      setDrawState('idle');
      setShowForm(true);
    }
  };

  const commitMeasurement = () => {
    if (!draftLine || !form.value) return;
    const newM = {
      id: `m-${Date.now()}`,
      ...draftLine,
      label: form.label || getCategoryMeta(form.category).label,
      value: parseFloat(form.value),
      unit: form.unit,
      category: form.category,
      recorded_at: new Date().toISOString(),
    };
    setMeasurements(prev => [...prev, newM]);
    setDraftLine(null);
    setShowForm(false);
    setForm(f => ({ ...f, label: '', value: '' }));
  };

  const cancelDraft = () => {
    setDraftLine(null);
    setShowForm(false);
    setPendingPt(null);
    setCursorPt(null);
    setDrawState('idle');
  };

  const deleteMeasurement = (id) => {
    setMeasurements(prev => prev.filter(m => m.id !== id));
  };

  const handleSave = () => {
    onSave(measurements);
  };

  const startDraw = () => {
    setDrawState('first');
    setPendingPt(null);
    setCursorPt(null);
  };

  const cancelDraw = () => {
    setDrawState('idle');
    setPendingPt(null);
    setCursorPt(null);
  };

  const pct = (v) => `${(v * 100).toFixed(2)}%`;
  const svgPct = (v) => v * 100;

  return (
    <div className="fixed inset-0 z-[200] bg-black/90 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/80 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Ruler className="w-5 h-5 text-blue-400" />
          <span className="text-white font-semibold text-sm">Measure Mode</span>
          {drawState !== 'idle' && (
            <Badge className="bg-blue-600 text-white text-xs">
              {drawState === 'first' ? 'Tap Point A' : 'Tap Point B'}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {drawState !== 'idle' ? (
            <Button size="sm" variant="outline" onClick={cancelDraw} className="border-gray-600 text-gray-200 text-xs">
              <X className="w-3 h-3 mr-1" /> Cancel Line
            </Button>
          ) : (
            <Button size="sm" onClick={startDraw} className="bg-blue-600 hover:bg-blue-700 text-white text-xs"
              data-testid="button-start-measure">
              <Plus className="w-3 h-3 mr-1" /> New Line
            </Button>
          )}
          <Button size="sm" onClick={handleSave} className="bg-green-600 hover:bg-green-700 text-white text-xs"
            data-testid="button-save-measurements">
            <Check className="w-3 h-3 mr-1" /> Save
          </Button>
          <Button size="sm" variant="outline" onClick={onClose} className="border-gray-600 text-gray-200 text-xs"
            data-testid="button-close-measure">
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Photo + SVG overlay */}
        <div
          ref={containerRef}
          className="flex-1 flex items-center justify-center relative overflow-hidden p-2"
          style={{ cursor: drawState !== 'idle' ? 'crosshair' : 'default' }}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="relative w-full h-full flex items-center justify-center">
            <img
              ref={imgRef}
              src={photoUrl}
              alt="Measure photo"
              className="max-w-full max-h-full object-contain select-none pointer-events-none"
              onLoad={updateRect}
              draggable={false}
            />

            {/* SVG overlay — matches the rendered image exactly */}
            {imgRect && (
              <svg
                className="absolute pointer-events-none"
                style={{
                  left: imgRef.current ? imgRef.current.getBoundingClientRect().left - containerRef.current.getBoundingClientRect().left : 0,
                  top: imgRef.current ? imgRef.current.getBoundingClientRect().top - containerRef.current.getBoundingClientRect().top : 0,
                  width: imgRect.width,
                  height: imgRect.height,
                }}
                viewBox={`0 0 100 100`}
                preserveAspectRatio="none"
              >
                {/* Saved measurements */}
                {measurements.map(m => {
                  const meta = getCategoryMeta(m.category);
                  const midX = (m.x1 + m.x2) / 2;
                  const midY = (m.y1 + m.y2) / 2;
                  return (
                    <g key={m.id}>
                      <line
                        x1={svgPct(m.x1)} y1={svgPct(m.y1)}
                        x2={svgPct(m.x2)} y2={svgPct(m.y2)}
                        stroke={meta.color} strokeWidth="0.5" strokeLinecap="round"
                      />
                      <circle cx={svgPct(m.x1)} cy={svgPct(m.y1)} r="1" fill={meta.color} />
                      <circle cx={svgPct(m.x2)} cy={svgPct(m.y2)} r="1" fill={meta.color} />
                      <rect
                        x={svgPct(midX) - 8} y={svgPct(midY) - 2.5}
                        width="16" height="5" rx="1"
                        fill="rgba(0,0,0,0.7)"
                      />
                      <text
                        x={svgPct(midX)} y={svgPct(midY) + 1.5}
                        textAnchor="middle" fill="white"
                        fontSize="2.5" fontFamily="monospace" fontWeight="bold"
                      >
                        {m.value} {m.unit}
                      </text>
                    </g>
                  );
                })}

                {/* Draft line while drawing */}
                {drawState === 'second' && pendingPt && cursorPt && (
                  <g>
                    <line
                      x1={svgPct(pendingPt.x)} y1={svgPct(pendingPt.y)}
                      x2={svgPct(cursorPt.x)} y2={svgPct(cursorPt.y)}
                      stroke="#facc15" strokeWidth="0.4" strokeDasharray="2,1"
                    />
                    <circle cx={svgPct(pendingPt.x)} cy={svgPct(pendingPt.y)} r="1.2" fill="#facc15" />
                    <circle cx={svgPct(cursorPt.x)} cy={svgPct(cursorPt.y)} r="0.8" fill="#facc15" fillOpacity="0.7" />
                  </g>
                )}
                {drawState === 'first' && cursorPt && (
                  <circle cx={svgPct(cursorPt.x)} cy={svgPct(cursorPt.y)} r="1" fill="#facc15" fillOpacity="0.7" />
                )}
              </svg>
            )}
          </div>

          {/* Draw instructions overlay */}
          {drawState !== 'idle' && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 text-yellow-300 text-xs px-3 py-1.5 rounded-full font-medium pointer-events-none">
              {drawState === 'first' ? '📍 Tap Point A (start of measurement)' : '📍 Tap Point B (end of measurement)'}
            </div>
          )}
        </div>

        {/* Sidebar — measurements list */}
        <div className="w-60 bg-gray-900 border-l border-gray-700 flex flex-col flex-shrink-0 overflow-y-auto p-3 gap-3">
          <p className="text-gray-400 text-xs uppercase tracking-wider font-semibold">Measurements</p>
          {measurements.length === 0 && (
            <p className="text-gray-500 text-xs">None yet. Click "New Line" then tap two points on the photo.</p>
          )}
          {measurements.map(m => {
            const meta = getCategoryMeta(m.category);
            return (
              <div key={m.id} className="bg-gray-800 rounded p-2 text-xs space-y-1">
                <div className="flex items-start justify-between gap-1">
                  <div>
                    <div className="font-semibold text-white">{m.value} {m.unit}</div>
                    <div className="text-gray-400">{m.label}</div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5 text-red-400 hover:text-red-300 hover:bg-red-900/30 flex-shrink-0"
                    onClick={(e) => { e.stopPropagation(); deleteMeasurement(m.id); }}
                    data-testid={`button-delete-measurement-${m.id}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
                <span
                  className="inline-block px-1.5 py-0.5 rounded text-white text-[10px]"
                  style={{ background: meta.color }}
                >
                  {meta.label}
                </span>
              </div>
            );
          })}

          {measurements.length > 0 && (
            <div className="mt-auto pt-2 border-t border-gray-700">
              <p className="text-gray-500 text-[10px]">These measurements are saved on this photo and can be used to pre-fill quantities on estimates.</p>
            </div>
          )}
        </div>
      </div>

      {/* Measurement value form — shown after drawing a line */}
      {showForm && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60"
          onClick={(e) => e.stopPropagation()}>
          <div className="bg-white rounded-xl shadow-2xl p-5 w-80 space-y-4">
            <div className="flex items-center gap-2">
              <Ruler className="w-5 h-5 text-blue-600" />
              <h3 className="font-semibold text-gray-900">Enter Measurement</h3>
            </div>

            <div className="space-y-3">
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={form.category} onValueChange={(v) => setForm(f => ({ ...f, category: v, label: '' }))}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-measure-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Distance</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="e.g. 40.5"
                    value={form.value}
                    onChange={(e) => setForm(f => ({ ...f, value: e.target.value }))}
                    className="h-8 text-sm"
                    autoFocus
                    data-testid="input-measure-value"
                    onKeyDown={(e) => { if (e.key === 'Enter') commitMeasurement(); }}
                  />
                </div>
                <div className="w-20">
                  <Label className="text-xs">Unit</Label>
                  <Select value={form.unit} onValueChange={(v) => setForm(f => ({ ...f, unit: v }))}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-measure-unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="text-xs">Label (optional)</Label>
                <Input
                  placeholder={getCategoryMeta(form.category).label}
                  value={form.label}
                  onChange={(e) => setForm(f => ({ ...f, label: e.target.value }))}
                  className="h-8 text-sm"
                  data-testid="input-measure-label"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1 h-8 text-xs" onClick={cancelDraft}
                data-testid="button-measure-cancel">
                Cancel
              </Button>
              <Button
                className="flex-1 h-8 text-xs bg-blue-600 hover:bg-blue-700"
                onClick={commitMeasurement}
                disabled={!form.value}
                data-testid="button-measure-confirm"
              >
                <Check className="w-3 h-3 mr-1" /> Add
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
