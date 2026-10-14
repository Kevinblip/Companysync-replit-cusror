import pg from 'pg';
const { Pool } = pg;

let pool = null;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on('error', (err) => {
      console.error('[DB] Unexpected pool error:', err.message);
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
      ai_credits_purchased INTEGER DEFAULT 0,
      sms_credits_purchased INTEGER DEFAULT 0,
      call_credits_purchased INTEGER DEFAULT 0,
      onboarding_completed BOOLEAN DEFAULT false,
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
      lead_temperature TEXT,
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
      claim_number TEXT,
      adjuster_name TEXT,
      adjuster_phone TEXT,
      status TEXT DEFAULT 'active',
      total_revenue NUMERIC(12,2) DEFAULT 0,
      portal_token TEXT,
      data JSONB DEFAULT '{}',
      synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS adjuster_name TEXT;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS adjuster_phone TEXT;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS referral_source TEXT;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS custom_source TEXT;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS assigned_to_users JSONB DEFAULT '[]';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS insurance_company TEXT;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS claim_number TEXT;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_revenue NUMERIC(12,2) DEFAULT 0;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP DEFAULT NOW();
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS portal_token TEXT;
    UPDATE customers SET portal_token = gen_random_uuid()::text WHERE portal_token IS NULL OR portal_token = id;
    ALTER TABLE customers ALTER COLUMN portal_token SET DEFAULT gen_random_uuid()::text;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_portal_token ON customers(portal_token) WHERE portal_token IS NOT NULL;

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

    CREATE TABLE IF NOT EXISTS property_measurements (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      invoice_id TEXT,
      job_id TEXT,
      photo_urls JSONB NOT NULL DEFAULT '[]',
      raw_analysis JSONB NOT NULL DEFAULT '{}',
      siding_sq NUMERIC(12,2),
      trim_linear_ft NUMERIC(12,2),
      roof_pitch TEXT,
      window_count INTEGER,
      door_count INTEGER,
      confidence NUMERIC(5,2),
      status TEXT NOT NULL DEFAULT 'processing',
      error_message TEXT,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Existing installations may have the original property_measurements
    -- schema, which predates invoice/job linking. CREATE TABLE IF NOT EXISTS
    -- does not add later columns, so add them before creating their indexes.
    ALTER TABLE property_measurements ADD COLUMN IF NOT EXISTS invoice_id TEXT;
    ALTER TABLE property_measurements ADD COLUMN IF NOT EXISTS job_id TEXT;

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      base44_id TEXT UNIQUE,
      company_id TEXT,
      invoice_id TEXT,
      customer_id TEXT,
      customer_name TEXT,
      invoice_number TEXT,
      payment_number TEXT,
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

    CREATE TABLE IF NOT EXISTS labor_rates (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      unit TEXT NOT NULL,
      rate_cents INTEGER NOT NULL CHECK (rate_cents >= 0),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subcontractor_rates (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      subcontractor_id TEXT NOT NULL,
      labor_rate_id TEXT NOT NULL REFERENCES labor_rates(id) ON DELETE CASCADE,
      custom_rate NUMERIC(12,2) NOT NULL CHECK (custom_rate >= 0),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (subcontractor_id, labor_rate_id)
    );

    CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      subcontractor_id TEXT NOT NULL,
      work_order_number TEXT NOT NULL,
      title TEXT NOT NULL,
      scope_of_work TEXT,
      payout_cents INTEGER NOT NULL CHECK (payout_cents >= 0),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','completed','approved','paid')),
      access_token TEXT NOT NULL UNIQUE,
      completion_notes TEXT,
      created_by TEXT,
      accepted_at TIMESTAMP,
      completed_at TIMESTAMP,
      approved_at TIMESTAMP,
      paid_at TIMESTAMP,
      invite_delivery_method TEXT,
      invite_delivery_status TEXT,
      invite_delivered_at TIMESTAMP,
      invite_delivery_error TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS work_order_items (
      id TEXT PRIMARY KEY,
      work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL,
      labor_rate_id TEXT NOT NULL REFERENCES labor_rates(id),
      description TEXT NOT NULL,
      unit TEXT NOT NULL,
      quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
      unit_rate_cents INTEGER NOT NULL CHECK (unit_rate_cents >= 0),
      total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS work_order_completion_photos (
      id TEXT PRIMARY KEY,
      work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL,
      file_url TEXT NOT NULL,
      original_filename TEXT,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL CHECK (file_size > 0),
      created_at TIMESTAMP DEFAULT NOW()
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
      status TEXT DEFAULT 'scheduled',
      google_event_id TEXT,
      outlook_event_id TEXT,
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
    ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'scheduled';
    ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS google_event_id TEXT;
    ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS outlook_event_id TEXT;

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

    CREATE TABLE IF NOT EXISTS caller_memories (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      phone_key TEXT NOT NULL,
      customer_id TEXT,
      lead_id TEXT,
      contact_name TEXT,
      summary TEXT NOT NULL DEFAULT '',
      facts JSONB NOT NULL DEFAULT '{}',
      recent_excerpt TEXT,
      older_summary TEXT,
      source_call_id TEXT,
      word_count INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (company_id, phone_key)
    );
    CREATE INDEX IF NOT EXISTS caller_memories_company_customer_idx ON caller_memories (company_id, customer_id);
    CREATE INDEX IF NOT EXISTS caller_memories_company_lead_idx ON caller_memories (company_id, lead_id);

    CREATE TABLE IF NOT EXISTS call_routing_cache (
      phone_number TEXT PRIMARY KEY,
      company_id TEXT,
      company_name TEXT,
      assistant_name TEXT DEFAULT 'Alex',
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

  // Index DDL needs a stronger table lock than normal CRM reads and writes.
  // Do not take those locks on every server restart once the schema is current.
  // That can otherwise queue behind a scheduled write and leave every API route
  // at "Database not ready".
  const requiredIndexNames = [
    'idx_generic_entity_type', 'idx_generic_company', 'idx_generic_data',
    'idx_leads_company', 'idx_leads_status', 'idx_customers_company',
    'idx_estimates_company', 'idx_invoices_company', 'idx_invoices_status',
    'idx_property_measurements_company', 'idx_property_measurements_invoice',
    'idx_property_measurements_job', 'idx_payments_company', 'idx_projects_company',
    'idx_labor_rates_company', 'idx_subcontractor_rates_lookup',
    'idx_work_orders_company_status', 'idx_work_orders_project',
    'idx_work_order_items_order', 'idx_work_order_photos_order', 'idx_tasks_company',
    'idx_tasks_status', 'idx_calendar_company', 'idx_calendar_time',
    'idx_calendar_google_event_unique', 'idx_comms_company', 'idx_staff_company',
    'idx_staff_twilio', 'idx_staff_user_email', 'idx_companies_created_by',
    'idx_call_routing', 'idx_signing_token', 'idx_signing_company',
    'idx_signing_base44',
  ];
  const { rows: existingIndexes } = await p.query(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = current_schema() AND indexname = ANY($1::text[])`,
    [requiredIndexNames]
  );
  const existingIndexDefinitions = new Map(existingIndexes.map((index) => [index.indexname, index.indexdef]));
  const indexesAreCurrent =
    existingIndexDefinitions.size === requiredIndexNames.length &&
    existingIndexDefinitions.get('idx_generic_company')?.includes('(entity_type, company_id)');

  if (!indexesAreCurrent) {
    // Bound the wait so an active cron/job cannot leave the whole application
    // permanently stuck in its "Database not ready" startup state.
    const indexClient = await p.connect();
    try {
      await indexClient.query('BEGIN');
      await indexClient.query(`SET LOCAL lock_timeout = '5s'`);
      await indexClient.query(`
    CREATE INDEX IF NOT EXISTS idx_generic_entity_type ON generic_entities(entity_type);
    -- Self-heal: older databases may have idx_generic_company on (company_id) only.
    -- CREATE INDEX IF NOT EXISTS matches by NAME, so the weaker index would be
    -- kept forever. Drop it if its definition doesn't match the intended columns.
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_generic_company'
          AND indexdef NOT LIKE '%(entity_type, company_id)%'
      ) THEN
        DROP INDEX idx_generic_company;
      END IF;
    END $$;
    CREATE INDEX IF NOT EXISTS idx_generic_company ON generic_entities(entity_type, company_id);
    CREATE INDEX IF NOT EXISTS idx_generic_data ON generic_entities USING GIN(data);
    CREATE INDEX IF NOT EXISTS idx_leads_company ON leads(company_id);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(company_id, status);
    CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company_id);
    CREATE INDEX IF NOT EXISTS idx_estimates_company ON estimates(company_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(company_id, status);
    CREATE INDEX IF NOT EXISTS idx_property_measurements_company ON property_measurements(company_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_property_measurements_invoice ON property_measurements(company_id, invoice_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_property_measurements_job ON property_measurements(company_id, job_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_payments_company ON payments(company_id);
    CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id);
    CREATE INDEX IF NOT EXISTS idx_labor_rates_company ON labor_rates(company_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_subcontractor_rates_lookup ON subcontractor_rates(company_id, subcontractor_id);
    CREATE INDEX IF NOT EXISTS idx_work_orders_company_status ON work_orders(company_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_work_orders_project ON work_orders(company_id, project_id);
    CREATE INDEX IF NOT EXISTS idx_work_order_items_order ON work_order_items(work_order_id);
    CREATE INDEX IF NOT EXISTS idx_work_order_photos_order ON work_order_completion_photos(work_order_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_company ON tasks(company_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(company_id, status);
    CREATE INDEX IF NOT EXISTS idx_calendar_company ON calendar_events(company_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_time ON calendar_events(company_id, start_time);
    -- Dedupe before the unique index below: the pre-lock sync code could
    -- double-insert the same Google event, and a failed CREATE UNIQUE INDEX
    -- would abort DB init. Keeps the newest row per google_event_id.
    DELETE FROM calendar_events a USING calendar_events b
      WHERE a.google_event_id IS NOT NULL
        AND a.google_event_id = b.google_event_id
        AND a.id <> b.id
        AND (COALESCE(a.created_at, 'epoch'::timestamp), a.id) < (COALESCE(b.created_at, 'epoch'::timestamp), b.id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_google_event_unique ON calendar_events(google_event_id) WHERE google_event_id IS NOT NULL;
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
      await indexClient.query('COMMIT');
    } catch (err) {
      await indexClient.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      indexClient.release();
    }
  }

  // Deliberately OUTSIDE the guarded index block above: that block is skipped
  // whenever its own fixed list of indexes already exists, so anything added
  // there never reaches a database that has been initialized once before.
  await p.query(`
    -- Provider delivery/bounce webhooks look a row up by provider message id and
    -- nothing else (they have no company context), so without this the ingress
    -- degrades into a full scan of every communication ever recorded.
    CREATE INDEX IF NOT EXISTS idx_comms_provider_message_id
      ON communications((data->>'provider_message_id'))
      WHERE data->>'provider_message_id' IS NOT NULL;

    -- Ledger of provider delivery callbacks. They arrive once, so an event that
    -- cannot be applied immediately (database blip, or the callback beating our
    -- own send handler to the row) has to survive somewhere until it can be.
    CREATE TABLE IF NOT EXISTS email_delivery_events (
      id TEXT PRIMARY KEY,
      provider TEXT,
      message_id TEXT,
      event TEXT NOT NULL,
      detail TEXT,
      occurred_at TIMESTAMPTZ,
      applied_at TIMESTAMPTZ,
      matched INTEGER DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_email_delivery_events_pending
      ON email_delivery_events(created_at)
      WHERE applied_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_email_delivery_events_message
      ON email_delivery_events(message_id);

    -- A bounded sweep needs to know when it last looked at a row, or the rows
    -- that never change (still waiting for their send record) would be the only
    -- ones it ever reads.
    ALTER TABLE email_delivery_events ADD COLUMN IF NOT EXISTS last_attempted_at TIMESTAMPTZ;
    -- Our own id, written before the send and echoed back by the provider. It
    -- is the only way a callback can find its record when the provider's own
    -- message id never reached the database.
    ALTER TABLE email_delivery_events ADD COLUMN IF NOT EXISTS correlation_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_comms_delivery_correlation
      ON communications ((data->>'delivery_correlation_id'))
      WHERE data->>'delivery_correlation_id' IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_email_delivery_events_rotation
      ON email_delivery_events(last_attempted_at NULLS FIRST, created_at)
      WHERE applied_at IS NULL;

    -- Mail that the provider already accepted, whose message id could not be
    -- written back to its communication. Without a durable retry the record can
    -- never be reconciled again, because the id is the only join key there is.
    CREATE TABLE IF NOT EXISTS email_pending_associations (
      communication_id TEXT PRIMARY KEY,
      provider TEXT,
      message_id TEXT NOT NULL,
      delivery_status TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await p.query(`
    ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS html_content TEXT;
    ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS customer_id TEXT;
    ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS lead_id TEXT;
  `);

  await p.query(`
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS ai_credits_purchased INTEGER DEFAULT 0;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS sms_credits_purchased INTEGER DEFAULT 0;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS call_credits_purchased INTEGER DEFAULT 0;
  `);

  // Store the actual Stripe subscription amount (dollars, not cents) and status
  // so MRR can be derived from real billing data instead of hardcoded plan prices.
  await p.query(`
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_subscription_amount NUMERIC DEFAULT 0;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_subscription_status TEXT;
  `);

  // One-time guarded migration: onboarding_completed gates dashboard access for
  // NEW companies (default false → routed to Quick Setup). Companies that
  // existed before this column was added are grandfathered to true so nobody
  // gets locked out. The UPDATE runs ONLY when the column is first created —
  // never as a repeating startup backfill (a repeating UPDATE would flip new
  // pending companies to true and defeat the gate).
  try {
    const onboardingCol = await p.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'companies'
        AND column_name = 'onboarding_completed'
    `);
    if (onboardingCol.rows.length === 0) {
      await p.query(`ALTER TABLE companies ADD COLUMN onboarding_completed BOOLEAN DEFAULT false`);
      await p.query(`UPDATE companies SET onboarding_completed = true`);
      console.log('[DB] onboarding_completed added; existing companies grandfathered to true');
    }
  } catch (err) {
    console.warn('[DB] onboarding_completed migration skipped:', err.message);
  }

  // Backfill: trials started via startCompanyTrial historically wrote only
  // data->>'trial_ends_at' (JSONB), leaving the real trial_end_date column NULL,
  // so the paid-feature expiry gates (which read the column) never saw the end
  // date. Idempotent — only touches rows where the column is still NULL and the
  // JSONB value looks like a date. try/catch so one malformed date value can
  // never abort schema init. (Task #672)
  try {
    await p.query(`
      UPDATE companies
      SET trial_end_date = (data->>'trial_ends_at')::timestamp
      WHERE trial_end_date IS NULL
        AND data->>'trial_ends_at' ~ '^\\d{4}-\\d{2}-\\d{2}'
    `);
  } catch (err) {
    console.warn('[DB] trial_end_date backfill skipped:', err.message);
  }

  // Ledger that makes Stripe credit-grant webhooks idempotent AND provides an
  // audit trail of every paid credit purchase. session_id is UNIQUE so a
  // webhook retry (Stripe delivers at-least-once) can never double-grant:
  // the second INSERT hits the conflict and the increment is skipped.
  await p.query(`
    CREATE TABLE IF NOT EXISTS credit_grants (
      id TEXT PRIMARY KEY,
      session_id TEXT UNIQUE NOT NULL,
      company_id TEXT,
      purchase_type TEXT,
      granted JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_credit_grants_company ON credit_grants(company_id);
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
    ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS commission_notify_email BOOLEAN DEFAULT true;
    ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS commission_notify_sms BOOLEAN DEFAULT true;
    ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS commission_notify_bell BOOLEAN DEFAULT true;
    ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS commission_notify_weekly_digest BOOLEAN DEFAULT true;
    ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS leaderboard_digest_email BOOLEAN DEFAULT true;
  `);

  await p.query(`
    ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS commission_notify_modified_by TEXT;
    ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS commission_notify_modified_at TIMESTAMP;
  `);

  await p.query(`
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN DEFAULT false;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS contractor_decision TEXT;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS claim_number TEXT;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS referred_by TEXT;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_temperature TEXT;
  `);

  await p.query(`
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_number TEXT;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS category TEXT;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS transaction_type TEXT DEFAULT 'revenue';
    CREATE INDEX IF NOT EXISTS idx_mapping_rules_company ON transaction_mapping_rules(company_id);
  `);

  await p.query(`
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quickbooks_invoice_id TEXT;
  `);

  await p.query(`
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS quickbooks_payment_id TEXT;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS quickbooks_customer_id TEXT;
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      chat_type TEXT DEFAULT 'direct',
      name TEXT,
      participants JSONB DEFAULT '[]',
      last_message TEXT,
      last_message_at TIMESTAMP,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      sender_email TEXT,
      sender_name TEXT,
      message TEXT,
      message_type TEXT DEFAULT 'text',
      task_id TEXT,
      task_title TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS chat_read_receipts (
      user_email TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      last_read_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_email, conversation_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_conv_company ON chat_conversations(company_id);
    CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON chat_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_chat_msg_company ON chat_messages(company_id);
    ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reactions JSONB DEFAULT '{}'::jsonb;
  `);

  // ── Homeowner Portal: project_type, current_milestone, project_logs ──
  await p.query(`
    ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS invite_delivery_method TEXT;
    ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS invite_delivery_status TEXT;
    ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS invite_delivered_at TIMESTAMP;
    ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS invite_delivery_error TEXT;
  `);

  await p.query(`
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type TEXT DEFAULT 'standard';
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS current_milestone TEXT;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS related_customer_id TEXT;
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS project_logs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      author_role TEXT NOT NULL DEFAULT 'admin',
      author_name TEXT,
      content_body TEXT NOT NULL,
      is_public BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_project_logs_project ON project_logs(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_project_logs_company_public ON project_logs(company_id, is_public);
  `);

  // Safety migration: ensure is_public column always has DEFAULT false at the DB level,
  // even on databases created before this default was declared. This is idempotent and
  // prevents a raw INSERT that omits the column from silently exposing internal notes.
  await p.query(`ALTER TABLE project_logs ALTER COLUMN is_public SET DEFAULT false`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS project_photos (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      photo_url TEXT NOT NULL,
      caption TEXT,
      milestone TEXT,
      is_public BOOLEAN NOT NULL DEFAULT false,
      uploaded_by TEXT,
      source_media_id TEXT,
      source_customer_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE project_photos ADD COLUMN IF NOT EXISTS source_media_id TEXT;
    ALTER TABLE project_photos ADD COLUMN IF NOT EXISTS source_customer_id TEXT;
    UPDATE project_photos pp
    SET source_customer_id = jm.data->>'related_entity_id'
    FROM generic_entities jm
    WHERE pp.source_customer_id IS NULL
      AND pp.source_media_id IS NOT NULL
      AND pp.source_media_id = jm.id
      AND pp.company_id = jm.company_id
      AND jm.entity_type = 'JobMedia'
      AND jm.data->>'related_entity_type' = 'Customer'
      AND jm.data->>'source' IN ('crew_upload', 'whatsapp_upload')
      AND NULLIF(jm.data->>'related_entity_id', '') IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_project_photos_project ON project_photos(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_photos_public ON project_photos(project_id, is_public);
    CREATE INDEX IF NOT EXISTS idx_project_photos_source_customer
      ON project_photos(company_id, source_customer_id, project_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_photos_source_media
      ON project_photos(project_id, source_media_id)
      WHERE source_media_id IS NOT NULL;
  `);

  // Safety migration: ensure project_photos.is_public has DEFAULT false at the DB level.
  // Must run AFTER the CREATE TABLE block above so it is safe on fresh databases too.
  // Idempotent — safe to run on existing databases where the default is already correct.
  await p.query(`ALTER TABLE project_photos ALTER COLUMN is_public SET DEFAULT false`);

  // ── Weak-item hardening batch: #5 FK constraints, #6 generic_entities NOT NULL, #7 missing company_id ──

  // #7a — Add company_id to file_uploads (was completely missing)
  await p.query(`
    ALTER TABLE file_uploads ADD COLUMN IF NOT EXISTS company_id TEXT;
  `);
  // Index for tenant-scoped queries on file_uploads
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_file_uploads_company ON file_uploads(company_id);
  `);

  // #7b — Add company_id to chat_read_receipts (was completely missing)
  await p.query(`
    ALTER TABLE chat_read_receipts ADD COLUMN IF NOT EXISTS company_id TEXT;
  `);
  // Backfill company_id from chat_conversations for any existing rows
  await p.query(`
    UPDATE chat_read_receipts crr
    SET company_id = cc.company_id
    FROM chat_conversations cc
    WHERE crr.conversation_id = cc.id
      AND crr.company_id IS NULL;
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_chat_receipts_company ON chat_read_receipts(company_id, conversation_id);
  `);

  // #6 — Backfill any orphaned NULL company_id rows to the platform company.
  // NOTE: We intentionally keep company_id nullable so that the Replit deployment
  // auto-migration does NOT generate a SET NOT NULL statement against production
  // (production may still have pre-backfill NULL rows that would fail the constraint).
  // The backfill below is sufficient — all runtime code filters by company_id already.
  await p.query(`
    UPDATE generic_entities SET company_id = 'companysync_master_001' WHERE company_id IS NULL;
  `);
  // Ensure dev DB stays nullable so schema diff matches production (prevents broken migrations).
  await p.query(`
    ALTER TABLE generic_entities ALTER COLUMN company_id DROP NOT NULL;
  `);

  // #5 — Add FK constraints with NOT VALID so they don't scan existing rows.
  // Using DO blocks because ADD CONSTRAINT IF NOT EXISTS is not valid PostgreSQL syntax.
  await p.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_file_uploads_company' AND table_name = 'file_uploads'
      ) THEN
        ALTER TABLE file_uploads
          ADD CONSTRAINT fk_file_uploads_company
          FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE NOT VALID;
      END IF;
    END $$;
  `);
  await p.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_chat_receipts_company' AND table_name = 'chat_read_receipts'
      ) THEN
        ALTER TABLE chat_read_receipts
          ADD CONSTRAINT fk_chat_receipts_company
          FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE NOT VALID;
      END IF;
    END $$;
  `);
  await p.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_chat_conv_company' AND table_name = 'chat_conversations'
      ) THEN
        ALTER TABLE chat_conversations
          ADD CONSTRAINT fk_chat_conv_company
          FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE NOT VALID;
      END IF;
    END $$;
  `);
  await p.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_chat_msg_company' AND table_name = 'chat_messages'
      ) THEN
        ALTER TABLE chat_messages
          ADD CONSTRAINT fk_chat_msg_company
          FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE NOT VALID;
      END IF;
    END $$;
  `);

  console.log('[DB] Weak-item hardening migration applied (#5 FK constraints, #6 NOT NULL, #7 company_id columns)');

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
        { format_name: 'Xactimate Standard (O&P)', category: 'insurance', insurance_company: 'Multi-Carrier', description: 'Xactimate-compatible format with O&P as a dedicated per-line column. Matches Nationwide, State Farm, and other Xactimate carriers.', columns: 9, column_headers: ['Description','Qty','Unit','Tax','O&P','RCV','Dep%','ACV'], show_rcv_acv: true, show_depreciation: true, show_age_life: false, show_op_column: true, rcv_label: 'RCV', acv_label: 'ACV', show_overhead_profit: true, overhead_profit_rate: 20, show_claim_number: true, show_insurance_company: true, show_policy_number: true, show_deductible: true, show_adjuster: true, header_text: 'CompanySync', footer_text: 'ALL AMOUNTS PAYABLE ARE SUBJECT TO THE TERMS, CONDITIONS AND LIMITS OF YOUR POLICY.', page_size: 'letter', font_size: 'small', color_scheme: 'blue', is_active: true },
        { format_name: 'Symbility Standard (O&P)', category: 'insurance', insurance_company: 'Multi-Carrier', description: 'Symbility-compatible format with O&P as a dedicated per-line column. Matches Liberty Mutual, Safeco, and Erie carriers using Symbility.', columns: 9, column_headers: ['Description','Qty','Unit Price','O&P','Taxes','RC','Depreciation','ACV'], show_rcv_acv: true, show_depreciation: true, show_age_life: false, show_op_column: true, rcv_label: 'RC', acv_label: 'ACV', show_overhead_profit: true, overhead_profit_rate: 20, show_claim_number: true, show_insurance_company: true, show_policy_number: true, show_deductible: true, show_adjuster: true, header_text: 'CompanySync', footer_text: 'THIS ESTIMATE REPRESENTS OUR CURRENT EVALUATION OF THE COVERED DAMAGES TO YOUR INSURED PROPERTY AND MAY BE REVISED AS WE CONTINUE TO EVALUATE YOUR CLAIM.', page_size: 'letter', font_size: 'small', color_scheme: 'blue', is_active: true },
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

  // Impersonation audit log — server-side enforcement table
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS impersonation_logs (
        id TEXT PRIMARY KEY,
        admin_email TEXT NOT NULL,
        target_company_id TEXT NOT NULL,
        target_company_name TEXT,
        reason TEXT NOT NULL,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        duration_minutes INTEGER,
        is_active BOOLEAN DEFAULT true,
        expires_at TIMESTAMPTZ NOT NULL,
        view_as_user_email TEXT
      )
    `);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_impersonation_logs_company ON impersonation_logs (target_company_id)`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_impersonation_logs_admin ON impersonation_logs (admin_email)`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_impersonation_logs_active ON impersonation_logs (is_active) WHERE is_active = true`);
    await p.query(`ALTER TABLE impersonation_logs ADD COLUMN IF NOT EXISTS action_type TEXT DEFAULT 'impersonation'`);
  } catch (err) {
    console.error('[Init] Error creating impersonation_logs table:', err.message);
  }

  // Gmail OAuth columns for Lexi inbox access
  try {
    await p.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS gmail_connected BOOLEAN DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS gmail_access_token TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS gmail_refresh_token TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS gmail_token_expires_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS gmail_email TEXT;
    `);
  } catch (err) {
    console.warn('[DB] ALTER TABLE users (gmail columns) skipped:', err.message);
  }

  // Google Calendar reconnect flag: set to true when tokens are cleared due to
  // invalid_grant (revoked/expired refresh token — e.g. Testing-mode 7-day expiry).
  // Cleared automatically on successful reconnect. Used by checkUserGoogleCalendarConnection
  // to surface a proactive "Reconnect Google Calendar" banner instead of a silent
  // "not connected" state with no explanation.
  try {
    await p.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS google_calendar_reconnect_needed BOOLEAN DEFAULT false;
    `);
  } catch (err) {
    console.warn('[DB] ALTER TABLE users (google_calendar_reconnect_needed) skipped:', err.message);
  }

  // Idempotency gate for the "your Google Calendar disconnected" alert. The sync
  // cron re-enters the disconnect path every 15 minutes, so the alert sender
  // claims this column (NULL -> NOW()) and only the winning claim notifies.
  // Reset to NULL on a successful reconnect so the NEXT disconnect alerts again.
  try {
    await p.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS google_disconnect_alerted_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS microsoft_disconnect_alerted_at TIMESTAMPTZ;
    `);
  } catch (err) {
    console.warn('[DB] ALTER TABLE users (calendar disconnect alert columns) skipped:', err.message);
  }

  // Staff scoring / leaderboard
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS staff_score_events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        staff_email TEXT NOT NULL,
        staff_name TEXT,
        event_type TEXT NOT NULL,
        points INTEGER NOT NULL DEFAULT 0,
        entity_type TEXT,
        entity_id TEXT,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_staff_score_events_company ON staff_score_events(company_id);
      CREATE INDEX IF NOT EXISTS idx_staff_score_events_staff ON staff_score_events(company_id, staff_email);
      CREATE INDEX IF NOT EXISTS idx_staff_score_events_created ON staff_score_events(created_at DESC);
    `);
  } catch (err) {
    console.warn('[DB] staff_score_events table skipped:', err.message);
  }
}
