#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createPool } = require('../lib/db-pool.cjs');
const puppeteer = require('puppeteer-core');

const BASE = process.env.VIDEO_BASE || 'http://localhost:5000';
const COMPANY_ID = 'loc_demo_video_001';
const USER_ID = 'usr_demo_video_001';
const USER_EMAIL = 'demo@summitpeakroofing.com';
const CHROME = process.env.CHROME || execFileSync('sh', ['-lc', 'command -v chromium']).toString().trim();
const OUT = path.join(__dirname, 'shots-quickbooks');
const SESSION_SECRET = process.env.SESSION_SECRET;
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map((value) => value.trim())) : null;

if (!SESSION_SECRET || !process.env.DATABASE_URL) {
  console.error('SESSION_SECRET and DATABASE_URL are required');
  process.exit(1);
}

const shots = [
  { name: 'quickbooks-01.png', route: '/Settings', state: 'disconnected', target: 'Connect QuickBooks', note: 'Settings connection button' },
  { name: 'quickbooks-02.png', route: '/Settings', state: 'connected', target: 'banner-qb-sandbox-warning', note: 'Sandbox warning and connection status' },
  { name: 'quickbooks-03.png', route: '/Settings', state: 'connected', target: 'Invoices in QuickBooks', note: 'Synced and unsynced counts' },
  { name: 'quickbooks-04.png', route: '/Settings', state: 'connected', target: 'Push to QuickBooks', note: 'Push and duplicate-safety controls' },
  { name: 'quickbooks-05.png', route: '/Settings', state: 'connected', target: 'Payments already in QB', note: 'Historical payment safeguard' },
  { name: 'quickbooks-06.png', route: '/Settings', state: 'connected', target: 'Import Expenses from QuickBooks', note: 'Expense import control' },
  { name: 'quickbooks-07.png', route: '/Invoices', state: 'connected', target: 'Invoices', note: 'Invoice list with QuickBooks status' },
  { name: 'quickbooks-08.png', route: '/ChartOfAccountsPage', state: 'connected', target: 'Import from QuickBooks', note: 'Chart of accounts import' },
  { name: 'quickbooks-09.png', route: '/Settings', state: 'connected', target: 'Going forward', note: 'Automatic sync reminder' },
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

async function scrollToTarget(page, target) {
  await page.evaluate((needle) => {
    const exact = document.querySelector(`[data-testid="${needle}"]`);
    if (exact) {
      exact.scrollIntoView({ block: 'center', inline: 'nearest' });
      return;
    }
    const regex = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const candidates = [...document.querySelectorAll('h1,h2,h3,h4,p,span,button,[role="button"],label')];
    const el = candidates.find((node) => regex.test((node.textContent || '').trim()));
    if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, target);
}

function functionResponse(name, state) {
  if (name === 'checkQuickBooksConnection') {
    return state === 'connected'
      ? { connected: true, company_name: 'Demo Roofing Co. Practice Company', environment: 'sandbox', sandbox: true, realm_id: 'demo-realm', last_sync: '2026-09-18T14:42:00.000Z' }
      : { connected: false };
  }
  if (name === 'getQuickBooksSyncStatus') {
    return {
      connected: true,
      sandbox: true,
      realm_id: 'demo-realm',
      last_sync: '2026-09-18T14:42:00.000Z',
      invoices: { synced: 12, total: 15, unsynced: 3 },
      payments: { synced: 8, total: 10, unsynced: 2 },
      sync_log: [
        { status: 'success', type: 'invoice', label: 'INV-2026-0142', action: 'created', ts: '2026-09-18T14:42:00.000Z' },
        { status: 'success', type: 'payment', label: 'Payment · INV-2026-0139', action: 'created', ts: '2026-09-18T14:39:00.000Z' },
      ],
    };
  }
  return null;
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
    await page.setRequestInterception(true);
    let currentState = 'connected';
    page.on('request', async (request) => {
      try {
        if (request.url().endsWith('/api/functions/invoke') && request.method() === 'POST') {
          const body = JSON.parse(request.postData() || '{}');
          const mock = functionResponse(body.functionName, currentState);
          if (mock) {
            await request.respond({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ data: mock }),
            });
            return;
          }
        }
        await request.continue();
      } catch {
        await request.continue().catch(() => {});
      }
    });

    for (const shot of shots) {
      const key = shot.name.replace('quickbooks-', '').replace('.png', '');
      if (ONLY && !ONLY.has(key)) continue;
      const output = path.join(OUT, shot.name);
      if (fs.existsSync(output) && fs.statSync(output).size >= 20000) {
        console.log(`Skipping ${shot.name}; already captured`);
        continue;
      }
      currentState = shot.state;
      console.log(`Capturing ${shot.name}: ${shot.note}`);
      await page.goto(BASE + shot.route, { waitUntil: 'domcontentloaded', timeout: 40000 });
      await delay(4000);
      await dismissPopups(page);
      await scrollToTarget(page, shot.target);
      await delay(900);
      await page.screenshot({ path: output });
      const size = fs.statSync(output).size;
      if (size < 20000) throw new Error(`${shot.name} is suspiciously small (${size} bytes)`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (sessionId) await pool.query('DELETE FROM sessions WHERE sid=$1', [sessionId]).catch(() => {});
    await pool.end().catch(() => {});
  }
  console.log(`Captured QuickBooks frames in ${OUT}`);
}

main().catch((error) => {
  console.error('QuickBooks capture failed:', error.message);
  process.exit(1);
});