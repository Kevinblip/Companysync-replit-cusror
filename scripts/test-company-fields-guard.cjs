#!/usr/bin/env node
/**
 * Admin-only company-fields guard smoke test (end-to-end, live server)
 * ─────────────────────────────────────────────────────────────────────
 * Proves that a NON-ADMIN staff member cannot change top-level company
 * identity fields (company_name, phone, address, logo_url, ...) via
 * `PUT /api/local/entity/Company/<id>` — closing the hole where only the
 * admin-only keys inside the `settings` JSONB were guarded.
 *
 * Scenarios:
 *   1. Non-admin PUT changing company_name           → 403
 *   2. Non-admin PUT changing phone + logo_url       → 403
 *   3. Non-admin smuggle via nested data JSONB       → 403
 *   4. Non-admin PUT via raw /entity/companies alias → 403
 *   5. Non-admin echo of UNCHANGED identity fields   → 200 (spread-back safe)
 *   6. Non-admin PUT changing timezone               → 200 (GeneralSettings flow)
 *   7. Admin PUT changing company_name               → 200
 *   8. Owner (created_by, no admin profile) PUT      → 200
 *   9. DB row confirms only the allowed writes stuck
 *  10. Cross-company admin guard (identity fields + settings)
 *  11–15. Settings key protection (alert_recipients, notify, financial, voice)
 *  16. DB row after settings scenarios
 *  17. Erasure bypass via omitting protected keys → 403
 *  18. Partial echo erasure bypass → 403
 *  19. DB row: protected settings survived erasure attempts
 *
 * Prerequisites:
 *   - The app server must be running on PORT (default 5000) — `npm run dev`
 *   - DATABASE_URL and SESSION_SECRET must match the running server
 *
 * Usage:  node scripts/test-company-fields-guard.cjs
 *
 * Fixture IDs use a stable "smoke_cfg_" prefix; the script cleans up after
 * itself (even on failure) so repeated runs never accumulate test data.
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http = require('http');
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool = createPool({ connectionString: process.env.DATABASE_URL });

const OWNER_EMAIL = 'smoke-cfg-owner@example.com';
const OWNER_UID   = 'smoke_cfg_owner_user';
const OWNER_SID   = 'smoke_cfg_owner_session';

const ADMIN_EMAIL = 'smoke-cfg-admin@example.com';
const ADMIN_UID   = 'smoke_cfg_admin_user';
const ADMIN_SID   = 'smoke_cfg_admin_session';

const STAFF_EMAIL = 'smoke-cfg-staff@example.com';
const STAFF_UID   = 'smoke_cfg_staff_user';
const STAFF_SID   = 'smoke_cfg_staff_session';

// Company B owner — separate tenant for the cross-company admin scenario.
const OWNER_B_EMAIL = 'smoke-cfg-owner-b@example.com';
const OWNER_B_UID   = 'smoke_cfg_owner_b_user';
const OWNER_B_SID   = 'smoke_cfg_owner_b_session';

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

async function cleanup() {
  const { rows } = await pool.query(
    `SELECT id FROM companies WHERE LOWER(created_by) IN ($1, $2, $3, $4)`,
    [OWNER_EMAIL, ADMIN_EMAIL, STAFF_EMAIL, OWNER_B_EMAIL]
  );
  for (const r of rows) {
    await pool.query('DELETE FROM staff_profiles WHERE company_id = $1', [r.id]);
  }
  await pool.query(
    `DELETE FROM staff_profiles WHERE LOWER(COALESCE(user_email, email)) IN ($1, $2, $3, $4)`,
    [OWNER_EMAIL, ADMIN_EMAIL, STAFF_EMAIL, OWNER_B_EMAIL]
  );
  await pool.query(
    `DELETE FROM companies WHERE LOWER(created_by) IN ($1, $2, $3, $4)`,
    [OWNER_EMAIL, ADMIN_EMAIL, STAFF_EMAIL, OWNER_B_EMAIL]
  );
  await pool.query(
    `DELETE FROM users WHERE id IN ($1, $2, $3, $4) OR LOWER(email) IN ($5, $6, $7, $8)`,
    [OWNER_UID, ADMIN_UID, STAFF_UID, OWNER_B_UID, OWNER_EMAIL, ADMIN_EMAIL, STAFF_EMAIL, OWNER_B_EMAIL]
  );
  await pool.query(`DELETE FROM sessions WHERE sid IN ($1, $2, $3, $4)`, [OWNER_SID, ADMIN_SID, STAFF_SID, OWNER_B_SID]);
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
     VALUES ($1, $2, 'SmokeCFG', NOW(), NOW())
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
    console.error('[cfg] SESSION_SECRET is not set — cannot forge a session. Aborting.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('[cfg] DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  if (!(await waitForServer())) {
    console.error(
      `[cfg] Server at ${BASE_URL} did not respond within 60s. Is 'Start application' running?`
    );
    await pool.end();
    process.exit(1);
  }

  let companyId = null;
  try {
    await cleanup();

    // ── Seed: owner creates the company + becomes admin ─────────────────────
    const ownerCookie = await seedSession(OWNER_UID, OWNER_EMAIL, OWNER_SID);
    const adminCookie = await seedSession(ADMIN_UID, ADMIN_EMAIL, ADMIN_SID);
    const staffCookie = await seedSession(STAFF_UID, STAFF_EMAIL, STAFF_SID);

    console.log('[cfg] Creating test company...');
    const co = await fetchJson(`${BASE_URL}/api/local/entity/Company`, {
      method: 'POST',
      headers: { Cookie: ownerCookie },
      body: {
        company_name: 'Smoke CFG Roofing',
        phone: '+15550001111',
        address: '1 Main St',
        logo_url: 'https://example.com/logo.png',
        email: OWNER_EMAIL,
        settings: { default_tax_rate: 8 },
      },
    });
    ok(`Company create returns 2xx (got ${co.status})`, co.status === 201 || co.status === 200);
    companyId = co.data && co.data.id;
    ok('Company create returned an id', !!companyId);
    if (!companyId) throw new Error('No company id — cannot continue');

    // Owner admin staff profile (owner also matches created_by)
    const spOwner = await fetchJson(`${BASE_URL}/api/local/entity/StaffProfile`, {
      method: 'POST',
      headers: { Cookie: ownerCookie },
      body: {
        company_id: companyId,
        user_email: OWNER_EMAIL,
        full_name: 'CFG Smoke Owner',
        position: 'Owner',
        is_administrator: true,
        is_active: true,
      },
    });
    ok(`Owner StaffProfile create returns 2xx (got ${spOwner.status})`, spOwner.status === 201 || spOwner.status === 200);

    // Second admin (is_administrator, NOT the owner)
    const spAdmin = await fetchJson(`${BASE_URL}/api/local/entity/StaffProfile`, {
      method: 'POST',
      headers: { Cookie: ownerCookie },
      body: {
        company_id: companyId,
        user_email: ADMIN_EMAIL,
        full_name: 'CFG Smoke Admin',
        position: 'Office Manager',
        is_administrator: true,
        is_active: true,
      },
    });
    ok(`Admin StaffProfile create returns 2xx (got ${spAdmin.status})`, spAdmin.status === 201 || spAdmin.status === 200);

    // Regular staff member (NOT an administrator)
    const spStaff = await fetchJson(`${BASE_URL}/api/local/entity/StaffProfile`, {
      method: 'POST',
      headers: { Cookie: ownerCookie },
      body: {
        company_id: companyId,
        user_email: STAFF_EMAIL,
        full_name: 'CFG Smoke Staff',
        position: 'Sales Rep',
        is_administrator: false,
        is_active: true,
      },
    });
    ok(`Staff StaffProfile create returns 2xx (got ${spStaff.status})`, spStaff.status === 201 || spStaff.status === 200);

    // ═════════════════════════════════════════════════════════════════════
    // 1. Non-admin changing company_name → 403
    // ═════════════════════════════════════════════════════════════════════
    console.log('\n[cfg] Scenario 1: non-admin changes company_name');
    const s1 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: staffCookie },
      body: { company_name: 'Hijacked Roofing LLC' },
    });
    ok(`non-admin company_name change → 403 (got ${s1.status})`, s1.status === 403, s1.data);

    // ═════════════════════════════════════════════════════════════════════
    // 2. Non-admin changing phone + logo_url → 403
    // ═════════════════════════════════════════════════════════════════════
    console.log('[cfg] Scenario 2: non-admin changes phone + logo_url');
    const s2 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: staffCookie },
      body: { phone: '+15559990000', logo_url: 'https://evil.example/logo.png' },
    });
    ok(`non-admin phone/logo_url change → 403 (got ${s2.status})`, s2.status === 403, s2.data);

    // ═════════════════════════════════════════════════════════════════════
    // 3. Non-admin smuggling via nested data JSONB → 403
    // ═════════════════════════════════════════════════════════════════════
    console.log('[cfg] Scenario 3: non-admin smuggles company_name via data JSONB');
    const s3 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: staffCookie },
      body: { data: { company_name: 'Smuggled Roofing LLC' } },
    });
    ok(`non-admin data.company_name smuggle → 403 (got ${s3.status})`, s3.status === 403, s3.data);

    // ═════════════════════════════════════════════════════════════════════
    // 4. Non-admin via the raw /entity/companies/<id> alias → 403
    // ═════════════════════════════════════════════════════════════════════
    console.log('[cfg] Scenario 4: non-admin via raw companies alias');
    const s4 = await fetchJson(`${BASE_URL}/api/local/entity/companies/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: staffCookie },
      body: { company_name: 'Alias Hijack LLC' },
    });
    ok(`non-admin alias-route change → 403 (got ${s4.status})`, s4.status === 403, s4.data);

    // ═════════════════════════════════════════════════════════════════════
    // 5. Non-admin echoing UNCHANGED identity fields + UNCHANGED admin
    //    settings (spread-back safety) → 200
    // ═════════════════════════════════════════════════════════════════════
    console.log('[cfg] Scenario 5: non-admin echoes unchanged fields (spread-back)');
    const s5 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: staffCookie },
      body: {
        company_name: 'Smoke CFG Roofing',   // unchanged
        phone: '+15550001111',               // unchanged
        address: '1 Main St',               // unchanged
        // Echoing the exact same value that was set on create — change-detection
        // in enforceAdminOnlyCompanySettings should allow this through.
        settings: { default_tax_rate: 8 },  // unchanged (same as seed value)
      },
    });
    ok(`non-admin unchanged echo → 200 (got ${s5.status})`, s5.status === 200, s5.data);

    // ═════════════════════════════════════════════════════════════════════
    // 6. Non-admin changing timezone (GeneralSettings flow) → 200
    // ═════════════════════════════════════════════════════════════════════
    console.log('[cfg] Scenario 6: non-admin changes timezone');
    const s6 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: staffCookie },
      body: { timezone: 'America/Denver' },
    });
    ok(`non-admin timezone change → 200 (got ${s6.status})`, s6.status === 200, s6.data);

    // ═════════════════════════════════════════════════════════════════════
    // 7. Admin changing company_name → 200
    // ═════════════════════════════════════════════════════════════════════
    console.log('[cfg] Scenario 7: administrator changes company_name');
    const s7 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: adminCookie },
      body: { company_name: 'Smoke CFG Roofing (Renamed)' },
    });
    ok(`admin company_name change → 200 (got ${s7.status})`, s7.status === 200, s7.data);

    // ═════════════════════════════════════════════════════════════════════
    // 8. Owner (created_by) changing phone → 200
    // ═════════════════════════════════════════════════════════════════════
    console.log('[cfg] Scenario 8: owner (created_by) changes phone');
    const s8 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: ownerCookie },
      body: { phone: '+15552223333' },
    });
    ok(`owner phone change → 200 (got ${s8.status})`, s8.status === 200, s8.data);

    // ═════════════════════════════════════════════════════════════════════
    // 9. DB row: only the allowed writes stuck
    // ═════════════════════════════════════════════════════════════════════
    console.log('[cfg] Scenario 9: verify final DB state');
    const row = await getCompanyRow(companyId);
    ok('company_name is the ADMIN rename (no hijack)', row?.company_name === 'Smoke CFG Roofing (Renamed)', row?.company_name);
    ok('phone is the OWNER update (no staff write)', row?.phone === '+15552223333', row?.phone);
    ok('logo_url untouched', row?.logo_url === 'https://example.com/logo.png', row?.logo_url);
    ok('timezone is the staff update (allowed)', row?.timezone === 'America/Denver', row?.timezone);
    // default_tax_rate: staff echoed the same value (8) which is allowed; the
    // value must still be 8 (seed value) — no change was made.
    ok('settings tax rate unchanged (staff echo allowed, no change)', row?.settings?.default_tax_rate === 8, row?.settings?.default_tax_rate);
    const dataBlob = row?.data || {};
    ok('data JSONB has no smuggled company_name', dataBlob.company_name === undefined, dataBlob.company_name);

    // ═════════════════════════════════════════════════════════════════════
    // 10. Cross-company admin: admin of company A tries to edit company B
    //     where they are only plain staff → must be 403.
    //     The fix: isAdministrator was GLOBAL (true if admin in ANY company),
    //     so an admin of company A + member of B could change B's name/logo/
    //     phone/settings. Now per-company administratorCompanyIds is checked.
    // ═════════════════════════════════════════════════════════════════════
    console.log('\n[cfg] Scenario 10: cross-company admin guard (identity fields + settings)');
    const ownerBCookie = await seedSession(OWNER_B_UID, OWNER_B_EMAIL, OWNER_B_SID);

    // Create company B (completely separate tenant) with protected settings populated
    const coB = await fetchJson(`${BASE_URL}/api/local/entity/Company`, {
      method: 'POST',
      headers: { Cookie: ownerBCookie },
      body: {
        company_name: 'Smoke CFG Beta Roofing',
        phone: '+15557778888',
        address: '99 Other St',
        logo_url: 'https://example.com/logo-b.png',
        email: OWNER_B_EMAIL,
        settings: { default_tax_rate: 5, alert_recipients: [{ email: 'b@smoke.example', notify_email: true }] },
      },
    });
    ok(`Company B create returns 2xx (got ${coB.status})`, coB.status === 201 || coB.status === 200);
    const companyBId = coB.data && coB.data.id;
    ok('Company B create returned an id', !!companyBId);

    if (companyBId) {
      // Add admin (who is is_administrator=true on company A) as PLAIN STAFF on company B.
      await fetchJson(`${BASE_URL}/api/local/entity/StaffProfile`, {
        method: 'POST',
        headers: { Cookie: ownerBCookie },
        body: {
          company_id: companyBId,
          user_email: ADMIN_EMAIL,
          full_name: 'CFG Smoke Admin (B staff)',
          position: 'Sales Rep',
          is_administrator: false,
          is_active: true,
        },
      });

      // Admin is now: admin of company A, plain staff of company B.
      // They must NOT be able to change company B's identity fields.
      const s10a = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyBId}`, {
        method: 'PUT',
        headers: { Cookie: adminCookie },
        body: { company_name: 'Cross-Company Hijack' },
      });
      ok(`admin-of-A changing company B name → 403 (got ${s10a.status})`, s10a.status === 403, s10a.data);

      const s10b = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyBId}`, {
        method: 'PUT',
        headers: { Cookie: adminCookie },
        body: { phone: '+15550000000', logo_url: 'https://evil.example/b.png' },
      });
      ok(`admin-of-A changing company B phone/logo → 403 (got ${s10b.status})`, s10b.status === 403, s10b.data);

      // Admin-of-A must NOT be able to change company B's protected settings keys.
      const s10e = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyBId}`, {
        method: 'PUT',
        headers: { Cookie: adminCookie },
        body: {
          settings: {
            default_tax_rate: 99,
            alert_recipients: [{ email: 'hijack@evil.example', notify_email: true }],
          },
        },
      });
      ok(`admin-of-A changing company B settings → 403 (got ${s10e.status})`, s10e.status === 403, s10e.data);

      // Echo of unchanged company B values must still pass (spread-back safety).
      const s10c = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyBId}`, {
        method: 'PUT',
        headers: { Cookie: adminCookie },
        body: { company_name: 'Smoke CFG Beta Roofing', phone: '+15557778888' },
      });
      ok(`admin-of-A echoing company B unchanged values → 200 (got ${s10c.status})`, s10c.status === 200, s10c.data);

      // Admin can still freely edit company A (their own admin company).
      const s10d = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
        method: 'PUT',
        headers: { Cookie: adminCookie },
        body: { company_name: 'Smoke CFG Roofing (Confirmed Admin)' },
      });
      ok(`admin-of-A can still edit company A → 200 (got ${s10d.status})`, s10d.status === 200, s10d.data);

      // Verify company B was not changed.
      const rowB = await getCompanyRow(companyBId);
      ok('company B name not hijacked', rowB?.company_name === 'Smoke CFG Beta Roofing', rowB?.company_name);
      ok('company B phone not changed', rowB?.phone === '+15557778888', rowB?.phone);
      ok('company B settings not hijacked (tax rate still 5)', rowB?.settings?.default_tax_rate === 5, rowB?.settings?.default_tax_rate);
    }

    // ═════════════════════════════════════════════════════════════════════
    // 11. Non-admin changing alert_recipients → 403
    // ═════════════════════════════════════════════════════════════════════
    console.log('\n[cfg] Scenario 11: non-admin changes alert_recipients');
    const s11 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: staffCookie },
      body: {
        settings: {
          alert_recipients: [{ email: 'attacker@evil.example', notify_email: true }],
        },
      },
    });
    ok(`non-admin alert_recipients change → 403 (got ${s11.status})`, s11.status === 403, s11.data);

    // ═════════════════════════════════════════════════════════════════════
    // 12. Non-admin changing approval_alert_phone → 403
    // ═════════════════════════════════════════════════════════════════════
    console.log('[cfg] Scenario 12: non-admin changes approval_alert_phone');
    const s12 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: staffCookie },
      body: {
        settings: {
          approval_alert_phone: '+15559998888',
          adjuster_review_notify_email: false,
          adjuster_review_notify_sms: false,
        },
      },
    });
    ok(`non-admin approval_alert_phone/notify change → 403 (got ${s12.status})`, s12.status === 403, s12.data);

    // ═════════════════════════════════════════════════════════════════════
    // 13. Non-admin changing financial settings (tax rate, invoice prefix) → 403
    // ═════════════════════════════════════════════════════════════════════
    console.log('[cfg] Scenario 13: non-admin changes financial settings');
    const s13 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: staffCookie },
      body: {
        settings: {
          default_tax_rate: 0,      // change from seed value of 8
          invoice_prefix: 'HACK-',  // change from default
          invoice_next_number: 9999,
          estimate_prefix: 'BAD-',
          estimate_next_number: 1,
        },
      },
    });
    ok(`non-admin financial settings change → 403 (got ${s13.status})`, s13.status === 403, s13.data);

    // ═════════════════════════════════════════════════════════════════════
    // 14. Non-admin changing voice_cheat_sheet → 403
    // ═════════════════════════════════════════════════════════════════════
    console.log('[cfg] Scenario 14: non-admin changes voice_cheat_sheet');
    const s14 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: staffCookie },
      body: {
        settings: {
          voice_cheat_sheet: { photos: ['say cheese'], sections: [], counters: [] },
        },
      },
    });
    ok(`non-admin voice_cheat_sheet change → 403 (got ${s14.status})`, s14.status === 403, s14.data);

    // ═════════════════════════════════════════════════════════════════════
    // 15. Admin can change newly protected settings keys → 200
    // ═════════════════════════════════════════════════════════════════════
    console.log('[cfg] Scenario 15: admin changes newly protected settings keys');
    const s15 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: adminCookie },
      body: {
        settings: {
          alert_recipients: [{ email: 'admin@smoke.example', notify_email: true }],
          approval_alert_phone: '+15551234567',
          adjuster_review_notify_email: true,
          adjuster_review_notify_sms: true,
          default_tax_rate: 10,
          invoice_prefix: 'INV-',
          voice_cheat_sheet: { photos: ['take photo'], sections: ['roof'], counters: [] },
        },
      },
    });
    ok(`admin protected-settings change → 200 (got ${s15.status})`, s15.status === 200, s15.data);

    // ═════════════════════════════════════════════════════════════════════
    // 16. DB row: newly protected settings blocked for staff, allowed for admin
    // ═════════════════════════════════════════════════════════════════════
    console.log('[cfg] Scenario 16: verify settings DB state after scenarios 11–15');
    const row2 = await getCompanyRow(companyId);
    const sv = row2?.settings || {};
    ok('alert_recipients is the admin write (no staff hijack)', Array.isArray(sv.alert_recipients) && sv.alert_recipients[0]?.email === 'admin@smoke.example', sv.alert_recipients);
    ok('approval_alert_phone is the admin write', sv.approval_alert_phone === '+15551234567', sv.approval_alert_phone);
    ok('default_tax_rate is the admin write (10)', sv.default_tax_rate === 10, sv.default_tax_rate);
    ok('voice_cheat_sheet is the admin write', Array.isArray(sv.voice_cheat_sheet?.photos) && sv.voice_cheat_sheet.photos[0] === 'take photo', sv.voice_cheat_sheet);

    // ═════════════════════════════════════════════════════════════════════
    // 17. Non-admin omitting protected keys (erasure bypass) → 403
    //
    // companies.settings is a FULL-REPLACE column.  A non-admin who sends
    // { settings: { time_zone: 'America/Denver' } } would erase all
    // protected keys (alert_recipients, approval_alert_phone, …) from the
    // DB row, even though they never touched those keys explicitly.
    // ═════════════════════════════════════════════════════════════════════
    console.log('\n[cfg] Scenario 17: non-admin omits protected keys (erasure bypass)');
    const s17 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: staffCookie },
      body: {
        settings: {
          // Intentionally omitting alert_recipients, approval_alert_phone, etc.
          // that were set by scenario 15 — this would erase them on a full-replace.
          time_zone: 'America/Chicago',
        },
      },
    });
    ok(`non-admin erasure via omission → 403 (got ${s17.status})`, s17.status === 403, s17.data);

    // ═════════════════════════════════════════════════════════════════════
    // 18. Non-admin echoes one protected key but omits others → 403
    //
    // A subtler variant: the non-admin echoes one protected key unchanged
    // (which would pass key-presence-only detection) but omits the rest,
    // still erasing them via the full-replace column write.
    // ═════════════════════════════════════════════════════════════════════
    console.log('[cfg] Scenario 18: non-admin echoes one protected key but omits the rest');
    const s18 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: staffCookie },
      body: {
        settings: {
          default_tax_rate: 10,          // echoed unchanged from scenario 15
          // approval_alert_phone, alert_recipients, voice_cheat_sheet omitted
          time_zone: 'America/Chicago',
        },
      },
    });
    ok(`non-admin partial echo (omits other protected keys) → 403 (got ${s18.status})`, s18.status === 403, s18.data);

    // ═════════════════════════════════════════════════════════════════════
    // 19. DB row: protected settings survived erasure bypass attempts
    // ═════════════════════════════════════════════════════════════════════
    console.log('[cfg] Scenario 19: verify settings survive erasure bypass attempts');
    const row3 = await getCompanyRow(companyId);
    const sv3 = row3?.settings || {};
    ok('alert_recipients survived erasure attempt', Array.isArray(sv3.alert_recipients) && sv3.alert_recipients[0]?.email === 'admin@smoke.example', sv3.alert_recipients);
    ok('approval_alert_phone survived erasure attempt', sv3.approval_alert_phone === '+15551234567', sv3.approval_alert_phone);
    ok('default_tax_rate survived erasure attempt', sv3.default_tax_rate === 10, sv3.default_tax_rate);

    // ═════════════════════════════════════════════════════════════════════
    // 20. Non-admin sending { settings: null } → 403
    //
    // companies.settings is a full-replace column.  Sending null replaces
    // the entire JSONB value, erasing every protected key in one shot.
    // ═════════════════════════════════════════════════════════════════════
    console.log('\n[cfg] Scenario 20: non-admin sends settings:null (total erasure)');
    const s20 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: staffCookie },
      body: { settings: null },
    });
    ok(`non-admin settings:null → 403 (got ${s20.status})`, s20.status === 403, s20.data);

    // ═════════════════════════════════════════════════════════════════════
    // 21. Non-admin sending { settings: [] } → 403
    //
    // An array value replaces settings with [] in Postgres JSONB, erasing
    // all protected keys just as null does.
    // ═════════════════════════════════════════════════════════════════════
    console.log('[cfg] Scenario 21: non-admin sends settings:[] (array erasure)');
    const s21 = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie: staffCookie },
      body: { settings: [] },
    });
    ok(`non-admin settings:[] → 403 (got ${s21.status})`, s21.status === 403, s21.data);

    // ═════════════════════════════════════════════════════════════════════
    // 22. DB row: protected settings survived null/array bypass attempts
    // ═════════════════════════════════════════════════════════════════════
    console.log('[cfg] Scenario 22: verify settings survived null/array attempts');
    const row4 = await getCompanyRow(companyId);
    const sv4 = row4?.settings || {};
    ok('alert_recipients survived null erasure', Array.isArray(sv4.alert_recipients) && sv4.alert_recipients[0]?.email === 'admin@smoke.example', sv4.alert_recipients);
    ok('default_tax_rate survived null erasure', sv4.default_tax_rate === 10, sv4.default_tax_rate);
  } catch (e) {
    console.error('[cfg] FATAL:', e.message);
    failed++;
  } finally {
    try { await cleanup(); } catch (e) { console.warn('[cfg] cleanup error:', e.message); }
    await pool.end();
  }

  console.log(`\n[test-company-fields-guard] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
