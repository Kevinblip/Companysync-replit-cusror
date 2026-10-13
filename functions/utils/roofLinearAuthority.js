const LINEAR_KEYS = ['ridge', 'hip', 'valley', 'rake', 'eave'];

const roundLf = (value) => Math.round((Number(value) || 0) * 10) / 10;

export function assessRoofFacetTraceQuality(facets) {
  if (!Array.isArray(facets) || facets.length < 2) {
    return { usable: false, reason: 'insufficient_facets' };
  }

  const ids = new Set(facets.map(facet => facet?.id).filter(Boolean));
  if (ids.size !== facets.length) {
    return { usable: false, reason: 'invalid_facet_ids' };
  }

  const adjacency = new Map([...ids].map(id => [id, new Set()]));
  let unresolvedUphillEdges = 0;
  for (const facet of facets) {
    if (!Array.isArray(facet.polygon) || facet.polygon.length < 3 || !Array.isArray(facet.edges)) {
      return { usable: false, reason: 'incomplete_geometry' };
    }
    for (const edge of facet.edges) {
      const values = [edge?.x1, edge?.y1, edge?.x2, edge?.y2, edge?.length_ft];
      if (values.some(value => !Number.isFinite(Number(value))) ||
          Number(edge.length_ft) <= 0 || Number(edge.length_ft) > 1000) {
        return { usable: false, reason: 'invalid_edge_geometry' };
      }
      if (edge.shared_with) {
        if (!ids.has(edge.shared_with)) return { usable: false, reason: 'unknown_shared_facet' };
        adjacency.get(facet.id).add(edge.shared_with);
        adjacency.get(edge.shared_with).add(facet.id);
      } else if (edge.role === 'up' || edge.type === 'ridge') {
        unresolvedUphillEdges++;
      }
    }
  }

  const visited = new Set();
  const pending = [facets[0].id];
  while (pending.length > 0) {
    const id = pending.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...adjacency.get(id));
  }
  if (visited.size !== facets.length) {
    return { usable: false, reason: 'disconnected_facets' };
  }
  if (unresolvedUphillEdges > 0) {
    return { usable: false, reason: 'unresolved_uphill_edges', unresolved_uphill_edges: unresolvedUphillEdges };
  }
  return { usable: true, reason: 'connected_complete_trace' };
}

/**
 * Replace all linears together only when the facet topology is a connected,
 * complete trace. Otherwise keep the heuristic set intact and surface why.
 */
export function reconcileRoofLinearsWithFacetEdges(headlineLinears, facetEdgeTotals, facets) {
  const heuristic = Object.fromEntries(
    LINEAR_KEYS.map(key => [`${key}_lf`, roundLf(headlineLinears?.[`${key}_lf`])])
  );
  const traced = Object.fromEntries(
    LINEAR_KEYS.map(key => [`${key}_lf`, roundLf(facetEdgeTotals?.[key])])
  );
  const traceQuality = assessRoofFacetTraceQuality(facets);
  const hasUsableTrace = traceQuality.usable && (traced.eave_lf + traced.rake_lf) > 0;

  const differences = {};
  for (const key of LINEAR_KEYS) {
    const field = `${key}_lf`;
    const before = heuristic[field];
    const after = traced[field];
    const denominator = Math.max(before, after, 1);
    const relativeDifference = Math.abs(after - before) / denominator;
    if (relativeDifference >= 0.25) {
      differences[field] = {
        heuristic_lf: before,
        traced_lf: after,
        relative_difference: Math.round(relativeDifference * 1000) / 1000,
      };
    }
  }

  return {
    linears: hasUsableTrace ? traced : heuristic,
    source: hasUsableTrace ? 'roof_facet_edges' : 'roof_type_heuristic',
    trace_quality: traceQuality,
    differences: hasUsableTrace ? differences : {},
  };
}
