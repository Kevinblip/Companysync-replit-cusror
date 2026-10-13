/**
 * SimplePhotoMarkup
 *
 * Dead-simple Paint-style markup tool: circles, straight lines, 10×10 test
 * squares, and section labels on a photo. No AI analysis required. Big clear
 * toolbar, works on mobile too.
 *
 * Circles: click-to-place at a fixed radius.
 * Lines:   drag from start to end.
 * Square:  drag to draw a 10×10 test square — corner brackets only, no fill,
 *          so hail marks inside stay fully visible.
 * Label:   tap to place a section tag (Front/Left/Right/Back + hail & wind
 *          counts). A dark pill appears at the tapped spot.
 *
 * Architecture: <img> shows the photo (no CORS issues). A transparent <canvas>
 * sits on top for drawings. Export composes both layers at full resolution.
 */
import { useRef, useState, useEffect, useCallback } from "react";
import { Loader2, Undo2, Trash2, Download, Save, ZoomIn, ZoomOut, RotateCcw, X, Hand, Square, Tag } from "lucide-react";
import { base44 } from "@/api/base44Client";

const COLORS = [
  { id: "red",    hex: "#ef4444", label: "Red"    },
  { id: "yellow", hex: "#f59e0b", label: "Yellow" },
  { id: "white",  hex: "#ffffff", label: "White"  },
  { id: "blue",   hex: "#3b82f6", label: "Blue"   },
  { id: "green",  hex: "#22c55e", label: "Green"  },
];

const SIZES = [
  { id: "s", label: "S", stroke: 3  },
  { id: "m", label: "M", stroke: 6  },
  { id: "l", label: "L", stroke: 12 },
];

const CIRCLE_RADIUS = { s: 14, m: 22, l: 36 };

const QUICK_SECTIONS  = ["Front", "Left", "Right", "Back", "Ridge", "Valley"];
const BLANK_LABEL     = { section: "", hailCount: "", windCount: "" };

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

// ─── Square resize helpers (pure, outside component) ─────────────────────────
const HANDLE_HIT = 20; // canvas-px hit radius for corner handles
const OPPOSITE   = { tl: "br", tr: "bl", bl: "tr", br: "tl" };

function sqNorm(s) {
  const nx = s.w < 0 ? s.x + s.w : s.x;
  const ny = s.h < 0 ? s.y + s.h : s.y;
  return { nx, ny, nw: Math.abs(s.w), nh: Math.abs(s.h) };
}
function sqCorners(s) {
  const { nx, ny, nw, nh } = sqNorm(s);
  return { tl: { x: nx, y: ny }, tr: { x: nx + nw, y: ny }, bl: { x: nx, y: ny + nh }, br: { x: nx + nw, y: ny + nh } };
}
function hitHandleKey(pos, s) {
  const c = sqCorners(s);
  for (const [k, h] of Object.entries(c)) {
    if (Math.hypot(pos.x - h.x, pos.y - h.y) <= HANDLE_HIT) return k;
  }
  return null;
}
function hitSquareBody(pos, s) {
  const { nx, ny, nw, nh } = sqNorm(s);
  return pos.x >= nx && pos.x <= nx + nw && pos.y >= ny && pos.y <= ny + nh;
}

// ─── roundRect polyfill ──────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === "function") { ctx.roundRect(x, y, w, h, r); return; }
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

export default function SimplePhotoMarkup({ photoUrl, mediaId, onSave, onClose }) {
  const canvasRef = useRef(null);
  const imgRef    = useRef(null);
  const wrapRef   = useRef(null);
  const innerRef  = useRef(null);

  const shapesRef  = useRef([]);
  const previewRef = useRef(null);
  const hoverRef   = useRef(null);
  const isDownRef  = useRef(false);
  const startRef   = useRef(null);

  // Square selection / resize
  const selectedIdxRef  = useRef(-1);
  const resizingRef     = useRef(false);
  const fixedCornerRef  = useRef(null);

  const zoomRef  = useRef(1);
  const panRef   = useRef({ x: 0, y: 0 });
  const [zoomDisplay, setZoomDisplay] = useState(1);

  const isPanDrag = useRef(false);
  const panStart  = useRef(null);
  const panOff    = useRef(null);
  const pinchRef  = useRef({ active: false, lastDist: 0 });

  const [tool,       setTool]       = useState("circle");
  const [colorId,    setColorId]    = useState("red");
  const [sizeId,     setSizeId]     = useState("s");
  const [shapeCount, setShapeCount] = useState(0);
  const [imgLoaded,  setImgLoaded]  = useState(false);
  const [isSaving,   setIsSaving]   = useState(false);
  const [saved,      setSaved]      = useState(false);

  // Label placement state
  const [pendingLabel, setPendingLabel] = useState(null); // {x, y} canvas coords
  const [labelForm,    setLabelForm]    = useState(BLANK_LABEL);

  const currentColor  = () => COLORS.find(c => c.id === colorId)?.hex  ?? "#ef4444";
  const currentStroke = () => SIZES.find(s  => s.id === sizeId)?.stroke ?? 3;
  const currentRadius = () => CIRCLE_RADIUS[sizeId] ?? 14;

  // ── Transform helpers ──────────────────────────────────────────────────────
  const applyTransform = useCallback((z, px, py) => {
    if (innerRef.current) {
      innerRef.current.style.transform = `scale(${z}) translate(${px}px, ${py}px)`;
    }
  }, []);

  const commitZoom = useCallback((z) => {
    z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    if (z <= 1) { z = 1; panRef.current = { x: 0, y: 0 }; }
    zoomRef.current = z;
    setZoomDisplay(z);
    applyTransform(z, panRef.current.x, panRef.current.y);
  }, [applyTransform]);

  const zoomIn  = () => commitZoom(zoomRef.current + 0.5);
  const zoomOut = () => commitZoom(zoomRef.current - 0.5);
  const resetZoom = () => commitZoom(1);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    commitZoom(zoomRef.current + (e.deltaY < 0 ? 0.3 : -0.3));
  }, [commitZoom]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // ── Canvas sizing ──────────────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const W = canvas.width, H = canvas.height;
    shapesRef.current.forEach((s, i) => paintShape(ctx, s, W, H, i === selectedIdxRef.current));
    if (previewRef.current) paintShape(ctx, previewRef.current, W, H, false);
    if (hoverRef.current)   paintHoverCircle(ctx, hoverRef.current);
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
    window.addEventListener("resize", sizeCanvas);
    return () => window.removeEventListener("resize", sizeCanvas);
  }, [sizeCanvas]);

  useEffect(() => {
    if (imgLoaded) sizeCanvas();
  }, [imgLoaded, sizeCanvas]);

  // ── Painting ───────────────────────────────────────────────────────────────
  function paintShape(ctx, shape, W, H, isSelected) {
    if (shape.type === "square") { paintSquare(ctx, shape, W, H, isSelected); return; }
    if (shape.type === "label")  { paintLabel(ctx, shape, W, H);  return; }

    ctx.save();
    ctx.strokeStyle = shape.color;
    ctx.lineWidth   = shape.stroke;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
    ctx.globalAlpha = 0.92;

    if (shape.type === "line") {
      ctx.beginPath();
      ctx.moveTo(shape.x1, shape.y1);
      ctx.lineTo(shape.x2, shape.y2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // 10×10 test square: corner L-brackets + thin dashed border, NO fill
  function paintSquare(ctx, shape, W, H, isSelected) {
    const { x, y, w, h } = shape;
    const nx = w < 0 ? x + w : x;
    const ny = h < 0 ? y + h : y;
    const nw = Math.abs(w);
    const nh = Math.abs(h);
    if (nw < 4 || nh < 4) return;

    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.strokeStyle = isSelected ? "#60a5fa" : "#3b82f6";
    ctx.lineCap     = "square";

    // Thin dashed outline — visible but doesn't obscure anything
    ctx.lineWidth = isSelected ? 2.5 : 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(nx + 1, ny + 1, nw - 2, nh - 2);
    ctx.setLineDash([]);

    // Solid L-bracket corner marks (like chalk on the real roof)
    const arm = Math.min(nw, nh) * 0.22;
    ctx.lineWidth = isSelected ? 5 : 4;
    [
      [[nx, ny + arm],           [nx, ny],           [nx + arm, ny]],
      [[nx + nw - arm, ny],      [nx + nw, ny],      [nx + nw, ny + arm]],
      [[nx + nw, ny + nh - arm], [nx + nw, ny + nh], [nx + nw - arm, ny + nh]],
      [[nx + arm, ny + nh],      [nx, ny + nh],      [nx, ny + nh - arm]],
    ].forEach(pts => {
      ctx.beginPath();
      ctx.moveTo(...pts[0]);
      ctx.lineTo(...pts[1]);
      ctx.lineTo(...pts[2]);
      ctx.stroke();
    });

    // "10×10" label in center — small with dark shadow, won't obscure hail marks
    const fs = Math.max(10, Math.min(16, Math.min(nw, nh) * 0.14));
    ctx.globalAlpha  = 0.85;
    ctx.font         = `bold ${fs}px sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor  = "rgba(0,0,0,0.9)";
    ctx.shadowBlur   = 4;
    ctx.fillStyle    = "#93c5fd";
    ctx.fillText("10×10", nx + nw / 2, ny + nh / 2);
    ctx.shadowBlur   = 0;

    // Corner resize handles — white squares with blue border
    if (isSelected) {
      const corners = sqCorners(shape);
      ctx.globalAlpha = 1;
      Object.values(corners).forEach(c => {
        ctx.fillStyle   = "#ffffff";
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth   = 2;
        ctx.lineCap     = "butt";
        ctx.beginPath();
        ctx.rect(c.x - 6, c.y - 6, 12, 12);
        ctx.fill();
        ctx.stroke();
      });
    }

    ctx.restore();
  }

  // Section label: white marker-note card — looks like a human wrote it on the photo
  function paintLabel(ctx, shape, W, H) {
    const { x, y, section, hailCount, windCount } = shape;
    if (!section && !hailCount && !windCount) return;

    ctx.save();

    // Build lines exactly like a field inspector would write:
    //   FRONT SLOPE
    //   Hail: 20 hits
    //   Wind: 45
    const lines = [];
    if (section)    lines.push({ text: section.toUpperCase(), bold: true,  size: 1.0 });
    if (hailCount)  lines.push({ text: `Hail: ${hailCount} hits`, bold: false, size: 0.80 });
    if (windCount)  lines.push({ text: `Wind: ${windCount}`,       bold: false, size: 0.80 });

    const baseFs = Math.max(14, Math.min(22, W * 0.038));
    const pad    = 10;
    const lineH  = baseFs * 1.35;

    // Measure widest line
    let maxTw = 0;
    lines.forEach(l => {
      const fs = Math.round(baseFs * l.size);
      ctx.font = `${l.bold ? "bold " : ""}${fs}px Arial, sans-serif`;
      maxTw = Math.max(maxTw, ctx.measureText(l.text).width);
    });

    const boxW = maxTw + pad * 2.2;
    const boxH = lines.reduce((acc, l) => acc + Math.round(baseFs * l.size) * 1.35, 0) + pad * 1.6;

    // Keep card fully on canvas, prefer to sit above/left of tap point
    const bx = Math.max(4, Math.min(W - boxW - 4, x - boxW / 2));
    const by = Math.max(4, Math.min(H - boxH - 20, y - boxH - 18));

    // Drop shadow
    ctx.shadowColor  = "rgba(0,0,0,0.55)";
    ctx.shadowBlur   = 8;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;

    // White card background
    ctx.globalAlpha = 0.97;
    ctx.fillStyle   = "#fffef8";
    roundRect(ctx, bx, by, boxW, boxH, 5);
    ctx.fill();

    // Turn off shadow for border + text
    ctx.shadowColor = "transparent";
    ctx.shadowBlur  = 0;

    // Thin dark border — like a marker outline
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth   = 2;
    roundRect(ctx, bx, by, boxW, boxH, 5);
    ctx.stroke();

    // Top colour bar — red strip for quick section identification
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.roundRect
      ? ctx.roundRect(bx, by, boxW, baseFs * 0.32, [5, 5, 0, 0])
      : (ctx.rect(bx, by, boxW, baseFs * 0.32));
    ctx.fill();

    // Text lines
    ctx.globalAlpha  = 1;
    ctx.textAlign    = "left";
    ctx.textBaseline = "top";
    let ty = by + pad * 0.7 + baseFs * 0.32;
    lines.forEach(l => {
      const fs = Math.round(baseFs * l.size);
      ctx.font      = `${l.bold ? "bold " : ""}${fs}px Arial, sans-serif`;
      ctx.fillStyle = l.bold ? "#0f172a" : "#374151";
      ctx.fillText(l.text, bx + pad, ty);
      ty += fs * 1.35;
    });

    // Leader line from bottom-center of card to tap point
    const lx = Math.max(bx + 12, Math.min(bx + boxW - 12, x));
    const ly = by + boxH;
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth   = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Tap dot
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  function paintHoverCircle(ctx, h) {
    ctx.save();
    ctx.strokeStyle = h.color;
    ctx.lineWidth   = h.stroke;
    ctx.lineCap     = "round";
    ctx.globalAlpha = 0.40;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(h.cx, h.cy, h.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── Coordinate helper ──────────────────────────────────────────────────────
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

  function placeCircle(pos) {
    const shape = {
      type: "circle",
      color: currentColor(),
      stroke: currentStroke(),
      cx: pos.x,
      cy: pos.y,
      r: currentRadius(),
    };
    shapesRef.current = [...shapesRef.current, shape];
    setShapeCount(shapesRef.current.length);
    setSaved(false);
    redraw();
  }

  // ── Mouse events ───────────────────────────────────────────────────────────
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    if (tool === "move" && zoomRef.current > 1) {
      isPanDrag.current = true;
      panStart.current  = { x: e.clientX, y: e.clientY };
      panOff.current    = { ...panRef.current };
      return;
    }
    if (tool === "move") return;

    // Label: click to place, then show input panel
    if (tool === "label") {
      e.preventDefault();
      const pos = getPos(e);
      setPendingLabel(pos);
      return;
    }

    if (tool === "square") {
      e.preventDefault();
      const pos = getPos(e);

      // Check corner handles on selected box → resize
      if (selectedIdxRef.current >= 0) {
        const sel = shapesRef.current[selectedIdxRef.current];
        const hk  = hitHandleKey(pos, sel);
        if (hk) {
          const fc = sqCorners(sel)[OPPOSITE[hk]];
          fixedCornerRef.current = fc;
          resizingRef.current    = true;
          isDownRef.current      = true;
          return;
        }
      }

      // Missed all handles → deselect + start a fresh draw
      selectedIdxRef.current = -1;
      isDownRef.current      = true;
      startRef.current       = pos;
      previewRef.current     = null;
      return;
    }

    e.preventDefault();
    isDownRef.current  = true;
    startRef.current   = getPos(e);
    previewRef.current = null;
  };

  const onMouseMove = (e) => {
    if (isPanDrag.current) {
      const dx = (e.clientX - panStart.current.x) / zoomRef.current;
      const dy = (e.clientY - panStart.current.y) / zoomRef.current;
      panRef.current = { x: panOff.current.x + dx, y: panOff.current.y + dy };
      applyTransform(zoomRef.current, panRef.current.x, panRef.current.y);
      return;
    }

    // Resize drag
    if (resizingRef.current && fixedCornerRef.current && selectedIdxRef.current >= 0) {
      e.preventDefault();
      const pos = getPos(e);
      const fc  = fixedCornerRef.current;
      shapesRef.current = shapesRef.current.map((s, i) =>
        i === selectedIdxRef.current
          ? { ...s, x: fc.x, y: fc.y, w: pos.x - fc.x, h: pos.y - fc.y }
          : s
      );
      redraw();
      return;
    }

    if (tool === "circle") {
      const pos = getPos(e);
      hoverRef.current = { cx: pos.x, cy: pos.y, r: currentRadius(), color: currentColor(), stroke: currentStroke() };
      if (!isDownRef.current) { redraw(); return; }
    } else {
      hoverRef.current = null;
    }

    if (!isDownRef.current || !startRef.current) return;
    e.preventDefault();

    const pos = getPos(e);
    if (tool === "line") {
      previewRef.current = { type: "line", color: currentColor(), stroke: currentStroke(), x1: startRef.current.x, y1: startRef.current.y, x2: pos.x, y2: pos.y };
    } else if (tool === "square") {
      previewRef.current = { type: "square", x: startRef.current.x, y: startRef.current.y, w: pos.x - startRef.current.x, h: pos.y - startRef.current.y };
    }
    redraw();
  };

  const onMouseUp = (e) => {
    if (isPanDrag.current) { isPanDrag.current = false; return; }

    // Finish resize
    if (resizingRef.current) {
      resizingRef.current   = false;
      fixedCornerRef.current = null;
      isDownRef.current      = false;
      setSaved(false);
      redraw();
      return;
    }

    if (!isDownRef.current || !startRef.current) return;
    isDownRef.current = false;
    const pos = getPos(e);

    if (tool === "circle") {
      placeCircle(startRef.current);
    } else if (tool === "line") {
      const dx = Math.abs(pos.x - startRef.current.x);
      const dy = Math.abs(pos.y - startRef.current.y);
      if (dx >= 5 || dy >= 5) {
        shapesRef.current = [...shapesRef.current, { type: "line", color: currentColor(), stroke: currentStroke(), x1: startRef.current.x, y1: startRef.current.y, x2: pos.x, y2: pos.y }];
        setShapeCount(shapesRef.current.length);
        setSaved(false);
      }
    } else if (tool === "square") {
      const dx = Math.abs(pos.x - startRef.current.x);
      const dy = Math.abs(pos.y - startRef.current.y);
      if (dx >= 5 || dy >= 5) {
        const newShape = { type: "square", x: startRef.current.x, y: startRef.current.y, w: pos.x - startRef.current.x, h: pos.y - startRef.current.y };
        shapesRef.current = [...shapesRef.current, newShape];
        selectedIdxRef.current = shapesRef.current.length - 1; // auto-select new box
        setShapeCount(shapesRef.current.length);
        setSaved(false);
      }
    }
    previewRef.current = null;
    redraw();
    startRef.current = null;
  };

  const onMouseLeave = (e) => {
    hoverRef.current = null;
    redraw();
    onMouseUp(e);
  };

  // ── Touch events ───────────────────────────────────────────────────────────
  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      pinchRef.current = { active: true, lastDist: Math.hypot(dx, dy) };
      isDownRef.current  = false;
      previewRef.current = null;
      redraw();
      return;
    }
    pinchRef.current.active = false;

    if (tool === "move" && zoomRef.current > 1) {
      isPanDrag.current = true;
      panStart.current  = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      panOff.current    = { ...panRef.current };
      return;
    }
    if (tool === "move") return;

    if (tool === "label") {
      e.preventDefault();
      const pos = getPos(e);
      setPendingLabel(pos);
      return;
    }

    if (tool === "square") {
      e.preventDefault();
      const pos = getPos(e);

      // Check corner handles on selected box → resize
      if (selectedIdxRef.current >= 0) {
        const sel = shapesRef.current[selectedIdxRef.current];
        const hk  = hitHandleKey(pos, sel);
        if (hk) {
          const fc = sqCorners(sel)[OPPOSITE[hk]];
          fixedCornerRef.current = fc;
          resizingRef.current    = true;
          isDownRef.current      = true;
          return;
        }
      }

      // Missed all handles → deselect + start a fresh draw
      selectedIdxRef.current = -1;
      isDownRef.current      = true;
      startRef.current       = pos;
      previewRef.current     = null;
      return;
    }

    e.preventDefault();
    isDownRef.current  = true;
    startRef.current   = getPos(e);
    previewRef.current = null;
  };

  const onTouchMove = (e) => {
    if (e.touches.length === 2 && pinchRef.current.active) {
      e.preventDefault();
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.hypot(dx, dy);
      if (pinchRef.current.lastDist > 0) commitZoom(zoomRef.current * (dist / pinchRef.current.lastDist));
      pinchRef.current.lastDist = dist;
      return;
    }
    if (isPanDrag.current && e.touches.length === 1) {
      const dx = (e.touches[0].clientX - panStart.current.x) / zoomRef.current;
      const dy = (e.touches[0].clientY - panStart.current.y) / zoomRef.current;
      panRef.current = { x: panOff.current.x + dx, y: panOff.current.y + dy };
      applyTransform(zoomRef.current, panRef.current.x, panRef.current.y);
      return;
    }

    // Resize drag (touch)
    if (resizingRef.current && fixedCornerRef.current && selectedIdxRef.current >= 0) {
      e.preventDefault();
      const pos = getPos(e);
      const fc  = fixedCornerRef.current;
      shapesRef.current = shapesRef.current.map((s, i) =>
        i === selectedIdxRef.current
          ? { ...s, x: fc.x, y: fc.y, w: pos.x - fc.x, h: pos.y - fc.y }
          : s
      );
      redraw();
      return;
    }

    if (!isDownRef.current || !startRef.current) return;
    e.preventDefault();

    const pos = getPos(e);
    if (tool === "line") {
      previewRef.current = { type: "line", color: currentColor(), stroke: currentStroke(), x1: startRef.current.x, y1: startRef.current.y, x2: pos.x, y2: pos.y };
    } else if (tool === "square") {
      previewRef.current = { type: "square", x: startRef.current.x, y: startRef.current.y, w: pos.x - startRef.current.x, h: pos.y - startRef.current.y };
    }
    redraw();
  };

  const onTouchEnd = (e) => {
    if (pinchRef.current.active) { pinchRef.current.active = false; return; }
    if (isPanDrag.current) { isPanDrag.current = false; return; }

    // Finish resize (touch)
    if (resizingRef.current) {
      resizingRef.current    = false;
      fixedCornerRef.current = null;
      isDownRef.current      = false;
      setSaved(false);
      redraw();
      return;
    }

    if (!isDownRef.current || !startRef.current) return;
    isDownRef.current = false;

    const src = e.changedTouches?.[0];
    if (!src) { previewRef.current = null; redraw(); return; }

    const canvas = canvasRef.current;
    const rect   = canvas.getBoundingClientRect();
    const pos    = {
      x: (src.clientX - rect.left) * (canvas.width  / rect.width),
      y: (src.clientY - rect.top)  * (canvas.height / rect.height),
    };

    if (tool === "circle") {
      placeCircle(startRef.current);
    } else if (tool === "line") {
      const dx = Math.abs(pos.x - startRef.current.x);
      const dy = Math.abs(pos.y - startRef.current.y);
      if (dx >= 5 || dy >= 5) {
        shapesRef.current = [...shapesRef.current, { type: "line", color: currentColor(), stroke: currentStroke(), x1: startRef.current.x, y1: startRef.current.y, x2: pos.x, y2: pos.y }];
        setShapeCount(shapesRef.current.length);
        setSaved(false);
      }
    } else if (tool === "square") {
      const dx = Math.abs(pos.x - startRef.current.x);
      const dy = Math.abs(pos.y - startRef.current.y);
      if (dx >= 5 || dy >= 5) {
        const newShape = { type: "square", x: startRef.current.x, y: startRef.current.y, w: pos.x - startRef.current.x, h: pos.y - startRef.current.y };
        shapesRef.current = [...shapesRef.current, newShape];
        selectedIdxRef.current = shapesRef.current.length - 1;
        setShapeCount(shapesRef.current.length);
        setSaved(false);
      }
    }
    previewRef.current = null;
    redraw();
    startRef.current = null;
  };

  // ── Undo / Clear ──────────────────────────────────────────────────────────
  const undo = () => {
    shapesRef.current = shapesRef.current.slice(0, -1);
    setShapeCount(shapesRef.current.length);
    redraw();
  };
  const clear = () => {
    shapesRef.current = [];
    setShapeCount(0);
    redraw();
  };

  // ── Label commit ──────────────────────────────────────────────────────────
  function commitLabel() {
    if (!pendingLabel) return;
    if (!labelForm.section.trim() && !labelForm.hailCount.trim() && !labelForm.windCount.trim()) return;
    shapesRef.current = [...shapesRef.current, {
      type: "label",
      x: pendingLabel.x,
      y: pendingLabel.y,
      section:    labelForm.section.trim(),
      hailCount:  labelForm.hailCount.trim(),
      windCount:  labelForm.windCount.trim(),
    }];
    setShapeCount(shapesRef.current.length);
    setSaved(false);
    setPendingLabel(null);
    setLabelForm(BLANK_LABEL);
    redraw();
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  const buildMergedBlob = () => new Promise((resolve, reject) => {
    const img    = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) { reject(new Error("Not ready")); return; }

    const naturalW = img.naturalWidth  || canvas.width;
    const naturalH = img.naturalHeight || canvas.height;
    const scaleX   = naturalW / canvas.width;
    const scaleY   = naturalH / canvas.height;
    const scale    = Math.max(scaleX, scaleY);

    const out = document.createElement("canvas");
    out.width  = naturalW;
    out.height = naturalH;
    const ctx  = out.getContext("2d");

    fetch(photoUrl)
      .then(r => r.blob())
      .then(blob => {
        const objUrl  = URL.createObjectURL(blob);
        const baseImg = new Image();
        baseImg.onload = () => {
          URL.revokeObjectURL(objUrl);
          ctx.drawImage(baseImg, 0, 0, naturalW, naturalH);

          shapesRef.current.forEach(s => {
            if (s.type === "square") {
              paintSquare(ctx, {
                ...s,
                x: s.x * scaleX, y: s.y * scaleY,
                w: s.w * scaleX, h: s.h * scaleY,
              }, naturalW, naturalH);
            } else if (s.type === "label") {
              paintLabel(ctx, { ...s, x: s.x * scaleX, y: s.y * scaleY }, naturalW, naturalH);
            } else {
              ctx.save();
              ctx.strokeStyle = s.color;
              ctx.lineWidth   = s.stroke * scale;
              ctx.lineCap     = "round";
              ctx.lineJoin    = "round";
              ctx.globalAlpha = 0.92;
              if (s.type === "line") {
                ctx.beginPath();
                ctx.moveTo(s.x1 * scaleX, s.y1 * scaleY);
                ctx.lineTo(s.x2 * scaleX, s.y2 * scaleY);
                ctx.stroke();
              } else {
                ctx.beginPath();
                ctx.arc(s.cx * scaleX, s.cy * scaleY, s.r * scale, 0, Math.PI * 2);
                ctx.stroke();
              }
              ctx.globalAlpha = 1;
              ctx.restore();
            }
          });

          out.toBlob(b => b ? resolve(b) : reject(new Error("toBlob failed")), "image/jpeg", 0.92);
        };
        baseImg.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error("Photo load failed")); };
        baseImg.src = objUrl;
      })
      .catch(reject);
  });

  const handleDownload = async () => {
    if (shapesRef.current.length === 0) { alert("Draw something first."); return; }
    try {
      const blob = await buildMergedBlob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `marked-up-photo-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Download failed: " + err.message);
    }
  };

  const handleSave = async () => {
    if (shapesRef.current.length === 0) { alert("Draw something first."); return; }
    setIsSaving(true);
    try {
      const blob = await buildMergedBlob();
      const file = new File([blob], `markup_${Date.now()}.jpg`, { type: "image/jpeg" });
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      if (mediaId) {
        await base44.entities.JobMedia.update(mediaId, { annotated_url: file_url });
      }
      setSaved(true);
      if (onSave) onSave(file_url);
    } catch (err) {
      alert("Save failed: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const isZoomed = zoomDisplay > 1;
  const cursor   = tool === "move" || (tool === "label" && !pendingLabel)
    ? (isPanDrag.current ? "grabbing" : tool === "label" ? "cell" : "grab")
    : "crosshair";

  const hintText = () => {
    if (isZoomed)          return "Drag to pan · scroll or pinch to zoom";
    if (tool === "circle") return "Click anywhere to place a circle · scroll to zoom";
    if (tool === "line")   return "Drag to draw a line · scroll to zoom";
    if (tool === "square") return "Drag to draw a test square — any size, any shape";
    if (tool === "label")  return "Tap the roof to drop a section label (Front/Left/Right/Back + hail & wind)";
    return "";
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col select-none">

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold text-sm">Photo Markup</span>
          {shapeCount > 0 && (
            <span className="text-slate-400 text-xs">{shapeCount} mark{shapeCount !== 1 ? "s" : ""}</span>
          )}
          {saved && <span className="text-green-400 text-xs font-semibold">✓ Saved</span>}
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white p-1 text-xl leading-none">✕</button>
      </div>

      {/* ── Toolbar ───────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-slate-800 border-b border-slate-700 px-3 py-2 flex flex-wrap items-center gap-2">

        {/* Tool selector */}
        <div className="flex gap-1 flex-wrap">
          {/* Circle */}
          <button
            data-testid="markup-tool-circle"
            onClick={() => { setTool("circle"); setPendingLabel(null); }}
            className={`px-3 py-1.5 rounded text-sm font-semibold border-2 transition-all ${
              tool === "circle" ? "bg-blue-600 border-blue-400 text-white" : "bg-slate-700 border-slate-600 text-slate-300 hover:border-slate-400"
            }`}
          >
            ○ Circle
          </button>

          {/* Line */}
          <button
            data-testid="markup-tool-line"
            onClick={() => { setTool("line"); setPendingLabel(null); }}
            className={`px-3 py-1.5 rounded text-sm font-semibold border-2 transition-all ${
              tool === "line" ? "bg-blue-600 border-blue-400 text-white" : "bg-slate-700 border-slate-600 text-slate-300 hover:border-slate-400"
            }`}
          >
            ╱ Line
          </button>

          {/* 10×10 Square */}
          <button
            data-testid="markup-tool-square"
            onClick={() => { setTool("square"); setPendingLabel(null); }}
            title="Draw a 10×10 ft test square — corner brackets only, hail marks stay visible"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold border-2 transition-all ${
              tool === "square" ? "bg-blue-600 border-blue-400 text-white" : "bg-slate-700 border-slate-600 text-slate-300 hover:border-slate-400"
            }`}
          >
            <Square className="w-3.5 h-3.5" />
            10×10 Sq
          </button>

          {/* Label */}
          <button
            data-testid="markup-tool-label"
            onClick={() => { setTool("label"); setPendingLabel(null); }}
            title="Tap to place a section label (Front/Left/Right/Back + hail & wind counts)"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold border-2 transition-all ${
              tool === "label" ? "bg-emerald-700 border-emerald-400 text-white" : "bg-slate-700 border-slate-600 text-slate-300 hover:border-slate-400"
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            Label
          </button>

          {/* Move / Pan */}
          <button
            data-testid="markup-tool-move"
            onClick={() => { setTool("move"); setPendingLabel(null); }}
            title="Move / Pan (drag to reposition when zoomed in)"
            className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm font-semibold border-2 transition-all ${
              tool === "move" ? "bg-blue-600 border-blue-400 text-white" : "bg-slate-700 border-slate-600 text-slate-300 hover:border-slate-400"
            }`}
          >
            <Hand className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="w-px h-6 bg-slate-600" />

        {/* Color swatches — hidden for label tool */}
        {tool !== "label" && tool !== "square" && (
          <div className="flex gap-1.5 items-center">
            {COLORS.map(c => (
              <button
                key={c.id}
                data-testid={`markup-color-${c.id}`}
                title={c.label}
                onClick={() => setColorId(c.id)}
                className={`w-7 h-7 rounded-full border-2 transition-all ${
                  colorId === c.id ? "border-white scale-110 shadow-lg" : "border-slate-600 opacity-70"
                }`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
            <div className="w-px h-6 bg-slate-600 mx-1" />
          </div>
        )}

        {/* Size — only for circle and line */}
        {(tool === "circle" || tool === "line") && (
          <div className="flex gap-1 items-center">
            <span className="text-slate-400 text-xs mr-1">{tool === "circle" ? "Size" : "Width"}</span>
            {SIZES.map(s => (
              <button
                key={s.id}
                data-testid={`markup-size-${s.id}`}
                onClick={() => setSizeId(s.id)}
                className={`w-8 h-8 rounded flex items-center justify-center text-sm font-bold border-2 transition-all ${
                  sizeId === s.id ? "bg-slate-600 border-blue-400 text-white" : "bg-slate-700 border-slate-600 text-slate-300"
                }`}
              >
                {s.label}
              </button>
            ))}
            <div className="w-px h-6 bg-slate-600 mx-1" />
          </div>
        )}

        {/* Zoom */}
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} disabled={!isZoomed} className="w-7 h-7 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-30 flex items-center justify-center" title="Zoom out">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-white text-xs font-mono w-9 text-center">{zoomDisplay.toFixed(1)}×</span>
          <button onClick={zoomIn} disabled={zoomDisplay >= MAX_ZOOM} className="w-7 h-7 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-30 flex items-center justify-center" title="Zoom in">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          {isZoomed && (
            <button onClick={resetZoom} className="w-7 h-7 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 flex items-center justify-center" title="Reset zoom">
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="flex-1" />

        {/* Undo / Clear */}
        <button onClick={undo}  disabled={shapeCount === 0} className="text-slate-400 hover:text-white disabled:opacity-30 p-1.5" title="Undo"><Undo2 className="w-4 h-4" /></button>
        <button onClick={clear} disabled={shapeCount === 0} className="text-slate-400 hover:text-red-400 disabled:opacity-30 p-1.5" title="Clear all"><Trash2 className="w-4 h-4" /></button>
      </div>

      {/* ── Canvas area ───────────────────────────────────────────────── */}
      <div ref={wrapRef} className="flex-1 overflow-hidden flex items-center justify-center bg-black relative">
        {!imgLoaded && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <Loader2 className="w-10 h-10 animate-spin text-white" />
          </div>
        )}
        <div ref={innerRef} className="relative" style={{ transformOrigin: "center center" }}>
          <img
            ref={imgRef}
            src={photoUrl}
            alt="markup"
            draggable={false}
            onLoad={() => setImgLoaded(true)}
            className="block max-w-full object-contain"
            style={{
              display: imgLoaded ? "block" : "none",
              maxHeight: pendingLabel ? "calc(100vh - 280px)" : "calc(100vh - 140px)",
            }}
          />
          <canvas
            ref={canvasRef}
            style={{
              position: "absolute", top: 0, left: 0,
              width: "100%", height: "100%",
              cursor,
              display: imgLoaded ? "block" : "none",
              touchAction: "none",
            }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          />
        </div>
      </div>

      {/* ── Label input panel ─────────────────────────────────────────── */}
      {pendingLabel && (
        <div className="shrink-0 bg-slate-900 border-t-2 border-emerald-600 px-3 pt-2 pb-3">
          {/* Quick-fill shortcuts */}
          <div className="flex gap-1.5 flex-wrap mb-2">
            <span className="text-slate-500 text-[10px] self-center mr-0.5">Quick:</span>
            {QUICK_SECTIONS.map(s => (
              <button
                key={s}
                data-testid={`label-quick-${s.toLowerCase()}`}
                onClick={() => setLabelForm(f => ({ ...f, section: s }))}
                className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white border border-slate-600 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Three fields in a row */}
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">Section</label>
              <input
                autoFocus
                data-testid="label-section-input"
                value={labelForm.section}
                onChange={e => setLabelForm(f => ({ ...f, section: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && commitLabel()}
                placeholder="e.g. Front, Left Hip…"
                className="w-full px-2.5 py-2 text-sm rounded bg-slate-800 text-white border border-slate-600 focus:outline-none focus:border-emerald-500 placeholder-slate-600"
              />
            </div>
            <div className="w-20">
              <label className="text-[10px] text-red-400 uppercase tracking-wide block mb-1">Hail hits</label>
              <input
                data-testid="label-hail-count"
                type="number"
                min="0"
                value={labelForm.hailCount}
                onChange={e => setLabelForm(f => ({ ...f, hailCount: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && commitLabel()}
                placeholder="0"
                className="w-full px-2.5 py-2 text-sm rounded bg-slate-800 text-white border border-slate-600 focus:outline-none focus:border-red-500 placeholder-slate-600"
              />
            </div>
            <div className="w-20">
              <label className="text-[10px] text-yellow-400 uppercase tracking-wide block mb-1">Wind</label>
              <input
                data-testid="label-wind-count"
                type="text"
                value={labelForm.windCount}
                onChange={e => setLabelForm(f => ({ ...f, windCount: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && commitLabel()}
                placeholder="mph"
                className="w-full px-2.5 py-2 text-sm rounded bg-slate-800 text-white border border-slate-600 focus:outline-none focus:border-yellow-500 placeholder-slate-600"
              />
            </div>
            <button
              data-testid="label-add"
              onClick={commitLabel}
              className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors whitespace-nowrap"
            >
              Add ✓
            </button>
            <button
              data-testid="label-cancel"
              onClick={() => { setPendingLabel(null); setLabelForm(BLANK_LABEL); }}
              className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-400 text-sm transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── Footer hint + actions ─────────────────────────────────────── */}
      <div className="shrink-0 bg-slate-900 border-t border-slate-700 px-4 py-3 flex items-center justify-between gap-3">
        <p className="text-slate-400 text-xs hidden sm:block">{hintText()}</p>
        <div className="flex gap-2 ml-auto">
          <button
            data-testid="markup-download"
            onClick={handleDownload}
            disabled={shapeCount === 0}
            className="flex items-center gap-2 px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium disabled:opacity-40 transition-colors"
          >
            <Download className="w-4 h-4" />
            Download
          </button>
          {mediaId && (
            <button
              data-testid="markup-save"
              onClick={handleSave}
              disabled={shapeCount === 0 || isSaving}
              className="flex items-center gap-2 px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-40 transition-colors"
            >
              {isSaving
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                : <><Save className="w-4 h-4" /> Save to Job</>
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
