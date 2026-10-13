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
const JOB_ID = 'demo-photosync-job-2026';
const CHROME = process.env.CHROME || execFileSync('sh', ['-lc', 'command -v chromium']).toString().trim();
const OUT = path.join(__dirname, 'shots-photosync');

const imageFiles = [
  '20260219_102129_1773578795483.jpg',
  '20260219_102129_1773581526088.jpg',
  '20260219_102142_1773578795493.jpg',
  '20260219_102142_1773581526105.jpg',
  '20260219_102206_1773578795496.jpg',
  '20260219_102211_1773581526117.jpg',
  '20260219_102239_1773578795499.jpg',
];
const imageData = imageFiles.map((name) => {
  const file = path.join(__dirname, '..', '..', 'attached_assets', name);
  return `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
});

const job = {
  id: JOB_ID,
  company_id: COMPANY_ID,
  property_address: 'Demo Property — PhotoSync Inspection',
  client_name: 'Jordan Summit',
  client_email: 'jordan@example.com',
  client_phone: '(555) 010-2026',
  status: 'completed',
  priority: 'high',
  damage_type: 'Hail and wind',
  inspection_date: '2026-09-18',
  assigned_to_email: USER_EMAIL,
  assigned_to_name: 'Demo Inspector',
  created_date: '2026-09-18T14:20:00.000Z',
  completed_at: '2026-09-18T16:10:00.000Z',
  notes: JSON.stringify({
    'Front Slope': 'Hail impacts concentrated near the ridge.',
    'Rear Slope': 'Lifted shingles and exposed underlayment at the eave.',
  }),
  scope_of_work: 'Replace damaged shingles and ridge cap; inspect flashing and underlayment.',
  report_notes: 'Photo evidence captured and reviewed for carrier documentation.',
};

const ai = (section, severity, counts, notes, covered, notCovered) => ({
  section,
  severity,
  coverage_verdict: 'covered',
  photo_quality_score: 94,
  hail_hits_counted: counts.hail || 0,
  wind_marks_counted: counts.wind || 0,
  missing_count: counts.missing || 0,
  ai_notes: notes,
  covered_items: covered.map((type) => ({ type, confidence: 93, description: 'Visible in the inspection photo.' })),
  non_covered_items: (notCovered || []).map((type) => ({ type, confidence: 78, description: 'Documented for context.' })),
});

const media = imageData.map((file_url, index) => {
  const sections = ['Front Slope', 'Front Slope', 'Rear Slope', 'Rear Slope', 'Left Elevation', 'Left Elevation', 'Interior'];
  const captions = [
    'Front slope overview',
    'Granule loss and impact field',
    'Rear slope overview',
    'Lifted shingle at eave',
    'Left elevation and flashing',
    'Gutter and fascia detail',
    'Interior ceiling stain',
  ];
  const analyses = [
    ai(sections[index], 'moderate', { hail: 8 }, 'Multiple circular impact marks and granule displacement are visible across the shingle field.', ['Hail impact', 'Granule loss'], ['Aged sealant']),
    ai(sections[index], 'moderate', { hail: 11 }, 'The close view shows repeated impact points with enough contrast for adjuster review.', ['Hail impact', 'Granule loss'], []),
    ai(sections[index], 'minor', { wind: 1 }, 'Minor edge wear is visible near the ridge line; no major structural opening in this frame.', ['Wind damage'], ['Weathering']),
    ai(sections[index], 'severe', { wind: 2, missing: 1 }, 'One shingle is lifted at the eave and the underlayment is exposed beneath the damaged course.', ['Wind uplift', 'Missing shingle'], []),
    ai(sections[index], 'minor', { wind: 1 }, 'Flashing and siding transition are documented for the repair scope.', ['Flashing damage'], ['Pre-existing trim wear']),
    ai(sections[index], 'moderate', { wind: 1 }, 'Gutter separation and fascia damage are visible at the corner.', ['Fascia damage', 'Gutter damage'], []),
    ai(sections[index], 'minor', { hail: 2 }, 'Interior staining is documented as supporting evidence for the exterior inspection.', ['Interior water stain'], []),
  ];
  return {
    id: `demo-photo-${String(index + 1).padStart(2, '0')}`,
    company_id: COMPANY_ID,
    related_entity_id: JOB_ID,
    related_entity_type: 'InspectionJob',
    file_type: 'photo',
    file_url,
    section: sections[index],
    caption: captions[index],
    ai_damage_analysis: analyses[index],
    uploaded_by_name: 'Demo Inspector',
    created_date: `2026-09-18T14:${30 + index}:00.000Z`,
  };
});

const user = {
  id: USER_ID,
  email: USER_EMAIL,
  full_name: 'Demo Owner',
  first_name: 'Demo',
  last_name: 'Owner',
  company_id: COMPANY_ID,
  is_administrator: true,
};

const staff = [{
  id: 'demo-staff-manager',
  company_id: COMPANY_ID,
  user_email: USER_EMAIL,
  full_name: 'Demo Owner',
  role: 'production_manager',
  is_active: true,
}];

const signSessionId = (sid) => {
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(sid).digest('base64').replace(/=+$/, '');
  return `s:${sid}.${sig}`;
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const respond = (request, body) => request.respond({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

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
    passport: { user: { claims: { sub: USER_ID, email: USER_EMAIL, first_name: 'Demo', last_name: 'Owner', full_name: 'Demo Owner' }, access_token: null, refresh_token: null, expires_at: Math.floor(Date.now() / 1000) + maxAge / 1000 } },
  };
  await pool.query('INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, $3)', [sid, JSON.stringify(session), new Date(Date.now() + maxAge)]);
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

async function shot(page, name, y = null) {
  if (y !== null) {
    await page.evaluate((scrollY) => window.scrollTo({ top: scrollY, behavior: 'instant' }), y);
    await delay(650);
  }
  await page.screenshot({ path: path.join(OUT, name) });
  console.log(`Captured ${name}`);
}

async function clickTestId(page, id) {
  return page.evaluate((testId) => {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    if (!el) return false;
    el.click();
    return true;
  }, id);
}

async function main() {
  if (!process.env.SESSION_SECRET || !process.env.DATABASE_URL) throw new Error('SESSION_SECRET and DATABASE_URL are required');
  fs.mkdirSync(OUT, { recursive: true });
  const pool = createPool({ connectionString: process.env.DATABASE_URL });
  let sessionId;
  let browser;
  try {
    const session = await forgeSession(pool);
    sessionId = session.sid;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.setCookie({ name: 'connect.sid', value: session.cookie, domain: 'localhost', path: '/', httpOnly: true });
    await page.evaluateOnNewDocument((companyId) => {
      localStorage.setItem('selected_company_id', companyId);
      sessionStorage.setItem('selected_company_id', companyId);
    }, COMPANY_ID);
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      try {
        const url = new URL(request.url());
        const entityMatch = url.pathname.match(/\/api\/local\/entity\/([^/]+)(?:\/([^/]+))?$/);
        if (request.method() === 'GET' && entityMatch) {
          const entity = decodeURIComponent(entityMatch[1]);
          const id = entityMatch[2] ? decodeURIComponent(entityMatch[2]) : null;
          if (entity === 'InspectionJob') return respond(request, id ? job : [job]);
          if (entity === 'JobMedia') return respond(request, media);
          if (entity === 'User') return respond(request, [user]);
          if (entity === 'StaffProfile') return respond(request, staff);
          if (['Estimate', 'InspectionReportTemplate', 'EmailTracking', 'StormEvent', 'Notification', 'Customer', 'Lead'].includes(entity)) return respond(request, []);
        }
        if (request.method() === 'POST' && url.pathname.endsWith('/api/functions/invoke')) {
          const body = JSON.parse(request.postData() || '{}');
          if (body.functionName === 'getGoogleMapsApiKey') return respond(request, { data: {} });
          return respond(request, { data: {} });
        }
        await request.continue();
      } catch {
        await request.continue().catch(() => {});
      }
    });
    page.on('pageerror', (error) => console.log(`Browser error: ${error.message}`));

    await page.goto(`${BASE}/InspectionsDashboard`, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await delay(3500); await dismissPopups(page);
    await shot(page, 'photos-01.png');
    await shot(page, 'photos-02.png', 600);

    await page.goto(`${BASE}/InspectionCapture?id=${JOB_ID}`, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await delay(4000); await dismissPopups(page);
    // Headless Chrome cannot open the live camera. Capture the populated upload
    // and section-organizer view instead of publishing the camera fallback panel.
    await shot(page, 'photos-03.png', 950);
    await shot(page, 'photos-04.png', 700);

    await clickTestId(page, `button-edit-photo-${media[1].id}`);
    await delay(800);
    await shot(page, 'photos-05.png');
    await page.keyboard.press('Escape').catch(() => {});

    await shot(page, 'photos-06.png', 1550);
    await clickTestId(page, 'button-share-photos');
    await delay(700);
    await shot(page, 'photos-07.png');
    await page.keyboard.press('Escape').catch(() => {});

    await shot(page, 'photos-08.png', 2450);
    const openedReportDialog = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').trim() === 'Send Report');
      if (!button) return false;
      button.scrollIntoView({ block: 'center' });
      button.click();
      return true;
    });
    if (openedReportDialog) {
      await delay(700);
    }
    await shot(page, 'photos-09.png');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (sessionId) await pool.query('DELETE FROM sessions WHERE sid=$1', [sessionId]).catch(() => {});
    await pool.end().catch(() => {});
  }
  console.log(`Captured PhotoSync frames in ${OUT}`);
}

main().catch((error) => { console.error('PhotoSync capture failed:', error); process.exit(1); });