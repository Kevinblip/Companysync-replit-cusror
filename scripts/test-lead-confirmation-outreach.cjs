#!/usr/bin/env node
/**
 * Lead confirmation outreach contract check.
 *
 * This protects the business rules that must not drift: Alex uses the shared
 * guarded sender, a homeowner response stops the call, and both development and
 * production schedule the same check.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const functions = read('vite-functions-plugin.js');
const settings = read('src/pages/SarahSettings.jsx');
const leads = read('src/pages/Leads.jsx');
const devCron = read('vite-cron-plugin.js');
const prodCron = read('prod-server.cjs');

let passed = 0;
function check(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    return;
  }
  passed++;
  console.log(`PASS: ${message}`);
}

const blockStart = functions.indexOf('async processLeadConfirmationOutreach');
const blockEnd = functions.indexOf('async checkStaleLeads', blockStart);
const outreach = functions.slice(blockStart, blockEnd);

check(blockStart >= 0 && blockEnd > blockStart, 'scheduled lead outreach handler exists');
check(outreach.includes("functionHandlers.sendCustomerReminder({"), 'both lead messages use the shared guarded sender');
check(outreach.includes("channel: 'text'"), 'the first contact is a text');
check(outreach.includes("channel: 'call'"), 'the no-reply escalation is an AI call');
check(outreach.includes("row.direction === 'inbound'"), 'an inbound homeowner reply prevents escalation');
check(outreach.includes("communicationData?.event !== 'alex_lead_outreach'"), 'a staff contact prevents escalation without mistaking Alex’s own text for a reply');
check(outreach.includes("related_lead=$2") && outreach.includes('We’re confirming your roofing inspection'), 'scheduled inspections produce an address-aware confirmation');
check(outreach.includes('We received your roofing inspection request'), 'unscheduled leads receive a scheduling confirmation');
check(outreach.includes("sendResult?.skipped === 'opted_out'"), 'STOP status prevents further outreach');
check(outreach.includes("alex_outreach_status\":\"text_sending") && outreach.includes("alex_outreach_status\":\"calling"), 'outbound text and call are claimed before delivery to avoid duplicates');
check(functions.includes("outreachType: context.outreachType") && functions.includes("leadId: context.leadId"), 'texts are linked to the lead’s communication history');
check(functions.includes("SELECT 1 FROM communications") && functions.includes("dedicatedOpt"), 'STOP checks include the live communications history');
check(settings.includes('lead_confirmation_outreach_enabled: false') && settings.includes('lead_confirmation_wait_minutes: 30'), 'company settings default to manual enrollment and a 30-minute wait');
check(settings.includes('switch-lead-confirmation-outreach') && settings.includes('switch-lead-confirmation-auto-enroll'), 'owners can control the outreach and future auto-enrollment');
check(leads.includes("setLeadConfirmationOutreach") && leads.includes('switch-lead-alex-outreach'), 'staff have a per-lead Alex outreach switch');
check(leads.includes("maybeEnrollNewLeadConfirmationOutreach"), 'new lead creation honors the optional auto-enrollment setting');
check(devCron.includes("name: 'processLeadConfirmationOutreach'"), 'development scheduler runs the outreach check');
check(devCron.includes("'x-cron-token': cronToken") && devCron.includes("internal-cron-2026"), 'development scheduler authenticates the protected outreach check');
check(prodCron.includes("callInternalFunction('processLeadConfirmationOutreach'"), 'production scheduler runs the outreach check');

if (!process.exitCode) console.log(`\n${passed} lead-confirmation outreach safeguards verified.`);