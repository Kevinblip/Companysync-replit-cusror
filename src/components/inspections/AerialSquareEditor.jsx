import { useState, useRef, useCallback, useEffect } from 'react';
import { drawTestSquares } from './ImageAnnotation';
import { base44 } from '@/api/base44Client';

const COLORS = {
    N: '#ef4444', NORTH: '#ef4444', FRONT: '#ef4444',
    NE: '#ef4444',
    NW: '#f59e0b',
    S: '#3b82f6', SOUTH: '#3b82f6', BACK: '#3b82f6',
    SE: '#22c55e',
    SW: '#f59e0b',
    E: '#22c55e', EAST: '#22c55e', RIGHT: '#22c55e',
    W: '#f59e0b', WEST: '#f59e0b', LEFT: '#f59e0b',
};

function colorFor(dir = '') {
    return COLORS[dir.toUpperCase().trim()] || '#8b5cf6';
}

export default function AerialSquareEditor({ photo, onClose, onSaved }) {
    const rawSections = photo?.ai_damage_analysis?.detected_sections || [];
    const ppf         = photo?.ai_damage_analysis?.pixels_per_foot || 20;
    const scaleNote   = photo?.ai_damage_analysis?.scale_note || 'AI estimated';

    const [sections, setSections]   = useState(() => rawSections.map(s => ({ ...s })));
    const [isSaving, setIsSaving]   = useState(false);
    const [imgSize, setImgSize]     = useState(null);

    const containerRef  = useRef(null);
    const dragRef       = useRef(null); // { idx, startNormX, startNormY, origCX, origCY }

    // ─── coordinate helpers ───────────────────────────────────────────────────

    // Returns the bounds of the rendered image within the container
    // (accounts for object-fit: contain letterboxing)
    const getBounds = useCallback(() => {
        const el = containerRef.current;
        if (!el || !imgSize) return null;
        const cw = el.clientWidth;
        const ch = el.clientHeight;
        const scale = Math.min(cw / imgSize.w, ch / imgSize.h);
        const rw = imgSize.w * scale;
        const rh = imgSize.h * scale;
        return {
            left:   (cw - rw) / 2,
            top:    (ch - rh) / 2,
            width:  rw,
            height: rh,
            sx:     rw / 1000,  // container-px per 0-1000 unit (x)
            sy:     rh / 1000,  // container-px per 0-1000 unit (y)
        };
    }, [imgSize]);

    // Convert client coords → 0-1000 image-space coords
    const clientToNorm = useCallback((cx, cy) => {
        const b = getBounds();
        const el = containerRef.current;
        if (!b || !el) return null;
        const r = el.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(1000, (cx - r.left - b.left) / b.sx)),
            y: Math.max(0, Math.min(1000, (cy - r.top  - b.top)  / b.sy)),
        };
    }, [getBounds]);

    // ─── square size ─────────────────────────────────────────────────────────
    // ppf is pixels-per-foot in 0-1000 scale; 10 ft × ppf = square size in norm units
    // Cap at 120 norm-units (~12% of image) so it stays usable even with large ppf
    const halfNorm = Math.min((ppf * 10) / 2, 60);

    // ─── drag handlers (all on container, not SVG elements) ──────────────────

    const onPointerDown = useCallback((e) => {
        const norm = clientToNorm(e.clientX, e.clientY);
        if (!norm) return;

        // Find which square was hit (check closest center first)
        let hitIdx = -1;
        let minDist = Infinity;
        sections.forEach((s, i) => {
            const dx = Math.abs(norm.x - s.center_x);
            const dy = Math.abs(norm.y - s.center_y);
            // Must be within the square's bounding box (halfNorm on each side)
            if (dx <= halfNorm && dy <= halfNorm) {
                const dist = dx * dx + dy * dy;
                if (dist < minDist) { minDist = dist; hitIdx = i; }
            }
        });

        if (hitIdx === -1) return;

        e.preventDefault();
        containerRef.current?.setPointerCapture(e.pointerId);

        dragRef.current = {
            idx:     hitIdx,
            startX:  norm.x,
            startY:  norm.y,
            origCX:  sections[hitIdx].center_x,
            origCY:  sections[hitIdx].center_y,
        };
    }, [sections, halfNorm, clientToNorm]);

    const onPointerMove = useCallback((e) => {
        const d = dragRef.current;
        if (!d) return;
        const norm = clientToNorm(e.clientX, e.clientY);
        if (!norm) return;

        const newCX = Math.round(Math.max(halfNorm, Math.min(1000 - halfNorm, d.origCX + (norm.x - d.startX))));
        const newCY = Math.round(Math.max(halfNorm, Math.min(1000 - halfNorm, d.origCY + (norm.y - d.startY))));

        setSections(prev => prev.map((s, i) =>
            i === d.idx ? { ...s, center_x: newCX, center_y: newCY } : s
        ));
    }, [halfNorm, clientToNorm]);

    const onPointerUp = useCallback(() => {
        dragRef.current = null;
    }, []);

    // ─── save ─────────────────────────────────────────────────────────────────

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const blob = await drawTestSquares(photo.file_url, sections, ppf, scaleNote);
            const file = new File([blob], `aerial_adjusted_${Date.now()}.jpg`, { type: 'image/jpeg' });
            const upload = await base44.integrations.Core.UploadFile({ file });
            await base44.entities.JobMedia.update(photo.id, {
                annotated_url: upload.file_url,
                ai_damage_analysis: {
                    ...photo.ai_damage_analysis,
                    detected_sections: sections,
                    pixels_per_foot: ppf,
                    scale_note: scaleNote,
                },
            });
            onSaved?.();
        } catch (err) {
            console.error('AerialSquareEditor save failed:', err);
            alert('Failed to save. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    // ─── render ───────────────────────────────────────────────────────────────

    const bounds = getBounds();

    return (
        <div className="fixed inset-0 z-[9999] flex flex-col bg-black select-none">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-700 flex-shrink-0">
                <div>
                    <p className="text-white font-semibold text-sm">Adjust Test Squares</p>
                    <p className="text-gray-400 text-xs mt-0.5">Tap a square and drag it to the correct roof section</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={onClose}
                        className="text-gray-300 hover:text-white text-sm px-3 py-1.5 rounded border border-gray-600 hover:border-gray-400"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        data-testid="button-save-square-positions"
                        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded font-semibold"
                    >
                        {isSaving ? 'Saving…' : 'Save Positions'}
                    </button>
                </div>
            </div>

            {/* Image + overlay */}
            <div
                ref={containerRef}
                className="flex-1 relative overflow-hidden"
                style={{ touchAction: 'none', cursor: dragRef.current ? 'grabbing' : 'crosshair' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
            >
                {/* Original image (un-annotated) */}
                <img
                    src={photo.file_url}
                    alt="Aerial roof view"
                    className="w-full h-full object-contain pointer-events-none"
                    draggable={false}
                    onLoad={e => setImgSize({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
                />

                {/* SVG overlay — purely visual, pointer-events: none */}
                {bounds && (
                    <svg
                        className="absolute inset-0 w-full h-full"
                        style={{ pointerEvents: 'none', overflow: 'visible' }}
                    >
                        {sections.map((section, idx) => {
                            const color  = colorFor(section.direction || '');
                            const isDrag = dragRef.current?.idx === idx;
                            const px = bounds.left + (section.center_x - halfNorm) * bounds.sx;
                            const py = bounds.top  + (section.center_y - halfNorm) * bounds.sy;
                            const sqW = halfNorm * 2 * bounds.sx;
                            const sqH = halfNorm * 2 * bounds.sy;
                            const label = section.direction
                                ? `${section.direction} – ${section.name || "10'×10'"}`
                                : (section.name || 'Section');

                            return (
                                <g key={idx} opacity={isDrag ? 0.9 : 1}>
                                    {/* Semi-transparent fill */}
                                    <rect
                                        x={px} y={py} width={sqW} height={sqH}
                                        fill={color + '28'}
                                        stroke={color}
                                        strokeWidth={isDrag ? 3 : 2}
                                        strokeDasharray="8 4"
                                    />

                                    {/* Corner brackets */}
                                    {[
                                        `M${px},${py + sqH * 0.2} L${px},${py} L${px + sqW * 0.2},${py}`,
                                        `M${px + sqW * 0.8},${py} L${px + sqW},${py} L${px + sqW},${py + sqH * 0.2}`,
                                        `M${px + sqW},${py + sqH * 0.8} L${px + sqW},${py + sqH} L${px + sqW * 0.8},${py + sqH}`,
                                        `M${px + sqW * 0.2},${py + sqH} L${px},${py + sqH} L${px},${py + sqH * 0.8}`,
                                    ].map((d, i) => (
                                        <path key={i} d={d} stroke={color} strokeWidth={3.5} fill="none" strokeLinecap="square" />
                                    ))}

                                    {/* Label above box */}
                                    <rect
                                        x={px} y={py - 22}
                                        width={Math.max(80, label.length * 7 + 16)} height={20}
                                        fill={color} rx={3}
                                    />
                                    <text
                                        x={px + 8} y={py - 7}
                                        fill="white" fontSize={11} fontWeight="bold"
                                        fontFamily="Arial, sans-serif"
                                    >
                                        {label}
                                    </text>

                                    {/* Drag handle icon */}
                                    <text
                                        x={px + sqW / 2} y={py + sqH / 2 + 7}
                                        fill={color} fontSize={18}
                                        fontFamily="Arial, sans-serif"
                                        textAnchor="middle" opacity={0.7}
                                    >
                                        ✥
                                    </text>
                                </g>
                            );
                        })}
                    </svg>
                )}
            </div>

            {/* Footer */}
            <div className="bg-gray-900 border-t border-gray-700 text-gray-400 text-xs px-4 py-2 text-center flex-shrink-0">
                {sections.length} test square{sections.length !== 1 ? 's' : ''} · Tap &amp; drag each square to reposition · Save when done
            </div>
        </div>
    );
}
