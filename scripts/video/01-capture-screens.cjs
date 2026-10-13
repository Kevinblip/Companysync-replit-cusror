#!/usr/bin/env node
/**
 * Capture screenshots of auth-gated pages for the Lead Finder / Storm training video.
 * Forges a session cookie for the existing user, then puppeteers each page.
 * Run: node scripts/video/01-capture-screens.cjs
 */
'use strict';

const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');
const { createPool } = require('../lib/db-pool.cjs');

const OUT_DIR = path.join(__dirname, 'frames');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) { console.error('SESSION_SECRET not set'); process.exit(1); }

const BASE_URL = `http://127.0.0.1:5000`;

// ── Session forging (mirrors db/local-auth.cjs) ───────────────────────────────
function signSessionId(sid, secret) {
  const sig = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return 's:' + sid + '.' + sig;
}

async function mintSession(pool) {
  const userId    = 'loc_mmkefnsw_wwg1lr';
  const email     = 'yicnteam@gmail.com';
  const companyId = 'loc_mmdvp1h5_e8i9eb';
  const sid = crypto.randomUUID();
  const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
  const sessionData = {
    cookie: { originalMaxAge: SESSION_MAX_AGE, expires: new Date(Date.now() + SESSION_MAX_AGE).toISOString(), secure: true, httpOnly: true, path: '/', sameSite: 'lax' },
    passport: { user: { claims: { sub: userId, email, first_name: 'Kevin', last_name: 'Stone', full_name: 'Kevin Stone', profile_image_url: null }, access_token: null, refresh_token: null, expires_at: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE / 1000 } },
  };
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, $3) ON CONFLICT (sid) DO UPDATE SET sess = $2, expire = $3`,
    [sid, JSON.stringify(sessionData), new Date(Date.now() + SESSION_MAX_AGE)]
  );
  return { sid, signed: signSessionId(sid, SESSION_SECRET) };
}

// ── Segments to capture ───────────────────────────────────────────────────────
const SEGMENTS = [
  {
    id: '01-storm-tracking',
    url: '/StormTracking',
    wait: 4000,
    scroll: 0,
    label: 'Storm Tracking',
  },
  {
    id: '02-storm-card',
    url: '/StormTracking',
    wait: 5000,
    scroll: 600,
    label: 'Storm card — Addresses panel with Save Canvass List button',
    triggerAddressPanel: true,
  },
  {
    id: '03-property-importer',
    url: '/PropertyDataImporter',
    wait: 3000,
    scroll: 0,
    label: 'Property Data Importer',
  },
  {
    id: '04-lead-finder-empty',
    url: '/LeadFinder',
    wait: 3000,
    scroll: 0,
    label: 'Lead Finder – search form',
  },
  {
    id: '05-lead-finder-results',
    url: '/LeadFinder?location=44146',
    wait: 6000,
    scroll: 300,
    label: 'Lead Finder – results with storm scores',
    triggerSearch: true,
  },
  {
    id: '06-api-keys-lead-data',
    url: '/APIKeysSettings',
    wait: 3000,
    scroll: 9999,
    label: 'API Keys – Lead Data Sources (BatchLeads / PropStream)',
  },
  {
    id: '07-field-sales-tracker',
    url: '/FieldSalesTracker',
    wait: 4000,
    scroll: 0,
    label: 'Field Sales Tracker',
  },
];

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

async function run() {
  const pool = createPool({ connectionString: process.env.DATABASE_URL });
  const { signed } = await mintSession(pool);
  await pool.end();

  const puppeteer = require('puppeteer-core');
  const chromiumPath = require('child_process').execSync('which chromium').toString().trim();

  const browser = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1440,900'],
  });

  for (const seg of SEGMENTS) {
    if (ONLY && !ONLY.some(id => seg.id.startsWith(id))) continue;
    const outFile = path.join(OUT_DIR, `${seg.id}.png`);
    if (fs.existsSync(outFile)) { console.log(`[SKIP] ${seg.id} (already exists)`); continue; }

    console.log(`[CAPTURE] ${seg.id}: ${seg.url}`);
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setCookie({
      name: 'connect.sid',
      value: encodeURIComponent(signed),
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: false,
    });

    await page.goto(`${BASE_URL}${seg.url}`, { waitUntil: 'networkidle2', timeout: 30000 });

    // Dismiss onboarding tour if present (do NOT climb to parent nodes)
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const noThanks = btns.find(b => !b.closest('nav,aside,[data-sidebar]') && /no.?thanks|skip|dismiss|close/i.test(b.textContent));
      if (noThanks) noThanks.click();
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 800));

    // Scroll
    if (seg.scroll) {
      await page.evaluate(s => window.scrollTo(0, s), seg.scroll);
      await new Promise(r => setTimeout(r, 600));
    }

    // Trigger search for the results segment
    if (seg.triggerSearch) {
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => /find leads|search/i.test(b.textContent));
        if (btn) btn.click();
      }).catch(() => {});
      await new Promise(r => setTimeout(r, seg.wait));
    } else if (seg.triggerAddressPanel) {
      // Click the Addresses button on the first storm card to open the OSM panel
      await new Promise(r => setTimeout(r, seg.wait)); // let cards render
      await page.evaluate(() => {
        // Find the first Addresses button (has "Addresses" text and is not a nav link)
        const btns = Array.from(document.querySelectorAll('button'));
        const addrBtn = btns.find(b => /addresses/i.test(b.textContent) && !b.closest('nav,aside'));
        if (addrBtn) addrBtn.click();
      }).catch(() => {});
      await new Promise(r => setTimeout(r, 12000)); // wait for OSM fetch + render
      // Ensure panel is visible by scrolling to it
      await page.evaluate(() => {
        const panel = document.querySelector('[class*="border-dashed"]') || document.querySelector('[class*="indigo"]');
        if (panel) panel.scrollIntoView({ behavior: 'instant', block: 'center' });
      }).catch(() => {});
      await new Promise(r => setTimeout(r, 600));
    } else {
      await new Promise(r => setTimeout(r, seg.wait));
    }

    await page.screenshot({ path: outFile, fullPage: false });
    console.log(`  → saved ${outFile}`);
    await page.close();
  }

  await browser.close();
  console.log('\n[DONE] All captures complete. Frames in', OUT_DIR);
}

run().catch(e => { console.error(e); process.exit(1); });
