/**
 * Draws professional, adjuster-ready annotations on an inspection photo.
 *
 * Marker styles:
 *   Hail  → Red filled circle with white number (H1, H2…)
 *   Wind  → Amber corner-bracket outline with amber label tag (W1, W2…)
 *   Other → Blue corner-bracket outline with blue label tag  (M1, M2…)
 *
 * A summary legend bar is appended at the bottom of the image.
 *
 * @param {string} imageUrl  - Source image URL
 * @param {Array}  detections - [{type, box_2d:[ymin,xmin,ymax,xmax]}] on 0–1000 scale
 * @returns {Promise<Blob>}  Annotated image
 */
export const annotateImage = async (imageUrl, detections, possibleDetections = []) => {
  const response = await fetch(imageUrl);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const LEGEND_PX = Math.round(Math.max(img.height, img.width) * 0.045);
      const canvas = document.createElement('canvas');
      canvas.width  = img.width;
      canvas.height = img.height + LEGEND_PX;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const scale = Math.max(img.width, img.height) / 1000;

      // Filter obviously wrong boxes
      const combined = [
        ...(detections || []),
        ...(possibleDetections || []).map(d => ({ ...d, review_only: true })),
      ];
      const valid = combined.filter(d => {
        if (!d.box_2d || d.box_2d.length !== 4) return false;
        const [ymin, xmin, ymax, xmax] = d.box_2d;
        if (ymax <= ymin || xmax <= xmin) return false;
        const area = ((ymax - ymin) / 1000) * ((xmax - xmin) / 1000);
        return area <= 0.35; // drop boxes covering more than 35 % of image
      });

      // Cap how many markers we draw — past a point, circling every single
      // mark adds clutter without adding credibility. The legend switches to
      // "20+" / "10+" wording when the cap is hit.
      const MAX_HAIL_MARKERS = 20;
      const MAX_WIND_MARKERS = 10;
      const MAX_OTHER_MARKERS = 10;
      const totalHail  = valid.filter(d => !d.review_only && d.type === 'hail').length;
      const totalWind  = valid.filter(d => !d.review_only && d.type === 'wind').length;
      const totalOther = valid.filter(d => !d.review_only && d.type !== 'hail' && d.type !== 'wind').length;
      const totalPossible = valid.filter(d => d.review_only).length;

      let hailIdx = 0, windIdx = 0, otherIdx = 0, possibleIdx = 0;

      valid.forEach(det => {
        if (det.review_only && possibleIdx >= 30) return;
        if (det.review_only) {
          possibleIdx++;
          const [ymin, xmin, ymax, xmax] = det.box_2d;
          const x = (xmin / 1000) * img.width;
          const y = (ymin / 1000) * img.height;
          const w = ((xmax - xmin) / 1000) * img.width;
          const h = ((ymax - ymin) / 1000) * img.height;
          drawBracketMarker(ctx, x, y, w, h, `P${possibleIdx}`, '#f59e0b', '#fffbeb', scale);
          return;
        }
        if (det.type === 'hail' && hailIdx >= MAX_HAIL_MARKERS) return;
        if (det.type === 'wind' && windIdx >= MAX_WIND_MARKERS) return;
        if (det.type !== 'hail' && det.type !== 'wind' && otherIdx >= MAX_OTHER_MARKERS) return;
        const [ymin, xmin, ymax, xmax] = det.box_2d;
        const x  = (xmin / 1000) * img.width;
        const y  = (ymin / 1000) * img.height;
        const w  = ((xmax - xmin) / 1000) * img.width;
        const h  = ((ymax - ymin) / 1000) * img.height;
        const cx = x + w / 2;
        const cy = y + h / 2;

        if (det.type === 'hail') {
          hailIdx++;
          drawHailMarker(ctx, cx, cy, w, h, hailIdx, scale);
        } else if (det.type === 'wind') {
          windIdx++;
          drawBracketMarker(ctx, x, y, w, h, `W${windIdx}`, '#d97706', '#fffbeb', scale);
        } else {
          otherIdx++;
          drawBracketMarker(ctx, x, y, w, h, `M${otherIdx}`, '#2563eb', '#eff6ff', scale);
        }
      });

      drawLegend(ctx, img.width, img.height, LEGEND_PX, hailIdx, windIdx, otherIdx, scale, {
        hailCapped: totalHail > MAX_HAIL_MARKERS,
        windCapped: totalWind > MAX_WIND_MARKERS,
        otherCapped: totalOther > MAX_OTHER_MARKERS,
        possibleCount: Math.min(totalPossible, 30),
      });

      canvas.toBlob(b => {
        if (b) resolve(b);
        else    reject(new Error('Canvas→Blob failed'));
      }, 'image/jpeg', 0.93);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image for annotation'));
    };
    img.src = objectUrl;
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Hail marker: semi-transparent red circle so the damage mark stays visible,
// with a solid red stroke ring and a white number that's easy to read.
// ─────────────────────────────────────────────────────────────────────────────
function drawHailMarker(ctx, cx, cy, boxW, boxH, num, scale) {
  const minR  = 16 * scale;
  const maxR  = 32 * scale;
  const r     = Math.min(maxR, Math.max(minR, Math.min(boxW, boxH) * 0.35));
  const lw    = Math.max(2.5, 3.5 * scale);
  const fs    = Math.max(13, Math.round(14 * scale));

  ctx.save();

  // Semi-transparent red fill — lets the damage mark show through
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(220,38,38,0.30)';
  ctx.fill();

  // Solid white outline ring (for contrast on dark AND light shingles)
  ctx.beginPath();
  ctx.arc(cx, cy, r + lw * 0.6, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth   = lw * 1.4;
  ctx.stroke();

  // Solid red stroke border inside the white ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth   = lw;
  ctx.stroke();

  // Number — white with a dark shadow so it's readable on any background
  ctx.font         = `bold ${fs}px Arial, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor  = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur   = Math.max(3, 4 * scale);
  ctx.fillStyle    = '#ffffff';
  ctx.fillText(String(num), cx, cy + 1);
  ctx.shadowBlur   = 0;
  ctx.shadowColor  = 'transparent';

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Bracket marker (wind & other): corner brackets + label pill in top-left
// ─────────────────────────────────────────────────────────────────────────────
function drawBracketMarker(ctx, bx, by, bw, bh, label, strokeColor, pillBg, scale) {
  const lw       = Math.max(2, 2.5 * scale);
  const arm      = Math.min(24 * scale, Math.min(bw, bh) * 0.28);
  const fs       = Math.max(12, Math.round(13 * scale));
  const pillH    = fs * 1.75;
  const pillPad  = 6 * scale;

  ctx.save();

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth   = lw;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.globalAlpha = 0.92;

  // Four corner brackets
  [
    [[bx, by + arm], [bx, by], [bx + arm, by]],
    [[bx + bw - arm, by], [bx + bw, by], [bx + bw, by + arm]],
    [[bx + bw, by + bh - arm], [bx + bw, by + bh], [bx + bw - arm, by + bh]],
    [[bx + arm, by + bh], [bx, by + bh], [bx, by + bh - arm]],
  ].forEach(pts => {
    ctx.beginPath();
    ctx.moveTo(...pts[0]);
    ctx.lineTo(...pts[1]);
    ctx.lineTo(...pts[2]);
    ctx.stroke();
  });

  // Label pill at top-left corner
  ctx.font = `bold ${fs}px Arial, sans-serif`;
  const tw     = ctx.measureText(label).width;
  const pillW  = tw + pillPad * 2;
  const pillX  = bx;
  const pillY  = by - pillH;

  ctx.globalAlpha = 0.93;
  ctx.fillStyle   = pillBg;
  roundRect(ctx, pillX, pillY, pillW, pillH, 3 * scale);
  ctx.fill();

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth   = lw;
  roundRect(ctx, pillX, pillY, pillW, pillH, 3 * scale);
  ctx.stroke();

  ctx.fillStyle    = strokeColor;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, pillX + pillPad, pillY + pillH / 2);

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Legend bar at the bottom
// ─────────────────────────────────────────────────────────────────────────────
function drawLegend(ctx, imgW, imgH, legendH, hailN, windN, otherN, scale, capped = {}) {
  // Background
  ctx.fillStyle = '#1e293b'; // slate-800
  ctx.fillRect(0, imgH, imgW, legendH);

  const fs      = Math.max(12, Math.round(legendH * 0.38));
  const padding = Math.round(legendH * 0.2);
  const cy      = imgH + legendH / 2;

  const parts = [];
  if (hailN  > 0) parts.push({ text: `● H = Hail (${hailN}${capped.hailCapped ? '+' : ''}${capped.hailCapped ? ' hits' : ''})`, color: '#f87171' });
  if (windN  > 0) parts.push({ text: `● W = Wind Damage (${windN}${capped.windCapped ? '+' : ''})`, color: '#fcd34d' });
  if (otherN > 0) parts.push({ text: `● M = Missing / Other (${otherN}${capped.otherCapped ? '+' : ''})`, color: '#93c5fd' });
  if (capped.possibleCount > 0) parts.push({ text: `△ P = Possible (${capped.possibleCount}${capped.possibleCount >= 30 ? '+' : ''}; not counted)`, color: '#fbbf24' });
  if (parts.length === 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = `${fs}px Arial, sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('AI Annotated', imgW / 2, cy);
    return;
  }

  ctx.font = `bold ${fs}px Arial, sans-serif`;
  const sep   = padding * 3;
  const total = parts.reduce((acc, p) => acc + ctx.measureText(p.text).width, 0)
                  + sep * (parts.length - 1);
  let tx = (imgW - total) / 2;

  parts.forEach((p, i) => {
    ctx.fillStyle    = p.color;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.text, tx, cy);
    tx += ctx.measureText(p.text).width + sep;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST SQUARES — AI-detected roof sections overlaid on overhead drone photos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draws labeled 10'×10' test squares on each roof section identified from an
 * overhead drone photo. Also adds a compass rose and a footer bar.
 *
 * @param {string} imageUrl      - Source image URL (post-compression, max ~1400px)
 * @param {Array}  sections      - [{ name, direction, center_x, center_y }] — coordinates on 0–1000 scale
 * @param {number} pixelsPerFoot - Scale: actual image pixels per real foot
 * @param {string} [scaleNote]   - Human-readable note about scale source (shown in footer)
 * @returns {Promise<Blob>}  Annotated image blob
 */
// pixelsPerFootNorm — pixels-per-foot expressed in 1000-unit normalized coords
// (i.e. the value the AI returns where 1000 == full image width).
// The function converts to actual canvas pixels using the loaded img.width.
export const drawTestSquares = async (imageUrl, sections, pixelsPerFootNorm, scaleNote) => {
  const response = await fetch(imageUrl);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const FOOTER_PX = Math.round(Math.max(img.height, img.width) * 0.055);
      const canvas = document.createElement('canvas');
      canvas.width  = img.width;
      canvas.height = img.height + FOOTER_PX;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // Convert normalized px/ft (AI 0-1000 scale) → actual image px/ft
      const normPpf = (pixelsPerFootNorm && pixelsPerFootNorm > 0) ? pixelsPerFootNorm : 20;
      const safePixelsPerFoot = normPpf * (img.width / 1000);
      const squarePx = 10 * safePixelsPerFoot;

      (sections || []).forEach(section => {
        const color = getDirectionColor(section.direction || '');
        const cx = (section.center_x / 1000) * img.width;
        const cy = (section.center_y / 1000) * img.height;
        const half = squarePx / 2;

        const x1 = Math.max(2, cx - half);
        const y1 = Math.max(2, cy - half);
        const bw = Math.min(img.width  - x1 - 2, squarePx);
        const bh = Math.min(img.height - y1 - 2, squarePx);

        // Label: prefer direction code first so output matches "N – 10'×10'" style
        const dirCode = section.direction || '';
        const label = dirCode ? `${dirCode} – ${section.name || '10\'×10\''}` : (section.name || 'Section');
        drawTestSquareBox(ctx, x1, y1, bw, bh, label, color);
      });

      // Compass rose — top-right, clear of any square labels
      const roseR = Math.round(Math.min(img.width, img.height) * 0.045);
      const roseCX = img.width  - roseR - Math.round(roseR * 0.6);
      const roseCY = roseR + Math.round(roseR * 0.6);
      drawCompassRose(ctx, roseCX, roseCY, roseR);

      // Footer
      drawTestSquareFooter(ctx, img.width, img.height, FOOTER_PX, sections?.length || 0, scaleNote || 'AI estimated');

      canvas.toBlob(b => {
        if (b) resolve(b);
        else    reject(new Error('Canvas→Blob failed'));
      }, 'image/jpeg', 0.93);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image for test square annotation'));
    };
    img.src = objectUrl;
  });
};

// Map direction string → stroke/fill colours
function getDirectionColor(direction) {
  const d = direction.toUpperCase();
  if ((d === 'N' || d === 'NORTH' || d === 'FRONT') || (d.startsWith('N') && !d.includes('S')))
    return { stroke: '#ef4444', fill: 'rgba(239,68,68,0.12)' };      // Red   — North / Front
  if ((d === 'S' || d === 'SOUTH' || d === 'BACK')  || (d.startsWith('S') && !d.includes('N')))
    return { stroke: '#3b82f6', fill: 'rgba(59,130,246,0.12)' };     // Blue  — South / Back
  if ((d === 'E' || d === 'EAST'  || d === 'RIGHT') || (d === 'NE' || d === 'SE'))
    return { stroke: '#22c55e', fill: 'rgba(34,197,94,0.12)' };      // Green — East / Right
  if ((d === 'W' || d === 'WEST'  || d === 'LEFT')  || (d === 'NW' || d === 'SW'))
    return { stroke: '#f59e0b', fill: 'rgba(245,158,11,0.12)' };     // Amber — West / Left
  return { stroke: '#8b5cf6', fill: 'rgba(139,92,246,0.12)' };       // Purple — unknown
}

// Draw one 10'×10' dashed rectangle with corner brackets and a pill label
function drawTestSquareBox(ctx, x, y, w, h, label, color) {
  const lw     = Math.max(2.5, Math.min(w, h) * 0.012);
  const arm    = Math.min(w, h) * 0.15;
  const fs     = Math.max(13, Math.round(Math.min(w, h) * 0.085));
  const dashOn = lw * 5;
  const dashOff= lw * 3;

  ctx.save();

  // Semi-transparent fill
  ctx.fillStyle = color.fill;
  ctx.fillRect(x, y, w, h);

  // Dashed border
  ctx.strokeStyle = color.stroke;
  ctx.lineWidth   = lw;
  ctx.setLineDash([dashOn, dashOff]);
  ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw);
  ctx.setLineDash([]);

  // Solid corner brackets (make edges crisp even in compressed JPEG)
  ctx.strokeStyle = color.stroke;
  ctx.lineWidth   = lw * 1.8;
  ctx.lineCap     = 'square';
  const brackets = [
    [[x, y + arm], [x, y], [x + arm, y]],
    [[x + w - arm, y], [x + w, y], [x + w, y + arm]],
    [[x + w, y + h - arm], [x + w, y + h], [x + w - arm, y + h]],
    [[x + arm, y + h], [x, y + h], [x, y + h - arm]],
  ];
  brackets.forEach(pts => {
    ctx.beginPath();
    ctx.moveTo(...pts[0]);
    ctx.lineTo(...pts[1]);
    ctx.lineTo(...pts[2]);
    ctx.stroke();
  });

  // Label pill — prefer above the box, fall back to inside top if too close to image edge
  ctx.font = `bold ${fs}px Arial, sans-serif`;
  const labelText  = `${label}  10'×10'`;
  const tw         = ctx.measureText(labelText).width;
  const pillH      = fs * 1.9;
  const pillW      = tw + fs * 1.4;
  const pillCX     = x + w / 2;
  const pillAboveY = y - pillH - lw * 2;
  const pillY      = pillAboveY >= 4 ? pillAboveY : y + lw * 2 + 2;
  const pillX      = Math.max(2, Math.min(ctx.canvas.width - pillW - 2, pillCX - pillW / 2));

  ctx.globalAlpha = 0.93;
  ctx.fillStyle   = color.stroke;
  roundRect(ctx, pillX, pillY, pillW, pillH, 5);
  ctx.fill();

  ctx.fillStyle    = '#ffffff';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText, pillX + (pillW - tw) / 2, pillY + pillH / 2);

  ctx.globalAlpha = 1;
  ctx.restore();
}

// Simple compass rose with N/S/E/W directional arrows
function drawCompassRose(ctx, cx, cy, radius) {
  ctx.save();
  ctx.globalAlpha = 0.92;

  // Dark circle background
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
  ctx.fill();

  const DIRS = [
    { label: 'N', angle: -Math.PI / 2, color: '#ef4444' },
    { label: 'S', angle:  Math.PI / 2, color: '#3b82f6' },
    { label: 'E', angle:  0,           color: '#22c55e' },
    { label: 'W', angle:  Math.PI,     color: '#f59e0b' },
  ];

  const innerR  = radius * 0.22;
  const outerR  = radius * 0.72;
  const labelR  = radius * 1.18;
  const headLen = radius * 0.28;
  const fs      = Math.max(9, Math.round(radius * 0.34));

  DIRS.forEach(({ label, angle, color }) => {
    const tipX  = cx + Math.cos(angle) * outerR;
    const tipY  = cy + Math.sin(angle) * outerR;
    const baseX = cx + Math.cos(angle) * innerR;
    const baseY = cy + Math.sin(angle) * innerR;

    // Shaft
    ctx.strokeStyle = color;
    ctx.lineWidth   = Math.max(1.5, radius * 0.06);
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // Arrowhead (triangle)
    const la = angle - 2.5;
    const ra = angle + 2.5;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + Math.cos(la) * headLen, tipY + Math.sin(la) * headLen);
    ctx.lineTo(tipX + Math.cos(ra) * headLen, tipY + Math.sin(ra) * headLen);
    ctx.closePath();
    ctx.fill();

    // Letter label
    ctx.font         = `bold ${fs}px Arial, sans-serif`;
    ctx.fillStyle    = color;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx + Math.cos(angle) * labelR, cy + Math.sin(angle) * labelR);
  });

  ctx.globalAlpha = 1;
  ctx.restore();
}

// Footer bar for test-square images
function drawTestSquareFooter(ctx, imgW, imgH, legendH, sectionCount, scaleNote) {
  ctx.fillStyle = '#0f172a'; // slate-900
  ctx.fillRect(0, imgH, imgW, legendH);

  const fs      = Math.max(11, Math.round(legendH * 0.36));
  const cy      = imgH + legendH / 2;
  const text    = `📐 ${sectionCount} section${sectionCount !== 1 ? 's' : ''} detected  ·  10'×10' test squares  ·  Scale: ${scaleNote}`;

  ctx.font         = `bold ${fs}px Arial, sans-serif`;
  ctx.fillStyle    = '#94a3b8';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, imgW / 2, cy);
}

// ─────────────────────────────────────────────────────────────────────────────
// Polyfill for roundRect (pre-Chrome99 / pre-Firefox112)
// ─────────────────────────────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
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
