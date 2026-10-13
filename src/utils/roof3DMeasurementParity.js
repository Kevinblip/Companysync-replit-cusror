/**
 * Measurement contract for the 3D estimator preview.
 *
 * The viewer is allowed to approximate topology, but it must be honest about
 * the quantities it is showing. Keep these checks independent of Three.js so
 * the same contract can be exercised by the regression test and by the UI.
 */

export const ROOF_3D_PARITY_TOLERANCE_PCT = 5;

const finiteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function triangleSurfaceArea(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  return Math.hypot(...cross) / 2;
}

/**
 * Calculate the surface area of a non-indexed triangle-list position array.
 * The roof builders all emit this format, which lets us verify the geometry
 * that was actually created rather than trusting source metadata.
 */
export function positionArraySurfaceArea(vertices) {
  if (!vertices || vertices.length < 9) return 0;
  let area = 0;
  for (let i = 0; i + 8 < vertices.length; i += 9) {
    area += triangleSurfaceArea(
      [vertices[i], vertices[i + 1], vertices[i + 2]],
      [vertices[i + 3], vertices[i + 4], vertices[i + 5]],
      [vertices[i + 6], vertices[i + 7], vertices[i + 8]],
    );
  }
  return area;
}

export function lineLength(from, to) {
  return Math.hypot(
    Number(to?.[0]) - Number(from?.[0]),
    Number(to?.[1]) - Number(from?.[1]),
    Number(to?.[2]) - Number(from?.[2]),
  );
}

/**
 * Fit visual roof vertices to an authoritative slope-area total without moving
 * their wall-plate footprint. The caller supplies one non-indexed triangle list
 * per rendered roof mesh. Scaling only Y above wallHeight preserves measured
 * wall height and plan linears; a decorative eave overhang is therefore never
 * counted as an estimate linear.
 */
export function fitRoofSurfaceArraysToArea({
  surfaceArrays = [],
  wallHeightFt,
  targetAreaSqft,
} = {}) {
  const target = finiteNumber(targetAreaSqft);
  const wallHeight = finiteNumber(wallHeightFt);
  const originals = surfaceArrays
    .filter(vertices => vertices?.length >= 9)
    .map(vertices => Array.from(vertices, Number));
  const areaAt = (riseScale) => originals.reduce((sum, vertices) => {
    const scaled = vertices.map((value, index) => (
      index % 3 === 1 ? wallHeight + (value - wallHeight) * riseScale : value
    ));
    return sum + positionArraySurfaceArea(scaled);
  }, 0);
  const currentAreaSqft = areaAt(1);

  if (!target || target <= 0 || wallHeight == null || originals.length === 0) {
    return { applied: false, areaSqft: currentAreaSqft, riseScale: 1, surfaceArrays: originals };
  }

  const flatAreaSqft = areaAt(0);
  // No pitch-only transform can reduce below the horizontal footprint. Keep the
  // mesh honest and let the dev parity warning report bad source data.
  if (target < flatAreaSqft * 0.999) {
    return {
      applied: false,
      reason: 'target_below_plan_area',
      areaSqft: currentAreaSqft,
      flatAreaSqft,
      riseScale: 1,
      surfaceArrays: originals,
    };
  }

  let low = 0;
  let high = 1;
  while (areaAt(high) < target && high < 64) high *= 2;
  if (areaAt(high) < target) {
    return {
      applied: false,
      reason: 'target_unreachable',
      areaSqft: currentAreaSqft,
      flatAreaSqft,
      riseScale: 1,
      surfaceArrays: originals,
    };
  }

  for (let step = 0; step < 32; step++) {
    const midpoint = (low + high) / 2;
    if (areaAt(midpoint) < target) low = midpoint;
    else high = midpoint;
  }
  const riseScale = (low + high) / 2;
  const fittedArrays = originals.map(vertices => vertices.map((value, index) => (
    index % 3 === 1 ? wallHeight + (value - wallHeight) * riseScale : value
  )));
  return {
    applied: true,
    areaSqft: fittedArrays.reduce((sum, vertices) => sum + positionArraySurfaceArea(vertices), 0),
    flatAreaSqft,
    riseScale,
    surfaceArrays: fittedArrays,
  };
}

export function compareRoof3DMeasurements({
  rendered = {},
  summary = {},
  tolerancePct = ROOF_3D_PARITY_TOLERANCE_PCT,
} = {}) {
  const expected = {
    facetCount: finiteNumber(summary.facetCount),
    roofSurfaceAreaSqft: finiteNumber(summary.roofSurfaceAreaSqft ?? summary.roofAreaSqft),
    eaveLf: finiteNumber(summary.eaveLf),
    ridgeLf: finiteNumber(summary.ridgeLf),
    wallHeightFt: finiteNumber(summary.wallHeightFt),
  };
  const actual = {
    facetCount: finiteNumber(rendered.facetCount),
    roofSurfaceAreaSqft: finiteNumber(rendered.roofSurfaceAreaSqft),
    eaveLf: finiteNumber(rendered.eaveLf),
    ridgeLf: finiteNumber(rendered.ridgeLf),
    wallHeightFt: finiteNumber(rendered.wallHeightFt),
  };

  const checks = [];
  const addCheck = (key, label, exact = false) => {
    if (expected[key] == null || actual[key] == null || expected[key] <= 0) return;
    const difference = Math.abs(actual[key] - expected[key]);
    const percent = expected[key] === 0 ? 0 : (difference / expected[key]) * 100;
    const pass = exact ? actual[key] === expected[key] : percent <= tolerancePct;
    checks.push({
      key,
      label,
      expected: expected[key],
      actual: actual[key],
      difference,
      percent,
      pass,
    });
  };

  addCheck('facetCount', 'roof facet count', true);
  addCheck('roofSurfaceAreaSqft', 'roof surface area');
  addCheck('eaveLf', 'eave LF');
  addCheck('ridgeLf', 'ridge LF');
  addCheck('wallHeightFt', 'wall height', true);

  return {
    ok: checks.every(check => check.pass),
    expected,
    actual,
    checks,
    mismatches: checks.filter(check => !check.pass),
  };
}

export function formatRoof3DParityWarning(parity) {
  const details = parity.mismatches.map((check) => (
    `${check.label}: 3D ${check.actual} vs summary ${check.expected}`
  )).join('; ');
  return `[HouseModel3D] Measurement parity mismatch — ${details}`;
}