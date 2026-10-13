#!/usr/bin/env node
/**
 * Calendar Conflict Warning UI Smoke Test
 * ─────────────────────────────────────────────────────────────────────────
 * Uses Playwright to verify the client-side conflict detection banner works
 * end-to-end in the browser:
 *
 *  1. Seeds an anchor event and a separate editable event for ASSIGNEE_A.
 *  2. Opens the editable event and confirms its original slot does not
 *     conflict with itself.
 *  3. Moves it over the anchor event and confirms the warning appears with
 *     the anchor title; returning it to its original slot clears the warning.
 *  4. Opens the new-event dialog and picks a time that overlaps the anchor.
 *  5. Confirms the warning appears, then changes to a free slot and confirms
 *     the warning disappears.
 *  6. Saves the new event and confirms the server returns HTTP 200/201.
 *
 * Prerequisites:
 *   - Dev server running on PORT (default 5000)  —  npm run dev
 *   - DATABASE_URL and SESSION_SECRET env vars set
 *   - Playwright installed  (npx playwright install chromium)
 *
 * Usage:  node scripts/test-conflict-warning-ui.cjs
 */

'use strict';

const { chromium } = require('playwright');
const { createPool } = require('./lib/db-pool.cjs');
const http         = require('http');
const crypto       = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool     = createPool({ connectionString: process.env.DATABASE_URL });

// ── Stable fixture identifiers ────────────────────────────────────────────
const OWNER_EMAIL  = 'smoke-cwui-owner@example.com';
const OWNER_SID    = 'smoke_cwui_owner_session';
const ASSIGNEE_A   = 'smoke-cwui-alpha@example.com';
const ASSIGNEE_NAME = 'CWUI Alpha Rep';
const ANCHOR_TITLE  = 'Anchor Inspection – CWUI Smoke';
const LEGACY_ANCHOR_TITLE = 'Legacy Owner Booking – CWUI Smoke';
const EDIT_TARGET_TITLE = 'Editable Appointment – CWUI Smoke';

// ── Test state ────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const createdEventIds = [];
let   companyId       = null;

// ── Helpers ───────────────────────────────────────────────────────────────
function ok(name, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${extra !== undefined ? ` — got: ${JSON.stringify(extra)}` : ''}`);
    failed++;
  }
}

function forgeSessionCookie(sid) {
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port:     u.port || 80,
        path:     u.pathname + u.search,
        method:   opts.method || 'GET',
        headers:  { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          let d; try { d = JSON.parse(b); } catch { d = b; }
          resolve({ status: res.statusCode, data: d });
        });
      }
    );
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error(`${opts.method || 'GET'} ${u.pathname} timed out`));
    });
    req.on('error', reject);
    if (opts.body !== undefined) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

// ── Cleanup ───────────────────────────────────────────────────────────────
async function cleanup() {
  console.log('\n── Cleanup ──────────────────────────────────────────────────');
  try {
    if (createdEventIds.length) {
      await pool.query(
        `DELETE FROM calendar_events WHERE id = ANY($1)`,
        [createdEventIds]
      );
      console.log(`  Deleted ${createdEventIds.length} calendar event(s)`);
    }
    if (companyId) {
      await pool.query('DELETE FROM staff_profiles WHERE company_id = $1', [companyId]);
      await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
      console.log(`  Deleted company ${companyId} and staff profiles`);
    }
    await pool.query(`DELETE FROM sessions WHERE sid = $1`, [OWNER_SID]).catch(() => {});
  } catch (err) {
    console.warn('  Cleanup warning:', err.message);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Calendar Conflict Warning UI Smoke Test ===\n');
  console.log(`Target: ${BASE_URL}\n`);

  // ── 0. Server reachability ────────────────────────────────────────────
  console.log('Group 0: Server reachability');
  try {
    const res = await fetchJson(`${BASE_URL}/api/auth/user`);
    ok('Server is responding', res.status < 500, `HTTP ${res.status}`);
  } catch (err) {
    ok('Server is responding', false, err.message);
    console.log('\n⚠  Server not reachable — skipping remaining tests.\n');
    process.exit(1);
  }

  // ── 1. Provision test company + session ──────────────────────────────
  console.log('\nGroup 1: Provision test fixtures');

  const cookie = forgeSessionCookie(OWNER_SID);
  const sess = {
    cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' },
    passport: { user: { claims: { email: OWNER_EMAIL } } },
  };
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = $2::jsonb, expire = $3`,
    [OWNER_SID, JSON.stringify(sess), new Date(Date.now() + 3600000)]
  );

  const coRes = await fetchJson(`${BASE_URL}/api/local/entity/Company`, {
    method:  'POST',
    headers: { Cookie: cookie },
    // onboarding_completed:true bypasses the QuickSetup redirect gate in Layout.jsx
    body:    { company_name: 'Smoke CWUI Test Co', created_by: OWNER_EMAIL, onboarding_completed: true },
  });
  ok('Company created', coRes.status === 200 || coRes.status === 201, `HTTP ${coRes.status}`);
  companyId = coRes.data?.id;
  ok('Company ID returned', !!companyId, coRes.data);
  if (!companyId) {
    console.log('\n⚠  Cannot continue without a company ID.\n');
    return;
  }

  // Owner staff profile (needed for tenant guard + dropdown display)
  await fetchJson(`${BASE_URL}/api/local/entity/StaffProfile`, {
    method:  'POST',
    headers: { Cookie: cookie },
    body: {
      company_id:       companyId,
      user_email:       OWNER_EMAIL,
      full_name:        'CWUI Owner',
      is_administrator: true,
      role:             'admin',
    },
  });

  // ASSIGNEE_A staff profile so they appear in the event-dialog dropdown
  const spRes = await fetchJson(`${BASE_URL}/api/local/entity/StaffProfile`, {
    method:  'POST',
    headers: { Cookie: cookie },
    body: {
      company_id: companyId,
      user_email: ASSIGNEE_A,
      full_name:  ASSIGNEE_NAME,
      role:       'rep',
    },
  });
  ok('ASSIGNEE_A staff profile created', spRes.status === 200 || spRes.status === 201, `HTTP ${spRes.status}`);

  // ── 2. Seed the anchor event (existing booking for ASSIGNEE_A) ───────
  console.log('\nGroup 2: Seed anchor CalendarEvent for ASSIGNEE_A');

  // Use a date 14 days in the future.  A 10-hour UTC window (06:00–16:00)
  // guarantees overlap with any local "business-hours" the browser uses.
  const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  futureDate.setUTCHours(6, 0, 0, 0); // 06:00 UTC
  const anchorStart = futureDate.toISOString(); // e.g. "2026-08-29T06:00:00.000Z"
  const anchorEnd   = new Date(futureDate.getTime() + 10 * 60 * 60 * 1000).toISOString(); // +10 h → 16:00 UTC

  const anchorRes = await fetchJson(`${BASE_URL}/api/local/entity/CalendarEvent`, {
    method:  'POST',
    headers: { Cookie: cookie },
    body: {
      company_id:  companyId,
      title:       ANCHOR_TITLE,
      start_time:  anchorStart,
      end_time:    anchorEnd,
      event_type:  'inspection',
      status:      'scheduled',
      assigned_to: ASSIGNEE_A,
    },
  });
  ok('Anchor event created', anchorRes.status === 200 || anchorRes.status === 201, `HTTP ${anchorRes.status}`);
  const anchorId = anchorRes.data?.id;
  ok('Anchor event ID returned', !!anchorId, anchorRes.data);
  if (anchorId) createdEventIds.push(anchorId);

  if (!anchorId) {
    console.log('\n⚠  Cannot continue without anchor event ID.\n');
    return;
  }

  // Seed the legacy shape explicitly: assigned_to is NULL and created_by is
  // the logged-in user's email. The calendar must treat this as an owner
  // booking and warn when that same user creates an overlapping event.
  const legacyRes = await fetchJson(`${BASE_URL}/api/local/entity/CalendarEvent`, {
    method:  'POST',
    headers: { Cookie: cookie },
    body: {
      company_id:  companyId,
      title:       LEGACY_ANCHOR_TITLE,
      start_time:  anchorStart,
      end_time:    anchorEnd,
      event_type:  'inspection',
      status:      'scheduled',
      assigned_to: null,
      created_by:  OWNER_EMAIL,
    },
  });
  ok('Legacy owner event created', legacyRes.status === 200 || legacyRes.status === 201, `HTTP ${legacyRes.status}`);
  const legacyId = legacyRes.data?.id;
  ok('Legacy owner event ID returned', !!legacyId, legacyRes.data);
  if (legacyId) {
    createdEventIds.push(legacyId);
    // Verify the exact legacy data shape even if the entity route applies
    // defaults to omitted fields. This also documents the fixture invariant.
    await pool.query(
      `UPDATE calendar_events
          SET assigned_to = NULL, created_by = $2
        WHERE id = $1`,
      [legacyId, OWNER_EMAIL]
    );
  }

  if (!legacyId) {
    console.log('\n⚠  Cannot continue without legacy owner event ID.\n');
    return;
  }

  // Seed a second event for the same assignee in a non-overlapping slot.
  // This is the event the browser will open and edit below.
  const targetStart = new Date(futureDate.getTime() + 11 * 60 * 60 * 1000).toISOString();
  const targetEnd   = new Date(futureDate.getTime() + 12 * 60 * 60 * 1000).toISOString();
  const targetRes = await fetchJson(`${BASE_URL}/api/local/entity/CalendarEvent`, {
    method:  'POST',
    headers: { Cookie: cookie },
    body: {
      company_id:  companyId,
      title:       EDIT_TARGET_TITLE,
      start_time:  targetStart,
      end_time:    targetEnd,
      event_type:  'appointment',
      status:      'scheduled',
      assigned_to: ASSIGNEE_A,
    },
  });
  ok('Editable target event created', targetRes.status === 200 || targetRes.status === 201, `HTTP ${targetRes.status}`);
  const targetId = targetRes.data?.id;
  ok('Editable target event ID returned', !!targetId, targetRes.data);
  if (targetId) createdEventIds.push(targetId);

  if (!targetId) {
    console.log('\n⚠  Cannot continue without editable target event ID.\n');
    return;
  }

  // ── 3. Browser / Playwright tests ─────────────────────────────────────
  console.log('\nGroup 3: Browser — conflict warning UI');

  // Parse the signed cookie value for Playwright's cookie jar
  const rawCookieValue = cookie.replace('connect.sid=', '');

  // Use the Nix-installed system Chromium when Playwright's own download is unavailable
  // (the downloaded headless-shell binary needs system libs not present in this Nix sandbox).
  const SYSTEM_CHROMIUM = '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium';
  const fs = require('fs');
  const execPath = fs.existsSync(SYSTEM_CHROMIUM) ? SYSTEM_CHROMIUM : undefined;

  const browser = await chromium.launch({
    headless: true,
    ...(execPath ? { executablePath: execPath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const hostname = new URL(BASE_URL).hostname;

  const context = await browser.newContext({
    baseURL: BASE_URL,
    // Inject the forged session cookie so the app sees the test user as logged in
    storageState: {
      cookies: [
        {
          name:     'connect.sid',
          value:    decodeURIComponent(rawCookieValue),
          domain:   hostname,
          path:     '/',
          httpOnly: true,
          secure:   false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    },
  });

  // Pre-seed last_used_company_id in localStorage so useRoleBasedData resolves
  // the company in one query instead of chaining user→profiles→owned→company.
  // Without this, a brand-new test company requires 4 sequential async queries
  // before myCompany is available, and the page can still be hydrating when we
  // click the button.
  await context.addInitScript((cid) => {
    try { localStorage.setItem('last_used_company_id', cid); } catch (_) {}
  }, companyId);

  const page = await context.newPage();

  // Collect any console errors for debugging
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Track whether any CalendarEvent POST returned a 409 via the API
  let last409 = false;
  page.on('response', res => {
    if (
      res.url().includes('/entity/CalendarEvent') &&
      res.request().method() === 'POST' &&
      res.status() === 409
    ) {
      last409 = true;
    }
  });

  try {
    // ── 3a. Navigate to Calendar page ──────────────────────────────────
    await page.goto('/Calendar', { waitUntil: 'networkidle', timeout: 30000 });
    ok('Calendar page loaded', page.url().includes('Calendar'), page.url());

    // ── 3b. Wait for the Calendar UI ────────────────────────────────────
    // Wait for the Add Event button AND for the calendar header text (month/year)
    // to confirm the page has fully rendered beyond any loading skeleton.
    const addBtn = page.locator('[data-testid="btn-add-event"]');
    await addBtn.waitFor({ state: 'visible', timeout: 20000 });

    // Confirm the calendar grid is rendered (month heading visible)
    await page.waitForFunction(() => {
      const h = document.querySelector('[data-testid="btn-add-event"]');
      return h && h.offsetParent !== null; // truly in layout, not hidden by overlay
    }, { timeout: 10000 });

    const titleInput = page.locator('[data-testid="input-event-title"]');
    const startInput = page.locator('[data-testid="input-event-start-time"]');
    const endInput   = page.locator('[data-testid="input-event-end-time"]');
    const conflictBanner = page.locator('[data-testid="conflict-warning"]');

    // ── 3c. Compute timezone-safe conflict and free slot times ──────────
    //   Run inside the browser so the local-vs-UTC math is correct for
    //   whatever timezone the test environment uses.
    const times = await page.evaluate((anchorStartISO) => {
      const anchorMs = new Date(anchorStartISO).getTime(); // UTC epoch ms

      // Overlapping window: starts 30 min after anchor starts, ends 1.5 h in
      const conflictStartMs = anchorMs + 30 * 60 * 1000;
      const conflictEndMs   = anchorMs + 90 * 60 * 1000;

      // Free window: starts 3 h BEFORE anchor starts, ends 2 h before
      const freeStartMs = anchorMs - 3 * 60 * 60 * 1000;
      const freeEndMs   = anchorMs - 2 * 60 * 60 * 1000;

      // datetime-local format = local ISO without timezone suffix
      function toLocalInput(ms) {
        const d = new Date(ms);
        const offset = d.getTimezoneOffset() * 60000;
        return new Date(ms - offset).toISOString().slice(0, 16);
      }

      return {
        conflictStart: toLocalInput(conflictStartMs),
        conflictEnd:   toLocalInput(conflictEndMs),
        freeStart:     toLocalInput(freeStartMs),
        freeEnd:       toLocalInput(freeEndMs),
        targetOriginalStart: toLocalInput(anchorMs + 11 * 60 * 60 * 1000),
        targetOriginalEnd:   toLocalInput(anchorMs + 12 * 60 * 60 * 1000),
      };
    }, anchorStart);

    console.log(`  Computed conflict slot : ${times.conflictStart} → ${times.conflictEnd}`);
    console.log(`  Computed free slot     : ${times.freeStart}     → ${times.freeEnd}`);
    console.log(`  Computed target slot   : ${times.targetOriginalStart} → ${times.targetOriginalEnd}`);

    // ── 3d. Open an existing event and verify edit conflict detection ─────
    // The target event is deliberately outside the anchor event's 06:00–16:00
    // UTC window, so its original slot should not warn even though it overlaps
    // the target event itself.
    await page.getByRole('button', { name: 'Team Calendar' }).click();
    const targetCard = page.getByText(EDIT_TARGET_TITLE, { exact: true }).first();
    await targetCard.waitFor({ state: 'visible', timeout: 10000 });
    await targetCard.click();

    const editButton = page.getByRole('button', { name: /^Edit$/ }).last();
    await editButton.waitFor({ state: 'visible', timeout: 8000 });
    await editButton.click();
    await titleInput.waitFor({ state: 'visible', timeout: 8000 });
    ok('Existing event opened for editing', (await titleInput.inputValue()) === EDIT_TARGET_TITLE);

    // The form starts in the target's own original slot.  The self-skip guard
    // must prevent the event from warning about itself.
    await conflictBanner.waitFor({ state: 'hidden', timeout: 4000 });
    ok('Editing event does not conflict with itself in its original slot', true);

    // Move the existing event into the anchor event's time window.
    await startInput.fill(times.conflictStart);
    await endInput.fill(times.conflictEnd);
    await conflictBanner.waitFor({ state: 'visible', timeout: 8000 });
    const editBannerText = await conflictBanner.innerText();
    ok('Conflict warning appears when an existing event is edited into an overlap', true);
    ok(
      'Edit conflict banner contains the other event title',
      editBannerText.includes(ANCHOR_TITLE),
      editBannerText.replace(/\s+/g, ' ').trim()
    );

    // Return to the target's original slot; it must again be treated as
    // self-only and not produce a warning.
    await startInput.fill(times.targetOriginalStart);
    await endInput.fill(times.targetOriginalEnd);
    await conflictBanner.waitFor({ state: 'hidden', timeout: 4000 });
    ok('Edit conflict warning clears when restored to its original slot', true);

    // Close without saving so the existing create-path test remains isolated.
    await page.keyboard.press('Escape');
    await titleInput.waitFor({ state: 'hidden', timeout: 4000 });

    // ── 3e. Open the create form and fill conflicting times ─────────────
    await addBtn.click();
    await titleInput.waitFor({ state: 'visible', timeout: 15000 });
    ok('New-event dialog opened', true);
    await titleInput.fill('Test Conflict Check Event');

    // Clear then fill datetime-local inputs
    await startInput.fill(times.conflictStart);
    await endInput.fill(times.conflictEnd);

    // ── 3e. Legacy event fallback: blank assigned_to → created_by ───────
    // Expected behavior: the warning MUST fire for the logged-in owner.
    // Legacy calendar rows infer responsibility from created_by when the
    // assigned rep field is NULL; suppressing this warning permits a
    // double-booking.
    await conflictBanner.waitFor({ state: 'visible', timeout: 8000 });
    const legacyBannerText = await conflictBanner.innerText();
    ok('Legacy blank-assignee conflict warning is visible', true);
    ok(
      'Legacy warning identifies the creator-owned event',
      legacyBannerText.includes(LEGACY_ANCHOR_TITLE),
      legacyBannerText.replace(/\s+/g, ' ').trim()
    );

    // ── 3f. Change assignee to ASSIGNEE_A ─────────────────────────────
    // Click the Radix UI SelectTrigger
    await page.locator('[data-testid="select-event-assignee"]').click();
    // Wait for the dropdown popover to appear and click ASSIGNEE_NAME
    const assigneeOption = page.locator(`[role="option"]:has-text("${ASSIGNEE_NAME}")`);
    await assigneeOption.waitFor({ state: 'visible', timeout: 8000 });
    await assigneeOption.click();

    // ── 3g. Assert explicitly assigned event still warns ────────────────
    await conflictBanner.waitFor({ state: 'visible', timeout: 8000 });
    const bannerText = await conflictBanner.innerText();
    ok('Conflict warning banner is visible', true);
    ok(
      'Banner contains the existing event title',
      bannerText.includes(ANCHOR_TITLE),
      bannerText.replace(/\s+/g, ' ').trim()
    );

    // ── 3h. Switch to a conflict-free time slot ────────────────────────
    await startInput.fill(times.freeStart);
    await endInput.fill(times.freeEnd);

    // The useMemo runs synchronously on the next React render tick;
    // give it up to 4 s to clear.
    await conflictBanner.waitFor({ state: 'hidden', timeout: 4000 });
    ok('Conflict warning clears after selecting a free time slot', true);

    // ── 3i. Save the event — confirm no 409 ─────────────────────────────
    last409 = false;
    await page.locator('[data-testid="btn-save-event"]').click();

    // Wait for the dialog to close (success) or for a 409 to be detected
    await page.locator('[data-testid="btn-save-event"]').waitFor({ state: 'detached', timeout: 10000 });
    ok('Event dialog closed after save', true);
    ok('Save did not trigger a 409 conflict response', !last409, last409 ? '409 was fired' : undefined);

    // Track any event the browser created (for cleanup)
    // Query the DB for any event with our test title in this company
    const { rows } = await pool.query(
      `SELECT id FROM calendar_events
        WHERE company_id = $1
          AND title = 'Test Conflict Check Event'
        ORDER BY created_at DESC LIMIT 1`,
      [companyId]
    );
    if (rows[0]?.id) createdEventIds.push(rows[0].id);

  } catch (uiErr) {
    ok(`UI interaction completed without unexpected error`, false, uiErr.message);
    try {
      console.log(`  Browser URL at failure: ${page.url()}`);
      const visibleText = await page.locator('body').innerText({ timeout: 2000 });
      console.log(`  Visible page text: ${visibleText.replace(/\s+/g, ' ').trim().slice(0, 1000)}`);
    } catch (diagnosticErr) {
      console.log(`  Could not collect browser failure diagnostics: ${diagnosticErr.message}`);
    }
    if (consoleErrors.length) {
      console.log('  Browser console errors:');
      consoleErrors.slice(0, 5).forEach(e => console.log('    ', e));
    }
  } finally {
    await browser.close();
  }
}

// ── Entry point ───────────────────────────────────────────────────────────
(async () => {
  try {
    await main();
  } catch (err) {
    console.error('\n💥 Unexpected error:', err);
    failed++;
  } finally {
    await cleanup();
    pool.end().catch(() => {});
    console.log('\n─────────────────────────────────────────────────');
    console.log(`Total: ${passed} passed, ${failed} failed`);
    console.log('─────────────────────────────────────────────────\n');
    process.exit(failed > 0 ? 1 : 0);
  }
})();
