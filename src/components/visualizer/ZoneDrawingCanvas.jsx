import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Check, X } from "lucide-react";
import { SIDING_COLORS, SIDING_MATERIALS, ColorSection } from "./colorOptions";

export const ZONE_FILL_COLORS = [
  { hex: "#ef4444", name: "red" },
  { hex: "#3b82f6", name: "blue" },
  { hex: "#22c55e", name: "green" },
  { hex: "#f59e0b", name: "amber" },
  { hex: "#8b5cf6", name: "purple" },
  { hex: "#06b6d4", name: "cyan" },
];

const CLOSE_PX = 20;

export default function ZoneDrawingCanvas({ photo, zones, onZonesChange }) {
  const [drawing, setDrawing] = useState(false);
  const [inProgress, setInProgress] = useState([]);
  const [hoverPos, setHoverPos] = useState(null);
  const [pendingZone, setPendingZone] = useState(null);
  const svgRef = useRef(null);

  const nextFill = ZONE_FILL_COLORS[zones.length % ZONE_FILL_COLORS.length];

  const getPos = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (cx - r.left) / r.width, y: (cy - r.top) / r.height, rect: r };
  }, []);

  const nearFirst = useCallback((pos) => {
    if (!inProgress.length || !pos?.rect) return false;
    const first = inProgress[0];
    const dx = (pos.x - first.x) * pos.rect.width;
    const dy = (pos.y - first.y) * pos.rect.height;
    return Math.sqrt(dx * dx + dy * dy) < CLOSE_PX;
  }, [inProgress]);

  const closePolygon = useCallback((pts) => {
    if (pts.length < 3) return;
    setPendingZone({
      id: crypto.randomUUID(),
      label: `Zone ${zones.length + 1}`,
      material: "wood_shake",
      color: SIDING_COLORS[2].name,
      fillHex: nextFill.hex,
      points: pts.map(({ x, y }) => ({ x, y })),
    });
    setInProgress([]);
    setDrawing(false);
    setHoverPos(null);
  }, [zones.length, nextFill.hex]);

  const handleClick = useCallback((e) => {
    if (!drawing) return;
    const pos = getPos(e);
    if (!pos) return;
    if (inProgress.length >= 3 && nearFirst(pos)) {
      closePolygon(inProgress);
      return;
    }
    setInProgress((prev) => [...prev, pos]);
  }, [drawing, getPos, inProgress, nearFirst, closePolygon]);

  const handleMove = useCallback((e) => {
    if (!drawing) return;
    setHoverPos(getPos(e));
  }, [drawing, getPos]);

  const handleDblClick = useCallback((e) => {
    if (!drawing || inProgress.length < 3) return;
    e.preventDefault();
    closePolygon(inProgress);
  }, [drawing, inProgress, closePolygon]);

  const svgPts = (pts) =>
    pts.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(" ");

  const canClose = inProgress.length >= 3 && nearFirst(hoverPos);
  const cursor = drawing ? (canClose ? "cell" : "crosshair") : "default";

  return (
    <div className="space-y-3">
      <div
        className="relative rounded-lg overflow-hidden border border-gray-200 bg-gray-100 select-none"
        style={{ cursor }}
      >
        <img
          src={photo.preview}
          alt="House"
          className="w-full block pointer-events-none"
          draggable={false}
        />

        <svg
          ref={svgRef}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: drawing ? "all" : "none" }}
          onClick={handleClick}
          onMouseMove={handleMove}
          onDoubleClick={handleDblClick}
        >
          {zones.map((z) => {
            const cx =
              (z.points.reduce((s, p) => s + p.x, 0) / z.points.length) * 100;
            const cy =
              (z.points.reduce((s, p) => s + p.y, 0) / z.points.length) * 100;
            return (
              <g key={z.id}>
                <polygon
                  points={svgPts(z.points)}
                  fill={z.fillHex + "44"}
                  stroke={z.fillHex}
                  strokeWidth="0.6"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                <rect
                  x={cx - 9}
                  y={cy - 3}
                  width={18}
                  height={6}
                  rx="1"
                  fill={z.fillHex + "dd"}
                />
                <text
                  x={cx}
                  y={cy + 1.2}
                  textAnchor="middle"
                  fontSize="3.5"
                  fill="white"
                  fontWeight="bold"
                  style={{ fontFamily: "system-ui, sans-serif", pointerEvents: "none" }}
                >
                  {z.label.length > 10 ? z.label.slice(0, 9) + "…" : z.label}
                </text>
              </g>
            );
          })}

          {inProgress.length > 0 && (() => {
            const last = inProgress[inProgress.length - 1];
            return (
              <g>
                {inProgress.length > 1 && (
                  <polyline
                    points={svgPts(inProgress)}
                    fill="none"
                    stroke={nextFill.hex}
                    strokeWidth="1"
                    strokeDasharray="2 1"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {hoverPos && (
                  <line
                    x1={last.x * 100}
                    y1={last.y * 100}
                    x2={hoverPos.x * 100}
                    y2={hoverPos.y * 100}
                    stroke={nextFill.hex}
                    strokeWidth="0.8"
                    strokeDasharray="1.5 1"
                    opacity="0.7"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {inProgress.map((pt, i) => {
                  const isFirst = i === 0;
                  const snap = isFirst && inProgress.length >= 3 && nearFirst(hoverPos);
                  return (
                    <circle
                      key={i}
                      cx={pt.x * 100}
                      cy={pt.y * 100}
                      r={isFirst ? (snap ? 2.8 : 2) : 1.2}
                      fill={isFirst && inProgress.length >= 3 ? "#22c55e" : nextFill.hex}
                      stroke="white"
                      strokeWidth="0.4"
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
              </g>
            );
          })()}
        </svg>

        {drawing && (
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 pointer-events-none">
            <span className="bg-black/65 text-white text-xs px-2.5 py-1 rounded-md leading-snug">
              {inProgress.length === 0
                ? "Click to place first point"
                : inProgress.length < 3
                ? `${inProgress.length} point${inProgress.length > 1 ? "s" : ""} — keep clicking`
                : "Click the green dot (or double-click) to finish"}
            </span>
            <button
              className="pointer-events-auto bg-black/65 hover:bg-black/80 text-white text-xs px-2 py-1 rounded-md flex items-center gap-1 flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                setDrawing(false);
                setInProgress([]);
                setHoverPos(null);
              }}
            >
              <X className="w-3 h-3" /> Cancel
            </button>
          </div>
        )}
      </div>

      {pendingZone && (
        <ZoneConfigPanel
          initialZone={pendingZone}
          onConfirm={(zone) => {
            onZonesChange([...zones, zone]);
            setPendingZone(null);
          }}
          onCancel={() => setPendingZone(null)}
        />
      )}

      {!drawing && !pendingZone && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setDrawing(true); setInProgress([]); }}
          className="w-full border-dashed border-purple-300 text-purple-700 hover:border-purple-500 hover:bg-purple-50"
          data-testid="draw-zone-btn"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          {zones.length === 0 ? "Draw a material zone" : "Draw another zone"}
        </Button>
      )}

      {zones.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Zones
          </p>
          {zones.map((z) => (
            <div
              key={z.id}
              className="flex items-center gap-2.5 bg-white rounded-lg border px-3 py-2"
            >
              <div
                className="w-3 h-3 rounded-full flex-shrink-0 ring-2 ring-white shadow-sm"
                style={{ backgroundColor: z.fillHex }}
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{z.label}</span>
                <span className="text-xs text-gray-400 ml-2">
                  {SIDING_MATERIALS.find((m) => m.id === z.material)?.label} ·{" "}
                  {z.color}
                </span>
              </div>
              <button
                onClick={() => onZonesChange(zones.filter((zz) => zz.id !== z.id))}
                className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                data-testid={`delete-zone-${z.id}`}
                title="Remove zone"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ZoneConfigPanel({ initialZone, onConfirm, onCancel }) {
  const [zone, setZone] = useState(initialZone);
  const update = (key, val) => setZone((z) => ({ ...z, [key]: val }));

  return (
    <div className="border-2 border-purple-200 rounded-xl p-4 space-y-4 bg-purple-50/60 shadow-sm">
      <div className="flex items-center gap-2">
        <div
          className="w-4 h-4 rounded-full ring-2 ring-white shadow"
          style={{ backgroundColor: zone.fillHex }}
        />
        <h4 className="font-semibold text-sm text-gray-800">Configure this zone</h4>
      </div>

      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">
          Zone name
        </label>
        <input
          type="text"
          value={zone.label}
          onChange={(e) => update("label", e.target.value)}
          className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 bg-white"
          placeholder="e.g. Left Wall, Dormer, Garage, Foundation"
          autoFocus
          data-testid="zone-label-input"
        />
      </div>

      <div>
        <p className="text-xs font-medium text-gray-500 mb-1.5">Material</p>
        <div className="flex flex-wrap gap-1.5">
          {SIDING_MATERIALS.map((m) => (
            <button
              key={m.id}
              onClick={() => update("material", m.id)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                zone.material === m.id
                  ? "bg-purple-600 text-white border-purple-600"
                  : "bg-white text-gray-600 border-gray-200 hover:border-purple-300"
              }`}
              data-testid={`zone-material-${m.id}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <ColorSection
        label="Color"
        colors={SIDING_COLORS}
        value={zone.color}
        onChange={(v) => update("color", v)}
      />

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          className="flex-1 bg-purple-600 hover:bg-purple-700"
          onClick={() => onConfirm(zone)}
          data-testid="zone-confirm-btn"
        >
          <Check className="w-3 h-3 mr-1" /> Add Zone
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} data-testid="zone-cancel-btn">
          Cancel
        </Button>
      </div>
    </div>
  );
}
