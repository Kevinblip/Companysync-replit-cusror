#!/usr/bin/env node
/**
 * Portal Privacy Smoke Test
 * ─────────────────────────
 * Verifies that GET /api/public/portal never leaks records where is_public = false,
 * and that POST /api/public/portal/note saves homeowner notes with is_public = false.
 *
 * Usage:
 *   Full mode (requires DATABASE_URL + SESSION_SECRET):
 *     npm run test:portal-privacy
 *     node scripts/test-portal-privacy.cjs
 *
 *   Read-only mode (no DATABASE_URL or SESSION_SECRET needed):
 *     SMOKE_READ_ONLY=1 BASE_URL=https://your-app.example.com node scripts/test-portal-privacy.cjs
 *
 *   Read-only mode — post-deploy CI step:
 *     SMOKE_READ_ONLY=1 BASE_URL=$DEPLOY_URL node scripts/test-portal-privacy.cjs
 *     # Optionally add SMOKE_PORTAL_TOKEN to also probe the positive-path (200) and
 *     # response-shape (no projects.data leak) checks against a real long-lived token.
 *
 * Prerequisites (full mode only):
 *   - DATABASE_URL must point to a Postgres database with the correct schema already in place.
 *   - SESSION_SECRET must match the running server's session secret.
 *   - The application server must be running on PORT (default 5000).
 *
 * Read-only mode prerequisites:
 *   - BASE_URL must point to a reachable server (local or remote).
 *   - No database credentials required.
 *
 * The script creates isolated test fixtures, runs assertions, then cleans up even on failure.
 * It never modifies the schema — if required columns are absent it fails immediately.
 *
 * Production safety
 * ─────────────────
 * All fixture row IDs below are STABLE, clearly-marked "smoke_test_*" identifiers
 * (no timestamps, no randomness). The seed step uses idempotent upserts
 * (ON CONFLICT DO NOTHING) so repeated runs reuse the same long-lived rows
 * instead of inserting fresh ones. A pre-seed sweep removes any dynamically-
 * generated child rows (logs/photos created via the API in Tests C/E/F/G) that
 * may have been left behind by a previous crashed run. The result is that even
 * if this script crashes mid-run against the production database, no orphan
 * test data accumulates: the next run will deterministically reuse or sweep
 * the same identifiable rows. The "smoke_test_" prefix on every ID makes
 * stray rows trivially greppable should manual cleanup ever be required.
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

// BASE_URL can be overridden to target a remote server (e.g. production).
// If BASE_URL is set it takes precedence over PORT.
const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) { process.stdout.write(`[portal-privacy] ${msg}\n`); }
function pass(msg) { process.stdout.write(`  ✓  ${msg}\n`); }
function fail(msg) { process.stderr.write(`  ✗  ${msg}\n`); }

async function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    // Choose http or https based on the URL protocol so the test works against
    // both local dev servers (http://) and live production servers (https://).
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;
    const defaultPort = isHttps ? 443 : 80;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || defaultPort,
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    };
    const req = transport.request(reqOpts, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

/** Wait up to maxMs for the dev server to accept connections. */
async function waitForServer(maxMs = 30000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      await fetchJson(`${BASE_URL}/api/public/portal?token=probe_not_real`);
      return;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Server not reachable at ${BASE_URL} after ${maxMs}ms`);
}

/** Verify that all required columns exist before creating any test fixtures.
 *  Fails fast with a descriptive error rather than silently proceeding on a broken schema. */
async function assertSchemaReady(pool) {
  const required = [
    { table: 'customers',      column: 'portal_token' },
    { table: 'project_logs',   column: 'is_public' },
    { table: 'project_photos', column: 'is_public' },
    { table: 'projects',       column: 'project_type' },
    { table: 'projects',       column: 'current_milestone' },
  ];

  for (const { table, column } of required) {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      [table, column]
    );
    if (rows.length === 0) {
      throw new Error(
        `Schema preflight FAILED: column "${column}" is missing from table "${table}". ` +
        `Ensure the database schema is up to date before running this test.`
      );
    }
  }
  log('Schema preflight passed — all required columns exist.');

  // Verify that project_logs.is_public has DEFAULT false at the database level.
  // This guards against a future migration or schema change silently flipping the default
  // to true, which would expose internal admin notes through the public portal.
  const { rows: defaultRows } = await pool.query(
    `SELECT column_default FROM information_schema.columns
     WHERE table_name = 'project_logs' AND column_name = 'is_public'`,
  );
  if (defaultRows.length === 0) {
    throw new Error(
      `Schema preflight FAILED: could not read column_default for project_logs.is_public from information_schema.`
    );
  }
  const columnDefault = defaultRows[0].column_default;
  // Postgres stores boolean defaults as 'false' (the string).
  if (columnDefault !== 'false') {
    throw new Error(
      `Schema preflight FAILED: project_logs.is_public has DEFAULT "${columnDefault}" at the database level — ` +
      `expected "false". A raw INSERT omitting this column would expose internal notes publicly. ` +
      `Run a migration: ALTER TABLE project_logs ALTER COLUMN is_public SET DEFAULT false;`
    );
  }
  log('Schema preflight passed — project_logs.is_public DEFAULT is false at the database level.');

  // Verify that project_photos.is_public also has DEFAULT false at the database level.
  // Photos are surfaced on the public homeowner portal when is_public = true, so a
  // raw INSERT omitting this column must not silently expose photos publicly.
  const { rows: photoDefaultRows } = await pool.query(
    `SELECT column_default FROM information_schema.columns
     WHERE table_name = 'project_photos' AND column_name = 'is_public'`,
  );
  if (photoDefaultRows.length === 0) {
    throw new Error(
      `Schema preflight FAILED: could not read column_default for project_photos.is_public from information_schema.`
    );
  }
  const photoColumnDefault = photoDefaultRows[0].column_default;
  if (photoColumnDefault !== 'false') {
    throw new Error(
      `Schema preflight FAILED: project_photos.is_public has DEFAULT "${photoColumnDefault}" at the database level — ` +
      `expected "false". A raw INSERT omitting this column would expose photos publicly. ` +
      `Run a migration: ALTER TABLE project_photos ALTER COLUMN is_public SET DEFAULT false;`
    );
  }
  log('Schema preflight passed — project_photos.is_public DEFAULT is false at the database level.');
}

// ── Test runner ───────────────────────────────────────────────────────────────

const FAILURES = [];
const PASSES = [];

function assert(condition, label) {
  if (condition) {
    pass(label);
    PASSES.push(label);
  } else {
    fail(label);
    FAILURES.push(label);
  }
}

// ── Read-only main (no DB access) ─────────────────────────────────────────────

/**
 * Read-only smoke test — runs when SMOKE_READ_ONLY=1.
 *
 * Probes the live portal endpoints over HTTP only.  No database credentials,
 * no SESSION_SECRET, no fixture seeding or deletion.  Safe to run from any
 * environment that can reach BASE_URL (e.g. a post-deploy CI step that has
 * no access to production DB credentials).
 *
 * Tests always executed:
 *   D-ro: Invalid token → 404
 *   D-ro: Missing token → 400
 *
 * Optional (requires SMOKE_PORTAL_TOKEN env var set to a real long-lived token
 * that already exists in the target environment):
 *   A-ro: Known token → 200, success:true, no projects.data leak
 */
async function mainReadOnly() {
  log('Running in READ-ONLY mode (SMOKE_READ_ONLY=1).');
  log('DB writes and Tests B/C/E/F/G are skipped — no DATABASE_URL or SESSION_SECRET required.');

  log(`\nWaiting for server at ${BASE_URL}…`);
  await waitForServer(30000);
  log('Server is up.');

  // ── Test D-ro: Negative-path probes (no fixtures needed) ─────────────────
  log('\nTest D-ro: Invalid token → 404; missing token → 400');
  const { status: badStatus }     = await fetchJson(`${BASE_URL}/api/public/portal?token=completely_invalid_token_xyz`);
  const { status: noTokenStatus } = await fetchJson(`${BASE_URL}/api/public/portal`);
  assert(badStatus     === 404, `Invalid token  → HTTP 404 (got ${badStatus})`);
  assert(noTokenStatus === 400, `Missing token  → HTTP 400 (got ${noTokenStatus})`);

  // ── Test A-ro: Positive-path probe (optional — needs SMOKE_PORTAL_TOKEN) ──
  const SMOKE_PORTAL_TOKEN = process.env.SMOKE_PORTAL_TOKEN;
  if (SMOKE_PORTAL_TOKEN) {
    log('\nTest A-ro: Positive-path probe with SMOKE_PORTAL_TOKEN');
    const { status: getStatus, data: portalData } = await fetchJson(
      `${BASE_URL}/api/public/portal?token=${encodeURIComponent(SMOKE_PORTAL_TOKEN)}`
    );
    assert(getStatus === 200,          `Known token    → HTTP 200 (got ${getStatus})`);
    assert(portalData.success === true, 'Response has success:true');
    const hasRawData = (portalData.projects || []).some((p) => p.data !== undefined);
    assert(!hasRawData, 'projects.data (internal CRM blob) is NOT exposed in portal response');
  } else {
    log('\nSMOKE_PORTAL_TOKEN not set — skipping positive-path and response-shape probes.');
    log('Set SMOKE_PORTAL_TOKEN to a real long-lived portal token to enable these checks.');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('');
  log(`Results: ${PASSES.length} passed, ${FAILURES.length} failed`);
  if (FAILURES.length > 0) {
    console.error('\nFailed assertions:');
    FAILURES.forEach((f) => console.error(`  ✗  ${f}`));
    process.exit(1);
  } else {
    log('All read-only portal privacy checks passed ✓');
    process.exit(0);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Delegate to the lightweight read-only path when SMOKE_READ_ONLY=1.
  // This path needs no DATABASE_URL or SESSION_SECRET.
  if (process.env.SMOKE_READ_ONLY === '1') {
    return mainReadOnly();
  }

  log('Connecting to database…');
  const pool = createPool({ connectionString: process.env.DATABASE_URL });

  // STABLE fixture IDs — every run reuses the same long-lived "smoke_test_*" rows
  // via idempotent upserts. No timestamps, no randomness. This guarantees that even
  // if the script crashes against production, no orphan test data accumulates: the
  // next run reuses or sweeps the same identifiable rows. The shared prefix also
  // makes stray rows trivially greppable should manual cleanup ever be required.
  const COMPANY_ID      = 'smoke_test_privacy_co';
  const CUSTOMER_ID     = 'smoke_test_privacy_cust';
  const PORTAL_TOKEN    = 'smoke_test_portal_token';
  const PROJECT_ID      = 'smoke_test_privacy_proj';
  const LOG_PUB_ID      = 'smoke_test_plog_pub';
  const LOG_PRIV_ID     = 'smoke_test_plog_priv';
  const PHOTO_PUB_ID    = 'smoke_test_photo_pub';
  const PHOTO_PRIV_ID   = 'smoke_test_photo_priv';
  // Test E — admin log-toggle route fixtures (stable IDs + deterministic session UUID)
  const STAFF_USER_ID   = 'smoke_test_staff_user';
  const STAFF_EMAIL     = 'smoke_test_staff@test.invalid';
  const TEST_SESSION_ID = '00000000-0000-4000-8000-5e07e57e5700';
  // Test G — second customer for cross-customer isolation check
  const CUSTOMER_ID2    = 'smoke_test_privacy_cust2';
  const PORTAL_TOKEN2   = 'smoke_test_portal_token2';
  const PROJECT_ID2     = 'smoke_test_privacy_proj2';

  // Delete every smoke-test row by stable ID / project_id. Idempotent: safe to run
  // either as a pre-seed sweep (clearing leftovers from a previously-crashed run)
  // or as a post-test cleanup. Order matters: child rows before parents.
  // Returns a row-count summary so callers can log operational visibility.
  async function deleteAllFixtures() {
    const counts = {};
    const exec = async (label, sql, params) => {
      const res = await pool.query(sql, params);
      counts[label] = (counts[label] || 0) + (res.rowCount || 0);
    };
    // Dynamic API-created rows first (Tests C/E/F/G), keyed by project_id
    await exec('project_logs',   `DELETE FROM project_logs   WHERE project_id IN ($1,$2)`, [PROJECT_ID, PROJECT_ID2]);
    await exec('project_photos', `DELETE FROM project_photos WHERE project_id IN ($1,$2)`, [PROJECT_ID, PROJECT_ID2]);
    // Stable-ID seeded rows (covers any rows that escaped the project_id sweep, e.g. on a different project_id)
    await exec('project_logs',   `DELETE FROM project_logs   WHERE id IN ($1,$2)`, [LOG_PUB_ID, LOG_PRIV_ID]);
    await exec('project_photos', `DELETE FROM project_photos WHERE id IN ($1,$2)`, [PHOTO_PUB_ID, PHOTO_PRIV_ID]);
    // Parents
    await exec('projects',  `DELETE FROM projects  WHERE id IN ($1,$2)`, [PROJECT_ID, PROJECT_ID2]);
    await exec('customers', `DELETE FROM customers WHERE id IN ($1,$2)`, [CUSTOMER_ID, CUSTOMER_ID2]);
    await exec('companies', `DELETE FROM companies WHERE id = $1`,       [COMPANY_ID]);
    // Test E: injected session and test user
    await exec('sessions',  `DELETE FROM sessions WHERE sid = $1`,       [TEST_SESSION_ID]);
    await exec('users',     `DELETE FROM users    WHERE id  = $1`,       [STAFF_USER_ID]);
    return counts;
  }

  function formatCounts(counts) {
    const parts = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`);
    return parts.length ? parts.join(', ') : '<nothing to delete>';
  }

  // Presweep is fail-fast: if we cannot guarantee a clean slate, we must NOT proceed
  // to insert new fixtures, otherwise orphan rows could accumulate in production.
  async function presweep() {
    log('Pre-seed sweep — removing any leftover smoke-test fixtures from previous runs…');
    const counts = await deleteAllFixtures();
    log(`Pre-seed sweep complete (${formatCounts(counts)}).`);
  }

  // Cleanup is best-effort: by the time we reach it, the test outcome is already
  // determined. We log loudly so any failure is visible to the operator, but we
  // do not throw — that would mask the original test failure (if any).
  async function cleanup() {
    log('Cleaning up test fixtures…');
    try {
      const counts = await deleteAllFixtures();
      log(`Cleanup complete (${formatCounts(counts)}).`);
    } catch (e) {
      process.stderr.write(
        `[portal-privacy] Cleanup FAILED: ${e.message}\n` +
        `[portal-privacy] Smoke-test rows may remain in the database. ` +
        `The next run's pre-seed sweep will remove them. ` +
        `To purge manually now, delete every row whose id (or project_id) starts with "smoke_test_".\n`
      );
    }
    await pool.end();
  }

  try {
    // ── 0. Schema preflight — fail fast, never alter schema ───────────────
    await assertSchemaReady(pool);

    // ── 0b. Pre-seed sweep — clear leftovers from any previously-crashed run ─
    // Stable IDs + this sweep guarantee zero orphan accumulation in production
    // even if a prior run crashed before reaching the cleanup() in `finally`.
    await presweep();

    // ── 1. Seed test fixtures (DML only — no DDL) ─────────────────────────
    log('Seeding test fixtures…');

    await pool.query(
      `INSERT INTO companies (id, name, company_name, created_by, is_deleted, created_at, updated_at)
       VALUES ($1,'Privacy Test Co','Privacy Test Co','test@test.invalid',false,NOW(),NOW())
       ON CONFLICT (id) DO NOTHING`,
      [COMPANY_ID]
    );

    await pool.query(
      `INSERT INTO customers (id, company_id, name, portal_token, created_at, updated_at)
       VALUES ($1,$2,'Privacy Test Customer',$3,NOW(),NOW())
       ON CONFLICT (id) DO NOTHING`,
      [CUSTOMER_ID, COMPANY_ID, PORTAL_TOKEN]
    );

    await pool.query(
      `INSERT INTO projects (id, company_id, customer_id, customer_name, title, status, project_type, created_at, updated_at)
       VALUES ($1,$2,$3,'Privacy Test Customer','Privacy Test Project','active','standard',NOW(),NOW())
       ON CONFLICT (id) DO NOTHING`,
      [PROJECT_ID, COMPANY_ID, CUSTOMER_ID]
    );

    // One public + one private log
    await pool.query(
      `INSERT INTO project_logs (id, project_id, company_id, author_role, author_name, content_body, is_public, created_at)
       VALUES ($1,$2,$3,'staff','Test Staff','Public update — visible to homeowner',true,NOW())
       ON CONFLICT (id) DO NOTHING`,
      [LOG_PUB_ID, PROJECT_ID, COMPANY_ID]
    );
    await pool.query(
      `INSERT INTO project_logs (id, project_id, company_id, author_role, author_name, content_body, is_public, created_at)
       VALUES ($1,$2,$3,'staff','Test Staff','PRIVATE internal note — must NEVER appear in portal',false,NOW())
       ON CONFLICT (id) DO NOTHING`,
      [LOG_PRIV_ID, PROJECT_ID, COMPANY_ID]
    );

    // One public + one private photo
    await pool.query(
      `INSERT INTO project_photos (id, project_id, company_id, photo_url, caption, is_public, created_at)
       VALUES ($1,$2,$3,'https://example.com/pub.jpg','Public photo',true,NOW())
       ON CONFLICT (id) DO NOTHING`,
      [PHOTO_PUB_ID, PROJECT_ID, COMPANY_ID]
    );
    await pool.query(
      `INSERT INTO project_photos (id, project_id, company_id, photo_url, caption, is_public, created_at)
       VALUES ($1,$2,$3,'https://example.com/priv.jpg','PRIVATE photo — must NEVER appear in portal',false,NOW())
       ON CONFLICT (id) DO NOTHING`,
      [PHOTO_PRIV_ID, PROJECT_ID, COMPANY_ID]
    );

    // ── 2. Wait for server ─────────────────────────────────────────────────
    log(`Waiting for server at ${BASE_URL}…`);
    await waitForServer(30000);
    log('Server is up.');

    // ── Test A: GET /api/public/portal — privacy filter ────────────────────
    log('\nTest A: GET /api/public/portal — private records must not appear');
    const { status: getStatus, data: portalData } = await fetchJson(
      `${BASE_URL}/api/public/portal?token=${PORTAL_TOKEN}`
    );

    assert(getStatus === 200, `Response status is 200 (got ${getStatus})`);
    assert(portalData.success === true, 'Response has success:true');

    // Logs
    const logs = portalData.logs || [];
    const privateLogVisible = logs.some((l) => l.id === LOG_PRIV_ID || (l.content_body || '').includes('PRIVATE internal note'));
    const publicLogVisible  = logs.some((l) => l.id === LOG_PUB_ID);
    assert(!privateLogVisible, 'Private log (is_public=false) does NOT appear in portal response');
    assert(publicLogVisible,   'Public  log (is_public=true)  DOES appear in portal response');

    // Photos
    const photos = portalData.photos || [];
    const privatePhotoVisible = photos.some((p) => p.id === PHOTO_PRIV_ID || (p.caption || '').includes('PRIVATE photo'));
    const publicPhotoVisible  = photos.some((p) => p.id === PHOTO_PUB_ID);
    assert(!privatePhotoVisible, 'Private photo (is_public=false) does NOT appear in portal response');
    assert(publicPhotoVisible,   'Public  photo (is_public=true)  DOES appear in portal response');

    // Ensure raw `data` blob from projects table is not exposed
    const hasRawData = (portalData.projects || []).some((p) => p.data !== undefined);
    assert(!hasRawData, 'projects.data (internal CRM blob) is NOT exposed in portal response');

    // ── Test B: Toggle is_public — log appears then disappears ─────────────
    log('\nTest B(log): Toggle is_public on private log — appears then disappears');

    await pool.query(`UPDATE project_logs SET is_public = true  WHERE id = $1`, [LOG_PRIV_ID]);
    const { data: afterLogPublic } = await fetchJson(`${BASE_URL}/api/public/portal?token=${PORTAL_TOKEN}`);
    assert(
      (afterLogPublic.logs || []).some((l) => l.id === LOG_PRIV_ID),
      'After toggling log to is_public=true,  log now appears in portal'
    );

    await pool.query(`UPDATE project_logs SET is_public = false WHERE id = $1`, [LOG_PRIV_ID]);
    const { data: afterLogPrivate } = await fetchJson(`${BASE_URL}/api/public/portal?token=${PORTAL_TOKEN}`);
    assert(
      !(afterLogPrivate.logs || []).some((l) => l.id === LOG_PRIV_ID),
      'After toggling log back to is_public=false, log disappears from portal'
    );

    // ── Test B2: Toggle is_public — photo appears then disappears ───────────
    log('\nTest B(photo): Toggle is_public on private photo — appears then disappears');

    await pool.query(`UPDATE project_photos SET is_public = true  WHERE id = $1`, [PHOTO_PRIV_ID]);
    const { data: afterPhotoPublic } = await fetchJson(`${BASE_URL}/api/public/portal?token=${PORTAL_TOKEN}`);
    assert(
      (afterPhotoPublic.photos || []).some((p) => p.id === PHOTO_PRIV_ID),
      'After toggling photo to is_public=true,  photo now appears in portal'
    );

    await pool.query(`UPDATE project_photos SET is_public = false WHERE id = $1`, [PHOTO_PRIV_ID]);
    const { data: afterPhotoPrivate } = await fetchJson(`${BASE_URL}/api/public/portal?token=${PORTAL_TOKEN}`);
    assert(
      !(afterPhotoPrivate.photos || []).some((p) => p.id === PHOTO_PRIV_ID),
      'After toggling photo back to is_public=false, photo disappears from portal'
    );

    // ── Test C: POST /api/public/portal/note — homeowner notes are private ──
    log('\nTest C: POST /api/public/portal/note — homeowner note saved with is_public=false');
    const { status: noteStatus, data: noteData } = await fetchJson(
      `${BASE_URL}/api/public/portal/note`,
      {
        method: 'POST',
        body: {
          token: PORTAL_TOKEN,
          project_id: PROJECT_ID,
          content_body: 'Hello from homeowner — privacy test note',
        },
      }
    );

    assert(noteStatus === 200,              `POST /portal/note status is 200 (got ${noteStatus})`);
    assert(noteData.success === true,       'POST /portal/note returns success:true');
    assert(noteData.log !== undefined,      'POST /portal/note returns the inserted log object');
    assert(noteData.log?.is_public === false, 'Homeowner note has is_public=false in the response payload');

    // Confirm is_public=false in the DB
    const { rows: dbRows } = await pool.query(
      `SELECT is_public FROM project_logs WHERE project_id = $1 AND author_role = 'homeowner' AND content_body = $2 LIMIT 1`,
      [PROJECT_ID, 'Hello from homeowner — privacy test note']
    );
    assert(dbRows.length > 0,                'Homeowner note exists in the database');
    assert(dbRows[0]?.is_public === false,   'Homeowner note has is_public=false in the database');

    // Confirm the homeowner note does NOT appear in subsequent GET /portal
    const { data: afterNote } = await fetchJson(`${BASE_URL}/api/public/portal?token=${PORTAL_TOKEN}`);
    assert(
      !(afterNote.logs || []).some((l) => l.content_body === 'Hello from homeowner — privacy test note'),
      'Homeowner note does NOT appear in subsequent GET /portal (is_public=false)'
    );

    // ── Test D: Invalid / missing token ────────────────────────────────────
    log('\nTest D: Invalid token returns 404; missing token returns 400');
    const { status: badStatus }     = await fetchJson(`${BASE_URL}/api/public/portal?token=completely_invalid_token_xyz`);
    const { status: noTokenStatus } = await fetchJson(`${BASE_URL}/api/public/portal`);
    assert(badStatus     === 404, `Invalid token  → HTTP 404 (got ${badStatus})`);
    assert(noTokenStatus === 400, `Missing token  → HTTP 400 (got ${noTokenStatus})`);

    // ── Test E: POST /api/projects/:id/log — admin log-toggle privacy ───────
    log('\nTest E: POST /api/projects/:id/log — is_public toggle and safe default');

    const SESSION_SECRET = process.env.SESSION_SECRET;
    if (!SESSION_SECRET) {
      fail('SESSION_SECRET is not set — Test E requires it to forge a signed session cookie.');
      FAILURES.push('E0: SESSION_SECRET must be set for admin log-toggle privacy checks to run');
      throw new Error('SESSION_SECRET missing — cannot authenticate against admin log route. Set the env var and re-run.');
    } else {
      // Seed a super-admin user so authorization passes without a real company membership
      await pool.query(
        `INSERT INTO users (id, email, first_name, last_name, profile_image_url, platform_role, created_at, updated_at)
         VALUES ($1,$2,'Test','Staff',NULL,'super_admin',NOW(),NOW())
         ON CONFLICT (id) DO NOTHING`,
        [STAFF_USER_ID, STAFF_EMAIL]
      );

      // Create a signed session directly in the sessions table
      const sessionData = {
        cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' },
        passport: { user: { claims: { email: STAFF_EMAIL } } },
      };
      const sessionExpire = new Date(Date.now() + 3600000);
      await pool.query(
        `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (sid) DO UPDATE SET sess = $2::jsonb, expire = $3`,
        [TEST_SESSION_ID, JSON.stringify(sessionData), sessionExpire]
      );

      // Build the signed connect.sid cookie value
      const sig = crypto.createHmac('sha256', SESSION_SECRET).update(TEST_SESSION_ID).digest('base64').replace(/=+$/, '');
      const signedSid = encodeURIComponent(`s:${TEST_SESSION_ID}.${sig}`);
      const adminCookieHeader = `connect.sid=${signedSid}`;

      // ── E1: POST with is_public: false — entry must NOT appear in portal ──
      const { status: e1Status, data: e1Data } = await fetchJson(
        `${BASE_URL}/api/projects/${PROJECT_ID}/log`,
        { method: 'POST', body: { content_body: 'TEST-E private admin note', is_public: false }, headers: { Cookie: adminCookieHeader } }
      );
      assert(e1Status === 200,              `E1: POST with is_public:false returns HTTP 200 (got ${e1Status})`);
      assert(e1Data.success === true,       'E1: Response has success:true');
      assert(e1Data.log?.is_public === false, 'E1: Response payload has is_public:false');

      const { data: portalAfterE1 } = await fetchJson(`${BASE_URL}/api/public/portal?token=${PORTAL_TOKEN}`);
      const e1LogVisible = (portalAfterE1.logs || []).some((l) => l.id === e1Data.log?.id);
      assert(!e1LogVisible, 'E1: Log with is_public:false does NOT appear in portal');

      // Confirm is_public=false in DB
      const { rows: e1DbRows } = await pool.query(
        `SELECT is_public FROM project_logs WHERE id = $1 LIMIT 1`,
        [e1Data.log?.id]
      );
      assert(e1DbRows.length > 0,              'E1: Log entry exists in the database');
      assert(e1DbRows[0]?.is_public === false,  'E1: Database confirms is_public=false');

      // ── E2: POST with is_public: true — entry MUST appear in portal ───────
      const { status: e2Status, data: e2Data } = await fetchJson(
        `${BASE_URL}/api/projects/${PROJECT_ID}/log`,
        { method: 'POST', body: { content_body: 'TEST-E public admin note', is_public: true }, headers: { Cookie: adminCookieHeader } }
      );
      assert(e2Status === 200,              `E2: POST with is_public:true returns HTTP 200 (got ${e2Status})`);
      assert(e2Data.log?.is_public === true, 'E2: Response payload has is_public:true');

      const { data: portalAfterE2 } = await fetchJson(`${BASE_URL}/api/public/portal?token=${PORTAL_TOKEN}`);
      const e2LogVisible = (portalAfterE2.logs || []).some((l) => l.id === e2Data.log?.id);
      assert(e2LogVisible, 'E2: Log with is_public:true DOES appear in portal');

      const { rows: e2DbRows } = await pool.query(
        `SELECT is_public FROM project_logs WHERE id = $1 LIMIT 1`,
        [e2Data.log?.id]
      );
      assert(e2DbRows[0]?.is_public === true, 'E2: Database confirms is_public=true');

      // ── E3: POST with is_public omitted — must default to false (safe) ────
      const { status: e3Status, data: e3Data } = await fetchJson(
        `${BASE_URL}/api/projects/${PROJECT_ID}/log`,
        { method: 'POST', body: { content_body: 'TEST-E omitted is_public note' }, headers: { Cookie: adminCookieHeader } }
      );
      assert(e3Status === 200,               `E3: POST with is_public omitted returns HTTP 200 (got ${e3Status})`);
      assert(e3Data.log?.is_public === false, 'E3: Omitting is_public defaults to false in response (safe default)');

      const { data: portalAfterE3 } = await fetchJson(`${BASE_URL}/api/public/portal?token=${PORTAL_TOKEN}`);
      const e3LogVisible = (portalAfterE3.logs || []).some((l) => l.id === e3Data.log?.id);
      assert(!e3LogVisible, 'E3: Log with omitted is_public does NOT appear in portal (safe default)');

      const { rows: e3DbRows } = await pool.query(
        `SELECT is_public FROM project_logs WHERE id = $1 LIMIT 1`,
        [e3Data.log?.id]
      );
      assert(e3DbRows[0]?.is_public === false, 'E3: Database confirms is_public=false when field was omitted');

      // ── Test F: POST /api/projects/:id/photos and PATCH /api/projects/:id/photos/:photoId ──
      log('\nTest F: Photo upload and toggle admin routes — is_public privacy correctness');

      // ── F1: POST with is_public: false — photo must NOT appear in portal ──
      const { status: f1Status, data: f1Data } = await fetchJson(
        `${BASE_URL}/api/projects/${PROJECT_ID}/photos`,
        { method: 'POST', body: { photo_url: 'https://example.com/test-f1.jpg', caption: 'TEST-F private photo', is_public: false }, headers: { Cookie: adminCookieHeader } }
      );
      assert(f1Status === 200,          `F1: POST with is_public:false returns HTTP 200 (got ${f1Status})`);
      assert(f1Data.success === true,   'F1: Response has success:true');
      assert(typeof f1Data.id === 'string' && f1Data.id.length > 0, 'F1: Response includes the new photo id');

      const { data: portalAfterF1 } = await fetchJson(`${BASE_URL}/api/public/portal?token=${PORTAL_TOKEN}`);
      const f1PhotoVisible = (portalAfterF1.photos || []).some((p) => p.id === f1Data.id);
      assert(!f1PhotoVisible, 'F1: Photo with is_public:false does NOT appear in portal');

      const { rows: f1DbRows } = await pool.query(
        `SELECT is_public FROM project_photos WHERE id = $1 LIMIT 1`,
        [f1Data.id]
      );
      assert(f1DbRows.length > 0,            'F1: Photo entry exists in the database');
      assert(f1DbRows[0]?.is_public === false, 'F1: Database confirms is_public=false');

      // ── F2: POST with is_public: true — photo MUST appear in portal ───────
      const { status: f2Status, data: f2Data } = await fetchJson(
        `${BASE_URL}/api/projects/${PROJECT_ID}/photos`,
        { method: 'POST', body: { photo_url: 'https://example.com/test-f2.jpg', caption: 'TEST-F public photo', is_public: true }, headers: { Cookie: adminCookieHeader } }
      );
      assert(f2Status === 200,          `F2: POST with is_public:true returns HTTP 200 (got ${f2Status})`);
      assert(f2Data.success === true,   'F2: Response has success:true');

      const { data: portalAfterF2 } = await fetchJson(`${BASE_URL}/api/public/portal?token=${PORTAL_TOKEN}`);
      const f2PhotoVisible = (portalAfterF2.photos || []).some((p) => p.id === f2Data.id);
      assert(f2PhotoVisible, 'F2: Photo with is_public:true DOES appear in portal');

      const { rows: f2DbRows } = await pool.query(
        `SELECT is_public FROM project_photos WHERE id = $1 LIMIT 1`,
        [f2Data.id]
      );
      assert(f2DbRows[0]?.is_public === true, 'F2: Database confirms is_public=true');

      // ── F3: PATCH is_public from true → false — photo disappears from portal ─
      const { status: f3Status, data: f3Data } = await fetchJson(
        `${BASE_URL}/api/projects/${PROJECT_ID}/photos/${f2Data.id}`,
        { method: 'PATCH', body: { is_public: false }, headers: { Cookie: adminCookieHeader } }
      );
      assert(f3Status === 200,        `F3: PATCH is_public:false returns HTTP 200 (got ${f3Status})`);
      assert(f3Data.success === true, 'F3: PATCH response has success:true');

      const { data: portalAfterF3 } = await fetchJson(`${BASE_URL}/api/public/portal?token=${PORTAL_TOKEN}`);
      const f3PhotoStillVisible = (portalAfterF3.photos || []).some((p) => p.id === f2Data.id);
      assert(!f3PhotoStillVisible, 'F3: After PATCH to is_public:false, photo disappears from portal');

      const { rows: f3DbRows } = await pool.query(
        `SELECT is_public FROM project_photos WHERE id = $1 LIMIT 1`,
        [f2Data.id]
      );
      assert(f3DbRows[0]?.is_public === false, 'F3: Database confirms is_public=false after PATCH');

      // ── F4: POST with is_public omitted — must default to false (safe) ────
      const { status: f4Status, data: f4Data } = await fetchJson(
        `${BASE_URL}/api/projects/${PROJECT_ID}/photos`,
        { method: 'POST', body: { photo_url: 'https://example.com/test-f4.jpg', caption: 'TEST-F omitted is_public photo' }, headers: { Cookie: adminCookieHeader } }
      );
      assert(f4Status === 200,        `F4: POST with is_public omitted returns HTTP 200 (got ${f4Status})`);
      assert(f4Data.success === true, 'F4: Response has success:true');

      const { data: portalAfterF4 } = await fetchJson(`${BASE_URL}/api/public/portal?token=${PORTAL_TOKEN}`);
      const f4PhotoVisible = (portalAfterF4.photos || []).some((p) => p.id === f4Data.id);
      assert(!f4PhotoVisible, 'F4: Photo with omitted is_public does NOT appear in portal (safe default)');

      const { rows: f4DbRows } = await pool.query(
        `SELECT is_public FROM project_photos WHERE id = $1 LIMIT 1`,
        [f4Data.id]
      );
      assert(f4DbRows[0]?.is_public === false, 'F4: Database confirms is_public=false when field was omitted');
    }

    // ── Test G: POST /api/public/portal/photo — homeowner upload is private ──
    log('\nTest G: POST /api/public/portal/photo — homeowner upload stored with is_public=false');

    // Seed a second customer + project in the same company for cross-customer isolation check
    await pool.query(
      `INSERT INTO customers (id, company_id, name, portal_token, created_at, updated_at)
       VALUES ($1,$2,'Privacy Test Customer 2',$3,NOW(),NOW())
       ON CONFLICT (id) DO NOTHING`,
      [CUSTOMER_ID2, COMPANY_ID, PORTAL_TOKEN2]
    );
    await pool.query(
      `INSERT INTO projects (id, company_id, customer_id, customer_name, title, status, project_type, created_at, updated_at)
       VALUES ($1,$2,$3,'Privacy Test Customer 2','Privacy Test Project 2','active','standard',NOW(),NOW())
       ON CONFLICT (id) DO NOTHING`,
      [PROJECT_ID2, COMPANY_ID, CUSTOMER_ID2]
    );

    // A minimal 1×1 transparent PNG in base64 — smallest valid image for the route
    const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const { status: g1Status, data: g1Data } = await fetchJson(
      `${BASE_URL}/api/public/portal/photo`,
      {
        method: 'POST',
        body: {
          token: PORTAL_TOKEN,
          project_id: PROJECT_ID,
          caption: 'TEST-G homeowner upload privacy check',
          photo_base64: TINY_PNG_B64,
          mime_type: 'image/png',
        },
      }
    );
    assert(g1Status === 200,                                   `G1: POST /portal/photo returns HTTP 200 (got ${g1Status})`);
    assert(g1Data.success === true,                            'G1: Response has success:true');
    assert(typeof g1Data.id === 'string' && g1Data.id.length > 0, 'G1: Response includes photo id');

    // DB confirms is_public=false and uploaded_by identifies the homeowner
    const { rows: g1DbRows } = await pool.query(
      `SELECT is_public, uploaded_by FROM project_photos WHERE id = $1 LIMIT 1`,
      [g1Data.id]
    );
    assert(g1DbRows.length > 0,                 'G2: Photo row exists in the database');
    assert(g1DbRows[0]?.is_public === false,    'G3: DB confirms is_public=false for homeowner upload');
    assert(
      (g1DbRows[0]?.uploaded_by || '').startsWith('homeowner:'),
      `G4: DB confirms uploaded_by starts with "homeowner:" (got "${g1DbRows[0]?.uploaded_by}")`
    );

    // Photo appears in the uploading homeowner's own portal (uploaded_by filter)
    const { data: portalAfterG } = await fetchJson(`${BASE_URL}/api/public/portal?token=${PORTAL_TOKEN}`);
    const gPhotoVisibleToOwner = (portalAfterG.photos || []).some((p) => p.id === g1Data.id);
    assert(gPhotoVisibleToOwner, 'G5: Homeowner upload appears in the uploading customer\'s own portal (uploaded_by filter)');

    // Photo does NOT appear in a different customer's portal (cross-customer isolation)
    const { data: portalCustomer2 } = await fetchJson(`${BASE_URL}/api/public/portal?token=${PORTAL_TOKEN2}`);
    const gPhotoVisibleToOther = (portalCustomer2.photos || []).some((p) => p.id === g1Data.id);
    assert(!gPhotoVisibleToOther, 'G6: Homeowner upload does NOT appear in a different customer\'s portal');

  } finally {
    await cleanup();
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('');
  log(`Results: ${PASSES.length} passed, ${FAILURES.length} failed`);
  if (FAILURES.length > 0) {
    console.error('\nFailed assertions:');
    FAILURES.forEach((f) => console.error(`  ✗  ${f}`));
    process.exit(1);
  } else {
    log('All portal privacy checks passed ✓');
    process.exit(0);
  }
}

main().catch((err) => {
  process.stderr.write(`[portal-privacy] Fatal error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
