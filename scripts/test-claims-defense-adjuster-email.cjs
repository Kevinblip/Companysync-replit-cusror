#!/usr/bin/env node
/**
 * Claims Defense PDF adjuster-email smoke test
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates linked mock Estimate and InspectionJob records, invokes the real
 * sendEstimateEmail handler with a signed session, and captures the shared
 * email transport payload. PostgreSQL and the transport are stubbed at their
 * module boundaries, so this verifies the production handler and PDF generator
 * without mutating the shared database or sending test mail.
 *
 * Usage:
 *   node scripts/test-claims-defense-adjuster-email.cjs
 *   TEST_ADJUSTER_EMAIL=adjuster@your-domain.example node scripts/test-claims-defense-adjuster-email.cjs
 *
 */
'use strict';

const crypto = require('crypto');

const PFX = `smoke_claims_defense_${crypto.randomUUID().slice(0, 8)}_`;
const COMPANY_ID = `${PFX}company`;
const JOB_ID = `${PFX}inspection_job`;
const ESTIMATE_ID = `${PFX}estimate`;
const SESSION_ID = `${PFX}session`;
const USER_EMAIL = `${PFX}user@companysync.io`;
const ADJUSTER_EMAIL = process.env.TEST_ADJUSTER_EMAIL
  || process.argv[2]
  || `${PFX}adjuster@example.com`;
const TEST_SESSION_SECRET = 'claims-defense-adjuster-email-smoke-secret';

const inspectionJob = {
  id: JOB_ID,
  entity_type: 'InspectionJob',
  company_id: COMPANY_ID,
  data: {
    company_id: COMPANY_ID,
    property_address: '123 Claims Defense Ave, Cleveland, OH 44101',
    client_name: 'Smoke Test Homeowner',
    insurance_claim_number: 'CLM-SMOKE-1307',
  },
};

const estimate = {
  id: ESTIMATE_ID,
  company_id: COMPANY_ID,
  customer_name: 'Smoke Test Homeowner',
  customer_email: `${PFX}homeowner@companysync.io`,
  customer_phone: null,
  estimate_number: 'EST-SMOKE-1307',
  title: 'Claims Defense Smoke Estimate',
  status: 'draft',
  total_amount: 12345.67,
  property_address: inspectionJob.data.property_address,
  insurance_company: 'Smoke Test Insurance',
  claim_number: 'CLM-SMOKE-1307',
  notes: null,
  items: [],
  data: {
    related_inspection_job_id: JOB_ID,
    line_items: [
      { description: 'Roof replacement', quantity: 1, unit: 'EA', rcv: 12345.67 },
    ],
  },
};

const company = {
  id: COMPANY_ID,
  name: 'Claims Defense Smoke Co',
  company_name: 'Claims Defense Smoke Co',
  created_by: USER_EMAIL,
  email: `${PFX}office@companysync.io`,
  phone: '555-0100',
  address: '100 Contractor Way',
  website: null,
  logo_url: null,
  brand_primary_color: '#1e3a8a',
};

const session = {
  passport: { user: { claims: { email: USER_EMAIL, sub: USER_EMAIL } } },
};

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}${detail === undefined ? '' : ` (got: ${JSON.stringify(detail)})`}`);
  }
}

function signSessionId(sid) {
  return `s:${sid}.${crypto.createHmac('sha256', TEST_SESSION_SECRET)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '')}`;
}

function requestForSession() {
  return {
    headers: {
      cookie: `connect.sid=${encodeURIComponent(signSessionId(SESSION_ID))}`,
    },
  };
}

async function main() {
  console.log('\n── Claims Defense Adjuster Email Smoke Test ─────────────────────\n');

  const pg = require('pg');
  const OriginalPool = pg.Pool;
  const transport = require('../lib/emailTransport.cjs');
  const originalSend = transport.sendPlatformEmail;
  const sentMessages = [];
  const queries = [];

  class MockPool {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
      queries.push({ sql: normalized, params });

      let rows;
      if (normalized.startsWith('select sess from sessions')) {
        rows = params[0] === SESSION_ID ? [{ sess: session }] : [];
      } else if (normalized.startsWith('select platform_role, company_id from users')) {
        rows = [];
      } else if (normalized.includes('select is_super_admin, is_administrator, company_id')
          && normalized.includes('from staff_profiles')) {
        rows = [{ is_super_admin: false, is_administrator: true, company_id: COMPANY_ID }];
      } else if (normalized.startsWith('select 1 from companies c')) {
        rows = [{ authorized: 1 }];
      } else if (normalized.startsWith('select company_id from estimates')) {
        rows = params[0] === ESTIMATE_ID ? [{ company_id: COMPANY_ID }] : [];
      } else if (normalized.includes('from estimates where id = $1 limit 1')) {
        rows = params[0] === ESTIMATE_ID ? [estimate] : [];
      } else if (normalized.startsWith('select name, phone, email, address, website, logo_url from companies')) {
        rows = params[0] === COMPANY_ID ? [company] : [];
      } else if (normalized.startsWith('select id from generic_entities')
          && normalized.includes("entity_type = 'inspectionjob'")) {
        rows = params[0] === JOB_ID && params[1] === COMPANY_ID ? [{ id: JOB_ID }] : [];
      } else if (normalized.startsWith('select data from generic_entities')
          && normalized.includes("entity_type = 'inspectionjob'")) {
        rows = params[0] === JOB_ID ? [{ data: inspectionJob.data }] : [];
      } else if (normalized.startsWith('select * from companies')) {
        rows = params[0] === COMPANY_ID ? [company] : [];
      } else if (normalized.startsWith('select data from generic_entities')
          && normalized.includes("entity_type = 'jobmedia'")) {
        rows = [];
      } else {
        throw new Error(`Unexpected SQL in Claims Defense smoke test: ${normalized}`);
      }

      return { rows, rowCount: rows.length };
    }
  }

  process.env.SESSION_SECRET = TEST_SESSION_SECRET;
  pg.Pool = MockPool;
  transport.sendPlatformEmail = async (options) => {
    sentMessages.push(options);
    return { success: true, id: 'claims-defense-smoke-message', provider: 'smoke-test' };
  };

  try {
    const { functionHandlers } = await import('../vite-functions-plugin.js');

    const result = await functionHandlers.sendEstimateEmail({
      estimateId: ESTIMATE_ID,
      to: ADJUSTER_EMAIL,
      emailType: 'adjuster',
      attach_claims_defense: true,
      inspection_job_id: JOB_ID,
      adjusterName: 'Smoke Test Adjuster',
    }, null, requestForSession());

    const sent = sentMessages[0];
    const attachments = sent?.attachments;
    const claimsAttachment = Array.isArray(attachments)
      ? attachments.find((attachment) => /ClaimsDefenseFile.*\.pdf$/i.test(attachment.filename || ''))
      : null;
    const pdfBytes = claimsAttachment?.content
      ? Buffer.from(claimsAttachment.content, 'base64')
      : null;

    check('sendEstimateEmail response does not contain an error', !result?.error, result);
    check('mock estimate is linked to the requested inspection job',
      estimate.data.related_inspection_job_id === JOB_ID, estimate.data);
    check('email transport was called once', sentMessages.length === 1, sentMessages.length);
    check('message was addressed to the adjuster email', sent?.to === ADJUSTER_EMAIL, sent?.to);
    check('email payload contains a non-empty attachments array',
      Array.isArray(attachments) && attachments.length > 0, attachments);
    check('attachments include the Claims Defense PDF', !!claimsAttachment, attachments);
    check('Claims Defense attachment contains a valid non-empty PDF',
      !!pdfBytes && pdfBytes.length > 0 && pdfBytes.subarray(0, 4).toString() === '%PDF',
      claimsAttachment ? { filename: claimsAttachment.filename, bytes: pdfBytes?.length } : null);
    check('PDF generator loaded the linked InspectionJob',
      queries.some(({ sql, params }) =>
        sql.startsWith('select data from generic_entities')
        && sql.includes("entity_type = 'inspectionjob'")
        && params[0] === JOB_ID),
      queries);
  } catch (error) {
    failed++;
    console.error(`\n✗ Unexpected failure: ${error.message}`);
  } finally {
    pg.Pool = OriginalPool;
    transport.sendPlatformEmail = originalSend;
  }

  console.log(`\n── Summary: ${passed} passed, ${failed} failed ─────────────────────`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('\n✗ Fatal test error:', error);
  process.exitCode = 1;
});