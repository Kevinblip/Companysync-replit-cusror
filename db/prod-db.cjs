const { createRequire } = require('module');
const _require = createRequire(__filename);
const Pool = _require('pg').Pool;
const crypto = require('crypto');

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 5000,
    });
    pool.on('error', (err) => {
      console.error('[DB] Unexpected pool error:', err.message);
      if (err.message && (err.message.includes('terminated') || err.message.includes('connection timeout') || err.message.includes('ECONNRESET'))) {
        console.log('[DB] Resetting pool due to connection error');
        pool = null;
      }
    });
  }
  return pool;
}

// Current default submenu items for each nav group — keep in sync with Layout.jsx defaultNavigationItems
const MENU_DEFAULT_SUBITEMS = {
  'ai-tools': [
    { id: 'ai-estimator', title: 'AI Estimator' },
    { id: 'lexi', title: 'Lexi AI Assistant' },
    { id: 'lexi-memory', title: 'Lexi Memory' },
    { id: 'permit-assistant', title: 'Permit Assistant' },
    { id: 'daily-reports', title: 'Daily Reports' },
    { id: 'ai-staff', title: 'AI Team' },
    { id: 'ai-training', title: 'AI Memory' },
    { id: 'video-training', title: 'Video Training Generator' },
  ],
  'lead-manager': [
    { id: 'all-leads', title: 'All Leads' },
    { id: 'lead-finder', title: 'Lead Finder' },
    { id: 'storm-tracking', title: 'Storm Tracking' },
  ],
  'sales': [
    { id: 'customers', title: 'Customers' },
    { id: 'sales-dashboard', title: 'Sales Dashboard' },
    { id: 'estimates', title: 'Estimates' },
    { id: 'proposals', title: 'Proposals' },
    { id: 'invoices', title: 'Invoices' },
    { id: 'payments', title: 'Payments' },
    { id: 'items', title: 'Items & Pricing' },
    { id: 'commissions', title: 'Commission Tracker' },
    { id: 'family-commissions', title: 'Family Commissions' },
  ],
  'accounting': [
    { id: 'accounting-setup', title: 'Setup Wizard' },
    { id: 'accounting-dashboard', title: 'Dashboard' },
    { id: 'bills', title: 'Bills & Payables' },
    { id: 'transactions', title: 'Transactions' },
    { id: 'journal-entry', title: 'Journal Entry' },
    { id: 'transfer', title: 'Transfer' },
    { id: 'chart-of-accounts', title: 'Chart of Accounts' },
    { id: 'reconcile', title: 'Reconcile' },
    { id: 'reports', title: 'Reports' },
    { id: 'expenses', title: 'Expenses' },
    { id: 'payouts', title: 'Payouts' },
    { id: 'mapping-rules', title: 'Mapping Rules' },
  ],
  'field-operations': [
    { id: 'field-sales-tracker', title: 'Field Sales Tracker' },
    { id: 'field-rep-app', title: 'Work Territory' },
    { id: 'territory-manager', title: 'Territory Manager' },
    { id: 'build-schedule', title: 'Build Schedule' },
  ],
  'operations': [
    { id: 'crewcam-dashboard', title: 'CrewCam Dashboard' },
    { id: 'new-crewcam', title: 'New CrewCam Job' },
    { id: 'crewcam-capture', title: 'CrewCam Capture' },
    { id: 'ai-damage', title: 'AI Damage Analysis' },
    { id: 'subcontractors', title: 'Subcontractors' },
    { id: 'tasks', title: 'Tasks' },
    { id: 'review-requests', title: 'Review Requests' },
    { id: 'reminders', title: 'Reminders' },
    { id: 'projects', title: 'Projects' },
    { id: 'activity', title: 'Activity Feed' },
  ],
  'communication': [
    { id: 'live-call-dashboard', title: 'Live Call Dashboard' },
    { id: 'communication-hub', title: 'Communication Hub' },
    { id: 'campaigns', title: 'Campaign Manager' },
    { id: 'ad-builder', title: 'Ad Builder' },
    { id: 'workflow-automation', title: 'Workflow Automation' },
    { id: 'ai-dashboard', title: 'AI Dashboard' },
    { id: 'mailbox', title: 'Mailbox' },
    { id: 'messages', title: 'Messages' },
    { id: 'zoom', title: 'Zoom Meeting' },
  ],
  'documents': [
    { id: 'all-documents', title: 'All Documents' },
    { id: 'contracts', title: 'Contracts' },
    { id: 'contract-templates', title: 'Contract Templates' },
    { id: 'contract-signing', title: 'Contract Signing' },
  ],
  'reports': [
    { id: 'analytics-dashboard', title: 'Analytics' },
    { id: 'report-builder', title: 'Report Builder' },
    { id: 'sales-reports', title: 'Sales Reports' },
    { id: 'competitor-analysis', title: 'Competitor Analysis' },
  ],
};

// Top-level nav item IDs that must always exist in saved MenuSettings
const MENU_DEFAULT_TOP_LEVEL = [
  { id: 'dashboard', order: 0 },
  { id: 'ai-tools', order: 1, hasSubmenu: true },
  { id: 'lead-manager', order: 2, hasSubmenu: true },
  { id: 'sales', order: 3, hasSubmenu: true },
  { id: 'accounting', order: 3.7, hasSubmenu: true },
  { id: 'field-operations', order: 3.5, hasSubmenu: true },
  { id: 'operations', order: 4, hasSubmenu: true },
  { id: 'smart-glasses', order: 4.1 },
  { id: 'calendar', order: 5 },
  { id: 'communication', order: 13, hasSubmenu: true },
  { id: 'documents', order: 7, hasSubmenu: true },
  { id: 'reports', order: 8, hasSubmenu: true },
  { id: 'map', order: 9 },
  { id: 'knowledge-base', order: 10 },
  { id: 'subscription', order: 11 },
  { id: 'feature-comparison', order: 11.5 },
  { id: 'coming-soon', order: 12 },
];

async function migrateMenuSettingsNewItems(p) {
  const { rows } = await p.query(
    `SELECT id, company_id, data FROM generic_entities WHERE entity_type = 'MenuSettings'`
  );
  if (rows.length === 0) return;

  let totalUpdated = 0;

  for (const row of rows) {
    const data = row.data || {};
    const menuItems = data.menu_items;
    if (!menuItems || !Array.isArray(menuItems)) continue;

    let modified = false;
    const savedIds = new Set(menuItems.map(m => m.id));

    // Step 1: Add any missing top-level items
    const updatedItems = [...menuItems];
    for (const def of MENU_DEFAULT_TOP_LEVEL) {
      if (!savedIds.has(def.id)) {
        updatedItems.push({ id: def.id, enabled: true, order: def.order });
        modified = true;
      }
    }

    // Step 2: For each saved item that has submenus, merge in missing submenu items
    const finalItems = updatedItems.map(item => {
      const defaultSubs = MENU_DEFAULT_SUBITEMS[item.id];
      if (!defaultSubs) return item;

      const savedSubs = item.submenuItems || item.submenu || [];
      const savedSubIds = new Set(savedSubs.map(s => s.id));
      const missingSubs = defaultSubs.filter(s => !savedSubIds.has(s.id));

      if (missingSubs.length === 0) return item;

      modified = true;
      return {
        ...item,
        submenuItems: [...savedSubs, ...missingSubs.map(s => ({ id: s.id, title: s.title, enabled: true }))],
      };
    });

    if (!modified) continue;

    await p.query(
      `UPDATE generic_entities SET data = $1, updated_date = NOW() WHERE id = $2`,
      [JSON.stringify({ ...data, menu_items: finalItems }), row.id]
    );
    totalUpdated++;
  }

  if (totalUpdated > 0) {
    console.log(`[MenuSettings] Patched ${totalUpdated} saved menu config(s) with missing nav items`);
  } else {
    console.log('[MenuSettings] All saved menu configs are up to date');
  }
}

async function initDatabase() {
  const p = getPool();

  await p.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY, base44_id TEXT UNIQUE, name TEXT, company_name TEXT, company_tagline TEXT,
      company_logo TEXT, logo_url TEXT, created_by TEXT, is_deleted BOOLEAN DEFAULT false,
      phone TEXT, email TEXT, address TEXT, website TEXT, industry TEXT DEFAULT 'roofing', timezone TEXT,
      preferred_language TEXT DEFAULT 'en', subscription_plan TEXT,
      stripe_customer_id TEXT, stripe_subscription_id TEXT, trial_end_date TIMESTAMP,
      max_users INTEGER DEFAULT 5, max_leads INTEGER DEFAULT 100,
      features_enabled JSONB DEFAULT '[]', branding JSONB DEFAULT '{}', settings JSONB DEFAULT '{}',
      data JSONB DEFAULT '{}', synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS staff_profiles (
      id TEXT PRIMARY KEY, base44_id TEXT UNIQUE, company_id TEXT, name TEXT, full_name TEXT,
      email TEXT, user_email TEXT, role TEXT, role_id TEXT, position TEXT,
      phone TEXT, cell_phone TEXT, avatar_url TEXT,
      call_routing_mode TEXT DEFAULT 'sarah_answers', availability_status TEXT DEFAULT 'available',
      twilio_number TEXT, is_administrator BOOLEAN DEFAULT false, is_super_admin BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true, commission_rate NUMERIC(5,2) DEFAULT 0,
      whatsapp_enabled BOOLEAN DEFAULT false, profile_id TEXT, created_by TEXT,
      last_login TIMESTAMP, data JSONB DEFAULT '{}',
      synced_at TIMESTAMP DEFAULT NOW(), created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY, base44_id TEXT UNIQUE, company_id TEXT, name TEXT, email TEXT,
      phone TEXT, phone_2 TEXT, address TEXT, street TEXT, city TEXT, state TEXT, zip TEXT,
      company TEXT, status TEXT DEFAULT 'new', source TEXT, lead_source TEXT,
      assigned_to TEXT, assigned_to_users JSONB DEFAULT '[]', service_needed TEXT,
      customer_type TEXT DEFAULT 'residential', lead_score INTEGER DEFAULT 0,
      value NUMERIC(12,2) DEFAULT 0, notes TEXT, tags JSONB DEFAULT '[]',
      is_active BOOLEAN DEFAULT true, last_contact_date TEXT, next_follow_up_date TEXT,
      ghl_contact_id TEXT, communication_count INTEGER DEFAULT 0, created_by TEXT,
      data JSONB DEFAULT '{}', synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, base44_id TEXT UNIQUE, company_id TEXT, customer_number SERIAL,
      name TEXT, company_name TEXT, customer_type TEXT DEFAULT 'residential',
      email TEXT, phone TEXT, phone_2 TEXT, street TEXT, city TEXT, state TEXT, zip TEXT,
      address TEXT, website TEXT, source TEXT DEFAULT 'other', referral_source TEXT, custom_source TEXT,
      is_active BOOLEAN DEFAULT true, notes TEXT, group_name TEXT, assigned_to TEXT,
      assigned_to_users JSONB DEFAULT '[]', tags JSONB DEFAULT '[]',
      insurance_company TEXT, adjuster_name TEXT, adjuster_phone TEXT,
      status TEXT DEFAULT 'active', total_revenue NUMERIC(12,2) DEFAULT 0,
      data JSONB DEFAULT '{}', synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS estimates (
      id TEXT PRIMARY KEY, base44_id TEXT UNIQUE, company_id TEXT, customer_id TEXT,
      customer_name TEXT, customer_email TEXT, customer_phone TEXT, estimate_number TEXT,
      title TEXT, status TEXT DEFAULT 'draft', total_amount NUMERIC(12,2) DEFAULT 0,
      property_address TEXT, lead_id TEXT, insurance_company TEXT, claim_number TEXT,
      adjuster_name TEXT, adjuster_phone TEXT, adjustment_amount NUMERIC(12,2) DEFAULT 0,
      discount_type TEXT, discount_value NUMERIC(12,2) DEFAULT 0,
      items JSONB DEFAULT '[]', notes TEXT, tags JSONB DEFAULT '[]',
      valid_until TEXT, reference_number TEXT, format_id TEXT, category TEXT, created_by TEXT,
      data JSONB DEFAULT '{}', synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY, base44_id TEXT UNIQUE, company_id TEXT, customer_id TEXT,
      customer_name TEXT, customer_email TEXT, invoice_number TEXT, status TEXT DEFAULT 'draft',
      total_amount NUMERIC(12,2) DEFAULT 0, amount_paid NUMERIC(12,2) DEFAULT 0,
      total_tax NUMERIC(12,2) DEFAULT 0, deductible_amount NUMERIC(12,2) DEFAULT 0,
      due_date TIMESTAMP, issue_date TEXT, project_name TEXT, sale_agent TEXT,
      insurance_company TEXT, claim_number TEXT, policy_number TEXT,
      items JSONB DEFAULT '[]', tags JSONB DEFAULT '[]', commission_splits JSONB DEFAULT '[]',
      notes TEXT, created_by TEXT, data JSONB DEFAULT '{}',
      synced_at TIMESTAMP DEFAULT NOW(), created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY, base44_id TEXT UNIQUE, company_id TEXT, invoice_id TEXT, customer_id TEXT,
      customer_name TEXT, invoice_number TEXT, amount NUMERIC(12,2) DEFAULT 0,
      payment_method TEXT, payment_date TIMESTAMP, reference_number TEXT, notes TEXT,
      status TEXT DEFAULT 'completed', send_receipt BOOLEAN DEFAULT false, created_by TEXT,
      data JSONB DEFAULT '{}', synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, base44_id TEXT UNIQUE, company_id TEXT, customer_id TEXT,
      customer_name TEXT, title TEXT, description TEXT, status TEXT DEFAULT 'pending',
      start_date TIMESTAMP, end_date TIMESTAMP, total_value NUMERIC(12,2) DEFAULT 0,
      assigned_to TEXT, address TEXT, notes TEXT, tags JSONB DEFAULT '[]', created_by TEXT,
      data JSONB DEFAULT '{}', synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, base44_id TEXT UNIQUE, company_id TEXT, title TEXT, name TEXT,
      description TEXT, status TEXT DEFAULT 'pending', priority TEXT DEFAULT 'medium',
      assigned_to TEXT, assigned_to_name TEXT, assigned_to_avatar TEXT,
      assignees JSONB DEFAULT '[]', due_date TIMESTAMP, related_to TEXT,
      customer_id TEXT, customer_name TEXT, board_id TEXT, "column" TEXT,
      checklist_items JSONB DEFAULT '[]', comments JSONB DEFAULT '[]', files JSONB DEFAULT '[]',
      followers JSONB DEFAULT '[]', reminders JSONB DEFAULT '[]', timesheets JSONB DEFAULT '[]',
      created_by TEXT, data JSONB DEFAULT '{}', synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY, base44_id TEXT UNIQUE, company_id TEXT, title TEXT,
      event_type TEXT, start_time TIMESTAMP, end_time TIMESTAMP, location TEXT, attendees TEXT,
      assigned_to TEXT, description TEXT, color TEXT, related_customer TEXT, related_lead TEXT,
      is_saas_event BOOLEAN DEFAULT false, send_email_notification BOOLEAN DEFAULT false,
      send_sms_notification BOOLEAN DEFAULT false, send_browser_notification BOOLEAN DEFAULT false,
      email_reminder_minutes INTEGER, sms_reminder_minutes INTEGER, browser_reminder_minutes INTEGER,
      created_by TEXT, data JSONB DEFAULT '{}', synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS communications (
      id TEXT PRIMARY KEY, base44_id TEXT UNIQUE, company_id TEXT, type TEXT,
      communication_type TEXT, direction TEXT, contact_name TEXT, contact_phone TEXT,
      contact_email TEXT, subject TEXT, body TEXT, message TEXT, status TEXT,
      ai_summary TEXT, recording_url TEXT, sentiment TEXT, intent TEXT, duration_minutes INTEGER,
      is_read BOOLEAN DEFAULT false, lead_id TEXT, customer_id TEXT, created_by TEXT,
      data JSONB DEFAULT '{}', synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS call_routing_cache (
      phone_number TEXT PRIMARY KEY, company_id TEXT, company_name TEXT,
      assistant_name TEXT DEFAULT 'Sarah', routing_mode TEXT DEFAULT 'sarah_answers',
      cell_phone TEXT, rep_name TEXT, rep_email TEXT, twilio_sid TEXT,
      twilio_token TEXT, twilio_phone TEXT, availability_status TEXT DEFAULT 'available',
      data JSONB DEFAULT '{}', updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS signing_sessions (
      id SERIAL PRIMARY KEY, base44_session_id TEXT, company_id TEXT,
      template_id TEXT, template_name TEXT, contract_name TEXT,
      customer_name TEXT, customer_email TEXT, customer_phone TEXT,
      delivery_method TEXT DEFAULT 'email', rep_name TEXT, rep_email TEXT,
      rep_fields JSONB DEFAULT '{}', rep_signature_url TEXT, rep_signed_at TIMESTAMP,
      customer_fields JSONB DEFAULT '{}', customer_signature_data TEXT,
      customer_signed_at TIMESTAMP, signing_token TEXT UNIQUE,
      status TEXT DEFAULT 'draft', current_signer TEXT DEFAULT 'rep',
      fillable_fields JSONB DEFAULT '[]', original_file_url TEXT,
      expires_at TIMESTAMP, sent_to_customer_at TIMESTAMP,
      completed_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sync_status (
      entity_type TEXT PRIMARY KEY, last_synced_at TIMESTAMP,
      record_count INTEGER DEFAULT 0, status TEXT DEFAULT 'idle', error TEXT
    );
    CREATE TABLE IF NOT EXISTS generic_entities (
      id TEXT NOT NULL, entity_type TEXT NOT NULL, company_id TEXT,
      data JSONB DEFAULT '{}', created_date TIMESTAMP DEFAULT NOW(),
      updated_date TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (id, entity_type)
    );
    CREATE TABLE IF NOT EXISTS pending_signups (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      company_name TEXT NOT NULL,
      verification_token TEXT NOT NULL UNIQUE,
      token_expires_at TIMESTAMP NOT NULL,
      is_confirmed BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      first_name TEXT,
      last_name TEXT,
      profile_image_url TEXT,
      password_hash TEXT,
      is_local_auth BOOLEAN DEFAULT false,
      must_change_password BOOLEAN DEFAULT false,
      company_id TEXT,
      platform_role TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess JSONB NOT NULL,
      expire TIMESTAMP NOT NULL
    );
  `);

  try {
    await p.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_local_auth BOOLEAN DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_role TEXT DEFAULT NULL;
    `);
  } catch (err) {
    console.warn('[DB] ALTER TABLE users skipped (columns may already exist):', err.message);
  }

  // Persistent file uploads - survives across deployments
  await p.query(`
    CREATE TABLE IF NOT EXISTS file_uploads (
      id TEXT PRIMARY KEY,
      original_filename TEXT,
      mime_type TEXT,
      file_size BIGINT,
      file_data BYTEA NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // In-app notifications table
  await p.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      user_email TEXT,
      title TEXT,
      message TEXT,
      type TEXT DEFAULT 'info',
      related_entity_type TEXT,
      related_entity_id TEXT,
      link_url TEXT,
      is_read BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_generic_entity_type ON generic_entities(entity_type);
    CREATE INDEX IF NOT EXISTS idx_generic_company ON generic_entities(company_id);
    CREATE INDEX IF NOT EXISTS idx_leads_company ON leads(company_id);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(company_id, status);
    CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company_id);
    CREATE INDEX IF NOT EXISTS idx_estimates_company ON estimates(company_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(company_id, status);
    CREATE INDEX IF NOT EXISTS idx_payments_company ON payments(company_id);
    CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_company ON tasks(company_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(company_id, status);
    CREATE INDEX IF NOT EXISTS idx_calendar_company ON calendar_events(company_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_time ON calendar_events(company_id, start_time);
    CREATE INDEX IF NOT EXISTS idx_comms_company ON communications(company_id);
    CREATE INDEX IF NOT EXISTS idx_staff_company ON staff_profiles(company_id);
    CREATE INDEX IF NOT EXISTS idx_staff_twilio ON staff_profiles(twilio_number);
    CREATE INDEX IF NOT EXISTS idx_call_routing ON call_routing_cache(company_id);
    CREATE INDEX IF NOT EXISTS idx_signing_token ON signing_sessions(signing_token);
    CREATE INDEX IF NOT EXISTS idx_signing_company ON signing_sessions(company_id);
    CREATE INDEX IF NOT EXISTS idx_signing_base44 ON signing_sessions(base44_session_id);
    CREATE INDEX IF NOT EXISTS idx_pending_signups_token ON pending_signups(verification_token);
    CREATE INDEX IF NOT EXISTS idx_pending_signups_email ON pending_signups(email);
    CREATE INDEX IF NOT EXISTS idx_notifications_company ON notifications(company_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_email);
    CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(company_id, is_read);
  `);

  console.log('[DB] Production database schema initialized');

  // Auto-clear is_administrator on non-owner staff profiles (security hardening - runs every boot)
  try {
    const clearResult = await p.query(`
      UPDATE staff_profiles sp
      SET is_administrator = false
      FROM companies c
      WHERE sp.company_id = c.id
        AND sp.is_administrator = true
        AND (sp.user_email IS NULL OR sp.user_email != c.created_by)
        AND (sp.email IS NULL OR sp.email != c.created_by)
    `);
    if (clearResult.rowCount > 0) {
      console.log('[Security] Cleared is_administrator on ' + clearResult.rowCount + ' non-owner staff profile(s)');
    }
  } catch (err) {
    console.error('[Security] Error clearing is_administrator:', err.message);
  }

  // Migrate saved MenuSettings to include any new nav items added after last save
  try {
    await migrateMenuSettingsNewItems(p);
  } catch (err) {
    console.error('[MenuSettings] Migration error:', err.message);
  }

  // Migrate existing Communication records from generic_entities to communications table
  try {
    const { rows: genComms } = await p.query(
      `SELECT id, company_id, data FROM generic_entities WHERE entity_type = 'Communication'`
    );
    if (genComms.length > 0) {
      let migrated = 0;
      for (const row of genComms) {
        const d = row.data || {};
        const durMins = d.duration_seconds ? Math.round(d.duration_seconds / 60 * 10) / 10 : (d.duration_minutes || null);
        const extraData = {};
        const knownCols = ['id','company_id','communication_type','direction','contact_name','contact_phone','contact_email','subject','body','message','status','duration_minutes','lead_id','customer_id','created_by'];
        for (const [k, v] of Object.entries(d)) { if (!knownCols.includes(k)) extraData[k] = v; }
        await p.query(
          `INSERT INTO communications (id, company_id, type, communication_type, direction, contact_phone, contact_email, contact_name, subject, message, body, status, duration_minutes, lead_id, customer_id, created_by, data, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
          [row.id, row.company_id, d.communication_type||d.type||'call', d.communication_type||d.type||'call', d.direction||'inbound', d.contact_phone||d.caller_phone||null, d.contact_email||null, d.contact_name||null, d.subject||null, d.message||d.message_body||null, d.body||null, d.status||'completed', durMins, d.lead_id||null, d.customer_id||null, d.created_by||null, JSON.stringify(extraData)]
        );
        migrated++;
      }
      console.log(`[DB] Migrated ${migrated} Communication records from generic_entities to communications table`);
    }
  } catch (e) {
    console.warn('[DB] Communication migration skipped:', e.message);
  }

  // Auto-seed platform company on fresh database
  try {
    const existing = await p.query("SELECT id FROM companies WHERE id = 'companysync_master_001' LIMIT 1");
    if (existing.rows.length === 0) {
      console.log('[Init] Fresh database detected — seeding platform company...');
      await p.query(
        `INSERT INTO companies (id, name, company_name, created_by, email, preferred_language, subscription_plan, subscription_status, max_users, max_leads, is_deleted, created_at, updated_at)
         VALUES ('companysync_master_001', 'CompanySync', 'CompanySync', 'io.companysync@gmail.com', 'io.companysnc@gmail.com', 'en', 'enterprise', 'active', 999999, 999999, false, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`
      );
      await p.query(
        `INSERT INTO staff_profiles (id, company_id, name, full_name, email, user_email, role, is_administrator, is_super_admin, is_active, created_at, updated_at)
         VALUES ('staff_companysync_001', 'companysync_master_001', 'Kevin Stone', 'Kevin Stone', 'io.companysync@gmail.com', 'io.companysync@gmail.com', 'admin', true, true, true, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`
      );
      await seedDefaultTemplates(p, 'companysync_master_001', 'CompanySync');
      console.log('[Init] Platform company seeded successfully');
    }
  } catch (err) {
    console.error('[Init] Error seeding platform company:', err.message);
  }

  // Always ensure YICN tenant company exists (idempotent)
  try {
    const yicnExists = await p.query("SELECT id FROM companies WHERE id = 'yicn_roofing_001' LIMIT 1");
    if (yicnExists.rows.length === 0) {
      console.log('[Init] Seeding YICN Roofing tenant company...');
      await p.query(
        `INSERT INTO companies (id, name, company_name, created_by, email, preferred_language, subscription_plan, subscription_status, max_users, max_leads, is_deleted, created_at, updated_at)
         VALUES ('yicn_roofing_001', 'YICN Roofing', 'YICN Roofing', 'io.companysync@gmail.com', 'io.companysync@gmail.com', 'en', 'enterprise', 'active', 999999, 999999, false, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`
      );
      console.log('[Init] YICN Roofing tenant seeded');
    }
  } catch (err) {
    console.error('[Init] Error seeding YICN company:', err.message);
  }

  // Always ensure platform admin user account exists (runs on every boot, idempotent)
  try {
    const userExists = await p.query("SELECT id FROM users WHERE email = 'io.companysync@gmail.com' LIMIT 1");
    if (userExists.rows.length === 0) {
      console.log('[Init] Seeding platform admin user account...');
      await p.query(
        `INSERT INTO users (id, email, first_name, last_name, password_hash, is_local_auth, must_change_password, company_id, platform_role, created_at, updated_at)
         VALUES ('user_companysync_admin_001', 'io.companysync@gmail.com', 'Kevin', 'Stone', $1, true, false, 'companysync_master_001', 'super_admin', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        ['$2b$10$/v1Vwd20gPDixxPSrYBizuAT748OibaKQqeQnwYA4UWvp.LQ8mlMq']
      );
      console.log('[Init] Platform admin user seeded');
    }
  } catch (err) {
    console.error('[Init] Error seeding admin user:', err.message);
  }
}

function generateId() {
  return 'loc_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

async function syncEntityBatch(entityType, records, companyId) {
  const p = getPool();
  const ENTITY_FIELDS = {
    leads: ['name', 'email', 'phone', 'address', 'status', 'source', 'assigned_to', 'service_needed', 'lead_score', 'notes'],
    customers: ['name', 'email', 'phone', 'address', 'status', 'total_revenue'],
    estimates: ['customer_id', 'customer_name', 'title', 'status', 'total_amount'],
    invoices: ['customer_id', 'customer_name', 'invoice_number', 'status', 'total_amount', 'amount_paid', 'due_date'],
    payments: ['invoice_id', 'customer_name', 'amount', 'payment_method', 'payment_date'],
    projects: ['customer_id', 'customer_name', 'title', 'status', 'start_date', 'end_date', 'total_value'],
    tasks: ['title', 'status', 'priority', 'assigned_to', 'due_date', 'related_to'],
    calendar_events: ['title', 'event_type', 'start_time', 'end_time', 'location', 'attendees'],
    communications: ['type', 'direction', 'contact_name', 'contact_phone', 'contact_email', 'subject', 'body', 'status'],
    staff_profiles: ['name', 'email', 'user_email', 'role', 'role_id', 'phone', 'cell_phone', 'call_routing_mode', 'availability_status', 'twilio_number', 'is_administrator', 'is_super_admin'],
    companies: ['name', 'company_name', 'company_tagline', 'company_logo', 'logo_url', 'created_by', 'is_deleted', 'phone', 'email', 'address', 'preferred_language', 'subscription_plan'],
  };

  const fields = ENTITY_FIELDS[entityType];
  if (!fields) return { synced: 0, errors: 0 };

  let synced = 0, errors = 0;
  for (const record of records) {
    try {
      const base44Id = record.id || record._id || generateId();
      const localId = generateId();
      const recCompanyId = record.company_id || companyId;
      const fieldValues = {};
      for (const f of fields) {
        if (record[f] !== undefined) fieldValues[f] = record[f];
      }
      const remainingData = {};
      for (const [k, v] of Object.entries(record)) {
        if (k !== 'id' && k !== '_id' && k !== 'company_id' && !fields.includes(k)) remainingData[k] = v;
      }

      if (entityType === 'companies') {
        const cols = Object.keys(fieldValues);
        const vals = Object.values(fieldValues);
        const setClause = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
        const placeholders = cols.map((_, i) => `$${i + 3}`).join(', ');
        await p.query(
          `INSERT INTO ${entityType} (id, base44_id, ${cols.join(', ')}, data, synced_at) VALUES ($1, $2, ${placeholders}, $${cols.length + 3}, NOW()) ON CONFLICT (base44_id) DO UPDATE SET ${setClause}, data = $${cols.length + 3}, synced_at = NOW()`,
          [localId, base44Id, ...vals, JSON.stringify(remainingData)]
        );
      } else {
        const cols = Object.keys(fieldValues);
        const vals = Object.values(fieldValues);
        const setClause = cols.map((c, i) => `${c} = $${i + 4}`).join(', ');
        const placeholders = cols.map((_, i) => `$${i + 4}`).join(', ');
        await p.query(
          `INSERT INTO ${entityType} (id, base44_id, company_id, ${cols.join(', ')}, data, synced_at) VALUES ($1, $2, $3, ${placeholders}, $${cols.length + 4}, NOW()) ON CONFLICT (base44_id) DO UPDATE SET company_id = $3, ${setClause}, data = $${cols.length + 4}, synced_at = NOW()`,
          [localId, base44Id, recCompanyId, ...vals, JSON.stringify(remainingData)]
        );
      }
      synced++;
    } catch (err) {
      errors++;
    }
  }

  await p.query(
    `INSERT INTO sync_status (entity_type, last_synced_at, record_count, status) VALUES ($1, NOW(), $2, 'completed') ON CONFLICT (entity_type) DO UPDATE SET last_synced_at = NOW(), record_count = $2, status = 'completed', error = NULL`,
    [entityType, synced]
  );

  return { synced, errors };
}

async function getDashboardData(companyId) {
  const p = getPool();
  const [leadStats, invoiceStats, customerCount, estimateStats, projectStats, taskStats, recentLeads, recentPayments, upcomingEvents, recentComms, staffList] = await Promise.all([
    p.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'new') as new_count, COUNT(*) FILTER (WHERE status = 'contacted') as contacted_count, COUNT(*) FILTER (WHERE status = 'qualified') as qualified_count, COUNT(*) FILTER (WHERE status = 'won' OR status = 'converted') as won_count, COUNT(*) FILTER (WHERE status = 'lost') as lost_count, COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as last_30_days, COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as last_7_days FROM leads WHERE company_id = $1`, [companyId]),
    p.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'paid') as paid_count, COUNT(*) FILTER (WHERE status = 'sent' OR status = 'pending') as outstanding_count, COUNT(*) FILTER (WHERE status = 'overdue') as overdue_count, COALESCE(SUM(total_amount), 0) as total_amount, COALESCE(SUM(amount_paid), 0) as total_paid, COALESCE(SUM(total_amount) FILTER (WHERE status = 'sent' OR status = 'pending' OR status = 'overdue'), 0) as outstanding_amount FROM invoices WHERE company_id = $1`, [companyId]),
    p.query('SELECT COUNT(*) as total FROM customers WHERE company_id = $1', [companyId]),
    p.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'draft') as draft_count, COUNT(*) FILTER (WHERE status = 'sent') as sent_count, COUNT(*) FILTER (WHERE status = 'approved' OR status = 'accepted') as approved_count, COALESCE(SUM(total_amount), 0) as total_value, COALESCE(SUM(total_amount) FILTER (WHERE status = 'approved' OR status = 'accepted'), 0) as approved_value FROM estimates WHERE company_id = $1`, [companyId]),
    p.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'active' OR status = 'in_progress') as active_count, COUNT(*) FILTER (WHERE status = 'completed') as completed_count, COALESCE(SUM(total_value), 0) as total_value FROM projects WHERE company_id = $1`, [companyId]),
    p.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'pending' OR status = 'todo') as pending_count, COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_count, COUNT(*) FILTER (WHERE status = 'completed' OR status = 'done') as completed_count, COUNT(*) FILTER (WHERE due_date < NOW() AND status != 'completed' AND status != 'done') as overdue_count FROM tasks WHERE company_id = $1`, [companyId]),
    p.query(`SELECT id, base44_id, name, email, phone, status, source, assigned_to, service_needed, created_at, data FROM leads WHERE company_id = $1 ORDER BY created_at DESC LIMIT 10`, [companyId]),
    p.query(`SELECT id, base44_id, customer_name, amount, payment_method, payment_date, data FROM payments WHERE company_id = $1 ORDER BY payment_date DESC LIMIT 10`, [companyId]),
    p.query(`SELECT id, base44_id, title, event_type, start_time, end_time, location, data FROM calendar_events WHERE company_id = $1 AND start_time >= NOW() ORDER BY start_time ASC LIMIT 15`, [companyId]),
    p.query(`SELECT id, base44_id, type, direction, contact_name, subject, status, created_at, data FROM communications WHERE company_id = $1 ORDER BY created_at DESC LIMIT 10`, [companyId]),
    p.query(`SELECT id, base44_id, name, email, role, phone, availability_status, data FROM staff_profiles WHERE company_id = $1`, [companyId]),
  ]);

  return {
    leads: { stats: leadStats.rows[0], recent: recentLeads.rows },
    invoices: { stats: invoiceStats.rows[0] },
    customers: { total: parseInt(customerCount.rows[0].total) },
    estimates: { stats: estimateStats.rows[0] },
    projects: { stats: projectStats.rows[0] },
    tasks: { stats: taskStats.rows[0] },
    payments: { recent: recentPayments.rows },
    calendar: { upcoming: upcomingEvents.rows },
    communications: { recent: recentComms.rows },
    staff: staffList.rows,
  };
}

async function getCallRouting(phoneNumber) {
  const p = getPool();
  const normalized = normalizePhoneProd(phoneNumber);
  const result = await p.query('SELECT * FROM call_routing_cache WHERE phone_number = $1', [normalized]);
  const row = result.rows[0];
  if (!row) return null;

  // Auto after-hours logic
  if (row.routing_mode !== 'sarah_answers') {
    try {
      const data = row.data || {};
      if (data.after_hours_enabled && data.after_hours_start && data.after_hours_end) {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentMins = currentHour * 60 + currentMinute;
        const [startH, startM] = data.after_hours_start.split(':').map(Number);
        const [endH, endM] = data.after_hours_end.split(':').map(Number);
        const startMins = startH * 60 + (startM || 0);
        const endMins = endH * 60 + (endM || 0);
        // Outside business hours → route to Sarah
        if (currentMins < startMins || currentMins >= endMins) {
          console.log(`[Routing] After-hours override: ${currentHour}:${currentMinute} outside ${data.after_hours_start}-${data.after_hours_end}`);
          return { ...row, routing_mode: 'sarah_answers' };
        }
      }
    } catch (e) {}
  }

  return row;
}

function normalizePhoneProd(phone) {
  if (!phone) return '';
  let clean = phone.replace(/[^\d+]/g, '');
  if (clean.length === 10) clean = '+1' + clean;
  else if (clean.length === 11 && clean.startsWith('1')) clean = '+' + clean;
  else if (!clean.startsWith('+')) clean = '+' + clean;
  return clean;
}

async function getReportingData(companyId, reportType) {
  const p = getPool();
  switch (reportType) {
    case 'revenue': return (await p.query(`SELECT DATE_TRUNC('month', payment_date) as month, SUM(amount) as total, COUNT(*) as payment_count FROM payments WHERE company_id = $1 AND payment_date IS NOT NULL GROUP BY DATE_TRUNC('month', payment_date) ORDER BY month DESC LIMIT 12`, [companyId])).rows;
    case 'ar_aging': return (await p.query(`SELECT customer_name, SUM(total_amount - amount_paid) as outstanding, MIN(due_date) as oldest_due, COUNT(*) as invoice_count FROM invoices WHERE company_id = $1 AND status != 'paid' AND total_amount > amount_paid GROUP BY customer_name ORDER BY outstanding DESC`, [companyId])).rows;
    case 'lead_conversion': return (await p.query(`SELECT source, COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'won' OR status = 'converted') as converted, ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'won' OR status = 'converted') / NULLIF(COUNT(*), 0), 1) as conversion_rate FROM leads WHERE company_id = $1 GROUP BY source ORDER BY total DESC`, [companyId])).rows;
    default: return [];
  }
}

const DEDICATED_TABLES = {
  companies: { table: 'companies', companyField: 'id' },
  staff_profiles: { table: 'staff_profiles', companyField: 'company_id' },
  leads: { table: 'leads', companyField: 'company_id' },
  customers: { table: 'customers', companyField: 'company_id' },
  estimates: { table: 'estimates', companyField: 'company_id' },
  invoices: { table: 'invoices', companyField: 'company_id' },
  payments: { table: 'payments', companyField: 'company_id' },
  projects: { table: 'projects', companyField: 'company_id' },
  tasks: { table: 'tasks', companyField: 'company_id' },
  calendar_events: { table: 'calendar_events', companyField: 'company_id' },
  signing_sessions: { table: 'signing_sessions', companyField: 'company_id' },
  inspector_profiles: { table: 'inspector_profiles', companyField: 'company_id' },
  Communication: { table: 'communications', companyField: 'company_id' },
  transaction_mapping_rules: { table: 'transaction_mapping_rules', companyField: 'company_id' },
};

const SDK_TO_TABLE = {
  Company: 'companies', StaffProfile: 'staff_profiles', Lead: 'leads',
  Customer: 'customers', Estimate: 'estimates', Invoice: 'invoices',
  Payment: 'payments', Project: 'projects', Task: 'tasks',
  CalendarEvent: 'calendar_events',
  ContractSigningSession: 'signing_sessions',
  InspectorProfile: 'inspector_profiles',
  TransactionMappingRule: 'transaction_mapping_rules',
};

function sdkNameToEntityType(sdkName) {
  return SDK_TO_TABLE[sdkName] || sdkName;
}

function isDedicatedTable(entityType) {
  return !!DEDICATED_TABLES[entityType];
}

function buildFilterWhere(filters, startIdx = 1) {
  const clauses = []; const values = []; let idx = startIdx;
  for (const [key, val] of Object.entries(filters)) {
    if (key === '_sort' || key === '_limit' || key === '_offset' || key === 'company_id') continue;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if (val.$ne !== undefined) { if (val.$ne === null) { clauses.push(`data->>'${key}' IS NOT NULL`); } else { clauses.push(`data->>'${key}' != $${idx}`); values.push(String(val.$ne)); idx++; } }
      if (val.$in && Array.isArray(val.$in)) { const ph = val.$in.map((_, i) => `$${idx + i}`); clauses.push(`data->>'${key}' IN (${ph.join(',')})`); values.push(...val.$in.map(String)); idx += val.$in.length; }
      if (val.$gt !== undefined) { clauses.push(`(data->>'${key}')::numeric > $${idx}`); values.push(val.$gt); idx++; }
      if (val.$gte !== undefined) { clauses.push(`(data->>'${key}')::numeric >= $${idx}`); values.push(val.$gte); idx++; }
      if (val.$lt !== undefined) { clauses.push(`(data->>'${key}')::numeric < $${idx}`); values.push(val.$lt); idx++; }
      if (val.$lte !== undefined) { clauses.push(`(data->>'${key}')::numeric <= $${idx}`); values.push(val.$lte); idx++; }
      if (val.$contains !== undefined) { clauses.push(`data->>'${key}' ILIKE $${idx}`); values.push(`%${val.$contains}%`); idx++; }
    } else {
      if (val === null) { clauses.push(`(data->>'${key}' IS NULL OR data->>'${key}' = '')`); }
      else { clauses.push(`data->>'${key}' = $${idx}`); values.push(String(val)); idx++; }
    }
  }
  return { clauses, values, nextIdx: idx };
}

function sanitizeValueForColumn(key, val, columnDataTypes) {
  const colType = columnDataTypes ? columnDataTypes[key] : null;
  const isTimestampCol = colType && (colType.includes('timestamp') || colType.includes('date'));
  const looksLikeTimestamp = !colType && (key.endsWith('_date') || key.endsWith('_at') || key === 'due_date' || key === 'start_date' || key === 'end_date' || key === 'start_time' || key === 'end_time' || key === 'expires_at' || key === 'payment_date');
  if ((isTimestampCol || looksLikeTimestamp) && (val === '' || val === undefined)) return null;
  const isNumericCol = colType && (colType.includes('numeric') || colType.includes('integer') || colType.includes('decimal'));
  if (isNumericCol && (val === '' || val === undefined)) return null;
  return val;
}

async function getColumnDataTypes(p, tableName) {
  const result = await p.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`, [tableName]);
  const types = {};
  for (const row of result.rows) types[row.column_name] = row.data_type;
  return types;
}

function buildDedicatedFilterWhere(filters, startIdx = 1, tableColumns = null) {
  const clauses = []; const values = []; let idx = startIdx;
  for (const [key, val] of Object.entries(filters)) {
    if (key === '_sort' || key === '_limit' || key === '_offset' || key === 'company_id') continue;
    const isDirectCol = !tableColumns || tableColumns.has(key);
    const colRef = isDirectCol ? `"${key}"` : `data->>'${key}'`;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if (val.$ne !== undefined) { if (val.$ne === null) { clauses.push(`${colRef} IS NOT NULL`); } else { clauses.push(`${colRef} != $${idx}`); values.push(isDirectCol ? val.$ne : String(val.$ne)); idx++; } }
      if (val.$in && Array.isArray(val.$in)) { const ph = val.$in.map((_, i) => `$${idx + i}`); clauses.push(`${colRef} IN (${ph.join(',')})`); values.push(...val.$in.map(v => isDirectCol ? v : String(v))); idx += val.$in.length; }
      if (val.$contains !== undefined) { clauses.push(`${colRef} ILIKE $${idx}`); values.push(`%${val.$contains}%`); idx++; }
      if (val.$gt !== undefined) { if (isDirectCol) { clauses.push(`"${key}" > $${idx}`); values.push(val.$gt); } else { clauses.push(`(data->>'${key}')::numeric > $${idx}`); values.push(Number(val.$gt)); } idx++; }
      if (val.$gte !== undefined) { if (isDirectCol) { clauses.push(`"${key}" >= $${idx}`); values.push(val.$gte); } else { clauses.push(`(data->>'${key}')::numeric >= $${idx}`); values.push(Number(val.$gte)); } idx++; }
      if (val.$lt !== undefined) { if (isDirectCol) { clauses.push(`"${key}" < $${idx}`); values.push(val.$lt); } else { clauses.push(`(data->>'${key}')::numeric < $${idx}`); values.push(Number(val.$lt)); } idx++; }
      if (val.$lte !== undefined) { if (isDirectCol) { clauses.push(`"${key}" <= $${idx}`); values.push(val.$lte); } else { clauses.push(`(data->>'${key}')::numeric <= $${idx}`); values.push(Number(val.$lte)); } idx++; }
    } else {
      if (val === null) { clauses.push(`(${colRef} IS NULL OR ${colRef} = '')`); }
      else { clauses.push(`${colRef} = $${idx}`); values.push(isDirectCol ? val : String(val)); idx++; }
    }
  }
  return { clauses, values, nextIdx: idx };
}

function parseSortParam(sortStr) {
  if (!sortStr) return { column: 'created_date', direction: 'DESC' };
  const desc = sortStr.startsWith('-');
  const column = desc ? sortStr.slice(1) : sortStr;
  return { column, direction: desc ? 'DESC' : 'ASC' };
}

async function universalFilter(p, entityType, filters, sort, limit) {
  const companyId = filters.company_id;
  const { column: sortCol, direction: sortDir } = parseSortParam(sort);
  if (isDedicatedTable(entityType)) {
    const tableInfo = DEDICATED_TABLES[entityType];
    const columnDataTypes = await getColumnDataTypes(p, tableInfo.table);
    const tableColumns = new Set(Object.keys(columnDataTypes));
    const filterCopy = { ...filters }; delete filterCopy.company_id;
    const whereParts = []; const values = []; let idx = 1;
    if (companyId && tableInfo.companyField !== 'id') { whereParts.push(`${tableInfo.companyField} = $${idx}`); values.push(companyId); idx++; }
    else if (companyId && tableInfo.companyField === 'id') { whereParts.push(`id = $${idx}`); values.push(companyId); idx++; }
    const { clauses, values: fv } = buildDedicatedFilterWhere(filterCopy, idx, tableColumns);
    whereParts.push(...clauses); values.push(...fv);
    const whereStr = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
    let orderCol = sortCol;
    if (sortCol === 'created_date') orderCol = 'created_at';
    if (sortCol === 'updated_date') orderCol = 'updated_at';
    if (!tableColumns.has(orderCol) && orderCol !== 'created_at' && orderCol !== 'updated_at') orderCol = `data->>'${sortCol}'`;
    const sql = `SELECT * FROM ${tableInfo.table} ${whereStr} ORDER BY ${orderCol} ${sortDir} NULLS LAST LIMIT ${parseInt(limit) || 1000}`;
    const result = await p.query(sql, values);
    return result.rows.map(row => {
      const merged = { ...row };
      if (row.data && typeof row.data === 'object') { for (const [k, v] of Object.entries(row.data)) { if (merged[k] === undefined || merged[k] === null || merged[k] === '') merged[k] = v; } }
      if (row.created_at) merged.created_date = row.created_at;
      if (row.updated_at) merged.updated_date = row.updated_at;
      if (tableInfo.table === 'staff_profiles') { if (!merged.full_name && merged.name) merged.full_name = merged.name; if (!merged.name && merged.full_name) merged.name = merged.full_name; }
      return merged;
    });
  }
  const whereParts = []; const values = []; let idx = 1;
  whereParts.push(`entity_type = $${idx}`); values.push(entityType); idx++;
  if (companyId) { whereParts.push(`company_id = $${idx}`); values.push(companyId); idx++; }
  const filterCopy = { ...filters }; delete filterCopy.company_id;
  // id is a top-level column on generic_entities, not inside data JSON — handle it directly
  if (filterCopy.id !== undefined) { whereParts.push(`id = $${idx}`); values.push(String(filterCopy.id)); idx++; delete filterCopy.id; }
  const { clauses, values: fv } = buildFilterWhere(filterCopy, idx);
  whereParts.push(...clauses); values.push(...fv);
  const whereStr = `WHERE ${whereParts.join(' AND ')}`;
  let orderExpr = sortCol === 'created_date' ? `created_date ${sortDir}` : sortCol === 'updated_date' ? `updated_date ${sortDir}` : `data->>'${sortCol}' ${sortDir}`;
  const sql = `SELECT * FROM generic_entities ${whereStr} ORDER BY ${orderExpr} NULLS LAST LIMIT ${parseInt(limit) || 1000}`;
  const result = await p.query(sql, values);
  return result.rows.map(row => ({ id: row.id, company_id: row.company_id, created_date: row.created_date, updated_date: row.updated_date, ...(row.data || {}) }));
}

async function universalGet(p, entityType, id) {
  if (isDedicatedTable(entityType)) {
    const tableInfo = DEDICATED_TABLES[entityType];
    const result = await p.query(`SELECT * FROM ${tableInfo.table} WHERE id = $1`, [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0]; const merged = { ...row };
    if (row.data && typeof row.data === 'object') { for (const [k, v] of Object.entries(row.data)) { if (merged[k] === undefined || merged[k] === null || merged[k] === '') merged[k] = v; } }
    if (row.created_at) merged.created_date = row.created_at;
    if (row.updated_at) merged.updated_date = row.updated_at;
    if (tableInfo.table === 'staff_profiles') { if (!merged.full_name && merged.name) merged.full_name = merged.name; if (!merged.name && merged.full_name) merged.name = merged.full_name; }
    return merged;
  }
  const result = await p.query('SELECT * FROM generic_entities WHERE id = $1 AND entity_type = $2', [id, entityType]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return { id: row.id, company_id: row.company_id, created_date: row.created_date, updated_date: row.updated_date, ...(row.data || {}) };
}

async function universalCreate(p, entityType, data) {
  const id = data.id || 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const companyId = data.company_id || null;
  if (isDedicatedTable(entityType)) {
    const tableInfo = DEDICATED_TABLES[entityType];
    const columnDataTypes = await getColumnDataTypes(p, tableInfo.table);
    const tableColumns = new Set(Object.keys(columnDataTypes));
    const idColType = columnDataTypes['id'] || '';
    const isAutoIncrementId = idColType === 'integer' || idColType === 'bigint';
    
    // Check if we're trying to insert a string into an integer ID column
    const finalId = (isAutoIncrementId && typeof id === 'string' && id.startsWith('local_')) ? undefined : id;

    const directCols = (isAutoIncrementId && finalId === undefined) ? [] : ['id'];
    const directVals = (isAutoIncrementId && finalId === undefined) ? [] : [finalId];
    const extraData = {};
    for (const [key, val] of Object.entries(data)) {
      if (key === 'id') continue;
      if (tableColumns.has(key)) {
        directCols.push(key);
        const sanitized = sanitizeValueForColumn(key, val, columnDataTypes);
        if (sanitized !== null && typeof sanitized === 'object' && !Array.isArray(sanitized) && key !== 'data') directVals.push(JSON.stringify(sanitized));
        else if (Array.isArray(sanitized)) directVals.push(JSON.stringify(sanitized));
        else directVals.push(sanitized);
      } else { extraData[key] = val; }
    }
    if (Object.keys(extraData).length > 0 && tableColumns.has('data')) {
      const existingDataIdx = directCols.indexOf('data');
      if (existingDataIdx !== -1) {
        const existing = typeof directVals[existingDataIdx] === 'string' ? JSON.parse(directVals[existingDataIdx]) : (directVals[existingDataIdx] || {});
        directVals[existingDataIdx] = JSON.stringify({ ...existing, ...extraData });
      } else { directCols.push('data'); directVals.push(JSON.stringify(extraData)); }
    }
    if (!directCols.includes('created_at') && tableColumns.has('created_at')) { directCols.push('created_at'); directVals.push(new Date()); }
    if (!directCols.includes('updated_at') && tableColumns.has('updated_at')) { directCols.push('updated_at'); directVals.push(new Date()); }
    const placeholders = directCols.map((_, i) => `$${i + 1}`).join(',');
    const sql = `INSERT INTO ${tableInfo.table} (${directCols.map(c => `"${c}"`).join(',')}) VALUES (${placeholders}) RETURNING *`;
    const insertResult = await p.query(sql, directVals);
    const row = insertResult.rows[0]; const merged = { ...row };
    if (row.data && typeof row.data === 'object') { for (const [k, v] of Object.entries(row.data)) { if (merged[k] === undefined || merged[k] === null || merged[k] === '') merged[k] = v; } }
    if (row.created_at) merged.created_date = row.created_at;
    if (row.updated_at) merged.updated_date = row.updated_at;
    return merged;
  }
  const entityData = { ...data }; delete entityData.id; delete entityData.company_id;
  await p.query(`INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, $2, $3, $4, NOW(), NOW()) ON CONFLICT (id, entity_type) DO UPDATE SET data = $4, updated_date = NOW()`, [id, entityType, companyId, JSON.stringify(entityData)]);
  return { id, company_id: companyId, ...entityData, created_date: new Date(), updated_date: new Date() };
}

async function universalUpdate(p, entityType, id, data) {
  if (isDedicatedTable(entityType)) {
    const tableInfo = DEDICATED_TABLES[entityType];
    const columnDataTypes = await getColumnDataTypes(p, tableInfo.table);
    const tableColumns = new Set(Object.keys(columnDataTypes));
    const updates = []; const values = []; const extraData = {}; const usedCols = new Set(); let idx = 1;
    for (const [key, val] of Object.entries(data)) {
      if (key === 'id' || key === 'created_date' || key === 'created_at' || key === 'updated_at' || key === 'updated_date') continue;
      if (tableColumns.has(key) && key !== 'data') {
        if (usedCols.has(key)) continue;
        usedCols.add(key);
        const sanitized = sanitizeValueForColumn(key, val, columnDataTypes);
        updates.push(`"${key}" = $${idx}`);
        if (sanitized !== null && typeof sanitized === 'object' && !Array.isArray(sanitized)) values.push(JSON.stringify(sanitized));
        else if (Array.isArray(sanitized)) values.push(JSON.stringify(sanitized));
        else values.push(sanitized);
        idx++;
      } else if (key !== 'data') { extraData[key] = val; }
    }
    if (Object.keys(extraData).length > 0 && tableColumns.has('data')) { updates.push(`data = COALESCE(data, '{}')::jsonb || $${idx}::jsonb`); values.push(JSON.stringify(extraData)); idx++; }
    if (tableColumns.has('updated_at')) { updates.push(`"updated_at" = $${idx}`); values.push(new Date()); idx++; }
    if (updates.length === 0) return universalGet(p, entityType, id);
    values.push(id);
    const sql = `UPDATE ${tableInfo.table} SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
    const updateResult = await p.query(sql, values);
    if (updateResult.rows.length === 0) throw new Error('Record not found');
    const row = updateResult.rows[0]; const merged = { ...row };
    if (row.data && typeof row.data === 'object') { for (const [k, v] of Object.entries(row.data)) { if (merged[k] === undefined || merged[k] === null || merged[k] === '') merged[k] = v; } }
    if (row.created_at) merged.created_date = row.created_at;
    if (row.updated_at) merged.updated_date = row.updated_at;
    return merged;
  }
  const existing = await p.query('SELECT data FROM generic_entities WHERE id = $1 AND entity_type = $2', [id, entityType]);
  const existingData = existing.rows.length > 0 ? (existing.rows[0].data || {}) : {};
  const mergedData = { ...existingData, ...data }; delete mergedData.id; delete mergedData.company_id;
  const companyId = data.company_id || null;
  if (existing.rows.length > 0) { await p.query(`UPDATE generic_entities SET data = $1, updated_date = NOW() WHERE id = $2 AND entity_type = $3`, [JSON.stringify(mergedData), id, entityType]); }
  else { await p.query(`INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, $2, $3, $4, NOW(), NOW())`, [id, entityType, companyId, JSON.stringify(mergedData)]); }
  return { id, company_id: companyId, ...mergedData, updated_date: new Date() };
}

async function universalDelete(p, entityType, id) {
  if (isDedicatedTable(entityType)) {
    const tableInfo = DEDICATED_TABLES[entityType];
    const result = await p.query(`DELETE FROM ${tableInfo.table} WHERE id = $1 RETURNING id`, [id]);
    return result.rows.length > 0;
  }
  const result = await p.query('DELETE FROM generic_entities WHERE id = $1 AND entity_type = $2 RETURNING id', [id, entityType]);
  return result.rows.length > 0;
}

async function universalBulkCreate(p, entityType, items) {
  const results = [];
  for (const item of items) { results.push(await universalCreate(p, entityType, item)); }
  return results;
}

const SMTP_AUTO_DETECT_MAP = {
  'gmail.com': { host: 'smtp.gmail.com', port: 587, encryption: 'STARTTLS' },
  'googlemail.com': { host: 'smtp.gmail.com', port: 587, encryption: 'STARTTLS' },
  'outlook.com': { host: 'smtp-mail.outlook.com', port: 587, encryption: 'STARTTLS' },
  'hotmail.com': { host: 'smtp-mail.outlook.com', port: 587, encryption: 'STARTTLS' },
  'live.com': { host: 'smtp-mail.outlook.com', port: 587, encryption: 'STARTTLS' },
  'office365.com': { host: 'smtp.office365.com', port: 587, encryption: 'STARTTLS' },
  'yahoo.com': { host: 'smtp.mail.yahoo.com', port: 465, encryption: 'SSL/TLS' },
  'ymail.com': { host: 'smtp.mail.yahoo.com', port: 465, encryption: 'SSL/TLS' },
  'zoho.com': { host: 'smtp.zoho.com', port: 465, encryption: 'SSL/TLS' },
  'zohomail.com': { host: 'smtp.zoho.com', port: 465, encryption: 'SSL/TLS' },
  'icloud.com': { host: 'smtp.mail.me.com', port: 587, encryption: 'STARTTLS' },
  'me.com': { host: 'smtp.mail.me.com', port: 587, encryption: 'STARTTLS' },
  'mac.com': { host: 'smtp.mail.me.com', port: 587, encryption: 'STARTTLS' },
  'aol.com': { host: 'smtp.aol.com', port: 465, encryption: 'SSL/TLS' },
  'godaddy.com': { host: 'smtpout.secureserver.net', port: 465, encryption: 'SSL/TLS' },
  'secureserver.net': { host: 'smtpout.secureserver.net', port: 465, encryption: 'SSL/TLS' },
  'titan.email': { host: 'smtp.titan.email', port: 465, encryption: 'SSL/TLS' },
  'titanemail.com': { host: 'smtp.titan.email', port: 465, encryption: 'SSL/TLS' },
  'fastmail.com': { host: 'smtp.fastmail.com', port: 465, encryption: 'SSL/TLS' },
  'protonmail.com': { host: '127.0.0.1', port: 1025, encryption: 'none', note: 'Requires ProtonMail Bridge' },
  'proton.me': { host: '127.0.0.1', port: 1025, encryption: 'none', note: 'Requires ProtonMail Bridge' },
  'gmx.com': { host: 'mail.gmx.com', port: 587, encryption: 'STARTTLS' },
  'mail.com': { host: 'smtp.mail.com', port: 587, encryption: 'STARTTLS' },
  'att.net': { host: 'smtp.mail.att.net', port: 465, encryption: 'SSL/TLS' },
  'comcast.net': { host: 'smtp.comcast.net', port: 587, encryption: 'STARTTLS' },
  'verizon.net': { host: 'smtp.verizon.net', port: 465, encryption: 'SSL/TLS' },
};

function getEncryptionKey() {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) throw new Error('ENCRYPTION_KEY environment variable not set');
  return Buffer.from(keyHex, 'hex');
}

function encryptApiKey(rawKey) {
  if (!rawKey) return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(rawKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptApiKey(encrypted) {
  if (!encrypted) return null;
  const parts = encrypted.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted key format');
  const [ivHex, authTagHex, ciphertext] = parts;
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function maskApiKey(raw) {
  if (!raw) return '';
  if (raw.length <= 4) return '••••';
  return '••••' + raw.slice(-4);
}

function detectSmtpSettings(email) {
  if (!email || !email.includes('@')) return null;
  const domain = email.split('@')[1].toLowerCase();
  const settings = SMTP_AUTO_DETECT_MAP[domain];
  if (settings) return { ...settings, domain, detected: true };
  return { host: `mail.${domain}`, port: 587, encryption: 'STARTTLS', domain, detected: false, note: 'Auto-guessed settings - please verify' };
}

function parseBodyJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

function getDefaultTemplates(companyId, companyName) {
  const isYICN = companyId === 'yicn_roofing_legacy';
  const co = companyName || 'Your Company';

  const sfAgeLife = isYICN ? {
    format_name: 'State Farm Standard (Age/Life)',
    category: 'insurance',
    insurance_company: 'State Farm',
    description: '🏦 State Farm AGE/LIFE format - Shows depreciation as Age/Life years. Auto-calculates ACV from RCV based on material lifespan.',
    columns: 9,
    column_headers: ['Code', 'Description', 'Qty', 'Unit', 'Unit Price', 'RCV', 'Age/Life', 'Depr %', 'ACV'],
    show_rcv_acv: true, show_depreciation: true, show_age_life: true,
    age_life_presets: { shingles: { life_years: 30, default_age: 15 }, underlayment: { life_years: 20, default_age: 10 }, felt: { life_years: 20, default_age: 10 }, flashing: { life_years: 20, default_age: 10 }, ice_water_shield: { life_years: 20, default_age: 0 } },
    rcv_label: 'RCV', acv_label: 'ACV', show_overhead_profit: true, overhead_profit_rate: 10,
    show_claim_number: true, show_insurance_company: true, show_policy_number: true, show_deductible: true, show_adjuster: false,
    header_text: 'YICN Roofing State Farm Preferred Contractor 216-999-6222',
    footer_text: 'All work meets State Farm guidelines. Questions? Contact your adjuster.',
    page_size: 'letter', font_size: 'medium', color_scheme: 'red', is_active: true,
  } : {
    format_name: 'State Farm Standard (Age/Life)',
    category: 'insurance', insurance_company: 'State Farm',
    description: 'State Farm format with age/life depreciation columns',
    columns: 9, column_headers: ['Code', 'Description', 'Qty', 'Unit', 'Unit Price', 'RCV', 'Age/Life', 'Depr %', 'ACV'],
    show_rcv_acv: true, show_depreciation: true, show_age_life: true,
    age_life_presets: { shingles: { life_years: 30, default_age: 15 }, underlayment: { life_years: 20, default_age: 10 }, felt: { life_years: 20, default_age: 10 }, flashing: { life_years: 20, default_age: 10 } },
    rcv_label: 'RCV', acv_label: 'ACV', show_overhead_profit: true, overhead_profit_rate: 10,
    show_claim_number: true, show_insurance_company: true, show_policy_number: true, show_deductible: true, show_adjuster: false,
    header_text: `${co} - State Farm Preferred Contractor`,
    footer_text: 'All work meets State Farm guidelines. Questions? Contact your adjuster.',
    page_size: 'letter', font_size: 'medium', color_scheme: 'red', is_active: true,
  };

  const safeco = isYICN ? {
    format_name: 'Safeco Standard (Symbility)',
    category: 'insurance', insurance_company: 'Safeco',
    description: '🛡️ Safeco/Liberty Mutual/Erie format - Full RCV/ACV with O&P calculations. Used by Symbility estimators.',
    columns: 8, column_headers: ['Description', 'Qty', 'Unit', 'Tax', 'Total'],
    show_rcv_acv: true, show_depreciation: false, show_age_life: false,
    rcv_label: 'Replacement Cost', acv_label: 'Actual Cash Value', show_overhead_profit: true, overhead_profit_rate: 10,
    show_claim_number: true, show_insurance_company: true, show_policy_number: true, show_deductible: true, show_adjuster: false,
    header_text: 'YICN Roofing Safeco/Liberty Mutual/Erie Approved 216-999-6222',
    footer_text: 'THIS ESTIMATE REPRESENTS OUR CURRENT EVALUATION OF THE COVERED DAMAGES TO THE STRUCTURE.',
    page_size: 'letter', font_size: 'medium', color_scheme: 'blue', is_active: true,
  } : {
    format_name: 'Safeco Standard (Symbility)',
    category: 'insurance', insurance_company: 'Safeco',
    description: 'Safeco/Liberty Mutual/Erie format - Full RCV/ACV with O&P calculations.',
    columns: 8, column_headers: ['Description', 'Qty', 'Unit', 'Tax', 'Total'],
    show_rcv_acv: true, show_depreciation: false, show_age_life: false,
    rcv_label: 'Replacement Cost', acv_label: 'Actual Cash Value', show_overhead_profit: true, overhead_profit_rate: 10,
    show_claim_number: true, show_insurance_company: true, show_policy_number: true, show_deductible: true, show_adjuster: false,
    header_text: `${co} - Safeco/Liberty Mutual/Erie Approved`,
    footer_text: 'THIS ESTIMATE REPRESENTS OUR CURRENT EVALUATION OF THE COVERED DAMAGES TO THE STRUCTURE.',
    page_size: 'letter', font_size: 'medium', color_scheme: 'blue', is_active: true,
  };

  const contractor = isYICN ? {
    format_name: 'Contractor Standard (CompanySync)',
    category: 'contractor', insurance_company: null,
    description: '🔨 Direct-to-customer contractor format - Simple Item/Qty/Rate/Amount layout.',
    columns: 6, column_headers: ['Item', 'Qty', 'Rate', 'Amount'],
    show_rcv_acv: false, show_depreciation: false, show_age_life: false,
    rcv_label: 'RCV', acv_label: 'ACV', show_overhead_profit: false, overhead_profit_rate: 0,
    show_claim_number: true, show_insurance_company: true, show_policy_number: true, show_deductible: true, show_adjuster: false,
    header_text: 'YICN Roofing 216-999-6222 | kevinstone@yicnteam.com 675 Alpha Dr, Highland Heights, OH 44143',
    footer_text: 'A 5-year workmanship warranty backs all work. If for any reason, the property owner or contractor selected have questions concerning our estimate, they should contact your claim representative directly.',
    page_size: 'letter', font_size: 'medium', color_scheme: 'green', is_active: true,
  } : {
    format_name: 'Contractor Standard (CompanySync)',
    category: 'contractor', insurance_company: null,
    description: 'Direct-to-customer contractor format - Simple Item/Qty/Rate/Amount layout.',
    columns: 4, column_headers: ['Item', 'Qty', 'Rate', 'Amount'],
    show_rcv_acv: false, show_depreciation: false, show_age_life: false,
    rcv_label: 'RCV', acv_label: 'ACV', show_overhead_profit: false, overhead_profit_rate: 0,
    show_claim_number: false, show_insurance_company: false, show_policy_number: false, show_deductible: false, show_adjuster: false,
    header_text: `${co}`,
    footer_text: 'A 5-year workmanship warranty backs all work. Price valid for 30 days from estimate date.',
    page_size: 'letter', font_size: 'medium', color_scheme: 'green', is_active: true,
  };

  return [
    sfAgeLife, safeco, contractor,
    {
      format_name: 'State Farm Standard (Xactimate)',
      category: 'insurance', insurance_company: 'State Farm',
      description: 'Standard State Farm insurance estimate format compatible with Xactimate pricing.',
      columns: 7, column_headers: ['Description', 'Quantity', 'Unit Price', 'Tax', 'RCV', 'ACV'],
      show_rcv_acv: false, show_depreciation: true, show_age_life: false,
      rcv_label: 'RCV', acv_label: 'ACV', show_overhead_profit: true, overhead_profit_rate: 10,
      show_claim_number: true, show_insurance_company: true, show_policy_number: true, show_deductible: true, show_adjuster: false,
      header_text: isYICN ? 'YICN Roofing State Farm Preferred Contractor 216-999-6222' : `${co}`,
      footer_text: 'ALL AMOUNTS PAYABLE ARE SUBJECT TO THE TERMS, CONDITIONS AND LIMITS OF YOUR POLICY.',
      page_size: 'letter', font_size: 'medium', color_scheme: 'blue', is_active: true,
    },
    {
      format_name: 'State Farm Standard (Copy)',
      category: 'insurance', insurance_company: 'State Farm',
      description: 'Standard State Farm estimate format with RCV/ACV calculations.',
      columns: 7, column_headers: ['Code', 'Description', 'Quantity', 'Unit', 'Unit Price', 'Tax', 'RCV'],
      show_rcv_acv: false, show_depreciation: true, show_age_life: false,
      rcv_label: 'RCV', acv_label: 'ACV', show_overhead_profit: true, overhead_profit_rate: 10,
      show_claim_number: true, show_insurance_company: true, show_policy_number: true, show_deductible: true, show_adjuster: false,
      header_text: isYICN ? 'YICN Roofing State Farm Preferred Contractor 216-999-6222' : `${co}`,
      footer_text: 'This estimate is priced based on estimated market pricing for the cost of materials, labor, and other factors at the time of the loss.',
      page_size: 'letter', font_size: 'medium', color_scheme: 'blue', is_active: true,
    },
    {
      format_name: 'Safeco Standard (Liberty Mutual)',
      category: 'insurance', insurance_company: 'Safeco / Liberty Mutual',
      description: 'Standard Safeco format used by Liberty Mutual and Erie. Full RCV/ACV calculations with detailed depreciation breakdown.',
      columns: 10, column_headers: ['Description', 'Quantity', 'Unit Price', 'Total O&P', 'Total Taxes', 'RC', 'Depreciation', 'ACV'],
      show_rcv_acv: true, show_depreciation: true, show_age_life: false,
      rcv_label: 'RCV', acv_label: 'ACV', show_overhead_profit: true, overhead_profit_rate: 10,
      show_claim_number: true, show_insurance_company: true, show_policy_number: true, show_deductible: true, show_adjuster: false,
      header_text: isYICN ? 'YICN Roofing Safeco/Liberty Mutual/Erie Approved 216-999-6222' : `${co} - Safeco/Liberty Mutual/Erie Approved`,
      footer_text: 'THIS ESTIMATE REPRESENTS OUR CURRENT EVALUATION OF THE COVERED DAMAGES TO YOUR INSURED PROPERTY AND MAY BE REVISED AS WE CONTINUE TO EVALUATE YOUR CLAIM.',
      page_size: 'letter', font_size: 'small', color_scheme: 'blue', is_active: true,
    },
    {
      format_name: 'Allstate Standard',
      category: 'insurance', insurance_company: 'Allstate',
      description: 'Allstate insurance format similar to Xactimate with detailed line items and RCV/ACV breakdown.',
      columns: 7, column_headers: ['Description', 'Quantity', 'Unit Price', 'Tax', 'RCV', 'Depreciation', 'ACV'],
      show_rcv_acv: false, show_depreciation: true, show_age_life: false,
      rcv_label: 'RCV', acv_label: 'ACV', show_overhead_profit: true, overhead_profit_rate: 10,
      show_claim_number: true, show_insurance_company: true, show_policy_number: true, show_deductible: true, show_adjuster: false,
      header_text: isYICN ? 'YICN Roofing Allstate Preferred Contractor 216-999-6222' : `${co}`,
      footer_text: 'Payment subject to policy terms and conditions.',
      page_size: 'letter', font_size: 'medium', color_scheme: 'blue', is_active: true,
    },
    {
      format_name: 'Farmers Standard',
      category: 'insurance', insurance_company: 'Farmers',
      description: 'Farmers Insurance standard format with depreciation and RCV/ACV calculations.',
      columns: 8, column_headers: ['Description', 'Quantity', 'Unit Price', 'Tax', 'RCV', 'Depreciation', 'ACV', 'Notes'],
      show_rcv_acv: true, show_depreciation: true, show_age_life: false,
      rcv_label: 'RCV', acv_label: 'ACV', show_overhead_profit: true, overhead_profit_rate: 10,
      show_claim_number: true, show_insurance_company: true, show_policy_number: true, show_deductible: true, show_adjuster: false,
      header_text: isYICN ? 'YICN Roofing Farmers Preferred Contractor 216-999-6222' : `${co}`,
      footer_text: 'All claim payments subject to policy provisions, limits, and deductibles.',
      page_size: 'letter', font_size: 'medium', color_scheme: 'green', is_active: true,
    },
  ];
}

async function seedDefaultTemplates(pool, companyId, companyName) {
  try {
    const existing = await pool.query(
      "SELECT COUNT(*) as cnt FROM generic_entities WHERE entity_type = 'EstimateFormat' AND company_id = $1",
      [companyId]
    );
    if (parseInt(existing.rows[0].cnt) > 0) {
      console.log(`[Templates] ${companyId} already has ${existing.rows[0].cnt} templates — skipping`);
      return 0;
    }
    const templates = getDefaultTemplates(companyId, companyName);
    let seeded = 0;
    for (const tmpl of templates) {
      const id = `tmpl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await pool.query(
        `INSERT INTO generic_entities (id, company_id, entity_type, data, created_date, updated_date) VALUES ($1, $2, 'EstimateFormat', $3, NOW(), NOW())`,
        [id, companyId, JSON.stringify({ ...tmpl, company_id: companyId })]
      );
      seeded++;
    }
    console.log(`[Templates] Seeded ${seeded} templates for ${companyId} (${companyName})`);
    return seeded;
  } catch (err) {
    console.error(`[Templates] Error seeding for ${companyId}:`, err.message);
    return 0;
  }
}

// ── Notification + Workflow triggers for entity create/update ──────────────

function getEntityNotificationConfig(sdkName, action, entityData) {
  if (action !== 'create') return null;
  switch (sdkName) {
    case 'Lead':
      return {
        title: `🎯 New Lead: ${entityData?.name || 'Unknown'}`,
        message: `New lead${entityData?.source ? ` from ${entityData.source}` : ''}${entityData?.phone ? ` — ${entityData.phone}` : ''}`,
        type: 'lead_created',
        link_url: `/LeadProfile?id=${entityData?.id || ''}`,
      };
    case 'Customer':
      return {
        title: `👤 New Customer: ${entityData?.name || 'Unknown'}`,
        message: `New customer added${entityData?.phone ? ` — ${entityData.phone}` : ''}`,
        type: 'customer_created',
        link_url: `/CustomerProfile?id=${entityData?.id || ''}`,
      };
    case 'Invoice':
      return {
        title: `🧾 New Invoice ${entityData?.invoice_number || ''}`,
        message: `Invoice for ${entityData?.customer_name || 'Unknown'} — $${Number(entityData?.amount || 0).toFixed(2)}`,
        type: 'invoice_created',
        link_url: `/invoice-details?id=${entityData?.id || ''}`,
      };
    case 'Payment':
      return {
        title: `💰 Payment Received`,
        message: `$${Number(entityData?.amount || 0).toFixed(2)} from ${entityData?.customer_name || 'Unknown'}`,
        type: 'payment_received',
        link_url: '/Payments',
      };
    case 'Estimate':
      return {
        title: `📄 New Estimate ${entityData?.estimate_number || ''}`,
        message: `For ${entityData?.customer_name || 'Unknown'} — $${Number(entityData?.amount || 0).toFixed(2)}`,
        type: 'estimate_created',
        link_url: `/ViewEstimate?id=${entityData?.id || ''}`,
      };
    case 'Communication':
      if (entityData?.direction !== 'inbound') return null;
      return {
        title: `📱 New Inbound ${(entityData?.communication_type || 'SMS').toUpperCase()} from ${entityData?.contact_phone || 'Unknown'}`,
        message: (entityData?.message_body || '').substring(0, 120),
        type: 'inbound_communication',
        link_url: '/SarahWorkspace',
      };
    default:
      return null;
  }
}

async function notifyAdminsForEntity(companyId, config) {
  if (!companyId || !config) return;
  const p = getPool();
  try {
    const { rows: staff } = await p.query(
      `SELECT user_email, is_administrator, COALESCE(data->>'is_administrator', 'false') as data_is_admin FROM staff_profiles WHERE company_id = $1 AND user_email IS NOT NULL`,
      [companyId]
    );
    const adminRows = staff.filter(s => s.is_administrator === true || s.is_administrator === 'true' || s.data_is_admin === 'true');
    const targets = adminRows.length > 0 ? adminRows : staff;
    if (targets.length === 0) return;

    for (const member of targets) {
      if (!member.user_email) continue;
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      await p.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'Notification', $2, $3, NOW(), NOW())`,
        [notifId, companyId, JSON.stringify({
          user_email: member.user_email,
          title: config.title,
          message: config.message,
          type: config.type || 'info',
          link_url: config.link_url || null,
          is_read: false,
        })]
      );
      console.log(`[Notif] Bell for ${member.user_email}: ${config.title}`);

      if (process.env.RESEND_API_KEY) {
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'CompanySync <noreply@companysync.io>',
            to: [member.user_email],
            subject: config.title,
            html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2>${config.title}</h2><p>${config.message}</p>${config.link_url ? `<a href="https://getcompanysync.com${config.link_url}" style="display:inline-block;background:#3b82f6;color:white;padding:10px 24px;border-radius:8px;text-decoration:none">View in CompanySync</a>` : ''}</div>`,
          }),
        }).then(r => r.ok ? console.log(`[Notif] Email sent to ${member.user_email}`) : r.text().then(t => console.warn(`[Notif] Email failed:`, t))).catch(e => console.warn(`[Notif] Email error:`, e.message));
      }
    }
  } catch (err) {
    console.warn('[Notif] notifyAdminsForEntity error:', err.message);
  }
}

const CREATE_TRIGGER_MAP = {
  Lead: 'lead_created', Customer: 'customer_created', Estimate: 'estimate_created',
  Invoice: 'invoice_created', Project: 'project_created', Task: 'task_created',
};

const UPDATE_TRIGGER_MAP = {
  Estimate: (d) => d.status === 'sent' ? 'estimate_sent' : d.status === 'accepted' ? 'estimate_accepted' : d.status === 'declined' ? 'estimate_declined' : null,
  Invoice: (d) => d.status === 'paid' ? 'invoice_paid' : d.status === 'overdue' ? 'invoice_overdue' : d.status === 'sent' ? 'invoice_sent' : null,
  Task: (d) => d.status === 'completed' ? 'job_completed' : null,
  Job: (d) => d.status === 'completed' ? 'job_completed' : null,
};

async function fireWorkflowTriggersAsync(pool, sdkName, mutationType, entityId, entityData, companyId) {
  if (!companyId) return;
  try {
    let triggerType = null;
    if (mutationType === 'create') triggerType = CREATE_TRIGGER_MAP[sdkName];
    else if (mutationType === 'update' && UPDATE_TRIGGER_MAP[sdkName]) triggerType = UPDATE_TRIGGER_MAP[sdkName](entityData);
    if (!triggerType) return;

    console.log(`[Workflows] Checking trigger: ${triggerType} for ${companyId}`);

    let { rows: workflows } = await pool.query(
      `SELECT * FROM generic_entities WHERE entity_type = 'Workflow' AND company_id = $1 AND data->>'trigger_type' = $2 AND (data->>'is_active')::text = 'true'`,
      [companyId, triggerType]
    );
    if (workflows.length === 0) {
      const { rows: defaults } = await pool.query(
        `SELECT * FROM generic_entities WHERE entity_type = 'Workflow' AND company_id = 'platform_default' AND data->>'trigger_type' = $1 AND (data->>'is_active')::text = 'true'`,
        [triggerType]
      );
      workflows = defaults;
    }
    if (workflows.length === 0) return;

    for (const wfRow of workflows) {
      const wf = typeof wfRow.data === 'string' ? JSON.parse(wfRow.data) : (wfRow.data || {});
      const actions = wf.actions || wf.steps || [];
      for (const action of actions) {
        const aType = action.action_type || action.type;
        const delay = action.delay_minutes || action.config?.delay_minutes || 0;
        if (delay > 0) continue;

        try {
          if (aType === 'send_notification' || aType === 'create_notification') {
            const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
            const userEmail = action.config?.user_email || '';
            if (userEmail) {
              await pool.query(
                `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW())`,
                [notifId, companyId, JSON.stringify({ user_email: userEmail, title: action.config?.title || wf.name, message: action.config?.message || '', type: 'workflow', is_read: false })]
              );
            }
          } else if (aType === 'send_email') {
            if (process.env.RESEND_API_KEY && action.config?.to) {
              fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: 'CompanySync <noreply@companysync.io>', to: [action.config.to], subject: action.config.subject || wf.name, html: action.config.body || action.config.message || '' }),
              }).catch(e => console.warn('[Workflows] Email action error:', e.message));
            }
          }
        } catch (actionErr) {
          console.warn(`[Workflows] Action ${aType} failed:`, actionErr.message);
        }
      }
    }
    console.log(`[Workflows] Fired ${workflows.length} workflow(s) for ${triggerType}`);
  } catch (err) {
    console.warn('[Workflows] fireWorkflowTriggersAsync error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function handleLocalDbRoute(req, res, pathname, url) {
  const sendJson = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  };

  try {
    console.log(`[DB] ${req.method} ${pathname}`);
    const entityCollectionMatch = pathname.match(/^\/api\/local\/entity\/([^/]+)$/);
    const entitySingleMatch = pathname.match(/^\/api\/local\/entity\/([^/]+)\/(.+)$/);

    if (entitySingleMatch) {
      const p = getPool();
      const sdkName = entitySingleMatch[1];
      const entityType = sdkNameToEntityType(sdkName);
      const recordId = entitySingleMatch[2];
      if (req.method === 'GET') {
        const record = await universalGet(p, entityType, recordId);
        if (!record) return sendJson({ error: 'Not found' }, 404);
        return sendJson(record);
      }
      if (req.method === 'PUT' || req.method === 'PATCH') {
        const body = await parseBodyJson(req);
        const updated = await universalUpdate(p, entityType, recordId, body);
        // Fire workflow triggers for status changes (invoice_paid, estimate_accepted, etc.)
        if (updated && updated.company_id) {
          fireWorkflowTriggersAsync(p, sdkName, 'update', recordId, updated, updated.company_id)
            .catch(e => console.warn(`[DB] Workflow trigger error for ${sdkName} update:`, e.message));
        }
        return sendJson(updated);
      }
      if (req.method === 'DELETE') {
        const deleted = await universalDelete(p, entityType, recordId);
        if (!deleted) return sendJson({ error: 'Not found' }, 404);
        return sendJson({ success: true, deleted: true });
      }
    }

    if (entityCollectionMatch) {
      const p = getPool();
      const sdkName = entityCollectionMatch[1];
      const entityType = sdkNameToEntityType(sdkName);
      if (req.method === 'GET') {
        const filters = {};
        for (const [k, v] of url.searchParams.entries()) {
          if (k === '_sort' || k === '_limit' || k === '_offset') continue;
          try { filters[k] = JSON.parse(v); } catch { filters[k] = v; }
        }
        const sort = url.searchParams.get('_sort') || '-created_date';
        const limit = parseInt(url.searchParams.get('_limit')) || 1000;
        const results = await universalFilter(p, entityType, filters, sort, limit);
        return sendJson(results);
      }
      if (req.method === 'POST') {
        const body = await parseBodyJson(req);
        console.log(`[DB] POST ${sdkName} (${entityType}), isArray=${Array.isArray(body)}`);
        if (Array.isArray(body)) {
          const results = await universalBulkCreate(p, entityType, body);
          return sendJson(results, 201);
        }
        const created = await universalCreate(p, entityType, body);
        // Fire bell notifications + email for key entity types (non-blocking)
        const notifConfig = getEntityNotificationConfig(sdkName, 'create', created);
        if (notifConfig && created.company_id) {
          notifyAdminsForEntity(created.company_id, notifConfig)
            .catch(e => console.warn(`[DB] Notification error for ${sdkName}:`, e.message));
        }
        // Fire workflow automations (non-blocking)
        if (created.company_id) {
          fireWorkflowTriggersAsync(p, sdkName, 'create', created.id, created, created.company_id)
            .catch(e => console.warn(`[DB] Workflow trigger error for ${sdkName} create:`, e.message));
        }
        return sendJson(created, 201);
      }
    }

    if (pathname === '/api/local/auto-provision' && req.method === 'POST') {
      const p = getPool();
      const body = await parseBodyJson(req);
      const { email, name } = body;
      if (!email) return sendJson({ error: 'email required' }, 400);

      // PRIORITY 1: Trust the users table company_id — it is the authoritative source
      const userRow = await p.query(
        `SELECT u.company_id, c.id as comp_id FROM users u
         LEFT JOIN companies c ON u.company_id = c.id
         WHERE LOWER(u.email) = $1 AND c.id IS NOT NULL AND (c.is_deleted IS NULL OR c.is_deleted = false)
         LIMIT 1`,
        [email.toLowerCase()]
      );
      if (userRow.rows.length > 0 && userRow.rows[0].comp_id) {
        const comp = await p.query('SELECT * FROM companies WHERE id = $1', [userRow.rows[0].comp_id]);
        if (comp.rows.length > 0) {
          // Ensure staff profile exists at this company
          const existingStaff = await p.query(
            'SELECT id FROM staff_profiles WHERE user_email = $1 AND company_id = $2 AND is_active = true LIMIT 1',
            [email, comp.rows[0].id]
          );
          if (existingStaff.rows.length === 0) {
            const staffId = `staff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await p.query(
              `INSERT INTO staff_profiles (id, company_id, name, email, user_email, role, is_administrator, is_active, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, 'Staff', false, true, NOW(), NOW())
               ON CONFLICT (user_email, company_id) DO UPDATE SET is_active = true, updated_at = NOW()`,
              [staffId, comp.rows[0].id, name || email.split('@')[0], email, email]
            );
          }
          console.log(`[Auto-Provision] Returning authoritative company ${comp.rows[0].id} for ${email}`);
          return sendJson({ company: comp.rows[0], created: false });
        }
      }

      // PRIORITY 2: Check if user has an ACTIVE staff profile at any real company
      const existingStaffAny = await p.query(
        `SELECT sp.*, c.id as comp_id FROM staff_profiles sp
         LEFT JOIN companies c ON sp.company_id = c.id
         WHERE sp.user_email = $1
           AND sp.is_active = true
           AND c.id IS NOT NULL
           AND (c.is_deleted IS NULL OR c.is_deleted = false)
         ORDER BY sp.is_administrator DESC, sp.updated_at DESC
         LIMIT 1`,
        [email]
      );
      if (existingStaffAny.rows.length > 0 && existingStaffAny.rows[0].comp_id) {
        const comp = await p.query('SELECT * FROM companies WHERE id = $1', [existingStaffAny.rows[0].comp_id]);
        if (comp.rows.length > 0) {
          console.log(`[Auto-Provision] Found active staff profile for ${email} at company ${comp.rows[0].id} — skipping new company creation`);
          return sendJson({ company: comp.rows[0], created: false });
        }
      }

      // PRIORITY 3: Only create a new company if the user truly has no company association
      // First check if they own an existing company (non-solo)
      const existingCompanies = await p.query(
        `SELECT * FROM companies WHERE created_by = $1 AND (is_deleted IS NULL OR is_deleted = false)
         AND company_name NOT LIKE '%''s Company' ORDER BY created_at ASC LIMIT 1`,
        [email]
      );
      if (existingCompanies.rows.length > 0) {
        const comp = existingCompanies.rows[0];
        const existingStaff = await p.query(
          'SELECT * FROM staff_profiles WHERE user_email = $1 AND company_id = $2 LIMIT 1',
          [email, comp.id]
        );
        if (existingStaff.rows.length === 0) {
          const staffId = `staff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await p.query(
            `INSERT INTO staff_profiles (id, company_id, name, email, user_email, role, is_administrator, is_super_admin, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, 'admin', true, true, true, NOW(), NOW())`,
            [staffId, comp.id, name || email.split('@')[0], email, email]
          );
        }
        return sendJson({ company: comp, created: false });
      }

      const companyId = `company_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const displayName = name || email.split('@')[0];
      const companyName = `${displayName}'s Company`;

      await p.query(
        `INSERT INTO companies (id, name, company_name, created_by, email, preferred_language, subscription_plan, is_deleted, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'en', 'professional', false, NOW(), NOW())`,
        [companyId, companyName, companyName, email, email]
      );

      const staffId = `staff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await p.query(
        `INSERT INTO staff_profiles (id, company_id, name, full_name, email, user_email, role, is_administrator, is_super_admin, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'admin', true, true, true, NOW(), NOW())`,
        [staffId, companyId, displayName, displayName, email, email]
      );

      const newCompany = await p.query('SELECT * FROM companies WHERE id = $1', [companyId]);
      console.log(`[Auto-Provision] Created company "${companyName}" (${companyId}) and staff profile for ${email}`);
      seedDefaultTemplates(p, companyId, companyName).catch(err => console.error('[Templates] Seed error on provision:', err.message));
      return sendJson({ company: newCompany.rows[0], staffProfile: { id: staffId }, created: true });
    }

    if (pathname === '/api/local/admin/seed-templates' && req.method === 'POST') {
      const p = getPool();
      const body = await parseBodyJson(req);
      const { company_id } = body;
      if (company_id) {
        const comp = await p.query('SELECT id, company_name FROM companies WHERE id = $1', [company_id]);
        if (comp.rows.length === 0) return sendJson({ error: 'Company not found' }, 404);
        const row = comp.rows[0];
        await p.query("DELETE FROM generic_entities WHERE entity_type = 'EstimateFormat' AND company_id = $1", [row.id]);
        const seeded = await seedDefaultTemplates(p, row.id, row.company_name);
        return sendJson({ success: true, seeded, company_id: row.id });
      }
      const companies = await p.query('SELECT id, company_name FROM companies WHERE is_deleted IS NULL OR is_deleted = false');
      const results = [];
      for (const row of companies.rows) {
        await p.query("DELETE FROM generic_entities WHERE entity_type = 'EstimateFormat' AND company_id = $1", [row.id]);
        const seeded = await seedDefaultTemplates(p, row.id, row.company_name);
        results.push({ company_id: row.id, company_name: row.company_name, seeded });
      }
      return sendJson({ success: true, results, total_companies: results.length });
    }

    if (pathname === '/api/local/admin/seed-admin-user' && req.method === 'POST') {
      const p = getPool();
      const userExists = await p.query("SELECT id FROM users WHERE email = 'io.companysync@gmail.com' LIMIT 1");
      if (userExists.rows.length > 0) {
        return sendJson({ success: true, message: 'Admin user already exists' });
      }
      await p.query(
        `INSERT INTO users (id, email, first_name, last_name, password_hash, is_local_auth, must_change_password, company_id, platform_role, created_at, updated_at)
         VALUES ('user_companysync_admin_001', 'io.companysync@gmail.com', 'Kevin', 'Stone', $1, true, false, 'companysync_master_001', 'super_admin', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        ['$2b$10$/v1Vwd20gPDixxPSrYBizuAT748OibaKQqeQnwYA4UWvp.LQ8mlMq']
      );
      console.log('[Admin] Platform admin user created via endpoint');
      return sendJson({ success: true, message: 'Admin user created' });
    }

    if (pathname === '/api/local/admin/fix-assignments' && req.method === 'POST') {
      const p = getPool();
      const COMPANY_ID = 'loc_mmdvp1h5_e8i9eb';
      const BRIAN_EMAIL = 'brian.yicn@gmail.com';
      const KEVIN_EMAIL = 'stonekevin866@gmail.com';
      const results = {};

      // Step 1: Fix Patrick Gilmore typo email → Brian's correct email
      const patrickFix = await p.query(`
        UPDATE leads
        SET assigned_to = $1,
            assigned_to_users = jsonb_build_array($1::text),
            updated_at = NOW()
        WHERE company_id = $2
          AND name ILIKE '%patrick gilmor%'
          AND (assigned_to = 'brian.ycinteam@gmail.com' OR assigned_to_users::text ILIKE '%brian.ycinteam%')
        RETURNING id, name
      `, [BRIAN_EMAIL, COMPANY_ID]);
      results.patrick_lead_fixed = patrickFix.rows;

      // Fix any remaining typo email occurrences
      const typoLeads = await p.query(`
        UPDATE leads
        SET assigned_to = $1,
            assigned_to_users = jsonb_build_array($1::text),
            updated_at = NOW()
        WHERE company_id = $2 AND assigned_to = 'brian.ycinteam@gmail.com'
        RETURNING id, name
      `, [BRIAN_EMAIL, COMPANY_ID]);
      results.typo_leads_fixed = typoLeads.rowCount;

      const typoCusts = await p.query(`
        UPDATE customers
        SET assigned_to = $1,
            assigned_to_users = jsonb_build_array($1::text),
            updated_at = NOW()
        WHERE company_id = $2 AND assigned_to = 'brian.ycinteam@gmail.com'
        RETURNING id, name
      `, [BRIAN_EMAIL, COMPANY_ID]);
      results.typo_customers_fixed = typoCusts.rowCount;

      // Step 2: Orphaned customers (no assignment) → Kevin
      const orphanCust = await p.query(`
        UPDATE customers
        SET assigned_to = $1,
            assigned_to_users = jsonb_build_array($1::text),
            updated_at = NOW()
        WHERE company_id = $2
          AND (assigned_to IS NULL OR assigned_to = '')
          AND (assigned_to_users IS NULL OR assigned_to_users = '[]'::jsonb OR jsonb_array_length(assigned_to_users) = 0)
        RETURNING id
      `, [KEVIN_EMAIL, COMPANY_ID]);
      results.orphan_customers_to_kevin = orphanCust.rowCount;

      // Step 3: Orphaned leads (no assignment) → Kevin
      const orphanLeads = await p.query(`
        UPDATE leads
        SET assigned_to = $1,
            assigned_to_users = jsonb_build_array($1::text),
            updated_at = NOW()
        WHERE company_id = $2
          AND (assigned_to IS NULL OR assigned_to = '')
          AND (assigned_to_users IS NULL OR assigned_to_users = '[]'::jsonb OR jsonb_array_length(assigned_to_users) = 0)
        RETURNING id
      `, [KEVIN_EMAIL, COMPANY_ID]);
      results.orphan_leads_to_kevin = orphanLeads.rowCount;

      // Step 4: Count Brian's records after all updates
      const brianLeads = await p.query(`
        SELECT COUNT(*) as total FROM leads
        WHERE company_id = $1
          AND (assigned_to = $2 OR assigned_to_users::text ILIKE $3)
      `, [COMPANY_ID, BRIAN_EMAIL, `%${BRIAN_EMAIL}%`]);

      const brianCusts = await p.query(`
        SELECT COUNT(*) as total FROM customers
        WHERE company_id = $1
          AND (assigned_to = $2 OR assigned_to_users::text ILIKE $3)
      `, [COMPANY_ID, BRIAN_EMAIL, `%${BRIAN_EMAIL}%`]);

      results.brian_leads_total = parseInt(brianLeads.rows[0].total);
      results.brian_customers_total = parseInt(brianCusts.rows[0].total);

      console.log('[Fix-Assignments]', JSON.stringify(results));
      return sendJson({ success: true, ...results });
    }

    if (pathname === '/api/local/health') {
      const p = getPool();
      const r = await p.query('SELECT NOW() as time');
      return sendJson({ success: true, database: 'connected', time: r.rows[0].time });
    }

    if (pathname === '/api/local/dashboard' && req.method === 'GET') {
      const companyId = url.searchParams.get('company_id');
      if (!companyId) return sendJson({ error: 'company_id required' }, 400);
      const data = await getDashboardData(companyId);
      return sendJson({ success: true, data, source: 'local_db' });
    }

    if (pathname === '/api/local/sync' && req.method === 'POST') {
      const body = await parseBodyJson(req);
      if (!body.entity_type || !body.records) return sendJson({ error: 'entity_type and records required' }, 400);
      const result = await syncEntityBatch(body.entity_type, body.records, body.company_id);
      return sendJson({ success: true, ...result });
    }

    if (pathname === '/api/local/sync/bulk' && req.method === 'POST') {
      const body = await parseBodyJson(req);
      if (!body.entities || !body.company_id) return sendJson({ error: 'entities and company_id required' }, 400);
      const results = {};
      for (const [entityType, records] of Object.entries(body.entities)) {
        results[entityType] = await syncEntityBatch(entityType, records, body.company_id);
      }
      return sendJson({ success: true, results });
    }

    if (pathname === '/api/local/sync/status' && req.method === 'GET') {
      const p = getPool();
      const r = await p.query('SELECT * FROM sync_status ORDER BY entity_type');
      return sendJson({ success: true, status: r.rows });
    }

    const entityMatch = pathname.match(/^\/api\/local\/entities\/(\w+)$/);
    if (entityMatch && req.method === 'GET') {
      const entityType = entityMatch[1];
      const companyId = url.searchParams.get('company_id');
      if (!companyId) return sendJson({ error: 'company_id required' }, 400);
      const validTables = ['leads', 'customers', 'estimates', 'invoices', 'payments', 'projects', 'tasks', 'calendar_events', 'communications', 'staff_profiles'];
      if (!validTables.includes(entityType)) return sendJson({ error: 'Invalid entity' }, 400);
      const limit = parseInt(url.searchParams.get('limit')) || 200;
      const offset = parseInt(url.searchParams.get('offset')) || 0;
      const p = getPool();
      const result = await p.query(`SELECT * FROM ${entityType} WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [companyId, limit, offset]);
      const countResult = await p.query(`SELECT COUNT(*) as total FROM ${entityType} WHERE company_id = $1`, [companyId]);
      return sendJson({ success: true, records: result.rows, total: parseInt(countResult.rows[0].total), source: 'local_db' });
    }

    if (pathname === '/api/local/call-routing' && req.method === 'GET') {
      const phone = url.searchParams.get('phone');
      if (!phone) return sendJson({ error: 'phone required' }, 400);
      const data = await getCallRouting(phone);
      return sendJson({ success: true, data, source: 'local_db' });
    }

    if (pathname === '/api/local/reports' && req.method === 'GET') {
      const companyId = url.searchParams.get('company_id');
      const reportType = url.searchParams.get('type');
      if (!companyId || !reportType) return sendJson({ error: 'company_id and type required' }, 400);
      const data = await getReportingData(companyId, reportType);
      return sendJson({ success: true, data, source: 'local_db' });
    }

    const dailyAIMatch = pathname.match(/^\/api\/local\/daily-ai-usage\/(.+)$/);
    if (dailyAIMatch && req.method === 'GET') {
      const companyId = dailyAIMatch[1];
      const plan = await getCompanyPlan(companyId);
      const used = await getDailyAIUsage(companyId);
      const TRIAL_DAILY_LIMIT = 20;
      const limit = plan === 'trial' ? TRIAL_DAILY_LIMIT : null;
      return sendJson({
        success: true,
        used,
        limit,
        plan,
        remaining: limit !== null ? Math.max(0, limit - used) : null,
        resets_at: new Date(new Date().setHours(24, 0, 0, 0)).toISOString()
      });
    }

    const apiKeysGetMatch = pathname.match(/^\/api\/local\/company-api-keys\/(.+)$/);
    if (apiKeysGetMatch && req.method === 'GET') {
      const companyId = apiKeysGetMatch[1];
      const p = getPool();
      const { rows } = await p.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'CompanyApiKeys' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
        [companyId]
      );
      const data = rows[0]?.data || {};
      const masked = {
        gemini: {
          connected: !!data.gemini_api_key,
          masked_key: data.gemini_api_key ? maskApiKey(decryptApiKey(data.gemini_api_key)) : '',
          last_tested: data.gemini_last_tested || null,
          test_status: data.gemini_test_status || null,
        },
        twilio: {
          connected: !!data.twilio_account_sid,
          masked_sid: data.twilio_account_sid ? maskApiKey(decryptApiKey(data.twilio_account_sid)) : '',
          masked_token: data.twilio_auth_token ? maskApiKey(decryptApiKey(data.twilio_auth_token)) : '',
          phone_number: data.twilio_phone_number || '',
          last_tested: data.twilio_last_tested || null,
          test_status: data.twilio_test_status || null,
        },
        email: {
          connected: !!(data.smtp_host || data.resend_api_key),
          mode: data.email_mode || (data.resend_api_key ? 'resend' : data.smtp_host ? 'smtp' : 'none'),
          smtp_host: data.smtp_host || '',
          smtp_port: data.smtp_port || '',
          smtp_encryption: data.smtp_encryption || '',
          smtp_email: data.smtp_email || '',
          masked_resend_key: data.resend_api_key ? maskApiKey(decryptApiKey(data.resend_api_key)) : '',
          last_tested: data.email_last_tested || null,
          test_status: data.email_test_status || null,
        },
      };
      return sendJson({ success: true, keys: masked });
    }

    if (pathname === '/api/local/company-api-keys' && req.method === 'POST') {
      const body = await parseBodyJson(req);
      const { company_id, service, keys } = body;
      if (!company_id || !service || !keys) return sendJson({ error: 'company_id, service, and keys required' }, 400);

      const p = getPool();
      const { rows: existing } = await p.query(
        `SELECT id, data FROM generic_entities WHERE entity_type = 'CompanyApiKeys' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
        [company_id]
      );
      const existingData = existing[0]?.data || {};
      const existingId = existing[0]?.id;
      const updatedData = { ...existingData };

      if (service === 'gemini') {
        if (keys.api_key) updatedData.gemini_api_key = encryptApiKey(keys.api_key);
      } else if (service === 'twilio') {
        if (keys.account_sid) updatedData.twilio_account_sid = encryptApiKey(keys.account_sid);
        if (keys.auth_token) updatedData.twilio_auth_token = encryptApiKey(keys.auth_token);
        if (keys.phone_number) updatedData.twilio_phone_number = keys.phone_number;
      } else if (service === 'email') {
        updatedData.email_mode = keys.mode || 'smtp';
        if (keys.mode === 'resend' && keys.resend_api_key) {
          updatedData.resend_api_key = encryptApiKey(keys.resend_api_key);
        } else if (keys.mode === 'smtp' || !keys.mode) {
          if (keys.smtp_host) updatedData.smtp_host = keys.smtp_host;
          if (keys.smtp_port) updatedData.smtp_port = keys.smtp_port;
          if (keys.smtp_encryption) updatedData.smtp_encryption = keys.smtp_encryption;
          if (keys.smtp_email) updatedData.smtp_email = keys.smtp_email;
          if (keys.smtp_password) updatedData.smtp_password = encryptApiKey(keys.smtp_password);
        }
      } else {
        return sendJson({ error: 'Invalid service. Must be gemini, twilio, or email' }, 400);
      }

      if (existingId) {
        await p.query(
          `UPDATE generic_entities SET data = $1, updated_date = NOW() WHERE id = $2`,
          [JSON.stringify(updatedData), existingId]
        );
      } else {
        const newId = `apikeys_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await p.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'CompanyApiKeys', $2, $3, NOW(), NOW())`,
          [newId, company_id, JSON.stringify(updatedData)]
        );
      }

      return sendJson({ success: true, service, message: `${service} keys saved and encrypted` });
    }

    if (pathname === '/api/local/test-api-key' && req.method === 'POST') {
      const body = await parseBodyJson(req);
      const { service, keys, company_id } = body;
      if (!service) return sendJson({ error: 'service required' }, 400);

      let testResult = { success: false, message: 'Unknown service' };

      if (service === 'gemini') {
        const apiKey = keys?.api_key;
        if (!apiKey) return sendJson({ error: 'api_key required' }, 400);
        try {
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: 'Say "hello" in one word.' }] }],
                generationConfig: { maxOutputTokens: 10 },
              }),
            }
          );
          if (resp.ok) {
            testResult = { success: true, message: 'Gemini API key is valid' };
          } else {
            const errData = await resp.json().catch(() => ({}));
            testResult = { success: false, message: errData?.error?.message || `HTTP ${resp.status}` };
          }
        } catch (err) {
          testResult = { success: false, message: err.message };
        }
      } else if (service === 'twilio') {
        const { account_sid, auth_token } = keys || {};
        if (!account_sid || !auth_token) return sendJson({ error: 'account_sid and auth_token required' }, 400);
        try {
          const authHeader = Buffer.from(`${account_sid}:${auth_token}`).toString('base64');
          const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account_sid}.json`, {
            headers: { 'Authorization': `Basic ${authHeader}` },
          });
          if (resp.ok) {
            const data = await resp.json();
            testResult = { success: true, message: `Twilio account verified: ${data.friendly_name || account_sid}` };
          } else {
            testResult = { success: false, message: `Twilio verification failed: HTTP ${resp.status}` };
          }
        } catch (err) {
          testResult = { success: false, message: err.message };
        }
      } else if (service === 'smtp') {
        const { smtp_host, smtp_port, smtp_email, smtp_password, smtp_encryption } = keys || {};
        if (!smtp_host || !smtp_email || !smtp_password) return sendJson({ error: 'smtp_host, smtp_email, and smtp_password required' }, 400);
        try {
          const nodemailer = require('nodemailer');
          const transportConfig = {
            host: smtp_host,
            port: parseInt(smtp_port) || 587,
            secure: smtp_encryption === 'SSL/TLS',
            auth: { user: smtp_email, pass: smtp_password },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
          };
          const transporter = nodemailer.createTransport(transportConfig);
          await transporter.verify();
          transporter.close();
          testResult = { success: true, message: `SMTP connection to ${smtp_host} verified` };
        } catch (err) {
          testResult = { success: false, message: `SMTP test failed: ${err.message}` };
        }
      } else if (service === 'resend') {
        const { resend_api_key } = keys || {};
        if (!resend_api_key) return sendJson({ error: 'resend_api_key required' }, 400);
        try {
          const resp = await fetch('https://api.resend.com/domains', {
            headers: { 'Authorization': `Bearer ${resend_api_key}` },
          });
          if (resp.ok) {
            testResult = { success: true, message: 'Resend API key is valid' };
          } else {
            testResult = { success: false, message: `Resend verification failed: HTTP ${resp.status}` };
          }
        } catch (err) {
          testResult = { success: false, message: err.message };
        }
      }

      if (company_id && testResult.success) {
        try {
          const p = getPool();
          const { rows } = await p.query(
            `SELECT id, data FROM generic_entities WHERE entity_type = 'CompanyApiKeys' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
            [company_id]
          );
          if (rows[0]) {
            const data = rows[0].data || {};
            const statusField = service === 'smtp' ? 'email' : service;
            data[`${statusField}_last_tested`] = new Date().toISOString();
            data[`${statusField}_test_status`] = testResult.success ? 'passed' : 'failed';
            await p.query(`UPDATE generic_entities SET data = $1, updated_date = NOW() WHERE id = $2`, [JSON.stringify(data), rows[0].id]);
          }
        } catch (e) { console.warn('[TestApiKey] Failed to update test status:', e.message); }
      }

      return sendJson(testResult);
    }

    if (pathname === '/api/local/detect-smtp' && req.method === 'POST') {
      const body = await parseBodyJson(req);
      const { email } = body;
      if (!email) return sendJson({ error: 'email required' }, 400);
      const settings = detectSmtpSettings(email);
      if (!settings) return sendJson({ error: 'Invalid email format' }, 400);
      return sendJson({ success: true, ...settings });
    }

    // ==========================================
    // TRANSACTION MAPPING RULES - SUGGEST CATEGORY
    // GET /api/local/suggest-category?description=X&company_id=Y
    // ==========================================
    if (pathname === '/api/local/suggest-category' && req.method === 'GET') {
      const p = getPool();
      const description = (url.searchParams.get('description') || '').toLowerCase().trim();
      const companyId = url.searchParams.get('company_id');
      if (!companyId) return sendJson({ error: 'company_id required' }, 400);
      const rulesResult = await p.query(
        `SELECT * FROM transaction_mapping_rules WHERE company_id = $1 AND is_active = true ORDER BY priority DESC, created_at ASC`,
        [companyId]
      );
      const rules = rulesResult.rows;
      let matched = null;
      for (const rule of rules) {
        if (description.includes(rule.pattern.toLowerCase())) {
          matched = { category: rule.category, transaction_type: rule.transaction_type, rule_id: rule.id, pattern: rule.pattern };
          break;
        }
      }
      return sendJson({ suggestion: matched });
    }

    // ==========================================
    // TRANSACTION MAPPING RULES - AUTO CATEGORIZE
    // POST /api/local/auto-categorize
    // Body: { company_id, payment_ids? }
    // ==========================================
    if (pathname === '/api/local/auto-categorize' && req.method === 'POST') {
      const p = getPool();
      const body = await parseBodyJson(req);
      const { company_id, payment_ids } = body;
      if (!company_id) return sendJson({ error: 'company_id required' }, 400);
      const rulesResult = await p.query(
        `SELECT * FROM transaction_mapping_rules WHERE company_id = $1 AND is_active = true ORDER BY priority DESC, created_at ASC`,
        [company_id]
      );
      const rules = rulesResult.rows;
      if (rules.length === 0) return sendJson({ updated: 0, message: 'No active rules found' });
      let paymentsQuery;
      let paymentsValues;
      if (payment_ids && Array.isArray(payment_ids) && payment_ids.length > 0) {
        const placeholders = payment_ids.map((_, i) => `$${i + 2}`).join(',');
        paymentsQuery = `SELECT id, description, notes, customer_name FROM payments WHERE company_id = $1 AND id IN (${placeholders})`;
        paymentsValues = [company_id, ...payment_ids];
      } else {
        paymentsQuery = `SELECT id, description, notes, customer_name FROM payments WHERE company_id = $1`;
        paymentsValues = [company_id];
      }
      const paymentsResult = await p.query(paymentsQuery, paymentsValues);
      const payments = paymentsResult.rows;
      let updatedCount = 0;
      for (const payment of payments) {
        const text = ((payment.description || '') + ' ' + (payment.notes || '') + ' ' + (payment.customer_name || '')).toLowerCase().trim();
        for (const rule of rules) {
          if (text.includes(rule.pattern.toLowerCase())) {
            await p.query(
              `UPDATE payments SET category = $1, transaction_type = $2, updated_at = NOW() WHERE id = $3`,
              [rule.category, rule.transaction_type, payment.id]
            );
            updatedCount++;
            break;
          }
        }
      }
      return sendJson({ updated: updatedCount, total: payments.length });
    }

    // Direct collection routes: /api/local/customers, /api/local/leads, etc.
    // These return {success:true, <entityType>: [...]} or {success:true, <singular>: {...}}
    const DIRECT_ROUTE_TABLES = ['customers','leads','estimates','invoices','payments','projects','tasks','calendar_events','communications','staff_profiles'];
    const SINGULAR = { customers:'customer', leads:'lead', estimates:'estimate', invoices:'invoice', payments:'payment', projects:'project', tasks:'task', calendar_events:'calendar_event', communications:'communication', staff_profiles:'staff_profile' };
    const directCollectionMatch = pathname.match(/^\/api\/local\/(customers|leads|estimates|invoices|payments|projects|tasks|calendar_events|communications|staff_profiles)$/);
    const directSingleMatch = pathname.match(/^\/api\/local\/(customers|leads|estimates|invoices|payments|projects|tasks|calendar_events|communications|staff_profiles)\/(.+)$/);

    if (directSingleMatch) {
      const p = getPool();
      const entityType = directSingleMatch[1];
      const singular = SINGULAR[entityType] || entityType;
      const id = directSingleMatch[2].split('?')[0];
      if (req.method === 'GET') {
        const record = await universalGet(p, entityType, id);
        if (!record) return sendJson({ success: false, error: 'Not found' }, 404);
        return sendJson({ success: true, [singular]: record });
      }
      if (req.method === 'PUT' || req.method === 'PATCH') {
        const body = await parseBodyJson(req);
        const updated = await universalUpdate(p, entityType, id, body);
        return sendJson({ success: true, [singular]: updated });
      }
      if (req.method === 'DELETE') {
        const deleted = await universalDelete(p, entityType, id);
        if (!deleted) return sendJson({ success: false, error: 'Not found' }, 404);
        return sendJson({ success: true });
      }
    }

    if (directCollectionMatch) {
      const p = getPool();
      const entityType = directCollectionMatch[1];
      const singular = SINGULAR[entityType] || entityType;
      if (req.method === 'GET') {
        const filters = {};
        for (const [k, v] of url.searchParams.entries()) {
          if (k === '_sort' || k === '_limit') continue;
          try { filters[k] = JSON.parse(v); } catch { filters[k] = v; }
        }
        const sort = url.searchParams.get('_sort') || '-created_at';
        const limit = parseInt(url.searchParams.get('_limit')) || 1000;
        const results = await universalFilter(p, entityType, filters, sort, limit);
        return sendJson({ success: true, [entityType]: results });
      }
      if (req.method === 'POST') {
        const body = await parseBodyJson(req);
        console.log(`[DB] POST ${entityType} (direct route)`);
        if (Array.isArray(body)) {
          const results = await universalBulkCreate(p, entityType, body);
          return sendJson({ success: true, [entityType]: results }, 201);
        }
        const created = await universalCreate(p, entityType, body);
        if (created.company_id) {
          fireWorkflowTriggersAsync(p, entityType, 'create', created.id, created, created.company_id)
            .catch(e => console.warn(`[DB] Workflow trigger error:`, e.message));
        }
        return sendJson({ success: true, [singular]: created }, 201);
      }
    }

    // ── Presence tracking ──────────────────────────────────────────────────
    if (pathname === '/api/local/presence' && req.method === 'POST') {
      const p = getPool();
      const body = await parseBodyJson(req);
      const { company_id, user_email, user_name, page, page_label } = body;
      if (!company_id || !user_email) return sendJson({ error: 'company_id and user_email required' }, 400);
      const existing = await p.query(
        `SELECT id FROM generic_entities WHERE entity_type = 'UserPresence' AND company_id = $1 AND data->>'user_email' = $2 LIMIT 1`,
        [company_id, user_email]
      );
      if (existing.rows.length > 0) {
        await p.query(
          `UPDATE generic_entities SET data = $1::jsonb, updated_date = NOW() WHERE id = $2`,
          [JSON.stringify({ user_email, user_name: user_name || user_email, page, page_label, last_seen: new Date().toISOString() }), existing.rows[0].id]
        );
      } else {
        const presId = `presence_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await p.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'UserPresence', $2, $3, NOW(), NOW())`,
          [presId, company_id, JSON.stringify({ user_email, user_name: user_name || user_email, page, page_label, last_seen: new Date().toISOString() })]
        );
      }
      return sendJson({ success: true });
    }

    if (pathname === '/api/local/presence' && req.method === 'GET') {
      const p = getPool();
      const company_id = url.searchParams ? url.searchParams.get('company_id') : (new URLSearchParams(req.url.split('?')[1] || '')).get('company_id');
      if (!company_id) return sendJson({ error: 'company_id required' }, 400);
      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const result = await p.query(
        `SELECT id, data, updated_date FROM generic_entities WHERE entity_type = 'UserPresence' AND company_id = $1 AND (data->>'last_seen') > $2 ORDER BY updated_date DESC`,
        [company_id, cutoff]
      );
      return sendJson({ success: true, users: result.rows.map(r => ({ id: r.id, ...r.data, updated_date: r.updated_date })) });
    }
    // ── End presence tracking ───────────────────────────────────────────────

    console.warn(`[DB] 404 Not found: ${req.method} ${pathname}`);
    return sendJson({ error: 'Not found' }, 404);
  } catch (err) {
    console.error(`[DB] API error: ${err.message} (${req.method} ${pathname})`);
    return sendJson({ error: err.message }, 500);
  }
}

async function getCompanyPlan(companyId) {
  if (!companyId) return 'trial';
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT subscription_plan FROM companies WHERE id = $1 LIMIT 1`,
      [companyId]
    );
    return rows[0]?.subscription_plan || 'trial';
  } catch (e) {
    console.error('[Plan] getCompanyPlan error:', e.message);
    return 'trial';
  }
}

async function getDailyAIUsage(companyId) {
  if (!companyId) return 0;
  try {
    const p = getPool();
    const today = new Date().toISOString().slice(0, 10);
    const recordId = `daily_ai_${companyId}_${today}`;
    const { rows } = await p.query(
      `SELECT data FROM generic_entities WHERE id = $1 LIMIT 1`,
      [recordId]
    );
    const data = rows[0]?.data;
    const d = typeof data === 'string' ? JSON.parse(data) : (data || {});
    return d.count || 0;
  } catch (e) {
    console.error('[DailyAI] getDailyAIUsage error:', e.message);
    return 0;
  }
}

async function incrementDailyAIUsage(companyId) {
  if (!companyId) return;
  try {
    const p = getPool();
    const today = new Date().toISOString().slice(0, 10);
    const recordId = `daily_ai_${companyId}_${today}`;
    await p.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'DailyAIUsage', $2, $3, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE
       SET data = jsonb_set(
         COALESCE(generic_entities.data::jsonb, '{}'::jsonb),
         '{count}',
         (COALESCE((generic_entities.data->>'count')::int, 0) + 1)::text::jsonb
       ), updated_date = NOW()`,
      [recordId, companyId, JSON.stringify({ count: 1, date: today })]
    );
  } catch (e) {
    console.error('[DailyAI] incrementDailyAIUsage error:', e.message);
  }
}

async function getCompanyGeminiKey(companyId) {
  if (!companyId || companyId === 'companysync_master_001') return process.env.GOOGLE_GEMINI_API_KEY || null;
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'CompanyApiKeys' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
      [companyId]
    );
    const data = rows[0]?.data;
    if (data?.gemini_api_key) {
      const decrypted = decryptApiKey(data.gemini_api_key);
      if (decrypted) return decrypted;
    }
  } catch (e) { console.error('[BYOK] getCompanyGeminiKey error:', e.message); }
  return process.env.GOOGLE_GEMINI_API_KEY || null;
}

async function getCompanyTwilioConfig(companyId) {
  if (!companyId || companyId === 'companysync_master_001') {
    return { accountSid: process.env.TWILIO_ACCOUNT_SID, authToken: process.env.TWILIO_AUTH_TOKEN, phoneNumber: process.env.TWILIO_PHONE_NUMBER, isOwn: false };
  }
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'CompanyApiKeys' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
      [companyId]
    );
    const data = rows[0]?.data;
    if (data?.twilio_account_sid && data?.twilio_auth_token && data?.twilio_phone_number) {
      return {
        accountSid: decryptApiKey(data.twilio_account_sid),
        authToken: decryptApiKey(data.twilio_auth_token),
        phoneNumber: data.twilio_phone_number,
        isOwn: true
      };
    }
  } catch (e) { console.error('[BYOK] getCompanyTwilioConfig error:', e.message); }
  return { accountSid: process.env.TWILIO_ACCOUNT_SID, authToken: process.env.TWILIO_AUTH_TOKEN, phoneNumber: process.env.TWILIO_PHONE_NUMBER, isOwn: false };
}

async function getCompanyEmailConfig(companyId) {
  if (!companyId || companyId === 'companysync_master_001') {
    return { type: 'resend', apiKey: process.env.RESEND_API_KEY, isOwn: false };
  }
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'CompanyApiKeys' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
      [companyId]
    );
    const data = rows[0]?.data;
    const emailMode = data?.email_type || data?.email_mode;
    if (emailMode === 'smtp' && data?.smtp_host && (data?.smtp_username || data?.smtp_email)) {
      return {
        type: 'smtp',
        host: data.smtp_host,
        port: parseInt(data.smtp_port) || 587,
        secure: data.smtp_encryption === 'SSL',
        auth: { user: data.smtp_username || data.smtp_email, pass: data.smtp_password ? decryptApiKey(data.smtp_password) : '' },
        from: data.smtp_email || data.smtp_username,
        isOwn: true
      };
    }
    if (data?.resend_api_key) {
      return { type: 'resend', apiKey: decryptApiKey(data.resend_api_key), isOwn: true };
    }
  } catch (e) { console.error('[BYOK] getCompanyEmailConfig error:', e.message); }
  return { type: 'resend', apiKey: process.env.RESEND_API_KEY, isOwn: false };
}

module.exports = { initDatabase, getPool, handleLocalDbRoute, getCallRouting, syncEntityBatch, getDashboardData, encryptApiKey, decryptApiKey, maskApiKey, detectSmtpSettings, getCompanyGeminiKey, getCompanyTwilioConfig, getCompanyEmailConfig, getCompanyPlan, getDailyAIUsage, incrementDailyAIUsage };
