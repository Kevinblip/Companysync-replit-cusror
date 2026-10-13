import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, RotateCcw, CheckCircle2, X, Move, Pencil, Plus } from "lucide-react";

const DIRECTION_COLORS = {
  N: "#ef4444", NORTH: "#ef4444", FRONT: "#ef4444",
  S: "#3b82f6", SOUTH: "#3b82f6", BACK: "#3b82f6",
  E: "#22c55e", EAST: "#22c55e", RIGHT: "#22c55e",
  NE: "#22c55e", SE: "#22c55e",
  W: "#f59e0b", WEST: "#f59e0b", LEFT: "#f59e0b",
  NW: "#f59e0b", SW: "#f59e0b",
};

const DIRECTION_OPTIONS = [
  { code: "N",  label: "N"  },
  { code: "NE", label: "NE" },
  { code: "E",  label: "E"  },
  { code: "SE", label: "SE" },
  { code: "S",  label: "S"  },
  { code: "SW", label: "SW" },
  { code: "W",  label: "W"  },
  { code: "NW", label: "NW" },
  { code: "",   label: "—"  },
];

const iconBtnStyle = {
  width: 32, height: 32,
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(255,255,255,0.08)",
  color: "#fff",
  cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center"
};

function getColor(direction) {
  if (!direction) return "#8b5cf6";
  const d = direction.toUpperCase();
  return DIRECTION_COLORS[d] || "#8b5cf6";
}

/**
 * AerialSquareAdjuster
 *
 * Shows the overhead aerial image with draggable test-square overlays.
 * Inspector can:
 *   - zoom in / out with buttons (or pinch on mobile)
 *   - pan by dragging the background
 *   - drag any square's center handle to reposition it
 *   - confirm to proceed with the adjusted positions
 *   - cancel to abort
 */
export default function AerialSquareAdjuster({ imageUrl, sections: initialSections, normPpf, scaleNote, onConfirm, onCancel }) {
  const [sections, setSections] = useState(() => initialSections.map(s => ({ ...s })));
  const [zoom, setZoom] = useState(1);
  const [dragState, setDragState] = useState(null); // { index, lastX, lastY }
  const [imgLoaded, setImgLoaded] = useState(false);
  const [editingIdx, setEditingIdx] = useState(null); // which section label is being edited
  const [editingName, setEditingName] = useState("");
  const [editingDirection, setEditingDirection] = useState(""); // direction selected while editing

  // Draft state for the "add section" flow — direction + name picker before committing
  const [newSectionDraft, setNewSectionDraft] = useState(null); // null | { name, direction }

  const imgRef = useRef(null);
  const lastDirectionRef = useRef(""); // tracks last-used direction within session

  // Square size as a % of the image display dimensions
  // normPpf is pixels-per-foot on a 0–1000 scale, so 10ft = 10*normPpf / 1000 * 100%
  const squarePctW = Math.max(2, (10 * normPpf) / 1000 * 100); // % of img width
  const squarePctH = Math.max(2, (10 * normPpf) / 1000 * 100); // treat as square

  const handleImgLoad = () => {
    setImgLoaded(true);
  };

  const zoomIn  = () => setZoom(z => Math.min(5, parseFloat((z + 0.5).toFixed(1))));
  const zoomOut = () => setZoom(z => Math.max(0.5, parseFloat((z - 0.5).toFixed(1))));
  const resetZoom = () => setZoom(1);

  // Convert a DOM pointer position (relative to the img element's top-left at current zoom)
  // to normalized 0-1000 scale coordinates
  const ptrToNorm = useCallback((clientX, clientY) => {
    if (!imgRef.current) return { nx: 0, ny: 0 };
    const rect = imgRef.current.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1000, ((clientX - rect.left) / rect.width)  * 1000));
    const ny = Math.max(0, Math.min(1000, ((clientY - rect.top)  / rect.height) * 1000));
    return { nx, ny };
  }, []);

  // ── Pointer events on the SQUARE HANDLE
  const onSquarePointerDown = useCallback((e, idx) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({ index: idx, lastX: e.clientX, lastY: e.clientY });
  }, []);

  const onSquarePointerMove = useCallback((e, idx) => {
    if (!dragState || dragState.index !== idx) return;
    e.stopPropagation();
    const { nx, ny } = ptrToNorm(e.clientX, e.clientY);
    setSections(prev => prev.map((s, i) => i === idx ? { ...s, center_x: nx, center_y: ny } : s));
    setDragState(d => ({ ...d, lastX: e.clientX, lastY: e.clientY }));
  }, [dragState, ptrToNorm]);

  const onSquarePointerUp = useCallback((e) => {
    e.stopPropagation();
    setDragState(null);
  }, []);

  const startEditingName = useCallback((e, idx, currentName, currentDirection) => {
    e.stopPropagation();
    setEditingIdx(idx);
    setEditingName(currentName);
    setEditingDirection(currentDirection ?? "");
  }, []);

  const commitEditingName = useCallback(() => {
    if (editingIdx === null) return;
    setSections(prev => prev.map((s, i) =>
      i === editingIdx ? { ...s, name: editingName.trim() || s.name, direction: editingDirection } : s
    ));
    setEditingIdx(null);
  }, [editingIdx, editingName, editingDirection]);

  const pickEditingDirection = useCallback((idx, code) => {
    setEditingDirection(code);
    // Immediately recolor the section so the border/label update in real time
    setSections(prev => prev.map((s, i) => i === idx ? { ...s, direction: code } : s));
  }, []);

  // Open the direction-picker popover instead of immediately adding
  const addSection = useCallback(() => {
    setNewSectionDraft({
      name: `Section ${sections.length + 1}`,
      direction: lastDirectionRef.current,
    });
  }, [sections.length]);

  // Confirm the new section draft and push it to the list
  const confirmNewSection = useCallback(() => {
    if (!newSectionDraft) return;
    lastDirectionRef.current = newSectionDraft.direction;
    const section = {
      name: newSectionDraft.name.trim() || `Section ${sections.length + 1}`,
      direction: newSectionDraft.direction,
      center_x: 500,
      center_y: 500,
    };
    setSections(prev => [...prev, section]);
    setNewSectionDraft(null);
  }, [newSectionDraft, sections.length]);

  const cancelNewSection = useCallback(() => {
    setNewSectionDraft(null);
  }, []);

  const removeSection = useCallback((e, idx) => {
    e.stopPropagation();
    setSections(prev => prev.filter((_, i) => i !== idx));
    setEditingIdx(null);
  }, []);

  const handleConfirm = () => {
    if (editingIdx !== null) {
      setSections(prev => {
        const updated = prev.map((s, i) =>
          i === editingIdx ? { ...s, name: editingName.trim() || s.name, direction: editingDirection } : s
        );
        onConfirm(updated);
        return updated;
      });
      setEditingIdx(null);
    } else {
      onConfirm(sections);
    }
  };

  const draftColor = getColor(newSectionDraft?.direction || "");

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.85)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "12px"
      }}
    >
      {/* Header */}
      <div style={{
        width: "100%", maxWidth: 900,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 8, color: "#fff"
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Adjust Test Square Placement</h2>
            <span
              data-testid="aerial-adjuster-section-count"
              style={{
                background: "rgba(255,255,255,0.15)",
                border: "1px solid rgba(255,255,255,0.25)",
                borderRadius: 12,
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 9px",
                whiteSpace: "nowrap",
              }}
            >
              {sections.length} {sections.length === 1 ? "section" : "sections"}
            </span>
          </div>
          <p style={{ margin: "2px 0 0", fontSize: 12, opacity: 0.7 }}>
            Drag squares to reposition. Tap a label to rename. Use + to add or × to remove sections.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            data-testid="aerial-adjuster-add-section"
            onClick={addSection}
            title="Add a new section"
            style={{ ...iconBtnStyle, background: "rgba(34,197,94,0.2)", borderColor: "rgba(34,197,94,0.5)", width: "auto", padding: "0 10px", gap: 5, display: "flex", alignItems: "center" }}
          >
            <Plus size={14} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>Add Section</span>
          </button>
          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.2)", margin: "0 2px" }} />
          <button
            data-testid="aerial-adjuster-zoom-out"
            onClick={zoomOut}
            title="Zoom out"
            style={iconBtnStyle}
          >
            <ZoomOut size={16} />
          </button>
          <span style={{ color: "#fff", fontSize: 13, lineHeight: "32px", minWidth: 40, textAlign: "center" }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            data-testid="aerial-adjuster-zoom-in"
            onClick={zoomIn}
            title="Zoom in"
            style={iconBtnStyle}
          >
            <ZoomIn size={16} />
          </button>
          <button
            data-testid="aerial-adjuster-zoom-reset"
            onClick={resetZoom}
            title="Reset zoom"
            style={iconBtnStyle}
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      {/* Scrollable image area */}
      <div
        style={{
          flex: 1,
          width: "100%",
          maxWidth: 900,
          overflow: "auto",
          borderRadius: 8,
          background: "#111",
          position: "relative",
          cursor: dragState ? "grabbing" : "default"
        }}
      >
        {/* Inner wrapper scaled by zoom */}
        <div style={{
          display: "inline-block",
          position: "relative",
          transformOrigin: "top left",
          transform: `scale(${zoom})`,
          lineHeight: 0,
          userSelect: "none"
        }}>
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Overhead aerial"
            onLoad={handleImgLoad}
            draggable={false}
            data-testid="aerial-adjuster-image"
            style={{
              display: "block",
              maxWidth: "100%",
              height: "auto",
              pointerEvents: "none"
            }}
          />

          {/* Square overlays */}
          {imgLoaded && sections.map((section, idx) => {
            const color = getColor(section.direction || "");
            const cx = (section.center_x / 1000) * 100; // %
            const cy = (section.center_y / 1000) * 100; // %
            const halfW = squarePctW / 2;
            const halfH = squarePctH / 2;
            const left = Math.max(0, Math.min(100 - squarePctW, cx - halfW));
            const top  = Math.max(0, Math.min(100 - squarePctH, cy - halfH));
            const isDragging = dragState?.index === idx;
            const dirCode = section.direction || "";
            const label = dirCode ? `${dirCode} – ${section.name || "10′×10′"}` : (section.name || "Section");

            const isEditing = editingIdx === idx;
            const rawName = section.name || (dirCode ? "10′×10′" : "Section");

            return (
              <div
                key={idx}
                style={{
                  position: "absolute",
                  left:   `${left}%`,
                  top:    `${top}%`,
                  width:  `${squarePctW}%`,
                  height: `${squarePctH}%`,
                  border: `2.5px dashed ${color}`,
                  background: hexToRgba(color, isDragging ? 0.22 : 0.12),
                  boxSizing: "border-box",
                  borderRadius: 2,
                  pointerEvents: "none"
                }}
              >
                {/* Label pill — tap to rename */}
                {isEditing ? (
                  <div
                    data-testid={`aerial-section-edit-panel-${idx}`}
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      background: "rgba(15,15,30,0.96)",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: 10,
                      padding: "10px 12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      pointerEvents: "all",
                      zIndex: 20,
                      width: 190,
                      boxShadow: "0 4px 20px rgba(0,0,0,0.7)",
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    {/* Name input row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 10, flexShrink: 0 }}>Name</span>
                      <input
                        data-testid={`aerial-section-name-input-${idx}`}
                        autoFocus
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onBlur={commitEditingName}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitEditingName(); } if (e.key === "Escape") { setEditingIdx(null); } }}
                        style={{
                          background: "rgba(255,255,255,0.08)",
                          border: `1px solid ${color}`,
                          borderRadius: 5,
                          color: "#fff",
                          fontSize: 11,
                          fontWeight: 600,
                          outline: "none",
                          width: "100%",
                          padding: "3px 6px",
                        }}
                      />
                    </div>

                    {/* Direction grid */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 10 }}>Direction</span>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
                        {DIRECTION_OPTIONS.map(opt => {
                          const optColor = getColor(opt.code);
                          const isSelected = editingDirection === opt.code;
                          return (
                            <button
                              key={opt.code || "blank"}
                              data-testid={`aerial-section-dir-${idx}-${opt.code || "none"}`}
                              onPointerDown={e => { e.preventDefault(); e.stopPropagation(); pickEditingDirection(idx, opt.code); }}
                              style={{
                                padding: "4px 2px",
                                borderRadius: 5,
                                border: isSelected
                                  ? `2px solid ${optColor}`
                                  : "2px solid rgba(255,255,255,0.1)",
                                background: isSelected ? hexToRgba(optColor, 0.25) : "rgba(255,255,255,0.05)",
                                color: isSelected ? optColor : "rgba(255,255,255,0.65)",
                                fontWeight: isSelected ? 700 : 500,
                                fontSize: 11,
                                cursor: "pointer",
                                transition: "all 0.12s",
                                lineHeight: 1,
                              }}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Done button */}
                    <button
                      data-testid={`aerial-section-edit-done-${idx}`}
                      onClick={commitEditingName}
                      style={{
                        background: color,
                        border: "none",
                        borderRadius: 6,
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "5px 0",
                        cursor: "pointer",
                        width: "100%",
                      }}
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <div
                    data-testid={`aerial-section-label-${idx}`}
                    onClick={(e) => startEditingName(e, idx, rawName, section.direction || "")}
                    title="Tap to rename or change direction"
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      background: color,
                      color: "#fff",
                      fontSize: "min(1.8vw, 11px)",
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: 12,
                      whiteSpace: "nowrap",
                      pointerEvents: "all",
                      textShadow: "0 1px 2px rgba(0,0,0,0.5)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 3
                    }}
                  >
                    {label}
                    <Pencil size={9} style={{ opacity: 0.8, flexShrink: 0 }} />
                  </div>
                )}

                {/* Delete button — top-left corner */}
                <div
                  data-testid={`aerial-square-delete-${idx}`}
                  onClick={(e) => removeSection(e, idx)}
                  title="Remove this section"
                  style={{
                    position: "absolute",
                    top: 3,
                    left: 3,
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "rgba(0,0,0,0.65)",
                    border: "1.5px solid rgba(255,255,255,0.5)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    pointerEvents: "all",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
                    zIndex: 10
                  }}
                >
                  <X size={11} color="#fff" />
                </div>

                {/* Drag handle — center circle */}
                <div
                  data-testid={`aerial-square-handle-${idx}`}
                  onPointerDown={(e) => onSquarePointerDown(e, idx)}
                  onPointerMove={(e) => onSquarePointerMove(e, idx)}
                  onPointerUp={onSquarePointerUp}
                  onPointerCancel={onSquarePointerUp}
                  style={{
                    position: "absolute",
                    bottom: 4,
                    right: 4,
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: color,
                    border: "2px solid #fff",
                    cursor: "move",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    pointerEvents: "all",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
                    zIndex: 10
                  }}
                  title="Drag to reposition"
                >
                  <Move size={14} color="#fff" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Scale note */}
      {scaleNote && (
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, margin: "6px 0 4px", textAlign: "center" }}>
          Scale: {scaleNote}
        </p>
      )}

      {/* Action bar */}
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <Button
          variant="outline"
          data-testid="aerial-adjuster-cancel"
          onClick={onCancel}
          style={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)", background: "transparent" }}
        >
          <X size={15} style={{ marginRight: 4 }} />
          Cancel
        </Button>
        <Button
          data-testid="aerial-adjuster-confirm"
          onClick={handleConfirm}
          style={{ background: "#22c55e", color: "#fff", border: "none" }}
        >
          <CheckCircle2 size={15} style={{ marginRight: 4 }} />
          Confirm Placement
        </Button>
      </div>

      {/* ── New-Section Direction Picker ── */}
      {newSectionDraft !== null && (
        <div
          data-testid="new-section-direction-picker"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10001,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.55)",
          }}
          onClick={cancelNewSection}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#1a1a2e",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 14,
              padding: "20px 24px",
              width: 320,
              maxWidth: "90vw",
              boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
              color: "#fff",
            }}
          >
            <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>New Section</h3>
            <p style={{ margin: "0 0 16px", fontSize: 12, opacity: 0.6 }}>
              Pick a slope direction so the section is color-coded correctly.
            </p>

            {/* Direction grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
              {DIRECTION_OPTIONS.map(opt => {
                const optColor = getColor(opt.code);
                const isSelected = newSectionDraft.direction === opt.code;
                return (
                  <button
                    key={opt.code || "blank"}
                    data-testid={`direction-option-${opt.code || "none"}`}
                    onClick={() => setNewSectionDraft(d => ({ ...d, direction: opt.code }))}
                    style={{
                      padding: "8px 4px",
                      borderRadius: 8,
                      border: isSelected
                        ? `2px solid ${optColor}`
                        : "2px solid rgba(255,255,255,0.12)",
                      background: isSelected ? hexToRgba(optColor, 0.22) : "rgba(255,255,255,0.05)",
                      color: isSelected ? optColor : "rgba(255,255,255,0.7)",
                      fontWeight: isSelected ? 700 : 500,
                      fontSize: 14,
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Preview badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <div style={{
                width: 16, height: 16, borderRadius: 3,
                background: draftColor,
                flexShrink: 0,
              }} />
              <span style={{ fontSize: 12, opacity: 0.75 }}>
                {newSectionDraft.direction
                  ? `Direction: ${newSectionDraft.direction}`
                  : "No direction — section will show in purple"}
              </span>
            </div>

            {/* Name field */}
            <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 4 }}>
              Section name
            </label>
            <input
              data-testid="new-section-name-input"
              value={newSectionDraft.name}
              onChange={e => setNewSectionDraft(d => ({ ...d, name: e.target.value }))}
              onKeyDown={e => { if (e.key === "Enter") confirmNewSection(); if (e.key === "Escape") cancelNewSection(); }}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: 7,
                color: "#fff",
                fontSize: 13,
                padding: "7px 10px",
                outline: "none",
                marginBottom: 16,
              }}
            />

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                data-testid="new-section-cancel"
                onClick={cancelNewSection}
                style={{
                  padding: "7px 14px",
                  borderRadius: 7,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "transparent",
                  color: "rgba(255,255,255,0.7)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                data-testid="new-section-confirm"
                onClick={confirmNewSection}
                style={{
                  padding: "7px 16px",
                  borderRadius: 7,
                  border: "none",
                  background: draftColor,
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Add Section
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
