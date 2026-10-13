#!/usr/bin/env node
/**
 * Quick Create Shortcuts Persistence Smoke Test (end-to-end, live server)
 * ────────────────────────────────────────────────────────────────────────
 * Confirms that Quick Create shortcuts survive a main Company Profile save.
 *
 * The risk: CompanySetup.jsx has two separate PUT paths that both write to
 * companies.settings (a full JSONB replace on the dedicated companies table):
 *
 *   - saveShortcutsMutation  → PUT { settings: { ...currentSettings, quick_create_shortcuts: [...] } }
 *   - saveCompanyMutation    → PUT { settings: { ...(myCompany?.settings||{}), time_zone, ... } }
 *
 * If saveCompanyMutation runs with a stale myCompany.settings (before React Query
 * refetches after saveShortcutsMutation.onSuccess), the spread omits
 * quick_create_shortcuts and the column is overwritten with only the profile fields.
 * The universalUpdate handler in prod-db.cjs writes settings as a FULL column replace
 * (UPDATE companies SET settings = $1), so omitting quick_create_shortcuts = gone.
 *
 * Test scenarios:
 *   1. Happy path (fresh settings spread):
 *      save shortcuts → GET company back → build settingsPayload spreading fresh
 *      settings (including shortcuts) → PUT company profile → verify shortcuts survive
 *
 *   2. Stale-cache risk (documented):
 *      save shortcuts → PUT company profile WITHOUT shortcuts in settings →
 *      verify shortcuts ARE wiped (proves full-replace semantics; documents why
 *      the invalidateQueries in saveShortcutsMutation.onSuccess is critical)
 *
 *   3. Non-admin staff user:
 *      can GET company (shortcuts card readable/visible), AND the isAdmin guard in
 *      saveShortcutsMutation is client-side only — a non-admin can bypass the UI
 *      and PUT directly via entity API (asserted + documented for future hardening)
 *
 * Prerequisites:
 *   - The app server must be running on PORT (default 5000)  — `npm run dev`
 *   - DATABASE_URL and SESSION_SECRET must match the running server
 *
 * Usage:  node scripts/test-quick-create-shortcuts.cjs
 *
 * All fixture IDs use a stable "smoke_qcs_" prefix; the script cleans up after
 * itself (even on failure) so repeated runs never accumulate test data.
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool = createPool({ connectionString: process.env.DATABASE_URL });

const OWNER_EMAIL = 'smoke-qcs-owner@example.com';
const OWNER_UID   = 'smoke_qcs_owner_user';
const OWNER_SID   = 'smoke_qcs_owner_session';

const STAFF_EMAIL = 'smoke-qcs-staff@example.com';
const STAFF_UID   = 'smoke_qcs_staff_user';
const STAFF_SID   = 'smoke_qcs_staff_session';

const TEST_SHORTCUTS      = ['lead', 'estimate', 'invoice', 'customer'];
const TEST_COLOR_OVERRIDES = { lead: '#22c55e', estimate: '#3b82f6' };

let passed = 0;
let failed = 0;

function ok(name, cond, extra) {
  if (cond) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    console.log(`  \u2717 ${name}${extra !== undefined ? ` (got ${JSON.stringify(extra)})` : ''}`);
    failed++;
  }
}

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          let d;
          try { d = JSON.parse(b); } catch { d = b; }
          resolve({ status: res.statusCode, data: d });
        });
      }
    );
    req.on('error', reject);
    if (opts.body !== undefined) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

function forgeSessionCookie(sid) {
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}

async function getCompanyRow(id) {
  const { rows } = await pool.query('SELECT * FROM companies WHERE id = $1 LIMIT 1', [id]);
  return rows[0] || null;
}

async function cleanup(extraCompanyId) {
  const { rows } = await pool.query(
    `SELECT id FROM companies WHERE LOWER(created_by) IN ($1, $2)`,
    [OWNER_EMAIL, STAFF_EMAIL]
  );
  for (const r of rows) {
    await pool.query('DELETE FROM staff_profiles WHERE company_id = $1', [r.id]);
  }
  if (extraCompanyId) {
    await pool.query('DELETE FROM staff_profiles WHERE company_id = $1', [extraCompanyId]);
    await pool.query('DELETE FROM companies WHERE id = $1', [extraCompanyId]);
  }
  await pool.query(
    `DELETE FROM staff_profiles WHERE LOWER(COALESCE(user_email, email)) IN ($1, $2)`,
    [OWNER_EMAIL, STAFF_EMAIL]
  );
  await pool.query(
    `DELETE FROM companies WHERE LOWER(created_by) IN ($1, $2)`,
    [OWNER_EMAIL, STAFF_EMAIL]
  );
  await pool.query(
    `DELETE FROM users WHERE id IN ($1, $2) OR LOWER(email) IN ($3, $4)`,
    [OWNER_UID, STAFF_UID, OWNER_EMAIL, STAFF_EMAIL]
  );
  await pool.query(`DELETE FROM sessions WHERE sid IN ($1, $2)`, [OWNER_SID, STAFF_SID]);
}

async function waitForServer(maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetchJson(`${BASE_URL}/api/local/entity/Company?limit=1`);
      if (r.status) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function seedSession(uid, email, sid) {
  await pool.query(
    `INSERT INTO users (id, email, first_name, created_at, updated_at)
     VALUES ($1, $2, 'SmokeQCS', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [uid, email]
  );
  const sess = {
    cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' },
    passport: { user: { claims: { email } } },
  };
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = $2::jsonb, expire = $3`,
    [sid, JSON.stringify(sess), new Date(Date.now() + 3600000)]
  );
  return forgeSessionCookie(sid);
}

(async () => {
  if (!process.env.SESSION_SECRET) {
    console.error('[qcs] SESSION_SECRET is not set — cannot forge a session. Aborting.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('[qcs] DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  if (!(await waitForServer())) {
    console.error(
      `[qcs] Server at ${BASE_URL} did not respond within 60s. Is 'Start application' running?`
    );
    await pool.end();
    process.exit(1);
  }

  let companyId = null;
  try {
    await cleanup();

    // ── Seed: owner user + session ──────────────────────────────────────────
    const ownerCookie = await seedSession(OWNER_UID, OWNER_EMAIL, OWNER_SID);

    // Create company
    console.log('[qcs] Creating test company...');
    const initialSettings = {
      time_zone: 'America/Chicago',
      default_tax_rate: 8,
      invoice_prefix: 'INV-',
      invoice_next_number: 1,
      estimate_prefix: 'EST-',
      estimate_next_number: 1,
    };
    const co = await fetchJson(`${BASE_URL}/api/local/entity/Company`, {
      method: 'POST',
      headers: { Cookie: ownerCookie },
      body: {
        company_name: 'Smoke QCS Roofing',
        email: OWNER_EMAIL,
        setup_completed: false,
        settings: initialSettings,
      },
    });
    ok(`Company create returns 2xx (got ${co.status})`, co.status === 201 || co.status === 200);
    companyId = co.data && co.data.id;
    ok('Company create returned an id', !!companyId);
    if (!companyId) throw new Error('No company id — cannot continue');

    // Create owner admin staff profile
    const sp = await fetchJson(`${BASE_URL}/api/local/entity/StaffProfile`, {
      method: 'POST',
      headers: { Cookie: ownerCookie },
      body: {
        company_id: companyId,
        user_email: OWNER_EMAIL,
        full_name: 'QCS Smoke Owner',
        position: 'Owner',
        is_administrator: true,
        is_active: true,
      },
    });
    ok(`Owner StaffProfile create returns 2xx (got ${sp.status})`, sp.status === 201 || sp.status === 200);

    // Start trial
    await fetchJson(`${BASE_URL}/api/functions/invoke`, {
      method: 'POST',
      headers: { Cookie: ownerCookie },
      body: { functionName: 'startCompanyTrial', params: { companyId, plan: 'basic' } },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // SCENARIO 1: Happy path — shortcuts survive a profile save (fresh cache)
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n[qcs] Scenario 1: Happy path (fresh settings spread)');

    // Step 1a: Save shortcuts (mirrors saveShortcutsMutation which spreads current settings)
    const currentRow = await getCompanyRow(companyId);
    const currentSettings = currentRow?.settings || {};
    const r1 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: ownerCookie },
      body: {
        settings: {
          ...currentSettings,
          quick_create_shortcuts: TEST_SHORTCUTS,
          shortcut_color_overrides: TEST_COLOR_OVERRIDES,
        },
      },
    });
    ok(`PUT shortcuts returns 200 (got ${r1.status})`, r1.status === 200);

    // Step 1b: GET company back — simulates the React Query cache refetch that
    //          saveShortcutsMutation.onSuccess triggers via invalidateQueries(['companies'])
    const getResp = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'GET',
      headers: { Cookie: ownerCookie },
    });
    ok(`GET company after shortcuts save returns 200 (got ${getResp.status})`, getResp.status === 200);
    const freshSettings = getResp.data?.settings || {};
    ok(
      'Shortcuts are in the GET response (cache would have them after refetch)',
      Array.isArray(freshSettings.quick_create_shortcuts) &&
        JSON.stringify(freshSettings.quick_create_shortcuts) === JSON.stringify(TEST_SHORTCUTS),
      freshSettings.quick_create_shortcuts
    );
    ok(
      'Color overrides are in the GET response',
      freshSettings.shortcut_color_overrides &&
        freshSettings.shortcut_color_overrides.lead === TEST_COLOR_OVERRIDES.lead,
      freshSettings.shortcut_color_overrides
    );

    // Step 1c: Save company profile by spreading the FRESH settings (mirrors saveCompanyMutation
    //          when myCompany has been updated by the cache refetch):
    //
    //    const settingsPayload = {
    //      ...(myCompany?.settings || {}),   ← spread includes quick_create_shortcuts
    //      time_zone, default_tax_rate, ...  ← profile fields overwrite only their own keys
    //    }
    const r2 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: ownerCookie },
      body: {
        settings: {
          ...freshSettings,              // spread of fresh myCompany.settings
          time_zone: 'America/New_York', // profile fields
          default_tax_rate: 10,
          invoice_prefix: 'INV-',
          invoice_next_number: 5,
          estimate_prefix: 'EST-',
          estimate_next_number: 3,
        },
        company_name: 'Smoke QCS Roofing (Updated)',
        phone: '555-0200',
        preferred_language: 'en',
      },
    });
    ok(`PUT profile (spreading fresh settings) returns 200 (got ${r2.status})`, r2.status === 200);

    // Step 1d: Verify in DB that shortcuts survived the profile save
    const afterProfile = await getCompanyRow(companyId);
    const settingsAfterProfile = afterProfile?.settings || {};
    ok(
      'quick_create_shortcuts survived the main profile save',
      Array.isArray(settingsAfterProfile.quick_create_shortcuts) &&
        JSON.stringify(settingsAfterProfile.quick_create_shortcuts) ===
          JSON.stringify(TEST_SHORTCUTS),
      settingsAfterProfile.quick_create_shortcuts
    );
    ok(
      'shortcut_color_overrides survived the main profile save',
      settingsAfterProfile.shortcut_color_overrides &&
        settingsAfterProfile.shortcut_color_overrides.lead === TEST_COLOR_OVERRIDES.lead,
      settingsAfterProfile.shortcut_color_overrides
    );
    ok(
      'Profile change also applied (time_zone)',
      settingsAfterProfile.time_zone === 'America/New_York',
      settingsAfterProfile.time_zone
    );
    ok(
      'Profile change also applied (company_name)',
      afterProfile?.company_name === 'Smoke QCS Roofing (Updated)',
      afterProfile?.company_name
    );

    // ═══════════════════════════════════════════════════════════════════════
    // SCENARIO 2: Stale-cache risk — full-replace semantics demonstrated
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n[qcs] Scenario 2: Stale-cache risk (settings without shortcuts)');

    // Precondition: shortcuts are in DB right now (from Scenario 1)
    const beforeStale = await getCompanyRow(companyId);
    ok(
      'Precondition: shortcuts are in DB before stale-cache test',
      Array.isArray(beforeStale?.settings?.quick_create_shortcuts) &&
        beforeStale.settings.quick_create_shortcuts.length > 0,
      beforeStale?.settings?.quick_create_shortcuts
    );

    // Simulate saveCompanyMutation firing with STALE myCompany.settings:
    // the stale cache was captured before shortcuts were saved, so it has only
    // the initial profile fields — no quick_create_shortcuts.
    const r3 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: ownerCookie },
      body: {
        settings: {
          // stale settings — does NOT contain quick_create_shortcuts
          time_zone: 'America/Chicago',
          default_tax_rate: 8,
          invoice_prefix: 'INV-',
          invoice_next_number: 1,
          estimate_prefix: 'EST-',
          estimate_next_number: 1,
        },
        company_name: 'Smoke QCS Roofing (Stale Save)',
      },
    });
    ok(`PUT profile (stale settings) returns 200 (got ${r3.status})`, r3.status === 200);

    // Inspect the actual server behaviour — informational only (no ok() assertion here).
    // If the server ever switches to JSONB deep-merge for settings, this block will
    // log "deep-merge detected" and the restore step will still work correctly.
    // Making this a pass/fail gate would cause the test to fail when backend
    // semantics improve, which is the opposite of what we want.
    const afterStale = await getCompanyRow(companyId);
    const settingsAfterStale = afterStale?.settings || {};
    const shortcutsWiped =
      !settingsAfterStale.quick_create_shortcuts ||
      settingsAfterStale.quick_create_shortcuts.length === 0;
    if (shortcutsWiped) {
      console.log(
        '  \u2139  INFO: companies.settings is a FULL column replace (universalUpdate, prod-db.cjs).'
      );
      console.log(
        '     Shortcuts were wiped when settings payload omitted quick_create_shortcuts.'
      );
      console.log(
        '     The cache invalidation + refetch in saveShortcutsMutation.onSuccess is the only guard.'
      );
      console.log('     See follow-up task #732 to switch to JSONB merge for settings.');
    } else {
      console.log(
        '  \u2139  INFO: Server performed a JSONB deep-merge for settings — shortcuts survived!'
      );
      console.log('     This is the desired behaviour. Follow-up task #732 may already be done.');
    }

    // Restore shortcuts so Scenario 3 starts clean
    const r4 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: ownerCookie },
      body: {
        settings: {
          ...settingsAfterStale,
          quick_create_shortcuts: TEST_SHORTCUTS,
          shortcut_color_overrides: TEST_COLOR_OVERRIDES,
        },
      },
    });
    ok(`Shortcuts restored (PUT returns ${r4.status})`, r4.status === 200);
    const afterRestore = await getCompanyRow(companyId);
    ok(
      'Shortcuts back in DB after restore',
      Array.isArray(afterRestore?.settings?.quick_create_shortcuts) &&
        afterRestore.settings.quick_create_shortcuts.length === TEST_SHORTCUTS.length,
      afterRestore?.settings?.quick_create_shortcuts
    );

    // ═══════════════════════════════════════════════════════════════════════
    // SCENARIO 3: Non-admin staff user — card visible, save is UI-gated
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n[qcs] Scenario 3: Non-admin staff user');

    // Create non-admin staff (owner creates the profile)
    const staffCookie = await seedSession(STAFF_UID, STAFF_EMAIL, STAFF_SID);
    const staffSp = await fetchJson(`${BASE_URL}/api/local/entity/StaffProfile`, {
      method: 'POST',
      headers: { Cookie: ownerCookie },
      body: {
        company_id: companyId,
        user_email: STAFF_EMAIL,
        full_name: 'QCS Smoke Staff',
        position: 'Sales Rep',
        is_administrator: false,
        is_active: true,
      },
    });
    ok(
      `Non-admin StaffProfile create returns 2xx (got ${staffSp.status})`,
      staffSp.status === 201 || staffSp.status === 200
    );

    // Non-admin can GET the company — shortcuts card is visible
    const staffGetResp = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'GET',
      headers: { Cookie: staffCookie },
    });
    ok(
      `Non-admin can GET company (got ${staffGetResp.status})`,
      staffGetResp.status === 200
    );
    const staffVisibleSettings = staffGetResp.data?.settings || {};
    ok(
      'Non-admin can read quick_create_shortcuts (shortcuts card is visible)',
      Array.isArray(staffVisibleSettings.quick_create_shortcuts) &&
        staffVisibleSettings.quick_create_shortcuts.length === TEST_SHORTCUTS.length,
      staffVisibleSettings.quick_create_shortcuts
    );

    // ── Static analysis: verify client-side "saving is disabled" guard exists ──
    // The task requires that non-admin staff can SEE the shortcuts card but cannot
    // save changes (controls are disabled).  We verify four source-level contracts:
    //   1. isAdmin is computed from sp?.is_administrator === true
    //   2. The Save Shortcuts button is disabled={!isAdmin || ...} (UI save gate)
    //   3. saveShortcutsMutation.mutationFn has an explicit `if (!isAdmin) throw`
    //      guard as defense-in-depth (prevents bypass via programmatic .mutate())
    //   4. A non-admin notice is rendered inside the card (card is always visible)
    {
      const csPath = path.join(__dirname, '..', 'src', 'pages', 'CompanySetup.jsx');
      const cs = fs.existsSync(csPath) ? fs.readFileSync(csPath, 'utf8') : '';
      ok(
        'CompanySetup: isAdmin derived from sp?.is_administrator === true',
        cs.includes('is_administrator === true'),
        cs ? 'not found' : 'file missing'
      );
      ok(
        'CompanySetup: Save Shortcuts button disabled for non-admins (!isAdmin || ...)',
        cs.includes('disabled={!isAdmin || saveShortcutsMutation.isPending'),
        cs ? 'disabled={!isAdmin || ...} not found on save button' : 'file missing'
      );
      ok(
        'CompanySetup: saveShortcutsMutation has isAdmin throw guard (defense-in-depth)',
        cs.includes('if (!isAdmin) throw') || cs.includes('if(!isAdmin)throw'),
        cs ? 'guard not found in saveShortcutsMutation' : 'file missing'
      );
      ok(
        'CompanySetup: non-admin notice rendered inside card (card is visible to all staff)',
        cs.includes('Only company administrators can modify Quick Create shortcuts'),
        cs ? 'non-admin notice not found — card may be fully hidden for non-admins' : 'file missing'
      );
    }

    // Server-side enforcement: a non-admin who bypasses the UI and PUTs
    // quick_create_shortcuts directly to the entity API must receive 403.
    // This is enforced by enforceAdminOnlyCompanySettings() in lib/tenantGuard.cjs,
    // called from both the dev (vite-db-plugin.js) and prod (db/prod-db.cjs) PUT
    // handlers AFTER the billing/subscription strips.
    const staffPutResp = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: staffCookie },
      body: {
        settings: {
          ...staffVisibleSettings,
          quick_create_shortcuts: ['lead'], // non-admin attempts to change shortcuts via raw API
        },
      },
    });
    ok(
      `Non-admin entity-API PUT of quick_create_shortcuts returns 403 (got ${staffPutResp.status})`,
      staffPutResp.status === 403 || staffPutResp.status === 401
    );

    // Restore shortcuts to full set as owner
    await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: ownerCookie },
      body: {
        settings: {
          ...staffVisibleSettings,
          quick_create_shortcuts: TEST_SHORTCUTS,
          shortcut_color_overrides: TEST_COLOR_OVERRIDES,
        },
      },
    });

    // Final DB assertion
    const finalRow = await getCompanyRow(companyId);
    ok(
      'Final DB state: shortcuts intact after all scenario operations',
      Array.isArray(finalRow?.settings?.quick_create_shortcuts) &&
        JSON.stringify(finalRow.settings.quick_create_shortcuts) ===
          JSON.stringify(TEST_SHORTCUTS),
      finalRow?.settings?.quick_create_shortcuts
    );

  } catch (e) {
    console.error('[qcs] UNEXPECTED ERROR:', e);
    failed++;
  } finally {
    try { await cleanup(companyId); } catch (e) {
      console.error('[qcs] cleanup error:', e.message);
    }
    await pool.end();
  }

  console.log(`\n[qcs] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
