/**
 * PhotoDrawingCanvas
 *
 * Architecture: <img> tag shows the photo normally (no CORS issues).
 * A transparent <canvas> sits exactly on top and captures only the user's
 * drawn strokes. Because the canvas never draws any cross-origin pixels,
 * canvas.toBlob() is never tainted — it always works instantly.
 *
 * Features:
 *  - Freehand drawing (hail/wind marks)
 *  - 10×10 ft square tool — corner-bracket outline only (no fill) so hail marks
 *    inside the square remain fully visible
 *  - Section label tool — tap to place a named tag (Front/Left/Back/Right +
 *    hail count + wind count) anywhere on the photo
 *  - Zoom (wheel / pinch / buttons) with pan mode
 */
import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Undo2, Trash2, Loader2, Pencil, Circle, ZoomIn, ZoomOut, RotateCcw, Move, Square, Tag } from "lucide-react";

const COLORS = {
  red:    { hex: '#ef4444', label: 'Hail',  stroke: '#ef4444' },
  yellow: { hex: '#f59e0b', label: 'Wind',  stroke: '#f59e0b' },
};

const SQUARE_COLOR = { hex: '#3b82f6', stroke: '#3b82f6' };

const BRUSH_SIZES = [
  { key: 'small',  label: 'S', px: 3  },
  { key: 'medium', label: 'M', px: 7  },
  { key: 'large',  label: 'L', px: 14 },
];

const SECTION_PRESETS = ['Front', 'Left', 'Right', 'Back'];

const BLANK_LABEL_FORM = { section: 'Front', customSection: '', hailCount: '', windCount: '' };

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

// ─── roundRect polyfill (local copy so this file has no ImageAnnotation dep) ───
function roundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') { ctx.roundRect(x, y, w, h, r); return; }
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export default function PhotoDrawingCanvas({ photoUrl, onAnalyze, onClose, isAnalyzing }) {
  const canvasRef  = useRef(null);
  const imgRef     = useRef(null);
  const wrapRef    = useRef(null);
  const innerRef   = useRef(null);

  const strokesRef = useRef([]);
  const currentRef = useRef(null);
  const isDrawRef  = useRef(false);

  const zoomRef    = useRef(1);
  const panRef     = useRef({ x: 0, y: 0 });
  const [zoomDisplay, setZoomDisplay] = useState(1);

  const isPanDragging  = useRef(false);
  const panDragStart   = useRef(null);
  const panOffsetStart = useRef(null);

  const pinchRef = useRef({ active: false, lastDist: 0 });

  const [color, setColor]         = useState('red');
  const [brushSize, setBrushSize] = useState('medium');
  const [drawMode, setDrawMode]   = useState('freehand'); // 'freehand' | 'square10' | 'label'
  const [isPanMode, setIsPanMode] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError]   = useState(false);
  const [strokeCount, setStrokeCount] = useState(0);

  // Label placement state
  const [pendingLabel, setPendingLabel]  = useState(null); // {x, y} canvas coords
  const [labelForm, setLabelForm]        = useState(BLANK_LABEL_FORM);

  const getBrushPx = () => BRUSH_SIZES.find(b => b.key === brushSize)?.px ?? 7;

  const applyTransform = useCallback((z, px, py) => {
    if (innerRef.current) {
      innerRef.current.style.transform = `scale(${z}) translate(${px}px, ${py}px)`;
    }
  }, []);

  const commitZoom = useCallback((newZ) => {
    newZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZ));
    if (newZ <= 1) {
      newZ = 1;
      panRef.current = { x: 0, y: 0 };
      setIsPanMode(false);
    } else {
      setIsPanMode(true);
    }
    zoomRef.current = newZ;
    setZoomDisplay(newZ);
    applyTransform(newZ, panRef.current.x, panRef.current.y);
    return newZ;
  }, [applyTransform]);

  const zoomIn   = useCallback(() => commitZoom(zoomRef.current + 0.5), [commitZoom]);
  const zoomOut  = useCallback(() => commitZoom(zoomRef.current - 0.5), [commitZoom]);
  const resetZoom = useCallback(() => commitZoom(1), [commitZoom]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.3 : -0.3;
    commitZoom(zoomRef.current + delta);
  }, [commitZoom]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // ─── Canvas sizing ──────────────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const W = canvas.width, H = canvas.height;
    strokesRef.current.forEach(s => paintStroke(ctx, s, W, H));
    if (currentRef.current) paintStroke(ctx, currentRef.current, W, H);
  }, []);

  const sizeCanvas = useCallback(() => {
    const img    = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    canvas.width  = img.clientWidth;
    canvas.height = img.clientHeight;
    redraw();
  }, [redraw]);

  useEffect(() => {
    window.addEventListener('resize', sizeCanvas);
    return () => window.removeEventListener('resize', sizeCanvas);
  }, [sizeCanvas]);

  // ─── Painting ───────────────────────────────────────────────────────────────
  function paintStroke(ctx, stroke, W, H) {
    if (stroke.type === 'square10') {
      paintSquare(ctx, stroke, W, H);
    } else if (stroke.type === 'label') {
      paintLabel(ctx, stroke, W, H);
    } else {
      paintFreehand(ctx, stroke);
    }
  }

  function paintFreehand(ctx, stroke) {
    if (!stroke.points || stroke.points.length < 2) return;
    const cfg = COLORS[stroke.color] || COLORS.red;
    ctx.beginPath();
    ctx.strokeStyle = cfg.stroke;
    ctx.lineWidth   = stroke.brushPx ?? 7;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.globalAlpha = 0.9;
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    stroke.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Square: corner brackets only — no fill so hail marks are visible inside
  function paintSquare(ctx, stroke, W, H) {
    const { x, y, w, h } = stroke;
    const nx = w < 0 ? x + w : x;
    const ny = h < 0 ? y + h : y;
    const nw = Math.abs(w);
    const nh = Math.abs(h);
    if (nw < 4 || nh < 4) return;

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = SQUARE_COLOR.stroke;
    ctx.lineCap     = 'square';

    // Thin dashed outline so the boundary is clear without covering hail marks
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(nx + 1, ny + 1, nw - 2, nh - 2);
    ctx.setLineDash([]);

    // Solid L-bracket corner marks (like chalk on the real roof)
    const arm = Math.min(nw, nh) * 0.22;
    ctx.lineWidth = 4;
    [
      [[nx, ny + arm],      [nx, ny],      [nx + arm, ny]],
      [[nx + nw - arm, ny], [nx + nw, ny], [nx + nw, ny + arm]],
      [[nx + nw, ny + nh - arm], [nx + nw, ny + nh], [nx + nw - arm, ny + nh]],
      [[nx + arm, ny + nh], [nx, ny + nh], [nx, ny + nh - arm]],
    ].forEach(pts => {
      ctx.beginPath();
      ctx.moveTo(...pts[0]);
      ctx.lineTo(...pts[1]);
      ctx.lineTo(...pts[2]);
      ctx.stroke();
    });

    // Small "10×10" text in center with dark shadow so it doesn't obscure
    const fs = Math.max(10, Math.min(16, Math.min(nw, nh) * 0.14));
    ctx.globalAlpha  = 0.85;
    ctx.font         = `bold ${fs}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur   = 4;
    ctx.fillStyle    = '#93c5fd';
    ctx.fillText('10×10', nx + nw / 2, ny + nh / 2);
    ctx.shadowBlur   = 0;
    ctx.restore();
  }

  // Label: dark pill tag with section name + counts
  function paintLabel(ctx, stroke, W, H) {
    const { x, y, section, hailCount, windCount } = stroke;
    const sectionText = section || '';
    const line2Parts  = [];
    if (hailCount) line2Parts.push(`Hail: ${hailCount}`);
    if (windCount) line2Parts.push(`Wind: ${windCount}`);
    const line2 = line2Parts.join('  ');

    if (!sectionText && !line2) return;

    ctx.save();

    const fs1 = Math.max(13, Math.min(20, W * 0.032));
    const fs2 = Math.max(10, Math.min(14, W * 0.022));
    const pad = 10;

    ctx.font = `bold ${fs1}px sans-serif`;
    const tw1 = ctx.measureText(sectionText).width;
    ctx.font = `${fs2}px sans-serif`;
    const tw2 = line2 ? ctx.measureText(line2).width : 0;

    const boxW = Math.max(tw1, tw2) + pad * 2;
    const boxH = fs1 + (line2 ? fs2 + 5 : 0) + pad * 1.4;
    const bx   = Math.max(2, Math.min(W - boxW - 2, x - boxW / 2));
    const by   = Math.max(2, Math.min(H - boxH - 8, y - boxH - 8));

    // Dark semi-transparent background
    ctx.globalAlpha = 0.93;
    ctx.fillStyle   = 'rgba(10, 15, 30, 0.88)';
    roundRect(ctx, bx, by, boxW, boxH, 6);
    ctx.fill();

    // White border
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth   = 1.5;
    roundRect(ctx, bx, by, boxW, boxH, 6);
    ctx.stroke();

    // Section name
    ctx.globalAlpha  = 1;
    ctx.fillStyle    = '#ffffff';
    ctx.font         = `bold ${fs1}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(sectionText.toUpperCase(), bx + boxW / 2, by + pad * 0.7);

    // Counts row
    if (line2) {
      ctx.font      = `${fs2}px sans-serif`;
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(line2, bx + boxW / 2, by + pad * 0.7 + fs1 + 4);
    }

    // Small pin dot below the box
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(x, by + boxH + 3, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ─── Coordinate helper ──────────────────────────────────────────────────────
  function getPos(e) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const src    = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top)  * scaleY,
    };
  }

  // ─── Mouse events ───────────────────────────────────────────────────────────
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    if (isPanMode && zoomRef.current > 1) {
      isPanDragging.current  = true;
      panDragStart.current   = { x: e.clientX, y: e.clientY };
      panOffsetStart.current = { ...panRef.current };
      return;
    }
    e.preventDefault();

    if (drawMode === 'label') {
      const pos = getPos(e);
      setPendingLabel(pos);
      return;
    }

    isDrawRef.current  = true;
    const pos = getPos(e);
    if (drawMode === 'square10') {
      currentRef.current = { type: 'square10', x: pos.x, y: pos.y, w: 0, h: 0 };
    } else {
      currentRef.current = { type: 'freehand', color, brushPx: getBrushPx(), points: [pos] };
    }
  };

  const onMouseMove = (e) => {
    if (isPanDragging.current) {
      const dx = (e.clientX - panDragStart.current.x) / zoomRef.current;
      const dy = (e.clientY - panDragStart.current.y) / zoomRef.current;
      panRef.current = {
        x: panOffsetStart.current.x + dx,
        y: panOffsetStart.current.y + dy,
      };
      applyTransform(zoomRef.current, panRef.current.x, panRef.current.y);
      return;
    }
    if (!isDrawRef.current || !currentRef.current) return;
    e.preventDefault();
    const pos = getPos(e);
    if (drawMode === 'square10') {
      currentRef.current = {
        ...currentRef.current,
        w: pos.x - currentRef.current.x,
        h: pos.y - currentRef.current.y,
      };
    } else {
      currentRef.current.points.push(pos);
    }
    redraw();
  };

  const onMouseUp = (e) => {
    if (isPanDragging.current) { isPanDragging.current = false; return; }
    if (!isDrawRef.current || !currentRef.current) return;
    isDrawRef.current = false;
    commitStroke();
  };

  // ─── Touch events ───────────────────────────────────────────────────────────
  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      pinchRef.current = { active: true, lastDist: Math.hypot(dx, dy) };
      isDrawRef.current  = false;
      currentRef.current = null;
      redraw();
      return;
    }
    pinchRef.current.active = false;

    if (isPanMode && zoomRef.current > 1) {
      isPanDragging.current  = true;
      panDragStart.current   = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      panOffsetStart.current = { ...panRef.current };
      return;
    }
    e.preventDefault();

    if (drawMode === 'label') {
      const pos = getPos(e);
      setPendingLabel(pos);
      return;
    }

    isDrawRef.current = true;
    const pos = getPos(e);
    if (drawMode === 'square10') {
      currentRef.current = { type: 'square10', x: pos.x, y: pos.y, w: 0, h: 0 };
    } else {
      currentRef.current = { type: 'freehand', color, brushPx: getBrushPx(), points: [pos] };
    }
  };

  const onTouchMove = (e) => {
    if (e.touches.length === 2 && pinchRef.current.active) {
      e.preventDefault();
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.hypot(dx, dy);
      if (pinchRef.current.lastDist > 0) {
        const scale = dist / pinchRef.current.lastDist;
        commitZoom(zoomRef.current * scale);
      }
      pinchRef.current.lastDist = dist;
      return;
    }
    if (isPanDragging.current && e.touches.length === 1) {
      const dx = (e.touches[0].clientX - panDragStart.current.x) / zoomRef.current;
      const dy = (e.touches[0].clientY - panDragStart.current.y) / zoomRef.current;
      panRef.current = {
        x: panOffsetStart.current.x + dx,
        y: panOffsetStart.current.y + dy,
      };
      applyTransform(zoomRef.current, panRef.current.x, panRef.current.y);
      return;
    }
    if (!isDrawRef.current || !currentRef.current) return;
    e.preventDefault();
    const pos = getPos(e);
    if (drawMode === 'square10') {
      currentRef.current = {
        ...currentRef.current,
        w: pos.x - currentRef.current.x,
        h: pos.y - currentRef.current.y,
      };
    } else {
      currentRef.current.points.push(pos);
    }
    redraw();
  };

  const onTouchEnd = (e) => {
    if (pinchRef.current.active) { pinchRef.current.active = false; return; }
    if (isPanDragging.current) { isPanDragging.current = false; return; }
    if (!isDrawRef.current || !currentRef.current) return;
    isDrawRef.current = false;
    commitStroke();
  };

  // ─── Commit strokes ─────────────────────────────────────────────────────────
  function commitStroke() {
    const stroke = currentRef.current;
    if (!stroke) return;
    let valid = false;
    if (stroke.type === 'square10') {
      valid = Math.abs(stroke.w) > 10 && Math.abs(stroke.h) > 10;
    } else {
      valid = stroke.points && stroke.points.length >= 2;
    }
    if (valid) {
      strokesRef.current = [...strokesRef.current, stroke];
      setStrokeCount(strokesRef.current.length);
    }
    currentRef.current = null;
    redraw();
  }

  function commitLabel() {
    if (!pendingLabel) return;
    const sectionName = labelForm.section === 'Custom'
      ? (labelForm.customSection.trim() || 'Section')
      : labelForm.section;
    const stroke = {
      type: 'label',
      x: pendingLabel.x,
      y: pendingLabel.y,
      section: sectionName,
      hailCount: labelForm.hailCount.trim(),
      windCount: labelForm.windCount.trim(),
    };
    strokesRef.current = [...strokesRef.current, stroke];
    setStrokeCount(strokesRef.current.length);
    setPendingLabel(null);
    setLabelForm(BLANK_LABEL_FORM);
    redraw();
  }

  const handleUndo = () => {
    strokesRef.current = strokesRef.current.slice(0, -1);
    setStrokeCount(strokesRef.current.length);
    redraw();
  };

  const handleClear = () => {
    strokesRef.current = [];
    setStrokeCount(0);
    redraw();
  };

  // ─── Export ─────────────────────────────────────────────────────────────────
  const getStrokesBlob = () => new Promise((resolve, reject) => {
    const srcCanvas = canvasRef.current;
    if (!srcCanvas) { reject(new Error('Canvas not ready')); return; }

    const img      = imgRef.current;
    const naturalW = img?.naturalWidth  || srcCanvas.width;
    const naturalH = img?.naturalHeight || srcCanvas.height;
    const scaleX   = naturalW / srcCanvas.width;
    const scaleY   = naturalH / srcCanvas.height;

    const out = document.createElement('canvas');
    out.width  = naturalW;
    out.height = naturalH;
    const ctx  = out.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, naturalW, naturalH);

    strokesRef.current.forEach(stroke => {
      if (stroke.type === 'square10') {
        const scaled = {
          ...stroke,
          x: stroke.x * scaleX,
          y: stroke.y * scaleY,
          w: stroke.w * scaleX,
          h: stroke.h * scaleY,
        };
        paintSquare(ctx, scaled, naturalW, naturalH);
      } else if (stroke.type === 'label') {
        const scaled = {
          ...stroke,
          x: stroke.x * scaleX,
          y: stroke.y * scaleY,
        };
        paintLabel(ctx, scaled, naturalW, naturalH);
      } else {
        if (!stroke.points || stroke.points.length < 2) return;
        const cfg = COLORS[stroke.color] || COLORS.red;
        ctx.beginPath();
        ctx.strokeStyle = cfg.stroke;
        ctx.lineWidth   = (stroke.brushPx ?? 7) * Math.max(scaleX, scaleY) * 2;
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';
        ctx.globalAlpha = 0.95;
        ctx.moveTo(stroke.points[0].x * scaleX, stroke.points[0].y * scaleY);
        stroke.points.slice(1).forEach(p => ctx.lineTo(p.x * scaleX, p.y * scaleY));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    });

    out.toBlob(blob => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/png');
  });

  const getStrokeSummary = () => {
    const canvas = canvasRef.current;
    const W = canvas?.width  || 1;
    const H = canvas?.height || 1;
    const describe = (stroke) => {
      const pts = stroke.points;
      const cx  = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy  = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      return `${cy < H / 2 ? 'top' : 'bottom'}-${cx < W / 2 ? 'left' : 'right'}`;
    };
    const red     = strokesRef.current.filter(s => s.type !== 'square10' && s.type !== 'label' && s.color === 'red');
    const yellow  = strokesRef.current.filter(s => s.type !== 'square10' && s.type !== 'label' && s.color === 'yellow');
    const squares = strokesRef.current.filter(s => s.type === 'square10');
    const labels  = strokesRef.current.filter(s => s.type === 'label');
    const parts   = [];
    if (red.length > 0) {
      const locs = red.map(describe).join(', ');
      parts.push(`${red.length} hail-damage mark${red.length > 1 ? 's' : ''} (red) in the ${locs} area${red.length > 1 ? 's' : ''}`);
    }
    if (yellow.length > 0) {
      const locs = yellow.map(describe).join(', ');
      parts.push(`${yellow.length} wind-damage mark${yellow.length > 1 ? 's' : ''} (yellow) in the ${locs} area${yellow.length > 1 ? 's' : ''}`);
    }
    if (squares.length > 0) {
      parts.push(`${squares.length} approximate 10×10 ft analysis square${squares.length > 1 ? 's' : ''} marked on the roof`);
    }
    if (labels.length > 0) {
      const labelSummary = labels.map(l => {
        const parts2 = [l.section];
        if (l.hailCount) parts2.push(`hail ${l.hailCount}`);
        if (l.windCount) parts2.push(`wind ${l.windCount}`);
        return parts2.join(' ');
      }).join(', ');
      parts.push(`Section labels: ${labelSummary}`);
    }
    return parts.join('; ');
  };

  const handleAnalyze = async () => {
    if (strokesRef.current.length === 0) {
      alert('Draw at least one mark before analyzing.');
      return;
    }
    try {
      const blob          = await getStrokesBlob();
      const strokeSummary = getStrokeSummary();
      await onAnalyze(blob, strokeSummary);
    } catch (err) {
      alert('Could not export marks: ' + err.message);
    }
  };

  // ─── Derived counts ─────────────────────────────────────────────────────────
  const redCount     = strokesRef.current.filter(s => s.type !== 'square10' && s.type !== 'label' && s.color === 'red').length;
  const yellowCount  = strokesRef.current.filter(s => s.type !== 'square10' && s.type !== 'label' && s.color === 'yellow').length;
  const squareCount  = strokesRef.current.filter(s => s.type === 'square10').length;
  const labelCount   = strokesRef.current.filter(s => s.type === 'label').length;
  const isZoomed     = zoomDisplay > 1;

  const canvasCursor = isPanMode && isZoomed ? (isPanDragging.current ? 'grabbing' : 'grab')
    : drawMode === 'label' ? 'cell' : 'crosshair';

  // ─── Hint text ──────────────────────────────────────────────────────────────
  const hintText = () => {
    if (drawMode === 'square10') return 'Drag to draw a 10×10 ft test square — corner marks only so hail stays visible';
    if (drawMode === 'label')    return 'Tap the roof to drop a section label (Front / Left / Right / Back + counts)';
    return 'Draw circles around damage — red for hail, yellow for wind · scroll to zoom';
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-2">
          <Pencil className="w-4 h-4 text-white" />
          <span className="text-white text-sm font-semibold">Draw &amp; Analyze</span>
          {strokeCount > 0 && (
            <span className="text-slate-400 text-xs">
              {redCount    > 0 && <span className="text-red-400">{redCount} hail </span>}
              {yellowCount > 0 && <span className="text-yellow-400">{yellowCount} wind </span>}
              {squareCount > 0 && <span className="text-blue-400">{squareCount} sq </span>}
              {labelCount  > 0 && <span className="text-emerald-400">{labelCount} label{labelCount > 1 ? 's' : ''} </span>}
            </span>
          )}
        </div>
        <button onClick={onClose} disabled={isAnalyzing} className="text-slate-400 hover:text-white px-2 text-lg">✕</button>
      </div>

      {/* Toolbar row 1 — mark type + brush size + undo/clear */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-800 shrink-0 flex-wrap border-b border-slate-700">
        <span className="text-slate-400 text-xs">Mark:</span>

        {/* Hail / Wind freehand */}
        {Object.entries(COLORS).map(([key, cfg]) => (
          <button
            key={key}
            data-testid={`draw-color-${key}`}
            onClick={() => { setColor(key); setDrawMode('freehand'); setPendingLabel(null); }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border-2 transition-all ${
              drawMode === 'freehand' && color === key ? 'scale-105' : 'opacity-60'
            }`}
            style={{
              backgroundColor: cfg.hex + '33',
              borderColor: drawMode === 'freehand' && color === key ? cfg.hex : 'transparent',
              color: drawMode === 'freehand' && color === key ? '#fff' : '#94a3b8',
            }}
          >
            <Circle className="w-3 h-3" style={{ fill: cfg.hex, color: cfg.hex }} />
            {cfg.label}
          </button>
        ))}

        <div className="w-px h-5 bg-slate-600 mx-1" />

        {/* 10×10 square tool */}
        <button
          data-testid="draw-mode-square10"
          onClick={() => { setDrawMode('square10'); setPendingLabel(null); }}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border-2 transition-all ${
            drawMode === 'square10' ? 'scale-105 border-blue-400 bg-blue-900/50 text-white' : 'border-transparent opacity-60 text-slate-300'
          }`}
          title="Draw a 10×10 ft test square (corner brackets only — hail marks stay visible)"
        >
          <Square className="w-3 h-3" style={{ color: SQUARE_COLOR.hex }} />
          10×10 Sq
        </button>

        {/* Section label tool */}
        <button
          data-testid="draw-mode-label"
          onClick={() => { setDrawMode('label'); setPendingLabel(null); }}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border-2 transition-all ${
            drawMode === 'label' ? 'scale-105 border-emerald-400 bg-emerald-900/50 text-white' : 'border-transparent opacity-60 text-slate-300'
          }`}
          title="Tap to place a section label (Front/Left/Right/Back + hail & wind counts)"
        >
          <Tag className="w-3 h-3 text-emerald-400" />
          Label
        </button>

        <div className="w-px h-5 bg-slate-600 mx-1" />

        {/* Brush size (only for freehand) */}
        <span className="text-slate-400 text-xs">Size:</span>
        {BRUSH_SIZES.map(b => (
          <button
            key={b.key}
            data-testid={`draw-brush-${b.key}`}
            onClick={() => setBrushSize(b.key)}
            disabled={drawMode !== 'freehand'}
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
              brushSize === b.key && drawMode === 'freehand'
                ? 'border-blue-400 bg-blue-900 text-white'
                : 'border-slate-600 bg-slate-700 text-slate-300 disabled:opacity-30'
            }`}
          >
            {b.label}
          </button>
        ))}

        <div className="flex-1" />
        <button data-testid="draw-undo"  onClick={handleUndo}  disabled={strokeCount === 0} className="text-slate-400 hover:text-white disabled:opacity-30 p-1" title="Undo"><Undo2  className="w-4 h-4" /></button>
        <button data-testid="draw-clear" onClick={handleClear} disabled={strokeCount === 0} className="text-slate-400 hover:text-red-400 disabled:opacity-30 p-1" title="Clear all"><Trash2 className="w-4 h-4" /></button>
      </div>

      {/* Toolbar row 2 — zoom controls */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/70 shrink-0 border-b border-slate-700/50">
        <span className="text-slate-400 text-xs">Zoom:</span>
        <button
          data-testid="zoom-out"
          onClick={zoomOut}
          disabled={!isZoomed}
          className="w-7 h-7 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-30 flex items-center justify-center"
          title="Zoom out"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <span className="text-white text-xs font-mono w-10 text-center">
          {zoomDisplay.toFixed(1)}×
        </span>
        <button
          data-testid="zoom-in"
          onClick={zoomIn}
          disabled={zoomDisplay >= MAX_ZOOM}
          className="w-7 h-7 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-30 flex items-center justify-center"
          title="Zoom in"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          data-testid="zoom-reset"
          onClick={resetZoom}
          disabled={!isZoomed}
          className="text-slate-400 hover:text-white disabled:opacity-30 text-xs px-1.5 py-1 rounded border border-slate-600 hover:border-slate-400 transition-all"
          title="Reset zoom"
        >
          Reset
        </button>

        {isZoomed && (
          <>
            <div className="w-px h-4 bg-slate-600 mx-1" />
            <button
              data-testid="toggle-pan-mode"
              onClick={() => setIsPanMode(m => !m)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold border transition-all ${
                isPanMode
                  ? 'border-amber-400 bg-amber-900/50 text-amber-300'
                  : 'border-slate-600 text-slate-400 hover:border-slate-400'
              }`}
              title="Toggle pan mode (drag to move when zoomed in)"
            >
              <Move className="w-3 h-3" />
              {isPanMode ? 'Pan On' : 'Pan'}
            </button>
          </>
        )}

        <div className="flex-1" />
        <span className="text-slate-500 text-xs">Scroll to zoom · pinch on mobile</span>
      </div>

      {/* Drawing area */}
      <div
        ref={wrapRef}
        className="flex-1 flex items-center justify-center overflow-hidden bg-black"
        style={{ cursor: isPanMode && isZoomed ? 'grab' : 'default' }}
      >
        {imgError ? (
          <div className="text-slate-400 text-sm text-center p-8">
            <p>Could not load photo.</p>
            <button onClick={onClose} className="mt-3 text-xs text-blue-400 underline">Close</button>
          </div>
        ) : (
          <div
            ref={innerRef}
            className="relative inline-block"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              transformOrigin: 'center center',
              willChange: 'transform',
            }}
          >
            {!imgLoaded && (
              <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/60 rounded">
                <Loader2 className="w-6 h-6 text-white animate-spin mr-2" />
                <span className="text-white text-sm">Loading photo…</span>
              </div>
            )}
            <img
              ref={imgRef}
              src={photoUrl}
              alt="Damage photo"
              draggable={false}
              onLoad={() => { setImgLoaded(true); sizeCanvas(); }}
              onError={() => setImgError(true)}
              style={{
                display: 'block',
                maxWidth: '100%',
                maxHeight: 'calc(100vh - 310px)',
                objectFit: 'contain',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            />
            <canvas
              ref={canvasRef}
              data-testid="drawing-canvas"
              style={{
                position: 'absolute',
                top: 0, left: 0,
                width: '100%',
                height: '100%',
                cursor: canvasCursor,
                touchAction: 'none',
              }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            />
          </div>
        )}
      </div>

      {/* Hint bar */}
      {imgLoaded && strokeCount === 0 && !pendingLabel && (
        <div className="text-center text-slate-500 text-xs py-1 shrink-0 bg-black">
          {hintText()}
        </div>
      )}

      {/* ── Label input panel ── */}
      {pendingLabel && (
        <div className="shrink-0 bg-slate-800 border-t border-slate-600 px-3 py-3">
          <p className="text-white text-xs font-semibold mb-2 flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5 text-emerald-400" />
            Section label
          </p>

          {/* Section quick-select */}
          <div className="flex gap-2 flex-wrap mb-2">
            {SECTION_PRESETS.map(s => (
              <button
                key={s}
                data-testid={`label-section-${s.toLowerCase()}`}
                onClick={() => setLabelForm(f => ({ ...f, section: s, customSection: '' }))}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                  labelForm.section === s && labelForm.section !== 'Custom'
                    ? 'border-emerald-400 bg-emerald-900/50 text-emerald-300'
                    : 'border-slate-600 text-slate-300 hover:border-slate-400'
                }`}
              >
                {s}
              </button>
            ))}
            <button
              data-testid="label-section-custom"
              onClick={() => setLabelForm(f => ({ ...f, section: 'Custom' }))}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                labelForm.section === 'Custom'
                  ? 'border-emerald-400 bg-emerald-900/50 text-emerald-300'
                  : 'border-slate-600 text-slate-300 hover:border-slate-400'
              }`}
            >
              Custom…
            </button>
          </div>

          {/* Custom text field */}
          {labelForm.section === 'Custom' && (
            <input
              autoFocus
              data-testid="label-custom-input"
              value={labelForm.customSection}
              onChange={e => setLabelForm(f => ({ ...f, customSection: e.target.value }))}
              placeholder="e.g. NE Hip, Ridge…"
              className="w-full mb-2 px-3 py-1.5 text-xs rounded bg-slate-700 text-white border border-slate-500 focus:outline-none focus:border-emerald-400"
            />
          )}

          {/* Counts row */}
          <div className="flex gap-3 mb-3">
            <div className="flex-1">
              <label className="text-xs text-red-400 font-semibold block mb-1">Hail hits</label>
              <input
                data-testid="label-hail-count"
                type="number"
                min="0"
                value={labelForm.hailCount}
                onChange={e => setLabelForm(f => ({ ...f, hailCount: e.target.value }))}
                placeholder="0"
                className="w-full px-3 py-1.5 text-xs rounded bg-slate-700 text-white border border-slate-500 focus:outline-none focus:border-red-400"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-yellow-400 font-semibold block mb-1">Wind (mph / count)</label>
              <input
                data-testid="label-wind-count"
                type="text"
                value={labelForm.windCount}
                onChange={e => setLabelForm(f => ({ ...f, windCount: e.target.value }))}
                placeholder="e.g. 20 or 5"
                className="w-full px-3 py-1.5 text-xs rounded bg-slate-700 text-white border border-slate-500 focus:outline-none focus:border-yellow-400"
              />
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-2">
            <button
              data-testid="label-add"
              onClick={commitLabel}
              className="flex-1 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
            >
              Add Label
            </button>
            <button
              data-testid="label-cancel"
              onClick={() => { setPendingLabel(null); setLabelForm(BLANK_LABEL_FORM); }}
              className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex gap-2 px-3 py-3 bg-slate-900 border-t border-slate-700 shrink-0">
        <Button variant="outline" className="flex-1 text-slate-300 border-slate-600 bg-transparent hover:bg-slate-800" onClick={onClose} disabled={isAnalyzing}>
          Cancel
        </Button>
        <Button
          data-testid="draw-analyze"
          className="flex-1 bg-blue-600 hover:bg-blue-500 text-white"
          onClick={handleAnalyze}
          disabled={isAnalyzing || strokeCount === 0}
        >
          {isAnalyzing ? (
            <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Analyzing…</>
          ) : (
            `Analyze (${strokeCount} mark${strokeCount !== 1 ? 's' : ''})`
          )}
        </Button>
      </div>
    </div>
  );
}
