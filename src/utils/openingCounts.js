/**
 * Resolve window / door / shutter counts for the Measurement Summary.
 *
 * Two producers feed the summary and they use DIFFERENT field names:
 *
 *   photo analysis     → windows_count, window_assemblies_count, doors_count,
 *                        garage_door_count, shutters_count, shutter_panel_count
 *                        (exact — derived from a real per-opening inventory)
 *   satellite-only     → estimated_windows, estimated_doors
 *                        (inferred from building size; no opening was observed)
 *
 * The summary originally read only the `estimated_*` pair, so as soon as a
 * contractor uploaded photos — the one path that produces exact counts — the
 * rows rendered an em-dash. The caption meanwhile promised "photo analysis gives
 * exact counts".
 */

/**
 * True when a real per-opening inventory exists behind the counts.
 *
 * A bare `windows_count: 0` is NOT sufficient evidence: the roof-footprint
 * fallback emits a hardcoded zero while knowing nothing whatsoever about
 * openings. Reporting a confident "0 windows" there is worse than admitting
 * we don't know.
 */
export function hasOpeningInventory(sd) {
  if (!sd || sd._estimated_from_roof_footprint) return false;
  return (
    sd.window_assemblies_count != null ||
    sd.measurement_graph != null ||
    Array.isArray(sd.openings_detail)
  );
}

/**
 * @param {object} sd siding measurements
 * @returns {{
 *   windows: number|null, doors: number|null, garageDoors: number|null,
 *   shutterPanels: number|null, shutterPairs: number|null,
 *   windowsExact: boolean, doorsExact: boolean, countsAreEstimates: boolean
 * }}
 */
export function resolveOpeningCounts(sd) {
  const s = sd || {};
  const exact = hasOpeningInventory(s);

  // Assemblies, not units: a mulled triple window in one frame is one window.
  const windows = exact ? (s.window_assemblies_count ?? s.windows_count ?? null) : null;
  const doors = exact ? (s.doors_count ?? null) : null;
  const garageDoors = exact ? (s.garage_door_count ?? null) : null;

  // Shutters only ever come from photo analysis, so there is no estimate to
  // fall back to — absent means absent.
  const shutterPanels = s.shutter_panel_count ?? s.shutters_count ?? null;
  const shutterPairs = s.shutter_pair_count ?? null;

  const windowsExact = windows != null;
  const doorsExact = doors != null;

  return {
    windows: windowsExact ? windows : (s.estimated_windows ?? null),
    doors: doorsExact ? doors : (s.estimated_doors ?? null),
    garageDoors,
    shutterPanels,
    shutterPairs,
    windowsExact,
    doorsExact,
    countsAreEstimates: !windowsExact || !doorsExact,
  };
}

/**
 * Caption for the summary header. Provenance is per-number: windows can be
 * exact while doors are unknown, so a blanket "these are estimates" line would
 * understate data we actually measured (and vice versa).
 */
export function summaryCaption({ windowsExact, doorsExact, hasShutters } = {}) {
  const trim = 'soffit & trim are estimates';
  if (windowsExact && doorsExact) {
    const what = hasShutters ? 'Window, door & shutter counts' : 'Window & door counts';
    return `${what} are exact from photo analysis; ${trim}`;
  }
  if (windowsExact) return `Window counts are exact from photo analysis; doors, ${trim}`;
  if (doorsExact) return `Door counts are exact from photo analysis; windows, ${trim}`;
  return 'Windows, doors & trim are estimates — add wall photos for exact counts';
}

/** "8 panels (4 pairs)" / "1 panel" / null when there are none. */
export function formatShutters(panels, pairs) {
  if (!panels) return null;
  const p = `${panels} panel${panels === 1 ? '' : 's'}`;
  return pairs ? `${p} (${pairs} pair${pairs === 1 ? '' : 's'})` : p;
}
