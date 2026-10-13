/**
 * capture-live.cjs — Per-beat live screenshots for all 26 training video topics.
 *
 * Usage (single topic):
 *   COOKIE=<value> TOPIC=dashboard node capture-live.cjs
 *
 * Usage (batch of topics):
 *   COOKIE=<value> TOPICS=dashboard,leads,estimates node capture-live.cjs
 *
 * Output: .local/video/shots-live/<topic>-<NN>.png
 *
 * Shot naming: topic-01.png through topic-09.png (max 9 per topic).
 * Segment files reference these as just the filename; assemblers use shots-live/ as SHOTS root.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium';
const BASE   = 'http://localhost:5000';

// Auto-derive session cookie via make-session.cjs when COOKIE env is not supplied.
// Requires DATABASE_URL + SESSION_SECRET env vars (always set in dev/prod).
function autoSession() {
  try {
    const { execSync } = require('child_process');
    const out = execSync(`node ${path.join(__dirname, 'make-session.cjs')}`, { encoding: 'utf8', env: process.env });
    const match = out.match(/SESSION_COOKIE=(\S+)/);
    if (match) return match[1]; // already URL-encoded
  } catch (e) { /* fall through — will fail below */ }
  return null;
}

const COOKIE = process.env.COOKIE || autoSession();
const OUT    = path.join(__dirname, 'shots-live');

if (!COOKIE) { console.error('COOKIE env var required, or set DATABASE_URL+SESSION_SECRET for auto-session'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

// ── Helpers ──────────────────────────────────────────────────────────────────
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function dismissPopups(page) {
  await page.evaluate(() => {
    const all = [...document.querySelectorAll('button, a, [role="button"]')];
    const noThanks = all.find((el) => /^\s*no thanks\s*$/i.test(el.textContent || ''));
    if (noThanks) noThanks.click();
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await delay(400);
}

async function scrollTo(page, y) {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), y);
  await delay(500);
}

async function tryClick(page, selector, timeout = 3000) {
  try {
    await page.waitForSelector(selector, { timeout });
    await page.click(selector);
    return true;
  } catch (_) { return false; }
}

async function tryEval(page, fn) {
  try { return await page.evaluate(fn); } catch (_) { return null; }
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  console.log(`  ✓ ${name}`);
  return file;
}

// ── Topic definitions ─────────────────────────────────────────────────────────
// Each topic is an async function(page) that captures its shots and returns array of filenames.
const TOPICS = {

  // ── 1: Dashboard ────────────────────────────────────────────────────────────
  async dashboard(page) {
    await page.goto(BASE + '/Dashboard', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'dashboard-01.png');      // full overview
    await scrollTo(page, 200);
    await shot(page, 'dashboard-02.png');      // metrics row
    await scrollTo(page, 500);
    await shot(page, 'dashboard-03.png');      // pipeline + build schedule widgets
    await scrollTo(page, 850);
    await shot(page, 'dashboard-04.png');      // invoices + activity feed
    await scrollTo(page, 1200);
    await shot(page, 'dashboard-05.png');      // action items panel
    await scrollTo(page, 0);
    // Try clicking customize/gear icon
    const gearClicked = await tryEval(page, () => {
      const btn = [...document.querySelectorAll('button')].find(b =>
        b.querySelector('svg') && /settings|customize|gear/i.test(b.getAttribute('aria-label') || b.title || ''));
      if (btn) { btn.click(); return true; } return false;
    });
    await delay(gearClicked ? 1200 : 200);
    await shot(page, 'dashboard-06.png');      // dashboard settings/customize overlay
    await page.keyboard.press('Escape').catch(() => {});
    await delay(400);
    // Mobile viewport shot
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000); await dismissPopups(page);
    await shot(page, 'dashboard-07.png');      // mobile view
    await scrollTo(page, 300);
    await shot(page, 'dashboard-08.png');      // mobile scrolled
    await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000); await dismissPopups(page);
    await shot(page, 'dashboard-09.png');      // back to desktop, full view
  },

  // ── 2: Leads ────────────────────────────────────────────────────────────────
  async leads(page) {
    await page.goto(BASE + '/Leads', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'leads-01.png');          // leads list overview
    // Open new lead form
    await tryEval(page, () => {
      const btn = [...document.querySelectorAll('button')].find(b => /new lead/i.test(b.textContent || ''));
      if (btn) btn.click();
    });
    await delay(1200);
    await shot(page, 'leads-02.png');          // new lead form / dialog open
    await page.keyboard.press('Escape').catch(() => {});
    await delay(600);
    await shot(page, 'leads-03.png');          // list view with stage chips visible
    await scrollTo(page, 300);
    await shot(page, 'leads-04.png');          // more list rows
    // Click first lead row to open detail
    const opened = await tryEval(page, () => {
      const row = document.querySelector('tr[data-testid], tbody tr, [data-testid^="row-lead"]');
      if (row) { row.click(); return true; } return false;
    });
    if (!opened) {
      // try clicking a lead card
      await tryEval(page, () => {
        const card = document.querySelector('[data-testid^="card-lead"], .lead-card, [class*="lead"]');
        if (card) { card.click(); return true; } return false;
      });
    }
    await delay(2000);
    await shot(page, 'leads-05.png');          // lead detail profile view
    await scrollTo(page, 400);
    await shot(page, 'leads-06.png');          // lead detail scrolled (notes, history)
    await scrollTo(page, 0);
    await shot(page, 'leads-07.png');          // lead detail top (score, map)
    await page.goto(BASE + '/Leads', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    // Filter by status
    await tryEval(page, () => {
      const sel = document.querySelector('select, [data-testid*="filter"], [data-testid*="status"]');
      if (sel) sel.click();
    });
    await delay(500);
    await shot(page, 'leads-08.png');          // filter dropdown open
    await page.keyboard.press('Escape').catch(() => {});
    await shot(page, 'leads-09.png');          // list with filters visible
  },

  // ── 3: Estimates ────────────────────────────────────────────────────────────
  async estimates(page) {
    await page.goto(BASE + '/Estimates', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'estimates-01.png');      // estimates list
    // Open new estimate dialog
    await tryEval(page, () => {
      const btn = [...document.querySelectorAll('button')].find(b => /new estimate/i.test(b.textContent || ''));
      if (btn) btn.click();
    });
    await delay(1500);
    await shot(page, 'estimates-02.png');      // new estimate form / customer select
    await page.keyboard.press('Escape').catch(() => {});
    await delay(600);
    // Click first estimate to open detail
    await tryEval(page, () => {
      const row = document.querySelector('[data-testid^="row-estimate"], tbody tr, .estimate-row');
      if (row) { row.click(); return true; }
      const link = document.querySelector('[href*="estimate"], [data-testid*="estimate-link"]');
      if (link) { link.click(); return true; }
      return false;
    });
    await delay(2500);
    await shot(page, 'estimates-03.png');      // estimate detail view
    await scrollTo(page, 400);
    await shot(page, 'estimates-04.png');      // line items section
    await scrollTo(page, 800);
    await shot(page, 'estimates-05.png');      // totals and insurance toggle
    await scrollTo(page, 0);
    // Try clicking Send button to show send dialog
    await tryEval(page, () => {
      const btn = [...document.querySelectorAll('button')].find(b => /^send$/i.test((b.textContent || '').trim()));
      if (btn) btn.click();
    });
    await delay(1200);
    await shot(page, 'estimates-06.png');      // send estimate dialog
    await page.keyboard.press('Escape').catch(() => {});
    await delay(400);
    // Navigate to Invoices (related context) instead of unreliable goBack
    await page.goto(BASE + '/Invoices', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'estimates-07.png');      // invoices (estimate→invoice flow)
    // Navigate back to Estimates list
    await page.goto(BASE + '/Estimates', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500);
    await scrollTo(page, 400);
    await shot(page, 'estimates-08.png');      // estimates list scrolled
    await scrollTo(page, 0);
    await shot(page, 'estimates-09.png');      // estimates list top
  },

  // ── 4: AI Estimator ─────────────────────────────────────────────────────────
  async 'ai-estimator'(page) {
    await page.goto(BASE + '/AIEstimator', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(4000); await dismissPopups(page);
    await shot(page, 'ai-estimator-01.png');   // AI estimator landing
    // Look for address input
    await tryEval(page, () => {
      const inp = document.querySelector('input[placeholder*="address" i], input[placeholder*="Address" i]');
      if (inp) { inp.focus(); inp.value = '123 Maple Street, Denver, CO 80203'; inp.dispatchEvent(new Event('input', {bubbles:true})); }
    });
    await delay(500);
    await shot(page, 'ai-estimator-02.png');   // address entered
    await page.keyboard.press('Escape').catch(() => {});
    await delay(300);
    // Click into an existing AI estimate if one exists
    const opened = await tryEval(page, () => {
      const row = document.querySelector('[data-testid^="row-"], tbody tr, .estimate-item');
      if (row) { row.click(); return true; } return false;
    });
    await delay(1500);
    await shot(page, 'ai-estimator-03.png');   // existing estimate or measurement results
    await scrollTo(page, 300);
    await shot(page, 'ai-estimator-04.png');   // measurements section
    await scrollTo(page, 600);
    await shot(page, 'ai-estimator-05.png');   // photos / damage analysis section
    await scrollTo(page, 900);
    await shot(page, 'ai-estimator-06.png');   // line items / estimate build
    await scrollTo(page, 1200);
    await shot(page, 'ai-estimator-07.png');   // totals and export section
    await scrollTo(page, 0);
    // Try Xactimate export dialog
    await tryEval(page, () => {
      const btn = [...document.querySelectorAll('button')].find(b => /xactimate|export/i.test(b.textContent || ''));
      if (btn) btn.click();
    });
    await delay(1200);
    await shot(page, 'ai-estimator-08.png');   // export dialog or overview
    await page.keyboard.press('Escape').catch(() => {});
    await delay(300);
    await shot(page, 'ai-estimator-09.png');   // AI estimator full view
  },

  // ── 5: Build Schedule ───────────────────────────────────────────────────────
  async 'build-schedule'(page) {
    await page.goto(BASE + '/BuildSchedule', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'build-schedule-01.png'); // build schedule list
    await scrollTo(page, 200);
    await shot(page, 'build-schedule-02.png'); // job cards
    // Open add new build dialog
    await tryEval(page, () => {
      const btn = [...document.querySelectorAll('button')].find(b => /new build|add job|schedule job/i.test(b.textContent || ''));
      if (btn) btn.click();
    });
    await delay(1500);
    await shot(page, 'build-schedule-03.png'); // new build dialog
    await page.keyboard.press('Escape').catch(() => {});
    await delay(600);
    // Click on a build to open detail
    const clicked = await tryEval(page, () => {
      const btn = document.querySelector('[data-testid^="button-edit-build-"], [data-testid^="button-view-build-"]');
      if (btn) { btn.click(); return true; }
      const row = document.querySelector('tbody tr, .build-row');
      if (row) { row.click(); return true; }
      return false;
    });
    await delay(2000);
    await shot(page, 'build-schedule-04.png'); // build detail / edit dialog
    await scrollTo(page, 300);
    await shot(page, 'build-schedule-05.png'); // scope of work checklist
    await page.keyboard.press('Escape').catch(() => {});
    await delay(600);
    await page.goto(BASE + '/BuildSchedule', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    await shot(page, 'build-schedule-06.png'); // back to list
    await scrollTo(page, 400);
    await shot(page, 'build-schedule-07.png'); // more jobs visible
    await scrollTo(page, 0);
    // Mobile viewport for crew access shot
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000); await dismissPopups(page);
    await shot(page, 'build-schedule-08.png'); // mobile crew view
    await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    await shot(page, 'build-schedule-09.png'); // desktop full view
  },

  // ── 6: Invoices ─────────────────────────────────────────────────────────────
  async invoices(page) {
    await page.goto(BASE + '/Invoices', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'invoices-01.png');       // invoices list
    // Open new invoice dialog
    await tryEval(page, () => {
      const btn = [...document.querySelectorAll('button')].find(b => /new invoice/i.test(b.textContent || ''));
      if (btn) btn.click();
    });
    await delay(1500);
    await shot(page, 'invoices-02.png');       // new invoice form
    await page.keyboard.press('Escape').catch(() => {});
    await delay(600);
    // Click first invoice to open detail
    await tryEval(page, () => {
      const row = document.querySelector('[data-testid^="row-invoice"], tbody tr, .invoice-row');
      if (row) { row.click(); return true; }
      return false;
    });
    await delay(2500);
    await shot(page, 'invoices-03.png');       // invoice detail (online pay button visible)
    await scrollTo(page, 300);
    await shot(page, 'invoices-04.png');       // payment tracking section
    // Navigate explicitly to Invoices list instead of unreliable goBack
    await page.goto(BASE + '/Invoices', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await scrollTo(page, 300);
    await shot(page, 'invoices-05.png');       // invoices list scrolled (aging visible)
    await scrollTo(page, 0);
    await shot(page, 'invoices-06.png');       // invoices list top with stats
    // Navigate to Payments page
    await page.goto(BASE + '/Payments', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'invoices-07.png');       // payments page
    await scrollTo(page, 300);
    await shot(page, 'invoices-08.png');       // payments scrolled
    await page.goto(BASE + '/Invoices', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500);
    await shot(page, 'invoices-09.png');       // back to invoices
  },

  // ── 7: Customers ────────────────────────────────────────────────────────────
  async customers(page) {
    await page.goto(BASE + '/Customers', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'customers-01.png');      // customers list
    await scrollTo(page, 200);
    await shot(page, 'customers-02.png');      // customer cards/rows
    // Click first customer
    await tryEval(page, () => {
      const row = document.querySelector('[data-testid^="row-customer"], tbody tr, .customer-row');
      if (row) { row.click(); return true; } return false;
    });
    await delay(2000);
    await shot(page, 'customers-03.png');      // customer detail profile
    await scrollTo(page, 300);
    await shot(page, 'customers-04.png');      // estimate/invoice history tab
    await scrollTo(page, 600);
    await shot(page, 'customers-05.png');      // notes feed
    // Try clicking communications tab
    await tryEval(page, () => {
      const tab = [...document.querySelectorAll('[role="tab"], button')].find(b => /comm|message/i.test(b.textContent || ''));
      if (tab) { tab.click(); return true; } return false;
    });
    await delay(1000);
    await shot(page, 'customers-06.png');      // communication history tab
    // Try documents tab
    await tryEval(page, () => {
      const tab = [...document.querySelectorAll('[role="tab"], button')].find(b => /doc|file|photo/i.test(b.textContent || ''));
      if (tab) { tab.click(); return true; } return false;
    });
    await delay(1000);
    await shot(page, 'customers-07.png');      // documents tab
    await page.goto(BASE + '/Customers', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    await shot(page, 'customers-08.png');      // customer list with tags
    await scrollTo(page, 400);
    await shot(page, 'customers-09.png');      // more customers
  },

  // ── 8: Staff ────────────────────────────────────────────────────────────────
  async staff(page) {
    await page.goto(BASE + '/StaffManagement', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'staff-01.png');          // staff list
    // Open add staff
    await tryEval(page, () => {
      const btn = [...document.querySelectorAll('button')].find(b => /add|invite|new staff|new member/i.test(b.textContent || ''));
      if (btn) btn.click();
    });
    await delay(1500);
    await shot(page, 'staff-02.png');          // add staff form
    await page.keyboard.press('Escape').catch(() => {});
    await delay(600);
    // Click first staff member
    await tryEval(page, () => {
      const row = document.querySelector('[data-testid^="row-staff"], tbody tr, .staff-row');
      if (row) { row.click(); return true; } return false;
    });
    await delay(2000);
    await shot(page, 'staff-03.png');          // staff member detail / edit
    await scrollTo(page, 300);
    await shot(page, 'staff-04.png');          // roles & commission section
    await page.keyboard.press('Escape').catch(() => {});
    await delay(400);
    await page.goto(BASE + '/StaffManagement', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    await shot(page, 'staff-05.png');          // staff list
    await scrollTo(page, 300);
    await shot(page, 'staff-06.png');          // more staff members
    await scrollTo(page, 0);
    await shot(page, 'staff-07.png');          // staff with roles visible
    // CommissionTracking
    await page.goto(BASE + '/CommissionTracking', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000); await dismissPopups(page);
    await shot(page, 'staff-08.png');          // commission tracking
    await scrollTo(page, 300);
    await shot(page, 'staff-09.png');          // commission details
  },

  // ── 9: Communications ───────────────────────────────────────────────────────
  async communications(page) {
    await page.goto(BASE + '/Leads', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'communications-01.png'); // leads list (comms hub context)
    // Click first lead to open their profile and go to communication tab
    await tryEval(page, () => {
      const row = document.querySelector('[data-testid^="row-lead"], tbody tr');
      if (row) { row.click(); return true; } return false;
    });
    await delay(2000);
    await shot(page, 'communications-02.png'); // lead profile showing message button
    // Click send message button
    await tryEval(page, () => {
      const btn = [...document.querySelectorAll('button')].find(b => /send|message|text/i.test(b.textContent || ''));
      if (btn) { btn.click(); return true; } return false;
    });
    await delay(1200);
    await shot(page, 'communications-03.png'); // send message dialog
    await page.keyboard.press('Escape').catch(() => {});
    await delay(400);
    await page.goto(BASE + '/LexiSettings', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'communications-04.png'); // Lexi AI settings
    await page.goto(BASE + '/SarahSettings', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'communications-05.png'); // Sarah AI receptionist settings
    await scrollTo(page, 400);
    await shot(page, 'communications-06.png'); // Sarah settings scrolled
    await page.goto(BASE + '/Leads', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    await shot(page, 'communications-07.png'); // leads list (bulk messaging context)
    await scrollTo(page, 300);
    await shot(page, 'communications-08.png'); // more leads for bulk
    await shot(page, 'communications-09.png'); // leads communication view
  },

  // ── 10: Automations ─────────────────────────────────────────────────────────
  async automations(page) {
    await page.goto(BASE + '/Workflows', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'automations-01.png');    // workflows list
    // Open new workflow
    await tryEval(page, () => {
      const btn = [...document.querySelectorAll('button')].find(b => /new|create|add workflow/i.test(b.textContent || ''));
      if (btn) btn.click();
    });
    await delay(1500);
    await shot(page, 'automations-02.png');    // create workflow form / trigger selection
    await page.keyboard.press('Escape').catch(() => {});
    await delay(600);
    // Click first workflow to open
    await tryEval(page, () => {
      const row = document.querySelector('[data-testid^="row-workflow"], tbody tr, .workflow-row');
      if (row) { row.click(); return true; } return false;
    });
    await delay(2000);
    await shot(page, 'automations-03.png');    // workflow detail (trigger + steps)
    await scrollTo(page, 300);
    await shot(page, 'automations-04.png');    // workflow steps
    await scrollTo(page, 600);
    await shot(page, 'automations-05.png');    // more steps / delays
    await page.keyboard.press('Escape').catch(() => {});
    await delay(400);
    await page.goto(BASE + '/Workflows', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    await shot(page, 'automations-06.png');    // workflows list
    await scrollTo(page, 200);
    await shot(page, 'automations-07.png');    // more workflows
    await scrollTo(page, 400);
    await shot(page, 'automations-08.png');    // workflow templates
    await scrollTo(page, 0);
    await shot(page, 'automations-09.png');    // automations overview
  },

  // ── 11: Storm Tracking ──────────────────────────────────────────────────────
  async 'storm-tracking'(page) {
    await page.goto(BASE + '/StormTracking', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(4000); await dismissPopups(page);
    await shot(page, 'storm-tracking-01.png'); // storm map overview
    await scrollTo(page, 200);
    await shot(page, 'storm-tracking-02.png'); // storm map with pins
    // Click a storm pin/event if visible
    await tryEval(page, () => {
      const pin = document.querySelector('[data-testid^="storm"], .storm-pin, .storm-event');
      if (pin) { pin.click(); return true; } return false;
    });
    await delay(1500);
    await shot(page, 'storm-tracking-03.png'); // storm detail popup
    await page.keyboard.press('Escape').catch(() => {});
    await delay(400);
    await scrollTo(page, 400);
    await shot(page, 'storm-tracking-04.png'); // historical list/table
    await scrollTo(page, 0);
    // Storm alert settings
    await page.goto(BASE + '/StormAlertSettings', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'storm-tracking-05.png'); // alert settings page
    await scrollTo(page, 300);
    await shot(page, 'storm-tracking-06.png'); // alert preferences
    await page.goto(BASE + '/StormTracking', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(3000);
    await shot(page, 'storm-tracking-07.png'); // storm map
    await scrollTo(page, 300);
    await shot(page, 'storm-tracking-08.png'); // storm data table
    await scrollTo(page, 600);
    await shot(page, 'storm-tracking-09.png'); // more storm events
  },

  // ── 12: Settings ────────────────────────────────────────────────────────────
  async settings(page) {
    await page.goto(BASE + '/Settings', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'settings-01.png');       // settings overview
    await scrollTo(page, 300);
    await shot(page, 'settings-02.png');       // company profile section
    await scrollTo(page, 600);
    await shot(page, 'settings-03.png');       // price list / templates section
    await scrollTo(page, 900);
    await shot(page, 'settings-04.png');       // payment settings
    await scrollTo(page, 1200);
    await shot(page, 'settings-05.png');       // notifications
    await scrollTo(page, 0);
    // Try clicking a settings tab
    await tryEval(page, () => {
      const tab = [...document.querySelectorAll('[role="tab"], .settings-nav a, nav a')].find(t => /company|profile/i.test(t.textContent || ''));
      if (tab) { tab.click(); return true; } return false;
    });
    await delay(1000);
    await shot(page, 'settings-06.png');       // company profile tab
    await tryEval(page, () => {
      const tab = [...document.querySelectorAll('[role="tab"], .settings-nav a, nav a')].find(t => /integrat/i.test(t.textContent || ''));
      if (tab) { tab.click(); return true; } return false;
    });
    await delay(1000);
    await shot(page, 'settings-07.png');       // integrations tab
    await scrollTo(page, 300);
    await shot(page, 'settings-08.png');       // more integrations
    await scrollTo(page, 0);
    await shot(page, 'settings-09.png');       // settings full view
  },

  // ── 13: Reports ─────────────────────────────────────────────────────────────
  async reports(page) {
    await page.goto(BASE + '/Reports', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'reports-01.png');        // reports overview
    await scrollTo(page, 200);
    await shot(page, 'reports-02.png');        // revenue charts
    await scrollTo(page, 500);
    await shot(page, 'reports-03.png');        // lead source report
    await scrollTo(page, 800);
    await shot(page, 'reports-04.png');        // close rate charts
    await scrollTo(page, 0);
    // Try switching report tabs
    await tryEval(page, () => {
      const tab = [...document.querySelectorAll('[role="tab"], button')].find(t => /pipeline|lead/i.test(t.textContent || ''));
      if (tab) { tab.click(); return true; } return false;
    });
    await delay(1000);
    await shot(page, 'reports-05.png');        // pipeline report tab
    await tryEval(page, () => {
      const tab = [...document.querySelectorAll('[role="tab"], button')].find(t => /job|perform/i.test(t.textContent || ''));
      if (tab) { tab.click(); return true; } return false;
    });
    await delay(1000);
    await shot(page, 'reports-06.png');        // job performance tab
    await tryEval(page, () => {
      const tab = [...document.querySelectorAll('[role="tab"], button')].find(t => /commission/i.test(t.textContent || ''));
      if (tab) { tab.click(); return true; } return false;
    });
    await delay(1000);
    await shot(page, 'reports-07.png');        // commission report tab
    await scrollTo(page, 300);
    await shot(page, 'reports-08.png');        // report detail view
    await scrollTo(page, 0);
    await shot(page, 'reports-09.png');        // reports overview again
  },

  // ── 14: Financing ───────────────────────────────────────────────────────────
  async financing(page) {
    await page.goto(BASE + '/Estimates', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'financing-01.png');      // estimates list (financing context)
    // Open an estimate
    await tryEval(page, () => {
      const row = document.querySelector('[data-testid^="row-estimate"], tbody tr');
      if (row) { row.click(); return true; } return false;
    });
    await delay(2000);
    await shot(page, 'financing-02.png');      // estimate detail
    await scrollTo(page, 600);
    await shot(page, 'financing-03.png');      // financing toggle / options section
    await scrollTo(page, 900);
    await shot(page, 'financing-04.png');      // monthly payment breakdown
    await page.goto(BASE + '/Estimates', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    // Settings financing
    await page.goto(BASE + '/Settings', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await tryEval(page, () => {
      const el = [...document.querySelectorAll('*')].find(e => /financ/i.test(e.textContent || '') && e.children.length < 5);
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await delay(800);
    await shot(page, 'financing-05.png');      // settings financing section
    await page.goto(BASE + '/Estimates', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    await shot(page, 'financing-06.png');      // estimates list
    await tryEval(page, () => {
      const row = document.querySelector('[data-testid^="row-estimate"], tbody tr');
      if (row) { row.click(); return true; } return false;
    });
    await delay(2000);
    await scrollTo(page, 300);
    await shot(page, 'financing-07.png');      // estimate with financing options
    await scrollTo(page, 0);
    await shot(page, 'financing-08.png');      // estimate overview
    await shot(page, 'financing-09.png');      // estimate with totals
  },

  // ── 15: Mobile ──────────────────────────────────────────────────────────────
  async mobile(page) {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.goto(BASE + '/BuildSchedule', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3000); await dismissPopups(page);
    await shot(page, 'mobile-01.png');         // mobile build schedule
    await scrollTo(page, 300);
    await shot(page, 'mobile-02.png');         // mobile job cards
    await page.goto(BASE + '/Leads', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000); await dismissPopups(page);
    await shot(page, 'mobile-03.png');         // mobile leads
    await page.goto(BASE + '/Dashboard', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000); await dismissPopups(page);
    await shot(page, 'mobile-04.png');         // mobile dashboard
    await scrollTo(page, 300);
    await shot(page, 'mobile-05.png');         // mobile dashboard scrolled
    await page.goto(BASE + '/AIEstimator', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000); await dismissPopups(page);
    await shot(page, 'mobile-06.png');         // mobile AI estimator
    await page.goto(BASE + '/Invoices', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000); await dismissPopups(page);
    await shot(page, 'mobile-07.png');         // mobile invoices
    await scrollTo(page, 200);
    await shot(page, 'mobile-08.png');         // mobile invoice list
    await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });
    await page.goto(BASE + '/BuildSchedule', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    await shot(page, 'mobile-09.png');         // back to desktop view
  },

  // ── 16: Reviews & Growth ────────────────────────────────────────────────────
  async reviews(page) {
    await page.goto(BASE + '/Dashboard', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'reviews-01.png');        // dashboard (review context / growth)
    await scrollTo(page, 400);
    await shot(page, 'reviews-02.png');        // action items (review request auto-trigger)
    await page.goto(BASE + '/BuildSchedule', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'reviews-03.png');        // build schedule (job complete = review trigger)
    await scrollTo(page, 300);
    await shot(page, 'reviews-04.png');        // job cards (complete status)
    await page.goto(BASE + '/Settings', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await tryEval(page, () => {
      const el = [...document.querySelectorAll('*')].find(e => /review|growth|referral/i.test(e.textContent || '') && e.children.length < 5);
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await delay(800);
    await shot(page, 'reviews-05.png');        // settings review request template
    await page.goto(BASE + '/Reports', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'reviews-06.png');        // reports (conversion funnel / referral tracking)
    await scrollTo(page, 400);
    await shot(page, 'reviews-07.png');        // report charts
    await page.goto(BASE + '/Leads', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000); await dismissPopups(page);
    await shot(page, 'reviews-08.png');        // leads (referral source tracking)
    await scrollTo(page, 300);
    await shot(page, 'reviews-09.png');        // leads with referral source column
  },

  // ── 17: QuickBooks ──────────────────────────────────────────────────────────
  async quickbooks(page) {
    await page.goto(BASE + '/Invoices', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'quickbooks-01.png');     // invoices (QB context)
    await scrollTo(page, 300);
    await shot(page, 'quickbooks-02.png');     // invoice list
    await page.goto(BASE + '/Settings', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await tryEval(page, () => {
      const el = [...document.querySelectorAll('*')].find(e => /quickbooks|intuit|QB/i.test(e.textContent || '') && e.children.length < 5);
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await delay(800);
    await shot(page, 'quickbooks-03.png');     // settings QB integration
    await scrollTo(page, 300);
    await shot(page, 'quickbooks-04.png');     // QB connect button
    await page.goto(BASE + '/Invoices', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    await tryEval(page, () => {
      const row = document.querySelector('[data-testid^="row-invoice"], tbody tr');
      if (row) { row.click(); return true; } return false;
    });
    await delay(2000);
    await shot(page, 'quickbooks-05.png');     // invoice detail (sync to QB)
    await scrollTo(page, 300);
    await shot(page, 'quickbooks-06.png');     // invoice payment + QB status
    await page.goto(BASE + '/Invoices', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    await scrollTo(page, 500);
    await shot(page, 'quickbooks-07.png');     // invoices with export button
    await scrollTo(page, 0);
    await shot(page, 'quickbooks-08.png');     // invoices overview
    await shot(page, 'quickbooks-09.png');     // invoices full view
  },

  // ── 18: Contracts / E-Signatures ────────────────────────────────────────────
  async contracts(page) {
    await page.goto(BASE + '/Contracts', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'contracts-01.png');      // contracts list
    await page.goto(BASE + '/ContractTemplates', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'contracts-02.png');      // contract templates
    // Open/click a template
    await tryEval(page, () => {
      const row = document.querySelector('[data-testid^="row-contract"], tbody tr, .contract-row');
      if (row) { row.click(); return true; } return false;
    });
    await delay(2500);
    await shot(page, 'contracts-03.png');      // contract editor/template detail
    await scrollTo(page, 400);
    await shot(page, 'contracts-04.png');      // contract content editor
    // Navigate to Estimates (contracts sent with estimates)
    await page.goto(BASE + '/Estimates', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'contracts-05.png');      // estimates (contracts sent alongside)
    // Navigate to Customers (signed contracts context)
    await page.goto(BASE + '/Customers', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'contracts-06.png');      // customers (contracts per customer)
    // Navigate back to Contracts list
    await page.goto(BASE + '/Contracts', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500);
    await shot(page, 'contracts-07.png');      // contracts list
    await scrollTo(page, 300);
    await shot(page, 'contracts-08.png');      // contracts list scrolled
    // Navigate to Settings (contract defaults)
    await page.goto(BASE + '/Settings', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'contracts-09.png');      // settings (contract configuration)
  },

  // ── 19: Price List ──────────────────────────────────────────────────────────
  async pricelist(page) {
    await page.goto(BASE + '/Settings', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    // Navigate to price list section
    await tryEval(page, () => {
      const link = [...document.querySelectorAll('a, [role="tab"], button, nav *')].find(e => /price list|pricing|materials/i.test(e.textContent || ''));
      if (link) { link.click(); return true; } return false;
    });
    await delay(1500);
    await shot(page, 'pricelist-01.png');      // price list page / settings section
    await scrollTo(page, 200);
    await shot(page, 'pricelist-02.png');      // price list items
    await scrollTo(page, 500);
    await shot(page, 'pricelist-03.png');      // more price items
    // Add item dialog
    await tryEval(page, () => {
      const btn = [...document.querySelectorAll('button')].find(b => /add|new|import/i.test(b.textContent || ''));
      if (btn) btn.click();
    });
    await delay(1200);
    await shot(page, 'pricelist-04.png');      // add item form
    await page.keyboard.press('Escape').catch(() => {});
    await delay(400);
    await scrollTo(page, 0);
    await shot(page, 'pricelist-05.png');      // price list top
    await scrollTo(page, 300);
    await shot(page, 'pricelist-06.png');      // categories view
    await scrollTo(page, 700);
    await shot(page, 'pricelist-07.png');      // more items
    await scrollTo(page, 0);
    await page.goto(BASE + '/Estimates', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000); await dismissPopups(page);
    await tryEval(page, () => {
      const row = document.querySelector('[data-testid^="row-estimate"], tbody tr');
      if (row) { row.click(); return true; } return false;
    });
    await delay(2000);
    await scrollTo(page, 300);
    await shot(page, 'pricelist-08.png');      // estimate using price list
    await scrollTo(page, 0);
    await shot(page, 'pricelist-09.png');      // estimate with line items from price list
  },

  // ── 20: AI Voice / Receptionist ─────────────────────────────────────────────
  async aivoice(page) {
    await page.goto(BASE + '/SarahSettings', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'aivoice-01.png');        // Sarah / Alex settings
    await scrollTo(page, 300);
    await shot(page, 'aivoice-02.png');        // training / knowledge base
    await scrollTo(page, 600);
    await shot(page, 'aivoice-03.png');        // business hours / schedule
    await scrollTo(page, 900);
    await shot(page, 'aivoice-04.png');        // call routing settings
    await page.goto(BASE + '/LexiSettings', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'aivoice-05.png');        // Lexi AI text settings
    await page.goto(BASE + '/Leads', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000); await dismissPopups(page);
    // Open a lead to show AI call log
    await tryEval(page, () => {
      const row = document.querySelector('[data-testid^="row-lead"], tbody tr');
      if (row) { row.click(); return true; } return false;
    });
    await delay(2000);
    await shot(page, 'aivoice-06.png');        // lead with AI call transcript
    await scrollTo(page, 400);
    await shot(page, 'aivoice-07.png');        // call log details
    await page.goto(BASE + '/SarahSettings', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    await shot(page, 'aivoice-08.png');        // receptionist settings
    await scrollTo(page, 0);
    await shot(page, 'aivoice-09.png');        // Alex / Sarah overview
  },

  // ── 21: Customer Portal ─────────────────────────────────────────────────────
  async portal(page) {
    await page.goto(BASE + '/Estimates', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'portal-01.png');         // estimates list (portal context)
    // Open estimate detail
    await tryEval(page, () => {
      const row = document.querySelector('[data-testid^="row-estimate"], tbody tr');
      if (row) { row.click(); return true; } return false;
    });
    await delay(2500);
    await shot(page, 'portal-02.png');         // estimate detail (customer receives link)
    await scrollTo(page, 400);
    await shot(page, 'portal-03.png');         // estimate financing section
    await scrollTo(page, 0);
    // Try clicking "Send" or portal-related button
    await tryEval(page, () => {
      const btn = [...document.querySelectorAll('button, a')].find(b => /portal|customer view|view as|send/i.test(b.textContent || ''));
      if (btn) { btn.click(); return true; } return false;
    });
    await delay(1500);
    await shot(page, 'portal-04.png');         // send dialog / portal link dialog
    await page.keyboard.press('Escape').catch(() => {});
    await delay(400);
    // Navigate to Customers (customer sees portal from their side)
    await page.goto(BASE + '/Customers', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'portal-05.png');         // customers list (portal recipients)
    // Navigate to Invoices (customer pays via portal)
    await page.goto(BASE + '/Invoices', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'portal-06.png');         // invoices (customer payment portal)
    await scrollTo(page, 300);
    await shot(page, 'portal-07.png');         // invoices scrolled
    // Navigate to Settings (portal branding config)
    await page.goto(BASE + '/Settings', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'portal-08.png');         // settings (portal configuration)
    // Navigate back to Estimates
    await page.goto(BASE + '/Estimates', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500);
    await shot(page, 'portal-09.png');         // estimates list (portal links)
  },

  // ── 22: Photos / Damage Reports ─────────────────────────────────────────────
  async photos(page) {
    await page.goto(BASE + '/AIEstimator', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(4000); await dismissPopups(page);
    await shot(page, 'photos-01.png');         // AI estimator landing
    await scrollTo(page, 400);
    await shot(page, 'photos-02.png');         // AI estimator scrolled (photo upload area)
    await scrollTo(page, 0);
    // Navigate to Leads (CrewCam / field photos context)
    await page.goto(BASE + '/Leads', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'photos-03.png');         // leads list (field inspection photos)
    // Navigate to Customers (customer property photos)
    await page.goto(BASE + '/Customers', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'photos-04.png');         // customers (damage photos per property)
    // Navigate to BuildSchedule (job progress photos)
    await page.goto(BASE + '/BuildSchedule', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'photos-05.png');         // build schedule (job site photos)
    await scrollTo(page, 300);
    await shot(page, 'photos-06.png');         // build schedule scrolled
    // Navigate to Reports (photo-based damage reports)
    await page.goto(BASE + '/Reports', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'photos-07.png');         // reports (AI damage reports)
    // Navigate back to AIEstimator for final shots
    await page.goto(BASE + '/AIEstimator', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(3000); await dismissPopups(page);
    await shot(page, 'photos-08.png');         // AI estimator overview
    await scrollTo(page, 600);
    await shot(page, 'photos-09.png');         // AI estimator lower section
  },

  // ── 23: Google Calendar ─────────────────────────────────────────────────────
  async calendar(page) {
    await page.goto(BASE + '/BuildSchedule', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'calendar-01.png');       // build schedule (calendar context)
    await scrollTo(page, 300);
    await shot(page, 'calendar-02.png');       // jobs on schedule
    await page.goto(BASE + '/Settings', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await tryEval(page, () => {
      const el = [...document.querySelectorAll('*')].find(e => /google calendar|calendar sync/i.test(e.textContent || '') && e.children.length < 5);
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await delay(800);
    await shot(page, 'calendar-03.png');       // settings Google Calendar section
    await scrollTo(page, 200);
    await shot(page, 'calendar-04.png');       // connect calendar button
    await page.goto(BASE + '/BuildSchedule', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    // Open a build job
    await tryEval(page, () => {
      const btn = document.querySelector('[data-testid^="button-edit-build-"]');
      if (btn) { btn.click(); return true; }
      const row = document.querySelector('tbody tr');
      if (row) { row.click(); return true; }
      return false;
    });
    await delay(2000);
    await shot(page, 'calendar-05.png');       // build detail with calendar event
    await scrollTo(page, 300);
    await shot(page, 'calendar-06.png');       // job dates / schedule
    await page.keyboard.press('Escape').catch(() => {});
    await delay(400);
    await page.goto(BASE + '/BuildSchedule', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    await shot(page, 'calendar-07.png');       // schedule list
    await scrollTo(page, 400);
    await shot(page, 'calendar-08.png');       // more scheduled jobs
    await scrollTo(page, 0);
    await shot(page, 'calendar-09.png');       // build schedule overview
  },

  // ── 24: GoHighLevel ─────────────────────────────────────────────────────────
  async gohighlevel(page) {
    await page.goto(BASE + '/Leads', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'gohighlevel-01.png');    // leads (GHL context)
    await scrollTo(page, 300);
    await shot(page, 'gohighlevel-02.png');    // leads list
    await page.goto(BASE + '/Settings', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await tryEval(page, () => {
      const el = [...document.querySelectorAll('*')].find(e => /gohighlevel|go high level|GHL/i.test(e.textContent || '') && e.children.length < 5);
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await delay(800);
    await shot(page, 'gohighlevel-03.png');    // settings GHL integration
    await scrollTo(page, 300);
    await shot(page, 'gohighlevel-04.png');    // GHL API key / connect
    await page.goto(BASE + '/Leads', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    await shot(page, 'gohighlevel-05.png');    // leads with GHL sync status
    await scrollTo(page, 300);
    await shot(page, 'gohighlevel-06.png');    // more leads
    // Click lead to show GHL fields
    await tryEval(page, () => {
      const row = document.querySelector('[data-testid^="row-lead"], tbody tr');
      if (row) { row.click(); return true; } return false;
    });
    await delay(2000);
    await shot(page, 'gohighlevel-07.png');    // lead detail with source info
    await scrollTo(page, 400);
    await shot(page, 'gohighlevel-08.png');    // communication history
    await page.goto(BASE + '/Leads', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    await shot(page, 'gohighlevel-09.png');    // leads list overview
  },

  // ── 25: Action Items / Tasks ─────────────────────────────────────────────────
  async tasks(page) {
    await page.goto(BASE + '/Dashboard', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'tasks-01.png');          // dashboard with action items
    await scrollTo(page, 400);
    await shot(page, 'tasks-02.png');          // action items panel
    await scrollTo(page, 800);
    await shot(page, 'tasks-03.png');          // task list
    await scrollTo(page, 0);
    // Try opening action items / task detail
    await tryEval(page, () => {
      const btn = [...document.querySelectorAll('[data-testid*="action-item"], [data-testid*="task"], .action-item')].find(e => e.click);
      if (btn) { btn.click(); return true; } return false;
    });
    await delay(1200);
    await shot(page, 'tasks-04.png');          // task detail / action item
    await page.keyboard.press('Escape').catch(() => {});
    await delay(400);
    await page.goto(BASE + '/Leads', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000); await dismissPopups(page);
    await tryEval(page, () => {
      const row = document.querySelector('[data-testid^="row-lead"], tbody tr');
      if (row) { row.click(); return true; } return false;
    });
    await delay(2000);
    await shot(page, 'tasks-05.png');          // lead with tasks panel
    // Try add task button
    await tryEval(page, () => {
      const btn = [...document.querySelectorAll('button')].find(b => /add task|new task/i.test(b.textContent || ''));
      if (btn) btn.click();
    });
    await delay(1200);
    await shot(page, 'tasks-06.png');          // add task form
    await page.keyboard.press('Escape').catch(() => {});
    await delay(400);
    await scrollTo(page, 500);
    await shot(page, 'tasks-07.png');          // task history on lead
    await page.goto(BASE + '/Dashboard', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    await scrollTo(page, 300);
    await shot(page, 'tasks-08.png');          // action items on dashboard
    await scrollTo(page, 700);
    await shot(page, 'tasks-09.png');          // overdue / upcoming tasks
  },

  // ── 26: Getting Started / Onboarding ────────────────────────────────────────
  async onboarding(page) {
    await page.goto(BASE + '/Settings', { waitUntil: 'networkidle2', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'onboarding-01.png');     // settings overview (getting started)
    await scrollTo(page, 200);
    await shot(page, 'onboarding-02.png');     // company profile section
    await scrollTo(page, 500);
    await shot(page, 'onboarding-03.png');     // price list settings
    await page.goto(BASE + '/Estimates', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000); await dismissPopups(page);
    await shot(page, 'onboarding-04.png');     // estimates (estimate template context)
    await page.goto(BASE + '/Leads', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000); await dismissPopups(page);
    // Open new lead form
    await tryEval(page, () => {
      const btn = [...document.querySelectorAll('button')].find(b => /new lead/i.test(b.textContent || ''));
      if (btn) btn.click();
    });
    await delay(1200);
    await shot(page, 'onboarding-05.png');     // new lead form (first lead)
    await page.keyboard.press('Escape').catch(() => {});
    await delay(400);
    await page.goto(BASE + '/Leads', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(1500);
    await shot(page, 'onboarding-06.png');     // leads list
    await page.goto(BASE + '/StaffManagement', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2500); await dismissPopups(page);
    await shot(page, 'onboarding-07.png');     // team / invite (step 6 of onboarding)
    await page.goto(BASE + '/Settings', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000);
    await scrollTo(page, 600);
    await shot(page, 'onboarding-08.png');     // integrations (QB, Calendar, Twilio)
    await scrollTo(page, 0);
    await shot(page, 'onboarding-09.png');     // settings overview final
  },
};

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  // Determine which topics to run
  const topicArg = process.env.TOPIC || '';
  const topicsArg = process.env.TOPICS || '';
  let toRun = [];
  if (topicArg) {
    toRun = [topicArg.trim()];
  } else if (topicsArg) {
    toRun = topicsArg.split(',').map(t => t.trim());
  } else {
    toRun = Object.keys(TOPICS);
  }

  console.log(`Capturing topics: ${toRun.join(', ')}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--hide-scrollbars', '--disable-extensions',
      '--disable-plugins', '--disable-accelerated-2d-canvas',
      '--renderer-process-limit=1',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });
  await page.setCookie({
    name: 'connect.sid', value: COOKIE, domain: 'localhost', path: '/', httpOnly: true,
  });

  for (const topicName of toRun) {
    const fn = TOPICS[topicName];
    if (!fn) { console.error(`Unknown topic: ${topicName}`); continue; }
    console.log(`\n── Topic: ${topicName} ──`);
    try {
      await fn(page);
      // Reset viewport after each topic
      await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });
    } catch (err) {
      console.error(`${topicName}: FAILED — ${err.message}`);
      await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });
    }
  }

  await browser.close();
  console.log('\nAll topics done.');
})();
