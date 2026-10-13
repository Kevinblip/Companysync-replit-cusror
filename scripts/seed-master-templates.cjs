'use strict';
const { createPool } = require('./lib/db-pool.cjs');
const crypto = require('crypto');
const pool = createPool({ connectionString: process.env.DATABASE_URL });

const MASTER_ID = '695944e3c1fb00b7ab716c6f';

const SMS_TEMPLATES = [
  {
    name: 'New Lead Follow-Up',
    category: 'leads',
    body: 'Hi {{customer_name}}! Thanks for reaching out to {{company_name}}. We\'d love to help with your roofing needs. When is a good time for a free inspection? Reply or call us at {{company_phone}}.',
    is_default: true,
  },
  {
    name: 'Appointment Reminder (24hr)',
    category: 'appointments',
    body: 'Hi {{customer_name}}, this is a reminder that your appointment with {{company_name}} is tomorrow at {{appointment_time}}. Reply CONFIRM to confirm or call {{company_phone}} to reschedule.',
    is_default: true,
  },
  {
    name: 'Appointment Reminder (1hr)',
    category: 'appointments',
    body: 'Hi {{customer_name}}! Your {{company_name}} appointment is in about 1 hour. See you at {{appointment_time}}. Questions? Call {{company_phone}}.',
    is_default: true,
  },
  {
    name: 'Estimate Sent',
    category: 'estimates',
    body: 'Hi {{customer_name}}, your estimate from {{company_name}} is ready to review. Click here: {{estimate_link}}. Questions? Reply or call {{company_phone}}.',
    is_default: true,
  },
  {
    name: 'Estimate Follow-Up (3 days)',
    category: 'estimates',
    body: 'Hi {{customer_name}}, just checking in — did you have a chance to review your estimate from {{company_name}}? Happy to answer any questions. Call or text {{company_phone}}.',
    is_default: true,
  },
  {
    name: 'Job Scheduled',
    category: 'jobs',
    body: 'Great news, {{customer_name}}! Your roofing job with {{company_name}} is scheduled for {{job_date}}. Crew arrives between {{start_time}} and {{end_time}}. Questions? {{company_phone}}.',
    is_default: true,
  },
  {
    name: 'Crew On the Way',
    category: 'jobs',
    body: 'Hi {{customer_name}}, your {{company_name}} crew is on their way and will arrive in approximately 30 minutes. Thank you for your business!',
    is_default: true,
  },
  {
    name: 'Job Complete',
    category: 'jobs',
    body: 'Hi {{customer_name}}, your project is complete! Thank you for choosing {{company_name}}. Any questions or concerns? Reply or call {{company_phone}}.',
    is_default: true,
  },
  {
    name: 'Review Request',
    category: 'reviews',
    body: 'Hi {{customer_name}}, we hope you love your new roof! If you have a moment, a quick Google review would mean the world to us: {{review_link}}. Thank you! — {{company_name}}',
    is_default: true,
  },
  {
    name: 'Invoice / Payment Due',
    category: 'payments',
    body: 'Hi {{customer_name}}, your invoice from {{company_name}} for {{invoice_amount}} is due {{due_date}}. Pay online: {{payment_link}} or call {{company_phone}}.',
    is_default: true,
  },
  {
    name: 'Payment Received',
    category: 'payments',
    body: 'Hi {{customer_name}}, we received your payment of {{payment_amount}} — thank you! Your receipt is on file. Questions? {{company_phone}}.',
    is_default: true,
  },
  {
    name: 'Storm Alert Follow-Up',
    category: 'leads',
    body: 'Hi {{customer_name}}, your area was recently hit by a storm. {{company_name}} offers free damage inspections. Want us to take a look? Reply or call {{company_phone}}.',
    is_default: true,
  },
  {
    name: 'Referral Request',
    category: 'reviews',
    body: 'Hi {{customer_name}}, thanks for choosing {{company_name}}! Know anyone else who needs roofing work? We offer referral rewards. Just reply or call {{company_phone}}.',
    is_default: true,
  },
];

const EMAIL_TEMPLATES = [
  {
    name: 'New Lead Welcome',
    category: 'leads',
    subject: 'Thanks for Contacting {{company_name}}!',
    body: '<p>Hi {{customer_name}},</p><p>Thank you for reaching out to <strong>{{company_name}}</strong>! We\'re excited to help with your roofing project.</p><p>A member of our team will be in touch within 24 hours to schedule your free inspection. In the meantime, feel free to call us at {{company_phone}} or reply to this email.</p><p>Best regards,<br>{{company_name}}</p>',
    is_default: true,
  },
  {
    name: 'Appointment Confirmation',
    category: 'appointments',
    subject: 'Your Appointment is Confirmed — {{appointment_date}}',
    body: '<p>Hi {{customer_name}},</p><p>Your appointment with <strong>{{company_name}}</strong> is confirmed for <strong>{{appointment_date}} at {{appointment_time}}</strong>.</p><p>Our representative will meet you at {{property_address}}. Need to reschedule? Call {{company_phone}} or reply to this email.</p><p>See you soon!<br>{{company_name}}</p>',
    is_default: true,
  },
  {
    name: 'Estimate Ready',
    category: 'estimates',
    subject: 'Your Estimate from {{company_name}} is Ready',
    body: '<p>Hi {{customer_name}},</p><p>Your estimate from <strong>{{company_name}}</strong> is ready to review.</p><p><a href="{{estimate_link}}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">View My Estimate</a></p><p>This estimate is valid for 30 days. Questions? Call {{company_phone}} or reply to this email.</p><p>Thank you,<br>{{company_name}}</p>',
    is_default: true,
  },
  {
    name: 'Estimate Follow-Up',
    category: 'estimates',
    subject: 'Following Up on Your {{company_name}} Estimate',
    body: '<p>Hi {{customer_name}},</p><p>I wanted to follow up on the estimate we sent. Have you had a chance to review it?</p><p>We\'re happy to answer questions or adjust anything. View it here: <a href="{{estimate_link}}">{{estimate_link}}</a></p><p>Call {{company_phone}} or reply to this email — we\'re here to help!</p><p>{{company_name}}</p>',
    is_default: true,
  },
  {
    name: 'Job Scheduled Confirmation',
    category: 'jobs',
    subject: 'Your Roofing Job is Scheduled — {{job_date}}',
    body: '<p>Hi {{customer_name}},</p><p>Your roofing project with <strong>{{company_name}}</strong> is officially scheduled.</p><ul><li><strong>Date:</strong> {{job_date}}</li><li><strong>Arrival window:</strong> {{start_time}} – {{end_time}}</li><li><strong>Address:</strong> {{property_address}}</li></ul><p>Please ensure the work area is accessible. Questions? Call {{company_phone}}.</p><p>We look forward to working with you!<br>{{company_name}}</p>',
    is_default: true,
  },
  {
    name: 'Job Complete + Review Request',
    category: 'reviews',
    subject: 'Your Project is Complete — How Did We Do?',
    body: '<p>Hi {{customer_name}},</p><p>Your project with <strong>{{company_name}}</strong> is complete. Thank you for trusting us with your home!</p><p>If you\'re happy with our work, a quick Google review means the world to us:</p><p><a href="{{review_link}}" style="background:#16a34a;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Leave a Google Review</a></p><p>If anything isn\'t right, call us at {{company_phone}} — we stand behind our work.</p><p>Thank you again,<br>{{company_name}}</p>',
    is_default: true,
  },
  {
    name: 'Invoice Sent',
    category: 'payments',
    subject: 'Invoice #{{invoice_number}} from {{company_name}}',
    body: '<p>Hi {{customer_name}},</p><p>Your invoice from <strong>{{company_name}}</strong> is ready.</p><ul><li><strong>Invoice #:</strong> {{invoice_number}}</li><li><strong>Amount Due:</strong> {{invoice_amount}}</li><li><strong>Due Date:</strong> {{due_date}}</li></ul><p><a href="{{payment_link}}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Pay Online Now</a></p><p>Questions? Reply or call {{company_phone}}.</p><p>Thank you,<br>{{company_name}}</p>',
    is_default: true,
  },
  {
    name: 'Payment Received / Receipt',
    category: 'payments',
    subject: 'Payment Received — Thank You!',
    body: '<p>Hi {{customer_name}},</p><p>We received your payment of <strong>{{payment_amount}}</strong>. Thank you!</p><p>Your receipt is on file. Questions about your account? Contact us at {{company_phone}}.</p><p>We appreciate your business!<br>{{company_name}}</p>',
    is_default: true,
  },
  {
    name: 'Storm Damage Outreach',
    category: 'leads',
    subject: 'Free Storm Damage Inspection — {{company_name}}',
    body: '<p>Hi {{customer_name}},</p><p>Recent storms in your area may have caused damage that isn\'t visible from the ground.</p><p><strong>{{company_name}}</strong> is offering <strong>free storm damage inspections</strong> with no obligation. We\'ll assess any damage and provide a full report.</p><p>To schedule, call {{company_phone}} or reply to this email.</p><p>{{company_name}}</p>',
    is_default: true,
  },
  {
    name: 'Referral Thank You',
    category: 'reviews',
    subject: 'Thank You for Your Referral!',
    body: '<p>Hi {{customer_name}},</p><p>Thank you for referring {{referral_name}} to {{company_name}}! Your trust means everything to us.</p><p>We\'ll take great care of them, just as we did with you.</p><p>Any future roofing needs? We\'re always here: {{company_phone}}.</p><p>With gratitude,<br>{{company_name}}</p>',
    is_default: true,
  },
];

async function seed() {
  const { rows: existingSMS } = await pool.query(
    `SELECT data->>'name' AS name FROM generic_entities WHERE entity_type='SMSTemplate' AND company_id=$1`,
    [MASTER_ID]
  );
  const { rows: existingEmail } = await pool.query(
    `SELECT data->>'name' AS name FROM generic_entities WHERE entity_type='EmailTemplate' AND company_id=$1`,
    [MASTER_ID]
  );
  const existingSMSNames = new Set(existingSMS.map(r => r.name));
  const existingEmailNames = new Set(existingEmail.map(r => r.name));

  let smsAdded = 0, emailAdded = 0;

  for (const t of SMS_TEMPLATES) {
    if (!existingSMSNames.has(t.name)) {
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'SMSTemplate', $2, $3::jsonb, NOW(), NOW())`,
        [crypto.randomUUID(), MASTER_ID, JSON.stringify(t)]
      );
      smsAdded++;
    }
  }

  for (const t of EMAIL_TEMPLATES) {
    if (!existingEmailNames.has(t.name)) {
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'EmailTemplate', $2, $3::jsonb, NOW(), NOW())`,
        [crypto.randomUUID(), MASTER_ID, JSON.stringify(t)]
      );
      emailAdded++;
    }
  }

  console.log(`SMS templates added: ${smsAdded}`);
  console.log(`Email templates added: ${emailAdded}`);
  await pool.end();
}

seed().catch(e => { console.error(e.message); process.exit(1); });
