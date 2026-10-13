#!/usr/bin/env node
'use strict';

/**
 * Signed-in browser regression for the Auto Estimator facade selector.
 *
 * scripts/test-facade-orientation.cjs proves the compass → facade mapping in
 * isolation. This test drives the real authenticated estimator page, because a
 * correct mapping is still useless if the map click never reaches state, the 3D
 * badge never highlights the wall, or the evidence hand-off to the photo slot
 * breaks.
 *
 * Safety in development:
 *  - A dedicated company/staff/property fixture is created and deleted again.
 *  - Every paid provider call (Google Maps SDK, Solar/roof measurement, Gemini
 *    photo analysis, uploads) is stubbed in the browser. The test never spends
 *    AI, Maps, or storage quota, and never emails/texts anyone.
 *  - The measurement fixture describes a house whose FRONT faces EAST, so a
 *    hardcoded "south is front" shortcut fails instead of passing by luck.
 *
 * Prerequisites: npm run dev, DATABASE_URL, SESSION_SECRET, and Playwright.
 * Usage: npm run test:facade-selector-ui
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const { chromium } = require('playwright');
const { Pool } = require('pg');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const OWNER_EMAIL = 'smoke-facade-selector-owner@example.com';
const OWNER_SID = 'smoke_facade_selector_owner_session';
const COMPANY_NAME = 'Facade Selector E2E Test Co';
const PROPERTY_ADDRESS = '4180 Facade Test Way, Maple Heights, OH 44137';
const PROPERTY_COORDS = { lat: 41.409, lng: -81.555 };

// A 1×1 transparent PNG. The staged photos only need to exist and carry a
// label — the analysis itself is stubbed, so no pixels are ever uploaded.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const STAGED_PHOTO_LABELS = ['Front', 'Left Side', 'Right Side']; // "Back" is deliberately missing.

// The subject house is rotated: its front door faces EAST.
const FACADE_AZIMUTHS = { front: 90, right_side: 180, back: 270, left_side: 0 };

// compass → what the estimator must show for this rotated house.
const COMPASS_EXPECTATIONS = [
  { compass: 'N', label: 'North', face: 'left_side', photoLabel: 'Left Side', wall: '50 ft × 9 ft', openings: 1, confidence: '81% · photo scaled', photographed: true },
  { compass: 'E', label: 'East', face: 'front', photoLabel: 'Front', wall: '30 ft × 9 ft', openings: 3, confidence: '88% · photo scaled', photographed: true },
  { compass: 'S', label: 'South', face: 'right_side', photoLabel: 'Right Side', wall: '50 ft × 9 ft', openings: 2, confidence: '84% · photo scaled', photographed: true },
  { compass: 'W', label: 'West', face: 'back', photoLabel: 'Back', wall: '30 ft × 9 ft', openings: 0, confidence: '46% · satellite footprint', photographed: false },
];

let passed = 0;
let companyId;
let customerId;
let staffProfileId;

function ok(condition, label, detail) {
  try {
    assert.ok(condition, detail || label);
    passed++;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    throw error;
  }
}

function forgeSessionCookie(sid) {
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET)
    .update(sid).digest('base64').replace(/=+$/, '');
  return `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request({
      hostname: target.hostname,
      port: target.port || 80,
      path: `${target.pathname}${target.search}`,
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    }, (response) => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, data: JSON.parse(body) }); }
        catch (_) { resolve({ status: response.statusCode, data: body }); }
      });
    });
    request.setTimeout(20000, () => reject(new Error(`${options.method || 'GET'} ${target.pathname} timed out`)));
    request.on('error', reject);
    if (options.body !== undefined) request.write(JSON.stringify(options.body));
    request.end();
  });
}

function entity(method, type, bodyOrId, cookie) {
  const idSuffix = method === 'DELETE' ? `/${encodeURIComponent(bodyOrId)}` : '';
  return fetchJson(`${BASE_URL}/api/local/entity/${type}${idSuffix}`, {
    method,
    headers: { Cookie: cookie },
    ...(method === 'POST' ? { body: bodyOrId } : {}),
  });
}

async function waitForEntityApi(cookie) {
  const deadline = Date.now() + 30000;
  let lastStatus;
  while (Date.now() < deadline) {
    const response = await fetchJson(`${BASE_URL}/api/local/entity/Company?_limit=1`, {
      headers: { Cookie: cookie },
    }).catch(error => ({ status: 0, data: error.message }));
    lastStatus = response.status;
    // A 401/403 proves the server is up but the fixture session is wrong, so
    // surface that immediately instead of retrying past the deadline.
    if (response.status !== 503 && response.status !== 0) return response;
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw new Error(`authenticated entity API did not become ready (last HTTP ${lastStatus})`);
}

// ── Deterministic measurement fixtures ──────────────────────────────────────
function roofMeasurementFixture() {
  return {
    success: true,
    roof_area_sq: 20,
    roof_area_sqft: 2000,
    waste_percentage: 10,
    ridge_lf: 40,
    hip_lf: 0,
    valley_lf: 0,
    rake_lf: 80,
    eave_lf: 160,
    pitch: '6/12',
    pitch_confidence: 'high',
    overall_confidence: 85,
    confidence_grade: 'B',
    tolerance_pct: 10,
    building_length_ft: 50,
    building_width_ft: 30,
    roof_type: 'gable',
  };
}

function photoSidingFixture() {
  return {
    success: true,
    wall_area_sqft: 1140,
    wall_area_sq: 11.4,
    gross_wall_area_sqft: 1440,
    opening_deduction_sqft: 300,
    opening_deduct_sqft: 300,
    perimeter_ft: 160,
    story_count: 1,
    story_height_ft: 9,
    windows_count: 8,
    doors_count: 2,
    garage_door_count: 0,
    building_length_ft: 50,
    building_width_ft: 30,
    siding_material: 'vinyl',
    siding_condition: 'good',
    overall_confidence: 82,
    confidence_grade: 'B',
    tolerance_pct: 12,
    measurement_graph: {
      building: { facade_azimuths: FACADE_AZIMUTHS },
      wall_facets: [
        { face: 'front', wall_width_ft: 30, wall_height_ft: 9, photo_count: 1, confidence: 88, dimension_source: 'photo_scaled' },
        { face: 'right_side', wall_width_ft: 50, wall_height_ft: 9, photo_count: 1, confidence: 84, dimension_source: 'photo_scaled' },
        { face: 'left_side', wall_width_ft: 50, wall_height_ft: 9, photo_count: 1, confidence: 81, dimension_source: 'photo_scaled' },
        { face: 'back', wall_width_ft: 30, wall_height_ft: 9, photo_count: 0, confidence: 46, dimension_source: 'satellite_footprint' },
      ],
      opening_groups: [
        { face: 'front' }, { face: 'front' }, { face: 'front' },
        { face: 'right_side' }, { face: 'right_side' }, { face: 'left_side' },
      ],
      totals: { net_siding_area_sqft: 1140, opening_deduction_sqft: 300 },
    },
  };
}

// Every browser-side provider call is answered locally. `blockedCalls` records
// anything that would have cost money so the test can fail loudly instead of
// silently billing a real provider.
function installProviderStubs(context, blockedCalls) {
  const json = (route, body) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

  return context.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === '/api/functions/invoke') {
      const payload = JSON.parse(request.postData() || '{}');
      switch (payload.functionName) {
        case 'geocodeAddress':
          return json(route, { data: { success: true, ...PROPERTY_COORDS, formatted_address: PROPERTY_ADDRESS } });
        case 'aiRoofMeasurement':
          return json(route, { data: roofMeasurementFixture() });
        case 'analyzeHousePhotosForSiding':
          return json(route, { data: photoSidingFixture() });
        default:
          // Unknown helpers resolve empty: the page must not depend on a live
          // provider to select a facade.
          return json(route, { data: {} });
      }
    }

    if (pathname === '/api/integrations/invoke-llm'
      || pathname === '/api/integrations/upload'
      || pathname.startsWith('/api/integrations/send')) {
      blockedCalls.push(pathname);
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'blocked in test' }) });
    }

    // Auth, entities, and everything else hit the real signed-in dev server.
    return route.continue();
  });
}

// Google's SDK is never loaded: the page only needs a map object it can point
// at a heading, and the compass handler bails out when that object is missing.
function mapsStub() {
  const controls = new Proxy({}, {
    get(target, key) {
      if (!target[key]) target[key] = [];
      return target[key];
    },
  });
  const listener = { remove() {} };
  class MapStub {
    constructor(div) {
      this.div = div;
      this.controls = controls;
      this.heading = 0;
      this.tilt = 0;
      this.mapTypeId = 'satellite';
      window.__facadeTestMapCalls = window.__facadeTestMapCalls || [];
    }
    setMapTypeId(value) { this.mapTypeId = value; }
    getMapTypeId() { return this.mapTypeId; }
    setHeading(value) { this.heading = value; window.__facadeTestMapCalls.push(`heading:${value}`); }
    getHeading() { return this.heading; }
    setTilt(value) { this.tilt = value; }
    getTilt() { return this.tilt; }
    setCenter() {}
    setZoom() {}
    setOptions() {}
    getStreetView() { return { getVisible: () => false, setVisible() {} }; }
    addListener() { return listener; }
    overlayMapTypes = { clear() {}, push() {}, getLength: () => 0, removeAt() {} };
  }
  class MarkerStub {
    setMap() {}
    addListener() { return listener; }
  }
  window.google = {
    maps: {
      places: {},
      Map: MapStub,
      Marker: MarkerStub,
      Size: class { constructor(w, h) { this.width = w; this.height = h; } },
      Point: class { constructor(x, y) { this.x = x; this.y = y; } },
      LatLng: class { constructor(lat, lng) { this.lat = () => lat; this.lng = () => lng; } },
      SymbolPath: { CIRCLE: 0 },
      ControlPosition: { RIGHT_TOP: 0, TOP_RIGHT: 1, LEFT_TOP: 2, BOTTOM_CENTER: 3 },
      MapTypeId: { SATELLITE: 'satellite', ROADMAP: 'roadmap' },
      event: { addListenerOnce: () => listener, removeListener() {}, clearInstanceListeners() {} },
    },
  };
}

// The fixture is removed with SQL: the entity API refuses to delete a company
// row, so an API-only cleanup would leave a test tenant behind on every run.
async function cleanup() {
  if (companyId) {
    for (const table of ['generic_entities', 'customers', 'staff_profiles']) {
      await pool.query(`DELETE FROM ${table} WHERE company_id = $1`, [companyId]).catch(() => {});
    }
    await pool.query('DELETE FROM companies WHERE id = $1', [companyId]).catch(() => {});
  }
  await pool.query('DELETE FROM sessions WHERE sid = $1', [OWNER_SID]).catch(() => {});
}

async function main() {
  if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
    throw new Error('DATABASE_URL and SESSION_SECRET are required for this authenticated regression.');
  }

  console.log('\n── Facade selector (signed-in browser) ──');

  const health = await fetchJson(`${BASE_URL}/api/auth/user`);
  ok(health.status < 500, 'development server is responding', `HTTP ${health.status}`);

  // ── Seed a signed-in owner, company, and subject property ─────────────────
  const cookie = forgeSessionCookie(OWNER_SID);
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = $2::jsonb, expire = $3`,
    [
      OWNER_SID,
      JSON.stringify({
        cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' },
        passport: { user: { claims: { email: OWNER_EMAIL } } },
      }),
      new Date(Date.now() + 3600000),
    ],
  );
  const entityApi = await waitForEntityApi(cookie);
  ok(entityApi.status === 200, 'authenticated entity API is ready before fixture creation', `HTTP ${entityApi.status}`);

  const company = await entity('POST', 'Company', {
    company_name: COMPANY_NAME, created_by: OWNER_EMAIL, onboarding_completed: true,
  }, cookie);
  companyId = company.data?.id;
  ok(!!companyId, 'isolated test company is created', `HTTP ${company.status}`);

  // Subscription fields are guarded against client writes, so the plan is set
  // directly on the fixture row.
  await pool.query(
    `UPDATE companies SET subscription_plan = 'enterprise', subscription_status = 'active' WHERE id = $1`,
    [companyId],
  );

  const staff = await entity('POST', 'StaffProfile', {
    company_id: companyId,
    user_email: OWNER_EMAIL,
    full_name: 'Facade Selector Owner',
    is_administrator: true,
    is_active: true,
    role: 'admin',
  }, cookie);
  staffProfileId = staff.data?.id;
  ok(!!staffProfileId, 'admin staff profile is created for the signed-in owner', `HTTP ${staff.status}`);

  const customer = await entity('POST', 'Customer', {
    company_id: companyId,
    full_name: 'Facade Selector Test Property',
    property_address: PROPERTY_ADDRESS,
    city: 'Maple Heights',
    state: 'OH',
    postal_code: '44137',
  }, cookie);
  customerId = customer.data?.id;
  ok(!!customerId, 'subject property is seeded for the test company', `HTTP ${customer.status}`);

  // ── Drive the real estimator page as that signed-in owner ─────────────────
  const systemChromium = '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium';
  const browser = await chromium.launch({
    headless: true,
    ...(fs.existsSync(systemChromium) ? { executablePath: systemChromium } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'],
  });
  const hostname = new URL(BASE_URL).hostname;
  const blockedCalls = [];

  try {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1440, height: 1200 },
      storageState: {
        cookies: [{
          name: 'connect.sid',
          value: decodeURIComponent(cookie.replace('connect.sid=', '')),
          domain: hostname, path: '/', httpOnly: true, secure: false, sameSite: 'Lax',
        }],
        origins: [],
      },
    });

    await context.addInitScript(({ cid, address, pixel, labels, stub }) => {
      localStorage.setItem('last_used_company_id', cid);
      localStorage.setItem('aiEstimatorConfig', JSON.stringify({
        specialties: ['siding'],
        specialty: 'siding',
        storyCount: '1',
        storyHeightFt: '9',
        openingDeductionPct: '15',
        sidingWastePct: '10',
      }));
      // The estimator's own staged-photo backup: three facades photographed,
      // the back deliberately left without evidence.
      sessionStorage.setItem('aiestimator_house_photos_v1', JSON.stringify({
        scope: address,
        photos: labels.map((label, index) => ({
          url: pixel,
          label,
          name: `${label.toLowerCase().replace(/\s+/g, '-')}.png`,
          exif_heading: null,
          perceptual_hash: `facade-test-${index}`,
        })),
      }));
      // eslint-disable-next-line no-new-func
      new Function(`return (${stub})`)()();
    }, {
      cid: companyId,
      address: PROPERTY_ADDRESS,
      pixel: PIXEL,
      labels: STAGED_PHOTO_LABELS,
      stub: mapsStub.toString(),
    });

    await installProviderStubs(context, blockedCalls);

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(
      `${BASE_URL}/AIEstimator?property_address=${encodeURIComponent(PROPERTY_ADDRESS)}`,
      { waitUntil: 'domcontentloaded', timeout: 45000 },
    );

    await page.getByRole('tab', { name: /storm tracking/i }).click();
    await page.locator('button').filter({ hasText: 'AI Auto-Detect' }).click({ timeout: 30000 });

    // The compass toolbar only exists once a satellite roof analysis is on file.
    const compassNorth = page.locator('[data-testid="main-rotate-n"]');
    await compassNorth.waitFor({ timeout: 45000 });
    ok(true, 'signed-in estimator reaches the satellite map with compass controls');

    // Measure the staged photos so the facade panel has real evidence to report.
    await page.locator('[data-testid="button-toggle-photo-siding"]').click();
    await page.locator('[data-testid="button-mode-photos-only"]').click();
    const analyzeButton = page.locator('[data-testid="button-analyze-photos"]');
    await analyzeButton.waitFor({ timeout: 30000 });
    ok((await analyzeButton.textContent()).includes(`(${STAGED_PHOTO_LABELS.length})`),
      'the three staged facade photos are restored for this property');
    await analyzeButton.click();

    // The facade review lives inside the detailed roof breakdown.
    await page.locator('button', { hasText: 'Show linears, validation & notes' }).first()
      .click({ timeout: 30000 });

    const facadePanel = page.locator('[data-testid="facade-review-panel"]');
    // Two viewers can mount the same badge (inline + presentation stage); the
    // inline one is what the estimator looks at while measuring.
    const facadeBadge = page.locator('[data-testid="house-model-selected-facade"]').first();

    for (const expectation of COMPASS_EXPECTATIONS) {
      await page.locator(`[data-testid="main-rotate-${expectation.compass.toLowerCase()}"]`).click();
      await facadePanel.waitFor({ timeout: 30000 });
      await page.waitForFunction(
        (label) => document.querySelector('[data-testid="facade-review-panel"]')
          ?.textContent?.includes(`Selected calculated facade: ${label}`),
        expectation.label,
        { timeout: 15000 },
      );

      const panelText = await facadePanel.textContent();
      ok(panelText.includes(`Selected calculated facade: ${expectation.label}`),
        `${expectation.compass} opens the ${expectation.label} facade review panel`);
      ok(panelText.includes(expectation.wall),
        `${expectation.compass} reports the ${expectation.face} wall (${expectation.wall})`,
        panelText);
      // Openings and confidence differ per face, so a facade mix-up cannot pass
      // on two walls that happen to share a width.
      ok(panelText.includes(`${expectation.openings} recorded`),
        `${expectation.compass} reports the ${expectation.face} openings (${expectation.openings})`,
        panelText);
      ok(panelText.includes(expectation.confidence),
        `${expectation.compass} reports the ${expectation.face} confidence and source`,
        panelText);

      await facadeBadge.waitFor({ timeout: 15000 });
      const badgeText = (await facadeBadge.textContent()).trim();
      ok(badgeText === `◉ ${expectation.compass} facade`,
        `the 3D model highlights the ${expectation.compass} facade`,
        `badge read "${badgeText}"`);

      const headings = await page.evaluate(() => window.__facadeTestMapCalls || []);
      const expectedHeading = { N: 0, E: 90, S: 180, W: 270 }[expectation.compass];
      ok(headings.at(-1) === `heading:${expectedHeading}`,
        `${expectation.compass} also turns the map to ${expectedHeading}°`,
        `map calls: ${headings.join(', ')}`);

      if (expectation.photographed) {
        ok(panelText.includes('Field photo attached'),
          `the photographed ${expectation.face} reports its field photo`);
        ok(!panelText.includes('Not photographed — estimated.'),
          `the photographed ${expectation.face} is not labelled an estimate`);
      } else {
        ok(panelText.includes('No field photo'),
          `the unphotographed ${expectation.face} is flagged as missing evidence`);
        ok(panelText.includes('Not photographed — estimated.'),
          `the unphotographed ${expectation.face} says it is estimated`);
      }
    }

    // ── The unphotographed facade must hand off to its own capture slot ──────
    const slotLink = facadePanel.getByRole('button', { name: /Add a Back photo/i });
    ok(await slotLink.count() === 1, 'the estimated facade offers the matching photo slot');

    const backSlot = page.locator('[data-testid="slot-back"]');
    ok(await backSlot.count() === 1, 'the Back capture slot exists to receive that photo');
    await slotLink.click();
    await page.waitForTimeout(1200); // smooth scrollIntoView
    const slotInView = await backSlot.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    ok(slotInView, 'the link scrolls the Back photo slot into view');

    // A photographed facade must not offer the same "missing photo" hand-off.
    await page.locator('[data-testid="main-rotate-e"]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="facade-review-panel"]')
        ?.textContent?.includes('Selected calculated facade: East'),
      null,
      { timeout: 15000 },
    );
    ok(await facadePanel.getByRole('button', { name: /Add a .* photo/i }).count() === 0,
      'a photographed facade offers no missing-photo hand-off');

    ok(blockedCalls.length === 0,
      'no paid AI, upload, or messaging endpoint is called',
      `blocked: ${blockedCalls.join(', ')}`);
    ok(pageErrors.length === 0, 'the estimator page raises no uncaught errors', pageErrors.join(' | '));
  } finally {
    await browser.close();
    await cleanup();
    await pool.end();
  }

  console.log(`\n${passed} passed`);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
