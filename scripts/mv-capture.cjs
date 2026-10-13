#!/usr/bin/env node
/**
 * mv-capture.cjs — capture real live-app screenshots for the marketing videos.
 *
 * For each config in marketing-video-configs.cjs, forges an authenticated session
 * for the demo company (loc_demo_video_001 / Summit Peak Roofing), navigates to
 * cfg.route at a 390x844 mobile viewport, and saves scripts/mv-shots/<id>.png.
 *
 * Usage:
 *   node scripts/mv-capture.cjs              # all 15
 *   VIDEOS=01,03 node scripts/mv-capture.cjs # subset
 *
 * Requires: dev server running on :5000, DATABASE_URL, SESSION_SECRET.
 * Dedupes by route — each unique route is captured once and copied per id.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createPool } = require('./lib/db-pool.cjs');
const puppeteer = require('puppeteer-core');

const CONFIGS = require('./marketing-video-configs.cjs');
const CHROME = '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium';
const BASE = 'http://localhost:5000';
const OUT = path.join(__dirname, 'mv-shots');

const COMPANY_ID = 'loc_demo_video_001';
const USER_ID = 'usr_demo_video_001';
const USER_EMAIL = 'demo@summitpeakroofing.com';

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || !process.env.DATABASE_URL) {
  console.error('SESSION_SECRET and DATABASE_URL are required');
  process.exit(1);
}
if (!fs.existsSync(CHROME)) {
  console.error(`Chromium not found at ${CHROME} — install via nix or update path`);
  process.exit(1);
}

const ONLY = process.env.VIDEOS
  ? process.env.VIDEOS.split(',').map((s) => s.trim().padStart(2, '0'))
  : null;
const configs = ONLY ? CONFIGS.filter((c) => ONLY.includes(c.id)) : CONFIGS;

fs.mkdirSync(OUT, { recursive: true });

// Same algorithm as db/local-auth.cjs signSessionId
function signSessionId(sid, secret) {
  const sig = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return 's:' + sid + '.' + sig;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function forgeSession(pool) {
  // Verify demo tenant exists — never capture a real tenant's data
  const u = await pool.query('SELECT id FROM users WHERE id=$1 AND email=$2 AND company_id=$3', [USER_ID, USER_EMAIL, COMPANY_ID]);
  if (!u.rows.length) throw new Error('Demo user/company missing — run scripts/video seeders first');

  const sid = crypto.randomUUID();
  const maxAge = 60 * 60 * 1000;
  const sess = {
    cookie: {
      originalMaxAge: maxAge,
      expires: new Date(Date.now() + maxAge).toISOString(),
      secure: true, httpOnly: true, path: '/', sameSite: 'lax',
    },
    passport: {
      user: {
        claims: {
          sub: USER_ID, email: USER_EMAIL,
          first_name: 'Demo', last_name: 'Owner', full_name: 'Demo Owner',
          profile_image_url: null,
        },
        access_token: null, refresh_token: null,
        expires_at: Math.floor(Date.now() / 1000) + maxAge / 1000,
      },
    },
  };
  await pool.query(
    'INSERT INTO sessions (sid, sess, expire) VALUES ($1,$2,$3)',
    [sid, JSON.stringify(sess), new Date(Date.now() + maxAge)]
  );
  return { sid, cookieValue: encodeURIComponent(signSessionId(sid, SESSION_SECRET)) };
}

async function dismissPopups(page) {
  await page.evaluate(() => {
    const all = [...document.querySelectorAll('button, a, [role="button"]')];
    for (const el of all) {
      if (/^\s*(no thanks|not now|dismiss|maybe later)\s*$/i.test(el.textContent || '')) el.click();
    }
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await delay(400);
}

async function main() {
  const pool = createPool({ connectionString: process.env.DATABASE_URL });
  let sid = null;
  let browser = null;
  let failed = 0;
  try {
    const session = await forgeSession(pool);
    sid = session.sid;

    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.setCookie({
      name: 'connect.sid', value: session.cookieValue,
      domain: 'localhost', path: '/', httpOnly: true,
    });

    // Capture each unique route once, then copy to every id that uses it
    const byRoute = new Map();
    for (const cfg of configs) {
      if (!byRoute.has(cfg.route)) byRoute.set(cfg.route, []);
      byRoute.get(cfg.route).push(cfg.id);
    }

    for (const [route, ids] of byRoute) {
      const primary = path.join(OUT, `${ids[0]}.png`);
      process.stdout.write(`  ${route} → ${ids.join(',')} ...`);
      try {
        await page.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 45000 });
        await delay(4500);
        await dismissPopups(page);
        await delay(1500);
        await dismissPopups(page);
        // Hide stuck "Loading..." placeholders (e.g. pages that idle without a record selected)
        await page.evaluate(() => {
          for (const el of document.querySelectorAll('p, span, div, h1, h2, h3')) {
            if (el.children.length === 0 && /^\s*loading\W*\s*$/i.test(el.textContent || '')) el.style.visibility = 'hidden';
          }
        }).catch(() => {});
        await page.screenshot({ path: primary });
        // Sanity: a blank/failed render produces a tiny file
        if (fs.statSync(primary).size < 20000) throw new Error('screenshot suspiciously small — page may not have rendered');
        for (const id of ids.slice(1)) fs.copyFileSync(primary, path.join(OUT, `${id}.png`));
        console.log(' ✓');
      } catch (e) {
        failed++;
        console.log(` ✗ ${e.message.slice(0, 100)}`);
        try { fs.unlinkSync(primary); } catch {}
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (sid) await pool.query('DELETE FROM sessions WHERE sid=$1', [sid]).catch(() => {});
    await pool.end().catch(() => {});
  }
  console.log(failed ? `\n${failed} route(s) failed` : '\nAll routes captured');
  if (failed) process.exit(1);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
