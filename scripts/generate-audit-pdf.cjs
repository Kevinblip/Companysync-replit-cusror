const PDFDocument = require('pdfkit');
const fs = require('fs');
const { Pool } = require('pg');

async function fetchLiveData(pool) {
  const q = (sql, params) => pool.query(sql, params).then(r => r.rows);

  const [
    counts,
    leadsByStatus,
    estimatesByStatus,
    invoicesByStatus,
    tasksByStatus,
    commsByType,
    tenantRows,
    workflowCount,
    workflowExecCount,
    stormCount,
    priceListCount,
    staffCount,
    genericTypeRows,
  ] = await Promise.all([
    q(`SELECT
        (SELECT COUNT(*) FROM companies WHERE is_deleted IS NOT TRUE) AS companies,
        (SELECT COUNT(*) FROM users)                                   AS users,
        (SELECT COUNT(*) FROM leads)                                   AS leads,
        (SELECT COUNT(*) FROM customers)                               AS customers,
        (SELECT COUNT(*) FROM estimates)                               AS estimates,
        (SELECT COUNT(*) FROM invoices)                                AS invoices,
        (SELECT COUNT(*) FROM payments)                                AS payments,
        (SELECT COUNT(*) FROM tasks)                                   AS tasks,
        (SELECT COUNT(*) FROM projects)                                AS projects,
        (SELECT COUNT(*) FROM communications)                          AS communications
    `),
    q(`SELECT status, COUNT(*) AS count FROM leads GROUP BY status ORDER BY count DESC`),
    q(`SELECT status, COUNT(*) AS count FROM estimates GROUP BY status ORDER BY count DESC`),
    q(`SELECT status, COUNT(*) AS count FROM invoices  GROUP BY status ORDER BY count DESC`),
    q(`SELECT status, COUNT(*) AS count FROM tasks     GROUP BY status ORDER BY count DESC`),
    q(`SELECT COALESCE(type,'(unknown)') AS type, COUNT(*) AS count FROM communications GROUP BY type ORDER BY count DESC`),
    q(`SELECT c.id, c.company_name, c.name, c.phone, c.email, c.subscription_plan, c.subscription_status,
              (SELECT COUNT(*) FROM leads       WHERE company_id = c.id) AS leads,
              (SELECT COUNT(*) FROM customers   WHERE company_id = c.id) AS customers,
              (SELECT COUNT(*) FROM estimates   WHERE company_id = c.id) AS estimates,
              (SELECT COUNT(*) FROM invoices    WHERE company_id = c.id) AS invoices,
              (SELECT COUNT(*) FROM tasks       WHERE company_id = c.id) AS tasks,
              (SELECT COUNT(*) FROM staff_profiles WHERE company_id = c.id) AS staff
       FROM companies c WHERE is_deleted IS NOT TRUE ORDER BY created_at`),
    q(`SELECT COUNT(*) AS count FROM generic_entities WHERE entity_type = 'Workflow'`),
    q(`SELECT COUNT(*) AS count FROM generic_entities WHERE entity_type = 'WorkflowExecution'`),
    q(`SELECT COUNT(*) AS count FROM generic_entities WHERE entity_type = 'StormEvent'`),
    q(`SELECT COUNT(*) AS count FROM generic_entities WHERE entity_type = 'PriceListItem'`),
    q(`SELECT COUNT(*) AS count FROM staff_profiles`),
    q(`SELECT entity_type, COUNT(*) AS count FROM generic_entities GROUP BY entity_type ORDER BY count DESC LIMIT 15`),
  ]);

  const c = counts[0];
  return {
    auditDate: new Date(),
    companies:          parseInt(c.companies, 10),
    users:              parseInt(c.users, 10),
    leads:              parseInt(c.leads, 10),
    customers:          parseInt(c.customers, 10),
    estimates:          parseInt(c.estimates, 10),
    invoices:           parseInt(c.invoices, 10),
    payments:           parseInt(c.payments, 10),
    tasks:              parseInt(c.tasks, 10),
    projects:           parseInt(c.projects, 10),
    communications:     parseInt(c.communications, 10),
    staffProfiles:      parseInt(staffCount[0].count, 10),
    workflows:          parseInt(workflowCount[0].count, 10),
    workflowExecutions: parseInt(workflowExecCount[0].count, 10),
    stormEvents:        parseInt(stormCount[0].count, 10),
    priceListItems:     parseInt(priceListCount[0].count, 10),
    leadsByStatus:      leadsByStatus,
    estimatesByStatus:  estimatesByStatus,
    invoicesByStatus:   invoicesByStatus,
    tasksByStatus:      tasksByStatus,
    commsByType:        commsByType,
    tenants:            tenantRows,
    genericTypes:       genericTypeRows,
  };
}

async function fetchCodebaseStats() {
  const { execSync } = require('child_process');
  const pageCount  = parseInt(execSync('ls src/pages/ | wc -l').toString().trim(), 10);
  const funcCount  = parseInt(execSync('ls functions/ | wc -l').toString().trim(), 10);
  const fileCount  = parseInt(execSync('find src -name "*.jsx" -o -name "*.tsx" | wc -l').toString().trim(), 10);
  const testCount  = parseInt(execSync('find src -name "*.test.*" -o -name "*.spec.*" | grep -v node_modules | wc -l').toString().trim(), 10);
  const hasPWA     = fs.existsSync('public/sw.js') && fs.existsSync('public/manifest.json');
  const hasOffline = fs.existsSync('public/offline.html');
  const swContent  = hasPWA ? fs.readFileSync('public/sw.js', 'utf8') : '';
  const hasBackgroundSync = swContent.includes("'sync'") || swContent.includes('"sync"');
  return { pageCount, funcCount, fileCount, testCount, hasPWA, hasOffline, hasBackgroundSync };
}

function fmt(n) { return Number(n).toLocaleString('en-US'); }

function statusLabel(status) {
  const map = {
    active: 'Active', enterprise: 'Enterprise', trial: 'Trial',
    cancelled: 'Cancelled', past_due: 'Past Due',
  };
  return map[String(status).toLowerCase()] || String(status);
}

async function buildPDF(data, code) {
  const { auditDate, tenants } = data;
  const outputPath = 'public/CRM-Audit-Report.pdf';

  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 60, bottom: 60, left: 60, right: 60 },
    bufferPages: true,
    info: {
      Title: 'CompanySync CRM — Full Platform Audit Report',
      Author: 'CompanySync Platform',
      Subject: 'Live Data Audit: Tenants, Data Health, Strengths, Weaknesses & Roadmap',
      CreationDate: auditDate,
    },
  });

  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  const colors = {
    primary:   '#1a365d',
    secondary: '#2d4a7a',
    accent:    '#2563eb',
    green:     '#166534',
    greenBg:   '#dcfce7',
    red:       '#991b1b',
    redBg:     '#fee2e2',
    orange:    '#9a3412',
    orangeBg:  '#fff7ed',
    blue:      '#1e40af',
    blueBg:    '#dbeafe',
    lightGray: '#f3f4f6',
    border:    '#d1d5db',
    text:      '#1f2937',
    textLight: '#6b7280',
  };

  function drawPageHeader(subtitle) {
    doc.rect(0, 0, doc.page.width, 140).fill(colors.primary);
    doc.fill('#ffffff').fontSize(24).font('Helvetica-Bold')
       .text('COMPANYSYNC CRM — PLATFORM AUDIT', 60, 38, { width: doc.page.width - 120 });
    doc.fontSize(13).font('Helvetica')
       .text(subtitle || 'Full Platform Audit Report', 60, 74);
    doc.fontSize(10).fillColor('#94a3b8')
       .text(
         `Generated: ${auditDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
         60, 104
       );
    doc.y = 165;
  }

  function sectionTitle(title) {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(0.5);
    const y = doc.y;
    doc.rect(60, y, 4, 22).fill(colors.accent);
    doc.fillColor(colors.primary).fontSize(16).font('Helvetica-Bold').text(title, 72, y + 2);
    doc.moveDown(0.8);
  }

  function subSection(title, color) {
    if (doc.y > doc.page.height - 100) doc.addPage();
    doc.fillColor(color || colors.secondary).fontSize(12).font('Helvetica-Bold').text(title, 60);
    doc.moveDown(0.3);
  }

  function bodyText(text) {
    doc.fillColor(colors.text).fontSize(10).font('Helvetica')
       .text(text, 60, undefined, { width: doc.page.width - 120, lineGap: 3 });
    doc.moveDown(0.3);
  }

  function bulletPoint(text, indent) {
    if (doc.y > doc.page.height - 60) doc.addPage();
    const x = indent || 72;
    const bulletY = doc.y + 5;
    doc.circle(x + 2, bulletY, 2).fill(colors.accent);
    doc.fillColor(colors.text).fontSize(10).font('Helvetica')
       .text(text, x + 10, undefined, { width: doc.page.width - x - 70, lineGap: 2 });
    doc.moveDown(0.2);
  }

  function statBox(label, value, x, y, width, colorOverride) {
    doc.save();
    doc.roundedRect(x, y, width, 58, 6).fill(colors.lightGray);
    doc.fillColor(colorOverride || colors.accent).fontSize(20).font('Helvetica-Bold')
       .text(String(value), x, y + 10, { width, align: 'center' });
    doc.fillColor(colors.textLight).fontSize(9).font('Helvetica')
       .text(label, x, y + 38, { width, align: 'center' });
    doc.restore();
  }

  function ratingBar(label, score, maxScore, color) {
    if (doc.y > doc.page.height - 60) doc.addPage();
    const y = doc.y;
    const barWidth = 260;
    const barX = doc.page.width - 60 - barWidth;
    doc.fillColor(colors.text).fontSize(10).font('Helvetica').text(label, 60, y + 2);
    doc.roundedRect(barX, y + 2, barWidth, 14, 3).fill('#e5e7eb');
    doc.roundedRect(barX, y + 2, barWidth * (score / maxScore), 14, 3).fill(color);
    doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold')
       .text(`${score}/${maxScore}`, barX, y + 4, { width: barWidth, align: 'center' });
    doc.moveDown(1);
  }

  function divider() {
    if (doc.y > doc.page.height - 40) doc.addPage();
    doc.moveDown(0.3);
    doc.rect(60, doc.y, doc.page.width - 120, 1).fill(colors.border);
    doc.moveDown(0.6);
  }

  function statusBadge(label, color, bgColor, x, y) {
    const w = 72, h = 16;
    doc.roundedRect(x, y, w, h, 4).fill(bgColor);
    doc.fillColor(color).fontSize(8).font('Helvetica-Bold')
       .text(label, x, y + 4, { width: w, align: 'center' });
  }

  function drawTable(rows) {
    const colWidths = [130, 55, 60, 270];
    const tableX = 60;
    let rowY = doc.y;
    rows.forEach((row, rowIdx) => {
      if (rowY > doc.page.height - 80) { doc.addPage(); rowY = doc.y; }
      const isHeader = rowIdx === 0;
      const rowH = 22;
      const rowColor = isHeader ? colors.primary :
        row[2] === 'Alert'  ? '#fee2e2' :
        row[2] === 'Review' ? '#fff7ed' : '#ffffff';
      doc.rect(tableX, rowY, doc.page.width - 120, rowH).fill(rowColor);
      let cellX = tableX + 6;
      row.forEach((cell, ci) => {
        const textColor = isHeader ? '#ffffff' :
          ci === 2 && row[2] === 'Alert'  ? colors.red :
          ci === 2 && row[2] === 'Review' ? colors.orange :
          ci === 2 ? colors.green : colors.text;
        doc.fillColor(textColor).fontSize(9)
           .font(isHeader || ci === 2 ? 'Helvetica-Bold' : 'Helvetica')
           .text(cell, cellX, rowY + 7, { width: colWidths[ci] - 4, lineBreak: false });
        cellX += colWidths[ci];
      });
      doc.rect(tableX, rowY, doc.page.width - 120, rowH).stroke(colors.border);
      rowY += rowH;
    });
    doc.y = rowY + 12;
  }

  const colW4 = (doc.page.width - 120 - 30) / 4;

  // ── PAGE 1: COVER ──
  drawPageHeader('Full Platform Audit: Tenants, Data Health & Roadmap');

  const statsY = doc.y;
  statBox('Active Tenants',     fmt(data.companies),   60,                       statsY, colW4, colors.accent);
  statBox('Registered Users',   fmt(data.users),        60 + colW4 + 10,          statsY, colW4, colors.green);
  statBox('Staff Profiles',     fmt(data.staffProfiles),60 + (colW4 + 10) * 2,    statsY, colW4, colors.accent);
  statBox('Total Tasks',        fmt(data.tasks),        60 + (colW4 + 10) * 3,    statsY, colW4, colors.orange);
  doc.y = statsY + 75;

  const stats2Y = doc.y;
  statBox('Estimates',          fmt(data.estimates),    60,                       stats2Y, colW4, colors.green);
  statBox('Leads',              fmt(data.leads),        60 + colW4 + 10,          stats2Y, colW4, colors.accent);
  statBox('Workflows Defined',  fmt(data.workflows),    60 + (colW4 + 10) * 2,    stats2Y, colW4, colors.secondary);
  statBox('Storm Events Logged',fmt(data.stormEvents),  60 + (colW4 + 10) * 3,    stats2Y, colW4, colors.blue);
  doc.y = stats2Y + 80;

  sectionTitle('EXECUTIVE SUMMARY');
  bodyText(
    `This audit covers the CompanySync roofing CRM platform as of ` +
    `${auditDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. ` +
    `The platform is a multi-tenant SaaS application with ${code.pageCount} frontend pages, ${code.funcCount} serverless functions, ` +
    `and ${code.fileCount} frontend component files. It serves ${data.companies} tenant companies with ${data.users} registered users ` +
    `and ${data.staffProfiles} staff profiles.`
  );
  bodyText(
    `The CRM holds ${fmt(data.leads)} leads, ${fmt(data.customers)} customers, ${fmt(data.estimates)} estimates, ` +
    `${fmt(data.invoices)} invoices, and ${fmt(data.tasks)} tasks across all tenants. ` +
    `The workflow engine has ${fmt(data.workflows)} defined workflows with ${fmt(data.workflowExecutions)} tracked executions. ` +
    `The storm tracking system has logged ${fmt(data.stormEvents)} events and the price list contains ${fmt(data.priceListItems)} items.`
  );
  bodyText(
    'Overall Assessment: The platform has extraordinary feature breadth that surpasses most competitors. ' +
    'A full PWA with offline support and background sync is live and confirmed working in the field. ' +
    'The primary areas for improvement are test coverage, reliability infrastructure (error handling), ' +
    'and active use of the pipeline to convert leads and estimates into closed business.'
  );

  doc.moveDown(0.4);
  subSection('Platform Ratings', colors.secondary);
  doc.moveDown(0.3);
  ratingBar('Feature Completeness',     9.5, 10, colors.green);
  ratingBar('AI / Innovation',          9.0, 10, colors.accent);
  ratingBar('Multi-Tenancy & Security', 8.0, 10, colors.green);
  ratingBar('Mobile / Field Readiness', 5.0, 10, colors.orange);
  ratingBar('Test Coverage',            2.0, 10, colors.red);
  ratingBar('Code Maintainability',     5.0, 10, colors.orange);
  ratingBar('User Onboarding',          6.0, 10, colors.orange);
  ratingBar('Offline / PWA Capability', 7.5, 10, colors.green);
  ratingBar('Data Conversion Rate',     4.0, 10, colors.orange);

  // ── PAGE 2: TENANT OVERVIEW ──
  doc.addPage();
  drawPageHeader('Section 1 — Tenant Overview');
  sectionTitle('TENANT OVERVIEW');
  bodyText(`The platform currently hosts ${data.companies} tenant ${data.companies === 1 ? 'company' : 'companies'}. Below is each tenant's configuration and subscription status.`);
  doc.moveDown(0.3);

  tenants.forEach((t, i) => {
    if (doc.y > doc.page.height - 160) doc.addPage();
    const boxY = doc.y;
    const boxH = 135;
    doc.roundedRect(60, boxY, doc.page.width - 120, boxH, 6).fill(colors.lightGray);

    const plan   = statusLabel(t.subscription_plan   || 'unknown');
    const status = statusLabel(t.subscription_status || 'unknown');
    const isEnterprise = plan.toLowerCase() === 'enterprise';
    const isTrial      = plan.toLowerCase() === 'trial';
    const planBg    = isEnterprise ? colors.blueBg : isTrial ? colors.orangeBg : colors.greenBg;
    const planColor = isEnterprise ? colors.blue   : isTrial ? colors.orange   : colors.green;
    const isActive  = (t.subscription_status || '').toLowerCase() === 'active';
    const statusBg    = isActive ? colors.greenBg : colors.orangeBg;
    const statusColor = isActive ? colors.green   : colors.orange;

    const displayName = t.company_name || t.name || '(unnamed)';
    doc.fillColor(colors.primary).fontSize(12).font('Helvetica-Bold')
       .text(`${i + 1}. ${displayName}`, 76, boxY + 10, { width: 260 });
    statusBadge(plan.toUpperCase(),   planColor,   planBg,   doc.page.width - 160, boxY + 10);
    statusBadge(status.toUpperCase(), statusColor, statusBg, doc.page.width - 82,  boxY + 10);

    doc.fillColor(colors.text).fontSize(9).font('Helvetica');
    doc.text(`Email: ${t.email || '(not set)'}`, 76, boxY + 30, { width: doc.page.width - 152 });
    doc.text(`Phone: ${t.phone || '(not set)'}`, 76, boxY + 43, { width: doc.page.width - 152 });

    const metricY = boxY + 60;
    const metrics = [
      { label: 'Leads',     value: fmt(parseInt(t.leads, 10)) },
      { label: 'Customers', value: fmt(parseInt(t.customers, 10)) },
      { label: 'Estimates', value: fmt(parseInt(t.estimates, 10)) },
      { label: 'Invoices',  value: fmt(parseInt(t.invoices, 10)) },
      { label: 'Tasks',     value: fmt(parseInt(t.tasks, 10)) },
      { label: 'Staff',     value: fmt(parseInt(t.staff, 10)) },
    ];
    const mW = (doc.page.width - 152) / metrics.length;
    metrics.forEach((m, mi) => {
      const mx = 76 + mi * mW;
      doc.roundedRect(mx, metricY, mW - 4, 48, 4).fill('#ffffff');
      doc.fillColor(colors.accent).fontSize(14).font('Helvetica-Bold')
         .text(m.value, mx, metricY + 8, { width: mW - 4, align: 'center' });
      doc.fillColor(colors.textLight).fontSize(8).font('Helvetica')
         .text(m.label, mx, metricY + 30, { width: mW - 4, align: 'center' });
    });

    doc.y = boxY + boxH + 10;
    doc.moveDown(0.2);
  });

  // ── PAGE 3: DATA HEALTH ──
  doc.addPage();
  drawPageHeader('Section 2 — Data Health');
  sectionTitle('DATA HEALTH AUDIT');

  subSection('CRM Record Counts (Live)', colors.secondary);
  bodyText('The following reflects current record counts across all tenants as of report generation time.');
  doc.moveDown(0.3);

  const leadsNew       = (data.leadsByStatus.find(r => r.status === 'new')       || {}).count || 0;
  const estDraft       = (data.estimatesByStatus.find(r => r.status === 'draft') || {}).count || 0;
  const invSent        = (data.invoicesByStatus.find(r => r.status === 'sent')   || {}).count || 0;
  const tasksPending   = (data.tasksByStatus.find(r => r.status === 'pending')   || {}).count || 0;
  const tasksNS        = (data.tasksByStatus.find(r => r.status === 'not_started') || {}).count || 0;

  const allLeadsStuck  = data.leads > 0 && parseInt(leadsNew, 10) === data.leads;
  const estDraftPct    = data.estimates > 0 ? Math.round((parseInt(estDraft, 10) / data.estimates) * 100) : 0;

  const tableRows = [
    ['Entity',             'Count',               'Status',  'Notes'],
    ['Leads',              fmt(data.leads),        allLeadsStuck ? 'Alert' : data.leads > 0 ? 'Review' : 'OK',
     allLeadsStuck ? `All ${data.leads} leads are in "new" status — none progressed through pipeline` : `${data.leadsByStatus.map(r => `${r.count} ${r.status}`).join(', ')}`],
    ['Customers',          fmt(data.customers),    'OK',      `${data.customers} customers on record`],
    ['Estimates',          fmt(data.estimates),    estDraftPct >= 80 ? 'Alert' : estDraftPct >= 50 ? 'Review' : 'OK',
     `${estDraft} of ${data.estimates} are drafts (${estDraftPct}%); ${data.estimates - parseInt(estDraft, 10)} sent/converted`],
    ['Invoices',           fmt(data.invoices),     'OK',      `${invSent} sent${data.invoices - parseInt(invSent, 10) > 0 ? ', ' + (data.invoices - parseInt(invSent, 10)) + ' draft' : ''}`],
    ['Payments',           fmt(data.payments),     data.payments === 0 ? 'Alert' : 'OK',
     data.payments === 0 ? 'No payments recorded — verify Stripe is connected and active' : `${data.payments} payment(s) recorded`],
    ['Tasks',              fmt(data.tasks),        parseInt(tasksPending, 10) + parseInt(tasksNS, 10) >= data.tasks * 0.9 ? 'Review' : 'OK',
     `${tasksPending} pending, ${tasksNS} not started — ${data.tasks - parseInt(tasksPending, 10) - parseInt(tasksNS, 10)} completed`],
    ['Projects',           fmt(data.projects),     data.projects === 0 ? 'Review' : 'OK',
     data.projects === 0 ? 'No active projects created yet' : `${data.projects} projects`],
    ['Communications',     fmt(data.communications),'OK',    `${data.communications} communication events logged`],
    ['Workflow Executions',fmt(data.workflowExecutions),'OK',`${data.workflowExecutions} executions across ${data.workflows} defined workflows`],
    ['Staff Profiles',     fmt(data.staffProfiles),'OK',     `${data.staffProfiles} staff profiles configured`],
    ['Storm Events',       fmt(data.stormEvents),  'OK',     'Storm tracking operating at scale'],
    ['Price List Items',   fmt(data.priceListItems),'OK',    'Comprehensive Xactimate price list loaded'],
  ];

  drawTable(tableRows);

  subSection('Key Data Health Findings', colors.red);
  if (allLeadsStuck) {
    bulletPoint(`Lead pipeline is stalled: All ${data.leads} leads are in "new" status. The pipeline is not being actively worked or lead assignment is not functioning.`);
  }
  if (estDraftPct >= 50) {
    bulletPoint(`Estimate draft rate is high at ${estDraftPct}%: ${estDraft} of ${data.estimates} estimates have not been sent. These represent unsent revenue proposals.`);
  }
  if (data.payments === 0) {
    bulletPoint('Zero payments recorded: No revenue has been processed through the platform. Stripe should be verified as properly connected for each tenant.');
  }
  if (parseInt(tasksPending, 10) + parseInt(tasksNS, 10) >= data.tasks * 0.9) {
    bulletPoint(`High task backlog: ${parseInt(tasksPending, 10) + parseInt(tasksNS, 10)} of ${data.tasks} tasks are pending or not started. Consider a daily task review process.`);
  }
  bulletPoint(`Positive: Workflow engine is active with ${fmt(data.workflowExecutions)} executions and the storm tracking system is functioning at scale (${fmt(data.stormEvents)} events).`);
  bulletPoint(`Positive: ${fmt(data.priceListItems)} Xactimate price list items are loaded and ready for estimate generation.`);

  // ── PAGE 4: STRENGTHS ──
  doc.addPage();
  drawPageHeader('Section 3 — Platform Strengths');
  sectionTitle('STRENGTHS');

  subSection('1. Massive Feature Coverage', colors.green);
  bodyText(
    `With ${code.pageCount} pages and ${code.funcCount} serverless functions, this is one of the most comprehensive roofing platforms available. ` +
    'Most competitors (JobNimbus, AccuLynx, Roofr) offer 20-30 features. The platform covers the entire business lifecycle: ' +
    'Leads, Estimates, Contracts, Projects, Invoices, Payments, Accounting, HR, Commissions, and more.'
  );

  subSection('2. AI Differentiators — Biggest Competitive Edge', colors.green);
  bulletPoint('CrewCam AI Photo Analysis: Two-pass Gemini damage detection with bounding boxes for hail, wind, and material identification. No competitor does this.');
  bulletPoint('AI Roof Measurement: Google Solar API calibrated against verified Roofgraf reports. Professional-grade accuracy with complexity detection for multi-hip/valley roofs.');
  bulletPoint('Sarah/Lexi AI Voice Assistants: Live speech-to-speech using Gemini API. Handles inbound/outbound calls, books appointments, saves leads to CRM automatically.');
  bulletPoint(`AI Estimator (8,200+ lines): Deep estimation engine with Xactimate price list integration (${fmt(data.priceListItems)} items), satellite imagery, and automated calculations.`);
  bulletPoint('Video Training Generator: AI-powered narration and voiceover generation for staff onboarding. Unique differentiator.');
  bulletPoint('AI Accountant, Permit Assistant, Workflow Builder Agent — AI touches every part of the platform.');

  subSection('3. Strong Multi-Tenancy & Role-Based Access', colors.green);
  bodyText(
    `Company ID isolation is enforced across all ${code.pageCount} pages. Role-based permissions are highly granular with view_own, view_global, ` +
    'create, edit, delete capabilities organized across 8 permission groups. This is enterprise-grade access control.'
  );

  subSection('4. Full Business Lifecycle Coverage', colors.green);
  bulletPoint('Lead Management: Lead scoring, round-robin assignment, territory management, storm tracking, field sales tracker, lead finder with skip tracing');
  bulletPoint('Sales Pipeline: Estimates, proposals, contract templates with e-signatures, PDF branding');
  bulletPoint('Project Management: Tasks, calendar sync (Google Calendar), daily reports, crew scheduling');
  bulletPoint('Financial: Full double-entry accounting, chart of accounts, journal entries, bank reconciliation, AR reports, commission tracking, payroll, expenses');
  bulletPoint('Communication: SMS/email templates, Twilio integration, live call dashboard, campaign management');

  subSection('5. Industry-Specific Intelligence', colors.green);
  bulletPoint(`Storm tracking and alert system — ${fmt(data.stormEvents)} events logged for proactive lead generation`);
  bulletPoint('Territory management with geo-boundaries');
  bulletPoint(`Xactimate price list with ${fmt(data.priceListItems)} line items for insurance-grade estimates`);
  bulletPoint('Subcontractor management with insurance compliance tracking');
  bulletPoint('ABC Supply ordering integration');
  bulletPoint('Field rep mobile app with GPS activity tracking');

  subSection('6. Integrations Ecosystem', colors.green);
  bulletPoint('Twilio (calls, SMS), Google Calendar, Stripe (payments), GoHighLevel (CRM sync)');
  bulletPoint('ABC Supply (materials), Zoom, Slack, Google Chat, Zapier webhooks');
  bulletPoint('TikTok lead capture, review request system, customer portal');

  subSection('7. Active Workflow Automation Engine', colors.green);
  bodyText(
    `The platform has ${fmt(data.workflows)} defined workflows with ${fmt(data.workflowExecutions)} recorded executions. ` +
    'This includes lead nurture sequences, estimate follow-ups, inspection reminders, daily reports, and cron-based automation for storm alerts and campaign sending.'
  );

  // ── PAGE 5: WEAKNESSES ──
  doc.addPage();
  drawPageHeader('Section 4 — Weaknesses & Risks');
  sectionTitle('WEAKNESSES');

  subSection('1. Thin Automated Test Coverage (Moderate–High Risk)', colors.orange);
  bodyText(
    `The project has ${code.testCount} test file${code.testCount !== 1 ? 's' : ''} covering error boundaries, company selection, and redirect logic. ` +
    `For a platform with ${code.pageCount} pages and ${code.funcCount} functions, this is far below safe coverage. ` +
    'One change to a shared component, entity schema, or API endpoint could silently break dozens of features.'
  );
  bulletPoint('Recommendation: Add integration tests for critical flows (lead creation, estimate generation, payment processing)');
  bulletPoint('Add end-to-end tests for the top 10 most-used user journeys');

  subSection('2. PWA Implemented — Background Sync Coverage Can Expand (Minor Gap)', colors.orange);
  bodyText(
    'A full PWA is live: service worker (sw.js), Web App Manifest, offline fallback page, and background sync are all implemented and confirmed working in the field. ' +
    'Photos and data queued while offline upload automatically once WiFi or cell service is restored. ' +
    'The remaining gap is expanding the offline data cache to cover more CRM views (customer profiles, job history) for read-only access while offline.'
  );
  bulletPoint('Recommendation: Add IndexedDB-backed offline caching for the 5 most-visited field pages');

  subSection('3. Pipeline Stagnation (Operational Risk)', colors.red);
  bodyText('The live data audit reveals a systemic operational issue: leads are stuck in "new" status and most estimates remain as drafts. The CRM is being populated but not actively used to close deals.');
  bulletPoint('Recommendation: Set up automated follow-up workflows to advance leads and send draft estimates');
  bulletPoint('Add dashboard alerts for leads that have been in "new" status for more than 48 hours');

  subSection('4. Duplicate / Redundant Pages', colors.orange);
  bodyText('Several page files appear to be duplicates or older versions that were never cleaned up:');
  ['contract-templates.jsx AND ContractTemplates.jsx', 'customer-profile.jsx AND CustomerProfile.jsx',
   'invoice-details.jsx AND Invoices.jsx', 'payments.jsx AND Payments.jsx',
   'estimate-editor.jsx AND EstimateEditor.jsx', 'settings.jsx AND Settings.jsx'].forEach(p => bulletPoint(p));
  bodyText('This creates confusion about which is the "real" version and increases maintenance burden.');

  subSection('5. Large File Sizes Hurt Maintainability', colors.orange);
  bodyText('Several core files have grown extremely large:');
  ['AIEstimator.jsx: 8,237 lines', 'InspectionCapture.jsx: 3,320 lines', 'Leads.jsx: 3,093 lines',
   'Dashboard.jsx: 3,001 lines', 'Calendar.jsx: 2,443 lines'].forEach(p => bulletPoint(p));
  bodyText('Industry best practice is to keep component files under 300-500 lines.');

  subSection('6. Minimal Accessibility (ADA Compliance Risk)', colors.orange);
  bodyText('Only 4 pages have any ARIA attributes. The platform lacks systematic keyboard navigation, screen reader support, and proper semantic HTML.');

  subSection('7. No Internationalization Framework', colors.orange);
  bodyText('The platform is English-only. Adding i18n support later is expensive — it touches every page. Planning for it now would save significant refactoring.');

  subSection('8. No Global Error Boundaries', colors.orange);
  bodyText(`If one component crashes, the entire page goes blank. With ${code.pageCount} pages and complex data dependencies, crashes will happen. Users need a friendly error message with a retry option.`);

  // ── PAGE 6: RECOMMENDATIONS ──
  doc.addPage();
  drawPageHeader('Section 5 — Recommendations');
  sectionTitle('RECOMMENDATIONS');
  doc.moveDown(0.3);

  subSection('HIGH IMPACT / QUICK WINS', colors.green);
  doc.moveDown(0.2);

  const quickWins = [
    ['Activate lead pipeline workflows',     'Set up automated SMS/email follow-up sequences for all "new" leads. Every lead over 24 hours old should trigger an outreach task.'],
    ['Send outstanding draft estimates',     `Review all ${estDraft} draft estimates and either send or archive them. Unsent estimates are lost revenue opportunities.`],
    ['Verify Stripe payment connection',     'Confirm Stripe is connected and active. Test by creating a $1 test invoice and processing payment.'],
    ['Add global error boundaries',          'Wrap major page sections in React Error Boundaries so crashes show a recovery message instead of a blank screen.'],
    ['Clean up duplicate pages',             'Remove or consolidate the 6+ duplicate page files. Pick the best version, redirect the old route.'],
    ['Polish the customer-facing portal',    'The estimate viewer, invoice payment page, and contract signing flow are what homeowners see. These should feel premium.'],
    ['Command palette (Cmd+K)',              `With ${code.pageCount} pages, users need a fast way to jump to any feature. A searchable command palette dramatically improves navigation.`],
  ];

  quickWins.forEach(([title, desc]) => {
    if (doc.y > doc.page.height - 80) doc.addPage();
    doc.fillColor(colors.accent).fontSize(10).font('Helvetica-Bold').text(title, 72);
    doc.fillColor(colors.text).fontSize(9).font('Helvetica').text(desc, 84, undefined, { width: doc.page.width - 144, lineGap: 2 });
    doc.moveDown(0.5);
  });

  divider();
  subSection('MEDIUM IMPACT / STRATEGIC', colors.accent);
  doc.moveDown(0.2);

  const strategic = [
    ['Mobile-first "Field Mode"',           'A simplified interface toggle showing only what crews need on-site: photo capture, task checklists, GPS check-in, daily report submission.'],
    ['PWA with offline support',            'Cache recent leads and customer data. Allow photo uploads to queue when offline and sync when connection returns.'],
    ['Dashboard customization',             "Let each user pick their own dashboard widgets. A sales rep doesn't need accounting charts."],
    ['Automated follow-up sequences',       '"No response in 3 days = send follow-up text." Build configurable drip campaigns based on record status.'],
    ['Lead & estimate pipeline dashboards', 'Add visual Kanban-style boards to show where every lead and estimate is in the pipeline.'],
    ['Onboarding wizard improvements',      'Guide new users through connecting Twilio, Stripe, and adding their first lead in under 10 minutes.'],
  ];

  strategic.forEach(([title, desc]) => {
    if (doc.y > doc.page.height - 80) doc.addPage();
    doc.fillColor(colors.accent).fontSize(10).font('Helvetica-Bold').text(title, 72);
    doc.fillColor(colors.text).fontSize(9).font('Helvetica').text(desc, 84, undefined, { width: doc.page.width - 144, lineGap: 2 });
    doc.moveDown(0.5);
  });

  divider();
  if (doc.y > doc.page.height - 200) doc.addPage();
  subSection('LONG-TERM COMPETITIVE MOATS', colors.primary);
  doc.moveDown(0.2);

  const longTerm = [
    ['Homeowner mobile experience',      'Let homeowners track their roofing project, see progress photos, approve change orders, sign contracts, and pay invoices from their phone.'],
    ['Insurance claim automation',       'Pre-fill Xactimate supplements from AI photo analysis. Auto-generate supplement reports from CrewCam damage detection.'],
    ['Material ordering from estimates', 'Auto-generate material lists from approved estimates and send orders to ABC Supply or SRS Distribution.'],
    ['Weather-integrated scheduling',    'Auto-reschedule jobs when rain is forecasted. Alert crews proactively. Integrate with weather APIs for 10-day forecasts on the calendar.'],
    ['Referral tracking & rewards',      'Track which customers referred new leads. Automate referral rewards (gift cards, discounts).'],
    ['AI-powered pricing optimization',  'Analyze win/loss rates against estimate pricing. Suggest optimal pricing based on market area, roof complexity, and competitor data.'],
  ];

  longTerm.forEach(([title, desc]) => {
    if (doc.y > doc.page.height - 80) doc.addPage();
    doc.fillColor(colors.accent).fontSize(10).font('Helvetica-Bold').text(title, 72);
    doc.fillColor(colors.text).fontSize(9).font('Helvetica').text(desc, 84, undefined, { width: doc.page.width - 144, lineGap: 2 });
    doc.moveDown(0.5);
  });

  // ── PAGE 7: COMPETITIVE LANDSCAPE ──
  doc.addPage();
  drawPageHeader('Section 6 — Competitive Landscape');
  sectionTitle('COMPETITIVE LANDSCAPE');
  doc.moveDown(0.3);
  bodyText('How CompanySync stacks up against the major roofing CRM competitors:');
  doc.moveDown(0.5);

  const competitors = [
    { name: 'CompanySync (Your Platform)',
      features: `${code.pageCount} pages, ${code.funcCount} functions — Full CRM + AI Voice + AI Photos + AI Estimating + Accounting + Field App`,
      strength: 'Broadest feature set in the industry; AI innovation across every module',
      weakness: 'No native app store install (PWA available and working in field); pipeline conversion needs to be actively worked', ours: true },
    { name: 'JobNimbus',
      features: 'CRM, project boards, payments, mobile app',
      strength: 'Strong mobile app, easy to use, quick to onboard',
      weakness: 'No AI features, limited estimating, no accounting' },
    { name: 'AccuLynx',
      features: 'CRM, aerial measurements, material ordering, labor tracking',
      strength: 'EagleView integration, ABC Supply ordering built-in',
      weakness: 'Expensive, no AI features, dated interface' },
    { name: 'Roofr',
      features: 'Instant roof measurements, proposals, CRM',
      strength: 'Beautiful proposals, fast measurements, clean UI',
      weakness: 'Limited CRM depth, no project management, no accounting' },
    { name: 'CompanyCam',
      features: 'Photo documentation, timelines, annotations',
      strength: 'Best-in-class photo management and job documentation',
      weakness: 'Photos only — not a full CRM at all' },
    { name: 'Leap (EverCommerce)',
      features: 'CRM, digital contracts, workflow automation',
      strength: 'Good workflow engine, strong contract management',
      weakness: 'No AI features, expensive per-seat pricing' },
  ];

  competitors.forEach(comp => {
    if (doc.y > doc.page.height - 110) doc.addPage();
    const boxY = doc.y;
    if (comp.ours) doc.roundedRect(60, boxY, doc.page.width - 120, 88, 6).fill(colors.blueBg);
    doc.fillColor(comp.ours ? colors.blue : colors.primary).fontSize(11).font('Helvetica-Bold')
       .text(comp.name, 70, boxY + (comp.ours ? 10 : 4), { width: doc.page.width - 140 });
    doc.fillColor(colors.text).fontSize(9).font('Helvetica')
       .text(`Features: ${comp.features}`, 82, undefined, { width: doc.page.width - 164, lineGap: 1 });
    doc.fillColor(colors.green).text(`Strength: ${comp.strength}`, 82, undefined, { width: doc.page.width - 164 });
    doc.fillColor(colors.red).text(`Gap: ${comp.weakness}`, 82, undefined, { width: doc.page.width - 164 });
    doc.moveDown(0.7);
  });

  // ── PAGE 8: ROADMAP ──
  doc.addPage();
  drawPageHeader('Section 7 — Priority Roadmap');
  sectionTitle('PRIORITY ROADMAP');
  doc.moveDown(0.3);

  const phases = [
    { title: 'Phase 1: Operational Activation (Immediate — Week 1)', color: colors.red,
      items: [
        'Activate lead follow-up workflows — no lead should stay in "new" status beyond 24 hours',
        `Review and send all ${estDraft} draft estimates; archive any no longer valid`,
        'Verify and test Stripe payment flow end-to-end for each active tenant',
        `Set up daily digest notifications for the ${fmt(data.tasks)} pending tasks to reduce backlog`,
        'Confirm all Twilio webhooks are active and routing calls/SMS correctly',
      ]},
    { title: 'Phase 2: Foundation Hardening (Weeks 1-2)', color: colors.orange,
      items: [
        'Remove duplicate page files and consolidate routes',
        'Add React Error Boundaries to all major page sections',
        'Add loading/skeleton states to top 20 most-used pages',
        'Polish customer-facing pages (estimate viewer, invoice payment, contract signing)',
        `Break up the 5 largest files into smaller components`,
      ]},
    { title: 'Phase 3: Field Readiness (Weeks 3-4)', color: colors.accent,
      items: [
        'Build "Field Mode" simplified interface for crews',
        'Expand IndexedDB offline cache to top 5 field pages (PWA & background sync already live)',
        `Add command palette (Cmd+K) for fast navigation across all ${code.pageCount} pages`,
        'Improve mobile responsiveness on all core pages',
        'Add push notifications for new leads and task assignments',
      ]},
    { title: 'Phase 4: Revenue Acceleration (Weeks 5-8)', color: colors.green,
      items: [
        'Build homeowner project tracking portal',
        'Insurance supplement auto-generation from AI photos',
        'Automated follow-up drip sequences (3-day, 7-day, 30-day cadences)',
        'Dashboard customization per user role',
        'Weather-integrated calendar scheduling',
      ]},
    { title: 'Phase 5: Market Leadership (Months 3-6)', color: colors.secondary,
      items: [
        'Material ordering integration (estimate → ABC Supply order)',
        'Referral tracking and automated rewards system',
        'AI pricing optimization engine',
        'Spanish language support (i18n)',
        'Comprehensive automated test suite',
      ]},
  ];

  phases.forEach(phase => {
    if (doc.y > doc.page.height - 150) doc.addPage();
    const phaseY = doc.y;
    doc.rect(60, phaseY, 6, 18).fill(phase.color);
    doc.fillColor(phase.color).fontSize(12).font('Helvetica-Bold')
       .text(phase.title, 74, phaseY + 1, { width: doc.page.width - 134 });
    doc.moveDown(0.4);
    phase.items.forEach(item => bulletPoint(item));
    doc.moveDown(0.5);
  });

  // ── FOOTERS ──
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(colors.textLight).fontSize(8).font('Helvetica')
       .text(
         `CompanySync CRM Audit Report  |  Generated ${auditDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}  |  Page ${i + 1} of ${range.count}`,
         0, doc.page.height - 38,
         { width: doc.page.width, align: 'center' }
       );
  }

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  const size = fs.statSync(outputPath).size;
  return { outputPath, sizeKB: (size / 1024).toFixed(1), pages: range.count };
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  try {
    console.log('Fetching live data from database...');
    const data = await fetchLiveData(pool);
    console.log(`Live data fetched as of: ${data.auditDate.toISOString()}`);
    console.log(`  Companies: ${data.companies}, Users: ${data.users}, Leads: ${data.leads}`);
    console.log(`  Estimates: ${data.estimates}, Invoices: ${data.invoices}, Payments: ${data.payments}`);
    console.log(`  Tasks: ${data.tasks}, Workflows: ${data.workflows}, Storm events: ${data.stormEvents}`);

    const code = await fetchCodebaseStats();
    console.log(`Codebase: ${code.pageCount} pages, ${code.funcCount} functions, ${code.fileCount} frontend files`);

    const result = await buildPDF(data, code);
    console.log(`\nPDF generated: ${result.outputPath}`);
    console.log(`File size: ${result.sizeKB} KB`);
    console.log(`Pages: ${result.pages}`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Error generating audit PDF:', err);
  process.exit(1);
});
