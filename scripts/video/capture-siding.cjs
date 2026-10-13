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
const OUT = path.join(__dirname, 'shots-siding');
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || !process.env.DATABASE_URL) {
  console.error('SESSION_SECRET and DATABASE_URL are required');
  process.exit(1);
}

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
  if (!check.rows.length) throw new Error('Demo user/company missing; create the video demo tenant first.');

  const sid = crypto.randomUUID();
  const maxAge = 60 * 60 * 1000;
  const session = {
    cookie: {
      originalMaxAge: maxAge,
      expires: new Date(Date.now() + maxAge).toISOString(),
      secure: true,
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
    },
    passport: {
      user: {
        claims: {
          sub: USER_ID,
          email: USER_EMAIL,
          first_name: 'Demo',
          last_name: 'Owner',
          full_name: 'Demo Owner',
          profile_image_url: null,
        },
        access_token: null,
        refresh_token: null,
        expires_at: Math.floor(Date.now() / 1000) + maxAge / 1000,
      },
    },
  };
  await pool.query(
    'INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, $3)',
    [sid, JSON.stringify(session), new Date(Date.now() + maxAge)],
  );
  return { sid, cookie: encodeURIComponent(signSessionId(sid)) };
}

async function clickText(page, text, { last = false } = {}) {
  const clicked = await page.evaluate(({ text, last }) => {
    const matches = [...document.querySelectorAll('button')].filter(
      (el) => (el.textContent || '').trim() === text,
    );
    const button = last ? matches[matches.length - 1] : matches[0];
    if (!button) return false;
    button.click();
    return true;
  }, { text, last });
  if (!clicked) throw new Error(`Could not find button: ${text}`);
}

async function scrollToSelector(page, selector, block = 'center') {
  await page.evaluate(({ selector, block }) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Missing selector ${selector}`);
    el.scrollIntoView({ behavior: 'instant', block });
  }, { selector, block });
  await delay(500);
}

async function shot(page, number, selector = null, block = 'center') {
  if (selector) await scrollToSelector(page, selector, block);
  const file = path.join(OUT, `siding-${String(number).padStart(2, '0')}.png`);
  await page.screenshot({ path: file });
  const size = fs.statSync(file).size;
  if (size < 20000) throw new Error(`${path.basename(file)} is suspiciously small (${size} bytes)`);
  console.log(`Captured ${path.basename(file)} (${Math.round(size / 1024)} KB)`);
}

async function fillCustomer(page) {
  const fields = [
    ['input[placeholder="John Smith"]', 'Avery Collins'],
    ['input[placeholder="john@example.com"]', 'avery.collins@example.test'],
    ['input[placeholder="(555) 123-4567"]', '(555) 014-7284'],
  ];
  for (const [selector, value] of fields) {
    const input = await page.$(selector);
    if (!input) continue;
    await input.click({ clickCount: 3 });
    await input.type(value);
  }
}

async function fillManualMeasurements(page) {
  const values = ['184', '2', '9', '7', '46', '52', '12', '3', '1', '8'];
  const selector = 'div.border-emerald-300 input[type="number"]';
  const count = await page.$$eval(selector, (nodes) => nodes.length);
  if (count < values.length) throw new Error(`Expected ${values.length} manual measurement inputs, found ${count}`);
  for (let index = 0; index < values.length; index += 1) {
    const input = (await page.$$(selector))[index];
    await input.click({ clickCount: 3 });
    await input.type(values[index]);
  }
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
    await page.setCookie({
      name: 'connect.sid',
      value: session.cookie,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
    });

    const route = '/AIEstimator?property_address=742%20Maple%20Ridge%20Drive%2C%20Canton%2C%20OH%2044702';
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(5500);
    await shot(page, 1);

    await clickText(page, 'Settings', { last: true });
    await delay(500);
    const sidingCheckbox = '[data-testid="checkbox-specialty-siding"]';
    const checked = await page.$eval(sidingCheckbox, (el) => el.getAttribute('data-state') === 'checked' || el.getAttribute('aria-checked') === 'true');
    if (!checked) await page.click(sidingCheckbox);
    await delay(400);
    await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog) dialog.scrollTop = 470;
    });
    await delay(300);
    await shot(page, 2);
    await clickText(page, 'Save Changes');
    await delay(700);

    const tabs = await page.$$('[role="tab"]');
    if (tabs.length < 2) throw new Error(`Expected two estimator tabs, found ${tabs.length}`);
    await tabs[tabs.length - 1].click();
    await delay(1200);
    console.log('Estimator tabs:', await page.$$eval('[role="tab"]', (nodes) => nodes.map((node) => ({
      text: (node.textContent || '').trim(),
      state: node.getAttribute('data-state'),
    }))));
    console.log('Estimator config:', await page.evaluate(() => localStorage.getItem('aiEstimatorConfig')));
    console.log('Siding toggle count:', await page.$$eval('[data-testid="button-toggle-photo-siding"]', (nodes) => nodes.length));
    await shot(page, 3);

    await page.click('[data-testid="button-toggle-photo-siding"]');
    await delay(500);
    await shot(page, 4, '[data-testid="button-toggle-photo-siding"]', 'start');

    await page.click('[data-testid="button-mode-satellite"]');
    await delay(350);
    await shot(page, 5, '[data-testid="satellite-only-siding-panel"]');

    await page.click('[data-testid="button-mode-manual-entry"]');
    await delay(350);
    await fillManualMeasurements(page);
    await shot(page, 6, '[data-testid="button-build-manual-siding-estimate"]');

    await page.click('[data-testid="button-build-manual-siding-estimate"]');
    await delay(1600);
    await shot(page, 7, '[data-testid="panel-manual-siding-results"]', 'start');

    await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="panel-manual-siding-results"]');
      const button = panel && [...panel.querySelectorAll('button')].find((el) => /View Report/i.test(el.textContent || ''));
      if (!button) throw new Error('Manual siding report button not found');
      button.click();
    });
    await delay(900);
    await shot(page, 8);
    await page.keyboard.press('Escape');
    await delay(450);

    await shot(page, 9, '[data-testid="button-estimate-lang-en"]', 'start');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (sessionId) await pool.query('DELETE FROM sessions WHERE sid=$1', [sessionId]).catch(() => {});
    await pool.end().catch(() => {});
  }
  console.log(`Captured 9 siding frames in ${OUT}`);
}

main().catch((error) => {
  console.error('Siding capture failed:', error.stack || error.message);
  process.exit(1);
});