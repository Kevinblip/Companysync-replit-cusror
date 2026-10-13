#!/usr/bin/env node
'use strict';

/**
 * Browser regression test for the satellite siding field-count override.
 *
 * The API responses are deterministic, but the test drives the real
 * AIEstimator UI for the known Centuryway address. It confirms the displayed
 * SQ value changes after typing a field count and returns to the AI value when
 * the input is cleared.
 */

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const KNOWN_ADDRESS = '20638 Centuryway Rd, Maple Heights, OH 44137';
const AI_WALL_AREA_SQ = '17.00';
const FIELD_OPENING_COUNT = 5;
const EXPECTED_OVERRIDE_SQ = '19.25'; // (2,000 gross - 5 × 15 sqft) / 100

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    return execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function json(route, body) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockApi(route) {
  const request = route.request();
  const url = new URL(request.url());
  if (!url.pathname.startsWith('/api/')) return route.continue();

  if (url.pathname === '/api/auth/user') {
    return json(route, {
      id: 'sat-opening-ui-user',
      email: 'sat-opening-ui@example.com',
      first_name: 'Satellite',
      last_name: 'Override',
      is_administrator: true,
    });
  }

  if (url.pathname.startsWith('/api/local/entity/Company')) {
    return json(route, [{
      id: 'sat-opening-ui-company',
      company_name: 'Satellite Override Test',
      created_by: 'sat-opening-ui@example.com',
      subscription_plan: 'enterprise',
      onboarding_completed: true,
    }]);
  }

  if (url.pathname.startsWith('/api/local/entity/StaffProfile')) {
    return json(route, [{
      id: 'sat-opening-ui-staff',
      company_id: 'sat-opening-ui-company',
      user_email: 'sat-opening-ui@example.com',
      is_administrator: true,
      role: 'admin',
    }]);
  }

  if (url.pathname === '/api/functions/invoke') {
    const payload = JSON.parse(request.postData() || '{}');
    if (payload.functionName === 'geocodeAddress') {
      return json(route, { data: { success: true, lat: 41.409, lng: -81.555 } });
    }
    if (payload.functionName === 'aiRoofMeasurement') {
      return json(route, {
        data: {
          success: true,
          roof_area_sq: 20,
          roof_area_sqft: 2000,
          waste_percentage: 10,
          ridge_lf: 40,
          hip_lf: 0,
          valley_lf: 0,
          rake_lf: 80,
          eave_lf: 200,
          pitch: '6/12',
          pitch_confidence: 'high',
          overall_confidence: 85,
          confidence_grade: 'B',
          tolerance_pct: 10,
          building_length_ft: 50,
          building_width_ft: 30,
          roof_type: 'gable',
        },
      });
    }
    if (payload.functionName === 'analyzeSidingMeasurement') {
      return json(route, {
        data: {
          success: true,
          gross_wall_area_sqft: 2000,
          wall_area_sqft: 1700,
          wall_area_sq: 17,
          opening_deduction_sqft: 300,
          opening_deduct_sqft: 300,
          perimeter_ft: 200,
          story_count: 1,
          story_height_ft: 9,
          windows_count: 8,
          doors_count: 2,
          garage_door_count: 0,
          siding_material: 'vinyl',
          siding_condition: 'good',
          overall_confidence: 85,
          confidence_grade: 'B',
          tolerance_pct: 10,
          measurement_graph: {
            totals: {
              net_siding_area_sqft: 1700,
              opening_deduction_sqft: 300,
            },
          },
        },
      });
    }
    return json(route, { data: {} });
  }

  return json(route, []);
}

async function main() {
  const executablePath = findChromium();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.addInitScript(() => {
      localStorage.setItem('aiEstimatorConfig', JSON.stringify({
        specialties: ['siding'],
        specialty: 'siding',
        storyCount: '1',
        storyHeightFt: '9',
        openingDeductionPct: '15',
        sidingWastePct: '10',
      }));

      // The test needs Maps to be considered loaded, but does not test the map.
      const controls = new Proxy({}, {
        get(target, key) {
          if (!target[key]) target[key] = [];
          return target[key];
        },
      });
      class MapStub {
        constructor() { this.controls = controls; }
        setMapTypeId() {}
        getMapTypeId() { return 'satellite'; }
        addListener() { return { remove() {} }; }
        setTilt() {}
        getTilt() { return 0; }
        setHeading() {}
        getHeading() { return 0; }
      }
      class MarkerStub {
        addListener() { return { remove() {} }; }
      }
      window.google = {
        maps: {
          places: {},
          Map: MapStub,
          Marker: MarkerStub,
          SymbolPath: { CIRCLE: 0 },
          ControlPosition: { RIGHT_TOP: 0 },
          event: { addListenerOnce() { return {}; }, removeListener() {} },
        },
      };
    });
    await page.route('**/*', mockApi);

    await page.goto(
      `${BASE_URL}/AIEstimator?property_address=${encodeURIComponent(KNOWN_ADDRESS)}`,
      { waitUntil: 'domcontentloaded', timeout: 30000 },
    );

    await page.getByRole('tab', { name: /storm tracking/i }).click();
    await page.locator('button').filter({ hasText: 'AI Auto-Detect' }).click();
    await page.locator('[data-testid="button-toggle-photo-siding"]').waitFor({ timeout: 30000 });
    await page.locator('[data-testid="button-toggle-photo-siding"]').click();
    await page.locator('[data-testid="button-mode-satellite"]').click();
    await page.locator('[data-testid="button-analyze-satellite-siding"]').click();

    const input = page.locator('[data-testid="input-sat-actual-openings-count"]');
    const wallAreaBadge = page.locator('[data-testid="sat-wall-area-sq"]');
    await input.waitFor({ timeout: 30000 });

    assert.equal((await wallAreaBadge.textContent()).trim(), AI_WALL_AREA_SQ);

    await input.fill(String(FIELD_OPENING_COUNT));
    assert.equal((await wallAreaBadge.textContent()).trim(), EXPECTED_OVERRIDE_SQ);

    await input.fill('');
    assert.equal((await wallAreaBadge.textContent()).trim(), AI_WALL_AREA_SQ);

    console.log(`✓ ${KNOWN_ADDRESS}: AI wall area starts at ${AI_WALL_AREA_SQ} SQ`);
    console.log(`✓ ${FIELD_OPENING_COUNT} field openings recalculate the badge to ${EXPECTED_OVERRIDE_SQ} SQ`);
    console.log(`✓ Clearing the field restores ${AI_WALL_AREA_SQ} SQ`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});