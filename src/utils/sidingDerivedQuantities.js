/**
 * sidingDerivedQuantities.js — derived exterior quantities for the photo-siding
 * measurement path.
 *
 * Fascia, soffit, trim, and true roof perimeter were historically displayed from
 * stale/legacy fields that no code path ever computed (they showed whatever old
 * estimate data was lying around). This module derives them from measurements we
 * actually have:
 *
 *   fascia / roof perimeter = eave LF + rake LF   (the roof's full drip edge)
 *   soffit                  = level eave LF × level depth
 *                           + sloped rake LF × sloped depth
 *   trim                    = fascia board face + corner boards + opening casing
 *
 * Everything is a pure function of its inputs so the on-screen summary card and
 * the printable HTML report always agree.
 */

export const DEFAULT_OVERHANG_FT = 1.5;

// Trim face-width assumptions (ft of visible board face per LF of board):
const FASCIA_BOARD_FACE_FT = 0.5;   // 6" fascia board
const CORNER_BOARD_FACE_FT = 0.58;  // two ~3.5" faces per outside corner
const CASING_FACE_FT       = 0.29;  // ~3.5" casing around openings

const DEFAULT_OPENING_DIMS = {
  window:      { w: 3,  h: 4   },
  entry_door:  { w: 3,  h: 6.8 },
  door:        { w: 3,  h: 6.8 },
  garage_door: { w: 16, h: 7   },
};

function openingPerimeterLf(o) {
  const p = Number(o?.perimeter_lf);
  if (p > 0) return p;
  const dims = DEFAULT_OPENING_DIMS[o?.type] || DEFAULT_OPENING_DIMS.window;
  const w = Number(o?.width_ft  ?? o?.width)  || dims.w;
  const h = Number(o?.height_ft ?? o?.height) || dims.h;
  return 2 * (w + h);
}

/**
 * Resolve the roof edges that all siding quantity consumers must use.
 *
 * The siding photo handler's classified facet edges are canonical when present:
 * unlike older satellite-analysis linears, their rake lengths are measured in 3D
 * and therefore include pitch. Satellite values remain the fallback for saved
 * measurements that predate roof-edge classification.
 */
export function resolveSidingRoofEdges(sidingMeasurement = {}, satelliteAnalysis = {}) {
  const facetEdges = sidingMeasurement?.roof_edge_source === 'roof_facets';
  const sidingEave = Number(sidingMeasurement?.eave_lf) || 0;
  const sidingRake = Number(sidingMeasurement?.rake_lf) || 0;
  if (facetEdges && sidingEave > 0) {
    return {
      eaveLf: sidingEave,
      rakeLf: sidingRake,
      source: 'roof_facets',
    };
  }
  return {
    eaveLf: Number(satelliteAnalysis?.eave_lf) || sidingEave,
    rakeLf: Number(satelliteAnalysis?.rake_lf) || sidingRake,
    source: (Number(satelliteAnalysis?.eave_lf) || Number(satelliteAnalysis?.rake_lf))
      ? 'satellite_analysis'
      : (sidingEave || sidingRake ? 'siding_fallback' : 'unavailable'),
  };
}

/**
 * @param {object} [args]
 * @param {number} [args.eaveLf]           eave (gutter-line) linear feet, if MEASURED (pass 0 when unknown — never a geometric guess, or the 'estimated' label is lost)
 * @param {number} [args.rakeLf]           rake (sloped gable edge) linear feet, if MEASURED
 * @param {number} [args.perimeterLf]      wall/footprint perimeter (fallback basis)
 * @param {number} [args.wallHeightFt]     TOTAL wall height (analyzer's story_height_ft is already total: stories × per-story)
 * @param {number} [args.outsideCornersCount]  outside corner count (default 4)
 * @param {Array}  [args.openings]         openings_detail / opening groups
 * @param {number} [args.overhangFt]       eave overhang depth (default DEFAULT_OVERHANG_FT)
 * @param {number} [args.levelSoffitDepthFt]  level/eave soffit depth (defaults to overhangFt)
 * @param {number} [args.slopedSoffitDepthFt] sloped/rake soffit depth (defaults to overhangFt)
 * @param {boolean}[args.hipRoof]          hip roofs carry eaves (and soffit) on all sides
 * @returns {{ fasciaLf:number, roofPerimeterLf:number, soffitSqft:number,
 *             trimSqft:number, trimBreakdown:object, overhangFt:number,
 *             eaveLfUsed:number, rakeLfUsed:number, soffitBreakdown:object,
 *             edgeSource:'measured'|'estimated' }}
 */
export function computeDerivedExteriorQuantities({
  eaveLf = 0,
  rakeLf = 0,
  perimeterLf = 0,
  wallHeightFt = 0,
  outsideCornersCount = 4,
  openings = [],
  overhangFt,
  levelSoffitDepthFt,
  slopedSoffitDepthFt,
  hipRoof = false,
} = {}) {
  const oh = Number(overhangFt) > 0 ? Number(overhangFt) : DEFAULT_OVERHANG_FT;
  const levelDepth = Number(levelSoffitDepthFt) > 0 ? Number(levelSoffitDepthFt) : oh;
  const slopedDepth = Number(slopedSoffitDepthFt) > 0 ? Number(slopedSoffitDepthFt) : oh;
  const eave = Number(eaveLf) || 0;
  const rake = Number(rakeLf) || 0;
  const perim = Number(perimeterLf) || 0;

  // Roof perimeter = the full drip edge: eaves + rakes. "Measured" requires a
  // COMPLETE edge set for the roof type — a gable roof necessarily has both
  // eaves and rakes, so eave-only (or rake-only) data is partial: fill the
  // missing component from the measured one and label the result estimated,
  // or it underreports while masquerading as measured.
  //   rake ≈ 0.45 × eave for typical gable proportions (L≈1.6–2.6×W, 4–8/12).
  const complete = hipRoof ? eave > 0 : (eave > 0 && rake > 0);
  let eaveM = eave, rakeM = rake;
  if (!complete && !hipRoof) {
    if (eave > 0 && rake === 0) rakeM = Math.round(eave * 0.45);
    else if (rake > 0 && eave === 0) eaveM = Math.round(rake * 2.2);
  }
  const edgeSource = complete ? 'measured' : 'estimated';
  const roofPerimeterLf = (eaveM + rakeM) > 0
    ? Math.round(eaveM + rakeM)
    : Math.round(perim * 1.15); // no edges at all: gable allowance over wall perimeter

  // Fascia runs along the entire drip edge (eaves AND rakes).
  const fasciaLf = roofPerimeterLf;

  // Hover-style soffit reports split level frieze beneath eaves from sloped
  // frieze beneath rakes. Keep the depths independent because gable returns are
  // commonly shallower than the main eave overhang.
  const eaveLfUsed = eaveM > 0 ? eaveM : Math.round(perim * (hipRoof ? 1 : 0.65));
  const rakeLfUsed = hipRoof ? 0 : rakeM;
  const levelSoffitSqft = Math.round(eaveLfUsed * levelDepth);
  const slopedSoffitSqft = Math.round(rakeLfUsed * slopedDepth);
  const soffitSqft = levelSoffitSqft + slopedSoffitSqft;

  // Trim = fascia board face + corner boards + opening casing.
  const corners = Math.max(0, Number(outsideCornersCount) || 4);
  const H = Number(wallHeightFt) || 0;
  const fasciaTrimSqft  = fasciaLf * FASCIA_BOARD_FACE_FT;
  const cornerTrimSqft  = corners * H * CORNER_BOARD_FACE_FT;
  const openingTrimLf   = (Array.isArray(openings) ? openings : [])
    .reduce((s, o) => s + openingPerimeterLf(o), 0);
  const casingTrimSqft  = openingTrimLf * CASING_FACE_FT;
  const trimSqft = Math.round(fasciaTrimSqft + cornerTrimSqft + casingTrimSqft);

  return {
    fasciaLf,
    roofPerimeterLf,
    soffitSqft,
    trimSqft,
    trimBreakdown: {
      fascia_board_sqft: Math.round(fasciaTrimSqft),
      corner_boards_sqft: Math.round(cornerTrimSqft),
      opening_casing_sqft: Math.round(casingTrimSqft),
    },
    overhangFt: oh,
    eaveLfUsed,
    rakeLfUsed,
    soffitBreakdown: {
      level_sqft: levelSoffitSqft,
      sloped_sqft: slopedSoffitSqft,
      level_depth_ft: levelDepth,
      sloped_depth_ft: slopedDepth,
    },
    edgeSource,
  };
}
