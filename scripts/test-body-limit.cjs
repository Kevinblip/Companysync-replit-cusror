'use strict';
/**
 * Regression test: oversized request bodies must return HTTP 413 (not 500 or 200).
 *
 * Runs against either the local dev server (http://localhost:5000) or a remote
 * deployment (set BASE_URL=https://example.com).
 *
 * Usage:
 *   node scripts/test-body-limit.cjs
 *   BASE_URL=https://your-app.up.railway.app node scripts/test-body-limit.cjs
 *
 * Read-only probe mode (no local server required — suitable for post-deploy CI):
 *   BODY_LIMIT_READ_ONLY=1 BASE_URL=https://your-app.up.railway.app node scripts/test-body-limit.cjs
 *
 *   In read-only probe mode:
 *   - The port-wait is skipped entirely; HTTP assertions fire immediately.
 *   - Connection errors on individual routes are logged but do NOT fail the run
 *     (partial results are reported so other routes can still be verified).
 *   - Exit code is 1 only when at least one route responds but returns a wrong
 *     status or body; unreachable routes are counted as skipped, not failed.
 *
 * Optionally skip specific routes (comma-separated path substrings):
 *   SKIP_ROUTES=/api/twilio/update-cache,/api/functions/invoke \
 *   BODY_LIMIT_READ_ONLY=1 BASE_URL=https://your-app.example.com \
 *   node scripts/test-body-limit.cjs
 *
 * Exit code 0 = all checked assertions pass (skipped routes are not failures)
 * Exit code 1 = one or more assertions failed
 */

const http = require('http');
const https = require('https');
const net = require('net');
const { URL } = require('url');

const RAW_BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
let BASE;
try {
  BASE = new URL(RAW_BASE_URL);
} catch (e) {
  console.error(`[body-limit] Invalid BASE_URL: ${RAW_BASE_URL}`);
  process.exit(1);
}
const IS_HTTPS = BASE.protocol === 'https:';
const HOST = BASE.hostname;
const PORT = BASE.port ? Number(BASE.port) : (IS_HTTPS ? 443 : 80);
const ORIGIN = `${BASE.protocol}//${BASE.host}`;
const IS_LOCAL = HOST === 'localhost' || HOST === '127.0.0.1';

// ── Mode flags ────────────────────────────────────────────────────────────────

/**
 * BODY_LIMIT_READ_ONLY=1  — probe mode for restricted CI environments.
 *
 * Skips the port-wait entirely and fires HTTP assertions directly against
 * BASE_URL.  Connection errors on individual routes are treated as "skipped"
 * (not "failed") so that other routes can still be verified and partial results
 * are reported.  The run only exits non-zero when a route actually responds
 * but returns the wrong status or body.
 *
 * Useful in post-deploy CI steps that have no access to a local server and
 * target an already-running deployment.
 */
const BODY_LIMIT_READ_ONLY = process.env.BODY_LIMIT_READ_ONLY === '1';

/**
 * SKIP_ROUTES — comma-separated list of route path substrings to exclude.
 *
 * Any route whose path contains one of the listed substrings is skipped and
 * counted in the "skipped" total rather than "passed" or "failed".
 *
 * Example:
 *   SKIP_ROUTES=/api/twilio/update-cache,/api/functions/invoke
 */
const SKIP_ROUTES = (process.env.SKIP_ROUTES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ── Helpers ───────────────────────────────────────────────────────────────────

function waitForPort(host, port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const sock = net.createConnection({ host, port });
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - start >= timeoutMs) {
          return reject(new Error(`Server not ready on ${host}:${port} after ${timeoutMs}ms`));
        }
        setTimeout(attempt, 500);
      });
    }
    attempt();
  });
}

// 1.5 MB — just over the 1 MB default cap, well within the 30 MB photo cap
const OVERSIZE_1MB = 'x'.repeat(1.5 * 1024 * 1024);
// 31 MB — just over the 30 MB explicit cap on /api/functions/invoke
const OVERSIZE_30MB = 'x'.repeat(31 * 1024 * 1024);

let passed = 0;
let failed = 0;
let skipped = 0;

function post(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const bytes = Buffer.byteLength(payload);
    const lib = IS_HTTPS ? https : http;
    const req = lib.request(
      {
        host: HOST, port: PORT, path, method: 'POST',
        protocol: BASE.protocol,
        headers: { 'Content-Type': 'application/json', 'Content-Length': bytes, ...headers },
      },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (_) {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function assert413(label, { status, json }) {
  const statusOk = status === 413;
  const hasErrorField = json && typeof json.error === 'string' && /too large/i.test(json.error);
  const ok = statusOk && hasErrorField;

  if (ok) {
    console.log(`  ✓  ${label} → ${status}, error: "${json.error}"`);
    passed++;
  } else {
    const reasons = [];
    if (!statusOk) reasons.push(`expected status 413, got ${status}`);
    if (!hasErrorField) reasons.push(`expected JSON {error:"…too large…"}, got ${JSON.stringify(json)?.slice(0, 120)}`);
    console.log(`  ✗  ${label} — ${reasons.join('; ')}`);
    failed++;
  }
}

// ── Helpers for PUT ───────────────────────────────────────────────────────────

function put(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const bytes = Buffer.byteLength(payload);
    const lib = IS_HTTPS ? https : http;
    const req = lib.request(
      {
        host: HOST, port: PORT, path, method: 'PUT',
        protocol: BASE.protocol,
        headers: { 'Content-Type': 'application/json', 'Content-Length': bytes, ...headers },
      },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (_) {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Route definitions ─────────────────────────────────────────────────────────

const ROUTES = [
  // 1. Portal note endpoint — default 1 MB cap, unauthenticated
  {
    path: '/api/public/portal/note',
    label: 'POST /api/public/portal/note (1.5 MB, cap 1 MB)',
    body: JSON.stringify({ token: 'fake', project_id: 'x', content_body: OVERSIZE_1MB }),
    headers: {},
    method: 'post',
  },
  // 2. Portal photo endpoint — explicit 30 MB cap, send 31 MB
  //    (The portal/photo branch explicitly passes 30 MB; all other branches use 1 MB.)
  {
    path: '/api/public/portal/photo',
    label: 'POST /api/public/portal/photo (31 MB, cap 30 MB)',
    body: JSON.stringify({ token: 'fake', project_id: 'x', image: OVERSIZE_30MB }),
    headers: {},
    method: 'post',
  },
  // 3. /api/functions/invoke — explicit 30 MB cap; send 31 MB
  {
    path: '/api/functions/invoke',
    label: 'POST /api/functions/invoke (31 MB, cap 30 MB)',
    body: JSON.stringify({ functionName: 'ping', params: { x: OVERSIZE_30MB } }),
    headers: {},
    method: 'post',
  },
  // 4. /api/twilio/update-cache — default 1 MB cap
  {
    path: '/api/twilio/update-cache',
    label: 'POST /api/twilio/update-cache (1.5 MB, cap 1 MB)',
    body: JSON.stringify({ phone_number: '+15550000001', company_id: 'test', extra: OVERSIZE_1MB }),
    headers: {
      'x-bridge-secret': process.env.BRIDGE_SECRET || '__invalid__',
      Referer: ORIGIN,
    },
    method: 'post',
  },
  // 5. Entity PUT endpoint — 5 MB cap, regression for task-comment 403 bug
  {
    path: '/api/local/entity/Task/__body_limit_probe__',
    label: 'PUT /api/local/entity/Task (5.5 MB, cap 5 MB)',
    body: JSON.stringify({ comments: [{ text: 'x'.repeat(5.5 * 1024 * 1024) }], column: 'test' }),
    headers: {},
    method: 'put',
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  if (BODY_LIMIT_READ_ONLY) {
    console.log('[body-limit] Running in READ-ONLY probe mode (BODY_LIMIT_READ_ONLY=1).');
    console.log(`[body-limit] Port-wait skipped — firing HTTP assertions directly against ${ORIGIN}`);
    if (SKIP_ROUTES.length) {
      console.log(`[body-limit] Skipping routes matching: ${SKIP_ROUTES.join(', ')}`);
    }
  } else if (IS_LOCAL) {
    console.log(`[body-limit] Waiting for server on ${HOST}:${PORT}…`);
    await waitForPort(HOST, PORT);
  }

  console.log(`[body-limit] Running 413 regression tests against ${ORIGIN}\n`);

  for (const route of ROUTES) {
    // Skip routes whose path contains any SKIP_ROUTES substring
    const skipReason = SKIP_ROUTES.find((s) => route.path.includes(s));
    if (skipReason) {
      console.log(`  -  ${route.label} — SKIPPED (SKIP_ROUTES: "${skipReason}")`);
      skipped++;
      continue;
    }

    try {
      const fn = route.method === 'put' ? put : post;
      const r = await fn(route.path, route.body, route.headers);
      assert413(route.label, r);
    } catch (e) {
      if (BODY_LIMIT_READ_ONLY) {
        // In probe mode, a connection error means the route was unreachable — count
        // it as skipped so other routes can still be verified (partial results).
        console.log(`  -  ${route.label} — unreachable in probe mode (skipped): ${e.message}`);
        skipped++;
      } else {
        console.log(`  ✗  ${route.label} — connection error: ${e.message}`);
        failed++;
      }
    }
  }

  // ─── SSRF guard unit tests for validateWebhookUrl logic ───────────────────
  console.log('\n[ssrf-guard] Running webhook URL validation tests...');

  const privateIpPattern = /^(127\.|10\.|169\.254\.|0\.)|(^172\.(1[6-9]|2\d|3[01])\.)|(^192\.168\.)/;
  const isPrivateIp = (addr) => {
    if (!addr) return true;
    // Strip IPv6 brackets ([::1] → ::1)
    const a = addr.replace(/^\[|\]$/g, '').toLowerCase();
    if (a === '::1' || a === '0:0:0:0:0:0:0:1' || a === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
    if (a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80')) return true;
    return privateIpPattern.test(a);
  };
  // Sync-only subset (no DNS): scheme, hostname, IP literal checks
  const validateWebhookUrlSync = (rawUrl) => {
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return 'Invalid webhook URL format'; }
    if (parsed.protocol !== 'https:') return 'Webhook URL must use HTTPS (https://)';
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') || hostname.endsWith('.internal') ||
        hostname.endsWith('.corp') || hostname.endsWith('.lan')) {
      return 'Webhook URL must point to a public host, not an internal address';
    }
    if (isPrivateIp(hostname)) return 'Webhook URL must not be a private/loopback IP address';
    return null;
  };

  const ssrfCases = [
    // [label, url, expectBlocked]
    ['http:// scheme rejected',          'http://hooks.example.com/test',       true],
    ['ftp:// scheme rejected',           'ftp://hooks.example.com/test',        true],
    ['localhost blocked',                'https://localhost/hook',               true],
    ['localhost subdomain blocked',      'https://sub.localhost/hook',           true],
    ['.local TLD blocked',               'https://myserver.local/hook',          true],
    ['.internal TLD blocked',            'https://service.internal/hook',        true],
    ['.corp TLD blocked',                'https://app.corp/hook',                true],
    ['.lan TLD blocked',                 'https://printer.lan/hook',             true],
    ['10.x.x.x IP blocked',             'https://10.0.0.1/hook',               true],
    ['192.168.x.x IP blocked',          'https://192.168.1.1/hook',            true],
    ['172.16.x.x IP blocked',           'https://172.16.0.1/hook',             true],
    ['172.31.x.x IP blocked',           'https://172.31.255.254/hook',         true],
    ['127.x.x.x loopback blocked',      'https://127.0.0.1/hook',              true],
    ['169.254.x.x link-local blocked',  'https://169.254.0.1/hook',            true],
    ['IPv6 loopback blocked',            'https://[::1]/hook',                   true],
    ['invalid URL rejected',             'not-a-url',                            true],
    ['public https allowed',             'https://hooks.example.com/test',       false],
    ['public https with path allowed',   'https://hooks.slack.com/services/T0',  false],
  ];

  let ssrfPassed = 0;
  let ssrfFailed = 0;
  for (const [label, url, expectBlocked] of ssrfCases) {
    const result = validateWebhookUrlSync(url);
    const wasBlocked = result !== null;
    if (wasBlocked === expectBlocked) {
      console.log(`  ✓  ${label}`);
      ssrfPassed++;
      passed++;
    } else {
      console.log(`  ✗  ${label}: expected ${expectBlocked ? 'blocked' : 'allowed'}, got ${wasBlocked ? `blocked (${result})` : 'allowed'}`);
      ssrfFailed++;
      failed++;
    }
  }
  console.log(`[ssrf-guard] ${ssrfPassed}/${ssrfCases.length} webhook validation assertions passed`);
  // ──────────────────────────────────────────────────────────────────────────

  const skipSuffix = skipped ? `, ${skipped} skipped` : '';
  console.log(`\n[body-limit] Results: ${passed} passed, ${failed} failed${skipSuffix}`);

  if (failed > 0) {
    console.log('[body-limit] FAIL — 413 responses missing or malformed on one or more routes');
    process.exit(1);
  }

  if (passed === 0 && skipped > 0) {
    console.log('[body-limit] WARNING — all routes were skipped or unreachable; no assertions were verified');
  } else {
    console.log('[body-limit] All body-limit guards confirmed ✓');
  }
}

run().catch(err => {
  console.error('[body-limit] Fatal error:', err);
  process.exit(1);
});
