#!/usr/bin/env node
/**
 * Plan UI Gate Smoke Test
 * ──────────────────────────────────────────────────────────────────
 * Verifies that Layout.jsx's subscription plan filter actually removes
 * restricted sidebar items from the DOM for each tier.
 *
 * Complements test:plan-gates (which tests hasFeatureAccess logic and
 * numeric limits) — this test loads the real React app in a headless
 * browser and checks what the sidebar actually renders.
 *
 * Detection strategy
 * ------------------
 * Layout.jsx sets  id="menu-item-<id>"  on the SidebarMenuItem wrapper
 * of every top-level nav item and on the SidebarMenuButton of every
 * submenu item that survives the plan filter.
 *
 * Radix Collapsible lazy-mounts its content (children not in DOM until
 * first open).  Therefore the test:
 *
 *   1. Uses TOP-LEVEL plan-gated items as the stabilisation signal.
 *      These live outside any Collapsible and are immediately removed /
 *      added as the React company data fetch resolves:
 *         Basic       → wait for `field-operations` to disappear
 *         Business    → wait for `field-operations` present, `accounting` absent
 *         Enterprise  → wait for `accounting` to appear
 *
 *   2. Expands every collapsed sidebar submenu using Puppeteer's real
 *      click API (not page.evaluate/click — React controlled Collapsibles
 *      require real pointer events to update state and lazy-mount content).
 *
 *   3. Asserts presence / absence of specific item ids.
 *
 * Requires:
 *   - App server on PORT (default 5000): npm run dev
 *   - DATABASE_URL + SESSION_SECRET env vars
 *   - Seed companies: npm run seed:plan-companies
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const crypto    = require('crypto');
const puppeteer = require('puppeteer-core');

const CHROME   = '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium';
const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

if (!SESSION_SECRET) {
  console.error('✗ SESSION_SECRET env var is required');
  process.exit(1);
}

const pool = createPool({ connectionString: process.env.DATABASE_URL });

// ── Counters ─────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const sessionIds = [];

function ok(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else       { console.log(`  ✗ ${name}`); failed++; }
}

// ── Session helpers ───────────────────────────────────────────────
function signSessionId(sid, secret) {
  const sig = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return 's:' + sid + '.' + sig;
}

async function forgeSession(userId, email, firstName, lastName) {
  const sid = crypto.randomUUID();
  const sessData = {
    cookie: {
      originalMaxAge: SESSION_MAX_AGE,
      expires: new Date(Date.now() + SESSION_MAX_AGE).toISOString(),
      secure: false,
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
    },
    passport: {
      user: {
        claims: {
          sub: userId,
          email,
          first_name: firstName || '',
          last_name:  lastName  || '',
          full_name:  `${firstName || ''} ${lastName || ''}`.trim() || email,
          profile_image_url: null,
        },
        access_token:  null,
        refresh_token: null,
        expires_at: Math.floor(Date.now() / 1000) + (SESSION_MAX_AGE / 1000),
      },
    },
  };
  const expire = new Date(Date.now() + SESSION_MAX_AGE);
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = $2, expire = $3`,
    [sid, JSON.stringify(sessData), expire]
  );
  sessionIds.push(sid);
  return encodeURIComponent(signSessionId(sid, SESSION_SECRET));
}

async function cleanupSessions() {
  if (sessionIds.length > 0) {
    await pool.query('DELETE FROM sessions WHERE sid = ANY($1)', [sessionIds]).catch(() => {});
  }
}

// ── DOM helpers ───────────────────────────────────────────────────

/** Return all menu-item-* ids currently present in the DOM. */
async function menuIds(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[id^="menu-item-"]')]
      .map(el => el.id.replace('menu-item-', ''))
  );
}

/**
 * Poll until predicate(ids) returns true or timeout elapses.
 * Returns the last snapshot of ids regardless.
 */
async function waitUntilIds(page, predicate, timeoutMs = 22000, intervalMs = 400) {
  const deadline = Date.now() + timeoutMs;
  let ids = await menuIds(page);
  while (!predicate(ids) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, intervalMs));
    ids = await menuIds(page);
  }
  return ids;
}

/**
 * Collect all menu-item-* ids that the current plan allows, by opening
 * every sidebar parent submenu one at a time.
 *
 * Key constraints:
 * - Radix CollapsibleContent lazy-mounts: children not in DOM until opened.
 * - The sidebar uses a single `openMenu` state (one submenu open at a time).
 *   Opening menu B automatically closes menu A, unmounting A's children.
 *
 * Strategy: iterate through each parent container id in order.
 *   For each one: click its trigger to open it (which closes the previous),
 *   collect the current set of menu-item-* ids, union into a running set.
 * Final result = every id that ever appeared for this plan.
 *
 * Uses Puppeteer's native ElementHandle.click() (real pointer events)
 * because the sidebar Collapsibles are controlled (open prop driven by
 * React state) — page.evaluate().click() doesn't reliably fire the
 * React synthetic event handlers for controlled components.
 */
async function collectAllMenuIds(page) {
  // Start with ids that are already in the DOM (top-level items).
  const allIds = new Set(await menuIds(page));

  // Find all parent SidebarMenuItem containers that have a collapsible trigger.
  const containerIds = await page.evaluate(() =>
    [...document.querySelectorAll('[id^="menu-item-"]')]
      .filter(el => el.querySelector('button[aria-expanded]'))
      .map(el => el.id)
  );

  for (const containerId of containerIds) {
    // Find the trigger button for this container.
    const handle = await page.$(`#${containerId} button[aria-expanded]`);
    if (!handle) continue;

    const isOpen = await handle
      .evaluate(el => el.getAttribute('aria-expanded') === 'true')
      .catch(() => false);

    if (!isOpen) {
      // Click to expand — this also closes whichever menu is currently open.
      await handle.click().catch(() => {});
      // Wait for React to update state + Radix to mount content.
      await new Promise(r => setTimeout(r, 800));
    }

    // Union newly-mounted submenu ids into the running set.
    const current = await menuIds(page);
    for (const id of current) allIds.add(id);
  }

  return [...allIds];
}

// ── Load app as a specific plan user ─────────────────────────────
async function loadAsPlan(browser, { cookieEnc, companyId }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.setCookie({
    name:     'connect.sid',
    value:    cookieEnc,
    domain:   'localhost',
    path:     '/',
    httpOnly: true,
    sameSite: 'Lax',
  });

  // First load: plant the cookie; also write localStorage so Layout.jsx
  // resolves the correct company on next load without waiting for the
  // staff-profile cascade.
  await page.goto(BASE_URL + '/Dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate((cid) => {
    try { localStorage.setItem('last_used_company_id', cid); } catch (_) {}
  }, companyId);

  // Reload so Layout.jsx sees last_used_company_id on first render.
  await page.goto(BASE_URL + '/Dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for the sidebar's base render (dashboard is always first).
  await page.waitForSelector('#menu-item-dashboard', { timeout: 25000 });

  return page;
}

// ── Per-plan test runners ─────────────────────────────────────────

async function testBasic(browser, plan) {
  console.log(`\n[ Basic ]  ${plan.email}\n`);
  const page = await loadAsPlan(browser, plan);
  try {
    // Plan stabilisation: top-level `field-operations` and `reports` are
    // present before company data loads (trial defaults to level 3) and
    // disappear once the Basic record resolves (level 0 removes them).
    const topIds = await waitUntilIds(
      page,
      (ids) => !ids.includes('field-operations') && !ids.includes('reports'),
      22000
    );
    if (topIds.includes('field-operations')) {
      console.log('  ⚠  Plan did not stabilise in time — field-operations still present');
    }

    // Expand each sidebar submenu one-at-a-time, union all ever-seen ids.
    const ids = await collectAllMenuIds(page);

    // Always-present (Basic can access these)
    ok('Dashboard in sidebar',        ids.includes('dashboard'));
    ok('Lexi AI in sidebar',          ids.includes('lexi'));
    ok('AI Estimator in sidebar',     ids.includes('ai-estimator'));

    // Top-level sections hidden for Basic
    ok('Field Operations absent (Basic)',  !ids.includes('field-operations'));
    ok('Reports section absent (Basic)',   !ids.includes('reports'));
    ok('Accounting absent (Basic)',        !ids.includes('accounting'));

    // Business+ submenu items absent
    ok('Storm Tracking absent (Basic)',        !ids.includes('storm-tracking'));
    ok('Workflow Automation absent (Basic)',   !ids.includes('workflow-automation'));
    ok('AI Staff absent (Basic)',              !ids.includes('ai-staff'));
    ok('Live Call Dashboard absent (Basic)',   !ids.includes('live-call-dashboard'));
    ok('Campaigns absent (Basic)',             !ids.includes('campaigns'));
    ok('Lead Finder absent (Basic)',           !ids.includes('lead-finder'));
    ok('AI Damage absent (Basic)',             !ids.includes('ai-damage'));
    ok('Commissions absent (Basic)',           !ids.includes('commissions'));

    // Enterprise-only absent
    ok('Subcontractors absent (Basic)',        !ids.includes('subcontractors'));

    // A hidden menu item is not sufficient: owners/admins must also be unable
    // to bypass the plan limit by typing the route directly.
    await page.goto(BASE_URL + '/Workflows', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const blockedFromWorkflows = await page.waitForFunction(
      () => window.location.pathname === '/Dashboard',
      { timeout: 22000 }
    ).then(() => true).catch(() => false);
    ok('Direct /Workflows route blocked (Basic)', blockedFromWorkflows);

  } finally {
    await page.close();
  }
}

async function testBusiness(browser, plan) {
  console.log(`\n[ Business ]  ${plan.email}\n`);
  const page = await loadAsPlan(browser, plan);
  try {
    // Plan stabilisation: field-operations present (level ≥ 1 OK) and
    // accounting absent (level 2 required).
    const topIds = await waitUntilIds(
      page,
      (ids) => ids.includes('field-operations') && !ids.includes('accounting'),
      22000
    );
    if (!topIds.includes('field-operations')) {
      console.log('  ⚠  Plan did not stabilise — field-operations absent for Business');
    }

    const ids = await collectAllMenuIds(page);

    // Always-present
    ok('Dashboard in sidebar',         ids.includes('dashboard'));
    ok('Lexi AI in sidebar',           ids.includes('lexi'));

    // Business+ items must be present
    ok('Field Operations present (Business)',     ids.includes('field-operations'));
    ok('Reports present (Business)',              ids.includes('reports'));
    ok('Storm Tracking present (Business)',       ids.includes('storm-tracking'));
    ok('Workflow Automation present (Business)',  ids.includes('workflow-automation'));
    ok('AI Staff present (Business)',             ids.includes('ai-staff'));
    ok('Campaigns present (Business)',            ids.includes('campaigns'));
    ok('AI Damage present (Business)',            ids.includes('ai-damage'));
    ok('Commissions present (Business)',          ids.includes('commissions'));

    // Enterprise-only items absent
    ok('Accounting absent (Business)',        !ids.includes('accounting'));
    ok('Subcontractors absent (Business)',    !ids.includes('subcontractors'));
    ok('Video Training absent (Business)',   !ids.includes('video-training'));

    await page.goto(BASE_URL + '/Workflows', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const canOpenWorkflows = await page.waitForSelector(
      'h1',
      { timeout: 22000 }
    ).then(async () => page.evaluate(() => document.querySelector('h1')?.textContent === 'Workflow Automation'))
      .catch(() => false);
    ok('Direct /Workflows route allowed (Business)', canOpenWorkflows);

  } finally {
    await page.close();
  }
}

async function testEnterprise(browser, plan) {
  console.log(`\n[ Enterprise ]  ${plan.email}\n`);
  const page = await loadAsPlan(browser, plan);
  try {
    // Plan stabilisation: accounting appears when plan resolves to Enterprise.
    const topIds = await waitUntilIds(
      page,
      (ids) => ids.includes('accounting'),
      22000
    );
    if (!topIds.includes('accounting')) {
      console.log('  ⚠  Plan did not stabilise — accounting absent for Enterprise');
    }

    const ids = await collectAllMenuIds(page);

    // Always-present
    ok('Dashboard in sidebar',         ids.includes('dashboard'));
    ok('Lexi AI in sidebar',           ids.includes('lexi'));

    // Business+ items present
    ok('Field Operations present (Enterprise)',    ids.includes('field-operations'));
    ok('Reports present (Enterprise)',             ids.includes('reports'));
    ok('Storm Tracking present (Enterprise)',      ids.includes('storm-tracking'));
    ok('Workflow Automation present (Enterprise)', ids.includes('workflow-automation'));
    ok('AI Staff present (Enterprise)',            ids.includes('ai-staff'));
    ok('Campaigns present (Enterprise)',           ids.includes('campaigns'));
    ok('AI Damage present (Enterprise)',           ids.includes('ai-damage'));
    ok('Commissions present (Enterprise)',         ids.includes('commissions'));

    // Enterprise-only items present
    ok('Accounting present (Enterprise)',      ids.includes('accounting'));
    ok('Subcontractors present (Enterprise)',  ids.includes('subcontractors'));
    ok('Video Training present (Enterprise)', ids.includes('video-training'));

    await page.goto(BASE_URL + '/Workflows', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const canOpenWorkflows = await page.waitForSelector(
      'h1',
      { timeout: 22000 }
    ).then(async () => page.evaluate(() => document.querySelector('h1')?.textContent === 'Workflow Automation'))
      .catch(() => false);
    ok('Direct /Workflows route allowed (Enterprise)', canOpenWorkflows);

  } finally {
    await page.close();
  }
}

// ── Main ──────────────────────────────────────────────────────────
(async () => {
  console.log('\n── Plan UI Gate Smoke Test ────────────────────────────────────\n');

  // Verify seed companies
  const compRes = await pool.query(
    `SELECT id FROM companies WHERE id = ANY($1::text[])`,
    [['plan_test_basic', 'plan_test_business', 'plan_test_enterprise']]
  );
  const foundComps = new Set(compRes.rows.map(r => r.id));
  const missingComps = ['plan_test_basic', 'plan_test_business', 'plan_test_enterprise']
    .filter(id => !foundComps.has(id));
  if (missingComps.length > 0) {
    console.error(`✗ Missing seed companies: ${missingComps.join(', ')}`);
    console.error('  Run: npm run seed:plan-companies\n');
    await pool.end();
    process.exit(1);
  }

  // Fetch user records
  const userRes = await pool.query(
    `SELECT id AS user_id, email FROM users WHERE email = ANY($1)`,
    [['test@basic.test', 'test@business.test', 'test@enterprise.test']]
  );
  const byEmail = {};
  for (const r of userRes.rows) byEmail[r.email] = r;

  const missingUsers = ['test@basic.test', 'test@business.test', 'test@enterprise.test']
    .filter(e => !byEmail[e]);
  if (missingUsers.length > 0) {
    console.error(`✗ Missing user records: ${missingUsers.join(', ')}`);
    console.error('  Run: npm run seed:plan-companies\n');
    await pool.end();
    process.exit(1);
  }

  const PLANS = [
    { label: 'Basic',      email: 'test@basic.test',      companyId: 'plan_test_basic' },
    { label: 'Business',   email: 'test@business.test',   companyId: 'plan_test_business' },
    { label: 'Enterprise', email: 'test@enterprise.test', companyId: 'plan_test_enterprise' },
  ];

  for (const p of PLANS) {
    const u = byEmail[p.email];
    p.cookieEnc = await forgeSession(u.user_id, p.email, 'Test', p.label);
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    await testBasic(browser,      PLANS[0]);
    await testBusiness(browser,   PLANS[1]);
    await testEnterprise(browser, PLANS[2]);

  } catch (err) {
    console.error('\n✗ Unexpected error:', err.message);
    console.error(err.stack);
    failed++;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupSessions();
    await pool.end().catch(() => {});
  }

  // ── Summary ───────────────────────────────────────────────────
  console.log('\n── Summary ────────────────────────────────────────────────────');
  console.log(`   Passed: ${passed}   Failed: ${failed}`);
  if (failed > 0) {
    console.log('\n✗ Some gates are wrong — see details above.\n');
    process.exit(1);
  } else {
    console.log('\n✓ All plan UI gates verified.\n');
  }
})();
