const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const TOKEN_EXPIRY_HOURS = 24;

function getAppUrl(req) {
  const fallback = process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com';
  if (req && req.headers && req.headers.host) {
    const host = req.headers.host;
    const isTrusted = ALLOWED_ORIGINS.some(o => o.includes(host)) ||
      host.endsWith('.replit.app') ||
      host.endsWith('.replit.dev');
    if (isTrusted) {
      const proto = req.headers['x-forwarded-proto'] || 'https';
      return `${proto}://${host}`;
    }
  }
  return fallback;
}

const ALLOWED_ORIGINS = [
  'https://getcompanysync.com',
  'https://company-sync-crm-bf62df1e.base44.app',
  'https://companysync.io',
  'https://www.companysync.io',
];

function setCorsHeaders(res, req) {
  const origin = req?.headers?.origin || '';
  const isAllowed = origin && (
    ALLOWED_ORIGINS.some(a => origin === a) ||
    origin.endsWith('.replit.app') ||
    origin.endsWith('.replit.dev') ||
    origin.endsWith('.picard.replit.dev')
  );
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function generateId() {
  return 'loc_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

function signSessionId(sid, secret) {
  const sig = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return 's:' + sid + '.' + sig;
}

async function sendEmail(to, subject, html) {
  const fromAddr = process.env.EMAIL_FROM || 'CompanySync <io.companysync@gmail.com>';

  // Try SMTP (nodemailer) first
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (smtpHost && smtpUser && smtpPass) {
    try {
      const smtpPort = parseInt(process.env.SMTP_PORT || '587');
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
        tls: { rejectUnauthorized: false },
      });
      const info = await transporter.sendMail({ from: fromAddr, to, subject, html });
      console.log('[LocalAuth] Email sent via SMTP:', info.messageId, '→', to);
      return true;
    } catch (e) {
      console.error('[LocalAuth] SMTP send failed, falling back to Resend:', e.message);
    }
  }

  // Fallback: Resend API
  if (!RESEND_API_KEY) {
    console.error('[LocalAuth] No email provider configured (SMTP_HOST or RESEND_API_KEY required)');
    return false;
  }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddr,
        to: [to],
        subject,
        html,
      }),
    });
    const respBody = await resp.text();
    if (!resp.ok) {
      console.error('[LocalAuth] Resend email failed:', resp.status, respBody);
      return false;
    }
    console.log('[LocalAuth] Email sent via Resend to', to);
    return true;
  } catch (e) {
    console.error('[LocalAuth] Email send error:', e.message);
    return false;
  }
}

async function createSession(pool, userId, email, firstName, lastName, companyId) {
  const sid = crypto.randomUUID();
  const sessionData = {
    cookie: {
      originalMaxAge: SESSION_MAX_AGE,
      expires: new Date(Date.now() + SESSION_MAX_AGE).toISOString(),
      secure: true,
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
    },
    passport: {
      user: {
        claims: {
          sub: userId,
          email: email,
          first_name: firstName || '',
          last_name: lastName || '',
          full_name: `${firstName || ''} ${lastName || ''}`.trim() || email,
          profile_image_url: null,
        },
        access_token: null,
        refresh_token: null,
        expires_at: Math.floor(Date.now() / 1000) + (SESSION_MAX_AGE / 1000),
      },
    },
  };

  const expireAt = new Date(Date.now() + SESSION_MAX_AGE);
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = $2, expire = $3`,
    [sid, JSON.stringify(sessionData), expireAt]
  );

  return sid;
}

function setSessionCookie(res, sid) {
  const signed = signSessionId(sid, SESSION_SECRET);
  const encoded = encodeURIComponent(signed);
  const expires = new Date(Date.now() + SESSION_MAX_AGE).toUTCString();
  const cookie = `connect.sid=${encoded}; Path=/; Expires=${expires}; HttpOnly; SameSite=Lax; Secure`;
  res.setHeader('Set-Cookie', cookie);
}

function parseBody(req) {
  if (req.body) return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function handleSignup(req, res, pool) {
  setCorsHeaders(res, req);
  try {
    const { email, company_name, password } = await parseBody(req);

    if (!email || !company_name || !password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Email, company name, and password are required' }));
      return;
    }

    const emailLower = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailLower)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Please enter a valid email address' }));
      return;
    }

    if (password.length < 8) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Password must be at least 8 characters' }));
      return;
    }

    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [emailLower]);
    if (existingUser.rows.length > 0) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'An account with this email already exists. Please log in instead.' }));
      return;
    }

    // CRITICAL: Check if this email was already invited as a staff member at an existing company.
    // If so, link them to that company instead of creating a brand new one.
    const existingStaffProfile = await pool.query(
      `SELECT sp.company_id, sp.role, sp.is_administrator, c.name as company_name_actual
       FROM staff_profiles sp
       LEFT JOIN companies c ON c.id = sp.company_id
       WHERE LOWER(sp.user_email) = $1 AND sp.is_active = true
       ORDER BY sp.created_at ASC LIMIT 1`,
      [emailLower]
    );

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = generateId();

    if (existingStaffProfile.rows.length > 0) {
      // This person was invited — link them to the existing company, don't create a new one
      const staffRow = existingStaffProfile.rows[0];
      const existingCompanyId = staffRow.company_id;
      await pool.query(
        `INSERT INTO users (id, email, first_name, last_name, password_hash, is_local_auth, must_change_password, company_id, created_at, updated_at)
         VALUES ($1, $2, '', '', $3, true, false, $4, NOW(), NOW())`,
        [userId, emailLower, passwordHash, existingCompanyId]
      );
      console.log('[LocalAuth] Signup: linked invited staff', emailLower, 'to existing company:', existingCompanyId);
      const sid = await createSession(pool, userId, emailLower, '', '', existingCompanyId);
      setSessionCookie(res, sid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, redirect: '/' }));
      return;
    }

    // New company signup — create company, user, and admin staff profile
    const companyId = generateId();
    const companyNameTrimmed = company_name.trim();
    const trialEndDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO companies (id, name, company_name, email, created_by, subscription_plan, subscription_status, trial_end_date, created_at, updated_at)
       VALUES ($1, $2, $2, $3, $3, 'trial', 'trial', $4, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [companyId, companyNameTrimmed, emailLower, trialEndDate]
    );

    await pool.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, is_local_auth, must_change_password, company_id, created_at, updated_at)
       VALUES ($1, $2, '', '', $3, true, false, $4, NOW(), NOW())`,
      [userId, emailLower, passwordHash, companyId]
    );

    await pool.query(
      `INSERT INTO staff_profiles (id, company_id, email, user_email, role, is_administrator, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $3, 'admin', true, true, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [generateId(), companyId, emailLower]
    );

    // Setup default automation workflows for new tenant (non-blocking)
    setupDefaultWorkflows(pool, companyId).catch(e => {
      console.warn('[LocalAuth] Workflow setup failed:', e.message);
    });

    const sid = await createSession(pool, userId, emailLower, '', '', companyId);
    setSessionCookie(res, sid);

    // Send welcome email (non-blocking)
    const appUrl = getAppUrl(req);
    sendWelcomeEmail(emailLower, companyNameTrimmed, appUrl, trialEndDate).catch(e => {
      console.warn('[LocalAuth] Welcome email failed:', e.message);
    });

    console.log('[LocalAuth] Signup success for', emailLower, 'company:', companyNameTrimmed, 'trial ends:', trialEndDate.toISOString().slice(0,10));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, redirect: '/QuickSetup?new_signup=true' }));
  } catch (e) {
    console.error('[LocalAuth] Signup error:', e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'An unexpected error occurred. Please try again.' }));
  }
}

async function setupDefaultWorkflows(pool, companyId) {
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
        { action_type: 'send_email', label: 'Review request', recipient: '{{customer_email}}', email_subject: 'A quick favor — would you leave us a review?', email_body: "Hi {{customer_name}},\n\nWe hope you're happy with our work! Reviews from homeowners like you help us grow and serve more people in the community.\n\nIf you have 60 seconds, we'd be grateful — leave us a review!\n\nThank you so much,\n{{sender_first_name}}\n{{company_name}}" }
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

  const CUSTOM_WORKFLOWS = [
    { workflow_name: "New Lead Welcome Sequence", description: "Automatically welcome new leads and nurture them", trigger_type: "lead_created", is_active: true, actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"lead","email_subject":"Welcome to {company_name} - Your Free Inspection Awaits!","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px;'><div style='background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center;'><h1 style='color: white;'>Welcome to {company_name}!</h1></div><div style='padding: 30px 20px;'><h2>Hi {lead_name},</h2><p>Thank you for reaching out! We're excited to help with your roofing project.</p><p>Questions? Call us at {company_phone}</p></div></div>"},{"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":15,"recipient":"lead","sms_message":"Hi {lead_name}! This is {company_name}. Thanks for your interest! Free inspection available. Call/text {company_phone} 😊"},{"step":3,"action_type":"create_task","schedule_type":"delay","delay_minutes":1440,"recipient":"owner","task_title":"PRIORITY: Call {lead_name} - New Lead Follow-Up","task_description":"NEW LEAD - Call to schedule free inspection\n\nLead: {lead_name}\nPhone: {lead_phone}\nEmail: {lead_email}\n\nTalk about:\n- Thank them for interest\n- Ask about roofing concerns\n- Emphasize FREE inspection\n- Schedule within 48 hours"}] },
    { workflow_name: "30-Day Lead Nurture Campaign", description: "Automated multi-week follow-up sequence for new leads", trigger_type: "lead_created", is_active: true, folder: "Marketing Automations", actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"lead","email_subject":"Welcome! Let's Get Started with Your Roofing Project","email_body":"Hi {contact_name},\n\nThank you for reaching out! We're excited to help you with your roofing needs.\n\nAt {company_name}, we specialize in high-quality roofing solutions.\n\n🏠 What happens next?\n• One of our experts will contact you within 24 hours\n• We'll schedule a FREE inspection at your convenience\n• You'll receive a detailed estimate with no obligation\n\nBest regards,\n{company_name} Team"},{"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":60,"recipient":"lead","sms_message":"Hi {contact_name}! This is {company_name}. Thanks for your interest! We'll be in touch within 24 hours to schedule your FREE roof inspection."},{"step":3,"action_type":"create_task","schedule_type":"delay","delay_minutes":1440,"recipient":"owner","task_title":"Follow up with {contact_name} - New Lead","task_description":"Call {contact_name} to schedule their FREE roof inspection."},{"step":4,"action_type":"send_email","schedule_type":"delay","delay_minutes":4320,"recipient":"lead","email_subject":"Why Homeowners Trust {company_name} for Their Roofing Needs","email_body":"Hi {contact_name},\n\nWe wanted to share what makes {company_name} different:\n\n✅ Licensed & Fully Insured\n✅ A+ BBB Rating\n✅ Lifetime Workmanship Warranty\n✅ Free Inspections & Estimates\n\nReady to get started? Just reply or give us a call.\n\nBest,\n{company_name}"},{"step":5,"action_type":"send_sms","schedule_type":"delay","delay_minutes":10080,"recipient":"lead","sms_message":"Hi {contact_name}, just checking in! Have you had a chance to think about your roofing project? We'd love to provide a FREE estimate. Reply YES to schedule!"},{"step":6,"action_type":"send_email","schedule_type":"delay","delay_minutes":20160,"recipient":"lead","email_subject":"Don't Let Roof Damage Cost You Thousands Later","email_body":"Hi {contact_name},\n\nSmall roof issues can quickly turn into expensive repairs. Our FREE inspection includes:\n✓ Complete roof assessment\n✓ Photo documentation\n✓ Detailed written report\n✓ Free estimate for any needed repairs\n\nProtect your biggest investment. Schedule today!\n\nBest,\n{company_name}"},{"step":7,"action_type":"create_task","schedule_type":"delay","delay_minutes":43200,"recipient":"owner","task_title":"FINAL FOLLOW-UP: {contact_name} - 30 Day Nurture Complete","task_description":"This lead has completed the 30-day nurture campaign without converting.\n\nAction items:\n1. Make one final personal call\n2. If no response, move to long-term nurture list\n3. Update lead status accordingly"}] },
    { workflow_name: "Emergency Storm Response", description: "Reach out to leads after major storms", trigger_type: "lead_created", is_active: true, actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"lead","email_subject":"🚨 Storm Damage? {company_name} is Here to Help!","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px;'><div style='background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); padding: 40px 20px; text-align: center;'><h1 style='color: white;'>🚨 Storm Emergency Response</h1></div><div style='padding: 30px 20px;'><h2>Hi {lead_name},</h2><p>We're here to help with any storm damage! FREE inspections available. EMERGENCY HOTLINE: {company_phone} (24/7)</p></div></div>"},{"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":30,"recipient":"lead","sms_message":"🚨 Storm damage? {company_name} offers FREE inspections + insurance help. Call 24/7: {company_phone}"},{"step":3,"action_type":"create_task","schedule_type":"delay","delay_minutes":60,"recipient":"owner","task_title":"🚨 URGENT: Storm Lead - {lead_name}","task_description":"STORM LEAD - HIGH PRIORITY:\n- Call within 1 hour\n- Offer FREE inspection TODAY\n- Mention insurance assistance\n- Schedule ASAP"}] },
    { workflow_name: "Lost Lead Win-Back Campaign", description: "One last attempt to win back leads marked as lost", trigger_type: "lead_created", is_active: true, actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":20160,"recipient":"lead","email_subject":"One Last Chance - Special Offer from {company_name}","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px;'><div style='background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 40px 20px; text-align: center;'><h1 style='color: white;'>We Want to Earn Your Business!</h1></div><div style='padding: 30px 20px;'><h2>Hi {lead_name},</h2><p>We'd love one more chance to prove our value! Special 10% discount available for 7 days.</p></div></div>"},{"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":20880,"recipient":"lead","sms_message":"Last chance! {company_name} offering 10% OFF just for you. 7 days only. Call now: {company_phone}"}] },
    { workflow_name: "Estimate Accepted - Thank You", description: "Thank customer and set expectations after estimate acceptance", trigger_type: "estimate_accepted", is_active: true, actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"customer","email_subject":"Thank You for Choosing {company_name}! 🎉","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px;'><div style='background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 20px; text-align: center;'><h1 style='color: white;'>Thank You! 🎉</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p>We're thrilled you chose {company_name}! We'll call you within 24 hours to schedule your project.</p><p>Questions? Call us at {company_phone}</p></div></div>"},{"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":5,"recipient":"customer","sms_message":"🎉 Thank you for choosing {company_name}! We'll call you within 24 hours to schedule your project. {company_phone}"},{"step":3,"action_type":"create_task","schedule_type":"delay","delay_minutes":60,"recipient":"owner","task_title":"URGENT: Schedule Project for {customer_name}","task_description":"ESTIMATE ACCEPTED!\n\nCustomer: {customer_name}\nEstimate: {estimate_number}\nAmount: {amount}\n\nTO-DO:\n- Call customer ASAP\n- Schedule project start date\n- Confirm crew availability"}] },
    { workflow_name: "Estimate Sent Follow-Up", description: "Follow up after sending an estimate to increase conversion", trigger_type: "estimate_created", is_active: true, actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":0,"recipient":"customer","email_subject":"Your {company_name} Estimate #{estimate_number} is Ready!","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px;'><div style='background: #1f2937; padding: 30px 20px; text-align: center;'><h1 style='color: white;'>Your Estimate is Ready!</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p>Your detailed estimate is ready for review. Questions? Call us at {company_phone}</p></div></div>"},{"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":1440,"recipient":"customer","sms_message":"Hi {customer_name}! Did you get a chance to review your estimate from {company_name}? Any questions? {company_phone}"},{"step":3,"action_type":"create_task","schedule_type":"delay","delay_minutes":4320,"recipient":"owner","task_title":"Follow Up: {customer_name} - Estimate #{estimate_number}","task_description":"ESTIMATE FOLLOW-UP\n\nCustomer: {customer_name}\nEstimate: {estimate_number}\nAmount: {amount}\n\nAction Items:\n- Call to discuss estimate\n- Answer any questions\n- Try to close the deal"}] },
    { workflow_name: "Abandoned Estimate Recovery", description: "Win back customers who have not accepted estimates", trigger_type: "estimate_created", is_active: true, actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":10080,"recipient":"customer","email_subject":"Still Thinking About Your Roofing Project? Let's Talk!","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px;'><div style='background: #8b5cf6; padding: 30px 20px; text-align: center;'><h1 style='color: white;'>We Miss You!</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p>We noticed you haven't moved forward with your estimate yet. Schedule within 3 days and receive 5% off!</p></div></div>"},{"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":10800,"recipient":"customer","sms_message":"Hi {customer_name}! Still interested in your roofing project? {company_name} offering 5% off if you book this week! {company_phone}"},{"step":3,"action_type":"create_task","schedule_type":"delay","delay_minutes":11520,"recipient":"owner","task_title":"Win-Back Call: {customer_name}","task_description":"ESTIMATE ABANDONED - WIN BACK\n\nCustomer: {customer_name}\nEstimate: {estimate_number}\n\nRECOVERY STRATEGY:\n- Call to understand concerns\n- Address pricing objections\n- Offer 5% discount (expires soon)"}] },
    { workflow_name: "Project Completion Follow-Up", description: "Thank customer and request review after project completion", trigger_type: "project_completed", is_active: true, actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":1440,"recipient":"customer","email_subject":"Thank You from {company_name}! How Did We Do?","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px;'><div style='background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 20px; text-align: center;'><h1 style='color: white;'>Project Complete! 🎉</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p>Thank you for trusting {company_name} with your project! We hope you love the results. Questions about your warranty? Call us at {company_phone}</p></div></div>"},{"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":4320,"recipient":"customer","sms_message":"Hi {customer_name}! Hope you're loving the finished project! 😊 Leave us a quick ⭐⭐⭐⭐⭐ review: {reviews_link} Thanks! -{company_name}"},{"step":3,"action_type":"send_email","schedule_type":"delay","delay_minutes":10080,"recipient":"customer","email_subject":"Love Your New Roof? Share the Love! $100 Referral Bonus","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px;'><div style='background: #6366f1; padding: 30px 20px; text-align: center;'><h1 style='color: white;'>Earn $100 Per Referral!</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p>Help your friends get the same great service and earn $100 for every successful referral!</p></div></div>"}] },
    { workflow_name: "Review Request Campaign", description: "Systematic approach to collect more 5-star reviews", trigger_type: "project_completed", is_active: true, actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":2880,"recipient":"customer","email_subject":"⭐ We'd Love Your Feedback, {customer_name}!","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px;'><div style='background: #fbbf24; padding: 30px 20px; text-align: center;'><h1 style='color: white;'>⭐⭐⭐⭐⭐</h1><h2 style='color: white;'>How Did We Do?</h2></div><div style='padding: 30px 20px; text-align: center;'><h2>Hi {customer_name},</h2><p>Your feedback means the world to us! Would you take 60 seconds to share your experience?</p></div></div>"},{"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":7200,"recipient":"customer","sms_message":"Hi {customer_name}! Quick request - would love if you could leave us a ⭐⭐⭐⭐⭐ review! Takes 60 sec: {reviews_link} Thanks!"},{"step":3,"action_type":"create_task","schedule_type":"delay","delay_minutes":14400,"recipient":"owner","task_title":"Personal Call: Request Review from {customer_name}","task_description":"REVIEW REQUEST CALL\n\nCustomer: {customer_name}\nProject completed 10 days ago\n\nCALL SCRIPT:\n- Thank them again for their business\n- Ask how everything is holding up\n- Mention how much reviews help small businesses"}] },
    { workflow_name: "Payment Received Thank You", description: "Thank customers for timely payment", trigger_type: "payment_received", is_active: true, actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":60,"recipient":"customer","email_subject":"Payment Received - Thank You! 🎉","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px;'><div style='background: #10b981; padding: 30px 20px; text-align: center;'><h1 style='color: white;'>Payment Received! ✓</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p>Thank you for your payment of {amount} for Invoice #{invoice_number}. We appreciate your business!</p></div></div>"},{"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":120,"recipient":"customer","sms_message":"Payment received! Thank you {customer_name}! 🎉 We appreciate your business. -{company_name}"}] },
    { workflow_name: "Referral Request After Payment", description: "Ask for referrals after customer pays invoice", trigger_type: "payment_received", is_active: true, actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":4320,"recipient":"customer","email_subject":"Love Your Experience? Earn $100 Per Referral! 💰","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px;'><div style='background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 20px; text-align: center;'><h1 style='color: white;'>💰 Earn $100 Cash! 💰</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p>We hope you loved working with {company_name}! Refer a friend and earn $100 for each successful referral. Unlimited referrals!</p></div></div>"},{"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":7200,"recipient":"customer","sms_message":"💰 Earn $100 for EVERY friend you refer to {company_name}! Unlimited referrals. Call {company_phone} to refer."}] },
    { workflow_name: "Appointment Confirmation - Instant", description: "Sends instant confirmation when inspection is booked", trigger_type: "appointment_created", is_active: true, folder: "Marketing Automations", actions: [{"step":1,"action_type":"send_sms","schedule_type":"delay","delay_minutes":0,"recipient":"{customer_phone}","sms_message":"✅ Inspection confirmed for {scheduled_date} at {property_address}. Your inspector will contact you soon. - {company_name}"},{"step":2,"action_type":"send_email","schedule_type":"delay","delay_minutes":5,"recipient":"{customer_email}","email_subject":"✅ Your Inspection is Confirmed!","email_body":"Hi {customer_name},\n\nGreat news! Your roof inspection has been confirmed.\n\n📅 Date & Time: {scheduled_date}\n📍 Property: {property_address}\n\nQuestions? Call us anytime at {company_phone}\n\nThank you for choosing {company_name}!"}] },
    { workflow_name: "Inspection Reminder - 24 Hours Before", description: "Automatically reminds customers 24 hours before their scheduled inspection", trigger_type: "appointment_created", is_active: true, folder: "Marketing Automations", actions: [{"step":1,"action_type":"send_sms","schedule_type":"delay","delay_minutes":1440,"recipient":"{customer_phone}","sms_message":"⏰ Reminder: Your roof inspection is tomorrow at {property_address}. Questions? Call us! - {company_name}"},{"step":2,"action_type":"send_email","schedule_type":"delay","delay_minutes":1440,"recipient":"{customer_email}","email_subject":"🏠 Inspection Tomorrow - Everything You Need to Know","email_body":"Hi {customer_name},\n\nFriendly reminder that your roof inspection is scheduled for tomorrow.\n\n📍 Address: {property_address}\n\nWhat to expect:\n✓ External roof inspection (30-45 minutes)\n✓ Full report within 24 hours\n\nNeed to reschedule? Call us at {company_phone}\n\nBest regards,\n{company_name}"}] },
    { workflow_name: "Post-Inspection Follow-Up", description: "Follow up after free inspections to convert to estimates", trigger_type: "appointment_completed", is_active: true, actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":60,"recipient":"customer","email_subject":"Thanks for Meeting with {company_name}!","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px;'><div style='background: #3b82f6; padding: 30px 20px; text-align: center;'><h1 style='color: white;'>Thank You!</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p>Thank you for allowing us to inspect your property today! We're preparing your detailed estimate and will have it ready within 24 hours.</p></div></div>"},{"step":2,"action_type":"create_task","schedule_type":"delay","delay_minutes":120,"recipient":"owner","task_title":"Create Estimate for {customer_name}","task_description":"POST-INSPECTION ESTIMATE NEEDED\n\nCustomer: {customer_name}\nInspection completed\n\nTO-DO:\n- Review inspection notes\n- Create detailed estimate\n- Send estimate within 24 hours"},{"step":3,"action_type":"send_sms","schedule_type":"delay","delay_minutes":1440,"recipient":"customer","sms_message":"Hi {customer_name}! Your estimate from {company_name} is ready. Check your email or call {company_phone} to discuss!"}] },
    { workflow_name: "7-Day Post-Service Check-In", description: "Checks in with customers 7 days after project completion", trigger_type: "project_completed", is_active: true, folder: "Marketing Automations", actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":10080,"recipient":"customer","email_subject":"How's Your New Roof? We'd Love Your Feedback!","email_body":"Hi {customer_name},\n\nIt's been a week since we completed your project, and we wanted to check in!\n\n• How is everything with your new roof?\n• Are you satisfied with the work quality?\n• Do you have any concerns or questions?\n\nWe take pride in our work and your satisfaction is our #1 priority.\n\nCall us anytime at {company_phone}\n\nThank you for choosing {company_name}!"},{"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":10085,"recipient":"customer","sms_message":"Hi {customer_name}! 👋 It's been a week since we completed your roof. Everything looking good? Any concerns? We're here to help! 😊 - {company_name} Team"}] },
    { workflow_name: "30-Day Referral Request Campaign", description: "Requests referrals 30 days after successful project completion", trigger_type: "project_completed", is_active: true, folder: "Marketing Automations", actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":43200,"recipient":"customer","email_subject":"🎉 Thank You! Earn $250 for Every Referral","email_body":"Dear {customer_name},\n\nThank you for choosing {company_name} for your recent project!\n\n💰 REFER A NEIGHBOR & EARN $250\n\nHow it works:\n1. Give us their name and contact info\n2. We provide them a free estimate\n3. If they hire us, you get $250 cash!\n\nNo limit on referrals!\n\nBest regards,\n{company_name}"},{"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":43205,"recipient":"customer","sms_message":"Hi {customer_name}! 🎉 Love your new roof? Refer a friend and earn $250! No limit on referrals. Call {company_phone}. Thanks! - {company_name}"}] },
    { workflow_name: "Service Anniversary Check-In", description: "Check in with customers 1 year after service", trigger_type: "project_completed", is_active: true, actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":525600,"recipient":"customer","email_subject":"Happy 1-Year Anniversary from {company_name}! 🎉","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px;'><div style='background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%); padding: 40px 20px; text-align: center;'><h1 style='color: white; font-size: 32px;'>🎉 Happy Anniversary! 🎉</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p>It's been one year since we completed your roofing project! We hope everything is still looking great. 20% OFF any additional service - valid for 30 days!</p><p>Questions? Call us at {company_phone}</p></div></div>"},{"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":527040,"recipient":"customer","sms_message":"🎉 1 year anniversary! {company_name} wants to offer you 20% OFF + FREE inspection. Call: {company_phone}"}] },
    { workflow_name: "Seasonal Maintenance Reminder", description: "Remind customers about seasonal roof maintenance", trigger_type: "customer_created", is_active: true, actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":129600,"recipient":"customer","email_subject":"Time for Your Free Roof Inspection! - {company_name}","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px;'><div style='background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%); padding: 40px 20px; text-align: center;'><h1 style='color: white;'>🏠 Roof Maintenance Time!</h1></div><div style='padding: 30px 20px;'><h2>Hi {customer_name},</h2><p>It's been 90 days since we completed your roof. Time for a quick check-up! Call {company_phone} to schedule your FREE seasonal inspection.</p></div></div>"},{"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":131040,"recipient":"customer","sms_message":"Hi {customer_name}! Time for your FREE seasonal roof inspection from {company_name}. Call: {company_phone}"}] },
    { workflow_name: "Customer Birthday/Anniversary", description: "Send personalized wishes and special offers on special occasions", trigger_type: "customer_created", is_active: true, actions: [{"step":1,"action_type":"send_email","schedule_type":"delay","delay_minutes":525600,"recipient":"customer","email_subject":"🎂 Happy Birthday from {company_name}! Special Gift Inside","email_body":"<div style='font-family: Arial, sans-serif; max-width: 600px;'><div style='background: linear-gradient(135deg, #ec4899 0%, #be185d 100%); padding: 40px 20px; text-align: center;'><h1 style='color: white; font-size: 36px;'>🎂 HAPPY BIRTHDAY! 🎂</h1></div><div style='padding: 30px 20px; text-align: center;'><h2>Hi {customer_name},</h2><p>Wishing you an amazing birthday from all of us at {company_name}! Here's 25% OFF any service as our gift to you. Valid 30 days. Call {company_phone} to redeem!</p></div></div>"},{"step":2,"action_type":"send_sms","schedule_type":"delay","delay_minutes":525720,"recipient":"customer","sms_message":"🎂 Happy Birthday {customer_name}! Here's 25% OFF any service from {company_name}. Valid 30 days. Call: {company_phone}"}] }
  ];

  let created = 0, skipped = 0;
  for (const wf of PLATFORM_WORKFLOWS) {
    const wfId = `${wf.id}_${companyId}`;
    const exists = await pool.query('SELECT id FROM generic_entities WHERE id = $1', [wfId]);
    if (exists.rows.length > 0) { skipped++; continue; }
    const wfData = JSON.stringify({ ...wf, is_active: true, status: 'active', company_id: companyId, created_by: 'platform' });
    await pool.query(
      'INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())',
      [wfId, 'Workflow', companyId, wfData]
    );
    created++;
  }

  for (const wf of CUSTOM_WORKFLOWS) {
    const safeName = wf.workflow_name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40);
    const wfId = `wf_custom_${safeName}_${companyId}`;
    const exists = await pool.query(
      "SELECT id FROM generic_entities WHERE id = $1 OR (entity_type = 'Workflow' AND company_id = $2 AND data->>'workflow_name' = $3)",
      [wfId, companyId, wf.workflow_name]
    );
    if (exists.rows.length > 0) { skipped++; continue; }
    const wfData = JSON.stringify({ ...wf, id: wfId, is_active: true, status: 'active', company_id: companyId, created_by: 'platform' });
    await pool.query(
      'INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())',
      [wfId, 'Workflow', companyId, wfData]
    );
    created++;
  }

  console.log(`[LocalAuth] setupDefaultWorkflows company=${companyId}: created=${created}, skipped=${skipped}`);
  return { created, skipped };
}

async function sendWelcomeEmail(email, companyName, appUrl, trialEndDate) {
  const trialEndStr = trialEndDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      <div style="background: linear-gradient(135deg, #1e293b 0%, #1e40af 100%); padding: 40px 32px; border-radius: 12px 12px 0 0;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">Welcome to CompanySync!</h1>
        <p style="color: #bfdbfe; margin: 8px 0 0; font-size: 16px;">Your 14-day free trial has started.</p>
      </div>
      <div style="padding: 32px; background: #f8fafc; border-radius: 0 0 12px 12px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #334155; font-size: 16px; margin: 0 0 20px;">Hi there,</p>
        <p style="color: #334155; font-size: 16px; margin: 0 0 20px;">
          <strong>${companyName}</strong> is now set up on CompanySync. You have full access to all features during your 14-day trial — no credit card required.
        </p>
        <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; margin: 0 0 24px;">
          <p style="color: #1e40af; font-weight: 600; margin: 0 0 8px;">Your trial includes:</p>
          <ul style="color: #334155; margin: 0; padding-left: 20px; line-height: 1.8;">
            <li>AI Voice Assistant (Sarah) — answers your calls 24/7</li>
            <li>AI Chat Assistant (Lexi) — handles customer questions</li>
            <li>CRM, Estimates, Invoices &amp; Payments</li>
            <li>Crew &amp; Field Operations Management</li>
            <li>Storm Tracking &amp; AI Damage Inspection</li>
          </ul>
        </div>
        <p style="color: #64748b; font-size: 14px; margin: 0 0 24px;">
          Trial expires: <strong style="color: #334155;">${trialEndStr}</strong>
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${appUrl}/QuickSetup?new_signup=true" style="background: #2563eb; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">
            Complete Your Setup →
          </a>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 24px 0 0;">CompanySync · getcompanysync.com</p>
      </div>
    </div>
  `;
  console.log('[LocalAuth] Sending welcome email to', email);
  const sent = await sendEmail(email, 'Welcome to CompanySync — Your 14-day trial has started', html);
  if (sent) {
    console.log('[LocalAuth] Welcome email delivered to', email);
  } else {
    console.warn('[LocalAuth] Welcome email could not be delivered to', email);
  }
}

async function handleConfirmEmail(req, res, pool) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Invalid Link</h1><p>The confirmation link is invalid.</p></body></html>');
      return;
    }

    const result = await pool.query(
      'SELECT * FROM pending_signups WHERE verification_token = $1',
      [token]
    );

    if (result.rows.length === 0) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Link Not Found</h1><p>This confirmation link has already been used or does not exist.</p></body></html>');
      return;
    }

    const signup = result.rows[0];

    if (signup.is_confirmed) {
      const appUrl = getAppUrl(req).replace(/\/+$/, '');
      res.writeHead(302, { Location: `${appUrl}/login` });
      res.end();
      return;
    }

    if (new Date(signup.token_expires_at) < new Date()) {
      res.writeHead(410, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Link Expired</h1><p>This confirmation link has expired. Please sign up again.</p></body></html>');
      return;
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const userId = generateId();
    const companyId = generateId();

    await pool.query(
      `INSERT INTO companies (id, name, company_name, created_by, subscription_plan, subscription_status, created_at, updated_at)
       VALUES ($1, $2, $2, $3, 'trial', 'trial', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [companyId, signup.company_name, signup.email]
    );

    await pool.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, is_local_auth, must_change_password, company_id, created_at, updated_at)
       VALUES ($1, $2, '', '', $3, true, true, $4, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET
         password_hash = $3, is_local_auth = true, must_change_password = true, company_id = $4, updated_at = NOW()`,
      [userId, signup.email, passwordHash, companyId]
    );

    await pool.query(
      `INSERT INTO staff_profiles (id, company_id, email, user_email, role, is_administrator, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $3, 'admin', true, true, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [generateId(), companyId, signup.email]
    );

    // Setup default automation workflows for new tenant (non-blocking)
    setupDefaultWorkflows(pool, companyId).catch(e => {
      console.warn('[LocalAuth] Workflow setup failed:', e.message);
    });

    await pool.query(
      'UPDATE pending_signups SET is_confirmed = true WHERE id = $1',
      [signup.id]
    );

    const appUrl = getAppUrl(req).replace(/\/+$/, '');
    const loginUrl = `${appUrl}/login`;

    const credentialsHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #1e293b; margin-bottom: 8px;">Your Account Is Ready!</h1>
        <p style="color: #64748b; font-size: 16px;">Welcome to CompanySync, ${signup.company_name}!</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #334155; font-size: 15px;">Your account has been created. Here are your login credentials:</p>
        <div style="background: #f1f5f9; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <p style="margin: 8px 0; color: #334155;"><strong>Email:</strong> ${signup.email}</p>
          <p style="margin: 8px 0; color: #334155;"><strong>Temporary Password:</strong> <code style="background: #e2e8f0; padding: 2px 8px; border-radius: 4px; font-size: 16px;">${tempPassword}</code></p>
        </div>
        <p style="color: #dc2626; font-size: 14px; font-weight: 600;">You will be asked to change your password on first login.</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${loginUrl}" style="display: inline-block; background-color: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600;">Log In to CompanySync</a>
        </div>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #94a3b8; font-size: 12px;">&copy; ${new Date().getFullYear()} CompanySync — Roofing Business Management</p>
      </div>
    `;

    await sendEmail(signup.email, 'Your CompanySync Login Credentials', credentialsHtml);

    console.log('[LocalAuth] Account confirmed and created for', signup.email, 'company:', signup.company_name);

    const confirmationPageHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Email Confirmed — CompanySync</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; background: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
          .card { background: white; border-radius: 12px; padding: 48px; max-width: 480px; text-align: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,.1); }
          .check { width: 64px; height: 64px; background: #dcfce7; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; }
          .check svg { width: 32px; height: 32px; color: #16a34a; }
          h1 { color: #1e293b; margin: 0 0 12px; font-size: 24px; }
          p { color: #64748b; font-size: 15px; line-height: 1.6; }
          .btn { display: inline-block; background: #2563eb; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 24px; }
          .btn:hover { background: #1d4ed8; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="check"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg></div>
          <h1>Email Confirmed!</h1>
          <p>Your CompanySync account for <strong>${signup.company_name}</strong> has been created.</p>
          <p>We've sent your login credentials to <strong>${signup.email}</strong>. Check your inbox for your temporary password.</p>
          <a href="${loginUrl}" class="btn">Go to Login</a>
        </div>
      </body>
      </html>
    `;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(confirmationPageHtml);
  } catch (e) {
    console.error('[LocalAuth] Confirm email error:', e);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end('<html><body><h1>Error</h1><p>Something went wrong. Please try again or contact support.</p></body></html>');
  }
}

async function handleLoginLocal(req, res, pool) {
  try {
    const { email, password } = await parseBody(req);

    if (!email || !password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Email and password are required' }));
      return;
    }

    const emailLower = email.toLowerCase().trim();
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_local_auth = true',
      [emailLower]
    );

    if (result.rows.length === 0) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid email or password' }));
      return;
    }

    const user = result.rows[0];
    if (!user.password_hash) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid email or password' }));
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    console.log('[LocalAuth] Password valid:', valid, 'for user:', emailLower);
    if (!valid) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid email or password' }));
      return;
    }

    const sid = await createSession(pool, user.id, user.email, user.first_name, user.last_name, user.company_id);
    setSessionCookie(res, sid);

    console.log('[LocalAuth] Login success for', emailLower);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      must_change_password: user.must_change_password || false,
      redirect: '/',
    }));
  } catch (e) {
    console.error('[LocalAuth] Login error:', e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'An unexpected error occurred' }));
  }
}

async function handleChangePassword(req, res, pool) {
  try {
    const { current_password, new_password } = await parseBody(req);

    if (!current_password || !new_password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Current and new password are required' }));
      return;
    }

    if (new_password.length < 8) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'New password must be at least 8 characters' }));
      return;
    }

    const prodAuth = require('./prod-auth.cjs');
    const sessionData = await prodAuth.getSessionFromRequest(req, pool);
    if (!sessionData?.data?.passport?.user?.claims?.sub) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not authenticated' }));
      return;
    }

    const userId = sessionData.data.passport.user.claims.sub;
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1 AND is_local_auth = true', [userId]);
    if (userResult.rows.length === 0) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'User not found' }));
      return;
    }

    const user = userResult.rows[0];
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Current password is incorrect' }));
      return;
    }

    const newHash = await bcrypt.hash(new_password, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = false, updated_at = NOW() WHERE id = $2',
      [newHash, userId]
    );

    console.log('[LocalAuth] Password changed for', user.email);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Password changed successfully' }));
  } catch (e) {
    console.error('[LocalAuth] Change password error:', e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'An unexpected error occurred' }));
  }
}

async function handleForgotPassword(req, res, pool) {
  setCorsHeaders(res, req);
  try {
    const { email } = await parseBody(req);
    if (!email) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Email is required' }));
      return;
    }

    const emailLower = email.toLowerCase().trim();

    // Check if user exists in users table
    const userResult = await pool.query('SELECT id, email FROM users WHERE email = $1', [emailLower]);
    const userExists = userResult.rows.length > 0;

    // Also check if they have a staff profile (invited staff with no account yet)
    const staffResult = await pool.query(
      `SELECT sp.*, ge.data
       FROM staff_profiles sp
       LEFT JOIN generic_entities ge ON ge.id = sp.id AND ge.entity_type = 'StaffProfile'
       WHERE sp.user_email = $1 LIMIT 1`,
      [emailLower]
    );
    const staffProfile = staffResult.rows[0];

    if (!userExists && !staffProfile) {
      // Don't reveal whether email exists for security, but still return success
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'If that email is registered, you will receive a password reset link.' }));
      return;
    }

    // If staff member has no user account, create one linked to their company
    if (!userExists && staffProfile) {
      const userId = generateId();
      const companyId = staffProfile.company_id;
      await pool.query(
        `INSERT INTO users (id, email, first_name, last_name, password_hash, is_local_auth, must_change_password, company_id, created_at, updated_at)
         VALUES ($1, $2, '', '', '', true, true, $3, NOW(), NOW())
         ON CONFLICT (email) DO NOTHING`,
        [userId, emailLower, companyId]
      );
      console.log('[LocalAuth] Created user record for invited staff:', emailLower, 'company:', companyId);
    }

    // Delete any existing tokens for this email
    await pool.query('DELETE FROM password_reset_tokens WHERE email = $1', [emailLower]);

    // Create reset token
    const token = generateToken();
    const tokenId = generateId();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      `INSERT INTO password_reset_tokens (id, email, token, expires_at) VALUES ($1, $2, $3, $4)`,
      [tokenId, emailLower, token, expiresAt]
    );

    const appUrl = getAppUrl(req).replace(/\/+$/, '');
    const resetUrl = `${appUrl}/ResetPassword?token=${token}`;

    const isStaffInvite = !userExists && staffProfile;
    const subject = isStaffInvite ? 'Set up your CompanySync account' : 'Reset your CompanySync password';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #1e293b; margin-bottom: 8px;">${isStaffInvite ? 'Welcome to CompanySync!' : 'Reset Your Password'}</h1>
        <p style="color: #64748b; font-size: 15px;">
          ${isStaffInvite
            ? "You've been invited to join your team on CompanySync. Click the button below to set up your password and access your account."
            : "We received a request to reset the password for your CompanySync account. Click the button below to choose a new password."}
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}" style="display: inline-block; background-color: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600;">
            ${isStaffInvite ? 'Set Up My Password' : 'Reset My Password'}
          </a>
        </div>
        <p style="color: #64748b; font-size: 13px;">This link expires in 1 hour. If you did not request this, you can safely ignore this email.</p>
        <p style="color: #94a3b8; font-size: 12px; word-break: break-all;">Or copy this link: ${resetUrl}</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #94a3b8; font-size: 12px;">&copy; ${new Date().getFullYear()} CompanySync — Roofing Business Management</p>
      </div>
    `;

    await sendEmail(emailLower, subject, html);
    console.log('[LocalAuth] Password reset email sent to', emailLower);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'If that email is registered, you will receive a password reset link.' }));
  } catch (e) {
    console.error('[LocalAuth] Forgot password error:', e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'An unexpected error occurred. Please try again.' }));
  }
}

async function handleResetPassword(req, res, pool) {
  setCorsHeaders(res, req);
  try {
    const { token, password } = await parseBody(req);

    if (!token || !password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Token and new password are required' }));
      return;
    }

    if (password.length < 8) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Password must be at least 8 characters' }));
      return;
    }

    // Find and validate token
    const tokenResult = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()',
      [token]
    );

    if (tokenResult.rows.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'This reset link is invalid or has expired. Please request a new one.' }));
      return;
    }

    const resetToken = tokenResult.rows[0];
    const email = resetToken.email;

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 10);

    // Update user password
    const updateResult = await pool.query(
      `UPDATE users SET password_hash = $1, must_change_password = false, updated_at = NOW()
       WHERE email = $2 AND is_local_auth = true RETURNING id, email, first_name, last_name, company_id`,
      [passwordHash, email]
    );

    if (updateResult.rows.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'User account not found. Please contact support.' }));
      return;
    }

    const user = updateResult.rows[0];

    // Mark token as used
    await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [resetToken.id]);

    // Create session to log them in automatically
    const sid = await createSession(pool, user.id, user.email, user.first_name, user.last_name, user.company_id);
    setSessionCookie(res, sid);

    console.log('[LocalAuth] Password reset successful for', email);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, redirect: '/' }));
  } catch (e) {
    console.error('[LocalAuth] Reset password error:', e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'An unexpected error occurred. Please try again.' }));
  }
}

async function handleAdminSetStaffPassword(req, res, pool) {
  setCorsHeaders(res, req);
  try {
    const { staffEmail, password, staffProfileId } = await parseBody(req);
    if (!staffEmail || !password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'staffEmail and password are required' }));
      return;
    }
    if (password.length < 8) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Password must be at least 8 characters' }));
      return;
    }

    const prodAuth = require('./prod-auth.cjs');
    const sessionData = await prodAuth.getSessionFromRequest(req, pool);
    const callerUserId = sessionData?.data?.passport?.user?.claims?.sub;
    if (!callerUserId) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not authenticated' }));
      return;
    }

    // Get the caller's company
    const callerResult = await pool.query(
      'SELECT company_id FROM users WHERE id = $1',
      [callerUserId]
    );
    if (!callerResult.rows[0]) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Caller account not found' }));
      return;
    }
    const callerCompanyId = callerResult.rows[0].company_id;

    // Also check staff_profiles for caller being an admin
    const callerProfileResult = await pool.query(
      `SELECT is_administrator, is_super_admin, company_id FROM staff_profiles
       WHERE user_email = (SELECT email FROM users WHERE id = $1) LIMIT 1`,
      [callerUserId]
    );
    const callerProfile = callerProfileResult.rows[0];
    const isAdmin = callerProfile?.is_administrator || callerProfile?.is_super_admin;
    if (!isAdmin) {
      // Allow platform admins (no company_id in users table means platform admin)
      const callerUserResult = await pool.query('SELECT email, company_id FROM users WHERE id = $1', [callerUserId]);
      const callerUser = callerUserResult.rows[0];
      // Check if they are a platform admin via companysync_master_001
      const masterResult = await pool.query(
        `SELECT is_administrator, is_super_admin FROM staff_profiles WHERE user_email = $1 AND company_id = 'companysync_master_001' LIMIT 1`,
        [callerUser?.email]
      );
      if (!masterResult.rows[0]?.is_administrator && !masterResult.rows[0]?.is_super_admin) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'You must be an administrator to set staff passwords' }));
        return;
      }
    }

    const staffEmailLower = staffEmail.toLowerCase().trim();

    // Find the staff profile to verify they're in the same company
    const staffProfileResult = await pool.query(
      'SELECT * FROM staff_profiles WHERE user_email = $1 LIMIT 1',
      [staffEmailLower]
    );
    const staffProfile = staffProfileResult.rows[0];

    const targetCompanyId = staffProfile?.company_id || callerCompanyId;

    // Extract first/last name from staff profile full_name
    const profileFullName = staffProfile?.full_name || '';
    const nameParts = profileFullName.trim().split(/\s+/);
    const staffFirstName = nameParts[0] || '';
    const staffLastName = nameParts.slice(1).join(' ') || '';

    // Hash the new password
    const passwordHash = await bcrypt.hash(password, 10);

    // Upsert the user account
    const existingUser = await pool.query('SELECT id, first_name, last_name FROM users WHERE email = $1', [staffEmailLower]);
    if (existingUser.rows.length > 0) {
      const existing = existingUser.rows[0];
      // Update password, and backfill name if currently empty
      const newFirst = existing.first_name || staffFirstName;
      const newLast = existing.last_name || staffLastName;
      await pool.query(
        'UPDATE users SET password_hash = $1, first_name = $3, last_name = $4, is_local_auth = true, must_change_password = false, updated_at = NOW() WHERE email = $2',
        [passwordHash, staffEmailLower, newFirst, newLast]
      );
      console.log('[LocalAuth] Admin set password for existing user:', staffEmailLower);
    } else {
      const userId = generateId();
      await pool.query(
        `INSERT INTO users (id, email, first_name, last_name, password_hash, is_local_auth, must_change_password, company_id, created_at, updated_at)
         VALUES ($1, $2, $5, $6, $3, true, false, $4, NOW(), NOW())`,
        [userId, staffEmailLower, passwordHash, targetCompanyId, staffFirstName, staffLastName]
      );
      console.log('[LocalAuth] Admin created user account for:', staffEmailLower);
    }

    // Mark invite as sent on the staff profile
    if (staffProfile) {
      await pool.query(
        `UPDATE staff_profiles SET data = jsonb_set(COALESCE(data, '{}'), '{invite_sent}', 'true'), updated_at = NOW() WHERE user_email = $1`,
        [staffEmailLower]
      );
    }
    // Also update invite_sent field if it exists
    try {
      await pool.query(
        `UPDATE staff_profiles SET invite_sent = true, invite_sent_at = NOW(), updated_at = NOW() WHERE user_email = $1`,
        [staffEmailLower]
      );
    } catch (e) { /* column may not exist, handled via data jsonb */ }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: `Password set for ${staffEmailLower}. They can now log in directly.` }));
  } catch (e) {
    console.error('[LocalAuth] Admin set staff password error:', e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'An unexpected error occurred. Please try again.' }));
  }
}

module.exports = {
  handleSignup,
  handleConfirmEmail,
  handleLoginLocal,
  handleChangePassword,
  handleForgotPassword,
  handleResetPassword,
  handleAdminSetStaffPassword,
};
