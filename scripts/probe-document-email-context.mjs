/**
 * Behavioral probe: do the GENERATED estimate/invoice email flows attribute the
 * send to the document's owning company and the acting user?
 *
 * These are the flows customers actually use. The raw-HTML passthrough branch
 * carried the resolved context, but the generated branch dropped it, so those
 * sends fell into the default platform rate bucket with no actor identity and
 * persisted unattributed delivery events — a company could evade its per-company
 * cap through the main path.
 *
 * Run as a child process by scripts/test-email-provider-health.cjs: it captures
 * the real transport options, so it needs the plugin's own module instances
 * rather than the parent suite's mocked ones. Prints a single JSON line.
 *
 * The transport is stubbed, so no mail is ever sent.
 */

import crypto from 'crypto';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const out = { ok: false };

function signSessionId(sid, secret) {
  const sig = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return 's:' + sid + '.' + sig;
}

const suffix = crypto.randomUUID().slice(0, 8);
const ids = {
  company: `probe-co-${suffix}`,
  otherCompany: `probe-other-co-${suffix}`,
  staff: `probe-staff-${suffix}`,
  estimate: `probe-est-${suffix}`,
  invoice: `probe-inv-${suffix}`,
  foreignEstimate: `probe-foreign-est-${suffix}`,
  foreignInvoice: `probe-foreign-inv-${suffix}`,
  session: `probe-sess-${suffix}`,
};
const actorEmail = `probe-actor-${suffix}@companysync.io`;
// Reserved test recipient: even if the transport stub failed, this cannot deliver.
const recipient = `qa-doc-context-${suffix}@companysync.io`;

const { createPool, adoptPool } = nodeRequire('./lib/db-pool.cjs');
const pool = createPool({ connectionString: process.env.DATABASE_URL });
// Exercising the production handlers below opens a second pool inside the
// production db module. Adopt it now, before it has connected, so its sessions
// carry the script timeouts and are torn down if this probe is interrupted.
adoptPool(nodeRequire('../db/prod-db.cjs').getPool());

async function seed() {
  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [ids.company, 'Probe Roofing Co']);
  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [ids.otherCompany, 'Someone Elses Company']);
  await pool.query(
    `INSERT INTO staff_profiles (id, company_id, name, email, user_email, is_active) VALUES ($1, $2, $3, $4, $4, true)`,
    [ids.staff, ids.company, 'Probe Actor', actorEmail],
  );
  await pool.query(
    `INSERT INTO estimates (id, company_id, customer_name, customer_email, estimate_number, total_amount)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ids.estimate, ids.company, 'Probe Customer', recipient, 'EST-PROBE-1', 1234.56],
  );
  await pool.query(
    `INSERT INTO invoices (id, company_id, customer_name, customer_email, invoice_number, total_amount)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ids.invoice, ids.company, 'Probe Customer', recipient, 'INV-PROBE-1', 1234.56],
  );
  // Documents owned by a company the caller is NOT a member of.
  await pool.query(
    `INSERT INTO estimates (id, company_id, customer_name, customer_email, estimate_number, total_amount)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ids.foreignEstimate, ids.otherCompany, 'Not Your Customer', recipient, 'EST-FOREIGN-1', 9999.99],
  );
  await pool.query(
    `INSERT INTO invoices (id, company_id, customer_name, customer_email, invoice_number, total_amount)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ids.foreignInvoice, ids.otherCompany, 'Not Your Customer', recipient, 'INV-FOREIGN-1', 9999.99],
  );
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, NOW() + interval '1 hour')`,
    [ids.session, JSON.stringify({ passport: { user: { claims: { email: actorEmail } } } })],
  );
}

async function cleanup() {
  const statements = [
    [`DELETE FROM sessions WHERE sid = $1`, [ids.session]],
    [`DELETE FROM estimates WHERE id = ANY($1)`, [[ids.estimate, ids.foreignEstimate]]],
    [`DELETE FROM invoices WHERE id = ANY($1)`, [[ids.invoice, ids.foreignInvoice]]],
    [`DELETE FROM staff_profiles WHERE id = $1`, [ids.staff]],
    [`DELETE FROM companies WHERE id = ANY($1)`, [[ids.company, ids.otherCompany]]],
    [`DELETE FROM generic_entities WHERE entity_type = 'EmailDeliveryEvent' AND company_id = ANY($1)`, [[ids.company, ids.otherCompany]]],
  ];
  for (const [sql, args] of statements) {
    try { await pool.query(sql, args); } catch (e) { out.cleanupWarning = e.message; }
  }
}

const step = (label) => { if (process.env.PROBE_VERBOSE) process.stderr.write(`[probe] ${label}\n`); };

try {
  step('seeding');
  await seed();
  step('seeded');

  // Capture what the guarded transport actually receives.
  const transport = nodeRequire('../lib/emailTransport.cjs');
  const captured = [];
  transport.sendPlatformEmail = async (options) => {
    captured.push(options);
    return { success: true, id: 'captured-by-probe', provider: 'probe' };
  };

  step('importing plugin');
  const { functionHandlers, getFunctionsPool } = await import('../vite-functions-plugin.js');
  // The plugin keeps its own pool for document authorization queries. Adopt it
  // before any handler runs so those sessions are guarded and torn down too.
  adoptPool(getFunctionsPool());
  step('plugin imported');
  const req = { headers: { cookie: `connect.sid=${encodeURIComponent(signSessionId(ids.session, process.env.SESSION_SECRET))}` } };

  const run = async (handler, params) => {
    captured.length = 0;
    try {
      await handler(params, null, req);
    } catch (e) {
      return { error: e.message };
    }
    const options = captured[0];
    if (!options) return { error: 'transport was never called' };
    return { context: options.context || null, to: options.to };
  };

  // Convention A (generated from the stored document) is the primary flow.
  // A hostile company id is supplied in the body: the resolved owner must win.
  out.estimate = await run(functionHandlers.sendEstimateEmail, {
    estimateId: ids.estimate,
    companyId: ids.otherCompany,
  });
  out.invoice = await run(functionHandlers.sendInvoiceEmail, {
    invoiceId: ids.invoice,
    companyId: ids.otherCompany,
  });
  // Server-side and service-role callers spell these snake_case. If only the
  // camelCase spelling resolves an owner, those calls skip owner resolution and
  // fall through to the caller-supplied company id — silently, and in the wrong
  // direction for a guard. No company id is supplied here at all, so the send
  // can only succeed if the owner was resolved from the document itself.
  out.estimateSnake = await run(functionHandlers.sendEstimateEmail, { estimate_id: ids.estimate });
  out.invoiceSnake = await run(functionHandlers.sendInvoiceEmail, { invoice_id: ids.invoice });

  out.expected = { companyId: ids.company, actorEmail, rejectedCompanyId: ids.otherCompany };

  // ── Production dispatcher ────────────────────────────────────────────────
  // Production authorizes at its own route, separately from dev, so the dev
  // results above say nothing about it. The attack: authorize against a company
  // the caller really belongs to, while naming a document owned by someone else
  // in a spelling the guard does not read. If the guard and the sender resolve
  // the id differently, authorization passes for one company and the send uses
  // the other's document, branding and recipient.
  const prod = nodeRequire('../db/prod-integrations.cjs');
  const { Readable } = nodeRequire('stream');
  const mockReq = (body) => Object.assign(Readable.from([JSON.stringify(body)]), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: req.headers.cookie },
  });
  const mockRes = () => {
    const captured = { status: 200, body: null };
    return {
      captured,
      setHeader() {},
      writeHead(status) { captured.status = status; return this; },
      end(payload) { try { captured.body = JSON.parse(payload); } catch { captured.body = payload; } },
    };
  };
  const invokeProd = async (functionName, params) => {
    captured.length = 0;
    const res = mockRes();
    try {
      await prod.handleFunctionInvoke(mockReq({ functionName, params }), res);
    } catch (e) {
      return { threw: e.message, sends: captured.length };
    }
    return { status: res.captured.status, body: res.captured.body, sends: captured.length };
  };

  out.prodForeignEstimate = await invokeProd('sendEstimateEmail', {
    estimate_id: ids.foreignEstimate,
    companyId: ids.company,
  });
  out.prodForeignInvoice = await invokeProd('sendInvoiceEmail', {
    invoice_id: ids.foreignInvoice,
    companyId: ids.company,
  });
  // The caller's OWN document, snake_case, must still work in production.
  out.prodOwnEstimate = await invokeProd('sendEstimateEmail', { estimate_id: ids.estimate });

  // Staff compose accepts caller-authored content, but session-derived identity
  // must override all caller-provided company/sender fields.
  captured.length = 0;
  const genericRes = mockRes();
  await prod.handleSendEmail(mockReq({
    to: recipient, subject: 'probe', body: 'probe',
    companyId: ids.otherCompany, from: 'Attacker <attacker@example.net>',
  }), genericRes);
  out.prodGenericSend = {
    status: genericRes.captured.status,
    body: genericRes.captured.body,
    context: captured[0]?.context || null,
    from: captured[0]?.from || null,
  };

  out.ok = true;
} catch (error) {
  out.error = error.message;
}

// Emit the result BEFORE teardown. Exercising the production handlers opens a
// second connection pool, and a stuck cleanup must not swallow the findings.
console.log('PROBE_RESULT ' + JSON.stringify(out));

const withTimeout = (p, ms) => Promise.race([
  Promise.resolve(p).catch(() => {}),
  new Promise((resolve) => setTimeout(resolve, ms)),
]);
await withTimeout(cleanup(), 15000);
await withTimeout(pool.end(), 5000);
// Terminating pools left open by the production module, so a probe run cannot
// leak backends that later block startup's index creation.
try {
  await withTimeout(nodeRequire('../db/prod-db.cjs').getPool().end(), 5000);
} catch { /* pool may never have been created */ }
process.exit(0);
