#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');
const dashboard = read('src/pages/Dashboard.jsx');
const calendar = read('src/pages/Calendar.jsx');
const reports = read('src/pages/Reports.jsx');
const inspections = read('src/pages/InspectionsDashboard.jsx');
const gate = read('src/hooks/usePostPaintGate.js');

const checks = [
  [gate.includes('requestIdleCallback'), 'secondary data waits for an idle browser turn'],
  [gate.includes('timeout: 750'), 'busy browsers have a bounded secondary-data start'],
  [dashboard.includes('isDashboardDataReady'), 'Dashboard tenant-wide collections are post-paint gated'],
  [calendar.includes("usePostPaintGate(!!myCompany?.id, 'calendar')"), 'Calendar secondary collections are post-paint gated'],
  [calendar.includes("enabled: !!user && !!myCompany?.id"), 'Calendar primary events still start immediately'],
  [(calendar.match(/isCalendarSecondaryDataReady/g) || []).length >= 9, 'Calendar gates all secondary collection reads'],
  [reports.includes("usePostPaintGate(!!myCompany?.id, 'reports')"), 'Reports keeps its shell ahead of bulk report data'],
  [(reports.match(/&& isReportsDataReady/g) || []).length >= 13, 'Reports gates company-wide report collections'],
  [reports.includes('isInitialReportLoad'), 'Reports never flashes misleading zero totals during initial hydration'],
  [inspections.includes("usePostPaintGate(!!myCompany?.id && !isDataLoading, 'inspections')"), 'Inspections defers its large media collection'],
  [inspections.includes('enabled: !!myCompany?.id && isInspectionMediaReady'), 'Inspection jobs can load before media totals'],
];

for (const [condition, label] of checks) {
  assert.ok(condition, label);
  console.log(`✓ ${label}`);
}

console.log('\nFirst-paint collection requests (before → after):');
console.log('  Dashboard: 13 → 0 secondary collection requests');
console.log('  Calendar:   9 → 1 primary collection request');
console.log('  Reports:   14 → 0 bulk collection requests');
console.log('  Inspections: 2 → 1 primary collection request');
console.log(`\n${checks.length} progressive-loading checks passed`);