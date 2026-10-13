#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createPool } = require('../lib/db-pool.cjs');
const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:5000';
const COMPANY_ID = 'loc_demo_video_001';
const USER_ID = 'usr_demo_video_001';
const USER_EMAIL = 'demo@summitpeakroofing.com';
const CHROME = '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium';
const OUT = path.join(__dirname, 'shots-accounting');
const SESSION_SECRET = process.env.SESSION_SECRET;
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map((value) => value.trim())) : null;

if (!SESSION_SECRET || !process.env.DATABASE_URL) {
  console.error('SESSION_SECRET and DATABASE_URL are required');
  process.exit(1);
}

const shots = [
  { name: 'accounting-01.png', route: '/Accounting', note: 'Accounting overview' },
  { name: 'accounting-02.png', route: '/AccountingSetup', note: 'Accounting setup and sync controls' },
  { name: 'accounting-03.png', route: '/ChartOfAccountsPage', note: 'Chart of accounts' },
  { name: 'accounting-04.png', route: '/Expenses', note: 'Expenses overview' },
  { name: 'accounting-05.png', route: '/Expenses', note: 'New expense form', click: /add (new )?expense/i },
  { name: 'accounting-06.png', route: '/Bills', note: 'Bills and payables' },
  { name: 'accounting-07.png', route: '/Bills', note: 'Add bill form', click: /add bill/i },
  { name: 'accounting-08.png', route: '/BankReconciliation', note: 'Bank reconciliation' },
  { name: 'accounting-09.png', route: '/AccountingReports', note: 'Accounting reports' },
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const signSessionId = (sid) => {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(sid).digest('base64').replace(/=+$/, '');
  return `s:${sid}.${sig}`;
};

async function forgeSession(pool) {
  const check = await pool.query(
    'SELECT 1 FROM users WHERE id=$1 AND email=$2 AND company_id=$3',
    [USER_ID, USER_EMAIL, COMPANY_ID],
  );
  if (!check.rows.length) throw new Error('Demo user/company missing; use the existing video demo tenant.');

  const sid = crypto.randomUUID();
  const maxAge = 60 * 60 * 1000;
  const session = {
    cookie: { originalMaxAge: maxAge, expires: new Date(Date.now() + maxAge).toISOString(), secure: true, httpOnly: true, path: '/', sameSite: 'lax' },
    passport: {
      user: {
        claims: { sub: USER_ID, email: USER_EMAIL, first_name: 'Demo', last_name: 'Owner', full_name: 'Demo Owner', profile_image_url: null },
        access_token: null, refresh_token: null, expires_at: Math.floor(Date.now() / 1000) + maxAge / 1000,
      },
    },
  };
  await pool.query(
    'INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, $3)',
    [sid, JSON.stringify(session), new Date(Date.now() + maxAge)],
  );
  return { sid, cookie: encodeURIComponent(signSessionId(sid)) };
}

async function dismissPopups(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      if (/^\s*(no thanks|not now|dismiss|maybe later)\s*$/i.test(el.textContent || '')) el.click();
    }
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
}

async function clickMatchingButton(page, pattern) {
  return page.evaluate((source) => {
    const regex = new RegExp(source, 'i');
    const button = [...document.querySelectorAll('button')].find((el) => regex.test((el.textContent || '').trim()));
    if (button) { button.click(); return true; }
    return false;
  }, pattern.source);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const pool = createPool({ connectionString: process.env.DATABASE_URL });
  let sessionId;
  let browser;
  try {
    const session = await forgeSession(pool);
    sessionId = session.sid;
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.setCookie({ name: 'connect.sid', value: session.cookie, domain: 'localhost', path: '/', httpOnly: true });

    for (const shot of shots) {
      if (ONLY && !ONLY.has(shot.name.replace('accounting-', '').replace('.png', ''))) continue;
      const output = path.join(OUT, shot.name);
      if (fs.existsSync(output) && fs.statSync(output).size >= 20000) {
        console.log(`Skipping ${shot.name}; already captured`);
        continue;
      }
      console.log(`Capturing ${shot.name}: ${shot.note}`);
      await page.goto(BASE + shot.route, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await delay(3500);
      await dismissPopups(page);
      if (shot.click) {
        await clickMatchingButton(page, shot.click);
        await delay(1000);
      }
      await page.screenshot({ path: output });
      const size = fs.statSync(output).size;
      if (size < 20000) throw new Error(`${shot.name} is suspiciously small (${size} bytes)`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (sessionId) await pool.query('DELETE FROM sessions WHERE sid=$1', [sessionId]).catch(() => {});
    await pool.end().catch(() => {});
  }
  console.log(`Captured ${shots.length} accounting frames in ${OUT}`);
}

main().catch((error) => {
  console.error('Accounting capture failed:', error.message);
  process.exit(1);
});