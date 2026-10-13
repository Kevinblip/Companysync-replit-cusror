/**
 * Scoping rules that decide HOW MUCH of a measurement a given line item bills.
 *
 * These are deliberately separated from the measurement engine. The engine
 * answers "how long is the eave" — these answer "does the starter course bill
 * the eave, or the eave plus the rake". Getting the second question wrong is
 * invisible in the measurement report and only shows up when an adjuster
 * scopes the job differently than we did.
 */

/**
 * Length of the asphalt starter course.
 *
 * Xactimate and Hover both scope the starter course at the EAVES only; the
 * rakes get drip edge. Running starter up the rakes is a legitimate wind-uplift
 * upgrade (some manufacturer warranties ask for it), but it has to be an
 * explicit choice — billing the full eave+rake perimeter where an adjuster
 * scopes eaves alone is a write-off, not extra revenue.
 *
 * When eave length is unknown (older or manual measurements that only carried a
 * combined perimeter) fall back to the combined edge so the line does not
 * silently vanish from the estimate.
 */
export function starterCourseLF(eavesLF, rakeLF, includeRakes) {
  const eaves = Number(eavesLF) || 0;
  const rakes = Number(rakeLF) || 0;
  if (includeRakes) return eaves + rakes;
  return eaves > 0 ? eaves : eaves + rakes;
}

/** Provenance note shown under the starter line so the scope is auditable. */
export function starterCourseNote(eavesLF, includeRakes) {
  if (includeRakes) return 'Eaves + rakes — rake starter enabled in settings';
  if ((Number(eavesLF) || 0) > 0) return 'Eaves only — rakes get drip edge, not starter';
  return 'Eave length unavailable — using combined eave + rake edge';
}

/**
 * Square footage the house wrap / weather-resistive barrier has to cover.
 *
 * A WRB is installed behind brick and stone veneer too, so the wrap basis is
 * net siding PLUS the masonry area (less the openings already charged to the
 * masonry column) — not the siding-only figure. Deducting masonry from wrap the
 * way we deduct it from siding under-orders wrap on every mixed-material house.
 *
 * The Math.max guard means a malformed graph (masonry openings larger than the
 * masonry itself) can never drag wrap BELOW the siding basis; the worst case is
 * that we fall back to today's behaviour.
 */
export function houseWrapBaseSqft(netSidingSqft, graphTotals) {
  const base = Number(netSidingSqft) || 0;
  const masonry = Number(graphTotals?.masonry_area_sqft) || 0;
  const masonryOpenings = Number(graphTotals?.opening_deduction_masonry_sqft) || 0;
  return Math.max(base, base + masonry - masonryOpenings);
}
