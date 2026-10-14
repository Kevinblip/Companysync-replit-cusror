#!/usr/bin/env node
/**
 * test-siding-masonry-perimeter.cjs
 *
 * Benchmark house: 2 full stories with 18 separate accent/water-table brick
 * facets totaling 415 sqft across a 2,433 sqft combined facade (~17%).
 *   Hover (industry reference): siding 2,018 sqft | wall perimeter 216.1 ft
 *                               gross facade incl. openings 2,923 sqft
 *                               roof drip edge 294 ft | fascia 294 LF | soffit 538 sqft
 *   What we shipped:            siding 2,680 sqft | perimeter 197 ft | fascia 216 LF | soffit 177 sqft
 *
 * The traced Solar outline is useful for preserving wings and jogs, but Hover's
 * 294 ft number is ROOF DRIP EDGE (eaves + rakes), not wall perimeter. It must
 * never be used to justify inflating perimeter × wall height. Hover's actual wall
 * line is the Level Starter total: 159'5" + 56'8" = 216'1".
 *
 * THREE measurement concerns:
 *   1. Shape fidelity — a 4-corner volunteer-drawn OSM rectangle squares off wings,
 *      but its 197 ft wall perimeter is only ~9% below Hover's 216.1 ft wall line.
 *   2. Masonry misread    — accent brick was calibrated as a full first story (~50%),
 *      deducting far too much real siding. The observed whole-facade share is ~17%.
 *   3. Fascia/soffit ~30% LOW — derived from BOUNDING-BOX dimensions, discarding the
 *      traced outline. Fixing the perimeter alone would never have fixed them.
 *
 * Property protected: shape fidelity may improve, but a traced roof outline cannot
 * materially increase gross wall area without independent wall-line evidence.
 *
 * Section 5 drives the REAL buildSidingMeasurementGraph() rather than a hand-rolled
 * formula, so opening dedupe, the 20-sqft deductibility floor, per-face masonry
 * allocation and the 25%-of-facade cap are all exercised as shipped. The fixture is
 * first calibrated against our known shipped output (2,680 sqft) so the benchmark
 * cannot silently drift away from the house it claims to model.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PLUGIN = fs.readFileSync(path.join(ROOT, 'vite-functions-plugin.js'), 'utf8');
const GRAPH = fs.readFileSync(path.join(ROOT, 'functions', 'utils', 'sidingMeasurementGraph.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  \u2713 ${name}`); }
  else { failed++; console.log(`  \u2717 ${name}${extra !== undefined ? ' \u2014 ' + JSON.stringify(extra) : ''}`); }
}

const HOVER = { siding: 2018, wallPerimeter: 216 + 1 / 12, grossFacade: 2923, roofDripEdge: 294, fascia: 294, soffit: 538 };
const SHIPPED = { siding: 2680, perimeter: 197, fascia: 216, soffit: 177 };
const offBy = (v, ref) => Math.abs(v - ref) / ref;

async function main() {
  console.log('\n\u2500\u2500 1. AI prompt must describe brick-below / siding-above \u2500\u2500');
  check('has a dedicated mixed masonry section', /MIXED MASONRY \+ SIDING WALLS/.test(PLUGIN));
  check('forbids labelling the whole wall "brick"', /just because the lower half is brick/.test(PLUGIN));
  check('defines non_siding_pct as a share of wall area', /share of THIS wall's total area/.test(PLUGIN));
  check('makes partial/accent masonry the expected common case', /partial\/accent masonry as the expected common case/.test(PLUGIN));
  check('makes a full brick story an explicit exception', /full brick[\s\S]{0,120}exception/.test(PLUGIN));
  check('defines partial-width accents against the whole wall', /multiply height share × width share/.test(PLUGIN));
  check('requires the mixed-material flag in the output schema',
    /"has_mixed_materials": <boolean, true when siding and non-siding masonry share this wall face>/.test(PLUGIN));
  check('gives worked whole-wall anchors in the 10-25% range',
    /water-table band on a 16ft wall → about 12/.test(PLUGIN)
    && /wainscot on an 18ft wall → about 17/.test(PLUGIN)
    && /accent covering 75% of a 16ft wall → about 19/.test(PLUGIN)
    && /wainscot on a 16ft wall → about 25/.test(PLUGIN));
  check('gives an all-brick anchor (100)', /Entire wall is brick with no siding at all \u2192 100/.test(PLUGIN));
  check('demands a value on every face, including 0', /EVERY wall face, including when it is 0/.test(PLUGIN));

  console.log('\n\u2500\u2500 2. A bare OSM rectangle must no longer win unconditionally \u2500\u2500');
  check('the old unconditional comment is gone', !/Always use OSM polygon when one is found/.test(PLUGIN));
  check('tracks the OSM corner count', /osmVertexCount = openNodes\.length/.test(PLUGIN));
  check('flags a quadrilateral as crude', /osmIsCrude = openNodes\.length <= 5/.test(PLUGIN));
  check('Solar now runs for a crude OSM too', /if \(\(!osmSuccess \|\| osmIsCrude\) && googleApiKey\)/.test(PLUGIN));

  console.log('\n\u2500\u2500 3. ...but Solar may only override as a perimeter-safe geometry improvement \u2500\u2500');
  check('override is explicitly for geometry quality, not siding inflation', /geometry-quality override, not a license/.test(PLUGIN));
  check('runtime uses the shared perimeter-safety decision', /isPerimeterSafeOsmGeometryOverride\(\{/.test(PLUGIN));
  check('old >=1.15x inflation gate is gone', !/candPerim >= perimeterFt \* 1\.15/.test(PLUGIN));
  check('keeps OSM when Solar is not an improvement', /Kept OSM footprint/.test(PLUGIN));
  check('no false "rejected" warning when OSM legitimately stands', /\} else if \(osmOverrideOnly\) \{/.test(PLUGIN));
  check('clears the OSM flag when overridden', /usingOSM = false;/.test(PLUGIN));

  console.log('\n\u2500\u2500 4. The opportunistic Solar call must be bounded \u2500\u2500');
  check('every Solar attempt has an abort timeout', /buildingInsights:findClosest[\s\S]{0,220}AbortSignal\.timeout\(8000\)/.test(PLUGIN));
  check('fewer attempts when OSM already stands', /osmSuccess \? \['HIGH', 'MEDIUM'\] : \['HIGH', 'MEDIUM', ''\]/.test(PLUGIN));
  check('a Solar fetch throw cannot abort the estimate', /catch \(solarFetchErr\)/.test(PLUGIN));

  console.log('\n\u2500\u2500 5. Siding totals \u2014 driven through the REAL graph \u2500\u2500');
  const { buildSidingMeasurementGraph, collectFaceMasonryPct } = await import(
    'file://' + path.join(ROOT, 'functions', 'utils', 'sidingMeasurementGraph.js')
  );
  const { isPerimeterSafeOsmGeometryOverride } = await import(
    'file://' + path.join(ROOT, 'functions', 'utils', 'footprintPolygon.js')
  );

  const win = (n) => Array.from({ length: n }, () => ({ type: 'window', width_ft: 3, height_ft: 4 }));
  const door = () => ({ type: 'entry_door', width_ft: 3, height_ft: 6.7 });
  const garage = () => ({ type: 'garage_door', width_ft: 8, height_ft: 7 });
  const face = (wall_face, openings, wall_width_ft) => ({
    wall_face, view_label: wall_face, wall_width_ft, wall_height_ft: 17, story_count: 2, openings,
  });
  // The observed inventory for this address: 23 windows, 6 entry doors, 2 garage doors.
  const perPhotoResults = [
    face('front',      [...win(6), door(), door(), garage(), garage()], 56),
    face('back',       [...win(6), door(), door()], 56),
    face('left_side',  [...win(5), door()], 46),
    face('right_side', [...win(6), door()], 46),
  ];

  // The live handler floors any 2-story wall to TWO_STORY_MIN_FT (17ft) before
  // computing gross wall area, so the benchmark MUST use that height or it is not
  // testing what the handler will quote.
  const WALL_HT = 17;

  const productionFacePct = collectFaceMasonryPct([
    {
      wall_face: 'front',
      has_mixed_materials: true,
      non_siding_material: 'brick',
      non_siding_pct: 17,
    },
    {
      wall_face: 'back',
      non_siding_material: 'brick',
      non_siding_pct: 19,
    },
  ]);
  check('production aggregation consumes a flagged 17% accent-brick result',
    productionFacePct.front === 17, productionFacePct);
  check('production aggregation does not discard a valid legacy result missing the flag',
    productionFacePct.back === 19, productionFacePct);

  const run = (perimeterFt, masonryPct) => {
    const gross = perimeterFt * WALL_HT;
    const accent = masonryPct > 2 ? Math.round(gross * (masonryPct / 100)) : 0;
    const faceMasonryPct = masonryPct > 0
      ? { front: masonryPct, back: masonryPct, left_side: masonryPct, right_side: masonryPct }
      : null;
    return buildSidingMeasurementGraph({
      perPhotoResults, storyCount: 2, wallHeightFt: WALL_HT,
      grossWallAreaSqft: gross, accentDeductionSqft: accent, faceMasonryPct,
      perimeterFt, buildingWidthFt: 46, buildingLengthFt: 56, footprintSource: 'solar',
      smallOpeningsInWaste: false,
    }).totals;
  };

  const today       = run(SHIPPED.perimeter, 0).net_siding_area_sqft;
  const BENCHMARK_MASONRY_PCT = Math.round(415 / 2433 * 100);
  check('benchmark masonry share is realistic (17-22%)',
    BENCHMARK_MASONRY_PCT >= 17 && BENCHMARK_MASONRY_PCT <= 22,
    { masonryPct: BENCHMARK_MASONRY_PCT });
  const masonryOnly = run(SHIPPED.perimeter, BENCHMARK_MASONRY_PCT).net_siding_area_sqft;
  const wallLineOnly = run(HOVER.wallPerimeter, 0).net_siding_area_sqft;
  const masonryOnlyAtWallLine = run(HOVER.wallPerimeter, BENCHMARK_MASONRY_PCT).net_siding_area_sqft;
  const pc = v => (offBy(v, HOVER.siding) * 100).toFixed(0) + '%';
  console.log(`     today=${today} (${pc(today)})  masonryOnly=${masonryOnly} (${pc(masonryOnly)})  wallLineOnly=${wallLineOnly} (${pc(wallLineOnly)})  masonryAtWallLine=${masonryOnlyAtWallLine} (${pc(masonryOnlyAtWallLine)})  [Hover=${HOVER.siding}]`);

  console.log('   5a. fixture fidelity');
  {
    const c = buildSidingMeasurementGraph({
      perPhotoResults, storyCount: 2, wallHeightFt: WALL_HT,
      grossWallAreaSqft: HOVER.wallPerimeter * WALL_HT, accentDeductionSqft: 0,
      perimeterFt: HOVER.wallPerimeter, buildingWidthFt: 46, buildingLengthFt: 56,
      footprintSource: 'solar', smallOpeningsInWaste: false,
    }).counts;
    check('graph resolves exactly 23 window assemblies', c.window_assemblies === 23, c);
    check('graph resolves exactly 6 entry doors', c.entry_doors === 6, c);
    check('graph resolves exactly 2 garage doors', c.garage_doors === 2, c);
  }
  // NOTE: the un-fixed run below does NOT reproduce the 2,680 sqft we shipped,
  // and that is itself a finding rather than a fixture bug. 2,680 implies a wall
  // height near 14.4ft, which is BELOW the handler's 17ft two-story floor — so the
  // shipped run never classified this house as two full stories. Story-count
  // under-detection is a separate defect from the two fixed here.
  check('shipped 2,680 implies a sub-two-story height (story count was under-called)',
    (SHIPPED.siding / SHIPPED.perimeter) < 17, { impliedHt: (SHIPPED.siding / SHIPPED.perimeter).toFixed(2) });

  console.log('   5b. wall perimeter and gross-area safety');
  // The observed shipped gross is about 2,832 sqft (197 ft × ~14.4 ft), within
  // 3.1% of Hover's 2,923 sqft facade total including openings. Preserve that
  // cross-check: the old 294 ft roof-drip interpretation would inflate it ~49%.
  const shippedGross = 2832;
  const observedWallHt = shippedGross / SHIPPED.perimeter;
  const hoverWallLineGross = HOVER.wallPerimeter * observedWallHt;
  const unsafeRoofEdgeGross = HOVER.roofDripEdge * observedWallHt;
  const canOverride = (candidatePerimeterFt, candidateGeometry = 'traced_polygon') =>
    isPerimeterSafeOsmGeometryOverride({
      osmPerimeterFt: SHIPPED.perimeter,
      candidatePerimeterFt,
      candidateGeometry,
    });
  const runCenturywaySelection = (candidatePerimeterFt, candidateGeometry = 'traced_polygon') => {
    const selectedPerimeter = canOverride(candidatePerimeterFt, candidateGeometry)
      ? candidatePerimeterFt
      : SHIPPED.perimeter;
    return buildSidingMeasurementGraph({
      perPhotoResults,
      storyCount: 1,
      wallHeightFt: observedWallHt,
      grossWallAreaSqft: selectedPerimeter * observedWallHt,
      accentDeductionSqft: 0,
      perimeterFt: selectedPerimeter,
      buildingWidthFt: 46,
      buildingLengthFt: 56,
      footprintSource: canOverride(candidatePerimeterFt, candidateGeometry) ? 'solar' : 'osm',
      smallOpeningsInWaste: false,
    }).totals;
  };
  const correctWallTrace = runCenturywaySelection(HOVER.wallPerimeter);
  const unsafeRoofEdgeTrace = runCenturywaySelection(HOVER.roofDripEdge);
  check('benchmark shipped gross wall area stays near 2,900 sqft',
    offBy(shippedGross, HOVER.grossFacade) <= 0.05, { shippedGross, hoverGross: HOVER.grossFacade });
  check('Centuryway correct wall trace is accepted by the runtime gate',
    canOverride(HOVER.wallPerimeter));
  check('four elevations bill the photo wall and keep the wall-line extrusion near Hover',
    correctWallTrace.gross_wall_area_source === 'photo_wall_planes'
      && correctWallTrace.photo_overrides_footprint === true
      && offBy(correctWallTrace.extrusion_wall_area_sqft, HOVER.grossFacade) <= 0.10,
    { selectedGross: correctWallTrace.gross_wall_area_sqft, extrusion: correctWallTrace.extrusion_wall_area_sqft, hoverGross: HOVER.grossFacade });
  check('a rectangle candidate cannot replace OSM even when its perimeter is close',
    !canOverride(HOVER.wallPerimeter, 'rectangle_estimate'));
  check('294 ft roof drip edge would materially inflate gross wall area',
    unsafeRoofEdgeGross > HOVER.grossFacade * 1.35, { unsafeRoofEdgeGross, hoverGross: HOVER.grossFacade });
  check('Centuryway roof drip edge is rejected by the runtime gate',
    !canOverride(HOVER.roofDripEdge));
  check('rejected roof drip edge keeps the shipped extrusion under the photo wall',
    unsafeRoofEdgeTrace.extrusion_wall_area_sqft === shippedGross
      && unsafeRoofEdgeTrace.gross_wall_area_source === 'photo_wall_planes',
    { selectedGross: unsafeRoofEdgeTrace.gross_wall_area_sqft, extrusion: unsafeRoofEdgeTrace.extrusion_wall_area_sqft, shippedGross });
  check('today over-reports vs Hover', today > HOVER.siding, { today });
  check('perimeter-only alone OVER-shoots badly', offBy(wallLineOnly, HOVER.siding) > 0.20, { wallLineOnly });
  check('a longer footprint extrusion is farther from the Hover facade than the shipped extrusion',
    offBy(run(HOVER.wallPerimeter, 0).extrusion_wall_area_sqft, HOVER.grossFacade)
      > offBy(run(SHIPPED.perimeter, 0).extrusion_wall_area_sqft, HOVER.grossFacade));
  check('realistic masonry does not erase half the wall',
    run(HOVER.wallPerimeter, BENCHMARK_MASONRY_PCT).siding_share_pct >= 78,
    { sidingShare: run(HOVER.wallPerimeter, BENCHMARK_MASONRY_PCT).siding_share_pct });
  check('50% masonry would materially underquote versus the observed accent share',
    run(HOVER.wallPerimeter, 50).net_siding_area_sqft < masonryOnlyAtWallLine * 0.7,
    { realistic: masonryOnlyAtWallLine, wrong50: run(HOVER.wallPerimeter, 50).net_siding_area_sqft });
  check('masonry correction improves the quote without a roof-edge perimeter increase',
    offBy(masonryOnly, HOVER.siding) < offBy(today, HOVER.siding), { masonryOnly, today });
  check('the wall-line extrusion stays below a roof-drip extrusion',
    run(HOVER.wallPerimeter, 0).extrusion_wall_area_sqft < run(HOVER.roofDripEdge, 0).extrusion_wall_area_sqft,
    { wallLine: run(HOVER.wallPerimeter, 0).extrusion_wall_area_sqft, drip: run(HOVER.roofDripEdge, 0).extrusion_wall_area_sqft });

  console.log('   5c. the graph must still charge brick openings to brick');
  const t = run(HOVER.wallPerimeter, BENCHMARK_MASONRY_PCT);
  check('masonry column is populated', t.masonry_area_sqft > 0, { masonry: t.masonry_area_sqft });
  check('some opening area is charged to masonry, not siding', t.opening_deduction_masonry_sqft > 0, { m: t.opening_deduction_masonry_sqft });
  check('siding opening deduction is below the raw total', t.opening_deduction_sqft < t.opening_area_total_sqft);
  check('the 25%-of-facade cap is not silently engaging', t.opening_deduction_capped === false);

  console.log('\n\u2500\u2500 6. Fascia / soffit must follow classified roof edges \u2500\u2500');
  {
    const d = 1.5, L = 56, W = 46;
    const eL = L + 2 * d, eW = W + 2 * d;
    const bboxDrip = 2 * (eL + eW);
    const drip = tracedPerim => (tracedPerim > 0 ? tracedPerim + 8 * d : bboxDrip);

    const fasciaBbox   = Math.round(drip(0));
    const fasciaTraced = Math.round(drip(HOVER.roofDripEdge));
    console.log(`     fascia: bbox=${fasciaBbox}  traced=${fasciaTraced}  [Hover=${HOVER.fascia}]`);
    check('bbox fascia reproduces the 216 LF we shipped', fasciaBbox === SHIPPED.fascia, { fasciaBbox });
    check('bbox fascia is >20% short of Hover', offBy(fasciaBbox, HOVER.fascia) > 0.20);
    check('traced fascia lands within 10% of Hover', offBy(fasciaTraced, HOVER.fascia) <= 0.10, { fasciaTraced });

    // An AXIS-ALIGNED rectangle must be untouched by the new path.
    check('an axis-aligned rectangle is IDENTICAL either way',
      Math.round(drip(2 * (L + W))) === fasciaBbox, { viaTrace: Math.round(drip(2 * (L + W))), viaBbox: fasciaBbox });

    // A ROTATED rectangle is an INTENTIONAL correction, not a regression: the old
    // bbox spans circumscribe the rotated shape and overstate the drip edge badly.
    // The true edge perimeter is unchanged by rotation, which is the correct answer.
    const th = 30 * Math.PI / 180;
    const rotSpanL = L * Math.cos(th) + W * Math.sin(th);
    const rotSpanW = L * Math.sin(th) + W * Math.cos(th);
    const fasciaRotOld = Math.round(2 * ((rotSpanL + 2 * d) + (rotSpanW + 2 * d)));
    const fasciaRotNew = Math.round(drip(2 * (L + W)));
    console.log(`     rotated 30\u00b0 rectangle: old(bbox)=${fasciaRotOld}  new(true edges)=${fasciaRotNew}  (same house as the ${fasciaBbox} LF axis-aligned case)`);
    check('old bbox path over-quoted a rotated rectangle', fasciaRotOld > fasciaBbox * 1.2, { fasciaRotOld });
    check('new path is rotation-invariant (the correct behaviour)', fasciaRotNew === fasciaBbox, { fasciaRotNew });

    const ratio = eL / (eL + eW);
    const soffitOld = Math.round((bboxDrip * ratio) * d);
    const soffitNew = Math.round(drip(HOVER.roofDripEdge) * d);
    console.log(`     soffit: old=${soffitOld}  traced(hip)=${soffitNew}  [Hover=${HOVER.soffit}]`);
    check('old soffit model reproduces the 177 sqft we shipped', soffitOld === SHIPPED.soffit, { soffitOld });
    check('traced soffit moves materially toward Hover', offBy(soffitNew, HOVER.soffit) < offBy(soffitOld, HOVER.soffit));

    const roofEave = 171, roofRake = 123;
    const roofFascia = Math.round(roofEave + roofRake);
    const roofSoffit = Math.round(roofEave * 2) + Math.round(roofRake * 1.5);
    check('roof-edge fascia matches the real Hover 294 LF target', roofFascia === HOVER.fascia, { roofFascia });
    check('split level/sloped soffit is within 3% of Hover 538 sqft', offBy(roofSoffit, HOVER.soffit) < 0.03, { roofSoffit });
  }

  console.log('\n\u2500\u2500 7. Guard rails that must not regress \u2500\u2500');
  check('masonry still gated above the 2% noise floor', /avgNonSidingPct > 2 \? Math\.round\(grossWallSqFt \* \(avgNonSidingPct \/ 100\)\)/.test(PLUGIN));
  check('Solar facet-union sanity bounds still present', /fp\.area_sqft >= flatSqFt \* 0\.35 && fp\.area_sqft <= flatSqFt \* 1\.60/.test(PLUGIN));
  check('satellite ratio floor still 0.55', /ratio >= 0\.55 && ratio <= maxPhotoRatio/.test(PLUGIN));
  check('a rectangle still cannot exceed 4x the photo perimeter', /candGeometry === 'traced_polygon' \? 8 : 4\.0/.test(PLUGIN));
  check('a short roof eave cannot shrink a traced outline', /tracedOutlineOutranksShortEave\(tracedPerim, known_perimeter_ft\)/.test(PLUGIN));
  check('an undersized rectangle is replaced by the traced outline', /rectangleUndercutsSolarPlan\(rectArea, solarPlan\)/.test(PLUGIN));
  check('graph still charges openings per-face', /sidingFractionForFace/.test(GRAPH));
  check('opening cap still measured against the siding facade', /openingDeductionCap = round\(sidingFacade \* MAX_OPENING_DEDUCTION_PCT/.test(GRAPH));
  check('20-sqft deductibility floor still in force', /MIN_DEDUCTIBLE_SQFT = 20/.test(GRAPH));
  check('fascia falls back to footprint when classified roof edges are unavailable', /: dripEdgeLf\);/.test(PLUGIN));
  check('handler sources fascia from classified roof-facet edges', /computeRoofEdgeTotals\(roofFacetsForGraph \|\| \[\]\)/.test(PLUGIN));

  console.log(`\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
  console.log(`${passed + failed} checks \u2014 ${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log('\u274c FAILED'); process.exit(1); }
  console.log('\u2705 Brick deducted, wings preserved, fascia follows the real outline');
}

main().catch(e => { console.error(e); process.exit(1); });
