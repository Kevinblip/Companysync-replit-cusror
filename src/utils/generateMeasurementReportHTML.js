function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escA(str) { return esc(str); }

// Default brands used for the steep-slope materials page
export const DEFAULT_BRANDS = [
  { short: 'GAF',         product: 'Timberline HDZ',   bPerSq: 3,    undRollSq: 10 },
  { short: 'OC',          product: 'TruDef Duration',  bPerSq: 3,    undRollSq: 10 },
  { short: 'CertainTeed', product: 'Landmark',         bPerSq: 3,    undRollSq: 10 },
  { short: 'Malarkey',    product: 'Vista AR',         bPerSq: 3.33, undRollSq: 10 },
];

// Waste columns shown on Page 5 materials table (brand sub-columns)
const MAT_WASTE = [0, 7, 12, 17];

// Flat roof systems for Page 6
const FLAT_SYSTEMS = [
  { name: 'TPO Adhesive',        adhesive: true,  mfPlates: false },
  { name: 'TPO Mech. Fastened',  adhesive: false, mfPlates: true  },
  { name: 'EPDM',                adhesive: true,  mfPlates: false },
  { name: 'PVC',                 adhesive: true,  mfPlates: false },
  { name: 'Mod Bit',             adhesive: false, mfPlates: false },
];

function sqAt(sq, w) { return sq * (1 + w / 100); }
function sfAt(sf, w) { return sf * (1 + w / 100); }

function td(val, hi, extra) {
  const bg = hi ? 'background:#dbeafe;font-weight:700;' : '';
  return `<td style="padding:5px 7px;border:1px solid #e5e7eb;text-align:center;font-size:11px;${bg}${extra || ''}">${val}</td>`;
}
function th(label, extra) {
  return `<th style="background:#1e3a8a;color:#fff;padding:7px 9px;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;text-align:center;${extra || ''}">${esc(label)}</th>`;
}
function thL(label, extra) {
  return `<th style="background:#1e3a8a;color:#fff;padding:7px 9px;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;text-align:left;${extra || ''}">${esc(label)}</th>`;
}
function tdL(label, bold) {
  return `<td style="padding:5px 9px;border:1px solid #e5e7eb;font-size:11px;background:#f8fafc;${bold ? 'font-weight:700;' : ''}">${esc(label)}</td>`;
}
function tdU(label) {
  return `<td style="padding:5px 7px;border:1px solid #e5e7eb;font-size:10px;color:#6b7280;text-align:center">${esc(label)}</td>`;
}

export function generateMeasurementReportHTML({
  satelliteAnalysis,
  satelliteAddress,
  companyName,
  companyLogoUrl,
  gmapsKey,
  baseUrl = '',
  lineItems = [],
  preferredBrands = [],
  stormHistory = null,
  presentationRenderUrl = '',
}) {
  // Normalise caller-supplied brands so NaN/missing fields never crash arithmetic.
  // • entries with no `short` are dropped entirely
  // • missing/non-numeric `bPerSq` / `undRollSq` fall back to the matching DEFAULT_BRANDS
  //   entry (matched on `short`), then to the hardcoded safe defaults (3 / 10)
  const _normaliseBrands = (raw) => {
    if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_BRANDS;
    const normalised = raw
      .filter(b => b && typeof b.short === 'string' && b.short.trim() !== '')
      .map(b => {
        const def = DEFAULT_BRANDS.find(d => d.short === b.short) || {};
        const bPerSq     = Number(b.bPerSq);
        const undRollSq  = Number(b.undRollSq);
        return {
          ...b,
          short:      b.short.trim(),
          product:    b.product || def.product || b.short,
          bPerSq:     Number.isFinite(bPerSq)    ? bPerSq    : (def.bPerSq    ?? 3),
          undRollSq:  Number.isFinite(undRollSq) ? undRollSq : (def.undRollSq ?? 10),
        };
      });
    return normalised.length > 0 ? normalised : DEFAULT_BRANDS;
  };
  const BRANDS = _normaliseBrands(preferredBrands);
  const sa      = satelliteAnalysis || {};
  const addr    = satelliteAddress?.address || sa.address || '';
  const lat     = satelliteAddress?.coordinates?.lat;
  const lng     = satelliteAddress?.coordinates?.lng;
  const co      = companyName || 'CompanySync';
  const now     = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const key     = gmapsKey || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('_gmaps_key') : '');

  const roofSq   = Number(sa.roof_area_sq) || 0;
  const roofSqFt = Number(sa.roof_area_sqft) || Math.round(roofSq * 100);
  const wastePct = Number(sa.waste_percentage) || 12;
  const orderSq  = Number(sa.final_order_quantity_sq) > 0
    ? Number(sa.final_order_quantity_sq)
    : Math.round(roofSq * (1 + wastePct / 100) * 100) / 100;
  const pitchStr  = sa.pitch || '—';
  const roofType  = (sa.roof_type || '—').replace(/_/g, ' ');
  const numSegs   = Number(sa.num_segments) || 0;
  const conf      = Number(sa.overall_confidence) || 0;
  const confGrade = conf >= 88 ? 'A' : conf >= 78 ? 'B' : conf >= 65 ? 'C' : conf >= 50 ? 'D' : 'F';
  const gradeColor = { A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#ea580c', F: '#dc2626' }[confGrade] || '#6b7280';

  const ridgeLf  = Number(sa.ridge_lf) || 0;
  const hipLf    = Number(sa.hip_lf) || 0;
  const valleyLf = Number(sa.valley_lf) || 0;
  const rakeLf   = Number(sa.rake_lf) || 0;
  const eaveLf   = Number(sa.eave_lf) || 0;
  const stepLf   = Number(sa.step_flashing_lf) || 0;
  const apronLf  = Number(sa.apron_flashing_lf) || 0;

  // Flat area (Page 6 gate)
  const flatSqFtRaw = Number(sa.flat_roof_area_sqft) || Number(sa.flat_area_sqft) || 0;
  const flatSqRaw   = Number(sa.flat_area_sq) || (flatSqFtRaw / 100);
  const hasFlatData = flatSqRaw > 0 || flatSqFtRaw > 0;
  const flatSqFt    = flatSqFtRaw || Math.round(flatSqRaw * 100);
  const flatSq      = flatSqRaw || (flatSqFt / 100);
  const flatPerim   = flatSqFt > 0 ? Math.round(Math.sqrt(flatSqFt) * 4) : 0;

  // ─── Satellite image (served via server-side proxy to avoid key restrictions) ─
  const satImg = (lat && lng)
    ? `${baseUrl}/api/maps-proxy?type=staticmap&center=${encodeURIComponent(`${lat},${lng}`)}&zoom=20&size=640x420&maptype=satellite`
    : '';

  // ─── Street view photos (served via proxy) ──────────────────────────────────
  const DIRS = [
    { label: 'North', heading: 0,   color: '#3b82f6' },
    { label: 'East',  heading: 90,  color: '#16a34a' },
    { label: 'South', heading: 180, color: '#f59e0b' },
    { label: 'West',  heading: 270, color: '#9333ea' },
  ];
  const svBase = (lat && lng)
    ? `${baseUrl}/api/maps-proxy?type=streetview&lat=${lat}&lng=${lng}&size=400x300&pitch=10`
    : '';
  const streetViewCards = DIRS.map(d => {
    const url = svBase ? `${svBase}&heading=${d.heading}` : '';
    const gUrl = (lat && lng)
      ? `https://www.google.com/maps/@${lat},${lng},3a,80y,${d.heading}h,85t/data=!3m1!1e1`
      : '#';
    return `<div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <div style="background:${d.color};color:#fff;padding:5px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">${esc(d.label)} (${d.heading}°)</div>
      ${url ? `<a href="${escA(gUrl)}" target="_blank" style="display:block">
        <img src="${escA(url)}" style="width:100%;height:200px;object-fit:cover;display:block"
             onerror="this.parentElement.parentElement.querySelector('.sv-fb').style.display='flex';this.style.display='none'" /></a>` : ''}
      <div class="sv-fb" style="display:${url ? 'none' : 'flex'};align-items:center;justify-content:center;height:200px;background:#f3f4f6;color:#9ca3af;font-size:12px;flex-direction:column;gap:6px">
        <span style="font-size:24px">🏠</span><span>Street view unavailable</span>
      </div>
    </div>`;
  }).join('');
  const presentationIllustration = presentationRenderUrl ? `
    <div style="margin:16px 0 22px">
      <h2 style="font-size:16px;color:#1e3a8a;margin-bottom:10px">Presentation Illustration</h2>
      <img src="${escA(presentationRenderUrl)}" style="width:100%;max-height:440px;object-fit:contain;border:2px solid #e5e7eb;border-radius:8px" />
      <div style="font-size:11px;color:#475569;text-align:center;margin-top:6px;font-weight:700">Illustration — not a measurement document</div>
    </div>` : '';

  // ─── Pitch breakdown from segment_stats ────────────────────────────────────
  const segStats = Array.isArray(sa.segment_stats) ? sa.segment_stats : [];
  const pitchGroups = {};
  for (const s of segStats) {
    const deg  = Number(s.pitch_deg) || 0;
    const sfVal = (Number(s.area_sqm) || 0) * 10.7639;
    const rise = Math.min(20, Math.max(0, Math.round(Math.tan(deg * Math.PI / 180) * 12)));
    const key2 = `${rise}/12`;
    pitchGroups[key2] = (pitchGroups[key2] || 0) + sfVal;
  }
  const totalSegSqFt = Object.values(pitchGroups).reduce((a, b) => a + b, 0) || roofSqFt;
  const pitchEntries = Object.entries(pitchGroups)
    .sort((a, b) => b[1] - a[1])
    .map(([p, sfVal]) => {
      const rise = parseInt(p) || 0;
      const mult = Math.round(Math.sqrt(1 + (rise / 12) ** 2) * 1000) / 1000;
      const pct  = totalSegSqFt > 0 ? (sfVal / totalSegSqFt * 100).toFixed(1) : '0.0';
      return { pitch: p, sqft: Math.round(sfVal), sq: (sfVal / 100).toFixed(2), pct, mult };
    });

  // ─── Page header helper ─────────────────────────────────────────────────────
  function pageHdr(title, sub, pageNum) {
    return `<div class="header">
      <div class="header-left"><h1>${esc(title)}</h1><div class="subtitle">${esc(sub)}</div></div>
      <div class="header-right"><div class="est-num">MEASUREMENT REPORT</div><div class="est-date">Page ${pageNum} &bull; ${esc(now)}</div></div>
    </div>`;
  }

  // ─── Page 4 — 7-column waste matrix ────────────────────────────────────────
  const WASTE7 = [0, 7, 10, 12, 14, 17, 22];
  const wasteMatrixRows = WASTE7.map(w => {
    const sf = Math.round(roofSqFt * (1 + w / 100));
    const sq = (sf / 100).toFixed(1);
    const hi = w === wastePct;
    const bg = hi ? 'background:#dbeafe;font-weight:700;' : '';
    return `<td style="padding:7px 6px;border:1px solid #e5e7eb;text-align:center;font-size:12px;${bg}">${sf.toLocaleString()}</td>
            <td style="padding:7px 6px;border:1px solid #e5e7eb;text-align:center;font-size:12px;${bg}">${sq}</td>`;
  });

  // ─── Page 5 — brands-across-columns materials table ────────────────────────
  // Header: row1 = brand groups (colspan=MAT_WASTE.length); row2 = waste sub-cols per brand
  const numBrandCols = BRANDS.length * MAT_WASTE.length; // 4×4=16

  function brandHeaderRows() {
    const row1Cells = BRANDS.map(b =>
      `<th colspan="${MAT_WASTE.length}" style="background:#1e3a8a;color:#fff;padding:7px;font-size:11px;font-weight:700;border-left:2px solid #93c5fd;text-align:center">${esc(b.short)}<div style="font-size:9px;font-weight:400;opacity:0.8">${esc(b.product)}</div></th>`
    ).join('');
    const row2Cells = BRANDS.flatMap(() =>
      MAT_WASTE.map(w => `<th style="background:#374151;color:#e5e7eb;padding:5px 4px;font-size:9px;text-align:center;border:1px solid #4b5563">${w}%</th>`)
    ).join('');
    return `<tr><th rowspan="2" style="background:#1e3a8a;color:#fff;padding:7px 10px;font-size:10px;text-align:left;min-width:140px">Material</th>
                <th rowspan="2" style="background:#1e3a8a;color:#fff;padding:7px 6px;font-size:10px;text-align:center;white-space:nowrap">Unit</th>
                ${row1Cells}</tr>
            <tr>${row2Cells}</tr>`;
  }

  function matRow(label, unit, qtyFn, alt) {
    const bg = alt ? 'background:#fafafa;' : '';
    const cells = BRANDS.flatMap(b =>
      MAT_WASTE.map(w => {
        const q = qtyFn(b, sqAt(roofSq, w), sfAt(roofSqFt, w), w);
        return td(q, w === wastePct, 'border-left:1px solid #e5e7eb;');
      })
    ).join('');
    return `<tr style="${bg}">${tdL(label, true)}${tdU(unit)}${cells}</tr>`;
  }

  function matRowFixed(label, unit, qtyFn, alt) {
    return matRow(label, unit, (_b, sq, sf, w) => qtyFn(sq, sf, w), alt);
  }

  function matRowBrand(label, unit, qtyFn, alt) {
    return matRow(label, unit, (b, sq, sf, w) => qtyFn(b, sq, sf, w), alt);
  }

  function sectionDivider(label) {
    return `<tr><td colspan="${2 + numBrandCols}" style="background:#eff6ff;padding:5px 9px;font-size:10px;font-weight:700;color:#1e3a8a;text-transform:uppercase;letter-spacing:0.4px">${esc(label)}</td></tr>`;
  }

  // Accessory quantities (same across all brands, vary with waste for shingles/underlayment)
  const starterQty  = eaveLf > 0  ? Math.ceil(eaveLf / 105) : '—';
  const hnrQty      = (hipLf + ridgeLf) > 0 ? Math.ceil((hipLf + ridgeLf) / 35) : '—';
  const eaveDEQty   = eaveLf > 0  ? Math.ceil(eaveLf / 10) : '—';
  const rakeDEQty   = rakeLf > 0  ? Math.ceil(rakeLf / 10) : '—';
  const valleyMQty  = valleyLf > 0 ? Math.ceil(valleyLf / 10) : '—';
  const stepFlQty   = stepLf > 0  ? Math.ceil(stepLf * 4) : '—';
  const ridgeVQty   = ridgeLf > 0 ? Math.ceil(ridgeLf / 4) : '—';
  const apronMQty   = apronLf > 0 ? Math.ceil(apronLf / 10) : '—';

  // ─── Page 6 flat materials ──────────────────────────────────────────────────
  function flatTbl() {
    const flatWaste = 12; // flat materials always calculated at 12% waste per spec
    const flatSqW  = flatSq  * (1 + flatWaste / 100);
    const flatSfW  = flatSqFt * (1 + flatWaste / 100);
    const sysCols  = FLAT_SYSTEMS.length;

    function flatHdr() {
      return `<tr>
        <th style="background:#1e3a8a;color:#fff;padding:7px 10px;font-size:10px;text-align:left;min-width:160px">Material</th>
        <th style="background:#1e3a8a;color:#fff;padding:7px 6px;font-size:10px;text-align:center">Unit</th>
        ${FLAT_SYSTEMS.map(s => `<th style="background:#1e3a8a;color:#fff;padding:7px 6px;font-size:10px;text-align:center">${esc(s.name)}</th>`).join('')}
      </tr>`;
    }

    function fRow(label, unit, qtyFn, alt) {
      const bg = alt ? 'background:#fafafa;' : '';
      const cells = FLAT_SYSTEMS.map(sys => td(qtyFn(sys, flatSqW, flatSfW), false)).join('');
      return `<tr style="${bg}">${tdL(label, true)}${tdU(unit)}${cells}</tr>`;
    }

    return `<table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead>${flatHdr()}</thead>
      <tbody>
        ${fRow('Membrane / Cap Sheet (2.5 SQ/roll)', 'roll', (sys, sq) => Math.ceil(sq / 2.5), false)}
        ${fRow('Bonding Adhesive (1 gal / 50 sqft)', 'gal',  (sys, _sq, sf) => sys.adhesive ? Math.ceil(sf / 50) : '—', true)}
        ${fRow('Cover Board ½" (4×8 sheets)',          'sheet', (_sys, _sq, sf) => Math.ceil(sf / 30), false)}
        ${fRow('Polyiso Insulation 2" (4×8 sheets)',   'sheet', (_sys, _sq, sf) => Math.ceil(sf / 30), true)}
        ${fRow('3" Insulation Plates',                 'piece', (sys, _sq, sf) => sys.mfPlates ? Math.ceil(sf * 0.75) : '—', false)}
        ${fRow('HD Fasteners (box of 1000)',           'box',   (sys, _sq, sf) => sys.mfPlates ? Math.max(1, Math.ceil(sf / 1000)) : '—', true)}
        ${fRow('MF Plates (box of 1000)',              'box',   (sys, _sq, sf) => sys.mfPlates ? Math.max(1, Math.ceil(sf / 500)) : '—', false)}
        ${fRow('Edge Metal (10 ft pieces)',            'piece', () => Math.ceil(flatPerim / 10), true)}
        ${fRow('Sealant / Caulk',                     'tube',  (_sys, _sq, sf) => Math.ceil(sf / 50), false)}
      </tbody>
    </table>`;
  }

  // ─── Storm history helpers ──────────────────────────────────────────────────
  const sh = stormHistory || {};
  const shStats = sh.stats || {};
  const shHail = Array.isArray(sh.hailEvents) ? sh.hailEvents : [];
  const shWind = Array.isArray(sh.windEvents) ? sh.windEvents : [];
  const shTornado = Array.isArray(sh.tornadoEvents) ? sh.tornadoEvents : [];
  const hasStormData = sh.success && (shStats.hailCount > 0 || shStats.windCount > 0 || shStats.tornadoCount > 0);
  const noStormData = sh.success && !hasStormData;

  function stormDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return iso; }
  }
  function stormEventTable(title, events, cols) {
    if (events.length === 0) return '';
    const rows = events.slice(0, 20).map((s, i) => {
      const bg = i % 2 === 0 ? '#f9fafb' : '#fff';
      return `<tr style="background:${bg}">${cols.map(c => `<td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;font-size:11px;${c.right ? 'text-align:right;' : ''}${c.bold ? 'font-weight:600;' : ''}">${esc(c.fn(s))}</td>`).join('')}</tr>`;
    }).join('');
    const heads = cols.map(c => `<th style="background:#1e3a8a;color:#fff;padding:6px 8px;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;${c.right ? 'text-align:right;' : 'text-align:left;'}">${esc(c.label)}</th>`).join('');
    return `
      <div class="section-title">${esc(title)}${events.length > 20 ? ` <span style="font-weight:400;font-size:9px;color:#6b7280">(top 20 of ${events.length} shown)</span>` : ''}</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
        <thead><tr>${heads}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ─── Combined page numbers ──────────────────────────────────────────────────
  let pg = 1;
  const p1 = pg++;
  const p2 = pg++;
  const p3 = pitchEntries.length > 0 ? pg++ : null;
  const p4 = roofSq > 0 ? pg++ : null;
  const p5 = roofSq > 0 ? pg++ : null;
  const p6 = hasFlatData ? pg++ : null;
  const p7 = lineItems.length > 0 ? pg++ : null;
  const pStorm = sh.success ? pg++ : null;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Measurement Report — ${esc(addr)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1f2937; line-height: 1.5; background: #f1f5f9; }
    @media print {
      body { background: #fff; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
      @page { margin: 0.45in; }
    }
    .page { max-width: 920px; margin: 0 auto; padding: 32px 36px; background: #fff; }
    .page + .page { border-top: 8px solid #f1f5f9; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 3px solid #1e3a8a; }
    .header-left h1 { font-size: 22px; color: #1e3a8a; font-weight: 800; }
    .header-left .subtitle { color: #6b7280; font-size: 11px; margin-top: 2px; }
    .header-right { text-align: right; }
    .header-right .est-num { font-size: 12px; font-weight: 700; color: #1e3a8a; }
    .header-right .est-date { font-size: 11px; color: #9ca3af; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 14px 0; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; }
    .info-box h3 { font-size: 10px; text-transform: uppercase; color: #9ca3af; letter-spacing: 0.8px; margin-bottom: 8px; font-weight: 700; }
    .info-row { display: flex; justify-content: space-between; align-items: baseline; padding: 4px 0; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #6b7280; }
    .info-value { font-weight: 700; color: #111827; }
    .section-title { font-size: 11px; font-weight: 700; color: #1e3a8a; text-transform: uppercase; letter-spacing: 0.5px; margin: 16px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #e5e7eb; }
    .grade-badge { display:inline-block;width:28px;height:28px;border-radius:50%;background:${gradeColor};color:#fff;font-weight:800;font-size:14px;line-height:28px;text-align:center; }
    .sv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .note-box { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 9px 12px; font-size: 11px; color: #92400e; margin-top: 12px; }
    .footer { text-align: center; color: #9ca3af; font-size: 10px; margin-top: 16px; padding-top: 10px; border-top: 1px solid #e5e7eb; }
    .print-btn { position: fixed; bottom: 20px; right: 20px; background: #1e3a8a; color: #fff; border: none; padding: 11px 22px; border-radius: 8px; font-size: 13px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.25); z-index: 999; }
    .print-btn:hover { background: #1e40af; }
    table { border-collapse: collapse; }
    .waste-tbl th, .waste-tbl td { font-size: 11px; }
    .mat-tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
    .mat-tbl th { white-space: nowrap; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">🖨 Print / Save PDF</button>

  <!-- ══════════════════════════════════════════════════════════════════
       PAGE 1 — COVER / SUMMARY
  ══════════════════════════════════════════════════════════════════ -->
  <div class="page">
    <div class="header">
      <div class="header-left">
        ${companyLogoUrl ? `<img src="${escA(companyLogoUrl)}" style="max-height:36px;max-width:160px;margin-bottom:6px;object-fit:contain" onerror="this.style.display='none'" />` : ''}
        <h1>${esc(co)}</h1>
        <div class="subtitle">ROOF MEASUREMENT REPORT — ${esc(addr)}</div>
      </div>
      <div class="header-right">
        <div class="est-num">STAFF ONLY — NO PRICING</div>
        <div class="est-date">${esc(now)}</div>
        <div style="margin-top:6px"><span class="grade-badge">${confGrade}</span></div>
      </div>
    </div>

    ${roofSq > 0 ? `
    <div class="two-col">
      <!-- Left: PROJECT SUMMARY -->
      <div class="info-box">
        <h3>Project Summary</h3>
        <div class="info-row"><span class="info-label">Total Facets</span><span class="info-value">${numSegs > 0 ? numSegs : '—'}</span></div>
        <div class="info-row"><span class="info-label">Predominant Pitch</span><span class="info-value">${esc(pitchStr)}</span></div>
        <div class="info-row"><span class="info-label">Roof Type</span><span class="info-value" style="text-transform:capitalize">${esc(roofType)}</span></div>
        <div class="info-row"><span class="info-label">Net Squares</span><span class="info-value">${roofSq.toFixed(2)} SQ</span></div>
        <div class="info-row"><span class="info-label">Net Area</span><span class="info-value">${roofSqFt.toLocaleString()} sqft</span></div>
        <div class="info-row"><span class="info-label">Squares @ ${wastePct}% Waste</span><span class="info-value">${orderSq.toFixed(2)} SQ</span></div>
        <div class="info-row"><span class="info-label">Measurement Source</span><span class="info-value">Google Solar API</span></div>
        <div class="info-row"><span class="info-label">Confidence</span><span class="info-value"><span class="grade-badge">${confGrade}</span> ${conf}%</span></div>
      </div>
      <!-- Right: MEASUREMENT BREAKDOWN -->
      <div class="info-box">
        <h3>Measurement Breakdown (Linear Feet)</h3>
        ${[
          ['Ridge',          ridgeLf ],
          ['Hip',            hipLf   ],
          ['Valley',         valleyLf],
          ['Rake',           rakeLf  ],
          ['Eave',           eaveLf  ],
          ['Sidewall Flashing', stepLf],
          ['Headwall / Apron',  apronLf],
        ].map(([label, val]) => val > 0 ? `
        <div class="info-row"><span class="info-label">${esc(label)}</span><span class="info-value">${Number(val).toFixed(1)} LF</span></div>` : '').join('')}
        ${[ridgeLf, hipLf, valleyLf, rakeLf, eaveLf].every(v => v === 0) ? '<div style="color:#9ca3af;font-size:12px;padding:8px 0">No linear measurements available</div>' : ''}
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0">
          <div class="info-row"><span class="info-label">Total Perimeter (Eave+Rake)</span><span class="info-value">${(eaveLf + rakeLf).toFixed(0)} LF</span></div>
        </div>
      </div>
    </div>
    ` : `<div style="background:#f1f5f9;border-radius:8px;padding:24px;text-align:center;color:#6b7280;font-size:13px;margin:16px 0">No roof area data — run satellite analysis first</div>`}

    <!-- Satellite image with N compass overlay -->
    ${satImg ? `
    <div class="section-title">Satellite View</div>
    <div style="position:relative;display:inline-block;width:100%">
      <img src="${escA(satImg)}" style="width:100%;max-height:380px;object-fit:cover;border-radius:8px;border:2px solid #e5e7eb;display:block"
           onerror="this.style.display='none'" alt="Satellite view" />
      <div style="position:absolute;top:10px;left:10px;background:rgba(0,0,0,0.72);color:#fff;font-weight:800;font-size:13px;padding:5px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.35);letter-spacing:0.5px">&#8679; N</div>
    </div>
    <div style="font-size:10px;color:#9ca3af;text-align:center;margin-top:3px">${esc(addr)} &mdash; Google satellite imagery &copy; ${new Date().getFullYear()}</div>
    ` : `<div style="background:#f3f4f6;border-radius:8px;height:140px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:12px;margin:14px 0">Satellite image unavailable — address coordinates required</div>`}

    ${sa.analysis_notes ? `<div class="note-box" style="margin-top:12px">${esc(sa.analysis_notes)}</div>` : ''}
    <div class="footer">${esc(co)} &bull; Measurement Report &bull; ${esc(now)} &bull; <strong>STAFF USE ONLY — no pricing shown</strong></div>
  </div>

  <!-- ══════════════════════════════════════════════════════════════════
       PAGE 2 — DIRECTIONAL STREET VIEWS
  ══════════════════════════════════════════════════════════════════ -->
  <div class="page page-break">
    ${pageHdr('Directional Street Views', addr, p2)}
    <div style="font-size:11px;color:#6b7280;margin-bottom:10px">Street-level views to assess approach angle, gutter line, and obstructions. Click any photo to open in Google Maps.</div>
    ${presentationIllustration}
    <div class="sv-grid">${streetViewCards}</div>
    ${!svBase ? '<div class="note-box">Street view images require a Google Maps API key with the Street View Static API enabled.</div>' : ''}
    <div class="footer">${esc(co)} &bull; Street Views &bull; ${esc(addr)}</div>
  </div>

  <!-- ══════════════════════════════════════════════════════════════════
       PAGE 3 — PITCH BREAKDOWN (skipped if no segment data)
  ══════════════════════════════════════════════════════════════════ -->
  ${p3 !== null ? `
  <div class="page page-break">
    ${pageHdr('Pitch Breakdown by Segment', addr, p3)}
    <div style="font-size:11px;color:#6b7280;margin-bottom:10px">
      Derived from Google Solar API (${numSegs} segments). Slope multiplier = sloped length ÷ horizontal run.
      Predominant pitch: <strong>${esc(pitchStr)}</strong>.
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          ${thL('Pitch')}${th('Area (sqft)')}${th('Area (SQ)')}${th('% of Total')}${th('Slope Mult.')}
        </tr>
      </thead>
      <tbody>
        ${pitchEntries.map((e, i) => {
          const bg = i % 2 === 0 ? '#f9fafb' : '#fff';
          return `<tr style="background:${bg}">
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:700">${esc(e.pitch)}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${e.sqft.toLocaleString()}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${e.sq}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${e.pct}%</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${e.mult}</td>
          </tr>`;
        }).join('')}
        <tr style="background:#1e3a8a;color:#fff">
          <td style="padding:8px 12px;font-weight:700">Total</td>
          <td style="padding:8px 12px;text-align:right;font-weight:700">${Math.round(totalSegSqFt).toLocaleString()}</td>
          <td style="padding:8px 12px;text-align:center;font-weight:700">${(totalSegSqFt / 100).toFixed(2)}</td>
          <td style="padding:8px 12px;text-align:center">100%</td>
          <td style="padding:8px 12px;text-align:center">—</td>
        </tr>
      </tbody>
    </table>
    <div class="note-box">A 6/12 pitch has a slope multiplier of 1.118 — every 100 sqft of plan area = 111.8 sqft of roof surface. This corrects flat-plan satellite measurements to true slope area.</div>
    <div class="footer">${esc(co)} &bull; Pitch Breakdown &bull; ${esc(addr)}</div>
  </div>
  ` : ''}

  <!-- ══════════════════════════════════════════════════════════════════
       PAGE 4 — WASTE MATRIX + LINEAR MEASUREMENTS
  ══════════════════════════════════════════════════════════════════ -->
  ${p4 !== null ? `
  <div class="page page-break">
    ${pageHdr('Waste Matrix & Linear Measurements', addr, p4)}

    <div class="section-title">Waste Calculation — ${roofSqFt.toLocaleString()} sqft base (highlighted = current ${wastePct}% setting)</div>
    <table class="waste-tbl" style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th style="background:#1e3a8a;color:#fff;padding:7px 10px;font-size:10px;text-align:left">Measurement</th>
          ${WASTE7.flatMap(w => [
            `<th style="background:${w === wastePct ? '#1e40af' : '#1e3a8a'};color:#fff;padding:7px 5px;font-size:10px;text-align:center;border-left:1px solid rgba(255,255,255,0.15)">${w}% sqft</th>`,
            `<th style="background:${w === wastePct ? '#1e40af' : '#1e3a8a'};color:#fff;padding:7px 5px;font-size:10px;text-align:center">${w}% SQ</th>`
          ]).join('')}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:7px 10px;border:1px solid #e5e7eb;font-weight:700;background:#f8fafc">Roof Area</td>
          ${wasteMatrixRows.join('')}
        </tr>
      </tbody>
    </table>

    <div class="section-title" style="margin-top:20px">Linear Measurements</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>${thL('Feature')}${th('Length (LF)')}${th('Confidence')}</tr>
        </thead>
        <tbody>
          ${[
            ['Ridge',          ridgeLf,  sa.ridge_confidence ],
            ['Hip',            hipLf,    sa.hip_confidence   ],
            ['Valley',         valleyLf, sa.valley_confidence],
            ['Rake',           rakeLf,   sa.rake_confidence  ],
            ['Eave',           eaveLf,   sa.eave_confidence  ],
            ['Sidewall Flash.',stepLf,   sa.step_flashing_confidence],
            ['Headwall / Apron', apronLf, null               ],
          ].map(([lbl, val, c], i) => `
          <tr style="background:${i%2===0?'#f9fafb':'#fff'}">
            <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb">${esc(lbl)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:${Number(val)>0?'700':'400'}">${Number(val)>0?Number(val).toFixed(1)+' LF':'—'}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;text-align:center;color:#6b7280">${c?c+'%':'—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div>
        <div class="info-box">
          <h3>Quick Reference</h3>
          <div class="info-row"><span class="info-label">Predominant Pitch</span><span class="info-value">${esc(pitchStr)}</span></div>
          <div class="info-row"><span class="info-label">Roof Type</span><span class="info-value" style="text-transform:capitalize">${esc(roofType)}</span></div>
          <div class="info-row"><span class="info-label">Segments</span><span class="info-value">${numSegs}</span></div>
          <div class="info-row"><span class="info-label">Confidence</span><span class="info-value"><span class="grade-badge">${confGrade}</span></span></div>
          <div class="info-row"><span class="info-label">Eave + Rake (perimeter)</span><span class="info-value">${(eaveLf+rakeLf).toFixed(0)} LF</span></div>
          <div class="info-row"><span class="info-label">Hip + Ridge (cap/vent)</span><span class="info-value">${(hipLf+ridgeLf).toFixed(0)} LF</span></div>
        </div>
      </div>
    </div>

    ${sa.analysis_notes ? `<div class="note-box">${esc(sa.analysis_notes)}</div>` : ''}
    <div class="footer">${esc(co)} &bull; Waste Matrix &bull; ${esc(addr)}</div>
  </div>
  ` : ''}

  <!-- ══════════════════════════════════════════════════════════════════
       PAGE 5 — STEEP-SLOPE MATERIAL QUANTITIES (brands × waste)
  ══════════════════════════════════════════════════════════════════ -->
  ${p5 !== null ? `
  <div class="page page-break">
    ${pageHdr('Steep-Slope Material Quantities', addr, p5)}
    <div style="font-size:11px;color:#6b7280;margin-bottom:10px">
      Based on ${roofSq.toFixed(2)} SQ net area. Highlighted waste % = current setting (${wastePct}%).
      All quantities rounded <em>up</em> to whole units. Verify with supplier before ordering.
    </div>
    <div style="overflow-x:auto">
    <table class="mat-tbl">
      <thead>
        ${brandHeaderRows()}
      </thead>
      <tbody>
        ${sectionDivider('Shingles')}
        ${matRowBrand('Shingles', 'bundle', (b, sq) => Math.ceil(sq * b.bPerSq), false)}

        ${sectionDivider('Synthetic Underlayment')}
        ${matRowFixed('Synthetic Underlayment (10 SQ/roll)', 'roll', sq => Math.ceil(sq / 10), false)}

        ${sectionDivider('Ice & Water Shield')}
        ${matRowFixed(`I&W 36" Perimeter${eaveLf>0?' ('+Math.round(eaveLf*3).toLocaleString()+' sqft)':''}`, 'roll',
            (_sq, sf) => eaveLf > 0 ? Math.ceil(eaveLf * 3 / 75) : '—', false)}
        ${matRowFixed(`I&W 18" Valleys${eaveLf>0?' ('+Math.round(eaveLf*1.5).toLocaleString()+' sqft)':''}`, 'roll',
            (_sq, sf) => eaveLf > 0 ? Math.ceil(eaveLf * 1.5 / 75) : '—', true)}

        ${sectionDivider('Accessories (fixed — not waste-sensitive)')}
        ${matRowFixed('Starter Strip', 'bundle', () => starterQty, false)}
        ${matRowFixed('Hip & Ridge Cap', 'bundle', () => hnrQty, true)}
        ${matRowFixed('Eave Drip Edge (10 ft)', 'piece', () => eaveDEQty, false)}
        ${matRowFixed('Rake Drip Edge (10 ft)', 'piece', () => rakeDEQty, true)}
        ${matRowFixed('Valley Metal / W-Valley (10 ft)', 'piece', () => valleyMQty, false)}
        ${matRowFixed('Step Flashing 5×7', 'piece', () => stepFlQty, true)}
        ${matRowFixed('Apron / Headwall Flashing (10 ft)', 'piece', () => apronMQty, false)}
        ${matRowFixed('Ridge Vent (4 ft sections)', 'piece', () => ridgeVQty, true)}

        ${sectionDivider('Fasteners & Sealants')}
        ${matRowFixed('Coil Nails (50 lb box)', 'box', sq => Math.ceil(sq / 15), false)}
        ${matRowFixed('Plastic Cap Nails', 'box', sq => Math.ceil(sq / 20), true)}
        ${matRowFixed('Roofing Caulk / Sealant', 'tube', sq => Math.ceil(sq / 10), false)}
        ${matRowFixed('Accessories (pipe boots, vents, etc.)', 'allow', () => '—', true)}
      </tbody>
    </table>
    </div>
    <div class="note-box">
      <strong>Formulas:</strong> Shingles = SQ × bundles-per-SQ (GAF/OC/CertainTeed: 3 bpSQ; Malarkey: 3.33 bpSQ).
      I&W 36" = eave LF × 3 ft ÷ 75 sqft/roll. I&W 18" = eave LF × 1.5 ft ÷ 75 sqft/roll.
      Step flashing = sidewall LF × 4 pcs. Ridge vent = ridge LF ÷ 4 ft/pc.
      Verify with your supplier — coverage can vary by product line.
    </div>
    <div class="footer">${esc(co)} &bull; Steep-Slope Materials &bull; ${esc(addr)}</div>
  </div>
  ` : ''}

  <!-- ══════════════════════════════════════════════════════════════════
       PAGE 6 — FLAT ROOF MATERIALS (omitted if no flat area)
  ══════════════════════════════════════════════════════════════════ -->
  ${p6 !== null ? `
  <div class="page page-break">
    ${pageHdr('Flat Roof / Low-Slope Material Quantities', addr, p6)}
    <div style="font-size:11px;color:#6b7280;margin-bottom:10px">
      Flat area: ${flatSqFt.toLocaleString()} sqft (${flatSq.toFixed(2)} SQ) at 12% waste.
      Estimated perimeter: ~${flatPerim} LF. Confirm with supplier before ordering.
    </div>
    <div style="overflow-x:auto">
      ${flatTbl()}
    </div>
    <div class="note-box">Membrane qty assumes 2.5 SQ per roll (check product spec). Adhesive: 1 gal / 50 sqft. Cover board + polyiso: 30 sqft per 4×8 sheet. Insulation plates: ~0.75 pcs/sqft. Edge metal: estimated perimeter ÷ 10 ft.</div>
    <div class="footer">${esc(co)} &bull; Flat Roof Materials &bull; ${esc(addr)}</div>
  </div>
  ` : ''}

  <!-- ══════════════════════════════════════════════════════════════════
       PAGE 7 — ESTIMATE MATERIAL LIST (only if lineItems passed in)
  ══════════════════════════════════════════════════════════════════ -->
  ${p7 !== null ? (() => {
    const total = lineItems.reduce((s, i) => s + (Number(i.rcv) || 0), 0);
    const rows = lineItems.map((item, idx) => {
      const bg = idx % 2 === 0 ? '#f9fafb' : '#fff';
      const qty = Number(item.quantity) || 0;
      const rate = Number(item.rate) || 0;
      const rcv = Number(item.rcv) || 0;
      return `<tr style="background:${bg}">
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center;color:#9ca3af;font-size:10px">${item.line || idx + 1}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:10px;color:#6b7280;font-family:monospace">${esc(item.code || '—')}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;font-weight:500">${esc(item.description || '—')}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:11px">${qty % 1 === 0 ? qty.toLocaleString() : qty.toFixed(2)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center;color:#6b7280;font-size:10px">${esc(item.unit || '—')}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:11px">$${rate.toFixed(2)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:11px;font-weight:600">$${rcv.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>`;
    }).join('');
    return `
  <div class="page page-break">
    ${pageHdr('Estimate Material List', addr, p7)}
    <div style="font-size:11px;color:#6b7280;margin-bottom:10px">
      ${lineItems.length} line item${lineItems.length !== 1 ? 's' : ''} from the active estimate at ${wastePct}% waste.
      <span style="color:#dc2626;font-weight:700">STAFF USE ONLY — do not distribute to customer.</span>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th style="background:#1e3a8a;color:#fff;padding:7px 10px;font-size:10px;text-align:center;width:36px">#</th>
          <th style="background:#1e3a8a;color:#fff;padding:7px 10px;font-size:10px;text-align:left;white-space:nowrap">Code</th>
          <th style="background:#1e3a8a;color:#fff;padding:7px 10px;font-size:10px;text-align:left">Description</th>
          <th style="background:#1e3a8a;color:#fff;padding:7px 10px;font-size:10px;text-align:right">Qty</th>
          <th style="background:#1e3a8a;color:#fff;padding:7px 10px;font-size:10px;text-align:center">Unit</th>
          <th style="background:#1e3a8a;color:#fff;padding:7px 10px;font-size:10px;text-align:right;white-space:nowrap">Unit $</th>
          <th style="background:#1e3a8a;color:#fff;padding:7px 10px;font-size:10px;text-align:right;white-space:nowrap">Total RCV</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr style="background:#1e3a8a;color:#fff">
          <td colspan="6" style="padding:8px 12px;font-weight:700;font-size:12px">TOTAL</td>
          <td style="padding:8px 12px;text-align:right;font-weight:800;font-size:13px">$${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>
      </tbody>
    </table>
    <div class="footer">${esc(co)} &bull; Estimate Material List &bull; ${esc(addr)} &bull; <strong>STAFF USE ONLY</strong></div>
  </div>`;
  })() : ''}

  <!-- ══════════════════════════════════════════════════════════════════
       STORM PAGE — WEATHER INTELLIGENCE (only if storm data fetched)
  ══════════════════════════════════════════════════════════════════ -->
  ${pStorm !== null ? (() => {
    const riskColor = { LOW: '#16a34a', MODERATE: '#d97706', HIGH: '#ea580c', EXTREME: '#dc2626' }[shStats.riskRating] || '#6b7280';
    const riskBg   = { LOW: '#f0fdf4', MODERATE: '#fffbeb', HIGH: '#fff7ed', EXTREME: '#fef2f2' }[shStats.riskRating] || '#f9fafb';
    const yearsBack = Math.round((shStats.daysBack || 1825) / 365);
    const radiusMi  = shStats.radiusMiles || 15;

    const statBadge = (icon, label, value, color = '#1e3a8a') =>
      `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;text-align:center;min-width:100px">
        <div style="font-size:20px;margin-bottom:2px">${icon}</div>
        <div style="font-size:20px;font-weight:800;color:${color}">${esc(String(value))}</div>
        <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px">${esc(label)}</div>
      </div>`;

    const hailTable = stormEventTable('Hail Events ≥ 1"', shHail, [
      { label: 'Date',           fn: s => stormDate(s.start_time) },
      { label: 'Hail Size',      fn: s => s.hail_size_inches ? s.hail_size_inches + '"' : '—', right: true, bold: true },
      { label: 'Distance',       fn: s => s.distance_miles != null ? s.distance_miles + ' mi' : '—', right: true },
      { label: 'Description',    fn: s => s.title || s.description || '—' },
    ]);

    const windTable = stormEventTable('Significant Wind Events ≥ 55 mph', shWind, [
      { label: 'Date',           fn: s => stormDate(s.start_time) },
      { label: 'Wind Speed',     fn: s => s.wind_speed_mph ? Math.round(s.wind_speed_mph) + ' mph' : '—', right: true, bold: true },
      { label: 'Distance',       fn: s => s.distance_miles != null ? s.distance_miles + ' mi' : '—', right: true },
      { label: 'Description',    fn: s => s.title || s.description || '—' },
    ]);

    const tornadoTable = stormEventTable('Tornado Events', shTornado, [
      { label: 'Date',           fn: s => stormDate(s.start_time) },
      { label: 'Severity',       fn: s => (s.severity || '—').toUpperCase(), bold: true },
      { label: 'Distance',       fn: s => s.distance_miles != null ? s.distance_miles + ' mi' : '—', right: true },
      { label: 'Description',    fn: s => s.title || s.description || '—' },
    ]);

    // Insurance supplement paragraph
    const suppParts = [];
    if (shStats.hailCount > 0) suppParts.push(`${shStats.hailCount} hail event${shStats.hailCount !== 1 ? 's' : ''} ≥ 1" (largest: ${shStats.maxHailInches}")`);
    if (shStats.windCount > 0) suppParts.push(`${shStats.windCount} wind event${shStats.windCount !== 1 ? 's' : ''} ≥ 55 mph (max: ${Math.round(shStats.maxWindMph)} mph)`);
    if (shStats.tornadoCount > 0) suppParts.push(`${shStats.tornadoCount} tornado event${shStats.tornadoCount !== 1 ? 's' : ''}`);
    const suppText = suppParts.length > 0
      ? `NOAA storm records show ${suppParts.join('; ')} within ${radiusMi} miles of this property over the past ${yearsBack} years. This documented storm history supports the case for a full insurance supplement claim and may indicate prior damage contributing to current roof conditions.`
      : `No significant hail (≥ 1"), damaging wind (≥ 55 mph), or tornado events were recorded within ${radiusMi} miles of this property over the past ${yearsBack} years according to NOAA data.`;

    return `
  <div class="page page-break">
    ${pageHdr('Weather Intelligence — Storm History', addr, pStorm)}
    <div style="font-size:11px;color:#6b7280;margin-bottom:14px">
      NOAA storm event data within <strong>${radiusMi} miles</strong> of this property over the past <strong>${yearsBack} years</strong>.
      Sourced from IEM (Iowa Environmental Mesonet) NOAA Local Storm Reports.
    </div>

    <!-- Risk Rating + Stat Badges -->
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:18px">
      <div style="background:${riskBg};border:2px solid ${riskColor};border-radius:10px;padding:14px 22px;text-align:center;min-width:120px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:${riskColor};font-weight:700;margin-bottom:4px">Storm Risk Rating</div>
        <div style="font-size:26px;font-weight:900;color:${riskColor}">${esc(shStats.riskRating)}</div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;flex:1">
        ${statBadge('🌧', 'Hail Events ≥ 1"', shStats.hailCount, shStats.hailCount > 0 ? '#d97706' : '#6b7280')}
        ${statBadge('💨', 'Wind Events ≥ 55 mph', shStats.windCount, shStats.windCount > 0 ? '#ea580c' : '#6b7280')}
        ${statBadge('🌪', 'Tornado Events', shStats.tornadoCount, shStats.tornadoCount > 0 ? '#dc2626' : '#6b7280')}
        ${statBadge('🔴', 'Max Hail', shStats.maxHailInches > 0 ? shStats.maxHailInches + '"' : '—', shStats.maxHailInches >= 1.5 ? '#dc2626' : '#6b7280')}
        ${statBadge('💨', 'Max Wind', shStats.maxWindMph > 0 ? Math.round(shStats.maxWindMph) + ' mph' : '—', shStats.maxWindMph >= 75 ? '#dc2626' : '#6b7280')}
      </div>
    </div>

    ${noStormData
      ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:18px;text-align:center;color:#16a34a;font-size:13px;margin:20px 0">
           <div style="font-size:22px;margin-bottom:6px">✅</div>
           <strong>No significant storm events recorded</strong><br>
           <span style="font-size:11px;color:#374151">No hail ≥ 1", damaging wind ≥ 55 mph, or tornado events found within ${radiusMi} miles in the past ${yearsBack} years.</span>
         </div>`
      : `${hailTable}${windTable}${tornadoTable}`}

    <!-- Insurance Supplement Section -->
    <div class="section-title">Insurance Supplement Basis</div>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px 16px;font-size:12px;line-height:1.6;color:#1e40af;margin-bottom:14px">
      ${esc(suppText)}
    </div>

    <!-- NOAA Disclaimer -->
    <div class="note-box" style="font-size:10px;color:#78350f">
      <strong>Data Source:</strong> NOAA / IEM (Iowa Environmental Mesonet) Local Storm Reports. Storm locations are approximate; some events use county or state centroids when precise coordinates are unavailable.
      This report is intended as supporting documentation for insurance supplement claims and professional assessments — not a guarantee of storm impact on this specific structure.
      Consult a licensed public adjuster or structural engineer for final damage determinations.
    </div>

    <div class="footer">${esc(co)} &bull; Weather Intelligence &bull; ${esc(addr)} &bull; NOAA / IEM Data &bull; ${esc(now)}</div>
  </div>`;
  })() : ''}

</body>
</html>`;
}
