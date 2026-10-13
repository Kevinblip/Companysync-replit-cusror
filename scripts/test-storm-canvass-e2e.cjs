#!/usr/bin/env node
/**
 * Storm canvassing end-to-end regression.
 *
 * Creates an isolated, authenticated manager/rep tenant, builds a dedicated
 * campaign from selected-address-shaped data, hands it to Route Planner and
 * Field App, logs a door knock, and confirms the manager's campaign total.
 *
 * This test never calls a marketing, email, SMS, or workflow-send endpoint.
 *
 * Prerequisites: npm run dev, DATABASE_URL, SESSION_SECRET, and Playwright.
 * Usage: npm run test:storm-canvass-e2e
 */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const { chromium } = require('playwright');
const { createPool } = require('./lib/db-pool.cjs');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool = createPool({ connectionString: process.env.DATABASE_URL });
const OWNER_EMAIL = 'smoke-storm-canvass-owner@example.com';
const OWNER_SID = 'smoke_storm_canvass_owner_session';
const CAMPAIGN_NAME = 'Storm Canvass E2E — Potential Impact Only';
const STORM_TITLE = 'E2E Hail Search Area';
const SELECTED_ADDRESSES = [
  { id: 'storm-e2e-101', street: '101 Main St', city: 'Testville', state: 'OH', zip: '44101', lat: 41.501, lon: -81.701, ownerName: 'Alex Address' },
  { id: 'storm-e2e-102', street: '102 Main St', city: 'Testville', state: 'OH', zip: '44101', lat: 41.503, lon: -81.699, ownerName: 'Blair Address' },
  { id: 'storm-e2e-103', street: '103 Main St', city: 'Testville', state: 'OH', zip: '44101', lat: 41.505, lon: -81.697, ownerName: 'Casey Address' },
];
const REPS = [
  { email: 'smoke-storm-canvass-alpha@example.com', name: 'Storm Alpha Rep' },
  { email: 'smoke-storm-canvass-bravo@example.com', name: 'Storm Bravo Rep' },
];

let passed = 0;
let companyId;
let campaignId;
let activityId;

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

async function entity(method, type, bodyOrId, cookie) {
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
    // A 401/403 proves the HTTP server is ready but the fixture session is
    // wrong, so fail immediately instead of hiding an authentication issue.
    if (response.status !== 503 && response.status !== 0) return response;
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw new Error(`authenticated entity API did not become ready (last HTTP ${lastStatus})`);
}

function selectedCampaignPayload() {
  // This mirrors the planner's round-robin assignment over its selected
  // address data. Keeping full address objects catches a regression that
  // accidentally drops route coordinates during campaign creation.
  const addresses = SELECTED_ADDRESSES.map((address, index) => {
    const rep = REPS[index % REPS.length];
    return {
      ...address,
      assigned_rep_email: rep.email,
      assigned_rep_name: rep.name,
      assignment_order: Math.floor(index / REPS.length) + 1,
      canvass_status: 'assigned',
    };
  });
  return {
    name: CAMPAIGN_NAME,
    status: 'ready',
    storm_id: 'storm-e2e-hail',
    storm_title: STORM_TITLE,
    potential_impact_notice: 'This campaign is prioritized from a storm warning/search area. It does not confirm damage at any address.',
    opportunity_method: 'Storm severity, available radar/spotter context, proximity, and available property-value signals',
    address_count: addresses.length,
    selected_reps: REPS.map(rep => ({
      rep_email: rep.email,
      rep_name: rep.name,
      address_count: addresses.filter(address => address.assigned_rep_email === rep.email).length,
    })),
    addresses,
  };
}

async function cleanup(cookie) {
  const remove = async (type, id) => {
    if (!id) return;
    await entity('DELETE', type, id, cookie).catch(() => {});
  };
  await remove('FieldActivity', activityId);
  await remove('StormCanvassCampaign', campaignId);
  if (companyId) {
    for (const rep of REPS) {
      const profiles = await fetchJson(
        `${BASE_URL}/api/local/entity/StaffProfile?company_id=${encodeURIComponent(companyId)}&user_email=${encodeURIComponent(rep.email)}`,
        { headers: { Cookie: cookie } },
      ).catch(() => ({ data: [] }));
      for (const profile of Array.isArray(profiles.data) ? profiles.data : []) await remove('StaffProfile', profile.id);
    }
    const ownerProfiles = await fetchJson(
      `${BASE_URL}/api/local/entity/StaffProfile?company_id=${encodeURIComponent(companyId)}&user_email=${encodeURIComponent(OWNER_EMAIL)}`,
      { headers: { Cookie: cookie } },
    ).catch(() => ({ data: [] }));
    for (const profile of Array.isArray(ownerProfiles.data) ? ownerProfiles.data : []) await remove('StaffProfile', profile.id);
    await remove('Company', companyId);
  }
  await pool.query('DELETE FROM sessions WHERE sid = $1', [OWNER_SID]).catch(() => {});
}

async function main() {
  if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
    throw new Error('DATABASE_URL and SESSION_SECRET are required for this authenticated regression.');
  }
  const plannerSource = fs.readFileSync('src/components/storms/StormCanvassPlanner.jsx', 'utf8');
  const routeSource = fs.readFileSync('src/pages/InspectionRouting.jsx', 'utf8');
  const repSource = fs.readFileSync('src/pages/FieldRepApp.jsx', 'utf8');
  const trackerSource = fs.readFileSync('src/pages/FieldSalesTracker.jsx', 'utf8');

  console.log('\n=== Storm Canvassing End-to-End Regression ===\n');
  ok(plannerSource.includes('potential_impact_notice: "This campaign is prioritized from a storm warning/search area. It does not confirm damage at any address."'),
    'planner persists the potential-impact, not-confirmed-damage disclaimer');
  ok(plannerSource.includes('selectedRepEmails[index % selectedRepEmails.length]') &&
    plannerSource.includes('assignment_order: Math.floor(index / selectedRepEmails.length) + 1'),
  'planner retains deterministic round-robin rep assignment');
  ok(plannerSource.includes('sessionStorage.setItem("stormRouteAddresses"') &&
    routeSource.includes('data-testid="start-storm-campaign-btn"'),
  'planner-to-Route-Planner campaign handoff contract remains present');
  ok(repSource.includes('storm_campaign_id: activeStormCampaign?.id || null') &&
    trackerSource.includes('activity.storm_campaign_id === campaign.id'),
  'Field App activity and manager campaign count use the same campaign ID');

  const health = await fetchJson(`${BASE_URL}/api/auth/user`);
  ok(health.status < 500, 'development server is responding', `HTTP ${health.status}`);

  const cookie = forgeSessionCookie(OWNER_SID);
  const session = {
    cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' },
    passport: { user: { claims: { email: OWNER_EMAIL } } },
  };
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = $2::jsonb, expire = $3`,
    [OWNER_SID, JSON.stringify(session), new Date(Date.now() + 3600000)],
  );
  const entityApi = await waitForEntityApi(cookie);
  ok(entityApi.status === 200, 'authenticated entity API is ready before fixture creation', `HTTP ${entityApi.status}`);

  const company = await entity('POST', 'Company', {
    company_name: 'Storm Canvass E2E Test Co', created_by: OWNER_EMAIL, onboarding_completed: true,
  }, cookie);
  ok(company.status === 200 || company.status === 201, 'authenticated manager creates isolated company', `HTTP ${company.status}`);
  companyId = company.data?.id;
  ok(!!companyId, 'company ID is returned');

  for (const rep of [{ email: OWNER_EMAIL, name: 'Storm Canvass Manager', admin: true }, ...REPS]) {
    const profile = await entity('POST', 'StaffProfile', {
      company_id: companyId, user_email: rep.email, full_name: rep.name,
      is_administrator: !!rep.admin, is_active: true, role: rep.admin ? 'admin' : 'rep',
    }, cookie);
    ok(profile.status === 200 || profile.status === 201, `staff profile created for ${rep.name}`, `HTTP ${profile.status}`);
  }

  const campaignPayload = { company_id: companyId, ...selectedCampaignPayload() };
  const campaign = await entity('POST', 'StormCanvassCampaign', campaignPayload, cookie);
  ok(campaign.status === 200 || campaign.status === 201, 'authenticated test creates dedicated StormCanvassCampaign', `HTTP ${campaign.status}`);
  campaignId = campaign.data?.id;
  ok(!!campaignId, 'campaign ID is returned');
  ok(campaign.data?.potential_impact_notice === campaignPayload.potential_impact_notice,
    'campaign stores the potential-impact disclaimer');
  ok(campaign.data?.addresses?.map(item => item.assigned_rep_email).join(',') === `${REPS[0].email},${REPS[1].email},${REPS[0].email}`,
    'selected addresses are deterministically assigned Alpha, Bravo, Alpha');
  ok(campaign.data?.selected_reps?.map(item => item.address_count).join(',') === '2,1',
    'campaign preserves per-rep assigned-door totals');

  const systemChromium = '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium';
  const browser = await chromium.launch({
    headless: true,
    ...(fs.existsSync(systemChromium) ? { executablePath: systemChromium } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const hostname = new URL(BASE_URL).hostname;
  const context = await browser.newContext({
    baseURL: BASE_URL,
    permissions: ['geolocation'],
    geolocation: { latitude: 41.501, longitude: -81.701 },
    storageState: {
      cookies: [{ name: 'connect.sid', value: decodeURIComponent(cookie.replace('connect.sid=', '')), domain: hostname, path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }],
      origins: [],
    },
  });
  await context.addInitScript(({ cid, payload }) => {
    localStorage.setItem('last_used_company_id', cid);
    sessionStorage.setItem('stormRouteAddresses', JSON.stringify(payload));
  }, {
    cid: companyId,
    payload: {
      title: CAMPAIGN_NAME,
      mode: 'storm_campaign',
      campaign: { id: campaignId, name: CAMPAIGN_NAME, storm_title: STORM_TITLE, assignments: campaignPayload.selected_reps },
      addresses: campaignPayload.addresses.map(address => ({ ...address, name: address.ownerName, status: 'new' })),
    },
  });

  let marketingAttempt;
  let activityPayload;
  const page = await context.newPage();
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    const url = request.url().toLowerCase();
    const body = request.postData() || '';
    if (/send(email|sms)|marketing|outreach|campaign-send/.test(`${url} ${body}`)) marketingAttempt = `${request.method()} ${url}`;
    if (url.includes('/api/local/entity/fieldactivity')) {
      try { activityPayload = JSON.parse(body); } catch (_) {}
    }
  });

  try {
    await page.goto('/InspectionRouting', { waitUntil: 'networkidle', timeout: 30000 });
    const handoff = page.locator('[data-testid="start-storm-campaign-btn"]');
    await handoff.waitFor({ state: 'visible', timeout: 20000 });
    ok(await handoff.innerText().then(text => text.includes('Open campaign in Field App')),
      'Route Planner receives the campaign handoff');
    await Promise.all([
      page.waitForURL(/FieldRepApp/, { timeout: 20000 }),
      handoff.click(),
    ]);
    await page.locator('[data-testid="active-storm-campaign"]').waitFor({ state: 'visible', timeout: 20000 });
    ok((await page.locator('[data-testid="active-storm-campaign"]').innerText()).includes(CAMPAIGN_NAME),
      'Field App receives the active campaign context');

    const doorKnock = page.locator('[data-testid="button-door-knock"]');
    await doorKnock.waitFor({ state: 'visible', timeout: 20000 });
    await doorKnock.click();
    await page.getByText('Activity logged successfully!', { exact: false }).waitFor({ state: 'visible', timeout: 20000 });
    ok(activityPayload?.storm_campaign_id === campaignId && activityPayload.activity_type === 'door_knock',
      'Field App logs a door knock with the campaign ID');

    const activities = await fetchJson(
      `${BASE_URL}/api/local/entity/FieldActivity?company_id=${encodeURIComponent(companyId)}&_limit=20`,
      { headers: { Cookie: cookie } },
    );
    const savedActivity = (Array.isArray(activities.data) ? activities.data : [])
      .find(item => item.storm_campaign_id === campaignId && item.activity_type === 'door_knock');
    activityId = savedActivity?.id;
    ok(!!activityId, 'campaign-linked FieldActivity persists for manager reporting');

    await page.goto('/FieldSalesTracker', { waitUntil: 'networkidle', timeout: 30000 });
    const campaignRow = page.getByText(CAMPAIGN_NAME, { exact: true });
    await campaignRow.waitFor({ state: 'visible', timeout: 20000 });
    const rowText = await campaignRow.locator('xpath=../..').innerText();
    ok(rowText.includes('3 doors planned') && rowText.includes('1 doors worked'),
      'manager-facing campaign result counts the linked door knock', rowText);
    ok(!marketingAttempt, 'test does not send marketing outreach', marketingAttempt);
  } finally {
    await browser.close();
  }
}

(async () => {
  const cookie = process.env.SESSION_SECRET ? forgeSessionCookie(OWNER_SID) : '';
  try {
    await main();
    console.log(`\n${passed} storm canvassing checks passed.`);
  } catch (error) {
    console.error('\nStorm canvassing regression failed:', error.message);
    process.exitCode = 1;
  } finally {
    await cleanup(cookie);
    await pool.end();
  }
})();