const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const PLATFORM_WORKFLOWS = [
  {
    id: 'wf_new_lead_welcome',
    name: 'New Lead Welcome',
    trigger_type: 'lead_created',
    description: 'Instantly emails the homeowner confirming receipt and creates an internal 24-hour follow-up task.',
    actions: [
      { action_type: 'send_email', label: 'Instant welcome email', recipient: '{{customer_email}}', email_subject: 'Thanks for reaching out — {{company_name}}', email_body: 'Hi {{customer_name}},\n\nThank you for contacting us! We received your info and a member of our team will be in touch within 24 hours.\n\nIf you need to reach us sooner, call or text anytime:\n\n{{company_phone}} | {{company_email}}\n\nWe look forward to helping you.\n\n{{company_name}}' },
      { action_type: 'create_task', label: 'Internal: follow up within 24h', task_title: 'Follow up with new lead: {{customer_name}}', task_description: 'New lead received. Reach out within 24 hours.\nPhone: {{customer_phone}}\nEmail: {{customer_email}}', config: { priority: 'high', due_in_days: 1 } }
    ]
  },
  {
    id: 'wf_estimate_accepted_kickoff',
    name: 'Estimate Accepted — Job Kickoff',
    trigger_type: 'estimate_accepted',
    description: 'When a customer accepts an estimate, sends a congratulations email and creates a scheduling task.',
    actions: [
      { action_type: 'send_email', label: 'Congratulations + next steps email', recipient: '{{customer_email}}', email_subject: "You're on our schedule — {{company_name}}", email_body: "Hi {{customer_name}},\n\nGreat news — your estimate has been accepted and you're officially on our schedule!\n\nHere's what happens next:\n1. Our project manager will call you within 24 hours to confirm your start date\n2. We'll send you a reminder the day before we begin\n3. Our crew will arrive on time and take great care of your property\n\nEstimate Total: ${{amount}}\n\nAny questions before we start — don't hesitate to reach out.\n\nTalk soon,\n{{sender_first_name}}\n{{company_name}}\n{{company_phone}} | {{company_email}}" },
      { action_type: 'create_task', label: 'Internal: schedule start date', task_title: 'Schedule job — {{customer_name}} (Est. {{estimate_number}})', task_description: 'Customer accepted. Call to confirm start date and assign crew.\nAmount: ${{amount}}\nCustomer: {{customer_phone}} | {{customer_email}}', config: { priority: 'high', due_in_days: 1 } }
    ]
  },
  {
    id: 'wf_invoice_payment_reminders',
    name: 'Invoice Payment Reminder Sequence',
    trigger_type: 'invoice_sent',
    description: 'After an invoice is sent, follows up at Day 3 (email), Day 7 (SMS), and Day 14 (final notice).',
    actions: [
      { action_type: 'delay', label: 'Wait 3 days', delay_minutes: 4320 },
      { action_type: 'send_email', label: 'Day 3 — Friendly reminder', recipient: '{{customer_email}}', email_subject: 'Invoice reminder — {{invoice_number}}', email_body: 'Hi {{customer_name}},\n\nJust a friendly reminder that invoice {{invoice_number}} for ${{amount}} is due.\n\nIf you have any questions or need to arrange a payment plan, just reply to this email or give us a call.\n\n{{company_name}}\n{{company_phone}} | {{company_email}}' },
      { action_type: 'delay', label: 'Wait 4 more days', delay_minutes: 5760 },
      { action_type: 'send_sms', label: 'Day 7 — SMS reminder', recipient: '{{customer_phone}}', sms_message: 'Hi {{customer_name}}, this is {{company_name}}. Invoice {{invoice_number}} (${{amount}}) is past due. Please call us at {{company_phone}} or reply here.' },
      { action_type: 'delay', label: 'Wait 7 more days', delay_minutes: 10080 },
      { action_type: 'send_email', label: 'Day 14 — Final notice', recipient: '{{customer_email}}', email_subject: 'Final notice: Invoice {{invoice_number}} is overdue — {{company_name}}', email_body: 'Hi {{customer_name}},\n\nThis is a final notice that invoice {{invoice_number}} for ${{amount}} remains unpaid.\n\nPlease give us a call at {{company_phone}} to resolve this.\n\n{{company_name}}' },
      { action_type: 'create_task', label: 'Escalate overdue invoice internally', task_title: 'OVERDUE INVOICE: {{customer_name}} — {{invoice_number}}', task_description: 'Invoice 14+ days overdue. Manual follow-up required.\nAmount: ${{amount}}\nCustomer: {{customer_phone}} | {{customer_email}}', config: { priority: 'urgent' } }
    ]
  },
  {
    id: 'wf_invoice_paid_thankyou',
    name: 'Invoice Paid — Thank You + Review Request',
    trigger_type: 'invoice_paid',
    description: 'When an invoice is paid, sends a thank you email and a follow-up review request 24 hours later.',
    actions: [
      { action_type: 'send_email', label: 'Immediate thank you', recipient: '{{customer_email}}', email_subject: 'Payment received — thank you! — {{company_name}}', email_body: "Hi {{customer_name}},\n\nWe received your payment of ${{amount}} — thank you!\n\nIt was truly a pleasure working with you. If you ever need anything in the future, we hope you'll think of us first.\n\nWarm regards,\n{{sender_first_name}}\n{{company_name}}\n{{company_phone}} | {{company_email}}" },
      { action_type: 'delay', label: 'Wait 24 hours', delay_minutes: 1440 },
      { action_type: 'send_email', label: 'Review request', recipient: '{{customer_email}}', email_subject: 'A quick favor — would you leave us a review?', email_body: "Hi {{customer_name}},\n\nWe hope you're happy with our work! Reviews from homeowners like you help us grow and serve more people in the community.\n\nIf you have 60 seconds, we'd be grateful:\n\nLeave us a Google Review\n\nThank you so much,\n{{sender_first_name}}\n{{company_name}}" }
    ]
  },
  {
    id: 'wf_job_completed_review_referral',
    name: 'Job Completed — Review & Referral Sequence',
    trigger_type: 'job_completed',
    description: 'After a job is marked complete: sends a day-of thank you, Day 3 review request, and Day 7 referral ask.',
    actions: [
      { action_type: 'send_email', label: 'Job complete thank you', recipient: '{{customer_email}}', email_subject: 'Your project is complete — {{company_name}}', email_body: "Hi {{customer_name}},\n\nYour project is officially complete! We hope everything looks great.\n\nIf you notice anything in the next few days that needs attention, please don't hesitate to reach out. We stand behind our work.\n\n{{company_name}}\n{{company_phone}} | {{company_email}}" },
      { action_type: 'delay', label: 'Wait 3 days', delay_minutes: 4320 },
      { action_type: 'send_email', label: 'Day 3 — Review request', recipient: '{{customer_email}}', email_subject: 'How did we do? — {{company_name}}', email_body: "Hi {{customer_name}},\n\nWe hope you're loving the finished project! Would you take a minute to share your experience?\n\nYour review means the world to our small business.\n\nThank you!\n{{sender_first_name}}\n{{company_name}}" },
      { action_type: 'delay', label: 'Wait 4 more days', delay_minutes: 5760 },
      { action_type: 'send_email', label: 'Day 7 — Referral ask', recipient: '{{customer_email}}', email_subject: 'Know anyone who needs roofing help?', email_body: 'Hi {{customer_name}},\n\nA quick note — if you know anyone who needs roofing work, we would love to help them too.\n\nJust have them mention your name when they call and we will take great care of them.\n\nThank you for your trust!\n{{company_name}}\n{{company_phone}}' }
    ]
  },
  {
    id: 'wf_lead_no_contact_48h',
    name: 'Lead No-Contact Escalation (48h)',
    trigger_type: 'lead_created',
    description: 'If a new lead has not been contacted after 48 hours, creates an urgent internal task for the sales team.',
    actions: [
      { action_type: 'delay', label: 'Wait 48 hours', delay_minutes: 2880 },
      { action_type: 'create_task', label: 'URGENT: Lead not contacted in 48h', task_title: 'URGENT: Lead not contacted — {{customer_name}}', task_description: 'This lead has not been contacted in 48+ hours.\nPhone: {{customer_phone}}\nEmail: {{customer_email}}\nSource: {{lead_source}}\n\nPlease reach out immediately.', config: { priority: 'urgent', due_in_days: 0 } }
    ]
  },
  {
    id: 'wf_inspection_appointment_reminder',
    name: 'Inspection Appointment Reminder',
    trigger_type: 'inspection_scheduled',
    description: 'When an inspection is scheduled: sends a confirmation email immediately and a reminder 24 hours before.',
    actions: [
      { action_type: 'send_email', label: 'Appointment confirmation', recipient: '{{customer_email}}', email_subject: 'Appointment confirmed — {{company_name}}', email_body: 'Hi {{customer_name}},\n\nYour inspection appointment is confirmed!\n\nDate/Time: {{appointment_date}} at {{appointment_time}}\nAddress: {{property_address}}\n\nOur inspector will arrive on time. Please ensure someone is home and the roof is accessible.\n\nQuestions? Call us anytime:\n{{company_phone}}\n\n{{company_name}}' },
      { action_type: 'delay', label: 'Wait until 24h before appointment', delay_minutes: 1440 },
      { action_type: 'send_email', label: '24h reminder', recipient: '{{customer_email}}', email_subject: 'Reminder: Inspection tomorrow — {{company_name}}', email_body: 'Hi {{customer_name}},\n\nJust a reminder — your roof inspection is tomorrow!\n\nDate/Time: {{appointment_date}} at {{appointment_time}}\nAddress: {{property_address}}\n\nSee you then!\n{{company_name}}\n{{company_phone}}' }
    ]
  },
  {
    id: 'wf_cold_lead_reengagement',
    name: 'Cold Lead Re-Engagement (30 & 60 Day)',
    trigger_type: 'lead_created',
    description: 'For leads that go quiet, sends a re-engagement email at 30 days and a final check-in at 60 days.',
    actions: [
      { action_type: 'delay', label: 'Wait 30 days', delay_minutes: 43200 },
      { action_type: 'send_email', label: 'Day 30 — Re-engagement', recipient: '{{customer_email}}', email_subject: 'Still thinking about your roof? — {{company_name}}', email_body: "Hi {{customer_name}},\n\nWe reached out a while back and wanted to check in — no pressure at all.\n\nIf you're still thinking about your roof and have questions about timing, cost, or insurance, we're happy to answer anything, completely free.\n\n{{sender_first_name}}\n{{company_name}}\n{{company_phone}} | {{company_email}}" },
      { action_type: 'delay', label: 'Wait 30 more days', delay_minutes: 43200 },
      { action_type: 'send_email', label: 'Day 60 — Final check-in', recipient: '{{customer_email}}', email_subject: 'One last check-in — {{company_name}}', email_body: "Hi {{customer_name}},\n\nWe don't want to keep cluttering your inbox, so this will be our last check-in.\n\nIf you ever decide to move forward — whether that's next month or next year — we're here and we'd love to earn your business.\n\nSave our number: {{company_phone}}\n\nWishing you the best,\n{{sender_first_name}}\n{{company_name}}" }
    ]
  },
  {
    id: 'wf_storm_damage_outreach',
    name: 'Storm Damage Lead Outreach',
    trigger_type: 'storm_detected',
    description: 'When a storm is detected in the service area, sends an outreach email to recent leads offering a free inspection.',
    actions: [
      { action_type: 'send_email', label: 'Storm outreach email', recipient: '{{customer_email}}', email_subject: 'Free roof inspection after recent storms — {{company_name}}', email_body: 'Hi {{customer_name}},\n\nWe wanted to reach out because recent storms in your area may have caused roof damage that is not always visible from the ground — but can lead to costly leaks if left unchecked.\n\nWe are offering free storm damage inspections right now. No cost, no obligation, and you will get an honest assessment.\n\nCall or text us to schedule:\n{{company_phone}}\n\nSpots fill up fast after a storm, so do not wait too long.\n\n{{company_name}}\n{{company_phone}} | {{company_email}} | {{company_website}}' }
    ]
  }
];

async function setupForCompany(companyId) {
  let created = 0, skipped = 0;
  for (const wf of PLATFORM_WORKFLOWS) {
    const wfId = wf.id + '_' + companyId;
    const exists = await pool.query('SELECT id FROM generic_entities WHERE id = $1', [wfId]);
    if (exists.rows.length > 0) { skipped++; continue; }
    const wfData = JSON.stringify({ ...wf, is_active: true, status: 'active', company_id: companyId, created_by: 'platform' });
    await pool.query(
      'INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())',
      [wfId, 'Workflow', companyId, wfData]
    );
    created++;
  }
  console.log('  company=' + companyId + ': created=' + created + ', skipped=' + skipped);
}

const companies = ['company_1773134457829_n4liw6p5w', 'companysync_master_001'];

(async () => {
  console.log('Setting up default workflows for all tenant companies...');
  for (const cid of companies) {
    await setupForCompany(cid);
  }
  const count = await pool.query("SELECT COUNT(*) FROM generic_entities WHERE entity_type = 'Workflow'");
  console.log('Total workflows now:', count.rows[0].count);
  pool.end();
})().catch(e => { console.error(e.message); pool.end(); });
