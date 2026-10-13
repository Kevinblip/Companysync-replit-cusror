#!/usr/bin/env node
/**
 * test-daily-reports-tz.cjs
 * ─────────────────────────
 * Regression guard for report scheduler timezone handling.
 *
 * ## What this protects
 *
 * The schedulers (vite-functions-plugin.js, `sendScheduledDailyReports`,
 * `sendFridayPortalRecap`, and `sendWeeklyCommissionDigest`) do:
 *
 *   const tz = company.timezone || company.settings?.time_zone || company.data?.timezone || 'America/New_York';
 *   const localTime = new Date(now.toLocaleString('en-US', { timeZone: tz }));
 *   const totalMin  = localTime.getHours() * 60 + localTime.getMinutes();
 *   const morningWindow = 7 * 60;   // 7:00 AM – 7:29 AM local
 *   const eodWindow     = 19 * 60;  // 7:00 PM – 7:29 PM local
 *   inMorning = totalMin >= morningWindow && totalMin < morningWindow + 30;
 *   inEvening = totalMin >= eodWindow     && totalMin < eodWindow     + 30;
 *
 * The SELECT that provides the columns is:
 *   SELECT id, company_name, data, timezone, settings FROM companies WHERE ...
 *
 * The Friday recap and weekly commission SELECTs provide `timezone` as:
 *   ge.data->>'timezone' AS timezone
 *
 * ## Tests
 *
 *  PART 1 — Source assertions (tied to actual production code)
 *   1a. `timezone` column is present in the SELECT within sendScheduledDailyReports
 *   1b. `settings` column is present in the same SELECT
 *   1c. The tz-resolution expression reads `company.timezone` as the highest-priority source
 *   1d. `company.settings?.time_zone` is the second fallback in the resolution chain
 *   1e. `company.data?.timezone` is the third fallback
 *   1f. `'America/New_York'` is the final hard-coded fallback
 *   1g. morningWindow is set to 7 * 60 (7:00 AM)
 *   1h. eodWindow is set to 19 * 60 (7:00 PM)
 *   1i. Both windows use a +30 minute width
 *   1j. Friday portal recap selects the timezone source used by its resolver
 *   1k. Weekly commission digest selects the timezone source used by its resolver
 *
 *  PART 2 — Logic unit tests (verify the math is semantically correct)
 *   2a. Morning window (7:00–7:29 AM): Pacific company fires at 7:05 AM PT (14:05 UTC)
 *   2b. Regression: same UTC moment but timezone column absent → falls back to ET,
 *       10:05 AM ET → outside both windows → report silently skipped
 *   2c. Morning boundary: 7:00 AM → IN | 7:29 AM → IN | 7:30 AM → OUT | 6:59 AM → OUT
 *   2d. Evening window (7:00–7:29 PM): Pacific company fires at 7:05 PM PT (02:05 UTC)
 *   2e. Evening regression: same UTC → ET 10:05 PM → outside windows
 *   2f. Evening boundary: 7:00 PM → IN | 7:29 PM → IN | 7:30 PM → OUT | 6:59 PM → OUT
 *   2g. No-timezone company defaults to ET and fires in ET window
 *   2h. Intermediate fallbacks (settings.time_zone, data.timezone) also fire correctly
 *   2i. Friday portal recap fires for a Los Angeles company at 5:05 PM local
 *   2j. Dropped timezone regression skips that Friday recap
 *   2k. Weekly commission digest fires for a Los Angeles company at 4:05 PM local
 *   2l. Dropped timezone regression skips that weekly digest
 *
 * No server, no database, no network — pure in-process unit tests.
 *
 * Usage:  node scripts/test-daily-reports-tz.cjs
 */
'use strict';

const fs   = require('fs');
const path = require('path');

// ── Test harness ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`);
    failed++;
  }
}

// ── Load production source ────────────────────────────────────────────────────
const pluginPath = path.join(__dirname, '..', 'vite-functions-plugin.js');
let pluginSource = '';
try {
  pluginSource = fs.readFileSync(pluginPath, 'utf8');
} catch (e) {
  console.error(`FATAL: cannot read vite-functions-plugin.js: ${e.message}`);
  process.exit(1);
}

// ── Extract scheduler function bodies from source ─────────────────────────────
// Keep source assertions scoped to each function. The handlers are methods on
// functionHandlers, so the next method starts with two spaces + "async ".
function extractFunctionBody(functionName) {
  const fnMarker = `async ${functionName}(`;
  const fnStart = pluginSource.indexOf(fnMarker);
  if (fnStart === -1) {
    console.error(`FATAL: ${functionName} not found in vite-functions-plugin.js`);
    process.exit(1);
  }
  const nextFnMatch = pluginSource.slice(fnStart + fnMarker.length).search(/\n  async [a-zA-Z]/);
  return nextFnMatch === -1
    ? pluginSource.slice(fnStart, fnStart + 5000)
    : pluginSource.slice(fnStart, fnStart + fnMarker.length + nextFnMatch);
}

const fnBody = extractFunctionBody('sendScheduledDailyReports');
const fridayRecapFnBody = extractFunctionBody('sendFridayPortalRecap');
const weeklyCommissionFnBody = extractFunctionBody('sendWeeklyCommissionDigest');

// ═════════════════════════════════════════════════════════════════════════════
// PART 1 — Source-level assertions against the production function body
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1a-1b] SELECT column assertions');

// 1a. The SELECT must include the direct `timezone` column.
//     Pattern: SELECT ... timezone ... FROM companies
{
  const selectMatch = fnBody.match(/SELECT\s+([\w\s,.*]+?)\s+FROM\s+companies/i);
  if (selectMatch) {
    const cols = selectMatch[1];
    ok('SELECT includes `timezone` column (direct dedicated column)', /\btimezone\b/.test(cols), cols.trim());
    ok('SELECT includes `settings` column', /\bsettings\b/.test(cols), cols.trim());
  } else {
    ok('SELECT … FROM companies found in sendScheduledDailyReports', false,
       fnBody.slice(0, 300));
    ok('SELECT includes `timezone` column', false, '(SELECT pattern not found)');
  }
}

console.log('\n[1c-1f] Timezone-resolution expression assertions');

// 1c. Highest-priority source must be company.timezone (the dedicated column).
ok('Resolution chain starts with company.timezone',
   /\bconst tz\s*=\s*company\.timezone\b/.test(fnBody),
   'Expected: const tz = company.timezone || ...');

// 1d. Second fallback must be company.settings?.time_zone.
ok('Second fallback is company.settings?.time_zone',
   /company\.timezone\s*\|\|\s*company\.settings\?\.time_zone\b/.test(fnBody),
   'Expected: company.timezone || company.settings?.time_zone || ...');

// 1e. Third fallback must be company.data?.timezone.
ok('Third fallback is company.data?.timezone',
   /company\.settings\?\.time_zone\s*\|\|\s*company\.data\?\.timezone\b/.test(fnBody),
   'Expected: ... || company.settings?.time_zone || company.data?.timezone || ...');

// 1f. Final hard-coded fallback must be 'America/New_York'.
ok("Final fallback is 'America/New_York'",
   /company\.data\?\.timezone\s*\|\|\s*'America\/New_York'/.test(fnBody),
   "Expected: ... || company.data?.timezone || 'America/New_York'");

console.log('\n[1g-1i] Window boundary assertions');

// 1g. morningWindow must be 7 * 60.
ok('morningWindow = 7 * 60 (7:00 AM)',
   /\bmorningWindow\s*=\s*7\s*\*\s*60\b/.test(fnBody),
   'Expected: morningWindow = 7 * 60');

// 1h. eodWindow must be 19 * 60.
ok('eodWindow = 19 * 60 (7:00 PM)',
   /\beodWindow\s*=\s*19\s*\*\s*60\b/.test(fnBody),
   'Expected: eodWindow = 19 * 60');

// 1i. Both window predicates must use +30 (30-minute width).
//     Matches: morningWindow + 30  and  eodWindow + 30
const plus30count = (fnBody.match(/(?:morningWindow|eodWindow)\s*\+\s*30\b/g) || []).length;
ok('Both windows use a +30 minute width (two occurrences of Window + 30)',
   plus30count === 2, `found ${plus30count} occurrence(s)`);

console.log('\n[1j-1k] Friday scheduler SELECT timezone assertions');

// Both Friday schedulers read the row alias `company.timezone`. Their source
// query is a generic Company entity, so the alias must remain tied to the
// JSONB timezone expression. A dropped SELECT expression would silently make
// every company use the Eastern fallback.
function assertJoinedCompanyTimezoneSource(name, body) {
  const selectMatch = body.match(/SELECT\s+([\s\S]*?)\s+FROM\s+generic_entities\s+ge\b/i);
  if (!selectMatch) {
    ok(`${name}: Company SELECT found`, false, 'SELECT … FROM generic_entities ge not found');
    ok(`${name}: SELECT includes ge.data timezone source`, false, '(SELECT pattern not found)');
    return;
  }

  const selectClause = selectMatch[1];
  ok(`${name}: SELECT includes timezone alias`,
     /\btimezone\b/i.test(selectClause),
     selectClause.trim());
  ok(`${name}: SELECT includes ge.data->>'timezone' AS timezone`,
     /ge\.data\s*->>\s*'timezone'\s+AS\s+timezone/i.test(selectClause),
     selectClause.trim());
  ok(`${name}: resolver reads company.timezone`,
     /\bconst tz\s*=\s*company\.timezone\b/.test(body),
     'Expected: const tz = company.timezone || ...');
}

assertJoinedCompanyTimezoneSource('Friday portal recap', fridayRecapFnBody);
assertJoinedCompanyTimezoneSource('Weekly commission digest', weeklyCommissionFnBody);

// ═════════════════════════════════════════════════════════════════════════════
// PART 2 — Logic unit tests (semantic verification of the window math)
// These tests import the resolver and window-check logic as a faithful copy of
// the production code extracted above. They are a sanity check on the math,
// not a substitute for the source assertions in Part 1.
// ═════════════════════════════════════════════════════════════════════════════

// Inline the production logic verbatim — intentionally matches the source.
// If the source assertions in Part 1 pass, this copy IS the production logic.
function resolveTimezone(company) {
  return (
    company.timezone ||
    company.settings?.time_zone ||
    company.data?.timezone ||
    'America/New_York'
  );
}

function checkWindows(company, nowUtc) {
  const tz = resolveTimezone(company);
  const localTime = new Date(nowUtc.toLocaleString('en-US', { timeZone: tz }));
  const totalMin = localTime.getHours() * 60 + localTime.getMinutes();
  const morningWindow = 7 * 60;
  const eodWindow     = 19 * 60;
  return {
    tz,
    totalMin,
    inMorning: totalMin >= morningWindow && totalMin < morningWindow + 30,
    inEvening: totalMin >= eodWindow     && totalMin < eodWindow     + 30,
  };
}

// UTC reference moments (summer 2026, PDT = UTC−7, EDT = UTC−4):
//   Morning: 2026-08-06 14:05 UTC  →  LA 07:05 / ET 10:05
//   Evening: 2026-08-07 02:05 UTC  →  LA 19:05 / ET 22:05
//   ET morning: 2026-08-06 11:05 UTC → ET 07:05
const MORNING_LA_UTC = new Date('2026-08-06T14:05:00.000Z');
const EVENING_LA_UTC = new Date('2026-08-07T02:05:00.000Z');
const MORNING_ET_UTC = new Date('2026-08-06T11:05:00.000Z');
// Friday windows in summer 2026 (PDT = UTC−7, EDT = UTC−4):
//   Recap: 2026-08-08 00:05 UTC → LA Friday 17:05 / ET Friday 20:05
//   Digest: 2026-08-07 23:05 UTC → LA Friday 16:05 / ET Friday 19:05
const FRIDAY_RECAP_LA_UTC = new Date('2026-08-08T00:05:00.000Z');
const WEEKLY_DIGEST_LA_UTC = new Date('2026-08-07T23:05:00.000Z');

function laCompanyCorrect()  { return { timezone: 'America/Los_Angeles', settings: null, data: null }; }
function laCompanyRegressed(){ return { /* timezone col absent */ settings: null, data: null }; }
function etCompanyNoTz()     { return { settings: null, data: null }; }

console.log('\n[2a] Morning window — LA company at 7:05 AM Pacific (14:05 UTC)');
{
  const w = checkWindows(laCompanyCorrect(), MORNING_LA_UTC);
  ok('Resolved timezone: America/Los_Angeles', w.tz === 'America/Los_Angeles', w.tz);
  ok(`7:05 AM LA → IN morning window (totalMin=${w.totalMin})`, w.inMorning);
  ok('7:05 AM LA → NOT in evening window', !w.inEvening);
}

console.log('\n[2b] Regression: timezone column dropped → falls back to ET → report skipped');
{
  const w = checkWindows(laCompanyRegressed(), MORNING_LA_UTC);
  ok('Regressed LA: falls back to America/New_York', w.tz === 'America/New_York', w.tz);
  ok(`ET 10:05 AM → NOT in morning window (totalMin=${w.totalMin})`, !w.inMorning);
  ok('ET 10:05 AM → NOT in evening window', !w.inEvening);
}

console.log('\n[2c] Morning boundary math');
{
  const w700 = checkWindows(laCompanyCorrect(), new Date('2026-08-06T14:00:00.000Z'));
  ok('7:00 AM exactly → IN morning window', w700.inMorning, w700.totalMin);

  const w729 = checkWindows(laCompanyCorrect(), new Date('2026-08-06T14:29:00.000Z'));
  ok('7:29 AM → IN morning window (last minute)', w729.inMorning, w729.totalMin);

  const w730 = checkWindows(laCompanyCorrect(), new Date('2026-08-06T14:30:00.000Z'));
  ok('7:30 AM → OUT of morning window', !w730.inMorning, w730.totalMin);

  const w659 = checkWindows(laCompanyCorrect(), new Date('2026-08-06T13:59:00.000Z'));
  ok('6:59 AM → OUT of morning window', !w659.inMorning, w659.totalMin);
}

console.log('\n[2d] Evening window — LA company at 7:05 PM Pacific (02:05 UTC next day)');
{
  const w = checkWindows(laCompanyCorrect(), EVENING_LA_UTC);
  ok('Resolved timezone: America/Los_Angeles', w.tz === 'America/Los_Angeles', w.tz);
  ok(`7:05 PM LA → IN evening window (totalMin=${w.totalMin})`, w.inEvening);
  ok('7:05 PM LA → NOT in morning window', !w.inMorning);
}

console.log('\n[2e] Regression: timezone column dropped → ET 22:05 → evening report skipped');
{
  const w = checkWindows(laCompanyRegressed(), EVENING_LA_UTC);
  ok('Regressed LA: falls back to America/New_York', w.tz === 'America/New_York', w.tz);
  ok(`ET 10:05 PM → NOT in evening window (totalMin=${w.totalMin})`, !w.inEvening);
  ok('ET 10:05 PM → NOT in morning window', !w.inMorning);
}

console.log('\n[2f] Evening boundary math');
{
  const w700pm = checkWindows(laCompanyCorrect(), new Date('2026-08-07T02:00:00.000Z'));
  ok('7:00 PM exactly → IN evening window', w700pm.inEvening, w700pm.totalMin);

  const w729pm = checkWindows(laCompanyCorrect(), new Date('2026-08-07T02:29:00.000Z'));
  ok('7:29 PM → IN evening window (last minute)', w729pm.inEvening, w729pm.totalMin);

  const w730pm = checkWindows(laCompanyCorrect(), new Date('2026-08-07T02:30:00.000Z'));
  ok('7:30 PM → OUT of evening window', !w730pm.inEvening, w730pm.totalMin);

  const w659pm = checkWindows(laCompanyCorrect(), new Date('2026-08-07T01:59:00.000Z'));
  ok('6:59 PM → OUT of evening window', !w659pm.inEvening, w659pm.totalMin);
}

console.log('\n[2g] Fallback — no timezone set anywhere → resolves to ET, fires in ET window');
{
  const w = checkWindows(etCompanyNoTz(), MORNING_ET_UTC);
  ok('No-timezone company → America/New_York', w.tz === 'America/New_York', w.tz);
  ok('ET 7:05 AM (11:05 UTC) → IN morning window', w.inMorning, w.totalMin);
}

console.log('\n[2h] Intermediate fallback paths (settings.time_zone and data.timezone)');
{
  const wSettings = checkWindows(
    { settings: { time_zone: 'America/Los_Angeles' }, data: null },
    MORNING_LA_UTC
  );
  ok('settings.time_zone fallback → LA timezone', wSettings.tz === 'America/Los_Angeles', wSettings.tz);
  ok('settings.time_zone fallback → 7:05 AM PA → IN morning window', wSettings.inMorning, wSettings.totalMin);

  const wData = checkWindows(
    { settings: null, data: { timezone: 'America/Los_Angeles' } },
    MORNING_LA_UTC
  );
  ok('data.timezone fallback → LA timezone', wData.tz === 'America/Los_Angeles', wData.tz);
  ok('data.timezone fallback → 7:05 AM PA → IN morning window', wData.inMorning, wData.totalMin);
}

// These two helpers intentionally mirror the respective production gates.
// Keeping the target hour/window separate prevents one scheduler's change
// from accidentally making the other's test pass.
function checkFridayPortalRecapWindow(company, nowUtc) {
  const tz = company.timezone || 'America/New_York';
  const localStr = nowUtc.toLocaleString('en-US', {
    timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  });
  const isFriday = localStr.startsWith('Fri');
  const hourMatch = localStr.match(/(\d{1,2}):(\d{2})$/);
  const localHour = hourMatch ? parseInt(hourMatch[1]) : -1;
  const localMin = hourMatch ? parseInt(hourMatch[2]) : -1;
  return {
    tz,
    localStr,
    inWindow: isFriday && localHour === 17 && localMin < 15,
  };
}

function checkWeeklyCommissionDigestWindow(company, nowUtc) {
  const tz = company.timezone || 'America/New_York';
  const localStr = nowUtc.toLocaleString('en-US', {
    timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  });
  const isFriday = localStr.startsWith('Fri');
  const hourMatch = localStr.match(/(\d{1,2}):(\d{2})$/);
  const localHour = hourMatch ? parseInt(hourMatch[1]) : -1;
  const localMin = hourMatch ? parseInt(hourMatch[2]) : -1;
  return {
    tz,
    localStr,
    inWindow: isFriday && localHour === 16 && localMin < 15,
  };
}

console.log('\n[2i-2j] Friday portal recap — Los Angeles window');
{
  const w = checkFridayPortalRecapWindow(laCompanyCorrect(), FRIDAY_RECAP_LA_UTC);
  ok('Resolved timezone: America/Los_Angeles', w.tz === 'America/Los_Angeles', w.tz);
  ok(`Friday 5:05 PM LA → IN recap window (${w.localStr})`, w.inWindow);

  const regressed = checkFridayPortalRecapWindow(laCompanyRegressed(), FRIDAY_RECAP_LA_UTC);
  ok('Dropped timezone → falls back to America/New_York', regressed.tz === 'America/New_York', regressed.tz);
  ok(`Friday 8:05 PM ET → OUT recap window (${regressed.localStr})`, !regressed.inWindow);
}

console.log('\n[2k-2l] Weekly commission digest — Los Angeles window');
{
  const w = checkWeeklyCommissionDigestWindow(laCompanyCorrect(), WEEKLY_DIGEST_LA_UTC);
  ok('Resolved timezone: America/Los_Angeles', w.tz === 'America/Los_Angeles', w.tz);
  ok(`Friday 4:05 PM LA → IN digest window (${w.localStr})`, w.inWindow);

  const regressed = checkWeeklyCommissionDigestWindow(laCompanyRegressed(), WEEKLY_DIGEST_LA_UTC);
  ok('Dropped timezone → falls back to America/New_York', regressed.tz === 'America/New_York', regressed.tz);
  ok(`Friday 7:05 PM ET → OUT digest window (${regressed.localStr})`, !regressed.inWindow);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
