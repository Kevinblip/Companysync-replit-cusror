/* Generates the pre-launch audit report PDF (exports/CompanySync-PreLaunch-Audit-2026-07-22.pdf) */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'exports', 'CompanySync-PreLaunch-Audit-2026-07-22.pdf');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 54, left: 54, right: 54 } });
doc.pipe(fs.createWriteStream(OUT));

const COLORS = {
  navy: '#1e3a5f', text: '#222222', gray: '#666666', light: '#999999',
  urgent: '#c0392b', high: '#d35400', medium: '#b7950b', low: '#7f8c8d', good: '#1e8449',
  band: '#f2f4f7',
};

function hr(color = '#dddddd') {
  doc.moveDown(0.3);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(color).lineWidth(1).stroke();
  doc.moveDown(0.5);
}

function ensureSpace(px) {
  if (doc.y + px > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function sectionHeader(label, color) {
  ensureSpace(90);
  doc.moveDown(0.6);
  const y = doc.y;
  doc.rect(doc.page.margins.left, y, doc.page.width - doc.page.margins.left - doc.page.margins.right, 26).fill(color);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(13).text(label, doc.page.margins.left + 10, y + 7);
  doc.y = y + 34;
  doc.x = doc.page.margins.left;
  doc.fillColor(COLORS.text);
}

function item(n, title, body, effort) {
  ensureSpace(80);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.navy).text(`${n}. ${title}`, { continued: false });
  doc.moveDown(0.15);
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text).text(body, { lineGap: 2 });
  if (effort) {
    doc.moveDown(0.1);
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(COLORS.gray).text(`Estimated effort: ${effort}`);
  }
  doc.moveDown(0.55);
}

function bullet(text, color = COLORS.text) {
  ensureSpace(40);
  doc.font('Helvetica').fontSize(10).fillColor(color).text(`\u2022  ${text}`, { indent: 8, lineGap: 2 });
  doc.moveDown(0.25);
}

// ─── Cover / header ─────────────────────────────────────────────
doc.rect(0, 0, doc.page.width, 130).fill(COLORS.navy);
doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(24).text('CompanySync', 54, 38);
doc.font('Helvetica').fontSize(15).text('Pre-Launch Audit Report', 54, 70);
doc.fontSize(10).fillColor('#c9d6e3').text('Prepared July 22, 2026   \u2022   Target launch: August 1, 2026', 54, 96);
doc.y = 150; doc.x = 54; doc.fillColor(COLORS.text);

// ─── Executive summary ──────────────────────────────────────────
doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.navy).text('Executive Summary');
hr();
doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.text).text(
  'A full audit was run across four areas: security, speed/performance, cost efficiency, and unfinished work. ' +
  'The platform is in good shape for an August 1 launch \u2014 no show-stoppers were found. ' +
  'Core protections (tenant data isolation, payment webhook verification, subscription/billing guard rails, support-session lockdown) ' +
  'are in place and verified in enforcement mode in production.\n\n' +
  'The audit identified 4 URGENT items (complete before launch), 4 HIGH items (launch week), and a set of MEDIUM/LOW items ' +
  'for the first 30 days after launch. The urgent items total roughly 2\u20133 working days; the high items roughly 3\u20134 more. ' +
  'This puts the full pre-launch list comfortably inside the August 1 window.',
  { lineGap: 2.5 }
);
doc.moveDown(0.5);

// Scorecard
const scores = [
  ['Security', 'GOOD', COLORS.good, 'Core protections verified; package updates + 2 tightenings needed'],
  ['Speed', 'NEEDS WORK', COLORS.high, 'One large download on first load; dashboard over-fetches data'],
  ['Cost efficiency', 'FAIR', COLORS.medium, 'Limits in place but fail open; storm AI feature needs a cap'],
  ['Completeness', 'GOOD', COLORS.good, 'Two known gaps, one blocked on an outside vendor'],
];
ensureSpace(120);
const tableX = doc.page.margins.left; let ty = doc.y + 4;
scores.forEach(([area, grade, color, note]) => {
  doc.rect(tableX, ty, 504, 24).fill(COLORS.band);
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(10).text(area, tableX + 8, ty + 7, { width: 110, lineBreak: false });
  doc.fillColor(color).font('Helvetica-Bold').fontSize(10).text(grade, tableX + 120, ty + 7, { width: 90, lineBreak: false });
  doc.fillColor(COLORS.gray).font('Helvetica').fontSize(9).text(note, tableX + 210, ty + 8, { width: 290, height: 12, ellipsis: true });
  ty += 28;
});
doc.y = ty + 6; doc.x = doc.page.margins.left;

// ─── URGENT ────────────────────────────────────────────────────
sectionHeader('URGENT \u2014 Complete before launch (est. 2\u20133 days total)', COLORS.urgent);

item(1, 'Update 10 outdated software packages',
  'Ten of the app\u2019s underlying packages (including axios, lodash, nodemailer, ws, undici, vite, form-data) have publicly known ' +
  'security weaknesses rated High. Safe updated versions exist for all ten. This is the single most important security task: ' +
  'these are the first thing automated scanners look for once the product is public.',
  'Half a day (update + full regression test run)');

item(2, 'Add the missing production database index',
  'The development database has a stronger combined index on the main data table (entity type + company) than production, which ' +
  'only indexes by company. Because both use the same index name, production silently kept the weaker version. As customer data ' +
  'grows, common lookups (settings, API keys, daily usage) will slow down noticeably. The fix is one safe SQL statement.',
  '1\u20132 hours (including verification)');

item(3, 'Verify identity on the voice-assistant connection',
  'The live voice-assistant connection currently trusts the company ID sent by the browser instead of confirming it against the ' +
  'logged-in session. This should be verified server-side so one account can never open a connection under another company\u2019s ' +
  'identity or spend another company\u2019s AI credits.',
  'Half a day (dev + prod must both be updated and tested)');

item(4, 'Cross-check company membership on AI billing requests',
  'The main AI request handler accepts a company ID in the request body and uses it for billing and usage limits. It should ' +
  'confirm the requesting user actually belongs to that company \u2014 the same check pattern already used elsewhere in the app.',
  'Half a day');

// ─── HIGH ──────────────────────────────────────────────────────
sectionHeader('HIGH \u2014 Launch week (est. 3\u20134 days total)', COLORS.high);

item(5, 'Split the app into on-demand page downloads',
  'All 200+ pages currently ship as one large download before the dashboard can appear. Loading each page only when it\u2019s opened ' +
  'will dramatically improve first-load speed \u2014 especially on phones in the field, which is where your customers live. ' +
  'This is the single biggest speed win available.',
  '1\u20132 days (mechanical change + thorough click-through test)');

item(6, 'Stop the Dashboard from loading 8,000 records',
  'On open, the Dashboard requests up to 1,000 records each from eight different lists (invoices, customers, estimates, proposals, ' +
  'projects, leads, tasks, payments). It should request pre-computed summaries instead. Today it feels fine with small data; at a few ' +
  'thousand records per company it will visibly lag.',
  '1 day');

item(7, 'Cap the storm-alert AI lead generator',
  'When a storm is detected, the system automatically runs an AI lead-generation job for every subscribed company in the affected ' +
  'area. One large storm across a big metro could trigger hundreds of paid AI calls at once. Recommend a per-storm cap and/or making ' +
  'this feature opt-in per company.',
  'Half a day');

item(8, 'Tighten "fail open" usage limits for expensive operations',
  'If the database hiccups while checking a customer\u2019s daily AI/SMS/email limit, the system currently allows the action through ' +
  'unmetered (a deliberate choice so paying customers are never blocked by a glitch). For the most expensive operations (AI analysis, ' +
  'voice calls), a short retry before allowing would keep costs predictable without hurting customers.',
  'Half a day');

// ─── MEDIUM ────────────────────────────────────────────────────
sectionHeader('MEDIUM \u2014 First 30 days after launch', COLORS.medium);

item(9, 'Reduce background page polling',
  'A few pages (voice workspace, inspections, admin dashboard) re-check the server every 10\u201330 seconds even when idle. Cheap today, ' +
  'but multiplies directly with user count. Recommend slowing intervals and pausing when the browser tab is hidden.', null);

item(10, 'Cap unbounded data queries',
  'Some reporting endpoints (e.g. rep performance) load every lead, customer, and invoice for a company with no upper limit. ' +
  'Add sensible caps or move the math into the database.', null);

item(11, 'Fix the AI assistant\u2019s record-counting tool',
  'The assistant\u2019s "count all records" tool downloads entire tables (up to 10,000 full records each across 7 types) just to count them. ' +
  'A count query returns the same answer at a fraction of the cost.', null);

item(12, 'Decide on access rules for uploaded files',
  'Uploaded files (photos, documents) are reachable by anyone who has the exact link. Links are random and unguessable \u2014 a common and ' +
  'generally accepted practice \u2014 but for sensitive documents (contracts, insurance paperwork) consider requiring a login to view.', null);

item(13, 'Finish the Reports "Export to PDF" feature',
  'Marked as a to-do in the code. Either finish it before launch or hide the button via the hidden-features registry so customers ' +
  'don\u2019t click a dead end.', null);

item(14, 'Re-run the two security scanners that crashed',
  'Of three automated scanners, the dependency scanner completed (its findings are item 1). The static-code and privacy-flow scanners ' +
  'crashed mid-run due to a tooling problem \u2014 worth re-running for a clean bill of health. Manual review covered the same ground.', null);

// ─── LOW ───────────────────────────────────────────────────────
sectionHeader('LOW / EXTERNAL \u2014 Monitor', COLORS.low);

item(15, 'ABC Supply ordering (blocked on vendor)',
  'The material-ordering integration is built but waiting on production API keys from ABC Supply. Nothing to do on our side except follow up with them.', null);

item(16, 'Very long lead lists render slowly',
  'The Leads page renders every lead in a neighborhood group at once. Above ~1,000 leads in one view the browser will stutter. ' +
  'List virtualization solves this when the time comes.', null);

item(17, 'Review leftover internal defaults',
  'A hardcoded internal notification email and master-company IDs exist in the code. They function as intended (platform-owner ' +
  'notifications), but confirm they\u2019re the addresses you want receiving alerts at launch.', null);

// ─── Verified solid ────────────────────────────────────────────
sectionHeader('VERIFIED SOLID \u2014 No action needed', COLORS.good);
bullet('Tenant data isolation is ON in full enforcement mode in production (TENANT_GUARD_MODE=enforce), covering all entity reads and writes in both dev and prod.');
bullet('Twilio (calls/SMS) and Stripe (payments) webhooks both verify cryptographic signatures before acting.');
bullet('Support-session impersonation is locked down: read-only functions only, full audit logging, 30-minute expiry, owner email notification.');
bullet('Subscription, trial, and billing-credit fields cannot be self-granted through the data API \u2014 verified by 5 automated guard test suites that run on every code push.');
bullet('Live smoke tests pass: onboarding/trial flow (26 checks), request size limits + webhook URL safety (23 checks), trial daily limits (25 checks), quick-create shortcuts (24 checks).');
bullet('Duplicate-payment protections: 77 automated tests passing.');

// ─── False alarms ──────────────────────────────────────────────
sectionHeader('FALSE ALARMS \u2014 Investigated and cleared', '#546e7a');
bullet('"Several app pages would fail in production" \u2014 incorrect. The flagged routes (dashboard, reports, sync, presence, rep performance, QuickBooks callback, recording playback) all exist in the production server; the first scan simply looked in the wrong file.');
bullet('"Outsiders can trigger SMS/email sends through the function API" \u2014 not substantiated. No such directly-callable send functions are registered, and sampled handlers verify the caller\u2019s login and company membership individually. (A full sweep of all 211 functions is still recommended \u2014 see item 4.)');
bullet('"Tenant protection defaults to log-only" \u2014 true of the code default, but the production deployment explicitly sets full enforcement.');

// ─── Timeline ──────────────────────────────────────────────────
sectionHeader('SUGGESTED TIMELINE TO AUGUST 1', COLORS.navy);
const timeline = [
  ['July 22\u201323', 'URGENT items 1\u20132: package updates + database index (quick, safe, biggest risk reduction)'],
  ['July 23\u201324', 'URGENT items 3\u20134: identity checks on voice connection + AI billing requests'],
  ['July 25\u201328', 'HIGH items 5\u20136: on-demand page loading + dashboard summary queries'],
  ['July 29', 'HIGH items 7\u20138: storm AI cap + usage-limit tightening'],
  ['July 30', 'Full regression: all automated test suites + manual click-through of core flows'],
  ['July 31', 'Republish to production, verify health checks, final smoke test on the live site'],
  ['Aug 1', 'Launch. MEDIUM items begin as post-launch work.'],
];
timeline.forEach(([d, t]) => {
  ensureSpace(40);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.navy).text(d, { continued: true, width: 120 });
  doc.font('Helvetica').fillColor(COLORS.text).text(`   \u2014   ${t}`, { lineGap: 2 });
  doc.moveDown(0.3);
});

doc.moveDown(1);
hr();
doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(COLORS.light).text(
  'Methodology: four parallel deep code audits (security & tenant isolation, cost efficiency, performance, launch readiness), a production-dependency ' +
  'security scan (npm audit), production deployment log review, and manual verification of every critical finding against the live codebase and deployment configuration. ' +
  'Automated test status at time of writing: 175+ checks passing across 6 suites.',
  { lineGap: 2 });

doc.end();
doc.on('end', () => console.log('PDF written:', OUT));
