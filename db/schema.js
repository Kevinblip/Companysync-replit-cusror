import pg from 'pg';
const { Pool } = pg;

let pool = null;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 4000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });
    pool.on('error', (err) => {
      console.error('[DB] Unexpected pool error:', err.message);
      // Reset pool on fatal connection errors so next request creates a fresh connection
      if (err.message && (err.message.includes('terminated') || err.message.includes('connection timeout'))) {
        pool = null;
      }
    });
  }
  return pool;
}

export async function initDatabase() {
  const p = getPool();

  await p.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      base44_id TEXT UNIQUE,
      name TEXT,
      company_name TEXT,
      company_tagline TEXT,
      company_logo TEXT,
      logo_url TEXT,
      created_by TEXT,
      is_deleted BOOLEAN DEFAULT false,
      phone TEXT,
      email TEXT,
      address TEXT,
      website TEXT,
      industry TEXT DEFAULT 'roofing',
      timezone TEXT,
      preferred_language TEXT DEFAULT 'en',
      subscription_plan TEXT,
      subscription_status VARCHAR(50) DEFAULT 'active',
      parent_company_id VARCHAR(255) DEFAULT NULL,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      trial_end_date TIMESTAMP,
      max_users INTEGER DEFAULT 5,
      max_leads INTEGER DEFAULT 100,
      features_enabled JSONB DEFAULT '[]',
      branding JSONB DEFAULT '{}',
      settings JSONB DEFAULT '{}',
      data JSONB DEFAULT '{}',
      synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS staff_profiles (
      id TEXT PRIMARY KEY,
      base44_id TEXT UNIQUE,
      company_id TEXT,
      name TEXT,
      full_name TEXT,
      email TEXT,
      user_email TEXT,
      role TEXT,
      role_id TEXT,
      position TEXT,
      phone TEXT,
      cell_phone TEXT,
      avatar_url TEXT,
      call_routing_mode TEXT DEFAULT 'sarah_answers',
      availability_status TEXT DEFAULT 'available',
      twilio_number TEXT,
      is_administrator BOOLEAN DEFAULT false,
      is_super_admin BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true,
      commission_rate NUMERIC(5,2) DEFAULT 0,
      whatsapp_enabled BOOLEAN DEFAULT false,
      profile_id TEXT,
      created_by TEXT,
      last_login TIMESTAMP,
      data JSONB DEFAULT '{}',
      preferred_language TEXT DEFAULT NULL,
      synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      base44_id TEXT UNIQUE,
      company_id TEXT,
      name TEXT,
      email TEXT,
      phone TEXT,
      phone_2 TEXT,
      address TEXT,
      street TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      company TEXT,
      status TEXT DEFAULT 'new',
      source TEXT,
      lead_source TEXT,
      assigned_to TEXT,
      assigned_to_users JSONB DEFAULT '[]',
      service_needed TEXT,
      customer_type TEXT DEFAULT 'residential',
      lead_score INTEGER DEFAULT 0,
      value NUMERIC(12,2) DEFAULT 0,
      notes TEXT,
      tags JSONB DEFAULT '[]',
      is_active BOOLEAN DEFAULT true,
      last_contact_date TEXT,
      next_follow_up_date TEXT,
      ghl_contact_id TEXT,
      communication_count INTEGER DEFAULT 0,
      created_by TEXT,
      data JSONB DEFAULT '{}',
      synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      base44_id TEXT UNIQUE,
      company_id TEXT,
      customer_number SERIAL,
      name TEXT,
      company_name TEXT,
      customer_type TEXT DEFAULT 'residential',
      email TEXT,
      phone TEXT,
      phone_2 TEXT,
      street TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      address TEXT,
      website TEXT,
      source TEXT DEFAULT 'other',
      referral_source TEXT,
      custom_source TEXT,
      is_active BOOLEAN DEFAULT true,
      notes TEXT,
      group_name TEXT,
      assigned_to TEXT,
      assigned_to_users JSONB DEFAULT '[]',
      tags JSONB DEFAULT '[]',
      insurance_company TEXT,
      adjuster_name TEXT,
      adjuster_phone TEXT,
      status TEXT DEFAULT 'active',
      total_revenue NUMERIC(12,2) DEFAULT 0,
      data JSONB DEFAULT '{}',
      synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS estimates (
      id TEXT PRIMARY KEY,
      base44_id TEXT UNIQUE,
      company_id TEXT,
      customer_id TEXT,
      customer_name TEXT,
      customer_email TEXT,
      customer_phone TEXT,
      estimate_number TEXT,
      title TEXT,
      status TEXT DEFAULT 'draft',
      total_amount NUMERIC(12,2) DEFAULT 0,
      property_address TEXT,
      lead_id TEXT,
      insurance_company TEXT,
      claim_number TEXT,
      adjuster_name TEXT,
      adjuster_phone TEXT,
      adjustment_amount NUMERIC(12,2) DEFAULT 0,
      discount_type TEXT,
      discount_value NUMERIC(12,2) DEFAULT 0,
      items JSONB DEFAULT '[]',
      notes TEXT,
      tags JSONB DEFAULT '[]',
      valid_until TEXT,
      reference_number TEXT,
      format_id TEXT,
      category TEXT,
      created_by TEXT,
      data JSONB DEFAULT '{}',
      synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      base44_id TEXT UNIQUE,
      company_id TEXT,
      customer_id TEXT,
      customer_name TEXT,
      customer_email TEXT,
      invoice_number TEXT,
      status TEXT DEFAULT 'draft',
      total_amount NUMERIC(12,2) DEFAULT 0,
      amount_paid NUMERIC(12,2) DEFAULT 0,
      total_tax NUMERIC(12,2) DEFAULT 0,
      deductible_amount NUMERIC(12,2) DEFAULT 0,
      due_date TIMESTAMP,
      issue_date TEXT,
      project_name TEXT,
      sale_agent TEXT,
      insurance_company TEXT,
      claim_number TEXT,
      policy_number TEXT,
      items JSONB DEFAULT '[]',
      tags JSONB DEFAULT '[]',
      commission_splits JSONB DEFAULT '[]',
      notes TEXT,
      created_by TEXT,
      data JSONB DEFAULT '{}',
      synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      base44_id TEXT UNIQUE,
      company_id TEXT,
      invoice_id TEXT,
      customer_id TEXT,
      customer_name TEXT,
      invoice_number TEXT,
      amount NUMERIC(12,2) DEFAULT 0,
      payment_method TEXT,
      payment_date TIMESTAMP,
      reference_number TEXT,
      notes TEXT,
      status TEXT DEFAULT 'completed',
      send_receipt BOOLEAN DEFAULT false,
      created_by TEXT,
      data JSONB DEFAULT '{}',
      synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      base44_id TEXT UNIQUE,
      company_id TEXT,
      customer_id TEXT,
      customer_name TEXT,
      title TEXT,
      description TEXT,
      status TEXT DEFAULT 'pending',
      start_date TIMESTAMP,
      end_date TIMESTAMP,
      total_value NUMERIC(12,2) DEFAULT 0,
      assigned_to TEXT,
      address TEXT,
      notes TEXT,
      tags JSONB DEFAULT '[]',
      created_by TEXT,
      data JSONB DEFAULT '{}',
      synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      base44_id TEXT UNIQUE,
      company_id TEXT,
      title TEXT,
      name TEXT,
      description TEXT,
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'medium',
      assigned_to TEXT,
      assigned_to_name TEXT,
      assigned_to_avatar TEXT,
      assignees JSONB DEFAULT '[]',
      due_date TIMESTAMP,
      related_to TEXT,
      customer_id TEXT,
      customer_name TEXT,
      board_id TEXT,
      "column" TEXT,
      checklist_items JSONB DEFAULT '[]',
      comments JSONB DEFAULT '[]',
      files JSONB DEFAULT '[]',
      followers JSONB DEFAULT '[]',
      reminders JSONB DEFAULT '[]',
      timesheets JSONB DEFAULT '[]',
      created_by TEXT,
      data JSONB DEFAULT '{}',
      synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      base44_id TEXT UNIQUE,
      company_id TEXT,
      title TEXT,
      event_type TEXT,
      start_time TIMESTAMP,
      end_time TIMESTAMP,
      location TEXT,
      attendees TEXT,
      assigned_to TEXT,
      description TEXT,
      color TEXT,
      related_customer TEXT,
      related_lead TEXT,
      is_saas_event BOOLEAN DEFAULT false,
      send_email_notification BOOLEAN DEFAULT false,
      send_sms_notification BOOLEAN DEFAULT false,
      send_browser_notification BOOLEAN DEFAULT false,
      email_reminder_minutes INTEGER,
      sms_reminder_minutes INTEGER,
      browser_reminder_minutes INTEGER,
      created_by TEXT,
      data JSONB DEFAULT '{}',
      synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS communications (
      id TEXT PRIMARY KEY,
      base44_id TEXT UNIQUE,
      company_id TEXT,
      type TEXT,
      communication_type TEXT,
      direction TEXT,
      contact_name TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      subject TEXT,
      body TEXT,
      message TEXT,
      status TEXT,
      ai_summary TEXT,
      recording_url TEXT,
      sentiment TEXT,
      intent TEXT,
      duration_minutes INTEGER,
      is_read BOOLEAN DEFAULT false,
      lead_id TEXT,
      customer_id TEXT,
      created_by TEXT,
      data JSONB DEFAULT '{}',
      synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS call_routing_cache (
      phone_number TEXT PRIMARY KEY,
      company_id TEXT,
      company_name TEXT,
      assistant_name TEXT DEFAULT 'Sarah',
      routing_mode TEXT DEFAULT 'sarah_answers',
      cell_phone TEXT,
      rep_name TEXT,
      rep_email TEXT,
      twilio_sid TEXT,
      twilio_token TEXT,
      twilio_phone TEXT,
      availability_status TEXT DEFAULT 'available',
      data JSONB DEFAULT '{}',
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS signing_sessions (
      id SERIAL PRIMARY KEY,
      base44_session_id TEXT,
      company_id TEXT,
      template_id TEXT,
      template_name TEXT,
      contract_name TEXT,
      customer_name TEXT,
      customer_email TEXT,
      customer_phone TEXT,
      delivery_method TEXT DEFAULT 'email',
      rep_name TEXT,
      rep_email TEXT,
      rep_fields JSONB DEFAULT '{}',
      rep_signature_url TEXT,
      rep_signed_at TIMESTAMP,
      customer_fields JSONB DEFAULT '{}',
      customer_signature_data TEXT,
      customer_signed_at TIMESTAMP,
      signing_token TEXT UNIQUE,
      status TEXT DEFAULT 'draft',
      current_signer TEXT DEFAULT 'rep',
      fillable_fields JSONB DEFAULT '[]',
      original_file_url TEXT,
      expires_at TIMESTAMP,
      sent_to_customer_at TIMESTAMP,
      completed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sync_status (
      entity_type TEXT PRIMARY KEY,
      last_synced_at TIMESTAMP,
      record_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'idle',
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS generic_entities (
      id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      company_id TEXT,
      data JSONB DEFAULT '{}',
      created_date TIMESTAMP DEFAULT NOW(),
      updated_date TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (id, entity_type)
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS file_uploads (
      id TEXT PRIMARY KEY,
      original_filename TEXT,
      mime_type TEXT,
      file_size INTEGER,
      file_data BYTEA,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transaction_mapping_rules (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      pattern TEXT NOT NULL,
      category TEXT NOT NULL,
      transaction_type TEXT NOT NULL DEFAULT 'expense',
      priority INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_generic_entity_type ON generic_entities(entity_type);
    CREATE INDEX IF NOT EXISTS idx_generic_company ON generic_entities(entity_type, company_id);
    CREATE INDEX IF NOT EXISTS idx_generic_data ON generic_entities USING GIN(data);
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
    CREATE INDEX IF NOT EXISTS idx_staff_user_email ON staff_profiles(user_email);
    CREATE INDEX IF NOT EXISTS idx_companies_created_by ON companies(created_by);
    CREATE INDEX IF NOT EXISTS idx_call_routing ON call_routing_cache(company_id);
    CREATE INDEX IF NOT EXISTS idx_signing_token ON signing_sessions(signing_token);
    CREATE INDEX IF NOT EXISTS idx_signing_company ON signing_sessions(company_id);
    CREATE INDEX IF NOT EXISTS idx_signing_base44 ON signing_sessions(base44_session_id);
  `);

  await p.query(`
    ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT NULL;
  `);

  await p.query(`
    ALTER TABLE staff_profiles ALTER COLUMN preferred_language SET DEFAULT NULL;
  `);

  await p.query(`
    UPDATE staff_profiles SET preferred_language = NULL WHERE preferred_language = 'en';
  `);

  await p.query(`
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN DEFAULT false;
  `);

  await p.query(`
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS category TEXT;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS transaction_type TEXT DEFAULT 'revenue';
    CREATE INDEX IF NOT EXISTS idx_mapping_rules_company ON transaction_mapping_rules(company_id);
  `);

  console.log('[DB] Database schema initialized successfully');

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
      // Seed the 8 default templates for CompanySync
      const templates = [
        { format_name: 'State Farm Standard (Age/Life)', category: 'insurance', insurance_company: 'State Farm', description: '🏦 State Farm AGE/LIFE format', columns: 9, column_headers: ['Code','Description','Qty','Unit','Unit Price','RCV','Age/Life','Depr %','ACV'], show_rcv_acv: true, show_depreciation: true, show_age_life: true, rcv_label: 'RCV', acv_label: 'ACV', show_overhead_profit: true, overhead_profit_rate: 10, header_text: 'CompanySync - State Farm Preferred Contractor', footer_text: 'All work meets State Farm guidelines.', page_size: 'letter', font_size: 'medium', color_scheme: 'red', is_active: true },
        { format_name: 'Safeco Standard (Symbility)', category: 'insurance', insurance_company: 'Safeco', description: '🛡️ Safeco/Liberty Mutual/Erie format', columns: 8, column_headers: ['Description','Qty','Unit','Tax','Total'], show_rcv_acv: true, show_depreciation: false, show_age_life: false, rcv_label: 'Replacement Cost', acv_label: 'Actual Cash Value', show_overhead_profit: true, overhead_profit_rate: 10, header_text: 'CompanySync - Safeco/Liberty Mutual/Erie Approved', footer_text: 'THIS ESTIMATE REPRESENTS OUR CURRENT EVALUATION OF THE COVERED DAMAGES TO THE STRUCTURE.', page_size: 'letter', font_size: 'medium', color_scheme: 'blue', is_active: true },
        { format_name: 'Contractor Standard (CompanySync)', category: 'contractor', insurance_company: null, description: '🔨 Direct-to-customer contractor format', columns: 4, column_headers: ['Item','Qty','Rate','Amount'], show_rcv_acv: false, show_depreciation: false, show_age_life: false, rcv_label: 'RCV', acv_label: 'ACV', show_overhead_profit: false, overhead_profit_rate: 0, header_text: 'CompanySync', footer_text: 'A 5-year workmanship warranty backs all work. Price valid for 30 days from estimate date.', page_size: 'letter', font_size: 'medium', color_scheme: 'green', is_active: true },
        { format_name: 'State Farm Standard (Xactimate)', category: 'insurance', insurance_company: 'State Farm', description: 'State Farm format compatible with Xactimate pricing', columns: 7, column_headers: ['Description','Quantity','Unit Price','Tax','RCV','ACV'], show_rcv_acv: false, show_depreciation: true, show_age_life: false, rcv_label: 'RCV', acv_label: 'ACV', show_overhead_profit: true, overhead_profit_rate: 10, header_text: 'CompanySync', footer_text: 'ALL AMOUNTS PAYABLE ARE SUBJECT TO THE TERMS, CONDITIONS AND LIMITS OF YOUR POLICY.', page_size: 'letter', font_size: 'medium', color_scheme: 'blue', is_active: true },
        { format_name: 'State Farm Standard (Copy)', category: 'insurance', insurance_company: 'State Farm', description: 'Standard State Farm estimate format with RCV/ACV calculations', columns: 7, column_headers: ['Code','Description','Quantity','Unit','Unit Price','Tax','RCV'], show_rcv_acv: false, show_depreciation: true, show_age_life: false, rcv_label: 'RCV', acv_label: 'ACV', show_overhead_profit: true, overhead_profit_rate: 10, header_text: 'CompanySync', footer_text: 'This estimate is priced based on estimated market pricing for the cost of materials, labor, and other factors at the time of the loss.', page_size: 'letter', font_size: 'medium', color_scheme: 'blue', is_active: true },
        { format_name: 'Safeco Standard (Liberty Mutual)', category: 'insurance', insurance_company: 'Safeco / Liberty Mutual', description: 'Standard Safeco format used by Liberty Mutual and Erie', columns: 10, column_headers: ['Description','Quantity','Unit Price','Total O&P','Total Taxes','RC','Depreciation','ACV'], show_rcv_acv: true, show_depreciation: true, show_age_life: false, rcv_label: 'RCV', acv_label: 'ACV', show_overhead_profit: true, overhead_profit_rate: 10, header_text: 'CompanySync - Safeco/Liberty Mutual/Erie Approved', footer_text: 'THIS ESTIMATE REPRESENTS OUR CURRENT EVALUATION OF THE COVERED DAMAGES TO YOUR INSURED PROPERTY.', page_size: 'letter', font_size: 'small', color_scheme: 'blue', is_active: true },
        { format_name: 'Allstate Standard', category: 'insurance', insurance_company: 'Allstate', description: 'Allstate insurance format with detailed line items and RCV/ACV breakdown', columns: 7, column_headers: ['Description','Quantity','Unit Price','Tax','RCV','Depreciation','ACV'], show_rcv_acv: false, show_depreciation: true, show_age_life: false, rcv_label: 'RCV', acv_label: 'ACV', show_overhead_profit: true, overhead_profit_rate: 10, header_text: 'CompanySync', footer_text: 'Payment subject to policy terms and conditions.', page_size: 'letter', font_size: 'medium', color_scheme: 'blue', is_active: true },
        { format_name: 'Farmers Standard', category: 'insurance', insurance_company: 'Farmers', description: 'Farmers Insurance standard format with depreciation and RCV/ACV calculations', columns: 8, column_headers: ['Description','Quantity','Unit Price','Tax','RCV','Depreciation','ACV','Notes'], show_rcv_acv: true, show_depreciation: true, show_age_life: false, rcv_label: 'RCV', acv_label: 'ACV', show_overhead_profit: true, overhead_profit_rate: 10, header_text: 'CompanySync', footer_text: 'All claim payments subject to policy provisions, limits, and deductibles.', page_size: 'letter', font_size: 'medium', color_scheme: 'green', is_active: true },
      ];
      for (const tmpl of templates) {
        const id = `tmpl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await p.query(
          `INSERT INTO generic_entities (id, company_id, entity_type, data, created_date, updated_date) VALUES ($1, 'companysync_master_001', 'EstimateFormat', $2, NOW(), NOW())`,
          [id, JSON.stringify({ ...tmpl, company_id: 'companysync_master_001' })]
        );
      }
      console.log('[Init] Platform company seeded successfully (company + staff + 8 templates)');
    }
  } catch (err) {
    console.error('[Init] Error seeding platform company:', err.message);
  }

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
