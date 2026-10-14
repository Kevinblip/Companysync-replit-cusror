/**
 * Property Measurement Report — printable architectural drawing sheet.
 *
 * The four 2D elevation views are rendered at GENERATION time by the shared
 * CAD-grade SVG builder (elevationDrawings.js) — the same drawings shown in
 * the in-app siding card — and inlined into the HTML, so the report and the
 * app can never diverge. The isometric roof view and the perimeter layout
 * still use the inline Canvas engine (runs in the browser on page load).
 */

import {
  calculateRoofAreaFromFootprint,
  calculateNetSiding,
  calculateNetSidingSQ,
  calibrateRoofArea,
  calculateFusedRoof,
  processWindowUnits,
  processShutters,
  processAwnings,
  openingsFromCounts,
  DEFAULT_OPENING_SQFT,
} from './companySyncFormulas.js';
import {
  computeDerivedExteriorQuantities,
  DEFAULT_OVERHANG_FT,
  resolveSidingRoofEdges,
} from './sidingDerivedQuantities.js';
import { renderElevationSet } from './elevationDrawings.js';
import { resolveCanonicalSidingContract } from './sidingReportNormalization.js';
import { countFootprintCorners } from './footprintCorners.js';
import { calculateSidingWaste } from './sidingWaste.js';

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function ftStr(n) {
  if (!n || !Number.isFinite(Number(n))) return '—';
  const t=Math.round(Number(n)), f=Math.floor(t), i=Math.round((t-f)*12);
  return i>0?`${f}' ${i}"`:`${f}'`;
}
function ft(n,dec=0){
  const v=Number(n); return Number.isFinite(v)?(dec?v.toFixed(dec):Math.round(v)).toLocaleString():'—';
}

function normalizePoly(poly) {
  const xs=poly.map(([x])=>x),zs=poly.map(([,z])=>z);
  const minX=Math.min(...xs),minZ=Math.min(...zs);
  return poly.map(([x,z])=>[x-minX,z-minZ]);
}

export function generateSidingReportHTML({
  sidingMeasurements, satelliteAnalysis, satelliteAddress,
  companyName, companyLogoUrl, stoneVeneerSqft=0,
  facePhotos=[],
}) {
  const sd  = sidingMeasurements || {};
  const sa  = satelliteAnalysis  || {};
  const addr = satelliteAddress?.address || '';
  const co   = companyName || 'CompanySync';
  const now  = new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  const projId=`AIE-${Date.now().toString(36).toUpperCase().slice(-5)}`;
  const sidingContract = resolveCanonicalSidingContract(
    sd,
    sd._wasteOverride ?? sd.recommended_waste_pct ?? 0,
  );
  const materialMap = sd.material_map || sd.materialMap || sd.measurement_graph?.material_map || null;
  const materialAreaFor = (material) => materialMap
    ? Object.values(materialMap.faces || {}).reduce((sum, face) => sum + (face.regions || [])
      .filter(region => region.material === material)
      .reduce((inner, region) => inner + (Number(region.area_sqft) || 0), 0), 0)
    : 0;
  const mappedSidingSqft = Number(
    sd.siding_material_area_sqft
    ?? sidingContract.totals?.siding_material_area_sqft
    ?? materialMap?.siding_area_sqft,
  ) || 0;
  const mappedStoneSqft = materialAreaFor('stone');
  const mappedBrickSqft = materialAreaFor('brick');

  // ── Building geometry ─────────────────────────────────────────────────────
  const W = Math.max(Number(sd.building_length_ft)||Number(sa.building_length_ft)||40, 10);
  const D = Math.max(Number(sd.building_width_ft) ||Number(sa.building_width_ft) ||30, 10);
  const storyCt = Number(sd.story_count)||1;
  const storyH  = Number(sd.story_height_ft)||9;
  const H = Math.max(storyCt*storyH, 7);
  const pitchStr = String(sa.pitch||sd.roof_pitch_detected||'6/12');
  const P = parseFloat(pitchStr.split('/')[0])||6;
  const isHip = /hip|pyramid/i.test(sa.roof_type||sd.roof_type||'');

  const rawPoly = sd.footprint_polygon_xy||sa.footprint_polygon_xy||null;
  const poly = rawPoly&&rawPoly.length>=3 ? normalizePoly(rawPoly) : [[0,0],[W,0],[W,D],[0,D]];

  // ── Linear measurements ───────────────────────────────────────────────────
  const hipHalf=Math.min(W,D)/2, gRise=(D/2)*(P/12), hRise=hipHalf*(P/12);
  // Raw MEASURED edges (before geometric fallbacks) — the derived-quantities
  // util must see these so its measured/estimated label stays honest and the
  // report agrees with the on-screen card (which also passes raw values).
  const resolvedSidingEdges = resolveSidingRoofEdges(sd, sa);
  const measuredEaveLf = resolvedSidingEdges.eaveLf;
  const measuredRakeLf = resolvedSidingEdges.rakeLf;
  let ridgeLf  = Number(sa.ridge_lf)  || 0;
  let hipLf    = Number(sa.hip_lf)    || 0;
  let valleyLf = Number(sa.valley_lf) || 0;
  let rakeLf   = measuredRakeLf;
  let eaveLf   = measuredEaveLf;
  if (!ridgeLf) ridgeLf = isHip?Math.round(Math.max(0,W-2*hipHalf)):Math.round(W);
  if (!eaveLf)  eaveLf  = isHip?Math.round(2*W+2*D):Math.round(2*W);
  if (!rakeLf&&!isHip) rakeLf=Math.round(4*Math.sqrt((D/2)**2+gRise**2));
  if (!hipLf&&isHip)   hipLf =Math.round(4*Math.sqrt(hipHalf**2+hipHalf**2+hRise**2));

  // ── Faces / openings ──────────────────────────────────────────────────────
  const allOps  = sd.openings_detail||[];

  // ── Canonical measurements via companySyncFormulas ────────────────────────
  // Perimeter: prefer stored value, else walk the footprint polygon × 2 (both floors).
  const perimeterLf = Number(sd.perimeter_ft) || Math.round(
    poly.reduce((s, _, i) => {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
      return s + Math.sqrt((bx - ax) ** 2 + (bz - az) ** 2);
    }, 0) * 2
  );

  // Openings: prefer detailed list, fall back to count-based defaults.
  const rawOpenings = (sd.openings_detail || allOps || []);
  const openingsForCalc = rawOpenings.length > 0
    ? rawOpenings
    : openingsFromCounts({
        windows:           Number(sd.window_count)        || 0,
        entryDoors:        Number(sd.entry_door_count)    || 0,
        garageDoors:       Number(sd.garage_door_count)   || 0,
        singleGarageDoors: Number(sd.single_garage_count) || 0,
      });

  // De-group mulled window banks → individual unit count + precise area deduction.
  const windowCalc = processWindowUnits(openingsForCalc);
  // The satellite panel can replace the AI opening inventory with a field count.
  // Keep this as a separate path so the report never presents the stale AI
  // breakdown alongside the manually corrected deduction.
  const parsedOpeningCount = Number(sd.actual_openings_count);
  const hasOpeningCountOverride = sd.actual_openings_count != null
    && Number.isInteger(parsedOpeningCount)
    && parsedOpeningCount >= 0;
  const fieldOpeningDeductionSqft = hasOpeningCountOverride
    ? parsedOpeningCount * 15
    : 0;

  // The measurement graph is the canonical source: it already splits the wall
  // prism into siding vs masonry and charges each opening to the material of
  // the wall it is cut into. Recomputing here from raw opening geometry would
  // re-apply the old "every opening comes out of siding" identity and disagree
  // with the on-screen numbers on any mixed-material house.
  const reportGraphTotals = sidingContract.totals;
  const sidingCalc        = calculateNetSiding(perimeterLf, H, openingsForCalc);
  const masonryDeductSqft = Number(
    reportGraphTotals?.masonry_area_sqft
    ?? sd.masonry_deduction_sqft
    ?? sd.masonry_deduct_sqft
    ?? sd.accent_deduction_sqft,
  ) || 0;
  // Total rough-opening area across ALL walls, vs. the portion actually charged
  // to the siding column.
  const openingTotalSqft = Number(
    hasOpeningCountOverride
      ? fieldOpeningDeductionSqft
      : (reportGraphTotals?.opening_area_total_sqft ?? windowCalc.total_deduction_sqft),
  ) || 0;
  const openingSidingSqft = Number(
    hasOpeningCountOverride
      ? fieldOpeningDeductionSqft
      : (reportGraphTotals?.opening_deduction_sqft ?? windowCalc.total_deduction_sqft),
  ) || 0;

  const grossSidingSqft = Number(reportGraphTotals?.gross_wall_area_sqft) > 0
    ? Number(reportGraphTotals.gross_wall_area_sqft)
    // Fallback for legacy records with no graph: reconstruct the prism.
    : (Number(sd.wall_area_sqft) > 0
      ? Number(sd.wall_area_sqft) + openingSidingSqft + masonryDeductSqft
      : sidingCalc.gross);

  // calculateNetSidingSQ implements ProductionTighteningEngine.calculateNetSiding:
  //   (grossWallSqFt, stoneIsolatedSqFt, openingsDeductionSqFt) → SQ
  const netSidingSqft = hasOpeningCountOverride
    ? Math.max(0, grossSidingSqft - masonryDeductSqft - fieldOpeningDeductionSqft)
    : sidingContract.graph_present
      ? sidingContract.base_net_siding_area_sqft
    : calculateNetSidingSQ(
      grossSidingSqft,
      masonryDeductSqft,
      windowCalc.total_deduction_sqft,
    ) * 100;
  const netSidingSQ = netSidingSqft / 100;

  // ── Hybrid Solar × Ground-Vision roof fusion ──────────────────────────────
  // Solar API's slope-adjusted area; back out Solar's assumed pitch, re-apply
  // any ground-measured pitch from facade_pitch_slopes for a calibrated result.
  const solarRoofSqft      = Number(sa.roof_area_sq || sa.corrected_area_sq) * 100 || 0;
  const solarPitchMult     = Number(sd.solar_pitch_multiplier) || (() => {
    const pr = Math.atan(P / 12); return 1 / Math.cos(pr);
  })();
  // Only facade_pitch_slopes is independent crew-cam evidence. Falling back
  // to the Solar pitch preserves the normal roof row but must never claim a
  // fused result.
  const facadePitchSlopes = Array.isArray(sd.facade_pitch_slopes)
    ? sd.facade_pitch_slopes
        .map(Number)
        .filter(slope => Number.isFinite(slope) && slope >= 2 && slope <= 20)
    : [];
  const fusedRoof = solarRoofSqft > 0
    ? calculateFusedRoof(solarRoofSqft, solarPitchMult, facadePitchSlopes)
    : null;
  // calibrateRoofArea implements ProductionTighteningEngine.calibrateRoofArea:
  //   sqrt(1 + (pitch/12)²) applied to flat footprint → exact SQ
  const roofSQ = fusedRoof
    ? fusedRoof.calibrated_roof_sq
    : (solarRoofSqft > 0
        ? solarRoofSqft / 100
        : calibrateRoofArea(W * D, P));
  const roofSqft = roofSQ * 100;

  // Corners come from the same count the API saved. The polygon is only
  // the fallback when that count was never computed.
  const polyCorners = countFootprintCorners(poly, H);
  const apiOutside = Number(sd.outside_corners_count ?? sd.trim_totals?.outside_corners_count);
  const apiInside = Number(sd.inside_corners_count ?? sd.trim_totals?.inside_corners_count);
  const outsideCornersQty = Number.isFinite(apiOutside) && apiOutside > 0 ? apiOutside : polyCorners.outside_count;
  const insideCornersQty = Number.isFinite(apiInside) && apiInside >= 0 ? apiInside : polyCorners.inside_count;
  const outsideCornersLf = Number(sd.outside_corners_lf ?? sd.trim_totals?.outside_corner_lf) || Math.round(outsideCornersQty * H);
  const insideCornersLf = Number(sd.inside_corners_lf ?? sd.trim_totals?.inside_corner_lf) || Math.round(insideCornersQty * H);

  // ── Derived exterior quantities (fascia / soffit / trim / roof perimeter) ──
  // Computed from measured roof-edge LF (eave+rake) when the roof analysis
  // provided them — the same math the on-screen summary card shows.
  const derivedQ = computeDerivedExteriorQuantities({
    eaveLf: measuredEaveLf || Number(sd.eave_lf) || 0,
    rakeLf: measuredRakeLf || Number(sd.rake_lf) || 0,
    edgesMeasured: resolvedSidingEdges.source === 'roof_facets',
    perimeterLf,
    // Analyzer's story_height_ft is already TOTAL wall height (stories × per-story);
    // using storyCt*storyH here would double-count on multi-story homes.
    wallHeightFt: Number(sd.story_height_ft) || H,
    // Prefer the analyzer's canonical corner count (what the card shows);
    // polygon-derived count is the fallback.
    outsideCornersCount: Number(sd.trim_totals?.outside_corners_count) || outsideCornersQty,
    openings: openingsForCalc,
    overhangFt: Number(sd.overhang_ft) || DEFAULT_OVERHANG_FT,
    levelSoffitDepthFt: Number(sd.soffit_level_depth_ft) || 0,
    slopedSoffitDepthFt: Number(sd.soffit_sloped_depth_ft) || 0,
    hipRoof: isHip,
  });

  // Coverage honesty: elevations with no photo are estimated, not measured.
  const cov = sd.coverage || sd.measurement_graph?.coverage || null;
  const missingFaces = Array.isArray(cov?.missing_faces) ? cov.missing_faces : [];
  const poorFaces = Array.isArray(sd.poor_faces)
    ? sd.poor_faces
    : (Array.isArray(sd.measurement_graph?.totals?.poor_faces) ? sd.measurement_graph.totals.poor_faces : []);
  const wallQuality = sd.wall_total_quality || sd.measurement_graph?.totals?.wall_total_quality || 'estimated';
  const soffitMeasured = sd.soffit_depth_source === 'measured';

  const openingCountForWaste = (Number(sd.window_units_count) || Number(sd.windows_count) || 0)
    + (Number(sd.doors_count) || 0)
    + (Number(sd.garage_door_count) || 0);
  const computedWaste = calculateSidingWaste({
    openingCount: openingCountForWaste,
    outsideCorners: outsideCornersQty,
    insideCorners: insideCornersQty,
    gableAreaSqft: Number(sd.gable_area_sqft) || 0,
    overridePct: sd.siding_waste_override_pct,
  });
  const sidingWasteApplied = sd.siding_waste_percentage != null
    ? Math.max(10, Number(sd.siding_waste_percentage) || 10)
    : computedWaste.applied_pct;
  const sidingWasteRecommended = sd.siding_waste_recommended_pct != null
    ? Math.max(10, Number(sd.siding_waste_recommended_pct) || 10)
    : computedWaste.recommended_pct;
  const sidingWasteReason = sd.siding_waste_reason || computedWaste.reason;
  const sidingWasteOverride = sd.siding_waste_override_pct == null || sd.siding_waste_override_pct === ''
    ? null
    : Math.max(10, Number(sd.siding_waste_override_pct));
  const sidingOrderSq = Number((netSidingSQ * (1 + sidingWasteApplied / 100)).toFixed(2));
  const roofWastePct = Math.max(10, Number(sa.waste_percentage) || Number(sa.waste_recommended_pct) || 10);
  const roofOrderSq = Number((roofSQ * (1 + roofWastePct / 100)).toFixed(2));
  const jChannelLf = Number(sd.trim_totals?.j_channel_lf ?? sd.j_channel_lf) || 0;
  const starterLf = Number(sd.trim_totals?.starter_strip_lf ?? sd.starter_strip_lf) || 0;
  const lfText = (n) => `${Math.round(Number(n) || 0)} LF`;

  // ── AccessoryDetector results from photo analysis ─────────────────────────
  // processShutters / processAwnings ran server-side; results stored in sd.
  const shutterPairs  = Number(sd.shutter_pair_count)  || 0;
  const shutterPanels = Number(sd.shutter_panel_count) || 0;
  const shutterSqft   = Number(sd.shutter_total_sqft)  || 0;
  const awningCount   = Number(sd.awning_count)       || 0;
  const awningSqft    = Number(sd.awning_total_sqft)  || 0;

  // processShutters on openings when server result is absent (satellite path).
  // Keyed on the server having reported NOTHING — not on a zero pair count, or a
  // house with only single-panel shutters would re-run the fallback every time.
  const _hasServerShutterData =
    sd.shutter_pair_count != null || sd.shutter_panel_count != null || sd.shutter_total_sqft != null;
  const _shutterFallback = !_hasServerShutterData
    ? processShutters(openingsForCalc
        .filter(o => o.type === 'window' && (o.hasLeftShutter || o.hasRightShutter))
        .map(o => ({
          id: o.observation_id || '',
          heightInches: Math.round((Number(o.height_ft || o.height) || 4) * 12),
          widthInches:  Math.round((Number(o.width_ft  || o.width)  || 3) * 12),
          hasLeftShutter:  !!o.hasLeftShutter,
          hasRightShutter: !!o.hasRightShutter,
        })))
    : null;
  const finalShutterPairs  = shutterPairs  || (_shutterFallback?.shutter_pair_count  ?? 0);
  const finalShutterPanels = shutterPanels || (_shutterFallback?.shutter_panel_count ?? 0);
  const finalShutterSqft   = shutterSqft   || (_shutterFallback?.shutter_total_sqft  ?? 0);

  const matRows = [
    { l: `Total Exterior Wall Area${wallQuality === 'measured' ? ' (measured)' : ' (estimated)'}`, v: `~${ft(grossSidingSqft)} sqft`, hi: wallQuality !== 'measured' },
    mappedSidingSqft > 0
      ? { l: 'Siding (lap + vertical)', v: `~${ft(mappedSidingSqft)} sqft`,                 hi: false }
      : null,
    masonryDeductSqft > 0
      ? { l: 'Masonry / Non-Siding', v: `−${ft(masonryDeductSqft)} sqft`,                  hi: false }
      : null,
    mappedStoneSqft > 0
      ? { l: 'Stone (excluded from siding)', v: `~${ft(mappedStoneSqft)} sqft`,             hi: false }
      : null,
    mappedBrickSqft > 0
      ? { l: 'Brick (excluded from siding)', v: `~${ft(mappedBrickSqft)} sqft`,             hi: false }
      : null,
    // On a mixed-material house most openings are cut into the masonry, so the
    // amount charged against siding is smaller than the total opening area.
    // Showing only one of the two numbers makes the net look wrong.
    (!hasOpeningCountOverride && masonryDeductSqft > 0 && openingTotalSqft > openingSidingSqft + 1)
      ? { l: 'Rough Openings (all walls)', v: `${ft(openingTotalSqft)} sqft · ${windowCalc.total_individual_units} unit${windowCalc.total_individual_units===1?'':'s'}`, hi: false }
      : null,
    hasOpeningCountOverride
      ? {
          l: 'Field count',
          v: `${parsedOpeningCount} opening${parsedOpeningCount === 1 ? '' : 's'} (15 sqft/ea = ${ft(fieldOpeningDeductionSqft)} sqft deducted)`,
          hi: true,
          badge: 'MANUAL OVERRIDE',
        }
      : { l: (masonryDeductSqft > 0 && openingTotalSqft > openingSidingSqft + 1)
          ? 'Openings in Siding Walls'
          : 'Window / Door Deduct',
        v: `−${ft(openingSidingSqft)} sqft${(masonryDeductSqft > 0 && openingTotalSqft > openingSidingSqft + 1) ? '' : ` · ${windowCalc.total_individual_units} unit${windowCalc.total_individual_units===1?'':'s'}`}`,
        hi: false },
    { l: 'Net Siding Area',        v: `~${(netSidingSqft/100).toFixed(2)} SQ`,             hi: true  },
    { l: `+ ${sidingWasteApplied}% Waste (order)`, v: `~${sidingOrderSq} SQ${sidingWasteReason ? ` — ${sidingWasteReason}` : ''}${sidingWasteOverride != null ? ` · rep override ${sidingWasteOverride}% (recommended ${sidingWasteRecommended}%)` : ''}`, hi: false },
    stoneVeneerSqft > 0
      ? { l: 'Stone Veneer',       v: `~${ft(stoneVeneerSqft)} sqft`,                     hi: false }
      : null,
    // Panels, not pairs — a house wearing single shutters is still real scope.
    (finalShutterPanels > 0 || finalShutterPairs > 0)
      ? { l: 'Shutters',           v: `${finalShutterPanels > 0
            ? `${finalShutterPanels} panel${finalShutterPanels===1?'':'s'}`
            : `${finalShutterPairs} pair${finalShutterPairs===1?'':'s'}`} · ~${ft(finalShutterSqft)} sqft`, hi: false }
      : null,
    awningCount > 0
      ? { l: 'Awnings',            v: `${awningCount} · ~${ft(awningSqft)} sqft`,          hi: false }
      : null,
    { l: 'Outside Corners',        v: `${outsideCornersQty} corners · ${outsideCornersLf} LF`, hi: false },
    { l: 'Inside Corners',         v: `${insideCornersQty} corners · ${insideCornersLf} LF`, hi: false },
    { l: 'J-Channel',              v: lfText(jChannelLf), hi: false },
    { l: 'Starter Strip',          v: lfText(starterLf), hi: false },
    { l: 'Wall Perimeter',         v: `${ft(perimeterLf)} LF`,                             hi: false },
    { l: `Roof Perimeter${derivedQ.edgeSource === 'estimated' ? ' (est.)' : ''}`,
                                   v: `${ft(derivedQ.roofPerimeterLf)} LF (eaves+rakes)`,  hi: false },
    { l: `Fascia${derivedQ.edgeSource === 'estimated' ? ' (est.)' : ''}`,
                                   v: `${ft(derivedQ.fasciaLf)} LF`,                       hi: false },
    { l: `Soffit (${sd.soffit_level_depth_ft || derivedQ.overhangFt} ft depth${soffitMeasured ? '' : ', est.'})`,
                                   v: `~${ft(derivedQ.soffitSqft)} sqft`,                  hi: false },
    { l: 'Trim (fascia bd + corners + casing)',
                                   v: `~${ft(derivedQ.trimSqft)} sqft`,                    hi: false },
    missingFaces.length > 0
      ? { l: '⚠️ Not photographed — estimated',
                                   v: missingFaces.map(f => String(f).replace(/_/g, ' ')).join(', '), hi: true }
      : null,
    poorFaces.length > 0
      ? { l: '⚠️ Poor elevation — not used',
                                   v: poorFaces.map(f => String(f).replace(/_/g, ' ')).join(', '), hi: true }
      : null,
    { l: fusedRoof?.was_recalibrated ? '🔄 Fused Roof Area' : 'Roof Area',
                                   v: `~${roofSQ.toFixed(2)} SQ${fusedRoof?.was_recalibrated ? ` (${fusedRoof.detected_pitch})` : ''}`, hi: false },
    { l: `+ ${roofWastePct}% Waste (order)`, v: `~${roofOrderSq} SQ${sa.waste_reason ? ` — ${sa.waste_reason}` : ''}${sa.waste_override_pct != null && sa.waste_override_pct !== '' ? ` · rep override ${sa.waste_override_pct}%` : ''}`, hi: false },
    { l: 'Pitch · Roof Type',      v: `${pitchStr} · ${isHip ? 'Hip' : 'Gable'}`,         hi: false },
    { l: 'Stories · Eave Ht',      v: `${storyCt} stor${storyCt===1?'y':'ies'} · ${storyH} ft`, hi: false },
  ].filter(Boolean);

  const linears=[
    ridgeLf>0?{l:'Ridges',v:ridgeLf}:null, hipLf>0?{l:'Hips',v:hipLf}:null,
    valleyLf>0?{l:'Valleys',v:valleyLf}:null, rakeLf>0?{l:'Rakes',v:rakeLf}:null,
    eaveLf>0?{l:'Eaves',v:eaveLf}:null,
  ].filter(Boolean);

  // ── Data to embed in page ─────────────────────────────────────────────────
  const drawData = {
    W, D, H, P, isHip, poly,
    ridgeLf, hipLf, valleyLf, rakeLf, eaveLf,
  };

  // ── CAD-grade elevation drawings — rendered at generation time by the SAME
  //    shared builder the in-app siding card uses (elevationDrawings.js), so
  //    the printable report and the on-screen drawings can never diverge.
  //    Course lines, corner boards, ticked dimensions, and the amber
  //    "NOT PHOTOGRAPHED — ESTIMATED" banner are baked into the SVG.
  const elevByFace = Object.fromEntries(
    renderElevationSet(sd, sa, { width: 560 }).map(({ model, svg }) => [model.face, { model, svg }])
  );
  const photoByFace = Object.fromEntries(
    (Array.isArray(facePhotos) ? facePhotos : [])
      .filter(photo => photo?.face && photo?.url)
      .map(photo => [photo.face, photo])
  );
  const elevBoxHtml = (face) => {
    const e = elevByFace[face];
    if (!e) return '<div class="cvs-box elev-box"></div>';
    const photo = photoByFace[face];
    const photoHtml = photo
      ? `<div class="elev-photo"><img src="${esc(photo.url)}" alt="${esc(face)} elevation photo" /><span>PHOTO ON FILE</span></div>`
      : '';
    return `<div class="cvs-box elev-box${e.model.photographed ? '' : ' elev-est'}${photo ? ' elev-has-photo' : ''}"><div class="elev-drawing">${e.svg}</div>${photoHtml}</div>`;
  };

  const matRowsHtml = matRows.map(r=>
    `<tr style="background:${r.hi?'#eff6ff':'#fff'}">
      <td style="padding:5px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;color:${r.hi?'#1e3a8a':'#4b5563'};font-weight:${r.hi?700:400}">${esc(r.l)}</td>
      <td style="padding:5px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;font-weight:700;text-align:right;color:${r.hi?'#1e3a8a':'#111'}">${esc(r.v)}${r.badge ? ` <span style="display:inline-block;margin-left:5px;padding:2px 5px;border-radius:3px;background:#fef3c7;color:#92400e;font-size:9px;letter-spacing:.25px">${esc(r.badge)}</span>` : ''}</td>
    </tr>`).join('');

  const linearBarHtml = linears.map(r=>
    `<div class="lbar-cell">
      <div class="lbar-label">${esc(r.l)}</div>
      <div class="lbar-val">${ftStr(r.v)}</div>
    </div>`).join('');

  // ── Inline drawing engine (runs in the report page) ───────────────────────
  const drawingEngine = `
const ISO_C = Math.cos(Math.PI/6);
const ISO_S = Math.sin(Math.PI/6);

function isoPoint(x, y, z, scale, cx, cy) {
  return [cx + (x-z)*ISO_C*scale, cy + (x+z)*ISO_S*scale - y*scale];
}

function fmtFt(n) {
  const t=Math.round(n), f=Math.floor(t), i=Math.round((t-f)*12);
  return i>0 ? f+"' "+i+'"' : f+"'";
}

function dPath(ctx, pts, close) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]);
  if (close!==false) ctx.closePath();
}

// ─── Isometric house drawing ──────────────────────────────────────────────────
function renderIso(canvas, data) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = canvas.clientWidth  * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  const {W, D, H, P, isHip, ridgeLf, hipLf, valleyLf, rakeLf, eaveLf} = data;
  const peak = isHip ? (Math.min(W,D)/2)*(P/12) : (D/2)*(P/12);
  const cw = canvas.clientWidth, ch = canvas.clientHeight;

  const isoW = (W+D)*ISO_C, isoH = (W+D)*ISO_S + H + peak;
  const scale = Math.min((cw*0.70)/isoW, (ch*0.76)/isoH, 10);
  const cx = cw*0.51, cy = ch*0.87;
  const p = (x,y,z) => isoPoint(x,y,z,scale,cx,cy);

  // Key vertices
  const b00=p(0,0,0), b10=p(W,0,0), b11=p(W,0,D), b01=p(0,0,D);
  const t00=p(0,H,0), t10=p(W,H,0), t11=p(W,H,D), t01=p(0,H,D);

  let ridgeL=null, ridgeR=null, apex=null;
  if (isHip) {
    const hh=Math.min(W,D)/2;
    if (W>=D) { ridgeL=p(hh,H+peak,D/2); ridgeR=p(W-hh,H+peak,D/2); }
    else       { ridgeL=p(W/2,H+peak,hh); ridgeR=p(W/2,H+peak,D-hh); }
    if (Math.abs(W-D)<6) { apex=p(W/2,H+peak,D/2); ridgeL=ridgeR=null; }
  } else {
    ridgeL=p(0,H+peak,D/2); ridgeR=p(W,H+peak,D/2);
  }

  // ── Ground shadow ──────────────────────────────────────────────────────────
  ctx.fillStyle='rgba(0,0,0,0.07)';
  dPath(ctx,[b00,b10,b11,b01]);
  ctx.fill();

  // ── Hidden/back edges ─────────────────────────────────────────────────────
  ctx.strokeStyle='#aaa'; ctx.lineWidth=0.6; ctx.setLineDash([4,3]);
  [[b00,b01],[b01,b11],[b01,t01]].forEach(([a,b])=>{
    ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke();
  });
  if (!isHip && ridgeL) {
    ctx.beginPath(); ctx.moveTo(t01[0],t01[1]); ctx.lineTo(ridgeL[0],ridgeL[1]); ctx.stroke();
  }
  ctx.setLineDash([]);

  // ── Left wall face (partial back) ─────────────────────────────────────────
  ctx.fillStyle='rgba(0,0,0,0.04)'; ctx.strokeStyle='#aaa'; ctx.lineWidth=0.7;
  dPath(ctx,[b00,b01,t01,t00]); ctx.fill(); ctx.stroke();

  // ── Gable left triangle (back left) ──────────────────────────────────────
  if (!isHip && ridgeL) {
    ctx.fillStyle='rgba(0,0,0,0.04)'; ctx.strokeStyle='#999'; ctx.lineWidth=0.7;
    dPath(ctx,[t00,ridgeL,t01]); ctx.fill(); ctx.stroke();
  }

  // ── Roof back slopes ──────────────────────────────────────────────────────
  function roofFace(pts, alpha, lw) {
    ctx.fillStyle=\`rgba(0,0,0,\${alpha})\`; ctx.strokeStyle='#111'; ctx.lineWidth=lw;
    dPath(ctx,pts); ctx.fill(); ctx.stroke();
  }

  if (!isHip && ridgeL && ridgeR) {
    roofFace([t01,t11,ridgeR,ridgeL], 0.11, 1.0);  // back slope
    roofFace([t00,t10,ridgeR,ridgeL], 0.04, 1.4);  // front slope (key face)
  } else if (isHip) {
    if (apex) {
      roofFace([t01,t11,apex], 0.12, 1.0);
      roofFace([t11,t10,apex], 0.07, 1.0);
      roofFace([t00,t10,apex], 0.03, 1.5);
      roofFace([t00,t01,apex], 0.07, 0.8);
    } else if (ridgeL&&ridgeR) {
      roofFace([t01,t11,ridgeR,ridgeL], 0.12, 1.0);
      roofFace([t11,t10,ridgeR],        0.07, 1.0);
      roofFace([t00,t10,ridgeR,ridgeL], 0.03, 1.5);
      roofFace([t00,t01,ridgeL],        0.07, 0.8);
    }
  }

  // ── Gable right triangle ──────────────────────────────────────────────────
  if (!isHip && ridgeR) {
    ctx.fillStyle='#fff'; ctx.strokeStyle='#111'; ctx.lineWidth=1.0;
    dPath(ctx,[t10,ridgeR,t11]); ctx.fill(); ctx.stroke();
  }

  // ── Front wall ─────────────────────────────────────────────────────────────
  ctx.fillStyle='#fff'; ctx.strokeStyle='#111'; ctx.lineWidth=1;
  dPath(ctx,[b00,b10,t10,t00]); ctx.fill(); ctx.stroke();

  // Window-like openings on front wall
  const fDx=b10[0]-b00[0], fDy=b10[1]-b00[1];
  const uDx=t00[0]-b00[0], uDy=t00[1]-b00[1];
  function wPt(fx,fy){return[b00[0]+fx*fDx+fy*uDx, b00[1]+fx*fDy+fy*uDy];}
  function drawWin(fx,fy,fw,fh){
    const bl=wPt(fx,fy),br=wPt(fx+fw,fy),tr=wPt(fx+fw,fy+fh),tl=wPt(fx,fy+fh);
    ctx.fillStyle='rgba(185,215,245,0.30)'; ctx.strokeStyle='#333'; ctx.lineWidth=0.9;
    dPath(ctx,[bl,br,tr,tl]); ctx.fill(); ctx.stroke();
    const mc=wPt(fx+fw/2,fy),mt=wPt(fx+fw/2,fy+fh),ml=wPt(fx,fy+fh/2),mr=wPt(fx+fw,fy+fh/2);
    ctx.strokeStyle='#666'; ctx.lineWidth=0.5;
    ctx.beginPath();ctx.moveTo(mc[0],mc[1]);ctx.lineTo(mt[0],mt[1]);ctx.stroke();
    ctx.beginPath();ctx.moveTo(ml[0],ml[1]);ctx.lineTo(mr[0],mr[1]);ctx.stroke();
  }
  function drawDoor(fx,fh){
    const bl=wPt(fx,0),br=wPt(fx+fh*0.43,0),tr=wPt(fx+fh*0.43,fh),tl=wPt(fx,fh);
    ctx.fillStyle='rgba(120,85,55,0.15)'; ctx.strokeStyle='#333'; ctx.lineWidth=0.9;
    dPath(ctx,[bl,br,tr,tl]); ctx.fill(); ctx.stroke();
  }
  drawDoor(0.16, 0.72); drawWin(0.38,0.22,0.13,0.44); drawWin(0.60,0.22,0.13,0.44);

  // ── Right wall ─────────────────────────────────────────────────────────────
  ctx.fillStyle='rgba(250,250,250,0.96)'; ctx.strokeStyle='#111'; ctx.lineWidth=1;
  dPath(ctx,[b10,b11,t11,t10]); ctx.fill(); ctx.stroke();

  // ── Heavy structural lines ─────────────────────────────────────────────────
  ctx.strokeStyle='#111'; ctx.lineWidth=2.0;
  [[b00,b10],[b10,b11],[b00,t00],[b10,t10],[b11,t11],[t00,t10],[t10,t11]].forEach(([a,b])=>{
    ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();
  });
  // Eave (bold)
  ctx.lineWidth=2.5;
  ctx.beginPath();ctx.moveTo(t00[0],t00[1]);ctx.lineTo(t10[0],t10[1]);ctx.stroke();
  // Ridge (boldest)
  if (ridgeL&&ridgeR) {
    ctx.lineWidth=3.0;
    ctx.beginPath();ctx.moveTo(ridgeL[0],ridgeL[1]);ctx.lineTo(ridgeR[0],ridgeR[1]);ctx.stroke();
  }
  // Rake/hip lines
  ctx.lineWidth=1.5;
  if (!isHip&&ridgeL&&ridgeR) {
    [[t00,ridgeL],[t10,ridgeR],[t11,ridgeR]].forEach(([a,b])=>{
      ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();
    });
  } else if (isHip) {
    const corners=[t00,t10,t11,t01];
    const peaks=apex?[apex,apex,apex,apex]:[ridgeL,ridgeR,ridgeR,ridgeL];
    corners.forEach((c,i)=>{if(peaks[i]){ctx.beginPath();ctx.moveTo(c[0],c[1]);ctx.lineTo(peaks[i][0],peaks[i][1]);ctx.stroke();}});
  }

  // ── Callout labels ─────────────────────────────────────────────────────────
  ctx.font='bold 9.5px Arial, sans-serif';
  function callout(fromPt, label, ox, oy, goLeft) {
    if (!fromPt) return;
    const [fx,fy]=fromPt;
    const tx=fx+ox, ty=fy+oy;
    ctx.strokeStyle='#333'; ctx.lineWidth=0.8; ctx.setLineDash([]);
    ctx.beginPath();ctx.moveTo(fx,fy);ctx.lineTo(tx,ty);ctx.stroke();
    const tickX=goLeft?tx-16:tx+16;
    ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(tickX,ty);ctx.stroke();
    ctx.fillStyle='#111'; ctx.textAlign=goLeft?'right':'left';
    ctx.fillText(label, goLeft?tickX-3:tickX+3, ty+3.5);
  }
  if (ridgeLf>0&&ridgeL&&ridgeR){const mx=(ridgeL[0]+ridgeR[0])/2,my=(ridgeL[1]+ridgeR[1])/2;callout([mx,my],\`Ridges: \${fmtFt(ridgeLf)}\`,60,-30,false);}
  if (eaveLf>0){const ex=(t00[0]+t10[0])/2,ey=(t00[1]+t10[1])/2;callout([ex,ey],\`Eaves: \${fmtFt(eaveLf)}\`,-60,35,true);}
  if (rakeLf>0&&!isHip&&ridgeR){const rx=(t10[0]+ridgeR[0])/2,ry=(t10[1]+ridgeR[1])/2;callout([rx,ry],\`Rakes: \${fmtFt(rakeLf)}\`,65,-18,false);}
  if (hipLf>0){const hp=apex||ridgeR;if(hp){const hx=(t10[0]+hp[0])/2,hy=(t10[1]+hp[1])/2;callout([hx,hy],\`Hips: \${fmtFt(hipLf)}\`,65,10,false);}}
  if (valleyLf>0) callout(t01,\`Valleys: \${fmtFt(valleyLf)}\`,-65,20,true);

  // ── Wall height dimension ──────────────────────────────────────────────────
  ctx.strokeStyle='#2563eb'; ctx.lineWidth=0.9;
  const dx=b00[0]-16;
  ctx.beginPath();ctx.moveTo(b00[0]-2,b00[1]);ctx.lineTo(dx-2,b00[1]);ctx.stroke();
  ctx.beginPath();ctx.moveTo(t00[0]-2,t00[1]);ctx.lineTo(dx-2,t00[1]);ctx.stroke();
  ctx.beginPath();ctx.moveTo(dx,b00[1]);ctx.lineTo(dx,t00[1]);ctx.stroke();
  ctx.fillStyle='#2563eb';
  [[dx,b00[1],1],[dx,t00[1],-1]].forEach(([x,y,d])=>{
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-3,y+d*7);ctx.lineTo(x+3,y+d*7);ctx.closePath();ctx.fill();
  });
  const hmy=(b00[1]+t00[1])/2;
  ctx.save();ctx.translate(dx-9,hmy);ctx.rotate(-Math.PI/2);
  ctx.fillStyle='#2563eb';ctx.font='bold 9px Arial';ctx.textAlign='center';
  ctx.fillText(Math.round(H)+' ft',0,4);ctx.restore();
}

// ─── Top-down perimeter layout ────────────────────────────────────────────────
function renderPerimeter(canvas, poly) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio||1;
  canvas.width  = canvas.clientWidth  * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.scale(dpr,dpr);
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.clientWidth,canvas.clientHeight);

  const cw=canvas.clientWidth, ch=canvas.clientHeight;
  const xs=poly.map(([x])=>x), zs=poly.map(([,z])=>z);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
  const bbW=maxX-minX, bbD=maxZ-minZ;
  const PAD=30;
  const sc=Math.min((cw-PAD*2)/bbW, (ch-PAD*2)/bbD, 6);
  const ox=(cw-bbW*sc)/2, oy=(ch-bbD*sc)/2;
  function toS([x,z]){return[ox+(x-minX)*sc, oy+(z-minZ)*sc];}

  // Floor plan
  ctx.fillStyle='rgba(219,234,254,0.45)'; ctx.strokeStyle='#1e3a8a'; ctx.lineWidth=1.8;
  ctx.beginPath();
  toS(poly[0]); ctx.moveTo(...toS(poly[0]));
  poly.forEach(v=>ctx.lineTo(...toS(v)));
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // Edge labels
  ctx.font='bold 8.5px Arial'; ctx.fillStyle='#1e3a8a'; ctx.textAlign='center';
  for(let i=0;i<poly.length;i++){
    const [ax,az]=poly[i],[bx,bz]=poly[(i+1)%poly.length];
    const len=Math.sqrt((bx-ax)**2+(bz-az)**2);
    const [sx,sy]=toS([(ax+bx)/2,(az+bz)/2]);
    const dxC=sx-cw/2, dyC=sy-ch/2;
    const dist=Math.sqrt(dxC**2+dyC**2)||1;
    ctx.fillText(Math.round(len), sx+(dxC/dist)*14, sy+(dyC/dist)*14+3);
  }

  // Overall dims
  const tl=toS([minX,minZ]),tr=toS([maxX,minZ]),bl=toS([minX,maxZ]);
  ctx.strokeStyle='#6b7280'; ctx.lineWidth=0.7; ctx.fillStyle='#6b7280'; ctx.font='7.5px Arial';
  ctx.beginPath();ctx.moveTo(tl[0],ch-10);ctx.lineTo(tr[0],ch-10);ctx.stroke();
  ctx.textAlign='center'; ctx.fillText(Math.round(bbW)+' ft',(tl[0]+tr[0])/2,ch-3);
  ctx.beginPath();ctx.moveTo(8,tl[1]);ctx.lineTo(8,bl[1]);ctx.stroke();
  ctx.save();ctx.translate(5,(tl[1]+bl[1])/2);ctx.rotate(-Math.PI/2);ctx.fillText(Math.round(bbD)+' ft',0,3);ctx.restore();

  // Title
  ctx.fillStyle='#111'; ctx.font='bold 8px Arial'; ctx.textAlign='center';
  ctx.fillText('COMPLEX PERIMETER LAYOUT', cw/2, 11);
  const perim=Math.round(poly.reduce((s,_,i)=>{const[ax,az]=poly[i],[bx,bz]=poly[(i+1)%poly.length];return s+Math.sqrt((bx-ax)**2+(bz-az)**2);},0)*2);
  ctx.fillStyle='#6b7280'; ctx.font='7px Arial';
  ctx.fillText('Total Perimeter: ~'+perim+' ft', cw/2, 20);
}

// ─── Render all ───────────────────────────────────────────────────────────────
function renderAll() {
  renderIso(document.getElementById('iso-canvas'), DRAW_DATA);
  renderPerimeter(document.getElementById('perim-canvas'), DRAW_DATA.poly);
}
window.addEventListener('load', renderAll);
window.addEventListener('beforeprint', renderAll);
window.addEventListener('resize', renderAll);
`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Property Measurement Report — ${esc(addr)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;background:#e5e7eb;color:#111}
    .page{max-width:1120px;margin:0 auto;padding:20px 24px 26px;background:#fff}
    .hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:8px;border-bottom:3px solid #111;margin-bottom:14px}
    .hdr-title{font-size:17px;font-weight:900;letter-spacing:-0.3px}
    .hdr-meta{font-size:10px;color:#374151;margin-top:3px;line-height:1.6}
    .hdr-right{text-align:right;font-size:10px;color:#6b7280;line-height:1.6}
    .slabel{font-size:8.5px;font-weight:800;color:#374151;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:3px}
    .main-grid{display:grid;grid-template-columns:560px 1fr;gap:14px}
    .right-col{display:flex;flex-direction:column;gap:8px}
    .bottom-row{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-top:10px}
    .cvs-box{border:1px solid #d1d5db;border-radius:4px;overflow:hidden;background:#fff}
    canvas{display:block;width:100%;height:100%}
    #iso-canvas{height:380px}
    #perim-canvas{height:160px}
    .elev-box{height:150px;padding:4px 8px;display:flex;align-items:center;justify-content:center;gap:6px}
    .elev-drawing{width:100%;height:100%;min-width:0;display:flex;align-items:center;justify-content:center}
    .elev-has-photo .elev-drawing{width:62%}
    /* !important: the SVG carries inline height:auto for the in-app card; the
       report needs it to FIT the fixed 150px box (aspect kept by viewBox). */
    .elev-drawing svg{width:100%!important;height:100%!important;max-width:none!important}
    .elev-photo{position:relative;width:38%;height:132px;flex:none;overflow:hidden;border:1px solid #cbd5e1;border-radius:3px;background:#f8fafc}
    .elev-photo img{display:block;width:100%;height:100%;object-fit:cover}
    .elev-photo span{position:absolute;left:3px;bottom:3px;padding:2px 4px;border-radius:2px;background:rgba(15,23,42,.78);color:#fff;font-size:6.5px;font-weight:800;letter-spacing:.35px}
    .elev-est{border-style:dashed;border-color:#f59e0b;background:#fffbeb}
    .lbar{display:flex;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;margin-top:5px}
    .lbar-cell{flex:1;padding:5px 8px;background:#f8fafc;border-right:1px solid #e5e7eb;text-align:center}
    .lbar-label{font-size:7.5px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:0.4px}
    .lbar-val{font-size:12px;font-weight:800;color:#1e3a8a;margin-top:1px}
    .sectionhdr{background:#111;color:#fff;padding:5px 10px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px}
    table{border-collapse:collapse;width:100%}
    .print-btn{position:fixed;bottom:18px;right:18px;background:#111;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.3);z-index:999}
    .footer{text-align:center;color:#9ca3af;font-size:8px;margin-top:12px;padding-top:8px;border-top:1px solid #e5e7eb}
    @media print{body{background:#fff}.print-btn{display:none}@page{size:landscape;margin:0.4in}}
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨 Print / Save PDF</button>
  <div class="page">
    <div class="hdr">
      <div>
        ${companyLogoUrl?`<img src="${esc(companyLogoUrl)}" style="max-height:26px;max-width:120px;margin-bottom:4px;object-fit:contain" onerror="this.style.display='none'"/>`:'' }
        <div class="hdr-title">PROPERTY MEASUREMENT REPORT &nbsp;|&nbsp; ${esc(addr)||'Property Address'}</div>
        <div class="hdr-meta">
          Roof Area: ~${roofSQ>0?roofSQ.toFixed(2)+' SQ':ft(W*D)+' sqft (footprint est.)'} &nbsp;|&nbsp;
          Pitch: ${esc(pitchStr)} &nbsp;|&nbsp;
          ${isHip?'Hip':'Gable'} Roof &nbsp;|&nbsp;
          ${storyCt} Stor${storyCt===1?'y':'ies'} × ${storyH}ft &nbsp;|&nbsp;
          Siding: ${netSidingSQ>0?netSidingSQ.toFixed(2)+' SQ':ft(grossSidingSqft)+' sqft'}
        </div>
      </div>
      <div class="hdr-right">
        <div style="font-weight:700;color:#111;font-size:11px">${esc(co)}</div>
        <div>${esc(now)}</div>
        <div>Project #${esc(projId)}</div>
      </div>
    </div>

    <div class="main-grid">
      <div>
        <div class="slabel">Drawings &amp; Key Measurements</div>
        <div class="cvs-box"><canvas id="iso-canvas"></canvas></div>
        <div class="lbar">${linearBarHtml}</div>
      </div>
      <div class="right-col">
        <div>
          <div class="slabel">Front Elevation</div>
          ${elevBoxHtml('front')}
        </div>
        <div>
          <div class="slabel">Rear Elevation</div>
          ${elevBoxHtml('back')}
        </div>
        <div style="border:1px solid #d1d5db;border-radius:4px;overflow:hidden">
          <div class="sectionhdr">Material Type &nbsp;&nbsp; Estimated Area / Qty</div>
          <table>${matRowsHtml}</table>
        </div>
      </div>
    </div>

    <div class="bottom-row">
      <div>
        <div class="slabel">Left Elevation</div>
        ${elevBoxHtml('left')}
      </div>
      <div>
        <div class="slabel">Right Elevation</div>
        ${elevBoxHtml('right')}
      </div>
      <div style="grid-column:span 2">
        <div class="slabel">Complex Perimeter Layout</div>
        <div class="cvs-box"><canvas id="perim-canvas"></canvas></div>
      </div>
    </div>

    <div class="footer">${esc(co)} &bull; Property Measurement Report &bull; ${esc(now)} &bull; Subject to field inspection.</div>
  </div>

  <script>
    const DRAW_DATA = ${JSON.stringify(drawData)};
    ${drawingEngine}
  </script>
</body>
</html>`;
}
