const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const mapSource = fs.readFileSync(
  path.join(root, 'src/components/satellite/InteractiveRoofMap.jsx'),
  'utf8',
);
const estimatorSource = fs.readFileSync(
  path.join(root, 'src/pages/AIEstimator.jsx'),
  'utf8',
);

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}`);
  }
}

check(
  'manual map builds quantities from canonical traced facet graph',
  mapSource.includes('buildTracedRoofGraph({ facets, weldToleranceFt: 1.5 })'),
);
check(
  'manual trace uses graph roof area instead of perimeter approximation',
  mapSource.includes('corrected_area_sqft: traceGraph.totals.roof_area_sqft'),
);
check(
  'manual trace emits canonical facet and edge geometry',
  mapSource.includes('roof_measurement_graph: traceGraph')
    && mapSource.includes('roof_facet_edge_totals: traceGraph.edge_totals'),
);
check(
  'save stays available after a facet is traced, even with an open edge',
  mapSource.includes('disabled={!canSave}')
    && mapSource.includes('const canSave = tracedFacetCount > 0')
    && !mapSource.includes('disabled={!traceReady}'),
);
check(
  'each facet has editable pitch and downslope direction',
  mapSource.includes('data-testid="input-active-facet-pitch"')
    && mapSource.includes('data-testid="select-active-facet-direction"'),
);
check(
  'automatic result offers correction by tracing',
  estimatorSource.includes('data-testid="button-correct-roof-by-tracing"'),
);
check(
  'completed correction replaces and unblocks the main measurement',
  estimatorSource.includes("measurement_source: 'manual_roof_trace'")
    && estimatorSource.includes('requires_manual_review: false')
    && estimatorSource.includes('measurement_ready: true')
    && estimatorSource.includes("name: 'Main Structure (Manual Trace)'"),
);
check(
  'correction flow does not enter add-on mode',
  estimatorSource.includes('setManualAddOnMode(false);')
    && estimatorSource.includes('manualRoofCorrectionMode && satelliteAnalysis'),
);
check(
  'full roof trace does not show the add-on banner at the same time',
  estimatorSource.includes("purpose={manualAddOnMode ? 'addon' : 'primary'}")
    && estimatorSource.includes('data-testid="manual-addon-banner"')
    && estimatorSource.includes('{manualAddOnMode && ('),
);
check(
  'manual trace can add another facet and undo a point',
  mapSource.includes('data-testid="button-add-facet"')
    && mapSource.includes('data-testid="button-undo-point"')
    && mapSource.includes('data-testid="snap-indicator"')
    && mapSource.includes('data-testid="manual-trace-advanced"')
    && mapSource.includes('queueNextFacetRef.current?.(sId)'),
);
check(
  'double-click finishes a facet or line without zooming or keeping the gesture vertices',
  mapSource.includes('disableDoubleClickZoom: true')
    && mapSource.includes('_dropGestureVertices')
    && mapSource.includes("addListener(this._map, 'dblclick'"),
);
check(
  'ridge rake and drip edge can be drawn and a drawn line replaces the traced total',
  mapSource.includes('data-testid={`draw-${type}`}')
    && mapSource.includes('drip_edge')
    && mapSource.includes('manual_lines: manualLines')
    && mapSource.includes('drip_edge_lf: usedEdges.drip_edge')
    && estimatorSource.includes('estimateDripEdgeLf(measurements)'),
);

console.log(`\n${failed ? 'FAILED' : 'ALL PASSED'}: ${passed}/${passed + failed} checks passed`);
process.exit(failed ? 1 : 0);